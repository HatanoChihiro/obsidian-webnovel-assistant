import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoreCardRenderer } from '../src/ui/components/LoreCardRenderer';
import { MarkdownRenderer, Component } from 'obsidian';
import { injectSoftBreakIndentPlaceholders } from '../src/utils/softBreakIndent';

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
		scrollHeight: 100,
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
			el.children.push(child);
			return child;
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
					if (match(c)) results.push(c);
					collect(c);
				}
			};
			collect(el);
			return results;
		},
		setText: (text: string) => { el.textContent = text; },
		setAttribute: (k: string, v: string) => { el.attributes.set(k, v); },
		getAttribute: (k: string) => el.attributes.get(k),
		setAttr: (k: string, v: string) => { el.attributes.set(k, v); },
		addClass: (c: string) => { el.className = (el.className + ' ' + c).trim(); },
		removeClass: (c: string) => { el.className = el.className.replace(c, '').trim(); },
		hasClass: (c: string) => el.className.split(/\s+/).includes(c),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		setCssStyles: vi.fn(),
		remove: () => { el.isConnected = false; },
		empty: () => { el.children = []; }
	};
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
});
