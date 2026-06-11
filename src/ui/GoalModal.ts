import type { App, TFile } from 'obsidian';
import { Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * 目标字数设定弹窗
 * 允许用户为单个文件设置自定义的目标字数
 */
export class GoalModal extends Modal {
	file: TFile;
	goalInput: string = "";

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.createEl('h2', {text: t('modal.set-goal-title', { name: this.file.basename })});

		new Setting(contentEl)
			.setName(t('modal.goal-word-count'))
			.setDesc(t('modal.goal-word-count-desc'))
			.addText(text => {
				const cache = this.app.metadataCache.getFileCache(this.file);
				const fmGoal = cache?.frontmatter?.['word-goal'] as unknown;
				if (fmGoal !== undefined && fmGoal !== null) {
					text.setValue(String(fmGoal));
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
		await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
			const fm = frontmatter as Record<string, unknown>;
			if (isNaN(goalNum) || goalNum <= 0) {
				delete fm['word-goal'];
			} else {
				fm['word-goal'] = goalNum;
			}
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
