import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchView, WORKBENCH_VIEW_TYPE, type WorkbenchViewPlugin } from '../src/ui/WorkbenchView';
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

	empty() {
		this.children = [];
		this.textContent = '';
	}

	appendChild(child: MockElement) {
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

	querySelector(): MockElement | null {
		return null;
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
			recurseChildren: () => {}
		},
		setIcon: vi.fn(),
		Notice: vi.fn(),
		Menu: vi.fn(),
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
		}
	};
});

vi.mock('../src/utils/path', () => ({
	getCurrentBookContext: getCurrentBookContextMock,
	findBookRoot: findBookRootMock,
	getLatestChapterFolderPath: vi.fn()
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
				parseEntries: vi.fn().mockReturnValue([])
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
});
