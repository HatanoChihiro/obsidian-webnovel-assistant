import { describe, it, expect } from 'vitest';
import { auditProofreadingSnippet } from '../scripts/i18n-audit';

describe('i18n AST Audit for Proofreading Sinks', () => {
	it('should flag raw template literals in messageBuilder sinks (original DeDiDe defect style)', () => {
		const badCode = `
			const patterns = [];
			patterns.push({
				id: 'dedide_adv_de_verb',
				charIndexOffset: -1,
				expectedChar: '地',
				messageBuilder: (matchText) => \`可能误用：“\${matchText}”中修饰动作，建议使用“地”\`,
				confidence: 'high'
			});
		`;
		const issues = auditProofreadingSnippet(badCode, 'src/services/proofreading/DeDiDeRule.ts');
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0].sink).toBe('messageBuilder');
		expect(issues[0].message).toContain('Raw string/template literal');
	});

	it('should flag raw string literals in diagnostic message sinks', () => {
		const badCode = `
			const diags = [];
			diags.push({
				ruleId: 'test_rule',
				type: 'grammar',
				message: 'Hardcoded user visible message',
				original: 'test'
			});
		`;
		const issues = auditProofreadingSnippet(badCode, 'src/services/proofreading/CustomRule.ts');
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0].sink).toBe('message');
		expect(issues[0].message).toContain('Hardcoded user visible message');
	});

	it('should flag raw fallback literals in diagnostic message expressions', () => {
		const badCode = `
			const dictionaryEntry = { description: '' };
			const diagnostic = {
				message: dictionaryEntry.description || \`Hardcoded fallback for \${word}\`
			};
		`;
		const issues = auditProofreadingSnippet(badCode, 'src/services/proofreading/AhoCorasick.ts');
		expect(issues).toHaveLength(1);
		expect(issues[0].sink).toBe('message');
	});

	it('should pass t() localized messageBuilder and message sinks', () => {
		const goodCode = `
			import { t } from '../../i18n';
			const patterns = [];
			patterns.push({
				id: 'dedide_adv_de_verb',
				charIndexOffset: -1,
				expectedChar: '地',
				messageBuilder: (matchText) => t('proofreading.dedide-adv-verb', { text: matchText }),
				confidence: 'high'
			});
			const diags = [];
			diags.push({
				ruleId: 'test_rule',
				type: 'punctuation',
				message: t('proofreading.punctuation-suggestion', { suggestion: '，' }),
				original: ','
			});
		`;
		const issues = auditProofreadingSnippet(goodCode, 'src/services/proofreading/DeDiDeRule.ts');
		expect(issues).toHaveLength(0);
	});

	it('should pass dynamic dictionary data, empty messages, and joined messages in AhoCorasick', () => {
		const acCode = `
			const rawMatches = [];
			const d = { description: 'from dict', group: { description: 'synonym group' } };
			rawMatches.push({
				ruleId: 'r1',
				type: 'wrong_word',
				message: d.description,
				original: 'test'
			});
			rawMatches.push({
				ruleId: 'r2',
				type: 'synonym',
				message: d.group.description,
				original: 'test2'
			});
			const messages = ['m1', 'm2'];
			const merged = {
				message: messages.join('；')
			};
		`;
		const issues = auditProofreadingSnippet(acCode, 'src/services/proofreading/AhoCorasick.ts');
		expect(issues).toHaveLength(0);
	});

	it('should NOT flag Markdown templates, table parser error reasons, or regexes', () => {
		const parserCode = `
			export const WRONG_WORDS_TEMPLATE = '| 错词 | 建议 | 说明 |\\n| --- | --- | --- |\\n';
			export function parseTable(content: string) {
				if (!content) {
					return { success: false, reason: '未找到标准错词表格（精确表头：错词 | 建议 | 说明）' };
				}
				const reg = new RegExp('^(?:[的地得])$', 'g');
				return { success: true, data: [] };
			}
		`;
		const issues = auditProofreadingSnippet(parserCode, 'src/services/proofreading/tableParser.ts');
		expect(issues).toHaveLength(0);
	});

	it('should flag raw string literals in UI Notice calls and pass t() Notice calls', () => {
		const badUICode = `
			import { Notice } from 'obsidian';
			export function showAlert() {
				new Notice("Raw unlocalized notice");
			}
		`;
		const badIssues = auditProofreadingSnippet(badUICode, 'src/ui/ProofreadingPopover.ts');
		expect(badIssues.length).toBeGreaterThan(0);
		expect(badIssues[0].sink).toBe('new Notice');

		const goodUICode = `
			import { Notice } from 'obsidian';
			import { t } from '../i18n';
			export function showAlert() {
				new Notice(t('notice.proofreading-stale'));
			}
		`;
		const goodIssues = auditProofreadingSnippet(goodUICode, 'src/ui/ProofreadingPopover.ts');
		expect(goodIssues).toHaveLength(0);
	});
});
