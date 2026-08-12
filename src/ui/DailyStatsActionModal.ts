import { Modal, Notice, Setting, type App } from 'obsidian';
import { t } from '../i18n';

export type DailyStatsAction =
	| { type: 'reset-all' }
	| { type: 'reset-words' }
	| { type: 'correct-words'; words: number };

class ConfirmDailyStatsClearAllModal extends Modal {
	constructor(app: App, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		new Setting(this.contentEl)
			.setName(t('command.daily-stats-clear-all-confirm-title'))
			.setDesc(t('command.daily-stats-clear-all-confirm-desc'))
			.setHeading();

		new Setting(this.contentEl)
			.addButton(button => button
				.setButtonText(t('common.cancel'))
				.onClick(() => this.close()))
			.addButton(button => button
				.setButtonText(t('common.confirm'))
				.setWarning()
				.onClick(() => {
					this.onConfirm();
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class DailyStatsActionModal extends Modal {
	private correctedWords: string;

	constructor(
		app: App,
		currentWords: number,
		private onAction: (action: DailyStatsAction) => void
	) {
		super(app);
		this.correctedWords = String(currentWords);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl)
			.setName(t('command.reset-daily-stats-title'))
			.setDesc(t('command.reset-daily-stats-desc'))
			.setHeading();

		new Setting(contentEl)
			.setName(t('command.daily-stats-clear-all'))
			.setDesc(t('command.daily-stats-clear-all-desc'))
			.addButton(button => button
				.setButtonText(t('command.daily-stats-clear-all-action'))
				.setWarning()
				.onClick(() => this.submit({ type: 'reset-all' })));

		new Setting(contentEl)
			.setName(t('command.daily-stats-clear-words'))
			.setDesc(t('command.daily-stats-clear-words-desc'))
			.addButton(button => button
				.setButtonText(t('command.daily-stats-clear-words-action'))
				.onClick(() => this.submit({ type: 'reset-words' })));

		new Setting(contentEl)
			.setName(t('command.daily-stats-correct-words'))
			.setDesc(t('command.daily-stats-correct-words-desc'))
			.addText(text => {
				text.setValue(this.correctedWords)
					.setPlaceholder(t('command.daily-stats-correct-words-placeholder'))
					.onChange(value => { this.correctedWords = value; });
				text.inputEl.type = 'number';
				text.inputEl.step = '1';
			})
			.addButton(button => button
				.setButtonText(t('command.daily-stats-correct-words-action'))
				.setCta()
				.onClick(() => this.submitCorrection()));

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText(t('common.cancel'))
				.onClick(() => this.close()));
	}

	private submitCorrection(): void {
		const value = this.correctedWords.trim();
		if (!/^-?\d+$/.test(value)) {
			new Notice(t('notice.daily-stats-invalid-words'));
			return;
		}
		const words = Number(value);
		if (!Number.isSafeInteger(words)) {
			new Notice(t('notice.daily-stats-invalid-words'));
			return;
		}
		this.submit({ type: 'correct-words', words });
	}

	private submit(action: DailyStatsAction): void {
		if (action.type === 'reset-all') {
			new ConfirmDailyStatsClearAllModal(this.app, () => this.completeSubmit(action)).open();
			return;
		}
		this.completeSubmit(action);
	}

	private completeSubmit(action: DailyStatsAction): void {
		this.onAction(action);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
