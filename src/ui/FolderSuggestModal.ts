import type { App } from 'obsidian';
import { FuzzySuggestModal, TFolder } from 'obsidian';
import { t } from '../i18n';

/**
 * 文件夹选择模态框
 * 允许用户模糊搜索并选择 Vault 中的已有文件夹
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private onChoose: (folder: TFolder) => void;

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(t('setting.select-folder-placeholder'));
	}

	getItems(): TFolder[] {
		const files = this.app.vault.getAllLoadedFiles();
		return files
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}
