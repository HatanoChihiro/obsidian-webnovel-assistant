/**
 * DOM 操作工具函数
 * 提供样式注入等辅助功能
 */



/**
 * 基于 requestAnimationFrame 的高频事件节流函数
 * 适用于 drag, touchmove, scroll 等对屏幕刷新率敏感的事件
 */
export function rafThrottle<T extends (...args: any[]) => void>(fn: T) {
	let raf = 0;
	let latestArgs: Parameters<T> | null = null;

	const throttled = (...args: Parameters<T>) => {
		latestArgs = args;

		if (raf) return;

		raf = window.requestAnimationFrame(() => {
			raf = 0;
			if (latestArgs) {
				fn(...latestArgs);
			}
		});
	};

	throttled.cancel = () => {
		window.cancelAnimationFrame(raf);
		raf = 0;
	};

	return throttled;
}