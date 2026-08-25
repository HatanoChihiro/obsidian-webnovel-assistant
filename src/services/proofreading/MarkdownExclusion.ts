/**
 * Markdown 语法元素排除工具
 *
 * 用于在校对扫描时精确排除非正文区域：
 * - YAML frontmatter
 * - 围栏代码块 (fenced code blocks) 与行内代码 (`code`)
 * - HTML 标签与注释
 * - 嵌入路径（图片、附件等）
 * - 链接目标路径（保留链接可见文字进行检测）
 */

export interface ExcludedRange {
	start: number;
	end: number;
}

/**
 * 提取文本中所有需要排除扫描的 UTF-16 区间
 */
export function extractMarkdownExclusions(text: string): Array<[number, number]> {
	if (!text) return [];

	const rawIntervals: Array<[number, number]> = [];

	// 1. YAML Frontmatter（仅在文档开头）
	const fmMatch = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
	if (fmMatch) {
		rawIntervals.push([0, fmMatch[0].length]);
	}

	// 2. 围栏代码块 (``` 或 ~~~)
	const codeBlockRegex = /(```|~~~)[^\n]*\r?\n[\s\S]*?\r?\n\1/g;
	let match: RegExpExecArray | null;
	while ((match = codeBlockRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	// 3. 行内代码 (`...`)
	const inlineCodeRegex = /`[^`\r\n]+`/g;
	while ((match = inlineCodeRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	// 4. HTML 注释与特殊块
	const htmlCommentRegex = /<!--[\s\S]*?-->/g;
	while ((match = htmlCommentRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}
	const htmlScriptStyleRegex = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
	while ((match = htmlScriptStyleRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}
	const htmlTagRegex = /<[a-zA-Z/][^>]*>/g;
	while ((match = htmlTagRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	// 5. 嵌入资源与链接
	// 5.1 Obsidian 嵌入 resource: ![[...]] -> 全部排除
	const obsidianEmbedRegex = /!\[\[[\s\S]*?\]\]/g;
	while ((match = obsidianEmbedRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	// 5.2 Markdown 嵌入图片: ![alt](url) -> 全部排除
	const mdImageRegex = /!\[[^\]]*\]\([^)]*\)/g;
	while ((match = mdImageRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	// 5.3 Obsidian 内部链接: [[target|visible]] 或 [[target]]
	const obsidianLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
	while ((match = obsidianLinkRegex.exec(text)) !== null) {
		const fullMatch = match[0];
		const target = match[1];
		const alias = match[2];
		const matchStart = match.index;

		if (alias !== undefined) {
			// [[target|visible]]
			// 排除 [[target|
			const prefixLen = 2 + target.length + 1; // "[[" + target + "|"
			rawIntervals.push([matchStart, matchStart + prefixLen]);
			// visible 区域为 [matchStart + prefixLen, matchStart + prefixLen + alias.length]，保留检测
			// 排除 ]]
			const suffixStart = matchStart + prefixLen + alias.length;
			rawIntervals.push([suffixStart, matchStart + fullMatch.length]);
		} else {
			// [[target]] 无别名，target 本身是文件/链接目标，全部排除
			rawIntervals.push([matchStart, matchStart + fullMatch.length]);
		}
	}

	// 5.4 Markdown 链接: [visible](url)
	const mdLinkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
	while ((match = mdLinkRegex.exec(text)) !== null) {
		const visibleText = match[1];
		const matchStart = match.index;
		const fullLen = match[0].length;

		// 排除前导 "["
		rawIntervals.push([matchStart, matchStart + 1]);
		// visibleText 区域保留 [matchStart + 1, matchStart + 1 + visibleText.length]
		// 排除 "](url)"
		const urlPartStart = matchStart + 1 + visibleText.length;
		rawIntervals.push([urlPartStart, matchStart + fullLen]);
	}

	// 5.5 Markdown 引用链接定义: [ref]: url
	const refDefRegex = /^[ \t]*\[[^\]]+\]:\s*.*$/gm;
	while ((match = refDefRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	// 5.6 脚注标记: [^1] 或 [^1]:
	const footnoteRegex = /\[\^[^\]]+\]:?/g;
	while ((match = footnoteRegex.exec(text)) !== null) {
		rawIntervals.push([match.index, match.index + match[0].length]);
	}

	return mergeIntervals(rawIntervals);
}

/**
 * 合并重叠或相邻的区间
 */
export function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
	if (intervals.length <= 1) return intervals;

	// 按起始偏移量排序
	intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	const merged: Array<[number, number]> = [intervals[0]];

	for (let i = 1; i < intervals.length; i++) {
		const current = intervals[i];
		const last = merged[merged.length - 1];

		if (current[0] <= last[1]) {
			// 重叠或相邻，扩展右边界
			last[1] = Math.max(last[1], current[1]);
		} else {
			merged.push(current);
		}
	}

	return merged;
}

/**
 * 检查指定 [from, to] 区间是否与排除区间重叠
 */
export function isRangeExcluded(
	from: number,
	to: number,
	excludedIntervals: Array<[number, number]>
): boolean {
	if (!excludedIntervals || excludedIntervals.length === 0) return false;

	// 使用二分查找快速定位
	let low = 0;
	let high = excludedIntervals.length - 1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const [start, end] = excludedIntervals[mid];

		if (from < end && to > start) {
			// 存在交集
			return true;
		}

		if (to <= start) {
			high = mid - 1;
		} else {
			low = mid + 1;
		}
	}

	return false;
}
