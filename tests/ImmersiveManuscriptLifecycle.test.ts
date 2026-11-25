import { configurePluginNotices } from '../src/services/PluginNoticeService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, Notice, TFile, TFolder, type App, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/constants';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { ImmersiveManuscriptManager } from '../src/services/ImmersiveManuscriptManager';
import { ImmersiveReferenceManager } from '../src/services/ImmersiveReferenceManager';
import { ImmersiveManuscriptController } from '../src/ui/ImmersiveManuscriptController';
import { ImmersiveModeManager } from '../src/ui/ImmersiveModeManager';
import { preserveTypewriterViewport } from '../src/editor/TypewriterExtension';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type MeasureRequest<T = unknown> = {
	read(view: EditorView): T;
	write?(measure: T, view: EditorView): void;
	key?: unknown;
};

vi.mock('obsidian', () => {
	class MockTFolder {
		path: string;
		name: string;
		children: Array<MockTFile | MockTFolder> = [];
		parent: MockTFolder | null = null;
		constructor(path = '', name = '') {
			this.path = path;
			this.name = name;
		}
		isRoot(): boolean {
			return this.path === '/' || this.path === '';
		}
	}
	class MockTFile {
		path: string;
		name: string;
		basename: string;
		extension = 'md';
		parent: MockTFolder | null = null;
		constructor(path = '', name = '') {
			this.path = path;
			this.name = name;
			this.basename = name.replace(/\.md$/i, '');
		}
	}
	class MockMarkdownView {
		file: MockTFile | null = null;
		contentEl: unknown = null;
		editor: unknown = null;
		getViewType(): string { return 'markdown'; }
	}
	class MockModal {
		modalEl = { addClass: vi.fn() };
		containerEl = { addClass: vi.fn() };
		contentEl = { empty: vi.fn() };
		open() {}
		close() {}
	}
	return {
		TFile: MockTFile,
		TFolder: MockTFolder,
		MarkdownView: MockMarkdownView,
		Platform: { isMobile: false, isDesktop: true, isPhone: false, isTablet: false },
		ItemView: class {},
		View: class {},
		Modal: MockModal,
		FuzzySuggestModal: MockModal,
		Setting: class {
			setName() { return this; }
			setDesc() { return this; }
			setHeading() { return this; }
			addSlider() { return this; }
			addButton() { return this; }
		},
		ToggleComponent: class {
			toggleEl = { setAttribute: vi.fn() };
			setValue() { return this; }
			getValue() { return false; }
			setTooltip() { return this; }
			onChange() { return this; }
		},
		Notice: vi.fn(),
		setIcon: vi.fn(),
		normalizePath: (v: string) => v.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
	};
});

interface FakeNode {
	nodeType: number;
	parentElement: FakeEl | null;
	parentNode: FakeEl | null;
	nextSibling: FakeNode | null;
	nodeValue?: string;
}

class FakeEl implements FakeNode {
	nodeType = 1;
	tagName = 'DIV';
	parentElement: FakeEl | null = null;
	parentNode: FakeEl | null = null;
	children: FakeNode[] = [];
	className = '';
	textContent = '';
	innerText = '';
	dataset: Record<string, string> = {};
	offsetTop = 0;
	clientHeight = 700;
	scrollTop = 0;
	private _attrs = new Map<string, string>();
	private _classes = new Set<string>();
	private _styles = new Map<string, string>();
	private _listeners = new Map<string, Array<(e?: unknown) => void>>();
	ownerDocument!: FakeDoc;

	constructor(doc: FakeDoc, cls = '') {
		this.ownerDocument = doc;
		this.className = cls;
		cls.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
	}

	get nextSibling(): FakeNode | null {
		if (!this.parentElement) return null;
		const idx = this.parentElement.children.indexOf(this);
		return idx >= 0 && idx + 1 < this.parentElement.children.length ? this.parentElement.children[idx + 1] : null;
	}

	classList = {
		add: (...names: string[]) => {
			for (const n of names) {
				n.split(/\s+/).filter(Boolean).forEach(t => this._classes.add(t));
			}
			this.className = Array.from(this._classes).join(' ');
		},
		remove: (...names: string[]) => {
			for (const n of names) {
				n.split(/\s+/).filter(Boolean).forEach(t => this._classes.delete(t));
			}
			this.className = Array.from(this._classes).join(' ');
		},
		contains: (name: string) => this._classes.has(name)
	};

	style = {
		setProperty: (prop: string, val: string) => this._styles.set(prop, val),
		removeProperty: (prop: string) => this._styles.delete(prop),
		getPropertyValue: (prop: string) => this._styles.get(prop) ?? ''
	};

	setCssProps(props: Record<string, string>) {
		for (const [k, v] of Object.entries(props)) this._styles.set(k, v);
	}
	hide() {}
	show() {}
	isShown() { return true; }

	contains(other: FakeNode | null): boolean {
		let cur: FakeNode | null = other;
		while (cur) {
			if (cur === this) return true;
			cur = cur.parentNode;
		}
		return false;
	}

	appendChild<T extends FakeNode>(node: T): T {
		if (node === (this as unknown as FakeNode) || (node instanceof FakeEl && node.contains(this))) {
			throw new Error('HierarchyRequestError: cannot append parent into descendant');
		}
		if (node.parentNode) {
			const idx = node.parentNode.children.indexOf(node);
			if (idx !== -1) node.parentNode.children.splice(idx, 1);
		}
		node.parentNode = this;
		node.parentElement = this;
		this.children.push(node);
		return node;
	}

	insertBefore<T extends FakeNode>(node: T, ref: FakeNode | null): T {
		if (node === (this as unknown as FakeNode) || (node instanceof FakeEl && node.contains(this))) {
			throw new Error('HierarchyRequestError: cannot insert parent into descendant');
		}
		if (!ref || ref.parentNode !== this) return this.appendChild(node);
		if (node.parentNode) {
			const oldIdx = node.parentNode.children.indexOf(node);
			if (oldIdx !== -1) node.parentNode.children.splice(oldIdx, 1);
		}
		const idx = this.children.indexOf(ref);
		node.parentNode = this;
		node.parentElement = this;
		this.children.splice(idx, 0, node);
		return node;
	}

	removeChild(node: FakeNode): void {
		const idx = this.children.indexOf(node);
		if (idx !== -1) {
			this.children.splice(idx, 1);
			node.parentNode = null;
			node.parentElement = null;
		}
	}

	remove(): void {
		this.parentNode?.removeChild(this);
	}

	empty(): void {
		for (const c of [...this.children]) {
			c.parentNode = null;
			c.parentElement = null;
		}
		this.children = [];
	}

	createDiv(opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
		const el = new FakeEl(this.ownerDocument, opts?.cls || '');
		if (opts?.text !== undefined) el.textContent = opts.text;
		for (const [name, value] of Object.entries(opts?.attr ?? {})) el.setAttribute(name, value);
		return this.appendChild(el);
	}

	createSpan(opts?: { cls?: string; text?: string }): FakeEl {
		return this.createDiv(opts);
	}

	createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
		const el = this.createDiv(opts);
		el.tagName = tag.toUpperCase();
		if (opts?.attr) {
			for (const [k, v] of Object.entries(opts.attr)) {
				el.setAttribute(k, v);
			}
		}
		return el;
	}

	setAttribute(name: string, value: string): void {
		this._attrs.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this._attrs.get(name) ?? null;
	}

	removeAttribute(name: string): void {
		this._attrs.delete(name);
	}

	querySelector(sel: string): FakeEl | null {
		const cls = sel.startsWith('.') ? sel.slice(1) : sel;
		for (const child of this.children) {
			if (child instanceof FakeEl) {
				if (child.classList.contains(cls)) return child;
				const nested = child.querySelector(sel);
				if (nested) return nested;
			}
		}
		return null;
	}

	querySelectorAll(sel: string): FakeEl[] {
		const cls = sel.startsWith('.') ? sel.slice(1) : sel;
		const out: FakeEl[] = [];
		for (const child of this.children) {
			if (child instanceof FakeEl) {
				if (child.classList.contains(cls)) out.push(child);
				out.push(...child.querySelectorAll(sel));
			}
		}
		return out;
	}

	getElementsByClassName(cls: string): FakeEl[] {
		return this.querySelectorAll(`.${cls}`);
	}

	closest(sel: string): FakeEl | null {
		const cls = sel.startsWith('.') ? sel.slice(1) : sel;
		let cur: FakeEl | null = this;
		while (cur) {
			if (cur.classList.contains(cls)) return cur;
			cur = cur.parentElement;
		}
		return null;
	}

	getBoundingClientRect() {
		return { top: this.offsetTop, bottom: this.offsetTop + 200, left: 0, right: 600, width: 600, height: 200 };
	}

	scrollTo({ top }: { top: number }) {
		this.scrollTop = top;
	}

	addEventListener(type: string, handler: (e?: unknown) => void) {
		const list = this._listeners.get(type) ?? [];
		list.push(handler);
		this._listeners.set(type, list);
	}

	removeEventListener(type: string, handler: (e?: unknown) => void) {
		const list = this._listeners.get(type) ?? [];
		const idx = list.indexOf(handler);
		if (idx !== -1) list.splice(idx, 1);
	}

	dispatchEvent(type: string, evt: Record<string, unknown> = {}) {
		const list = [...(this._listeners.get(type) ?? [])];
		for (const h of list) h({ preventDefault: vi.fn(), stopPropagation: vi.fn(), target: this, ...evt });
	}
}

class FakeDoc {
	body: FakeEl;
	documentElement = { requestFullscreen: vi.fn().mockResolvedValue(undefined) };
	fullscreenElement = null;
	activeElement = null;
	defaultView: Record<string, unknown>;
	private _listeners = new Map<string, Array<(e?: unknown) => void>>();

	constructor() {
		this.body = new FakeEl(this, 'body');
		this.defaultView = {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			setInterval: globalThis.setInterval.bind(globalThis),
			clearInterval: globalThis.clearInterval.bind(globalThis),
			requestAnimationFrame: (cb: () => void) => globalThis.setTimeout(cb, 0),
			cancelAnimationFrame: (id: number) => globalThis.clearTimeout(id),
			addEventListener: this.addEventListener.bind(this),
			removeEventListener: this.removeEventListener.bind(this),
			getSelection: () => ({ toString: () => '' })
		};
	}

	createComment(text: string): FakeNode {
		return { nodeType: 8, parentElement: null, parentNode: null, nextSibling: null, nodeValue: text };
	}

	addEventListener(type: string, handler: (e?: unknown) => void) {
		const list = this._listeners.get(type) ?? [];
		list.push(handler);
		this._listeners.set(type, list);
	}

	removeEventListener(type: string, handler: (e?: unknown) => void) {
		const list = this._listeners.get(type) ?? [];
		const idx = list.indexOf(handler);
		if (idx !== -1) list.splice(idx, 1);
	}

	dispatchEvent(type: string, evt: Record<string, unknown> = {}) {
		const list = [...(this._listeners.get(type) ?? [])];
		for (const h of list) h({ preventDefault: vi.fn(), stopPropagation: vi.fn(), target: this, ...evt });
	}
}

beforeEach(() => { configurePluginNotices(() => true); });

describe('ImmersiveManuscriptController & Lifecycle Integration', () => {
	let doc: FakeDoc;
	let vaultFiles: Map<string, TFile | TFolder>;
	let fileContents: Map<string, string>;
	let workspaceHandlers: Map<string, Array<(...args: unknown[]) => void>>;
	let vaultHandlers: Map<string, Array<(...args: unknown[]) => void>>;
	let mockApp: App;
	let manuscriptManager: ImmersiveManuscriptManager;
	let referenceManager: ImmersiveReferenceManager;

	const getOrCreateFolder = (path: string): TFolder => {
		const norm = path.replace(/^\/+|\/+$/g, '');
		const existing = vaultFiles.get(norm || '/');
		if (existing instanceof TFolder) return existing;
		const name = norm ? (norm.split('/').pop() || norm) : '';
		const folder = new (TFolder as unknown as new (p: string, n: string) => TFolder)(norm || '/', name);
		vaultFiles.set(norm || '/', folder);
		if (norm) {
			const parentPath = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
			const parent = getOrCreateFolder(parentPath);
			(folder as unknown as { parent: TFolder }).parent = parent;
			(parent as unknown as { children: Array<TFile | TFolder> }).children.push(folder);
		}
		return folder;
	};

	const createFile = (path: string, content = ''): TFile => {
		const norm = path.replace(/^\/+|\/+$/g, '');
		const name = norm.split('/').pop() || norm;
		const file = new (TFile as unknown as new (p: string, n: string) => TFile)(norm, name);
		const parentPath = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
		const parent = getOrCreateFolder(parentPath);
		(file as unknown as { parent: TFolder }).parent = parent;
		(parent as unknown as { children: Array<TFile | TFolder> }).children.push(file);
		vaultFiles.set(norm, file);
		fileContents.set(norm, content);
		return file;
	};

	beforeEach(() => {
		doc = new FakeDoc();
		vaultFiles = new Map();
		fileContents = new Map();
		workspaceHandlers = new Map();
		vaultHandlers = new Map();
		ChapterSorter.setCustomRules(DEFAULT_SETTINGS.chapterNamingRules);
		vi.stubGlobal('activeDocument', doc);
		vi.stubGlobal('window', doc.defaultView);
		vi.stubGlobal('createDiv', (opts?: { cls?: string }) => new FakeEl(doc, opts?.cls || ''));
		vi.stubGlobal('createSpan', (opts?: { cls?: string }) => new FakeEl(doc, opts?.cls || ''));

		getOrCreateFolder('');
		getOrCreateFolder('Books/StarSea/设定');
		getOrCreateFolder('Books/MoonBay/设定');

		mockApp = {
			vault: {
				getName: () => 'TestVault',
				getRoot: () => getOrCreateFolder(''),
				getAbstractFileByPath: vi.fn((p: string) => vaultFiles.get(p.replace(/^\/+|\/+$/g, '') || '/') ?? null),
				cachedRead: vi.fn(async (f: TFile) => fileContents.get(f.path) ?? ''),
				on: vi.fn((ev: string, cb: (...args: unknown[]) => void) => {
					const list = vaultHandlers.get(ev) ?? [];
					list.push(cb);
					vaultHandlers.set(ev, list);
					return { ev, cb };
				}),
				offref: vi.fn()
			},
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getMostRecentLeaf: vi.fn().mockReturnValue(null),
				iterateAllLeaves: vi.fn(),
				setActiveLeaf: vi.fn(),
				updateOptions: vi.fn(),
				getLeaf: vi.fn(),
				createLeafBySplit: vi.fn(),
				on: vi.fn((ev: string, cb: (...args: unknown[]) => void) => {
					const list = workspaceHandlers.get(ev) ?? [];
					list.push(cb);
					workspaceHandlers.set(ev, list);
					return { ev, cb };
				}),
				offref: vi.fn(),
				trigger: vi.fn((ev: string, ...args: unknown[]) => {
					for (const cb of workspaceHandlers.get(ev) ?? []) cb(...args);
				})
			},
			commands: { executeCommandById: vi.fn() }
		} as unknown as App;

		const settings = {
			...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
			workspaceFolders: ['Books/StarSea', 'Books/MoonBay'],
			immersive: {
				...JSON.parse(JSON.stringify(DEFAULT_SETTINGS.immersive)),
				immersiveTopSlots: [],
				immersiveBottomSlots: [],
				immersiveLeftSlots: [],
				immersiveRightSlots: [],
				manuscriptModeEnabled: true
			}
		};

		const pluginForServices = {
			app: mockApp,
			settings,
			saveSettings: vi.fn().mockResolvedValue(undefined),
			settingsManager: { flush: vi.fn().mockResolvedValue(undefined) },
			isFileInWorkspace: (f: TFile) => settings.workspaceFolders.some((w: string) => f.path.startsWith(w + '/')),
			isFileInStrictChapterException: () => false,
			isPluginGeneratedFile: (base: string) => ['作品信息', '伏笔', '时间线', '限时任务'].includes(base),
			homepageManager: { getNovelFolders: () => [], getHomepageFilePath: () => '创作主页.md' }
		};

		manuscriptManager = new ImmersiveManuscriptManager(mockApp, pluginForServices);
		referenceManager = new ImmersiveReferenceManager(mockApp, pluginForServices);
		Object.assign(pluginForServices, { manuscriptManager, referenceManager });
	});

	afterEach(() => {
		manuscriptManager.destroy();
		referenceManager.destroy();
		vi.unstubAllGlobals();
	});

	function createFakeMarkdownLeaf(initialFile: TFile) {
		const leafEl = new FakeEl(doc, 'workspace-leaf');
		const leafContentEl = leafEl.createDiv({ cls: 'workspace-leaf-content' });
		const viewContentEl = leafContentEl.createDiv({ cls: 'view-content' });
		const sourceViewEl = viewContentEl.createDiv({ cls: 'markdown-source-view mod-cm6' });
		const cmDom = sourceViewEl.createDiv({ cls: 'cm-editor' });
		const contentDOM = cmDom.createDiv({ cls: 'cm-content' });
		const sentinelEl = viewContentEl.createDiv({ cls: 'view-footer-sentinel' });

		let cursor = { line: 0, ch: 0 };
		let viewData = fileContents.get(initialFile.path) ?? '';
		const cm = {
			dom: cmDom,
			contentDOM,
			composing: false,
			state: { selection: { main: { head: 0, empty: true } } },
			requestMeasure: vi.fn<(request?: MeasureRequest<unknown>) => void>(),
			dispatch: vi.fn(),
			focus: vi.fn(),
			coordsAtPos: vi.fn(() => ({ top: 120, bottom: 140, left: 10, right: 20 }))
		};
		const view = new (MarkdownView as unknown as new () => MarkdownView)();
		const saveFn = vi.fn(async () => {
			if (view.file) {
				fileContents.set(view.file.path, viewData);
			}
		});
		Object.assign(view, {
			file: initialFile,
			contentEl: viewContentEl,
			save: saveFn,
			getViewData: () => viewData,
			setViewDataForTest: (next: string) => { viewData = next; },
			getState: () => ({ file: view.file?.path, mode: 'source' }),
			getEphemeralState: () => ({}),
			setEphemeralState: vi.fn(),
			editor: {
				cm,
				focus: vi.fn(),
				getCursor: () => cursor,
				setCursor: (next: { line: number; ch: number }) => { cursor = next; },
				listSelections: () => [{ anchor: cursor, head: cursor }],
				setSelections: vi.fn(),
				getScrollInfo: () => ({ left: 0, top: 0 }),
				scrollTo: vi.fn(),
				lineCount: () => viewData.split(/\r?\n/).length,
				getLine: (line: number) => viewData.split(/\r?\n/)[line] ?? ''
			}
		});

		const leaf = {
			id: 'main-leaf',
			active: true,
			containerEl: leafEl,
			view,
			getViewState: () => ({ type: 'markdown', state: { file: view.file?.path, mode: 'source' } }),
			setViewState: vi.fn(async (vs: { type: string; state?: { file?: string } }) => {
				(view as unknown as { getViewType: () => string }).getViewType = () => vs.type;
				if (vs.type === 'markdown' && vs.state?.file) {
					const target = vaultFiles.get(vs.state.file);
					if (target instanceof TFile) {
						view.file = target;
						viewData = fileContents.get(target.path) ?? '';
					}
				}
			}),
			openFile: vi.fn(async (target: TFile) => {
				view.file = target;
				viewData = fileContents.get(target.path) ?? '';
			})
		} as unknown as WorkspaceLeaf;

		return { leaf, view, leafEl, viewContentEl, sourceViewEl, sentinelEl, cm, saveFn };
	}

	it('opens the active middle chapter at its card even when its native scroll offset is zero', () => {
		createFile('Books/StarSea/第1章.md', 'First fictional chapter');
		const second = createFile('Books/StarSea/第2章.md', 'Second fictional chapter');
		const host = createFakeMarkdownLeaf(second);
		const original = FakeEl.prototype.createDiv;
		let cardIndex = 0;
		const geometry = vi.spyOn(FakeEl.prototype, 'createDiv').mockImplementation(function (this: FakeEl, opts) {
			const element = original.call(this, opts);
			if (opts?.cls === 'wn-manuscript-card') element.offsetTop = cardIndex++ * 1000;
			return element;
		});
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, second)).toBe(true);
			expect(host.cm.dispatch).toHaveBeenCalledWith({ effects: preserveTypewriterViewport.of(null) });
			expect(controller.getScrollerElement()!.scrollTop).toBeGreaterThanOrEqual(980);
		} finally {
			controller.unmountSync();
			geometry.mockRestore();
		}
	});

	it('preserves the viewport when a preceding lazy chapter first materializes', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional preview');
		const second = createFile('Books/StarSea/第2章.md', 'Fictional active chapter');
		const host = createFakeMarkdownLeaf(second);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, second);
		const scroller = controller.getScrollerElement()!;
		const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(el => el.dataset.chapterPath === first.path)!;
		const preview = card.querySelector('.wn-manuscript-preview')!;
		scroller.scrollTop = 500;
		vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 700 } as DOMRect);
		vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({
			top: -500, bottom: preview.classList.contains('wn-manuscript-lazy-shell') ? -100 : 500,
			height: preview.classList.contains('wn-manuscript-lazy-shell') ? 400 : 1000
		}) as DOMRect);
		try {
			await new Promise(resolve => setTimeout(resolve, 10));
			expect(scroller.scrollTop).toBe(1100);
		} finally { controller.unmountSync(); }
	});

	it('allows lazy preview materialization while native scrollbar is held without forced scrollTop writes', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional preview');
		const second = createFile('Books/StarSea/第2章.md', 'Queued fictional preview');
		const third = createFile('Books/StarSea/第3章.md', 'Post-release fictional preview');
		const fourth = createFile('Books/StarSea/第4章.md', 'Fictional active chapter');
		const host = createFakeMarkdownLeaf(fourth);

		let ioCallback: ((entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) | null = null;
		doc.defaultView.IntersectionObserver = class MockIO {
			constructor(cb: (entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) {
				ioCallback = cb;
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		};

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, fourth);
		const scroller = controller.getScrollerElement()!;
		const cards = host.viewContentEl.querySelectorAll('.wn-manuscript-card');
		const card1 = cards.find(el => el.dataset.chapterPath === first.path)!;
		const card2 = cards.find(el => el.dataset.chapterPath === second.path)!;
		const card3 = cards.find(el => el.dataset.chapterPath === third.path)!;
		const preview1 = card1.querySelector('.wn-manuscript-preview')!;
		const preview2 = card2.querySelector('.wn-manuscript-preview')!;
		const preview3 = card3.querySelector('.wn-manuscript-preview')!;

		let scrollTopValue = 500;
		const scrollTopSetter = vi.fn((val: number) => { scrollTopValue = val; });
		Object.defineProperty(scroller, 'scrollTop', {
			configurable: true,
			get: () => scrollTopValue,
			set: scrollTopSetter
		});

		vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 700, left: 0, right: 600, width: 600, height: 700 } as DOMRect);
		for (const [card, preview] of [[card1, preview1], [card2, preview2], [card3, preview3]] as const) {
			vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({
				top: -500,
				bottom: preview.classList.contains('wn-manuscript-lazy-shell') ? -100 : 500,
				height: preview.classList.contains('wn-manuscript-lazy-shell') ? 400 : 1000
			}) as DOMRect);
		}

		try {
			(scroller as unknown as FakeEl).dispatchEvent('pointerdown', { clientX: 595, clientY: 300 });
			ioCallback!([
				{ target: card1 as unknown as FakeEl, isIntersecting: true },
				{ target: card2 as unknown as FakeEl, isIntersecting: true }
			]);
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(preview1.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(preview2.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(preview1.querySelector('.wn-manuscript-preview-line')?.textContent).toBe('Fictional preview');
			expect(preview2.querySelector('.wn-manuscript-preview-line')?.textContent).toBe('Queued fictional preview');
			expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(first);
			expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(second);
			expect(scrollTopSetter).not.toHaveBeenCalled();
			expect(scroller.scrollTop).toBe(500);

			// Releasing scrollbar restores normal above-viewport height compensation
			doc.dispatchEvent('pointerup');
			ioCallback!([{ target: card3 as unknown as FakeEl, isIntersecting: true }]);
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(preview3.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(scrollTopSetter).toHaveBeenCalledTimes(1);
			expect(scroller.scrollTop).toBe(1100);
		} finally { controller.unmountSync(); }
	});

	it('rejects delayed reads after teardownAsync and stale no-longer-visible reads without mutating DOM', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional preview');
		const second = createFile('Books/StarSea/第2章.md', 'Stale fictional preview');
		const third = createFile('Books/StarSea/第3章.md', 'Fictional active chapter');
		const host = createFakeMarkdownLeaf(third);

		let ioCallback: ((entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) | null = null;
		doc.defaultView.IntersectionObserver = class MockIO {
			constructor(cb: (entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) {
				ioCallback = cb;
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		};

		let resolveFirstRead!: (val: string) => void;
		let resolveSecondRead!: (val: string) => void;
		vi.mocked(mockApp.vault.cachedRead).mockImplementation((file: TFile) => {
			if (file.path === first.path) {
				return new Promise<string>((resolve) => { resolveFirstRead = resolve; });
			}
			if (file.path === second.path) {
				return new Promise<string>((resolve) => { resolveSecondRead = resolve; });
			}
			return Promise.resolve(fileContents.get(file.path) ?? '');
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, third);
		const scroller = controller.getScrollerElement()!;
		const cards = host.viewContentEl.querySelectorAll('.wn-manuscript-card');
		const card1 = cards.find(el => el.dataset.chapterPath === first.path)!;
		const card2 = cards.find(el => el.dataset.chapterPath === second.path)!;
		const preview1 = card1.querySelector('.wn-manuscript-preview')!;
		const preview2 = card2.querySelector('.wn-manuscript-preview')!;
		vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 700, left: 0, right: 600, width: 600, height: 700 } as DOMRect);

		(scroller as unknown as FakeEl).dispatchEvent('pointerdown', { clientX: 595, clientY: 300 });
		ioCallback!([
			{ target: card1 as unknown as FakeEl, isIntersecting: true },
			{ target: card2 as unknown as FakeEl, isIntersecting: true }
		]);
		await new Promise(resolve => setTimeout(resolve, 10));

		// Card 2 leaves viewport before its in-flight read resolves
		ioCallback!([{ target: card2 as unknown as FakeEl, isIntersecting: false }]);
		resolveSecondRead('Stale fictional preview');
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(preview2.classList.contains('wn-manuscript-lazy-shell')).toBe(true);

		// Teardown invalidates in-flight read for card 1
		const teardownPromise = controller.teardownAsync();
		resolveFirstRead('Fictional preview');
		await teardownPromise;
		expect(preview1.classList.contains('wn-manuscript-lazy-shell')).toBe(true);
		expect(controller.isMounted()).toBe(false);
	});

	it('handles held mousedown, blur, buttons=0, repeated drags, and ignores clicks on preview text near the right edge', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional preview');
		const second = createFile('Books/StarSea/第2章.md', 'Second fictional preview');
		const third = createFile('Books/StarSea/第3章.md', 'Third fictional preview');
		const fourth = createFile('Books/StarSea/第4章.md', 'Fictional active chapter');
		const host = createFakeMarkdownLeaf(fourth);

		let ioCallback: ((entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) | null = null;
		doc.defaultView.IntersectionObserver = class MockIO {
			constructor(cb: (entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) {
				ioCallback = cb;
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		};

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, fourth);
		const scroller = controller.getScrollerElement()!;
		const cards = host.viewContentEl.querySelectorAll('.wn-manuscript-card');
		const card1 = cards.find(el => el.dataset.chapterPath === first.path)!;
		const card2 = cards.find(el => el.dataset.chapterPath === second.path)!;
		const card3 = cards.find(el => el.dataset.chapterPath === third.path)!;
		const preview1 = card1.querySelector('.wn-manuscript-preview')!;
		const preview2 = card2.querySelector('.wn-manuscript-preview')!;
		const preview3 = card3.querySelector('.wn-manuscript-preview')!;

		scroller.scrollTop = 500;
		vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 700, left: 0, right: 600, width: 600, height: 700 } as DOMRect);
		for (const [card, preview] of [[card1, preview1], [card2, preview2], [card3, preview3]] as const) {
			vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({
				top: -500,
				bottom: preview.classList.contains('wn-manuscript-lazy-shell') ? -100 : 500,
				height: preview.classList.contains('wn-manuscript-lazy-shell') ? 400 : 1000
			}) as DOMRect);
		}

		try {
			// Repeated drag 1: pointerdown cancelled via blur restores normal compensation
			(scroller as unknown as FakeEl).dispatchEvent('pointerdown', { clientX: 595, clientY: 300 });
			expect((controller as unknown as { isScrollbarDragging: boolean }).isScrollbarDragging).toBe(true);
			doc.dispatchEvent('blur');
			expect((controller as unknown as { isScrollbarDragging: boolean }).isScrollbarDragging).toBe(false);

			ioCallback!([{ target: card1 as unknown as FakeEl, isIntersecting: true }]);
			await new Promise(resolve => setTimeout(resolve, 10));
			expect(preview1.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(scroller.scrollTop).toBe(1100);

			// Repeated drag 2: held via mousedown allows materialization without scrollTop jump
			(scroller as unknown as FakeEl).dispatchEvent('mousedown', { clientX: 595, clientY: 320 });
			expect((controller as unknown as { isScrollbarDragging: boolean }).isScrollbarDragging).toBe(true);
			ioCallback!([{ target: card2 as unknown as FakeEl, isIntersecting: true }]);
			await new Promise(resolve => setTimeout(resolve, 10));
			expect(preview2.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(scroller.scrollTop).toBe(1100);

			// Release via pointermove buttons=0 restores normal compensation for subsequent loads
			doc.dispatchEvent('pointermove', { buttons: 0 });
			expect((controller as unknown as { isScrollbarDragging: boolean }).isScrollbarDragging).toBe(false);
			ioCallback!([{ target: card3 as unknown as FakeEl, isIntersecting: true }]);
			await new Promise(resolve => setTimeout(resolve, 10));
			expect(preview3.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(scroller.scrollTop).toBe(1700);

			// Clicking preview text near right edge does not enter drag state
			(scroller as unknown as FakeEl).dispatchEvent('pointerdown', { clientX: 595, clientY: 300, target: preview1 });
			expect((controller as unknown as { isScrollbarDragging: boolean }).isScrollbarDragging).toBe(false);
		} finally {
			controller.unmountSync();
		}
	});

	it('keeps an active renamed chapter bound without reopening or replacing its editor', async () => {
		const chapter = createFile('Books/StarSea/第1章.md', 'Fictional draft');
		const host = createFakeMarkdownLeaf(chapter);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, chapter);
		const oldPath = chapter.path;
		vaultFiles.delete(oldPath);
		Object.assign(chapter, { path: 'Books/StarSea/第1章 新名.md', name: '第1章 新名.md', basename: '第1章 新名' });
		vaultFiles.set(chapter.path, chapter);
		for (const callback of vaultHandlers.get('rename') ?? []) callback(chapter, oldPath);
		await new Promise(resolve => setTimeout(resolve, 75));
		try {
			expect(controller.getActiveFilePath()).toBe(chapter.path);
			expect(host.leaf.openFile).not.toHaveBeenCalled();
			expect(host.sourceViewEl.parentElement?.classList.contains('wn-manuscript-editor-slot')).toBe(true);
		} finally { controller.unmountSync(); }
	});

	it('refreshes a modified inactive preview without reopening the active chapter', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional first chapter');
		const second = createFile('Books/StarSea/第2章.md', 'Fictional old preview');
		const host = createFakeMarkdownLeaf(first);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, first);
		await new Promise(resolve => setTimeout(resolve, 10));
		fileContents.set(second.path, 'Fictional external update');
		for (const callback of vaultHandlers.get('modify') ?? []) callback(second);
		await new Promise(resolve => setTimeout(resolve, 75));
		try {
			const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(el => el.dataset.chapterPath === second.path)!;
			expect(card.querySelector('.wn-manuscript-preview-line')?.textContent).toBe('Fictional external update');
			expect(host.view.file).toBe(first);
		} finally { controller.unmountSync(); }
	});

	it('suppresses native resize padding while hosted and restores its latest value on exit', () => {
		const chapter = createFile('Books/StarSea/第1章.md', 'Fictional short chapter');
		const host = createFakeMarkdownLeaf(chapter);
		let observed: FakeEl | null = null;
		let notifyResize!: () => void;
		const disconnect = vi.fn();
		doc.defaultView.MutationObserver = class {
			constructor(callback: () => void) { notifyResize = callback; }
			observe(target: FakeEl) { observed = target; }
			disconnect = disconnect;
		};
		host.cm.contentDOM.style.setProperty('padding-bottom', '440px');
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		controller.mount(host.leaf, chapter);
		try {
			expect(observed).toBe(host.cm.contentDOM);
			expect(host.cm.contentDOM.style.getPropertyValue('padding-bottom')).toBe('0px');
			// Obsidian writes this imperatively after CodeMirror's facet has run.
			host.cm.contentDOM.style.setProperty('padding-bottom', '620px');
			notifyResize();
			expect(host.cm.contentDOM.style.getPropertyValue('padding-bottom')).toBe('0px');
			const measures = host.cm.requestMeasure.mock.calls.length;
			notifyResize();
			expect(host.cm.requestMeasure.mock.calls.length).toBe(measures);
		} finally { controller.unmountSync(); }
		expect(disconnect).toHaveBeenCalled();
		expect(host.cm.contentDOM.style.getPropertyValue('padding-bottom')).toBe('620px');
	});

	it('rehosts .markdown-source-view into active card and restores exact DOM parent/sibling position and classes on unmount', () => {
		const ch1 = createFile('Books/StarSea/第1章 启航.md', '---\ntags: [a]\n---\n正文第一行\n正文第二行');
		const ch2 = createFile('Books/StarSea/第2章 星港.md', '第二章正文');
		const host = createFakeMarkdownLeaf(ch1);

		const controller = new ImmersiveManuscriptController({
			app: mockApp,
			manuscriptManager
		});

		expect(controller.mount(host.leaf, ch1)).toBe(true);
		expect(host.sourceViewEl.parentElement?.classList.contains('wn-manuscript-editor-slot')).toBe(true);
		expect(host.viewContentEl.classList.contains('wn-manuscript-view-content')).toBe(true);
		expect(host.leafEl.classList.contains('wn-manuscript-leaf')).toBe(true);
		expect(host.cm.requestMeasure).toHaveBeenCalled();

		// Never appends viewContentEl into sourceViewEl
		expect(host.sourceViewEl.contains(host.viewContentEl)).toBe(false);

		// Unmount restores exact position right before sentinelEl and cleans all classes
		controller.unmountSync();
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);
		expect(host.viewContentEl.children[0]).toBe(host.sourceViewEl);
		expect(host.viewContentEl.children[1]).toBe(host.sentinelEl);
		expect(host.viewContentEl.querySelector('.wn-manuscript-root')).toBeNull();
		expect(host.viewContentEl.classList.contains('wn-manuscript-view-content')).toBe(false);
		expect(host.leafEl.classList.contains('wn-manuscript-leaf')).toBe(false);
		expect(host.sourceViewEl.classList.contains('wn-manuscript-hosted-editor')).toBe(false);
		void ch2;
	});

	it('uses bounded lazy preview loading without reading all chapters at entry and maps clicks retaining frontmatter line offsets', async () => {
		const ch1 = createFile('Books/StarSea/第1章 启航.md', '第一章内容');
		const ch2 = createFile('Books/StarSea/第2章 星港.md', '---\ntitle: 星港\nstatus: draft\n---\n第二章第一行\n第二章第二行');
		const ch3 = createFile('Books/StarSea/第3章 远航.md', '第三章内容');
		const ch4 = createFile('Books/StarSea/第4章 未知.md', '第四章内容');
		const host = createFakeMarkdownLeaf(ch1);

		// Mock IntersectionObserver to notify only ch2 initially
		const observed = new Set<FakeEl>();
		let ioCallback: ((entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) | null = null;
		doc.defaultView.IntersectionObserver = class MockIO {
			constructor(cb: (entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) {
				ioCallback = cb;
			}
			observe(el: FakeEl) { observed.add(el); }
			unobserve(el: FakeEl) { observed.delete(el); }
			disconnect() { observed.clear(); }
		};

		const controller = new ImmersiveManuscriptController({
			app: mockApp,
			manuscriptManager
		});
		controller.mount(host.leaf, ch1);

		// Entry must NOT eagerly read all chapters
		expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();

		// Trigger intersection only for ch2
		const ch2Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch2.path)!;
		ioCallback!([{ target: ch2Card, isIntersecting: true }]);
		await new Promise(resolve => setTimeout(resolve, 10));

		expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
		expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(ch2);
		expect(mockApp.vault.cachedRead).not.toHaveBeenCalledWith(ch3);
		expect(mockApp.vault.cachedRead).not.toHaveBeenCalledWith(ch4);

		// Frontmatter has 4 lines (---\ntitle\nstatus\n---\n), so line 0 of body is physical line 4, line 1 is physical line 5!
		const ch2Lines = ch2Card.querySelectorAll('.wn-manuscript-preview-line');
		expect(ch2Lines[0].dataset.line).toBe('4');
		expect(ch2Lines[1].dataset.line).toBe('5');

		// Single click on line 5 activates ch2 at line 5, saving ch1 first
		const nativeOpen = vi.mocked(host.leaf.openFile).getMockImplementation()!;
		vi.mocked(host.leaf.openFile).mockImplementation(async (...args) => {
			await nativeOpen(...args);
			// The destination native editor can have a fresh typewriter instance.
			host.cm.dispatch.mockClear();
		});
		const ch2Preview = ch2Card.querySelector('.wn-manuscript-preview')!;
		ch2Preview.dispatchEvent('pointerdown', { clientX: 10, clientY: 160, target: ch2Lines[1] });
		ch2Preview.dispatchEvent('click', { clientX: 10, clientY: 160, target: ch2Lines[1] });
		await new Promise(resolve => setTimeout(resolve, 20));

		expect(host.saveFn).toHaveBeenCalledTimes(1);
		expect(host.view.file).toBe(ch2);
		expect(host.view.editor.getCursor().line).toBe(5);
		expect(host.cm.dispatch).toHaveBeenCalledWith({ effects: preserveTypewriterViewport.of(null) });
		expect(host.cm.dispatch).toHaveBeenLastCalledWith({ annotations: Transaction.userEvent.of('select') });

		controller.unmountSync();
	});

	it('keeps a clicked preview anchor after native scroll and deferred line-height measurement', async () => {
		vi.useFakeTimers();
		const first = createFile('Books/StarSea/第1章.md', 'Fictional first chapter');
		const second = createFile('Books/StarSea/第2章.md', 'Fictional second chapter');
		const host = createFakeMarkdownLeaf(first);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, first)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			let caretDocumentY = 800;
			host.cm.coordsAtPos.mockImplementation(() => ({
				top: caretDocumentY - scroller.scrollTop,
				bottom: caretDocumentY - scroller.scrollTop + 20,
				left: 10,
				right: 20
			}));
			host.cm.requestMeasure.mockImplementation(request => {
				if (!request) return;
				globalThis.setTimeout(() => {
					const cm = host.cm as unknown as EditorView;
					request.write?.(request.read(cm), cm);
				}, 0);
			});
			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 4,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(caretDocumentY - scroller.scrollTop + 10).toBe(160);
			// The native editor replaces estimated wrapping heights after the first alignment.
			caretDocumentY += 564;
			scroller.scrollTop += 80;
			await vi.advanceTimersByTimeAsync(48);
			expect(caretDocumentY - scroller.scrollTop + 10).toBeCloseTo(160, 1);
			expect(host.view.editor.getCursor()).toEqual({ line: 0, ch: 4 });
		} finally {
			controller.unmountSync();
			vi.useRealTimers();
		}
	});

	it('retries temporarily unavailable click-anchor coordinates, avoids layout reads in write, settles within a bounded pass count, and updates final position memory', async () => {
		vi.useFakeTimers();
		const first = createFile('Books/StarSea/第1章.md', 'Fictional first chapter');
		const second = createFile('Books/StarSea/第2章.md', 'Fictional second chapter');
		const host = createFakeMarkdownLeaf(first);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, first)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			const secondCard = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === second.path)!;
			secondCard.offsetTop = 500;

			let scrollTopValue = scroller.scrollTop;
			let inWritePhase = false;
			let readLayoutDuringWrite = false;
			Object.defineProperty(scroller, 'scrollTop', {
				configurable: true,
				get: () => {
					if (inWritePhase) readLayoutDuringWrite = true;
					return scrollTopValue;
				},
				set: (val: number) => {
					scrollTopValue = val;
				}
			});

			let caretDocumentY = 1400;
			let coordsCalls = 0;
			let measurePasses = 0;
			host.cm.coordsAtPos.mockImplementation(() => {
				if (inWritePhase) readLayoutDuringWrite = true;
				coordsCalls++;
				// Unmeasurable during immediate alignment and the first deferred measure pass.
				if (coordsCalls <= 2) return null as unknown as { top: number; bottom: number; left: number; right: number };
				return {
					top: caretDocumentY - scrollTopValue,
					bottom: caretDocumentY - scrollTopValue + 20,
					left: 10,
					right: 20
				};
			});
			host.cm.requestMeasure.mockImplementation(request => {
				if (!request) return;
				globalThis.setTimeout(() => {
					measurePasses++;
					const cm = host.cm as unknown as EditorView;
					const measured = request.read(cm);
					inWritePhase = true;
					try {
						request.write?.(measured, cm);
					} finally {
						inWritePhase = false;
					}
				}, 0);
			});

			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 4,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});

			await vi.advanceTimersByTimeAsync(100);
			expect(readLayoutDuringWrite).toBe(false);
			expect(caretDocumentY - scrollTopValue + 10).toBeCloseTo(160, 1);
			expect(measurePasses).toBeGreaterThanOrEqual(3);
			expect(measurePasses).toBeLessThanOrEqual(8);

			// Once settled, further timer advances must not schedule additional passes.
			const settledPasses = measurePasses;
			await vi.advanceTimersByTimeAsync(200);
			expect(measurePasses).toBe(settledPasses);

			// Position memory reflects the final stabilized viewport scrollTop (1250 - card.offsetTop 500 = 750).
			const saved = manuscriptManager.getValidatedLastPosition()?.position;
			expect(saved?.filePath).toBe(second.path);
			expect(saved?.chapterRelativeScroll).toBeCloseTo(scrollTopValue - secondCard.offsetTop, 1);

			// Permanently unmeasurable coordinates still terminate within the bounded pass limit.
			measurePasses = 0;
			host.cm.coordsAtPos.mockImplementation(() => null as unknown as { top: number; bottom: number; left: number; right: number });
			await controller.requestChapterSwitch({
				file: first,
				cursorLine: 0,
				cursorCh: 1,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			await vi.advanceTimersByTimeAsync(200);
			expect(measurePasses).toBe(8);
			await vi.advanceTimersByTimeAsync(200);
			expect(measurePasses).toBe(8);
		} finally {
			controller.unmountSync();
			vi.useRealTimers();
		}
	});

	it('cancels deferred click-anchor writes on user interaction, re-navigation, external target change, and unmount even when queued measure callbacks fire late', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional first chapter');
		const second = createFile('Books/StarSea/第2章.md', 'Fictional second chapter');
		const third = createFile('Books/StarSea/第3章.md', 'Fictional third chapter');
		const host = createFakeMarkdownLeaf(first);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, first)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			const queuedMeasures: Array<MeasureRequest<unknown>> = [];
			const flushQueuedMeasures = () => {
				const batch = queuedMeasures.splice(0, queuedMeasures.length);
				const cm = host.cm as unknown as EditorView;
				for (const req of batch) {
					req.write?.(req.read(cm), cm);
				}
			};

			let caretDocumentY = 800;
			host.cm.coordsAtPos.mockImplementation(() => ({
				top: caretDocumentY - scroller.scrollTop,
				bottom: caretDocumentY - scroller.scrollTop + 20,
				left: 10,
				right: 20
			}));
			host.cm.requestMeasure.mockImplementation(request => {
				if (request) queuedMeasures.push(request);
			});

			// 1. User wheel cancels stabilization; late queued measure must not overwrite scrollTop.
			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 3,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(queuedMeasures.length).toBe(1);
			caretDocumentY += 400;
			(scroller as unknown as FakeEl).dispatchEvent('wheel');
			scroller.scrollTop = 910;
			flushQueuedMeasures();
			expect(scroller.scrollTop).toBe(910);

			// 2. User typing (beforeinput) cancels stabilization; late queued measure must not write scrollTop.
			await controller.requestChapterSwitch({
				file: first,
				cursorLine: 0,
				cursorCh: 2,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(queuedMeasures.length).toBe(1);
			caretDocumentY += 350;
			host.cm.contentDOM.dispatchEvent('beforeinput');
			scroller.scrollTop = 777;
			flushQueuedMeasures();
			expect(scroller.scrollTop).toBe(777);

			// 3. Re-navigation invalidates old queued measure so it cannot pull back the new target.
			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 1,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			const staleRequest = queuedMeasures.shift()!;
			await controller.requestChapterSwitch({
				file: third,
				scrollMode: 'chapter-start'
			});
			scroller.scrollTop = 2100;
			caretDocumentY = 500;
			const cm = host.cm as unknown as EditorView;
			staleRequest.write?.(staleRequest.read(cm), cm);
			expect(scroller.scrollTop).toBe(2100);

			// 4. External file change or selection change invalidates queued measure without writing scrollTop.
			queuedMeasures.length = 0;
			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 4,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(queuedMeasures.length).toBe(1);
			host.view.file = third;
			caretDocumentY = 1800;
			scroller.scrollTop = 1234;
			flushQueuedMeasures();
			expect(scroller.scrollTop).toBe(1234);

			// Sync back to second, test cursor/selection change invalidation, then unmount invalidation.
			host.view.file = second;
			await controller.syncWithActiveChapter(second);
			await controller.requestChapterSwitch({
				file: first,
				cursorLine: 0,
				cursorCh: 2,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(queuedMeasures.length).toBe(1);
			host.view.editor.setCursor({ line: 0, ch: 6 });
			caretDocumentY = 2200;
			scroller.scrollTop = 888;
			flushQueuedMeasures();
			expect(scroller.scrollTop).toBe(888);

			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 2,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(queuedMeasures.length).toBe(1);
			const unmountedRequest = queuedMeasures.shift()!;
			scroller.scrollTop = 640;
			caretDocumentY = 2600;
			controller.unmountSync();
			unmountedRequest.write?.(unmountedRequest.read(cm), cm);
			expect(scroller.scrollTop).toBe(640);
		} finally {
			controller.unmountSync();
		}
	});

	it('does not schedule or fight click-anchor stabilization when manuscript typewriter is active', async () => {
		vi.useFakeTimers();
		const first = createFile('Books/StarSea/第1章.md', 'Fictional first chapter');
		const second = createFile('Books/StarSea/第2章.md', 'Fictional second chapter');
		const host = createFakeMarkdownLeaf(first);
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, first)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			let caretDocumentY = 800;
			const scheduledMeasureRequests: Array<MeasureRequest<unknown>> = [];
			host.cm.coordsAtPos.mockImplementation(() => ({
				top: caretDocumentY - scroller.scrollTop,
				bottom: caretDocumentY - scroller.scrollTop + 20,
				left: 10,
				right: 20
			}));
			host.cm.requestMeasure.mockImplementation(request => {
				if (!request) return;
				scheduledMeasureRequests.push(request);
				globalThis.setTimeout(() => {
					const cm = host.cm as unknown as EditorView;
					request.write?.(request.read(cm), cm);
				}, 0);
			});

			// 1. Typewriter already active before switch -> skips click-anchor stabilization and preserves select resume.
			scroller.classList.add('wn-manuscript-typewriter-active');
			await controller.requestChapterSwitch({
				file: second,
				cursorLine: 0,
				cursorCh: 4,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(scheduledMeasureRequests.length).toBe(0);
			expect(host.cm.dispatch).toHaveBeenLastCalledWith({ annotations: Transaction.userEvent.of('select') });
			// Simulate typewriter centering moving the viewport afterward.
			scroller.scrollTop = 450;
			caretDocumentY = 800;
			await vi.advanceTimersByTimeAsync(48);
			expect(scroller.scrollTop).toBe(450);

			// 2. Typewriter enabled mid-flight cancels pending stabilization without overwriting scrollTop.
			scroller.classList.remove('wn-manuscript-typewriter-active');
			await controller.requestChapterSwitch({
				file: first,
				cursorLine: 0,
				cursorCh: 2,
				scrollMode: 'click-anchor',
				clickAnchor: { clientY: 160, cardTopDelta: 0 }
			});
			expect(scheduledMeasureRequests.length).toBe(1);
			scroller.classList.add('wn-manuscript-typewriter-active');
			caretDocumentY += 500;
			scroller.scrollTop = 520;
			await vi.advanceTimersByTimeAsync(48);
			expect(scroller.scrollTop).toBe(520);
		} finally {
			controller.unmountSync();
			vi.useRealTimers();
		}
	});

	it('activates a newly created chapter at its body and keeps it active after the queued chapter-list refresh', async () => {
		const first = createFile('Books/StarSea/第1章.md', 'Fictional current draft');
		const host = createFakeMarkdownLeaf(first);
		const originalCreateDiv = FakeEl.prototype.createDiv;
		const geometry = vi.spyOn(FakeEl.prototype, 'createDiv').mockImplementation(function (this: FakeEl, opts) {
			const element = originalCreateDiv.call(this, opts);
			if (opts?.cls === 'wn-manuscript-card') {
				Object.defineProperty(element, 'offsetTop', {
					get: () => (element.parentElement?.children.indexOf(element) ?? 0) * 1000
				});
			}
			return element;
		});
		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			controller.mount(host.leaf, first);
			const scroller = controller.getScrollerElement()!;
			scroller.scrollTop = 450;
			const next = createFile('Books/StarSea/第2章.md', '---\nstatus: draft\n---\nFictional next chapter');
			for (const callback of vaultHandlers.get('create') ?? []) callback(next);
			await controller.requestChapterSwitch({ file: next, scrollMode: 'chapter-start' });
			expect(host.saveFn).toHaveBeenCalledTimes(1);
			expect(host.view.file).toBe(next);
			expect(controller.getActiveFilePath()).toBe(next.path);
			expect(host.view.editor.getCursor()).toEqual({ line: 3, ch: 0 });
			expect(scroller.scrollTop).toBeGreaterThanOrEqual(980);
			expect(host.cm.dispatch).toHaveBeenLastCalledWith({ annotations: Transaction.userEvent.of('select') });
			await new Promise(resolve => setTimeout(resolve, 75));
			expect(controller.getActiveFilePath()).toBe(next.path);
			expect(host.view.file).toBe(next);
			expect(scroller.scrollTop).toBeGreaterThanOrEqual(980);
			const activeCard = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(card => card.classList.contains('is-active'));
			expect(activeCard?.dataset.chapterPath).toBe(next.path);
			expect(activeCard?.contains(host.sourceViewEl)).toBe(true);
		} finally {
			controller.unmountSync();
			geometry.mockRestore();
		}
	});

	it('aborts switch and retains editor edits when MarkdownView.save() rejects, and defers switch while CM composing', async () => {
		const ch1 = createFile('Books/StarSea/第1章.md', '原稿内容');
		const ch2 = createFile('Books/StarSea/第2章.md', '第二章内容');
		const host = createFakeMarkdownLeaf(ch1);

		const controller = new ImmersiveManuscriptController({
			app: mockApp,
			manuscriptManager
		});
		controller.mount(host.leaf, ch1);

		// 1. Failed save must abort switch and preserve current file/data
		(host.view as unknown as { setViewDataForTest: (s: string) => void }).setViewDataForTest('未保存修改');
		host.saveFn.mockRejectedValueOnce(new Error('disk full'));
		await controller.requestChapterSwitch({ file: ch2, scrollMode: 'chapter-start' });
		expect(host.view.file).toBe(ch1);
		expect(host.view.getViewData()).toBe('未保存修改');
		expect(Notice).toHaveBeenCalled();

		// 2. IME composing defers switch until compositionend, and coalesces rapid requests to latest
		const ch3 = createFile('Books/StarSea/第3章.md', '第三章内容');
		host.cm.composing = true;
		const switchPromise = controller.requestChapterSwitch({ file: ch2, scrollMode: 'chapter-start' });
		void controller.requestChapterSwitch({ file: ch3, scrollMode: 'chapter-start' });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(host.view.file).toBe(ch1);

		host.cm.composing = false;
		host.cm.contentDOM.dispatchEvent('compositionend');
		await switchPromise;
		expect(host.view.file).toBe(ch3);

		controller.unmountSync();
	});

	it('ImmersiveModeManager restores last valid manuscript chapter when entering from non-chapter, fails safely when none exist, blocks external non-chapter file-open while allowing references, and awaits pending teardown on destroy', async () => {
		const ch1 = createFile('Books/StarSea/第1章.md', '第一章');
		const ch2 = createFile('Books/StarSea/第2章.md', '第二章');
		const outline = createFile('Books/StarSea/大纲.md', '大纲');
		const loreRef = createFile('Books/StarSea/设定/主角.md', '主角设定');
		const host = createFakeMarkdownLeaf(outline);

		await manuscriptManager.recordValidPosition({
			filePath: ch2.path,
			workPath: 'Books/StarSea',
			cursorLine: 0,
			cursorCh: 2,
			chapterRelativeScroll: 50
		}, true);

		const immPlugin = {
			app: mockApp,
			settings: manuscriptManager['plugin'].settings,
			stickyNoteManager: {
				syncActiveNotesToManager: vi.fn(),
				getNotes: vi.fn().mockReturnValue([]),
				saveNotes: vi.fn().mockResolvedValue(undefined),
				syncFloatingNotes: vi.fn()
			},
			settingsManager: { flush: vi.fn().mockResolvedValue(undefined) },
			adaptiveDebounceManager: { debounceFixed: vi.fn() },
			statisticsManager: { getCoreStats: vi.fn().mockReturnValue({ totalTime: '0', focusTime: '0', slackTime: '0', todayWords: 0, goal: 0, dailyWords: 0, dailyGoal: 0, sessionWords: 0, sessionSpeed: 0 }) },
			immersiveReferenceManager: referenceManager,
			immersiveManuscriptManager: manuscriptManager,
			startTracking: vi.fn(),
			stopTracking: vi.fn(),
			saveSettings: vi.fn().mockResolvedValue(undefined)
		};

		vi.mocked(mockApp.workspace.getActiveViewOfType).mockReturnValue(host.view);
		vi.mocked(mockApp.workspace.getLeavesOfType).mockImplementation((type: string) => type === 'markdown' ? [host.leaf] : []);
		vi.mocked(mockApp.workspace.iterateAllLeaves).mockImplementation((cb: (leaf: WorkspaceLeaf) => void) => cb(host.leaf));

		const immManager = new ImmersiveModeManager(mockApp, immPlugin as never);

		// 1. Entering from non-chapter automatically restores ch2
		await immManager.toggleImmersiveMode();
		expect(immManager.isManuscriptModeActive()).toBe(true);
		expect(host.view.file).toBe(ch2);
		expect(host.sourceViewEl.parentElement?.classList.contains('wn-manuscript-editor-slot')).toBe(true);

		// 2. Reference leaf non-chapter file-open does NOT disturb main manuscript editor
		const refLeafEl = new FakeEl(doc, 'workspace-leaf wn-immersive-reference-view');
		const refLeaf = {
			containerEl: refLeafEl,
			view: { getViewType: () => 'markdown', file: loreRef },
			openFile: vi.fn().mockResolvedValue(undefined),
			setViewState: vi.fn().mockResolvedValue(undefined)
		} as unknown as WorkspaceLeaf;
		immManager.registerImmersiveLeaf(refLeaf);
		for (const cb of workspaceHandlers.get('file-open') ?? []) {
			cb(loreRef);
		}
		await new Promise(resolve => setTimeout(resolve, 15));
		expect(host.view.file).toBe(ch2);

		// 3. External non-chapter open on main leaf triggers automatic restoration to last valid chapter
		host.view.file = outline;
		for (const cb of workspaceHandlers.get('file-open') ?? []) {
			cb(outline);
		}
		await new Promise(resolve => setTimeout(resolve, 25));
		expect(host.view.file).toBe(ch2);

		// 3b. Switching main leaf to a non-markdown view type restores valid manuscript markdown view
		(host.view as unknown as { getViewType: () => string }).getViewType = () => 'empty';
		for (const cb of workspaceHandlers.get('layout-change') ?? []) {
			cb();
		}
		await new Promise(resolve => setTimeout(resolve, 25));
		expect(host.view.getViewType()).toBe('markdown');
		expect(host.view.file).toBe(ch2);
		expect(host.sourceViewEl.parentElement?.classList.contains('wn-manuscript-editor-slot')).toBe(true);

		// 3c. Same-chapter mode toggle off/on preserves native editor/cm instance and avoids reopening file
		vi.mocked(host.leaf.openFile).mockClear();
		vi.mocked(host.leaf.setViewState).mockClear();
		const originalCm = host.view.editor.cm;
		immPlugin.settings.immersive.manuscriptModeEnabled = false;
		await immManager.handleManuscriptModeSettingChanged(false);
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);
		expect(immManager.isManuscriptModeActive()).toBe(false);

		immPlugin.settings.immersive.manuscriptModeEnabled = true;
		await immManager.handleManuscriptModeSettingChanged(true);
		expect(immManager.isManuscriptModeActive()).toBe(true);
		expect(host.sourceViewEl.parentElement?.classList.contains('wn-manuscript-editor-slot')).toBe(true);
		expect(host.view.editor.cm).toBe(originalCm);
		expect(host.leaf.openFile).not.toHaveBeenCalled();
		expect(host.leaf.setViewState).not.toHaveBeenCalled();

		// 4. Destroy restores DOM and awaits pending teardown
		await immManager.destroy();
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);

		// 5. Entering on a fresh manager when truly no valid chapters/context exist fails safely with Notice
		vaultFiles.delete(ch1.path);
		vaultFiles.delete(ch2.path);
		const starFolder = vaultFiles.get('Books/StarSea') as unknown as { children: Array<TFile | TFolder> };
		starFolder.children = starFolder.children.filter(c => c === outline || c instanceof TFolder);
		immPlugin.settings.immersive.lastManuscriptPosition = undefined;
		immPlugin.settings.immersive.workManuscriptPositions = {};
		host.view.file = outline;
		vi.mocked(Notice).mockClear();

		const freshManager = new ImmersiveModeManager(mockApp, immPlugin as never);
		await freshManager.toggleImmersiveMode();
		expect(freshManager.isManuscriptModeActive()).toBe(false);
		expect(Notice).toHaveBeenCalled();
		await freshManager.destroy();
	});

	it('prevents reconcile exit deadlock, blocks remount after prepareShutdownCleanup, and serializes/rolls back setting toggles', async () => {
		const ch1 = createFile('Books/StarSea/第1章.md', '第一章内容');
		const outline = createFile('Books/StarSea/大纲.md', '大纲');
		const host = createFakeMarkdownLeaf(outline);

		const immPlugin = {
			app: mockApp,
			settings: manuscriptManager['plugin'].settings,
			stickyNoteManager: {
				syncActiveNotesToManager: vi.fn(),
				getNotes: vi.fn().mockReturnValue([]),
				saveNotes: vi.fn().mockResolvedValue(undefined),
				syncFloatingNotes: vi.fn()
			},
			settingsManager: { flush: vi.fn().mockResolvedValue(undefined) },
			adaptiveDebounceManager: { debounceFixed: vi.fn() },
			statisticsManager: { getCoreStats: vi.fn().mockReturnValue({ totalTime: '0', focusTime: '0', slackTime: '0', todayWords: 0, goal: 0, dailyWords: 0, dailyGoal: 0, sessionWords: 0, sessionSpeed: 0 }) },
			immersiveReferenceManager: referenceManager,
			immersiveManuscriptManager: manuscriptManager,
			startTracking: vi.fn(),
			stopTracking: vi.fn(),
			saveSettings: vi.fn().mockResolvedValue(undefined)
		};

		vi.mocked(mockApp.workspace.getActiveViewOfType).mockReturnValue(host.view);
		vi.mocked(mockApp.workspace.getLeavesOfType).mockImplementation((type: string) => type === 'markdown' ? [host.leaf] : []);
		vi.mocked(mockApp.workspace.iterateAllLeaves).mockImplementation((cb: (leaf: WorkspaceLeaf) => void) => cb(host.leaf));

		// 1. Rapid toggle true -> false while openFile pending: false wins, does not mount after open resolves
		immPlugin.settings.immersive.manuscriptModeEnabled = false;
		const immManager = new ImmersiveModeManager(mockApp, immPlugin as never);
		await immManager.toggleImmersiveMode();
		expect(immManager.isManuscriptModeActive()).toBe(false);

		let resolveOpen!: () => void;
		const origOpen = vi.mocked(host.leaf.openFile).getMockImplementation()!;
		vi.mocked(host.leaf.openFile).mockImplementationOnce(async () => {
			await new Promise<void>(r => { resolveOpen = r; });
			host.view.file = ch1;
		});
		immPlugin.settings.immersive.manuscriptModeEnabled = true;
		const enablePromise = immManager.handleManuscriptModeSettingChanged(true);
		await new Promise(resolve => setTimeout(resolve, 10));
		immPlugin.settings.immersive.manuscriptModeEnabled = false;
		const disablePromise = immManager.handleManuscriptModeSettingChanged(false);
		resolveOpen();
		await Promise.all([enablePromise, disablePromise]);
		expect(immManager.isManuscriptModeActive()).toBe(false);
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);

		// 2. Open rejection while enabling rolls back setting to false
		vi.mocked(host.leaf.openFile).mockRejectedValueOnce(new Error('open failed'));
		host.view.file = outline;
		immPlugin.settings.immersive.manuscriptModeEnabled = true;
		const effectiveOnErr = await immManager.handleManuscriptModeSettingChanged(true);
		expect(effectiveOnErr).toBe(false);
		expect(immPlugin.settings.immersive.manuscriptModeEnabled).toBe(false);

		// Restore origOpen and enable properly for shutdown & deadlock tests
		vi.mocked(host.leaf.openFile).mockImplementation(origOpen);
		immPlugin.settings.immersive.manuscriptModeEnabled = true;
		expect(await immManager.handleManuscriptModeSettingChanged(true)).toBe(true);
		expect(immManager.isManuscriptModeActive()).toBe(true);

		// 3. Reconcile exit with zero chapters settles without self-deadlock
		vaultFiles.delete(ch1.path);
		const starFolder = vaultFiles.get('Books/StarSea') as unknown as { children: Array<TFile | TFolder> };
		starFolder.children = starFolder.children.filter(c => c !== ch1);
		immPlugin.settings.immersive.lastManuscriptPosition = undefined;
		immPlugin.settings.immersive.workManuscriptPositions = {};
		host.view.file = outline;
		for (const cb of workspaceHandlers.get('file-open') ?? []) cb(outline);

		await Promise.race([
			(async () => {
				for (let i = 0; i < 30 && immManager.isManuscriptModeActive(); i++) {
					await new Promise(r => setTimeout(r, 15));
				}
			})(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('reconcile self-deadlock timeout')), 1000))
		]);
		expect(immManager.isManuscriptModeActive()).toBe(false);
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);

		// 4. prepareShutdownCleanup immediately invalidates isManuscriptModeActive and blocks remount
		const chReAdded = createFile('Books/StarSea/第2章.md', '第二章内容');
		host.view.file = chReAdded;
		await immManager.toggleImmersiveMode();
		expect(immManager.isManuscriptModeActive()).toBe(true);
		const pendingChapter = createFile('Books/StarSea/第3章.md', 'Fictional pending chapter');
		let finishOpen!: () => void;
		vi.mocked(host.leaf.openFile).mockImplementationOnce(async () => {
			await new Promise<void>(resolve => { finishOpen = resolve; });
			host.view.file = pendingChapter;
		});
		const navigation = immManager.navigateManuscriptChapter(pendingChapter);
		await new Promise(resolve => setTimeout(resolve, 10));
		immManager.prepareShutdownCleanup();
		expect(immManager.isManuscriptModeActive()).toBe(false);
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);

		for (const cb of workspaceHandlers.get('layout-change') ?? []) cb();
		await new Promise(resolve => setTimeout(resolve, 25));
		expect(immManager.isManuscriptModeActive()).toBe(false);
		expect(host.sourceViewEl.parentElement).toBe(host.viewContentEl);
		let destroyed = false;
		const destruction = immManager.destroy().then(() => { destroyed = true; });
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(destroyed).toBe(false);
		finishOpen();
		await Promise.all([navigation, destruction]);
	});

	it('captures and restores independent viewport anchors across chapters, protects unrelated events/IME, uses post-save preview snapshots, and exposes accessible header buttons', async () => {
		const ch1 = createFile('Books/StarSea/第1章 起点.md', '第一章第0行\n第一章第1行\n第一章第2行');
		const ch2 = createFile('Books/StarSea/第2章 转折.md', '第二章第0行\n第二章第1行');
		const unrelated = createFile('Books/MoonBay/第1章 另一本.md', '无关作品');
		const host = createFakeMarkdownLeaf(ch2);

		const originalCreateDiv = FakeEl.prototype.createDiv;
		let cardIdx = 0;
		const geoSpy = vi.spyOn(FakeEl.prototype, 'createDiv').mockImplementation(function (this: FakeEl, opts) {
			const el = originalCreateDiv.call(this, opts);
			if (opts?.cls === 'wn-manuscript-card') el.offsetTop = cardIdx++ * 1000;
			return el;
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, ch2)).toBe(true);

			// 1. Accessible button semantics on chapter header + keyboard Enter switch
			const ch1Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch1.path)!;
			const ch1Header = ch1Card.querySelector('.wn-manuscript-card-header')!;
			expect(ch1Header.tagName).toBe('DIV');
			expect(ch1Header.classList.contains('inline-title')).toBe(true);
			expect(ch1Header.getAttribute('role')).toBe('button');
			expect(ch1Header.getAttribute('tabindex')).toBe('0');
			expect(ch1Header.getAttribute('aria-label')).toContain(ch1.basename);

			// 2. Scroll to earlier chapter (ch1) while caret stays at ch2 -> captures independent viewportFilePath
			host.view.editor.setCursor({ line: 1, ch: 2 });
			const scroller = controller.getScrollerElement()!;
			scroller.scrollTop = 140;
			controller.captureCurrentPosition(true);
			const savedPos = manuscriptManager.getValidatedLastPosition()?.position;
			expect(savedPos?.filePath).toBe(ch2.path);
			expect(savedPos?.cursorLine).toBe(1);
			expect(savedPos?.viewportFilePath).toBe(ch1.path);
			expect(savedPos?.chapterRelativeScroll).toBe(140);

			// 3. Unrelated vault events & IME composing protection do not disrupt cards
			const cardsBefore = host.viewContentEl.querySelectorAll('.wn-manuscript-card').length;
			for (const cb of vaultHandlers.get('create') ?? []) cb(unrelated);
			await new Promise(resolve => setTimeout(resolve, 65));
			expect(host.viewContentEl.querySelectorAll('.wn-manuscript-card').length).toBe(cardsBefore);

			// 4. Slow save edits data before resolving -> post-save snapshot wins for outgoing preview
			host.saveFn.mockImplementationOnce(async () => {
				(host.view as unknown as { setViewDataForTest: (s: string) => void }).setViewDataForTest('保存后最新正文\n第二行');
				fileContents.set(ch2.path, '保存后最新正文\n第二行');
			});
			ch1Header.dispatchEvent('keydown', { key: 'Enter' });
			await new Promise(resolve => setTimeout(resolve, 25));
			expect(host.view.file).toBe(ch1);
			const ch2CardAfter = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch2.path)!;
			expect(ch2CardAfter.querySelector('.wn-manuscript-preview-line')?.textContent).toBe('保存后最新正文');

			// 5. Independent viewport restore after materialization
			controller.unmountSync();
			cardIdx = 0;
			const controller2 = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
			const host2 = createFakeMarkdownLeaf(ch2);
			expect(controller2.mount(host2.leaf, ch2, savedPos)).toBe(true);
			await new Promise(resolve => setTimeout(resolve, 20));
			expect(host2.view.file).toBe(ch2);
			expect(host2.view.editor.getCursor().line).toBe(1);
			expect(controller2.getScrollerElement()!.scrollTop).toBe(140);
			controller2.unmountSync();
		} finally {
			controller.unmountSync();
			geoSpy.mockRestore();
		}
	});

	it('publishes scroller viewport height CSS variable via ownerWindow ResizeObserver and disconnects on unmount', () => {
		createFile('Books/StarSea/第1章 起点.md', '第一章内容');
		const ch2 = createFile('Books/StarSea/第2章 终点.md', '');
		const host = createFakeMarkdownLeaf(ch2);

		const resizeState: { cb: (() => void) | null } = { cb: null };
		const observeMock = vi.fn();
		const disconnectMock = vi.fn();
		const prevResizeObserver = doc.defaultView.ResizeObserver;
		doc.defaultView.ResizeObserver = class MockResizeObserver {
			constructor(cb: () => void) {
				resizeState.cb = cb;
			}
			observe = observeMock;
			disconnect = disconnectMock;
		};

		const originalCreateDiv = FakeEl.prototype.createDiv;
		let scrollerCreated: FakeEl | null = null;
		const geoSpy = vi.spyOn(FakeEl.prototype, 'createDiv').mockImplementation(function (this: FakeEl, opts) {
			const el = originalCreateDiv.call(this, opts);
			if (opts?.cls === 'wn-manuscript-scroller') {
				el.clientHeight = 600;
				scrollerCreated = el;
			}
			return el;
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, ch2)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			expect(scroller).toBe(scrollerCreated);
			expect(observeMock).toHaveBeenCalledTimes(1);
			expect(observeMock).toHaveBeenCalledWith(scroller);
			expect(scroller.style.getPropertyValue('--wn-manuscript-viewport-height')).toBe('600px');

			const setPropSpy = vi.spyOn(scroller.style, 'setProperty');
			resizeState.cb?.();
			expect(setPropSpy).not.toHaveBeenCalled();

			scrollerCreated!.clientHeight = 400;
			const scrollTopBeforeResize = scroller.scrollTop;
			resizeState.cb?.();
			expect(setPropSpy).toHaveBeenCalledWith('--wn-manuscript-viewport-height', '400px');
			expect(scroller.style.getPropertyValue('--wn-manuscript-viewport-height')).toBe('400px');
			expect(scroller.scrollTop).toBe(scrollTopBeforeResize);

			controller.unmountSync();
			expect(disconnectMock).toHaveBeenCalledTimes(1);

			scrollerCreated!.clientHeight = 520;
			resizeState.cb?.();
			expect(scroller.style.getPropertyValue('--wn-manuscript-viewport-height')).not.toBe('520px');
		} finally {
			controller.unmountSync();
			geoSpy.mockRestore();
			if (prevResizeObserver === undefined) {
				delete doc.defaultView.ResizeObserver;
			} else {
				doc.defaultView.ResizeObserver = prevResizeObserver;
			}
		}
	});

	it('syncWithActiveChapter aligns external empty chapter switches, cancels old restore, preserves cursor/focus, and honors restorePosition and same-file refresh', async () => {
		const ch1 = createFile('Books/StarSea/第1章 起点.md', '第一章第0行\n第一章第1行');
		const ch2 = createFile('Books/StarSea/第2章 空章.md', '');
		const host = createFakeMarkdownLeaf(ch1);

		const originalCreateDiv = FakeEl.prototype.createDiv;
		let cardOffset = 0;
		const geoSpy = vi.spyOn(FakeEl.prototype, 'createDiv').mockImplementation(function (this: FakeEl, opts) {
			const el = originalCreateDiv.call(this, opts);
			if (opts?.cls === 'wn-manuscript-card') {
				el.offsetTop = cardOffset;
				cardOffset += 1000;
			}
			return el;
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, ch1, {
				filePath: ch1.path,
				workPath: 'Books/StarSea',
				cursorLine: 0,
				cursorCh: 0,
				chapterRelativeScroll: 120,
				viewportFilePath: ch2.path
			})).toBe(true);
			const scroller = controller.getScrollerElement()!;

			// 1. External new empty chapter with card absent
			const ch3 = createFile('Books/StarSea/第3章 新空章.md', '');
			host.view.file = ch3;
			(host.view as unknown as { setViewDataForTest: (s: string) => void }).setViewDataForTest('');
			host.view.editor.setCursor({ line: 0, ch: 3 });
			host.cm.dispatch.mockClear();
			host.cm.focus.mockClear();

			await controller.syncWithActiveChapter(ch3);
			expect(controller.getActiveFilePath()).toBe(ch3.path);
			const ch3Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch3.path)!;
			expect(ch3Card).toBeDefined();
			expect(scroller.scrollTop).toBe(Math.max(0, ch3Card.offsetTop - 16));
			expect(host.view.editor.getCursor()).toEqual({ line: 0, ch: 3 });
			expect(host.cm.focus).not.toHaveBeenCalled();
			expect(host.cm.dispatch).toHaveBeenCalledWith(expect.objectContaining({
				effects: preserveTypewriterViewport.of(null)
			}));

			// Cancelled old pending restore does not pull viewport back
			await new Promise(resolve => setTimeout(resolve, 30));
			expect(scroller.scrollTop).toBe(Math.max(0, ch3Card.offsetTop - 16));

			// 2. External empty chapter already in cards
			host.view.file = ch2;
			host.view.editor.setCursor({ line: 0, ch: 2 });
			await controller.syncWithActiveChapter(ch2);
			expect(controller.getActiveFilePath()).toBe(ch2.path);
			const ch2Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch2.path)!;
			expect(scroller.scrollTop).toBe(Math.max(0, ch2Card.offsetTop - 16));
			expect(host.view.editor.getCursor()).toEqual({ line: 0, ch: 2 });

			// 3. Same-file sync preserves viewport
			scroller.scrollTop = ch2Card.offsetTop + 150;
			await controller.syncWithActiveChapter(ch2);
			expect(scroller.scrollTop).toBe(ch2Card.offsetTop + 150);

			// 4. Explicit matching restorePosition retains precedence
			host.view.file = ch1;
			(host.view as unknown as { setViewDataForTest: (s: string) => void }).setViewDataForTest('第一章第0行\n第一章第1行');
			await controller.syncWithActiveChapter(ch1, {
				filePath: ch1.path,
				workPath: 'Books/StarSea',
				cursorLine: 1,
				cursorCh: 4,
				chapterRelativeScroll: 88
			});
			const ch1Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch1.path)!;
			expect(host.view.editor.getCursor()).toEqual({ line: 1, ch: 4 });
			expect(scroller.scrollTop).toBe(Math.max(0, ch1Card.offsetTop + 88));
		} finally {
			controller.unmountSync();
			geoSpy.mockRestore();
		}
	});

	it('refreshChapterList routes create-triggered refresh race through syncWithActiveChapter when live file changed, while preserving same-file refresh viewport', async () => {
		const ch1 = createFile('Books/StarSea/第1章 起点.md', '第一章内容');
		createFile('Books/StarSea/第2章 中章.md', '第二章内容');
		const host = createFakeMarkdownLeaf(ch1);

		const originalCreateDiv = FakeEl.prototype.createDiv;
		let cardOffset = 0;
		const geoSpy = vi.spyOn(FakeEl.prototype, 'createDiv').mockImplementation(function (this: FakeEl, opts) {
			const el = originalCreateDiv.call(this, opts);
			if (opts?.cls === 'wn-manuscript-card') {
				el.offsetTop = cardOffset;
				cardOffset += 1000;
			}
			return el;
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, ch1)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			scroller.scrollTop = 50;

			const ch3 = createFile('Books/StarSea/第3章 外部新建.md', '');
			host.view.file = ch3;
			(host.view as unknown as { setViewDataForTest: (s: string) => void }).setViewDataForTest('');
			for (const cb of vaultHandlers.get('create') ?? []) cb(ch3);
			await new Promise(resolve => setTimeout(resolve, 65));

			expect(controller.getActiveFilePath()).toBe(ch3.path);
			const ch3Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch3.path)!;
			expect(ch3Card).toBeDefined();
			expect(scroller.scrollTop).toBe(Math.max(0, ch3Card.offsetTop - 16));

			// Same-file structural refresh still preserves viewport
			scroller.scrollTop = ch3Card.offsetTop + 42;
			controller.refreshChapterList();
			const ch3CardAfter = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch3.path)!;
			expect(scroller.scrollTop).toBe(ch3CardAfter.offsetTop + 42);
		} finally {
			controller.unmountSync();
			geoSpy.mockRestore();
		}
	});

	it('bounds offscreen rendered previews, preserves measured height, reloads on return, and keeps unlimited visible previews', async () => {
		const chapters: TFile[] = [];
		for (let i = 1; i <= 30; i++) {
			const content = Array.from({ length: 25 }, (_, lineIdx) => `第${i}章 第${lineIdx + 1}行`).join('\n');
			chapters.push(createFile(`Books/StarSea/第${i}章.md`, content));
		}
		const host = createFakeMarkdownLeaf(chapters[0]);

		let ioCallback!: IntersectionObserverCallback;
		const observed = new Set<Element>();
		class MockIntersectionObserver {
			constructor(cb: IntersectionObserverCallback) {
				ioCallback = cb;
			}
			observe(el: Element) { observed.add(el); }
			unobserve(el: Element) { observed.delete(el); }
			disconnect() { observed.clear(); }
			takeRecords() { return []; }
		}
		(host.viewContentEl.ownerDocument.defaultView as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

		const rectSpy = vi.spyOn(FakeEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FakeEl) {
			if (this.classList.contains('wn-manuscript-preview') && !this.classList.contains('wn-manuscript-lazy-shell')) {
				const h = Math.max(100, this.children.length * 24);
				return { top: 0, bottom: h, left: 0, right: 600, width: 600, height: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
			}
			return { top: 0, bottom: 700, left: 0, right: 600, width: 600, height: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, chapters[0])).toBe(true);
			// Originally active chapter must also be observed so later switching away and scrolling back works
			const ch1Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[0].path)!;
			expect(observed.has(ch1Card as unknown as Element)).toBe(true);

			// Sequentially enter and exit chapters 2..25
			for (let i = 1; i < 25; i++) {
				const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[i].path)!;
				ioCallback([{ target: card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
				await Promise.resolve();
				await Promise.resolve();
				ioCallback([{ target: card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			}

			// Bounded offscreen preview budget (<= 12 rendered offscreen chapters => <= 12 * 25 = 300 lines)
			const lineNodesAfterScroll = host.viewContentEl.querySelectorAll('.wn-manuscript-preview-line');
			expect(lineNodesAfterScroll.length).toBeLessThanOrEqual(12 * 25);

			// Evicted chapter 2 has lazy-shell and measured height 25 * 24 = 600px
			const ch2Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[1].path)!;
			const ch2Preview = ch2Card.querySelectorAll('.wn-manuscript-preview')[0];
			expect(ch2Preview.classList.contains('wn-manuscript-lazy-shell')).toBe(true);
			expect(ch2Preview.style.getPropertyValue('--wn-manuscript-estimated-height')).toBe('600px');

			// Returning to evicted chapter 2 reloads its lines, even after offscreen modification
			fileContents.set(chapters[1].path, '第2章 更新后第一行\n第2章 更新后第二行');
			ioCallback([{ target: ch2Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();
			expect(ch2Preview.classList.contains('wn-manuscript-lazy-shell')).toBe(false);
			expect(ch2Card.querySelectorAll('.wn-manuscript-preview-line').map(el => el.textContent)).toEqual([
				'第2章 更新后第一行',
				'第2章 更新后第二行'
			]);

			// Unlimited actually visible necessities: 16 visible chapters stay rendered simultaneously
			const visibleCards: FakeEl[] = [];
			for (let i = 10; i < 26; i++) {
				const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[i].path)!;
				visibleCards.push(card);
			}
			ioCallback(
				visibleCards.map(c => ({ target: c as unknown as Element, isIntersecting: true } as IntersectionObserverEntry)),
				{} as IntersectionObserver
			);
			await vi.waitFor(() => {
				for (const c of visibleCards) {
					expect(c.querySelectorAll('.wn-manuscript-preview-line').length).toBe(25);
				}
			});
		} finally {
			controller.unmountSync();
			rectSpy.mockRestore();
		}
	});

	it('protects selected offscreen preview and pending restore target from eviction, and reloads original active chapter after switching away', async () => {
		const chapters: TFile[] = [];
		for (let i = 1; i <= 20; i++) {
			chapters.push(createFile(`Books/StarSea/第${i}章.md`, `第${i}章 首行\n第${i}章 次行`));
		}
		const host = createFakeMarkdownLeaf(chapters[0]);

		let ioCallback!: IntersectionObserverCallback;
		class MockIntersectionObserver {
			constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() { return []; }
		}
		(host.viewContentEl.ownerDocument.defaultView as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

		let selectedAnchorNode: unknown = null;
		(host.viewContentEl.ownerDocument.defaultView as unknown as { getSelection: () => unknown }).getSelection = () => (
			selectedAnchorNode
				? { isCollapsed: false, toString: () => '选中文本', anchorNode: selectedAnchorNode, focusNode: selectedAnchorNode }
				: { isCollapsed: true, toString: () => '' }
		);

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, chapters[0])).toBe(true);

			// Render chapter 2 and select text inside it
			const ch2Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[1].path)!;
			ioCallback([{ target: ch2Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();
			selectedAnchorNode = ch2Card.querySelectorAll('.wn-manuscript-preview-line')[0];
			ioCallback([{ target: ch2Card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);

			// Materialize and exit chapters 3..19 to trigger eviction
			for (let i = 2; i < 19; i++) {
				const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[i].path)!;
				ioCallback([{ target: card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
				await Promise.resolve();
				await Promise.resolve();
				ioCallback([{ target: card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			}

			// Chapter 2 with active selection MUST NOT be evicted
			expect(ch2Card.querySelectorAll('.wn-manuscript-preview-line').length).toBe(2);
			selectedAnchorNode = null;

			// Multi-chapter selection: endpoints in ch1 and ch4, middle ch3 protected via Selection.containsNode
			const ch1CardSel = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[0].path)!;
			const ch3Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[2].path)!;
			const ch4Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[3].path)!;
			ioCallback([
				{ target: ch3Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry,
				{ target: ch4Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry
			], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();
			(host.viewContentEl.ownerDocument.defaultView as unknown as { getSelection: () => unknown }).getSelection = () => ({
				isCollapsed: false,
				toString: () => '跨章选区',
				anchorNode: ch1CardSel,
				focusNode: ch4Card,
				containsNode: (node: unknown) => node === ch3Card || (ch3Card.querySelector('.wn-manuscript-preview') === node)
			});
			ioCallback([
				{ target: ch3Card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry,
				{ target: ch4Card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry
			], {} as IntersectionObserver);
			// Trigger additional offscreen materializations to ensure ch3 would be evicted if unprotected
			for (let i = 4; i < 19; i++) {
				const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[i].path)!;
				ioCallback([{ target: card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
				await Promise.resolve();
				await Promise.resolve();
				ioCallback([{ target: card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			}
			expect(ch3Card.querySelectorAll('.wn-manuscript-preview-line').length).toBe(2);

			// Restore selection stub
			(host.viewContentEl.ownerDocument.defaultView as unknown as { getSelection: () => unknown }).getSelection = () => ({ isCollapsed: true, toString: () => '' });

			// Switch active to chapter 20 so chapter 1 becomes inactive, then scroll chapter 1 out and back
			host.view.file = chapters[19];
			await controller.syncWithActiveChapter(chapters[19]);
			const ch1CardReload = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[0].path)!;
			ioCallback([{ target: ch1CardReload as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			ioCallback([{ target: ch1CardReload as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();
			expect(ch1CardReload.querySelectorAll('.wn-manuscript-preview-line').length).toBe(2);
		} finally {
			controller.unmountSync();
		}
	});

	it('defers eviction when preview height is 0/unmeasurable, skips in-flight reloads, and protects real pending independent restore target', async () => {
		const chapters: TFile[] = [];
		for (let i = 1; i <= 20; i++) {
			chapters.push(createFile(`Books/StarSea/第${i}章.md`, `第${i}章 首行\n第${i}章 次行`));
		}
		const host = createFakeMarkdownLeaf(chapters[0]);

		let ioCallback!: IntersectionObserverCallback;
		class MockIntersectionObserver {
			constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() { return []; }
		}
		(host.viewContentEl.ownerDocument.defaultView as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

		let zeroHeightPath: string | null = chapters[1].path;
		const rectSpy = vi.spyOn(FakeEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FakeEl) {
			if (this.classList.contains('wn-manuscript-preview')) {
				const card = this.closest('.wn-manuscript-card');
				if (card?.dataset.chapterPath === zeroHeightPath) {
					return { top: 0, bottom: 0, left: 0, right: 600, width: 600, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
				}
				return { top: 0, bottom: 120, left: 0, right: 600, width: 600, height: 120, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
			}
			return { top: 0, bottom: 700, left: 0, right: 600, width: 600, height: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		try {
			expect(controller.mount(host.leaf, chapters[0])).toBe(true);

			// 1. Render ch2 while its measured height is 0 -> must NOT be evicted with fallback word-count height
			const ch2Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[1].path)!;
			ioCallback([{ target: ch2Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();
			ioCallback([{ target: ch2Card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);

			for (let i = 2; i < 18; i++) {
				const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[i].path)!;
				ioCallback([{ target: card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
				await Promise.resolve();
				await Promise.resolve();
				ioCallback([{ target: card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			}
			expect(ch2Card.querySelectorAll('.wn-manuscript-preview-line').length).toBe(2);
			zeroHeightPath = null;

			// 2. Real pending independent restore target (ch3): in-flight read + pendingRestoreToken > 0
			const ch3Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[2].path)!;
			let resolveRestoreRead!: (v: string) => void;
			(mockApp.vault.cachedRead as ReturnType<typeof vi.fn>).mockImplementation((f: TFile) => {
				if (f.path === chapters[2].path) {
					return new Promise<string>(res => { resolveRestoreRead = res; });
				}
				return Promise.resolve(fileContents.get(f.path) ?? '');
			});

			ioCallback([{ target: ch3Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await controller.syncWithActiveChapter(chapters[0], {
				filePath: chapters[0].path,
				workPath: 'Books/StarSea',
				cursorLine: 0,
				cursorCh: 0,
				viewportFilePath: chapters[2].path,
				viewportLine: 0,
				chapterRelativeScroll: 10
			});
			const ch4Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[3].path)!;
			ioCallback([{ target: ch4Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();
			ioCallback([{ target: ch4Card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);

			resolveRestoreRead('第3章 恢复首行\n第3章 恢复次行');
			await Promise.resolve();
			await Promise.resolve();
			expect(ch3Card.querySelectorAll('.wn-manuscript-preview-line').length).toBe(2);

			// Also verify an offscreen rendered card marked as pendingRestoreViewportPath is protected from eviction
			ioCallback([{ target: ch3Card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			(controller as unknown as { pendingRestoreToken: number; pendingRestoreViewportPath: string | null }).pendingRestoreToken = 99;
			(controller as unknown as { pendingRestoreViewportPath: string | null }).pendingRestoreViewportPath = chapters[2].path;
			for (let i = 4; i < 19; i++) {
				const card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === chapters[i].path)!;
				ioCallback([{ target: card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
				await Promise.resolve();
				await Promise.resolve();
				ioCallback([{ target: card as unknown as Element, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
			}
			expect(ch3Card.querySelectorAll('.wn-manuscript-preview-line').length).toBe(2);
		} finally {
			controller.unmountSync();
			rectSpy.mockRestore();
		}
	});

	it('coalesces scroll position capture to animation frames, flushes synchronously on teardown, and avoids querySelectorAll per scroll', async () => {
		const ch1 = createFile('Books/StarSea/第1章.md', '第一章\n内容');
		const ch2 = createFile('Books/StarSea/第2章.md', '第二章\n第一行\n第二行');
		const host = createFakeMarkdownLeaf(ch1);

		let ioCallback!: IntersectionObserverCallback;
		class MockIntersectionObserver {
			constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() { return []; }
		}
		(host.viewContentEl.ownerDocument.defaultView as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

		let nextRaf = 1;
		const rafQueue = new Map<number, FrameRequestCallback>();
		const win = host.viewContentEl.ownerDocument.defaultView as unknown as {
			requestAnimationFrame: (cb: FrameRequestCallback) => number;
			cancelAnimationFrame: (id: number) => void;
		};
		win.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
			const id = nextRaf++;
			rafQueue.set(id, cb);
			return id;
		});
		win.cancelAnimationFrame = vi.fn((id: number) => {
			rafQueue.delete(id);
		});

		const controller = new ImmersiveManuscriptController({ app: mockApp, manuscriptManager });
		const recordSpy = vi.spyOn(manuscriptManager, 'recordValidPosition');
		try {
			expect(controller.mount(host.leaf, ch1)).toBe(true);
			const scroller = controller.getScrollerElement()!;
			const ch2Card = host.viewContentEl.querySelectorAll('.wn-manuscript-card').find(c => c.dataset.chapterPath === ch2.path)!;
			ch2Card.offsetTop = 500;
			ioCallback([{ target: ch2Card as unknown as Element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
			await Promise.resolve();
			await Promise.resolve();

			const querySpy = vi.spyOn(FakeEl.prototype, 'querySelectorAll');
			recordSpy.mockClear();

			// 5 rapid scroll events -> coalesced into 1 RAF capture, no querySelectorAll on preview lines
			for (let i = 1; i <= 5; i++) {
				scroller.scrollTop = 500 + i * 10;
				(scroller as unknown as FakeEl).dispatchEvent('scroll');
			}
			expect(win.requestAnimationFrame).toHaveBeenCalledTimes(1);
			expect(recordSpy).not.toHaveBeenCalled();

			for (const [id, cb] of Array.from(rafQueue.entries())) {
				rafQueue.delete(id);
				cb(16);
			}
			expect(recordSpy).toHaveBeenCalledTimes(1);
			expect(querySpy).not.toHaveBeenCalled();

			// Pending RAF capture is flushed synchronously on teardownAsync and RAF is cancelled
			recordSpy.mockClear();
			scroller.scrollTop = 620;
			(scroller as unknown as FakeEl).dispatchEvent('scroll');
			expect(rafQueue.size).toBe(1);
			await controller.teardownAsync();
			expect(rafQueue.size).toBe(0);
			expect(win.cancelAnimationFrame).toHaveBeenCalled();
			expect(recordSpy).toHaveBeenCalledTimes(1);
			querySpy.mockRestore();
		} finally {
			recordSpy.mockRestore();
			controller.unmountSync();
		}
	});
});
