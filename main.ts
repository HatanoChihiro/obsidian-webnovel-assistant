import { App, Plugin, PluginSettingTab, Setting, MarkdownView, Modal, TFile, Notice, TFolder, MarkdownRenderer, Component, setIcon, ItemView, WorkspaceLeaf, Platform } from 'obsidian';
import { AccurateCountSettings, DailyStat, ThemeScheme, StickyNoteState } from './src/types/settings';
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
	getPlatformTier
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
	
	worker: Worker | null = null;
	activeNotes: FloatingStickyNote[] = [];
	obsServer: ObsOverlayServer | null = null;
	mobileFloatingStats: MobileFloatingStats | null = null;
	obsHtmlBuilder: ObsHtmlBuilder;
	
	// Worker 重启控制
	private workerRestartAttempts: number = 0;
	private readonly MAX_WORKER_RESTARTS: number = 5;
	private workerRestartTimer: number | null = null;

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
	private wordCountElCache = new WeakMap<HTMLElement, HTMLElement>();

	constructor(app: App, manifest: any) {
		super(app, manifest);
		this.cacheManager = new CacheManager(this);
		this.adaptiveDebounceManager = new AdaptiveDebounceManager();
		this.settingsManager = new SettingsManager(this, DEFAULT_SETTINGS);
		this.historyManager = new HistoryDataManager(this);
		this.stickyNoteManager = new StickyNoteDataManager(this);
		this.fileExplorerPatcher = new FileExplorerPatcher(this.app);
		this.obsHtmlBuilder = new ObsHtmlBuilder(this);
		this.wordCounter = new WordCounter();
		this.immersiveModeManager = new ImmersiveModeManager(this.app, this);
		this.commandManager = new CommandManager(this);
		this.viewManager = new ViewManager(this);
		this.menuManager = new MenuManager(this);
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
		
		// 加载便签数据并处理迁移
		await this.stickyNoteManager.loadNotes();
		if (this.settings.openNotes && this.settings.openNotes.length > 0) {
			console.log('[Plugin] 数据清理：旧版便签数据已迁移，从 settings 中移除');
			this.settings.openNotes = [];
			await this.saveSettings();
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
		
		this.styleManager.injectGlobalStyles();
		if (this.settings.eyeCareEnabled) this.styleManager.applyEyeCare();
		
		// 初始化打字机模式状态
		if (this.settings.immersiveTypewriterMode) {
			document.body.classList.add('immersive-typewriter-mode');
		}
		
		// 初始化管理器 (依赖 this)
		this.foreshadowingManager = new ForeshadowingManager(this.app, this);
		
		this.statusBarItemEl = this.addStatusBarItem();
		this.addSettingTab(new AccurateCountSettingTab(this.app, this));

		// 注册分章提醒编辑器扩展（使用可变数组，方便动态重载）
		if (this.settings.enableWordCountGutter) {
			this.wordCountExtensionHolder.push(createWordCountGutter(this));
		}
		this.registerEditorExtension(this.wordCountExtensionHolder);

		// 监听设置变更以动态热更新扩展
		this.registerEvent(this.app.workspace.on('webnovel:word-count-gutter-settings-changed', () => {
			this.wordCountExtensionHolder.length = 0;
			if (this.settings.enableWordCountGutter) {
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

		// 监听文件修改事件
		this.registerEvent(this.app.vault.on('modify', async (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				// 只处理符合字数统计条件的文件
				if (!this.isEligibleForWordCount(file)) return;
				
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const isActiveFile = activeView?.file?.path === file.path;

				// 如果不是当前活动文件，说明是通过其他方式修改的（如批量操作、便签保存）
				// 需要更新每日历史统计
				// 注：_合并章节 文件已在 isEligibleForWordCount 中被拦截，无需重复判断
				if (!isActiveFile) {
					
					try {
						const content = await this.app.vault.cachedRead(file);
						const newWordCount = this.calculateAccurateWords(content);
						
						// 从缓存中获取旧的字数
						const oldWordCount = this.cacheManager.getFileCache(file.path);
						
						// [BUGFIX] 如果是新文件、刚被重命名的文件、或刚通过云同步进入工作区的文件，
						// 缓存中可能没有它，不能视为 0 字，否则会导致历史字数暴涨！
						if (oldWordCount === null) {
							// 没有旧数据，不计算增量，直接更新缓存即可
							this.cacheManager.updateFileCache(file, newWordCount, this.app.vault);
							
							// 使用防抖更新缓存和刷新显示
							this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
								this.updateFileCacheAndRefresh(file);
							}, 500);
							return;
						}

						const delta = newWordCount - oldWordCount;
						if (delta !== 0) {
							// [BUGFIX] 无论布局是否就绪，都必须立即更新缓存基准！
							// 否则，如果在启动过程中文件发生了修改（如同步、索引更新），
							// 缓存将维持旧值，导致布局就绪后的下一次修改产生一个包含启动期所有变动的大 delta。
							this.cacheManager.updateFileCache(file, newWordCount, this.app.vault);

							// 只有在布局就绪后才记录历史增量，避免启动时的系统性微差导致的统计异常
							if (this.isLayoutReady) {
								const today = window.moment().format('YYYY-MM-DD');
								this.historyManager.addWords(today, delta);
								
								// [BUGFIX] 同时更新本次运行的累计字数，确保非活动文件的修改（如便签、同步）
								// 也能即时反映在状态栏和实时统计视图中。
								this.sessionAddedWords += delta;

								// 防抖保存设置（历史数据会在独立周期保存）
								this.adaptiveDebounceManager.debounceFixed('save-settings', () => {
									this.saveSettings().catch(err => {
										console.error('[Plugin] 保存设置失败:', err);
									});
								}, 1000);
							}
						}
					} catch (error) {
						console.error('[Plugin] 更新每日历史统计失败:', error);
					}
				}

				// 使用防抖（500ms）更新缓存和刷新显示
				this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.updateFileCacheAndRefresh(file);
				}, 500);
			}
		}));
		
		// 监听文件删除事件
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				// 只处理符合字数统计条件的文件
				if (!this.isEligibleForWordCount(file)) return;
				
				// 使缓存失效
				this.cacheManager.invalidateCache(file.path, this.app.vault);
				
				// 防抖刷新显示
				this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.refreshFolderCounts();
				}, 500);
			}
		}));
		
		// 监听文件重命名事件
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				// 重命名时，旧文件虽然没了，但新文件如果不符合条件（例如重命名为非章节名），就不该更新它的缓存。
				// 但如果是从章节名改成了非章节名，我们也应该把旧名字从缓存中删掉。
				if (!this.isFileInWorkspace(file)) return;
				
				// [BUGFIX] 重命名时，应该将旧路径的字数转移到新路径的缓存中！
				// 否则下次 modify 时，getFileCache 返回 null，会被当成全新的文件（之前是 0）导致字数暴涨！
				const oldCache = this.cacheManager.getFileCache(oldPath);
				
				this.cacheManager.invalidateCache(oldPath, this.app.vault);
				
				if (this.isEligibleForWordCount(file) && oldCache !== null) {
					// 主动设置新路径的缓存，防止被后续操作误判为新文件
					this.cacheManager.updateFileCache(file, oldCache, this.app.vault);
				}

				this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
					this.updateFileCacheAndRefresh(file);
				}, 500);
			}
		}));
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
				this.refreshFolderCounts();
			}, 500);
		}));

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
		
		// 确保 Worker 已初始化
		if (!this.worker) {
			this.setupWorker();
		}
		
		this.isTracking = true;
		this.lastTickTime = Date.now();
		this.lastEditTime = Date.now(); // 立即激活输入状态，避免一开始就被算作摸鱼
		
		this.worker?.postMessage('start');
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
		this.worker?.postMessage('stop');
		this.editorTracker.updateWordCount();
		this.exportLegacyOBS(true);
		this.refreshStatusViews();
		new Notice("[已暂停] 专注计时已暂停");
	}

	private setupDesktopFeatures(): void {

		this.setupWorker();

		// 启动 OBS 叠加层 HTTP Server
		if (this.settings.enableObs) {
			this.obsServer = new ObsOverlayServer(this, this.settings.obsPort);
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
		this.registerMarkdownPostProcessor((el, ctx) => {
			const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (!(file instanceof TFile)) return;

			// 只在伏笔文件中生效
			const foreshadowingFileName = (this.settings.foreshadowing?.fileName || '伏笔') + '.md';
			if (file.name !== foreshadowingFileName) return;

			// 查找所有包含 **状态**：未回收 的段落
			el.querySelectorAll('p, li').forEach((p) => {
				const text = p.textContent || '';
				if (!text.includes('状态') || !text.includes('未回收')) return;

				// 找到包含"状态"的 strong 元素
				const strongs = p.querySelectorAll('strong');
				let statusStrong: Element | null = null;
				strongs.forEach(s => {
					if (s.textContent === '状态') statusStrong = s;
				});
				if (!statusStrong) return;

				// 注入复选框
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.title = '标记为已回收';
				checkbox.style.cssText = 'margin-left:8px;cursor:pointer;vertical-align:middle;width:15px;height:15px;accent-color:var(--interactive-accent);';

				checkbox.addEventListener('change', async (e) => {
					e.preventDefault();
					checkbox.checked = false; // 先恢复，等用户确认后再更新文件

					// 用 ctx.getSectionInfo 获取当前段落所在的行号范围
					// 然后向上查找 H2 标题，定位目标
					const content = await this.app.vault.read(file);
					const lines = content.split('\n');

					// 找到包含"**状态**：未回收"的段落行
					const sectionInfo = ctx.getSectionInfo(el);
					if (!sectionInfo) return;

					// 从文件内容中找到对应的状态行，向上查找 H2 标题
					let titleLine = -1;
					let createdAt = '';
					let sourceFileName = '';
					let contentPreview = '';

					for (let i = sectionInfo.lineStart; i >= 0; i--) {
						const match = lines[i].match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
						if (match) {
							sourceFileName = match[1];
							createdAt = match[2]?.trim() || '';
							titleLine = i;
							break;
						}
					}

					if (titleLine === -1) return;

					// 提取内容预览（第一个引用行）
					for (let i = titleLine + 1; i < lines.length; i++) {
						if (lines[i].startsWith('> ')) {
							contentPreview = lines[i].replace(/^> /, '');
							break;
						}
						if (/^## \[\[/.test(lines[i])) break;
					}

					new ForeshadowingRecoveryModal(this.app, contentPreview, file.parent?.path || '', async (recoveryFileNames) => {
						const success = await this.foreshadowingManager.markAsRecovered(
							file, sourceFileName, createdAt, recoveryFileNames
						);
						if (success) {
							const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
							new Notice(`[成功] 已标记为已回收：${fileList}`);
						} else {
							new Notice('[错误] 未找到对应的伏笔条目');
						}
					}).open();
				});

				p.appendChild(checkbox);
			});
		});
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
				(leaf.view as any).renderNotes?.();
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
				const currentContent = note.state.isEditing ? (note as any).textareaEl?.value : note.state.content;
				if (currentContent !== undefined) note.state.content = currentContent;
				this.stickyNoteManager.updateNote(note.state);
				note.destroy();
			});
			this.activeNotes = [];
		}
		
		// 4. 停止 Worker
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}

		// 5. 清理定时器和防抖
		this.adaptiveDebounceManager.cancelAll();
		if (this.workerRestartTimer) {
			clearTimeout(this.workerRestartTimer);
			this.workerRestartTimer = null;
		}

		// 6. 移除样式
		if (this.styleManager) {
			this.styleManager.removeGlobalStyles();
			this.styleManager.removeEyeCare();
		}

		// 7. 卸载文件浏览器补丁
		if (this.fileExplorerPatcher) {
			this.fileExplorerPatcher.disable();
			this.fileExplorerPatcher.unpatch();
		}

		// 8. 尽力保存数据（fire-and-forget，Obsidian 不会等待异步 onunload）
		// 注意：大部分数据在运行过程中已通过队列持续保存，此处是最后的兜底
		this.saveSettings().catch(e => console.error('[WebNovel Assistant] 卸载时保存设置失败:', e));
		this.historyManager.saveHistory().catch(e => console.error('[WebNovel Assistant] 卸载时保存历史失败:', e));
		this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes()).catch(e => console.error('[WebNovel Assistant] 卸载时保存便签失败:', e));

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

	injectGlobalStyles(): void {
		this.styleManager.injectGlobalStyles();
	}

	removeGlobalStyles(): void {
		this.styleManager.removeGlobalStyles();
	}

	applyEyeCare(): void {
		this.styleManager.applyEyeCare();
	}

	removeEyeCare(): void {
		this.styleManager.removeEyeCare();
	}

	setupWorker() {
		// 检查是否达到最大重启次数
		if (this.workerRestartAttempts >= this.MAX_WORKER_RESTARTS) {
			new Notice('[警告] 时间追踪功能多次启动失败，已自动禁用。请重启 Obsidian 或检查浏览器设置。', 8000);
			console.error('[Plugin] Worker 达到最大重启次数，已停止尝试');
			return;
		}
		
		const workerCode = `
			let interval;
			self.onmessage = function(e) {
				if (e.data === 'start') {
					clearInterval(interval);
					interval = setInterval(() => self.postMessage('tick'), 1000);
				} else if (e.data === 'stop') {
					clearInterval(interval);
				}
			};
		`;
		const blob = new Blob([workerCode], { type: 'application/javascript' });
		// [BUGFIX] 先保存 URL 再立即 revoke：Worker 构造函数内部已持有资源引用，
		// 调用 revokeObjectURL 不影响 Worker 运行，但可释放浏览器端的 URL 注册表条目，
		// 防止每次 Worker 重启时产生内存泄漏。
		const blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(blobUrl);
		URL.revokeObjectURL(blobUrl);

		this.worker.onerror = (error) => {
			this.workerRestartAttempts++;
			console.error(
				`[WebNovel Assistant] Worker 错误 (尝试 ${this.workerRestartAttempts}/${this.MAX_WORKER_RESTARTS}):`,
				'\n  消息:', error.message,
				'\n  文件:', error.filename,
				'\n  行号:', error.lineno,
				'\n  列号:', error.colno
			);

			const wasTracking = this.isTracking;

			if (this.worker) {
				this.worker.terminate();
				this.worker = null;
			}

			// 清除之前的重启定时器
			if (this.workerRestartTimer) {
				clearTimeout(this.workerRestartTimer);
				this.workerRestartTimer = null;
			}

			this.workerRestartTimer = window.setTimeout(() => {
				console.log('[WebNovel Assistant] 正在重启 Worker...');

				this.setupWorker();

				if (wasTracking && this.worker) {
					this.worker.postMessage('start');
					// 重置 lastTickTime，避免重启后的第一个 tick 计入停机时间
					this.lastTickTime = Date.now();
					console.log('[WebNovel Assistant] Worker 已重启，追踪状态已恢复');
				}
				
				// 通知用户
				if (this.workerRestartAttempts < this.MAX_WORKER_RESTARTS) {
					new Notice('[警告] 时间追踪 Worker 已自动重启\n追踪功能已恢复正常', 5000);
				}
			}, 5000);
		};
		
		this.worker.onmessage = () => {
		    if (!this.isTracking) return;
		    const now = Date.now();
		    const delta = now - this.lastTickTime;
		    this.lastTickTime = now;
		    
		    const isAppFocused = document.hasFocus();
		    const isTypingActive = (now - this.lastEditTime) < this.settings.idleTimeoutThreshold;

		    const today = window.moment().format('YYYY-MM-DD');

		    if (isAppFocused && isTypingActive) {
		        this.focusMs += delta;
		        this.historyManager.addFocusTime(today, delta);
		    } else {
		        this.slackMs += delta;
		        this.historyManager.addSlackTime(today, delta);
		    }
		    
		    // 防抖保存历史数据（60秒后保存）
		    this.adaptiveDebounceManager.debounceFixed('save-history-worker', () => {
		        this.historyManager.saveHistory().catch(err => {
		            console.error('[Plugin] 保存历史数据失败:', err);
		        });
		    }, 60000);
		    
			this.refreshStatusViews();
			
			if (this.settings.enableLegacyObsExport) this.exportLegacyOBS();
			if (this.settings.enableObs && this.obsServer) {
			}
		};
		
		// Worker 成功运行 60 秒后重置重启计数器（只设置一次）
		if (this.workerRestartAttempts > 0) {
			setTimeout(() => {
				this.workerRestartAttempts = 0;
				console.log('[Plugin] Worker 运行稳定，重启计数器已重置');
			}, 60000);
		}
	}

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
		if (!isDesktop() || !this.settings.enableLegacyObsExport || !this.settings.obsPath) return;
		try {
			const fs = window.require('fs') as import('./src/types/node').NodeFS;
			const path = window.require('path') as import('./src/types/node').NodePath;
			const dir = this.settings.obsPath;
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

			const totalSec = Math.floor((this.focusMs + this.slackMs) / 1000);
			const focusSec = Math.floor(this.focusMs / 1000);
			const slackSec = totalSec - focusSec;

			fs.writeFileSync(path.join(dir, 'obs_focus_time.txt'), formatTime(focusSec), 'utf8');
			fs.writeFileSync(path.join(dir, 'obs_slack_time.txt'), formatTime(slackSec), 'utf8');
			fs.writeFileSync(path.join(dir, 'obs_total_time.txt'), formatTime(totalSec), 'utf8');
			fs.writeFileSync(path.join(dir, 'obs_words_done.txt'), Math.max(0, this.sessionAddedWords).toString(), 'utf8');

			let currentGoal = this.settings.defaultGoal;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file) {
				const cache = this.app.metadataCache.getFileCache(view.file);
				const fmGoal = parseInt(cache?.frontmatter?.['word-goal']);
				if (!isNaN(fmGoal)) currentGoal = fmGoal;
			}
			fs.writeFileSync(path.join(dir, 'obs_words_goal.txt'), currentGoal.toString(), 'utf8');
		} catch (e) { 
			if (force) {
				console.error('[WebNovel Assistant] Legacy OBS export failed:', e);
			} else {
				console.warn('[WebNovel Assistant] Legacy OBS export failed (silent mode):', e);
			}
		}
	}

	getObsStats(): ObsStatsPayload {
		return this.obsHtmlBuilder.getObsStats();
	}

	buildObsOverlayHtml(): string {
		return this.obsHtmlBuilder.buildObsOverlayHtml();
	}
	// [BUGFIX] 此方法内部无任何 await，移除多余的 async 标记，
	// 避免调用方误以为需要 await 从而产生隐式的 Promise 包装开销。
	refreshFolderCounts() {
		try {
			const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
			if (!fileExplorer || !fileExplorer.view) return;

			const view = fileExplorer.view as any;
			if (!view.fileItems || typeof view.fileItems !== 'object') return;
			const fileExplorerItems = view.fileItems;

			// 如果功能关闭，清理所有已存在的统计标记并退出
			if (!this.settings.showExplorerCounts) {
				for (const path in fileExplorerItems) {
					const item = fileExplorerItems[path];
					if (item.el) {
						const countEl = this.wordCountElCache.get(item.el) || item.el.querySelector('.folder-word-count');
						if (countEl) {
							countEl.remove();
							this.wordCountElCache.delete(item.el);
						}
					}
				}
				return;
			}
			// --- 使用缓存获取字数 ---
			let updatedCount = 0;
			for (const path in fileExplorerItems) {
				const item = fileExplorerItems[path];
				// 仅处理 TFolder 和 .md TFile
				if (item.el && (item.file instanceof TFolder || (item.file instanceof TFile && item.file.extension === 'md'))) {
					
					// 检查是否在工作区内
					let isInWorkspace = true;
					if (item.file instanceof TFile) {
						isInWorkspace = this.isEligibleForWordCount(item.file);
					} else if (item.file instanceof TFolder) {
						if (this.settings.workspaceFolders && this.settings.workspaceFolders.length > 0) {
							const folderPath = item.file.path;
							isInWorkspace = this.settings.workspaceFolders.some(workspace => {
								const normalizedWorkspace = workspace.replace(/^\/+|\/+$/g, '');
								return folderPath.startsWith(normalizedWorkspace) || normalizedWorkspace.startsWith(folderPath);
							});
						}
					}
					
					if (!isInWorkspace) continue;
					
					// 从缓存获取字数
					const count = this.cacheManager.getFolderCount(path);
					if (count === null) continue;
					
					const labelText = count > 0 ? ` (${formatCount(count)})` : "";
					let countEl = this.wordCountElCache.get(item.el) as HTMLElement;
					
					if (!countEl) {
						// 尝试从 DOM 获取（可能是上次遗留的）
						countEl = item.el.querySelector('.folder-word-count') as HTMLElement;
						if (!countEl) {
							const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
							if (titleContent) {
								countEl = titleContent.createEl('span', { cls: 'folder-word-count' });
								countEl.style.fontSize = '0.8em';
								countEl.style.opacity = '0.5';
								countEl.style.marginLeft = '5px';
							}
						}
						// 存入缓存
						if (countEl) {
							this.wordCountElCache.set(item.el, countEl);
						}
					}
					
					// 仅在文本变化时更新，减少 DOM 抖动
					if (countEl && countEl.textContent !== labelText) {
						countEl.textContent = labelText;
						updatedCount++;
					}
				}
			}
			
			if (updatedCount > 0) {
				console.debug(`[WebNovel Assistant] refreshFolderCounts: Updated ${updatedCount} items`);
			}
		} catch (error) {
			console.error('[WebNovel Assistant] refreshFolderCounts failed:', error);
		}
	}

}


