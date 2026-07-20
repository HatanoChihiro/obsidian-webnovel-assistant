import { Component, Platform } from 'obsidian';
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

		if (Platform.isMobile) return;

		if (immediate) {
			void this.show();
		} else {
			// 延迟 1000ms 后显示，避免鼠标快速划过时误触
			this.showTimeout = window.setTimeout(() => {
				// 确保鼠标没有离开
				if (!this.targetEl.matches(':hover')) return;
				void this.show();
			}, 1000);
		}

		// 监听鼠标离开目标元素
		this.targetEl.addEventListener('mouseleave', this.onMouseLeaveTarget);

		// 监听全局点击以支持点击外部关闭（主要服务于移动端点击触发）
		if (immediate) {
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

		// 1. 先限制最大高度，让 DOM 重新排版后再获取其真实尺寸，防止由于超出屏幕而被错误计算
		// 使用 35vh 限制高度，让小屏幕笔记本更加友好
		this.popoverEl.setCssStyles({ maxHeight: '35vh', display: 'flex' });

		const rect = this.targetEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();
		
		// 2. 默认水平居中对齐到目标词汇
		let left = rect.left + rect.width / 2 - popoverRect.width / 2;
		let top = rect.bottom + 8; // 默认显示在词汇下方

		// 3. 水平防溢出处理
		if (left < 10) left = 10;
		if (left + popoverRect.width > window.innerWidth - 10) {
			left = window.innerWidth - popoverRect.width - 10;
		}
		
		// 4. 垂直防溢出处理：如果下方空间不足以放下整个卡片，则将其翻转到词汇上方
		if (top + popoverRect.height > window.innerHeight - 10) {
			top = rect.top - popoverRect.height - 8;
		}
		
		// 极端情况防御：如果放到上方后连顶部也超出了，则贴着顶部显示
		if (top < 10) {
			top = 10;
		}

		this.popoverEl.setCssStyles({ top: `${top}px`, left: `${left}px` });
	}
}
