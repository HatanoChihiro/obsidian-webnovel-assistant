import type { App, TFile } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

/**
 * 目标字数设定弹窗
 * 允许用户为单个文件设置自定义的目标字数
 */
export class GoalModal extends Modal {
	file: TFile;
	plugin: WebNovelAssistantPlugin;
	goalInput: string = "";

	constructor(app: App, plugin: WebNovelAssistantPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	onOpen() {
		const {contentEl} = this;
		new Setting(contentEl).setName(t('modal.set-goal-title', { name: this.file.basename })).setHeading();

		new Setting(contentEl)
			.setName(t('modal.goal-word-count'))
			.setDesc(t('modal.goal-word-count-desc'))
			.addText(text => {
				const cache = this.app.metadataCache.getFileCache(this.file);
				const fmGoal = cache?.frontmatter?.['word-goal'] as unknown;
				if (fmGoal !== undefined && fmGoal !== null) {
					const strGoal = typeof fmGoal === 'string' ? fmGoal : (typeof fmGoal === 'number' || typeof fmGoal === 'boolean' ? String(fmGoal) : JSON.stringify(fmGoal));
					text.setValue(strGoal);
				}
				text.inputEl.focus();
				text.onChange(value => { this.goalInput = value; });
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') void this.saveGoal();
				});
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('common.save'))
				.setCta()
				.onClick(() => { void this.saveGoal(); })
			);
	}

	async saveGoal() {
		const goalNum = parseInt(this.goalInput, 10);
		if (this.plugin.homepageManager) {
			await this.plugin.homepageManager.setChapterWordGoal(this.file, goalNum);
		}
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
