import type { App, PluginManifest } from 'obsidian';
import { Plugin, TFile, TFolder, Notice, MarkdownView, MarkdownRenderChild, type MarkdownPostProcessorContext, Vault, type TAbstractFile } from 'obsidian';
import type { AccurateCountSettings } from './src/types/settings';
import type { WebNovelAssistantPlugin } from './src/types/plugin';
import {
	isDesktop,
	isMobile,
	getPlatformTier,
} from './src/utils';
import { DEFAULT_SETTINGS, PLATFORM_DELAYS } from './src/constants';
import { getDefaultFileNameCandidates, type DefaultFileNameKey } from './src/i18n/data-keys';
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
import { Logger } from './src/utils/Logger';

import { TaskManager } from './src/services/TaskManager';
import type { TimelineManager } from './src/services/TimelineManager';
import { ObsHtmlBuilder } from './src/services/ObsHtmlBuilder';
import { ImmersiveModeManager } from './src/ui/ImmersiveModeManager';
import { HomepageManager } from './src/services/HomepageManager';
import { StatisticsManager } from './src/services/StatisticsManager';
import { StickyNoteDataManager } from './src/services/StickyNoteDataManager';

import { CommandManager } from './src/core/CommandManager';
import { ViewManager } from './src/core/ViewManager';
import { MenuManager } from './src/core/MenuManager';
import { selectionCountTooltipExtension } from './src/editor/SelectionCountTooltip';
import type { Extension } from '@codemirror/state';
import { createWordCountGutter, forceWordCountGutterUpdate } from './src/editor/WordCountGutter';
import { WorkerManager } from './src/services/WorkerManager';
import { MarkdownPostProcessor } from './src/services/MarkdownPostProcessor';
import { FileEventManager } from './src/services/FileEventManager';
import { HomepageRenderer } from './src/ui/components/HomepageRenderer';
import { CharacterManager } from './src/services/CharacterManager';
import { t, setLocale, detectLocale } from './src/i18n';

import { buildCharacterHoverExtension } from './src/editor/CharacterHoverExtension';
import { createTypewriterExtension } from './src/editor/TypewriterExtension';
import { LoreSyncService } from './src/services/LoreSyncService';
import { ServiceRegistry } from './src/core/ServiceRegistry';

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
	private _unloading = false;
	private _homepageTimer: number | null = null;
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
	get timelineManager(): TimelineManager | undefined { return this.services.getOptional<TimelineManager>('TimelineManager'); }

	isLayoutReady: boolean = false;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		
		Logger.initialize(this);
		
		this.services = new ServiceRegistry();

		this.services.register('CacheManager', new CacheManager(this));
		this.services.register('AdaptiveDebounceManager', new AdaptiveDebounceManager());
		this.services.register('SettingsManager', new SettingsManager(this, DEFAULT_SETTINGS));
		this.services.register('CharacterManager', new CharacterManager(this.app, this));
		this.services.register('LoreSyncService', new LoreSyncService(this));
		this.services.register('HistoryDataManager', new HistoryDataManager(this));
		this.services.register('StickyNoteDataManager', new StickyNoteDataManager(this));

		this.services.register('FileExplorerPatcher', new FileExplorerPatcher(this.app, this));
		this.obsHtmlBuilder = new ObsHtmlBuilder(this);
		this.services.register('WordCounter', new WordCounter());
		this.services.register('ImmersiveModeManager', new ImmersiveModeManager(this.app, this));
		this.services.register('CommandManager', new CommandManager(this));
		this.services.register('ViewManager', new ViewManager(this));
		this.services.register('MenuManager', new MenuManager(this));
		this.services.register('StatisticsManager', new StatisticsManager(this));
		this.services.register('WorkerManager', new WorkerManager(this));
		this.services.register('MarkdownPostProcessor', new MarkdownPostProcessor(this));
		this.services.register('HomepageManager', new HomepageManager(this.app, this));
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
		// 初始化角色缓存 (现已全平台开放)，将其移至 onLayoutReady 以避免阻塞启动
		this.app.workspace.onLayoutReady(() => {
			this.characterManager.initialize().catch(err => {
				console.error('[Plugin] characterManager 初始化失败:', err);
			});
		});
		this.loreSyncService.initialize();

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

			// 检查是否有异常崩溃留下的沉浸模式布局快照
			if (this.settings._savedImmersiveLayout) {
				try {
					const layout = JSON.parse(this.settings._savedImmersiveLayout) as Record<string, unknown>;
					void this.app.workspace.changeLayout(layout);
					new Notice(t('immersive.recovered-from-crash'));
				} catch (err) {
					Logger.error('[Plugin] 恢复沉浸模式布局失败:', err);
				} finally {
					this.settings._savedImmersiveLayout = null;
					void this.saveSettings();
				}
			}
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
		// 并行加载历史数据、缓存数据、浮动便签
		await Promise.all([
			this.historyManager.loadHistory(),
			this.cacheManager.loadCache(),
			this.loadFloatingNotes()
		]);

		// 应用便签显示状态
		if (this.settings.showFloatingNotes === false) {
			activeDocument.body.classList.add('webnovel-notes-hidden');
		}

		// 监听数据变化事件，保持悬浮便签同步
		this.registerEvent(this.app.workspace.on('webnovel:notes-changed', () => {
			this.stickyNoteManager?.syncFloatingNotes();
		}));

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
				this.refreshFolderCounts();
			}, 500);
		}));

		this.services.register('EditorTracker', new EditorTracker(this.app, this));
		this.services.register('StyleManager', new StyleManager(this.settings));
		this.services.register('FileEventManager', new FileEventManager(this));

		this.fileEventManager.setup();
		this.statisticsManager.setup();
		// 跨平台初始化 Worker（移动端现在也需要 worker 来在前端计时）
		this.workerManager.setup();

		if (this.settings.eyeCareEnabled) this.styleManager?.applyEyeCare();



		// 初始化管理器 (依赖 this)
		this.services.register('ForeshadowingManager', new ForeshadowingManager(this.app, this));
		this.services.register('TaskManager', new TaskManager(this.app, this));

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

		// 注册编辑器扩展（全平台通用：设定速查高亮与浮窗）
		this.registerEditorExtension(buildCharacterHoverExtension(this.app, this));

		// 注册全平台通用的选区字数悬浮窗扩展
		this.registerEditorExtension(selectionCountTooltipExtension(this));

		// 注册沉浸模式打字机居中滚动扩展
		this.registerEditorExtension(createTypewriterExtension(this));

		// 初始化工作区样式和功能
		this.menuManager.registerAllMenus();
		this.registerCommonRibbonIcons();


		this.registerEvent(this.app.workspace.on('editor-change', () => {
			// 使用自适应防抖：根据输入速度自动调整延迟
			this.adaptiveDebounceManager.debounce('editor-update', () => {
				this.editorTracker.handleEditorChange();
			});
		}));
		this.registerEvent(this.app.workspace.on('webnovel-workbench-book-changed', () => {
			this.refreshStatusViews();
			void this.editorTracker.handleFileChange();
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			void this.editorTracker.handleFileChange();
			this.homepageManager?.handleViewMode();
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && !this.cacheManager.isFileInWorkspace(file)) return;
			// 使用防抖避免高频更新
			this.adaptiveDebounceManager.debounceFixed('word-count-update', () => {
				this.editorTracker.updateWordCount();
			}, 100);
		}));

		// 初始化当前文件的字数
		void this.editorTracker.handleFileChange();
		this.editorTracker.updateWordCount(); // 初始化状态栏显示

		// 注册右键菜单添加设定（设定功能目前仅桌面端可用）
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
					const timer = window.setTimeout(() => {
						void this.cacheManager.buildFolderCache();
					}, PLATFORM_DELAYS.MOBILE_EXPLORER_DELAY);
					this.register(() => window.clearTimeout(timer));
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
			const timer = window.setTimeout(() => {
				void this.cacheManager.buildFolderCache();
			}, PLATFORM_DELAYS.DESKTOP_EXPLORER_DELAY);
			this.register(() => window.clearTimeout(timer));
		});
		// 桌面端文件事件监听（由 FileEventManager 管理）
		// 已经在公用区域注册过，无需重复注册

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
		this.registerEvent(this.app.workspace.on('webnovel-workbench-book-changed', () => {
			this.refreshStatusViews();
			void this.editorTracker.handleFileChange();
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.mobileFloatingStats?.update();
		}));
		
		// 监听专注计时刷新
		this.registerInterval(window.setInterval(() => {
			if (this.isTracking) {
				this.mobileFloatingStats?.update();
			}
		}, 1000));
	}

	/**
	 * 设置平板端中间模式
	 * 启用面板功能，但不启用重度功能（Worker、OBS、缓存）
	 */
	private setupTabletMode(): void {
		if (this.settings.showMobileFloatingStats) {
			this.setupFloatingStats();
		}

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
				const timer = window.setTimeout(() => {
					void this.cacheManager.buildFolderCache();
				}, PLATFORM_DELAYS.TABLET_EXPLORER_DELAY);
				this.register(() => window.clearTimeout(timer));
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
		this.addRibbonIcon('laptop', t('command.toggle-workbench-view'), () => {
			void this.toggleWorkbenchView();
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
		activeDocument.body.classList.remove(
			'webnovel-notes-hidden',
			'webnovel-custom-dragging',
			'webnovel-eye-care-enabled',
			'immersive-mode-active',
			'immersive-hide-properties'
		);
		activeDocument.body.querySelectorAll('.my-floating-sticky-note').forEach(el => el.remove());

		// 0. 确保退出沉浸模式（fire-and-forget，无法等待）
		if (this.immersiveModeManager) {
			this.immersiveModeManager.cleanup();
		}

		// 1. 停止 OBS 服务器
		if (this.obsServer) {
			this.obsServer.stop().catch(() => { });
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
			// [BUGFIX] 历史数据同步：调用异步 flush，它已被重构为立即无视防抖延迟写盘
			this.historyManager.flush().catch(e => {
				console.error('[WebNovel Assistant] 历史数据落盘失败:', e);
			});
		} catch (e) {
			console.error('[WebNovel Assistant] 历史数据同步调用失败:', e);
		}

		Promise.all([
			this.settingsManager.flush(),
			this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes()),
			this.cacheManager.saveCache()
		]).catch(e => console.error('[WebNovel Assistant] 卸载时数据刷新失败:', e));

		// 9. 清理自定义视图相关资源（不主动 detachLeavesOfType，以防插件更新时侧面板全部丢失）
		// Note: 原来的 detachAllViews() 并不能真正解决设置面板崩溃的 BUG，反而会导致用户体验糟糕，故移除。

		// 调用 ServiceRegistry 统一清理
		if (this.services && typeof this.services.destroyAll === 'function') {
			this.services.destroyAll();
		}
	}

	/**
	 * 构建文件浏览器缓存
	 */

	/**
	 * R22: 替代全局 getMarkdownFiles() 的按需遍历方法
	 * 优先在指定的 workspaceFolders 范围内递归获取 markdown 文件，以减少大型 vault 扫描消耗。
	 * [BUGFIX] 统一使用 workspaceFolders（主字段），与 CacheManager.isFileInWorkspace 保持一致。
	/**
	 * 获取当前工作区跟踪的所有 Markdown 文件
	 * @param includeLore 是否包含设定/Lore 文件夹内的文件（默认 false，供字数统计与章节列表使用；为 true 时供 CharacterManager 设定解析使用）
	 */
	getTrackedMarkdownFiles(includeLore: boolean = false): TFile[] {
		const workspaceFolders = this.settings.workspaceFolders || [];
		if (workspaceFolders.length === 0) {
			const allFiles = this.app.vault.getMarkdownFiles();
			return includeLore ? allFiles : allFiles.filter(f => this.cacheManager.isEligibleForWordCount(f));
		}

		const workspaceFiles: TFile[] = [];
		const seenPaths = new Set<string>();
		for (const wp of workspaceFolders) {
			const folder = this.app.vault.getAbstractFileByPath(wp);
			if (folder instanceof TFolder) {
				Vault.recurseChildren(folder, (file: TAbstractFile) => {
					if (file instanceof TFile && file.extension === 'md' && !seenPaths.has(file.path)) {
						if (includeLore || this.cacheManager.isEligibleForWordCount(file)) {
							seenPaths.add(file.path);
							workspaceFiles.push(file);
						}
					}
				});
			} else if (folder instanceof TFile && folder.extension === 'md' && !seenPaths.has(folder.path)) {
				if (includeLore || this.cacheManager.isEligibleForWordCount(folder)) {
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
			if (!this.cacheManager.isEligibleForWordCount(file)) {
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
