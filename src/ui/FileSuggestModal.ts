import type { App } from 'obsidian';
import { FuzzySuggestModal, Vault, TFile } from 'obsidian';
import { t } from '../i18n';

/**
 * Markdown 文档选择模态框
 * 允许用户模糊搜索并选择 Vault 中的已有 Markdown 文件作为模板
 */
export class FileSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(t('setting.select-file-placeholder'));
	}

	getItems(): TFile[] {
		const files: TFile[] = [];
		Vault.recurseChildren(this.app.vault.getRoot(), (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				files.push(file);
			}
		});
		return files.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}
