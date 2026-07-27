import { Component } from 'obsidian';
import { isMobile } from '../utils/platform';
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
			const cardContainer = this.popoverEl.createDiv();
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

		const mobile = isMobile();
		const maxHeight = mobile ? '45vh' : '35vh';
		const maxWidth = mobile ? 'calc(100vw - 24px)' : '340px';

		// 1. 先限制最大宽高与纵向滚动，让 DOM 重新排版后再获取其真实尺寸，防止由于超出屏幕而被错误计算
		this.popoverEl.setCssStyles({
			maxHeight: maxHeight,
			maxWidth: maxWidth,
			display: 'flex',
			flexDirection: 'column',
			overflowY: 'auto'
		});

		const rect = this.targetEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();
		
		// 2. 默认水平居中对齐到目标词汇
		let left = rect.left + rect.width / 2 - popoverRect.width / 2;
		let top = rect.bottom + 8; // 默认显示在词汇下方

		// 3. 水平防溢出处理
		const padding = mobile ? 12 : 10;
		if (left < padding) left = padding;
		if (left + popoverRect.width > window.innerWidth - padding) {
			left = window.innerWidth - popoverRect.width - padding;
		}
		
		// 4. 垂直防溢出处理：如果下方空间不足以放下整个卡片，则将其翻转到词汇上方
		if (top + popoverRect.height > window.innerHeight - padding) {
			top = rect.top - popoverRect.height - 8;
		}
		
		// 极端情况防御：如果放到上方后连顶部也超出了，则贴着顶部显示
		if (top < padding) {
			top = padding;
		}

		this.popoverEl.setCssStyles({ top: `${top}px`, left: `${left}px` });
	}
}
