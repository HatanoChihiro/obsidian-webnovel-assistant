import type { App, Editor } from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import type { ForeshadowingEntry, ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ForeshadowingStatus } from '../types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { escapeRegex } from '../utils/validation';
import { SerializedWriter } from '../utils/SerializedWriter';
import { getForeshadowingStatusText, getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import { findBookRoot } from '../utils/path';
import { ForeshadowingParser } from '../utils/ForeshadowingParser';
import { ChapterSorter } from './ChapterSorter';

/**
 * 伏笔管理服务
 * 负责伏笔文件的读写、格式化、状态更新
 */
export class ForeshadowingManager {
	/** 正则表达式缓存，避免重复编译（最多缓存 100 个） */
	private static readonly entryPatternCache = new Map<string, RegExp>();
	private static readonly MAX_CACHE_SIZE = 100;
	
	/** 串行写入器：确保对伏笔文件的读改写操作是原子的 [M-E4] */
	private writer = new SerializedWriter();

	constructor(
		private app: App,
		private plugin: WebNovelAssistantPlugin
	) {}

	/**
	 * 获取伏笔文件路径（与来源文件同文件夹）
	 * 获取伏笔文件路径（新建时使用当前语言的文件名）
	 */
	getForeshadowingFilePath(sourceFile: TFile): string {
		const folder = findBookRoot(this.app, this.plugin, sourceFile);
		// 如果未找到任何语言的版本，使用用户设置或当前语言的默认文件名新建
		const expectedName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
		return normalizePath(folder ? `${folder}/${expectedName}.md` : `${expectedName}.md`);
	}

	/**
	 * 检查伏笔文件是否存在（支持多语言文件名查找）
	 */
	foreshadowingFileExists(sourceFile: TFile): boolean {
		const folder = findBookRoot(this.app, this.plugin, sourceFile);
		return !!this.findForeshadowingFile(folder);
	}

	/**
	 * 查找伏笔文件（支持多语言文件名 fallback）
	 */
	findForeshadowingFile(folderPath: string): TFile | null {
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName'));
		for (const name of getDefaultFileNameCandidates('foreshadowingFileName')) candidates.add(name);
		for (const fileName of candidates) {
			const path = normalizePath(folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	/**
	 * 创建伏笔文件（空文件，不添加标题）
	 * 如已有任何语言版本则直接返回
	 */
	async createForeshadowingFile(sourceFile: TFile): Promise<TFile> {
		const folder = findBookRoot(this.app, this.plugin, sourceFile);
		// 检查是否已有伏笔文件（多语言查找）
		const existing = this.findForeshadowingFile(folder);
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
			if (existing.name !== expectedName + '.md') {
				const newPath = normalizePath(folder + '/' + expectedName + '.md');
				try { await this.app.fileManager.renameFile(existing, newPath); } catch (e) { console.warn('[ForeshadowingManager] 重命名伏笔文件失败:', e); }
			}
			const found = this.app.vault.getAbstractFileByPath(normalizePath(folder + '/' + expectedName + '.md'));
				return found instanceof TFile ? found : existing;
		}

		const path = this.getForeshadowingFilePath(sourceFile);

		// 确保文件夹存在
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// 创建空文件，不添加标题（避免影响第一条伏笔的解析）
		return await this.app.vault.create(path, '');
	}

	/**
	 * 将伏笔条目格式化为 Markdown 字符串
	 */
	formatEntry(entry: ForeshadowingEntry): string {
		return ForeshadowingParser.formatEntry(entry);
	}

	/**
	 * 将伏笔条目追加到伏笔文件末尾
	 */
	async appendEntry(targetFile: TFile, entry: ForeshadowingEntry): Promise<void> {
		const formatted = this.formatEntry(entry);
		await this.app.vault.process(targetFile, (existing) => {
			// 确保文件末尾有换行再追加
			const separator = existing.endsWith('\n') ? '' : '\n';
			return existing + separator + formatted;
		});
	}

	/**
	 * 在现有条目中查找相同说明的条目，返回其位置信息
	 * 用于判断是否需要合并
	 */
	private findEntryByDescription(content: string, description: string) {
		return ForeshadowingParser.findEntryByDescription(content, description);
	}

	/**
	 * 完整的标注伏笔流程：检查文件、必要时创建、追加条目
	 * 如果伏笔文件中已存在相同说明的条目，则将新引用追加到该条目
	 * @returns 伏笔文件，供调用方决定是否打开
	 */
	async addForeshadowing(
		sourceFile: TFile,
		content: string,
		description: string,
		tags: string[]
	): Promise<{ file: TFile; merged: boolean }> {
		return this.writer.enqueue(async () => {
			let targetFile: TFile | null = null;

			const folder = findBookRoot(this.app, this.plugin, sourceFile);
			const foundFile = this.findForeshadowingFile(folder);
			if (foundFile) {
				// 如果找到的文件名与当前设置不一致，自动重命名
				const expectedName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
				if (foundFile.name !== expectedName + '.md') {
					const newPath = normalizePath(folder + '/' + expectedName + '.md');
					try { await this.app.fileManager.renameFile(foundFile, newPath); } catch (e) { console.warn('[ForeshadowingManager] 重命名伏笔文件失败:', e); }
				}
				const targetPath = normalizePath(folder + '/' + expectedName + '.md');
				const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
				if (!(abstractFile instanceof TFile)) return { file: sourceFile, merged: false };
				targetFile = abstractFile;
			} else {
				targetFile = await this.createForeshadowingFile(sourceFile);
			}

			const now = window.moment().format('YYYY-MM-DD HH:mm');
			const sourceLink = ChapterSorter.generateChapterLinktext(
				this.app,
				this.plugin,
				sourceFile,
				folder,
				{ sourcePath: targetFile.path, useAlias: true }
			);

			// 检查是否已存在相同说明的条目
			let merged = false;
			await this.app.vault.process(targetFile, (existingContent) => {
				const { found, startPos, endPos, matchedText } = this.findEntryByDescription(existingContent, description);

				if (found && startPos !== -1) {
					// 解析旧条目（无论是新旧格式，parseEntries 都能解析）
					const entries = this.parseEntries(matchedText);
					if (entries.length > 0) {
						const entry = entries[0];
						// 追加新引用内容
						entry.contents.push({
							source: sourceLink,
							time: now,
							text: content.trim()
						});
						
						const formatted = ForeshadowingParser.formatParsedEntry(entry);
						merged = true;
						return existingContent.slice(0, startPos) + formatted + existingContent.slice(endPos);
					}
				}

				// 新建条目
				const entry: ForeshadowingEntry = {
					sourceFile: sourceLink,
					content: content.trim(),
					description,
					tags,
					status: ForeshadowingStatus.Pending,
					createdAt: now,
				};
				
				const formatted = this.formatEntry(entry);
				// 确保文件末尾有换行再追加
				const separator = existingContent.endsWith('\n') ? '' : '\n';
				return existingContent + separator + formatted;
			});
			
			return { file: targetFile, merged };
		});
	}

	/**
	 * 获取光标所在伏笔条目的信息（用于标记回收）
	 * 向上查找最近的 ## [[ 标题行
	 */
	getEntryAtCursor(editor: Editor, cursorLine: number): {
		sourceFile: string;
		createdAt: string;
		contentPreview: string;
		description: string;
	} | null {
		// 向上查找最近的 H2 标题
		let titleLine = -1;
		for (let i = cursorLine; i >= 0; i--) {
			const line = editor.getLine(i);
			if (/^## /.test(line)) {
				titleLine = i;
				break;
			}
		}
		if (titleLine === -1) return null;

		const titleText = editor.getLine(titleLine);
		let sourceFile = '';
		let createdAt = '';
		let description = '';

		// 提取来源文件名和时间戳
		const titleMatch = titleText.match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
		if (titleMatch) {
			sourceFile = titleMatch[1];
			createdAt = titleMatch[2]?.trim() || '';
		} else {
			// 新格式，需要向下找第一条引用的来源标注
			for (let i = titleLine + 1; i < editor.lineCount(); i++) {
				const line = editor.getLine(i);
				if (line.startsWith('> [[')) {
					const sourceMatch = line.match(/^> \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (sourceMatch) {
						sourceFile = sourceMatch[1];
						createdAt = sourceMatch[2]?.trim() || '';
						break;
					}
				}
				if (/^## /.test(line)) break;
			}
		}

		// 向下找第一个引用行作为内容预览
		let contentPreview = '';
		for (let i = titleLine + 1; i < editor.lineCount(); i++) {
			const line = editor.getLine(i);
			if (line.startsWith('> ')) {
				contentPreview = line.replace(/^> /, '');
				break;
			}
			if (/^## /.test(line)) break; // 到下一条了
		}

		if (!description && titleMatch) {
			for (let i = titleLine + 1; i < editor.lineCount(); i++) {
				const line = editor.getLine(i);
				const descMatch = line.match(/\*\*(?:说明|Description|.*?)\*\*：(.*)/);
				if (descMatch) {
					description = descMatch[1].trim();
					break;
				}
				if (/^## /.test(line)) break;
			}
		}
		return { sourceFile, createdAt, contentPreview, description };
	}

	/**
	 * 获取缓存的条目匹配正则表达式
	 * @param sourceFile 来源文件名
	 * @param createdAt 创建时间
	 * @param status 要匹配的状态（如 "未回收|已废弃"）
	 */
	private getEntryPattern(sourceFile: string, createdAt: string, status: string): RegExp {
		const key = `${sourceFile}:${createdAt}:${status}`;
		
		if (!ForeshadowingManager.entryPatternCache.has(key)) {
			// LRU 缓存：超过限制时删除最早的条目
			if (ForeshadowingManager.entryPatternCache.size >= ForeshadowingManager.MAX_CACHE_SIZE) {
				const firstKey = Array.from(ForeshadowingManager.entryPatternCache.keys())[0];
				if (firstKey !== undefined) {
					ForeshadowingManager.entryPatternCache.delete(firstKey);
				}
			}
			
			// 支持新旧格式的定位，捕获整个条目的前半部分作为 before
			const pattern = new RegExp(
				`((?:## \\[\\[${escapeRegex(sourceFile)}\\]\\](?:\\s*-\\s*${escapeRegex(createdAt)})?|## .+?\\n(?:(?!## ).*\\n)*?> \\[\\[${escapeRegex(sourceFile)}\\]\\](?:\\s*-\\s*${escapeRegex(createdAt)})?)(?:(?!\\n(?:---|## ))[\\s\\S])*?)(\\*\\*(?:状态|Status)\\*\\*：)(${status})`,
				'm'
			);
			
			ForeshadowingManager.entryPatternCache.set(key, pattern);
		}
		
		return ForeshadowingManager.entryPatternCache.get(key)!;
	}

	async markAsPartiallyRecovered(
		targetFile: TFile,
		description: string,
		recoveryFile: string,
		note?: string,
		quote?: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			const now = window.moment().format('YYYY-MM-DD HH:mm');

			await this.app.vault.process(targetFile, (content) => {
				const { found: isFound, startPos, endPos, matchedText } = this.findEntryByDescription(content, description);
				if (!isFound) return content;
				found = true;

				const entries = this.parseEntries(matchedText);
				if (entries.length === 0) return content;

				const entry = entries[0];
				entry.status = ForeshadowingStatus.PartiallyRecovered;
				if (!entry.recoveryLogs) entry.recoveryLogs = [];
				entry.recoveryLogs.push({
					stageType: 'stage',
					file: recoveryFile,
					time: now,
					note: note || undefined,
					quote: quote || undefined
				});

				const newText = ForeshadowingParser.formatParsedEntry(entry);

				return content.slice(0, startPos) + newText + content.slice(endPos);
			});

			return found;
		});
	}

	async markAsRecovered(
		targetFile: TFile,
		description: string,
		recoveryFiles: string[],
		note?: string,
		quote?: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			const now = window.moment().format('YYYY-MM-DD HH:mm');

			await this.app.vault.process(targetFile, (content) => {
				const { found: isFound, startPos, endPos, matchedText } = this.findEntryByDescription(content, description);
				if (!isFound) return content;
				found = true;

				const entries = this.parseEntries(matchedText);
				if (entries.length === 0) return content;

				const entry = entries[0];
				entry.status = ForeshadowingStatus.Recovered;
				if (!entry.recoveryLogs) entry.recoveryLogs = [];

				recoveryFiles.forEach(file => {
					entry.recoveryLogs!.push({
						stageType: 'final',
						file,
						time: now,
						note: note || undefined,
						quote: quote || undefined
					});
				});

				const newText = ForeshadowingParser.formatParsedEntry(entry);

				return content.slice(0, startPos) + newText + content.slice(endPos);
			});

			return found;
		});
	}

	/**
	 * 添加回收章节到已回收的伏笔条目
	 * 用于在已回收的伏笔上追加新的回收章节
	 */
	async addRecoveryChapter(
		targetFile: TFile,
		sourceFile: string,
		createdAt: string,
		newRecoveryFile: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			const now = window.moment().format('YYYY-MM-DD HH:mm');

			// 查找已回收条目的回收列表
			const pattern = new RegExp(
				`(## \\[\\[${escapeRegex(sourceFile)}\\]\\]` +
				(createdAt ? `[^\\n]*${escapeRegex(createdAt)}` : '') +
				`[\\s\\S]*?\\*\\*(?:回收于|Recovered at|Resolved in)\\*\\*：\\n)([\\s\\S]*?)(\\n\\n|$)`,
				'm'
			);

			await this.app.vault.process(targetFile, (content) => {
				const match = pattern.exec(content);
				if (!match) return content;

				found = true;
				// 在回收列表末尾追加新章节
				const newLine = `- [[${newRecoveryFile}]] - ${now}\n`;
				return content.slice(0, match.index + match[1].length + match[2].length) +
					newLine +
					content.slice(match.index + match[1].length + match[2].length);
			});

			return found;
		});
	}
	/**
	 * 将指定条目标记为已废弃
	 */
	async markAsDeprecated(
		targetFile: TFile,
		description: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			await this.app.vault.process(targetFile, (content) => {
				const { found: isFound, startPos, endPos, matchedText } = this.findEntryByDescription(content, description);
				if (!isFound) return content;

				let newText = matchedText;
				const statusPattern = /(\*\*(?:状态|Status)\*\*：)(未回收|pending|Pending|Unresolved)/;
				if (statusPattern.test(newText)) {
					found = true;
					newText = newText.replace(statusPattern, (match, p1) => {
						return `${p1}${getForeshadowingStatusText(ForeshadowingStatus.Deprecated)}`;
					});
				} else {
					return content;
				}

				return content.slice(0, startPos) + newText + content.slice(endPos);
			});
			return found;
		});
	}

	/**
	 * 将指定条目从已废弃恢复为未回收
	 */
	async markAsPending(
		targetFile: TFile,
		description: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			await this.app.vault.process(targetFile, (content) => {
				const { found: isFound, startPos, endPos, matchedText } = this.findEntryByDescription(content, description);
				if (!isFound) return content;

				let newText = matchedText;
				const statusPattern = /(\*\*(?:状态|Status)\*\*：)(已废弃|deprecated|Deprecated|Abandoned)/;
				if (statusPattern.test(newText)) {
					found = true;
					newText = newText.replace(statusPattern, (match, p1) => {
						return `${p1}${getForeshadowingStatusText(ForeshadowingStatus.Pending)}`;
					});
				} else {
					return content;
				}

				return content.slice(0, startPos) + newText + content.slice(endPos);
			});
			return found;
		});
	}
	async getExistingTags(sourceFile: TFile): Promise<string[]> {
		const folder = sourceFile.parent?.path || '';
		const foreshadowFile = this.getForeshadowingFileByFolder(folder);
		if (!foreshadowFile) return [];
		const content = await this.app.vault.cachedRead(foreshadowFile);
		const entries = this.parseEntries(content);
		return [...new Set(entries.flatMap(e => e.tags))];
	}

	async openForeshadowingFile(targetFile: TFile): Promise<void> {
		await this.app.workspace.getLeaf('tab').openFile(targetFile);
	}

	getForeshadowingFileByFolder(folderPath: string): TFile | null {
		return this.findForeshadowingFile(folderPath);
	}

	/**
	 * 解析伏笔文件内容为结构化数据
	 * 统一的解析逻辑，供 View 层调用
	 */
	parseEntries(content: string): ParsedForeshadowingEntry[] {
		return ForeshadowingParser.parseEntries(content);
	}

	/**
	 * 构建「章节路径 → 关联伏笔条目列表」映射表
	 *
	 * 将读取伏笔文件、解析条目、按章节路径安全匹配的三步逻辑统一封装，
	 * 避免在 WorkbenchView / ChapterOverviewView / ImmersiveChapterListView 中重复实现。
	 *
	 * @param folderPath 书籍根目录路径（根目录传 ''）
	 * @param files      需要匹配的章节文件列表
	 * @param vault      Obsidian Vault 实例，用于读取文件内容
	 */
	async buildChapterForeshadowingMap(
		folderPath: string,
		files: TFile[],
		vault: { cachedRead: (file: TFile) => Promise<string> }
	): Promise<Map<string, ParsedForeshadowingEntry[]>> {
		const map = new Map<string, ParsedForeshadowingEntry[]>();
		const fFile = this.findForeshadowingFile(folderPath);
		if (!fFile) return map;

		const content = await vault.cachedRead(fFile);
		const entries = this.parseEntries(content);
		const allChapters = ChapterSorter.getAllChapters(this.app, this.plugin, folderPath);
		const eligibleChapters = allChapters.length > 0 ? allChapters : files;

		for (const entry of entries) {
			// 提取所有来源（可能跨多个章节）
			const targets: string[] = [];
			const sources = new Set<string>();
			if (entry.sourceFile) sources.add(entry.sourceFile);
			if (entry.contents) {
				entry.contents.forEach(c => {
					if (c.source) sources.add(c.source);
				});
			}

			if (entry.status === ForeshadowingStatus.Pending) {
				targets.push(...sources);
			} else if (entry.status === ForeshadowingStatus.PartiallyRecovered || entry.status === ForeshadowingStatus.Recovered) {
				targets.push(...sources);
				if (entry.recoveryLogs && entry.recoveryLogs.length > 0) {
					targets.push(...entry.recoveryLogs.map(l => l.file));
				} else {
					const recFiles = entry.recoveryFiles
						? [...entry.recoveryFiles]
						: (entry.recoveryFile ? [entry.recoveryFile] : []);
					targets.push(...recFiles);
				}
			}

			for (const target of targets) {
				if (!target) continue;
				const resolvedFile = ChapterSorter.resolveChapterFile(
					this.app,
					this.plugin,
					folderPath,
					target,
					{ eligibleChapters, sourcePath: fFile.path }
				);
				if (resolvedFile) {
					const list = map.get(resolvedFile.path) || [];
					if (!list.includes(entry)) {
						list.push(entry);
						map.set(resolvedFile.path, list);
					}
				}
			}
		}

		return map;
	}
}
