import { REGEX_PATTERNS } from '../constants';
import { cleanForWordCount } from '../utils/markdownCleaner';

/**
 * 字数计算服务
 * 负责准确计算 Markdown 文本的字数（清理所有 Markdown 语法后）
 */
export class WordCounter {
	private readonly reWhitespace = REGEX_PATTERNS.WHITESPACE();
	private readonly reCjkChar = REGEX_PATTERNS.CJK_CHAR();
	private readonly reWordToken = REGEX_PATTERNS.WORD_TOKEN();
	private readonly reFullwidthPunct = REGEX_PATTERNS.FULLWIDTH_PUNCT();
	private lastCleaned: { text: string; includeFootnotes: boolean; cleaned: string } | null = null;
	private lastCount: { text: string; method: string; includeFootnotes: boolean; count: number } | null = null;

	private getCleanedText(text: string, includeFootnotes: boolean): string {
		if (this.lastCleaned?.text === text && this.lastCleaned.includeFootnotes === includeFootnotes) {
			return this.lastCleaned.cleaned;
		}
		const cleaned = cleanForWordCount(text, { includeFootnotes });
		this.lastCleaned = { text, includeFootnotes, cleaned };
		return cleaned;
	}

	/**
	 * 计算准确字数
	 * 清理所有 Markdown 语法标记，只保留纯文本内容
	 * 
	 * @param text - 原始 Markdown 文本
	 * @param method - 统计算法
	 * @param includeFootnotes - 是否包含脚注（默认 false）
	 * @returns 纯文本字符数
	 */
	calculateAccurateWords(text: string, method: 'webnovel' | 'standard' | 'obsidian' = 'webnovel', includeFootnotes: boolean = false): number {
		if (this.lastCount?.text === text && this.lastCount.method === method && this.lastCount.includeFootnotes === includeFootnotes) {
			return this.lastCount.count;
		}
		const count = this.countCleanedText(this.getCleanedText(text, includeFootnotes), method);
		this.lastCount = { text, method, includeFootnotes, count };
		return count;
	}

	private countCleanedText(cleaned: string, method: 'webnovel' | 'standard' | 'obsidian'): number {
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
	 * @param includeFootnotes - 是否包含脚注（默认 false）
	 * @returns 每一行的字数数组
	 */
	calculateWordsPerLine(text: string, method: 'webnovel' | 'standard' | 'obsidian' = 'webnovel', includeFootnotes: boolean = false): number[] {
		const cleaned = this.getCleanedText(text, includeFootnotes);
		const lines = cleaned.split('\n');

		return lines.map(line => {
			if (!line) return 0;
			
			if (method === 'webnovel') {
				return line.replace(/\s+/g, '').length;
			}
			
			let count = 0;
			// 统计中日韩字符
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
