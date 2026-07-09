import { TFile, type WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Menu, setIcon } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';
import { CORKBOARD_STATUS_MAP, getCorkboardStatusText, getCorkboardStatusKeys } from '../i18n/data-keys';
import { t } from '../i18n';
import { TimelineManager } from '../services/TimelineManager';

export const CORKBOARD_VIEW_TYPE = 'webnovel-corkboard';

export class CorkboardView extends ItemView {
	private plugin: WebNovelAssistantPlugin;
	private currentBookPath: string | null = null;
	private isSavingMetadata: boolean = false;
	private sortMode: 'default' | 'timeline' = 'default';
	private collapsedGroups: Set<string> = new Set();
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
		this.sortMode = this.plugin.settings.corkboardSortMode || 'default';
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

		// 渲染顶部的多态 Toggle 切换按钮组
		const toggleGroup = this.container.createDiv('wn-corkboard-toggle-group');
		
		const btnDefault = toggleGroup.createEl('span', {
			text: t('corkboard.sort-default'),
			cls: `wn-corkboard-toggle-btn ${this.sortMode === 'default' ? 'active' : ''}`
		});

		toggleGroup.createSpan({ text: '|', cls: 'wn-corkboard-toggle-separator' });

		const btnTimeline = toggleGroup.createEl('span', {
			text: t('corkboard.sort-timeline'),
			cls: `wn-corkboard-toggle-btn ${this.sortMode === 'timeline' ? 'active' : ''}`
		});

		btnDefault.onclick = async () => {
			if (this.sortMode === 'default') return;
			this.sortMode = 'default';
			this.plugin.settings.corkboardSortMode = 'default';
			await this.plugin.saveSettings();
			void this.reloadBoard();
		};

		btnTimeline.onclick = async () => {
			if (this.sortMode === 'timeline') return;
			this.sortMode = 'timeline';
			this.plugin.settings.corkboardSortMode = 'timeline';
			await this.plugin.saveSettings();
			void this.reloadBoard();
		};

		if (this.sortMode === 'timeline') {
			await this.renderTimelineGroupedBoard(this.container, files);
		} else {
			this.renderOrderedBoard(this.container, files);
		}
	}

	private renderOrderedBoard(container: HTMLElement, files: TFile[]): void {
		const grid = container.createDiv('wn-corkboard-grid');
		for (const file of files) {
			this.renderCard(grid, file);
		}
	}

	private async renderTimelineGroupedBoard(container: HTMLElement, files: TFile[]): Promise<void> {
		const timelineManager = new TimelineManager(this.app, this.plugin, this.currentBookPath === '/' ? '' : (this.currentBookPath || ''));
		const entries = await timelineManager.loadEntries();

		const chapterToTimeMap = new Map<string, string>();
		const orderedTimes: string[] = []; // 保证时间线顺序

		if (entries) {
			for (const entry of entries) {
				orderedTimes.push(entry.time);
				for (const item of entry.items || []) {
					// chapter 可能有多个，逗号分隔
					const chaps = item.chapter.split(',').map(c => c.trim());
					for (const c of chaps) {
						if (c && !chapterToTimeMap.has(c)) {
							chapterToTimeMap.set(c, entry.time);
						}
					}
				}
			}
		}

		const groups: Record<string, TFile[]> = {};
		const unscheduled: TFile[] = [];

		for (const file of files) {
			const time = chapterToTimeMap.get(file.basename);
			if (time) {
				if (!groups[time]) groups[time] = [];
				groups[time].push(file);
			} else {
				unscheduled.push(file);
			}
		}

		// 渲染折叠组
		const renderGroup = (time: string, groupFiles: TFile[], isUnscheduled: boolean) => {
			if (groupFiles.length === 0) return;

			const groupContainer = container.createDiv('wn-corkboard-group');
			const groupHeader = groupContainer.createDiv('wn-corkboard-group-header');
			
			const iconEl = groupHeader.createSpan('wn-corkboard-group-icon');
			setIcon(iconEl, isUnscheduled ? 'help-circle' : 'calendar-clock');
			
			groupHeader.createSpan({ text: time, cls: 'wn-corkboard-group-title' });

			const groupGrid = groupContainer.createDiv('wn-corkboard-grid');

			// 处理折叠状态
			const isCollapsed = this.collapsedGroups.has(time);
			if (isCollapsed) {
				groupGrid.hide();
				groupHeader.addClass('collapsed');
			}

			groupHeader.onclick = () => {
				if (this.collapsedGroups.has(time)) {
					this.collapsedGroups.delete(time);
					groupGrid.show();
					groupHeader.removeClass('collapsed');
				} else {
					this.collapsedGroups.add(time);
					groupGrid.hide();
					groupHeader.addClass('collapsed');
				}
			};

			for (const file of groupFiles) {
				this.renderCard(groupGrid, file);
			}
		};

		// 保证时间线的顺序，同一个组只渲染一次
		const renderedTimes = new Set<string>();
		for (const time of orderedTimes) {
			if (groups[time] && !renderedTimes.has(time)) {
				renderedTimes.add(time);
				renderGroup(time, groups[time], false);
			}
		}

		// 渲染未安排
		if (unscheduled.length > 0) {
			renderGroup(t('corkboard.unscheduled-chapters'), unscheduled, true);
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

		const cardHeader = card.createDiv('wn-corkboard-card-header');
		const titleContainer = cardHeader.createDiv('wn-corkboard-card-title-container');

		const titleEl = titleContainer.createDiv('wn-corkboard-card-title');
		titleEl.setText(file.basename);

		const editIcon = titleContainer.createDiv('wn-corkboard-card-title-edit');
		setIcon(editIcon, 'pencil');

		titleEl.onclick = () => {
			// 点击标题打开文件
			void this.app.workspace.getLeaf(false).openFile(file);
		};

		const startEdit = () => {
			this.enableTitleEdit(titleContainer, titleEl, editIcon, file);
		};
		editIcon.onclick = startEdit;

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

	private enableTitleEdit(container: HTMLElement, titleEl: HTMLElement, editIcon: HTMLElement, file: TFile): void {
		// 如果已经在编辑中，避免重复创建
		if (container.querySelector('input')) return;

		titleEl.hide();
		editIcon.hide();

		const input = container.createEl('input', {
			type: 'text',
			cls: 'wn-corkboard-title-input'
		});
		input.value = file.basename;
		
		// 继承样式
		input.setCssProps({
			border: 'none',
			background: 'transparent',
			outline: 'none',
			fontWeight: '600',
			fontSize: '1.05em',
			color: 'var(--text-normal)',
			padding: '0',
			width: '100%',
			minWidth: '50px'
		});

		// 自动聚焦并全选
		input.focus();
		input.select();

		let isSaving = false;
		const saveChanges = async () => {
			if (isSaving) return;
			isSaving = true;
			const newTitle = input.value.trim();
			
			// 取消或者没改变
			if (!newTitle || newTitle === file.basename) {
				input.remove();
				titleEl.show();
				editIcon.show();
				return;
			}

			// 检查非法字符
			const illegalChars = /[\\/:*?"<>|]/g;
			if (illegalChars.test(newTitle)) {
				new Notice(t('corkboard.rename-failed'));
				input.remove();
				titleEl.show();
				editIcon.show();
				return;
			}

			const parentPath = file.parent?.path === '/' ? '' : (file.parent?.path || '');
			const targetPath = parentPath ? `${parentPath}/${newTitle}.md` : `${newTitle}.md`;

			// 检查是否存在同名文件
			const existFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (existFile) {
				new Notice(t('corkboard.rename-failed'));
				input.remove();
				titleEl.show();
				editIcon.show();
				return;
			}

			input.disabled = true; // 锁定状态，模拟 loading
			input.setCssProps({ opacity: '0.6', cursor: 'not-allowed' });

			try {
				this.isSavingMetadata = true;
				await this.app.fileManager.renameFile(file, targetPath);
				
				// 成功后更新 DOM
				titleEl.setText(newTitle);
				new Notice(t('corkboard.rename-success'));
			} catch (err) {
				console.error("[CorkboardView] rename failed:", err);
				new Notice(t('corkboard.rename-failed'));
			} finally {
				input.remove();
				titleEl.show();
				editIcon.show();
				// 延迟释放锁定，防止触发全局的 rename 事件刷新
				window.setTimeout(() => { this.isSavingMetadata = false; }, 500);
			}
		};

		// 失去焦点时保存
		input.onblur = () => {
			void saveChanges();
		};

		input.onkeydown = (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			}
			if (e.key === 'Escape') {
				input.value = file.basename;
				input.blur();
			}
		};
	}
}