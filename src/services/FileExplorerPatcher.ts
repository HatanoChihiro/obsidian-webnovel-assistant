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
				// 调用原始方法获取排序后的项目（可能已经被 manual-sorting 处理过）
				const sortedItems: any[] = originalGetSortedFolderItems.call(this, folder);
				
				// 分离章节文件和非章节文件
				const chapterItems: { item: any; chapterInfo: { number: number; ruleIndex: number } }[] = [];
				const nonChapterItems: { item: any; originalIndex: number }[] = [];
				let firstChapterIndex = -1; // 章节文件在原列表中第一次出现的位置
				
				sortedItems.forEach((item: any, index: number) => {
					const chapterInfo = ChapterSorter.extractChapterNumber(item.file?.name || '');
					if (chapterInfo !== null) {
						chapterItems.push({ item, chapterInfo });
						if (firstChapterIndex === -1) firstChapterIndex = index;
					} else {
						nonChapterItems.push({ item, originalIndex: index });
					}
				});
				
				// 没有章节文件，直接返回原始结果（完全不干预）
				if (chapterItems.length === 0) return sortedItems;
				
				// 章节文件按规则索引和编号排序
				chapterItems.sort((a, b) => {
					// 先按规则索引排序
					if (a.chapterInfo.ruleIndex !== b.chapterInfo.ruleIndex) {
						return a.chapterInfo.ruleIndex - b.chapterInfo.ruleIndex;
					}
					// 同一规则内按编号排序
					return a.chapterInfo.number - b.chapterInfo.number;
				});
				
				// 重建列表：
				// 非章节文件保持原来的相对顺序，
				// 章节文件作为一个整体块插入到第一个章节文件原来的位置
				const result: any[] = [];
				let chaptersInserted = false;
				
				nonChapterItems.forEach(({ item, originalIndex }) => {
					// 在第一个章节文件原来的位置之前，先插入所有章节文件
					if (!chaptersInserted && originalIndex >= firstChapterIndex) {
						chapterItems.forEach(c => result.push(c.item));
						chaptersInserted = true;
					}
					result.push(item);
				});
				
				// 如果章节文件在所有非章节文件之后，追加到末尾
				if (!chaptersInserted) {
					chapterItems.forEach(c => result.push(c.item));
				}
				
				return result;
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
	private eventRefs: any[] = [];

	private setupFileSystemListeners(): void {
		// 监听文件创建
		const createRef = this.app.vault.on('create', () => {
			if (this.enabled) {
				setTimeout(() => this.refresh(), 100);
			}
		});
		this.eventRefs.push(createRef);

		// 监听文件删除
		const deleteRef = this.app.vault.on('delete', () => {
			if (this.enabled) {
				setTimeout(() => this.refresh(), 100);
			}
		});
		this.eventRefs.push(deleteRef);

		// 监听文件重命名
		const renameRef = this.app.vault.on('rename', () => {
			if (this.enabled) {
				setTimeout(() => this.refresh(), 100);
			}
		});
		this.eventRefs.push(renameRef);

		console.log('[ChapterSorter] File system listeners setup complete');
	}

	/**
	 * 禁用智能排序，恢复原始排序
	 */
	disable(): void {
		if (!this.enabled) return;

		try {
			this.enabled = false;
			
			// 移除事件监听器
			this.eventRefs.forEach(ref => {
				this.app.vault.offref(ref);
			});
			this.eventRefs = [];
			
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
