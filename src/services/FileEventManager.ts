import { Logger } from '../utils/Logger';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { TFile, TFolder } from 'obsidian';

export class FileEventManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	setup(): void {
		this.registerCreateHandler();
		this.registerModifyHandler();
		this.registerDeleteHandler();
		this.registerRenameHandler();
	}

	private registerCreateHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('create', async (file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			if (!this.plugin.cacheManager.isEligibleForWordCount(file)) return;

			try {
				const content = await this.plugin.app.vault.read(file);
				const wordCount = this.plugin.calculateAccurateWords(content);
				this.plugin.cacheManager.updateFileCache(file, wordCount, this.plugin.app.vault);
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			} catch (error) {
				Logger.error('[Plugin] 新文件字数统计失败:', error);
			}
		}));
	}

	private registerModifyHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('modify', async (file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;

			const notesFilePath = this.plugin.stickyNoteManager.getNotesFilePath();

			// 便签文件外部变更同步（如多端同步工具修改了 notes-data.json）
			if (file.path === notesFilePath && !this.plugin.stickyNoteManager.getIsWriting()) {
				await this.plugin.stickyNoteManager.loadNotes();
				this.plugin.stickyNoteManager.syncFloatingNotes();
				return;
			}

			// 字数缓存更新逻辑
			if (!this.plugin.cacheManager.isEligibleForWordCount(file)) return;

			const isActiveFile = file.path === this.plugin.app.workspace.getActiveFile()?.path;

			if (!isActiveFile) {
				try {
					const content = await this.plugin.app.vault.read(file);
					const newWordCount = this.plugin.calculateAccurateWords(content);
					const oldWordCount = this.plugin.cacheManager.getFileCache(file.path);

					if (oldWordCount === null) {
						this.plugin.cacheManager.updateFileCache(file, newWordCount, this.plugin.app.vault);
						this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
							this.plugin.refreshFolderCounts();
						}, 500);
						return;
					}

					const delta = this.plugin.cacheManager.updateFileCache(file, newWordCount, this.plugin.app.vault);
					if (delta !== 0) {
						if (this.plugin.isLayoutReady) {
							this.plugin.app.workspace.trigger('webnovel:file-word-count-updated', file, delta);
						}
					}
				} catch (error) {
					Logger.error('[Plugin] 更新每日历史统计失败:', error);
				}
				// 非活跃文件：缓存已更新，只刷新显示
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			} else {
				// 活跃文件：由 EditorTracker 追踪，这里只刷新文件浏览器显示
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					void this.plugin.updateFileCacheAndRefresh(file);
				}, 500);
			}
		}));
	}

	private registerDeleteHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('delete', (abstractFile) => {
			if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				const oldWordCount = this.plugin.cacheManager.getFileCache(abstractFile.path);
				
				if (oldWordCount !== null) {
					this.plugin.cacheManager.invalidateCache(abstractFile.path, this.plugin.app.vault);
					
					if (this.plugin.isLayoutReady) {
						this.plugin.app.workspace.trigger('webnovel:file-word-count-updated', abstractFile, -oldWordCount);
					}

					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
				}
			} else if (abstractFile instanceof TFolder) {
				// 处理文件夹删除
				const prefix = abstractFile.path + '/';
				let totalDelta = 0;
				const entries = Array.from(this.plugin.cacheManager.getEntries());
				for (const [path, entry] of entries) {
					if (!entry.isFolder && path.startsWith(prefix)) {
						totalDelta -= entry.wordCount;
						this.plugin.cacheManager.invalidateCache(path, this.plugin.app.vault);
					}
				}
				if (totalDelta !== 0) {
					if (this.plugin.isLayoutReady) {
						this.plugin.app.workspace.trigger('webnovel:file-word-count-updated', abstractFile, totalDelta);
					}
					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
				}
			}
		}));
	}

	private registerRenameHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (abstractFile, oldPath) => {
			const isMdFile = abstractFile instanceof TFile && abstractFile.extension === 'md';
			const wasMdFile = oldPath.endsWith('.md');

			if (isMdFile || wasMdFile) {
				const oldCache = this.plugin.cacheManager.getFileCache(oldPath);
				
				// 只要旧文件曾经是 md，就在缓存中将其移除
				if (oldCache !== null) {
					this.plugin.cacheManager.invalidateCache(oldPath, this.plugin.app.vault);
				}
				
				if (abstractFile instanceof TFile && !this.plugin.cacheManager.isFileInWorkspace(abstractFile)) {
					// 移出了工作区，等同于删除
					if (oldCache !== null && this.plugin.isLayoutReady) {
						this.plugin.app.workspace.trigger('webnovel:file-word-count-updated', abstractFile, -oldCache);
					}
					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
					return;
				}

				// 只有当新文件是 md 且旧缓存存在时，才将旧缓存继承给新路径
				if (isMdFile && oldCache !== null && abstractFile instanceof TFile) {
					this.plugin.cacheManager.updateFileCache(abstractFile, oldCache, this.plugin.app.vault);
				}

				// 只有新文件是 md 时，才进行新一轮的读取和计算
				if (isMdFile && abstractFile instanceof TFile) {
					this.plugin.adaptiveDebounceManager.debounceFixed(`file-refresh-${abstractFile.path}`, () => {
						void this.plugin.updateFileCacheAndRefresh(abstractFile);
					}, 500);
				}
			} else if (abstractFile instanceof TFolder) {
				// 处理文件夹重命名
				const oldPrefix = oldPath + '/';
				const newPrefix = abstractFile.path + '/';
				
				const entries = Array.from(this.plugin.cacheManager.getEntries());
				let hasChanges = false;
				for (const [path, entry] of entries) {
					if (!entry.isFolder && path.startsWith(oldPrefix)) {
						hasChanges = true;
						const oldWordCount = entry.wordCount;
						this.plugin.cacheManager.invalidateCache(path, this.plugin.app.vault);
						
						const newFilePath = newPrefix + path.substring(oldPrefix.length);
						const newFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
						if (newFile instanceof TFile && this.plugin.cacheManager.isEligibleForWordCount(newFile)) {
							this.plugin.cacheManager.updateFileCache(newFile, oldWordCount, this.plugin.app.vault);
						}
					}
				}
				if (hasChanges) {
					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
				}
			}
		}));
	}
}
