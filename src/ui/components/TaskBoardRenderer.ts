import { Modal, Notice, Setting, type App } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { TaskEntry } from '../../types/task';
import { TaskManager } from '../../services/TaskManager';
import { getTaskStatusText } from '../../i18n/data-keys';
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

export class TaskBoardRenderer {
    static async render(options: TaskBoardRendererOptions): Promise<void> {
        const { app, plugin, container, currentBookPath, reloadBoard } = options;
        
        const manager = new TaskManager(app, plugin);
        manager.currentFolder = currentBookPath === '/' ? '' : currentBookPath;
        
        await manager.checkAndCloseExpired();
        await manager.activatePendingTasks();
        
        const file = manager.getTaskFile();
        const content = file ? await app.vault.read(file) : null;

        if (content === null) {
            const empty = container.createDiv({ cls: 'wn-corkboard-empty-msg' });
            const fileName = plugin.settings.task?.fileName || t('common.default-task-filename');
            empty.createDiv({ text: t('common.no-task-records') });
            empty.createDiv({ text: `（${fileName}.md）`, cls: 'wn-task-view-hint' });
            const createBtn = empty.createEl('button', { text: t('common.create-task-file'), cls: 'mod-cta wn-task-create-btn' });
            createBtn.onclick = async () => {
                await manager.createTaskFile();
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
        
        const taskContainer = container.createDiv('wn-corkboard-grid');

        // Sort: active first, then descending by period
        const sorted = [...entries].sort((a, b) => {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (b.status === 'active' && a.status !== 'active') return 1;
            return b.period - a.period;
        });

        for (const entry of sorted) {
            this.renderEntry(manager, taskContainer, entry, options);
        }
    }

    private static renderEntry(manager: TaskManager, container: HTMLElement, entry: TaskEntry, options: TaskBoardRendererOptions) {
        const { app, reloadBoard } = options;
        const statusCls: Record<string, string> = { active: 'active', completed: 'done', incomplete: 'failed', abandoned: 'failed', notStarted: 'pending' };
        const cls = statusCls[entry.status] || 'pending';
        const card = container.createDiv({ cls: `wn-corkboard-card wn-task-card wn-task-card-${cls}` });

        // Header: Period + Abandon Button (if active & incomplete) + Status Label
        const headerRow = card.createDiv({ cls: 'wn-task-card-header' });
        headerRow.createSpan({ text: t('common.period-prefix', { period: entry.period }), cls: 'wn-task-card-period' });

        const headerRight = headerRow.createDiv({ cls: 'wn-task-card-header-right' });

        if (entry.status === 'active') {
            const progress = manager.calcProgress(entry);
            const isGoalReached = entry.wordTarget > 0 && progress >= entry.wordTarget;
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
                                    await manager.updateEntryStatus(entry.period, 'abandoned', progress);
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

        headerRight.createSpan({ text: getTaskStatusText(entry.status), cls: `wn-task-card-status wn-task-status-${cls}` });

        // Info: Platform & Position
        const infoRow = card.createDiv({ cls: 'wn-task-card-info-row' });
        infoRow.createSpan({ text: entry.platform, cls: 'wn-task-card-platform' });
        infoRow.createSpan({ text: entry.position, cls: 'wn-task-card-position' });
        const cycleRow = card.createDiv({ cls: 'wn-task-card-cycle-row' });
        cycleRow.createSpan({ text: `${entry.startDate} ~ ${entry.endDate}`, cls: 'wn-task-card-cycle' });

        // Progress (if active)
        if (entry.status === 'active') {
            const progress = manager.calcProgress(entry);
            // Async update progress file to avoid blocking UI render
            window.setTimeout(() => {
                void manager.updateProgress(entry.period, progress);
            }, 100);
            const percent = entry.wordTarget > 0 ? Math.min(Math.round((progress / entry.wordTarget) * 100), 100) : 0;
            const remaining = entry.wordTarget - progress;
            const daysLeft = Math.max(0, window.moment(entry.endDate).diff(window.moment().startOf('day'), 'days') + 1);

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

        // Result (if completed/incomplete/abandoned)
        if (entry.status === 'completed' || entry.status === 'incomplete' || entry.status === 'abandoned') {
            const resultRow = card.createDiv({ cls: 'wn-task-card-result' });
            resultRow.createSpan({ text: t('common.completed-words', { current: formatCount(entry.completedWords || 0), target: formatCount(entry.wordTarget) }) });
        }
    }
}
