import type { App, TFile } from 'obsidian';
import { cleanLoreHeading, type CharacterManager, type LoreEntry } from './CharacterManager';
import { CORKBOARD_STATUS_MAP, getCorkboardStatusText } from '../i18n/data-keys';

type CachedSearchFile = { mtime: number; units: number } & (
	| { kind: 'chapter'; text: string }
	| { kind: 'lore'; sections: Map<string, string> }
);

export function normalizeWorkbenchSearchText(value: unknown): string {
	if (value === null || value === undefined) return '';
	const str = typeof value === 'string' ? value : (typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value));
	return str.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function getChapterStatusSearchText(rawStatus: unknown): string {
	if (typeof rawStatus !== 'string') return normalizeWorkbenchSearchText(rawStatus);
	const status = CORKBOARD_STATUS_MAP[rawStatus] ?? rawStatus;
	return normalizeWorkbenchSearchText([rawStatus, status, getCorkboardStatusText(status)].join('\n'));
}

export function tokenizeWorkbenchFilter(query: string): string[] {
	return normalizeWorkbenchSearchText(query)
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

export function matchesWorkbenchFilter(searchableText: string, tokens: readonly string[]): boolean {
	return tokens.every(token => searchableText.includes(token));
}

export const MAX_WORKBENCH_SEARCH_HISTORY = 20;

export function resolveWorkbenchFilterTokens(query: string | readonly string[]): string[] {
	if (typeof query === 'string') {
		return tokenizeWorkbenchFilter(query);
	}
	return query
		.map(token => normalizeWorkbenchSearchText(token).trim())
		.filter(Boolean);
}

export function sanitizeWorkbenchSearchHistory(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	const result: string[] = [];
	const seen = new Set<string>();

	for (const item of list) {
		if (typeof item !== 'string') continue;
		const trimmed = item.trim();
		if (!trimmed) continue;
		const normalized = normalizeWorkbenchSearchText(trimmed);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			result.push(trimmed);
			if (result.length >= MAX_WORKBENCH_SEARCH_HISTORY) {
				break;
			}
		}
	}

	return result;
}

export function rememberWorkbenchSearchHistory(
	history: unknown,
	keyword: string
): string[] {
	const trimmed = keyword.trim();
	const sanitized = sanitizeWorkbenchSearchHistory(history);
	if (!trimmed) return sanitized;
	const normalized = normalizeWorkbenchSearchText(trimmed);
	const filtered = sanitized.filter(item => normalizeWorkbenchSearchText(item) !== normalized);
	return [trimmed, ...filtered].slice(0, MAX_WORKBENCH_SEARCH_HISTORY);
}

export function stripMarkdownFrontmatter(content: string): string {
	const firstNewlineIndex = content.search(/\r?\n/);
	const firstLine = firstNewlineIndex === -1 ? content : content.slice(0, firstNewlineIndex);
	if (firstLine.replace(/^\uFEFF/, '').trim() !== '---') return content;

	const lines = content.split(/\r?\n/);
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '---' || line === '...') {
			return lines.slice(i + 1).join('\n');
		}
	}

	return content;
}

export { cleanLoreHeading };

export function getLoreAliasesForBook(
	manager: Pick<CharacterManager, 'getCharactersForBook' | 'getCharacterFile'>,
	bookPath: string
): Map<string, string[]> {
	const aliasesByHeading = new Map<string, string[]>();
	for (const name of manager.getCharactersForBook(bookPath)) {
		const entry = manager.getCharacterFile(bookPath, name);
		if (!entry || name === entry.heading) continue;

		const aliases = aliasesByHeading.get(entry.heading) ?? [];
		if (!aliases.includes(name)) aliases.push(name);
		aliasesByHeading.set(entry.heading, aliases);
	}
	return aliasesByHeading;
}

/** Extract the same level-two lore sections used by CharacterManager, or fallback to file-level body text for single-file lore. */
export function extractLoreSections(content: string, fallbackHeading?: string): Map<string, string> {
	const lines = content.split(/\r?\n/);
	const headings: Array<{ line: number; level: number; text: string }> = [];

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^(#{1,2})\s+(.+?)\s*#*\s*$/);
		if (!match) continue;
		headings.push({ line: i, level: match[1].length, text: cleanLoreHeading(match[2]) });
	}

	const sections = new Map<string, string>();
	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		if (heading.level !== 2 || !heading.text) continue;

		let endLine = lines.length;
		for (let j = i + 1; j < headings.length; j++) {
			if (headings[j].level <= 2) {
				endLine = headings[j].line;
				break;
			}
		}

		sections.set(
			heading.text,
			normalizeWorkbenchSearchText(lines.slice(heading.line + 1, endLine).join('\n'))
		);
	}

	// 单文件词条模式回退：若无任何二级标题且提供了 fallbackHeading
	if (sections.size === 0 && fallbackHeading) {
		const cleanedFallback = cleanLoreHeading(fallbackHeading);
		if (cleanedFallback) {
			sections.set(
				cleanedFallback,
				normalizeWorkbenchSearchText(stripMarkdownFrontmatter(content))
			);
		}
	}

	return sections;
}

const MAX_CACHE_UNITS = 2 * 1024 * 1024; // UTF-16 code units
const MAX_CACHE_ENTRIES = 256;
const MAX_FILE_UNITS = 512 * 1024;

export class WorkbenchFilterIndex {
	private readonly cache = new Map<string, CachedSearchFile>();
	private retainedUnits = 0;
	private generation = 0;
	private invalidationRevision = 0;
	private readonly pendingReads = new Map<string, object>();

	constructor(private readonly app: App) {}

	public invalidate(path: string): void {
		this.removeCached('chapter:' + path);
		this.removeCached('lore:' + path);
		this.pendingReads.delete(path);
		this.invalidationRevision++;
	}

	public clear(): void {
		this.generation++;
		this.cache.clear();
		this.retainedUnits = 0;
		this.pendingReads.clear();
	}

	private removeCached(key: string): void {
		const entry = this.cache.get(key);
		if (!entry) return;
		this.retainedUnits -= entry.units;
		this.cache.delete(key);
	}

	private storeCached(key: string, entry: CachedSearchFile): void {
		this.removeCached(key);
		if (entry.units > MAX_FILE_UNITS) return;
		while (this.cache.size >= MAX_CACHE_ENTRIES || this.retainedUnits + entry.units > MAX_CACHE_UNITS) {
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.removeCached(oldest.value);
		}
		this.cache.set(key, entry);
		this.retainedUnits += entry.units;
	}

	public async filterChapters(
		files: readonly TFile[],
		query: string | readonly string[],
		getSynopsis: (file: TFile) => unknown,
		getStatus?: (file: TFile) => unknown,
		isCancelled?: () => boolean
	): Promise<TFile[]> {
		const expectedGeneration = this.generation;
		const tokens = resolveWorkbenchFilterTokens(query);
		if (tokens.length === 0) return [...files];

		const checkCancel = () => this.generation !== expectedGeneration || Boolean(isCancelled?.());
		if (checkCancel()) return [];

		const results: TFile[] = [];
		for (let i = 0; i < files.length; i++) {
			if (checkCancel()) return [];
			const file = files[i];
			const synopsis = getSynopsis(file);
			if (checkCancel()) return [];

			const metadataText = [
				normalizeWorkbenchSearchText(file.basename),
				normalizeWorkbenchSearchText(synopsis),
				getChapterStatusSearchText(getStatus?.(file))
			].join('\n');
			if (checkCancel()) return [];

			if (tokens.every(token => metadataText.includes(token))) {
				results.push(file);
			} else {
				const body = await this.getChapterBody(file, checkCancel);
				if (checkCancel()) return [];
				const currentMetadata = [
					normalizeWorkbenchSearchText(file.basename),
					normalizeWorkbenchSearchText(getSynopsis(file)),
					getChapterStatusSearchText(getStatus?.(file))
				].join('\n');
				if (checkCancel()) return [];
				if (tokens.every(token => currentMetadata.includes(token) || body.includes(token))) {
					results.push(file);
				}
			}

			if (i > 0 && i % 50 === 0) {
				await this.yieldToMainThread();
				if (checkCancel()) return [];
			}
		}

		return results;
	}

	public async filterLoreEntries(
		entries: readonly LoreEntry[],
		aliasesByHeading: ReadonlyMap<string, readonly string[]>,
		query: string | readonly string[],
		isCancelled?: () => boolean
	): Promise<Set<string>> {
		const expectedGeneration = this.generation;
		const tokens = resolveWorkbenchFilterTokens(query);
		const uniqueEntries = this.getUniqueLoreEntries(entries);
		if (tokens.length === 0) return new Set(uniqueEntries.map(entry => entry.heading));

		const checkCancel = () => this.generation !== expectedGeneration || Boolean(isCancelled?.());
		if (checkCancel()) return new Set();

		// Consecutive headings can share one file even when it is too large to cache.
		let lastLore: { file: TFile | null; path: string; mtime: number; revision: number; sections: Map<string, string> | null } = {
			file: null, path: '', mtime: 0, revision: -1, sections: null
		};

		const results = new Set<string>();
		for (let i = 0; i < uniqueEntries.length; i++) {
			if (checkCancel()) return new Set();
			const entry = uniqueEntries[i];
			const aliases = aliasesByHeading.get(entry.heading) ?? [];
			const metadataText = [
				normalizeWorkbenchSearchText(entry.heading),
				normalizeWorkbenchSearchText(aliases.join('\n'))
			].join('\n');

			if (tokens.every(token => metadataText.includes(token))) {
				results.add(entry.heading);
			} else {
				const file = entry.file;
				const { path } = file;
				const { mtime } = file.stat;
				const revision = this.invalidationRevision;
				const sections: Map<string, string> | null = lastLore.file === file && lastLore.path === path && lastLore.mtime === mtime && lastLore.revision === revision
					? lastLore.sections
					: await this.getLoreSections(file, checkCancel);
				if (checkCancel()) return new Set();
				lastLore = { file: sections ? file : null, path, mtime, revision, sections };
				const body = sections?.get(entry.heading) ?? '';
				const currentMetadata = [
					normalizeWorkbenchSearchText(entry.heading),
					normalizeWorkbenchSearchText((aliasesByHeading.get(entry.heading) ?? []).join('\n'))
				].join('\n');
				if (tokens.every(token => currentMetadata.includes(token) || body.includes(token))) {
					results.add(entry.heading);
				}
			}

			if (i > 0 && i % 50 === 0) {
				await this.yieldToMainThread();
				if (checkCancel()) return new Set();
			}
		}

		return results;
	}

	private getUniqueLoreEntries(entries: readonly LoreEntry[]): LoreEntry[] {
		const seen = new Set<string>();
		return entries.filter(entry => {
			const key = `${entry.file.path}\u0000${entry.heading}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	private async getChapterBody(file: TFile, isCancelled: () => boolean): Promise<string> {
		const mtime = file.stat.mtime;
		const key = 'chapter:' + file.path;
		const cached = this.cache.get(key);
		if (cached?.kind === 'chapter' && cached.mtime === mtime) return cached.text;

		const path = file.path;
		const readToken = {};
		this.pendingReads.set(path, readToken);

		try {
			const content = await this.app.vault.cachedRead(file);
			if (isCancelled()) return '';
			if (this.pendingReads.get(path) !== readToken) return '';
			if (file.path !== path || file.stat.mtime !== mtime) return '';

			const text = normalizeWorkbenchSearchText(stripMarkdownFrontmatter(content));
			this.storeCached(key, { kind: 'chapter', mtime, text, units: text.length });
			return text;
		} catch (error) {
			console.error(`[WorkbenchFilterIndex] Failed to read chapter: ${file.path}`, error);
			return '';
		} finally {
			if (this.pendingReads.get(path) === readToken) this.pendingReads.delete(path);
		}
	}

	private async getLoreSections(file: TFile, isCancelled: () => boolean): Promise<Map<string, string> | null> {
		const mtime = file.stat.mtime;
		const key = 'lore:' + file.path;
		const cached = this.cache.get(key);
		if (cached?.kind === 'lore' && cached.mtime === mtime) return cached.sections;

		const path = file.path;
		const readToken = {};
		this.pendingReads.set(path, readToken);

		try {
			const content = await this.app.vault.cachedRead(file);
			if (isCancelled() || this.pendingReads.get(path) !== readToken) return null;
			if (file.path !== path || file.stat.mtime !== mtime) return null;

			const sections = extractLoreSections(content, file.basename);
			let units = 0;
			for (const [heading, section] of sections) units += heading.length + section.length;
			this.storeCached(key, { kind: 'lore', mtime, sections, units });
			return sections;
		} catch (error) {
			console.error('[WorkbenchFilterIndex] Failed to read lore:', file.path, error);
			return null;
		} finally {
			if (this.pendingReads.get(path) === readToken) this.pendingReads.delete(path);
		}
	}

	private async yieldToMainThread(): Promise<void> {
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
	}
}
