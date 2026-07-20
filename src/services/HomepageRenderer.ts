import type { App } from 'obsidian';
import { Notice, setIcon } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { TaskEntry } from '../types/task';
import type { NovelFolderInfo } from '../types/homepage';
import { getTaskStatusText, getNovelStatusText, getNovelInfoLabel } from '../i18n/data-keys';
import { t } from '../i18n';
import { calcStreak, calcFocusRate, calcActiveHours, calcDailyAverage, getHeatClass } from '../ui/HistoryModal';
import { TaskManager } from '../services/TaskManager';
import { NewNovelModal } from '../ui/NewNovelModal';
import type { WorkbenchView } from '../ui/WorkbenchView';

export class HomepageRenderer {
	private app: App;
	private plugin: WebNovelAssistantPlugin;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 安全创建「标签 + 值」字段元素（替代 innerHTML，消除 XSS 风险）
	 */
	private createFieldEl(parent: HTMLElement, label: string, value: string): HTMLElement {
		const field = parent.createDiv({ cls: 'homepage-completed-field' });
		field.createSpan({ cls: 'homepage-field-label', text: label });
		field.createSpan({ cls: 'homepage-field-value', text: value });
		return field;
	}

	// 主页整体网格布局：顶部(欢迎+连载中) + 左列(其他作品) + 右列(数据)
	async renderHomepage(container: HTMLElement): Promise<void> {
		container.empty();

		const grid = container.createDiv({ cls: 'homepage-grid-container' });

		// 顶部行：欢迎语 + 今日字数 + 新增作品 + 连载中
		const topRow = grid.createDiv({ cls: 'homepage-grid-top' });
		const welcomeCell = topRow.createDiv({ cls: 'homepage-grid-cell' });
		await this.renderWelcome(welcomeCell);
		const ongoingCell = topRow.createDiv({ cls: 'homepage-grid-cell' });
		await this.renderOngoing(ongoingCell);

		// 底部左列：其他作品区块
		const leftCol = grid.createDiv({ cls: 'homepage-grid-left' });
		const draftingCell = leftCol.createDiv({ cls: 'homepage-grid-cell' });
		await this.renderDrafting(draftingCell);
		const pausedCell = leftCol.createDiv({ cls: 'homepage-grid-cell' });
		await this.renderPaused(pausedCell);
		const completedCell = leftCol.createDiv({ cls: 'homepage-grid-cell' });
		await this.renderCompleted(completedCell);

		// 底部右列：数据区块
		const rightCol = grid.createDiv({ cls: 'homepage-grid-right' });
		const statsCell = rightCol.createDiv({ cls: 'homepage-grid-cell' });
		this.renderStatsSummary(statsCell);
		const heatmapCell = rightCol.createDiv({ cls: 'homepage-grid-cell' });
		this.renderHeatmap(heatmapCell);
		const chartCell = rightCol.createDiv({ cls: 'homepage-grid-cell' });
		this.renderBarChart(chartCell);

		// ResizeObserver：根据编辑器面板宽度动态切换单列/双列布局
		const updateLayout = () => {
			const width = container.clientWidth;
			// 将阈值从 1200 降低到 800，避免稍微放大字体或缩小窗口就变成单列
			if (width < 800) {
				grid.addClass('homepage-single-column');
			} else {
				grid.removeClass('homepage-single-column');
			}
		};
		updateLayout();
		const viewDom = container.closest('.markdown-source-view') || container.closest('.markdown-preview-view');
		if (viewDom) {
			const VIEW_OBS_KEY = '__webnovel_homepage_resize_obs__';
			const viewDomAny = viewDom as unknown as Record<string, ResizeObserver | undefined>;
			if (viewDomAny[VIEW_OBS_KEY]) {
				viewDomAny[VIEW_OBS_KEY]?.disconnect();
			}
			const resizeObs = new ResizeObserver(() => updateLayout());
			resizeObs.observe(viewDom);
			viewDomAny[VIEW_OBS_KEY] = resizeObs;
		}
	}

	// 欢迎语 + 今日进度 + 新增作品按钮
	async renderWelcome(container: HTMLElement): Promise<void> {
		container.empty();

		const section = container.createDiv({ cls: 'homepage-welcome-section' });

		// 欢迎语 + 新增按钮同行
		const headerRow = section.createDiv({ cls: 'homepage-welcome-header' });
		const title = headerRow.createDiv({ cls: 'homepage-welcome-title' });

		if (this.plugin.settings.homepageWelcome) {
			title.textContent = this.plugin.settings.homepageWelcome;
		} else {
			const hour = window.moment().hour();
			let welcomeText = '';
			let iconName = '';
			if (hour < 6) { welcomeText = t('homepage.welcome-night'); iconName = 'moon'; }
			else if (hour < 9) { welcomeText = t('homepage.welcome-morning'); iconName = 'sun'; }
			else if (hour < 12) { welcomeText = t('homepage.welcome-forenoon'); iconName = 'coffee'; }
			else if (hour < 14) { welcomeText = t('homepage.welcome-noon'); iconName = 'utensils'; }
			else if (hour < 18) { welcomeText = t('homepage.welcome-afternoon'); iconName = 'rocket'; }
			else if (hour < 22) { welcomeText = t('homepage.welcome-evening'); iconName = 'moon-star'; }
			else { welcomeText = t('homepage.welcome-night'); iconName = 'moon'; }

			const iconEl = title.createSpan({ cls: 'homepage-welcome-icon' });
			setIcon(iconEl, iconName);
			title.createSpan({ text: welcomeText });
		}
		const addBtn = headerRow.createDiv({ cls: 'homepage-add-novel-btn' });
		addBtn.textContent = t('homepage.add-novel');
		addBtn.onclick = () => {
			new NewNovelModal(this.plugin.app, this.plugin, (result) => {
				void (async () => {
					try {
						const { folderPath } = await this.plugin.homepageManager!.createNewNovel(result.name, result.meta);
						new Notice(t('notice.novel-created', { name: result.name }));
						this.plugin.homepageManager!.refreshHomepageViews();

						// Open Workbench
						const viewType = 'webnovel-workbench';
						const { workspace } = this.plugin.app;
						const leaves = workspace.getLeavesOfType(viewType);
						let leaf = leaves.length > 0 ? leaves[0] : null;
						if (!leaf) {
							leaf = workspace.getLeaf(false);
							await leaf.setViewState({ type: viewType, active: true });
						}
						if (leaf && leaf.view && leaf.view.getViewType() === viewType) {
							(leaf.view as WorkbenchView).setBookPath(folderPath);
						}
					} catch (e) { console.error(e); }
				})();
			}).open();
		};

		// 今日进度
		const history = this.plugin.historyManager.getHistory();
		const today = window.moment().format('YYYY-MM-DD');
		const todayWords = history[today]?.addedWords || 0;

		const progressRow = section.createDiv({ cls: 'homepage-progress-row' });
		// 总字数：从缓存中统计工作区所有文件的实际字数
		let totalWords = 0;
		for (const [, entry] of this.plugin.cacheManager.getEntries()) {
			if (!entry.isFolder) totalWords += entry.wordCount;
		}
		progressRow.createDiv({ cls: 'homepage-progress-label', text: t('homepage.total-words') });
		progressRow.createDiv({ cls: 'homepage-progress-value', text: totalWords.toLocaleString() });
		progressRow.createDiv({ cls: 'homepage-progress-separator' });
		progressRow.createDiv({ cls: 'homepage-progress-label', text: t('homepage.today-added') });
		progressRow.createDiv({ cls: 'homepage-progress-value', text: todayWords.toLocaleString() });


	}

	// 连载中作品列表（含任务信息）
	async renderOngoing(container: HTMLElement): Promise<void> {
		const allNovels = await this.getAllNovelsWithMetadata();
		const ongoing = allNovels.filter(n => n.metadata?.status === 'ongoing');
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: getNovelStatusText('ongoing') });

		if (ongoing.length === 0) {
			container.createDiv({ cls: 'stats-empty-msg', text: t('homepage.no-ongoing') });
			return;
		}

		const section = container.createDiv({ cls: 'homepage-ongoing-section' });

		for (const novel of ongoing) {
			const displayName = novel.metadata?.name || novel.folderName;

			const item = section.createDiv({ cls: 'homepage-ongoing-item' });

			// 名称 + 字数
			const header = item.createDiv({ cls: 'homepage-ongoing-header' });
			const nameEl = header.createDiv({ cls: 'homepage-ongoing-name' });
			nameEl.textContent = displayName;
			nameEl.onclick = () => this.navigateToNovel(novel.folderPath);
			const countEl = header.createDiv({ cls: 'homepage-ongoing-count' });
			countEl.textContent = novel.wordCount.toLocaleString() + ' ' + t('common.word-char');

			// 任务信息（最近一条）
			const taskInfo = await this.getLatestTask(novel.folderPath);
			if (taskInfo) {
				const rankContainer = item.createDiv({ cls: 'homepage-ongoing-task' });

				const progress = taskInfo.progress;
				const target = taskInfo.wordTarget;
				const statusText = taskInfo.statusText;
				const daysLeft = taskInfo.daysLeft;

				const topRow = rankContainer.createDiv({ cls: 'homepage-task-row' });
				const leftWrapper = topRow.createDiv({ cls: 'homepage-task-left-wrapper' });
				leftWrapper.createSpan({ cls: 'homepage-task-title-inline', text: t('homepage.current-task') });
				const periodText = t('common.period-prefix', { period: taskInfo.period }) + ' ' + taskInfo.position;
				leftWrapper.createSpan({ cls: 'homepage-task-period', text: periodText });
				topRow.createSpan({ cls: 'homepage-task-progress', text: progress.toLocaleString() + ' / ' + target.toLocaleString() + ' ' + t('common.word-char') + ' (' + statusText + ')' });

				// 动态进度条作为分割线
				const progressPercent = target > 0 ? Math.min(100, Math.max(0, (progress / target) * 100)) : 0;
				const progressBg = rankContainer.createDiv({ cls: 'homepage-ongoing-progress-bar-bg' });
				const progressFill = progressBg.createDiv({ cls: 'homepage-ongoing-progress-bar-fill' });
				progressFill.setCssProps({ width: `${progressPercent}%` });
				// 进度条颜色区分状态
				if (progressPercent >= 100) progressFill.addClass('is-done');

				if (daysLeft > 0 && taskInfo.entry.status === 'active') {
					const bottomRow = rankContainer.createDiv({ cls: 'homepage-task-row homepage-task-sub' });
					bottomRow.createSpan({ cls: 'homepage-task-days', text: t('homepage.days-remaining', { days: daysLeft }) });
					const remaining = target - progress;
					if (remaining > 0) {
						const dailyNeeded = Math.round(remaining / daysLeft);
						bottomRow.createSpan({ cls: 'homepage-task-daily', text: t('homepage.daily-needed', { words: dailyNeeded.toLocaleString() }) });
					} else {
						bottomRow.createSpan({ cls: 'homepage-task-daily', text: t('homepage.goal-reached') });
					}
				}
			}
		}
	}

	// 已完结作品卡片
	async renderCompleted(container: HTMLElement): Promise<void> {
		const allNovels = await this.getAllNovelsWithMetadata();
		const completed = allNovels.filter(n => n.metadata?.status === 'completed');
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: getNovelStatusText('completed') });

		if (completed.length === 0) {
			container.createDiv({ cls: 'stats-empty-msg', text: t('homepage.no-completed') });
			return;
		}

		const grid = container.createDiv({ cls: 'homepage-completed-grid' });

		for (const novel of completed) {
			const displayName = novel.metadata?.name || novel.folderName;
			const card = grid.createDiv({ cls: 'homepage-completed-card' });

			const nameEl = card.createDiv({ cls: 'homepage-completed-name' });
			nameEl.textContent = displayName;
			nameEl.onclick = () => this.navigateToNovel(novel.folderPath);

			this.createFieldEl(card, t('homepage.field-total-words'), novel.wordCount.toLocaleString());
			this.createFieldEl(card, getNovelInfoLabel('protagonist'), novel.metadata?.protagonist || '--');
			this.createFieldEl(card, getNovelInfoLabel('genre'), novel.metadata?.genre || '--');

			if (novel.metadata?.synopsis) {
				card.createDiv({ cls: 'homepage-completed-synopsis', text: novel.metadata.synopsis });
			}
		}
	}

	// 存稿中作品卡片
	async renderDrafting(container: HTMLElement): Promise<void> {
		const allNovels = await this.getAllNovelsWithMetadata();
		const drafting = allNovels.filter(n => n.metadata?.status === 'stockpiling');
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: getNovelStatusText('stockpiling') });

		if (drafting.length === 0) {
			container.createDiv({ cls: 'stats-empty-msg', text: t('homepage.no-drafting') });
			return;
		}

		const grid = container.createDiv({ cls: 'homepage-completed-grid homepage-drafting-grid' });

		for (const novel of drafting) {
			const displayName = novel.metadata?.name || novel.folderName;
			const card = grid.createDiv({ cls: 'homepage-completed-card homepage-drafting-card' });

			const nameEl = card.createDiv({ cls: 'homepage-completed-name' });
			nameEl.textContent = displayName;
			nameEl.onclick = () => this.navigateToNovel(novel.folderPath);

			this.createFieldEl(card, t('homepage.field-total-words'), novel.wordCount.toLocaleString());
			this.createFieldEl(card, getNovelInfoLabel('genre'), novel.metadata?.genre || '--');

			if (novel.metadata?.synopsis) {
				card.createDiv({ cls: 'homepage-completed-synopsis', text: novel.metadata.synopsis });
			}
		}
	}

	// 已暂停作品卡片
	async renderPaused(container: HTMLElement): Promise<void> {
		const allNovels = await this.getAllNovelsWithMetadata();
		const paused = allNovels.filter(n => n.metadata?.status === 'paused');
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: getNovelStatusText('paused') });

		if (paused.length === 0) {
			container.createDiv({ cls: 'stats-empty-msg', text: t('homepage.no-paused') });
			return;
		}

		const grid = container.createDiv({ cls: 'homepage-completed-grid homepage-paused-grid' });

		for (const novel of paused) {
			const displayName = novel.metadata?.name || novel.folderName;
			const card = grid.createDiv({ cls: 'homepage-completed-card homepage-paused-card' });

			const nameEl = card.createDiv({ cls: 'homepage-completed-name' });
			nameEl.textContent = displayName;
			nameEl.onclick = () => this.navigateToNovel(novel.folderPath);

			this.createFieldEl(card, t('homepage.field-total-words'), novel.wordCount.toLocaleString());
			this.createFieldEl(card, getNovelInfoLabel('genre'), novel.metadata?.genre || '--');

			if (novel.metadata?.synopsis) {
				card.createDiv({ cls: 'homepage-completed-synopsis', text: novel.metadata.synopsis });
			}
		}
	}

	// 效率总览 — 复用 HistoryModal 的 stats-efficiency-card
	renderStatsSummary(container: HTMLElement): void {
		const history = this.plugin.historyManager.getHistory();
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: t('homepage.efficiency-overview') });

		const yearStart = window.moment().clone().startOf('year').format('YYYY-MM-DD');
		const yearEnd = window.moment().format('YYYY-MM-DD');

		const streak = calcStreak(history);
		const focusRate = calcFocusRate(history, yearStart, yearEnd);
		const activeHours = calcActiveHours(history, yearStart, yearEnd);
		const dailyAvg = calcDailyAverage(history, yearStart, yearEnd);
		const totalWords = Object.values(history).reduce((sum, s) => sum + s.addedWords, 0);

		const row = container.createDiv({ cls: 'stats-efficiency-row' });
		const metrics = [
			{ label: t('common.consecutive-creation'), value: t('common.consecutive-days', { count: streak }) },
			{ label: t('common.focus-efficiency'), value: `${focusRate}%` },
			{ label: t('common.active-period'), value: activeHours || '--' },
			{ label: t('common.daily-word-average'), value: dailyAvg.toLocaleString() },
			{ label: t('common.accumulated-words'), value: totalWords.toLocaleString() },
		];

		for (const m of metrics) {
			const card = row.createDiv({ cls: 'stats-efficiency-card' });
			card.createDiv({ cls: 'stats-efficiency-label', text: m.label });
			card.createDiv({ cls: 'stats-efficiency-value', text: m.value });
		}
	}

	// 热力图 — 与写作数据追踪面板时间同步
	renderHeatmap(container: HTMLElement): void {
		const history = this.plugin.historyManager.getHistory();
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: t('homepage.heatmap') });

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

		// 图例（含字数减少）
		const gridContainer = container.createDiv({ cls: 'stats-heatmap-grid' });

		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
			const row = gridContainer.createDiv({ cls: 'stats-heatmap-row' });

			for (let w = 0; w < totalWeeks; w++) {
				const cellDate = alignedStart.clone().add(w, 'weeks').add(dayOfWeek, 'days');
				const dateStr = cellDate.format('YYYY-MM-DD');
				const stat = history[dateStr];
				const cell = row.createDiv({ cls: 'stats-heatmap-cell' });

				if (cellDate.isSame(now, 'day')) cell.addClass('stats-heatmap-today');

				if (stat) {
					const words = stat.addedWords || 0;
					cell.addClass(getHeatClass(words));
					cell.setAttribute('title', dateStr + ': ' + words.toLocaleString() + ' ' + t('common.word-char'));
				} else if (cellDate.isAfter(now, 'day')) {
					cell.addClass('stats-heatmap-future');
				} else {
					cell.addClass('heat-0');
				}
			}
		}
	}

	// 30日柱状图（主页精简版：只显示柱状图，无日期/字数标签）
	renderBarChart(container: HTMLElement): void {
		const history = this.plugin.historyManager.getHistory();
		container.empty();
		container.createDiv({ cls: 'homepage-section-label', text: t('homepage.trend-30days') });

		const now = window.moment();
		const days: { date: string; words: number }[] = [];
		for (let i = 29; i >= 0; i--) {
			const dateStr = now.clone().subtract(i, 'days').format('YYYY-MM-DD');
			const stat = history[dateStr];
			const words = stat?.addedWords || 0;
			days.push({ date: dateStr, words });
		}

		if (days.length === 0) {
			container.createDiv({ cls: 'stats-empty-msg', text: t('common.no-data') });
			return;
		}

		const maxAbsValue = Math.max(...days.map(d => Math.abs(d.words)), 1);

		const chartArea = container.createDiv({ cls: 'homepage-chart-container' });

		for (const day of days) {
			const val = day.words;
			const heightPercent = Math.max(2, (Math.abs(val) / maxAbsValue) * 100);
			const bar = chartArea.createDiv({ cls: 'homepage-chart-bar' });
			bar.setCssProps({ height: `${heightPercent}%` });

			if (val < 0) {
				bar.addClass('bar-negative');
			} else {
				const ratio = val / maxAbsValue;
				if (ratio >= 0.8) bar.addClass('bar-high');
				else if (ratio >= 0.5) bar.addClass('bar-medium');
				else if (ratio >= 0.2) bar.addClass('bar-low');
				else bar.addClass('bar-minimal');
			}
			bar.setAttribute('title', day.date + ': ' + day.words.toLocaleString() + ' ' + t('common.word-char'));
		}
	}

	// 辅助方法：获取所有小说及其异步元数据
	private async getAllNovelsWithMetadata(): Promise<NovelFolderInfo[]> {
		const folders = this.plugin.homepageManager!.getNovelFolders();
		for (const novel of folders) {
			if (!novel.metadata) {
				novel.metadata = await this.plugin.homepageManager!.getNovelMetadata(novel.folderPath);
			}
		}
		return folders;
	}

	// 辅助方法：获取最近一条任务记录
	private async getLatestTask(folderPath: string): Promise<{
		period: number; position: string; wordTarget: number;
		progress: number; statusText: string; daysLeft: number;
		entry: TaskEntry;
	} | null> {
		const manager = new TaskManager(this.app, this.plugin, folderPath);
		const entries = await manager.loadEntries();
		if (!entries || entries.length === 0) return null;

		// 优先显示进行中的任务，如果没有则显示最新添加的
		const entry = entries.find(e => e.status === 'active') || entries[entries.length - 1];

		const progress = manager.calcProgress(entry) || entry.completedWords || 0;
		const now = window.moment();
		const daysLeft = Math.max(0, window.moment(entry.endDate).diff(now.clone().startOf('day'), 'days') + 1);

		let statusText = '';
		switch (entry.status) {
			case 'active': statusText = getTaskStatusText('active'); break;
			case 'completed': statusText = getTaskStatusText('completed') + '!'; break;
			case 'incomplete': statusText = getTaskStatusText('incomplete') + '!'; break;
			case 'notStarted': statusText = getTaskStatusText('notStarted'); break;
		}

		return {
			period: entry.period,
			position: entry.position,
			wordTarget: entry.wordTarget,
			progress,
			statusText,
			daysLeft,
			entry,
		};
	}

	navigateToNovel(folderPath: string): void {
		void (async () => {
			const viewType = 'webnovel-workbench';
			const { workspace } = this.app;
			const leaves = workspace.getLeavesOfType(viewType);
			let leaf = leaves.length > 0 ? leaves[0] : null;
			if (!leaf) {
				leaf = workspace.getLeaf('tab');
				await leaf.setViewState({ type: viewType, active: true });
			}
			if (leaf && leaf.view && leaf.view.getViewType() === viewType) {
				(leaf.view as WorkbenchView).setBookPath(folderPath);
			}
			if (leaf) {
				void workspace.revealLeaf(leaf);
				void workspace.setActiveLeaf(leaf, { focus: true });
			}
		})();
	}
} 