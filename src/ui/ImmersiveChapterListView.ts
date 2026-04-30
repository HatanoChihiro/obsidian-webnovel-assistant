import { ItemView, WorkspaceLeaf, TFile, TFolder } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';

export class ImmersiveChapterListView extends ItemView {
	plugin: WebNovelAssistantPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPES.IMMERSIVE_CHAPTER_LIST;
	}

	getDisplayText(): string {
		return '沉浸章节列表';
	}
	
	getIcon(): string {
		return 'list';
	}

	async onOpen() {
		this.refresh();
		
		// 监听工作区事件，当文件切换或布局改变时自动刷新列表
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.refresh()));
	}

	/**
	 * 刷新章节列表内容
	 */
	private async refresh() {
		const { containerEl } = this;
		containerEl.empty();
		
		const listContainer = containerEl.createDiv({ cls: 'immersive-chapter-list' });
		
		// 尝试获取当前活动的文件所在文件夹
		let currentFolder: TFolder | null = null;
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			currentFolder = activeFile.parent;
		}

		// 如果通过 activeFile 没找到，尝试从所有 Markdown 叶子中找
		if (!currentFolder) {
			const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of mdLeaves) {
				const view = leaf.view as any;
				if (view && view.file) {
					currentFolder = view.file.parent;
					break;
				}
			}
		}

		if (!currentFolder) {
			listContainer.createEl('p', { text: '正在加载文件夹信息...', cls: 'immersive-empty-text' });
			// 如果还是没找到，可能是主编辑器还没准备好，1秒后重试一次
			setTimeout(() => {
				if (this.app.workspace.getActiveFile()) this.refresh();
			}, 1000);
			return;
		}

		// 获取该文件夹下的所有 Markdown 文件，并排序
		let files = currentFolder.children.filter(f => f instanceof TFile && f.extension === 'md') as TFile[];
		
		if (this.plugin.settings.enableSmartChapterSort) {
			files.sort((a, b) => ChapterSorter.compareFiles(a, b));
		} else {
			files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
		}

		for (const file of files) {
			const itemEl = listContainer.createDiv({ cls: 'immersive-chapter-item' });
			itemEl.createSpan({ text: file.basename });
			
			const wordCount = this.plugin.cacheManager.getFileCache(file.path) || 0;
			if (this.plugin.settings.showExplorerCounts) {
				itemEl.createSpan({ text: `${wordCount}字`, cls: 'immersive-chapter-count' });
			}

			// 左键：在主编辑器打开
			itemEl.addEventListener('click', () => {
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				if (leaves.length > 0) {
					leaves[0].openFile(file);
				}
			});

			// 右键：自动添加并打开参考文档
			itemEl.addEventListener('contextmenu', async (e) => {
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
						this.plugin.settings.immersiveShowReference = true;
						this.plugin.saveSettings();
					}
				}
				
				// 2. 确保目标叶子是 Markdown 类型并打开文件
				if (refLeaf) {
					if (refLeaf.view.getViewType() !== 'markdown') {
						await refLeaf.setViewState({ type: 'markdown', active: false });
					}
					await refLeaf.openFile(file);
				}
			});
		}
	}

	async onClose() {
	}
}
