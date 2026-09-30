import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockElement } from './mocks/MockElement';
import { RelationGraphView, type RelationGraphViewPlugin } from '../src/ui/RelationGraphView';

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
