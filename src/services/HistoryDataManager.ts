import { Logger } from '../utils/Logger';
import type { Plugin } from 'obsidian';
import type { DailyStat } from '../types/settings';
import { getPluginDir } from '../utils/platform';
import { SerializedWriter } from '../utils/SerializedWriter';

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
	private writer = new SerializedWriter();
	private mutationVersion = 0;
	private persistedVersion = 0;

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
				this.markDirty();
				await this.saveHistory();
				return this.historyData;
			}
			
			// 从旧版 dailyHistory key 迁移
			if (data && data.dailyHistory && typeof data.dailyHistory === 'object' && !Array.isArray(data.dailyHistory)) {
				this.historyData = data.dailyHistory as Record<string, DailyStat>;
				this.markDirty();
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
	 * 使用版本化不可变快照和串行写入，避免旧写入覆盖保存期间产生的新更新。
	 */
	async saveHistory(_forceImmediate = false): Promise<void> {
		if (!this.dirty) return;

		// 在排队时捕获不可变快照。写入完成后仅确认该快照对应的版本，
		// 写入期间产生的新变更会保持 dirty，等待下一次保存或 flush。
		const version = this.mutationVersion;
		const content = JSON.stringify(this.historyData);
		return this.writer.enqueue(async () => {
			if (version <= this.persistedVersion) return;
			try {
				await this.plugin.app.vault.adapter.write(this.historyFilePath, content);
				this.persistedVersion = version;
				this.dirty = this.mutationVersion > this.persistedVersion;
			} catch (error) {
				this.dirty = true;
				Logger.error('[HistoryDataManager] 保存历史数据失败:', error);
				throw error;
			}
		});
	}

	/**
	 * 强制等待所有待处理的保存操作完成
	 * 主要用于 onunload 生命周期
	 */
	async flush(): Promise<void> {
		// 只要 flush 期间又出现更新，就继续保存最新版本，直到队列稳定。
		do {
			await this.saveHistory(true);
			await this.writer.flush();
		} while (this.dirty);
	}

	private markDirty(): void {
		this.mutationVersion++;
		this.dirty = true;
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
		this.markDirty();
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
			this.markDirty();
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
		this.markDirty();
	}

	/**
	 * 修正指定日期的写作字数，不改变专注和摸鱼计时数据
	 */
	setDailyWords(date: string, words: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.addedWords = words;
		this.markDirty();
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
			this.markDirty();
		}
	}

	/**
	 * 增加指定日期的专注时长
	 * 自动设置脏标记
	 */
	addFocusTime(date: string, ms: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.focusMs += ms;
		this.markDirty();
	}

	/**
	 * 增加指定日期的摸鱼时长
	 * 自动设置脏标记
	 */
	addSlackTime(date: string, ms: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.slackMs += ms;
		this.markDirty();
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
		this.markDirty();
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
		this.markDirty();
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
