import { App, TFolder, TFile } from 'obsidian';
import { ChapterSorter } from './ChapterSorter';

/**
 * 文件浏览器补丁管理器
 *
 * 使用 Prototype Patch 技术拦截 Obsidian 文件浏览器的排序逻辑。
 * 这种方式比 Instance Patch 更稳定，且能更好地与其他插件（如 manual-sorting）协作。
 */
export class FileExplorerPatcher {
	private app: App;
	private enabled: boolean = false;
	private unpatchFunc: (() => void) | null = null;
	private eventRefs: any[] = [];

	constructor(app: App) {
		this.app = app;
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
				// 调用原始方法（或其他插件的 Patch）
				const sortedItems: any[] = originalMethod.call(this, folder);

				// 如果插件全局禁用或模式未开启，直接返回
				if (!self.enabled) return sortedItems;
				if (!Array.isArray(sortedItems) || sortedItems.length === 0) return sortedItems;

				// 1. 识别受控项目及其位置
				const smartItems: { item: any; chapterInfo: { number: number; ruleIndex: number }; pos: number }[] = [];
				
				for (let i = 0; i < sortedItems.length; i++) {
					const item = sortedItems[i];
					if (item && item.file instanceof TFile) {
						const chapterInfo = ChapterSorter.extractChapterNumber(item.file.name);
						if (chapterInfo !== null) {
							smartItems.push({ item, chapterInfo, pos: i });
						}
					}
				}

				// 只有多于一个受控项目时才需要重新排序
				if (smartItems.length < 2) return sortedItems;

				// 2. 内部排序
				// 策略：规则优先级 > 章节编号 > 原始相对位置（稳定性保证）
				const sortedSmartItems = [...smartItems].sort((a, b) => {
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
			const view = leaf.view as any;
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

	refreshManually(): void {
		if (this.enabled) {
			this.refreshAllExplorers();
		}
	}
}
