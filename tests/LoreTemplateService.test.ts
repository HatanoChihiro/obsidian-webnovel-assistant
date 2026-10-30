import { describe, it, expect } from 'vitest';
import {
	parseLoreTemplate,
	stripLeadingYamlFrontmatter,
	sanitizeLoreHeadings,
	isBuiltInFieldOrHeading,
	normalizeLoreTemplatePath,
	normalizeLoreTemplateHistory,
	rememberLoreTemplatePath,
	removeLoreTemplatePath,
	MAX_LORE_TEMPLATE_HISTORY,
} from '../src/services/LoreTemplateService';

describe('LoreTemplateService', () => {
	describe('stripLeadingYamlFrontmatter', () => {
		it('should strip valid YAML frontmatter', () => {
			const md = '---\ntitle: Fictional Hero\ncategory: Character\n---\n# Real Title\nBody text';
			expect(stripLeadingYamlFrontmatter(md)).toBe('# Real Title\nBody text');
		});

		it('should strip frontmatter closed with ...', () => {
			const md = '---\nauthor: Fictional Author\n...\n## Section\nContent';
			expect(stripLeadingYamlFrontmatter(md)).toBe('## Section\nContent');
		});

		it('should leave markdown without frontmatter untouched', () => {
			const md = '# Title\nJust text';
			expect(stripLeadingYamlFrontmatter(md)).toBe('# Title\nJust text');
		});
	});

	describe('sanitizeLoreHeadings', () => {
		it('should upgrade H1 and H2 outside fences to H3+ to prevent splitting lore entries', () => {
			const text = '# Main Header\nBody\n## Sub Header\nMore text';
			const sanitized = sanitizeLoreHeadings(text);
			expect(sanitized).toBe('### Main Header\nBody\n#### Sub Header\nMore text');
		});

		it('should preserve code blocks with backticks or tildes intact', () => {
			const text = '```python\n# Python comment\n## Another comment\n```\n# Header Outside';
			const sanitized = sanitizeLoreHeadings(text);
			expect(sanitized).toContain('# Python comment');
			expect(sanitized).toContain('## Another comment');
			expect(sanitized).toContain('### Header Outside');
		});
	});

	describe('isBuiltInFieldOrHeading', () => {
		it('should match built-in keys case-insensitively across en, zh-CN, and zh-TW', () => {
			const builtIns = [
				'Alias', 'alias', 'ALIASES', 'aliases',
				'别名', '別名',
				'Type', 'type', '类型', '類型',
				'Relation', 'relation', 'Relations', 'relations',
				'关系', '關係',
				'关系：', 'Relation:', '别名:'
			];
			for (const b of builtIns) {
				expect(isBuiltInFieldOrHeading(b)).toBe(true);
			}
		});

		it('should not match custom non-built-in keywords', () => {
			expect(isBuiltInFieldOrHeading('宗门关系')).toBe(false);
			expect(isBuiltInFieldOrHeading('武学类型')).toBe(false);
			expect(isBuiltInFieldOrHeading('Age')).toBe(false);
			expect(isBuiltInFieldOrHeading('身份')).toBe(false);
		});
	});

	describe('parseLoreTemplate & render', () => {
		it('should strip sole leading H1 wrapper but preserve multiple H1 sections as custom sections', () => {
			const soleH1Md = '# Fictional Hero Sheet\n### Stats\n**Power**: 9000';
			const parsed1 = parseLoreTemplate(soleH1Md);
			expect(parsed1.fields.map(f => f.label)).toEqual(['Power']);
			const rendered1 = parsed1.render({ 'tpl-field-0': '9500' });
			expect(rendered1).not.toContain('# Fictional Hero Sheet');
			expect(rendered1).toContain('### Stats');
			expect(rendered1).toContain('**Power**: 9500');

			const multiH1Md = '# Arc One\n**Hero**: Lin\n# Arc Two\n**Villain**: Mo';
			const parsed2 = parseLoreTemplate(multiH1Md);
			expect(parsed2.fields.map(f => f.label)).toEqual(['Hero', 'Villain']);
			const rendered2 = parsed2.render({});
			// Normalized to H3+ (minLevel 1 -> 3)
			expect(rendered2).toContain('### Arc One');
			expect(rendered2).toContain('### Arc Two');
			expect(rendered2).not.toMatch(/^# (?!##)/m);
			expect(rendered2).not.toMatch(/^## (?!#)/m);
		});

		it('should normalize custom template headings into H3+ preserving hierarchy', () => {
			const md = '## Fictional Realm\n### Territory\n#### Capital\n**Population**: 50000';
			const parsed = parseLoreTemplate(md);
			// minLevel is 2, so offset is +1: H2 -> H3, H3 -> H4, H4 -> H5
			const rendered = parsed.render({});
			expect(rendered).toContain('### Fictional Realm');
			expect(rendered).toContain('#### Territory');
			expect(rendered).toContain('##### Capital');
			expect(rendered).toContain('**Population**: 50000');
			expect(rendered).not.toMatch(/^##\s+/m);
		});

		it('should handle repeated labels with distinct IDs and allow independent values', () => {
			const md = '**Item**: Wooden Staff\n**Item**: Healing Salve';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields).toHaveLength(2);
			expect(parsed.fields[0].id).not.toBe(parsed.fields[1].id);
			expect(parsed.fields[0].defaultValue).toBe('Wooden Staff');
			expect(parsed.fields[1].defaultValue).toBe('Healing Salve');

			const rendered = parsed.render({
				[parsed.fields[0].id]: 'Magic Wand',
				[parsed.fields[1].id]: 'Elixir of Life',
			});
			expect(rendered).toContain('**Item**: Magic Wand');
			expect(rendered).toContain('**Item**: Elixir of Life');
		});

		it('should exclude built-ins case-insensitively and exclude reserved heading sections with nested lines', () => {
			const md = `
### Profile
**Age**: 22
**别名**: Little Dragon
**type**: Immortal
### 关系
- 师徒: [[Ancient Master]]
- 宿敌: [[Shadow Demon]]
#### 子关系
- 盟友: [[Iron Guard]]
### Sect Affiliation
青云门
`;
			const parsed = parseLoreTemplate(md);
			const labels = parsed.fields.map(f => f.label);
			expect(labels).toContain('Age');
			expect(labels).not.toContain('别名');
			expect(labels).not.toContain('type');
			expect(labels).not.toContain('关系');
			expect(labels).not.toContain('师徒');
			expect(labels).not.toContain('宿敌');
			expect(labels).not.toContain('子关系');
			expect(labels).not.toContain('盟友');
			expect(labels).toContain('Sect Affiliation');

			const rendered = parsed.render({});
			expect(rendered).toContain('**Age**: 22');
			expect(rendered).not.toContain('Little Dragon');
			expect(rendered).not.toContain('Ancient Master');
			expect(rendered).not.toContain('Shadow Demon');
			expect(rendered).toContain('### Sect Affiliation');
			expect(rendered).toContain('青云门');
		});

		it('should ignore field/heading-looking content inside code fences and ignore URLs and wikilinks', () => {
			const md = `
\`\`\`markdown
# Mock Heading Inside Fence
**FakeField**: fake value
\`\`\`
https://example.com/fiction/123
[[TargetLore#Section: Sub]]
**RealField**: true value
`;
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields).toHaveLength(1);
			expect(parsed.fields[0].label).toBe('RealField');
			expect(parsed.fields[0].defaultValue).toBe('true value');

			const rendered = parsed.render({});
			expect(rendered).toContain('```markdown');
			expect(rendered).toContain('# Mock Heading Inside Fence');
			expect(rendered).toContain('https://example.com/fiction/123');
			expect(rendered).toContain('**RealField**: true value');
		});

		it('should support empty, default, and multiline fields without executing scripts', () => {
			const md = `
**Weapon**:
**Armor**: Mithril Vest
**Script**: <% tp.file.title %>
### Background
Born during a winter storm.
Trained under the Northern Frost.
`;
			const parsed = parseLoreTemplate(md);
			const weaponField = parsed.fields.find(f => f.label === 'Weapon')!;
			expect(weaponField.defaultValue).toBe('');
			expect(weaponField.isMultiline).toBe(false);

			const bgField = parsed.fields.find(f => f.label === 'Background')!;
			expect(bgField.defaultValue).toBe('Born during a winter storm.\nTrained under the Northern Frost.');
			expect(bgField.isMultiline).toBe(true);

			const scriptField = parsed.fields.find(f => f.label === 'Script')!;
			expect(scriptField.defaultValue).toBe('<% tp.file.title %>');

			const rendered = parsed.render({
				[weaponField.id]: 'Frostblade',
				[bgField.id]: 'Re-written backstory.\nTwo paragraphs long.',
			});

			expect(rendered).toContain('**Weapon**: Frostblade');
			expect(rendered).toContain('**Armor**: Mithril Vest');
			expect(rendered).toContain('Re-written backstory.\nTwo paragraphs long.');
			expect(rendered).toContain('**Script**: <% tp.file.title %>');
		});

		it('should preserve static text inside sections with colon fields', () => {
			const md = `
### Attributes
> Note: please fill truthfully.
**Strength**: 10
**Agility**: 15
(End of attributes section)
`;
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields.map(f => f.label)).toEqual(['Strength', 'Agility']);
			const rendered = parsed.render({
				[parsed.fields[0].id]: '12',
			});
			expect(rendered).toContain('> Note: please fill truthfully.');
			expect(rendered).toContain('**Strength**: 12');
			expect(rendered).toContain('**Agility**: 15');
			expect(rendered).toContain('(End of attributes section)');
		});

		it('should sanitize H1/H2 inserted inside textarea field values so lore is not split', () => {
			const md = '### Section One\nDefault text';
			const parsed = parseLoreTemplate(md);
			const field = parsed.fields[0];

			const rendered = parsed.render({
				[field.id]: '# Injected H1\nSome text\n## Injected H2\nOther text\n```\n# Fence safe\n```',
			});

			expect(rendered).toContain('### Injected H1');
			expect(rendered).toContain('#### Injected H2');
			expect(rendered).toContain('# Fence safe');
			expect(rendered).not.toMatch(/^# Injected/m);
			expect(rendered).not.toMatch(/^## Injected/m);
		});

		it('Regression A: should track exact fence character and length >= opener to avoid closing on inner markers', () => {
			const md = '~~~~md\n~~~\n## Not a field\n**Age**: example\n~~~~\n## Appearance\nSilver coat';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields.map(f => f.label)).toEqual(['Appearance']);
			const rendered = parsed.render({});
			expect(rendered).toContain('### Appearance');
			expect(rendered).not.toMatch(/^## Appearance/m);
			expect(rendered).not.toMatch(/^### Not a field/m);
		});

		it('Regression B1: should parse indented ATX headings (0-3 spaces) and normalize them properly', () => {
			const md = '   ## Appearance\nSilver coat';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields.map(f => f.label)).toEqual(['Appearance']);
			const rendered = parsed.render({});
			expect(rendered).toContain('### Appearance');
			expect(rendered).not.toMatch(/^[ ]{0,3}## Appearance/m);
		});

		it('Regression B2: should support optional trailing closing hashes and strip surrounding emphasis on reserved headings', () => {
			const md = '## **Alias**\n- other name\n### 關係 ###\n- target: [[A]]\n## Real Section\nReal value';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields.map(f => f.label)).toEqual(['Real Section']);
			const rendered = parsed.render({});
			expect(rendered).toContain('### Real Section');
			expect(rendered).not.toContain('Alias');
			expect(rendered).not.toContain('關係');
		});

		it('Regression B3: should strip leading BOM before frontmatter and reject invalid closing delimiter occupying partial line', () => {
			const bomMd = '\uFEFF---\nprivate: value\n---\n# Template\n## Appearance\nSilver coat';
			const parsedBom = parseLoreTemplate(bomMd);
			expect(parsedBom.fields.map(f => f.label)).toEqual(['Appearance']);

			const invalidClosingMd = '---\ntitle: test\n---oops not end of frontmatter\ncontent';
			const stripped = stripLeadingYamlFrontmatter(invalidClosingMd);
			expect(stripped).toBe(invalidClosingMd);
		});

		it('Regression B4: sole leading H1 wrapper must be actually leading and not strip H1 after substantive content', () => {
			const md = 'Substantive intro paragraph.\n# Not A Wrapper Title\n## Section\nContent';
			const parsed = parseLoreTemplate(md);
			const rendered = parsed.render({});
			expect(rendered).toContain('Not A Wrapper Title');
		});

		it('Regression C: should ignore URL schemes (mailto, tel, arbitrary schemes) while keeping valid field lines', () => {
			const md = 'mailto: writer@example.invalid\ntel: +123456789\ncustom-scheme://test\n**ValidField**: 123';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields.map(f => f.label)).toEqual(['ValidField']);
		});

		it('Regression D1: should capture continuation lines as multiline field defaultValue and replace cleanly', () => {
			const md = ' **Identity**:\nFirst line\nSecond line\n**Age**: 20';
			const parsed = parseLoreTemplate(md);
			const identityField = parsed.fields.find(f => f.label === 'Identity')!;
			expect(identityField).toBeDefined();
			expect(identityField.defaultValue).toBe('First line\nSecond line');
			expect(identityField.isMultiline).toBe(true);

			const rendered = parsed.render({ [identityField.id]: 'Replaced line 1\nReplaced line 2' });
			expect(rendered).toContain('Replaced line 1\nReplaced line 2');
			expect(rendered).not.toContain('First line');
			expect(rendered).toContain('**Age**: 20');
		});

		it('Regression D2: should bound unclosed code fences and not collapse blank lines inside code', () => {
			const md = '```python\n\n\ndef foo():\n\n\n    pass\n```\n~~~markdown\nUnclosed code block';
			const parsed = parseLoreTemplate(md);
			const rendered = parsed.render({});
			expect(rendered).toContain('\n\n\ndef foo():\n\n\n    pass');
			// Final output must close or bound the unclosed fence
			expect(rendered).toMatch(/~~~\s*$/);
		});

		it('Regression D3: should sanitize setext H1/H2 underlines outside code so they cannot split lore entries', () => {
			const text = 'Setext Title\n---\nAnother Title\n===\n```\nInside Fence\n---\n```';
			const sanitized = sanitizeLoreHeadings(text);
			expect(sanitized).not.toMatch(/^Setext Title\r?\n---[ \t]*$/m);
			expect(sanitized).not.toMatch(/^Another Title\r?\n===[ \t]*$/m);
			expect(sanitized).toContain('Inside Fence\n---');
		});

		it('Regression E1: should parse English labels without spaces after colon and keep non-URI colon fields', () => {
			const md = 'Age:20\nIdentity:Scholar\nAge: 21\n身份：学者';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields).toHaveLength(4);
			expect(parsed.fields[0].label).toBe('Age');
			expect(parsed.fields[0].defaultValue).toBe('20');
			expect(parsed.fields[1].label).toBe('Identity');
			expect(parsed.fields[1].defaultValue).toBe('Scholar');
			expect(parsed.fields[2].label).toBe('Age');
			expect(parsed.fields[2].defaultValue).toBe('21');
			expect(parsed.fields[3].label).toBe('身份');
			expect(parsed.fields[3].defaultValue).toBe('学者');
		});

		it('Regression E2: should treat empty inline built-in relation header as reserved relation block', () => {
			const md = '关系：\n**Friend**：[[Example]]\n## Appearance\nSilver coat';
			const parsed = parseLoreTemplate(md);
			expect(parsed.fields).toHaveLength(1);
			expect(parsed.fields[0].label).toBe('Appearance');
			expect(parsed.fields[0].defaultValue).toBe('Silver coat');
			const labels = parsed.fields.map(f => f.label);
			expect(labels).not.toContain('Friend');
			expect(labels).not.toContain('关系');
		});
	});

	describe('loreTemplateHistory helpers (normalize, remember, remove)', () => {
		describe('normalizeLoreTemplatePath', () => {
			it('should accept valid vault-relative markdown paths and normalize slashes', () => {
				expect(normalizeLoreTemplatePath('Templates/Character.md')).toBe('Templates/Character.md');
				expect(normalizeLoreTemplatePath('Templates\\Sub//Lore.md')).toBe('Templates/Sub/Lore.md');
				expect(normalizeLoreTemplatePath('设定/角色模板.MD')).toBe('设定/角色模板.MD');
				expect(normalizeLoreTemplatePath('  Lore/Hero.md  ')).toBe('Lore/Hero.md');
			});

			it('should reject absolute, drive letter, URI, dot traversal, and non-markdown paths', () => {
				expect(normalizeLoreTemplatePath('/Templates/Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('\\Templates\\Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('C:/Templates/Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('D:\\Templates\\Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('file:///Templates/Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('mailto:Example.md')).toBeNull();
				expect(normalizeLoreTemplatePath('obsidian://open?vault=test')).toBeNull();
				expect(normalizeLoreTemplatePath('../Templates/Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('Templates/../Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('./Hero.md')).toBeNull();
				expect(normalizeLoreTemplatePath('Templates/Hero.txt')).toBeNull();
				expect(normalizeLoreTemplatePath('Templates/Hero')).toBeNull();
				expect(normalizeLoreTemplatePath('')).toBeNull();
				expect(normalizeLoreTemplatePath('   ')).toBeNull();
				expect(normalizeLoreTemplatePath(123)).toBeNull();
				expect(normalizeLoreTemplatePath(null)).toBeNull();
				expect(normalizeLoreTemplatePath(undefined)).toBeNull();
			});
		});

		describe('normalizeLoreTemplateHistory', () => {
			it('should return empty array for non-array or invalid input', () => {
				expect(normalizeLoreTemplateHistory(null)).toEqual([]);
				expect(normalizeLoreTemplateHistory(undefined)).toEqual([]);
				expect(normalizeLoreTemplateHistory('invalid')).toEqual([]);
				expect(normalizeLoreTemplateHistory({})).toEqual([]);
			});

			it('should filter invalid paths, deduplicate exact matches, and cap at limit', () => {
				const raw = [
					'Templates/A.md',
					'C:/Invalid.md',
					123,
					'Templates//A.md', // duplicate when normalized
					'../Escape.md',
					'Templates/B.md',
					'设定/角色.md',
				];
				expect(normalizeLoreTemplateHistory(raw)).toEqual([
					'Templates/A.md',
					'Templates/B.md',
					'设定/角色.md',
				]);
			});

			it('should enforce MAX_LORE_TEMPLATE_HISTORY cap of 10 items', () => {
				expect(MAX_LORE_TEMPLATE_HISTORY).toBe(10);
				const many = Array.from({ length: 15 }, (_, i) => `Templates/Tpl${i}.md`);
				const result = normalizeLoreTemplateHistory(many);
				expect(result.length).toBe(10);
				expect(result[0]).toBe('Templates/Tpl0.md');
				expect(result[9]).toBe('Templates/Tpl9.md');
			});
		});

		describe('rememberLoreTemplatePath', () => {
			it('should prepend a new valid path to the front', () => {
				const current = ['Templates/B.md', 'Templates/C.md'];
				const updated = rememberLoreTemplatePath(current, 'Templates/A.md');
				expect(updated).toEqual(['Templates/A.md', 'Templates/B.md', 'Templates/C.md']);
			});

			it('should move an existing path to front (MRU) without duplicates', () => {
				const current = ['Templates/A.md', 'Templates/B.md', 'Templates/C.md'];
				const updated = rememberLoreTemplatePath(current, 'Templates/B.md');
				expect(updated).toEqual(['Templates/B.md', 'Templates/A.md', 'Templates/C.md']);
			});

			it('should cap at 10 items dropping the oldest at the tail', () => {
				const current = Array.from({ length: 10 }, (_, i) => `Templates/Tpl${i}.md`);
				const updated = rememberLoreTemplatePath(current, 'Templates/New.md');
				expect(updated.length).toBe(10);
				expect(updated[0]).toBe('Templates/New.md');
				expect(updated[1]).toBe('Templates/Tpl0.md');
				expect(updated).not.toContain('Templates/Tpl9.md');
			});

			it('should return normalized current history if path is invalid', () => {
				const current = ['Templates/A.md'];
				expect(rememberLoreTemplatePath(current, 'C:/Invalid.md')).toEqual(['Templates/A.md']);
				expect(rememberLoreTemplatePath(current, null)).toEqual(['Templates/A.md']);
			});
		});

		describe('removeLoreTemplatePath', () => {
			it('should remove the exact normalized path from history', () => {
				const current = ['Templates/A.md', 'Templates/B.md', 'Templates/C.md'];
				const updated = removeLoreTemplatePath(current, 'Templates\\B.md');
				expect(updated).toEqual(['Templates/A.md', 'Templates/C.md']);
			});

			it('should leave history unchanged if path does not exist or is invalid', () => {
				const current = ['Templates/A.md', 'Templates/B.md'];
				expect(removeLoreTemplatePath(current, 'Templates/NotFound.md')).toEqual(current);
				expect(removeLoreTemplatePath(current, '../Invalid.md')).toEqual(current);
			});
		});
	});
});
