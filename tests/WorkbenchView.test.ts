import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchView, WORKBENCH_VIEW_TYPE, type WorkbenchViewPlugin } from '../src/ui/WorkbenchView';
import { CorkboardGridRenderer } from '../src/ui/components/CorkboardGridRenderer';
import { TimelineBoardRenderer } from '../src/ui/components/TimelineBoardRenderer';
import type { TFile } from 'obsidian';

const { getCurrentBookContextMock, findBookRootMock, MockTFile, MockTFolder, mockMenuInstances, MockMenu } = vi.hoisted(() => {
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
		MockTFolder: HoistedMockTFolder,
		mockMenuInstances: instances,
		MockMenu: HoistedMockMenu
	};
});

class MockElement {
	parentElement: MockElement | null = null;
	children: MockElement[] = [];
	className = '';
	textContent = '';
	value = '';
	type = '';
	selectionStart = 0;
	selectionEnd = 0;
	private classes = new Set<string>();
	private attributes = new Map<string, string>();
	private listeners = new Map<string, Array<(e?: unknown) => void>>();
	focus = vi.fn();
	setSelectionRange = vi.fn();

	constructor(cls = '') {
		this.className = cls;
		if (cls) {
			cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
		}
	}

	get isConnected(): boolean {
		return true;
	}

	get classList() {
		return {
			add: (...tokens: string[]) => {
				tokens.forEach(t => this.classes.add(t));
				this.className = Array.from(this.classes).join(' ');
			},
			remove: (...tokens: string[]) => {
				tokens.forEach(t => this.classes.delete(t));
				this.className = Array.from(this.classes).join(' ');
			},
			contains: (token: string) => this.classes.has(token),
			toggle: (token: string, force?: boolean) => {
				const has = force !== undefined ? force : !this.classes.has(token);
				if (has) this.classes.add(token); else this.classes.delete(token);
				this.className = Array.from(this.classes).join(' ');
				return has;
			}
		};
	}

	addClass(...tokens: string[]) { this.classList.add(...tokens); return this; }
	removeClass(...tokens: string[]) { this.classList.remove(...tokens); return this; }
	toggleClass(token: string, force?: boolean) { return this.classList.toggle(token, force); }
	hasClass(token: string) { return this.classes.has(token); }

	get firstChild(): MockElement | null {
		return this.children[0] ?? null;
	}

	empty() {
		this.children = [];
		this.textContent = '';
	}

	appendChild(child: MockElement) {
		if (child.parentElement) {
			const idx = child.parentElement.children.indexOf(child);
			if (idx !== -1) {
				child.parentElement.children.splice(idx, 1);
			}
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	createDiv(opts?: string | { cls?: string; text?: string }) {
		const cls = typeof opts === 'string' ? opts : opts?.cls || '';
		const child = new MockElement(cls);
		if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	createSpan(opts?: string | { cls?: string; text?: string }) {
		const cls = typeof opts === 'string' ? opts : opts?.cls || '';
		const child = new MockElement(cls);
		if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	createEl(tag: string, opts?: { cls?: string; text?: string; type?: string }) {
		const cls = opts?.cls || '';
		const child = new MockElement(cls);
		if (opts?.text) child.textContent = opts.text;
		if (opts?.type) child.type = opts.type;
		this.appendChild(child);
		return child;
	}

	setAttr(key: string, val: string) { this.attributes.set(key, val); }
	setAttribute(key: string, val: string) { this.attributes.set(key, val); }
	getAttribute(key: string) { return this.attributes.get(key) ?? null; }

	addEventListener(event: string, fn: (e?: unknown) => void) {
		const arr = this.listeners.get(event) ?? [];
		arr.push(fn);
		this.listeners.set(event, arr);
	}

	dispatchEvent(event: string, e?: unknown) {
		const arr = this.listeners.get(event) ?? [];
		for (const fn of arr) fn(e);
	}

	setText(text: string) {
		this.empty();
		this.textContent = text;
		return this;
	}

	appendText(text: string) {
		this.textContent += text;
		return this;
	}

	querySelector(sel: string): MockElement | null {
		const match = (node: MockElement): boolean => {
			if (sel.startsWith('.')) {
				return node.hasClass(sel.slice(1));
			}
			if (sel === 'input' || sel.startsWith('input[')) {
				return node.type !== '';
			}
			return false;
		};
		const find = (node: MockElement): MockElement | null => {
			for (const c of node.children) {
				if (match(c)) return c;
				const nested = find(c);
				if (nested) return nested;
			}
			return null;
		};
		return find(this);
	}

	querySelectorAll(sel: string): MockElement[] {
		const match = (node: MockElement): boolean => {
			if (sel.startsWith('.')) return node.hasClass(sel.slice(1));
			return false;
		};
		const results: MockElement[] = [];
		const search = (node: MockElement) => {
			for (const c of node.children) {
				if (match(c)) results.push(c);
				search(c);
			}
		};
		search(this);
		return results;
	}
}

(globalThis as unknown as { createDiv: (opts?: unknown) => MockElement }).createDiv = function(opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
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
			this.contentEl = new MockElement('view-content');
			this.containerEl.children.push(this.contentEl);
			this.contentEl.parentElement = this.containerEl;
		}

		registerEvent(): void {}
		addChild<T>(child: T): T { return child; }
		removeChild(): void {}
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
		Modal: class {},
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

vi.mock('../src/utils/path', () => ({
	getCurrentBookContext: getCurrentBookContextMock,
	findBookRoot: findBookRootMock,
	getLatestChapterFolderPath: vi.fn()
}));

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

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

vi.mock('../src/i18n/data-keys', () => ({
	getNovelStatusText: () => '',
	getNovelInfoLabel: () => ''
}));

describe('WorkbenchView', () => {
	let plugin: WorkbenchViewPlugin;
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
			trigger: ReturnType<typeof vi.fn>;
		};
	};
	let mockLeaf: { app: unknown };
	let file1: InstanceType<typeof MockTFile>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockMenuInstances.length = 0;

		file1 = new MockTFile('第1章.md', 'NovelA/第1章.md');

		mockApp = {
			vault: {
				on: vi.fn(),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				cachedRead: vi.fn().mockResolvedValue('')
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
				ensureInitialized: vi.fn().mockResolvedValue(undefined)
			},
			foreshadowingManager: {
				findForeshadowingFile: vi.fn().mockReturnValue(null),
				parseEntries: vi.fn().mockReturnValue([]),
				buildChapterForeshadowingMap: vi.fn().mockResolvedValue(new Map())
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
		expect(debounceSpy).toHaveBeenCalledWith('workbench-refresh', expect.any(Function), 500);

		// Trigger delete
		debounceSpy.mockClear();
		vaultHandlers['delete'](file1);
		expect(debounceSpy).toHaveBeenCalledWith('workbench-refresh', expect.any(Function), 500);

		// Trigger modify
		debounceSpy.mockClear();
		vaultHandlers['modify'](file1);
		expect(debounceSpy).toHaveBeenCalledWith('workbench-refresh', expect.any(Function), 1000);

		// Trigger metadataCache changed
		debounceSpy.mockClear();
		metadataHandlers['changed'](file1);
		expect(debounceSpy).toHaveBeenCalledWith('workbench-refresh', expect.any(Function), 1000);

		// Close view
		await view.onClose();
		expect(cancelSpy).toHaveBeenCalledWith('workbench-refresh');
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
});
