import { App, TFile, MarkdownView, Notice } from 'obsidian';
import { VIEW_TYPES } from '../constants';

/**
 * UI 工具函数集合
 * 提供常用的 UI 操作，减少代码重复
 */

/**
 * 获取当前活动文件
 */
export function getCurrentFile(app: App): TFile | null {
	return app.workspace.getActiveFile();
}

/**
 * 获取当前活动的 Markdown 视图
 */
export function getCurrentMarkdownView(app: App): MarkdownView | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	return view || null;
}

/**
 * 获取当前编辑器
 */
export function getCurrentEditor(app: App) {
	const view = getCurrentMarkdownView(app);
	return view?.editor || null;
}

/**
 * 切换侧边栏视图
 * @param app Obsidian App 实例
 * @param viewType 视图类型
 * @param position 打开位置（'left' 或 'right'）
 */
export function toggleView(
	app: App,
	viewType: string,
	position: 'left' | 'right' = 'right'
): void {
	const leaves = app.workspace.getLeavesOfType(viewType);
	
	if (leaves.length > 0) {
		const leaf = leaves[0];
		// 检查视图当前是否真正显示在界面上
		// 如果被其他 Tab 挡住，isShown() 会返回 false
		const isVisible = leaf.view.containerEl.isShown();

		if (isVisible) {
			// 如果已经在前台可见，说明用户的真实意图是关闭它
			app.workspace.detachLeavesOfType(viewType);
		} else {
			// 如果在后台，说明用户的真实意图是切换到它
			app.workspace.revealLeaf(leaf);
		}
	} else {
		// 视图未打开，创建新视图
		const leaf = app.workspace.getLeaf(position === 'left' ? 'split' : 'tab');
		leaf.setViewState({
			type: viewType,
			active: true,
		});
		// 新建后确保它被前台聚焦
		app.workspace.revealLeaf(leaf);
	}
}

/**
 * 打开指定视图（如果未打开）
 */
export function openView(
	app: App,
	viewType: string,
	position: 'left' | 'right' = 'right'
): void {
	const leaves = app.workspace.getLeavesOfType(viewType);
	
	if (leaves.length === 0) {
		const leaf = app.workspace.getLeaf(position === 'left' ? 'split' : 'tab');
		leaf.setViewState({
			type: viewType,
			active: true,
		});
	}
}

/**
 * 关闭指定视图
 */
export function closeView(app: App, viewType: string): void {
	app.workspace.detachLeavesOfType(viewType);
}

/**
 * 检查视图是否已打开
 */
export function isViewOpen(app: App, viewType: string): boolean {
	return app.workspace.getLeavesOfType(viewType).length > 0;
}

/**
 * 在新标签页中打开文件
 */
export async function openFileInNewTab(app: App, file: TFile): Promise<void> {
	const leaf = app.workspace.getLeaf('tab');
	await leaf.openFile(file);
}

/**
 * 在新窗口中打开文件
 */
export async function openFileInNewWindow(app: App, file: TFile): Promise<void> {
	const leaf = app.workspace.getLeaf('window');
	await leaf.openFile(file);
}

/**
 * 获取文件夹路径
 */
export function getFolderPath(file: TFile): string {
	return file.parent?.path || '';
}

/**
 * 获取文件夹名称
 */
export function getFolderName(file: TFile): string {
	return file.parent?.name || '';
}

/**
 * 格式化进度条显示
 * @param current 当前值
 * @param total 总值
 * @param length 进度条长度（默认 10）
 * @returns 格式化的进度条字符串
 */
export function formatProgressBar(
	current: number,
	total: number,
	length: number = 10
): string {
	if (total === 0) return '░'.repeat(length);
	
	const percentage = Math.round((current / total) * 100);
	const filled = Math.round((percentage / 100) * length);
	return '█'.repeat(filled) + '░'.repeat(length - filled);
}

/**
 * 格式化百分比显示
 */
export function formatPercentage(current: number, total: number): string {
	if (total === 0) return '0%';
	return Math.round((current / total) * 100) + '%';
}

/**
 * 显示成功通知
 */
export function showSuccess(message: string, timeout: number = 3000): void {
	new Notice(message, timeout);
}

/**
 * 显示错误通知
 */
export function showError(message: string, timeout: number = 5000): void {
	new Notice(message, timeout);
}

/**
 * 显示警告通知
 */
export function showWarning(message: string, timeout: number = 4000): void {
	new Notice(message, timeout);
}

/**
 * 显示信息通知
 */
export function showInfo(message: string, timeout: number = 3000): void {
	new Notice(message, timeout);
}

/**
 * 复制文本到剪贴板
 */
export async function copyToClipboard(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		showSuccess('[成功] 已复制到剪贴板');
	} catch (error) {
		showError('[错误] 复制失败');
		console.error('Copy to clipboard failed:', error);
	}
}

/**
 * 从剪贴板读取文本
 */
export async function readFromClipboard(): Promise<string | null> {
	try {
		return await navigator.clipboard.readText();
	} catch (error) {
		console.error('Read from clipboard failed:', error);
		return null;
	}
}

/**
 * 创建 DOM 元素并设置样式
 */
export function createStyledElement<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string = '',
	style: string = ''
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (style) el.style.cssText = style;
	return el;
}

/**
 * 设置元素的多个样式属性
 */
export function setStyles(
	element: HTMLElement,
	styles: Record<string, string>
): void {
	Object.entries(styles).forEach(([key, value]) => {
		(element.style as any)[key] = value;
	});
}

/**
 * 添加多个 CSS 类
 */
export function addClasses(element: HTMLElement, classes: string[]): void {
	element.classList.add(...classes);
}

/**
 * 移除多个 CSS 类
 */
export function removeClasses(element: HTMLElement, classes: string[]): void {
	element.classList.remove(...classes);
}

/**
 * 切换 CSS 类
 */
export function toggleClass(element: HTMLElement, className: string, force?: boolean): void {
	element.classList.toggle(className, force);
}

/**
 * 检查元素是否有指定类
 */
export function hasClass(element: HTMLElement, className: string): boolean {
	return element.classList.contains(className);
}

/**
 * 获取所有视图类型
 */
export function getAllViewTypes(): typeof VIEW_TYPES {
	return VIEW_TYPES;
}

/**
 * 刷新所有指定类型的视图
 */
export function refreshViews(app: App, viewType: string): void {
	const leaves = app.workspace.getLeavesOfType(viewType);
	leaves.forEach(leaf => {
		if (leaf.view && typeof (leaf.view as any).refresh === 'function') {
			(leaf.view as any).refresh();
		}
	});
}

/**
 * 延迟执行函数
 */
export function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout | null = null;
	
	return function executedFunction(...args: Parameters<T>) {
		const later = () => {
			timeout = null;
			func(...args);
		};
		
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
	func: T,
	limit: number
): (...args: Parameters<T>) => void {
	let inThrottle: boolean = false;
	
	return function executedFunction(...args: Parameters<T>) {
		if (!inThrottle) {
			func(...args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
}
