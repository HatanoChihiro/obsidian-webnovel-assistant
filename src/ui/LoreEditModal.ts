import { Modal, Setting, setTooltip, setIcon, Notice } from 'obsidian';
import type { App, TextComponent } from 'obsidian';
import type { CharacterManager, LoreEntry, LoreRelationItem, LoreSnapshot } from '../services/CharacterManager';
import { parseLoreBodyForEditing } from '../services/LoreTemplateService';
import { LoreCardRenderer } from './components/LoreCardRenderer';
import { t } from '../i18n';

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
		this.loreRelations = this.snapshot.relations.map(r => ({ ...r }));

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
		const existingLoreNames = Array.from(new Set(existingLoreEntries.map(e => e.heading).filter(Boolean)));

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

		const renderRelationsList = () => {
			relationsListContainer.empty();

			this.loreRelations.forEach((rel, index) => {
				const rowEl = relationsListContainer.createDiv({ cls: 'wn-lore-relation-row' });

				// 关系描述输入框
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

				// 目标设定选择容器
				const targetWrapperEl = rowEl.createDiv({ cls: 'wn-lore-relation-target-wrapper' });
				const isExistingTarget = rel.target ? existingLoreNames.includes(rel.target) : false;
				let isManualInput = !isExistingTarget;

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
				targetSelectEl.value = isExistingTarget ? rel.target : '';

				const targetInputEl = targetWrapperEl.createEl('input', {
					type: 'text',
					cls: 'wn-lore-relation-target-input',
					value: rel.target,
					placeholder: t('modal.lore-relation-target-placeholder'),
				});

				const modeToggleBtn = targetWrapperEl.createEl('button', {
					cls: 'wn-lore-relation-toggle-btn',
				});
				modeToggleBtn.setAttr('type', 'button');

				const applyMode = () => {
					modeToggleBtn.empty();
					if (isManualInput || existingLoreNames.length === 0) {
						targetSelectEl.hide();
						targetInputEl.show();
						setIcon(modeToggleBtn, 'list');
						modeToggleBtn.setAttr('aria-label', t('modal.lore-toggle-select-tooltip'));
						setTooltip(modeToggleBtn, t('modal.lore-toggle-select-tooltip'));
					} else {
						targetInputEl.hide();
						targetSelectEl.show();
						setIcon(modeToggleBtn, 'pencil');
						modeToggleBtn.setAttr('aria-label', t('modal.lore-toggle-input-tooltip'));
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

				// 删除按钮
				const removeBtn = rowEl.createEl('button', {
					cls: 'wn-lore-relation-remove-btn',
					text: '✕',
				});
				removeBtn.setAttr('type', 'button');
				removeBtn.setAttr('aria-label', t('modal.lore-remove-relation'));
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
