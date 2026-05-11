import { App, Plugin, PluginSettingTab, Setting, MarkdownView, Modal, TFile, Notice, TFolder, MarkdownRenderer, Component, setIcon, ItemView, WorkspaceLeaf, Platform, PluginManifest } from 'obsidian';
import { AccurateCountSettings, ThemeScheme } from './src/types/settings';
import { WebNovelAssistantPlugin } from './src/types/plugin';
import { ObsStatsPayload } from './src/types/stats';
import {
	hexToRgba,
	formatTime,
	formatCount,
	injectGlobalStyle,
	removeGlobalStyle,
	isDesktop,
	isMobile,
	getPlatformTier,
	parseGoal
} from './src/utils';
import { REGEX_PATTERNS } from './src/constants';
import { CacheManager } from './src/services/CacheManager';
import { AdaptiveDebounceManager } from './src/services/AdaptiveDebounceManager';
import { SettingsManager } from './src/core/SettingsManager';
import { HistoryDataManager } from './src/services/HistoryDataManager';
import { FileExplorerPatcher } from './src/services/FileExplorerPatcher';
import { ChapterSorter } from './src/services/ChapterSorter';
import { WordCounter } from './src/services/WordCounter';
import { EditorTracker } from './src/services/EditorTracker';
import { StyleManager } from './src/services/StyleManager';
import { GoalModal } from './src/ui/GoalModal';
import { HistoryStatsModal } from './src/ui/HistoryModal';
import { AccurateCountSettingTab } from './src/ui/SettingsTab';
import { FloatingStickyNote } from './src/ui/StickyNote';
import { WritingStatusView, STATUS_VIEW_TYPE } from './src/ui/StatusView';
import { ForeshadowingView, FORESHADOWING_VIEW_TYPE } from './src/ui/ForeshadowingView';
import { TimelineView, TIMELINE_VIEW_TYPE, TimelineAddFromSelectionModal } from './src/ui/TimelineView';
import { MobileFloatingStats } from './src/ui/MobileFloatingStats';
import { TimelineManager } from './src/services/TimelineManager';
import { ObsOverlayServer } from './src/services/ObsServer';
import { ForeshadowingManager } from './src/services/ForeshadowingManager';
import { ForeshadowingInputModal, ForeshadowingRecoveryModal, ConfirmCreateForeshadowingFileModal } from './src/ui/ForeshadowingModal';
import { ObsHtmlBuilder } from './src/services/ObsHtmlBuilder';
import { ImmersiveModeManager } from './src/ui/ImmersiveModeManager';
import { ImmersiveChapterListView } from './src/ui/ImmersiveChapterListView';
import { ImmersiveStickyNotesView } from './src/ui/ImmersiveStickyNotesView';
import { StickyNoteDataManager } from './src/services/StickyNoteDataManager';
import { VIEW_TYPES } from './src/constants';
import { DEFAULT_SETTINGS } from './src/constants';
import { CommandManager } from './src/core/CommandManager';
import { ViewManager } from './src/core/ViewManager';
import { MenuManager } from './src/core/MenuManager';
import { Extension } from '@codemirror/state';
import { createWordCountGutter } from './src/editor/WordCountGutter';
import { WorkerManager } from './src/services/WorkerManager';
import { MarkdownPostProcessor } from './src/services/MarkdownPostProcessor';
import { FileEventManager } from './src/services/FileEventManager';

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

	lastEditTime: number = Date.now();
	
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
	wordCounter: WordCounter;
	editorTracker!: EditorTracker;
	styleManager!: StyleManager;
	stickyNoteManager: StickyNoteDataManager;
	immersiveModeManager!: ImmersiveModeManager;
	commandManager: CommandManager;
	viewManager: ViewManager;
	menuManager: MenuManager;
	private isLayoutReady: boolean = false;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.cacheManager = new CacheManager(this);
		this.adaptiveDebounceManager = new AdaptiveDebounceManager();
		this.settingsManager = new SettingsManager(this, DEFAULT_SETTINGS);
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
		await this.loadSettings();
		await this.historyManager.loadHistory(); // 加载历史数据
		
		
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
		
		// 初始化打字机模式状态
		if (this.settings.immersive.immersiveTypewriterMode) {
			document.body.classList.add('immersive-typewriter-mode');
		}
		
		// 初始化管理器 (依赖 this)
		this.foreshadowingManager = new ForeshadowingManager(this.app, this);
		
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
		}));

		this.commandManager.registerAllCommands();
		this.viewManager.registerAllViews();
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
		}));
		this.registerEvent(this.app.metadataCache.on('changed', () => {
			// 使用防抖避免高频更新
			this.adaptiveDebounceManager.debounceFixed('word-count-update', () => {
				this.editorTracker.updateWordCount();
			}, 100);
		}));
		
		// 初始化当前文件的字数
		this.editorTracker.handleFileChange();
		this.editorTracker.updateWordCount(); // 初始化状态栏显示

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
			
			// 移动端：如果启用了文件浏览器字数统计，构建缓存
			if (this.settings.showExplorerCounts) {
				this.app.workspace.onLayoutReady(() => {
					// 移动端需要更长的延迟，确保文件浏览器完全加载
					setTimeout(() => {
						this.buildFolderCache();
					}, 1500);
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
			setTimeout(() => {
				this.buildFolderCache();
			}, 500);
		});
		// 桌面端文件事件监听（由 FileEventManager 管理）
		this.fileEventManager?.setup();

		this.addRibbonIcon('sticky-note', '新建空白悬浮便签', () => {
			this.createStickyNote({ content: '', title: '新便签' });
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
		this.exportLegacyOBS(true);
		this.refreshStatusViews();
		new Notice("[记录中] 专注计时已开始");
	}

	/**
	 * 停止专注计时
	 */
	public stopTracking() {
		if (!this.isTracking) return;
		this.isTracking = false;
		this.workerManager.postMessage('stop');
		this.editorTracker.updateWordCount();
		this.exportLegacyOBS(true);
		this.refreshStatusViews();
		new Notice("[已暂停] 专注计时已暂停");
	}

	private setupDesktopFeatures(): void {

		this.workerManager.setup();

		// 启动 OBS 叠加层 HTTP Server
		if (this.settings.obs.enableObs) {
			this.obsServer = new ObsOverlayServer(this, this.settings.obs.obsPort);
			this.obsServer.start();
		}

		// 启用智能章节排序
		if (this.settings.enableSmartChapterSort) {
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
	}



	/**
	 * 注册共享 Ribbon 图标（平板端和桌面端都需要）
	 */
	private registerCommonRibbonIcons(): void {
		this.addRibbonIcon('bar-chart-2', '打开/关闭写作实时状态面板', () => {
			this.toggleStatusView();
		});
		this.addRibbonIcon('bookmark', '打开/关闭伏笔面板', () => {
			this.toggleForeshadowingView();
		});
		this.addRibbonIcon('calendar-clock', '打开/关闭时间线面板', () => {
			this.toggleTimelineView();
		});

		// 沉浸模式入口仅限桌面端
		if (isDesktop()) {
			this.addRibbonIcon('expand', '进入/退出全屏沉浸写作模式', () => {
				this.immersiveModeManager.toggleImmersiveMode();
			});
		}
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
		// 平板端：根据设置决定是否启用浮动字数统计窗口
		this.setupFloatingStats();
		
		// 注意：视图、命令和菜单已在 setupCoreFeatures() 中通过 Manager 统一注册，
		// 此处只需注册平板端特有的 Ribbon 图标和浮窗

		// 平板端：如果启用了文件浏览器字数统计，构建缓存
		if (this.settings.showExplorerCounts) {
			this.app.workspace.onLayoutReady(() => {
				// 平板端需要延迟，确保文件浏览器完全加载
				setTimeout(() => {
					this.buildFolderCache();
				}, 1000);
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

		const notes = this.stickyNoteManager.getNotes();

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
		if (!isDesktop()) return;

		const notes = this.stickyNoteManager.getNotes();

		// 1. 关闭那些已经在沉浸模式中被移除的便签
		const openNoteIds = new Set(notes.map(n => n.id));
		[...this.activeNotes].forEach(note => {
			if (!openNoteIds.has(note.state.id)) {
				// 静默销毁
				note.destroy(); 
			}
		});

		// 2. 更新或新建便签
		notes.forEach(noteState => {
			const activeNote = this.activeNotes.find(n => n.state.id === noteState.id);
			if (activeNote) {
				// 更新现有的
				activeNote.state = noteState;
				activeNote.renderContent(); // 重新渲染内容
				activeNote.updateVisuals(); // 重新定位和着色
			} else {
				// 新建在沉浸模式中创建的便签
				const newNote = new FloatingStickyNote(this.app, this, { state: noteState });
				newNote.load();
			}
		});
	}

	/**
	 * 创建便签（处理沉浸模式同步）
	 */
	public async createStickyNote(options: { file?: TFile, content?: string, title?: string }) {
		// 如果在移动端调用（如通过命令），由于交互限制，仅给予提示或在沉浸模式中处理
		if (!isDesktop()) {
			// 在沉浸模式中创建是允许的，因为它会渲染到辅助面板视图中
			if (!document.body.classList.contains('immersive-mode-active')) {
				new Notice('悬浮便签功能仅在桌面端可用');
				return;
			}
		}

		const note = new FloatingStickyNote(this.app, this, options);
		await note.load();
		
		// 如果处于沉浸模式，立即刷新便签列表视图
		if (document.body.classList.contains('immersive-mode-active')) {
			// 给一点额外时间让设置/文件持久化完成
			setTimeout(() => {
				this.refreshImmersiveNotes();
			}, 200);
		}
	}

	/**
	 * 刷新所有沉浸模式便签列表视图
	 */
	public refreshImmersiveNotes() {
		// 如果当前有文本框正处于编辑状态，暂时跳过全量刷新，防止打断 IME 输入
		const activeEl = document.activeElement;
		if (activeEl && activeEl.tagName.toLowerCase() === 'textarea' && 
			(activeEl.closest('.immersive-sticky-card') || activeEl.closest('.my-sticky-note'))) {
			return;
		}

		this.app.workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES).forEach(leaf => {
			if (leaf.view.getViewType() === VIEW_TYPES.IMMERSIVE_STICKY_NOTES) {
				leaf.view.renderNotes?.();
			}
		});
	}

	onunload() {
		// 0. 确保退出沉浸模式（fire-and-forget，无法等待）
		if (this.immersiveModeManager) {
			this.immersiveModeManager.exitImmersiveMode().catch(e =>
				console.error('[WebNovel Assistant] 退出沉浸模式失败:', e)
			);
		}

		// 1. 停止 OBS 服务器
		if (this.obsServer) {
			this.obsServer.stop();
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
		Promise.all([
			this.settingsManager.flush(),
			this.historyManager.flush(),
			this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes())
		]).catch(e => console.error('[WebNovel Assistant] 卸载时数据刷新失败:', e));

		console.log('[WebNovel Assistant] Plugin unloaded and resources cleaned up');
	}

	/**
	 * 构建文件浏览器缓存
	 */
	async buildFolderCache(): Promise<void> {
		if (!this.settings.showExplorerCounts) return;

		try {
			// 先尝试从持久化存储加载缓存
			const loaded = await this.cacheManager.loadCache();
			
			// 检查缓存完整性：对比缓存条目数和实际文件数
			const allFiles = this.app.vault.getMarkdownFiles();
			// 只统计工作区内的文件
			const workspaceFiles = allFiles.filter(f => this.isEligibleForWordCount(f));
			const cacheStats = this.cacheManager.getCacheStats();
			
			console.log(`[Plugin] 缓存完整性检查: ${cacheStats.size} 条目 vs ${workspaceFiles.length} 文件（工作区）`);
			
			// 缓存应该包含：文件数 + 文件夹数
			// 更严格的检查：缓存条目数应该至少等于文件数（因为还有文件夹）
			const shouldRebuild = !loaded || cacheStats.size < workspaceFiles.length;
			
			if (loaded && !shouldRebuild) {
				// 加载成功且缓存完整，直接刷新显示
				// 移动端需要额外延迟，确保文件浏览器完全准备好
				if (isMobile()) {
					setTimeout(() => {
						this.refreshFolderCounts();
					}, 500);
				} else {
					this.refreshFolderCounts();
				}
				console.log('[Plugin] 已从持久化存储加载缓存');
				return;
			}
			
			// 缓存不完整或不存在，重新构建
			if (loaded && shouldRebuild) {
				console.log(`[Plugin] 缓存不完整（${cacheStats.size} 条目 vs ${workspaceFiles.length} 文件），重新构建...`);
			} else if (!loaded) {
				console.log('[Plugin] 缓存不存在，开始构建...');
			}

			// 重新构建缓存
			const notice = new Notice('正在构建文件浏览器缓存...', 0);
			
			await this.cacheManager.buildInitialCache(
				this.app.vault,
				this.calculateAccurateWords.bind(this),
				this.isEligibleForWordCount.bind(this)
			);
			
			notice.hide();
			
			// 移动端需要额外延迟，确保文件浏览器完全准备好
			if (isMobile()) {
				setTimeout(() => {
					this.refreshFolderCounts();
				}, 500);
			} else {
				this.refreshFolderCounts();
			}
			
			new Notice('文件浏览器缓存构建完成', 3000);
		} catch (error) {
			console.error('[Plugin] 缓存构建失败:', error);
			
			// 降级: 禁用文件浏览器显示
			this.settings.showExplorerCounts = false;
			await this.saveSettings();
			
			new Notice(
				'文件浏览器缓存构建失败，已自动禁用该功能\n' +
				'您仍可以正常使用其他功能\n' +
				`错误: ${error instanceof Error ? error.message : String(error)}`,
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

	async saveSettings() {
		await this.settingsManager.saveSettings();
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
	 * 检查文件是否符合字数统计的条件
	 * @param file 要检查的文件
	 * @returns 如果符合条件返回 true
	 */
	isEligibleForWordCount(file: TFile): boolean {
		// 1. 必须在工作区内
		if (!this.isFileInWorkspace(file)) return false;
		
		// 2. 硬编码排除合并章节文件（防止导出合集时突然导致字数暴增）
		if (file.basename.includes('_合并章节')) return false;
		
		// 3. 如果开启了严格章节模式，则必须是符合命名规则的章节文件
		if (this.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
			return false;
		}
		
		return true;
	}

	calculateAccurateWords(text: string): number {
		return this.wordCounter.calculateAccurateWords(text);
	}

	updateWordCount(): void {
		this.editorTracker.updateWordCount();
	}

applyEyeCare(): void {
		this.styleManager.applyEyeCare();
	}

	removeEyeCare(): void {
		this.styleManager.removeEyeCare();
	}

	// setupWorker 已抽离到 WorkerManager.setup()

	refreshStatusViews() {
		const leaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof WritingStatusView) {
				leaf.view.updateData();
				leaf.view.renderChart(); // 刷新图表显示
			}
		}
	}

	exportLegacyOBS(force: boolean = false) {
		this.obsHtmlBuilder.exportLegacyOBS(force);
	}

	getObsStats(): ObsStatsPayload {
		return this.obsHtmlBuilder.getObsStats();
	}

	buildObsOverlayHtml(): string {
		return this.obsHtmlBuilder.buildObsOverlayHtml();
	}
	refreshFolderCounts() {
		this.fileExplorerPatcher.refreshFolderCounts();
	}

}


