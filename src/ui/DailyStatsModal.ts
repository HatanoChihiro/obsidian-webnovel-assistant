import type { App } from 'obsidian';
import { Modal, Setting, setIcon, setTooltip } from 'obsidian';
import type { HistoryDataManager } from '../services/HistoryDataManager';
import type { StatisticsManager } from '../services/StatisticsManager';
import { formatDuration } from '../utils/format';
import { t } from '../i18n';

export type DailyStatsHistoryManager = Pick<HistoryDataManager, 'getHistory'>;
export type DailyStatsStatisticsManager = Pick<StatisticsManager, 'getDailyStats'>;

export interface DailyStatsModalPlugin {
	historyManager: DailyStatsHistoryManager;
	statisticsManager: DailyStatsStatisticsManager;
}

export interface DailyStatsTriggerOptions {
	app: App;
	plugin: DailyStatsModalPlugin;
	date: string;
	details?: string;
	stopPropagation?: boolean;
}

/**
 * 绑定单日统计触发器（支持鼠标点击与 Enter/Space 键盘操作）
 */
export function bindDailyStatsTrigger(el: HTMLElement, options: DailyStatsTriggerOptions): void {
	const { app, plugin, date, details, stopPropagation = false } = options;
	el.addClass('wn-daily-stats-trigger');
	el.setAttribute('role', 'button');
	el.setAttribute('tabindex', '0');
	el.removeAttribute('title');

	const actionLabel = t('modal.daily-stats-open-aria', { date });
	const tooltip = details ? `${actionLabel}\n${details}` : actionLabel;
	setTooltip(el, tooltip, { classes: ['wn-tooltip-left'] });

	const openModal = (evt: Event) => {
		if (stopPropagation) {
			evt.stopPropagation();
		}
		new DailyStatsModal(app, plugin, date).open();
	};

	el.addEventListener('click', (evt: MouseEvent) => {
		openModal(evt);
	});

	el.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' || evt.key === ' ') {
			evt.preventDefault();
			openModal(evt);
		}
	});
}

/**
 * 只读单日写作统计弹窗（2列3行固定布局）
 */
export class DailyStatsModal extends Modal {
	private plugin: DailyStatsModalPlugin;
	private date: string;

	constructor(app: App, plugin: DailyStatsModalPlugin, date: string) {
		super(app);
		this.plugin = plugin;
		this.date = date;
		this.modalEl.addClass('wn-plugin-modal', 'wn-daily-stats-modal-container');
	}

	open(): void {
		super.open();
		this.contentEl.focus({ preventScroll: true });
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-daily-stats-modal');
		contentEl.tabIndex = -1;

		const heading = new Setting(contentEl)
			.setName(t('modal.daily-stats-title'))
			.setHeading();
		heading.settingEl.addClass('wn-daily-stats-heading');
		heading.infoEl.addClass('wn-daily-stats-heading-info');
		const navigation = heading.settingEl.createDiv({ cls: 'wn-daily-stats-date-nav' });
		const previous = navigation.createEl('button', {
			cls: 'clickable-icon wn-daily-stats-date-button wn-daily-stats-prev', type: 'button'
		});
		previous.setAttribute('aria-label', t('modal.daily-stats-previous-day'));
		setIcon(previous, 'chevron-left');
		const date = navigation.createSpan({ cls: 'wn-daily-stats-date' });
		date.setAttribute('aria-live', 'polite');
		date.setAttribute('aria-atomic', 'true');
		const next = navigation.createEl('button', {
			cls: 'clickable-icon wn-daily-stats-date-button wn-daily-stats-next', type: 'button'
		});
		next.setAttribute('aria-label', t('modal.daily-stats-next-day'));
		setIcon(next, 'chevron-right');
		const grid = contentEl.createDiv({ cls: 'wn-daily-stats-grid' });
		const renderDate = () => {
			date.setText(this.date);
			next.disabled = this.date >= window.moment().format('YYYY-MM-DD');
			this.renderMetrics(grid);
		};
		const changeDate = (offset: -1 | 1) => {
			const target = window.moment(this.date, 'YYYY-MM-DD').add(offset, 'day').format('YYYY-MM-DD');
			if (target > window.moment().format('YYYY-MM-DD')) return;
			this.date = target;
			renderDate();
		};
		previous.onclick = () => changeDate(-1);
		next.onclick = () => changeDate(1);
		renderDate();
	}

	private renderMetrics(grid: HTMLElement): void {
		grid.empty();
		// 打开或切换日期时实时读取数据，避免捕获过期快照
		const history = this.plugin.historyManager.getHistory();
		const summary = this.plugin.statisticsManager.getDailyStats(history, this.date);

		const metrics: { label: string; value: string }[] = [
			{
				label: t('common.active-period'),
				value: summary.activeHours || '--'
			},
			{
				label: t('common.total-elapsed'),
				value: formatDuration(summary.totalMs)
			},
			{
				label: t('common.focus-duration'),
				value: formatDuration(summary.focusMs)
			},
			{
				label: t('common.slack-duration'),
				value: formatDuration(summary.slackMs)
			},
			{
				label: t('modal.daily-added-words'),
				value: summary.addedWords.toLocaleString()
			},
			{
				label: t('common.writing-speed'),
				value: summary.writingSpeed === null
					? '--'
					: `${summary.writingSpeed.toLocaleString()} ${t('common.words-per-hour-unit')}`
			}
		];

		for (const metric of metrics) {
			const card = grid.createDiv({ cls: 'wn-daily-stats-card' });
			card.createDiv({ cls: 'wn-daily-stats-label', text: metric.label });
			card.createDiv({ cls: 'wn-daily-stats-value', text: metric.value });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
