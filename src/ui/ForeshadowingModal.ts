import type { App } from 'obsidian';
import { Modal, Notice, Setting, MarkdownView } from 'obsidian';
import type { ForeshadowingSettings } from '../types/foreshadowing';
import type { ChapterSorterContext } from '../services/ChapterSorter';
import { t } from '../i18n';
import { ChapterSorter } from '../services/ChapterSorter';

export interface ForeshadowingInputModalPlugin {
	settings: {
		foreshadowing?: Pick<ForeshadowingSettings, 'defaultTags'>;
	};
}

export interface ForeshadowingRecoveryModalPlugin extends ChapterSorterContext {
	lastFilePath?: string;
}

// ─────────────────────────────────────────────
// 1. 标注伏笔输入对话框
// ─────────────────────────────────────────────

/**
 * 标注伏笔时弹出的输入对话框
 * 用户填写补充说明和标签
 */
export class ForeshadowingInputModal extends Modal {
	private plugin: ForeshadowingInputModalPlugin;
	private sourceFileName: string;
	private selectedContent: string;
	private onSubmit: (description: string, tags: string[]) => void;
	private extraTags: string[];

	private descriptionEl!: HTMLTextAreaElement;
	private tagsEl!: HTMLInputElement;

	constructor(
		app: App,
		plugin: ForeshadowingInputModalPlugin,
		sourceFileName: string,
		selectedContent: string,
		onSubmit: (description: string, tags: string[]) => void,
		extraTags: string[] = []
	) {
		super(app);
		this.plugin = plugin;
		this.sourceFileName = sourceFileName;
		this.selectedContent = selectedContent;
		this.onSubmit = onSubmit;
		this.extraTags = extraTags;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('foreshadowing-input-modal');

		new Setting(contentEl).setName(t('modal.mark-foreshadowing')).setHeading();

		// 来源和内容预览
		const infoEl = contentEl.createDiv({ cls: 'foreshadowing-info' });
		infoEl.createDiv({
			text: t('modal.source-label', { name: this.sourceFileName }),
			cls: 'foreshadowing-source'
		});
		const preview = this.selectedContent.length > 80
			? this.selectedContent.slice(0, 80) + '…'
			: this.selectedContent;
		infoEl.createDiv({
			text: t('modal.content-label', { preview }),
			cls: 'foreshadowing-preview'
		});

		// 补充说明（必填）
		new Setting(contentEl)
			.setName(t('modal.supplementary-note'))
			.setDesc(t('modal.supplementary-note-desc'));

		this.descriptionEl = contentEl.createEl('textarea', {
			cls: 'foreshadowing-description',
			placeholder: t('modal.supplementary-note-placeholder'),
		});
		this.descriptionEl.addClass('webnovel-modal-textarea');
		// 标签（可选）
		new Setting(contentEl)
			.setName(t('modal.tags-optional'))
			.setDesc(t('modal.tags-desc'));

		this.tagsEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: t('modal.tags-placeholder'),
			cls: 'foreshadowing-tags-input'
		});
		this.tagsEl.addClass('webnovel-modal-input');
		// 常用标签快捷按钮
		const globalTags: string[] = this.plugin.settings.foreshadowing?.defaultTags || [];
		const allTags = [...new Set([...globalTags, ...this.extraTags])];
		if (allTags.length > 0) {
			const tagBtnContainer = contentEl.createDiv({ cls: 'foreshadowing-tag-buttons' });
			tagBtnContainer.addClass('wn-base-tag-button-container');
			for (const tag of allTags) {
				const btn = tagBtnContainer.createEl('button', { text: `#${tag}` });
				btn.addClass('wn-base-tag-button');
				btn.onclick = () => {
					const current = this.tagsEl.value.trim();
					const existing = current ? current.split(/[,，\s]+/) : [];
					if (!existing.includes(tag)) {
						this.tagsEl.value = [...existing, tag].join(', ');
					}
				};
			}
		}

		// 按钮区
		const btnContainer = contentEl.createDiv();
		btnContainer.addClass('wn-base-button-container');
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('modal.confirm-mark'), cls: 'mod-cta' });
		confirmBtn.onclick = () => this.submit();

		// 聚焦说明输入框
		window.setTimeout(() => this.descriptionEl.focus(), 50);

		// Ctrl+Enter 提交
		contentEl.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			}
		});
	}

	private submit() {
		const description = this.descriptionEl.value.trim();
		if (!description) {
			this.descriptionEl.addClass('wn-border-error');
			new Notice(t('modal.please-fill-note'));
			this.descriptionEl.focus();
			return;
		}
		const tagsRaw = this.tagsEl.value.trim();
		const tags = tagsRaw ? tagsRaw.split(/[,，\s]+/).filter(Boolean) : [];
		this.onSubmit(description, tags);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ─────────────────────────────────────────────
// 2. 标记回收对话框
// ─────────────────────────────────────────────

/**
 * 章节多选建议模态框
 */
class ChapterMultiSelectModal extends Modal {
	private chapters: string[];
	private selectedChapters: Set<string> = new Set();
	private onSubmit: (chapters: string[]) => void;
	private listEl!: HTMLElement;

	constructor(app: App, chapters: string[], onSubmit: (chapters: string[]) => void) {
		super(app);
		this.chapters = chapters;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName(t('modal.select-recovery-chapters')).setHeading();
		contentEl.createEl('p', { 
			text: t('modal.multi-recovery-hint'),
			cls: 'setting-item-description'
		});

		// 搜索框
		const searchInput = contentEl.createEl('input', {
			type: 'text',
			placeholder: t('modal.search-chapters')
		});
		searchInput.addClass('webnovel-modal-input');
		// 章节列表
		this.listEl = contentEl.createDiv({ cls: 'chapter-multi-select-list' });
		this.listEl.addClass('webnovel-modal-list');
		this.renderChapterList(this.chapters);

		// 搜索功能
		searchInput.addEventListener('input', () => {
			const query = searchInput.value.toLowerCase();
			const filtered = this.chapters.filter(ch => ch.toLowerCase().includes(query));
			this.renderChapterList(filtered);
		});

		// 已选择的章节显示
		const selectedEl = contentEl.createDiv({ cls: 'selected-chapters' });
		selectedEl.addClass('webnovel-modal-selected');
		const updateSelected = () => {
			selectedEl.empty();
			if (this.selectedChapters.size === 0) {
				selectedEl.createSpan({ text: t('modal.no-chapter-selected'), cls: 'setting-item-description' });
			} else {
				selectedEl.createSpan({ text: t('modal.chapters-selected-count', { count: this.selectedChapters.size }), cls: 'setting-item-description' });
				selectedEl.createEl('br');
				Array.from(this.selectedChapters).forEach(ch => {
					const tag = selectedEl.createSpan({ text: ch, cls: 'tag' });
					tag.addClass('webnovel-modal-selected-tag');
				});
			}
		};

		// 按钮区
		const btnContainer = contentEl.createDiv();
		btnContainer.addClass('wn-base-button-container');
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('common.confirm'), cls: 'mod-cta' });
		confirmBtn.onclick = () => {
			if (this.selectedChapters.size === 0) {
				new Notice(t('modal.please-select-chapter'));
				return;
			}
			this.onSubmit(Array.from(this.selectedChapters));
			this.close();
		};

		// 初始化显示
		updateSelected();

		// 监听选择变化
		this.listEl.addEventListener('change', () => updateSelected());
	}

	private renderChapterList(chapters: string[]) {
		this.listEl.empty();
		chapters.forEach(chapter => {
			const item = this.listEl.createDiv({ cls: 'chapter-item' });
			item.addClass('webnovel-modal-chapter-item');
			const checkbox = item.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedChapters.has(chapter);
			checkbox.addClass('wn-clickable');
			const label = item.createSpan({ text: chapter, cls: 'webnovel-chapter-label' });
			const toggle = () => {
				if (this.selectedChapters.has(chapter)) {
					this.selectedChapters.delete(chapter);
					checkbox.checked = false;
				} else {
					this.selectedChapters.add(chapter);
					checkbox.checked = true;
				}
				this.listEl.dispatchEvent(new Event('change'));
			};

			checkbox.addEventListener('change', toggle);
			label.addEventListener('click', toggle);
			item.addEventListener('click', (e) => {
				if (e.target !== checkbox && e.target !== label) toggle();
			});
		});

		if (chapters.length === 0) {
			this.listEl.createDiv({ text: t('modal.no-matching-chapters'), cls: 'setting-item-description webnovel-modal-empty' });
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 标记伏笔已回收时弹出的对话框
 * 用户选择或输入回收章节文件名（支持多章节）
 */
export class ForeshadowingRecoveryModal extends Modal {
	private plugin: ForeshadowingRecoveryModalPlugin;
	private contentPreview: string;
	private folderPath: string;
	private onSubmit: (recoveryFileNames: string[], isStage: boolean, note: string, quote?: string) => void;
	private initialIsStage: boolean;
	private initialQuote: string;
	
	private isStage: boolean;
	private inputEl!: HTMLInputElement;
	private noteEl!: HTMLInputElement;
	private quoteEl!: HTMLTextAreaElement;
	private chapters: string[] = [];

	constructor(
		app: App,
		plugin: ForeshadowingRecoveryModalPlugin,
		contentPreview: string,
		folderPath: string,
		onSubmit: (recoveryFileNames: string[], isStage: boolean, note: string, quote?: string) => void,
		initialIsStage: boolean = false,
		initialQuote: string = ''
	) {
		super(app);
		this.plugin = plugin;
		this.contentPreview = contentPreview;
		this.folderPath = folderPath;
		this.onSubmit = onSubmit;
		this.initialIsStage = initialIsStage;
		this.isStage = initialIsStage;
		this.initialQuote = initialQuote;
		
		const targetFiles = ChapterSorter.getAllChapters(this.app, this.plugin, this.folderPath);
		this.chapters = targetFiles.map(c => c.basename);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const titleText = this.initialIsStage ? t('common.mark-stage-recovered') : t('common.mark-final-recovered');
		new Setting(contentEl).setName(titleText).setHeading();

		// 内容预览
		const preview = this.contentPreview.length > 60
			? this.contentPreview.slice(0, 60) + '…'
			: this.contentPreview;
		contentEl.createEl('p', {
			text: t('modal.foreshadowing-preview', { preview }),
			cls: 'foreshadowing-preview'
		});

		// 回收模式选择 (阶段回收 vs 彻底回收)
		const modeSetting = new Setting(contentEl)
			.setName(t('common.recovery-mode'));
		
		const modeContainer = modeSetting.controlEl.createDiv({ cls: 'webnovel-radio-group' });
		
		const stageRadioLabel = modeContainer.createEl('label', { cls: 'webnovel-radio-label' });
		const stageRadio = stageRadioLabel.createEl('input', { type: 'radio', value: 'stage' });
		stageRadio.name = 'recovery-mode';
		stageRadio.checked = this.isStage;
		stageRadioLabel.createSpan({ text: t('common.recovery-mode-stage') });

		const finalRadioLabel = modeContainer.createEl('label', { cls: 'webnovel-radio-label' });
		const finalRadio = finalRadioLabel.createEl('input', { type: 'radio', value: 'final' });
		finalRadio.name = 'recovery-mode';
		finalRadio.checked = !this.isStage;
		finalRadioLabel.createSpan({ text: t('common.recovery-mode-final') });

		stageRadio.onchange = () => { if (stageRadio.checked) this.isStage = true; };
		finalRadio.onchange = () => { if (finalRadio.checked) this.isStage = false; };

		// 获取当前活动编辑器的章节文件与划选文本（若焦点在侧边栏，退回至主工作区 Markdown 叶子节点）
		let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
			if (mdLeaves.length > 0) {
				// 1. 优先匹配 Obsidian 当前的工作区 activeFile
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					const activeFileLeaf = mdLeaves.find(l => (l.view as MarkdownView).file?.path === activeFile.path);
					if (activeFileLeaf) {
						activeView = activeFileLeaf.view as MarkdownView;
					}
				}
				// 2. 备选：匹配插件记录的最后活动文件
				if (!activeView && this.plugin.lastFilePath) {
					const lastActiveLeaf = mdLeaves.find(l => (l.view as MarkdownView).file?.path === this.plugin.lastFilePath);
					if (lastActiveLeaf) {
						activeView = lastActiveLeaf.view as MarkdownView;
					}
				}
				// 3. 兜底：返回最靠近的 / 第一个打开的 Markdown 视图
				if (!activeView) {
					activeView = (mdLeaves.find(l => (l.view as MarkdownView).file) || mdLeaves[0]).view as MarkdownView;
				}
			}
		}
		const activeFile = activeView?.file;
		const activeSelection = activeView?.editor ? activeView.editor.getSelection().trim() : '';

		// 文件选择
		new Setting(contentEl)
			.setName(t('modal.recovery-chapter'))
			.setDesc(t('modal.recovery-chapter-desc'));

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: t('modal.recovery-placeholder'),
		});
		this.inputEl.addClass('webnovel-modal-input');
		if (activeFile) {
			this.inputEl.value = activeFile.basename;
		}

		// 如果有章节文件，显示选择按钮
		if (this.chapters.length > 0) {
			const btnRow = contentEl.createDiv({ cls: 'webnovel-btn-row' });
			const selectBtn = btnRow.createEl('button', { text: t('modal.select-from-list'), cls: 'webnovel-select-btn' });
			selectBtn.onclick = () => {
				new ChapterMultiSelectModal(this.app, this.chapters, (selectedChapters) => {
					if (selectedChapters.length > 0) {
						this.inputEl.value = selectedChapters.join(', ');
						this.noteEl?.focus();
					}
				}).open();
			};
			
			const hint = contentEl.createEl('p', {
				text: t('modal.chapter-count-hint', { count: this.chapters.length }),
				cls: 'setting-item-description'
			});
			hint.addClass('wn-mb-12');
		}

		// 阶段推进说明 / 备注
		new Setting(contentEl)
			.setName(t('common.stage-note'))
			.setDesc(t('common.stage-note-placeholder'));

		this.noteEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: t('common.stage-note-placeholder'),
		});
		this.noteEl.addClass('webnovel-modal-input');

		// 关联原文（可选）
		new Setting(contentEl)
			.setName(t('modal.associated-quote'))
			.setDesc(t('modal.associated-quote-placeholder'));

		this.quoteEl = contentEl.createEl('textarea', {
			placeholder: t('modal.associated-quote-placeholder'),
			cls: 'foreshadowing-quote-input webnovel-modal-textarea'
		});
		const finalQuote = this.initialQuote || activeSelection;
		if (finalQuote) {
			this.quoteEl.value = finalQuote;
		}

		// 按钮区
		const btnContainer = contentEl.createDiv();
		btnContainer.addClass('wn-base-button-container');
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('common.confirm'), cls: 'mod-cta' });
		confirmBtn.onclick = () => this.submit();

		window.setTimeout(() => this.inputEl.focus(), 50);

		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			}
		});
	}

	private submit() {
		const value = this.inputEl.value.trim().replace(/\.md$/gi, '');
		if (!value) {
			this.inputEl.addClass('wn-border-error');
			new Notice(t('modal.please-enter-recovery-chapter'));
			this.inputEl.focus();
			return;
		}
		// 支持逗号或空格分隔多个章节
		const chapters = value.split(/[,，\s]+/).filter(Boolean).map(ch => ch.trim());
		const note = this.noteEl.value.trim();
		const quote = this.quoteEl.value.trim();
		this.onSubmit(chapters, this.isStage, note, quote || undefined);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ─────────────────────────────────────────────
// 3. 确认创建伏笔文件对话框
// ─────────────────────────────────────────────

/**
 * 当伏笔文件不存在时，询问用户是否创建
 */
export class ConfirmCreateForeshadowingFileModal extends Modal {
	private fileName: string;
	private folderPath: string;
	private onConfirm: () => void;

	constructor(
		app: App,
		fileName: string,
		folderPath: string,
		onConfirm: () => void
	) {
		super(app);
		this.fileName = fileName;
		this.folderPath = folderPath;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName(t('modal.create-foreshadowing-file')).setHeading();

		const location = this.folderPath
			? `「${this.folderPath}/${this.fileName}.md」`
			: `「${this.fileName}.md」`;

		contentEl.createEl('p', {
			text: t('modal.foreshadowing-file-not-exist', { location })
		});

		const btnContainer = contentEl.createDiv({ cls: 'webnovel-btn-container-end' });
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('modal.create-and-continue'), cls: 'mod-cta' });
		confirmBtn.onclick = () => {
			this.onConfirm();
			this.close();
		};

		// Enter 确认
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.onConfirm();
				this.close();
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
