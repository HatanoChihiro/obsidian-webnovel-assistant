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
	if (words <= 0) return HEAT_LEVELS[0].cls;
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
	let date = window.moment().format('YYYY-MM-DD');
	while (true) {
		const stat = history[date];
		if (stat && stat.addedWords > 0) {
			streak++;
			date = window.moment(date).subtract(1, 'day').format('YYYY-MM-DD');
		} else break;
	}
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

export function calcActiveHours(history: Record<string, DailyStat>, startDate: string, endDate: string): string[] {
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

	if (ranked.length === 0) return [];

	const ranges: string[] = [];
	let rangeStart = ranked[0].hour;
	let rangeEnd = ranked[0].hour;

	for (let i = 1; i < Math.min(ranked.length, 3); i++) {
		if (ranked[i].hour === rangeEnd + 1 || ranked[i].hour === rangeStart - 1) {
			rangeStart = Math.min(rangeStart, ranked[i].hour);
			rangeEnd = Math.max(rangeEnd, ranked[i].hour);
		} else {
			ranges.push(`${rangeStart}-${rangeEnd + 1}时`);
			rangeStart = ranked[i].hour;
			rangeEnd = ranked[i].hour;
		}
	}
	ranges.push(`${rangeStart}-${rangeEnd + 1}时`);
	return ranges;
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

export class HistoryStatsModal extends Modal {
	history: Record<string, DailyStat>;
	currentTab: '7day' | 'day' | 'week' | 'month' | 'year' = '7day';
	currentMetric: 'words' | 'totalTime' | 'focusTime' | 'slackTime' = 'words';
	heatRange: '3m' | '6m' | '1y' | 'all' = '1y';
	chartType: 'bar' | 'line' = 'bar';
	chartContainer!: HTMLElement;
	heatContainer!: HTMLElement;
	efficiencyContainer!: HTMLElement;
	titleEl!: HTMLElement;
	tabGroupEl!: HTMLElement;
	metricGroupEl!: HTMLElement;
	chartTypeBarBtn!: HTMLElement;
	chartTypeLineBtn!: HTMLElement;

	constructor(app: App, history: Record<string, DailyStat>) {
		super(app);
		this.history = history;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('history-stats-modal');
		this.modalEl.addClass('history-stats-modal-wide');

		this.titleEl = contentEl.createEl('h2', { text: '写作数据' });

		// === 效率总览 ===
		this.efficiencyContainer = contentEl.createDiv({ cls: 'stats-efficiency-row' });
		this.renderEfficiency();

		// === 热力图 ===
		contentEl.createEl('h3', { text: '写作热力图', cls: 'stats-section-title' });

		const heatRangeRow = contentEl.createDiv({ cls: 'stats-heat-range-row' });
		const ranges = [
			{ id: '3m', name: '近3月' },
			{ id: '6m', name: '近6月' },
			{ id: '1y', name: '近1年' },
			{ id: 'all', name: '全部' },
		];
		ranges.forEach(r => {
			const btn = heatRangeRow.createEl('button', { text: r.name, cls: 'stats-tab-btn' });
			if (this.heatRange === r.id) btn.addClass('is-active');
			btn.onclick = () => {
				this.heatRange = r.id as any;
				heatRangeRow.querySelectorAll('.stats-tab-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderHeatmap();
			};
		});

		this.heatContainer = contentEl.createDiv({ cls: 'stats-heatmap-container' });
		this.renderHeatmap();

		// === 详细统计 ===
		contentEl.createEl('h3', { text: '详细统计', cls: 'stats-section-title' });

		this.tabGroupEl = contentEl.createDiv({ cls: 'stats-tab-group' });
		const tabs = [
			{ id: '7day', name: '近7日' },
			{ id: 'day', name: '近30日' },
			{ id: 'week', name: '按周' },
			{ id: 'month', name: '按月' },
			{ id: 'year', name: '按年' }
		];
		tabs.forEach(tab => {
			const btn = this.tabGroupEl.createEl('button', { text: tab.name, cls: 'stats-tab-btn' });
			if (this.currentTab === tab.id) btn.addClass('is-active');
			btn.onclick = () => {
				this.currentTab = tab.id as any;
				this.tabGroupEl.querySelectorAll('.stats-tab-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderData();
			};
		});

		// 指标 + 图表类型切换
		const bottomRow = contentEl.createDiv({ cls: 'stats-tab-group' });
		this.metricGroupEl = bottomRow.createDiv({ cls: 'stats-metric-tabs' });
		const metricTabs = [
			{ id: 'words', name: '字数' },
			{ id: 'totalTime', name: '总时间' },
			{ id: 'focusTime', name: '专注' },
			{ id: 'slackTime', name: '摸鱼' }
		];
		metricTabs.forEach(tab => {
			const btn = this.metricGroupEl.createEl('button', { text: tab.name, cls: 'stats-tab-btn' });
			if (this.currentMetric === tab.id) btn.addClass('is-active');
			btn.onclick = () => {
				this.currentMetric = tab.id as any;
				this.metricGroupEl.querySelectorAll('.stats-tab-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderData();
			};
		});

		const typeGroup = bottomRow.createDiv({ cls: 'stats-chart-type-row' });
		this.chartTypeBarBtn = typeGroup.createEl('button', { text: '柱状图', cls: 'stats-chart-type-btn' });
		this.chartTypeLineBtn = typeGroup.createEl('button', { text: '折线图', cls: 'stats-chart-type-btn' });
		if (this.chartType === 'bar') this.chartTypeBarBtn.addClass('is-active');
		else this.chartTypeLineBtn.addClass('is-active');

		this.chartTypeBarBtn.onclick = () => {
			this.chartType = 'bar';
			this.chartTypeBarBtn.addClass('is-active');
			this.chartTypeLineBtn.removeClass('is-active');
			this.renderData();
		};
		this.chartTypeLineBtn.onclick = () => {
			this.chartType = 'line';
			this.chartTypeLineBtn.addClass('is-active');
			this.chartTypeBarBtn.removeClass('is-active');
			this.renderData();
		};

		this.chartContainer = contentEl.createDiv({ cls: 'stats-large-chart-container' });
		this.renderData();
	}

	private renderEfficiency(): void {
		this.efficiencyContainer.empty();

		const now = window.moment();
		const endDate = now.format('YYYY-MM-DD');
		let startDate: string;

		if (this.heatRange === '3m') startDate = now.clone().subtract(3, 'months').format('YYYY-MM-DD');
		else if (this.heatRange === '6m') startDate = now.clone().subtract(6, 'months').format('YYYY-MM-DD');
		else if (this.heatRange === '1y') startDate = now.clone().subtract(1, 'year').format('YYYY-MM-DD');
		else startDate = '0000-00-00';

		const streak = calcStreak(this.history);
		const focusRate = calcFocusRate(this.history, startDate, endDate);
		const activeHours = calcActiveHours(this.history, startDate, endDate);
		const dailyAvg = calcDailyAverage(this.history, startDate, endDate);

		const metrics = [
			{ label: '连续写作', value: `${streak}天`, icon: '🔥' },
			{ label: '专注效率', value: `${focusRate}%`, icon: '🎯' },
			{ label: '活跃时段', value: activeHours.length > 0 ? activeHours.join('、') : '--', icon: '⏰' },
			{ label: '日均字数', value: formatCount(dailyAvg), icon: '📝' },
		];

		metrics.forEach(m => {
			const card = this.efficiencyContainer.createDiv({ cls: 'stats-efficiency-card' });
			card.createDiv({ cls: 'stats-efficiency-icon', text: m.icon });
			card.createDiv({ cls: 'stats-efficiency-value', text: m.value });
			card.createDiv({ cls: 'stats-efficiency-label', text: m.label });
		});
	}

	private renderHeatmap(): void {
		this.heatContainer.empty();

		const now = window.moment();
		let startMoment: moment.Moment;

		if (this.heatRange === '3m') startMoment = now.clone().subtract(3, 'months');
		else if (this.heatRange === '6m') startMoment = now.clone().subtract(6, 'months');
		else if (this.heatRange === '1y') startMoment = now.clone().subtract(1, 'year');
		else {
			const dates = Object.keys(this.history).sort();
			startMoment = dates.length > 0 ? window.moment(dates[0]) : now.clone().subtract(1, 'year');
		}

		const alignedStart = startMoment.clone().isoWeekday(1);
		const alignedEnd = now.clone().isoWeekday(7);

		const monthRow = this.heatContainer.createDiv({ cls: 'stats-heatmap-months' });
		let lastMonth = -1;
		const totalWeeks = Math.ceil(alignedEnd.diff(alignedStart, 'days') / 7) + 1;

		for (let w = 0; w < totalWeeks; w++) {
			const weekDate = alignedStart.clone().add(w, 'weeks');
			const month = weekDate.month();
			if (month !== lastMonth) {
				const spacer = monthRow.createDiv({ cls: 'stats-heatmap-month-label' });
				spacer.setText(weekDate.format('MMM'));
				spacer.style.marginLeft = `${w * 15}px`;
				lastMonth = month;
			}
		}

		const gridContainer = this.heatContainer.createDiv({ cls: 'stats-heatmap-grid' });
		const dayLabels = ['', '周一', '', '周三', '', '周五', ''];

		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			const row = gridContainer.createDiv({ cls: 'stats-heatmap-row' });
			const labelEl = row.createDiv({ cls: 'stats-heatmap-day-label' });
			labelEl.setText(dayLabels[dayOfWeek]);

			for (let w = 0; w < totalWeeks; w++) {
				const cellDate = alignedStart.clone().add(w, 'weeks').add(dayOfWeek, 'days');
				const dateStr = cellDate.format('YYYY-MM-DD');
				const stat = this.history[dateStr];

				const cell = row.createDiv({ cls: 'stats-heatmap-cell' });

				if (stat) {
					const words = stat.addedWords || 0;
					cell.addClass(getHeatClass(words));
					const focusH = (stat.focusMs / 3600000).toFixed(1);
					cell.setAttribute('title', `${dateStr}\n字数: ${words}\n专注: ${focusH}h`);
				} else {
					cell.addClass('heat-0');
				}

				if (cellDate.isAfter(now, 'day')) {
					cell.addClass('stats-heatmap-future');
				}
			}
		}

		// 颜色说明（用 CSS 类渲染色块）
		const legendRow = this.heatContainer.createDiv({ cls: 'stats-heatmap-legend' });
		legendRow.createSpan({ text: '少', cls: 'stats-heatmap-legend-text' });
		HEAT_LEVELS.forEach(level => {
			legendRow.createDiv({ cls: `stats-heatmap-legend-cell ${level.cls}` });
		});
		legendRow.createSpan({ text: '多', cls: 'stats-heatmap-legend-text' });

		this.renderEfficiency();
	}

	renderData() {
		this.chartContainer.empty();
		const aggregated = this.aggregateData();
		const keys = Object.keys(aggregated).sort();

		let displayKeys = keys;
		if (this.currentTab === '7day') displayKeys = keys.slice(-7);
		if (this.currentTab === 'day') displayKeys = keys.slice(-30);
		if (this.currentTab === 'week') displayKeys = keys.slice(-12);

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

		if (this.chartType === 'bar') {
			this.renderBarChart(displayKeys, aggregated, getValue);
		} else {
			this.renderLineChart(displayKeys, aggregated, getValue);
		}
	}

	private renderBarChart(
		displayKeys: string[],
		aggregated: Record<string, { words: number, focusMs: number, slackMs: number }>,
		getValue: (data: { words: number, focusMs: number, slackMs: number }) => number
	): void {
		this.chartContainer.addClass('stats-bar-mode');
		this.chartContainer.removeClass('stats-line-mode');

		const maxAbsValue = Math.max(...displayKeys.map(k => Math.abs(getValue(aggregated[k]))), 1);

		displayKeys.forEach((key) => {
			const data = aggregated[key];
			const col = this.chartContainer.createDiv({ cls: 'stats-large-col' });

			const val = getValue(data);
			const heightPercent = Math.max(2, (Math.abs(val) / maxAbsValue) * 100);
			const bar = col.createDiv({ cls: 'stats-large-bar' });
			bar.style.height = `${heightPercent}%`;

			// 柱状图颜色用 CSS 类，统一主题色
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

			col.createDiv({ cls: 'stats-large-label', text: this.formatLabel(key) });

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
	}

	private renderLineChart(
		displayKeys: string[],
		aggregated: Record<string, { words: number, focusMs: number, slackMs: number }>,
		getValue: (data: { words: number, focusMs: number, slackMs: number }) => number
	): void {
		this.chartContainer.removeClass('stats-bar-mode');
		this.chartContainer.addClass('stats-line-mode');

		const values = displayKeys.map(k => getValue(aggregated[k]));
		const maxVal = Math.max(...values, 0);
		const minVal = Math.min(...values, 0);

		const svgW = 900;
		const chartH = 140;
		const padTop = 16;
		const padBottom = 28;
		const padLeft = 50;
		const padRight = 16;
		const svgH = chartH + padTop + padBottom;

		const dataRange = maxVal - minVal || 1;
		const yScale = chartH / dataRange;
		const xStep = (svgW - padLeft - padRight) / (displayKeys.length - 1 || 1);

		const yTicks = this.calcYTicks(minVal, maxVal);
		const fmtY = (v: number) => this.currentMetric === 'words' ? formatCount(v) : formatDuration(v);

		let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:var(--font-monospace);">`;

		for (const tick of yTicks) {
			const yy = padTop + chartH - (tick - minVal) * yScale;
			svg += `<line x1="${padLeft}" y1="${yy}" x2="${svgW - padRight}" y2="${yy}" stroke="var(--background-modifier-border)" stroke-dasharray="4,4"/>`;
			svg += `<text x="${padLeft - 6}" y="${yy + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">${fmtY(tick)}</text>`;
		}

		if (minVal < 0 && maxVal > 0) {
			const zy = padTop + chartH - (0 - minVal) * yScale;
			svg += `<line x1="${padLeft}" y1="${zy}" x2="${svgW - padRight}" y2="${zy}" stroke="var(--text-muted)" stroke-width="1"/>`;
		}

		let pts = '';
		displayKeys.forEach((key, i) => {
			const v = getValue(aggregated[key]);
			const x = padLeft + i * xStep;
			const y = padTop + chartH - (v - minVal) * yScale;
			pts += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
		});

		const zeroY = padTop + chartH - (0 - minVal) * yScale;
		const fillPts = pts + `L${padLeft + (displayKeys.length - 1) * xStep},${zeroY} L${padLeft},${zeroY} Z`;

		svg += `<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--interactive-accent)" stop-opacity="0.25"/><stop offset="100%" stop-color="var(--interactive-accent)" stop-opacity="0.02"/></linearGradient></defs>`;
		svg += `<path d="${fillPts}" fill="url(#lg)"/>`;
		svg += `<path d="${pts}" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linejoin="round"/>`;

		displayKeys.forEach((key, i) => {
			const d = aggregated[key];
			const v = getValue(d);
			const x = padLeft + i * xStep;
			const y = padTop + chartH - (v - minVal) * yScale;
			const col = v < 0 ? 'var(--color-red, #ef4444)' : 'var(--interactive-accent)';
			svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${col}" stroke="white" stroke-width="1" style="cursor:crosshair;"><title>${key}\n字数: ${formatCount(d.words)}\n${this.currentMetric === 'words' ? '值: ' + formatCount(v) : '时间: ' + formatDuration(v)}</title></circle>`;
		});

		displayKeys.forEach((key, i) => {
			const x = padLeft + i * xStep;
			svg += `<text x="${x.toFixed(1)}" y="${svgH - 4}" fill="var(--text-muted)" font-size="10" text-anchor="middle">${this.formatLabel(key)}</text>`;
		});

		svg += `</svg>`;
		this.chartContainer.createDiv({ cls: 'stats-line-chart' }).innerHTML = svg;
	}

	private calcYTicks(min: number, max: number): number[] {
		const range = max - min || 1;
		const rawStep = range / 5;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
		let step: number;
		const normalized = rawStep / magnitude;
		if (normalized <= 1) step = magnitude;
		else if (normalized <= 2) step = 2 * magnitude;
		else if (normalized <= 5) step = 5 * magnitude;
		else step = 10 * magnitude;

		if (this.currentMetric !== 'words') {
			const minStepMs = 60000;
			if (step < minStepMs) step = minStepMs;
			if (step < 5 * 60000) step = 5 * 60000;
			else if (step < 15 * 60000) step = 15 * 60000;
			else if (step < 30 * 60000) step = 30 * 60000;
			else if (step < 3600000) step = 3600000;
		} else {
			if (step < 100) step = 100;
			else if (step < 500) step = 500;
			else if (step < 1000) step = 1000;
		}

		const ticks: number[] = [];
		let tick = Math.ceil(min / step) * step;
		while (tick <= max) {
			ticks.push(tick);
			tick += step;
		}
		return ticks;
	}

	aggregateData() {
		const result: Record<string, { words: number, focusMs: number, slackMs: number }> = {};

		for (const [date, stat] of Object.entries(this.history)) {
			const m = window.moment(date);
			let key = date;

			if (this.currentTab === '7day') {
				key = date;
			} else if (this.currentTab === 'week') {
				key = `${m.year()}年 第${m.isoWeek()}周`;
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
		return result;
	}

	formatLabel(key: string): string {
		if (this.currentTab === '7day' || this.currentTab === 'day') return key.substring(5);
		if (this.currentTab === 'month') return key.substring(2);
		if (this.currentTab === 'week') {
			const match = key.match(/第(\d+)周/);
			return match ? `W${match[1]}` : key;
		}
		return key;
	}

	onClose() {
		this.contentEl.empty();
	}
}