import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { WebNovelAssistantSettings } from '../types/settings';
import { TemplateChoiceModal } from '../ui/TemplateChoiceModal';
import { Logger } from './Logger';

/**
 * 获取设置中所有有效（在 Vault 中真实存在）的章节模板文件列表
 */
export function getValidTemplateFiles(app: App, settings: WebNovelAssistantSettings): TFile[] {
	if (!settings.enableChapterTemplate) {
		return [];
	}

	let rawPaths: string[] = [];
	if (Array.isArray(settings.chapterTemplatePaths) && settings.chapterTemplatePaths.length > 0) {
		rawPaths = settings.chapterTemplatePaths;
	} else if (settings.chapterTemplatePath) {
		// 向前兼容单个模板路径
		rawPaths = [settings.chapterTemplatePath];
	}

	const validFiles: TFile[] = [];
	const seenPaths = new Set<string>();

	for (const path of rawPaths) {
		if (!path || seenPaths.has(path)) continue;
		seenPaths.add(path);
		const abstractFile = app.vault.getAbstractFileByPath(path);
		if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
			validFiles.push(abstractFile);
		}
	}

	return validFiles;
}

/**
 * 解析并确定用于创建新章节的模板内容
 * - 若 0 个有效模板：回调 '' (不使用模板，创建空文档，无需弹窗)
 * - 若 1 个有效模板：默认使用该模板内容回调 (无需弹窗)
 * - 若 >1 个有效模板：弹出 Choose Modal 供用户选择模板，选择后读取内容回调；若取消弹窗回调 null
 */
export function resolveChapterTemplate(
	app: App,
	settings: WebNovelAssistantSettings,
	callback: (templateContent: string | null) => void
): void {
	const validFiles = getValidTemplateFiles(app, settings);

	if (validFiles.length === 0) {
		callback('');
		return;
	}

	if (validFiles.length === 1) {
		app.vault.read(validFiles[0])
			.then((content) => callback(content))
			.catch((err) => {
				Logger.error('Failed to read chapter template:', err);
				callback('');
			});
		return;
	}

	// 多模板，弹出选择框
	new TemplateChoiceModal(app, validFiles, (chosenFile) => {
		if (!chosenFile) {
			callback('');
			return;
		}
		app.vault.read(chosenFile)
			.then((content) => callback(content))
			.catch((err) => {
				Logger.error('Failed to read chapter template:', err);
				callback('');
			});
	}).open();
}
