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
 * 在目标 WorkspaceLeaf 中打开文件，并确保焦点平滑且可靠地切换至该 Leaf
 */
export async function openFileAndFocus(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	options?: OpenViewState
): Promise<void> {
	await leaf.openFile(file, { active: true, ...options });
	revealAndFocusLeaf(app, leaf);
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
	const lines = content.split(/\r?\n/);
	if ((lines[0] ?? '').replace(/^\uFEFF/, '').trim() !== '---') {
		return { startOffset: 0, startLine: 0 };
	}

	let offset = lines[0].length + 1; // +1 for the newline
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '---' || line.trim() === '...') {
			return {
				startOffset: offset + line.length + 1,
				startLine: i + 1
			};
		}
		offset += line.length + 1;
	}

	return { startOffset: 0, startLine: 0 };
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

	for (const text of searchTexts) {
		if (!text) continue;
		const cleanSearch = text.trim();
		if (!cleanSearch) continue;

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

			const textBefore = content.substring(0, matchStartGlobal);
			const linesBefore = textBefore.split(/\r?\n/);
			const targetLine = linesBefore.length - 1;

			const matchStartLoc: RangeLoc = {
				line: targetLine,
				ch: linesBefore[linesBefore.length - 1].length
			};

			const matchLines = matchText.split(/\r?\n/);
			const matchEndLoc: RangeLoc = {
				line: targetLine + matchLines.length - 1,
				ch: matchLines.length === 1
					? matchStartLoc.ch + matchText.length
					: matchLines[matchLines.length - 1].length
			};

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
	const win = targetLeaf.view?.containerEl?.ownerDocument?.defaultView || window;

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
	// 1. 优先寻找已经打开了目标文件的 Markdown 编辑器 Leaf
	const markdownLeaves = app.workspace.getLeavesOfType('markdown');
	let targetLeaf: WorkspaceLeaf | null = null;
	for (const leaf of markdownLeaves) {
		if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
			targetLeaf = leaf;
			break;
		}
	}

	// 2. 若目标文件未在任何窗口打开，优先寻找并复用已有 Markdown 独立窗口/分屏（排除发起操作的源 Leaf）
	if (!targetLeaf) {
		if (options?.preferredLeaf) {
			targetLeaf = options.preferredLeaf;
		} else {
			const sourceLeaf = options?.sourceLeaf ?? (app.workspace.getMostRecentLeaf() || undefined);
			const reusableLeaf = markdownLeaves.find(l => {
				if (sourceLeaf && l === sourceLeaf) return false;
				return l.view instanceof MarkdownView;
			});
			if (reusableLeaf) {
				targetLeaf = reusableLeaf;
			}
		}
	}

	// 3. 若当前不存在任何可复用的 Markdown 窗口，且设定了 splitIfNew 时自动开启单个分屏，否则在当前窗口打开
	if (!targetLeaf) {
		if (options?.splitIfNew) {
			targetLeaf = app.workspace.getLeaf('split', 'vertical');
		} else {
			targetLeaf = app.workspace.getLeaf(false);
		}
	}

	// 4. 读取文本内容并计算 matchState（优先使用已计算的高精度 exactMatchState）
	let matchState: MatchState | null = options?.exactMatchState ?? null;
	if (!matchState) {
		const content = await app.vault.cachedRead(file);
		matchState = findMatchState(content, searchTexts, options?.matchStartGlobal);
	}

	// 5. 执行打开与焦点激活，并通过 Leaf 级轮询确保无论跨文件或同文件均精准定位
	const isSameFile = targetLeaf.view instanceof MarkdownView && targetLeaf.view.file?.path === file.path;

	if (!isSameFile) {
		await targetLeaf.openFile(file, { active: true });
	}

	revealAndFocusLeaf(app, targetLeaf);

	const isPreview = targetLeaf.view instanceof MarkdownView && targetLeaf.view.getMode() === 'preview';
	Logger.info('[WebNovel-Debug] [leaf] smartLocateAndHighlight 触发跳转定位:', {
		file: file.path,
		isSameFile,
		isPreview,
		leafMode: targetLeaf.view instanceof MarkdownView ? targetLeaf.view.getMode() : 'not-markdown',
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
