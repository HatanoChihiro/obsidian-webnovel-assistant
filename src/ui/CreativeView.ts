import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

import { getCurrentBookContext } from '../utils/path';

/**
 * 创作工具面板基类
 * 提供文件夹跟踪和文件监听的公共逻辑
 * ForeshadowingView 和 TimelineView 都继承此类
 */
export abstract class CreativeView extends ItemView {
	plugin: WebNovelAssistantPlugin;
	currentFolder: string = '';

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	/**
	 * 子类返回要监听的文件名（不含 .md）
	 * 当该文件被修改时自动刷新面板
	 */
	protected abstract getWatchFileName(): string;

	/**
	 * 子类实现具体的刷新逻辑
	 */
	abstract refresh(): Promise<void>;

	async onOpen() {
		// 监听活动文件变化，自动切换文件夹
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => { void this.onActiveFileChange(); })
		);
		this.registerEvent(
			// @ts-expect-error custom event bypass
			this.app.workspace.on('webnovel-workbench-book-changed', (bookPath: string) => {
				const folderStr = bookPath === '/' ? '/' : bookPath;
				if (folderStr && folderStr !== this.currentFolder) {
					this.currentFolder = folderStr;
					void this.onFolderChange();
				}
			})
		);
		// 监听对应文件修改，自动刷新
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				const watchName = this.getWatchFileName() + '.md';
				if (file instanceof TFile && file.name === watchName) {
					void this.refresh();
				}
			})
		);
		await this.onActiveFileChange();
	}

	protected async onActiveFileChange() {
		const bookPath = getCurrentBookContext(this.app, this.plugin);
		if (bookPath) {
			const folderStr = bookPath === '/' ? '/' : bookPath;
			if (folderStr !== this.currentFolder) {
				this.currentFolder = folderStr;
				await this.onFolderChange();
			}
		}
	}

	/**
	 * 文件夹切换时的钩子，子类可覆盖
	 * 默认行为是刷新面板
	 */
	protected async onFolderChange() {
		await this.refresh();
	}

	async onClose() {}
}
