import { Modal, Setting, TFile, TFolder, Notice } from 'obsidian';
import type { App, TextComponent } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';
import { getDefaultFileName, getDefaultFileNameCandidates, getLoreLabel } from '../i18n/data-keys';

export class AddLoreModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private initialName: string;
	private loreName: string;
	private loreCategory: string;
	private loreAliases: string;
	private loreDescription: string;
	private bookPath: string;
	private isCreatingNew: boolean = false;

	constructor(app: App, plugin: WebNovelAssistantPlugin, initialName: string, bookPath: string) {
		super(app);
		this.plugin = plugin;
		this.initialName = initialName;
		this.loreName = initialName;
		this.loreCategory = '';
		this.loreAliases = '';
		this.loreDescription = '';
		this.bookPath = bookPath;
	}

	/**
	 * 查找设定文件夹（支持多语言文件夹名）
	 */
	findLoreFolder(): TFolder | null {
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.loreFolderName || getDefaultFileName('loreFolderName'));
		for (const name of getDefaultFileNameCandidates('loreFolderName')) candidates.add(name);
		for (const loreFolderName of candidates) {
			const lorePath = this.bookPath === "/" ? loreFolderName : this.bookPath + "/" + loreFolderName;
			const folder = this.app.vault.getAbstractFileByPath(lorePath);
			if (folder instanceof TFolder) return folder;
		}
		return null;
	}
onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: t('modal.add-new-lore') });

		new Setting(contentEl)
			.setName(t('modal.lore-name'))
			.addText(text => text
				.setValue(this.loreName)
				.onChange(value => {
					this.loreName = value;
				}));

		// 查找设定文件夹（支持多语言）
		const loreFolder = this.findLoreFolder();

		// 收集现有的分类文档
		const categoryFiles: string[] = [];
		if (loreFolder instanceof TFolder) {
			for (const child of loreFolder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					categoryFiles.push(child.basename);
				}
			}
		}

		if (categoryFiles.length > 0) {
			this.loreCategory = categoryFiles[0];
		} else {
			this.loreCategory = t('modal.lore-default-category'); // Default fallback
		}

		const categorySetting = new Setting(contentEl)
			.setName(t('modal.lore-category'))
			.setDesc(t('modal.lore-category-desc'));
			
		categorySetting.addDropdown(dropdown => {
			for (const file of categoryFiles) {
				dropdown.addOption(file, file);
			}
			dropdown.addOption('__NEW__', t('modal.new-category'));
			dropdown.setValue(this.loreCategory);
			
			dropdown.onChange(value => {
				if (value === '__NEW__') {
					this.isCreatingNew = true;
					this.loreCategory = '';
					textComponent.inputEl.show();
					textComponent.inputEl.focus();
				} else {
					this.isCreatingNew = false;
					this.loreCategory = value;
					textComponent.inputEl.hide();
				}
			});
		});

		let textComponent: TextComponent;
		categorySetting.addText(text => {
			textComponent = text;
			text.setPlaceholder(t('modal.new-category-placeholder'))
				.onChange(value => {
					if (this.isCreatingNew) {
						this.loreCategory = value;
					}
				});
			text.inputEl.hide(); // 默认隐藏
			return text;
		});

		new Setting(contentEl)
			.setName(t('modal.lore-aliases'))
			.setDesc(t('modal.lore-aliases-desc'))
			.addText(text => text
				.setValue(this.loreAliases)
				.onChange(value => {
					this.loreAliases = value;
				}));

		new Setting(contentEl)
			.setName(t('modal.lore-description'))
			.addTextArea(text => {
				text.inputEl.rows = 4;
				text.inputEl.cols = 40;
				text.setValue(this.loreDescription)
					.onChange(value => {
						this.loreDescription = value;
					});
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('common.save'))
				.setCta()
				.onClick(async () => {
					if (!this.loreName.trim() || !this.loreCategory.trim()) {
						return;
					}
					const success = await this.saveLore();
					if (success) {
						this.close();
					}
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	async saveLore() {
// 查找已有的设定文件夹（支持多语言）
		let loreFolder = this.findLoreFolder();
		// 新建时优先使用用户设置，fallback 到当前语言的默认文件夹名
		const currentLoreName = this.plugin.settings.loreFolderName || getDefaultFileName('loreFolderName');
		const expectedLorePath = this.bookPath === '/' ? currentLoreName : this.bookPath + '/' + currentLoreName;
		
		// 如果没有设定文件夹，用当前语言名创建
		if (!loreFolder) {
			try {
				await this.app.vault.createFolder(expectedLorePath);
			} catch {
				// 再次检查是否已被并发创建
				const abstractFile = this.app.vault.getAbstractFileByPath(expectedLorePath);
				loreFolder = abstractFile instanceof TFolder ? abstractFile : null;
				if (!loreFolder) {
					new Notice(t('modal.lore-cannot-create-folder'));
					return false;
				}
			}
		}

		// 使用找到的文件夹路径（可能是任何语言版本）
		const loreFolderPath = loreFolder instanceof Object && 'path' in loreFolder ? (loreFolder as { path: string }).path : expectedLorePath;
		const filePath = loreFolderPath + '/' + this.loreCategory + '.md';
		let targetFile = this.app.vault.getAbstractFileByPath(filePath);

		if (!(targetFile instanceof TFile)) {
			targetFile = null;
		}

		let contentToAppend = `\n\n## ${this.loreName.trim()}\n\n`;
		if (this.loreAliases.trim()) {
			contentToAppend += `**${getLoreLabel('alias')}**：${this.loreAliases.trim()}\n`;
		}
		if (this.loreDescription.trim()) {
			contentToAppend += `${this.loreDescription.trim()}\n`;
		}

		if (targetFile) {
			// Append to existing
			await this.app.vault.append(targetFile, contentToAppend);
		} else {
			// Create new
			targetFile = await this.app.vault.create(filePath, contentToAppend.trimStart());
		}

		// 主动触发缓存重载，确保新数据立即可见
		await this.plugin.characterManager.rebuildCache();

		new Notice(t('modal.lore-saved'));
		return true;
	}
}
