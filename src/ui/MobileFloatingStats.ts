import { App, MarkdownView } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

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
		this.containerEl = document.body.createDiv({
			cls: 'mobile-floating-stats',
			attr: {
				style: `
					position: fixed;
					left: ${this.position.x}px;
					top: ${this.position.y}px;
					z-index: 9999;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
					padding: 10px 16px;
					min-height: 44px;
					font-size: 13px;
					user-select: none;
					touch-action: none;
					cursor: move;
					display: flex;
					align-items: center;
					gap: 12px;
					opacity: 0.9;
				`
			}
		});

		// 字数显示
		this.wordCountEl = this.containerEl.createSpan({
			text: '0字',
			attr: {
				style: `
					font-weight: 500;
					color: var(--text-normal);
					white-space: nowrap;
				`
			}
		});

		// 分隔符
		this.containerEl.createSpan({
			text: '|',
			attr: {
				style: `
					color: var(--text-muted);
					opacity: 0.5;
				`
			}
		});

		// 进度显示
		this.progressEl = this.containerEl.createSpan({
			text: '0%',
			attr: {
				style: `
					font-weight: 500;
					color: var(--text-accent);
					white-space: nowrap;
				`
			}
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
			document.removeEventListener('touchmove', this.touchMoveHandler);
			document.removeEventListener('touchend', this.touchEndHandler);
			document.removeEventListener('mousemove', this.mouseMoveHandler);
			document.removeEventListener('mouseup', this.mouseUpHandler);
			
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
			if (this.wordCountEl) this.wordCountEl.textContent = '0字';
			if (this.progressEl) this.progressEl.textContent = '0%';
			return;
		}

		// 计算字数
		const content = view.getViewData();
		const wordCount = this.plugin.calculateAccurateWords(content);

		// 获取目标字数
		let targetGoal = this.plugin.settings.defaultGoal;
		const cache = this.app.metadataCache.getFileCache(view.file);
		const fmGoal = cache?.frontmatter?.['word-goal'];
		if (fmGoal !== undefined) {
			const parsed = parseInt(fmGoal);
			if (!isNaN(parsed)) targetGoal = parsed;
		}

		// 计算进度
		const percent = targetGoal > 0 ? Math.min(Math.round((wordCount / targetGoal) * 100), 100) : 0;

		// 更新显示
		if (this.wordCountEl) this.wordCountEl.textContent = wordCount.toLocaleString() + '字';
		if (this.progressEl) {
			this.progressEl.textContent = percent + '%';
			
			// 进度颜色变化
			if (percent >= 100) {
				this.progressEl.style.color = '#10b981'; // 绿色
			} else if (percent >= 80) {
				this.progressEl.style.color = '#f59e0b'; // 橙色
			} else {
				this.progressEl.style.color = 'var(--text-accent)';
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
			if (this.containerEl) this.containerEl.style.opacity = '0.7';
			e.preventDefault();
		}, { passive: false });

		// 鼠标按下
		element.addEventListener('mousedown', (e) => {
			this.isDragging = true;
			this.dragOffset.x = e.clientX - this.position.x;
			this.dragOffset.y = e.clientY - this.position.y;
			if (this.containerEl) this.containerEl.style.opacity = '0.7';
		});

		// 注册全局处理函数（用于移除）
		document.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
		document.addEventListener('touchend', this.touchEndHandler);
		document.addEventListener('mousemove', this.mouseMoveHandler);
		document.addEventListener('mouseup', this.mouseUpHandler);
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
		this.position.x = Math.max(0, Math.min(this.position.x, window.innerWidth - this.containerEl.offsetWidth));
		this.position.y = Math.max(0, Math.min(this.position.y, window.innerHeight - this.containerEl.offsetHeight));
		
		this.containerEl.style.left = `${this.position.x}px`;
		this.containerEl.style.top = `${this.position.y}px`;
	}

	private endDragging(): void {
		if (this.isDragging) {
			this.isDragging = false;
			if (this.containerEl) this.containerEl.style.opacity = '0.9';
			this.savePosition();
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
		localStorage.setItem('mobile-floating-stats-state', JSON.stringify(state));
	}

	/**
	 * 加载位置
	 */
	private loadPosition(): void {
		try {
			const saved = localStorage.getItem('mobile-floating-stats-state');
			if (saved) {
				const state = JSON.parse(saved);
				this.position = { x: state.x || 20, y: state.y || 100 };
			}
		} catch (error) {
			console.error('[MobileFloatingStats] 加载位置失败:', error);
		}
	}
}
