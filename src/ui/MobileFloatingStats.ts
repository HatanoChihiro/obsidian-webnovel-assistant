import { Logger } from '../utils/Logger';
import type { App} from 'obsidian';
import { MarkdownView } from 'obsidian';
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

	// 显示元素
	private wordCountEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;

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
			cls: 'mobile-floating-stats',
			attr: {
				style: `left: ${this.position.x}px; top: ${this.position.y}px;`
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

		// 绑定拖动事件
		this.bindDragEvents(this.containerEl);

		// 初始更新
		this.update();
	}

	/**
	 * 卸载浮窗
	 */
	unload(): void {
		if (this.containerEl) {
			// 移除全局监听器以防止内存泄漏
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
			
			// 进度颜色变化
			if (percent >= 100) {
				this.progressEl.removeClass('wn-text-orange', 'wn-text-accent'); this.progressEl.addClass('wn-text-green'); // 绿色
			} else if (percent >= 80) {
				this.progressEl.removeClass('wn-text-green', 'wn-text-accent'); this.progressEl.addClass('wn-text-orange'); // 橙色
			} else {
				this.progressEl.removeClass('wn-text-green', 'wn-text-orange'); this.progressEl.addClass('wn-text-accent');
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
			if (this.containerEl) this.containerEl.addClass('is-dragging');
			e.preventDefault();
			
			activeDocument.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
			activeDocument.addEventListener('touchend', this.touchEndHandler);
		}, { passive: false });

		// 鼠标按下
		element.addEventListener('mousedown', (e) => {
			this.isDragging = true;
			this.dragOffset.x = e.clientX - this.position.x;
			this.dragOffset.y = e.clientY - this.position.y;
			if (this.containerEl) this.containerEl.addClass('is-dragging');
			
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
		
		// 限制在屏幕范围内
		this.position.x = Math.max(0, Math.min(this.position.x, activeWindow.innerWidth - this.containerEl.offsetWidth));
		this.position.y = Math.max(0, Math.min(this.position.y, activeWindow.innerHeight - this.containerEl.offsetHeight));
		
		this.containerEl.setCssStyles({ left: `${this.position.x}px` }); this.containerEl.setCssStyles({ top: `${this.position.y}px` });
	}

	private endDragging(): void {
		if (this.isDragging) {
			this.isDragging = false;
			if (this.containerEl) this.containerEl.removeClass('is-dragging');
			this.savePosition();
			
			activeDocument.removeEventListener('touchmove', this.touchMoveHandler);
			activeDocument.removeEventListener('touchend', this.touchEndHandler);
			activeDocument.removeEventListener('mousemove', this.mouseMoveHandler);
			activeDocument.removeEventListener('mouseup', this.mouseUpHandler);
		}
	}

	/**
	 * 保存位置
	 */
	private savePosition(): void {
		const state = {
			x: this.position.x,
			y: this.position.y
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
		} else {
			this.position = { x: 20, y: 100 };
		}
	}
}
