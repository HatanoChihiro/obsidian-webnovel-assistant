import { describe, it, expect } from 'vitest';
import { WordCounter } from '../src/services/WordCounter';
import { cleanForWordCount } from '../src/utils/markdownCleaner';

describe('word counting large fenced code blocks', () => {
	it('handles a cold count without scanning preserved blank lines quadratically', () => {
		const text = '开头\n```json\n'
			+ '  {"value": "ignored"},\n'.repeat(62000)
			+ '```\n结尾';
		const start = performance.now();
		expect(new WordCounter().calculateAccurateWords(text, 'standard')).toBe(4);
		// Leave headroom for CI; the original implementation takes many seconds.
		expect(performance.now() - start).toBeLessThan(2000);
		expect(cleanForWordCount(text).split('\n')).toHaveLength(text.split('\n').length);
	});

	it.each(['\n', '\r\n'])('preserves %j line breaks around lists and table separators', newline => {
		const text = ['前', '', '- 后', '', '1. 尾', '', '- [x] 完', '', '| --- | :---: |', '末'].join(newline);
		const expected = ['前', '', '后', '', '尾', '', '完', '', '', '末'].join(newline);
		expect(cleanForWordCount(text)).toBe(expected);
		expect(new WordCounter().calculateAccurateWords(text, 'standard')).toBe(5);
	});

	it('still removes markers indented or followed by tabs', () => {
		const text = '前\n\n\t-\t后\n\n\t1.\t尾\n\n\t-\t[x]\t完\n\n|\t---\t|\t:---:\t|\n末';
		expect(cleanForWordCount(text)).toBe('前\n\n后\n\n尾\n\n完\n\n\n末');
	});
});
