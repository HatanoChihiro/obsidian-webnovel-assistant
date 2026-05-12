import { App, EventRef, TFolder, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from './ChapterSorter';
import { formatCount } from '../utils';

/**
 * 文件浏览器补丁管理器
 *
 * 使用 Prototype Patch 技术拦截 Obsidian 文件浏览器的排序逻辑。
 * 这种方式比 Instance Patch 更稳定，且能更好地与其他插件（如 manual-sorting）协作。
 */
export class FileExplorerPatcher {
	private app: App;
	private plugin: WebNovelAssistantPlugin;
	private enabled: boolean = false;
	private unpatchFunc: (() => void) | null = null;
	private eventRefs: EventRef[] = [];
	private wordCountElCache = new WeakMap<HTMLElement, HTMLElement>();

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 启用智能排序
	 */
	enable(): boolean {
		if (this.enabled) return true;
		
		try {
			const success = this.patchFileExplorerPrototype();
			if (success) {
				this.enabled = true;
				console.log('[WebNovel Assistant] Smart chapter sorting enabled (Prototype Patch)');
				
				// 立即触发一次刷新
				this.refreshAllExplorers();
				
				// 监听文件系统事件以自动刷新
				this.setupFileSystemListeners();
				return true;
			}
			return false;
		} catch (error) {
			console.error('[WebNovel Assistant] Failed to enable smart sorting:', error);
			return false;
		}
	}

	/**
	 * Patch FileExplorerView 的原型方法
	 */
	private patchFileExplorerPrototype(): boolean {
		try {
			// 1. 获取文件浏览器视图实例以找到原型
			const fileExplorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			if (!fileExplorerLeaf) {
				// 如果当前没有打开文件浏览器，无法获取原型，等待稍后重试
				console.log('[WebNovel Assistant] File Explorer not found, will retry patching when ready');
				return false;
			}

			const view = fileExplorerLeaf.view as any;
			if (!view) return false;

			const proto = Object.getPrototypeOf(view);
			if (!proto || !proto.getSortedFolderItems) {
				console.warn('[WebNovel Assistant] FileExplorerView prototype or method not found');
				return false;
			}

			// 2. 检查是否已经 patch 过
			if (proto.getSortedFolderItems.__webnovel_patched) {
				console.log('[WebNovel Assistant] FileExplorerView already patched');
				return true;
			}

			// 3. 执行 Patch
			const originalMethod = proto.getSortedFolderItems;
			const self = this;

			proto.getSortedFolderItems = function(folder: TFolder) {
					// [H-O1] 防御性 Patch：如果排序逻辑抛出异常，回退到原始方法
					try {
						// 调用原始方法（或其他插件的 Patch）
						const sortedItems: any[] = originalMethod.call(this, folder);

				// 如果插件全局禁用或模式未开启，直接返回
				if (!self.enabled) return sortedItems;
				if (!Array.isArray(sortedItems) || sortedItems.length === 0) return sortedItems;


				// 识别受控项目及其位置（支持文件夹和文件的混合排序）
				const smartItems: { item: any; chapterInfo: { number: number; ruleIndex: number }; isFolder: boolean; pos: number }[] = [];
				
				for (let i = 0; i < sortedItems.length; i++) {
					const item = sortedItems[i];
					if (item && (item.file instanceof TFile || item.file instanceof TFolder)) {
						const chapterInfo = ChapterSorter.extractChapterNumber(item.file.name);
						if (chapterInfo !== null) {
							smartItems.push({ item, chapterInfo, isFolder: item.file instanceof TFolder, pos: i });
						}
					}
				}

				// 只有多于一个受控项目时才需要重新排序
				if (smartItems.length < 2) return sortedItems;

				// 2. 内部排序
				// 策略：规则优先级 > 章节编号 > 原始相对位置（稳定性保证）
				const sortedSmartItems = [...smartItems].sort((a, b) => {
					// 文件夹优先排在文件前
					if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;

					// 规则顺序
					if (a.chapterInfo.ruleIndex !== b.chapterInfo.ruleIndex) {
						return a.chapterInfo.ruleIndex - b.chapterInfo.ruleIndex;
					}
					// 章节编号
					if (a.chapterInfo.number !== b.chapterInfo.number) {
						return a.chapterInfo.number - b.chapterInfo.number;
					}
					// [关键] 稳定性：如果规则和编号一致，保持 originalMethod 返回的顺序
					// 这确保了 manual-sorting 对非章节（或相同编号章节）的手动排序依然有效
					return a.pos - b.pos;
				});

				// 3. 原位填充
				const result = [...sortedItems];
				const originalPositions = smartItems.map(si => si.pos);
				
				originalPositions.forEach((pos, i) => {
					result[pos] = sortedSmartItems[i].item;
				});

				return result;
				} catch (e) {
					console.warn('[WebNovel Assistant] Patch 执行失败，回退到原始排序:', e);
					return originalMethod.call(this, folder);
				}
			};

			// 标记
			proto.getSortedFolderItems.__webnovel_patched = true;
			
			// 保存还原函数
			this.unpatchFunc = () => {
				proto.getSortedFolderItems = originalMethod;
				console.log('[WebNovel Assistant] FileExplorerView unpatched');
			};

			return true;
		} catch (error) {
			console.error('[WebNovel Assistant] Error patching prototype:', error);
			return false;
		}
	}

	/**
	 * 刷新所有文件浏览器视图
	 */
	private refreshAllExplorers(): void {
		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		leaves.forEach(leaf => {
			const view = leaf.view;
			if (view && typeof view.sort === 'function') {
				try {
					view.sort();
				} catch (e) {
					// 忽略刷新错误
				}
			}
		});
	}

	/**
	 * 文件系统事件监听
	 */
	private setupFileSystemListeners(): void {
		const handler = () => {
			if (!this.enabled) return;
			// 稍微延迟确保 Obsidian 内部状态已更新
			setTimeout(() => this.refreshAllExplorers(), 100);
		};

		this.eventRefs.push(this.app.vault.on('create', handler));
		this.eventRefs.push(this.app.vault.on('delete', handler));
		this.eventRefs.push(this.app.vault.on('rename', handler));
	}

	/**
	 * 禁用智能排序
	 */
	disable(): void {
		this.enabled = false;
		
		// 清理事件
		this.eventRefs.forEach(ref => this.app.vault.offref(ref));
		this.eventRefs = [];

		// 注意：通常不建议在运行时还原 Prototype Patch，因为可能有其他插件在你的 patch 之上又加了一层。
		// 这里我们通过 this.enabled 状态位在运行期间静默化逻辑。
		// 只有在真正卸载插件时才考虑物理还原。
		
		this.refreshAllExplorers();
		console.log('[WebNovel Assistant] Smart chapter sorting disabled (logic bypassed)');
	}

	/**
	 * 物理还原补丁（仅在插件 unload 时调用）
	 */
	unpatch(): void {
		if (this.unpatchFunc) {
			this.unpatchFunc();
			this.unpatchFunc = null;
		}
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	refreshFolderCounts() {
		try {
			const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
			if (!fileExplorer || !fileExplorer.view) return;

			const view = fileExplorer.view;
			if (!view.fileItems || typeof view.fileItems !== 'object') return;
			const fileExplorerItems = view.fileItems;

			// 如果功能关闭，清理所有已存在的统计标记并退出
			if (!this.plugin.settings.showExplorerCounts) {
				for (const path in fileExplorerItems) {
					const item = fileExplorerItems[path];
					if (item.el) {
						const countEl = this.wordCountElCache.get(item.el) || item.el.querySelector('.folder-word-count');
						if (countEl) {
							countEl.remove();
							this.wordCountElCache.delete(item.el);
						}
					}
				}
				return;
			}
			// --- 使用缓存获取字数 ---
			let updatedCount = 0;
			for (const path in fileExplorerItems) {
				const item = fileExplorerItems[path];
				// 仅处理 TFolder 和 .md TFile
				if (item.el && (item.file instanceof TFolder || (item.file instanceof TFile && item.file.extension === 'md'))) {

					// 检查是否在工作区内
					let isInWorkspace = true;
					if (item.file instanceof TFile) {
						isInWorkspace = this.plugin.isEligibleForWordCount(item.file);
					} else if (item.file instanceof TFolder) {
						if (this.plugin.settings.workspaceFolders && this.plugin.settings.workspaceFolders.length > 0) {
							const folderPath = item.file.path;
							isInWorkspace = this.plugin.settings.workspaceFolders.some(workspace => {
								const normalizedWorkspace = workspace.replace(/^\/+|\/+$/g, '');
								return folderPath.startsWith(normalizedWorkspace) || normalizedWorkspace.startsWith(folderPath);
							});
						}
					}

					if (!isInWorkspace) continue;

					// 从缓存获取字数
					const count = this.plugin.cacheManager.getFolderCount(path);
					if (count === null) continue;

					const labelText = count > 0 ? ` (${formatCount(count)})` : "";
					let countEl = this.wordCountElCache.get(item.el) as HTMLElement;

					if (!countEl) {
						// 尝试从 DOM 获取（可能是上次遗留的）
						countEl = item.el.querySelector('.folder-word-count') as HTMLElement;
						if (!countEl) {
							const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
							if (titleContent) {
								countEl = titleContent.createEl('span', { cls: 'folder-word-count' });
								countEl.style.fontSize = '0.8em';
								countEl.style.opacity = '0.5';
								countEl.style.marginLeft = '5px';
							}
						}
						// 存入缓存
						if (countEl) {
							this.wordCountElCache.set(item.el, countEl);
						}
					}

					// 仅在文本变化时更新，减少 DOM 抖动
					if (countEl && countEl.textContent !== labelText) {
						countEl.textContent = labelText;
						updatedCount++;
					}
				}
			}

			if (updatedCount > 0) {
				console.debug(`[WebNovel Assistant] refreshFolderCounts: Updated ${updatedCount} items`);
			}
		} catch (error) {
			console.error('[WebNovel Assistant] refreshFolderCounts failed:', error);
		}
	}

	refreshManually(): void {
		if (this.enabled) {
			this.refreshAllExplorers();
		}
	}
}
