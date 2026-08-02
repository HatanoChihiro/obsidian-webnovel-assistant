import { Logger } from '../utils/Logger';
import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder, Vault } from 'obsidian';
import { CHINESE_NUMBERS } from '../constants';
import type { ChapterNamingRule } from '../types/settings';
import type { WebNovelAssistantPlugin } from '../types/plugin';

export interface ChapterNumberExtraction {
	number: number;
	ruleIndex: number;
	numStr?: string;
	isChinese?: boolean;
	isDecimal?: boolean;
	rulePattern?: string;
}

/**
 * 章节排序服务
 * 
 * 提供智能数字排序功能，支持：
 * - 自定义章节命名规则（正则表达式）
 * - 阿拉伯数字：1, 01, 001
 * - 中文数字：一、二、三...九百九十九
 * - 混合格式：第1章、第一章、Chapter 01
 * - 小数点章节：1.1, 49.1
 */
export class ChapterSorter {
	// 中文数字映射表（从常量导入）
	private static readonly chineseToArabic = CHINESE_NUMBERS;

	// 自定义章节命名规则（由插件设置提供）
	private static customRules: ChapterNamingRule[] = [];
	private static _compiledRules: Array<{ rule: ChapterNamingRule; regex: RegExp; index: number }> = [];

	/**
	 * 统一获取指定文件夹下的所有章节文件，并按规则和自定义顺序排好序
	 */
	static getAllChapters(app: App, plugin: WebNovelAssistantPlugin, folderPath: string): TFile[] {
		let targetFiles: TFile[];
		if (folderPath && folderPath !== '/') {
			const folder = app.vault.getAbstractFileByPath(folderPath);
			if (folder instanceof TFolder) {
				const list: TFile[] = [];
				Vault.recurseChildren(folder, (file: TAbstractFile) => {
					if (file instanceof TFile && file.extension === 'md') {
						list.push(file);
					}
				});
				targetFiles = list;
			} else {
				targetFiles = plugin.getVaultMarkdownFiles().filter(f => f.path.startsWith(folderPath + '/'));
			}
		} else {
			targetFiles = plugin.getTrackedMarkdownFiles();
		}

		if (plugin.settings.enableStrictChapterMode) {
			targetFiles = targetFiles.filter(f => this.isChapterFile(f.basename) || plugin.isFileInStrictChapterException(f));
		}

		targetFiles.sort((a, b) => this.compareFilesWithCustomOrder(a, b, plugin.settings.customSortOrder || {}));
		
		return targetFiles;
	}

	/**
	 * 设置自定义章节命名规则
	 * 会对用户输入的正则表达式进行预编译验证，过滤掉无效规则，
	 * 并限制模式长度，降低灾难性回溯（ReDoS）导致 UI 冻结的风险。
	 */
	static setCustomRules(rules: ChapterNamingRule[]) {
		this.customRules = rules.filter(rule => {
			// 禁用的规则跳过验证
			if (!rule.enabled) return true;

			// [安全] 限制正则长度，过于复杂的模式更易触发灾难性回溯
			if (rule.pattern.length > 200) {
				Logger.warn(`[ChapterSorter] 正则表达式过长（>200字符），已跳过: "${rule.name}"`);
				return false;
			}

			// [安全] 预编译验证语法，语法错误的规则直接丢弃，避免运行时每次排序都抛出异常
			try {
				new RegExp(rule.pattern, 'i');
				return true;
			} catch {
				Logger.error(`[ChapterSorter] 无效的正则表达式，已跳过规则 "${rule.name}": ${rule.pattern}`);
				return false;
			}
		});

		this._compiledRules = [];
		for (let i = 0; i < this.customRules.length; i++) {
			const rule = this.customRules[i];
			if (rule.enabled) {
				try {
					this._compiledRules.push({ rule, regex: new RegExp(rule.pattern, 'i'), index: i });
				} catch { /* ignore */ }
			}
		}
	}

	/**
	 * 解析中文数字（支持一到九百九十九）
	 */
	private static parseChineseNumber(str: string): number {
		let result = 0;
		let temp = 0;
		
		for (let i = 0; i < str.length; i++) {
			const char = str[i];
			const num = char in this.chineseToArabic ? this.chineseToArabic[char as keyof typeof this.chineseToArabic] : undefined;
			
			if (num !== undefined) {
				// 数字字符
				if (num === 0) {
					// 零：跳过
					continue;
				} else if (num < 10) {
					// 个位数字
					temp = num;
				} else if (num === 10) {
					// 十
					if (temp === 0) {
						// 单独的"十"或"十X"格式
						temp = 1;
					}
					result += temp * 10;
					temp = 0;
				} else if (num === 100) {
					// 百
					if (temp === 0) {
						temp = 1;
					}
					result += temp * 100;
					temp = 0;
				}
			}
		}
		
		// 加上剩余的个位数
		result += temp;
		
		return result;
	}


	/**
	 * 从文件名中提取章节编号（使用自定义规则）
	 * 
	 * @returns { number: 章节编号, ruleIndex: 规则索引, numStr: 数字字符串, isChinese: 是否中文, isDecimal: 是否小数, rulePattern: 规则正则 } 或 null
	 */
	static extractChapterNumber(filename: string): ChapterNumberExtraction | null {
		// 移除文件扩展名
		const basename = filename.replace(/\.md$/i, '');

		// 如果有自定义规则，优先使用
		if (this.customRules && this.customRules.length > 0) {
			for (const { rule, regex, index } of this._compiledRules) {
				try {
					const match = basename.match(regex);
					// 章节标题必须从文本行首开始匹配 (index === 0)，防止没有 ^ 锚定的正则在行中误判
					if (match && match.index === 0) {
						// 如果有捕获组，寻找第一个匹配到的有效数字文本（支持包含多分支的捕获组，如 match[1] 或 match[2]）
						const numStr = match.slice(1).find(m => m !== undefined && m !== '');
						if (numStr) {
							// 检查是否是小数点格式
							if (numStr.includes('.')) {
								const num = parseFloat(numStr);
								if (!isNaN(num)) {
									return { number: num, ruleIndex: index, numStr, isDecimal: true, rulePattern: rule.pattern };
								}
							}
							
							// 检查是否是阿拉伯数字
							const arabicNum = parseInt(numStr, 10);
							if (!isNaN(arabicNum)) {
								return { number: arabicNum, ruleIndex: index, numStr, isDecimal: false, rulePattern: rule.pattern };
							}
							
							// 尝试解析中文数字
							const chineseNum = this.parseChineseNumber(numStr);
							if (chineseNum > 0) {
								return { number: chineseNum, ruleIndex: index, numStr, isChinese: true, isDecimal: false, rulePattern: rule.pattern };
							}
						}
						// [关键扩展] 规则匹配但没有捕获组，或捕获组不是数字
						// 视为“具名章节”（如：大纲、番外、楔子），使用 -1 让其排在该规则分组的最前面
						// 规则的先后顺序（ruleIndex）决定该分组在整个文件列表中的位置
						return { number: -1, ruleIndex: index, rulePattern: rule.pattern };
					}
				} catch (error) {
					Logger.error(`[ChapterSorter] 无效的正则表达式: ${rule.pattern}`, error);
				}
			}
			// 如果启用了自定义规则但都不匹配，返回 null（不参与排序）
			return null;
		}

		// 没有自定义规则时，使用默认逻辑（向后兼容）
		// 尝试匹配阿拉伯数字格式（要求至少包含前缀或单位，避免把纯数字误判为章节）
		const arabicMatch = basename.match(/^(?:(?:第\s*|chapter\s*|ch\s*)(\d+(?:\.\d+)?)(?:[章节回卷部册篇\s-]|$)|(?:第\s*|chapter\s*|ch\s*)?(\d+(?:\.\d+)?)(?:[章节回卷部册篇]+))/i);
		if (arabicMatch) {
			const numStr = arabicMatch[1] || arabicMatch[2];
			const num = parseFloat(numStr);
			if (!isNaN(num)) {
				return { number: num, ruleIndex: 0, numStr, isDecimal: numStr.includes('.') };
			}
		}
		// 尝试匹配中文数字格式（要求至少包含前缀或单位，避免把纯数字误判为章节）
		const chineseMatch = basename.match(/^(?:第([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)(?:[章节回卷部册篇]|$)|(?:第)?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]+)/);
		if (chineseMatch) {
			const numStr = chineseMatch[1] || chineseMatch[2];
			const num = this.parseChineseNumber(numStr);
			if (num > 0) {
				return { number: num, ruleIndex: 1, numStr, isChinese: true, isDecimal: false };
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
		// 1. 提取章节编号和规则索引
		const aChapter = ChapterSorter.extractChapterNumber(a.name);
		const bChapter = ChapterSorter.extractChapterNumber(b.name);
		
		// 2. 都有章节编号：先按规则索引排序，再按编号排序
		if (aChapter !== null && bChapter !== null) {
			// 先按规则索引排序（规则顺序决定大块排序）
			if (aChapter.ruleIndex !== bChapter.ruleIndex) {
				return aChapter.ruleIndex - bChapter.ruleIndex;
			}
			// 同一规则内按编号排序
			if (aChapter.number !== bChapter.number) {
				return aChapter.number - bChapter.number;
			}
			
			// 编号和规则都相同，此时再判定文件夹优先
			const aIsFolder = a instanceof TFolder;
			const bIsFolder = b instanceof TFolder;
			if (aIsFolder && !bIsFolder) return -1;
			if (!aIsFolder && bIsFolder) return 1;
			
			// 最后按文件名排序
			return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
		}
		
		// 3. 只有一个有章节编号：有编号的排在前面
		if (aChapter !== null) return -1;
		if (bChapter !== null) return 1;
		
		// 4. 都没有章节编号：此时判定文件夹优先
		const aIsFolder = a instanceof TFolder;
		const bIsFolder = b instanceof TFolder;
		if (aIsFolder && !bIsFolder) return -1;
		if (!aIsFolder && bIsFolder) return 1;
		
		// 5. 保持原始顺序
		return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
	}

	/**
	 * 结合用户在文件浏览器中的自定义拖拽顺序，进行混合智能排序
	 * 逻辑与 FileExplorerPatcher 完全对齐：
	 * - 章节被打包成虚拟的 __CHAPTER_BLOCK__ 块，在自定义排序中占有一个位置
	 * - 非章节文件拥有各自的路径作为位置
	 * - 如果同时没有自定义顺序，章节块（0）会排在普通文件（1）前面，也就是章节在前的默认行为
	 */
	static compareFilesWithCustomOrder(a: TAbstractFile, b: TAbstractFile, customOrder: Record<string, number>): number {
		const aChapter = this.extractChapterNumber(a.name);
		const bChapter = this.extractChapterNumber(b.name);

		// 如果两者都是章节，按照章节的内部智能规则对比
		if (aChapter !== null && bChapter !== null) {
			return this.compareFiles(a, b);
		}

		const getSortData = (file: TAbstractFile, isChap: boolean) => {
			let pathForOrder = file.path;
			if (isChap) {
				const parentPath = file.parent ? file.parent.path : '/';
				pathForOrder = parentPath === '/' ? '/__CHAPTER_BLOCK__' : `${parentPath}/__CHAPTER_BLOCK__`;
			}
			const order = customOrder[pathForOrder];
			return { 
				hasOrder: order !== undefined, 
				order: order !== undefined ? order : (isChap ? 0 : 1) // 默认章节块优先级(0)高于普通文件(1)
			};
		};

		const aData = getSortData(a, aChapter !== null);
		const bData = getSortData(b, bChapter !== null);

		// 如果两者都被手动拖拽过，按拖拽顺序
		if (aData.hasOrder && bData.hasOrder) return aData.order - bData.order;
		// 如果只有一方被拖拽过，有明确顺序的优先
		if (aData.hasOrder) return -1;
		if (bData.hasOrder) return 1;

		// 都没有被拖拽过，比较默认优先级（章节块 0 vs 普通文件 1）
		if (aData.order !== bData.order) return aData.order - bData.order;

		// 如果是同类型（比如都是普通文件），按文件名拼音/数字排序
		return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
	}

	/**
	 * 将数字转换为中文数字（支持 1-9999）
	 */
	static toChineseNumber(num: number, useUppercase: boolean = false): string {
		if (num === 0) return '零';
		const numStr = num.toString();
		const chars = useUppercase 
			? ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
			: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
		const units = useUppercase
			? ['', '拾', '佰', '仟', '万']
			: ['', '十', '百', '千', '万'];
		
		let result = '';
		for (let i = 0; i < numStr.length; i++) {
			const n = parseInt(numStr[i]);
			const unit = units[numStr.length - 1 - i];
			if (n === 0) {
				if (result.length > 0 && result[result.length - 1] !== '零' && i !== numStr.length - 1) {
					result += '零';
				}
			} else {
				// 处理 "一十" 为 "十" (e.g. 15 -> 十五)
				if (n === 1 && unit === '十' && i === 0 && numStr.length === 2) {
					result += unit;
				} else {
					result += chars[n] + unit;
				}
			}
		}
		if (result.endsWith('零') && result.length > 1) {
			result = result.slice(0, -1);
		}
		return result;
	}

	/**
	 * 根据匹配结果与数字文本生成下一章文件名
	 */
	private static generateNextFromMatch(
		basename: string,
		match: RegExpMatchArray,
		numStr: string,
		siblingNames: string[]
	): string | null {
		const matchStart = match.index ?? 0;
		const matchStr = match[0];
		const numIndexInMatch = matchStr.indexOf(numStr);
		const numStartInBasename = matchStart + (numIndexInMatch >= 0 ? numIndexInMatch : basename.indexOf(numStr));
		
		if (numStartInBasename < 0) return null;

		const prefix = basename.slice(0, numStartInBasename);
		const numEndInBasename = numStartInBasename + numStr.length;
		const matchEndInBasename = matchStart + matchStr.length;

		// 规则内匹配捕获到的单位部分（位于 match[0] 内部、数字之后的部分，如“章”、“集”、“）”等）
		const unitFromRule = basename.slice(numEndInBasename, matchEndInBasename);

		// match[0] 之后的文本（可能包含结构性标点与具体标题）
		const textAfterMatch = basename.slice(matchEndInBasename);

		// 从 match[0] 后面的文本中仅提取结构性符号（如空格、破折号、冒号、闭合括号等），丢弃具体的标题文字
		const structuralMatch = textAfterMatch.match(/^([ \-_:：，、.)）\]】]*)/);
		const structuralSuffix = structuralMatch ? structuralMatch[1] : '';

		const unitAndStructural = unitFromRule + structuralSuffix;

		// 1. 小数点数字格式 (如 1.1, 49.1)
		if (numStr.includes('.')) {
			const parts = numStr.split('.');
			if (parts.length === 2) {
				const mainNum = parseInt(parts[0], 10);
				const subNum = parseInt(parts[1], 10);
				if (!isNaN(mainNum) && !isNaN(subNum)) {
					const nextNumStr = subNum >= 9 ? `${mainNum + 1}.0` : `${mainNum}.${subNum + 1}`;
					return `${prefix}${nextNumStr}${unitAndStructural}.md`;
				}
			}
		}

		// 2. 阿拉伯数字格式 (如 1, 01, 001)
		const arabicNum = parseInt(numStr, 10);
		if (!isNaN(arabicNum) && /^\d+$/.test(numStr)) {
			const nextNum = arabicNum + 1;
			let paddingLength = numStr.length;
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
			return `${prefix}${nextNumStr}${unitAndStructural}.md`;
		}

		// 3. 中文数字格式 (如 一, 二, 十, 第一)
		const chineseNum = this.parseChineseNumber(numStr);
		if (chineseNum > 0) {
			const useUppercase = /[壹贰叁肆伍陆柒捌玖拾佰仟萬]/.test(numStr);
			const nextNumStr = this.toChineseNumber(chineseNum + 1, useUppercase);
			return `${prefix}${nextNumStr}${unitAndStructural}.md`;
		}

		return null;
	}

	/**
	 * 根据当前文件名生成下一章的文件名
	 * 支持用户自定义章节规则（优先）及默认格式（阿拉伯数字、中文数字、小数点）
	 * @returns 新文件名（含 .md），或 null 表示无法识别
	 */
	static getNextChapterName(basename: string, siblingNames: string[]): string | null {
		// 1. 如果配置了用户自定义章节命名规则，优先使用自定义规则匹配生成，确保设置中的规则真正生效
		if (this._compiledRules && this._compiledRules.length > 0) {
			for (const { rule, regex } of this._compiledRules) {
				try {
					const match = basename.match(regex);
					if (match) {
						// 寻找第一个非空捕获组作为章节数字
						const numStr = match.slice(1).find(m => m !== undefined && m !== '');
						if (numStr) {
							const result = this.generateNextFromMatch(basename, match, numStr, siblingNames);
							if (result) return result;
						}
					}
				} catch (e) {
					Logger.error(`[ChapterSorter] 自定义规则生成下一章失败: ${rule.pattern}`, e);
				}
			}
		}

		// 2. 没有匹配自定义规则时，使用默认正则表达式格式兜底
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
			const suffix = arabicMatch[4];
			const nextNum = parseInt(currentNumStr, 10) + 1;

			// 提取结构性后缀（如闭合括号、空格、冒号、破折号等），丢弃具体的章节标题
			const structuralSuffixMatch = suffix.match(/^([ \-_:：，、.)）\]】]*)/);
			const structuralSuffix = structuralSuffixMatch ? structuralSuffixMatch[1] : '';

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
			return `${prefix}${nextNumStr}${unit}${structuralSuffix}.md`;
		}

		// 尝试中文数字格式：第一章、第二十三章 等
		const chineseMatch = basename.match(/^([^零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]*)([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)([章节回卷部册篇]?)(.*)$/);
		if (chineseMatch) {
			const prefix = chineseMatch[1];
			const currentNumStr = chineseMatch[2];
			const unit = chineseMatch[3];
			const suffix = chineseMatch[4];
			const currentNum = this.parseChineseNumber(currentNumStr);
			if (currentNum === 0) return null;
			
			const useUppercase = /[壹贰叁肆伍陆柒捌玖拾佰仟萬]/.test(currentNumStr);
			const nextNumStr = this.toChineseNumber(currentNum + 1, useUppercase);
			
			const structuralSuffixMatch = suffix.match(/^([ \-_:：，、.)）\]】]*)/);
			const structuralSuffix = structuralSuffixMatch ? structuralSuffixMatch[1] : '';
			
			return `${prefix}${nextNumStr}${unit}${structuralSuffix}.md`;
		}

		return null;
	}
	static sortFiles(files: TAbstractFile[]): TAbstractFile[] {
		return files.slice().sort((a, b) => ChapterSorter.compareFiles(a, b));
	}

	/**
	 * 测试文件名是否包含章节编号
	 */
	static isChapterFile(filename: string): boolean {
		return this.extractChapterNumber(filename) !== null;
	}
}
