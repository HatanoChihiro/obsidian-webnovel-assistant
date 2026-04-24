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
		if (!Platform.isDesktop) return false;
		
		try {
			const http = window.require('http') as import('../types/node').NodeHTTP;
			const plugin = this.plugin;

			this.server = http.createServer((req: import('../types/node').NodeHTTPRequest, res: import('../types/node').NodeHTTPResponse) => {
				const url = new URL(req.url, `http://localhost:${this.port}`);

				if (url.pathname === '/api/stats') {
					res.writeHead(200, {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					});
					res.end(JSON.stringify(plugin.getObsStats()));
				} else {
					res.writeHead(200, {
						'Content-Type': 'text/html; charset=utf-8',
						'Access-Control-Allow-Origin': '*'
					});
					res.end(plugin.buildObsOverlayHtml());
				}
			});

			this.server.listen(this.port, '127.0.0.1', () => {
				console.log(`[WebNovel Assistant] OBS Overlay server started at http://127.0.0.1:${this.port}`);
				new Notice(`OBS 叠加层已启动: http://127.0.0.1:${this.port}`);
			});

			this.server.on('error', async (e: NodeJS.ErrnoException) => {
				console.error('[WebNovel Assistant] OBS 服务器错误:', e);
				
				// 降级: 自动切换到文件导出模式
				this.plugin.settings.enableObs = false;
				this.plugin.settings.enableLegacyObsExport = true;
				await this.plugin.saveSettings();
				
				if (e.code === 'EADDRINUSE') {
					const suggestedPorts = [this.port + 1, this.port + 2, this.port + 10];
					new Notice(
						`端口 ${this.port} 已被占用！\n` +
						`已自动切换到文件导出模式\n\n` +
						`如需使用 OBS HTTP 服务器，请:\n` +
						`1. 在设置中更换端口 (建议: ${suggestedPorts.join(', ')})\n` +
						`2. 重新启用 OBS 服务器`,
						15000
					);
				} else {
					new Notice(
						`OBS 服务器启动失败\n` +
						`已自动切换到文件导出模式\n\n` +
						`错误: ${e.message}\n` +
						`您可以在设置中配置文件导出路径`,
						12000
					);
				}
			});

			return true;
		} catch (e) {
			console.error('[WebNovel Assistant] 无法启动 OBS 服务器:', e);
			
			// 降级: 自动切换到文件导出模式
			this.plugin.settings.enableObs = false;
			this.plugin.settings.enableLegacyObsExport = true;
			this.plugin.saveSettings();
			
			new Notice(
				'OBS 服务器启动失败\n' +
				'已自动切换到文件导出模式\n\n' +
				'可能原因: Node.js 模块不可用\n' +
				'您可以在设置中配置文件导出路径',
				12000
			);
			return false;
		}
	}

	/**
	 * 停止 OBS HTTP 服务器
	 */
	stop() {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}

	/**
	 * 更新服务器端口
	 * 如果端口变化，会自动重启服务器
	 */
	updatePort(newPort: number) {
		if (this.port === newPort && this.server) return;
		this.stop();
		this.port = newPort;
		this.start();
	}
}
