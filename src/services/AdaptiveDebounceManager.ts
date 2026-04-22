/**
 * 自适应防抖管理器
 * 根据用户输入速度动态调整防抖延迟时间
 * 
 * 策略：
 * - 快速输入时（< 200ms 间隔）：使用较长防抖（500ms），减少更新频率
 * - 中速输入时（200-500ms 间隔）：使用中等防抖（300ms），平衡响应和性能
 * - 慢速输入时（> 500ms 间隔）：使用较短防抖（150ms），提高响应速度
 * 
 * 优势：
 * - 快速打字时减少 CPU 使用
 * - 慢速编辑时提高响应性
 * - 自动适应用户习惯
 */

type DebounceCallback = (...args: unknown[]) => void;

interface InputSpeedStats {
	lastInputTime: number;
	recentIntervals: number[]; // 最近 5 次输入间隔
	averageInterval: number;
}

export class AdaptiveDebounceManager {
	private timers: Map<string, number>;
	private speedStats: Map<string, InputSpeedStats>;
	
	// 防抖延迟配置（毫秒）
	private readonly FAST_TYPING_DELAY = 500;    // 快速输入
	private readonly MEDIUM_TYPING_DELAY = 300;  // 中速输入
	private readonly SLOW_TYPING_DELAY = 150;    // 慢速输入
	
	// 输入速度阈值（毫秒）
	private readonly FAST_THRESHOLD = 200;   // < 200ms 为快速
	private readonly SLOW_THRESHOLD = 500;   // > 500ms 为慢速
	
	// 统计窗口大小
	private readonly STATS_WINDOW_SIZE = 5;

	constructor() {
		this.timers = new Map();
		this.speedStats = new Map();
	}

	/**
	 * 自适应防抖函数
	 * 根据输入速度自动调整延迟时间
	 * 
	 * @param key 唯一标识符
	 * @param callback 要执行的回调函数
	 */
	debounce(key: string, callback: DebounceCallback): void {
		const now = Date.now();
		
		// 更新输入速度统计
		this.updateSpeedStats(key, now);
		
		// 根据输入速度计算延迟
		const delay = this.calculateDelay(key);
		
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
	 * 固定延迟的防抖函数（兼容旧接口）
	 * 
	 * @param key 唯一标识符
	 * @param callback 要执行的回调函数
	 * @param delay 延迟时间（毫秒）
	 */
	debounceFixed(key: string, callback: DebounceCallback, delay: number): void {
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
		const stats = this.speedStats.get(key);
		const now = Date.now();
		const lastTime = stats?.lastInputTime || 0;

		if (now - lastTime >= interval) {
			callback();
			this.updateSpeedStats(key, now);
		}
	}

	/**
	 * 更新输入速度统计
	 */
	private updateSpeedStats(key: string, now: number): void {
		let stats = this.speedStats.get(key);
		
		if (!stats) {
			stats = {
				lastInputTime: now,
				recentIntervals: [],
				averageInterval: 0
			};
			this.speedStats.set(key, stats);
			return;
		}

		// 计算距离上次输入的间隔
		const interval = now - stats.lastInputTime;
		
		// 更新间隔列表（保持最近 N 次）
		stats.recentIntervals.push(interval);
		if (stats.recentIntervals.length > this.STATS_WINDOW_SIZE) {
			stats.recentIntervals.shift();
		}
		
		// 计算平均间隔
		stats.averageInterval = stats.recentIntervals.reduce((sum, val) => sum + val, 0) / stats.recentIntervals.length;
		
		// 更新最后输入时间
		stats.lastInputTime = now;
	}

	/**
	 * 根据输入速度计算防抖延迟
	 */
	private calculateDelay(key: string): number {
		const stats = this.speedStats.get(key);
		
		// 如果没有统计数据，使用中等延迟
		if (!stats || stats.recentIntervals.length < 2) {
			return this.MEDIUM_TYPING_DELAY;
		}

		const avgInterval = stats.averageInterval;

		// 快速输入：使用较长延迟，减少更新频率
		if (avgInterval < this.FAST_THRESHOLD) {
			return this.FAST_TYPING_DELAY;
		}
		
		// 慢速输入：使用较短延迟，提高响应速度
		if (avgInterval > this.SLOW_THRESHOLD) {
			return this.SLOW_TYPING_DELAY;
		}
		
		// 中速输入：使用中等延迟
		return this.MEDIUM_TYPING_DELAY;
	}

	/**
	 * 获取当前输入速度统计（用于调试）
	 */
	getSpeedStats(key: string): { averageInterval: number; delay: number } | null {
		const stats = this.speedStats.get(key);
		if (!stats) return null;
		
		return {
			averageInterval: Math.round(stats.averageInterval),
			delay: this.calculateDelay(key)
		};
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
		this.speedStats.clear();
		console.log('[AdaptiveDebounceManager] 所有防抖操作已取消');
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

	/**
	 * 清除指定 key 的统计数据
	 */
	clearStats(key: string): void {
		this.speedStats.delete(key);
	}

	/**
	 * 清除所有统计数据
	 */
	clearAllStats(): void {
		this.speedStats.clear();
	}
}
