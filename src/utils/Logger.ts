import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 统一日志管理器
 * 
 * 在生产环境下，大部分日志输出会保持静默。
 * 只有在插件设置中开启 Debug 模式时，才会输出 `info` / `warn` / `error`。
 * 部分非常严重的系统错误可以强制输出。
 */
export class Logger {
	private static plugin: WebNovelAssistantPlugin | null = null;

	public static initialize(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	private static get isDebug(): boolean {
		return this.plugin?.settings.debugMode ?? false;
	}

	/** 输出普通信息日志 (仅 Debug 模式) */
	public static info(...args: unknown[]): void {
		if (this.isDebug) {
			console.log(...args);
		}
	}

	/** 输出警告日志 (仅 Debug 模式) */
	public static warn(...args: unknown[]): void {
		if (this.isDebug) {
			console.warn(...args);
		}
	}

	/** 输出错误日志 (仅 Debug 模式) */
	public static error(...args: unknown[]): void {
		if (this.isDebug) {
			console.error(...args);
		}
	}

	/**
	 * 强制输出的致命错误（即使没开 Debug 模式也会输出）
	 * 仅用于插件初始化失败等无法掩盖的崩溃
	 */
	public static fatal(...args: unknown[]): void {
		console.error('[WebNovel Assistant FATAL]', ...args);
	}
}
