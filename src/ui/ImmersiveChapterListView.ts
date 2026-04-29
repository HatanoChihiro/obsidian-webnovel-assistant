import { ItemView, WorkspaceLeaf, TFile, TFolder } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';

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
			files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
		} else {
			files.sort((a, b) => a.basename.localeCompare(b.basename));
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

			// 右键：在参考文档区打开
			itemEl.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
				const emptyLeaves = this.app.workspace.getLeavesOfType('empty');
				
				if (mdLeaves.length > 1) {
					mdLeaves[1].openFile(file);
				} else if (emptyLeaves.length > 0) {
					emptyLeaves[0].openFile(file);
				} else if (mdLeaves.length > 0) {
					mdLeaves[0].openFile(file);
				}
			});
		}
	}

	async onClose() {
	}
}
