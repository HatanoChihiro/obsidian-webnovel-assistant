import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterOverviewView, CORKBOARD_VIEW_TYPE, type ChapterOverviewViewPlugin } from '../src/ui/ChapterOverviewView';
import { CorkboardGridRenderer } from '../src/ui/components/CorkboardGridRenderer';
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

class MockElement {
	isFragment = false;
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
	setSelectionRange = vi.fn((start: number, end: number) => {
		this.selectionStart = start;
		this.selectionEnd = end;
	});

	constructor(cls = '') {
		this.className = cls;
		if (cls) {
			cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
		}
	}

	get isConnected(): boolean {
		if (this.parentElement) return this.parentElement.isConnected;
		return true;
	}

	get firstChild(): MockElement | null {
		return this.children[0] ?? null;
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

	empty() {
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children = [];
		this.textContent = '';
	}

	appendChild(child: MockElement) {
		if (child.isFragment) {
			while (child.children.length > 0) {
				const item = child.children.shift()!;
				item.parentElement = this;
				this.children.push(item);
			}
			return child;
		}
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

	setText(text: string) {
		this.empty();
		this.textContent = text;
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
}

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
	createFragment: () => {
		const frag = new MockElement('');
		frag.isFragment = true;
		return frag;
	},
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
	filterDebounceTimer: number | null;
	filterIndex: {
		filterChapters: (files: readonly TFile[], query: string, getSynopsis: (file: TFile) => unknown) => Promise<TFile[]>;
	};
	scheduleFilterRefresh(input: { value: string; selectionStart?: number; selectionEnd?: number }, immediate?: boolean): void;
}

describe('ChapterOverviewView', () => {
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
				debounceFixed: vi.fn((_key: string, fn: () => void) => { fn(); })
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
			window.clearTimeout(harness.filterDebounceTimer);
			harness.filterDebounceTimer = null;
		}
		await view.reloadBoard();

		expect(CorkboardGridRenderer.render).not.toHaveBeenCalled();
		expect(view.contentEl.querySelector('.wn-corkboard-empty-msg')).not.toBeNull();

		const renderedInput = view.contentEl.querySelector('.wn-workbench-filter-input');
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

		// Trigger rename
		vaultHandlers['rename'](file2, 'NovelA/old.md');
		expect(debounceSpy).toHaveBeenCalledWith('chapter-overview-refresh', expect.any(Function), 500);

		// Trigger delete
		debounceSpy.mockClear();
		vaultHandlers['delete'](file2);
		expect(debounceSpy).toHaveBeenCalledWith('chapter-overview-refresh', expect.any(Function), 500);

		// Trigger metadataCache changed
		debounceSpy.mockClear();
		metadataHandlers['changed'](file1);
		expect(debounceSpy).toHaveBeenCalledWith('chapter-overview-refresh', expect.any(Function), 1000);

		// Close view
		await view.onClose();
		expect(cancelSpy).toHaveBeenCalledWith('chapter-overview-refresh');
	});
});
