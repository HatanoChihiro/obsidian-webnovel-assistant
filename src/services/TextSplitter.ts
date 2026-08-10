import { normalizePath, type App } from 'obsidian';
import { ChapterSorter, type ChapterNumberExtraction } from './ChapterSorter';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { getDefaultFileName, getNovelInfoLabel, getNovelStatusText } from '../i18n/data-keys';

export interface ParsedChapter {
	title: string;
	content: string[];
	wordCount: number;
	volume?: string;
}

interface ParsedHeading {
	lineIndex: number;
	title: string;
	extraction: ChapterNumberExtraction;
	headingLevel?: number;
	headingMarker?: string;
}

/**
 * 文本切分引擎
 * 负责解析外部 TXT/MD 作品文件，并调用 Obsidian API 批量生成文档
 */
export class TextSplitter {
	/**
	 * 提取规则实际匹配到的结构标记，例如“卷”“章”“Volume”“Chapter”。
	 * 仅使用规则匹配结果，不依赖固定语言或固定标题文本。
	 */
	private static extractHeadingMarker(text: string, extraction: ChapterNumberExtraction): string | undefined {
		if (!extraction.rulePattern || !extraction.numStr) return undefined;

		try {
			const match = new RegExp(extraction.rulePattern, 'i').exec(text)?.[0];
			if (!match) return undefined;
			const numberIndex = match.indexOf(extraction.numStr);
			if (numberIndex === -1) return undefined;

			const prefix = match.slice(0, numberIndex).replace(/^第+/, '').trim();
			if (prefix.length > 0) return prefix.toLocaleLowerCase();

			const suffix = match.slice(numberIndex + extraction.numStr.length);
			if (suffix.length > 0 && !/^[\s\-–—:：]/.test(suffix)) {
				return suffix.trim().toLocaleLowerCase();
			}
		} catch {
			return undefined;
		}

		return undefined;
	}

	/**
	 * 解析单行章节标题，具体的标题格式完全由当前章节命名规则决定。
	 */
	private static parseHeading(line: string, lineIndex: number, maxTitleLength: number): ParsedHeading | null {
		const trimmedLine = line.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
		const markdownHeadingMatch = trimmedLine.match(/^(#{1,6})\s+/);
		const isMarkdownHeading = markdownHeadingMatch !== null;
		if (trimmedLine.length === 0 || (trimmedLine.length > maxTitleLength && !isMarkdownHeading)) return null;
		if (/^[-=]+$/.test(trimmedLine) || /^#+$/.test(trimmedLine)) return null;

		const cleanForMatch = trimmedLine
			.replace(/^#{1,6}\s+/, '')
			.replace(/^[【〔（([{}]+|[】〕）\]}]+$/g, '')
			.trim();
		const extraction = ChapterSorter.extractChapterNumber(cleanForMatch)
			|| ChapterSorter.extractChapterNumber(trimmedLine);
		if (!extraction || extraction.number === -1) return null;

		return {
			lineIndex,
			title: trimmedLine.replace(/^#{1,6}\s+/, '').trim() || trimmedLine,
			extraction,
			headingLevel: markdownHeadingMatch?.[1].length,
			headingMarker: this.extractHeadingMarker(cleanForMatch, extraction)
		};
	}

	/**
	 * 从相邻的章节标题中推断“卷 → 章”关系。
	 * 优先使用 Markdown 层级和规则实际匹配到的结构标记，最后再使用规则索引作为纯文本兜底。
	 */
	private static findVolumeHeadingIndexes(headings: ParsedHeading[]): Set<number> {
		const markdownVolumeHeadingIndexes = new Set<number>();
		for (let index = 0; index < headings.length - 1; index++) {
			const current = headings[index];
			const next = headings[index + 1];
			const hasDistinctMarkers = current.headingMarker !== undefined &&
				next.headingMarker !== undefined &&
				current.headingMarker !== next.headingMarker;
			const hasUnmarkedHeading = current.headingMarker === undefined || next.headingMarker === undefined;
			if (
				current.headingLevel !== undefined &&
				next.headingLevel !== undefined &&
				current.headingLevel < next.headingLevel &&
				(hasDistinctMarkers || hasUnmarkedHeading)
			) {
				markdownVolumeHeadingIndexes.add(current.lineIndex);
			}
		}
		if (markdownVolumeHeadingIndexes.size > 0) return markdownVolumeHeadingIndexes;

		interface MarkerPair {
			firstHeadingIndex: number;
			headingIndexes: number[];
			stableOccurrences: number;
		}

		const markerPairs = new Map<string, MarkerPair>();
		for (let index = 0; index < headings.length - 1; index++) {
			const current = headings[index];
			const next = headings[index + 1];
			if (!current.headingMarker || !next.headingMarker || current.headingMarker === next.headingMarker) continue;

			const key = `${current.headingMarker}->${next.headingMarker}`;
			const pair = markerPairs.get(key) || {
				firstHeadingIndex: index,
				headingIndexes: [],
				stableOccurrences: 0
			};
			pair.headingIndexes.push(index);
			if (headings[index + 2]?.headingMarker === next.headingMarker) {
				pair.stableOccurrences++;
			}
			markerPairs.set(key, pair);
		}

		const markerPair = [...markerPairs.values()].sort((a, b) => {
			if (b.headingIndexes.length !== a.headingIndexes.length) {
				return b.headingIndexes.length - a.headingIndexes.length;
			}
			if (b.stableOccurrences !== a.stableOccurrences) {
				return b.stableOccurrences - a.stableOccurrences;
			}
			return a.firstHeadingIndex - b.firstHeadingIndex;
		})[0];
		if (markerPair) return new Set(markerPair.headingIndexes.map(index => headings[index].lineIndex));

		interface RulePair {
			firstHeadingIndex: number;
			headingIndexes: number[];
			stableOccurrences: number;
			chapterRuleFrequency: number;
		}

		const ruleFrequency = new Map<number, number>();
		for (const heading of headings) {
			ruleFrequency.set(
				heading.extraction.ruleIndex,
				(ruleFrequency.get(heading.extraction.ruleIndex) || 0) + 1
			);
		}

		const pairs = new Map<string, RulePair>();
		for (let index = 0; index < headings.length - 1; index++) {
			const current = headings[index];
			const next = headings[index + 1];
			if (current.extraction.ruleIndex === next.extraction.ruleIndex) continue;

			const fromRule = current.extraction.ruleIndex;
			const toRule = next.extraction.ruleIndex;
			const key = `${fromRule}->${toRule}`;
			const pair = pairs.get(key) || {
				firstHeadingIndex: index,
				headingIndexes: [],
				stableOccurrences: 0,
				chapterRuleFrequency: ruleFrequency.get(toRule) || 0
			};
			pair.headingIndexes.push(index);
			if (headings[index + 2]?.extraction.ruleIndex === toRule) {
				pair.stableOccurrences++;
			}
			pairs.set(key, pair);
		}

		const volumePair = [...pairs.values()].sort((a, b) => {
			if (b.headingIndexes.length !== a.headingIndexes.length) {
				return b.headingIndexes.length - a.headingIndexes.length;
			}
			if (b.chapterRuleFrequency !== a.chapterRuleFrequency) {
				return b.chapterRuleFrequency - a.chapterRuleFrequency;
			}
			if (b.stableOccurrences !== a.stableOccurrences) {
				return b.stableOccurrences - a.stableOccurrences;
			}
			return a.firstHeadingIndex - b.firstHeadingIndex;
		})[0];

		if (!volumePair) return new Set<number>();
		return new Set(volumePair.headingIndexes.map(index => headings[index].lineIndex));
	}

	/**
	 * 智能切分文本为章节数组
	 * @param text 待切分的完整文本
	 * @param maxTitleLength 识别为章节标题的最大行字数，默认 20 字符
	 */
	static splitIntoChapters(text: string, maxTitleLength: number = 20): ParsedChapter[] {
		// 兼容 Windows (\r\n)、Unix (\n) 和老式 Mac (\r) 的换行符
		const lines = text.split(/\r\n|\r|\n/);
		const chapters: ParsedChapter[] = [];
		const headings = lines
			.map((line, lineIndex) => this.parseHeading(line, lineIndex, maxTitleLength))
			.filter((heading): heading is ParsedHeading => heading !== null);
		const headingsByLine = new Map(headings.map(heading => [heading.lineIndex, heading]));
		const volumeHeadingIndexes = this.findVolumeHeadingIndexes(headings);
		
		let currentChapter: ParsedChapter = {
			title: t('import-novel.prologue'), // 默认前言
			content: [],
			wordCount: 0
		};
		let currentVolume: string | undefined;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];
			// 去除两端空白，并清理可能存在的 BOM 和零宽字符
			const trimmedLine = line.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
			const heading = headingsByLine.get(lineIndex);
			if (heading) {
				if (volumeHeadingIndexes.has(lineIndex)) {
					if (currentChapter.wordCount > 0 || currentChapter.title !== t('import-novel.prologue')) {
						chapters.push(currentChapter);
					}
					currentVolume = heading.title;
					currentChapter = {
						title: t('import-novel.prologue'),
						content: [],
						wordCount: 0,
						volume: currentVolume
					};
				} else {
					if (currentChapter.wordCount > 0 || currentChapter.title !== t('import-novel.prologue')) {
						chapters.push(currentChapter);
					}
					currentChapter = {
						title: heading.title,
						content: [],
						wordCount: 0,
						volume: currentVolume
					};
				}
				continue;
			}
			
			// 正常内容行
			currentChapter.content.push(line);
			currentChapter.wordCount += trimmedLine.length;
		}

		// 收尾最后一章
		if (currentChapter.wordCount > 0 || currentChapter.title !== t('import-novel.prologue')) {
			chapters.push(currentChapter);
		}

		// 特殊情况：如果全篇都没识别到章节，则所有内容归为一个名为【未识别内容】的章节
		if (chapters.length === 0 && currentChapter.wordCount > 0) {
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

		// 2. 创建作品信息文件 (与创作主页作品信息格式保持一致)
		if (plugin?.homepageManager) {
			await plugin.homepageManager.createNovelInfoFile(targetFolderPath, { name: safeNovelName });
		} else {
			const novelInfoName = plugin?.settings?.novelInfo?.fileName || getDefaultFileName('novelInfoFileName');
			const novelInfoPath = normalizePath(`${targetFolderPath}/${novelInfoName}.md`);
			if (!app.vault.getAbstractFileByPath(novelInfoPath)) {
				const today = new Date().toISOString().slice(0, 10);
				const lines = [
					`**${getNovelInfoLabel('status')}**：${getNovelStatusText('ongoing')}`,
					`**${getNovelInfoLabel('synopsis')}**：`,
					`**${getNovelInfoLabel('protagonist')}**：`,
					`**${getNovelInfoLabel('genre')}**：`,
					`**${getNovelInfoLabel('wordGoal')}**：`,
					`**${getNovelInfoLabel('startDate')}**：${today}`,
					`**${getNovelInfoLabel('endDate')}**：`,
					'',
				];
				await app.vault.create(novelInfoPath, lines.join('\n'));
			}
		}

		// 3. 异步循环写入章节
		let current = 0;
		const total = chapters.length;
		const volumeFolderPaths = new Map<string, string>();
		const usedVolumeFolderPaths = new Set<string>();

		for (const chapter of chapters) {
			let chapterFolderPath = targetFolderPath;
			if (chapter.volume) {
				let volumeFolderPath = volumeFolderPaths.get(chapter.volume);
				if (!volumeFolderPath) {
					const safeVolumeName = this.sanitizeFilename(chapter.volume) || t('import-novel.untitled-volume');
					volumeFolderPath = `${targetFolderPath}/${safeVolumeName}`;
					let counter = 1;
					while (usedVolumeFolderPaths.has(volumeFolderPath)) {
						volumeFolderPath = `${targetFolderPath}/${safeVolumeName} (${counter})`;
						counter++;
					}
					if (!app.vault.getAbstractFileByPath(volumeFolderPath)) {
						await app.vault.createFolder(volumeFolderPath);
					}
					volumeFolderPaths.set(chapter.volume, volumeFolderPath);
					usedVolumeFolderPaths.add(volumeFolderPath);
				}
				chapterFolderPath = volumeFolderPath;
			}

			let safeTitle = this.sanitizeFilename(chapter.title);
			if (!safeTitle) safeTitle = t('import-novel.untitled-chapter', { index: String(current + 1) });
			
			let chapterPath = `${chapterFolderPath}/${safeTitle}.md`;
			
			// 防冲突查重
			let counter = 1;
			while (app.vault.getAbstractFileByPath(chapterPath)) {
				chapterPath = `${chapterFolderPath}/${safeTitle} (${counter}).md`;
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
