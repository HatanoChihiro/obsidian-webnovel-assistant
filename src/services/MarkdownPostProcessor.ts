import type { MarkdownPostProcessorContext} from 'obsidian';
import { TFile, Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ForeshadowingRecoveryModal } from '../ui/ForeshadowingModal';

/**
 * Markdown 后处理器
 * 负责在预览模式下注入交互元素，如伏笔回收复选框
 */
export class MarkdownPostProcessor {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 注册后处理器
	 */
	public getProcessor() {
		return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const file = this.plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (!(file instanceof TFile)) return;

			// 只在伏笔文件中生效
			const foreshadowingFileName = (this.plugin.settings.foreshadowing?.fileName || '伏笔') + '.md';
			if (file.name !== foreshadowingFileName) return;

			// 查找并注入复选框
			this.processForeshadowingElements(el, ctx, file);
		};
	}

	private processForeshadowingElements(el: HTMLElement, ctx: MarkdownPostProcessorContext, file: TFile): void {
		// 查找所有包含 **状态**：未回收 的段落
		el.querySelectorAll('p, li').forEach((p) => {
			const text = p.textContent || '';
			if (!text.includes('状态') || !text.includes('未回收')) return;

			// 找到包含"状态"的 strong 元素
			const strongs = p.querySelectorAll('strong');
			let statusStrong: Element | null = null;
			strongs.forEach(s => {
				if (s.textContent === '状态') statusStrong = s;
			});
			if (!statusStrong) return;

			// 注入复选框
			const checkbox = activeDocument.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.title = '标记为已回收';
			checkbox.className = 'foreshadowing-recovery-checkbox';
			checkbox.setAttribute('style', 'margin-left:8px;cursor:pointer;vertical-align:middle;width:15px;height:15px;accent-color:var(--interactive-accent);');
			checkbox.addEventListener('change', async (e) => {
				e.preventDefault();
				checkbox.checked = false; // 先恢复，等用户确认后再更新文件

				// 定位目标条目
				const sectionInfo = ctx.getSectionInfo(el);
				if (!sectionInfo) return;

				const content = await this.plugin.app.vault.read(file);
				const lines = content.split('\n');

				let titleLine = -1;
				let sourceFileName = '';
				let createdAt = '';
				let contentPreview = '';

				for (let i = sectionInfo.lineStart; i >= 0; i--) {
					const match = lines[i].match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (match) {
						sourceFileName = match[1];
						createdAt = match[2]?.trim() || '';
						titleLine = i;
						break;
					}
				}

				if (titleLine === -1) return;

				// 提取内容预览
				for (let i = titleLine + 1; i < lines.length; i++) {
					if (lines[i].startsWith('> ')) {
						contentPreview = lines[i].replace(/^> /, '');
						break;
					}
					if (/^## \[\[/.test(lines[i])) break;
				}

				new ForeshadowingRecoveryModal(this.plugin.app, contentPreview, file.parent?.path || '', async (recoveryFileNames) => {
					const success = await this.plugin.foreshadowingManager?.markAsRecovered(
						file, sourceFileName, createdAt, recoveryFileNames
					);
					if (success) {
						const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
						new Notice(`[成功] 已标记为已回收：${fileList}`);
					} else {
						new Notice('[错误] 未找到对应的伏笔条目');
					}
				}).open();
			});

			p.appendChild(checkbox);
		});
	}
}
