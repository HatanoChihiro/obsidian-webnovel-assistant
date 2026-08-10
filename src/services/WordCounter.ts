import { REGEX_PATTERNS } from '../constants';

/**
 * 字数计算服务
 * 负责准确计算 Markdown 文本的字数（清理所有 Markdown 语法后）
 * 
 * [优化] 使用预缓存的正则实例，避免每次调用工厂函数创建新对象。
 * 带 /g 标志的正则在每次使用前重置 lastIndex = 0。
 */
export class WordCounter {
	// 预缓存带 /g 标志的正则实例（避免每次调用工厂函数创建新对象）
	private readonly reCodeBlock = REGEX_PATTERNS.CODE_BLOCK();
	private readonly reInlineCode = REGEX_PATTERNS.INLINE_CODE();
	private readonly reHeading = REGEX_PATTERNS.HEADING();
	private readonly reStrikethrough = REGEX_PATTERNS.STRIKETHROUGH();
	private readonly reBold = REGEX_PATTERNS.BOLD();
	private readonly reItalic = REGEX_PATTERNS.ITALIC();
	private readonly reEmbeddedInternalLink = REGEX_PATTERNS.EMBEDDED_INTERNAL_LINK();
	private readonly reInternalLink = REGEX_PATTERNS.INTERNAL_LINK();
	private readonly reLink = REGEX_PATTERNS.LINK();
	private readonly reImage = REGEX_PATTERNS.IMAGE();
	private readonly reFootnoteRef = REGEX_PATTERNS.FOOTNOTE_REF();
	private readonly reHtmlTag = REGEX_PATTERNS.HTML_TAG();
	private readonly reWhitespace = REGEX_PATTERNS.WHITESPACE();
	private readonly reCjkChar = REGEX_PATTERNS.CJK_CHAR();
	private readonly reWordToken = REGEX_PATTERNS.WORD_TOKEN();
	private readonly reFullwidthPunct = REGEX_PATTERNS.FULLWIDTH_PUNCT();

	/**
	 * 重置所有带 /g 标志的正则实例的 lastIndex
	 * 必须在每次 replace 调用前执行，否则 /g 标志会导致匹配位置残留
	 */
	private resetAllRegex(): void {
		this.reCodeBlock.lastIndex = 0;
		this.reInlineCode.lastIndex = 0;
		this.reHeading.lastIndex = 0;
		this.reStrikethrough.lastIndex = 0;
		this.reBold.lastIndex = 0;
		this.reItalic.lastIndex = 0;
		this.reEmbeddedInternalLink.lastIndex = 0;
		this.reInternalLink.lastIndex = 0;
		this.reLink.lastIndex = 0;
		this.reImage.lastIndex = 0;
		this.reFootnoteRef.lastIndex = 0;
		this.reHtmlTag.lastIndex = 0;
		this.reWhitespace.lastIndex = 0;
		this.reCjkChar.lastIndex = 0;
		this.reWordToken.lastIndex = 0;
		this.reFullwidthPunct.lastIndex = 0;
	}

	/**
	 * 计算准确字数
	 * 清理所有 Markdown 语法标记，只保留纯文本内容
	 * 
	 * 
	 * ⚠️ 注意：standard/obsidian 模式下，逐行调用会导致跨行英文单词
	 *    被拆分为多个词分别计数，与整篇统计结果存在微小偏差。
	 *    行号栏（WordCountGutter）场景下此偏差可接受。
	 * 
	 * @param text - 原始 Markdown 文本
	 * @returns 纯文本字符数
	 */
	private getCleanedText(text: string): string {
		// 重置所有正则的 lastIndex 状态
		this.resetAllRegex();

		// 用于替换多行块时保留对应的换行符，确保清理后的文本行号与原文本1:1对应
		const preserveNewlines = (match: string) => '\n'.repeat((match.match(/\n/g) || []).length);

		// 清理 Markdown 语法标记，只保留纯文本内容（用于计数）
		return text
			// 移除 frontmatter（保留换行符）
			.replace(REGEX_PATTERNS.FRONTMATTER, preserveNewlines)
			// 移除代码块（保留换行符）
			.replace(this.reCodeBlock, preserveNewlines)
			.replace(this.reInlineCode, '')
			// 移除标题 # 符号
			.replace(this.reHeading, '')
			// 移除删除线符号 ~~text~~，保留内容
			.replace(this.reStrikethrough, '$1')
			// 移除粗体/斜体符号 ** * __ _
			.replace(this.reBold, '$2')
			.replace(this.reItalic, '$2')
			// 图片/嵌入资源必须在普通链接之前移除，避免 alt 或资源名被误计为正文
			.replace(this.reImage, '')
			.replace(this.reEmbeddedInternalLink, '')
			// 移除 Obsidian 内部链接语法 [[文件名]] → 文件名
			.replace(this.reInternalLink, (_: string, name: string, alias: string) => alias || name)
			// 移除普通链接 [文本](url) → 文本
			.replace(this.reLink, '$1')
			// 移除脚注引用标记 [^note]
			.replace(this.reFootnoteRef, '')
			// 移除 HTML 标签（保留换行符）
			.replace(this.reHtmlTag, preserveNewlines)
			// 移除引用符号 >
			.replace(REGEX_PATTERNS.QUOTE, '')
			// 移除分隔线
			.replace(REGEX_PATTERNS.SEPARATOR, preserveNewlines)
			// 移除表格分隔行 |---|---|
			.replace(REGEX_PATTERNS.TABLE_SEPARATOR, '')
			// 移除任务列表标记 - [ ] / - [x]
			.replace(REGEX_PATTERNS.TASK_LIST, '')
			// 移除无序列表符号 - * +
			.replace(REGEX_PATTERNS.UNORDERED_LIST, '')
			// 移除有序列表符号 1.
			.replace(REGEX_PATTERNS.ORDERED_LIST, '');
	}

	/**
	 * 计算准确字数
	 * 清理所有 Markdown 语法标记，只保留纯文本内容
	 * 
	 * @param text - 原始 Markdown 文本
	 * @param method - 统计算法
	 * @returns 纯文本字符数
	 */
	calculateAccurateWords(text: string, method: 'webnovel' | 'standard' | 'obsidian' = 'webnovel'): number {
		const cleaned = this.getCleanedText(text);

		// 1. 网文模式：移除空白字符后，所有字符均算1个字（含中英数字和标点）
		if (method === 'webnovel') {
			return cleaned.replace(this.reWhitespace, '').length;
		}

		// 2 & 3. 中文精确模式 / Obsidian 原生模式
		let count = 0;
		// 统计中日韩字符
		const cjkMatches = cleaned.match(this.reCjkChar);
		if (cjkMatches) count += cjkMatches.length;

		// 统计英文单词和数字组合
		const nonCjk = cleaned.replace(this.reCjkChar, ' ');
		this.reCjkChar.lastIndex = 0; // replace 后重置
		const wordMatches = nonCjk.match(this.reWordToken);
		if (wordMatches) count += wordMatches.length;

		// 仅在“标准模式”下统计全角标点
		if (method === 'standard') {
			const punctuationMatches = cleaned.match(this.reFullwidthPunct);
			if (punctuationMatches) count += punctuationMatches.length;
		}

		return count;
	}

	/**
	 * 计算逐行的字数分布（保证总数与 calculateAccurateWords 绝对一致）
	 * 
	 * @param text - 原始 Markdown 文本
	 * @param method - 统计算法
	 * @returns 每一行的字数数组
	 */
	calculateWordsPerLine(text: string, method: 'webnovel' | 'standard' | 'obsidian' = 'webnovel'): number[] {
		const cleaned = this.getCleanedText(text);
		const lines = cleaned.split('\n');

		return lines.map(line => {
			if (!line) return 0;
			
			if (method === 'webnovel') {
				return line.replace(/\s+/g, '').length;
			}
			
			let count = 0;
			// 统计中日韩字符
			// 这里不重置 global regex，因为我们使用 match，或者我们在 match 内部处理？
			// 注意：避免使用全局状态导致 bug，所以每次手动新建局部正则或不带 g。
			// Wait, reCjkChar uses /g, which has state if used with exec.
			// string.match(/.../g) ignores lastIndex and returns all matches.
			const cjkMatches = line.match(this.reCjkChar);
			if (cjkMatches) count += cjkMatches.length;
			
			const nonCjk = line.replace(this.reCjkChar, ' ');
			
			const wordMatches = nonCjk.match(this.reWordToken);
			if (wordMatches) count += wordMatches.length;
			
			if (method === 'standard') {
				const punctMatches = nonCjk.match(this.reFullwidthPunct);
				if (punctMatches) count += punctMatches.length;
			}
			
			return count;
		});
	}
}
