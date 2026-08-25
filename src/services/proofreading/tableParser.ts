import type {
	WrongWordEntry,
	SynonymGroup,
	SensitiveWordEntry
} from '../../types/proofreading';

export const WRONG_WORDS_TEMPLATE = `| 错词 | 建议 | 说明 |
| --- | --- | --- |
`;

export const WRONG_WORDS_TEMPLATE_EN = `| Typo | Suggestion | Description |
| --- | --- | --- |
`;

export const SYNONYMS_TEMPLATE = `| 近义词组 | 说明 |
| --- | --- |
`;

export const SYNONYMS_TEMPLATE_EN = `| Synonym Group | Description |
| --- | --- |
`;

export const SENSITIVE_WORDS_TEMPLATE = `| 词语 | 建议 | 级别 | 例外 | 说明 |
| --- | --- | --- | --- | --- |
`;

export const SENSITIVE_WORDS_TEMPLATE_EN = `| Term | Suggestions | Level | Exceptions | Description |
| --- | --- | --- | --- | --- |
`;

export interface TableParseSuccess<T> {
	success: true;
	data: T;
}

export interface TableParseFailure {
	success: false;
	reason: string;
}

export type TableParseResult<T> = TableParseSuccess<T> | TableParseFailure;

export interface TableSpan {
	startLine: number;
	endLine: number;
	headerRowIndex: number;
	separatorRowIndex: number;
	headers: string[];
	bodyRowIndices: number[];
}

/**
 * 分割单行表格单元格（支持反斜杠转义 \|）
 */
export function parseTableRow(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
	if (trimmed.endsWith('|')) trimmed = trimmed.substring(0, trimmed.length - 1);

	// 处理 \| 转义管道符
	const cells: string[] = [];
	let current = '';
	let escaped = false;

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (escaped) {
			current += ch;
			escaped = false;
		} else if (ch === '\\') {
			current += ch;
			escaped = true;
		} else if (ch === '|') {
			cells.push(current.trim().replace(/\\\|/g, '|'));
			current = '';
		} else {
			current += ch;
		}
	}
	cells.push(current.trim().replace(/\\\|/g, '|'));
	return cells;
}

/**
 * 检查一行是否为 Markdown 表格分隔线
 */
export function isTableSeparator(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
	const inner = trimmed.substring(1, trimmed.length - 1);
	const cells = inner.split('|').map(c => c.trim());
	return cells.length >= 1 && cells.every(c => /^:?-+:?$/.test(c));
}

/**
 * 在 Markdown 文本中提取所有表格块
 */
export function findTableSpans(lines: string[]): TableSpan[] {
	const spans: TableSpan[] = [];
	let inTable = false;
	let currentStart = -1;
	let currentHeaderIdx = -1;
	let currentSeparatorIdx = -1;
	let currentHeaders: string[] = [];
	let currentBodyIndices: number[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		const isPipeLine = line.startsWith('|') && line.endsWith('|') && line.length >= 2;

		if (isPipeLine) {
			if (!inTable) {
				inTable = true;
				currentStart = i;
				currentHeaderIdx = i;
				currentHeaders = parseTableRow(line);
				currentSeparatorIdx = -1;
				currentBodyIndices = [];
			} else if (currentSeparatorIdx === -1) {
				if (isTableSeparator(line)) {
					currentSeparatorIdx = i;
				} else {
					inTable = false;
				}
			} else {
				currentBodyIndices.push(i);
			}
		} else {
			if (inTable) {
				if (currentSeparatorIdx !== -1) {
					spans.push({
						startLine: currentStart,
						endLine: i - 1,
						headerRowIndex: currentHeaderIdx,
						separatorRowIndex: currentSeparatorIdx,
						headers: currentHeaders,
						bodyRowIndices: currentBodyIndices
					});
				}
				inTable = false;
			}
		}
	}

	if (inTable && currentSeparatorIdx !== -1) {
		spans.push({
			startLine: currentStart,
			endLine: lines.length - 1,
			headerRowIndex: currentHeaderIdx,
			separatorRowIndex: currentSeparatorIdx,
			headers: currentHeaders,
			bodyRowIndices: currentBodyIndices
		});
	}

	return spans;
}

/**
 * 校验精确错词表头：错词 | 建议 | 说明 或 Typo | Suggestion | Description（精确 3 列）
 */
function isExactWrongWordsHeader(headers: string[]): boolean {
	if (headers.length !== 3) return false;
	const isZh = headers[0] === '错词' && headers[1] === '建议' && headers[2] === '说明';
	const isEn = headers[0].toLowerCase() === 'typo' &&
		headers[1].toLowerCase() === 'suggestion' &&
		headers[2].toLowerCase() === 'description';
	return isZh || isEn;
}

/**
 * 校验精确近义词表头：近义词组 | 说明 或 Synonym Group | Description（精确 2 列）
 */
function isExactSynonymsHeader(headers: string[]): boolean {
	if (headers.length !== 2) return false;
	const isZh = headers[0] === '近义词组' && headers[1] === '说明';
	const isEn = headers[0].toLowerCase() === 'synonym group' && headers[1].toLowerCase() === 'description';
	return isZh || isEn;
}

/**
 * 校验精确敏感词表头：词语 | 建议 | 级别 | 例外 | 说明 或 Term | Suggestions | Level | Exceptions | Description（精确 5 列）
 */
function isExactSensitiveWordsHeader(headers: string[]): boolean {
	if (headers.length !== 5) return false;
	const isZh = headers[0] === '词语' && headers[1] === '建议' && headers[2] === '级别' && headers[3] === '例外' && headers[4] === '说明';
	const isEn = headers[0].toLowerCase() === 'term' &&
		headers[1].toLowerCase() === 'suggestions' &&
		headers[2].toLowerCase() === 'level' &&
		headers[3].toLowerCase() === 'exceptions' &&
		headers[4].toLowerCase() === 'description';
	return isZh || isEn;
}

function parseSensitiveSeverity(levelStr: string): 'info' | 'warning' | null {
	const trimmed = levelStr.trim();
	const lower = trimmed.toLowerCase();
	if (trimmed === '提示' || lower === 'info' || lower === 'information' || lower === 'hint') {
		return 'info';
	}
	if (trimmed === '警告' || lower === 'warning' || lower === 'warn') {
		return 'warning';
	}
	return null;
}

/**
 * 解析错词 Markdown 表
 * 表头精确为：错词 | 建议 | 说明（或 Typo | Suggestion | Description）；数据行必须严格 3 列，任意数据行损坏则整体解析失败
 */
export function parseWrongWordsTable(content: string): TableParseResult<Map<string, WrongWordEntry>> {
	const lines = content.split(/\r?\n/);
	const spans = findTableSpans(lines).filter(s => isExactWrongWordsHeader(s.headers));

	if (spans.length === 0) {
		return { success: false, reason: '未找到标准错词表格（精确表头：错词 | 建议 | 说明 或 Typo | Suggestion | Description）' };
	}
	if (spans.length > 1) {
		return { success: false, reason: '文档中存在多个标准错词表格，格式存在歧义' };
	}

	const span = spans[0];
	const result = new Map<string, WrongWordEntry>();

	for (const lineIdx of span.bodyRowIndices) {
		const cols = parseTableRow(lines[lineIdx]);
		if (cols.length !== 3) {
			return { success: false, reason: `数据行列数不匹配（第 ${lineIdx + 1} 行应为 3 列，实际 ${cols.length} 列）` };
		}
		const word = cols[0].trim();
		const suggestion = cols[1].trim();
		const description = cols[2].trim();

		if (!word) {
			return { success: false, reason: `数据行包含空的错词（第 ${lineIdx + 1} 行）` };
		}
		result.set(word, { word, suggestion, description });
	}

	return { success: true, data: result };
}

/**
 * 解析近义词 Markdown 表
 * 表头精确为：近义词组 | 说明（或 Synonym Group | Description）；数据行必须严格 2 列，按、或中英文逗号分组、全员互推且一词仅一组
 */
export function parseSynonymsTable(
	content: string
): TableParseResult<Map<string, { group: SynonymGroup; suggestions: string[] }>> {
	const lines = content.split(/\r?\n/);
	const spans = findTableSpans(lines).filter(s => isExactSynonymsHeader(s.headers));

	if (spans.length === 0) {
		return { success: false, reason: '未找到标准近义词表格（精确表头：近义词组 | 说明 或 Synonym Group | Description）' };
	}
	if (spans.length > 1) {
		return { success: false, reason: '文档中存在多个标准近义词表格，格式存在歧义' };
	}

	const span = spans[0];
	const result = new Map<string, { group: SynonymGroup; suggestions: string[] }>();
	const seenWords = new Set<string>();

	for (const lineIdx of span.bodyRowIndices) {
		const cols = parseTableRow(lines[lineIdx]);
		if (cols.length !== 2) {
			return { success: false, reason: `数据行列数不匹配（第 ${lineIdx + 1} 行应为 2 列，实际 ${cols.length} 列）` };
		}
		const rawWords = cols[0].split(/[、，,]+/).map(w => w.trim()).filter(w => w.length > 0);
		const description = cols[1].trim();

		if (rawWords.length === 0) {
			return { success: false, reason: `数据行包含空的近义词组（第 ${lineIdx + 1} 行）` };
		}

		// 检查一词仅一组约束
		for (const w of rawWords) {
			if (seenWords.has(w)) {
				return {
					success: false,
					reason: `近义词“${w}”重复出现在多个组中，违反一词仅一组约束（第 ${lineIdx + 1} 行）`
				};
			}
			seenWords.add(w);
		}

		const group: SynonymGroup = { words: rawWords, description };
		for (const w of rawWords) {
			const suggestions = rawWords.filter(other => other !== w);
			result.set(w, { group, suggestions });
		}
	}

	return { success: true, data: result };
}

/**
 * 解析敏感词 Markdown 表
 * 表头精确为：词语 | 建议 | 级别 | 例外 | 说明（或 Term | Suggestions | Level | Exceptions | Description）；数据行必须严格 5 列，级别仅限“提示/警告”或“Info/Warning”，建议支持多条
 */
export function parseSensitiveWordsTable(content: string): TableParseResult<Map<string, SensitiveWordEntry>> {
	const lines = content.split(/\r?\n/);
	const spans = findTableSpans(lines).filter(s => isExactSensitiveWordsHeader(s.headers));

	if (spans.length === 0) {
		return { success: false, reason: '未找到标准敏感词表格（精确表头：词语 | 建议 | 级别 | 例外 | 说明 或 Term | Suggestions | Level | Exceptions | Description）' };
	}
	if (spans.length > 1) {
		return { success: false, reason: '文档中存在多个标准敏感词表格，格式存在歧义' };
	}

	const span = spans[0];
	const result = new Map<string, SensitiveWordEntry>();

	for (const lineIdx of span.bodyRowIndices) {
		const cols = parseTableRow(lines[lineIdx]);
		if (cols.length !== 5) {
			return { success: false, reason: `数据行列数不匹配（第 ${lineIdx + 1} 行应为 5 列，实际 ${cols.length} 列）` };
		}
		const word = cols[0].trim();
		const suggestions = cols[1].split(/[、，,]+/).map(s => s.trim()).filter(s => s.length > 0);
		const levelStr = cols[2].trim();
		const rawExceptions = cols[3].split(/[、，,]+/).map(e => e.trim()).filter(e => e.length > 0);
		const description = cols[4].trim();

		if (!word) {
			return { success: false, reason: `数据行包含空的词语（第 ${lineIdx + 1} 行）` };
		}

		const severity = parseSensitiveSeverity(levelStr);
		if (!severity) {
			return {
				success: false,
				reason: `敏感词“${word}”级别“${levelStr}”非法，仅支持“提示/警告”或“Info/Warning”（第 ${lineIdx + 1} 行）`
			};
		}

		result.set(word, {
			word,
			suggestions,
			severity,
			exceptions: rawExceptions,
			description
		});
	}

	return { success: true, data: result };
}

/**
 * 单元格内容安全转义
 */
function sanitizeCellContent(content: string): string {
	// 去除换行符，并将未转义的 | 转义为 \|
	const singleLine = content.replace(/[\r\n]+/g, ' ').trim();
	return singleLine.replace(/(?<!\\)\|/g, '\\|');
}

/**
 * 在 Markdown 中更新或插入一行表格数据
 * 写入前校验列数、关键非空字段、级别、近义词跨组冲突；并安全转义管道符，保留表外内容
 */
export function updateTableInMarkdown(
	content: string,
	tableType: 'wrong' | 'synonym' | 'sensitive',
	keyWord: string,
	newRowCells: string[]
): { success: boolean; newContent: string; reason?: string } {
	let expectedCols = 3;
	if (tableType === 'synonym') expectedCols = 2;
	else if (tableType === 'sensitive') expectedCols = 5;

	// 1. 严格校验输入列数
	if (!newRowCells || newRowCells.length !== expectedCols) {
		return { success: false, newContent: content, reason: `写入数据列数不匹配，预期 ${expectedCols} 列` };
	}

	// 2. 关键非空校验
	const key = newRowCells[0]?.trim();
	if (!key) {
		return { success: false, newContent: content, reason: '关键词条字段不能为空' };
	}

	// 3. 敏感词级别校验
	if (tableType === 'sensitive') {
		const level = newRowCells[2]?.trim();
		const severity = level ? parseSensitiveSeverity(level) : null;
		if (!severity) {
			return { success: false, newContent: content, reason: `敏感级别“${level}”非法，仅支持“提示/警告”或“Info/Warning”` };
		}
	}

	const lines = content.split(/\r?\n/);
	const spans = findTableSpans(lines).filter(s => {
		if (tableType === 'wrong') return isExactWrongWordsHeader(s.headers);
		if (tableType === 'synonym') return isExactSynonymsHeader(s.headers);
		return isExactSensitiveWordsHeader(s.headers);
	});

	if (spans.length === 0) {
		return { success: false, newContent: content, reason: '未找到唯一标准表格，拒绝写入' };
	}
	if (spans.length > 1) {
		return { success: false, newContent: content, reason: '存在多个匹配表格，格式歧义，拒绝写入' };
	}

	const span = spans[0];

	// 4. 近义词跨组冲突校验
	if (tableType === 'synonym') {
		const newWords = key.split(/[、，,]+/).map(w => w.trim()).filter(w => w.length > 0);
		for (const rowIdx of span.bodyRowIndices) {
			const cols = parseTableRow(lines[rowIdx]);
			const rowWords = cols[0]?.split(/[、，,]+/).map(w => w.trim()).filter(w => w.length > 0) || [];
			// 如果不是正在更新的这一行（按 keyWord 匹配）
			const isTargetRow = rowWords.includes(keyWord.trim()) || cols[0]?.trim() === keyWord.trim();
			if (!isTargetRow) {
				for (const nw of newWords) {
					if (rowWords.includes(nw)) {
						return {
							success: false,
							newContent: content,
							reason: `近义词“${nw}”已存在于其他近义词组中，写入违反一词仅一组约束`
						};
					}
				}
			}
		}
	}

	// 安全转义并拼接
	const sanitizedCells = newRowCells.map(c => sanitizeCellContent(c));
	const newRowLine = `| ${sanitizedCells.join(' | ')} |`;
	let replaced = false;

	for (const rowIdx of span.bodyRowIndices) {
		const cols = parseTableRow(lines[rowIdx]);
		let isMatch = false;

		if (tableType === 'wrong' || tableType === 'sensitive') {
			isMatch = cols[0]?.trim() === keyWord.trim();
		} else if (tableType === 'synonym') {
			const words = cols[0]?.split(/[、，,]+/).map(w => w.trim()).filter(w => w.length > 0) || [];
			isMatch = words.includes(keyWord.trim()) || cols[0]?.trim() === keyWord.trim();
		}

		if (isMatch) {
			lines[rowIdx] = newRowLine;
			replaced = true;
			break;
		}
	}

	if (!replaced) {
		const insertIdx = span.bodyRowIndices.length > 0
			? span.bodyRowIndices[span.bodyRowIndices.length - 1] + 1
			: span.separatorRowIndex + 1;
		lines.splice(insertIdx, 0, newRowLine);
	}

	return { success: true, newContent: lines.join('\n') };
}
