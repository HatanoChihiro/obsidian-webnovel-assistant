import type { App } from 'obsidian';
import { Modal, Setting, type TextComponent } from 'obsidian';
import type { NovelMetadata } from '../types/homepage';
import { t } from '../i18n';

export class NewNovelModal extends Modal {
	private onSubmit: (result: { name: string; meta: Partial<NovelMetadata> }) => void;
	private existingSeries: string[] = [];

	private novelName: string = '';
	private series: string = '';
	private synopsis: string = '';
	private protagonist: string = '';
	private genre: string = '';
	private wordGoal: string = '';

	constructor(app: App, onSubmit: (result: { name: string; meta: Partial<NovelMetadata> }) => void, existingSeries?: string[]) {
		super(app);
		this.onSubmit = onSubmit;
		this.existingSeries = existingSeries || [];
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(t('modal.new-novel')).setHeading();

		new Setting(contentEl)
			.setName(t('modal.novel-name'))
			.setDesc(t('modal.novel-name-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.novel-name-placeholder'));
				text.onChange(value => { this.novelName = value; });
				text.inputEl.focus();
			});

		const seriesSetting = new Setting(contentEl)
			.setName(t('modal.series'))
			.setDesc(t('modal.series-desc'));

		if (this.existingSeries.length > 0) {
			let isCreatingNew = false;
			let textComp: TextComponent | null = null;

			seriesSetting.addDropdown(dropdown => {
				dropdown.addOption('__NONE__', t('modal.series-none'));
				for (const s of this.existingSeries) {
					dropdown.addOption(s, s);
				}
				dropdown.addOption('__NEW__', t('modal.new-series'));
				dropdown.setValue('__NONE__');

				dropdown.onChange(val => {
					if (val === '__NONE__') {
						isCreatingNew = false;
						this.series = '';
						textComp?.inputEl.hide();
					} else if (val === '__NEW__') {
						isCreatingNew = true;
						this.series = '';
						if (textComp) {
							textComp.setValue('');
							textComp.inputEl.show();
							textComp.inputEl.focus();
						}
					} else {
						isCreatingNew = false;
						this.series = val;
						textComp?.inputEl.hide();
					}
				});
			});

			seriesSetting.addText(text => {
				textComp = text;
				text.setPlaceholder(t('modal.series-placeholder'));
				text.inputEl.hide();
				text.onChange(val => {
					if (isCreatingNew) {
						this.series = val;
					}
				});
			});
		} else {
			seriesSetting.addText(text => {
				text.setPlaceholder(t('modal.series-placeholder'));
				text.onChange(val => {
					this.series = val;
				});
			});
		}

		new Setting(contentEl)
			.setName(t('modal.synopsis'))
			.setDesc(t('modal.synopsis-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.synopsis-placeholder'));
				text.onChange(value => { this.synopsis = value; });
			});

		new Setting(contentEl)
			.setName(t('modal.genre'))
			.setDesc(t('modal.genre-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.genre-placeholder'));
				text.onChange(value => { this.genre = value; });
			});

		new Setting(contentEl)
			.setName(t('modal.total-word-goal'))
			.setDesc(t('modal.total-word-goal-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.total-word-goal-placeholder'));
				text.onChange(value => { this.wordGoal = value; });
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('common.create'))
				.setCta()
				.onClick(() => { this.submit(); })
			);

		// Enter 键提交
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && this.novelName.trim()) this.submit();
		});
	}

	private submit(): void {
		if (!this.novelName.trim()) return;

		const meta: Partial<NovelMetadata> = {
			name: this.novelName.trim(),
			synopsis: this.synopsis.trim(),
			genre: this.genre.trim(),
			wordGoal: parseInt(this.wordGoal) || 0,
		};
		if (this.series.trim()) {
			meta.series = this.series.trim();
		}

		this.onSubmit({ name: this.novelName.trim(), meta });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}