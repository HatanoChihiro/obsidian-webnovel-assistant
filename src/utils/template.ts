import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { AccurateCountSettings } from '../types/settings';
import { TemplateChoiceModal } from '../ui/TemplateChoiceModal';
import { Logger } from './Logger';

export type ChapterTemplateSettings = Pick<
	AccurateCountSettings,
	'enableChapterTemplate' | 'chapterTemplatePaths' | 'chapterTemplatePath'
>;

/**
 * 获取设置中所有有效（在 Vault 中真实存在）的章节模板文件列表
 */
export function getValidTemplateFiles(app: App, settings: ChapterTemplateSettings): TFile[] {
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
 * 弹出模板选择框供用户异步选择模板
 * - 返回 TFile: 用户选择了该模板文件
 * - 返回 null: 用户明确选择了“不使用模板”
 * - 返回 undefined: 用户关闭/取消了弹窗
 */
export function chooseTemplateFile(app: App, files: TFile[]): Promise<TFile | null | undefined> {
	return new Promise((resolve) => {
		new TemplateChoiceModal(
			app,
			files,
			(chosen) => resolve(chosen),
			() => resolve(undefined)
		).open();
	});
}

/**
 * 确定用于新章节或拆分章节的模板内容：
 * - 若 0 个有效模板：返回 '' (不使用模板，直接创建空白/保持后缀)
 * - 若 1 个有效模板：读取该模板并返回内容；读取失败则向外抛出异常
 * - 若 >1 个有效模板：弹窗供用户选择；取消弹窗返回 null；选择不使用模板返回 ''；读取所选模板失败向外抛出异常
 */
export async function resolveChapterTemplateContent(
	app: App,
	settings: ChapterTemplateSettings
): Promise<string | null> {
	const validFiles = getValidTemplateFiles(app, settings);
	if (validFiles.length === 0) {
		return '';
	}

	let targetFile: TFile | null = validFiles[0];
	if (validFiles.length > 1) {
		const chosen = await chooseTemplateFile(app, validFiles);
		if (chosen === undefined) {
			return null;
		}
		targetFile = chosen;
	}

	if (!targetFile) {
		return '';
	}

	return await app.vault.read(targetFile);
}

/**
 * 回调形式的模板解析包装，供旧有代码/命令调用
 * 保持向前兼容：在读取异常时静默降级为 ''（创建空白文档）
 */
export function resolveChapterTemplate(
	app: App,
	settings: ChapterTemplateSettings,
	callback: (templateContent: string | null) => void
): void {
	resolveChapterTemplateContent(app, settings)
		.then((content) => callback(content))
		.catch((err) => {
			Logger.error('Failed to read chapter template:', err);
			callback('');
		});
}
