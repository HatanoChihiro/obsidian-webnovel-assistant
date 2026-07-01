import type { MarkdownPostProcessorContext} from 'obsidian';
import { TFile, Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ForeshadowingRecoveryModal } from '../ui/ForeshadowingModal';
import { getDefaultFileName } from '../i18n/data-keys';
import { t } from '../i18n';

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
			const foreshadowingFileName = (this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName')) + '.md';
			if (file.name !== foreshadowingFileName) return;

			// 查找并注入复选框
			this.processForeshadowingElements(el, ctx, file);
		};
	}

	private processForeshadowingElements(el: HTMLElement, ctx: MarkdownPostProcessorContext, file: TFile): void {
		// 查找所有包含 **状态**：未回收 的段落
		el.querySelectorAll('p, li').forEach((p) => {
			const text = p.textContent || '';
			if (!text.includes('状态') && !text.includes('Status')) return;
			if (!text.includes('未回收') && !text.includes('pending') && !text.includes('Pending')) return;

			// 找到包含"状态"的 strong 元素
			const strongs = p.querySelectorAll('strong');
			let statusStrong: Element | null = null;
			strongs.forEach(s => {
				if (s.textContent === '状态' || s.textContent === 'Status') statusStrong = s;
			});
			if (!statusStrong) return;

			// 注入复选框
			const checkbox = activeDocument.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.title = t('common.mark-recovered');
			checkbox.className = 'foreshadowing-recovery-checkbox';
			checkbox.addClass('webnovel-foreshadowing-checkbox');
			checkbox.addEventListener('change', (e) => {
				e.preventDefault();
				checkbox.checked = false; // 先恢复，等用户确认后再更新文件

				// 定位目标条目
				const sectionInfo = ctx.getSectionInfo(el);
				if (!sectionInfo) return;

				void this.plugin.app.vault.read(file).then(async (content) => {
					const lines = content.split('\n');

					let titleLine = -1;
					let description = '';
					let contentPreview = '';

					for (let i = sectionInfo.lineStart; i >= 0; i--) {
						if (/^## /.test(lines[i])) {
							titleLine = i;
							const titleText = lines[i].slice(3).trim();
							
							const oldMatch = titleText.match(/^\[\[.+?\]\]/);
							if (oldMatch) {
								for (let j = titleLine + 1; j < lines.length; j++) {
									if (/^## /.test(lines[j])) break;
									const descMatch = lines[j].match(/\*\*(?:说明|Description|.+)\*\*：(.+)/);
									if (descMatch) {
										description = descMatch[1].trim();
										break;
									}
								}
							} else {
								description = titleText;
							}
							break;
						}
					}

					if (titleLine === -1 || !description) return;

					// 提取内容预览
					for (let i = titleLine + 1; i < lines.length; i++) {
						if (lines[i].startsWith('> ') && !lines[i].startsWith('> [[')) {
							contentPreview = lines[i].replace(/^> /, '');
							break;
						}
						if (/^## /.test(lines[i])) break;
					}

					new ForeshadowingRecoveryModal(this.plugin.app, this.plugin, contentPreview, file.parent?.path || '', (recoveryFileNames) => {
						void this.plugin.foreshadowingManager?.markAsRecovered(
							file, description, recoveryFileNames
						).then(success => {
							if (success) {
								const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
												new Notice(t('notice.foreshadowing-recovered', { links: fileList }));
							} else {
								new Notice(t('notice.foreshadowing-entry-not-found'));
							}
						});
					}).open();
				});
			});

			p.appendChild(checkbox);
		});
	}
}
