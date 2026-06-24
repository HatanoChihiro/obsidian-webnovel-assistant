import { MarkdownView, type TAbstractFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { CoreStatsPayload } from '../types/stats';
import { formatTime, parseGoal } from '../utils';
import { Logger } from '../utils/Logger';

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

		let targetGoal = this.plugin.settings.defaultGoal;
		let currentFile = '';
		let currentFolder = '';
		let chapterWords = 0;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			currentFile = view.file.basename;
			currentFolder = view.file.parent?.isRoot() ? '' : (view.file.parent?.name || '');
			const cache = this.plugin.app.metadataCache.getFileCache(view.file);
			const fmGoal = parseGoal(cache?.frontmatter?.['word-goal']);
			if (fmGoal > 0) targetGoal = fmGoal;
			// [Cache Interception] 拦截高频全文正则读取，避免每秒触发大量的内存分配与垃圾回收
			const cachedWords = this.plugin.cacheManager.getFileCache(view.file.path);
			if (cachedWords !== null) {
				chapterWords = cachedWords;
			} else {
				chapterWords = this.plugin.calculateAccurateWords(view.getViewData());
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
}
