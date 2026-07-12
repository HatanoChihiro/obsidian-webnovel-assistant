import { Logger } from '../utils/Logger';
import { Component, MarkdownRenderer, setIcon, Platform } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { LoreEntry } from '../services/CharacterManager';

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

		// 创建自定义卡片容器
		this.popoverEl = activeDocument.body.createDiv({ cls: 'webnovel-lore-popover' });
		this.popoverEl.addClass('wn-absolute-top');
		
		// 监听鼠标进入和离开卡片，保证鼠标移入卡片时不会关闭
		this.popoverEl.addEventListener('mouseenter', this.onMouseEnterPopover);
		this.popoverEl.addEventListener('mouseleave', this.onMouseLeavePopover);

		// 渲染内部 DOM
		await this.renderCard(this.popoverEl);

		// 计算位置
		const rect = this.targetEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();
		
		let top = rect.bottom + 5;
		let left = rect.left;

		// 防止超出屏幕右侧
		if (left + popoverRect.width > window.innerWidth) {
			left = window.innerWidth - popoverRect.width - 10;
		}
		
		// 防止超出屏幕底部 (如果下面空间不够，就显示在上面)
		if (top + popoverRect.height > window.innerHeight) {
			top = rect.top - popoverRect.height - 5;
		}

		if (this.immediate) {
			this.popoverEl.setCssStyles({ maxHeight: '50vh', overflowY: 'auto' });
		}

		this.popoverEl.setCssStyles({ top: `${top}px`, left: `${left}px` });
	}

	private async renderCard(container: HTMLElement) {
		const card = container.createDiv({ cls: 'wn-lore-card' });
		
		// Header area
		const header = card.createDiv({ cls: 'wn-lore-card-header' });
		const titleEl = header.createDiv({ cls: 'wn-lore-card-title' });
		titleEl.setText(this.entry.heading);

		// Body area
		const body = card.createDiv({ cls: 'wn-lore-card-body' });
		const loadingEl = body.createDiv({ cls: 'wn-lore-card-loading', text: 'Loading...' });

		try {
			const fileContent = await this.plugin.app.vault.cachedRead(this.entry.file);
			const fileCache = this.plugin.app.metadataCache.getFileCache(this.entry.file);

			let chunkToRender = '';
			let aliases: string[] = [];

			if (fileCache && fileCache.headings) {
				const headings = fileCache.headings;
				let startIndex = -1;
				let endIndex = -1;

				for (let i = 0; i < headings.length; i++) {
					const h = headings[i];
					const rawHeading = h.heading.replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '');
					if (rawHeading === this.entry.heading && h.level === 2) {
						startIndex = h.position.end.line + 1;
						// 继续向后查找，直到遇到同级或更高级别（<=2）的标题才截断，从而包含其下的小标题
						for (let j = i + 1; j < headings.length; j++) {
							if (headings[j].level <= 2) {
								endIndex = headings[j].position.start.line;
								break;
							}
						}
						break;
					}
				}

				if (startIndex !== -1) {
					const lines = fileContent.split('\n');
					const slice = endIndex === -1 ? lines.slice(startIndex) : lines.slice(startIndex, endIndex);
					const rawChunk = slice.join('\n');

					const aliasMatch = rawChunk.match(/^(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/im);
					if (aliasMatch && aliasMatch[1]) {
						aliases = aliasMatch[1].split(/[,，、/|]/).map(s => s.trim()).filter(Boolean);
						chunkToRender = rawChunk.replace(aliasMatch[0], '').trim();
					} else {
						chunkToRender = rawChunk.trim();
					}
				}
			}

			loadingEl.remove();

			if (aliases.length > 0) {
				const badgesContainer = header.createDiv({ cls: 'wn-lore-card-badges' });
				for (const alias of aliases) {
					badgesContainer.createSpan({ cls: 'wn-lore-card-badge', text: alias });
				}
			}

			if (chunkToRender) {
				const markdownContainer = body.createDiv({ cls: 'wn-lore-markdown' });
				await MarkdownRenderer.render(this.plugin.app, chunkToRender, markdownContainer, this.entry.file.path, this);

				// 根据设置决定是否折叠子标题（### 及以下级别）
				if (this.plugin.settings.lorePopoverCollapse) {
					const headingEls = Array.from(markdownContainer.querySelectorAll('h3, h4, h5, h6'));
					for (const el of headingEls) {
						const level = parseInt(el.tagName.substring(1));
						const siblingsToHide: Element[] = [];
						let next = el.nextElementSibling;

						// 收集当前标题到下一个同级或更高级标题之间的所有元素
						while (next) {
							if (next.tagName.match(/^H[1-6]$/)) {
								const nextLevel = parseInt(next.tagName.substring(1));
								if (nextLevel <= level) break;
							}
							siblingsToHide.push(next);
							next = next.nextElementSibling;
						}

						if (siblingsToHide.length > 0) {
							const details = activeDocument.createElement('details');
							const summary = activeDocument.createElement('summary');
							summary.setCssStyles({ cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center' });

							const iconEl = activeDocument.createElement('div');
							iconEl.addClass('collapse-indicator');
							iconEl.addClass('collapse-icon');
							setIcon(iconEl, 'right-triangle');
							summary.appendChild(iconEl);

							const clonedHeading = el.cloneNode(true) as HTMLElement;
							clonedHeading.setCssStyles({ display: 'inline-block', margin: '0', marginLeft: '4px' });

							summary.appendChild(clonedHeading);
							details.appendChild(summary);

							for (const sib of siblingsToHide) {
								details.appendChild(sib);
							}

							el.replaceWith(details);
						}
					}
				}
			} else {
				body.createDiv({ cls: 'wn-lore-card-empty', text: 'No content.' });
			}
			
			// 重新计算位置，因为内容填充后高度变了
			const rect = this.targetEl.getBoundingClientRect();
			const popoverRect = this.popoverEl!.getBoundingClientRect();
			let top = rect.bottom + 5;
			if (top + popoverRect.height > window.innerHeight) {
				top = rect.top - popoverRect.height - 5;
			}
			this.popoverEl!.setCssStyles({ top: `${top}px` });

		} catch (e) {
			Logger.error('Failed to render lore popover:', e);
			loadingEl.setText('Failed to load lore data.');
		}
	}
}
