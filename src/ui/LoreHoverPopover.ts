import { Component } from 'obsidian';
import { isMobile, getPlatformTier } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { LoreEntry } from '../services/CharacterManager';
import { t } from '../i18n';
import { LoreCardRenderer } from './components/LoreCardRenderer';

export class LoreHoverPopover extends Component {
	private plugin: WebNovelAssistantPlugin;
	private entry: LoreEntry;
	private targetEl: HTMLElement;
	private popoverEl: HTMLElement | null = null;
	private closeTimeout: number | null = null;
	private showTimeout: number | null = null;
	private immediate: boolean = false;
	
	constructor(
		targetEl: HTMLElement,
		entry: LoreEntry,
		plugin: WebNovelAssistantPlugin,
		immediate: boolean = false
	) {
		super();
		this.plugin = plugin;
		this.entry = entry;
		this.targetEl = targetEl;
		this.immediate = immediate;

		// 移动端无 mouseover/hover，且需校验 enableMobileLorePopover 开关
		if (isMobile()) {
			if (!this.plugin.settings.enableMobileLorePopover) {
				return;
			}
			this.immediate = true;
		}

		if (this.immediate) {
			void this.show();
		} else {
			// 桌面端延迟 1000ms 后显示，避免鼠标快速划过时误触
			this.showTimeout = window.setTimeout(() => {
				// 确保鼠标没有离开
				if (!this.targetEl.matches(':hover')) return;
				void this.show();
			}, 1000);
		}

		// 监听鼠标离开目标元素
		this.targetEl.addEventListener('mouseleave', this.onMouseLeaveTarget);

		// 监听全局点击以支持点击外部关闭（服务于移动端与桌面端点击触发）
		if (this.immediate) {
			window.setTimeout(() => {
				activeDocument.addEventListener('click', this.onGlobalClick);
			}, 0);
		}
	}

	private onGlobalClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (this.popoverEl && !this.popoverEl.contains(target) && !this.targetEl.contains(target)) {
			this.hide();
		}
	};

	
	override onunload() {
		if (this.showTimeout !== null) {
			window.clearTimeout(this.showTimeout);
			this.showTimeout = null;
		}
		if (this.closeTimeout !== null) {
			window.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
		this.hide();
		super.onunload();
	}

	private onMouseLeaveTarget = () => {
		if (this.showTimeout !== null) {
			window.clearTimeout(this.showTimeout);
			this.showTimeout = null;
		}
		this.scheduleClose();
	};

	private onMouseEnterPopover = () => {
		if (this.closeTimeout !== null) {
			window.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
	};

	private onMouseLeavePopover = () => {
		this.scheduleClose();
	};

	private scheduleClose() {
		this.closeTimeout = window.setTimeout(() => {
			this.hide();
		}, 200);
	}

	private hide() {
		if (this.popoverEl) {
			this.popoverEl.removeEventListener('mouseenter', this.onMouseEnterPopover);
			this.popoverEl.removeEventListener('mouseleave', this.onMouseLeavePopover);
			this.popoverEl.remove();
			this.popoverEl = null;
		}
		this.targetEl.removeEventListener('mouseleave', this.onMouseLeaveTarget);
		activeDocument.removeEventListener('click', this.onGlobalClick);
	}

	private async show() {
		if (this.popoverEl) return;

		this.popoverEl = createDiv();
		this.popoverEl.addClass('webnovel-lore-popover');
		this.popoverEl.addClass('wn-lore-hover-popover');
		this.popoverEl.addEventListener('mouseenter', this.onMouseEnterPopover);
		this.popoverEl.addEventListener('mouseleave', this.onMouseLeavePopover);

		if (!this.entry || !this.entry.file) {
			this.popoverEl.createDiv({ cls: 'wn-lore-card-empty', text: t('corkboard.lore-not-found') });
		} else {
			const cardContainer = this.popoverEl.createDiv({ cls: 'wn-lore-card-wrapper' });
			await LoreCardRenderer.buildCardDOM(cardContainer, this.entry, this.plugin, this, {
				hideEditButton: true,
				onTitleClick: () => this.hide()
			});
		}

		activeDocument.body.appendChild(this.popoverEl);
		this.positionPopover();
	}

	private positionPopover() {
		if (!this.popoverEl) return;

		const tier = getPlatformTier();
		const isPhone = tier === 'mobile';
		const padding = isPhone ? 12 : 16;
		const windowWidth = window.innerWidth;
		const windowHeight = window.innerHeight;

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
