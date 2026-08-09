import { Logger } from '../utils/Logger';
import type { Plugin } from 'obsidian';
import type { DailyStat } from '../types/settings';
import { getPluginDir } from '../utils/platform';

/**
 * 历史数据管理器
 * 负责管理每日写作统计数据，独立于设置系统
 * 
 * 核心收益：
 * - 历史数据保存到独立文件 history-data.json
 * - saveSettings() 不再序列化历史数据，提升性能
 * - 历史数据独立保存周期，避免频繁写入
 * - 使用脏标记避免无变更时的无效写入
 */
export class HistoryDataManager {
	private plugin: Plugin;
	private historyData: Record<string, DailyStat> = {};
	private dirty: boolean = false; // 脏标记：只保存有变更的数据
	private historyFilePath: string;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		// 历史数据文件路径：.obsidian/plugins/WebNovel Assistant/history-data.json
		this.historyFilePath = `${getPluginDir(plugin)}/history-data.json`;
	}

	/**
	 * 加载历史数据
	 * 支持从旧版 dailyHistory 自动迁移到新版独立文件
	 */
	async loadHistory(): Promise<Record<string, DailyStat>> {
		try {
			// 尝试从新位置（独立文件）加载
			const adapter = this.plugin.app.vault.adapter;
			if (await adapter.exists(this.historyFilePath)) {
				const content = await adapter.read(this.historyFilePath);
				const parsed = JSON.parse(content) as Record<string, DailyStat>;
				
				// [BUGFIX] 数据验证：确保解析结果为对象而非 null 或数组
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					this.historyData = parsed;
				} else {
					Logger.warn('[HistoryDataManager] 历史数据格式无效，已重置为空对象');
					this.historyData = {};
				}
				
				return this.historyData;
			}

			// 如果独立文件不存在，尝试从旧位置迁移
			const data = await this.plugin.loadData() as Record<string, unknown> | null;
			
			// 从 data.json 的 historyData key 迁移
			if (data && data.historyData && typeof data.historyData === 'object' && !Array.isArray(data.historyData)) {
				this.historyData = data.historyData as Record<string, DailyStat>;
				this.dirty = true;
				await this.saveHistory();
				return this.historyData;
			}
			
			// 从旧版 dailyHistory key 迁移
			if (data && data.dailyHistory && typeof data.dailyHistory === 'object' && !Array.isArray(data.dailyHistory)) {
				this.historyData = data.dailyHistory as Record<string, DailyStat>;
				this.dirty = true;
				await this.saveHistory();
				// 注意：不删除旧 dailyHistory key，保证降级安全
				return this.historyData;
			}

			// 无历史数据
			return {};
		} catch (error) {
			Logger.error('[HistoryDataManager] 加载历史数据失败:', error);
			this.historyData = {};
			return {};
		}
	}

	/**
	 * 保存历史数据到独立文件
	 * [M-P4] 优化：使用 busy/pending 模式替代简单的 promise 链，防止大规模并发调用导致内存泄漏
	 */
	private isSaving = false;
	private pendingSaveTimer: number | null = null;
	private pendingSaveResolve: (() => void) | null = null;
	private pendingSavePromise: Promise<void> | null = null;

	async saveHistory(forceImmediate = false): Promise<void> {
		if (!this.dirty) return;
		
		if (this.isSaving && !forceImmediate) {
			if (!this.pendingSavePromise) {
				this.pendingSavePromise = new Promise((resolve) => {
					this.pendingSaveResolve = resolve;
					this.pendingSaveTimer = window.setTimeout(() => {
						this.clearPendingTimer();
						void this.saveHistory().then(() => {
							resolve();
						});
					}, 500);
				});
			}
			return this.pendingSavePromise;
		}

		if (forceImmediate) {
			this.clearPendingTimer();
			// 如果已经是强制写入，无视 isSaving 锁（风险极低，因为只在退出或明确要求时调用）
			this.isSaving = false; 
		}

		this.isSaving = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const content = JSON.stringify(this.historyData);
			await adapter.write(this.historyFilePath, content);
			this.dirty = false;
		} catch (error) {
			Logger.error('[HistoryDataManager] 保存历史数据失败:', error);
		} finally {
			this.isSaving = false;
		}
	}

	private clearPendingTimer() {
		if (this.pendingSaveTimer !== null) {
			window.clearTimeout(this.pendingSaveTimer);
			this.pendingSaveTimer = null;
		}
		if (this.pendingSaveResolve) {
			this.pendingSaveResolve();
			this.pendingSaveResolve = null;
		}
		this.pendingSavePromise = null;
	}

	/**
	 * 强制等待所有待处理的保存操作完成
	 * 主要用于 onunload 生命周期
	 */
	async flush(): Promise<void> {
		// 卸载时强制写入，不依赖 dirty 标志防止数据丢失
		this.dirty = true;
		await this.saveHistory(true);
	}

	/**
	 * 获取所有历史数据
	 */
	getHistory(): Record<string, DailyStat> {
		return this.historyData;
	}

	/**
	 * 更新指定日期的统计数据
	 */
	updateDailyStat(date: string, stat: DailyStat): void {
		this.historyData[date] = stat;
		this.dirty = true;
	}

	/**
	 * 获取指定日期的统计数据
	 */
	getDailyStat(date: string): DailyStat | undefined {
		return this.historyData[date];
	}

	/**
	 * 获取或创建指定日期的统计数据
	 * 便利方法，减少调用方代码量
	 */
	getOrCreateDailyStat(date: string): DailyStat {
		if (!this.historyData[date]) {
			this.historyData[date] = {
				focusMs: 0,
				slackMs: 0,
				addedWords: 0,
				hourlyFocus: new Array(24).fill(0),
				hourlySlack: new Array(24).fill(0)
			};
			this.dirty = true;
		}
		return this.historyData[date];
	}



	/**
	 * 增加指定日期的字数统计
	 * 自动设置脏标记
	 */
	addWords(date: string, words: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.addedWords += words;
		this.dirty = true;
	}

	/**
	 * 重置指定日期的写作统计数据（字数、专注时间等归零）
	 */
	resetDailyStat(date: string): void {
		if (this.historyData[date]) {
			this.historyData[date] = {
				focusMs: 0,
				slackMs: 0,
				addedWords: 0,
				hourlyFocus: new Array(24).fill(0),
				hourlySlack: new Array(24).fill(0)
			};
			this.dirty = true;
		}
	}

	/**
	 * 增加指定日期的专注时长
	 * 自动设置脏标记
	 */
	addFocusTime(date: string, ms: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.focusMs += ms;
		this.dirty = true;
	}

	/**
	 * 增加指定日期的摸鱼时长
	 * 自动设置脏标记
	 */
	addSlackTime(date: string, ms: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.slackMs += ms;
		this.dirty = true;
	}

	/**
	 * 增加指定日期指定小时的专注时长
	 */
	addHourlyFocusTime(date: string, hour: number, ms: number): void {
		if (hour < 0 || hour > 23) return;
		const stat = this.getOrCreateDailyStat(date);
		if (!stat.hourlyFocus || stat.hourlyFocus.length !== 24) {
			const old = stat.hourlyFocus || [];
			stat.hourlyFocus = new Array(24).fill(0).map((_, i) => old[i] || 0);
		}
		stat.hourlyFocus[hour] += ms;
		this.dirty = true;
	}

	/**
	 * 增加指定日期指定小时的摸鱼时长
	 */
	addHourlySlackTime(date: string, hour: number, ms: number): void {
		if (hour < 0 || hour > 23) return;
		const stat = this.getOrCreateDailyStat(date);
		if (!stat.hourlySlack || stat.hourlySlack.length !== 24) {
			const old = stat.hourlySlack || [];
			stat.hourlySlack = new Array(24).fill(0).map((_, i) => old[i] || 0);
		}
		stat.hourlySlack[hour] += ms;
		this.dirty = true;
	}

	/**
	 * 获取历史数据条目数量
	 */
	getHistorySize(): number {
		return Object.keys(this.historyData).length;
	}

	/**
	 * 检查是否有未保存的变更
	 */
	isDirty(): boolean {
		return this.dirty;
	}
}
