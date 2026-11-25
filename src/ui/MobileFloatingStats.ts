import { Logger } from '../utils/Logger';
import type { App } from 'obsidian';
import { MarkdownView, setIcon } from 'obsidian';
import { MOBILE_DASHBOARD_STAT_KEYS } from '../constants';
import {
	formatMobileDashboardValues,
	formatMobileTimerValues,
	getMobileDashboardItemTone,
	resolveMobileTaskProgress,
	sanitizeMobileDashboardItems,
	type MobileDashboardTaskManagerLike
} from '../services/MobileDashboardStats';
import type { AccurateCountSettings, MobileDashboardStatKey } from '../types/settings';
import type { StatisticsManager } from '../services/StatisticsManager';

const TIMER_KEYS: readonly MobileDashboardStatKey[] = ['totalTime', 'focusTime', 'slackTime', 'sessionSpeed', 'currentTime'];

export interface MobileFloatingStatsState {
	x: number;
	y: number;
	isDocked?: boolean;
	dockEdge?: 'left' | 'right';
}

export type MobileFloatingStatsSettings = Pick<
	AccurateCountSettings,
	'mobileFloatingStatsState'
> & Partial<Pick<
	AccurateCountSettings,
	'immersive' | 'workspaceFolders' | 'loreFolderName' | 'timeline' | 'foreshadowing' | 'novelInfo'
>>;

export type MobileFloatingStatsStatisticsManager = Pick<
	StatisticsManager,
	'getCoreStats' | 'getSessionSpeed'
>;

export interface MobileFloatingStatsPlugin {
	isTracking: boolean;
	focusMs: number;
	slackMs?: number;
	lastTaskFolder?: string;
	taskManager?: MobileDashboardTaskManagerLike;
	settings: MobileFloatingStatsSettings;
	statisticsManager: MobileFloatingStatsStatisticsManager;
	startTracking(): void;
	stopTracking(): void;
	saveSettings(): Promise<void>;
}

/**
 * 移动端专注时间与数据浮动窗口
 * 在手机和平板端显示专注计时控制与同步自定义的数据栏项
 */
export class MobileFloatingStats {
	private app: App;
	private plugin: MobileFloatingStatsPlugin;
	private containerEl: HTMLElement | null = null;
	private position: { x: number; y: number } = { x: 20, y: 100 };
	private isDragging: boolean = false;
	private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
	private isDocked: boolean = false;
	private dockEdge: 'left' | 'right' | null = null;
	private resizeHandler = () => this.flushPosition();
	private boundsObserver: ResizeObserver | null = null;

	// 显示元素
	private timerBtnEl: HTMLElement | null = null;
	private itemsContainerEl: HTMLElement | null = null;
	private itemEls: Partial<Record<MobileDashboardStatKey, HTMLElement>> = {};
	private taskSeq = 0;
	private cachedTaskProgress: { words: number; goal: number } = { words: 0, goal: 0 };

	private ownerDocument: Document | null = null;
	private ownerWindow: Window | null = null;
	private pendingInitialRaf: { win: Window; id: number } | null = null;
	private pendingPositionRaf: { win: Window; id: number } | null = null;
	private clockIntervalId: number | null = null;
	private currentTimerIcon: 'play' | 'pause' | null = null;

	constructor(app: App, plugin: MobileFloatingStatsPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.loadPosition();
	}

	private getSelectedDashboardItems(): MobileDashboardStatKey[] {
		return sanitizeMobileDashboardItems(this.plugin.settings.immersive?.mobileDashboardItems);
	}

	private syncClockInterval(selected: readonly MobileDashboardStatKey[]): void {
		const needsClock = Boolean(this.containerEl) && selected.includes('currentTime') && !this.plugin.isTracking;
		if (!needsClock) {
			this.stopClockInterval();
			return;
		}
		if (this.clockIntervalId !== null || typeof this.ownerWindow?.setInterval !== 'function') {
			return;
		}
		this.clockIntervalId = this.ownerWindow.setInterval(() => {
			this.updateTimerUI();
		}, 1000);
	}

	private stopClockInterval(): void {
		if (this.clockIntervalId !== null) {
			if (typeof this.ownerWindow?.clearInterval === 'function') {
				this.ownerWindow.clearInterval(this.clockIntervalId);
			}
			this.clockIntervalId = null;
		}
	}

	/**
	 * 加载浮窗
	 */
	load(): void {
		if (this.containerEl) return;

		const container = activeDocument.body.createDiv({
			cls: 'wn-mobile-floating-stats'
		});
		const ownerDoc = container.ownerDocument;
		const ownerWin = ownerDoc.win;

		this.ownerDocument = ownerDoc;
		this.ownerWindow = ownerWin;
		this.containerEl = container;

		this.containerEl.setCssStyles({
			left: `${this.position.x}px`,
			top: `${this.position.y}px`
		});

		if (this.isDocked && this.dockEdge) {
			this.containerEl.addClass('is-docked', `is-docked-${this.dockEdge}`);
		}

		// 点击/触摸贴边半隐的浮窗时展开/收起
		this.containerEl.addEventListener('click', (e) => {
			if (this.isDocked && !this.isDragging) {
				if (this.containerEl?.hasClass('is-expanded')) {
					if (e.target === this.containerEl) {
						this.containerEl.removeClass('is-expanded');
					}
				} else {
					this.containerEl?.addClass('is-expanded');
				}
			}
		});

		// 左侧保留 ▶/⏸ 开始/暂停计时按键，仅图标响应点击/触摸事件，防止误触
		this.timerBtnEl = this.containerEl.createSpan({
			cls: 'wn-mobile-floating-timer-btn wn-clickable wn-text-muted',
		});
		setIcon(this.timerBtnEl, 'play');
		this.currentTimerIcon = 'play';

		const itemsWrap = this.containerEl.createSpan({
			cls: 'wn-mobile-floating-items'
		});
		this.itemsContainerEl = itemsWrap;
		this.itemEls = {};
		for (const key of MOBILE_DASHBOARD_STAT_KEYS) {
			const tone = getMobileDashboardItemTone(key);
			const toneCls = tone === 'focus' ? ' is-focus' : tone === 'slack' ? ' is-slack' : '';
			const itemEl = itemsWrap.createSpan({
				cls: `wn-mobile-floating-item${toneCls} is-hidden`
			});
			itemEl.setAttribute('data-stat-key', key);
			itemEl.hide();
			this.itemEls[key] = itemEl;
		}

		const onTimerAction = (e: Event) => {
			e.stopPropagation();
			e.preventDefault(); // 防止穿透和双重触发
			if (this.plugin.isTracking) {
				this.plugin.stopTracking();
			} else {
				this.plugin.startTracking();
			}
			this.updateTimerUI();
		};

		this.timerBtnEl.addEventListener('click', onTimerAction);
		this.timerBtnEl.addEventListener('touchstart', onTimerAction, { passive: false });

		// 绑定拖动事件
		this.bindDragEvents(this.containerEl);

		// 视口或浮窗尺寸改变时重新约束位置
		this.ownerWindow.addEventListener('resize', this.resizeHandler);
		const Observer = (ownerWin as Window & typeof window).ResizeObserver;
		if (Observer) {
			this.boundsObserver = new Observer(() => this.checkBounds());
			this.boundsObserver.observe(container);
		}

		// 初始更新
		this.update();

		// 确保渲染后位置不溢出
		this.cancelPendingInitialRaf();
		const rafEntry = { win: ownerWin, id: 0 };
		this.pendingInitialRaf = rafEntry;
		rafEntry.id = ownerWin.requestAnimationFrame(() => {
			if (this.pendingInitialRaf !== rafEntry) return;
			this.pendingInitialRaf = null;
			this.checkBounds();
		});
	}

	/**
	 * 卸载浮窗
	 */
	unload(): void {
		this.taskSeq++;
		this.stopClockInterval();
		this.cancelPendingInitialRaf();
		this.cancelPendingPositionRaf();
		if (this.ownerWindow) {
			this.ownerWindow.removeEventListener('resize', this.resizeHandler);
		}
		this.boundsObserver?.disconnect();
		this.boundsObserver = null;
		this.removeDragListeners();
		this.isDragging = false;
		this.currentTimerIcon = null;

		if (this.containerEl) {
			this.containerEl.remove();
			this.containerEl = null;
		}
		this.itemsContainerEl = null;
		this.itemEls = {};
		this.timerBtnEl = null;
		this.ownerDocument = null;
		this.ownerWindow = null;
	}

	private cancelPendingInitialRaf(): void {
		if (this.pendingInitialRaf !== null) {
			this.pendingInitialRaf.win.cancelAnimationFrame(this.pendingInitialRaf.id);
			this.pendingInitialRaf = null;
		}
	}

	private cancelPendingPositionRaf(): void {
		if (this.pendingPositionRaf !== null) {
			this.pendingPositionRaf.win.cancelAnimationFrame(this.pendingPositionRaf.id);
			this.pendingPositionRaf = null;
		}
	}

	private flushPosition(): void {
		this.cancelPendingPositionRaf();
		this.checkBounds();
	}

	private isSuspendedByMobileImmersive(): boolean {
		return Boolean(this.ownerDocument?.body?.classList?.contains?.('wn-immersive-mobile-active'));
	}

	private syncPlayPauseButton(): void {
		if (!this.timerBtnEl) return;
		this.timerBtnEl.removeClass('wn-text-accent');
		this.timerBtnEl.addClass('wn-text-muted');
		const icon = this.plugin.isTracking ? 'pause' : 'play';
		if (this.currentTimerIcon !== icon) {
			setIcon(this.timerBtnEl, icon);
			this.currentTimerIcon = icon;
		}
	}

	private applySelectedItems(
		selected: readonly MobileDashboardStatKey[],
		values: Partial<Record<MobileDashboardStatKey, string>>
	): void {
		const selectedSet = new Set<MobileDashboardStatKey>(selected);
		if (this.itemsContainerEl) {
			if (selected.length > 0) {
				this.itemsContainerEl.removeClass('is-hidden');
				this.itemsContainerEl.show();
			} else {
				this.itemsContainerEl.addClass('is-hidden');
				this.itemsContainerEl.hide();
			}
		}
		for (const key of MOBILE_DASHBOARD_STAT_KEYS) {
			const el = this.itemEls[key];
			if (!el) continue;
			const visible = selectedSet.has(key);
			if (visible) {
				el.removeClass('is-hidden');
				el.show();
				if (values[key] !== undefined) {
					el.textContent = values[key]!;
				}
			} else {
				el.addClass('is-hidden');
				el.hide();
			}
		}
	}

	/**
	 * 更新显示内容
	 */
	update(): void {
		if (!this.containerEl || this.isSuspendedByMobileImmersive()) return;

		const selected = this.getSelectedDashboardItems();
		this.syncClockInterval(selected);
		if (selected.length === 0) {
			this.syncPlayPauseButton();
			this.applySelectedItems(selected, {});
			return;
		}

		const hasContentStats = selected.some(key => !TIMER_KEYS.includes(key));
		if (!hasContentStats) {
			this.applySelectedItems(selected, {});
			this.updateTimerUI();
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file ?? null;
		const stats = file
			? this.plugin.statisticsManager.getCoreStats()
			: this.plugin.statisticsManager.getCoreStats(null);
		const values = formatMobileDashboardValues(stats, this.cachedTaskProgress);
		this.applySelectedItems(selected, values);
		this.syncPlayPauseButton();

		if (selected.includes('taskProgress') && this.plugin.taskManager) {
			const reqSeq = ++this.taskSeq;
			void resolveMobileTaskProgress({
				app: this.app,
				plugin: this.plugin,
				file
			}).then(progress => {
				if (!this.containerEl || reqSeq !== this.taskSeq || this.isSuspendedByMobileImmersive()) return;
				this.cachedTaskProgress = progress;
				const taskEl = this.itemEls.taskProgress;
				if (taskEl && !taskEl.hasClass('is-hidden')) {
					taskEl.textContent = `${progress.words}/${progress.goal}`;
				}
			});
		}
	}

	public updateTimerUI(): void {
		if (!this.containerEl || !this.timerBtnEl || this.isSuspendedByMobileImmersive()) return;

		this.syncPlayPauseButton();
		const selected = this.getSelectedDashboardItems();
		this.syncClockInterval(selected);
		if (selected.length === 0) return;

		const timerValues = formatMobileTimerValues({
			focusMs: this.plugin.focusMs,
			slackMs: this.plugin.slackMs,
			sessionSpeed: this.plugin.statisticsManager.getSessionSpeed()
		});

		for (const key of ['totalTime', 'focusTime', 'slackTime', 'sessionSpeed', 'currentTime'] as const) {
			if (!selected.includes(key)) continue;
			const el = this.itemEls[key];
			if (el) {
				el.removeClass('is-hidden');
				el.show();
				el.textContent = timerValues[key];
			}
		}
	}

	/**
	 * 绑定拖动事件
	 */
	private bindDragEvents(element: HTMLElement): void {
		// 触摸开始
		element.addEventListener('touchstart', (e) => {
			this.isDragging = true;
			const touch = e.touches[0];
			this.dragOffset.x = touch.clientX - this.position.x;
			this.dragOffset.y = touch.clientY - this.position.y;
			if (this.containerEl) {
				this.containerEl.addClass('is-dragging');
				this.containerEl.removeClass('is-docked', 'is-docked-left', 'is-docked-right', 'is-expanded');
			}
			e.preventDefault();
			
			this.ownerDocument?.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			this.ownerDocument?.addEventListener('touchend', this.touchEndHandler);
			this.ownerDocument?.addEventListener('touchcancel', this.touchEndHandler);
		}, { passive: false });

		// 鼠标按下
		element.addEventListener('mousedown', (e) => {
			this.isDragging = true;
			this.dragOffset.x = e.clientX - this.position.x;
			this.dragOffset.y = e.clientY - this.position.y;
			if (this.containerEl) {
				this.containerEl.addClass('is-dragging');
				this.containerEl.removeClass('is-docked', 'is-docked-left', 'is-docked-right', 'is-expanded');
			}
			
			this.ownerDocument?.addEventListener('mousemove', this.mouseMoveHandler);
			this.ownerDocument?.addEventListener('mouseup', this.mouseUpHandler);
		});
	}

	private removeDragListeners(): void {
		if (this.ownerDocument) {
			this.ownerDocument.removeEventListener('touchmove', this.touchMoveHandler);
			this.ownerDocument.removeEventListener('touchend', this.touchEndHandler);
			this.ownerDocument.removeEventListener('touchcancel', this.touchEndHandler);
			this.ownerDocument.removeEventListener('mousemove', this.mouseMoveHandler);
			this.ownerDocument.removeEventListener('mouseup', this.mouseUpHandler);
		}
	}

	private touchMoveHandler = (e: TouchEvent) => {
		if (!this.isDragging || !this.containerEl) return;
		const touch = e.touches[0];
		this.updatePosition(touch.clientX, touch.clientY);
		e.preventDefault();
	};

	private touchEndHandler = () => {
		this.endDragging();
	};

	private mouseMoveHandler = (e: MouseEvent) => {
		if (!this.isDragging || !this.containerEl) return;
		this.updatePosition(e.clientX, e.clientY);
	};

	private mouseUpHandler = () => {
		this.endDragging();
	};

	private updatePosition(clientX: number, clientY: number): void {
		if (!this.containerEl) return;
		this.position.x = clientX - this.dragOffset.x;
		this.position.y = clientY - this.dragOffset.y;
		
		if (this.pendingPositionRaf || !this.ownerWindow) return;
		const entry = { win: this.ownerWindow, id: 0 };
		this.pendingPositionRaf = entry;
		entry.id = entry.win.requestAnimationFrame(() => {
			if (this.pendingPositionRaf !== entry) return;
			this.pendingPositionRaf = null;
			this.checkBounds();
		});
	}

	private checkBounds(): void {
		if (!this.containerEl || !this.ownerWindow || this.isSuspendedByMobileImmersive()) return;

		const elWidth = this.containerEl.offsetWidth;
		const elHeight = this.containerEl.offsetHeight;
		if (elWidth === 0 || elHeight === 0) return;

		const win = this.ownerWindow;
		const maxX = Math.max(0, win.innerWidth - elWidth);
		const maxY = Math.max(0, win.innerHeight - elHeight);

		// X 轴约束
		if (!this.isDragging && this.isDocked && this.dockEdge === 'right') {
			this.position.x = maxX;
		} else if (!this.isDragging && this.isDocked && this.dockEdge === 'left') {
			this.position.x = 0;
		} else if (this.position.x > maxX) {
			this.position.x = maxX;
		} else if (this.position.x < 0) {
			this.position.x = 0;
		}

		// Y 轴约束
		if (this.position.y > maxY) {
			this.position.y = maxY;
		} else if (this.position.y < 0) {
			this.position.y = 0;
		}

		// 在动画帧或手势收尾时应用边界约束后的最终位置。
		this.containerEl.setCssStyles({ left: `${this.position.x}px`, top: `${this.position.y}px` });
	}

	private endDragging(): void {
		if (this.isDragging) {
			this.flushPosition();
			this.isDragging = false;
			if (this.containerEl) {
				this.containerEl.removeClass('is-dragging');
				this.evaluateDocking();
			}
			this.savePosition();
			this.removeDragListeners();
		}
	}

	/**
	 * 贴边检测与半隐/自动缩短判定
	 */
	private evaluateDocking(): void {
		if (!this.containerEl || !this.ownerWindow) return;

		const elWidth = this.containerEl.offsetWidth || 150;
		const win = this.ownerWindow;
		const maxX = Math.max(0, win.innerWidth - elWidth);
		// 浮窗接近满宽时缩小贴边范围，让两侧可分别触发并保留中间位置。
		const dockThreshold = Math.min(35, maxX / 3);

		if (this.position.x <= dockThreshold) {
			this.position.x = 0;
			this.isDocked = true;
			this.dockEdge = 'left';
			this.containerEl.setCssStyles({ left: `${this.position.x}px` });
			this.containerEl.addClass('is-docked', 'is-docked-left');
			this.containerEl.removeClass('is-docked-right', 'is-expanded');
		} else if (this.position.x >= maxX - dockThreshold) {
			this.position.x = maxX;
			this.isDocked = true;
			this.dockEdge = 'right';
			this.containerEl.setCssStyles({ left: `${this.position.x}px` });
			this.containerEl.addClass('is-docked', 'is-docked-right');
			this.containerEl.removeClass('is-docked-left', 'is-expanded');
		} else {
			this.isDocked = false;
			this.dockEdge = null;
			this.containerEl.removeClass('is-docked', 'is-docked-left', 'is-docked-right', 'is-expanded');
		}
	}

	/**
	 * 保存位置
	 */
	private savePosition(): void {
		const state = {
			x: this.position.x,
			y: this.position.y,
			isDocked: this.isDocked,
			dockEdge: this.dockEdge || undefined
		};
		this.plugin.settings.mobileFloatingStatsState = state;
		void this.plugin.saveSettings().catch(err => {
			Logger.error('[MobileFloatingStats] 保存位置设置失败:', err);
		});
	}

	/**
	 * 加载位置
	 */
	private loadPosition(): void {
		const saved = this.plugin.settings.mobileFloatingStatsState;
		if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
			// 校验位置不超过当前屏幕范围，防止大屏设备保存的位置在小屏设备上导致浮窗不可见
			this.position = {
				x: Math.min(saved.x, activeWindow.innerWidth - 100),
				y: Math.min(saved.y, activeWindow.innerHeight - 50)
			};
			if (saved.isDocked) {
				this.isDocked = true;
				this.dockEdge = saved.dockEdge || (this.position.x < activeWindow.innerWidth / 2 ? 'left' : 'right');
			} else {
				this.isDocked = false;
				this.dockEdge = null;
			}
		} else {
			this.position = { x: 20, y: 100 };
			this.isDocked = false;
			this.dockEdge = null;
		}
	}
}

