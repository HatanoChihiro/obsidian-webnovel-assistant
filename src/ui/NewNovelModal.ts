import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { NovelMetadata } from '../types/homepage';
import { t } from '../i18n';

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
		new Setting(contentEl).setName(t('modal.new-novel')).setHeading();

		new Setting(contentEl)
			.setName(t('modal.novel-name'))
			.setDesc(t('modal.novel-name-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.novel-name-placeholder'));
				text.onChange(value => { this.novelName = value; });
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.setName(t('modal.synopsis'))
			.setDesc(t('modal.synopsis-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.synopsis-placeholder'));
				text.onChange(value => { this.synopsis = value; });
			});

		new Setting(contentEl)
			.setName(t('modal.genre'))
			.setDesc(t('modal.genre-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.genre-placeholder'));
				text.onChange(value => { this.genre = value; });
			});

		new Setting(contentEl)
			.setName(t('modal.total-word-goal'))
			.setDesc(t('modal.total-word-goal-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.total-word-goal-placeholder'));
				text.onChange(value => { this.wordGoal = value; });
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('common.create'))
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