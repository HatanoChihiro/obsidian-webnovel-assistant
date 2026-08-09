import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

/**
 * 排版细节快捷微调 Modal
 * 由命令面板唤醒，提供极速响应的 Slider 拖动微调，毫秒级实时刷新编辑器与阅读模式排版效果
 */
export class TypographyQuickModal extends Modal {
	constructor(
		app: App,
		private plugin: WebNovelAssistantPlugin
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(t('modal.quick-typography-title'))
			.setHeading();

		const typo = this.plugin.settings.typography;
		if (!typo) return;

		// 1. 首行缩进 (0 ~ 4em)
		const currentIndentNum = parseFloat(typo.indentSize) || 2;
		const indentSetting = new Setting(contentEl)
			.setName(t('setting.typography-indent-size'))
			.setDesc(`${currentIndentNum}em`)
			.addSlider(slider => {
				slider
					.setLimits(0, 4, 0.5)
					.setValue(currentIndentNum)
					.onChange(val => {
						typo.enableIndent = val > 0;
						typo.indentSize = `${val}em`;
						indentSetting.setDesc(`${val}em`);
						this.applyRealtime();
					});
			});

		// 2. 行高 (1.0 ~ 3.0)
		const lineHeightSetting = new Setting(contentEl)
			.setName(t('setting.typography-line-height'))
			.setDesc(`${typo.lineHeight || 1.8}`)
			.addSlider(slider => {
				slider
					.setLimits(1.0, 3.0, 0.1)
					.setValue(typo.lineHeight || 1.8)
					.onChange(val => {
						typo.lineHeight = Math.round(val * 10) / 10;
						lineHeightSetting.setDesc(`${typo.lineHeight}`);
						this.applyRealtime();
					});
			});

		// 3. 段间距 (0 ~ 2.0em)
		const currentParaNum = parseFloat(typo.paragraphSpacing) || 0.5;
		const paraSetting = new Setting(contentEl)
			.setName(t('setting.typography-para-spacing'))
			.setDesc(`${currentParaNum}em`)
			.addSlider(slider => {
				slider
					.setLimits(0, 2.0, 0.1)
					.setValue(currentParaNum)
					.onChange(val => {
						const numVal = Math.round(val * 10) / 10;
						typo.paragraphSpacing = `${numVal}em`;
						paraSetting.setDesc(`${numVal}em`);
						this.applyRealtime();
					});
			});

		// 4. 字间距 (0 ~ 0.20em)
		const currentLetterNum = parseFloat(typo.letterSpacing) || 0.05;
		const letterSetting = new Setting(contentEl)
			.setName(t('setting.typography-letter-spacing'))
			.setDesc(`${currentLetterNum}em`)
			.addSlider(slider => {
				slider
					.setLimits(0, 0.20, 0.01)
					.setValue(currentLetterNum)
					.onChange(val => {
						const numVal = Math.round(val * 100) / 100;
						typo.letterSpacing = `${numVal}em`;
						letterSetting.setDesc(`${numVal}em`);
						this.applyRealtime();
					});
			});

		// 5. 最大行宽 (350 ~ 1200px)
		const currentWidthNum = parseInt(typo.maxLineWidth, 10) || 700;
		const widthSetting = new Setting(contentEl)
			.setName(t('setting.typography-max-line-width'))
			.setDesc(`${currentWidthNum}px`)
			.addSlider(slider => {
				slider
					.setLimits(350, 1200, 25)
					.setValue(currentWidthNum)
					.onChange(val => {
						typo.maxLineWidth = `${val}px`;
						widthSetting.setDesc(`${val}px`);
						this.applyRealtime();
					});
			});

		// 6. 两端对齐 Toggle
		new Setting(contentEl)
			.setName(t('setting.typography-justify-text'))
			.addToggle(toggle => {
				toggle
					.setValue(typo.justifyText ?? true)
					.onChange(val => {
						typo.justifyText = val;
						this.applyRealtime();
					});
			});

		// 7. 阅读模式兼容 Toggle
		new Setting(contentEl)
			.setName(t('setting.typography-reading-compat'))
			.addToggle(toggle => {
				toggle
					.setValue(typo.enableReadingModeCompat ?? false)
					.onChange(val => {
						typo.enableReadingModeCompat = val;
						this.applyRealtime();
					});
			});
	}

	/**
	 * 拖动滑块时毫秒级实时刷新 DOM 样式并持久化设置
	 */
	private applyRealtime(): void {
		this.plugin.typographyManager.updateTypography();
		void this.plugin.saveSettings();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		void this.plugin.saveSettings();
	}
}
