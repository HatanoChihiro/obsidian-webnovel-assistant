import { Modal, Setting, type App, type TFolder } from 'obsidian';
import { t } from '../i18n';
import { validateChapterBasename } from '../services/ChapterSplitter';

export class ChapterSplitCollisionModal extends Modal {
	private readonly suggestedName: string;
	private readonly folder: TFolder | null;
	private readonly reason: 'unrecognized' | 'collision';
	private readonly resolvePromise: (value: string | null) => void;
	private currentInput: string;
	private isResolved = false;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		suggestedName: string,
		folder: TFolder | null,
		reason: 'unrecognized' | 'collision',
		resolve: (value: string | null) => void
	) {
		super(app);
		this.suggestedName = suggestedName;
		this.folder = folder;
		this.reason = reason;
		this.resolvePromise = resolve;
		this.currentInput = suggestedName;
	}

	static prompt(
		app: App,
		suggestedName: string,
		folder: TFolder | null,
		reason: 'unrecognized' | 'collision'
	): Promise<string | null> {
		return new Promise<string | null>((resolve) => {
			const modal = new ChapterSplitCollisionModal(app, suggestedName, folder, reason, resolve);
			modal.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-chapter-split-collision-modal');

		new Setting(contentEl)
			.setName(t('modal.split-chapter-name-title'))
			.setHeading();

		new Setting(contentEl)
			.setDesc(this.reason === 'collision'
				? t('modal.split-chapter-desc', { name: this.suggestedName })
				: t('modal.split-chapter-unrecognized-desc'));

		new Setting(contentEl)
			.setName(t('modal.split-chapter-new-name'))
			.addText((text) => {
				text.setValue(this.currentInput);
				text.setPlaceholder(t('modal.split-chapter-name-placeholder'));
				text.inputEl.focus();
				text.onChange((value) => {
					this.currentInput = value;
					if (this.errorEl) {
						this.errorEl.setText('');
					}
				});
				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter' && !e.isComposing) {
						e.preventDefault();
						this.handleConfirm();
					}
				});
			});

		this.errorEl = contentEl.createDiv({ cls: 'setting-item-description' });

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText(t('modal.split-chapter-cancel'))
					.onClick(() => {
						this.handleCancel();
					});
			})
			.addButton((btn) => {
				btn.setButtonText(t('modal.split-chapter-confirm'))
					.setCta()
					.onClick(() => {
						this.handleConfirm();
					});
			});
	}

	private handleConfirm(): void {
		const validation = validateChapterBasename(this.currentInput, this.app, this.folder);
		if (!validation.valid) {
			if (this.errorEl && validation.errorKey) {
				this.errorEl.setText(t(validation.errorKey));
			}
			return;
		}

		if (!this.isResolved) {
			this.isResolved = true;
			this.resolvePromise(validation.basename ?? null);
		}
		this.close();
	}

	private handleCancel(): void {
		if (!this.isResolved) {
			this.isResolved = true;
			this.resolvePromise(null);
		}
		this.close();
	}

	onClose(): void {
		if (!this.isResolved) {
			this.isResolved = true;
			this.resolvePromise(null);
		}
		this.contentEl.empty();
	}
}
