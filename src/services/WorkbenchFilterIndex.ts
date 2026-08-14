import type { App, TFile } from 'obsidian';
import { cleanLoreHeading, type LoreEntry } from './CharacterManager';

interface CachedText {
	mtime: number;
	text: string;
}

interface CachedLoreSections {
	mtime: number;
	sections: Map<string, string>;
}

export function normalizeWorkbenchSearchText(value: unknown): string {
	if (value === null || value === undefined) return '';
	const str = typeof value === 'string' ? value : (typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value));
	return str.normalize('NFKC').toLocaleLowerCase('zh-CN');
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

export function stripMarkdownFrontmatter(content: string): string {
	const lines = content.split(/\r?\n/);
	if ((lines[0] ?? '').replace(/^\uFEFF/, '').trim() !== '---') return content;

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '---' || line === '...') {
			return lines.slice(i + 1).join('\n');
		}
	}

	return content;
}

export { cleanLoreHeading };

/** Extract the same level-two lore sections used by CharacterManager. */
export function extractLoreSections(content: string): Map<string, string> {
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

	return sections;
}

export class WorkbenchFilterIndex {
	private readonly chapterContentCache = new Map<string, CachedText>();
	private readonly loreSectionCache = new Map<string, CachedLoreSections>();

	constructor(private readonly app: App) {}

	public invalidate(path: string): void {
		this.chapterContentCache.delete(path);
		this.loreSectionCache.delete(path);
	}

	public clear(): void {
		this.chapterContentCache.clear();
		this.loreSectionCache.clear();
	}

	public async filterChapters(
		files: readonly TFile[],
		query: string,
		getSynopsis: (file: TFile) => unknown
	): Promise<TFile[]> {
		const tokens = tokenizeWorkbenchFilter(query);
		if (tokens.length === 0) return [...files];

		const results: TFile[] = [];
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const body = await this.getChapterBody(file);
			const searchableText = [
				normalizeWorkbenchSearchText(file.basename),
				normalizeWorkbenchSearchText(getSynopsis(file)),
				body
			].join('\n');

			if (matchesWorkbenchFilter(searchableText, tokens)) results.push(file);
			if (i > 0 && i % 50 === 0) await this.yieldToMainThread();
		}

		return results;
	}

	public async filterLoreEntries(
		entries: readonly LoreEntry[],
		aliasesByHeading: ReadonlyMap<string, readonly string[]>,
		query: string
	): Promise<Set<string>> {
		const tokens = tokenizeWorkbenchFilter(query);
		const uniqueEntries = this.getUniqueLoreEntries(entries);
		if (tokens.length === 0) return new Set(uniqueEntries.map(entry => entry.heading));

		const results = new Set<string>();
		for (let i = 0; i < uniqueEntries.length; i++) {
			const entry = uniqueEntries[i];
			const sections = await this.getLoreSections(entry.file);
			const aliases = aliasesByHeading.get(entry.heading) ?? [];
			const searchableText = [
				normalizeWorkbenchSearchText(entry.heading),
				normalizeWorkbenchSearchText(aliases.join('\n')),
				sections.get(entry.heading) ?? ''
			].join('\n');

			if (matchesWorkbenchFilter(searchableText, tokens)) results.add(entry.heading);
			if (i > 0 && i % 50 === 0) await this.yieldToMainThread();
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

	private async getChapterBody(file: TFile): Promise<string> {
		const mtime = file.stat.mtime;
		const cached = this.chapterContentCache.get(file.path);
		if (cached?.mtime === mtime) return cached.text;

		try {
			const content = await this.app.vault.cachedRead(file);
			const text = normalizeWorkbenchSearchText(stripMarkdownFrontmatter(content));
			this.chapterContentCache.set(file.path, { mtime, text });
			return text;
		} catch (error) {
			console.error(`[WorkbenchFilterIndex] Failed to read chapter: ${file.path}`, error);
			return '';
		}
	}

	private async getLoreSections(file: TFile): Promise<Map<string, string>> {
		const mtime = file.stat.mtime;
		const cached = this.loreSectionCache.get(file.path);
		if (cached?.mtime === mtime) return cached.sections;

		try {
			const content = await this.app.vault.cachedRead(file);
			const sections = extractLoreSections(content);
			this.loreSectionCache.set(file.path, { mtime, sections });
			return sections;
		} catch (error) {
			console.error(`[WorkbenchFilterIndex] Failed to read lore: ${file.path}`, error);
			return new Map();
		}
	}

	private async yieldToMainThread(): Promise<void> {
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
	}
}
