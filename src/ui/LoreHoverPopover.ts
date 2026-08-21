import { Component } from 'obsidian';
import { isMobile, getPlatformTier } from '../utils/platform';
import type { AccurateCountSettings } from '../types/settings';
import type { LoreEntry } from '../services/CharacterManager';
import { t } from '../i18n';
import { LoreCardRenderer, type LoreCardRendererPlugin } from './components/LoreCardRenderer';

export interface LoreHoverPopoverPlugin extends LoreCardRendererPlugin {
	settings: Pick<AccurateCountSettings, 'enableMobileLorePopover' | 'lorePopoverCollapse'>;
}

export class LoreHoverPopover extends Component {
	private plugin: LoreHoverPopoverPlugin;
	private entry: LoreEntry;
	private targetEl: HTMLElement;
	private popoverEl: HTMLElement | null = null;
	private closeTimeout: number | null = null;
	private showTimeout: number | null = null;
	private globalClickTimeout: number | null = null;
	private disconnectObserver: MutationObserver | null = null;
	private isShowing = false;
	private disposeAfterShow = false;
	private isDisposed = false;
	private immediate: boolean = false;
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;
	
	constructor(
		targetEl: HTMLElement,
		entry: LoreEntry,
		plugin: LoreHoverPopoverPlugin,
		immediate: boolean = false
	) {
		super();
		this.plugin = plugin;
		this.entry = entry;
		this.targetEl = targetEl;
		this.immediate = immediate;
		this.ownerDocument = targetEl.ownerDocument;
		this.ownerWindow = this.ownerDocument.defaultView ?? window;

		// 移动端无 mouseover/hover，且需校验 enableMobileLorePopover 开关
		if (isMobile()) {
			if (!this.plugin.settings.enableMobileLorePopover) {
				return;
			}
			this.immediate = true;
		}
		this.load();

		if (this.immediate) {
			void this.show();
		} else {
			// 桌面端延迟 1000ms 后显示，避免鼠标快速划过时误触
			this.showTimeout = this.ownerWindow.setTimeout(() => {
				// 确保鼠标没有离开
				if (!this.targetEl.isConnected || !this.targetEl.matches(':hover')) return;
				void this.show();
			}, 1000);
		}

		// 监听鼠标离开目标元素
		this.targetEl.addEventListener('mouseleave', this.onMouseLeaveTarget);

		// 监听全局点击以支持点击外部关闭（服务于移动端与桌面端点击触发）
		if (this.immediate) {
			this.globalClickTimeout = this.ownerWindow.setTimeout(() => {
				this.globalClickTimeout = null;
				if (this.isDisposed || this.disposeAfterShow) return;
				this.ownerDocument.addEventListener('click', this.onGlobalClick);
			}, 0);
		}

		this.disconnectObserver = new MutationObserver(() => {
			if (!this.targetEl.isConnected) this.hide();
		});
		this.disconnectObserver.observe(this.ownerDocument.body, { childList: true, subtree: true });
	}

	private onGlobalClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (this.popoverEl && !this.popoverEl.contains(target) && !this.targetEl.contains(target)) {
			this.hide();
		}
	};

	
	override onunload() {
		this.isDisposed = true;
		this.disposeAfterShow = true;
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
		this.disconnectObserver?.disconnect();
		this.disconnectObserver = null;
		this.removeDomAndListeners();
		super.onunload();
	}

	private onMouseLeaveTarget = () => {
		if (this.showTimeout !== null) {
			this.ownerWindow.clearTimeout(this.showTimeout);
			this.showTimeout = null;
		}
		this.scheduleClose();
	};

	private onMouseEnterPopover = () => {
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
	};

	private onMouseLeavePopover = () => {
		this.scheduleClose();
	};

	private scheduleClose() {
		this.closeTimeout = this.ownerWindow.setTimeout(() => {
			this.hide();
		}, 200);
	}

	private hide() {
		if (this.isDisposed || this.disposeAfterShow) return;
		this.disposeAfterShow = true;
		this.removeDomAndListeners();
		if (!this.isShowing) this.finishDispose();
	}

	private finishDispose() {
		if (this.isDisposed) return;
		this.isDisposed = true;
		this.unload();
	}

	private removeDomAndListeners() {
		if (this.popoverEl) {
			this.popoverEl.removeEventListener('mouseenter', this.onMouseEnterPopover);
			this.popoverEl.removeEventListener('mouseleave', this.onMouseLeavePopover);
			this.popoverEl.remove();
			this.popoverEl = null;
		}
		this.targetEl.removeEventListener('mouseleave', this.onMouseLeaveTarget);
		this.ownerDocument.removeEventListener('click', this.onGlobalClick);
	}

	private async show() {
		if (this.popoverEl || this.isDisposed || this.disposeAfterShow) return;

		this.isShowing = true;
		const popoverEl = this.ownerDocument.body.createDiv();
		popoverEl.remove();
		this.popoverEl = popoverEl;
		popoverEl.addClass('webnovel-lore-popover');
		popoverEl.addClass('wn-lore-hover-popover');
		popoverEl.addEventListener('mouseenter', this.onMouseEnterPopover);
		popoverEl.addEventListener('mouseleave', this.onMouseLeavePopover);

		try {
			if (!this.entry || !this.entry.file) {
				popoverEl.createDiv({ cls: 'wn-lore-card-empty', text: t('corkboard.lore-not-found') });
			} else {
				const cardContainer = popoverEl.createDiv({ cls: 'wn-lore-card-wrapper' });
				await LoreCardRenderer.buildCardDOM(cardContainer, this.entry, this.plugin, this, {
					hideEditButton: true,
					onTitleClick: () => this.hide()
				});
			}
		} catch (error) {
			this.isShowing = false;
			this.removeDomAndListeners();
			this.finishDispose();
			throw error;
		} finally {
			this.isShowing = false;
		}

		if (this.disposeAfterShow || this.isDisposed || !this.targetEl.isConnected) {
			this.removeDomAndListeners();
			this.finishDispose();
			return;
		}

		this.ownerDocument.body.appendChild(popoverEl);
		this.positionPopover();
	}

	private positionPopover() {
		if (!this.popoverEl) return;

		const tier = getPlatformTier();
		const isPhone = tier === 'mobile';
		const padding = isPhone ? 12 : 16;
		const windowWidth = this.ownerWindow.innerWidth;
		const windowHeight = this.ownerWindow.innerHeight;

		// 各平台卡片最大高度上限（与设定卡片一致：桌面与平板 350px，手机 240px）
		const defaultMaxHeight = isPhone ? 240 : 350;

		const rect = this.targetEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();

		// 1. 水平居中对齐到目标词汇
		let left = rect.left + rect.width / 2 - popoverRect.width / 2;
		if (left < padding) left = padding;
		if (left + popoverRect.width > windowWidth - padding) {
			left = windowWidth - popoverRect.width - padding;
		}

		// 2. 垂直定位：默认显示在目标词汇下方
		let top = rect.bottom + 8;
		
		// 如果下方空间不足以放下完整卡片，且上方空间比下方更大，翻转到上方
		const spaceBelow = windowHeight - padding - top;
		const spaceAbove = rect.top - 8 - padding;

		if (popoverRect.height > spaceBelow && spaceAbove > spaceBelow) {
			top = rect.top - popoverRect.height - 8;
		}

		// 边界防护：防止卡片顶部超出屏幕上边界
		if (top < padding) {
			top = padding;
		}

		// 严格高度限制：视口剩余空间与平台默认上限的较小值，确保不超过 350px/240px，且不超出屏幕底部
		const maxAvailHeight = Math.min(defaultMaxHeight, windowHeight - top - padding);
		const finalMaxHeight = maxAvailHeight > 100 ? maxAvailHeight : defaultMaxHeight;

		this.popoverEl.setCssStyles({ top: `${top}px`, left: `${left}px`, maxHeight: `${finalMaxHeight}px` });
	}
}
