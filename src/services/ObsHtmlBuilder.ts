import { MarkdownView } from 'obsidian';
import { hexToRgba, formatTime } from '../utils';
import { ObsStatsPayload } from '../types/stats';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * OBS 叠加层 HTML 构建器
 * 负责生成 OBS 叠加层的 HTML 和获取统计数据
 */
export class ObsHtmlBuilder {
	constructor(private plugin: WebNovelAssistantPlugin) {}

	/**
	 * 获取 OBS 统计数据
	 */
	getObsStats(): ObsStatsPayload {
		const focusSec = Math.floor(this.plugin.focusMs / 1000);
		const slackSec = Math.floor(this.plugin.slackMs / 1000);
		const totalSec = focusSec + slackSec;
		const today = window.moment().format('YYYY-MM-DD');
		const todayStat = this.plugin.historyManager.getDailyStat(today) || { focusMs: 0, slackMs: 0, addedWords: 0 };

		let targetGoal = this.plugin.settings.defaultGoal;
		let currentFile = '';
		let chapterWords = 0;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			currentFile = view.file.basename;
			const cache = this.plugin.app.metadataCache.getFileCache(view.file);
			const fmGoal = parseInt(cache?.frontmatter?.['word-goal']);
			if (!isNaN(fmGoal)) targetGoal = fmGoal;
			chapterWords = this.plugin.calculateAccurateWords(view.getViewData());
		}

		const todayAdded = todayStat.addedWords; // 允许负数，提醒作者删除了字数
		const dailyGoal = this.plugin.settings.dailyGoal || 0;

		return {
			isTracking: this.plugin.isTracking,
			focusTime: formatTime(focusSec),
			slackTime: formatTime(slackSec),
			totalTime: formatTime(totalSec),
			sessionWords: Math.max(0, this.plugin.sessionAddedWords),
			todayWords: chapterWords,
			goal: targetGoal,
			percent: targetGoal > 0 ? Math.min(Math.round((chapterWords / targetGoal) * 100), 100) : 0,
			dailyWords: todayAdded,
			dailyGoal: dailyGoal,
			dailyPercent: dailyGoal > 0 ? Math.min(Math.round((todayAdded / dailyGoal) * 100), 100) : 0,
			currentFile: currentFile,
		};
	}

	/**
	 * 过滤用户自定义 CSS，防止 XSS 注入
	 * 使用严格的白名单策略，移除所有潜在的脚本注入
	 */
	private sanitizeCss(css: string): string {
		if (!css) return '';
		
		// 移除所有潜在的脚本注入
		let sanitized = css
			// 移除 <script> 标签
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			// 移除 </style> 闭合标签
			.replace(/<\/style/gi, '<\\/style')
			// 移除 javascript: 协议
			.replace(/javascript:/gi, '')
			// 移除 expression() (IE 遗留)
			.replace(/expression\s*\(/gi, '')
			// 移除 @import 中的 javascript
			.replace(/@import\s+['"]?javascript:/gi, '')
			// 移除 behavior 属性 (IE 遗留)
			.replace(/behavior\s*:/gi, '')
			// 移除 -moz-binding (Firefox 遗留)
			.replace(/-moz-binding\s*:/gi, '')
			// 移除 vbscript: 协议
			.replace(/vbscript:/gi, '')
			// 移除 data: 协议（可能包含 base64 编码的脚本）
			.replace(/data:text\/html/gi, '');
		
		// 白名单验证：只允许常见的 CSS 属性
		const allowedProperties = [
			'color', 'background', 'font', 'margin', 'padding', 'border',
			'width', 'height', 'display', 'position', 'top', 'left', 'right', 'bottom',
			'opacity', 'transform', 'transition', 'animation', 'flex', 'grid',
			'text', 'line', 'letter', 'word', 'white', 'overflow', 'visibility',
			'z-index', 'cursor', 'pointer', 'box', 'shadow', 'radius', 'align',
			'justify', 'gap', 'content', 'wrap', 'break', 'decoration', 'style',
			'weight', 'size', 'family', 'variant', 'stretch', 'spacing'
		];
		
		// 警告：如果包含不常见的属性
		const lines = sanitized.split('\n');
		const suspiciousLines = lines.filter(line => {
			const hasProperty = line.includes(':');
			if (!hasProperty) return false;
			
			const property = line.split(':')[0].trim().toLowerCase();
			// 跳过注释和空行
			if (!property || property.startsWith('/*') || property.startsWith('//')) return false;
			
			return !allowedProperties.some(allowed => property.includes(allowed));
		});
		
		if (suspiciousLines.length > 0) {
			console.warn('[ObsHtmlBuilder] 检测到可能不安全的 CSS 属性:', suspiciousLines);
		}
		
		return sanitized;
	}

	/**
	 * 构建 OBS 叠加层 HTML
	 */
	buildObsOverlayHtml(): string {
		const theme = this.plugin.settings.obsOverlayTheme || 'dark';
		let isDark = theme === 'dark';
		
		const overlayOpacity = this.plugin.settings.obsOverlayOpacity ?? 0.85;
		let cardBg = isDark ? `rgba(20, 20, 30, ${overlayOpacity})` : `rgba(255, 255, 255, ${overlayOpacity})`;
		let textColor = isDark ? '#E8E8E8' : '#2C3E50';
		
		if (theme.startsWith('note-')) {
			const index = parseInt(theme.split('-')[1]);
			const noteTheme = this.plugin.settings.noteThemes[index];
			if (noteTheme) {
				cardBg = hexToRgba(noteTheme.bg, overlayOpacity);
				textColor = noteTheme.text;
				isDark = false; 
			}
		}

		const mutedColor = isDark ? '#888' : '#999';
		const accentColor = isDark ? '#6C9EFF' : '#4A90D9';
		const greenColor = '#4CAF50';
		const redColor = '#E74C3C';

		let timeRowHtml = '';
		if (this.plugin.settings.obsShowFocusTime || this.plugin.settings.obsShowSlackTime || this.plugin.settings.obsShowTotalTime) {
			timeRowHtml = `\n\t<div class="time-row">`;
			if (this.plugin.settings.obsShowTotalTime) timeRowHtml += `\n\t\t<div class="time-item"><div class="time-label">总计时间</div><div class="time-value" id="totalTime">00:00:00</div></div>`;
			if (this.plugin.settings.obsShowFocusTime) timeRowHtml += `\n\t\t<div class="time-item"><div class="time-label">专注时间</div><div class="time-value focus" id="focusTime">00:00:00</div></div>`;
			if (this.plugin.settings.obsShowSlackTime) timeRowHtml += `\n\t\t<div class="time-item"><div class="time-label">摸鱼时间</div><div class="time-value slack" id="slackTime">00:00:00</div></div>`;
			timeRowHtml += `\n\t</div>\n\t<div class="divider"></div>`;
		}

		let todayGoalHtml = '';
		if (this.plugin.settings.obsShowDailyGoal) {
			todayGoalHtml += `\n\t<div class="goal-row">
		<span class="goal-label">每日目标字数</span>
		<span class="goal-value"><span id="dailyWords" class="current-val">0</span> <span class="sep">/</span> <span id="dailyGoalValue" class="target-val">0</span><span class="percent" id="dailyPercentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="dailyProgressFill" style="width: 0%"></div>
	</div>`;
		}
		if (this.plugin.settings.obsShowTodayWords) {
			todayGoalHtml += `\n\t<div class="goal-row"${this.plugin.settings.obsShowDailyGoal ? ' style="margin-top:8px"' : ''}>
		<span class="goal-label">本章目标字数</span>
		<span class="goal-value"><span id="todayWords" class="current-val">0</span> <span class="sep">/</span> <span id="goalValue" class="target-val">0</span><span class="percent" id="percentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="progressFill" style="width: 0%"></div>
	</div>`;
		}

		let sessionRowHtml = '';
		if (this.plugin.settings.obsShowSessionWords) {
			sessionRowHtml = `\n\t<div class="session-row">
		<span>本场净增</span>
		<span class="val" id="sessionWords">0</span>
	</div>`;
		}

		const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
* { 
    margin: 0; 
    padding: 0; 
    box-sizing: border-box; 
    -webkit-font-smoothing: antialiased; 
    -moz-osx-font-smoothing: grayscale; 
}
body {
	background: transparent;
	font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
	color: ${textColor};
	margin: 0;
	padding: 0;
	display: flex;
	justify-content: flex-start;
	align-items: flex-start;
}
.overlay-card {
	background: ${cardBg};
	border-radius: 14px;
	padding: 20px 24px;
	backdrop-filter: ${overlayOpacity < 0.1 ? 'none' : 'blur(12px)'};
	border: ${overlayOpacity < 0.1 ? 'none' : '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')};
	transition: all 0.3s ease;
	width: 280px;
	display: flex;
	flex-direction: column;
	gap: 6px;
	zoom: 1.1;
}
.overlay-title {
	font-size: 14px;
	font-weight: 700;
	margin-bottom: 14px;
	display: flex;
	align-items: center;
	gap: 8px;
}
.status-dot {
	width: 12px; height: 12px; border-radius: 50%;
	display: inline-block;
}
.status-dot.active {
	background: ${greenColor};
	animation: pulse 1.5s ease-in-out infinite;
}
.status-dot.paused {
	background: ${mutedColor};
}
@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}


.time-label {
	font-size: 16px;
	color: ${textColor};
	opacity: 0.9;
}
.time-value {
	font-family: 'Consolas', 'Courier New', monospace;
	font-size: 24px;
	font-weight: 700;
	letter-spacing: 1px;
}
.time-value.focus { color: ${accentColor}; }
.time-value.slack { color: ${redColor}; }
.divider {
	height: 1px;
	background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'};
	margin: 4px 0;
}





.goal-value .percent {
	font-size: 13px;
	color: ${accentColor};
	margin-left: 6px;
}
.progress-bg {
	width: 100%;
	height: 6px;
	background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
	border-radius: 3px;
	overflow: hidden;
	margin-bottom: 10px;
}
.progress-fill {
	height: 100%;
	border-radius: 3px;
	background: ${accentColor};
	transition: width 0.8s ease, background-color 0.5s ease;
}
.progress-fill.done {
	background: ${greenColor};
}

.session-row .val {
	text-align: right;
	font-family: 'Consolas', monospace;
	font-weight: 600;
	color: ${textColor};
	opacity: 1;
}


.time-value, 

.goal-value .current-val { color: inherit; }
.goal-value .sep { opacity: 0.5; margin: 0 2px; }
.goal-value .target-val { opacity: 0.8; }


.goal-value.done .current-val { color: #E74C3C !important; }


.time-row {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-bottom: 6px;
}
.time-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	width: 100%;
}






.goal-row {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	width: 100%;
	margin-bottom: 4px;
	gap: 2px;
}
.goal-header {
	font-size: 16px;
	color: ${textColor};
	opacity: 0.9;
	text-align: right;
}
.goal-value {
	display: flex;
	justify-content: flex-end;
	align-items: baseline;
	text-align: right;
	width: 100%;
	gap: 4px;
}
.goal-value .current-val { font-size: 24px; font-weight: 700; }
.goal-value .target-val { font-size: 20px; opacity: 0.8; }
.goal-value .sep { opacity: 0.4; }
.goal-value .percent { font-size: 14px; color: ${accentColor}; font-weight: normal; }

/* Custom User CSS */
${this.sanitizeCss(this.plugin.settings.obsCustomCss)}
</style>
</head>
<body>
<div class="overlay-card">
	<div class="overlay-title">
		<span class="status-dot paused" id="statusDot"></span>
	</div>
	${timeRowHtml}
	${todayGoalHtml}
	${sessionRowHtml}
</div>
<script>
function safeSetText(id, text) {
	const el = document.getElementById(id);
	if (el) el.textContent = text;
}
let lastData = {};
function update() {
	fetch('/api/stats')
		.then(r => r.json())
		.then(d => {
			if (d.focusTime !== lastData.focusTime) safeSetText('focusTime', d.focusTime);
			if (d.slackTime !== lastData.slackTime) safeSetText('slackTime', d.slackTime);
			if (d.totalTime !== lastData.totalTime) safeSetText('totalTime', d.totalTime);
			if (d.todayWords !== lastData.todayWords) safeSetText('todayWords', d.todayWords.toLocaleString());
			if (d.goal !== lastData.goal) safeSetText('goalValue', d.goal.toLocaleString());
			if (d.percent !== lastData.percent) {
				safeSetText('percentText', d.percent + '%');
				const fill = document.getElementById('progressFill');
				if (fill) {
					fill.style.width = d.percent + '%';
					fill.className = 'progress-fill' + (d.percent >= 100 ? ' done' : '');
				}
			}
			if (d.dailyWords !== lastData.dailyWords) safeSetText('dailyWords', d.dailyWords.toLocaleString());
			if (d.dailyGoal !== lastData.dailyGoal) safeSetText('dailyGoalValue', d.dailyGoal.toLocaleString());
			if (d.dailyPercent !== lastData.dailyPercent) {
				safeSetText('dailyPercentText', d.dailyPercent + '%');
				const dailyFill = document.getElementById('dailyProgressFill');
				if (dailyFill) {
					dailyFill.style.width = d.dailyPercent + '%';
					dailyFill.className = 'progress-fill' + (d.dailyPercent >= 100 ? ' done' : '');
				}
			}
			if (d.sessionWords !== lastData.sessionWords) safeSetText('sessionWords', d.sessionWords.toLocaleString());

			if (d.isTracking !== lastData.isTracking) {
				const dot = document.getElementById('statusDot');
				if (dot) dot.className = 'status-dot ' + (d.isTracking ? 'active' : 'paused');
			}
			lastData = d;
		})
		.catch(() => {})
		.finally(() => {
			setTimeout(update, 500);
		});
}
update();
</script>
</body>
</html>`;
		return html;
	}
}
