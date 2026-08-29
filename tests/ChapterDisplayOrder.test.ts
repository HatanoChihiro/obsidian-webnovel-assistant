import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import {
	getDeterministicChapterDisplayOrder,
	getFileVolumePath,
	compareVolumePaths,
	sortNovelFoldersForSwitchMenu
} from '../src/utils/chapterDisplayOrder';
import type { NovelFolderInfo } from '../src/types/homepage';

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

		it('should ignore individual customSortOrder on smart-recognized volume folders and let smart rule win', () => {
			// Malformed or manual contrary customSortOrder on recognized volumes must be ignored
			const customOrder = {
				'NovelA/第二卷': 0,
				'NovelA/第一卷': 1
			};
			expect(compareVolumePaths('第一卷', '第二卷', 'NovelA', true, customOrder)).toBeLessThan(0);
			expect(compareVolumePaths('第二卷', '第一卷', 'NovelA', true, customOrder)).toBeGreaterThan(0);
		});

		it('should respect customSortOrder for ordinary folders and the smart block (__CHAPTER_BLOCK__)', () => {
			// Ordinary folder dragged before smart block
			const orderOrdinaryFirst = {
				'NovelA/设定集': 0,
				'NovelA/__CHAPTER_BLOCK__': 1
			};
			expect(compareVolumePaths('设定集', '第一卷', 'NovelA', true, orderOrdinaryFirst)).toBeLessThan(0);
			expect(compareVolumePaths('第一卷', '设定集', 'NovelA', true, orderOrdinaryFirst)).toBeGreaterThan(0);

			// Smart block dragged before ordinary folder
			const orderSmartBlockFirst = {
				'NovelA/__CHAPTER_BLOCK__': 0,
				'NovelA/设定集': 1
			};
			expect(compareVolumePaths('第一卷', '设定集', 'NovelA', true, orderSmartBlockFirst)).toBeLessThan(0);
			expect(compareVolumePaths('设定集', '第一卷', 'NovelA', true, orderSmartBlockFirst)).toBeGreaterThan(0);
		});

		it('should place ordinary folders before smart chapter block by default when no custom order exists', () => {
			// File Explorer default semantics: ordinary folders (-1) come before smart block (0)
			expect(compareVolumePaths('设定集', '第一卷', 'NovelA', true)).toBeLessThan(0);
			expect(compareVolumePaths('第一卷', '设定集', 'NovelA', true)).toBeGreaterThan(0);
		});

		it('should respect customSortOrder between multiple ordinary unrecognized folders', () => {
			const customOrder = {
				'NovelA/资料集': 100,
				'NovelA/设定集': 200
			};
			expect(compareVolumePaths('资料集', '设定集', 'NovelA', true, customOrder)).toBeLessThan(0);
			expect(compareVolumePaths('设定集', '资料集', 'NovelA', true, customOrder)).toBeGreaterThan(0);
		});

		it('should respect individual folder customSortOrder when enableSmartSort is false', () => {
			const customOrder = {
				'NovelA/第二卷': 0,
				'NovelA/第一卷': 1
			};
			expect(compareVolumePaths('第二卷', '第一卷', 'NovelA', false, customOrder)).toBeLessThan(0);
			expect(compareVolumePaths('第一卷', '第二卷', 'NovelA', false, customOrder)).toBeGreaterThan(0);
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

		it('should ignore malformed individual customSortOrder entries for smart-recognized volume folders', () => {
			const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md', 'NovelA/第一卷');
			const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md', 'NovelA/第一卷');
			const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md', 'NovelA/第二卷');
			const v2c2 = createMockFile('第2章.md', 'NovelA/第二卷/第2章.md', 'NovelA/第二卷');

			// Malformed/contrary individual entries: trying to put 第二卷 before 第一卷
			const malformedCustomOrder = {
				'NovelA/第二卷': 0,
				'NovelA/第一卷': 1,
				'NovelA/第一卷/第2章.md': 0,
				'NovelA/第一卷/第1章.md': 1
			};

			const asc = getDeterministicChapterDisplayOrder([v2c2, v1c2, v2c1, v1c1], {
				currentBookPath: 'NovelA',
				isDescending: false,
				customSortOrder: malformedCustomOrder
			});

			// Smart volume order wins: 第一卷 before 第二卷. Inside each volume, smart chapter order wins: 1 before 2.
			expect(asc.map(f => f.path)).toEqual([
				'NovelA/第一卷/第1章.md',
				'NovelA/第一卷/第2章.md',
				'NovelA/第二卷/第1章.md',
				'NovelA/第二卷/第2章.md'
			]);

			const desc = getDeterministicChapterDisplayOrder([v2c2, v1c2, v2c1, v1c1], {
				currentBookPath: 'NovelA',
				isDescending: true,
				customSortOrder: malformedCustomOrder
			});

			expect(desc.map(f => f.path)).toEqual([
				'NovelA/第二卷/第2章.md',
				'NovelA/第二卷/第1章.md',
				'NovelA/第一卷/第2章.md',
				'NovelA/第一卷/第1章.md'
			]);
		});

		it('should support mixed recognized and unrecognized volume folders matching File Explorer semantics', () => {
			const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md', 'NovelA/第一卷');
			const extra1 = createMockFile('番外1.md', 'NovelA/番外设定/番外1.md', 'NovelA/番外设定');
			const extra2 = createMockFile('番外2.md', 'NovelA/番外设定/番外2.md', 'NovelA/番外设定');
			const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md', 'NovelA/第二卷');

			// 1. When customSortOrder places __CHAPTER_BLOCK__ before ordinary folder
			const customOrderSmartFirst = {
				'NovelA/__CHAPTER_BLOCK__': 100,
				'NovelA/番外设定': 200
			};

			const ascSmartFirst = getDeterministicChapterDisplayOrder([extra2, v2c1, extra1, v1c1], {
				currentBookPath: 'NovelA',
				isDescending: false,
				customSortOrder: customOrderSmartFirst
			});
			expect(ascSmartFirst.map(f => f.path)).toEqual([
				'NovelA/第一卷/第1章.md',
				'NovelA/第二卷/第1章.md',
				'NovelA/番外设定/番外1.md',
				'NovelA/番外设定/番外2.md'
			]);

			const descSmartFirst = getDeterministicChapterDisplayOrder([extra2, v2c1, extra1, v1c1], {
				currentBookPath: 'NovelA',
				isDescending: true,
				customSortOrder: customOrderSmartFirst
			});
			expect(descSmartFirst.map(f => f.path)).toEqual([
				'NovelA/番外设定/番外2.md',
				'NovelA/番外设定/番外1.md',
				'NovelA/第二卷/第1章.md',
				'NovelA/第一卷/第1章.md'
			]);

			// 2. When customSortOrder places ordinary folder before __CHAPTER_BLOCK__
			const customOrderOrdinaryFirst = {
				'NovelA/番外设定': 100,
				'NovelA/__CHAPTER_BLOCK__': 200
			};

			const ascOrdinaryFirst = getDeterministicChapterDisplayOrder([extra2, v2c1, extra1, v1c1], {
				currentBookPath: 'NovelA',
				isDescending: false,
				customSortOrder: customOrderOrdinaryFirst
			});
			expect(ascOrdinaryFirst.map(f => f.path)).toEqual([
				'NovelA/番外设定/番外1.md',
				'NovelA/番外设定/番外2.md',
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

	describe('sortNovelFoldersForSwitchMenu', () => {
		const makeNovel = (folderPath: string, folderName?: string, name?: string): NovelFolderInfo => {
			const parts = folderPath.replace(/^\/+|\/+$/g, '').split('/');
			const defaultName = folderName || parts[parts.length - 1] || '';
			return {
				folderPath,
				folderName: defaultName,
				metadata: name ? {
					name,
					status: 'ongoing',
					synopsis: '',
					protagonist: '',
					wordGoal: 0,
					genre: '',
					startDate: '',
					endDate: ''
				} : null,
				wordCount: 1000
			};
		};

		it('should sort nested and ancestor works in top-to-bottom file tree order', () => {
			const seriesA = makeNovel('Novels/SeriesA');
			const arc1 = makeNovel('Novels/SeriesA/Arc1');
			const arc2 = makeNovel('Novels/SeriesA/Arc2');
			const seriesB = makeNovel('Novels/SeriesB');
			const rootWork = makeNovel('RootWork');

			// Input scrambled
			const input = [arc2, seriesB, rootWork, arc1, seriesA];
			const originalInput = [...input];

			const sorted = sortNovelFoldersForSwitchMenu(input, { enableSmartChapterSort: true });

			expect(sorted.map(n => n.folderPath)).toEqual([
				'Novels/SeriesA',
				'Novels/SeriesA/Arc1',
				'Novels/SeriesA/Arc2',
				'Novels/SeriesB',
				'RootWork'
			]);
			// Verify input was not mutated
			expect(input).toEqual(originalInput);
		});

		it('should sort multiple workspace roots in actual file-tree order regardless of input/discovery order', () => {
			const workZ = makeNovel('WorkspaceZ/Work1');
			const workA1 = makeNovel('WorkspaceA/Work1');
			const workA2 = makeNovel('WorkspaceA/Work2');

			const input = [workZ, workA2, workA1];
			const sorted = sortNovelFoldersForSwitchMenu(input, { enableSmartChapterSort: true });

			expect(sorted.map(n => n.folderPath)).toEqual([
				'WorkspaceA/Work1',
				'WorkspaceA/Work2',
				'WorkspaceZ/Work1'
			]);
		});

		it('should respect customSortOrder for ordinary sibling works', () => {
			const work1 = makeNovel('Novels/WorkAlpha');
			const work2 = makeNovel('Novels/WorkBeta');
			const customSortOrder = {
				'Novels/WorkBeta': 10,
				'Novels/WorkAlpha': 20
			};

			const sorted = sortNovelFoldersForSwitchMenu([work1, work2], {
				enableSmartChapterSort: true,
				customSortOrder
			});

			expect(sorted.map(n => n.folderPath)).toEqual([
				'Novels/WorkBeta',
				'Novels/WorkAlpha'
			]);
		});

		it('should ignore stale individual custom weights on smart-recognized folders and sort by smart chapter rules', () => {
			const part1 = makeNovel('Novels/第一部');
			const part2 = makeNovel('Novels/第二部');
			const part10 = makeNovel('Novels/第十部');

			// Stale individual weights trying to put 第二部 before 第一部
			const customSortOrder = {
				'Novels/第二部': 0,
				'Novels/第一部': 100
			};

			const sorted = sortNovelFoldersForSwitchMenu([part10, part2, part1], {
				enableSmartChapterSort: true,
				customSortOrder
			});

			expect(sorted.map(n => n.folderPath)).toEqual([
				'Novels/第一部',
				'Novels/第二部',
				'Novels/第十部'
			]);
		});

		it('should position ordinary folders relative to smart chapter block using __CHAPTER_BLOCK__ key', () => {
			const lore = makeNovel('Novels/设定集');
			const part1 = makeNovel('Novels/第一部');

			// 1. Default: ordinary folder before smart block
			const defaultSorted = sortNovelFoldersForSwitchMenu([part1, lore], {
				enableSmartChapterSort: true
			});
			expect(defaultSorted.map(n => n.folderPath)).toEqual([
				'Novels/设定集',
				'Novels/第一部'
			]);

			// 2. Custom order dragging smart block first
			const orderSmartFirst = {
				'Novels/__CHAPTER_BLOCK__': 0,
				'Novels/设定集': 10
			};
			const smartFirstSorted = sortNovelFoldersForSwitchMenu([lore, part1], {
				enableSmartChapterSort: true,
				customSortOrder: orderSmartFirst
			});
			expect(smartFirstSorted.map(n => n.folderPath)).toEqual([
				'Novels/第一部',
				'Novels/设定集'
			]);
		});

		it('should ignore customSortOrder and use natural numeric locale ordering when enableSmartChapterSort is false', () => {
			const part1 = makeNovel('Novels/第1部');
			const part2 = makeNovel('Novels/第2部');
			const part10 = makeNovel('Novels/第10部');
			const customSortOrder = {
				'Novels/第2部': 0,
				'Novels/第10部': 5,
				'Novels/第1部': 10
			};

			const sorted = sortNovelFoldersForSwitchMenu([part10, part2, part1], {
				enableSmartChapterSort: false,
				customSortOrder
			});

			expect(sorted.map(n => n.folderPath)).toEqual([
				'Novels/第1部',
				'Novels/第2部',
				'Novels/第10部'
			]);
		});

		it('should handle empty or single-element input without error', () => {
			expect(sortNovelFoldersForSwitchMenu([])).toEqual([]);

			const single = makeNovel('NovelA');
			const result = sortNovelFoldersForSwitchMenu([single]);
			expect(result).toEqual([single]);
			expect(result).not.toBe([single]); // returns new array copy
		});
	});
});
