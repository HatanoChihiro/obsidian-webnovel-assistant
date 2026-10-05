import { Component, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { AccurateCountSettings } from '../../types/settings';
import type { LoreEntry } from '../../services/CharacterManager';
import { isMobile } from '../../utils/platform';
import { LoreCardRenderer, type LoreCardRendererPlugin } from './LoreCardRenderer';

export interface LoreCardPreviewPlugin extends Omit<LoreCardRendererPlugin, 'app'> {
	app: LoreCardRendererPlugin['app'];
	settings: LoreCardRendererPlugin['settings'] &
		Pick<AccurateCountSettings, 'loreCardPreviewEnabled' | 'loreCardHoverPreview' | 'loreCardPreviewPersistent' | 'loreCardPreviewMaxCount'>;
}

export interface LoreCardPreviewOptions {
	/** 悬停后延迟弹出的毫秒数（默认 400ms，避免划过误触） */
	showDelayMs?: number;
	/** 鼠标离开卡片与面板后的宽限毫秒数（默认 200ms，允许鼠标在两者间移动） */
	closeGraceMs?: number;
	/** 面板关闭后的回调（不用于重新触发） */
	onClose?: () => void;
}

/** 面板宽度上限（像素），同时受视口宽度约束 */
const PREVIEW_MAX_WIDTH = 680;
/** 面板高度上限（像素），同时受视口高度约束 */
const PREVIEW_MAX_HEIGHT = 720;
/** 面板与视口边缘、锚点之间的安全间距（像素） */
const VIEWPORT_PADDING = 16;
/** 锚点与面板之间的间距（像素） */
const ANCHOR_GAP = 10;
/** 面板占视口高度的比例上限 */
const VIEWPORT_HEIGHT_RATIO = 0.78;
/** 设定卡片外层容器类名（与 LoreBoardRenderer / LoreHoverPopover 保持一致） */
const LORE_CARD_WRAPPER_CLASS = 'wn-lore-card-wrapper';
/** 常驻面板数量上限的可接受范围 */
const MAX_OPEN_PREVIEWS_MIN = 1;
const MAX_OPEN_PREVIEWS_MAX = 10;
const MAX_OPEN_PREVIEWS_DEFAULT = 3;

/**
 * 设定卡片悬停大预览面板。
 *
 * 卡片视图的紧凑卡片受 aspect-ratio 与宽度限制，长词条（尤其含 Markdown 表格、
 * 代码块）会被裁切。本组件在悬停或点击展开按钮时弹出大尺寸只读面板，
 * 复用 LoreCardRenderer 的渲染管线完整呈现词条内容。
 *
 * 设计要点：
 * - 延迟弹出：鼠标停留在卡片上超过 showDelayMs 才弹出，划过不触发。
 * - 鼠标可从卡片移入面板而不关闭（宽限计时器），移出后延迟关闭。
 * - 卡片被移除、面板滚动、窗口尺寸变化、Esc、点击面板外均立即关闭。
 * - 移动端无 hover，仅由卡片头部的展开按钮触发。
 * - 该功能默认关闭（settings.loreCardHoverPreview），由用户在设置中主动开启。
 */
export class LoreCardPreview extends Component {
	private static readonly activePreviews = new WeakMap<HTMLElement, LoreCardPreview>();
	/** 当前已弹出的面板实例，按打开先后排序，用于常驻数量上限的淘汰 */
	private static readonly openPreviews: LoreCardPreview[] = [];
	private static readonly allInstances = new Set<LoreCardPreview>();

	private readonly targetEl: HTMLElement;
	private readonly entry: LoreEntry;
	private readonly plugin: LoreCardPreviewPlugin;
	private readonly options: LoreCardPreviewOptions;
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;
	private readonly showDelayMs: number;
	private readonly closeGraceMs: number;

	private panelEl: HTMLElement | null = null;
	/** 面板内部卡片渲染所用的组件，随面板一同卸载以释放 Markdown 渲染注册的事件 */
	private cardComponent: Component | null = null;
	private showTimeout: number | null = null;
	private closeTimeout: number | null = null;
	private domObserver: MutationObserver | null = null;
	private isDisposed = false;
	private isOpening = false;
	/** 面板渲染期间收到关闭请求（滚动/Esc），渲染完成后不再挂载 */
	private closeRequested = false;
	/** 重定位的 requestAnimationFrame 句柄（滚动/resize 合并到单帧） */
	private repositionFrame: number | null = null;
	/** 标记卡片是否曾挂载到 live DOM，避免卡片在离屏 buffer 构建阶段误判为销毁 */
	private hasBeenConnected = false;

	/**
	 * 关闭当前所有已弹出或异步打开中的预览面板并清空静态登记（总开关关闭或视图重载时使用）
	 */
	static closeAll(): void {
		for (const preview of Array.from(LoreCardPreview.allInstances)) {
			preview.close();
		}
		LoreCardPreview.openPreviews.length = 0;
	}

	/**
	 * 为卡片挂载悬停预览（同一元素复用同一实例，避免重复注册监听）。
	 * 返回已挂载或新建的预览实例。
	 */
	static attach(
		targetEl: HTMLElement,
		entry: LoreEntry,
		plugin: LoreCardPreviewPlugin,
		options: LoreCardPreviewOptions = {}
	): LoreCardPreview {
		const existing = LoreCardPreview.activePreviews.get(targetEl);
		if (existing && !existing.isDisposed) return existing;

		const preview = new LoreCardPreview(targetEl, entry, plugin, options);
		LoreCardPreview.activePreviews.set(targetEl, preview);
		return preview;
	}

	constructor(
		targetEl: HTMLElement,
		entry: LoreEntry,
		plugin: LoreCardPreviewPlugin,
		options: LoreCardPreviewOptions = {}
	) {
		super();
		this.targetEl = targetEl;
		this.entry = entry;
		this.plugin = plugin;
		this.options = options;
		this.ownerDocument = targetEl.ownerDocument ?? document;
		this.ownerWindow = this.ownerDocument.defaultView ?? window;
		this.showDelayMs = options.showDelayMs ?? 400;
		this.closeGraceMs = options.closeGraceMs ?? 200;
		this.hasBeenConnected = this.targetEl.isConnected;

		this.load();
		LoreCardPreview.allInstances.add(this);

		this.targetEl.addEventListener('mouseenter', this.onTargetEnter);
		this.targetEl.addEventListener('mouseleave', this.onTargetLeave);
		this.targetEl.addEventListener('focus', this.onTargetEnter);
		this.targetEl.addEventListener('blur', this.onTargetLeave);

		if (this.hasBeenConnected) {
			this.observeTargetAncestors();
		}
	}

	/** 卡片头部的展开按钮入口：立即弹出（受总开关控制，移动端无 hover 时唯一入口） */
	open(): void {
		if (this.isDisposed || !this.plugin.settings.loreCardPreviewEnabled) return;
		if (!this.targetEl.isConnected) return;
		this.hasBeenConnected = true;
		this.observeTargetAncestors();
		this.clearShowTimeout();
		void this.show();
	}

	/** 是否已弹出面板 */
	isOpen(): boolean {
		return this.panelEl !== null;
	}

	/** 关闭面板并释放内部组件，但保留悬停监听（卡片仍可再次触发预览） */
	close(): void {
		this.closeRequested = true;
		this.clearTimers();
		this.removePanel();
	}

	override onunload(): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		this.closeRequested = true;
		LoreCardPreview.allInstances.delete(this);
		if (LoreCardPreview.activePreviews.get(this.targetEl) === this) {
			LoreCardPreview.activePreviews.delete(this.targetEl);
		}
		this.clearTimers();
		this.cancelRepositionFrame();
		this.removePanel();
		this.disconnectDomObserver();
		this.targetEl.removeEventListener('mouseenter', this.onTargetEnter);
		this.targetEl.removeEventListener('mouseleave', this.onTargetLeave);
		this.targetEl.removeEventListener('focus', this.onTargetEnter);
		this.targetEl.removeEventListener('blur', this.onTargetLeave);
		super.onunload();
	}

	/**
	 * 监听卡片祖先链的节点移除：卡片被看板重绘或移出文档时结束预览生命周期，
	 * 释放全部监听并卸载组件，避免遗留游离在 body 上的浮层与内存泄露。
	 * 使用 ownerWindow 的 MutationObserver 构造器以避免跨窗口多实例全局问题。
	 */
	private observeTargetAncestors(): void {
		const win = (this.targetEl.ownerDocument?.defaultView ?? this.ownerWindow) as (Window & { MutationObserver?: typeof MutationObserver }) | null;
		const MutationObserverCtor = win?.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
		if (!MutationObserverCtor) return;
		this.disconnectDomObserver();
		const observer = new MutationObserverCtor((records: MutationRecord[]) => {
			if (!records.some(record => record.removedNodes.length > 0)) return;
			if (this.hasBeenConnected && !this.targetEl.isConnected) {
				this.unload();
			}
		});
		this.domObserver = observer;
		for (let parent: Node | null = this.targetEl.parentNode; parent; parent = parent.parentNode) {
			observer.observe(parent, { childList: true });
		}
	}

	private disconnectDomObserver(): void {
		this.domObserver?.disconnect();
		this.domObserver = null;
	}

	private onTargetEnter = (): void => {
		this.clearCloseTimeout();
		if (this.panelEl || this.isDisposed) return;
		if (!this.canPreview()) return;
		if (!this.targetEl.isConnected) return;
		this.hasBeenConnected = true;
		this.observeTargetAncestors();
		if (this.showTimeout !== null) return;
		this.showTimeout = this.ownerWindow.setTimeout(() => {
			this.showTimeout = null;
			if (this.isDisposed || this.panelEl) return;
			if (!this.targetEl.isConnected) return;
			void this.show();
		}, this.showDelayMs);
	};

	private onTargetLeave = (): void => {
		this.clearShowTimeout();
		// 常驻模式下不因鼠标移开而关闭，仅手动关闭
		if (this.isPersistent()) return;
		if (!this.panelEl) return;
		this.scheduleClose();
	};

	private onPanelEnter = (): void => {
		this.clearCloseTimeout();
	};

	private onPanelLeave = (): void => {
		// 常驻模式下同样不因鼠标移开面板而关闭
		if (this.isPersistent()) return;
		this.scheduleClose();
	};

	/**
	 * Esc 关闭：仅当焦点位于本面板（或其锚点卡片）内时响应。
	 * 避免在正文编辑器中按 Esc 时误关常驻面板。
	 */
	private onEscapeKey = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		if (!this.panelEl) return;
		const active = this.ownerDocument.activeElement as Node | null;
		if (!active || !(this.panelEl.contains(active) || this.targetEl.contains(active))) return;
		event.preventDefault();
		this.close();
	};

	/**
	 * 点击面板外关闭。
	 * 常驻模式下，「任意设定卡片」与「其它已打开的预览面板」都不算点击外部：
	 * - 点卡片 = 切换/打开另一个预览
	 * - 点另一个面板（含其关闭按钮）= 只操作那一个面板
	 * 若在此关闭自己，常驻数量上限将永远只能保留一个面板，且手动关闭会牵连其它窗口。
	 */
	private onGlobalPointerDown = (event: MouseEvent): void => {
		if (!this.panelEl) return;
		const target = event.target as Node | null;
		if (!target) return;
		if (this.panelEl.contains(target) || this.targetEl.contains(target)) return;
		if (this.isPersistent() && (this.isNodeInsideAnyCard(target) || this.isNodeInOtherPreviewPanel(target))) return;
		this.close();
	};

	/**
	 * 判断节点是否位于任意设定卡片容器内（用于常驻模式的“点击外部”判定）。
	 * 注意：必须从节点自身开始向上查找，卡片容器本身就是点击目标，
	 * 若先跳到 parentElement 会漏判。
	 */
	private isNodeInsideAnyCard(node: Node): boolean {
		const element = node.nodeType === 1 ? node as Element : node.parentElement;
		return Boolean(element?.closest?.(`.${LORE_CARD_WRAPPER_CLASS}`));
	}

	/** 判断节点是否位于其它已打开的预览面板内 */
	private isNodeInOtherPreviewPanel(node: Node): boolean {
		for (const other of LoreCardPreview.openPreviews) {
			if (other === this) continue;
			if (other.panelEl?.contains(node)) return true;
		}
		return false;
	}

	private onViewportChange = (): void => {
		// 常驻模式下跟随锚点卡片重新定位，不自动关闭
		if (this.isPersistent() && this.panelEl) {
			this.scheduleReposition();
			return;
		}
		this.close();
	};

	private onAncestorScroll = (event: Event): void => {
		if (this.isPersistent()) {
			// 面板内部滚动不影响定位；外部滚动则跟随卡片重新定位
			const target = event.target as Node | null;
			if (target && this.panelEl && this.panelEl.contains(target)) return;
			this.scheduleReposition();
			return;
		}
		// 面板自身滚动不应关闭面板，仅关闭因外部容器（网格/侧边栏）滚动导致的错位
		const target = event.target as Node | null;
		if (target && this.panelEl && this.panelEl.contains(target)) return;
		this.close();
	};

	/** 将多次滚动/resize 合并到同一帧，避免高频重排 */
	private scheduleReposition(): void {
		if (this.isDisposed || this.repositionFrame !== null) return;
		if (typeof this.ownerWindow.requestAnimationFrame !== 'function') {
			this.repositionIfVisible();
			return;
		}
		this.repositionFrame = this.ownerWindow.requestAnimationFrame(() => {
			this.repositionFrame = null;
			this.repositionIfVisible();
		});
	}

	/** 锚点卡片完全离开视口时隐藏面板，回到视口时恢复并重新定位 */
	private repositionIfVisible(): void {
		const panelEl = this.panelEl;
		if (!panelEl || !this.targetEl.isConnected) return;
		const anchor = this.targetEl.getBoundingClientRect();
		const viewportHeight = this.ownerWindow.innerHeight;
		const viewportWidth = this.ownerWindow.innerWidth;
		const isOffscreen = anchor.bottom < 0
			|| anchor.top > viewportHeight
			|| anchor.right < 0
			|| anchor.left > viewportWidth;
		panelEl.toggleClass('is-anchor-offscreen', isOffscreen);
		if (isOffscreen) return;
		this.positionPanel(panelEl);
	}

	private scheduleClose(): void {
		if (this.closeTimeout !== null) return;
		this.closeTimeout = this.ownerWindow.setTimeout(() => {
			this.closeTimeout = null;
			this.close();
		}, this.closeGraceMs);
	}

	private clearShowTimeout(): void {
		if (this.showTimeout === null) return;
		this.ownerWindow.clearTimeout(this.showTimeout);
		this.showTimeout = null;
	}

	private clearCloseTimeout(): void {
		if (this.closeTimeout === null) return;
		this.ownerWindow.clearTimeout(this.closeTimeout);
		this.closeTimeout = null;
	}

	private clearTimers(): void {
		this.clearShowTimeout();
		this.clearCloseTimeout();
	}

	/** 是否处于常驻模式：面板仅在手动关闭时消失 */
	private isPersistent(): boolean {
		return Boolean(this.plugin.settings.loreCardPreviewPersistent);
	}

	/** 常驻数量上限（1-10，默认 3） */
	private getMaxOpenCount(): number {
		const raw = this.plugin.settings.loreCardPreviewMaxCount;
		const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : MAX_OPEN_PREVIEWS_DEFAULT;
		return Math.min(MAX_OPEN_PREVIEWS_MAX, Math.max(MAX_OPEN_PREVIEWS_MIN, value));
	}

	/** 登记为已弹出面板，并按上限淘汰最早打开的一个 */
	private registerOpenPanel(): void {
		const list = LoreCardPreview.openPreviews;
		const index = list.indexOf(this);
		if (index >= 0) list.splice(index, 1);
		list.push(this);

		const limit = this.getMaxOpenCount();
		while (list.length > limit) {
			const oldest = list.shift();
			if (!oldest || oldest === this) continue;
			oldest.close();
		}
	}

	/** 从已弹出面板登记中移除 */
	private unregisterOpenPanel(): void {
		const list = LoreCardPreview.openPreviews;
		const index = list.indexOf(this);
		if (index >= 0) list.splice(index, 1);
	}

	private cancelRepositionFrame(): void {
		if (this.repositionFrame === null) return;
		this.ownerWindow.cancelAnimationFrame?.(this.repositionFrame);
		this.repositionFrame = null;
	}

	/** 判定当前平台与设置是否允许悬停预览 */
	private canPreview(): boolean {
		if (this.isDisposed) return false;
		if (!this.plugin.settings.loreCardPreviewEnabled) return false;
		if (!this.plugin.settings.loreCardHoverPreview) return false;
		// 移动端无 hover 语义，仅保留展开按钮入口，防止滑动误触
		if (isMobile()) return false;
		if (!this.entry || !this.entry.file) return false;
		return true;
	}

	/** 弹出预览面板：渲染完成后挂载、登记并按需定位 */
	private async show(): Promise<void> {
		if (this.isDisposed || this.isOpening) return;
		if (!this.entry || !this.entry.file) return;
		if (!this.plugin.settings.loreCardPreviewEnabled) return;
		if (!this.targetEl.isConnected) return;
		if (this.panelEl) return;

		this.hasBeenConnected = true;
		this.observeTargetAncestors();

		this.isOpening = true;
		this.closeRequested = false;
		const panelEl = this.ownerDocument.body.createDiv({ cls: 'wn-lore-preview-panel' });
		// 先脱离文档，待内容渲染完成后再挂载，避免渲染过程中的布局抖动
		panelEl.remove();
		panelEl.setAttr('tabindex', '-1');
		panelEl.addEventListener('mouseenter', this.onPanelEnter);
		panelEl.addEventListener('mouseleave', this.onPanelLeave);
		panelEl.addEventListener('keydown', this.onPanelKeyDown);
		this.panelEl = panelEl;

		const cardComponent = new Component();
		cardComponent.load();

		try {
			this.buildPanelHeader(panelEl);
			const cardContainer = panelEl.createDiv({ cls: 'wn-lore-card-wrapper' });
			await LoreCardRenderer.buildCardDOM(
				cardContainer,
				this.entry,
				this.plugin,
				cardComponent,
				{ readOnly: true, hideImportanceButton: true }
			);
		} catch (error) {
			this.isOpening = false;
			cardComponent.unload();
			this.removePanel();
			console.error(error);
			return;
		}

		this.isOpening = false;

		if (
			this.isDisposed ||
			this.closeRequested ||
			this.panelEl !== panelEl ||
			!this.targetEl.isConnected ||
			!this.plugin.settings.loreCardPreviewEnabled
		) {
			cardComponent.unload();
			this.removePanel();
			return;
		}

		this.cardComponent = cardComponent;
		this.ownerDocument.body.appendChild(panelEl);
		this.positionPanel(panelEl);
		this.bindOpenStateListeners();
		// 登记并按上限淘汰最早打开的面板
		this.registerOpenPanel();
		if (this.isPersistent()) {
			// 常驻模式下让面板取得焦点，使 Esc 关闭无需拦截全局按键
			panelEl.focus?.({ preventScroll: true });
		}
	}

	/** 面板内按键：Esc 手动关闭 */
	private onPanelKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		this.close();
	};

	private buildPanelHeader(panelEl: HTMLElement): void {
		const header = panelEl.createDiv({ cls: 'wn-lore-preview-header' });
		const heading = header.createDiv({ cls: 'wn-lore-preview-heading' });
		const badge = heading.createSpan({ cls: 'wn-lore-preview-badge', text: t('corkboard.lore-preview-title') });
		badge.setAttr('aria-hidden', 'true');
		const title = heading.createDiv({ cls: 'wn-lore-preview-title', text: this.entry.heading });
		title.title = this.entry.heading;

		const closeBtn = header.createDiv({ cls: 'wn-lore-preview-close clickable-icon' });
		closeBtn.setAttr('role', 'button');
		closeBtn.setAttr('tabindex', '0');
		closeBtn.setAttr('aria-label', t('corkboard.lore-preview-close'));
		closeBtn.title = t('corkboard.lore-preview-close');
		setIcon(closeBtn, 'x');
		closeBtn.onclick = (event) => {
			event?.stopPropagation();
			this.close();
		};
		closeBtn.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			this.close();
		});
	}

	/**
	 * 定位面板：优先显示在卡片下方，下方空间不足时翻转至上方，
	 * 上下空间均不足时贴靠空间更大的一侧，由面板内部滚动承载剩余内容。
	 */
	private positionPanel(panelEl: HTMLElement): void {
		const anchor = this.targetEl.getBoundingClientRect();
		const viewportWidth = this.ownerWindow.innerWidth;
		const viewportHeight = this.ownerWindow.innerHeight;

		const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);
		const availableHeight = Math.max(0, viewportHeight - VIEWPORT_PADDING * 2);
		const panelWidth = Math.min(PREVIEW_MAX_WIDTH, availableWidth);
		const heightCap = Math.min(PREVIEW_MAX_HEIGHT, Math.floor(viewportHeight * VIEWPORT_HEIGHT_RATIO), availableHeight);

		panelEl.setCssStyles({ width: `${panelWidth}px`, maxHeight: `${heightCap}px` });

		const panelHeight = panelEl.getBoundingClientRect().height;
		const spaceBelow = viewportHeight - anchor.bottom - ANCHOR_GAP - VIEWPORT_PADDING;
		const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_PADDING;

		let top: number;
		if (panelHeight <= spaceBelow) {
			top = anchor.bottom + ANCHOR_GAP;
		} else if (panelHeight <= spaceAbove) {
			top = anchor.top - ANCHOR_GAP - panelHeight;
		} else if (spaceBelow >= spaceAbove) {
			top = anchor.bottom + ANCHOR_GAP;
		} else {
			top = anchor.top - ANCHOR_GAP - panelHeight;
		}

		const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - panelHeight - VIEWPORT_PADDING);
		top = Math.min(Math.max(top, VIEWPORT_PADDING), maxTop);

		let left = anchor.left + anchor.width / 2 - panelWidth / 2;
		left = Math.min(Math.max(left, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, viewportWidth - panelWidth - VIEWPORT_PADDING));

		panelEl.setCssStyles({ top: `${Math.round(top)}px`, left: `${Math.round(left)}px` });
	}

	/** 面板挂载后绑定关闭相关的全局监听 */
	private bindOpenStateListeners(): void {
		this.ownerDocument.addEventListener('keydown', this.onEscapeKey, true);
		this.ownerDocument.addEventListener('mousedown', this.onGlobalPointerDown, true);
		// 捕获阶段监听整个文档：scroll 事件不冒泡，捕获阶段才能覆盖 Obsidian 内部滚动容器
		this.ownerDocument.addEventListener('scroll', this.onAncestorScroll, true);
		this.ownerWindow.addEventListener('resize', this.onViewportChange);
		this.ownerWindow.addEventListener('orientationchange', this.onViewportChange);
	}

	private unbindOpenStateListeners(): void {
		this.ownerDocument.removeEventListener('keydown', this.onEscapeKey, true);
		this.ownerDocument.removeEventListener('mousedown', this.onGlobalPointerDown, true);
		this.ownerDocument.removeEventListener('scroll', this.onAncestorScroll, true);
		this.ownerWindow.removeEventListener('resize', this.onViewportChange);
		this.ownerWindow.removeEventListener('orientationchange', this.onViewportChange);
	}

	private removePanel(): void {
		const panelEl = this.panelEl;
		const cardComponent = this.cardComponent;
		this.panelEl = null;
		this.cardComponent = null;
		this.cancelRepositionFrame();
		this.unregisterOpenPanel();
		this.unbindOpenStateListeners();
		if (panelEl) {
			panelEl.removeEventListener('mouseenter', this.onPanelEnter);
			panelEl.removeEventListener('mouseleave', this.onPanelLeave);
			panelEl.removeEventListener('keydown', this.onPanelKeyDown);
			panelEl.remove();
		}
		cardComponent?.unload();
		if (panelEl) this.options.onClose?.();
	}
}
