import { showPluginNotice } from '../services/PluginNoticeService';
import type { WorkspaceLeaf, ViewStateResult, TAbstractFile } from 'obsidian';
import { ItemView, TFile, TFolder, setIcon, setTooltip, Menu, MarkdownView } from 'obsidian';
import { formatTime, formatCount } from '../utils';
import { smartLocateAndHighlight } from '../utils/leaf';

import { HistoryStatsModal, type HistoryStatsModalPlugin } from './HistoryModal';
import { bindDailyStatsTrigger } from './DailyStatsModal';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import { CORKBOARD_STATUS_MAP, getCorkboardStatusText, getCorkboardStatusKeys } from '../i18n/data-keys';
import { findBookRoot, getCurrentBookContext, type CurrentBookContextPlugin } from '../utils/path';
import { t } from '../i18n';
import type { TaskType } from '../types/task';
import type { AccurateCountSettings } from '../types/settings';
import type { CacheManager } from '../services/CacheManager';
import type { TaskManager } from '../services/TaskManager';
import type { HomepageManager } from '../services/HomepageManager';
import type { CharacterManager } from '../services/CharacterManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import { getTimelineNodeDisplayTime, type TimelineManager, type ChapterTimelineNode } from '../services/TimelineManager';
import type { StatisticsManager } from '../services/StatisticsManager';
import type { WritingJourneyService } from '../services/WritingJourneyService';
import type { ImmersiveModeManager } from './ImmersiveModeManager';
import { ChapterSorter, type ChapterSorterContext } from '../services/ChapterSorter';
import { Logger } from '../utils/Logger';

export const STATUS_VIEW_TYPE = 'writing-status-view';

export type WritingStatusViewMode = 'full' | 'chapter-only';

export type StatusViewTaskManager = Pick<
	TaskManager,
	| 'updateEntryStatus'
	| 'getTaskFile'
	| 'parseEntries'
	| 'loadEntries'
	| 'getActiveTask'
	| 'calcProgress'
	| 'updateProgress'
	| 'reconcileTasks'
>;

export type StatusViewCacheManager = Pick<
	CacheManager,
	'getFolderWordCount' | 'isEligibleForWordCount'
>;

export type StatusViewHomepageManager = Pick<
	HomepageManager,
	| 'findNovelInfoFile'
	| 'getHomepageFilePath'
	| 'getNovelFolders'
	| 'getNovelMetadata'
	| 'refreshHomepageViews'
>;

export type StatusViewCharacterManager = Pick<
	CharacterManager,
	'getBookPathForFile' | 'isLorePath'
> & {
	readonly cacheVersion?: number;
};

export type StatusViewForeshadowingManager = Pick<
	ForeshadowingManager,
	'findForeshadowingFile' | 'parseEntries'
>;

export type StatusViewTimelineManager = Pick<
	TimelineManager,
	'findTimelineFile' | 'parseEntries' | 'getTimelineNodesForChapter'
>;

export type StatusViewStatisticsManager = Pick<
	StatisticsManager,
	| 'getCoreStats'
	| 'getSessionSpeed'
	| 'calcStreak'
	| 'calcFocusRate'
	| 'calcActiveHours'
	| 'calcDailyAverage'
	| 'calcWritingSpeed'
	| 'calcTaskCompletion'
	| 'calcNovelCompletionRate'
	| 'aggregateHistoryData'
	| 'getDailyStats'
>;

export type WritingStatusViewSettings = Pick<
	AccurateCountSettings,
	| 'heatmapStartDate'
	| 'heatmapEndDate'
	| 'workspaceFolders'
	| 'loreFolderName'
	| 'timeline'
	| 'foreshadowing'
	| 'novelInfo'
	| 'homepagePath'
	| 'enableStrictChapterMode'
	| 'customSortOrder'
> & Partial<Pick<AccurateCountSettings, 'chapterNamingRules' | 'strictChapterExceptions'>>;

export interface WritingStatusViewPlugin
	extends Omit<HistoryStatsModalPlugin, 'settings' | 'homepageManager' | 'statisticsManager'>,
		Omit<CurrentBookContextPlugin, 'settings' | 'homepageManager'>,
		Omit<ChapterSorterContext, 'settings' | 'homepageManager'> {
	settings: WritingStatusViewSettings;
	isTracking: boolean;
	focusMs: number;
	slackMs: number;
	startTracking(): void;
	stopTracking(): void;
	refreshStatusViews(force?: boolean): void;
	cacheManager: StatusViewCacheManager;
	characterManager: StatusViewCharacterManager;
	statisticsManager: StatusViewStatisticsManager;
	homepageManager?: StatusViewHomepageManager;
	foreshadowingManager?: StatusViewForeshadowingManager;
	timelineManager?: StatusViewTimelineManager;
	taskManager?: StatusViewTaskManager;
	writingJourneyService?: Pick<WritingJourneyService, 'changeChapterStatus'>;
	immersiveModeManager?: Pick<ImmersiveModeManager, 'getMainEditorLeaf'> & {
		isMobileDataIsolationActive: () => boolean;
		getActiveSessionMainLeaf?: () => WorkspaceLeaf | null;
		getDataScopedMainLeaf?: () => WorkspaceLeaf | null;
		getDataScopedMainFile: () => TFile | null;
	};
}

interface CollapsibleTitleElement extends HTMLElement {
	refreshTitle?: () => void;
	setOriginalTitle?: (title: string) => void;
}

export class WritingStatusView extends ItemView {
	plugin: WritingStatusViewPlugin;
	private readonly viewMode: WritingStatusViewMode;

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
	sessionSpeedEl!: HTMLElement;
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
	private lastRenderedChapterPath: string | null = null;
	private updateGeneration = 0;
	private chapterEmptyStateEl: HTMLElement | null = null;
	private activeTaskContext: { folderPath: string; period: number; taskType: TaskType } | null = null;
	private lastReconciledDateByFolder = new Map<string, string>();
	private inFlightReconcile = new Map<string, Promise<boolean>>();

	/**
	 * 针对指定书目文件夹执行每日至多一次的任务调和
	 * 防止按键高频刷新触发冗余状态写入，同时确保跨日/切书即时生效
	 */
	private async reconcileTaskLifecycleForFolder(
		taskFolder: string,
		generation: number = this.updateGeneration,
		currentDate?: string
	): Promise<boolean> {
		if (!this.plugin.taskManager) return false;
		const manager = this.plugin.taskManager;
		const taskFile = manager.getTaskFile(taskFolder);
		if (!taskFile) return false;

		const normalizedFolder = !taskFolder || taskFolder === '/' ? '' : taskFolder.replace(/^\/+|\/+$/g, '');
		const today = currentDate ?? window.moment().format('YYYY-MM-DD');

		const inFlight = this.inFlightReconcile.get(normalizedFolder);
		if (inFlight) {
			await inFlight;
			if (generation !== this.updateGeneration) return false;
			return false;
		}

		if (this.lastReconciledDateByFolder.get(normalizedFolder) === today) {
			return false;
		}

		const reconcilePromise = (async () => {
			try {
				const res = await manager.reconcileTasks(taskFolder, true);
				this.lastReconciledDateByFolder.set(normalizedFolder, today);
				return res;
			} catch (err) {
				this.lastReconciledDateByFolder.delete(normalizedFolder);
				(window.console || console).error('[WritingStatusView] Failed to reconcile tasks:', err);
				return false;
			} finally {
				this.inFlightReconcile.delete(normalizedFolder);
			}
		})();

		this.inFlightReconcile.set(normalizedFolder, reconcilePromise);
		const result = await reconcilePromise;
		if (generation !== this.updateGeneration) return false;
		return result;
	}

	constructor(leaf: WorkspaceLeaf, plugin: WritingStatusViewPlugin, mode: WritingStatusViewMode = 'full') {
		super(leaf);
		this.plugin = plugin;
		this.viewMode = mode;
		this.registerDataEvents();
	}

	private isChapterOnlyMode(): boolean {
		return this.viewMode === 'chapter-only';
	}

	private isViewMounted(): boolean {
		return this.isChapterOnlyMode() ? !!this.chapterStatusCardEl : !!this.workNameEl;
	}

	private getOwningWindow(): Window {
		return this.containerEl?.ownerDocument?.defaultView ?? window;
	}

	private clearUpdateDebounceTimer(): void {
		if (this.updateDebounceTimer !== null) {
			(this.updateDebounceTimerWindow ?? this.getOwningWindow()).clearTimeout(this.updateDebounceTimer);
			this.updateDebounceTimer = null;
			this.updateDebounceTimerWindow = null;
		}
	}

	private setChapterEmptyStateVisible(visible: boolean): void {
		if (!this.chapterEmptyStateEl) return;
		if (visible) {
			this.chapterEmptyStateEl.show();
		} else {
			this.chapterEmptyStateEl.hide();
		}
	}

	private getImmersiveMainTargetFile(): TFile | null {
		const imm = this.plugin.immersiveModeManager;
		if (imm?.isMobileDataIsolationActive()) {
			const explicitFile = imm?.getDataScopedMainFile();
			if (explicitFile instanceof TFile) return explicitFile;
		}
		const mainLeaf = imm?.getDataScopedMainLeaf?.() ?? imm?.getActiveSessionMainLeaf?.() ?? imm?.getMainEditorLeaf?.();
		if (!mainLeaf?.view) return null;

		const isMarkdown =
			mainLeaf.view instanceof MarkdownView ||
			mainLeaf.view.getViewType?.() === 'markdown';
		if (!isMarkdown) return null;

		const leafFile = (mainLeaf.view as MarkdownView).file;
		return leafFile instanceof TFile ? leafFile : null;
	}

	private registerDataEvents(): void {
		const refreshForFile = (file: TAbstractFile, oldPath?: string) => {
			if (!this.isViewMounted()) return;
			if (file instanceof TFile && file.extension !== 'md') return;

			if (this.chapterAssociationCache) {
				const fPath = this.chapterAssociationCache.foreshadowingPath;
				const tlPath = this.chapterAssociationCache.timelinePath;
				if ((fPath && (file.path === fPath || oldPath === fPath))
					|| (tlPath && (file.path === tlPath || oldPath === tlPath))) {
					this.chapterAssociationCache = null;
				}
			}

			// 1. 匹配当前已选中的章节文档
			const currentChapterPath = this.currentChapterFile?.path;
			if (currentChapterPath && (file.path === currentChapterPath || oldPath === currentChapterPath)) {
				void this.updateData();
				return;
			}

			// 2. 匹配当前活动 Markdown 文档（例如从未命中章节的普通笔记重命名为有效章节）
			let activePath: string | undefined;
			if (this.isChapterOnlyMode()) {
				const mainFile = this.getImmersiveMainTargetFile();
				if (mainFile instanceof TFile) {
					activePath = mainFile.path;
				}
			} else {
				const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeMarkdown?.file instanceof TFile) {
					activePath = activeMarkdown.file.path;
				} else {
					const rootLeaf = this.app.workspace.getMostRecentLeaf?.();
					if (rootLeaf && (rootLeaf.view instanceof MarkdownView || rootLeaf.view?.getViewType() === 'markdown')) {
						const fileView = rootLeaf.view as MarkdownView;
						if (fileView.file instanceof TFile) {
							activePath = fileView.file.path;
						}
					}
				}
			}
			if (activePath && (file.path === activePath || oldPath === activePath)) {
				void this.updateData();
				return;
			}

			// 3. 匹配当前章节或活动文档所在直接目录及祖先目录的重命名/移动
			const targetPaths: string[] = [];
			if (currentChapterPath) targetPaths.push(currentChapterPath);
			if (activePath && activePath !== currentChapterPath) targetPaths.push(activePath);

			for (const target of targetPaths) {
				const isContainingFolder = (folderPath: string) => {
					if (!folderPath || folderPath === '/') return false;
					const norm = folderPath.replace(/\/+$/, '');
					return target.startsWith(norm + '/');
				};

				if (isContainingFolder(file.path) || (oldPath !== undefined && isContainingFolder(oldPath))) {
					void this.updateData();
					return;
				}
			}

			// 当前章节所在目录的总字数也会受同目录其他文档影响。
			const parentPath = this.currentChapterFile?.parent?.path;
			if (parentPath !== undefined) {
				const folder = parentPath === '/' ? '' : parentPath;
				const belongsToParent = (path: string) => !folder || path === folder || path.startsWith(folder + '/');
				if (belongsToParent(file.path) || (oldPath !== undefined && belongsToParent(oldPath))) {
					void this.updateData();
					return;
				}
			}

			// 4. 匹配保留作品目录范围内的变动
			if (this.lastActiveFolderPath) {
				const folder = this.lastActiveFolderPath === '/' ? '' : this.lastActiveFolderPath;
				const belongsToWork = (path: string) => !folder || path === folder || path.startsWith(folder + '/');
				if (belongsToWork(file.path) || (oldPath !== undefined && belongsToWork(oldPath))) {
					void this.updateData();
					return;
				}
			}

			// 5. 匹配当前选中章节所属真实作品目录范围内的变动（例如时间线新建、修改或删除）
			if (this.currentChapterFile) {
				const currentBookRoot = findBookRoot(this.app, this.plugin, this.currentChapterFile, true);
				if (currentBookRoot) {
					const folder = currentBookRoot === '/' ? '' : currentBookRoot;
					const belongsToBook = (path: string) => !folder || path === folder || path.startsWith(folder + '/');
					if (belongsToBook(file.path) || (oldPath !== undefined && belongsToBook(oldPath))) {
						void this.updateData();
						return;
					}
				}
			}
		};
		if (this.app.vault?.on) {
			const onStructureChange = (file: TAbstractFile, oldPath?: string) => {
				this.chapterStructureVersion++;
				refreshForFile(file, oldPath);
			};
			this.registerEvent(this.app.vault.on('create', onStructureChange));
			this.registerEvent(this.app.vault.on('modify', refreshForFile));
			this.registerEvent(this.app.vault.on('rename', onStructureChange));
			this.registerEvent(this.app.vault.on('delete', onStructureChange));
		}
		if (this.app.metadataCache?.on) {
			this.registerEvent(this.app.metadataCache.on('changed', (file) => {
				const association = this.chapterAssociationCache;
				if (association?.bookRoot && file !== association.chapterFile
					&& findBookRoot(this.app, this.plugin, file, true) === association.bookRoot) {
					this.chapterAssociationCache = null;
				}
				refreshForFile(file);
			}));
		}
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

	getState(): Record<string, unknown> {
		if (this.isChapterOnlyMode()) {
			return super.getState();
		}
		return { ...super.getState(), currentBookPath: this.lastActiveFolderPath };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		if (!this.isChapterOnlyMode() && state && typeof state === 'object' && 'currentBookPath' in state && typeof state.currentBookPath === 'string') {
			const folder = this.app.vault.getAbstractFileByPath(state.currentBookPath);
			if (folder instanceof TFolder && findBookRoot(this.app, this.plugin, folder, true) === folder.path) {
				if (this.lastActiveFolderPath !== folder.path) {
					this.currentChapterFile = null;
					this.resetChapterStatusCache();
				}
				this.lastActiveFolderPath = folder.path;
			}
		}
		if (this.isViewMounted()) await this.updateData(true);
	}

	private preventWorkspaceFocus(el: HTMLElement): void {
		el.addEventListener('mousedown', (event: MouseEvent) => {
			if (event.button === 0) event.preventDefault();
		});
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('wn-status-view-container');

		if (this.isChapterOnlyMode()) {
			container.addClass('wn-immersive-chapter-status-container');
			this.createChapterStatusCard(container);
			this.chapterEmptyStateEl = container.createDiv({
				cls: 'wn-immersive-chapter-status-empty',
				text: t('immersive.chapter-status-empty')
			});
			this.chapterEmptyStateEl.hide();
			void this.updateData(true);
			return;
		}

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
		this.preventWorkspaceFocus(titleRow);
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
		this.workGoalEl = card.createDiv({ cls: 'wn-work-info-goal' });
		this.workGoalEl.addClass('webnovel-work-goal'); this.workGoalEl.hide();
	}

	private createGoalCard(container: Element) {
		const goalCard = container.createDiv({ cls: 'wn-status-card' });
		const titleRow = goalCard.createDiv({ cls: 'wn-status-title' });
		const titleLeft = titleRow.createDiv({ cls: 'wn-status-title-left' });
		const titleSpan = titleLeft.createSpan({ text: t('common.today-status') });

		this.statusBadgeEl = titleLeft.createSpan({
			cls: 'wn-status-title-badge wn-clickable',
			text: t(this.plugin.isTracking ? 'status.recording' : 'status.paused')
		});
		this.statusBadgeEl.setAttribute('role', 'button');
		this.statusBadgeEl.setAttribute('tabindex', '0');
		this.statusBadgeEl.setAttribute('aria-pressed', String(this.plugin.isTracking));
		setTooltip(this.statusBadgeEl, t('common.click-to-toggle-status'));
		const toggleTracking = () => {
			if (this.plugin.isTracking) {
				this.plugin.stopTracking();
			} else {
				this.plugin.startTracking();
			}
		};
		this.statusBadgeEl.addEventListener('click', e => {
			e.stopPropagation();
			toggleTracking();
		});
		this.statusBadgeEl.addEventListener('keydown', e => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			e.preventDefault();
			e.stopPropagation();
			toggleTracking();
		});

		const contentContainer = goalCard.createDiv({ cls: 'wn-status-card-content' });
		this.setupCollapsibleCard(titleRow, titleSpan, contentContainer, () => t('common.today-status'));

		// 今日目标：小标题 + 百分比居右同行
		const dailyLabelRow = contentContainer.createDiv({ cls: 'wn-status-goal-row' });
		dailyLabelRow.createSpan({ cls: 'wn-status-goal-label', text: t('common.today-goal') });
		this.dailyPercentEl = dailyLabelRow.createSpan({ cls: 'wn-goal-percent', text: '0%' });

		const dailyRow = contentContainer.createDiv({ cls: 'wn-goal-display-row-right' });
		this.dailyWordEl = dailyRow.createSpan({ cls: 'wn-goal-current', text: '0' });
		dailyRow.createSpan({ cls: 'wn-goal-separator', text: ' / ' });
		this.dailyGoalEl = dailyRow.createSpan({ cls: 'wn-goal-target', text: '0' });
		const dailyProgressBg = contentContainer.createDiv({ cls: 'wn-progress-bar-bg' });
		this.dailyProgressFillEl = dailyProgressBg.createDiv({ cls: 'wn-progress-bar-fill' });

		// 章节目标：小标题 + 百分比居右同行
		const chapterLabelRow = contentContainer.createDiv({ cls: 'wn-status-goal-row' });
		chapterLabelRow.createSpan({ cls: 'wn-status-goal-label', text: t('common.chapter-goal') });
		this.percentEl = chapterLabelRow.createSpan({ cls: 'wn-goal-percent', text: '0%' });

		const goalRow = contentContainer.createDiv({ cls: 'wn-goal-display-row-right' });
		this.todayWordEl = goalRow.createSpan({ cls: 'wn-goal-current', text: '0' });
		goalRow.createSpan({ cls: 'wn-goal-separator', text: ' / ' });
		this.goalWordEl = goalRow.createSpan({ cls: 'wn-goal-target', text: '0' });
		const progressBg = contentContainer.createDiv({ cls: 'wn-progress-bar-bg' });
		this.progressFillEl = progressBg.createDiv({ cls: 'wn-progress-bar-fill' });

		this.chapterSectionEls = [chapterLabelRow, goalRow, progressBg];

		// 任务目标
		const taskLabelRow = contentContainer.createDiv({ cls: 'wn-status-goal-row wn-task-goal-section' });
		taskLabelRow.hide();
		taskLabelRow.createSpan({ cls: 'wn-status-goal-label', text: t('common.task-goal') });
		this.taskPercentEl = taskLabelRow.createSpan({ cls: 'wn-goal-percent', text: '0%' });

		this.taskRowEl = contentContainer.createDiv({ cls: 'wn-goal-display-row-right wn-task-goal-section' });
		this.taskRowEl.hide();
		this.taskWordEl = this.taskRowEl.createSpan({ cls: 'wn-goal-current', text: '0' });
		this.taskSeparatorEl = this.taskRowEl.createSpan({ cls: 'wn-goal-separator', text: ' / ' });
		this.taskTargetEl = this.taskRowEl.createSpan({ cls: 'wn-goal-target', text: '0' });

		this.taskEventCompleteBtn = this.taskRowEl.createEl('button', { cls: 'wn-status-task-complete-btn', text: t('common.complete-task') });
		this.preventWorkspaceFocus(this.taskEventCompleteBtn);
		this.taskEventCompleteBtn.hide();
		this.taskEventCompleteBtn.onclick = () => {
			const taskContext = this.activeTaskContext;
			if (!this.plugin.taskManager || !taskContext || taskContext.taskType !== 'event') return;
			const manager = this.plugin.taskManager;
			void manager.updateEntryStatus(
				taskContext.period,
				'completed',
				undefined,
				taskContext.taskType,
				taskContext.folderPath
			).then(() => {
				showPluginNotice(t('notice.task-completed'));
			});
		};

		const taskProgressBg = contentContainer.createDiv({ cls: 'wn-progress-bar-bg wn-task-goal-section' });
		taskProgressBg.hide();
		this.taskProgressFillEl = taskProgressBg.createDiv({ cls: 'wn-progress-bar-fill' });

		const taskTimeDesc = contentContainer.createDiv({ cls: 'wn-task-time-desc wn-task-goal-section' });
		taskTimeDesc.hide();
		this.taskTimeDescEl = taskTimeDesc;

		this.taskSectionEls = [taskLabelRow, this.taskRowEl, taskProgressBg, taskTimeDesc];
	}

	private createTimeCard(container: Element) {
		const timeCard = container.createDiv({ cls: 'wn-status-card' });
		const titleRow = timeCard.createDiv({ cls: 'wn-status-title' });
		const titleSpan = titleRow.createSpan({ text: t('common.focus-timing') });
		
		const contentContainer = timeCard.createDiv({ cls: 'wn-status-card-content' });
		this.setupCollapsibleCard(titleRow, titleSpan, contentContainer, () => t('common.focus-timing'));

		const timeGrid = contentContainer.createDiv({ cls: 'wn-time-grid' });

		const totalBox = timeGrid.createDiv({ cls: 'wn-time-box' });
		totalBox.createDiv({ cls: 'wn-time-box-title', text: t('common.total-elapsed') });
		this.totalTimeEl = totalBox.createDiv({ cls: 'wn-time-box-value', text: '00:00:00' });

		const speedBox = timeGrid.createDiv({ cls: 'wn-time-box' });
		speedBox.createDiv({ cls: 'wn-time-box-title', text: `${t('common.session-speed')} (${t('common.words-per-hour-unit')})` });
		this.sessionSpeedEl = speedBox.createDiv({ cls: 'wn-time-box-value', text: '0' });

		const focusBox = timeGrid.createDiv({ cls: 'wn-time-box' });
		focusBox.createDiv({ cls: 'wn-time-box-title', text: t('common.focus-duration') });
		this.focusTimeEl = focusBox.createDiv({ cls: 'wn-time-box-value', text: '00:00:00' });

		const slackBox = timeGrid.createDiv({ cls: 'wn-time-box' });
		slackBox.createDiv({ cls: 'wn-time-box-title', text: t('common.slack-duration') });
		this.slackTimeEl = slackBox.createDiv({ cls: 'wn-time-box-value', text: '00:00:00' });
	}

	private createHistoryCard(container: Element) {
		const historyCard = container.createDiv({ cls: 'wn-status-card' });
		const titleRow = historyCard.createDiv({ cls: 'wn-status-title' });
		const titleSpan = titleRow.createSpan({ text: t('common.word-count') });

		const contentContainer = historyCard.createDiv({ cls: 'wn-status-card-content' });
		this.setupCollapsibleCard(titleRow, titleSpan, contentContainer, () => t('common.word-count'));

		const historyGrid = contentContainer.createDiv({ cls: 'wn-time-grid' });

		const weekBox = historyGrid.createDiv({ cls: 'wn-time-box' });
		weekBox.createDiv({ cls: 'wn-time-box-title', text: t('common.weekly-net') });
		this.weekWordEl = weekBox.createDiv({ cls: 'wn-time-box-value', text: '0' });

		const monthBox = historyGrid.createDiv({ cls: 'wn-time-box' });
		monthBox.createDiv({ cls: 'wn-time-box-title', text: t('common.monthly-net') });
		this.monthWordEl = monthBox.createDiv({ cls: 'wn-time-box-value', text: '0' });

		const yearBox = historyGrid.createDiv({ cls: 'wn-time-box' });
		yearBox.createDiv({ cls: 'wn-time-box-title', text: t('common.yearly-net') });
		this.yearWordEl = yearBox.createDiv({ cls: 'wn-time-box-value', text: '0' });

		const histTotalBox = historyGrid.createDiv({ cls: 'wn-time-box' });
		histTotalBox.createDiv({ cls: 'wn-time-box-title', text: t('common.total-accumulated') });
		this.historyTotalWordEl = histTotalBox.createDiv({ cls: 'wn-time-box-value', text: '0' });

		// 近7日迷你柱状图
		const chartSection = contentContainer.createDiv({ cls: 'wn-history-chart' });

		const chartTitleRow = chartSection.createDiv({ cls: 'wn-history-chart-title-row' });
		chartTitleRow.createSpan({ text: t('common.recent-7days-writing'), cls: 'wn-history-chart-title' });
		const chartLink = chartTitleRow.createSpan({ text: t('common.details'), cls: 'wn-history-chart-subtitle' });
		this.preventWorkspaceFocus(chartLink);
		chartLink.onclick = () => {
			new HistoryStatsModal(this.app, this.plugin).open();
		};

		this.miniChartEl = chartSection.createDiv({ cls: 'wn-mini-chart-container' });
		this.preventWorkspaceFocus(this.miniChartEl);
		this.miniChartEl.onclick = () => {
			new HistoryStatsModal(this.app, this.plugin).open();
		};

		this.efficiencySummaryEl = chartSection.createDiv({ cls: 'wn-mini-efficiency-summary', text: '--' });
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
		this.chapterStatusBadgeEl.setAttribute('role', 'button');
		this.chapterStatusBadgeEl.setAttribute('tabindex', '0');
		setTooltip(this.chapterStatusBadgeEl, t('corkboard.click-to-change-status'));

		const openChapterStatusMenu = (evt: MouseEvent | KeyboardEvent, isKeyboard = false) => {
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
							if (s === currentStatus) return;
							try {
								if (!this.plugin.writingJourneyService?.changeChapterStatus) {
									showPluginNotice(t('corkboard.status-update-failed'));
									return;
								}
								const bookRoot = findBookRoot(this.app, this.plugin, file, true);
								const res = await this.plugin.writingJourneyService.changeChapterStatus({
									file,
									toStatus: s,
									bookPath: bookRoot || undefined
								});
								if (!res.success) {
									showPluginNotice(t('corkboard.status-update-failed'));
									return;
								}
								if (res.changed) {
									showPluginNotice(t('corkboard.status-updated', { status: getCorkboardStatusText(s) }));
									if (res.snapshotError) {
										showPluginNotice(t('snapshot.notice-unavailable'));
									}
									if (res.journeyError) {
										showPluginNotice(t('snapshot.journey-save-failed'));
									}
									void this.updateChapterStatus();
								}
							} catch (err) {
								window.console.error(err);
								showPluginNotice(t('corkboard.status-update-failed'));
							}
						});
				});
			}
			if (isKeyboard) {
				const rect = this.chapterStatusBadgeEl.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom }, this.chapterStatusBadgeEl.ownerDocument);
			} else {
				menu.showAtMouseEvent(evt as MouseEvent);
			}
		};

		this.chapterStatusBadgeEl.addEventListener('click', (evt: MouseEvent) => {
			openChapterStatusMenu(evt, false);
		});
		this.chapterStatusBadgeEl.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter' || evt.key === ' ') {
				evt.preventDefault();
				openChapterStatusMenu(evt, true);
			}
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

	private updateDebounceTimer: number | null = null;
	private updateDebounceTimerWindow: Window | null = null;
	private lastRenderedDate: string = '';

	public updateTimer(): void {
		if (this.isChapterOnlyMode()) return;
		const today = window.moment().format('YYYY-MM-DD');
		if (this.lastRenderedDate && this.lastRenderedDate !== today) {
			this.lastRenderedDate = today;
			void this.updateData(false);
			return;
		}
		const focusSec = Math.round(this.plugin.focusMs / 1000);
		const slackSec = Math.round(this.plugin.slackMs / 1000);
		const totalSec = focusSec + slackSec;

		if (this.focusTimeEl) this.focusTimeEl.innerText = formatTime(focusSec);
		if (this.slackTimeEl) this.slackTimeEl.innerText = formatTime(slackSec);
		if (this.totalTimeEl) this.totalTimeEl.innerText = formatTime(totalSec);
		if (this.sessionSpeedEl) this.sessionSpeedEl.innerText = String(this.plugin.statisticsManager.getSessionSpeed());
	}

	private resolveActiveEligibleChapter(): TFile | null {
		let activeFile: TFile | null = null;
		let activeMarkdown: MarkdownView | null = null;
		const imm = this.plugin.immersiveModeManager;
		const isMobileImmersive = imm?.isMobileDataIsolationActive() ?? false;
		if (this.isChapterOnlyMode() || isMobileImmersive) {
			activeFile = this.getImmersiveMainTargetFile();
		} else {
			activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeMarkdown?.file instanceof TFile) {
				activeFile = activeMarkdown.file;
			} else {
				const rootLeaf = this.app.workspace.getMostRecentLeaf?.();
				if (rootLeaf && (rootLeaf.view instanceof MarkdownView || rootLeaf.view?.getViewType() === 'markdown')) {
					const fileView = rootLeaf.view as MarkdownView;
					if (fileView.file instanceof TFile) {
						activeFile = fileView.file;
					}
				}
			}
		}

		if (activeFile && activeFile.extension === 'md') {
			const homepagePath = this.plugin.homepageManager?.getHomepageFilePath?.();
			const isHomepage = (homepagePath && activeFile.path === homepagePath) || activeFile.name === '创作主页.md';
			if (!isHomepage && this.plugin.cacheManager.isEligibleForWordCount(activeFile)) {
				const bookRoot = findBookRoot(this.app, this.plugin, activeFile, true);
				if (!this.isChapterOnlyMode() && !activeMarkdown && bookRoot && (!this.lastActiveFolderPath || bookRoot !== this.lastActiveFolderPath)) {
					return null;
				}
				let isLore = false;
				let isForeshadowing = false;
				let isTimeline = false;
				if (bookRoot) {
					isLore = this.plugin.characterManager?.isLorePath?.(bookRoot, activeFile.parent?.path || '') ?? false;
					const fmFolder = bookRoot === '/' ? '' : bookRoot;
					const fFile = this.plugin.foreshadowingManager?.findForeshadowingFile?.(fmFolder);
					isForeshadowing = !!(fFile && fFile.path === activeFile.path);
					const tlFile = this.plugin.timelineManager?.findTimelineFile?.(fmFolder);
					isTimeline = !!(tlFile && tlFile.path === activeFile.path);
				}
				if (!isLore && !isForeshadowing && !isTimeline) {
					const vaultFile = this.app.vault.getAbstractFileByPath(activeFile.path);
					if (vaultFile instanceof TFile) {
						return vaultFile;
					}
				}
			}
		}

		return null;
	}

	private captureActiveContext(): void {
		const previousChapterPath = this.currentChapterFile?.path;
		if (this.isChapterOnlyMode()) {
			const targetChapter = this.resolveActiveEligibleChapter();
			this.lastActiveFolderPath = targetChapter ? (findBookRoot(this.app, this.plugin, targetChapter, true) || null) : null;
			this.currentChapterFile = targetChapter;
			if (!targetChapter || targetChapter.path !== previousChapterPath) {
				this.resetChapterStatusCache();
				this.chapterStatusCardEl?.hide();
			}
			this.setChapterEmptyStateVisible(!targetChapter);
			return;
		}

		const contextPath = getCurrentBookContext(this.app, this.plugin, { fallback: false });
		if (contextPath) {
			const changed = this.lastActiveFolderPath !== contextPath;
			this.lastActiveFolderPath = contextPath;
			if (changed) this.app.workspace.requestSaveLayout();
		}

		const targetChapter = this.resolveActiveEligibleChapter();
		this.currentChapterFile = targetChapter;
		if (!targetChapter || targetChapter.path !== previousChapterPath) {
			this.resetChapterStatusCache();
			this.chapterStatusCardEl?.hide();
			for (const el of this.chapterSectionEls ?? []) el.hide();
		}
	}

	async updateData(immediate = false, force = false) {
		this.captureActiveContext();
		const generation = ++this.updateGeneration;
		if (immediate) {
			this.clearUpdateDebounceTimer();
			await this.performUpdateData(generation, force);
			return;
		}

		this.clearUpdateDebounceTimer();

		const owningWindow = this.getOwningWindow();
		this.updateDebounceTimerWindow = owningWindow;
		this.updateDebounceTimer = owningWindow.setTimeout(() => {
			this.updateDebounceTimer = null;
			this.updateDebounceTimerWindow = null;
			void this.performUpdateData(generation, force);
		}, 100);
	}

	private setTaskSectionVisible(visible: boolean): void {
		if (!this.taskSectionEls) return;
		for (const el of this.taskSectionEls) {
			if (visible) { el.show(); } else { el.hide(); }
		}
		if (!visible) {
			if (this.taskSaveTimer) {
				window.clearTimeout(this.taskSaveTimer);
				this.taskSaveTimer = null;
			}
			this.taskEventCompleteBtn.hide();
			this.activeTaskContext = null;
		}
	}

	private async performUpdateData(generation: number, force = false) {
		if (generation !== this.updateGeneration) return;
		this.captureActiveContext();
		if (this.isChapterOnlyMode()) {
			await this.updateChapterStatus(generation);
			return;
		}
		const targetChapter = this.currentChapterFile;
		const isEligibleChapter = !!targetChapter;

		let displayFolderPath = '';
		let bookRoot = '';

		if (targetChapter) {
			bookRoot = findBookRoot(this.app, this.plugin, targetChapter, true);
			const parent = targetChapter.parent;
			displayFolderPath = bookRoot || (parent && !parent.isRoot() ? parent.path : '/');
		} else {
			displayFolderPath = this.lastActiveFolderPath || '';
			if (!displayFolderPath) {
				const initialDefault = getCurrentBookContext(this.app, this.plugin);
				if (initialDefault) {
					displayFolderPath = initialDefault;
					this.lastActiveFolderPath = initialDefault;
				}
			}
		}

		// 任务目标进度：有活跃章节时以所属作品为准（独立章节无作品归属则不展示），无活跃章节时沿用保留作品
		const taskFolder = targetChapter ? bookRoot : (this.lastActiveFolderPath || '');

		if (this.activeTaskContext && this.activeTaskContext.folderPath !== taskFolder) {
			this.setTaskSectionVisible(false);
		}

		let folderName = '--';
		if (displayFolderPath) {
			if (displayFolderPath === '/') {
				folderName = t('common.root-directory');
			} else {
				const folder = targetChapter?.parent?.path === displayFolderPath
					? targetChapter.parent
					: this.app.vault.getAbstractFileByPath(displayFolderPath);
				if (folder) {
					folderName = folder.name;
				}
			}
			const wordCount = this.plugin.cacheManager.getFolderWordCount(displayFolderPath) || 0;

			this.workNameEl.innerText = folderName;
			this.workWordCountEl.innerText = wordCount > 0 ? `${wordCount.toLocaleString()}${t('common.word-char')}` : '';

			let wordGoal = 0;
			const shouldCheckGoal = displayFolderPath !== '/' && (!targetChapter || (bookRoot !== '' && displayFolderPath === bookRoot));
			const infoFile = shouldCheckGoal ? this.plugin.homepageManager?.findNovelInfoFile(displayFolderPath) : null;
			if (infoFile instanceof TFile) {
				const content = await this.app.vault.cachedRead(infoFile);
				if (generation !== this.updateGeneration) return;
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

		if (this.statusBadgeEl) {
			this.statusBadgeEl.setAttribute('aria-pressed', String(this.plugin.isTracking));
			if (this.plugin.isTracking) {
				this.statusBadgeEl.innerText = t('status.recording');
				this.statusBadgeEl.removeClass('wn-bg-muted'); 
			} else {
				this.statusBadgeEl.innerText = t('status.paused');
				this.statusBadgeEl.addClass('wn-bg-muted'); 
			}
		}

		const coreStats = this.plugin.statisticsManager.getCoreStats(targetChapter);

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

		if (this.chapterSectionEls) {
			for (const el of this.chapterSectionEls) {
				if (isEligibleChapter) { el.show(); } else { el.hide(); }
			}
		}

		if (isEligibleChapter) {
			this.todayWordEl.innerText = coreStats.todayWords.toLocaleString();
			this.goalWordEl.innerText = coreStats.goal.toLocaleString();
			this.percentEl.innerText = ` ${coreStats.percent}%`;

			const chapterDone = coreStats.goal > 0 && coreStats.todayWords >= coreStats.goal;
			const chapterState = chapterDone ? 'done' : 'normal';
			this.setProgressState(this.progressFillEl, this.todayWordEl, null, chapterState, coreStats.percent);
		} else {
			this.todayWordEl.innerText = '0';
			this.goalWordEl.innerText = '0';
			this.percentEl.innerText = ' 0%';
			this.setProgressState(this.progressFillEl, this.todayWordEl, null, 'normal', 0);
		}

		if (taskFolder && this.plugin.taskManager) {
			const manager = this.plugin.taskManager;
			const taskFile = manager.getTaskFile(taskFolder);
			if (taskFile) {
				await this.reconcileTaskLifecycleForFolder(taskFolder, generation);
				if (generation !== this.updateGeneration) return;

				const entries = await manager.loadEntries(taskFolder);
				if (generation !== this.updateGeneration) return;
				const active = entries ? manager.getActiveTask(entries) : null;

				if (active) {
					const taskType = active.taskType || 'wordCount';
					this.activeTaskContext = {
						folderPath: taskFolder,
						period: active.period,
						taskType
					};
					this.setTaskSectionVisible(true);
					if (taskType === 'event') {
						this.taskRowEl.addClass('is-event-task');
						this.taskWordEl.empty();
						const titleText = active.platform || t('common.task-event');
						if (active.position) {
							this.taskWordEl.createDiv({ cls: 'wn-event-task-title', text: titleText + ' -' });
							this.taskWordEl.createDiv({ cls: 'wn-event-task-detail', text: active.position });
						} else {
							this.taskWordEl.createDiv({ cls: 'wn-event-task-title', text: titleText });
						}
						this.taskSeparatorEl.hidden = true;
						this.taskTargetEl.hidden = true;
						this.taskPercentEl.hidden = true;
						if (this.taskProgressFillEl.parentElement) this.taskProgressFillEl.parentElement.hidden = true;
						this.taskEventCompleteBtn.show();
						const daysLeft = Math.max(0, window.moment(active.endDate).diff(window.moment().startOf('day'), 'days') + 1);
						const endShort = active.endDate.substring(5);
						this.taskTimeDescEl.setText(t('common.task-deadline-remaining', { date: endShort, days: String(daysLeft) }));
						this.taskTimeDescEl.removeClass('wn-task-reached');
					} else {
						this.taskRowEl.removeClass('is-event-task');
						this.taskSeparatorEl.hidden = false;
						this.taskTargetEl.hidden = false;
						this.taskPercentEl.hidden = false;
						if (this.taskProgressFillEl.parentElement) this.taskProgressFillEl.parentElement.hidden = false;
						this.taskEventCompleteBtn.hide();
						const progress = manager.calcProgress(active, taskFolder);
						const taskPercent = active.wordTarget > 0 ? Math.min(Math.round((progress / active.wordTarget) * 100), 100) : 0;
						this.taskWordEl.innerText = progress.toLocaleString();
						this.taskTargetEl.innerText = active.wordTarget.toLocaleString();
						this.taskPercentEl.innerText = ` ${taskPercent}%`;
						const taskDone = active.wordTarget > 0 && progress >= active.wordTarget;
						const taskState = taskDone ? 'done' : 'normal';
						const daysLeft = Math.max(0, window.moment(active.endDate).diff(window.moment().startOf('day'), 'days') + 1);
						const endShort = active.endDate.substring(5);
						this.taskTimeDescEl.setText(taskDone ? t('common.task-deadline-reached', { date: endShort }) : t('common.task-deadline-remaining', { date: endShort, days: String(daysLeft) }));
						this.taskTimeDescEl.toggleClass('wn-task-reached', taskDone);
						this.setProgressState(this.taskProgressFillEl, this.taskWordEl, this.taskPercentEl, taskState, taskPercent);

						// 防抖持久化完成字数
						if (this.taskSaveTimer) window.clearTimeout(this.taskSaveTimer);
						this.taskSaveTimer = null;
						if (active.completedWords !== progress) {
							this.taskSaveTimer = window.setTimeout(() => {
								this.taskSaveTimer = null;
								void manager.updateProgress(active.period, progress, taskFolder);
							}, 5000);
						}
					}
				} else {
					this.setTaskSectionVisible(false);
				}
			} else {
				this.setTaskSectionVisible(false);
			}
		} else {
			this.setTaskSectionVisible(false);
		}

		this.lastRenderedDate = window.moment().format('YYYY-MM-DD');
		this.updateTimer();

		await this.updateChapterStatus(generation);
		if (generation !== this.updateGeneration) return;
		this.updateWordStats(force);
		this.renderMiniChart(force);
	}

	private chapterStructureVersion = 0;
	private chapterAssociationCache: {
		chapterFile: TFile;
		chapterPath: string;
		chapterAliasesKey: string;
		bookRoot: string;
		foreshadowingFile: TFile | null;
		foreshadowingPath: string;
		foreshadowingMtime: number;
		foreshadowingSize: number;
		foreshadowingFileName: string | undefined;
		timelineFile: TFile | null;
		timelinePath: string;
		timelineMtime: number;
		timelineSize: number;
		timelineFileName: string | undefined;
		characterCacheVersion: number;
		structureKey: string;
		pendingEntries: ParsedForeshadowingEntry[];
		recoveredHereEntries: ParsedForeshadowingEntry[];
		resolvedOriginEntries: ParsedForeshadowingEntry[];
		timelineNodes: ChapterTimelineNode[];
		isMatch: (target: string | undefined) => boolean;
	} | null = null;
	private lastRenderedChapterSignature: {
		chapterFile: TFile;
		chapterPath: string;
		chapterTitle: string;
		status: string;
		synopsis: string;
		validLoresKey: string;
		associationRef: object | null;
	} | null = null;

	private resetChapterStatusCache(): void {
		this.lastRenderedChapterPath = null;
		this.chapterAssociationCache = null;
		this.lastRenderedChapterSignature = null;
	}

	private getChapterStructureKey(): string {
		return JSON.stringify([
			this.chapterStructureVersion,
			this.plugin.settings.enableStrictChapterMode,
			this.plugin.settings.chapterNamingRules,
			this.plugin.settings.strictChapterExceptions,
			this.plugin.settings.loreFolderName,
			this.plugin.settings.workspaceFolders
		]);
	}

	private createChapterReferenceMatcher(
		file: TFile,
		folderPath: string,
		sourcePath: string
	): (target: string | undefined) => boolean {
		const eligibleChapters = ChapterSorter.getAllChapters(this.app, this.plugin, folderPath);
		const chapterIndex = ChapterSorter.createReferenceIndex(
			this.app,
			this.plugin,
			folderPath,
			{ eligibleChapters, sourcePath }
		);

		return (target: string | undefined): boolean => {
			if (!target) return false;
			return chapterIndex.resolve(target)?.path === file.path;
		};
	}

	private async updateChapterStatus(generation: number = this.updateGeneration) {
		if (!this.chapterStatusCardEl || !this.chapterBadgesContainer) return;
		if (generation !== this.updateGeneration) return;

		const file = this.currentChapterFile;
		if (!file || file.extension !== 'md') {
			this.resetChapterStatusCache();
			this.chapterStatusCardEl.hide();
			this.setChapterEmptyStateVisible(true);
			return;
		}

		if (!this.plugin.cacheManager.isEligibleForWordCount(file)) {
			this.resetChapterStatusCache();
			this.chapterStatusCardEl.hide();
			this.setChapterEmptyStateVisible(true);
			return;
		}

		const recognizedBookRoot = findBookRoot(this.app, this.plugin, file, true);
		if (recognizedBookRoot && this.plugin.characterManager.isLorePath(recognizedBookRoot, file.parent?.path || '')) {
			this.resetChapterStatusCache();
			this.chapterStatusCardEl.hide();
			this.setChapterEmptyStateVisible(true);
			return;
		}

		const fmFolder = (recognizedBookRoot && recognizedBookRoot !== '/') ? recognizedBookRoot : '';
		const fFile = recognizedBookRoot ? this.plugin.foreshadowingManager?.findForeshadowingFile?.(fmFolder) : null;
		if (fFile && fFile.path === file.path) {
			this.resetChapterStatusCache();
			this.chapterStatusCardEl.hide();
			this.setChapterEmptyStateVisible(true);
			return;
		}

		const tlFile = recognizedBookRoot ? this.plugin.timelineManager?.findTimelineFile?.(fmFolder) : null;
		if (tlFile && tlFile.path === file.path) {
			this.resetChapterStatusCache();
			this.chapterStatusCardEl.hide();
			this.setChapterEmptyStateVisible(true);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		
		const synopsis = (frontmatter?.synopsis || frontmatter?.Synopsis || frontmatter?.['摘要'] || '') as string;
		const rawStatus = (frontmatter?.status || frontmatter?.Status || frontmatter?.['状态'] || 'unwritten') as string;
		const status = CORKBOARD_STATUS_MAP[rawStatus] ?? rawStatus;
		const currentFPath = fFile ? fFile.path : '';
		const currentFmtime = fFile ? (fFile.stat?.mtime ?? -1) : -1;
		const currentFsize = fFile ? (fFile.stat?.size ?? -1) : -1;
		const configuredFName = this.plugin.settings.foreshadowing?.fileName;
		const currentTlPath = tlFile ? tlFile.path : '';
		const currentTlmtime = tlFile ? (tlFile.stat?.mtime ?? -1) : -1;
		const currentTlsize = tlFile ? (tlFile.stat?.size ?? -1) : -1;
		const configuredTlName = this.plugin.settings.timeline?.fileName;
		const charCacheVersion = this.plugin.characterManager?.cacheVersion ?? 0;
		const structureKey = this.getChapterStructureKey();
		const chapterAliasesKey = JSON.stringify(frontmatter?.aliases ?? frontmatter?.alias ?? null);

		const loreArray = cache?.frontmatter?.lore as unknown;
		let validLores: string[] = [];
		if (recognizedBookRoot && Array.isArray(loreArray)) {
			validLores = (loreArray as unknown[]).filter((l: unknown): l is string => typeof l === 'string');
		}
		const validLoresKey = validLores.join('\0');

		const cachedAssoc = this.chapterAssociationCache;
		const isAssociationValid = !!(
			cachedAssoc &&
			cachedAssoc.chapterFile === file &&
			cachedAssoc.chapterPath === file.path &&
			cachedAssoc.chapterAliasesKey === chapterAliasesKey &&
			cachedAssoc.bookRoot === recognizedBookRoot &&
			cachedAssoc.foreshadowingFile === (fFile ?? null) &&
			cachedAssoc.foreshadowingPath === currentFPath &&
			cachedAssoc.foreshadowingMtime === currentFmtime &&
			cachedAssoc.foreshadowingSize === currentFsize &&
			cachedAssoc.foreshadowingFileName === configuredFName &&
			cachedAssoc.timelineFile === (tlFile ?? null) &&
			cachedAssoc.timelinePath === currentTlPath &&
			cachedAssoc.timelineMtime === currentTlmtime &&
			cachedAssoc.timelineSize === currentTlsize &&
			cachedAssoc.timelineFileName === configuredTlName &&
			cachedAssoc.characterCacheVersion === charCacheVersion &&
			cachedAssoc.structureKey === structureKey
		);

		const lastSig = this.lastRenderedChapterSignature;
		if (
			isAssociationValid &&
			lastSig &&
			lastSig.chapterFile === file &&
			lastSig.chapterPath === file.path &&
			lastSig.chapterTitle === file.basename &&
			lastSig.status === status &&
			lastSig.synopsis === synopsis &&
			lastSig.validLoresKey === validLoresKey &&
			lastSig.associationRef === cachedAssoc
		) {
			this.setChapterEmptyStateVisible(false);
			this.chapterStatusCardEl.show();
			return;
		}

		let pendingEntries: ParsedForeshadowingEntry[];
		let recoveredHereEntries: ParsedForeshadowingEntry[];
		let resolvedOriginEntries: ParsedForeshadowingEntry[];
		let timelineNodes: ChapterTimelineNode[];
		let isMatch: (target: string | undefined) => boolean;
		let activeAssocRef: typeof this.chapterAssociationCache = null;

		if (isAssociationValid && cachedAssoc) {
			pendingEntries = cachedAssoc.pendingEntries;
			recoveredHereEntries = cachedAssoc.recoveredHereEntries;
			resolvedOriginEntries = cachedAssoc.resolvedOriginEntries;
			timelineNodes = cachedAssoc.timelineNodes;
			isMatch = cachedAssoc.isMatch;
			activeAssocRef = cachedAssoc;
		} else {
			pendingEntries = [];
			recoveredHereEntries = [];
			resolvedOriginEntries = [];
			timelineNodes = [];
			let referenceReadFailed = false;

			isMatch = fFile
				? this.createChapterReferenceMatcher(file, fmFolder, fFile.path)
				: (_target: string | undefined): boolean => false;

			if (fFile && this.plugin.foreshadowingManager) {
				try {
					const content = await this.app.vault.cachedRead(fFile);
					if (generation !== this.updateGeneration) return;
					if (this.currentChapterFile !== file || this.currentChapterFile?.path !== file.path) return;
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
				} catch (err) {
					referenceReadFailed = true;
					(window.console || console).error('[WritingStatusView] Failed to read foreshadowing file:', err);
				}
			}

			if (generation !== this.updateGeneration) return;
			if (this.currentChapterFile !== file || this.currentChapterFile?.path !== file.path) return;

			if (tlFile && this.plugin.timelineManager) {
				try {
					const content = await this.app.vault.cachedRead(tlFile);
					if (generation !== this.updateGeneration) return;
					if (this.currentChapterFile !== file || this.currentChapterFile?.path !== file.path) return;
					const entries = this.plugin.timelineManager.parseEntries(content, fmFolder);
					timelineNodes = this.plugin.timelineManager.getTimelineNodesForChapter(
						file,
						entries,
						fmFolder,
						tlFile
					);
				} catch (err) {
					referenceReadFailed = true;
					(window.console || console).error('[WritingStatusView] Failed to read timeline file:', err);
				}
			}

			if (generation !== this.updateGeneration) return;
			if (this.currentChapterFile !== file || this.currentChapterFile?.path !== file.path) return;

			if (referenceReadFailed) {
				this.chapterAssociationCache = null;
				activeAssocRef = null;
			} else {
				activeAssocRef = {
					chapterFile: file,
					chapterPath: file.path,
					chapterAliasesKey,
					bookRoot: recognizedBookRoot,
					foreshadowingFile: fFile ?? null,
					foreshadowingPath: currentFPath,
					foreshadowingMtime: currentFmtime,
					foreshadowingSize: currentFsize,
					foreshadowingFileName: configuredFName,
					timelineFile: tlFile ?? null,
					timelinePath: currentTlPath,
					timelineMtime: currentTlmtime,
					timelineSize: currentTlsize,
					timelineFileName: configuredTlName,
					characterCacheVersion: charCacheVersion,
					structureKey,
					pendingEntries,
					recoveredHereEntries,
					resolvedOriginEntries,
					timelineNodes,
					isMatch
				};
				this.chapterAssociationCache = activeAssocRef;
			}
		}

		this.setChapterEmptyStateVisible(false);
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
		const statusText = getCorkboardStatusText(status);
		this.chapterStatusBadgeEl.setText(statusText);
		this.chapterStatusBadgeEl.className = `wn-chapter-title-badge wn-status-${status} wn-clickable`;
		setTooltip(this.chapterStatusBadgeEl, `${statusText} - ${t('corkboard.click-to-change-status')}`);

		if (synopsis.trim() !== '') {
			const synopsisEl = this.chapterSubInfoEl.createDiv({ cls: 'wn-chapter-synopsis-text' });
			synopsisEl.setText(synopsis);
		}

		// 点击伏笔条目，跳转到正文中对应文本位置
		const setupJumpEvent = (el: HTMLElement, primarySearch: string, fallbackSearch?: string) => {
			el.addClass('wn-clickable');
			this.preventWorkspaceFocus(el);
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

		if (timelineNodes.length > 0) {
			const timelineDiv = this.chapterBadgesContainer.createDiv('wn-chapter-status-section is-timeline');
			timelineDiv.createDiv({ text: t('corkboard.timeline'), cls: 'wn-chapter-status-section-title' });

			for (const node of timelineNodes) {
				const nodeGroupEl = timelineDiv.createDiv('wn-chapter-timeline-node');
				const displayTime = getTimelineNodeDisplayTime(node);
				const nodeTitle = node.type ? `${displayTime} (${node.type})` : displayTime;
				nodeGroupEl.createDiv({ text: nodeTitle, cls: 'wn-chapter-timeline-node-time' });

				for (const item of node.items) {
					const text = item.description || item.origin || '';
					if (!text) continue;
					const itemEl = nodeGroupEl.createDiv({ text, cls: 'wn-chapter-status-item' });
					if (item.origin && item.origin.trim()) {
						itemEl.addClass('wn-clickable');
						this.preventWorkspaceFocus(itemEl);
						const origin = item.origin.trim();
						itemEl.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							void smartLocateAndHighlight(this.app, file, [origin]);
						});
					}
				}
			}
		}

		if (validLores.length > 0) {
			const loreDiv = this.chapterBadgesContainer.createDiv('wn-chapter-status-section is-lore');
			
			// Add a small divider
			if (pendingEntries.length > 0 || recoveredHereEntries.length > 0 || resolvedOriginEntries.length > 0 || timelineNodes.length > 0) {
				loreDiv.createDiv({ cls: 'wn-chapter-status-divider' });
			}
			
			const loreItemsRow = loreDiv.createDiv({ cls: 'wn-chapter-lore-row' });
			for (const loreNameWithCount of validLores) {
				loreItemsRow.createSpan({ text: loreNameWithCount, cls: 'wn-badge wn-badge-lore' });
			}
		}

		this.lastRenderedChapterPath = file.path;
		this.lastRenderedChapterSignature = activeAssocRef
			? {
				chapterFile: file,
				chapterPath: file.path,
				chapterTitle: file.basename,
				status,
				synopsis,
				validLoresKey,
				associationRef: activeAssocRef
			}
			: null;
	}

	private lastWordStatsRevision: number | null = null;
	private lastWordStatsDate: string = '';

	private updateWordStats(force = false) {
		const today = window.moment().format('YYYY-MM-DD');
		const currentRevision = this.plugin.historyManager.getWordRevision();

		if (!force && this.lastWordStatsRevision === currentRevision && this.lastWordStatsDate === today) {
			return;
		}

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

		this.lastWordStatsRevision = currentRevision;
		this.lastWordStatsDate = today;

		if (this.weekWordEl) this.weekWordEl.innerText = weekWords.toLocaleString();
		if (this.monthWordEl) this.monthWordEl.innerText = monthWords.toLocaleString();
		if (this.yearWordEl) this.yearWordEl.innerText = yearWords.toLocaleString();
		if (this.historyTotalWordEl) this.historyTotalWordEl.innerText = totalWords.toLocaleString();
	}

	private lastMiniChartRevision: number | null = null;
	private lastMiniChartDate: string = '';

	renderMiniChart(force = false) {
		if (this.isChapterOnlyMode() || !this.miniChartEl) return;
		const now = window.moment();
		const today = now.format('YYYY-MM-DD');
		const currentRevision = this.plugin.historyManager.getWordRevision();

		if (!force && this.lastMiniChartRevision === currentRevision && this.lastMiniChartDate === today) {
			return;
		}

		const history = this.plugin.historyManager.getHistory();
		const dates = Array.from({ length: 7 }, (_, index) =>
			now.clone().subtract(6 - index, 'days').format('YYYY-MM-DD')
		);
		const recentHistory = Object.fromEntries(dates.map(date => [date,
			history[date] ?? { addedWords: 0, focusMs: 0, slackMs: 0 }
		]));

		this.lastMiniChartRevision = currentRevision;
		this.lastMiniChartDate = today;

		this.miniChartEl.empty();

		const maxAbsValue = Math.max(...dates.map(d => Math.abs(history[d]?.addedWords || 0)), 1);

		dates.forEach(date => {
			const stat = history[date];
			const words = stat?.addedWords || 0;
			const col = this.miniChartEl.createDiv({ cls: 'wn-mini-chart-col' });

			const heightPercent = Math.max(3, (Math.abs(words) / maxAbsValue) * 100);
			const bar = col.createDiv({ cls: 'wn-mini-chart-bar' });
			bar.setCssProps({ height: `${heightPercent}%` });

			if (words < 0) {
				bar.addClass('wn-bar-negative');
			} else {
				const ratio = words / maxAbsValue;
				if (ratio >= 0.8) bar.addClass('wn-bar-high');
				else if (ratio >= 0.5) bar.addClass('wn-bar-medium');
				else if (ratio >= 0.2) bar.addClass('wn-bar-low');
				else bar.addClass('wn-bar-minimal');
			}

			const focusH = (stat?.focusMs || 0) / 3600000;
			const details = `${t('modal.metric-words')}: ${words}\n${t('modal.metric-focus-time')}: ${focusH.toFixed(1)}h`;

			col.createDiv({ cls: 'wn-mini-chart-label', text: date.substring(5) });

			const displayStr = formatCount(words);
			col.createDiv({ cls: 'wn-mini-chart-value', text: displayStr });

			bindDailyStatsTrigger(col, {
				app: this.app,
				plugin: this.plugin,
				date,
				details,
				stopPropagation: true
			});
		});

		const endDate = today;
		const startDate = dates[0];
		const streak = this.plugin.statisticsManager.calcStreak(history);
		const focusRate = this.plugin.statisticsManager.calcFocusRate(recentHistory, startDate, endDate);
		const speed = this.plugin.statisticsManager.calcWritingSpeed(recentHistory, startDate, endDate);
		const dailyAvg = this.plugin.statisticsManager.calcDailyAverage(recentHistory, startDate, endDate);

		const parts = [
			t('common.consecutive-days', { count: streak }),
			t('common.focus-percent', { rate: focusRate }),
			t('common.writing-speed-fmt', { speed: speed > 0 ? formatCount(speed) : '--' }),
			t('common.daily-average', { count: formatCount(dailyAvg) }),
		].filter(Boolean);

		this.efficiencySummaryEl.setText(parts.join(' · '));
	}

	async onClose() {
		this.updateGeneration++;
		this.clearUpdateDebounceTimer();
		this.resetChapterStatusCache();
		if (this.taskSaveTimer !== null) {
			window.clearTimeout(this.taskSaveTimer);
			this.taskSaveTimer = null;
		}
		this.inFlightReconcile.clear();
		if (!this.isChapterOnlyMode()) {
			try {
				await this.app.workspace.requestSaveLayout.run();
			} catch (error) {
				Logger.error('[WritingStatusView] Failed to save layout:', error);
			}
		}
		await super.onClose();
	}
}
