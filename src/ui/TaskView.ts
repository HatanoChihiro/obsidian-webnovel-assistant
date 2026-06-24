import { Notice } from 'obsidian';
import { Logger } from '../utils/Logger';
import type { WorkspaceLeaf } from 'obsidian';
import { CreativeView } from './CreativeView';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { TaskEntry } from '../types/task';
import { TaskManager } from '../services/TaskManager';
import { TaskAddModal } from './TaskModal';
import { getTaskStatusText } from '../i18n/data-keys';
import { formatCount } from '../utils';
import { t } from '../i18n';

export const TASK_VIEW_TYPE = 'task-view';

export class TaskView extends CreativeView {
	private manager!: TaskManager;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf, plugin);
		this.manager = new TaskManager(this.app, this.plugin);
	}

	getViewType() { return TASK_VIEW_TYPE; }
	getDisplayText() { return t('view.task'); }
	getIcon() { return 'trophy'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.task?.fileName || t('common.default-task-filename');
	}

	protected async onFolderChange() {
		this.manager.currentFolder = this.currentFolder;
		await this.refresh();
	}

	async refresh() {
		await this.manager.checkAndCloseExpired();
		await this.manager.activatePendingTasks();
		const file = this.manager.getTaskFile();
		const content = file ? await this.app.vault.read(file) : null;
		await this.renderFromContent(content);
	}

	async renderFromContent(content: string | null) {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('task-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'task-view-header' });
		const titleRow = header.createDiv({ cls: 'task-view-title-row' });
		titleRow.createSpan({ text: t('view.task'), cls: 'task-view-title' });

		const addBtn = titleRow.createEl('button', { cls: 'task-add-btn', title: t('modal.new-task') });
		addBtn.setText('+');
		addBtn.onclick = () => this.showAddModal();

		header.createDiv({ cls: 'task-view-folder', text: this.currentFolder || t('common.root-directory') });

		if (content === null) {
			const empty = container.createDiv({ cls: 'task-view-empty' });
			const fileName = this.plugin.settings.task?.fileName || t('common.default-task-filename');
			empty.createEl('p', { text: t('common.no-task-records') });
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'task-view-hint' });
			const createBtn = empty.createEl('button', { text: t('common.create-task-file'), cls: 'mod-cta task-create-btn' });
			createBtn.onclick = async () => {
				await this.manager.createTaskFile();
				await this.refresh();
			};
			return;
		}

		const entries = this.manager.parseEntries(content);
		if (entries.length === 0) {
			const empty = container.createDiv({ cls: 'task-view-empty' });
			empty.createEl('p', { text: t('common.no-task-records') });
			return;
		}

		// 排序：进行中排在最前，其余按期数倒序
		const sorted = [...entries].sort((a, b) => {
			if (a.status === 'active' && b.status !== 'active') return -1;
			if (b.status === 'active' && a.status !== 'active') return 1;
			return b.period - a.period;
		});

		for (const entry of sorted) {
			this.renderEntry(container, entry);
		}
	}

	private renderEntry(container: HTMLElement, entry: TaskEntry) {
		const statusCls: Record<string, string> = { active: 'active', completed: 'done', incomplete: 'failed', notStarted: 'pending' };
			const cls = statusCls[entry.status] || 'pending';
			const card = container.createDiv({ cls: `task-card task-card-${cls}` });

		// 头部：期数 + 状态标签
		const headerRow = card.createDiv({ cls: 'task-card-header' });
		headerRow.createSpan({ text: t('common.period-prefix', { period: entry.period }), cls: 'task-card-period' });
		headerRow.createSpan({ text: getTaskStatusText(entry.status), cls: `task-card-status task-status-${cls}` });

		// 信息行：平台·位置一行
		const infoRow = card.createDiv({ cls: 'task-card-info-row' });
		infoRow.createSpan({ text: entry.platform, cls: 'task-card-platform' });
		infoRow.createSpan({ text: entry.position, cls: 'task-card-position' });
		const cycleRow = card.createDiv({ cls: 'task-card-cycle-row' });
		cycleRow.createSpan({ text: `${entry.startDate} ~ ${entry.endDate}`, cls: 'task-card-cycle' });

		// 进度（进行中时显示）
		if (entry.status === 'active') {
			const progress = this.manager.calcProgress(entry);
			// 异步更新进度文件，避免在 UI 渲染主路径中同步读写文件
			window.setTimeout(() => {
				void this.manager.updateProgress(entry.period, progress);
			}, 100);
			const percent = entry.wordTarget > 0 ? Math.min(Math.round((progress / entry.wordTarget) * 100), 100) : 0;
			const remaining = entry.wordTarget - progress;
			const daysLeft = Math.max(0, window.moment(entry.endDate).diff(window.moment().startOf('day'), 'days') + 1);

			const progressSection = card.createDiv({ cls: 'task-card-progress' });
			const progressLabel = progressSection.createDiv({ cls: 'task-progress-label' });
			progressLabel.createSpan({ text: t('common.words-added', { current: formatCount(progress), target: formatCount(entry.wordTarget) }) });
			progressLabel.createSpan({ text: `${percent}%`, cls: 'task-progress-percent' });

			const progressBg = progressSection.createDiv({ cls: 'progress-bar-bg' });
			const progressFill = progressBg.createDiv({ cls: 'progress-bar-fill' });
			progressFill.setCssProps({ width: `${Math.max(percent, 0)}%` });
			if (percent >= 100) {
				progressFill.addClass('is-done');
			}

			const footer = card.createDiv({ cls: 'task-card-footer' });
			if (remaining > 0) {
				footer.createSpan({ text: t('common.words-remaining', { count: formatCount(remaining) }), cls: 'task-remaining' });
			} else {
				footer.createSpan({ text: t('common.goal-reached'), cls: 'task-remaining task-reached' });
			}
			footer.createSpan({ text: t('common.days-remaining', { days: daysLeft }), cls: 'task-days-left' });
		}

		// 已完成/未完成时显示结果
		if (entry.status === 'completed' || entry.status === 'incomplete') {
			const resultRow = card.createDiv({ cls: 'task-card-result' });
			resultRow.createSpan({ text: t('common.completed-words', { current: formatCount(entry.completedWords || 0), target: formatCount(entry.wordTarget) }) });
		}
	}

	private showAddModal() {
		void (async () => {
			try {
				const existingEntries = await this.manager.loadEntries();
				const nextPeriod = this.manager.getNextPeriod(existingEntries || []);
				const lastPlatform = existingEntries && existingEntries.length > 0
					? existingEntries[existingEntries.length - 1].platform
					: '';

				new TaskAddModal(
					this.app,
					this.plugin,
					this.manager,
					nextPeriod,
					lastPlatform,
					async (entry) => {
						await this.manager.addEntry(entry);
						new Notice(t('notice.task-added'));
						await this.refresh();
					}
				).open();
			} catch (err) {
				Logger.error('[TaskView] showAddModal failed:', err);
			}
		})();
	}
}