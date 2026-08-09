import { Logger } from '../utils/Logger';
import { Notice, Platform } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';

interface IncomingMessage {
    url?: string;
    method?: string;
}

interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(data?: string): void;
}

interface ServerError extends Error {
    code?: string;
}

interface HttpServer {
    listen(port: number, host: string, callback?: () => void): void;
    on(event: 'error', callback: (err: ServerError) => void): this;
    close(callback?: () => void): void;
    closeAllConnections?(): void;
}

/**
 * OBS 直播叠加层 HTTP Server
 *
 * 提供 HTTP 服务器用于 OBS 浏览器源实时获取写作统计数据
 * 支持两个端点:
 * - /api/stats: 返回 JSON 格式的统计数据
 * - /: 返回完整的 HTML 叠加层页面
 *
 * 注意：Node.js 内置模块 "http" 仅在桌面端（Electron 环境）可用，
 * import type 语句在编译时擦除，移动端不会受影响。
 */

export class ObsOverlayServer {
	private plugin: WebNovelAssistantPlugin;
	private server: HttpServer | null = null;
	private port: number;

	constructor(plugin: WebNovelAssistantPlugin, port: number) {
		this.plugin = plugin;
		this.port = port;
	}

	/**
	 * 启动 OBS HTTP 服务器
	 * @returns 是否成功启动
	 */
	start(): boolean {
		// [安全] 桌面端守卫：activeWindow.require('http') 仅在桌面端可用，移动端直接跳过
		if (!Platform.isDesktop) return false;
		if (this.server) {
			Logger.warn('[WebNovel Assistant] OBS 服务器已在运行，跳过重复启动');
			return true;
		}

		try {
			const http = window.require('http') as { createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): HttpServer };
			const plugin = this.plugin;

			this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
				// [安全] 校验请求基本有效性
				if (!req.url) { res.writeHead(400); res.end(); return; }
				if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

				let url: URL;
				try { url = new URL(req.url, `http://localhost:${this.port}`); }
				catch { res.writeHead(400); res.end(); return; }

				if (url.pathname === '/api/stats') {
					res.writeHead(200, {
						'Content-Type': 'application/json'
					});
					try {
						const stats = plugin.statisticsManager.getCoreStats();
						res.end(JSON.stringify(stats));
					} catch (err) {
						Logger.error('[WebNovel Assistant] ObsServer stats error:', err);
						if (!(res as { headersSent?: boolean }).headersSent) {
							res.writeHead(500, { 'Content-Type': 'application/json' });
						}
						res.end(JSON.stringify({ error: 'Internal server error' }));
					}
				} else {
					res.writeHead(200, {
						'Content-Type': 'text/html; charset=utf-8'
					});
					res.end(plugin.buildObsOverlayHtml());
				}
			});

			this.server.listen(this.port, '127.0.0.1', () => {
				new Notice(t('notice.obs-overlay-started', { url: `http://127.0.0.1:${this.port}` }));
			});

			this.server.on('error', (e: ServerError) => {
				Logger.error('[WebNovel Assistant] OBS 服务器错误:', e);

				// 清理引用，防止后续 start() 被守卫拦截
				this.server = null;

				if (e.code === 'EADDRINUSE') {
					const suggestedPorts = [this.port + 1, this.port + 2, this.port + 10];
					new Notice(
						t('notice.obs-port-in-use', { port: String(this.port), suggestions: suggestedPorts.join(', ') }),
						15000
					);
				} else {
					new Notice(
						t('notice.obs-start-failed', { message: e.message }),
						12000
					);
				}
			});

			return true;
		} catch (e) {
			Logger.error('[WebNovel Assistant] 无法启动 OBS 服务器:', e);
			this.server = null;

			new Notice(
				t('notice.obs-module-unavailable'),
				12000
			);
			return false;
		}
	}

	/**
	 * 停止 OBS HTTP 服务器
	 */
	async stop(): Promise<void> {
		if (this.server) {
			const server = this.server;
			this.server = null;
			// 强制关闭所有活跃连接（OBS 浏览器源会保持 keep-alive 连接）
			if (typeof server.closeAllConnections === 'function') {
				server.closeAllConnections();
			}
			let fallbackTimerId: number | null = null;
			await Promise.race([
				new Promise<void>((resolve) => {
					server.close(() => {
						if (fallbackTimerId !== null) window.clearTimeout(fallbackTimerId);
						resolve();
					});
				}),
				new Promise<void>((resolve) => {
					fallbackTimerId = window.setTimeout(() => {
						Logger.warn('[WebNovel Assistant] OBS 服务器关闭超时，强制返回');
						resolve();
					}, 3000);
				})
			]);
		}
	}

	/**
	 * 更新服务器端口
	 * 如果端口变化，会自动重启服务器
	 */
	async updatePort(newPort: number) {
		if (this.port === newPort && this.server) return;
		await this.stop();
		this.port = newPort;
		this.start();
	}
}
