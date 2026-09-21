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
