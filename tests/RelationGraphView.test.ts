import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockElement } from './mocks/MockElement';
import { RelationGraphView, type RelationGraphViewPlugin } from '../src/ui/RelationGraphView';
import type { GraphData } from '../src/services/RelationGraphManager';
import type { GraphRenderState, ThemeColors } from '../src/ui/components/GraphRenderer';

const { MockTFile } = vi.hoisted(() => {
	class HoistedMockTFile {
		extension = 'md';
		basename: string;
		stat = { mtime: 1 };
		parent: { path: string } | null = null;
		constructor(public name: string, public path: string, parentPath = '') {
			this.basename = name.replace(/\.md$/, '');
			if (parentPath) {
				this.parent = { path: parentPath };
			}
		}
	}
	return { MockTFile: HoistedMockTFile };
});

(MockElement.prototype as unknown as { getBoundingClientRect: () => unknown; getContext: () => unknown }).getBoundingClientRect = () => ({
	width: 800,
	height: 600,
	top: 0,
	left: 0,
	right: 800,
	bottom: 600
});
(MockElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
	clearRect: vi.fn(),
	save: vi.fn(),
	restore: vi.fn(),
	scale: vi.fn(),
	translate: vi.fn()
});


vi.stubGlobal('window', {
	requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	setTimeout: (cb: () => void, ms?: number) => setTimeout(cb, ms),
	clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
});

vi.stubGlobal('ResizeObserver', class {
	observe = vi.fn();
	disconnect = vi.fn();
});

vi.mock('obsidian', () => {
	class MockItemView {
		app: unknown;
		containerEl: MockElement;
		contentEl: MockElement;

		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.containerEl = new MockElement('workspace-leaf-content');
			this.contentEl = new MockElement('view-content');
			this.containerEl.children.push(this.contentEl);
			this.contentEl.parentElement = this.containerEl;
		}

		registerEvent(): void {}
	}

	return {
		ItemView: MockItemView,
		TFile: MockTFile,
		Notice: class {},
		setIcon: vi.fn()
	};
});


vi.mock('../src/services/ForceLayoutEngine', () => ({
	ForceLayoutEngine: class {
		nodes: unknown[] = [];
		edges: unknown[] = [];
		destroy = vi.fn();
		initNodes = vi.fn();
		initEdges = vi.fn();
		setDimensions = vi.fn();
		tick = vi.fn();
		isSettled = vi.fn().mockReturnValue(true);
		updateData = vi.fn();
		reheat = vi.fn();
		resize = vi.fn();
		reset = vi.fn();
	}
}));

vi.mock('../src/ui/components/GraphRenderer', () => ({
	GraphRenderer: {
		drawGraph: vi.fn(),
		computeThemeColors: vi.fn().mockReturnValue({}),
		getThemeColors: vi.fn().mockReturnValue({}),
		buildEdgeOffsets: vi.fn(),
		render: vi.fn()
	}
}));

vi.mock('../src/ui/components/GraphInteractionController', () => ({
	GraphInteractionController: class {
		bindEvents = vi.fn();
		unbindEvents = vi.fn();
		updateLayout = vi.fn();
	}
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

describe('graph render work per frame', () => {
	const node = (id: string, x: number, y: number): GraphData['nodes'][number] => ({
		id, heading: id, x, y, vx: 0, vy: 0, pinned: false,
		file: new MockTFile('lore.md', 'Novel/lore.md') as unknown as import('obsidian').TFile
	});
	it('indexes focus neighbors while preserving overlap and simultaneous focus fading', async () => {
		const { GraphRenderer } = await vi.importActual<typeof import('../src/ui/components/GraphRenderer')>('../src/ui/components/GraphRenderer');
		const nodes = ['A', 'B', 'C', 'D', 'E'].map((id, i) => node(id, i * 100, 0));
		const data: GraphData = { nodes, edges: [] };
		const tasks = [[0, 1, true], [0, 1, false], [2, 0, true], [3, 4, false]].map(([src, tgt, overlap]) => ({
			src: nodes[Number(src)], tgt: nodes[Number(tgt)], isOverlapped: overlap
		})) as import('../src/ui/components/GraphRenderer').EdgeRenderTask[];
		const state = { graphData: data, selectedNode: nodes[0], hoveredNode: null } as GraphRenderState;
		let alpha = 1;
		const drawn: number[] = [];
		const ctx = new Proxy({}, {
			get: (_o, key) => key === 'fillText' ? () => { drawn.push(alpha); } : () => {},
			set: (_o, key, value: unknown) => { if (key === 'globalAlpha') alpha = Number(value); return true; }
		}) as CanvasRenderingContext2D;
		const filter = vi.spyOn(tasks, 'filter');
		GraphRenderer.drawNodes(ctx, data, {} as ThemeColors, tasks, state);
		expect(drawn.splice(0)).toEqual([1, 1, 0.35, 0.15, 0.15]);
		state.hoveredNode = nodes[3];
		GraphRenderer.drawNodes(ctx, data, {} as ThemeColors, tasks, state);
		expect(drawn.splice(0)).toEqual([0.3, 1, 0.35, 0.15, 0.15]);
		state.selectedNode = null;
		GraphRenderer.drawNodes(ctx, data, {} as ThemeColors, tasks, state);
		expect(drawn.splice(0)).toEqual([0.3, 0.3, 0.3, 1, 1]);
		tasks[3].isOverlapped = true;
		GraphRenderer.drawNodes(ctx, data, {} as ThemeColors, tasks, state);
		expect(drawn.splice(0)).toEqual([0.3, 0.3, 0.3, 1, 0.35]);
		expect(filter).not.toHaveBeenCalled();
	});
	it('indexes endpoints once, keeps first duplicate identity, and resolves replacement nodes on the next frame', async () => {
		const { GraphRenderer } = await vi.importActual<typeof import('../src/ui/components/GraphRenderer')>('../src/ui/components/GraphRenderer');
		const first = node('A', 0, 0);
		const target = node('B', 100, 100);
		const data: GraphData = { nodes: [first, target, node('A', 999, 999)],
			edges: [{ source: 'A', target: 'B', label: '', type: 'explicit' }] };
		const state = { graphData: data, scale: 1, edgeDrawModeMap: new Map(), edgeOffsetMap: new Map(), combinedLabelMap: new Map() } as GraphRenderState;
		const ctx = new Proxy({}, { get: (_o, key) => key === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : () => {}, set: () => true }) as CanvasRenderingContext2D;
		const find = vi.spyOn(data.nodes, 'find');
		const tasks = GraphRenderer.renderEdges(ctx, {} as ThemeColors, state);
		expect(tasks[0].src).toBe(first);
		expect(tasks[0].tgt).toBe(target);
		expect(find).not.toHaveBeenCalled();
		const replacement = { ...first, x: 50 };
		data.nodes[0] = replacement as GraphData['nodes'][number];
		expect(GraphRenderer.renderEdges(ctx, {} as ThemeColors, state)[0].src).toBe(replacement);
		find.mockRestore();
	});

	it('shares label measurements within one frame and refreshes them for changed typography', async () => {
		const { GraphRenderer } = await vi.importActual<typeof import('../src/ui/components/GraphRenderer')>('../src/ui/components/GraphRenderer');
		const data: GraphData = { nodes: [node('A', 0, 0), node('B', 100, 100)],
			edges: [{ source: 'A', target: 'B', label: 'shared|label', type: 'explicit' }] };
		const state = { graphData: data, scale: 1, edgeDrawModeMap: new Map(), edgeOffsetMap: new Map(), combinedLabelMap: new Map() } as GraphRenderState;
		let font = '12px serif';
		const fonts: string[] = [];
		const measureText = vi.fn(() => ({ width: Number.parseFloat(font) * 3 }));
		const ctx = new Proxy({}, {
			get: (_o, key) => {
				if (key === 'font') return font;
				if (key === 'measureText') return measureText;
				if (key === 'save') return () => { fonts.push(font); };
				if (key === 'restore') return () => { font = fonts.pop()!; };
				if (key === 'createLinearGradient') return () => ({ addColorStop: () => {} });
				return () => {};
			},
			set: (_o, key, value: unknown) => { if (key === 'font') font = String(value); return true; }
		}) as CanvasRenderingContext2D;
		const colors = { labelFontSize: 10, fontFamily: 'sans-serif' } as ThemeColors;
		GraphRenderer.renderEdges(ctx, colors, state);
		// Two labels measured once in the label font and once in the incoming clipping font.
		expect(measureText).toHaveBeenCalledTimes(4);
		expect(font).toBe('12px serif');
		colors.labelFontSize = 20;
		const tasks = GraphRenderer.renderEdges(ctx, colors, state);
		expect(measureText).toHaveBeenCalledTimes(8);
		expect(tasks[0].bgWidth).toBeGreaterThan(120);
	});
});

describe('RelationGraphView lifecycle & input narrowing', () => {
	let plugin: RelationGraphViewPlugin;
	let mockApp: {
		vault: {
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
		};
		metadataCache: {
			on: ReturnType<typeof vi.fn>;
		};
		workspace: {
			on: ReturnType<typeof vi.fn>;
		};
	};
	let metadataChangedCb: ((file: unknown) => void) | null = null;
	let loreUpdatedCb: (() => void) | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
		metadataChangedCb = null;
		loreUpdatedCb = null;

		mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn()
			},
			metadataCache: {
				on: vi.fn((event: string, cb: (file: unknown) => void) => {
					if (event === 'changed') metadataChangedCb = cb;
					return { id: 'meta-event' };
				})
			},
			workspace: {
				on: vi.fn((event: string, cb: () => void) => {
					if (event === 'webnovel-workbench-lore-updated') loreUpdatedCb = cb;
					return { id: 'ws-event' };
				})
			}
		};

		plugin = {
			characterManager: {
				ensureInitialized: vi.fn().mockResolvedValue(undefined),
				getBookPathForFile: vi.fn((file: { path: string }) => {
					if (file.path.startsWith('BookA/')) return 'BookA';
					if (file.path.startsWith('BookB/')) return 'BookB';
					return null;
				}),
				getCharacterFile: vi.fn(),
				isLorePath: vi.fn((bookPath: string, parentPath: string) => {
					return parentPath === `${bookPath}/设定` || parentPath.startsWith(`${bookPath}/设定/`);
				})
			} as never,
			relationGraphManager: {
				buildGraphData: vi.fn().mockResolvedValue({
					nodes: [
						{ id: 'Alice', heading: 'Alice', file: new MockTFile('Alice.md', 'BookA/设定/Alice.md', 'BookA/设定') }
					],
					edges: []
				})
			}
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('skips reload on same-book chapter edits while reloading on lore file edits', async () => {
		const displayedLore = new MockTFile('Alice.md', 'BookA/设定/Alice.md', 'BookA/设定');
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === displayedLore.path) return displayedLore;
			return null;
		});

		const mockLeaf = { app: mockApp };
		const view = new RelationGraphView(mockLeaf as never, plugin);

		await view.onOpen();
		await view.loadGraphForFile(displayedLore.path);

		const buildGraphSpy = vi.spyOn(plugin.relationGraphManager, 'buildGraphData');
		buildGraphSpy.mockClear();

		// 1. Edit a chapter in the same book (BookA/第1章.md)
		const chapterFile = new MockTFile('第1章.md', 'BookA/第1章.md', 'BookA');
		expect(metadataChangedCb).not.toBeNull();
		metadataChangedCb!(chapterFile);

		vi.advanceTimersByTime(1000);
		// Chapter edit must be skipped!
		expect(buildGraphSpy).not.toHaveBeenCalled();

		// 2. Edit a lore file in the same book (BookA/设定/Bob.md)
		const otherLoreFile = new MockTFile('Bob.md', 'BookA/设定/Bob.md', 'BookA/设定');
		metadataChangedCb!(otherLoreFile);

		vi.advanceTimersByTime(1000);
		// Lore file edit must trigger reload!
		expect(buildGraphSpy).toHaveBeenCalledTimes(1);
	});

	it('preserves reload when the displayed file itself is a non-lore file', async () => {
		const nonLoreFile = new MockTFile('Chapter1.md', 'BookA/Chapter1.md', 'BookA');
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === nonLoreFile.path) return nonLoreFile;
			return null;
		});

		const mockLeaf = { app: mockApp };
		const view = new RelationGraphView(mockLeaf as never, plugin);

		await view.onOpen();
		await view.loadGraphForFile(nonLoreFile.path);

		const buildGraphSpy = vi.spyOn(plugin.relationGraphManager, 'buildGraphData');
		buildGraphSpy.mockClear();

		// Editing the displayed non-lore file must reload
		metadataChangedCb!(nonLoreFile);
		vi.advanceTimersByTime(1000);
		expect(buildGraphSpy).toHaveBeenCalledTimes(1);
	});

	it('merges metadata and lore notifications through view debounce and cancels on close', async () => {
		const displayedLore = new MockTFile('Alice.md', 'BookA/设定/Alice.md', 'BookA/设定');
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === displayedLore.path) return displayedLore;
			return null;
		});

		const mockLeaf = { app: mockApp };
		const view = new RelationGraphView(mockLeaf as never, plugin);

		await view.onOpen();
		await view.loadGraphForFile(displayedLore.path);

		const buildGraphSpy = vi.spyOn(plugin.relationGraphManager, 'buildGraphData');
		buildGraphSpy.mockClear();

		// Rapidly trigger both metadata changed and lore updated
		metadataChangedCb!(displayedLore);
		loreUpdatedCb!();

		// Advance less than debounce duration (e.g. 200ms)
		vi.advanceTimersByTime(200);
		expect(buildGraphSpy).not.toHaveBeenCalled();

		// Close view before debounce finishes
		await view.onClose();
		vi.advanceTimersByTime(1000);

		// Must be cancelled on close
		expect(buildGraphSpy).not.toHaveBeenCalled();
	});

	it('coalesces refresh requests while a graph build is still pending', async () => {
		const file = new MockTFile('Alice.md', 'BookA/设定/Alice.md', 'BookA/设定');
		mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
		const view = new RelationGraphView({ app: mockApp } as never, plugin);
		await view.onOpen();
		await view.loadGraphForFile(file.path);
		let resolve!: (data: { nodes: []; edges: [] }) => void;
		const pending = new Promise<{ nodes: []; edges: [] }>(done => { resolve = done; });
		const build = vi.mocked(plugin.relationGraphManager.buildGraphData);
		build.mockClear();
		build.mockImplementationOnce(() => pending).mockResolvedValue({ nodes: [], edges: [] });
		const first = view['softReloadGraph']();
		const second = view['softReloadGraph']();
		expect(build).toHaveBeenCalledOnce();
		resolve({ nodes: [], edges: [] });
		await Promise.all([first, second]);
		expect(build).toHaveBeenCalledTimes(2);
		await view.onClose();
	});

	it('avoids stale graph result after switching file input during pending load', async () => {
		const fileA = new MockTFile('Alice.md', 'BookA/设定/Alice.md', 'BookA/设定');
		const fileB = new MockTFile('Bob.md', 'BookA/设定/Bob.md', 'BookA/设定');

		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === fileA.path) return fileA;
			if (path === fileB.path) return fileB;
			return null;
		});

		let resolveA!: (data: unknown) => void;
		const slowPromiseA = new Promise(resolve => { resolveA = resolve; });

		plugin.relationGraphManager.buildGraphData = vi.fn().mockImplementation((file: { path: string }) => {
			if (file.path === fileA.path) return slowPromiseA;
			return Promise.resolve({
				nodes: [{ id: 'Bob', heading: 'Bob', file: fileB }],
				edges: []
			});
		});

		const mockLeaf = { app: mockApp };
		const view = new RelationGraphView(mockLeaf as never, plugin);
		await view.onOpen();

		// Start loading fileA (which is slow)
		const loadAPromise = view.loadGraphForFile(fileA.path);
		await Promise.resolve();
		expect(plugin.relationGraphManager.buildGraphData).toHaveBeenCalledWith(fileA);

		// Switch to fileB immediately
		await view.loadGraphForFile(fileB.path);
		expect(view.getState().filePath).toBe(fileB.path);

		// Now fileA finally resolves
		resolveA({
			nodes: [{ id: 'Alice', heading: 'Alice', file: fileA }],
			edges: []
		});
		await loadAPromise;

		// Stale data for fileA must not overwrite fileB!
		expect((view as unknown as { graphData: { nodes: Array<{ id: string }> } }).graphData.nodes[0].id).toBe('Bob');
	});
});
