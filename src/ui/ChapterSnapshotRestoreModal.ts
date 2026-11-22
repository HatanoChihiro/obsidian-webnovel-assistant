import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export class RestoreSnapshotConfirmModal extends Modal {
	private readonly ownerDoc: Document;
	private readonly timeLabel: string;
	private readonly targetPath: string;
	private readonly isRecreate: boolean;
	private readonly resolvePromise: (confirmed: boolean) => void;
	private isResolved = false;
	private boundUnload: (() => void) | null = null;

	constructor(
		app: App,
		ownerDoc: Document,
		timeLabel: string,
		targetPath: string,
		isRecreate: boolean,
		resolve: (confirmed: boolean) => void
	) {
		super(app);
		this.ownerDoc = ownerDoc;
		this.timeLabel = timeLabel;
		this.targetPath = targetPath;
		this.isRecreate = isRecreate;
		this.resolvePromise = resolve;
		this.modalEl?.addClass?.('wn-plugin-modal');
	}

	open(): void {
		this.ownerDoc.defaultView?.focus?.();
		super.open();
		if (this.containerEl.ownerDocument !== this.ownerDoc) {
			this.cancel();
			return;
		}
		if (this.ownerDoc.defaultView && !this.boundUnload) {
			this.boundUnload = () => this.cancel();
			this.ownerDoc.defaultView.addEventListener('unload', this.boundUnload);
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-snapshot-restore-modal');

		new Setting(contentEl)
			.setHeading()
			.setName(t('snapshot.replay-restore-confirm-title'));

		contentEl.createEl('p', {
			text: this.isRecreate
				? t('snapshot.replay-restore-confirm-recreate-desc', { time: this.timeLabel, path: this.targetPath })
				: t('snapshot.replay-restore-confirm-desc', { time: this.timeLabel, path: this.targetPath })
		});

		const btnContainer = contentEl.createDiv({ cls: 'wn-snapshot-restore-modal-actions' });
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.cancel();

		const confirmBtn = btnContainer.createEl('button', {
			text: t('snapshot.replay-restore-confirm-btn'),
			cls: 'mod-warning'
		});
		confirmBtn.onclick = () => this.confirm();
	}

	public confirm(): void {
		if (!this.isResolved) {
			this.isResolved = true;
			this.resolvePromise(true);
		}
		this.close();
	}

	public cancel(): void {
		if (!this.isResolved) {
			this.isResolved = true;
			this.resolvePromise(false);
		}
		this.close();
	}

	onClose(): void {
		if (this.boundUnload && this.ownerDoc.defaultView) {
			this.ownerDoc.defaultView.removeEventListener('unload', this.boundUnload);
			this.boundUnload = null;
		}
		if (!this.isResolved) {
			this.isResolved = true;
			this.resolvePromise(false);
		}
		this.contentEl.empty();
	}
}
