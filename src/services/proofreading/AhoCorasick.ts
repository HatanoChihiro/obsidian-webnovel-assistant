import type {
	ProofreadingDiagnostic,
	ProofreadingSource,
	WrongWordEntry,
	SensitiveWordEntry,
	SynonymGroup
} from '../../types/proofreading';
import { isRangeExcluded } from './MarkdownExclusion';

export interface ACOutput {
	word: string;
	source: ProofreadingSource;
	ruleId: string;
	data: WrongWordEntry | SensitiveWordEntry | { group: SynonymGroup; suggestions: string[] };
}

export interface ACNode {
	children: Map<string, ACNode>;
	fail: ACNode | null;
	outputs: ACOutput[];
}

export const SOURCE_PRIORITY: Record<ProofreadingSource, number> = {
	user_wrong: 5,
	user_sensitive: 4,
	builtin: 3,
	dedide: 2,
	user_synonym: 1,
	punctuation: 0
};

export class ACMatcher {
	private root: ACNode;

	constructor() {
		this.root = this.createNode();
	}

	private createNode(): ACNode {
		return {
			children: new Map(),
			fail: null,
			outputs: []
		};
	}

	/**
	 * 插入词条
	 */
	public insert(
		word: string,
		source: ProofreadingSource,
		ruleId: string,
		data: WrongWordEntry | SensitiveWordEntry | { group: SynonymGroup; suggestions: string[] }
	): void {
		if (!word) return;
		let node = this.root;
		for (const char of word) {
			let next = node.children.get(char);
			if (!next) {
				next = this.createNode();
				node.children.set(char, next);
			}
			node = next;
		}
		node.outputs.push({ word, source, ruleId, data });
	}

	/**
	 * 构建 Aho-Corasick 失败指针与后缀输出集
	 */
	public build(): void {
		const queue: ACNode[] = [];
		for (const child of this.root.children.values()) {
			child.fail = this.root;
			queue.push(child);
		}

		let head = 0;
		while (head < queue.length) {
			const current = queue[head++];
			for (const [char, child] of current.children.entries()) {
				let failNode = current.fail;
				while (failNode && !failNode.children.has(char)) {
					failNode = failNode.fail;
				}
				child.fail = failNode ? failNode.children.get(char)! : this.root;

				// 收集 fail 后缀输出集
				if (child.fail && child.fail.outputs.length > 0) {
					child.outputs.push(...child.fail.outputs);
				}
				queue.push(child);
			}
		}
	}

	/**
	 * 执行 Aho-Corasick 扫描
	 */
	public match(
		text: string,
		excludedRanges: Array<[number, number]>
	): ProofreadingDiagnostic[] {
		if (!text) return [];

		const rawMatches: ProofreadingDiagnostic[] = [];
		let node: ACNode = this.root;

		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			while (node !== this.root && !node.children.has(char)) {
				node = node.fail || this.root;
			}
			node = node.children.get(char) || this.root;

			if (node.outputs.length > 0) {
				for (const out of node.outputs) {
					const word = out.word;
					const from = i + 1 - word.length;
					const to = i + 1;

					// 检查 Markdown 语法排除
					if (isRangeExcluded(from, to, excludedRanges)) {
						continue;
					}

					// 确保子串完全匹配原文
					if (text.substring(from, to) !== word) {
						continue;
					}

					if (out.source === 'user_wrong' || out.source === 'builtin') {
						const d = out.data as WrongWordEntry;
						rawMatches.push({
							ruleId: out.ruleId,
							type: 'wrong_word',
							from,
							to,
							original: word,
							severity: 'warning',
							confidence: 'high',
							message: d.description,
							suggestions: d.suggestion ? [d.suggestion] : [],
							source: out.source
						});
					} else if (out.source === 'user_sensitive') {
						const d = out.data as SensitiveWordEntry;
						// 校验例外词（必须覆盖 [from, to] 匹配范围）
						let isExempt = false;
						if (d.exceptions && d.exceptions.length > 0) {
							for (const ex of d.exceptions) {
								if (!ex) continue;
								const searchStart = Math.max(0, from - ex.length);
								const searchEnd = Math.min(text.length, to + ex.length);
								const windowStr = text.substring(searchStart, searchEnd);
								let idx = windowStr.indexOf(ex);
								while (idx !== -1) {
									const exFrom = searchStart + idx;
									const exTo = exFrom + ex.length;
									if (exFrom <= from && exTo >= to) {
										isExempt = true;
										break;
									}
									idx = windowStr.indexOf(ex, idx + 1);
								}
								if (isExempt) break;
							}
						}

						if (!isExempt) {
							rawMatches.push({
								ruleId: out.ruleId,
								type: 'sensitive',
								from,
								to,
								original: word,
								severity: d.severity,
								confidence: 'high',
								message: d.description,
								suggestions: d.suggestions || [],
								source: 'user_sensitive'
							});
						}
					} else if (out.source === 'user_synonym') {
						const d = out.data as { group: SynonymGroup; suggestions: string[] };
						rawMatches.push({
							ruleId: out.ruleId,
							type: 'synonym',
							from,
							to,
							original: word,
							severity: 'info',
							confidence: 'high',
							message: d.group.description,
							suggestions: d.suggestions,
							source: 'user_synonym'
						});
					}
				}
			}
		}

		return rawMatches;
	}
}

/**
 * 解决重叠诊断冲突并排序：
 * 1. 完全相同区间 [from, to]：合并建议与来源
 * 2. 部分重叠区间：最长匹配优先
 * 3. 相同长度重叠：按优先级 用户错词 > 用户敏感 > 内置错词 > 的地得 > 近义词
 */
export function resolveOverlaps(diagnostics: ProofreadingDiagnostic[]): ProofreadingDiagnostic[] {
	if (diagnostics.length <= 1) return diagnostics;

	// 1. 同范围合并
	const rangeMap = new Map<string, ProofreadingDiagnostic[]>();
	for (const diag of diagnostics) {
		const key = `${diag.from}:${diag.to}`;
		const list = rangeMap.get(key);
		if (list) {
			list.push(diag);
		} else {
			rangeMap.set(key, [diag]);
		}
	}

	const mergedCandidates: ProofreadingDiagnostic[] = [];
	for (const list of rangeMap.values()) {
		if (list.length === 1) {
			mergedCandidates.push(list[0]);
		} else {
			// 按来源优先级降序排序
			list.sort((a, b) => (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0));
			const primary = list[0];

			// 合并替换建议并去重
			const suggestions: string[] = [];
			const seen = new Set<string>();
			for (const item of list) {
				for (const s of item.suggestions) {
					if (s && !seen.has(s)) {
						seen.add(s);
						suggestions.push(s);
					}
				}
			}

			// 合并说明消息
			const messages = list
				.map(item => item.message)
				.filter((m, idx, arr) => m && arr.indexOf(m) === idx);

			mergedCandidates.push({
				...primary,
				suggestions,
				message: messages.join('；')
			});
		}
	}

	// 2. 解决部分重叠
	// 排序规则：
	// 1) 长度较长者优先（降序）
	// 2) 相同长度时来源优先级较高者优先（降序）
	// 3) 起始偏移量较小者优先（升序）
	mergedCandidates.sort((a, b) => {
		const lenA = a.to - a.from;
		const lenB = b.to - b.from;
		if (lenA !== lenB) return lenB - lenA;
		const prioA = SOURCE_PRIORITY[a.source] || 0;
		const prioB = SOURCE_PRIORITY[b.source] || 0;
		if (prioA !== prioB) return prioB - prioA;
		return a.from - b.from;
	});

	const accepted: ProofreadingDiagnostic[] = [];
	for (const candidate of mergedCandidates) {
		const hasOverlap = accepted.some(acc => candidate.from < acc.to && candidate.to > acc.from);
		if (!hasOverlap) {
			accepted.push(candidate);
		}
	}

	// 最终按起始偏移量正序返回
	accepted.sort((a, b) => a.from - b.from || a.to - b.to);
	return accepted;
}
