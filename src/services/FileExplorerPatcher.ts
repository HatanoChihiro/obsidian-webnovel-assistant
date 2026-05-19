import { App, EventRef, TFolder, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from './ChapterSorter';

/**
 * 文件浏览器补丁管理器
 *
 * 混合方案：Prototype Patch + DOM 重排 + 拖拽阻止
 * - Prototype Patch 拦截 getSortedFolderItems 的排序逻辑
 * - DOM 重排确保视觉顺序与逻辑排序一致（部分 Obsidian 版本不使用返回值渲染）
 * - dragstart 阻止使章节文件不可拖动，恢复原设计意图
 */
export class FileExplorerPatcher {
	private app: App;
	private plugin: WebNovelAssistantPlugin;
	private enabled: boolean = false;
	private unpatchFunc: (() => void) | null = null;
	private eventRefs: EventRef[] = [];
	private wordCountElCache = new WeakMap<HTMLElement, HTMLElement>();
	private chapterEls = new WeakSet<HTMLElement>();

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	enable(): boolean {
		if (this.enabled) return true;

		ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);

		try {
			const success = this.patchFileExplorerPrototype();
			if (success) {
				this.enabled = true;
				console.debug('[WebNovel Assistant] Smart chapter sorting enabled');

				this.refreshAllExplorers();
				this.setupFileSystemListeners();
				return true;
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

			const view = fileExplorerLeaf.view as any;
			if (!view) return false;

			const proto = Object.getPrototypeOf(view);
			if (!proto || !proto.getSortedFolderItems) return false;

			if (proto.getSortedFolderItems.__webnovel_patched) return true;

			const originalMethod = proto.getSortedFolderItems;
			const self = this;

			proto.getSortedFolderItems = function(folder: TFolder, bypass?: boolean) {
				try {
					const sortedItems: any[] = originalMethod.call(this, folder, bypass);

					if (!self.enabled || bypass) return sortedItems;
					if (!Array.isArray(sortedItems) || sortedItems.length === 0) return sortedItems;

					const chapterItems: { item: any; chapterInfo: { number: number; ruleIndex: number }; isFolder: boolean; pos: number }[] = [];
					const nonChapterItems: { item: any; pos: number }[] = [];

					for (let i = 0; i < sortedItems.length; i++) {
						const item = sortedItems[i];
						if (item && (item.file instanceof TFile || item.file instanceof TFolder)) {
							const chapterInfo = ChapterSorter.extractChapterNumber(item.file.name);
							if (chapterInfo !== null) {
								chapterItems.push({ item, chapterInfo, isFolder: item.file instanceof TFolder, pos: i });
								continue;
							}
						}
						nonChapterItems.push({ item, pos: i });
					}

					if (chapterItems.length < 2) return sortedItems;

					chapterItems.sort((a, b) => {
						if (a.chapterInfo.ruleIndex !== b.chapterInfo.ruleIndex) {
							return a.chapterInfo.ruleIndex - b.chapterInfo.ruleIndex;
						}
						if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
						if (a.chapterInfo.number !== b.chapterInfo.number) {
							return a.chapterInfo.number - b.chapterInfo.number;
						}
						return a.pos - b.pos;
					});

					const firstChapterPos = chapterItems[0].pos;
					const result: any[] = [];

					for (const nc of nonChapterItems) {
						if (nc.pos < firstChapterPos) result.push(nc.item);
					}
					for (const ci of chapterItems) result.push(ci.item);
					for (const nc of nonChapterItems) {
						if (nc.pos >= firstChapterPos) result.push(nc.item);
					}

					return result;
				} catch (e) {
					return originalMethod.call(this, folder, bypass);
				}
			};

			proto.getSortedFolderItems.__webnovel_patched = true;

			this.unpatchFunc = () => {
				proto.getSortedFolderItems = originalMethod;
			};

			return true;
		} catch (error) {
			console.error('[WebNovel Assistant] Error patching prototype:', error);
			return false;
		}
	}

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
		// Prototype Patch 可能不控制视觉 → DOM 重排修正显示
		this.applyDOMSort();
	}

	/**
	 * DOM 重排：确保视觉顺序与 Prototype Patch 的逻辑排序一致
	 */
	private applyDOMSort(): void {
		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		for (const leaf of leaves) {
			const view = leaf.view as any;
			if (!view || !view.fileItems) continue;

			const folderPaths = new Set<string>();
			for (const path in view.fileItems) {
				const item = view.fileItems[path];
				if (item?.file instanceof TFile && ChapterSorter.extractChapterNumber(item.file.name) !== null) {
					const parent = item.file.parent;
					if (parent) folderPaths.add(parent.path);
				}
			}

			for (const folderPath of folderPaths) {
				const folderItem = view.fileItems[folderPath];
				if (!folderItem?.el) continue;

				const contentEl = folderItem.el.querySelector('.nav-folder-children') as HTMLElement;
				if (!contentEl) continue;

				const children = Array.from(contentEl.children) as HTMLElement[];
				const chapterEls: { el: HTMLElement; number: number; ruleIndex: number; isFolder: boolean; pos: number }[] = [];
				const nonChapterEls: { el: HTMLElement; pos: number }[] = [];

				for (let i = 0; i < children.length; i++) {
					const el = children[i];
					const fileName = this.getFileNameFromEl(el, view);
					if (fileName && ChapterSorter.extractChapterNumber(fileName) !== null) {
						const info = ChapterSorter.extractChapterNumber(fileName)!;
						const isFolder = el.classList.contains('nav-folder');
						chapterEls.push({ el, number: info.number, ruleIndex: info.ruleIndex, isFolder, pos: i });
					} else {
						nonChapterEls.push({ el, pos: i });
					}
				}

				if (chapterEls.length < 2) continue;

				chapterEls.sort((a, b) => {
					if (a.ruleIndex !== b.ruleIndex) return a.ruleIndex - b.ruleIndex;
					if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
					if (a.number !== b.number) return a.number - b.number;
					return a.pos - b.pos;
				});

				const firstChapterPos = chapterEls[0].pos;
				const newOrder: HTMLElement[] = [];

				for (const nc of nonChapterEls) {
					if (nc.pos < firstChapterPos) newOrder.push(nc.el);
				}
				for (const ch of chapterEls) newOrder.push(ch.el);
				for (const nc of nonChapterEls) {
					if (nc.pos >= firstChapterPos) newOrder.push(nc.el);
				}

				let needReorder = false;
				for (let i = 0; i < newOrder.length; i++) {
					if (children[i] !== newOrder[i]) {
						needReorder = true;
						break;
					}
				}

				if (needReorder) {
					for (const el of newOrder) {
						contentEl.appendChild(el);
					}
				}

				this.preventChapterDrag(chapterEls);
			}
		}
	}

	/**
	 * 阻止章节文件的拖拽（章节不可被拖动改变顺序）
	 */
	private preventChapterDrag(chapterEls: { el: HTMLElement }[]): void {
		for (const { el } of chapterEls) {
			if (this.chapterEls.has(el)) continue;
			this.chapterEls.add(el);

			el.addEventListener('dragstart', (e: Event) => {
				e.preventDefault();
				e.stopPropagation();
			}, true);
		}
	}

	private getFileNameFromEl(el: HTMLElement, view: any): string | null {
		for (const path in view.fileItems) {
			const item = view.fileItems[path];
			if (item?.el === el && item.file) {
				return item.file.name;
			}
		}
		const dataPath = el.getAttribute('data-path');
		if (dataPath) {
			const file = this.app.vault.getAbstractFileByPath(dataPath);
			if (file && (file instanceof TFile || file instanceof TFolder)) return file.name;
		}
		return null;
	}

	private setupFileSystemListeners(): void {
		const handler = () => {
			if (!this.enabled) return;
			setTimeout(() => this.refreshAllExplorers(), 100);
		};

		this.eventRefs.push(this.app.vault.on('create', handler));
		this.eventRefs.push(this.app.vault.on('delete', handler));
		this.eventRefs.push(this.app.vault.on('rename', handler));
		this.eventRefs.push(this.app.metadataCache.on('changed', handler));
	}

	disable(): void {
		this.enabled = false;
		this.eventRefs.forEach(ref => this.app.vault.offref(ref));
		this.eventRefs = [];
		this.refreshAllExplorers();
		console.debug('[WebNovel Assistant] Smart chapter sorting disabled');
	}

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
			let updatedCount = 0;
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
								countEl.style.fontSize = '0.8em';
								countEl.style.opacity = '0.5';
								countEl.style.marginLeft = '5px';
							}
						}
						if (countEl) {
							this.wordCountElCache.set(item.el, countEl);
						}
					}

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