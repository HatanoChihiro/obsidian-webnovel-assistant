import { Modal, Setting, Notice } from 'obsidian';
import type { App, TextComponent } from 'obsidian';
import type { CharacterManager, LoreEntry, LoreRelationItem, LoreSnapshot } from '../services/CharacterManager';
import { parseLoreBodyForEditing } from '../services/LoreTemplateService';
import { LoreCardRenderer } from './components/LoreCardRenderer';
import { t } from '../i18n';
import { renderLoreRelationEditor } from './LoreRelationEditor';

export interface LoreEditPlugin {
	app: App;
	characterManager: {
		getLoreSnapshot?: CharacterManager['getLoreSnapshot'];
		updateLoreEntry?: CharacterManager['updateLoreEntry'];
		getLoreEntriesInFileOrder?: CharacterManager['getLoreEntriesInFileOrder'];
		findLoreFolder?: CharacterManager['findLoreFolder'];
		getAvailableLoreCategories?: CharacterManager['getAvailableLoreCategories'];
		isBorrowedLoreEntry?: CharacterManager['isBorrowedLoreEntry'];
	};
}

export class LoreEditModal extends Modal {
	private plugin: LoreEditPlugin;
	private entry: LoreEntry;
	private bookPath: string;
	private snapshot: LoreSnapshot | null = null;

	private loreName: string = '';
	private loreType: string = '';
	private loreAliases: string = '';
	private loreDescription: string = '';
	private loreRelations: LoreRelationItem[] = [];

	private isSaving: boolean = false;
	private isModalClosed: boolean = false;

	constructor(app: App, plugin: LoreEditPlugin, entry: LoreEntry, contextBookPath?: string) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal');
		this.plugin = plugin;
		this.entry = entry;
		this.bookPath = contextBookPath || '';
	}

	async onOpen(): Promise<void> {
		this.isModalClosed = false;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-add-lore-modal');
		contentEl.addClass('wn-edit-lore-modal');

		new Setting(contentEl).setName(t('modal.edit-lore')).setHeading();

		// Load snapshot
		try {
			this.snapshot = this.plugin.characterManager.getLoreSnapshot
				? await this.plugin.characterManager.getLoreSnapshot(this.entry, this.bookPath)
				: null;
		} catch {
			new Notice(t('notice.lore-save-failed'));
			this.close();
			return;
		}
		if (this.isModalClosed) return;

		if (!this.snapshot) {
			new Notice(t('notice.lore-save-failed'));
			this.close();
			return;
		}

		if (this.snapshot.isBorrowed) {
			new Notice(t('notice.lore-borrowed-readonly'));
			this.close();
			return;
		}

		this.loreName = this.snapshot.name;
		this.loreType = this.snapshot.type;
		this.loreAliases = this.snapshot.aliases;
		this.loreDescription = this.snapshot.body;
		this.loreRelations = this.snapshot.rawRelationItems?.map((row, sourceId) => ({ ...row, sourceId }))
			?? this.snapshot.relations.map(row => ({ ...row }));

		// 1. 设定分类（只读展示，不可移动分类）
		new Setting(contentEl)
			.setName(t('modal.lore-category'))
			.setDesc(this.snapshot.categoryDisplayName || this.snapshot.category || '');

		// 2. 设定名称 (正名)
		new Setting(contentEl)
			.setName(t('modal.lore-name'))
			.addText(text => text
				.setValue(this.loreName)
				.onChange(value => {
					this.loreName = value;
				}));

		// 3. 设定类型（收集已有类型，支持下拉选择与新建）
		let isCreatingNewType = false;
		let typeTextComponent: TextComponent | null = null;

		const existingLoreEntries = this.plugin.characterManager.getLoreEntriesInFileOrder
			? this.plugin.characterManager.getLoreEntriesInFileOrder(this.bookPath)
			: [];

		const typeSetting = new Setting(contentEl)
			.setName(t('modal.lore-type'))
			.setDesc(t('modal.lore-type-desc'));

		typeSetting.addDropdown(dropdown => {
			dropdown.addOption('__NONE__', t('modal.lore-type-none'));
			if (this.loreType) {
				dropdown.addOption(this.loreType, this.loreType);
			}
			dropdown.addOption('__NEW__', t('modal.new-type'));
			dropdown.setValue(this.loreType ? this.loreType : '__NONE__');

			dropdown.onChange(value => {
				if (value === '__NEW__') {
					isCreatingNewType = true;
					this.loreType = '';
					typeTextComponent?.inputEl.show();
					typeTextComponent?.inputEl.focus();
				} else if (value === '__NONE__') {
					isCreatingNewType = false;
					this.loreType = '';
					typeTextComponent?.inputEl.hide();
				} else {
					isCreatingNewType = false;
					this.loreType = value;
					typeTextComponent?.inputEl.hide();
				}
			});
		});

		typeSetting.addText(text => {
			typeTextComponent = text;
			text.setPlaceholder(t('modal.new-type-placeholder'))
				.onChange(value => {
					if (isCreatingNewType) {
						this.loreType = value;
					}
				});
			text.inputEl.hide();
			return text;
		});

		// 4. 别名
		new Setting(contentEl)
			.setName(t('modal.lore-aliases'))
			.setDesc(t('modal.lore-aliases-desc'))
			.addText(text => text
				.setValue(this.loreAliases)
				.onChange(value => {
					this.loreAliases = value;
				}));

		// 5. 按模板规则拆分正文，保留未修改字段与原文格式。
		const parsedBody = parseLoreBodyForEditing(this.loreDescription);
		const bodyValues: Record<string, string> = {};
		const bodyContainer = contentEl.createDiv({ cls: 'wn-lore-template-container' });
		let lastSectionHeading: string | undefined;
		for (const field of parsedBody.fields) {
			if (field.sectionHeading && field.sectionHeading !== lastSectionHeading && field.type !== 'heading_section') {
				bodyContainer.createDiv({ cls: 'wn-lore-template-section-title', text: field.sectionHeading });
			}
			lastSectionHeading = field.sectionHeading;
			new Setting(bodyContainer)
				.setName(field.label || t('modal.lore-description'))
				.addTextArea(text => {
					text.inputEl.rows = field.isMultiline ? 3 : 1;
					text.setValue(field.defaultValue).onChange(value => {
						bodyValues[field.id] = value;
						this.loreDescription = parsedBody.render(bodyValues);
					});
				});
		}

		// 6. 设定关系列表
		const relationSectionSetting = new Setting(contentEl)
			.setName(t('modal.lore-relations'))
			.setDesc(t('modal.lore-relations-desc'));

		const relationsListContainer = contentEl.createDiv({ cls: 'wn-lore-relations-container' });

		renderLoreRelationEditor(this.app, relationSectionSetting, relationsListContainer, existingLoreEntries, this.loreRelations, this.entry);

		// 保存按钮
		new Setting(contentEl)
			.addButton(btn => {
				btn.setButtonText(t('common.save'))
					.setCta()
					.onClick(async () => {
						if (this.isSaving) return;
						if (!this.loreName.trim()) {
							new Notice(t('notice.lore-name-invalid'));
							return;
						}
						this.isSaving = true;
						btn.setDisabled(true);
						try {
							const success = await this.saveLore();
							if (success) {
								LoreCardRenderer.clearLoreBodyCache(this.entry.file);
								this.isSaving = false;
								if (!this.isModalClosed) {
									this.close();
								}
								return;
							}
							new Notice(t('notice.lore-save-failed'));
						} catch {
							new Notice(t('notice.lore-save-failed'));
						} finally {
							this.isSaving = false;
							if (!this.isModalClosed) {
								btn.setDisabled(false);
							}
						}
					});
			});
	}

	close(): void {
		if (this.isSaving) return;
		super.close();
	}

	onClose(): void {
		this.isModalClosed = true;
		const { contentEl } = this;
		contentEl.empty();
	}

	async saveLore(): Promise<boolean> {
		if (!this.plugin.characterManager.updateLoreEntry) return false;
		return this.plugin.characterManager.updateLoreEntry(this.entry, {
			oldHeading: this.snapshot ? this.snapshot.heading : this.entry.heading,
			newHeading: this.loreName,
			type: this.loreType,
			aliases: this.loreAliases,
			body: this.loreDescription,
			relations: this.loreRelations,
			contextBookPath: this.bookPath,
			expectedSnapshot: this.snapshot ?? undefined
		});
	}
}
