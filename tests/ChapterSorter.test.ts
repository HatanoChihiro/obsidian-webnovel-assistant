import { describe, it, expect, beforeAll } from 'vitest';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { TFile, TFolder } from 'obsidian';

describe('ChapterSorter', () => {
	// 每次测试前清空自定义规则
	beforeAll(() => {
		ChapterSorter.setCustomRules([]);
	});

	describe('extractChapterNumber — 默认规则', () => {
		it('识别阿拉伯数字章节: 第1章', () => {
			const result = ChapterSorter.extractChapterNumber('第1章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(1);
		});

		it('识别阿拉伯数字章节: 第10章', () => {
			const result = ChapterSorter.extractChapterNumber('第10章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(10);
		});

		it('识别零填充格式: 第001章', () => {
			const result = ChapterSorter.extractChapterNumber('第001章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(1);
		});

		it('识别 Chapter 格式', () => {
			const result = ChapterSorter.extractChapterNumber('Chapter 5.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(5);
		});

		it('不再默认识别纯数字文件名', () => {
			const result = ChapterSorter.extractChapterNumber('42.md');
			expect(result).toBeNull();
		});

		it('识别中文数字章节: 第一章', () => {
			const result = ChapterSorter.extractChapterNumber('第一章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(1);
		});

		it('识别中文数字: 第十章', () => {
			const result = ChapterSorter.extractChapterNumber('第十章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(10);
		});

		it('识别中文数字: 第二十三章', () => {
			const result = ChapterSorter.extractChapterNumber('第二十三章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(23);
		});

		it('识别中文数字: 第一百零五章', () => {
			const result = ChapterSorter.extractChapterNumber('第一百零五章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(105);
		});

		it('识别小数点章节: 49.1', () => {
			const result = ChapterSorter.extractChapterNumber('第49.1章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(49.1);
		});

		it('无法识别的返回 null', () => {
			const result = ChapterSorter.extractChapterNumber('人物设定.md');
			expect(result).toBeNull();
		});
	});

	describe('compareFiles — 排序', () => {
		it('无编号时，文件夹优先于文件', () => {
			const folder = new (TFolder as any)('设定集', '设定集');
			const file = new (TFile as any)('设定A.md', '设定A.md');
			expect(ChapterSorter.compareFiles(folder, file)).toBeLessThan(0);
		});

		it('第1章 < 第2章 < 第10章', () => {
			const ch1 = new (TFile as any)('第1章.md', '第1章.md');
			const ch2 = new (TFile as any)('第2章.md', '第2章.md');
			const ch10 = new (TFile as any)('第10章.md', '第10章.md');

			expect(ChapterSorter.compareFiles(ch1, ch2)).toBeLessThan(0);
			expect(ChapterSorter.compareFiles(ch2, ch10)).toBeLessThan(0);
			expect(ChapterSorter.compareFiles(ch1, ch10)).toBeLessThan(0);
		});

		it('有章节编号的排在无编号之前', () => {
			const chapter = new (TFile as any)('第1章.md', '第1章.md');
			const notes = new (TFile as any)('人物设定.md', '人物设定.md');

			expect(ChapterSorter.compareFiles(chapter, notes)).toBeLessThan(0);
		});
	});

	describe('extractChapterNumber — 自定义规则', () => {
		it('自定义规则正确匹配', () => {
			ChapterSorter.setCustomRules([
				{ name: '标准章节', pattern: '^第(\\d+)章', enabled: true }
			]);
			const result = ChapterSorter.extractChapterNumber('第5章 测试.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(5);
			expect(result!.ruleIndex).toBe(0);

			// 清理
			ChapterSorter.setCustomRules([]);
		});

		it('禁用的规则不参与匹配', () => {
			ChapterSorter.setCustomRules([
				{ name: '禁用规则', pattern: '^第(\\d+)章', enabled: false }
			]);
			// 应该回退到默认规则
			const result = ChapterSorter.extractChapterNumber('第5章.md');
			expect(result).toBeNull(); // 自定义规则存在但都不匹配 → null

			ChapterSorter.setCustomRules([]);
		});

		it('过长正则被过滤（回退到默认规则）', () => {
			const longPattern = 'a'.repeat(201);
			ChapterSorter.setCustomRules([
				{ name: '超长规则', pattern: longPattern, enabled: true }
			]);
			// 规则被过滤后列表为空，但 extractChapterNumber 会检测到没有有效的 enabled 规则
			// 因为过滤的规则从数组中移除，剩下空数组 -> 没有自定义规则 -> 回退到默认规则
			const result = ChapterSorter.extractChapterNumber('第1章.md');
			// 默认规则会识别“第1章”
			expect(result).not.toBeNull();
			expect(result!.number).toBe(1);

			ChapterSorter.setCustomRules([]);
		});

		it('无效正则被过滤（回退到默认规则）', () => {
			ChapterSorter.setCustomRules([
				{ name: '无效正则', pattern: '(unclosed', enabled: true }
			]);
			// 无效规则被过滤，回退到默认规则
			const result = ChapterSorter.extractChapterNumber('第1章.md');
			expect(result).not.toBeNull();
			expect(result!.number).toBe(1);

			ChapterSorter.setCustomRules([]);
		});

		it('自定义规则匹配无数字文件时返回 number=-1（如设定、时间线）', () => {
			ChapterSorter.setCustomRules([
				{ name: '设定文档', pattern: '^(设定|时间线)', enabled: true }
			]);
			
			// 对于这些原先不是章节的文件，现在有了自定义规则，可以被识别为章节
			const result1 = ChapterSorter.extractChapterNumber('设定-主角.md');
			expect(result1).not.toBeNull();
			expect(result1!.number).toBe(-1);
			expect(ChapterSorter.isChapterFile('设定-主角.md')).toBe(true);

			const result2 = ChapterSorter.extractChapterNumber('时间线.md');
			expect(result2).not.toBeNull();
			expect(result2!.number).toBe(-1);
			expect(ChapterSorter.isChapterFile('时间线.md')).toBe(true);

			ChapterSorter.setCustomRules([]);
		});
	});

	describe('getNextChapterName', () => {
		it('阿拉伯数字递增', () => {
			const result = ChapterSorter.getNextChapterName('第1章', []);
			expect(result).toBe('第2章.md');
		});

		it('零填充保持位数', () => {
			const result = ChapterSorter.getNextChapterName('第01章', []);
			expect(result).toBe('第02章.md');
		});

		it('自动扩展位数: 99 → 100', () => {
			const siblings = Array.from({ length: 100 }, (_, i) => `第${(i + 1).toString().padStart(2, '0')}章`);
			const result = ChapterSorter.getNextChapterName('第99章', siblings);
			expect(result).toBe('第100章.md');
		});

		it('中文数字递增: 第一章 → 第二章', () => {
			const result = ChapterSorter.getNextChapterName('第一章', []);
			expect(result).toBe('第二章.md');
		});

		it('中文数字递增: 第九章 → 第十章', () => {
			const result = ChapterSorter.getNextChapterName('第九章', []);
			expect(result).toBe('第十章.md');
		});

		it('小数点格式递增: 49.1 → 49.2', () => {
			const result = ChapterSorter.getNextChapterName('49.1', []);
			expect(result).toBe('49.2.md');
		});

		it('无法识别时返回 null', () => {
			const result = ChapterSorter.getNextChapterName('角色设定', []);
			expect(result).toBeNull();
		});
	});

	describe('toChineseNumber', () => {
		it('基本数字', () => {
			expect(ChapterSorter.toChineseNumber(1)).toBe('一');
			expect(ChapterSorter.toChineseNumber(9)).toBe('九');
		});

		it('十位数', () => {
			expect(ChapterSorter.toChineseNumber(10)).toBe('十');
			expect(ChapterSorter.toChineseNumber(11)).toBe('十一');
			expect(ChapterSorter.toChineseNumber(23)).toBe('二十三');
		});

		it('百位数', () => {
			expect(ChapterSorter.toChineseNumber(100)).toBe('一百');
			expect(ChapterSorter.toChineseNumber(105)).toBe('一百零五');
			expect(ChapterSorter.toChineseNumber(999)).toBe('九百九十九');
		});

		it('零', () => {
			expect(ChapterSorter.toChineseNumber(0)).toBe('零');
		});

		it('千位数', () => {
			expect(ChapterSorter.toChineseNumber(1000)).toBe('一千');
		});
	});
});
