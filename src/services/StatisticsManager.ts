import type { TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
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
			this.plugin.app.workspace.on('webnovel:file-word-count-updated', (file: TFile, delta: number) => {
				this.handleWordCountUpdated(file, delta);
			})
		);
	}

	private handleWordCountUpdated(file: TFile, delta: number): void {
		if (delta === 0) return;

		// 只有在布局准备好后才记录统计，避免在启动时读取缓存导致异常的“净增”
		if (!this.plugin.isLayoutReady) return;

		try {
			// 1. 无脑更新今日总字数历史记录
			// @ts-expect-error window.moment is provided by Obsidian
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
