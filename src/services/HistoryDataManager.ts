import { Logger } from '../utils/Logger';
import type { DailyStat } from '../types/settings';
import { getPluginDir } from '../utils/platform';
import { JsonSnapshotStore } from '../utils/JsonSnapshotStore';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 历史数据管理器
 * 负责管理每日写作统计数据
 */
export class HistoryDataManager {
	private plugin: WebNovelAssistantPlugin;
	private historyData: Record<string, DailyStat> = {};
	private historyFilePath: string;
	private store: JsonSnapshotStore<Record<string, DailyStat>>;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
		// 历史数据文件路径（仅用于迁移）
		this.historyFilePath = `${getPluginDir(plugin)}/history-data.json`;

		this.store = new JsonSnapshotStore<Record<string, DailyStat>>({
			write: async (content) => {
				const parsed = JSON.parse(content) as Record<string, DailyStat>;
				if (this.plugin.settings) {
					this.plugin.settings.historyData = parsed;
				}
				if (this.plugin.settingsManager) {
					await this.plugin.settingsManager.saveSettings();
				}
			},
			getSnapshot: () => this.historyData,
			onError: (error) => {
				Logger.error('[HistoryDataManager] 保存数据失败:', error);
			}
		});
	}

	/**
	 * 加载历史数据
	 * 支持从独立文件、旧版 dailyHistory 自动迁移到 data.json 的 historyData
	 */
	async loadHistory(): Promise<Record<string, DailyStat>> {
		try {
			const data = await this.plugin.loadData() as Record<string, unknown> | null;
			const canonical = this.plugin.settings?.historyData;

			// 1. 首选：从 canonical plugin.settings 加载（最新标准）
			if (canonical !== undefined) {
				this.historyData = this.validateHistory(canonical);
				this.plugin.settings.historyData = this.historyData;
				this.store.markClean(this.historyData);
				return this.historyData;
			}

			// 2. 迁移：如果标准字段不存在，尝试从独立文件迁移
			const adapter = this.plugin.app.vault.adapter;
			if (await adapter.exists(this.historyFilePath)) {
				const content = await adapter.read(this.historyFilePath);
				const parsed = this.validateHistory(JSON.parse(content));

				if (Object.keys(parsed).length > 0) {
					this.historyData = parsed;
					Logger.info('[HistoryDataManager] 从 history-data.json 成功迁移数据');
					this.store.markDirty();
					await this.saveHistory();
				} else {
					Logger.warn('[HistoryDataManager] history-data.json 数据格式无效或为空，放弃迁移');
					this.historyData = {};
				}

				return this.historyData;
			}

			// 3. 迁移：从旧版 dailyHistory key 迁移
			if (data && data.dailyHistory !== undefined) {
				this.historyData = this.validateHistory(data.dailyHistory);
				if (Object.keys(this.historyData).length === 0) return {};
				Logger.info('[HistoryDataManager] 从 dailyHistory 成功迁移数据');
				this.store.markDirty();
				await this.saveHistory();
				return this.historyData;
			}

			// 无历史数据
			this.historyData = {};
			return {};
		} catch (error) {
			Logger.error('[HistoryDataManager] 加载历史数据失败:', error);
			return this.historyData;
		}
	}

	/**
	 * 保存历史数据
	 */
	async saveHistory(forceImmediate = false): Promise<void> {
		if (forceImmediate) {
			await this.store.flush();
		} else {
			await this.store.save();
		}
	}

	/**
	 * 强制等待所有待处理的保存操作完成
	 */
	async flush(): Promise<void> {
		await this.store.flush();
	}

	/**
	 * 获取所有历史数据
	 */
	getHistory(): Record<string, DailyStat> {
		return this.historyData;
	}

	/**
	 * 创建仅包含历史统计的可移植 JSON 备份。
	 */
	createHistoryBackup(): string {
		return JSON.stringify(this.historyData, null, 2);
	}

	/**
	 * 从历史统计备份替换当前数据并等待持久化完成。
	 */
	async restoreHistoryBackup(content: string): Promise<number> {
		const parsed: unknown = JSON.parse(content);
		const restored = this.parseHistoryBackup(parsed);
		this.historyData = restored;
		await this.store.save(restored);
		return Object.keys(restored).length;
	}

	/**
	 * 更新指定日期的统计数据
	 */
	updateDailyStat(date: string, stat: DailyStat): void {
		this.historyData[date] = stat;
		this.store.markDirty();
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
			this.store.markDirty();
		}
		return this.historyData[date];
	}

	/**
	 * 增加指定日期的字数统计
	 */
	addWords(date: string, words: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.addedWords += words;
		this.store.markDirty();
	}

	/**
	 * 修正指定日期的写作字数，不改变专注和摸鱼计时数据
	 */
	setDailyWords(date: string, words: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.addedWords = words;
		this.store.markDirty();
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
			this.store.markDirty();
		}
	}

	/**
	 * 增加指定日期的专注时长
	 */
	addFocusTime(date: string, ms: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.focusMs += ms;
		this.store.markDirty();
	}

	/**
	 * 增加指定日期的摸鱼时长
	 */
	addSlackTime(date: string, ms: number): void {
		const stat = this.getOrCreateDailyStat(date);
		stat.slackMs += ms;
		this.store.markDirty();
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
		this.store.markDirty();
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
		this.store.markDirty();
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
		return this.store.isDirty();
	}

	getIsWriting(): boolean {
		return this.store.isWriting;
	}

	private parseHistoryBackup(value: unknown): Record<string, DailyStat> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error('Invalid history backup root');
		}

		const history = value as Record<string, unknown>;
		const entries = Object.entries(history);
		if (!entries.every((entry): entry is [string, DailyStat] => this.isDailyStat(entry[1]))) {
			throw new Error('Invalid history backup entry');
		}

		return Object.fromEntries(entries.map(([date, stat]) => [date, {
			...stat,
			hourlyFocus: stat.hourlyFocus ? [...stat.hourlyFocus] : undefined,
			hourlySlack: stat.hourlySlack ? [...stat.hourlySlack] : undefined
		}]));
	}

	private isDailyStat(value: unknown): value is DailyStat {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		const candidate = value as Record<string, unknown>;
		return this.isFiniteNumber(candidate.focusMs)
			&& this.isFiniteNumber(candidate.slackMs)
			&& this.isFiniteNumber(candidate.addedWords)
			&& (candidate.hourlyFocus === undefined || this.isFiniteNumberArray(candidate.hourlyFocus))
			&& (candidate.hourlySlack === undefined || this.isFiniteNumberArray(candidate.hourlySlack));
	}

	private isFiniteNumber(value: unknown): value is number {
		return typeof value === 'number' && Number.isFinite(value);
	}

	private isFiniteNumberArray(value: unknown): value is number[] {
		return Array.isArray(value)
			&& value.every((item: unknown) => this.isFiniteNumber(item));
	}

	private validateHistory(value: unknown): Record<string, DailyStat> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

		const history = value as Record<string, unknown>;
		const validEntries = Object.entries(history)
			.filter((entry): entry is [string, DailyStat] => this.isDailyStat(entry[1]));
		return Object.fromEntries(validEntries);
	}
}
