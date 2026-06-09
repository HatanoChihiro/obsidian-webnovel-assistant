import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { NovelMetadata } from '../types/homepage';

export class NewNovelModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private onSubmit: (result: { name: string; meta: Partial<NovelMetadata> }) => void;

	private novelName: string = '';
	private synopsis: string = '';
	private protagonist: string = '';
	private genre: string = '';
	private wordGoal: string = '';

	constructor(app: App, plugin: WebNovelAssistantPlugin, onSubmit: (result: { name: string; meta: Partial<NovelMetadata> }) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '新建作品' });

		new Setting(contentEl)
			.setName('作品名称')
			.setDesc('将作为文件夹名称')
			.addText(text => {
				text.setPlaceholder('请输入作品名称');
				text.onChange(value => { this.novelName = value; });
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.setName('简介/文案')
			.setDesc('可选')
			.addText(text => {
				text.setPlaceholder('一句话简介...');
				text.onChange(value => { this.synopsis = value; });
			});

		new Setting(contentEl)
			.setName('类型')
			.setDesc('可选')
			.addText(text => {
				text.setPlaceholder('玄幻、都市、科幻...');
				text.onChange(value => { this.genre = value; });
			});

		new Setting(contentEl)
			.setName('总字数目标')
			.setDesc('可选，用于进度条')
			.addText(text => {
				text.setPlaceholder('例如 500000');
				text.onChange(value => { this.wordGoal = value; });
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('创建')
				.setCta()
				.onClick(() => { this.submit(); })
			);

		// Enter 键提交
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && this.novelName.trim()) this.submit();
		});
	}

	private submit(): void {
		if (!this.novelName.trim()) return;

		const meta: Partial<NovelMetadata> = {
			name: this.novelName.trim(),
			synopsis: this.synopsis.trim(),
			genre: this.genre.trim(),
			wordGoal: parseInt(this.wordGoal) || 0,
		};

		this.onSubmit({ name: this.novelName.trim(), meta });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}