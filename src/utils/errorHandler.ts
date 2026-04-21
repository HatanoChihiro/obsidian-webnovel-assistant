import { Notice } from 'obsidian';

/**
 * 错误处理工具类
 * 提供统一的错误处理、日志记录和降级机制
 */
export class ErrorHandler {
	/**
	 * 执行主操作，失败时执行备选方案
	 * @param primary 主操作
	 * @param fallback 备选操作
	 * @param context 上下文（用于日志）
	 * @returns 主操作或备选操作的结果
	 */
	static async withFallback<T>(
		primary: () => Promise<T>,
		fallback: () => Promise<T>,
		context: string
	): Promise<T> {
		try {
			return await primary();
		} catch (error) {
			console.warn(`[${context}] 主操作失败，使用备选方案:`, error);
			try {
				return await fallback();
			} catch (fallbackError) {
				console.error(`[${context}] 备选方案也失败:`, fallbackError);
				throw fallbackError;
			}
		}
	}

	/**
	 * 执行操作，失败时返回默认值
	 * @param operation 操作
	 * @param defaultValue 默认值
	 * @param context 上下文
	 * @returns 操作结果或默认值
	 */
	static async withDefault<T>(
		operation: () => Promise<T>,
		defaultValue: T,
		context: string
	): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			console.warn(`[${context}] 操作失败，使用默认值:`, error);
			return defaultValue;
		}
	}

	/**
	 * 执行同步操作，失败时返回默认值
	 */
	static withDefaultSync<T>(
		operation: () => T,
		defaultValue: T,
		context: string
	): T {
		try {
			return operation();
		} catch (error) {
			console.warn(`[${context}] 操作失败，使用默认值:`, error);
			return defaultValue;
		}
	}

	/**
	 * 记录错误信息
	 */
	static logError(context: string, message: string, error?: unknown): void {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[${context}] ${message}`, errorMsg);
	}

	/**
	 * 记录警告信息
	 */
	static logWarn(context: string, message: string, error?: unknown): void {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.warn(`[${context}] ${message}`, errorMsg);
	}

	/**
	 * 记录信息
	 */
	static logInfo(context: string, message: string): void {
		console.log(`[${context}] ${message}`);
	}

	/**
	 * 显示错误通知
	 */
	static showError(message: string, timeout: number = 5000): void {
		new Notice(message, timeout);
	}

	/**
	 * 显示警告通知
	 */
	static showWarning(message: string, timeout: number = 4000): void {
		new Notice(message, timeout);
	}

	/**
	 * 显示成功通知
	 */
	static showSuccess(message: string, timeout: number = 3000): void {
		new Notice(message, timeout);
	}

	/**
	 * 显示信息通知
	 */
	static showInfo(message: string, timeout: number = 3000): void {
		new Notice(message, timeout);
	}

	/**
	 * 处理异步操作，自动显示错误通知
	 */
	static async handle<T>(
		operation: () => Promise<T>,
		context: string,
		showNotice: boolean = true
	): Promise<T | null> {
		try {
			return await operation();
		} catch (error) {
			this.logError(context, '操作失败', error);
			if (showNotice) {
				this.showError(`❌ ${context} 失败`);
			}
			return null;
		}
	}

	/**
	 * 处理同步操作，自动显示错误通知
	 */
	static handleSync<T>(
		operation: () => T,
		context: string,
		showNotice: boolean = true
	): T | null {
		try {
			return operation();
		} catch (error) {
			this.logError(context, '操作失败', error);
			if (showNotice) {
				this.showError(`❌ ${context} 失败`);
			}
			return null;
		}
	}

	/**
	 * 验证条件，失败时抛出错误
	 */
	static assert(condition: boolean, message: string): void {
		if (!condition) {
			throw new Error(message);
		}
	}

	/**
	 * 验证值不为空
	 */
	static assertNotNull<T>(value: T | null | undefined, fieldName: string): T {
		if (value === null || value === undefined) {
			throw new Error(`${fieldName} 不能为空`);
		}
		return value;
	}

	/**
	 * 验证字符串不为空
	 */
	static assertNotEmpty(value: string, fieldName: string): string {
		if (!value || !value.trim()) {
			throw new Error(`${fieldName} 不能为空`);
		}
		return value.trim();
	}

	/**
	 * 验证数字在指定范围内
	 */
	static assertInRange(
		value: number,
		min: number,
		max: number,
		fieldName: string
	): number {
		if (value < min || value > max) {
			throw new Error(`${fieldName} 必须在 ${min}-${max} 之间`);
		}
		return value;
	}

	/**
	 * 获取错误消息
	 */
	static getErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === 'string') {
			return error;
		}
		return '未知错误';
	}

	/**
	 * 获取错误堆栈
	 */
	static getErrorStack(error: unknown): string {
		if (error instanceof Error) {
			return error.stack || '';
		}
		return '';
	}

	/**
	 * 创建自定义错误
	 */
	static createError(message: string, code?: string): Error {
		const error = new Error(message);
		if (code) {
			(error as any).code = code;
		}
		return error;
	}

	/**
	 * 重试操作
	 */
	static async retry<T>(
		operation: () => Promise<T>,
		maxAttempts: number = 3,
		delayMs: number = 1000,
		context: string = 'Operation'
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (attempt < maxAttempts) {
					console.warn(
						`[${context}] 第 ${attempt} 次尝试失败，${delayMs}ms 后重试...`,
						lastError.message
					);
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
			}
		}

		throw lastError || new Error(`${context} 在 ${maxAttempts} 次尝试后仍然失败`);
	}

	/**
	 * 超时包装
	 */
	static async withTimeout<T>(
		operation: () => Promise<T>,
		timeoutMs: number,
		context: string = 'Operation'
	): Promise<T> {
		return Promise.race([
			operation(),
			new Promise<T>((_, reject) =>
				setTimeout(
					() => reject(new Error(`[${context}] 操作超时 (${timeoutMs}ms)`)),
					timeoutMs
				)
			)
		]);
	}
}
