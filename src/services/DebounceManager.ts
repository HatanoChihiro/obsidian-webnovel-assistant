/**
 * 防抖回调函数类型
 */
type DebounceCallback = (...args: unknown[]) => void;

/**
 * 防抖管理器
 * 统一管理所有防抖和限流操作
 */
export class DebounceManager {
	private timers: Map<string, number>;
	private lastCallTimes: Map<string, number>;

	constructor() {
		this.timers = new Map();
		this.lastCallTimes = new Map();
	}

	/**
	 * 防抖函数 - 延迟执行
	 * 在指定延迟时间内，如果再次调用，则重置计时器
	 * 
	 * @param key 唯一标识符
	 * @param callback 要执行的回调函数
	 * @param delay 延迟时间（毫秒）
	 */
	debounce(key: string, callback: DebounceCallback, delay: number): void {
		// 取消之前的定时器
		if (this.timers.has(key)) {
			window.clearTimeout(this.timers.get(key));
		}

		// 设置新的定时器
		const timer = window.setTimeout(() => {
			callback();
			this.timers.delete(key);
		}, delay);

		this.timers.set(key, timer);
	}

	/**
	 * 限流函数 - 限制执行频率
	 * 在指定时间间隔内，最多执行一次
	 * 
	 * @param key 唯一标识符
	 * @param callback 要执行的回调函数
	 * @param interval 时间间隔（毫秒）
	 */
	throttle(key: string, callback: DebounceCallback, interval: number): void {
		const now = Date.now();
		const lastCallTime = this.lastCallTimes.get(key) || 0;

		if (now - lastCallTime >= interval) {
			callback();
			this.lastCallTimes.set(key, now);
		}
	}

	/**
	 * 取消待处理的防抖操作
	 * 
	 * @param key 唯一标识符
	 */
	cancel(key: string): void {
		const timer = this.timers.get(key);
		if (timer) {
			window.clearTimeout(timer);
			this.timers.delete(key);
		}
	}

	/**
	 * 取消所有待处理操作
	 */
	cancelAll(): void {
		this.timers.forEach((timer) => {
			window.clearTimeout(timer);
		});
		this.timers.clear();
		this.lastCallTimes.clear();
		console.log('[DebounceManager] 所有防抖操作已取消');
	}

	/**
	 * 立即执行并取消防抖
	 * 
	 * @param key 唯一标识符
	 * @param callback 要执行的回调函数
	 */
	flush(key: string, callback: DebounceCallback): void {
		this.cancel(key);
		callback();
	}

	/**
	 * 获取当前待处理的防抖操作数量
	 */
	getPendingCount(): number {
		return this.timers.size;
	}
}
