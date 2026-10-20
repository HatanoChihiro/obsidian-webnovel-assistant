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

export function rafThrottle<T extends (...args: never[]) => void>(fn: T, ownerWindow: Window | null = window): RafThrottledFn<T> {
	let raf = 0;
	let generation = 0;
	let latestArgs: Parameters<T> | null = null;

	const throttled = ((...args: Parameters<T>) => {
		if (!ownerWindow) return;
		latestArgs = args;

		if (raf) return;

		const currentGeneration = ++generation;
		raf = ownerWindow.requestAnimationFrame(() => {
			if (currentGeneration !== generation) return;
			raf = 0;
			const pendingArgs = latestArgs;
			latestArgs = null;
			if (pendingArgs) fn(...pendingArgs);
		});
	}) as RafThrottledFn<T>;

	throttled.cancel = () => {
		generation++;
		ownerWindow?.cancelAnimationFrame(raf);
		latestArgs = null;
		raf = 0;
	};

	return throttled;
}
