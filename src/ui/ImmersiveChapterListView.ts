import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, TFile, TFolder } from 'obsidian';
import type { MarkdownView } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ChapterSorter } from '../services/ChapterSorter';
import { getCurrentBookContext } from '../utils/path';
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
		
		// 监听工作区事件，当文件切换或布局改变时自动刷新列表
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => { void this.refresh(); }));
		this.registerEvent(this.app.workspace.on('layout-change', () => { void this.refresh(); }));
	}

	public async refresh() {
		const { containerEl } = this;
		
		containerEl.empty();
		
		const listContainer = containerEl.createDiv({ cls: 'immersive-chapter-list' });
		listContainer.addEventListener('scroll', () => {
			this.lastScrollTop = listContainer.scrollTop;
		}, { passive: true });
		
		const bookPath = getCurrentBookContext(this.app, this.plugin);
		if (bookPath === null) {
			listContainer.createEl('p', { text: t('immersive.loading-folder') || '正在加载...', cls: 'immersive-empty-text' });
			window.setTimeout(() => {
				if (this.app.workspace.getActiveFile()) void this.refresh();
			}, 1000);
			return;
		}

		let abstractFolder = this.app.vault.getAbstractFileByPath(bookPath === '/' ? '/' : bookPath);
		if (!(abstractFolder instanceof TFolder)) {
			abstractFolder = this.app.vault.getRoot();
		}
		const currentFolder = abstractFolder as TFolder;

		const fmFolder = bookPath === '/' ? '' : bookPath;
		// 获取该作品下所有的 markdown 文件
		const allMdFiles = this.plugin.getTrackedMarkdownFiles().filter(f => bookPath === '/' ? true : f.path.startsWith(bookPath + '/'));

		const foreshadowingMap = this.plugin.foreshadowingManager
			? await this.plugin.foreshadowingManager.buildChapterForeshadowingMap(fmFolder, allMdFiles, this.app.vault)
			: new Map<string, ParsedForeshadowingEntry[]>();

		const activeFile = this.app.workspace.getActiveFile();
		const state = { activeItemEl: null as HTMLElement | null };

		this.renderFolderRecursively(currentFolder, listContainer, foreshadowingMap, activeFile, state);

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
		state: { activeItemEl: HTMLElement | null }
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
				this.renderFolderRecursively(item, childrenContainer, foreshadowingMap, activeFile, state);
			} else if (item instanceof TFile) {
				const file = item;
				const itemEl = container.createDiv({ cls: 'immersive-chapter-item' });
				if (activeFile && file.path === activeFile.path) {
					itemEl.addClass('is-active');
					state.activeItemEl = itemEl;
				}
				
				const leftContainer = itemEl.createDiv({ cls: 'immersive-chapter-left' });
				leftContainer.createSpan({ text: file.basename, cls: 'immersive-chapter-title' });
				
				const badgesContainer = leftContainer.createSpan({ cls: 'immersive-chapter-badges' });
				const cardForeshadowings = foreshadowingMap.get(file.basename) || [];
				
				const pendingForeshadowings = cardForeshadowings.filter(f => f.status === ForeshadowingStatus.Pending);
				if (pendingForeshadowings.length > 0) {
					const fsBadge = badgesContainer.createEl('span', {
						cls: 'wn-badge wn-badge-foreshadowing',
						text: `${t('corkboard.foreshadowing-unresolved') || '待回收'}×${pendingForeshadowings.length}`
					});
					fsBadge.title = pendingForeshadowings.map(f => f.description).join('\n');
				}
				
				const recoveredForeshadowings = cardForeshadowings.filter(f => f.status === ForeshadowingStatus.Recovered);
				if (recoveredForeshadowings.length > 0) {
					const fsBadge = badgesContainer.createEl('span', {
						cls: 'wn-badge wn-badge-recovered',
						text: `${t('corkboard.foreshadowing-recovered') || '本章回收'}×${recoveredForeshadowings.length}`
					});
					fsBadge.title = recoveredForeshadowings.map(f => f.description).join('\n');
				}
				
				const cache = this.app.metadataCache.getFileCache(file);
				const frontmatter = cache?.frontmatter;
				const loreArray = frontmatter?.lore as unknown;
				if (Array.isArray(loreArray)) {
					const validLores: string[] = (loreArray as unknown[]).filter((l: unknown): l is string => typeof l === 'string');
					if (validLores.length > 0) {
						const maxDisplay = 3;
						for (let i = 0; i < Math.min(validLores.length, maxDisplay); i++) {
							badgesContainer.createEl('span', {
								cls: 'wn-badge wn-badge-lore',
								text: validLores[i].split('×')[0]
							});
						}
						if (validLores.length > maxDisplay) {
							badgesContainer.createEl('span', {
								cls: 'wn-badge wn-badge-lore wn-badge-more',
								text: `+${validLores.length - maxDisplay}`
							});
						}
					}
				}
				
				const wordCount = this.plugin.cacheManager.getFileCache(file.path) || 0;
				if (this.plugin.settings.showExplorerCounts) {
					const strictOk = !this.plugin.settings.enableStrictChapterMode || ChapterSorter.isChapterFile(file.basename);
					if (strictOk) {
						itemEl.createSpan({ text: `${wordCount}${t('common.word-char')}`, cls: 'immersive-chapter-count' });
					}
				}

				itemEl.addEventListener('click', () => {
					const leaves = this.app.workspace.getLeavesOfType('markdown');
					if (leaves.length > 0) {
						void leaves[0].openFile(file);
					}
				});

				itemEl.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				
				const { workspace } = this.app;
				let refLeaf: WorkspaceLeaf | null = null;
				
				workspace.iterateRootLeaves(leaf => {
					if (leaf.containerEl && leaf.containerEl.classList.contains('immersive-reference-view')) {
						refLeaf = leaf;
					}
				});

				if (!refLeaf) {
					const mdLeaves = workspace.getLeavesOfType('markdown');
					if (mdLeaves.length > 1) {
						refLeaf = mdLeaves[1];
					}
				}

				if (!refLeaf) {
					const emptyLeaves = workspace.getLeavesOfType('empty');
					if (emptyLeaves.length > 0) {
						refLeaf = emptyLeaves[0];
					}
				}

				if (!refLeaf) {
					const mainLeaf = workspace.getLeavesOfType('markdown')[0];
					if (mainLeaf) {
						refLeaf = workspace.createLeafBySplit(mainLeaf, 'vertical', false);
						refLeaf.containerEl.classList.add('immersive-reference-view');
						
						if (!this.plugin.settings.immersive.immersiveRightSlots.includes('reference-view')) {
							this.plugin.settings.immersive.immersiveRightSlots.push('reference-view');
						}
						void this.plugin.saveSettings();
					}
				}
				
				if (refLeaf) {
					const mdView = refLeaf.view.getViewType() === 'markdown' ? refLeaf.view as MarkdownView : null;
					const currentState = mdView && typeof mdView.getState === 'function'
						? mdView.getState()
						: {};
					
					currentState.file = file.path;
					currentState.mode = 'preview';
					currentState.source = false;

					void refLeaf.setViewState({ 
						type: 'markdown', 
						state: currentState, 
						active: false 
					});
				}
			});
		}
		}
	}

	async onClose() {
	}
}
