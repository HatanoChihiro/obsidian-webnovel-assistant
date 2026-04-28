import { App, Modal } from 'obsidian';
import { DailyStat } from '../types/settings';
import { formatCount } from '../utils/format';

/**
 * 历史字数统计弹窗
 * 显示按日/周/月/年聚合的字数统计图表
 */
export class HistoryStatsModal extends Modal {
	history: Record<string, DailyStat>;
	currentTab: '7day' | 'day' | 'week' | 'month' | 'year' = '7day';
	currentMetric: 'words' | 'totalTime' | 'focusTime' | 'slackTime' = 'words';
	chartContainer!: HTMLElement;
	titleEl!: HTMLElement;

	constructor(app: App, history: Record<string, DailyStat>) {
		super(app);
		this.history = history;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('history-stats-modal');

		this.titleEl = contentEl.createEl('h2', { text: '历史统计 - 字数统计' });

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

		// 创建数据维度切换组
		const metricGroup = contentEl.createDiv({ cls: 'stats-tab-group', attr: { style: 'margin-top: 10px;' } });
		const metricTabs = [
			{ id: 'words', name: '字数统计' },
			{ id: 'totalTime', name: '总计时间' },
			{ id: 'focusTime', name: '专注时间' },
			{ id: 'slackTime', name: '摸鱼时间' }
		];

		metricTabs.forEach(tab => {
			const btn = metricGroup.createEl('button', { text: tab.name, cls: 'stats-tab-btn' });
			if (this.currentMetric === tab.id) btn.addClass('is-active');
			btn.onclick = () => {
				this.currentMetric = tab.id as 'words' | 'totalTime' | 'focusTime' | 'slackTime';
				metricGroup.querySelectorAll('.stats-tab-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderData();
			};
		});

		this.chartContainer = contentEl.createDiv({ cls: 'stats-large-chart-container' });
		this.renderData();
	}

	renderData() {
		if (this.titleEl) {
			let metricName = '字数统计';
			if (this.currentMetric === 'totalTime') metricName = '总计时间';
			else if (this.currentMetric === 'focusTime') metricName = '专注时间';
			else if (this.currentMetric === 'slackTime') metricName = '摸鱼时间';
			this.titleEl.setText(`历史统计 - ${metricName}`);
		}

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

		// 根据当前选中的维度获取数值
		const getValue = (data: {words: number, focusMs: number, slackMs: number}) => {
			if (this.currentMetric === 'words') return data.words;
			if (this.currentMetric === 'focusTime') return data.focusMs;
			if (this.currentMetric === 'slackTime') return data.slackMs;
			if (this.currentMetric === 'totalTime') return data.focusMs + data.slackMs;
			return 0;
		};

		// 格式化时长为精确的 h/m 格式，抛弃原来的 0.1小时限制
		const formatDuration = (ms: number) => {
			const totalMinutes = Math.floor(ms / 60000);
			if (totalMinutes === 0) return '0m';
			const h = Math.floor(totalMinutes / 60);
			const m = totalMinutes % 60;
			if (h > 0) return `${h}h ${m}m`;
			return `${m}m`;
		};

		// 计算最大绝对值（支持负数），基底给 1 防止除0
		const maxAbsValue = Math.max(...displayKeys.map(k => Math.abs(getValue(aggregated[k]))), 1);

		displayKeys.forEach((key, i) => {
			const data = aggregated[key];
			const col = this.chartContainer.createDiv({ cls: 'stats-large-col' });
			
			const val = getValue(data);
			// 使用绝对值计算高度（支持负数）
			const heightPercent = Math.max(2, (Math.abs(val) / maxAbsValue) * 100);
			const bar = col.createDiv({ cls: 'stats-large-bar' });
			bar.style.height = `${heightPercent}%`;

			// 负数显示红色，正数根据相对高度上色
			let barColor: string;
			if (val < 0) {
				// 负数：红色警告
				barColor = '#E74C3C';
			} else {
				// 正数：根据相对高度给柱子上色（高的橙金，中等紫色，低的蓝色）
				const ratio = val / maxAbsValue;
				if (ratio >= 0.8) barColor = '#F5A623';
				else if (ratio >= 0.5) barColor = '#8B5CF6';
				else if (ratio >= 0.2) barColor = 'var(--interactive-accent)';
				else barColor = 'var(--background-modifier-border)';
			}
			bar.style.background = barColor;
			
			// 悬停提示：不论在什么 Tab，都全览当前周期所有的详细数据
			const totalMs = data.focusMs + data.slackMs;
			bar.setAttribute('title', `时间: ${key}\n总字数: ${data.words.toLocaleString()}\n总计时间: ${formatDuration(totalMs)}\n专注时间: ${formatDuration(data.focusMs)}\n摸鱼时间: ${formatDuration(data.slackMs)}`);

			col.createDiv({ cls: 'stats-large-label', text: this.formatLabel(key) });
			
			// 根据维度显示对应的文字
			let displayStr = '';
			if (this.currentMetric === 'words') {
				displayStr = formatCount(val);
			} else {
				displayStr = formatDuration(val);
			}

			// 负数值显示为红色
			const valueEl = col.createDiv({ cls: 'stats-large-value', text: displayStr });
			if (val < 0) {
				valueEl.style.color = '#E74C3C';
			}
		});
	}

	aggregateData() {
		const result: Record<string, { words: number, focusMs: number, slackMs: number }> = {};
		
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

			if (!result[key]) result[key] = { words: 0, focusMs: 0, slackMs: 0 };
			result[key].words += (stat.addedWords || 0); // 允许负数
			result[key].focusMs += (stat.focusMs || 0);
			result[key].slackMs += (stat.slackMs || 0);
		}
		return result;
	}

	formatLabel(key: string): string {
		if (this.currentTab === '7day' || this.currentTab === 'day') return key.substring(5); // 04-15
		if (this.currentTab === 'month') return key.substring(2); // 24-04
		if (this.currentTab === 'week') {
			// "2024年 第18周" → "W18"
			const match = key.match(/第(\d+)周/);
			return match ? `W${match[1]}` : key;
		}
		return key;
	}

	onClose() {
		this.contentEl.empty();
	}
}
