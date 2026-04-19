import { App, Modal } from 'obsidian';
import { DailyStat } from '../types/stats';
import { formatCount } from '../utils/format';

/**
 * 历史字数统计弹窗
 * 显示按日/周/月/年聚合的字数统计图表
 */
export class HistoryStatsModal extends Modal {
	history: Record<string, DailyStat>;
	currentTab: '7day' | 'day' | 'week' | 'month' | 'year' = 'month';
	chartContainer!: HTMLElement;

	constructor(app: App, history: Record<string, DailyStat>) {
		super(app);
		this.history = history;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('history-stats-modal');

		contentEl.createEl('h2', { text: '📈 字数统计' });

		// 创建 Tab 切换组
		const tabGroup = contentEl.createDiv({ cls: 'stats-tab-group' });
		const tabs = [
			{ id: '7day', name: '近7日' },
			{ id: 'day', name: '近30日' },
			{ id: 'week', name: '按周' },
			{ id: 'month', name: '按月' },
			{ id: 'year', name: '按年' }
		];

		tabs.forEach(tab => {
			const btn = tabGroup.createEl('button', { text: tab.name, cls: 'stats-tab-btn' });
			if (this.currentTab === tab.id) btn.addClass('is-active');
			btn.onclick = () => {
				this.currentTab = tab.id as '7day' | 'day' | 'week' | 'month' | 'year';
				tabGroup.querySelectorAll('.stats-tab-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderData();
			};
		});

		this.chartContainer = contentEl.createDiv({ cls: 'stats-large-chart-container' });
		this.renderData();
	}

	renderData() {
		this.chartContainer.empty();
		const aggregated = this.aggregateData();
		const keys = Object.keys(aggregated).sort();
		
		// 根据 Tab 限制显示数量，防止太挤
		let displayKeys = keys;
		if (this.currentTab === '7day') displayKeys = keys.slice(-7); // 近7日
		if (this.currentTab === 'day') displayKeys = keys.slice(-30);
		if (this.currentTab === 'week') displayKeys = keys.slice(-12); // 近12周

		if (displayKeys.length === 0) {
			this.chartContainer.createDiv({ text: '暂无数据' });
			return;
		}

		const maxWords = Math.max(...displayKeys.map(k => aggregated[k].words), 100);

		displayKeys.forEach(key => {
			const data = aggregated[key];
			const col = this.chartContainer.createDiv({ cls: 'stats-large-col' });
			
			const heightPercent = Math.max(2, (data.words / maxWords) * 100);
			const bar = col.createDiv({ cls: 'stats-large-bar' });
			bar.style.height = `${heightPercent}%`;
			
			// 悬停提示
			const focusHours = (data.focusMs / 3600000).toFixed(1);
			bar.setAttribute('title', `时间: ${key}\n总字数: ${data.words.toLocaleString()}\n专注总计: ${focusHours}小时`);

			col.createDiv({ cls: 'stats-large-label', text: this.formatLabel(key) });
			col.createDiv({ cls: 'stats-large-value', text: formatCount(data.words) });
		});
	}

	aggregateData() {
		const result: Record<string, { words: number, focusMs: number }> = {};
		
		for (const [date, stat] of Object.entries(this.history)) {
			const m = window.moment(date);
			let key = date; // 默认按日

			if (this.currentTab === '7day') {
				key = date; // 近7日也按日显示
			} else if (this.currentTab === 'week') {
				key = `${m.year()}年 第${m.isoWeek()}周`;
			} else if (this.currentTab === 'month') {
				key = m.format('YYYY-MM');
			} else if (this.currentTab === 'year') {
				key = m.format('YYYY');
			}

			if (!result[key]) result[key] = { words: 0, focusMs: 0 };
			result[key].words += Math.max(0, stat.addedWords || 0);
			result[key].focusMs += (stat.focusMs || 0);
		}
		return result;
	}

	formatLabel(key: string): string {
		if (this.currentTab === '7day' || this.currentTab === 'day') return key.substring(5); // 04-15
		if (this.currentTab === 'month') return key.substring(2); // 24-04
		return key; // week 和 year 直接显示
	}

	onClose() {
		this.contentEl.empty();
	}
}
