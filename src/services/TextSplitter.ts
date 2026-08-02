import type { App } from 'obsidian';
import { ChapterSorter } from './ChapterSorter';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { getDefaultFileName } from '../i18n/data-keys';

export interface ParsedChapter {
	title: string;
	content: string[];
	wordCount: number;
}

/**
 * 文本切分引擎
 * 负责解析外部 TXT/MD 作品文件，并调用 Obsidian API 批量生成文档
 */
export class TextSplitter {
	/**
	 * 智能切分文本为章节数组
	 * @param text 待切分的完整文本
	 * @param maxTitleLength 识别为章节标题的最大行字数，默认 20 字符
	 */
	static splitIntoChapters(text: string, maxTitleLength: number = 20): ParsedChapter[] {
		// 兼容 Windows (\r\n)、Unix (\n) 和老式 Mac (\r) 的换行符
		const lines = text.split(/\r\n|\r|\n/);
		const chapters: ParsedChapter[] = [];
		
		let currentChapter: ParsedChapter = {
			title: t('import-novel.prologue'), // 默认前言
			content: [],
			wordCount: 0
		};

		for (const line of lines) {
			// 去除两端空白，并清理可能存在的 BOM 和零宽字符
			const trimmedLine = line.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
			// 只有行字数在限定范围内（默认 20 字符以内）的短行才可能被识别为章节标题
			if (trimmedLine.length > 0 && trimmedLine.length <= maxTitleLength) {
				// 清理 Markdown 标题前缀（如 #、##）、外围括号（如 【】、（）、[]）用于校验
				const cleanForMatch = trimmedLine
					.replace(/^#{1,6}\s+/, '')
					.replace(/^[【〔（([{}]+|[】〕）\]}]+$/g, '')
					.trim();

				// 调用复用的规则引擎进行匹配
				const chapterExtraction = ChapterSorter.extractChapterNumber(cleanForMatch)
					|| ChapterSorter.extractChapterNumber(trimmedLine);
				
				// 如果成功识别出了有效的章节编号（过滤掉无编号的通用具名排序规则 number === -1）
				if (chapterExtraction !== null && chapterExtraction.number !== -1) {
					// 过滤：如果当前这一行全是等号、短横线或井号（常见于分割线误判），则跳过
					if (/^[-=]+$/.test(trimmedLine) || /^#+$/.test(trimmedLine)) {
						currentChapter.content.push(line);
						currentChapter.wordCount += trimmedLine.length;
						continue;
					}

					// 如果之前的章节有内容，则存入列表；如果是第一章（前言没内容），则丢弃空前言
					if (currentChapter.content.length > 0 || currentChapter.title !== t('import-novel.prologue')) {
						chapters.push(currentChapter);
					}
					
					// 开启新的一章（保留清理了 Markdown # 号后的标题文本）
					const titleToUse = trimmedLine.replace(/^#{1,6}\s+/, '').trim() || trimmedLine;
					currentChapter = {
						title: titleToUse,
						content: [],
						wordCount: 0
					};
					continue;
				}
			}
			
			// 正常内容行
			currentChapter.content.push(line);
			currentChapter.wordCount += trimmedLine.length;
		}

		// 收尾最后一章
		if (currentChapter.content.length > 0 || currentChapter.title !== t('import-novel.prologue')) {
			chapters.push(currentChapter);
		}

		// 特殊情况：如果全篇都没识别到章节，则所有内容归为一个名为【未识别内容】的章节
		if (chapters.length === 0 && currentChapter.content.length > 0) {
			currentChapter.title = t('import-novel.no-chapters-found');
			chapters.push(currentChapter);
		}

		return chapters;
	}

	/**
	 * 非法文件名字符清理
	 */
	static sanitizeFilename(name: string): string {
		return name.replace(/[\\/:*?"<>|]/g, ' ').trim();
	}

	/**
	 * 异步执行导入：在工作区创建小说文件夹并逐个写入章节
	 */
	static async executeImport(
		app: App, 
		plugin: WebNovelAssistantPlugin,
		novelName: string, 
		chapters: ParsedChapter[], 
		onProgress: (current: number, total: number) => void
	): Promise<number> {
		const workspaceFolders = plugin.settings.workspaceFolders || [];
		const baseFolder = workspaceFolders.length > 0 ? workspaceFolders[0].replace(/^\/+|\/+$/g, '') : '';
		
		const safeNovelName = this.sanitizeFilename(novelName) || t('import-novel.untitled-novel');
		const targetFolderPath = baseFolder ? `${baseFolder}/${safeNovelName}` : safeNovelName;

		// 1. 创建小说文件夹
		let folder = app.vault.getAbstractFileByPath(targetFolderPath);
		if (!folder) {
			try {
				folder = await app.vault.createFolder(targetFolderPath);
			} catch (e) {
				window.console.error("[TextSplitter] Failed to create folder", e);
				throw e;
			}
		}

		// 2. 创建作品信息文件 (基建兜底)
		const novelInfoName = plugin.settings.novelInfo?.fileName || getDefaultFileName('novelInfoFileName');
		const novelInfoPath = `${targetFolderPath}/${novelInfoName}.md`;
		if (!app.vault.getAbstractFileByPath(novelInfoPath)) {
			const infoContent = `---\ntype: novel-info\ntitle: ${safeNovelName}\n---\n\n# ${safeNovelName}\n\n`;
			await app.vault.create(novelInfoPath, infoContent);
		}

		// 3. 异步循环写入章节
		let current = 0;
		const total = chapters.length;

		for (const chapter of chapters) {
			let safeTitle = this.sanitizeFilename(chapter.title);
			if (!safeTitle) safeTitle = t('import-novel.untitled-chapter', { index: String(current + 1) });
			
			let chapterPath = `${targetFolderPath}/${safeTitle}.md`;
			
			// 防冲突查重
			let counter = 1;
			while (app.vault.getAbstractFileByPath(chapterPath)) {
				chapterPath = `${targetFolderPath}/${safeTitle} (${counter}).md`;
				counter++;
			}

			// 将内容数组转为完整字符串
			const content = chapter.content.join('\n');
			await app.vault.create(chapterPath, content);
			
			current++;
			onProgress(current, total);

			// 时间分片让权，防止万字长文切割时假死 (Chunking)
			if (current % 10 === 0) {
				await new Promise(resolve => window.setTimeout(resolve, 0));
			}
		}

		return current;
	}
}
