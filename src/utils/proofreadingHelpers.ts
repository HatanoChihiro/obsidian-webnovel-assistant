import type { TFile } from 'obsidian';
import type { SynonymGroup, ProofreadingType } from '../types/proofreading';

export type SynonymValidationErrorCode = 'EMPTY_INPUT' | 'LESS_THAN_TWO' | 'CROSS_GROUP_COLLISION';

export interface SynonymValidationResult {
	valid: boolean;
	words: string[];
	errorCode?: SynonymValidationErrorCode;
	conflictWord?: string;
}

/**
 * 校验选中文本是否符合“标注为词库”的展示与执行资格
 */
export function isSelectionEligibleForAnnotate(
	selection: string | null | undefined,
	file: TFile | null | undefined,
	isInsideDict: (fileOrPath: TFile | string) => boolean
): boolean {
	if (!selection || typeof selection !== 'string') return false;
	if (selection.includes('\n') || selection.includes('\r')) return false;

	const trimmed = selection.trim();
	if (trimmed.length === 0 || trimmed.length >= 50) return false;

	if (!file || !file.path) return false;
	if (isInsideDict(file)) return false;

	return true;
}

/**
 * 校验近义词组输入格式与跨组唯一性约束（一词仅一组）
 * 返回结构化错误码，避免在底层返回硬编码用户文案
 */
export function validateSynonymGroupInput(
	input: string,
	currentWord: string,
	existingSynonyms: Map<string, { group: SynonymGroup }>
): SynonymValidationResult {
	if (!input || input.trim() === '') {
		return { valid: false, words: [], errorCode: 'EMPTY_INPUT' };
	}

	const rawWords = input.split(/[、，,\s]+/).map(w => w.trim()).filter(Boolean);
	const uniqueWords = Array.from(new Set(rawWords));

	if (uniqueWords.length < 2) {
		return { valid: false, words: uniqueWords, errorCode: 'LESS_THAN_TWO' };
	}

	// 查找当前选词原所属的分组（若有）
	const currentExistingGroup = existingSynonyms.get(currentWord)?.group;

	for (const w of uniqueWords) {
		const existingItem = existingSynonyms.get(w);
		if (existingItem) {
			const otherGroup = existingItem.group;
			// 若此词所属组与当前待编辑组不是同一个组，则发生跨组冲突
			if (!currentExistingGroup || otherGroup !== currentExistingGroup) {
				return {
					valid: false,
					words: uniqueWords,
					errorCode: 'CROSS_GROUP_COLLISION',
					conflictWord: w
				};
			}
		}
	}

	return { valid: true, words: uniqueWords };
}

/**
 * 扩展视口范围并合并重叠/相邻区间，用于按需扫描
 */
export function expandAndMergeRanges(
	ranges: readonly { from: number; to: number }[],
	maxLen: number,
	docLength: number
): Array<{ from: number; to: number }> {
	if (!ranges || ranges.length === 0 || docLength <= 0) {
		return [];
	}

	const expanded = ranges.map(r => ({
		from: Math.max(0, r.from - maxLen),
		to: Math.min(docLength, r.to + maxLen)
	})).filter(r => r.to > r.from);

	if (expanded.length <= 1) {
		return expanded;
	}

	expanded.sort((a, b) => a.from - b.from || a.to - b.to);

	const merged: Array<{ from: number; to: number }> = [expanded[0]];
	for (let i = 1; i < expanded.length; i++) {
		const current = expanded[i];
		const last = merged[merged.length - 1];

		if (current.from <= last.to) {
			last.to = Math.max(last.to, current.to);
		} else {
			merged.push(current);
		}
	}

	return merged;
}

/**
 * 检查待应用的替换区间是否已过期（文档内容在 from/to 处已被更改）
 */
export function isReplacementStale(
	docText: string,
	from: number,
	to: number,
	expectedOriginal: string
): boolean {
	if (typeof docText !== 'string') return true;
	if (from < 0 || to > docText.length || from >= to) return true;
	const current = docText.slice(from, to);
	return current !== expectedOriginal;
}

/**
 * 计算诊断项的上下文指纹字符串
 * 提取匹配项前后各 12 字符的语境，构造形如 `${ruleId}::${prefix}[${target}]${suffix}` 的指纹
 */
export function computeDiagnosticContextFingerprint(
	docText: string | { sliceString: (from: number, to: number) => string; length: number },
	from: number,
	to: number,
	ruleId: string,
	original?: string
): string {
	if (!docText) return `${ruleId}::[${original || ''}]`;
	const docLength = docText.length;
	const safeFrom = Math.max(0, Math.min(from, docLength));
	const safeTo = Math.max(safeFrom, Math.min(to, docLength));
	const prefix = typeof docText === 'string'
		? docText.slice(Math.max(0, safeFrom - 12), safeFrom)
		: docText.sliceString(Math.max(0, safeFrom - 12), safeFrom);
	const target = original ?? (typeof docText === 'string'
		? docText.slice(safeFrom, safeTo)
		: docText.sliceString(safeFrom, safeTo));
	const suffix = typeof docText === 'string'
		? docText.slice(safeTo, Math.min(docLength, safeTo + 12))
		: docText.sliceString(safeTo, Math.min(docLength, safeTo + 12));
	return `${ruleId}::${prefix}[${target}]${suffix}`;
}

export interface IgnoredContextDetails {
	ruleId?: string;
	prefix?: string;
	suffix?: string;
}

export interface IgnoredContextEntryPattern {
	original: string;
	ruleId?: string;
	prefix?: string;
	suffix?: string;
}

/**
 * 判断诊断项是否被用户已配置的忽略词库或上下文指纹忽略
 */
export function isDiagnosticIgnored(
	original: string,
	fingerprint: string | undefined,
	ignoredWordsSet: ReadonlySet<string>,
	ignoredContextsSet: ReadonlySet<string>,
	contextDetails?: IgnoredContextDetails,
	ignoredContextEntries?: readonly IgnoredContextEntryPattern[]
): boolean {
	if (ignoredWordsSet.has(original)) {
		return true;
	}
	if (fingerprint && ignoredContextsSet.has(fingerprint)) {
		return true;
	}
	if (contextDetails && ignoredContextEntries && ignoredContextEntries.length > 0) {
		for (const entry of ignoredContextEntries) {
			if (entry.original !== original) continue;
			if (entry.ruleId && contextDetails.ruleId && entry.ruleId !== contextDetails.ruleId) continue;

			const entryPrefix = entry.prefix ?? '';
			const currPrefix = contextDetails.prefix ?? '';
			const entrySuffix = entry.suffix ?? '';
			const currSuffix = contextDetails.suffix ?? '';

			// 检查前缀匹配：前缀必须保持后置连续（结尾对齐或任一方包含另一方）
			const prefixMatch = entryPrefix === '' || currPrefix.endsWith(entryPrefix) || entryPrefix.endsWith(currPrefix);
			// 检查后缀匹配：若录入时是在打字末尾（entrySuffix 为空），只要前缀匹配即属于该处打字忽略；若非空则要求前置头部对齐
			const suffixMatch = entrySuffix === '' || currSuffix.startsWith(entrySuffix) || entrySuffix.startsWith(currSuffix);

			if (prefixMatch && suffixMatch) {
				return true;
			}
		}
	}
	return false;
}

export interface FormattedIgnoredContext {
	prefix: string;
	target: string;
	suffix: string;
	type: ProofreadingType | 'other';
}

/**
 * 将存储的上下文片段与规则信息平整化解析为可在 UI 中安全展示的结构
 */
export function formatIgnoredContextSnippet(
	context: string,
	original: string,
	ruleId?: string
): FormattedIgnoredContext {
	let type: ProofreadingType | 'other' = 'wrong_word';
	if (ruleId) {
		if (ruleId.startsWith('punctuation')) type = 'punctuation';
		else if (ruleId.startsWith('sensitive')) type = 'sensitive';
		else if (ruleId.startsWith('synonym')) type = 'synonym';
		else if (ruleId.startsWith('dedide')) type = 'grammar';
		else if (ruleId.startsWith('builtin_wrong') || ruleId.startsWith('user_wrong')) type = 'wrong_word';
		else type = 'other';
	}

	const match = /^([\s\S]*)\[([\s\S]*?)\]([\s\S]*)$/.exec(context || '');
	if (match) {
		const rawPrefix = match[1] ?? '';
		const rawTarget = match[2] ?? original;
		const rawSuffix = match[3] ?? '';

		return {
			prefix: rawPrefix.replace(/\s+/g, ' ').trim(),
			target: rawTarget.replace(/\s+/g, ' ').trim(),
			suffix: rawSuffix.replace(/\s+/g, ' ').trim(),
			type
		};
	}

	return {
		prefix: '',
		target: (context || original).replace(/\s+/g, ' '),
		suffix: '',
		type
	};
}
