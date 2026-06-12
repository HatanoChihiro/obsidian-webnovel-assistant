import type { App, PluginManifest} from 'obsidian';
import { Plugin, TFile, TFolder, Notice, MarkdownView, type MarkdownPostProcessorContext } from 'obsidian';
import type { AccurateCountSettings } from './src/types/settings';
import type { WebNovelAssistantPlugin } from './src/types/plugin';
import type { ObsStatsPayload } from './src/types/stats';
import {
	isDesktop,
	isMobile,
	getPlatformTier
} from './src/utils';
import { CacheManager } from './src/services/CacheManager';
import { AdaptiveDebounceManager } from './src/services/AdaptiveDebounceManager';
import { SettingsManager } from './src/core/SettingsManager';
import { HistoryDataManager } from './src/services/HistoryDataManager';
import { FileExplorerPatcher } from './src/services/FileExplorerPatcher';
import { ChapterSorter } from './src/services/ChapterSorter';
import { WordCounter } from './src/services/WordCounter';
import { EditorTracker } from './src/services/EditorTracker';
import { StyleManager } from './src/services/StyleManager';
import { AccurateCountSettingTab } from './src/ui/SettingsTab';
import { FloatingStickyNote } from './src/ui/StickyNote';
import { WritingStatusView, STATUS_VIEW_TYPE } from './src/ui/StatusView';
import { FORESHADOWING_VIEW_TYPE } from './src/ui/ForeshadowingView';
import { TIMELINE_VIEW_TYPE } from './src/ui/TimelineView';
import { MobileFloatingStats } from './src/ui/MobileFloatingStats';
import { AddLoreModal } from './src/ui/AddLoreModal';
import { ObsOverlayServer } from './src/services/ObsServer';
import { ForeshadowingManager } from './src/services/ForeshadowingManager';
import { RankingManager } from './src/services/RankingManager';
import { ObsHtmlBuilder } from './src/services/ObsHtmlBuilder';
import { ImmersiveModeManager } from './src/ui/ImmersiveModeManager';
import { StickyNoteDataManager } from './src/services/StickyNoteDataManager';
import { VIEW_TYPES, DEFAULT_SETTINGS, PLATFORM_DELAYS } from './src/constants';
import { RANKING_VIEW_TYPE } from './src/ui/RankingView';
import { CommandManager } from './src/core/CommandManager';
import { ViewManager } from './src/core/ViewManager';
import { MenuManager } from './src/core/MenuManager';
import type { Extension } from '@codemirror/state';
import { createWordCountGutter, forceWordCountGutterUpdate } from './src/editor/WordCountGutter';
import { WorkerManager } from './src/services/WorkerManager';
import { MarkdownPostProcessor } from './src/services/MarkdownPostProcessor';
import { FileEventManager } from './src/services/FileEventManager';
import { HomepageManager } from './src/services/HomepageManager';
import { HomepageRenderer } from './src/services/HomepageRenderer';
import { CharacterManager } from './src/services/CharacterManager';
import { t, setLocale, detectLocale } from './src/i18n';
import { getDefaultFileNameCandidates, type DefaultFileNameKey } from './src/i18n/data-keys';
import { buildCharacterHoverExtension } from './src/editor/CharacterHoverExtension';

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
	lastRankingFolder: string = ''; 

	lastEditTime: number = Date.now();
	private _unloading = false;
	private _homepageTimer: ReturnType<typeof setTimeout> | null = null;
	
	workerManager!: WorkerManager;
	markdownPostProcessor!: MarkdownPostProcessor;
	activeNotes: FloatingStickyNote[] = [];
	obsServer: ObsOverlayServer | null = null;
	mobileFloatingStats: MobileFloatingStats | null = null;
	obsHtmlBuilder: ObsHtmlBuilder;

	// 服务优化组件
	cacheManager: CacheManager;
	adaptiveDebounceManager: AdaptiveDebounceManager;
	settingsManager: SettingsManager;
	historyManager: HistoryDataManager;
	fileExplorerPatcher: FileExplorerPatcher;
	foreshadowingManager!: ForeshadowingManager;
	rankingManager!: RankingManager;
	wordCounter: WordCounter;
	editorTracker!: EditorTracker;
	fileEventManager!: FileEventManager;
	styleManager!: StyleManager;
	stickyNoteManager: StickyNoteDataManager;
	immersiveModeManager!: ImmersiveModeManager;
	homepageManager!: HomepageManager;
	commandManager: CommandManager;
	viewManager: ViewManager;
	menuManager: MenuManager;
	characterManager: CharacterManager;
	isLayoutReady: boolean = false;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.cacheManager = new CacheManager(this);
		this.adaptiveDebounceManager = new AdaptiveDebounceManager();
		this.settingsManager = new SettingsManager(this, DEFAULT_SETTINGS);
		this.characterManager = new CharacterManager(this.app, this);
		this.historyManager = new HistoryDataManager(this);
		this.stickyNoteManager = new StickyNoteDataManager(this);
		this.fileExplorerPatcher = new FileExplorerPatcher(this.app, this);
		this.obsHtmlBuilder = new ObsHtmlBuilder(this);
		this.wordCounter = new WordCounter();
		this.immersiveModeManager = new ImmersiveModeManager(this.app, this);
		this.commandManager = new CommandManager(this);
		this.viewManager = new ViewManager(this);
		this.menuManager = new MenuManager(this);
		this.workerManager = new WorkerManager(this);
		this.markdownPostProcessor = new MarkdownPostProcessor(this);
		this.fileEventManager = new FileEventManager(this);
		// editorTracker 和 styleManager 需要在 onload 后初始化（依赖 this）
	}

	async onload() {
		// 必须首先加载设置，否则其他依赖 settings 的模块会崩溃
		await this.loadSettings();

		// 初始化国际化
		const langSetting = this.settings.language || 'auto';
		const locale = langSetting === 'auto' ? detectLocale() : langSetting;
		await setLocale(locale);


		// 旧版本 locale 迁移修复已废弃——现在 findXxxFile() 支持多语言 fallback 查找，无需强制回退

		// 迁移旧默认欢迎语为空，使动态问候生效
		if (this.settings.homepageWelcome === '欢迎回到创作中心' || this.settings.homepageWelcome === 'Welcome back to your creative space') {
			this.settings.homepageWelcome = '';
			void this.saveSettings();
		}
		// 初始化角色缓存 (仅桌面端)
		if (isDesktop()) {
			await this.characterManager.initialize();
		}

		// 加载核心功能（桌面端、平板端和移动端功能）
		await this.setupCoreFeatures();
		
		// 定期保存设置和缓存
		this.registerInterval(window.setInterval(() => {
			if (this.isTracking) {
				this.saveSettings().catch(err => {
					console.error('[Plugin] 定期保存设置失败:', err);
				});
			}
			// 定期保存缓存（每分钟）
			this.cacheManager.saveCache().catch(err => {
				console.error('[Plugin] 定期保存缓存失败:', err);
			});
			// 定期保存历史数据（每分钟，作为备份）
			this.historyManager.saveHistory().catch(err => {
				console.error('[Plugin] 定期保存历史数据失败:', err);
			});
		}, 60 * 1000));

		this.app.workspace.onLayoutReady(() => {
			this.isLayoutReady = true;
		});
	}

	/**
	 * 设置核心功能（跨越平台）
	 * - 字数统计
	 * - 目标追踪
	 * - 状态栏显示
	 * - 设置页面
	 */
	private async setupCoreFeatures(): Promise<void> {
		await this.historyManager.loadHistory(); // 加载历史数据
		await this.cacheManager.loadCache(); // 提前加载缓存数据，避免启动时主页字数显示为 0
		
		// 应用便签显示状态
		if (this.settings.showFloatingNotes === false) {
			activeDocument.body.classList.add('webnovel-notes-hidden');
		}

		// 加载浮动便签
		await this.loadFloatingNotes();
		
		// 监听数据变化事件，保持各视图同步
		this.registerEvent(this.app.workspace.on('webnovel:notes-changed', () => {
			this.syncFloatingNotes();
			this.refreshImmersiveNotes();
		}));
		
		// 初始化服务（依赖 this）
		this.editorTracker = new EditorTracker(this.app, this);
		this.styleManager = new StyleManager(this.settings);
		
		if (this.settings.eyeCareEnabled) this.styleManager.applyEyeCare();
		

		
		// 初始化管理器 (依赖 this)
		this.foreshadowingManager = new ForeshadowingManager(this.app, this);
		this.rankingManager = new RankingManager(this.app, this);
		
		this.statusBarItemEl = this.addStatusBarItem();
		this.addSettingTab(new AccurateCountSettingTab(this.app, this));

		// 注册分章提醒编辑器扩展（仅桌面端）
		if (isDesktop() && this.settings.enableWordCountGutter) {
			this.wordCountExtensionHolder.push(createWordCountGutter(this));
		}
		this.registerEditorExtension(this.wordCountExtensionHolder);

		// 监听设置变更以动态热更新扩展（仅桌面端）
		this.registerEvent(this.app.workspace.on('webnovel:word-count-gutter-settings-changed', () => {
			this.wordCountExtensionHolder.length = 0;
			if (isDesktop() && this.settings.enableWordCountGutter) {
				this.wordCountExtensionHolder.push(createWordCountGutter(this));
			}
			// 通知 Obsidian 全局刷新所有编辑器的 Extension
			this.app.workspace.updateOptions();
			
			// 派发空 dispatch 强刷状态
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

		this.commandManager.registerAllCommands();
		this.viewManager.registerAllViews();
		
		// 注册编辑器扩展（设定速查仅在桌面端可用）
		if (isDesktop()) {
			this.registerEditorExtension(buildCharacterHoverExtension(this.app, this));
		}

		// 初始化工作区样式和功能
		this.menuManager.registerAllMenus();
		this.registerCommonRibbonIcons();
		

		this.registerEvent(this.app.workspace.on('editor-change', () => {
			// 使用自适应防抖：根据输入速度自动调整延迟
			this.adaptiveDebounceManager.debounce('editor-update', () => {
				this.editorTracker.handleEditorChange();
			});
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.editorTracker.handleFileChange();
			this.handleHomepageViewMode();
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && !this.isFileInWorkspace(file)) return;
			// 使用防抖避免高频更新
			this.adaptiveDebounceManager.debounceFixed('word-count-update', () => {
				this.editorTracker.updateWordCount();
			}, 100);
		}));
		
		// 初始化当前文件的字数
		this.editorTracker.handleFileChange();
		this.editorTracker.updateWordCount(); // 初始化状态栏显示

		// 注册右键菜单添加设定（设定功能目前仅桌面端可用）
		if (isDesktop()) {
			this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const selection = editor.getSelection();
				if (selection && selection.length > 0 && selection.length < 50) {
					menu.addItem((item) => {
						item.setTitle(t('menu.add-as-new-lore'))
							.setIcon('book-plus')
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
			}));
		}

		// ==========================================
		// 创作主页（跨平台支持）
		// ==========================================
		this.setupHomepage();

		// ==========================================
		// 2. 平台检测和功能分级 (需求 8.1, 8.3)
		// ==========================================
		
		// 优先检测平板端（平板也是移动设备，但屏幕更大）
		const platformTier = getPlatformTier();
		if (platformTier === 'tablet') {
			this.setupTabletMode();
			return; // 🛑 平板端执行到这里直接终止
		}
		
		// 移动端 Lite 模式
		if (isMobile()) {
			// 移动端：根据设置决定是否启用浮动字数统计窗口
			this.setupFloatingStats();
			
			// 移动端：如果启用了智能章节排序或主页置顶，启用文件浏览器补丁
			if (this.settings.enableSmartChapterSort || this.settings.homepagePinPosition !== 'none') {
				ChapterSorter.setCustomRules(this.settings.chapterNamingRules || []);
				this.app.workspace.onLayoutReady(() => {
					this.fileExplorerPatcher.enable();
				});
			}
			// 移动端：如果启用了文件浏览器字数统计，构建缓存
			if (this.settings.showExplorerCounts) {
				this.app.workspace.onLayoutReady(() => {
					// 移动端需要更长的延迟，确保文件浏览器完全加载
						window.setTimeout(() => {
						void this.buildFolderCache();
					}, PLATFORM_DELAYS.MOBILE_EXPLORER_DELAY);
				});
			}
			// 监听布局变化，确保文件浏览器就绪后刷新字数
			this.registerEvent(this.app.workspace.on('layout-change', () => {
				if (this.settings.showExplorerCounts) {
					this.adaptiveDebounceManager.debounceFixed('mobile-folder-refresh', () => {
						this.refreshFolderCounts();
					}, 300);
				}
			}));
			return; // 🛑 关键：手机端执行到这里直接终止，不加载下方的高级重度功能
		}

		// ==========================================
		// 3. 桌面端全功能完全体 (需求 8.4)
		// ==========================================
		// 桌面端提供完整功能集:
		// 
		// 核心功能 (跨越所有平台):
		// - ✓ 字数统计
		// - ✓ 目标追踪
		// - ✓ 状态栏显示
		// - ✓ 设置页面
		// 
		// 扩展功能 (桌面级加载):
		// - ✓ 实时状态面板视图 (面板类)
		// - ✓ 悬浮便签系统 (拖拽、透明度、主题)
		// - ✓ OBS 直播叠加层 (HTTP 服务器)
		// - ✓ Worker 时间追踪 (专注/摸鱼时间)
		// - ✓ 文件浏览器缓存 (性能优化)
		// - ✓ 文件夹合并功能
		// - ✓ 历史统计图表
		// ==========================================
		
		// 功能已由 Manager 注册

		this.app.workspace.onLayoutReady(() => {
			// 延迟构建缓存，避免阻塞启动
			// 500ms 是一个平衡点：既不会阻塞启动，又能快速显示字数
			window.setTimeout(() => {
				void this.buildFolderCache();
			}, PLATFORM_DELAYS.DESKTOP_EXPLORER_DELAY);
		});
		// 桌面端文件事件监听（由 FileEventManager 管理）
		this.fileEventManager.setup();

		this.addRibbonIcon('sticky-note', t('command.create-blank-sticky-note'), () => {
			this.createStickyNote({ content: '', title: t('notice.new-note-title') }).catch(console.error);
		});

		this.setupDesktopFeatures();
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

	private setupDesktopFeatures(): void {

		this.workerManager.setup();

		// 启动 OBS 叠加层 HTTP Server
		if (this.settings.obs.enableObs) {
			this.obsServer = new ObsOverlayServer(this, this.settings.obs.obsPort);
			this.obsServer.start();
		}

		// 启用文件浏览器补丁（智能章节排序 或 创作主页置顶）
		if (this.settings.enableSmartChapterSort || this.settings.homepagePinPosition !== 'none') {
			// 初始化自定义章节命名规则
			ChapterSorter.setCustomRules(this.settings.chapterNamingRules || []);
			
			// 延迟设置，确保文件浏览器已加载
			this.app.workspace.onLayoutReady(() => {
				this.fileExplorerPatcher.enable();
			});
		}

		// 注意：copy-obs-overlay-url / refresh-chapter-sort / rebuild-folder-cache
		// 这三条命令已由 CommandManager.registerAllCommands() 统一注册，此处不再重复。

		// ==========================================
		// 桌面端专属：伏笔标注功能 - Markdown 渲染后处理
		// ==========================================

		// Markdown 渲染后处理：在预览模式下为"未回收"状态注入复选框
		this.registerMarkdownPostProcessor(this.markdownPostProcessor.getProcessor());

		// 创作主页相关代码已被移动到 setupHomepage() 中，并在所有平台运行
	}

	private setupHomepage(): void {
		// 创作主页动态渲染：6 个 Obsidian 专用代码块处理器
		this.homepageManager = new HomepageManager(this.app, this);
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
									const activeLeaf = this.app.workspace.getLeaf(false);
									await activeLeaf.openFile(file);
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
			// 添加标记类供 CSS 定位，替代低性能的 :has() 选择器
			el.classList.add('webnovel-homepage-root');
			
			// 找到父级的 workspace-leaf-content 注入特定类，彻底摆脱 :has()
			const leafContent = el.closest('.workspace-leaf-content');
			if (leafContent) {
				leafContent.classList.add('is-webnovel-homepage');
			}
			
			await renderer.renderHomepage(el);
		});

	}


	/**
	 * 统一的浮动统计窗口设置
	 * 用于移动端和平板端
	 */
	private setupFloatingStats(): void {
		if (!this.settings.showMobileFloatingStats) return;
		
		this.mobileFloatingStats = new MobileFloatingStats(this.app, this);
		this.app.workspace.onLayoutReady(() => {
			this.mobileFloatingStats?.load();
		});
		
		this.registerEvent(this.app.workspace.on('editor-change', () => {
			this.adaptiveDebounceManager.debounce('mobile-stats-update', () => {
				this.mobileFloatingStats?.update();
			});
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.mobileFloatingStats?.update();
		}));
	}

	/**
	 * 设置平板端中间模式
	 * 启用面板功能，但不启用重度功能（Worker、OBS、缓存）
	 */
	private setupTabletMode(): void {
		// 平板端不启用浮动字数统计窗口（平板有侧边栏面板，不需要浮窗）
		// 注意：视图、命令和菜单已在 setupCoreFeatures() 中通过 Manager 统一注册，
		// 此处只需注册平板端特有的 Ribbon 图标

		// 平板端：如果启用了智能章节排序或主页置顶，启用文件浏览器补丁
			if (this.settings.enableSmartChapterSort || this.settings.homepagePinPosition !== 'none') {
				ChapterSorter.setCustomRules(this.settings.chapterNamingRules || []);
				this.app.workspace.onLayoutReady(() => {
					this.fileExplorerPatcher.enable();
				});
			}

			// 平板端：如果启用了文件浏览器字数统计，构建缓存
		if (this.settings.showExplorerCounts) {
			this.app.workspace.onLayoutReady(() => {
				// 平板端需要延迟，确保文件浏览器完全加载
					window.setTimeout(() => {
						void this.buildFolderCache();
					}, PLATFORM_DELAYS.TABLET_EXPLORER_DELAY);
			});
			// 监听布局变化，确保文件浏览器就绪后刷新字数
			this.registerEvent(this.app.workspace.on('layout-change', () => {
				if (this.settings.showExplorerCounts) {
					this.adaptiveDebounceManager.debounceFixed('tablet-folder-refresh', () => {
						this.refreshFolderCounts();
					}, 300);
				}
			}));
		}
	}

	/**
	 * 从独立文件加载并显示浮动便签
	 */
	public async loadFloatingNotes() {
		// 仅在桌面端加载浮动便签，移动端/平板端由于交互限制不启用
		if (!isDesktop()) return;

			// 清除可能残留的便签 DOM（如插件上次未正常卸载）
			activeDocument.body.querySelectorAll('.my-floating-sticky-note').forEach(el => el.remove());
			this.activeNotes = [];
		const notes = await this.stickyNoteManager.loadNotes();

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
	public syncActiveNotesToManager(): void {
		if (!isDesktop()) return;
		this.activeNotes.forEach(note => {
			if (note.state.isEditing && note.textareaEl) {
				note.state.content = note.textareaEl.value;
			}
			this.stickyNoteManager.updateNote(note.state);
		});
		// [BUGFIX] updateNote 只更新内存，需要在此显式触发持久化，
		// 防止进入沉浸模式或插件卸载时便签内容丢失。
		this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes()).catch(err => {
			console.error('[Plugin] syncActiveNotesToManager 保存便签失败:', err);
		});
	}

	/**
	 * 同步沉浸模式产生的便签变更到桌面悬浮便签
	 */
	public syncFloatingNotes(): void {
		// 仅在桌面端同步浮动便签
		if (!isDesktop() || this._unloading) return;

		const notes = this.stickyNoteManager.getNotes();

		// 1. 关闭那些已经在沉浸模式中被移除的便签
		const openNoteIds = new Set(notes.map(n => n.id));
		[...this.activeNotes].forEach(note => {
			if (!openNoteIds.has(note.state.id)) {
				// 静默销毁
				note.destroy(); 
			}
		});

		// 2. 处理沉浸模式中新建或编辑过的便签
		const activeIds = new Set(this.activeNotes.map(n => n.state.id));
		for (const noteState of notes) {
			if (!activeIds.has(noteState.id)) {
				const newNote = new FloatingStickyNote(this.app, this, { state: noteState });
				newNote.load();
			} else {
				// 更新已存在的便签内容和状态
				const existingNote = this.activeNotes.find(n => n.state.id === noteState.id);
				if (existingNote) {
					existingNote.updateFromState(noteState);
				}
			}
		}
	}

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
			window.setTimeout(() => {
				this.refreshImmersiveNotes();
			}, 200);
		}
	}

	private _leafOriginalStates = new WeakMap<object, Record<string, unknown>>();

	/**
	 * 主页视图模式管理
	 * 精确记录叶子进入主页前的状态，离开时完美还原
	 */
	private handleHomepageViewMode(): void {
		if (!this.settings.enableHomepage) return;
		const homepagePath = this.homepageManager?.getHomepageFilePath();
		if (!homepagePath) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const leaf = view.leaf;
		const activeFile = view.file;
		const isOnHomepage = activeFile && activeFile.path === homepagePath;

		if (isOnHomepage) {
			// 添加专门的高性能 CSS 类名，替代原先的 :has() 选择器
			const leafContent = view.containerEl.closest('.workspace-leaf-content') || view.containerEl;
			leafContent.classList.add('is-webnovel-homepage');
			
			// 进入主页：记录原状态并切换到预览模式
			if (!this._leafOriginalStates.has(leaf)) {
				const stateToSave = view.getState();
				if (stateToSave.mode === 'preview') {
					// 针对 Obsidian 重启时恢复会话，或用户原本在阅读模式的情况
					// 我们将其原状态“修正”为系统的默认模式（通常是 source/编辑模式）
					// 这样切出主页到其他文档时，就不会把其他文档也变成阅读模式
					stateToSave.mode = (this.app.vault.getConfig('defaultViewMode') as string) || 'source';
					stateToSave.source = false;
				}
				this._leafOriginalStates.set(leaf, stateToSave);
			}
			if (view.getMode() !== 'preview') {
				// 使用 setTimeout 避免与 Obsidian 内部的文件打开/导航 Promise 产生竞态条件
				// [BUGFIX] 使用计时器取消机制防止快速切换时的竞态
				if (this._homepageTimer) window.clearTimeout(this._homepageTimer);
				this._homepageTimer = window.setTimeout(() => {
					this._homepageTimer = null;
					// 获取最新状态避免过期
					const latestView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (latestView && latestView.file?.path === homepagePath) {
						const state = latestView.getState();
						state.mode = 'preview';
						void latestView.leaf.setViewState({ type: 'markdown', state, active: true });
					}
				}, 50);
			}
			this.homepageManager?.refreshHomepageViews();
		} else {
			// 离开了主页：移除 CSS 标识
			const leafContent = view.containerEl.closest('.workspace-leaf-content') || view.containerEl;
			leafContent.classList.remove('is-webnovel-homepage');
			
			// 恢复进入前的状态
			if (this._leafOriginalStates.has(leaf)) {
				const originalState = this._leafOriginalStates.get(leaf)!;
				this._leafOriginalStates.delete(leaf);
				
				const currentState = view.getState();
				if (currentState.mode !== originalState.mode || currentState.source !== originalState.source) {
					// 使用 setTimeout 避免切换回其他文档时，被 Obsidian 自身的默认加载状态覆盖
					const targetPath = activeFile?.path;
					// [BUGFIX] 使用计时器取消机制防止快速切换时的竞态
					if (this._homepageTimer) window.clearTimeout(this._homepageTimer);
					this._homepageTimer = window.setTimeout(() => {
						this._homepageTimer = null;
						const latestView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (latestView && latestView.file?.path === targetPath) {
							const newState = latestView.getState();
							newState.mode = originalState.mode;
							newState.source = originalState.source;
							void latestView.leaf.setViewState({ type: 'markdown', state: newState, active: true });
						}
					}, 50);
				}
			}
		}
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
	public refreshImmersiveNotes() {
		// 如果当前有文本框正处于编辑状态，暂时跳过全量刷新，防止打断 IME 输入
		const activeEl = activeDocument.activeElement;
		if (activeEl && activeEl.tagName.toLowerCase() === 'textarea' && 
			(activeEl.closest('.immersive-sticky-card') || activeEl.closest('.my-sticky-note'))) {
			return;
		}

		this.app.workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES).forEach(leaf => {
			if (leaf.view.getViewType() === VIEW_TYPES.IMMERSIVE_STICKY_NOTES) {
				const view = leaf.view as unknown as { renderNotes?: () => void };
				view.renderNotes?.();
			}
		});
	}

	
	private registerCommonRibbonIcons(): void {
		this.addRibbonIcon('bar-chart-2', t('command.toggle-status-view'), () => {
			void this.toggleStatusView();
		});
		this.addRibbonIcon('bookmark', t('command.toggle-foreshadowing-view'), () => {
			void this.toggleForeshadowingView();
		});
		this.addRibbonIcon('calendar-clock', t('command.toggle-timeline-view'), () => {
			void this.toggleTimelineView();
		});
		this.addRibbonIcon('layout-grid', t('command.toggle-corkboard-view'), () => {
			void this.toggleCorkboardView();
		});
		this.addRibbonIcon('trophy', t('command.toggle-ranking-view'), () => {
			void this.toggleRankingView();
		});

		if (isDesktop()) {
			this.addRibbonIcon('expand', t('command.toggle-immersive-mode'), () => {
				void this.immersiveModeManager.toggleImmersiveMode();
			});
		}
	}
onunload() {
		this._unloading = true;
		// 立即移除所有便签 DOM（最先执行，确保视觉上立刻消失）
		activeDocument.body.classList.remove('webnovel-notes-hidden');
		activeDocument.body.querySelectorAll('.my-floating-sticky-note').forEach(el => el.remove());

		// 0. 确保退出沉浸模式（fire-and-forget，无法等待）
		if (this.immersiveModeManager) {
			this.immersiveModeManager.exitImmersiveMode().catch(e =>
				console.error('[WebNovel Assistant] 退出沉浸模式失败:', e)
			);
		}

		// 1. 停止 OBS 服务器
		if (this.obsServer) {
			this.obsServer.stop().catch(() => {});
			this.obsServer = null;
		}

		// 2. 卸载移动端浮窗
		if (this.mobileFloatingStats) {
			this.mobileFloatingStats.unload();
			this.mobileFloatingStats = null;
		}

		// 3. 卸载所有活跃便签并同步最新内容到内存
		if (this.activeNotes) {
			[...this.activeNotes].forEach(note => {
				const currentContent = note.state.isEditing ? note.textareaEl?.value : note.state.content;
				if (currentContent !== undefined) note.state.content = currentContent;
				this.stickyNoteManager.updateNote(note.state);
				note.destroy();
			});
			this.activeNotes = [];
		}
		
		// 4. 停止 Worker
		this.workerManager.terminate();

		// 5. 清理定时器和防抖
		this.adaptiveDebounceManager.cancelAll();
		if (this._homepageTimer) {
			window.clearTimeout(this._homepageTimer);
			this._homepageTimer = null;
		}

		// 6. 移除动态样式
		if (this.styleManager) {
			this.styleManager.removeEyeCare();
		}


		// 7. 卸载文件浏览器补丁
		if (this.fileExplorerPatcher) {
			this.fileExplorerPatcher.disable();
			this.fileExplorerPatcher.unpatch();
		}

		// 8. 强制刷新所有管理器队列
		try {
			// 历史数据同步落盘
			this.historyManager.flushSync();
		} catch(e) {
			console.error('[WebNovel Assistant] 历史数据同步落盘失败:', e);
		}
		
		Promise.all([
			this.settingsManager.flush(),
			this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes())
		]).catch(e => console.error('[WebNovel Assistant] 卸载时数据刷新失败:', e));

	}

	/**
	 * 构建文件浏览器缓存
	 */
	async buildFolderCache(): Promise<void> {
		if (!this.settings.showExplorerCounts) return;

		try {
			// 避免发生双重 loadCache，如果缓存已有数据则视为已加载
			const loaded = this.cacheManager.getCacheStats().size > 0 ? true : await this.cacheManager.loadCache();
			
			// 检查缓存完整性：对比缓存条目数和实际文件数
			const allFiles = this.app.vault.getMarkdownFiles();
			// 只统计工作区内的文件
			const workspaceFiles = allFiles.filter(f => this.isEligibleForWordCount(f));
			const cacheStats = this.cacheManager.getCacheStats();
			
			// 缓存应该包含：文件数 + 文件夹数
			// 更严格的检查：缓存条目数应该至少等于文件数（因为还有文件夹）
			let shouldRebuild = !loaded || cacheStats.size < workspaceFiles.length;
			// 严格章节模式下旧缓存可能包含非章节文件数据，需要重建
			if (loaded && !shouldRebuild && this.settings.enableStrictChapterMode) {
				for (const [path, entry] of this.cacheManager.getEntries()) {
					if (!entry.isFolder) {
						const file = this.app.vault.getAbstractFileByPath(path);
						if (file instanceof TFile && !this.isEligibleForWordCount(file)) {
							shouldRebuild = true;
							break;
						}
					}
				}
			}
			
			if (loaded && !shouldRebuild) {
				// 加载成功且缓存完整，直接刷新显示
				// 移动端需要额外延迟，确保文件浏览器完全准备好
				if (isMobile()) {
					window.setTimeout(() => {
						this.refreshFolderCounts();
						if (this.settings.enableHomepage) this.homepageManager?.refreshHomepageViews();
					}, PLATFORM_DELAYS.MOBILE_CACHE_REFRESH_DELAY);
				} else {
					this.refreshFolderCounts();
					if (this.settings.enableHomepage) this.homepageManager?.refreshHomepageViews();
				}
				return;
			}
			
			// 缓存不完整或不存在
			if (!loaded) {
				// 全量构建
				const notice = new Notice(t('notice.building-explorer-cache'), 0);
				await this.cacheManager.buildInitialCache(
					this.app.vault,
					this.calculateAccurateWords.bind(this),
					this.isEligibleForWordCount.bind(this)
				);
				notice.hide();
			} else {
				// 增量补全：只处理缓存中缺失的文件
				const cachedPaths = new Set(Array.from(this.cacheManager.getEntries(), ([k]) => k));
				const missingFiles = workspaceFiles.filter(f => !cachedPaths.has(f.path));
				for (const file of missingFiles) {
					try {
						const content = await this.app.vault.cachedRead(file);
						const count = this.calculateAccurateWords(content);
						this.cacheManager.updateFileCache(file, count, this.app.vault);
					} catch {
						// 忽略单个文件失败
					}
				}
				await this.cacheManager.saveCache();
			}

			// 移动端需要额外延迟，确保文件浏览器完全准备好
			if (isMobile()) {
				window.setTimeout(() => {
						this.refreshFolderCounts();
						if (this.settings.enableHomepage) this.homepageManager?.refreshHomepageViews();
				}, PLATFORM_DELAYS.MOBILE_CACHE_REFRESH_DELAY);
			} else {
					this.refreshFolderCounts();
					if (this.settings.enableHomepage) this.homepageManager?.refreshHomepageViews();
			}
			
			new Notice(t('notice.explorer-cache-complete'), 3000);
		} catch (error) {
			console.error('[Plugin] 缓存构建失败:', error);
			
			// 降级: 禁用文件浏览器显示
			this.settings.showExplorerCounts = false;
			await this.saveSettings();
			
			new Notice(
				t('notice.explorer-cache-failed', { error: error instanceof Error ? error.message : String(error) }),
				10000
			);
		}
	}

	/**
	 * 更新文件缓存并刷新显示
	 */
	async updateFileCacheAndRefresh(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.cachedRead(file);
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

	async toggleRankingView() {
		await this.viewManager.toggleView(RANKING_VIEW_TYPE);
	}

	async toggleCorkboardView() {
		await this.viewManager.toggleView('webnovel-corkboard');
	}


	async saveSettings() {
		await this.settingsManager.saveSettings();
	}

	/**
	 * 检查文件名是否为插件生成的元数据文件（支持多语言文件名）
	 */
	isPluginGeneratedFile(basename: string): boolean {
		const checks: Array<{ setting: string | undefined; field: DefaultFileNameKey }> = [
			{ setting: this.settings.novelInfo?.fileName, field: "novelInfoFileName" },
			{ setting: this.settings.foreshadowing?.fileName, field: "foreshadowingFileName" },
			{ setting: this.settings.timeline?.fileName, field: "timelineFileName" },
			{ setting: this.settings.ranking?.fileName, field: "rankingFileName" },
		];
		for (const { setting, field } of checks) {
		if (basename === setting) return true;
			for (const name of getDefaultFileNameCandidates(field)) {
				if (basename === name) return true;
			}
		}
		return false;
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
/**
	 * 检查文件是否在工作区文件夹内
	 * @param file 要检查的文件
	 * @returns 如果工作区为空或文件在工作区内，返回 true
	 */
	isFileInWorkspace(file: TFile): boolean {
		// 如果没有设置工作区，则全局生效
		if (!this.settings.workspaceFolders || this.settings.workspaceFolders.length === 0) {
			return true;
		}

		// 检查文件路径是否在任一工作区文件夹内
		const filePath = file.path;
		return this.settings.workspaceFolders.some(folder => {
			// 标准化文件夹路径（移除首尾斜杠）
			const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
			if (normalizedFolder === '') return true; // 如果填了 / 或为空，默认匹配所有
			return filePath === normalizedFolder + '.md' || filePath.startsWith(normalizedFolder + '/');
		});
	}



	/**
	 * 检查文件是否在严格章节模式例外目录内
	 */
	isFileInStrictChapterException(file: TFile): boolean {
		if (!this.settings.strictChapterExceptions || this.settings.strictChapterExceptions.length === 0) {
			return false;
		}
		const filePath = file.path;
		return this.settings.strictChapterExceptions.some(folder => {
			const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
			if (normalizedFolder === '') return false;
			return filePath === normalizedFolder + '.md' || filePath.startsWith(normalizedFolder + '/');
		});
	}
	/**
	 * 检查文件是否符合字数统计的条件
	 * @param file 要检查的文件
	 * @returns 如果符合条件返回 true
	 */
	isEligibleForWordCount(file: TFile): boolean {
		// 1. 必须在工作区内
		if (!this.isFileInWorkspace(file)) return false;
		
		// 2. 硬编码排除合并章节文件（防止导出合集时突然导致字数暴增）
		if (file.basename.includes('_合并章节')) return false;

		// 2.5 动态排除插件生成的元数据文件（如作品信息、伏笔、时间线、限时任务等）
		const basename = file.basename;
		if (
			this.isPluginGeneratedFile(basename) ||
			file.path === this.homepageManager?.getHomepageFilePath()
		) {
			return false;
		}
		
		// 3. 如果开启了严格章节模式，则必须是符合命名规则的章节文件
		if (this.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name) && !this.isFileInStrictChapterException(file)) {
			return false;
		}
		
		return true;
	}

	calculateAccurateWords(text: string): number {
		return this.wordCounter.calculateAccurateWords(text, this.settings.wordCountMethod);
	}

	updateWordCount(): void {
		this.editorTracker.updateWordCount();
	}

	applyEyeCare(): void {
		this.styleManager.updateSettings(this.settings);
		this.styleManager.applyEyeCare();
	}

	removeEyeCare(): void {
		this.styleManager.removeEyeCare();
	}

	
	refreshStatusViews() {
		const leaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof WritingStatusView) {
				void leaf.view.updateData();
				leaf.view.renderMiniChart(); // 刷新热力图显示
			}
		}

		// 同步刷新限时任务面板，使其字数进度即时更新
		const rankingLeaves = this.app.workspace.getLeavesOfType(RANKING_VIEW_TYPE);
		for (const leaf of rankingLeaves) {
			const view = leaf.view as unknown as { refresh?: () => void };
			if (typeof view.refresh === 'function') {
				view.refresh();
			}
		}
	}


	async getObsStats(): Promise<ObsStatsPayload> {
		return this.obsHtmlBuilder.getObsStats();
	}

	buildObsOverlayHtml(): string {
		return this.obsHtmlBuilder.buildObsOverlayHtml();
	}
	refreshFolderCounts() {
		this.fileExplorerPatcher.refreshFolderCounts();
	}

}