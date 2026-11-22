import { showPluginNotice } from '../services/PluginNoticeService';
import { Logger } from '../utils/Logger';
import { requireApiVersion, type ButtonComponent, type SliderComponent } from 'obsidian';
import { t } from '../i18n';
import { cleanForPlainCopy, type MarkdownCleanerOptions } from './markdownCleaner';

/**
 * Apply destructive/warning styling across Obsidian 1.8.7+ and 1.13.0+ hosts.
 */
export function applyDestructiveButtonStyle(button: ButtonComponent): void {
	if (requireApiVersion('1.13.0')) {
		button.setDestructive();
	} else {
		button.buttonEl.addClass('mod-warning');
	}
}

/**
 * Show an inline numeric value next to a slider on pre-1.13 Obsidian hosts
 * (1.13+ hosts render slider values natively).
 */
export function attachLegacySliderValue(slider: SliderComponent): void {
	if (requireApiVersion('1.13.0')) return;
	const sliderEl = slider.sliderEl;
	const parentEl = sliderEl.parentElement;
	if (!parentEl) return;

	const valueEl = parentEl.createSpan({
		cls: 'wn-slider-value',
		text: sliderEl.value || String(slider.getValue())
	});
	sliderEl.addEventListener('input', () => {
		valueEl.textContent = sliderEl.value;
	});
}

/**
 * 复制并清理 Markdown 语法，只保留纯文本内容
 */
export async function copyDocumentContent(title: string, rawContent: string, options: MarkdownCleanerOptions = {}): Promise<void> {
	const cleanContent = cleanForPlainCopy(rawContent, options);

	const contentWithTitle = title ? `${title}\n\n${cleanContent.trim()}` : cleanContent.trim();
	try {
		await navigator.clipboard.writeText(contentWithTitle);
		showPluginNotice(t('notice.copy-success'));
	} catch (err) {
		Logger.error('[Plugin] 复制失败:', err);
		showPluginNotice(t('notice.copy-failed'));
	}
}
