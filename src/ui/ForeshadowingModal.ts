import { App, Modal, Notice, Setting, SuggestModal, TFile } from 'obsidian';

type AccurateChineseCountPlugin = any;

// ─────────────────────────────────────────────
// 1. 标注伏笔输入对话框
// ─────────────────────────────────────────────

/**
 * 标注伏笔时弹出的输入对话框
 * 用户填写补充说明和标签
 */
export class ForeshadowingInputModal extends Modal {
	private plugin: AccurateChineseCountPlugin;
	private sourceFileName: string;
	private selectedContent: string;
	private onSubmit: (description: string, tags: string[]) => void;

	private descriptionEl!: HTMLTextAreaElement;
	private tagsEl!: HTMLInputElement;

	constructor(
		app: App,
		plugin: AccurateChineseCountPlugin,
		sourceFileName: string,
		selectedContent: string,
		onSubmit: (description: string, tags: string[]) => void
	) {
		super(app);
		this.plugin = plugin;
		this.sourceFileName = sourceFileName;
		this.selectedContent = selectedContent;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('foreshadowing-input-modal');

		contentEl.createEl('h2', { text: '📌 标注为伏笔' });

		// 来源和内容预览
		const infoEl = contentEl.createDiv({ cls: 'foreshadowing-info' });
		infoEl.createEl('div', {
			text: `来源：${this.sourceFileName}`,
			cls: 'foreshadowing-source'
		});
		const preview = this.selectedContent.length > 80
			? this.selectedContent.slice(0, 80) + '…'
			: this.selectedContent;
		infoEl.createEl('div', {
			text: `内容：「${preview}」`,
			cls: 'foreshadowing-preview'
		});

		// 补充说明（必填）
		new Setting(contentEl)
			.setName('补充说明')
			.setDesc('请输入伏笔的说明信息（必填）');

		this.descriptionEl = contentEl.createEl('textarea', {
			cls: 'foreshadowing-description',
			placeholder: '例如：这是主角身世的伏笔，将在第十章揭晓...',
		});
		this.descriptionEl.style.cssText = 'width:100%;height:80px;resize:vertical;margin-bottom:12px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);font-family:var(--font-text);';

		// 标签（可选）
		new Setting(contentEl)
			.setName('标签（可选）')
			.setDesc('多个标签用空格分隔，无需加 #');

		this.tagsEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: '例如：人物 情节 世界观',
			cls: 'foreshadowing-tags-input'
		});
		this.tagsEl.style.cssText = 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';

		// 常用标签快捷按钮
		const defaultTags: string[] = this.plugin.settings.foreshadowing?.defaultTags || ['人物', '情节', '世界观', '道具', '伏线'];
		if (defaultTags.length > 0) {
			const tagBtnContainer = contentEl.createDiv({ cls: 'foreshadowing-tag-buttons' });
			tagBtnContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;';
			for (const tag of defaultTags) {
				const btn = tagBtnContainer.createEl('button', { text: `#${tag}` });
				btn.style.cssText = 'padding:2px 10px;border-radius:12px;border:1px solid var(--interactive-accent);color:var(--interactive-accent);background:transparent;cursor:pointer;font-size:0.85em;';
				btn.onclick = () => {
					const current = this.tagsEl.value.trim();
					const existing = current ? current.split(/\s+/) : [];
					if (!existing.includes(tag)) {
						this.tagsEl.value = [...existing, tag].join(' ');
					}
				};
			}
		}

		// 按钮区
		const btnContainer = contentEl.createDiv();
		btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:8px;';

		const cancelBtn = btnContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: '确认标注', cls: 'mod-cta' });
		confirmBtn.onclick = () => this.submit();

		// 聚焦说明输入框
		setTimeout(() => this.descriptionEl.focus(), 50);

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
			this.descriptionEl.style.borderColor = 'var(--background-modifier-error)';
			new Notice('❌ 请填写补充说明');
			this.descriptionEl.focus();
			return;
		}
		const tagsRaw = this.tagsEl.value.trim();
		const tags = tagsRaw ? tagsRaw.split(/\s+/).filter(Boolean) : [];
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

		contentEl.createEl('h2', { text: '选择回收章节' });
		contentEl.createEl('p', { 
			text: '可以选择多个章节（支持一个伏笔在多个章节中回收）',
			cls: 'setting-item-description'
		});

		// 搜索框
		const searchInput = contentEl.createEl('input', {
			type: 'text',
			placeholder: '搜索章节...'
		});
		searchInput.style.cssText = 'width:100%;margin-bottom:12px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';

		// 章节列表
		this.listEl = contentEl.createDiv({ cls: 'chapter-multi-select-list' });
		this.listEl.style.cssText = 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:4px;margin-bottom:12px;';

		this.renderChapterList(this.chapters);

		// 搜索功能
		searchInput.addEventListener('input', () => {
			const query = searchInput.value.toLowerCase();
			const filtered = this.chapters.filter(ch => ch.toLowerCase().includes(query));
			this.renderChapterList(filtered);
		});

		// 已选择的章节显示
		const selectedEl = contentEl.createDiv({ cls: 'selected-chapters' });
		selectedEl.style.cssText = 'margin-bottom:12px;padding:8px;background:var(--background-secondary);border-radius:4px;min-height:30px;';
		const updateSelected = () => {
			selectedEl.empty();
			if (this.selectedChapters.size === 0) {
				selectedEl.createSpan({ text: '未选择章节', cls: 'setting-item-description' });
			} else {
				selectedEl.createSpan({ text: `已选择 ${this.selectedChapters.size} 个章节：`, cls: 'setting-item-description' });
				selectedEl.createEl('br');
				Array.from(this.selectedChapters).forEach(ch => {
					const tag = selectedEl.createSpan({ text: ch, cls: 'tag' });
					tag.style.cssText = 'display:inline-block;margin:4px 4px 0 0;padding:2px 8px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:12px;font-size:0.9em;';
				});
			}
		};

		// 按钮区
		const btnContainer = contentEl.createDiv();
		btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';

		const cancelBtn = btnContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: '确认', cls: 'mod-cta' });
		confirmBtn.onclick = () => {
			if (this.selectedChapters.size === 0) {
				new Notice('❌ 请至少选择一个章节');
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
			item.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;display:flex;align-items:center;gap:8px;';
			
			const checkbox = item.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedChapters.has(chapter);
			checkbox.style.cssText = 'cursor:pointer;';
			
			const label = item.createSpan({ text: chapter });
			label.style.cssText = 'flex:1;cursor:pointer;';

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
			this.listEl.createDiv({ text: '没有找到匹配的章节', cls: 'setting-item-description' }).style.padding = '12px';
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 章节选择建议模态框（单选，向后兼容）
 */
class ChapterSuggestModal extends SuggestModal<string> {
	private chapters: string[];
	private onSubmit: (chapter: string) => void;

	constructor(app: App, chapters: string[], onSubmit: (chapter: string) => void) {
		super(app);
		this.chapters = chapters;
		this.onSubmit = onSubmit;
		this.setPlaceholder('输入章节名称进行搜索...');
	}

	getSuggestions(query: string): string[] {
		const lowerQuery = query.toLowerCase();
		return this.chapters.filter(chapter =>
			chapter.toLowerCase().includes(lowerQuery)
		);
	}

	renderSuggestion(chapter: string, el: HTMLElement) {
		el.createEl('div', { text: chapter });
	}

	onChooseSuggestion(chapter: string, evt: MouseEvent | KeyboardEvent) {
		this.onSubmit(chapter);
	}
}

/**
 * 标记伏笔已回收时弹出的对话框
 * 用户选择或输入回收章节文件名（支持多章节）
 */
export class ForeshadowingRecoveryModal extends Modal {
	private contentPreview: string;
	private folderPath: string;
	private onSubmit: (recoveryFileNames: string[]) => void;
	private inputEl!: HTMLInputElement;
	private chapters: string[] = [];

	constructor(
		app: App,
		contentPreview: string,
		folderPath: string,
		onSubmit: (recoveryFileNames: string[]) => void
	) {
		super(app);
		this.contentPreview = contentPreview;
		this.folderPath = folderPath;
		this.onSubmit = onSubmit;
		
		// 获取同文件夹下的章节文件
		const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
		if (folder && 'children' in folder) {
			(folder as any).children.forEach((child: any) => {
				if (child.extension === 'md') this.chapters.push(child.basename);
			});
			this.chapters.sort((a, b) => a.localeCompare(b, 'zh-CN'));
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '✅ 标记伏笔已回收' });

		// 内容预览
		const preview = this.contentPreview.length > 60
			? this.contentPreview.slice(0, 60) + '…'
			: this.contentPreview;
		contentEl.createEl('p', {
			text: `伏笔：「${preview}」`,
			cls: 'foreshadowing-preview'
		});

		// 文件选择
		new Setting(contentEl)
			.setName('回收章节')
			.setDesc('输入完成回收的章节文件名（无需 .md 后缀），多个章节用逗号或空格分隔');

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: '例如：第十章, 第十一章',
		});
		this.inputEl.style.cssText = 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';

		// 如果有章节文件，显示选择按钮
		if (this.chapters.length > 0) {
			const btnRow = contentEl.createDiv();
			btnRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
			
			const selectBtn = btnRow.createEl('button', { text: '📋 从列表选择（支持多选）' });
			selectBtn.style.cssText = 'flex:1;padding:6px 12px;border-radius:4px;border:1px solid var(--interactive-accent);color:var(--interactive-accent);background:transparent;cursor:pointer;';
			selectBtn.onclick = () => {
				this.close();
				new ChapterMultiSelectModal(this.app, this.chapters, (selectedChapters) => {
					this.onSubmit(selectedChapters);
				}).open();
			};
			
			const hint = contentEl.createEl('p', {
				text: `💡 当前文件夹有 ${this.chapters.length} 个章节文件`,
				cls: 'setting-item-description'
			});
			hint.style.marginBottom = '12px';
		}

		// 按钮区
		const btnContainer = contentEl.createDiv();
		btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:16px;';

		const cancelBtn = btnContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: '确认回收', cls: 'mod-cta' });
		confirmBtn.onclick = () => this.submit();

		setTimeout(() => this.inputEl.focus(), 50);

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
			this.inputEl.style.borderColor = 'var(--background-modifier-error)';
			new Notice('❌ 请输入回收章节名');
			this.inputEl.focus();
			return;
		}
		// 支持逗号或空格分隔多个章节
		const chapters = value.split(/[,，\s]+/).filter(Boolean).map(ch => ch.trim());
		this.onSubmit(chapters);
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

		contentEl.createEl('h2', { text: '📄 创建伏笔文件' });

		const location = this.folderPath
			? `「${this.folderPath}/${this.fileName}.md」`
			: `「${this.fileName}.md」`;

		contentEl.createEl('p', {
			text: `当前文件夹下不存在 ${location}，是否创建？`
		});

		const btnContainer = contentEl.createDiv();
		btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:20px;';

		const cancelBtn = btnContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: '创建并继续', cls: 'mod-cta' });
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
