import { Modal, Setting, TFile, TFolder, setTooltip, setIcon } from 'obsidian';
import type { App, TextComponent } from 'obsidian';
import type { CharacterManager } from '../services/CharacterManager';
import { t } from '../i18n';

export interface LoreRelationItem {
	label: string;
	target: string;
}

export interface AddLorePlugin {
	characterManager: Pick<CharacterManager, 'findLoreFolder' | 'getLoreEntriesInFileOrder' | 'createLoreEntry'>;
}

export class AddLoreModal extends Modal {
	private plugin: AddLorePlugin;
	private initialName: string;
	private loreName: string;
	private loreCategory: string;
	private loreType: string;
	private loreAliases: string;
	private loreDescription: string;
	private loreRelations: LoreRelationItem[];
	private bookPath: string;
	private isCreatingNew: boolean = false;

	constructor(app: App, plugin: AddLorePlugin, initialName: string, bookPath: string) {
		super(app);
		this.plugin = plugin;
		this.initialName = initialName;
		this.loreName = initialName;
		this.loreCategory = '';
		this.loreType = '';
		this.loreAliases = '';
		this.loreDescription = '';
		this.loreRelations = [];
		this.bookPath = bookPath;
	}

	/**
	 * 查找设定文件夹（支持多语言文件夹名）
	 */
	findLoreFolder(): TFolder | null {
		return this.plugin.characterManager.findLoreFolder(this.bookPath);
	}

	/**
	 * 扫描设定文件夹中现有所有 md 文件，提取已存在的设定类型
	 */
	async collectExistingTypes(loreFolder: TFolder | null): Promise<string[]> {
		const typesSet = new Set<string>();
		if (!loreFolder) return [];

		const mdFiles: TFile[] = [];
		const collectFiles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					mdFiles.push(child);
				} else if (child instanceof TFolder) {
					collectFiles(child);
				}
			}
		};
		collectFiles(loreFolder);

		for (const file of mdFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const matches = content.matchAll(/(?:\*\*|__)?(?:类型|Type)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/gi);
				for (const match of matches) {
					if (match[1]) {
						const typeVal = match[1].trim();
						if (typeVal) {
							typesSet.add(typeVal);
						}
					}
				}
			} catch {
				// 忽略读取异常
			}
		}
		return Array.from(typesSet);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-add-lore-modal');

		new Setting(contentEl).setName(t('modal.add-new-lore')).setHeading();

		// 设定名称
		new Setting(contentEl)
			.setName(t('modal.lore-name'))
			.addText(text => text
				.setValue(this.loreName)
				.onChange(value => {
					this.loreName = value;
				}));

		// 查找设定文件夹（支持多语言）
		const loreFolder = this.findLoreFolder();

		// 收集现有的分类文档（支持多层嵌套子文件夹）
		const categoryFiles: string[] = [];
		if (loreFolder instanceof TFolder) {
			const collectCategories = (folder: TFolder, prefix: string = '') => {
				for (const child of folder.children) {
					if (child instanceof TFile && child.extension === 'md') {
						const relName = prefix ? `${prefix}/${child.basename}` : child.basename;
						categoryFiles.push(relName);
					} else if (child instanceof TFolder) {
						const nextPrefix = prefix ? `${prefix}/${child.name}` : child.name;
						collectCategories(child, nextPrefix);
					}
				}
			};
			collectCategories(loreFolder);
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

		// 类型（参考分类：收集已有类型，支持下拉选择与新建）
		const existingTypes = await this.collectExistingTypes(loreFolder);
		this.loreType = '';
		let isCreatingNewType = false;

		const typeSetting = new Setting(contentEl)
			.setName(t('modal.lore-type'))
			.setDesc(t('modal.lore-type-desc'));

		typeSetting.addDropdown(dropdown => {
			dropdown.addOption('__NONE__', t('modal.lore-type-none'));
			for (const typeStr of existingTypes) {
				dropdown.addOption(typeStr, typeStr);
			}
			dropdown.addOption('__NEW__', t('modal.new-type'));
			dropdown.setValue('__NONE__');

			dropdown.onChange(value => {
				if (value === '__NEW__') {
					isCreatingNewType = true;
					this.loreType = '';
					typeTextComponent.inputEl.show();
					typeTextComponent.inputEl.focus();
				} else if (value === '__NONE__') {
					isCreatingNewType = false;
					this.loreType = '';
					typeTextComponent.inputEl.hide();
				} else {
					isCreatingNewType = false;
					this.loreType = value;
					typeTextComponent.inputEl.hide();
				}
			});
		});

		let typeTextComponent: TextComponent;
		typeSetting.addText(text => {
			typeTextComponent = text;
			text.setPlaceholder(t('modal.new-type-placeholder'))
				.onChange(value => {
					if (isCreatingNewType) {
						this.loreType = value;
					}
				});
			text.inputEl.hide(); // 默认隐藏
			return text;
		});

		// 别名
		new Setting(contentEl)
			.setName(t('modal.lore-aliases'))
			.setDesc(t('modal.lore-aliases-desc'))
			.addText(text => text
				.setValue(this.loreAliases)
				.onChange(value => {
					this.loreAliases = value;
				}));

		// 设定描述
		new Setting(contentEl)
			.setName(t('modal.lore-description'))
			.addTextArea(text => {
				text.inputEl.rows = 3;
				text.setValue(this.loreDescription)
					.onChange(value => {
						this.loreDescription = value;
					});
			});

		// 收集当前书籍所有的设定名称，用于目标设定的下拉自动补全
		const existingLoreEntries = this.plugin.characterManager.getLoreEntriesInFileOrder(this.bookPath);
		const existingLoreNames = Array.from(new Set(existingLoreEntries.map(e => e.heading).filter(Boolean)));

		// 设定关系列表
		const relationSectionSetting = new Setting(contentEl)
			.setName(t('modal.lore-relations'))
			.setDesc(t('modal.lore-relations-desc'));

		const relationsListContainer = contentEl.createDiv({ cls: 'wn-lore-relations-container' });

		const renderRelationsList = () => {
			relationsListContainer.empty();

			this.loreRelations.forEach((rel, index) => {
				const rowEl = relationsListContainer.createDiv({ cls: 'wn-lore-relation-row' });

				// 关系名称输入框
				const labelInputEl = rowEl.createEl('input', {
					type: 'text',
					cls: 'wn-lore-relation-label-input',
					value: rel.label,
					placeholder: t('modal.lore-relation-label-placeholder'),
				});
				labelInputEl.addEventListener('input', (e) => {
					this.loreRelations[index].label = (e.target as HTMLInputElement).value;
				});

				// 分隔冒号
				rowEl.createSpan({ cls: 'wn-lore-relation-colon', text: t('modal.lore-colon') });

				// 目标设定选择容器（支持移动端原生下拉轮播菜单与自定义手动输入模式无缝切换）
				const targetWrapperEl = rowEl.createDiv({ cls: 'wn-lore-relation-target-wrapper' });

				const isExistingTarget = rel.target ? existingLoreNames.includes(rel.target) : false;
				let isManualInput = !isExistingTarget;

				// 方式 1: 原生下拉选择框（移动端不会被虚拟键盘遮挡，调用原生底栏 Picker）
				const targetSelectEl = targetWrapperEl.createEl('select', {
					cls: 'wn-lore-relation-target-select',
				});

				const defaultOption = targetSelectEl.createEl('option', {
					value: '',
					text: existingLoreNames.length > 0 ? t('modal.lore-select-existing') : t('modal.lore-no-existing'),
				});
				defaultOption.disabled = true;

				for (const name of existingLoreNames) {
					targetSelectEl.createEl('option', { value: name, text: name });
				}
				targetSelectEl.createEl('option', {
					value: '__CUSTOM__',
					text: t('modal.lore-custom-target'),
				});

				targetSelectEl.value = existingLoreNames.includes(rel.target) ? rel.target : '';

				// 方式 2: 自由文本输入框（当设定不在已有列表中时使用）
				const targetInputEl = targetWrapperEl.createEl('input', {
					type: 'text',
					cls: 'wn-lore-relation-target-input',
					value: rel.target,
					placeholder: t('modal.lore-relation-target-placeholder'),
				});

				// 模式切换按钮（使用 Obsidian 原生 Lucide 图标）
				const modeToggleBtn = targetWrapperEl.createEl('button', {
					cls: 'wn-lore-relation-toggle-btn',
				});

				const applyMode = () => {
					modeToggleBtn.empty();
					if (isManualInput || existingLoreNames.length === 0) {
						targetSelectEl.hide();
						targetInputEl.show();
						setIcon(modeToggleBtn, 'list');
						setTooltip(modeToggleBtn, t('modal.lore-toggle-select-tooltip'));
					} else {
						targetInputEl.hide();
						targetSelectEl.show();
						setIcon(modeToggleBtn, 'pencil');
						setTooltip(modeToggleBtn, t('modal.lore-toggle-input-tooltip'));
					}
				};

				targetSelectEl.addEventListener('change', (e) => {
					const selectedVal = (e.target as HTMLSelectElement).value;
					if (selectedVal === '__CUSTOM__') {
						isManualInput = true;
						this.loreRelations[index].target = '';
						targetInputEl.value = '';
						applyMode();
						targetInputEl.focus();
					} else {
						this.loreRelations[index].target = selectedVal;
					}
				});

				targetInputEl.addEventListener('input', (e) => {
					this.loreRelations[index].target = (e.target as HTMLInputElement).value;
				});

				modeToggleBtn.addEventListener('click', (e) => {
					e.preventDefault();
					isManualInput = !isManualInput;
					if (isManualInput) {
						targetInputEl.value = this.loreRelations[index].target;
					} else {
						targetSelectEl.value = existingLoreNames.includes(this.loreRelations[index].target) ? this.loreRelations[index].target : '';
					}
					applyMode();
				});

				applyMode();

				// 删除操作按钮
				const removeBtn = rowEl.createEl('button', {
					cls: 'wn-lore-relation-remove-btn',
					text: '✕',
				});
				setTooltip(removeBtn, t('modal.lore-remove-relation'));
				removeBtn.addEventListener('click', (e) => {
					e.preventDefault();
					this.loreRelations.splice(index, 1);
					renderRelationsList();
				});
			});
		};

		relationSectionSetting.addButton(btn => btn
			.setButtonText(t('modal.lore-add-relation'))
			.onClick(() => {
				this.loreRelations.push({ label: '', target: '' });
				renderRelationsList();
			}));

		renderRelationsList();

		// 保存按钮
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

	async saveLore(): Promise<boolean> {
		return this.plugin.characterManager.createLoreEntry(
			this.bookPath,
			this.loreCategory,
			this.loreName,
			this.loreAliases,
			this.loreType,
			this.loreDescription,
			this.loreRelations
		);
	}
}
