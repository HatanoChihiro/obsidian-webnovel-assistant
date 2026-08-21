import { TFile, Notice, type Plugin } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ServiceRegistry } from './ServiceRegistry';
import { DEFAULT_SETTINGS, PLATFORM_DELAYS } from '../constants';
import { isMobile, getPlatformTier } from '../utils';
import { detectLocale, setLocale, t } from '../i18n';
import { CacheManager } from '../services/CacheManager';
import { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import { SettingsManager } from './SettingsManager';
import { CharacterManager } from '../services/CharacterManager';
import { LoreSyncService } from '../services/LoreSyncService';
import { HistoryDataManager } from '../services/HistoryDataManager';
import { StickyNoteDataManager } from '../services/StickyNoteDataManager';
import { ChapterMergeManager } from '../services/ChapterMergeManager';
import { FileExplorerPatcher } from '../services/FileExplorerPatcher';
import { WordCounter } from '../services/WordCounter';
import { ImmersiveModeManager } from '../ui/ImmersiveModeManager';
import { CommandManager } from './CommandManager';
import { ViewManager } from './ViewManager';
import { MenuManager } from './MenuManager';
import { StatisticsManager } from '../services/StatisticsManager';
import { WorkerManager } from '../services/WorkerManager';
import { MarkdownPostProcessor } from '../services/MarkdownPostProcessor';
import { HomepageManager } from '../services/HomepageManager';
import { EditorTracker } from '../services/EditorTracker';
import { StyleManager } from '../services/StyleManager';
import { FileEventManager } from '../services/FileEventManager';
import { ForeshadowingManager } from '../services/ForeshadowingManager';
import { TaskManager } from '../services/TaskManager';
import { TimelineManager } from '../services/TimelineManager';
import { RelationGraphManager } from '../services/RelationGraphManager';
import { TypographyManager } from '../services/TypographyManager';
import { ChapterSorter } from '../services/ChapterSorter';
import { ObsOverlayServer } from '../services/ObsServer';
import { MobileFloatingStats } from '../ui/MobileFloatingStats';
import { Logger } from '../utils/Logger';

/**
 * 启动宿主插件类型
 * 插件主类同时继承自 Obsidian Plugin 并实现 WebNovelAssistantPlugin 门面
 */
export type BootstrapperHost = Plugin & WebNovelAssistantPlugin & {
	editorTracker: EditorTracker;
	setupModalObserver(): void;
	setupHomepage(): void;
	loadFloatingNotes(): Promise<void>;
	registerCommonRibbonIcons(): void;
	registerSettingsTab(): void;
	registerWordCountGutter(): void;
	registerEditorExtensions(): void;
	registerEditorContextMenu(): void;
	isLayoutReady: boolean;
};

/**
 * 插件服务启动器 (PluginBootstrapper)
 *
 * 负责分阶段构造并向 ServiceRegistry 注册插件的核心管理器与服务。
 * - 构造函数阶段：注册基础无设置依赖的服务。
 * - 运行时阶段：在设置与基础数据加载后注册依赖 settings/runtime 的服务。
 */
export class PluginBootstrapper {
	private shutdownPromise: Promise<void> | null = null;

	constructor(
		private plugin: BootstrapperHost,
		private services: ServiceRegistry
	) {}

	async bootstrap(): Promise<void> {
		try {
			await this.plugin.loadSettings();

			ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);

			const langSetting = this.plugin.settings.language || 'auto';
			const locale = langSetting === 'auto' ? detectLocale() : langSetting;
			await setLocale(locale);

			if (this.plugin.settings.homepageWelcome === '欢迎回到创作中心' || this.plugin.settings.homepageWelcome === 'Welcome back to your creative space') {
				this.plugin.settings.homepageWelcome = '';
				void this.plugin.saveSettings();
			}

			this.plugin.app.workspace.onLayoutReady(() => {
				this.plugin.characterManager.initialize().catch(err => {
					console.error('[Plugin] characterManager 初始化失败:', err);
				});
			});
			this.plugin.loreSyncService.initialize();

			await Promise.all([
				this.plugin.historyManager.loadHistory(),
				this.plugin.cacheManager.loadCache(),
				this.plugin.loadFloatingNotes()
			]);

			if (this.plugin.settings.showFloatingNotes === false) {
				activeDocument.body.classList.add('webnovel-notes-hidden');
			}

			this.plugin.setupModalObserver();

			this.plugin.registerEvent(this.plugin.app.workspace.on('webnovel:notes-changed', () => {
				this.plugin.stickyNoteManager?.syncFloatingNotes();
			}));

			this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
				this.plugin.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 500);
			}));

			this.registerCoreRuntimeServices();

			this.plugin.fileEventManager.setup();
			this.plugin.statisticsManager.setup();
			this.plugin.workerManager.setup();

			this.plugin.registerMarkdownPostProcessor(this.plugin.markdownPostProcessor.getProcessor());

			if (this.plugin.settings.eyeCareEnabled) this.plugin.styleManager?.applyEyeCare();

			this.registerFeatureServices();

			this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
				this.plugin.typographyManager.updateTypography();
			}));

			this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
				this.plugin.typographyManager.updateTypography();
			}));

			this.plugin.typographyManager.updateTypography();

			this.plugin.statusBarItemEl = this.plugin.addStatusBarItem();
			this.plugin.registerSettingsTab();

			this.plugin.registerWordCountGutter();

			this.plugin.commandManager.registerAllCommands();
			this.plugin.viewManager.registerAllViews();

			this.plugin.registerEditorExtensions();

			this.plugin.menuManager.registerAllMenus();
			this.plugin.registerCommonRibbonIcons();

			this.plugin.registerEvent(this.plugin.app.workspace.on('editor-change', () => {
				this.plugin.adaptiveDebounceManager.debounce('editor-update', () => {
					this.plugin.editorTracker.handleEditorChange();
				});
			}));
			this.plugin.registerEvent(this.plugin.app.workspace.on('webnovel-workbench-book-changed', () => {
				this.plugin.refreshStatusViews();
				void this.plugin.editorTracker.handleFileChange();
			}));
			this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
				void this.plugin.editorTracker.handleFileChange();
				this.plugin.homepageManager?.handleViewMode();
			}));
			this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
				if (file instanceof TFile && !this.plugin.cacheManager.isFileInWorkspace(file)) return;
				this.plugin.adaptiveDebounceManager.debounceFixed('word-count-update', () => {
					this.plugin.editorTracker.updateWordCount();
				}, 100);
			}));

			void this.plugin.editorTracker.handleFileChange();
			this.plugin.editorTracker.updateWordCount();

			this.plugin.registerEditorContextMenu();

			this.plugin.setupHomepage();

			const platformTier = getPlatformTier();
			if (platformTier === 'tablet') {
				this.setupTabletFeatures();
			} else if (isMobile()) {
				this.setupMobileFeatures();
			} else {
				this.setupDesktopFeatures();
			}

			this.plugin.registerInterval(window.setInterval(() => {
				if (this.plugin.isTracking) {
					this.plugin.saveSettings().catch(err => {
						console.error('[Plugin] 定期保存设置失败:', err);
					});
				}
				this.plugin.cacheManager.saveCache().catch(err => {
					console.error('[Plugin] 定期保存缓存失败:', err);
				});
				this.plugin.historyManager.saveHistory().catch(err => {
					console.error('[Plugin] 定期保存历史数据失败:', err);
				});
			}, 60 * 1000));

			this.plugin.app.workspace.onLayoutReady(() => {
				this.plugin.isLayoutReady = true;

				const restoreLayout = async () => {
					if (this.plugin.settings._savedImmersiveLayout) {
						try {
							const layout = JSON.parse(this.plugin.settings._savedImmersiveLayout) as Record<string, unknown>;
							const ws = this.plugin.app.workspace as unknown as {
								changeLayout?: (layout: Record<string, unknown>) => Promise<void>;
								setLayout?: (layout: Record<string, unknown>) => Promise<void>;
							};
							if (typeof ws.changeLayout === 'function') {
								await ws.changeLayout(layout);
							} else if (typeof ws.setLayout === 'function') {
								await ws.setLayout(layout);
							}
							new Notice(t('immersive.recovered-from-crash'));
						} catch (err) {
							Logger.error('[Plugin] 恢复沉浸模式布局失败:', err);
						} finally {
							this.plugin.settings._savedImmersiveLayout = null;
							await this.plugin.saveSettings();
							await this.plugin.settingsManager.flush();
							const wsReq = this.plugin.app.workspace as unknown as { requestSaveLayout?: { run?: () => void } | (() => void) };
							if (typeof wsReq.requestSaveLayout === 'object' && wsReq.requestSaveLayout && typeof wsReq.requestSaveLayout.run === 'function') {
								wsReq.requestSaveLayout.run();
							} else if (typeof wsReq.requestSaveLayout === 'function') {
								wsReq.requestSaveLayout();
							}
						}
					}
					this.plugin.immersiveModeManager?.sanitizeNormalWorkspace();
				};
				void restoreLayout();
			});
		} catch (startupError) {
			Logger.error('[PluginBootstrapper] Startup failed, rolling back...', startupError);
			try {
				await this.rollback();
			} catch (rollbackError) {
				Logger.error('[PluginBootstrapper] Rollback cleanup failed:', rollbackError);
			}
			throw startupError;
		}
	}

	async rollback(): Promise<void> {
		await this._shutdownInternal(true);
	}

	/**
	 * 注册插件构造阶段的基础服务
	 * 对应原 main.ts 构造函数中初始化的服务批次
	 */
	registerConstructorServices(): void {
		this.services.register('CacheManager', new CacheManager(this.plugin));
		this.services.register('AdaptiveDebounceManager', new AdaptiveDebounceManager());
		this.services.register('SettingsManager', new SettingsManager(this.plugin, DEFAULT_SETTINGS));
		this.services.register('CharacterManager', new CharacterManager(this.plugin.app, this.plugin));
		this.services.register('LoreSyncService', new LoreSyncService(this.plugin));
		this.services.register('HistoryDataManager', new HistoryDataManager(this.plugin));
		this.services.register('StickyNoteDataManager', new StickyNoteDataManager(this.plugin));
		this.services.register('ChapterMergeManager', new ChapterMergeManager(this.plugin));
		this.services.register('FileExplorerPatcher', new FileExplorerPatcher(this.plugin.app, this.plugin));
		this.services.register('WordCounter', new WordCounter());
		this.services.register('ImmersiveModeManager', new ImmersiveModeManager(this.plugin.app, this.plugin));
		this.services.register('CommandManager', new CommandManager(this.plugin));
		this.services.register('ViewManager', new ViewManager(this.plugin));
		this.services.register('MenuManager', new MenuManager(this.plugin));
		this.services.register('StatisticsManager', new StatisticsManager(this.plugin));
		this.services.register('WorkerManager', new WorkerManager(this.plugin));
		this.services.register('MarkdownPostProcessor', new MarkdownPostProcessor(this.plugin));
		this.services.register('HomepageManager', new HomepageManager(this.plugin.app, this.plugin));
	}

	/**
	 * 注册设置加载后的核心运行时服务
	 * 对应原 main.ts setupCoreFeatures 第一批次 (EditorTracker, StyleManager, FileEventManager)
	 */
	registerCoreRuntimeServices(): void {
		this.services.register('EditorTracker', new EditorTracker(this.plugin.app, this.plugin));
		this.services.register('StyleManager', new StyleManager(this.plugin.settings));
		this.services.register('FileEventManager', new FileEventManager(this.plugin));
	}

	/**
	 * 注册功能模块服务
	 * 对应原 main.ts setupCoreFeatures 第二批次 (ForeshadowingManager, TaskManager, TimelineManager, RelationGraphManager, TypographyManager)
	 */
	registerFeatureServices(): void {
		this.services.register('ForeshadowingManager', new ForeshadowingManager(this.plugin.app, this.plugin));
		this.services.register('TaskManager', new TaskManager(this.plugin.app, this.plugin));
		this.services.register('TimelineManager', new TimelineManager(this.plugin.app, this.plugin));
		this.services.register('RelationGraphManager', new RelationGraphManager(this.plugin.app, this.plugin));
		this.services.register('TypographyManager', new TypographyManager(this.plugin.app, this.plugin));
	}

	/**
	 * 设置移动端功能 (Lite 模式)
	 */
	setupMobileFeatures(): void {
		// 移动端：根据设置决定是否启用浮动字数统计窗口
		this.setupFloatingStats();

		// 移动端：如果启用了智能章节排序或主页置顶，启用文件浏览器补丁
		if (this.plugin.settings.enableSmartChapterSort || this.plugin.settings.homepagePinPosition !== 'none') {
			ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);
			this.plugin.app.workspace.onLayoutReady(() => {
				this.plugin.fileExplorerPatcher.enable();
			});
		}

		// 移动端：如果启用了文件浏览器字数统计，构建缓存
		if (this.plugin.settings.showExplorerCounts) {
			this.plugin.app.workspace.onLayoutReady(() => {
				// 移动端需要更长的延迟，确保文件浏览器完全加载
				const timer = window.setTimeout(() => {
					void this.plugin.cacheManager.buildFolderCache();
				}, PLATFORM_DELAYS.MOBILE_EXPLORER_DELAY);
				this.plugin.register(() => window.clearTimeout(timer));
			});
		}

		// 监听布局变化，确保文件浏览器就绪后刷新字数
		this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
			if (this.plugin.settings.showExplorerCounts) {
				this.plugin.adaptiveDebounceManager.debounceFixed('mobile-folder-refresh', () => {
					this.plugin.refreshFolderCounts();
				}, 300);
			}
		}));
	}

	/**
	 * 设置平板端中间模式
	 * 启用面板功能，但不启用重度功能（Worker、OBS、缓存）
	 */
	setupTabletFeatures(): void {
		if (this.plugin.settings.showMobileFloatingStats) {
			this.setupFloatingStats();
		}

		// 平板端：如果启用了智能章节排序或主页置顶，启用文件浏览器补丁
		if (this.plugin.settings.enableSmartChapterSort || this.plugin.settings.homepagePinPosition !== 'none') {
			ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);
			this.plugin.app.workspace.onLayoutReady(() => {
				this.plugin.fileExplorerPatcher.enable();
			});
		}

		// 平板端：如果启用了文件浏览器字数统计，构建缓存
		if (this.plugin.settings.showExplorerCounts) {
			this.plugin.app.workspace.onLayoutReady(() => {
				// 平板端需要延迟，确保文件浏览器完全加载
				const timer = window.setTimeout(() => {
					void this.plugin.cacheManager.buildFolderCache();
				}, PLATFORM_DELAYS.TABLET_EXPLORER_DELAY);
				this.plugin.register(() => window.clearTimeout(timer));
			});
			// 监听布局变化，确保文件浏览器就绪后刷新字数
			this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
				if (this.plugin.settings.showExplorerCounts) {
					this.plugin.adaptiveDebounceManager.debounceFixed('tablet-folder-refresh', () => {
						this.plugin.refreshFolderCounts();
					}, 300);
				}
			}));
		}
	}

	/**
	 * 设置桌面端全功能完全体
	 */
	setupDesktopFeatures(): void {
		this.plugin.app.workspace.onLayoutReady(() => {
			// 延迟构建缓存，避免阻塞启动
			// 500ms 是一个平衡点：既不会阻塞启动，又能快速显示字数
			const timer = window.setTimeout(() => {
				void this.plugin.cacheManager.buildFolderCache();
			}, PLATFORM_DELAYS.DESKTOP_EXPLORER_DELAY);
			this.plugin.register(() => window.clearTimeout(timer));
		});

		this.plugin.addRibbonIcon('sticky-note', t('command.create-blank-sticky-note'), () => {
			this.plugin.createStickyNote({ content: '', title: t('notice.new-note-title') }).catch(console.error);
		});

		// 启动 OBS 叠加层 HTTP Server
		if (this.plugin.settings.obs.enableObs) {
			this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obs.obsPort);
			this.plugin.obsServer.start();
		}

		// 启用文件浏览器补丁（智能章节排序 或 创作主页置顶）
		if (this.plugin.settings.enableSmartChapterSort || this.plugin.settings.homepagePinPosition !== 'none') {
			// 初始化自定义章节命名规则
			ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules || []);

			// 延迟设置，确保文件浏览器已加载
			this.plugin.app.workspace.onLayoutReady(() => {
				this.plugin.fileExplorerPatcher.enable();
			});
		}
	}

	/**
	 * 统一的浮动统计窗口设置
	 * 用于移动端和平板端
	 */
	private setupFloatingStats(): void {
		if (!this.plugin.settings.showMobileFloatingStats) return;

		this.plugin.mobileFloatingStats = new MobileFloatingStats(this.plugin.app, this.plugin);
		this.plugin.app.workspace.onLayoutReady(() => {
			this.plugin.mobileFloatingStats?.load();
		});

		this.plugin.registerEvent(this.plugin.app.workspace.on('editor-change', () => {
			this.plugin.adaptiveDebounceManager.debounce('mobile-stats-update', () => {
				this.plugin.mobileFloatingStats?.update();
			});
		}));
		this.plugin.registerEvent(this.plugin.app.workspace.on('webnovel-workbench-book-changed', () => {
			this.plugin.refreshStatusViews();
			void this.plugin.editorTracker.handleFileChange();
		}));
		this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
			this.plugin.mobileFloatingStats?.update();
		}));

		// 监听专注计时刷新
		this.plugin.registerInterval(window.setInterval(() => {
			if (this.plugin.isTracking) {
				this.plugin.mobileFloatingStats?.update();
			}
		}, 1000));
	}

	/**
	 * 卸载与收尾协调 (Shutdown Coordinator)
	 *
	 * 统一协调插件卸载时的同步视觉/DOM清理、资源释放、数据持久化及服务销毁。
	 * 具有幂等性：重复调用不会重复执行清理或持久化。
	 */
	shutdown(): Promise<void> {
		return this._shutdownInternal(false);
	}

	private _shutdownInternal(isRollback: boolean): Promise<void> {
		if (this.shutdownPromise) {
			return this.shutdownPromise;
		}

		// 1. 同步设置卸载状态并立即执行所有视觉与 DOM 清理（确保在首个 await 之前执行完毕，界面立刻响应）
		this.plugin.isUnloading = true;

		// 1.1 立即移除全局样式类
		if (typeof activeDocument !== 'undefined' && activeDocument.body?.classList) {
			activeDocument.body.classList.remove(
				'webnovel-notes-hidden',
				'webnovel-custom-dragging',
				'webnovel-eye-care-enabled',
				'immersive-mode-active',
				'immersive-hide-properties'
			);
		}

		// 1.2 立即移除浮动便签 DOM 元素
		if (typeof activeDocument !== 'undefined' && activeDocument.body?.getElementsByClassName) {
			for (const el of Array.from(activeDocument.body.getElementsByClassName('my-floating-sticky-note'))) {
				el.remove();
			}
		}

		// 1.3 卸载移动端浮窗
		if (this.plugin.mobileFloatingStats) {
			this.plugin.mobileFloatingStats.unload();
			this.plugin.mobileFloatingStats = null;
		}

		// 1.4 卸载所有活跃便签并同步最新内容到内存，随后销毁便签实例
		if (this.plugin.activeNotes) {
			[...this.plugin.activeNotes].forEach(note => {
				const currentContent = note.state.isEditing ? note.textareaEl?.value : note.state.content;
				if (currentContent !== undefined) note.state.content = currentContent;
				if (!isRollback) {
					this.plugin.stickyNoteManager.updateNote(note.state);
				}
				note.destroy();
			});
			this.plugin.activeNotes = [];
		}

		// 1.5 清理主页管理器状态与定时器
		this.services.getOptional('HomepageManager')?.cleanup();

		// 1.6 同步彻底销毁文件浏览器补丁并移除字数 DOM / 监听器 / 挂钩（避免等待异步持久化期间残留目录字数或被异步刷新重建）
		this.services.getOptional('FileExplorerPatcher')?.destroy();

		// 1.7 提取 OBS 服务引用并置空宿主引用，避免重复停止
		const obsServer = this.plugin.obsServer;
		this.plugin.obsServer = null;

		// 2. 异步收尾逻辑：停止服务、持久化落盘，并确保全部 settled 后再逆序销毁服务
		this.shutdownPromise = (async () => {
			const stopObs = async () => {
				if (obsServer) {
					try {
						await obsServer.stop();
					} catch (e) {
						Logger.error('[PluginBootstrapper] OBS 服务器停止失败:', e);
					}
				}
			};

			const flushHistory = async () => {
				try {
					let p: Promise<void>;
					try {
						p = this.plugin.historyManager.flush();
					} catch (e) {
						Logger.error('[WebNovel Assistant] 历史数据同步调用失败:', e);
						return;
					}
					await p;
				} catch (e) {
					Logger.error('[WebNovel Assistant] 历史数据落盘失败:', e);
				}
			};

			const flushSettings = async () => {
				try {
					await this.plugin.settingsManager.flush();
				} catch (e) {
					Logger.error('[WebNovel Assistant] 卸载时数据刷新失败:', e);
				}
			};

			const saveStickyNotes = async () => {
				try {
					const notes = this.plugin.stickyNoteManager.getNotes();
					await this.plugin.stickyNoteManager.saveNotes(notes);
				} catch (e) {
					Logger.error('[WebNovel Assistant] 卸载时数据刷新失败:', e);
				}
			};

			const saveCache = async () => {
				try {
					await this.plugin.cacheManager.saveCache();
				} catch (e) {
					Logger.error('[WebNovel Assistant] 卸载时数据刷新失败:', e);
				}
			};

			const flushChapterMerge = async () => {
				try {
					await this.plugin.chapterMergeManager.flush();
				} catch (e) {
					Logger.error('[WebNovel Assistant] 卸载时数据刷新失败:', e);
				}
			};

			// 等待所有异步停止与持久化任务执行完毕（使用 Promise.allSettled 确保所有操作都被尝试，单项失败不阻断其他操作）
			const tasks: Promise<unknown>[] = [stopObs()];
			if (!isRollback) {
				tasks.push(
					flushHistory(),
					flushSettings(),
					saveStickyNotes(),
					saveCache(),
					flushChapterMerge()
				);
			}
			await Promise.allSettled(tasks);

			// 3. 在所有持久化任务完成后，统一调用 ServiceRegistry 异步逆序清理所有 Manager
			try {
				await this.services.destroyAll();
			} catch (e) {
				Logger.error('[PluginBootstrapper] ServiceRegistry 销毁失败:', e);
			}
		})();

		return this.shutdownPromise;
	}
}
