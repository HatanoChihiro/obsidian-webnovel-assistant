import type { WorkspaceLeaf, TAbstractFile, MarkdownView } from 'obsidian';
import { ItemView, TFile, TFolder, Vault } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ChapterSorter } from '../services/ChapterSorter';
import { findBookRoot } from '../utils/path';
import { renderForeshadowingBadges, renderLoreBadges } from '../utils/badge';
import { t } from '../i18n';

export class ImmersiveChapterListView extends ItemView {
	plugin: WebNovelAssistantPlugin;
	private lastScrollTop: number = 0;
	private isInitialLoad: boolean = true;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPES.IMMERSIVE_CHAPTER_LIST;
	}

	getDisplayText(): string {
		return t('view.immersive-chapter-list');
	}
	
	getIcon(): string {
		return 'list';
	}

	async onOpen() {
		void this.refresh();
		
		// 仅轻量更新高亮类名，彻底消除全量清空 DOM 导致的严重卡顿
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => { this.updateActiveHighlight(); }));
		this.registerEvent(this.app.vault.on('create', () => { void this.refresh(); }));
		this.registerEvent(this.app.vault.on('delete', () => { void this.refresh(); }));
		this.registerEvent(this.app.vault.on('rename', () => { void this.refresh(); }));
	}

	private getMainEditorLeaf(): WorkspaceLeaf | null {
		const { workspace } = this.app;
		let mainLeaf: WorkspaceLeaf | null = null;

		// 1. 优先查带有 immersive-main-editor 标记的叶子
		workspace.iterateAllLeaves(leaf => {
			if (leaf.containerEl && leaf.containerEl.classList.contains('immersive-main-editor')) {
				mainLeaf = leaf;
			}
		});
		if (mainLeaf) return mainLeaf;

		// 2. 查找类型为 markdown 且不属于参考视图的叶子
		workspace.iterateAllLeaves(leaf => {
			if (leaf.view.getViewType() === 'markdown' && (!leaf.containerEl || !leaf.containerEl.classList.contains('immersive-reference-view'))) {
				mainLeaf = leaf;
			}
		});
		if (mainLeaf) return mainLeaf;

		return workspace.getLeavesOfType('markdown')[0] || null;
	}

	private resolveListContext(): { folder: TFolder; folderPath: string } | null {
		const mainLeaf = this.getMainEditorLeaf();
		if (!mainLeaf || mainLeaf.view.getViewType() !== 'markdown') return null;

		const file = (mainLeaf.view as MarkdownView).file;
		if (!file) return null;

		const bookPath = findBookRoot(this.app, this.plugin, file, true);
		const folder = bookPath
			? this.app.vault.getAbstractFileByPath(bookPath)
			: file.parent ?? this.app.vault.getRoot();

		if (!(folder instanceof TFolder)) return null;
		return { folder, folderPath: folder.isRoot() ? '/' : folder.path };
	}

	private getReferenceViewLeaf(): WorkspaceLeaf | null {
		const { workspace } = this.app;
		let refLeaf: WorkspaceLeaf | null = null;

		// 全量遍历检索带 immersive-reference-view 标记的叶子
		workspace.iterateAllLeaves(leaf => {
			if (leaf.containerEl && leaf.containerEl.classList.contains('immersive-reference-view')) {
				refLeaf = leaf;
			}
		});

		return refLeaf;
	}

	private updateActiveHighlight(): void {
		const activeFile = this.app.workspace.getActiveFile();
		const items = this.containerEl.querySelectorAll<HTMLElement>('.immersive-chapter-item');
		items.forEach(itemEl => {
			if (activeFile && itemEl.dataset.path === activeFile.path) {
				itemEl.addClass('is-active');
			} else {
				itemEl.removeClass('is-active');
			}
		});
	}

	public async refresh() {
		const { containerEl } = this;
		
		containerEl.empty();
		
		const listContainer = containerEl.createDiv({ cls: 'immersive-chapter-list' });
		listContainer.addEventListener('scroll', () => {
			this.lastScrollTop = listContainer.scrollTop;
		}, { passive: true });
		
		const context = this.resolveListContext();
		if (!context) {
			listContainer.createEl('p', { text: t('immersive.loading-folder'), cls: 'immersive-empty-text' });
			window.setTimeout(() => {
				if (this.app.workspace.getActiveFile()) void this.refresh();
			}, 1000);
			return;
		}

		const { folder: currentFolder, folderPath: bookPath } = context;
		const fmFolder = bookPath === '/' ? '' : bookPath;
		const allMdFiles: TFile[] = [];
		Vault.recurseChildren(currentFolder, (child: TAbstractFile) => {
			if (child instanceof TFile && child.extension === 'md') {
				allMdFiles.push(child);
			}
		});

		const foreshadowingMap = this.plugin.foreshadowingManager
			? await this.plugin.foreshadowingManager.buildChapterForeshadowingMap(fmFolder, allMdFiles, this.app.vault)
			: new Map<string, ParsedForeshadowingEntry[]>();

		const activeFile = this.app.workspace.getActiveFile();
		const state = { activeItemEl: null as HTMLElement | null };

		this.renderFolderRecursively(currentFolder, listContainer, foreshadowingMap, activeFile, state, bookPath);

		window.requestAnimationFrame(() => {
			if (listContainer) {
				if (this.isInitialLoad && state.activeItemEl) {
					state.activeItemEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
					this.isInitialLoad = false;
				} else {
					listContainer.scrollTop = this.lastScrollTop;
				}
			}
		});
	}

	private renderFolderRecursively(
		folder: TFolder,
		container: HTMLElement,
		foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>,
		activeFile: TFile | null,
		state: { activeItemEl: HTMLElement | null },
		bookPath: string
	) {
		const children = folder.children.filter(f => f instanceof TFolder || (f instanceof TFile && f.extension === 'md'));

		if (this.plugin.settings.enableSmartChapterSort) {
			const customOrder = this.plugin.settings.customSortOrder || {};
			children.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, customOrder));
		} else {
			children.sort((a, b) => {
				const aIsFolder = a instanceof TFolder;
				const bIsFolder = b instanceof TFolder;
				if (aIsFolder && !bIsFolder) return -1;
				if (!aIsFolder && bIsFolder) return 1;
				return a.name.localeCompare(b.name, undefined, { numeric: true });
			});
		}

		for (const item of children) {
			if (item instanceof TFolder) {
				const details = container.createEl('details', { cls: 'immersive-folder-details' });
				details.setAttribute('open', '');
				
				const summary = details.createEl('summary', { cls: 'immersive-folder-summary' });
				summary.createSpan({ text: item.name, cls: 'immersive-folder-name' });
				
				const childrenContainer = details.createDiv({ cls: 'immersive-folder-children' });
				this.renderFolderRecursively(item, childrenContainer, foreshadowingMap, activeFile, state, bookPath);
			} else if (item instanceof TFile) {
				const file = item;
				const itemEl = container.createDiv({ cls: 'immersive-chapter-item' });
				itemEl.dataset.path = file.path;
				if (activeFile && file.path === activeFile.path) {
					itemEl.addClass('is-active');
					state.activeItemEl = itemEl;
				}
				
				const leftContainer = itemEl.createDiv({ cls: 'immersive-chapter-left' });
				leftContainer.createSpan({ text: file.basename, cls: 'immersive-chapter-title' });
				
				const badgesContainer = leftContainer.createSpan({ cls: 'immersive-chapter-badges' });
				const cardForeshadowings = foreshadowingMap.get(file.basename) || [];
				
				renderForeshadowingBadges(badgesContainer, cardForeshadowings, file.basename, this.plugin);
				
				const cache = this.app.metadataCache.getFileCache(file);
				const frontmatter = cache?.frontmatter;
				const loreArray = frontmatter?.lore as unknown;
				renderLoreBadges(badgesContainer, loreArray, bookPath, this.plugin, false, 3);
				
				const wordCount = this.plugin.cacheManager.getFileCache(file.path) || 0;
				if (this.plugin.settings.showExplorerCounts) {
					if (this.plugin.cacheManager.isEligibleForWordCount(file)) {
						itemEl.createSpan({ text: `${wordCount}${t('common.word-char')}`, cls: 'immersive-chapter-count' });
					} else {
						itemEl.createSpan({ text: t('corkboard.wordcount-excluded'), cls: 'immersive-chapter-count is-excluded' });
					}
				}

				itemEl.addEventListener('click', (e) => {
					e.preventDefault();
					const targetLeaf = this.getMainEditorLeaf();
					if (targetLeaf) {
						void targetLeaf.openFile(file, { active: true });
					}
				});

				itemEl.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					
					let refLeaf = this.getReferenceViewLeaf();

					if (!refLeaf) {
						const mainLeaf = this.getMainEditorLeaf();
						const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
						refLeaf = mdLeaves.find(l => l !== mainLeaf) || null;
					}

					if (!refLeaf) {
						const emptyLeaves = this.app.workspace.getLeavesOfType('empty');
						if (emptyLeaves.length > 0) {
							refLeaf = emptyLeaves[0];
						}
					}

					if (!refLeaf) {
						const mainLeaf = this.getMainEditorLeaf();
						if (mainLeaf) {
							refLeaf = this.app.workspace.createLeafBySplit(mainLeaf, 'vertical', false);
							refLeaf.containerEl.classList.add('immersive-reference-view');
							
							if (!this.plugin.settings.immersive.immersiveRightSlots.includes('reference-view')) {
								this.plugin.settings.immersive.immersiveRightSlots.push('reference-view');
								void this.plugin.saveSettings();
							}
						}
					}
					
					if (refLeaf) {
						refLeaf.containerEl.classList.add('immersive-reference-view');
						void refLeaf.openFile(file, { active: false, state: { mode: 'preview' } }).then(() => {
							if (refLeaf) {
								refLeaf.containerEl.classList.add('immersive-reference-view');
							}
						});
					}
				});
			}
		}
	}

	async onClose() {
	}
}
