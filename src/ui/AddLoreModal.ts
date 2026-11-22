import { showPluginNotice } from '../services/PluginNoticeService';
import { Modal, Setting, TFile } from 'obsidian';
import type { App, TextComponent, TFolder, ButtonComponent } from 'obsidian';
import type { CharacterManager, LoreCategoryOption } from '../services/CharacterManager';
import { buildLoreOutline, collectLoreTypes, scanLoreHeadings } from '../services/LoreOutline';
import { t } from '../i18n';
import { renderLoreRelationEditor } from './LoreRelationEditor';
import { FileSuggestModal } from './FileSuggestModal';
import {
	parseLoreTemplate,
	normalizeLoreTemplateHistory,
	rememberLoreTemplatePath,
	removeLoreTemplatePath,
	type ParsedTemplate
} from '../services/LoreTemplateService';
import type { AccurateCountSettings } from '../types/settings';
import { Logger } from '../utils/Logger';

export interface LoreRelationItem {
	label: string;
	target: string;
}

export interface AddLorePlugin {
	characterManager: Pick<CharacterManager, 'findLoreFolder' | 'getLoreEntriesInFileOrder' | 'createLoreEntry' | 'getAvailableLoreCategories'>;
	settings: Pick<AccurateCountSettings, 'loreTemplateHistory'>;
	saveSettings(): Promise<void>;
}

interface TemplateDraftCacheEntry {
	content: string;
	values: Record<string, string>;
}

export class AddLoreModal extends Modal {
	private plugin: AddLorePlugin;
	private loreName: string;
	private loreLevel = 2;
	private parentKey?: string;
	private loreCategory: string;
	private loreType: string;
	private loreAliases: string;
	private loreDescription: string;
	private loreRelations: LoreRelationItem[];
	private bookPath: string;
	private isCreatingNew: boolean = false;
	private availableCategories: LoreCategoryOption[] = [];
	private selectedTargetFile: TFile | null = null;

	private selectedTemplateFile: TFile | null = null;
	private parsedTemplate: ParsedTemplate | null = null;
	private templateDraftCache = new Map<string, TemplateDraftCacheEntry>();
	private templateReadToken: number = 0;
	private isReadingTemplate: boolean = false;
	private isUpdatingHistory: boolean = false;
	private isSaving: boolean = false;
	private isModalClosed: boolean = false;

	private templateSetting: Setting | null = null;
	private selectTemplateBtn: ButtonComponent | null = null;
	private clearTemplateBtn: ButtonComponent | null = null;
	private templateHistoryContainerEl: HTMLElement | null = null;
	private historyButtons: Array<{ button: ButtonComponent; action: 'use' | 'remove'; isAvailable?: boolean }> = [];
	private templateContainerEl: HTMLElement | null = null;
	private descriptionSetting: Setting | null = null;
	private saveSetting: Setting | null = null;
	private saveButton: ButtonComponent | null = null;

	constructor(app: App, plugin: AddLorePlugin, initialName: string, bookPath: string) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal');
		this.plugin = plugin;
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
	private isHistoryActionDisabled(): boolean {
		return this.isModalClosed || this.isSaving || this.isReadingTemplate || this.isUpdatingHistory;
	}

	private updateSaveButtonState(): void {
		if (this.saveButton) {
			this.saveButton.setDisabled(this.isSaving || this.isReadingTemplate || this.isUpdatingHistory);
		}
	}

	private updateTemplateActionButtonsState(): void {
		const disabled = this.isSaving || this.isReadingTemplate || this.isUpdatingHistory;
		if (this.selectTemplateBtn) {
			this.selectTemplateBtn.setDisabled(disabled);
		}
		if (this.clearTemplateBtn) {
			this.clearTemplateBtn.setDisabled(disabled);
		}
	}

	private updateHistoryButtonsState(): void {
		const disabled = this.isHistoryActionDisabled();
		for (const item of this.historyButtons) {
			if (item.action === 'use') {
				item.button.setDisabled(disabled || !item.isAvailable);
			} else {
				item.button.setDisabled(disabled);
			}
		}
	}

	private updateAllButtonsState(): void {
		this.updateSaveButtonState();
		this.updateTemplateActionButtonsState();
		this.updateHistoryButtonsState();
	}

	private updateTemplateSettingUI(): void {
		if (!this.templateSetting) return;

		const hint = t('modal.lore-template-desc');
		const pathText = this.selectedTemplateFile ? ` (${this.selectedTemplateFile.path})` : '';
		this.templateSetting.setDesc(`${hint}${pathText}`);

		if (this.selectTemplateBtn) {
			this.selectTemplateBtn.setButtonText(
				this.selectedTemplateFile ? t('modal.lore-template-change') : t('modal.lore-template-select')
			);
		}

		if (this.clearTemplateBtn) {
			if (this.selectedTemplateFile) {
				this.clearTemplateBtn.buttonEl.show();
			} else {
				this.clearTemplateBtn.buttonEl.hide();
			}
		}
	}

	private renderTemplateHistory(): void {
		if (!this.templateHistoryContainerEl) {
			return;
		}

		this.templateHistoryContainerEl.empty();
		this.historyButtons = [];

		const rawHistory = this.plugin.settings?.loreTemplateHistory;
		const history = normalizeLoreTemplateHistory(rawHistory);

		if (history.length === 0) {
			return;
		}

		for (const path of history) {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			const isAvailable = abstractFile instanceof TFile;
			const filename = path.split('/').pop() || path;

			const entrySetting = new Setting(this.templateHistoryContainerEl)
				.setName(filename);

			entrySetting.settingEl.addClass('wn-lore-template-history-item');

			if (isAvailable) {
				entrySetting.setDesc(path);
			} else {
				entrySetting.settingEl.addClass('is-unavailable');
				entrySetting.setDesc(`${path} (${t('modal.lore-template-unavailable')})`);
			}

			entrySetting.addButton(btn => {
				btn.setButtonText(t('modal.lore-template-use'))
					.setDisabled(!isAvailable || this.isHistoryActionDisabled())
					.onClick(() => {
						if (abstractFile instanceof TFile) {
							void this.onSelectTemplate(abstractFile);
						}
					});
				this.historyButtons.push({ button: btn, action: 'use', isAvailable });
			});

			entrySetting.addButton(btn => {
				btn.setButtonText(t('modal.lore-template-remove-record'))
					.setDisabled(this.isHistoryActionDisabled())
					.onClick(() => {
						void this.onRemoveHistoryEntry(path);
					});
				this.historyButtons.push({ button: btn, action: 'remove' });
			});
		}
	}

	private async commitHistoryUpdate(
		updateFn: (currentHistory: string[]) => string[]
	): Promise<void> {
		if (this.isModalClosed || this.isUpdatingHistory) {
			return;
		}

		this.isUpdatingHistory = true;
		this.updateAllButtonsState();

		const prevHistory = this.plugin.settings?.loreTemplateHistory ?? [];
		const nextHistory = updateFn(prevHistory);

		this.plugin.settings.loreTemplateHistory = nextHistory;

		if (!this.isModalClosed) {
			this.renderTemplateHistory();
		}

		try {
			await this.plugin.saveSettings();
		} catch (error) {
			Logger.error('[AddLoreModal] 保存设定模板历史记录失败:', error);
			showPluginNotice(t('notice.lore-template-history-save-failed'));

			// Restore previous history on failure only if it is still the exact operation's array reference
			if (this.plugin.settings.loreTemplateHistory === nextHistory) {
				this.plugin.settings.loreTemplateHistory = prevHistory;
				if (!this.isModalClosed) {
					this.renderTemplateHistory();
				}
			}
		} finally {
			this.isUpdatingHistory = false;
			if (!this.isModalClosed) {
				this.updateAllButtonsState();
			}
		}
	}

	private async onRemoveHistoryEntry(path: string): Promise<void> {
		if (this.isHistoryActionDisabled()) {
			return;
		}
		await this.commitHistoryUpdate(h => removeLoreTemplatePath(h, path));
	}

	private async onSelectTemplate(file: TFile): Promise<void> {
		if (this.isModalClosed || this.isSaving || this.isUpdatingHistory) {
			return;
		}

		const currentToken = ++this.templateReadToken;
		this.isReadingTemplate = true;
		this.updateAllButtonsState();

		try {
			const content = await this.app.vault.cachedRead(file);
			if (this.isModalClosed || currentToken !== this.templateReadToken) {
				return;
			}

			// 解析并准备数据，确保解析失败时不覆盖现有已选模板
			const parsed = parseLoreTemplate(content);

			let draftValues: Record<string, string> = {};
			const cachedDraft = this.templateDraftCache.get(file.path);
			if (cachedDraft && cachedDraft.content === content) {
				draftValues = { ...cachedDraft.values };
			} else {
				for (const field of parsed.fields) {
					draftValues[field.id] = field.defaultValue;
				}
			}

			for (const field of parsed.fields) {
				if (draftValues[field.id] === undefined) {
					draftValues[field.id] = field.defaultValue;
				}
			}

			this.templateDraftCache.set(file.path, { content, values: draftValues });
			this.selectedTemplateFile = file;
			this.parsedTemplate = parsed;

			this.updateTemplateSettingUI();
			this.renderTemplateFields();
			this.updateDescriptionPosition();

			// Committed template read succeeded. Reset isReadingTemplate before awaiting history persistence.
			this.isReadingTemplate = false;

			// Integrate history update after successful committed template read
			await this.commitHistoryUpdate(h => rememberLoreTemplatePath(h, file.path));
		} catch {
			if (this.isModalClosed || currentToken !== this.templateReadToken) {
				return;
			}
			showPluginNotice(t('notice.lore-template-read-failed'));
		} finally {
			if (!this.isModalClosed && currentToken === this.templateReadToken) {
				this.isReadingTemplate = false;
				this.updateAllButtonsState();
			}
		}
	}

	private clearTemplate(): void {
		this.templateReadToken++;
		this.isReadingTemplate = false;
		this.selectedTemplateFile = null;
		this.parsedTemplate = null;
		this.updateAllButtonsState();
		this.updateTemplateSettingUI();
		if (this.templateContainerEl) {
			this.templateContainerEl.empty();
		}
		this.updateDescriptionPosition();
	}

	private updateDescriptionPosition(): void {
		const anchor = this.selectedTemplateFile ? this.saveSetting : this.templateSetting;
		if (this.descriptionSetting && anchor) {
			this.contentEl.insertBefore(this.descriptionSetting.settingEl, anchor.settingEl);
		}
	}

	private renderTemplateFields(): void {
		if (!this.templateContainerEl || !this.parsedTemplate || !this.selectedTemplateFile) {
			return;
		}

		this.templateContainerEl.empty();
		const cached = this.templateDraftCache.get(this.selectedTemplateFile.path);
		const draftValues = cached ? cached.values : {};
		let lastSectionHeading: string | undefined = undefined;

		for (const field of this.parsedTemplate.fields) {
			if (field.sectionHeading && field.sectionHeading !== lastSectionHeading && field.type !== 'heading_section') {
				lastSectionHeading = field.sectionHeading;
				this.templateContainerEl.createDiv({
					cls: 'wn-lore-template-section-title',
					text: field.sectionHeading,
				});
			}

			const setting = new Setting(this.templateContainerEl)
				.setName(field.label);

			const currentVal = draftValues[field.id] !== undefined ? draftValues[field.id] : field.defaultValue;

			// 所有动态控件均使用多行文本域以支持多行输入
			setting.addTextArea(text => {
				text.inputEl.rows = field.isMultiline ? 3 : 1;
				text.setValue(currentVal).onChange(value => {
					draftValues[field.id] = value;
				});
			});
		}
	}

	async onOpen() {
		this.isModalClosed = false;
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

		// 获取可用分类列表（包含本地分类与同系列公共分类）
		this.availableCategories = await this.plugin.characterManager.getAvailableLoreCategories(this.bookPath);
		if (this.isModalClosed) return;

		if (this.availableCategories.length > 0) {
			// 优先选中第一个本地分类；若无可降级为第一个可用分类
			const defaultOpt = this.availableCategories.find(c => !c.isBorrowed) || this.availableCategories[0];
			this.loreCategory = defaultOpt.baseName;
			this.selectedTargetFile = defaultOpt.file ?? null;
		} else {
			this.loreCategory = '';
			this.selectedTargetFile = null;
		}
		this.isCreatingNew = this.selectedTargetFile === null;
		let refreshParents = () => {};

		const categorySetting = new Setting(contentEl)
			.setName(t('modal.lore-category'))
			.setDesc(t('modal.lore-category-desc'));
			
		categorySetting.addDropdown(dropdown => {
			for (const opt of this.availableCategories) {
				dropdown.addOption(opt.id, opt.displayName);
			}
			dropdown.addOption('__NEW__', t('modal.new-category'));
			if (this.selectedTargetFile) {
				dropdown.setValue(this.selectedTargetFile.path);
			} else {
				dropdown.setValue('__NEW__');
			}
			
			dropdown.onChange(value => {
				if (value === '__NEW__') {
					this.isCreatingNew = true;
					this.selectedTargetFile = null;
					this.loreCategory = '';
					textComponent.inputEl.show();
					textComponent.inputEl.focus();
				} else {
					this.isCreatingNew = false;
					const chosen = this.availableCategories.find(c => c.id === value);
					if (chosen) {
						this.selectedTargetFile = chosen.file ?? null;
						this.loreCategory = chosen.baseName;
					}
					textComponent.inputEl.hide();
				}
				this.parentKey = undefined;
				refreshParents();
			});
		});

		new Setting(contentEl)
			.setName(t('modal.lore-heading-level'))
			.addDropdown(dropdown => {
				for (let level = 1; level <= 5; level++) {
					dropdown.addOption(String(level), t('heading-wheel.level', { level: String(level) }));
				}
				dropdown.setValue(String(this.loreLevel)).onChange(value => {
					this.loreLevel = Number(value);
					this.parentKey = undefined;
					refreshParents();
				});
			});
		const parentsContainer = contentEl.createDiv();
		let parentRead = 0;
		refreshParents = () => {
			const generation = ++parentRead;
			parentsContainer.empty();
			const targetFile = this.selectedTargetFile;
			if (!targetFile || this.loreLevel === 1) return;
			void this.app.vault.cachedRead(targetFile).then(source => {
				if (this.isModalClosed || generation !== parentRead) return;
				const lines = source.split(/\r?\n/);
				const parents = buildLoreOutline(scanLoreHeadings(lines), lines.length).filter(parent => parent.level < this.loreLevel);
				if (!parents.length) return;
				new Setting(parentsContainer)
					.setName(t('modal.lore-local-parent'))
					.addDropdown(dropdown => {
						dropdown.addOption('', t('modal.lore-local-parent-auto'));
						for (const parent of parents) dropdown.addOption(parent.key, parent.path.join(' › '));
						dropdown.setValue(this.parentKey ?? '').onChange(value => { this.parentKey = value || undefined; });
					});
			}).catch(() => { /* Destination may have been removed. */ });
		};
		refreshParents();

		let textComponent: TextComponent;
		categorySetting.addText(text => {
			textComponent = text;
			text.setPlaceholder(t('modal.new-category-placeholder'))
				.onChange(value => {
					if (this.isCreatingNew) {
						this.loreCategory = value;
					}
				});
			if (!this.isCreatingNew) text.inputEl.hide();
			return text;
		});

		// 类型（参考分类：收集已有类型，支持下拉选择与新建）
		const existingFiles = this.availableCategories
			.map(c => c.file)
			.filter((f): f is TFile => f instanceof TFile);
		const existingTypes = await collectLoreTypes(this.app, existingFiles);
		if (this.isModalClosed) return;

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
		this.descriptionSetting = new Setting(contentEl)
			.setName(t('modal.lore-description'))
			.addTextArea(text => {
				text.inputEl.rows = 3;
				text.setValue(this.loreDescription)
					.onChange(value => {
						this.loreDescription = value;
					});
			});

		// 设定模板选择与动态表单
		this.templateSetting = new Setting(contentEl)
			.setName(t('modal.lore-template'));

		this.templateSetting.addButton(btn => {
			this.selectTemplateBtn = btn;
			btn.setButtonText(this.selectedTemplateFile ? t('modal.lore-template-change') : t('modal.lore-template-select'))
				.onClick(() => {
					new FileSuggestModal(this.app, (file: TFile) => {
						void this.onSelectTemplate(file);
					}).open();
				});
		});

		this.templateSetting.addButton(btn => {
			this.clearTemplateBtn = btn;
			btn.setButtonText(t('modal.lore-template-clear'))
				.onClick(() => {
					this.clearTemplate();
				});
			if (!this.selectedTemplateFile) {
				btn.buttonEl.hide();
			}
		});

		this.updateTemplateSettingUI();

		this.templateHistoryContainerEl = contentEl.createDiv({ cls: 'wn-lore-template-history-container' });
		this.renderTemplateHistory();

		this.templateContainerEl = contentEl.createDiv({ cls: 'wn-lore-template-container' });

		// 收集当前书籍所有的设定名称，用于目标设定的下拉自动补全
		const existingLoreEntries = this.plugin.characterManager.getLoreEntriesInFileOrder(this.bookPath);

		// 设定关系列表
		const relationSectionSetting = new Setting(contentEl)
			.setName(t('modal.lore-relations'))
			.setDesc(t('modal.lore-relations-desc'));

		const relationsListContainer = contentEl.createDiv({ cls: 'wn-lore-relations-container' });

		renderLoreRelationEditor(this.app, relationSectionSetting, relationsListContainer, existingLoreEntries, this.loreRelations);

		// 保存按钮
		this.saveSetting = new Setting(contentEl)
			.addButton(btn => {
				this.saveButton = btn;
				btn.setButtonText(t('common.save'))
					.setCta()
					.onClick(async () => {
						if (this.isSaving || this.isReadingTemplate) {
							return;
						}
						if (!this.loreName.trim() || !this.loreCategory.trim()) {
							return;
						}
						this.isSaving = true;
						this.updateSaveButtonState();
						this.updateTemplateActionButtonsState();
						try {
							const success = await this.saveLore();
							if (success && !this.isModalClosed) {
								this.close();
							} else if (!success && !this.isModalClosed) {
								showPluginNotice(t('notice.lore-save-failed'));
							}
						} catch {
							if (!this.isModalClosed) {
								showPluginNotice(t('notice.lore-save-failed'));
							}
						} finally {
							this.isSaving = false;
							if (!this.isModalClosed) {
								this.updateSaveButtonState();
								this.updateTemplateActionButtonsState();
							}
						}
					});
				this.updateSaveButtonState();
			});
	}

	onClose() {
		this.isModalClosed = true;
		this.templateReadToken++;
		this.isReadingTemplate = false;
		this.isSaving = false;

		this.templateSetting = null;
		this.selectTemplateBtn = null;
		this.clearTemplateBtn = null;
		this.templateHistoryContainerEl = null;
		this.historyButtons = [];
		this.templateContainerEl = null;
		this.descriptionSetting = null;
		this.saveSetting = null;
		this.saveButton = null;

		const { contentEl } = this;
		contentEl.empty();
	}

	async saveLore(): Promise<boolean> {
		let templateBody: string | undefined = undefined;
		if (this.parsedTemplate && this.selectedTemplateFile) {
			const cached = this.templateDraftCache.get(this.selectedTemplateFile.path);
			const draftValues = cached ? cached.values : {};
			templateBody = this.parsedTemplate.render(draftValues);
		}

		return this.plugin.characterManager.createLoreEntry(
			this.bookPath,
			this.loreCategory,
			this.loreName,
			this.loreAliases,
			this.loreType,
			this.loreDescription,
			this.loreRelations,
			this.selectedTargetFile?.path,
			templateBody,
			this.loreLevel !== 2 || this.parentKey ? { level: this.loreLevel, parentKey: this.parentKey } : undefined
		);
	}
}
