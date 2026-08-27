import type { App} from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import { t } from '../i18n';

import type { WebNovelAssistantPlugin } from '../types/plugin';

import { escapeRegex } from '../utils/validation';
import { getDefaultFileName, getDefaultFileNameCandidates, getTimelineLabel } from '../i18n/data-keys';

import { SerializedWriter } from '../utils/SerializedWriter';
import { ChapterSorter } from './ChapterSorter';



export interface TimelineEntry {
	time: string;
	description: string;
	chapter: string;
	type: string;
	rawBlock: string;
	origin?: string;
	items?: { description: string; chapter: string; origin?: string }[];
}



/**

 * 时间线管理服务

 * 负责时间线文件的读写、格式化、条目管理

 */

export class TimelineManager {

	private writer = new SerializedWriter();



	constructor(

		private app: App,

		private plugin: WebNovelAssistantPlugin,

		public currentFolder: string = ''

	) {
		this.registerEvents();
	}

	private registerEvents(): void {
		if (typeof this.app?.vault?.on === 'function' && typeof this.plugin?.registerEvent === 'function') {
			this.plugin.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (!(file instanceof TFile) || file.extension !== 'md') return;
					this.handleVaultModify(file);
				})
			);
		}
	}

	private handleVaultModify(file: TFile): void {
		const folderPath = file.parent?.isRoot() ? '' : (file.parent?.path || '');
		const expectedFile = this.findTimelineFile(folderPath);
		if (!expectedFile || expectedFile.path !== file.path) return;

		// 检查 workspaceFolders 边界
		const workspaceFolders = this.plugin.settings.workspaceFolders || [];
		if (workspaceFolders.length > 0) {
			const inWorkspace = folderPath.length > 0 && workspaceFolders.some(ws => {
				const norm = ws.replace(/^\/+|\/+$/g, '');
				return folderPath === norm || folderPath.startsWith(norm + '/');
			});
			if (!inWorkspace) return;
		}

		// 防抖并触发幂等全量对账
		if (this.plugin.adaptiveDebounceManager) {
			this.plugin.adaptiveDebounceManager.debounceFixed(
				`timeline-reconcile-${file.path}`,
				() => {
					void (async () => {
						try {
							const content = await this.app.vault.cachedRead(file);
							const entries = this.parseEntries(content);
							await this.reconcileFrontmatter(folderPath, entries, file);
						} catch (err) {
							console.error(`[TimelineManager] 自动对账失败 ${file.path}:`, err);
						}
					})();
				},
				500
			);
		} else {
			void (async () => {
				try {
					const content = await this.app.vault.cachedRead(file);
					const entries = this.parseEntries(content);
					await this.reconcileFrontmatter(folderPath, entries, file);
				} catch (err) {
					console.error(`[TimelineManager] 自动对账失败 ${file.path}:`, err);
				}
			})();
		}
	}

	normalizeFolderPath(folderPath?: string): string {
		const raw = folderPath !== undefined ? folderPath : this.currentFolder;
		if (!raw || raw === '/') return '';
		return normalizePath(raw).replace(/^\/+|\/+$/g, '');
	}

	getTimelineFilePath(folderPath?: string): string {
		const folder = this.normalizeFolderPath(folderPath);
		const fileName = (this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName')) + '.md';

		return normalizePath(folder ? `${folder}/${fileName}` : fileName);

	}




	findTimelineFile(folderPath?: string): TFile | null {
		const folder = this.normalizeFolderPath(folderPath);
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.timeline?.fileName || t('common.default-timeline-filename'));
		for (const name of getDefaultFileNameCandidates('timelineFileName')) candidates.add(name);
		for (const fileName of candidates) {
			const path = normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	getTimelineFile(folderPath?: string): TFile | null {
		return this.findTimelineFile(folderPath);
	}


	async createTimelineFile(folderPath?: string): Promise<TFile> {
		const folder = this.normalizeFolderPath(folderPath);
		// 检查是否已有时间线文件（多语言查找）
		const existing = this.findTimelineFile(folder);
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName');
			if (existing.name !== expectedName + '.md') {
				const newPath = normalizePath(folder ? folder + '/' + expectedName + '.md' : expectedName + '.md');
				try { await this.app.fileManager.renameFile(existing, newPath); } catch (e) { console.warn('[TimelineManager] 重命名时间线文件失败:', e); }
			}
			const foundPath = normalizePath(folder ? folder + '/' + expectedName + '.md' : expectedName + '.md');
			const found = this.app.vault.getAbstractFileByPath(foundPath);
				return found instanceof TFile ? found : existing;
		}

		const path = this.getTimelineFilePath(folder);
		return await this.app.vault.create(path, '');
	}



	async loadEntries(folderPath?: string): Promise<TimelineEntry[] | null> {
		const folder = this.normalizeFolderPath(folderPath);
		const file = this.getTimelineFile(folder);
		if (!file) return null;
		const content = await this.app.vault.cachedRead(file);
		return this.parseEntries(content);
	}



	parseEntries(content: string): TimelineEntry[] {

		const entries: TimelineEntry[] = [];

		const blocks = content.split(/\n---\n/);



		for (const block of blocks) {

			const trimmed = block.trim();

			if (!trimmed.startsWith('## ')) continue;



			const lines = trimmed.split('\n');

			const time = lines[0].replace(/^## /, '').trim();



			const items: { description: string; chapter: string; origin?: string }[] = [];

			// 匹配类型行：优先当前语言，兼容中文旧格式
				const typeMatch = trimmed.match(new RegExp(`\\*\\*(?:Type|类型|${t('timeline.type-label')})\\*\\*：(.+)`));



			let i = 1;

			while (i < lines.length) {

				const line = lines[i];

				

				// 跳过空行和类型行

				if (!line.trim() || line.startsWith('**')) {

					i++;

					continue;

				}

				

				// 处理列表项

				if (line.startsWith('- ')) {

					const itemText = line.slice(2);

					

					// 提取所有 [[章节]] 链接

					const chapterMatches = itemText.matchAll(/\[\[(.+?)\]\]/g);

					const chapters: string[] = [];

					for (const match of chapterMatches) {

						chapters.push(match[1]);

					}

					

					// 移除所有链接后的文本作为描述的第一行

					let desc = itemText.replace(/\[\[.+?\]\]/g, '').trim();

					

					// 收集后续的缩进行（多行描述）

					i++;

					while (i < lines.length && lines[i].startsWith('  ') && !lines[i].startsWith('- ')) {

						const continuationLine = lines[i].slice(2); // 移除缩进

						if (continuationLine.trim()) {

							desc += '\n' + continuationLine;

						}

						i++;

					}

					

					// 将多个章节用逗号连接

					const chapter = chapters.join(', ');

					// 提取隐藏的原文注释
					let origin: string | undefined;
					const originMatch = desc.match(/<!--\s*origin:\s*(.+?)\s*-->/);
					if (originMatch) {
						origin = originMatch[1];
						// 剥离注释
						desc = desc.replace(/<!--\s*origin:\s*(.+?)\s*-->/g, '').trim();
					}

					items.push({ description: desc, chapter, origin });

					continue;

				}

				

				i++;

			}



			// 如果没有找到列表项，尝试从旧格式解析（H2 后的描述行）

			if (items.length === 0) {

				const descLines: string[] = [];

				let j = 1;

				while (j < lines.length && !lines[j].startsWith('**') && !lines[j].startsWith('- ')) {

					if (lines[j].trim()) descLines.push(lines[j].trim());

					j++;

				}

				const description = descLines.join('\n');

				if (description) {

					items.push({ description, chapter: '' });

				}

			}



			const finalItems = items.length > 0 ? items : [{ description: '', chapter: '' }];



			entries.push({

				time,

				description: finalItems.map(it => it.description).filter(Boolean).join('\n'),

				chapter: finalItems.map(it => it.chapter).filter(Boolean).join(', '),

				type: typeMatch ? typeMatch[1].trim() : '',

				rawBlock: trimmed,

				items: finalItems,

			});

		}



		return entries;

	}



	formatEntry(entry: TimelineEntry): string {

		const lines: string[] = [];

		lines.push(`## ${entry.time}`);

		lines.push('');



		const items = entry.items;

		if (items && items.length > 0) {

			for (const it of items) {

				// 处理多行描述：将每一行作为单独的列表项

				const descriptions = it.description ? it.description.split('\n').filter(line => line.trim()) : [];

				

				if (descriptions.length > 0) {

					// 第一行包含章节链接

					const firstLineParts: string[] = [descriptions[0]];

					

					// 支持多章节：将逗号分隔的章节转换为多个 [[链接]]

					if (it.chapter) {

						const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

						const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

						if (chapterLinks) firstLineParts.push(chapterLinks);

					}

					

					if (it.origin) {
						firstLineParts.push(`<!-- origin: ${it.origin} -->`);
					}

					lines.push(`- ${firstLineParts.join(' ')}`);

					// 后续行作为缩进的列表项（Markdown 多行列表项格式）

					for (let i = 1; i < descriptions.length; i++) {

						lines.push(`  ${descriptions[i]}`);

					}

				} else if (it.chapter) {

					// 只有章节链接，没有描述

					const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

					if (chapterLinks) lines.push(`- ${chapterLinks}`);

				}

			}

		} else {

			// 处理多行描述

			const descriptions = entry.description ? entry.description.split('\n').filter(line => line.trim()) : [];

			

			if (descriptions.length > 0) {

				const firstLineParts: string[] = [descriptions[0]];

				

				// 支持多章节

				if (entry.chapter) {
					const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
					if (chapterLinks) firstLineParts.push(chapterLinks);
				}

				if (entry.origin) {
					firstLineParts.push(`<!-- origin: ${entry.origin.replace(/\n/g, ' ')} -->`);
				}
				
				lines.push(`- ${firstLineParts.join(' ')}`);

				

				// 后续行作为缩进的列表项

				for (let i = 1; i < descriptions.length; i++) {

					lines.push(`  ${descriptions[i]}`);

				}

			} else if (entry.chapter) {

				// 只有章节链接

				const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

				const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

				if (chapterLinks) lines.push(`- ${chapterLinks}`);

			}

		}



		if (entry.type) {

			lines.push('');

			lines.push(`**${getTimelineLabel('type')}**：${entry.type}`);

		}

		lines.push('');

		lines.push('---');

		lines.push('');

		lines.push('');

		return lines.join('\n');

	}

	private resolveChapterFile(
		rawLink: string,
		folderPath: string,
		timelineFilePath: string,
		eligibleChapters: TFile[]
	): TFile | null {
		return ChapterSorter.resolveChapterFile(this.app, this.plugin, folderPath, rawLink, {
			eligibleChapters,
			sourcePath: timelineFilePath
		});
	}

	buildChapterToNodesMap(
		entries: TimelineEntry[],
		folderPath?: string,
		timelineFile?: TFile
	): { eligibleChapters: TFile[]; chapterPathToNodes: Map<string, string[]> } {
		const folder = this.normalizeFolderPath(folderPath);
		const tlFile = timelineFile || this.getTimelineFile(folder);
		const tlPath = tlFile ? tlFile.path : this.getTimelineFilePath(folder);

		const eligibleChapters = ChapterSorter.getAllChapters(this.app, this.plugin, folder);
		const chapterPathToNodes = new Map<string, string[]>();

		for (const entry of entries) {
			const nodeTime = entry.time?.trim();
			if (!nodeTime) continue;

			const rawLinks: string[] = [];
			if (entry.items && entry.items.length > 0) {
				for (const item of entry.items) {
					if (item.chapter) {
						const links = item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
						rawLinks.push(...links);
					}
				}
			} else if (entry.chapter) {
				const links = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
				rawLinks.push(...links);
			}

			for (const rawLink of rawLinks) {
				const targetFile = this.resolveChapterFile(rawLink, folder, tlPath, eligibleChapters);
				if (targetFile) {
					const list = chapterPathToNodes.get(targetFile.path) || [];
					if (!list.includes(nodeTime)) {
						list.push(nodeTime);
					}
					chapterPathToNodes.set(targetFile.path, list);
				}
			}
		}

		return { eligibleChapters, chapterPathToNodes };
	}

	isFrontMatterInSync(current: unknown, target: string[]): boolean {
		if (target.length === 0) {
			return current === undefined;
		}
		if (target.length === 1) {
			return typeof current === 'string' && current.trim() === target[0];
		}
		if (Array.isArray(current)) {
			if (current.length !== target.length) return false;
			return current.every((item, idx) => String(item).trim() === target[idx]);
		}
		return false;
	}

	async reconcileFrontmatter(
		folderPath?: string,
		entries?: TimelineEntry[] | null,
		timelineFile?: TFile
	): Promise<void> {
		const folder = this.normalizeFolderPath(folderPath);
		let currentEntries = entries;
		if (currentEntries === undefined) {
			currentEntries = await this.loadEntries(folder);
		}
		if (currentEntries === null) return;

		const { eligibleChapters, chapterPathToNodes } = this.buildChapterToNodesMap(
			currentEntries,
			folder,
			timelineFile
		);

		for (const file of eligibleChapters) {
			const targetNodes = chapterPathToNodes.get(file.path) || [];

			const cache = this.app.metadataCache?.getFileCache(file);
			const cachedTimeline: unknown = cache?.frontmatter ? (cache.frontmatter as Record<string, unknown>)['timeline'] : undefined;

			if (cache !== undefined && cache !== null && this.isFrontMatterInSync(cachedTimeline, targetNodes)) {
				continue;
			}

			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				const currentTimeline = fm['timeline'];
				if (this.isFrontMatterInSync(currentTimeline, targetNodes)) {
					return;
				}

				if (targetNodes.length === 0) {
					delete fm['timeline'];
				} else if (targetNodes.length === 1) {
					fm['timeline'] = targetNodes[0];
				} else {
					fm['timeline'] = targetNodes;
				}
			});
		}
	}

	async appendEntry(entry: TimelineEntry, folderPath?: string): Promise<string> {
			const folder = this.normalizeFolderPath(folderPath);
			return this.writer.enqueue(async () => {
			let file = this.getTimelineFile(folder);
			if (!file) file = await this.createTimelineFile(folder);

			let finalContent = '';
			await this.app.vault.process(file, (existing) => {
				const headerPattern = new RegExp(
					`(## ${escapeRegex(entry.time)}\\n)([\\s\\S]*?)(\\n---\\n|\\n*$)`,
					'm'
				);
				const match = headerPattern.exec(existing);

				let newContent: string;
				if (match) {
					const fullMatch = match[0];
					const header = match[1];
					const body = match[2];
					const separator = match[3];

					const descriptions = entry.description ? entry.description.split('\n').filter(line => line.trim()) : [];
					const newItemLines: string[] = [];

					if (descriptions.length > 0) {
						const firstLineParts: string[] = [descriptions[0]];
						if (entry.chapter) {
							const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
							const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
							if (chapterLinks) firstLineParts.push(chapterLinks);
						}
						if (entry.origin) {
							firstLineParts.push(`<!-- origin: ${entry.origin.replace(/\n/g, ' ')} -->`);
						}
						newItemLines.push(`- ${firstLineParts.join(' ')}`);

						for (let i = 1; i < descriptions.length; i++) {
							newItemLines.push(`  ${descriptions[i]}`);
						}
					} else if (entry.chapter) {
						const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
						const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
						if (chapterLinks) newItemLines.push(`- ${chapterLinks}`);
					}

					let boldIndex = body.indexOf(`\n**${getTimelineLabel('type')}**`);
					if (boldIndex === -1) boldIndex = body.indexOf('\n**类型**');
					if (boldIndex === -1) boldIndex = body.indexOf('\n**Type**');

					let newBody: string;
					if (newItemLines.length > 0) {
						const newItemText = newItemLines.join('\n');
						if (boldIndex !== -1) {
							newBody = body.slice(0, boldIndex) + '\n' + newItemText + body.slice(boldIndex);
						} else {
							newBody = body.trimEnd() + '\n' + newItemText + '\n';
						}
					} else {
						newBody = body;
					}

					newContent = existing.replace(fullMatch, header + newBody + separator);
				} else {
					const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';
					newContent = existing + sep + this.formatEntry(entry);
				}

				finalContent = newContent;
				return newContent;
			});
			const entries = this.parseEntries(finalContent);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
			});
		}


	async updateEntry(index: number, updated: TimelineEntry, folderPath?: string): Promise<string> {
			const folder = this.normalizeFolderPath(folderPath);
			return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);

			if (!file) return '';

			const entries = await this.loadEntries(folder);

			if (!entries) return '';

			entries[index] = updated;

			const finalContent = await this.writeAllEntries(file, entries);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
			});
		}


	async deleteEntry(index: number, folderPath?: string): Promise<string> {
			const folder = this.normalizeFolderPath(folderPath);
			return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);

			if (!file) return '';

			const entries = await this.loadEntries(folder);

			if (!entries) return '';

			entries.splice(index, 1);

			const finalContent = await this.writeAllEntries(file, entries);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
			});
		}


	async moveEntry(fromIndex: number, toIndex: number, folderPath?: string): Promise<string> {
			const folder = this.normalizeFolderPath(folderPath);
			return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);

			if (!file) return '';

			const entries = await this.loadEntries(folder);

			if (!entries) return '';

			const [moved] = entries.splice(fromIndex, 1);

			entries.splice(toIndex, 0, moved);

			const finalContent = await this.writeAllEntries(file, entries);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
			});
		}

	async moveEventItem(sourceTime: string, sourceItemIndex: number, targetTime: string, targetItemIndex?: number, folderPath?: string): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			const entries = await this.loadEntries(folder);
			if (!entries) return '';

			const sourceEntry = entries.find(e => e.time === sourceTime);
			const targetEntry = entries.find(e => e.time === targetTime);
			if (!sourceEntry || !targetEntry) return '';
			if (!sourceEntry.items || sourceItemIndex < 0 || sourceItemIndex >= sourceEntry.items.length) return '';

			const [movedItem] = sourceEntry.items.splice(sourceItemIndex, 1);
			sourceEntry.chapter = sourceEntry.items.map(it => it.chapter).filter(Boolean).join(', ');
			
			if (sourceEntry.items.length === 0) {
				entries.splice(entries.indexOf(sourceEntry), 1);
			}

			if (!targetEntry.items) targetEntry.items = [];
			let insertIndex = (targetItemIndex !== undefined && targetItemIndex >= 0) ? targetItemIndex : targetEntry.items.length;
			if (sourceEntry === targetEntry && sourceItemIndex < insertIndex) {
				insertIndex--;
			}
			targetEntry.items.splice(insertIndex, 0, movedItem);
			targetEntry.chapter = targetEntry.items.map(it => it.chapter).filter(Boolean).join(', ');

			const finalContent = await this.writeAllEntries(file, entries);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
		});
	}

	async syncChapterToEventItem(
		chapterTarget: string | TFile,
		targetEvents: { time: string, itemIndex?: number }[],
		folderPath?: string
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			const entries = await this.loadEntries(folder);
			if (!entries) return '';

			const eligibleChapters = ChapterSorter.getAllChapters(this.app, this.plugin, folder);
			let targetFile: TFile | null = null;

			if (chapterTarget instanceof TFile) {
				targetFile = chapterTarget;
			} else if (typeof chapterTarget === 'string') {
				targetFile = this.resolveChapterFile(chapterTarget, folder, file.path, eligibleChapters);
			}

			if (!targetFile) {
				// 无法唯一确定目标章节文件时，不得修改任何已有关联
				return await this.app.vault.cachedRead(file);
			}

			// 计算插入链接时使用的文本：有重名时使用相对路径，无重名使用 basename
			const linkTextToAdd = ChapterSorter.generateChapterLinktext(
				this.app,
				this.plugin,
				targetFile,
				folder,
				{ sourcePath: file.path, eligibleChapters }
			);

			const isLinkMatching = (link: string): boolean => {
				const resolved = this.resolveChapterFile(link, folder, file.path, eligibleChapters);
				return resolved !== null && resolved.path === targetFile.path;
			};

			// 1. Remove from all entries
			for (const entry of entries) {
				if (entry.items) {
					for (const item of entry.items) {
						if (item.chapter) {
							const chapters = item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
							const newChapters = chapters.filter(c => !isLinkMatching(c));
							item.chapter = newChapters.join(', ');
						}
					}
					entry.chapter = entry.items.map(it => it.chapter).filter(Boolean).join(', ');
				} else if (entry.chapter) {
					const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
					const newChapters = chapters.filter(c => !isLinkMatching(c));
					entry.chapter = newChapters.join(', ');
				}
			}

			// 2. Add to target events
			for (const target of targetEvents) {
				const entry = entries.find(e => e.time === target.time);
				if (entry) {
					if (!entry.items || entry.items.length === 0) {
						entry.items = [{ description: entry.description, chapter: '' }];
					}
					
					const itemIdx = target.itemIndex !== undefined && target.itemIndex >= 0 && target.itemIndex < entry.items.length 
						? target.itemIndex 
						: 0; // Default to first item
						
					const item = entry.items[itemIdx];
					const chapters = item.chapter ? item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];
					
					// Compare using isLinkMatching to avoid adding duplicate links
					const exists = chapters.some(c => isLinkMatching(c));
					if (!exists) {
						chapters.push(linkTextToAdd);
					}
					item.chapter = chapters.join(', ');
					
					entry.chapter = entry.items.map(it => it.chapter).filter(Boolean).join(', ');
				}
			}

			const finalContent = await this.writeAllEntries(file, entries);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
		});
	}

	async writeAllEntries(file: TFile, entries: TimelineEntry[]): Promise<string> {
		let finalContent = '';
		await this.app.vault.process(file, (_existing) => {
			let content = '';
			for (const entry of entries) {
				content += this.formatEntry(entry);
			}
			finalContent = content;
			return content;
		});
		return finalContent;
	}
}
