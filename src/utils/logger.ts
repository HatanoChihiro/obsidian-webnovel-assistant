/**
 * 日志系统
 * 提供统一的日志记录，支持不同的日志级别
 */

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	NONE = 4,
}

export class Logger {
	private static currentLevel: LogLevel = LogLevel.INFO;
	private static enableTimestamp: boolean = true;
	private static enableContext: boolean = true;

	/**
	 * 设置日志级别
	 */
	static setLevel(level: LogLevel): void {
		this.currentLevel = level;
	}

	/**
	 * 设置是否显示时间戳
	 */
	static setTimestamp(enable: boolean): void {
		this.enableTimestamp = enable;
	}

	/**
	 * 设置是否显示上下文
	 */
	static setContext(enable: boolean): void {
		this.enableContext = enable;
	}

	/**
	 * 获取格式化的前缀
	 */
	private static getPrefix(context: string, level: string): string {
		let prefix = '';

		if (this.enableTimestamp) {
			const now = new Date();
			const time = now.toLocaleTimeString('zh-CN', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
			});
			prefix += `[${time}] `;
		}

		if (this.enableContext && context) {
			prefix += `[${context}] `;
		}

		prefix += `[${level}] `;

		return prefix;
	}

	/**
	 * 调试日志
	 */
	static debug(context: string, message: string, data?: unknown): void {
		if (this.currentLevel <= LogLevel.DEBUG) {
			const prefix = this.getPrefix(context, 'DEBUG');
			if (data !== undefined) {
				console.debug(prefix + message, data);
			} else {
				console.debug(prefix + message);
			}
		}
	}

	/**
	 * 信息日志
	 */
	static info(context: string, message: string, data?: unknown): void {
		if (this.currentLevel <= LogLevel.INFO) {
			const prefix = this.getPrefix(context, 'INFO');
			if (data !== undefined) {
				console.log(prefix + message, data);
			} else {
				console.log(prefix + message);
			}
		}
	}

	/**
	 * 警告日志
	 */
	static warn(context: string, message: string, error?: unknown): void {
		if (this.currentLevel <= LogLevel.WARN) {
			const prefix = this.getPrefix(context, 'WARN');
			if (error !== undefined) {
				console.warn(prefix + message, error);
			} else {
				console.warn(prefix + message);
			}
		}
	}

	/**
	 * 错误日志
	 */
	static error(context: string, message: string, error?: unknown): void {
		if (this.currentLevel <= LogLevel.ERROR) {
			const prefix = this.getPrefix(context, 'ERROR');
			if (error !== undefined) {
				console.error(prefix + message, error);
			} else {
				console.error(prefix + message);
			}
		}
	}

	/**
	 * 性能日志（记录执行时间）
	 */
	static perf(context: string, operation: string, duration: number): void {
		if (this.currentLevel <= LogLevel.DEBUG) {
			const prefix = this.getPrefix(context, 'PERF');
			console.log(`${prefix}${operation} 耗时 ${duration.toFixed(2)}ms`);
		}
	}

	/**
	 * 测量函数执行时间
	 */
	static async measureAsync<T>(
		context: string,
		operation: string,
		fn: () => Promise<T>
	): Promise<T> {
		const start = performance.now();
		try {
			const result = await fn();
			const duration = performance.now() - start;
			this.perf(context, operation, duration);
			return result;
		} catch (error) {
			const duration = performance.now() - start;
			this.error(context, `${operation} 失败 (${duration.toFixed(2)}ms)`, error);
			throw error;
		}
	}

	/**
	 * 测量同步函数执行时间
	 */
	static measureSync<T>(
		context: string,
		operation: string,
		fn: () => T
	): T {
		const start = performance.now();
		try {
			const result = fn();
			const duration = performance.now() - start;
			this.perf(context, operation, duration);
			return result;
		} catch (error) {
			const duration = performance.now() - start;
			this.error(context, `${operation} 失败 (${duration.toFixed(2)}ms)`, error);
			throw error;
		}
	}

	/**
	 * 分组日志（用于组织相关的日志）
	 */
	static group(context: string, groupName: string): void {
		if (this.currentLevel <= LogLevel.INFO) {
			console.group(`[${context}] ${groupName}`);
		}
	}

	/**
	 * 结束分组
	 */
	static groupEnd(): void {
		if (this.currentLevel <= LogLevel.INFO) {
			console.groupEnd();
		}
	}

	/**
	 * 表格日志
	 */
	static table(context: string, data: unknown): void {
		if (this.currentLevel <= LogLevel.INFO) {
			console.log(`[${context}]`);
			console.table(data);
		}
	}

	/**
	 * 清空控制台
	 */
	static clear(): void {
		console.clear();
	}

	/**
	 * 获取当前日志级别
	 */
	static getLevel(): LogLevel {
		return this.currentLevel;
	}

	/**
	 * 获取日志级别名称
	 */
	static getLevelName(level: LogLevel): string {
		const names: Record<LogLevel, string> = {
			[LogLevel.DEBUG]: 'DEBUG',
			[LogLevel.INFO]: 'INFO',
			[LogLevel.WARN]: 'WARN',
			[LogLevel.ERROR]: 'ERROR',
			[LogLevel.NONE]: 'NONE',
		};
		return names[level] || 'UNKNOWN';
	}
}

/**
 * 创建上下文特定的日志记录器
 */
export function createLogger(context: string) {
	return {
		debug: (message: string, data?: unknown) => Logger.debug(context, message, data),
		info: (message: string, data?: unknown) => Logger.info(context, message, data),
		warn: (message: string, error?: unknown) => Logger.warn(context, message, error),
		error: (message: string, error?: unknown) => Logger.error(context, message, error),
		perf: (operation: string, duration: number) => Logger.perf(context, operation, duration),
		measureAsync: <T,>(operation: string, fn: () => Promise<T>) =>
			Logger.measureAsync(context, operation, fn),
		measureSync: <T,>(operation: string, fn: () => T) =>
			Logger.measureSync(context, operation, fn),
	};
}
