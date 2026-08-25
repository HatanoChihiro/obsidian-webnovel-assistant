import { Modal, Setting, Notice, type App } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t, getLocale } from '../i18n';
import { validateSynonymGroupInput } from '../utils/proofreadingHelpers';
import { SENSITIVE_WORDS_FILE_EN } from '../services/ProofreadingManager';

export type AnnotateType = 'wrong' | 'synonym' | 'sensitive';

export class AnnotateDictModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private selectedText: string;
	private currentType: AnnotateType = 'wrong';

	// 错词表单字段
	private wrongWord: string = '';
	private wrongSuggestion: string = '';
	private wrongDescription: string = '';

	// 近义词表单字段
	private synonymWordsInput: string = '';
	private synonymDescription: string = '';

	// 敏感词表单字段
	private sensitiveWord: string = '';
	private sensitiveSuggestions: string = '';
	private sensitiveSeverity: 'warning' | 'info' = 'warning';
	private sensitiveExceptions: string = '';
	private sensitiveDescription: string = '';

	constructor(app: App, plugin: WebNovelAssistantPlugin, selectedText: string) {
		super(app);
		this.plugin = plugin;
		this.selectedText = selectedText.trim();
		this.wrongWord = this.selectedText;
		this.sensitiveWord = this.selectedText;

		// 检查当前选词是否已存在于某个近义词组中
		const snapshot = this.plugin.proofreadingManager?.getDictSnapshot();
		if (snapshot) {
			const existingSynonym = snapshot.synonyms.get(this.selectedText);
			if (existingSynonym) {
				this.synonymWordsInput = existingSynonym.group.words.join('、');
				this.synonymDescription = existingSynonym.group.description || '';
			} else {
				this.synonymWordsInput = `${this.selectedText}、`;
			}
		} else {
			this.synonymWordsInput = `${this.selectedText}、`;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-annotate-dict-modal');

		this.titleEl.setText(t('modal.annotate-dict-title'));

		this.renderForm();
	}

	private renderForm(): void {
		const { contentEl } = this;
		contentEl.empty();

		// 类型选择
		new Setting(contentEl)
			.setName(t('modal.annotate-type'))
			.addDropdown(dropdown => {
				dropdown
					.addOption('wrong', t('modal.annotate-type-wrong'))
					.addOption('synonym', t('modal.annotate-type-synonym'))
					.addOption('sensitive', t('modal.annotate-type-sensitive'))
					.setValue(this.currentType)
					.onChange((val) => {
						this.currentType = val as AnnotateType;
						this.renderForm();
					});
			});

		if (this.currentType === 'wrong') {
			this.renderWrongWordsForm(contentEl);
		} else if (this.currentType === 'synonym') {
			this.renderSynonymForm(contentEl);
		} else if (this.currentType === 'sensitive') {
			this.renderSensitiveForm(contentEl);
		}

		// 底部操作按钮
		const buttonContainer = contentEl.createDiv({ cls: 'wn-modal-button-container' });
		const submitSetting = new Setting(buttonContainer);
		submitSetting.infoEl.remove();

		submitSetting
			.addButton(btn => {
				btn.setButtonText(t('common.cancel'))
					.onClick(() => {
						this.close();
					});
			})
			.addButton(btn => {
				btn.setButtonText(t('common.save'))
					.setCta()
					.onClick(() => {
						void this.handleSubmit();
					});
			});
	}

	private renderWrongWordsForm(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('modal.annotate-word'))
			.addText(text => {
				text.setValue(this.wrongWord)
					.onChange(val => { this.wrongWord = val.trim(); });
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-suggestion'))
			.addText(text => {
				text.setPlaceholder(t('modal.annotate-suggestion-placeholder'))
					.setValue(this.wrongSuggestion)
					.onChange(val => { this.wrongSuggestion = val.trim(); });
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-description'))
			.addText(text => {
				text.setValue(this.wrongDescription)
					.onChange(val => { this.wrongDescription = val.trim(); });
			});
	}

	private renderSynonymForm(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('modal.annotate-synonym-group'))
			.setDesc(t('modal.annotate-synonym-group-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.annotate-synonym-placeholder'))
					.setValue(this.synonymWordsInput)
					.onChange(val => { this.synonymWordsInput = val; });
				text.inputEl.addClass('webnovel-settings-input-full');
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-description'))
			.addText(text => {
				text.setValue(this.synonymDescription)
					.onChange(val => { this.synonymDescription = val.trim(); });
			});
	}

	private renderSensitiveForm(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('modal.annotate-word'))
			.addText(text => {
				text.setValue(this.sensitiveWord)
					.onChange(val => { this.sensitiveWord = val.trim(); });
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-suggestions'))
			.addText(text => {
				text.setPlaceholder(t('modal.annotate-suggestions-placeholder'))
					.setValue(this.sensitiveSuggestions)
					.onChange(val => { this.sensitiveSuggestions = val.trim(); });
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-sensitive-level'))
			.addDropdown(dropdown => {
				dropdown
					.addOption('warning', t('modal.annotate-level-warning'))
					.addOption('info', t('modal.annotate-level-info'))
					.setValue(this.sensitiveSeverity)
					.onChange(val => { this.sensitiveSeverity = val as 'warning' | 'info'; });
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-exceptions'))
			.addText(text => {
				text.setPlaceholder(t('modal.annotate-exceptions-placeholder'))
					.setValue(this.sensitiveExceptions)
					.onChange(val => { this.sensitiveExceptions = val.trim(); });
			});

		new Setting(containerEl)
			.setName(t('modal.annotate-description'))
			.addText(text => {
				text.setValue(this.sensitiveDescription)
					.onChange(val => { this.sensitiveDescription = val.trim(); });
			});
	}

	private async handleSubmit(): Promise<void> {
		if (!this.plugin.proofreadingManager) {
			new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-write-failed') }));
			return;
		}

		if (this.currentType === 'wrong') {
			if (!this.wrongWord) {
				new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-word-empty') }));
				return;
			}
			if (!this.wrongSuggestion) {
				new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-suggestion-empty') }));
				return;
			}

			const rowData = [this.wrongWord, this.wrongSuggestion, this.wrongDescription];
			const success = await this.plugin.proofreadingManager.updateTableEntry('wrong', this.wrongWord, rowData);
			if (success) {
				new Notice(t('notice.annotate-dict-success'));
				this.close();
			} else {
				new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-write-failed') }));
			}
		} else if (this.currentType === 'synonym') {
			const snapshot = this.plugin.proofreadingManager.getDictSnapshot();
			const validation = validateSynonymGroupInput(
				this.synonymWordsInput,
				this.selectedText,
				snapshot.synonyms
			);

			if (!validation.valid) {
				let errorMsg = t('modal.annotate-error-write-failed');
				if (validation.errorCode === 'EMPTY_INPUT') {
					errorMsg = t('modal.annotate-error-synonym-empty');
				} else if (validation.errorCode === 'LESS_THAN_TWO') {
					errorMsg = t('modal.annotate-error-synonym-min-two');
				} else if (validation.errorCode === 'CROSS_GROUP_COLLISION') {
					errorMsg = t('modal.annotate-error-synonym-collision', { word: validation.conflictWord || '' });
				}
				new Notice(t('notice.annotate-dict-failed', { error: errorMsg }));
				return;
			}

			const groupWordsFormatted = validation.words.join('、');
			const rowData = [groupWordsFormatted, this.synonymDescription];
			const success = await this.plugin.proofreadingManager.updateTableEntry('synonym', this.selectedText, rowData);
			if (success) {
				new Notice(t('notice.annotate-dict-success'));
				this.close();
			} else {
				new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-write-failed') }));
			}
		} else if (this.currentType === 'sensitive') {
			if (!this.sensitiveWord) {
				new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-word-empty') }));
				return;
			}

			const dictPath = this.plugin.settings.proofreading?.dictionaryPath;
			const paths = dictPath ? this.plugin.proofreadingManager.getResolvedDictFilePaths(dictPath) : null;
			const isEnglishDict = paths ? paths.sensitiveFileName === SENSITIVE_WORDS_FILE_EN : (getLocale() === 'en');
			const severityText = this.sensitiveSeverity === 'warning'
				? (isEnglishDict ? 'Warning' : '警告')
				: (isEnglishDict ? 'Info' : '提示');
			const rowData = [
				this.sensitiveWord,
				this.sensitiveSuggestions,
				severityText,
				this.sensitiveExceptions,
				this.sensitiveDescription
			];

			const success = await this.plugin.proofreadingManager.updateTableEntry('sensitive', this.sensitiveWord, rowData);
			if (success) {
				new Notice(t('notice.annotate-dict-success'));
				this.close();
			} else {
				new Notice(t('notice.annotate-dict-failed', { error: t('modal.annotate-error-write-failed') }));
			}
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
