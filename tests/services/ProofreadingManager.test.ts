import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as obsidian from 'obsidian';
import { TFile, TFolder, type App, type Vault, type FileManager, type RequestUrlResponse } from 'obsidian';
import {
	ProofreadingManager,
	validateBasicWrongWordsJson,
	validateDeDiDeLexiconJson,
	DICT_FOLDER_NAME,
	WRONG_WORDS_FILE,
	SYNONYMS_FILE,
	SENSITIVE_WORDS_FILE
} from '../../src/services/ProofreadingManager';
import { BASIC_DICT_CONFIG } from '../../src/constants';
import type { WebNovelAssistantPlugin } from '../../src/types/plugin';
import type { AccurateCountSettings } from '../../src/types/settings';
import {
	parseWrongWordsTable,
	parseSynonymsTable,
	parseSensitiveWordsTable,
	updateTableInMarkdown
} from '../../src/services/proofreading/tableParser';
import { extractMarkdownExclusions, isRangeExcluded } from '../../src/services/proofreading/MarkdownExclusion';
import { ACMatcher, resolveOverlaps } from '../../src/services/proofreading/AhoCorasick';
import { DeDiDeScanner } from '../../src/services/proofreading/DeDiDeRule';
import { PunctuationScanner } from '../../src/services/proofreading/PunctuationRule';
import type { ProofreadingDiagnostic, DeDiDeLexicon } from '../../src/types/proofreading';
import { setLocale } from '../../src/i18n';

const TEST_DEDIDE_LEXICON: DeDiDeLexicon = {
	schemaVersion: 1,
	dictionaryVersion: 'test',
	updatedAt: '2026-08-23',
	license: 'MIT',
	source: 'Test fixture',
	adverbialModifiers: ['飞快', '委屈', '快乐', '沉默', '意外', '认真'],
	actionVerbs: ['跑', '哭', '哭泣', '唱', '唱歌', '站', '打开'],
	actionNominalFollowers: ['方式', '声'],
	degreePredicates: ['跑', '处理', '笑', '美丽', '丑陋'],
	degreeComplementPrefixes: ['很'],
	degreeComplementAdjectives: ['快', '好', '充分'],
	degreeComplementPhrases: ['不行', '令人窒息'],
	comparativeAdjectives: ['容易', '好'],
	comparativeWords: ['多', '少'],
	nounLookaheadExclusions: ['功', '元', '种', '数', '年'],
	attributiveAdjectives: ['美丽', '沉默', '丑陋', '意外'],
	attributiveNouns: ['姑娘', '女孩', '男孩', '人', '心']
};

function createRequestUrlResponse(payload: unknown): RequestUrlResponse {
	return {
		status: 200,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		text: JSON.stringify(payload),
		json: payload
	};
}

function createMockTFile(path: string): TFile {
	const name = path.split('/').pop() || '';
	return Object.assign(new TFile(), {
		name,
		path,
		basename: name.replace(/\.[^/.]+$/, ''),
		extension: name.includes('.') ? name.split('.').pop() || 'md' : 'md'
	});
}

function createMockTFolder(path: string): TFolder {
	const name = path.split('/').pop() || '';
	return Object.assign(new TFolder(), {
		name,
		path,
		children: []
	});
}

describe('Table Parser & Strict Markdown Validation', () => {
	it('should parse valid exact 3-column wrong words table', () => {
		const md = `# 错词表\n\n| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 常见错字 |\n| 迫不急待 | 迫不及待 | 成语误用 |\n\n注：表外文本`;
		const res = parseWrongWordsTable(md);
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.size).toBe(2);
			expect(res.data.get('报歉')).toEqual({
				word: '报歉',
				suggestion: '抱歉',
				description: '常见错字'
			});
			expect(res.data.get('迫不急待')?.suggestion).toBe('迫不及待');
		}
	});

	it('should reject wrong words table if header is not exact or malformed data row exists', () => {
		// 表头非严格匹配
		const nonExactHeader = `| 错误词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 常见错字 |`;
		expect(parseWrongWordsTable(nonExactHeader).success).toBe(false);

		// 数据行列数不匹配（某行 4 列）
		const malformedRow = `| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 常见错字 | 额外列 |`;
		const res = parseWrongWordsTable(malformedRow);
		expect(res.success).toBe(false);
		if (!res.success) {
			expect(res.reason).toContain('列数不匹配');
		}
	});

	it('should parse synonyms table with symmetric cross-recommendations and exact headers', () => {
		const md = `| 近义词组 | 说明 |\n| --- | --- |\n| 高兴、快乐, 开心 | 喜悦相关 |\n| 悲伤，难过 | 悲痛相关 |`;
		const res = parseSynonymsTable(md);
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.size).toBe(5);
			const happy = res.data.get('高兴');
			expect(happy?.suggestions).toEqual(['快乐', '开心']);
			expect(happy?.group.description).toBe('喜悦相关');

			const sad = res.data.get('悲伤');
			expect(sad?.suggestions).toEqual(['难过']);
		}
	});

	it('should reject synonyms table when a word belongs to multiple groups (一词仅一组)', () => {
		const md = `| 近义词组 | 说明 |\n| --- | --- |\n| 开心、快乐 | 喜悦组1 |\n| 开心、愉悦 | 喜悦组2 |`;
		const res = parseSynonymsTable(md);
		expect(res.success).toBe(false);
		if (!res.success) {
			expect(res.reason).toContain('一词仅一组');
		}
	});

	it('should parse sensitive words table with multiple comma-separated suggestions and valid severity', () => {
		const md = `| 词语 | 建议 | 级别 | 例外 | 说明 |\n| --- | --- | --- | --- | --- |\n| 违禁词 | 替换词A、替换词B, 替换词C | 警告 | 例外A、例外B | 严重违规 |\n| 提示词 | | 提示 | | 温和提示 |`;
		const res = parseSensitiveWordsTable(md);
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.size).toBe(2);
			const entry1 = res.data.get('违禁词');
			expect(entry1?.severity).toBe('warning');
			expect(entry1?.suggestions).toEqual(['替换词A', '替换词B', '替换词C']);
			expect(entry1?.exceptions).toEqual(['例外A', '例外B']);

			const entry2 = res.data.get('提示词');
			expect(entry2?.severity).toBe('info');
			expect(entry2?.suggestions).toEqual([]);
		}
	});

	it('should reject sensitive words table if severity is invalid or row has wrong column count', () => {
		const invalidLevel = `| 词语 | 建议 | 级别 | 例外 | 说明 |\n| --- | --- | --- | --- | --- |\n| 词语 | 建议 | 致命 | 例外 | 说明 |`;
		expect(parseSensitiveWordsTable(invalidLevel).success).toBe(false);

		const wrongCols = `| 词语 | 建议 | 级别 | 例外 | 说明 |\n| --- | --- | --- | --- | --- |\n| 词语 | 建议 | 警告 | 说明 |`;
		expect(parseSensitiveWordsTable(wrongCols).success).toBe(false);
	});

	it('should parse English dictionary headers and severity levels', () => {
		const wrong = parseWrongWordsTable(`| Typo | Suggestion | Description |\n| --- | --- | --- |\n| teh | the | Common typo |`);
		expect(wrong.success).toBe(true);
		if (wrong.success) expect(wrong.data.get('teh')?.suggestion).toBe('the');

		const synonyms = parseSynonymsTable(`| Synonym Group | Description |\n| --- | --- |\n| quick, fast | Speed |`);
		expect(synonyms.success).toBe(true);
		if (synonyms.success) expect(synonyms.data.get('quick')?.suggestions).toEqual(['fast']);

		const sensitive = parseSensitiveWordsTable(`| Term | Suggestions | Level | Exceptions | Description |\n| --- | --- | --- | --- | --- |\n| secret | private | Warning | public secret | Restricted |\n| note | | Info | | Advisory |`);
		expect(sensitive.success).toBe(true);
		if (sensitive.success) {
			expect(sensitive.data.get('secret')?.severity).toBe('warning');
			expect(sensitive.data.get('note')?.severity).toBe('info');
		}
	});

	it('updateTableInMarkdown should strictly validate input rows and escape special characters', () => {
		const original = `# 头部说明\n\n| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 常见错字 |\n\n底部说明`;

		// 1. 正常更新已有行
		const updateRes = updateTableInMarkdown(original, 'wrong', '报歉', ['报歉', '真诚抱歉', '修改说明']);
		expect(updateRes.success).toBe(true);
		expect(updateRes.newContent).toContain('| 报歉 | 真诚抱歉 | 修改说明 |');
		expect(updateRes.newContent).toContain('# 头部说明');
		expect(updateRes.newContent).toContain('底部说明');

		// 2. 插入新行（包含管道符转义和多行换行平整）
		const insertRes = updateTableInMarkdown(original, 'wrong', '按装', ['按装', '安装 | 装配', '换行\n说明']);
		expect(insertRes.success).toBe(true);
		expect(insertRes.newContent).toContain('| 按装 | 安装 \\| 装配 | 换行 说明 |');

		// 3. 列数不匹配时拒写
		const badColRes = updateTableInMarkdown(original, 'wrong', '按装', ['按装', '安装']);
		expect(badColRes.success).toBe(false);

		// 4. 空关键词拒写
		const emptyKeyRes = updateTableInMarkdown(original, 'wrong', '', ['', '安装', '说明']);
		expect(emptyKeyRes.success).toBe(false);

		// 5. 敏感词非法级别拒写
		const senTable = `| 词语 | 建议 | 级别 | 例外 | 说明 |\n| --- | --- | --- | --- | --- |\n| 词1 | 议1 | 警告 | 例1 | 释1 |`;
		const badSenLevel = updateTableInMarkdown(senTable, 'sensitive', '词2', ['词2', '议2', '未知级别', '例2', '释2']);
		expect(badSenLevel.success).toBe(false);

		// 6. 近义词跨组冲突拒写
		const synTable = `| 近义词组 | 说明 |\n| --- | --- |\n| 开心、快乐 | 喜悦组1 |`;
		const conflictSyn = updateTableInMarkdown(synTable, 'synonym', '高兴', ['高兴、开心', '新组']);
		expect(conflictSyn.success).toBe(false);
		expect(conflictSyn.reason).toContain('一词仅一组');
	});
});

describe('Markdown Exclusions', () => {
	it('should exclude frontmatter, code blocks, inline code, and embeds', () => {
		const text = `---
title: 迫不急待
---
正文中的迫不急待。
\`\`\`js
const x = "迫不急待";
\`\`\`
行内代码 \`迫不急待\` 结束。
![[embed.png]]
`;
		const exclusions = extractMarkdownExclusions(text);
		expect(exclusions.length).toBeGreaterThan(0);

		// Frontmatter 中的“迫不急待”应被排除
		const fmIdx = text.indexOf('title: 迫不急待') + 7;
		expect(isRangeExcluded(fmIdx, fmIdx + 4, exclusions)).toBe(true);

		// 正文中的“迫不急待”不应被排除
		const proseIdx = text.indexOf('正文中的迫不急待。') + 4;
		expect(isRangeExcluded(proseIdx, proseIdx + 4, exclusions)).toBe(false);

		// 代码块中的“迫不急待”应被排除
		const codeBlockIdx = text.indexOf('const x = "迫不急待";') + 11;
		expect(isRangeExcluded(codeBlockIdx, codeBlockIdx + 4, exclusions)).toBe(true);

		// 行内代码中的“迫不急待”应被排除
		const inlineIdx = text.indexOf('`迫不急待`') + 1;
		expect(isRangeExcluded(inlineIdx, inlineIdx + 4, exclusions)).toBe(true);
	});

	it('should exclude link destinations but inspect link visible text', () => {
		const text = `请点击 [可见错词](https://example.com/target) 以及 [[目标文件|别名错词]] 和 [[纯目标链接]]。`;
		const exclusions = extractMarkdownExclusions(text);

		// Markdown 链接 visible 文本 “可见错词” 不被排除
		const mdVisibleIdx = text.indexOf('可见错词');
		expect(isRangeExcluded(mdVisibleIdx, mdVisibleIdx + 4, exclusions)).toBe(false);

		// Markdown 链接 url 被排除
		const urlIdx = text.indexOf('https://example.com/target');
		expect(isRangeExcluded(urlIdx, urlIdx + 10, exclusions)).toBe(true);

		// Wikilink 别名 “别名错词” 不被排除
		const wikiAliasIdx = text.indexOf('别名错词');
		expect(isRangeExcluded(wikiAliasIdx, wikiAliasIdx + 4, exclusions)).toBe(false);

		// Wikilink 目标 “目标文件” 被排除
		const wikiTargetIdx = text.indexOf('目标文件');
		expect(isRangeExcluded(wikiTargetIdx, wikiTargetIdx + 4, exclusions)).toBe(true);

		// 无别名的 Wikilink 整体被排除
		const pureWikiIdx = text.indexOf('纯目标链接');
		expect(isRangeExcluded(pureWikiIdx, pureWikiIdx + 5, exclusions)).toBe(true);
	});
});

describe('Aho-Corasick & Overlap Resolution', () => {
	it('should support multi-outputs, fail suffix transitions, and multiple types on same literal', () => {
		const matcher = new ACMatcher();
		matcher.insert('词典', 'builtin', 'w1', { word: '词典', suggestion: '字典', description: '' });
		matcher.insert('校对词典', 'user_wrong', 'w2', { word: '校对词典', suggestion: '审核词典', description: '' });
		matcher.insert('词典', 'user_synonym', 's1', {
			group: { words: ['词典', '辞海'], description: '近义' },
			suggestions: ['辞海']
		});
		matcher.build();

		const text = '查阅校对词典工具';
		const matches = matcher.match(text, []);
		expect(matches.length).toBeGreaterThan(0);

		const words = matches.map(m => m.original);
		expect(words).toContain('校对词典');
		expect(words).toContain('词典');
	});

	it('should return multiple suggestions for sensitive words and exempt when inside exception phrase', () => {
		const matcher = new ACMatcher();
		matcher.insert('台独', 'user_sensitive', 'sen1', {
			word: '台独',
			suggestions: ['建议A', '建议B'],
			severity: 'warning',
			exceptions: ['看台独立', '舞台独立'],
			description: '敏感词'
		});
		matcher.build();

		const textExempt = '站在看台独立思考。';
		const matchesExempt = matcher.match(textExempt, []);
		expect(matchesExempt.length).toBe(0);

		const textHit = '宣传台独言论。';
		const matchesHit = matcher.match(textHit, []);
		expect(matchesHit.length).toBe(1);
		expect(matchesHit[0].original).toBe('台独');
		expect(matchesHit[0].suggestions).toEqual(['建议A', '建议B']);
	});

	it('should resolve exact same range by merging suggestions and messages', () => {
		const diags: ProofreadingDiagnostic[] = [
			{
				ruleId: 'syn1',
				type: 'synonym',
				from: 0,
				to: 2,
				original: '高兴',
				severity: 'info',
				confidence: 'high',
				message: '近义词推荐：快乐',
				suggestions: ['快乐'],
				source: 'user_synonym'
			},
			{
				ruleId: 'wrong1',
				type: 'wrong_word',
				from: 0,
				to: 2,
				original: '高兴',
				severity: 'warning',
				confidence: 'high',
				message: '错词提示：应为开心',
				suggestions: ['开心'],
				source: 'user_wrong'
			}
		];

		const resolved = resolveOverlaps(diags);
		expect(resolved.length).toBe(1);
		expect(resolved[0].type).toBe('wrong_word');
		expect(resolved[0].source).toBe('user_wrong');
		expect(resolved[0].suggestions).toEqual(['开心', '快乐']);
		expect(resolved[0].message).toContain('错词提示');
		expect(resolved[0].message).toContain('近义词推荐');
	});

	it('should resolve partial overlaps by preferring longest match and tie-breaking priority', () => {
		// 1. 较长匹配胜出
		const partials: ProofreadingDiagnostic[] = [
			{
				ruleId: 'short',
				type: 'wrong_word',
				from: 2,
				to: 4,
				original: '词典',
				severity: 'warning',
				confidence: 'high',
				message: '短词',
				suggestions: ['字典'],
				source: 'user_wrong'
			},
			{
				ruleId: 'long',
				type: 'wrong_word',
				from: 0,
				to: 4,
				original: '校对词典',
				severity: 'warning',
				confidence: 'high',
				message: '长词',
				suggestions: ['审核词典'],
				source: 'builtin'
			}
		];

		const resLongest = resolveOverlaps(partials);
		expect(resLongest.length).toBe(1);
		expect(resLongest[0].original).toBe('校对词典');

		// 2. 相同长度按优先级：user_wrong > user_sensitive > builtin > dedide > user_synonym
		const sameLen: ProofreadingDiagnostic[] = [
			{
				ruleId: 'syn_item',
				type: 'synonym',
				from: 1,
				to: 3,
				original: 'BC',
				severity: 'info',
				confidence: 'high',
				message: '近义词',
				suggestions: ['BX'],
				source: 'user_synonym'
			},
			{
				ruleId: 'wrong_item',
				type: 'wrong_word',
				from: 0,
				to: 2,
				original: 'AB',
				severity: 'warning',
				confidence: 'high',
				message: '用户错词',
				suggestions: ['AX'],
				source: 'user_wrong'
			}
		];

		const resTie = resolveOverlaps(sameLen);
		expect(resTie.length).toBe(1);
		expect(resTie[0].original).toBe('AB');
		expect(resTie[0].source).toBe('user_wrong');
	});
});

describe('Conservative DeDiDe Rules', () => {
	it('should detect 6-direction misuses with high confidence and keep ambiguous phrases silent', () => {
		const scanner = new DeDiDeScanner(TEST_DEDIDE_LEXICON);

		// 1. 的 → 地 (dedide_adv_de_verb)
		const d1 = scanner.scan('他飞快的跑。', []);
		expect(d1).toHaveLength(1);
		expect(d1[0].ruleId).toBe('dedide_adv_de_verb');
		expect(d1[0].original).toBe('飞快的跑');
		expect(d1[0].suggestions).toEqual(['飞快地跑']);

		// 2. 得 → 地 (dedide_adv_de2_verb)
		const d2 = scanner.scan('他飞快得跑。', []);
		expect(d2).toHaveLength(1);
		expect(d2[0].ruleId).toBe('dedide_adv_de2_verb');
		expect(d2[0].original).toBe('飞快得跑');
		expect(d2[0].suggestions).toEqual(['飞快地跑']);

		// 3. 的 → 得 (dedide_verb_de_phrase & dedide_adj_de_duo: only fixed phrases & comparatives)
		const d3_phrase = scanner.scan('他笑的不行。', []);
		expect(d3_phrase).toHaveLength(1);
		expect(d3_phrase[0].ruleId).toBe('dedide_verb_de_phrase');
		expect(d3_phrase[0].original).toBe('笑的不行');
		expect(d3_phrase[0].suggestions).toEqual(['笑得不行']);

		const d3_adj = scanner.scan('容易的多。', []);
		expect(d3_adj).toHaveLength(1);
		expect(d3_adj[0].ruleId).toBe('dedide_adj_de_duo');
		expect(d3_adj[0].original).toBe('容易的多');
		expect(d3_adj[0].suggestions).toEqual(['容易得多']);

		// “的+普通程度词/形容词”（如“他说的很好”、“做的大”）必须静默！
		expect(scanner.scan('他说的很好。', [])).toHaveLength(0);
		expect(scanner.scan('处理的很好。', [])).toHaveLength(0);
		expect(scanner.scan('准备的充分。', [])).toHaveLength(0);

		// 4. 地 → 得 (dedide_verb_di_comp & dedide_adj_di_duo: high confidence)
		const d4 = scanner.scan('他跑地很快，处理地很好。', []);
		expect(d4).toHaveLength(2);
		expect(d4[0].ruleId).toBe('dedide_verb_di_comp');
		expect(d4[0].original).toBe('跑地很快');
		expect(d4[0].suggestions).toEqual(['跑得很快']);
		expect(d4[1].ruleId).toBe('dedide_verb_di_comp');
		expect(d4[1].original).toBe('处理地很好');
		expect(d4[1].suggestions).toEqual(['处理得很好']);

		const d4_duo = scanner.scan('好地多。', []);
		expect(d4_duo).toHaveLength(1);
		expect(d4_duo[0].ruleId).toBe('dedide_adj_di_duo');
		expect(d4_duo[0].suggestions).toEqual(['好得多']);

		// 5. 地 → 的 (dedide_adj_di_noun)
		const d5 = scanner.scan('看见了美丽地姑娘。', []);
		expect(d5).toHaveLength(1);
		expect(d5[0].ruleId).toBe('dedide_adj_di_noun');
		expect(d5[0].original).toBe('美丽地姑娘');
		expect(d5[0].suggestions).toEqual(['美丽的姑娘']);

		// 6. 得 → 的 (dedide_adj_de2_noun)
		const d6 = scanner.scan('看见了美丽得姑娘。', []);
		expect(d6).toHaveLength(1);
		expect(d6[0].ruleId).toBe('dedide_adj_de2_noun');
		expect(d6[0].original).toBe('美丽得姑娘');
		expect(d6[0].suggestions).toEqual(['美丽的姑娘']);
	});

	it('should correctly localize all three DeDiDe message categories in both zh-CN and en', async () => {
		const scanner = new DeDiDeScanner(TEST_DEDIDE_LEXICON);

		// Category 1: suggest "地" (modifying action/verb)
		// Category 2: suggest "得" (degree complement)
		// Category 3: suggest "的" (modifying noun)
		const sampleText = '他飞快的跑，笑的不行，看见美丽地姑娘。';

		// 1. zh-CN (default)
		await setLocale('zh-CN');
		const diagsZh = scanner.scan(sampleText, []);
		expect(diagsZh).toHaveLength(3);
		expect(diagsZh[0].message).toBe('可能误用：“飞快的跑”中修饰动作，建议使用“地”');
		expect(diagsZh[1].message).toBe('可能误用：“笑的不行”后接程度补语，建议使用“得”');
		expect(diagsZh[2].message).toBe('可能误用：“美丽地姑娘”修饰名词，建议使用“的”');

		// Also check the reverse/other patterns in each category in zh-CN
		const extraZh = scanner.scan('他飞快得跑，跑地很快，看见美丽得姑娘。', []);
		expect(extraZh).toHaveLength(3);
		expect(extraZh[0].message).toBe('可能误用：“飞快得跑”中修饰动作，建议使用“地”');
		expect(extraZh[1].message).toBe('可能误用：“跑地很快”后接程度补语，建议使用“得”');
		expect(extraZh[2].message).toBe('可能误用：“美丽得姑娘”修饰名词，建议使用“的”');

		// 2. en
		await setLocale('en');
		try {
			const diagsEn = scanner.scan(sampleText, []);
			expect(diagsEn).toHaveLength(3);
			expect(diagsEn[0].message).toBe('Possible misuse: modifying an action in "飞快的跑", suggest using "地"');
			expect(diagsEn[1].message).toBe('Possible misuse: followed by a degree complement in "笑的不行", suggest using "得"');
			expect(diagsEn[2].message).toBe('Possible misuse: modifying a noun in "美丽地姑娘", suggest using "的"');

			const extraEn = scanner.scan('他飞快得跑，跑地很快，看见美丽得姑娘。', []);
			expect(extraEn).toHaveLength(3);
			expect(extraEn[0].message).toBe('Possible misuse: modifying an action in "飞快得跑", suggest using "地"');
			expect(extraEn[1].message).toBe('Possible misuse: followed by a degree complement in "跑地很快", suggest using "得"');
			expect(extraEn[2].message).toBe('Possible misuse: modifying a noun in "美丽得姑娘", suggest using "的"');
		} finally {
			await setLocale('zh-CN');
		}
	});

	it('should handle exact reproduction and fixed phrases correctly', () => {
		const scanner = new DeDiDeScanner(TEST_DEDIDE_LEXICON);
		const text = '好的多 多得是 委屈的哭泣 跑地很快';
		const diags = scanner.scan(text, []);

		expect(diags.length).toBe(3);

		// 1. 好的多 -> 好得多
		expect(diags[0].original).toBe('好的多');
		expect(diags[0].suggestions).toEqual(['好得多']);

		// 2. 委屈的哭泣 -> 委屈地哭泣
		expect(diags[1].original).toBe('委屈的哭泣');
		expect(diags[1].suggestions).toEqual(['委屈地哭泣']);

		// 3. 跑地很快 -> 跑得很快
		expect(diags[2].original).toBe('跑地很快');
		expect(diags[2].suggestions).toEqual(['跑得很快']);

		// 4. 多得是 绝对不能被误判
		const flaggedWords = diags.map(d => d.original);
		expect(flaggedWords).not.toContain('多得是');
	});

	it('should protect precision and avoid false positives on ambiguous constructions and correct usages', () => {
		const scanner = new DeDiDeScanner(TEST_DEDIDE_LEXICON);

		// 多得是（成语/惯用句式正确用法）
		expect(scanner.scan('钱多得是，这种事情多得是。', []).length).toBe(0);

		// 好的多...（定语修饰多功能、多数、多种等名词性短语）
		expect(scanner.scan('这是一台好的多功能电饭煲。', []).length).toBe(0);
		expect(scanner.scan('我们拥有好的多元文化环境。', []).length).toBe(0);
		expect(scanner.scan('在好的多数情况下都能运行。', []).length).toBe(0);
		expect(scanner.scan('提供了好的多种选择。', []).length).toBe(0);
		expect(scanner.scan('他们是相处很好的多年好友。', []).length).toBe(0);

		// 的字短语/主谓宾定语正确结构（歧义负例必须静默）
		expect(scanner.scan('受委屈的人总是让人心疼。', []).length).toBe(0);
		expect(scanner.scan('今天吃的是米饭，说的是真话。', []).length).toBe(0);
		expect(scanner.scan('他买的电脑很好用。', []).length).toBe(0);
		expect(scanner.scan('他说的很好。', []).length).toBe(0);
	});

	it('should respect Markdown exclusions when detecting DeDiDe grammar rules', () => {
		const text = `正文委屈的哭泣。
\`委屈的哭泣\`
\`\`\`
跑地很快
\`\`\`
[委屈的哭泣](https://example.com)
`;
		const exclusions = extractMarkdownExclusions(text);
		const diags = new DeDiDeScanner(TEST_DEDIDE_LEXICON).scan(text, exclusions);

		// 仅正文与 Markdown 链接可见文字中的误用被检测（共 2 处），行内代码与代码块被排除
		expect(diags.length).toBe(2);
		expect(diags[0].original).toBe('委屈的哭泣');
		expect(diags[0].suggestions).toEqual(['委屈地哭泣']);
		expect(diags[1].original).toBe('委屈的哭泣');
		expect(diags[1].suggestions).toEqual(['委屈地哭泣']);
	});

	it('should accurately handle single-character nouns, action nominal followers, and compound phrase exclusions', () => {
		const scanner = new DeDiDeScanner(TEST_DEDIDE_LEXICON);

		// Positive cases: must trigger diagnostics suggesting '的' or '地'
		// 1. 美丽地人 -> 美丽的人 (地 → 的)
		const pos1 = scanner.scan('美丽地人', []);
		expect(pos1).toHaveLength(1);
		expect(pos1[0].ruleId).toBe('dedide_adj_di_noun');
		expect(pos1[0].original).toBe('美丽地人');
		expect(pos1[0].suggestions).toEqual(['美丽的人']);

		// 2. 快乐的唱歌 -> 快乐地唱歌 (的 → 地)
		const pos2 = scanner.scan('快乐的唱歌', []);
		expect(pos2).toHaveLength(1);
		expect(pos2[0].ruleId).toBe('dedide_adv_de_verb');
		expect(pos2[0].original).toBe('快乐的唱歌');
		expect(pos2[0].suggestions).toEqual(['快乐地唱歌']);

		// 3. 沉默地人 -> 沉默的人 (地 → 的)
		const pos3 = scanner.scan('沉默地人', []);
		expect(pos3).toHaveLength(1);
		expect(pos3[0].ruleId).toBe('dedide_adj_di_noun');
		expect(pos3[0].original).toBe('沉默地人');
		expect(pos3[0].suggestions).toEqual(['沉默的人']);

		// 4. 沉默地女孩 -> 沉默的女孩 (地 → 的)
		const pos4 = scanner.scan('沉默地女孩', []);
		expect(pos4).toHaveLength(1);
		expect(pos4[0].ruleId).toBe('dedide_adj_di_noun');
		expect(pos4[0].original).toBe('沉默地女孩');
		expect(pos4[0].suggestions).toEqual(['沉默的女孩']);

		// 5. 美丽地男孩 -> 美丽的男孩 (地 → 的)
		const pos5 = scanner.scan('美丽地男孩', []);
		expect(pos5).toHaveLength(1);
		expect(pos5[0].ruleId).toBe('dedide_adj_di_noun');
		expect(pos5[0].original).toBe('美丽地男孩');
		expect(pos5[0].suggestions).toEqual(['美丽的男孩']);

		// 6. 丑陋得心 -> 丑陋的心 (得 → 的)
		const pos6 = scanner.scan('丑陋得心', []);
		expect(pos6).toHaveLength(1);
		expect(pos6[0].ruleId).toBe('dedide_adj_de2_noun');
		expect(pos6[0].original).toBe('丑陋得心');
		expect(pos6[0].suggestions).toEqual(['丑陋的心']);

		// Regression: action verbs with object/direction should still trigger diagnostics (not dropped by action boundary)
		const reg1 = scanner.scan('认真的打开门', []);
		expect(reg1).toHaveLength(1);
		expect(reg1[0].ruleId).toBe('dedide_adv_de_verb');
		expect(reg1[0].original).toBe('认真的打开');
		expect(reg1[0].suggestions).toEqual(['认真地打开']);

		const reg2 = scanner.scan('飞快的跑向前方', []);
		expect(reg2).toHaveLength(1);
		expect(reg2[0].ruleId).toBe('dedide_adv_de_verb');
		expect(reg2[0].original).toBe('飞快的跑');
		expect(reg2[0].suggestions).toEqual(['飞快地跑']);

		// Negative cases: must remain completely silent (0 diagnostics)
		// 1. 沉默地站着
		expect(scanner.scan('沉默地站着', [])).toHaveLength(0);
		// 2. 美丽得令人窒息
		expect(scanner.scan('美丽得令人窒息', [])).toHaveLength(0);
		// 3. 丑陋得心生厌恶
		expect(scanner.scan('丑陋得心生厌恶', [])).toHaveLength(0);
		// 4. 意外地心想起来
		expect(scanner.scan('意外地心想起来', [])).toHaveLength(0);
		// 5. 快乐的唱歌方式
		expect(scanner.scan('快乐的唱歌方式', [])).toHaveLength(0);
		// 6. 委屈的哭泣声
		expect(scanner.scan('委屈的哭泣声', [])).toHaveLength(0);
		// 7. 受委屈的人
		expect(scanner.scan('受委屈的人', [])).toHaveLength(0);
	});
});

describe('ProofreadingManager Lifecycle & Vault Operations', () => {
	let app: App;
	let plugin: WebNovelAssistantPlugin;
	let manager: ProofreadingManager;
	let vaultMock: {
		adapter: Record<string, ReturnType<typeof vi.fn>>;
		on: ReturnType<typeof vi.fn>;
		offref: ReturnType<typeof vi.fn>;
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
		process: ReturnType<typeof vi.fn>;
	};
	let fileManagerMock: Record<string, ReturnType<typeof vi.fn>>;
	let virtualFiles: Map<string, string>;
	let virtualFolders: Set<string>;

	beforeEach(() => {
		virtualFiles = new Map();
		virtualFolders = new Set(['NovelBook']);

		const adapterMock = {
			exists: vi.fn().mockImplementation((p: string) => Promise.resolve(virtualFiles.has(p))),
			read: vi.fn().mockImplementation((p: string) => {
				if (!virtualFiles.has(p)) return Promise.reject(new Error('File not found in storage'));
				return Promise.resolve(virtualFiles.get(p) || '');
			}),
			write: vi.fn().mockImplementation((p: string, content: string) => {
				virtualFiles.set(p, content);
				return Promise.resolve();
			}),
			remove: vi.fn().mockImplementation((p: string) => {
				virtualFiles.delete(p);
				return Promise.resolve();
			}),
			mkdir: vi.fn().mockImplementation((p: string) => {
				virtualFolders.add(p);
				return Promise.resolve();
			})
		};

		vaultMock = {
			adapter: adapterMock,
			on: vi.fn().mockImplementation(() => ({})),
			offref: vi.fn(),
			getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
				if (virtualFiles.has(path)) {
					return createMockTFile(path);
				}
				if (virtualFolders.has(path)) {
					return createMockTFolder(path);
				}
				return null;
			}),
			create: vi.fn().mockImplementation((path: string, content: string) => {
				virtualFiles.set(path, content);
				return Promise.resolve(createMockTFile(path));
			}),
			createFolder: vi.fn().mockImplementation((path: string) => {
				virtualFolders.add(path);
				return Promise.resolve(createMockTFolder(path));
			}),
			read: vi.fn().mockImplementation((file: TFile) => {
				if (!virtualFiles.has(file.path)) {
					return Promise.reject(new Error('File not found in storage'));
				}
				return Promise.resolve(virtualFiles.get(file.path) || '');
			}),
			process: vi.fn().mockImplementation(async (file: TFile, fn: (data: string) => string) => {
				const current = virtualFiles.get(file.path) || '';
				const updated = fn(current);
				virtualFiles.set(file.path, updated);
				return Promise.resolve(updated);
			})
		};

		fileManagerMock = {
			renameFile: vi.fn().mockImplementation((file: TFile | TFolder, newPath: string) => {
				return Promise.resolve();
			})
		};

		app = {
			vault: vaultMock as unknown as Vault,
			fileManager: fileManagerMock as unknown as FileManager,
			workspace: {
				trigger: vi.fn()
			}
		} as unknown as App;

		plugin = {
			manifest: {
				id: 'obsidian-webnovel-assistant',
				dir: '.obsidian/plugins/WebNovel Assistant'
			},
			settings: {
				proofreading: {
					enabled: false,
					dictionaryPath: '',
					enableBuiltin: true,
					enableUserDict: true,
					enableSensitive: true,
					enableSynonyms: true,
					enableDeDiDe: false
				},
				workspaceFolders: ['NovelBook']
			} as AccurateCountSettings,
			saveSettings: vi.fn().mockResolvedValue(undefined),
			isFileInWorkspace: vi.fn((file: TFile) => file.path.startsWith('NovelBook/'))
		} as unknown as WebNovelAssistantPlugin;

		manager = new ProofreadingManager(app, plugin);
	});

	afterEach(async () => {
		vi.useRealTimers();
		await manager.destroy();
		await setLocale('zh-CN');
	});

	it('initialize should be read-only and NEVER create files or folders on startup', async () => {
		await manager.initialize();
		expect(vaultMock.createFolder).not.toHaveBeenCalled();
		expect(vaultMock.create).not.toHaveBeenCalled();
		expect(plugin.settings.proofreading.enabled).toBe(false);
	});

	it('enable API should really create folder and create the three templates when directory is missing', async () => {
		expect(virtualFolders.has('NovelBook/校对词典')).toBe(false);
		const success = await manager.enable();
		expect(success).toBe(true);
		expect(vaultMock.createFolder).toHaveBeenCalledWith('NovelBook/校对词典');
		expect(virtualFolders.has('NovelBook/校对词典')).toBe(true);

		expect(vaultMock.create).toHaveBeenCalledWith(
			'NovelBook/校对词典/错词.md',
			expect.stringContaining('| 错词 | 建议 | 说明 |')
		);
		expect(virtualFiles.get('NovelBook/校对词典/错词.md')).not.toContain('# 错词词典');
		expect(vaultMock.create).toHaveBeenCalledWith(
			'NovelBook/校对词典/近义词.md',
			expect.stringContaining('| 近义词组 | 说明 |')
		);
		expect(virtualFiles.get('NovelBook/校对词典/近义词.md')).not.toContain('# 近义词词典');
		expect(vaultMock.create).toHaveBeenCalledWith(
			'NovelBook/校对词典/敏感词.md',
			expect.stringContaining('| 词语 | 建议 | 级别 | 例外 | 说明 |')
		);
		expect(virtualFiles.get('NovelBook/校对词典/敏感词.md')).not.toContain('# 敏感词词典');

		expect(plugin.settings.proofreading.dictionaryPath).toBe('NovelBook/校对词典');
		expect(plugin.settings.proofreading.enabled).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it('enable failure should not enable and should not delete already created files', async () => {
		vaultMock.createFolder.mockRejectedValueOnce(new Error('Permission denied'));
		const success = await manager.enable();
		expect(success).toBe(false);
		expect(plugin.settings.proofreading.enabled).toBe(false);
	});

	it('enable when directory pre-exists should not call createFolder but regenerate missing template files', async () => {
		// 预先存在目录和一个已有文件
		virtualFolders.add('NovelBook/校对词典');
		virtualFiles.set(
			'NovelBook/校对词典/错词.md',
			'# 错词词典\n\n| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 已有条目 |'
		);

		const success = await manager.enable();
		expect(success).toBe(true);
		// 目录已存在，不应重复调用 createFolder
		expect(vaultMock.createFolder).not.toHaveBeenCalled();

		// 错词.md 已存在，不应覆盖创建
		expect(vaultMock.create).not.toHaveBeenCalledWith('NovelBook/校对词典/错词.md', expect.anything());

		// 近义词.md 和 敏感词.md 缺失，应补齐创建
		expect(vaultMock.create).toHaveBeenCalledWith(
			'NovelBook/校对词典/近义词.md',
			expect.stringContaining('| 近义词组 | 说明 |')
		);
		expect(vaultMock.create).toHaveBeenCalledWith(
			'NovelBook/校对词典/敏感词.md',
			expect.stringContaining('| 词语 | 建议 | 级别 | 例外 | 说明 |')
		);

		// 已有错词数据正常加载
		const snapshot = manager.getDictSnapshot();
		expect(snapshot.userWrongWords.get('报歉')?.suggestion).toBe('抱歉');
	});

	it('should properly load user wrong words and retain Last-Known-Good cache on file corruption or read error', async () => {
		plugin.settings.proofreading.enabled = true;
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';
		virtualFolders.add('NovelBook/校对词典');

		// 1. 首次加载有效错词
		const validWrongMd = `| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 错别字 |`;
		virtualFiles.set('NovelBook/校对词典/错词.md', validWrongMd);
		await manager.loadDictionaries();

		const initialSnapshot = manager.getDictSnapshot();
		expect(initialSnapshot.wrongWords.get('报歉')?.suggestion).toBe('抱歉');
		expect(initialSnapshot.userWrongWords.get('报歉')?.suggestion).toBe('抱歉');

		// 2. 模拟用户编辑错误，损坏表格格式
		virtualFiles.set('NovelBook/校对词典/错词.md', '这里表格被破坏了');
		await manager.loadDictionaries();

		// 3. 应沿用 LKG 缓存，不丢失“报歉”词条
		const lkgSnapshot = manager.getDictSnapshot();
		expect(lkgSnapshot.wrongWords.get('报歉')?.suggestion).toBe('抱歉');
		expect(lkgSnapshot.userWrongWords.get('报歉')?.suggestion).toBe('抱歉');

		// 4. 模拟 read 抛出 I/O 异常，也应沿用 LKG
		vaultMock.read.mockRejectedValueOnce(new Error('I/O error'));
		await manager.loadDictionaries();
		const lkgAfterError = manager.getDictSnapshot();
		expect(lkgAfterError.userWrongWords.get('报歉')?.suggestion).toBe('抱歉');

		// 5. 模拟文件确实被删除（不存在），应视为空
		virtualFiles.delete('NovelBook/校对词典/错词.md');
		await manager.loadDictionaries();
		const emptySnapshot = manager.getDictSnapshot();
		expect(emptySnapshot.userWrongWords.size).toBe(0);
	});

	it('user wrong word overriding builtin word should reliably attribute source as user_wrong', async () => {
		plugin.settings.proofreading.enabled = true;
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';
		virtualFolders.add('NovelBook/校对词典');

		// 内置词库已有“按装 -> 安装”
		// 用户自定义错词将“按装 -> 自定义安装建议”
		const customWrongMd = `| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 按装 | 自定义安装建议 | 用户说明 |`;
		virtualFiles.set('NovelBook/校对词典/错词.md', customWrongMd);
		await manager.loadDictionaries();

		const diags = manager.scan('测试按装设备');
		expect(diags.length).toBe(1);
		expect(diags[0].original).toBe('按装');
		expect(diags[0].source).toBe('user_wrong');
		expect(diags[0].suggestions).toEqual(['自定义安装建议']);
	});

	it('should support subscribe / onRefresh notification on dictionary refresh and disable', async () => {
		const listener = vi.fn();
		const unsubscribe = manager.onRefresh(listener);

		plugin.settings.proofreading.enabled = true;
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';
		virtualFolders.add('NovelBook/校对词典');
		await manager.loadDictionaries();

		expect(listener).toHaveBeenCalled();
		const lastVersion = manager.getCacheVersion();
		expect(lastVersion).toBeGreaterThan(0);

		await manager.disable();
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
		await manager.loadDictionaries();
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('scan should filter ineligible files and files inside dictionary directory', async () => {
		plugin.settings.proofreading.enabled = true;
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';
		virtualFolders.add('NovelBook/校对词典');
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const validData = {
			schemaVersion: 1,
			dictionaryVersion: '1.0.0',
			updatedAt: '2026-08-21T00:00:00Z',
			entries: [
				{ word: '迫不急待', suggestion: '迫不及待', description: '成语误用' }
			]
		};
		virtualFiles.set(cachePath, JSON.stringify(validData));
		await manager.loadDictionaries();

		const dictFile = createMockTFile('NovelBook/校对词典/错词.md');
		const diagsInDict = manager.scan('这是包含迫不急待的正文', dictFile);
		expect(diagsInDict.length).toBe(0);

		const ordinaryWorkspaceFile = createMockTFile('NovelBook/Other.md');
		const diagsInOrdinaryFile = manager.scan('这是包含迫不急待的正文', ordinaryWorkspaceFile);
		expect(diagsInOrdinaryFile.length).toBe(1);

		const outsideWorkspaceFile = createMockTFile('Personal/Other.md');
		const diagsOutsideWorkspace = manager.scan('这是包含迫不急待的正文', outsideWorkspaceFile);
		expect(diagsOutsideWorkspace.length).toBe(0);

		const validChapterFile = createMockTFile('NovelBook/Chapter1.md');
		const diagsValid = manager.scan('这是包含迫不急待的正文', validChapterFile);
		expect(diagsValid.length).toBe(1);
		expect(diagsValid[0].original).toBe('迫不急待');
		expect(diagsValid[0].suggestions).toEqual(['迫不及待']);
	});

	it('destroy should unregister all events and clear memory structures', async () => {
		await manager.initialize();
		await manager.destroy();
		expect(vaultMock.offref).toHaveBeenCalled();
		expect(manager.getDictSnapshot().userWrongWords.size).toBe(0);
	});

	it('vault create event on dictionary file should trigger reload', async () => {
		vi.useFakeTimers();
		let createHandler: ((file: TFile) => void) | undefined;
		vaultMock.on.mockImplementation((event: string, handler: (file: TFile) => void) => {
			if (event === 'create') createHandler = handler;
			return {} as any;
		});

		await manager.initialize();
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';

		const loadSpy = vi.spyOn(manager, 'loadDictionaries');
		const newDictFile = createMockTFile('NovelBook/校对词典/错词.md');

		if (createHandler) {
			createHandler(newDictFile);
			vi.advanceTimersByTime(250);
			expect(loadSpy).toHaveBeenCalled();
		}
	});

	it('vault rename event moving file out of or into dictionary folder should trigger reload', async () => {
		vi.useFakeTimers();
		let renameHandler: ((file: TFile, oldPath: string) => void) | undefined;
		vaultMock.on.mockImplementation((event: string, handler: (file: TFile, oldPath: string) => void) => {
			if (event === 'rename') renameHandler = handler;
			return {} as any;
		});

		await manager.initialize();
		plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';

		const loadSpy = vi.spyOn(manager, 'loadDictionaries');

		// 1. Move file out of dictionary directory
		const movedOutFile = createMockTFile('NovelBook/Other/错词.md');
		if (renameHandler) {
			renameHandler(movedOutFile, 'NovelBook/校对词典/错词.md');
			vi.advanceTimersByTime(250);
			expect(loadSpy).toHaveBeenCalledTimes(1);
		}

		// 2. Move file into dictionary directory
		const movedInFile = createMockTFile('NovelBook/校对词典/错词.md');
		if (renameHandler) {
			renameHandler(movedInFile, 'NovelBook/Other/错词.md');
			vi.advanceTimersByTime(250);
			expect(loadSpy).toHaveBeenCalledTimes(2);
		}
	});

	it('prepareDictionaryForEditing should load dictionary snapshot when proofreading is disabled', async () => {
		plugin.settings.proofreading.enabled = false;
		plugin.settings.proofreading.dictionaryPath = '';

		// 预设近义词文件内容
		virtualFiles.set(
			'NovelBook/校对词典/近义词.md',
			`| 近义词组 | 说明 |\n| --- | --- |\n| 高兴、快乐、愉悦 | 喜悦组 |`
		);

		await manager.prepareDictionaryForEditing();

		// 验证 enabled 保持 false
		expect(plugin.settings.proofreading.enabled).toBe(false);
		// 验证 path 已持久化
		expect(plugin.settings.proofreading.dictionaryPath).toBe('NovelBook/校对词典');
		// 验证内存快照已加载近义词
		const snapshot = manager.getDictSnapshot();
		expect(snapshot.synonyms.get('高兴')?.group.words).toEqual(['高兴', '快乐', '愉悦']);
	});

	it('creates English dictionary folder, templates, and writable tables on first use in English', async () => {
		await setLocale('en');

		const success = await manager.enable();
		expect(success).toBe(true);
		expect(virtualFolders.has('NovelBook/Proofreading Dictionaries')).toBe(true);
		expect(virtualFiles.get('NovelBook/Proofreading Dictionaries/Typos.md')).toContain('| Typo | Suggestion | Description |');
		expect(virtualFiles.get('NovelBook/Proofreading Dictionaries/Synonyms.md')).toContain('| Synonym Group | Description |');
		expect(virtualFiles.get('NovelBook/Proofreading Dictionaries/Sensitive Words.md')).toContain('| Term | Suggestions | Level | Exceptions | Description |');

		const writeSuccess = await manager.updateTableEntry('sensitive', 'SecretTerm', [
			'SecretTerm',
			'PublicTerm',
			'Warning',
			'ExceptOne',
			'Top Secret'
		]);
		expect(writeSuccess).toBe(true);
		expect(manager.getDictSnapshot().sensitiveWords.get('SecretTerm')?.severity).toBe('warning');
	});

	it('uses the existing default folder name to choose templates even when the UI locale differs', async () => {
		virtualFolders.add('NovelBook/校对词典');
		await setLocale('en');
		await manager.enable();

		expect(plugin.settings.proofreading.dictionaryPath).toBe('NovelBook/校对词典');
		expect(virtualFiles.has('NovelBook/校对词典/错词.md')).toBe(true);
		expect(virtualFiles.has('NovelBook/校对词典/Typos.md')).toBe(false);

		await manager.destroy();
		plugin.settings.proofreading.dictionaryPath = '';
		virtualFolders.delete('NovelBook/校对词典');
		virtualFiles.clear();
		manager = new ProofreadingManager(app, plugin);
		virtualFolders.add('NovelBook/Proofreading Dictionaries');
		await setLocale('zh-CN');
		await manager.enable();

		expect(plugin.settings.proofreading.dictionaryPath).toBe('NovelBook/Proofreading Dictionaries');
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/Typos.md')).toBe(true);
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/错词.md')).toBe(false);
	});

	it('reuses existing Chinese files in English without creating English duplicates', async () => {
		virtualFolders.add('NovelBook/校对词典');
		virtualFiles.set('NovelBook/校对词典/错词.md', '| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| 报歉 | 抱歉 | 错字 |');
		await setLocale('en');
		await manager.enable();

		expect(manager.getDictSnapshot().userWrongWords.get('报歉')?.suggestion).toBe('抱歉');
		expect(virtualFiles.has('NovelBook/校对词典/Typos.md')).toBe(false);
		expect(virtualFiles.has('NovelBook/校对词典/Synonyms.md')).toBe(false);
		expect(virtualFiles.has('NovelBook/校对词典/Sensitive Words.md')).toBe(false);
	});

	it('reuses existing English files in Chinese without creating Chinese duplicates', async () => {
		virtualFolders.add('NovelBook/Proofreading Dictionaries');
		virtualFiles.set('NovelBook/Proofreading Dictionaries/Typos.md', '| Typo | Suggestion | Description |\n| --- | --- | --- |\n| teh | the | Common typo |');
		await setLocale('zh-CN');
		await manager.enable();

		expect(manager.getDictSnapshot().userWrongWords.get('teh')?.suggestion).toBe('the');
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/错词.md')).toBe(false);
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/近义词.md')).toBe(false);
		expect(virtualFiles.has('NovelBook/Proofreading Dictionaries/敏感词.md')).toBe(false);
	});

	it('preserves a custom dictionary path and follows its established file scheme', async () => {
		plugin.settings.proofreading.dictionaryPath = 'CustomPath/MyDicts';
		virtualFolders.add('CustomPath/MyDicts');
		virtualFiles.set('CustomPath/MyDicts/Typos.md', '| Typo | Suggestion | Description |\n| --- | --- | --- |');
		await setLocale('zh-CN');
		await manager.regenerateMissingTemplates();

		expect(plugin.settings.proofreading.dictionaryPath).toBe('CustomPath/MyDicts');
		expect(virtualFiles.has('CustomPath/MyDicts/Synonyms.md')).toBe(true);
		expect(virtualFiles.has('CustomPath/MyDicts/Sensitive Words.md')).toBe(true);
		expect(virtualFiles.has('CustomPath/MyDicts/近义词.md')).toBe(false);
	});
});

describe('Basic Typo Dictionary Validation & Advisory Threshold Rules', () => {
	it('should validate valid dictionary payload without large advisory flag for normal sizes', () => {
		const payload = {
			schemaVersion: 1,
			dictionaryVersion: '1.0.0',
			updatedAt: '2026-08-21T00:00:00Z',
			license: 'MIT',
			source: 'WebNovel Assistant Project',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '字形错误' },
				{ word: '迫不急待', suggestion: '迫不及待', description: '常用成语' }
			]
		};

		const res = validateBasicWrongWordsJson(payload);
		expect(res.valid).toBe(true);
		expect(res.isLarge).toBe(false);
		expect(res.data?.entries.length).toBe(2);
		expect(res.data?.dictionaryVersion).toBe('1.0.0');
	});

	it('should reject invalid schemaVersion, non-string metadata, or non-object payloads', () => {
		expect(validateBasicWrongWordsJson(null).valid).toBe(false);
		expect(validateBasicWrongWordsJson('string').valid).toBe(false);
		expect(validateBasicWrongWordsJson([]).valid).toBe(false);

		expect(validateBasicWrongWordsJson({ schemaVersion: 2, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21', entries: [{ word: 'a', suggestion: 'b', description: 'c' }] }).valid).toBe(false);
		expect(validateBasicWrongWordsJson({ schemaVersion: '1', dictionaryVersion: '1.0.0', updatedAt: '2026-08-21', entries: [{ word: 'a', suggestion: 'b', description: 'c' }] }).valid).toBe(false);

		expect(validateBasicWrongWordsJson({ schemaVersion: 1, dictionaryVersion: 123, updatedAt: '2026-08-21', entries: [{ word: 'a', suggestion: 'b', description: 'c' }] }).valid).toBe(false);
		expect(validateBasicWrongWordsJson({ schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: 456, entries: [{ word: 'a', suggestion: 'b', description: 'c' }] }).valid).toBe(false);
		expect(validateBasicWrongWordsJson({ schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21', entries: [] }).valid).toBe(false);
		expect(validateBasicWrongWordsJson({ schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21', entries: 'not-array' }).valid).toBe(false);
	});

	it('should reject malformed entry items (empty word, empty suggestion, self-mapping, duplicates, excessive length)', () => {
		// 缺少 word 或 suggestion
		expect(validateBasicWrongWordsJson({
			schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21',
			entries: [{ word: '', suggestion: '有效', description: '说明' }]
		}).valid).toBe(false);

		expect(validateBasicWrongWordsJson({
			schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21',
			entries: [{ word: '有效', suggestion: '   ', description: '说明' }]
		}).valid).toBe(false);

		// 自映射 word === suggestion
		const selfMapRes = validateBasicWrongWordsJson({
			schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21',
			entries: [{ word: '一样', suggestion: '一样', description: '说明' }]
		});
		expect(selfMapRes.valid).toBe(false);
		expect(selfMapRes.error).toContain('Self-mapping');

		// 重复词条
		const dupRes = validateBasicWrongWordsJson({
			schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '1' },
				{ word: '按步就班', suggestion: '按部就班', description: '2' }
			]
		});
		expect(dupRes.valid).toBe(false);
		expect(dupRes.error).toContain('Duplicate word');

		// 词长超限 (>32)
		const longWordRes = validateBasicWrongWordsJson({
			schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21',
			entries: [{ word: 'a'.repeat(33), suggestion: 'b', description: 'c' }]
		});
		expect(longWordRes.valid).toBe(false);
		expect(longWordRes.error).toContain('exceeds max word length');

		// 说明超限 (>200)
		const longDescRes = validateBasicWrongWordsJson({
			schemaVersion: 1, dictionaryVersion: '1.0.0', updatedAt: '2026-08-21',
			entries: [{ word: 'a', suggestion: 'b', description: 'x'.repeat(201) }]
		});
		expect(longDescRes.valid).toBe(false);
		expect(longDescRes.error).toContain('exceeds max length');
	});

	it('should accept large dictionaries (>5,000 entries or >1MB) with advisory isLarge: true without rejecting', () => {
		const entries = [];
		for (let i = 0; i < 5001; i++) {
			entries.push({
				word: `错词${i}`,
				suggestion: `正词${i}`,
				description: '测试说明'
			});
		}

		const largeCountPayload = {
			schemaVersion: 1,
			dictionaryVersion: '2.0.0',
			updatedAt: '2026-08-21T00:00:00Z',
			entries
		};

		const res = validateBasicWrongWordsJson(largeCountPayload);
		expect(res.valid).toBe(true);
		expect(res.isLarge).toBe(true);
		expect(res.data?.entries.length).toBe(5001);
	});
});

describe('Basic Typo Dictionary Lifecycle, Cache, Recovery & Dynamic Update', () => {
	let app: App;
	let plugin: WebNovelAssistantPlugin;
	let manager: ProofreadingManager;
	let virtualFiles: Map<string, string>;
	let adapterMock: { exists: Mock; read: Mock; write: Mock; remove: Mock; mkdir: Mock };

	beforeEach(() => {
		virtualFiles = new Map();

		adapterMock = {
			exists: vi.fn().mockImplementation((p: string) => Promise.resolve(virtualFiles.has(p))),
			read: vi.fn().mockImplementation((p: string) => {
				if (!virtualFiles.has(p)) return Promise.reject(new Error('File not found in storage'));
				return Promise.resolve(virtualFiles.get(p) || '');
			}),
			write: vi.fn().mockImplementation((p: string, content: string) => {
				virtualFiles.set(p, content);
				return Promise.resolve();
			}),
			remove: vi.fn().mockImplementation((p: string) => {
				virtualFiles.delete(p);
				return Promise.resolve();
			}),
			mkdir: vi.fn().mockImplementation((_p: string) => Promise.resolve())
		};

		app = {
			vault: {
				adapter: adapterMock,
				on: vi.fn().mockImplementation(() => ({})),
				offref: vi.fn(),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				create: vi.fn(),
				createFolder: vi.fn(),
				read: vi.fn(),
				process: vi.fn()
			} as unknown as Vault,
			fileManager: {
				renameFile: vi.fn().mockResolvedValue(undefined)
			} as unknown as FileManager,
			workspace: {
				trigger: vi.fn()
			}
		} as unknown as App;

		plugin = {
			manifest: {
				id: 'obsidian-webnovel-assistant',
				dir: '.obsidian/plugins/WebNovel Assistant'
			},
			settings: {
				proofreading: {
					enabled: true,
					dictionaryPath: 'NovelBook/校对词典',
					enableBuiltin: true,
					enableUserDict: true,
					enableSensitive: true,
					enableSynonyms: true,
					enableDeDiDe: false
				},
				workspaceFolders: ['NovelBook']
			} as AccurateCountSettings,
			saveSettings: vi.fn().mockResolvedValue(undefined),
			isFileInWorkspace: vi.fn().mockReturnValue(true)
		} as unknown as WebNovelAssistantPlugin;

		manager = new ProofreadingManager(app, plugin);
	});

	afterEach(async () => {
		await manager.destroy();
	});

	it('should set status to not_downloaded (0 count) when neither cache nor backup exists', async () => {
		await manager.loadDictionaries();
		const info = manager.getBasicDictInfo();
		expect(info.source).toBe('not_downloaded');
		expect(info.version).toBe('');
		expect(info.count).toBe(0);
	});

	it('should load local cache file when dict/basic-wrong-words.json is present and valid', async () => {
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const validData = {
			schemaVersion: 1,
			dictionaryVersion: '1.2.0',
			updatedAt: '2026-08-21T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '字形错误' },
				{ word: '迫不急待', suggestion: '迫不及待', description: '常用成语' },
				{ word: '幅射', suggestion: '辐射', description: '错字' }
			]
		};
		virtualFiles.set(cachePath, JSON.stringify(validData));

		await manager.loadDictionaries();
		const info = manager.getBasicDictInfo();
		expect(info.source).toBe('online_cache');
		expect(info.version).toBe('1.2.0');
		expect(info.count).toBe(3);
	});

	it('should recover from dict/ .bak backup when primary cache is corrupted or malformed', async () => {
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const bakPath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json.bak';

		// 主缓存损坏
		virtualFiles.set(cachePath, '{ corrupt json invalid content ...');

		// 备份缓存有效
		const bakData = {
			schemaVersion: 1,
			dictionaryVersion: '1.1.0',
			updatedAt: '2026-08-20T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '备份中的数据' }
			]
		};
		virtualFiles.set(bakPath, JSON.stringify(bakData));

		await manager.loadDictionaries();
		const info = manager.getBasicDictInfo();
		expect(info.source).toBe('online_cache');
		expect(info.version).toBe('1.1.0');
		expect(info.count).toBe(1);
	});

	it('should set status to not_downloaded when both main cache and backup cache are corrupted', async () => {
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const bakPath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json.bak';

		virtualFiles.set(cachePath, '{ corrupt json ...');
		virtualFiles.set(bakPath, '{ also corrupt ...');

		await manager.loadDictionaries();
		const info = manager.getBasicDictInfo();
		expect(info.source).toBe('not_downloaded');
		expect(info.version).toBe('');
		expect(info.count).toBe(0);
	});

	it('updateBasicDictionary should successfully download, validate, persist and hot-swap matcher', async () => {
		await manager.loadDictionaries();
		expect(manager.getBasicDictInfo().source).toBe('not_downloaded');
		expect(manager.getBasicDictInfo().version).toBe('');
		expect(manager.getBasicDictInfo().count).toBe(0);

		// 初始状态下扫描新词条不会匹配
		const chapterFile = createMockTFile('NovelBook/第1章.md');
		const initialMatches = manager.scan('这是一个鬼计。', chapterFile);
		expect(initialMatches.find(m => m.original === '鬼计')).toBeUndefined();

		const remotePayload = {
			schemaVersion: 1,
			dictionaryVersion: '2.0.0',
			updatedAt: '2026-08-21T12:00:00Z',
			license: 'MIT',
			source: 'WebNovel Assistant Project',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '更新后的成语' },
				{ word: '迫不急待', suggestion: '迫不及待', description: '更新后的成语' },
				{ word: '幅射', suggestion: '辐射', description: '更新后的错字' },
				{ word: '鬼计', suggestion: '诡计', description: '新词条' }
			]
		};

		vi.spyOn(obsidian, 'requestUrl').mockResolvedValue(createRequestUrlResponse(remotePayload));

		const result = await manager.updateBasicDictionary();
		expect(result.status).toBe('updated');
		if (result.status === 'updated') {
			expect(result.version).toBe('2.0.0');
			expect(result.count).toBe(4);
		}

		// 检查状态更新与快照
		const info = manager.getBasicDictInfo();
		expect(info.source).toBe('online_cache');
		expect(info.version).toBe('2.0.0');
		expect(info.count).toBe(4);

		// 检查热切换后立即能检测到新下载的词条
		const hotSwappedMatches = manager.scan('这是一个鬼计。', chapterFile);
		expect(hotSwappedMatches.length).toBe(1);
		expect(hotSwappedMatches[0].original).toBe('鬼计');
		expect(hotSwappedMatches[0].suggestions).toEqual(['诡计']);
		expect(hotSwappedMatches[0].source).toBe('builtin');

		// 检查主缓存已被持久化；初次安装时无历史缓存，因此不产生 .bak
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const bakPath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json.bak';
		expect(virtualFiles.has(cachePath)).toBe(true);
		expect(virtualFiles.has(bakPath)).toBe(false);

		// 检查通知事件被触发
		expect(app.workspace.trigger).toHaveBeenCalledWith('webnovel:proofreading-refreshed', expect.any(Number));
	});

	it('updateBasicDictionary should back up existing cache to .bak when replacing an existing valid cache', async () => {
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const bakPath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json.bak';

		const oldData = {
			schemaVersion: 1,
			dictionaryVersion: '1.5.0',
			updatedAt: '2026-08-20T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '旧版本' }
			]
		};
		virtualFiles.set(cachePath, JSON.stringify(oldData));
		await manager.loadDictionaries();
		expect(manager.getBasicDictInfo().version).toBe('1.5.0');

		const newData = {
			schemaVersion: 1,
			dictionaryVersion: '1.6.0',
			updatedAt: '2026-08-21T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '新版本' },
				{ word: '迫不急待', suggestion: '迫不及待', description: '新条目' }
			]
		};

		vi.spyOn(obsidian, 'requestUrl').mockResolvedValue(createRequestUrlResponse(newData));

		const result = await manager.updateBasicDictionary();
		expect(result.status).toBe('updated');
		expect(virtualFiles.has(cachePath)).toBe(true);
		expect(virtualFiles.has(bakPath)).toBe(true);
		expect(JSON.parse(virtualFiles.get(bakPath)!)).toEqual(oldData);
		expect(manager.getBasicDictInfo().version).toBe('1.6.0');
	});

	it('updateBasicDictionary should recover existing cache and runtime when disk write fails during replacement', async () => {
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';

		const oldData = {
			schemaVersion: 1,
			dictionaryVersion: '1.5.0',
			updatedAt: '2026-08-20T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '原缓存' }
			]
		};
		const oldContent = JSON.stringify(oldData);
		virtualFiles.set(cachePath, oldContent);
		await manager.loadDictionaries();

		const newData = {
			schemaVersion: 1,
			dictionaryVersion: '2.0.0',
			updatedAt: '2026-08-21T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '新数据' }
			]
		};

		vi.spyOn(obsidian, 'requestUrl').mockResolvedValue(createRequestUrlResponse(newData));

		// 模拟写入 tempPath 成功后，写入主 cachePath 失败
		const originalWrite = adapterMock.write;
		adapterMock.write = vi.fn().mockImplementation((p: string, c: string) => {
			if (p === cachePath && c !== oldContent) {
				return Promise.reject(new Error('Disk write I/O error'));
			}
			return originalWrite(p, c);
		});

		const result = await manager.updateBasicDictionary();
		expect(result.status).toBe('failed');
		expect(result.failureReason).toBe('disk_error');

		// 验证恢复了原缓存内容并且运行时保留旧版本
		expect(virtualFiles.get(cachePath)).toBe(oldContent);
		expect(manager.getBasicDictInfo().version).toBe('1.5.0');
	});

	it('updateBasicDictionary should return already-current when dictionary version has not changed', async () => {
		const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
		const validData = {
			schemaVersion: 1,
			dictionaryVersion: '2.0.0',
			updatedAt: '2026-08-21T00:00:00Z',
			entries: [
				{ word: '按步就班', suggestion: '按部就班', description: '已是最新' }
			]
		};
		virtualFiles.set(cachePath, JSON.stringify(validData));
		await manager.loadDictionaries();

		vi.spyOn(obsidian, 'requestUrl').mockResolvedValue(createRequestUrlResponse(validData));

		const result = await manager.updateBasicDictionary();
		expect(result.status).toBe('already-current');
		if (result.status === 'already-current') {
			expect(result.version).toBe('2.0.0');
		}
	});

	it('updateBasicDictionary should handle network errors safely without affecting current matcher', async () => {
		await manager.loadDictionaries();
		const prevCount = manager.getBasicDictInfo().count;

		vi.spyOn(obsidian, 'requestUrl').mockRejectedValue(new Error('Network offline or 404'));

		const result = await manager.updateBasicDictionary();
		expect(result.status).toBe('failed');
		if (result.status === 'failed') {
			expect(result.failureReason).toBe('network_error');
			expect(result.errorMessage).toContain('Network offline or 404');
		}

		// 原有词库未受影响
		expect(manager.getBasicDictInfo().count).toBe(prevCount);
	});

	it('updateBasicDictionary should handle remote validation errors and discard changes', async () => {
		await manager.loadDictionaries();
		const prevCount = manager.getBasicDictInfo().count;

		const malformedPayload = {
			schemaVersion: 999, // 不支持的版本
			dictionaryVersion: '9.0.0',
			entries: []
		};

		vi.spyOn(obsidian, 'requestUrl').mockResolvedValue(createRequestUrlResponse(malformedPayload));

		const result = await manager.updateBasicDictionary();
		expect(result.status).toBe('failed');
		if (result.status === 'failed') {
			expect(result.failureReason).toBe('validation_error');
		}

		expect(manager.getBasicDictInfo().count).toBe(prevCount);
	});

	it('updateBasicDictionary should prevent concurrent overlapping updates via mutex lock', async () => {
		let resolveReq: (response: RequestUrlResponse) => void = () => undefined;
		const reqPromise = new Promise<RequestUrlResponse>((resolve) => {
			resolveReq = resolve;
		});

		vi.spyOn(obsidian, 'requestUrl').mockImplementation(() => reqPromise as unknown as ReturnType<typeof obsidian.requestUrl>);

		// 发起第一个更新（挂起中）
		const p1 = manager.updateBasicDictionary();

		// 并发发起第二个更新，应该直接返回 concurrent_error
		const r2 = await manager.updateBasicDictionary();
		expect(r2.status).toBe('failed');
		if (r2.status === 'failed') {
			expect(r2.failureReason).toBe('concurrent_error');
		}

		// 释放第一个更新
		resolveReq(createRequestUrlResponse({
				schemaVersion: 1,
				dictionaryVersion: '3.0.0',
				updatedAt: '2026-08-21T00:00:00Z',
				entries: [{ word: '按步就班', suggestion: '按部就班', description: '锁释放测试' }]
			}));

		const r1 = await p1;
		expect(r1.status).toBe('updated');
	});
});

describe('DeDiDe Dictionary Validation & Advisory Threshold Rules', () => {
	it('should reject executable, unexpected, duplicate, and overlong DeDiDe lexicon data', () => {
		const valid = TEST_DEDIDE_LEXICON as unknown as Record<string, unknown>;

		expect(validateDeDiDeLexiconJson({ ...valid, regex: '.*' }).valid).toBe(false);
		expect(validateDeDiDeLexiconJson({ ...valid, script: 'alert(1)' }).valid).toBe(false);
		expect(validateDeDiDeLexiconJson({
			...valid,
			comparativeWords: ['多', '多']
		}).valid).toBe(false);
		expect(validateDeDiDeLexiconJson({
			...valid,
			comparativeWords: ['超'.repeat(33)]
		}).valid).toBe(false);
		expect(validateDeDiDeLexiconJson({
			...valid,
			actionNominalFollowers: ['方式', '方式']
		}).valid).toBe(false);
		expect(validateDeDiDeLexiconJson({
			...valid,
			actionNominalFollowers: 'not an array'
		}).valid).toBe(false);
	});

	it('should validate backward-compatible schema 1 lexicon without actionNominalFollowers', () => {
		const withoutFollowers = { ...TEST_DEDIDE_LEXICON } as Partial<DeDiDeLexicon>;
		delete withoutFollowers.actionNominalFollowers;
		const validation = validateDeDiDeLexiconJson(withoutFollowers);
		expect(validation.valid).toBe(true);
		expect(validation.data?.actionNominalFollowers).toBeUndefined();
	});

	it('should allow large DeDiDe lexicons with an advisory instead of a hard limit', () => {
		const valid = TEST_DEDIDE_LEXICON as unknown as Record<string, unknown>;
		const validation = validateDeDiDeLexiconJson({
			...valid,
			adverbialModifiers: Array.from({ length: 5001 }, (_, index) => `修饰词${index}`)
		});

		expect(validation.valid).toBe(true);
		expect(validation.isLarge).toBe(true);
	});
});

describe('DeDiDe Dictionary Lifecycle', () => {
	let app: App;
	let vault: Vault;
	let adapter: {
		exists: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
		write: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
		mkdir: ReturnType<typeof vi.fn>;
		_store: Map<string, string>;
	};
	let plugin: WebNovelAssistantPlugin;
	let manager: ProofreadingManager;

	beforeEach(async () => {
		const store = new Map<string, string>();
		adapter = {
			exists: vi.fn(async (path: string) => store.has(path)),
			read: vi.fn(async (path: string) => store.get(path) || ''),
			write: vi.fn(async (path: string, content: string) => { store.set(path, content); }),
			remove: vi.fn(async (path: string) => { store.delete(path); }),
			mkdir: vi.fn(async (_path: string) => {}),
			_store: store
		};

		vault = {
			adapter,
			getAbstractFileByPath: vi.fn(),
			on: vi.fn(() => ({})),
			offref: vi.fn()
		} as unknown as Vault;

		app = {
			vault,
			workspace: { trigger: vi.fn() }
		} as unknown as App;

		plugin = {
			app,
			manifest: { dir: 'plugins/test' },
			settings: {
				proofreading: {
					enabled: true,
					dictionaryPath: 'DICT',
					enableBuiltin: true,
					enableDeDiDe: true
				}
			},
			saveSettings: vi.fn()
		} as unknown as WebNovelAssistantPlugin;

		manager = new ProofreadingManager(app, plugin);
		await manager.loadDictionaries();
	});

	afterEach(async () => {
		await manager.destroy();
	});

	it('should initialize as not_downloaded with count 0 when no cache exists', () => {
		const info = manager.getDeDiDeDictInfo();
		expect(info.source).toBe('not_downloaded');
		expect(info.version).toBe('');
		expect(info.count).toBe(0);
		// 无词典时即使 settings.enableDeDiDe 为 true 也不能扫描
		expect(manager.scan('委屈的哭泣')).toEqual([]);
	});

	it('should gracefully retain not_downloaded status on network error', async () => {
		vi.mocked(obsidian.requestUrl).mockRejectedValueOnce(new Error('Network disconnected'));

		const res = await manager.updateDeDiDeLexicon();
		expect(res.status).toBe('failed');
		expect(res.failureReason).toBe('network_error');

		const info = manager.getDeDiDeDictInfo();
		expect(info.source).toBe('not_downloaded');
		expect(info.count).toBe(0);
	});

	it('should NEVER auto-enable DeDiDe on initial download even if settings had enableDeDiDe: true', async () => {
		plugin.settings.proofreading!.enableDeDiDe = true;
		await manager.loadDictionaries();
		expect(manager.getDeDiDeDictInfo().source).toBe('not_downloaded');

		const newLexicon = {
			schemaVersion: 1,
			dictionaryVersion: '1.2.3',
			updatedAt: '2024-01-01T00:00:00Z',
			license: 'MIT',
			adverbialModifiers: ['安静'],
			actionVerbs: ['睡觉'],
			degreePredicates: ['跑'],
			degreeComplementPrefixes: ['很'],
			degreeComplementAdjectives: ['快'],
			degreeComplementPhrases: ['非常快'],
			comparativeAdjectives: ['好'],
			comparativeWords: ['多'],
			nounLookaheadExclusions: ['人'],
			attributiveAdjectives: ['美丽'],
			attributiveNouns: ['花']
		};

		vi.mocked(obsidian.requestUrl).mockResolvedValueOnce(createRequestUrlResponse(newLexicon));

		const res = await manager.updateDeDiDeLexicon();
		expect(res.status).toBe('updated');
		expect(res.version).toBe('1.2.3');

		const info = manager.getDeDiDeDictInfo();
		expect(info.source).toBe('online_cache');
		expect(info.version).toBe('1.2.3');

		// 首次下载绝不自动启用：enableDeDiDe 强制重置为 false，scanner 仍为 null
		expect(plugin.settings.proofreading!.enableDeDiDe).toBe(false);
		expect(manager.scan('安静的睡觉')).toEqual([]);

		const cachePath = 'plugins/test/dict/dedide-lexicon.json';
		expect(adapter._store.has(cachePath)).toBe(true);
	});

	it('should preserve enabled state and hot-swap scanner when updating an already downloaded DeDiDe lexicon', async () => {
		// 预设已有旧版本下载缓存
		const oldLexicon = {
			schemaVersion: 1,
			dictionaryVersion: '1.0.0',
			updatedAt: '2023-01-01T00:00:00Z',
			license: 'MIT',
			adverbialModifiers: ['大声'],
			actionVerbs: ['说话'],
			degreePredicates: [],
			degreeComplementPrefixes: [],
			degreeComplementAdjectives: [],
			degreeComplementPhrases: [],
			comparativeAdjectives: [],
			comparativeWords: [],
			nounLookaheadExclusions: [],
			attributiveAdjectives: [],
			attributiveNouns: []
		};
		const cachePath = 'plugins/test/dict/dedide-lexicon.json';
		adapter._store.set(cachePath, JSON.stringify(oldLexicon));

		plugin.settings.proofreading!.enableDeDiDe = true;
		await manager.loadDictionaries();
		expect(manager.getDeDiDeDictInfo().source).toBe('online_cache');
		expect(manager.getDeDiDeDictInfo().version).toBe('1.0.0');

		const newLexicon = {
			schemaVersion: 1,
			dictionaryVersion: '1.2.3',
			updatedAt: '2024-01-01T00:00:00Z',
			license: 'MIT',
			adverbialModifiers: ['安静'],
			actionVerbs: ['睡觉'],
			degreePredicates: ['跑'],
			degreeComplementPrefixes: ['很'],
			degreeComplementAdjectives: ['快'],
			degreeComplementPhrases: ['非常快'],
			comparativeAdjectives: ['好'],
			comparativeWords: ['多'],
			nounLookaheadExclusions: ['人'],
			attributiveAdjectives: ['美丽'],
			attributiveNouns: ['花']
		};

		vi.mocked(obsidian.requestUrl).mockResolvedValueOnce(createRequestUrlResponse(newLexicon));

		const res = await manager.updateDeDiDeLexicon();
		expect(res.status).toBe('updated');
		expect(res.version).toBe('1.2.3');

		const info = manager.getDeDiDeDictInfo();
		expect(info.source).toBe('online_cache');
		expect(info.version).toBe('1.2.3');

		// 已有下载后的版本更新保持用户的 enableDeDiDe: true 并热切换 scanner
		expect(plugin.settings.proofreading!.enableDeDiDe).toBe(true);
		const diags = manager.scan('安静的睡觉');
		expect(diags.length).toBe(1);
		expect(diags[0].original).toBe('安静的睡觉');
		expect(diags[0].suggestions).toEqual(['安静地睡觉']);
	});

	it('should NOT auto-enable DeDiDe when downloaded with enableDeDiDe: false', async () => {
		plugin.settings.proofreading!.enableDeDiDe = false;
		await manager.loadDictionaries();

		const newLexicon = {
			schemaVersion: 1,
			dictionaryVersion: '1.2.3',
			updatedAt: '2024-01-01T00:00:00Z',
			license: 'MIT',
			adverbialModifiers: ['安静'],
			actionVerbs: ['睡觉'],
			degreePredicates: [],
			degreeComplementPrefixes: [],
			degreeComplementAdjectives: [],
			degreeComplementPhrases: [],
			comparativeAdjectives: [],
			comparativeWords: [],
			nounLookaheadExclusions: [],
			attributiveAdjectives: [],
			attributiveNouns: []
		};

		vi.mocked(obsidian.requestUrl).mockResolvedValueOnce(createRequestUrlResponse(newLexicon));

		const res = await manager.updateDeDiDeLexicon();
		expect(res.status).toBe('updated');

		// 词典已更新，但 enableDeDiDe 仍为 false，且 scanner 仍为 null
		expect(plugin.settings.proofreading!.enableDeDiDe).toBe(false);
		expect(manager.scan('安静的睡觉')).toEqual([]);
	});

	it('should recover from broken cache using dict/ .bak file for DeDiDe', async () => {
		const cachePath = 'plugins/test/dict/dedide-lexicon.json';
		const bakPath = 'plugins/test/dict/dedide-lexicon.json.bak';

		adapter._store.set(cachePath, 'INVALID JSON {');

		const validBakLexicon = {
			schemaVersion: 1,
			dictionaryVersion: '1.1.0-bak',
			updatedAt: '2023-01-01T00:00:00Z',
			license: 'MIT',
			adverbialModifiers: ['大声'],
			actionVerbs: ['说话'],
			degreePredicates: [],
			degreeComplementPrefixes: [],
			degreeComplementAdjectives: [],
			degreeComplementPhrases: [],
			comparativeAdjectives: [],
			comparativeWords: [],
			nounLookaheadExclusions: [],
			attributiveAdjectives: [],
			attributiveNouns: []
		};
		adapter._store.set(bakPath, JSON.stringify(validBakLexicon));

		await manager.loadDictionaries();

		const info = manager.getDeDiDeDictInfo();
		expect(info.source).toBe('online_cache');
		expect(info.version).toBe('1.1.0-bak');

		const diags = manager.scan('大声的说话');
		expect(diags.length).toBe(1);
		expect(diags[0].original).toBe('大声的说话');
	});
});

describe('Punctuation Scanner & ProofreadingManager Punctuation Integration', () => {
	const scanner = new PunctuationScanner();

	it('should suggest full-width punctuation in pure Chinese context', () => {
		const text = '天黑了,我们回去吧.快走!';
		const exclusions = extractMarkdownExclusions(text);
		const diags = scanner.scan(text, exclusions);

		expect(diags.length).toBe(3);
		expect(diags[0].original).toBe(',');
		expect(diags[0].suggestions).toEqual(['，']);
		expect(diags[0].type).toBe('punctuation');

		expect(diags[1].original).toBe('.');
		expect(diags[1].suggestions).toEqual(['。']);

		expect(diags[2].original).toBe('!');
		expect(diags[2].suggestions).toEqual(['！']);
	});

	it('should suggest full-width for question, colon, semicolon, and parentheses in Chinese context', () => {
		const text = '准备好了吗?看这里:出发;带着(钥匙)';
		const exclusions = extractMarkdownExclusions(text);
		const diags = scanner.scan(text, exclusions);

		expect(diags.length).toBe(5);
		expect(diags.map(d => d.suggestions[0])).toEqual(['？', '：', '；', '（', '）']);
	});

	it('should suggest half-width punctuation in pure English context', () => {
		const text = 'Hello world，how are you？Everything is fine！Yes：indeed；done（ok）';
		const exclusions = extractMarkdownExclusions(text);
		const diags = scanner.scan(text, exclusions);

		expect(diags.length).toBe(7);
		expect(diags[0].original).toBe('，');
		expect(diags[0].suggestions).toEqual([',']);
		expect(diags[1].original).toBe('？');
		expect(diags[1].suggestions).toEqual(['?']);
		expect(diags[2].original).toBe('！');
		expect(diags[2].suggestions).toEqual(['!']);
		expect(diags[3].original).toBe('：');
		expect(diags[3].suggestions).toEqual([':']);
		expect(diags[4].original).toBe('；');
		expect(diags[4].suggestions).toEqual([';']);
		expect(diags[5].original).toBe('（');
		expect(diags[5].suggestions).toEqual(['(']);
		expect(diags[6].original).toBe('）');
		expect(diags[6].suggestions).toEqual([')']);
	});

	it('should produce 0 diagnostics in mixed Chinese-Latin context (conservative skip)', () => {
		const text1 = 'Hello 世界, how are you?';
		const diags1 = scanner.scan(text1, extractMarkdownExclusions(text1));
		expect(diags1.length).toBe(0);

		const text2 = '在这段代码中 const a = 1, b = 2; 请看。';
		const diags2 = scanner.scan(text2, extractMarkdownExclusions(text2));
		expect(diags2.length).toBe(0);
	});

	it('should skip punctuation exactly at Chinese-Latin boundary', () => {
		const text1 = '世界, Hello';
		const diags1 = scanner.scan(text1, extractMarkdownExclusions(text1));
		expect(diags1.length).toBe(0);

		const text2 = 'Hello, 世界';
		const diags2 = scanner.scan(text2, extractMarkdownExclusions(text2));
		expect(diags2.length).toBe(0);
	});

	it('should produce 0 diagnostics on lines without letters or Han characters', () => {
		const text = '12345, 67890. 999!';
		const diags = scanner.scan(text, extractMarkdownExclusions(text));
		expect(diags.length).toBe(0);
	});

	it('should protect numbers with decimals, thousands separators, and times', () => {
		const text = '圆周率是3.14159,今年产值是1,000,000元,开会时间是12:30.';
		const diags = scanner.scan(text, extractMarkdownExclusions(text));

		// Only the commas after 3.14159 and 元, and the period at the end should be flagged
		// 3.14, 1,000,000, and 12:30 internal punctuation must be protected
		expect(diags.length).toBe(3);
		expect(diags[0].from).toBe(text.indexOf(',今年产值'));
		expect(diags[1].from).toBe(text.indexOf(',开会时间'));
		expect(diags[2].from).toBe(text.lastIndexOf('.'));
	});

	it('should protect ellipsis sequences', () => {
		const text = '等等...我们还没说完...';
		const diags = scanner.scan(text, extractMarkdownExclusions(text));
		expect(diags.length).toBe(0);
	});

	it('should protect URLs and email addresses', () => {
		const text = '请访问https://example.com/api?v=1&type=test或发信给admin.user@example.com联系我们.';
		const diags = scanner.scan(text, extractMarkdownExclusions(text));

		// Only the period at the end of the sentence should be flagged
		expect(diags.length).toBe(1);
		expect(diags[0].from).toBe(text.lastIndexOf('.'));
		expect(diags[0].suggestions).toEqual(['。']);
	});

	it('should protect URLs with square brackets and query parameters', () => {
		const text = '请访问https://example.com/api?filter[name]=test&ids[]=1获取信息.';
		const diags = scanner.scan(text, extractMarkdownExclusions(text));

		expect(diags.length).toBe(1);
		expect(diags[0].from).toBe(text.lastIndexOf('.'));
		expect(diags[0].suggestions).toEqual(['。']);
	});

	it('should protect Markdown ordered list marker numbers', () => {
		const text = '1. 第一步先安装依赖。\n2. 第二步启动服务。';
		const diags = scanner.scan(text, extractMarkdownExclusions(text));
		expect(diags.length).toBe(0);
	});

	it('should ignore punctuation inside Markdown code exclusions', () => {
		const text = '在函数中 `const x = 1, y = 2;` 这里是中文代码解释.';
		const exclusions = extractMarkdownExclusions(text);
		const diags = scanner.scan(text, exclusions);

		// Inside ` ` code span is excluded, only the final period is flagged
		expect(diags.length).toBe(1);
		expect(diags[0].original).toBe('.');
		expect(diags[0].suggestions).toEqual(['。']);
	});

	describe('Chinese paired punctuation validation', () => {
		it('should accept correctly paired and nested punctuation', () => {
			const text = '他说：“这是一个【测试】，你觉得（怎样）？看这本《书》吧。他说‘好’。”';
			const exclusions = extractMarkdownExclusions(text);
			const diags = scanner.scan(text, exclusions);
			const pairingDiags = diags.filter(d => d.ruleId.startsWith('punctuation_pair_'));
			expect(pairingDiags.length).toBe(0);
		});

		const pairs = [
			{ left: '“', right: '”' },
			{ left: '‘', right: '’' },
			{ left: '（', right: '）' },
			{ left: '【', right: '】' },
			{ left: '《', right: '》' }
		];

		pairs.forEach(({ left, right }) => {
			it(`should detect unclosed left and isolated right symbols for ${left}${right}`, () => {
				// Unclosed left
				const leftText = `${left}这是一个测试`;
				const leftDiags = scanner.scan(leftText, []).filter(d => d.ruleId.startsWith('punctuation_pair_'));
				expect(leftDiags.length).toBe(1);
				expect(leftDiags[0].original).toBe(left);
				expect(leftDiags[0].message).toContain('未闭合的左侧标点符号');
				expect(leftDiags[0].suggestions).toEqual([]);

				// Isolated right
				const rightText = `这是一个测试${right}`;
				const rightDiags = scanner.scan(rightText, []).filter(d => d.ruleId.startsWith('punctuation_pair_'));
				expect(rightDiags.length).toBe(1);
				expect(rightDiags[0].original).toBe(right);
				expect(rightDiags[0].message).toContain('孤立的右侧标点符号');
				expect(rightDiags[0].suggestions).toEqual([]);
			});
		});

		it('should detect consecutive same-side symbols (left and right, with or without spaces)', () => {
			// Left, no space
			const leftNoSpace = '““重复”';
			const diags1 = scanner.scan(leftNoSpace, []).filter(d => d.ruleId.startsWith('punctuation_pair_'));
			expect(diags1.length).toBe(2);
			expect(diags1[0].message).toContain('连续出现同侧标点符号');
			expect(diags1[1].message).toContain('连续出现同侧标点符号');

			// Right, with spaces
			const rightWithSpace = '“测试”   ”';
			const diags2 = scanner.scan(rightWithSpace, []).filter(d => d.ruleId.startsWith('punctuation_pair_'));
			expect(diags2.length).toBe(2);
			expect(diags2[0].message).toContain('连续出现同侧标点符号');
			expect(diags2[1].message).toContain('连续出现同侧标点符号');
		});

		it('should allow cross-line pairing', () => {
			const text = '“第一段对白。\n第二段继续。”';
			const exclusions = extractMarkdownExclusions(text);
			const diags = scanner.scan(text, exclusions);
			const pairingDiags = diags.filter(d => d.ruleId.startsWith('punctuation_pair_'));
			expect(pairingDiags.length).toBe(0);
		});

		it('should not pair with symbols in Markdown excluded regions', () => {
			const text = '`“` 代码中未闭合不算”';
			const exclusions = extractMarkdownExclusions(text);
			const diags = scanner.scan(text, exclusions);
			const pairingDiags = diags.filter(d => d.ruleId.startsWith('punctuation_pair_'));

			// The right quote at the end is isolated because the left quote is in code
			expect(pairingDiags.length).toBe(1);
			expect(pairingDiags[0].original).toBe('”');
		});
	});

	it('should integrate with ProofreadingManager scan when enablePunctuation is true, false, or legacy missing', async () => {
		const adapter = {
			exists: vi.fn().mockResolvedValue(false),
			read: vi.fn().mockResolvedValue(''),
			write: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined)
		};

		const vault = {
			adapter,
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			on: vi.fn(() => ({})),
			offref: vi.fn()
		} as unknown as Vault;

		const app = {
			vault,
			workspace: { trigger: vi.fn() }
		} as unknown as App;

		const plugin = {
			app,
			manifest: { id: 'obsidian-webnovel-assistant', dir: 'plugins/test' },
			settings: {
				proofreading: {
					enabled: true,
					dictionaryPath: 'NovelBook/校对词典',
					enableBuiltin: true,
					enableUserDict: true,
					enableSensitive: true,
					enableSynonyms: true,
					enableDeDiDe: false,
					enablePunctuation: true
				},
				workspaceFolders: ['NovelBook']
			} as AccurateCountSettings,
			saveSettings: vi.fn().mockResolvedValue(undefined),
			isFileInWorkspace: vi.fn().mockReturnValue(true)
		} as unknown as WebNovelAssistantPlugin;

		const manager = new ProofreadingManager(app, plugin);
		await manager.loadDictionaries();

		const chineseSample = '这是纯中文测试句子,后面还有一句话.';
		const diagsEnabled = manager.scan(chineseSample);
		const punctDiags = diagsEnabled.filter(d => d.type === 'punctuation');
		expect(punctDiags.length).toBe(2);

		// Legacy setting missing enablePunctuation should default off
		delete (plugin.settings.proofreading as Partial<AccurateCountSettings['proofreading']>).enablePunctuation;
		const diagsLegacy = manager.scan(chineseSample);
		const punctLegacy = diagsLegacy.filter(d => d.type === 'punctuation');
		expect(punctLegacy.length).toBe(0);

		// Explicit false disables punctuation diagnostics
		plugin.settings.proofreading.enablePunctuation = false;
		const diagsDisabled = manager.scan(chineseSample);
		const punctDisabled = diagsDisabled.filter(d => d.type === 'punctuation');
		expect(punctDisabled.length).toBe(0);

		await manager.destroy();
	});
});

describe('ProofreadingManager - getMaxPatternLength & Caching Lifecycle', () => {
		it('should have initial max pattern length of 50 and update O(1) on load, hot update, delete, and destroy', async () => {
			const mockFiles = new Map<string, string>();
			const mockVaultFiles = new Map<string, TFile | TFolder>();

			const adapter = {
				exists: vi.fn().mockImplementation(async (path: string) => mockFiles.has(path)),
				read: vi.fn().mockImplementation(async (path: string) => mockFiles.get(path) ?? ''),
				write: vi.fn().mockImplementation(async (path: string, content: string) => { mockFiles.set(path, content); }),
				remove: vi.fn().mockImplementation(async (path: string) => { mockFiles.delete(path); }),
				mkdir: vi.fn().mockResolvedValue(undefined)
			};

			const vaultListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

			const vault = {
				adapter,
				getAbstractFileByPath: vi.fn((path: string) => mockVaultFiles.get(path) ?? null),
				read: vi.fn(async (file: TFile) => mockFiles.get(file.path) ?? ''),
				on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
					vaultListeners[event] = vaultListeners[event] || [];
					vaultListeners[event].push(handler);
					return { event, handler };
				}),
				offref: vi.fn()
			} as unknown as Vault;

			const app = {
				vault,
				workspace: { trigger: vi.fn() }
			} as unknown as App;

			const plugin = {
				app,
				manifest: { id: 'obsidian-webnovel-assistant', dir: 'plugins/test' },
				settings: {
					proofreading: {
						enabled: true,
						dictionaryPath: 'NovelBook/校对词典',
						enableBuiltin: true,
						enableUserDict: true,
						enableSensitive: true,
						enableSynonyms: true,
						enableDeDiDe: false,
						enablePunctuation: false
					},
					workspaceFolders: ['NovelBook']
				} as AccurateCountSettings,
				saveSettings: vi.fn().mockResolvedValue(undefined),
				isFileInWorkspace: vi.fn().mockReturnValue(true)
			} as unknown as WebNovelAssistantPlugin;

			const manager = new ProofreadingManager(app, plugin);

			// 1. Initial cached value is 50
			expect(manager.getMaxPatternLength()).toBe(50);

			// 2. Normal load with a 65-char word in user wrong words table
			const longWord = '字'.repeat(65);
			const wrongTable = `| 错词 | 建议 | 说明 |\n| --- | --- | --- |\n| ${longWord} | 替换词 | 说明 |`;
			const wrongFilePath = 'NovelBook/校对词典/错词.md';
			mockFiles.set(wrongFilePath, wrongTable);
			const wrongTFile = createMockTFile(wrongFilePath);
			mockVaultFiles.set(wrongFilePath, wrongTFile);
			mockVaultFiles.set('NovelBook/校对词典', createMockTFolder('NovelBook/校对词典'));

			await manager.initialize();
			expect(manager.getMaxPatternLength()).toBe(65);

			// 3. Hot update of basic dictionary with a valid entry
			const basicWord = '词'.repeat(25);
			const basicPayload = {
				schemaVersion: 1,
				dictionaryVersion: '2.0.0',
				updatedAt: '2026-08-25',
				entries: [
					{ word: basicWord, suggestion: '正确词', description: '内置错词' }
				]
			};

			const requestUrlSpy = vi.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce(createRequestUrlResponse(basicPayload));
			const updateRes = await manager.updateBasicDictionary();
			expect(updateRes.status).toBe('updated');
			// Since user wrong word is 65 chars (> 25 and > 50), maxPatternLength is 65
			expect(manager.getMaxPatternLength()).toBe(65);

			// 4. Failed update (network error) retains prior cache (65)
			requestUrlSpy.mockRejectedValueOnce(new Error('Network offline'));
			const failRes1 = await manager.updateBasicDictionary();
			expect(failRes1.status).toBe('failed');
			expect(manager.getMaxPatternLength()).toBe(65);

			// 5. Failed update (invalid JSON / validation error) retains prior cache (65)
			requestUrlSpy.mockResolvedValueOnce({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				text: '{"schemaVersion": 999}',
				json: { schemaVersion: 999 }
			} as RequestUrlResponse);
			const failRes2 = await manager.updateBasicDictionary();
			expect(failRes2.status).toBe('failed');
			expect(manager.getMaxPatternLength()).toBe(65);

			// 6. disable() retains prior cache (65)
			await manager.disable();
			expect(manager.getMaxPatternLength()).toBe(65);

			// 7. Directory delete event clears user dicts and updates cache (retaining minimum 50)
			mockVaultFiles.delete(wrongFilePath);
			mockFiles.delete(wrongFilePath);
			const deleteFolder = createMockTFolder('NovelBook/校对词典');
			const deleteListeners = vaultListeners['delete'] || [];
			deleteListeners.forEach(fn => fn(deleteFolder));
			// User 65-char word is gone, basic word is 25 chars -> minimum 50 applies
			expect(manager.getMaxPatternLength()).toBe(50);

			// 8. destroy() resets cache to 50
			await manager.destroy();
			expect(manager.getMaxPatternLength()).toBe(50);
		});

		it('should resolve bilingual dictionary file paths deterministically', () => {
			const mockVaultFiles = new Map<string, TFile>();
			const vault = {
				getAbstractFileByPath: vi.fn((path: string) => mockVaultFiles.get(path) ?? null)
			} as unknown as Vault;

			const app = { vault } as unknown as App;
			const plugin = {
				app,
				settings: {
					proofreading: { dictionaryPath: 'Novel/校对词典' },
					workspaceFolders: ['Novel']
				}
			} as unknown as WebNovelAssistantPlugin;

			const manager = new ProofreadingManager(app, plugin);

			// Default zh folder with no existing files -> establishedScheme is zh
			const pathsZh = manager.getResolvedDictFilePaths('Novel/校对词典');
			expect(pathsZh.wrongFileName).toBe(WRONG_WORDS_FILE);
			expect(pathsZh.synonymFileName).toBe(SYNONYMS_FILE);
			expect(pathsZh.sensitiveFileName).toBe(SENSITIVE_WORDS_FILE);

			// En folder with no existing files -> establishedScheme is en
			const pathsEn = manager.getResolvedDictFilePaths('Novel/Proofreading Dictionaries');
			expect(pathsEn.wrongFileName).toBe('Typos.md');
			expect(pathsEn.synonymFileName).toBe('Synonyms.md');
			expect(pathsEn.sensitiveFileName).toBe('Sensitive Words.md');

			// If English typos file exists in folder -> picks English typos
			mockVaultFiles.set('Novel/CustomDict/Typos.md', createMockTFile('Novel/CustomDict/Typos.md'));
			const pathsMixed = manager.getResolvedDictFilePaths('Novel/CustomDict');
			expect(pathsMixed.wrongFileName).toBe('Typos.md');
		});

		describe('Vault-wide Proofreading & Default Dictionary Relocation', () => {
			it('scans every workspace file by default and expands to the vault in global mode while excluding dictionaries', async () => {
				const virtualFiles = new Map<string, string>();
				const vaultMock = {
					adapter: {
						exists: vi.fn(async (path: string) => virtualFiles.has(path)),
						read: vi.fn(async (path: string) => virtualFiles.get(path) ?? ''),
						write: vi.fn(async (path: string, content: string) => { virtualFiles.set(path, content); }),
						mkdir: vi.fn().mockResolvedValue(undefined)
					},
					getAbstractFileByPath: vi.fn((path: string) => {
						if (path.includes('校对词典')) return createMockTFolder(path);
						return createMockTFile(path);
					}),
					on: vi.fn().mockReturnValue({}),
					offref: vi.fn(),
					process: vi.fn()
				} as unknown as Vault;

				const app = { vault: vaultMock, workspace: { trigger: vi.fn() } } as unknown as App;
				const plugin = {
					manifest: {
						id: 'obsidian-webnovel-assistant',
						dir: '.obsidian/plugins/WebNovel Assistant'
					},
					app,
					settings: {
						proofreading: {
							enabled: true,
							dictionaryPath: 'Novel/校对词典',
							enableBuiltin: true,
							enableGlobal: false
						},
						workspaceFolders: ['Novel']
					},
					isFileInWorkspace: vi.fn((file: TFile) => file.path.startsWith('Novel/'))
				} as unknown as WebNovelAssistantPlugin;

				const cachePath = '.obsidian/plugins/WebNovel Assistant/dict/basic-wrong-words.json';
				const validData = {
					schemaVersion: 1,
					dictionaryVersion: '1.0.0',
					updatedAt: '2026-08-23',
					entries: [{ word: '迫不急待', suggestion: '迫不及待', description: '成语误用' }]
				};
				virtualFiles.set(cachePath, JSON.stringify(validData));

				const mgr = new ProofreadingManager(app, plugin);
				await mgr.loadDictionaries();

				const ordinaryFileInside = createMockTFile('Novel/RandomNote.md');
				const ordinaryFileOutside = createMockTFile('Personal/RandomNote.md');
				const dictFile = createMockTFile('Novel/校对词典/错词.md');

				// 1. enableGlobal: false -> every workspace file is scanned, regardless of chapter eligibility
				plugin.settings.proofreading.enableGlobal = false;
				expect(mgr.scan('测试 迫不急待 文本', ordinaryFileInside)).toHaveLength(1);
				expect(mgr.scan('测试 迫不急待 文本', ordinaryFileOutside)).toHaveLength(0);

				// 2. enableGlobal: true -> ordinary file outside workspace is scanned
				plugin.settings.proofreading.enableGlobal = true;
				const results = mgr.scan('测试 迫不急待 文本', ordinaryFileOutside);
				expect(results).toHaveLength(1);
				expect(results[0].original).toBe('迫不急待');
				expect(results[0].suggestions).toEqual(['迫不及待']);

				// 3. Dictionary directory itself is ALWAYS excluded even in global mode
				expect(mgr.scan('测试 迫不急待 文本', dictFile)).toHaveLength(0);
			});

			it('relocates Chinese and English default-managed dictionary folders on workspace change', async () => {
				const abstractFiles = new Map<string, TFolder | TFile>();
				const renameFileMock = vi.fn(async (file: TFolder | TFile, newPath: string) => {
					abstractFiles.delete(file.path);
					file.path = newPath;
					abstractFiles.set(newPath, file);
				});

				const vaultMock = {
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
						read: vi.fn().mockResolvedValue(''),
						write: vi.fn().mockResolvedValue(undefined),
						mkdir: vi.fn().mockResolvedValue(undefined)
					},
					getAbstractFileByPath: vi.fn((path: string) => abstractFiles.get(path) ?? null),
					createFolder: vi.fn(async (path: string) => {
						const folder = createMockTFolder(path);
						abstractFiles.set(path, folder);
						return folder;
					}),
					on: vi.fn().mockReturnValue({}),
					offref: vi.fn(),
					process: vi.fn()
				} as unknown as Vault;

				const fileManagerMock = {
					renameFile: renameFileMock
				} as unknown as FileManager;

				const resetLoreCacheMock = vi.fn();
				const app = {
					vault: vaultMock,
					fileManager: fileManagerMock,
					workspace: { trigger: vi.fn() }
				} as unknown as App;

				const plugin = {
					manifest: {
						id: 'obsidian-webnovel-assistant',
						dir: '.obsidian/plugins/WebNovel Assistant'
					},
					app,
					settings: {
						proofreading: {
							enabled: true,
							dictionaryPath: 'OldWorkspace/校对词典'
						},
						workspaceFolders: ['OldWorkspace']
					},
					cacheManager: {
						resetLoreCache: resetLoreCacheMock
					},
					saveSettings: vi.fn().mockResolvedValue(undefined)
				} as unknown as WebNovelAssistantPlugin;

				const mgr = new ProofreadingManager(app, plugin);

				// Case 1: Chinese default folder: OldWorkspace/校对词典 -> NewWorkspace/校对词典
				const zhOldFolder = createMockTFolder('OldWorkspace/校对词典');
				abstractFiles.set('OldWorkspace/校对词典', zhOldFolder);

				const movedZh = await mgr.relocateDefaultDictionary('OldWorkspace', 'NewWorkspace');
				expect(movedZh).toBe(true);
				expect(renameFileMock).toHaveBeenCalledWith(zhOldFolder, 'NewWorkspace/校对词典');
				expect(plugin.settings.proofreading.dictionaryPath).toBe('NewWorkspace/校对词典');
				expect(resetLoreCacheMock).toHaveBeenCalled();

				// Case 2: English default folder: OldWorkspace/Proofreading Dictionaries -> NewWorkspace/Proofreading Dictionaries
				const enOldFolder = createMockTFolder('OldWorkspace/Proofreading Dictionaries');
				abstractFiles.set('OldWorkspace/Proofreading Dictionaries', enOldFolder);
				plugin.settings.proofreading.dictionaryPath = 'OldWorkspace/Proofreading Dictionaries';

				const movedEn = await mgr.relocateDefaultDictionary('OldWorkspace', 'NewWorkspace');
				expect(movedEn).toBe(true);
				expect(renameFileMock).toHaveBeenCalledWith(enOldFolder, 'NewWorkspace/Proofreading Dictionaries');
				expect(plugin.settings.proofreading.dictionaryPath).toBe('NewWorkspace/Proofreading Dictionaries');

				// Case 3: Vault root default to workspace: 校对词典 -> NovelBook/校对词典
				const rootZhFolder = createMockTFolder('校对词典');
				abstractFiles.set('校对词典', rootZhFolder);
				plugin.settings.proofreading.dictionaryPath = '校对词典';

				const movedFromRoot = await mgr.relocateDefaultDictionary('', 'NovelBook');
				expect(movedFromRoot).toBe(true);
				expect(renameFileMock).toHaveBeenCalledWith(rootZhFolder, 'NovelBook/校对词典');
				expect(plugin.settings.proofreading.dictionaryPath).toBe('NovelBook/校对词典');

				// Case 4: Workspace default to vault root: NovelBook/校对词典 -> 校对词典
				const wsZhFolder = createMockTFolder('NovelBook/校对词典');
				abstractFiles.set('NovelBook/校对词典', wsZhFolder);
				plugin.settings.proofreading.dictionaryPath = 'NovelBook/校对词典';

				const movedToRoot = await mgr.relocateDefaultDictionary('NovelBook', '');
				expect(movedToRoot).toBe(true);
				expect(renameFileMock).toHaveBeenCalledWith(wsZhFolder, '校对词典');
				expect(plugin.settings.proofreading.dictionaryPath).toBe('校对词典');
			});

			it('keeps customized dictionary path untouched when workspace changes', async () => {
				const abstractFiles = new Map<string, TFolder | TFile>();
				const renameFileMock = vi.fn();

				const vaultMock = {
					getAbstractFileByPath: vi.fn((path: string) => abstractFiles.get(path) ?? null)
				} as unknown as Vault;

				const app = {
					vault: vaultMock,
					fileManager: { renameFile: renameFileMock },
					workspace: { trigger: vi.fn() }
				} as unknown as App;

				const plugin = {
					app,
					settings: {
						proofreading: {
							enabled: true,
							dictionaryPath: 'Custom/MyDict'
						},
						workspaceFolders: ['OldWorkspace']
					}
				} as unknown as WebNovelAssistantPlugin;

				const mgr = new ProofreadingManager(app, plugin);
				const moved = await mgr.relocateDefaultDictionary('OldWorkspace', 'NewWorkspace');

				expect(moved).toBe(false);
				expect(renameFileMock).not.toHaveBeenCalled();
				expect(plugin.settings.proofreading.dictionaryPath).toBe('Custom/MyDict');
			});

			it('handles destination conflict and move failure safely without overwriting or losing path', async () => {
				const abstractFiles = new Map<string, TFolder | TFile>();
				const renameFileMock = vi.fn();

				const vaultMock = {
					getAbstractFileByPath: vi.fn((path: string) => abstractFiles.get(path) ?? null)
				} as unknown as Vault;

				const app = {
					vault: vaultMock,
					fileManager: { renameFile: renameFileMock },
					workspace: { trigger: vi.fn() }
				} as unknown as App;

				const plugin = {
					app,
					settings: {
						proofreading: {
							enabled: true,
							dictionaryPath: 'OldWorkspace/校对词典'
						},
						workspaceFolders: ['OldWorkspace']
					}
				} as unknown as WebNovelAssistantPlugin;

				const mgr = new ProofreadingManager(app, plugin);

				// Conflict case: NewWorkspace/校对词典 already exists
				const oldFolder = createMockTFolder('OldWorkspace/校对词典');
				const existingDest = createMockTFolder('NewWorkspace/校对词典');
				abstractFiles.set('OldWorkspace/校对词典', oldFolder);
				abstractFiles.set('NewWorkspace/校对词典', existingDest);

				const conflictMoved = await mgr.relocateDefaultDictionary('OldWorkspace', 'NewWorkspace');
				expect(conflictMoved).toBe(false);
				expect(renameFileMock).not.toHaveBeenCalled();
				expect(plugin.settings.proofreading.dictionaryPath).toBe('OldWorkspace/校对词典');

				// Failure case: destination does not exist, but renameFile throws
				abstractFiles.delete('NewWorkspace/校对词典');
				renameFileMock.mockRejectedValueOnce(new Error('Permission denied'));

				const failedMoved = await mgr.relocateDefaultDictionary('OldWorkspace', 'NewWorkspace');
				expect(failedMoved).toBe(false);
				expect(plugin.settings.proofreading.dictionaryPath).toBe('OldWorkspace/校对词典');
			});
		});
});
