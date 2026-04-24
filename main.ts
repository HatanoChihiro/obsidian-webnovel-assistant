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
import { DebounceManager } from './src/services/DebounceManager';
import { AdaptiveDebounceManager } from './src/services/AdaptiveDebounceManager';
import { SettingsManager } from './src/core/SettingsManager';
import { FileExplorerPatcher } from './src/services/FileExplorerPatcher';
import { ChapterSorter } from './src/services/ChapterSorter';
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
	dailyHistory: {},
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
}

export default class AccurateChineseCountPlugin extends Plugin implements WebNovelAssistantPlugin {

	
	settings!: AccurateCountSettings;
	statusBarItemEl!: HTMLElement;

	isTracking: boolean = false;
	focusMs: number = 0;
	slackMs: number = 0;
	lastTickTime: number = 0;

	sessionAddedWords: number = 0;
	lastFileWords: number = 0; 

	lastEditTime: number = Date.now();
	
	worker: Worker | null = null;
	activeNotes: FloatingStickyNote[] = [];
	obsServer: ObsOverlayServer | null = null;
	mobileFloatingStats: MobileFloatingStats | null = null;

	// 服务优化组件
	cacheManager: CacheManager;
	debounceManager: DebounceManager;
	adaptiveDebounceManager: AdaptiveDebounceManager;
	settingsManager: SettingsManager;
	fileExplorerPatcher: FileExplorerPatcher;
	foreshadowingManager!: ForeshadowingManager;

	constructor(app: App, manifest: any) {
		super(app, manifest);
		this.cacheManager = new CacheManager(this);
		this.debounceManager = new DebounceManager();
		this.adaptiveDebounceManager = new AdaptiveDebounceManager();
		this.settingsManager = new SettingsManager(this, DEFAULT_SETTINGS);
		this.fileExplorerPatcher = new FileExplorerPatcher(this.app);
	}

	async onload() {
		// 加载核心功能（桌面端、平板端和移动端功能）
		await this.setupCoreFeatures();
		
		// 定期保存设置和缓存
		this.registerInterval(window.setInterval(() => {
			if (this.isTracking) {
				this.saveSettings();
			}
			// 定期保存缓存（每分钟）
			this.cacheManager.saveCache().catch(err => {
				console.error('[Plugin] 定期保存缓存失败:', err);
			});
		}, 60 * 1000));
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
		this.injectGlobalStyles();
		if (this.settings.eyeCareEnabled) this.applyEyeCare();
		this.statusBarItemEl = this.addStatusBarItem();
		this.addSettingTab(new AccurateCountSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on('editor-change', () => {
			// 使用自适应防抖：根据输入速度自动调整延迟
			this.adaptiveDebounceManager.debounce('editor-update', () => {
				this.handleEditorChange();
			});
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', this.handleFileChange.bind(this)));
		this.registerEvent(this.app.metadataCache.on('changed', () => {
			// 使用防抖避免高频更新
			this.debounceManager.debounce('word-count-update', () => {
				this.updateWordCount();
			}, 100);
		}));
		this.updateWordCount(); // 初始化状态栏显示

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
			if (this.settings.showMobileFloatingStats) {
				this.mobileFloatingStats = new MobileFloatingStats(this.app, this);
				this.app.workspace.onLayoutReady(() => {
					this.mobileFloatingStats?.load();
				});
				
				// 监听编辑器变化，更新浮窗（使用自适应防抖）
				this.registerEvent(this.app.workspace.on('editor-change', () => {
					this.adaptiveDebounceManager.debounce('mobile-stats-update', () => {
						this.mobileFloatingStats?.update();
					});
				}));
				this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
					this.mobileFloatingStats?.update();
				}));
			}
			
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
					this.debounceManager.debounce('mobile-folder-refresh', () => {
						this.refreshFolderCounts();
					}, 300);
				}
			}));
			
			// 移动端：注册"复制全文"命令（解决移动端全选限制）
			this.addCommand({
				id: 'copy-full-content-mobile',
				name: '复制全文',
				editorCallback: (editor, view) => {
					const content = editor.getValue();
					navigator.clipboard.writeText(content).then(() => {
						new Notice(`✅ 已复制全文（${content.length} 字符）`);
					}).catch(err => {
						console.error('[Plugin] 复制失败:', err);
						new Notice('❌ 复制失败，请重试');
					});
				}
			});
			
			// 手机端注册右键菜单（只在文件列表中有效）
			this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item.setTitle('设定本章目标字数').setIcon('target').onClick(() => { new GoalModal(this.app, file).open(); });
					});
					// 在文件菜单中添加"复制全文"选项
					menu.addItem((item) => {
						item.setTitle('复制全文').setIcon('copy').onClick(async () => {
							try {
								const content = await this.app.vault.read(file);
								await navigator.clipboard.writeText(content);
								new Notice(`✅ 已复制全文（${content.length} 字符）`);
							} catch (err) {
								console.error('[Plugin] 复制失败:', err);
								new Notice('❌ 复制失败，请重试');
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
		
		// 初始化伏笔管理器
		this.foreshadowingManager = new ForeshadowingManager(this.app, this);

		// 注册共享功能
		this.registerCommonViews();
		this.registerCommonRibbonIcons();
		this.registerCommonCommands();
		this.registerCommonMenus();

		// 桌面端专属：悬浮便签
		this.app.workspace.onLayoutReady(() => {
			this.settings.openNotes.forEach(state => {
				const note = new FloatingStickyNote(this.app, this, { state });
				note.load();
			});
			
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
					try {
						const content = await this.app.vault.cachedRead(file);
						const newWordCount = this.calculateAccurateWords(content);
						
						// 从缓存中获取旧的字数
						const oldWordCount = this.cacheManager.getFileCache(file.path) || 0;
						const delta = newWordCount - oldWordCount;

						// 只有当字数有变化时才更新历史统计
						if (delta !== 0) {
							const today = window.moment().format('YYYY-MM-DD');
							if (!this.settings.dailyHistory[today]) {
								this.settings.dailyHistory[today] = { focusMs: 0, slackMs: 0, addedWords: 0 };
							}
							this.settings.dailyHistory[today].addedWords += delta;

							// 防抖保存设置
							this.debounceManager.debounce('save-settings', () => {
								this.saveSettings();
							}, 1000);
						}
					} catch (error) {
						console.error('[Plugin] 更新每日历史统计失败:', error);
					}
				}

				// 使用防抖（500ms）更新缓存和刷新显示
				this.debounceManager.debounce('folder-refresh', () => {
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
				this.debounceManager.debounce('folder-refresh', () => {
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
				this.debounceManager.debounce('folder-refresh', () => {
					this.updateFileCacheAndRefresh(file);
				}, 500);
			}
		}));
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.debounceManager.debounce('folder-refresh', () => {
				this.refreshFolderCounts();
			}, 500);
		}));

		this.addRibbonIcon('sticky-note', '新建空白悬浮便签', () => {
			const note = new FloatingStickyNote(this.app, this, { content: '', title: '新便签' });
			note.load();
		});

		// 桌面端专属命令
		this.addCommand({
			id: 'toggle-tracking',
			name: '开始/暂停 摸鱼时间统计',
			callback: () => {
				this.isTracking = !this.isTracking;
				if (this.isTracking) {
					this.lastTickTime = Date.now();
					this.worker?.postMessage('start');
					new Notice("⏱️ 摸鱼时间统计已开始");
				} else {
					this.worker?.postMessage('stop');
					new Notice("⏸️ 摸鱼时间统计已暂停");
				}
				this.updateWordCount();
				this.exportLegacyOBS(true);
				this.refreshStatusViews(); 
			}
		});

		this.addCommand({
			id: 'create-blank-sticky-note',
			name: '新建空白悬浮便签',
			callback: () => {
				const stickyNote = new FloatingStickyNote(this.app, this, { content: '', title: '新便签' });
				stickyNote.load();
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
				this.handleFileChange(); 
				this.exportLegacyOBS(true); 
				this.refreshStatusViews();
				new Notice('直播数据已重置！统计已暂停，请手动开始新的场次。');
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
					new Notice(`✅ 已创建: ${newFileName}`);
				} catch (error) {
					console.error(error);
					new Notice(`❌ 创建失败: ${error}`);
				}
			}
		});

		// 桌面端专属：文件菜单 - 抽出为便签和合并章节
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') {
				menu.addItem((item) => {
					item.setTitle('抽出为便签').setIcon('popup-open').onClick(() => { 
						const stickyNote = new FloatingStickyNote(this.app, this, { file: file });
						stickyNote.load(); 
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
								new Notice(`✅ 合并成功！\n已合并 ${mdFiles.length} 个章节\n总计 ${totalWords.toLocaleString()} 字`, 8000);
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
						const note = new FloatingStickyNote(this.app, this, { content: editor.getSelection(), title: '选中片段' });
						note.load();
					});
				});
			}
			if (view.file) {
				menu.addItem((item) => {
					item.setTitle('当前文件抽出为便签').setIcon('popup-open').onClick(() => { 
						const note = new FloatingStickyNote(this.app, this, { file: view.file! });
						note.load();
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
				new Notice('✅ 章节排序已刷新\n\n💡 提示：排序会自动适应，通常不需要手动刷新');
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
					new Notice('✅ 缓存重建完成！');
				} catch (error) {
					notice.hide();
					new Notice(`❌ 缓存重建失败: ${error}`);
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
							new Notice(`✅ 已标记为已回收：${fileList}`);
						} else {
							new Notice('❌ 未找到对应的伏笔条目');
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
								new Notice(`✅ 已合并到同名伏笔条目「${targetFile.name}」`, 5000);
							} else {
								new Notice(`✅ 已标注为伏笔，保存至「${targetFile.name}」`, 5000);
							}
							// 桌面端提供打开伏笔文件的选项
							if (isDesktop()) {
								const openNotice = new Notice(`💡 点击此处打开伏笔文件`, 8000);
								openNotice.noticeEl.style.cursor = 'pointer';
								openNotice.noticeEl.onclick = () => {
									this.foreshadowingManager.openForeshadowingFile(targetFile);
									openNotice.hide();
								};
							}
						})
						.catch((err) => {
							console.error('[ForeshadowingManager] addForeshadowing failed:', err);
							new Notice(`❌ 标注失败：${err}`);
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
					new Notice('❌ 请将光标放在伏笔条目上');
					return true;
				}

				new ForeshadowingRecoveryModal(this.app, entryInfo.contentPreview, file.parent?.path || '', async (recoveryFileNames) => {
					const success = await this.foreshadowingManager.markAsRecovered(
						file, entryInfo.sourceFile, entryInfo.createdAt, recoveryFileNames
					);
					if (success) {
						const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
						new Notice(`✅ 已标记为已回收：${fileList}`);
					} else {
						new Notice('❌ 未找到对应的伏笔条目，请确认光标位置');
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
						this.app.commands.executeCommandById('web-novel-assistant:mark-as-foreshadowing');
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
								new Notice('✅ 已添加到时间线');
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
	 * 设置平板端中间模式
	 * 启用面板功能，但不启用重度功能（Worker、OBS、缓存）
	 */
	private setupTabletMode(): void {
		// 平板端：根据设置决定是否启用浮动字数统计窗口
		if (this.settings.showMobileFloatingStats) {
			this.mobileFloatingStats = new MobileFloatingStats(this.app, this);
			this.app.workspace.onLayoutReady(() => {
				this.mobileFloatingStats?.load();
			});
			
			// 监听编辑器变化，更新浮窗（使用自适应防抖）
			this.registerEvent(this.app.workspace.on('editor-change', () => {
				this.adaptiveDebounceManager.debounce('mobile-stats-update', () => {
					this.mobileFloatingStats?.update();
				});
			}));
			this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
				this.mobileFloatingStats?.update();
			}));
		}
		
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
					this.debounceManager.debounce('tablet-folder-refresh', () => {
						this.refreshFolderCounts();
					}, 300);
				}
			}));
		}

		// 初始化伏笔管理器
		this.foreshadowingManager = new ForeshadowingManager(this.app, this);

		// 注册共享功能
		this.registerCommonViews();
		this.registerCommonRibbonIcons();
		this.registerCommonCommands();
		this.registerCommonMenus();
	}

	onunload() {
		// 保存所有便签的当前状态（位置、大小、内容等）
		this.activeNotes.forEach(note => {
			const index = this.settings.openNotes.findIndex(n => n.id === note.state.id);
			if (index !== -1) {
				// 更新便签状态
				const currentContent = note.state.isEditing ? note.textareaEl.value : note.state.content;
				note.state.content = currentContent;
				this.settings.openNotes[index] = note.state;
			}
		});
		
		this.saveSettings();
		this.removeGlobalStyles();
		
		// 清理防抖管理器
		this.debounceManager.cancelAll();
		this.adaptiveDebounceManager.cancelAll();
		
		// 保存缓存
		this.cacheManager.saveCache().then(() => {
			console.log('[Plugin] 缓存已保存');
		}).catch(err => {
			console.error('[Plugin] 保存缓存失败:', err);
		});
		
		// 清理缓存
		this.cacheManager.clearCache();
		
		// 清理文件排序
		this.fileExplorerPatcher.disable();
		
		if (this.worker) this.worker.terminate();
		this.obsServer?.stop();
		
		// 清理便签 DOM（不删除状态）
		this.activeNotes.forEach(note => {
			if (note.containerEl) {
				note.containerEl.remove();
			}
		});
		this.activeNotes = [];
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
			this.debounceManager.debounce('save-cache', () => {
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
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: STATUS_VIEW_TYPE, active: true });
				workspace.revealLeaf(rightLeaf);
			}
		}
	}

	async loadSettings() {
		this.settings = await this.settingsManager.loadSettings();
	}

	async toggleForeshadowingView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(FORESHADOWING_VIEW_TYPE);
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: FORESHADOWING_VIEW_TYPE, active: true });
				workspace.revealLeaf(rightLeaf);
			}
		}
	}

	async toggleTimelineView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
		if (leaves.length > 0) {
			leaves.forEach(leaf => leaf.detach());
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
				workspace.revealLeaf(rightLeaf);
			}
		}
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
		// 清理 Markdown 语法标记，只保留纯文本内容（用于计数）
		// 使用 constants.ts 中预定义的正则表达式（性能优化）
		let cleaned = text
			// 移除 frontmatter
			.replace(REGEX_PATTERNS.FRONTMATTER, '')
			// 移除代码块
			.replace(REGEX_PATTERNS.CODE_BLOCK, '')
			.replace(REGEX_PATTERNS.INLINE_CODE, '')
			// 移除标题 # 符号
			.replace(REGEX_PATTERNS.HEADING, '')
			// 移除粗体/斜体符号 ** * __ _
			.replace(REGEX_PATTERNS.BOLD, '$2')
			.replace(REGEX_PATTERNS.ITALIC, '$2')
			// 移除 Obsidian 内部链接语法 [[文件名]] → 文件名
			.replace(REGEX_PATTERNS.INTERNAL_LINK, (_, name, alias) => alias || name)
			// 移除普通链接 [文本](url) → 文本
			.replace(REGEX_PATTERNS.LINK, '$1')
			// 移除图片 ![alt](url)
			.replace(REGEX_PATTERNS.IMAGE, '')
			// 移除 HTML 标签
			.replace(REGEX_PATTERNS.HTML_TAG, '')
			// 移除引用符号 >
			.replace(REGEX_PATTERNS.QUOTE, '')
			// 移除分隔线
			.replace(REGEX_PATTERNS.SEPARATOR, '')
			// 移除无序列表符号 - * +
			.replace(REGEX_PATTERNS.UNORDERED_LIST, '')
			// 移除有序列表符号 1.
			.replace(REGEX_PATTERNS.ORDERED_LIST, '')
			// 移除空白字符
			.replace(REGEX_PATTERNS.WHITESPACE, '');
		return cleaned.length;
	}

	/**
	 * 处理编辑器内容变化
	 * 更新字数统计和每日历史
	 */
	handleEditorChange() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		
		// 只统计工作区内的文件
		if (view.file && !this.isFileInWorkspace(view.file)) return;
        
		this.lastEditTime = Date.now(); 
        
		const currentCount = this.calculateAccurateWords(view.getViewData());
		const delta = currentCount - this.lastFileWords;
		
		this.sessionAddedWords += delta;
		this.lastFileWords = currentCount;

		const today = window.moment().format('YYYY-MM-DD');
		if (!this.settings.dailyHistory[today]) {
			this.settings.dailyHistory[today] = { focusMs: 0, slackMs: 0, addedWords: 0 };
		}
		this.settings.dailyHistory[today].addedWords += delta;

		this.updateWordCount();
		this.refreshStatusViews();
	}

	handleFileChange() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		// 只统计工作区内的文件
		if (view?.file && !this.isFileInWorkspace(view.file)) {
			this.lastFileWords = 0;
			this.statusBarItemEl.setText('');
			return;
		}
		
		this.lastFileWords = view ? this.calculateAccurateWords(view.getViewData()) : 0;
		this.updateWordCount();
		this.refreshStatusViews();
	}

	updateWordCount() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { this.statusBarItemEl.setText(''); return; }

		// 只显示工作区内文件的字数统计
		if (view.file && !this.isFileInWorkspace(view.file)) {
			this.statusBarItemEl.setText('');
			return;
		}

		// 移动端：如果启用了浮动字数统计窗口，则隐藏状态栏显示（避免重复）
		if (isMobile() && this.settings.showMobileFloatingStats) {
			this.statusBarItemEl.setText('');
			return;
		}

		const totalCount = this.calculateAccurateWords(view.getViewData());
		const displaySessionWords = Math.max(0, this.sessionAddedWords);
		
		const stateStr = this.isTracking ? "⏱️记录中" : "⏸️已暂停";

		if (this.settings.showGoal && view.file) {
			const cache = this.app.metadataCache.getFileCache(view.file);
			let targetGoal = this.settings.defaultGoal;
			if (cache?.frontmatter && cache.frontmatter['word-goal']) {
				const fmGoal = parseInt(cache.frontmatter['word-goal']);
				if (!isNaN(fmGoal)) targetGoal = fmGoal;
			}

			if (targetGoal > 0) {
				const percent = Math.min(Math.round((totalCount / targetGoal) * 100), 100);
				let emoji = percent >= 100 ? '✅' : '📝';
				this.statusBarItemEl.setText(`[${stateStr}] ${emoji} 字数: ${totalCount} / ${targetGoal} (${percent}%) | 净增: ${displaySessionWords}`);
				return;
			}
		}

		const cnChars = (view.getViewData().match(/[\u4e00-\u9fa5]/g) || []).length;
		this.statusBarItemEl.setText(`[${stateStr}] 📝 字数: ${totalCount} (中文字: ${cnChars}) | 净增: ${displaySessionWords}`);
	}

	setupWorker() {
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
			console.error(
				'[WebNovel Assistant] Worker 错误:',
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

			setTimeout(() => {
				console.log('[WebNovel Assistant] 正在重启 Worker...');

				this.setupWorker();

				if (wasTracking) {
					this.worker?.postMessage('start');
					console.log('[WebNovel Assistant] Worker 已重启，追踪状态已恢复');
				}
				
				// 通知用户
				new Notice('⚠️ 时间追踪 Worker 已自动重启\n追踪功能已恢复正常', 5000);
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
		    if (!this.settings.dailyHistory[today]) {
		        this.settings.dailyHistory[today] = { focusMs: 0, slackMs: 0, addedWords: 0 };
		    }

		    if (isAppFocused && isTypingActive) {
		        this.focusMs += delta;
		        this.settings.dailyHistory[today].focusMs += delta;
		    } else {
		        this.slackMs += delta;
		        this.settings.dailyHistory[today].slackMs += delta;
		    }
		    
			this.refreshStatusViews();
			if (this.settings.enableLegacyObsExport) this.exportLegacyOBS();
			if (this.settings.enableObs && this.obsServer) {
			}
		};
	}

	refreshStatusViews() {
		const leaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof WritingStatusView) {
				leaf.view.updateData();
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
		const focusSec = Math.floor(this.focusMs / 1000);
		const slackSec = Math.floor(this.slackMs / 1000);
		const totalSec = focusSec + slackSec;
		const today = window.moment().format('YYYY-MM-DD');
		const todayStat = this.settings.dailyHistory[today] || { focusMs: 0, slackMs: 0, addedWords: 0 };

		let targetGoal = this.settings.defaultGoal;
		let currentFile = '';
		let chapterWords = 0;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			currentFile = view.file.basename;
			const cache = this.app.metadataCache.getFileCache(view.file);
			const fmGoal = parseInt(cache?.frontmatter?.['word-goal']);
			if (!isNaN(fmGoal)) targetGoal = fmGoal;
			chapterWords = this.calculateAccurateWords(view.getViewData());
		}

		const todayAdded = Math.max(0, todayStat.addedWords);
		const dailyGoal = this.settings.dailyGoal || 0;

		return {
			isTracking: this.isTracking,
			focusTime: formatTime(focusSec),
			slackTime: formatTime(slackSec),
			totalTime: formatTime(totalSec),
			sessionWords: Math.max(0, this.sessionAddedWords),
			todayWords: chapterWords,
			goal: targetGoal,
			percent: targetGoal > 0 ? Math.min(Math.round((chapterWords / targetGoal) * 100), 100) : 0,
			dailyWords: todayAdded,
			dailyGoal: dailyGoal,
			dailyPercent: dailyGoal > 0 ? Math.min(Math.round((todayAdded / dailyGoal) * 100), 100) : 0,
			currentFile: currentFile,
		};
	}

	/**
	 * 过滤用户自定义 CSS，防止 XSS 注入
	 */
	private sanitizeCss(css: string): string {
		if (!css) return '';
		return css
			.replace(/<\/style/gi, '<\\/style')
			.replace(/<script[\s\S]*?<\/script>/gi, '');
	}

	buildObsOverlayHtml(): string {
		const theme = this.settings.obsOverlayTheme || 'dark';
		let isDark = theme === 'dark';
		
		
		const overlayOpacity = this.settings.obsOverlayOpacity ?? 0.85;
		let cardBg = isDark ? `rgba(20, 20, 30, ${overlayOpacity})` : `rgba(255, 255, 255, ${overlayOpacity})`;
		let textColor = isDark ? '#E8E8E8' : '#2C3E50';
		
		if (theme.startsWith('note-')) {
			const index = parseInt(theme.split('-')[1]);
			const noteTheme = this.settings.noteThemes[index];
			if (noteTheme) {
				cardBg = hexToRgba(noteTheme.bg, overlayOpacity);
				textColor = noteTheme.text;
				
				isDark = false; 
			}
		}

		const mutedColor = isDark ? '#888' : '#999';
		const accentColor = isDark ? '#6C9EFF' : '#4A90D9';
		const greenColor = '#4CAF50';
		const redColor = '#E74C3C';

		let timeRowHtml = '';
		if (this.settings.obsShowFocusTime || this.settings.obsShowSlackTime || this.settings.obsShowTotalTime) {
			timeRowHtml = `\n\t<div class="time-row">`;
			if (this.settings.obsShowTotalTime) timeRowHtml += `\n\t\t<div class="time-item"><div class="time-label">总计时间</div><div class="time-value" id="totalTime">00:00:00</div></div>`;
			if (this.settings.obsShowFocusTime) timeRowHtml += `\n\t\t<div class="time-item"><div class="time-label">专注时间</div><div class="time-value focus" id="focusTime">00:00:00</div></div>`;
			if (this.settings.obsShowSlackTime) timeRowHtml += `\n\t\t<div class="time-item"><div class="time-label">摸鱼时间</div><div class="time-value slack" id="slackTime">00:00:00</div></div>`;
			timeRowHtml += `\n\t</div>\n\t<div class="divider"></div>`;
		}

		let todayGoalHtml = '';
		if (this.settings.obsShowDailyGoal) {
			todayGoalHtml += `\n\t<div class="goal-row">
		<span class="goal-label">每日目标字数</span>
		<span class="goal-value"><span id="dailyWords" class="current-val">0</span> <span class="sep">/</span> <span id="dailyGoalValue" class="target-val">0</span><span class="percent" id="dailyPercentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="dailyProgressFill" style="width: 0%"></div>
	</div>`;
		}
		if (this.settings.obsShowTodayWords) {
			todayGoalHtml += `\n\t<div class="goal-row"${this.settings.obsShowDailyGoal ? ' style="margin-top:8px"' : ''}>
		<span class="goal-label">本章目标字数</span>
		<span class="goal-value"><span id="todayWords" class="current-val">0</span> <span class="sep">/</span> <span id="goalValue" class="target-val">0</span><span class="percent" id="percentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="progressFill" style="width: 0%"></div>
	</div>`;
		}

		let sessionRowHtml = '';
		if (this.settings.obsShowSessionWords) {
			sessionRowHtml = `\n\t<div class="session-row">
		<span>本场净增</span>
		<span class="val" id="sessionWords">0</span>
	</div>`;
		}

		const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
* { 
    margin: 0; 
    padding: 0; 
    box-sizing: border-box; 
    -webkit-font-smoothing: antialiased; 
    -moz-osx-font-smoothing: grayscale; 
}
body {
	background: transparent;
	font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
	color: ${textColor};
	margin: 0;
	padding: 0;
	display: flex;
	justify-content: flex-start;
	align-items: flex-start;
}
.overlay-card {
	background: ${cardBg};
	border-radius: 14px;
	padding: 20px 24px;
	backdrop-filter: ${overlayOpacity < 0.1 ? 'none' : 'blur(12px)'};
	border: ${overlayOpacity < 0.1 ? 'none' : '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')};
	transition: all 0.3s ease;
	width: 280px;
	display: flex;
	flex-direction: column;
	gap: 6px;
	zoom: 1.1;
}
.overlay-title {
	font-size: 14px;
	font-weight: 700;
	margin-bottom: 14px;
	display: flex;
	align-items: center;
	gap: 8px;
}
.status-dot {
	width: 12px; height: 12px; border-radius: 50%;
	display: inline-block;
}
.status-dot.active {
	background: ${greenColor};
	animation: pulse 1.5s ease-in-out infinite;
}
.status-dot.paused {
	background: ${mutedColor};
}
@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}


.time-label {
	font-size: 16px;
	color: ${textColor};
	opacity: 0.9;
}
.time-value {
	font-family: 'Consolas', 'Courier New', monospace;
	font-size: 24px;
	font-weight: 700;
	letter-spacing: 1px;
}
.time-value.focus { color: ${accentColor}; }
.time-value.slack { color: ${redColor}; }
.divider {
	height: 1px;
	background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'};
	margin: 4px 0;
}





.goal-value .percent {
	font-size: 13px;
	color: ${accentColor};
	margin-left: 6px;
}
.progress-bg {
	width: 100%;
	height: 6px;
	background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
	border-radius: 3px;
	overflow: hidden;
	margin-bottom: 10px;
}
.progress-fill {
	height: 100%;
	border-radius: 3px;
	background: ${accentColor};
	transition: width 0.8s ease, background-color 0.5s ease;
}
.progress-fill.done {
	background: ${greenColor};
}

.session-row .val {
	text-align: right;
	font-family: 'Consolas', monospace;
	font-weight: 600;
	color: ${textColor};
	opacity: 1;
}


.time-value, 

.goal-value .current-val { color: inherit; }
.goal-value .sep { opacity: 0.5; margin: 0 2px; }
.goal-value .target-val { opacity: 0.8; }


.goal-value.done .current-val { color: #E74C3C !important; }


.time-row {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-bottom: 6px;
}
.time-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	width: 100%;
}






.goal-row {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	width: 100%;
	margin-bottom: 4px;
	gap: 2px;
}
.goal-header {
	font-size: 16px;
	color: ${textColor};
	opacity: 0.9;
	text-align: right;
}
.goal-value {
	display: flex;
	justify-content: flex-end;
	align-items: baseline;
	text-align: right;
	width: 100%;
	gap: 4px;
}
.goal-value .current-val { font-size: 24px; font-weight: 700; }
.goal-value .target-val { font-size: 20px; opacity: 0.8; }
.goal-value .sep { opacity: 0.4; }
.goal-value .percent { font-size: 14px; color: ${accentColor}; font-weight: normal; }

/* Custom User CSS */
${this.sanitizeCss(this.settings.obsCustomCss)}
</style>
</head>
<body>
<div class="overlay-card">
	<div class="overlay-title">
		<span class="status-dot paused" id="statusDot"></span>
	</div>
	${timeRowHtml}
	${todayGoalHtml}
	${sessionRowHtml}
</div>
<script>
function safeSetText(id, text) {
	const el = document.getElementById(id);
	if (el) el.textContent = text;
}
let lastData = {};
function update() {
	fetch('/api/stats')
		.then(r => r.json())
		.then(d => {
			if (d.focusTime !== lastData.focusTime) safeSetText('focusTime', d.focusTime);
			if (d.slackTime !== lastData.slackTime) safeSetText('slackTime', d.slackTime);
			if (d.totalTime !== lastData.totalTime) safeSetText('totalTime', d.totalTime);
			if (d.todayWords !== lastData.todayWords) safeSetText('todayWords', d.todayWords.toLocaleString());
			if (d.goal !== lastData.goal) safeSetText('goalValue', d.goal.toLocaleString());
			if (d.percent !== lastData.percent) {
				safeSetText('percentText', d.percent + '%');
				const fill = document.getElementById('progressFill');
				if (fill) {
					fill.style.width = d.percent + '%';
					fill.className = 'progress-fill' + (d.percent >= 100 ? ' done' : '');
				}
			}
			if (d.dailyWords !== lastData.dailyWords) safeSetText('dailyWords', d.dailyWords.toLocaleString());
			if (d.dailyGoal !== lastData.dailyGoal) safeSetText('dailyGoalValue', d.dailyGoal.toLocaleString());
			if (d.dailyPercent !== lastData.dailyPercent) {
				safeSetText('dailyPercentText', d.dailyPercent + '%');
				const dailyFill = document.getElementById('dailyProgressFill');
				if (dailyFill) {
					dailyFill.style.width = d.dailyPercent + '%';
					dailyFill.className = 'progress-fill' + (d.dailyPercent >= 100 ? ' done' : '');
				}
			}
			if (d.sessionWords !== lastData.sessionWords) safeSetText('sessionWords', d.sessionWords.toLocaleString());

			if (d.isTracking !== lastData.isTracking) {
				const dot = document.getElementById('statusDot');
				if (dot) dot.className = 'status-dot ' + (d.isTracking ? 'active' : 'paused');
			}
			lastData = d;
		})
		.catch(() => {})
		.finally(() => {
			setTimeout(update, 500);
		});
}
update();
</script>
</body>
</html>`;
		return html;
	}
	async refreshFolderCounts() {
		const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
		if (!fileExplorer) {
			console.warn('[Plugin] refreshFolderCounts: 文件浏览器未找到');
			return;
		}

		// Type assertion for Obsidian's internal file explorer structure
		interface FileExplorerView {
			fileItems: Record<string, {
				el: HTMLElement;
				file: TFile | TFolder;
			}>;
		}
		const fileExplorerItems = (fileExplorer.view as unknown as FileExplorerView).fileItems;

		// --- 如果功能关闭，清除所有现有的字数标签并退出 ---
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
			// 支持文件夹(TFolder)和文档(TFile)
			if (item.el && (item.file instanceof TFolder || (item.file instanceof TFile && item.file.extension === 'md'))) {
				// 检查是否在工作区内
				let isInWorkspace = true;
				if (item.file instanceof TFile) {
					isInWorkspace = this.isFileInWorkspace(item.file);
				} else if (item.file instanceof TFolder) {
					// 文件夹：检查是否有任何子文件在工作区内
					// 如果没有设置工作区，则全部显示
					if (this.settings.workspaceFolders && this.settings.workspaceFolders.length > 0) {
						const folderPath = item.file.path;
						isInWorkspace = this.settings.workspaceFolders.some(workspace => {
							const normalizedWorkspace = workspace.replace(/^\/+|\/+$/g, '');
							return folderPath.startsWith(normalizedWorkspace) || normalizedWorkspace.startsWith(folderPath);
						});
					}
				}
				
				// 如果不在工作区内，跳过
				if (!isInWorkspace) continue;
				
				// 从缓存获取字数
				const count = this.cacheManager.getFolderCount(path);
				
				// 如果缓存中没有数据，跳过（不显示也不清除）
				if (count === null) continue;
				
				let countEl = item.el.querySelector('.folder-word-count');
				
				if (!countEl) {
					// 如果找不到，创建新的
					const titleContent = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
					if (titleContent) {
						countEl = titleContent.createEl('span', { cls: 'folder-word-count' });
					}
				}
				
				if (countEl) {
					// 显示字数（包括 0）
					countEl.setText(count > 0 ? ` (${formatCount(count)})` : "");
					(countEl as HTMLElement).style.fontSize = '0.8em';
					(countEl as HTMLElement).style.opacity = '0.5';
					(countEl as HTMLElement).style.marginLeft = '5px';
					updatedCount++;
				}
			}
		}
		console.log(`[Plugin] refreshFolderCounts: 已更新 ${updatedCount} 个项目的字数显示`);
	}

	injectGlobalStyles() {
		const styleId = 'accurate-count-global-styles';
		const styleContent = `
				.folder-word-count { font-variant-numeric: tabular-nums; pointer-events: none; }

				.status-view-container { padding: 15px; }
				.status-card { background: var(--background-secondary); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--background-modifier-border); }
				
				.status-title { font-weight: bold; margin-bottom: 12px; font-size: 1.1em; display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
				.status-title-badge { font-size: 0.75em; background: var(--interactive-accent); color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: normal; }
				
				.status-goal-label { font-size: 0.78em; color: var(--text-muted); margin-top: 14px; margin-bottom: 2px; font-weight: 500; }
				.goal-display-row-right { display: flex; align-items: baseline; justify-content: flex-end; gap: 4px; margin-top: 4px; margin-bottom: 8px; font-family: var(--font-monospace); flex-wrap: wrap; }
				.goal-current { font-size: 1.8em; font-weight: bold; color: var(--text-normal); }
				.goal-separator { font-size: 1.1em; color: var(--text-muted); opacity: 0.5; }
				.goal-target { font-size: 1.4em; color: var(--text-muted); opacity: 0.8; }
				.goal-percent { font-size: 1.1em; color: var(--interactive-accent); font-weight: 600; margin-left: 8px; }
				
				.progress-bar-bg { width: 100%; height: 10px; background: var(--background-modifier-border); border-radius: 5px; overflow: hidden; margin: 0; }
				.progress-bar-fill { height: 100%; background: var(--interactive-accent); transition: width 0.3s ease; }
				
				.time-box-total { background: var(--background-primary); padding: 12px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); margin-bottom: 10px; }
				.time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
				.time-box { background: var(--background-primary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); min-width: 0; }
				.time-box-title { font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.time-box-value { font-family: var(--font-monospace); font-size: 1.1em; font-weight: bold; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				
				.history-chart { margin-top: 20px; padding-top: 15px; border-top: 1px dashed var(--background-modifier-border); }
				.history-chart-title { font-size: 0.95em; font-weight: 600; color: var(--text-normal); margin-bottom: 4px; }
				.history-chart-subtitle { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; cursor: pointer; }
				.history-chart-subtitle:hover { color: var(--interactive-accent); text-decoration: underline; }

				.history-stats-modal { min-width: 600px; }
				.stats-tab-group { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; }
				.stats-tab-btn { background: transparent; border: none; box-shadow: none; color: var(--text-muted); cursor: pointer; padding: 6px 12px; border-radius: 4px; transition: all 0.2s; }
				.stats-tab-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
				.stats-tab-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: bold; }
				
				.stats-large-chart-container { display: flex; align-items: flex-end; justify-content: flex-start; height: 260px; padding: 20px 8px 10px 8px; border-bottom: 1px dashed var(--background-modifier-border); margin-top: 10px; overflow-x: auto; gap: 4px;}
				.stats-large-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 20px; flex: 1; max-width: 36px; }
				.stats-large-bar { width: 70%; min-width: 8px; max-width: 24px; border-radius: 3px 3px 0 0; opacity: 0.85; transition: height 0.4s ease, opacity 0.2s; cursor: crosshair; }
				.stats-large-bar:hover { opacity: 1; filter: brightness(1.2); }
				.stats-large-label { font-size: 0.7em; margin-top: 8px; color: var(--text-muted); white-space: nowrap; }
				.stats-large-value { font-size: 0.75em; margin-top: 4px; font-weight: bold; font-family: var(--font-monospace); }

				/* 移动端触摸优化 (需求 8.5) */
				@media (hover: none) and (pointer: coarse) {
					/* 禁用悬停效果 */
					.stats-tab-btn:hover { background: transparent; color: var(--text-muted); }
					.history-chart-subtitle:hover { color: var(--text-muted); text-decoration: none; }
					.stats-large-bar:hover { opacity: 0.8; filter: none; }
					.foreshadowing-filter-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.foreshadowing-action-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.timeline-action-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.timeline-chapter-link:hover { color: var(--text-accent); }
					
					/* 触摸目标 - 最小 44px */
					.stats-tab-btn { min-height: 44px; padding: 12px 16px; }
					button, .clickable-icon { min-height: 44px; min-width: 44px; }
					.foreshadowing-filter-btn { min-height: 44px; padding: 8px 16px; }
					.foreshadowing-action-btn { min-height: 44px; padding: 8px 16px; font-size: 0.85em; }
					.timeline-action-btn { min-height: 44px; padding: 8px 16px; font-size: 0.85em; }
					.timeline-add-btn { width: 44px; height: 44px; font-size: 1.4em; }
					.timeline-chapter-link { min-height: 44px; display: inline-flex; align-items: center; padding: 4px 8px; }
					
					/* 增加间距避免误触 */
					.stats-tab-group { gap: 12px; }
					.time-grid { gap: 12px; }
					.foreshadowing-view-filter-row { gap: 8px; }
					.foreshadowing-entry-actions { gap: 8px; }
					.timeline-actions { gap: 6px; }
					
					/* 优化移动端卡片间距 */
					.status-card { padding: 18px; margin-bottom: 18px; }
					.foreshadowing-entry-card { padding: 14px 16px; margin-bottom: 12px; }
					.timeline-content { padding: 12px 14px 12px 28px; }
					
					/* 优化表单输入框 */
					.timeline-form-input { min-height: 44px; padding: 10px 12px; font-size: 0.9em; }
					.timeline-form-textarea { min-height: 80px; padding: 10px 12px; font-size: 0.9em; }
					
					/* 拖拽手柄更大 */
					.timeline-drag-handle { font-size: 1.2em; left: 8px; }
					.timeline-content:hover .timeline-drag-handle { opacity: 0.6; }
				}

				.foreshadowing-view-container { padding: 12px; overflow-y: auto; }
				.foreshadowing-view-header { margin-bottom: 12px; }
				.foreshadowing-view-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
				.foreshadowing-view-title { font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.foreshadowing-view-folder { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; }
				.foreshadowing-view-filter-row { display: flex; gap: 4px; flex-wrap: wrap; }
				.foreshadowing-filter-btn { padding: 2px 8px; border-radius: 10px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.8em; }
				.foreshadowing-filter-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.foreshadowing-filter-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
				.foreshadowing-view-empty { color: var(--text-muted); font-size: 0.9em; padding: 20px 0; text-align: center; }
				.foreshadowing-view-hint { font-size: 0.8em; }
				.foreshadowing-group-header { display: flex; align-items: center; gap: 6px; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border); }
				.foreshadowing-group-label { font-size: 0.8em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
				.foreshadowing-group-count { font-size: 0.75em; background: var(--background-modifier-border); color: var(--text-muted); padding: 1px 6px; border-radius: 8px; }
				.foreshadowing-entry-card { background: var(--background-secondary); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; border-left: 3px solid var(--background-modifier-border); }
				.foreshadowing-entry-card.status-pending { border-left-color: var(--color-orange, #f59e0b); }
				.foreshadowing-entry-card.status-recovered { border-left-color: var(--color-green, #10b981); opacity: 0.75; }
				.foreshadowing-entry-card.status-deprecated { border-left-color: var(--text-muted); opacity: 0.5; }
				.foreshadowing-entry-desc { margin-bottom: 6px; }
				.foreshadowing-entry-desc-text { font-weight: 600; font-size: 0.9em; color: var(--text-normal); }
				.foreshadowing-entry-quotes { margin-bottom: 6px; }
				.foreshadowing-entry-quote { margin-bottom: 4px; }
				.foreshadowing-entry-quote-meta { font-size: 0.72em; color: var(--text-muted); margin-bottom: 2px; }
				.foreshadowing-entry-quote-text { font-size: 0.82em; color: var(--text-muted); padding-left: 8px; border-left: 2px solid var(--background-modifier-border); line-height: 1.5; white-space: pre-wrap; }
				.foreshadowing-entry-footer { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
				.foreshadowing-entry-tags { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
				.foreshadowing-entry-tag { font-size: 0.72em; color: var(--interactive-accent); background: var(--background-primary); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--interactive-accent); opacity: 0.8; }
				.foreshadowing-entry-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
				.foreshadowing-action-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.75em; }
				.foreshadowing-action-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.foreshadowing-recover-btn { border-color: var(--color-orange, #f59e0b); color: var(--color-orange, #f59e0b); }
				.foreshadowing-recover-btn:hover { background: var(--color-orange, #f59e0b); color: white; }
				.foreshadowing-deprecate-btn { border-color: var(--text-muted); color: var(--text-muted); }
				.foreshadowing-deprecate-btn:hover { background: var(--text-muted); color: white; }
				.foreshadowing-entry-recovery { font-size: 0.78em; color: var(--text-muted); margin-top: 4px; }
				.foreshadowing-entry-recovery-link { color: var(--color-green, #10b981); cursor: pointer; text-decoration: underline; }

				.timeline-view-container { padding: 12px; overflow-y: auto; }
				.timeline-view-header { margin-bottom: 12px; }
				.timeline-view-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
				.timeline-view-title { font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.timeline-add-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 1.2em; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; padding: 0; }
				.timeline-add-btn:hover { filter: brightness(1.1); }
				.timeline-view-folder { font-size: 0.75em; color: var(--text-muted); }
				.timeline-view-empty { color: var(--text-muted); font-size: 0.9em; padding: 20px 0; text-align: center; }
				.timeline-view-hint { font-size: 0.8em; }
				.timeline-create-btn { margin-top: 10px; }
				.timeline-list { padding-top: 8px; }
				.timeline-item { display: flex; gap: 10px; margin-bottom: 4px; cursor: grab; }
				.timeline-item:active { cursor: grabbing; }
				.timeline-dragging { opacity: 0.4; }
				.timeline-drag-over-top .timeline-content { border-top: 2px solid var(--interactive-accent) !important; }
				.timeline-drag-over-bottom .timeline-content { border-bottom: 2px solid var(--interactive-accent) !important; }
				.timeline-line { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 16px; padding-top: 4px; }
				.timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--interactive-accent); flex-shrink: 0; }
				.timeline-connector { width: 2px; flex: 1; background: var(--background-modifier-border); min-height: 20px; margin-top: 4px; }
				.timeline-content { flex: 1; background: var(--background-secondary); border-radius: 6px; padding: 8px 10px 8px 22px; margin-bottom: 8px; min-width: 0; position: relative; }
				.timeline-content:hover .timeline-actions { opacity: 1; pointer-events: auto; }
				.timeline-drag-handle { position: absolute; top: 8px; left: 6px; color: var(--text-muted); opacity: 0; font-size: 1em; cursor: grab; line-height: 1; transition: opacity 0.15s; user-select: none; }
				.timeline-content:hover .timeline-drag-handle { opacity: 0.4; }
				.timeline-drag-handle:hover { opacity: 1 !important; cursor: grab; }
				.timeline-time { font-weight: 600; font-size: 0.9em; color: var(--interactive-accent); margin-bottom: 4px; }
				.timeline-list-item { display: flex; flex-direction: column; margin-bottom: 6px; padding-left: 8px; border-left: 2px solid var(--background-modifier-border); }
				.timeline-desc { font-size: 0.85em; color: var(--text-normal); line-height: 1.5; white-space: pre-wrap; }
				.timeline-desc::before { content: "- "; color: var(--text-muted); }
				.timeline-footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
				.timeline-chapter-link { font-size: 0.78em; color: var(--text-accent); cursor: pointer; text-decoration: underline; }
				.timeline-chapter-link:hover { color: var(--interactive-accent); }
				.timeline-type-tag { font-size: 0.72em; color: var(--text-muted); background: var(--background-primary); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--background-modifier-border); }
				.timeline-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 3px; opacity: 0; pointer-events: none; transition: opacity 0.15s; }
				.timeline-action-btn { padding: 2px 7px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); cursor: pointer; font-size: 0.72em; }
				.timeline-action-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.timeline-delete-btn:hover { border-color: var(--color-red, #ef4444); color: var(--color-red, #ef4444); }
				.timeline-edit-form { background: var(--background-secondary); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--interactive-accent); }
				.timeline-form-title { font-weight: 600; font-size: 0.9em; margin-bottom: 8px; color: var(--text-normal); }
				.timeline-form-label { display: block; font-size: 0.78em; color: var(--text-muted); margin-bottom: 3px; margin-top: 8px; }
				.timeline-form-input { width: 100%; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.85em; box-sizing: border-box; }
				.timeline-form-textarea { width: 100%; height: 60px; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.85em; resize: vertical; box-sizing: border-box; font-family: var(--font-text); }
				.timeline-form-btns { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
			`;
		injectGlobalStyle(styleId, styleContent);
	}

	removeGlobalStyles() {
		removeGlobalStyle('accurate-count-global-styles');
	}

	applyEyeCare() {
		const color = this.settings.eyeCareColor || '#E8F5E9';
		const css = `
			.workspace-leaf-content[data-type="markdown"] .view-content {
				background-color: ${color} !important;
			}
			.markdown-source-view .cm-editor .cm-scroller,
			.markdown-reading-view .markdown-preview-view {
				background-color: transparent !important;
			}
		`;
		injectGlobalStyle('accurate-count-eye-care', css);
	}

	removeEyeCare() {
		removeGlobalStyle('accurate-count-eye-care');
	}
}


