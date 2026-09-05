import type { ProofreadingDiagnostic } from '../../types/proofreading';
import { isRangeExcluded } from './MarkdownExclusion';
import { t } from '../../i18n';

/**
 * 常见中文全角成对标点
 */
const PAIRED_PUNCTS: Array<[string, string]> = [
	['“', '”'],
	['‘', '’'],
	['（', '）'],
	['【', '】'],
	['《', '》']
];
const LEFT_PUNCTS = new Set(PAIRED_PUNCTS.map(p => p[0]));
const RIGHT_PUNCTS = new Set(PAIRED_PUNCTS.map(p => p[1]));

/**
 * Unicode 汉字范围检测正则
 */
const HAN_REGEX = /\p{Script=Han}/u;

/**
 * 拉丁字母检测正则
 */
const LATIN_REGEX = /[a-zA-Z]/;

/**
 * 中文语境下需要转换为全角标点的 ASCII 标点映射
 */
export const CN_PUNCTUATION_MAP: Record<string, string> = {
	',': '，',
	'.': '。',
	'?': '？',
	'!': '！',
	':': '：',
	';': '；',
	'(': '（',
	')': '）'
};

/**
 * 英文语境下需要转换为半角标点的全角标点映射
 */
export const EN_PUNCTUATION_MAP: Record<string, string> = {
	'，': ',',
	'。': '.',
	'？': '?',
	'！': '!',
	'：': ':',
	'；': ';',
	'（': '(',
	'）': ')'
};

/**
 * URL 匹配正则（仅匹配 ASCII URL 语法，遇到汉字自动停止）
 */
const URL_REGEX = new RegExp(
	String.raw`(?:https?://|ftp://|www\.)[a-zA-Z0-9._~:/?#\[\]@!$&'*+,;=%-]+`,
	'gi'
);

/**
 * 邮箱匹配正则（确保域名标签以字母数字或连字符结尾，避免吞入句末标点）
 */
const EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g;

/**
 * 提取单行中受保护的区间（URL、Email 等）
 */
function getLineProtectedRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];

	let match: RegExpExecArray | null;
	const urlRegex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
	while ((match = urlRegex.exec(line)) !== null) {
		const matchStr = match[0];
		// 剥离末尾常见的句子标点，使其作为正文标点接受检查
		const trailingPunctMatch = /[.,!?:;]+$/.exec(matchStr);
		const matchLength = trailingPunctMatch ? matchStr.length - trailingPunctMatch[0].length : matchStr.length;
		if (matchLength > 0) {
			ranges.push([match.index, match.index + matchLength]);
		}
	}

	const emailRegex = new RegExp(EMAIL_REGEX.source, EMAIL_REGEX.flags);
	while ((match = emailRegex.exec(line)) !== null) {
		ranges.push([match.index, match.index + match[0].length]);
	}

	return ranges;
}

function isIndexInRanges(index: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * 向左或向右查找最近的有意义脚本类型（Han / Latin），
 * 自动跳过空白、数字、其他标点符号以及受保护/排除的区间。
 */
function findNearestScript(
	line: string,
	lineStartOffset: number,
	startIndex: number,
	direction: -1 | 1,
	excludedRanges: Array<[number, number]>,
	protectedRanges: Array<[number, number]>
): 'han' | 'latin' | null {
	let idx = startIndex;
	while (idx >= 0 && idx < line.length) {
		const absOffset = lineStartOffset + idx;
		if (
			!isRangeExcluded(absOffset, absOffset + 1, excludedRanges) &&
			!isIndexInRanges(idx, protectedRanges)
		) {
			const ch = line[idx];
			if (HAN_REGEX.test(ch)) {
				return 'han';
			}
			if (LATIN_REGEX.test(ch)) {
				return 'latin';
			}
		}
		idx += direction;
	}
	return null;
}

/**
 * 标点符号诊断扫描器
 *
 * 核心设计规则：
 * 1. 采用局部标点上下文推断：在同单行内向两侧寻找最近的有意义汉字/拉丁字母（跳过空白/数字/标点及受保护区间），绝不依赖 UI locale；
 * 2. 两侧均存在且一致时判定为该语境；仅一侧存在时判定为该语境；两侧冲突（如处于中英边界）或两侧均无字母/汉字时保守跳过；
 * 3. 严格保护小数（3.14）、千分位（1,000）、时间（12:30）、URL、Email、连续省略号（...）及 Markdown 排除区间；
 * 4. 仅执行无歧义的精确配对映射（,.?!:;() <-> ，。？！：；（））；
 * 5. 诊断结果作为普通建议提供，需经用户显式确认后替换。
 */
export class PunctuationScanner {
	public scan(text: string, excludedRanges: Array<[number, number]>): ProofreadingDiagnostic[] {
		if (!text) return [];

		const diagnostics: ProofreadingDiagnostic[] = [];
		const pairedTokens: { char: string; offset: number }[] = [];
		const lines = text.split('\n');
		let lineStartOffset = 0;

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx];
			const lineLenWithNewline = line.length + 1; // 含 \n

			if (line.length > 0) {
				const lineHasHan = HAN_REGEX.test(line);
				const protectedRanges = getLineProtectedRanges(line);

				// Markdown 有序列表前缀保护 (例如 "1. 章节标题")
				let listDotIndex = -1;
				const listMatch = /^\s*(\d+)\.\s+/.exec(line);
				if (listMatch) {
					listDotIndex = line.indexOf('.', listMatch[0].indexOf(listMatch[1]));
				}

				for (let i = 0; i < line.length; i++) {
					const char = line[i];
					const absoluteOffset = lineStartOffset + i;

					// 1. 检查是否为候选标点
					const isCnCandidate = char in CN_PUNCTUATION_MAP;
					const isEnCandidate = char in EN_PUNCTUATION_MAP;
					const isPairedCandidate = LEFT_PUNCTS.has(char) || RIGHT_PUNCTS.has(char);

					if (!isCnCandidate && !isEnCandidate && !isPairedCandidate) {
						continue;
					}

					// 2. 检查 Markdown 语法排除与行内保护
					if (isRangeExcluded(absoluteOffset, absoluteOffset + 1, excludedRanges)) {
						continue;
					}
					if (isIndexInRanges(i, protectedRanges)) {
						continue;
					}

					if (isPairedCandidate) {
						pairedTokens.push({ char, offset: absoluteOffset });
					}

					if (!isCnCandidate && !isEnCandidate) {
						continue;
					}

					// 3. 数字、省略号及有序列表序号保护规则
					// 保护 1: 小数点 (例如 3.14) 与省略号 (.. 或 ...)
					if (char === '.') {
						if (i === listDotIndex) continue;
						const prevIsDigit = i > 0 && /\d/.test(line[i - 1]);
						const nextIsDigit = i + 1 < line.length && /\d/.test(line[i + 1]);
						if (prevIsDigit && nextIsDigit) continue;

						const prevIsDot = i > 0 && line[i - 1] === '.';
						const nextIsDot = i + 1 < line.length && line[i + 1] === '.';
						if (prevIsDot || nextIsDot) continue;
					}

					// 保护 2: 千分位逗号 (例如 1,000)
					if (char === ',') {
						const prevIsDigit = i > 0 && /\d/.test(line[i - 1]);
						const nextIsDigit = i + 1 < line.length && /\d/.test(line[i + 1]);
						if (prevIsDigit && nextIsDigit) continue;
					}

					// 保护 3: 时间格式冒号 (例如 12:30)
					if (char === ':') {
						const prevIsDigit = i > 0 && /\d/.test(line[i - 1]);
						const nextIsDigit = i + 1 < line.length && /\d/.test(line[i + 1]);
						if (prevIsDigit && nextIsDigit) continue;
					}

					// 4. 局部上下文推断：查找两侧最近的 Han / Latin 字符
					const leftScript = findNearestScript(
						line,
						lineStartOffset,
						i - 1,
						-1,
						excludedRanges,
						protectedRanges
					);
					const rightScript = findNearestScript(
						line,
						lineStartOffset,
						i + 1,
						1,
						excludedRanges,
						protectedRanges
					);

					let targetScript: 'han' | 'latin' | null = null;
					if (leftScript && rightScript) {
						if (leftScript === rightScript) {
							targetScript = leftScript;
						}
					} else if (leftScript) {
						targetScript = leftScript;
					} else if (rightScript) {
						targetScript = rightScript;
					}

					if (!targetScript) {
						continue;
					}

					if (targetScript === 'han' && isCnCandidate) {
						const suggested = CN_PUNCTUATION_MAP[char];
						if (!suggested) continue;

						diagnostics.push({
							ruleId: `punctuation_cn_${char}`,
							type: 'punctuation',
							from: absoluteOffset,
							to: absoluteOffset + 1,
							original: char,
							severity: 'info',
							confidence: 'high',
							message: t('proofreading.punctuation-suggestion', { suggestion: suggested }),
							suggestions: [suggested],
							source: 'punctuation'
						});
					} else if (targetScript === 'latin' && isEnCandidate) {
						// 中英混排保护：若所在行包含汉字，说明处于中文句子/语境中，
						// 即使句末以英文缩写/单词结尾（如“技能等级Lv1。”、“我认为xx。”），全角标点亦属合法规范排版，不予误报为西文半角
						if (lineHasHan) {
							continue;
						}

						const suggested = EN_PUNCTUATION_MAP[char];
						if (!suggested) continue;

						diagnostics.push({
							ruleId: `punctuation_en_${char}`,
							type: 'punctuation',
							from: absoluteOffset,
							to: absoluteOffset + 1,
							original: char,
							severity: 'info',
							confidence: 'high',
							message: t('proofreading.punctuation-suggestion', { suggestion: suggested }),
							suggestions: [suggested],
							source: 'punctuation'
						});
					}
				}
			}

			lineStartOffset += lineLenWithNewline;
		}
		// 处理成对标点验证
		const diagnosedOffsets = new Set<number>();
		const addPairDiag = (token: { char: string; offset: number }, msgKey: string) => {
			if (!diagnosedOffsets.has(token.offset)) {
				diagnostics.push({
					ruleId: `punctuation_pair_${token.char}`,
					type: 'punctuation',
					from: token.offset,
					to: token.offset + 1,
					original: token.char,
					severity: 'warning',
					confidence: 'high',
					message: t(msgKey, { char: token.char }),
					suggestions: [],
					source: 'punctuation'
				});
				diagnosedOffsets.add(token.offset);
			}
		};

		for (const [left, right] of PAIRED_PUNCTS) {
			const typeTokens = pairedTokens.filter(t => t.char === left || t.char === right);

			// 1. 先扫描连续同侧符号，优先级最高
			for (let i = 1; i < typeTokens.length; i++) {
				const token = typeTokens[i];
				const prevToken = typeTokens[i - 1];
				if (prevToken.char === token.char) {
					const textBetween = text.substring(prevToken.offset + 1, token.offset);
					if (textBetween.trim() === '') {
						addPairDiag(prevToken, 'proofreading.punctuation-consecutive');
						addPairDiag(token, 'proofreading.punctuation-consecutive');
					}
				}
			}

			// 2. 栈匹配检测未闭合和孤立符号
			const stack: typeof typeTokens = [];
			for (let i = 0; i < typeTokens.length; i++) {
				const token = typeTokens[i];
				if (token.char === left) {
					stack.push(token);
				} else {
					if (stack.length === 0) {
						addPairDiag(token, 'proofreading.punctuation-isolated-right');
					} else {
						stack.pop();
					}
				}
			}

			for (const token of stack) {
				addPairDiag(token, 'proofreading.punctuation-unclosed-left');
			}
		}

		return diagnostics.sort((a, b) => a.from - b.from || a.to - b.to);
	}
}
