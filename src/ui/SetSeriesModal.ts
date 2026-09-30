import type { App } from 'obsidian';
import { Modal, Setting, Notice, type TextComponent, type ButtonComponent } from 'obsidian';
import { t } from '../i18n';

export interface SetSeriesModalOptions {
	currentSeries: string;
	existingSeries: string[];
	onSave: (series: string) => Promise<void>;
}

export class SetSeriesModal extends Modal {
	private currentSeries: string;
	private existingSeries: string[];
	private onSave: (series: string) => Promise<void>;

	private selectedSeries: string = '';
	private isCreatingNew: boolean = false;
	private isSubmitting: boolean = false;
	private textComponent: TextComponent | null = null;
	private clearButton: ButtonComponent | null = null;
	private cancelButton: ButtonComponent | null = null;
	private saveButton: ButtonComponent | null = null;

	constructor(app: App, options: SetSeriesModalOptions) {
		super(app);
		this.currentSeries = options.currentSeries.trim();
		this.existingSeries = options.existingSeries;
		this.onSave = options.onSave;
		this.selectedSeries = this.currentSeries;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName(t('modal.manage-series-title')).setHeading();

		if (this.currentSeries) {
			const currentHint = contentEl.createDiv({ cls: 'setting-item-description' });
			currentHint.setText(t('modal.current-series', { series: this.currentSeries }));
		}

		const seriesSetting = new Setting(contentEl)
			.setName(t('modal.series'))
			.setDesc(t('modal.series-desc'));

		if (this.existingSeries.length > 0) {
			const isExisting = this.existingSeries.includes(this.currentSeries);
			this.isCreatingNew = !isExisting && this.currentSeries.length > 0;

			seriesSetting.addDropdown(dropdown => {
				dropdown.addOption('__NONE__', t('modal.series-none'));
				for (const s of this.existingSeries) {
					dropdown.addOption(s, s);
				}
				dropdown.addOption('__NEW__', t('modal.new-series'));

				if (this.isCreatingNew) {
					dropdown.setValue('__NEW__');
				} else if (this.currentSeries) {
					dropdown.setValue(this.currentSeries);
				} else {
					dropdown.setValue('__NONE__');
				}

				dropdown.onChange(val => {
					if (val === '__NONE__') {
						this.isCreatingNew = false;
						this.selectedSeries = '';
						this.textComponent?.inputEl.hide();
					} else if (val === '__NEW__') {
						this.isCreatingNew = true;
						this.selectedSeries = this.textComponent?.getValue().trim() || '';
						if (this.textComponent) {
							this.textComponent.inputEl.show();
							this.textComponent.inputEl.focus();
						}
					} else {
						this.isCreatingNew = false;
						this.selectedSeries = val;
						this.textComponent?.inputEl.hide();
					}
				});
			});

			seriesSetting.addText(text => {
				this.textComponent = text;
				text.setPlaceholder(t('modal.series-placeholder'));
				if (this.isCreatingNew) {
					text.setValue(this.currentSeries);
					text.inputEl.show();
				} else {
					text.inputEl.hide();
				}
				text.onChange(val => {
					if (this.isCreatingNew) {
						this.selectedSeries = val;
					}
				});
			});
		} else {
			this.isCreatingNew = true;
			seriesSetting.addText(text => {
				this.textComponent = text;
				text.setPlaceholder(t('modal.series-placeholder'));
				text.setValue(this.currentSeries);
				text.onChange(val => {
					this.selectedSeries = val;
				});
				text.inputEl.focus();
			});
		}

		// 按钮容器
		const btnSetting = new Setting(contentEl);

		if (this.currentSeries) {
			btnSetting.addButton(btn => {
				this.clearButton = btn;
				btn.setButtonText(t('modal.clear-series'))
					.setWarning()
					.onClick(() => {
						void this.handleSave('');
					});
			});
		}

		btnSetting.addButton(btn => {
			this.cancelButton = btn;
			btn.setButtonText(t('common.cancel'))
				.onClick(() => this.close());
		});

		btnSetting.addButton(btn => {
			this.saveButton = btn;
			btn.setButtonText(t('modal.save'))
				.setCta()
				.onClick(() => {
					void this.handleSave(this.selectedSeries.trim());
				});
		});

		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.handleSave(this.selectedSeries.trim());
			}
		});
	}

	private async handleSave(seriesToSave: string): Promise<void> {
		if (this.isSubmitting) return;
		this.isSubmitting = true;

		if (this.saveButton) this.saveButton.setDisabled(true);
		if (this.clearButton) this.clearButton.setDisabled(true);
		if (this.cancelButton) this.cancelButton.setDisabled(true);

		try {
			await this.onSave(seriesToSave);
			this.close();
		} catch (error) {
			console.error('[SetSeriesModal] 保存作品系列失败:', error);
			new Notice(t('notice.series-update-failed'));
			this.isSubmitting = false;
			if (this.saveButton) this.saveButton.setDisabled(false);
			if (this.clearButton) this.clearButton.setDisabled(false);
			if (this.cancelButton) this.cancelButton.setDisabled(false);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
