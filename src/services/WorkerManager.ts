import { Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * Worker 管理器
 * 负责专注计时 Worker 的生命周期、重启机制和消息处理
 */
export class WorkerManager {
	private plugin: WebNovelAssistantPlugin;
	private worker: Worker | null = null;
	private restartAttempts: number = 0;
	private readonly MAX_RESTARTS: number = 5;
	private restartTimer: number | null = null;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 初始化并启动 Worker
	 */
	public setup(): void {
		if (this.restartAttempts >= this.MAX_RESTARTS) {
			new Notice('[警告] 时间追踪功能多次启动失败，已自动禁用。请重启 Obsidian 或检查浏览器设置。', 8000);
			console.error('[WorkerManager] Worker 达到最大重启次数，已停止尝试');
			return;
		}

		const workerCode = `
			let interval;
			self.onmessage = function(e) {
				if (e.data === 'start') {
					clearInterval(interval);
					interval = setInterval(() => self.postMessage('tick'), 1000);
				} else if (e.data === 'stop') {
					clearInterval(interval);
				}
			};
		`;
		const blob = new Blob([workerCode], { type: 'application/javascript' });
		const blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(blobUrl);
		URL.revokeObjectURL(blobUrl);

		this.worker.onerror = (error) => {
			this.handleError(error);
		};

		this.worker.onmessage = () => {
			this.handleMessage();
		};

		// 稳定运行 60s 后重置计数器
		if (this.restartAttempts > 0) {
			setTimeout(() => {
				this.restartAttempts = 0;
				console.log('[WorkerManager] Worker 运行稳定，重启计数器已重置');
			}, 60000);
		}
	}

	/**
	 * 向 Worker 发送消息
	 */
	public postMessage(msg: string): void {
		this.worker?.postMessage(msg);
	}

	/**
	 * 终止 Worker
	 */
	public terminate(): void {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}

	private handleError(error: ErrorEvent): void {
		this.restartAttempts++;
		console.error(
			`[WorkerManager] Worker 错误 (尝试 ${this.restartAttempts}/${this.MAX_RESTARTS}):`,
			'\n  消息:', error.message
		);

		const wasTracking = this.plugin.isTracking;
		this.terminate();

		this.restartTimer = window.setTimeout(() => {
			console.log('[WorkerManager] 正在重启 Worker...');
			this.setup();

			if (wasTracking && this.worker) {
				this.worker.postMessage('start');
				this.plugin.lastTickTime = Date.now();
				console.log('[WorkerManager] Worker 已重启，追踪状态已恢复');
			}
			
			if (this.restartAttempts < this.MAX_RESTARTS) {
				new Notice('[警告] 时间追踪 Worker 已自动重启\n追踪功能已恢复正常', 5000);
			}
		}, 5000);
	}

	private handleMessage(): void {
		if (!this.plugin.isTracking) return;
		
		const now = Date.now();
		const delta = now - this.plugin.lastTickTime;
		this.plugin.lastTickTime = now;
		
		const isAppFocused = document.hasFocus();
		const isTypingActive = (now - this.plugin.lastEditTime) < this.plugin.settings.idleTimeoutThreshold;
		const today = window.moment().format('YYYY-MM-DD');

		if (isAppFocused && isTypingActive) {
			this.plugin.focusMs += delta;
			this.plugin.historyManager.addFocusTime(today, delta);
		} else {
			this.plugin.slackMs += delta;
			this.plugin.historyManager.addSlackTime(today, delta);
		}
		
		// 调度保存
		this.plugin.adaptiveDebounceManager.debounceFixed('save-history-worker', () => {
			this.plugin.historyManager.saveHistory().catch(err => {
				console.error('[WorkerManager] 保存历史数据失败:', err);
			});
		}, 60000);
		
		this.plugin.refreshStatusViews();
		if (this.plugin.settings.obs.enableLegacyObsExport) this.plugin.exportLegacyOBS();
	}
}
