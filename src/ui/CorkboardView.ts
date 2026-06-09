import type { WorkspaceLeaf, TFile} from 'obsidian';
import { ItemView, Notice, Menu } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';
import { WordCounter } from '../services/WordCounter';

export const CORKBOARD_VIEW_TYPE = 'webnovel-corkboard';

export class CorkboardView extends ItemView {
	private plugin: WebNovelAssistantPlugin;
	private currentBookPath: string | null = null;
	private isSavingMetadata: boolean = false;
	private container!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
		// 监听文件或元数据变化以刷新视图
		this.registerEvent(this.app.vault.on('rename', () => {
			if (this.isSavingMetadata) return;
			this.reloadBoard();
		}));
		this.registerEvent(this.app.vault.on('delete', () => {
			if (this.isSavingMetadata) return;
			this.reloadBoard();
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (this.isSavingMetadata) return;
			if (file instanceof TFile && !this.plugin.isFileInWorkspace(file)) return;
			this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
				this.reloadBoard();
			}, 1000);
		}));
		// 监听活动叶子节点变化，以便自动切换小说
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const newBookPath = this.plugin.characterManager.getBookPathForFile(activeFile);
				if (newBookPath && newBookPath !== this.currentBookPath) {
					this.currentBookPath = newBookPath;
					this.reloadBoard();
				}
			}
		}));
	}

	getViewType(): string {
		return CORKBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '章节一览';
	}

	getIcon(): string {
		return 'layout-grid';
	}

	async onOpen(): Promise<void> {
		this.container = this.contentEl;
		this.container.empty();
		this.container.addClass('wn-corkboard-container');

		// 确定当前所处的作品目录
		const activeFile = this.app.workspace.getActiveFile();
		this.currentBookPath = this.plugin.characterManager.getBookPathForFile(activeFile);

		await this.renderBoard();
	}

	async onClose(): Promise<void> {
		this.container.empty();
	}

	public async reloadBoard(): Promise<void> {
		if (!this.container) return;
		if (this.currentBookPath) {
			await this.renderBoard();
		} else {
			this.container.empty();
			const header = this.container.createDiv('wn-corkboard-header');
			header.createEl('h2', { text: '章节一览' });
			header.createEl('p', { 
				text: '请先打开某个作品的章节文件，以识别当前作品。',
				cls: 'wn-corkboard-hint'
			});
		}
	}

	private async renderBoard(): Promise<void> {
		this.container.empty();

		const header = this.container.createDiv('wn-corkboard-header');
		header.createEl('h2', { text: '章节一览' });
		
		if (!this.currentBookPath) {
			header.createEl('p', { 
				text: '请先打开某个作品的章节文件，以识别当前作品。',
				cls: 'wn-corkboard-hint'
			});
			return;
		}

		let displayBookName = 'Vault 根目录';
		if (this.currentBookPath && this.currentBookPath !== '/') {
			const parts = this.currentBookPath.split('/');
			displayBookName = parts[parts.length - 1];
		}

		header.createEl('p', { 
			text: `当前作品: ${displayBookName}`,
			cls: 'wn-corkboard-hint'
		});

		const grid = this.container.createDiv('wn-corkboard-grid');

		// 获取该作品下所有章节文件
		const files = this.app.vault.getMarkdownFiles().filter(file => {
			// 必须是章节文件
			if (!ChapterSorter.isChapterFile(file.name)) {
				return false;
			}
			// 排除设定文件夹
			const lorePath = this.plugin.settings.loreFolderName || '设定';
			if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
				return false;
			}
			if (this.currentBookPath === '/') return true;
			return file.path.startsWith(this.currentBookPath + '/');
		});

		if (this.plugin.settings.enableSmartChapterSort) {
			files.sort((a, b) => ChapterSorter.compareFiles(a, b));
		} else {
			files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
		}

		for (const file of files) {
			this.renderCard(grid, file);
		}
	}

	private renderCard(grid: HTMLElement, file: TFile): void {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		// 优先取 synopsis，其次取 摘要
		const synopsis = (frontmatter?.synopsis || frontmatter?.['摘要'] || '') as string;
		// 状态
		const status = (frontmatter?.status || frontmatter?.['状态'] || '待写') as string;

		const card = grid.createDiv('wn-corkboard-card');
		
		// 头部：标题与状态
		const cardHeader = card.createDiv('wn-corkboard-card-header');
		const titleEl = cardHeader.createDiv('wn-corkboard-card-title');
		titleEl.setText(file.basename);
		titleEl.onclick = () => {
			// 点击标题打开文件
			this.app.workspace.getLeaf(false).openFile(file);
		};

		const statusEl = cardHeader.createDiv('wn-corkboard-card-status');
		statusEl.setText(status);
		statusEl.setCssStyles({ cursor: 'pointer' });
		statusEl.title = '点击切换状态';

		statusEl.onclick = (evt: MouseEvent) => {
			const menu = new Menu();
			const states = ['待写', '大纲', '草稿', '修稿中', '已完稿'];
			for (const s of states) {
				menu.addItem((item) => {
					item.setTitle(s)
						.setChecked(s === status)
						.onClick(async () => {
							try {
								this.isSavingMetadata = true;
								await this.app.fileManager.processFrontMatter(file, (fm) => {
									fm['status'] = s;
								});
								statusEl.setText(s);
								new Notice(`状态已更新：${s}`);
							} catch (err) {
								console.error(err);
								new Notice('状态更新失败');
							} finally {
								activeWindow.setTimeout(() => { this.isSavingMetadata = false; }, 500);
							}
						});
				});
			}
			menu.showAtMouseEvent(evt);
		};

		// 内容区：大纲摘要（点击编辑）
		const contentEl = card.createDiv('wn-corkboard-card-content');
		const textEl = contentEl.createDiv('wn-corkboard-card-text');
		
		if (synopsis.trim() === '') {
			textEl.setText('点击添加章节摘要...');
			textEl.addClass('is-empty');
		} else {
			textEl.setText(synopsis);
		}

		// 悬停或者点击时变成 textarea
		contentEl.onclick = () => {
			this.enableInlineEdit(contentEl, textEl, file);
		};

		// 底部：字数等元数据
		const footerEl = card.createDiv('wn-corkboard-card-footer');
		// 获取精准字数统计
		const cachedCount = this.plugin.cacheManager.getFileCache(file.path);
		if (cachedCount !== null && cachedCount > 0) {
			footerEl.setText(`${cachedCount} 字`);
		} else {
			footerEl.setText(`...`);
			this.app.vault.cachedRead(file).then(content => {
				if (!footerEl.isConnected) return;
				const count = this.plugin.calculateAccurateWords(content);
				footerEl.setText(`${count} 字`);
			});
		}
	}

	private enableInlineEdit(container: HTMLElement, textEl: HTMLElement, file: TFile): void {
		// 如果已经在编辑中，避免重复创建
		if (container.querySelector('textarea')) return;

		textEl.setCssStyles({ display: 'none' });

		const textarea = container.createEl('textarea', {
			cls: 'wn-corkboard-textarea'
		});
		const currentSynopsis = textEl.hasClass('is-empty') ? '' : textEl.innerText;
		textarea.value = currentSynopsis;
		
		// 自动聚焦并选中末尾
		textarea.focus();
		textarea.setSelectionRange(currentSynopsis.length, currentSynopsis.length);

		// 自适应高度
		textarea.setCssStyles({ height: 'auto' });
		textarea.setCssStyles({ height: textarea.scrollHeight + 'px' });
		textarea.oninput = () => {
			textarea.setCssStyles({ height: 'auto' });
			textarea.setCssStyles({ height: textarea.scrollHeight + 'px' });
		};

		let isSaving = false;
		const saveChanges = async () => {
			if (isSaving) return;
			isSaving = true;
			const newValue = textarea.value.trim();
			if (newValue !== currentSynopsis) {
				textEl.setText(newValue || '点击添加章节摘要...');
				textEl.toggleClass('is-empty', newValue === '');
				
				// 保存到 Markdown 属性中
				try {
					this.isSavingMetadata = true;
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						// 默认使用 synopsis 字段
						fm['synopsis'] = newValue;
					});
					new Notice(`已保存摘要：${file.basename}`);
				} catch (err) {
					console.error(err);
					new Notice('保存摘要失败，请检查文件状态');
				} finally {
					activeWindow.setTimeout(() => { this.isSavingMetadata = false; }, 500);
				}
			}
			
			textarea.remove();
			textEl.setCssStyles({ display: 'block' });
		};

		// 失去焦点时保存
		textarea.onblur = () => {
			saveChanges();
		};

		// 按 Ctrl+Enter 或者直接在空旷处点击也可以保存
		textarea.onkeydown = (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				textarea.blur(); // 触发 onblur 保存
			}
			if (e.key === 'Escape') {
				// 取消修改
				textarea.value = currentSynopsis;
				textarea.blur();
			}
		};
	}
}
