import type { LoreEntry, LoreRelationItem } from './CharacterManager';
import type { LoreRelationBlock } from './LoreOutline';

export const loreRelationsHeading = '###### 关系';

export const legacyRelationLine = /^(\s*(?:[-*]\s+)?(?:\*\*|__)?([^\n*:：]+?)(?:\*\*|__)?\s*[:：](?![:：])\s*)(.*)$/;

export function splitLoreRelationTargets(text: string): string[] {
	return (text.match(/\[\[[^\]\r\n]+\]\]|[^,，、]+?(?=\[\[|[,，、]|$)/g) ?? []).map(part => part.trim()).filter(Boolean);
}

export function loreRelationLinkName(link: string): string {
	const match = /^\[\[([^\]\r\n]+)\]\]$/.exec(link.trim());
	if (!match) return link.trim();
	const [target, alias] = match[1].split('|');
	return alias?.trim() || target.split(/[#/]/).at(-1)?.trim().replace(/\.md$/i, '') || target.trim();
}

export function formatLoreRelationTarget(entry: LoreEntry, sourcePath?: string, displayName = entry.heading): string {
	const headingPath = entry.section?.path.join('#') ?? (entry.file.basename !== entry.heading ? entry.heading : undefined);
	const filePath = headingPath && sourcePath === entry.file.path ? '' : entry.file.path.replace(/\.md$/i, '');
	return `[[${filePath}${headingPath ? `#${headingPath}` : ''}|${displayName}]]`;
}

export function formatLoreRelationListItem(label: string, rawLink: string): string | undefined {
	const link = /^\[\[([^\]\r\n]+)\]\]$/.exec(rawLink.trim());
	if (!link || !label.trim() || /[\r\n*:：]/.test(label)) return undefined;
	const [target, alias] = link[1].split('|');
	if (!target.trim()) return undefined;
	return `- **${label.trim()}**：[[${target.trim()}|${alias?.trim() || loreRelationLinkName(rawLink)}]]`;
}

export function planLoreRelationBlockInsertion(lines: readonly string[], bodyEnd: number, blocks: readonly LoreRelationBlock[], items: readonly string[]) {
	const block = blocks.find(candidate => candidate.level === 6);
	if (!block) {
		const leadingBlank = bodyEnd > 0 && lines[bodyEnd - 1].trim() ? [''] : [];
		return { line: bodyEnd, lines: [...leadingBlank, loreRelationsHeading, ...items, ''] };
	}
	let line = block.end;
	while (line > block.bodyStart && !lines[line - 1].trim()) line--;
	return { line, lines: [...items, ...(line === block.end ? [''] : [])] };
}

export function planLoreRelationEdits(previous: readonly LoreRelationItem[], requested: readonly LoreRelationItem[],
	format: (relation: LoreRelationItem) => string | undefined): { kept: Set<number>; inserted: string[] } | undefined {
	const kept = new Set<number>();
	const inserted: string[] = [];
	for (const row of requested) {
		if (!row.label.trim() || !row.target.trim()) continue;
		const same = (old: LoreRelationItem, index: number) => !kept.has(index) && old.label.trim() === row.label.trim()
			&& old.target.trim() === row.target.trim() && (row.rawTarget === undefined || old.rawTarget === row.rawTarget);
		const index = row.sourceId === undefined ? previous.findIndex(same)
			: previous[row.sourceId] && same(previous[row.sourceId], row.sourceId) ? row.sourceId : -1;
		if (index >= 0) {
			kept.add(index);
			continue;
		}
		const next = format(row);
		if (!next) return undefined;
		inserted.push(next);
	}
	return { kept, inserted };
}

export function rewriteLoreRelationLines(previous: readonly LoreRelationItem[], kept: ReadonlySet<number>): Map<number, string> {
	const grouped = new Map<number, number[]>();
	for (const [index, row] of previous.entries()) {
		if (row.sourceLine === undefined) continue;
		const indexes = grouped.get(row.sourceLine) ?? [];
		indexes.push(index);
		grouped.set(row.sourceLine, indexes);
	}
	const result = new Map<number, string>();
	for (const [line, indexes] of grouped) {
		const surviving = indexes.filter(index => kept.has(index));
		if (surviving.length === indexes.length) continue;
		const raw = previous[indexes[0]].rawLine ?? '';
		const prefix = legacyRelationLine.exec(raw)?.[1] ?? '';
		result.set(line, surviving.length ? prefix + surviving.map(index => previous[index].rawTarget).join('、') : '');
	}
	return result;
}
