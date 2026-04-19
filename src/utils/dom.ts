/**
 * DOM 操作工具函数
 * 提供 DOM 元素创建、样式注入等辅助功能
 */

/**
 * 注入全局样式到文档头部
 * @param styleId - 样式元素的唯一 ID
 * @param cssContent - CSS 内容
 * 
 * @example
 * ```typescript
 * injectGlobalStyle('my-plugin-styles', '.my-class { color: red; }');
 * ```
 */
export function injectGlobalStyle(styleId: string, cssContent: string): void {
	// 检查是否已存在
	if (document.getElementById(styleId)) {
		return;
	}
	
	const style = document.createElement('style');
	style.id = styleId;
	style.innerHTML = cssContent;
	document.head.appendChild(style);
}

/**
 * 移除全局样式
 * @param styleId - 样式元素的唯一 ID
 * 
 * @example
 * ```typescript
 * removeGlobalStyle('my-plugin-styles');
 * ```
 */
export function removeGlobalStyle(styleId: string): void {
	const style = document.getElementById(styleId);
	if (style) {
		style.remove();
	}
}

/**
 * 创建带有类名和文本的 DOM 元素
 * @param tag - HTML 标签名
 * @param options - 元素选项
 * @returns 创建的 DOM 元素
 * 
 * @example
 * ```typescript
 * const div = createElement('div', { 
 *   cls: 'my-class', 
 *   text: 'Hello',
 *   attr: { 'data-id': '123' }
 * });
 * ```
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	options?: {
		cls?: string;
		text?: string;
		attr?: Record<string, string>;
	}
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	
	if (options?.cls) {
		element.className = options.cls;
	}
	
	if (options?.text) {
		element.textContent = options.text;
	}
	
	if (options?.attr) {
		for (const [key, value] of Object.entries(options.attr)) {
			element.setAttribute(key, value);
		}
	}
	
	return element;
}

/**
 * 安全地设置元素文本内容
 * 如果元素不存在,不会抛出错误
 * @param elementId - 元素 ID
 * @param text - 要设置的文本
 * 
 * @example
 * ```typescript
 * safeSetText('myElement', 'New text');
 * ```
 */
export function safeSetText(elementId: string, text: string): void {
	const element = document.getElementById(elementId);
	if (element) {
		element.textContent = text;
	}
}

/**
 * 切换元素的类名
 * @param element - DOM 元素
 * @param className - 类名
 * @param force - 强制添加(true)或移除(false),不传则切换
 * 
 * @example
 * ```typescript
 * toggleClass(myElement, 'active'); // 切换
 * toggleClass(myElement, 'active', true); // 强制添加
 * toggleClass(myElement, 'active', false); // 强制移除
 * ```
 */
export function toggleClass(
	element: HTMLElement,
	className: string,
	force?: boolean
): void {
	if (force === undefined) {
		element.classList.toggle(className);
	} else if (force) {
		element.classList.add(className);
	} else {
		element.classList.remove(className);
	}
}
