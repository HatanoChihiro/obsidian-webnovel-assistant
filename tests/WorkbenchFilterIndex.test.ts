import { describe, expect, it, vi } from 'vitest';
import {
	extractLoreSections,
	matchesWorkbenchFilter,
	normalizeWorkbenchSearchText,
	stripMarkdownFrontmatter,
	tokenizeWorkbenchFilter,
	WorkbenchFilterIndex
} from '../src/services/WorkbenchFilterIndex';

describe('WorkbenchFilterIndex helpers', () => {
	it('normalizes full-width text and splits whitespace-separated keywords', () => {
		expect(tokenizeWorkbenchFilter('  林默　Ｄungeon  失踪  ')).toEqual(['林默', 'dungeon', '失踪']);
	});

	it('requires every keyword while allowing matches across fields', () => {
		const searchableText = normalizeWorkbenchSearchText('林默\n进入地下室\n调查失踪案');
		expect(matchesWorkbenchFilter(searchableText, tokenizeWorkbenchFilter('林默 地下室 失踪'))).toBe(true);
		expect(matchesWorkbenchFilter(searchableText, tokenizeWorkbenchFilter('林默 地下室 归来'))).toBe(false);
	});

	it('removes only a complete leading frontmatter block', () => {
		const markdown = '---\nsynopsis: 地下室\nstatus: draft\n---\n正文中的线索';
		expect(stripMarkdownFrontmatter(markdown)).toBe('正文中的线索');
		expect(stripMarkdownFrontmatter('---\n未闭合\n正文')).toBe('---\n未闭合\n正文');
		expect(stripMarkdownFrontmatter('# 标题\n---\n正文')).toBe('# 标题\n---\n正文');
	});

	it('indexes each lore entry independently up to the next level-one or level-two heading', () => {
		const sections = extractLoreSections([
			'# 人物',
			'## **林默**',
			'别名：阿默',
			'### 经历',
			'调查地下室。',
			'## 苏晴',
			'记者。',
			'# 地点',
			'## 旧宅',
			'发生过失踪案。'
		].join('\n'));

		expect(sections.get('林默')).toContain('调查地下室');
		expect(sections.get('林默')).not.toContain('记者');
		expect(sections.get('苏晴')).toBe('记者。');
		expect(sections.get('旧宅')).toContain('失踪案');
	});

	it('filters chapters with AND matches distributed across title, synopsis, and body', async () => {
		const contents = new Map([
			['小说/01 林默.md', '---\nstatus: draft\n---\n他进入地下室调查。'],
			['小说/02 苏晴.md', '她在报社整理资料。']
		]);
		const cachedRead = vi.fn(async (file: { path: string }) => contents.get(file.path) ?? '');
		const index = new WorkbenchFilterIndex({ vault: { cachedRead } } as never);
		const files = [
			{ path: '小说/01 林默.md', basename: '01 林默', stat: { mtime: 1 } },
			{ path: '小说/02 苏晴.md', basename: '02 苏晴', stat: { mtime: 1 } }
		] as never;

		const results = await index.filterChapters(
			files,
			'林默 失踪 地下室',
			(file) => file.path.includes('01') ? '追查失踪案' : '整理旧闻'
		);

		expect(results.map(file => file.basename)).toEqual(['01 林默']);
		await index.filterChapters(files, '林默 地下室', () => '');
		expect(cachedRead).toHaveBeenCalledTimes(2);
	});

	it('filters lore by canonical title, aliases, and only its own section body', async () => {
		const file = { path: '小说/设定/人物.md', basename: '人物', stat: { mtime: 1 } };
		const cachedRead = vi.fn(async () => [
			'## 林默',
			'调查地下室。',
			'## 苏晴',
			'记者，关注失踪案。'
		].join('\n'));
		const index = new WorkbenchFilterIndex({ vault: { cachedRead } } as never);
		const entries = [
			{ file, heading: '林默' },
			{ file, heading: '苏晴' }
		] as never;
		const aliases = new Map<string, string[]>([['林默', ['阿默']]]);

		expect(await index.filterLoreEntries(entries, aliases, '阿默 地下室')).toEqual(new Set(['林默']));
		expect(await index.filterLoreEntries(entries, aliases, '林默 记者')).toEqual(new Set());
		expect(cachedRead).toHaveBeenCalledTimes(1);
	});

	it('supports single-file lore without H2 headings via fallbackHeading', async () => {
		const sections = extractLoreSections([
			'---',
			'aliases: [主角, 剑圣]',
			'---',
			'# 林雷',
			'林雷是本作的男主角，手持重剑。'
		].join('\n'), '林雷');

		expect(sections.get('林雷')).toContain('手持重剑');

		const file = { path: '小说/设定/角色/林雷.md', basename: '林雷', stat: { mtime: 1 } };
		const cachedRead = vi.fn(async () => [
			'---',
			'aliases: [主角, 剑圣]',
			'---',
			'林雷是本作的男主角，手持重剑。'
		].join('\n'));
		const index = new WorkbenchFilterIndex({ vault: { cachedRead } } as never);
		const entries = [
			{ file, heading: '林雷' }
		] as never;
		const aliases = new Map<string, string[]>([['林雷', ['主角', '剑圣']]]);

		expect(await index.filterLoreEntries(entries, aliases, '剑圣 重剑')).toEqual(new Set(['林雷']));
	});
});
