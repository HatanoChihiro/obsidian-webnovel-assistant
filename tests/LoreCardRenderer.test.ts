import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoreCardRenderer } from '../src/ui/components/LoreCardRenderer';
import { MarkdownRenderer, Component, TFile } from 'obsidian';
import { injectSoftBreakIndentPlaceholders } from '../src/utils/softBreakIndent';
import * as StickyNoteEditor from '../src/ui/components/StickyNoteParagraphEditor';

let animationFrameCallbacks: FrameRequestCallback[] = [];
let resizeObservers: MockResizeObserver[] = [];

class MockResizeObserver {
	private readonly callback: ResizeObserverCallback;
	disconnect = vi.fn();

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		resizeObservers.push(this);
	}

	observe = vi.fn();

	trigger(): void {
		this.callback([], this as unknown as ResizeObserver);
	}
}

const mockOwnerWindow = {
	requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
		animationFrameCallbacks.push(callback);
		return animationFrameCallbacks.length;
	}),
	cancelAnimationFrame: vi.fn(),
	getComputedStyle: vi.fn(() => ({
		paddingLeft: '0',
		paddingRight: '0',
		columnGap: '6px',
		gap: '6px'
	})),
	ResizeObserver: MockResizeObserver
};

function flushAnimationFrames(): void {
	const callbacks = animationFrameCallbacks;
	animationFrameCallbacks = [];
	for (const callback of callbacks) callback(0);
}

function createMockComponent(): Component {
	return { register: vi.fn() } as unknown as Component;
}

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 4; i++) await Promise.resolve();
}

vi.mock('../src/utils/softBreakIndent', () => ({
	injectSoftBreakIndentPlaceholders: vi.fn()
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		setIcon: vi.fn(),
		MarkdownRenderer: {
			render: vi.fn((_app, markdown, container) => {
				const div = container.createDiv({ cls: 'rendered-markdown' });
				div.textContent = markdown;
				return Promise.resolve();
			})
		}
	};
});

function createMockEl(tag = 'div', cls = ''): any {
	const el: any = {
		tagName: tag.toUpperCase(),
		className: cls,
		children: [] as any[],
		textContent: '',
		attributes: new Map<string, string>(),
		style: {},
		hidden: false,
		title: '',
		clientWidth: 0,
		mockWidth: undefined as number | undefined,
		isConnected: true,
		ownerDocument: { defaultView: mockOwnerWindow },
		scrollTop: 0,
		clientHeight: 100,
		getBoundingClientRect: () => ({ width: el.mockWidth ?? el.textContent.length * 10 + 12 }),
		createDiv: (opts?: any) => {
			const child = createMockEl('div', typeof opts === 'string' ? opts : opts?.cls || '');
			if (opts?.text) child.textContent = opts.text;
			el.children.push(child);
			return child;
		},
		createSpan: (opts?: any) => {
			const child = createMockEl('span', typeof opts === 'string' ? opts : opts?.cls || '');
			if (opts?.text) child.textContent = opts.text;
			el.children.push(child);
			return child;
		},
		createEl: (t: string, opts?: any) => {
			const child = createMockEl(t, typeof opts === 'string' ? opts : opts?.cls || '');
			if (opts?.text) child.textContent = opts.text;
			if (opts?.attr) {
				for (const [k, v] of Object.entries(opts.attr)) {
					child.attributes.set(k, String(v));
				}
			}
			el.children.push(child);
			return child;
		},
		insertBefore: (newChild: any, refChild: any) => {
			const idx = el.children.indexOf(refChild);
			if (idx >= 0) {
				el.children.splice(idx, 0, newChild);
			} else {
				el.children.push(newChild);
			}
			return newChild;
		},
		querySelector: (sel: string) => {
			const match = (node: any): boolean => {
				if (sel.startsWith('.')) {
					const targetClass = sel.slice(1);
					return node.className.split(/\s+/).includes(targetClass);
				}
				if (/^[A-Za-z0-9]+$/.test(sel)) {
					return node.tagName.toLowerCase() === sel.toLowerCase();
				}
				return false;
			};
			const find = (node: any): any => {
				for (const c of node.children) {
					if (!c.isConnected) continue;
					if (match(c)) return c;
					const res = find(c);
					if (res) return res;
				}
				return null;
			};
			return find(el);
		},
		querySelectorAll: (sel: string) => {
			const results: any[] = [];
			const match = (node: any): boolean => {
				if (sel.startsWith('.')) {
					const targetClass = sel.slice(1);
					return node.className.split(/\s+/).includes(targetClass);
				}
				if (/^[A-Za-z0-9]+$/.test(sel)) {
					return node.tagName.toLowerCase() === sel.toLowerCase();
				}
				return false;
			};
			const collect = (node: any) => {
				for (const c of node.children) {
					if (!c.isConnected) continue;
					if (match(c)) results.push(c);
					collect(c);
				}
			};
			collect(el);
			return results;
		},
		setText: (text: string) => { el.textContent = text; },
		appendText: (text: string) => { el.textContent = (el.textContent || '') + text; return el; },
		setAttribute: (k: string, v: string) => { el.attributes.set(k, v); },
		getAttribute: (k: string) => el.attributes.get(k),
		setAttr: (k: string, v: string) => { el.attributes.set(k, v); },
		addClass: (c: string) => { el.className = (el.className + ' ' + c).trim(); },
		removeClass: (c: string) => { el.className = el.className.replace(c, '').trim(); },
		hasClass: (c: string) => el.className.split(/\s+/).includes(c),
		classList: {
			add: (c: string) => { el.addClass(c); },
			remove: (c: string) => { el.removeClass(c); },
			contains: (c: string) => el.hasClass(c),
			toggle: (c: string, force?: boolean) => {
				const shouldAdd = force !== undefined ? force : !el.hasClass(c);
				if (shouldAdd) el.addClass(c);
				else el.removeClass(c);
				return shouldAdd;
			}
		},
		toggleClass: (c: string, force?: boolean) => {
			const shouldAdd = force !== undefined ? force : !el.hasClass(c);
			if (shouldAdd) el.addClass(c);
			else el.removeClass(c);
			return shouldAdd;
		},
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		setCssStyles: vi.fn((styles: Record<string, string>) => {
			if (styles) Object.assign(el.style, styles);
		}),
		focus: vi.fn(),
		setSelectionRange: vi.fn(),
		remove: () => { el.isConnected = false; },
		empty: () => { el.children = []; }
	};
	let _scrollHeight = 100;
	Object.defineProperty(el, 'scrollHeight', {
		get: () => {
			const textarea = el.querySelector?.('textarea');
			if (textarea && textarea.style?.height) {
				const h = parseFloat(textarea.style.height);
				if (!isNaN(h) && h > 0) return h + 20;
			}
			return _scrollHeight;
		},
		set: (v: number) => { _scrollHeight = v; }
	});
	return el;
}

describe('LoreCardRenderer', () => {
	let mockApp: any;
	let mockPlugin: any;
	let container: any;

	beforeEach(() => {
		animationFrameCallbacks = [];
		resizeObservers = [];
		vi.clearAllMocks();
		// 正文解析缓存是模块级状态，需在用例间清空以保证隔离
		LoreCardRenderer.clearLoreBodyCache();
		container = createMockEl('div', 'test-container');
		mockApp = {
			vault: {
				cachedRead: vi.fn(),
				read: vi.fn(),
				process: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn()
			}
		};
		mockPlugin = {
			app: mockApp,
			settings: {
				lorePopoverCollapse: false
			},
			characterManager: {
				getLoreContent: vi.fn(),
				updateLoreContent: vi.fn()
			}
		};
	});

	it('should replace only fully hidden aliases with a +n badge and restore them after resize', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as any, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n**别名**：小美、月儿、阿雪');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());
		const badgesContainer = container.querySelector('.wn-lore-card-badges');
		const aliasBadges = Array.from(badgesContainer.querySelectorAll('.wn-lore-card-badge')) as any[];
		const overflowBadge = badgesContainer.querySelector('.wn-lore-card-overflow-badge');
		aliasBadges.forEach(badge => { badge.mockWidth = 30; });
		badgesContainer.clientWidth = 70;
		resizeObservers[0].trigger();
		flushAnimationFrames();

		expect(aliasBadges.map(badge => badge.hidden)).toEqual([false, true, true]);
		expect(overflowBadge.hidden).toBe(false);
		expect(overflowBadge.textContent).toBe('+2');

		badgesContainer.clientWidth = 104;
		resizeObservers[0].trigger();
		flushAnimationFrames();
		expect(aliasBadges.map(badge => badge.hidden)).toEqual([false, false, false]);
		expect(overflowBadge.hidden).toBe(true);
	});

	it('should truncate a single overlong alias instead of replacing it with +1', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as any, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n**别名**：非常非常长的别名');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());
		const badgesContainer = container.querySelector('.wn-lore-card-badges');
		const aliasBadge = badgesContainer.querySelector('.wn-lore-card-badge');
		const overflowBadge = badgesContainer.querySelector('.wn-lore-card-overflow-badge');
		aliasBadge.mockWidth = 160;
		badgesContainer.clientWidth = 0;
		resizeObservers[0].trigger();
		flushAnimationFrames();
		expect(badgesContainer.hidden).toBe(true);

		badgesContainer.clientWidth = 32;
		resizeObservers[0].trigger();
		flushAnimationFrames();
		expect(badgesContainer.hidden).toBe(false);
		expect(aliasBadge.hidden).toBe(false);
		expect(aliasBadge.hasClass('is-truncated')).toBe(true);
		expect(overflowBadge.hidden).toBe(true);
	});

	it('should render outline lore entry correctly (with H2 headings)', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as any, heading: '女主角' };

		mockApp.vault.cachedRead.mockResolvedValue(`
# 角色列表
## 女主角
**别名**：小美、月儿
女主角是青云门弟子，精通剑术。
## 男主角
**别名**：阿明
男主角是热血少年。
`);
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [
				{ heading: '角色列表', level: 1, position: { start: { line: 1 }, end: { line: 1 } } },
				{ heading: '女主角', level: 2, position: { start: { line: 2 }, end: { line: 2 } } },
				{ heading: '男主角', level: 2, position: { start: { line: 5 }, end: { line: 5 } } }
			]
		});

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());

		const card = container.querySelector('.wn-lore-card');
		expect(card).not.toBeNull();

		const title = card?.querySelector('.wn-lore-card-title');
		expect(title?.textContent).toBe('女主角');

		const badges = card?.querySelectorAll('.wn-lore-card-badge');
		expect(badges?.length).toBe(2);
		expect(badges?.[0].textContent).toBe('小美');
		expect(badges?.[1].textContent).toBe('月儿');

		expect(MarkdownRenderer.render).toHaveBeenCalledWith(
			mockApp,
			'女主角是青云门弟子，精通剑术。',
			expect.anything(),
			'设定/人物.md',
			expect.anything()
		);
	});

	it('should render single-file lore note correctly (without H2 headings)', async () => {
		const mockFile = { basename: '女主角', path: '设定/角色/女主角.md' };
		const entry = { file: mockFile as any, heading: '女主角' };

		mockApp.vault.cachedRead.mockResolvedValue(`---
aliases: [冰儿, 圣女]
type: 主要角色
---
# 女主角
**别名**：雪灵
女主角是九天圣地的传人，性格清冷孤傲。
### 经历
自幼在雪山长大。
`);
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [
				{ heading: '女主角', level: 1, position: { start: { line: 4 }, end: { line: 4 } } },
				{ heading: '经历', level: 3, position: { start: { line: 7 }, end: { line: 7 } } }
			],
			frontmatter: {
				aliases: ['冰儿', '圣女'],
				type: '主要角色'
			}
		});

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());

		const card = container.querySelector('.wn-lore-card');
		expect(card).not.toBeNull();

		const title = card?.querySelector('.wn-lore-card-title');
		expect(title?.textContent).toBe('女主角');

		// Badges should combine Frontmatter and in-body aliases
		const badges = Array.from(card?.querySelectorAll('.wn-lore-card-badge') ?? []).map((el: any) => el.textContent);
		expect(badges).toContain('冰儿');
		expect(badges).toContain('圣女');
		expect(badges).toContain('雪灵');

		// Markdown render should receive the body without Frontmatter, without H1, and without alias declaration line
		expect(MarkdownRenderer.render).toHaveBeenCalledWith(
			mockApp,
			expect.stringContaining('女主角是九天圣地的传人，性格清冷孤傲。'),
			expect.anything(),
			'设定/角色/女主角.md',
			expect.anything()
		);
		expect(MarkdownRenderer.render).toHaveBeenCalledWith(
			mockApp,
			expect.stringContaining('### 经历\n自幼在雪山长大。'),
			expect.anything(),
			'设定/角色/女主角.md',
			expect.anything()
		);
	});

	it('should call injectSoftBreakIndentPlaceholders on the markdown container with false after rendering', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as unknown as import('obsidian').TFile, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n第一行描述\n第二行描述');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());

		const markdownContainer = container.querySelector('.wn-lore-markdown');
		expect(markdownContainer).not.toBeNull();
		expect(injectSoftBreakIndentPlaceholders).toHaveBeenCalledWith(markdownContainer, false);
	});

	it('should map reading scroll position to textarea.scrollTop based on max scroll ranges when entering edit mode', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as unknown as import('obsidian').TFile, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n原始内容');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});
		mockPlugin.characterManager.getLoreContent.mockResolvedValue('## 女主角\n原始内容 long text for testing');

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), { draggable: true });
		const editBtn = container.querySelector('.wn-lore-card-edit-btn');
		expect(editBtn).not.toBeNull();

		const card = container.querySelector('.wn-lore-card');
		const body = container.querySelector('.wn-lore-card-body');
		body.clientHeight = 100;
		body.scrollHeight = 200;
		body.scrollTop = 50; // max range = 200 - 100 = 100; scrollRatio = 50 / 100 = 0.5

		await editBtn.onclick();

		expect(body.hasClass('is-editing')).toBe(true);
		expect(card.getAttribute('draggable')).toBe('false');

		const textarea = body.querySelector('.wn-lore-card-textarea');
		expect(textarea).not.toBeNull();
		expect(textarea.value).toBe('## 女主角\n原始内容 long text for testing');
		expect(textarea.oninput).toBeUndefined();

		const setCaretSpy = vi.spyOn(StickyNoteEditor, 'setCaretPosition');
		textarea.clientHeight = 100;
		textarea.scrollHeight = 400;
		flushAnimationFrames();

		// textarea max range = 400 - 100 = 300; expected scrollTop = 0.5 * 300 = 150
		expect(textarea.scrollTop).toBe(150);
		expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true });
		const expectedCharIndex = Math.floor('## 女主角\n原始内容 long text for testing'.length * 0.5);
		expect(setCaretSpy).toHaveBeenCalledWith(textarea, expectedCharIndex);
	});

	it('should map reading display bottom to textarea bottom precisely when entering edit mode', async () => {
		const setCaretSpy = vi.spyOn(StickyNoteEditor, 'setCaretPosition');
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as unknown as import('obsidian').TFile, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n原始内容');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});
		const rawContent = '## 女主角\n原始内容 long text for testing';
		mockPlugin.characterManager.getLoreContent.mockResolvedValue(rawContent);

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), { draggable: true });
		const editBtn = container.querySelector('.wn-lore-card-edit-btn');
		expect(editBtn).not.toBeNull();

		const body = container.querySelector('.wn-lore-card-body');
		body.clientHeight = 100;
		body.scrollHeight = 200;
		body.scrollTop = 100; // max range = 200 - 100 = 100; scrollRatio = 100 / 100 = 1.0 (bottom)

		await editBtn.onclick();

		const textarea = body.querySelector('.wn-lore-card-textarea');
		expect(textarea).not.toBeNull();
		textarea.clientHeight = 100;
		textarea.scrollHeight = 400;
		flushAnimationFrames();

		// textarea max range = 400 - 100 = 300; expected scrollTop = 1.0 * 300 = 300 (bottom)
		expect(textarea.scrollTop).toBe(300);
		expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(setCaretSpy).toHaveBeenCalledWith(textarea, rawContent.length);
	});

	it('should clean up is-editing state and restore content elements when cancelling edit mode with Escape', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as unknown as import('obsidian').TFile, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n原始内容');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});
		mockPlugin.characterManager.getLoreContent.mockResolvedValue('## 女主角\n原始内容');

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), { draggable: true });
		const editBtn = container.querySelector('.wn-lore-card-edit-btn');
		const card = container.querySelector('.wn-lore-card');
		const body = container.querySelector('.wn-lore-card-body');

		await editBtn.onclick();
		expect(body.hasClass('is-editing')).toBe(true);

		const textarea = body.querySelector('.wn-lore-card-textarea');
		const escapeEvent = { key: 'Escape', preventDefault: vi.fn() };
		const keydownHandler = textarea.addEventListener.mock.calls.find((call: any[]) => call[0] === 'keydown')?.[1];
		keydownHandler(escapeEvent);

		expect(escapeEvent.preventDefault).toHaveBeenCalled();
		expect(body.hasClass('is-editing')).toBe(false);
		expect(body.querySelector('.wn-lore-card-editor')).toBeNull();
		expect(card.getAttribute('draggable')).toBe('true');
	});

	it('should clean up is-editing state before re-rendering when saving edited lore content', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as unknown as import('obsidian').TFile, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n原始内容');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});
		mockPlugin.characterManager.getLoreContent.mockResolvedValue('## 女主角\n原始内容');

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), { draggable: true });
		const editBtn = container.querySelector('.wn-lore-card-edit-btn');
		const card = container.querySelector('.wn-lore-card');
		const body = container.querySelector('.wn-lore-card-body');

		await editBtn.onclick();
		const textarea = body.querySelector('.wn-lore-card-textarea');
		expect(textarea.hasClass('wn-sticky-note-paragraph-editor')).toBe(true);
		expect(textarea.querySelectorAll('.wn-sticky-note-editor-line')).toHaveLength(2);
		textarea.value = '## 女主角\n新修改的内容';
		expect(textarea.querySelectorAll('.wn-sticky-note-editor-line')).toHaveLength(2);

		const blurHandler = textarea.addEventListener.mock.calls.find((call: any[]) => call[0] === 'blur')?.[1];
		await blurHandler();

		expect(mockPlugin.characterManager.updateLoreContent).toHaveBeenCalledWith(entry, '## 女主角\n新修改的内容');
		expect(body.hasClass('is-editing')).toBe(false);
		expect(card.getAttribute('draggable')).toBe('true');
	});

	it('should exit edit mode without saving when content is unchanged on blur', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as unknown as import('obsidian').TFile, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n原始内容');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});
		mockPlugin.characterManager.getLoreContent.mockResolvedValue('## 女主角\n原始内容');

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), { draggable: true });
		const editBtn = container.querySelector('.wn-lore-card-edit-btn');
		const card = container.querySelector('.wn-lore-card');
		const body = container.querySelector('.wn-lore-card-body');

		await editBtn.onclick();
		const textarea = body.querySelector('.wn-lore-card-textarea');

		const blurHandler = textarea.addEventListener.mock.calls.find((call: any[]) => call[0] === 'blur')?.[1];
		await blurHandler();

		expect(mockPlugin.characterManager.updateLoreContent).not.toHaveBeenCalled();
		expect(body.hasClass('is-editing')).toBe(false);
		expect(body.querySelector('.wn-lore-card-editor')).toBeNull();
		expect(card.getAttribute('draggable')).toBe('true');
	});

	it('should render is-important class and star button for important entry, and strip marker from rendered markdown', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as any, heading: '主角', important: true };
		mockApp.vault.cachedRead.mockResolvedValue('## 主角\n<!-- wn-important -->\n主角的背景描述。');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});
		mockPlugin.characterManager.toggleLoreImportance = vi.fn().mockResolvedValue(false);

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());

		const card = container.querySelector('.wn-lore-card');
		expect(card.hasClass('is-important')).toBe(true);
		expect(card.hasClass('wn-card-is-important')).toBe(true);

		const starBtn = container.querySelector('.wn-card-importance-btn');
		expect(starBtn).not.toBeNull();
		expect(starBtn.hasClass('clickable-icon')).toBe(true);
		expect(starBtn.hasClass('is-important')).toBe(true);
		expect(starBtn.getAttribute('aria-pressed')).toBe('true');
		expect(starBtn.querySelector('.wn-card-importance-icon')).not.toBeNull();

		// MarkdownRenderer.render should receive clean markdown without <!-- wn-important -->
		expect(MarkdownRenderer.render).toHaveBeenCalledWith(
			expect.anything(),
			expect.not.stringContaining('<!-- wn-important -->'),
			expect.anything(),
			mockFile.path,
			expect.anything()
		);

		// Clicking star toggles importance
		await starBtn.onclick({ stopPropagation: vi.fn(), preventDefault: vi.fn() });
		expect(mockPlugin.characterManager.toggleLoreImportance).toHaveBeenCalledWith(entry);
		expect(starBtn.getAttribute('aria-pressed')).toBe('false');
	});

	it('should not render importance star button when hideImportanceButton is true', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as any, heading: '主角', important: true };
		mockApp.vault.cachedRead.mockResolvedValue('## 主角\n主角的背景描述。');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), {
			hideImportanceButton: true
		});

		const card = container.querySelector('.wn-lore-card');
		expect(card.hasClass('is-important')).toBe(true);
		expect(container.querySelector('.wn-card-importance-btn')).toBeNull();
	});

	it('should render the expand button only when onExpand is provided and skip it in read-only mode', async () => {
		const mockFile = { basename: '人物', path: '设定/人物.md' };
		const entry = { file: mockFile as any, heading: '女主角' };
		mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n正文内容');
		mockApp.metadataCache.getFileCache.mockReturnValue({
			headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
		});

		const onExpand = vi.fn();
		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent(), { onExpand });
		const expandBtn = container.querySelector('.wn-lore-card-expand-btn');
		expect(expandBtn).not.toBeNull();
		await expandBtn.onclick({ stopPropagation: vi.fn() });
		expect(onExpand).toHaveBeenCalledTimes(1);

		const readOnlyContainer = createMockEl('div', 'readonly-container');
		await LoreCardRenderer.buildCardDOM(readOnlyContainer, entry, mockPlugin, createMockComponent(), {
			onExpand,
			readOnly: true
		});
		expect(readOnlyContainer.querySelector('.wn-lore-card-expand-btn')).toBeNull();
		expect(readOnlyContainer.querySelector('.wn-lore-card-edit-btn')).toBeNull();
		expect(readOnlyContainer.querySelector('.wn-lore-card').hasClass('is-preview')).toBe(true);
	});

	describe('resolveLoreBody 与正文缓存', () => {
		beforeEach(() => {
			LoreCardRenderer.clearLoreBodyCache();
		});

		it('should slice the H2 section and strip the alias declaration line', async () => {
			const mockFile = { basename: '人物', path: '设定/人物.md' };
			const entry = { file: mockFile as any, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValue([
				'# 角色列表',
				'## 女主角',
				'**别名**：小美、月儿',
				'女主角是青云门弟子。',
				'## 男主角',
				'男主角是热血少年。'
			].join('\n'));
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [
					{ heading: '角色列表', level: 1, position: { start: { line: 0 }, end: { line: 0 } } },
					{ heading: '女主角', level: 2, position: { start: { line: 1 }, end: { line: 1 } } },
					{ heading: '男主角', level: 2, position: { start: { line: 4 }, end: { line: 4 } } }
				]
			});

			const resolved = await LoreCardRenderer.resolveLoreBody(entry, mockApp);

			expect(resolved.aliases).toEqual(['小美', '月儿']);
			expect(resolved.chunk).toContain('女主角是青云门弟子。');
			expect(resolved.chunk).not.toContain('男主角是热血少年。');
			expect(resolved.chunk).not.toContain('别名');
		});

		it('should merge frontmatter and in-body aliases for the single-file mode', async () => {
			const mockFile = { basename: '女主角', path: '设定/角色/女主角.md' };
			const entry = { file: mockFile as any, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValue([
				'---',
				'aliases: [冰儿, 圣女]',
				'---',
				'# 女主角',
				'**别名**：雪灵',
				'女主角是九天圣地的传人。'
			].join('\n'));
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 1, position: { start: { line: 3 }, end: { line: 3 } } }],
				frontmatter: { aliases: ['冰儿', '圣女'] }
			});

			const resolved = await LoreCardRenderer.resolveLoreBody(entry, mockApp);

			expect(resolved.aliases).toEqual(['冰儿', '圣女', '雪灵']);
			expect(resolved.chunk).toBe('女主角是九天圣地的传人。');
		});

		it('should serve repeated resolutions from cache without re-reading the file', async () => {
			const mockFile = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } };
			const entry = { file: mockFile as any, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n正文内容');
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
			});

			const first = await LoreCardRenderer.resolveLoreBody(entry, mockApp);
			const second = await LoreCardRenderer.resolveLoreBody(entry, mockApp);

			expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
			expect(second).toEqual(first);
		});

		it('should invalidate the cached entry when the file modification time changes', async () => {
			const mockFile = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } };
			const entry = { file: mockFile as any, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n旧内容');
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
			});

			await LoreCardRenderer.resolveLoreBody(entry, mockApp);

			mockFile.stat.mtime = 2000;
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n新内容');
			const refreshed = await LoreCardRenderer.resolveLoreBody(entry, mockApp);

			expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(2);
			expect(refreshed.chunk).toBe('新内容');
		});

		it('should not cache stale body if file modification time changes during cachedRead', async () => {
			const mockFile = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } };
			const entry = { file: mockFile as unknown as TFile, heading: '女主角' };
			mockApp.vault.cachedRead.mockImplementation(async () => {
				// 模拟读取期间外部文件写入，mtime 变为 2000
				mockFile.stat.mtime = 2000;
				return '## 女主角\n旧正文';
			});
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
			});

			const first = await LoreCardRenderer.resolveLoreBody(entry, mockApp);
			expect(first.chunk).toBe('旧正文');

			// 读取完成后 mtime 保持 2000，内容已更新为“新正文”
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n新正文');
			const second = await LoreCardRenderer.resolveLoreBody(entry, mockApp);

			// 若存在竞态缺陷，第一次读取会把“旧正文”按新 mtime(2000) 写入缓存，导致第二次读取返回“旧正文”
			expect(second.chunk).toBe('新正文');
			expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(2);
		});

		it('should invalidate cache when card editing is saved so next read gets fresh content', async () => {
			const mockFile = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } };
			const entry = { file: mockFile as unknown as TFile, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n原始内容');
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
			});
			mockPlugin.characterManager.getLoreContent.mockResolvedValue('## 女主角\n原始内容');
			mockPlugin.characterManager.updateLoreContent.mockResolvedValue(true);

			const initial = await LoreCardRenderer.resolveLoreBody(entry, mockApp);
			expect(initial.chunk).toBe('原始内容');

			await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, createMockComponent());

			const editBtn = container.querySelector('.wn-lore-card-edit-btn');
			expect(editBtn).not.toBeNull();
			await editBtn.onclick();

			const body = container.querySelector('.wn-lore-card-body');
			const textarea = body.querySelector('.wn-lore-card-textarea');
			expect(textarea).not.toBeNull();
			textarea.value = '## 女主角\n已保存的新内容';

			// 保存编辑前，cachedRead 准备返回新内容
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n已保存的新内容');
			const blurCall = textarea.addEventListener.mock.calls.find(
				(call: unknown) => Array.isArray(call) && call[0] === 'blur'
			);
			const blurHandler = Array.isArray(blurCall) && typeof blurCall[1] === 'function' ? (blurCall[1] as () => Promise<void> | void) : undefined;
			await blurHandler?.();
			await flushMicrotasks();

			// 验证再次解析时不走过期缓存，而是返回保存后的新内容
			const refreshed = await LoreCardRenderer.resolveLoreBody(entry, mockApp);
			expect(refreshed.chunk).toBe('已保存的新内容');
		});

		it('should miss cache when file object identity differs despite matching path and mtime', async () => {
			const fileA = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } } as unknown as TFile;
			const entryA = { file: fileA, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValueOnce('## 女主角\n来自旧文件对象的内容');
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
			});

			const first = await LoreCardRenderer.resolveLoreBody(entryA, mockApp);
			expect(first.chunk).toBe('来自旧文件对象的内容');
			expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);

			// 模拟同路径同修改时间但文件对象被重建（例如删除后重建或不同 App 实例上下文）
			const fileB = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } } as unknown as TFile;
			const entryB = { file: fileB, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValueOnce('## 女主角\n来自新文件对象的内容');

			const second = await LoreCardRenderer.resolveLoreBody(entryB, mockApp);
			expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(2);
			expect(second.chunk).toBe('来自新文件对象的内容');
		});

		it('should return defensive copies so callers cannot mutate the cache', async () => {
			const mockFile = { basename: '人物', path: '设定/人物.md', stat: { mtime: 1000 } };
			const entry = { file: mockFile as any, heading: '女主角' };
			mockApp.vault.cachedRead.mockResolvedValue('## 女主角\n**别名**：小美\n正文内容');
			mockApp.metadataCache.getFileCache.mockReturnValue({
				headings: [{ heading: '女主角', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
			});

			const first = await LoreCardRenderer.resolveLoreBody(entry, mockApp);
			first.aliases.push('污染');
			first.chunk = '污染';

			const second = await LoreCardRenderer.resolveLoreBody(entry, mockApp);
			expect(second.aliases).toEqual(['小美']);
			expect(second.chunk).toContain('正文内容');
		});
	});
});
