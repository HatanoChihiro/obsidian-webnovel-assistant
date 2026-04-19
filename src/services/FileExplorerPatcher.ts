import { App, TAbstractFile, TFolder } from 'obsidian';
import { ChapterSorter } from './ChapterSorter';

/**
 * 文件浏览器补丁管理器
 * 
 * 使用 Monkey Patch 技术拦截 Obsidian 文件浏览器的排序逻辑，
 * 应用智能章节排序
 * 
 * 实现参考：https://github.com/kh4f/manual-sorting
 */
export class FileExplorerPatcher {
	private app: App;
	private enabled: boolean = false;
	private explorerView: any = null;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 启用智能排序
	 */
	enable(): boolean {
		if (this.enabled) return true;

		try {
			const success = this.patchFileExplorer();
			if (success) {
				this.enabled = true;
				console.log('[ChapterSorter] Smart chapter sorting enabled');
				
				// 延迟初始排序，确保 DOM 已经准备好
				setTimeout(() => this.refresh(), 1000);
				
				// 监听文件系统事件
				this.setupFileSystemListeners();
				
				return true;
			}

			console.error('[ChapterSorter] Failed to patch file explorer');
			return false;
		} catch (error) {
			console.error('[ChapterSorter] Failed to enable smart sorting:', error);
			return false;
		}
	}

	/**
	 * Patch 文件浏览器的 getSortedFolderItems 方法
	 * 
	 * 参考 manual-sorting 插件的实现：
	 * https://github.com/kh4f/manual-sorting/blob/main/src/managers/patcher.ts
	 */
	private patchFileExplorer(): boolean {
		try {
			// 获取文件浏览器视图
			const fileExplorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			if (!fileExplorerLeaf) {
				console.warn('[ChapterSorter] File Explorer leaf not found');
				return false;
			}

			// @ts-ignore
			this.explorerView = fileExplorerLeaf.view;
			if (!this.explorerView) {
				console.warn('[ChapterSorter] File Explorer view not found');
				return false;
			}

			// 保存原始的 getSortedFolderItems 方法
			// @ts-ignore
			const originalGetSortedFolderItems = this.explorerView.getSortedFolderItems;
			
			if (!originalGetSortedFolderItems) {
				console.warn('[ChapterSorter] getSortedFolderItems method not found');
				return false;
			}
			
			// Patch getSortedFolderItems 方法 - 这是关键！
			// 这个方法在 Obsidian 渲染文件列表时被调用
			// @ts-ignore
			this.explorerView.getSortedFolderItems = function(folder: TFolder) {
				// 调用原始方法获取排序后的项目
				const sortedItems = originalGetSortedFolderItems.call(this, folder);
				
				// 使用我们的智能排序重新排序
				return sortedItems.sort((a: any, b: any) => {
					return ChapterSorter.compareFiles(a.file, b.file);
				});
			};
			
			console.log('[ChapterSorter] Successfully patched getSortedFolderItems');
			return true;
		} catch (error) {
			console.error('[ChapterSorter] Failed to patch file explorer:', error);
			return false;
		}
	}

	/**
	 * 触发文件浏览器刷新
	 * 
	 * 调用 explorerView.sort() 会触发 Obsidian 重新渲染文件列表，
	 * 此时会调用我们 patch 的 getSortedFolderItems 方法
	 */
	private refresh(): void {
		try {
			if (!this.explorerView) return;
			
			// @ts-ignore
			if (this.explorerView.sort) {
				// @ts-ignore
				this.explorerView.sort();
				console.log('[ChapterSorter] Explorer refreshed');
			} else {
				console.warn('[ChapterSorter] sort() method not found');
			}
		} catch (error) {
			console.error('[ChapterSorter] Failed to refresh explorer:', error);
		}
	}

	/**
	 * 设置文件系统事件监听器
	 */
	private setupFileSystemListeners(): void {
		// 监听文件创建
		this.app.vault.on('create', () => {
			if (this.enabled) {
				setTimeout(() => this.refresh(), 100);
			}
		});

		// 监听文件删除
		this.app.vault.on('delete', () => {
			if (this.enabled) {
				setTimeout(() => this.refresh(), 100);
			}
		});

		// 监听文件重命名
		this.app.vault.on('rename', () => {
			if (this.enabled) {
				setTimeout(() => this.refresh(), 100);
			}
		});

		console.log('[ChapterSorter] File system listeners setup complete');
	}

	/**
	 * 禁用智能排序，恢复原始排序
	 */
	disable(): void {
		if (!this.enabled) return;

		try {
			this.enabled = false;
			console.log('[ChapterSorter] Smart chapter sorting disabled');
			
			// 注意：这里没有恢复原始方法，因为我们没有保存它
			// 如果需要完全恢复，需要在 patch 时保存原始方法
			// 但通常禁用插件后会重新加载 Obsidian，所以不是问题
		} catch (error) {
			console.error('[ChapterSorter] Failed to disable smart sorting:', error);
		}
	}

	/**
	 * 检查是否已启用
	 */
	isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * 手动触发排序刷新
	 */
	refreshManually(): void {
		if (this.enabled) {
			this.refresh();
		}
	}
}
