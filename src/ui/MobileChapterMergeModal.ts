import { showPluginNotice } from '../services/PluginNoticeService';
import { ChapterMergeDirectoryModal, ChapterMergeSelectionModal, mergeChapterChoices } from './ChapterMergeSelectionModal';
import { ChapterMergePreview } from './ChapterMergePreview';
import type { App, TFolder } from 'obsidian';
import { Modal, setIcon } from 'obsidian';
import type { ChapterMergeItem, ChapterMergeManager } from '../services/ChapterMergeManager';
import { ChapterMergeSelection } from '../services/ChapterMergeSelection';
import type { TypographyManager } from '../services/TypographyManager';
import { Logger } from '../utils/Logger';
import { t } from '../i18n';

export interface MobileChapterMergeModalPlugin {
	typographyManager: Pick<TypographyManager, 'registerPreviewElement' | 'unregisterPreviewElement'>;
	chapterMergeManager: Pick<ChapterMergeManager, 'loadFolderChapters' | 'exportMergedDocument' | 'clearDraft'>;
	calculateAccurateWords(text: string): number;
}

/**
 * 移动端（手机与平板）章节合并与原稿瀑布流预览 Modal
 */
export class MobileChapterMergeModal extends Modal {
	private plugin: MobileChapterMergeModalPlugin;
	private folder: TFolder;
	private items: ChapterMergeItem[] = [];
	private chapterSelection: ChapterMergeSelection = new ChapterMergeSelection();
	private includeTitles: boolean = true;

	private previewContainerEl!: HTMLElement;
	private scrollContainerEl!: HTMLElement;
	private selectionModal: Modal | null = null;
	private selectionCountEl?: HTMLElement;
	private exportBtn?: HTMLButtonElement;
	private isSubmitting: boolean = false;
	private typographyPreviewElement: HTMLElement | null = null;
	private loadController: AbortController | null = null;
	private preview: ChapterMergePreview | null = null;
	private wordCounts = new Map<string, { body: string; count: number }>();

	private getWordCount(item: ChapterMergeItem): number {
		const cached = this.wordCounts.get(item.file.path);
		if (cached?.body === item.currentBody) return cached.count;
		const count = this.plugin.calculateAccurateWords(item.currentBody);
		this.wordCounts.set(item.file.path, { body: item.currentBody, count });
		return count;
	}

	constructor(app: App, plugin: MobileChapterMergeModalPlugin, folder: TFolder) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal');
		this.plugin = plugin;
		this.folder = folder;
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.addClass('wn-mobile-merge-modal-window');
		contentEl.addClass('wn-mobile-merge-modal-content');
		this.typographyPreviewElement = modalEl;
		this.plugin.typographyManager.registerPreviewElement(modalEl);

		const controller = new AbortController();
		this.loadController?.abort();
		this.loadController = controller;
		this.renderHeader(contentEl);
		const loading = contentEl.createDiv({ cls: 'wn-merge-loading', text: t('merge.loading') });
		loading.setAttribute('role', 'status');
		try {
			const items = await this.plugin.chapterMergeManager.loadFolderChapters(this.folder, controller.signal);
			if (controller.signal.aborted || this.loadController !== controller) return;
			this.items = items;
		} catch (error) {
			if (controller.signal.aborted || this.loadController !== controller) return;
			Logger.error('[ChapterMerge] Load failed:', error);
			loading.setText(t('merge.load-failed'));
			return;
		}
		loading.remove?.();
		this.chapterSelection.initialize(this.items);

		this.renderWaterfallBody(contentEl);
		this.renderFooter(modalEl);
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
		// 移动端全选/反选与计数工具条
		const toolbarEl = container.createDiv({ cls: 'wn-mobile-merge-toolbar' });
		this.selectionCountEl = toolbarEl.createSpan({ cls: 'wn-mobile-merge-counter' });

		const btnGroup = toolbarEl.createDiv({ cls: 'wn-mobile-merge-bulk-actions' });
		const bulkSelectBtn = btnGroup.createEl('button', {
			text: t('merge.bulk-select-all'),
			cls: 'wn-mobile-merge-btn-bulk'
		});
		bulkSelectBtn.onclick = () => {
			this.chapterSelection.selectAll(this.items);
			this.updateCardCheckboxes();
			this.updateSelectionUI();
		};

		const bulkDeselectBtn = btnGroup.createEl('button', {
			text: t('merge.bulk-deselect-all'),
			cls: 'wn-mobile-merge-btn-bulk'
		});
		bulkDeselectBtn.onclick = () => {
			this.chapterSelection.deselectAll(this.items);
			this.updateCardCheckboxes();
			this.updateSelectionUI();
		};

		const rangeButton = btnGroup.createEl('button', { text: t('merge.range'), cls: 'wn-mobile-merge-btn-bulk' });
		rangeButton.onclick = () => {
			this.selectionModal = new ChapterMergeSelectionModal(this.app, this.items, this.chapterSelection, () => {
				if (this.loadController?.signal.aborted) return;
				this.updateCardCheckboxes();
				this.updateSelectionUI();
			});
			this.selectionModal.open();
		};
		const directoryButton = btnGroup.createEl('button', { text: t('merge.directory'), cls: 'wn-mobile-merge-btn-bulk' });
		directoryButton.onclick = () => {
			this.selectionModal = new ChapterMergeDirectoryModal(this.app, mergeChapterChoices(this.items), path => {
				if (this.loadController?.signal.aborted) return;
				this.preview?.ensure(path)?.scrollIntoView({ block: 'start' });
			});
			this.selectionModal.open();
		};
		this.scrollContainerEl = container.createDiv({ cls: 'wn-mobile-merge-body' });
		this.previewContainerEl = this.scrollContainerEl.createDiv({ cls: 'wn-mobile-merge-preview-container' });
		this.renderPreviewCards();
		this.updateSelectionUI();
	}

	/**
	 * 渲染瀑布流正文卡片（支持软回车 \n 逐行精准排版对齐）
	 */
	private renderPreviewCards(): void {
		this.preview?.dispose();
		this.previewContainerEl.empty();
		this.preview = new ChapterMergePreview(this.scrollContainerEl);
		this.previewContainerEl.toggleClass?.('is-without-titles', !this.includeTitles);
		let lastVolume = '';

		for (const item of this.items) {
			if (item.volumeName && item.volumeName !== lastVolume) {
				lastVolume = item.volumeName;
				const volDivider = this.previewContainerEl.createDiv({ cls: 'wn-merge-preview-vol-divider' });
				volDivider.createDiv({ text: lastVolume, cls: 'wn-merge-vol-divider-title' });
			}

			const cardEl = this.previewContainerEl.createDiv({ cls: 'wn-merge-chapter-card wn-mobile-merge-card' });
			cardEl.setAttribute('data-filepath', encodeURIComponent(item.file.path));
			const cardHeader = cardEl.createDiv({ cls: 'wn-merge-card-header' });

			const titleInfo = cardHeader.createDiv({ cls: 'wn-merge-card-title-group' });

			// 移动端卡片复选框
			const checkbox = titleInfo.createEl('input', {
				type: 'checkbox',
				cls: 'wn-mobile-merge-checkbox'
			});
			checkbox.checked = this.chapterSelection.isSelected(item.file.path);
			checkbox.setAttribute('aria-label', t('merge.select-chapter', { title: item.title }));

			checkbox.onclick = (e: MouseEvent) => {
				e.stopPropagation();
				this.handleChapterCheckboxClick(item.file.path, checkbox.checked, e.shiftKey);
			};

			const fileIcon = titleInfo.createSpan({ cls: 'wn-merge-card-icon' });
			setIcon(fileIcon, 'file-text');

			titleInfo.createSpan({ text: item.title, cls: 'wn-merge-card-title' });

			const badge = titleInfo.createSpan({ cls: 'wn-merge-card-badge' });
			const cardBody = cardEl.createDiv({ cls: 'wn-merge-card-body' });
			this.preview.add(item.file.path, cardEl, cardBody, item.currentBody, () => {
				badge.setText(`${this.getWordCount(item).toLocaleString()} ${t('common.word-char')}`);
				for (const line of item.currentBody.split(/\r?\n/)) {
					const p = cardBody.createEl('p', { cls: 'wn-merge-para' });
					if (!line.trim()) {
						p.addClass('wn-merge-para-empty');
						p.setText('\u00A0');
					} else p.setText(line);
				}
			});
		}
	}

	/**
	 * 单个章节复选框点击处理（包含 Shift 区间连选）
	 */
	private handleChapterCheckboxClick(path: string, isChecked: boolean, isShift: boolean): void {
		this.chapterSelection.handleCheckboxClick(path, isShift, this.items, isChecked);
		this.updateCardCheckboxes();
		this.updateSelectionUI();
	}

	/**
	 * 仅同步更新所有卡片复选框状态（不重绘瀑布流卡片）
	 */
	private updateCardCheckboxes(): void {
		if (!this.previewContainerEl) return;
		const cards = this.previewContainerEl.querySelectorAll<HTMLElement>('.wn-merge-chapter-card');
		cards.forEach(card => {
			const pathKey = card.getAttribute('data-filepath');
			if (!pathKey) return;
			const filePath = decodeURIComponent(pathKey);
			const cb = card.querySelector<HTMLInputElement>('.wn-mobile-merge-checkbox');
			if (cb) {
				cb.checked = this.chapterSelection.isSelected(filePath);
			}
		});
	}

	/**
	 * 更新底部导出按钮与计数器状态
	 */
	private updateSelectionUI(): void {
		const selectedCount = this.chapterSelection.getSelectedCount();
		const totalCount = this.items.length;
		if (this.selectionCountEl) {
			this.selectionCountEl.setText(t('merge.selected-counter', {
				selected: String(selectedCount),
				total: String(totalCount)
			}));
		}
		if (this.exportBtn) {
			this.exportBtn.disabled = this.isSubmitting || selectedCount === 0;
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
			this.previewContainerEl.toggleClass('is-without-titles', !this.includeTitles);
		};

		const rightGroup = footerEl.createDiv({ cls: 'wn-merge-footer-right' });

		this.exportBtn = rightGroup.createEl('button', { text: t('merge.btn-export-merged'), cls: 'mod-cta wn-btn-export' });
		this.exportBtn.onclick = () => void this.handleExportMerged();

		this.updateSelectionUI();
	}

	/**
	 * 处理导出合并文档
	 */
	private async handleExportMerged(): Promise<void> {
		if (this.isSubmitting) return;

		const selectedItems = this.chapterSelection.getSelectedItems(this.items);
		if (selectedItems.length === 0) return;

		// 捕获入口时刻是否全选的快照，后续草稿清理严格基于快照判定
		const isAllSelectedSnapshot = selectedItems.length === this.items.length;

		try {
			this.isSubmitting = true;
			if (this.exportBtn) this.exportBtn.disabled = true;

			const { file: mergedFile, wordCount } = await this.plugin.chapterMergeManager.exportMergedDocument(
				this.folder,
				selectedItems,
				this.includeTitles
			);

			// 移动端只读子集导出绝不清除桌面端正在编辑的草稿
			// 仅在入口快照为全量导出时才清理草稿
			if (isAllSelectedSnapshot) {
				this.plugin.chapterMergeManager.clearDraft(this.folder.path);
			}

			showPluginNotice(t('notice.merge-success', {
				count: String(selectedItems.length),
				words: wordCount.toLocaleString(),
				overwriteHint: ''
			}));

			await this.app.workspace.getLeaf(false).openFile(mergedFile);
			this.close();
		} catch (error) {
			this.isSubmitting = false;
			this.updateSelectionUI();
			Logger.error('[MobileChapterMergeModal] Export merged failed:', error);
			showPluginNotice(t('notice.merge-failed'));
		}
	}

	onClose(): void {
		this.loadController?.abort();
		this.preview?.dispose();
		this.wordCounts.clear();
		this.selectionModal?.close();
		if (this.typographyPreviewElement) {
			this.plugin.typographyManager.unregisterPreviewElement(this.typographyPreviewElement);
			this.typographyPreviewElement = null;
		}

		const { contentEl } = this;
		contentEl.empty();
	}
}
