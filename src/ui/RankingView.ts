import type { WorkspaceLeaf } from 'obsidian';
import { CreativeView } from './CreativeView';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { RankingEntry } from '../types/ranking';
import { RankingManager } from '../services/RankingManager';
import { RankingAddModal } from './RankingModal';
import { getRankingStatusText } from '../i18n/data-keys';
import { formatCount } from '../utils';
import { t } from '../i18n';

export const RANKING_VIEW_TYPE = 'ranking-view';

export class RankingView extends CreativeView {
	private manager!: RankingManager;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf, plugin);
		this.manager = new RankingManager(this.app, this.plugin);
	}

	getViewType() { return RANKING_VIEW_TYPE; }
	getDisplayText() { return t('view.ranking'); }
	getIcon() { return 'trophy'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.ranking?.fileName || t('common.default-ranking-filename');
	}

	protected async onFolderChange() {
		this.manager.currentFolder = this.currentFolder;
		await this.refresh();
	}

	async refresh() {
		await this.manager.checkAndCloseExpired();
		await this.manager.activatePendingRankings();
		const file = this.manager.getRankingFile();
		const content = file ? await this.app.vault.read(file) : null;
		await this.renderFromContent(content);
	}

	async renderFromContent(content: string | null) {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('ranking-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'ranking-view-header' });
		const titleRow = header.createDiv({ cls: 'ranking-view-title-row' });
		titleRow.createSpan({ text: t('view.ranking'), cls: 'ranking-view-title' });

		const addBtn = titleRow.createEl('button', { cls: 'ranking-add-btn', title: t('modal.new-ranking') });
		addBtn.setText('+');
		addBtn.onclick = () => this.showAddModal();

		header.createDiv({ cls: 'ranking-view-folder', text: this.currentFolder || t('common.root-directory') });

		if (content === null) {
			const empty = container.createDiv({ cls: 'ranking-view-empty' });
			const fileName = this.plugin.settings.ranking?.fileName || t('common.default-ranking-filename');
			empty.createEl('p', { text: t('common.no-ranking-records') });
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'ranking-view-hint' });
			const createBtn = empty.createEl('button', { text: t('common.create-ranking-file'), cls: 'mod-cta ranking-create-btn' });
			createBtn.onclick = async () => {
				await this.manager.createRankingFile();
				await this.refresh();
			};
			return;
		}

		const entries = this.manager.parseEntries(content);
		if (entries.length === 0) {
			const empty = container.createDiv({ cls: 'ranking-view-empty' });
			empty.createEl('p', { text: t('common.no-ranking-records') });
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

	private renderEntry(container: HTMLElement, entry: RankingEntry) {
		const statusCls: Record<string, string> = { active: 'active', completed: 'done', incomplete: 'failed', notStarted: 'pending' };
			const cls = statusCls[entry.status] || 'pending';
			const card = container.createDiv({ cls: `ranking-card ranking-card-${cls}` });

		// 头部：期数 + 状态标签
		const headerRow = card.createDiv({ cls: 'ranking-card-header' });
		headerRow.createSpan({ text: t('common.period-prefix', { period: entry.period }), cls: 'ranking-card-period' });
		headerRow.createSpan({ text: getRankingStatusText(entry.status), cls: `ranking-card-status ranking-status-${cls}` });

		// 信息行：平台·位置一行
		const infoRow = card.createDiv({ cls: 'ranking-card-info-row' });
		infoRow.createSpan({ text: entry.platform, cls: 'ranking-card-platform' });
		infoRow.createSpan({ text: entry.position, cls: 'ranking-card-position' });
		const cycleRow = card.createDiv({ cls: 'ranking-card-cycle-row' });
		cycleRow.createSpan({ text: `${entry.startDate} ~ ${entry.endDate}`, cls: 'ranking-card-cycle' });

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

			const progressSection = card.createDiv({ cls: 'ranking-card-progress' });
			const progressLabel = progressSection.createDiv({ cls: 'ranking-progress-label' });
			progressLabel.createSpan({ text: t('common.words-added', { current: formatCount(progress), target: formatCount(entry.wordTarget) }) });
			progressLabel.createSpan({ text: `${percent}%`, cls: 'ranking-progress-percent' });

			const progressBg = progressSection.createDiv({ cls: 'progress-bar-bg' });
			const progressFill = progressBg.createDiv({ cls: 'progress-bar-fill' });
			progressFill.setCssProps({ width: `${Math.max(percent, 0)}%` });
			if (percent >= 100) {
				progressFill.addClass('is-done');
			}

			const footer = card.createDiv({ cls: 'ranking-card-footer' });
			if (remaining > 0) {
				footer.createSpan({ text: t('common.words-remaining', { count: formatCount(remaining) }), cls: 'ranking-remaining' });
			} else {
				footer.createSpan({ text: t('common.goal-reached'), cls: 'ranking-remaining ranking-reached' });
			}
			footer.createSpan({ text: t('common.days-remaining', { days: daysLeft }), cls: 'ranking-days-left' });
		}

		// 已完成/未完成时显示结果
		if (entry.status === 'completed' || entry.status === 'incomplete') {
			const resultRow = card.createDiv({ cls: 'ranking-card-result' });
			resultRow.createSpan({ text: t('common.completed-words', { current: formatCount(entry.completedWords || 0), target: formatCount(entry.wordTarget) }) });
		}
	}

	private showAddModal() {
		void this.manager.loadEntries().then(existingEntries => {
			const nextPeriod = this.manager.getNextPeriod(existingEntries || []);
			const lastPlatform = existingEntries && existingEntries.length > 0
				? existingEntries[existingEntries.length - 1].platform
				: '';

			new RankingAddModal(
				this.app,
				this.plugin,
				this.manager,
				nextPeriod,
				lastPlatform,
				async (entry) => {
					await this.manager.addEntry(entry);
					await this.refresh();
				}
			).open();
		});
	}
}