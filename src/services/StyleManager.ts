import { injectGlobalStyle, removeGlobalStyle } from '../utils';
import type { AccurateCountSettings } from '../types/settings';

/**
 * 样式管理服务
 * 负责动态样式注入（护眼模式等），静态样式已移至 styles.css 由 Obsidian 自动加载
 */
export class StyleManager {
	constructor(private settings: AccurateCountSettings) { }

	/**
	 * 应用护眼模式
	 * 为 Markdown 编辑器添加护眼背景色
	 */
	applyEyeCare(): void {
		const color = this.settings.eyeCareColor || '#E8F5E9';
		const css = `
			.workspace-leaf-content[data-type="markdown"]:not(:has(.webnovel-homepage)) .view-content {
				background-color: ${color} !important;
			}
			.workspace-leaf-content[data-type="markdown"]:not(:has(.webnovel-homepage)) .markdown-source-view .cm-editor .cm-scroller,
			.workspace-leaf-content[data-type="markdown"]:not(:has(.webnovel-homepage)) .markdown-reading-view .markdown-preview-view {
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
