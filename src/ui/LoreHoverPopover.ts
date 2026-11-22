import { Component, type TFile } from 'obsidian';
import { isMobile, getPlatformTier, isLorePopoverEnabled } from '../utils/platform';
import type { AccurateCountSettings } from '../types/settings';
import type { LoreEntry } from '../services/CharacterManager';
import { t } from '../i18n';
import { LoreCardRenderer, type LoreCardRendererPlugin } from './components/LoreCardRenderer';
import { LoreEditModal, type LoreEditPlugin } from './LoreEditModal';

export interface LoreHoverPopoverPlugin extends LoreCardRendererPlugin {
	settings: Pick<AccurateCountSettings, 'enableLorePopover' | 'enableMobileLorePopover' | 'lorePopoverCollapse'>;
	characterManager: LoreCardRendererPlugin['characterManager'] & Partial<LoreEditPlugin['characterManager']> & {
		isBorrowedLoreEntry?: (entry: LoreEntry, contextBookPath?: string) => boolean;
		getBookPathForFile?: (file: TFile) => string | null;
	};
}

export interface LoreHoverPopoverOptions {
	/** Custom hover check for virtual/canvas anchors where CSS :hover does not apply */
	isTargetHovered?: () => boolean;
	/** Invoked once when the popover disposes and cleans up resources */
	onDispose?: () => void;
}

export class LoreHoverPopover extends Component {
	private static readonly activePopovers = new WeakMap<HTMLElement, LoreHoverPopover>();
	private static readonly openInstances = new Set<LoreHoverPopover>();

	public static closeForDocument(document: Document): void {
		for (const popover of Array.from(LoreHoverPopover.openInstances)) {
			if (popover.ownerDocument === document) popover.hide();
		}
	}

	public static closeAll(): void {
		for (const popover of Array.from(LoreHoverPopover.openInstances)) {
			popover.hide();
		}
		LoreHoverPopover.openInstances.clear();
	}
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
	private originatingBookPath?: string;
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;
	private isTargetHovered?: () => boolean;
	private onDispose?: () => void;
	
	constructor(
		targetEl: HTMLElement,
		entry: LoreEntry,
		plugin: LoreHoverPopoverPlugin,
		immediate: boolean = false,
		originatingBookPath?: string,
		options?: LoreHoverPopoverOptions
	) {
		super();
		this.plugin = plugin;
		this.entry = entry;
		this.targetEl = targetEl;
		this.immediate = immediate;
		this.originatingBookPath = originatingBookPath;
		this.isTargetHovered = options?.isTargetHovered;
		this.onDispose = options?.onDispose;
		this.ownerDocument = targetEl.ownerDocument;
		this.ownerWindow = this.ownerDocument.defaultView ?? window;
		const existing = LoreHoverPopover.activePopovers.get(targetEl);
		if (existing && !existing.isDisposed && !existing.disposeAfterShow) {
			if (!immediate || existing.immediate) return existing;
			existing.hide();
		}

		// 全平台校验设定悬浮卡片开关
		if (!isLorePopoverEnabled(this.plugin.settings)) {
			return;
		}

		if (isMobile()) {
			this.immediate = true;
		}
		LoreHoverPopover.activePopovers.set(targetEl, this);
		LoreHoverPopover.openInstances.add(this);
		this.load();
		this.ownerWindow.addEventListener('unload', this.onOwnerWindowUnload);

		if (this.immediate) {
			void this.show();
		} else {
			// 桌面端延迟 1000ms 后显示，避免鼠标快速划过时误触
			this.showTimeout = this.ownerWindow.setTimeout(() => {
				this.showTimeout = null;
				// 确保鼠标没有离开
				const isHovered = this.isTargetHovered ? this.isTargetHovered() : this.targetEl.matches(':hover');
				if (!this.targetEl.isConnected || !isHovered) {
					this.hide();
					return;
				}
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

		this.disconnectObserver = new MutationObserver(records => {
			if (!records.some(record => record.removedNodes.length > 0)) return;
			if (!this.targetEl.isConnected) this.hide();
			else this.observeTargetAncestors(true);
		});
		this.observeTargetAncestors();
	}

	private observeTargetAncestors(reset: boolean = false): void {
		if (reset) this.disconnectObserver?.disconnect();
		for (let parent = this.targetEl.parentNode; parent; parent = parent.parentNode) {
			this.disconnectObserver?.observe(parent, { childList: true });
		}
	}

	private onGlobalClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (this.popoverEl && !this.popoverEl.contains(target) && !this.targetEl.contains(target)) {
			this.hide();
		}
	};

	
	private onOwnerWindowUnload = () => {
		this.hide();
	};

	private cleanupResources(): void {
		LoreHoverPopover.openInstances.delete(this);
		if (LoreHoverPopover.activePopovers.get(this.targetEl) === this) {
			LoreHoverPopover.activePopovers.delete(this.targetEl);
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
		this.disconnectObserver?.disconnect();
		this.disconnectObserver = null;
		this.removeDomAndListeners();
		const onDispose = this.onDispose;
		this.onDispose = undefined;
		onDispose?.();
	}

	public isActive(): boolean {
		return !this.isDisposed && !this.disposeAfterShow;
	}

	public isCardVisible(): boolean {
		return Boolean(this.popoverEl && this.popoverEl.isConnected && this.isActive());
	}

	public containsTarget(target: EventTarget | null): boolean {
		return Boolean(target && this.popoverEl && this.popoverEl.contains(target as unknown as Node));
	}

	public handleTargetLeave(): void {
		if (!this.isActive()) return;
		if (!this.isCardVisible()) {
			this.hide();
			return;
		}
		if (this.closeTimeout === null) {
			this.scheduleClose();
		}
	}

	public close(): void {
		this.hide();
	}

	public cancelPendingClose(): void {
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
	}

	override onunload() {
		this.isDisposed = true;
		this.disposeAfterShow = true;
		this.cleanupResources();
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
		this.cleanupResources();
		if (!this.isShowing) this.finishDispose();
	}

	private finishDispose() {
		if (this.isDisposed) return;
		this.isDisposed = true;
		LoreHoverPopover.openInstances.delete(this);
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
		this.ownerWindow.removeEventListener('unload', this.onOwnerWindowUnload);
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
				const isBorrowed = this.plugin.characterManager?.isBorrowedLoreEntry
					? this.plugin.characterManager.isBorrowedLoreEntry(this.entry, this.originatingBookPath)
					: false;
				const canEdit = Boolean(this.plugin.characterManager?.updateLoreEntry && !isBorrowed);

				await LoreCardRenderer.buildCardDOM(cardContainer, this.entry, this.plugin, this, {
					hideEditButton: !canEdit,
					hideImportanceButton: false,
					onTitleClick: () => this.hide(),
					onEdit: canEdit ? () => this.openEditModal() : undefined
				});
			}
		} catch (error) {
			this.isShowing = false;
			this.cleanupResources();
			this.finishDispose();
			throw error;
		} finally {
			this.isShowing = false;
		}

		if (this.disposeAfterShow || this.isDisposed || !this.targetEl.isConnected) {
			this.cleanupResources();
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

	private openEditModal(): void {
		if (this.closeTimeout !== null) {
			this.ownerWindow.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
		this.hide();
		new LoreEditModal(
			this.plugin.app,
			this.plugin,
			this.entry,
			this.originatingBookPath
		).open();
	}
}
