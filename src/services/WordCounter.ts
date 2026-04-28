import { REGEX_PATTERNS } from '../constants';

/**
 * 字数计算服务
 * 负责准确计算 Markdown 文本的字数（清理所有 Markdown 语法后）
 */
export class WordCounter {
	/**
	 * 计算准确字数
	 * 清理所有 Markdown 语法标记，只保留纯文本内容
	 * 
	 * @param text - 原始 Markdown 文本
	 * @returns 纯文本字符数
	 */
	calculateAccurateWords(text: string): number {
		// 清理 Markdown 语法标记，只保留纯文本内容（用于计数）
		// 使用 constants.ts 中预定义的正则表达式（性能优化）
		let cleaned = text
			// 移除 frontmatter
			.replace(REGEX_PATTERNS.FRONTMATTER, '')
			// 移除代码块（调用工厂函数）
			.replace(REGEX_PATTERNS.CODE_BLOCK(), '')
			.replace(REGEX_PATTERNS.INLINE_CODE(), '')
			// 移除标题 # 符号
			.replace(REGEX_PATTERNS.HEADING, '')
			// 移除粗体/斜体符号 ** * __ _（调用工厂函数）
			.replace(REGEX_PATTERNS.BOLD(), '$2')
			.replace(REGEX_PATTERNS.ITALIC(), '$2')
			// 移除 Obsidian 内部链接语法 [[文件名]] → 文件名（调用工厂函数）
			.replace(REGEX_PATTERNS.INTERNAL_LINK(), (_, name, alias) => alias || name)
			// 移除普通链接 [文本](url) → 文本（调用工厂函数）
			.replace(REGEX_PATTERNS.LINK(), '$1')
			// 移除图片 ![alt](url)（调用工厂函数）
			.replace(REGEX_PATTERNS.IMAGE(), '')
			// 移除 HTML 标签（调用工厂函数）
			.replace(REGEX_PATTERNS.HTML_TAG(), '')
			// 移除引用符号 >
			.replace(REGEX_PATTERNS.QUOTE, '')
			// 移除分隔线
			.replace(REGEX_PATTERNS.SEPARATOR, '')
			// 移除无序列表符号 - * +
			.replace(REGEX_PATTERNS.UNORDERED_LIST, '')
			// 移除有序列表符号 1.
			.replace(REGEX_PATTERNS.ORDERED_LIST, '')
			// 移除空白字符（调用工厂函数）
			.replace(REGEX_PATTERNS.WHITESPACE(), '');
		
		return cleaned.length;
	}
}
