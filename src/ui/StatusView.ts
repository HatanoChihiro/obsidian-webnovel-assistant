import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { formatTime, formatCount, parseGoal, isMobile } from '../utils';
import { HistoryStatsModal, calcStreak, calcFocusRate, calcActiveHours, calcDailyAverage } from './HistoryModal';
import type { WebNovelAssistantPlugin } from '../types/plugin';

export const STATUS_VIEW_TYPE = 'writing-status-view';

export class WritingStatusView extends ItemView {
	plugin: WebNovelAssistantPlugin;

	goalWordEl!: HTMLElement;
	todayWordEl!: HTMLElement;
	percentEl!: HTMLElement;
	progressFillEl!: HTMLElement;
	dailyWordEl!: HTMLElement;
	dailyGoalEl!: HTMLElement;
	dailyPercentEl!: HTMLElement;
	dailyProgressFillEl!: HTMLElement;
	focusTimeEl!: HTMLElement;
	slackTimeEl!: HTMLElement;
	totalTimeEl!: HTMLElement;
	miniChartEl!: HTMLElement;
	efficiencySummaryEl!: HTMLElement;
	statusBadgeEl!: HTMLElement;

	weekWordEl!: HTMLElement;
	monthWordEl!: HTMLElement;
	yearWordEl!: HTMLElement;
	historyTotalWordEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return STATUS_VIEW_TYPE;
	}

	getDisplayText() {
		return "写作实时状态";
	}

	getIcon() {
		return "bar-chart-2";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('status-view-container');

		this.createGoalCard(container);
		this.createTimeCard(container);
		this.createHistoryCard(container);

		this.updateData();
		this.renderMiniChart();
	}

	private createGoalCard(container: Element) {
		const goalCard = container.createDiv({ cls: 'status-card' });
		const titleRow = goalCard.createDiv({ cls: 'status-title' });
		titleRow.createSpan({ text: '今日状态' });

		if (!isMobile()) {
			this.statusBadgeEl = titleRow.createSpan({ cls: 'status-title-badge', text: '已暂停' });
			this.statusBadgeEl.style.cursor = 'pointer';
			this.statusBadgeEl.title = '点击开始/暂停统计';
			this.statusBadgeEl.addEventListener('click', () => {
				if (this.plugin.isTracking) {
					this.plugin.stopTracking();
				} else {
					this.plugin.startTracking();
				}
			});
		}

		// 今日目标：小标题 + 百分比居右同行
		const dailyLabelRow = goalCard.createDiv({ cls: 'status-goal-row' });
		dailyLabelRow.createSpan({ cls: 'status-goal-label', text: '今日目标' });
		this.dailyPercentEl = dailyLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const dailyRow = goalCard.createDiv({ cls: 'goal-display-row-right' });
		this.dailyWordEl = dailyRow.createSpan({ cls: 'goal-current', text: '0' });
		dailyRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.dailyGoalEl = dailyRow.createSpan({ cls: 'goal-target', text: '0' });
		const dailyProgressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.dailyProgressFillEl = dailyProgressBg.createDiv({ cls: 'progress-bar-fill' });

		// 章节目标：小标题 + 百分比居右同行
		const chapterLabelRow = goalCard.createDiv({ cls: 'status-goal-row' });
		chapterLabelRow.createSpan({ cls: 'status-goal-label', text: '章节目标' });
		this.percentEl = chapterLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const goalRow = goalCard.createDiv({ cls: 'goal-display-row-right' });
		this.todayWordEl = goalRow.createSpan({ cls: 'goal-current', text: '0' });
		goalRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.goalWordEl = goalRow.createSpan({ cls: 'goal-target', text: '0' });
		const progressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.progressFillEl = progressBg.createDiv({ cls: 'progress-bar-fill' });
	}

	private createTimeCard(container: Element) {
		if (isMobile()) return;

		const timeCard = container.createDiv({ cls: 'status-card' });
		timeCard.createDiv({ cls: 'status-title', text: '专注计时' });

		const totalBox = timeCard.createDiv({ cls: 'time-box time-box-total' });
		totalBox.createDiv({ cls: 'time-box-title', text: '总计耗时' });
		this.totalTimeEl = totalBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const timeGrid = timeCard.createDiv({ cls: 'time-grid' });

		const focusBox = timeGrid.createDiv({ cls: 'time-box' });
		focusBox.createDiv({ cls: 'time-box-title', text: '专注时长' });
		this.focusTimeEl = focusBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const slackBox = timeGrid.createDiv({ cls: 'time-box' });
		slackBox.createDiv({ cls: 'time-box-title', text: '摸鱼时长' });
		this.slackTimeEl = slackBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });
	}

	private createHistoryCard(container: Element) {
		const historyCard = container.createDiv({ cls: 'status-card' });
		historyCard.createDiv({ cls: 'status-title', text: '字数统计' });

		const historyGrid = historyCard.createDiv({ cls: 'time-grid' });

		const weekBox = historyGrid.createDiv({ cls: 'time-box' });
		weekBox.createDiv({ cls: 'time-box-title', text: '本周净增' });
		this.weekWordEl = weekBox.createDiv({ cls: 'time-box-value', text: '0' });

		const monthBox = historyGrid.createDiv({ cls: 'time-box' });
		monthBox.createDiv({ cls: 'time-box-title', text: '本月净增' });
		this.monthWordEl = monthBox.createDiv({ cls: 'time-box-value', text: '0' });

		const yearBox = historyGrid.createDiv({ cls: 'time-box' });
		yearBox.createDiv({ cls: 'time-box-title', text: '今年净增' });
		this.yearWordEl = yearBox.createDiv({ cls: 'time-box-value', text: '0' });

		const histTotalBox = historyGrid.createDiv({ cls: 'time-box' });
		histTotalBox.createDiv({ cls: 'time-box-title', text: '累计总字数' });
		this.historyTotalWordEl = histTotalBox.createDiv({ cls: 'time-box-value', text: '0' });

		// 近7日迷你柱状图
		const chartSection = historyCard.createDiv({ cls: 'history-chart' });

		const chartTitleRow = chartSection.createDiv({ cls: 'history-chart-title-row' });
		chartTitleRow.createSpan({ text: '近7日写作', cls: 'history-chart-title' });
		const chartLink = chartTitleRow.createSpan({ text: '详情', cls: 'history-chart-subtitle' });
		chartLink.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin.historyManager.getHistory()).open();
		};

		this.miniChartEl = chartSection.createDiv({ cls: 'mini-chart-container' });
		this.miniChartEl.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin.historyManager.getHistory()).open();
		};

		this.efficiencySummaryEl = chartSection.createDiv({ cls: 'mini-efficiency-summary', text: '--' });
	}

	private setProgressState(
		fillEl: HTMLElement,
		wordEl: HTMLElement,
		percentEl: HTMLElement | null,
		state: 'normal' | 'negative' | 'done',
		width: number
	): void {
		fillEl.style.width = `${width}%`;
		fillEl.removeClass('is-negative');
		fillEl.removeClass('is-done');
		wordEl.removeClass('is-negative');
		wordEl.removeClass('is-done');
		if (percentEl) {
			percentEl.removeClass('is-negative');
			percentEl.removeClass('is-done');
		}

		if (state === 'negative') {
			fillEl.addClass('is-negative');
			wordEl.addClass('is-negative');
			if (percentEl) percentEl.addClass('is-negative');
		} else if (state === 'done') {
			fillEl.addClass('is-done');
			wordEl.addClass('is-done');
			if (percentEl) percentEl.addClass('is-done');
		}
	}

	updateData() {
		if (!isMobile() && this.statusBadgeEl) {
			if (this.plugin.isTracking) {
				this.statusBadgeEl.innerText = '记录中';
				this.statusBadgeEl.style.background = '';
				this.statusBadgeEl.style.color = '';
			} else {
				this.statusBadgeEl.innerText = '已暂停';
				this.statusBadgeEl.style.background = 'var(--text-muted)';
				this.statusBadgeEl.style.color = '';
			}
		}

		const today = window.moment().format('YYYY-MM-DD');
		const todayStat = this.plugin.historyManager.getDailyStat(today) || { focusMs: 0, slackMs: 0, addedWords: 0 };
		const dailyAdded = todayStat.addedWords;
		const dailyGoal = this.plugin.settings.dailyGoal || 0;

		this.dailyWordEl.innerText = Math.max(0, dailyAdded).toLocaleString();
		this.dailyGoalEl.innerText = dailyGoal.toLocaleString();

		let dailyPercent = 0;
		if (dailyAdded < 0) {
			dailyPercent = dailyGoal > 0 ? Math.round((dailyAdded / dailyGoal) * 100) : 0;
		} else {
			dailyPercent = dailyGoal > 0 ? Math.min(Math.round((dailyAdded / dailyGoal) * 100), 100) : 0;
		}
		this.dailyPercentEl.innerText = ` ${dailyPercent}%`;

		const dailyDone = dailyGoal > 0 && dailyAdded >= dailyGoal;
		const dailyState = dailyAdded < 0 ? 'negative' : dailyDone ? 'done' : 'normal';
		this.setProgressState(this.dailyProgressFillEl, this.dailyWordEl, this.dailyPercentEl, dailyState, Math.max(0, dailyPercent));

		let targetGoal = this.plugin.settings.defaultGoal;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		let chapterWords = 0;
		if (view?.file) {
			const cache = this.plugin.app.metadataCache.getFileCache(view.file);
			const fmGoal = parseGoal(cache?.frontmatter?.['word-goal']);
			if (fmGoal > 0) targetGoal = fmGoal;
			chapterWords = this.plugin.calculateAccurateWords(view.getViewData());
		}

		this.todayWordEl.innerText = chapterWords.toLocaleString();
		this.goalWordEl.innerText = targetGoal.toLocaleString();

		const percent = targetGoal > 0 ? Math.min(Math.round((chapterWords / targetGoal) * 100), 100) : 0;
		this.percentEl.innerText = ` ${percent}%`;

		const chapterDone = targetGoal > 0 && chapterWords >= targetGoal;
		const chapterState = chapterDone ? 'done' : 'normal';
		this.setProgressState(this.progressFillEl, this.todayWordEl, null, chapterState, percent);

		if (!isMobile()) {
			const focusSec = Math.floor(this.plugin.focusMs / 1000);
			const slackSec = Math.floor(this.plugin.slackMs / 1000);
			const totalSec = focusSec + slackSec;

			if (this.focusTimeEl) this.focusTimeEl.innerText = formatTime(focusSec);
			if (this.slackTimeEl) this.slackTimeEl.innerText = formatTime(slackSec);
			if (this.totalTimeEl) this.totalTimeEl.innerText = formatTime(totalSec);
		}

		this.updateWordStats();
	}

	private updateWordStats() {
		let weekWords = 0;
		let monthWords = 0;
		let yearWords = 0;
		let totalWords = 0;

		const now = window.moment();

		for (const [dateStr, stat] of Object.entries(this.plugin.historyManager.getHistory())) {
			const dailyAdded = stat.addedWords || 0;
			totalWords += dailyAdded;

			const dateMoment = window.moment(dateStr);
			if (dateMoment.isSame(now, 'isoWeek')) weekWords += dailyAdded;
			if (dateMoment.isSame(now, 'month')) monthWords += dailyAdded;
			if (dateMoment.isSame(now, 'year')) yearWords += dailyAdded;
		}

		if (this.weekWordEl) this.weekWordEl.innerText = weekWords.toLocaleString();
		if (this.monthWordEl) this.monthWordEl.innerText = monthWords.toLocaleString();
		if (this.yearWordEl) this.yearWordEl.innerText = yearWords.toLocaleString();
		if (this.historyTotalWordEl) this.historyTotalWordEl.innerText = totalWords.toLocaleString();
	}

	private lastHistorySnapshot: string = '';

	renderMiniChart() {
		const history = this.plugin.historyManager.getHistory();
		const dates = Object.keys(history).sort().slice(-7);

		const currentSnapshot = dates.map(d => `${d}:${history[d]?.addedWords ?? 0}`).join('|');
		if (this.lastHistorySnapshot === currentSnapshot) return;
		this.lastHistorySnapshot = currentSnapshot;

		this.miniChartEl.empty();

		if (dates.length === 0) {
			this.miniChartEl.createDiv({ text: '暂无数据', cls: 'mini-chart-empty' });
			this.efficiencySummaryEl.setText('--');
			return;
		}

		const maxAbsValue = Math.max(...dates.map(d => Math.abs(history[d]?.addedWords || 0)), 1);

		dates.forEach(date => {
			const stat = history[date];
			const words = stat?.addedWords || 0;
			const col = this.miniChartEl.createDiv({ cls: 'mini-chart-col' });

			const heightPercent = Math.max(3, (Math.abs(words) / maxAbsValue) * 100);
			const bar = col.createDiv({ cls: 'mini-chart-bar' });
			bar.style.height = `${heightPercent}%`;

			if (words < 0) {
				bar.addClass('bar-negative');
			} else {
				const ratio = words / maxAbsValue;
				if (ratio >= 0.8) bar.addClass('bar-high');
				else if (ratio >= 0.5) bar.addClass('bar-medium');
				else if (ratio >= 0.2) bar.addClass('bar-low');
				else bar.addClass('bar-minimal');
			}

			const focusH = (stat?.focusMs || 0) / 3600000;
			bar.setAttribute('title', `${date}\n字数: ${words}\n专注: ${focusH.toFixed(1)}h`);

			col.createDiv({ cls: 'mini-chart-label', text: date.substring(8) });

			const displayStr = words < 0 ? formatCount(words) : formatCount(words);
			col.createDiv({ cls: 'mini-chart-value', text: displayStr });
		});

		const now = window.moment();
		const endDate = now.format('YYYY-MM-DD');
		const startDate = now.clone().subtract(7, 'days').format('YYYY-MM-DD');
		const streak = calcStreak(history);
		const focusRate = calcFocusRate(history, startDate, endDate);
		const activeHours = calcActiveHours(history, startDate, endDate);
		const dailyAvg = calcDailyAverage(history, startDate, endDate);

		const parts = [
			`连续${streak}天`,
			`专注${focusRate}%`,
			activeHours.length > 0 ? `活跃${activeHours.join('、')}` : '',
			`日均${formatCount(dailyAvg)}`,
		].filter(Boolean);

		this.efficiencySummaryEl.setText(parts.join(' · '));
	}

	async onClose() {}
}