import { Logger } from '../utils/Logger';
import type { App, EventRef} from 'obsidian';
import { TFolder, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from './ChapterSorter';
import { rafThrottle } from '../utils/dom';
import type { FileExplorerItem, FileExplorerView } from 'obsidian';
import { getFileExplorerInternals } from './ObsidianInternals';
// @ts-expect-error: monkey-around is ESM but esbuild bundles it fine
import { around } from 'monkey-around';

interface SortEntity {
	isBlock: boolean;
	path: string;
	item?: FileExplorerItem;
	items?: FileExplorerItem[];
	isFolder?: boolean;
}

export class FileExplorerPatcher {
	private app: App;
	private plugin: WebNovelAssistantPlugin;
	private enabled: boolean = false;
	private destroyed: boolean = false;
	private unpatchFuncs: (() => void)[] = [];
	private patchedPrototypes = new WeakSet<object>();
	private vaultEventRefs: EventRef[] = [];
	private workspaceEventRefs: EventRef[] = [];
	private wordCountElCache = new WeakMap<HTMLElement, HTMLElement>();
	private isApplyingSort = false;

	private _dragSourcePath: string | null = null;
	private _currentDropTarget: HTMLElement | null = null;
	private _currentDropPosition: 'top' | 'bottom' | null = null;
	private _dragContainerEl: HTMLElement | null = null;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	private enableRetries = 0;
	private retryTimer: number | null = null;
	private fileRefreshTimer: number | null = null;

	private scheduleSortOrderSave(): void {
		this.plugin.adaptiveDebounceManager.debounceFixed('file-explorer-sort-order-save', () => {
			void this.plugin.saveSettings().catch(error => {
				Logger.error('[FileExplorerPatcher] 保存文件浏览器排序设置失败:', error);
			});
		}, 100);
	}


	enable(): boolean {
		if (this.destroyed) return false;
		if (this.enabled) return true;

		ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);

		try {
			const success = this.patchFileExplorerPrototypes();
			if (success) {
				this.enabled = true;
				this.enableRetries = 0;
				this.refreshAllExplorers();
				this.setupFileSystemListeners();
				this.initDragSort();
				return true;
			}

			if (this.enableRetries < 10) {
				this.enableRetries++;
				this.retryTimer = window.setTimeout(() => this.enable(), 500 * this.enableRetries);
			}
			return false;
		} catch (error) {
			Logger.error('[WebNovel Assistant] Failed to enable smart sorting:', error);
			return false;
		}
	}

	private patchFileExplorerPrototypes(): boolean {
		try {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer');
			if (leaves.length === 0) return this.unpatchFuncs.length > 0;

			for (const leaf of leaves) {
				const view = leaf.view as FileExplorerView;
				if (!view) continue;

				const proto = Object.getPrototypeOf(view) as FileExplorerView;
				if (!proto || !proto.getSortedFolderItems) continue;

				if (this.patchedPrototypes.has(proto)) continue;

				const isPatcherEnabled = () => this.enabled;
				const getPlugin = () => this.plugin;
				const applyPin = (items: FileExplorerItem[]) => this.applyHomepagePin(items);
				const doSort = (entities: SortEntity[]) => this.sortEntities(entities);

				// [BUGFIX] 使用 monkey-around 库替代暴力的 prototype 覆写，保障与第三方插件（如智能文件夹类插件）的兼容性
				const unpatchFunc = around(proto, {
					getSortedFolderItems: (next: (folder: TFolder, bypass?: boolean) => FileExplorerItem[]) => {
						return function (this: FileExplorerView, folder: TFolder, bypass?: boolean) {
							try {
								const sortedItems: FileExplorerItem[] = next.call(this, folder, bypass);

								if (!isPatcherEnabled() || bypass || !Array.isArray(sortedItems) || sortedItems.length === 0) {
									return sortedItems;
								}

								const plugin = getPlugin();

								if (!plugin.settings.enableSmartChapterSort) {
									return applyPin(sortedItems);
								}

								const chapterItems: { item: FileExplorerItem; chapterInfo: { number: number; ruleIndex: number }; isFolder: boolean }[] = [];
								const entities: SortEntity[] = [];

								for (let i = 0; i < sortedItems.length; i++) {
									const item = sortedItems[i];
									if (item && item.file) {
										const isInWorkspace = item.file instanceof TFile
											? plugin.cacheManager.isFileInWorkspace(item.file)
											: true;
										if (isInWorkspace) {
											const chapterInfo = ChapterSorter.extractChapterNumber(item.file.name);
											if (chapterInfo !== null || (item.file instanceof TFile && plugin.cacheManager.isEligibleForWordCount(item.file))) {
												const cInfo = chapterInfo || { number: -1, ruleIndex: 999, numStr: '', isChinese: false, isDecimal: false, rulePattern: '' };
												chapterItems.push({ item, chapterInfo: cInfo, isFolder: item.file instanceof TFolder });
											} else {
												entities.push({ isBlock: false, path: item.file.path, item: item, isFolder: item.file instanceof TFolder });
											}
										} else {
											entities.push({ isBlock: false, path: item.file.path, item: item, isFolder: item.file instanceof TFolder });
										}
									}
								}

								if (chapterItems.length > 0) {
									chapterItems.sort((a, b) => {
										if (a.chapterInfo.ruleIndex !== b.chapterInfo.ruleIndex) {
											return a.chapterInfo.ruleIndex - b.chapterInfo.ruleIndex;
										}

										// 如果是严格模式下的例外文件（ruleIndex === 999），允许使用 customSortOrder 进行排序
										if (a.chapterInfo.ruleIndex === 999 && b.chapterInfo.ruleIndex === 999) {
											const customOrder = plugin.settings.customSortOrder || {};
											const orderA = customOrder[a.item.file.path];
											const orderB = customOrder[b.item.file.path];
											if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
											if (orderA !== undefined) return -1;
											if (orderB !== undefined) return 1;
										}

										if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
										if (a.chapterInfo.number !== b.chapterInfo.number) {
											return a.chapterInfo.number - b.chapterInfo.number;
										}
										return 0;
									});

									const blockKey = folder.path === '/' ? '/__CHAPTER_BLOCK__' : `${folder.path}/__CHAPTER_BLOCK__`;
									entities.push({ isBlock: true, path: blockKey, items: chapterItems.map(c => c.item) });
								}

								const sortedEntities = doSort(entities);

								const finalResult: FileExplorerItem[] = [];
								for (const entity of sortedEntities) {
									if (entity.isBlock && entity.items) {
										finalResult.push(...entity.items);
									} else if (entity.item) {
										finalResult.push(entity.item);
									}
								}

								// [BUGFIX] 必须原地修改 sortedItems 并返回原数组引用！
								// Obsidian 的底层 DOM Diff 算法极其依赖数组引用判定。如果返回一个全新的数组实例，
								// 会导致整个文件夹的 DOM 树被完全销毁重建，从而摧毁新建文件夹时正在等待输入的原生 <input> 元素。
								sortedItems.length = 0;
								sortedItems.push(...finalResult);

								return applyPin(sortedItems);
							} catch (e) {
								Logger.error('[WebNovel Assistant] getSortedFolderItems error:', e);
								return next.call(this, folder, bypass);
							}
						};
					}
				});

				this.unpatchFuncs.push(unpatchFunc);
				this.patchedPrototypes.add(proto);
			}

			return this.unpatchFuncs.length > 0;
		} catch (error) {
			Logger.error('[WebNovel Assistant] Error patching prototypes:', error);
			return false;
		}
	}

	private sortEntities(entities: SortEntity[]): SortEntity[] {
		const customOrder = this.plugin.settings.customSortOrder || {};

		return entities.sort((a, b) => {
			const orderA = customOrder[a.path];
			const orderB = customOrder[b.path];

			if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
			if (orderA !== undefined) return -1;
			if (orderB !== undefined) return 1;

			const defaultA = a.isBlock ? 0 : (a.isFolder ? -1 : 1);
			const defaultB = b.isBlock ? 0 : (b.isFolder ? -1 : 1);

			if (defaultA !== defaultB) return defaultA - defaultB;

			if (!a.isBlock && !b.isBlock && a.item && b.item) {
				return a.item.file.name.localeCompare(b.item.file.name, undefined, { numeric: true });
			}
			return 0;
		});
	}

	private applyHomepagePin(sortedItems: FileExplorerItem[]): FileExplorerItem[] {
		const pinPos = this.plugin.settings.homepagePinPosition;
		if (pinPos && pinPos !== 'none' && this.plugin.homepageManager && Array.isArray(sortedItems)) {
			const hpPath = this.plugin.homepageManager.getHomepageFilePath();
			const hpIndex = sortedItems.findIndex(item => item && item.file && item.file.path === hpPath);
			if (hpIndex !== -1) {
				const hpItem = sortedItems[hpIndex];
				sortedItems.splice(hpIndex, 1);
				if (pinPos === 'top') {
					sortedItems.unshift(hpItem);
				} else if (pinPos === 'bottom') {
					sortedItems.push(hpItem);
				}
			}
		}
		return sortedItems;
	}

	public refreshAllExplorers(): void {
		if (this.destroyed) return;
		// [BUGFIX] 如果文件浏览器中有正在重命名的输入框，绝对不要强行触发 sort()，否则会瞬间摧毁原生的新建重命名输入框！
		const isInputFocused = activeDocument.activeElement && activeDocument.activeElement.tagName.toLowerCase() === 'input';
		if (isInputFocused) {
			return;
		}

		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		leaves.forEach(leaf => {
			const view = leaf.view;
			if (view && typeof view.sort === 'function') {
				try { view.sort(); } catch { /* intentionally ignored */ }
			}
		});
		this.applyDOMSort();
	}

	private applyDOMSort(): void {
		if (!this.enabled || this.isApplyingSort) return;
		this.isApplyingSort = true;
		try {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer');
			for (const leaf of leaves) {
				const view = leaf.view as FileExplorerView;
				if (!view || !view.fileItems) continue;

				const foldersToCheck = new Set<string>();
				for (const path in view.fileItems) {
					const item = view.fileItems[path];
					if (item && item.file && item.file.parent) {
						foldersToCheck.add(item.file.parent.path);
					}
				}

				foldersToCheck.add('/');

				for (const folderPath of foldersToCheck) {
					let contentEl: HTMLElement | null = null;
					let folderFile: TFolder | null = null;

					if (folderPath === '/') {
						contentEl = view.containerEl.querySelector('.nav-folder-children');
						folderFile = this.app.vault.getRoot();
					} else {
						const folderItem = view.fileItems[folderPath];
						if (!folderItem || !folderItem.el) continue;
						contentEl = folderItem.el.querySelector('.nav-folder-children');
						if (folderItem.file instanceof TFolder) {
							folderFile = folderItem.file;
						}
					}

					if (!contentEl || !folderFile) continue;

					let logicItems: FileExplorerItem[] = [];
					if (view.getSortedFolderItems) {
						logicItems = view.getSortedFolderItems(folderFile);
					}

					if (logicItems.length > 0) {
						const currentChildren = Array.from(contentEl.children) as HTMLElement[];
						let needReorder = false;
						const targetOrderEls: HTMLElement[] = [];

						for (const item of logicItems) {
							if (item && item.el && item.el.parentElement === contentEl) {
								targetOrderEls.push(item.el);
							}
						}

						for (let i = 0; i < targetOrderEls.length; i++) {
							if (currentChildren[i] !== targetOrderEls[i]) {
								needReorder = true;
								break;
							}
						}

						if (needReorder) {
							for (const el of targetOrderEls) {
								contentEl.appendChild(el);
							}
						}
					}
				}
			}
		} finally {
			this.isApplyingSort = false;
		}
	}

	private setupFileSystemListeners(): void {
		// [BUGFIX] 绝对不要在 create 事件中调用 refreshAllExplorers()，否则会打断原生的新建文件夹重命名流程！
		// 因此去掉了 create 事件和 metadataCache changed 事件的无用监听。
		this.vaultEventRefs.push(this.app.vault.on('delete', (file) => {
			if (!this.enabled) return;
			if (file && file.path && this.plugin.settings.customSortOrder) {
				let changed = false;
				const deletedPath = file.path;

				if (this.plugin.settings.customSortOrder[deletedPath] !== undefined) {
					delete this.plugin.settings.customSortOrder[deletedPath];
					changed = true;
				}

				if (file instanceof TFolder) {
					const oldPrefix = `${deletedPath}/`;
					for (const key in this.plugin.settings.customSortOrder) {
						if (key.startsWith(oldPrefix)) {
							delete this.plugin.settings.customSortOrder[key];
							changed = true;
						}
					}
				}

				if (changed) {
					this.scheduleSortOrderSave();
				}
			}
			if (this.fileRefreshTimer !== null) {
				window.clearTimeout(this.fileRefreshTimer);
			}
			this.fileRefreshTimer = window.setTimeout(() => {
				this.fileRefreshTimer = null;
				this.refreshAllExplorers();
			}, 100);
		}));
		this.vaultEventRefs.push(this.app.vault.on('rename', (file, oldPath) => {
			if (!this.enabled) return;
			if (this.plugin.settings.customSortOrder && oldPath) {
				let changed = false;

				const orderValue = this.plugin.settings.customSortOrder[oldPath];
				if (orderValue !== undefined) {
					delete this.plugin.settings.customSortOrder[oldPath];
					this.plugin.settings.customSortOrder[file.path] = orderValue;
					changed = true;
				}

				if (file instanceof TFolder) {
					const oldPrefix = `${oldPath}/`;
					const newPrefix = `${file.path}/`;
					const keys = Object.keys(this.plugin.settings.customSortOrder);
					for (const key of keys) {
						if (key.startsWith(oldPrefix)) {
							const val = this.plugin.settings.customSortOrder[key];
							delete this.plugin.settings.customSortOrder[key];
							const newKey = newPrefix + key.substring(oldPrefix.length);
							this.plugin.settings.customSortOrder[newKey] = val;
							changed = true;
						}
					}
				}

				if (changed) {
					this.scheduleSortOrderSave();
				}
			}
			if (this.fileRefreshTimer !== null) {
				window.clearTimeout(this.fileRefreshTimer);
			}
			this.fileRefreshTimer = window.setTimeout(() => {
				this.fileRefreshTimer = null;
				this.refreshAllExplorers();
			}, 100);
		}));

		// 监听布局变化，确保在文件浏览器重新加载时重置拖拽事件和修补可能的新原型
		this.workspaceEventRefs.push(this.app.workspace.on('layout-change', () => {
			if (!this.enabled) return;

			// 修补可能新出现的不同原型（例如移动端重新创建的视图，或新的多窗口）
			this.patchFileExplorerPrototypes();

			const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			if (leaf) {
				const containerEl = (leaf.view as FileExplorerView)?.containerEl as HTMLElement | undefined;
				// 如果容器发生了变化（例如重建了面板），则重新初始化事件并刷新排序
				if (containerEl && containerEl !== this._dragContainerEl) {
					this.teardownDragSort();
					this.initDragSort();
					this.refreshAllExplorers();
				}
			}
		}));
	}

	private removeWordCountElements(): void {
		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		for (const leaf of leaves) {
			const containerEl = (leaf.view as FileExplorerView)?.containerEl;
			if (containerEl) {
				Array.from(containerEl.getElementsByClassName('wn-folder-word-count')).forEach(el => el.remove());
			}
		}
		if (typeof activeDocument !== 'undefined' && activeDocument.getElementsByClassName) {
			Array.from(activeDocument.getElementsByClassName('wn-folder-word-count')).forEach(el => el.remove());
		}
		this.wordCountElCache = new WeakMap<HTMLElement, HTMLElement>();
	}

	disable(): void {
		if (this.retryTimer !== null) {
			window.clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		if (this.fileRefreshTimer !== null) {
			window.clearTimeout(this.fileRefreshTimer);
			this.fileRefreshTimer = null;
		}

		this.enabled = false;
		this.vaultEventRefs.forEach(ref => this.app.vault.offref(ref));
		this.vaultEventRefs = [];
		this.workspaceEventRefs.forEach(ref => this.app.workspace.offref(ref));
		this.workspaceEventRefs = [];
		this.teardownDragSort();
		this.refreshAllExplorers();
		this.removeWordCountElements();
	}

	unpatch(): void {
		this.teardownDragSort();
		for (const unpatch of this.unpatchFuncs) {
			unpatch();
		}
		this.unpatchFuncs = [];
		this.patchedPrototypes = new WeakSet<object>();
		this.removeWordCountElements();
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	refreshFolderCounts() {
		try {
			if (this.destroyed || this.plugin.isUnloading) {
				this.removeWordCountElements();
				return;
			}

			const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
			if (!fileExplorer || !fileExplorer.view) return;

			const view = fileExplorer.view;
			if (!view.fileItems || typeof view.fileItems !== "object") return;
			const fileExplorerItems = view.fileItems;

			if (!this.plugin.settings.showExplorerCounts) {
				for (const path in fileExplorerItems) {
					const item = fileExplorerItems[path];
					if (item.el) {
						const countEl = this.wordCountElCache.get(item.el) || item.el.querySelector('.wn-folder-word-count');
						if (countEl) {
							countEl.remove();
							this.wordCountElCache.delete(item.el);
						}
					}
				}
				return;
			}
			for (const path in fileExplorerItems) {
				const item = fileExplorerItems[path];
				if (!item.el) continue;

				// 性能优化：直接查询 CacheManager 缓存，绕过昂贵的正则合格性检查
				let count: number | null = null;
				if (item.file instanceof TFolder || (item.file instanceof TFile && item.file.extension === 'md')) {
					count = this.plugin.cacheManager.getFolderWordCount(path);
				}

				const labelText = (count !== null && count > 0) ? ` (${count.toLocaleString()})` : "";
				let countEl = this.wordCountElCache.get(item.el) as HTMLElement | undefined | null;

				if (!countEl) {
					countEl = item.el.querySelector<HTMLElement>('.wn-folder-word-count');
					if (!countEl) {
						if (!labelText) continue;

						const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
						const mountEl = titleContent?.parentElement;
						if (mountEl) {
							countEl = mountEl.createSpan({ cls: 'wn-folder-word-count' });
							countEl.addClass('webnovel-wn-folder-word-count-detail');
						}
					}
					if (countEl) {
						this.wordCountElCache.set(item.el, countEl);
					}
				}

				if (countEl && countEl.textContent !== labelText) {
					countEl.textContent = labelText;
				}
			}
		} catch (error) {
			Logger.error('[WebNovel Assistant] refreshFolderCounts failed:', error);
		}
	}

	refreshManually(): void {
		if (this.enabled) {
			this.refreshAllExplorers();
		}
	}

	// ========== 拖拽排序 ==========

	private _dragStartHandler = this._onDragStart.bind(this);
	private _dragHandler = rafThrottle(this._onDrag.bind(this));
	private _dropHandler = this._onDrop.bind(this);
	private _dragEndHandler = this._onDragEnd.bind(this);

	private initDragSort(): void {
		if (!this.plugin.settings.enableSmartChapterSort) return;

		const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
		if (!leaf) return;
		const containerEl = (leaf.view as FileExplorerView)?.containerEl as HTMLElement | undefined;
		if (!containerEl) return;

		this._dragContainerEl = containerEl;

		containerEl.addEventListener('dragstart', this._dragStartHandler, true);
		containerEl.addEventListener('drag', this._dragHandler, true);
		containerEl.addEventListener('drop', this._dropHandler, true);
		containerEl.addEventListener('dragend', this._dragEndHandler, true);
	}

	private teardownDragSort(): void {
		if (this._dragContainerEl) {
			this._dragContainerEl.removeEventListener('dragstart', this._dragStartHandler, true);
			this._dragContainerEl.removeEventListener('drag', this._dragHandler, true);
			this._dragContainerEl.removeEventListener('drop', this._dropHandler, true);
			this._dragContainerEl.removeEventListener('dragend', this._dragEndHandler, true);
			this._dragContainerEl = null;
		}
		if (this._dragHandler) {
			this._dragHandler.cancel();
		}
		this._removeDropIndicator();
		this._dragSourcePath = null;
		activeDocument.body.classList.remove('webnovel-custom-dragging');
		this._removeNativeDropHighlight();
	}

	private _getPathFromItemEl(itemEl: HTMLElement): string | null {
		let path = itemEl.getAttribute('data-path');
		if (!path) {
			const titleEl = itemEl.querySelector('.nav-file-title, .nav-folder-title');
			if (titleEl) path = titleEl.getAttribute('data-path');
		}
		return path;
	}

	private _getFolderPathFromItemEl(itemEl: HTMLElement): string {
		const parentChildrenEl = itemEl.closest('.nav-folder-children');
		if (!parentChildrenEl) return '/';
		const folderEl = parentChildrenEl.parentElement;
		if (!folderEl) return '/';
		const titleEl = folderEl.querySelector('.nav-folder-title');
		if (titleEl) {
			return titleEl.getAttribute('data-path') || '/';
		}
		return '/';
	}

	private _onDragStart(e: DragEvent): void {
		if (!this.enabled || !this.plugin.settings.enableSmartChapterSort) return;

		const target = e.target as HTMLElement;
		const titleEl = target.closest('.nav-file-title, .nav-folder-title') as HTMLElement;
		if (!titleEl) return;

		const itemEl = titleEl.closest('.nav-file, .nav-folder') as HTMLElement;
		if (!itemEl) return;

		const filePath = this._getPathFromItemEl(itemEl);
		if (!filePath) return;

		const fileName = this.getFileNameFromEl(itemEl, null);
		let isChapter = false;
		if (fileName) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile && this.plugin.cacheManager.isFileInWorkspace(file) && ChapterSorter.extractChapterNumber(fileName) !== null) {
				isChapter = true;
			}
		}

		if (isChapter) {
			const folderPath = this._getFolderPathFromItemEl(itemEl);
			this._dragSourcePath = folderPath === '/' ? '/__CHAPTER_BLOCK__' : `${folderPath}/__CHAPTER_BLOCK__`;

			if (itemEl.parentElement) {
				const children = Array.from(itemEl.parentElement.children) as HTMLElement[];
				for (const child of children) {
					const childName = this.getFileNameFromEl(child, null);
					if (childName && ChapterSorter.extractChapterNumber(childName) !== null) {
						child.classList.add('webnovel-dragging');
					}
				}
			}
		} else {
			this._dragSourcePath = filePath;
			itemEl.classList.add('webnovel-dragging');
		}

		activeDocument.body.classList.add('webnovel-custom-dragging');
	}

	private _removeNativeDropHighlight(): void {
		if (this._dragContainerEl) {
			const natives = this._dragContainerEl.querySelectorAll('.webnovel-native-drop');
			for (let i = 0; i < natives.length; i++) {
				natives[i].classList.remove('webnovel-native-drop');
			}
		}
	}

	private _addNativeDropHighlight(targetEl: HTMLElement): void {
		this._removeNativeDropHighlight();
		targetEl.classList.add('webnovel-native-drop');
	}

	private _onDrag(e: DragEvent): void {
		if (!this.enabled || !this._dragSourcePath) return;

		// 利用 RAF 节流时记录的 clientX / clientY
		const pointerX = e.clientX;
		const pointerY = e.clientY;

		// 找到光标正下方的 DOM 元素
		const target = activeDocument.elementFromPoint(pointerX, pointerY) as HTMLElement;
		if (!target) {
			this._removeDropIndicator();
			this._removeNativeDropHighlight();
			return;
		}

		const targetItem = target.closest('.nav-file, .nav-folder') as HTMLElement;
		if (!targetItem) {
			this._removeDropIndicator();
			this._removeNativeDropHighlight();
			return;
		}

		const targetFileName = this.getFileNameFromEl(targetItem, null);
		let targetPath = this._getPathFromItemEl(targetItem);
		let isChapterTarget = false;

		if (targetPath && targetFileName) {
			const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (targetFile instanceof TFile && this.plugin.cacheManager.isFileInWorkspace(targetFile) && ChapterSorter.extractChapterNumber(targetFileName) !== null) {
				isChapterTarget = true;
			}
		}

		let blockKey = '';

		if (isChapterTarget) {
			const folderPath = this._getFolderPathFromItemEl(targetItem);
			blockKey = folderPath === '/' ? '/__CHAPTER_BLOCK__' : `${folderPath}/__CHAPTER_BLOCK__`;
			targetPath = blockKey;
		}

		if (!targetPath || targetPath === this._dragSourcePath) {
			this._removeDropIndicator();
			this._removeNativeDropHighlight();
			return;
		}

		let sourceFolderPath = '';
		if (this._dragSourcePath.endsWith('/__CHAPTER_BLOCK__')) {
			sourceFolderPath = this._dragSourcePath.slice(0, -18);
			if (sourceFolderPath === '') sourceFolderPath = '/';
		} else {
			const sourceFile = this.app.vault.getAbstractFileByPath(this._dragSourcePath);
			if (sourceFile && sourceFile.parent) sourceFolderPath = sourceFile.parent.path;
		}

		let targetFolderPath = '';
		const targetIsFolder = targetItem.classList.contains('nav-folder');

		if (isChapterTarget) {
			targetFolderPath = this._getFolderPathFromItemEl(targetItem);
		} else {
			const destFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (destFile && destFile.parent) targetFolderPath = destFile.parent.path;
		}

		if (!sourceFolderPath || !targetFolderPath || sourceFolderPath !== targetFolderPath) {
			this._removeDropIndicator();
			this._removeNativeDropHighlight();
			return;
		}

		let indicatorTargetEl = targetItem;
		let insertBefore = false;

		if (isChapterTarget) {
			let firstChapter = targetItem;
			while (firstChapter.previousElementSibling) {
				const prev = firstChapter.previousElementSibling as HTMLElement;
				const prevName = this.getFileNameFromEl(prev, null);
				if (prevName && ChapterSorter.extractChapterNumber(prevName) !== null) {
					firstChapter = prev;
				} else {
					break;
				}
			}

			let lastChapter = targetItem;
			while (lastChapter.nextElementSibling) {
				const next = lastChapter.nextElementSibling as HTMLElement;
				const nextName = this.getFileNameFromEl(next, null);
				if (nextName && ChapterSorter.extractChapterNumber(nextName) !== null) {
					lastChapter = next;
				} else {
					break;
				}
			}

			const firstRect = firstChapter.getBoundingClientRect();
			const lastRect = lastChapter.getBoundingClientRect();
			const midY = (firstRect.top + lastRect.bottom) / 2;

			if (pointerY < midY) {
				insertBefore = true;
				indicatorTargetEl = firstChapter;
			} else {
				insertBefore = false;
				indicatorTargetEl = lastChapter;
			}
			this._removeNativeDropHighlight();
		} else {
			const rect = targetItem.getBoundingClientRect();
			const y = pointerY - rect.top;

			if (targetIsFolder) {
				if (y < rect.height * 0.25) {
					insertBefore = true;
					this._removeNativeDropHighlight();
				} else if (y > rect.height * 0.75) {
					insertBefore = false;
					this._removeNativeDropHighlight();
				} else {
					this._removeDropIndicator();
					this._addNativeDropHighlight(targetItem);
					// allow native drop
					e.preventDefault();
					return;
				}
			} else {
				const midY = rect.height / 2;
				insertBefore = y < midY;
				this._removeNativeDropHighlight();
			}
		}

		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

		this._showDropIndicator(indicatorTargetEl, insertBefore);
	}

	private _onDrop(e: DragEvent): void {
		if (!this.enabled || !this._dragSourcePath) return;

		if (this._currentDropTarget) {
			e.preventDefault();
			e.stopPropagation();

			this._handleDrop();
			this._removeDropIndicator();
			this._cleanupDragState();
		}
	}

	private _onDragEnd(_e: DragEvent): void {
		this._removeDropIndicator();
		this._cleanupDragState();
	}

	private _cleanupDragState(): void {
		if (this._dragContainerEl) {
			const dragging = this._dragContainerEl.querySelectorAll('.webnovel-dragging');
			for (let i = 0; i < dragging.length; i++) {
				dragging[i].classList.remove('webnovel-dragging');
			}
		}
		this._dragSourcePath = null;
		activeDocument.body.classList.remove('webnovel-custom-dragging');
		this._removeNativeDropHighlight();
	}

	private _showDropIndicator(targetEl: HTMLElement, insertBefore: boolean): void {
		const pos = insertBefore ? 'top' : 'bottom';
		if (this._currentDropTarget === targetEl && this._currentDropPosition === pos) {
			return;
		}

		this._removeDropIndicator();
		this._currentDropTarget = targetEl;
		this._currentDropPosition = pos;

		targetEl.classList.add(`webnovel-drag-over-${pos}`);
	}

	private _removeDropIndicator(): void {
		if (this._currentDropTarget) {
			this._currentDropTarget.classList.remove('webnovel-drag-over-top');
			this._currentDropTarget.classList.remove('webnovel-drag-over-bottom');
			this._currentDropTarget = null;
			this._currentDropPosition = null;
		}
	}

	private _handleDrop(): void {
		const sourcePath = this._dragSourcePath!;
		const targetEl = this._currentDropTarget;
		const pos = this._currentDropPosition;
		if (!targetEl || !pos) return;

		const folderPath = this._getFolderPathFromItemEl(targetEl);
		const blockKey = folderPath === '/' ? '/__CHAPTER_BLOCK__' : `${folderPath}/__CHAPTER_BLOCK__`;

		let prevSibling: HTMLElement | null = null;
		let nextSibling: HTMLElement | null = null;

		if (pos === 'top') {
			nextSibling = targetEl;
			prevSibling = targetEl.previousElementSibling as HTMLElement;
		} else {
			prevSibling = targetEl;
			nextSibling = targetEl.nextElementSibling as HTMLElement;
		}

		const getEntityPath = (el: HTMLElement): string | null => {
			const name = this.getFileNameFromEl(el, null);
			if (name && ChapterSorter.extractChapterNumber(name) !== null) {
				return blockKey;
			}
			return this._getPathFromItemEl(el);
		};

		while (prevSibling && (prevSibling.classList.contains('webnovel-dragging') || (!prevSibling.classList.contains('nav-file') && !prevSibling.classList.contains('nav-folder')))) {
			prevSibling = prevSibling.previousElementSibling as HTMLElement;
		}

		while (nextSibling && (nextSibling.classList.contains('webnovel-dragging') || (!nextSibling.classList.contains('nav-file') && !nextSibling.classList.contains('nav-folder')))) {
			nextSibling = nextSibling.nextElementSibling as HTMLElement;
		}

		const prevPath = prevSibling ? getEntityPath(prevSibling) : null;
		const nextPath = nextSibling ? getEntityPath(nextSibling) : null;

		const abstractFile = folderPath === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(folderPath);
		if (!(abstractFile instanceof TFolder)) return;
		const targetFolder = abstractFile;

		const nonChapterPaths: string[] = [];
		let hasChapters = false;

		for (const child of targetFolder.children) {
			if (ChapterSorter.extractChapterNumber(child.name) === null) {
				nonChapterPaths.push(child.path);
			} else {
				hasChapters = true;
			}
		}

		const entities: string[] = [...nonChapterPaths];
		if (hasChapters) entities.push(blockKey);

		const customOrder = this.plugin.settings.customSortOrder || {};

		entities.sort((a, b) => {
			const orderA = customOrder[a];
			const orderB = customOrder[b];
			if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
			if (orderA !== undefined) return -1;
			if (orderB !== undefined) return 1;

			const isBlockA = a === blockKey;
			const isBlockB = b === blockKey;

			const defaultA = isBlockA ? 0 : (this.app.vault.getAbstractFileByPath(a) instanceof TFolder ? -1 : 1);
			const defaultB = isBlockB ? 0 : (this.app.vault.getAbstractFileByPath(b) instanceof TFolder ? -1 : 1);
			if (defaultA !== defaultB) return defaultA - defaultB;

			if (!isBlockA && !isBlockB) {
				const fileA = this.app.vault.getAbstractFileByPath(a);
				const fileB = this.app.vault.getAbstractFileByPath(b);
				if (fileA && fileB) {
					return fileA.name.localeCompare(fileB.name, undefined, { numeric: true });
				}
			}
			return 0;
		});

		const sourceIndex = entities.indexOf(sourcePath);
		if (sourceIndex !== -1) entities.splice(sourceIndex, 1);

		let insertIndex = entities.length;
		if (nextPath) {
			const nextIdx = entities.indexOf(nextPath);
			if (nextIdx !== -1) insertIndex = nextIdx;
		} else if (prevPath) {
			const prevIdx = entities.indexOf(prevPath);
			if (prevIdx !== -1) insertIndex = prevIdx + 1;
		}

		entities.splice(insertIndex, 0, sourcePath);

		const newOrder = { ...customOrder };
		for (let i = 0; i < entities.length; i++) {
			newOrder[entities[i]] = (i + 1) * 1000;
		}

		this.plugin.settings.customSortOrder = newOrder;
		this.plugin.saveSettings().catch(() => {});
		this.refreshAllExplorers();
	}

	private getFileNameFromEl(el: HTMLElement, view?: FileExplorerView | null): string | null {
		const dataPath = this._getPathFromItemEl(el);
		if (dataPath) {
			const file = this.app.vault.getAbstractFileByPath(dataPath);
			if (file && (file instanceof TFile || file instanceof TFolder)) return file.name;
		}
		const internals = getFileExplorerInternals(view);
		if (internals?.fileItems) {
			for (const path in internals.fileItems) {
				const item = internals.fileItems[path];
				if (item?.el === el && item.file) return item.file.name;
			}
		}
		return null;
	}

	/**
	 * 实现 Destroyable 接口
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.disable();
		this.unpatch();
	}
}
