import type { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { formatLoreRelationListItem, formatLoreRelationTarget, loreRelationLinkName, planLoreRelationBlockInsertion, planLoreRelationEdits, rewriteLoreRelationLines, splitLoreRelationTargets } from '../src/services/LoreRelations';
import { buildLoreOutline, scanLoreHeadings } from '../src/services/LoreOutline';

describe('lore relation editing', () => {
	it('uses the full heading identity with a short display alias', () => {
		const lines = ['# 地理', '## 白岬', '### 北境', '###### 码头', '### 南境', '###### 码头'];
		const sections = buildLoreOutline(scanLoreHeadings(lines), lines.length);
		const file = { path: '小说/新书/设定/地理.md' } as TFile;
		const [north, south] = sections.filter(section => section.title === '码头');
		const first = formatLoreRelationTarget({ file, heading: '码头', section: north }, file.path);
		const second = formatLoreRelationTarget({ file, heading: '码头', section: south }, '小说/新书/设定/势力.md');
		expect(first).toBe('[[#地理#白岬#北境#码头|码头]]');
		expect(second).toBe('[[小说/新书/设定/地理#地理#白岬#南境#码头|码头]]');
		expect(loreRelationLinkName(second)).toBe('码头');
		expect(formatLoreRelationListItem('补给', '[[小说/新书/设定/势力#海鸥商会]]')).toBe('- **补给**：[[小说/新书/设定/势力#海鸥商会|海鸥商会]]');
	});

	it('retains old declarations and rewrites only the changed target of a shared line', () => {
		const multi = '- **协作**：[[笔记#甲,一|甲]]、乙';
		const previous = [
			{ label: '贸易', target: '丙', rawTarget: '丙', rawLine: '- **贸易**：丙', sourceLine: 5 },
			{ label: '协作', target: '甲', rawTarget: '[[笔记#甲,一|甲]]', rawLine: multi, sourceLine: 6 },
			{ label: '协作', target: '乙', rawTarget: '乙', rawLine: multi, sourceLine: 6 },
		];
		expect(splitLoreRelationTargets('[[笔记#甲,一|甲]]、乙')).toEqual(['[[笔记#甲,一|甲]]', '乙']);
		const plan = planLoreRelationEdits(previous, [previous[0], previous[1], { ...previous[2], sourceId: 2, label: '支持' }], row => formatLoreRelationListItem(row.label, `[[${row.target}]]`))!;
		expect(plan.inserted).toEqual(['- **支持**：[[乙|乙]]']);
		expect(rewriteLoreRelationLines(previous, plan.kept)).toEqual(new Map([[6, '- **协作**：[[笔记#甲,一|甲]]']]));
	});

	it('adds the H6 block before the next heading and appends later rows to the same block', () => {
		const lines = ['##### 港区', '###### 东码头', '东码头正文', '', '###### 西码头'];
		const [firstRow, secondRow] = ['- **补给**：[[甲]]', '- **运输**：[[乙]]'];
		const east = buildLoreOutline(scanLoreHeadings(lines), lines.length)[1];
		const first = planLoreRelationBlockInsertion(lines, east.bodyEnd, east.relationBlocks, [firstRow]);
		lines.splice(first.line, 0, ...first.lines);
		const updated = buildLoreOutline(scanLoreHeadings(lines), lines.length)[1];
		const second = planLoreRelationBlockInsertion(lines, updated.bodyEnd, updated.relationBlocks, [secondRow]);
		lines.splice(second.line, 0, ...second.lines);
		expect(lines.slice(lines.indexOf('###### 关系'))).toEqual(['###### 关系', firstRow, secondRow, '', '###### 西码头']);
		expect(lines.filter(line => line === '###### 关系')).toHaveLength(1);
	});
});
