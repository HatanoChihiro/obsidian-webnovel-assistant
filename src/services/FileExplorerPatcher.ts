import type { App, EventRef} from 'obsidian';
import { TFolder, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from './ChapterSorter';
import { rafThrottle } from '../utils/dom';
import type { FileExplorerItem, FileExplorerView } from 'obsidian';

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
	private unpatchFunc: (() => void) | null = null;
	private eventRefs: EventRef[] = [];
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

	enable(): boolean {
		if (this.enabled) return true;

		ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);

		try {
			const success = this.patchFileExplorerPrototype();
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
				window.setTimeout(() => this.enable(), 500 * this.enableRetries);
			}
			return false;
		} catch (error) {
			console.error('[WebNovel Assistant] Failed to enable smart sorting:', error);
			return false;
		}
	}

	private patchFileExplorerPrototype(): boolean {
		try {
			const fileExplorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			if (!fileExplorerLeaf) return false;

			const view = fileExplorerLeaf.view as FileExplorerView;
			if (!view) return false;

			const proto = Object.getPrototypeOf(view) as FileExplorerView;
			if (!proto || !proto.getSortedFolderItems) return false;

			if ((proto.getSortedFolderItems as unknown as { __webnovel_patched?: boolean }).__webnovel_patched) return true;

			const originalMethod = proto.getSortedFolderItems;
			proto.getSortedFolderItems = (function(patcher: FileExplorerPatcher) {
				return function(this: FileExplorerView, folder: TFolder, bypass?: boolean) {
					try {
						const sortedItems: FileExplorerItem[] = originalMethod.call(this, folder, bypass);

						if (!patcher.enabled || bypass || !Array.isArray(sortedItems) || sortedItems.length === 0) {
							return sortedItems;
						}

						if (!patcher.plugin.settings.enableSmartChapterSort) {
							return patcher.applyHomepagePin(sortedItems);
						}

					const chapterItems: { item: FileExplorerItem; chapterInfo: { number: number; ruleIndex: number }; isFolder: boolean }[] = [];
					const entities: SortEntity[] = [];

					for (let i = 0; i < sortedItems.length; i++) {
						const item = sortedItems[i];
						if (item && item.file) {
							const chapterInfo = ChapterSorter.extractChapterNumber(item.file.name);
							if (chapterInfo !== null) {
								chapterItems.push({ item, chapterInfo, isFolder: item.file instanceof TFolder });
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
							if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
							if (a.chapterInfo.number !== b.chapterInfo.number) {
								return a.chapterInfo.number - b.chapterInfo.number;
							}
							return 0;
						});
						
						const blockKey = folder.path === '/' ? '/__CHAPTER_BLOCK__' : `${folder.path}/__CHAPTER_BLOCK__`;
						entities.push({ isBlock: true, path: blockKey, items: chapterItems.map(c => c.item) });
					}

					const sortedEntities = patcher.sortEntities(entities);

					const finalResult: FileExplorerItem[] = [];
					for (const entity of sortedEntities) {
						if (entity.isBlock && entity.items) {
							finalResult.push(...entity.items);
						} else if (entity.item) {
							finalResult.push(entity.item);
						}
					}

					return patcher.applyHomepagePin(finalResult);
				} catch (e) {
					console.error('[WebNovel Assistant] getSortedFolderItems error:', e);
					return originalMethod.call(this, folder, bypass);
				}
			};

			})(this);

			(proto.getSortedFolderItems as unknown as { __webnovel_patched?: boolean }).__webnovel_patched = true;

			this.unpatchFunc = () => {
				proto.getSortedFolderItems = originalMethod;
			};

			return true;
		} catch (error) {
			console.error('[WebNovel Assistant] Error patching prototype:', error);
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

	private refreshAllExplorers(): void {
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
						contentEl = view.containerEl.querySelector('.nav-folder-children') as HTMLElement;
						folderFile = this.app.vault.getRoot();
					} else {
						const folderItem = view.fileItems[folderPath];
						if (!folderItem || !folderItem.el) continue;
						contentEl = folderItem.el.querySelector('.nav-folder-children') as HTMLElement;
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
		const handler = () => {
			if (!this.enabled) return;
			window.setTimeout(() => this.refreshAllExplorers(), 100);
		};

		this.eventRefs.push(this.app.vault.on('create', handler));
		this.eventRefs.push(this.app.vault.on('delete', (file) => {
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
					this.plugin.saveSettings().catch(() => {});
				}
			}
			window.setTimeout(() => this.refreshAllExplorers(), 100);
		}));
		this.eventRefs.push(this.app.vault.on('rename', (file, oldPath) => {
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
					this.plugin.saveSettings().catch(() => {});
				}
			}
			window.setTimeout(() => this.refreshAllExplorers(), 100);
		}));
		this.eventRefs.push(this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && !this.plugin.isFileInWorkspace(file)) return;
			handler();
		}));
		
		// 监听布局变化，确保在文件浏览器重新加载时重置拖拽事件
		this.eventRefs.push(this.app.workspace.on('layout-change', () => {
			if (!this.enabled) return;
			const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			if (leaf) {
				const containerEl = (leaf.view as FileExplorerView)?.containerEl as HTMLElement | undefined;
				// 如果容器发生了变化（例如重建了面板），则重新初始化事件
				if (containerEl && containerEl !== this._dragContainerEl) {
					this.teardownDragSort();
					this.initDragSort();
				}
			}
		}));
	}

	disable(): void {
		this.enabled = false;
		this.eventRefs.forEach(ref => this.app.vault.offref(ref));
		this.eventRefs = [];
		this.teardownDragSort();
		this.refreshAllExplorers();
		activeDocument.querySelectorAll('.folder-word-count').forEach(el => el.remove());
	}

	unpatch(): void {
		this.teardownDragSort();
		if (this.unpatchFunc) {
			this.unpatchFunc();
			this.unpatchFunc = null;
		}
		activeDocument.querySelectorAll('.folder-word-count').forEach(el => el.remove());
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	refreshFolderCounts() {
		try {
			const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
			if (!fileExplorer || !fileExplorer.view) return;

			const view = fileExplorer.view;
			if (!view.fileItems || typeof view.fileItems !== "object") return;
			const fileExplorerItems = view.fileItems;

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
			for (const path in fileExplorerItems) {
				const item = fileExplorerItems[path];
				if (item.el && (item.file instanceof TFolder || (item.file instanceof TFile && item.file.extension === 'md'))) {
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

					const count = this.plugin.cacheManager.getFolderCount(path);
					if (count === null) continue;

					const labelText = count > 0 ? ` (${count.toLocaleString()})` : "";
					let countEl = this.wordCountElCache.get(item.el) as HTMLElement;

					if (!countEl) {
						countEl = item.el.querySelector('.folder-word-count') as HTMLElement;
						if (!countEl) {
							const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
							const mountEl = titleContent?.parentElement;
							if (mountEl) {
								countEl = mountEl.createEl('span', { cls: 'folder-word-count' });
								countEl.addClass('webnovel-folder-word-count-detail');}
						}
						if (countEl) {
							this.wordCountElCache.set(item.el, countEl);
						}
					}

					if (countEl && countEl.textContent !== labelText) {
						countEl.textContent = labelText;
					}
				}
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

		const fileName = this.getFileNameFromEl(itemEl, null);
		const isChapter = fileName && ChapterSorter.extractChapterNumber(fileName) !== null;

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
			const filePath = this._getPathFromItemEl(itemEl);
			if (!filePath) return;
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
		const isChapterTarget = targetFileName && ChapterSorter.extractChapterNumber(targetFileName) !== null;
		
		let targetPath = this._getPathFromItemEl(targetItem);
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
		if (view && view.fileItems) {
			for (const path in view.fileItems) {
				const item = view.fileItems[path];
				if (item?.el === el && item.file) return item.file.name;
			}
		}
		return null;
	}
}
