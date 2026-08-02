import type { App, OpenViewState, TFile, WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';

/**
 * 延迟一帧/Tick 揭示并激活 WorkspaceLeaf，确保在 DOM 点击事件或异步渲染完成后正确获取 focus 焦点
 *
 * @param app Obsidian App 实例
 * @param leaf 需要激活的目标 WorkspaceLeaf
 */
export function revealAndFocusLeaf(app: App, leaf: WorkspaceLeaf): void {
	window.setTimeout(() => {
		try {
			void app.workspace.revealLeaf(leaf);
			void app.workspace.setActiveLeaf(leaf, { focus: true });
		} catch (e) {
			window.console.warn('[WebNovel Assistant] 激活 Leaf 失败:', e);
		}
	}, 0);
}

/**
 * 在目标 WorkspaceLeaf 中打开文件，并确保焦点平滑且可靠地切换至该 Leaf
 *
 * @param app Obsidian App 实例
 * @param leaf 目标 WorkspaceLeaf
 * @param file 需要打开的 Markdown 文件
 * @param options 可选的 OpenViewState 配置（包含 eState, state 等）
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

/**
 * 伏笔/时间线/设定 智能全文高亮跳转定位函数
 * 自动查找已有 Leaf 避免重复切分，使用忽略空白与大小写的正则智能查找目标行，
 * 依次按候选文本列表（原文 -> 说明 -> 标题）尝试多级匹配，自动滚屏、设置光标并触发 Obsidian 原生背景闪烁高亮。
 */
export async function smartLocateAndHighlight(
	app: App,
	file: TFile,
	searchTexts: (string | undefined)[],
	options?: {
		preferredLeaf?: WorkspaceLeaf;
		sourceLeaf?: WorkspaceLeaf;
		splitIfNew?: boolean;
		fallbackLine?: number;
	}
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

	// 2. 读取文本内容并进行智能多级正则匹配
	const content = await app.vault.cachedRead(file);
	let targetLine = -1;

	for (const text of searchTexts) {
		if (!text) continue;
		const cleanSearch = text.trim();
		if (!cleanSearch) continue;

		// 转义正则保留字，并将任意空白/换行替换为 \s+
		const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const searchPattern = escapedSearch.replace(/\s+/g, '\\s+');

		let match = content.match(new RegExp(searchPattern, 'i'));
		// 降级截取前 20 个字符进行模糊匹配
		if (!match && cleanSearch.length > 20) {
			const shortSearch = cleanSearch.substring(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
			match = content.match(new RegExp(shortSearch, 'i'));
		}

		if (match && match.index !== undefined) {
			targetLine = content.substring(0, match.index).split('\n').length - 1;
			break;
		}
	}

	// 若正则未查找到匹配，但提供了 fallbackLine (如从 metadataCache 获取的 Heading 行号)，使用 fallbackLine
	if (targetLine === -1 && options?.fallbackLine !== undefined && options.fallbackLine >= 0) {
		targetLine = options.fallbackLine;
	}

	// 若仍未查找到任何文本匹配，默认定位到文件开头的第 0 行
	if (targetLine === -1) {
		targetLine = 0;
	}

	// 3. 执行打开、定位光标与原生闪烁高亮
	if (targetLeaf.view instanceof MarkdownView && targetLeaf.view.file?.path === file.path) {
		targetLeaf.view.editor.setCursor({ line: targetLine, ch: 0 });
		targetLeaf.setEphemeralState({ line: targetLine });
		revealAndFocusLeaf(app, targetLeaf);
	} else {
		await openFileAndFocus(app, targetLeaf, file, { eState: { line: targetLine } });
	}

	return targetLine !== -1;
}
