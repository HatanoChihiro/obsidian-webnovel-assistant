import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockElement } from './mocks/MockElement';
import { RelationGraphView, type RelationGraphViewPlugin } from '../src/ui/RelationGraphView';
import type { GraphData, GraphNode } from '../src/services/RelationGraphManager';
import { GraphRenderer, type GraphRenderState, type ThemeColors } from '../src/ui/components/GraphRenderer';
import { LoreCardRenderer } from '../src/ui/components/LoreCardRenderer';
import { LoreHoverPopover } from '../src/ui/LoreHoverPopover';

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

	class MockComponent {
		private loaded = false;
		load(): void { this.loaded = true; }
		unload(): void {
			if (!this.loaded) return;
			this.loaded = false;
			this.onunload();
		}
		onunload(): void {}
		register(_cb: () => void): void {}
		registerEvent(): void {}
	}

	return {
		ItemView: MockItemView,
		Component: MockComponent,
		Modal: class {
			modalEl = new MockElement('modal');
			contentEl = new MockElement('modal-content');
			open(): void {}
			close(): void {}
		},
		Setting: class {
			setName() { return this; }
			setHeading() { return this; }
		},
		MarkdownRenderer: { render: vi.fn() },
		Platform: { isMobile: false },
		TFile: MockTFile,
		Notice: class {},
		setIcon: vi.fn(),
		setTooltip: vi.fn()
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

const capturedGraphCallbacks: Array<Record<string, (...args: unknown[]) => unknown>> = [];

vi.mock('../src/ui/components/GraphInteractionController', () => ({
	GraphInteractionController: class {
		constructor(_canvas: unknown, _state: unknown, callbacks: Record<string, (...args: unknown[]) => unknown>) {
			capturedGraphCallbacks.push(callbacks);
		}
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

	it('keeps node coordinates, identity, viewport, selection, and converged physics stable across edge additions, label edits, and equivalent reloads', async () => {
		const loreFile = new MockTFile('Cast.md', 'BookA/设定/Cast.md', 'BookA/设定');
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => (path === loreFile.path ? loreFile : null));

		const makeGraph = (edges: GraphData['edges']): GraphData => ({
			nodes: [
				{ id: 'NodeA', heading: 'NodeA', file: loreFile as never, sourcePath: loreFile.path, x: 0, y: 0, vx: 0, vy: 0, pinned: false },
				{ id: 'NodeB', heading: 'NodeB', file: loreFile as never, sourcePath: loreFile.path, x: 0, y: 0, vx: 0, vy: 0, pinned: false }
			],
			edges
		});

		let currentResult: GraphData = makeGraph([
			{ source: 'NodeA', target: 'NodeB', label: 'Ally', type: 'explicit' }
		]);
		plugin.relationGraphManager.buildGraphData = vi.fn(async () => currentResult);

		const view = new RelationGraphView({ app: mockApp } as never, plugin);
		await view.onOpen();
		await view.loadGraphForFile(loreFile.path);

		// Flush initial rAF
		vi.advanceTimersByTime(20);

		const internal = view as unknown as {
			graphData: GraphData;
			renderState: GraphRenderState;
			engine: { updateData: ReturnType<typeof vi.fn>; reheat: ReturnType<typeof vi.fn>; tick: ReturnType<typeof vi.fn> };
			softReloadGraph: () => Promise<void>;
		};

		// Set deterministic converged coordinates, pinned state, viewport pan/zoom, and selection
		const origNodeA = internal.graphData.nodes[0];
		const origNodeB = internal.graphData.nodes[1];
		origNodeA.x = 180;
		origNodeA.y = 210;
		origNodeA.pinned = true;
		origNodeB.x = 340;
		origNodeB.y = 290;
		internal.renderState.scale = 1.75;
		internal.renderState.panX = 42;
		internal.renderState.panY = -18;
		internal.renderState.selectedNode = origNodeA;
		internal.engine.tick.mockReturnValue(false);

		const buildEdgeOffsetsSpy = vi.mocked(GraphRenderer.buildEdgeOffsets);
		const renderSpy = vi.mocked(GraphRenderer.render);
		buildEdgeOffsetsSpy.mockClear();
		renderSpy.mockClear();
		internal.engine.updateData.mockClear();
		internal.engine.reheat.mockClear();

		// 1. Equivalent reload: must be a complete no-op (no edge rebuild, no physics update, no reheat, no repaint)
		currentResult = makeGraph([
			{ source: 'NodeA', target: 'NodeB', label: 'Ally', type: 'explicit' }
		]);
		await internal.softReloadGraph();
		vi.advanceTimersByTime(20);

		expect(internal.graphData.nodes[0]).toBe(origNodeA);
		expect(internal.graphData.nodes[1]).toBe(origNodeB);
		expect(origNodeA.x).toBe(180);
		expect(origNodeA.y).toBe(210);
		expect(origNodeB.x).toBe(340);
		expect(origNodeB.y).toBe(290);
		expect(internal.engine.reheat).not.toHaveBeenCalled();
		expect(internal.engine.updateData).not.toHaveBeenCalled();
		expect(buildEdgeOffsetsSpy).not.toHaveBeenCalled();
		expect(renderSpy).not.toHaveBeenCalled();

		// 2. Label-only edit: rebuilds edge offsets with force=true and repaints without reheating or physics update
		currentResult = makeGraph([
			{ source: 'NodeA', target: 'NodeB', label: 'Mentor', type: 'explicit' }
		]);
		await internal.softReloadGraph();
		vi.advanceTimersByTime(20);

		expect(internal.graphData.nodes[0]).toBe(origNodeA);
		expect(origNodeA.x).toBe(180);
		expect(origNodeA.y).toBe(210);
		expect(origNodeA.pinned).toBe(true);
		expect(origNodeB.x).toBe(340);
		expect(origNodeB.y).toBe(290);
		expect(internal.renderState.scale).toBe(1.75);
		expect(internal.renderState.panX).toBe(42);
		expect(internal.renderState.panY).toBe(-18);
		expect(internal.renderState.selectedNode).toBe(origNodeA);
		expect(internal.engine.reheat).not.toHaveBeenCalled();
		expect(internal.engine.updateData).not.toHaveBeenCalled();
		expect(buildEdgeOffsetsSpy).toHaveBeenCalledWith(internal.graphData, internal.renderState, undefined, true);
		expect(renderSpy).toHaveBeenCalled();

		// 3. Adding a reverse edge between existing nodes: updates dormant engine without reheat, preserves coordinates
		buildEdgeOffsetsSpy.mockClear();
		renderSpy.mockClear();
		internal.engine.updateData.mockClear();
		internal.engine.reheat.mockClear();
		currentResult = makeGraph([
			{ source: 'NodeA', target: 'NodeB', label: 'Mentor', type: 'explicit' },
			{ source: 'NodeB', target: 'NodeA', label: 'Rival', type: 'explicit' }
		]);
		await internal.softReloadGraph();
		vi.advanceTimersByTime(20);

		expect(internal.graphData.nodes[0]).toBe(origNodeA);
		expect(internal.graphData.nodes[1]).toBe(origNodeB);
		expect(origNodeA.x).toBe(180);
		expect(origNodeA.y).toBe(210);
		expect(origNodeB.x).toBe(340);
		expect(origNodeB.y).toBe(290);
		expect(internal.engine.updateData).toHaveBeenCalledTimes(1);
		expect(internal.engine.reheat).not.toHaveBeenCalled();
		expect(buildEdgeOffsetsSpy).toHaveBeenCalledWith(internal.graphData, internal.renderState, undefined, true);
		expect(renderSpy).toHaveBeenCalled();

		// 4. Genuine new node receives initial position while retained nodes preserve coordinates, and removed selection clears
		internal.engine.updateData.mockClear();
		internal.engine.reheat.mockClear();
		internal.renderState.selectedNode = origNodeB;
		currentResult = {
			nodes: [
				{ id: 'NodeA', heading: 'NodeA', file: loreFile as never, sourcePath: loreFile.path, x: 0, y: 0, vx: 0, vy: 0, pinned: false },
				{ id: 'NodeC', heading: 'NodeC', file: loreFile as never, sourcePath: loreFile.path, x: 0, y: 0, vx: 0, vy: 0, pinned: false }
			],
			edges: [{ source: 'NodeA', target: 'NodeC', label: 'Friend', type: 'explicit' }]
		};
		await internal.softReloadGraph();

		expect(internal.graphData.nodes).toHaveLength(2);
		expect(internal.graphData.nodes[0]).toBe(origNodeA);
		expect(origNodeA.x).toBe(180);
		expect(origNodeA.y).toBe(210);
		expect(internal.graphData.nodes[1].id).toBe('NodeC');
		expect(internal.graphData.nodes[1].x !== 0 || internal.graphData.nodes[1].y !== 0).toBe(true);
		expect(internal.renderState.selectedNode).toBeNull();
		expect(internal.engine.updateData).toHaveBeenCalledTimes(1);
		expect(internal.engine.reheat).not.toHaveBeenCalled();

		await view.onClose();
	});

	it('restores canvas visibility and clears empty message when standalone graph recovers from empty state', async () => {
		const loreFile = new MockTFile('Cast.md', 'BookA/设定/Cast.md', 'BookA/设定');
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => (path === loreFile.path ? loreFile : null));

		let currentResult: GraphData = {
			nodes: [{ id: 'NodeA', heading: 'NodeA', file: loreFile as never, sourcePath: loreFile.path, x: 0, y: 0, vx: 0, vy: 0, pinned: false }],
			edges: []
		};
		plugin.relationGraphManager.buildGraphData = vi.fn(async () => currentResult);

		const view = new RelationGraphView({ app: mockApp } as never, plugin);
		await view.onOpen();
		await view.loadGraphForFile(loreFile.path);

		// Transition to empty
		currentResult = { nodes: [], edges: [] };
		await view['softReloadGraph']();
		const canvas = view['canvas'] as unknown as { hidden?: boolean };
		expect(canvas.hidden).toBe(true);
		expect(view.contentEl.querySelector('.wna-relation-graph-empty')).not.toBeNull();

		// Recover with restored data
		currentResult = {
			nodes: [{ id: 'NodeA', heading: 'NodeA', file: loreFile as never, sourcePath: loreFile.path, x: 0, y: 0, vx: 0, vy: 0, pinned: false }],
			edges: []
		};
		await view['softReloadGraph']();
		expect(canvas.hidden).toBe(false);
		expect(view.contentEl.querySelector('.wna-relation-graph-empty')).toBeNull();

		await view.onClose();
	});
});

describe('RelationGraphView hover previews', () => {
	let ownerWindow: Window & EventTarget;
	let ownerDocument: Document & { visibilityState: string };
	let bodyEl: MockElement;
	let buildCardSpy: ReturnType<typeof vi.spyOn>;
	let originalCreateDiv: typeof MockElement.prototype.createDiv;
	let originalCreateEl: typeof MockElement.prototype.createEl;

	function setupHostDom() {
		bodyEl = new MockElement('body');
		ownerWindow = Object.assign(new EventTarget(), {
			setTimeout: (cb: () => void, ms?: number) => globalThis.setTimeout(cb, ms) as unknown as number,
			clearTimeout: (id: number) => globalThis.clearTimeout(id),
			requestAnimationFrame: (cb: () => void) => globalThis.setTimeout(cb, 0) as unknown as number,
			cancelAnimationFrame: (id: number) => globalThis.clearTimeout(id),
			innerWidth: 1200,
			innerHeight: 800
		}) as unknown as Window & EventTarget;

		ownerDocument = Object.assign(new EventTarget(), {
			defaultView: ownerWindow,
			visibilityState: 'visible',
			body: bodyEl,
			addEventListener: EventTarget.prototype.addEventListener,
			removeEventListener: EventTarget.prototype.removeEventListener
		}) as unknown as Document & { visibilityState: string };

		(bodyEl as unknown as { ownerDocument: Document }).ownerDocument = ownerDocument;
		(MockElement.prototype as unknown as { setCssStyles?: (s: Record<string, string>) => void }).setCssStyles = vi.fn();
		(MockElement.prototype as unknown as { matches?: (s: string) => boolean }).matches = () => false;

		originalCreateDiv = MockElement.prototype.createDiv;
		originalCreateEl = MockElement.prototype.createEl;
		MockElement.prototype.createDiv = function (this: MockElement, opts?: string | { cls?: string; text?: string }) {
			const child = originalCreateDiv.call(this, opts);
			(child as unknown as { ownerDocument: Document }).ownerDocument =
				(this as unknown as { ownerDocument?: Document }).ownerDocument ?? ownerDocument;
			return child;
		};
		MockElement.prototype.createEl = function (this: MockElement, tag: string, opts?: { cls?: string; text?: string; type?: string; value?: string }) {
			const child = originalCreateEl.call(this, tag, opts);
			(child as unknown as { ownerDocument: Document }).ownerDocument =
				(this as unknown as { ownerDocument?: Document }).ownerDocument ?? ownerDocument;
			return child;
		};
	}

	beforeEach(() => {
		vi.useFakeTimers();
		capturedGraphCallbacks.length = 0;
		setupHostDom();
		vi.stubGlobal('MutationObserver', class {
			observe = vi.fn();
			disconnect = vi.fn();
		});
		buildCardSpy = vi.spyOn(LoreCardRenderer, 'buildCardDOM').mockResolvedValue(undefined);
	});

	afterEach(() => {
		LoreHoverPopover.closeAll();
		buildCardSpy.mockRestore();
		MockElement.prototype.createDiv = originalCreateDiv;
		MockElement.prototype.createEl = originalCreateEl;
		delete (MockElement.prototype as unknown as { setCssStyles?: unknown }).setCssStyles;
		delete (MockElement.prototype as unknown as { matches?: unknown }).matches;
		vi.useRealTimers();
		vi.unstubAllGlobals();
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
	});

	function createGraphTestFixture(overrides?: {
		enableLorePopover?: boolean;
		isBorrowed?: boolean;
		sameNameWrongFile?: InstanceType<typeof MockTFile>;
	}) {
		const nodeFile = new MockTFile('CastA.md', 'FictionA/Lore/CastA.md', 'FictionA/Lore');
		const secondFile = new MockTFile('CastB.md', 'FictionA/Lore/CastB.md', 'FictionA/Lore');
		const nodeA: GraphNode = {
			id: 'Rowan',
			heading: 'Rowan',
			file: nodeFile as unknown as import('obsidian').TFile,
			sourcePath: nodeFile.path,
			x: 200,
			y: 200,
			vx: 0,
			vy: 0,
			pinned: false
		};
		const nodeB: GraphNode = {
			id: 'Briar',
			heading: 'Briar',
			file: secondFile as unknown as import('obsidian').TFile,
			sourcePath: secondFile.path,
			x: 350,
			y: 260,
			vx: 0,
			vy: 0,
			pinned: false
		};

		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === nodeFile.path) return nodeFile;
					if (path === secondFile.path) return secondFile;
					return null;
				})
			},
			metadataCache: { on: vi.fn(() => ({ id: 'meta' })) },
			workspace: { on: vi.fn(() => ({ id: 'ws' })) }
		};

		const plugin = {
			app: mockApp,
			settings: {
				enableLorePopover: overrides?.enableLorePopover ?? true,
				enableMobileLorePopover: false,
				lorePopoverCollapse: false
			},
			characterManager: {
				ensureInitialized: vi.fn().mockResolvedValue(undefined),
				getBookPathForFile: vi.fn(() => 'FictionA'),
				getCharacterFile: vi.fn((_book: string, name: string) => {
					if (name === 'Rowan' && overrides?.sameNameWrongFile) {
						return { file: overrides.sameNameWrongFile, heading: 'Rowan' };
					}
					return null;
				}),
				getLoreEntriesInFileOrder: vi.fn(() => []),
				isLorePath: vi.fn(() => true),
				isBorrowedLoreEntry: vi.fn(() => overrides?.isBorrowed ?? false),
				updateLoreEntry: vi.fn()
			},
			relationGraphManager: {
				buildGraphData: vi.fn().mockResolvedValue({
					nodes: [nodeA, nodeB],
					edges: []
				})
			}
		} as unknown as RelationGraphViewPlugin;

		const view = new RelationGraphView({ app: mockApp } as never, plugin);
		(view.containerEl as unknown as { ownerDocument: Document }).ownerDocument = ownerDocument;
		(view.contentEl as unknown as { ownerDocument: Document }).ownerDocument = ownerDocument;
		return { view, plugin, mockApp, nodeA, nodeB, nodeFile, secondFile };
	}

	it('opens one lore card after 1000ms using real node file+heading identity, ignores repeated mousemove, and allows pointer entry into card', async () => {
		const wrongFile = new MockTFile('Other.md', 'FictionA/Lore/Other.md', 'FictionA/Lore');
		const { view, nodeA, nodeFile } = createGraphTestFixture({ sameNameWrongFile: wrongFile });

		await view.onOpen();
		await view.loadGraphForFile(nodeFile.path);

		const callbacks = capturedGraphCallbacks[capturedGraphCallbacks.length - 1];
		expect(callbacks).toBeDefined();

		// Hover nodeA -> repeated mousemove at 600ms must NOT restart the 1000ms timer
		callbacks.onNodeHover(nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(600);
		callbacks.onNodeHover(nodeA, { clientX: 202, clientY: 201 });
		vi.advanceTimersByTime(399);
		expect(buildCardSpy).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		await Promise.resolve();
		await Promise.resolve();

		expect(buildCardSpy).toHaveBeenCalledTimes(1);
		const passedEntry = buildCardSpy.mock.calls[0][1] as { file: { path: string }; heading: string };
		expect(passedEntry.file.path).toBe(nodeFile.path);
		expect(passedEntry.heading).toBe('Rowan');
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(1);

		// Moving pointer away onto empty canvas triggers 200ms grace; entering card keeps it open
		callbacks.onNodeHover(null, { clientX: 220, clientY: 220 });
		const popoverEl = bodyEl.querySelector('.wn-lore-hover-popover')!;
		popoverEl.dispatchEvent('mouseenter');
		vi.advanceTimersByTime(300);
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(1);

		await view.onClose();
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(0);
	});

	it('cancels stale previews and late async reattachment on node change, interaction, mouseleave, hidden view, reload, and close', async () => {
		const { view, nodeA, nodeB, nodeFile } = createGraphTestFixture();
		await view.onOpen();
		await view.loadGraphForFile(nodeFile.path);
		const callbacks = capturedGraphCallbacks[capturedGraphCallbacks.length - 1];

		// 1. Moving away before 1000ms cancels pending timer
		callbacks.onNodeHover(nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(500);
		callbacks.onNodeHover(null, { clientX: 50, clientY: 50 });
		vi.advanceTimersByTime(1000);
		expect(buildCardSpy).not.toHaveBeenCalled();

		// 2. Changing nodes cancels previous pending preview
		callbacks.onNodeHover(nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(700);
		callbacks.onNodeHover(nodeB, { clientX: 350, clientY: 260 });
		vi.advanceTimersByTime(400);
		expect(buildCardSpy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(600);
		await Promise.resolve();
		await Promise.resolve();
		expect(buildCardSpy).toHaveBeenCalledTimes(1);
		expect((buildCardSpy.mock.calls[0][1] as { heading: string }).heading).toBe('Briar');

		// 3. Viewport interaction (drag/pan/zoom) cancels active preview
		callbacks.onViewportInteraction();
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(0);

		// 4. Canvas mouseleave clears pending timer
		buildCardSpy.mockClear();
		callbacks.onNodeHover(nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(500);
		callbacks.onCanvasMouseLeave({ relatedTarget: null });
		vi.advanceTimersByTime(1000);
		expect(buildCardSpy).not.toHaveBeenCalled();

		// 5. Hidden view clears active/pending preview
		callbacks.onNodeHover(nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(1000);
		await Promise.resolve();
		await Promise.resolve();
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(1);
		ownerDocument.visibilityState = 'hidden';
		ownerDocument.dispatchEvent(new Event('visibilitychange'));
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(0);

		// 6. Late async buildCardDOM resolution after onClose must not attach card or leave anchor
		ownerDocument.visibilityState = 'visible';
		ownerDocument.dispatchEvent(new Event('visibilitychange'));
		let resolveBuild!: () => void;
		buildCardSpy.mockImplementationOnce(() => new Promise<void>(resolve => { resolveBuild = resolve; }));
		callbacks.onNodeHover(nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(1000);
		await view.onClose();
		resolveBuild();
		await Promise.resolve();
		await Promise.resolve();
		expect(bodyEl.querySelectorAll('.wn-lore-hover-popover')).toHaveLength(0);
		expect(view.contentEl.querySelectorAll('.wn-graph-hover-anchor')).toHaveLength(0);
	});

	it('respects enableLorePopover=false and hides edit button for borrowed entries', async () => {
		const disabledFixture = createGraphTestFixture({ enableLorePopover: false });
		await disabledFixture.view.onOpen();
		await disabledFixture.view.loadGraphForFile(disabledFixture.nodeFile.path);
		const disabledCb = capturedGraphCallbacks[capturedGraphCallbacks.length - 1];
		disabledCb.onNodeHover(disabledFixture.nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(1200);
		expect(buildCardSpy).not.toHaveBeenCalled();
		await disabledFixture.view.onClose();

		const borrowedFixture = createGraphTestFixture({ enableLorePopover: true, isBorrowed: true });
		await borrowedFixture.view.onOpen();
		await borrowedFixture.view.loadGraphForFile(borrowedFixture.nodeFile.path);
		const borrowedCb = capturedGraphCallbacks[capturedGraphCallbacks.length - 1];
		borrowedCb.onNodeHover(borrowedFixture.nodeA, { clientX: 200, clientY: 200 });
		vi.advanceTimersByTime(1000);
		await Promise.resolve();
		await Promise.resolve();
		expect(buildCardSpy).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ heading: 'Rowan' }),
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ hideEditButton: true })
		);
		await borrowedFixture.view.onClose();
	});
});
