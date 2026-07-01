import type { WorkspaceLeaf} from 'obsidian';
import { ItemView, MarkdownView, TFile } from 'obsidian';
import { formatTime, formatCount, isMobile } from '../utils';
import { HistoryStatsModal, calcStreak, calcFocusRate, calcActiveHours, calcDailyAverage } from './HistoryModal';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { findBookRoot } from '../utils/path';
import { TaskManager } from '../services/TaskManager';
import { t } from '../i18n';

export const STATUS_VIEW_TYPE = 'writing-status-view';

export class WritingStatusView extends ItemView {
	plugin: WebNovelAssistantPlugin;

	goalWordEl!: HTMLElement;
	todayWordEl!: HTMLElement;
	percentEl!: HTMLElement;
	progressFillEl!: HTMLElement;
		taskWordEl!: HTMLElement;
		taskTargetEl!: HTMLElement;
		taskPercentEl!: HTMLElement;
		taskProgressFillEl!: HTMLElement;
		taskSectionEls!: HTMLElement[];
		chapterSectionEls!: HTMLElement[];
		taskTimeDescEl!: HTMLElement;
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
	workNameEl!: HTMLElement;
	workWordCountEl!: HTMLElement;
	workGoalEl!: HTMLElement;

	private lastActiveFolderPath: string | null = null;
	private taskSaveTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return STATUS_VIEW_TYPE;
	}

	getDisplayText() {
		return t('view.status');
	}

	getIcon() {
		return "bar-chart-2";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('wn-status-view-container');

		this.createWorkInfoCard(container);
		this.createGoalCard(container);
		this.createTimeCard(container);
		this.createHistoryCard(container);

		void this.updateData();
		this.renderMiniChart();
	}

	private createWorkInfoCard(container: Element) {
		const card = container.createDiv({ cls: 'wn-status-card wn-work-info-card' });
		const row = card.createDiv({ cls: 'wn-work-info-row' });
		this.workNameEl = row.createSpan({ cls: 'wn-work-info-name', text: '--' });
		this.workWordCountEl = row.createSpan({ cls: 'wn-work-info-count', text: '' });
		this.workGoalEl = card.createDiv({ cls: 'work-info-goal' });
		this.workGoalEl.addClass('webnovel-work-goal'); this.workGoalEl.hide();
	}

	private createGoalCard(container: Element) {
		const goalCard = container.createDiv({ cls: 'wn-status-card' });
		const titleRow = goalCard.createDiv({ cls: 'wn-status-title' });
		titleRow.createSpan({ text: t('common.today-status') });

		if (!isMobile()) {
			this.statusBadgeEl = titleRow.createSpan({ cls: 'wn-status-title-badge', text: t('status.paused') });
			this.statusBadgeEl.addClass('wn-clickable');
			this.statusBadgeEl.title = t('common.click-to-toggle-status');
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
		dailyLabelRow.createSpan({ cls: 'status-goal-label', text: t('common.today-goal') });
		this.dailyPercentEl = dailyLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const dailyRow = goalCard.createDiv({ cls: 'goal-display-row-right' });
		this.dailyWordEl = dailyRow.createSpan({ cls: 'goal-current', text: '0' });
		dailyRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.dailyGoalEl = dailyRow.createSpan({ cls: 'goal-target', text: '0' });
		const dailyProgressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.dailyProgressFillEl = dailyProgressBg.createDiv({ cls: 'progress-bar-fill' });

		// 章节目标：小标题 + 百分比居右同行
		const chapterLabelRow = goalCard.createDiv({ cls: 'status-goal-row' });
		chapterLabelRow.createSpan({ cls: 'status-goal-label', text: t('common.chapter-goal') });
		this.percentEl = chapterLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const goalRow = goalCard.createDiv({ cls: 'goal-display-row-right' });
		this.todayWordEl = goalRow.createSpan({ cls: 'goal-current', text: '0' });
		goalRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.goalWordEl = goalRow.createSpan({ cls: 'goal-target', text: '0' });
		const progressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.progressFillEl = progressBg.createDiv({ cls: 'progress-bar-fill' });

		this.chapterSectionEls = [chapterLabelRow, goalRow, progressBg];

		// 任务目标
		const taskLabelRow = goalCard.createDiv({ cls: 'status-goal-row task-goal-section' });
		taskLabelRow.hide();
		taskLabelRow.createSpan({ cls: 'status-goal-label', text: t('common.task-goal') });
		this.taskPercentEl = taskLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const taskRow = goalCard.createDiv({ cls: 'goal-display-row-right task-goal-section' });
		taskRow.hide();
		this.taskWordEl = taskRow.createSpan({ cls: 'goal-current', text: '0' });
		taskRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.taskTargetEl = taskRow.createSpan({ cls: 'goal-target', text: '0' });
		const taskProgressBg = goalCard.createDiv({ cls: 'progress-bar-bg task-goal-section' });
		taskProgressBg.hide();
		this.taskProgressFillEl = taskProgressBg.createDiv({ cls: 'progress-bar-fill' });

		const taskTimeDesc = goalCard.createDiv({ cls: 'task-time-desc task-goal-section' });
		taskTimeDesc.hide();
		this.taskTimeDescEl = taskTimeDesc;

		this.taskSectionEls = [taskLabelRow, taskRow, taskProgressBg, taskTimeDesc];
	}

	private createTimeCard(container: Element) {
		if (isMobile()) return;

		const timeCard = container.createDiv({ cls: 'wn-status-card' });
		timeCard.createDiv({ cls: 'wn-status-title', text: t('common.focus-timing') });
		const totalBox = timeCard.createDiv({ cls: 'time-box time-box-total' });
		totalBox.createDiv({ cls: 'time-box-title', text: t('common.total-elapsed') });
		this.totalTimeEl = totalBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const timeGrid = timeCard.createDiv({ cls: 'time-grid' });

		const focusBox = timeGrid.createDiv({ cls: 'time-box' });
		focusBox.createDiv({ cls: 'time-box-title', text: t('common.focus-duration') });
		this.focusTimeEl = focusBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const slackBox = timeGrid.createDiv({ cls: 'time-box' });
		slackBox.createDiv({ cls: 'time-box-title', text: t('common.slack-duration') });
		this.slackTimeEl = slackBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });
	}

	private createHistoryCard(container: Element) {
		const historyCard = container.createDiv({ cls: 'wn-status-card' });
		historyCard.createDiv({ cls: 'wn-status-title', text: t('common.word-count') });

		const historyGrid = historyCard.createDiv({ cls: 'time-grid' });

		const weekBox = historyGrid.createDiv({ cls: 'time-box' });
		weekBox.createDiv({ cls: 'time-box-title', text: t('common.weekly-net') });
		this.weekWordEl = weekBox.createDiv({ cls: 'time-box-value', text: '0' });

		const monthBox = historyGrid.createDiv({ cls: 'time-box' });
		monthBox.createDiv({ cls: 'time-box-title', text: t('common.monthly-net') });
		this.monthWordEl = monthBox.createDiv({ cls: 'time-box-value', text: '0' });

		const yearBox = historyGrid.createDiv({ cls: 'time-box' });
		yearBox.createDiv({ cls: 'time-box-title', text: t('common.yearly-net') });
		this.yearWordEl = yearBox.createDiv({ cls: 'time-box-value', text: '0' });

		const histTotalBox = historyGrid.createDiv({ cls: 'time-box' });
		histTotalBox.createDiv({ cls: 'time-box-title', text: t('common.total-accumulated') });
		this.historyTotalWordEl = histTotalBox.createDiv({ cls: 'time-box-value', text: '0' });

		// 近7日迷你柱状图
		const chartSection = historyCard.createDiv({ cls: 'history-chart' });

		const chartTitleRow = chartSection.createDiv({ cls: 'history-chart-title-row' });
		chartTitleRow.createSpan({ text: t('common.recent-7days-writing'), cls: 'history-chart-title' });
		const chartLink = chartTitleRow.createSpan({ text: t('common.details'), cls: 'history-chart-subtitle' });
		chartLink.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin).open();
		};

		this.miniChartEl = chartSection.createDiv({ cls: 'mini-chart-container' });
		this.miniChartEl.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin).open();
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
		fillEl.setCssProps({ width: `${width}%` });
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

	async updateData() {
		// 更新作品信息
		const activeFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file
			?? this.app.workspace.getActiveFile();

		if (activeFile && !this.plugin.isEligibleForWordCount(activeFile)) {
			this.workNameEl.innerText = '--';
			this.workWordCountEl.innerText = '';
			this.workGoalEl.hide();
		} else {
			let folderPath = '';
		let folderName = '--';
		
		if (activeFile && activeFile.parent) {
			this.lastActiveFolderPath = activeFile.parent.path;
			folderPath = activeFile.parent.path;
			folderName = activeFile.parent.isRoot() ? t('common.root-directory') : activeFile.parent.name;
		} else if (this.lastActiveFolderPath) {
			folderPath = this.lastActiveFolderPath;
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder) folderName = folder.name;
		}

		if (folderPath) {
			const wordCount = this.plugin.cacheManager.getFolderWordCount(folderPath);
			this.workNameEl.innerText = folderName;
			this.workWordCountEl.innerText = wordCount > 0 ? `${wordCount.toLocaleString()}${t('common.word-char')}` : '';

			const infoFile = this.plugin.homepageManager?.findNovelInfoFile(folderPath);
			let wordGoal = 0;
			if (infoFile instanceof TFile) {
				const content = await this.app.vault.cachedRead(infoFile);
				const match = content.match(/(?:目标字数|Word Goal)[^\d\n\r]*?(\d+)/);
				if (match) {
					wordGoal = parseInt(match[1], 10);
				}
			}
			if (wordGoal > 0) {
				const pct = Math.round((wordCount / wordGoal) * 100);
				this.workGoalEl.empty();
				this.workGoalEl.createSpan({ text: t('common.total-progress') });
				const pctSpan = this.workGoalEl.createSpan({ text: `${pct}%` });
				pctSpan.addClass('webnovel-pct-bold-mono');
				this.workGoalEl.show();
			} else {
				this.workGoalEl.hide();
			}
		}
		}

		if (!isMobile() && this.statusBadgeEl) {
			if (this.plugin.isTracking) {
				this.statusBadgeEl.innerText = t('status.recording');
				this.statusBadgeEl.removeClass('wn-bg-muted'); 
			} else {
				this.statusBadgeEl.innerText = t('status.paused');
				this.statusBadgeEl.addClass('wn-bg-muted'); 
			}
		}

		const coreStats = this.plugin.statisticsManager.getCoreStats();

		this.dailyWordEl.innerText = coreStats.dailyWords.toLocaleString();
		this.dailyGoalEl.innerText = coreStats.dailyGoal.toLocaleString();

		let dailyPercent = 0;
		if (coreStats.rawDailyWords < 0) {
			dailyPercent = coreStats.dailyGoal > 0 ? Math.round((coreStats.rawDailyWords / coreStats.dailyGoal) * 100) : 0;
		} else {
			dailyPercent = coreStats.dailyPercent;
		}
		this.dailyPercentEl.innerText = ` ${dailyPercent}%`;

		const dailyDone = coreStats.dailyGoal > 0 && coreStats.rawDailyWords >= coreStats.dailyGoal;
		const dailyState = coreStats.rawDailyWords < 0 ? 'negative' : dailyDone ? 'done' : 'normal';
		this.setProgressState(this.dailyProgressFillEl, this.dailyWordEl, this.dailyPercentEl, dailyState, Math.max(0, dailyPercent));

		this.todayWordEl.innerText = coreStats.todayWords.toLocaleString();
		this.goalWordEl.innerText = coreStats.goal.toLocaleString();

		this.percentEl.innerText = ` ${coreStats.percent}%`;

		const chapterDone = coreStats.goal > 0 && coreStats.todayWords >= coreStats.goal;
		const chapterState = chapterDone ? 'done' : 'normal';
		this.setProgressState(this.progressFillEl, this.todayWordEl, null, chapterState, coreStats.percent);

		// 任务目标进度：基于目录判断，无活跃 MarkdownView 时使用上次文件夹
		let taskFolder = '';
		const taskFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (taskFile) {
			taskFolder = findBookRoot(this.plugin.app, this.plugin, taskFile) || '';
			this.plugin.lastTaskFolder = taskFolder;
		} else if (this.plugin.lastTaskFolder) {
			taskFolder = this.plugin.lastTaskFolder;
		}

		let hasActiveTask = false;
		if (taskFolder && this.plugin.taskManager) {
			const manager = new TaskManager(this.plugin.app, this.plugin, taskFolder);
			const taskFile = manager.getTaskFile();
			if (taskFile) {
				const taskContent = await this.plugin.app.vault.cachedRead(taskFile);
				const entries = manager.parseEntries(taskContent);
				const active = manager.getActiveTask(entries);
				if (active) {
					hasActiveTask = true;
					const progress = manager.calcProgress(active);
					const taskPercent = active.wordTarget > 0 ? Math.min(Math.round((progress / active.wordTarget) * 100), 100) : 0;
					this.taskWordEl.innerText = progress.toLocaleString();
					this.taskTargetEl.innerText = active.wordTarget.toLocaleString();
					this.taskPercentEl.innerText = ` ${taskPercent}%`;
					const taskDone = active.wordTarget > 0 && progress >= active.wordTarget;
					const taskState = taskDone ? 'done' : 'normal';
					const daysLeft = Math.max(0, window.moment(active.endDate).diff(window.moment().startOf('day'), 'days') + 1);
					const endShort = active.endDate.substring(5);
					this.taskTimeDescEl.setText(taskDone ? t('common.task-deadline-reached', { date: endShort }) : t('common.task-deadline-remaining', { date: endShort, days: String(daysLeft) }));
					this.taskTimeDescEl.toggleClass('task-reached', taskDone);
					this.setProgressState(this.taskProgressFillEl, this.taskWordEl, this.taskPercentEl, taskState, taskPercent);

					// 防抖持久化完成字数
					if (this.taskSaveTimer) window.clearTimeout(this.taskSaveTimer);
					this.taskSaveTimer = window.setTimeout(() => {
						void manager.updateProgress(active.period, progress);
					}, 5000);
				}
			}
		}
		if (this.taskSectionEls) {
			for (const el of this.taskSectionEls) {
				if (hasActiveTask) { el.show(); } else { el.hide(); }
			}
		}

		if (!isMobile()) {
			const focusSec = Math.round(this.plugin.focusMs / 1000);
			const slackSec = Math.round(this.plugin.slackMs / 1000);
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
			this.miniChartEl.createDiv({ text: t('common.no-data'), cls: 'mini-chart-empty' });
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
			bar.setCssProps({ height: `${heightPercent}%` });

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
			bar.setAttribute('title', `${date}\n${t('modal.metric-words')}: ${words}\n${t('modal.metric-focus-time')}: ${focusH.toFixed(1)}h`);

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
			t('common.consecutive-days', { count: streak }),
			t('common.focus-percent', { rate: focusRate }),
			activeHours ? t('common.active-hours', { hours: activeHours }) : '',
			t('common.daily-average', { count: formatCount(dailyAvg) }),
		].filter(Boolean);

		this.efficiencySummaryEl.setText(parts.join(' · '));
	}

	async onClose() {
		if (this.taskSaveTimer) window.clearTimeout(this.taskSaveTimer);
		await super.onClose();
	}
}