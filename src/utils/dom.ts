/**
 * DOM 操作工具函数
 * 提供样式注入等辅助功能
 */



/**
 * 基于 requestAnimationFrame 的高频事件节流函数
 * 适用于 drag, touchmove, scroll 等对屏幕刷新率敏感的事件
 */
export interface RafThrottledFn<T extends (...args: never[]) => void> {
	(...args: Parameters<T>): void;
	cancel: () => void;
}

export function rafThrottle<T extends (...args: never[]) => void>(fn: T): RafThrottledFn<T> {
	let raf = 0;
	let latestArgs: Parameters<T> | null = null;

	const throttled = ((...args: Parameters<T>) => {
		latestArgs = args;

		if (raf) return;

		raf = window.requestAnimationFrame(() => {
			raf = 0;
			if (latestArgs) {
				fn(...latestArgs);
			}
		});
	}) as RafThrottledFn<T>;

	throttled.cancel = () => {
		window.cancelAnimationFrame(raf);
		raf = 0;
	};

	return throttled;
}

/**
 * 自动调整嵌套 textarea 的高度，并保持滚动位置/底部跟随
 *
 * 1. 记录调整前的 scrollTop、scrollHeight 与 clientHeight，判断视口是否处于底部附近。
 * 2. 临时为容器设置 minHeight 锁定当前 scrollHeight，避免 textarea 高度设为 auto 时容器瞬间收缩导致浏览器将 scrollTop 强制归零或产生滚动条向上跳动。
 * 3. 测量并更新 textarea 的实际 scrollHeight（兼顾 border-box 边框）。
 * 4. 释放容器的临时 minHeight。
 * 5. 若调整前处于/接近底部（或内容初次超出容器），使容器跟随到新底部；若处于中间位置，则精准保持调整前的 scrollTop。
 */
export function autoResizeNestedTextarea(
	container: HTMLElement,
	textarea: HTMLTextAreaElement
): void {
	const prevScrollTop = container.scrollTop ?? 0;
	const prevScrollHeight = container.scrollHeight ?? 0;
	const clientHeight = container.clientHeight ?? 0;
	const maxScrollBefore = Math.max(0, prevScrollHeight - clientHeight);
	// 阈值设为 8px，兼顾不同缩放比与分屏下的子像素舍入
	const isNearBottom = maxScrollBefore <= 0 || prevScrollTop >= maxScrollBefore - 8;

	let borderOffset = 0;
	try {
		const ownerWindow = textarea.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
		if (ownerWindow?.getComputedStyle) {
			const computed = ownerWindow.getComputedStyle(textarea);
			if (computed?.boxSizing === 'border-box') {
				const borderTop = parseFloat(computed.borderTopWidth) || 0;
				const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
				borderOffset = borderTop + borderBottom;
			}
		}
	} catch {
		borderOffset = 0;
	}

	const prevInlineMinHeight = container.style?.minHeight ?? '';
	try {
		// 临时固定容器高度，防止 textarea 设为 auto 时容器瞬时收缩导致 scrollTop 被浏览器强制重置或滚动条闪烁
		container.setCssStyles({ minHeight: `${prevScrollHeight}px` });
		textarea.setCssStyles({ height: 'auto' });
		textarea.setCssStyles({ height: `${(textarea.scrollHeight ?? 0) + borderOffset}px` });
	} finally {
		container.setCssStyles({ minHeight: prevInlineMinHeight });
	}

	if (isNearBottom) {
		const newScrollHeight = container.scrollHeight ?? 0;
		const newClientHeight = container.clientHeight ?? 0;
		container.scrollTop = Math.max(0, newScrollHeight - newClientHeight);
	} else {
		container.scrollTop = prevScrollTop;
	}
}
