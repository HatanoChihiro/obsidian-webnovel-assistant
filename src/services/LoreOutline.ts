import type { HeadingCache } from 'obsidian';
import { cleanLoreHeading } from './CharacterManager';

export const loreRelationHeadings = new Set(['关系', '關係', 'relation', 'relations', 'relationships']);
const inlineRelation = /^ {0,3}(?:关系|關係|relations?)::[ \t]+(.+?)[ \t]+(?:→|->)[ \t]+\[\[([^\]\r\n]+)\]\][ \t]*$/i;

export function readLoreInlineRelation(line: string): { label: string; link: string } | undefined {
	const match = inlineRelation.exec(line);
	if (match?.[1].trim() && match[2].trim()) return { label: match[1].trim(), link: match[2].trim() };
	return undefined;
}

export interface LoreOutlineHeading {
	title: string;
	level: number;
	line: number;
	bodyStart: number;
	bodyEnd: number;
	path: string[];
	key: string;
	parent?: LoreOutlineHeading;
}

/** Parent and section boundaries come from Obsidian's parsed headings. */
export function buildLoreOutline(headings: readonly HeadingCache[], lineCount: number): LoreOutlineHeading[] {
	const outline: LoreOutlineHeading[] = [];
	const stack: { heading: LoreOutlineHeading; relationBlock: boolean }[] = [];
	const occurrences = new Map<string, number>();
	const hasEntries = headings.some(heading => heading.level === 2);
	for (let index = 0; index < headings.length; index++) {
		const source = headings[index];
		while (stack.length && stack[stack.length - 1].heading.level >= source.level) stack.pop();
		const previous = stack[stack.length - 1];
		const parent = previous?.heading;
		const title = cleanLoreHeading(source.heading);
		const path = [...(parent?.path ?? []), title];
		const slot = JSON.stringify([parent?.key, title]);
		const occurrence = (occurrences.get(slot) ?? 0) + 1;
		occurrences.set(slot, occurrence);
		const relationBlock = Boolean(previous?.relationBlock) || (loreRelationHeadings.has(title.toLowerCase())
			&& (!hasEntries || (source.level === 3 && parent?.level === 2)));
		const heading: LoreOutlineHeading = {
			title, path, parent, level: source.level, line: source.position.start.line,
			bodyStart: source.position.end.line + 1,
			bodyEnd: headings[index + 1]?.position.start.line ?? lineCount,
			key: `${parent?.key ?? ''}/${JSON.stringify([title, occurrence])}`,
		};
		stack.push({ heading, relationBlock });
		if (!relationBlock && title) outline.push(heading);
	}
	return outline;
}

export function findLoreOutlineTarget(outline: readonly LoreOutlineHeading[], parts: readonly string[]): LoreOutlineHeading | undefined {
	const names = parts.map(part => cleanLoreHeading(part).toLowerCase());
	let result: LoreOutlineHeading | undefined;
	for (const heading of outline) {
		if (names.length > heading.path.length) continue;
		const offset = heading.path.length - names.length;
		if (names.some((name, index) => heading.path[offset + index].toLowerCase() !== name)) continue;
		if (result) return undefined;
		result = heading;
	}
	return result;
}
