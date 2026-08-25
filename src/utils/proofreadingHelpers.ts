import type { TFile } from 'obsidian';
import type { SynonymGroup } from '../types/proofreading';

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
