import { Modal, Setting, type App } from 'obsidian';
import { t } from '../i18n';

export interface ImmersivePomodoroModalOptions {
	onNextRound: () => void;
	onDismiss: () => void;
	onClose?: () => void;
}

/**
 * 沉浸模式番茄钟提醒弹窗
 */
export class ImmersivePomodoroModal extends Modal {
	private actionTaken: 'next' | 'dismiss' | null = null;
	private isSilent: boolean = false;
	private isOpened: boolean = false;
	private options: ImmersivePomodoroModalOptions;

	private restStartTime: number = 0;
	private timerIntervalId: number | null = null;
	private timerOwnerWindow: Window | null = null;
	private timerEl: HTMLElement | null = null;

	constructor(app: App, options: ImmersivePomodoroModalOptions) {
		super(app);
		this.options = options;
	}

	/**
	 * 静默关闭弹窗（用于清理和退出，不触发 dismiss / nextRound 回调，也不恢复焦点）
	 */
	silentClose(): void {
		this.isSilent = true;
		this.isOpened = false;
		this.clearRestTimer();
		this.close();
	}

	/**
	 * 释放/销毁弹窗资源
	 */
	dispose(): void {
		this.silentClose();
	}

	override close(): void {
		this.isOpened = false;
		this.clearRestTimer();
		super.close();
	}

	onOpen(): void {
		this.isOpened = true;
		this.restStartTime = Date.now();

		const { contentEl, modalEl } = this;
		modalEl.addClass('wn-immersive-pomodoro-modal');
		contentEl.empty();

		new Setting(contentEl)
			.setName(t('immersive.pomodoro-modal-title'))
			.setDesc(t('immersive.pomodoro-modal-desc'))
			.setHeading();

		const restSetting = new Setting(contentEl)
			.setName(t('immersive.pomodoro-rest-time'));
		this.timerEl = restSetting.controlEl.createSpan({
			cls: 'wn-pomodoro-rest-timer',
			text: '00:00:00'
		});

		const buttonSetting = new Setting(contentEl);
		buttonSetting.addButton(button => button
			.setButtonText(t('immersive.pomodoro-dismiss'))
			.onClick(() => {
				this.actionTaken = 'dismiss';
				this.close();
			}));

		buttonSetting.addButton(button => button
			.setButtonText(t('immersive.pomodoro-next-round'))
			.setCta()
			.onClick(() => {
				this.actionTaken = 'next';
				this.close();
			}));

		this.startRestTimer();
	}

	onClose(): void {
		this.isOpened = false;
		this.clearRestTimer();
		this.timerEl = null;
		this.contentEl.empty();
		if (this.isSilent) {
			return;
		}
		const action = this.actionTaken;
		if (action === 'next') {
			this.options.onNextRound();
		} else {
			this.options.onDismiss();
		}
		this.options.onClose?.();
	}

	private startRestTimer(): void {
		this.clearRestTimer();
		const win = this.contentEl?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
		if (!win) {
			return;
		}
		this.timerOwnerWindow = win;
		this.timerIntervalId = win.setInterval(() => {
			this.updateRestTimer();
		}, 1000);
	}

	private updateRestTimer(): void {
		if (!this.isOpened || this.timerIntervalId === null || !this.timerEl) {
			return;
		}
		const elapsedMs = Math.max(0, Date.now() - this.restStartTime);
		const formatted = this.formatElapsedTime(elapsedMs);
		if (this.timerEl.textContent !== formatted) {
			this.timerEl.textContent = formatted;
		}
	}

	private clearRestTimer(): void {
		if (this.timerIntervalId !== null) {
			const win = this.timerOwnerWindow ?? this.contentEl?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
			if (win) {
				win.clearInterval(this.timerIntervalId);
			}
			this.timerIntervalId = null;
		}
		this.timerOwnerWindow = null;
	}

	private formatElapsedTime(elapsedMs: number): string {
		const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const pad = (n: number): string => n.toString().padStart(2, '0');
		return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	}
}
