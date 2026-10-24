import { Logger } from '../utils/Logger';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { TFile, TFolder } from 'obsidian';

export class FileEventManager {
	private plugin: WebNovelAssistantPlugin;
	private pendingCreates = new Map<string, TFile>();
	private drainTimer: number | null = null;
	private pendingYield: { timer: number; resolve: () => void } | null = null;
	private currentDrainPromise: Promise<void> | null = null;
	private isDestroyed = false;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	setup(): void {
		this.registerCreateHandler();
		this.registerModifyHandler();
		this.registerDeleteHandler();
		this.registerRenameHandler();

		this.plugin.app.workspace?.onLayoutReady(() => {
			if (this.isDestroyed || this.plugin.isUnloading) return;
			this.scheduleDrain();
		});
	}

	async destroy(): Promise<void> {
		this.isDestroyed = true;
		if (this.drainTimer !== null) {
			window.clearTimeout(this.drainTimer);
			this.drainTimer = null;
		}
		this.pendingCreates.clear();
		if (this.pendingYield) {
			const pendingYield = this.pendingYield;
			this.pendingYield = null;
			window.clearTimeout(pendingYield.timer);
			pendingYield.resolve();
		}
		if (this.currentDrainPromise) {
			await this.currentDrainPromise;
		}
	}

	private enqueuePreLayoutCreate(file: TFile): void {
		if (this.isDestroyed || this.plugin.isUnloading) return;
		this.pendingCreates.set(file.path, file);
		if (this.plugin.app.workspace?.layoutReady) {
			this.scheduleDrain();
		}
	}

	private scheduleDrain(): void {
		if (this.isDestroyed || this.plugin.isUnloading) return;
		if (this.pendingCreates.size === 0 || this.drainTimer !== null || this.currentDrainPromise) return;
		this.drainTimer = window.setTimeout(() => {
			this.drainTimer = null;
			void this.drainPendingCreates().catch(error => {
				Logger.error('[FileEventManager] Startup cache update failed:', error);
			});
		}, 0);
	}

	private async drainPendingCreates(): Promise<void> {
		if (this.isDestroyed || this.plugin.isUnloading) return;
		if (this.currentDrainPromise) return;

		this.currentDrainPromise = this.processPendingCreates();
		try {
			await this.currentDrainPromise;
		} finally {
			this.currentDrainPromise = null;
			this.scheduleDrain();
		}
	}

	private async processPendingCreates(): Promise<void> {
		let processedInBatch = 0;
		let hasUpdatedCache = false;
		const BATCH_SIZE = 25;

		while (this.pendingCreates.size > 0) {
			if (this.isDestroyed || this.plugin.isUnloading) break;
			if (processedInBatch >= BATCH_SIZE) {
				processedInBatch = 0;
				await new Promise<void>(resolve => {
					this.pendingYield = {
						timer: window.setTimeout(() => {
							this.pendingYield = null;
							resolve();
						}, 0),
						resolve
					};
				});
				if (this.isDestroyed || this.plugin.isUnloading) break;
			}
			processedInBatch++;

			const nextEntry = this.pendingCreates.entries().next().value;
			if (!nextEntry) break;
			const [path, queuedFile] = nextEntry;
			this.pendingCreates.delete(path);

			const authoritative = this.plugin.app.vault.getAbstractFileByPath(queuedFile.path);
			if (authoritative !== queuedFile || !(authoritative instanceof TFile) || authoritative.extension !== 'md') {
				continue;
			}
			if (!this.plugin.cacheManager.isEligibleForTotalWordCount(authoritative)) {
				continue;
			}

			if (this.plugin.cacheManager.isFileCacheCurrent(authoritative)) {
				continue;
			}

			const expectedMtime = authoritative.stat.mtime;
			const expectedPath = authoritative.path;

			try {
				const content = await this.plugin.app.vault.read(authoritative);
				if (this.isDestroyed || this.plugin.isUnloading) break;

				const currentAuth = this.plugin.app.vault.getAbstractFileByPath(expectedPath);
				if (currentAuth !== authoritative || !(currentAuth instanceof TFile)) {
					continue;
				}
				if (currentAuth.path !== expectedPath || currentAuth.stat.mtime !== expectedMtime
					|| !this.plugin.cacheManager.isEligibleForTotalWordCount(currentAuth)
					|| this.plugin.cacheManager.isFileCacheCurrent(currentAuth)) {
					continue;
				}

				const wordCount = this.plugin.calculateAccurateWords(content);
				this.plugin.cacheManager.updateFileCache(authoritative, wordCount, this.plugin.app.vault);
				hasUpdatedCache = true;
			} catch (error) {
				Logger.error('[Plugin] 新文件字数统计失败:', error);
			}
		}

		if (hasUpdatedCache && !this.isDestroyed && !this.plugin.isUnloading) {
			this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
				if (this.isDestroyed || this.plugin.isUnloading) return;
				this.plugin.refreshFolderCounts();
			}, 500);
		}
	}

	private registerCreateHandler(): void {
		this.plugin.writingJourneyService.initializeStartupBaseline();
		if (this.plugin.writingJourneyService.checkInitialMetadataReadiness()) {
			this.plugin.writingJourneyService.markReady();
		}
		if (this.plugin.app.metadataCache?.on) {
			this.plugin.registerEvent(this.plugin.app.metadataCache.on('resolved', () => {
				this.plugin.writingJourneyService.markReady();
			}));
		}
		this.plugin.registerEvent(this.plugin.app.vault.on('create', async (file) => {
			if (this.isDestroyed || this.plugin.isUnloading) return;
			const wasLayoutReady = Boolean(this.plugin.app.workspace?.layoutReady);

			if (file instanceof TFile && file.extension === 'md') {
				try {
					await this.plugin.writingJourneyService.handleVaultCreate(file);
				} catch (error) {
					Logger.error('[WritingJourney] Failed to record external create:', error);
				}
			}
			if (this.isDestroyed || this.plugin.isUnloading) return;
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			if (!this.plugin.cacheManager.isEligibleForTotalWordCount(file)) return;

			if (!wasLayoutReady) {
				this.enqueuePreLayoutCreate(file);
				return;
			}

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

			// 智能前置过滤：非目标网文文件立即早期返回，避免多余的 IO 与计算调度
			if (!this.plugin.cacheManager.isEligibleForTotalWordCount(file)) return;

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

					this.plugin.cacheManager.updateFileCache(file, newWordCount, this.plugin.app.vault);
				} catch (error) {
					Logger.error('[Plugin] 更新文件字数缓存失败:', error);
				}
				// 非活跃文件：缓存已更新，只刷新显示
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			} else {
				// 活跃文件：字数由 EditorTracker 在内存中实时追踪，
				// 这里只负责刷新文件浏览器的字数标签显示
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			}
		}));
	}

	private registerDeleteHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('delete', (abstractFile) => {
			if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				this.pendingCreates.delete(abstractFile.path);
				void this.plugin.writingJourneyService.handleVaultDelete(abstractFile).catch(error => {
					Logger.error('[WritingJourney] Failed to record external delete:', error);
				});
				const oldWordCount = this.plugin.cacheManager.getFileCache(abstractFile.path);
				
				if (oldWordCount !== null) {
					this.plugin.cacheManager.invalidateCache(abstractFile.path, this.plugin.app.vault);

					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
				}
			} else if (abstractFile instanceof TFolder) {
				const prefix = abstractFile.path + '/';
				for (const p of Array.from(this.pendingCreates.keys())) {
					if (p.startsWith(prefix)) {
						this.pendingCreates.delete(p);
					}
				}
				void this.plugin.writingJourneyService.handleVaultDelete(abstractFile).catch(error => {
					Logger.error('[WritingJourney] Failed to handle folder delete:', error);
				});
				// 处理文件夹删除
				let hasChanges = false;
				const entries = Array.from(this.plugin.cacheManager.getEntries());
				for (const [path, entry] of entries) {
					if (!entry.isFolder && path.startsWith(prefix)) {
						hasChanges = true;
						this.plugin.cacheManager.invalidateCache(path, this.plugin.app.vault);
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

	private registerRenameHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (abstractFile, oldPath) => {
			if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				void this.plugin.writingJourneyService.handleVaultRename(abstractFile, oldPath).catch(error => {
					Logger.error('[WritingJourney] Failed to record external rename:', error);
				});
			}
			const isMdFile = abstractFile instanceof TFile && abstractFile.extension === 'md';
			const wasMdFile = oldPath.endsWith('.md');

			if (isMdFile || wasMdFile) {
				if (this.pendingCreates.has(oldPath)) {
					this.pendingCreates.delete(oldPath);
					if (abstractFile instanceof TFile && this.plugin.cacheManager.isEligibleForTotalWordCount(abstractFile)) {
						this.pendingCreates.set(abstractFile.path, abstractFile);
					}
				}

				const oldCache = this.plugin.cacheManager.getFileCache(oldPath);
				
				// 只要旧文件曾经是 md，就在缓存中将其移除
				if (oldCache !== null) {
					this.plugin.cacheManager.invalidateCache(oldPath, this.plugin.app.vault);
				}
				
				if (abstractFile instanceof TFile && !this.plugin.cacheManager.isFileInWorkspace(abstractFile)) {
					// 移出了工作区，等同于删除
					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
					return;
				}

				if (abstractFile instanceof TFile && !this.plugin.cacheManager.isEligibleForTotalWordCount(abstractFile)) {
					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
					return;
				}

				// 只有当新文件是 md 且旧缓存存在时，才将旧缓存继承给新路径
				if (isMdFile && oldCache !== null && abstractFile instanceof TFile) {
					this.plugin.cacheManager.updateFileCache(abstractFile, oldCache, this.plugin.app.vault);
					// 重命名不会改变正文，继承旧缓存即可。避免批量移动时为每个文件重复读取正文，
					// 也避免异步读取与后续连续重命名交错。
					this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 500);
					return;
				}

				// 只有新文件是 md 时，才进行新一轮的读取和计算
				if (isMdFile && abstractFile instanceof TFile) {
					this.plugin.adaptiveDebounceManager.debounceFixed(`file-refresh-${abstractFile.path}`, () => {
						void this.plugin.updateFileCacheAndRefresh(abstractFile);
					}, 500);
				}
			} else if (abstractFile instanceof TFolder) {
				const oldPrefix = oldPath + '/';
				const newPrefix = abstractFile.path + '/';
				for (const p of Array.from(this.pendingCreates.keys())) {
					if (p.startsWith(oldPrefix)) {
						this.pendingCreates.delete(p);
						const newFilePath = newPrefix + p.substring(oldPrefix.length);
						const newFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
						if (newFile instanceof TFile && this.plugin.cacheManager.isEligibleForTotalWordCount(newFile)) {
							this.pendingCreates.set(newFilePath, newFile);
						}
					}
				}

				void this.plugin.writingJourneyService.handleVaultRename(abstractFile, oldPath).catch(error => {
					Logger.error('[WritingJourney] Failed to handle folder rename:', error);
				});
				// 处理文件夹重命名
				const entries = Array.from(this.plugin.cacheManager.getEntries());
				let hasChanges = false;
				for (const [path, entry] of entries) {
					if (!entry.isFolder && path.startsWith(oldPrefix)) {
						hasChanges = true;
						const oldWordCount = entry.wordCount;
						this.plugin.cacheManager.invalidateCache(path, this.plugin.app.vault);
						
						const newFilePath = newPrefix + path.substring(oldPrefix.length);
						const newFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
						if (newFile instanceof TFile && this.plugin.cacheManager.isEligibleForTotalWordCount(newFile)) {
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
