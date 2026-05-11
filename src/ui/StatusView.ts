import { ItemView, MarkdownView, WorkspaceLeaf, Platform } from 'obsidian';
import { formatTime, formatCount } from '../utils/format';
import { HistoryStatsModal } from './HistoryModal';
import { isMobile } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { DailyStat } from '../types/settings';

export const STATUS_VIEW_TYPE = 'writing-status-view';

/**
 * 写作实时状态视图
 * 显示今日目标、时间统计、近7日图表等信息
 */
export class WritingStatusView extends ItemView {
	plugin: WebNovelAssistantPlugin;
	
	goalWordEl!: HTMLElement;
	todayWordEl!: HTMLElement;
	percentEl!: HTMLElement;
	progressFillEl!: HTMLElement;
	// 今日目标
	dailyWordEl!: HTMLElement;
	dailyGoalEl!: HTMLElement;
	dailyPercentEl!: HTMLElement;
	dailyProgressFillEl!: HTMLElement;
	focusTimeEl!: HTMLElement;
	slackTimeEl!: HTMLElement;
	totalTimeEl!: HTMLElement;
	chartContainerEl!: HTMLElement;
	statusBadgeEl!: HTMLElement;

	// 字数统计元素引用
	weekWordEl!: HTMLElement;
	monthWordEl!: HTMLElement;
	yearWordEl!: HTMLElement;
	historyTotalWordEl!: HTMLElement;

	private chartBarsContainer!: HTMLElement;
	private chartBarEls: { container: HTMLElement, dateEl: HTMLElement, barEl: HTMLElement, valueEl: HTMLElement }[] = [];

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

		// 更新数据与图表
		this.updateData();
		this.renderChart();
	}

	private createGoalCard(container: Element) {
		const goalCard = container.createDiv({ cls: 'status-card' });
		const titleRow = goalCard.createDiv({ cls: 'status-title' });
		titleRow.createSpan({ text: '今日状态' });
		
		// 桌面端才显示"开始/暂停"按钮（移动端没有 Worker，无法追踪时间）
		if (!isMobile()) {
			this.statusBadgeEl = titleRow.createSpan({ cls: 'status-title-badge', text: '已暂停' });
			this.statusBadgeEl.style.cursor = 'pointer';
			this.statusBadgeEl.title = '点击开始/暂停统计';
			this.statusBadgeEl.addEventListener('click', () => {
				// [BUGFIX] 使用统一的 startTracking/stopTracking API，
				// 避免绕过 Worker 初始化检查、OBS 导出、lastEditTime 设置等逻辑。
				const p = this.plugin as any;
				if (this.plugin.isTracking) {
					p.stopTracking();
				} else {
					p.startTracking();
				}
			});
		}

		// 今日目标进度
		goalCard.createDiv({ cls: 'status-goal-label', text: '今日目标' });
		const dailyRow = goalCard.createDiv({ cls: 'goal-display-row-right' });
		this.dailyWordEl = dailyRow.createSpan({ cls: 'goal-current', text: '0' });
		dailyRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.dailyGoalEl = dailyRow.createSpan({ cls: 'goal-target', text: '0' });
		this.dailyPercentEl = dailyRow.createSpan({ cls: 'goal-percent', text: '0%' });
		const dailyProgressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.dailyProgressFillEl = dailyProgressBg.createDiv({ cls: 'progress-bar-fill' });

		// 章节目标进度
		goalCard.createDiv({ cls: 'status-goal-label', text: '章节目标' });
		const goalRow = goalCard.createDiv({ cls: 'goal-display-row-right' });
		this.todayWordEl = goalRow.createSpan({ cls: 'goal-current', text: '0' });
		goalRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.goalWordEl = goalRow.createSpan({ cls: 'goal-target', text: '0' });
		this.percentEl = goalRow.createSpan({ cls: 'goal-percent', text: '0%' });
		const progressBg = goalCard.createDiv({ cls: 'progress-bar-bg' });
		this.progressFillEl = progressBg.createDiv({ cls: 'progress-bar-fill' });
	}

	private createTimeCard(container: Element) {
		// 移动端不显示时间统计卡片（没有 Worker，无法追踪时间）
		if (isMobile()) return;
		
		const timeCard = container.createDiv({ cls: 'status-card' });
		timeCard.createDiv({ cls: 'status-title', text: '本次统计' });

		// 总计耗时
		const totalBox = timeCard.createDiv({ cls: 'time-box time-box-total' });
		totalBox.createDiv({ cls: 'time-box-title', text: '总计耗时' });
		this.totalTimeEl = totalBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		// 专注和摸鱼时长
		const timeGrid = timeCard.createDiv({ cls: 'time-grid' });
		
		const focusBox = timeGrid.createDiv({ cls: 'time-box' });
		focusBox.createDiv({ cls: 'time-box-title', text: '专注时长' });
		this.focusTimeEl = focusBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const slackBox = timeGrid.createDiv({ cls: 'time-box' });
		slackBox.createDiv({ cls: 'time-box-title', text: '摸鱼时长' });
		this.slackTimeEl = slackBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		// 近7日图表
		this.chartContainerEl = timeCard.createDiv({ cls: 'history-chart' });

		// 添加标题
		this.chartContainerEl.createDiv({ 
			text: '近7日字数统计', 
			cls: 'history-chart-title'
		});
		
		// 添加副标题
		const chartSubtitle = this.chartContainerEl.createDiv({ 
			text: '点击查看详情', 
			cls: 'history-chart-subtitle'
		});
		
		chartSubtitle.setAttribute('aria-label', '点击进入字数统计详情');
		chartSubtitle.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin.historyManager.getHistory()).open();
		};
		
		// 创建横向柱状图容器
		this.chartBarsContainer = this.chartContainerEl.createDiv({ 
			attr: { style: 'display: flex; flex-direction: column; gap: 6px; cursor: pointer;' } 
		});
		
		this.chartBarsContainer.onclick = () => {
			new HistoryStatsModal(this.plugin.app, this.plugin.historyManager.getHistory()).open();
		};
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
	}

	updateData() {
		// 桌面端才更新状态徽章（移动端没有这个元素）
		if (!isMobile() && this.statusBadgeEl) {
			if (this.plugin.isTracking) {
				this.statusBadgeEl.innerText = '记录中';
				this.statusBadgeEl.style.background = 'var(--color-green)';
				this.statusBadgeEl.style.color = '#ffffff';
			} else {
				this.statusBadgeEl.innerText = '已暂停';
				this.statusBadgeEl.style.background = 'var(--text-muted)';
				this.statusBadgeEl.style.color = '#ffffff';
			}
		}

		// 今日目标进度（今日新增 vs dailyGoal）
		const today = window.moment().format('YYYY-MM-DD');
		const todayStat = this.plugin.historyManager.getDailyStat(today) || { focusMs: 0, slackMs: 0, addedWords: 0 };
		const dailyAdded = todayStat.addedWords; // 允许负数，提醒作者删除了字数
		const dailyGoal = this.plugin.settings.dailyGoal || 0;

		this.dailyWordEl.innerText = Math.max(0, dailyAdded).toLocaleString();
		this.dailyGoalEl.innerText = dailyGoal.toLocaleString();
		
		// 负数显示为负百分比，正数显示正常百分比
		let dailyPercent = 0;
		if (dailyAdded < 0) {
			// 负数：显示负百分比（不限制范围）
			dailyPercent = dailyGoal > 0 ? Math.round((dailyAdded / dailyGoal) * 100) : 0;
		} else {
			// 正数：显示正常百分比（最大 100%）
			dailyPercent = dailyGoal > 0 ? Math.min(Math.round((dailyAdded / dailyGoal) * 100), 100) : 0;
		}
		this.dailyPercentEl.innerText = ` ${dailyPercent}%`;
		
		// 进度条宽度：负数显示为 0%，正数正常显示
		const dailyProgressWidth = Math.max(0, dailyPercent);
		this.dailyProgressFillEl.style.width = `${dailyProgressWidth}%`;
		
		// 今日进度：负数红色，未完成灰色，完成橙金色
		const dailyDone = dailyGoal > 0 && dailyAdded >= dailyGoal;
		if (dailyAdded < 0) {
			// 负数：红色警告
			this.dailyProgressFillEl.style.background = '#E74C3C';
			this.dailyWordEl.style.color = '#E74C3C';
			this.dailyPercentEl.style.color = '#E74C3C';
		} else if (dailyDone) {
			// 完成：橙金色
			this.dailyProgressFillEl.style.background = '#F5A623';
			this.dailyWordEl.style.color = '#F5A623';
			this.dailyPercentEl.style.color = '#F5A623';
		} else {
			// 未完成：灰色
			this.dailyProgressFillEl.style.background = 'var(--background-modifier-border)';
			this.dailyWordEl.style.color = 'var(--text-normal)';
			this.dailyPercentEl.style.color = 'var(--interactive-accent)';
		}

		// 章节目标进度（当前文件总字数 vs 章节目标）
		let targetGoal = this.plugin.settings.defaultGoal;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		let chapterWords = 0;
		if (view?.file) {
			const cache = this.plugin.app.metadataCache.getFileCache(view.file);
			const fmGoal = parseInt(cache?.frontmatter?.['word-goal']);
			if (!isNaN(fmGoal)) targetGoal = fmGoal;
			chapterWords = this.plugin.calculateAccurateWords(view.getViewData());
		}

		// 更新章节目标进度显示
		this.todayWordEl.innerText = chapterWords.toLocaleString();
		this.goalWordEl.innerText = targetGoal.toLocaleString();

		const percent = targetGoal > 0 ? Math.min(Math.round((chapterWords / targetGoal) * 100), 100) : 0;
		this.percentEl.innerText = ` ${percent}%`;
		this.progressFillEl.style.width = `${percent}%`;
		// 章节进度：未完成灰色，完成紫色
		const chapterDone = targetGoal > 0 && chapterWords >= targetGoal;
		this.progressFillEl.style.background = chapterDone ? '#8B5CF6' : 'var(--background-modifier-border)';
		this.todayWordEl.style.color = chapterDone ? '#8B5CF6' : 'var(--text-normal)';

		// 桌面端才更新时间统计（移动端没有这些元素）
		if (!isMobile()) {
			const focusSec = Math.floor(this.plugin.focusMs / 1000);
			const slackSec = Math.floor(this.plugin.slackMs / 1000);
			const totalSec = focusSec + slackSec;

			if (this.focusTimeEl) this.focusTimeEl.innerText = formatTime(focusSec);
			if (this.slackTimeEl) this.slackTimeEl.innerText = formatTime(slackSec);
			if (this.totalTimeEl) this.totalTimeEl.innerText = formatTime(totalSec);
		}

		// 计算字数统计数据
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

	renderChart() {
		const history = this.plugin.historyManager.getHistory();
		const dates = Object.keys(history).sort().slice(-7);

		if (dates.length === 0) {
			this.chartBarsContainer.empty();
			this.chartBarsContainer.createDiv({ 
				text: '暂无历史数据', 
				attr: { style: 'color: var(--text-muted); font-size: 0.8em; padding: 10px 0;' } 
			});
			this.chartBarEls = []; // 清空缓存
			return;
		}

		// 如果 DOM 数量不匹配，重建 DOM
		if (this.chartBarEls.length !== dates.length) {
			this.chartBarsContainer.empty();
			this.chartBarEls = [];
			
			for (let i = 0; i < dates.length; i++) {
				const row = this.chartBarsContainer.createDiv({ 
					attr: { style: 'display: flex; align-items: center; gap: 8px;' } 
				});
				
				const dateEl = row.createDiv({ 
					attr: { style: 'font-size: 0.7em; color: var(--text-muted); min-width: 35px; text-align: right; flex-shrink: 0;' } 
				});
				
				const barContainer = row.createDiv({ 
					attr: { style: 'flex: 1; height: 18px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; position: relative; min-width: 0;' } 
				});
				
				const barEl = barContainer.createDiv({ 
					attr: { style: `height: 100%; border-radius: 3px; transition: width 0.4s ease;` } 
				});
				
				const valueEl = row.createDiv({ 
					attr: { style: `font-size: 0.75em; font-weight: bold; font-family: var(--font-monospace); min-width: 40px; text-align: right; flex-shrink: 0;` } 
				});
				
				this.chartBarEls.push({ container: row, dateEl, barEl, valueEl });
			}
		}

		// 计算最大绝对值，用于缩放（支持负数）
		const maxAbsWords = Math.max(...dates.map(d => Math.abs(history[d].addedWords)), 100);

		dates.forEach((date, index) => {
			const stat = history[date];
			const words = stat.addedWords;
			const els = this.chartBarEls[index];
			
			// 更新日期
			const shortDate = date.substring(5);
			if (els.dateEl.innerText !== shortDate) els.dateEl.innerText = shortDate;
			
			// 更新宽度和颜色
			const barWidthPercent = Math.max(2, (Math.abs(words) / maxAbsWords) * 100);
			const barColor = words >= 0 ? 'var(--interactive-accent)' : '#E74C3C'; // 负数用红色
			
			els.barEl.style.width = `${barWidthPercent}%`;
			els.barEl.style.background = barColor;
			
			const focusHours = (stat.focusMs / 3600000).toFixed(1);
			els.barEl.setAttribute('title', `日期: ${date}\n字数: ${words}\n专注时长: ${focusHours}h`);
			
			// 更新字数值
			const formattedWords = formatCount(words);
			if (els.valueEl.innerText !== formattedWords) {
				els.valueEl.innerText = formattedWords;
				if (words < 0) {
					els.valueEl.style.color = '#E74C3C';
				} else {
					els.valueEl.style.color = '';
				}
			}
		});
	}

	async onClose() {}
}
