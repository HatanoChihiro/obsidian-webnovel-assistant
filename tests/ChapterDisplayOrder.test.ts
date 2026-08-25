import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import {
	getDeterministicChapterDisplayOrder,
	getFileVolumePath,
	compareVolumePaths
} from '../src/utils/chapterDisplayOrder';

class MockFile {
	extension = 'md';
	basename: string;
	parent?: { path: string; parent?: { path: string } };

	constructor(public name: string, public path: string, parentPath?: string) {
		this.basename = name.replace(/\.md$/, '');
		if (parentPath) {
			this.parent = {
				path: parentPath,
				parent: parentPath.includes('/')
					? { path: parentPath.substring(0, parentPath.lastIndexOf('/')) }
					: undefined
			};
		}
	}
}

function createMockFile(name: string, path: string, parentPath?: string): TFile {
	return new MockFile(name, path, parentPath) as unknown as TFile;
}

describe('ChapterDisplayOrder', () => {
	describe('getFileVolumePath', () => {
		it('should extract correct volume path with and without parent object', () => {
			const fileWithParent = createMockFile('第1章.md', 'NovelA/第一卷 启程/第1章.md', 'NovelA/第一卷 启程');
			expect(getFileVolumePath(fileWithParent, 'NovelA')).toBe('第一卷 启程');

			const fileFallback = createMockFile('第1章.md', 'NovelA/第一卷 启程/第1章.md');
			expect(getFileVolumePath(fileFallback, 'NovelA')).toBe('第一卷 启程');

			const rootFile = createMockFile('第1章.md', 'NovelA/第1章.md', 'NovelA');
			expect(getFileVolumePath(rootFile, 'NovelA')).toBe('');

			const vaultRootFile = createMockFile('第1章.md', '第1章.md', '/');
			expect(getFileVolumePath(vaultRootFile, '/')).toBe('');
		});
	});

	describe('compareVolumePaths', () => {
		it('should place top-level block first and sort volumes canonically', () => {
			expect(compareVolumePaths('', '第一卷', 'NovelA')).toBe(-1);
			expect(compareVolumePaths('第一卷', '', 'NovelA')).toBe(1);
			expect(compareVolumePaths('', '', 'NovelA')).toBe(0);

			expect(compareVolumePaths('第一卷', '第二卷', 'NovelA')).toBeLessThan(0);
			expect(compareVolumePaths('第二卷', '第一卷', 'NovelA')).toBeGreaterThan(0);
			expect(compareVolumePaths('第二卷', '第十卷', 'NovelA')).toBeLessThan(0);
			expect(compareVolumePaths('第1卷', '第2卷', 'NovelA')).toBeLessThan(0);
			expect(compareVolumePaths('第2卷', '第10卷', 'NovelA')).toBeLessThan(0);
		});

		it('should respect customSortOrder when present', () => {
			const customOrder = {
				'NovelA/第二卷': 0,
				'NovelA/第一卷': 1
			};
			expect(compareVolumePaths('第二卷', '第一卷', 'NovelA', true, customOrder)).toBeLessThan(0);
			expect(compareVolumePaths('第一卷', '第二卷', 'NovelA', true, customOrder)).toBeGreaterThan(0);
		});
	});

	describe('getDeterministicChapterDisplayOrder with multi-volume folders', () => {
		it('should sort 5 volume folders with repeated chapter numbers and scrambled input correctly in asc, desc, and restored asc without mutating input', () => {
			// Setup 5 volume folders with repeating chapter numbers
			const v1c1 = createMockFile('第1章 起源.md', 'NovelA/第一卷 启程/第1章 起源.md', 'NovelA/第一卷 启程');
			const v1c2 = createMockFile('第2章 遭遇.md', 'NovelA/第一卷 启程/第2章 遭遇.md', 'NovelA/第一卷 启程');
			const v1c10 = createMockFile('第10章 突破.md', 'NovelA/第一卷 启程/第10章 突破.md', 'NovelA/第一卷 启程');

			const v2c1 = createMockFile('第1章 新大陆.md', 'NovelA/第二卷 探索/第1章 新大陆.md', 'NovelA/第二卷 探索');
			const v2c2 = createMockFile('第2章 迷宫.md', 'NovelA/第二卷 探索/第2章 迷宫.md', 'NovelA/第二卷 探索');
			const v2c50 = createMockFile('第50章 遗迹.md', 'NovelA/第二卷 探索/第50章 遗迹.md', 'NovelA/第二卷 探索');

			const v3c1 = createMockFile('第1章 硝烟.md', 'NovelA/第三卷 征战/第1章 硝烟.md', 'NovelA/第三卷 征战');
			const v3c20 = createMockFile('第20章 攻城.md', 'NovelA/第三卷 征战/第20章 攻城.md', 'NovelA/第三卷 征战');

			const v4c1 = createMockFile('第1章 决战前夕.md', 'NovelA/第四卷 决战/第1章 决战前夕.md', 'NovelA/第四卷 决战');
			const v4c100 = createMockFile('第100章 巅峰.md', 'NovelA/第四卷 决战/第100章 巅峰.md', 'NovelA/第四卷 决战');

			const v5c1 = createMockFile('第1章 归乡.md', 'NovelA/第五卷 归途/第1章 归乡.md', 'NovelA/第五卷 归途');
			const v5c5 = createMockFile('第5章 终章.md', 'NovelA/第五卷 归途/第5章 终章.md', 'NovelA/第五卷 归途');

			// Deliberately scramble the flat input array
			const scrambledInput = [
				v4c100, v1c10, v5c5, v2c50, v3c20,
				v1c1, v5c1, v2c2, v4c1, v3c1,
				v1c2, v2c1
			];
			const originalInputSnapshot = [...scrambledInput];

			// 1. Ascending Mode
			const ascResult = getDeterministicChapterDisplayOrder(scrambledInput, {
				currentBookPath: 'NovelA',
				isDescending: false,
				enableSmartChapterSort: true
			});

			// Expected canonical ascending: Vol 1 -> Vol 2 -> Vol 3 -> Vol 4 -> Vol 5
			expect(ascResult.map(f => f.path)).toEqual([
				'NovelA/第一卷 启程/第1章 起源.md',
				'NovelA/第一卷 启程/第2章 遭遇.md',
				'NovelA/第一卷 启程/第10章 突破.md',
				'NovelA/第二卷 探索/第1章 新大陆.md',
				'NovelA/第二卷 探索/第2章 迷宫.md',
				'NovelA/第二卷 探索/第50章 遗迹.md',
				'NovelA/第三卷 征战/第1章 硝烟.md',
				'NovelA/第三卷 征战/第20章 攻城.md',
				'NovelA/第四卷 决战/第1章 决战前夕.md',
				'NovelA/第四卷 决战/第100章 巅峰.md',
				'NovelA/第五卷 归途/第1章 归乡.md',
				'NovelA/第五卷 归途/第5章 终章.md'
			]);

			// 2. Descending Mode
			const descResult = getDeterministicChapterDisplayOrder(scrambledInput, {
				currentBookPath: 'NovelA',
				isDescending: true,
				enableSmartChapterSort: true
			});

			// Expected reverse canonical: Vol 5 -> Vol 4 -> Vol 3 -> Vol 2 -> Vol 1 with descending chapters
			expect(descResult.map(f => f.path)).toEqual([
				'NovelA/第五卷 归途/第5章 终章.md',
				'NovelA/第五卷 归途/第1章 归乡.md',
				'NovelA/第四卷 决战/第100章 巅峰.md',
				'NovelA/第四卷 决战/第1章 决战前夕.md',
				'NovelA/第三卷 征战/第20章 攻城.md',
				'NovelA/第三卷 征战/第1章 硝烟.md',
				'NovelA/第二卷 探索/第50章 遗迹.md',
				'NovelA/第二卷 探索/第2章 迷宫.md',
				'NovelA/第二卷 探索/第1章 新大陆.md',
				'NovelA/第一卷 启程/第10章 突破.md',
				'NovelA/第一卷 启程/第2章 遭遇.md',
				'NovelA/第一卷 启程/第1章 起源.md'
			]);

			// 3. Toggle back to Ascending (descending -> ascending restoration)
			const restoredAscResult = getDeterministicChapterDisplayOrder(scrambledInput, {
				currentBookPath: 'NovelA',
				isDescending: false,
				enableSmartChapterSort: true
			});

			expect(restoredAscResult.map(f => f.path)).toEqual(ascResult.map(f => f.path));

			// 4. Ensure original scrambled array is NEVER mutated
			expect(scrambledInput).toEqual(originalInputSnapshot);
		});

		it('should handle top-level chapters and volume folders together', () => {
			const prologue = createMockFile('序章.md', 'NovelA/序章.md', 'NovelA');
			const preface = createMockFile('前言.md', 'NovelA/前言.md', 'NovelA');
			const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md', 'NovelA/第一卷');
			const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md', 'NovelA/第一卷');
			const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md', 'NovelA/第二卷');

			const files = [v2c1, v1c2, preface, v1c1, prologue];

			// Ascending: Top-level block first (序章, 前言 sorted), then Vol 1, then Vol 2
			const asc = getDeterministicChapterDisplayOrder(files, {
				currentBookPath: 'NovelA',
				isDescending: false
			});
			expect(asc.map(f => f.path)).toEqual([
				'NovelA/前言.md',
				'NovelA/序章.md',
				'NovelA/第一卷/第1章.md',
				'NovelA/第一卷/第2章.md',
				'NovelA/第二卷/第1章.md'
			]);

			// Descending: Vol 2, then Vol 1, then Top-level block at bottom (reversed)
			const desc = getDeterministicChapterDisplayOrder(files, {
				currentBookPath: 'NovelA',
				isDescending: true
			});
			expect(desc.map(f => f.path)).toEqual([
				'NovelA/第二卷/第1章.md',
				'NovelA/第一卷/第2章.md',
				'NovelA/第一卷/第1章.md',
				'NovelA/序章.md',
				'NovelA/前言.md'
			]);
		});

		it('should handle novel with no volume folders (flat novel)', () => {
			const c1 = createMockFile('第1章.md', 'NovelA/第1章.md', 'NovelA');
			const c2 = createMockFile('第2章.md', 'NovelA/第2章.md', 'NovelA');
			const c10 = createMockFile('第10章.md', 'NovelA/第10章.md', 'NovelA');

			const files = [c10, c1, c2];

			const asc = getDeterministicChapterDisplayOrder(files, {
				currentBookPath: 'NovelA',
				isDescending: false
			});
			expect(asc.map(f => f.path)).toEqual([
				'NovelA/第1章.md',
				'NovelA/第2章.md',
				'NovelA/第10章.md'
			]);

			const desc = getDeterministicChapterDisplayOrder(files, {
				currentBookPath: 'NovelA',
				isDescending: true
			});
			expect(desc.map(f => f.path)).toEqual([
				'NovelA/第10章.md',
				'NovelA/第2章.md',
				'NovelA/第1章.md'
			]);
		});

		it('should support customSortOrder on volume folders and chapters', () => {
			const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md', 'NovelA/第一卷');
			const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md', 'NovelA/第二卷');

			const customOrder = {
				'NovelA/第二卷': 0,
				'NovelA/第一卷': 1
			};

			const asc = getDeterministicChapterDisplayOrder([v1c1, v2c1], {
				currentBookPath: 'NovelA',
				isDescending: false,
				customSortOrder: customOrder
			});
			expect(asc.map(f => f.path)).toEqual([
				'NovelA/第二卷/第1章.md',
				'NovelA/第一卷/第1章.md'
			]);

			const desc = getDeterministicChapterDisplayOrder([v1c1, v2c1], {
				currentBookPath: 'NovelA',
				isDescending: true,
				customSortOrder: customOrder
			});
			expect(desc.map(f => f.path)).toEqual([
				'NovelA/第一卷/第1章.md',
				'NovelA/第二卷/第1章.md'
			]);
		});

		it('should sort numerically with localeCompare when enableSmartChapterSort is false', () => {
			const c1 = createMockFile('10.md', 'NovelA/10.md', 'NovelA');
			const c2 = createMockFile('2.md', 'NovelA/2.md', 'NovelA');
			const c3 = createMockFile('1.md', 'NovelA/1.md', 'NovelA');

			const asc = getDeterministicChapterDisplayOrder([c1, c2, c3], {
				currentBookPath: 'NovelA',
				isDescending: false,
				enableSmartChapterSort: false
			});
			expect(asc.map(f => f.path)).toEqual([
				'NovelA/1.md',
				'NovelA/2.md',
				'NovelA/10.md'
			]);

			const desc = getDeterministicChapterDisplayOrder([c1, c2, c3], {
				currentBookPath: 'NovelA',
				isDescending: true,
				enableSmartChapterSort: false
			});
			expect(desc.map(f => f.path)).toEqual([
				'NovelA/10.md',
				'NovelA/2.md',
				'NovelA/1.md'
			]);
		});

		it('should handle empty input gracefully', () => {
			expect(getDeterministicChapterDisplayOrder([])).toEqual([]);
		});
	});
});
