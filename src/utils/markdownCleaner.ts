import { REGEX_PATTERNS } from '../constants';

export interface MarkdownCleanerOptions {
	includeFootnotes?: boolean;
}

const FOOTNOTE_DEFINITION = /^\[\^[^\]\r\n]+\]:/;
const FOOTNOTE_CONTINUATION = /^(?: {2,}|\t)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function preserveNewlines(value: string): string {
	return value.replace(/[^\r\n]/g, '');
}

function findLineEnd(text: string, start: number): number {
	let index = start;
	while (index < text.length && text[index] !== '\r' && text[index] !== '\n') {
		index++;
	}
	return index;
}

function removeObsidianComments(text: string): string {
	const frontmatter = REGEX_PATTERNS.FRONTMATTER.exec(text)?.[0] ?? '';
	let result = frontmatter;
	let index = frontmatter.length;
	let atLineStart = index === 0;
	let activeFence: { char: string; len: number } | null = null;
	let currentLineEnd = -1;
	let nextPercentPair = -2;
	let backtickScanPos = 0;
	const backtickRuns = new Map<number, { ends: number[]; next: number }>();

	const findClosingBackticks = (start: number, tickCount: number): number => {
		const existing = backtickRuns.get(tickCount);
		if (existing) {
			while (existing.next < existing.ends.length && existing.ends[existing.next] - tickCount < start) {
				existing.next++;
			}
			if (existing.next < existing.ends.length) {
				const found = existing.ends[existing.next];
				existing.next++;
				return found;
			}
		}

		if (backtickScanPos < start) {
			backtickScanPos = start;
		}
		while (backtickScanPos < text.length) {
			if (text[backtickScanPos] !== '`') {
				backtickScanPos++;
				continue;
			}
			const runStart = backtickScanPos;
			while (backtickScanPos < text.length && text[backtickScanPos] === '`') {
				backtickScanPos++;
			}
			const len = backtickScanPos - runStart;
			if (len === tickCount) {
				return backtickScanPos;
			}
			let entry = backtickRuns.get(len);
			if (!entry) {
				entry = { ends: [], next: 0 };
				backtickRuns.set(len, entry);
			}
			entry.ends.push(backtickScanPos);
		}
		return -1;
	};

	while (index < text.length) {
		const ch = text[index];

		if (ch === '\r') {
			if (text[index + 1] === '\n') {
				result += '\r\n';
				index += 2;
			} else {
				result += '\r';
				index += 1;
			}
			atLineStart = true;
			continue;
		}

		if (ch === '\n') {
			result += '\n';
			index += 1;
			atLineStart = true;
			continue;
		}

		if (atLineStart) {
			if (currentLineEnd < index) {
				currentLineEnd = findLineEnd(text, index);
			}
			const lineEnd = currentLineEnd;
			const line = text.slice(index, lineEnd);

			if (activeFence) {
				result += line;
				index = lineEnd;
				atLineStart = false;
				const closeMatch = FENCE_CLOSE.exec(line);
				if (closeMatch && closeMatch[1][0] === activeFence.char && closeMatch[1].length >= activeFence.len) {
					activeFence = null;
				}
				continue;
			}

			const openMatch = FENCE_OPEN.exec(line);
			if (openMatch) {
				const fence = openMatch[1];
				const info = openMatch[2];
				if (fence[0] !== '`' || !info.includes('`')) {
					activeFence = { char: fence[0], len: fence.length };
					result += line;
					index = lineEnd;
					atLineStart = false;
					continue;
				}
			}
		}

		if (ch === '\\') {
			if (index + 1 < text.length && text[index + 1] !== '\r' && text[index + 1] !== '\n') {
				result += text.slice(index, index + 2);
				index += 2;
			} else {
				result += '\\';
				index += 1;
			}
			atLineStart = false;
			continue;
		}

		if (ch === '`') {
			let tickEnd = index;
			while (tickEnd < text.length && text[tickEnd] === '`') {
				tickEnd++;
			}
			const tickCount = tickEnd - index;
			const closeEnd = findClosingBackticks(tickEnd, tickCount);
			if (closeEnd !== -1) {
				result += text.slice(index, closeEnd);
				index = closeEnd;
			} else {
				result += text.slice(index, tickEnd);
				index = tickEnd;
			}
			atLineStart = false;
			continue;
		}

		if (ch === '%' && text[index + 1] === '%') {
			if (atLineStart) {
				const closeIndex = text.indexOf('%%', index + 2);
				if (closeIndex === -1) {
					result += preserveNewlines(text.slice(index));
					break;
				}
				result += preserveNewlines(text.slice(index, closeIndex + 2));
				index = closeIndex + 2;
				atLineStart = false;
				continue;
			}

			if (currentLineEnd < index) {
				currentLineEnd = findLineEnd(text, index);
			}
			if (nextPercentPair !== -1 && nextPercentPair < index + 2) {
				nextPercentPair = text.indexOf('%%', index + 2);
			}
			const closeIndex = nextPercentPair;
			if (closeIndex !== -1 && closeIndex + 2 <= currentLineEnd) {
				index = closeIndex + 2;
			} else {
				result += '%%';
				index += 2;
			}
			atLineStart = false;
			continue;
		}

		result += ch;
		index += 1;
		atLineStart = false;
	}

	return result;
}

function removeFootnoteDefinitions(text: string): string {
	const parts = text.split(/(\r\n|\n)/);
	const lineCount = Math.ceil(parts.length / 2);

	for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
		const partIndex = lineIndex * 2;
		if (!FOOTNOTE_DEFINITION.test(parts[partIndex] ?? '')) continue;

		parts[partIndex] = '';
		let nextLine = lineIndex + 1;

		while (nextLine < lineCount) {
			const nextPartIndex = nextLine * 2;
			const line = parts[nextPartIndex] ?? '';

			if (FOOTNOTE_CONTINUATION.test(line)) {
				parts[nextPartIndex] = '';
				nextLine++;
				continue;
			}

			if (line.trim() !== '') break;

			let followingLine = nextLine + 1;
			while (followingLine < lineCount && (parts[followingLine * 2] ?? '').trim() === '') {
				followingLine++;
			}
			if (followingLine >= lineCount || !FOOTNOTE_CONTINUATION.test(parts[followingLine * 2] ?? '')) break;

			while (nextLine < followingLine) {
				parts[nextLine * 2] = '';
				nextLine++;
			}
		}

		lineIndex = nextLine - 1;
	}

	return parts.join('');
}

function findClosingBracket(text: string, openIndex: number): number {
	let depth = 1;
	for (let index = openIndex + 1; index < text.length; index++) {
		if (text[index] === '\\') {
			index++;
			continue;
		}
		if (text[index] === '[') depth++;
		if (text[index] === ']') {
			depth--;
			if (depth === 0) return index;
		}
	}
	return -1;
}

function removeFootnoteMarkers(text: string): string {
	let result = '';
	let index = 0;

	while (index < text.length) {
		const isInlineFootnote = text[index] === '^' && text[index + 1] === '[';
		const isFootnoteReference = text[index] === '[' && text[index + 1] === '^';
		if (!isInlineFootnote && !isFootnoteReference) {
			result += text[index];
			index++;
			continue;
		}

		const openIndex = isInlineFootnote ? index + 1 : index;
		const closeIndex = findClosingBracket(text, openIndex);
		if (closeIndex === -1) {
			result += text[index];
			index++;
			continue;
		}

		result += preserveNewlines(text.slice(index, closeIndex + 1));
		index = closeIndex + 1;
	}

	return result;
}

/** Apply the shared footnote and comment inclusion policy while retaining source line breaks. */
export function applyFootnotePolicy(text: string, includeFootnotes = false): string {
	if (includeFootnotes) return text;
	return removeFootnoteMarkers(removeFootnoteDefinitions(removeObsidianComments(text)));
}

/** Clean Markdown for whole-document and per-line word counting. */
export function cleanForWordCount(text: string, options: MarkdownCleanerOptions = {}): string {
	const replaceWithNewlines = (match: string) => preserveNewlines(match);
	return applyFootnotePolicy(text, options.includeFootnotes)
		.replace(REGEX_PATTERNS.FRONTMATTER, replaceWithNewlines)
		.replace(REGEX_PATTERNS.CODE_BLOCK(), replaceWithNewlines)
		.replace(REGEX_PATTERNS.INLINE_CODE(), '')
		.replace(REGEX_PATTERNS.HEADING(), '')
		.replace(REGEX_PATTERNS.STRIKETHROUGH(), '$1')
		.replace(REGEX_PATTERNS.BOLD(), '$2')
		.replace(REGEX_PATTERNS.ITALIC(), '$2')
		.replace(REGEX_PATTERNS.IMAGE(), '')
		.replace(REGEX_PATTERNS.EMBEDDED_INTERNAL_LINK(), '')
		.replace(REGEX_PATTERNS.INTERNAL_LINK(), (_: string, name: string, alias: string) => alias || name)
		.replace(REGEX_PATTERNS.LINK(), '$1')
		.replace(REGEX_PATTERNS.HTML_TAG(), replaceWithNewlines)
		.replace(REGEX_PATTERNS.QUOTE, '')
		.replace(REGEX_PATTERNS.SEPARATOR, replaceWithNewlines)
		.replace(REGEX_PATTERNS.TABLE_SEPARATOR, '')
		.replace(REGEX_PATTERNS.TASK_LIST, '')
		.replace(REGEX_PATTERNS.UNORDERED_LIST, '')
		.replace(REGEX_PATTERNS.ORDERED_LIST, '');
}

/** Clean Markdown for the Copy This Document command while preserving its existing behavior. */
export function cleanForPlainCopy(text: string, options: MarkdownCleanerOptions = {}): string {
	return applyFootnotePolicy(text, options.includeFootnotes)
		.replace(REGEX_PATTERNS.FRONTMATTER, '')
		.trimStart()
		.replace(/<[^>]*>?/gm, '')
		.replace(REGEX_PATTERNS.CODE_BLOCK(), '')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/~~(.*?)~~/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
		.replace(/^\s*>\s*/gm, '');
}
