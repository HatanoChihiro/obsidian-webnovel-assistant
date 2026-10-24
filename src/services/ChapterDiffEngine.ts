/*!
 * jsdiff 9.0.0 - BSD-3-Clause
 * BSD 3-Clause License
 *
 * Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import * as Diff from 'diff';

export interface DiffChange {
	value: string;
	added?: boolean;
	removed?: boolean;
}

export type AlignedDiffRowType =
	| 'unchanged'
	| 'modified'
	| 'added'
	| 'deleted'
	| 'split'
	| 'merge';

export interface AlignedDiffRow {
	id: number;
	type: AlignedDiffRowType;
	leftLines: string[];
	rightLines: string[];
	exceedsLimit?: boolean;
	charDiff?: DiffChange[];
}

/** Structural splits/merges remain meaningful even when only line breaks change. */
export function isFormattingOnlyRow(row: AlignedDiffRow): boolean {
	if (row.type === 'unchanged' || row.type === 'split' || row.type === 'merge') return false;
	return row.leftLines.join('').replace(/\s/gu, '') === row.rightLines.join('').replace(/\s/gu, '');
}

export interface YamlDiffResult {
	hasDifferences: boolean;
	changes: DiffChange[];
	rawLeft: string;
	rawRight: string;
}

export interface ChapterDiffResult {
	hasDifferences: boolean;
	yamlDiff?: YamlDiffResult;
	rows: AlignedDiffRow[];
}

export interface DiffComputeOptions {
	maxCharsForFineDiff?: number;
	isCancelled?: () => boolean;
}

interface ParagraphProfile {
	raw: string;
	trimmed: string;
	chars: string[];
	bigramCounts: Map<string, number>;
	totalBigrams: number;
}

type AlignedBlockOp =
	| { type: 'deleted'; leftLines: string[]; rightLines: string[] }
	| { type: 'added'; leftLines: string[]; rightLines: string[] }
	| { type: 'modified'; leftLines: string[]; rightLines: string[] }
	| { type: 'split'; leftLines: string[]; rightLines: string[] }
	| { type: 'merge'; leftLines: string[]; rightLines: string[] };

const DEFAULT_MAX_CHARS_FOR_FINE_DIFF = 30000;
const MAX_ALIGNMENT_CELLS = 40000;
const MAX_PROFILE_CHARS = 2000;
const MAX_SPLIT_MERGE_SPAN = 4;
const MIN_PAIR_SIMILARITY = 0.28;
const MIN_PIECE_CONTAINMENT = 0.45;
const MIN_SPLIT_MERGE_SIMILARITY = 0.55;
const ACTION_DELETE = 1;
const ACTION_ADD = 2;
const ACTION_MODIFY = 3;
const ACTION_SPLIT = 4;
const ACTION_MERGE = 5;
const FM_REGEX = /^---\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/;

export class ChapterDiffEngine {
	/**
	 * 分割 YAML frontmatter 与文档正文，同时保留前缀以支持 100% 精确的原文重建
	 */
	public static splitFrontmatterAndBody(raw: string): {
		yaml: string | null;
		yamlHeader: string;
		body: string;
	} {
		const match = FM_REGEX.exec(raw);
		if (match) {
			return {
				yaml: match[1] ?? '',
				yamlHeader: match[0],
				body: raw.slice(match[0].length)
			};
		}
		return {
			yaml: null,
			yamlHeader: '',
			body: raw
		};
	}

	/**
	 * 将每个非空物理行作为独立对比段落，同时无损保留行尾换行符及后续空行（包括前导空行）
	 */
	private static splitParagraphBlocks(text: string): string[] {
		if (text.length === 0) return [];
		const lines = this.splitPreservingLineEndings(text);
		const blocks: string[] = [];
		let currentBlock = '';
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const isBlank = line.trim().length === 0;
			if (!isBlank && currentBlock.length > 0) {
				blocks.push(currentBlock);
				currentBlock = line;
			} else {
				currentBlock += line;
			}
		}
		if (currentBlock.length > 0) {
			blocks.push(currentBlock);
		}
		return blocks;
	}

	private static splitPreservingLineEndings(text: string): string[] {
		if (text.length === 0) return [];
		const lines: string[] = [];
		let start = 0;
		for (let i = 0; i < text.length; i++) {
			if (text[i] === '\n') {
				lines.push(text.slice(start, i + 1));
				start = i + 1;
			}
		}
		if (start < text.length) {
			lines.push(text.slice(start));
		}
		return lines;
	}

	private static buildProfile(raw: string): ParagraphProfile {
		const trimmed = raw.trim();
		const chars = Array.from(trimmed);
		const capped = chars.length > MAX_PROFILE_CHARS ? chars.slice(0, MAX_PROFILE_CHARS) : chars;
		const bigramCounts = new Map<string, number>();
		const totalBigrams = Math.max(0, capped.length - 1);
		for (let i = 0; i < totalBigrams; i++) {
			const bg = capped[i] + capped[i + 1];
			bigramCounts.set(bg, (bigramCounts.get(bg) ?? 0) + 1);
		}
		return { raw, trimmed, chars: capped, bigramCounts, totalBigrams };
	}

	/**
	 * 基于相邻字符二元语法（Bigram Dice）及短句前后缀顺序证据计算段落相似度
	 */
	private static computePairSimilarity(
		a: ParagraphProfile,
		b: ParagraphProfile,
		precomputedShared: number
	): number {
		if (a.trimmed.length === 0 && b.trimmed.length === 0) {
			return a.raw.length > 0 && b.raw.length > 0 ? 0.8 : 0;
		}
		if (a.trimmed.length === 0 || b.trimmed.length === 0) {
			return 0;
		}
		if (a.trimmed === b.trimmed) {
			return 1;
		}
		let dice = 0;
		if (a.totalBigrams > 0 && b.totalBigrams > 0) {
			dice = (2 * precomputedShared) / (a.totalBigrams + b.totalBigrams);
		}
		if (dice < MIN_PAIR_SIMILARITY && Math.min(a.chars.length, b.chars.length) <= 6) {
			const minLen = Math.min(a.chars.length, b.chars.length);
			let prefix = 0;
			while (prefix < minLen && a.chars[prefix] === b.chars[prefix]) {
				prefix++;
			}
			let suffix = 0;
			while (
				suffix < minLen - prefix &&
				a.chars[a.chars.length - 1 - suffix] === b.chars[b.chars.length - 1 - suffix]
			) {
				suffix++;
			}
			const affix = prefix + suffix;
			if (affix >= 2) {
				dice = Math.max(dice, ((2 * affix) / (a.chars.length + b.chars.length)) * 0.8);
			}
		}
		return dice;
	}

	/**
	 * 校验 1->N 拆分或 N->1 合并：要求每个片段都携带来自原段的非重叠二元内容，且组合相似度明显优于单段配对
	 */
	private static evaluateCompositeMatch(
		whole: ParagraphProfile,
		pieces: ParagraphProfile[],
		precomputedMaxSingleSim: number
	): number | null {
		if (whole.totalBigrams < 2 || pieces.length < 2) {
			return null;
		}
		let sumPieceBigrams = 0;
		for (const piece of pieces) {
			if (piece.totalBigrams < 1) {
				return null;
			}
			sumPieceBigrams += piece.totalBigrams;
		}
		if (sumPieceBigrams < whole.totalBigrams * 0.5 || sumPieceBigrams > whole.totalBigrams * 1.6) {
			return null;
		}
		const remaining = new Map(whole.bigramCounts);
		for (const piece of pieces) {
			let newShared = 0;
			for (const [bg, count] of piece.bigramCounts) {
				const avail = remaining.get(bg) ?? 0;
				if (avail > 0) {
					const take = Math.min(count, avail);
					newShared += take;
					remaining.set(bg, avail - take);
				}
			}
			if (newShared / piece.totalBigrams < MIN_PIECE_CONTAINMENT) {
				return null;
			}
		}
		const combinedProfile = this.buildProfile(pieces.map(p => p.trimmed).join(''));
		if (combinedProfile.totalBigrams < 1) {
			return null;
		}
		let combinedShared = 0;
		for (const [bg, countA] of whole.bigramCounts) {
			const countB = combinedProfile.bigramCounts.get(bg) ?? 0;
			if (countB > 0) {
				combinedShared += Math.min(countA, countB);
			}
		}
		const combinedDice = (2 * combinedShared) / (whole.totalBigrams + combinedProfile.totalBigrams);
		if (combinedDice < MIN_SPLIT_MERGE_SIMILARITY || combinedDice <= precomputedMaxSingleSim + 0.02) {
			return null;
		}
		return Math.min(1.05, combinedDice + 0.05);
	}

	/**
	 * 在连续变更块内进行有界单调相似度对齐，支持插入/删除间隙及段落拆分/合并；超界时保守回退为未配对删除/新增
	 */
	private static async alignChangedBlock(
		remLines: string[],
		addLines: string[],
		isCancelled?: () => boolean
	): Promise<AlignedBlockOp[]> {
		const m = remLines.length;
		const n = addLines.length;
		if (m === 0) {
			return addLines.map(line => ({ type: 'added', leftLines: [], rightLines: [line] }));
		}
		if (n === 0) {
			return remLines.map(line => ({ type: 'deleted', leftLines: [line], rightLines: [] }));
		}
		if (m * n > MAX_ALIGNMENT_CELLS) {
			return [
				...remLines.map((line): AlignedBlockOp => ({ type: 'deleted', leftLines: [line], rightLines: [] })),
				...addLines.map((line): AlignedBlockOp => ({ type: 'added', leftLines: [], rightLines: [line] }))
			];
		}

		let yieldAt = Date.now() + 8;
		let workUnits = 0;
		const yieldToEventLoop = async (): Promise<void> => {
			await new Promise<void>(resolve => window.setTimeout(resolve, 0));
			if (isCancelled?.()) throw new Error('Diff computation cancelled');
			yieldAt = Date.now() + 8;
		};
		const maybeYield = (step = 1): Promise<void> | undefined => {
			workUnits += step;
			if (workUnits < 32) return undefined;
			workUnits = 0;
			if (isCancelled?.()) throw new Error('Diff computation cancelled');
			if (Date.now() >= yieldAt) {
				return yieldToEventLoop();
			}
			return undefined;
		};

		const remProfiles: ParagraphProfile[] = new Array<ParagraphProfile>(m);
		for (let i = 0; i < m; i++) {
			const pending = maybeYield(4);
			if (pending) await pending;
			remProfiles[i] = this.buildProfile(remLines[i]);
		}
		const addProfiles: ParagraphProfile[] = new Array<ParagraphProfile>(n);
		for (let j = 0; j < n; j++) {
			const pending = maybeYield(4);
			if (pending) await pending;
			addProfiles[j] = this.buildProfile(addLines[j]);
		}

		const sharedMatrix = new Uint16Array(m * n);
		const remPostings = new Map<string, number[]>();
		let postingOps = 0;
		for (let i = 0; i < m; i++) {
			const pending = maybeYield(2);
			if (pending) await pending;
			for (const [bg, countA] of remProfiles[i].bigramCounts) {
				let list = remPostings.get(bg);
				if (!list) {
					list = [];
					remPostings.set(bg, list);
				}
				list.push(i, countA);
				if ((++postingOps & 511) === 0) {
					const innerPending = maybeYield(32);
					if (innerPending) await innerPending;
				}
			}
		}
		for (let j = 0; j < n; j++) {
			const pending = maybeYield(2);
			if (pending) await pending;
			for (const [bg, countB] of addProfiles[j].bigramCounts) {
				if ((++postingOps & 511) === 0) {
					const innerPending = maybeYield(32);
					if (innerPending) await innerPending;
				}
				const list = remPostings.get(bg);
				if (!list) continue;
				for (let p = 0; p < list.length; p += 2) {
					const i = list[p];
					const countA = list[p + 1];
					sharedMatrix[i * n + j] += countA <= countB ? countA : countB;
					if ((++postingOps & 511) === 0) {
						const innerPending = maybeYield(32);
						if (innerPending) await innerPending;
					}
				}
			}
		}

		const pairSimMatrix = new Float64Array(m * n);
		for (let i = 0; i < m; i++) {
			const remProf = remProfiles[i];
			const rowOffset = i * n;
			for (let j = 0; j < n; j++) {
				const pending = maybeYield(1);
				if (pending) await pending;
				pairSimMatrix[rowOffset + j] = this.computePairSimilarity(
					remProf,
					addProfiles[j],
					sharedMatrix[rowOffset + j]
				);
			}
		}

		const stride = n + 1;
		const totalCells = (m + 1) * stride;
		const dp = new Float64Array(totalCells);
		const actionType = new Uint8Array(totalCells);
		const actionSpan = new Uint8Array(totalCells);

		for (let i = 0; i < m; i++) {
			const idx = i * stride + n;
			actionType[idx] = ACTION_DELETE;
			actionSpan[idx] = 1;
		}
		for (let j = 0; j < n; j++) {
			const idx = m * stride + j;
			actionType[idx] = ACTION_ADD;
			actionSpan[idx] = 1;
		}

		for (let i = m - 1; i >= 0; i--) {
			const remProf = remProfiles[i];
			const rowOffset = i * n;
			for (let j = n - 1; j >= 0; j--) {
				const cellPending = maybeYield(1);
				if (cellPending) await cellPending;
				const idx = i * stride + j;
				const addProf = addProfiles[j];
				const tieBias = 1e-6 * ((m - i) + (n - j));

				let bestScore = dp[(i + 1) * stride + j];
				let bestType = ACTION_DELETE;
				let bestSpan = 1;

				const addScore = dp[i * stride + (j + 1)];
				if (addScore > bestScore) {
					bestScore = addScore;
					bestType = ACTION_ADD;
					bestSpan = 1;
				}

				const sim = pairSimMatrix[rowOffset + j];
				if (sim >= MIN_PAIR_SIMILARITY) {
					const modScore = sim + tieBias + dp[(i + 1) * stride + (j + 1)];
					if (modScore > bestScore) {
						bestScore = modScore;
						bestType = ACTION_MODIFY;
						bestSpan = 1;
					}
				}

				if (remProf.totalBigrams >= 2 && addProf.totalBigrams >= 1) {
					const maxSplit = Math.min(MAX_SPLIT_MERGE_SPAN, n - j);
					if (
						maxSplit >= 2 &&
						sharedMatrix[rowOffset + j] / addProf.totalBigrams >= MIN_PIECE_CONTAINMENT
					) {
						let sumPieceBigrams = addProf.totalBigrams;
						let maxSingleSim = sim;
						const maxAllowedBigrams = remProf.totalBigrams * 1.6;
						const minRequiredBigrams = remProf.totalBigrams * 0.5;
						for (let k = 2; k <= maxSplit; k++) {
							const nextIdx = j + k - 1;
							const nextPiece = addProfiles[nextIdx];
							if (nextPiece.totalBigrams < 1) break;
							if (sharedMatrix[rowOffset + nextIdx] / nextPiece.totalBigrams < MIN_PIECE_CONTAINMENT) {
								break;
							}
							sumPieceBigrams += nextPiece.totalBigrams;
							if (sumPieceBigrams > maxAllowedBigrams) break;
							const pieceSim = pairSimMatrix[rowOffset + nextIdx];
							if (pieceSim > maxSingleSim) maxSingleSim = pieceSim;
							if (sumPieceBigrams < minRequiredBigrams) continue;

							const splitPending = maybeYield(4);
							if (splitPending) await splitPending;
							const splitSim = this.evaluateCompositeMatch(
								remProf,
								addProfiles.slice(j, j + k),
								maxSingleSim
							);
							if (splitSim !== null) {
								const splitScore = splitSim + tieBias + dp[(i + 1) * stride + (j + k)];
								if (splitScore > bestScore) {
									bestScore = splitScore;
									bestType = ACTION_SPLIT;
									bestSpan = k;
								}
							}
						}
					}
				}

				if (addProf.totalBigrams >= 2 && remProf.totalBigrams >= 1) {
					const maxMerge = Math.min(MAX_SPLIT_MERGE_SPAN, m - i);
					if (
						maxMerge >= 2 &&
						sharedMatrix[rowOffset + j] / remProf.totalBigrams >= MIN_PIECE_CONTAINMENT
					) {
						let sumPieceBigrams = remProf.totalBigrams;
						let maxSingleSim = sim;
						const maxAllowedBigrams = addProf.totalBigrams * 1.6;
						const minRequiredBigrams = addProf.totalBigrams * 0.5;
						for (let k = 2; k <= maxMerge; k++) {
							const nextIdx = i + k - 1;
							const nextPiece = remProfiles[nextIdx];
							const nextCell = nextIdx * n + j;
							if (nextPiece.totalBigrams < 1) break;
							if (sharedMatrix[nextCell] / nextPiece.totalBigrams < MIN_PIECE_CONTAINMENT) {
								break;
							}
							sumPieceBigrams += nextPiece.totalBigrams;
							if (sumPieceBigrams > maxAllowedBigrams) break;
							const pieceSim = pairSimMatrix[nextCell];
							if (pieceSim > maxSingleSim) maxSingleSim = pieceSim;
							if (sumPieceBigrams < minRequiredBigrams) continue;

							const mergePending = maybeYield(4);
							if (mergePending) await mergePending;
							const mergeSim = this.evaluateCompositeMatch(
								addProf,
								remProfiles.slice(i, i + k),
								maxSingleSim
							);
							if (mergeSim !== null) {
								const mergeScore = mergeSim + tieBias + dp[(i + k) * stride + (j + 1)];
								if (mergeScore > bestScore) {
									bestScore = mergeScore;
									bestType = ACTION_MERGE;
									bestSpan = k;
								}
							}
						}
					}
				}

				dp[idx] = bestScore;
				actionType[idx] = bestType;
				actionSpan[idx] = bestSpan;
			}
		}

		const ops: AlignedBlockOp[] = [];
		let i = 0;
		let j = 0;
		while (i < m || j < n) {
			const idx = i * stride + j;
			const type = actionType[idx];
			const span = actionSpan[idx] || 1;
			if (type === ACTION_MODIFY) {
				ops.push({ type: 'modified', leftLines: [remLines[i]], rightLines: [addLines[j]] });
				i++;
				j++;
			} else if (type === ACTION_SPLIT) {
				ops.push({ type: 'split', leftLines: [remLines[i]], rightLines: addLines.slice(j, j + span) });
				i++;
				j += span;
			} else if (type === ACTION_MERGE) {
				ops.push({ type: 'merge', leftLines: remLines.slice(i, i + span), rightLines: [addLines[j]] });
				i += span;
				j++;
			} else if (type === ACTION_ADD) {
				ops.push({ type: 'added', leftLines: [], rightLines: [addLines[j]] });
				j++;
			} else {
				ops.push({ type: 'deleted', leftLines: [remLines[i]], rightLines: [] });
				i++;
			}
		}
		return ops;
	}

	private static fineDiff(left: string, right: string, timeout: number): Promise<DiffChange[] | undefined> {
		// Small trimmed edits finish within a bounded synchronous slice, avoiding
		// several timer turns per paragraph consuming the chapter's time budget.
		if (left.length + right.length <= 512) {
			return Promise.resolve(Diff.diffChars(left, right, { timeout: Math.min(8, timeout), maxEditLength: 1000 }));
		}
		return new Promise(resolve => {
			Diff.diffChars(left, right, { timeout, maxEditLength: 1000, callback: resolve });
		});
	}

	/**
	 * 异步计算两份完整章节正文的结构化差异
	 */
	public static async computeDiff(
		leftRaw: string,
		rightRaw: string,
		options: DiffComputeOptions = {}
	): Promise<ChapterDiffResult> {
		if (options.isCancelled?.()) {
			throw new Error('Diff computation cancelled');
		}

		// Yield immediately to event loop before heavy computation
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
		if (options.isCancelled?.()) {
			throw new Error('Diff computation cancelled');
		}

		let fineDiffBudget = options.maxCharsForFineDiff ?? DEFAULT_MAX_CHARS_FOR_FINE_DIFF;
		let fineDeadline: number | undefined;
		const fineDiff = (left: string, right: string) => {
			fineDeadline ??= Date.now() + 3000;
			return Date.now() >= fineDeadline || options.isCancelled?.()
				? Promise.resolve(undefined) : this.fineDiff(left, right, Math.min(2000, fineDeadline - Date.now()));
		};

		const computeFineDiffWithTrim = async (
			left: string,
			right: string
		): Promise<{ charDiff?: DiffChange[]; exceedsLimit: boolean }> => {
			const leftChars = Array.from(left);
			const rightChars = Array.from(right);
			const minLen = Math.min(leftChars.length, rightChars.length);

			let prefixLen = 0;
			while (prefixLen < minLen && leftChars[prefixLen] === rightChars[prefixLen]) {
				prefixLen++;
			}

			let suffixLen = 0;
			while (
				suffixLen < minLen - prefixLen &&
				leftChars[leftChars.length - 1 - suffixLen] === rightChars[rightChars.length - 1 - suffixLen]
			) {
				suffixLen++;
			}

			const midLeftChars = leftChars.slice(prefixLen, leftChars.length - suffixLen);
			const midRightChars = rightChars.slice(prefixLen, rightChars.length - suffixLen);
			const charCount = midLeftChars.length + midRightChars.length;

			if (charCount > fineDiffBudget) {
				return { exceedsLimit: true };
			}

			const prefix = prefixLen > 0 ? leftChars.slice(0, prefixLen).join('') : '';
			const suffix = suffixLen > 0 ? leftChars.slice(leftChars.length - suffixLen).join('') : '';
			const midLeft = midLeftChars.join('');
			const midRight = midRightChars.join('');

			let midChanges: DiffChange[] | undefined;
			if (midLeft.length === 0 && midRight.length === 0) {
				midChanges = [];
			} else if (midLeft.length === 0) {
				midChanges = [{ value: midRight, added: true }];
			} else if (midRight.length === 0) {
				midChanges = [{ value: midLeft, removed: true }];
			} else {
				midChanges = await fineDiff(midLeft, midRight);
			}

			if (midChanges === undefined) {
				return { exceedsLimit: true };
			}

			fineDiffBudget -= charCount;

			const charDiff: DiffChange[] = [];
			if (prefix.length > 0) {
				charDiff.push({ value: prefix });
			}
			for (const change of midChanges) {
				if (change.value.length > 0) {
					charDiff.push(change);
				}
			}
			if (suffix.length > 0) {
				charDiff.push({ value: suffix });
			}

			return { charDiff, exceedsLimit: false };
		};

		// 1. 分离 YAML 与正文
		const leftPart = this.splitFrontmatterAndBody(leftRaw);
		const rightPart = this.splitFrontmatterAndBody(rightRaw);

		let yamlDiff: YamlDiffResult | undefined;
		if (leftPart.yaml !== null || rightPart.yaml !== null) {
			const lYaml = leftPart.yaml ?? '';
			const rYaml = rightPart.yaml ?? '';
			const lineDiffs = await new Promise<DiffChange[] | undefined>(resolve => {
				Diff.diffLines(leftPart.yamlHeader, rightPart.yamlHeader, { timeout: 40, maxEditLength: 1000, callback: resolve });
			});
			const hasDiff = leftPart.yamlHeader !== rightPart.yamlHeader;
			yamlDiff = {
				hasDifferences: hasDiff,
				changes: lineDiffs ?? [{ value: leftPart.yamlHeader, removed: true }, { value: rightPart.yamlHeader, added: true }],
				rawLeft: lYaml,
				rawRight: rYaml
			};
		}

		// 2. 正文按物理非空行（包含末尾分隔空行）进行切割
		const leftLines = this.splitParagraphBlocks(leftPart.body);
		const rightLines = this.splitParagraphBlocks(rightPart.body);

		// 3. 使用 diffArrays 对段落行进行最长公共子序列（LCS）对齐
		const arrayDiffs = await new Promise<Diff.ArrayChange<string>[] | undefined>(resolve => {
			Diff.diffArrays(leftLines, rightLines, { timeout: 100, maxEditLength: 2000, callback: resolve });
		}) ?? [
			{ value: leftLines, removed: true, added: false, count: leftLines.length },
			{ value: rightLines, added: true, removed: false, count: rightLines.length }
		];

		const rows: AlignedDiffRow[] = [];
		let rowIdCounter = 1;
		let hasBodyDifferences = false;

		let i = 0;
		while (i < arrayDiffs.length) {
			if (options.isCancelled?.()) {
				throw new Error('Diff computation cancelled');
			}
			if (i > 0 && i % 25 === 0) {
				await new Promise<void>(resolve => window.setTimeout(resolve, 0));
			}

			const current = arrayDiffs[i];

			if (!current.added && !current.removed) {
				for (const line of current.value) {
					rows.push({
						id: rowIdCounter++,
						type: 'unchanged',
						leftLines: [line],
						rightLines: [line]
					});
				}
				i++;
				continue;
			}

			hasBodyDifferences = true;

			const remLines: string[] = [];
			const addLines: string[] = [];
			while (i < arrayDiffs.length && (arrayDiffs[i].added || arrayDiffs[i].removed)) {
				if (arrayDiffs[i].removed) {
					remLines.push(...arrayDiffs[i].value);
				} else if (arrayDiffs[i].added) {
					addLines.push(...arrayDiffs[i].value);
				}
				i++;
			}

			const alignedOps = await this.alignChangedBlock(remLines, addLines, options.isCancelled);
			for (let k = 0; k < alignedOps.length; k++) {
				if (k > 0 && k % 25 === 0) {
					await new Promise<void>(resolve => window.setTimeout(resolve, 0));
					if (options.isCancelled?.()) {
						throw new Error('Diff computation cancelled');
					}
				}
				const op = alignedOps[k];
				if (op.type === 'deleted' || op.type === 'added') {
					rows.push({
						id: rowIdCounter++,
						type: op.type,
						leftLines: op.leftLines,
						rightLines: op.rightLines
					});
				} else {
					const leftText = op.leftLines.join('');
					const rightText = op.rightLines.join('');
					const { charDiff, exceedsLimit } = await computeFineDiffWithTrim(leftText, rightText);
					rows.push({
						id: rowIdCounter++,
						type: op.type,
						leftLines: op.leftLines,
						rightLines: op.rightLines,
						exceedsLimit,
						charDiff
					});
				}
			}
		}

		if (options.isCancelled?.()) throw new Error('Diff computation cancelled');
		const hasTotalDiff = hasBodyDifferences || Boolean(yamlDiff?.hasDifferences);

		return {
			hasDifferences: hasTotalDiff,
			yamlDiff,
			rows
		};
	}
}
