import { App, Modal, Setting, TFile, TFolder, Notice, TextComponent } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

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

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '添加新设定' });

		new Setting(contentEl)
			.setName('设定名称 (正名)')
			.addText(text => text
				.setValue(this.loreName)
				.onChange(value => {
					this.loreName = value;
				}));

		const loreFolderName = this.plugin.settings.loreFolderName || '设定';
		const expectedLorePath = this.bookPath === '/' ? loreFolderName : `${this.bookPath}/${loreFolderName}`;
		
		// 收集现有的分类文档
		const categoryFiles: string[] = [];
		const loreFolder = this.app.vault.getAbstractFileByPath(expectedLorePath);
		
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
			this.loreCategory = '角色志'; // Default fallback
		}

		const categorySetting = new Setting(contentEl)
			.setName('设定分类')
			.setDesc(`选择现有分类，或选择新建来创建新的分类文档`);
			
		categorySetting.addDropdown(dropdown => {
			for (const file of categoryFiles) {
				dropdown.addOption(file, file);
			}
			dropdown.addOption('__NEW__', '+ 新建分类...');
			dropdown.setValue(this.loreCategory);
			
			dropdown.onChange(value => {
				if (value === '__NEW__') {
					this.isCreatingNew = true;
					this.loreCategory = '';
					textComponent.inputEl.style.display = 'block';
					textComponent.inputEl.focus();
				} else {
					this.isCreatingNew = false;
					this.loreCategory = value;
					textComponent.inputEl.style.display = 'none';
				}
			});
		});

		let textComponent: TextComponent;
		categorySetting.addText(text => {
			textComponent = text;
			text.setPlaceholder('输入新分类名...')
				.onChange(value => {
					if (this.isCreatingNew) {
						this.loreCategory = value;
					}
				});
			text.inputEl.style.display = 'none'; // 默认隐藏
			return text;
		});

		new Setting(contentEl)
			.setName('别名 (可选)')
			.setDesc('多个别名请用逗号隔开')
			.addText(text => text
				.setValue(this.loreAliases)
				.onChange(value => {
					this.loreAliases = value;
				}));

		new Setting(contentEl)
			.setName('设定描述')
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
				.setButtonText('保存')
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
		const loreFolderName = this.plugin.settings.loreFolderName || '设定';
		const expectedLorePath = this.bookPath === '/' ? loreFolderName : `${this.bookPath}/${loreFolderName}`;
		
		// 确保设定文件夹存在
		let loreFolder = this.app.vault.getAbstractFileByPath(expectedLorePath);
		if (!loreFolder) {
			try {
				await this.app.vault.createFolder(expectedLorePath);
			} catch (e) {
				// 再次检查是否已被并发创建
				loreFolder = this.app.vault.getAbstractFileByPath(expectedLorePath);
				if (!loreFolder) {
					new Notice('无法创建设定文件夹，请确认作品目录结构正确。');
					return false;
				}
			}
		}

		const filePath = `${expectedLorePath}/${this.loreCategory}.md`;
		let targetFile = this.app.vault.getAbstractFileByPath(filePath);

		if (!(targetFile instanceof TFile)) {
			targetFile = null;
		}

		let contentToAppend = `\n\n## ${this.loreName.trim()}\n\n`;
		if (this.loreAliases.trim()) {
			contentToAppend += `**别名**：${this.loreAliases.trim()}\n`;
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

		new Notice('设定已保存');
		return true;
	}
}
