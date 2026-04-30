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
const DEFAULT_SETTINGS: AccurateCountSettings = {
	defaultGoal: 3000,
	dailyGoal: 5000,
	showGoal: true,
	showExplorerCounts: false, // 默认关闭，避免性能问题
	enableSmartChapterSort: false, // 默认关闭，避免与用户习惯冲突
	chapterNamingRules: [
		{ name: '阿拉伯数字（第1章、第01章）', pattern: '^第?(\\d+)[章节回卷部册篇]?', enabled: true },
		{ name: '中文数字（第一章、第二章）', pattern: '^第?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]?', enabled: true },
		{ name: '纯数字（1、01、001）', pattern: '^(\\d+)$', enabled: true },
	],
	workspaceFolders: [],
	enableObs: false,
	enableLegacyObsExport: false,
	obsPath: "",
	openNotes: [],
	noteOpacity: 0.9,
	dailyHistory: {}, // @deprecated 保留用于降级兼容，实际数据已迁移到 history-data.json
	idleTimeoutThreshold: 60 * 1000,
	noteThemes: [
		{ bg: '#FDF3B8', text: '#2C3E50' }, // 鹅黄色
		{ bg: '#FCDDEC', text: '#5D2E46' }, // 樱花粉
		{ bg: '#CCE8CF', text: '#2A4A30' }, // 豆沙绿
		{ bg: '#2C3E50', text: '#F8F9FA' }, // 暗夜蓝
		{ bg: '#E8DFF5', text: '#4A3B69' }, // 薰衣草
		{ bg: '#FDE0C1', text: '#593D2B' }  // 杏仁黄
	],
	obsPort: 24816,
	obsOverlayTheme: 'dark',
	obsOverlayOpacity: 0.85,
	obsCustomCss: '',
	obsShowFocusTime: true,
	obsShowSlackTime: true,
	obsShowTotalTime: true,
	obsShowTodayWords: true,
	obsShowDailyGoal: true,
	obsShowSessionWords: true, // 已恢复
	foreshadowing: {
		fileName: '伏笔',
		showTimestamp: true,
		defaultTags: ['人物', '情节', '世界观', '道具', '线索'],
	},
	timeline: {
		fileName: '时间线',
		defaultTypes: ['主线', '支线', '回忆', '伏笔线', '暗线'],
	},
	eyeCareEnabled: false,
	eyeCareColor: '#E8F5E9',
	showMobileFloatingStats: true, // 默认显示移动端浮窗
	
	// 沉浸模式默认设置
	immersiveShowChapterList: true,
	immersiveShowReference: true,
	immersiveShowStickyNotes: true,
	immersiveShowForeshadowing: true,
	immersiveShowTimeline: true,
	immersiveShowTotalTime: true,
	immersiveShowFocusTime: true,
	immersiveShowSlackTime: true,
	immersiveShowChapterProgress: true,
	immersiveShowDailyProgress: true,
	immersiveShowSessionWords: true,
	nextNoteThemeIndex: 0,
	immersivePanelPosition: 'bottom',
	immersiveLeftSize: 11,
	immersiveRightSize: 30,
	immersiveBottomSize: 20,
	immersiveBottomInternalSizes: [70, 16, 14],
	stickyNoteAutoSave: true,
	immersiveNoteSize: 280,
	immersiveNoteFontSize: 14,
	immersiveTypewriterMode: false,
};

export default class AccurateChineseCountPlugin extends Plugin implements WebNovelAssistantPlugin {

	
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
	private isLayoutReady: boolean = false;

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
			
			this.addCommand({
				id: 'copy-full-content-mobile',
				name: '复制全文',
				editorCallback: (editor, view) => {
					const content = editor.getValue();
					navigator.clipboard.writeText(content).then(() => {
						new Notice(`[成功] 已复制全文（${content.length} 字符）`);
					}).catch(err => {
						new Notice('[错误] 复制失败，请重试');
					});
				}
			});
			
			this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
					});
					menu.addItem((item) => {
						item.setTitle('复制全文').setIcon('copy').onClick(async () => {
							try {
								const content = await this.app.vault.read(file);
								await navigator.clipboard.writeText(content);
								new Notice(`[成功] 已复制全文（${content.length} 字符）`);
							} catch (err) {
								console.error('[Plugin] 复制失败:', err);
								new Notice('[错误] 复制失败，请重试');
							}
						});
					});
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
		
		// 注册功能
		this.registerCommonViews();
		this.registerCommonRibbonIcons();
		this.registerCommonCommands();
		this.registerCommonMenus();

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
				// 只处理工作区内的文件
				if (!this.isFileInWorkspace(file)) return;
				
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const isActiveFile = activeView?.file?.path === file.path;

				// 如果不是当前活动文件，说明是通过其他方式修改的（如批量操作、便签保存）
				// 需要更新每日历史统计
				if (!isActiveFile) {
					// 排除合并章节文件（文件名包含 "_合并章节"）
					const isMergedFile = file.basename.includes('_合并章节');
					if (isMergedFile) {
						// 仍然更新缓存，但不计入历史统计
						this.adaptiveDebounceManager.debounceFixed('folder-refresh', () => {
							this.updateFileCacheAndRefresh(file);
						}, 500);
						return;
					}
					
					try {
						const content = await this.app.vault.cachedRead(file);
						const newWordCount = this.calculateAccurateWords(content);
						
						// 从缓存中获取旧的字数
						const oldWordCount = this.cacheManager.getFileCache(file.path) || 0;
						const delta = newWordCount - oldWordCount;

						// [BUGFIX] 只有在布局就绪后才记录历史增量，避免启动时的系统性微差导致的负数
						if (delta !== 0 && this.isLayoutReady) {
							// [BUGFIX] 立即同步更新内存缓存，防止因为防抖导致突发多次 modify 事件时重复计算相同的 delta
							this.cacheManager.updateFileCache(file, newWordCount, this.app.vault);

							const today = window.moment().format('YYYY-MM-DD');
							this.historyManager.addWords(today, delta);

							// 防抖保存设置（历史数据会在独立周期保存）
							this.adaptiveDebounceManager.debounceFixed('save-settings', () => {
								this.saveSettings().catch(err => {
									console.error('[Plugin] 保存设置失败:', err);
								});
							}, 1000);
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
				// 只处理工作区内的文件
				if (!this.isFileInWorkspace(file)) return;
				
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
				// 只处理工作区内的文件
				if (!this.isFileInWorkspace(file)) return;
				this.cacheManager.invalidateCache(oldPath, this.app.vault);
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
		this.addCommand({
			id: 'toggle-tracking',
			name: '开始/暂停 专注时间统计',
			callback: () => {
				if (this.isTracking) this.stopTracking();
				else this.startTracking();
			}
		});

		this.addCommand({
			id: 'create-blank-sticky-note',
			name: '新建空白悬浮便签',
			callback: () => {
				this.createStickyNote({ content: '', title: '新便签' });
			}
		});

		this.addCommand({
			id: 'reset-stream-session',
			name: '重置直播统计数据 (清空时长和净增字数)',
			callback: () => {
				this.focusMs = 0;
				this.slackMs = 0;
				this.sessionAddedWords = 0;
				this.isTracking = false; 
				this.worker?.postMessage('stop');
				this.editorTracker.handleFileChange(); 
				this.exportLegacyOBS(true); 
				this.refreshStatusViews();
				new Notice('直播数据已重置！统计已暂停，请手动开始新的场次。');
			}
		});

		this.addCommand({
			id: 'reset-immersive-layout',
			name: '重置沉浸模式布局 (回到默认比例和位置)',
			callback: () => {
				this.settings.immersiveLayout = null;
				this.saveSettings();
				new Notice('沉浸模式布局已重置，下次进入生效');
			}
		});

		this.addCommand({
			id: 'create-next-chapter',
			name: '自动创建下一章 (智能递增)',
			editorCallback: async (editor, view) => {
				const currentFile = view.file;
				if (!currentFile) return;

				const folderPath = currentFile.parent;
				const siblingNames = folderPath
					? folderPath.children
						.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
						.map(f => f.basename)
					: [];

				const newFileName = ChapterSorter.getNextChapterName(currentFile.basename, siblingNames);
				if (!newFileName) {
					new Notice('当前文件名无法识别章节号（仅支持数字或汉字），无法自动创建');
					return;
				}

				const newFilePath = folderPath ? `${folderPath.path}/${newFileName}` : newFileName;
				const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
				if (existingFile) {
					await this.app.workspace.getLeaf(false).openFile(existingFile as TFile);
					return;
				}
				try {
					const newFile = await this.app.vault.create(newFilePath, '');
					await this.app.workspace.getLeaf(false).openFile(newFile);
					new Notice(`[成功] 已创建: ${newFileName}`);
				} catch (error) {
					console.error(error);
					new Notice(`[错误] 创建失败: ${error}`);
				}
			}
		});

		// 桌面端专属：文件菜单 - 抽出为便签和合并章节
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') {
				menu.addItem((item) => {
					item.setTitle('抽出为便签').setIcon('popup-open').onClick(() => { 
						this.createStickyNote({ file: file });
					});
				});
			}

			if (file instanceof TFolder) {
				menu.addItem((item) => {
					item.setTitle('合并章节')
						.setIcon('documents')
						.onClick(async () => {
							const notice = new Notice(`正在扫描并合并${file.name}...`, 0);
							const mdFiles: TFile[] = [];
							
							const collectFiles = (folder: TFolder) => {
								for (const child of folder.children) {
									if (child instanceof TFile && child.extension === 'md') {
										// 只收集智能排序识别的文件
										if (ChapterSorter.isChapterFile(child.name)) {
											mdFiles.push(child);
										}
									} else if (child instanceof TFolder) {
										collectFiles(child);
									}
								}
							};
							collectFiles(file);

							if (mdFiles.length === 0) {
								notice.hide();
								new Notice(`文件夹${file.name}中没有找到章节文件`);
								return;
							}

							// 按章节编号排序（使用 ChapterSorter 的排序逻辑）
							mdFiles.sort((a, b) => ChapterSorter.compareFiles(a, b));

							let mergedContent = `# 合并章节：${file.name}\n\n`;
							let totalWords = 0;

							for (const mdFile of mdFiles) {
								const content = await this.app.vault.cachedRead(mdFile);
								mergedContent += `\n\n## ${mdFile.basename}\n\n`;
								mergedContent += content;
								totalWords += this.calculateAccurateWords(content);
							}

							let exportPath = `${file.parent?.path === '/' ? '' : file.parent?.path + '/'}${file.name}_合并章节.md`;
							let counter = 1;
							while (this.app.vault.getAbstractFileByPath(exportPath)) {
								exportPath = `${file.parent?.path === '/' ? '' : file.parent?.path + '/'}${file.name}_合并章节(${counter}).md`;
								counter++;
							}

							try {
								const newFile = await this.app.vault.create(exportPath, mergedContent.trim());
								notice.hide();
								await this.app.workspace.getLeaf(false).openFile(newFile);
								new Notice(`[成功] 合并成功！\n已合并 ${mdFiles.length} 个章节\n总计 ${totalWords.toLocaleString()} 字`, 8000);
							} catch (error) {
								console.error(error);
								notice.hide();
								new Notice("合并失败，请检查文件权限");
							}
						});
				});
			}
		}));

		// 桌面端专属：编辑器菜单 - 抽出为便签
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
			if (editor.somethingSelected()) {
				menu.addItem((item) => {
					item.setTitle('抽出为便签').setIcon('quote').onClick(() => { 
						this.createStickyNote({ content: editor.getSelection(), title: '选中片段' });
					});
				});
			}
			if (view.file) {
				menu.addItem((item) => {
					item.setTitle('当前文件抽出为便签').setIcon('popup-open').onClick(() => { 
						this.createStickyNote({ file: view.file! });
					});
				});
			}
		}));

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
				setTimeout(() => {
					const success = this.fileExplorerPatcher.enable();
					if (success) {
						console.log('[WebNovel Assistant] Smart chapter sorting enabled');
					} else {
						console.warn('[WebNovel Assistant] Failed to enable smart chapter sorting');
					}
				}, 1000);
			});
		}

		this.addCommand({
			id: 'copy-obs-overlay-url',
			name: '复制 OBS 叠加层 URL 到剪贴板',
			callback: () => {
				const url = `http://127.0.0.1:${this.settings.obsPort}/`;
				navigator.clipboard.writeText(url);
				new Notice(`已复制: ${url}`);
			}
		});

		this.addCommand({
			id: 'refresh-chapter-sort',
			name: '手动刷新章节排序（通常不需要）',
			callback: () => {
				if (!this.settings.enableSmartChapterSort) {
					new Notice('请先在设置中启用"智能章节排序"功能');
					return;
				}
				this.fileExplorerPatcher.refreshManually();
				new Notice('[成功] 章节排序已刷新\n\n[提示] 排序会自动适应，通常不需要手动刷新');
			}
		});

		this.addCommand({
			id: 'rebuild-folder-cache',
			name: '重建文件夹字数缓存',
			callback: async () => {
				if (!this.settings.showExplorerCounts) {
					new Notice('请先在设置中启用"文件浏览器字数统计"功能');
					return;
				}
				
				// 清空缓存
				this.cacheManager.clearCache();
				
				// 重新构建
				const notice = new Notice('正在重建文件浏览器缓存...', 0);
				try {
					await this.cacheManager.buildInitialCache(
						this.app.vault,
						this.calculateAccurateWords.bind(this)
					);
					notice.hide();
					this.refreshFolderCounts();
					new Notice('[成功] 缓存重建完成！');
				} catch (error) {
					notice.hide();
					new Notice(`[错误] 缓存重建失败: ${error}`);
					console.error('[Plugin] 缓存重建失败:', error);
				}
			}
		});

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
	 * 注册共享视图（平板端和桌面端都需要）
	 */
	private registerCommonViews(): void {
		this.registerView(STATUS_VIEW_TYPE, (leaf) => new WritingStatusView(leaf, this));
		this.registerView(FORESHADOWING_VIEW_TYPE, (leaf) => new ForeshadowingView(leaf, this));
		this.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this));
		
		// 沉浸模式视图仅在桌面端注册
		if (isDesktop()) {
			this.registerView(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST, (leaf) => new ImmersiveChapterListView(leaf, this));
			this.registerView(VIEW_TYPES.IMMERSIVE_STICKY_NOTES, (leaf) => new ImmersiveStickyNotesView(leaf, this));
		}
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
	 * 注册共享命令（平板端和桌面端都需要）
	 */
	private registerCommonCommands(): void {
		this.addCommand({
			id: 'toggle-foreshadowing-view',
			name: '打开/关闭伏笔面板',
			callback: () => this.toggleForeshadowingView()
		});

		this.addCommand({
			id: 'toggle-timeline-view',
			name: '打开/关闭时间线面板',
			callback: () => this.toggleTimelineView()
		});

		this.addCommand({
			id: 'toggle-writing-status-view',
			name: '打开/关闭写作实时状态面板',
			callback: () => this.toggleStatusView()
		});

		// 沉浸模式命令仅限桌面端
		if (isDesktop()) {
			this.addCommand({
				id: 'toggle-immersive-mode',
				name: '进入/退出全屏沉浸写作模式',
				callback: () => this.immersiveModeManager.toggleImmersiveMode()
			});
		}

		this.addCommand({
			id: 'reset-immersive-layout',
			name: '重置沉浸模式布局 (修复界面错乱)',
			callback: async () => {
				this.settings.immersiveLayout = null;
				await this.saveSettings();
				new Notice('沉浸模式布局已重置，下次进入将使用默认比例。');
			}
		});

		this.addCommand({
			id: 'mark-as-foreshadowing',
			name: '标注为伏笔',
			editorCheckCallback: (checking, editor, view) => {
				const selection = editor.getSelection();
				if (!selection || !selection.trim()) return false;
				if (checking) return true;

				const sourceFile = view.file;
				if (!sourceFile) return false;

				const doMark = (description: string, tags: string[]) => {
					this.foreshadowingManager.addForeshadowing(sourceFile, selection, description, tags)
						.then(({ file: targetFile, merged }) => {
							if (merged) {
								new Notice(`[成功] 已合并到同名伏笔条目「${targetFile.name}」`, 5000);
							} else {
								new Notice(`[成功] 已标注为伏笔，保存至「${targetFile.name}」`, 5000);
							}
							// 桌面端提供打开伏笔文件的选项
							if (isDesktop()) {
								const openNotice = new Notice(`[提示] 点击此处打开伏笔文件`, 8000);
								openNotice.noticeEl.style.cursor = 'pointer';
								openNotice.noticeEl.onclick = () => {
									this.foreshadowingManager.openForeshadowingFile(targetFile);
									openNotice.hide();
								};
							}
						})
						.catch((err) => {
							console.error('[ForeshadowingManager] addForeshadowing failed:', err);
							new Notice(`[错误] 标注失败：${err}`);
						});
				};

				if (!this.foreshadowingManager.foreshadowingFileExists(sourceFile)) {
					const fileName = this.settings.foreshadowing?.fileName || '伏笔';
					const folderPath = sourceFile.parent?.path || '';
					new ConfirmCreateForeshadowingFileModal(this.app, fileName, folderPath, () => {
						new ForeshadowingInputModal(this.app, this, sourceFile.basename, selection, doMark).open();
					}).open();
				} else {
					new ForeshadowingInputModal(this.app, this, sourceFile.basename, selection, doMark).open();
				}
				return true;
			}
		});

		this.addCommand({
			id: 'mark-foreshadowing-recovered',
			name: '标记伏笔已回收',
			editorCheckCallback: (checking, editor, view) => {
				const file = view.file;
				if (!file) return false;
				const foreshadowingFileName = (this.settings.foreshadowing?.fileName || '伏笔') + '.md';
				if (file.name !== foreshadowingFileName) return false;
				if (checking) return true;

				const cursorLine = editor.getCursor().line;
				const entryInfo = this.foreshadowingManager.getEntryAtCursor(editor, cursorLine);
				if (!entryInfo) {
					new Notice('[错误] 请将光标放在伏笔条目上');
					return true;
				}

				new ForeshadowingRecoveryModal(this.app, entryInfo.contentPreview, file.parent?.path || '', async (recoveryFileNames) => {
					const success = await this.foreshadowingManager.markAsRecovered(
						file, entryInfo.sourceFile, entryInfo.createdAt, recoveryFileNames
					);
					if (success) {
						const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
						new Notice(`[成功] 已标记为已回收：${fileList}`);
					} else {
						new Notice('[错误] 未找到对应的伏笔条目，请确认光标位置');
					}
				}).open();
				return true;
			}
		});
	}

	/**
	 * 注册共享菜单（平板端和桌面端都需要）
	 */
	private registerCommonMenus(): void {
		// 文件右键菜单
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') {
				menu.addItem((item) => {
					item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
				});
			}
		}));

		// 编辑器右键菜单
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
			if (editor.somethingSelected()) {
				menu.addItem((item) => {
					item.setTitle('标注为伏笔').setIcon('bookmark').onClick(() => {
						(this.app as any).commands.executeCommandById('web-novel-assistant:mark-as-foreshadowing');
					});
				});
				menu.addItem((item) => {
					item.setTitle('添加到时间线').setIcon('calendar-clock').onClick(async () => {
						const selection = editor.getSelection();
						if (!selection.trim()) { new Notice('请先选中文字'); return; }
						const sourceFile = view.file?.basename || '';
						const folderPath = view.file?.parent?.path || '';

						new TimelineAddFromSelectionModal(
							this.app,
							this,
							this.settings.timeline?.fileName || '时间线',
							selection.trim(),
							sourceFile,
							folderPath,
							async (entry) => {
								const manager = new TimelineManager(this.app, this, folderPath);
								await manager.appendEntry({
									time: entry.time,
									description: entry.description,
									chapter: entry.chapter,
									type: entry.type,
									rawBlock: '',
								});
								new Notice('[成功] 已添加到时间线');
								const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
								if (leaves.length > 0) {
									// 确保文件写入完成后再刷新
									await new Promise(resolve => setTimeout(resolve, 100));
									await (leaves[0].view as TimelineView).refresh();
								}
							}
						).open();
					});
				});
			}
			if (view.file) {
				menu.addItem((item) => {
					item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, view.file!).open(); });
				});
			}
		}));
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
		
		// 平板端也启用常用的面板和命令
		this.registerCommonViews();
		this.registerCommonRibbonIcons();
		this.registerCommonCommands();
		this.registerCommonMenus();

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
		this.app.workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES).forEach(leaf => {
			if (leaf.view.getViewType() === VIEW_TYPES.IMMERSIVE_STICKY_NOTES) {
				(leaf.view as any).renderNotes?.();
			}
		});
	}

	async onunload() {
		// 0. 确保退出沉浸模式
		if (this.immersiveModeManager) {
			await this.immersiveModeManager.exitImmersiveMode();
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

		// 3. 卸载所有活跃便签并保存状态
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
		}

		// 8. 强制保存数据
		try {
			await this.saveSettings();
			await this.historyManager.saveHistory();
			await this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes());
			console.log('[WebNovel Assistant] 所有数据已安全保存');
		} catch (e) {
			console.error('[WebNovel Assistant] 卸载时保存数据失败:', e);
		}

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
			const workspaceFiles = allFiles.filter(f => this.isFileInWorkspace(f));
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
				this.isFileInWorkspace.bind(this)
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

	/**
	 * 统一的视图切换方法
	 * @param viewType 视图类型
	 */
	private async toggleView(viewType: string): Promise<void> {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(viewType);
		
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			// 在侧边栏打开
			let leaf: WorkspaceLeaf | null = null;
			
			// 尝试获取右侧边栏叶子
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: viewType, active: true });
			} else {
				// 备选方案：创建一个新的叶子
				leaf = workspace.getLeaf('tab');
				await leaf.setViewState({ type: viewType, active: true });
			}
			
			if (leaf) {
				workspace.revealLeaf(leaf);
				// 如果是移动端或平板端，确保侧边栏展开
				if (isMobile()) {
					(this.app.workspace as any).rightSplit?.expand();
				}
			}
		}
	}

	async toggleStatusView() {
		await this.toggleView(STATUS_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = await this.settingsManager.loadSettings();
	}

	async toggleForeshadowingView() {
		await this.toggleView(FORESHADOWING_VIEW_TYPE);
	}

	async toggleTimelineView() {
		await this.toggleView(TIMELINE_VIEW_TYPE);
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
			return filePath.startsWith(normalizedFolder + '/') || filePath.startsWith(normalizedFolder);
		});
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
		this.worker = new Worker(URL.createObjectURL(blob));

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
	async refreshFolderCounts() {
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
						const countEl = item.el.querySelector('.folder-word-count');
						if (countEl) countEl.remove();
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
						isInWorkspace = this.isFileInWorkspace(item.file);
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
					let countEl = item.el.querySelector('.folder-word-count') as HTMLElement;
					
					if (!countEl) {
						const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
						if (titleContent) {
							countEl = titleContent.createEl('span', { cls: 'folder-word-count' });
							countEl.style.fontSize = '0.8em';
							countEl.style.opacity = '0.5';
							countEl.style.marginLeft = '5px';
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


