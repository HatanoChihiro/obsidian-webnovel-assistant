import { showPluginNotice } from './PluginNoticeService';
import type { App } from 'obsidian';
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
	type?: string;
}

export interface TimelineEntry {
	time: string;
	timePending?: boolean;
	nodeId?: string;
	type?: string;
	description: string;
	chapter: string;
	rawBlock: string;
	origin?: string;
	important?: boolean;
	lores?: string[];
	items?: TimelineItem[];
}

export interface PendingTimelineEvent {
	id: string;
	description: string;
	chapter: string;
	origin?: string;
	important?: boolean;
}

export interface TimelineDocument {
	entries: TimelineEntry[];
	pendingEvents: PendingTimelineEvent[];
}

export interface TimelineInsertAnchor {
	afterEntryIndex?: number;
	expectedAfterEntry?: TimelineEntry;
	beforeEntryIndex?: number;
	expectedBeforeEntry?: TimelineEntry;
	fallbackIndex?: number;
}

export interface ChapterTimelineNode {
	time: string;
	timePending?: boolean;
	nodeId?: string;
	type?: string;
	lores?: string[];
	items: TimelineItem[];
	entry: TimelineEntry;
}

const PENDING_SECTION_START_MARKER = '<!-- wn-pending-events:start -->';
const PENDING_SECTION_END_MARKER = '<!-- wn-pending-events:end -->';
const PENDING_SECTION_MARKER_REGEX = /^<!--[ \t]*wn-pending-events:(start|end)[ \t]*-->[ \t]*\r?$/gm;
const TIME_PENDING_COMMENT_REGEX = /<!--\s*wn-time-pending\s*-->/;
const NODE_ID_COMMENT_REGEX = /<!--\s*wn-node:\s*([a-zA-Z0-9_-]+)\s*-->/;
const PENDING_ID_COMMENT_REGEX = /<!--\s*wn-pending-id:\s*([a-zA-Z0-9_-]+)\s*-->/;

interface TimelineSourceLine {
	start: number;
	end: number;
}

let timelineEntityIdCounter = 0;

export function createTimelineEntityId(prefix: 'nd' | 'pe'): string {
	timelineEntityIdCounter += 1;
	const ts = Date.now().toString(36);
	const seq = timelineEntityIdCounter.toString(36);
	const rand = Math.random().toString(36).slice(2, 6);
	return `${prefix}_${ts}_${seq}_${rand}`;
}

export function getTimelineNodeDisplayTime(node: Pick<TimelineEntry, 'time' | 'timePending'>): string {
	return node.timePending ? t('timeline.time-pending') : node.time;
}

export function getTimelineEntryLocateCandidates(entry: Pick<TimelineEntry, 'time' | 'timePending' | 'nodeId'>): string[] {
	const nodeMarker = entry.nodeId ? 'wn-node: ' + entry.nodeId : '';
	if (entry.timePending) {
		const displayLabel = getTimelineNodeDisplayTime(entry);
		const fileLabel = getTimelineLabel('timePending');
		return [
			nodeMarker,
			`## ${fileLabel}`,
			`## ${displayLabel}`,
			displayLabel
		].filter(Boolean);
	}
	return [nodeMarker, `## ${entry.time}`, `# ${entry.time}`, entry.time].filter(Boolean);
}

function stableShortHash(input: string): string {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function splitTimelineSections(content: string): {
	mainContent: string;
	pendingSectionContent: string;
	pendingRawBlock: string;
	pendingStart: number;
	pendingEnd: number;
} {
	let startMarker: RegExpExecArray | undefined;
	for (const marker of content.matchAll(PENDING_SECTION_MARKER_REGEX)) {
		if (marker[1] === 'start') {
			startMarker = marker;
		} else if (startMarker) {
			const pendingStart = startMarker.index;
			const end = marker.index + marker[0].length;
			const pendingEnd = end + (content[end] === '\n' ? 1 : 0);
			return {
				mainContent: content.slice(0, pendingStart) + content.slice(pendingEnd),
				pendingSectionContent: content.slice(pendingStart + startMarker[0].length, marker.index),
				pendingRawBlock: content.slice(pendingStart, pendingEnd),
				pendingStart,
				pendingEnd
			};
		}
	}
	return { mainContent: content, pendingSectionContent: '', pendingRawBlock: '', pendingStart: -1, pendingEnd: -1 };
}

export function timelineNodeKey(node: Pick<TimelineEntry, 'time' | 'timePending' | 'nodeId' | 'type' | 'lores'>): string {
	const lores = [...new Set((node.lores || []).map(lore => lore.trim()).filter(Boolean))].sort();
	if (node.timePending) {
		return JSON.stringify(['__wn_time_pending__', node.nodeId?.trim() || '', node.type?.trim() || '', lores]);
	}
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

export function deepClonePendingEvent(event: PendingTimelineEvent): PendingTimelineEvent {
	return {
		id: event.id,
		description: event.description,
		chapter: event.chapter,
		origin: event.origin,
		important: event.important
	};
}

export function deepCloneEntry(entry: TimelineEntry): TimelineEntry {
	return {
		time: entry.time,
		timePending: entry.timePending ? true : undefined,
		nodeId: entry.nodeId,
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

function deepFreezeEntry<T extends TimelineEntry | TimelineItem | PendingTimelineEvent>(obj: T): Readonly<T> {
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

function isTimelineItemNonEmpty(item: Pick<TimelineItem, 'description' | 'chapter' | 'origin' | 'important'>): boolean {
	return Boolean(item.description?.trim() || item.chapter?.trim() || item.origin?.trim() || item.important);
}

function formatBulletItemLines(
	item: Pick<TimelineItem, 'description' | 'chapter' | 'origin' | 'important'>,
	pendingId?: string
): string[] {
	const result: string[] = [];
	const descriptions = item.description ? item.description.split('\n').filter(line => line.trim()) : [];
	const chapters = item.chapter ? parseTimelineChapterList(item.chapter) : [];
	const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
	const idComment = pendingId ? `<!-- wn-pending-id: ${pendingId} -->` : '';

	if (descriptions.length > 0) {
		const firstLineParts: string[] = [descriptions[0]];
		if (chapterLinks) firstLineParts.push(chapterLinks);
		if (item.important) firstLineParts.push('<!-- wn-important -->');
		if (item.origin) firstLineParts.push(`<!-- origin: ${item.origin.replace(/\n/g, ' ')} -->`);
		if (idComment) firstLineParts.push(idComment);
		result.push(`- ${firstLineParts.join(' ')}`);

		for (let i = 1; i < descriptions.length; i++) {
			result.push(`  ${descriptions[i]}`);
		}
	} else if (chapterLinks || item.origin || item.important || idComment) {
		const parts: string[] = [];
		if (chapterLinks) parts.push(chapterLinks);
		if (item.important) parts.push('<!-- wn-important -->');
		if (item.origin) parts.push(`<!-- origin: ${item.origin.replace(/\n/g, ' ')} -->`);
		if (idComment) parts.push(idComment);
		if (parts.length > 0) result.push(`- ${parts.join(' ')}`);
	}
	return result;
}

/**
 * 时间线管理服务
 * 负责时间线文件的读写、格式化、条目管理
 */
export class TimelineManager {

	private writer = new SerializedWriter();
	private destroyed = false;
	private contentReads = new Map<TFile, { path: string; mtime: number | undefined; size: number | undefined; promise: Promise<string> }>();
	private parsedEntries = new Map<string, { content: string; version: number; label: string; manager: WebNovelAssistantPlugin['characterManager']; entries: TimelineEntry[] }>();

	async destroy(): Promise<void> {
		this.destroyed = true;
		this.contentReads.clear();
		this.parsedEntries.clear();
		await this.writer.flush();
		this.parsedEntries.clear();
	}



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
					if (file instanceof TFile) this.contentReads.delete(file);
					if (this.destroyed) return;
					if (!(file instanceof TFile) || file.extension !== 'md') return;
					this.handleVaultModify(file);
				})
			);
			this.plugin.registerEvent(this.app.vault.on('rename', (file) => {
				if (file instanceof TFile) this.contentReads.delete(file);
			}));
			this.plugin.registerEvent(this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) this.contentReads.delete(file);
			}));
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
							if (this.destroyed) return;
							const content = await this.readTimelineFile(file);
							if (this.destroyed) return;
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
					const content = await this.readTimelineFile(file);
					if (this.destroyed) return;
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
		const content = await this.loadContent(folder);
		if (content === null) return null;
		if (!content || typeof content !== 'string') return [];
		return this.parseEntries(content, folder);
	}

	async loadDocument(folderPath?: string): Promise<TimelineDocument | null> {
		const folder = this.normalizeFolderPath(folderPath);
		const content = await this.loadContent(folder);
		if (content === null) return null;
		if (!content || typeof content !== 'string') return { entries: [], pendingEvents: [] };
		return this.parseDocument(content, folder);
	}

	parseDocument(content: string, folderPath?: string): TimelineDocument {
		return {
			entries: this.parseEntries(content, folderPath),
			pendingEvents: this.parsePendingEvents(content)
		};
	}

	parsePendingEvents(content: string): PendingTimelineEvent[] {
		if (!content || typeof content !== 'string') return [];
		const { pendingSectionContent } = splitTimelineSections(content);
		if (!pendingSectionContent.trim()) return [];

		const lines = pendingSectionContent.split(/\r?\n/);
		const events: PendingTimelineEvent[] = [];
		const seenIds = new Set<string>();
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];
			const trimmedLine = line.trim();
			if (!trimmedLine || trimmedLine.startsWith('#')) {
				i++;
				continue;
			}
			if (line.startsWith('- ')) {
				let desc = line.slice(2);
				i++;
				while (i < lines.length && lines[i].startsWith('  ') && !lines[i].startsWith('- ')) {
					const continuationLine = lines[i].slice(2);
					if (continuationLine.trim()) {
						desc += '\n' + continuationLine;
					}
					i++;
				}

				let pendingId: string | undefined;
				const idMatch = desc.match(PENDING_ID_COMMENT_REGEX);
				if (idMatch) {
					pendingId = idMatch[1];
					desc = desc.replace(new RegExp(PENDING_ID_COMMENT_REGEX.source, 'g'), '').trim();
				}

				let important = false;
				if (/<!--\s*wn-important\s*-->/.test(desc)) {
					important = true;
					desc = desc.replace(/<!--\s*wn-important\s*-->/g, '').trim();
				}

				// Strip any stray lore comments if manually edited
				desc = desc.replace(/<!--\s*(?:wn-lore|lore):\s*[\s\S]+?\s*-->/g, '').trim();

				let origin: string | undefined;
				const originMatch = desc.match(/<!--\s*origin:\s*([\s\S]+?)\s*-->/);
				if (originMatch) {
					origin = originMatch[1];
					desc = desc.replace(/<!--\s*origin:\s*[\s\S]+?\s*-->/g, '').trim();
				}

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
				if (!pendingId && !desc && !chapter && !origin && !important) {
					continue;
				}

				let resolvedId = pendingId;
				if (!resolvedId || seenIds.has(resolvedId)) {
					resolvedId = `pe_auto_${events.length}_${stableShortHash(`${desc}|${chapter}|${origin || ''}|${important ? '1' : '0'}`)}`;
					while (seenIds.has(resolvedId)) {
						resolvedId += '_x';
					}
				}
				seenIds.add(resolvedId);

				events.push({
					id: resolvedId,
					description: desc,
					chapter,
					origin,
					important: important ? true : undefined
				});
				continue;
			}
			i++;
		}

		return events.map(deepClonePendingEvent);
	}

	async loadContent(folderPath?: string): Promise<string | null> {
		if (this.destroyed) return null;
		const folder = this.normalizeFolderPath(folderPath);
		const file = this.getTimelineFile(folder);
		if (!file) return null;
		return this.readTimelineFile(file);
	}

	private readTimelineFile(file: TFile): Promise<string> {
		const cached = this.contentReads.get(file);
		const path = file.path;
		const mtime = file.stat?.mtime;
		const size = file.stat?.size;
		if (cached && cached.path === path && cached.mtime === mtime && cached.size === size) return cached.promise;
		const record = { path, mtime, size, promise: Promise.resolve().then(() => this.app.vault.cachedRead(file)) };
		this.contentReads.delete(file);
		this.contentReads.set(file, record);
		if (this.contentReads.size > 8) {
			const oldest = this.contentReads.keys().next().value;
			if (oldest) this.contentReads.delete(oldest);
		}
		record.promise = record.promise.then(content => {
			// 未知版本仅合并正在进行的读取；旧请求不得移除或覆盖后来的缓存。
			if (this.contentReads.get(file) === record && (!mtime || file.path !== path || file.stat?.mtime !== mtime || file.stat?.size !== size)) {
				this.contentReads.delete(file);
			}
			return content;
		}, (error: unknown) => {
			if (this.contentReads.get(file) === record) this.contentReads.delete(file);
			throw error;
		});
		return record.promise;
	}

	private async processTimelineFile(file: TFile, transform: (content: string) => string): Promise<string> {
		try {
			return await this.app.vault.process(file, transform);
		} finally {
			this.contentReads.delete(file);
		}
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
		const folder = this.normalizeFolderPath(folderPath);
		const manager = this.plugin.characterManager;
		const version = manager ? manager.cacheVersion : 0;
		const label = t('timeline.type-label');
		const cached = this.parsedEntries.get(folder);
		if (!this.destroyed && typeof version === 'number' && cached?.content === content && cached.version === version && cached.label === label && cached.manager === manager) {
			return cached.entries.map(deepCloneEntry);
		}
		const entries = this.parseTimelineContent(content, folder);
		if (!this.destroyed && typeof version === 'number') {
			this.parsedEntries.delete(folder);
			this.parsedEntries.set(folder, { content, version, label, manager, entries });
			if (this.parsedEntries.size > 8) {
				const oldest = this.parsedEntries.keys().next().value;
				if (oldest !== undefined) this.parsedEntries.delete(oldest);
			}
		}
		return entries.map(deepCloneEntry);
	}

	private parseTimelineContent(
		content: string,
		folderPath: string,
		sourceSpans?: Map<TimelineItem, TimelineSourceLine[]>
	): TimelineEntry[] {
		if (!content || typeof content !== 'string') return [];
		const { mainContent, pendingStart, pendingEnd } = splitTimelineSections(content);
		if (!mainContent.trim()) return [];
		const pendingDelta = pendingStart >= 0 ? pendingEnd - pendingStart : 0;
		const toOrigLineSpan = (start: number, end: number): TimelineSourceLine => {
			if (pendingStart >= 0 && start >= pendingStart) {
				return { start: start + pendingDelta, end: end + pendingDelta };
			}
			return { start, end };
		};
		const bookFolder = folderPath;
		const entries: TimelineEntry[] = [];
		const blocks = mainContent.split(/\n---\n/);
		const seenNodeIds = new Set<string>();
		let blockOffset = 0;

		for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
			const block = blocks[blockIdx];
			const currentBlockOffset = blockOffset;
			blockOffset += block.length + 5; // '\n---\n'.length
			const trimmed = block.trim();
			if (!trimmed.startsWith('## ')) continue;

			const lines = trimmed.split('\n');
			const lineSpans: TimelineSourceLine[] = [];
			if (sourceSpans) {
				let cursor = currentBlockOffset + block.length - block.trimStart().length;
				for (const line of lines) {
					lineSpans.push(toOrigLineSpan(cursor, cursor + line.length - (line.endsWith('\r') ? 1 : 0)));
					cursor += line.length + 1;
				}
			}
			let headingRaw = lines[0].replace(/^## /, '');
			let timePending = false;
			let nodeId: string | undefined;

			if (TIME_PENDING_COMMENT_REGEX.test(headingRaw)) {
				timePending = true;
				headingRaw = headingRaw.replace(new RegExp(TIME_PENDING_COMMENT_REGEX.source, 'g'), '');
			}
			const headingNodeMatch = headingRaw.match(NODE_ID_COMMENT_REGEX);
			if (headingNodeMatch) {
				nodeId = headingNodeMatch[1];
				headingRaw = headingRaw.replace(new RegExp(NODE_ID_COMMENT_REGEX.source, 'g'), '');
			}

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

				// 检查独立的时间待定或节点标识注释
				if (/^<!--\s*wn-time-pending\s*-->$/.test(trimmedLine)) {
					timePending = true;
					i++;
					continue;
				}
				const blockNodeMatch = trimmedLine.match(/^<!--\s*wn-node:\s*([a-zA-Z0-9_-]+)\s*-->$/);
				if (blockNodeMatch) {
					if (!nodeId) nodeId = blockNodeMatch[1];
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
					const itemStartLine = i;
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

					const item: TimelineItem = {
						description: desc,
						chapter,
						origin,
						important,
						type: firstTypeLineIndex >= 0 ? currentType : undefined
					};
					items.push(item);
					sourceSpans?.set(item, lineSpans.slice(itemStartLine, i));
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
				const descLineIndices: number[] = [];
				let j = 1;
				while (j < lines.length && !lines[j].startsWith('**') && !lines[j].startsWith('- ')) {
					const l = lines[j].trim();
					if (l) {
						if (/^<!--\s*wn-time-pending\s*-->$/.test(l)) {
							timePending = true;
						} else if (/^<!--\s*wn-node:\s*([a-zA-Z0-9_-]+)\s*-->$/.test(l)) {
							const match = l.match(/^<!--\s*wn-node:\s*([a-zA-Z0-9_-]+)\s*-->$/);
							if (match && !nodeId) nodeId = match[1];
						} else {
							const blockLoreMatch = l.match(/^<!--\s*(?:wn-lore|lore):\s*([\s\S]+?)\s*-->$/);
							if (blockLoreMatch) {
								const rawLores = parseLoreComment(blockLoreMatch[1]);
								nodeLores.push(...this.canonicalizeLoreList(rawLores, bookFolder));
							} else {
								descLines.push(l);
								descLineIndices.push(j);
							}
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

					const item: TimelineItem = {
						description,
						chapter: serializeTimelineChapterList(chapters),
						origin,
						important,
						type: primaryType || undefined
					};
					items.push(item);
					sourceSpans?.set(item, descLineIndices.map(lineIdx => lineSpans[lineIdx]));
				}
			}

			const time = timePending ? '' : headingRaw.trim();
			let resolvedNodeId = nodeId;
			if (timePending || resolvedNodeId) {
				if (!resolvedNodeId || seenNodeIds.has(resolvedNodeId)) {
					resolvedNodeId = `nd_auto_${blockIdx}_${stableShortHash(trimmed)}`;
					while (seenNodeIds.has(resolvedNodeId)) {
						resolvedNodeId += '_x';
					}
				}
				seenNodeIds.add(resolvedNodeId);
			}

			const uniqueLores = [...new Set(nodeLores)];
			if (items.length === 0) {
				entries.push({
					time,
					timePending: timePending ? true : undefined,
					nodeId: resolvedNodeId,
					type: primaryType,
					description: '',
					chapter: '',
					rawBlock: trimmed,
					items: [],
					lores: uniqueLores.length > 0 ? uniqueLores : undefined
				});
				continue;
			}

			// Older event-level files may contain several type sections in one block.
			// Expose each section as its own node; subsequent writes use the node format.
			const groups = new Map<string, TimelineItem[]>();
			for (const item of items) {
				const type = item.type || '';
				const { type: _legacyType, ...nodeItem } = item;
				const group = groups.get(type) || [];
				group.push(nodeItem);
				groups.set(type, group);
				if (sourceSpans) {
					const spans = sourceSpans.get(item);
					if (spans) sourceSpans.set(nodeItem, spans);
					sourceSpans.delete(item);
				}
			}
			let groupIdx = 0;
			for (const [type, groupItems] of groups) {
				const groupNodeId = resolvedNodeId
					? (groupIdx === 0 ? resolvedNodeId : `${resolvedNodeId}_g${groupIdx}`)
					: undefined;
				entries.push({
					time,
					timePending: timePending ? true : undefined,
					nodeId: groupNodeId,
					type,
					description: groupItems.map(it => it.description).filter(Boolean).join('\n'),
					chapter: aggregateTimelineChapterLists(groupItems.map(it => it.chapter)),
					rawBlock: trimmed,
					items: groupItems,
					lores: uniqueLores.length > 0 ? uniqueLores : undefined
				});
				groupIdx++;
			}
		}

		return entries;
	}

	formatEntry(entry: TimelineEntry): string {
		const lines: string[] = [];
		const heading = entry.timePending ? getTimelineLabel('timePending') + ' <!-- wn-time-pending -->' : entry.time;
		const nodeId = entry.nodeId?.trim() || (entry.timePending ? createTimelineEntityId('nd') : '');
		const nodeMarker = nodeId ? ` <!-- wn-node: ${nodeId} -->` : '';
		lines.push(`## ${heading}${nodeMarker}`);
		lines.push('');
		if (entry.type) {
			lines.push(`**${getTimelineLabel('type')}**：${entry.type}`);
			lines.push('');
		}

		const items = entry.items !== undefined
			? entry.items
			: (isTimelineItemNonEmpty(entry)
				? [{
					description: entry.description,
					chapter: entry.chapter,
					origin: entry.origin,
					important: entry.important
				}]
				: []);

		for (const it of items) {
			lines.push(...formatBulletItemLines(it));
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

	formatPendingSection(pendingEvents: readonly PendingTimelineEvent[]): string {
		if (!pendingEvents || pendingEvents.length === 0) return '';
		const lines: string[] = [
			PENDING_SECTION_START_MARKER,
			`## ${getTimelineLabel('pendingSection')}`,
			''
		];
		for (const event of pendingEvents) {
			const resolvedId = event.id?.trim() || createTimelineEntityId('pe');
			lines.push(...formatBulletItemLines(event, resolvedId));
		}
		lines.push(PENDING_SECTION_END_MARKER);
		lines.push('');
		return lines.join('\n');
	}

	private replacePendingSection(content: string, pendingEvents: readonly PendingTimelineEvent[]): string {
		const { pendingStart, pendingEnd } = splitTimelineSections(content);
		const section = this.formatPendingSection(pendingEvents);
		if (pendingStart >= 0) {
			return content.slice(0, pendingStart) + section + content.slice(pendingEnd);
		}
		const separator = section && content && !content.endsWith('\n') ? '\n' : '';
		return content + separator + section;
	}

	private serializeDocument(entries: readonly TimelineEntry[], pendingEvents: readonly PendingTimelineEvent[]): string {
		let content = '';
		for (const entry of entries) {
			content += this.formatEntry(entry);
		}
		const pendingSection = this.formatPendingSection(pendingEvents);
		if (pendingSection) {
			if (content && !content.endsWith('\n')) content += '\n';
			content += pendingSection;
		}
		return content;
	}

	findEntryHeadingOffset(content: string, entryIndex: number, folderPath?: string): number | undefined {
		const { pendingStart, pendingEnd } = splitTimelineSections(content);
		const headings = [...content.matchAll(/^## .+$/gm)].filter(h => {
			if (pendingStart < 0) return true;
			return h.index < pendingStart || h.index >= pendingEnd;
		});
		let index = 0;
		for (let i = 0; i < headings.length; i++) {
			const start = headings[i].index;
			let limit = headings[i + 1]?.index ?? content.length;
			if (pendingStart >= 0 && start < pendingStart && pendingStart < limit) {
				limit = pendingStart;
			}
			const separator = content.indexOf('\n---\n', start);
			const end = separator >= 0 && separator < limit ? separator + '\n---\n'.length : limit;
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
			if (entry.timePending) continue;
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

	getTimelineNodesForChapter(
		chapterFile: TFile,
		entries: TimelineEntry[],
		folderPath?: string,
		timelineFile?: TFile
	): ChapterTimelineNode[] {
		if (!chapterFile || !entries || entries.length === 0) return [];

		const folder = this.normalizeFolderPath(folderPath);
		const tlFile = timelineFile || this.getTimelineFile(folder);
		const tlPath = tlFile ? tlFile.path : this.getTimelineFilePath(folder);

		const eligibleChapters = ChapterSorter.getAllChapters(this.app, this.plugin, folder);
		const referenceIndex = ChapterSorter.createReferenceIndex(this.app, this.plugin, folder, {
			eligibleChapters,
			sourcePath: tlPath
		});

		const results: ChapterTimelineNode[] = [];

		for (const entry of entries) {
			const nodeTime = entry.time?.trim() || '';
			if (!entry.timePending && !nodeTime) continue;

			const matchedItems: TimelineItem[] = [];

			if (entry.items && entry.items.length > 0) {
				for (const item of entry.items) {
					if (!item.chapter) continue;
					const links = parseTimelineChapterList(item.chapter);
					const isMatch = links.some(link => referenceIndex.resolve(link)?.path === chapterFile.path);
					if (isMatch) {
						// Don't fallback to aggregate node origin for unrelated individual items.
						matchedItems.push(item);
					}
				}
			} else if (entry.chapter) {
				// Legacy node with no items maps description/chapter/origin as a single item.
				const links = parseTimelineChapterList(entry.chapter);
				const isMatch = links.some(link => referenceIndex.resolve(link)?.path === chapterFile.path);
				if (isMatch) {
					matchedItems.push({
						description: entry.description,
						chapter: entry.chapter,
						origin: entry.origin,
						important: entry.important,
						type: entry.type
					});
				}
			}

			if (matchedItems.length > 0) {
				results.push({
					time: entry.timePending ? '' : entry.time,
					timePending: entry.timePending ? true : undefined,
					nodeId: entry.nodeId,
					type: entry.type,
					lores: entry.lores,
					items: matchedItems,
					entry
				});
			}
		}

		return results;
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
		const isTimePending = Boolean(entry.timePending);
		const canonicalEntry: TimelineEntry = {
			...entry,
			time: isTimePending ? '' : (entry.time || '').trim(),
			timePending: isTimePending ? true : undefined,
			nodeId: entry.nodeId?.trim() || (isTimePending ? createTimelineEntityId('nd') : undefined),
			lores: this.canonicalizeLoreList(entry.lores || [], folder)
		};
		const frozenCanonicalEntry = deepFreezeEntry(deepCloneEntry(canonicalEntry));

		return this.writer.enqueue(async () => {
			let file = this.getTimelineFile(folder);
			if (!file) file = await this.createTimelineFile(folder);

			let finalContent = '';
			await this.processTimelineFile(file, (existing) => {
				const { mainContent, pendingRawBlock } = splitTimelineSections(existing);
				const appendPending = (body: string): string => {
					if (!pendingRawBlock) return body;
					const sep = body && !body.endsWith('\n') ? '\n' : '';
					return body + sep + pendingRawBlock;
				};

				if (!frozenCanonicalEntry.timePending) {
					const headings = [...mainContent.matchAll(/^## (.+)$/gm)];
					let lastSameTimeEnd = -1;
					for (let i = 0; i < headings.length; i++) {
						const heading = headings[i];
						if (TIME_PENDING_COMMENT_REGEX.test(heading[1])) continue;
						if (heading[1].replace(NODE_ID_COMMENT_REGEX, '').trim() !== frozenCanonicalEntry.time) continue;
						const start = heading.index;
						const nextHeading = headings[i + 1]?.index ?? mainContent.length;
						const separator = mainContent.indexOf('\n---\n', start);
						const end = separator >= 0 && separator < nextHeading ? separator + '\n---\n'.length : nextHeading;
						lastSameTimeEnd = end;
						const matchingEntries = this.parseEntries(mainContent.slice(start, end), folder);
						const match = matchingEntries.find(candidate => !candidate.timePending && timelineNodeKey(candidate) === timelineNodeKey(frozenCanonicalEntry));
						if (!match) continue;

						const existingItems = (match.items || []).filter(isTimelineItemNonEmpty);
						const incomingItems = frozenCanonicalEntry.items !== undefined
							? frozenCanonicalEntry.items.map(deepCloneItem)
							: (isTimelineItemNonEmpty(frozenCanonicalEntry)
								? [{ description: frozenCanonicalEntry.description, chapter: frozenCanonicalEntry.chapter, origin: frozenCanonicalEntry.origin, important: frozenCanonicalEntry.important }]
								: []);
						match.items = [...existingItems, ...incomingItems];
						finalContent = appendPending(mainContent.slice(0, start) + matchingEntries.map(candidate => this.formatEntry(candidate)).join('') + mainContent.slice(end));
						return finalContent;
					}
					const insertion = lastSameTimeEnd >= 0 ? lastSameTimeEnd : mainContent.length;
					const prefix = mainContent.slice(0, insertion);
					const separator = prefix && !prefix.endsWith('\n') ? '\n' : '';
					finalContent = appendPending(prefix + separator + this.formatEntry(deepCloneEntry(frozenCanonicalEntry)) + mainContent.slice(insertion));
					return finalContent;
				}

				const prefix = mainContent;
				const separator = prefix && !prefix.endsWith('\n') ? '\n' : '';
				finalContent = appendPending(prefix + separator + this.formatEntry(deepCloneEntry(frozenCanonicalEntry)));
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

		let items: TimelineItem[];
		if (entry.items !== undefined) {
			items = entry.items
				.map(it => ({
					description: (it.description || '').trim(),
					chapter: serializeTimelineChapterList(parseTimelineChapterList(it.chapter)),
					origin: it.origin?.trim() || undefined,
					important: !!it.important,
					type: it.type?.trim() || undefined
				}))
				.filter(isTimelineItemNonEmpty);
		} else if (isTimelineItemNonEmpty(entry)) {
			items = [{
				description: (entry.description || '').trim(),
				chapter: serializeTimelineChapterList(parseTimelineChapterList(entry.chapter)),
				origin: entry.origin?.trim() || undefined,
				important: !!entry.important
			}];
		} else {
			items = [];
		}

		const isTimePending = Boolean(entry.timePending);
		return {
			time: isTimePending ? '' : (entry.time || '').trim(),
			timePending: isTimePending ? true : undefined,
			nodeId: entry.nodeId?.trim() || undefined,
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

	private matchesPendingEvent(candidate: PendingTimelineEvent, expected: PendingTimelineEvent): boolean {
		return candidate.id === expected.id &&
			(candidate.description || '').trim() === (expected.description || '').trim() &&
			serializeTimelineChapterList(parseTimelineChapterList(candidate.chapter)) === serializeTimelineChapterList(parseTimelineChapterList(expected.chapter)) &&
			(candidate.origin?.trim() || undefined) === (expected.origin?.trim() || undefined) &&
			Boolean(candidate.important) === Boolean(expected.important);
	}

	private resolvePendingIndex(
		pendingEvents: PendingTimelineEvent[],
		pendingId: string,
		expectedEvent?: PendingTimelineEvent
	): number {
		const idx = pendingEvents.findIndex(ev => ev.id === pendingId);
		if (idx === -1) return -1;
		if (expectedEvent && !this.matchesPendingEvent(pendingEvents[idx], expectedEvent)) {
			return -1;
		}
		return idx;
	}

	private matchesEntry(candidate: TimelineEntry, expected: TimelineEntry): boolean {
		return this.formatEntry(this.normalizeForSnapshot(candidate)).trim() ===
			this.formatEntry(this.normalizeForSnapshot(expected)).trim();
	}

	private entryIdentityIgnoringImportance(entry: TimelineEntry): string {
		const normalized = this.normalizeForSnapshot(entry);
		const rawItems = entry.items !== undefined
			? entry.items
			: (isTimelineItemNonEmpty(entry)
				? [{ description: entry.description, chapter: entry.chapter, origin: entry.origin, important: entry.important }]
				: []);
		const items = rawItems.map(it => ({
			description: (it.description || '').trim(),
			chapter: serializeTimelineChapterList(parseTimelineChapterList(it.chapter)),
			origin: it.origin?.trim() || ''
		}));
		const stableNodeId = normalized.nodeId?.startsWith('nd_auto_')
			? ''
			: (normalized.nodeId ?? '');
		return JSON.stringify([
			normalized.time,
			Boolean(normalized.timePending),
			stableNodeId,
			normalized.type ?? '',
			normalized.lores ?? [],
			items
		]);
	}

	private patchTimelineItemImportance(
		content: string,
		lineSpans: readonly TimelineSourceLine[],
		important: boolean
	): string {
		if (lineSpans.length === 0) return content;
		const markerRegex = /<!--\s*wn-important\s*-->/;
		const hasMarker = lineSpans.some(span => markerRegex.test(content.slice(span.start, span.end)));
		if (important) {
			if (hasMarker) return content;
			const first = lineSpans[0];
			const lineText = content.slice(first.start, first.end);
			const originMatch = lineText.match(/<!--\s*origin:/);
			let patchedLine: string;
			if (originMatch && originMatch.index !== undefined) {
				const beforeOrigin = lineText.slice(0, originMatch.index);
				const prefixSpace = beforeOrigin.length > 0 && !/[ \t]$/.test(beforeOrigin) ? ' ' : '';
				patchedLine = `${beforeOrigin}${prefixSpace}<!-- wn-important --> ${lineText.slice(originMatch.index)}`;
			} else {
				const prefixSpace = lineText.length > 0 && !/[ \t]$/.test(lineText) ? ' ' : '';
				patchedLine = `${lineText}${prefixSpace}<!-- wn-important -->`;
			}
			return content.slice(0, first.start) + patchedLine + content.slice(first.end);
		}
		if (!hasMarker) return content;
		let result = content;
		for (let idx = lineSpans.length - 1; idx >= 0; idx--) {
			const span = lineSpans[idx];
			const lineText = result.slice(span.start, span.end);
			if (!markerRegex.test(lineText)) continue;
			let nextLine = lineText.replace(/([ \t]?)<!--\s*wn-important\s*-->([ \t]?)/g, (_m, before: string, after: string) =>
				after ? before : ''
			);
			if (idx > 0 && nextLine.trim() === '') {
				let removeStart = span.start;
				if (removeStart >= 2 && result[removeStart - 2] === '\r' && result[removeStart - 1] === '\n') {
					removeStart -= 2;
				} else if (removeStart >= 1 && result[removeStart - 1] === '\n') {
					removeStart -= 1;
				}
				result = result.slice(0, removeStart) + result.slice(span.end);
			} else {
				if (lineText.startsWith('- ') && !nextLine.startsWith('- ')) {
					nextLine = `- ${nextLine.trimStart()}`;
				}
				result = result.slice(0, span.start) + nextLine + result.slice(span.end);
			}
		}
		return result;
	}

	async setItemImportance(
		itemIndex: number,
		important: boolean,
		folderPath: string,
		expectedEntry: TimelineEntry,
		source: { file: TFile; path: string }
	): Promise<void> {
		const folder = this.normalizeFolderPath(folderPath);
		const { file, path } = source;
		const conflict = (): never => {
			const message = t('timeline.conflict-notice');
			showPluginNotice(message);
			throw new Error(message);
		};
		const assertSource = (): void => {
			if (file.path !== path || this.getTimelineFile(folder) !== file) conflict();
		};
		const expectedIdentity = this.entryIdentityIgnoringImportance(expectedEntry);

		return this.writer.enqueue(async () => {
			assertSource();
			await this.processTimelineFile(file, (existing) => {
				assertSource();
				const sourceSpans = new Map<TimelineItem, TimelineSourceLine[]>();
				const latestEntries = this.parseTimelineContent(existing, folder, sourceSpans);
				const matches = latestEntries.filter(entry => this.entryIdentityIgnoringImportance(entry) === expectedIdentity);
				const item = matches.length === 1 ? matches[0].items?.[itemIndex] : undefined;
				if (!item) return conflict();
				if (Boolean(item.important) === important) return existing;
				const spans = sourceSpans.get(item);
				const updated = spans?.length ? this.patchTimelineItemImportance(existing, spans, important) : existing;
				return updated === existing ? conflict() : updated;
			});
		});
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

	async updateEntry(index: number, updated: TimelineEntry, folderPath?: string, expectedEntry?: TimelineEntry, expectedSource?: { file: TFile; path: string }): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const expectedFile = expectedSource?.file;
		const expectedPath = expectedSource?.path;
		const assertSource = (): void => {
			if (expectedFile && (this.getTimelineFile(folder) !== expectedFile || expectedFile.path !== expectedPath)) {
				showPluginNotice(t('timeline.conflict-notice'));
				throw new Error(t('timeline.conflict-notice'));
			}
		};
		const canonicalUpdated = { ...updated, lores: this.canonicalizeLoreList(updated.lores || [], folder) };
		const frozenUpdated = deepFreezeEntry(deepCloneEntry(canonicalUpdated));
		const frozenExpected = expectedEntry ? deepFreezeEntry(deepCloneEntry(expectedEntry)) : undefined;

		return this.writer.enqueue(async () => {
			assertSource();
			const file = this.getTimelineFile(folder);
			if (!file) return '';

			let finalContent = '';
			let writeSuccess = false;

			await this.processTimelineFile(file, (existing) => {
				assertSource();
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);
				const targetIndex = this.resolveTargetIndex(latestEntries, index, frozenExpected);

				if (targetIndex === -1) {
					if (frozenExpected) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}

				const previousEntry = latestEntries[targetIndex];
				const clonedPayload = deepCloneEntry(frozenUpdated);
				if (clonedPayload.timePending) {
					clonedPayload.time = '';
					clonedPayload.timePending = true;
					clonedPayload.nodeId = clonedPayload.nodeId?.trim() || previousEntry.nodeId || createTimelineEntityId('nd');
				} else {
					clonedPayload.time = (clonedPayload.time || '').trim();
					clonedPayload.timePending = undefined;
					clonedPayload.nodeId = previousEntry.nodeId;
				}
				latestEntries[targetIndex] = clonedPayload;

				if (!clonedPayload.timePending && !clonedPayload.nodeId) {
					const mergeIndex = latestEntries.findIndex((candidate, candidateIndex) =>
						candidateIndex !== targetIndex && !candidate.timePending && !candidate.nodeId &&
						timelineNodeKey(candidate) === timelineNodeKey(clonedPayload)
					);
					if (mergeIndex >= 0) {
						const target = latestEntries[mergeIndex];
						const targetItems = (target.items || []).filter(isTimelineItemNonEmpty);
						const updatedItems = (clonedPayload.items || []).filter(isTimelineItemNonEmpty);
						target.items = [...targetItems, ...updatedItems];
						latestEntries.splice(targetIndex, 1);
					}
				}

				const content = this.serializeDocument(latestEntries, pendingEvents);
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

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);
				const targetIndex = this.resolveTargetIndex(latestEntries, index, frozenExpected);

				if (targetIndex === -1) {
					if (frozenExpected) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}

				latestEntries.splice(targetIndex, 1);

				const content = this.serializeDocument(latestEntries, pendingEvents);
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

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);
				const actualFromIndex = this.resolveTargetIndex(latestEntries, fromIndex, frozenExpectedFrom);
				if (actualFromIndex === -1) {
					if (frozenExpectedFrom) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					finalContent = existing;
					return existing;
				}

				let actualToIndex = -1;
				if (frozenExpectedTo) {
					actualToIndex = this.resolveTargetIndex(latestEntries, toIndex, frozenExpectedTo);
					if (actualToIndex === -1) {
						showPluginNotice(t('timeline.conflict-notice'));
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

				const content = this.serializeDocument(latestEntries, pendingEvents);
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

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);

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
						showPluginNotice(t('timeline.conflict-notice'));
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
						showPluginNotice(t('timeline.conflict-notice'));
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
						showPluginNotice(t('timeline.conflict-notice'));
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
						const content = this.serializeDocument(latestEntries, pendingEvents);
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

				const content = this.serializeDocument(latestEntries, pendingEvents);
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

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);

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
							showPluginNotice(t('timeline.conflict-notice'));
							throw new Error(t('timeline.conflict-notice'));
						}
						matchedEntry = latestEntries[resolvedIdx];
					} else {
						if (target.entryIndex !== undefined) {
							if (!Number.isInteger(target.entryIndex) || target.entryIndex < 0 || target.entryIndex >= latestEntries.length) {
								showPluginNotice(t('timeline.conflict-notice'));
								throw new Error(t('timeline.conflict-notice'));
							}
							matchedEntry = latestEntries[target.entryIndex];
						} else if (target.time) {
							const matches = latestEntries.filter(e => !e.timePending && e.time === target.time);
							if (matches.length === 1) {
								matchedEntry = matches[0];
							} else {
								showPluginNotice(t('timeline.conflict-notice'));
								throw new Error(t('timeline.conflict-notice'));
							}
						}
					}

					if (!matchedEntry) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}

					if (!matchedEntry.items || matchedEntry.items.length === 0) {
						matchedEntry.items = [{ description: matchedEntry.description, chapter: '' }];
					}

					let itemIdx = 0;
					if (target.itemIndex !== undefined) {
						if (!Number.isInteger(target.itemIndex) || target.itemIndex < 0 || target.itemIndex >= matchedEntry.items.length) {
							showPluginNotice(t('timeline.conflict-notice'));
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

				const content = this.serializeDocument(latestEntries, pendingEvents);
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

	async addPendingEvent(
		input: { description: string; chapter?: string; origin?: string; important?: boolean },
		folderPath?: string
	): Promise<{ content: string; event: PendingTimelineEvent }> {
		const folder = this.normalizeFolderPath(folderPath);
		const description = (input.description || '').trim();
		const chapter = serializeTimelineChapterList(parseTimelineChapterList(input.chapter));
		const origin = input.origin?.trim() || undefined;
		const important = input.important ? true : undefined;

		const createdEvent: PendingTimelineEvent = {
			id: createTimelineEntityId('pe'),
			description,
			chapter,
			origin,
			important
		};
		const frozenEvent = deepFreezeEntry(deepClonePendingEvent(createdEvent));

		return this.writer.enqueue(async () => {
			let file = this.getTimelineFile(folder);
			if (!file) file = await this.createTimelineFile(folder);

			let finalContent = '';
			await this.processTimelineFile(file, (existing) => {
				const pendingEvents = this.parsePendingEvents(existing);
				pendingEvents.unshift(deepClonePendingEvent(frozenEvent));
				finalContent = this.replacePendingSection(existing, pendingEvents);
				return finalContent;
			});
			return { content: finalContent, event: deepClonePendingEvent(frozenEvent) };
		});
	}

	async updatePendingEvent(
		pendingId: string,
		patch: Partial<Pick<PendingTimelineEvent, 'description' | 'chapter' | 'origin' | 'important'>>,
		folderPath?: string,
		expectedEvent?: PendingTimelineEvent
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenExpected = expectedEvent ? deepFreezeEntry(deepClonePendingEvent(expectedEvent)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) {
				showPluginNotice(t('timeline.conflict-notice'));
				throw new Error(t('timeline.conflict-notice'));
			}

			let finalContent = '';
			await this.processTimelineFile(file, (existing) => {
				const pendingEvents = this.parsePendingEvents(existing);
				const targetIdx = this.resolvePendingIndex(pendingEvents, pendingId, frozenExpected);
				if (targetIdx === -1) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}
				const current = pendingEvents[targetIdx];
				const nextDesc = patch.description !== undefined ? patch.description.trim() : current.description;
				const nextChapter = patch.chapter !== undefined
					? serializeTimelineChapterList(parseTimelineChapterList(patch.chapter))
					: current.chapter;
				const nextOrigin = patch.origin !== undefined ? (patch.origin.trim() || undefined) : current.origin;
				const nextImportant = patch.important !== undefined ? (patch.important ? true : undefined) : current.important;

				const updatedEvent: PendingTimelineEvent = {
					id: current.id,
					description: nextDesc,
					chapter: nextChapter,
					origin: nextOrigin,
					important: nextImportant
				};
				pendingEvents[targetIdx] = updatedEvent;
				finalContent = this.replacePendingSection(existing, pendingEvents);
				return finalContent;
			});
			return finalContent;
		});
	}

	async deletePendingEvent(
		pendingId: string,
		folderPath?: string,
		expectedEvent?: PendingTimelineEvent
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenExpected = expectedEvent ? deepFreezeEntry(deepClonePendingEvent(expectedEvent)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) {
				showPluginNotice(t('timeline.conflict-notice'));
				throw new Error(t('timeline.conflict-notice'));
			}

			let finalContent = '';
			await this.processTimelineFile(file, (existing) => {
				const pendingEvents = this.parsePendingEvents(existing);
				const targetIdx = this.resolvePendingIndex(pendingEvents, pendingId, frozenExpected);
				if (targetIdx === -1) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}
				pendingEvents.splice(targetIdx, 1);
				finalContent = this.replacePendingSection(existing, pendingEvents);
				return finalContent;
			});
			return finalContent;
		});
	}

	async placePendingEventIntoNode(
		pendingId: string,
		targetEntryIndex: number,
		targetItemIndex?: number,
		folderPath?: string,
		expectedPending?: PendingTimelineEvent,
		expectedTargetEntry?: TimelineEntry
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenPending = expectedPending ? deepFreezeEntry(deepClonePendingEvent(expectedPending)) : undefined;
		const frozenTarget = expectedTargetEntry ? deepFreezeEntry(deepCloneEntry(expectedTargetEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) {
				showPluginNotice(t('timeline.conflict-notice'));
				throw new Error(t('timeline.conflict-notice'));
			}

			let finalContent = '';
			let writeSuccess = false;

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);

				const pendingIdx = this.resolvePendingIndex(pendingEvents, pendingId, frozenPending);
				if (pendingIdx === -1) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}

				const targetIdx = this.resolveTargetIndex(latestEntries, targetEntryIndex, frozenTarget);
				if (targetIdx === -1) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}

				const pendingEvent = pendingEvents[pendingIdx];
				if (!isTimelineItemNonEmpty(pendingEvent)) throw new Error(t('timeline.pending-empty-error'));
				pendingEvents.splice(pendingIdx, 1);
				const targetEntry = latestEntries[targetIdx];
				const existingItems = (targetEntry.items || []).filter(isTimelineItemNonEmpty);
				const insertIdx = targetItemIndex !== undefined && Number.isInteger(targetItemIndex)
					? Math.max(0, Math.min(targetItemIndex, existingItems.length))
					: existingItems.length;

				const newItem: TimelineItem = {
					description: pendingEvent.description,
					chapter: pendingEvent.chapter,
					origin: pendingEvent.origin,
					important: pendingEvent.important
				};
				existingItems.splice(insertIdx, 0, newItem);
				targetEntry.items = existingItems;
				targetEntry.description = existingItems.map(it => it.description).filter(Boolean).join('\n');
				targetEntry.chapter = aggregateTimelineChapterLists(existingItems.map(it => it.chapter));

				finalContent = this.serializeDocument(latestEntries, pendingEvents);
				writeSuccess = true;
				return finalContent;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

	async createNodeFromPendingEvent(
		pendingId: string,
		nodeSpec: { time: string; timePending?: boolean; type?: string; lores?: string[] },
		anchor: TimelineInsertAnchor,
		folderPath?: string,
		expectedPending?: PendingTimelineEvent
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const isTimePending = Boolean(nodeSpec.timePending);
		const trimmedTime = isTimePending ? '' : (nodeSpec.time || '').trim();
		if (!isTimePending && !trimmedTime) {
			showPluginNotice(t('modal.please-fill-time-point'));
			throw new Error(t('modal.please-fill-time-point'));
		}

		const canonicalLores = this.canonicalizeLoreList(nodeSpec.lores || [], folder);
		const frozenPending = expectedPending ? deepFreezeEntry(deepClonePendingEvent(expectedPending)) : undefined;
		const frozenAfter = anchor.expectedAfterEntry ? deepFreezeEntry(deepCloneEntry(anchor.expectedAfterEntry)) : undefined;
		const frozenBefore = anchor.expectedBeforeEntry ? deepFreezeEntry(deepCloneEntry(anchor.expectedBeforeEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) {
				showPluginNotice(t('timeline.conflict-notice'));
				throw new Error(t('timeline.conflict-notice'));
			}

			let finalContent = '';
			let writeSuccess = false;

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);

				const pendingIdx = this.resolvePendingIndex(pendingEvents, pendingId, frozenPending);
				if (pendingIdx === -1) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}

				let resolvedAfter = -1;
				if (anchor.afterEntryIndex !== undefined || frozenAfter) {
					resolvedAfter = this.resolveTargetIndex(latestEntries, anchor.afterEntryIndex ?? -1, frozenAfter);
					if (resolvedAfter === -1) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
				}

				let resolvedBefore = -1;
				if (anchor.beforeEntryIndex !== undefined || frozenBefore) {
					resolvedBefore = this.resolveTargetIndex(latestEntries, anchor.beforeEntryIndex ?? -1, frozenBefore);
					if (resolvedBefore === -1) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
				}

				let insertIdx: number;
				if (resolvedAfter >= 0 && resolvedBefore >= 0) {
					if (resolvedAfter >= resolvedBefore) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					insertIdx = resolvedAfter + 1;
				} else if (resolvedAfter >= 0) {
					insertIdx = resolvedAfter + 1;
				} else if (resolvedBefore >= 0) {
					insertIdx = resolvedBefore;
				} else {
					insertIdx = anchor.fallbackIndex !== undefined && Number.isInteger(anchor.fallbackIndex)
						? Math.max(0, Math.min(anchor.fallbackIndex, latestEntries.length))
						: latestEntries.length;
				}

				const pendingEvent = pendingEvents[pendingIdx];
				if (!isTimelineItemNonEmpty(pendingEvent)) throw new Error(t('timeline.pending-empty-error'));
				pendingEvents.splice(pendingIdx, 1);
				const item: TimelineItem = {
					description: pendingEvent.description,
					chapter: pendingEvent.chapter,
					origin: pendingEvent.origin,
					important: pendingEvent.important
				};
				const newEntry: TimelineEntry = {
					time: trimmedTime,
					timePending: isTimePending ? true : undefined,
					nodeId: createTimelineEntityId('nd'),
					type: nodeSpec.type?.trim() || '',
					description: item.description,
					chapter: item.chapter,
					origin: item.origin,
					important: item.important,
					rawBlock: '',
					lores: canonicalLores.length > 0 ? canonicalLores : undefined,
					items: [item]
				};

				latestEntries.splice(insertIdx, 0, newEntry);
				finalContent = this.serializeDocument(latestEntries, pendingEvents);
				writeSuccess = true;
				return finalContent;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

	async moveEventToPending(
		sourceEntryIndex: number,
		sourceItemIndex: number,
		folderPath?: string,
		expectedItem?: TimelineItem,
		expectedSourceEntry?: TimelineEntry
	): Promise<string> {
		const folder = this.normalizeFolderPath(folderPath);
		const frozenExpectedItem = expectedItem ? deepFreezeEntry(deepCloneItem(expectedItem)) : undefined;
		const frozenSourceEntry = expectedSourceEntry ? deepFreezeEntry(deepCloneEntry(expectedSourceEntry)) : undefined;

		return this.writer.enqueue(async () => {
			const file = this.getTimelineFile(folder);
			if (!file) {
				showPluginNotice(t('timeline.conflict-notice'));
				throw new Error(t('timeline.conflict-notice'));
			}

			let finalContent = '';
			let writeSuccess = false;

			await this.processTimelineFile(file, (existing) => {
				const latestEntries = this.parseEntries(existing, folder);
				const pendingEvents = this.parsePendingEvents(existing);

				const sourceIndex = this.resolveTargetIndex(latestEntries, sourceEntryIndex, frozenSourceEntry);
				if (sourceIndex === -1) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}
				const sourceEntry = latestEntries[sourceIndex];
				if (!sourceEntry.items || sourceEntry.items.length === 0) {
					showPluginNotice(t('timeline.conflict-notice'));
					throw new Error(t('timeline.conflict-notice'));
				}

				let actualItemIdx = -1;
				if (frozenExpectedItem) {
					const itemMatches: number[] = [];
					for (let i = 0; i < sourceEntry.items.length; i++) {
						const it = sourceEntry.items[i];
						if (
							(it.description || '').trim() === (frozenExpectedItem.description || '').trim() &&
							serializeTimelineChapterList(parseTimelineChapterList(it.chapter)) === serializeTimelineChapterList(parseTimelineChapterList(frozenExpectedItem.chapter)) &&
							(it.origin?.trim() || undefined) === (frozenExpectedItem.origin?.trim() || undefined) &&
							!!it.important === !!frozenExpectedItem.important
						) {
							itemMatches.push(i);
						}
					}
					if (Number.isInteger(sourceItemIndex) && sourceItemIndex >= 0 && itemMatches.includes(sourceItemIndex)) {
						actualItemIdx = sourceItemIndex;
					} else if (itemMatches.length === 1) {
						actualItemIdx = itemMatches[0];
					} else {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
				} else {
					if (!Number.isInteger(sourceItemIndex) || sourceItemIndex < 0 || sourceItemIndex >= sourceEntry.items.length) {
						showPluginNotice(t('timeline.conflict-notice'));
						throw new Error(t('timeline.conflict-notice'));
					}
					actualItemIdx = sourceItemIndex;
				}

				const [removedItem] = sourceEntry.items.splice(actualItemIdx, 1);
				sourceEntry.description = sourceEntry.items.map(it => it.description).filter(Boolean).join('\n');
				sourceEntry.chapter = aggregateTimelineChapterLists(sourceEntry.items.map(it => it.chapter));
				// Preserve sourceEntry even when sourceEntry.items becomes empty (empty structural node).

				pendingEvents.unshift({
					id: createTimelineEntityId('pe'),
					description: removedItem.description || '',
					chapter: removedItem.chapter || '',
					origin: removedItem.origin,
					important: removedItem.important ? true : undefined
				});

				finalContent = this.serializeDocument(latestEntries, pendingEvents);
				writeSuccess = true;
				return finalContent;
			});

			if (writeSuccess) {
				const resultingEntries = this.parseEntries(finalContent, folder);
				await this.reconcileFrontmatter(folder, resultingEntries, file);
			}
			return finalContent;
		});
	}

}
