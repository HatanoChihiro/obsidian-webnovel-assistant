import { App, Editor, Notice, TFile, TFolder } from 'obsidian';
import { ForeshadowingEntry, ForeshadowingStatus } from '../types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 伏笔管理服务
 * 负责伏笔文件的读写、格式化、状态更新
 */
export class ForeshadowingManager {
	/** 正则表达式缓存，避免重复编译（最多缓存 100 个） */
	private static readonly entryPatternCache = new Map<string, RegExp>();
	private static readonly MAX_CACHE_SIZE = 100;

	constructor(
		private app: App,
		private plugin: WebNovelAssistantPlugin
	) {}

	/**
	 * 获取伏笔文件路径（与来源文件同文件夹）
	 */
	getForeshadowingFilePath(sourceFile: TFile): string {
		const fileName = this.plugin.settings.foreshadowing.fileName || '伏笔';
		const folder = sourceFile.parent?.path || '';
		return folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
	}

	/**
	 * 检查伏笔文件是否存在
	 */
	foreshadowingFileExists(sourceFile: TFile): boolean {
		const path = this.getForeshadowingFilePath(sourceFile);
		return !!this.app.vault.getAbstractFileByPath(path);
	}

	/**
	 * 创建伏笔文件（空文件，不添加标题）
	 */
	async createForeshadowingFile(sourceFile: TFile): Promise<TFile> {
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
		lines.push(`**说明**：${entry.description}`);
		lines.push('');

		// 标签（有标签才显示）
		if (entry.tags.length > 0) {
			lines.push(`**标签**：${entry.tags.map(t => `#${t}`).join(' ')}`);
			lines.push('');
		}

		// 状态
		lines.push(`**状态**：${entry.status}`);

		// 回收信息（已回收时显示，支持多章节）
		if (entry.status === ForeshadowingStatus.Recovered) {
			// 优先使用新格式（多章节）
			if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
				lines.push('');
				lines.push(`**回收于**：`);
				entry.recoveryFiles.forEach((file, index) => {
					const time = entry.recoveredAts && entry.recoveredAts[index] ? ` - ${entry.recoveredAts[index]}` : '';
					lines.push(`- [[${file}]]${time}`);
				});
			}
			// 向后兼容：如果只有旧格式（单章节）
			else if (entry.recoveryFile) {
				const recoveryTimestamp = entry.recoveredAt ? ` - ${entry.recoveredAt}` : '';
				lines.push('');
				lines.push(`**回收于**：[[${entry.recoveryFile}]]${recoveryTimestamp}`);
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
		const existing = await this.app.vault.read(targetFile);
		const formatted = this.formatEntry(entry);
		// 确保文件末尾有换行再追加
		const separator = existing.endsWith('\n') ? '' : '\n';
		await this.app.vault.modify(targetFile, existing + separator + formatted);
	}

	/**
	 * 在现有条目中查找相同说明的条目，返回其位置信息
	 * 用于判断是否需要合并
	 */
	private findEntryByDescription(content: string, description: string): {
		found: boolean;
		insertPos: number; // 在第一个引用块之后插入新引用的字符位置
	} {
		const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		// 匹配 **说明**：<description> 这一行
		const descPattern = new RegExp(
			`\\*\\*说明\\*\\*：${escapeRegex(description)}`,
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
		let targetFile: TFile | null = null;

		if (this.foreshadowingFileExists(sourceFile)) {
			const path = this.getForeshadowingFilePath(sourceFile);
			targetFile = this.app.vault.getAbstractFileByPath(path) as TFile;
		} else {
			targetFile = await this.createForeshadowingFile(sourceFile);
		}

		const now = window.moment().format('YYYY-MM-DD HH:mm');

		// 检查是否已存在相同说明的条目
		const existingContent = await this.app.vault.read(targetFile);
		const { found, insertPos } = this.findEntryByDescription(existingContent, description);

		if (found && insertPos !== -1) {
			// 合并：在已有条目的引用块末尾追加新引用（带来源和时间）
			const newQuote = content.trim().split('\n')
				.map(line => `> ${line}`)
				.join('\n');
			const insertion = `\n\n> [[${sourceFile.basename}]] - ${now}\n${newQuote}`;
			const newContent = existingContent.slice(0, insertPos) + insertion + existingContent.slice(insertPos);
			await this.app.vault.modify(targetFile, newContent);
			return { file: targetFile, merged: true };
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
		await this.appendEntry(targetFile, entry);
		return { file: targetFile, merged: false };
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
				const firstKey = ForeshadowingManager.entryPatternCache.keys().next().value;
				ForeshadowingManager.entryPatternCache.delete(firstKey);
			}
			
			// 转义正则特殊字符
			const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			
			const pattern = new RegExp(
				`(## \\[\\[${escapeRegex(sourceFile)}\\]\\]` +
				(createdAt ? `[^\\n]*${escapeRegex(createdAt)}` : '') +
				`[\\s\\S]*?)(\\*\\*状态\\*\\*：)(${status})`,
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
		const content = await this.app.vault.read(targetFile);
		const now = window.moment().format('YYYY-MM-DD HH:mm');

		// 使用缓存的正则表达式
		const titlePattern = this.getEntryPattern(sourceFile, createdAt, '未回收|已废弃');

		if (!titlePattern.test(content)) return false;

		const newContent = content.replace(
			titlePattern,
			(match, before, statusLabel) => {
				// 生成回收信息（多章节格式）
				const recoveryLines = recoveryFiles.map(file => `- [[${file}]] - ${now}`).join('\n');
				return `${before}${statusLabel}已回收\n\n**回收于**：\n${recoveryLines}`;
			}
		);

		await this.app.vault.modify(targetFile, newContent);
		return true;
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
		const content = await this.app.vault.read(targetFile);
		const now = window.moment().format('YYYY-MM-DD HH:mm');

		// 查找已回收条目的回收列表
		const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = new RegExp(
			`(## \\[\\[${escapeRegex(sourceFile)}\\]\\]` +
			(createdAt ? `[^\\n]*${escapeRegex(createdAt)}` : '') +
			`[\\s\\S]*?\\*\\*回收于\\*\\*：\\n)([\\s\\S]*?)(\\n\\n|$)`,
			'm'
		);

		const match = pattern.exec(content);
		if (!match) return false;

		// 在回收列表末尾追加新章节
		const newLine = `- [[${newRecoveryFile}]] - ${now}\n`;
		const newContent = content.slice(0, match.index + match[1].length + match[2].length) +
			newLine +
			content.slice(match.index + match[1].length + match[2].length);

		await this.app.vault.modify(targetFile, newContent);
		return true;
	}

	/**
	 * 将指定条目标记为已废弃
	 */
	async markAsDeprecated(
		targetFile: TFile,
		sourceFile: string,
		createdAt: string
	): Promise<boolean> {
		const content = await this.app.vault.read(targetFile);

		// 使用缓存的正则表达式
		const titlePattern = this.getEntryPattern(sourceFile, createdAt, '未回收');

		if (!titlePattern.test(content)) return false;

		const newContent = content.replace(
			titlePattern,
			(match, before, statusLabel) => `${before}${statusLabel}已废弃`
		);

		await this.app.vault.modify(targetFile, newContent);
		return true;
	}

	/**
	 * 将指定条目从已废弃恢复为未回收
	 */
	async markAsPending(
		targetFile: TFile,
		sourceFile: string,
		createdAt: string
	): Promise<boolean> {
		const content = await this.app.vault.read(targetFile);

		// 使用缓存的正则表达式
		const titlePattern = this.getEntryPattern(sourceFile, createdAt, '已废弃');

		if (!titlePattern.test(content)) return false;

		const newContent = content.replace(
			titlePattern,
			(match, before, statusLabel) => `${before}${statusLabel}未回收`
		);

		await this.app.vault.modify(targetFile, newContent);
		return true;
	}
	async openForeshadowingFile(targetFile: TFile): Promise<void> {
		await this.app.workspace.getLeaf('tab').openFile(targetFile);
	}

	/**
	 * 根据文件夹路径获取伏笔文件（供视图使用）
	 */
	getForeshadowingFileByFolder(folderPath: string): TFile | null {
		const fileName = this.plugin.settings.foreshadowing?.fileName || '伏笔';
		const path = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	/**
	 * 解析伏笔文件内容为结构化数据
	 * 统一的解析逻辑，供 View 层调用
	 */
	parseEntries(content: string): Array<{
		sourceFile: string;
		createdAt: string;
		contents: { source: string; time: string; text: string }[];
		description: string;
		tags: string[];
		status: ForeshadowingStatus;
		recoveryFiles?: string[];
		recoveredAts?: string[];
		recoveryFile?: string;
		recoveredAt?: string;
	}> {
		const entries: Array<{
			sourceFile: string;
			createdAt: string;
			contents: { source: string; time: string; text: string }[];
			description: string;
			tags: string[];
			status: ForeshadowingStatus;
			recoveryFiles?: string[];
			recoveredAts?: string[];
			recoveryFile?: string;
			recoveredAt?: string;
		}> = [];

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
			const descMatch = trimmed.match(/\*\*说明\*\*：(.+)/);
			const description = descMatch ? descMatch[1].trim() : '';

			// 解析标签
			const tagsMatch = trimmed.match(/\*\*标签\*\*：(.+)/);
			const tags = tagsMatch
				? tagsMatch[1].trim().split(/\s+/).map(t => t.replace(/^#/, ''))
				: [];

			// 解析状态
			const statusMatch = trimmed.match(/\*\*状态\*\*：(.+)/);
			const statusText = statusMatch ? statusMatch[1].trim() : '未回收';
			let status = ForeshadowingStatus.Pending;
			if (statusText === '已回收') status = ForeshadowingStatus.Recovered;
			else if (statusText === '已废弃') status = ForeshadowingStatus.Deprecated;

			// 解析回收信息（支持多章节）
			// 新格式：**回收于**：\n- [[章节1]] - 时间\n- [[章节2]] - 时间
			const recoveryListMatch = trimmed.match(/\*\*回收于\*\*：\n((?:- \[\[.+?\]\].*\n?)+)/);
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
				const singleRecoveryMatch = trimmed.match(/\*\*回收于\*\*：\[\[(.+?)\]\](?:\s*-\s*(.+))?/);
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
