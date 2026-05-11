/**
 * FileEventManager — 桌面端文件事件处理器
 *
 * 从 main.ts 的 setupCoreFeatures 中提取的 4 个 vault/workspace 事件注册：
 *   vault.on('modify')   — 文件修改时更新缓存与历史统计
 *   vault.on('delete')   — 文件删除时失效缓存并刷新
 *   vault.on('rename')   — 文件重命名时转移缓存并刷新
 *   workspace.on('layout-change') — 布局变更时防抖刷新文件夹计数
 */

import type { WebNovelAssistantPlugin } from '../types/plugin';
import { TFile, MarkdownView } from 'obsidian';

export class FileEventManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 注册所有桌面端文件事件处理器
	 */
	setup(): void {
		this.registerModifyHandler();
		this.registerDeleteHandler();
		this.registerRenameHandler();
		this.registerLayoutChangeHandler();
	}

	private registerModifyHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('modify', async (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				// 只处理符合字数统计条件的文件
				if (!this.plugin.isEligibleForWordCount(file)) return;

				const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				const isActiveFile = activeView?.file?.path === file.path;

				// 如果不是当前活动文件，说明是通过其他方式修改的（如批量操作、便签保存）
				// 需要更新每日历史统计
				// 注：_合并章节 文件已在 isEligibleForWordCount 中被拦截，无需重复判断
				if (!isActiveFile) {

					try {
						const content = await this.plugin.app.vault.cachedRead(file);
						const newWordCount = this.plugin.calculateAccurateWords(content);

						// 从缓存中获取旧的字数
						const oldWordCount = this.plugin.cacheManager.getFileCache(file.path);

						// [BUGFIX] 如果是新文件、刚被重命名的文件、或刚通过云同步进入工作区的文件，
						// 缓存中可能没有它，不能视为 0 字，否则会导致历史字数暴涨！
						if (oldWordCount === null) {
							// 没有旧数据，不计算增量，直接更新缓存即可
							this.plugin.cacheManager.updateFileCache(file, newWordCount, this.plugin.app.vault);

							// 使用防抖更新缓存和刷新显示
							this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
								this.plugin.updateFileCacheAndRefresh(file);
							}, 500);
							return;
						}

						const delta = newWordCount - oldWordCount;
						if (delta !== 0) {
							// [BUGFIX] 无论布局是否就绪，都必须立即更新缓存基准！
							// 否则，如果在启动过程中文件发生了修改（如同步、索引更新），
							// 缓存将维持旧值，导致布局就绪后的下一次修改产生一个包含启动期所有变动的大 delta。
							this.plugin.cacheManager.updateFileCache(file, newWordCount, this.plugin.app.vault);

							// 只有在布局就绪后才记录历史增量，避免启动时的系统性微差导致的统计异常
							if (this.plugin.isLayoutReady) {
								const today = window.moment().format('YYYY-MM-DD');
								this.plugin.historyManager.addWords(today, delta);

								// [BUGFIX] 同时更新本次运行的累计字数，确保非活动文件的修改（如便签、同步）
								// 也能即时反映在状态栏和实时统计视图中。
								this.plugin.sessionAddedWords += delta;

								// 防抖保存设置（历史数据会在独立周期保存）
								this.plugin.adaptiveDebounceManager.debounceFixed('save-settings', () => {
									this.plugin.saveSettings().catch(err => {
										console.error('[Plugin] 保存设置失败:', err);
									});
								}, 1000);
							}
						}
					} catch (error) {
						console.error('[Plugin] 更新每日历史统计失败:', error);
					}
				}

				// 使用防抖（500ms）更新缓存和刷新显示
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.updateFileCacheAndRefresh(file);
				}, 500);
			}
		}));
	}

	private registerDeleteHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				// 只处理符合字数统计条件的文件
				if (!this.plugin.isEligibleForWordCount(file)) return;

				// 使缓存失效
				this.plugin.cacheManager.invalidateCache(file.path, this.plugin.app.vault);

				// 防抖刷新显示
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			}
		}));
	}

	private registerRenameHandler(): void {
		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				// 重命名时，旧文件虽然没了，但新文件如果不符合条件（例如重命名为非章节名），就不该更新它的缓存。
				// 但如果是从章节名改成了非章节名，我们也应该把旧名字从缓存中删掉。
				if (!this.plugin.isFileInWorkspace(file)) return;

				// [BUGFIX] 重命名时，应该将旧路径的字数转移到新路径的缓存中！
				// 否则下次 modify 时，getFileCache 返回 null，会被当成全新的文件（之前是 0）导致字数暴涨！
				const oldCache = this.plugin.cacheManager.getFileCache(oldPath);

				this.plugin.cacheManager.invalidateCache(oldPath, this.plugin.app.vault);

				if (this.plugin.isEligibleForWordCount(file) && oldCache !== null) {
					// 主动设置新路径的缓存，防止被后续操作误判为新文件
					this.plugin.cacheManager.updateFileCache(file, oldCache, this.plugin.app.vault);
				}

				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.updateFileCacheAndRefresh(file);
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