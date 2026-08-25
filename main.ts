import type { App, PluginManifest } from 'obsidian';
import { Plugin, TFile, TFolder, Notice, MarkdownView, MarkdownRenderChild, type MarkdownPostProcessorContext, Vault, type TAbstractFile } from 'obsidian';
import type { AccurateCountSettings } from './src/types/settings';
import type { WebNovelAssistantPlugin } from './src/types/plugin';
import { isDesktop } from './src/utils';
import { getDefaultFileNameCandidates, type DefaultFileNameKey } from './src/i18n/data-keys';
import type { CacheManager } from './src/services/CacheManager';
import type { AdaptiveDebounceManager } from './src/services/AdaptiveDebounceManager';
import type { SettingsManager } from './src/core/SettingsManager';
import type { HistoryDataManager } from './src/services/HistoryDataManager';
import type { FileExplorerPatcher } from './src/services/FileExplorerPatcher';
import type { WordCounter } from './src/services/WordCounter';
import type { EditorTracker } from './src/services/EditorTracker';
import type { StyleManager } from './src/services/StyleManager';
import { AccurateCountSettingTab } from './src/ui/SettingsTab';
import { FloatingStickyNote } from './src/ui/StickyNote';
import { WritingStatusView, STATUS_VIEW_TYPE } from './src/ui/StatusView';
import { FORESHADOWING_VIEW_TYPE } from './src/ui/ForeshadowingView';
import { TIMELINE_VIEW_TYPE } from './src/ui/TimelineView';
import type { MobileFloatingStats } from './src/ui/MobileFloatingStats';
import { AddLoreModal } from './src/ui/AddLoreModal';
import type { ObsOverlayServer } from './src/services/ObsServer';
import type { ForeshadowingManager } from './src/services/ForeshadowingManager';
import { Logger } from './src/utils/Logger';

import type { TaskManager } from './src/services/TaskManager';
import type { TimelineManager } from './src/services/TimelineManager';
import type { RelationGraphManager } from './src/services/RelationGraphManager';
import { ObsHtmlBuilder } from './src/services/ObsHtmlBuilder';
import type { ImmersiveModeManager } from './src/ui/ImmersiveModeManager';
import type { HomepageManager } from './src/services/HomepageManager';
import type { StatisticsManager } from './src/services/StatisticsManager';
import type { StickyNoteDataManager } from './src/services/StickyNoteDataManager';
import type { TypographyManager } from './src/services/TypographyManager';
import type { ChapterMergeManager } from './src/services/ChapterMergeManager';
import type { ProofreadingManager } from './src/services/ProofreadingManager';

import type { CommandManager } from './src/core/CommandManager';
import type { ViewManager } from './src/core/ViewManager';
import type { MenuManager } from './src/core/MenuManager';
import { selectionCountTooltipExtension } from './src/editor/SelectionCountTooltip';
import type { Extension } from '@codemirror/state';
import { createWordCountGutter, forceWordCountGutterUpdate } from './src/editor/WordCountGutter';
import type { WorkerManager } from './src/services/WorkerManager';
import type { MarkdownPostProcessor } from './src/services/MarkdownPostProcessor';
import type { FileEventManager } from './src/services/FileEventManager';
import { HomepageRenderer } from './src/ui/components/HomepageRenderer';
import type { CharacterManager } from './src/services/CharacterManager';
import { t } from './src/i18n';

import { buildCharacterHoverExtension } from './src/editor/CharacterHoverExtension';
import { createTypewriterExtension } from './src/editor/TypewriterExtension';
import { buildProofreadingExtension } from './src/editor/ProofreadingExtension';
import { AnnotateDictModal } from './src/ui/AnnotateDictModal';
import { isSelectionEligibleForAnnotate } from './src/utils/proofreadingHelpers';
import type { LoreSyncService } from './src/services/LoreSyncService';
import { ServiceRegistry } from './src/core/ServiceRegistry';
import { PluginBootstrapper } from './src/core/PluginBootstrapper';

export default class AccurateChineseCountPlugin extends Plugin implements WebNovelAssistantPlugin {
	public wordCountExtensionHolder: Extension[] = [];


	settings!: AccurateCountSettings;
	statusBarItemEl!: HTMLElement;

	isTracking: boolean = false;
	focusMs: number = 0;
	slackMs: number = 0;
	lastTickTime: number = 0;

	sessionAddedWords: number = 0;
	lastFileWords: number = 0;
	lastFilePath: string = '';
	lastTaskFolder: string = '';

	lastEditTime: number = Date.now();
	suspendTime: number = 0;
	isUnloading: boolean = false;
	private _loreCandidatesCache: Set<string> | null = null;

	
	get activeNotes(): FloatingStickyNote[] {
		return this.stickyNoteManager.activeNotes;
	}
	set activeNotes(val: FloatingStickyNote[]) {
		this.stickyNoteManager.activeNotes = val;
	}

	obsServer: ObsOverlayServer | null = null;
	mobileFloatingStats: MobileFloatingStats | null = null;
	obsHtmlBuilder: ObsHtmlBuilder;

	private bootstrapper: PluginBootstrapper;

	// 服务注册中心
	public services: ServiceRegistry;

	// 服务管理器（通过 ServiceRegistry 获取）
	get cacheManager(): CacheManager { return this.services.get('CacheManager'); }
	get adaptiveDebounceManager(): AdaptiveDebounceManager { return this.services.get('AdaptiveDebounceManager'); }
	get settingsManager(): SettingsManager { return this.services.get('SettingsManager'); }
	get historyManager(): HistoryDataManager { return this.services.get('HistoryDataManager'); }
	get fileExplorerPatcher(): FileExplorerPatcher { return this.services.get('FileExplorerPatcher'); }
	get foreshadowingManager(): ForeshadowingManager { return this.services.get('ForeshadowingManager'); }
	get taskManager(): TaskManager { return this.services.get('TaskManager'); }
	get workerManager(): WorkerManager { return this.services.get('WorkerManager'); }
	get markdownPostProcessor(): MarkdownPostProcessor { return this.services.get('MarkdownPostProcessor'); }
	get wordCounter(): WordCounter { return this.services.get('WordCounter'); }
	get editorTracker(): EditorTracker { return this.services.get('EditorTracker'); }
	get fileEventManager(): FileEventManager { return this.services.get('FileEventManager'); }
	get statisticsManager(): StatisticsManager { return this.services.get('StatisticsManager'); }
	get styleManager(): StyleManager | undefined { return this.services.getOptional('StyleManager'); }
	get stickyNoteManager(): StickyNoteDataManager { return this.services.get('StickyNoteDataManager'); }
	get immersiveModeManager(): ImmersiveModeManager { return this.services.get('ImmersiveModeManager'); }
	get homepageManager(): HomepageManager { return this.services.get('HomepageManager'); }
	get commandManager(): CommandManager { return this.services.get('CommandManager'); }
	get viewManager(): ViewManager { return this.services.get('ViewManager'); }
	get menuManager(): MenuManager { return this.services.get('MenuManager'); }
	get loreSyncService(): LoreSyncService { return this.services.get('LoreSyncService'); }
	get characterManager(): CharacterManager { return this.services.get('CharacterManager'); }
	get timelineManager(): TimelineManager { return this.services.get('TimelineManager'); }
	get relationGraphManager(): RelationGraphManager { return this.services.get('RelationGraphManager'); }
	get typographyManager(): TypographyManager { return this.services.get('TypographyManager'); }
	get chapterMergeManager(): ChapterMergeManager { return this.services.get('ChapterMergeManager'); }
	get proofreadingManager(): ProofreadingManager { return this.services.get('ProofreadingManager'); }

	isLayoutReady: boolean = false;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		
		Logger.initialize(this);
		
		this.services = new ServiceRegistry();
		this.bootstrapper = new PluginBootstrapper(this, this.services);
		this.bootstrapper.registerConstructorServices();

		this.obsHtmlBuilder = new ObsHtmlBuilder(this);
		// editorTracker 和 styleManager 需要在 onload 后初始化（依赖 this）
	}

	async onload() {
		await this.bootstrapper.bootstrap();
	}

	// 专注计时逻辑
	/**
	 * 开始专注计时
	 */
	public startTracking() {
		if (this.isTracking) return;

		this.isTracking = true;
		this.lastTickTime = Date.now();
		this.lastEditTime = Date.now(); // 立即激活输入状态，避免一开始就被算作摸鱼

		this.workerManager.postMessage('start');
		this.editorTracker.updateWordCount();
		this.refreshStatusViews();
		new Notice(t('notice.tracking-started'));
	}

	/**
	 * 停止专注计时
	 */
	public stopTracking() {
		if (!this.isTracking) return;
		this.isTracking = false;
		this.workerManager.postMessage('stop');
		this.editorTracker.updateWordCount();
		this.refreshStatusViews();
		new Notice(t('notice.tracking-stopped'));
	}


	public setupHomepage(): void {
		// 创作主页动态渲染：6 个 Obsidian 专用代码块处理器
		const renderer = new HomepageRenderer(this.app, this);

		if (this.settings.enableHomepage) {
			this.app.workspace.onLayoutReady(async () => {


				try {
					await this.homepageManager.ensureHomepageExists();

					// 如果开启了启动时自动打开主页
					if (this.settings.openHomepageOnStartup) {
						const homepagePath = this.homepageManager?.getHomepageFilePath();
						if (homepagePath) {
							const file = this.app.vault.getAbstractFileByPath(homepagePath);
							if (file instanceof TFile) {
								const leaves = this.app.workspace.getLeavesOfType('markdown');
								const isAlreadyOpen = leaves.some(leaf => {
									const view = leaf.view;
									return view instanceof MarkdownView && view.file?.path === homepagePath;
								});
								if (!isAlreadyOpen) {
									const leaf = this.app.workspace.getLeaf(true); // 强制在新标签页打开主页
									if (leaf) {
										await leaf.openFile(file);
										this.app.workspace.setActiveLeaf(leaf, { focus: true });
									}
								}
							}
						}
					}
				} catch (err) {
					console.error('[Plugin] 创作主页初始化失败:', err);
				}
			});
		} else {
			this.homepageManager.deleteHomepage().catch(err =>
				console.error('[Plugin] 创作主页文件删除失败:', err)
			);
		}

		const isHomepage = (ctx: MarkdownPostProcessorContext): boolean => {
			const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (!(file instanceof TFile)) return false;
			const cache = this.app.metadataCache.getFileCache(file);
			return !!cache?.frontmatter?.homepage;
		};

		this.registerMarkdownCodeBlockProcessor('webnovel-homepage', async (source, el, ctx) => {
			if (!isHomepage(ctx)) return;

			const component = new MarkdownRenderChild(el);
			ctx.addChild(component);

			component.onload = () => {
				el.classList.add('webnovel-homepage-root');
				const leafContent = el.closest('.workspace-leaf-content');
				if (leafContent) leafContent.classList.add('is-webnovel-homepage');
			};

			component.onunload = () => {
				const leafContent = el.closest('.workspace-leaf-content');
				if (leafContent) leafContent.classList.remove('is-webnovel-homepage');
				const VIEW_OBS_KEY = '__webnovel_homepage_resize_obs__';
				const viewDom = el.closest('.markdown-source-view') || el.closest('.markdown-preview-view');
				if (viewDom) {
					const anyView = viewDom as unknown as Record<string, ResizeObserver | undefined>;
					if (anyView[VIEW_OBS_KEY]) {
						anyView[VIEW_OBS_KEY].disconnect();
						delete anyView[VIEW_OBS_KEY];
					}
				}
			};

			await renderer.renderHomepage(el);
		});

	}


	/**
	 * 从独立文件加载便签数据，并在桌面端显示浮动便签
	 */
	public async loadFloatingNotes() {
		// 所有平台都需要先加载便签数据，移动端/平板端由侧面板使用这些数据。
		const notes = await this.stickyNoteManager.loadNotes();

		// 仅在桌面端创建浮动便签，移动端/平板端不渲染悬浮便签。
		if (!isDesktop()) return;

		// 清除可能残留的便签 DOM（如插件上次未正常卸载）
		activeDocument.body.querySelectorAll('.my-floating-sticky-note').forEach(el => el.remove());
		this.app.workspace.containerEl?.querySelectorAll('.my-floating-sticky-note').forEach(el => el.remove());
		this.activeNotes = [];

		for (const noteState of notes) {
			// 避免重复加载
			if (this.activeNotes.some(n => n.state.id === noteState.id)) continue;

			const newNote = new FloatingStickyNote(this.app, this, { state: noteState });
			newNote.load();
		}
	}


	/**
	 * 将所有活跃悬浮便签的当前内容强制同步到管理器
	 * 通常在切换工作区（如进入沉浸模式）或插件卸载前调用
	 */
	

	/**
	 * 同步沉浸模式产生的便签变更到桌面悬浮便签
	 */
	

	/**
	 * 创建便签（处理沉浸模式同步）
	 */
	public async createStickyNote(options: { file?: TFile, content?: string, title?: string }) {
		// 如果在移动端调用（如通过命令），由于交互限制，仅给予提示或在沉浸模式中处理
		if (!isDesktop()) {
			// 在沉浸模式中创建是允许的，因为它会渲染到辅助面板视图中
			if (!activeDocument.body.classList.contains('immersive-mode-active')) {
				new Notice(t('notice.floating-notes-desktop-only'));
				return;
			}
		}

		const note = new FloatingStickyNote(this.app, this, options);
		note.load();

		// 如果处于沉浸模式，立即刷新便签列表视图
		if (activeDocument.body.classList.contains('immersive-mode-active')) {
			// 给一点额外时间让设置/文件持久化完成
			const timer = window.setTimeout(() => {
				this.stickyNoteManager?.refreshImmersiveNotes();
			}, 200);
			this.register(() => window.clearTimeout(timer));
		}
	}
	

	/**
	 * 监听全局 Modal / 设置面板弹窗
	 * 当存在 modal-container 时动态挂载 webnovel-modal-active 样式类，隐藏悬浮组件
	 */
	public setupModalObserver(): void {
		const mainDoc = this.app.workspace.containerEl?.ownerDocument || activeDocument;
		const updateModalState = () => {
			const hasModal = !!(
				mainDoc.body.querySelector('.modal-container, .modal.mod-settings, .vertical-tabs-container, .modal-bg') ||
				mainDoc.body.classList.contains('is-popout-modal')
			);
			if (hasModal) {
				mainDoc.body.classList.add('webnovel-modal-active');
			} else {
				mainDoc.body.classList.remove('webnovel-modal-active');
			}
		};

		updateModalState();

		const observer = new MutationObserver(() => {
			updateModalState();
		});

		observer.observe(mainDoc.body, { childList: true, subtree: true });
		this.register(() => {
			observer.disconnect();
			mainDoc.body.classList.remove('webnovel-modal-active');
		});
	}

	/**
	 * 切换所有悬浮便签的显示/隐藏状态
	 */
	public async toggleFloatingNotesVisibility() {
		this.settings.showFloatingNotes = !this.settings.showFloatingNotes;
		await this.saveSettings();
		if (this.settings.showFloatingNotes) {
			activeDocument.body.classList.remove('webnovel-notes-hidden');
			new Notice(t('notice.floating-notes-shown'));
		} else {
			activeDocument.body.classList.add('webnovel-notes-hidden');
			new Notice(t('notice.floating-notes-hidden'));
		}
	}

	/**
	 * 刷新所有沉浸模式便签列表视图
	 */
	


	public registerCommonRibbonIcons(): void {
		this.addRibbonIcon('bar-chart-2', t('command.toggle-status-view'), () => {
			void this.toggleStatusView();
		});
		this.addRibbonIcon('bookmark', t('command.toggle-foreshadowing-view'), () => {
			void this.toggleForeshadowingView();
		});
		this.addRibbonIcon('calendar-clock', t('command.toggle-timeline-view'), () => {
			void this.toggleTimelineView();
		});
		this.addRibbonIcon('laptop', t('command.toggle-workbench-view'), () => {
			void this.toggleWorkbenchView();
		});

		if (isDesktop()) {
			this.addRibbonIcon('expand', t('command.toggle-immersive-mode'), () => {
				void this.immersiveModeManager.toggleImmersiveMode();
			});
		}
	}

	public registerSettingsTab(): void {
		this.addSettingTab(new AccurateCountSettingTab(this.app, this));
	}

	public registerWordCountGutter(): void {
		if (isDesktop() && this.settings.enableWordCountGutter) {
			this.wordCountExtensionHolder.push(createWordCountGutter(this));
		}
		this.registerEditorExtension(this.wordCountExtensionHolder);

		this.registerEvent(this.app.workspace.on('webnovel:word-count-gutter-settings-changed', () => {
			this.wordCountExtensionHolder.length = 0;
			if (isDesktop() && this.settings.enableWordCountGutter) {
				this.wordCountExtensionHolder.push(createWordCountGutter(this));
			}
			this.app.workspace.updateOptions();

			this.app.workspace.iterateAllLeaves(leaf => {
				if (leaf.view.getViewType() === 'markdown') {
					const view = leaf.view as MarkdownView;
					const editor = view.editor;
					if (editor && editor.cm) {
						editor.cm.dispatch({ effects: forceWordCountGutterUpdate.of(null) });
					}
				}
			});
		}));
	}

	public registerEditorExtensions(): void {
		this.registerEditorExtension(buildCharacterHoverExtension(this.app, this));
		this.registerEditorExtension(selectionCountTooltipExtension(this));
		this.registerEditorExtension(createTypewriterExtension(this));
		this.registerEditorExtension(buildProofreadingExtension(this.app, this));
	}

	public registerEditorContextMenu(): void {
		if (isDesktop()) {
			this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const selection = editor.getSelection();
				if (selection && selection.length > 0 && selection.length < 50) {
					menu.addItem((item) => {
						item.setTitle(t('menu.add-as-new-lore'))
							.setIcon('book-plus')
							.setSection('webnovel-assistant')
							.onClick(() => {
								const bookPath = this.characterManager.getBookPathForFile(view.file);
								if (bookPath) {
									new AddLoreModal(this.app, this, selection.trim(), bookPath).open();
								} else {
									new Notice(t('notice.add-to-lore-failed'));
								}
							});
					});
				}

				if (
					view.file &&
					isSelectionEligibleForAnnotate(
						selection,
						view.file,
						(p) => this.proofreadingManager?.isFileInsideDictionary(p) ?? false
					)
				) {
					menu.addItem((item) => {
						item.setTitle(t('menu.mark-as-dict'))
							.setIcon('spell-check')
							.setSection('webnovel-assistant')
							.onClick(async () => {
								if (!this.proofreadingManager) return;
								try {
									await this.proofreadingManager.prepareDictionaryForEditing();
									new AnnotateDictModal(this.app, this, selection.trim()).open();
								} catch {
									new Notice(t('notice.proofreading-prepare-failed'));
								}
							});
					});
				}
			}));
		}
	}

	onunload(): void {
		void this.bootstrapper.shutdown();
	}

	/**
	 * 构建文件浏览器缓存
	 */

	/**
	 * R22: 替代全局 getMarkdownFiles() 的按需遍历方法
	 * 优先在指定的 workspaceFolders 范围内递归获取 markdown 文件，以减少大型 vault 扫描消耗。
	 * [BUGFIX] 统一使用 workspaceFolders（主字段），与 CacheManager.isFileInWorkspace 保持一致。
	/**
	 * 高性能递归获取 Vault 中所有 Markdown 文件（替代原生的 app.vault.getMarkdownFiles 以规避审查警告并提速）
	 */
	getVaultMarkdownFiles(): TFile[] {
		const root = this.app.vault.getRoot();
		const files: TFile[] = [];
		Vault.recurseChildren(root, (file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === 'md') {
				files.push(file);
			}
		});
		return files;
	}

	/**
	 * 获取当前工作区跟踪的所有 Markdown 文件
	 * @param includeLore 是否包含设定/Lore 文件夹内的文件（默认 false，供字数统计与章节列表使用；为 true 时供 CharacterManager 设定解析使用）
	 */
	getTrackedMarkdownFiles(includeLore: boolean = false): TFile[] {
		const workspaceFolders = this.settings.workspaceFolders || [];
		if (workspaceFolders.length === 0) {
			const allFiles = this.getVaultMarkdownFiles();
			return includeLore ? allFiles : allFiles.filter(f => this.cacheManager.isEligibleForChapterList(f));
		}

		const workspaceFiles: TFile[] = [];
		const seenPaths = new Set<string>();
		for (const wp of workspaceFolders) {
			const folder = this.app.vault.getAbstractFileByPath(wp);
			if (folder instanceof TFolder) {
				Vault.recurseChildren(folder, (file: TAbstractFile) => {
					if (file instanceof TFile && file.extension === 'md' && !seenPaths.has(file.path)) {
						if (includeLore || this.cacheManager.isEligibleForChapterList(file)) {
							seenPaths.add(file.path);
							workspaceFiles.push(file);
						}
					}
				});
			} else if (folder instanceof TFile && folder.extension === 'md' && !seenPaths.has(folder.path)) {
				if (includeLore || this.cacheManager.isEligibleForChapterList(folder)) {
					seenPaths.add(folder.path);
					workspaceFiles.push(folder);
				}
			}
		}
		return workspaceFiles;
	}

	/**
	 * 更新文件缓存并刷新显示
	 */
	async updateFileCacheAndRefresh(file: TFile): Promise<void> {
		try {
			// [BUGFIX] 重命名或后台刷新时需再次校验资格，防止将重命名后已不再符合要求的文档（如_合并章节）加入缓存
			if (!this.cacheManager.isEligibleForTotalWordCount(file)) {
				this.cacheManager.invalidateCache(file.path, this.app.vault);
				this.refreshFolderCounts();
				return;
			}

			const content = await this.app.vault.read(file);
			const wordCount = this.calculateAccurateWords(content);
			this.cacheManager.updateFileCache(file, wordCount, this.app.vault);
			this.refreshFolderCounts();

			// 使用防抖保存缓存（5秒后保存，避免频繁写入）
			this.adaptiveDebounceManager.debounceFixed('save-cache', () => {
				this.cacheManager.saveCache().catch(err => {
					console.error('[Plugin] 保存缓存失败:', err);
				});
			}, 5000);
		} catch (error) {
			console.error('[Plugin] 更新文件缓存失败:', error);
			// 文件读取失败时，使缓存失效
			this.cacheManager.invalidateCache(file.path, this.app.vault);
		}
	}

	async toggleStatusView() {
		await this.viewManager.toggleView(STATUS_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = await this.settingsManager.loadSettings();
	}

	async toggleForeshadowingView() {
		await this.viewManager.toggleView(FORESHADOWING_VIEW_TYPE);
	}

	async toggleTimelineView() {
		await this.viewManager.toggleView(TIMELINE_VIEW_TYPE);
	}

	async toggleWorkbenchView() {
		await this.viewManager.toggleView('webnovel-workbench');
	}


	async saveSettings() {
		this._loreCandidatesCache = null;
		await this.settingsManager.saveSettings();
	}

	/**
		 * 重命名工作区内所有功能性文档/文件夹
		 * @param oldName 旧文件名（不含 .md 后缀）或旧文件夹名
		 * @param newName 新文件名或新文件夹名
		 * @param type file 或 folder
		 * @returns 重命名的数量
		 */
	public async renameAllFunctionalFiles(oldName: string, newName: string, type: 'file' | 'folder', field?: DefaultFileNameKey): Promise<number> {
		if (!oldName || !newName || oldName === newName) return 0;

		let count = 0;
		const workspaceFolders = this.settings.workspaceFolders;

		// 构建 oldName 的候选列表：oldName + 多语言 fallback 名
		const oldNameCandidates = new Set<string>();
		oldNameCandidates.add(oldName);
		if (field) {
			for (const name of getDefaultFileNameCandidates(field)) oldNameCandidates.add(name);
		}

		// 收集需要扫描的父文件夹
		const scanPaths: string[] = [];
		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const f of workspaceFolders) {
				const normalized = f.replace(/^\/+/g, '').replace(/\/+$/g, '');
				if (normalized) scanPaths.push(normalized);
			}
		}

		for (const folderPath of scanPaths) {
			const parent = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(parent instanceof TFolder)) continue;

			for (const child of parent.children) {
				if (!(child instanceof TFolder)) continue;
				if (child.name.startsWith('_') || child.name.startsWith('.')) continue;

				if (type === 'file') {
					for (const candidate of oldNameCandidates) {
						const oldPath = child.path + '/' + candidate + '.md';
						const file = this.app.vault.getAbstractFileByPath(oldPath);
						if (file instanceof TFile) {
							const newPath = child.path + '/' + newName + '.md';
							try {
								await this.app.fileManager.renameFile(file, newPath);
								count++;
							} catch (e) {
								console.warn('[WebNovel Assistant] 重命名失败:', oldPath, e);
							}
							break;
						}
					}
				} else {
					for (const candidate of oldNameCandidates) {
						const oldPath = child.path + '/' + candidate;
						const folder = this.app.vault.getAbstractFileByPath(oldPath);
						if (folder instanceof TFolder) {
							const newPath = child.path + '/' + newName;
							try {
								await this.app.fileManager.renameFile(folder, newPath);
								count++;
							} catch (e) {
								console.warn('[WebNovel Assistant] 重命名失败:', oldPath, e);
							}
							break;
						}
					}
				}
			}
		}

		// 如果没有工作区，扫描 vault 根目录的直接子文件夹
		if (scanPaths.length === 0) {
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				if (!(child instanceof TFolder)) continue;
				if (child.name.startsWith('_') || child.name.startsWith('.')) continue;

				if (type === 'file') {
					for (const candidate of oldNameCandidates) {
						const oldPath = child.path + '/' + candidate + '.md';
						const file = this.app.vault.getAbstractFileByPath(oldPath);
						if (file instanceof TFile) {
							try {
								await this.app.fileManager.renameFile(file, child.path + '/' + newName + '.md');
								count++;
							} catch (e) {
								console.warn('[WebNovel Assistant] 重命名失败:', oldPath, e);
							}
							break;
						}
					}
				} else {
					for (const candidate of oldNameCandidates) {
						const oldPath = child.path + '/' + candidate;
						const folder = this.app.vault.getAbstractFileByPath(oldPath);
						if (folder instanceof TFolder) {
							try {
								await this.app.fileManager.renameFile(folder, child.path + '/' + newName);
								count++;
							} catch (e) {
								console.warn('[WebNovel Assistant] 重命名失败:', oldPath, e);
							}
							break;
						}
					}
				}
			}
		}

		return count;
	}




	calculateAccurateWords(text: string): number {
		return this.wordCounter.calculateAccurateWords(text, this.settings.wordCountMethod);
	}

	updateWordCount(): void {
		this.editorTracker.updateWordCount();
	}

	applyEyeCare(): void {
		this.styleManager?.updateSettings(this.settings);
		this.styleManager?.applyEyeCare();
	}

	removeEyeCare(): void {
		this.styleManager?.removeEyeCare();
	}


	refreshStatusViews(includeChart = false) {
		const leaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof WritingStatusView) {
				void leaf.view.updateData();
				if (includeChart) {
					leaf.view.renderMiniChart(true);
				}
			}
		}
	}


	buildObsOverlayHtml(): string {
		return this.obsHtmlBuilder.buildObsOverlayHtml();
	}
	refreshFolderCounts() {
		this.fileExplorerPatcher.refreshFolderCounts();
	}


	


	public isFileInWorkspace(file: TFile): boolean {
		return this.cacheManager.isFileInWorkspace(file);
	}

	public isFileInStrictChapterException(file: TFile): boolean {
		return this.cacheManager.isFileInStrictChapterException(file);
	}

	public isEligibleForChapterList(file: TFile): boolean {
		return this.cacheManager.isEligibleForChapterList(file);
	}

	public isEligibleForWordCount(file: TFile): boolean {
		return this.cacheManager.isEligibleForWordCount(file);
	}

	public isPluginGeneratedFile(basename: string): boolean {
		return this.cacheManager.isPluginGeneratedFile(basename);
	}

	public async buildFolderCache(): Promise<void> {
		return this.cacheManager.buildFolderCache();
	}

	public syncFloatingNotes(): void {
		this.stickyNoteManager.syncFloatingNotes();
	}

	public syncActiveNotesToManager(): void {
		this.stickyNoteManager.syncActiveNotesToManager();
	}
}
