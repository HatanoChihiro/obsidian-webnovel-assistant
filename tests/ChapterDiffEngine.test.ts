import { describe, it, expect, vi } from 'vitest';
import { ChapterDiffEngine, isFormattingOnlyRow, type AlignedDiffRow } from '../src/services/ChapterDiffEngine';

if (typeof window === 'undefined') {
	(globalThis as unknown as { window: unknown }).window = globalThis;
}

function expectExactReconstruction(left: string, right: string, rows: AlignedDiffRow[]): void {
	const leftHeader = ChapterDiffEngine.splitFrontmatterAndBody(left).yamlHeader;
	const rightHeader = ChapterDiffEngine.splitFrontmatterAndBody(right).yamlHeader;
	expect(leftHeader + rows.flatMap(r => r.leftLines).join('')).toBe(left);
	expect(rightHeader + rows.flatMap(r => r.rightLines).join('')).toBe(right);
}

describe('ChapterDiffEngine Regressions', () => {
	it('classifies whitespace-only presentation differences without changing the original text or paragraph structure', async () => {
		const left = '　　同一段正文。  \r\n\r\n';
		const right = '同一段正文。\n';
		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.rows.every(isFormattingOnlyRow)).toBe(true);
		expect('reconstructedRawLeft' in result).toBe(false);
		expect('reconstructedRawRight' in result).toBe(false);
		expectExactReconstruction(left, right, result.rows);
		expect(isFormattingOnlyRow({ id: 1, type: 'modified', leftLines: ['他走了。\n'], rightLines: ['他跑了。\n'] })).toBe(false);
		expect(isFormattingOnlyRow({ id: 2, type: 'merge', leftLines: ['第一句。\n', '第二句。'], rightLines: ['第一句。第二句。'] })).toBe(false);
	});

	it('keeps modified paragraphs paired after an unrelated insertion between them', async () => {
		const left = ['清晨，小舟沿着河岸慢慢走向码头。', '午后，山顶的古钟响了三声。', '夜晚，院里的梨花落满石阶。'].join('\n\n');
		const right = ['清晨，小舟沿着河岸快步走向码头。', '信封里夹着一张陌生城市的车票。', '午后，山顶的古钟响了四声。', '夜晚，院里的梨花落满台阶。'].join('\n\n');
		const result = await ChapterDiffEngine.computeDiff(left, right);
		const noon = result.rows.find(row => row.leftLines.join('').includes('古钟'));
		expect(noon?.rightLines.join('')).toContain('古钟');
		expect(result.rows.some(row => row.type === 'added' && row.rightLines.join('').includes('信封'))).toBe(true);
		expectExactReconstruction(left, right, result.rows);
	});

	it('aligns Chinese paragraphs separated by single newlines independently', async () => {
		const left = '阿青推开窗，雨已经停了。\n她把信封放在桌上。\n门外传来轻轻的脚步声。';
		const right = '阿青推开窗，雪已经停了。\n她把信封放在桌边。\n门外传来急促的脚步声。';
		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.rows).toHaveLength(3);
		expect(result.rows.every(row => row.charDiff?.some(change => !change.added && !change.removed))).toBe(true);
		expectExactReconstruction(left, right, result.rows);
	});

	it('keeps common text visible as unchanged when a long paragraph has one small edit', async () => {
		const prefix = '这是两份版本中完全相同的背景文字。'.repeat(100);
		const suffix = '接下来的环境描写也没有发生变化。'.repeat(100);
		const result = await ChapterDiffEngine.computeDiff(prefix + '旧' + suffix, prefix + '新' + suffix, { maxCharsForFineDiff: 50 });
		const edits = result.rows.flatMap(row => row.charDiff ?? []).filter(change => change.added || change.removed);
		expect(edits.map(change => change.value).join('')).toBe('旧新');
		expect(result.rows.some(row => row.exceedsLimit)).toBe(false);
	});

	it('keeps small edits detailed across many changed paragraphs without exhausting the budget on timer waits', async () => {
		const lines = Array.from({ length: 110 }, (_, index) => `第${index}段，相同的窗外景色和桌上摆放的信纸。`);
		const left = lines.map(line => line + '旧。').join('\n');
		const right = lines.map(line => line + '新。').join('\n');
		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.rows).toHaveLength(lines.length);
		expect(result.rows.every(row => row.type === 'modified' && !row.exceedsLimit && row.charDiff !== undefined)).toBe(true);
		expectExactReconstruction(left, right, result.rows);
	});

	it('starts the fine-diff time budget after paragraph alignment has completed', async () => {
		const engine = ChapterDiffEngine as unknown as {
			alignChangedBlock(left: string[], right: string[], cancelled?: () => boolean): Promise<Pick<AlignedDiffRow, 'type' | 'leftLines' | 'rightLines'>[]>;
		};
		const align = engine.alignChangedBlock;
		const now = vi.spyOn(Date, 'now').mockReturnValue(0);
		const alignment = vi.spyOn(engine, 'alignChangedBlock').mockImplementation(async (...args) => {
			const result = await align.apply(ChapterDiffEngine, args);
			now.mockReturnValue(4000);
			return result;
		});
		try {
			const result = await ChapterDiffEngine.computeDiff('他慢慢走向窗边。', '他轻轻走向窗边。');
			expect(result.rows[0].exceedsLimit).toBe(false);
			expect(result.rows[0].charDiff).toBeDefined();
		} finally {
			alignment.mockRestore();
			now.mockRestore();
		}
	});

	it('preserves paragraph alignment when merging also inserts Chinese characters', async () => {
		const left = '她说自己并不着急。\n\n可电梯门刚一打开，她已经走了出去。\n\n他慢了一步才跟上。';
		const right = '她说自己并不着急。可电梯门刚一打开，她已经快步走了出去。\n\n他慢了一步才跟上。';
		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.rows.some(row => row.type === 'merge')).toBe(true);
		expectExactReconstruction(left, right, result.rows);
	});

	it('does not hide an inserted ASCII space inside a structural paragraph change', async () => {
		const left = '他把文件ABC交给了她。';
		const right = '他把文件A BC\n\n交给了她。';
		const result = await ChapterDiffEngine.computeDiff(left, right);
		const edits = result.rows.flatMap(row => row.charDiff ?? []).filter(change => change.added || change.removed);
		expect(edits.some(change => change.value.includes(' '))).toBe(true);
	});

	it('yields before a whole-chapter diff so writing can continue', async () => {
		let eventLoopRan = false;
		const timer = setTimeout(() => { eventLoopRan = true; }, 0);
		try {
			await ChapterDiffEngine.computeDiff('原稿。\n'.repeat(150), '改稿。\n'.repeat(150));
			expect(eventLoopRan).toBe(true);
		} finally {
			clearTimeout(timer);
		}
	});

	it('should reconstruct identical text without changes', async () => {
		const text = '# 第1章 开始\n\n阳光穿过窗棂照在书桌上。\n\n林远端起茶杯，轻轻抿了一口。';
		const result = await ChapterDiffEngine.computeDiff(text, text);

		expect(result.hasDifferences).toBe(false);
		expect(result.rows.length).toBeGreaterThan(0);
		for (const row of result.rows) {
			expect(row.type).toBe('unchanged');
		}
	});

	it('should handle paragraph split (1 -> 2) as structural split instead of full delete and re-add', async () => {
		const left = '阳光穿过窗棂照在书桌上。林远端起茶杯，轻轻抿了一口。';
		const right = '阳光穿过窗棂照在书桌上。\n\n林远端起茶杯，轻轻抿了一口。';

		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.hasDifferences).toBe(true);

		const splitRows = result.rows.filter(r => r.type === 'split');
		expect(splitRows.length).toBe(1);
	});

	it('should handle paragraph merge (2 -> 1) as structural merge', async () => {
		const left = '阳光穿过窗棂照在书桌上。\n\n林远端起茶杯，轻轻抿了一口。';
		const right = '阳光穿过窗棂照在书桌上。林远端起茶杯，轻轻抿了一口。';

		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.hasDifferences).toBe(true);

		const mergeRows = result.rows.filter(r => r.type === 'merge');
		expect(mergeRows.length).toBe(1);
	});

	it('should separate YAML frontmatter from document body', async () => {
		const left = '---\ntitle: 第一章\nstatus: 草稿\n---\n这是正文第一段。';
		const right = '---\ntitle: 第一章\nstatus: 已完成\n---\n这是正文第一段，增加了一句话。';

		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.yamlDiff).toBeDefined();
		expect(result.yamlDiff?.hasDifferences).toBe(true);
		expect(result.rows.length).toBe(1); // 1 row for body
		expect(result.rows[0].type).toBe('modified');
	});

	it('should emit unrelated full rewrites as separate deletion and addition without charDiff', async () => {
		const left = '在一个古老的东方小镇里，生活着一位以打铁为生的老铁匠，他的技艺精湛绝伦。';
		const right = '暴雨倾盆的午夜，银白色的闪电骤然撕裂了浓黑的夜空，狂风呼啸过山谷。';

		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.hasDifferences).toBe(true);
		expect(result.rows.map(row => row.type)).toEqual(['deleted', 'added']);
		expect(result.rows.every(row => row.charDiff === undefined)).toBe(true);
		expectExactReconstruction(left, right, result.rows);
	});

	it('keeps modified paragraphs paired when an unrelated paragraph is deleted between them', async () => {
		const left = ['清晨，小舟沿着河岸慢慢走向码头。', '信封里夹着一张陌生城市的车票。', '午后，山顶的古钟响了三声。', '夜晚，院里的梨花落满石阶。'].join('\n\n');
		const right = ['清晨，小舟沿着河岸快步走向码头。', '午后，山顶的古钟响了四声。', '夜晚，院里的梨花落满台阶。'].join('\n\n');
		const result = await ChapterDiffEngine.computeDiff(left, right);
		const noon = result.rows.find(row => row.leftLines.join('').includes('古钟'));
		expect(noon?.type).toBe('modified');
		expect(noon?.rightLines.join('')).toContain('古钟');
		expect(result.rows.some(row => row.type === 'deleted' && row.leftLines.join('').includes('信封'))).toBe(true);
		expectExactReconstruction(left, right, result.rows);
	});

	it('detects single-LF paragraph split and merge without swallowing unrelated insertions', async () => {
		const splitLeft = '阳光穿过窗棂照在书桌上。林远端起茶杯，轻轻抿了一口。';
		const splitRight = '阳光穿过窗棂照在书桌上。\n林远端起茶杯，轻轻抿了一口。\n窗外忽然掠过一只白鸽。';
		const splitResult = await ChapterDiffEngine.computeDiff(splitLeft, splitRight);
		expect(splitResult.rows.map(row => row.type)).toEqual(['split', 'added']);
		expectExactReconstruction(splitLeft, splitRight, splitResult.rows);

		const mergeLeft = '阳光穿过窗棂照在书桌上。\n林远端起茶杯，轻轻抿了一口。';
		const mergeRight = '阳光穿过窗棂照在书桌上。林远端起茶杯，轻轻抿了一口。';
		const mergeResult = await ChapterDiffEngine.computeDiff(mergeLeft, mergeRight);
		expect(mergeResult.rows.map(row => row.type)).toEqual(['merge']);
		expectExactReconstruction(mergeLeft, mergeRight, mergeResult.rows);
	});

	it('preserves monotone order for duplicated similar paragraphs without false split', async () => {
		const left = '“快走！”他低声说道。\n走廊尽头的灯光忽然熄灭了。\n“快走！”他再次低声说道。';
		const right = '“快走！”他急促地低声说道。\n窗外掠过一道模糊的黑影。\n走廊尽头的灯光忽然闪烁了一下。\n“快走！”他最后一次低声说道。';
		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.rows.map(row => row.type)).toEqual(['modified', 'added', 'modified', 'modified']);
		expect(result.rows[0].rightLines.join('')).toContain('急促');
		expect(result.rows[3].rightLines.join('')).toContain('最后一次');
		expectExactReconstruction(left, right, result.rows);
	});

	it('preserves leading blanks, CRLF, and surrogate-pair emojis across prefix/suffix trimming', async () => {
		const prefix = '同一段绵长的河岸景色描写。'.repeat(20);
		const suffix = '尾声处依然是寂静的夜色。'.repeat(20);
		const left = `\r\n\r\n${prefix}🌍${suffix}\r\n\r\n`;
		const right = `\r\n\r\n${prefix}🌕${suffix}\r\n\r\n`;
		const result = await ChapterDiffEngine.computeDiff(left, right, { maxCharsForFineDiff: 20 });
		const modifiedRow = result.rows.find(row => row.type === 'modified');
		expect(modifiedRow?.exceedsLimit).toBe(false);
		const edits = (modifiedRow?.charDiff ?? []).filter(change => change.added || change.removed);
		expect(edits.map(change => change.value).join('')).toBe('🌍🌕');
		expectExactReconstruction(left, right, result.rows);
	});

	it('falls back to conservative unpaired rows when changed block exceeds alignment bound', async () => {
		const left = Array.from({ length: 210 }, (_, idx) => `左侧第${idx + 1}段旧文内容。`).join('\n');
		const right = Array.from({ length: 210 }, (_, idx) => `右侧第${idx + 1}段完全重写的新增内容。`).join('\n');
		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.rows.some(row => row.type === 'modified')).toBe(false);
		expect(result.rows.filter(row => row.type === 'deleted')).toHaveLength(210);
		expect(result.rows.filter(row => row.type === 'added')).toHaveLength(210);
		expectExactReconstruction(left, right, result.rows);
	});

	it('should preserve CRLF, emoji, and Unicode characters', async () => {
		const left = '你好，世界！🌍\r\n测试标点与换行：——“引用”。';
		const right = '你好，宇宙！🚀\r\n测试标点与换行：——“引用”。';

		const result = await ChapterDiffEngine.computeDiff(left, right);
		expect(result.hasDifferences).toBe(true);
		const row = result.rows[0];
		expect(row.type).toBe('modified');
		expectExactReconstruction(left, right, result.rows);
	});

	it('rejects impossible composite candidates cheaply and avoids quadratic pair/profile scans in large changed blocks', async () => {
		const alphabet = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔';
		const makeParagraph = (seed: number, marker: string) => {
			let s = '';
			for (let k = 0; k < 80; k++) {
				const idx = (seed * 17 + k * 13) % (alphabet.length - 1);
				s += alphabet[idx];
			}
			return `${s.slice(0, 40)}${marker}${s.slice(40)}`;
		};
		const count = 60;
		const left = Array.from({ length: count }, (_, idx) => makeParagraph(idx + 1, '旧')).join('\n\n');
		const right = Array.from({ length: count }, (_, idx) => makeParagraph(idx + 1, '新')).join('\n\n');

		const engine = ChapterDiffEngine as unknown as {
			buildProfile: (...args: unknown[]) => unknown;
			evaluateCompositeMatch: (...args: unknown[]) => unknown;
		};
		const buildSpy = vi.spyOn(engine, 'buildProfile');
		const compositeSpy = vi.spyOn(engine, 'evaluateCompositeMatch');
		try {
			const result = await ChapterDiffEngine.computeDiff(left, right);
			expect(result.rows).toHaveLength(count);
			expect(result.rows.every(r => r.type === 'modified')).toBe(true);
			expectExactReconstruction(left, right, result.rows);
			expect(buildSpy.mock.calls.length).toBeLessThanOrEqual(count * 2);
			expect(compositeSpy.mock.calls.length).toBeLessThanOrEqual(count);
		} finally {
			buildSpy.mockRestore();
			compositeSpy.mockRestore();
		}
	});

	it('cooperatively yields and honors cancellation during profile/similarity preparation before DP finishes', async () => {
		const left = Array.from({ length: 40 }, (_, i) => `第${i}段：${'风吹过山岗与松林，远处钟声回荡。'.repeat(30)}旧`).join('\n');
		const right = Array.from({ length: 40 }, (_, i) => `第${i}段：${'风吹过山岗与松林，远处钟声回荡。'.repeat(30)}新`).join('\n');
		let fakeTime = 1000;
		let yieldsDuringPrep = 0;
		let profilesBuilt = 0;
		let cancelDuringPrep = false;
		const engine = ChapterDiffEngine as unknown as {
			buildProfile: (raw: string) => unknown;
		};
		const origBuildProfile = engine.buildProfile.bind(ChapterDiffEngine);
		const buildSpy = vi.spyOn(engine, 'buildProfile').mockImplementation((raw: string) => {
			profilesBuilt++;
			fakeTime += 2;
			return origBuildProfile(raw);
		});
		const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeTime);
		const origSetTimeout = window.setTimeout;
		const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((cb: TimerHandler) => {
			if (profilesBuilt > 0 && profilesBuilt < 80) {
				yieldsDuringPrep++;
				cancelDuringPrep = true;
			}
			return origSetTimeout(cb, 0);
		}) as typeof window.setTimeout);
		try {
			await expect(
				ChapterDiffEngine.computeDiff(left, right, { isCancelled: () => cancelDuringPrep })
			).rejects.toThrow(/cancelled/i);
			expect(yieldsDuringPrep).toBeGreaterThanOrEqual(1);
			expect(profilesBuilt).toBeLessThan(80);
		} finally {
			timeoutSpy.mockRestore();
			nowSpy.mockRestore();
			buildSpy.mockRestore();
		}
	});

	it('cooperatively yields and honors cancellation while shared-postings population is in progress', async () => {
		const chars = Array.from(
			'天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐'
		);
		const sharedBody = chars
			.flatMap((c1, idx) => chars.slice(0, 8).map((c2, j) => `${c1}${chars[(idx + j + 1) % chars.length]}`))
			.join('');
		const left = Array.from({ length: 4 }, (_, i) => `左${i}：${sharedBody}尾${i}`).join('\n');
		const right = Array.from({ length: 4 }, (_, i) => `右${i}：${sharedBody}末${i}`).join('\n');

		let fakeTime = 1000;
		let profilesBuilt = 0;
		let pairSimCalls = 0;
		let yieldsDuringPostings = 0;
		let cancelDuringPostings = false;

		const engine = ChapterDiffEngine as unknown as {
			buildProfile: (raw: string) => unknown;
			computePairSimilarity: (...args: unknown[]) => number;
		};
		const origBuildProfile = engine.buildProfile.bind(ChapterDiffEngine);
		const origPairSim = engine.computePairSimilarity.bind(ChapterDiffEngine);

		const buildSpy = vi.spyOn(engine, 'buildProfile').mockImplementation((raw: string) => {
			profilesBuilt++;
			return origBuildProfile(raw);
		});
		const pairSimSpy = vi.spyOn(engine, 'computePairSimilarity').mockImplementation((...args: unknown[]) => {
			pairSimCalls++;
			return origPairSim(...args);
		});
		const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
			if (profilesBuilt === 8 && pairSimCalls === 0) {
				fakeTime += 10;
			}
			return fakeTime;
		});
		const origSetTimeout = window.setTimeout;
		const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((cb: TimerHandler) => {
			if (profilesBuilt === 8 && pairSimCalls === 0) {
				yieldsDuringPostings++;
				cancelDuringPostings = true;
			}
			return origSetTimeout(cb, 0);
		}) as typeof window.setTimeout);

		try {
			await expect(
				ChapterDiffEngine.computeDiff(left, right, { isCancelled: () => cancelDuringPostings })
			).rejects.toThrow(/cancelled/i);
			expect(profilesBuilt).toBe(8);
			expect(yieldsDuringPostings).toBeGreaterThanOrEqual(1);
			expect(pairSimCalls).toBe(0);
		} finally {
			timeoutSpy.mockRestore();
			nowSpy.mockRestore();
			pairSimSpy.mockRestore();
			buildSpy.mockRestore();
		}
	});

	it('should abort diff computation when cancellation is signaled', async () => {
		let cancelled = false;
		const promise = ChapterDiffEngine.computeDiff(
			'第一段。\n\n第二段。\n\n第三段。',
			'第一段修改。\n\n第二段修改。\n\n第三段修改。',
			{ isCancelled: () => cancelled }
		);
		cancelled = true;
		await expect(promise).rejects.toThrow(/cancelled/i);
	});

	it('should mark exceedsLimit and avoid expensive charDiff when fine budget is exhausted', async () => {
		const left = '左侧长文本段落内容。'.repeat(100);
		const right = '右侧长文本段落内容。'.repeat(100);
		const result = await ChapterDiffEngine.computeDiff(left, right, { maxCharsForFineDiff: 50 });
		expect(result.rows.some(r => r.exceedsLimit)).toBe(true);
		expect(result.rows.every(r => r.charDiff === undefined || r.charDiff.length === 0)).toBe(true);
	});
});
