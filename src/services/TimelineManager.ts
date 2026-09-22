import type { App} from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import { t } from '../i18n';

import type { WebNovelAssistantPlugin } from '../types/plugin';

import { escapeRegex } from '../utils/validation';
import { getDefaultFileName, getDefaultFileNameCandidates, getTimelineLabel } from '../i18n/data-keys';

import { SerializedWriter } from '../utils/SerializedWriter';
import { ChapterSorter } from './ChapterSorter';



export interface TimelineItem {
	description: string;
	chapter: string;
	origin?: string;
	important?: boolean;
}

export interface TimelineEntry {
	time: string;
	description: string;
	chapter: string;
	type: string;
	rawBlock: string;
	origin?: string;
	important?: boolean;
	lores?: string[];
	items?: TimelineItem[];
}

export function parseLoreComment(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.map(x => String(x).trim()).filter(Boolean);
			}
		} catch {
			// Fallback to delimiter splitting
		}
	}
	return trimmed.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
}

export function formatLoreComment(lores: string[]): string {
	const clean = lores.map(l => l.trim()).filter(Boolean);
	if (clean.length === 0) return '';
	const needsJson = clean.some(l => l.includes(',') || l.includes('，') || l.includes(';') || l.includes('；'));
	const serialized = needsJson ? JSON.stringify(clean) : clean.join(', ');
	return `<!-- wn-lore: ${serialized} -->`;
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
							const entries = this.parseEntries(content, folderPath);
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
					const entries = this.parseEntries(content, folderPath);
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
		return this.parseEntries(content, folder);
	}

	private canonicalizeLoreList(lores: string[], folderPath?: string): string[] {
		if (!lores || lores.length === 0) return [];
		const bookPath = this.normalizeFolderPath(folderPath);
		return lores.map(name => {
			const entry = this.plugin?.characterManager?.getCharacterFile?.(bookPath, name);
			return entry ? entry.heading : name;
		});
	}

	parseEntries(content: string, folderPath?: string): TimelineEntry[] {
		const bookFolder = folderPath !== undefined ? this.normalizeFolderPath(folderPath) : this.currentFolder;
		const entries: TimelineEntry[] = [];
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed.startsWith('## ')) continue;

			const lines = trimmed.split('\n');
			const time = lines[0].replace(/^## /, '').trim();

			const items: TimelineItem[] = [];
			const nodeLores: string[] = [];

			// 匹配类型行：优先当前语言，兼容中文旧格式
			const typeMatch = trimmed.match(new RegExp(`\\*\\*(?:Type|类型|類型|${t('timeline.type-label')})\\*\\*：(.+)`));

			let i = 1;
			while (i < lines.length) {
				const line = lines[i];
				const trimmedLine = line.trim();

				// 跳过空行
				if (!trimmedLine) {
					i++;
					continue;
				}

				// 检查独立的块级设定注释
				const blockLoreMatch = trimmedLine.match(/^<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->$/);
				if (blockLoreMatch) {
					const rawLores = parseLoreComment(blockLoreMatch[1]);
					nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
					i++;
					continue;
				}

				// 跳过类型行（提取可能附带在类型行后的设定注释）
				if (line.startsWith('**')) {
					const lineLoreMatch = line.match(/<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->/);
					if (lineLoreMatch) {
						const rawLores = parseLoreComment(lineLoreMatch[1]);
						nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
					}
					i++;
					continue;
				}

				// 处理列表项
				if (line.startsWith('- ')) {
					let desc = line.slice(2);

					// 先收集后续的缩进行，再统一剖离隐藏元数据。
					// origin 等历史注释可能位于续行，不能只解析首行。
					i++;
					while (i < lines.length && lines[i].startsWith('  ') && !lines[i].startsWith('- ')) {
						const continuationLine = lines[i].slice(2);
						if (continuationLine.trim()) {
							desc += '\n' + continuationLine;
						}
						i++;
					}

					// 提取隐藏的重要标记
					let important = false;
					if (/<!--\s*wn-important\s*-->/.test(desc)) {
						important = true;
						desc = desc.replace(/<!--\s*wn-important\s*-->/g, '').trim();
					}

					// 向下兼容：提取子事件行内的隐藏设定关联并聚合至节点级
					const loreMatch = desc.match(/<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->/);
					if (loreMatch) {
						const rawLores = parseLoreComment(loreMatch[1]);
						nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
						desc = desc.replace(/<!--\s*(?:wn-lore|lore):\s*[\s\S]+?\s*-->/g, '').trim();
					}

					// 提取隐藏的原文注释
					let origin: string | undefined;
					const originMatch = desc.match(/<!--\s*origin:\s*([\s\S]+?)\s*-->/);
					if (originMatch) {
						origin = originMatch[1];
						desc = desc.replace(/<!--\s*origin:\s*[\s\S]+?\s*-->/g, '').trim();
					}

					// 提取所有 [[章节]] 链接
					const chapterMatches = desc.matchAll(/\[\[(.+?)\]\]/g);
					const chapters: string[] = [];
					for (const match of chapterMatches) {
						chapters.push(match[1]);
					}

					desc = desc
						.replace(/\[\[.+?\]\]/g, '')
						.split('\n')
						.map(text => text.trimEnd())
						.join('\n')
						.trim();

					const chapter = chapters.join(', ');

					items.push({
						description: desc,
						chapter,
						origin,
						important
					});
					continue;
				}

				i++;
			}

			// 如果没有找到列表项，尝试从旧格式解析（H2 后的描述行）
			if (items.length === 0) {
				const descLines: string[] = [];
				let j = 1;
				while (j < lines.length && !lines[j].startsWith('**') && !lines[j].startsWith('- ')) {
					const l = lines[j].trim();
					if (l) {
						const blockLoreMatch = l.match(/^<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->$/);
						if (blockLoreMatch) {
							const rawLores = parseLoreComment(blockLoreMatch[1]);
							nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
						} else {
							descLines.push(l);
						}
					}
					j++;
				}
				let description = descLines.join('\n');
				if (description) {
					let important = false;
					if (/<!--\s*wn-important\s*-->/.test(description)) {
						important = true;
						description = description.replace(/<!--\s*wn-important\s*-->/g, '').trim();
					}

					const loreMatch = description.match(/<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->/);
					if (loreMatch) {
						const rawLores = parseLoreComment(loreMatch[1]);
						nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
						description = description.replace(/<!--\s*(?:wn-lore|lore):\s*[\s\S]+?\s*-->/g, '').trim();
					}

					let origin: string | undefined;
					const originMatch = description.match(/<!--\s*origin:\s*([\s\S]+?)\s*-->/);
					if (originMatch) {
						origin = originMatch[1];
						description = description.replace(/<!--\s*origin:\s*[\s\S]+?\s*-->/g, '').trim();
					}

					const chapterMatches = description.matchAll(/\[\[(.+?)\]\]/g);
					const chapters: string[] = [];
					for (const match of chapterMatches) {
						chapters.push(match[1]);
					}
					if (chapters.length > 0) {
						description = description.replace(/\[\[.+?\]\]/g, '').trim();
					}

					items.push({
						description,
						chapter: chapters.join(', '),
						origin,
						important
					});
				}
			}

			const finalItems = items.length > 0 ? items : [{ description: '', chapter: '' }];
			const uniqueLores = [...new Set(nodeLores)];

			entries.push({
				time,
				description: finalItems.map(it => it.description).filter(Boolean).join('\n'),
				chapter: finalItems.map(it => it.chapter).filter(Boolean).join(', '),
				type: typeMatch ? typeMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '',
				rawBlock: trimmed,
				items: finalItems,
				lores: uniqueLores.length > 0 ? uniqueLores : undefined
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
				const descriptions = it.description ? it.description.split('\n').filter(line => line.trim()) : [];
				if (descriptions.length > 0) {
					const firstLineParts: string[] = [descriptions[0]];
					if (it.chapter) {
						const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
						const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
						if (chapterLinks) firstLineParts.push(chapterLinks);
					}
					if (it.important) {
						firstLineParts.push('<!-- wn-important -->');
					}
					if (it.origin) {
						firstLineParts.push(`<!-- origin: ${it.origin} -->`);
					}
					lines.push(`- ${firstLineParts.join(' ')}`);

					for (let i = 1; i < descriptions.length; i++) {
						lines.push(`  ${descriptions[i]}`);
					}
				} else if (it.chapter || it.origin || it.important) {
					const chapters = it.chapter ? it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];
					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
					const parts: string[] = [];
					if (chapterLinks) parts.push(chapterLinks);
					if (it.important) parts.push('<!-- wn-important -->');
					if (it.origin) parts.push(`<!-- origin: ${it.origin} -->`);
					if (parts.length > 0) lines.push(`- ${parts.join(' ')}`);
				}
			}
		} else {
			const descriptions = entry.description ? entry.description.split('\n').filter(line => line.trim()) : [];
			if (descriptions.length > 0) {
				const firstLineParts: string[] = [descriptions[0]];
				if (entry.chapter) {
					const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
					if (chapterLinks) firstLineParts.push(chapterLinks);
				}
				if (entry.important) {
					firstLineParts.push('<!-- wn-important -->');
				}
				if (entry.origin) {
					firstLineParts.push(`<!-- origin: ${entry.origin.replace(/\n/g, ' ')} -->`);
				}
				lines.push(`- ${firstLineParts.join(' ')}`);

				for (let i = 1; i < descriptions.length; i++) {
					lines.push(`  ${descriptions[i]}`);
				}
			} else if (entry.chapter || entry.origin || entry.important) {
				const chapters = entry.chapter ? entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];
				const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
				const parts: string[] = [];
				if (chapterLinks) parts.push(chapterLinks);
				if (entry.important) parts.push('<!-- wn-important -->');
				if (entry.origin) parts.push(`<!-- origin: ${entry.origin.replace(/\n/g, ' ')} -->`);
				if (parts.length > 0) lines.push(`- ${parts.join(' ')}`);
			}
		}

		if (entry.type) {
			lines.push('');
			lines.push(`**${getTimelineLabel('type')}**：${entry.type}`);
		}

		if (entry.lores && entry.lores.length > 0) {
			const comment = formatLoreComment(entry.lores);
			if (comment) {
				lines.push('');
				lines.push(comment);
			}
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
					const existingLores = [...body.matchAll(/<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->/g)]
						.flatMap(loreMatch => parseLoreComment(loreMatch[1]));
					const bodyWithoutLore = body.replace(/<!--\s*(?:wn-lore|lore):\s*[\s\S]+?\s*-->/g, '');

					const itemsToAppend: TimelineItem[] = (entry.items && entry.items.length > 0)
						? entry.items
						: [{ description: entry.description, chapter: entry.chapter, origin: entry.origin, important: entry.important }];
					const newItemLines: string[] = [];

					for (const it of itemsToAppend) {
						const descriptions = it.description ? it.description.split('\n').filter(line => line.trim()) : [];
						if (descriptions.length > 0) {
							const firstLineParts: string[] = [descriptions[0]];
							if (it.chapter) {
								const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
								const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
								if (chapterLinks) firstLineParts.push(chapterLinks);
							}
							if (it.important) {
								firstLineParts.push('<!-- wn-important -->');
							}
							if (it.origin) {
								firstLineParts.push(`<!-- origin: ${it.origin.replace(/\n/g, ' ')} -->`);
							}
							newItemLines.push(`- ${firstLineParts.join(' ')}`);

							for (let j = 1; j < descriptions.length; j++) {
								newItemLines.push(`  ${descriptions[j]}`);
							}
						} else if (it.chapter || it.origin || it.important) {
							const chapters = it.chapter ? it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];
							const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
							const parts: string[] = [];
							if (chapterLinks) parts.push(chapterLinks);
							if (it.important) parts.push('<!-- wn-important -->');
							if (it.origin) parts.push(`<!-- origin: ${it.origin.replace(/\n/g, ' ')} -->`);
							if (parts.length > 0) newItemLines.push(`- ${parts.join(' ')}`);
						}
					}

					let boldIndex = bodyWithoutLore.indexOf(`\n**${getTimelineLabel('type')}**`);
					if (boldIndex === -1) boldIndex = bodyWithoutLore.indexOf('\n**类型**');
					if (boldIndex === -1) boldIndex = bodyWithoutLore.indexOf('\n**類型**');
					if (boldIndex === -1) boldIndex = bodyWithoutLore.indexOf('\n**Type**');

					let newBody: string;
					if (newItemLines.length > 0) {
						const newItemText = newItemLines.join('\n');
						if (boldIndex !== -1) {
							newBody = bodyWithoutLore.slice(0, boldIndex) + '\n' + newItemText + bodyWithoutLore.slice(boldIndex);
						} else {
							newBody = bodyWithoutLore.trimEnd() + '\n' + newItemText + '\n';
						}
					} else {
						newBody = bodyWithoutLore;
					}

					const mergedLores = this.canonicalizeLoreList(
						[...new Set([...existingLores, ...(entry.lores || [])])],
						folder
					);
					if (mergedLores.length > 0) {
						newBody = newBody.trimEnd() + '\n\n' + formatLoreComment(mergedLores) + '\n';
					}

					newContent = existing.replace(fullMatch, header + newBody + separator);
				} else {
					const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';
					newContent = existing + sep + this.formatEntry(entry);
				}

				finalContent = newContent;
				return newContent;
			});
			const entries = this.parseEntries(finalContent, folder);
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
