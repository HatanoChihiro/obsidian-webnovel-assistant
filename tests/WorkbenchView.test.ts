import { MockElement } from './mocks/MockElement';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	WorkbenchView,
	WORKBENCH_VIEW_TYPE,
	type WorkbenchViewPlugin
} from '../src/ui/WorkbenchView';
import {
	WORKBENCH_BOARD_IDS,
	WORKBENCH_BOARD_LABEL_KEYS,
	getWorkbenchBoardLabel
} from '../src/ui/workbenchBoards';
import { CorkboardGridRenderer } from '../src/ui/components/CorkboardGridRenderer';
import { TimelineBoardRenderer } from '../src/ui/components/TimelineBoardRenderer';
import { WritingJourneyBoardRenderer } from '../src/ui/components/WritingJourneyBoardRenderer';
import { ForeshadowingBoardRenderer } from '../src/ui/components/ForeshadowingBoardRenderer';
import { ForeshadowingStatus } from '../src/types/foreshadowing';
import { Platform, type TFile } from 'obsidian';
import { getLatestChapterFolderPath } from '../src/utils/path';
import { LoreBoardRenderer } from '../src/ui/components/LoreBoardRenderer';

const { getCurrentBookContextMock, findBookRootMock, MockTFile, MockTFolder, mockMenuInstances, MockMenu, mockModalInstances, MockModal } = vi.hoisted(() => {
	class HoistedMockMenuItem {
		title = '';
		icon = '';
		clickHandler: (() => void) | null = null;

		setTitle(title: string) {
			this.title = title;
			return this;
		}
		setIcon(icon: string) {
			this.icon = icon;
			return this;
		}
		onClick(cb: () => void) {
			this.clickHandler = cb;
			return this;
		}
	}

	const instances: Array<{ items: HoistedMockMenuItem[]; showAtMouseEvent: ReturnType<typeof vi.fn> }> = [];

	class HoistedMockMenu {
		items: HoistedMockMenuItem[] = [];
		showAtMouseEvent = vi.fn();

		constructor() {
			instances.push(this);
		}

		addItem(cb: (item: HoistedMockMenuItem) => void) {
			const item = new HoistedMockMenuItem();
			cb(item);
			this.items.push(item);
			return this;
		}
	}

	class HoistedMockTFile {
		extension = 'md';
		basename: string;
		stat = { mtime: 1 };
		parent?: HoistedMockTFolder | null;

		constructor(public name: string, public path: string, parent?: HoistedMockTFolder | null) {
			this.basename = name.replace(/\.md$/, '');
			this.parent = parent;
		}
	}

	class HoistedMockTFolder {
		children: Array<HoistedMockTFile | HoistedMockTFolder> = [];
		parent?: HoistedMockTFolder | null;

		constructor(public name: string, public path: string, parent?: HoistedMockTFolder | null) {
			this.parent = parent;
		}

		isRoot(): boolean {
			return this.path === '/' || this.path === '';
		}
	}

	const modalInstances: unknown[] = [];
	class HoistedMockModal {
		app: unknown;
		defaultPrefix?: string;
		onSubmit?: (title: string, templateContent: string) => void;

		constructor(app: unknown, ..._args: unknown[]) {
			this.app = app;
			modalInstances.push(this);
		}

		open(): void {}
		close(): void {}
	}

	return {
		getCurrentBookContextMock: vi.fn(),
		findBookRootMock: vi.fn(),
		MockTFile: HoistedMockTFile,
		MockTFolder: HoistedMockTFolder,
		mockMenuInstances: instances,
		MockMenu: HoistedMockMenu,
		mockModalInstances: modalInstances,
		MockModal: HoistedMockModal
	};
});



(globalThis as unknown as { createDiv: (opts?: unknown) => MockElement }).createDiv = function(opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
	if (typeof opts === 'object' && opts !== null && 'text' in opts) {
		el.textContent = (opts as { text: string }).text;
	}
	return el;
};

(globalThis as unknown as { createEl: (tag: string, opts?: unknown) => MockElement }).createEl = function(tag: string, opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
	(el as unknown as { id: string }).id = '';
	if (typeof opts === 'object' && opts !== null && 'text' in opts) {
		el.textContent = (opts as { text: string }).text;
	}
	return el;
};

vi.stubGlobal('window', {
	createFragment: () => new MockElement(''),
	requestAnimationFrame: (cb: (time: number) => void) => {
		cb(Date.now());
		return 0;
	},
	setTimeout: globalThis.setTimeout,
	clearTimeout: globalThis.clearTimeout
});

vi.mock('obsidian', () => {
	class MockItemView {
		app: unknown;
		containerEl: MockElement;
		contentEl: MockElement;

		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.containerEl = new MockElement('workspace-leaf-content');
			const mockDoc = {
				getElementById: vi.fn(),
				createElement: vi.fn(() => new MockElement('style')),
				head: { appendChild: vi.fn(), removeChild: vi.fn() },
				defaultView: window,
				win: {
					...window,
					createDiv: () => new MockElement('div')
				},
				activeElement: null as unknown
			} as unknown as Document;
			(this.containerEl as unknown as { ownerDocument: Document }).ownerDocument = mockDoc;
			this.contentEl = new MockElement('view-content');
			(this.contentEl as unknown as { ownerDocument: Document }).ownerDocument = mockDoc;
			this.containerEl.children.push(this.contentEl);
			this.contentEl.parentElement = this.containerEl;
		}

		registerEvent(): void {}
		addChild<T>(child: T): T { return child; }
		removeChild(): void {}
		async setState(_state: unknown, _result: unknown): Promise<void> {}
	}

	class MockComponent {
		load = vi.fn();
		unload = vi.fn();
		register = vi.fn();
		registerEvent = vi.fn();
		addChild = vi.fn();
		removeChild = vi.fn();
	}

	return {
		ItemView: MockItemView,
		Component: MockComponent,
		TFile: MockTFile,
		TFolder: MockTFolder,
		Vault: {
			recurseChildren: (folder: { children?: unknown[] }, cb: (file: unknown) => void) => {
				const traverse = (item: { children?: unknown[] }) => {
					if (item.children) {
						for (const child of item.children) {
							cb(child);
							traverse(child as { children?: unknown[] });
						}
					}
				};
				traverse(folder);
			}
		},
		setIcon: vi.fn(),
		Notice: vi.fn(),
		Menu: MockMenu,
		Modal: MockModal,
		FuzzySuggestModal: class {
			constructor(_app: unknown) {}
			setPlaceholder(): void {}
			open(): void {}
			close(): void {}
		},
		Setting: class {
			setHeading() { return this; }
			setName() { return this; }
		},
		Platform: {
			isMobile: false
		}
	};
});

vi.mock('../src/utils/path', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/utils/path')>();
	return {
		...actual,
		getCurrentBookContext: getCurrentBookContextMock,
		findBookRoot: findBookRootMock,
		getLatestChapterFolderPath: vi.fn(actual.getLatestChapterFolderPath)
	};
});

vi.mock('../src/ui/components/CorkboardGridRenderer', () => ({
	CorkboardGridRenderer: {
		render: vi.fn()
	}
}));

vi.mock('../src/ui/components/TimelineBoardRenderer', () => ({
	TimelineBoardRenderer: {
		render: vi.fn()
	}
}));

vi.mock('../src/ui/components/WritingJourneyBoardRenderer', () => ({
	WritingJourneyBoardRenderer: {
		render: vi.fn()
	}
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key,
	getLocale: () => 'zh-CN'
}));

vi.mock('../src/i18n/data-keys', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/i18n/data-keys')>();
	return {
		...actual,
		getNovelStatusText: () => '',
		getNovelInfoLabel: () => ''
	};
});

describe('WorkbenchView', () => {
	let plugin: WorkbenchViewPlugin;
	let mockApp: {
		vault: {
			on: ReturnType<typeof vi.fn>;
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
			cachedRead: ReturnType<typeof vi.fn>;
			create: ReturnType<typeof vi.fn>;
		};
		metadataCache: {
			on: ReturnType<typeof vi.fn>;
			getFileCache: ReturnType<typeof vi.fn>;
		};
		workspace: {
			on: ReturnType<typeof vi.fn>;
			getActiveFile: ReturnType<typeof vi.fn>;
			trigger: ReturnType<typeof vi.fn>;
		};
	};
	let mockLeaf: { app: unknown };
	let file1: InstanceType<typeof MockTFile>;

	beforeEach(() => {
		vi.clearAllMocks();
		Platform.isMobile = false;
		mockMenuInstances.length = 0;
		mockModalInstances.length = 0;
		vi.stubGlobal('activeDocument', {
			getElementById: vi.fn().mockReturnValue(null),
			head: { appendChild: vi.fn() }
		});

		file1 = new MockTFile('第1章.md', 'NovelA/第1章.md');

		mockApp = {
			vault: {
				on: vi.fn(),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				cachedRead: vi.fn().mockResolvedValue(''),
				create: vi.fn().mockImplementation((path: string) => Promise.resolve(new MockTFile(path, path)))
			},
			metadataCache: {
				on: vi.fn(),
				getFileCache: vi.fn().mockReturnValue(null)
			},
			workspace: {
				on: vi.fn(),
				getActiveFile: vi.fn().mockReturnValue(null),
				trigger: vi.fn()
			}
		};

		mockLeaf = { app: mockApp };

		plugin = {
			settings: {
				enableStrictChapterMode: false,
				loreFolderName: '设定',
				corkboardSortMode: 'default',
				loreBoardLayout: 'table',
				enableSmartChapterSort: true,
				customSortOrder: {}
			},
			cacheManager: {
				isFileInWorkspace: vi.fn().mockReturnValue(true),
				isEligibleForChapterList: vi.fn().mockReturnValue(true),
				getFileCache: vi.fn()
			},
			timelineManager: { loadEntries: vi.fn().mockResolvedValue([]) },
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((_key: string, fn: () => void) => { fn(); }),
				cancel: vi.fn()
			},
			homepageManager: {
				getHomepageFilePath: vi.fn().mockReturnValue(null),
				getNovelFolders: vi.fn().mockReturnValue([]),
				findNovelInfoFile: vi.fn().mockReturnValue(null),
				getNovelMetadata: vi.fn().mockResolvedValue(null)
			},
			characterManager: {
				getCharactersForBook: vi.fn().mockReturnValue([]),
				getCharacterFile: vi.fn().mockReturnValue(null),
				getLoreEntriesInFileOrder: vi.fn().mockReturnValue([]),
				getEffectiveLoreFiles: vi.fn().mockReturnValue([]),
				ensureInitialized: vi.fn().mockResolvedValue(undefined)
			},
			foreshadowingManager: {
				findForeshadowingFile: vi.fn().mockReturnValue(null),
				parseEntries: vi.fn().mockReturnValue([]),
				buildChapterForeshadowingMap: vi.fn().mockResolvedValue(new Map())
			},
			taskManager: {
				reconcileTasks: vi.fn().mockResolvedValue(undefined),
				loadEntries: vi.fn().mockResolvedValue([]),
				getTaskFile: vi.fn().mockReturnValue(null),
				getNextPeriod: vi.fn().mockReturnValue('1'),
				addEntry: vi.fn().mockResolvedValue(undefined)
			},
			writingJourneyService: {
				getJourneyLog: vi.fn().mockResolvedValue({ status: 'valid', log: { version: 1, events: [] } }),
				recordChapterCreated: vi.fn().mockResolvedValue(undefined),
				recordChapterRenamed: vi.fn().mockResolvedValue(undefined),
				recordChapterDeleted: vi.fn().mockResolvedValue(undefined),
				recordChapterStatusChanged: vi.fn().mockResolvedValue(undefined),
				recordWorkStatusChanged: vi.fn().mockResolvedValue(undefined),
				markHandledCreate: vi.fn(),
				markHandledRename: vi.fn(),
				markHandledDelete: vi.fn()
			},
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([file1] as unknown as TFile[]),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([file1] as unknown as TFile[]),
			isFileInStrictChapterException: vi.fn().mockReturnValue(false),
			isPluginGeneratedFile: vi.fn().mockReturnValue(false),
			calculateAccurateWords: vi.fn().mockReturnValue(100),
			saveSettings: vi.fn().mockResolvedValue(undefined)
		} as unknown as WorkbenchViewPlugin;
	});

	it('should return correct view type and display text', () => {
		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		expect(view.getViewType()).toBe(WORKBENCH_VIEW_TYPE);
		expect(view.getDisplayText()).toBe('view.workbench');
	});

	it('initializes a new workbench using status memory before broadcasting its selected work', async () => {
		getCurrentBookContextMock.mockImplementation((_app: unknown, _plugin: unknown, options?: { preferStatusViewContext?: boolean }) =>
			options?.preferStatusViewContext ? 'NovelB' : 'NovelA');
		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		await view.onOpen();
		expect(view.currentBookPath).toBe('NovelB');
		expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-book-changed', 'NovelB');
		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('webnovel-workbench-book-changed', 'NovelA');
		Object.assign(view.containerEl, { removeEventListener: vi.fn() });
		Object.assign(view.contentEl, { removeEventListener: vi.fn() });
		await view.onClose();
		getCurrentBookContextMock.mockReset();
	});

	it('preserves an already selected work when opening the workbench', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelB');
		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelC';
		await view.onOpen();
		expect(view.currentBookPath).toBe('NovelC');
		expect(getCurrentBookContextMock).not.toHaveBeenCalled();
		Object.assign(view.containerEl, { removeEventListener: vi.fn() });
		Object.assign(view.contentEl, { removeEventListener: vi.fn() });
		await view.onClose();
		getCurrentBookContextMock.mockReset();
	});

	it('should debounce vault rename, delete, modify, and metadataCache changed events with workbench-refresh and cancel on close', async () => {
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

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		(view as unknown as { container: unknown }).container = view.contentEl;

		expect(vaultHandlers['rename']).toBeDefined();
		expect(vaultHandlers['delete']).toBeDefined();
		expect(vaultHandlers['modify']).toBeDefined();
		expect(metadataHandlers['changed']).toBeDefined();

		// Trigger rename
		vaultHandlers['rename'](file1, 'NovelA/old.md');
		const viewRefreshKey = (view as unknown as { refreshDebounceKey: string }).refreshDebounceKey;
		expect(debounceSpy).toHaveBeenCalledWith(viewRefreshKey, expect.any(Function), 500, expect.anything());

		// Trigger delete
		debounceSpy.mockClear();
		vaultHandlers['delete'](file1);
		expect(debounceSpy).toHaveBeenCalledWith(viewRefreshKey, expect.any(Function), 500, expect.anything());

		// Trigger modify
		debounceSpy.mockClear();
		vaultHandlers['modify'](file1);
		expect(debounceSpy).toHaveBeenCalledWith(viewRefreshKey, expect.any(Function), 1000, expect.anything());

		// Trigger metadataCache changed
		debounceSpy.mockClear();
		metadataHandlers['changed'](file1);
		expect(debounceSpy).toHaveBeenCalledWith(viewRefreshKey, expect.any(Function), 1000, expect.anything());

		// Close view
		await view.onClose();
		expect(cancelSpy).toHaveBeenCalledWith(viewRefreshKey);
	});

	it('2 views receiving rename/modify and closing one without cancelling the other', async () => {
		const vaultHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

		mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			if (!vaultHandlers[event]) vaultHandlers[event] = [];
			vaultHandlers[event].push(handler);
		});

		// Simulated real debounce manager with callback tracking per key
		const scheduledCallbacks = new Map<string, () => void>();
		const debounceSpy = vi.fn((key: string, fn: () => void) => {
			scheduledCallbacks.set(key, fn);
		});
		const cancelSpy = vi.fn((key: string) => {
			scheduledCallbacks.delete(key);
		});
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: cancelSpy
		};

		const mockLeaf1 = { app: mockApp, view: { getViewType: () => 'webnovel-workbench' } };
		const mockLeaf2 = { app: mockApp, view: { getViewType: () => 'webnovel-workbench' } };
		const view1 = new WorkbenchView(mockLeaf1 as unknown as import('obsidian').WorkspaceLeaf, plugin);
		const view2 = new WorkbenchView(mockLeaf2 as unknown as import('obsidian').WorkspaceLeaf, plugin);
		(view1 as unknown as { container: unknown }).container = view1.contentEl;
		(view2 as unknown as { container: unknown }).container = view2.contentEl;

		// Both views are set to NovelA
		view1.setBookPath('NovelA');
		view2.setBookPath('NovelA');

		// Trigger rename: handlers for both views run
		for (const h of vaultHandlers['rename'] || []) {
			h(file1, 'NovelA/old.md');
		}

		// In baseline: both used shared key 'workbench-refresh', so scheduledCallbacks only has 1 entry
		// and closing view2 cancels that shared key, canceling view1's work!
		expect(scheduledCallbacks.size).toBe(2);

		// Close view2
		await view2.onClose();

		// view1's scheduled refresh MUST still be alive and not cancelled!
		expect(scheduledCallbacks.size).toBe(1);
	});

	it('should only trigger reload for markdown modify if the file belongs to the current book (or its dependencies)', async () => {
		const vaultHandlers: Record<string, ((...args: unknown[]) => void)> = {};

		mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			vaultHandlers[event] = handler;
		});

		const debounceSpy = vi.fn();
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: vi.fn()
		};

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA'; // Current book is NovelA
		(view as unknown as { container: unknown }).container = view.contentEl;

		// Book A file
		const currentBookFile = new MockTFile('Chapter.md', 'NovelA/Chapter.md');
		const otherBookFile = new MockTFile('Chapter.md', 'NovelB/Chapter.md');
		const rootBookFile = new MockTFile('info.md', 'NovelA.md'); // A book defined at vault root

		plugin.cacheManager.isFileInWorkspace = vi.fn().mockReturnValue(true);
		findBookRootMock.mockImplementation((app, plugin, file) => {
			if (file.path.startsWith('NovelA/')) return 'NovelA';
			if (file.path.startsWith('NovelB/')) return 'NovelB';
			if (file.path === 'NovelA.md') return ''; // Empty string represents vault root
			return null;
		});

		// Trigger modify on current book file
		debounceSpy.mockClear();
		vaultHandlers['modify'](currentBookFile);
		expect(debounceSpy).toHaveBeenCalled();

		// Trigger modify on another book file
		debounceSpy.mockClear();
		vaultHandlers['modify'](otherBookFile);
		expect(debounceSpy).not.toHaveBeenCalled();

		// Trigger modify on vault root book when current book is vault root
		debounceSpy.mockClear();
		view.currentBookPath = '';
		vaultHandlers['modify'](rootBookFile);
		expect(debounceSpy).toHaveBeenCalled();

		// Reset current book path
		view.currentBookPath = 'NovelA';

		// Close view
		await view.onClose();
	});

	it('should reload board when debounced refresh or lore-updated triggers with proper delays', async () => {
		const vaultHandlers: Record<string, ((...args: unknown[]) => void)> = {};
		const metadataHandlers: Record<string, ((...args: unknown[]) => void)> = {};
		const workspaceHandlers: Record<string, ((...args: unknown[]) => void)> = {};

		mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			vaultHandlers[event] = handler;
		});
		mockApp.metadataCache.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			metadataHandlers[event] = handler;
		});
		mockApp.workspace.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			workspaceHandlers[event] = handler;
		});

		let queuedCallback: (() => void) | null = null;
		const debounceSpy = vi.fn((_key: string, fn: () => void) => {
			queuedCallback = fn;
		});
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: vi.fn()
		};

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		(view as unknown as { container: unknown }).container = view.contentEl;
		const reloadSpy = vi.spyOn(view, 'reloadBoard').mockImplementation(async () => {});

		// In default mode, rename schedules debounce with 500ms delay and running it reloads board
		const viewRefreshKey = (view as unknown as { refreshDebounceKey: string }).refreshDebounceKey;
		vaultHandlers['rename'](file1, 'NovelA/old.md');
		expect(debounceSpy).toHaveBeenLastCalledWith(viewRefreshKey, expect.any(Function), 500, expect.anything());
		expect(reloadSpy).not.toHaveBeenCalled();
		expect(queuedCallback).toBeDefined();
		(queuedCallback as unknown as () => void)();
		expect(reloadSpy).toHaveBeenCalledTimes(1);

		// In default mode, modify schedules debounce with 1000ms delay and running it reloads board
		reloadSpy.mockClear();
		vaultHandlers['modify'](file1);
		expect(debounceSpy).toHaveBeenLastCalledWith(viewRefreshKey, expect.any(Function), 1000, expect.anything());
		expect(queuedCallback).toBeDefined();
		(queuedCallback as unknown as () => void)();
		expect(reloadSpy).toHaveBeenCalledTimes(1);

		// In default mode, lore-updated triggers reload immediately
		reloadSpy.mockClear();
		workspaceHandlers['webnovel-workbench-lore-updated']();
		expect(reloadSpy).toHaveBeenCalledTimes(1);
	});

	it('should invalidate foreshadowing cache and reload on current-book foreshadowing change, ignoring other works', async () => {
		const vaultHandlers: Record<string, ((...args: unknown[]) => void)> = {};
		mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
			vaultHandlers[event] = handler;
		});

		let queuedCallback: (() => void) | null = null;
		const debounceSpy = vi.fn((_key: string, fn: () => void) => {
			queuedCallback = fn;
		});
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: vi.fn()
		};

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		(view as unknown as { container: unknown }).container = view.contentEl;
		view.currentBookPath = 'NovelA';

		const novelAFolder = new MockTFolder('NovelA', 'NovelA');
		const novelBFolder = new MockTFolder('NovelB', 'NovelB');
		const currentForeshadowFile = new MockTFile('伏笔.md', 'NovelA/伏笔.md', novelAFolder) as unknown as TFile;
		const otherBookForeshadowFile = new MockTFile('伏笔.md', 'NovelB/伏笔.md', novelBFolder) as unknown as TFile;
		const ordinaryChapterFile = new MockTFile('Chapter 1.md', 'NovelA/Chapter 1.md', novelAFolder) as unknown as TFile;

		plugin.foreshadowingManager.findForeshadowingFile = vi.fn((folderPath: string) => {
			return folderPath === 'NovelA' ? currentForeshadowFile : null;
		});

		const staleMap = new Map();
		(view as unknown as { cachedForeshadowingMap: unknown }).cachedForeshadowingMap = staleMap;
		(view as unknown as { cachedForeshadowingBookPath: unknown }).cachedForeshadowingBookPath = 'NovelA';

		const reloadSpy = vi.spyOn(view, 'reloadBoard').mockImplementation(async () => {});

		// Another work's foreshadowing file with isFileInWorkspace=true is ignored because findBookRoot says it belongs to NovelB
		plugin.cacheManager.isFileInWorkspace = vi.fn().mockReturnValue(true);
		vaultHandlers['modify'](otherBookForeshadowFile);
		expect(debounceSpy).not.toHaveBeenCalled();
		expect((view as unknown as { cachedForeshadowingMap: unknown }).cachedForeshadowingMap).toBe(staleMap);

		// Current-book foreshadowing modify with isFileInWorkspace=false clears both cache fields and schedules/executes 150ms reload
		const viewRefreshKey = (view as unknown as { refreshDebounceKey: string }).refreshDebounceKey;
		vaultHandlers['modify'](currentForeshadowFile);
		expect((view as unknown as { cachedForeshadowingMap: unknown }).cachedForeshadowingMap).toBeNull();
		expect((view as unknown as { cachedForeshadowingBookPath: unknown }).cachedForeshadowingBookPath).toBeNull();
		expect(debounceSpy).toHaveBeenCalledWith(viewRefreshKey, expect.any(Function), 150, expect.anything());
		expect(reloadSpy).not.toHaveBeenCalled();
		(queuedCallback as unknown as () => void)();
		expect(reloadSpy).toHaveBeenCalledTimes(1);

		// Ordinary file with isFileInWorkspace=true still uses 1000ms
		reloadSpy.mockClear();
		debounceSpy.mockClear();
		queuedCallback = null;
		plugin.cacheManager.isFileInWorkspace = vi.fn().mockReturnValue(true);
		vaultHandlers['modify'](ordinaryChapterFile);
		expect(debounceSpy).toHaveBeenCalledWith(viewRefreshKey, expect.any(Function), 1000, expect.anything());
		(queuedCallback as unknown as () => void)();
		expect(reloadSpy).toHaveBeenCalledTimes(1);
	});

	it('should await requestAnimationFrame restoration in reloadBoard and properly flush pending reload', async () => {
		const rafQueue: Array<(time: number) => void> = [];
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: (time: number) => void) => {
			rafQueue.push(cb);
			return rafQueue.length;
		});

		const flushRaf = () => {
			const callbacks = [...rafQueue];
			rafQueue.length = 0;
			callbacks.forEach(cb => cb(Date.now()));
		};

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';

		let currentMain = { scrollTop: 320 };
		let currentSide = { scrollTop: 140 };
		let renderCount = 0;

		const fakeContainer = {
			ownerDocument: { defaultView: window },
			querySelector: (selector: string) => {
				if (selector === '.wn-timeline-waterfall-main') return currentMain;
				if (selector === '.wn-timeline-waterfall-sidebar') return currentSide;
				return null;
			}
		};

		type WorkbenchViewInternal = {
			container: unknown;
			sortMode: string;
			renderBoard: () => Promise<void>;
			isReloadingBoard: boolean;
			hasPendingReload: boolean;
		};

		const viewInternal = view as unknown as WorkbenchViewInternal;
		viewInternal.container = fakeContainer;
		viewInternal.sortMode = 'timeline';
		viewInternal.renderBoard = async () => {
			renderCount++;
			currentMain = { scrollTop: 0 };
			currentSide = { scrollTop: 0 };
		};

		// Invoke reloadBoard twice rapidly: first awaits RAF restoration, second becomes pending
		const reload1Promise = view.reloadBoard();
		void view.reloadBoard();

		expect(viewInternal.isReloadingBoard).toBe(true);
		expect(viewInternal.hasPendingReload).toBe(true);
		expect(renderCount).toBe(1);

		// Let renderBoard finish and queue RAF restoration for the first reload
		await Promise.resolve();
		expect(rafQueue).toHaveLength(1);

		// Flush first reload's RAF -> restores scroll positions and triggers pending reload in finally block
		flushRaf();
		await reload1Promise;

		// Let pending reload advance past its renderBoard and queue its own RAF
		await Promise.resolve();
		expect(renderCount).toBe(2);
		expect(rafQueue).toHaveLength(1);
		expect(currentMain.scrollTop).toBe(0);
		expect(currentSide.scrollTop).toBe(0);

		// Flush pending reload's RAF -> restores scroll positions to 320/140
		flushRaf();
		await Promise.resolve();

		expect(currentMain.scrollTop).toBe(320);
		expect(currentSide.scrollTop).toBe(140);
		expect(viewInternal.isReloadingBoard).toBe(false);
		expect(viewInternal.hasPendingReload).toBe(false);

		rafSpy.mockRestore();
	});

	it('should render Workbench All Chapters using shared deterministic order in asc and desc without mutating files', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = new MockTFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = new MockTFile('第1章.md', 'NovelA/第二卷/第1章.md');
		const v2c2 = new MockTFile('第2章.md', 'NovelA/第二卷/第2章.md');

		const vol1 = new MockTFolder('第一卷', 'NovelA/第一卷');
		vol1.children = [v1c1, v1c2];
		const vol2 = new MockTFolder('第二卷', 'NovelA/第二卷');
		vol2.children = [v2c1, v2c2];
		const bookFolder = new MockTFolder('NovelA', 'NovelA');
		bookFolder.children = [vol2, vol1];

		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'NovelA') return bookFolder;
			return null;
		});
		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v2c2, v1c2, v2c1, v1c1] as unknown as TFile[]);

		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;

		// 1. Render ascending (default)
		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v1c1, v1c2, v2c1, v2c2],
				draggable: true,
				currentBookPath: 'NovelA'
			})
		);

		// 2. Render descending
		(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		(view as unknown as { isDescending: boolean }).isDescending = true;
		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v2c2, v2c1, v1c2, v1c1],
				draggable: false,
				currentBookPath: 'NovelA'
			})
		);
	});

	it('should pass files and unscheduled sort options to TimelineBoardRenderer and persist toggle across reloadBoard', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v2c1 = new MockTFile('第1章.md', 'NovelA/第二卷/第1章.md');

		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v2c1, v1c1] as unknown as TFile[]);
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;
		(view as unknown as { sortMode: string }).sortMode = 'timeline';

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isUnscheduledDescending: false,
				onToggleUnscheduledSort: expect.any(Function)
			})
		);

		// Capture onToggleUnscheduledSort from last call
		const lastCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
		expect(lastCall.isUnscheduledDescending).toBe(false);

		// Trigger toggle sort
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		lastCall.onToggleUnscheduledSort();

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isUnscheduledDescending: true
			})
		);

		// Trigger toggle sort again (back to ascending)
		const nextCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		nextCall.onToggleUnscheduledSort();

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isUnscheduledDescending: false
			})
		);
	});

	it('should maintain timeline sidebar collapse state across workbench board renders and toggle independently from sort state', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');

		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v1c1] as unknown as TFile[]);
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;
		(view as unknown as { sortMode: string }).sortMode = 'timeline';

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isSidebarCollapsed: false,
				onToggleSidebarCollapse: expect.any(Function),
				isUnscheduledDescending: false,
				onToggleUnscheduledSort: expect.any(Function)
			})
		);

		// Capture callbacks
		const lastCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
		expect(lastCall.isSidebarCollapsed).toBe(false);

		// Trigger toggle sidebar collapse
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		lastCall.onToggleSidebarCollapse();

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isSidebarCollapsed: true,
				isUnscheduledDescending: false
			})
		);

		// Trigger toggle sort while sidebar is collapsed
		const collapsedCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		collapsedCall.onToggleUnscheduledSort();

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		// Both states should be preserved independently
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isSidebarCollapsed: true,
				isUnscheduledDescending: true
			})
		);

		// Trigger toggle collapse again (restore sidebar)
		const restoredCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		restoredCall.onToggleSidebarCollapse();

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentBookPath: 'NovelA',
				isSidebarCollapsed: false,
				isUnscheduledDescending: true
			})
		);
	});

	it('should not register cross-view timeline sync events', () => {
		const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
		mockApp.workspace.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
			if (!listeners.has(event)) listeners.set(event, []);
			listeners.get(event)!.push(callback);
			return {} as import('obsidian').EventRef;
		});
		new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		expect(listeners.has('timeline-order-changed')).toBe(false);
		expect(listeners.has('timeline-filter-changed')).toBe(false);
		expect(listeners.has('timeline-lore-filter-changed')).toBe(false);
	});

	it('updates local timeline filters without triggering workspace events and passes default ascending', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v1c1] as unknown as TFile[]);
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;
		(view as unknown as { sortMode: string }).sortMode = 'timeline';

		plugin.timelineManager.loadEntries = vi.fn().mockResolvedValue([
			{ type: '主线', items: [{ description: '', chapter: '' }], lores: ['甲'] }
		]);

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		const firstRenderOptions = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
		expect(firstRenderOptions).not.toHaveProperty('isDescending');

		// Click the type tab
		const typeRow = view.contentEl.querySelector('.wn-timeline-type-filter-row');
		expect(typeRow).not.toBeNull();
		const typeTabs = typeRow?.querySelectorAll('.wn-lore-file-tab') || [];
		const specificTypeTab = Array.from(typeTabs).find(t => t.textContent === '主线');
		expect(specificTypeTab).toBeDefined();

		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		(specificTypeTab as HTMLElement).click();

		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('timeline-filter-changed', expect.anything());
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual(['主线']);

		// Wait for reloadBoard
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentTimelineFilter: ['主线']
			})
		);

		// Click lore filter
		const loreRow = view.contentEl.querySelector('.wn-timeline-lore-filter-row');
		expect(loreRow).not.toBeNull();
		const loreBtns = loreRow?.querySelectorAll('.wn-lore-file-tab');
		expect(loreBtns).toHaveLength(2);
		(loreBtns?.[1] as HTMLElement).click();

		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('timeline-lore-filter-changed', expect.anything());
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual(['甲']);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({ currentTimelineLoreFilter: ['甲'] })
		);
	});

	it('supports multi-selecting timeline types, toggling, and clearing types without clearing lore filter', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v1c1] as unknown as TFile[]);
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;
		(view as unknown as { sortMode: string }).sortMode = 'timeline';

		plugin.timelineManager.loadEntries = vi.fn().mockResolvedValue([
			{ type: '主线', items: [{ description: '', chapter: '' }], lores: ['甲'] },
			{ type: '支线', items: [{ description: '', chapter: '' }], lores: ['乙'] },
			{ type: '日常', items: [{ description: '', chapter: '' }], lores: ['丙'] }
		]);

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		const typeRow = view.contentEl.querySelector('.wn-timeline-type-filter-row');
		expect(typeRow).not.toBeNull();
		const getTypeButton = (label: string): HTMLElement => {
			const row = view.contentEl.querySelector('.wn-timeline-type-filter-row');
			const button = Array.from(row?.querySelectorAll('.wn-lore-file-tab') || []).find(t => t.textContent === label);
			expect(button).toBeDefined();
			return button as HTMLElement;
		};

		// 1. Select 主线
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		getTypeButton('主线').click();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual(['主线']);
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({ currentTimelineFilter: ['主线'] })
		);

		// 2. Select 支线 -> multi-selection ['主线', '支线']
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		getTypeButton('支线').click();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual(['主线', '支线']);
		expect(getTypeButton('主线').getAttribute('aria-pressed')).toBe('true');
		expect(getTypeButton('支线').getAttribute('aria-pressed')).toBe('true');
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({ currentTimelineFilter: ['主线', '支线'] })
		);

		// 3. Select lore filter '甲'
		const loreRow = view.contentEl.querySelector('.wn-timeline-lore-filter-row');
		const loreBtns = loreRow?.querySelectorAll('.wn-lore-file-tab') || [];
		const loreJia = Array.from(loreBtns).find(t => t.textContent === '甲');
		(loreJia as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual(['甲']);

		// 4. Click 'common.all-types' -> clears types to [], but lore filter ['甲'] remains
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		getTypeButton('common.all-types').click();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual([]);
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual(['甲']);
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				currentTimelineFilter: [],
				currentTimelineLoreFilter: ['甲']
			})
		);

		getTypeButton('主线').click();
		await new Promise(resolve => setTimeout(resolve, 0));
		getTypeButton('主线').click();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual([]);
		expect(getTypeButton('common.all-types').getAttribute('aria-pressed')).toBe('true');
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual(['甲']);
	});

	it('clears timeline type and lore filters on work switch, setBookPath, and setState', async () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		mockApp.workspace.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
			handlers.set(event, callback);
		});
		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter = ['主线'];
		(view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter = ['甲'];

		// setBookPath resets filters
		(view as unknown as { setBookPath: (path: string) => void }).setBookPath('NovelB');
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual([]);
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual([]);

		// setState resets filters
		(view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter = ['支线'];
		(view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter = ['乙'];
		await view.setState({ sortMode: 'timeline', currentBookPath: 'NovelC' }, { history: false });
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual([]);
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual([]);

		(view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter = ['主线', '支线'];
		(view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter = ['甲'];
		mockApp.workspace.getActiveFile.mockReturnValue(new MockTFile('第1章.md', 'NovelD/第1章.md'));
		findBookRootMock.mockReturnValue('NovelD');
		handlers.get('active-leaf-change')?.({ view: { getViewType: () => 'markdown' } });
		expect(view.currentBookPath).toBe('NovelD');
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual([]);
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual([]);
	});

	it('preserves timeline type and lore filters across layout switcher between waterfall and trajectory', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v1c1] as unknown as TFile[]);
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;
		(view as unknown as { sortMode: string }).sortMode = 'timeline';

		plugin.timelineManager.loadEntries = vi.fn().mockResolvedValue([
			{ type: '主线', items: [{ description: '', chapter: '' }], lores: ['甲'] }
		]);

		(view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter = ['主线'];
		(view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter = ['甲'];

		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		// Find layout switcher buttons
		const switcherBtns = view.contentEl.querySelectorAll('.wn-lore-board-switcher-btn');
		expect(switcherBtns).toHaveLength(2);

		// Switch to Trajectory mode
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		(switcherBtns[1] as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 0));

		expect((view as unknown as { isTimelineTrajectoryMode: boolean }).isTimelineTrajectoryMode).toBe(true);
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual(['主线']);
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual(['甲']);
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				isTrajectoryMode: true,
				currentTimelineFilter: ['主线'],
				currentTimelineLoreFilter: ['甲']
			})
		);

		// Switch back to Waterfall mode
		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		(view.contentEl.querySelectorAll('.wn-lore-board-switcher-btn')[0] as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 0));

		expect((view as unknown as { isTimelineTrajectoryMode: boolean }).isTimelineTrajectoryMode).toBe(false);
		expect((view as unknown as { currentTimelineFilter: string[] }).currentTimelineFilter).toEqual(['主线']);
		expect((view as unknown as { currentTimelineLoreFilter: string[] }).currentTimelineLoreFilter).toEqual(['甲']);
		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				isTrajectoryMode: false,
				currentTimelineFilter: ['主线'],
				currentTimelineLoreFilter: ['甲']
			})
		);
	});

	it('does not retain cross-render trajectory viewport state and starts anew on reload', async () => {
		const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md');
		plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v1c1] as unknown as TFile[]);
		getCurrentBookContextMock.mockReturnValue('NovelA');

		const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
		view.currentBookPath = 'NovelA';
		(view as unknown as { container: unknown }).container = view.contentEl;
		(view as unknown as { sortMode: string }).sortMode = 'timeline';
		(view as unknown as { isTimelineTrajectoryMode: boolean }).isTimelineTrajectoryMode = true;

		plugin.timelineManager.loadEntries = vi.fn().mockResolvedValue([
			{ items: [{ description: '', chapter: '', type: '主线' }], lores: ['甲'] }
		]);

		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				isTrajectoryMode: true
			})
		);
		const firstCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(firstCall.trajectoryViewport).toBeUndefined();
		expect(firstCall.onTrajectoryViewportChange).toBeUndefined();
		expect((view as unknown as { timelineTrajectoryViewport?: unknown }).timelineTrajectoryViewport).toBeUndefined();

		(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockClear();
		await view.reloadBoard();

		expect(TimelineBoardRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				isTrajectoryMode: true
			})
		);
		const reloadCall = (TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(reloadCall.trajectoryViewport).toBeUndefined();
		expect(reloadCall.onTrajectoryViewportChange).toBeUndefined();
	});

	describe('Switch current work/novel menu ordering', () => {
		const makeNovel = (folderPath: string, folderName?: string, name?: string) => {
			const parts = folderPath.replace(/^\/+|\/+$/g, '').split('/');
			const defaultName = folderName || parts[parts.length - 1] || '';
			return {
				folderPath,
				folderName: defaultName,
				metadata: name ? {
					name,
					status: 'ongoing' as const,
					synopsis: '',
					protagonist: '',
					wordGoal: 0,
					genre: '',
					startDate: '',
					endDate: ''
				} : null,
				wordCount: 1000
			};
		};

		it('should order switch novel menu in hierarchical top-to-bottom file tree order with multiple workspace roots and ancestors before descendants', async () => {
			const rawNovels = [
				makeNovel('WorkspaceZ/Work1', 'Work1'),
				makeNovel('WorkspaceA/Work2', 'Work2', 'Alpha Custom Title'),
				makeNovel('WorkspaceA/Work1', 'Work1'),
				makeNovel('Novels/SeriesA', 'SeriesA'),
				makeNovel('Novels/SeriesA/Arc2', 'Arc2'),
				makeNovel('Novels/SeriesA/Arc1', 'Arc1'),
				makeNovel('Novels/SeriesB', 'SeriesB')
			];
			const rawNovelsCopy = [...rawNovels];

			(plugin.homepageManager!.getNovelFolders as ReturnType<typeof vi.fn>).mockReturnValue(rawNovels);
			getCurrentBookContextMock.mockReturnValue('Novels/SeriesA');

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'Novels/SeriesA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const switchSpan = view.contentEl.querySelector('.wn-corkboard-switch-novel') as (MockElement & { onclick: (e: unknown) => void }) | null;
			expect(switchSpan).not.toBeNull();

			// Open menu
			switchSpan!.onclick({} as MouseEvent);

			expect(mockMenuInstances).toHaveLength(1);
			const menu = mockMenuInstances[0];

			// Expected order:
			// 1. Novels/SeriesA (ancestor)
			// 2. Novels/SeriesA/Arc1 (descendant 1)
			// 3. Novels/SeriesA/Arc2 (descendant 2)
			// 4. Novels/SeriesB (sibling)
			// 5. WorkspaceA/Work1 (workspace A)
			// 6. WorkspaceA/Work2 (workspace A, title: 'Alpha Custom Title')
			// 7. WorkspaceZ/Work1 (workspace Z)
			expect(menu.items.map(item => item.title)).toEqual([
				'SeriesA',
				'Arc1',
				'Arc2',
				'SeriesB',
				'Work1',
				'Alpha Custom Title',
				'Work1'
			]);

			// Verify all items have icon 'book'
			expect(menu.items.every(item => item.icon === 'book')).toBe(true);
			expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);

			// Verify raw novels array from getNovelFolders was NOT mutated
			expect(rawNovels).toEqual(rawNovelsCopy);

			// Test clicking item switches to that book path
			const setBookPathSpy = vi.spyOn(view, 'setBookPath');
			menu.items[5].clickHandler?.();
			expect(setBookPathSpy).toHaveBeenCalledWith('WorkspaceA/Work2');
		});

		it('should respect customSortOrder, smart block vs ordinary folder, and ignore stale individual weights in switch novel menu', async () => {
			const lore = makeNovel('Novels/设定集', '设定集');
			const part1 = makeNovel('Novels/第一部', '第一部');
			const part2 = makeNovel('Novels/第二部', '第二部');

			(plugin.homepageManager!.getNovelFolders as ReturnType<typeof vi.fn>).mockReturnValue([lore, part2, part1]);
			plugin.settings.enableSmartChapterSort = true;
			plugin.settings.customSortOrder = {
				'Novels/__CHAPTER_BLOCK__': 0,
				'Novels/设定集': 1,
				// Stale individual weights that should be ignored under smart sort
				'Novels/第二部': 0,
				'Novels/第一部': 100
			};

			getCurrentBookContextMock.mockReturnValue('Novels/第一部');

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'Novels/第一部';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const switchSpan = view.contentEl.querySelector('.wn-corkboard-switch-novel') as (MockElement & { onclick: (e: unknown) => void }) | null;
			switchSpan!.onclick({} as MouseEvent);

			expect(mockMenuInstances).toHaveLength(1);
			const menu = mockMenuInstances[0];

			// Smart block comes first (due to Novels/__CHAPTER_BLOCK__: 0), and internally 第一部 comes before 第二部 (stale weights ignored)
			expect(menu.items.map(item => item.title)).toEqual([
				'第一部',
				'第二部',
				'设定集'
			]);

			const setBookPathSpy = vi.spyOn(view, 'setBookPath');
			menu.items[0].clickHandler?.();
			expect(setBookPathSpy).toHaveBeenCalledWith('Novels/第一部');
		});

		it('should ignore customSortOrder and use natural numeric locale ordering when enableSmartChapterSort is false in switch novel menu', async () => {
			const lore = makeNovel('Novels/设定集', '设定集');
			const part1 = makeNovel('Novels/第1部', '第1部');
			const part2 = makeNovel('Novels/第2部', '第2部');
			const part10 = makeNovel('Novels/第10部', '第10部');

			(plugin.homepageManager!.getNovelFolders as ReturnType<typeof vi.fn>).mockReturnValue([lore, part10, part2, part1]);
			plugin.settings.enableSmartChapterSort = false;
			plugin.settings.customSortOrder = {
				'Novels/第2部': 0,
				'Novels/设定集': 1,
				'Novels/第10部': 2,
				'Novels/第1部': 3
			};

			getCurrentBookContextMock.mockReturnValue('Novels/第1部');

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'Novels/第1部';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const switchSpan = view.contentEl.querySelector('.wn-corkboard-switch-novel') as (MockElement & { onclick: (e: unknown) => void }) | null;
			switchSpan!.onclick({} as MouseEvent);

			expect(mockMenuInstances).toHaveLength(1);
			const menu = mockMenuInstances[0];

			// When smart sort is false, customSortOrder is ignored and native natural numeric locale ordering is used
			expect(menu.items.map(item => item.title)).toEqual([
				'第1部',
				'第2部',
				'第10部',
				'设定集'
			]);

			const setBookPathSpy = vi.spyOn(view, 'setBookPath');
			menu.items[0].clickHandler?.();
			expect(setBookPathSpy).toHaveBeenCalledWith('Novels/第1部');
		});
	});

	describe('Lifecycle & Generation Safety', () => {
		it('clears search scope only when switching works', () => {
			const view = new WorkbenchView(mockLeaf as never, plugin);
			vi.spyOn(view, 'reloadBoard').mockResolvedValue();
			view.currentBookPath = 'NovelA';
			const clear = vi.spyOn(view['filterIndex'], 'clear');
			view.setBookPath('NovelB');
			expect(clear).toHaveBeenCalledOnce();
			view.setBookPath('NovelB');
			expect(clear).toHaveBeenCalledOnce();
		});
		it('should cancel hasPendingReload on close, gate closed reloads, and prevent restarting after close', async () => {
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			let renderCount = 0;
			const renderDeferred: { resolve?: () => void } = {};
			const viewInternal = view as unknown as {
				isClosed: boolean;
				isReloadingBoard: boolean;
				hasPendingReload: boolean;
				renderBoard: () => Promise<void>;
			};

			viewInternal.renderBoard = vi.fn().mockImplementation(() => {
				renderCount++;
				return new Promise<void>((resolve) => {
					renderDeferred.resolve = resolve;
				});
			});

			// Start first reload
			const reload1 = view.reloadBoard();
			expect(viewInternal.isReloadingBoard).toBe(true);

			// Queue a pending reload
			void view.reloadBoard();
			expect(viewInternal.hasPendingReload).toBe(true);
			expect(renderCount).toBe(1);

			// Now close the view while reload is in-flight
			await view.onClose();

			expect(viewInternal.isClosed).toBe(true);
			expect(viewInternal.hasPendingReload).toBe(false);

			// Finish the in-flight render
			renderDeferred.resolve?.();
			await reload1;

			// Reload should NOT have restarted after close
			expect(renderCount).toBe(1);
			expect(viewInternal.isReloadingBoard).toBe(false);
			expect(viewInternal.hasPendingReload).toBe(false);

			// Any further reloadBoard call on closed view is gated and returns immediately
			await view.reloadBoard();
			expect(renderCount).toBe(1);
		});

		it('should own local component per render, unload stale component on supersede, and swap only current generation', async () => {
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;
			(view as unknown as { sortMode: string }).sortMode = 'timeline';

			const capturedComponents: Array<import('obsidian').Component> = [];
			const render1Deferred: { resolve?: () => void } = {};

			(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockImplementation((opts: { ownerComponent?: import('obsidian').Component }) => {
				if (opts.ownerComponent) {
					capturedComponents.push(opts.ownerComponent);
				}
				if (capturedComponents.length === 1) {
					return new Promise<void>((resolve) => {
						render1Deferred.resolve = resolve;
					});
				}
				return Promise.resolve();
			});

			const viewInternal = view as unknown as {
				renderBoard: () => Promise<void>;
				currentRenderId: number;
				currentBoardComponent: import('obsidian').Component | null;
			};

			// Start render 1 (in-flight)
			const render1Promise = viewInternal.renderBoard();
			await new Promise(r => setTimeout(r, 0));
			expect(capturedComponents).toHaveLength(1);
			const comp1 = capturedComponents[0];
			expect(comp1).toBeDefined();
			expect(comp1.load).toHaveBeenCalled();
			expect(comp1.unload).not.toHaveBeenCalled();

			// Start render 2 before render 1 finishes -> render 1 becomes stale
			const render2Promise = viewInternal.renderBoard();
			await new Promise(r => setTimeout(r, 0));
			expect(capturedComponents).toHaveLength(2);
			const comp2 = capturedComponents[1];
			expect(comp2).not.toBe(comp1);

			// Finish render 1 (now stale)
			render1Deferred.resolve?.();
			await render1Promise;

			// Stale comp1 must be unloaded and not become the active component
			expect(comp1.unload).toHaveBeenCalled();
			expect(viewInternal.currentBoardComponent).not.toBe(comp1);

			// Let render 2 finish
			await render2Promise;

			// Successful comp2 becomes the displayed board component
			expect(viewInternal.currentBoardComponent).toBe(comp2);
			expect(comp2.unload).not.toHaveBeenCalled();

			// Start render 3 while comp2 is displayed
			const render3Deferred: { resolve?: () => void } = {};
			(TimelineBoardRenderer.render as ReturnType<typeof vi.fn>).mockImplementationOnce((opts: { ownerComponent?: import('obsidian').Component }) => {
				if (opts.ownerComponent) {
					capturedComponents.push(opts.ownerComponent);
				}
				return new Promise<void>((resolve) => {
					render3Deferred.resolve = resolve;
				});
			});

			const render3Promise = viewInternal.renderBoard();
			await new Promise(r => setTimeout(r, 0));
			expect(capturedComponents).toHaveLength(3);
			const comp3 = capturedComponents[2];

			// Crucial: Old comp2 must NOT be unloaded while render 3 is still pending
			expect(comp2.unload).not.toHaveBeenCalled();
			expect(viewInternal.currentBoardComponent).toBe(comp2);

			// Close view while render 3 is in-flight: unloads displayed comp2
			await view.onClose();
			expect(comp2.unload).toHaveBeenCalled();
			expect(viewInternal.currentBoardComponent).toBeNull();

			// Late finishing in-flight render 3 must be disposed immediately without swapping
			render3Deferred.resolve?.();
			await render3Promise;
			expect(comp3.unload).toHaveBeenCalled();
			expect(viewInternal.currentBoardComponent).toBeNull();
		});
	});

	describe('Workbench Board Visibility and Fallbacks', () => {
		it('should default all 6 boards enabled for backward compatibility when workbenchBoardVisibility is undefined', async () => {
			(plugin.settings as Record<string, unknown>).workbenchBoardVisibility = undefined;
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const toggleGroup = view.contentEl.querySelector('.wn-corkboard-toggle-group');
			expect(toggleGroup).toBeDefined();
			const buttons = toggleGroup?.querySelectorAll('.wn-corkboard-toggle-btn');
			// All 6 boards (default, timeline, lore, foreshadowing, task, journey) should be rendered
			expect(buttons?.length).toBe(6);
			expect((view as unknown as { sortMode: string }).sortMode).toBe('default');
		});

		it('should fall back to first available board when active or persisted mode is hidden', async () => {
			plugin.settings.corkboardSortMode = 'lore';
			(plugin.settings as Record<string, unknown>).workbenchBoardVisibility = {
				default: false,
				timeline: true,
				lore: false,
				foreshadowing: true,
				task: true,
				journey: false
			};
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			// Since 'lore' and 'default' are hidden, first available is 'timeline'
			expect((view as unknown as { sortMode: string }).sortMode).toBe('timeline');

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			const toggleGroup = view.contentEl.querySelector('.wn-corkboard-toggle-group');
			const buttons = toggleGroup?.querySelectorAll('.wn-corkboard-toggle-btn');
			expect(buttons?.length).toBe(3); // timeline, foreshadowing, task
			expect((view as unknown as { sortMode: string }).sortMode).toBe('timeline');
		});

		it('should show localized empty guidance with no board renderer and keep header usable to select book when all boards are disabled', async () => {
			(plugin.settings as Record<string, unknown>).workbenchBoardVisibility = {
				default: false,
				timeline: false,
				lore: false,
				foreshadowing: false,
				task: false,
				journey: false
			};
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			// No board renderer should be called
			expect(CorkboardGridRenderer.render).not.toHaveBeenCalled();
			expect(TimelineBoardRenderer.render).not.toHaveBeenCalled();
			expect(WritingJourneyBoardRenderer.render).not.toHaveBeenCalled();

			// Localized empty guidance must be displayed
			const emptyMsg = view.contentEl.querySelector('.wn-corkboard-empty-msg');
			expect(emptyMsg).toBeDefined();
			expect(emptyMsg?.textContent).toBe('corkboard.no-boards-enabled');

			// Header must remain usable to select novel
			const switchSpan = view.contentEl.querySelector('.wn-corkboard-switch-novel');
			expect(switchSpan).toBeDefined();
			(switchSpan as HTMLElement | null)?.click?.();
			expect(mockMenuInstances.length).toBe(1);

			// Active mode is null
			expect((view as unknown as { sortMode: unknown }).sortMode).toBeNull();
		});

		it('should fall back to first visible board when legacy sticky sort mode is configured', async () => {
			plugin.settings.corkboardSortMode = 'sticky';
			(plugin.settings as Record<string, unknown>).workbenchBoardVisibility = {
				default: true,
				timeline: true,
				lore: true,
				foreshadowing: true,
				task: true,
				journey: true
			};
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			// 'sticky' is legacy in workbench, must fall back to first available visible board ('default')
			expect((view as unknown as { sortMode: string }).sortMode).toBe('default');

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			const toggleGroup = view.contentEl.querySelector('.wn-corkboard-toggle-group');
			const buttons = toggleGroup?.querySelectorAll('.wn-corkboard-toggle-btn');
			expect(buttons?.length).toBe(6);
		});

		it('should render WritingJourneyBoardRenderer when journey board is active', async () => {
			plugin.settings.corkboardSortMode = 'journey';
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			expect((view as unknown as { sortMode: string }).sortMode).toBe('journey');

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(WritingJourneyBoardRenderer.render).toHaveBeenCalledWith(
				expect.objectContaining({
					currentBookPath: 'NovelA',
					query: '',
					isDescending: true
				})
			);
		});

		it('should immediately update open workbench views when webnovel-workbench-boards-changed event fires', async () => {
			let boardsChangedHandler: (() => void) | undefined;
			mockApp.workspace.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
				if (event === 'webnovel-workbench-boards-changed') {
					boardsChangedHandler = handler as () => void;
				}
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			expect(boardsChangedHandler).toBeDefined();
			const reloadSpy = vi.spyOn(view, 'reloadBoard');

			plugin.settings.workbenchBoardVisibility = { default: false, timeline: false, lore: false, foreshadowing: false, task: false, journey: false };
			boardsChangedHandler!();
			expect(reloadSpy).toHaveBeenCalled();
			await reloadSpy.mock.results[0].value;
			expect(view.contentEl.querySelector('.wn-corkboard-empty-msg')?.textContent).toBe('corkboard.no-boards-enabled');
			plugin.settings.workbenchBoardVisibility!.default = true;
			boardsChangedHandler!();
			await reloadSpy.mock.results[1].value;
			expect(view.contentEl.querySelectorAll('.wn-corkboard-toggle-btn').length).toBe(1);
		});

		it('should toggle journey sort descending/ascending independently from chapter sort', async () => {
			plugin.settings.corkboardSortMode = 'journey';
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			expect((view as unknown as { isJourneyDescending: boolean }).isJourneyDescending).toBe(true);
			expect((view as unknown as { isDescending: boolean }).isDescending).toBe(false);

			const sortToggle = view.contentEl.querySelector('.wn-workbench-sort-toggle') as unknown as MockElement;
			expect(sortToggle).toBeDefined();

			const reloadSpy = vi.spyOn(view, 'reloadBoard');
			sortToggle.click();

			expect((view as unknown as { isJourneyDescending: boolean }).isJourneyDescending).toBe(false);
			expect((view as unknown as { isDescending: boolean }).isDescending).toBe(false);
			expect(reloadSpy).toHaveBeenCalled();
		});

		it('should match workbench board label keys and getWorkbenchBoardLabel for all boards', () => {
			for (const boardId of WORKBENCH_BOARD_IDS) {
				const labelKey = WORKBENCH_BOARD_LABEL_KEYS[boardId];
				expect(labelKey).toBeDefined();
				expect(labelKey.length).toBeGreaterThan(0);
				expect(getWorkbenchBoardLabel(boardId)).toBe(labelKey);
			}
			expect(WORKBENCH_BOARD_LABEL_KEYS.journey).toBe('corkboard.sort-journey');
		});

		it('should deterministically target the latest volume and infer next chapter name from target folder chapters', async () => {
			const v1 = new MockTFolder('第一卷', 'NovelA/第一卷');
			const v2 = new MockTFolder('第二卷', 'NovelA/第二卷');
			const v1c1 = new MockTFile('第1章.md', 'NovelA/第一卷/第1章.md', v1);
			const v1c2 = new MockTFile('第2章.md', 'NovelA/第一卷/第2章.md', v1);
			const v1c3 = new MockTFile('第3章.md', 'NovelA/第一卷/第3章.md', v1);
			const v2c1 = new MockTFile('第1章.md', 'NovelA/第二卷/第1章.md', v2);
			const v2c2 = new MockTFile('第2章.md', 'NovelA/第二卷/第2章.md', v2);

			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([
				v2c1, v1c3, v2c2, v1c1, v1c2
			]);

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			// Shared board files passed to foreshadowing map preserve pre-change sorting (v1c3 is last because 3 > 2)
			const fmSpy = plugin.foreshadowingManager?.buildChapterForeshadowingMap as ReturnType<typeof vi.fn>;
			expect(fmSpy).toHaveBeenCalled();
			const sharedFilesArg = fmSpy.mock.calls[0][1] as import('obsidian').TFile[];
			expect(sharedFilesArg[sharedFilesArg.length - 1].path).toBe('NovelA/第一卷/第3章.md');

			const newChapterBtn = view.contentEl.querySelector('.wn-corkboard-new-chapter-btn') as HTMLElement;
			expect(newChapterBtn).toBeDefined();

			const folderSpy = vi.mocked(getLatestChapterFolderPath);
			folderSpy.mockClear();
			mockModalInstances.length = 0;
			(mockApp.vault.create as ReturnType<typeof vi.fn>).mockClear();

			newChapterBtn.click();

			expect(folderSpy).toHaveBeenCalled();
			const [bookPathArg, filesArg] = folderSpy.mock.calls[0];
			expect(bookPathArg).toBe('NovelA');
			// Deterministic volume-aware creationFiles: Volume 2's chapter 2 must be last, not Volume 1's chapter 3
			expect((filesArg as import('obsidian').TFile[])[filesArg.length - 1].path).toBe('NovelA/第二卷/第2章.md');
			expect(folderSpy.mock.results[0].value).toBe('NovelA/第二卷');

			// Modal receives defaultPrefix inferred strictly from Volume 2's chapters ('第3章 ')
			expect(mockModalInstances.length).toBe(1);
			const modal = mockModalInstances[0] as {
				defaultPrefix?: string;
				onSubmit?: (title: string, content: string) => void;
			};
			expect(modal.defaultPrefix).toBe('第3章 ');

			modal.onSubmit?.('第3章', 'dummy-template');
			expect(mockApp.vault.create).toHaveBeenCalledWith('NovelA/第二卷/第3章.md', 'dummy-template');

			// Even with isDescending: true on display, creation files remain ascending and Volume 2's chapter 2 is still last
			(view as unknown as { isDescending: boolean }).isDescending = true;
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const newChapterBtnDesc = view.contentEl.querySelector('.wn-corkboard-new-chapter-btn') as HTMLElement;
			folderSpy.mockClear();
			mockModalInstances.length = 0;
			(mockApp.vault.create as ReturnType<typeof vi.fn>).mockClear();

			newChapterBtnDesc.click();

			expect(folderSpy).toHaveBeenCalled();
			const [, filesArgDesc] = folderSpy.mock.calls[0];
			expect((filesArgDesc as import('obsidian').TFile[])[filesArgDesc.length - 1].path).toBe('NovelA/第二卷/第2章.md');
			expect(folderSpy.mock.results[0].value).toBe('NovelA/第二卷');

			expect(mockModalInstances.length).toBe(1);
			const modalDesc = mockModalInstances[0] as {
				defaultPrefix?: string;
				onSubmit?: (title: string, content: string) => void;
			};
			expect(modalDesc.defaultPrefix).toBe('第3章 ');

			modalDesc.onSubmit?.('第3章', '');
			expect(mockApp.vault.create).toHaveBeenCalledWith('NovelA/第二卷/第3章.md', '');
		});

		it('should use semantic Chinese numeral order for chapter creation when smart display sorting is disabled', async () => {
			plugin.settings.enableSmartChapterSort = false;
			const v1 = new MockTFolder('第一卷', 'NovelA/第一卷');
			const v2 = new MockTFolder('第二卷', 'NovelA/第二卷');
			const v1c1 = new MockTFile('第一章.md', 'NovelA/第一卷/第一章.md', v1);
			const v2c9 = new MockTFile('第九章.md', 'NovelA/第二卷/第九章.md', v2);
			const v2c10 = new MockTFile('第十章.md', 'NovelA/第二卷/第十章.md', v2);
			const v2c11 = new MockTFile('第十一章.md', 'NovelA/第二卷/第十一章.md', v2);

			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([v2c11, v1c1, v2c9, v2c10]);

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const newChapterBtn = view.contentEl.querySelector('.wn-corkboard-new-chapter-btn') as HTMLElement;
			mockModalInstances.length = 0;
			(mockApp.vault.create as ReturnType<typeof vi.fn>).mockClear();
			newChapterBtn.click();

			const modal = mockModalInstances[0] as {
				defaultPrefix?: string;
				onSubmit?: (title: string, content: string) => void;
			};
			expect(modal.defaultPrefix).toBe('第十二章 ');

			modal.onSubmit?.('第十二章', 'dummy-template');
			expect(mockApp.vault.create).toHaveBeenCalledWith('NovelA/第二卷/第十二章.md', 'dummy-template');
		});
	});

	describe('Important Only Filter', () => {
		it('should render important toggle button only on default and foreshadowing boards with accessible semantics', async () => {
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			// 1. Default board: toggle button exists with aria-pressed="false"
			(view as unknown as { sortMode: string }).sortMode = 'default';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			let toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle');
			expect(toggleBtn).not.toBeNull();
			expect(toggleBtn?.getAttribute('aria-pressed')).toBe('false');
			expect(toggleBtn?.getAttribute('aria-label')).toBe('corkboard.filter-important-only');
			expect(toggleBtn?.textContent).toBe('');
			expect(toggleBtn?.hasClass('wn-workbench-sort-toggle')).toBe(true);
			expect(toggleBtn?.querySelector('.wn-card-importance-icon')).not.toBeNull();
			expect(toggleBtn?.parentElement?.hasClass('wn-workbench-filter-actions')).toBe(true);

			// 2. Foreshadowing board: toggle button exists
			(view as unknown as { sortMode: string }).sortMode = 'foreshadowing';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle');
			expect(toggleBtn).not.toBeNull();
			expect(toggleBtn?.getAttribute('aria-pressed')).toBe('false');

			// 3. Journey board: toggle button does NOT exist
			(view as unknown as { sortMode: string }).sortMode = 'journey';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle');
			expect(toggleBtn).toBeNull();
		});

		it('should filter chapters by important toggle, compose with keyword search, update counts, and show empty state', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			const c2 = new MockTFile('第2章.md', 'NovelA/第2章.md');
			const c3 = new MockTFile('第3章.md', 'NovelA/第3章.md');

			const bookFolder = new MockTFolder('NovelA', 'NovelA');
			bookFolder.children = [c1, c2, c3];

			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'NovelA' ? bookFolder : null));
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1, c2, c3] as unknown as TFile[]);
			getCurrentBookContextMock.mockReturnValue('NovelA');

			// c1 is important (important: true), c2 is important via Chinese key (重要: true), c3 is not important
			mockApp.metadataCache.getFileCache.mockImplementation((file: unknown) => {
				const f = file as { path: string };
				if (f.path === 'NovelA/第1章.md') return { frontmatter: { important: true, synopsis: '主角登场' } };
				if (f.path === 'NovelA/第2章.md') return { frontmatter: { 重要: true, synopsis: '调查失踪' } };
				return { frontmatter: { synopsis: '日常过渡' } };
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			// Initial render: all 3 chapters shown
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
				expect.objectContaining({ files: [c1, c2, c3] })
			);

			// Click toggle: show only important (c1 and c2)
			const reloadSpy = vi.spyOn(view, 'reloadBoard');
			const toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle') as unknown as MockElement;
			toggleBtn.click();
			expect(reloadSpy).toHaveBeenCalled();

			// Render after toggle is active
			(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
				expect.objectContaining({ files: [c1, c2] })
			);
			const activeToggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle');
			expect(activeToggleBtn?.getAttribute('aria-pressed')).toBe('true');
			expect(activeToggleBtn?.hasClass('is-important')).toBe(true);

			// Now compose with keyword filter: "失踪" -> only c2 matches
			(view as unknown as { chapterFilterQuery: string }).chapterFilterQuery = '失踪';
			(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
				expect.objectContaining({ files: [c2] })
			);

			// Search keyword that matches nothing among important chapters: "日常" (only on c3 which is not important)
			(view as unknown as { chapterFilterQuery: string }).chapterFilterQuery = '日常';
			(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(CorkboardGridRenderer.render).not.toHaveBeenCalled();
			expect(view.contentEl.querySelector('.wn-corkboard-empty-msg')?.textContent).toBe('corkboard.filter-no-results');
		});

		it('should maintain independent in-memory toggle states between default and foreshadowing boards', async () => {
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			// In default mode, activate important toggle
			(view as unknown as { sortMode: string }).sortMode = 'default';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			let toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle') as unknown as MockElement;
			toggleBtn.click();

			expect((view as unknown as { isChapterImportantOnly: boolean }).isChapterImportantOnly).toBe(true);
			expect((view as unknown as { isForeshadowingImportantOnly: boolean }).isForeshadowingImportantOnly).toBe(false);

			// Switch to foreshadowing mode: toggle should be inactive
			(view as unknown as { sortMode: string }).sortMode = 'foreshadowing';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle') as unknown as MockElement;
			expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

			// Activate in foreshadowing mode
			toggleBtn.click();
			expect((view as unknown as { isChapterImportantOnly: boolean }).isChapterImportantOnly).toBe(true);
			expect((view as unknown as { isForeshadowingImportantOnly: boolean }).isForeshadowingImportantOnly).toBe(true);

			// Switch back to default mode: should still be active
			(view as unknown as { sortMode: string }).sortMode = 'default';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			toggleBtn = view.contentEl.querySelector('.wn-workbench-filter-important-toggle') as unknown as MockElement;
			expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
		});

		it('should filter foreshadowing entries with ForeshadowingBoardRenderer.filterEntries composing tags, query, and importance', () => {
			const entries = [
				{
					sourceFile: '第1章',
					createdAt: '2026-01-01',
					contents: [{ text: '密室的钥匙藏在画后', source: '第1章', time: '12:00' }],
					description: '密室钥匙伏笔',
					tags: ['主线', '线索'],
					status: ForeshadowingStatus.Pending,
					important: true
				},
				{
					sourceFile: '第2章',
					createdAt: '2026-01-02',
					contents: [{ text: '墙上的划痕', source: '第2章', time: '12:00' }],
					description: '划痕伏笔',
					tags: ['线索'],
					status: ForeshadowingStatus.Pending,
					important: false
				},
				{
					sourceFile: '第3章',
					createdAt: '2026-01-03',
					contents: [{ text: '老人的叹息', source: '第3章', time: '12:00' }],
					description: '身世伏笔',
					tags: ['支线'],
					status: ForeshadowingStatus.Pending,
					important: true
				}
			];

			// 1. Only important
			const onlyImp = ForeshadowingBoardRenderer.filterEntries(entries, { onlyImportant: true });
			expect(onlyImp.map(e => e.description)).toEqual(['密室钥匙伏笔', '身世伏笔']);

			// 2. Important + Tag filter
			const impAndTag = ForeshadowingBoardRenderer.filterEntries(entries, {
				onlyImportant: true,
				selectedTags: ['线索']
			});
			expect(impAndTag.map(e => e.description)).toEqual(['密室钥匙伏笔']);

			// 3. Important + Tag + Query
			const impTagQuery = ForeshadowingBoardRenderer.filterEntries(entries, {
				onlyImportant: true,
				selectedTags: ['线索'],
				query: '钥匙'
			});
			expect(impTagQuery.map(e => e.description)).toEqual(['密室钥匙伏笔']);

			// 4. Multiple selected tags use OR semantics within the tag group.
			const multiTag = ForeshadowingBoardRenderer.filterEntries(entries, {
				selectedTags: ['主线', '支线']
			});
			expect(multiTag.map(e => e.description)).toEqual(['密室钥匙伏笔', '身世伏笔']);

			// 4. Mismatched query
			const noMatch = ForeshadowingBoardRenderer.filterEntries(entries, {
				onlyImportant: true,
				query: '划痕'
			});
			expect(noMatch).toEqual([]);
		});
	});

	describe('Batch 4 optimization regressions', () => {
		it('avoids unused chapter enumeration and foreshadowing map for task/journey/lore-card/graph/trajectory', async () => {
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			const getFilesSpy = vi.spyOn(plugin, 'getTrackedMarkdownFiles');
			const fmSpy = plugin.foreshadowingManager?.buildChapterForeshadowingMap as ReturnType<typeof vi.fn>;

			// 1. Task board
			(view as unknown as { sortMode: string }).sortMode = 'task';
			getFilesSpy.mockClear();
			fmSpy.mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(getFilesSpy).not.toHaveBeenCalled();
			expect(fmSpy).not.toHaveBeenCalled();

			// 2. Journey board
			(view as unknown as { sortMode: string }).sortMode = 'journey';
			getFilesSpy.mockClear();
			fmSpy.mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(getFilesSpy).not.toHaveBeenCalled();
			expect(fmSpy).not.toHaveBeenCalled();

			// 3. Lore cards
			(view as unknown as { sortMode: string }).sortMode = 'lore';
			plugin.settings.loreBoardLayout = 'cards';
			getFilesSpy.mockClear();
			fmSpy.mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(getFilesSpy).not.toHaveBeenCalled();
			expect(fmSpy).not.toHaveBeenCalled();

			// 4. Lore graph
			plugin.settings.loreBoardLayout = 'graph';
			getFilesSpy.mockClear();
			fmSpy.mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(getFilesSpy).not.toHaveBeenCalled();
			expect(fmSpy).not.toHaveBeenCalled();

			// 5. Trajectory mode
			(view as unknown as { sortMode: string }).sortMode = 'timeline';
			(view as unknown as { isTimelineTrajectoryMode: boolean }).isTimelineTrajectoryMode = true;
			getFilesSpy.mockClear();
			fmSpy.mockClear();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(getFilesSpy).toHaveBeenCalled();
			expect(fmSpy).not.toHaveBeenCalled();

			await view.onClose();
		});

		it('lore table still receives enumerated chapters', async () => {
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			const loreSpy = vi.spyOn(LoreBoardRenderer, 'render').mockResolvedValue(undefined);
			(view as unknown as { sortMode: string }).sortMode = 'lore';
			plugin.settings.loreBoardLayout = 'table';

			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();
			expect(loreSpy).toHaveBeenCalled();
			const opts = loreSpy.mock.calls[0][0];
			expect(opts.files.length).toBeGreaterThan(0);
			expect(opts.files[0].path).toBe('NovelA/第1章.md');
			loreSpy.mockRestore();
			await view.onClose();
		});

		it('lazy create finds last chapter when clicked in layouts that skipped chapter enumeration', async () => {
			const v1 = new MockTFolder('NovelA', 'NovelA');
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md', v1);
			const c2 = new MockTFile('第2章.md', 'NovelA/第2章.md', v1);
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1, c2]);

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			(view as unknown as { sortMode: string }).sortMode = 'foreshadowing';
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			expect(plugin.getTrackedMarkdownFiles).not.toHaveBeenCalled();

			const newChapterBtn = view.contentEl.querySelector('.wn-corkboard-new-chapter-btn') as HTMLElement;
			expect(newChapterBtn).toBeDefined();

			mockModalInstances.length = 0;
			newChapterBtn.click();

			expect(plugin.getTrackedMarkdownFiles).toHaveBeenCalled();
			expect(mockModalInstances.length).toBe(1);
			const modal = mockModalInstances[0] as { defaultPrefix?: string };
			expect(modal.defaultPrefix).toBe('第3章 ');

			await view.onClose();
		});

		it('default single-file metadata update retains other card identity, header, and preserves collapsed state', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			const c2 = new MockTFile('第2章.md', 'NovelA/第2章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1, c2]);
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === c1.path) return c1;
				if (p === c2.path) return c2;
				return null;
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			vi.mocked(CorkboardGridRenderer.render).mockImplementation((opts) => {
				for (const f of opts.files) {
					const card = opts.container.createDiv('wn-corkboard-card');
					card.setAttribute('data-path', f.path);
					card.setAttribute('data-basename', f.basename);
					card.createDiv({ cls: 'wn-corkboard-card-title', text: f.basename });
				}
			});

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const headerBefore = view.contentEl.querySelector('.wn-corkboard-header');
			const cardsBefore = view.contentEl.querySelectorAll('.wn-corkboard-card');
			expect(cardsBefore.length).toBe(2);
			const card1Before = cardsBefore[0];
			const card2Before = cardsBefore[1];

			card1Before.addClass('is-volume-collapsed');
			card1Before.addClass('is-important');

			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(c1);

			const headerAfter = view.contentEl.querySelector('.wn-corkboard-header');
			expect(headerAfter).toBe(headerBefore);

			const card2After = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第2章.md"]');
			expect(card2After).toBe(card2Before);

			const card1After = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]');
			expect(card1After).not.toBe(card1Before);
			expect(card1After?.hasClass('is-volume-collapsed')).toBe(true);
			expect(card1After?.hasClass('is-important')).toBe(false);

			await view.onClose();
		});

		it('preserves an editor opened while a full board render was awaiting data', async () => {
			const chapter = new MockTFile('第1章.md', 'NovelA/第1章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([chapter]);
			mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === chapter.path ? chapter : null);
			vi.mocked(CorkboardGridRenderer.render).mockImplementation(options => {
				const card = options.container.createDiv('wn-corkboard-card');
				card.setAttribute('data-path', chapter.path);
			});
			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			await view.onOpen();
			const header = view.contentEl.querySelector('.wn-corkboard-header');
			const card = view.contentEl.querySelector('.wn-corkboard-card')!;
			let finish!: () => void;
			vi.mocked(plugin.foreshadowingManager!.buildChapterForeshadowingMap).mockImplementationOnce(() => new Promise(resolve => {
				finish = () => resolve(new Map());
			}));
			(view as unknown as { invalidateForeshadowingCache(): void }).invalidateForeshadowingCache();
			const rendering = view.reloadBoard();
			const input = card.createEl('input', { cls: 'wn-corkboard-title-input' });
			input.value = 'Unsaved title';
			finish();
			await rendering;
			expect(view.contentEl.querySelector('.wn-corkboard-header')).toBe(header);
			expect(view.contentEl.querySelector('.wn-corkboard-title-input')).toBe(input);
			await view.onClose();
		});

		it('filtered and structural changes still trigger full rebuild', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1]);
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(c1);

			vi.mocked(CorkboardGridRenderer.render).mockImplementation((opts) => {
				const card = opts.container.createDiv('wn-corkboard-card');
				card.setAttribute('data-path', c1.path);
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			// 1. Filter query -> full rebuild
			(view as unknown as { chapterFilterQuery: string }).chapterFilterQuery = 'search';
			const header1 = view.contentEl.querySelector('.wn-corkboard-header');
			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(c1);
			await new Promise((r) => setTimeout(r, 0));
			const header2 = view.contentEl.querySelector('.wn-corkboard-header');
			expect(header2).not.toBe(header1);

			// 2. Important only -> full rebuild
			(view as unknown as { chapterFilterQuery: string }).chapterFilterQuery = '';
			(view as unknown as { isChapterImportantOnly: boolean }).isChapterImportantOnly = true;
			const header3 = view.contentEl.querySelector('.wn-corkboard-header');
			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(c1);
			await new Promise((r) => setTimeout(r, 0));
			const header4 = view.contentEl.querySelector('.wn-corkboard-header');
			expect(header4).not.toBe(header3);

			await view.onClose();
		});

		it('active editor is retained and updated after blur', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			const c2 = new MockTFile('第2章.md', 'NovelA/第2章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1, c2]);
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === c1.path) return c1;
				if (p === c2.path) return c2;
				return null;
			});

			vi.mocked(CorkboardGridRenderer.render).mockImplementation((opts) => {
				for (const f of opts.files) {
					const card = opts.container.createDiv('wn-corkboard-card');
					card.setAttribute('data-path', f.path);
					card.setAttribute('data-basename', f.basename);
				}
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const card1 = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]')!;
			const card2 = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第2章.md"]')!;

			const input = card1.createEl('input', { cls: 'wn-corkboard-title-input' });
			input.value = 'User typing...';

			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(c1);
			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(c2);

			// card1 must NOT be replaced while editor is active
			expect(view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]')).toBe(card1);
			expect(card1.querySelector('input')?.value).toBe('User typing...');

			// card2 can be replaced
			expect(view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第2章.md"]')).not.toBe(card2);

			// Blur ends editing
			input.addEventListener('blur', () => { input.remove(); });
			input.blur();
			await new Promise((r) => setTimeout(r, 350));

			// Now card1 is replaced
			const card1AfterBlur = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]');
			expect(card1AfterBlur).not.toBe(card1);

			await view.onClose();
		});

		it('focused non-editor button does not treat card as editing or create a reschedule loop', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1]);
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(c1);

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			vi.mocked(CorkboardGridRenderer.render).mockImplementation((opts) => {
				const card = opts.container.createDiv('wn-corkboard-card');
				(card as unknown as { ownerDocument: unknown }).ownerDocument = (view.contentEl as unknown as { ownerDocument: unknown }).ownerDocument;
				card.setAttribute('data-path', c1.path);
				const btn = card.createDiv('wn-card-btn');
				btn.focus = () => {
					((view.contentEl as unknown as { ownerDocument: { activeElement: unknown } }).ownerDocument).activeElement = btn;
				};
			});

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const card = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]')!;
			const btn = card.querySelector<HTMLElement>('.wn-card-btn')!;
			btn.focus();

			// Calling isCardEditing on this card must be false
			const isEditing = (view as unknown as { isCardEditing: (c: unknown) => boolean }).isCardEditing(card);
			expect(isEditing).toBe(false);

			await view.onClose();
		});

		it('ignores unrelated work events', async () => {
			const vaultHandlers: Record<string, ((...args: unknown[]) => void)> = {};
			mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
				vaultHandlers[event] = handler;
			});

			const debounceSpy = vi.fn();
			plugin.adaptiveDebounceManager = {
				debounceFixed: debounceSpy,
				cancel: vi.fn()
			};

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			const otherFile = new MockTFile('第1章.md', 'NovelB/第1章.md');

			// Unrelated rename
			vaultHandlers['rename'](otherFile, 'NovelB/old.md');
			expect(debounceSpy).not.toHaveBeenCalled();

			// Unrelated delete
			vaultHandlers['delete'](otherFile);
			expect(debounceSpy).not.toHaveBeenCalled();

			// Unrelated modify
			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(otherFile);
			expect(debounceSpy).not.toHaveBeenCalled();

			await view.onClose();
		});

		it('rapid work switch and view close prevents stale updates and cache poisoning', async () => {
			let resolveForeshadowing: ((val: Map<string, import('../src/types/foreshadowing').ParsedForeshadowingEntry[]>) => void) | null = null;
			(plugin.foreshadowingManager!.buildChapterForeshadowingMap as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
				return new Promise(resolve => {
					resolveForeshadowing = resolve;
				});
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			const renderPromise = (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			// Switch to NovelB
			view.setBookPath('NovelB');

			const staleEntry = { description: 'stale' } as import('../src/types/foreshadowing').ParsedForeshadowingEntry;
			const staleMap = new Map<string, import('../src/types/foreshadowing').ParsedForeshadowingEntry[]>([
				['NovelA/第1章.md', [staleEntry]]
			]);
			resolveForeshadowing!(staleMap);
			await renderPromise;

			expect((view as unknown as { cachedForeshadowingMap: Map<string, unknown> | null }).cachedForeshadowingMap).not.toBe(staleMap);
			expect((view as unknown as { cachedForeshadowingMap: Map<string, unknown> | null }).cachedForeshadowingMap?.get('NovelA/第1章.md')).toBeUndefined();

			// Cache key reflects chapter changes
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			const key1 = (view as unknown as { getForeshadowingCacheKey: (bp: string, f: import('obsidian').TFile[]) => string }).getForeshadowingCacheKey('NovelA', [c1 as unknown as import('obsidian').TFile]);
			c1.stat = { mtime: 2 };
			const key2 = (view as unknown as { getForeshadowingCacheKey: (bp: string, f: import('obsidian').TFile[]) => string }).getForeshadowingCacheKey('NovelA', [c1 as unknown as import('obsidian').TFile]);
			expect(key1).not.toBe(key2);

			await view.onClose();
		});

		it('deferred old editor blurring after work switch or close does not schedule refresh on new work', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1]);
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(c1);

			vi.mocked(CorkboardGridRenderer.render).mockImplementation((opts) => {
				const card = opts.container.createDiv('wn-corkboard-card');
				(card as unknown as { ownerDocument: unknown }).ownerDocument = opts.container.ownerDocument;
				card.setAttribute('data-path', c1.path);
			});

			const debounceSpy = vi.fn();
			plugin.adaptiveDebounceManager = {
				debounceFixed: debounceSpy,
				cancel: vi.fn()
			};

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const card = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]')!;
			const input = card.createEl('input', { cls: 'wn-corkboard-title-input' });

			// Incremental refresh triggered while editing is active -> deferred
			(view as unknown as { handleMarkdownFileChanged: (f: unknown) => void }).handleMarkdownFileChanged(c1);

			// Switch work to NovelB before editor blurs
			view.setBookPath('NovelB');
			debounceSpy.mockClear();

			// Old editor blurs AFTER work switch
			input.blur();
			await new Promise((r) => setTimeout(r, 50));

			// Must not schedule any incremental or full refresh on NovelB
			expect(debounceSpy).not.toHaveBeenCalled();

			await view.onClose();
		});

		it('structural refresh during slow edit save is deferred until save completes and has priority over card updates', async () => {
			const c1 = new MockTFile('第1章.md', 'NovelA/第1章.md');
			plugin.getTrackedMarkdownFiles = vi.fn().mockReturnValue([c1]);
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(c1);

			vi.mocked(CorkboardGridRenderer.render).mockImplementation((opts) => {
				const card = opts.container.createDiv('wn-corkboard-card');
				(card as unknown as { ownerDocument: unknown }).ownerDocument = opts.container.ownerDocument;
				card.setAttribute('data-path', c1.path);
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			await view.onOpen();
			await (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			const headerBefore = view.contentEl.querySelector('.wn-corkboard-header');
			const card = view.contentEl.querySelector('.wn-corkboard-card[data-path="NovelA/第1章.md"]')!;
			const input = card.createEl('input', { cls: 'wn-corkboard-title-input' });
			input.value = 'Editing...';

			// Trigger a structural refresh while editing
			await view.reloadBoard();

			// Header must NOT have been recreated yet because reload was deferred
			expect(view.contentEl.querySelector('.wn-corkboard-header')).toBe(headerBefore);
			expect((view as unknown as { hasPendingDeferredFullReload: boolean }).hasPendingDeferredFullReload).toBe(true);

			// Simulate async save start
			(view as unknown as { handleSaveStateChange: (s: boolean) => void }).handleSaveStateChange(true);
			input.blur();

			// Still saving -> reload remains deferred
			expect(view.contentEl.querySelector('.wn-corkboard-header')).toBe(headerBefore);

			// Save finishes
			input.remove();
			(view as unknown as { handleSaveStateChange: (s: boolean) => void }).handleSaveStateChange(false);
			await new Promise((r) => setTimeout(r, 50));

			// Full reload completed and replaced header
			expect(view.contentEl.querySelector('.wn-corkboard-header')).not.toBe(headerBefore);
			expect((view as unknown as { hasPendingDeferredFullReload: boolean }).hasPendingDeferredFullReload).toBe(false);

			await view.onClose();
		});

		it('handles vault create as structural refresh and follows work-root or ancestor folder rename', async () => {
			const vaultHandlers: Record<string, ((...args: unknown[]) => void)> = {};
			mockApp.vault.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
				vaultHandlers[event] = handler;
			});

			const debounceSpy = vi.fn();
			plugin.adaptiveDebounceManager = {
				debounceFixed: debounceSpy,
				cancel: vi.fn()
			};

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'Novels/NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			const setBookPathSpy = vi.spyOn(view, 'setBookPath');

			// 1. Vault create inside current work
			const newChapter = new MockTFile('第10章.md', 'Novels/NovelA/第10章.md');
			vaultHandlers['create'](newChapter);
			expect(debounceSpy).toHaveBeenCalled();
			debounceSpy.mockClear();

			// 2. Vault create outside current work -> ignored
			const otherChapter = new MockTFile('第1章.md', 'Other/第1章.md');
			vaultHandlers['create'](otherChapter);
			expect(debounceSpy).not.toHaveBeenCalled();

			// 3. Rename of selected work root -> follow moved path via setBookPath
			const renamedFolder = new MockTFolder('NovelRenamed', 'Novels/NovelRenamed');
			vaultHandlers['rename'](renamedFolder, 'Novels/NovelA');
			expect(setBookPathSpy).toHaveBeenCalledWith('Novels/NovelRenamed');
			setBookPathSpy.mockClear();

			// 4. Rename of ancestor folder -> follow moved path via setBookPath
			view.currentBookPath = 'Novels/NovelA';
			const movedAncestor = new MockTFolder('Stories', 'Stories');
			vaultHandlers['rename'](movedAncestor, 'Novels');
			expect(setBookPathSpy).toHaveBeenCalledWith('Stories/NovelA');

			await view.onClose();
		});

		it('switching layout during deferred foreshadowing map prevents wrong layout and cache poisoning', async () => {
			let resolveForeshadowing: ((val: Map<string, import('../src/types/foreshadowing').ParsedForeshadowingEntry[]>) => void) | null = null;
			(plugin.foreshadowingManager!.buildChapterForeshadowingMap as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
				return new Promise(resolve => {
					resolveForeshadowing = resolve;
				});
			});

			const view = new WorkbenchView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, plugin);
			view.currentBookPath = 'NovelA';
			(view as unknown as { container: unknown }).container = view.contentEl;

			// Initial render in default layout
			const renderPromise = (view as unknown as { renderBoard: () => Promise<void> }).renderBoard();

			// Switch layout to timeline while map is building
			(view as unknown as { sortMode: string }).sortMode = 'timeline';
			void view.reloadBoard();

			const staleEntry = { description: 'stale-corkboard' } as import('../src/types/foreshadowing').ParsedForeshadowingEntry;
			const staleMap = new Map<string, import('../src/types/foreshadowing').ParsedForeshadowingEntry[]>([
				['NovelA/第1章.md', [staleEntry]]
			]);
			resolveForeshadowing!(staleMap);
			await renderPromise;

			// Stale render should not commit stale map
			expect((view as unknown as { cachedForeshadowingMap: Map<string, unknown> | null }).cachedForeshadowingMap).not.toBe(staleMap);

			await view.onClose();
		});
	});
});
