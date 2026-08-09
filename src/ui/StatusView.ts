import type { WorkspaceLeaf} from 'obsidian';
import { ItemView, TFile, Notice, setIcon, Menu, MarkdownView } from 'obsidian';
import { formatTime, formatCount, isMobile } from '../utils';
import { smartLocateAndHighlight } from '../utils/leaf';

import { HistoryStatsModal } from './HistoryModal';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import { CORKBOARD_STATUS_MAP, getCorkboardStatusText, getCorkboardStatusKeys } from '../i18n/data-keys';
import { getCurrentBookContext } from '../utils/path';
import { ChapterSorter } from '../services/ChapterSorter';
import { t } from '../i18n';

export const STATUS_VIEW_TYPE = 'writing-status-view';

interface CollapsibleTitleElement extends HTMLElement {
	refreshTitle?: () => void;
	setOriginalTitle?: (title: string) => void;
}

export class WritingStatusView extends ItemView {
	plugin: WebNovelAssistantPlugin;

	goalWordEl!: HTMLElement;
	todayWordEl!: HTMLElement;
	percentEl!: HTMLElement;
	progressFillEl!: HTMLElement;
		taskRowEl!: HTMLElement;
		taskWordEl!: HTMLElement;
		taskSeparatorEl!: HTMLElement;
		taskTargetEl!: HTMLElement;
		taskPercentEl!: HTMLElement;
		taskProgressFillEl!: HTMLElement;
		taskEventCompleteBtn!: HTMLElement;
		taskSectionEls!: HTMLElement[];
		chapterSectionEls!: HTMLElement[];
		taskTimeDescEl!: HTMLElement;
		dailyWordEl!: HTMLElement;
	dailyGoalEl!: HTMLElement;
	dailyPercentEl!: HTMLElement;
	dailyProgressFillEl!: HTMLElement;
	focusTimeEl!: HTMLElement;
	chapterStatusCardEl!: HTMLElement;
	chapterSubInfoEl!: HTMLElement;
	chapterStatusBadgeEl!: HTMLElement;
	chapterBadgesContainer!: HTMLElement;
	chapterTitleEl!: HTMLElement;
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
	private currentChapterFile: TFile | null = null;

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
		this.createChapterStatusCard(container);
		this.createTimeCard(container);
		this.createHistoryCard(container);

		void this.updateData(true);
		this.renderMiniChart();
	}

	private setupCollapsibleCard(titleRow: HTMLElement, titleSpan: HTMLElement, contentContainer: HTMLElement, getOriginalTitle: () => string) {
		titleRow.addClass('wn-collapsible-title', 'wn-clickable');
		let isCollapsed = false;
		
		const iconSpan = titleRow.createSpan({ cls: 'wn-collapsible-icon' });
		setIcon(iconSpan, 'chevron-down');
		
		titleRow.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).hasClass('wn-status-title-badge')) return;
			if ((e.target as HTMLElement).closest('.wn-status-title-badge')) return;
			if ((e.target as HTMLElement).hasClass('wn-chapter-title-badge')) return;
			if ((e.target as HTMLElement).closest('.wn-chapter-title-badge')) return;
			
			isCollapsed = !isCollapsed;
			if (isCollapsed) {
				contentContainer.addClass('is-collapsed');
				titleSpan.setText(t('common.click-to-expand', { title: getOriginalTitle() }));
				titleSpan.addClass('wn-title-collapsed-hint');
				titleRow.parentElement?.addClass('is-collapsed');
				setIcon(iconSpan, 'chevron-right');
			} else {
				contentContainer.removeClass('is-collapsed');
				titleSpan.setText(getOriginalTitle());
				titleSpan.removeClass('wn-title-collapsed-hint');
				titleRow.parentElement?.removeClass('is-collapsed');
				setIcon(iconSpan, 'chevron-down');
			}
		});

		// Expose a way to refresh title if it was updated externally while collapsed
		(titleSpan as CollapsibleTitleElement).refreshTitle = () => {
			if (isCollapsed) {
				titleSpan.setText(t('common.click-to-expand', { title: getOriginalTitle() }));
			} else {
				titleSpan.setText(getOriginalTitle());
			}
		};
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
		const titleLeft = titleRow.createDiv({ cls: 'wn-status-title-left' });
		const titleSpan = titleLeft.createSpan({ text: t('common.today-status') });

		if (!isMobile()) {
			this.statusBadgeEl = titleLeft.createSpan({ cls: 'wn-status-title-badge', text: t('status.paused') });
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

		const contentContainer = goalCard.createDiv({ cls: 'wn-status-card-content' });
		this.setupCollapsibleCard(titleRow, titleSpan, contentContainer, () => t('common.today-status'));

		// 今日目标：小标题 + 百分比居右同行
		const dailyLabelRow = contentContainer.createDiv({ cls: 'status-goal-row' });
		dailyLabelRow.createSpan({ cls: 'status-goal-label', text: t('common.today-goal') });
		this.dailyPercentEl = dailyLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const dailyRow = contentContainer.createDiv({ cls: 'goal-display-row-right' });
		this.dailyWordEl = dailyRow.createSpan({ cls: 'goal-current', text: '0' });
		dailyRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.dailyGoalEl = dailyRow.createSpan({ cls: 'goal-target', text: '0' });
		const dailyProgressBg = contentContainer.createDiv({ cls: 'progress-bar-bg' });
		this.dailyProgressFillEl = dailyProgressBg.createDiv({ cls: 'progress-bar-fill' });

		// 章节目标：小标题 + 百分比居右同行
		const chapterLabelRow = contentContainer.createDiv({ cls: 'status-goal-row' });
		chapterLabelRow.createSpan({ cls: 'status-goal-label', text: t('common.chapter-goal') });
		this.percentEl = chapterLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		const goalRow = contentContainer.createDiv({ cls: 'goal-display-row-right' });
		this.todayWordEl = goalRow.createSpan({ cls: 'goal-current', text: '0' });
		goalRow.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.goalWordEl = goalRow.createSpan({ cls: 'goal-target', text: '0' });
		const progressBg = contentContainer.createDiv({ cls: 'progress-bar-bg' });
		this.progressFillEl = progressBg.createDiv({ cls: 'progress-bar-fill' });

		this.chapterSectionEls = [chapterLabelRow, goalRow, progressBg];

		// 任务目标
		const taskLabelRow = contentContainer.createDiv({ cls: 'status-goal-row task-goal-section' });
		taskLabelRow.hide();
		taskLabelRow.createSpan({ cls: 'status-goal-label', text: t('common.task-goal') });
		this.taskPercentEl = taskLabelRow.createSpan({ cls: 'goal-percent', text: '0%' });

		this.taskRowEl = contentContainer.createDiv({ cls: 'goal-display-row-right task-goal-section' });
		this.taskRowEl.hide();
		this.taskWordEl = this.taskRowEl.createSpan({ cls: 'goal-current', text: '0' });
		this.taskSeparatorEl = this.taskRowEl.createSpan({ cls: 'goal-separator', text: ' / ' });
		this.taskTargetEl = this.taskRowEl.createSpan({ cls: 'goal-target', text: '0' });

		this.taskEventCompleteBtn = this.taskRowEl.createEl('button', { cls: 'status-task-complete-btn', text: t('common.complete-task') });
		this.taskEventCompleteBtn.setCssProps({ display: 'none' });
		this.taskEventCompleteBtn.onclick = () => {
			if (!this.plugin.taskManager) return;
			const manager = this.plugin.taskManager;
			const taskFile = manager.getTaskFile();
			if (!taskFile) return;
			void this.plugin.app.vault.cachedRead(taskFile).then(taskContent => {
				const entries = manager.parseEntries(taskContent);
				const active = manager.getActiveTask(entries);
				if (active && active.taskType === 'event') {
					void manager.updateEntryStatus(active.period, 'completed', undefined, active.taskType).then(() => {
						new Notice(t('notice.task-completed'));
						this.plugin.refreshStatusViews(false);
					});
				}
			});
		};

		const taskProgressBg = contentContainer.createDiv({ cls: 'progress-bar-bg task-goal-section' });
		taskProgressBg.hide();
		this.taskProgressFillEl = taskProgressBg.createDiv({ cls: 'progress-bar-fill' });

		const taskTimeDesc = contentContainer.createDiv({ cls: 'task-time-desc task-goal-section' });
		taskTimeDesc.hide();
		this.taskTimeDescEl = taskTimeDesc;

		this.taskSectionEls = [taskLabelRow, this.taskRowEl, taskProgressBg, taskTimeDesc];
	}

	private createTimeCard(container: Element) {
		if (isMobile()) return;

		const timeCard = container.createDiv({ cls: 'wn-status-card' });
		const titleRow = timeCard.createDiv({ cls: 'wn-status-title' });
		const titleSpan = titleRow.createSpan({ text: t('common.focus-timing') });
		
		const contentContainer = timeCard.createDiv({ cls: 'wn-status-card-content' });
		this.setupCollapsibleCard(titleRow, titleSpan, contentContainer, () => t('common.focus-timing'));

		const totalBox = contentContainer.createDiv({ cls: 'time-box time-box-total' });
		totalBox.createDiv({ cls: 'time-box-title', text: t('common.total-elapsed') });
		this.totalTimeEl = totalBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const timeGrid = contentContainer.createDiv({ cls: 'time-grid' });

		const focusBox = timeGrid.createDiv({ cls: 'time-box' });
		focusBox.createDiv({ cls: 'time-box-title', text: t('common.focus-duration') });
		this.focusTimeEl = focusBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });

		const slackBox = timeGrid.createDiv({ cls: 'time-box' });
		slackBox.createDiv({ cls: 'time-box-title', text: t('common.slack-duration') });
		this.slackTimeEl = slackBox.createDiv({ cls: 'time-box-value', text: '00:00:00' });
	}

	private createHistoryCard(container: Element) {
		const historyCard = container.createDiv({ cls: 'wn-status-card' });
		const titleRow = historyCard.createDiv({ cls: 'wn-status-title' });
		const titleSpan = titleRow.createSpan({ text: t('common.word-count') });

		const contentContainer = historyCard.createDiv({ cls: 'wn-status-card-content' });
		this.setupCollapsibleCard(titleRow, titleSpan, contentContainer, () => t('common.word-count'));

		const historyGrid = contentContainer.createDiv({ cls: 'time-grid' });

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
		const chartSection = contentContainer.createDiv({ cls: 'history-chart' });

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

	private createChapterStatusCard(container: Element) {
		this.chapterStatusCardEl = container.createDiv({ cls: 'wn-status-card' });
		this.chapterStatusCardEl.hide();

		const titleRow = this.chapterStatusCardEl.createDiv({ cls: 'wn-status-title' });
		const titleLeft = titleRow.createDiv({ cls: 'wn-status-title-left' });
		this.chapterTitleEl = titleLeft.createSpan();
		this.chapterStatusBadgeEl = titleLeft.createSpan({ cls: 'wn-chapter-title-badge wn-clickable' });
		this.chapterStatusBadgeEl.title = t('corkboard.click-to-change-status');
		this.chapterStatusBadgeEl.addEventListener('click', (evt: MouseEvent) => {
			evt.stopPropagation();
			const file = this.currentChapterFile;
			if (!file) return;

			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;
			const rawStatus = (frontmatter?.status || frontmatter?.Status || frontmatter?.['状态'] || 'unwritten') as string;
			const currentStatus = CORKBOARD_STATUS_MAP[rawStatus] ?? rawStatus;

			const menu = new Menu();
			const statusKeys = getCorkboardStatusKeys();
			for (const s of statusKeys) {
				menu.addItem((item) => {
					item.setTitle(getCorkboardStatusText(s))
						.setChecked(s === currentStatus)
						.onClick(async () => {
							try {
								await this.app.fileManager.processFrontMatter(file, (fm) => {
									(fm as Record<string, unknown>)['status'] = getCorkboardStatusText(s);
								});
								new Notice(t('corkboard.status-updated', { status: getCorkboardStatusText(s) }));
								void this.updateChapterStatus();
							} catch (err) {
								window.console.error(err);
								new Notice(t('corkboard.status-update-failed'));
							}
						});
				});
			}
			menu.showAtMouseEvent(evt);
		});

		const contentContainer = this.chapterStatusCardEl.createDiv({ cls: 'wn-status-card-content' });
		
		this.chapterSubInfoEl = contentContainer.createDiv({ cls: 'wn-chapter-sub-info' });

		this.chapterBadgesContainer = contentContainer.createDiv({ 
			cls: 'wn-corkboard-card-badges wn-status-badges-container', 
		});
		
		let chapterOriginalTitle = '--';
		this.setupCollapsibleCard(titleRow, this.chapterTitleEl, contentContainer, () => chapterOriginalTitle);
		
		// Let updateChapterStatus update the title properly
		(this.chapterTitleEl as CollapsibleTitleElement).setOriginalTitle = (title: string) => {
			chapterOriginalTitle = title;
			if ((this.chapterTitleEl as CollapsibleTitleElement).refreshTitle) {
				(this.chapterTitleEl as CollapsibleTitleElement).refreshTitle!();
			}
		};
	}

	private updateTimer: number | null = null;

	async updateData(immediate = false) {
		if (immediate) {
			if (this.updateTimer) {
				window.clearTimeout(this.updateTimer);
				this.updateTimer = null;
			}
			await this.performUpdateData();
			return;
		}

		if (this.updateTimer) {
			window.clearTimeout(this.updateTimer);
		}

		this.updateTimer = window.setTimeout(() => {
			this.updateTimer = null;
			void this.performUpdateData();
		}, 100);
	}

	private async performUpdateData() {
		// 更新作品信息
		const contextPath = getCurrentBookContext(this.app, this.plugin);
		if (contextPath) {
			this.lastActiveFolderPath = contextPath;
		}
		
		const folderPath = contextPath || this.lastActiveFolderPath || '';
		let folderName = '--';

		if (folderPath) {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder) {
                folderName = folder.path === '/' ? t('common.root-directory') : folder.name;
            }
			const wordCount = this.plugin.cacheManager.getFolderWordCount(folderPath) || 0;
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
		} else {
			this.workNameEl.innerText = '--';
			this.workWordCountEl.innerText = '';
			this.workGoalEl.hide();
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

		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const isEligibleChapter = !!(activeMarkdownView?.file && this.plugin.cacheManager.isEligibleForWordCount(activeMarkdownView.file));

		if (this.chapterSectionEls) {
			for (const el of this.chapterSectionEls) {
				if (isEligibleChapter) { el.show(); } else { el.hide(); }
			}
		}

		this.todayWordEl.innerText = coreStats.todayWords.toLocaleString();
		this.goalWordEl.innerText = coreStats.goal.toLocaleString();

		this.percentEl.innerText = ` ${coreStats.percent}%`;

		const chapterDone = coreStats.goal > 0 && coreStats.todayWords >= coreStats.goal;
		const chapterState = chapterDone ? 'done' : 'normal';
		this.setProgressState(this.progressFillEl, this.todayWordEl, null, chapterState, coreStats.percent);

		// 任务目标进度：基于目录判断，无活跃 MarkdownView 时使用上次文件夹
		const taskFolder = folderPath;

		let hasActiveTask = false;
		if (taskFolder && this.plugin.taskManager) {
			const manager = this.plugin.taskManager;
			manager.currentFolder = taskFolder;
			const taskFile = manager.getTaskFile();
			if (taskFile) {
				const taskContent = await this.plugin.app.vault.cachedRead(taskFile);
				const entries = manager.parseEntries(taskContent);
				const active = manager.getActiveTask(entries);
				hasActiveTask = !!active;

				if (this.taskSectionEls) {
					for (const el of this.taskSectionEls) {
						if (hasActiveTask) { el.show(); } else { el.hide(); }
					}
				}

				if (active) {
					if (active.taskType === 'event') {
						this.taskRowEl.addClass('is-event-task');
						this.taskWordEl.empty();
						const titleText = active.platform || t('common.task-event');
						if (active.position) {
							this.taskWordEl.createDiv({ cls: 'event-task-title', text: titleText + ' -' });
							this.taskWordEl.createDiv({ cls: 'event-task-detail', text: active.position });
						} else {
							this.taskWordEl.createDiv({ cls: 'event-task-title', text: titleText });
						}
						this.taskSeparatorEl.setCssProps({ display: 'none' });
						this.taskTargetEl.setCssProps({ display: 'none' });
						this.taskPercentEl.setCssProps({ display: 'none' });
						this.taskProgressFillEl.parentElement?.setCssProps({ display: 'none' });
						this.taskEventCompleteBtn.setCssProps({ display: 'block' });
						const daysLeft = Math.max(0, window.moment(active.endDate).diff(window.moment().startOf('day'), 'days') + 1);
						const endShort = active.endDate.substring(5);
						this.taskTimeDescEl.setText(t('common.task-deadline-remaining', { date: endShort, days: String(daysLeft) }));
						this.taskTimeDescEl.removeClass('task-reached');
					} else {
						this.taskRowEl.removeClass('is-event-task');
						this.taskSeparatorEl.setCssProps({ display: 'inline' });
						this.taskTargetEl.setCssProps({ display: 'inline' });
						this.taskPercentEl.setCssProps({ display: 'inline' });
						this.taskProgressFillEl.parentElement?.setCssProps({ display: 'block' });
						this.taskEventCompleteBtn.setCssProps({ display: 'none' });
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
		}

		if (!isMobile()) {
			const focusSec = Math.round(this.plugin.focusMs / 1000);
			const slackSec = Math.round(this.plugin.slackMs / 1000);
			const totalSec = focusSec + slackSec;

			if (this.focusTimeEl) this.focusTimeEl.innerText = formatTime(focusSec);
			if (this.slackTimeEl) this.slackTimeEl.innerText = formatTime(slackSec);
			if (this.totalTimeEl) this.totalTimeEl.innerText = formatTime(totalSec);
		}

		void this.updateChapterStatus();
		this.updateWordStats();
		this.renderMiniChart();
	}

	private lastChapterMtime: number = -1;
	private lastForeshadowingMtime: number = -1;
	private lastChapterStatusStr: string = '';
	private lastChapterSynopsisStr: string = '';

	private async updateChapterStatus() {
		if (!this.chapterStatusCardEl || !this.chapterBadgesContainer) return;

		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			this.currentChapterFile = null;
			this.lastChapterMtime = -1;
			this.chapterStatusCardEl.hide();
			return;
		}

		const bookPath = this.plugin.characterManager.getBookPathForFile(file);
		if (!bookPath || this.plugin.characterManager.isLorePath(bookPath, file.parent?.path || '')) {
			this.currentChapterFile = null;
			this.lastChapterMtime = -1;
			this.chapterStatusCardEl.hide();
			return;
		}

		if (!ChapterSorter.isChapterFile(file.name) && !this.plugin.isFileInStrictChapterException(file)) {
			this.currentChapterFile = null;
			this.lastChapterMtime = -1;
			this.chapterStatusCardEl.hide();
			return;
		}

		const fmFolder = bookPath === '/' ? '' : bookPath;
		const fFile = this.plugin.foreshadowingManager?.findForeshadowingFile(fmFolder);
		if (fFile && fFile.path === file.path) {
			this.currentChapterFile = null;
			this.lastChapterMtime = -1;
			this.chapterStatusCardEl.hide();
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		
		const synopsis = (frontmatter?.synopsis || frontmatter?.Synopsis || frontmatter?.['摘要'] || '') as string;
		const rawStatus = (frontmatter?.status || frontmatter?.Status || frontmatter?.['状态'] || 'unwritten') as string;
		const status = CORKBOARD_STATUS_MAP[rawStatus] ?? rawStatus;
		const currentFmtime = fFile ? fFile.stat.mtime : -1;

		if (
			this.currentChapterFile?.path === file.path &&
			file.stat.mtime === this.lastChapterMtime &&
			currentFmtime === this.lastForeshadowingMtime &&
			status === this.lastChapterStatusStr &&
			synopsis === this.lastChapterSynopsisStr
		) {
			this.chapterStatusCardEl.show();
			return;
		}

		this.currentChapterFile = file;
		this.lastChapterMtime = file.stat.mtime;
		this.lastForeshadowingMtime = currentFmtime;
		this.lastChapterStatusStr = status;
		this.lastChapterSynopsisStr = synopsis;

		this.chapterStatusCardEl.show();
		this.chapterBadgesContainer.empty();
		this.chapterSubInfoEl.empty();
		this.chapterBadgesContainer.addClass('wn-chapter-badges-container');

		// 1. Set Chapter Title
		if ((this.chapterTitleEl as CollapsibleTitleElement).setOriginalTitle) {
			(this.chapterTitleEl as CollapsibleTitleElement).setOriginalTitle!(file.basename);
		} else {
			this.chapterTitleEl.innerText = file.basename;
		}

		// 2. Set Status and Synopsis
		this.chapterStatusBadgeEl.setText(getCorkboardStatusText(status));
		this.chapterStatusBadgeEl.className = `wn-chapter-title-badge status-${status} wn-clickable`;
		this.chapterStatusBadgeEl.title = t('corkboard.click-to-change-status');

		if (synopsis.trim() !== '') {
			const synopsisEl = this.chapterSubInfoEl.createDiv({ cls: 'wn-chapter-synopsis-text' });
			synopsisEl.setText(synopsis);
		}

		const pendingEntries: ParsedForeshadowingEntry[] = [];
		const recoveredHereEntries: ParsedForeshadowingEntry[] = [];
		const resolvedOriginEntries: ParsedForeshadowingEntry[] = [];

		const cleanBase = file.basename.toLowerCase().replace(/\s+/g, '');

		const isMatch = (target: string | undefined): boolean => {
			if (!target) return false;
			const cleanTarget = target.toLowerCase().replace(/\s+/g, '');
			return cleanBase.includes(cleanTarget) || cleanTarget.includes(cleanBase);
		};

		if (fFile) {
			const content = await this.app.vault.cachedRead(fFile);
			const entries = this.plugin.foreshadowingManager.parseEntries(content);

			for (const entry of entries) {
				const matchSource = isMatch(entry.sourceFile) || (entry.contents || []).some(c => isMatch(c.source));

				if (entry.status === ForeshadowingStatus.Pending) {
					if (matchSource) pendingEntries.push(entry);
				} else if (entry.status === ForeshadowingStatus.PartiallyRecovered) {
					const matchRecovery = (entry.recoveryLogs || []).some(l => isMatch(l.file)) || (entry.recoveryFiles || []).some(f => isMatch(f)) || isMatch(entry.recoveryFile);
					if (matchSource) pendingEntries.push(entry);
					if (matchRecovery && !matchSource) recoveredHereEntries.push(entry);
				} else if (entry.status === ForeshadowingStatus.Recovered) {
					const matchRecovery = (entry.recoveryLogs || []).some(l => isMatch(l.file)) || (entry.recoveryFiles || []).some(f => isMatch(f)) || isMatch(entry.recoveryFile);
					if (matchSource) resolvedOriginEntries.push(entry);
					if (matchRecovery && !matchSource) recoveredHereEntries.push(entry);
				}
			}
		}

		const loreArray = cache?.frontmatter?.lore as unknown;
		let validLores: string[] = [];
		if (Array.isArray(loreArray)) {
			validLores = (loreArray as unknown[]).filter((l: unknown): l is string => typeof l === 'string');
		}

		// 点击伏笔条目，跳转到正文中对应文本位置
		const setupJumpEvent = (el: HTMLElement, primarySearch: string, fallbackSearch?: string) => {
			el.addClass('wn-clickable');
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				void smartLocateAndHighlight(this.app, file, [primarySearch, fallbackSearch]);
			});
		};

		if (pendingEntries.length > 0) {
			const pendingDiv = this.chapterBadgesContainer.createDiv('wn-chapter-status-section');
			pendingDiv.createDiv({ text: t('corkboard.foreshadowing-unresolved'), cls: 'wn-chapter-status-section-title is-pending' });
			
			for (const entry of pendingEntries) {
				let matchedContent: { text: string } | undefined;
				for (const c of entry.contents) {
					if (isMatch(c.source)) {
						matchedContent = c;
						break;
					}
				}
				const textContent = entry.description || (matchedContent ? matchedContent.text : (entry.contents.length > 0 ? entry.contents[0].text : (t('common.unknown-foreshadowing'))));
				const itemEl = pendingDiv.createDiv({ text: textContent, cls: 'wn-chapter-status-item' });
				const findText = matchedContent ? matchedContent.text : (entry.contents.length > 0 ? entry.contents[0].text : entry.description);
				if (findText) setupJumpEvent(itemEl, findText);
			}
		}

		if (resolvedOriginEntries.length > 0) {
			const resolvedOriginDiv = this.chapterBadgesContainer.createDiv('wn-chapter-status-section');
			resolvedOriginDiv.createDiv({ text: t('corkboard.foreshadowing-recovered-origin'), cls: 'wn-chapter-status-section-title' });
			for (const entry of resolvedOriginEntries) {
				let matchedContent: { text: string } | undefined;
				for (const c of entry.contents) {
					if (isMatch(c.source)) {
						matchedContent = c;
						break;
					}
				}
				const textContent = entry.description || (matchedContent ? matchedContent.text : (entry.contents.length > 0 ? entry.contents[0].text : (t('common.unknown-foreshadowing'))));
				const itemEl = resolvedOriginDiv.createDiv({ text: textContent, cls: 'wn-chapter-status-item is-recovered' });
				const findText = matchedContent ? matchedContent.text : (entry.contents.length > 0 ? entry.contents[0].text : entry.description);
				if (findText) setupJumpEvent(itemEl, findText);
			}
		}

		if (recoveredHereEntries.length > 0) {
			const recoveredDiv = this.chapterBadgesContainer.createDiv('wn-chapter-status-section');
			recoveredDiv.createDiv({ text: t('corkboard.foreshadowing-recovered'), cls: 'wn-chapter-status-section-title' });
			for (const entry of recoveredHereEntries) {
				const matchedLog = (entry.recoveryLogs || []).find(l => isMatch(l.file));
				const matchedContent = (entry.contents || []).find(c => isMatch(c.source));
				const textContent = entry.description || (matchedLog?.note || (matchedContent ? matchedContent.text : (entry.contents.length > 0 ? entry.contents[0].text : (t('common.unknown-foreshadowing')))));
				const itemEl = recoveredDiv.createDiv({ text: textContent, cls: 'wn-chapter-status-item is-recovered' });

				const primarySearch = matchedLog?.quote || matchedLog?.note || matchedContent?.text || (entry.contents.length > 0 ? entry.contents[0].text : '');
				setupJumpEvent(itemEl, primarySearch, entry.description);
			}
		}

		if (validLores.length > 0) {
			const loreDiv = this.chapterBadgesContainer.createDiv('wn-chapter-status-section is-lore');
			
			// Add a small divider
			if (pendingEntries.length > 0 || recoveredHereEntries.length > 0 || resolvedOriginEntries.length > 0) {
				loreDiv.createDiv({ cls: 'wn-chapter-status-divider' });
			}
			
			const loreItemsRow = loreDiv.createDiv({ cls: 'wn-chapter-lore-row' });
			for (const loreNameWithCount of validLores) {
				loreItemsRow.createSpan({ text: loreNameWithCount, cls: 'wn-badge wn-badge-lore' });
			}
		}
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

	renderMiniChart(force = false) {
		const history = this.plugin.historyManager.getHistory();
		const dates = Object.keys(history).sort().slice(-7);

		const currentSnapshot = dates.map(d => `${d}:${history[d]?.addedWords ?? 0}`).join('|');
		if (!force && this.lastHistorySnapshot === currentSnapshot) return;
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
		const streak = this.plugin.statisticsManager.calcStreak(history);
		const focusRate = this.plugin.statisticsManager.calcFocusRate(history, startDate, endDate);
		const speed = this.plugin.statisticsManager.calcWritingSpeed(history, startDate, endDate);
		const dailyAvg = this.plugin.statisticsManager.calcDailyAverage(history, startDate, endDate);

		const parts = [
			t('common.consecutive-days', { count: streak }),
			t('common.focus-percent', { rate: focusRate }),
			t('common.writing-speed-fmt', { speed: speed > 0 ? formatCount(speed) : '--' }),
			t('common.daily-average', { count: formatCount(dailyAvg) }),
		].filter(Boolean);

		this.efficiencySummaryEl.setText(parts.join(' · '));
	}

	async onClose() {
		if (this.taskSaveTimer !== null) {
			window.clearTimeout(this.taskSaveTimer);
			this.taskSaveTimer = null;
		}
		await super.onClose();
	}
}