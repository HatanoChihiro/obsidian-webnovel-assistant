import type { ProofreadingDiagnostic, DeDiDeLexicon } from '../../types/proofreading';
import { isRangeExcluded } from './MarkdownExclusion';
import { t } from '../../i18n';

/**
 * 保守的“的/地/得”局部语法规则检测器
 *
 * 针对 6 个方向的高置信度常见模式输出“可能误用”诊断，不确定或有歧义时保持静默：
 * 1. 的 → 地 (状语修饰动词误用“的”，如“慢慢的走”)
 * 2. 得 → 地 (状语修饰动词误用“得”，如“慢慢得走”)
 * 3. 的 → 得 (动词接固定程度补语如“高兴的不得了”/形容词比较“好的多”；“的+普通程度词/形容词”如“他说的很好”保持静默)
 * 4. 地 → 得 (动词接程度补语如“跑地很快”/“高兴地不得了”/形容词比较“好地多”)
 * 5. 地 → 的 (定语修饰名词误用“地”，如“美丽地姑娘”)
 * 6. 得 → 的 (定语修饰名词误用“得”，如“美丽得姑娘”)
 */

interface DeDiDePattern {
	id: string;
	regex: RegExp;
	charIndexOffset: number; // 匹配字符串中“的/地/得”字符相对于匹配起点的偏移（<0 表示通过捕获组1的长度动态计算）
	expectedChar: '的' | '地' | '得';
	messageBuilder: (matchText: string) => string;
	confidence: 'high' | 'medium';
	shouldExclude?: (fullText: string, matchEnd: number) => boolean;
}

/**
 * 编译 DeDiDe 规则词典，生成正则表达式模式数组
 */
export function compileDeDiDePatterns(lexicon: DeDiDeLexicon): DeDiDePattern[] {
	// 按长度降序排序，确保正则 longest-match
	const sortLongest = (arr: string[]) => [...arr].sort((a, b) => b.length - a.length);
	const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const buildGroup = (arr: string[]) => {
		const filtered = (arr || []).filter(s => typeof s === 'string' && s.trim().length > 0);
		return filtered.length > 0 ? sortLongest(filtered).map(escapeRegex).join('|') : '';
	};
	const buildNounGroup = (arr: string[]) => {
		const filtered = (arr || []).filter(s => typeof s === 'string' && s.trim().length > 0);
		if (filtered.length === 0) return '';
		const sorted = sortLongest(filtered);
		return sorted.map(term => {
			const escaped = escapeRegex(term);
			if (term.length === 1) {
				return `${escaped}(?=[，。！？；：、…—~～\\s\\r\\n"“”'‘’（）()\\[\\]【】《》]|$)`;
			}
			return escaped;
		}).join('|');
	};

	const advMods = buildGroup(lexicon.adverbialModifiers);
	const actionVerbs = buildGroup(lexicon.actionVerbs);
	const actionNominalFollowers = (lexicon.actionNominalFollowers || []).filter(
		s => typeof s === 'string' && s.trim().length > 0
	);
	const shouldExcludeActionNominal = actionNominalFollowers.length > 0
		? (fullText: string, matchEnd: number) => actionNominalFollowers.some(f => fullText.startsWith(f, matchEnd))
		: undefined;
	const degPreds = buildGroup(lexicon.degreePredicates);
	const degCompPrefixes = buildGroup(lexicon.degreeComplementPrefixes);
	const degCompAdjs = buildGroup(lexicon.degreeComplementAdjectives);
	const degCompPhrases = buildGroup(lexicon.degreeComplementPhrases);
	const compAdjs = buildGroup(lexicon.comparativeAdjectives);
	const compWords = buildGroup(lexicon.comparativeWords);
	const nounLookaheads = buildGroup(lexicon.nounLookaheadExclusions);
	const nounExclusion = nounLookaheads ? `(?!${nounLookaheads})` : '';
	const attrAdjs = buildGroup(lexicon.attributiveAdjectives);
	const attrNouns = buildNounGroup(lexicon.attributiveNouns);

	const patterns: DeDiDePattern[] = [];

	// 1. 的 → 地 (状语修饰动词误用“的”)
	if (advMods && actionVerbs) {
		patterns.push({
			id: 'dedide_adv_de_verb',
			regex: new RegExp(`(${advMods})的(${actionVerbs})`, 'g'),
			charIndexOffset: -1,
			expectedChar: '地',
			messageBuilder: (matchText) => t('proofreading.dedide-adv-verb', { text: matchText }),
			confidence: 'high',
			shouldExclude: shouldExcludeActionNominal
		});
	}

	// 2. 得 → 地 (状语修饰动词误用“得”)
	if (advMods && actionVerbs) {
		patterns.push({
			id: 'dedide_adv_de2_verb',
			regex: new RegExp(`(${advMods})得(${actionVerbs})`, 'g'),
			charIndexOffset: -1,
			expectedChar: '地',
			messageBuilder: (matchText) => t('proofreading.dedide-adv-verb', { text: matchText }),
			confidence: 'high',
			shouldExclude: shouldExcludeActionNominal
		});
	}

	// 3. 的 → 得
	// 3a. 动词/谓词接固定程度补语短语误用“的” (如“高兴的不得了”、“急的直跺脚”、“痛的要命”)
	// 注意：“的+普通程度词/形容词”（如“他说的很好”、“做的大”）必须保持静默，避免名词性短语假阳性
	if (degPreds && degCompPhrases) {
		patterns.push({
			id: 'dedide_verb_de_phrase',
			regex: new RegExp(`(${degPreds})的(${degCompPhrases})(?=[，。！？；：、…—\\s\\r\\n]|$|[^的])`, 'g'),
			charIndexOffset: -1,
			expectedChar: '得',
			messageBuilder: (matchText) => t('proofreading.dedide-degree-comp', { text: matchText }),
			confidence: 'high'
		});
	}

	// 3b. 形容词/比较接“的多/的少”程度补语误用“的” (如“好的多”、“大的多”)
	if (compAdjs && compWords) {
		patterns.push({
			id: 'dedide_adj_de_duo',
			regex: new RegExp(`(${compAdjs})的(${compWords})${nounExclusion}(?=[，。！？；：、…—\\s\\r\\n了呢啦啊呀吧]|$|.)`, 'g'),
			charIndexOffset: -1,
			expectedChar: '得',
			messageBuilder: (matchText) => t('proofreading.dedide-degree-comp', { text: matchText }),
			confidence: 'medium'
		});
	}

	// 4. 地 → 得
	// 4a. 动词/谓词接程度补语误用“地” (包含普通程度形容词与固定短语，如“跑地很快”、“说地很好”、“高兴地不得了”)
	const prefixedDegreeAdjectives = degCompAdjs
		? `${degCompPrefixes ? `(?:${degCompPrefixes})?` : ''}(?:${degCompAdjs})`
		: '';
	const degreeComplements = [prefixedDegreeAdjectives, degCompPhrases].filter(Boolean).join('|');
	if (degPreds && degreeComplements) {
		patterns.push({
			id: 'dedide_verb_di_comp',
			regex: new RegExp(`(${degPreds})地(${degreeComplements})(?=[，。！？；：、…—\\s\\r\\n]|$|[^地])`, 'g'),
			charIndexOffset: -1,
			expectedChar: '得',
			messageBuilder: (matchText) => t('proofreading.dedide-degree-comp', { text: matchText }),
			confidence: 'high'
		});
	}

	// 4b. 形容词/比较接“地多/地少”程度补语误用“地” (如“好地多”)
	if (compAdjs && compWords) {
		patterns.push({
			id: 'dedide_adj_di_duo',
			regex: new RegExp(`(${compAdjs})地(${compWords})${nounExclusion}(?=[，。！？；：、…—\\s\\r\\n了呢啦啊呀吧]|$|.)`, 'g'),
			charIndexOffset: -1,
			expectedChar: '得',
			messageBuilder: (matchText) => t('proofreading.dedide-degree-comp', { text: matchText }),
			confidence: 'high'
		});
	}

	// 5. 地 → 的 (定语修饰名词误用“地”，如“美丽地姑娘”)
	if (attrAdjs && attrNouns) {
		patterns.push({
			id: 'dedide_adj_di_noun',
			regex: new RegExp(`(${attrAdjs})地(${attrNouns})(?=[，。！？；：、…—~～\\s\\r\\n"“”'‘’（）()\\[\\]【】《》]|$|[^地])`, 'g'),
			charIndexOffset: -1,
			expectedChar: '的',
			messageBuilder: (matchText) => t('proofreading.dedide-adj-noun', { text: matchText }),
			confidence: 'high'
		});
	}

	// 6. 得 → 的 (定语修饰名词误用“得”，如“美丽得姑娘”)
	if (attrAdjs && attrNouns) {
		patterns.push({
			id: 'dedide_adj_de2_noun',
			regex: new RegExp(`(${attrAdjs})得(${attrNouns})(?=[，。！？；：、…—~～\\s\\r\\n"“”'‘’（）()\\[\\]【】《》]|$|[^得])`, 'g'),
			charIndexOffset: -1,
			expectedChar: '的',
			messageBuilder: (matchText) => t('proofreading.dedide-adj-noun', { text: matchText }),
			confidence: 'high'
		});
	}

	return patterns;
}

/**
 * DeDiDe 语法扫描器类
 * 在词典更新时重新实例化，并负责扫描任务
 */
export class DeDiDeScanner {
	private patterns: DeDiDePattern[];

	constructor(lexicon: DeDiDeLexicon) {
		this.patterns = compileDeDiDePatterns(lexicon);
	}

	public scan(text: string, excludedRanges: Array<[number, number]>): ProofreadingDiagnostic[] {
		if (!text) return [];

		const diagnostics: ProofreadingDiagnostic[] = [];

		for (const pattern of this.patterns) {
			const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
			let match: RegExpExecArray | null;

			while ((match = regex.exec(text)) !== null) {
				const matchText = match[0];
				const matchStart = match.index;
				const matchEnd = matchStart + matchText.length;

				// 检查匹配后排除（如动作词后接名词化后缀）
				if (pattern.shouldExclude?.(text, matchEnd)) {
					continue;
				}

				// 计算目标字符“的/地/得”在 matchText 中的具体位置
				let charOffsetInMatch: number;
				if (pattern.charIndexOffset < 0) {
					const prefix = match[1];
					charOffsetInMatch = prefix ? prefix.length : 0;
				} else {
					charOffsetInMatch = pattern.charIndexOffset;
				}

				// 防御性校验：若定位处不是“的地得”，在 matchText 内搜索目标助词
				if (matchText[charOffsetInMatch] !== '的' && matchText[charOffsetInMatch] !== '地' && matchText[charOffsetInMatch] !== '得') {
					const foundIdx = matchText.search(/[的地得]/);
					if (foundIdx !== -1) {
						charOffsetInMatch = foundIdx;
					}
				}

				const charStart = matchStart + charOffsetInMatch;
				const charEnd = charStart + 1;

				// 检查是否被 Markdown 排除
				if (isRangeExcluded(matchStart, matchEnd, excludedRanges) || isRangeExcluded(charStart, charEnd, excludedRanges)) {
					continue;
				}

				const originalChar = text.substring(charStart, charEnd);
				if (originalChar === pattern.expectedChar) {
					continue;
				}

				const correctedSpan = matchText.substring(0, charOffsetInMatch) +
					pattern.expectedChar +
					matchText.substring(charOffsetInMatch + 1);

				diagnostics.push({
					ruleId: pattern.id,
					type: 'grammar',
					from: matchStart,
					to: matchEnd,
					original: matchText,
					severity: 'warning',
					confidence: pattern.confidence,
					message: pattern.messageBuilder(matchText),
					suggestions: [correctedSpan],
					source: 'dedide'
				});
			}
		}

		return diagnostics.sort((a, b) => a.from - b.from || a.to - b.to);
	}
}
