import { describe, expect, it } from 'vitest';
import { WordCounter } from '../src/services/WordCounter';
import { applyFootnotePolicy, cleanForPlainCopy } from '../src/utils/markdownCleaner';

const SOURCE = [
	'正文[^note]',
	'',
	'[^note]: 脚注首行',
	'  脚注续行',
	'',
	'  脚注次段',
	'',
	'结尾^[行内[嵌套]脚注]',
].join('\n');

describe('footnote inclusion policy', () => {
	it('keeps indexed scanning linear for dense inline comments on one long line', () => {
		const source = '正文%%注释%%'.repeat(2000);
		let indexedReads = 0;
		const boundedSource = new Proxy(new String(source), {
			get(target, key) {
				if (typeof key === 'string' && /^\d+$/.test(key) && ++indexedReads > source.length * 12) {
					throw new Error('Comment scanning exceeded a linear character-read budget');
				}
				const value: unknown = Reflect.get(target, key, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as unknown as string;
		expect(applyFootnotePolicy(boundedSource)).toBe('正文'.repeat(2000));
	});

	it('keeps indexed scanning linear for unmatched backtick runs', () => {
		const ticks = Array.from({ length: 120 }, (_, i) => '`'.repeat(i + 1)).join(' ');
		const source = `${ticks} 正文%%注释%%`;
		let indexedReads = 0;
		const boundedSource = new Proxy(new String(source), {
			get(target, key) {
				if (typeof key === 'string' && /^\d+$/.test(key) && ++indexedReads > source.length * 12) {
					throw new Error('Backtick scanning exceeded a linear character-read budget');
				}
				const value: unknown = Reflect.get(target, key, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as unknown as string;
		expect(applyFootnotePolicy(boundedSource)).toBe(`${ticks} 正文`);
	});

	it('excludes inline and multiline Obsidian comments while preserving source line breaks', () => {
		const source = '正文%%示例注释%%结尾%%另一条%%\r\n%%\r\n块内说明\r\n\r\n%%后续';
		expect(applyFootnotePolicy(source)).toBe('正文结尾\r\n\r\n\r\n\r\n后续');
		expect(cleanForPlainCopy(source)).toBe('正文结尾\r\n\r\n\r\n\r\n后续');
		expect(applyFootnotePolicy(source, true)).toBe(source);
		expect(cleanForPlainCopy(source, { includeFootnotes: true })).toBe(source);
	});

	it('removes comments before interpreting footnotes inside them', () => {
		const source = '开头\n%%\n[^hidden]: 示例脚注 %%\n结尾';
		expect(applyFootnotePolicy(source)).toBe('开头\n\n\n结尾');
	});

	it('does not interpret comment markers inside frontmatter', () => {
		const source = '---\ntitle: "%%元数据%%"\n---\n正文%%隐藏%%结尾';
		expect(applyFootnotePolicy(source)).toBe(source.replace('%%隐藏%%', ''));
	});

	it('excludes unclosed block comments without treating an unclosed inline marker as a block', () => {
		expect(applyFootnotePolicy('正文\n%%未闭合\n隐藏内容')).toBe('正文\n\n');
		expect(applyFootnotePolicy('正文%%未闭合\n后续正文')).toBe('正文%%未闭合\n后续正文');
	});

	it('keeps escaped markers and comment examples in code literal', () => {
		const source = [
			'开始 \\%%字面内容\\%%',
			'`%%代码示例%%` 与 ``含有 ` 的 %%代码%%``',
			'```text',
			'%%未闭合的代码示例',
			'```',
			'~~~text',
			'%%另一段代码示例',
			'~~~',
			'结束%%隐藏%%',
		].join('\n');
		expect(applyFootnotePolicy(source)).toBe(source.replace('%%隐藏%%', ''));
		expect(cleanForPlainCopy('正文 `%%代码示例%%` 结尾%%隐藏%%')).toBe('正文 %%代码示例%% 结尾');
	});

	it('keeps comment handling consistent across counting methods, line counts, edits and option changes', () => {
		for (const method of ['webnovel', 'standard', 'obsidian'] as const) {
			const counter = new WordCounter();
			for (const includeFootnotes of [false, true, false]) {
				for (const source of ['正文%%说明%%\n%%\n隐藏文字\n%%结尾', '正文%%说明%%\n%%\n修改后的隐藏文字\n%%结尾']) {
					const count = counter.calculateAccurateWords(source, method, includeFootnotes);
					const lines = counter.calculateWordsPerLine(source, method, includeFootnotes);
					expect(count).toBe(includeFootnotes ? new WordCounter().calculateAccurateWords(source, method, true) : 4);
					expect(lines).toHaveLength(source.split('\n').length);
					expect(lines.reduce((sum, value) => sum + value, 0)).toBe(count);
					if (!includeFootnotes) expect(lines).toEqual([2, 0, 0, 2]);
					else expect(count).toBeGreaterThan(4);
				}
			}
		}
	});

	it('excludes references, multiline definitions, and inline footnotes by default', () => {
		const cleaned = applyFootnotePolicy(SOURCE);

		expect(cleaned).not.toContain('[^note]');
		expect(cleaned).not.toContain('脚注首行');
		expect(cleaned).not.toContain('脚注续行');
		expect(cleaned).not.toContain('脚注次段');
		expect(cleaned).not.toContain('行内');
		expect(cleaned).toContain('正文');
		expect(cleaned).toContain('结尾');
	});

	it('preserves footnote syntax and content verbatim when enabled', () => {
		expect(applyFootnotePolicy(SOURCE, true)).toBe(SOURCE);
	});

	it('preserves source line alignment when definitions are excluded', () => {
		const cleanedLines = applyFootnotePolicy(SOURCE).split('\n');
		expect(cleanedLines).toHaveLength(SOURCE.split('\n').length);
		expect(cleanedLines.slice(2, 6)).toEqual(['', '', '', '']);
	});

	it('applies the same policy to whole-document and per-line word counts', () => {
		const counter = new WordCounter();
		const withoutFootnotes = counter.calculateAccurateWords(SOURCE, 'webnovel');
		const perLineWithoutFootnotes = counter.calculateWordsPerLine(SOURCE, 'webnovel');
		const withFootnotes = counter.calculateAccurateWords(SOURCE, 'webnovel', true);
		const perLineWithFootnotes = counter.calculateWordsPerLine(SOURCE, 'webnovel', true);

		expect(withoutFootnotes).toBe(4);
		expect(perLineWithoutFootnotes).toHaveLength(SOURCE.split('\n').length);
		expect(perLineWithoutFootnotes.reduce((sum, count) => sum + count, 0)).toBe(withoutFootnotes);
		expect(perLineWithFootnotes.reduce((sum, count) => sum + count, 0)).toBe(withFootnotes);
		expect(withFootnotes).toBeGreaterThan(withoutFootnotes);
	});

	it('uses the same default-off and enabled behavior for plain-text copy', () => {
		const excluded = cleanForPlainCopy(SOURCE);
		const included = cleanForPlainCopy(SOURCE, { includeFootnotes: true });

		expect(excluded).not.toContain('[^note]');
		expect(excluded).not.toContain('脚注首行');
		expect(excluded).not.toContain('行内');
		expect(included).toContain('正文[^note]');
		expect(included).toContain('[^note]: 脚注首行');
		expect(included).toContain('^[行内[嵌套]脚注]');
	});
});
