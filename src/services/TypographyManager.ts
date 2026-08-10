import type { App, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from './ChapterSorter';
import { getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';

/**
 * 排版管理服务
 * 负责根据作用域判定与配置，在 Markdown 视图上精准注入/移除 CSS 样式类及变量
 */
export class TypographyManager {
	constructor(
		private app: App,
		private plugin: WebNovelAssistantPlugin
	) {}

	/**
	 * 刷新所有打开的 Markdown 视图的排版样式
	 */
	updateTypography(): void {
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			this.applyToLeaf(leaf);
		}
	}

	/**
	 * 作用于单一 WorkspaceLeaf
	 */
	applyToLeaf(leaf: WorkspaceLeaf): void {
		const containerEl = leaf.containerEl;
		if (!containerEl) return;

		if (!(leaf.view instanceof MarkdownView)) {
			this.removeTypographyFromEl(containerEl);
			return;
		}

		const file = leaf.view.file;
		if (!file) {
			this.removeTypographyFromEl(containerEl);
			return;
		}

		if (this.shouldApplyTypography(file)) {
			this.applyTypographyToEl(containerEl);
		} else {
			this.removeTypographyFromEl(containerEl);
		}

		// 强制触发阅读模式 (MarkdownPreviewView) 重渲染，使阅读模式兼容 (enableReadingModeCompat) 和排版设置即时生效，无需重载 Obsidian
		if (leaf.view instanceof MarkdownView && leaf.view.previewMode) {
			const previewMode = leaf.view.previewMode as { rerender?: (full?: boolean) => void };
			if (typeof previewMode.rerender === 'function') {
				previewMode.rerender(true);
			}
		}
	}

	/**
	 * 判定文件是否应当触发排版控制
	 */
	shouldApplyTypography(file: TFile): boolean {
		const settings = this.plugin.settings;
		const typo = settings.typography;

		// 1. 总开关关闭，则全局不触发
		if (!typo || !typo.enabled) {
			return false;
		}

		// 2. 工作区校验：非工作区文档，绝对不应用排版控制
		if (this.plugin.cacheManager && !this.plugin.cacheManager.isFileInWorkspace(file)) {
			return false;
		}

		// 3. 创作主页 (homepagePath) 绝对强制排除排版
		const homepagePath = settings.homepagePath || '创作主页.md';
		if (file.path === homepagePath || file.name === '创作主页.md') {
			return false;
		}

		// 3. 判定是否为章节文档
		const isChapter = ChapterSorter.isChapterFile(file.name);
		if (isChapter) {
			return typo.applyToChapters;
		}

		// 4. 判定功能性文档：设定（递归向上冒泡检查父级文件夹）
		if (this.isLoreFile(file)) {
			return typo.applyToLore;
		}

		// 5. 判定功能性文档：作品信息
		const novelInfoCandidates = new Set<string>();
		if (settings.novelInfo?.fileName) novelInfoCandidates.add(`${settings.novelInfo.fileName}.md`);
		novelInfoCandidates.add(`${getDefaultFileName('novelInfoFileName')}.md`);
		for (const name of getDefaultFileNameCandidates('novelInfoFileName')) {
			novelInfoCandidates.add(`${name}.md`);
		}
		if (novelInfoCandidates.has(file.name)) {
			return typo.applyToNovelInfo;
		}

		// 6. 判定功能性文档：时间线
		const timelineCandidates = new Set<string>();
		if (settings.timeline?.fileName) timelineCandidates.add(settings.timeline.fileName);
		timelineCandidates.add(getDefaultFileName('timelineFileName'));
		for (const name of getDefaultFileNameCandidates('timelineFileName')) {
			timelineCandidates.add(name);
		}
		for (const cand of timelineCandidates) {
			if (file.name.includes(cand)) {
				return typo.applyToTimeline;
			}
		}

		// 7. 判定功能性文档：伏笔
		const foreshadowingCandidates = new Set<string>();
		if (settings.foreshadowing?.fileName) foreshadowingCandidates.add(settings.foreshadowing.fileName);
		foreshadowingCandidates.add(getDefaultFileName('foreshadowingFileName'));
		for (const name of getDefaultFileNameCandidates('foreshadowingFileName')) {
			foreshadowingCandidates.add(name);
		}
		for (const cand of foreshadowingCandidates) {
			if (file.name.includes(cand)) {
				return typo.applyToForeshadowing;
			}
		}

		// 8. 判定功能性文档：限时任务
		const taskCandidates = new Set<string>();
		if (settings.task?.fileName) taskCandidates.add(settings.task.fileName);
		taskCandidates.add(getDefaultFileName('taskFileName'));
		for (const name of getDefaultFileNameCandidates('taskFileName')) {
			taskCandidates.add(name);
		}
		for (const cand of taskCandidates) {
			if (file.name.includes(cand)) {
				return typo.applyToTask;
			}
		}

		// 9. 判定其他文档（工作区内非章节和非功能性的文档，比如合并章节、大纲等未被计入章节规则的文件）
		return typo.applyToOther ?? false;
	}

	/**
	 * 检查文件是否位于设定文件夹或其任意子文件夹内部
	 */
	private isLoreFile(file: TFile): boolean {
		const candidates = new Set<string>();
		if (this.plugin.settings.loreFolderName) {
			candidates.add(this.plugin.settings.loreFolderName);
		}
		candidates.add(getDefaultFileName('loreFolderName'));
		for (const name of getDefaultFileNameCandidates('loreFolderName')) {
			candidates.add(name);
		}

		let current: TFolder | null = file.parent;
		while (current && !current.isRoot()) {
			if (candidates.has(current.name)) {
				return true;
			}
			current = current.parent;
		}
		return false;
	}

	/**
	 * 在元素上注入排版 Class 与 CSS 自定义变量
	 */
	private applyTypographyToEl(el: HTMLElement): void {
		const typo = this.plugin.settings.typography;
		if (!typo) return;

		el.addClass('wn-typography-active');

		if (typo.enableReadingModeCompat) {
			el.addClass('wn-type-reading-compat');
		} else {
			el.removeClass('wn-type-reading-compat');
		}

		// 设置 CSS 自定义变量 (遵从 Obsidian 审查指南，用 style.setProperty 设置变量)
		el.style.setProperty('--wn-type-header-align', typo.headerAlignment || 'center');
		el.style.setProperty('--wn-type-indent', typo.enableIndent ? (typo.indentSize || '2em') : '0');
		el.style.setProperty('--wn-type-line-height', String(typo.lineHeight || 1.8));
		el.style.setProperty('--wn-type-para-spacing', typo.paragraphSpacing || '0.5em');
		el.style.setProperty('--wn-type-letter-spacing', typo.letterSpacing || '0.05em');
		el.style.setProperty('--wn-type-text-align', typo.justifyText ? 'justify' : 'left');

		if (typo.maxLineWidth && typo.maxLineWidth.trim() !== '') {
			const maxW = typo.maxLineWidth.trim();
			el.style.setProperty('--wn-type-max-width', maxW);
			el.style.setProperty('--file-line-width', maxW);
			el.style.setProperty('--line-width', maxW);
		} else {
			el.style.removeProperty('--wn-type-max-width');
			el.style.removeProperty('--file-line-width');
			el.style.removeProperty('--line-width');
		}
	}

	/**
	 * 从元素上移除排版 Class 与 CSS 自定义变量
	 */
	private removeTypographyFromEl(el: HTMLElement): void {
		el.removeClass('wn-typography-active');
		el.removeClass('wn-type-reading-compat');

		el.style.removeProperty('--wn-type-header-align');
		el.style.removeProperty('--wn-type-indent');
		el.style.removeProperty('--wn-type-line-height');
		el.style.removeProperty('--wn-type-para-spacing');
		el.style.removeProperty('--wn-type-letter-spacing');
		el.style.removeProperty('--wn-type-text-align');
		el.style.removeProperty('--wn-type-max-width');
		el.style.removeProperty('--file-line-width');
		el.style.removeProperty('--line-width');
	}
}
