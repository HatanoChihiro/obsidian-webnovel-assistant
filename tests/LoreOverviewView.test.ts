import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoreOverviewView, LORE_OVERVIEW_VIEW_TYPE, type LoreOverviewViewPlugin } from '../src/ui/LoreOverviewView';
import { VIEW_TYPES } from '../src/constants';
import { LoreBoardRenderer } from '../src/ui/components/LoreBoardRenderer';

const { getCurrentBookContextMock, findBookRootMock } = vi.hoisted(() => ({
	getCurrentBookContextMock: vi.fn(),
	findBookRootMock: vi.fn()
}));

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

	class MockTFile {
		extension = 'md';
		basename: string;
		stat = { mtime: 1 };
		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	return {
		ItemView: MockItemView,
		TFile: MockTFile,
		setIcon: vi.fn()
	};
});

vi.mock('../src/utils/path', () => ({
	getCurrentBookContext: getCurrentBookContextMock,
	findBookRoot: findBookRootMock
}));

vi.mock('../src/ui/components/LoreBoardRenderer', () => ({
	LoreBoardRenderer: {
		renderCards: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

describe('LoreOverviewView', () => {
	let plugin: LoreOverviewViewPlugin;
	let mockApp: any;
	let mockLeaf: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockApp = {
			vault: {
				on: vi.fn(),
				cachedRead: vi.fn().mockResolvedValue('## 林默\n调查地下室。\n## 苏晴\n报社记者。')
			},
			metadataCache: {
				on: vi.fn()
			},
			workspace: {
				on: vi.fn(),
				getActiveFile: vi.fn().mockReturnValue(null)
			}
		};

		mockLeaf = {
			app: mockApp
		};

		const loreFile = { name: '人物.md', path: 'NovelA/设定/人物.md', basename: '人物', extension: 'md', stat: { mtime: 1 } };

		plugin = {
			app: mockApp,
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((key: string, fn: () => void) => { fn(); })
			},
			characterManager: {
				ensureInitialized: vi.fn().mockResolvedValue(undefined),
				getCharactersForBook: vi.fn().mockReturnValue(['林默', '阿默', '苏晴']),
				getCharacterFile: vi.fn((bookPath: string, name: string) => {
					if (name === '林默' || name === '阿默') {
						return { file: loreFile, heading: '林默' };
					}
					if (name === '苏晴') {
						return { file: loreFile, heading: '苏晴' };
					}
					return null;
				}),
				getLoreEntriesInFileOrder: vi.fn().mockReturnValue([
					{ file: loreFile, heading: '林默' },
					{ file: loreFile, heading: '苏晴' }
				])
			},
			homepageManager: {
				getHomepageFilePath: vi.fn().mockReturnValue(null)
			}
		} as unknown as LoreOverviewViewPlugin;
	});

	it('should return correct view type, display text, and icon', () => {
		const view = new LoreOverviewView(mockLeaf, plugin);
		expect(view.getViewType()).toBe(VIEW_TYPES.LORE_OVERVIEW);
		expect(view.getViewType()).toBe(LORE_OVERVIEW_VIEW_TYPE);
		expect(view.getDisplayText()).toBe('view.lore-overview');
		expect(view.getIcon()).toBe('book-marked');
	});

	it('should initialize container on open and call renderCards when characters exist', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);

		await view.onOpen();

		expect(view.contentEl.classList.contains('wn-lore-overview-container')).toBe(true);
		expect(view.contentEl.classList.contains('wn-corkboard-container')).toBe(true);
		expect(plugin.characterManager.ensureInitialized).toHaveBeenCalled();
		expect(plugin.characterManager.getCharactersForBook).toHaveBeenCalledWith('NovelA');
		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledWith(
			expect.anything(),
			mockApp,
			plugin,
			'NovelA',
			['林默', '阿默', '苏晴'],
			undefined,
			expect.any(Function),
			view,
			{ hideTabs: true }
		);
	});

	it('should pass matched canonical headings when filtering by alias or body text', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockClear();

		// Set query and trigger reload
		(view as unknown as { loreFilterQuery: string }).loreFilterQuery = '阿默 地下室';
		await view.reloadBoard();

		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledWith(
			expect.anything(),
			mockApp,
			plugin,
			'NovelA',
			['林默', '阿默', '苏晴'],
			new Set(['林默']),
			expect.any(Function),
			view,
			{ hideTabs: true }
		);
	});

	it('should correctly group aliases by canonical heading in getLoreAliases', () => {
		const view = new LoreOverviewView(mockLeaf, plugin);
		const aliases = (view as unknown as { getLoreAliases: (book: string) => Map<string, string[]> }).getLoreAliases('NovelA');

		expect(aliases.get('林默')).toEqual(['阿默']);
		expect(aliases.has('苏晴')).toBe(false);
	});

	it('should render empty message when no book context or no characters', async () => {
		getCurrentBookContextMock.mockReturnValue(null);
		const view = new LoreOverviewView(mockLeaf, plugin);

		await view.onOpen();

		expect(view.contentEl.querySelector('.wn-corkboard-empty')).not.toBeNull();
		expect(LoreBoardRenderer.renderCards).not.toHaveBeenCalled();
	});

	it('should update book path and reload when setBookPath is called', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockClear();
		await view.setBookPath('NovelB');

		expect(plugin.characterManager.getCharactersForBook).toHaveBeenCalledWith('NovelB');
	});

	it('should protect against stale async renders when newer queries arrive', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockClear();

		let resolveFirstQuery: (value: unknown) => void = () => {};
		const firstQueryPromise = new Promise(resolve => { resolveFirstQuery = resolve; });
		let markFirstQueryStarted: () => void = () => {};
		const firstQueryStarted = new Promise<void>(resolve => { markFirstQueryStarted = resolve; });

		const filterIndex = (view as unknown as { filterIndex: { filterLoreEntries: (...args: unknown[]) => Promise<unknown> } }).filterIndex;
		vi.spyOn(filterIndex, 'filterLoreEntries').mockImplementationOnce(() => {
			markFirstQueryStarted();
			return firstQueryPromise as Promise<Set<string>>;
		});

		const viewHarness = view as unknown as { loreFilterQuery: string; currentRenderId: number };
		viewHarness.loreFilterQuery = 'slow';
		const slowRenderPromise = view.reloadBoard();
		await firstQueryStarted;

		// Immediate second fast query
		viewHarness.loreFilterQuery = '林默';
		viewHarness.currentRenderId++;
		const fastRenderPromise = view.reloadBoard();

		await fastRenderPromise;
		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledTimes(1);

		// Now resolve slow query
		resolveFirstQuery(new Set(['林默']));
		await slowRenderPromise;

		// Should still have been called only once for the fast query
		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledTimes(1);
	});

	it('should cancel lore-overview-refresh debounce callback on close', async () => {
		const cancelSpy = vi.fn();
		const debounceSpy = vi.fn();
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: cancelSpy
		};

		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onClose();
		expect(cancelSpy).toHaveBeenCalledWith('lore-overview-refresh');
	});
});
