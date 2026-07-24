import type { App, OpenViewState, TFile, WorkspaceLeaf } from 'obsidian';

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
