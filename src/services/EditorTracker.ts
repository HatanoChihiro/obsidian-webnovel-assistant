import { App, MarkdownView } from 'obsidian';
import { WebNovelAssistantPlugin } from '../types/plugin';
import { isMobile } from '../utils';

/**
 * 编辑器追踪服务
 * 负责监听编辑器变化、更新字数统计、管理状态栏显示
 */
export class EditorTracker {
	constructor(
		private app: App,
		private plugin: WebNovelAssistantPlugin
	) {}

	/**
	 * 处理编辑器内容变化
	 * 更新字数统计和每日历史
	 */
	handleEditorChange(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		
		// 只统计工作区内的文件
		if (view.file && !this.plugin.isFileInWorkspace(view.file)) return;
		
		// 排除合并章节文件（文件名包含 "_合并章节"）
		if (view.file && view.file.basename.includes('_合并章节')) return;
        
		this.plugin.lastEditTime = Date.now(); 
        
		// [BUGFIX] 如果当前文件与上次记录的文件不符，说明 active-leaf-change 还没来得及更新 lastFileWords
		// 此时不应计算 delta，而是应该先同步文件状态
		if (view.file.path !== this.plugin.lastFilePath) {
			this.handleFileChange();
			return;
		}

		const currentCount = this.plugin.calculateAccurateWords(view.getViewData());
		const delta = currentCount - this.plugin.lastFileWords;
		
		// 更新历史统计
		// 注意：不检查 lastFileWords > 0，因为这会导致第一个字不被记录
		// 只要 delta !== 0 就记录
		if (delta !== 0) {
			this.plugin.sessionAddedWords += delta;
			
			const today = window.moment().format('YYYY-MM-DD');
			this.plugin.historyManager.addWords(today, delta);
			
			// 防抖保存历史数据（1秒后保存，避免频繁写入）
			this.plugin.adaptiveDebounceManager.debounceFixed('save-history', () => {
				this.plugin.historyManager.saveHistory().catch(err => {
					console.error('[Plugin] 保存历史数据失败:', err);
				});
			}, 1000);
		}
		
		this.plugin.lastFileWords = currentCount;

		this.updateWordCount();
		this.plugin.refreshStatusViews();
	}

	/**
	 * 处理文件切换
	 * 重置字数统计
	 */
	handleFileChange(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		// 只统计工作区内的文件
		if (view?.file && !this.plugin.isFileInWorkspace(view.file)) {
			this.plugin.lastFileWords = 0;
			this.plugin.statusBarItemEl.setText('');
			return;
		}
		
		this.plugin.lastFileWords = view ? this.plugin.calculateAccurateWords(view.getViewData()) : 0;
		this.plugin.lastFilePath = view?.file?.path || '';
		this.updateWordCount();
		this.plugin.refreshStatusViews();
	}

	/**
	 * 更新状态栏字数显示
	 */
	updateWordCount(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { 
			this.plugin.statusBarItemEl.setText(''); 
			return; 
		}

		// 只显示工作区内文件的字数统计
		if (view.file && !this.plugin.isFileInWorkspace(view.file)) {
			this.plugin.statusBarItemEl.setText('');
			return;
		}

		// 移动端：如果启用了浮动字数统计窗口，则隐藏状态栏显示（避免重复）
		if (isMobile() && this.plugin.settings.showMobileFloatingStats) {
			this.plugin.statusBarItemEl.setText('');
			return;
		}

		const totalCount = this.plugin.calculateAccurateWords(view.getViewData());
		const displaySessionWords = Math.max(0, this.plugin.sessionAddedWords);
		
		const stateStr = this.plugin.isTracking ? "[记录中]" : "[已暂停]";

		if (this.plugin.settings.showGoal && view.file) {
			const cache = this.app.metadataCache.getFileCache(view.file);
			let targetGoal = this.plugin.settings.defaultGoal;
			if (cache?.frontmatter && cache.frontmatter['word-goal']) {
				const fmGoal = parseInt(cache.frontmatter['word-goal']);
				if (!isNaN(fmGoal)) targetGoal = fmGoal;
			}

			if (targetGoal > 0) {
				const percent = Math.min(Math.round((totalCount / targetGoal) * 100), 100);
				const status = percent >= 100 ? '[完成]' : '';
				this.plugin.statusBarItemEl.setText(`[${stateStr}] ${status} 字数: ${totalCount} / ${targetGoal} (${percent}%) | 净增: ${displaySessionWords}`);
				return;
			}
		}

		const cnChars = (view.getViewData().match(/[\u4e00-\u9fa5]/g) || []).length;
		this.plugin.statusBarItemEl.setText(`[${stateStr}] 字数: ${totalCount} (中文字: ${cnChars}) | 净增: ${displaySessionWords}`);
	}
}
