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
 * 标记伏笔已回收时弹出的对话框
 * 用户选择或输入回收章节文件名
 */
export class ForeshadowingRecoveryModal extends Modal {
	private contentPreview: string;
	private folderPath: string;
	private onSubmit: (recoveryFileName: string) => void;
	private inputEl!: HTMLInputElement;

	constructor(
		app: App,
		contentPreview: string,
		folderPath: string,
		onSubmit: (recoveryFileName: string) => void
	) {
		super(app);
		this.contentPreview = contentPreview;
		this.folderPath = folderPath;
		this.onSubmit = onSubmit;
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
			.setDesc('输入完成回收的章节文件名（无需 .md 后缀）');

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: '例如：第十章',
		});
		this.inputEl.style.cssText = 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';

		// 只列出同文件夹下的 md 文件供参考
		const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
		const mdFiles: string[] = [];
		if (folder && 'children' in folder) {
			(folder as any).children.forEach((child: any) => {
				if (child.extension === 'md') mdFiles.push(child.basename);
			});
			mdFiles.sort((a, b) => a.localeCompare(b, 'zh-CN'));
		}

		if (mdFiles.length > 0) {
			const hint = contentEl.createEl('p', {
				text: '💡 提示：输入文件名关键词可快速定位',
				cls: 'setting-item-description'
			});
			hint.style.marginBottom = '12px';

			// 简单的 datalist 自动补全
			const datalist = contentEl.createEl('datalist');
			datalist.id = 'foreshadowing-file-list';
			for (const name of mdFiles) {
				const option = datalist.createEl('option');
				option.value = name;
			}
			this.inputEl.setAttribute('list', 'foreshadowing-file-list');
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
		const value = this.inputEl.value.trim().replace(/\.md$/i, '');
		if (!value) {
			this.inputEl.style.borderColor = 'var(--background-modifier-error)';
			new Notice('❌ 请输入回收章节名');
			this.inputEl.focus();
			return;
		}
		this.onSubmit(value);
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
