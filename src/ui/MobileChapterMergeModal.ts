import { Modal, setIcon, Notice, type TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ChapterMergeItem } from '../services/ChapterMergeManager';
import { t } from '../i18n';

/**
 * 移动端（手机与平板）章节合并与原稿瀑布流预览 Modal
 */
export class MobileChapterMergeModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private folder: TFolder;
	private items: ChapterMergeItem[] = [];
	private includeTitles: boolean = true;
	private isSubmitting: boolean = false;

	private statsEl!: HTMLElement;
	private previewContainerEl!: HTMLElement;

	constructor(app: typeof plugin.app, plugin: WebNovelAssistantPlugin, folder: TFolder) {
		super(app);
		this.plugin = plugin;
		this.folder = folder;
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.addClass('wn-mobile-merge-modal-window');
		contentEl.addClass('wn-mobile-merge-modal-content');
		this.applyTypographyToModal(modalEl);

		this.items = await this.plugin.chapterMergeManager.loadFolderChapters(this.folder);

		this.renderHeader(contentEl);
		this.renderWaterfallBody(contentEl);
		this.renderFooter(modalEl);
	}

	/**
	 * 继承全局排版控制系统的 CSS 变量与 Class
	 */
	private applyTypographyToModal(containerEl: HTMLElement): void {
		const typo = this.plugin.settings.typography;
		if (!typo) return;

		containerEl.addClass('wn-typography-active');

		containerEl.style.setProperty('--wn-type-header-align', typo.headerAlignment || 'center');
		containerEl.style.setProperty('--wn-type-indent', typo.enableIndent ? (typo.indentSize || '2em') : '0');
		containerEl.style.setProperty('--wn-type-line-height', String(typo.lineHeight || 1.8));
		containerEl.style.setProperty('--wn-type-para-spacing', typo.paragraphSpacing || '0.5em');
		containerEl.style.setProperty('--wn-type-letter-spacing', typo.letterSpacing || '0.05em');
		containerEl.style.setProperty('--wn-type-text-align', typo.justifyText ? 'justify' : 'left');
	}

	/**
	 * 渲染顶部单行标题（保留 Modal 原生右上角关闭按钮）
	 */
	private renderHeader(container: HTMLElement): void {
		const headerEl = container.createDiv({ cls: 'wn-merge-modal-header wn-mobile-merge-header' });

		const titleGroup = headerEl.createDiv({ cls: 'wn-merge-header-title-group' });
		const iconEl = titleGroup.createSpan({ cls: 'wn-merge-header-icon' });
		setIcon(iconEl, 'combine');

		titleGroup.createDiv({
			text: t('merge.modal-title', { name: this.folder.name }),
			cls: 'wn-merge-modal-title'
		});
	}

	/**
	 * 渲染单栏瀑布流正文展示区
	 */
	private renderWaterfallBody(container: HTMLElement): void {
		const bodyEl = container.createDiv({ cls: 'wn-mobile-merge-body' });
		this.previewContainerEl = bodyEl.createDiv({ cls: 'wn-mobile-merge-preview-container' });
		this.renderPreviewCards();
	}

	/**
	 * 渲染瀑布流正文卡片（支持软回车 \n 逐行精准排版对齐）
	 */
	private renderPreviewCards(): void {
		this.previewContainerEl.empty();
		let lastVolume = '';

		for (const item of this.items) {
			if (this.includeTitles && item.volumeName && item.volumeName !== lastVolume) {
				lastVolume = item.volumeName;
				const volDivider = this.previewContainerEl.createDiv({ cls: 'wn-merge-preview-vol-divider' });
				volDivider.createDiv({ text: lastVolume, cls: 'wn-merge-vol-divider-title' });
			}

			const cardEl = this.previewContainerEl.createDiv({ cls: 'wn-merge-chapter-card wn-mobile-merge-card' });
			const cardHeader = cardEl.createDiv({ cls: 'wn-merge-card-header' });

			const titleInfo = cardHeader.createDiv({ cls: 'wn-merge-card-title-group' });
			const fileIcon = titleInfo.createSpan({ cls: 'wn-merge-card-icon' });
			setIcon(fileIcon, 'file-text');

			if (this.includeTitles) {
				titleInfo.createSpan({ text: item.title, cls: 'wn-merge-card-title' });
			}

			const words = this.plugin.calculateAccurateWords(item.currentBody);
			titleInfo.createSpan({ text: `${words.toLocaleString()} ${t('common.word-char')}`, cls: 'wn-merge-card-badge' });

			const cardBody = cardEl.createDiv({ cls: 'wn-merge-card-body' });
			const lines = item.currentBody.split(/\r?\n/);
			for (const line of lines) {
				const p = cardBody.createEl('p', { cls: 'wn-merge-para' });
				if (!line.trim()) {
					p.addClass('wn-merge-para-empty');
					p.setText('\u00A0');
				} else {
					p.setText(line);
				}
			}
		}
	}

	/**
	 * 渲染底部极其精简的操作控制栏（包含标题开关与导出按钮）
	 */
	private renderFooter(container: HTMLElement): void {
		const footerEl = container.createDiv({ cls: 'wn-merge-modal-footer wn-mobile-merge-footer' });

		const leftGroup = footerEl.createDiv({ cls: 'wn-merge-footer-left' });

		const titleLabel = leftGroup.createEl('label', { cls: 'wn-merge-checkbox-label' });
		const titleCheckbox = titleLabel.createEl('input', { type: 'checkbox', cls: 'wn-merge-checkbox-input' });
		titleCheckbox.checked = this.includeTitles;
		titleLabel.createSpan({ text: t('merge.include-titles'), cls: 'wn-merge-checkbox-text' });

		titleCheckbox.onchange = () => {
			this.includeTitles = titleCheckbox.checked;
			this.renderPreviewCards();
		};

		const rightGroup = footerEl.createDiv({ cls: 'wn-merge-footer-right' });

		const exportBtn = rightGroup.createEl('button', { text: t('merge.btn-export-merged'), cls: 'mod-cta wn-btn-export' });
		exportBtn.onclick = () => void this.handleExportMerged();
	}

	/**
	 * 处理导出合并文档
	 */
	private async handleExportMerged(): Promise<void> {
		this.isSubmitting = true;
		const { file: mergedFile, wordCount } = await this.plugin.chapterMergeManager.exportMergedDocument(this.folder, this.items, this.includeTitles);
		this.plugin.chapterMergeManager.clearDraft(this.folder.path);

		new Notice(t('notice.merge-success', {
			count: String(this.items.length),
			words: wordCount.toLocaleString(),
			overwriteHint: ''
		}));

		await this.app.workspace.getLeaf(false).openFile(mergedFile);
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
