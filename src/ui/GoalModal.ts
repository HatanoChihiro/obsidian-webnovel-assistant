import { App, Modal, Setting, TFile } from 'obsidian';

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
		contentEl.createEl('h2', {text: `为《${this.file.basename}》设定目标`});

		new Setting(contentEl)
			.setName('目标字数')
			.setDesc('输入 0 或清空则恢复全局默认目标。')
			.addText(text => {
				const cache = this.app.metadataCache.getFileCache(this.file);
				if (cache?.frontmatter && cache.frontmatter['word-goal']) {
					text.setValue(cache.frontmatter['word-goal'].toString());
				}
				text.inputEl.focus();
				text.onChange(value => { this.goalInput = value; });
				text.inputEl.addEventListener('keydown', (e) => { 
					if (e.key === 'Enter') this.saveGoal(); 
				});
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('保存')
				.setCta()
				.onClick(() => { this.saveGoal(); })
			);
	}

	async saveGoal() {
		const goalNum = parseInt(this.goalInput);
		await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
			if (isNaN(goalNum) || goalNum <= 0) {
				delete frontmatter['word-goal'];
			} else {
				frontmatter['word-goal'] = goalNum;
			}
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
