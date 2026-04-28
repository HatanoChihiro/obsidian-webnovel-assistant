import { injectGlobalStyle, removeGlobalStyle } from '../utils';
import type { AccurateCountSettings } from '../types/settings';

/**
 * 样式管理服务
 * 负责全局样式注入、护眼模式等样式相关功能
 */
export class StyleManager {
	constructor(private settings: AccurateCountSettings) {}

	/**
	 * 注入全局样式
	 * 包含状态视图、伏笔视图、时间线视图、移动端优化等所有样式
	 */
	injectGlobalStyles(): void {
		const styleId = 'accurate-count-global-styles';
		const styleContent = `
				.folder-word-count { font-variant-numeric: tabular-nums; pointer-events: none; }

				.status-view-container { padding: 15px; }
				.status-card { background: var(--background-secondary); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--background-modifier-border); }
				
				.status-title { font-weight: bold; margin-bottom: 12px; font-size: 1.1em; display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
				.status-title-badge { font-size: 0.75em; background: var(--interactive-accent); color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: normal; }
				
				.status-goal-label { font-size: 0.78em; color: var(--text-muted); margin-top: 14px; margin-bottom: 2px; font-weight: 500; }
				.goal-display-row-right { display: flex; align-items: baseline; justify-content: flex-end; gap: 4px; margin-top: 4px; margin-bottom: 8px; font-family: var(--font-monospace); flex-wrap: wrap; }
				.goal-current { font-size: 1.8em; font-weight: bold; color: var(--text-normal); }
				.goal-separator { font-size: 1.1em; color: var(--text-muted); opacity: 0.5; }
				.goal-target { font-size: 1.4em; color: var(--text-muted); opacity: 0.8; }
				.goal-percent { font-size: 1.1em; color: var(--interactive-accent); font-weight: 600; margin-left: 8px; }
				
				.progress-bar-bg { width: 100%; height: 10px; background: var(--background-modifier-border); border-radius: 5px; overflow: hidden; margin: 0; }
				.progress-bar-fill { height: 100%; background: var(--interactive-accent); transition: width 0.3s ease; }
				
				.time-box-total { background: var(--background-primary); padding: 12px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); margin-bottom: 10px; }
				.time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
				.time-box { background: var(--background-primary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); min-width: 0; }
				.time-box-title { font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.time-box-value { font-family: var(--font-monospace); font-size: 1.1em; font-weight: bold; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				
				.history-chart { margin-top: 20px; padding-top: 15px; border-top: 1px dashed var(--background-modifier-border); }
				.history-chart-title { font-size: 0.95em; font-weight: 600; color: var(--text-normal); margin-bottom: 4px; }
				.history-chart-subtitle { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; cursor: pointer; }
				.history-chart-subtitle:hover { color: var(--interactive-accent); text-decoration: underline; }

				.history-stats-modal { min-width: 600px; }
				.stats-tab-group { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; }
				.stats-tab-btn { background: transparent; border: none; box-shadow: none; color: var(--text-muted); cursor: pointer; padding: 6px 12px; border-radius: 4px; transition: all 0.2s; }
				.stats-tab-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
				.stats-tab-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: bold; }
				
				.stats-large-chart-container { display: flex; align-items: flex-end; justify-content: flex-start; height: 260px; padding: 20px 8px 10px 8px; border-bottom: 1px dashed var(--background-modifier-border); margin-top: 10px; overflow-x: auto; gap: 4px;}
				.stats-large-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 20px; flex: 1; max-width: 36px; }
				.stats-large-bar { width: 70%; min-width: 8px; max-width: 24px; border-radius: 3px 3px 0 0; opacity: 0.85; transition: height 0.4s ease, opacity 0.2s; cursor: crosshair; }
				.stats-large-bar:hover { opacity: 1; filter: brightness(1.2); }
				.stats-large-label { font-size: 0.7em; margin-top: 8px; color: var(--text-muted); white-space: nowrap; }
				.stats-large-value { font-size: 0.75em; margin-top: 4px; font-weight: bold; font-family: var(--font-monospace); white-space: nowrap; }

				/* 移动端触摸优化 (需求 8.5) */
				@media (hover: none) and (pointer: coarse) {
					/* 禁用悬停效果 */
					.stats-tab-btn:hover { background: transparent; color: var(--text-muted); }
					.history-chart-subtitle:hover { color: var(--text-muted); text-decoration: none; }
					.stats-large-bar:hover { opacity: 0.8; filter: none; }
					.foreshadowing-filter-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.foreshadowing-action-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.timeline-action-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.timeline-chapter-link:hover { color: var(--text-accent); }
					
					/* 触摸目标 - 最小 44px */
					.stats-tab-btn { min-height: 44px; padding: 12px 16px; }
					button, .clickable-icon { min-height: 44px; min-width: 44px; }
					.foreshadowing-filter-btn { min-height: 44px; padding: 8px 16px; }
					.foreshadowing-action-btn { min-height: 44px; padding: 8px 16px; font-size: 0.85em; }
					.timeline-action-btn { min-height: 44px; padding: 8px 16px; font-size: 0.85em; }
					.timeline-add-btn { width: 44px; height: 44px; font-size: 1.4em; }
					.timeline-chapter-link { min-height: 44px; display: inline-flex; align-items: center; padding: 4px 8px; }
					
					/* 增加间距避免误触 */
					.stats-tab-group { gap: 12px; }
					.time-grid { gap: 12px; }
					.foreshadowing-view-filter-row { gap: 8px; }
					.foreshadowing-entry-actions { gap: 8px; }
					.timeline-actions { gap: 6px; }
					
					/* 优化移动端卡片间距 */
					.status-card { padding: 18px; margin-bottom: 18px; }
					.foreshadowing-entry-card { padding: 14px 16px; margin-bottom: 12px; }
					.timeline-content { padding: 12px 14px 12px 28px; }
					
					/* 优化表单输入框 */
					.timeline-form-input { min-height: 44px; padding: 10px 12px; font-size: 0.9em; }
					.timeline-form-textarea { min-height: 80px; padding: 10px 12px; font-size: 0.9em; }
					
					/* 拖拽手柄更大 */
					.timeline-drag-handle { font-size: 1.2em; left: 8px; }
					.timeline-content:hover .timeline-drag-handle { opacity: 0.6; }
				}

				.foreshadowing-view-container { padding: 12px; overflow-y: auto; }
				.foreshadowing-view-header { margin-bottom: 12px; }
				.foreshadowing-view-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
				.foreshadowing-view-title { font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.foreshadowing-view-folder { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; }
				.foreshadowing-view-filter-row { display: flex; gap: 4px; flex-wrap: wrap; }
				.foreshadowing-filter-btn { padding: 2px 8px; border-radius: 10px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.8em; }
				.foreshadowing-filter-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.foreshadowing-filter-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
				.foreshadowing-view-empty { color: var(--text-muted); font-size: 0.9em; padding: 20px 0; text-align: center; }
				.foreshadowing-view-hint { font-size: 0.8em; }
				.foreshadowing-group-header { display: flex; align-items: center; gap: 6px; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border); }
				.foreshadowing-group-label { font-size: 0.8em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
				.foreshadowing-group-count { font-size: 0.75em; background: var(--background-modifier-border); color: var(--text-muted); padding: 1px 6px; border-radius: 8px; }
				.foreshadowing-entry-card { background: var(--background-secondary); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; border-left: 3px solid var(--background-modifier-border); }
				.foreshadowing-entry-card.status-pending { border-left-color: var(--color-orange, #f59e0b); }
				.foreshadowing-entry-card.status-recovered { border-left-color: var(--color-green, #10b981); opacity: 0.75; }
				.foreshadowing-entry-card.status-deprecated { border-left-color: var(--text-muted); opacity: 0.5; }
				.foreshadowing-entry-desc { margin-bottom: 6px; }
				.foreshadowing-entry-desc-text { font-weight: 600; font-size: 0.9em; color: var(--text-normal); }
				.foreshadowing-entry-quotes { margin-bottom: 6px; }
				.foreshadowing-entry-quote { margin-bottom: 4px; }
				.foreshadowing-entry-quote-meta { font-size: 0.72em; color: var(--text-muted); margin-bottom: 2px; }
				.foreshadowing-entry-quote-text { font-size: 0.82em; color: var(--text-muted); padding-left: 8px; border-left: 2px solid var(--background-modifier-border); line-height: 1.5; white-space: pre-wrap; }
				.foreshadowing-entry-footer { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
				.foreshadowing-entry-tags { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
				.foreshadowing-entry-tag { font-size: 0.72em; color: var(--interactive-accent); background: var(--background-primary); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--interactive-accent); opacity: 0.8; }
				.foreshadowing-entry-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
				.foreshadowing-action-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.75em; }
				.foreshadowing-action-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.foreshadowing-recover-btn { border-color: var(--color-orange, #f59e0b); color: var(--color-orange, #f59e0b); }
				.foreshadowing-recover-btn:hover { background: var(--color-orange, #f59e0b); color: white; }
				.foreshadowing-deprecate-btn { border-color: var(--text-muted); color: var(--text-muted); }
				.foreshadowing-deprecate-btn:hover { background: var(--text-muted); color: white; }
				.foreshadowing-entry-recovery { font-size: 0.78em; color: var(--text-muted); margin-top: 4px; }
				.foreshadowing-entry-recovery-link { color: var(--color-green, #10b981); cursor: pointer; text-decoration: underline; }

				.timeline-view-container { padding: 12px; overflow-y: auto; }
				.timeline-view-header { margin-bottom: 12px; }
				.timeline-view-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
				.timeline-view-title { font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.timeline-add-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 1.2em; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; padding: 0; }
				.timeline-add-btn:hover { filter: brightness(1.1); }
				.timeline-view-folder { font-size: 0.75em; color: var(--text-muted); }
				.timeline-view-empty { color: var(--text-muted); font-size: 0.9em; padding: 20px 0; text-align: center; }
				.timeline-view-hint { font-size: 0.8em; }
				.timeline-create-btn { margin-top: 10px; }
				.timeline-list { padding-top: 8px; }
				.timeline-item { display: flex; gap: 10px; margin-bottom: 4px; cursor: grab; }
				.timeline-item:active { cursor: grabbing; }
				.timeline-dragging { opacity: 0.4; }
				.timeline-drag-over-top .timeline-content { border-top: 2px solid var(--interactive-accent) !important; }
				.timeline-drag-over-bottom .timeline-content { border-bottom: 2px solid var(--interactive-accent) !important; }
				.timeline-line { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 16px; padding-top: 4px; }
				.timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--interactive-accent); flex-shrink: 0; }
				.timeline-connector { width: 2px; flex: 1; background: var(--background-modifier-border); min-height: 20px; margin-top: 4px; }
				.timeline-content { flex: 1; background: var(--background-secondary); border-radius: 6px; padding: 8px 10px 8px 22px; margin-bottom: 8px; min-width: 0; position: relative; }
				.timeline-content:hover .timeline-actions { opacity: 1; pointer-events: auto; }
				.timeline-drag-handle { position: absolute; top: 8px; left: 6px; color: var(--text-muted); opacity: 0; font-size: 1em; cursor: grab; line-height: 1; transition: opacity 0.15s; user-select: none; }
				.timeline-content:hover .timeline-drag-handle { opacity: 0.4; }
				.timeline-drag-handle:hover { opacity: 1 !important; cursor: grab; }
				.timeline-time { font-weight: 600; font-size: 0.9em; color: var(--interactive-accent); margin-bottom: 4px; }
				.timeline-list-item { display: flex; flex-direction: column; margin-bottom: 6px; padding-left: 8px; border-left: 2px solid var(--background-modifier-border); }
				.timeline-desc { font-size: 0.85em; color: var(--text-normal); line-height: 1.5; white-space: pre-wrap; }
				.timeline-desc::before { content: "- "; color: var(--text-muted); }
				.timeline-footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
				.timeline-chapter-link { font-size: 0.78em; color: var(--text-accent); cursor: pointer; text-decoration: underline; }
				.timeline-chapter-link:hover { color: var(--interactive-accent); }
				.timeline-type-tag { font-size: 0.72em; color: var(--text-muted); background: var(--background-primary); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--background-modifier-border); }
				.timeline-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 3px; opacity: 0; pointer-events: none; transition: opacity 0.15s; }
				.timeline-action-btn { padding: 2px 7px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); cursor: pointer; font-size: 0.72em; }
				.timeline-action-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.timeline-delete-btn:hover { border-color: var(--color-red, #ef4444); color: var(--color-red, #ef4444); }
				.timeline-edit-form { background: var(--background-secondary); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--interactive-accent); }
				.timeline-form-title { font-weight: 600; font-size: 0.9em; margin-bottom: 8px; color: var(--text-normal); }
				.timeline-form-label { display: block; font-size: 0.78em; color: var(--text-muted); margin-bottom: 3px; margin-top: 8px; }
				.timeline-form-input { width: 100%; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.85em; box-sizing: border-box; }
				.timeline-form-textarea { width: 100%; height: 60px; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.85em; resize: vertical; box-sizing: border-box; font-family: var(--font-text); }
				.timeline-form-btns { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
			`;
		injectGlobalStyle(styleId, styleContent);
	}

	/**
	 * 移除全局样式
	 */
	removeGlobalStyles(): void {
		removeGlobalStyle('accurate-count-global-styles');
	}

	/**
	 * 应用护眼模式
	 * 为 Markdown 编辑器添加护眼背景色
	 */
	applyEyeCare(): void {
		const color = this.settings.eyeCareColor || '#E8F5E9';
		const css = `
			.workspace-leaf-content[data-type="markdown"] .view-content {
				background-color: ${color} !important;
			}
			.markdown-source-view .cm-editor .cm-scroller,
			.markdown-reading-view .markdown-preview-view {
				background-color: transparent !important;
			}
		`;
		injectGlobalStyle('accurate-count-eye-care', css);
	}

	/**
	 * 移除护眼模式
	 */
	removeEyeCare(): void {
		removeGlobalStyle('accurate-count-eye-care');
	}

	/**
	 * 更新设置引用
	 * 当设置更新时调用，确保 StyleManager 使用最新的设置
	 */
	updateSettings(settings: AccurateCountSettings): void {
		this.settings = settings;
	}
}
