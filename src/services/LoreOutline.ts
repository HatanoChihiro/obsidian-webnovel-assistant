import type { HeadingCache } from 'obsidian';
import { cleanLoreHeading } from './CharacterManager';
import { scanFenceLine, type FenceScanState } from './LoreTemplateService';

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
	subtreeEnd: number;
	relationBlocks: { start: number; end: number }[];
	path: string[];
	key: string;
	parent?: LoreOutlineHeading;
}

export type HeadingPosition = Pick<HeadingCache, 'heading' | 'level'> & {
	position: { start: { line: number }; end: { line: number } };
};

export function getLoreFrontmatterEnd(lines: readonly string[]): number {
	return lines[0]?.trimEnd() === '---' ? lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\r?$/.test(line)) : -1;
}

/** A fresh section lookup for edits made inside Vault.process. */
export function scanLoreHeadings(lines: readonly string[]): HeadingPosition[] {
	const headings: HeadingPosition[] = [];
	const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	let commented = false;
	let htmlCommented = false;
	let paragraphLine = -1;
	for (let index = getLoreFrontmatterEnd(lines) + 1; index < lines.length; index++) {
		const line = lines[index].replace(/\r$/, '');
		if (htmlCommented) {
			htmlCommented = !line.includes('-->');
			paragraphLine = -1;
			continue;
		}
		if (!commented) {
			const state = scanFenceLine(line, fence);
			if (state.inFenceBefore || state.inFenceAfter) {
				paragraphLine = -1;
				continue;
			}
		}
		const startsInComment = commented;
		if ((line.match(/%%/g)?.length ?? 0) % 2) commented = !commented;
		const startsHtmlComment = !startsInComment && !commented && /^ {0,3}<!--/.test(line);
		if (startsHtmlComment) htmlCommented = !line.includes('-->');
		if (startsInComment || commented || startsHtmlComment) {
			paragraphLine = -1;
			continue;
		}
		const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line);
		if (atx) {
			headings.push({ heading: (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim(), level: atx[1].length,
				position: { start: { line: index }, end: { line: index } } });
			paragraphLine = -1;
			continue;
		}
		const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
		if (paragraphLine >= 0 && paragraphLine === index - 1 && underline) {
			headings.push({ heading: lines[paragraphLine].trim(), level: underline[1][0] === '=' ? 1 : 2,
				position: { start: { line: paragraphLine }, end: { line: index } } });
			paragraphLine = -1;
			continue;
		}
		paragraphLine = /^ {0,3}[^\s>#`~|*-]/.test(line) ? index : -1;
	}
	return headings;
}

/** Parent and section boundaries come from Obsidian's parsed headings. */
export function buildLoreOutline(headings: readonly HeadingPosition[], lineCount: number): LoreOutlineHeading[] {
	const outline: LoreOutlineHeading[] = [];
	const stack: { heading: LoreOutlineHeading; relationBlock: boolean }[] = [];
	const occurrences = new Map<string, number>();
	for (let index = 0; index < headings.length; index++) {
		const source = headings[index];
		while (stack.length && stack[stack.length - 1].heading.level >= source.level) {
			const closed = stack.pop()!.heading;
			closed.subtreeEnd = source.position.start.line;
			if (loreRelationHeadings.has(closed.title.toLowerCase()) && closed.parent) {
				closed.parent.relationBlocks.push({ start: closed.line, end: closed.subtreeEnd });
			}
		}
		const previous = stack[stack.length - 1];
		const parent = previous?.heading;
		const title = cleanLoreHeading(source.heading);
		const path = [...(parent?.path ?? []), title];
		const slot = JSON.stringify([parent?.key, title]);
		const occurrence = (occurrences.get(slot) ?? 0) + 1;
		occurrences.set(slot, occurrence);
		const relationBlock = Boolean(previous?.relationBlock) || loreRelationHeadings.has(title.toLowerCase());
		const heading: LoreOutlineHeading = {
			title, path, parent, level: source.level, line: source.position.start.line,
			bodyStart: source.position.end.line + 1,
			bodyEnd: headings[index + 1]?.position.start.line ?? lineCount,
			subtreeEnd: lineCount, relationBlocks: [],
			key: `${parent?.key ?? ''}/${JSON.stringify([title, occurrence])}`,
		};
		stack.push({ heading, relationBlock });
		if (!relationBlock && title) outline.push(heading);
	}
	for (const { heading } of stack) {
		if (loreRelationHeadings.has(heading.title.toLowerCase()) && heading.parent) {
			heading.parent.relationBlocks.push({ start: heading.line, end: lineCount });
		}
	}
	return outline;
}

export function getLoreSectionText(lines: readonly string[], section: LoreOutlineHeading): string {
	return lines.slice(section.bodyStart, section.bodyEnd).join('\n').trim();
}

export function getLoreInlineRelations(lines: readonly string[], start: number, end: number) {
	const declarations: Array<{ line: number; label: string; link: string }> = [];
	const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	let commented = false;
	let htmlCommented = false;
	for (let index = start; index < end; index++) {
		const text = lines[index].replace(/\r$/, '');
		if (htmlCommented) {
			htmlCommented = !text.includes('-->');
			continue;
		}
		if (!commented) {
			const state = scanFenceLine(text, fence);
			if (state.inFenceBefore || state.inFenceAfter) continue;
		}
		const startsInComment = commented;
		if ((text.match(/%%/g)?.length ?? 0) % 2) commented = !commented;
		if (startsInComment || commented) continue;
		if (/^ {0,3}<!--/.test(text)) {
			htmlCommented = !text.includes('-->');
			continue;
		}
		const relation = readLoreInlineRelation(text);
		if (relation) declarations.push({ line: index, ...relation });
	}
	return declarations;
}

export function getLoreSectionProse(lines: readonly string[], section: LoreOutlineHeading): string {
	const relationLines = new Set(getLoreInlineRelations(lines, section.bodyStart, section.bodyEnd).map(relation => relation.line));
	return lines.slice(section.bodyStart, section.bodyEnd).filter((_line, offset) => !relationLines.has(section.bodyStart + offset)).join('\n').trim();
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
