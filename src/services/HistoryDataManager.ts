import { Plugin } from 'obsidian';
import { DailyStat } from '../types/settings';

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
	private saveQueue: Promise<void> = Promise.resolve();
	private dirty: boolean = false; // 脏标记：只保存有变更的数据
	private historyFilePath: string;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		// 历史数据文件路径：.obsidian/plugins/WebNovel Assistant/history-data.json
		this.historyFilePath = `${plugin.manifest.dir}/history-data.json`;
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
				this.historyData = JSON.parse(content);
				console.log(`[HistoryDataManager] 已从独立文件加载 ${Object.keys(this.historyData).length} 条历史记录`);
				return this.historyData;
			}

			// 如果独立文件不存在，尝试从旧位置迁移
			const data = await this.plugin.loadData();
			
			// 从 data.json 的 historyData key 迁移
			if (data && data.historyData && Object.keys(data.historyData).length > 0) {
				console.log('[HistoryDataManager] 检测到 data.json 中的历史数据，开始迁移到独立文件');
				this.historyData = data.historyData;
				this.dirty = true;
				await this.saveHistory();
				console.log(`[HistoryDataManager] 已迁移 ${Object.keys(this.historyData).length} 条历史记录到独立文件`);
				return this.historyData;
			}
			
			// 从旧版 dailyHistory key 迁移
			if (data && data.dailyHistory && Object.keys(data.dailyHistory).length > 0) {
				console.log('[HistoryDataManager] 检测到旧版历史数据，开始迁移到独立文件');
				this.historyData = data.dailyHistory;
				this.dirty = true;
				await this.saveHistory();
				console.log(`[HistoryDataManager] 已迁移 ${Object.keys(this.historyData).length} 条历史记录到独立文件`);
				// 注意：不删除旧 dailyHistory key，保证降级安全
				return this.historyData;
			}

			// 无历史数据
			console.log('[HistoryDataManager] 无历史数据，创建空记录');
			return {};
		} catch (error) {
			console.error('[HistoryDataManager] 加载历史数据失败:', error);
			return {};
		}
	}

	/**
	 * 保存历史数据到独立文件
	 * 使用队列确保串行化，避免并发写入冲突
	 */
	async saveHistory(): Promise<void> {
		if (!this.dirty) {
			// 无变更，跳过保存
			return;
		}

		this.saveQueue = this.saveQueue.then(async () => {
			try {
				const adapter = this.plugin.app.vault.adapter;
				const content = JSON.stringify(this.historyData, null, 2);
				await adapter.write(this.historyFilePath, content);
				this.dirty = false;
				console.log('[HistoryDataManager] 历史数据已保存到独立文件');
			} catch (error) {
				console.error('[HistoryDataManager] 保存历史数据失败:', error);
				throw error;
			}
		});

		return this.saveQueue;
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
				addedWords: 0
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
