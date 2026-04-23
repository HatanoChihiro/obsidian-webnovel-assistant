import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { CHINESE_NUMBERS } from '../constants';
import { ChapterNamingRule } from '../types/settings';

/**
 * 章节排序服务
 * 
 * 提供智能数字排序功能，支持：
 * - 自定义章节命名规则（正则表达式）
 * - 阿拉伯数字：1, 01, 001
 * - 中文数字：一、二、三...九十九
 * - 混合格式：第1章、第一章、Chapter 01
 * - 小数点章节：1.1, 49.1
 */
export class ChapterSorter {
	// 中文数字映射表（从常量导入）
	private static readonly chineseToArabic = CHINESE_NUMBERS;

	// 自定义章节命名规则（由插件设置提供）
	private static customRules: ChapterNamingRule[] = [];

	/**
	 * 设置自定义章节命名规则
	 */
	static setCustomRules(rules: ChapterNamingRule[]) {
		this.customRules = rules;
	}

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
	 * 从文件名中提取章节编号（使用自定义规则）
	 * 
	 * @returns { number: 章节编号, ruleIndex: 规则索引 } 或 null
	 */
	static extractChapterNumber(filename: string): { number: number; ruleIndex: number } | null {
		// 移除文件扩展名
		const basename = filename.replace(/\.md$/i, '');

		// 如果有自定义规则，优先使用
		if (this.customRules && this.customRules.length > 0) {
			for (let i = 0; i < this.customRules.length; i++) {
				const rule = this.customRules[i];
				if (!rule.enabled) continue;

				try {
					const regex = new RegExp(rule.pattern, 'i');
					const match = basename.match(regex);
					if (match && match[1]) {
						// 尝试解析为数字
						const numStr = match[1];
						
						// 检查是否是小数点格式
						if (numStr.includes('.')) {
							const num = parseFloat(numStr);
							if (!isNaN(num)) {
								return { number: num, ruleIndex: i };
							}
						}
						
						// 检查是否是阿拉伯数字
						const arabicNum = parseInt(numStr, 10);
						if (!isNaN(arabicNum)) {
							return { number: arabicNum, ruleIndex: i };
						}
						
						// 尝试解析中文数字
						const chineseNum = this.parseChineseNumber(numStr);
						if (chineseNum > 0) {
							return { number: chineseNum, ruleIndex: i };
						}
					}
				} catch (error) {
					console.error(`[ChapterSorter] 无效的正则表达式: ${rule.pattern}`, error);
				}
			}
			// 如果启用了自定义规则但都不匹配，返回 null（不参与排序）
			return null;
		}

		// 没有自定义规则时，使用默认逻辑（向后兼容）
		// 尝试匹配阿拉伯数字格式
		const arabicMatch = basename.match(/(?:第|chapter|ch)?(\d+(?:\.\d+)?)(?:[章节回卷部册篇\s\-]|$)/i);
		if (arabicMatch) {
			const num = parseFloat(arabicMatch[1]);
			if (!isNaN(num)) {
				return { number: num, ruleIndex: 0 };
			}
		}
		
		// 尝试匹配中文数字格式
		const chineseMatch = basename.match(/(?:第)?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)(?:[章节回卷部册篇]|$)/);
		if (chineseMatch) {
			const num = this.parseChineseNumber(chineseMatch[1]);
			if (num > 0) {
				return { number: num, ruleIndex: 1 };
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
	 * 2. 按规则索引分组（规则顺序决定大块排序）
	 * 3. 同一规则内按章节编号排序
	 * 4. 无章节编号的文件保持原始顺序
	 */
	static compareFiles(a: TAbstractFile, b: TAbstractFile): number {
		// 1. 文件夹优先
		const aIsFolder = a instanceof TFolder;
		const bIsFolder = b instanceof TFolder;
		if (aIsFolder && !bIsFolder) return -1;
		if (!aIsFolder && bIsFolder) return 1;
		
		// 2. 提取章节编号和规则索引
		const aChapter = ChapterSorter.extractChapterNumber(a.name);
		const bChapter = ChapterSorter.extractChapterNumber(b.name);
		
		// 3. 都有章节编号：先按规则索引排序，再按编号排序
		if (aChapter !== null && bChapter !== null) {
			// 先按规则索引排序（规则顺序决定大块排序）
			if (aChapter.ruleIndex !== bChapter.ruleIndex) {
				return aChapter.ruleIndex - bChapter.ruleIndex;
			}
			// 同一规则内按编号排序
			if (aChapter.number !== bChapter.number) {
				return aChapter.number - bChapter.number;
			}
			// 编号相同，按文件名排序
			return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
		}
		
		// 4. 只有一个有章节编号：有编号的排在前面
		if (aChapter !== null) return -1;
		if (bChapter !== null) return 1;
		
		// 5. 都没有章节编号：保持原始顺序
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
	 * 支持阿拉伯数字、小数点和中文数字格式
	 * @returns 新文件名（含 .md），或 null 表示无法识别
	 */
	static getNextChapterName(basename: string, siblingNames: string[]): string | null {
		// 优先尝试小数点格式：1.1、49.1 等（只计算小数点后一位）
		const decimalMatch = basename.match(/^([^0-9]*)(\d+)\.(\d+)(.*)$/);
		if (decimalMatch) {
			const prefix = decimalMatch[1];
			const mainNum = parseInt(decimalMatch[2], 10);
			const subNum = parseInt(decimalMatch[3], 10);
			const suffix = decimalMatch[4];
			
			// 小数点后一位到 9 就进位到下一个主章节
			if (subNum >= 9) {
				return `${prefix}${mainNum + 1}.0${suffix}.md`;
			} else {
				return `${prefix}${mainNum}.${subNum + 1}${suffix}.md`;
			}
		}

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
