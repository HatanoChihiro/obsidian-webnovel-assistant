import { REGEX_PATTERNS } from '../constants';

export interface MarkdownCleanerOptions {
	includeFootnotes?: boolean;
}

const FOOTNOTE_DEFINITION = /^\[\^[^\]\r\n]+\]:/;
const FOOTNOTE_CONTINUATION = /^(?: {2,}|\t)/;

function preserveNewlines(value: string): string {
	return value.replace(/[^\r\n]/g, '');
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

/** Apply the shared footnote inclusion policy while retaining source line breaks. */
export function applyFootnotePolicy(text: string, includeFootnotes = false): string {
	if (includeFootnotes) return text;
	return removeFootnoteMarkers(removeFootnoteDefinitions(text));
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
