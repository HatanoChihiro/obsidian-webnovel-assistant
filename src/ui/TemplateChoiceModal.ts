import { Modal, Setting, setIcon, type App, type TFile } from 'obsidian';
import { t } from '../i18n';

/**
 * 章节模板选择弹窗
 * 当设置中存在多个模板文件时，弹窗供用户选择使用哪一个模板创建新章节
 */
export class TemplateChoiceModal extends Modal {
	private files: TFile[];
	private onChoose: (file: TFile | null) => void;
	private isChosen: boolean = false;

	constructor(app: App, files: TFile[], onChoose: (file: TFile | null) => void) {
		super(app);
		this.files = files;
		this.onChoose = onChoose;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-template-choice-modal');

		new Setting(contentEl)
			.setHeading()
			.setName(t('template.choice-modal-title'))
			.setDesc(t('template.choice-modal-desc'));

		const listEl = contentEl.createDiv({ cls: 'wn-template-choice-list' });

		// 不使用模板（空白文档）选项
		const noTemplateItem = listEl.createDiv({ cls: 'wn-template-choice-item wn-template-choice-none' });
		const noTemplateIcon = noTemplateItem.createDiv({ cls: 'wn-template-choice-icon' });
		setIcon(noTemplateIcon, 'file-plus');

		const noTemplateInfo = noTemplateItem.createDiv({ cls: 'wn-template-choice-info' });
		noTemplateInfo.createDiv({ cls: 'wn-template-choice-name', text: t('template.no-template') });
		noTemplateInfo.createDiv({ cls: 'wn-template-choice-path', text: t('template.no-template-desc') });

		noTemplateItem.onclick = () => {
			this.isChosen = true;
			this.onChoose(null);
			this.close();
		};

		for (const file of this.files) {
			const itemEl = listEl.createDiv({ cls: 'wn-template-choice-item' });

			const iconEl = itemEl.createDiv({ cls: 'wn-template-choice-icon' });
			setIcon(iconEl, 'file-text');

			const infoEl = itemEl.createDiv({ cls: 'wn-template-choice-info' });
			infoEl.createDiv({ cls: 'wn-template-choice-name', text: file.basename });
			infoEl.createDiv({ cls: 'wn-template-choice-path', text: file.path });

			itemEl.onclick = () => {
				this.isChosen = true;
				this.onChoose(file);
				this.close();
			};
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (!this.isChosen) {
			// 用户直接关闭/取消弹窗
			this.onChoose(null);
		}
	}
}
