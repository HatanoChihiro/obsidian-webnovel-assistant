import { TFile, type WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Menu } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';
import { CORKBOARD_STATUS_MAP, getCorkboardStatusText, getCorkboardStatusKeys } from '../i18n/data-keys';
import { t } from '../i18n';

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
			void this.reloadBoard();
		}));
		this.registerEvent(this.app.vault.on('delete', () => {
			if (this.isSavingMetadata) return;
			void this.reloadBoard();
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (this.isSavingMetadata) return;
			if (file instanceof TFile && !this.plugin.isFileInWorkspace(file)) return;
			this.plugin.adaptiveDebounceManager.debounceFixed('corkboard-refresh', () => {
				void this.reloadBoard();
			}, 1000);
		}));
		// 监听活动叶子节点变化，以便自动切换小说
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const newBookPath = this.plugin.characterManager.getBookPathForFile(activeFile);
				if (newBookPath && newBookPath !== this.currentBookPath) {
					this.currentBookPath = newBookPath;
					void this.reloadBoard();
				}
			}
		}));
	}

	getViewType(): string {
		return CORKBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('view.corkboard');
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
			header.createDiv({ text: t('view.corkboard'), cls: 'wn-corkboard-title' });
			header.createEl('p', {
				text: t('corkboard.please-open-file'),
				cls: 'wn-corkboard-hint'
			});
		}
	}

	private async renderBoard(): Promise<void> {
		this.container.empty();

		const header = this.container.createDiv('wn-corkboard-header');
		header.createDiv({ text: t('view.corkboard'), cls: 'wn-corkboard-title' });

		if (!this.currentBookPath) {
			header.createEl('p', {
				text: t('corkboard.please-open-file'),
				cls: 'wn-corkboard-hint'
			});
			return;
		}

		let displayBookName = t('corkboard.vault-root');
		if (this.currentBookPath && this.currentBookPath !== '/') {
			const parts = this.currentBookPath.split('/');
			displayBookName = parts[parts.length - 1];
		}

		header.createEl('p', {
			text: t('corkboard.current-novel', { name: displayBookName }),
			cls: 'wn-corkboard-hint'
		});

		const grid = this.container.createDiv('wn-corkboard-grid');

		// 获取该作品下所有章节文件
		const files = this.plugin.getTrackedMarkdownFiles().filter(file => {
			// 只有在开启严格章节模式时，才强制要求必须是章节命名格式
			if (this.plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
				return false;
			}
			// 排除设定文件夹
			const lorePath = this.plugin.settings.loreFolderName || t('common.default-lore-folder-name');
			if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
				return false;
			}
			if (this.currentBookPath === '/') return true;
			return file.path.startsWith(this.currentBookPath + '/');
		});

		if (this.plugin.settings.enableSmartChapterSort) {
			const customOrder = this.plugin.settings.customSortOrder || {};
			files.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, customOrder));
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
		// 优先取 synopsis，其次取 摘要，再取首字母大写的版本
		const synopsis = (frontmatter?.synopsis || frontmatter?.Synopsis || frontmatter?.['摘要'] || '') as string;
		// 状态（通过映射表解析中文旧值与英文新值，向后兼容，包括首字母大写）
		const rawStatus = (frontmatter?.status || frontmatter?.Status || frontmatter?.['状态'] || 'unwritten') as string;
		let status = CORKBOARD_STATUS_MAP[rawStatus] ?? rawStatus;

		const card = grid.createDiv('wn-corkboard-card');

		// 头部：标题与状态
		const cardHeader = card.createDiv('wn-corkboard-card-header');
		const titleEl = cardHeader.createDiv('wn-corkboard-card-title');
		titleEl.setText(file.basename);
		titleEl.onclick = () => {
			// 点击标题打开文件
			void this.app.workspace.getLeaf(false).openFile(file);
		};

		const statusEl = cardHeader.createDiv('wn-corkboard-card-status');
		statusEl.setText(getCorkboardStatusText(status));
		statusEl.setCssProps({ cursor: 'pointer' });
		statusEl.title = t('corkboard.click-to-change-status');

		statusEl.onclick = (evt: MouseEvent) => {
			const menu = new Menu();
			const statusKeys = getCorkboardStatusKeys();
			for (const s of statusKeys) {
				menu.addItem((item) => {
					item.setTitle(getCorkboardStatusText(s))
						.setChecked(s === status)
						.onClick(async () => {
							try {
								this.isSavingMetadata = true;
								await this.app.fileManager.processFrontMatter(file, (fm) => {
									(fm as Record<string, unknown>)['status'] = getCorkboardStatusText(s);
								});
								status = s;
								statusEl.setText(getCorkboardStatusText(s));
								new Notice(t('corkboard.status-updated', { status: getCorkboardStatusText(s) }));
							} catch (err) {
								console.error(err);
								new Notice(t('corkboard.status-update-failed'));
							} finally {
								window.setTimeout(() => { this.isSavingMetadata = false; }, 500);
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
			textEl.setText(t('common.click-add-synopsis'));
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
			footerEl.setText(`${cachedCount}${t('common.word-char')}`);
		} else {
			footerEl.setText(`...`);
			void this.app.vault.cachedRead(file).then(content => {
				if (!footerEl.isConnected) return;
				const count = this.plugin.calculateAccurateWords(content);
				footerEl.setText(`${count}${t('common.word-char')}`);
			}).catch(err => console.error("[CorkboardView] cachedRead failed:", err));
		}
	}

	private enableInlineEdit(container: HTMLElement, textEl: HTMLElement, file: TFile): void {
		// 如果已经在编辑中，避免重复创建
		if (container.querySelector('textarea')) return;

		textEl.hide();

		const textarea = container.createEl('textarea', {
			cls: 'wn-corkboard-textarea'
		});
		const currentSynopsis = textEl.hasClass('is-empty') ? '' : textEl.innerText;
		textarea.value = currentSynopsis;

		// 自动聚焦并选中末尾
		textarea.focus();
		textarea.setSelectionRange(currentSynopsis.length, currentSynopsis.length);

		// 自适应高度
		textarea.setCssProps({ height: 'auto' });
		textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
		textarea.oninput = () => {
			textarea.setCssProps({ height: 'auto' });
			textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
		};

		let isSaving = false;
		const saveChanges = async () => {
			if (isSaving) return;
			isSaving = true;
			const newValue = textarea.value.trim();
			if (newValue !== currentSynopsis) {
				textEl.setText(newValue || t('common.click-add-synopsis'));
				textEl.toggleClass('is-empty', newValue === '');

				// 保存到 Markdown 属性中
				try {
					this.isSavingMetadata = true;
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						// 默认使用 synopsis 字段
						(fm as Record<string, unknown>)['synopsis'] = newValue;
					});
					new Notice(t('common.synopsis-saved', { name: file.basename }));
				} catch (err) {
					console.error(err);
					new Notice(t('corkboard.synopsis-save-failed'));
				} finally {
					window.setTimeout(() => { this.isSavingMetadata = false; }, 500);
				}
			}

			textarea.remove();
			textEl.show();
		};

		// 失去焦点时保存
		textarea.onblur = () => {
			void saveChanges();
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