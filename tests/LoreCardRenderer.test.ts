import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoreCardRenderer } from '../src/ui/components/LoreCardRenderer';
import { MarkdownRenderer, Component } from 'obsidian';

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
		scrollTop: 0,
		scrollHeight: 100,
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
		remove: () => {},
		empty: () => { el.children = []; }
	};
	return el;
}

describe('LoreCardRenderer', () => {
	let mockApp: any;
	let mockPlugin: any;
	let container: any;

	beforeEach(() => {
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

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, new Component());

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

		await LoreCardRenderer.buildCardDOM(container, entry, mockPlugin, new Component());

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
});
