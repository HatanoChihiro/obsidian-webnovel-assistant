import { App, Modal } from 'obsidian';
import { DailyStat } from '../types/settings';
import { formatCount } from '../utils/format';

// 热力图等级 → CSS 类名
export const HEAT_LEVELS = [
	{ min: 0, cls: 'heat-0' },
	{ min: 1, cls: 'heat-1' },
	{ min: 1000, cls: 'heat-2' },
	{ min: 3000, cls: 'heat-3' },
];

export function getHeatClass(words: number): string {
	if (words < 0) return "heat-negative";
if (words === 0) return HEAT_LEVELS[0].cls;
	for (let i = HEAT_LEVELS.length - 1; i >= 0; i--) {
		if (words >= HEAT_LEVELS[i].min) return HEAT_LEVELS[i].cls;
	}
	return HEAT_LEVELS[0].cls;
}

function formatDuration(ms: number): string {
	const totalMinutes = Math.floor(ms / 60000);
	if (totalMinutes === 0) return '0m';
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function calcStreak(history: Record<string, DailyStat>): number {
let streak = 0;
const today = window.moment().format("YYYY-MM-DD");
// Start from yesterday; add today if already written
let date = window.moment().subtract(1, "day").format("YYYY-MM-DD");
while (true) {
const stat = history[date];
if (stat && stat.addedWords !== 0) {
streak++;
date = window.moment(date).subtract(1, "day").format("YYYY-MM-DD");
} else break;
}
const todayStat = history[today];
if (todayStat && todayStat.addedWords !== 0) streak++;
return streak;
}

export function calcFocusRate(history: Record<string, DailyStat>, startDate: string, endDate: string): number {
	let totalFocus = 0, totalSlack = 0;
	for (const [date, stat] of Object.entries(history)) {
		if (date >= startDate && date <= endDate) {
			totalFocus += stat.focusMs || 0;
			totalSlack += stat.slackMs || 0;
		}
	}
	return totalFocus + totalSlack > 0 ? Math.round(totalFocus / (totalFocus + totalSlack) * 100) : 0;
}

export function calcActiveHours(history: Record<string, DailyStat>, startDate: string, endDate: string): string {
		const hourlyTotals = new Array(24).fill(0);
		for (const [date, stat] of Object.entries(history)) {
			if (date >= startDate && date <= endDate && stat.hourlyFocus) {
				for (let h = 0; h < 24; h++) {
					hourlyTotals[h] += stat.hourlyFocus[h] || 0;
				}
			}
		}
		const ranked = hourlyTotals.map((v, i) => ({ hour: i, total: v }))
			.filter(x => x.total > 0)
			.sort((a, b) => b.total - a.total);

		if (ranked.length === 0) return '';

		// Expand from peak hour to adjacent active hours
		let lo = ranked[0].hour;
		let hi = ranked[0].hour;
		for (let i = 1; i < ranked.length; i++) {
			if (ranked[i].hour === lo - 1) lo = ranked[i].hour;
			else if (ranked[i].hour === hi + 1) hi = ranked[i].hour;
			else break;
		}
		return `${lo}-${hi + 1}\u65F6`;
	}

export function calcDailyAverage(history: Record<string, DailyStat>, startDate: string, endDate: string): number {
	let totalWords = 0, daysWithData = 0;
	for (const [date, stat] of Object.entries(history)) {
		if (date >= startDate && date <= endDate) {
			totalWords += stat.addedWords || 0;
			daysWithData++;
		}
	}
	return daysWithData > 0 ? Math.round(totalWords / daysWithData) : 0;
}

function getCurrentKey(tab: string): string {
	const now = window.moment();
	if (tab === 'day') return now.format('YYYY-MM-DD');
	if (tab === 'week') return `${now.isoWeekYear()}年W${String(now.isoWeek()).padStart(2, '0')}`;
	if (tab === 'month') return now.format('YYYY-MM');
	if (tab === 'year') return now.format('YYYY');
	return '';
}

import type { WebNovelAssistantPlugin } from '../types/plugin';

export class HistoryStatsModal extends Modal {
	plugin: WebNovelAssistantPlugin;
	get history() { return this.plugin.historyManager.getHistory(); }
	currentTab: 'day' | 'week' | 'month' | 'year' = 'day';
	currentMetric: 'words' | 'totalTime' | 'focusTime' | 'slackTime' = 'words';
	chartContainer!: HTMLElement;
	scrollWrapper!: HTMLElement;
	heatContainer!: HTMLElement;
	heatDateRowEl!: HTMLElement;
	heatStartInput!: HTMLInputElement;
	heatEndInput!: HTMLInputElement;
	efficiencyContainer!: HTMLElement;
	titleEl!: HTMLElement;
	tabGroupEl!: HTMLElement;
	metricGroupEl!: HTMLElement;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('history-stats-modal');
		this.modalEl.addClass('history-stats-modal-wide');

		this.titleEl = contentEl.createEl('h2', { text: '写作数据追踪' });

		// === 效率总览 ===
		this.efficiencyContainer = contentEl.createDiv({ cls: 'stats-efficiency-row' });
		this.renderEfficiency();

		// === 热力图 ===
		contentEl.createEl('h3', { text: '热力图', cls: 'stats-section-title' });

		this.heatDateRowEl = contentEl.createDiv({ cls: 'stats-heat-date-row' });
		this.heatDateRowEl.createDiv({ cls: 'stats-heat-date-label', text: '起始' });
		const defaultStart = window.moment().clone().startOf('year').format('YYYY-MM-DD');
		const defaultEnd = window.moment().clone().endOf('year').format('YYYY-MM-DD');
		this.heatStartInput = this.heatDateRowEl.createEl('input', {
			type: 'date',
			cls: 'stats-heat-date-input'
		}) as HTMLInputElement;
		this.heatStartInput.value = this.plugin.settings.heatmapStartDate || defaultStart;
		this.heatDateRowEl.createDiv({ cls: 'stats-heat-date-label', text: '结束' });
		this.heatEndInput = this.heatDateRowEl.createEl('input', {
			type: 'date',
			cls: 'stats-heat-date-input'
		}) as HTMLInputElement;
		this.heatEndInput.value = this.plugin.settings.heatmapEndDate || defaultEnd;

		const resetBtn = this.heatDateRowEl.createEl('button', { text: '今年', cls: 'stats-tab-btn' });
		resetBtn.onclick = async () => {
			this.plugin.settings.heatmapStartDate = '';
			this.plugin.settings.heatmapEndDate = '';
			await this.plugin.saveSettings();
			this.plugin.homepageManager?.refreshHomepageViews();
			const now = window.moment();
			this.heatStartInput.value = now.clone().startOf('year').format('YYYY-MM-DD');
			this.heatEndInput.value = now.clone().endOf('year').format('YYYY-MM-DD');
			this.renderHeatmap();
			this.renderEfficiency();
		};

		this.heatStartInput.onchange = async () => {
			const val = this.heatStartInput.value;
			if (val) {
				this.plugin.settings.heatmapStartDate = val;
				this.plugin.settings.heatmapEndDate = window.moment(val).add(1, 'year').format('YYYY-MM-DD');
				this.heatEndInput.value = this.plugin.settings.heatmapEndDate;
			} else {
				this.plugin.settings.heatmapStartDate = '';
				this.plugin.settings.heatmapEndDate = '';
			}
			await this.plugin.saveSettings();
			this.plugin.homepageManager?.refreshHomepageViews();
			this.renderHeatmap();
			this.renderEfficiency();
		};

		this.heatEndInput.onchange = async () => {
			const val = this.heatEndInput.value;
			if (val) {
				this.plugin.settings.heatmapEndDate = val;
				this.plugin.settings.heatmapStartDate = window.moment(val).subtract(1, 'year').format('YYYY-MM-DD');
				this.heatStartInput.value = this.plugin.settings.heatmapStartDate;
			} else {
				this.plugin.settings.heatmapStartDate = '';
				this.plugin.settings.heatmapEndDate = '';
			}
			await this.plugin.saveSettings();
			this.plugin.homepageManager?.refreshHomepageViews();
			this.renderHeatmap();
			this.renderEfficiency();
		};

		this.heatContainer = contentEl.createDiv({ cls: 'stats-heatmap-container' });
		this.renderHeatmap();

		// === 详细统计 ===
		contentEl.createEl('h3', { text: '详细统计', cls: 'stats-section-title' });

		const filterRow = contentEl.createDiv({ cls: "stats-filter-row" });

this.tabGroupEl = filterRow.createDiv({ cls: "stats-time-tabs" });
const tabs = [
{ id: "day", name: "近30日" },
{ id: "week", name: "按周" },
{ id: "month", name: "按月" },
{ id: "year", name: "按年" }
];
tabs.forEach(tab => {
const btn = this.tabGroupEl.createEl("button", { text: tab.name, cls: "stats-tab-btn" });
if (this.currentTab === tab.id) btn.addClass("is-active");
btn.onclick = () => {
this.currentTab = tab.id as any;
this.tabGroupEl.querySelectorAll(".stats-tab-btn").forEach(b => b.removeClass("is-active"));
btn.addClass("is-active");
this.renderData();
};
});

this.metricGroupEl = filterRow.createDiv({ cls: "stats-metric-tabs" });
const metricTabs = [
{ id: "words", name: "字数" },
{ id: "totalTime", name: "总时间" },
{ id: "focusTime", name: "专注" },
{ id: "slackTime", name: "摸鱼" }
];
metricTabs.forEach(tab => {
const btn = this.metricGroupEl.createEl("button", { text: tab.name, cls: "stats-tab-btn" });
if (this.currentMetric === tab.id) btn.addClass("is-active");
btn.onclick = () => {
this.currentMetric = tab.id as any;
this.metricGroupEl.querySelectorAll(".stats-tab-btn").forEach(b => b.removeClass("is-active"));
btn.addClass("is-active");
this.renderData();
};
});
this.scrollWrapper = contentEl.createDiv({ cls: 'stats-chart-scroll-wrapper' });
		this.chartContainer = this.scrollWrapper.createDiv({ cls: 'stats-large-chart-container' });
		this.renderData();

		this.scrollWrapper.addEventListener('wheel', (evt: WheelEvent) => {
			if (evt.shiftKey) return;
			evt.preventDefault();
			this.scrollWrapper.scrollLeft += evt.deltaY;
		}, { passive: false });
	}

	private renderEfficiency(): void {
		this.efficiencyContainer.empty();

		const rangeStart = this.plugin.settings.heatmapStartDate || window.moment().clone().startOf('year').format('YYYY-MM-DD');
		const rangeEnd = this.plugin.settings.heatmapEndDate || window.moment().format('YYYY-MM-DD');

		const streak = calcStreak(this.history);
		const focusRate = calcFocusRate(this.history, rangeStart, rangeEnd);
		const activeHours = calcActiveHours(this.history, rangeStart, rangeEnd);
		const dailyAvg = calcDailyAverage(this.history, rangeStart, rangeEnd);

		let totalWords = 0;
			for (const stat of Object.values(this.history)) { totalWords += stat.addedWords || 0; }

			const metrics = [
				{ label: '连续创作', value: `${streak}天` },
				{ label: '专注效率', value: `${focusRate}%` },
				{ label: '活跃时段', value: activeHours || '--' },
				{ label: '日均字数', value: formatCount(dailyAvg) },
				{ label: '累计字数', value: formatCount(totalWords) },
			];

		metrics.forEach(m => {
			const card = this.efficiencyContainer.createDiv({ cls: 'stats-efficiency-card' });
			card.createDiv({ cls: 'stats-efficiency-label', text: m.label });
			card.createDiv({ cls: 'stats-efficiency-value', text: m.value });
		});
	}

	private renderHeatmap(): void {
		this.heatContainer.empty();

		const now = window.moment();
		const rangeStart = this.plugin.settings.heatmapStartDate
			? window.moment(this.plugin.settings.heatmapStartDate)
			: now.clone().startOf('year');
		const rangeEnd = this.plugin.settings.heatmapEndDate
			? window.moment(this.plugin.settings.heatmapEndDate)
			: now.clone().endOf('year');

		const alignedStart = rangeStart.clone().isoWeekday(1);
		const alignedEnd = rangeEnd.clone().isoWeekday(7);

		const totalWeeks = Math.ceil(alignedEnd.diff(alignedStart, 'days') / 7) + 1;

		// 图例放右上角 — 先清除旧的
		const existingLegend = this.heatDateRowEl.querySelector(".stats-heatmap-legend-inline");
		if (existingLegend) existingLegend.remove();
		const legendRow = this.heatDateRowEl.createDiv({ cls: 'stats-heatmap-legend-inline' });
		// Negative words legend cell
const negCell = legendRow.createDiv({ cls: "stats-heatmap-legend-cell heat-negative" });
negCell.setAttribute("title", "删减/负增长");

HEAT_LEVELS.forEach(level => {
			const cell = legendRow.createDiv({ cls: `stats-heatmap-legend-cell ${level.cls}` });
			const nextLevel = HEAT_LEVELS[HEAT_LEVELS.indexOf(level) + 1];
			if (level.min === 0) {
				cell.setAttribute('title', '0字');
			} else if (nextLevel) {
				cell.setAttribute('title', `${level.min}字 - ${nextLevel.min - 1}字`);
			} else {
				cell.setAttribute('title', `${level.min}字+`);
			}
		});

		// 月份标注行
		const monthRow = this.heatContainer.createDiv({ cls: 'stats-heatmap-months' });
		const totalMonths = rangeEnd.diff(rangeStart, 'months') + 1;
		for (let m = 0; m < totalMonths; m++) {
			const monthStart = rangeStart.clone().add(m, 'months').startOf('month');
			if (monthStart.isAfter(rangeEnd)) continue;
			const w = Math.floor(monthStart.clone().isoWeekday(1).add(7, 'days').diff(alignedStart, 'days') / 7);
			if (w >= 0 && w < totalWeeks) {
				const spacer = monthRow.createDiv({ cls: 'stats-heatmap-month-label' });
				spacer.setText(monthStart.format('MMM'));
				spacer.style.left = `calc(28px + ${w} * (100% - 28px) / ${totalWeeks})`;
			}
		}

		const gridContainer = this.heatContainer.createDiv({ cls: 'stats-heatmap-grid' });
		const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];

		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			const row = gridContainer.createDiv({ cls: 'stats-heatmap-row' });
			const labelEl = row.createDiv({ cls: 'stats-heatmap-day-label' });
			labelEl.setText(dayLabels[dayOfWeek]);

			for (let w = 0; w < totalWeeks; w++) {
				const cellDate = alignedStart.clone().add(w, 'weeks').add(dayOfWeek, 'days');
				const dateStr = cellDate.format('YYYY-MM-DD');
				const stat = this.history[dateStr];

				const cell = row.createDiv({ cls: 'stats-heatmap-cell' });
				cell.setAttribute('title', dateStr);

				if (cellDate.isSame(now, 'day')) {
					cell.addClass('stats-heatmap-today');
				}

				if (stat) {
					const words = stat.addedWords || 0;
					cell.addClass(getHeatClass(words));
					const focusH = (stat.focusMs / 3600000).toFixed(1);
					cell.setAttribute('title', `${dateStr}\n字数: ${words}\n专注: ${focusH}h`);
				} else if (cellDate.isAfter(now, 'day')) {
					cell.addClass('stats-heatmap-future');
				} else {
					cell.addClass('heat-0');
				}
			}
		}

		this.renderEfficiency();
	}

	renderData() {
		this.chartContainer.empty();
		const aggregated = this.aggregateData();
		const keys = Object.keys(aggregated).sort();
		const currentKey = getCurrentKey(this.currentTab);

		let displayKeys = keys;
		if (this.currentTab === 'day') displayKeys = keys.slice(-30);

		if (displayKeys.length === 0) {
			this.chartContainer.createDiv({ text: '暂无数据', cls: 'stats-empty-msg' });
			return;
		}

		const getValue = (data: { words: number, focusMs: number, slackMs: number }) => {
			if (this.currentMetric === 'words') return data.words;
			if (this.currentMetric === 'focusTime') return data.focusMs;
			if (this.currentMetric === 'slackTime') return data.slackMs;
			if (this.currentMetric === 'totalTime') return data.focusMs + data.slackMs;
			return 0;
		};

			this.renderBarChart(displayKeys, aggregated, getValue, currentKey);
		}

	private renderBarChart(
		displayKeys: string[],
		aggregated: Record<string, { words: number, focusMs: number, slackMs: number }>,
		getValue: (data: { words: number, focusMs: number, slackMs: number }) => number,
		currentKey: string
	): void {
		this.chartContainer.addClass('stats-bar-mode');
		
		const maxAbsValue = Math.max(...displayKeys.map(k => Math.abs(getValue(aggregated[k]))), 1);

		displayKeys.forEach((key) => {
			const data = aggregated[key];
			const col = this.chartContainer.createDiv({ cls: 'stats-large-col' });

			const val = getValue(data);
			const heightPercent = Math.max(2, (Math.abs(val) / maxAbsValue) * 100);
			const bar = col.createDiv({ cls: 'stats-large-bar' });
			bar.style.height = `${heightPercent}%`;


			if (val < 0) {
				bar.addClass('bar-negative');
			} else {
				const ratio = val / maxAbsValue;
				if (ratio >= 0.8) bar.addClass('bar-high');
				else if (ratio >= 0.5) bar.addClass('bar-medium');
				else if (ratio >= 0.2) bar.addClass('bar-low');
				else bar.addClass('bar-minimal');
			}

			const totalMs = data.focusMs + data.slackMs;
			bar.setAttribute('title', `时间: ${key}\n总字数: ${data.words.toLocaleString()}\n总计时间: ${formatDuration(totalMs)}\n专注时间: ${formatDuration(data.focusMs)}\n摸鱼时间: ${formatDuration(data.slackMs)}`);

			col.createDiv({ cls: 'stats-large-label', text: this.formatLabel(key, key === currentKey) });

			let displayStr = '';
			if (this.currentMetric === 'words') {
				displayStr = formatCount(val);
			} else {
				displayStr = formatDuration(val);
			}

			const valueEl = col.createDiv({ cls: 'stats-large-value', text: displayStr });
			if (val < 0) {
				valueEl.addClass('bar-negative-text');
			}
		});

		
		this.renderTrendOverlay(displayKeys, aggregated, getValue, maxAbsValue);
		this.scrollToCurrent(displayKeys, currentKey);
	}


				private renderTrendOverlay(
			displayKeys: string[],
			aggregated: Record<string, { words: number, focusMs: number, slackMs: number }>,
			getValue: (data: { words: number, focusMs: number, slackMs: number }) => number,
			maxAbsValue: number
		): void {
			if (displayKeys.length < 2) return;

			// Use requestAnimationFrame to measure actual bar positions after layout
			requestAnimationFrame(() => {
				const container = this.chartContainer;
				const bars = container.querySelectorAll(".stats-large-bar") as NodeListOf<HTMLElement>;
				if (bars.length < 2) return;

				const containerRect = container.getBoundingClientRect();
				const containerH = container.offsetHeight;

const points: { x: number, y: number, val: number }[] = [];
let baseline = 0;
bars.forEach((bar, i) => {
const barRect = bar.getBoundingClientRect();
const x = barRect.left - containerRect.left + barRect.width / 2;
const yShift = barRect.top - containerRect.top + 6;
baseline = barRect.bottom - containerRect.top;
const val = getValue(aggregated[displayKeys[i]]);
points.push({ x, y: yShift, val });
});
// Clamp: trend line must not go below bar baseline
baseline = Math.round(baseline);
points.forEach(p => { p.y = Math.min(p.y, baseline); });
	// If all points clamped to baseline, trend line has no useful shape — skip overlay
	const allClamped = points.every(p => p.y >= baseline - 2);
	if (allClamped) return;

				const totalW = container.scrollWidth;
				const svgW = Math.max(totalW, container.offsetWidth);

				let svg = `<svg class="stats-trend-overlay" viewBox="0 0 ${svgW} ${containerH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="width:${svgW}px;height:${containerH}px">`;

				// Gradient definition
				svg += `<defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">`;
					svg += `<stop offset="0%" stop-color="var(--interactive-accent)" stop-opacity="0.25"/>`;
					svg += `<stop offset="50%" stop-color="var(--interactive-accent)" stop-opacity="0.08"/>`;
					svg += `<stop offset="100%" stop-color="var(--interactive-accent)" stop-opacity="0"/>`;
				svg += `</linearGradient>`;
svg += `<clipPath id="trendClip"><rect x="0" y="0" width="${svgW}" height="${baseline}"/></clipPath>`;
svg += `</defs>`;

// Build smooth curve path (catmull-rom to cubic bezier)
					const curvePath = this.buildSmoothCurvePath(points);
					const bottomY = baseline;
					const fillClose = ` L${points[points.length - 1].x.toFixed(1)},${bottomY} L${points[0].x.toFixed(1)},${bottomY} Z`;
					svg += `<path d="${curvePath}${fillClose}" fill="url(#trendGrad)" clip-path="url(#trendClip)"/>`;

					// Dashed trend curve
					svg += `<path d="${curvePath}" fill="none" stroke="var(--interactive-accent)" stroke-width="1.2" stroke-dasharray="6,4" opacity="0.35" clip-path="url(#trendClip)"/>`;

					svg += "</svg>";

				// Remove previous overlay if exists
				const existing = container.querySelector(".stats-trend-overlay-wrapper");
				if (existing) existing.remove();

				const wrapper = container.createDiv({ cls: "stats-trend-overlay-wrapper" });
				const parser = new DOMParser();
				const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
				const svgEl = svgDoc.documentElement;
				if (svgEl && !(svgEl instanceof HTMLElement && svgEl.querySelector('parsererror'))) {
					wrapper.appendChild(wrapper.doc.importNode(svgEl, true));
				}
			});
		}

		private buildSmoothCurvePath(points: { x: number, y: number }[]): string {
		if (points.length < 2) return '';
		if (points.length === 2) {
			return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
		}

		// Catmull-Rom to Cubic Bezier conversion
		// For each segment i→i+1, compute control points from surrounding points
		const hTension = 0.4;
const vTension = 0.2;
		let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

		for (let i = 0; i < points.length - 1; i++) {
			const p0 = points[Math.max(0, i - 1)];
			const p1 = points[i];
			const p2 = points[i + 1];
			const p3 = points[Math.min(points.length - 1, i + 2)];

			const cp1x = p1.x + (p2.x - p0.x) * hTension;
			const cp1y = p1.y + (p2.y - p0.y) * vTension;
			const cp2x = p2.x - (p3.x - p1.x) * hTension;
			const cp2y = p2.y - (p3.y - p1.y) * vTension;

			path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
		}

		return path;
	}
		private scrollToCurrent(displayKeys: string[], currentKey: string): void {
			const idx = displayKeys.indexOf(currentKey);
			if (idx < 0) return;
			if (idx === 0) return;

			const wrapper = this.scrollWrapper;
			const container = this.chartContainer;
			const cols = container.querySelectorAll(".stats-large-col");
			if (cols[idx]) {
				const colEl = cols[idx] as HTMLElement;
				const scrollTarget = colEl.offsetLeft - wrapper.offsetWidth / 2 + colEl.offsetWidth / 2;
				wrapper.scrollTo({ left: Math.max(0, scrollTarget), behavior: "smooth" });
			}
		}

	aggregateData() {
		const result: Record<string, { words: number, focusMs: number, slackMs: number }> = {};

		// 只聚合 history 中实际存在的数据，不填充空时间段
		for (const [date, stat] of Object.entries(this.history)) {
			const m = window.moment(date);
			let key = date;

			if (this.currentTab === 'day') {
				key = date;
			} else if (this.currentTab === 'week') {
				key = `${m.isoWeekYear()}年W${String(m.isoWeek()).padStart(2, '0')}`;
			} else if (this.currentTab === 'month') {
				key = m.format('YYYY-MM');
			} else if (this.currentTab === 'year') {
				key = m.format('YYYY');
			}

			if (!result[key]) result[key] = { words: 0, focusMs: 0, slackMs: 0 };
			result[key].words += (stat.addedWords || 0);
			result[key].focusMs += (stat.focusMs || 0);
			result[key].slackMs += (stat.slackMs || 0);
		}

		// 仅对日级别标签页补充缺失日期（确保近7日/近30日完整）
		const now = window.moment();
		if (this.currentTab === 'day') {
			const start = now.clone().subtract(29, 'days');
			let d = start.clone();
			while (d.isSameOrBefore(now, 'day')) {
				const key = d.format('YYYY-MM-DD');
				if (!result[key]) result[key] = { words: 0, focusMs: 0, slackMs: 0 };
				d.add(1, 'day');
			}
		}

		return result;
	}

	formatLabel(key: string, isCurrent: boolean): string {
		if (isCurrent) {
		if (this.currentTab === 'day') return '今日';
		if (this.currentTab === 'week') return '本周';
		if (this.currentTab === 'month') return '本月';
		if (this.currentTab === 'year') return '今年';
		}
		if (this.currentTab === 'day') return key.substring(5);
		if (this.currentTab === 'month') return key.substring(2);
		if (this.currentTab === 'week') {
			const match = key.match(/(\d{4})年W(\d+)/);
			return match ? `${match[1].substring(2)}W${match[2]}` : key;
		}
		return key;
	}

	onClose() {
		this.contentEl.empty();
	}
}