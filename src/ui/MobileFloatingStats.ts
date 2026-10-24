import { Logger } from '../utils/Logger';
import type { App } from 'obsidian';
import { MarkdownView, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { AccurateCountSettings } from '../types/settings';
import type { StatisticsManager } from '../services/StatisticsManager';

export interface MobileFloatingStatsState {
	x: number;
	y: number;
	isDocked?: boolean;
	dockEdge?: 'left' | 'right';
}

export type MobileFloatingStatsSettings = Pick<
	AccurateCountSettings,
	'enableMobileFocusTimer' | 'mobileFloatingStatsState'
>;

export type MobileFloatingStatsStatisticsManager = Pick<
	StatisticsManager,
	'getCoreStats'
>;

export interface MobileFloatingStatsPlugin {
	isTracking: boolean;
	focusMs: number;
	settings: MobileFloatingStatsSettings;
	statisticsManager: MobileFloatingStatsStatisticsManager;
	startTracking(): void;
	stopTracking(): void;
	saveSettings(): Promise<void>;
}

/**
 * 移动端浮动统计窗口
 * 在手机和平板端显示章节字数和进度
 * 
 * 特点：
 * - 轻量级，不占用太多屏幕空间
 * - 可拖动位置
 * - 可折叠/展开
 * - 自动保存位置
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

	// 显示元素
	private wordCountEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private timerEl: HTMLElement | null = null;
	private timerBtnEl: HTMLElement | null = null;
	private timerTextEl: HTMLElement | null = null;

	private ownerDocument: Document | null = null;
	private ownerWindow: Window | null = null;
	private pendingInitialRaf: { win: Window; id: number } | null = null;
	private pendingPositionRaf: { win: Window; id: number } | null = null;
	private currentTimerIcon: 'play' | 'pause' | null = null;

	constructor(app: App, plugin: MobileFloatingStatsPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.loadPosition();
	}

	/**
	 * 加载浮窗
	 */
	load(): void {
		if (this.containerEl) return;

		const container = activeDocument.body.createDiv({
			cls: 'mobile-floating-stats'
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

		// 字数显示
		this.wordCountEl = this.containerEl.createSpan({
			text: `0${t('common.word-char')}`, 
			cls: 'mobile-floating-word-count'
		});

		// 分隔符
		this.containerEl.createSpan({
			text: '|',
			cls: 'mobile-floating-divider'
		});

		// 进度显示
		this.progressEl = this.containerEl.createSpan({
			text: '0%',
			cls: 'mobile-floating-progress'
		});

		// 专注计时容器
		this.timerEl = this.containerEl.createSpan({
			cls: 'mobile-floating-timer'
		});

		// 播放/暂停按键前的分隔符
		this.timerEl.createSpan({
			text: '|',
			cls: 'mobile-floating-divider'
		});
		
		// 仅图标响应点击/触摸事件，防止误触
		this.timerBtnEl = this.timerEl.createSpan({
			cls: 'mobile-floating-timer-btn wn-clickable wn-text-muted',
		});
		setIcon(this.timerBtnEl, 'play');
		this.currentTimerIcon = 'play';

		// 时间与文字展示标签（只读，无点击事件）
		this.timerTextEl = this.timerEl.createSpan({
			cls: 'mobile-floating-timer-text wn-text-accent'
		});

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

		// 监听窗口尺寸变化
		this.ownerWindow.addEventListener('resize', this.resizeHandler);

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
		this.cancelPendingInitialRaf();
		this.cancelPendingPositionRaf();
		if (this.ownerWindow) {
			this.ownerWindow.removeEventListener('resize', this.resizeHandler);
		}
		this.removeDragListeners();
		this.isDragging = false;
		this.currentTimerIcon = null;

		if (this.containerEl) {
			this.containerEl.remove();
			this.containerEl = null;
		}
		this.wordCountEl = null;
		this.progressEl = null;
		this.timerEl = null;
		this.timerBtnEl = null;
		this.timerTextEl = null;
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

	/**
	 * 更新显示内容
	 */
	update(): void {
		if (!this.containerEl) return;
		
		this.updateTimerUI();

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) {
			if (this.wordCountEl) this.wordCountEl.textContent = `0${t('common.word-char')}`; 
			if (this.progressEl) this.progressEl.textContent = '0%';
			return;
		}

		// 通过核心管线获取完全一致的数据
		const stats = this.plugin.statisticsManager.getCoreStats();
		const wordCount = stats.todayWords;
		const percent = stats.percent;

		// 更新显示
		if (this.wordCountEl) this.wordCountEl.textContent = wordCount.toLocaleString() + t('common.word-char'); 
		if (this.progressEl) {
			this.progressEl.textContent = percent + '%';
			
			// 进度显示：未满50%使用主题色，满50%显示橙色，满100%显示绿色
			if (percent >= 100) {
				this.progressEl.removeClass('wn-text-orange', 'wn-text-accent');
				this.progressEl.addClass('wn-text-green');
			} else if (percent >= 50) {
				this.progressEl.removeClass('wn-text-green', 'wn-text-accent');
				this.progressEl.addClass('wn-text-orange');
			} else {
				this.progressEl.removeClass('wn-text-green', 'wn-text-orange');
				this.progressEl.addClass('wn-text-accent');
			}
		}
	}
	
	public updateTimerUI(): void {
		if (!this.timerEl || !this.timerBtnEl || !this.timerTextEl) return;
		
		if (this.plugin.settings.enableMobileFocusTimer) {
			this.timerEl.show();
			const focusSec = Math.round((this.plugin.focusMs || 0) / 1000);
			const h = Math.floor(focusSec / 3600).toString().padStart(2, '0');
			const m = Math.floor((focusSec % 3600) / 60).toString().padStart(2, '0');
			const s = (focusSec % 60).toString().padStart(2, '0');

			// 图标按键符号使用 muted 默认色（不高亮），仅时间显示采用主题色
			this.timerBtnEl.removeClass('wn-text-accent');
			this.timerBtnEl.addClass('wn-text-muted');
			this.timerTextEl.removeClass('wn-text-muted');
			this.timerTextEl.addClass('wn-text-accent');

			const icon = this.plugin.isTracking ? 'pause' : 'play';
			if (this.currentTimerIcon !== icon) {
				setIcon(this.timerBtnEl, icon);
				this.currentTimerIcon = icon;
			}
			if (this.plugin.isTracking) {
				this.timerTextEl.textContent = `${h}:${m}:${s}`;
			} else {
				if (focusSec > 0) {
					// 暂停状态：继续显示已暂停的时长
					this.timerTextEl.textContent = `${h}:${m}:${s}`;
				} else {
					// 初始或重置状态（未开始计时）：显示“专注计时”
					const rawText = t('setting.mobile-focus-timer-start');
					const labelText = rawText.replace(/^[▶⏸\s]+/, '');
					this.timerTextEl.textContent = labelText;
				}
			}
		} else {
			this.timerEl.hide();
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
		if (!this.containerEl || !this.ownerWindow) return;

		// 考虑到渲染时可能有微小差异，给默认尺寸
		const elWidth = this.containerEl.offsetWidth || 150;
		const elHeight = this.containerEl.offsetHeight || 40;

		const win = this.ownerWindow;
		const maxX = win.innerWidth - elWidth;
		const maxY = win.innerHeight - elHeight;

		// X 轴约束
		if (this.position.x > maxX) {
			this.position.x = Math.max(0, maxX);
		} else if (this.position.x < 0) {
			this.position.x = 0;
		}

		// Y 轴约束
		if (this.position.y > maxY) {
			this.position.y = Math.max(0, maxY);
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
		const maxX = win.innerWidth - elWidth;
		const dockThreshold = 35; // 距离左右边缘 35px 内自动贴边缩短并变淡

		if (this.position.x <= dockThreshold) {
			this.position.x = 0;
			this.isDocked = true;
			this.dockEdge = 'left';
			this.containerEl.setCssStyles({ left: `${this.position.x}px` });
			this.containerEl.addClass('is-docked', 'is-docked-left');
			this.containerEl.removeClass('is-docked-right', 'is-expanded');
		} else if (this.position.x >= maxX - dockThreshold) {
			this.position.x = Math.max(0, maxX);
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

