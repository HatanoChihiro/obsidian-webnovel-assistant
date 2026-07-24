import { Logger } from '../utils/Logger';
import type { App} from 'obsidian';
import { MarkdownView, setIcon } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

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
	private plugin: WebNovelAssistantPlugin;
	private containerEl: HTMLElement | null = null;
	private position: { x: number; y: number } = { x: 20, y: 100 };
	private isDragging: boolean = false;
	private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
	private isDocked: boolean = false;
	private dockEdge: 'left' | 'right' | null = null;
	private resizeHandler = () => this.checkBounds();

	// 显示元素
	private wordCountEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private timerEl: HTMLElement | null = null;
	private timerBtnEl: HTMLElement | null = null;
	private timerTextEl: HTMLElement | null = null;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.loadPosition();
	}

	/**
	 * 加载浮窗
	 */
	load(): void {
		if (this.containerEl) return;

		// 创建容器 - 简化为一横排，优化触摸目标
		this.containerEl = activeDocument.body.createDiv({
			cls: 'mobile-floating-stats'
		});
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
		activeWindow.addEventListener('resize', this.resizeHandler);

		// 初始更新
		this.update();

		// 确保渲染后位置不溢出
		window.requestAnimationFrame(() => {
			this.checkBounds();
		});
	}

	/**
	 * 卸载浮窗
	 */
	unload(): void {
		if (this.containerEl) {
			// 移除全局监听器以防止内存泄漏
			activeWindow.removeEventListener('resize', this.resizeHandler);
			activeDocument.removeEventListener('touchmove', this.touchMoveHandler);
			activeDocument.removeEventListener('touchend', this.touchEndHandler);
			activeDocument.removeEventListener('mousemove', this.mouseMoveHandler);
			activeDocument.removeEventListener('mouseup', this.mouseUpHandler);
			
			this.containerEl.remove();
			this.containerEl = null;
		}
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

			if (this.plugin.isTracking) {
				setIcon(this.timerBtnEl, 'pause');
				this.timerTextEl.textContent = `${h}:${m}:${s}`;
			} else {
				setIcon(this.timerBtnEl, 'play');
				if (focusSec > 0) {
					// 暂停状态：继续显示已暂停的时长
					this.timerTextEl.textContent = `${h}:${m}:${s}`;
				} else {
					// 初始或重置状态（未开始计时）：显示“专注计时”
					const rawText = t('setting.mobile-focus-timer-start') || '专注计时';
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
			
			activeDocument.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			activeDocument.addEventListener('touchend', this.touchEndHandler);
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
			
			activeDocument.addEventListener('mousemove', this.mouseMoveHandler);
			activeDocument.addEventListener('mouseup', this.mouseUpHandler);
		});
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
		
		this.checkBounds();
	}

	private checkBounds(): void {
		if (!this.containerEl) return;

		// 考虑到渲染时可能有微小差异，给默认尺寸
		const elWidth = this.containerEl.offsetWidth || 150;
		const elHeight = this.containerEl.offsetHeight || 40;

		const maxX = activeWindow.innerWidth - elWidth;
		const maxY = activeWindow.innerHeight - elHeight;

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

		// 更新 DOM，拖拽时 checkBounds 总是被 updatePosition 触发，因此也会直接更新 DOM
		this.containerEl.setCssStyles({ left: `${this.position.x}px`, top: `${this.position.y}px` });
	}

	private endDragging(): void {
		if (this.isDragging) {
			this.isDragging = false;
			if (this.containerEl) {
				this.containerEl.removeClass('is-dragging');
				this.evaluateDocking();
			}
			this.savePosition();
			
			activeDocument.removeEventListener('touchmove', this.touchMoveHandler);
			activeDocument.removeEventListener('touchend', this.touchEndHandler);
			activeDocument.removeEventListener('mousemove', this.mouseMoveHandler);
			activeDocument.removeEventListener('mouseup', this.mouseUpHandler);
		}
	}

	/**
	 * 贴边检测与半隐/自动缩短判定
	 */
	private evaluateDocking(): void {
		if (!this.containerEl) return;

		const elWidth = this.containerEl.offsetWidth || 150;
		const maxX = activeWindow.innerWidth - elWidth;
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

