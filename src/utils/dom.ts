/**
 * DOM 操作工具函数
 * 提供样式注入等辅助功能
 */

/**
 * 注入全局样式到文档头部
 */
export function injectGlobalStyle(styleId: string, cssContent: string): void {
	const existingStyle = document.getElementById(styleId);
	if (existingStyle) {
		existingStyle.textContent = cssContent;
		return;
	}

	const style = document.createElement('style');
	style.id = styleId;
	style.textContent = cssContent;
	document.head.appendChild(style);
}

/**
 * 移除全局样式
 */
export function removeGlobalStyle(styleId: string): void {
	const style = document.getElementById(styleId);
	if (style) {
		style.remove();
	}
}