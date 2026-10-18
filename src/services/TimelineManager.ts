import type { App } from 'obsidian';
import { TFile, normalizePath, Notice } from 'obsidian';
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
	type?: string;
}

export interface TimelineEntry {
	time: string;
	type?: string;
	description: string;
	chapter: string;
	rawBlock: string;
	origin?: string;
	important?: boolean;
	lores?: string[];
	items?: TimelineItem[];
}

export function timelineNodeKey(node: Pick<TimelineEntry, 'time' | 'type' | 'lores'>): string {
	const lores = [...new Set((node.lores || []).map(lore => lore.trim()).filter(Boolean))].sort();
	return JSON.stringify([node.time.trim(), node.type?.trim() || '', lores]);
}

export function filterTimelineEntries<T extends Pick<TimelineEntry, 'type' | 'lores'>>(
	entries: readonly T[],
	selectedTypes: readonly string[] | ReadonlySet<string> = [],
	selectedLores: readonly string[] | ReadonlySet<string> = []
): T[] {
	const typeSet = selectedTypes instanceof Set
		? selectedTypes
		: new Set(selectedTypes);
	const loreSet = selectedLores instanceof Set
		? selectedLores
		: new Set(selectedLores);

	const hasTypeFilter = typeSet.size > 0;
	const hasLoreFilter = loreSet.size > 0;

	if (!hasTypeFilter && !hasLoreFilter) {
		return [...entries];
	}

	return entries.filter(entry => {
		if (hasTypeFilter) {
			if (!entry.type || !typeSet.has(entry.type)) {
				return false;
			}
		}
		if (hasLoreFilter) {
			const entryLores = entry.lores || [];
			if (!entryLores.some(lore => loreSet.has(lore))) {
				return false;
			}
		}
		return true;
	});
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

export function parseTimelineChapterList(raw?: string | null): string[] {
	if (!raw || typeof raw !== 'string') return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
				return parsed.map(x => x.trim()).filter(Boolean);
			}
		} catch {
			// Fallback to delimiter splitting
		}
	}
	return trimmed.split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

export function serializeTimelineChapterList(chapters: string[]): string {
	const clean = chapters.map(chapter => chapter.trim()).filter(Boolean);
	if (clean.length === 0) return '';
	const needsJson = clean.some(c =>
		c.includes(',') ||
		c.includes('，') ||
		(c.startsWith('[') && c.endsWith(']'))
	);
	return needsJson ? JSON.stringify(clean) : clean.join(', ');
}

export function aggregateTimelineChapterLists(chapterLists: Array<string | undefined | null>): string {
	const chapters: string[] = [];
	for (const list of chapterLists) {
		if (!list) continue;
		chapters.push(...parseTimelineChapterList(list));
	}
	return serializeTimelineChapterList(chapters);
}



function deepCloneItem(item: TimelineItem): TimelineItem {
	return {
		description: item.description,
		chapter: item.chapter,
		origin: item.origin,
		important: item.important,
		type: item.type
	};
}

function deepCloneEntry(entry: TimelineEntry): TimelineEntry {
	return {
		time: entry.time,
		type: entry.type,
		description: entry.description,
		chapter: entry.chapter,
		rawBlock: entry.rawBlock,
		origin: entry.origin,
		important: entry.important,
		lores: entry.lores ? [...entry.lores] : undefined,
		items: entry.items ? entry.items.map(deepCloneItem) : undefined
	};
}

function deepFreezeEntry<T extends TimelineEntry | TimelineItem>(obj: T): Readonly<T> {
	if (!obj || typeof obj !== 'object') return obj;
	Object.freeze(obj);
	if ('items' in obj && Array.isArray(obj.items)) {
		obj.items?.forEach(it => {
			if (it && typeof it === 'object') Object.freeze(it);
		});
		Object.freeze(obj.items);
	}
	if ('lores' in obj && Array.isArray(obj.lores)) {
		Object.freeze(obj.lores);
	}
	return obj;
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
		if (!content || typeof content !== 'string') return [];
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
		if (!content || typeof content !== 'string') return [];
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
			const blockTypes: string[] = [];
			let currentType: string = '';
			let firstTypeLineIndex = -1;
			let lastItemLineIndex = -1;

			// 匹配类型行：优先当前语言，兼容中文旧格式
			const typeLabel = t('timeline.type-label');
			const typeRegex = new RegExp(`^\\*\\*(?:Type|类型|類型|${escapeRegex(typeLabel)})\\*\\*[:：]\\s*(.*)$`);

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

				// 检查类型行
				const typeMatch = trimmedLine.match(typeRegex);
				if (typeMatch) {
					if (firstTypeLineIndex === -1) firstTypeLineIndex = i;
					let typeVal = typeMatch[1].trim();
					const lineLoreMatch = typeVal.match(/<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->/);
					if (lineLoreMatch) {
						const rawLores = parseLoreComment(lineLoreMatch[1]);
						nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
						typeVal = typeVal.replace(/<!--\s*(?:wn-lore|lore):\s*[\s\S]+?\s*-->/g, '').trim();
					}
					currentType = typeVal;
					if (typeVal && !blockTypes.includes(typeVal)) {
						blockTypes.push(typeVal);
					}
					i++;
					continue;
				}

				// 跳过其他 ** 标记行（提取可能附带在行后的设定注释）
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
					lastItemLineIndex = i;
					let desc = line.slice(2);

					// 先收集后续的缩进行，再统一剖离隐藏元数据。
					// origin 等历史注释可能位于续行，不能只解析首行。
					i++;
					while (i < lines.length && lines[i].startsWith('  ') && !lines[i].startsWith('- ')) {
						lastItemLineIndex = i;
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

					const chapter = serializeTimelineChapterList(chapters);

					items.push({
						description: desc,
						chapter,
						origin,
						important,
						type: firstTypeLineIndex >= 0 ? currentType : undefined
					});
					continue;
				}

				i++;
			}

			// 检查是否为旧格式（类型在列表项之后/底部，或者没有列表项）
			const isBottomLegacyType = firstTypeLineIndex !== -1 && (lastItemLineIndex === -1 || firstTypeLineIndex > lastItemLineIndex);
			const primaryType = blockTypes[0] || '';

			if (isBottomLegacyType && primaryType) {
				for (const it of items) {
					if (!it.type) it.type = primaryType;
				}
			} else if (firstTypeLineIndex !== -1) {
				for (const it of items) {
					if (it.type === undefined) it.type = '';
				}
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
						chapter: serializeTimelineChapterList(chapters),
						origin,
						important,
						type: primaryType || undefined
					});
				}
			}

			const finalItems = items.length > 0 ? items : [{ description: '', chapter: '', type: primaryType || undefined }];
			const uniqueLores = [...new Set(nodeLores)];
			// Older event-level files may contain several type sections in one block.
			// Expose each section as its own node; subsequent writes use the node format.
			const groups = new Map<string, TimelineItem[]>();
			for (const item of finalItems) {
				const type = item.type || '';
				const { type: _legacyType, ...nodeItem } = item;
				const group = groups.get(type) || [];
				group.push(nodeItem);
				groups.set(type, group);
			}
			for (const [type, groupItems] of groups) {
				entries.push({
					time,
					type,
					description: groupItems.map(it => it.description).filter(Boolean).join('\n'),
					chapter: aggregateTimelineChapterLists(groupItems.map(it => it.chapter)),
					rawBlock: trimmed,
					items: groupItems,
					lores: uniqueLores.length > 0 ? uniqueLores : undefined
				});
			}
		}

		return entries;
	}

	formatEntry(entry: TimelineEntry): string {
		const lines: string[] = [];
		lines.push(`## ${entry.time}`);
		lines.push('');
		if (entry.type) {
			lines.push(`**${getTimelineLabel('type')}**：${entry.type}`);
			lines.push('');
		}

		const items = entry.items && entry.items.length > 0
			? entry.items
			: [{
				description: entry.description,
				chapter: entry.chapter,
				origin: entry.origin,
				important: entry.important
			}];

		for (const it of items) {
			const descriptions = it.description ? it.description.split('\n').filter(line => line.trim()) : [];
			if (descriptions.length > 0) {
				const firstLineParts: string[] = [descriptions[0]];
				if (it.chapter) {
					const chapters = parseTimelineChapterList(it.chapter);
					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
					if (chapterLinks) firstLineParts.push(chapterLinks);
				}
				if (it.important) {
					firstLineParts.push('<!-- wn-important -->');
				}
				if (it.origin) {
					firstLineParts.push(`<!-- origin: ${it.origin.replace(/\n/g, ' ')} -->`);
				}
				lines.push(`- ${firstLineParts.join(' ')}`);

				for (let i = 1; i < descriptions.length; i++) {
					lines.push(`  ${descriptions[i]}`);
				}
			} else if (it.chapter || it.origin || it.important) {
				const chapters = it.chapter ? parseTimelineChapterList(it.chapter) : [];
				const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
				const parts: string[] = [];
				if (chapterLinks) parts.push(chapterLinks);
				if (it.important) parts.push('<!-- wn-important -->');
				if (it.origin) parts.push(`<!-- origin: ${it.origin.replace(/\n/g, ' ')} -->`);
				if (parts.length > 0) lines.push(`- ${parts.join(' ')}`);
			}
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

	findEntryHeadingOffset(content: string, entryIndex: number, folderPath?: string): number | undefined {
		const headings = [...content.matchAll(/^## .+$/gm)];
		let index = 0;
		for (let i = 0; i < headings.length; i++) {
			const start = headings[i].index;
			const nextHeading = headings[i + 1]?.index ?? content.length;
			const separator = content.indexOf('\n---\n', start);
			const end = separator >= 0 && separator < nextHeading ? separator + '\n---\n'.length : nextHeading;
			const count = this.parseEntries(content.slice(start, end), folderPath).length;
			if (entryIndex < index + count) return start;
			index += count;
		}
		return undefined;
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
		const referenceIndex = ChapterSorter.createReferenceIndex(this.app, this.plugin, folder, {
			eligibleChapters,
			sourcePath: tlPath
		});
		const chapterPathToNodes = new Map<string, string[]>();

		for (const entry of entries) {
			const nodeTime = entry.time?.trim();
			if (!nodeTime) continue;

			const rawLinks: string[] = [];
			if (entry.items && entry.items.length > 0) {
				for (const item of entry.items) {
					if (item.chapter) {
						const links = parseTimelineChapterList(item.chapter);
						rawLinks.push(...links);
					}
				}
			} else if (entry.chapter) {
				const links = parseTimelineChapterList(entry.chapter);
				rawLinks.push(...links);
			}

			for (const rawLink of rawLinks) {
				const targetFile = referenceIndex.resolve(rawLink);
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
		const canonicalEntry = { ...entry, lores: this.canonicalizeLoreList(entry.lores || [], folder) };
		const frozenCanonicalEntry = deepFreezeEntry(deepCloneEntry(canonicalEntry));

		return this.writer.enqueue(async () => {
			let file = this.getTimelineFile(folder);
			if (!file) file = await this.createTimelineFile(folder);

			let finalContent = '';
			await this.app.vault.process(file, (existing) => {
				const headings = [...existing.matchAll(/^## (.+)$/gm)];
				let lastSameTimeEnd = -1;
				for (let i = 0; i < headings.length; i++) {
					const heading = headings[i];
					if (heading[1].trim() !== frozenCanonicalEntry.time) continue;
					const start = heading.index;
					const nextHeading = headings[i + 1]?.index ?? existing.length;
					const separator = existing.indexOf('\n---\n', start);
					const end = separator >= 0 && separator < nextHeading ? separator + '\n---\n'.length : nextHeading;
					lastSameTimeEnd = end;
					const matchingEntries = this.parseEntries(existing.slice(start, end), folder);
					const match = matchingEntries.find(candidate => timelineNodeKey(candidate) === timelineNodeKey(frozenCanonicalEntry));
					if (!match) continue;

					const existingItems = (match.items || []).filter(it => it.description || it.chapter || it.origin || it.important);
					const incomingItems = frozenCanonicalEntry.items?.length
						? frozenCanonicalEntry.items.map(deepCloneItem)
						: [{ description: frozenCanonicalEntry.description, chapter: frozenCanonicalEntry.chapter, origin: frozenCanonicalEntry.origin, important: frozenCanonicalEntry.important }];
					match.items = [...existingItems, ...incomingItems];
					finalContent = existing.slice(0, start) + matchingEntries.map(candidate => this.formatEntry(candidate)).join('') + existing.slice(end);
					return finalContent;
				}
				const insertion = lastSameTimeEnd >= 0 ? lastSameTimeEnd : existing.length;
				const prefix = existing.slice(0, insertion);
				const separator = prefix && !prefix.endsWith('\n') ? '\n' : '';
				finalContent = prefix + separator + this.formatEntry(deepCloneEntry(frozenCanonicalEntry)) + existing.slice(insertion);
				return finalContent;
			});
			const entries = this.parseEntries(finalContent, folder);
			await this.reconcileFrontmatter(folder, entries, file);
			return finalContent;
		});
	}

	private normalizeForSnapshot(entry: TimelineEntry): TimelineEntry {
		const lores = entry.lores && entry.lores.length > 0
			? [...new Set(entry.lores.map(l => l.trim()).filter(Boolean))].sort()
			: undefined;

		const items = entry.items && entry.items.length > 0
			? entry.items.map(it => ({
				description: (it.description || '').trim(),
				chapter: serializeTimelineChapterList(parseTimelineChapterList(it.chapter)),
				origin: it.origin?.trim() || undefined,
				important: !!it.important,
				type: it.type?.trim() || undefined
			}))
			: [{
				description: (entry.description || '').trim(),
				chapter: serializeTimelineChapterList(parseTimelineChapterList(entry.chapter)),
				origin: entry.origin?.trim() || undefined,
				important: !!entry.important
			}];

		return {
			time: (entry.time || '').trim(),
			type: (entry.type || '').trim() || undefined,
			description: (entry.description || '').trim(),
			chapter: serializeTimelineChapterList(parseTimelineChapterList(entry.chapter)),
			rawBlock: '',
			origin: entry.origin?.trim() || undefined,
			important: !!entry.important,
			lores,
			items
		};
	}

	private matchesEntry(candidate: TimelineEntry, expected: TimelineEntry): boolean {
		return this.formatEntry(this.normalizeForSnapshot(candidate)).trim() ===
			this.formatEntry(this.normalizeForSnapshot(expected)).trim();
	}

	private resolveTargetIndex(
		entries: TimelineEntry[],
		index: number,
		expectedEntry?: TimelineEntry
	): number {
		if (expectedEntry) {
			if (Number.isInteger(index) && index >= 0 && index < entries.length && this.matchesEntry(entries[index], expectedEntry)) {
				return index;
			}
			const matchingIndices: number[] = [];
			for (let i = 0; i < entries.length; i++) {
				if (this.matchesEntry(entries[i], expectedEntry)) {
					matchingIndices.push(i);
				}
			}

			if (matchingIndices.length === 1) {
				return matchingIndices[0];
			}

			return -1;
		}

		if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
			return -1;
		}
		return index;
	}

	async updateEntry(index: number, updated: TimelineEntry, folderPath?: string, expectedEntry?: TimelineEntry): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const canonicalUpdated = { ...updated, lores: this.canonicalizeLoreList(updated.lores || [], folder) };
		const frozenUpdated = deepFreezeEntry(deepCloneEntry(canonicalUpdated));
		const frozenExpected = expectedEntry ? deepFreezeEntry(deepCloneEntry(expectedEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			let finalContent = '';
			let writeSuccess = false;

			await this.app.vault.process(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const targetIndex = this.resolveTargetIndex(latestEntries, index, frozenExpected);

				if (targetIndex === -1) {
					if (frozenExpected) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}

				const clonedPayload = deepCloneEntry(frozenUpdated);
				latestEntries[targetIndex] = clonedPayload;
				const mergeIndex = latestEntries.findIndex((candidate, candidateIndex) =>
					candidateIndex !== targetIndex && timelineNodeKey(candidate) === timelineNodeKey(clonedPayload)
				);
				if (mergeIndex >= 0) {
					const target = latestEntries[mergeIndex];
					const targetItems = (target.items || []).filter(item => item.description || item.chapter || item.origin || item.important);
					const updatedItems = (clonedPayload.items || []).filter(item => item.description || item.chapter || item.origin || item.important);
					target.items = [...targetItems, ...updatedItems];
					latestEntries.splice(targetIndex, 1);
				}

				let content = '';
				for (const entry of latestEntries) {
					content += this.formatEntry(entry);
				}
				finalContent = content;
				writeSuccess = true;
				return content;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

	async deleteEntry(index: number, folderPath?: string, expectedEntry?: TimelineEntry): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenExpected = expectedEntry ? deepFreezeEntry(deepCloneEntry(expectedEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			let finalContent = '';
			let writeSuccess = false;

			await this.app.vault.process(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const targetIndex = this.resolveTargetIndex(latestEntries, index, frozenExpected);

				if (targetIndex === -1) {
					if (frozenExpected) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}

				latestEntries.splice(targetIndex, 1);

				let content = '';
				for (const entry of latestEntries) {
					content += this.formatEntry(entry);
				}
				finalContent = content;
				writeSuccess = true;
				return content;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

	async moveEntry(
		fromIndex: number,
		toIndex: number,
		folderPath?: string,
		expectedEntry?: TimelineEntry,
		expectedTargetEntry?: TimelineEntry
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenExpectedFrom = expectedEntry ? deepFreezeEntry(deepCloneEntry(expectedEntry)) : undefined;
		const frozenExpectedTo = expectedTargetEntry ? deepFreezeEntry(deepCloneEntry(expectedTargetEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			let finalContent = '';
			let writeSuccess = false;

			await this.app.vault.process(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const actualFromIndex = this.resolveTargetIndex(latestEntries, fromIndex, frozenExpectedFrom);
				if (actualFromIndex === -1) {
					if (frozenExpectedFrom) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}

				let actualToIndex = -1;
				if (frozenExpectedTo) {
					actualToIndex = this.resolveTargetIndex(latestEntries, toIndex, frozenExpectedTo);
					if (actualToIndex === -1) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
				} else {
					if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= latestEntries.length) {
						finalContent = existing;
						return existing;
					}
					actualToIndex = toIndex;
				}

				if (actualFromIndex === actualToIndex) {
					finalContent = existing;
					return existing;
				}

				const [moved] = latestEntries.splice(actualFromIndex, 1);
				latestEntries.splice(actualToIndex, 0, moved);

				let content = '';
				for (const entry of latestEntries) {
					content += this.formatEntry(entry);
				}
				finalContent = content;
				writeSuccess = true;
				return content;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

	async moveEventItem(
		sourceNode: number | string,
		sourceItemIndex: number,
		targetNode: number | string,
		targetItemIndex?: number,
		folderPath?: string,
		expectedItem?: TimelineItem,
		expectedSourceEntry?: TimelineEntry,
		expectedTargetEntry?: TimelineEntry
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenExpectedItem = expectedItem ? deepFreezeEntry(deepCloneItem(expectedItem)) : undefined;
		const frozenSourceEntry = expectedSourceEntry ? deepFreezeEntry(deepCloneEntry(expectedSourceEntry)) : undefined;
		const frozenTargetEntry = expectedTargetEntry ? deepFreezeEntry(deepCloneEntry(expectedTargetEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			let finalContent = '';
			let writeSuccess = false;

			await this.app.vault.process(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);

				let sourceIndex = -1;
				if (typeof sourceNode === 'number') {
					sourceIndex = this.resolveTargetIndex(latestEntries, sourceNode, frozenSourceEntry);
				} else if (typeof sourceNode === 'string') {
					if (frozenSourceEntry) {
						const matches: number[] = [];
						for (let i = 0; i < latestEntries.length; i++) {
							if (this.matchesEntry(latestEntries[i], frozenSourceEntry)) {
								matches.push(i);
							}
						}
						if (matches.length === 1) sourceIndex = matches[0];
					} else {
						const matches = latestEntries
							.map((e, idx) => e.time === sourceNode ? idx : -1)
							.filter(idx => idx >= 0);
						if (matches.length === 1) sourceIndex = matches[0];
					}
				}

				if (sourceIndex === -1) {
					if (frozenSourceEntry || frozenExpectedItem) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}
				const sourceEntry = latestEntries[sourceIndex];

				let targetIndex = -1;
				if (typeof targetNode === 'number') {
					targetIndex = this.resolveTargetIndex(latestEntries, targetNode, frozenTargetEntry);
				} else if (typeof targetNode === 'string') {
					if (frozenTargetEntry) {
						const matches: number[] = [];
						for (let i = 0; i < latestEntries.length; i++) {
							if (this.matchesEntry(latestEntries[i], frozenTargetEntry)) {
								matches.push(i);
							}
						}
						if (matches.length === 1) targetIndex = matches[0];
					} else {
						const matches = latestEntries
							.map((e, idx) => e.time === targetNode ? idx : -1)
							.filter(idx => idx >= 0);
						if (matches.length === 1) targetIndex = matches[0];
					}
				}

				if (targetIndex === -1) {
					if (frozenTargetEntry || frozenExpectedItem) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}
				const targetEntry = latestEntries[targetIndex];

				if (!sourceEntry.items || sourceEntry.items.length === 0) {
					finalContent = existing;
					return existing;
				}

				let actualSourceItemIndex = -1;
				if (frozenExpectedItem) {
					const itemMatches: number[] = [];
					for (let i = 0; i < sourceEntry.items.length; i++) {
						const it = sourceEntry.items[i];
						if (
							it.description === frozenExpectedItem.description &&
							(it.chapter || '') === (frozenExpectedItem.chapter || '') &&
							it.origin === frozenExpectedItem.origin &&
							!!it.important === !!frozenExpectedItem.important
						) {
							itemMatches.push(i);
						}
					}
					if (Number.isInteger(sourceItemIndex) && sourceItemIndex >= 0 && itemMatches.includes(sourceItemIndex)) {
						actualSourceItemIndex = sourceItemIndex;
					} else if (itemMatches.length === 1) {
						actualSourceItemIndex = itemMatches[0];
					} else {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
				} else {
					if (!Number.isInteger(sourceItemIndex) || sourceItemIndex < 0 || sourceItemIndex >= sourceEntry.items.length) {
						finalContent = existing;
						return existing;
					}
					actualSourceItemIndex = sourceItemIndex;
				}

				let insertIndex = targetEntry.items ? targetEntry.items.length : 0;
				if (targetItemIndex !== undefined) {
					if (!Number.isInteger(targetItemIndex) || targetItemIndex < 0) {
						finalContent = existing;
						return existing;
					}
					insertIndex = targetItemIndex;
				}

				if (sourceEntry === targetEntry) {
					let adjustedInsert = insertIndex;
					if (actualSourceItemIndex < adjustedInsert) adjustedInsert--;
					if (actualSourceItemIndex === adjustedInsert) {
						let content = '';
						for (const entry of latestEntries) {
							content += this.formatEntry(entry);
						}
						finalContent = content;
						writeSuccess = true;
						return content;
					}
				}

				const [movedItem] = sourceEntry.items.splice(actualSourceItemIndex, 1);
				sourceEntry.chapter = aggregateTimelineChapterLists(sourceEntry.items.map(it => it.chapter));

				// Do not remove sourceEntry when source===target and it temporarily has zero items
				if (sourceEntry !== targetEntry && sourceEntry.items.length === 0) {
					latestEntries.splice(latestEntries.indexOf(sourceEntry), 1);
				}

				if (!targetEntry.items) targetEntry.items = [];
				if (sourceEntry === targetEntry && actualSourceItemIndex < insertIndex) {
					insertIndex--;
				}
				if (insertIndex > targetEntry.items.length) {
					insertIndex = targetEntry.items.length;
				}
				targetEntry.items.splice(insertIndex, 0, movedItem);
				targetEntry.chapter = aggregateTimelineChapterLists(targetEntry.items.map(it => it.chapter));

				let content = '';
				for (const entry of latestEntries) {
					content += this.formatEntry(entry);
				}
				finalContent = content;
				writeSuccess = true;
				return content;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

	async syncChapterToEventItem(
		chapterTarget: string | TFile,
		targetEvents: { time?: string, entryIndex?: number, itemIndex?: number, expectedEntry?: TimelineEntry }[],
		folderPath?: string
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenTargetEvents = targetEvents.map(target => ({
			...target,
			expectedEntry: target.expectedEntry ? deepFreezeEntry(deepCloneEntry(target.expectedEntry)) : undefined
		}));

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			const eligibleChapters = ChapterSorter.getAllChapters(this.app, this.plugin, folder);
			const referenceIndex = ChapterSorter.createReferenceIndex(this.app, this.plugin, folder, {
				eligibleChapters,
				sourcePath: file.path
			});
			let targetFile: TFile | null = null;

			if (chapterTarget instanceof TFile) {
				targetFile = chapterTarget;
			} else if (typeof chapterTarget === 'string') {
				targetFile = referenceIndex.resolve(chapterTarget);
			}

			if (!targetFile) {
				return await this.app.vault.cachedRead(file);
			}

			const linkTextToAdd = ChapterSorter.generateChapterLinktext(
				this.app,
				this.plugin,
				targetFile,
				folder,
				{ sourcePath: file.path, eligibleChapters }
			);

			const isLinkMatching = (link: string): boolean => {
				const resolved = referenceIndex.resolve(link);
				return resolved !== null && resolved.path === targetFile.path;
			};

			let finalContent = '';
			let writeSuccess = false;

			await this.app.vault.process(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);

				// STEP 1: If targetEvents is not empty, resolve and validate ALL targets BEFORE removing any links!
				interface ResolvedTarget {
					entry: TimelineEntry;
					itemIndex: number;
				}
				const resolvedTargets: ResolvedTarget[] = [];

				for (const target of frozenTargetEvents) {
					let matchedEntry: TimelineEntry | undefined;
					if (target.expectedEntry) {
						const resolvedIdx = this.resolveTargetIndex(
							latestEntries,
							target.entryIndex !== undefined ? target.entryIndex : -1,
							target.expectedEntry
						);
						if (resolvedIdx === -1) {
							new Notice(t('timeline.conflict-notice'));
							throw new Error(t('timeline.conflict-notice'));
						}
						matchedEntry = latestEntries[resolvedIdx];
					} else {
						if (target.entryIndex !== undefined) {
							if (!Number.isInteger(target.entryIndex) || target.entryIndex < 0 || target.entryIndex >= latestEntries.length) {
								new Notice(t('timeline.conflict-notice'));
								throw new Error(t('timeline.conflict-notice'));
							}
							matchedEntry = latestEntries[target.entryIndex];
						} else if (target.time) {
							const matches = latestEntries.filter(e => e.time === target.time);
							if (matches.length === 1) {
								matchedEntry = matches[0];
							} else {
								new Notice(t('timeline.conflict-notice'));
								throw new Error(t('timeline.conflict-notice'));
							}
						}
					}

					if (!matchedEntry) {
						new Notice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}

					if (!matchedEntry.items || matchedEntry.items.length === 0) {
						matchedEntry.items = [{ description: matchedEntry.description, chapter: '' }];
					}

					let itemIdx = 0;
					if (target.itemIndex !== undefined) {
						if (!Number.isInteger(target.itemIndex) || target.itemIndex < 0 || target.itemIndex >= matchedEntry.items.length) {
							new Notice(t('timeline.conflict-notice'));
							throw new Error(t('timeline.conflict-notice'));
						}
						itemIdx = target.itemIndex;
					}

					resolvedTargets.push({
						entry: matchedEntry,
						itemIndex: itemIdx
					});
				}

				// STEP 2: Only after all targets are verified, remove existing links from all entries
				for (const entry of latestEntries) {
					if (entry.items) {
						for (const item of entry.items) {
							if (item.chapter) {
								const chapters = parseTimelineChapterList(item.chapter);
								const newChapters = chapters.filter(c => !isLinkMatching(c));
								item.chapter = serializeTimelineChapterList(newChapters);
							}
						}
						entry.chapter = aggregateTimelineChapterLists(entry.items.map(it => it.chapter));
					} else if (entry.chapter) {
						const chapters = parseTimelineChapterList(entry.chapter);
						const newChapters = chapters.filter(c => !isLinkMatching(c));
						entry.chapter = serializeTimelineChapterList(newChapters);
					}
				}

				// STEP 3: Add link to the validated targets
				for (const { entry, itemIndex } of resolvedTargets) {
					const item = entry.items![itemIndex];
					const chapters = item.chapter ? parseTimelineChapterList(item.chapter) : [];
					if (!chapters.some(c => isLinkMatching(c))) {
						chapters.push(linkTextToAdd);
					}
					item.chapter = serializeTimelineChapterList(chapters);
					entry.chapter = aggregateTimelineChapterLists(entry.items!.map(it => it.chapter));
				}

				let content = '';
				for (const entry of latestEntries) {
					content += this.formatEntry(entry);
				}
				finalContent = content;
				writeSuccess = true;
				return content;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

}
