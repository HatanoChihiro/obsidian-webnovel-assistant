import { Component, Notice } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ProofreadingDiagnostic } from '../types/proofreading';
import { t } from '../i18n';
import { isMobile } from '../utils/platform';
import { isReplacementStale } from '../utils/proofreadingHelpers';

export function getProofreadingDiagnosticDisplayMessage(diag: ProofreadingDiagnostic): string {
	if (diag.source === 'builtin') {
		const suggestion = diag.suggestions[0] || '';
		return t('proofreading.basic-suggestion-hint', { suggestion });
	}

	if (diag.message && diag.message.trim() !== '') {
		return diag.message;
	}

	if (diag.type === 'sensitive') {
		return t('proofreading.sensitive-hint', { word: diag.original });
	}
	if (diag.type === 'wrong_word') {
		const suggestion = diag.suggestions[0] || '';
		return t('proofreading.wrong-word-hint', { suggestion });
	}
	if (diag.type === 'synonym') {
		return t('proofreading.synonym-hint');
	}
	if (diag.type === 'grammar') {
		return t('proofreading.grammar-hint');
	}
	if (diag.type === 'punctuation') {
		return t('proofreading.punctuation-hint');
	}

	return '';
}

export class ProofreadingPopover extends Component {
	private static activePopoversByDoc = new WeakMap<Document, ProofreadingPopover>();

	private targetEl: HTMLElement;
	private diag: ProofreadingDiagnostic;
	private view: EditorView;
	private plugin: WebNovelAssistantPlugin;
	private popoverEl: HTMLElement | null = null;
	private showTimeout: number | null = null;
	private closeTimeout: number | null = null;
	private globalClickTimeout: number | null = null;
	private rafId: number | null = null;
	private isShowing = false;
	private isDisposed = false;
	private immediate: boolean = false;
	private onHideCallback?: () => void;
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;

	constructor(
		targetEl: HTMLElement,
		diag: ProofreadingDiagnostic,
		view: EditorView,
		plugin: WebNovelAssistantPlugin,
		immediate: boolean = false,
		onHide?: () => void
	) {
		super();
		this.targetEl = targetEl;
		this.diag = diag;
		this.view = view;
		this.plugin = plugin;
		this.immediate = immediate;
		this.onHideCallback = onHide;
		this.ownerDocument = targetEl.ownerDocument;
		this.ownerWindow = targetEl.ownerDocument.defaultView ?? window;

		if (isMobile()) {
			this.immediate = true;
		}

		this.load();

		if (this.immediate) {
			this.show();
		} else {
			// 桌面端鼠标悬停防抖 (300ms)
			this.showTimeout = this.ownerWindow.setTimeout(() => {
				this.showTimeout = null;
				if (!this.targetEl.isConnected || !this.targetEl.matches(':hover')) return;
				this.show();
			}, 300);
		}

		this.targetEl.addEventListener('mouseleave', this.onMouseLeaveTarget);
		this.targetEl.addEventListener('mouseenter', this.onMouseEnterTarget);

		if (this.immediate) {
			this.globalClickTimeout = this.ownerWindow.setTimeout(() => {
				this.globalClickTimeout = null;
				if (this.isDisposed) return;
				this.ownerDocument.addEventListener('click', this.onGlobalClick);
			}, 0);
		}

		this.scheduleConnectedCheck();
	}

	private scheduleConnectedCheck(): void {
		if (this.isDisposed) return;
		this.rafId = this.ownerWindow.requestAnimationFrame(this.checkConnected);
	}

	private checkConnected = (): void => {
		this.rafId = null;
		if (this.isDisposed) return;
		if (!this.targetEl.isConnected) {
			this.hide();
			return;
		}
		this.scheduleConnectedCheck();
	};

	private onMouseEnterTarget = () => {
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
	};

	private onMouseLeaveTarget = () => {
		if (this.showTimeout !== null) {
			this.ownerWindow.clearTimeout(this.showTimeout);
			this.showTimeout = null;
		}
		if (!this.immediate && this.isShowing) {
			this.scheduleClose();
		}
	};

	private onMouseEnterPopover = () => {
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
	};

	private onMouseLeavePopover = () => {
		if (!this.immediate && this.isShowing) {
			this.scheduleClose();
		}
	};

	private scheduleClose(): void {
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
		}
		// 给予 200ms 的移动过渡保护期，避免从 target 移向 popover 时瞬间销毁
		this.closeTimeout = this.ownerWindow.setTimeout(() => {
			this.closeTimeout = null;
			if (!this.isShowing || this.isDisposed) return;

			const isTargetHover = this.targetEl.isConnected && this.targetEl.matches(':hover');
			const isPopoverHover = this.popoverEl && this.popoverEl.isConnected && this.popoverEl.matches(':hover');

			if (!isTargetHover && !isPopoverHover) {
				this.hide();
			}
		}, 200);
	}

	private onGlobalClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (this.popoverEl && !this.popoverEl.contains(target) && !this.targetEl.contains(target)) {
			this.hide();
		}
	};

	public show(): void {
		if (this.isDisposed || this.isShowing) return;

		// 保证单 Document 范围内最多只有一个活动的 Popover Component
		const currentActive = ProofreadingPopover.activePopoversByDoc.get(this.ownerDocument);
		if (currentActive && currentActive !== this) {
			currentActive.hide();
		}
		ProofreadingPopover.activePopoversByDoc.set(this.ownerDocument, this);

		this.isShowing = true;
		const popover = this.ownerDocument.body.createDiv({
			cls: `wn-proofreading-popover wn-proofreading-popover-${this.diag.type}`
		});
		this.popoverEl = popover;
		popover.addEventListener('mouseenter', this.onMouseEnterPopover);
		popover.addEventListener('mouseleave', this.onMouseLeavePopover);

		// 头部徽标与原文展示
		const header = popover.createDiv({ cls: 'wn-proofreading-popover-header' });
		const typeBadge = header.createSpan({ cls: `wn-proofreading-badge wn-proofreading-badge-${this.diag.type}` });
		typeBadge.setText(this.getTypeLabel(this.diag.type));

		const origSpan = header.createSpan({ cls: 'wn-proofreading-popover-orig' });
		origSpan.setText(this.diag.original);

		// 提示说明文案
		const messageText = getProofreadingDiagnosticDisplayMessage(this.diag);
		if (messageText) {
			const msgDiv = popover.createDiv({ cls: 'wn-proofreading-popover-msg' });
			msgDiv.setText(messageText);
		}

		// 建议与应用选项
		const actionsDiv = popover.createDiv({ cls: 'wn-proofreading-popover-actions' });
		if (this.diag.suggestions && this.diag.suggestions.length > 0) {
			for (const s of this.diag.suggestions) {
				const btn = actionsDiv.createEl('button', {
					cls: 'wn-proofreading-action-btn',
					text: `${t('proofreading.btn-apply')}: ${s}`
				});
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.applySuggestion(s);
				});
			}
		}

		// 忽略/关闭按钮
		const dismissBtn = actionsDiv.createEl('button', {
			cls: 'wn-proofreading-dismiss-btn',
			text: t('proofreading.btn-dismiss')
		});
		dismissBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.hide();
		});

		this.updatePosition();
	}

	private getTypeLabel(type: string): string {
		switch (type) {
			case 'wrong_word':
				return t('proofreading.type-wrong');
			case 'sensitive':
				return t('proofreading.type-sensitive');
			case 'synonym':
				return t('proofreading.type-synonym');
			case 'grammar':
				return t('proofreading.type-grammar');
			case 'punctuation':
				return t('proofreading.type-punctuation');
			default:
				return t('proofreading.type-wrong');
		}
	}

	private applySuggestion(replacement: string): void {
		const docText = this.view.state.doc.toString();
		const isStale = isReplacementStale(docText, this.diag.from, this.diag.to, this.diag.original);

		if (isStale) {
			new Notice(t('notice.proofreading-stale'));
			this.hide();
			return;
		}

		this.view.dispatch({
			changes: {
				from: this.diag.from,
				to: this.diag.to,
				insert: replacement
			}
		});

		new Notice(t('notice.proofreading-applied', {
			original: this.diag.original,
			replacement
		}));

		this.hide();
	}

	private updatePosition(): void {
		if (!this.popoverEl || !this.targetEl) return;

		const targetRect = this.targetEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();

		let top = targetRect.bottom + 6;
		let left = targetRect.left;

		const winWidth = this.ownerWindow.innerWidth;
		const winHeight = this.ownerWindow.innerHeight;

		// 水平防溢出
		if (left + popoverRect.width > winWidth - 10) {
			left = winWidth - popoverRect.width - 10;
		}
		if (left < 10) left = 10;

		// 垂直防溢出（若下方空间不足则翻转至上方）
		if (top + popoverRect.height > winHeight - 10 && targetRect.top > popoverRect.height + 10) {
			top = targetRect.top - popoverRect.height - 6;
		}

		this.popoverEl.setCssStyles({
			top: `${top}px`,
			left: `${left}px`
		});
	}

	public hide(): void {
		if (this.rafId !== null) {
			this.ownerWindow.cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (ProofreadingPopover.activePopoversByDoc.get(this.ownerDocument) === this) {
			ProofreadingPopover.activePopoversByDoc.delete(this.ownerDocument);
		}

		if (this.popoverEl) {
			this.popoverEl.removeEventListener('mouseenter', this.onMouseEnterPopover);
			this.popoverEl.removeEventListener('mouseleave', this.onMouseLeavePopover);
			this.popoverEl.remove();
			this.popoverEl = null;
		}
		this.isShowing = false;
		if (this.onHideCallback) {
			this.onHideCallback();
			this.onHideCallback = undefined;
		}
		this.unload();
	}

	override onunload(): void {
		this.isDisposed = true;
		if (this.rafId !== null) {
			this.ownerWindow.cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (ProofreadingPopover.activePopoversByDoc.get(this.ownerDocument) === this) {
			ProofreadingPopover.activePopoversByDoc.delete(this.ownerDocument);
		}

		if (this.showTimeout !== null) {
			this.ownerWindow.clearTimeout(this.showTimeout);
			this.showTimeout = null;
		}
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
		if (this.globalClickTimeout !== null) {
			this.ownerWindow.clearTimeout(this.globalClickTimeout);
			this.globalClickTimeout = null;
		}
		this.targetEl.removeEventListener('mouseleave', this.onMouseLeaveTarget);
		this.targetEl.removeEventListener('mouseenter', this.onMouseEnterTarget);
		this.ownerDocument.removeEventListener('click', this.onGlobalClick);

		if (this.popoverEl) {
			this.popoverEl.removeEventListener('mouseenter', this.onMouseEnterPopover);
			this.popoverEl.removeEventListener('mouseleave', this.onMouseLeavePopover);
			this.popoverEl.remove();
			this.popoverEl = null;
		}
	}
}
