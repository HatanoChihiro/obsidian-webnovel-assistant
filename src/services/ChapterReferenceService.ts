import { TFile, TFolder, type App, type EventRef, type TAbstractFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ChapterReferenceItem, ForeshadowingReferenceTarget, ReferenceCluster } from '../types/reference';
import { getTimelineNodeDisplayTime, type TimelineEntry } from './TimelineManager';
import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import { findBookRoot, getCandidateNames } from '../utils/path';
import { getDefaultFileName } from '../i18n/data-keys';
import { ChapterSorter } from './ChapterSorter';

export interface NormalizedReferenceDocument {
	normalizedText: string;
	startOffsets: Int32Array;
}

interface CompiledReferenceEntry {
	quote: string;
	items: readonly ChapterReferenceItem[];
	hasSelfOverlap: boolean;
}

export interface CompiledReferencePlan {
	entries: readonly CompiledReferenceEntry[];
}

const WHITESPACE_CHAR = /\s/;

function isWhitespaceCode(text: string, index: number): boolean {
	const code = text.charCodeAt(index);
	if (code === 32 || code === 10 || code === 13 || code === 9) return true;
	if (code > 32 && code < 127) return false;
	if (code >= 0x4e00 && code <= 0x9fff) return false;
	return WHITESPACE_CHAR.test(text[index]);
}

function hasSelfOverlap(quote: string): boolean {
	const len = quote.length;
	if (len <= 1) return false;
	const lps = new Int32Array(len);
	let prefixLen = 0;
	for (let i = 1; i < len; i++) {
		while (prefixLen > 0 && quote.charCodeAt(i) !== quote.charCodeAt(prefixLen)) {
			prefixLen = lps[prefixLen - 1];
		}
		if (quote.charCodeAt(i) === quote.charCodeAt(prefixLen)) {
			prefixLen++;
			lps[i] = prefixLen;
		}
	}
	return lps[len - 1] > 0;
}

/** Normalize whitespace runs once into a searchable string with UTF-16 source offset mapping. */
export function normalizeReferenceDocument(text: string): NormalizedReferenceDocument {
	if (!text) return { normalizedText: '', startOffsets: new Int32Array(0) };
	const startOffsets = new Int32Array(text.length);
	const chunks: string[] = [];
	let normLen = 0;
	let inWhitespace = false;
	let segmentStart = 0;

	for (let i = 0; i < text.length; i++) {
		if (isWhitespaceCode(text, i)) {
			if (!inWhitespace) {
				if (i > segmentStart) chunks.push(text.slice(segmentStart, i));
				chunks.push(' ');
				startOffsets[normLen++] = i;
				inWhitespace = true;
			}
			segmentStart = i + 1;
		} else {
			if (inWhitespace) inWhitespace = false;
			startOffsets[normLen++] = i;
		}
	}
	if (segmentStart < text.length) chunks.push(text.slice(segmentStart));

	return {
		normalizedText: chunks.join(''),
		startOffsets: startOffsets.subarray(0, normLen)
	};
}

/** Compile deduplicated reference quotes once per reference item set. */
export function compileReferencePlan(items: readonly ChapterReferenceItem[]): CompiledReferencePlan {
	const byQuote = new Map<string, ChapterReferenceItem[]>();
	for (const item of items) {
		const quote = item.quote.trim().replace(/\s+/g, ' ');
		if (!quote) continue;
		const group = byQuote.get(quote) ?? [];
		if (!group.some(existing => existing.id === item.id)) group.push(item);
		byQuote.set(quote, group);
	}
	const entries: CompiledReferenceEntry[] = [];
	for (const [quote, group] of byQuote) {
		entries.push({ quote, items: group, hasSelfOverlap: hasSelfOverlap(quote) });
	}
	return { entries };
}

function findNormFrom(startOffsets: Int32Array, rawFrom: number): number {
	let lo = 0;
	let hi = startOffsets.length - 1;
	let ans = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (startOffsets[mid] <= rawFrom) {
			ans = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return ans;
}

function findNormTo(startOffsets: Int32Array, rawTo: number): number {
	let lo = 0;
	let hi = startOffsets.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (startOffsets[mid] < rawTo) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function mergeIntervals(intervals: { from: number; to: number }[]): { from: number; to: number }[] {
	if (intervals.length <= 1) return intervals;
	intervals.sort((a, b) => a.from - b.from || a.to - b.to);
	const merged: { from: number; to: number }[] = [intervals[0]];
	for (let i = 1; i < intervals.length; i++) {
		const prev = merged[merged.length - 1];
		const curr = intervals[i];
		if (curr.from <= prev.to) {
			if (curr.to > prev.to) prev.to = curr.to;
		} else {
			merged.push(curr);
		}
	}
	return merged;
}

/** Match compiled quotes against a pre-normalized document within optional visible ranges. */
export function matchCompiledChapterReferences(
	doc: NormalizedReferenceDocument,
	plan: CompiledReferencePlan,
	visibleRanges?: readonly { from: number; to: number }[]
): ReferenceCluster[] {
	const { normalizedText, startOffsets } = doc;
	if (plan.entries.length === 0 || normalizedText.length === 0) return [];

	const matches: ReferenceCluster[] = [];
	if (!visibleRanges) {
		for (const entry of plan.entries) {
			const { quote, items } = entry;
			const qLen = quote.length;
			let pos = 0;
			while ((pos = normalizedText.indexOf(quote, pos)) !== -1) {
				matches.push({ from: startOffsets[pos], to: startOffsets[pos + qLen - 1] + 1, items: [...items] });
				pos += qLen;
			}
		}
	} else {
		const rawNormRanges: { from: number; to: number }[] = [];
		for (const range of visibleRanges) {
			if (range.to <= range.from) continue;
			const normFrom = findNormFrom(startOffsets, range.from);
			const normTo = findNormTo(startOffsets, range.to);
			if (normTo > normFrom) rawNormRanges.push({ from: normFrom, to: normTo });
		}
		if (rawNormRanges.length === 0) return [];
		const mergedNormRanges = mergeIntervals(rawNormRanges);
		const sliceCache = new Map<string, string>();
		const normLen = normalizedText.length;

		for (const entry of plan.entries) {
			const { quote, items } = entry;
			const qLen = quote.length;
			const searchIntervals = mergeIntervals(
				mergedNormRanges.map(range => ({
					from: Math.max(0, range.from - qLen + 1),
					to: Math.min(normLen, range.to + qLen - 1)
				}))
			);
			const maxSearchEnd = searchIntervals[searchIntervals.length - 1].to;

			for (const interval of searchIntervals) {
				const key = `${interval.from}:${interval.to}`;
				let haystack = sliceCache.get(key);
				if (haystack === undefined) {
					haystack = normalizedText.slice(interval.from, interval.to);
					sliceCache.set(key, haystack);
				}

				if (entry.hasSelfOverlap && interval.from > 0) {
					if (haystack.indexOf(quote) === -1) continue;
					// Self-overlapping quotes (e.g. 'aaa') require greedy alignment from index 0.
					let pos = 0;
					while ((pos = normalizedText.indexOf(quote, pos)) !== -1 && pos < maxSearchEnd) {
						const rawFrom = startOffsets[pos];
						const rawTo = startOffsets[pos + qLen - 1] + 1;
						if (visibleRanges.some(range => rawFrom < range.to && rawTo > range.from)) {
							matches.push({ from: rawFrom, to: rawTo, items: [...items] });
						}
						pos += qLen;
					}
					break;
				}

				let localPos = 0;
				while ((localPos = haystack.indexOf(quote, localPos)) !== -1) {
					const normPos = interval.from + localPos;
					const rawFrom = startOffsets[normPos];
					const rawTo = startOffsets[normPos + qLen - 1] + 1;
					if (visibleRanges.some(range => rawFrom < range.to && rawTo > range.from)) {
						matches.push({ from: rawFrom, to: rawTo, items: [...items] });
					}
					localPos += qLen;
				}
			}
		}
	}

	matches.sort((a, b) => a.from - b.from || b.to - a.to);
	const clusters: ReferenceCluster[] = [];
	for (const match of matches) {
		const previous = clusters[clusters.length - 1];
		if (previous && match.from < previous.to) {
			previous.to = Math.max(previous.to, match.to);
			for (const item of match.items) if (!previous.items.some(existing => existing.id === item.id)) previous.items.push(item);
		} else clusters.push(match);
	}
	return clusters;
}

/** Match complete quotes, allowing only whitespace differences. */
export function matchChapterReferences(text: string, items: readonly ChapterReferenceItem[], visibleRanges?: readonly { from: number; to: number }[]): ReferenceCluster[] {
	const plan = compileReferencePlan(items);
	if (plan.entries.length === 0) return [];
	return matchCompiledChapterReferences(normalizeReferenceDocument(text), plan, visibleRanges);
}
interface SourceRecord<T> { file: TFile; path: string; mtime: number; size: number; read: Promise<T[]> }
interface ChapterRecord { file: TFile; bookRoot: string; eligible: boolean; aliasesKey: string; items: ChapterReferenceItem[] }
interface PendingContext { file: TFile; bookRoot: string; token: number }

export class ChapterReferenceService {
	private timelineCache = new Map<string, SourceRecord<TimelineEntry>>();
	private foreshadowingCache = new Map<string, SourceRecord<ParsedForeshadowingEntry>>();
	private chapters = new Map<string, ChapterRecord>();
	private pending = new Map<string, Promise<ChapterReferenceItem[]>>();
	private pendingContexts = new Map<string, PendingContext>();
	private nextPendingToken = 0;
	private activeReads = new Set<Promise<unknown>>();
	private listeners = new Set<() => void>();
	private events: EventRef[] = [];
	private metadataEvents: EventRef[] = [];
	private generation = 0;
	private destroyed = false;
	private configuration = '';

	constructor(private app: App, private plugin: WebNovelAssistantPlugin) {
		this.configuration = this.settingsKey();
		this.syncListeners();
	}
	private syncListeners(): void {
		if (this.destroyed || !this.isAnyReferenceEnabled()) {
			for (const event of this.events) this.app.vault.offref?.(event);
			for (const event of this.metadataEvents) this.app.metadataCache.offref?.(event);
			this.events = [];
			this.metadataEvents = [];
			return;
		}
		if (this.events.length > 0 || !this.app.vault?.on) return;
		const app = this.app;
		this.events.push(
			app.vault.on('modify', (file: TAbstractFile) => this.handleVaultEvent('modify', file)),
			app.vault.on('rename', (file: TAbstractFile, oldPath: string) => this.handleVaultEvent('rename', file, oldPath)),
			app.vault.on('create', (file: TAbstractFile) => this.handleVaultEvent('create', file)),
			app.vault.on('delete', (file: TAbstractFile) => this.handleVaultEvent('delete', file))
		);
		if (app.metadataCache?.on) {
			this.metadataEvents.push(app.metadataCache.on('changed', (file?: TFile) => this.handleMetadataChanged(file)));
		}
	}
	private isNovelInfoFile(file: TFile): boolean {
		return getCandidateNames(this.plugin.settings.novelInfo?.fileName || getDefaultFileName('novelInfoFileName'), 'novelInfoFileName').has(file.basename);
	}
	private isSourcePath(path: string): boolean {
		const name = path.split('/').pop() || '';
		const basename = name.replace(/\.md$/i, '');
		return getCandidateNames(this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName'), 'timelineFileName').has(basename)
			|| getCandidateNames(this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName'), 'foreshadowingFileName').has(basename);
	}
	private isNovelInfoPath(path: string): boolean {
		const name = path.split('/').pop() || '';
		const basename = name.replace(/\.md$/i, '');
		return getCandidateNames(this.plugin.settings.novelInfo?.fileName || getDefaultFileName('novelInfoFileName'), 'novelInfoFileName').has(basename);
	}
	private isPathUnderOrEqual(targetPath: string, rootPath: string): boolean {
		return Boolean(rootPath) && (targetPath === rootPath || targetPath.startsWith(rootPath + '/'));
	}
	private invalidateSourceCache(path: string): void {
		this.timelineCache.delete(path);
		this.foreshadowingCache.delete(path);
	}
	private collectBookAffectedPaths(bookRoot: string, fallbackPath: string, affected: Set<string>): void {
		for (const [chPath, rec] of this.chapters) {
			if (bookRoot ? rec.bookRoot === bookRoot : this.isPathUnderOrEqual(chPath, fallbackPath)) {
				affected.add(chPath);
			}
		}
		for (const [chPath, rec] of this.pendingContexts) {
			if (bookRoot ? rec.bookRoot === bookRoot : this.isPathUnderOrEqual(chPath, fallbackPath)) {
				affected.add(chPath);
			}
		}
	}
	private applyScopedInvalidation(affected: Set<string>): void {
		if (affected.size === 0) return;
		for (const path of affected) {
			this.chapters.delete(path);
			this.pending.delete(path);
			this.pendingContexts.delete(path);
		}
		this.emitRefresh();
	}
	private invalidateBookForSource(file: TFile): void {
		const affected = new Set<string>();
		this.invalidateSourceCache(file.path);
		const bookRoot = findBookRoot(this.app, this.plugin, file, true);
		const parentPath = file.parent?.path || '';
		this.collectBookAffectedPaths(bookRoot, parentPath, affected);
		this.applyScopedInvalidation(affected);
	}
	private handleVaultEvent(kind: 'modify' | 'create' | 'delete' | 'rename', file?: TAbstractFile, oldPath?: string): void {
		if (this.destroyed) return;
		if (!file) {
			this.clearCache();
			this.notifyRefresh();
			return;
		}
		const affected = new Set<string>();
		if (kind === 'modify') {
			if (!(file instanceof TFile)) return;
			if (this.isSource(file)) {
				this.invalidateBookForSource(file);
			}
			return;
		}

		const pathsToCheck = oldPath !== undefined ? [file.path, oldPath] : [file.path];
		if (file instanceof TFile) {
			if (this.isSource(file) || (oldPath !== undefined && this.isSourcePath(oldPath))) {
				this.invalidateSourceCache(file.path);
				if (oldPath !== undefined) this.invalidateSourceCache(oldPath);
			}
			for (const p of pathsToCheck) {
				if (this.chapters.has(p) || this.pendingContexts.has(p)) affected.add(p);
				const br = p === file.path ? findBookRoot(this.app, this.plugin, file, true) : '';
				if (br) {
					this.collectBookAffectedPaths(br, p, affected);
				} else {
					for (const [chPath, rec] of this.chapters) {
						if (rec.bookRoot && this.isPathUnderOrEqual(p, rec.bookRoot)) affected.add(chPath);
					}
					for (const [chPath, rec] of this.pendingContexts) {
						if (rec.bookRoot && this.isPathUnderOrEqual(p, rec.bookRoot)) affected.add(chPath);
					}
				}
				if (this.isNovelInfoFile(file) || (oldPath !== undefined && this.isNovelInfoPath(oldPath))) {
					const parentDir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
					for (const [chPath] of this.chapters) {
						if (!parentDir || this.isPathUnderOrEqual(chPath, parentDir)) affected.add(chPath);
					}
					for (const [chPath] of this.pendingContexts) {
						if (!parentDir || this.isPathUnderOrEqual(chPath, parentDir)) affected.add(chPath);
					}
				}
			}
		} else {
			for (const p of pathsToCheck) {
				for (const [chPath, rec] of this.chapters) {
					if (this.isPathUnderOrEqual(chPath, p) || this.isPathUnderOrEqual(p, chPath)
						|| (rec.bookRoot && (this.isPathUnderOrEqual(rec.bookRoot, p) || this.isPathUnderOrEqual(p, rec.bookRoot)))) {
						affected.add(chPath);
					}
				}
				for (const [chPath, rec] of this.pendingContexts) {
					if (this.isPathUnderOrEqual(chPath, p) || this.isPathUnderOrEqual(p, chPath)
						|| (rec.bookRoot && (this.isPathUnderOrEqual(rec.bookRoot, p) || this.isPathUnderOrEqual(p, rec.bookRoot)))) {
						affected.add(chPath);
					}
				}
			}
			if (file instanceof TFolder && (kind === 'create' || kind === 'rename')) {
				const parentDir = file.parent?.path || '';
				if (parentDir) {
					for (const [chPath] of this.chapters) {
						if (this.isPathUnderOrEqual(chPath, parentDir)) affected.add(chPath);
					}
					for (const [chPath] of this.pendingContexts) {
						if (this.isPathUnderOrEqual(chPath, parentDir)) affected.add(chPath);
					}
				}
			}
		}
		this.applyScopedInvalidation(affected);
	}
	private handleMetadataChanged(file?: TFile): void {
		if (this.destroyed) return;
		if (!file) {
			this.notifyRefresh();
			return;
		}
		const affected = new Set<string>();
		if (this.isSource(file)) {
			this.invalidateSourceCache(file.path);
			const bookRoot = findBookRoot(this.app, this.plugin, file, true);
			this.collectBookAffectedPaths(bookRoot, file.parent?.path || '', affected);
			this.applyScopedInvalidation(affected);
			return;
		}
		if (this.isNovelInfoFile(file)) {
			const parentDir = file.parent?.path || '';
			for (const [chPath] of this.chapters) {
				if (!parentDir || this.isPathUnderOrEqual(chPath, parentDir)) affected.add(chPath);
			}
			for (const [chPath] of this.pendingContexts) {
				if (!parentDir || this.isPathUnderOrEqual(chPath, parentDir)) affected.add(chPath);
			}
			this.applyScopedInvalidation(affected);
			return;
		}
		if (this.pendingContexts.has(file.path)) {
			affected.add(file.path);
		}
		const cached = this.chapters.get(file.path);
		if (cached) {
			const next = this.isSingleFileEligible(file);
			const nextAliasesKey = this.getAliasesKey(file);
			if (nextAliasesKey !== cached.aliasesKey) {
				this.collectBookAffectedPaths(cached.bookRoot, file.parent?.path || '', affected);
			} else if (next.eligible !== cached.eligible || next.bookRoot !== cached.bookRoot) {
				affected.add(file.path);
			}
		} else if (!this.pendingContexts.has(file.path)) {
			// Another file in a known book (e.g. chapter alias frontmatter change) may affect link resolution
			const bookRoot = findBookRoot(this.app, this.plugin, file, true);
			if (bookRoot) {
				this.collectBookAffectedPaths(bookRoot, file.parent?.path || '', affected);
			}
		}
		this.applyScopedInvalidation(affected);
	}
	private getAliasesKey(file: TFile): string {
		const fm = this.app.metadataCache?.getFileCache?.(file)?.frontmatter;
		if (!fm) return '';
		const raw: unknown = fm.aliases ?? fm.alias;
		return raw === undefined ? '' : JSON.stringify(raw);
	}
	private isSingleFileEligible(file: TFile | null): { eligible: boolean; bookRoot: string } {
		if (!file || file.extension !== 'md') return { eligible: false, bookRoot: '' };
		const bookRoot = findBookRoot(this.app, this.plugin, file, true);
		if (!bookRoot) return { eligible: false, bookRoot: '' };
		if (this.app.vault.getAbstractFileByPath(file.path) !== file) return { eligible: false, bookRoot };
		if (ChapterSorter.isFunctionalDoc(file, this.plugin)
			|| this.plugin.characterManager?.isLorePath?.(bookRoot, file.parent?.path || '')) {
			return { eligible: false, bookRoot };
		}
		if (this.plugin.settings.enableStrictChapterMode) {
			return {
				eligible: ChapterSorter.isChapterFile(file.basename) || this.plugin.isFileInStrictChapterException(file),
				bookRoot
			};
		}
		return { eligible: true, bookRoot };
	}
	private settingsKey(): string {
		return JSON.stringify([this.plugin.settings.timeline, this.plugin.settings.foreshadowing,
			this.plugin.settings.workspaceFolders, this.plugin.settings.enableStrictChapterMode,
			this.plugin.settings.chapterNamingRules, this.plugin.settings.loreFolderName, this.plugin.settings.novelInfo]);
	}
	private checkSettings(): void {
		const key = this.settingsKey();
		if (key !== this.configuration) { this.configuration = key; this.clearCache(); }
		this.syncListeners();
	}
	public refreshSettings(): void { if (this.settingsKey() !== this.configuration) this.notifyRefresh(); }
	private isSource(file: TFile): boolean {
		return getCandidateNames(this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName'), 'timelineFileName').has(file.basename)
			|| getCandidateNames(this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName'), 'foreshadowingFileName').has(file.basename);
	}
	public isAnyReferenceEnabled(): boolean {
		return Boolean(this.plugin.settings.timeline?.showEditorReferences || this.plugin.settings.foreshadowing?.showEditorReferences);
	}
	public isEligibleChapter(file: TFile | null): { eligible: boolean; bookRoot: string } {
		return this.isSingleFileEligible(file);
	}
	public getReferencesSync(file: TFile): ChapterReferenceItem[] | null {
		this.checkSettings();
		if (this.destroyed || !this.isAnyReferenceEnabled()) return [];
		const bookRoot = findBookRoot(this.app, this.plugin, file, true);
		if (!bookRoot) return [];
		const cached = this.chapters.get(file.path);
		return cached?.file === file && cached.bookRoot === bookRoot ? cached.items : null;
	}
	public async prefetchReferences(file: TFile): Promise<ChapterReferenceItem[]> {
		this.checkSettings();
		if (this.destroyed || !this.isAnyReferenceEnabled()) return [];
		const path = file.path;
		const existing = this.chapters.get(path);
		if (existing?.file === file) return existing.items;
		const inFlight = this.pending.get(path);
		if (inFlight) return inFlight;
		const generation = this.generation;
		const token = ++this.nextPendingToken;
		const initialBookRoot = findBookRoot(this.app, this.plugin, file, true);
		this.pendingContexts.set(path, { file, bookRoot: initialBookRoot, token });
		const promise = this.collect(file, path, generation, token);
		this.pending.set(path, promise);
		try { return await promise; }
		finally {
			if (this.pending.get(path) === promise) this.pending.delete(path);
			if (this.pendingContexts.get(path)?.token === token) this.pendingContexts.delete(path);
		}
	}
	private isCollectStale(file: TFile, path: string, generation: number, token: number): boolean {
		return this.destroyed || generation !== this.generation || file.path !== path || this.pendingContexts.get(path)?.token !== token;
	}
	public async setReferenceImportance(item: ChapterReferenceItem, important: boolean): Promise<void> {
		if (this.destroyed) {
			throw new Error('ChapterReferenceService is destroyed');
		}
		if (item.type === 'timeline') {
			const target = item.timelineTarget;
			if (!target) {
				throw new Error('Missing timeline reference target');
			}
			await this.plugin.timelineManager.setItemImportance(
				target.itemIndex,
				important,
				target.folderPath,
				target.expectedEntry,
				{
					file: item.sourceFile,
					path: target.sourcePath
				}
			);
		} else {
			const target = item.foreshadowingTarget;
			if (!target) {
				throw new Error('Missing foreshadowing reference target');
			}
			await this.plugin.foreshadowingManager.setEntryImportance(item.sourceFile, important, target.sourcePath, target.rawBlock);
		}
		if (!this.destroyed) this.invalidateBookForSource(item.sourceFile);
	}
	private async collect(file: TFile, path: string, generation: number, token: number): Promise<ChapterReferenceItem[]> {
		const { eligible, bookRoot } = this.isEligibleChapter(file);
		const items: ChapterReferenceItem[] = [];
		if (eligible) {
			if (this.plugin.settings.timeline?.showEditorReferences) {
				const source = this.plugin.timelineManager.findTimelineFile(bookRoot);
				if (source) {
					const entries = await this.readSource(source, this.timelineCache, content => this.plugin.timelineManager.parseEntries(content, bookRoot));
					if (this.isCollectStale(file, path, generation, token)) return [];
					for (const [nodeIndex, node] of this.plugin.timelineManager.getTimelineNodesForChapter(file, entries, bookRoot, source).entries()) {
						const sourceItems = node.entry.items;
						let lastItemIndex = -1;
						for (const [itemIndex, item] of node.items.entries()) {
							let sourceItemIndex: number;
							if (sourceItems && sourceItems.length > 0) {
								sourceItemIndex = sourceItems.indexOf(item, lastItemIndex + 1);
								if (sourceItemIndex === -1) sourceItemIndex = sourceItems.indexOf(item);
								if (sourceItemIndex >= 0) lastItemIndex = sourceItemIndex;
							} else {
								sourceItemIndex = itemIndex;
							}
							if (!item.origin?.trim()) continue;
							items.push({ id: 'timeline:' + source.path + ':' + nodeIndex + ':' + itemIndex, type: 'timeline', quote: item.origin.trim(),
								description: item.description, time: getTimelineNodeDisplayTime(node), eventType: node.type, important: Boolean(item.important),
								lores: node.lores, sourceFile: source, recordText: node.entry.rawBlock,
								timelineTarget: sourceItemIndex >= 0 ? {
									folderPath: bookRoot,
									sourcePath: source.path,
									itemIndex: sourceItemIndex,
									expectedEntry: node.entry
								} : undefined });
						}
					}
				}
			}
			if (this.plugin.settings.foreshadowing?.showEditorReferences) {
				const source = this.plugin.foreshadowingManager.findForeshadowingFile(bookRoot);
				if (source) {
					const entries = await this.readSource(source, this.foreshadowingCache, content => this.plugin.foreshadowingManager.parseEntries(content));
					if (this.isCollectStale(file, path, generation, token)) return [];
					const index = ChapterSorter.createReferenceIndex(this.app, this.plugin, bookRoot, { sourcePath: source.path });
					for (const [entryIndex, entry] of entries.entries()) {
						const foreshadowingTarget: ForeshadowingReferenceTarget | undefined = entry.rawBlock
							? { sourcePath: source.path, rawBlock: entry.rawBlock }
							: undefined;
						for (const [contentIndex, content] of entry.contents.entries()) {
							if (!content.text?.trim() || index.resolve(content.source || entry.sourceFile)?.path !== path) continue;
							items.push({ id: 'foreshadowing:' + source.path + ':' + entryIndex + ':creation:' + contentIndex, type: 'foreshadowing', kind: 'creation',
								quote: content.text.trim(), description: entry.description, time: content.time || entry.createdAt, status: entry.status,
								important: Boolean(entry.important), tags: entry.tags, sourceFile: source, recordText: entry.rawBlock, foreshadowingTarget });
						}
						for (const [logIndex, log] of (entry.recoveryLogs ?? []).entries()) {
							if (!log.quote?.trim() || index.resolve(log.file)?.path !== path) continue;
							items.push({ id: 'foreshadowing:' + source.path + ':' + entryIndex + ':recovery:' + logIndex, type: 'foreshadowing', kind: 'recovery',
								quote: log.quote.trim(), description: entry.description, time: log.time, status: entry.status, important: Boolean(entry.important),
								tags: entry.tags, stageType: log.stageType, note: log.note, sourceFile: source, recordText: entry.rawBlock, foreshadowingTarget });
						}
					}
				}
			}
		}
		this.checkSettings();
		if (this.isCollectStale(file, path, generation, token)) return [];
		this.chapters.set(path, { file, bookRoot, eligible, aliasesKey: this.getAliasesKey(file), items });
		if (this.chapters.size > 80) this.chapters.delete(this.chapters.keys().next().value!);
		return items;
	}
	private async readSource<T>(file: TFile, cache: Map<string, SourceRecord<T>>, parse: (content: string) => T[]): Promise<T[]> {
		const path = file.path;
		const mtime = file.stat?.mtime ?? 0;
		const size = file.stat?.size ?? 0;
		const cached = cache.get(path);
		if (cached?.file === file && cached.mtime === mtime && cached.size === size) return cached.read;
		const read = this.app.vault.read(file).then(content => {
			if (this.destroyed) return [];
			if (file.path !== path || (file.stat?.mtime ?? 0) !== mtime || (file.stat?.size ?? 0) !== size) throw new Error('Reference source changed during read');
			return parse(content);
		});
		this.activeReads.add(read);
		void read.then(() => this.activeReads.delete(read), () => this.activeReads.delete(read));
		const record = { file, path, mtime, size, read };
		cache.set(path, record);
		if (cache.size > 80) cache.delete(cache.keys().next().value!);
		try { return await read; }
		catch (error) { if (cache.get(path) === record) cache.delete(path); throw error; }
	}
	public onRefresh(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
	private emitRefresh(): void {
		if (this.destroyed) return;
		this.checkSettings();
		for (const listener of this.listeners) {
			try { listener(); } catch (error) { console.error('[ChapterReferenceService] Could not refresh an editor:', error); }
		}
	}
	public notifyRefresh(): void {
		if (this.destroyed) return;
		this.checkSettings();
		this.chapters.clear(); this.pending.clear(); this.pendingContexts.clear(); this.generation++;
		for (const listener of this.listeners) {
			try { listener(); } catch (error) { console.error('[ChapterReferenceService] Could not refresh an editor:', error); }
		}
	}
	public clearCache(): void {
		this.timelineCache.clear(); this.foreshadowingCache.clear(); this.chapters.clear(); this.pending.clear(); this.pendingContexts.clear(); this.generation++;
	}
	public async destroy(): Promise<void> {
		const reads = [...this.pending.values(), ...this.activeReads];
		this.destroyed = true; this.listeners.clear();
		for (const event of this.events) this.app.vault.offref?.(event);
		for (const event of this.metadataEvents) this.app.metadataCache.offref?.(event);
		this.metadataEvents = [];
		this.events = []; this.clearCache();
		await Promise.allSettled(reads);
	}
}
