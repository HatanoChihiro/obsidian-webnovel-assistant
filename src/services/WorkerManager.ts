import { Logger } from '../utils/Logger';
import { Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';
import { isMobile } from '../utils/platform';

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
	private backgroundStartTime: number | null = null;
	private visibilityDocument: Document | null = null;

	private visibilityHandler = () => this.handleVisibilityChange();

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

		if (typeof activeDocument !== 'undefined') {
			this.visibilityDocument?.removeEventListener('visibilitychange', this.visibilityHandler);
			this.visibilityDocument = this.plugin.app?.workspace?.containerEl?.ownerDocument ?? activeDocument;
			this.visibilityDocument.addEventListener('visibilitychange', this.visibilityHandler);
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
		if (msg === 'start') {
			this.backgroundStartTime = null;
		}
		this.worker?.postMessage(msg);
	}

	/**
	 * 终止 Worker
	 */
	public terminate(): void {
		this.visibilityDocument?.removeEventListener('visibilitychange', this.visibilityHandler);
		this.visibilityDocument = null;
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
		this.backgroundStartTime = null;
	}

	/**
	 * 实现 Destroyable 接口，销毁 Worker 资源
	 */
	public destroy(): void {
		this.terminate();
	}

	/**
	 * 处理页面前后台可见性变更
	 */
	private handleVisibilityChange(): void {
		if (!this.plugin.isTracking) return;

		const visibilityDocument = this.visibilityDocument;
		const isVisible = visibilityDocument?.visibilityState === 'visible';
		const now = Date.now();

		if (!isVisible) {
			// 切出应用或手机锁屏，记录进入后台的时间戳
			if (!this.backgroundStartTime) {
				this.backgroundStartTime = now;
			}
		} else {
			// 切回应用前台：仅重置状态，不计算时间
			// 时间累加由 handleMessage 的 delta > 2000 分支统一处理，
			// 避免与 Worker 线程的 tick 消息产生竞态双重计算
			this.backgroundStartTime = null;
			// 重置打字激活状态，防止未输入字符时误加专注时间
			this.plugin.lastEditTime = 0;
			// 注意：不要重置 lastTickTime！
			// 让 handleMessage 通过 delta > 2000 分支正确地将后台时间一次性计入摸鱼
			this.plugin.mobileFloatingStats?.updateTimerUI();
			this.plugin.refreshStatusViews(false);
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

		const visibilityDocument = this.visibilityDocument;
		const isAppVisible = visibilityDocument?.visibilityState === 'visible';
		const isAppFocused = isMobile() ? isAppVisible : Boolean(isAppVisible && visibilityDocument?.hasFocus());
		const isTypingActive = (now - this.plugin.lastEditTime) < this.plugin.settings.idleTimeoutThreshold;
		const today = window.moment().format('YYYY-MM-DD');
		const hour = new Date().getHours();

		if (delta > 2000) {
			// 线程挂起、休眠或长跨度补偿
			// 由于 worker interval 是 1000ms，正常 delta 约在 1000-1100ms
			// 如果 delta > 2000ms，说明必定发生了至少 1 次丢帧，通常是因为应用被切到后台导致系统暂停了 worker
			// 此时尽管唤醒时 focus=true，但这部分挂起的时间绝对不能算作专注时间，全部算入摸鱼
			this.plugin.slackMs += delta;
			this.plugin.historyManager.addSlackTime(today, delta);
			this.plugin.historyManager.addHourlySlackTime(today, hour, delta);
		} else if (isAppFocused && isTypingActive) {
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
		
		this.plugin.mobileFloatingStats?.updateTimerUI();
		this.plugin.refreshStatusViews(false);
	}
}
