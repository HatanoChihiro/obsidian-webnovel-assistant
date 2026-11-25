import { configurePluginNotices } from '../src/services/PluginNoticeService';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineBoardRenderer, type TimelineBoardOptions, type TimelineBoardPlugin } from '../src/ui/components/TimelineBoardRenderer';
import { TimelineManager, type TimelineEntry } from '../src/services/TimelineManager';
import { TimelineEditModal } from '../src/ui/TimelineEditModal';
import { CorkboardGridRenderer } from '../src/ui/components/CorkboardGridRenderer';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { setIcon, setTooltip, Notice, type App, type Component, type TFile } from 'obsidian';

const { MockFile } = vi.hoisted(() => {
	class HoistedMockFile {
		extension = 'md';
		basename: string;

		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	return { MockFile: HoistedMockFile };
});

function createMockFile(name: string, path: string): TFile {
	return new MockFile(name, path) as unknown as TFile;
}

let animationFrameCallbacks: FrameRequestCallback[] = [];

const mockOwnerWindow = {
	requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
		animationFrameCallbacks.push(cb);
		return animationFrameCallbacks.length;
	}),
	cancelAnimationFrame: vi.fn(),
	getComputedStyle: () => ({ boxSizing: 'content-box' }),
	getSelection: vi.fn(() => ({
		removeAllRanges: vi.fn(),
		addRange: vi.fn()
	})),
	createSvg: vi.fn(() => new MockElement()),
	createFragment: vi.fn(() => new MockElement()),
	setTimeout: (fn: (...args: unknown[]) => void, ms?: number) => globalThis.setTimeout(fn, ms),
	clearTimeout: (id: NodeJS.Timeout | number) => globalThis.clearTimeout(id as number)
};

class MockElement {
	parentElement: MockElement | null = null;
	children: MockElement[] = [];
	className = '';
	private _textContent = '';
	get textContent(): string {
		if (this.children.length > 0) {
			return this.children.map(c => c.textContent).join('');
		}
		return this._textContent;
	}
	set textContent(val: string) {
		this._textContent = val;
		this.children = [];
	}
	classes = new Set<string>();
	attributes = new Map<string, string>();
	listeners = new Map<string, Array<(e?: unknown) => void>>();
	onclick?: (e?: unknown) => void;
	style: Record<string, string> = {};
	scrollTop = 0;
	isConnected = true;
	private _scrollHeight = 0;
	get scrollHeight(): number {
		return this._scrollHeight;
	}
	set scrollHeight(val: number) {
		this._scrollHeight = val;
	}
	clientHeight = 0;
	value = '';
	oninput?: () => void;
	onblur?: () => void;
	onkeydown?: (e?: unknown) => void;
	focus = vi.fn();
	blur = vi.fn(() => {
		this.onblur?.();
	});
	setSelectionRange = vi.fn();
	hide = vi.fn();
	show = vi.fn();
	click = vi.fn((e?: unknown) => {
		const evt = (e && typeof e === 'object') ? e : { stopPropagation: vi.fn(), preventDefault: vi.fn() };
		this.onclick?.(evt);
		this.dispatchEvent('click', evt);
	});

	remove() {
		if (this.parentElement) {
			const index = this.parentElement.children.indexOf(this);
			if (index >= 0) {
				this.parentElement.children.splice(index, 1);
			}
			this.parentElement = null;
		}
	}

	setCssStyles(styles: Record<string, string>) {
		if (styles) Object.assign(this.style, styles);
		return this;
	}

	setCssProps(props: Record<string, string>) {
		return this.setCssStyles(props);
	}

	insertBefore(child: MockElement, referenceChild: MockElement) {
		const index = this.children.indexOf(referenceChild);
		if (index >= 0) {
			child.parentElement = this;
			this.children.splice(index, 0, child);
		} else {
			this.appendChild(child);
		}
		return child;
	}

	constructor(cls = '') {
		this.className = cls;
		if (cls) {
			cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
		}
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
			contains: (token: string) => this.classes.has(token)
		};
	}

	addClass(cls: string) {
		this.classList.add(cls);
		return this;
	}

	removeClass(cls: string) {
		this.classList.remove(cls);
		return this;
	}

	hasClass(token: string) { return this.classes.has(token); }

	empty() {
		this.children = [];
		this.textContent = '';
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

	createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) {
		const cls = opts?.cls || '';
		const child = new MockElement(cls);
		if (opts?.text) child.textContent = opts.text;
		for (const [key, value] of Object.entries(opts?.attr ?? {})) child.setAttribute(key, value);
		this.appendChild(child);
		return child;
	}

	setAttr(key: string, val: string) { this.attributes.set(key, val); }
	setAttribute(key: string, val: string) { this.attributes.set(key, val); }
	removeAttribute(key: string) { this.attributes.delete(key); }
	getAttr(key: string) { return this.attributes.get(key) ?? null; }
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

	removeEventListener(event: string, fn: (e?: unknown) => void) {
		const arr = this.listeners.get(event);
		if (arr) {
			this.listeners.set(event, arr.filter(l => l !== fn));
		}
	}

	matches(_sel: string): boolean {
		return false;
	}

	querySelectorAll(sel: string): MockElement[] {
		const results: MockElement[] = [];
		const matchPart = (node: MockElement, part: string): boolean => {
			const s = part.trim();
			if (!s) return false;
			if (s.startsWith('.')) {
				const classes = s.slice(1).split('.');
				return classes.every(c => node.hasClass(c));
			}
			if (s.startsWith('[')) {
				const attrMatches = [...s.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)];
				return attrMatches.every(([, attr, val]) => {
					if (val !== undefined) return node.getAttr(attr) === val;
					return node.attributes.has(attr);
				});
			}
			return false;
		};
		const match = (node: MockElement): boolean => {
			if (sel.includes(',')) {
				return sel.split(',').some(p => matchPart(node, p));
			}
			return matchPart(node, sel);
		};
		const collect = (node: MockElement) => {
			for (const c of node.children) {
				if (match(c)) results.push(c);
				collect(c);
			}
		};
		collect(this);
		return results;
	}

	querySelector(sel: string): MockElement | null {
		const all = this.querySelectorAll(sel);
		return all[0] ?? null;
	}

	mockIsPhone = false;
	mockIsTablet = false;
	mockRect = { top: 0, bottom: 100, height: 100, left: 0, right: 100, width: 100 };
	getBoundingClientRect() {
		return this.mockRect;
	}
	private _ownerDocument: {
		createElementNS: (_ns: string, tag: string) => MockElement;
		createDocumentFragment: () => MockElement;
		defaultView: typeof mockOwnerWindow;
		createRange: () => { selectNodeContents: ReturnType<typeof vi.fn>; collapse: ReturnType<typeof vi.fn> };
		body: { classList: { contains: (token: string) => boolean } };
		addEventListener: (event: string, fn: (e?: unknown) => void) => void;
		removeEventListener: (event: string, fn: (e?: unknown) => void) => void;
		dispatchEvent: (event: string, e?: unknown) => void;
	} | null = null;
	get ownerDocument(): NonNullable<MockElement['_ownerDocument']> {
		if (this.parentElement) {
			return this.parentElement.ownerDocument;
		}
		if (!this._ownerDocument) {
			const listeners = new Map<string, Array<(e?: unknown) => void>>();
			this._ownerDocument = {
				createElementNS: (_ns: string, tag: string) => new MockElement(tag),
				createDocumentFragment: () => new MockElement('fragment'),
				defaultView: mockOwnerWindow,
				createRange: () => ({
					selectNodeContents: vi.fn(),
					collapse: vi.fn()
				}),
				body: {
					classList: {
						contains: (token: string) => token === 'is-phone' ? this.mockIsPhone : token === 'is-tablet' && this.mockIsTablet
					}
				},
				addEventListener: (event: string, fn: (e?: unknown) => void) => {
					const arr = listeners.get(event) ?? [];
					arr.push(fn);
					listeners.set(event, arr);
				},
				removeEventListener: (event: string, fn: (e?: unknown) => void) => {
					const arr = listeners.get(event);
					if (arr) listeners.set(event, arr.filter(l => l !== fn));
				},
				dispatchEvent: (event: string, e?: unknown) => {
					const arr = [...(listeners.get(event) ?? [])];
					for (const fn of arr) fn(e);
				}
			};
		}
		return this._ownerDocument;
	}
}

let lastOpenedModal: { contentEl: MockElement; open: () => void; close: () => void } | null = null;

vi.mock('obsidian', () => ({
	setIcon: vi.fn((el: unknown, iconId: string) => {
		(el as MockElement)?.setAttr?.('data-icon', iconId);
	}),
	setTooltip: vi.fn(),
	Platform: { isMobile: false },
	Notice: vi.fn(),
	Setting: class {
		constructor(_containerEl?: unknown) {}
		setName(_name: string) { return this; }
		setHeading() { return this; }
		setDesc(_desc: string) { return this; }
	},
	Modal: class {
		modalEl = new MockElement();
		contentEl = new MockElement();
		app: unknown;
		constructor(app: unknown) {
			this.app = app;
		}
		open() {
			lastOpenedModal = this as unknown as { contentEl: MockElement; open: () => void; close: () => void };
			(this as unknown as { onOpen?: () => void }).onOpen?.();
		}
		close() {
			(this as unknown as { onClose?: () => void }).onClose?.();
		}
	},
	Component: class {
		load = vi.fn();
		unload = vi.fn();
		register = vi.fn();
		registerDomEvent = vi.fn();
		addChild = vi.fn();
		removeChild = vi.fn();
	},
	TFile: MockFile,
	TFolder: class {},
	normalizePath: (path: string) => path ? path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '') : ''
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key,
	getLocale: () => 'zh-CN'
}));

vi.mock('../src/ui/components/CorkboardGridRenderer', () => ({
	CorkboardGridRenderer: {
		render: vi.fn()
	}
}));

beforeEach(() => { configurePluginNotices(() => true); });

describe('TimelineBoardRenderer', () => {
	let mockApp: App;
	let mockPlugin: TimelineBoardPlugin;
	let container: MockElement;

	beforeEach(() => {
		vi.clearAllMocks();
		animationFrameCallbacks = [];

		mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(),
				getFirstLinkpathDest: vi.fn()
			}
		} as unknown as App;

		mockPlugin = {
			settings: {
				enableSmartChapterSort: true,
				customSortOrder: {},
				enableMobileLorePopover: false,
				lorePopoverCollapse: false
			},
			timelineManager: {
				loadEntries: vi.fn().mockResolvedValue([]),
				getTimelineFile: vi.fn().mockReturnValue(null),
				createTimelineFile: vi.fn(),
				syncChapterToEventItem: vi.fn(),
				moveEventItem: vi.fn(),
				deleteEntry: vi.fn(),
				updateEntry: vi.fn(),
				getTimelineFilePath: vi.fn(),
				appendEntry: vi.fn()
			},
			characterManager: {
				getCharacterFile: vi.fn().mockReturnValue(null),
				findLoreFolder: vi.fn().mockReturnValue(null),
				createLoreEntry: vi.fn(),
				getLoreContent: vi.fn(),
				updateLoreContent: vi.fn(),
				getCharactersForBook: vi.fn().mockReturnValue([]),
				getLoreEntriesInFileOrder: vi.fn().mockReturnValue([])
			},
			getVaultMarkdownFiles: vi.fn(() => []),
			getTrackedMarkdownFiles: vi.fn(() => []),
			isPluginGeneratedFile: vi.fn(() => false)
		} as unknown as TimelineBoardPlugin;

		container = new MockElement('wn-timeline-board');
		(globalThis as unknown as { createDiv: (opts?: string | { cls?: string; text?: string }) => MockElement }).createDiv = (opts?: string | { cls?: string; text?: string }) => {
			const cls = typeof opts === 'string' ? opts : opts?.cls || '';
			const el = new MockElement(cls);
			if (typeof opts === 'object' && opts?.text) {
				el.textContent = opts.text;
			}
			return el;
		};
		(globalThis as unknown as { createFragment: () => MockElement }).createFragment = () => {
			return new MockElement('document-fragment');
		};
		vi.stubGlobal('window', mockOwnerWindow);
		vi.stubGlobal('activeDocument', {
			createElementNS: (_ns: string, tag: string) => new MockElement(tag),
			body: {
				classList: {
					contains: () => false
				}
			}
		});
		class MockMutationObserver {
			observe = vi.fn();
			disconnect = vi.fn();
		}
		vi.stubGlobal('MutationObserver', MockMutationObserver);
	});

	it('should render unscheduled sort toggle button with correct attributes and sort chapters deterministically in ascending mode', async () => {
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md');

		const toggleSpy = vi.fn();

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v2c1, v1c2, v1c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isUnscheduledDescending: false,
			onToggleUnscheduledSort: toggleSpy
		};

		vi.mocked(CorkboardGridRenderer.render).mockImplementationOnce(({ container: grid }) => {
			grid.createDiv('wn-corkboard-volume-header');
		});
		await TimelineBoardRenderer.render(options);
		expect(container.querySelector('.wn-timeline-unscheduled-list')?.hasClass('is-volume-first')).toBe(true);

		// Find the sort toggle in the unscheduled header
		const sortToggle = container.querySelector('.wn-workbench-sort-toggle');
		expect(sortToggle).not.toBeNull();
		expect(sortToggle?.getAttribute('role')).toBe('button');
		expect(sortToggle?.getAttribute('tabindex')).toBe('0');
		expect(sortToggle?.getAttribute('aria-label')).toBe('corkboard.sort-ascending');
		expect(sortToggle?.getAttribute('aria-pressed')).toBe('false');

		// Check CorkboardGridRenderer received files sorted deterministically (Vol 1 -> Vol 2)
		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v1c1, v1c2, v2c1],
				currentBookPath: 'NovelA',
				draggable: true
			})
		);

		// Test click event triggers onToggleUnscheduledSort with stopPropagation
		const stopPropagationSpy = vi.fn();
		sortToggle?.onclick?.({ stopPropagation: stopPropagationSpy });
		expect(toggleSpy).toHaveBeenCalledTimes(1);
		expect(stopPropagationSpy).toHaveBeenCalledTimes(1);

		// Test keydown Enter triggers onToggleUnscheduledSort
		const preventDefaultSpy = vi.fn();
		const stopPropagationKeySpy = vi.fn();
		sortToggle?.dispatchEvent('keydown', {
			key: 'Enter',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleSpy).toHaveBeenCalledTimes(2);
		expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
		expect(stopPropagationKeySpy).toHaveBeenCalled();

		// Test keydown Space triggers onToggleUnscheduledSort
		sortToggle?.dispatchEvent('keydown', {
			key: ' ',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleSpy).toHaveBeenCalledTimes(3);
	});

	it('should render descending sort toggle and reverse unscheduled chapters when isUnscheduledDescending is true', async () => {
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md');

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v1c1, v1c2, v2c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isUnscheduledDescending: true,
			onToggleUnscheduledSort: vi.fn()
		};

		await TimelineBoardRenderer.render(options);

		const sortToggle = container.querySelector('.wn-workbench-sort-toggle');
		expect(sortToggle).not.toBeNull();
		expect(sortToggle?.getAttribute('aria-label')).toBe('corkboard.sort-descending');
		expect(sortToggle?.getAttribute('aria-pressed')).toBe('true');

		// Descending order: Vol 2 -> Vol 1
		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v2c1, v1c2, v1c1],
				currentBookPath: 'NovelA',
				draggable: true
			})
		);
	});

	it.each(['desktop', 'tablet'])('uses the same side controls and keyboard wiring on %s', async (platform) => {
		container.mockIsTablet = platform === 'tablet';
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const toggleCollapseSpy = vi.fn();
		const toggleSortSpy = vi.fn();

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v1c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isUnscheduledDescending: false,
			onToggleUnscheduledSort: toggleSortSpy,
			isSidebarCollapsed: false,
			onToggleSidebarCollapse: toggleCollapseSpy
		};

		await TimelineBoardRenderer.render(options);

		// Collapse button in header
		const collapseBtn = container.querySelector('.wn-timeline-sidebar-collapse-btn');
		expect(collapseBtn).not.toBeNull();
		expect(collapseBtn?.getAttribute('role')).toBe('button');
		expect(collapseBtn?.getAttribute('tabindex')).toBe('0');
		expect(collapseBtn?.getAttribute('aria-label')).toBe('corkboard.collapse-sidebar');
		expect(collapseBtn?.getAttribute('data-icon')).toBe('chevron-right');
		expect(setIcon).toHaveBeenCalledWith(collapseBtn, 'chevron-right');

		// Separate expand handle in sidebar
		const expandHandle = container.querySelector('.wn-timeline-sidebar-expand-handle');
		expect(expandHandle).not.toBeNull();
		expect(expandHandle?.getAttribute('role')).toBe('button');
		expect(expandHandle?.getAttribute('tabindex')).toBe('0');
		expect(expandHandle?.getAttribute('aria-label')).toBe('corkboard.expand-sidebar');
		expect(expandHandle?.getAttribute('data-icon')).toBe('chevron-left');
		expect(setIcon).toHaveBeenCalledWith(expandHandle, 'chevron-left');

		// Click collapse button triggers onToggleSidebarCollapse with stopPropagation
		const stopPropagationSpy = vi.fn();
		collapseBtn?.onclick?.({ stopPropagation: stopPropagationSpy });
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(1);
		expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
		expect(toggleSortSpy).not.toHaveBeenCalled();

		// Keyboard Enter and Space on collapse button triggers onToggleSidebarCollapse
		const preventDefaultSpy = vi.fn();
		const stopPropagationKeySpy = vi.fn();
		collapseBtn?.dispatchEvent('keydown', {
			key: 'Enter',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(2);
		expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
		expect(stopPropagationKeySpy).toHaveBeenCalled();
		expect(toggleSortSpy).not.toHaveBeenCalled();

		collapseBtn?.dispatchEvent('keydown', {
			key: ' ',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(3);
		expect(toggleSortSpy).not.toHaveBeenCalled();

		// Click expand handle triggers onToggleSidebarCollapse
		expandHandle?.onclick?.({ stopPropagation: stopPropagationSpy });
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(4);
		expect(toggleSortSpy).not.toHaveBeenCalled();

		// Keyboard Enter and Space on expand handle
		expandHandle?.dispatchEvent('keydown', {
			key: 'Enter',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(5);

		expandHandle?.dispatchEvent('keydown', {
			key: ' ',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(6);
		expect(toggleSortSpy).not.toHaveBeenCalled();

		// Sort button click remains independent: triggers toggleSortSpy, NOT toggleCollapseSpy
		const sortToggle = container.querySelector('.wn-workbench-sort-toggle');
		sortToggle?.onclick?.({ stopPropagation: stopPropagationSpy });
		expect(toggleSortSpy).toHaveBeenCalledTimes(1);
		expect(toggleCollapseSpy).toHaveBeenCalledTimes(6);
	});

	it('should add is-collapsed class to sidebar when isSidebarCollapsed is true and keep dropzone active', async () => {
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v1c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isSidebarCollapsed: true
		};

		await TimelineBoardRenderer.render(options);

		const sideCol = container.querySelector('.wn-timeline-waterfall-sidebar');
		expect(sideCol).not.toBeNull();
		expect(sideCol?.hasClass('is-collapsed')).toBe(true);

		// Dropzone remains configured
		expect(sideCol?.listeners.has('dragover')).toBe(true);
		expect(sideCol?.listeners.has('drop')).toBe(true);
	});

	it('should not add is-collapsed class when isSidebarCollapsed is false', async () => {
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v1c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isSidebarCollapsed: false
		};

		await TimelineBoardRenderer.render(options);

		const sideCol = container.querySelector('.wn-timeline-waterfall-sidebar');
		expect(sideCol).not.toBeNull();
		expect(sideCol?.hasClass('is-collapsed')).toBe(false);
	});

	it.each([true, false])('uses a phone drawer toggle with visible chapters=%s', async (hasChapters) => {
		container.mockIsPhone = true;
		const toggleCollapse = vi.fn();
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: hasChapters ? [createMockFile('Chapter 1.md', 'Example/Volume 1/Chapter 1.md')] : [],
			foreshadowingMap: new Map(),
			currentBookPath: 'Example',
			loadedEntries: [],
			loadedPendingEvents: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			onToggleSidebarCollapse: toggleCollapse
		};

		await TimelineBoardRenderer.render(options);
		const header = container.querySelector(hasChapters ? '.wn-timeline-unscheduled-header' : '.wn-timeline-pending-header');
		const collapse = header?.querySelector('.wn-timeline-sidebar-collapse-btn');
		expect(collapse?.getAttribute('data-icon')).toBe('chevron-down');
		expect(collapse?.getAttribute('aria-label')).toBe('corkboard.collapse-sidebar');
		expect(collapse?.getAttribute('aria-expanded')).toBe('true');
		collapse?.click();
		expect(toggleCollapse).toHaveBeenCalledTimes(1);

		container.empty();
		await TimelineBoardRenderer.render({ ...options, isSidebarCollapsed: true });
		expect(container.querySelector('.wn-timeline-waterfall-sidebar')?.hasClass('is-collapsed')).toBe(true);
		expect(container.querySelector('.wn-timeline-waterfall-layout')?.hasClass('is-sidebar-collapsed')).toBe(true);
		const expand = container.querySelector('.wn-timeline-sidebar-expand-handle');
		expect(expand?.getAttribute('data-icon')).toBe('chevron-up');
		expect(expand?.getAttribute('aria-label')).toBe('corkboard.expand-sidebar');
		expect(expand?.getAttribute('aria-expanded')).toBe('false');
		expand?.dispatchEvent('keydown', { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(toggleCollapse).toHaveBeenCalledTimes(2);
	});

	it('should maintain same-node description element as sole scroll owner without creating nested textarea during event inline edit', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', type: '主线', description: '初始事件描述', items: [{ description: '初始事件描述', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 200;
		descEl.scrollTop = 100; // at bottom (200 - 100 = 100)

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		// Verify descEl itself became contenteditable and no nested textarea exists
		expect(descEl.hasClass('is-editing')).toBe(true);
		expect(descEl.getAttribute('contenteditable')).toBe('plaintext-only');
		expect(descEl.getAttribute('role')).toBe('textbox');
		expect(descEl.getAttribute('aria-multiline')).toBe('true');
		expect(descEl.querySelector('textarea')).toBeNull();
		expect(descEl.querySelector('.wn-corkboard-textarea')).toBeNull();

		// Should preserve bottom position at 100
		expect(descEl.scrollTop).toBe(100);
		expect(descEl.style.minHeight ?? '').toBe('');
	});

	it('uses the timeline card controls for pending events and preserves importance when placed by drag', async () => {
		const placeIntoSpy = vi.fn().mockResolvedValue('updated');
		const updatePendingSpy = vi.fn().mockResolvedValue('updated');
		const entry: TimelineEntry = {
			time: '第一年',
			type: '主线',
			description: '初始事件描述',
			chapter: '',
			rawBlock: '',
			items: [{ description: '初始事件描述', chapter: '' }]
		};

		await TimelineBoardRenderer.render({
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					placePendingEventIntoNode: placeIntoSpy,
					updatePendingEvent: updatePendingSpy
				}
			} as unknown as TimelineBoardPlugin,
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			loadedEntries: [entry],
			loadedPendingEvents: [{ id: 'pe_place', description: '待排放置事件', chapter: '' }],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		});

		const card = container.querySelector('.wn-timeline-pending-card')!;
		expect(card.querySelector('.wn-timeline-item-desc')).not.toBeNull();
		expect(card.querySelector('.wn-timeline-pending-place-btn')).toBeNull();
		expect(card.querySelector('.wn-timeline-item-delete-btn')?.getAttribute('aria-label')).toBe('common.delete');
		expect(card.querySelector('.wn-timeline-item-delete-btn')?.getAttribute('data-icon')).toBe('trash');
		const star = card.querySelector('.wn-card-importance-btn')!;
		star.click();
		await vi.waitFor(() => expect(updatePendingSpy).toHaveBeenCalledWith(
			'pe_place', { important: true }, 'NovelA', expect.objectContaining({ id: 'pe_place' })
		));
		expect(star.getAttribute('aria-pressed')).toBe('true');

		container.querySelector('.wn-timeline-item-row')!.dispatchEvent('drop', {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: {
				types: ['application/wn-timeline-pending-id'],
				getData: (type: string) => type === 'application/wn-timeline-pending-id' ? 'pe_place' : ''
			}
		});
		await vi.waitFor(() => expect(placeIntoSpy).toHaveBeenCalledTimes(1));
		expect(placeIntoSpy).toHaveBeenCalledWith(
			'pe_place',
			0,
			0,
			'NovelA',
			expect.objectContaining({ id: 'pe_place', important: true }),
			expect.objectContaining({ time: '第一年' })
		);

	});

	it('should preserve fixed-size overflow-y container without temporary minHeight or nested scroll owner', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '初始事件描述', items: [{ description: '初始事件描述', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 200;

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		// Verify container remains fixed without temporary minHeight and without nested textarea
		expect(descEl.style.minHeight ?? '').toBe('');
		expect(descEl.querySelector('textarea')).toBeNull();
		expect(descEl.hasClass('is-editing')).toBe(true);
	});

	it('should render multi-line event item in display mode with intact text and trigger reload upon blur save', async () => {
		const reloadBoardSpy = vi.fn();
		const updateEntrySpy = vi.fn().mockResolvedValue(undefined);
		const onSaveStateChangeSpy = vi.fn();
		const multiLineDesc = '第一行事件记录\n第二行事件细节\n第三行关键转折点';

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: multiLineDesc, items: [{ description: multiLineDesc, chapter: '' }] }
					]),
					updateEntry: updateEntrySpy
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: onSaveStateChangeSpy,
			reloadBoard: reloadBoardSpy,
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		expect(descEl.hasClass('is-editing')).toBe(false);
		expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(false);

		// Display mode creates three line blocks for three-line description
		const displayLines = descEl.querySelectorAll('.wn-sticky-note-editor-line');
		expect(displayLines).toHaveLength(3);
		expect(displayLines[0].textContent).toBe('第一行事件记录');
		expect(displayLines[1].textContent).toBe('第二行事件细节');
		expect(displayLines[2].textContent).toBe('第三行关键转折点');

		// Click into edit mode on the same node
		descEl.onclick?.({ stopPropagation: vi.fn() });
		expect(descEl.querySelector('textarea')).toBeNull();
		expect(descEl.hasClass('is-editing')).toBe(true);
		expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);
		const lines = descEl.querySelectorAll('.wn-sticky-note-editor-line');
		expect(lines).toHaveLength(3);
		expect(lines[0].textContent).toBe('第一行事件记录');
		expect(lines[1].textContent).toBe('第二行事件细节');
		expect(lines[2].textContent).toBe('第三行关键转折点');
		expect((descEl as unknown as { value: string }).value).toBe(multiLineDesc);

		// Modify content and blur
		descEl.textContent = multiLineDesc + '\n第四行新发展';
		await descEl.onblur?.();

		expect(updateEntrySpy).toHaveBeenCalledWith(
			0,
			expect.objectContaining({
				items: [{ description: multiLineDesc + '\n第四行新发展', chapter: '' }]
			}),
			'NovelA',
			expect.anything()
		);
		expect(reloadBoardSpy).toHaveBeenCalled();
	});

	it('should map scroll to maximum bottom when entering inline edit mode from display bottom', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '较长事件描述内容\n第二行内容\n第三行内容', items: [{ description: '较长事件描述内容\n第二行内容\n第三行内容', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 200;
		descEl.scrollTop = 100; // at display bottom (200 - 100 = 100)

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		// In edit mode, scrollHeight is 200, clientHeight is 100 -> max scroll is 100
		expect(descEl.scrollTop).toBe(100);
		expect(mockOwnerWindow.requestAnimationFrame).toHaveBeenCalled();

		// Execute next animation frame callback and verify bottom position remains at 100
		const callbacks = [...animationFrameCallbacks];
		animationFrameCallbacks = [];
		for (const cb of callbacks) cb(0);
		expect(descEl.scrollTop).toBe(100);
	});

	it('should preserve and clamp previous scrollTop when entering inline edit mode from middle scroll position', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '较长事件描述内容\n第二行内容\n第三行内容', items: [{ description: '较长事件描述内容\n第二行内容\n第三行内容', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 300;
		descEl.scrollTop = 50; // middle position (50 < 300 - 100 - 8 = 192)

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		// Should preserve middle scrollTop of 50
		expect(descEl.scrollTop).toBe(50);
		expect(mockOwnerWindow.requestAnimationFrame).toHaveBeenCalled();

		// Execute next animation frame callback and verify middle position remains preserved
		const callbacks = [...animationFrameCallbacks];
		animationFrameCallbacks = [];
		for (const cb of callbacks) cb(0);
		expect(descEl.scrollTop).toBe(50);
	});

	it('renders the important star before delete in the timeline event action rail', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{
							time: '第一年',
							description: '关键事件',
							items: [{ description: '关键事件', chapter: '', important: true }]
						}
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		const descShell = container.querySelector('.wn-timeline-item-desc-shell') as unknown as MockElement;
		const actionRail = descShell.querySelector('.wn-timeline-item-actions') as unknown as MockElement;
		expect(descEl.hasClass('is-important')).toBe(true);
		expect(descEl.hasClass('wn-card-is-important')).toBe(true);
		expect(actionRail.parentElement).toBe(descShell);
		expect(descEl.querySelector('.wn-timeline-item-actions')).toBeNull();
		expect(actionRail.children).toHaveLength(2);
		expect(actionRail.children[0].hasClass('wn-card-importance-btn')).toBe(true);
		expect(actionRail.children[0].hasClass('is-important')).toBe(true);
		expect(actionRail.children[1].hasClass('wn-timeline-item-delete-btn')).toBe(true);
	});

	it('should construct chapter reference index exactly once for multiple references during render', async () => {
		const createIndexSpy = vi.spyOn(ChapterSorter, 'createReferenceIndex');

		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md');

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{
							time: '事件1',
							description: '描述1',
							items: [
								{ description: '子事件1', chapter: '第一卷/第1章, 第一卷/第2章' },
								{ description: '子事件2', chapter: '第二卷/第1章' }
							]
						},
						{
							time: '事件2',
							description: '描述2',
							chapter: '第一卷/第1章, 第二卷/第1章'
						}
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [v1c1, v1c2, v2c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		// Verified that createReferenceIndex was invoked exactly once across all 5 chapter references
		expect(createIndexSpy).toHaveBeenCalledTimes(1);
		expect(createIndexSpy).toHaveBeenCalledWith(
			mockApp,
			expect.anything(),
			'NovelA',
			expect.objectContaining({ eligibleChapters: [v1c1, v1c2, v2c1] })
		);
	});

	it('filters by node-level lore while preserving all sibling sub-events and indexes', async () => {
		mockPlugin.timelineManager.loadEntries = vi.fn().mockResolvedValue([{
			time: '第一天',
			description: '甲事件\n乙事件',
			chapter: '',
			rawBlock: '',
			lores: ['乙'],
			items: [
				{ description: '甲事件', chapter: '', type: '主线' },
				{ description: '乙事件', chapter: '', type: '主线' }
			]
		}]);

		await TimelineBoardRenderer.render({
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: [],
			currentTimelineLoreFilter: ['乙'],
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		});

		const rows = container.querySelectorAll('.wn-timeline-item-row');
		expect(rows).toHaveLength(2);
		expect(rows[0].getAttribute('data-item-index')).toBe('0');
		expect(rows[1].getAttribute('data-item-index')).toBe('1');
		expect(rows[0].textContent).toContain('甲事件');
		expect(rows[1].textContent).toContain('乙事件');
		const loreBadges = container.querySelector('.wn-timeline-node-lore-badges');
		expect(loreBadges).not.toBeNull();
		expect(loreBadges?.querySelectorAll('.wn-badge-lore')).toHaveLength(1);
	});

	describe('descending viewing order and index invariants', () => {
		it('should render timeline nodes in descending order without mutating loaded entries array', async () => {
			const rawEntries = [
				{ time: '第一年', description: '事件1', items: [{ description: '事件1', chapter: '' }] },
				{ time: '第二年', description: '事件2', items: [{ description: '事件2', chapter: '' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: true,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			const nodeTitles = container.querySelectorAll('.wn-timeline-node-time-text');
			expect(nodeTitles).toHaveLength(2);
			expect(nodeTitles[0].textContent).toBe('第二年');
			expect(nodeTitles[1].textContent).toBe('第一年');

			// Base entries array must not be mutated
			expect(rawEntries[0].time).toBe('第一年');
			expect(rawEntries[1].time).toBe('第二年');
		});

		it('should resolve original index from unmodified allEntries when editing or deleting in descending order', async () => {
			const entry0 = { time: '第一年', description: '描述1', items: [{ description: '描述1', chapter: '' }] };
			const entry1 = { time: '第二年', description: '描述2', items: [{ description: '描述2', chapter: '' }] };
			const rawEntries = [entry0, entry1];

			const deleteEntrySpy = vi.fn().mockResolvedValue('');
			const updateEntrySpy = vi.fn().mockResolvedValue('');

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md')),
						deleteEntry: deleteEntrySpy,
						updateEntry: updateEntrySpy
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: true,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			// First displayed node is entry1 ("第二年", original index 1)
			const deleteBtns = container.querySelectorAll('.wn-timeline-item-delete-btn');
			expect(deleteBtns).toHaveLength(2);

			// Click delete on first displayed node (original index 1)
			deleteBtns[0].onclick?.({ stopPropagation: vi.fn() });
			expect(lastOpenedModal).not.toBeNull();
			const confirmBtn = lastOpenedModal?.contentEl.querySelector('.mod-warning') as unknown as MockElement;
			expect(confirmBtn).not.toBeNull();
			confirmBtn.onclick?.();

			// deleteEntry must be called with originalIndex = 1
			expect(deleteEntrySpy).toHaveBeenCalledWith(1, 'NovelA', expect.anything());

			// Now test inline edit on second displayed node (entry0 "第一年", original index 0)
			const descEls = container.querySelectorAll('.wn-timeline-item-desc');
			expect(descEls).toHaveLength(2);
			const descEl0 = descEls[1] as unknown as MockElement; // second displayed node = entry0
			descEl0.onclick?.({ stopPropagation: vi.fn() });
			descEl0.textContent = '修改后的第一年描述';
			descEl0.onblur?.();

			// updateEntry must be called with originalIndex = 0
			expect(updateEntrySpy).toHaveBeenCalledWith(0, expect.objectContaining({ time: '第一年' }), 'NovelA', expect.anything());
		});

		it('should render adjacent chapter in descending gap between nodes', async () => {
			const chap1 = createMockFile('第1章.md', 'NovelA/第1章.md');

			const rawEntries = [
				{ time: '第一年', description: '描述1', items: [{ description: '描述1', chapter: '第1章' }] },
				{ time: '第二年', description: '描述2', items: [{ description: '描述2', chapter: '第1章' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [chap1],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: true,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
			await TimelineBoardRenderer.render(options);

			// In descending order, gap is between 第二年 and 第一年
			expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
				expect.objectContaining({
					files: [chap1],
					currentBookPath: 'NovelA'
				})
			);
		});

		it('should associate multi-event non-adjacent chapters with the first displayed node in descending view', async () => {
			const chap1 = createMockFile('第1章.md', 'NovelA/第1章.md');

			const rawEntries = [
				{ time: '第一年', description: '描述1', items: [{ description: '描述1', chapter: '第1章' }] },
				{ time: '第二年', description: '描述2', items: [{ description: '描述2', chapter: '' }] },
				{ time: '第三年', description: '描述3', items: [{ description: '描述3', chapter: '第1章' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [chap1],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: true,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
			await TimelineBoardRenderer.render(options);

			// In descending view, 第三年 is the first displayed node among [第三年, 第二年, 第一年]
			// Non-adjacent chapter is rendered in first displayed node
			const calls = (CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mock.calls;
			const cardCall = calls.find(c => (c[0].files as TFile[]).includes(chap1));
			expect(cardCall).toBeDefined();
		});
	});

	describe('Security and Lifecycle', () => {
		it('assigns distinct stable entry indexes to nodes with identical time text', async () => {
			const rawEntries = [
				{ time: '同一天', description: '事件1', items: [{ description: '事件1', chapter: '' }] },
				{ time: '同一天', description: '事件2', items: [{ description: '事件2', chapter: '' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: false,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);
			const rowEls = container.querySelectorAll('.wn-timeline-item-row');
			expect(rowEls.length).toBe(2);
			expect(rowEls[0].getAttribute('data-entry-index')).toBe('0');
			expect(rowEls[1].getAttribute('data-entry-index')).toBe('1');
		});

		it('should safely render timeline nodes with special characters in time field without throwing querySelector syntax errors', async () => {
			const rawEntries = [
				{ time: '第一年 [特殊: {字符}] #1', description: '描述1', items: [{ description: '描述1', chapter: '' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: false,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await expect(TimelineBoardRenderer.render(options)).resolves.not.toThrow();
			const node = container.querySelector('.wn-timeline-node');
			expect(node).not.toBeNull();
		});

		it('should cancel requestAnimationFrame on cleanup', async () => {
			let cleanupFn: (() => void) | null = null;
			const mockOwner = {
				register: (fn: () => void) => { cleanupFn = fn; }
			};
			const chap1 = createMockFile('第1章.md', 'NovelA/第1章.md');
			const rawEntries = [
				{ time: '第一年', description: '描述1', items: [{ description: '描述1', chapter: '第1章' }] },
				{ time: '第三年', description: '描述3', items: [{ description: '描述3', chapter: '第1章' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [chap1],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: false,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([]),
				ownerComponent: mockOwner as unknown as Component
			};

			mockOwnerWindow.cancelAnimationFrame.mockClear();
			await TimelineBoardRenderer.render(options);
			const mainCol = container.querySelector('.wn-timeline-waterfall-main');
			mainCol?.dispatchEvent('scroll');
			expect(cleanupFn).toBeDefined();
			if (cleanupFn) (cleanupFn as () => void)();
			expect(mockOwnerWindow.cancelAnimationFrame).toHaveBeenCalled();
		});

		it('renders trajectory mode and resets viewport to panX=0, panY=0, scale=1 on render and repeated renders', async () => {
			const rawEntries: TimelineEntry[] = [
				{ time: '第一年', description: '描述1', chapter: '第1章', rawBlock: '', items: [{ description: '描述1', chapter: '第1章', type: '主线' }] }
			];

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(rawEntries),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [createMockFile('第1章.md', 'NovelA/第1章.md')],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: false,
				isTrajectoryMode: true,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);
			const grid = container.querySelector('.wn-trajectory-grid');
			expect(grid).toBeDefined();
			expect(grid?.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');

			// Repeated render also starts at default viewport
			container.empty();
			await TimelineBoardRenderer.render(options);
			const grid2 = container.querySelector('.wn-trajectory-grid');
			expect(grid2?.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
		});

		it('renders trajectory mode without reading foreshadowingMap', async () => {
			const container = new MockElement();
			const getSpy = vi.fn();
			const dummyMap = {
				get: getSpy,
				has: vi.fn(),
				entries: vi.fn(),
				keys: vi.fn(),
				values: vi.fn()
			} as unknown as Map<string, import('../src/types/foreshadowing').ParsedForeshadowingEntry[]>;

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue([]),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: container as unknown as HTMLElement,
				files: [createMockFile('第1章.md', 'NovelA/第1章.md')],
				foreshadowingMap: dummyMap,
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: false,
				isTrajectoryMode: true,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);
			expect(getSpy).not.toHaveBeenCalled();
		});

		it('displays same-name typed nodes separately and filters whole nodes', async () => {
			const mixedEntries: TimelineEntry[] = [
				{
					time: '第一年',
					type: '主线',
					description: '主线事件',
					chapter: '第1章',
					rawBlock: '',
					items: [{ description: '主线事件描述', chapter: '第1章' }]
				},
				{
					time: '第一年', type: '支线', description: '支线事件', chapter: '第2章', rawBlock: '',
					items: [{ description: '支线事件描述', chapter: '第2章' }]
				},
				{
					time: '第一年', type: '日常', description: '日常事件', chapter: '第3章', rawBlock: '',
					items: [{ description: '日常事件描述', chapter: '第3章' }]
				},
				{
					time: '第二年', description: '无类型旧事件', chapter: '第4章', rawBlock: '',
					items: [{ description: '无类型描述', chapter: '第4章' }]
				},
				{
					time: '第三年', type: 'all', description: '字面量all事件', chapter: '第5章', rawBlock: '',
					items: [{ description: 'all类型描述', chapter: '第5章' }]
				}
			];

			const renderWithOptions = async (filter: readonly string[] = [], isDescending = false, loreFilter?: string[]) => {
				const c = new MockElement();
				await TimelineBoardRenderer.render({
					app: mockApp,
					plugin: {
						...mockPlugin,
						timelineManager: {
							...mockPlugin.timelineManager,
							loadEntries: vi.fn().mockResolvedValue(mixedEntries),
							getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
						}
					},
					container: c as unknown as HTMLElement,
					files: [
						createMockFile('第1章.md', 'NovelA/第1章.md'),
						createMockFile('第2章.md', 'NovelA/第2章.md'),
						createMockFile('第3章.md', 'NovelA/第3章.md'),
						createMockFile('第4章.md', 'NovelA/第4章.md'),
						createMockFile('第5章.md', 'NovelA/第5章.md')
					],
					foreshadowingMap: new Map(),
					currentBookPath: 'NovelA',
					currentTimelineFilter: filter,
					currentTimelineLoreFilter: loreFilter,
					isDescending,
					onSaveStateChange: vi.fn(),
					reloadBoard: vi.fn(),
					getChapterEvents: vi.fn().mockReturnValue([])
				});
				return c;
			};

			// Empty filter: all entries including untyped are rendered.
			const cAll = await renderWithOptions([]);
			const badgesAll = cAll.querySelectorAll('.wn-timeline-type-badge');
			expect(badgesAll.map(b => b.textContent)).toEqual(['主线', '支线', '日常', 'all']);
			const itemRowsAll = cAll.querySelectorAll('.wn-timeline-item-row');
			expect(itemRowsAll.length).toBe(5);

			// Filtering by single type retains only that node, excluding untyped.
			const cSub = await renderWithOptions(['支线']);
			const nodesSub = cSub.querySelectorAll('.wn-timeline-node');
			expect(nodesSub.length).toBe(1);
			const badgesSub = cSub.querySelectorAll('.wn-timeline-type-badge');
			expect(badgesSub.map(b => b.textContent)).toEqual(['支线']);
			const itemRowsSub = cSub.querySelectorAll('.wn-timeline-item-row');
			expect(itemRowsSub.length).toBe(1);
			expect(itemRowsSub[0].attributes.get('data-item-index')).toBe('0');
			expect(itemRowsSub[0].querySelector('.wn-timeline-item-desc')?.textContent).toBe('支线事件描述');

			// Multi-selection: selecting ['主线', '支线'] retains both, excluding '日常', untyped, and 'all'.
			const cMulti = await renderWithOptions(['主线', '支线']);
			const badgesMulti = cMulti.querySelectorAll('.wn-timeline-type-badge');
			expect(badgesMulti.map(b => b.textContent)).toEqual(['主线', '支线']);
			const nodesMulti = cMulti.querySelectorAll('.wn-timeline-node');
			expect(nodesMulti.length).toBe(2);

			// Preserves original indices in allEntries even with same-name nodes and descending order
			const cDesc = await renderWithOptions(['主线', '支线'], true);
			const nodesDesc = cDesc.querySelectorAll('.wn-timeline-node');
			expect(nodesDesc.length).toBe(2);
			const itemsDesc = cDesc.querySelectorAll('.wn-timeline-item-row');
			// In descending order, '支线' (index 1) renders before '主线' (index 0)
			expect(itemsDesc[0].querySelector('.wn-timeline-item-desc')?.textContent).toBe('支线事件描述');
			expect(itemsDesc[1].querySelector('.wn-timeline-item-desc')?.textContent).toBe('主线事件描述');
			expect(itemsDesc.map(item => item.getAttribute('data-entry-index'))).toEqual(['1', '0']);

			// Custom type named 'all' can be selected explicitly
			const cCustomAll = await renderWithOptions(['all']);
			const badgesCustomAll = cCustomAll.querySelectorAll('.wn-timeline-type-badge');
			expect(badgesCustomAll.map(b => b.textContent)).toEqual(['all']);
			expect(cCustomAll.querySelectorAll('.wn-timeline-node').length).toBe(1);
		});

		it('resolves comma-bearing chapter link and does not classify it as unscheduled', async () => {
			const commaChapter = createMockFile('第1章，你好.md', 'NovelA/第1章，你好.md');
			const entriesWithComma: TimelineEntry[] = [
				{
					time: '第一年',
					type: '主线',
					description: '主线事件',
					chapter: '["第1章，你好"]',
					rawBlock: '',
					items: [{ description: '主线事件描述', chapter: '["第1章，你好"]' }]
				}
			];

			(CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mockClear();
			const c = new MockElement();
			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue(entriesWithComma),
						getTimelineFile: vi.fn().mockReturnValue(createMockFile('timeline.md', 'NovelA/timeline.md'))
					}
				},
				container: c as unknown as HTMLElement,
				files: [commaChapter],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				isDescending: false,
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			// CorkboardGridRenderer should receive empty files for unscheduled since commaChapter is scheduled
			const lastCall = (CorkboardGridRenderer.render as ReturnType<typeof vi.fn>).mock.calls.at(-1);
			expect(lastCall?.[0]?.files).toEqual([]);
		});
	});

	describe('Timeline editor lifecycle and pending save interaction ordering regressions', () => {
		it('tears down pending card inline editor before onSaveStateChange(false) and reloadBoard, and preserves draft on failure', async () => {
			let fail = true;
			const callOrder: string[] = [];
			const updatePendingSpy = vi.fn().mockImplementation(async () => {
				callOrder.push('updatePendingEvent');
				if (fail) throw new Error('Disk write failed');
				return 'updated';
			});
			const onSaveStateChangeSpy = vi.fn().mockImplementation((isSaving: boolean) => {
				callOrder.push(`saveState:${isSaving}`);
			});
			const reloadBoardSpy = vi.fn().mockImplementation(() => {
				callOrder.push('reloadBoard');
			});

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						updatePendingEvent: updatePendingSpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				loadedEntries: [],
				loadedPendingEvents: [{ id: 'pe_edit', description: '原始待排', chapter: '' }],
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const pendingDesc = container.querySelector('.wn-timeline-pending-card')?.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			const range = pendingDesc.ownerDocument.createRange();
			const createRange = vi.spyOn(pendingDesc.ownerDocument, 'createRange').mockReturnValueOnce(range);
			pendingDesc.onclick?.({ stopPropagation: vi.fn() });
			expect(pendingDesc.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);
			expect(range.selectNodeContents).toHaveBeenCalledWith(pendingDesc);
			expect(range.collapse).toHaveBeenCalledWith(false);
			createRange.mockRestore();

			pendingDesc.textContent = '修改后的待排';
			await pendingDesc.onblur?.();

			// On error: remains editable and reloadBoard not called
			expect(updatePendingSpy).toHaveBeenCalledTimes(1);
			expect(pendingDesc.hasClass('is-editing')).toBe(true);
			expect(reloadBoardSpy).not.toHaveBeenCalled();

			// Retry succeeds
			callOrder.length = 0;
			fail = false;
			await pendingDesc.onblur?.();
			expect(pendingDesc.hasClass('wn-sticky-note-paragraph-editor')).toBe(false);
			expect(pendingDesc.hasClass('is-editing')).toBe(false);
			expect(callOrder).toEqual([
				'saveState:true',
				'updatePendingEvent',
				'saveState:false',
				'reloadBoard'
			]);
		});

		it('echoes time-pending checkbox in TimelineEditModal and allows filling real time to save', async () => {
			const tlFile = createMockFile('Timeline.md', 'NovelA/Timeline.md');
			const updateEntrySpy = vi.fn().mockResolvedValue('updated');
			const reloadBoardSpy = vi.fn();
			const entry: TimelineEntry = {
				time: '',
				timePending: true,
				nodeId: 'nd_echo',
				type: '主线',
				description: '待定节点事件',
				chapter: '',
				rawBlock: '',
				items: [{ description: '待定节点事件', chapter: '' }]
			};

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						getTimelineFile: vi.fn().mockReturnValue(tlFile),
						updateEntry: updateEntrySpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				loadedEntries: [entry],
				loadedPendingEvents: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			lastOpenedModal = null;
			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			editBtn.click();
			expect(lastOpenedModal).not.toBeNull();

			const modalEl = lastOpenedModal!.contentEl;
			const timeInput = modalEl.querySelector('.wn-timeline-form-input') as unknown as MockElement & { disabled?: boolean };
			const checkbox = modalEl.querySelector('.wn-timeline-time-pending-checkbox') as unknown as MockElement & { checked?: boolean };
			expect(checkbox.checked).toBe(true);
			expect(timeInput.disabled).toBe(true);

			// Uncheck time-pending and fill real time
			checkbox.checked = false;
			checkbox.dispatchEvent('change');
			expect(timeInput.disabled).toBe(false);
			timeInput.value = '永和八年';

			const saveBtn = modalEl.querySelector('.mod-cta') as unknown as MockElement;
			saveBtn.click();
			await vi.waitFor(() => expect(updateEntrySpy).toHaveBeenCalledTimes(1));
			expect(updateEntrySpy).toHaveBeenCalledWith(
				0,
				expect.objectContaining({ time: '永和八年', timePending: undefined }),
				'NovelA',
				expect.objectContaining({ nodeId: 'nd_echo', timePending: true }),
				expect.anything()
			);
			expect(reloadBoardSpy).toHaveBeenCalledTimes(1);
		});

		it('tears down existing description editor before onSaveStateChange(false) and reloadBoard', async () => {
			const callOrder: string[] = [];
			const updateEntrySpy = vi.fn().mockImplementation(async () => {
				callOrder.push('updateEntry');
			});
			const onSaveStateChangeSpy = vi.fn().mockImplementation((isSaving: boolean) => {
				callOrder.push(`saveState:${isSaving}`);
			});
			const reloadBoardSpy = vi.fn().mockImplementation(() => {
				callOrder.push('reloadBoard');
			});

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue([
							{ time: '第一年', description: '旧描述', items: [{ description: '旧描述', chapter: '' }] }
						]),
						updateEntry: updateEntrySpy
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			descEl.onclick?.({ stopPropagation: vi.fn() });
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);

			descEl.textContent = '新描述';
			await descEl.onblur?.();

			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(false);
			expect(descEl.hasClass('is-editing')).toBe(false);
			expect(descEl.getAttribute('contenteditable')).toBeNull();

			expect(callOrder).toEqual([
				'saveState:true',
				'updateEntry',
				'saveState:false',
				'reloadBoard'
			]);
		});

		it('tears down existing description editor on unchanged blur without calling updateEntry', async () => {
			const updateEntrySpy = vi.fn();
			const reloadBoardSpy = vi.fn();

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue([
							{ time: '第一年', description: '旧描述', items: [{ description: '旧描述', chapter: '' }] }
						]),
						updateEntry: updateEntrySpy
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			descEl.onclick?.({ stopPropagation: vi.fn() });
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);

			// Unchanged blur
			await descEl.onblur?.();

			expect(updateEntrySpy).not.toHaveBeenCalled();
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(false);
			expect(descEl.hasClass('is-editing')).toBe(false);
			expect(reloadBoardSpy).toHaveBeenCalledTimes(1);
		});

		it('preserves draft on existing description error and allows retry without reloadBoard', async () => {
			let fail = true;
			const updateEntrySpy = vi.fn().mockImplementation(async () => {
				if (fail) throw new Error('Conflict or disk error');
			});
			const reloadBoardSpy = vi.fn();

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue([
							{ time: '第一年', description: '旧描述', items: [{ description: '旧描述', chapter: '' }] }
						]),
						updateEntry: updateEntrySpy
					}
				},
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			descEl.onclick?.({ stopPropagation: vi.fn() });

			descEl.textContent = '修改后的草稿';
			await descEl.onblur?.();

			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);
			expect(descEl.hasClass('is-editing')).toBe(true);
			expect(descEl.textContent).toBe('修改后的草稿');
			expect(reloadBoardSpy).not.toHaveBeenCalled();

			fail = false;
			await descEl.onblur?.();
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(false);
			expect(descEl.hasClass('is-editing')).toBe(false);
			expect(reloadBoardSpy).toHaveBeenCalledTimes(1);
		});

		it('awaits pending inline save before chapter drop captures expectedEntry snapshots', async () => {
			let resolveUpdate: (() => void) | null = null;
			const updateEntrySpy = vi.fn().mockImplementation(() => {
				return new Promise<void>((resolve) => {
					resolveUpdate = resolve;
				});
			});
			const syncChapterSpy = vi.fn().mockResolvedValue(undefined);
			const chapterFile = createMockFile('第1章.md', 'NovelA/第1章.md');
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(chapterFile);

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue([
							{ time: '第一年', description: '原描述', items: [{ description: '原描述', chapter: '' }] }
						]),
						updateEntry: updateEntrySpy,
						syncChapterToEventItem: syncChapterSpy
					}
				},
				container: container as unknown as HTMLElement,
				files: [chapterFile],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			descEl.onclick?.({ stopPropagation: vi.fn() });
			descEl.textContent = '保存后的新描述';

			// Invoke blur WITHOUT awaiting it
			void descEl.onblur?.();

			// Immediately drop chapter onto same row
			const itemRow = container.querySelector('.wn-timeline-item-row') as unknown as MockElement;
			itemRow.dispatchEvent('drop', {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-chapter-path'],
					getData: (format: string) => format === 'application/wn-chapter-path' ? 'NovelA/第1章.md' : ''
				}
			});

			// At this point, updateEntry is still pending
			expect(updateEntrySpy).toHaveBeenCalledTimes(1);
			expect(syncChapterSpy).not.toHaveBeenCalled();

			// Complete the pending inline save
			resolveUpdate!();
			await new Promise((r) => setTimeout(r, 10));

			// Now syncChapterToEventItem must have run with expectedEntry containing the NEW description
			expect(syncChapterSpy).toHaveBeenCalledTimes(1);
			const passedTargetEvents = syncChapterSpy.mock.calls[0][1];
			expect(passedTargetEvents[0].expectedEntry.items[0].description).toBe('保存后的新描述');
		});

		it('aborts chapter drop when pending inline save fails, preserving draft and avoiding stale conflict', async () => {
			let rejectUpdate: ((err: Error) => void) | null = null;
			const updateEntrySpy = vi.fn().mockImplementation(() => {
				return new Promise<void>((_, reject) => {
					rejectUpdate = reject;
				});
			});
			const syncChapterSpy = vi.fn();
			const chapterFile = createMockFile('第1章.md', 'NovelA/第1章.md');
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(chapterFile);

			const options: TimelineBoardOptions = {
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						loadEntries: vi.fn().mockResolvedValue([
							{ time: '第一年', description: '原描述', items: [{ description: '原描述', chapter: '' }] }
						]),
						updateEntry: updateEntrySpy,
						syncChapterToEventItem: syncChapterSpy
					}
				},
				container: container as unknown as HTMLElement,
				files: [chapterFile],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			};

			await TimelineBoardRenderer.render(options);

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			descEl.onclick?.({ stopPropagation: vi.fn() });
			descEl.textContent = '失败草稿';

			// Invoke blur without awaiting
			void descEl.onblur?.();

			// Immediately drop chapter
			const itemRow = container.querySelector('.wn-timeline-item-row') as unknown as MockElement;
			itemRow.dispatchEvent('drop', {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-chapter-path'],
					getData: (format: string) => format === 'application/wn-chapter-path' ? 'NovelA/第1章.md' : ''
				}
			});

			// The star must roll back its optimistic visual state when the prerequisite save fails.
			const star = container.querySelector('.wn-card-importance-btn') as unknown as MockElement;
			const starClick = star.onclick?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

			// Reject the pending inline save
			rejectUpdate!(new Error('Update failed'));
			await starClick;
			expect(star.getAttribute('aria-pressed')).toBe('false');
			await new Promise((r) => setTimeout(r, 10));

			// syncChapterToEventItem must NOT run
			expect(syncChapterSpy).not.toHaveBeenCalled();
			// Draft remains in editing mode
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);
			expect(descEl.textContent).toBe('失败草稿');
		});

		it('native-like integration: blur save followed immediately by chapter drop succeeds without conflict notice using real TimelineManager and in-memory vault', async () => {
			const vaultFiles = new Map<string, string>();
			const chapter1File = createMockFile('第1章.md', 'NovelA/第1章.md');
			const timelineFile = createMockFile('时间线.md', 'NovelA/时间线.md');
			vaultFiles.set('NovelA/第1章.md', '# 第1章\n正文内容');
			vaultFiles.set('NovelA/时间线.md', '');

			const mockVault = {
				read: vi.fn(async (file: TFile) => vaultFiles.get(file.path) ?? ''),
				cachedRead: vi.fn(async (file: TFile) => vaultFiles.get(file.path) ?? ''),
				create: vi.fn(async (path: string, data: string) => {
					vaultFiles.set(path, data);
					return path.endsWith('时间线.md') ? timelineFile : createMockFile(path.split('/').pop()!, path);
				}),
				modify: vi.fn(async (file: TFile, data: string) => {
					vaultFiles.set(file.path, data);
				}),
				process: vi.fn(async (file: TFile, callback: (content: string) => string) => {
					// Simulate native delay in processing/writing
					await new Promise((r) => setTimeout(r, 10));
					const cur = vaultFiles.get(file.path) ?? '';
					const updated = callback(cur);
					vaultFiles.set(file.path, updated);
					return updated;
				}),
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === 'NovelA/时间线.md') return timelineFile;
					if (path === 'NovelA/第1章.md') return chapter1File;
					return null;
				}),
				on: vi.fn()
			};

			const integrationApp = {
				vault: mockVault,
				metadataCache: {
					getFileCache: vi.fn(),
					getFirstLinkpathDest: vi.fn((linkText: string) => {
						if (linkText === '第1章' || linkText === 'NovelA/第1章.md') return chapter1File;
						return null;
					}),
					fileToLinktext: vi.fn((file: TFile) => file.basename)
				},
				fileManager: {
					processFrontMatter: vi.fn()
				}
			} as unknown as App;

			const integrationPlugin = {
				...mockPlugin,
				isPluginGeneratedFile: vi.fn(() => false),
				getTrackedMarkdownFiles: vi.fn(() => [chapter1File]),
				getVaultMarkdownFiles: vi.fn(() => [chapter1File])
			};

			const realTimelineManager = new TimelineManager(integrationApp, integrationPlugin as unknown as import('../main').default);

			// Append initial node via real TimelineManager
			await realTimelineManager.appendEntry({
				time: '第一年',
				description: '初始事件描述',
				chapter: '',
				rawBlock: '',
				items: [{ description: '初始事件描述', chapter: '' }]
			}, 'NovelA');

			const renderContainer = new MockElement('wn-timeline-board');
			const reloadBoardSpy = vi.fn();
			const onSaveStateChangeSpy = vi.fn();

			await TimelineBoardRenderer.render({
				app: integrationApp,
				plugin: {
					...integrationPlugin,
					timelineManager: realTimelineManager
				} as unknown as TimelineBoardPlugin,
				container: renderContainer as unknown as HTMLElement,
				files: [chapter1File],
				foreshadowingMap: new Map(),
				currentBookPath: 'NovelA',
				currentTimelineFilter: [],
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const descEl = renderContainer.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			expect(descEl).not.toBeNull();
			descEl.onclick?.({ stopPropagation: vi.fn() });
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);

			// Edit text
			descEl.textContent = '修改后的事件描述';

			// Invoke blur WITHOUT awaiting
			void descEl.onblur?.();

			// Immediately drop chapter onto same row WITHOUT awaiting blur
			const itemRow = renderContainer.querySelector('.wn-timeline-item-row') as unknown as MockElement;
			itemRow.dispatchEvent('drop', {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-chapter-path'],
					getData: (format: string) => format === 'application/wn-chapter-path' ? 'NovelA/第1章.md' : ''
				}
			});

			// Wait for the observable result rather than assuming a fixed write duration.
			await vi.waitFor(() => {
				const finalContent = vaultFiles.get('NovelA/时间线.md') ?? '';
				expect(finalContent).toContain('修改后的事件描述');
				expect(finalContent).toContain('[[第1章]]');
			});
			expect(reloadBoardSpy).toHaveBeenCalled();
		});
	});

	describe('Batch A: Vertical timeline board node quick edit modal', () => {
		beforeEach(() => {
			(mockPlugin.timelineManager.getTimelineFile as ReturnType<typeof vi.fn>).mockReturnValue(createMockFile('Timeline.md', 'FictionalBook/Timeline.md'));
		});
		const fictionalChapter1 = createMockFile('第1章.md', 'FictionalBook/第1章.md');
		const fictionalChapter2 = createMockFile('第2章.md', 'FictionalBook/第2章.md');

		it('renders keyboard-focusable pencil button at right of vertical node title with setTooltip and aria-label, stopping propagation', async () => {
			const entry: TimelineEntry = {
				time: '永和元年春',
				type: '主线',
				lores: ['灵剑宗'],
				description: '初入宗门',
				chapter: '[[第1章]]',
				rawBlock: '',
				items: [{ description: '初入宗门', chapter: '[[第1章]]' }]
			};

			const reloadBoardSpy = vi.fn();
			const onSaveStateChangeSpy = vi.fn();
			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const titleDiv = container.querySelector('.wn-timeline-node-title');
			expect(titleDiv).not.toBeNull();

			const editBtn = titleDiv?.querySelector('.wn-timeline-node-edit-btn');
			expect(editBtn).not.toBeNull();
			expect(editBtn?.getAttr('aria-label')).toBe('common.edit');
			expect(editBtn?.getAttr('data-icon')).toBe('pencil');
			expect(setTooltip).toHaveBeenCalledWith(editBtn, 'common.edit');

			// Preserves horizontal title layout: time text is sibling before editBtn
			const timeTextEl = titleDiv?.querySelector('.wn-timeline-node-time-text');
			expect(timeTextEl).not.toBeNull();
			expect(timeTextEl?.textContent).toBe('永和元年春');

			// Stop propagation on edit button click
			const clickEvt = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
			editBtn?.onclick?.(clickEvt);
			expect(clickEvt.stopPropagation).toHaveBeenCalled();

			// Keydown on edit button stops propagation
			const keyEvt = { key: 'Enter', stopPropagation: vi.fn() };
			editBtn?.dispatchEvent('keydown', keyEvt);
			expect(keyEvt.stopPropagation).toHaveBeenCalled();
		});

		it('opens thin edit modal with full deep-cloned initial TimelineEntry including all items, chapter, origin, importance, and lores', async () => {
			const entry: TimelineEntry = {
				time: '永和元年夏',
				type: '主线',
				lores: ['灵剑宗', '古阵法'],
				description: '内门大比\n暗中探查',
				chapter: '[[第1章]], [[第2章]]',
				origin: '比武擂台一角',
				important: true,
				rawBlock: '',
				items: [
					{ description: '内门大比', chapter: '[[第1章]]', origin: '比武擂台一角', important: true },
					{ description: '暗中探查', chapter: '[[第2章]]', origin: '藏经阁深处', important: false }
				]
			};

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1, fictionalChapter2],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const editBtn = container.querySelector('.wn-timeline-node-edit-btn');
			expect(editBtn).not.toBeNull();
			editBtn?.click();

			expect(lastOpenedModal).not.toBeNull();
			const modalContent = lastOpenedModal!.contentEl;
			expect(modalContent.hasClass('wn-timeline-edit-modal')).toBe(true);

			// Check form initial values
			const timeInput = modalContent.querySelector('.wn-timeline-form-input') as unknown as MockElement;
			expect(timeInput?.value).toBe('永和元年夏');

			const typeSelect = modalContent.querySelector('.wn-timeline-node-type-select') as unknown as MockElement;
			expect(typeSelect?.value).toBe('主线');

			const eventBlocks = modalContent.querySelectorAll('.webnovel-modal-event-block');
			expect(eventBlocks).toHaveLength(2);

			const desc1 = eventBlocks[0].querySelectorAll('.wn-timeline-form-textarea')[0] as unknown as MockElement;
			const quote1 = eventBlocks[0].querySelectorAll('.wn-timeline-form-textarea')[1] as unknown as MockElement;
			expect(desc1?.value).toBe('内门大比');
			expect(quote1?.value).toBe('比武擂台一角');

			const desc2 = eventBlocks[1].querySelectorAll('.wn-timeline-form-textarea')[0] as unknown as MockElement;
			const quote2 = eventBlocks[1].querySelectorAll('.wn-timeline-form-textarea')[1] as unknown as MockElement;
			expect(desc2?.value).toBe('暗中探查');
			expect(quote2?.value).toBe('藏经阁深处');

			// Deep clone verification: modifying form inputs does not mutate original entry object
			timeInput.value = '永和元年秋';
			expect(entry.time).toBe('永和元年夏');
			desc1.value = '篡改事件';
			expect(entry.items![0].description).toBe('内门大比');
		});

		it('awaits pending inline saves before taking snapshot for edit modal', async () => {
			const entry: TimelineEntry = {
				time: '永和二年春',
				type: '支线',
				description: '旧事件描述',
				chapter: '',
				rawBlock: '',
				items: [{ description: '旧事件描述', chapter: '' }]
			};

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			expect(descEl).not.toBeNull();
			descEl.click();
			expect(descEl.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);
			descEl.textContent = '新行内编辑事件描述';

			let resolveUpdate!: (content: string) => void;
			const updatePromise = new Promise<string>(resolve => { resolveUpdate = resolve; });
			(mockPlugin.timelineManager.updateEntry as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(updatePromise);

			// Trigger blur which initiates pending inline save
			void descEl.onblur?.();

			// Click node edit button synchronously while inline save is in-flight
			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			expect(editBtn).not.toBeNull();
			editBtn.click();

			// Flush microtasks; modal should NOT have opened yet because pending save is still in flight
			await new Promise(resolve => setTimeout(resolve, 0));
			expect(lastOpenedModal).toBeNull();

			// Resolve inline save
			resolveUpdate('Updated content');
			await vi.waitFor(() => {
				expect(lastOpenedModal).not.toBeNull();
			});

			// Modal receives updated description from inline save
			const descInput = lastOpenedModal!.contentEl.querySelector('.wn-timeline-form-textarea') as unknown as MockElement;
			expect(descInput?.value).toBe('新行内编辑事件描述');
		});

		it('cancel closes modal without modifying timeline or calling updateEntry', async () => {
			const entry: TimelineEntry = {
				time: '永和三年',
				description: '未修改事件',
				chapter: '',
				rawBlock: ''
			};

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			expect(editBtn).not.toBeNull();
			editBtn.click();
			expect(lastOpenedModal).not.toBeNull();

			const cancelBtn = lastOpenedModal!.contentEl.querySelector('.wn-timeline-action-btn') as unknown as MockElement;
			expect(cancelBtn).not.toBeNull();

			const closeSpy = vi.spyOn(lastOpenedModal!, 'close');
			cancelBtn.click();

			expect(closeSpy).toHaveBeenCalled();
			expect(mockPlugin.timelineManager.updateEntry).not.toHaveBeenCalled();
		});

		it('awaits save success before closing, serializes save, guards double-save/cancel, and reloads board', async () => {
			const entry: TimelineEntry = {
				time: '永和四年',
				type: '主线',
				description: '原始事件',
				chapter: '',
				rawBlock: ''
			};

			const reloadBoardSpy = vi.fn();
			const onSaveStateChangeSpy = vi.fn();
			let resolveSave!: (content: string) => void;
			const savePromise = new Promise<string>(resolve => { resolveSave = resolve; });
			(mockPlugin.timelineManager.updateEntry as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(savePromise);

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			expect(editBtn).not.toBeNull();
			editBtn.click();
			expect(lastOpenedModal).not.toBeNull();

			const modal = lastOpenedModal!;
			const saveBtn = modal.contentEl.querySelector('.mod-cta') as unknown as MockElement;
			const cancelBtn = modal.contentEl.querySelector('.wn-timeline-action-btn') as unknown as MockElement;
			const onCloseSpy = vi.spyOn(modal as unknown as { onClose: () => void }, 'onClose');

			// Click save
			saveBtn.click();

			// While save is in-flight:
			expect(onSaveStateChangeSpy).toHaveBeenCalledWith(true);
			// Save button disabled / double save prevented
			saveBtn.click();
			expect(mockPlugin.timelineManager.updateEntry).toHaveBeenCalledTimes(1);

			// Cancel and close guarded while saving
			cancelBtn.click();
			modal.close();
			expect(onCloseSpy).not.toHaveBeenCalled();

			// Resolve save
			resolveSave('saved content');
			await vi.waitFor(() => {
				expect(onCloseSpy).toHaveBeenCalled();
			});

			expect(onSaveStateChangeSpy).toHaveBeenCalledWith(false);
			expect(reloadBoardSpy).toHaveBeenCalled();
		});

		it('failed save displays failure notice, preserves form draft, and keeps modal open', async () => {
			const entry: TimelineEntry = {
				time: '永和五年',
				description: '准备更新的事件',
				chapter: '',
				rawBlock: ''
			};

			(mockPlugin.timelineManager.updateEntry as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Simulated disk error'));

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			expect(editBtn).not.toBeNull();
			editBtn.click();
			expect(lastOpenedModal).not.toBeNull();

			const modal = lastOpenedModal!;
			const timeInput = modal.contentEl.querySelector('.wn-timeline-form-input') as unknown as MockElement;
			timeInput.value = '永和五年末';

			const saveBtn = modal.contentEl.querySelector('.mod-cta') as unknown as MockElement;
			const closeSpy = vi.spyOn(modal, 'close');

			saveBtn.click();

			await vi.waitFor(() => {
				expect(Notice).toHaveBeenCalled();
			});

			// Modal remains open
			expect(closeSpy).not.toHaveBeenCalled();

			// Form draft preserved
			expect(timeInput.value).toBe('永和五年末');
		});

		it('pins bookFolder and passes expectedEntry snapshot to guard against stale index', async () => {
			const entry0: TimelineEntry = { time: '节点A', description: '事件A', chapter: '', rawBlock: '' };
			const entry1: TimelineEntry = {
				time: '节点B',
				type: '主线',
				lores: ['绝密设定'],
				description: '事件B描述',
				chapter: '[[第1章]]',
				origin: '原文章节线索',
				important: true,
				rawBlock: '',
				items: [{ description: '事件B描述', chapter: '[[第1章]]', origin: '原文章节线索', important: true }]
			};

			(mockPlugin.timelineManager.updateEntry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('updated');

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry0, entry1],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const editBtns = container.querySelectorAll('.wn-timeline-node-edit-btn');
			expect(editBtns).toHaveLength(2);

			// Edit Node B (index 1)
			editBtns[1].click();
			expect(lastOpenedModal).not.toBeNull();

			const modal = lastOpenedModal!;
			const saveBtn = modal.contentEl.querySelector('.mod-cta') as unknown as MockElement;
			saveBtn.click();

			await vi.waitFor(() => {
				expect(mockPlugin.timelineManager.updateEntry).toHaveBeenCalled();
			});

			// Pinned bookFolder and expectedEntry snapshot matching entry1
			expect(mockPlugin.timelineManager.updateEntry).toHaveBeenCalledWith(
				1,
				expect.objectContaining({ time: '节点B' }),
				'FictionalBook',
				expect.objectContaining({
					time: '节点B',
					type: '主线',
					lores: ['绝密设定'],
					items: expect.arrayContaining([
						expect.objectContaining({ description: '事件B描述', important: true, origin: '原文章节线索' })
					])
				}),
				expect.objectContaining({ path: 'FictionalBook/Timeline.md' })
			);
		});

		it('guards against duplicate modal launches when edit is clicked multiple times while awaiting pending inline saves', async () => {
			const entry: TimelineEntry = {
				time: '永和六年',
				type: '主线',
				description: '原始描述',
				chapter: '',
				rawBlock: '',
				items: [{ description: '原始描述', chapter: '' }]
			};

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
			descEl.click();
			descEl.textContent = '行内修改中';

			let resolveUpdate!: (content: string) => void;
			const updatePromise = new Promise<string>(resolve => { resolveUpdate = resolve; });
			(mockPlugin.timelineManager.updateEntry as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(updatePromise);

			void descEl.onblur?.();

			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			expect(editBtn).not.toBeNull();

			const openSpy = vi.spyOn(TimelineEditModal.prototype, 'open');

			// Multiple rapid clicks while inline save is pending
			editBtn.click();
			editBtn.click();
			editBtn.click();

			await new Promise(resolve => setTimeout(resolve, 0));
			expect(openSpy).not.toHaveBeenCalled();

			resolveUpdate('Updated content');

			await vi.waitFor(() => {
				expect(openSpy).toHaveBeenCalledTimes(1);
			});

			openSpy.mockRestore();
		});

		it('rejects save, preserves draft, and keeps modal open when updateEntry returns empty string due to missing timeline file', async () => {
			const entry: TimelineEntry = {
				time: '永和七年',
				type: '主线',
				description: '原始事件',
				chapter: '',
				rawBlock: '',
				items: [{ description: '原始事件', chapter: '' }]
			};

			// getTimelineFile returns null simulating missing timeline file
			(mockPlugin.timelineManager.getTimelineFile as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
			(mockPlugin.timelineManager.updateEntry as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

			lastOpenedModal = null;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [fictionalChapter1],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			});

			const editBtn = container.querySelector('.wn-timeline-node-edit-btn') as unknown as MockElement;
			expect(editBtn).not.toBeNull();
			editBtn.click();
			expect(lastOpenedModal).not.toBeNull();

			const modal = lastOpenedModal!;
			const timeInput = modal.contentEl.querySelector('.wn-timeline-form-input') as unknown as MockElement;
			timeInput.value = '永和七年夏';

			const saveBtn = modal.contentEl.querySelector('.mod-cta') as unknown as MockElement;
			const closeSpy = vi.spyOn(modal, 'close');

			saveBtn.click();

			await vi.waitFor(() => {
				expect(Notice).toHaveBeenCalled();
			});

			// Modal remains open and does not close on false success
			expect(closeSpy).not.toHaveBeenCalled();

			// User draft is preserved
			expect(timeInput.value).toBe('永和七年夏');
		});
	});

	describe('Pending events workflow, split sidebar, inline node creation, and time-pending nodes', () => {
		it('removes per-node add-sub-event buttons and renders split pending/unscheduled panes with empty-chapter state', async () => {
			const entry: TimelineEntry = {
				time: '第一年',
				type: '主线',
				description: '主线事件',
				chapter: '',
				rawBlock: '',
				items: [{ description: '主线事件', chapter: '' }]
			};

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: mockPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				loadedPendingEvents: [{ id: 'pe_1', description: '待排事件一', chapter: '' }],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			expect(container.querySelector('.wn-timeline-add-sub-event-btn')).toBeNull();
			expect(container.querySelector('.wn-timeline-pending-pane')).not.toBeNull();
			expect(container.querySelector('.wn-timeline-unscheduled-pane')).not.toBeNull();
			expect(container.querySelector('.wn-timeline-waterfall-sidebar')?.hasClass('is-unscheduled-empty')).toBe(true);
			expect(container.querySelectorAll('.wn-timeline-pending-card')).toHaveLength(1);
		});

		it('adds pending events with Enter or the Add button and keeps the draft on failure', async () => {
			let shouldFail = true;
			const addPendingEventSpy = vi.fn().mockImplementation(async () => {
				if (shouldFail) throw new Error('disk error');
				return { content: '', event: { id: 'pe_new', description: '灵感事件', chapter: '' } };
			});
			const reloadBoardSpy = vi.fn();

			const pluginWithPending = {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					addPendingEvent: addPendingEventSpy
				}
			} as unknown as TimelineBoardPlugin;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: pluginWithPending,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [],
				loadedPendingEvents: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			const quickInput = container.querySelector('.wn-timeline-pending-quick-input') as unknown as MockElement;
			const quickAddButton = container.querySelector('.wn-timeline-pending-quick-button')!;
			expect(quickInput).not.toBeNull();
			expect(quickAddButton.textContent).toBe('common.add');
			quickInput.value = '灵感事件';

			// IME Enter must not submit
			quickInput.dispatchEvent('compositionstart');
			quickInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true, preventDefault: vi.fn() });
			expect(addPendingEventSpy).not.toHaveBeenCalled();
			quickInput.dispatchEvent('compositionend');

			// Failure preserves input and does not reload
			quickInput.dispatchEvent('keydown', { key: 'Enter', isComposing: false, preventDefault: vi.fn() });
			await vi.waitFor(() => expect(addPendingEventSpy).toHaveBeenCalledTimes(1));
			expect(quickInput.value).toBe('灵感事件');
			expect(reloadBoardSpy).not.toHaveBeenCalled();

			// Retry succeeds
			shouldFail = false;
			quickAddButton.click();
			await vi.waitFor(() => expect(reloadBoardSpy).toHaveBeenCalledTimes(1));
			expect(quickInput.value).toBe('');
			expect(addPendingEventSpy).toHaveBeenLastCalledWith({ description: '灵感事件' }, 'FictionalBook');

			quickInput.dispatchEvent('keydown', { key: 'Enter', isComposing: false, preventDefault: vi.fn() });
			expect(addPendingEventSpy).toHaveBeenCalledTimes(2);
			quickAddButton.click();
			await vi.waitFor(() => expect(reloadBoardSpy).toHaveBeenCalledTimes(2));
			expect(addPendingEventSpy).toHaveBeenLastCalledWith({ description: '' }, 'FictionalBook');
		});

		it('expands inline new-node form on inter-node pending drop with filtered anchors and time-pending checkbox, and supports Esc cancel', async () => {
			const createNodeSpy = vi.fn().mockResolvedValue('updated');
			const reloadBoardSpy = vi.fn();
			const entries: TimelineEntry[] = [
				{ time: '第1天', type: '主线', description: '甲', chapter: '', rawBlock: '', items: [{ description: '甲', chapter: '' }] },
				{ time: '第2天', type: '支线', description: '隐', chapter: '', rawBlock: '', items: [{ description: '隐', chapter: '' }] },
				{ time: '第3天', type: '主线', description: '乙', chapter: '', rawBlock: '', items: [{ description: '乙', chapter: '' }] }
			];
			const pendingCard = { id: 'pe_drop', description: '跨筛选拖放事件', chapter: '' };

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						createNodeFromPendingEvent: createNodeSpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: entries,
				loadedPendingEvents: [pendingCard],
				currentTimelineFilter: ['主线'],
				onSaveStateChange: vi.fn(),
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			const gap = container.querySelector('.wn-timeline-gap') as unknown as MockElement;
			expect(gap).not.toBeNull();

			gap.dispatchEvent('drop', {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-pending-id'],
					getData: (type: string) => type === 'application/wn-timeline-pending-id' ? 'pe_drop' : ''
				}
			});

			const inlineForm = container.querySelector('.wn-timeline-inline-node-form') as unknown as MockElement;
			expect(inlineForm).not.toBeNull();
			const timeInput = inlineForm.querySelector('.wn-timeline-inline-time-input') as unknown as MockElement;
			const pendingCheckbox = inlineForm.querySelector('.wn-timeline-time-pending-checkbox') as unknown as MockElement & { checked?: boolean };
			expect(timeInput.focus).toHaveBeenCalled();
			expect(pendingCheckbox.checked).toBe(false);

			// Cancel via Escape keeps pending card untouched and does not write
			inlineForm.dispatchEvent('keydown', { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
			expect(container.querySelector('.wn-timeline-inline-node-form')).toBeNull();
			expect(createNodeSpy).not.toHaveBeenCalled();

			// Drop again and submit with timePending checked -> passes actual anchors (0 and 2, NOT filtered indices 0 and 1!)
			gap.dispatchEvent('drop', {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-pending-id'],
					getData: (type: string) => type === 'application/wn-timeline-pending-id' ? 'pe_drop' : ''
				}
			});
			const form2 = container.querySelector('.wn-timeline-inline-node-form') as unknown as MockElement;
			const checkbox2 = form2.querySelector('.wn-timeline-time-pending-checkbox') as unknown as MockElement & { checked?: boolean };
			checkbox2.checked = true;
			checkbox2.dispatchEvent('change');
			const confirmBtn = form2.querySelector('.wn-timeline-inline-confirm-btn') as unknown as MockElement;
			confirmBtn.click();

			await vi.waitFor(() => expect(createNodeSpy).toHaveBeenCalledTimes(1));
			expect(createNodeSpy).toHaveBeenCalledWith(
				'pe_drop',
				expect.objectContaining({ time: '', timePending: true }),
				expect.objectContaining({ afterEntryIndex: 0, beforeEntryIndex: 2 }),
				'FictionalBook',
				expect.objectContaining({ id: 'pe_drop' })
			);
			expect(reloadBoardSpy).toHaveBeenCalledTimes(1);
		});

		it('returns a scheduled event by dragging into an empty pending area', async () => {
			const moveToPendingSpy = vi.fn().mockResolvedValue('updated');
			const reloadBoardSpy = vi.fn();
			const entry: TimelineEntry = {
				time: '',
				timePending: true,
				nodeId: 'nd_a',
				type: '主线',
				description: '已排事件',
				chapter: 'Chapter 1',
				rawBlock: '',
				items: [{ description: '已排事件', chapter: 'Chapter 1' }]
			} as TimelineEntry;

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						moveEventToPending: moveToPendingSpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: [entry],
				loadedPendingEvents: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			expect(container.querySelector('.wn-timeline-node-time-text')?.textContent).toBe('timeline.time-pending');
			expect(container.querySelector('.wn-timeline-item-return-btn')).toBeNull();
			expect(container.querySelector('.wn-timeline-waterfall-sidebar')?.hasClass('is-pending-empty')).toBe(true);
			expect(container.querySelector('.wn-timeline-pending-quick-input')).not.toBeNull();
			expect(container.querySelector('.wn-timeline-pending-list')).toBeNull();
			container.querySelector('.wn-timeline-waterfall-sidebar')!.dispatchEvent('drop', {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-entry-index', 'application/wn-timeline-event-index'],
					getData: () => '0'
				}
			});

			await vi.waitFor(() => expect(moveToPendingSpy).toHaveBeenCalledTimes(1));
			expect(moveToPendingSpy).toHaveBeenCalledWith(0, 0, 'FictionalBook', expect.objectContaining({ description: '已排事件', chapter: 'Chapter 1' }), expect.objectContaining({ nodeId: 'nd_a' }));
			expect(reloadBoardSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('Timeline node handle reorder', () => {
		it('renders a draggable handle, folds synchronously on dragstart, isolates node MIME from item dropzones, and restores on dragend/Escape/mouse-hold release', async () => {
			const moveEntrySpy = vi.fn().mockResolvedValue('updated');
			const moveEventItemSpy = vi.fn();
			const entries: TimelineEntry[] = [
				{ time: '第1天', type: '主线', description: '事件甲', chapter: '', rawBlock: '', items: [{ description: '事件甲', chapter: '' }] },
				{ time: '第2天', type: '主线', description: '事件乙', chapter: '', rawBlock: '', items: [{ description: '事件乙', chapter: '' }] }
			];

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						moveEntry: moveEntrySpy,
						moveEventItem: moveEventItemSpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: entries,
				loadedPendingEvents: [],
				onSaveStateChange: vi.fn(),
				reloadBoard: vi.fn(),
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			const layout = container.querySelector('.wn-timeline-waterfall-layout')!;
			const nodes = container.querySelectorAll('.wn-timeline-node');
			const handles = container.querySelectorAll('.wn-timeline-node-handle');
			expect(handles.length).toBe(2);
			expect(handles[0].getAttribute('draggable')).toBe('true');
			expect(handles[0].getAttribute('aria-label')).toBe('timeline.drag-to-reorder-node');
			const waterfall = container.querySelector('.wn-timeline-waterfall-main')!;
			waterfall.clientHeight = 500;
			waterfall.scrollTop = 180;
			vi.spyOn(handles[0], 'getBoundingClientRect').mockImplementation(() => {
				const buffer = parseFloat(waterfall.style['--wn-timeline-node-sort-buffer']) || 0;
				const contentTop = layout.hasClass('is-node-sorting') ? 90 + buffer : 460;
				const top = contentTop - waterfall.scrollTop;
				return { ...handles[0].mockRect, top, bottom: top + handles[0].mockRect.height };
			});
			const handleTop = handles[0].getBoundingClientRect().top;

			// 1. dragstart folds synchronously
			const dragData: Record<string, string> = {};
			handles[0].dispatchEvent('dragstart', {
				stopPropagation: vi.fn(),
				dataTransfer: {
					effectAllowed: '',
					types: [],
					setData: (fmt: string, val: string) => { dragData[fmt] = val; }
				}
			});
			expect(dragData['application/wn-timeline-node-index']).toBe('0');
			expect(layout.hasClass('is-node-sorting')).toBe(true);
			expect(nodes[0].hasClass('is-node-dragging')).toBe(true);
			expect(handles[0].getBoundingClientRect().top).toBe(handleTop);

			// Existing itemRow dropzone must ignore node MIME
			const itemRows = container.querySelectorAll('.wn-timeline-item-row');
			const itemPreventDefault = vi.fn();
			itemRows[1].dispatchEvent('dragover', {
				preventDefault: itemPreventDefault,
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-node-index'],
					getData: (fmt: string) => fmt === 'application/wn-timeline-node-index' ? '0' : ''
				}
			});
			expect(itemPreventDefault).not.toHaveBeenCalled();
			expect(moveEventItemSpy).not.toHaveBeenCalled();

			// 2. dragend restores expanded contents
			handles[0].dispatchEvent('dragend');
			expect(layout.hasClass('is-node-sorting')).toBe(false);
			expect(nodes[0].hasClass('is-node-dragging')).toBe(false);
			expect(waterfall.scrollTop).toBe(180);
			expect(waterfall.style['--wn-timeline-node-sort-buffer']).toBe('');

			// 3. Escape during drag restores expanded contents
			handles[0].dispatchEvent('dragstart', {
				stopPropagation: vi.fn(),
				dataTransfer: { effectAllowed: '', setData: vi.fn() }
			});
			expect(layout.hasClass('is-node-sorting')).toBe(true);
			container.ownerDocument.dispatchEvent('keydown', { key: 'Escape' });
			expect(layout.hasClass('is-node-sorting')).toBe(false);
			nodes[1].dispatchEvent('drop', {
				clientY: 90,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-node-index'],
					getData: () => '0'
				}
			});
			expect(moveEntrySpy).not.toHaveBeenCalled();

			// 4. Unmoved mouse hold (~220ms) folds, then mouseup restores without moving
			vi.useFakeTimers();
			try {
				handles[0].dispatchEvent('mousedown', {
					button: 0,
					clientX: 10,
					clientY: 10,
					stopPropagation: vi.fn()
				});
				expect(layout.hasClass('is-node-sorting')).toBe(false);
				vi.advanceTimersByTime(220);
				expect(layout.hasClass('is-node-sorting')).toBe(true);
				expect(handles[0].getBoundingClientRect().top).toBe(handleTop);
				container.ownerDocument.dispatchEvent('mouseup', {});
				expect(layout.hasClass('is-node-sorting')).toBe(false);
			} finally {
				vi.useRealTimers();
			}
			expect(moveEntrySpy).not.toHaveBeenCalled();
		});

		it('drops filtered and reversed nodes at the correct storage index, restores immediately on drop, and skips reload on failure', async () => {
			let shouldFail = false;
			const moveEntrySpy = vi.fn().mockImplementation(async () => {
				if (shouldFail) throw new Error('conflict');
				return 'updated';
			});
			const reloadBoardSpy = vi.fn();
			const onSaveStateChangeSpy = vi.fn();
			const entries: TimelineEntry[] = [
				{ time: '第1天', type: '主线', description: '甲', chapter: '', rawBlock: '', items: [{ description: '甲', chapter: '' }] },
				{ time: '第2天', type: '支线', description: '隐', chapter: '', rawBlock: '', items: [{ description: '隐', chapter: '' }] },
				{ time: '第3天', type: '主线', description: '乙', chapter: '', rawBlock: '', items: [{ description: '乙', chapter: '' }] }
			];

			// Ascending + filtered: displayEntries = [entries[0], entries[2]]
			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						moveEntry: moveEntrySpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: entries,
				loadedPendingEvents: [],
				currentTimelineFilter: ['主线'],
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			const layout = container.querySelector('.wn-timeline-waterfall-layout')!;
			const nodes = container.querySelectorAll('.wn-timeline-node');
			const handles = container.querySelectorAll('.wn-timeline-node-handle');
			expect(nodes.length).toBe(2);
			nodes[1].mockRect = { top: 100, bottom: 200, height: 100, left: 0, right: 100, width: 100 };

			handles[0].dispatchEvent('dragstart', {
				stopPropagation: vi.fn(),
				dataTransfer: { effectAllowed: '', setData: vi.fn() }
			});
			nodes[1].dispatchEvent('drop', {
				clientY: 120,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-node-index'],
					getData: () => '0'
				}
			});
			expect(moveEntrySpy).not.toHaveBeenCalled();

			handles[0].dispatchEvent('dragstart', {
				stopPropagation: vi.fn(),
				dataTransfer: { effectAllowed: '', setData: vi.fn() }
			});
			expect(layout.hasClass('is-node-sorting')).toBe(true);

			// Drop onto lower half of displayed node[1] (entries[2]) -> insertAt = 3, fromIndex = 0 -> finalIndex = 2
			nodes[1].dispatchEvent('dragover', {
				clientY: 180,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: { types: ['application/wn-timeline-node-index'], dropEffect: '' }
			});
			expect(nodes[1].hasClass('drag-over-node-bottom')).toBe(true);

			nodes[1].dispatchEvent('drop', {
				clientY: 180,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-node-index'],
					getData: (fmt: string) => fmt === 'application/wn-timeline-node-index' ? '0' : ''
				}
			});
			// Transient UI ends immediately after gesture
			expect(layout.hasClass('is-node-sorting')).toBe(false);
			expect(nodes[1].hasClass('drag-over-node-bottom')).toBe(false);

			await vi.waitFor(() => expect(moveEntrySpy).toHaveBeenCalledTimes(1));
			expect(moveEntrySpy).toHaveBeenCalledWith(
				0,
				2,
				'FictionalBook',
				expect.objectContaining({ time: '第1天' }),
				expect.objectContaining({ time: '第3天' })
			);
			expect(reloadBoardSpy).toHaveBeenCalledTimes(1);

			// Descending + filtered + failure: displayEntries = [entries[2], entries[0]]
			container.empty();
			shouldFail = true;
			moveEntrySpy.mockClear();
			reloadBoardSpy.mockClear();
			onSaveStateChangeSpy.mockClear();

			await TimelineBoardRenderer.render({
				app: mockApp,
				plugin: {
					...mockPlugin,
					timelineManager: {
						...mockPlugin.timelineManager,
						moveEntry: moveEntrySpy
					}
				} as unknown as TimelineBoardPlugin,
				container: container as unknown as HTMLElement,
				files: [],
				foreshadowingMap: new Map(),
				currentBookPath: 'FictionalBook',
				loadedEntries: entries,
				loadedPendingEvents: [],
				currentTimelineFilter: ['主线'],
				isDescending: true,
				onSaveStateChange: onSaveStateChangeSpy,
				reloadBoard: reloadBoardSpy,
				getChapterEvents: vi.fn().mockReturnValue([])
			} as TimelineBoardOptions);

			const revLayout = container.querySelector('.wn-timeline-waterfall-layout')!;
			const revNodes = container.querySelectorAll('.wn-timeline-node');
			const revHandles = container.querySelectorAll('.wn-timeline-node-handle');
			revNodes[1].mockRect = { top: 100, bottom: 200, height: 100, left: 0, right: 100, width: 100 };

			revHandles[0].dispatchEvent('dragstart', {
				stopPropagation: vi.fn(),
				dataTransfer: { effectAllowed: '', setData: vi.fn() }
			});
			expect(revLayout.hasClass('is-node-sorting')).toBe(true);

			// Drag entries[2] (displayed at 0) onto lower half of entries[0] (displayed at 1)
			// In descending mode, lower half = before entries[0] in storage (insertAt = 0 < fromIndex 2 -> finalIndex = 0)
			revNodes[1].dispatchEvent('drop', {
				clientY: 180,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				dataTransfer: {
					types: ['application/wn-timeline-node-index'],
					getData: (fmt: string) => fmt === 'application/wn-timeline-node-index' ? '2' : ''
				}
			});
			expect(revLayout.hasClass('is-node-sorting')).toBe(false);

			await vi.waitFor(() => expect(moveEntrySpy).toHaveBeenCalledTimes(1));
			expect(moveEntrySpy).toHaveBeenCalledWith(
				2,
				0,
				'FictionalBook',
				expect.objectContaining({ time: '第3天' }),
				expect.objectContaining({ time: '第1天' })
			);
			expect(onSaveStateChangeSpy).toHaveBeenLastCalledWith(false);
			expect(reloadBoardSpy).not.toHaveBeenCalled();
		});
	});
});
