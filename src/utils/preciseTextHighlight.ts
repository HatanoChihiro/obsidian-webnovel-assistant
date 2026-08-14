/**
 * 渲染正文精准高亮与定位工具函数 (Precise Text Highlight)
 * 支持 Reading View 阅读模式词句级精准高亮与章节合并预览修订持久单选高亮
 */

import { Logger } from './Logger';

export interface TextNodeRange {
	nodeIndex: number;
	startOffset: number;
	endOffset: number;
}

export interface TextMatchOptions {
	preferredCharOffset?: number;
	contextPrefix?: string;
	contextSuffix?: string;
	occurrenceIndex?: number;
	relativeProgress?: number;
}

interface HighlightTracker {
	cleanup: () => void;
}

const highlightTrackers = new WeakMap<Element, HighlightTracker>();

function normalizeSnippet(str: string): string {
	return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

function computeCommonSuffix(a: string, b: string): number {
	let len = 0;
	const maxLen = Math.min(a.length, b.length);
	while (len < maxLen && a[a.length - 1 - len] === b[b.length - 1 - len]) {
		len++;
	}
	return len;
}

function computeCommonPrefix(a: string, b: string): number {
	let len = 0;
	const maxLen = Math.min(a.length, b.length);
	while (len < maxLen && a[len] === b[len]) {
		len++;
	}
	return len;
}

/**
 * 在多个连续文本节点中，跨软换行与空白折叠精确定位搜索词的节点字符偏移区间
 * 支持结合上下文片段、命中次序号及相对进度进行多维度精确仲裁
 */
export function findNormalizedTextRanges(
	texts: string[],
	searchText: string,
	optionsOrOffset?: number | TextMatchOptions
): TextNodeRange[] {
	const options: TextMatchOptions = typeof optionsOrOffset === 'number'
		? { preferredCharOffset: optionsOrOffset }
		: (optionsOrOffset ?? {});

	const normalizedChars: string[] = [];
	const sourceRanges: TextNodeRange[] = [];
	let inWhitespace = false;
	let currentWsRange: TextNodeRange | null = null;

	texts.forEach((text, nodeIndex) => {
		for (let offset = 0; offset < text.length; offset++) {
			if (/\s/.test(text[offset])) {
				if (!inWhitespace) {
					inWhitespace = true;
					currentWsRange = { nodeIndex, startOffset: offset, endOffset: offset + 1 };
					normalizedChars.push(' ');
					sourceRanges.push(currentWsRange);
				} else if (currentWsRange && currentWsRange.nodeIndex === nodeIndex) {
					currentWsRange.endOffset = offset + 1;
				}
				continue;
			}

			inWhitespace = false;
			currentWsRange = null;
			normalizedChars.push(text[offset]);
			sourceRanges.push({ nodeIndex, startOffset: offset, endOffset: offset + 1 });
		}
	});

	const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
	if (!normalizedSearch) return [];

	const haystack = normalizedChars.join('').toLowerCase();
	const allMatches: number[] = [];
	let idx = haystack.indexOf(normalizedSearch);
	while (idx >= 0) {
		allMatches.push(idx);
		idx = haystack.indexOf(normalizedSearch, idx + 1);
	}

	if (allMatches.length === 0) {
		return [];
	}

	let bestIndex = allMatches[0];
	if (allMatches.length > 1) {
		let maxScore = Number.NEGATIVE_INFINITY;
		const normTargetPrefix = options.contextPrefix ? normalizeSnippet(options.contextPrefix) : '';
		const normTargetSuffix = options.contextSuffix ? normalizeSnippet(options.contextSuffix) : '';

		for (let i = 0; i < allMatches.length; i++) {
			const candPos = allMatches[i];
			let score = 0;

			// 1. 上下文重合度评分 (最高权重)
			if (normTargetPrefix || normTargetSuffix) {
				const candPrefix = haystack.substring(Math.max(0, candPos - 40), candPos);
				const candSuffix = haystack.substring(candPos + normalizedSearch.length, Math.min(haystack.length, candPos + normalizedSearch.length + 40));
				const normCandPrefix = normalizeSnippet(candPrefix);
				const normCandSuffix = normalizeSnippet(candSuffix);

				const prefixMatchLen = normTargetPrefix ? computeCommonSuffix(normCandPrefix, normTargetPrefix) : 0;
				const suffixMatchLen = normTargetSuffix ? computeCommonPrefix(normCandSuffix, normTargetSuffix) : 0;

				score += (prefixMatchLen + suffixMatchLen) * 10;
			}

			// 2. 同名词句次序号评分 (高权重)
			if (options.occurrenceIndex !== undefined) {
				const indexDiff = Math.abs(i - options.occurrenceIndex);
				if (indexDiff === 0) {
					score += 50;
				} else {
					score -= indexDiff * 10;
				}
			}

			// 3. 正文进度比率评分
			if (options.relativeProgress !== undefined && haystack.length > 0) {
				const domProgress = candPos / haystack.length;
				const progressDiff = Math.abs(domProgress - options.relativeProgress);
				score += Math.max(0, (1 - progressDiff) * 20);
			}

			// 4. 原始偏移量保底（仅在无其他特征时作为辅助）
			if (options.preferredCharOffset !== undefined && options.occurrenceIndex === undefined && !normTargetPrefix && !normTargetSuffix) {
				const distance = Math.abs(candPos - options.preferredCharOffset);
				score -= distance * 0.01;
			}

			if (score > maxScore) {
				maxScore = score;
				bestIndex = candPos;
			}
		}
	}

	Logger.info('[WebNovel-Debug] [preciseTextHighlight] findNormalizedTextRanges 匹配详情:', {
		searchText,
		normalizedSearch,
		options,
		haystackLength: haystack.length,
		allMatches,
		bestIndex
	});

	const matchedRanges = sourceRanges.slice(bestIndex, bestIndex + normalizedSearch.length);
	const rangesByNode = new Map<number, TextNodeRange>();
	for (const range of matchedRanges) {
		const current = rangesByNode.get(range.nodeIndex);
		if (current) {
			current.startOffset = Math.min(current.startOffset, range.startOffset);
			current.endOffset = Math.max(current.endOffset, range.endOffset);
		} else {
			rangesByNode.set(range.nodeIndex, {
				nodeIndex: range.nodeIndex,
				startOffset: range.startOffset,
				endOffset: range.endOffset
			});
		}
	}

	return Array.from(rangesByNode.values());
}

/**
 * 纯逻辑：在可用渲染块起始行号列表中选取最接近 targetLine 的段落起始行
 */
export function findNearestBlockLine(lineNumbers: number[], targetLine: number): number | null {
	let closest: number | null = null;
	for (const line of lineNumbers) {
		if (line <= targetLine && (closest === null || line > closest)) {
			closest = line;
		}
	}
	return closest;
}

/**
 * 在阅读视图容器中寻找对应源码行号的渲染块（data-line <= targetLine 的最大起始行元素）
 */
export function getTargetRenderedBlock(container: Element, targetLine: number): Element | null {
	let target: Element | null = null;
	let closestLine = -1;
	const elements = container.querySelectorAll<HTMLElement>('[data-line]');
	for (let i = 0; i < elements.length; i++) {
		const el = elements[i];
		const attr = el.getAttribute('data-line') ?? el.dataset.line;
		if (!attr) continue;
		const line = Number.parseInt(attr, 10);
		if (Number.isNaN(line) || line > targetLine || line < closestLine) continue;
		closestLine = line;
		target = el;
	}
	return target;
}

/**
 * 清除容器内本插件创建的高亮 span 并恢复 Text 节点结构
 */
export function clearReadingViewHighlight(container: Element): void {
	const highlights = container.querySelectorAll('.wn-exact-highlight');
	for (let i = 0; i < highlights.length; i++) {
		const el = highlights[i];
		const parent = el.parentNode;
		if (parent) {
			while (el.firstChild) {
				parent.insertBefore(el.firstChild, el);
			}
			parent.removeChild(el);
			parent.normalize();
		}
	}
}

/**
 * 取消并清理容器当前的高亮状态
 */
export function cancelHighlightTracker(container: Element): void {
	const tracker = highlightTrackers.get(container);
	if (tracker) {
		tracker.cleanup();
		highlightTrackers.delete(container);
	}
}

/**
 * 将匹配文本节点切分并包裹在 .wn-exact-highlight.is-flashing 临时 span 中
 * 自动排除属性/Frontmatter 元数据容器中的节点
 */
export function wrapTextNodes(
	doc: Document,
	container: Element,
	searchTexts: string[],
	optionsOrOffset?: number | TextMatchOptions
): boolean {
	const win = doc.defaultView;
	if (!win || !win.NodeFilter) return false;

	const filter: NodeFilter = {
		acceptNode(node: Node): number {
			const parent = (node.nodeType === 3 ? node.parentElement : node) as HTMLElement | null;
			if (parent && typeof parent.closest === 'function' && parent.closest('.metadata-container, .mod-frontmatter, .frontmatter-container, .metadata-properties')) {
				return win.NodeFilter.FILTER_REJECT;
			}
			return win.NodeFilter.FILTER_ACCEPT;
		}
	};

	const walker = doc.createTreeWalker(container, win.NodeFilter.SHOW_TEXT, filter);
	const textNodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		if (node.nodeType === 3) {
			textNodes.push(node as Text);
		}
		node = walker.nextNode();
	}

	let ranges: TextNodeRange[] = [];
	for (const searchText of searchTexts) {
		if (!searchText) continue;
		ranges = findNormalizedTextRanges(
			textNodes.map(tn => tn.data),
			searchText,
			optionsOrOffset
		);
		if (ranges.length > 0) break;
	}
	if (ranges.length === 0) return false;

	const sortedRanges = ranges.slice().sort((a, b) => b.nodeIndex - a.nodeIndex);
	for (const { nodeIndex, startOffset, endOffset } of sortedRanges) {
		const nodeToWrap = textNodes[nodeIndex];
		if (!nodeToWrap?.parentNode) continue;

		let targetNode: Text = nodeToWrap;
		if (startOffset > 0) {
			targetNode = targetNode.splitText(startOffset);
		}
		const length = endOffset - startOffset;
		if (length < targetNode.length) {
			targetNode.splitText(length);
		}
		const parent = targetNode.parentElement;
		if (!parent) continue;

		const span = parent.createSpan({ cls: 'wn-exact-highlight' });
		parent.insertBefore(span, targetNode);
		span.appendChild(targetNode);
	}

	return container.querySelector('.wn-exact-highlight') !== null;
}

/**
 * 章节合并预览：已渲染目标元素的持久单选高亮定位
 */
export function highlightPersistentTarget(container: Element, targetEl: HTMLElement): boolean {
	const win = targetEl.ownerDocument?.defaultView;
	if (!win) return false;

	cancelHighlightTracker(container);
	targetEl.classList.add('is-flashing');
	targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

	highlightTrackers.set(container, {
		cleanup: () => targetEl.classList.remove('is-flashing')
	});
	return true;
}

/**
 * 阅读模式：精确查找并高亮词句（保持高亮直到下一次跳转）
 * 直接等待目标渲染块出现，并在其内精确包裹，无需等待原生整段闪烁
 */
export function highlightReadingViewPhrase(
	container: Element,
	targetLine: number,
	searchTexts: string[],
	optionsOrOffset?: number | TextMatchOptions,
	preferredLineOffset?: number
): boolean {
	const doc = container.ownerDocument;
	const win = doc?.defaultView;
	if (!win || !win.NodeFilter) return false;

	cancelHighlightTracker(container);

	let success = false;
	const targetBlock = getTargetRenderedBlock(container, targetLine);
	if (targetBlock) {
		success = wrapTextNodes(doc, targetBlock, searchTexts, preferredLineOffset);
	}
	if (!success) {
		success = wrapTextNodes(doc, container, searchTexts, optionsOrOffset);
	}
	if (!success) return false;

	const exactSpan = container.querySelector('.wn-exact-highlight');
	if (exactSpan) {
		exactSpan.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
	}

	highlightTrackers.set(container, {
		cleanup: () => clearReadingViewHighlight(container)
	});

	return true;
}
