import { TAbstractFile, TFile, TFolder } from 'obsidian';

/**
 * 章节排序服务
 * 
 * 提供智能数字排序功能，支持：
 * - 阿拉伯数字：1, 01, 001
 * - 中文数字：一、二、三...九十九
 * - 混合格式：第1章、第一章、Chapter 01
 */
export class ChapterSorter {
	// 中文数字映射表
	private static readonly chineseToArabic: Record<string, number> = {
		'零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
		'〇': 0, '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5, '陆': 6, '柒': 7, '捌': 8, '玖': 9, '拾': 10,
		'百': 100, '佰': 100, '千': 1000, '仟': 1000, '万': 10000, '萬': 10000
	};

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
		
		// 5. 都没有章节编号：按字母排序
		return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
	}

	/**
	 * 对文件列表进行智能排序
	 */
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
