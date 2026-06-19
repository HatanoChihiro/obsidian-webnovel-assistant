import { Logger } from '../utils/Logger';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { TFile } from 'obsidian';

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
		this.registerLayoutChangeHandler();
	}

	private registerCreateHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('create', async (file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			if (!this.plugin.isEligibleForWordCount(file)) return;

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

			// [优化] 合并原先的两个 modify 监听器：便签文件同步 + 字数缓存更新
			// 便签文件外部变更同步（如多端同步工具修改了 notes-data.json）
			if (file.path === notesFilePath && !this.plugin.stickyNoteManager.getIsWriting()) {
				await this.plugin.stickyNoteManager.loadNotes();
				this.plugin.syncFloatingNotes();
				return;
			}

			// 字数缓存更新逻辑
			if (!this.plugin.isEligibleForWordCount(file)) return;

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
							const today = window.moment().format('YYYY-MM-DD');
							this.plugin.historyManager.addWords(today, delta);
							this.plugin.sessionAddedWords += delta;

							this.plugin.adaptiveDebounceManager.debounceFixed('save-settings', () => {
								this.plugin.saveSettings().catch(err => {
									Logger.error('[Plugin] 保存设置失败:', err);
								});
							}, 1000);
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
		this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				if (!this.plugin.isEligibleForWordCount(file)) return;

				this.plugin.cacheManager.invalidateCache(file.path, this.plugin.app.vault);
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			}
		}));
	}

	private registerRenameHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				if (!this.plugin.isFileInWorkspace(file)) return;

				const oldCache = this.plugin.cacheManager.getFileCache(oldPath);
				this.plugin.cacheManager.invalidateCache(oldPath, this.plugin.app.vault);

				if (this.plugin.isEligibleForWordCount(file) && oldCache !== null) {
					this.plugin.cacheManager.updateFileCache(file, oldCache, this.plugin.app.vault);
				}

				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					void this.plugin.updateFileCacheAndRefresh(file);
				}, 500);
			}
		}));
	}

	private registerLayoutChangeHandler(): void {
		this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
			this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
				this.plugin.refreshFolderCounts();
			}, 500);
		}));
	}


}
