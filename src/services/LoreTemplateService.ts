/**
 * Lore Template Service
 * Pure typed parser and renderer functions for Markdown lore templates.
 */

export interface TemplateField {
	id: string;
	type: 'colon_field' | 'heading_section';
	label: string;
	defaultValue: string;
	originalHeadingLevel?: number;
	marker?: string;
	colon?: string;
	bullet?: string;
	isMultiline?: boolean;
	sectionHeading?: string;
}

export interface ParsedTemplate {
	rawContent: string;
	fields: TemplateField[];
	render: (values: Record<string, string>) => string;
}

/** Built-in reserved keywords (case-insensitive) across English, Simplified Chinese, and Traditional Chinese */
const BUILT_IN_KEYS = new Set([
	'alias',
	'aliases',
	'别名',
	'別名',
	'type',
	'类型',
	'類型',
	'relation',
	'relations',
	'关系',
	'關係',
]);

const RELATION_KEYS = new Set([
	'relation',
	'relations',
	'关系',
	'關係',
]);

/**
 * Checks whether a label or heading matches built-in lore fields case-insensitively,
 * stripping surrounding markdown emphasis and colons.
 */
export function isBuiltInFieldOrHeading(text: string): boolean {
	const cleaned = text.trim()
		.replace(/^(\*\*|__|\*|_)+|(\*\*|__|\*|_)+$/g, '')
		.replace(/[:：]$/, '')
		.replace(/^(\*\*|__|\*|_)+|(\*\*|__|\*|_)+$/g, '')
		.trim()
		.toLowerCase();
	return BUILT_IN_KEYS.has(cleaned);
}

/**
 * Checks whether a label matches built-in Relation keywords case-insensitively.
 */
export function isBuiltInRelation(text: string): boolean {
	const cleaned = text.trim()
		.replace(/^(\*\*|__|\*|_)+|(\*\*|__|\*|_)+$/g, '')
		.replace(/[:：]$/, '')
		.replace(/^(\*\*|__|\*|_)+|(\*\*|__|\*|_)+$/g, '')
		.trim()
		.toLowerCase();
	return RELATION_KEYS.has(cleaned);
}

/**
 * Strips leading/trailing blank lines while preserving significant indentation of content lines.
 */
export function trimBlankLines(text: string): string {
	if (!text.trim()) {
		return '';
	}
	return text
		.replace(/^(?:[ \t]*\r?\n)+/, '')
		.replace(/(?:\r?\n[ \t]*)+$/, '');
}

/**
 * Strips leading YAML frontmatter (with optional BOM support) from a Markdown document.
 * Requires closing delimiter to occupy the full line.
 */
export function stripLeadingYamlFrontmatter(content: string): string {
	const hasBom = content.startsWith('\uFEFF');
	const text = hasBom ? content.slice(1) : content;

	if (!text.startsWith('---')) {
		return content;
	}

	const match = text.match(/^[ ]{0,3}---[ \t]*\r?\n([\s\S]*?\r?\n)[ ]{0,3}(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
	if (match) {
		return text.slice(match[0].length);
	}
	return content;
}

export interface FenceScanState {
	inFence: boolean;
	fenceChar: string;
	fenceLength: number;
}

/**
 * Precise scoped fence line scanner (0-3 space indent, matching fence character, and length >= opener).
 */
export function scanFenceLine(
	line: string,
	state: FenceScanState
): { inFenceBefore: boolean; inFenceAfter: boolean } {
	const inFenceBefore = state.inFence;

	if (!state.inFence) {
		const match = line.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/);
		if (match) {
			const char = match[1][0];
			const len = match[1].length;
			const info = match[2];
			if (char !== '`' || !info.includes('`')) {
				state.inFence = true;
				state.fenceChar = char;
				state.fenceLength = len;
			}
		}
	} else {
		const match = line.match(/^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/);
		if (match) {
			const char = match[1][0];
			const len = match[1].length;
			if (char === state.fenceChar && len >= state.fenceLength) {
				state.inFence = false;
				state.fenceChar = '';
				state.fenceLength = 0;
			}
		}
	}

	return { inFenceBefore, inFenceAfter: state.inFence };
}

/**
 * Normalizes headings in user-entered custom values outside fenced code blocks.
 * Replaces ATX H1 (#) and H2 (##) with H3+ (### / ####) and converts setext underlines
 * to prevent splitting lore entries. Preserves content inside code blocks intact.
 */
export function sanitizeLoreHeadings(text: string): string {
	const lines = text.split(/\r?\n/);
	const fenceState: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	const processedLines: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const { inFenceBefore, inFenceAfter } = scanFenceLine(line, fenceState);

		if (inFenceBefore || inFenceAfter) {
			processedLines.push(line);
			continue;
		}

		// Outside fences: check if line is a setext heading underline (--- or ===)
		const setextMatch = line.match(/^[ ]{0,3}(={1,}|-{1,})[ \t]*$/);
		if (setextMatch && processedLines.length > 0) {
			const prevLine = processedLines[processedLines.length - 1];
			if (prevLine.trim() && !/^[ ]{0,3}#{1,6}\s/.test(prevLine) && !/^[ ]{0,3}(?:`{3,}|~{3,})/.test(prevLine)) {
				const cleanedPrev = prevLine.replace(/^[ ]{0,3}/, '');
				processedLines[processedLines.length - 1] = `### ${cleanedPrev}`;
				continue;
			}
		}

		// Outside fences: prevent ATX H1 or H2 from splitting the lore entry (only 0-3 spaces indent)
		const headingMatch = line.match(/^([ ]{0,3})(#{1,2})([ \t]+.*?)(?:[ \t]+#+[ \t]*)?$/);
		if (headingMatch) {
			const hashes = headingMatch[2];
			const rest = headingMatch[3].trim();
			// Shift by 2: # (1) -> ### (3), ## (2) -> #### (4)
			const newHashes = '#'.repeat(hashes.length + 2);
			processedLines.push(`${newHashes} ${rest}`);
			continue;
		}

		processedLines.push(line);
	}

	return processedLines.join('\n');
}

interface ColonFieldMatch {
	bullet: string;
	marker: string;
	label: string;
	colon: string;
	initialValue: string;
}

const RECOGNIZED_SCHEMES = new Set(['mailto', 'tel', 'urn', 'sms', 'geo']);

/**
 * Attempts to parse a line as a colon field line.
 * Matches: optional bullet + optional bold/italic/plain marker + label + colon + initial value.
 * Excludes recognized schemes (mailto, tel, urn, sms, geo) and actual :// URLs.
 */
function matchColonFieldLine(line: string): ColonFieldMatch | null {
	const trimmed = line.trim();
	if (trimmed.startsWith('>') || trimmed.startsWith('<!--') || /^[*-+]\s+\[/.test(trimmed)) {
		return null;
	}

	// 0-3 spaces indent, optional bullet, optional emphasis marker, label, closing marker, colon, value
	const regex = /^[ ]{0,3}(?:([-*+])[ \t]+)?(?:(\*\*|__|\*|_))?([^:：\n\r*_`[\]]+?)\2[ \t]*([:：])[ \t]*(.*)$/;
	const match = line.match(regex);
	if (!match) {
		return null;
	}

	const label = match[3].trim();
	if (!label || label.length > 60) {
		return null;
	}

	if (/[。，！？!?,;；]/.test(label)) {
		return null;
	}

	const val = match[5];
	const marker = match[2] || '';
	const lowerLabel = label.toLowerCase();

	// Reject recognized URL schemes and actual :// URLs
	if (!marker) {
		if (RECOGNIZED_SCHEMES.has(lowerLabel)) {
			return null;
		}
		if (val.trimStart().startsWith('//')) {
			return null;
		}
	}

	return {
		bullet: match[1] ? `${match[1]} ` : '',
		marker,
		label,
		colon: match[4],
		initialValue: val.trim(),
	};
}

interface InternalHeading {
	level: number;
	title: string;
	lineIndex: number;
}

type InternalNode =
	| { type: 'static'; text: string }
	| { type: 'heading'; level: number; title: string }
	| { type: 'colon_field'; field: TemplateField }
	| { type: 'heading_section'; field: TemplateField; headingLevel: number; headingTitle: string };

/**
 * Pure parser for Markdown lore templates.
 * Generates an ordered list of editable fields and a renderer function.
 */
export function parseLoreTemplate(rawContent: string): ParsedTemplate {
	const contentWithoutFrontmatter = stripLeadingYamlFrontmatter(rawContent);
	const rawLines = contentWithoutFrontmatter.split(/\r?\n/);

	// Pass 1: Identify code fences and ATX headings (support 0-3 space indent and trailing closing hashes)
	const fenceState: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	const lineIsFence: boolean[] = [];
	const lineHeading: (InternalHeading | null)[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		const line = rawLines[i];
		const { inFenceBefore, inFenceAfter } = scanFenceLine(line, fenceState);
		const isFenceLine = inFenceBefore || inFenceAfter;
		lineIsFence.push(isFenceLine);

		if (isFenceLine) {
			lineHeading.push(null);
			continue;
		}

		const headingMatch = line.match(/^[ ]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/);
		if (headingMatch) {
			lineHeading.push({
				level: headingMatch[1].length,
				title: headingMatch[2].trim(),
				lineIndex: i,
			});
		} else {
			lineHeading.push(null);
		}
	}

	// Pass 2: Check for sole leading H1 wrapper (must be genuinely LEADING, not preceded by substantive text)
	let soleLeadingH1Index: number | null = null;
	const h1Headings: InternalHeading[] = [];
	let hasSubstantivePrecedingText = false;
	let firstHeading: InternalHeading | null = null;

	for (let i = 0; i < rawLines.length; i++) {
		const h = lineHeading[i];
		if (h) {
			if (!firstHeading) {
				firstHeading = h;
			}
			if (h.level === 1) {
				h1Headings.push(h);
			}
		} else if (!firstHeading && rawLines[i].trim().length > 0) {
			hasSubstantivePrecedingText = true;
		}
	}

	if (h1Headings.length === 1 && firstHeading && firstHeading.level === 1 && !hasSubstantivePrecedingText) {
		soleLeadingH1Index = firstHeading.lineIndex;
	}

	// Pass 3: Calculate minimum heading level among included headings to normalize to H3+
	let simReservedLevel: number | null = null;
	const includedHeadingLevels: number[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		if (i === soleLeadingH1Index || lineIsFence[i]) {
			continue;
		}
		const h = lineHeading[i];
		if (!h) {
			continue;
		}

		if (simReservedLevel !== null) {
			if (h.level <= simReservedLevel) {
				simReservedLevel = null;
			} else {
				continue;
			}
		}

		if (isBuiltInFieldOrHeading(h.title)) {
			simReservedLevel = h.level;
			continue;
		}

		includedHeadingLevels.push(h.level);
	}

	const minHeadingLevel = includedHeadingLevels.length > 0 ? Math.min(...includedHeadingLevels) : 3;
	const headingOffset = Math.max(0, 3 - minHeadingLevel);

	// Pass 4: Parse lines into sections, colon fields (including continuation lines), and static text
	interface ColonFieldDraft {
		match: ColonFieldMatch;
		continuationLines: string[];
	}

	interface SectionDraft {
		heading: InternalHeading | null;
		items: ({ type: 'colon'; field: ColonFieldDraft } | { type: 'static'; text: string })[];
	}

	const sections: SectionDraft[] = [];
	let currentSection: SectionDraft = { heading: null, items: [] };
	sections.push(currentSection);

	let reservedLevel: number | null = null;
	let inReservedRelationBlock = false;
	let currentColonField: ColonFieldDraft | null = null;

	for (let i = 0; i < rawLines.length; i++) {
		if (i === soleLeadingH1Index) {
			continue;
		}

		const isFence = lineIsFence[i];
		const h = lineHeading[i];

		if (!isFence && h) {
			currentColonField = null;
			inReservedRelationBlock = false;

			if (reservedLevel !== null) {
				if (h.level <= reservedLevel) {
					reservedLevel = null;
				} else {
					continue;
				}
			}

			if (isBuiltInFieldOrHeading(h.title)) {
				reservedLevel = h.level;
				continue;
			}

			currentSection = { heading: h, items: [] };
			sections.push(currentSection);
			continue;
		}

		if (reservedLevel !== null || inReservedRelationBlock) {
			continue;
		}

		const line = rawLines[i];

		if (isFence) {
			currentColonField = null;
			currentSection.items.push({ type: 'static', text: line });
			continue;
		}

		const colonMatch = matchColonFieldLine(line);
		if (colonMatch) {
			if (isBuiltInRelation(colonMatch.label) && !colonMatch.initialValue) {
				// Empty built-in relation field line acts as a relation block header through next heading
				inReservedRelationBlock = true;
				currentColonField = null;
				continue;
			}

			if (isBuiltInFieldOrHeading(colonMatch.label)) {
				currentColonField = null;
				continue;
			}

			const fieldDraft: ColonFieldDraft = { match: colonMatch, continuationLines: [] };
			currentColonField = fieldDraft;
			currentSection.items.push({ type: 'colon', field: fieldDraft });
			continue;
		}

		// Check if this line is a continuation line for an existing colon field
		if (currentColonField) {
			const trimmed = line.trim();
			if (trimmed.length > 0 && !trimmed.startsWith('>') && !trimmed.startsWith('<!--') && !/^[ ]{0,3}(?:[-*_][ \t]*){3,}$/.test(line)) {
				// Preserve continuation indentation
				currentColonField.continuationLines.push(line.replace(/\r?$/, ''));
				continue;
			}
			currentColonField = null;
		}

		currentSection.items.push({ type: 'static', text: line });
	}

	// Pass 5: Construct template fields and internal nodes
	const fields: TemplateField[] = [];
	const nodes: InternalNode[] = [];
	let fieldIdCounter = 0;

	for (const sec of sections) {
		if (sec.heading === null) {
			for (const item of sec.items) {
				if (item.type === 'colon') {
					const allVals = [item.field.match.initialValue, ...item.field.continuationLines].filter(Boolean);
					const defaultVal = allVals.join('\n');
					const field: TemplateField = {
						id: `tpl-field-${fieldIdCounter++}`,
						type: 'colon_field',
						label: item.field.match.label,
						defaultValue: defaultVal,
						bullet: item.field.match.bullet,
						marker: item.field.match.marker,
						colon: item.field.match.colon,
						isMultiline: allVals.length > 1 || item.field.match.initialValue.includes('\n'),
					};
					fields.push(field);
					nodes.push({ type: 'colon_field', field });
				} else {
					nodes.push({ type: 'static', text: item.text });
				}
			}
			continue;
		}

		// Section with a heading
		const colonItems = sec.items.filter((item): item is { type: 'colon'; field: ColonFieldDraft } => item.type === 'colon');

		if (colonItems.length === 0) {
			// Heading section without colon fields: the section itself is an editable field
			const bodyLines = sec.items
				.filter((item): item is { type: 'static'; text: string } => item.type === 'static')
				.map(item => item.text);
			const defaultBody = trimBlankLines(bodyLines.join('\n'));

			const field: TemplateField = {
				id: `tpl-field-${fieldIdCounter++}`,
				type: 'heading_section',
				label: sec.heading.title,
				defaultValue: defaultBody,
				originalHeadingLevel: sec.heading.level,
				isMultiline: true,
				sectionHeading: sec.heading.title,
			};

			fields.push(field);
			nodes.push({
				type: 'heading_section',
				field,
				headingLevel: sec.heading.level,
				headingTitle: sec.heading.title,
			});
		} else {
			// Heading section with colon fields: heading is structural, colon lines are fields
			const normalizedLevel = Math.min(6, sec.heading.level + headingOffset);
			nodes.push({
				type: 'heading',
				level: normalizedLevel,
				title: sec.heading.title,
			});

			for (const item of sec.items) {
				if (item.type === 'colon') {
					const allVals = [item.field.match.initialValue, ...item.field.continuationLines].filter(Boolean);
					const defaultVal = allVals.join('\n');
					const field: TemplateField = {
						id: `tpl-field-${fieldIdCounter++}`,
						type: 'colon_field',
						label: item.field.match.label,
						defaultValue: defaultVal,
						bullet: item.field.match.bullet,
						marker: item.field.match.marker,
						colon: item.field.match.colon,
						isMultiline: allVals.length > 1 || item.field.match.initialValue.includes('\n'),
						sectionHeading: sec.heading.title,
					};
					fields.push(field);
					nodes.push({ type: 'colon_field', field });
				} else {
					nodes.push({ type: 'static', text: item.text });
				}
			}
		}
	}

	// Render function
	const render = (values: Record<string, string>): string => {
		const chunks: string[] = [];

		for (const node of nodes) {
			switch (node.type) {
				case 'static': {
					chunks.push(node.text);
					break;
				}
				case 'heading': {
					const prefix = '#'.repeat(node.level);
					chunks.push(`${prefix} ${node.title}`);
					break;
				}
				case 'heading_section': {
					const normalizedLevel = Math.min(6, node.headingLevel + headingOffset);
					const prefix = '#'.repeat(normalizedLevel);
					const rawVal = values[node.field.id] !== undefined ? values[node.field.id] : node.field.defaultValue;
					const sanitized = sanitizeLoreHeadings(rawVal.trim());

					if (sanitized) {
						chunks.push(`${prefix} ${node.headingTitle}\n${sanitized}`);
					} else {
						chunks.push(`${prefix} ${node.headingTitle}`);
					}
					break;
				}
				case 'colon_field': {
					const rawVal = values[node.field.id] !== undefined ? values[node.field.id] : node.field.defaultValue;
					const sanitized = sanitizeLoreHeadings(rawVal.trim());
					const bullet = node.field.bullet || '';
					const marker = node.field.marker || '';
					const label = node.field.label;
					const colon = node.field.colon || ':';

					if (sanitized) {
						chunks.push(`${bullet}${marker}${label}${marker}${colon} ${sanitized}`);
					} else {
						chunks.push(`${bullet}${marker}${label}${marker}${colon}`);
					}
					break;
				}
			}
		}

		let result = chunks.join('\n');

		// Ensure any unclosed code block fence is bounded so appended native relations aren't swallowed
		const endFenceState: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
		for (const line of result.split(/\r?\n/)) {
			scanFenceLine(line, endFenceState);
		}
		if (endFenceState.inFence) {
			const closingLen = Math.max(3, endFenceState.fenceLength);
			result += `\n${endFenceState.fenceChar.repeat(closingLen)}`;
		}

		result = sanitizeLoreHeadings(result);
		return trimBlankLines(result);
	};

	return {
		rawContent,
		fields,
		render,
	};
}

export const MAX_LORE_TEMPLATE_HISTORY = 10;

/**
 * Normalizes a single lore template path.
 * Accepts only valid vault-relative Markdown (.md) paths.
 * Rejects absolute paths, drive letters, URIs, dot/double-dot segments, non-strings, and non-markdown paths.
 * Normalizes slashes to forward slash, preserves Unicode and filename case.
 */
export function normalizeLoreTemplatePath(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// Reject drive letters (e.g. C:, D:)
	if (/^[a-zA-Z]:/i.test(trimmed)) return null;

	// Reject URI schemes, including those without // (e.g. mailto:).
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) return null;

	// Reject absolute root paths starting with / or \
	if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return null;

	// Normalize slashes (\ to / and collapse consecutive slashes)
	const normalizedSlashes = trimmed.replace(/\\+/g, '/').replace(/\/+/g, '/');

	// Reject dot segments (. or ..)
	const segments = normalizedSlashes.split('/');
	for (const segment of segments) {
		if (segment === '.' || segment === '..') return null;
	}

	// Must end with .md (case-insensitive, but preserving original case)
	if (!/\.md$/i.test(normalizedSlashes)) return null;

	return normalizedSlashes;
}

/**
 * Normalizes an unknown lore template history list.
 * Drops invalid paths, deduplicates exact normalized paths, and keeps at most 10.
 */
export function normalizeLoreTemplateHistory(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	const result: string[] = [];
	const seen = new Set<string>();

	for (const item of list) {
		const normalized = normalizeLoreTemplatePath(item);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
			if (result.length >= MAX_LORE_TEMPLATE_HISTORY) {
				break;
			}
		}
	}

	return result;
}

/**
 * Remembers a newly chosen lore template path in history.
 * Puts the path at the front (newest first), removes duplicates, and keeps at most 10.
 * If path is invalid, returns the normalized current history.
 */
export function rememberLoreTemplatePath(
	history: unknown,
	path: unknown
): string[] {
	const normalizedPath = normalizeLoreTemplatePath(path);
	const currentHistory = normalizeLoreTemplateHistory(history);
	if (!normalizedPath) {
		return currentHistory;
	}

	const filtered = currentHistory.filter(p => p !== normalizedPath);
	return [normalizedPath, ...filtered].slice(0, MAX_LORE_TEMPLATE_HISTORY);
}

/**
 * Removes a lore template path from history.
 * If path is invalid or not in history, returns current normalized history without changes.
 */
export function removeLoreTemplatePath(
	history: unknown,
	path: unknown
): string[] {
	const normalizedPath = normalizeLoreTemplatePath(path);
	const currentHistory = normalizeLoreTemplateHistory(history);
	if (!normalizedPath) {
		return currentHistory;
	}

	return currentHistory.filter(p => p !== normalizedPath);
}
