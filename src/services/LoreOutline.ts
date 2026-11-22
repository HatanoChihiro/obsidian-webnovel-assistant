import type { HeadingCache } from 'obsidian';
import { cleanLoreHeading } from './CharacterManager';
import { scanFenceLine, type FenceScanState } from './LoreTemplateService';

export const loreRelationHeadings = new Set(['关系', '關係', 'relation', 'relations', 'relationships']);

export interface LoreRelationBlock {
	level: number;
	start: number;
	bodyStart: number;
	end: number;
}

export interface LoreOutlineHeading {
	title: string;
	level: number;
	line: number;
	bodyStart: number;
	bodyEnd: number;
	subtreeEnd: number;
	relationBlocks: LoreRelationBlock[];
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
	const stack: { heading: LoreOutlineHeading; relationBlock: boolean; relationOwner?: LoreOutlineHeading }[] = [];
	const occurrences = new Map<string, number>();
	const close = (end: number) => {
		const { heading, relationOwner } = stack.pop()!;
		heading.subtreeEnd = end;
		if (relationOwner) {
			relationOwner.relationBlocks.push({ level: heading.level, start: heading.line, bodyStart: heading.bodyStart, end });
			if (heading.level === 6 && relationOwner.level === 6) relationOwner.subtreeEnd = end;
		}
	};
	for (let index = 0; index < headings.length; index++) {
		const source = headings[index];
		const title = cleanLoreHeading(source.heading);
		const isRelation = loreRelationHeadings.has(title.toLowerCase());
		const last = stack.at(-1);
		// Level six has no child heading level, so a following H6 relation block belongs to that entry.
		const precedingSix = isRelation && source.level === 6 && last?.heading.level === 6
			? last.relationBlock ? last.relationOwner : last.heading : undefined;
		while (stack.length && stack[stack.length - 1].heading.level >= source.level) close(source.position.start.line);
		const previous = stack[stack.length - 1];
		const parent = previous?.heading;
		const path = [...(parent?.path ?? []), title];
		const slot = JSON.stringify([parent?.key, title]);
		const occurrence = (occurrences.get(slot) ?? 0) + 1;
		occurrences.set(slot, occurrence);
		const relationBlock = Boolean(previous?.relationBlock) || isRelation;
		const heading: LoreOutlineHeading = {
			title, path, parent, level: source.level, line: source.position.start.line,
			bodyStart: source.position.end.line + 1,
			bodyEnd: headings[index + 1]?.position.start.line ?? lineCount,
			subtreeEnd: lineCount, relationBlocks: [],
			key: `${parent?.key ?? ''}/${JSON.stringify([title, occurrence])}`,
		};
		const relationOwner = isRelation && !previous?.relationBlock ? precedingSix ?? parent : undefined;
		stack.push({ heading, relationBlock, relationOwner });
		if (!relationBlock && title) outline.push(heading);
	}
	while (stack.length) close(lineCount);
	return outline;
}

export function getLoreSectionText(lines: readonly string[], section: LoreOutlineHeading): string {
	return lines.slice(section.bodyStart, section.bodyEnd).join('\n').trim();
}

export function getFileLoreRelationBlocks(headings: readonly HeadingPosition[], lineCount: number): LoreRelationBlock[] {
	const blocks: LoreRelationBlock[] = [];
	for (const [index, heading] of headings.entries()) {
		const start = heading.position.start.line;
		if (start < (blocks.at(-1)?.end ?? 0) || !loreRelationHeadings.has(cleanLoreHeading(heading.heading).toLowerCase())) continue;
		const next = headings.slice(index + 1).find(item => item.level <= heading.level);
		blocks.push({ level: heading.level, start, bodyStart: heading.position.end.line + 1, end: next?.position.start.line ?? lineCount });
	}
	return blocks;
}

export function relationBodyLines(lines: readonly string[], block: LoreRelationBlock): string[] {
	const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	let comment: '%%' | '-->' | undefined;
	return lines.slice(block.bodyStart, block.end).map(line => {
		if (comment) {
			if (line.includes(comment)) comment = undefined;
			return '';
		}
		const state = scanFenceLine(line, fence);
		if (state.inFenceBefore || state.inFenceAfter) return '';
		if (line.trimStart().startsWith('<!--')) {
			if (!line.includes('-->')) comment = '-->';
			return '';
		}
		if (line.trimStart().startsWith('%%')) {
			if (line.trimStart().indexOf('%%', 2) < 0) comment = '%%';
			return '';
		}
		return line;
	});
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
