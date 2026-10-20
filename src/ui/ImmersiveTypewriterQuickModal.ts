import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { ImmersiveModeSettings } from '../types/settings';
import { Logger } from '../utils/Logger';
import { t } from '../i18n';

export interface ImmersiveTypewriterQuickPlugin {
	settings: {
		immersive: Pick<ImmersiveModeSettings, 'typewriterEnabled' | 'typewriterCenterOffset' | 'typewriterUnfocusedOpacity'>;
	};
	saveSettings(): Promise<void>;
}

export interface ImmersiveTypewriterQuickModalOptions {
	onClose?: () => void;
}

/**
 * 沉浸模式打字机快捷微调 Modal
 * 由沉浸顶栏打字机齿轮按钮唤起，提供中心偏移量与未聚焦淡化透明度的即时滑块调节
 */
export class ImmersiveTypewriterQuickModal extends Modal {
	constructor(
		app: App,
		private plugin: ImmersiveTypewriterQuickPlugin,
		private options?: ImmersiveTypewriterQuickModalOptions
	) {
		super(app);
	}

	onOpen(): void {
		this.containerEl.addClass('wn-corner-modal-container');
		this.modalEl.addClass('wn-corner-modal');
		this.modalEl.addClass('wn-immersive-typewriter-modal');

		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(t('immersive.typewriter-quick-title'))
			.setHeading();

		const immersive = this.plugin.settings.immersive;

		// 1. 中心偏移量 (-30 ~ 30, 步长 1, 默认 0)
		const currentOffset = immersive.typewriterCenterOffset ?? 0;
		const offsetSetting = new Setting(contentEl)
			.setName(t('setting.immersive-typewriter-offset'))
			.setDesc(`${currentOffset}%`)
			.addSlider(slider => {
				slider
					.setLimits(-30, 30, 1)
					.setValue(currentOffset)
					.setDynamicTooltip()
					.onChange(async (val) => {
						immersive.typewriterCenterOffset = val;
						offsetSetting.setDesc(`${val}%`);
						await this.applyChange(false);
					});
			});

		// 2. 未聚焦淡化不透明度 (0.1 ~ 1.0, 步长 0.05, 默认 0.4)
		const currentOpacity = immersive.typewriterUnfocusedOpacity ?? 0.4;
		const opacitySetting = new Setting(contentEl)
			.setName(t('setting.immersive-typewriter-opacity'))
			.setDesc(`${Math.round(currentOpacity * 100)}%`)
			.addSlider(slider => {
				slider
					.setLimits(0.1, 1.0, 0.05)
					.setValue(currentOpacity)
					.setDynamicTooltip()
					.onChange(async (val) => {
						const roundedVal = Math.round(val * 100) / 100;
						immersive.typewriterUnfocusedOpacity = roundedVal;
						opacitySetting.setDesc(`${Math.round(roundedVal * 100)}%`);
						await this.applyChange(true);
					});
			});
	}

	private async applyChange(updateOpacityProperty: boolean): Promise<void> {
		const doc = this.containerEl.ownerDocument;
		const immersive = this.plugin.settings.immersive;
		if (updateOpacityProperty && immersive.typewriterEnabled && doc.body.classList.contains('immersive-mode-active')) {
			doc.body.setCssProps({ '--wn-typewriter-opacity': String(immersive.typewriterUnfocusedOpacity ?? 0.4) });
		}

		this.app.workspace.updateOptions();

		try {
			await this.plugin.saveSettings();
		} catch (error) {
			Logger.error('[ImmersiveTypewriterQuickModal] Failed to save settings:', error);
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.options?.onClose?.();
	}
}
