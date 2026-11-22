import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import moment from 'moment';
import * as obsidianMock from 'obsidian';
import { MockElement } from './mocks/MockElement';
import { DailyStatsModal, bindDailyStatsTrigger } from '../src/ui/DailyStatsModal';
import { HistoryStatsModal, type HistoryStatsModalPlugin } from '../src/ui/HistoryModal';
import { StatisticsManager } from '../src/services/StatisticsManager';
import type { DailyStat } from '../src/types/settings';

function findAllByClass(root: MockElement, cls: string): MockElement[] {
	const results: MockElement[] = [];
	const walk = (node: MockElement) => {
		if (node.hasClass(cls)) results.push(node);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return results;
}

describe('DailyStatsModal and HistoryStatsModal daily details integration', () => {
	let historyData: Record<string, DailyStat>;
	let statsManager: StatisticsManager;
	let mockPlugin: HistoryStatsModalPlugin;

	afterEach(() => vi.restoreAllMocks());

	beforeEach(() => {
		(MockElement.prototype as unknown as { scrollTo?: () => void }).scrollTo = () => {};
		(globalThis as unknown as { window: { moment: typeof moment; requestAnimationFrame: (cb: () => void) => void } }).window = {
			moment,
			requestAnimationFrame: () => {}
		};

		historyData = {};
		const basePlugin = {
			settings: {
				heatmapStartDate: '2026-06-15',
				heatmapEndDate: '2026-06-21',
				defaultGoal: 3000,
				dailyGoal: 500
			},
			historyManager: {
				getHistory: vi.fn(() => historyData),
				getWordRevision: vi.fn(() => 1)
			},
			saveSettings: vi.fn().mockResolvedValue(undefined)
		};
		statsManager = new StatisticsManager(basePlugin as never);
		mockPlugin = {
			...basePlugin,
			statisticsManager: statsManager
		};
	});

	it('renders 6 metric cards in 2-column/3-row row-major order and reads fresh history on open', () => {
		const hourlyFocus = new Array<number>(24).fill(0);
		hourlyFocus[20] = 3600000;
		historyData['2026-06-20'] = {
			focusMs: 3600000,
			slackMs: 1800000,
			addedWords: 1500,
			hourlyFocus
		};

		const modal = new DailyStatsModal({} as never, mockPlugin, '2026-06-20');
		modal.modalEl = new MockElement() as never;
		modal.contentEl = new MockElement() as never;

		// Mutate history after modal creation to verify fresh read on open
		historyData['2026-06-20'] = {
			focusMs: 7200000,
			slackMs: 1800000,
			addedWords: 2500,
			hourlyFocus
		};

		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const headingInfo = findAllByClass(root, 'wn-daily-stats-heading-info');
		expect(headingInfo).toHaveLength(1);
		expect(headingInfo[0].hasClass('setting-item-info')).toBe(true);
		const cards = findAllByClass(root, 'wn-daily-stats-card');
		expect(cards).toHaveLength(6);

		const values = cards.map(card => findAllByClass(card, 'wn-daily-stats-value')[0]?.textContent);
		expect(values[0]).not.toBe('--'); // active period
		expect(values[1]).toBe('2h 30m'); // total duration (7200000 + 1800000)
		expect(values[2]).toBe('2h 0m');  // focus duration
		expect(values[3]).toBe('30m');    // slack duration
		expect(values[4]).toBe((2500).toLocaleString()); // added words
		expect(values[5]).toContain('1,000'); // 2500 / 2.5h = 1000 w/h
	});

	it('navigates days with fresh data and blocks moving past today even if the click handler is invoked', () => {
		vi.spyOn(moment, 'now').mockReturnValue(new Date(2026, 2, 1, 12).getTime());
		historyData['2026-03-01'] = { focusMs: 1800000, slackMs: 0, addedWords: 100 };
		const modal = new DailyStatsModal({} as never, mockPlugin, '2026-03-01');
		modal.contentEl = new MockElement() as never;
		modal.onOpen();
		const root = modal.contentEl as unknown as MockElement;
		const prev = findAllByClass(root, 'wn-daily-stats-prev')[0];
		const next = findAllByClass(root, 'wn-daily-stats-next')[0];
		const date = findAllByClass(root, 'wn-daily-stats-date')[0];
		const nextButton = next as unknown as HTMLButtonElement;
		const words = () => findAllByClass(root, 'wn-daily-stats-value')[4]?.textContent;
		expect(date?.textContent).toBe('2026-03-01');
		expect(nextButton.disabled).toBe(true);
		expect(words()).toBe('100');
		next.click();
		expect(date.textContent).toBe('2026-03-01');
		expect(words()).toBe('100');

		prev.click();
		expect(date.textContent).toBe('2026-02-28');
		expect(nextButton.disabled).toBe(false);
		expect(words()).toBe('0');
		historyData['2026-03-01'].addedWords = 900;
		next.click();
		expect(date.textContent).toBe('2026-03-01');
		expect(words()).toBe('900');
		expect(nextButton.disabled).toBe(true);
		expect(findAllByClass(root, 'wn-daily-stats-card')).toHaveLength(6);
		expect(prev.getAttribute('aria-label')).toBeTruthy();
		expect(next.getAttribute('aria-label')).toBeTruthy();
		expect(prev.getAttribute('title')).toBeNull();
		expect(next.getAttribute('title')).toBeNull();
	});

	it.each([
		['2025-12-31', '2026-01-01'],
		['2024-02-28', '2024-02-29'],
		['2024-02-29', '2024-03-01']
	])('moves across calendar boundary %s → %s and back', (from, to) => {
		vi.spyOn(moment, 'now').mockReturnValue(new Date(2026, 2, 1, 12).getTime());
		const modal = new DailyStatsModal({} as never, mockPlugin, from);
		modal.contentEl = new MockElement() as never;
		modal.onOpen();
		const root = modal.contentEl as unknown as MockElement;
		const next = findAllByClass(root, 'wn-daily-stats-next')[0];
		const prev = findAllByClass(root, 'wn-daily-stats-prev')[0];
		const date = findAllByClass(root, 'wn-daily-stats-date')[0];
		next.click();
		expect(date.textContent).toBe(to);
		prev.click();
		expect(date.textContent).toBe(from);
	});

	it('handles missing data, negative words, missing hourlyFocus, zero duration, and nonzero duration with zero words', () => {
		historyData['2026-06-18'] = { focusMs: 1800000, slackMs: 1800000, addedWords: -300 };
		historyData['2026-06-19'] = { focusMs: 0, slackMs: 0, addedWords: 100 };
		historyData['2026-06-20'] = { focusMs: 1800000, slackMs: 0, addedWords: 0 };
		historyData['2026-06-21'] = { focusMs: 15000, slackMs: 0, addedWords: 250 };

		const openAndGetValues = (date: string) => {
			const modal = new DailyStatsModal({} as never, mockPlugin, date);
			modal.modalEl = new MockElement() as never;
			modal.contentEl = new MockElement() as never;
			modal.onOpen();
			const root = modal.contentEl as unknown as MockElement;
			return findAllByClass(root, 'wn-daily-stats-card')
				.map(card => findAllByClass(card, 'wn-daily-stats-value')[0]?.textContent);
		};

		// Missing date
		const missingVals = openAndGetValues('2026-06-15');
		expect(missingVals).toEqual(['--', '0m', '0m', '0m', '0', '--']);

		// Negative words without hourlyFocus
		const negVals = openAndGetValues('2026-06-18');
		expect(negVals[0]).toBe('--');
		expect(negVals[4]).toBe('-300');
		expect(negVals[5]).toContain('-300');

		// Zero duration -> zero speed
		const zeroDurVals = openAndGetValues('2026-06-19');
		expect(zeroDurVals[5]).toMatch(/^0\s+/);

		// Sub-minute duration displays 0m -> zero speed, even with added words
		const shortDurVals = openAndGetValues('2026-06-21');
		expect(shortDurVals.slice(1, 5)).toEqual(['0m', '0m', '0m', '250']);
		expect(shortDurVals[5]).toMatch(/^0\s+/);

		// Nonzero duration with 0 words -> 0 speed
		const zeroWordVals = openAndGetValues('2026-06-20');
		expect(zeroWordVals[5]).toMatch(/^0\s+/);
	});

	it('wires HistoryStatsModal heatmap and day-tab bars only, excluding future dates and non-day tabs', () => {
		const pastDate = moment().subtract(2, 'days').format('YYYY-MM-DD');
		const emptyPastDate = moment().subtract(3, 'days').format('YYYY-MM-DD');
		const futureDate = moment().add(2, 'days').format('YYYY-MM-DD');

		mockPlugin.settings.heatmapStartDate = moment().subtract(5, 'days').format('YYYY-MM-DD');
		mockPlugin.settings.heatmapEndDate = moment().add(5, 'days').format('YYYY-MM-DD');
		historyData[pastDate] = { focusMs: 1800000, slackMs: 0, addedWords: 600 };
		historyData[futureDate] = { focusMs: 1800000, slackMs: 0, addedWords: 300 };

		const modal = new HistoryStatsModal({} as never, mockPlugin);
		modal.modalEl = new MockElement() as never;
		const contentEl = new MockElement();
		(contentEl as unknown as { ownerDocument: unknown }).ownerDocument = {
			body: { classList: { contains: () => false } }
		};
		modal.contentEl = contentEl as never;
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;

		// Heatmap: past cells (with & without data) are triggers; future cells are not
		const heatCells = findAllByClass(root, 'wn-stats-heatmap-cell');
		const interactiveHeat = heatCells.filter(c => c.hasClass('wn-daily-stats-trigger'));
		const futureHeat = heatCells.filter(c => c.hasClass('wn-stats-heatmap-future'));
		expect(interactiveHeat.length).toBeGreaterThan(0);
		expect(futureHeat.length).toBeGreaterThan(0);
		for (const cell of futureHeat) {
			expect(cell.hasClass('wn-daily-stats-trigger')).toBe(false);
			expect(cell.getAttribute('role')).toBeNull();
			expect(cell.getAttribute('tabindex')).toBeNull();
		}

		// Verify no HTML title on interactive heatmap cells and saved future date is never interactive
		for (const cell of interactiveHeat) {
			expect(cell.getAttribute('title')).toBeNull();
			expect(cell.getAttribute('role')).toBe('button');
			expect(cell.getAttribute('tabindex')).toBe('0');
			expect(cell.getAttribute('aria-label') || '').not.toContain(futureDate);
		}

		// Day tab bars: columns are triggers, bars have no overlapping title
		const dayCols = findAllByClass(root, 'wn-stats-large-col');
		expect(dayCols.length).toBeGreaterThan(0);
		const targetCol = dayCols.find(c => (c.getAttribute('aria-label') || '').includes(pastDate));
		const emptyCol = dayCols.find(c => (c.getAttribute('aria-label') || '').includes(emptyPastDate));
		expect(targetCol).toBeDefined();
		expect(emptyCol).toBeDefined();
		expect(targetCol!.getAttribute('role')).toBe('button');
		expect(targetCol!.getAttribute('tabindex')).toBe('0');
		expect(findAllByClass(targetCol!, 'wn-stats-large-bar')[0]?.getAttribute('title')).toBeNull();

		// Keyboard Enter & Space on day bar column (Space calls preventDefault)
		const openSpy = vi.spyOn(DailyStatsModal.prototype, 'open').mockImplementation(() => {});
		targetCol!.dispatchEvent('click', { stopPropagation: vi.fn() });
		expect(openSpy).toHaveBeenCalledTimes(1);

		const enterEvt = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
		targetCol!.dispatchEvent('keydown', enterEvt);
		expect(enterEvt.preventDefault).toHaveBeenCalledOnce();
		expect(openSpy).toHaveBeenCalledTimes(2);

		const spaceEvt = { key: ' ', preventDefault: vi.fn(), stopPropagation: vi.fn() };
		targetCol!.dispatchEvent('keydown', spaceEvt);
		expect(spaceEvt.preventDefault).toHaveBeenCalledOnce();
		expect(openSpy).toHaveBeenCalledTimes(3);

		openSpy.mockRestore();

		// Verify click on future heatmap cell does not have trigger
		expect(futureHeat.some(c => (c.getAttribute('aria-label') || '').includes(futureDate))).toBe(false);

		// Switch to week/month/year tabs -> columns must NOT be interactive daily triggers
		for (const tab of ['week', 'month', 'year'] as const) {
			modal.currentTab = tab;
			modal.renderData();
			const aggCols = findAllByClass(modal.chartContainer as unknown as MockElement, 'wn-stats-large-col');
			for (const col of aggCols) {
				expect(col.hasClass('wn-daily-stats-trigger')).toBe(false);
				expect(col.getAttribute('role')).toBeNull();
			}
		}
	});

	it('sets final aria-label via single setTooltip call with wn-tooltip-left and localized action/date', () => {
		const el = new MockElement();
		el.setAttribute('title', 'stale-title');
		const tooltipSpy = vi.spyOn(obsidianMock, 'setTooltip');

		bindDailyStatsTrigger(el as unknown as HTMLElement, {
			app: {} as never,
			plugin: mockPlugin,
			date: '2026-06-21',
			details: 'Words: 500'
		});

		expect(el.getAttribute('title')).toBeNull();
		expect(tooltipSpy).toHaveBeenCalledOnce();
		expect(tooltipSpy).toHaveBeenCalledWith(
			el,
			expect.stringContaining('2026-06-21'),
			{ classes: ['wn-tooltip-left'] }
		);
		const finalAria = el.getAttribute('aria-label') || '';
		expect(finalAria).toContain('2026-06-21');
		expect(finalAria).toContain('Words: 500');

		tooltipSpy.mockRestore();
	});
});
