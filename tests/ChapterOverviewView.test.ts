import { MockElement } from './mocks/MockElement';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterOverviewView, CORKBOARD_VIEW_TYPE, type ChapterOverviewViewPlugin } from '../src/ui/ChapterOverviewView';
import { CorkboardGridRenderer } from '../src/ui/components/CorkboardGridRenderer';
import { AdaptiveDebounceManager } from '../src/services/AdaptiveDebounceManager';
import type { TFile } from 'obsidian';

const { getCurrentBookContextMock, findBookRootMock, MockTFile, MockTFolder } = vi.hoisted(() => {
	class HoistedMockTFile {
		extension = 'md';
		basename: string;
		stat = { mtime: 1 };

		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	class HoistedMockTFolder {
		children: Array<HoistedMockTFile | HoistedMockTFolder> = [];

		constructor(public name: string, public path: string) {}
	}

	return {
		getCurrentBookContextMock: vi.fn(),
		findBookRootMock: vi.fn(),
		MockTFile: HoistedMockTFile,
		MockTFolder: HoistedMockTFolder
	};
});
type MockTFileInstance = InstanceType<typeof MockTFile>;
type MockTFolderInstance = InstanceType<typeof MockTFolder>;



// Attach global helpers expected by Obsidian runtime
(globalThis as unknown as { createDiv: (opts?: unknown) => MockElement }).createDiv = function(opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
	if (typeof opts === 'object' && opts !== null && 'text' in opts) {
		el.textContent = (opts as { text: string }).text;
	}
	return el;
};

vi.stubGlobal('window', {
	createDiv: () => new MockElement(''),
	createFragment: () => {
		const frag = new MockElement('');
		frag.isFragment = true;
		return frag;
	},
	requestAnimationFrame: (cb: (time: number) => void) => {
		cb(Date.now());
		return 0;
	},
	setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
	clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args)
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
			const mockDoc = {
				createElement: vi.fn((tag: string) => new MockElement(tag === 'div' ? '' : tag)),
				createDocumentFragment: vi.fn(() => {
					const frag = new MockElement('');
					frag.isFragment = true;
					return frag;
				}),
				win: window,
				defaultView: window
			} as unknown as Document;
			(this.containerEl as unknown as { ownerDocument: Document }).ownerDocument = mockDoc;
			(this.contentEl as unknown as { ownerDocument: Document }).ownerDocument = mockDoc;
			this.containerEl.children.push(this.contentEl);
			this.contentEl.parentElement = this.containerEl;
		}

		registerEvent(): void {}
	}

	return {
		ItemView: MockItemView,
		TFile: MockTFile,
		TFolder: MockTFolder,
		Vault: {
			recurseChildren: (folder: MockTFolderInstance, fn: (child: MockTFileInstance | MockTFolderInstance) => void) => {
				const walk = (f: MockTFolderInstance) => {
					for (const child of f.children) {
						fn(child);
						if (child instanceof MockTFolder) {
							walk(child);
						}
					}
				};
				walk(folder);
			}
		},
		setIcon: vi.fn()
	};
});

vi.mock('../src/utils/path', () => ({
	getCurrentBookContext: getCurrentBookContextMock,
	findBookRoot: findBookRootMock
}));

vi.mock('../src/ui/components/CorkboardGridRenderer', () => ({
	CorkboardGridRenderer: {
		render: vi.fn()
	}
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

interface ChapterOverviewHarness {
	isDescending: boolean;
	chapterFilterQuery: string;
	pendingFilterFocus: { start: number; end: number } | null;
	currentRenderId: number;
	filterDebounceTimer: { win: Window; id: number } | null;
	filterIndex: {
		filterChapters: (files: readonly TFile[], query: string, getSynopsis: (file: TFile) => unknown) => Promise<TFile[]>;
	};
	scheduleFilterRefresh(input: { value: string; selectionStart?: number; selectionEnd?: number }, immediate?: boolean): void;
}

describe('ChapterOverviewView', () => {
	it('clears search scope only when switching works', () => {
		const view = new ChapterOverviewView(mockLeaf as never, plugin);
		vi.spyOn(view, 'reloadBoard').mockResolvedValue();
		const clear = vi.spyOn(view['filterIndex'], 'clear');
		view.setBookPath('NovelA');
		clear.mockClear();
		view.setBookPath('NovelB');
		expect(clear).toHaveBeenCalledOnce();
		view.setBookPath('NovelB');
		expect(clear).toHaveBeenCalledOnce();
	});
	let plugin: ChapterOverviewViewPlugin;
	let mockApp: {
		vault: {
			on: ReturnType<typeof vi.fn>;
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
			cachedRead: ReturnType<typeof vi.fn>;
		};
		metadataCache: {
			on: ReturnType<typeof vi.fn>;
			getFileCache: ReturnType<typeof vi.fn>;
		};
		workspace: {
			on: ReturnType<typeof vi.fn>;
			getActiveFile: ReturnType<typeof vi.fn>;
		};
	};
	let mockLeaf: { app: unknown };
	let file1: MockTFileInstance;
	let file2: MockTFileInstance;
	let file3: MockTFileInstance;
	let bookFolder: MockTFolderInstance;

	beforeEach(() => {
		vi.clearAllMocks();

		file1 = new MockTFile('第1章 起源.md', 'NovelA/第1章 起源.md');
		file2 = new MockTFile('第2章 探索.md', 'NovelA/第2章 探索.md');
		file3 = new MockTFile('第3章 终局.md', 'NovelA/第3章 终局.md');

		bookFolder = new MockTFolder('NovelA', 'NovelA');
		bookFolder.children = [file1, file2, file3];

		mockApp = {
			vault: {
				on: vi.fn(),
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === 'NovelA') return bookFolder;
					return null;
				}),
				cachedRead: vi.fn(async (file: MockTFileInstance) => {
					if (file.path.includes('第1章')) return '主角在地下室发现了线索。';
					if (file.path.includes('第2章')) return '他在图书馆查阅资料。';
					if (file.path.includes('第3章')) return '决战时刻到来。';
					return '';
				})
			},
			metadataCache: {
				on: vi.fn(),
				getFileCache: vi.fn((file: MockTFileInstance) => ({
					frontmatter: {
						synopsis: file.path.includes('第1章') ? '初次探险' : ''
					}
				}))
			},
			workspace: {
				on: vi.fn(),
				getActiveFile: vi.fn().mockReturnValue(null)
			}
		};

		mockLeaf = {
			app: mockApp
		};

		plugin = {
			settings: {
				enableStrictChapterMode: false,
				loreFolderName: '设定',
				enableSmartChapterSort: true,
				customSortOrder: {}
			},
			cacheManager: {
				isFileInWorkspace: vi.fn().mockReturnValue(true),
				isEligibleForChapterList: vi.fn().mockReturnValue(true),
				getFileCache: vi.fn()
			},
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((_key: string, fn: () => void) => { fn(); }),
				cancel: vi.fn()
			},
			homepageManager: {
				getHomepageFilePath: vi.fn().mockReturnValue(null),
				getNovelFolders: vi.fn().mockReturnValue([])
			},
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([file1, file2, file3] as unknown as TFile[]),
			isFileInStrictChapterException: vi.fn().mockReturnValue(false)
		} as unknown as ChapterOverviewViewPlugin;
	});

	it('should return correct view type, display text, and icon', () => {
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		expect(view.getViewType()).toBe(CORKBOARD_VIEW_TYPE);
		expect(view.getDisplayText()).toBe('view.chapter-overview');
		expect(view.getIcon()).toBe('library');
	});

	it('should render chapter cards in ascending order by default with draggable: false', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);

		await view.onOpen();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [file1, file2, file3],
				draggable: false,
				currentBookPath: 'NovelA'
			})
		);
	});

	it('should render chapter cards in descending order when isDescending is true without modifying base array', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();

		const harness = view as unknown as ChapterOverviewHarness;
		harness.isDescending = true;
		await view.reloadBoard();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [file3, file2, file1],
				draggable: false,
				currentBookPath: 'NovelA'
			})
		);

		// Base children in folder remains in canonical order
		expect(bookFolder.children).toEqual([file1, file2, file3]);
	});

	it('should filter chapters across title, synopsis, and body while preserving order', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();

		const harness = view as unknown as ChapterOverviewHarness;
		harness.chapterFilterQuery = '地下室';
		await view.reloadBoard();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [file1],
				draggable: false
			})
		);
	});

	it('should display empty message on no filter results, retain filter bar, and restore focus/caret', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();

		const harness = view as unknown as ChapterOverviewHarness;
		const mockInput = {
			value: '不存在的章节关键词',
			selectionStart: 5,
			selectionEnd: 5
		};

		harness.scheduleFilterRefresh(mockInput, true);
		if (harness.filterDebounceTimer !== null) {
			harness.filterDebounceTimer.win.clearTimeout(harness.filterDebounceTimer.id);
			harness.filterDebounceTimer = null;
		}
		await view.reloadBoard();

		expect(CorkboardGridRenderer.render).not.toHaveBeenCalled();
		expect(view.contentEl.querySelector('.wn-corkboard-empty-msg')).not.toBeNull();

		const renderedInput = view.contentEl.querySelector<HTMLInputElement>('.wn-workbench-filter-input');
		expect(renderedInput).not.toBeNull();
		expect(renderedInput?.value).toBe('不存在的章节关键词');
		expect(renderedInput?.focus).toHaveBeenCalled();
		expect(renderedInput?.setSelectionRange).toHaveBeenCalledWith(5, 5);
	});

	it('should protect against stale async renders when query changes rapidly', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();

		let resolveFirstQuery: (value: unknown) => void = () => {};
		const firstQueryPromise = new Promise(resolve => { resolveFirstQuery = resolve; });

		const harness = view as unknown as ChapterOverviewHarness;
		vi.spyOn(harness.filterIndex, 'filterChapters').mockImplementationOnce(() => firstQueryPromise as Promise<TFile[]>);

		harness.chapterFilterQuery = 'slow';
		const slowRenderPromise = view.reloadBoard();

		harness.chapterFilterQuery = '地下室';
		harness.currentRenderId++;
		const fastRenderPromise = view.reloadBoard();

		await fastRenderPromise;
		expect(CorkboardGridRenderer.render).toHaveBeenCalledTimes(1);

		resolveFirstQuery([file1]);
		await slowRenderPromise;

		expect(CorkboardGridRenderer.render).toHaveBeenCalledTimes(1);
	});

	it('should maintain canonical volume order when toggling ascending -> descending -> ascending with volume folders', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const vol1 = new MockTFolder('第一卷', 'NovelA/第一卷');
		const vol2 = new MockTFolder('第二卷', 'NovelA/第二卷');
		const vol3 = new MockTFolder('第三卷', 'NovelA/第三卷');

		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = new MockTFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = new MockTFile('第1章.md', 'NovelA/第二卷/第1章.md');
		const v2c2 = new MockTFile('第2章.md', 'NovelA/第二卷/第2章.md');
		const v3c1 = new MockTFile('第1章.md', 'NovelA/第三卷/第1章.md');
		const v3c2 = new MockTFile('第2章.md', 'NovelA/第三卷/第2章.md');

		vol1.children = [v1c1, v1c2];
		vol2.children = [v2c1, v2c2];
		vol3.children = [v3c1, v3c2];
		bookFolder.children = [vol1, vol2, vol3];

		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		// 1. Initial Ascending
		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v1c1, v1c2, v2c1, v2c2, v3c1, v3c2],
				draggable: false,
				currentBookPath: 'NovelA'
			})
		);

		// 2. Toggle to Descending
		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		const harness = view as unknown as ChapterOverviewHarness;
		harness.isDescending = true;
		await view.reloadBoard();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v3c2, v3c1, v2c2, v2c1, v1c2, v1c1],
				draggable: false,
				currentBookPath: 'NovelA'
			})
		);

		// 3. Toggle back to Ascending
		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		harness.isDescending = false;
		await view.reloadBoard();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v1c1, v1c2, v2c1, v2c2, v3c1, v3c2],
				draggable: false,
				currentBookPath: 'NovelA'
			})
		);
	});

	it('should debounce vault rename and delete events and cancel debounce on close', async () => {
		const vaultHandlers: Record<string, ((...args: unknown[]) => void)> = {};
		const metadataHandlers: Record<string, ((...args: unknown[]) => void)> = {};

		mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			vaultHandlers[event] = handler;
		});
		mockApp.metadataCache.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			metadataHandlers[event] = handler;
		});

		const cancelSpy = vi.fn();
		const debounceSpy = vi.fn();
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: cancelSpy
		};

		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		expect(vaultHandlers['rename']).toBeDefined();
		expect(vaultHandlers['delete']).toBeDefined();
		expect(metadataHandlers['changed']).toBeDefined();

		const refreshKey = (view as unknown as { refreshDebounceKey: string }).refreshDebounceKey;

		// Trigger rename
		vaultHandlers['rename'](file2, 'NovelA/old.md');
		expect(debounceSpy).toHaveBeenCalledWith(refreshKey, expect.any(Function), 500, expect.anything());

		// Trigger delete
		debounceSpy.mockClear();
		vaultHandlers['delete'](file2);
		expect(debounceSpy).toHaveBeenCalledWith(refreshKey, expect.any(Function), 500, expect.anything());

		// Trigger metadataCache changed
		debounceSpy.mockClear();
		metadataHandlers['changed'](file1);
		expect(debounceSpy).toHaveBeenCalledWith(refreshKey, expect.any(Function), 1000, expect.anything());

		// Close view
		await view.onClose();
		expect(cancelSpy).toHaveBeenCalledWith(refreshKey);
	});

	it('closing one view does not cancel refresh debounce of another view sharing AdaptiveDebounceManager', async () => {
		const realDebounceManager = new AdaptiveDebounceManager();
		plugin.adaptiveDebounceManager = realDebounceManager;

		const vaultListeners: Record<string, Array<(...args: unknown[]) => void>> = {};
		mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			(vaultListeners[event] ??= []).push(handler);
		});

		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view1 = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		const view2 = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);

		await view1.onOpen();
		await view2.onOpen();

		const reloadSpy1 = vi.spyOn(view1, 'reloadBoard').mockResolvedValue();
		const reloadSpy2 = vi.spyOn(view2, 'reloadBoard').mockResolvedValue();

		vi.useFakeTimers();
		try {
			vaultListeners['rename']?.forEach(fn => fn(file2, 'NovelA/old.md'));

			await view1.onClose();

			vi.advanceTimersByTime(500);

			expect(reloadSpy2).toHaveBeenCalledOnce();
			expect(reloadSpy1).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
			await view2.onClose();
		}
	});

	it('creates DOM in its owner document and cancels queued focus/scroll in its owner window', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const frames: FrameRequestCallback[] = [];
		const customWin = {
			createDiv: () => customDoc.createElement('div'),
			createFragment: () => customDoc.createDocumentFragment(),
			requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => frames.push(cb)),
			cancelAnimationFrame: vi.fn(),
			setTimeout: globalThis.setTimeout,
			clearTimeout: globalThis.clearTimeout
		};
		const customDoc = {
			win: customWin,
			defaultView: customWin,
			createElement: vi.fn((_tag: string) => new MockElement('')),
			createDocumentFragment: vi.fn(() => Object.assign(new MockElement(''), { isFragment: true }))
		};
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		(view.contentEl as unknown as { ownerDocument: unknown }).ownerDocument = customDoc;
		(view as unknown as { pendingFilterFocus: { start: number; end: number } }).pendingFilterFocus = { start: 0, end: 0 };
		const globalRaf = vi.spyOn(window, 'requestAnimationFrame');
		try {
			await view.onOpen();
			expect(customDoc.createElement).toHaveBeenCalledWith('div');
			expect(customDoc.createDocumentFragment).toHaveBeenCalled();
			expect(frames).toHaveLength(2);
			expect(globalRaf).not.toHaveBeenCalled();
			const input = view.contentEl.querySelector<HTMLInputElement>('.wn-workbench-filter-input');
			await view.onClose();
			expect(customWin.cancelAnimationFrame.mock.calls).toEqual([[2], [1]]);
			await view.onOpen();
			const query = vi.spyOn(view.contentEl, 'querySelector');
			frames[0](0);
			frames[1](0);
			expect(query).not.toHaveBeenCalled();
			expect(input?.focus).not.toHaveBeenCalled();
			query.mockRestore();
		} finally {
			globalRaf.mockRestore();
			await view.onClose();
		}
	});

	it('aborts in-flight async render on close without modifying DOM or triggering focus/scroll', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();

		let resolveFilter: (value: TFile[]) => void = () => {};
		const filterPromise = new Promise<TFile[]>(resolve => { resolveFilter = resolve; });

		const harness = view as unknown as ChapterOverviewHarness;
		vi.spyOn(harness.filterIndex, 'filterChapters').mockImplementationOnce(() => filterPromise);

		const renderPromise = view.reloadBoard();
		await view.onClose();

		expect(view.contentEl.children.length).toBe(0);

		resolveFilter([file1 as unknown as TFile]);
		await renderPromise;

		expect(view.contentEl.children.length).toBe(0);
		expect(CorkboardGridRenderer.render).not.toHaveBeenCalled();

		// A direct reload while closed should also be guarded and remain empty
		await view.reloadBoard();
		expect(view.contentEl.children.length).toBe(0);
	});

	it('preserves search debounce delays and restores scheduling on reopen', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();

		const harness = view as unknown as ChapterOverviewHarness;
		const reloadSpy = vi.spyOn(view, 'reloadBoard').mockResolvedValue();

		vi.useFakeTimers();
		try {
			const mockInput = { value: '关键词', selectionStart: 3, selectionEnd: 3 };
			harness.scheduleFilterRefresh(mockInput, false);
			vi.advanceTimersByTime(199);
			expect(reloadSpy).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(reloadSpy).toHaveBeenCalledOnce();

			reloadSpy.mockClear();
			harness.scheduleFilterRefresh({ value: '', selectionStart: 0, selectionEnd: 0 }, true);
			vi.advanceTimersByTime(0);
			expect(reloadSpy).toHaveBeenCalledOnce();

			await view.onClose();
			reloadSpy.mockClear();

			harness.scheduleFilterRefresh(mockInput, false);
			vi.advanceTimersByTime(200);
			expect(reloadSpy).not.toHaveBeenCalled();

			await view.onOpen();
			reloadSpy.mockClear();
			harness.scheduleFilterRefresh(mockInput, false);
			vi.advanceTimersByTime(200);
			expect(reloadSpy).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
			await view.onClose();
		}
	});
	it('clears search timers in the scheduling window and ignores canceled callbacks after reopen', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new ChapterOverviewView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();
		const callbacks: Array<() => void> = [];
		const owner = {
			setTimeout: vi.fn((callback: () => void) => { callbacks.push(callback); return 17; }),
			clearTimeout: vi.fn()
		};
		const harness = view as unknown as { scheduleFilterRefresh(input: HTMLInputElement): void };
		const input = { value: '关键词', ownerDocument: { defaultView: owner } } as unknown as HTMLInputElement;
		harness.scheduleFilterRefresh(input);
		const originalDocument = view.contentEl.ownerDocument;
		const otherWindow = { ...window, clearTimeout: vi.fn() };
		(view.contentEl as unknown as { ownerDocument: unknown }).ownerDocument = { ...originalDocument, defaultView: otherWindow };
		await view.onClose();
		expect(owner.clearTimeout).toHaveBeenCalledWith(17);
		expect(otherWindow.clearTimeout).not.toHaveBeenCalled();
		await view.onOpen();
		const reload = vi.spyOn(view, 'reloadBoard').mockResolvedValue();
		callbacks[0]();
		expect(reload).not.toHaveBeenCalled();
		await view.onClose();
	});

});
