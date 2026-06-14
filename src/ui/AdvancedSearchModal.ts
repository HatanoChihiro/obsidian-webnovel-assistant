import type { App, TAbstractFile} from 'obsidian';
import { Modal, Setting, TFolder, TFile, MarkdownView, prepareSimpleSearch } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';
import { t } from '../i18n';

export class AdvancedSearchModal extends Modal {
	plugin: WebNovelAssistantPlugin;
	query: string = '';
	searchScope: 'global' | 'current' | 'custom' = 'current';
	selectedFolders: Set<string> = new Set();
	resultsContainer!: HTMLElement;
	customScopeContainer!: HTMLElement;
	
	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		super(app);
		this.plugin = plugin;
		this.query = this.plugin.settings.advancedSearchQuery || '';
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('modal.advanced-search') });

		// 搜索关键词
		new Setting(contentEl)
			.setName(t('modal.search-keyword'))
			.setDesc(t('modal.search-keyword-desc'))
			.addText(text => {
				text.setPlaceholder(t('modal.search-keyword-placeholder'))
				.setValue(this.query)
				.onChange(value => {
					this.query = value;
				});
				
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void this.executeSearch();
					}
				});
			});

		// 搜索范围选择
		new Setting(contentEl)
			.setName(t('modal.search-scope'))
			.addDropdown(dropdown => {
				dropdown.addOption('global', t('modal.scope-global'));
				dropdown.addOption('current', t('modal.scope-current'));
				dropdown.addOption('custom', t('modal.scope-custom'));
				dropdown.setValue(this.searchScope);
				dropdown.onChange(value => {
					this.searchScope = value as 'global' | 'current' | 'custom';
					this.renderCustomScopeSettings(this.customScopeContainer);
				});
			});

		// 自定义范围的选择区域
		this.customScopeContainer = contentEl.createDiv('advanced-search-custom-scope');
		this.renderCustomScopeSettings(this.customScopeContainer);

		// 搜索按钮
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('modal.start-search'))
				.setCta()
				.onClick(() => {
					void this.executeSearch();
				})
			);

		// 搜索结果容器
		this.resultsContainer = contentEl.createDiv('advanced-search-results-container');
	}

	private renderCustomScopeSettings(container: HTMLElement) {
		container.empty();
		
		if (this.searchScope !== 'custom') {
			container.hide();
			return;
		}

		container.show();
		container.createEl('h4', { text: t('modal.select-folders-hint'), cls: 'setting-item-name' });
		
		const folders = this.getTopLevelFolders();
		
		if (folders.length === 0) {
			container.createEl('p', { text: t('modal.no-top-level-folders'), cls: 'setting-item-description' });
			return;
		}

		// 为每个目录创建一个树形选择器
		const listContainer = container.createDiv({ cls: 'advanced-search-folder-list webnovel-search-folder-list' });

		for (const folder of folders) {
			this.renderFolderTree(listContainer, folder);
		}
		
		this.updateCheckboxStates();
	}

	private renderFolderTree(container: HTMLElement, folder: TFolder) {
		const children = folder.children.filter(f => f instanceof TFolder || (f instanceof TFile && f.extension === 'md'))
			.sort((a, b) => this.compareFiles(a, b));

		const itemContainer = container.createDiv({ cls: 'advanced-search-tree-item' });
		
		const headerEl = itemContainer.createDiv({ cls: 'advanced-search-tree-header' });
		
		let childrenContainer: HTMLElement | null = null;
		
		if (children.length > 0) {
			const arrow = headerEl.createSpan({ text: '▶ ', cls: 'advanced-search-tree-arrow' });
			
			childrenContainer = itemContainer.createDiv({ cls: 'advanced-search-tree-children' });

			arrow.addEventListener('click', () => {
				if (childrenContainer!.style.display === 'none' || childrenContainer!.style.display === '') {
					childrenContainer!.setCssProps({ display: 'block' });
					arrow.innerText = '▼ ';
				} else {
					childrenContainer!.setCssProps({ display: 'none' });
					arrow.innerText = '▶ ';
				}
			});
		} else {
			// 文件占位符，保持对齐
			headerEl.createSpan({ cls: 'advanced-search-tree-spacer' });
		}
		
		const label = headerEl.createSpan({ text: folder.name, cls: 'advanced-search-tree-name' });
		if (folder instanceof TFolder) {
			label.addClass('webnovel-search-folder-name');
		}
		
		const checkbox = headerEl.createEl('input');
		checkbox.type = 'checkbox';
		checkbox.dataset.path = folder.path;
		checkbox.addClass('webnovel-search-checkbox');
		
		checkbox.addEventListener('change', () => {
			this.toggleSelection(folder, checkbox.checked);
		});
		
		if (childrenContainer) {
			for (const child of children) {
				if (child instanceof TFolder) {
					this.renderFolderTree(childrenContainer, child);
				} else if (child instanceof TFile) {
					// 渲染文件
					const fileItem = childrenContainer.createDiv({ cls: 'advanced-search-tree-item' });
					const fileHeader = fileItem.createDiv({ cls: 'advanced-search-tree-header' });
					
					fileHeader.createSpan({ cls: 'advanced-search-tree-spacer' });
					
					const fileLabel = fileHeader.createSpan({ text: child.name, cls: 'advanced-search-tree-name' });
					fileLabel.addClass('webnovel-search-file-name');
					
					const fileCheckbox = fileHeader.createEl('input');
					fileCheckbox.type = 'checkbox';
					fileCheckbox.dataset.path = child.path;
					fileCheckbox.addClass('webnovel-search-checkbox');
					
					fileCheckbox.addEventListener('change', () => {
						this.toggleSelection(child, fileCheckbox.checked);
					});
				}
			}
		}
	}

	private toggleSelection(item: TAbstractFile, isChecked: boolean) {
		if (isChecked) {
			// 勾选该项及其所有子项
			const checkRecursively = (fileOrFolder: TAbstractFile) => {
				this.selectedFolders.add(fileOrFolder.path);
				if (fileOrFolder instanceof TFolder) {
					for (const child of fileOrFolder.children) {
						if (child instanceof TFolder || (child instanceof TFile && child.extension === 'md')) {
							checkRecursively(child);
						}
					}
				}
			};
			checkRecursively(item);
		} else {
			// 取消勾选该项及其所有子项
			const uncheckRecursively = (fileOrFolder: TAbstractFile) => {
				this.selectedFolders.delete(fileOrFolder.path);
				if (fileOrFolder instanceof TFolder) {
					for (const child of fileOrFolder.children) {
						if (child instanceof TFolder || (child instanceof TFile && child.extension === 'md')) {
							uncheckRecursively(child);
						}
					}
				}
			};
			uncheckRecursively(item);
			
			// 取消勾选所有父级目录（因为子项不再完整）
			let currentPath = item.path;
			while (currentPath.includes('/')) {
				currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
				this.selectedFolders.delete(currentPath);
			}
		}
		
		this.updateCheckboxStates();
	}

	private updateCheckboxStates() {
		if (!this.customScopeContainer) return;
		const checkboxes = this.customScopeContainer.querySelectorAll('input[type="checkbox"]');
		checkboxes.forEach((cb: Element) => {
			const checkbox = cb as HTMLInputElement;
			const path = checkbox.dataset.path;
			if (!path) return;
			
			checkbox.checked = this.selectedFolders.has(path);
			checkbox.disabled = false;
			checkbox.title = '';
		});
	}

	private getTopLevelFolders(): TFolder[] {
		// 获取直接位于根目录下的所有文件夹，或者如果是工作区模式，则获取工作区指定的文件夹
		const rootFolders: TFolder[] = [];
		
		if (this.plugin.settings.workspaceFolders && this.plugin.settings.workspaceFolders.length > 0) {
			for (const path of this.plugin.settings.workspaceFolders) {
				const folder = this.app.vault.getAbstractFileByPath(path);
				if (folder instanceof TFolder) {
					rootFolders.push(folder);
				}
			}
		} else {
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				if (child instanceof TFolder && !child.name.startsWith('.')) {
					rootFolders.push(child);
				}
			}
		}
		
		return rootFolders;
	}

	private getCurrentBookPath(): string | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) return null;
		
		let folder = activeView.file.parent;
		if (!folder || folder.isRoot()) return null;

		// 向上查找当前作品目录：
		// - 有 workspaceFolders 时：工作区文件夹的直接子目录即为作品目录
		// - 无 workspaceFolders 时：根目录的直接子目录即为作品目录
		const workspaceFolders = this.plugin.settings.workspaceFolders || [];
		
		while (folder && !folder.isRoot()) {
			const parent: TFolder | null = folder.parent;
			if (!parent) break;

			if (workspaceFolders.length > 0) {
				// 如果当前目录的父目录是工作区目录，那当前目录就是作品目录
				if (workspaceFolders.includes(parent.path)) {
					return folder.path;
				}
				// 特殊情况：当前目录本身就是工作区目录，说明文件直接在工作区根下
				// 此时没有作品子目录层级，用工作区目录本身作为范围
				if (workspaceFolders.includes(folder.path)) {
					return folder.path;
				}
			} else {
				// 无工作区设置时，根目录的直接子目录就是作品目录
				if (parent.isRoot()) {
					return folder.path;
				}
			}
			folder = parent;
		}
		
		return null;
	}

	private async executeSearch() {
		if (this.query !== this.plugin.settings.advancedSearchQuery) {
			this.plugin.settings.advancedSearchQuery = this.query;
			void this.plugin.saveSettings();
		}

		if (!this.query.trim()) {
			this.resultsContainer.empty();
			this.resultsContainer.createEl('div', { text: t('modal.please-enter-keyword'), cls: 'advanced-search-empty' });
			return;
		}

		this.resultsContainer.empty();
		this.resultsContainer.createEl('div', { text: t('modal.searching'), cls: 'advanced-search-loading' });

		// 1. 获取目标文件列表
		const allFiles = this.app.vault.getMarkdownFiles();
		let targetFiles: TFile[] = [];

		if (this.searchScope === 'global') {
			targetFiles = allFiles;
		} else if (this.searchScope === 'current') {
			const bookPath = this.getCurrentBookPath();
			if (bookPath) {
				targetFiles = allFiles.filter(f => f.path.startsWith(bookPath + '/'));
			} else {
				targetFiles = allFiles; // fallback
			}
		} else if (this.searchScope === 'custom') {
			if (this.selectedFolders.size > 0) {
				const selectedArray = Array.from(this.selectedFolders);
				targetFiles = allFiles.filter(f => selectedArray.some(path => f.path === path || f.path.startsWith(path + '/')));
			}
		}

		if (targetFiles.length === 0) {
			this.resultsContainer.empty();
			this.resultsContainer.createEl('div', { text: t('modal.no-files-in-scope'), cls: 'advanced-search-empty' });
			return;
		}

		// 2. 对目标文件进行排序（按章节或自定义顺序），保证搜索结果是有序的
		targetFiles.sort((a, b) => this.compareFiles(a, b));

		// 3. 执行本地搜索
		const searchFn = prepareSimpleSearch(this.query.trim());
		const results: { file: TFile, snippets: {linesBefore: number, prefix: string, highlight: string, suffix: string}[], totalMatches: number }[] = [];

		for (let i = 0; i < targetFiles.length; i++) {
			const file = targetFiles[i];
			const content = await this.app.vault.cachedRead(file);
			const match = searchFn(content);

			if (match && match.matches.length > 0) {
				const snippets = match.matches.slice(0, 10).map(m => {
					const start = Math.max(0, m[0] - 20);
					const end = Math.min(content.length, m[1] + 20);

					const prefix = content.substring(start, m[0]).replace(/\n/g, ' ');
					const highlight = content.substring(m[0], m[1]).replace(/\n/g, ' ');
					const suffix = content.substring(m[1], end).replace(/\n/g, ' ');
					
					const linesBefore = content.substring(0, m[0]).split('\n').length - 1;

					return { linesBefore, prefix, highlight, suffix };
				});

				results.push({ file, snippets, totalMatches: match.matches.length });
			}

			// 防卡死：每处理 50 个文件让出一次主线程
			if (i % 50 === 0) {
				await new Promise(resolve => window.setTimeout(resolve, 0));
			}
		}

		// 3. 渲染结果
		this.renderSearchResults(results);
	}

	private renderSearchResults(results: { file: TFile, snippets: {linesBefore: number, prefix: string, highlight: string, suffix: string}[], totalMatches: number }[]) {
		this.resultsContainer.empty();

		if (results.length === 0) {
			this.resultsContainer.createEl('div', { text: t('modal.no-results'), cls: 'advanced-search-empty' });
			return;
		}

		this.resultsContainer.createEl('div', {
			text: t('modal.found-matching-files', { count: results.length }),
			cls: 'advanced-search-summary'
		});

		const listEl = this.resultsContainer.createDiv({ cls: 'advanced-search-results-list' });

		for (const result of results) {
			const fileItem = listEl.createDiv({ cls: 'advanced-search-file-item' });
			
			fileItem.createEl('div', { text: `${result.file.basename} (${t('modal.matches-count', { count: result.totalMatches })})`, cls: 'advanced-search-file-title' });

			for (const snippet of result.snippets) {
				const matchEl = fileItem.createDiv({ cls: 'advanced-search-match-item' });
				matchEl.createEl('span', { text: '...' + snippet.prefix });
				matchEl.createEl('span', { text: snippet.highlight, cls: 'advanced-search-highlight' });
				matchEl.createEl('span', { text: snippet.suffix + '...' });

				// 点击跳转
				matchEl.addEventListener('click', () => {
					const leaf = this.app.workspace.getLeaf(false); // 在当前活动叶子节点打开
					void leaf.openFile(result.file, { eState: { line: snippet.linesBefore } });
					// 用户要求点击后不默认关闭面板
					// this.close();
				});
			}

			if (result.totalMatches > result.snippets.length) {
				fileItem.createDiv({ text: t('modal.more-matches', { count: result.totalMatches - result.snippets.length }), cls: 'advanced-search-match-more' });
			}
		}
	}
	
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	/**
	 * 统一的排序逻辑，用于搜索结果和自定义范围的目录树
	 */
	private compareFiles(a: TAbstractFile, b: TAbstractFile): number {
		// 1. 自定义拖拽排序优先
		const customOrder = this.plugin.settings.customSortOrder || {};
		const orderA = customOrder[a.path];
		const orderB = customOrder[b.path];
		
		if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
		if (orderA !== undefined) return -1;
		if (orderB !== undefined) return 1;

		// 2. 智能章节排序 (自带文件夹优先判断)
		const chapterCompare = ChapterSorter.compareFiles(a, b);
		if (chapterCompare !== 0) {
			return chapterCompare;
		}

		// 3. 自然排序兜底
		return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
	}
}
