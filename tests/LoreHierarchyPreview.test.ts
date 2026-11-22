import { describe, expect, it } from 'vitest';
import { findNewLoreHeading } from '../src/ui/LoreHierarchyPreview';

describe('detecting new lore headings in the source editor', () => {
	it('follows the cursor to a new heading at every entry level', () => {
		for (let level = 1; level <= 5; level++) {
			const after = '# 地理\n\n' + '#'.repeat(level) + ' 新词条\n\n正文。';
			expect(findNewLoreHeading('# 地理\n\n正文。', after, 2)).toBe(2);
			expect(findNewLoreHeading('# 地理\n\n正文。', after, 3)).toBe(2);
		}
	});

	it('recognizes setext headings and duplicate names inserted elsewhere', () => {
		expect(findNewLoreHeading('白岬\n', '白岬\n---\n', 1)).toBe(0);
		expect(findNewLoreHeading('# 白岬\n## 港口\n', '# 白岬\n## 港口\n\n## 港口\n', 3)).toBe(3);
	});

	it('ignores renamed entries, H6 relationships, and fenced examples', () => {
		expect(findNewLoreHeading('## 白岬', '## 旧白岬', 0)).toBeUndefined();
		expect(findNewLoreHeading('## 白岬', '## 白岬\n###### 关系', 1)).toBeUndefined();
		expect(findNewLoreHeading('## 白岬', '## 白岬\n```\n## 示例\n```', 2)).toBeUndefined();
	});
});
