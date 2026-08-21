import type { App, OpenViewState, TFile, WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { highlightReadingViewPhrase } from './preciseTextHighlight';
import { Logger } from './Logger';

/**
 * 延迟一帧/Tick 揭示并激活 WorkspaceLeaf，确保在 DOM 点击事件或异步渲染完成后正确获取 focus 焦点
 */
export function revealAndFocusLeaf(app: App, leaf: WorkspaceLeaf): void {
	const win = leaf.view?.containerEl?.ownerDocument?.defaultView;
	const doFocus = () => {
		try {
			void app.workspace.revealLeaf(leaf);
			void app.workspace.setActiveLeaf(leaf, { focus: true });
		} catch (e) {
			console.warn('[WebNovel Assistant] 激活 Leaf 失败:', e);
		}
	};

	if (win) {
		win.setTimeout(doFocus, 0);
	} else {
		doFocus();
	}
}

/**
 * 判断 WorkspaceLeaf 是否处于锁定（Pinned）状态
 */
export function isLeafPinned(leaf: WorkspaceLeaf | null | undefined): boolean {
	if (!leaf) return false;
	const viewState = leaf.getViewState?.();
	if (viewState?.pinned) return true;
	const leafObj = leaf as unknown as { pinned?: boolean; isPinned?: () => boolean };
	if (typeof leafObj.isPinned === 'function') {
		return Boolean(leafObj.isPinned());
	}
	return Boolean(leafObj.pinned);
}

/**
 * 判断某个 Leaf 是否是插件专属的自定义面板（非纯 Markdown 编辑器/空白页），避免跳转时被当作常规编辑器误覆盖
 */
export function isCustomPluginLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
	if (!leaf || !leaf.view) return false;
	if (leaf.view instanceof MarkdownView) return false;
	const viewType = leaf.view.getViewType?.();
	if (!viewType || viewType === 'empty' || viewType === 'markdown') return false;
	return true;
}

export interface NavigationLeafOptions {
	preferredLeaf?: WorkspaceLeaf;
	sourceLeaf?: WorkspaceLeaf;
	splitIfNew?: boolean;
}

/**
 * 智能解析用于打开指定文件的目标 WorkspaceLeaf：
 * 1. 优先复用 preferredLeaf（若未锁定且非自定义插件面板，或已经打开了目标文件）；
 * 2. 检查全局是否已在任意 Markdown Leaf 中打开了该文件（即使锁定亦可直接复用聚焦）；
 * 3. 若未打开：
 *    - 若源 Leaf 位于主编辑区（Root Area）：
 *      - 检查是否存在其它分屏容器（leaf.parent !== sourceLeaf.parent）；
 *      - 若存在分屏容器，寻找其中未锁定、非插件界面的 Markdown/Empty Leaf 进行覆盖复用；
 *      - 若分屏容器中全为锁定标签页（或不存在其它分屏容器），自动创建垂直分屏打开（保留当前主页/工作台/文档）；
 *    - 若源 Leaf 位于侧边栏/Modal：
 *      - 在主编辑区中寻找未锁定、非插件界面的 Markdown/Empty Leaf；
 *      - 若主编辑区仅有工作台/主页或全为锁定标签页，自动创建垂直分屏打开。
 */
/**
 * 判断一个 Markdown 文件是否为小说元数据/大纲设定辅助文件（如伏笔、时间线、创作主页、便签或设定文件）
 */
export function isNovelMetadataFile(file: TFile | null | undefined): boolean {
	if (!file) return false;
	const path = (file.path || '').toLowerCase().replace(/\\/g, '/');
	const filename = path.split('/').pop() || '';
	const name = (file.name || filename).toLowerCase();
	const basename = (file.basename || filename.replace(/\.[^/.]+$/, '')).toLowerCase();

	// 伏笔文件
	if (name === 'foreshadowing.md' || basename === '伏笔' || basename === 'foreshadowing') return true;
	// 时间线文件
	if (name === 'timeline.md' || basename === '时间线' || basename === 'timeline') return true;
	// 创作主页
	if (name === 'homepage.md' || basename === '创作主页' || basename === 'homepage') return true;
	// 便签
	if (name === 'sticky_notes.md' || basename === '便签' || basename === 'sticky_notes') return true;

	// 设定文件与目录（/设定/ 或 /lore/ 或 设定.md）
	if (path.includes('/lore/') || path.includes('/设定/') || path.startsWith('lore/') || path.startsWith('设定/')) return true;
	if (basename === '设定' || basename === 'lore' || basename === '角色' || basename === 'characters') return true;

	return false;
}

/**
 * 判断一个 Leaf 是否为普通未锁定的正文章节 Leaf（且当前未展示元数据辅助文件）
 */
export function isUnpinnedChapterLeaf(leaf: WorkspaceLeaf): boolean {
	if (isLeafPinned(leaf) || isCustomPluginLeaf(leaf)) return false;
	if (leaf.view?.getViewType?.() === 'empty') return true;
	if (leaf.view instanceof MarkdownView) {
		const currentFile = leaf.view.file;
		return !currentFile || !isNovelMetadataFile(currentFile);
	}
	return false;
}

/**
 * 判断一个 Leaf 是否为元数据文件/插件面板 Leaf（当前打开了伏笔、时间线、主页等辅助文件或插件视图）
 */
export function isMetadataLeaf(leaf: WorkspaceLeaf): boolean {
	if (isCustomPluginLeaf(leaf)) return true;
	if (leaf.view instanceof MarkdownView) {
		const currentFile = leaf.view.file;
		return Boolean(currentFile && isNovelMetadataFile(currentFile));
	}
	return false;
}

/**
 * 智能解析用于打开指定文件的目标 WorkspaceLeaf：
 * 1. 优先复用 preferredLeaf（若未锁定且非自定义插件面板，或已经打开了目标文件）；
 * 2. 检查全局是否已在任意 Markdown Leaf 中打开了该文件（即使锁定亦可直接复用聚焦）；
 * 3. 若未打开：
 *    - 区分正文章节文件与小说元数据文件（伏笔、时间线、设定、主页等）；
 *    - 点击正文章节时，永远优先复用未锁定的正文章节窗口，绝对不覆盖正在展示伏笔/时间线/设定的窗口；
 *    - 若主屏仅有伏笔/时间线文件或工作台，自动创建新垂直分屏并列展示，互不干扰。
 */
export function getLeafForFileNavigation(
	app: App,
	file: TFile,
	options?: NavigationLeafOptions
): WorkspaceLeaf {
	const markdownLeaves = app.workspace.getLeavesOfType('markdown');

	// 1. 若显式指定了 preferredLeaf，且该 Leaf 已经显示目标文件或处于未锁定且可复用状态
	if (options?.preferredLeaf) {
		const pref = options.preferredLeaf;
		const isSameFile = pref.view instanceof MarkdownView && pref.view.file?.path === file.path;
		if (isSameFile || (!isLeafPinned(pref) && !isCustomPluginLeaf(pref))) {
			return pref;
		}
	}

	// 2. 检查全局是否已有 Markdown Leaf 打开了该目标文件（已打开时直接聚焦该 Leaf）
	for (const leaf of markdownLeaves) {
		if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
			return leaf;
		}
	}

	// 3. 收集主编辑区全部 Root Leaves
	const rootLeaves: WorkspaceLeaf[] = [];
	if (typeof app.workspace.iterateRootLeaves === 'function') {
		app.workspace.iterateRootLeaves((leaf) => {
			rootLeaves.push(leaf);
		});
	}

	const isTargetMetadata = isNovelMetadataFile(file);
	const sourceLeaf = options?.sourceLeaf ?? (app.workspace.getMostRecentLeaf() || undefined);
	const isSourceInRoot = Boolean(sourceLeaf && rootLeaves.includes(sourceLeaf));

	// 若源 Leaf 位于主编辑区（Root Area）：
	if (isSourceInRoot && sourceLeaf) {
		// 如果源 Leaf 是自定义插件界面（工作台/主页/图谱等）或处于锁定（Pinned）状态，避让保护
		if (isCustomPluginLeaf(sourceLeaf) || isLeafPinned(sourceLeaf)) {
			const sourceParent = (sourceLeaf as unknown as { parent?: unknown }).parent;
			// 寻找属于其它分屏容器的 Leaves
			const otherSplitLeaves = rootLeaves.filter(
				(l) => (l as unknown as { parent?: unknown }).parent !== sourceParent
			);

			if (otherSplitLeaves.length > 0) {
				// 若目标是章节：在其它分屏中优先寻找未锁定的章节 Leaf 进行覆盖复用
				if (!isTargetMetadata) {
					const reusableChapterLeaf = otherSplitLeaves.find((l) => isUnpinnedChapterLeaf(l));
					if (reusableChapterLeaf) {
						return reusableChapterLeaf;
					}
				} else {
					const reusableSplitLeaf = otherSplitLeaves.find(
						(l) => !isLeafPinned(l) && !isCustomPluginLeaf(l) && (l.view instanceof MarkdownView || l.view?.getViewType?.() === 'empty')
					);
					if (reusableSplitLeaf) {
						return reusableSplitLeaf;
					}
				}
				// 若其它分屏存在但不可复用，创建新垂直分屏
				return app.workspace.getLeaf('split', 'vertical');
			}

			// 单屏状态（不存在其它分屏）：自动创建垂直分屏，保护当前工作台/主页
			return app.workspace.getLeaf('split', 'vertical');
		}

		// 若源 Leaf 当前正在展示伏笔/时间线等元数据辅助文件，而目标是正文章节：
		// 绝对不覆盖当前元数据窗口，寻找其它分屏中的正文窗口或开新分屏并列展示
		if (isMetadataLeaf(sourceLeaf) && !isTargetMetadata) {
			const sourceParent = (sourceLeaf as unknown as { parent?: unknown }).parent;
			const otherSplitLeaves = rootLeaves.filter(
				(l) => (l as unknown as { parent?: unknown }).parent !== sourceParent
			);
			const reusableChapterLeaf = otherSplitLeaves.find((l) => isUnpinnedChapterLeaf(l));
			if (reusableChapterLeaf) {
				return reusableChapterLeaf;
			}
			return app.workspace.getLeaf('split', 'vertical');
		}

		// 源 Leaf 是普通未锁定的 Markdown 编辑器
		if (options?.splitIfNew) {
			const sourceParent = (sourceLeaf as unknown as { parent?: unknown }).parent;
			const otherSplitLeaves = rootLeaves.filter(
				(l) => (l as unknown as { parent?: unknown }).parent !== sourceParent
			);
			const reusableSplitLeaf = otherSplitLeaves.find(
				(l) => !isLeafPinned(l) && !isCustomPluginLeaf(l) && (l.view instanceof MarkdownView || l.view?.getViewType?.() === 'empty')
			);
			if (reusableSplitLeaf) {
				return reusableSplitLeaf;
			}
			return app.workspace.getLeaf('split', 'vertical');
		}

		return sourceLeaf;
	}

	// 源 Leaf 不在主编辑区（来自侧边栏、Modal 或外部）：
	// 4. 侧边栏/外部调用时的决策：
	if (options?.splitIfNew || isTargetMetadata) {
		// 点击标题跳转伏笔/时间线文件，或显式要求 splitIfNew
		const emptyRootLeaf = rootLeaves.find(
			(l) => !isLeafPinned(l) && l.view?.getViewType?.() === 'empty'
		);
		if (emptyRootLeaf) {
			return emptyRootLeaf;
		}
		if (rootLeaves.length > 0) {
			return app.workspace.getLeaf('split', 'vertical');
		}
	} else {
		// 点击普通正文章节（非元数据文件）：
		// 优先复用当前活跃 / 最近使用的可用【章节窗口】（如果活跃窗口是伏笔/时间线等元数据文件，绝不覆盖它！）
		const mostRecent = app.workspace.getMostRecentLeaf();
		if (
			mostRecent &&
			rootLeaves.includes(mostRecent) &&
			isUnpinnedChapterLeaf(mostRecent)
		) {
			return mostRecent;
		}

		// 若当前活跃窗口不是章节窗口（如活跃窗口是伏笔/时间线文件或工作台），在主编辑区寻找其它未锁定的【章节窗口】进行复用
		const unpinnedChapterLeaf = rootLeaves.find((l) => isUnpinnedChapterLeaf(l));
		if (unpinnedChapterLeaf) {
			return unpinnedChapterLeaf;
		}

		// 若主编辑区全为工作台/元数据文件/锁定标签页（无可用普通正文章节编辑器），开启新垂直分屏打开章节
		if (rootLeaves.length > 0) {
			return app.workspace.getLeaf('split', 'vertical');
		}
	}

	return app.workspace.getLeaf(false);
}

/**
 * 在目标 WorkspaceLeaf 中打开文件，并确保焦点平滑且可靠地切换至该 Leaf
 * 自动拦截锁定（Pinned）Leaf 或自定义插件面板，避免破坏用户锁定布局与插件界面
 */
export async function openFileAndFocus(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	options?: OpenViewState
): Promise<void> {
	let targetLeaf = leaf;
	const isSameFile = targetLeaf.view instanceof MarkdownView && targetLeaf.view.file?.path === file.path;
	if (!isSameFile && (isLeafPinned(targetLeaf) || isCustomPluginLeaf(targetLeaf))) {
		targetLeaf = getLeafForFileNavigation(app, file, { sourceLeaf: leaf });
	}
	await targetLeaf.openFile(file, { active: true, ...options });
	revealAndFocusLeaf(app, targetLeaf);
}

export interface RangeLoc {
	line: number;
	ch: number;
}

export interface MatchState {
	targetLine: number;
	matchStartGlobal: number;
	matchEndGlobal: number;
	matchStartLoc: RangeLoc;
	matchEndLoc: RangeLoc;
	matchText: string;
	contextPrefix?: string;
	contextSuffix?: string;
	occurrenceIndex?: number;
}

export interface SmartLocateOptions {
	preferredLeaf?: WorkspaceLeaf;
	sourceLeaf?: WorkspaceLeaf;
	splitIfNew?: boolean;
	fallbackLine?: number;
	matchStartGlobal?: number;
	exactMatchState?: MatchState;
}

/**
 * 获取 Markdown 内容的正文起始偏移与起始行号（排除开头的 YAML Frontmatter）
 */
export function getMarkdownBodyRange(content: string): { startOffset: number; startLine: number } {
	const len = content.length;
	if (len === 0) {
		return { startOffset: 0, startLine: 0 };
	}

	let idx = content.charCodeAt(0) === 0xfeff ? 1 : 0;
	if (idx >= len) {
		return { startOffset: 0, startLine: 0 };
	}

	// 第一行必须以 --- 开头（允许前导空格，但整行去除首尾空格后必须为 ---）
	let firstLineStart = idx;
	while (firstLineStart < len && (content.charCodeAt(firstLineStart) === 32 || content.charCodeAt(firstLineStart) === 9)) {
		firstLineStart++;
	}
	if (firstLineStart + 3 > len || content.substring(firstLineStart, firstLineStart + 3) !== '---') {
		return { startOffset: 0, startLine: 0 };
	}
	idx = firstLineStart + 3;
	while (idx < len && content.charCodeAt(idx) !== 10 && content.charCodeAt(idx) !== 13) {
		const code = content.charCodeAt(idx);
		if (code !== 32 && code !== 9) {
			return { startOffset: 0, startLine: 0 };
		}
		idx++;
	}
	if (idx >= len) {
		return { startOffset: 0, startLine: 0 };
	}
	if (content.charCodeAt(idx) === 13) idx++;
	if (idx < len && content.charCodeAt(idx) === 10) idx++;

	let lineCount = 1;
	while (idx < len) {
		const lineStart = idx;
		while (idx < len && content.charCodeAt(idx) !== 10 && content.charCodeAt(idx) !== 13) {
			idx++;
		}
		const lineEnd = idx;
		if (idx < len && content.charCodeAt(idx) === 13) idx++;
		if (idx < len && content.charCodeAt(idx) === 10) idx++;

		let trimmedStart = lineStart;
		while (trimmedStart < lineEnd && (content.charCodeAt(trimmedStart) === 32 || content.charCodeAt(trimmedStart) === 9)) {
			trimmedStart++;
		}
		let trimmedEnd = lineEnd;
		while (trimmedEnd > trimmedStart && (content.charCodeAt(trimmedEnd - 1) === 32 || content.charCodeAt(trimmedEnd - 1) === 9)) {
			trimmedEnd--;
		}

		if (trimmedEnd - trimmedStart === 3) {
			const delim = content.substring(trimmedStart, trimmedEnd);
			if (delim === '---' || delim === '...') {
				return {
					startOffset: idx,
					startLine: lineCount + 1
				};
			}
		}
		lineCount++;
	}

	return { startOffset: 0, startLine: 0 };
}

/**
 * 高效计算匹配起止位置的行号与列号（0-based），避免对整个源文档或前置文本执行 split
 */
export function computeMatchLocation(
	content: string,
	matchStartGlobal: number,
	matchText: string
): {
	targetLine: number;
	matchStartLoc: RangeLoc;
	matchEndLoc: RangeLoc;
} {
	let targetLine = 0;
	let lastLineStart = 0;

	for (let i = 0; i < matchStartGlobal; i++) {
		if (content.charCodeAt(i) === 10) { // '\n'
			targetLine++;
			lastLineStart = i + 1;
		}
	}

	const matchStartLoc: RangeLoc = {
		line: targetLine,
		ch: matchStartGlobal - lastLineStart
	};

	let matchLineCount = 0;
	let lastMatchLineStart = 0;
	for (let i = 0; i < matchText.length; i++) {
		if (matchText.charCodeAt(i) === 10) { // '\n'
			matchLineCount++;
			lastMatchLineStart = i + 1;
		}
	}

	let matchEndLoc: RangeLoc;
	if (matchLineCount === 0) {
		matchEndLoc = {
			line: targetLine,
			ch: matchStartLoc.ch + matchText.length
		};
	} else {
		const lastLineLength = matchText.length - lastMatchLineStart;
		matchEndLoc = {
			line: targetLine + matchLineCount,
			ch: lastLineLength
		};
	}

	return { targetLine, matchStartLoc, matchEndLoc };
}

/**
 * 在源文本中按优先级查找匹配项，计算全局字符偏移量与精确行/列范围
 * 支持传入 preferredOffset 精准定位同文重复词句中的目标匹配项；未指定时默认取首个命中
 * 优先匹配正文区间，并提取上下文与次序信息
 */
export function findMatchState(
	content: string,
	searchTexts: (string | undefined)[],
	preferredOffset?: number
): MatchState | null {
	const bodyRange = getMarkdownBodyRange(content);
	const seenSearches = new Set<string>();

	for (const text of searchTexts) {
		if (!text) continue;
		const cleanSearch = text.trim();
		if (!cleanSearch) continue;
		const searchKey = cleanSearch.replace(/\s+/g, ' ').toLowerCase();
		if (seenSearches.has(searchKey)) continue;
		seenSearches.add(searchKey);

		const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const searchPattern = escapedSearch.replace(/\s+/g, '\\s+');

		const regex = new RegExp(searchPattern, 'gi');
		let match: RegExpExecArray | null = null;
		let bestMatch: { index: number; text: string; isBody: boolean } | null = null;
		let minDistance = Number.POSITIVE_INFINITY;
		let occurrenceCounter = 0;
		let bestOccurrence = 0;

		while ((match = regex.exec(content)) !== null) {
			const index = match.index;
			const isBody = index >= bodyRange.startOffset;
			if (isBody) {
				const currentOcc = occurrenceCounter++;
				const distance = preferredOffset !== undefined ? Math.abs(index - preferredOffset) : index;
				if (distance < minDistance || !bestMatch?.isBody) {
					minDistance = distance;
					bestMatch = { index, text: match[0], isBody: true };
					bestOccurrence = currentOcc;
				}
			} else if (!bestMatch) {
				bestMatch = { index, text: match[0], isBody: false };
			}
			if (preferredOffset === undefined && isBody) {
				break;
			}
			if (match[0].length === 0) {
				regex.lastIndex++;
			}
		}

		if (!bestMatch && cleanSearch.length > 20) {
			const shortSearch = cleanSearch
				.substring(0, 20)
				.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
				.replace(/\s+/g, '\\s+');
			const shortRegex = new RegExp(shortSearch, 'gi');
			occurrenceCounter = 0;
			while ((match = shortRegex.exec(content)) !== null) {
				const index = match.index;
				const isBody = index >= bodyRange.startOffset;
				if (isBody) {
					const currentOcc = occurrenceCounter++;
					const distance = preferredOffset !== undefined ? Math.abs(index - preferredOffset) : index;
					if (distance < minDistance || !bestMatch?.isBody) {
						minDistance = distance;
						bestMatch = { index, text: match[0], isBody: true };
						bestOccurrence = currentOcc;
					}
				} else if (!bestMatch) {
					bestMatch = { index, text: match[0], isBody: false };
				}
				if (preferredOffset === undefined && isBody) {
					break;
				}
				if (match[0].length === 0) {
					shortRegex.lastIndex++;
				}
			}
		}

		if (bestMatch) {
			const matchText = bestMatch.text;
			const matchStartGlobal = bestMatch.index;
			const matchEndGlobal = matchStartGlobal + matchText.length;

			const { targetLine, matchStartLoc, matchEndLoc } = computeMatchLocation(
				content,
				matchStartGlobal,
				matchText
			);

			const prefixStart = Math.max(bodyRange.startOffset, matchStartGlobal - 30);
			const contextPrefix = content.substring(prefixStart, matchStartGlobal).replace(/\r?\n/g, ' ');
			const contextSuffix = content.substring(matchEndGlobal, Math.min(content.length, matchEndGlobal + 30)).replace(/\r?\n/g, ' ');

			return {
				targetLine,
				matchStartGlobal,
				matchEndGlobal,
				matchStartLoc,
				matchEndLoc,
				matchText,
				contextPrefix,
				contextSuffix,
				occurrenceIndex: bestMatch.isBody ? bestOccurrence : undefined
			};
		}
	}
	return null;
}

/**
 * 构建符合 Obsidian 原生规范的 ephemeralState payload：
 * 命中时仅传递 cursor 与 match，不包含 line（避免触发整段整行背景闪烁）；
 * 未命中精准词句时，仅在调用方明确提供 fallbackLine 后降级为 line。
 */
export function buildEphemeralState(
	matchState: MatchState | null,
	fallbackLine?: number,
	content?: string
): Record<string, unknown> | null {
	if (matchState && content !== undefined) {
		return {
			cursor: {
				from: matchState.matchStartLoc,
				to: matchState.matchEndLoc
			},
			match: {
				content: content,
				matches: [[matchState.matchStartGlobal, matchState.matchEndGlobal]]
			}
		};
	}
	if (fallbackLine !== undefined && fallbackLine >= 0) {
		return { line: fallbackLine };
	}
	return null;
}

const leafTimers = new WeakMap<WorkspaceLeaf, { timerId: number; win: Window }>();
const leafHighlightTokens = new WeakMap<WorkspaceLeaf, number>();

/**
 * 在 Markdown 编辑器（Live Preview / Source 模式）中精准选中并居中目标词句
 * 不触发整行整段闪烁，并通过轮询确认等待目标文档在 Leaf 中完全挂载与就绪
 */
function applyEditorExactMatch(
	targetLeaf: WorkspaceLeaf,
	targetFile: TFile,
	matchState: MatchState
): void {
	const win = targetLeaf.view?.containerEl?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
	if (!win) return;

	const existing = leafTimers.get(targetLeaf);
	if (existing) {
		existing.win.clearTimeout(existing.timerId);
	}
	const token = (leafHighlightTokens.get(targetLeaf) ?? 0) + 1;
	leafHighlightTokens.set(targetLeaf, token);

	let attempts = 0;
	let successes = 0;

	const apply = () => {
		if (leafHighlightTokens.get(targetLeaf) !== token) return;

		attempts++;
		const view = targetLeaf.view;
		if (
			!(view instanceof MarkdownView) ||
			view.file?.path !== targetFile.path ||
			!view.editor
		) {
			if (attempts < 30) {
				const timerId = win.setTimeout(apply, 30);
				leafTimers.set(targetLeaf, { timerId, win });
			} else {
				leafTimers.delete(targetLeaf);
			}
			return;
		}

		try {
			const lineCount = view.editor.lineCount();
			if (lineCount <= matchState.matchEndLoc.line) {
				if (attempts < 30) {
					const timerId = win.setTimeout(apply, 30);
					leafTimers.set(targetLeaf, { timerId, win });
				} else {
					leafTimers.delete(targetLeaf);
				}
				return;
			}

			view.editor.setSelection(matchState.matchStartLoc, matchState.matchEndLoc);
			view.editor.scrollIntoView(
				{ from: matchState.matchStartLoc, to: matchState.matchEndLoc },
				true
			);
			view.editor.focus();

			targetLeaf.setEphemeralState({
				cursor: {
					from: matchState.matchStartLoc,
					to: matchState.matchEndLoc
				},
				match: {
					content: view.editor.getValue(),
					matches: [[matchState.matchStartGlobal, matchState.matchEndGlobal]]
				}
			});

			successes++;
			Logger.info('[WebNovel-Debug] [leaf] applyEditorExactMatch 选区设置完成:', {
				attempt: attempts,
				lineCount,
				matchStartLoc: matchState.matchStartLoc,
				matchEndLoc: matchState.matchEndLoc,
				lineText: view.editor.getLine(matchState.matchStartLoc.line),
				currentSelection: view.editor.getSelection()
			});
		} catch (e) {
			console.warn('[WebNovel Assistant] 编辑器精准选区定位失败:', e);
		}

		if (successes < 3 && attempts < 30) {
			const timerId = win.setTimeout(apply, 40);
			leafTimers.set(targetLeaf, { timerId, win });
		} else {
			leafTimers.delete(targetLeaf);
		}
	};

	leafTimers.set(targetLeaf, { timerId: 0, win });
	apply();
}

/**
 * 在 Reading View 阅读模式渲染完成后尝试精确定位词句
 */
function highlightReadingViewExact(
	targetLeaf: WorkspaceLeaf,
	targetFile: TFile,
	matchState: MatchState
): void {
	const win = targetLeaf.view?.containerEl?.ownerDocument?.defaultView || window;

	const existing = leafTimers.get(targetLeaf);
	if (existing) {
		existing.win.clearTimeout(existing.timerId);
	}
	const token = (leafHighlightTokens.get(targetLeaf) ?? 0) + 1;
	leafHighlightTokens.set(targetLeaf, token);

	const headingText = matchState.matchText.replace(/^#{1,6}\s+/, '');
	const searchTexts = headingText === matchState.matchText ? [matchState.matchText] : [headingText, matchState.matchText];

	let attempts = 0;
	let successes = 0;

	// 初始尝试触发 previewMode.applyScroll 滚动到目标行，以确保虚拟化 DOM 渲染目标区域
	const initialView = targetLeaf.view;
	if (initialView instanceof MarkdownView) {
		const preview = (initialView.previewMode ?? initialView.currentMode) as { applyScroll?: (scroll: number) => void } | undefined;
		if (typeof preview?.applyScroll === 'function') {
			preview.applyScroll(matchState.targetLine);
		}
	}

	const tryHighlight = () => {
		if (leafHighlightTokens.get(targetLeaf) !== token) return;

		attempts++;
		const view = targetLeaf.view;
		if (
			!(view instanceof MarkdownView) ||
			view.file?.path !== targetFile.path ||
			view.getMode() !== 'preview'
		) {
			if (attempts < 30) {
				const timerId = win.setTimeout(tryHighlight, 40);
				leafTimers.set(targetLeaf, { timerId, win });
			} else {
				leafTimers.delete(targetLeaf);
			}
			return;
		}

		if (attempts === 1 || (attempts <= 15 && attempts % 4 === 1 && successes === 0)) {
			const preview = (view.previewMode ?? view.currentMode) as { applyScroll?: (scroll: number) => void } | undefined;
			if (typeof preview?.applyScroll === 'function') {
				preview.applyScroll(matchState.targetLine);
			}
		}

		const previewContainer = view.previewMode?.containerEl;
		if (!previewContainer || !previewContainer.isConnected) {
			if (attempts < 30) {
				const timerId = win.setTimeout(tryHighlight, 40);
				leafTimers.set(targetLeaf, { timerId, win });
			} else {
				leafTimers.delete(targetLeaf);
			}
			return;
		}

		const success = highlightReadingViewPhrase(
			previewContainer,
			matchState.targetLine,
			searchTexts,
			{
				preferredCharOffset: matchState.matchStartGlobal,
				contextPrefix: matchState.contextPrefix,
				contextSuffix: matchState.contextSuffix,
				occurrenceIndex: matchState.occurrenceIndex
			},
			matchState.matchStartLoc.ch
		);
		Logger.info('[WebNovel-Debug] [leaf] highlightReadingViewExact 执行结果:', {
			attempt: attempts,
			success,
			targetLine: matchState.targetLine,
			matchStartGlobal: matchState.matchStartGlobal,
			preferredLineOffset: matchState.matchStartLoc.ch,
			matchText: matchState.matchText,
			occurrenceIndex: matchState.occurrenceIndex,
			contextPrefix: matchState.contextPrefix,
			contextSuffix: matchState.contextSuffix
		});
		if (success) {
			successes++;
		}

		if (!success || successes < 3) {
			if (attempts < 30) {
				const timerId = win.setTimeout(tryHighlight, 50);
				leafTimers.set(targetLeaf, { timerId, win });
			} else {
				leafTimers.delete(targetLeaf);
			}
		} else {
			leafTimers.delete(targetLeaf);
		}
	};

	leafTimers.set(targetLeaf, { timerId: 0, win });
	tryHighlight();
}

/**
 * 伏笔/时间线/设定/状态 全局智能高亮跳转定位函数
 * 优先复用已有 Markdown Leaf，在 Edit 模式下使用精准选区与居中定位，在 Reading 模式下使用 DOM 词句精准包裹高亮（绝不触发整行整段闪烁）
 */
export async function smartLocateAndHighlight(
	app: App,
	file: TFile,
	searchTexts: (string | undefined)[],
	options?: SmartLocateOptions
): Promise<boolean> {
	const targetLeaf = getLeafForFileNavigation(app, file, options);

	// 读取文本内容并计算 matchState（优先使用已计算的高精度 exactMatchState）
	let matchState: MatchState | null = options?.exactMatchState ?? null;
	if (!matchState) {
		const content = await app.vault.cachedRead(file);
		matchState = findMatchState(content, searchTexts, options?.matchStartGlobal);
	}

	// 5. 执行打开与焦点激活，并通过 Leaf 级轮询确保无论跨文件或同文件均精准定位
	const targetView = targetLeaf.view as (MarkdownView & { getMode?: () => string }) | undefined;
	const isSameFile = targetView?.file?.path === file.path;

	if (!isSameFile) {
		await targetLeaf.openFile(file, { active: true });
	}

	revealAndFocusLeaf(app, targetLeaf);

	const isPreview = targetView?.getMode?.() === 'preview';
	Logger.info('[WebNovel-Debug] [leaf] smartLocateAndHighlight 触发跳转定位:', {
		file: file.path,
		isSameFile,
		isPreview,
		leafMode: targetView?.getMode?.() ?? 'not-markdown',
		matchState
	});

	if (matchState) {
		if (isPreview) {
			highlightReadingViewExact(targetLeaf, file, matchState);
		} else {
			applyEditorExactMatch(targetLeaf, file, matchState);
		}
	} else if (options?.fallbackLine !== undefined && options.fallbackLine >= 0) {
		if (isPreview) {
			targetLeaf.setEphemeralState({ line: options.fallbackLine });
		} else if (targetLeaf.view instanceof MarkdownView && targetLeaf.view.editor) {
			targetLeaf.view.editor.setCursor({ line: options.fallbackLine, ch: 0 });
			targetLeaf.view.editor.scrollIntoView(
				{ from: { line: options.fallbackLine, ch: 0 }, to: { line: options.fallbackLine, ch: 0 } },
				true
			);
			targetLeaf.setEphemeralState({ line: options.fallbackLine });
		}
	}

	return matchState !== null || (options?.fallbackLine !== undefined && options.fallbackLine >= 0);
}
