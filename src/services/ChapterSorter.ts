import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { CHINESE_NUMBERS } from '../constants';

/**
 * 章节排序服务
 * 
 * 提供智能数字排序功能，支持：
 * - 阿拉伯数字：1, 01, 001
 * - 中文数字：一、二、三...九十九
 * - 混合格式：第1章、第一章、Chapter 01
 */
export class ChapterSorter {
	// 中文数字映射表（从常量导入）
	private static readonly chineseToArabic = CHINESE_NUMBERS;

	/**
	 * 解析中文数字（支持一到九十九）
	 */
	private static parseChineseNumber(str: string): number {
		if (str === '十') return 10;
		if (str.startsWith('十')) {
			const ones = str.length > 1 ? (this.chineseToArabic[str[1]] || 0) : 0;
			return 10 + ones;
		}
		if (str.includes('十')) {
			const parts = str.split('十');
			const tens = this.chineseToArabic[parts[0]] || 0;
			const ones = parts[1] ? (this.chineseToArabic[parts[1]] || 0) : 0;
			return tens * 10 + ones;
		}
		return this.chineseToArabic[str] || 0;
	}

	/**
	 * 从文件名中提取章节编号
	 * 
	 * 支持的格式：
	 * - 第1章、第01章、第001章
	 * - 第一章、第二十三章
	 * - 第一卷、第二卷、第1卷
	 * - Chapter 1、Ch01
	 * - 1.md、01.md
	 * 
	 * @returns 章节编号，如果无法识别则返回 null
	 */
	static extractChapterNumber(filename: string): number | null {
		// 移除文件扩展名
		const basename = filename.replace(/\.md$/i, '');
		
		// 尝试匹配阿拉伯数字格式
		// 匹配：第1章、第01章、第1卷、Chapter 1、Ch01、001章、1-标题
		const arabicMatch = basename.match(/(?:第|chapter|ch)?(\d+)(?:[章节回卷部册篇\s\-]|$)/i);
		if (arabicMatch) {
			return parseInt(arabicMatch[1], 10);
		}
		
		// 尝试匹配中文数字格式
		// 匹配：第一章、第二十三章、第一卷、第二卷
		const chineseMatch = basename.match(/(?:第)?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)(?:[章节回卷部册篇]|$)/);
		if (chineseMatch) {
			const num = this.parseChineseNumber(chineseMatch[1]);
			if (num > 0) {
				return num;
			}
		}
		
		// 无法识别章节编号
		return null;
	}

	/**
	 * 智能排序比较函数
	 * 
	 * 排序规则：
	 * 1. 文件夹优先于文件
	 * 2. 有章节编号的文件按编号排序
	 * 3. 无章节编号的文件按字母排序
	 * 4. 章节文件排在非章节文件前面
	 */
	static compareFiles(a: TAbstractFile, b: TAbstractFile): number {
		// 1. 文件夹优先
		const aIsFolder = a instanceof TFolder;
		const bIsFolder = b instanceof TFolder;
		if (aIsFolder && !bIsFolder) return -1;
		if (!aIsFolder && bIsFolder) return 1;
		
		// 2. 提取章节编号
		const aChapter = ChapterSorter.extractChapterNumber(a.name);
		const bChapter = ChapterSorter.extractChapterNumber(b.name);
		
		// 3. 都有章节编号：按编号排序
		if (aChapter !== null && bChapter !== null) {
			if (aChapter !== bChapter) {
				return aChapter - bChapter;
			}
			// 编号相同，按文件名排序（处理"第1章 标题A"和"第1章 标题B"的情况）
			return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
		}
		
		// 4. 只有一个有章节编号：有编号的排在前面
		if (aChapter !== null) return -1;
		if (bChapter !== null) return 1;
		
		// 5. 都没有章节编号：保持原始顺序（兼容 manual-sorting 等手动排序插件）
		return 0;
	}

	/**
	 * 将阿拉伯数字转换为中文数字（支持一到九十九）
	 */
	static toChineseNumber(num: number): string {
		const arabicToChinese = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
		if (num <= 10) return arabicToChinese[num];
		if (num < 20) return '十' + (num === 10 ? '' : arabicToChinese[num - 10]);
		const tens = Math.floor(num / 10);
		const ones = num % 10;
		return arabicToChinese[tens] + '十' + (ones === 0 ? '' : arabicToChinese[ones]);
	}

	/**
	 * 根据当前文件名生成下一章的文件名
	 * 支持阿拉伯数字和中文数字格式
	 * @returns 新文件名（含 .md），或 null 表示无法识别
	 */
	static getNextChapterName(basename: string, siblingNames: string[]): string | null {
		// 尝试阿拉伯数字格式：第1章、第01章、Chapter 1 等
		const arabicMatch = basename.match(/^([^0-9]*)(\d+)([章节回卷部册篇]?)(.*)$/);
		if (arabicMatch) {
			const prefix = arabicMatch[1];
			const currentNumStr = arabicMatch[2];
			const unit = arabicMatch[3];
			const nextNum = parseInt(currentNumStr, 10) + 1;

			// 智能补零：检测同级文件夹中的最大章节数
			let paddingLength = currentNumStr.length;
			const maxChapter = siblingNames.reduce((max, name) => {
				const m = name.match(/^([^0-9]*)(\d+)/);
				if (m && m[1].toLowerCase() === prefix.toLowerCase()) {
					return Math.max(max, parseInt(m[2], 10));
				}
				return max;
			}, 0);
			if (maxChapter >= 100 && paddingLength < 3) paddingLength = 3;
			else if (maxChapter >= 10 && paddingLength < 2) paddingLength = 2;

			const nextNumStr = nextNum.toString().padStart(paddingLength, '0');
			return `${prefix}${nextNumStr}${unit}.md`;
		}

		// 尝试中文数字格式：第一章、第二十三章 等
		const chineseMatch = basename.match(/^([^零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]*)([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)([章节回卷部册篇]?)(.*)$/);
		if (chineseMatch) {
			const prefix = chineseMatch[1];
			const currentNumStr = chineseMatch[2];
			const unit = chineseMatch[3];
			const currentNum = this.parseChineseNumber(currentNumStr);
			if (currentNum === 0) return null;
			const nextNumStr = this.toChineseNumber(currentNum + 1);
			return `${prefix}${nextNumStr}${unit}.md`;
		}

		return null;
	}
	static sortFiles(files: TAbstractFile[]): TAbstractFile[] {
		return files.slice().sort(this.compareFiles);
	}

	/**
	 * 测试文件名是否包含章节编号
	 */
	static isChapterFile(filename: string): boolean {
		return this.extractChapterNumber(filename) !== null;
	}
}
