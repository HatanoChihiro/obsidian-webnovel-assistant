import { Logger } from '../utils/Logger';
import type { App} from 'obsidian';
import { t } from '../i18n';
import { MarkdownView } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { isMobile, parseGoal } from '../utils';
import { REGEX_PATTERNS } from '../constants';

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
		
		// 非工作区文件：仍显示基本字数，但不追踪增量/历史
		if (view.file && !this.plugin.cacheManager.isEligibleForWordCount(view.file)) {
			this.updateWordCount();
			return;
		}

		this.plugin.lastEditTime = Date.now(); 
        
		// [BUGFIX] 如果当前文件与上次记录的文件不符，说明 active-leaf-change 还没来得及更新 lastFileWords
		// 此时不应计算 delta，而是应该先同步文件状态
		if (!view.file || view.file.path !== this.plugin.lastFilePath) {
			void this.handleFileChange();
			return;
		}

		const currentCount = this.plugin.calculateAccurateWords(view.getViewData());
		const delta = currentCount - this.plugin.lastFileWords;
		
		// 更新历史统计
		// 注意：不检查 lastFileWords > 0，因为这会导致第一个字不被记录
		// 只要 delta !== 0 就记录
		if (delta !== 0) {
			this.plugin.app.workspace.trigger('webnovel:file-word-count-updated', view.file, delta);
		}
		
		this.plugin.lastFileWords = currentCount;
		
		// [BUGFIX] 同步更新文件浏览器缓存
		// 极其重要：这确保了后续 modify 事件（由自动保存触发）计算出的 delta 为 0，防止重复统计。
		if (view.file) {
		this.plugin.cacheManager.updateFileCache(view.file, currentCount, this.app.vault);
	}

		this.updateWordCount();
		this.plugin.refreshStatusViews();
		this.plugin.mobileFloatingStats?.update();
	}

	/**
	 * 处理文件切换
	 * 重置字数统计
	 */
	async handleFileChange(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		// 严格模式：必须符合字数统计条件
		if (view?.file && !this.plugin.cacheManager.isEligibleForWordCount(view.file)) {
			this.plugin.lastFileWords = 0;
			this.updateWordCount();
			return;
		}
		
		let currentWords = 0;
		
		if (view?.file) {
			const existingCache = this.plugin.cacheManager.getFileCache(view.file.path);
			
			if (existingCache !== null) {
				currentWords = existingCache;
			} else {
				// 只有在缓存缺失时才去安全地读取实际文件内容（避免 active-leaf-change 瞬间 view.getViewData 数据陈旧）
				try {
					const content = await this.app.vault.cachedRead(view.file);
					currentWords = this.plugin.calculateAccurateWords(content);
					this.plugin.cacheManager.updateFileCache(view.file, currentWords, this.app.vault);
				} catch (e) {
					Logger.error('[EditorTracker] failed to read file on change', e);
				}
			}
		}

		this.plugin.lastFileWords = currentWords;
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

		// 非工作区/非章节文件：只显示基本字数，不显示追踪和进度
		if (view.file && !this.plugin.cacheManager.isEligibleForWordCount(view.file)) {
			const totalCount = this.plugin.calculateAccurateWords(view.getViewData());
			const cnChars = (view.getViewData().match(REGEX_PATTERNS.CHINESE()) || []).length;
			this.plugin.statusBarItemEl.setText(t('common.word-count-status', { count: String(totalCount), cnCount: String(cnChars) }));
			return;
		}

		// 移动端：如果启用了浮动字数统计窗口，则隐藏状态栏显示（避免重复）
		if (isMobile() && this.plugin.settings.showMobileFloatingStats) {
			this.plugin.statusBarItemEl.setText('');
			return;
		}

		const totalCount = this.plugin.calculateAccurateWords(view.getViewData());
		const displaySessionWords = Math.max(0, this.plugin.sessionAddedWords);
		
		const stateStr = this.plugin.isTracking ? t('status.tracking-active') : t('status.tracking-paused');

		if (this.plugin.settings.showGoal && view.file) {
			const cache = this.app.metadataCache.getFileCache(view.file);
			let targetGoal = this.plugin.settings.defaultGoal;
			const fmGoal = parseGoal(cache?.frontmatter?.['word-goal']);
			if (fmGoal > 0) targetGoal = fmGoal;

			if (targetGoal > 0) {
				const percent = Math.min(Math.round((totalCount / targetGoal) * 100), 100);
				const status = percent >= 100 ? t('status.completed') : '';
				this.plugin.statusBarItemEl.setText(t('common.status-bar-format', { state: stateStr, status: `${status} ${t('common.word-count-progress', { current: String(totalCount), target: String(targetGoal), percent: String(percent) })} | ${t('common.net-increase', { count: String(displaySessionWords) })}` }));
				return;
			}
		}

		const cnChars = (view.getViewData().match(REGEX_PATTERNS.CHINESE()) || []).length;
		this.plugin.statusBarItemEl.setText(t('common.status-bar-format', { state: stateStr, status: `${t('common.word-count-status', { count: String(totalCount), cnCount: String(cnChars) })} | ${t('common.net-increase', { count: String(displaySessionWords) })}` }));
	}
}
