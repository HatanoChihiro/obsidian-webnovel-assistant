import type { App, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { Modal, Setting, TFolder, TFile, Vault, MarkdownView } from 'obsidian';
import type { AccurateCountSettings } from '../types/settings';
import { ChapterSorter } from '../services/ChapterSorter';
import { t } from '../i18n';
import { findBookRoot, type FindBookRootPlugin } from '../utils/path';
import { getMarkdownBodyRange, smartLocateAndHighlight } from '../utils/leaf';
import { Logger } from '../utils/Logger';

export type AdvancedSearchSettings = Pick<
	AccurateCountSettings,
	'advancedSearchQuery' | 'customSortOrder' | 'workspaceFolders' | 'loreFolderName' | 'timeline' | 'foreshadowing' | 'novelInfo'
>;

export interface AdvancedSearchModalPlugin extends FindBookRootPlugin {
	settings: AdvancedSearchSettings;
	lastFilePath?: string;
	saveSettings(): Promise<void>;
	getVaultMarkdownFiles(): TFile[];
	getTrackedMarkdownFiles(includeLore?: boolean): TFile[];
}

export class AdvancedSearchModal extends Modal {
	plugin: AdvancedSearchModalPlugin;
	query: string = '';
	searchScope: 'global' | 'current' | 'custom' = 'current';
	selectedFolders: Set<string> = new Set();
	resultsContainer!: HTMLElement;
	customScopeContainer!: HTMLElement;
	
	constructor(app: App, plugin: AdvancedSearchModalPlugin, private sourceLeaf: WorkspaceLeaf | null = null) {
		super(app);
		this.plugin = plugin;
		this.query = this.plugin.settings.advancedSearchQuery || '';
	}

	onOpen() {
		this.containerEl.addClass('wn-corner-modal-container');
		this.modalEl.addClass('wn-corner-modal');
		this.modalEl.addClass('wn-advanced-search-modal');
		Logger.info('[WebNovel-Debug] 高级搜索模态窗已开启, 当前搜索词:', this.query);
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName(t('modal.advanced-search')).setHeading();

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
		new Setting(container).setName(t('modal.select-folders-hint')).setHeading();
		
		const items = this.getTopLevelItems();
		
		if (items.length === 0) {
			container.createEl('p', { text: t('modal.no-top-level-folders'), cls: 'setting-item-description' });
			return;
		}

		// 为每个目录创建一个树形选择器
		const listContainer = container.createDiv({ cls: 'advanced-search-folder-list' });

		for (const item of items) {
			if (item instanceof TFolder) {
				this.renderFolderTree(listContainer, item);
			} else if (item instanceof TFile) {
				this.renderFileTreeItem(listContainer, item);
			}
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
			childrenContainer.hidden = true;

			arrow.addEventListener('click', () => {
				if (!childrenContainer) return;
				const isHidden = childrenContainer.hidden;
				if (isHidden) {
					childrenContainer.hidden = false;
					arrow.innerText = '▼ ';
				} else {
					childrenContainer.hidden = true;
					arrow.innerText = '▶ ';
				}
			});
		} else {
			// 文件占位符，保持对齐
			headerEl.createSpan({ cls: 'advanced-search-tree-spacer' });
		}
		
		const displayName = folder.isRoot() ? '/' : folder.name;
		const label = headerEl.createSpan({ text: displayName, cls: 'advanced-search-tree-name' });
		if (folder instanceof TFolder) {
			label.addClass('advanced-search-folder-name');
		}
		
		const checkbox = headerEl.createEl('input');
		checkbox.type = 'checkbox';
		checkbox.dataset.path = folder.path;
		checkbox.addClass('advanced-search-checkbox');
		
		checkbox.addEventListener('change', () => {
			this.toggleSelection(folder, checkbox.checked);
		});
		
		if (childrenContainer) {
			for (const child of children) {
				if (child instanceof TFolder) {
					this.renderFolderTree(childrenContainer, child);
				} else if (child instanceof TFile) {
					// 渲染文件
					this.renderFileTreeItem(childrenContainer, child);
				}
			}
		}
	}

	private renderFileTreeItem(container: HTMLElement, file: TFile) {
		const fileItem = container.createDiv({ cls: 'advanced-search-tree-item' });
		const fileHeader = fileItem.createDiv({ cls: 'advanced-search-tree-header' });
		
		fileHeader.createSpan({ cls: 'advanced-search-tree-spacer' });
		
		const fileLabel = fileHeader.createSpan({ text: file.name, cls: 'advanced-search-tree-name' });
		fileLabel.addClass('advanced-search-file-name');
		
		const fileCheckbox = fileHeader.createEl('input');
		fileCheckbox.type = 'checkbox';
		fileCheckbox.dataset.path = file.path;
		fileCheckbox.addClass('advanced-search-checkbox');
		
		fileCheckbox.addEventListener('change', () => {
			this.toggleSelection(file, fileCheckbox.checked);
		});
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
				if (currentPath === '') break;
				this.selectedFolders.delete(currentPath);
			}
			this.selectedFolders.delete('/');
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

	private getTopLevelItems(): TAbstractFile[] {
		// 自定义范围应始终显示整个库的所有顶层文件夹和MD文件，让用户可以自由选择
		const rootItems: TAbstractFile[] = [];
		const root = this.app.vault.getRoot();
		
		for (const child of root.children) {
			if (child instanceof TFolder && !child.name.startsWith('.')) {
				rootItems.push(child);
			} else if (child instanceof TFile && child.extension === 'md' && !child.name.startsWith('.')) {
				rootItems.push(child);
			}
		}
		
		return rootItems;
	}

	private getSourceMarkdownView(): MarkdownView | null {
		const view = this.sourceLeaf?.view as (MarkdownView & { getViewType?: () => string }) | undefined;
		if (!view) return null;
		if (typeof view.getViewType === 'function' && view.getViewType() !== 'markdown') return null;
		return view.file ? view : null;
	}

	private getCurrentBookPath(): string | null {
		let activeView = this.getSourceMarkdownView();
		if (!activeView) {
			activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		}
		
		if (!activeView) {
			const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
			if (mdLeaves.length > 0) {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					activeView = mdLeaves.find(l => (l.view as MarkdownView).file?.path === activeFile.path)?.view as MarkdownView;
				}
				if (!activeView && this.plugin.lastFilePath) {
					activeView = mdLeaves.find(l => (l.view as MarkdownView).file?.path === this.plugin.lastFilePath)?.view as MarkdownView;
				}
				if (!activeView) {
					activeView = (mdLeaves.find(l => (l.view as MarkdownView).file) || mdLeaves[0])?.view as MarkdownView;
				}
			}
		}

		if (!activeView || !activeView.file) return null;
		
		const root = findBookRoot(this.app, this.plugin, activeView.file);
		return root || null;
	}

	private getSearchLeaf(): WorkspaceLeaf | null {
		if (this.sourceLeaf && this.getSourceMarkdownView()) return this.sourceLeaf;
		const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
		return markdownLeaves.find(leaf => leaf.active) || markdownLeaves[0] || this.app.workspace.getLeaf(false);
	}

	private openSearchResult(file: TFile, snippet: {
		linesBefore: number;
		highlight: string;
		matchStart: number;
		matchEnd: number;
		startLoc: { line: number; ch: number };
		endLoc: { line: number; ch: number };
		prefix?: string;
		suffix?: string;
		contextPrefix?: string;
		contextSuffix?: string;
		occurrenceIndex?: number;
	}): void {
		Logger.info('[WebNovel-Debug] 点击搜索结果项:', {
			file: file.path,
			highlight: snippet.highlight,
			linesBefore: snippet.linesBefore,
			matchStart: snippet.matchStart,
			matchEnd: snippet.matchEnd,
			startLoc: snippet.startLoc,
			endLoc: snippet.endLoc,
			prefix: snippet.prefix,
			suffix: snippet.suffix,
			occurrenceIndex: snippet.occurrenceIndex,
			contextPrefix: snippet.contextPrefix,
			contextSuffix: snippet.contextSuffix
		});
		const leaf = this.getSearchLeaf();
		void smartLocateAndHighlight(this.app, file, [snippet.highlight], {
			preferredLeaf: leaf || undefined,
			fallbackLine: snippet.linesBefore,
			matchStartGlobal: snippet.matchStart,
			exactMatchState: {
				targetLine: snippet.linesBefore,
				matchStartGlobal: snippet.matchStart,
				matchEndGlobal: snippet.matchEnd,
				matchStartLoc: snippet.startLoc,
				matchEndLoc: snippet.endLoc,
				matchText: snippet.highlight,
				contextPrefix: snippet.contextPrefix,
				contextSuffix: snippet.contextSuffix,
				occurrenceIndex: snippet.occurrenceIndex
			}
		});
	}

	private async executeSearch() {
		if (this.query !== this.plugin.settings.advancedSearchQuery) {
			this.plugin.settings.advancedSearchQuery = this.query;
			void this.plugin.saveSettings();
		}

		if (!this.query.trim()) {
			this.resultsContainer.empty();
			this.resultsContainer.createDiv({ text: t('modal.please-enter-keyword'), cls: 'advanced-search-empty' });
			return;
		}

		this.resultsContainer.empty();
		this.resultsContainer.createDiv({ text: t('modal.searching'), cls: 'advanced-search-loading' });

		// 1. 获取目标文件列表
		const allMarkdownFiles = this.plugin.getVaultMarkdownFiles();
		let targetFiles: TFile[] = [];

		if (this.searchScope === 'global') {
			targetFiles = allMarkdownFiles;
		} else if (this.searchScope === 'current') {
			const bookPath = this.getCurrentBookPath();
			if (bookPath && bookPath !== '/') {
				const bookFolder = this.app.vault.getAbstractFileByPath(bookPath);
				if (bookFolder instanceof TFolder) {
					const list: TFile[] = [];
					Vault.recurseChildren(bookFolder, (child: TAbstractFile) => {
						if (child instanceof TFile && child.extension === 'md') {
							list.push(child);
						}
					});
					targetFiles = list;
				} else {
					targetFiles = allMarkdownFiles.filter(f => f.path.startsWith(bookPath + '/'));
				}
			} else {
				targetFiles = this.plugin.getTrackedMarkdownFiles(); // fallback
			}
		} else if (this.searchScope === 'custom') {
			if (this.selectedFolders.size > 0) {
				const selectedArray = Array.from(this.selectedFolders);
				targetFiles = allMarkdownFiles.filter(f => selectedArray.some(path => path === '/' || f.path === path || f.path.startsWith(path + '/')));
			}
		}

		if (targetFiles.length === 0) {
			this.resultsContainer.empty();
			this.resultsContainer.createDiv({ text: t('modal.no-files-in-scope'), cls: 'advanced-search-empty' });
			return;
		}

		// 2. 对目标文件进行排序（按章节或自定义顺序），保证搜索结果是有序的
		targetFiles.sort((a, b) => this.compareFiles(a, b));

		// 3. 执行全量文本搜索（仅限正文，自动排除 YAML Frontmatter）
		const cleanQuery = this.query.trim();
		const escapedQuery = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const searchPattern = escapedQuery.replace(/\s+/g, '\\s+');
		const searchRegex = new RegExp(searchPattern, 'gi');

		const results: {
			file: TFile;
			snippets: {
				linesBefore: number;
				prefix: string;
				highlight: string;
				suffix: string;
				matchStart: number;
				matchEnd: number;
				startLoc: { line: number; ch: number };
				endLoc: { line: number; ch: number };
				contextPrefix: string;
				contextSuffix: string;
				occurrenceIndex: number;
			}[];
			totalMatches: number;
		}[] = [];

		for (let i = 0; i < targetFiles.length; i++) {
			const file = targetFiles[i];
			const rawContent = await this.app.vault.cachedRead(file);
			const content = rawContent.replace(/\r\n/g, '\n');
			const bodyRange = getMarkdownBodyRange(content);
			searchRegex.lastIndex = 0;

			const matchRanges: { start: number; end: number; text: string }[] = [];
			let execMatch: RegExpExecArray | null = null;

			while ((execMatch = searchRegex.exec(content)) !== null) {
				const start = execMatch.index;
				const text = execMatch[0];
				if (start >= bodyRange.startOffset) {
					matchRanges.push({ start, end: start + text.length, text });
				}
				if (text.length === 0) {
					searchRegex.lastIndex++;
				}
			}

			if (matchRanges.length > 0) {
				const snippets = matchRanges.map((m, occurrenceIdx) => {
					const snippetStart = Math.max(bodyRange.startOffset, m.start - 20);
					const snippetEnd = Math.min(content.length, m.end + 20);

					const prefix = content.substring(snippetStart, m.start).replace(/\n/g, ' ');
					const highlight = m.text.replace(/\n/g, ' ');
					const suffix = content.substring(m.end, snippetEnd).replace(/\n/g, ' ');

					const textBefore = content.substring(0, m.start);
					const linesBeforeList = textBefore.split(/\n/);
					const targetLine = linesBeforeList.length - 1;
					const startCh = linesBeforeList[linesBeforeList.length - 1].length;

					const matchLines = m.text.split(/\n/);
					const endLine = targetLine + matchLines.length - 1;
					const endCh = matchLines.length === 1 ? startCh + m.text.length : matchLines[matchLines.length - 1].length;

					const contextPrefixStart = Math.max(bodyRange.startOffset, m.start - 30);
					const contextPrefix = content.substring(contextPrefixStart, m.start).replace(/\n/g, ' ');
					const contextSuffix = content.substring(m.end, Math.min(content.length, m.end + 30)).replace(/\n/g, ' ');

					return {
						linesBefore: targetLine,
						prefix,
						highlight,
						suffix,
						matchStart: m.start,
						matchEnd: m.end,
						startLoc: { line: targetLine, ch: startCh },
						endLoc: { line: endLine, ch: endCh },
						contextPrefix,
						contextSuffix,
						occurrenceIndex: occurrenceIdx
					};
				});

				results.push({ file, snippets, totalMatches: matchRanges.length });
			}

			// 防卡死：每处理 50 个文件让出一次主线程
			if (i % 50 === 0) {
				const win = this.contentEl?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
				if (win) {
					await new Promise(resolve => win.setTimeout(resolve, 0));
				}
			}
		}

		// 3. 渲染结果
		this.renderSearchResults(results);
	}

	private renderSearchResults(results: { file: TFile, snippets: {linesBefore: number, prefix: string, highlight: string, suffix: string, matchStart: number, matchEnd: number, startLoc: { line: number; ch: number }, endLoc: { line: number; ch: number }}[], totalMatches: number }[]) {
		this.resultsContainer.empty();

		if (results.length === 0) {
			this.resultsContainer.createDiv({ text: t('modal.no-results'), cls: 'advanced-search-empty' });
			return;
		}

		this.resultsContainer.createDiv({
			text: t('modal.found-matching-files', { count: results.length }),
			cls: 'advanced-search-summary'
		});

		const listEl = this.resultsContainer.createDiv({ cls: 'advanced-search-results-list' });

		for (const result of results) {
			const fileItem = listEl.createDiv({ cls: 'advanced-search-file-item' });
			
			fileItem.createDiv({ text: `${result.file.basename} (${t('modal.matches-count', { count: result.totalMatches })})`, cls: 'advanced-search-file-title' });

			for (const snippet of result.snippets) {
				const matchEl = fileItem.createDiv({ cls: 'advanced-search-match-item' });
				matchEl.createSpan({ text: '...' + snippet.prefix });
				matchEl.createSpan({ text: snippet.highlight, cls: 'advanced-search-highlight' });
				matchEl.createSpan({ text: snippet.suffix + '...' });

				// 点击跳转
				matchEl.addEventListener('click', (e) => {
					e.stopPropagation();
					this.resultsContainer.querySelectorAll('.advanced-search-match-item.is-selected').forEach(el => el.classList.remove('is-selected'));
					matchEl.classList.add('is-selected');
					this.openSearchResult(result.file, snippet);
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
