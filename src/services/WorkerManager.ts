import { Logger } from '../utils/Logger';
import { Notice, TFile, type TAbstractFile } from 'obsidian';
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
	private lastTickDate: string | null = null;
	private currentScopeFile: TFile | null = null;
	private isCurrentDocumentInWorkspace: boolean = false;

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

		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			this.currentScopeFile = activeFile;
			this.isCurrentDocumentInWorkspace = this.plugin.cacheManager.isFileInWorkspace(activeFile);
		} else if (this.currentScopeFile) {
			this.isCurrentDocumentInWorkspace = this.plugin.cacheManager.isFileInWorkspace(this.currentScopeFile);
		} else {
			this.isCurrentDocumentInWorkspace = false;
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
			this.lastTickDate = window.moment().format('YYYY-MM-DD');
			this.reevaluateScope();
		}
		this.worker?.postMessage(msg);
	}

	/**
	 * 重新评估当前文档的工作区归属范围（用于设置变更或当前文件重命名等场景）
	 */
	public reevaluateScope(): void {
		if (!this.currentScopeFile) {
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				this.currentScopeFile = activeFile;
			}
		}
		if (this.currentScopeFile) {
			const newScope = this.plugin.cacheManager.isFileInWorkspace(this.currentScopeFile);
			const hasScopeChanged = this.isCurrentDocumentInWorkspace !== newScope;
			if (this.plugin.isTracking && hasScopeChanged) {
				const now = Date.now();
				this.accumulateElapsedTime(now);
			}
			this.isCurrentDocumentInWorkspace = newScope;
		} else {
			this.isCurrentDocumentInWorkspace = false;
		}
	}

	/**
	 * 处理活动文档切换：
	 * 1. 侧边栏/工作台/Modal 无文件时保留最近文档的作用域
	 * 2. 捕获 Worker tick 之间的快速切入/切出，按旧作用域结算过渡段耗时
	 * 3. 工作区内部文档间切换不重置/刷新打字活动时间戳
	 */
	public handleActiveFileChange(file: TFile | null): void {
		if (!file) {
			return;
		}

		const newScope = this.plugin.cacheManager.isFileInWorkspace(file);
		const hasScopeChanged = this.currentScopeFile !== file && this.isCurrentDocumentInWorkspace !== newScope;

		if (this.plugin.isTracking && hasScopeChanged) {
			const now = Date.now();
			this.accumulateElapsedTime(now);
		}

		this.currentScopeFile = file;
		this.isCurrentDocumentInWorkspace = newScope;
	}

	/**
	 * 处理编辑器变动事件：
	 * 仅当正在编辑的文件为当前活动文件且位于工作区时才刷新用户活动时间戳；
	 * 工作区外的输入以及后台非活动文档的输入绝不刷新工作区内专注所用的活动时间戳。
	 */
	public handleEditorChange(file?: TFile | null): void {
		const activeFile = this.plugin.app.workspace.getActiveFile() ?? this.currentScopeFile;
		if (file && activeFile && file !== activeFile && file.path !== activeFile.path) {
			return;
		}

		const targetFile = file ?? activeFile;
		if (targetFile && this.plugin.cacheManager.isFileInWorkspace(targetFile)) {
			this.plugin.lastEditTime = Date.now();
		}
	}

	/**
	 * 当文件或包含当前文件的文件夹重命名时，重新评估工作区归属（无需全库扫描）
	 */
	public handleFileRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFile && (this.currentScopeFile === file || this.currentScopeFile?.path === oldPath)) {
			this.currentScopeFile = file;
		}
		if (this.currentScopeFile) {
			this.reevaluateScope();
		}
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
		this.currentScopeFile = null;
		this.isCurrentDocumentInWorkspace = false;
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

	/**
	 * 计算并结算从上一个时间点到当前时间点的耗时
	 */
	private accumulateElapsedTime(now: number): void {
		if (!this.plugin.isTracking) return;
		if (!this.plugin.lastTickTime) {
			this.plugin.lastTickTime = now;
			return;
		}
		const delta = now - this.plugin.lastTickTime;
		if (delta <= 0) return;
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
		} else if (this.isCurrentDocumentInWorkspace && isAppFocused && isTypingActive) {
			this.plugin.focusMs += delta;
			this.plugin.historyManager.addFocusTime(today, delta);
			this.plugin.historyManager.addHourlyFocusTime(today, hour, delta);
		} else {
			this.plugin.slackMs += delta;
			this.plugin.historyManager.addSlackTime(today, delta);
			this.plugin.historyManager.addHourlySlackTime(today, hour, delta);
		}
	}

	private handleMessage(): void {
		if (!this.plugin.isTracking) return;

		const now = Date.now();
		this.accumulateElapsedTime(now);
		
		// 调度保存
		this.plugin.adaptiveDebounceManager.debounceFixed('save-history-worker', () => {
			this.plugin.historyManager.saveHistory().catch(err => {
				Logger.error('[WorkerManager] 保存历史数据失败:', err);
			});
		}, 60000);
		
		this.plugin.mobileFloatingStats?.updateTimerUI();

		const today = window.moment().format('YYYY-MM-DD');
		const isNewDay = this.lastTickDate !== null && this.lastTickDate !== today;
		this.lastTickDate = today;

		if (isNewDay) {
			this.plugin.refreshStatusViews(true);
		} else {
			this.plugin.refreshStatusTimers();
		}
	}
}
