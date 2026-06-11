import type { WorkspaceLeaf, TFolder } from 'obsidian';
import { ItemView, TFile, MarkdownView } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';
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

	/**
	 * 刷新章节列表内容
	 */
	public async refresh() {
		const { containerEl } = this;
		
		// 我们不再从 oldListContainer 中临时读取，而是依赖 scroll 事件更新的 lastScrollTop
		// 这样可以避免多次快速刷新时导致位置丢失
		containerEl.empty();
		
		const listContainer = containerEl.createDiv({ cls: 'immersive-chapter-list' });
		
		// 实时记录用户的滚动位置
		listContainer.addEventListener('scroll', () => {
			this.lastScrollTop = listContainer.scrollTop;
		}, { passive: true });
		
		// 尝试获取当前活动的文件所在文件夹
		let currentFolder: TFolder | null = null;
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			currentFolder = activeFile.parent ?? this.app.vault.getRoot();
		}

		// 如果通过 activeFile 没找到，尝试从所有 Markdown 叶子中找
		if (!currentFolder) {
			const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of mdLeaves) {
				const view = leaf.view as unknown as { file?: TFile };
				if (view && view.file) {
					currentFolder = view.file.parent ?? this.app.vault.getRoot();
					break;
				}
			}
		}

		if (!currentFolder) {
			listContainer.createEl('p', { text: t('immersive.loading-folder'), cls: 'immersive-empty-text' });
			// 如果还是没找到，可能是主编辑器还没准备好，1秒后重试一次
			window.setTimeout(() => {
				if (this.app.workspace.getActiveFile()) void this.refresh();
			}, 1000);
			return;
		}

		// 获取该文件夹下的所有 Markdown 文件，并排序
		const files = currentFolder.children.filter(f => f instanceof TFile && f.extension === 'md') as TFile[];
		
		if (this.plugin.settings.enableSmartChapterSort) {
			files.sort((a, b) => ChapterSorter.compareFiles(a, b));
		} else {
			files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
		}

		let activeItemEl: HTMLElement | null = null;

		for (const file of files) {
			const itemEl = listContainer.createDiv({ cls: 'immersive-chapter-item' });
			if (activeFile && file.path === activeFile.path) {
				itemEl.addClass('is-active');
				activeItemEl = itemEl;
			}
			itemEl.createSpan({ text: file.basename });
			
			const wordCount = this.plugin.cacheManager.getFileCache(file.path) || 0;
			if (this.plugin.settings.showExplorerCounts) {
				if (ChapterSorter.isChapterFile(file.basename)) {
					itemEl.createSpan({ text: `${wordCount}${t('common.word-char')}`, cls: 'immersive-chapter-count' });
				}
			}

			// 左键：在主编辑器打开
			itemEl.addEventListener('click', () => {
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				if (leaves.length > 0) {
					void leaves[0].openFile(file);
				}
			});

			// 右键：自动添加并打开参考文档
			itemEl.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				
				const { workspace } = this.app;
				// 1. 寻找参考叶子（多级兜底策略）
				let refLeaf: WorkspaceLeaf | null = null;
				
				// 策略 A: 查找带有特定标记的叶子（沉浸模式专用标记）
				workspace.iterateRootLeaves(leaf => {
					if (leaf.containerEl && leaf.containerEl.classList.contains('immersive-reference-view')) {
						refLeaf = leaf;
					}
				});

				// 策略 B: 如果没找到标记，但存在多个 Markdown 视图，假设第二个是参考区
				if (!refLeaf) {
					const mdLeaves = workspace.getLeavesOfType('markdown');
					if (mdLeaves.length > 1) {
						refLeaf = mdLeaves[1];
					}
				}

				// 策略 C: 寻找“空”叶子（即面板占位符，没有打开任何文件时）
				if (!refLeaf) {
					const emptyLeaves = workspace.getLeavesOfType('empty');
					if (emptyLeaves.length > 0) {
						refLeaf = emptyLeaves[0];
					}
				}

				// 策略 D: 确实没面板，则自动创建垂直拆分
				if (!refLeaf) {
					const mainLeaf = workspace.getLeavesOfType('markdown')[0];
					if (mainLeaf) {
						refLeaf = workspace.createLeafBySplit(mainLeaf, 'vertical', false);
						refLeaf.containerEl.classList.add('immersive-reference-view');
						
						// 更新设置并保存
						if (!this.plugin.settings.immersive.immersiveRightSlots.includes('reference-view')) {
							this.plugin.settings.immersive.immersiveRightSlots.push('reference-view');
						}
						void this.plugin.saveSettings();
					}
				}
				
				// 2. 确保目标叶子是 Markdown 类型并打开文件为阅读视图
				if (refLeaf) {
					// 获取当前或初始状态
					const mdView = refLeaf.view.getViewType() === 'markdown' ? refLeaf.view as MarkdownView : null;
						const currentState = mdView && typeof mdView.getState === 'function'
						? mdView.getState()
						: {};
					
					// 强制设为阅读模式
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

		// 恢复滚动位置，或者在初始时滚动到激活文档
		window.requestAnimationFrame(() => {
			if (listContainer) {
				if (this.isInitialLoad && activeItemEl) {
					activeItemEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
					this.isInitialLoad = false;
				} else {
					listContainer.scrollTop = this.lastScrollTop;
				}
			}
		});
	}

	async onClose() {
	}
}
