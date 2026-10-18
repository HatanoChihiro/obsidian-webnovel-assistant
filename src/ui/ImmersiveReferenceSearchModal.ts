import type { App } from 'obsidian';
import { FuzzySuggestModal, Notice, TFile } from 'obsidian';
import { t } from '../i18n';

export interface ImmersiveReferenceSearchPlugin {
	getVaultMarkdownFiles(): TFile[];
}

/**
 * 沉浸模式参考文档模糊搜索模态框
 * 仅在打开时一次性获取 Vault 所有 Markdown 文件列表，展示完整路径，不随按键重复枚举
 */
export class ImmersiveReferenceSearchModal extends FuzzySuggestModal<TFile> {
	private files: TFile[];
	private isChosen = false;
	private onChoose: (file: TFile) => void;
	private onCancel?: () => void;

	constructor(
		app: App,
		private plugin: ImmersiveReferenceSearchPlugin,
		onChoose: (file: TFile) => void,
		onCancel?: () => void
	) {
		super(app);
		this.onChoose = onChoose;
		this.onCancel = onCancel;

		this.setPlaceholder(t('immersive.search-reference-placeholder'));
		// 打开时一次性获取全库 Markdown 文档，避免按键触发重复枚举
		this.files = this.plugin.getVaultMarkdownFiles() || [];
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		const vaultFile = this.app.vault?.getAbstractFileByPath?.(file?.path);
		if (!(vaultFile instanceof TFile) || vaultFile.extension !== 'md') {
			new Notice(t('immersive.reference-file-invalid'));
			return;
		}
		this.isChosen = true;
		this.onChoose(vaultFile);
	}

	onClose(): void {
		// SuggestModal 可能先关闭再通知选择；等该调用栈结束后区分取消和选中。
		void Promise.resolve().then(() => {
			if (!this.isChosen) this.onCancel?.();
		});
	}
}
