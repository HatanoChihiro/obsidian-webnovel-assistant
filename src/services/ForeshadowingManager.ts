import type { App, Editor } from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import { t } from '../i18n';
import type { ForeshadowingEntry, ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ForeshadowingStatus } from '../types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { escapeRegex } from '../utils/validation';
import { SerializedWriter } from '../utils/SerializedWriter';
import { FORESHADOWING_STATUS_MAP, getForeshadowingLabel, getForeshadowingStatusText, getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';

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
	 */
	/**
	 * 获取伏笔文件路径（新建时使用当前语言的文件名）
	 */
	getForeshadowingFilePath(sourceFile: TFile): string {
		const folder = sourceFile.parent?.path || '';
		// 新建时优先使用用户设置，fallback 到当前语言的默认文件名
		const fileName = this.plugin.settings.foreshadowing.fileName || getDefaultFileName('foreshadowingFileName');
		return normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
	}

	/**
	 * 检查伏笔文件是否存在（支持多语言文件名查找）
	 */
	foreshadowingFileExists(sourceFile: TFile): boolean {
		return !!this.findForeshadowingFile(sourceFile.parent?.path || '');
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
		// 检查是否已有伏笔文件（多语言查找）
		const existing = this.findForeshadowingFile(sourceFile.parent?.path || '');
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
			if (existing.name !== expectedName + '.md') {
				const newPath = normalizePath((sourceFile.parent?.path || '') + '/' + expectedName + '.md');
				try { await this.app.fileManager.renameFile(existing, newPath); } catch (e) { console.warn('[ForeshadowingManager] 重命名伏笔文件失败:', e); }
			}
			const found = this.app.vault.getAbstractFileByPath(normalizePath((sourceFile.parent?.path || '') + '/' + expectedName + '.md'));
				return found instanceof TFile ? found : existing;
		}

		const path = this.getForeshadowingFilePath(sourceFile);

		// 确保文件夹存在
		const folder = sourceFile.parent?.path;
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
		const showTimestamp = this.plugin.settings.foreshadowing.showTimestamp !== false;
		const timestamp = showTimestamp ? ` - ${entry.createdAt}` : '';
		const lines: string[] = [];

		// 标题行
		lines.push(`## [[${entry.sourceFile}]]${timestamp}`);
		lines.push('');

		// 引用块（处理多行内容）
		const contentLines = entry.content.split('\n');
		for (const line of contentLines) {
			lines.push(`> ${line}`);
		}
		lines.push('');

		// 说明
		lines.push(`**${getForeshadowingLabel('description')}**：${entry.description}`);
		lines.push('');

		// 标签（有标签才显示）
		if (entry.tags.length > 0) {
			lines.push(`**${getForeshadowingLabel('tags')}**：${entry.tags.map(t => `#${t}`).join(', ')}`);
			lines.push('');
		}

		// 状态
		lines.push(`**${getForeshadowingLabel('status')}**：${getForeshadowingStatusText(entry.status)}`);

		// 回收信息（已回收时显示，支持多章节）
		if (entry.status === ForeshadowingStatus.Recovered) {
			// 优先使用新格式（多章节）
			if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
				lines.push('');
				lines.push(`**${getForeshadowingLabel('recoveredAt')}**：`);
				entry.recoveryFiles.forEach((file, index) => {
					const time = entry.recoveredAts && entry.recoveredAts[index] ? ` - ${entry.recoveredAts[index]}` : '';
					lines.push(`- [[${file}]]${time}`);
				});
			}
			// 向后兼容：如果只有旧格式（单章节）
			else if (entry.recoveryFile) {
				const recoveryTimestamp = entry.recoveredAt ? ` - ${entry.recoveredAt}` : '';
				lines.push('');
				lines.push(`**${getForeshadowingLabel('recoveredAt')}**：[[${entry.recoveryFile}]]${recoveryTimestamp}`);
			}
		}

		lines.push('');
		lines.push('---');
		lines.push('');

		return lines.join('\n');
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
	private findEntryByDescription(content: string, description: string): {
		found: boolean;
		insertPos: number; // 在第一个引用块之后插入新引用的字符位置
	} {
		// 匹配 **说明**：<description> 这一行
		const descPattern = new RegExp(
			`\\*\\*(?:说明|Description)\\*\\*：${escapeRegex(description)}`,
			'm'
		);
		const descMatch = descPattern.exec(content);
		if (!descMatch) return { found: false, insertPos: -1 };

		// 向上找到这个条目的第一个引用块结束位置（最后一个连续 > 行之后）
		const beforeDesc = content.slice(0, descMatch.index);
		// 找到最后一个引用行（> 开头）的末尾
		const lastQuoteMatch = [...beforeDesc.matchAll(/^> .*/gm)].pop();
		if (!lastQuoteMatch || lastQuoteMatch.index === undefined) {
			return { found: false, insertPos: -1 };
		}
		const insertPos = lastQuoteMatch.index + lastQuoteMatch[0].length;
		return { found: true, insertPos };
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

			const foundFile = this.findForeshadowingFile(sourceFile.parent?.path || '');
			if (foundFile) {
				// 如果找到的文件名与当前设置不一致，自动重命名
				const expectedName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
				if (foundFile.name !== expectedName + '.md') {
					const newPath = normalizePath((sourceFile.parent?.path || '') + '/' + expectedName + '.md');
					try { await this.app.fileManager.renameFile(foundFile, newPath); } catch (e) { console.warn('[ForeshadowingManager] 重命名伏笔文件失败:', e); }
				}
				const targetPath = normalizePath((sourceFile.parent?.path || '') + '/' + expectedName + '.md');
				const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
				if (!(abstractFile instanceof TFile)) return { file: sourceFile, merged: false };
				targetFile = abstractFile;
			} else {
				targetFile = await this.createForeshadowingFile(sourceFile);
			}

			const now = window.moment().format('YYYY-MM-DD HH:mm');

			// 检查是否已存在相同说明的条目
			let merged = false;
			await this.app.vault.process(targetFile, (existingContent) => {
				const { found, insertPos } = this.findEntryByDescription(existingContent, description);

				if (found && insertPos !== -1) {
					// 合并：在已有条目的引用块末尾追加新引用（带来源和时间）
					const newQuote = content.trim().split('\n')
						.map(line => `> ${line}`)
						.join('\n');
					const insertion = `\n\n> [[${sourceFile.basename}]] - ${now}\n${newQuote}`;
					merged = true;
					return existingContent.slice(0, insertPos) + insertion + existingContent.slice(insertPos);
				}

				// 新建条目
				const entry: ForeshadowingEntry = {
					sourceFile: sourceFile.basename,
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
	} | null {
		// 向上查找最近的 H2 标题（## [[...]]）
		let titleLine = -1;
		for (let i = cursorLine; i >= 0; i--) {
			const line = editor.getLine(i);
			if (/^## \[\[.+\]\]/.test(line)) {
				titleLine = i;
				break;
			}
		}
		if (titleLine === -1) return null;

		const titleText = editor.getLine(titleLine);
		// 提取来源文件名和时间戳
		const titleMatch = titleText.match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
		if (!titleMatch) return null;

		const sourceFile = titleMatch[1];
		const createdAt = titleMatch[2]?.trim() || '';

		// 向下找第一个引用行作为内容预览
		let contentPreview = '';
		for (let i = titleLine + 1; i < editor.lineCount(); i++) {
			const line = editor.getLine(i);
			if (line.startsWith('> ')) {
				contentPreview = line.replace(/^> /, '');
				break;
			}
			if (/^## \[\[/.test(line)) break; // 到下一条了
		}

		return { sourceFile, createdAt, contentPreview };
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
			
			const pattern = new RegExp(
				`(## \\[\\[${escapeRegex(sourceFile)}\\]\\]` +
				(createdAt ? `[^\\n]*${escapeRegex(createdAt)}` : '') +
				`[\\s\\S]*?)(\\*\\*(?:状态|Status)\\*\\*：)(${status})`,
				'm'
			);
			
			ForeshadowingManager.entryPatternCache.set(key, pattern);
		}
		
		return ForeshadowingManager.entryPatternCache.get(key)!;
	}

	/**
	 * 将指定条目标记为已回收，更新状态和回收信息
	 * 支持多章节回收
	 * 通过来源文件名 + 创建时间定位条目
	 */
	async markAsRecovered(
		targetFile: TFile,
		sourceFile: string,
		createdAt: string,
		recoveryFiles: string[]
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			const now = window.moment().format('YYYY-MM-DD HH:mm');

			// 使用缓存的正则表达式
			const titlePattern = this.getEntryPattern(sourceFile, createdAt, '未回收|已废弃|pending|deprecated|Pending|Deprecated');

			await this.app.vault.process(targetFile, (content) => {
				const newContent = content.replace(
					titlePattern,
					(match, before, statusLabel) => {
						found = true;
						// 生成回收信息（多章节格式）
						const recoveryLines = recoveryFiles.map(file => `- [[${file}]] - ${now}`).join('\n');
						return `${before}${statusLabel}${getForeshadowingStatusText(ForeshadowingStatus.Recovered)}\n\n**${getForeshadowingLabel('recoveredAt')}**：\n${recoveryLines}`;
					}
				);
				return newContent;
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
				`[\\s\\S]*?\\*\\*(?:回收于|Recovered at)\\*\\*：\\n)([\\s\\S]*?)(\\n\\n|$)`,
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
		sourceFile: string,
		createdAt: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			const titlePattern = this.getEntryPattern(sourceFile, createdAt, '未回收|pending|Pending');

			await this.app.vault.process(targetFile, (content) => {
				const newContent = content.replace(
					titlePattern,
					(match, before, statusLabel) => {
						found = true;
						return `${before}${statusLabel}${getForeshadowingStatusText(ForeshadowingStatus.Deprecated)}`;
					}
				);
				return newContent;
			});

			return found;
		});
	}

	/**
	 * 将指定条目从已废弃恢复为未回收
	 */
	async markAsPending(
		targetFile: TFile,
		sourceFile: string,
		createdAt: string
	): Promise<boolean> {
		return this.writer.enqueue(async () => {
			let found = false;
			const titlePattern = this.getEntryPattern(sourceFile, createdAt, '已废弃|deprecated|Deprecated');

			await this.app.vault.process(targetFile, (content) => {
				const newContent = content.replace(
					titlePattern,
					(match, before, statusLabel) => {
						found = true;
						return `${before}${statusLabel}${getForeshadowingStatusText(ForeshadowingStatus.Pending)}`;
					}
				);
				return newContent;
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
		const entries: ParsedForeshadowingEntry[] = [];

		// 按 --- 分割条目
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed || !trimmed.startsWith('## ')) continue;

			// 解析标题行：## [[来源文件]] - 时间
			const titleMatch = trimmed.match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?/m);
			if (!titleMatch) continue;

			const sourceFile = titleMatch[1];
			const createdAt = titleMatch[2]?.trim() || '';

			// 解析所有引用块（支持多条）
			const contents: { source: string; time: string; text: string }[] = [];
			const lines = trimmed.split('\n');
			let i = 0;

			// 跳过标题行
			while (i < lines.length && lines[i].startsWith('## ')) i++;

			// 收集引用块
			while (i < lines.length) {
				const line = lines[i];
				if (line.startsWith('> ')) {
					// 检查上一行是否是来源标注（> [[文件]] - 时间）
					let source = '';
					let time = '';
					const quoteLines: string[] = [];

					// 第一行可能是来源标注
					const sourceLine = line.replace(/^> /, '');
					const sourceMatch = sourceLine.match(/^\[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (sourceMatch) {
						source = sourceMatch[1];
						time = sourceMatch[2]?.trim() || '';
						i++;
						// 收集后续引用行
						while (i < lines.length && lines[i].startsWith('> ')) {
							quoteLines.push(lines[i].replace(/^> /, ''));
							i++;
						}
					} else {
						// 普通引用行（第一条，来源来自标题行）
						while (i < lines.length && lines[i].startsWith('> ')) {
							quoteLines.push(lines[i].replace(/^> /, ''));
							i++;
						}
					}

					if (quoteLines.length > 0) {
						// 如果没有内联来源标注，用标题行的来源和时间
						contents.push({
							source: source || sourceFile,
							time: time || createdAt,
							text: quoteLines.join('\n')
						});
					}
				} else {
					i++;
				}
			}

			// 如果没有解析到引用，用第一个 > 行
			if (contents.length === 0) {
				const firstQuote = lines.find(l => l.startsWith('> '));
				if (firstQuote) {
					contents.push({ source: sourceFile, time: createdAt, text: firstQuote.replace(/^> /, '') });
				}
			}

			// 解析说明
			const descMatch = trimmed.match(new RegExp(`\\*\\*(?:说明|Description|${t('foreshadowing.description')})\\*\\*：(.+)`));
			const description = descMatch ? descMatch[1].trim() : '';

			// 解析标签
			const tagsMatch = trimmed.match(new RegExp(`\\*\\*(?:标签|Tags|${t('foreshadowing.tags')})\\*\\*：(.+)`));
			const tags = tagsMatch
				? tagsMatch[1].trim().split(/[,，\s]+/).map(t => t.replace(/^#/, ''))
				: [];

			// 解析状态
			const statusMatch = trimmed.match(new RegExp(`\\*\\*(?:状态|Status|${t('foreshadowing.status')})\\*\\*：(.+)`));
			const rawStatusText = statusMatch ? statusMatch[1].trim() : '';
			let status = ForeshadowingStatus.Pending;
			if (rawStatusText) {
				const mapped = FORESHADOWING_STATUS_MAP[rawStatusText];
				if (mapped === 'recovered') status = ForeshadowingStatus.Recovered;
				else if (mapped === 'deprecated') status = ForeshadowingStatus.Deprecated;
			}

			// 解析回收信息（支持多章节）
			// 新格式：**回收于**：\n- [[章节1]] - 时间\n- [[章节2]] - 时间
			const recoveryListMatch = trimmed.match(new RegExp(`\\*\\*(?:回收于|Recovered at|${t('foreshadowing.recovered-at')})\\*\\*：\\n((?:- \\[\\[.+?\\]\\].*\\n?)+)`));
			let recoveryFiles: string[] | undefined;
			let recoveredAts: string[] | undefined;
			let recoveryFile: string | undefined;
			let recoveredAt: string | undefined;

			if (recoveryListMatch) {
				// 多章节格式
				const listLines = recoveryListMatch[1].trim().split('\n');
				recoveryFiles = [];
				recoveredAts = [];
				listLines.forEach(line => {
					const match = line.match(/^- \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (match) {
						recoveryFiles!.push(match[1]);
						recoveredAts!.push(match[2]?.trim() || '');
					}
				});
			} else {
				// 旧格式（单章节）：**回收于**：[[章节]] - 时间
				const singleRecoveryMatch = trimmed.match(new RegExp(`\\*\\*(?:回收于|Recovered at|${t('foreshadowing.recovered-at')})\\*\\*：\\[\\[(.+?)\\]\\](?:\\s*-\\s*(.+))?`));
				if (singleRecoveryMatch) {
					recoveryFile = singleRecoveryMatch[1];
					recoveredAt = singleRecoveryMatch[2]?.trim();
				}
			}

			if (description) {
				entries.push({ sourceFile, createdAt, contents, description, tags, status, recoveryFiles, recoveredAts, recoveryFile, recoveredAt });
			}
		}

		return entries;
	}
}
