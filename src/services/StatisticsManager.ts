import { MarkdownView, TFile, type TAbstractFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { CoreStatsPayload } from '../types/stats';
import type { NovelFolderInfo } from '../types/homepage';
import type { DailyStat } from '../types/settings';
import { formatTime, parseGoal } from '../utils';
import { Logger } from '../utils/Logger';
import { t } from '../i18n';

/**
 * 统计数据管理器 (StatisticsManager)
 * 
 * 职责：
 * 1. 订阅全局字数变更事件（`webnovel:file-word-count-updated`）。
 * 2. 独立处理「每日总字数大盘」和「本场净增字数」的计算。
 * 3. 隔离底层的文件变动（FileEventManager/EditorTracker）与顶层的数据状态，避免回归缺陷。
 */
export class StatisticsManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	setup(): void {
		// 监听全局的字数变更事件
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('webnovel:file-word-count-updated', (file: TAbstractFile, delta: number) => {
				this.handleWordCountUpdated(file, delta);
			})
		);
	}

	/**
	 * 获取核心统计数据包 (CoreStatsPayload)
	 * 统一对外（OBS、沉浸模式等 UI）暴露格式化后的数据
	 */
	getCoreStats(): CoreStatsPayload {
		const focusSec = Math.round(this.plugin.focusMs / 1000);
		const slackSec = Math.round(this.plugin.slackMs / 1000);
		const totalSec = focusSec + slackSec;
		const today = window.moment().format('YYYY-MM-DD');
		const todayStat = this.plugin.historyManager.getDailyStat(today) || { focusMs: 0, slackMs: 0, addedWords: 0 };

		let targetGoal = 0;
		let currentFile = '';
		let currentFolder = '';
		let chapterWords = 0;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		let file = view?.file ?? null;
		if (!file && this.plugin.lastFilePath) {
			const lastFile = this.plugin.app.vault.getAbstractFileByPath(this.plugin.lastFilePath);
			if (lastFile instanceof TFile) file = lastFile;
		}

		if (file && this.plugin.cacheManager.isEligibleForWordCount(file)) {
			currentFile = file.basename;
			currentFolder = file.parent?.isRoot() ? '' : (file.parent?.name || '');
			let fileGoal = this.plugin.settings.defaultGoal;
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const fmGoal = parseGoal(cache?.frontmatter?.['word-goal']);
			if (fmGoal > 0) fileGoal = fmGoal;
			targetGoal = fileGoal;
			// 当前活动的 Markdown 编辑视图优先使用实时内容；侧面板获得焦点后复用最后一次追踪结果。
			const viewData = view?.file?.path === file.path ? view.getViewData() : null;
			if (typeof viewData === 'string') {
				chapterWords = this.plugin.calculateAccurateWords(viewData);
			} else {
				const cachedWords = this.plugin.cacheManager.getFileCache(file.path);
				chapterWords = this.plugin.lastFilePath === file.path
					? this.plugin.lastFileWords
					: (cachedWords !== null ? cachedWords : 0);
			}
		}

		const todayAdded = todayStat.addedWords; // 允许负数，提醒作者删除了字数
		const dailyGoal = this.plugin.settings.dailyGoal || 0;

		return {
			isTracking: this.plugin.isTracking,
			focusTime: formatTime(focusSec),
			slackTime: formatTime(slackSec),
			totalTime: formatTime(totalSec),
			sessionWords: Math.max(0, this.plugin.sessionAddedWords),
			todayWords: chapterWords,
			goal: targetGoal,
			percent: targetGoal > 0 ? Math.max(0, Math.min(Math.round((chapterWords / targetGoal) * 100), 100)) : 0,
			dailyWords: Math.max(0, todayAdded),
			rawDailyWords: todayAdded,
			dailyGoal: dailyGoal,
			dailyPercent: dailyGoal > 0 ? Math.max(0, Math.min(Math.round((todayAdded / dailyGoal) * 100), 100)) : 0,
			currentFile: currentFile,
			currentFolder: currentFolder,
		};
	}

	private handleWordCountUpdated(file: TAbstractFile, delta: number): void {
		if (delta === 0) return;

		// 只有在布局准备好后才记录统计，避免在启动时读取缓存导致异常的“净增”
		if (!this.plugin.isLayoutReady) return;

		try {
			// 1. 无脑更新今日总字数历史记录
			const today = window.moment().format('YYYY-MM-DD');
			this.plugin.historyManager.addWords(today, delta);

			// 2. 只有在专注计时开启时，才累加“本场净增字数”
			if (this.plugin.isTracking) {
				this.plugin.sessionAddedWords += delta;
			}

			// 3. 节流防抖，保存数据到磁盘
			this.plugin.adaptiveDebounceManager.debounceFixed('save-settings', () => {
				this.plugin.saveSettings().catch(err => {
					Logger.error('[StatisticsManager] 保存设置失败:', err);
				});
				this.plugin.historyManager.saveHistory().catch(err => {
					Logger.error('[StatisticsManager] 保存历史数据失败:', err);
				});
			}, 1000);
			
		} catch (error) {
			Logger.error('[StatisticsManager] 更新统计失败:', error);
		}
	}

	/**
	 * 计算连续写作天数 (Streak)
	 */
	calcStreak(history: Record<string, DailyStat>): number {
		let streak = 0;
		const today = window.moment().format('YYYY-MM-DD');
		let date = window.moment().subtract(1, 'day').format('YYYY-MM-DD');
		while (true) {
			const stat = history[date];
			if (stat && stat.addedWords !== 0) {
				streak++;
				date = window.moment(date).subtract(1, 'day').format('YYYY-MM-DD');
			} else break;
		}
		const todayStat = history[today];
		if (todayStat && todayStat.addedWords !== 0) streak++;
		return streak;
	}

	/**
	 * 计算专注率
	 */
	calcFocusRate(history: Record<string, DailyStat>, startDate: string, endDate: string): number {
		let totalFocus = 0, totalSlack = 0;
		for (const [date, stat] of Object.entries(history)) {
			if (date >= startDate && date <= endDate) {
				totalFocus += stat.focusMs || 0;
				totalSlack += stat.slackMs || 0;
			}
		}
		return totalFocus + totalSlack > 0 ? Math.round((totalFocus / (totalFocus + totalSlack)) * 100) : 0;
	}

	/**
	 * 计算最活跃时段
	 */
	calcActiveHours(history: Record<string, DailyStat>, startDate: string, endDate: string): string {
		const hourlyTotals = new Array<number>(24).fill(0);
		for (const [date, stat] of Object.entries(history)) {
			if (date >= startDate && date <= endDate && stat.hourlyFocus) {
				for (let h = 0; h < 24; h++) {
					hourlyTotals[h] += stat.hourlyFocus[h] || 0;
				}
			}
		}
		const ranked = hourlyTotals.map((v, i) => ({ hour: i, total: v }))
			.filter(x => x.total > 0)
			.sort((a, b) => b.total - a.total);

		if (ranked.length === 0) return '';

		let lo = ranked[0].hour;
		let hi = ranked[0].hour;
		for (let i = 1; i < ranked.length; i++) {
			if (ranked[i].hour === lo - 1) lo = ranked[i].hour;
			else if (ranked[i].hour === hi + 1) hi = ranked[i].hour;
			else break;
		}
		return t('common.active-hours-range', { start: lo, end: hi + 1 });
	}

	/**
	 * 计算日均字数
	 */
	calcDailyAverage(history: Record<string, DailyStat>, startDate: string, endDate: string): number {
		let totalWords = 0, daysWithData = 0;
		for (const [date, stat] of Object.entries(history)) {
			if (date >= startDate && date <= endDate) {
				totalWords += stat.addedWords || 0;
				daysWithData++;
			}
		}
		return daysWithData > 0 ? Math.round(totalWords / daysWithData) : 0;
	}

	/**
	 * 计算写作速度 (字/小时)
	 */
	calcWritingSpeed(history: Record<string, DailyStat>, startDate: string, endDate: string): number {
		let totalWords = 0;
		let totalMs = 0;
		for (const [date, stat] of Object.entries(history)) {
			if (date >= startDate && date <= endDate) {
				totalWords += stat.addedWords || 0;
				totalMs += (stat.focusMs || 0) + (stat.slackMs || 0);
			}
		}
		const hours = totalMs / (1000 * 60 * 60);
		return hours > 0 ? Math.round(totalWords / hours) : 0;
	}

	/**
	 * 计算任务完成度
	 */
	async calcTaskCompletion(novelFolders: NovelFolderInfo[]): Promise<{ completed: number; total: number }> {
		let completed = 0;
		let total = 0;
		const folderPaths = new Set(novelFolders.map(n => n.folderPath));
		folderPaths.add('');

		for (const folderPath of folderPaths) {
			this.plugin.taskManager.currentFolder = folderPath;
			const entries = await this.plugin.taskManager.loadEntries();
			if (entries) {
				total += entries.length;
				completed += entries.filter(e => e.status === 'completed').length;
			}
		}
		return { completed, total };
	}

	/**
	 * 计算完本率
	 */
	calcNovelCompletionRate(novelFolders: NovelFolderInfo[]): number {
		if (novelFolders.length === 0) return 0;
		const completed = novelFolders.filter(n => n.metadata?.status === 'completed').length;
		return Math.round((completed / novelFolders.length) * 100);
	}

	/**
	 * 历史数据聚合（按日、周、月、年归并）
	 */
	aggregateHistoryData(history: Record<string, DailyStat>, currentTab: string): Record<string, { words: number; focusMs: number; slackMs: number }> {
		const result: Record<string, { words: number; focusMs: number; slackMs: number }> = {};

		for (const [date, stat] of Object.entries(history)) {
			const m = window.moment(date);
			let key = date;

			if (currentTab === 'day') {
				key = date;
			} else if (currentTab === 'week') {
				key = `${m.isoWeekYear()}-W${String(m.isoWeek()).padStart(2, '0')}`;
			} else if (currentTab === 'month') {
				key = m.format('YYYY-MM');
			} else if (currentTab === 'year') {
				key = m.format('YYYY');
			}

			if (!result[key]) result[key] = { words: 0, focusMs: 0, slackMs: 0 };
			result[key].words += (stat.addedWords || 0);
			result[key].focusMs += (stat.focusMs || 0);
			result[key].slackMs += (stat.slackMs || 0);
		}

		const now = window.moment();
		if (currentTab === 'day') {
			const start = now.clone().subtract(29, 'days');
			const d = start.clone();
			while (d.isSameOrBefore(now, 'day')) {
				const key = d.format('YYYY-MM-DD');
				if (!result[key]) result[key] = { words: 0, focusMs: 0, slackMs: 0 };
				d.add(1, 'day');
			}
		}

		return result;
	}
}
