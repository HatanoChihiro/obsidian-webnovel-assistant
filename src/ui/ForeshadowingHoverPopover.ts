import { Component, Platform } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import { getForeshadowingStatusText } from '../i18n/data-keys';

export class ForeshadowingHoverPopover extends Component {
	private plugin: WebNovelAssistantPlugin;
	private title: string;
	private entries: ParsedForeshadowingEntry[];
	private targetEl: HTMLElement;
	private popoverEl: HTMLElement | null = null;
	private closeTimeout: number | null = null;
	private showTimeout: number | null = null;
	private immediate: boolean = false;

	constructor(
		targetEl: HTMLElement,
		title: string,
		entries: ParsedForeshadowingEntry[],
		plugin: WebNovelAssistantPlugin,
		immediate: boolean = false
	) {
		super();
		this.plugin = plugin;
		this.title = title;
		this.entries = entries;
		this.targetEl = targetEl;
		this.immediate = immediate;

		if (Platform.isMobile) {
			this.immediate = true;
		}

		if (this.immediate) {
			void this.show();
		} else {
			this.showTimeout = window.setTimeout(() => {
				if (!this.targetEl.matches(':hover')) return;
				void this.show();
			}, 400);
		}

		this.targetEl.addEventListener('mouseleave', this.onMouseLeaveTarget);

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

	private show() {
		if (this.popoverEl) return;

		this.popoverEl = createDiv({ cls: 'webnovel-lore-popover wn-foreshadowing-hover-popover' });
		this.popoverEl.addEventListener('mouseenter', this.onMouseEnterPopover);
		this.popoverEl.addEventListener('mouseleave', this.onMouseLeavePopover);

		// Header
		const header = this.popoverEl.createDiv({ cls: 'wn-foreshadowing-popover-header' });
		header.createSpan({ cls: 'wn-foreshadowing-popover-title', text: this.title });

		// Body List
		const listContainer = this.popoverEl.createDiv({ cls: 'wn-foreshadowing-popover-list' });

		for (const entry of this.entries) {
			const item = listContainer.createDiv({ cls: 'wn-foreshadowing-popover-item' });
			item.createDiv({ cls: 'wn-foreshadowing-popover-desc', text: entry.description || '伏笔细节' });

			if (entry.tags && entry.tags.length > 0) {
				const tagsEl = item.createDiv({ cls: 'wn-foreshadowing-popover-tags' });
				entry.tags.forEach(t => tagsEl.createSpan({ cls: 'wn-foreshadowing-tag-badge', text: `#${t}` }));
			}

			const statusText = getForeshadowingStatusText(entry.status);
			const metaEl = item.createDiv({ cls: 'wn-foreshadowing-popover-meta' });
			metaEl.createSpan({ cls: `wn-foreshadowing-status-pill status-${entry.status}`, text: statusText });

			if (entry.sourceFile) {
				metaEl.createSpan({ cls: 'wn-foreshadowing-source-info', text: `起源: ${entry.sourceFile}` });
			}
		}

		activeDocument.body.appendChild(this.popoverEl);
		this.positionPopover();
	}

	private positionPopover() {
		if (!this.popoverEl) return;

		const isMobile = Platform.isMobile;
		const maxHeight = isMobile ? '45vh' : '35vh';
		const maxWidth = isMobile ? 'calc(100vw - 24px)' : '320px';

		this.popoverEl.setCssStyles({
			maxHeight: maxHeight,
			maxWidth: maxWidth,
			display: 'flex',
			flexDirection: 'column',
			overflowY: 'auto'
		});

		const rect = this.targetEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();

		let left = rect.left + rect.width / 2 - popoverRect.width / 2;
		let top = rect.bottom + 8;

		const padding = isMobile ? 12 : 10;
		if (left < padding) left = padding;
		if (left + popoverRect.width > window.innerWidth - padding) {
			left = window.innerWidth - popoverRect.width - padding;
		}

		if (top + popoverRect.height > window.innerHeight - padding) {
			top = rect.top - popoverRect.height - 8;
		}
		if (top < padding) {
			top = padding;
		}

		this.popoverEl.setCssStyles({ top: `${top}px`, left: `${left}px` });
	}
}
