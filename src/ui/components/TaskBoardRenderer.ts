import { Modal, Notice, Setting, setIcon, type App } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { TaskEntry } from '../../types/task';
import type { TaskManager } from '../../services/TaskManager';
import { getTaskStatusText, getTaskTypeText } from '../../i18n/data-keys';
import { formatCount } from '../../utils';
import { t } from '../../i18n';

export interface TaskBoardRendererOptions {
    app: App;
    plugin: WebNovelAssistantPlugin;
    container: HTMLElement;
    currentBookPath: string;
    reloadBoard: () => void;
}

class TaskAbandonConfirmModal extends Modal {
    constructor(
        app: App,
        private period: number,
        private onConfirm: () => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('wn-task-abandon-modal');

        new Setting(contentEl).setName(t('task.abandon-confirm-title')).setHeading();
        contentEl.createEl('p', { text: t('task.abandon-confirm-msg', { period: this.period }) });

        const buttonContainer = contentEl.createDiv({ cls: 'wn-base-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('common.cancel') });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = buttonContainer.createEl('button', {
            text: t('task.abandon'),
            cls: 'mod-warning task-abandon-confirm-btn'
        });
        confirmBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class TaskCompleteConfirmModal extends Modal {
    constructor(
        app: App,
        private period: number,
        private onConfirm: () => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('wn-task-complete-modal');

        new Setting(contentEl).setName(t('task.complete-confirm-title')).setHeading();
        contentEl.createEl('p', { text: t('task.complete-confirm-msg', { period: this.period }) });

        const buttonContainer = contentEl.createDiv({ cls: 'wn-base-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('common.cancel') });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = buttonContainer.createEl('button', {
            text: t('task.complete'),
            cls: 'mod-cta task-complete-confirm-btn'
        });
        confirmBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class TaskBoardRenderer {
    static async render(options: TaskBoardRendererOptions): Promise<void> {
        const { app, plugin, container, currentBookPath, reloadBoard } = options;
        
        const manager = plugin.taskManager;
        const taskFolder = currentBookPath === '/' ? '' : currentBookPath;

        await manager.checkAndCloseExpired(taskFolder);
        await manager.activatePendingTasks(taskFolder);

        const file = manager.getTaskFile(taskFolder);
        const content = file ? await app.vault.read(file) : null;

        if (content === null) {
            const empty = container.createDiv({ cls: 'wn-corkboard-empty-msg' });
            const fileName = plugin.settings.task?.fileName || t('common.default-task-filename');
            empty.createDiv({ text: t('common.no-task-records') });
            empty.createDiv({ text: `（${fileName}.md）`, cls: 'wn-task-view-hint' });
            const createBtn = empty.createEl('button', { text: t('common.create-task-file'), cls: 'mod-cta wn-task-create-btn' });
            createBtn.onclick = async () => {
                await manager.createTaskFile(taskFolder);
                reloadBoard();
            };
            return;
        }

        const entries = manager.parseEntries(content);
        if (entries.length === 0) {
            const empty = container.createDiv({ cls: 'wn-corkboard-empty-msg' });
            empty.createDiv({ text: t('common.no-task-records') });
            return;
        }

        const sortEntries = (list: TaskEntry[]) => [...list].sort((a, b) => {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (b.status === 'active' && a.status !== 'active') return 1;
            return b.period - a.period;
        });

        const wordCountEntries = sortEntries(entries.filter(e => (e.taskType || 'wordCount') === 'wordCount'));
        const eventEntries = sortEntries(entries.filter(e => e.taskType === 'event'));

        const boardLayout = container.createDiv('wn-task-board-layout');

        const buildCollapsibleSection = (titleText: string, taskList: TaskEntry[]) => {
            if (taskList.length === 0) return;
            const header = boardLayout.createDiv('wn-corkboard-volume-header wn-clickable');
            const iconSpan = header.createSpan({ cls: 'wn-volume-header-icon' });
            setIcon(iconSpan, 'chevron-down');
            header.createSpan({ text: `${titleText} (${taskList.length})`, cls: 'wn-volume-header-title' });

            const grid = boardLayout.createDiv('wn-corkboard-grid');
            for (const entry of taskList) {
                this.renderEntry(manager, grid, entry, options);
            }

            header.onclick = () => {
                const isCollapsed = grid.hasClass('is-collapsed');
                if (isCollapsed) {
                    grid.removeClass('is-collapsed');
                    header.removeClass('is-collapsed');
                    setIcon(iconSpan, 'chevron-down');
                } else {
                    grid.addClass('is-collapsed');
                    header.addClass('is-collapsed');
                    setIcon(iconSpan, 'chevron-right');
                }
            };
        };

        // 字数任务 Section
        buildCollapsibleSection(getTaskTypeText('wordCount'), wordCountEntries);

        // 事件任务 Section
        buildCollapsibleSection(getTaskTypeText('event'), eventEntries);
    }

    private static renderEntry(manager: TaskManager, container: HTMLElement, entry: TaskEntry, options: TaskBoardRendererOptions) {
        const { app, reloadBoard, currentBookPath } = options;
        const taskFolder = currentBookPath === '/' ? '' : currentBookPath;
        const statusCls: Record<string, string> = { active: 'active', completed: 'done', incomplete: 'failed', abandoned: 'failed', notStarted: 'pending' };
        const cls = statusCls[entry.status] || 'pending';
        const card = container.createDiv({ cls: `wn-corkboard-card task-card task-card-${cls} wn-task-card wn-task-card-${cls}` });

        // Header: Period + Action Buttons (Complete / Abandon) + Status Label
        const headerRow = card.createDiv({ cls: 'task-card-header wn-task-card-header' });
        headerRow.createSpan({ text: t('common.period-prefix', { period: entry.period }), cls: 'task-card-period wn-task-card-period' });

        const headerRight = headerRow.createDiv({ cls: 'task-card-header-right wn-task-card-header-right' });

        if (entry.status === 'active') {
            const progress = manager.calcProgress(entry, taskFolder);
            const isGoalReached = entry.wordTarget > 0 && progress >= entry.wordTarget;

            // 事件任务：在“放弃”左侧提供手动完成按钮
            if (entry.taskType === 'event') {
                const completeBtn = headerRight.createEl('button', {
                    text: t('task.complete'),
                    cls: 'wn-task-complete-btn'
                });
                completeBtn.title = t('task.complete-confirm-title');
                completeBtn.onclick = (e) => {
                    e.stopPropagation();
                    new TaskCompleteConfirmModal(
                        app,
                        entry.period,
                        () => {
                            void (async () => {
                                try {
                                    await manager.updateEntryStatus(entry.period, 'completed', progress, entry.taskType, taskFolder);
                                    new Notice(t('task.complete-success', { period: entry.period }));
                                    reloadBoard();
                                } catch (err) {
                                    window.console.error(err);
                                    new Notice(t('task.complete-failed'));
                                }
                            })();
                        }
                    ).open();
                };
            }

            if (!isGoalReached) {
                const abandonBtn = headerRight.createEl('button', {
                    text: t('task.abandon'),
                    cls: 'wn-task-abandon-btn'
                });
                abandonBtn.title = t('task.abandon-confirm-title');
                abandonBtn.onclick = (e) => {
                    e.stopPropagation();
                    new TaskAbandonConfirmModal(
                        app,
                        entry.period,
                        () => {
                            void (async () => {
                                try {
                                    await manager.updateEntryStatus(entry.period, 'abandoned', progress, entry.taskType, taskFolder);
                                    new Notice(t('task.abandon-success', { period: entry.period }));
                                    reloadBoard();
                                } catch (err) {
                                    window.console.error(err);
                                    new Notice(t('task.abandon-failed'));
                                }
                            })();
                        }
                    ).open();
                };
            }
        }

        headerRight.createSpan({ text: getTaskStatusText(entry.status), cls: `task-card-status task-status-${cls} wn-task-card-status wn-task-status-${cls}` });

        // Info: Platform & Position
        const infoRow = card.createDiv({ cls: 'task-card-info-row wn-task-card-info-row' });
        infoRow.createSpan({ text: entry.platform, cls: 'task-card-platform wn-task-card-platform' });
        infoRow.createSpan({ text: entry.position, cls: 'task-card-position wn-task-card-position' });
        const cycleRow = card.createDiv({ cls: 'task-card-cycle-row wn-task-card-cycle-row' });
        cycleRow.createSpan({ text: `${entry.startDate} ~ ${entry.endDate}`, cls: 'task-card-cycle wn-task-card-cycle' });

        // Progress (if active)
        if (entry.status === 'active') {
            const daysLeft = Math.max(0, window.moment(entry.endDate).diff(window.moment().startOf('day'), 'days') + 1);

            if (entry.taskType === 'event') {
                // 事件任务：无需显示字数进度条，仅在底部展示倒计时
                const footer = card.createDiv({ cls: 'task-card-footer wn-task-card-footer wn-task-card-footer-event' });
                footer.createSpan({ text: t('common.days-remaining', { days: daysLeft }), cls: 'task-days-left wn-task-days-left' });
            } else {
                // 字数任务：正常展示字数进度条
                const progress = manager.calcProgress(entry, taskFolder);
                // Async update progress file to avoid blocking UI render
                window.setTimeout(() => {
                    void manager.updateProgress(entry.period, progress, taskFolder);
                }, 100);
                const percent = entry.wordTarget > 0 ? Math.min(Math.round((progress / entry.wordTarget) * 100), 100) : 0;
                const remaining = entry.wordTarget - progress;

                const progressSection = card.createDiv({ cls: 'wn-task-card-progress' });
                const progressLabel = progressSection.createDiv({ cls: 'wn-task-progress-label' });
                progressLabel.createSpan({ text: t('common.words-added', { current: formatCount(progress), target: formatCount(entry.wordTarget) }) });
                progressLabel.createSpan({ text: `${percent}%`, cls: 'wn-task-progress-percent' });

                const progressBg = progressSection.createDiv({ cls: 'progress-bar-bg' });
                const progressFill = progressBg.createDiv({ cls: 'progress-bar-fill' });
                progressFill.setCssProps({ width: `${Math.max(percent, 0)}%` });
                if (percent >= 100) {
                    progressFill.addClass('is-done');
                }

                const footer = card.createDiv({ cls: 'wn-task-card-footer' });
                if (remaining > 0) {
                    footer.createSpan({ text: t('common.words-remaining', { count: formatCount(remaining) }), cls: 'wn-task-remaining' });
                } else {
                    footer.createSpan({ text: t('common.goal-reached'), cls: 'wn-task-remaining wn-task-reached' });
                }
                footer.createSpan({ text: t('common.days-remaining', { days: daysLeft }), cls: 'wn-task-days-left' });
            }
        }

        // Result (if completed/incomplete/abandoned)
        if (entry.taskType !== 'event' && (entry.status === 'completed' || entry.status === 'incomplete' || entry.status === 'abandoned')) {
            const resultRow = card.createDiv({ cls: 'wn-task-card-result' });
            resultRow.createSpan({ text: t('common.completed-words', { current: formatCount(entry.completedWords || 0), target: formatCount(entry.wordTarget) }) });
        }
    }
}
