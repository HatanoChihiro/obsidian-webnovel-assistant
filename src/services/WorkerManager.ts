import { Logger } from '../utils/Logger';
import { Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

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
	private restartResetTimer: number | null = null;
	private blobUrl: string | null = null;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 初始化并启动 Worker
	 */
	public setup(): void {
		if (this.restartAttempts >= this.MAX_RESTARTS) {
			new Notice(t('notice.worker-max-restarts'), 8000);
			Logger.error('[WorkerManager] Worker 达到最大重启次数，已停止尝试');
			return;
		}

		const workerCode = `
			let interval;
			self.postMessage('ready');
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
		this.blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(this.blobUrl);

		this.worker.onerror = (error) => {
			this.handleError(error);
		};

		this.worker.onmessage = (e) => {
			if (e.data === 'ready') {
				if (this.blobUrl) {
					URL.revokeObjectURL(this.blobUrl);
					this.blobUrl = null;
				}
				return;
			}
			this.handleMessage();
		};

		// 稳定运行 60s 后重置计数器
		if (this.restartAttempts > 0) {
			this.restartResetTimer = window.setTimeout(() => {
				this.restartAttempts = 0;
				this.restartResetTimer = null;
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
			window.clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		if (this.restartResetTimer) {
			window.clearTimeout(this.restartResetTimer);
			this.restartResetTimer = null;
		}
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		if (this.blobUrl) {
			URL.revokeObjectURL(this.blobUrl);
			this.blobUrl = null;
		}
	}

	private handleError(error: ErrorEvent): void {
		this.restartAttempts++;
		Logger.error(
			`[WorkerManager] Worker 错误 (尝试 ${this.restartAttempts}/${this.MAX_RESTARTS}):`,
			'\n  消息:', error.message
		);

		const wasTracking = this.plugin.isTracking;
		this.terminate();

		this.restartTimer = window.setTimeout(() => {
			this.setup();

			if (wasTracking && this.worker) {
				this.worker.postMessage('start');
				this.plugin.lastTickTime = Date.now();
			}
			
			if (this.restartAttempts < this.MAX_RESTARTS) {
				new Notice(t('notice.worker-restarted'), 5000);
			}
		}, 5000);
	}

	private handleMessage(): void {
		if (!this.plugin.isTracking) return;
		
		const now = Date.now();
		if (!this.plugin.lastTickTime) this.plugin.lastTickTime = now;
		const delta = now - this.plugin.lastTickTime;
		this.plugin.lastTickTime = now;
		
		const isAppFocused = activeDocument.hasFocus();
		const isTypingActive = (now - this.plugin.lastEditTime) < this.plugin.settings.idleTimeoutThreshold;
		const today = window.moment().format('YYYY-MM-DD');

		const hour = new Date().getHours();
		if (isAppFocused && isTypingActive) {
			this.plugin.focusMs += delta;
			this.plugin.historyManager.addFocusTime(today, delta);
			this.plugin.historyManager.addHourlyFocusTime(today, hour, delta);
		} else {
			this.plugin.slackMs += delta;
			this.plugin.historyManager.addSlackTime(today, delta);
			this.plugin.historyManager.addHourlySlackTime(today, hour, delta);
		}
		
		// 调度保存
		this.plugin.adaptiveDebounceManager.debounceFixed('save-history-worker', () => {
			this.plugin.historyManager.saveHistory().catch(err => {
				Logger.error('[WorkerManager] 保存历史数据失败:', err);
			});
		}, 60000);
		
		this.plugin.refreshStatusViews();
	}
}
