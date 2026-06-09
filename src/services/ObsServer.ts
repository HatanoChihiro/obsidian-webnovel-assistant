import { Notice, Platform } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * OBS 直播叠加层 HTTP Server
 *
 * 提供 HTTP 服务器用于 OBS 浏览器源实时获取写作统计数据
 * 支持两个端点:
 * - /api/stats: 返回 JSON 格式的统计数据
 * - /: 返回完整的 HTML 叠加层页面
 */
export class ObsOverlayServer {
	private plugin: WebNovelAssistantPlugin;
	private server: import('../types/node').NodeHTTPServer | null = null;
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
			console.warn('[WebNovel Assistant] OBS 服务器已在运行，跳过重复启动');
			return true;
		}

		try {
			const http = activeWindow.require('http');
			const plugin = this.plugin;

			this.server = http.createServer((req: import('../types/node').NodeHTTPRequest, res: import('../types/node').NodeHTTPResponse) => {
				// [安全] 校验请求基本有效性
				if (!req.url) { res.writeHead(400); res.end(); return; }
				if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

				let url: URL;
				try { url = new URL(req.url, `http://localhost:${this.port}`); }
				catch { res.writeHead(400); res.end(); return; }

				if (url.pathname === '/api/stats') {
					res.writeHead(200, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					});
					void plugin.getObsStats().then(stats => {
					res.end(JSON.stringify(stats));
					});
				} else {
					res.writeHead(200, {
						'Content-Type': 'text/html; charset=utf-8',
						'Access-Control-Allow-Origin': '*'
					});
					res.end(plugin.buildObsOverlayHtml());
				}
			});

			this.server.listen(this.port, '127.0.0.1', () => {
				new Notice(`OBS 叠加层已启动: http://127.0.0.1:${this.port}`);
			});

			this.server.on('error', (e: NodeJS.ErrnoException) => {
				console.error('[WebNovel Assistant] OBS 服务器错误:', e);

				// 清理引用，防止后续 start() 被守卫拦截
				this.server = null;

				if (e.code === 'EADDRINUSE') {
					const suggestedPorts = [this.port + 1, this.port + 2, this.port + 10];
					new Notice(
						`端口 ${this.port} 已被占用！\n` +
						`请更换端口后重试 (建议: ${suggestedPorts.join(', ')})`,
						15000
					);
				} else {
					new Notice(
						`OBS 服务器启动失败\n` +
						`错误: ${e.message}`,
						12000
					);
				}
			});

			return true;
		} catch (e) {
			console.error('[WebNovel Assistant] 无法启动 OBS 服务器:', e);
			this.server = null;

			new Notice(
				'OBS 服务器启动失败\n' +
				'可能原因: Node.js 模块不可用',
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
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
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
