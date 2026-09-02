import { Logger } from '../utils/Logger';
import type { App, WorkspaceLeaf, TFile, WorkspaceSplit, WorkspaceItem } from 'obsidian';
import { MarkdownView, Notice, ToggleComponent } from 'obsidian';
import { findBookRoot, type FindBookRootPlugin } from '../utils/path';
import { t } from '../i18n';
import { lockKeyboardEscape, unlockKeyboardEscape } from '../services/ObsidianInternals';
import type { AccurateCountSettings } from '../types/settings';
import type { StickyNoteDataManager } from '../services/StickyNoteDataManager';
import type { SettingsManager } from '../core/SettingsManager';
import type { FileExplorerPatcher } from '../services/FileExplorerPatcher';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { StatisticsManager } from '../services/StatisticsManager';
import type { TaskManager } from '../services/TaskManager';

export type ImmersiveModeManagerStickyNoteManager = Pick<
	StickyNoteDataManager,
	'syncActiveNotesToManager' | 'getNotes' | 'saveNotes' | 'syncFloatingNotes'
>;

export type ImmersiveModeManagerSettingsManager = Pick<
	SettingsManager,
	'flush'
>;

export type ImmersiveModeManagerFileExplorerPatcher = Pick<
	FileExplorerPatcher,
	'refreshAllExplorers'
>;

export type ImmersiveModeManagerDebounceManager = Pick<
	AdaptiveDebounceManager,
	'debounceFixed'
>;

export type ImmersiveModeManagerStatisticsManager = Pick<
	StatisticsManager,
	'getCoreStats'
>;

export type ImmersiveModeManagerTaskManager = Pick<
	TaskManager,
	'getTaskFile' | 'parseEntries' | 'getActiveTask' | 'calcProgress'
>;

export type ImmersiveModeManagerSettings = Pick<
	AccurateCountSettings,
	| '_savedImmersiveLayout'
	| 'immersive'
	| 'workspaceFolders'
	| 'loreFolderName'
	| 'timeline'
	| 'foreshadowing'
	| 'novelInfo'
>;

export interface ImmersiveModeManagerPlugin extends Omit<FindBookRootPlugin, 'settings'> {
	app: App;
	settings: ImmersiveModeManagerSettings;
	stickyNoteManager: ImmersiveModeManagerStickyNoteManager;
	settingsManager: ImmersiveModeManagerSettingsManager;
	adaptiveDebounceManager: ImmersiveModeManagerDebounceManager;
	statisticsManager: ImmersiveModeManagerStatisticsManager;
	fileExplorerPatcher?: ImmersiveModeManagerFileExplorerPatcher;
	taskManager?: ImmersiveModeManagerTaskManager;
	lastTaskFolder?: string;
	startTracking(): void;
	stopTracking(): void;
	saveSettings(): Promise<void>;
}

/**
 * 沉浸模式管理器
 * 负责核心的工作区拆分、界面重构、顶栏注入和无痕还原
 */
export class ImmersiveModeManager {
	private app: App;
	private plugin: ImmersiveModeManagerPlugin;
	private isImmersiveActive: boolean = false;
	private savedLayout: Record<string, unknown> | null = null;
	private savedActiveFile: TFile | null = null;
	private savedFolderCollapsedState: Record<string, boolean> = {};

	private topBarEl: HTMLElement | null = null;
	private updateInterval: number | null = null;
	private immersiveNovelTitle: string = '';

	// 追踪当前沉浸模式中的活跃叶子，用于精确抓取比例
	private activeTopLeaf: WorkspaceLeaf | null = null;
	private activeLeftLeaf: WorkspaceLeaf | null = null;
	private activeRightLeaf: WorkspaceLeaf | null = null;
	private activeBottomLeaf: WorkspaceLeaf | null = null;
	
	private pendingTimers: Set<number> = new Set();
	private createdImmersiveLeaves: Set<WorkspaceLeaf> = new Set();
	private searchFocusCleanups: Array<() => void> = [];
	private searchSourceLeaf: WorkspaceLeaf | null = null;

	private isTransitioning: boolean = false;
	private isExiting: boolean = false;
	private layoutGeneration: number = 0;
	private fullscreenChangeHandler: ((evt: Event) => void) | null = null;
	private fullscreenDocument: Document | null = null;
	private resizePointerDownHandler: ((evt: Event) => void) | null = null;
	private resizePointerUpHandler: ((evt: Event) => void) | null = null;
	private isResizingSplit: boolean = false;
	// 沉浸模式屏蔽 Esc：不使用 keydownHandler，fullscreenchange 处理全屏恢复

	// 顶部栏元素缓存
	private topBarStatsEls: Record<string, HTMLElement> = {};

	constructor(app: App, plugin: ImmersiveModeManagerPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 获取高级搜索应当使用的来源叶子。
	 * 沉浸模式下参考文档不会抢走主编辑器的活动状态，因此由叶子容器的
	 * pointer/focus 事件记录最近一次被用户聚焦的主编辑器或参考文档。
	 */
	public getSearchSourceLeaf(): WorkspaceLeaf | null {
		if (!this.isImmersiveActive && !activeDocument.body.classList.contains('immersive-mode-active')) {
			return this.app.workspace.getMostRecentLeaf();
		}

		return this.searchSourceLeaf || this.app.workspace.getMostRecentLeaf();
	}

	private trackSearchSourceLeaf(leaf: WorkspaceLeaf): void {
		const containerEl = leaf.containerEl;
		if (!containerEl || typeof containerEl.addEventListener !== 'function') return;

		const markAsSource = () => {
			this.searchSourceLeaf = leaf;
		};
		containerEl.addEventListener('pointerdown', markAsSource, true);
		containerEl.addEventListener('focusin', markAsSource, true);
		this.searchFocusCleanups.push(() => {
			containerEl.removeEventListener('pointerdown', markAsSource, true);
			containerEl.removeEventListener('focusin', markAsSource, true);
		});
	}

	private clearSearchSourceTracking(): void {
		for (const cleanup of this.searchFocusCleanups) cleanup();
		this.searchFocusCleanups = [];
		this.searchSourceLeaf = null;
	}

	private setTimeout(fn: () => void, ms: number): number {
		const timer = window.setTimeout(() => {
			this.pendingTimers.delete(timer);
			fn();
		}, ms);
		this.pendingTimers.add(timer);
		return timer;
	}

	/**
	 * 注册沉浸模式事件监听
	 * 设计原则：使用 Electron 原生全屏（app:toggle-full-screen），ESC 键无默认行为。
	 * 唯一退出途径：用户点击顶栏退出按钮 → exitImmersiveMode()。
	 * fullscreenchange 仅作兜底守卫：若用户通过系统手势/macOS 绿点退出了全屏，
	 * 检查 is-fullscreen 类名状态，若已丢失则重新进入。
	 * 同时监听用户显式拖拽 .workspace-leaf-resize-handle 手势，以在拖拽结束后持久化比例。
	 */
	private registerImmersiveEventListeners(): void {
		this.unregisterImmersiveEventListeners();

		const fullscreenDocument = activeDocument;
		this.fullscreenDocument = fullscreenDocument;

		this.fullscreenChangeHandler = () => {
			// 兜底守卫：若全屏被外部手势/系统的其他行为意外退出，重新全屏并锁定键盘
			if (this.isImmersiveActive && !this.isExiting && !fullscreenDocument.fullscreenElement) {
				fullscreenDocument.documentElement.requestFullscreen().then(async () => {
					await lockKeyboardEscape();
				}).catch(() => {
					if (!fullscreenDocument.body.classList.contains('is-fullscreen')) {
						this.app.commands.executeCommandById('app:toggle-full-screen');
					}
				});
			}
		};

		this.resizePointerDownHandler = (evt: Event) => {
			const target = evt.target as Element | null;
			const handle = target?.closest?.('.workspace-leaf-resize-handle');
			if (handle && this.isImmersiveActive && !this.isExiting) {
				this.isResizingSplit = true;
			}
		};

		this.resizePointerUpHandler = () => {
			if (this.isResizingSplit) {
				this.isResizingSplit = false;
				if (this.isImmersiveActive && !this.isExiting) {
					this.saveCurrentPanelSizes();
					this.plugin.saveSettings().catch(() => {});
				}
			}
		};

		fullscreenDocument.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
		fullscreenDocument.addEventListener('pointerdown', this.resizePointerDownHandler, true);
		fullscreenDocument.addEventListener('pointerup', this.resizePointerUpHandler, true);
		fullscreenDocument.addEventListener('pointercancel', this.resizePointerUpHandler, true);
	}

	private unregisterImmersiveEventListeners(): void {
		if (this.fullscreenDocument) {
			if (this.fullscreenChangeHandler) {
				this.fullscreenDocument.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
				this.fullscreenChangeHandler = null;
			}
			if (this.resizePointerDownHandler) {
				this.fullscreenDocument.removeEventListener('pointerdown', this.resizePointerDownHandler, true);
				this.resizePointerDownHandler = null;
			}
			if (this.resizePointerUpHandler) {
				this.fullscreenDocument.removeEventListener('pointerup', this.resizePointerUpHandler, true);
				this.fullscreenDocument.removeEventListener('pointercancel', this.resizePointerUpHandler, true);
				this.resizePointerUpHandler = null;
			}
			this.fullscreenDocument = null;
		}
		this.isResizingSplit = false;
	}

	/**
	 * 实现 Destroyable 接口，清理定时器与事件资源
	 */
	public destroy(): void {
		this.cleanup();
	}

	/**
	 * 从 leaf 向上找到真正的 WorkspaceSplit（跳过 WorkspaceTabs）
	 * @param leaf 赴始叶子
	 * @param direction 可选，限定只返回指定方向的 split
	 */
	private getParentSplit(leaf: WorkspaceLeaf, direction?: 'vertical' | 'horizontal'): WorkspaceSplit | null {
		// Traverse up the parent chain; parent may be WorkspaceTabs or WorkspaceSplit
		let node: WorkspaceSplit | null = (leaf.parent as unknown as WorkspaceSplit) ?? null;
		while (node) {
			if (node.direction !== undefined) {
				if (!direction || node.direction === direction) return node;
			}
			if (!node.parent) break;
			node = (node.parent as unknown as WorkspaceSplit) ?? null;
		}
		return null;
	}

	/**
	 * 检验布局快照是否包含沉浸模式专属组件（如果是沉浸模式布局，绝不能作为普通模式快照保存或还原）
	 */
	private isImmersiveLayout(layout: unknown): boolean {
		if (!layout) return false;
		try {
			const json = typeof layout === 'string' ? layout : JSON.stringify(layout);
			return (
				json.includes('immersive-chapter-list') ||
				json.includes('immersive-chapter-list-view') ||
				json.includes('immersive-sticky-notes') ||
				json.includes('immersive-sticky-notes-view') ||
				json.includes('immersive-reference-view') ||
				json.includes('immersive-main-editor') ||
				json.includes('webnovel-immersive-slot')
			);
		} catch {
			return false;
		}
	}

	/**
	 * 切换沉浸模式状态（带并发互斥锁防刷）
	 */
	public async toggleImmersiveMode(): Promise<void> {
		if (this.isTransitioning) {
			Logger.warn('[ImmersiveModeManager] 沉浸模式正在切换状态中，忽略重复出入请求');
			return;
		}
		if (this.isImmersiveActive || activeDocument.body.classList.contains('immersive-mode-active')) {
			await this.exitImmersiveMode();
		} else {
			await this.enterImmersiveMode();
		}
	}

	/**
	 * 进入沉浸模式
	 */
	private async enterImmersiveMode(): Promise<void> {
		if (this.isTransitioning || this.isImmersiveActive || activeDocument.body.classList.contains('immersive-mode-active')) {
			return;
		}
		this.isTransitioning = true;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice(t('immersive.please-open-chapter'));
			this.isTransitioning = false;
			return;
		}
		this.savedActiveFile = activeView.file;
		const bookRootPath = findBookRoot(this.app, this.plugin, activeView.file);
		if (bookRootPath && bookRootPath !== '/') {
			this.immersiveNovelTitle = bookRootPath.split('/').pop() || t('common.unnamed-novel');
		} else if (bookRootPath === '/') {
			this.immersiveNovelTitle = this.app.vault.getName();
		} else {
			this.immersiveNovelTitle = activeView.file.parent?.isRoot() ? activeView.file.basename : (activeView.file.parent?.name || t('common.unnamed-novel'));
		}

		try {
			// 0. 强制同步所有活跃悬浮便签到管理器，确保数据最新
			this.plugin.stickyNoteManager.syncActiveNotesToManager();
			await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());

			// 1. 抓取当前整个工作区的快照（防污染：仅当当前布局非沉浸模式布局时保存）
			if (typeof this.app.workspace.getLayout === 'function') {
				const currentLayout = this.app.workspace.getLayout() as Record<string, unknown>;
				if (!this.isImmersiveLayout(currentLayout)) {
					this.savedLayout = currentLayout;
					// 持久化布局快照，防止异常退出导致不可恢复
					this.plugin.settings._savedImmersiveLayout = JSON.stringify(this.savedLayout);
					await this.plugin.saveSettings();
					await this.plugin.settingsManager.flush();
				} else {
					Logger.warn('[ImmersiveModeManager] 当前工作区已被沉浸模式污染，跳过快照抓取');
				}
			}

			// 1.1 显式抓取文件列表中所有文件夹当前的 collapsed 状态，防止被第三方插件重置
			this.savedFolderCollapsedState = {};
			const fileExplorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			if (fileExplorerLeaf && fileExplorerLeaf.view) {
				const view = fileExplorerLeaf.view as unknown as { fileItems?: Record<string, { collapsed?: boolean; file?: { path: string } }> };
				if (view.fileItems) {
					for (const [path, item] of Object.entries(view.fileItems)) {
						if (item && item.collapsed !== undefined) {
							this.savedFolderCollapsedState[path] = item.collapsed;
						}
					}
					Logger.info(`[ImmersiveModeManager] 已保存进入前的文件夹展开状态: ${Object.keys(this.savedFolderCollapsedState).length}`);
				}
			}

			// 2. 挂载全局沉浸 CSS 类名与 TopBar 顶栏（提前确定垂直高度空间，防止后续切分线下移）
			activeDocument.body.classList.add('immersive-mode-active');
			if (this.plugin.settings.immersive.immersiveHideProperties) {
				activeDocument.body.classList.add('immersive-hide-properties');
			}
			if (this.plugin.settings.immersive.typewriterEnabled) {
				activeDocument.body.classList.add('wn-typewriter-active');
				activeDocument.body.setCssProps({ '--wn-typewriter-opacity': String(this.plugin.settings.immersive.typewriterUnfocusedOpacity ?? 0.4) });
			}
			this.createTopBar();

			if (!activeDocument.fullscreenElement) {
				activeDocument.documentElement.requestFullscreen().then(async () => {
					await lockKeyboardEscape();
				}).catch(() => {
					if (!activeDocument.body.classList.contains('is-fullscreen')) {
						this.app.commands.executeCommandById('app:toggle-full-screen');
					}
				});
			} else {
				void lockKeyboardEscape();
			}

			// 3. 在 100% 终态高度与宽度下构建 Leaf 排版（水平切分线直接 1:1 归位，零像素向下位移）
			await this.buildImmersiveLayout(this.savedActiveFile);

			// 4. 单帧刷新编辑器与打字机居中
			window.requestAnimationFrame(() => {
				this.app.workspace.updateOptions();
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.editor && activeView.editor.cm) {
					activeView.editor.cm.dispatch({});
				}
			});

			this.registerImmersiveEventListeners();
			this.plugin.startTracking();

			this.isImmersiveActive = true;

			new Notice(t('immersive.enter'));
		} catch (error) {
			Logger.error('[ImmersiveModeManager] 进入沉浸模式失败:', error);
			if (this.savedLayout) {
				try {
					const ws = this.app.workspace as unknown as {
						changeLayout?: (layout: Record<string, unknown>) => Promise<void>;
						setLayout?: (layout: Record<string, unknown>) => Promise<void>;
					};
					if (typeof ws.changeLayout === 'function') {
						void ws.changeLayout(this.savedLayout);
					} else if (typeof ws.setLayout === 'function') {
						void ws.setLayout(this.savedLayout);
					}
				} catch (restoreErr) {
					Logger.error('[ImmersiveModeManager] 还原工作区失败:', restoreErr);
				}
			}
			this.cleanup();
			this.sanitizeNormalWorkspace();
			window.requestAnimationFrame(() => {
				this.app.workspace.updateOptions();
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.editor?.cm) {
					activeView.editor.cm.dispatch({});
				}
			});
			new Notice(t('immersive.enter-failed'));
		} finally {
			this.isTransitioning = false;
		}
	}

	/**
	 * 在非沉浸模式下，检测并兜底清理残留的沉浸专属视图（如工作区/侧边栏残留的沉浸章节列表）
	 */
	public sanitizeNormalWorkspace(): void {
		if (this.isImmersiveActive) return;
		const immersiveViewTypes = ['immersive-chapter-list', 'immersive-chapter-list-view', 'immersive-sticky-notes', 'immersive-sticky-notes-view'];
		let detachedAny = false;
		for (const type of immersiveViewTypes) {
			const leaves = this.app.workspace.getLeavesOfType(type);
			for (const leaf of leaves) {
				try {
					leaf.detach();
					detachedAny = true;
				} catch (err) {
					Logger.error(`[ImmersiveModeManager] 清理残留沉浸视图 ${type} 失败:`, err);
				}
			}
		}

		// 深入检测所有 DOM 节点，拔除残存的沉浸布局标记
		if (activeDocument.body && typeof activeDocument.body.getElementsByClassName === 'function') {
			Array.from(activeDocument.body.getElementsByClassName('immersive-main-editor')).forEach(el => el.classList.remove('immersive-main-editor'));
			Array.from(activeDocument.body.getElementsByClassName('immersive-reference-view')).forEach(el => el.classList.remove('immersive-reference-view'));
			Array.from(activeDocument.body.getElementsByClassName('is-immersive-slot-pending')).forEach(el => el.classList.remove('is-immersive-slot-pending'));
		}

		if (detachedAny) {
			Logger.info('[ImmersiveModeManager] 已自动清理普通模式下的残留沉浸专属视图');
			const wsReq = this.app.workspace as unknown as { requestSaveLayout?: { run?: () => void } | (() => void) };
			if (typeof wsReq.requestSaveLayout === 'object' && wsReq.requestSaveLayout && typeof wsReq.requestSaveLayout.run === 'function') {
				wsReq.requestSaveLayout.run();
			} else if (typeof wsReq.requestSaveLayout === 'function') {
				wsReq.requestSaveLayout();
			}
		}
	}

	/**
	 * 退出沉浸模式并还原环境
	 */
	public async exitImmersiveMode(): Promise<void> {
		if (this.isTransitioning || (!this.isImmersiveActive && !activeDocument.body.classList.contains('immersive-mode-active'))) return;
		this.isTransitioning = true;
		this.isExiting = true;
		this.layoutGeneration++;

		try {
			// 1. 记录参考文档区状态（普通退出不测量或覆盖面板尺寸，避免累积漂移）
			this.updateLastReferenceFilePath();
			await this.plugin.saveSettings();

			// 1.5 记录退出前那一刻主编辑区正在编辑的文件
			const currentMainFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file || this.savedActiveFile;

			// 2. 卸载沉浸专属 Leaf 节点，避免残留在 DOM 中
			if (this.createdImmersiveLeaves.size > 0) {
				for (const leaf of this.createdImmersiveLeaves) {
					try {
						leaf.detach();
					} catch { /* ignored */ }
				}
				this.createdImmersiveLeaves.clear();
			}

			// 3. 还原普通模式布局快照
			let layoutToRestore = this.savedLayout;
			if (!layoutToRestore && this.plugin.settings._savedImmersiveLayout) {
				try {
					layoutToRestore = JSON.parse(this.plugin.settings._savedImmersiveLayout) as Record<string, unknown>;
				} catch {
					layoutToRestore = null;
				}
			}

			if (this.isImmersiveLayout(layoutToRestore)) {
				Logger.warn('[ImmersiveModeManager] 待还原的布局快照已被污染为沉浸布局，舍弃快照进行无痕清理');
				layoutToRestore = null;
			}

			if (layoutToRestore) {
				const ws = this.app.workspace as unknown as {
					changeLayout?: (layout: Record<string, unknown>) => Promise<void>;
					setLayout?: (layout: Record<string, unknown>) => Promise<void>;
				};
				if (typeof ws.changeLayout === 'function') {
					await ws.changeLayout(layoutToRestore);
				} else if (typeof ws.setLayout === 'function') {
					await ws.setLayout(layoutToRestore);
				}

				if (currentMainFile) {
					window.requestAnimationFrame(() => {
						const leaves = this.app.workspace.getLeavesOfType('markdown');
						const targetLeaf = leaves.find(l => l.active) || leaves[0] || this.app.workspace.getLeaf(false);

						void targetLeaf.setViewState({
							type: 'markdown',
							state: { file: currentMainFile.path },
							active: true
						});
					});
				}

				this.setTimeout(() => {
					const leaves = this.app.workspace.getLeavesOfType('file-explorer');
					leaves.forEach(leaf => {
						const view = leaf.view as unknown as {
							refresh?: () => void | Promise<void>;
							fileItems?: Record<string, { setCollapsed?: (collapsed: boolean) => Promise<void>; collapsed?: boolean }>;
						};
						if (view.fileItems && Object.keys(this.savedFolderCollapsedState).length > 0) {
							for (const [path, targetCollapsed] of Object.entries(this.savedFolderCollapsedState)) {
								const item = view.fileItems[path];
								if (item && item.setCollapsed && item.collapsed !== targetCollapsed) {
									void item.setCollapsed(targetCollapsed);
								}
							}
							Logger.info('[ImmersiveModeManager] 退出沉浸模式，已还原文件夹展开状态');
						}

						if (view && typeof view.refresh === 'function') {
							try { void view.refresh(); } catch { /* ignored */ }
						}
					});

					if (this.plugin.fileExplorerPatcher) {
						this.plugin.fileExplorerPatcher.refreshAllExplorers();
					}
				}, 150);
			} else {
				Logger.warn('[ImmersiveModeManager] 退出时未找到保存的有效普通布局，跳过布局还原');
				if (currentMainFile) {
					const leaves = this.app.workspace.getLeavesOfType('markdown');
					const targetLeaf = leaves.find(l => l.view && (l.view as MarkdownView).file?.path === currentMainFile.path) || leaves[0];
					if (targetLeaf) {
						this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
					}
				}
			}

			// 4. 解除键盘锁并退出全屏
			unlockKeyboardEscape();

			if (activeDocument.fullscreenElement) {
				activeDocument.exitFullscreen().catch(() => {
					if (activeDocument.body.classList.contains('is-fullscreen')) {
						this.app.commands.executeCommandById('app:toggle-full-screen');
					}
				});
			} else if (activeDocument.body.classList.contains('is-fullscreen')) {
				this.app.commands.executeCommandById('app:toggle-full-screen');
			}

			// 5. 反向同步便签
			await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
			this.plugin.stickyNoteManager.syncFloatingNotes();
			this.plugin.stopTracking();

		} catch (error) {
			Logger.error('[ImmersiveModeManager] 退出沉浸模式时发生错误:', error);
			new Notice(t('immersive.exit-warning'));
		} finally {
			this.plugin.settings._savedImmersiveLayout = null;
			await this.plugin.saveSettings().catch(() => {});
			await this.plugin.settingsManager.flush().catch(() => {});
			this.cleanup();
			const wsReq = this.app.workspace as unknown as { requestSaveLayout?: { run?: () => void } | (() => void) };
			if (typeof wsReq.requestSaveLayout === 'object' && wsReq.requestSaveLayout && typeof wsReq.requestSaveLayout.run === 'function') {
				wsReq.requestSaveLayout.run();
			} else if (typeof wsReq.requestSaveLayout === 'function') {
				wsReq.requestSaveLayout();
			}
			this.sanitizeNormalWorkspace();
			this.isTransitioning = false;
			this.isExiting = false;
			window.requestAnimationFrame(() => {
				this.app.workspace.updateOptions();
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.editor?.cm) {
					activeView.editor.cm.dispatch({});
				}
			});
			new Notice(t('immersive.exited'));
		}
	}

	public cleanup(): void {
		this.layoutGeneration++;
		this.clearSearchSourceTracking();

		this.unregisterImmersiveEventListeners();

		if (this.updateInterval) {
			window.clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
		for (const timer of this.pendingTimers) {
			window.clearTimeout(timer);
		}
		this.pendingTimers.clear();

		// 强制解绑并卸载沉浸专属 Leaf 节点
		for (const leaf of this.createdImmersiveLeaves) {
			try {
				leaf.detach();
			} catch { /* ignored */ }
		}
		this.createdImmersiveLeaves.clear();
		activeDocument.body.classList.remove('immersive-mode-active');
		activeDocument.body.classList.remove('immersive-hide-properties');
		activeDocument.body.classList.remove('wn-typewriter-active');
		activeDocument.body.setCssProps({ '--wn-typewriter-opacity': 'unset' });

		// 清除 DOM 中所有关联沉浸模式的类名残留
		if (activeDocument.body && typeof activeDocument.body.getElementsByClassName === 'function') {
			Array.from(activeDocument.body.getElementsByClassName('immersive-main-editor')).forEach(el => el.classList.remove('immersive-main-editor'));
			Array.from(activeDocument.body.getElementsByClassName('immersive-reference-view')).forEach(el => el.classList.remove('immersive-reference-view'));
			Array.from(activeDocument.body.getElementsByClassName('is-immersive-slot-pending')).forEach(el => el.classList.remove('is-immersive-slot-pending'));
		}

		this.removeTopBar();

		unlockKeyboardEscape();

		this.isImmersiveActive = false;
		this.isExiting = false;
		this.savedLayout = null;
		this.savedActiveFile = null;

		this.activeTopLeaf = null;
		this.activeLeftLeaf = null;
		this.activeRightLeaf = null;
		this.activeBottomLeaf = null;
	}

	/**
	 * 动态构建沉浸模式布局
	 */
	private async buildImmersiveLayout(activeFile: TFile): Promise<void> {
		const { workspace } = this.app;
		const immersive = this.plugin.settings.immersive;
		const currentGeneration = this.layoutGeneration;

		// 1. 寻找当前主编辑器
		let mainLeaf: WorkspaceLeaf | null = null;
		const markdownLeaves = workspace.getLeavesOfType("markdown");
		mainLeaf = markdownLeaves.find(l => (l.view as MarkdownView)?.file?.path === activeFile.path && l.active)
			|| markdownLeaves.find(l => (l.view as MarkdownView)?.file?.path === activeFile.path)
			|| markdownLeaves.find(l => l.active)
			|| markdownLeaves[0];
		if (!mainLeaf) {
			mainLeaf = workspace.getLeaf(true);
		}

		// 1.1 隔离主工作区：分离除主编辑器外的所有其它普通模式根叶子，确保沉浸模式无分屏与样式污染
		const leavesToDetach: WorkspaceLeaf[] = [];
		if (typeof workspace.iterateRootLeaves === 'function') {
			workspace.iterateRootLeaves(leaf => {
				if (leaf !== mainLeaf) {
					leavesToDetach.push(leaf);
				}
			});
		}
		for (const leaf of leavesToDetach) {
			try {
				leaf.detach();
			} catch (err) {
				Logger.warn('[ImmersiveModeManager] 隔离分离普通模式叶子失败:', err);
			}
		}

		// 1.2 检查主编辑器状态，若已是目标文件的源码 Markdown 视图则避免重复 setViewState
		const currentState = typeof mainLeaf.getViewState === 'function' ? mainLeaf.getViewState() : null;
		const isAlreadyActiveSourceMarkdown =
			currentState?.type === 'markdown' &&
			currentState.state?.file === activeFile.path &&
			currentState.state?.mode === 'source';

		if (!isAlreadyActiveSourceMarkdown) {
			await mainLeaf.setViewState({
				type: "markdown",
				state: { ...(currentState?.state || {}), file: activeFile.path, mode: 'source' },
				active: true
			});
		}
		mainLeaf.containerEl?.classList.add('immersive-main-editor');
		this.searchSourceLeaf = mainLeaf;
		this.trackSearchSourceLeaf(mainLeaf);

		const pendingMounts: Array<{ leaf: WorkspaceLeaf; viewType: string }> = [];
		const pendingSizes: Array<{ split: WorkspaceSplit; sizes: number[] }> = [];

		const createSlotSkeleton = (
			slots: string[],
			direction: 'vertical' | 'horizontal',
			before: boolean,
			size: number,
			internalSizes: number[]
		): WorkspaceLeaf | null => {
			if (!slots || slots.length === 0) return null;
			const firstLeaf = workspace.createLeafBySplit(mainLeaf, direction, before);
			this.createdImmersiveLeaves.add(firstLeaf);

			const parentSplit = this.getParentSplit(mainLeaf);
			if (parentSplit && parentSplit.children) {
				// 获取同级 children 的数量并立即预设置 child.size，避免后续 Layout 二次重排卡顿
				const childCount = parentSplit.children.length;
				if (childCount === 2) {
					const size0 = before ? size : 100 - size;
					const size1 = before ? 100 - size : size;
					parentSplit.children[0].size = size0;
					parentSplit.children[1].size = size1;
					pendingSizes.push({ split: parentSplit, sizes: [size0, size1] });
				} else if (childCount === 3) {
					// 只有在左右两侧都有时才会出现 childCount 3
					let otherSize = 0;
					if (direction === 'horizontal') {
						otherSize = before ? immersive.immersiveBottomSize : immersive.immersiveTopSize;
					} else {
						otherSize = before ? immersive.immersiveRightSize : immersive.immersiveLeftSize;
					}
					const centerSize = 100 - size - otherSize;
					const sizes = before ? [size, centerSize, otherSize] : [otherSize, centerSize, size];
					for (let idx = 0; idx < parentSplit.children.length && idx < sizes.length; idx++) {
						parentSplit.children[idx].size = sizes[idx];
					}
					pendingSizes.push({ split: parentSplit, sizes });
				}
			}

			const slotOrientationClass = direction === 'horizontal'
				? 'webnovel-immersive-slot-horizontal'
				: 'webnovel-immersive-slot-vertical';
			let currentLeaf = firstLeaf;

			for (let i = 0; i < slots.length; i++) {
				const viewType = slots[i];
				if (i > 0) {
					// 内部切分使用与外部相反的切割方向
					const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
					currentLeaf = workspace.createLeafBySplit(currentLeaf, internalDir, false);
					this.createdImmersiveLeaves.add(currentLeaf);
				}
				currentLeaf.containerEl?.classList.add(slotOrientationClass);
				currentLeaf.containerEl?.classList.add('is-immersive-slot-pending');
				if (viewType === 'reference-view') {
					currentLeaf.containerEl?.classList.add('immersive-reference-view');
					this.trackSearchSourceLeaf(currentLeaf);
				}

				pendingMounts.push({ leaf: currentLeaf, viewType });
			}

			if (slots.length > 1) {
				const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
				const internalSplit = this.getParentSplit(currentLeaf, internalDir);
				if (internalSplit && internalSplit.children && internalSplit.children.length === slots.length) {
					let finalInternalSizes = internalSizes;
					if (!finalInternalSizes || finalInternalSizes.length !== slots.length) {
						const avg = 100 / slots.length;
						finalInternalSizes = new Array<number>(slots.length).fill(avg);
					}
					for (let idx = 0; idx < internalSplit.children.length && idx < finalInternalSizes.length; idx++) {
						internalSplit.children[idx].size = finalInternalSizes[idx];
					}
					pendingSizes.push({ split: internalSplit, sizes: finalInternalSizes });
				}
			}

			return firstLeaf;
		};

		// 动态构建分屏骨架：空槽不创建，主编辑区自动贴边
		// 先切上下，再切左右
		this.activeTopLeaf = createSlotSkeleton(immersive.immersiveTopSlots, 'horizontal', true, immersive.immersiveTopSize, immersive.immersiveTopInternalSizes);
		this.activeBottomLeaf = createSlotSkeleton(immersive.immersiveBottomSlots, 'horizontal', false, immersive.immersiveBottomSize, immersive.immersiveBottomInternalSizes);
		this.activeLeftLeaf = createSlotSkeleton(immersive.immersiveLeftSlots, 'vertical', true, immersive.immersiveLeftSize, immersive.immersiveLeftInternalSizes);
		this.activeRightLeaf = createSlotSkeleton(immersive.immersiveRightSlots, 'vertical', false, immersive.immersiveRightSize, immersive.immersiveRightInternalSizes);

		// 2. 确定性应用并等待分屏尺寸固化（在视图挂载前完成外层几何稳定）
		await this.applySplitSizes(pendingSizes);

		// 3. 确保主编辑器聚焦
		workspace.setActiveLeaf(mainLeaf, { focus: true });
		this.searchSourceLeaf = mainLeaf;

		// 4. 在主编辑器就绪后，按代次异步分批挂载各辅助面板内容
		this.scheduleAuxiliaryMounts(pendingMounts, currentGeneration);
	}

	/**
	 * 确定性应用并固化分屏与面板比例（清除固定像素与 flex 残留，采用 Obsidian 原生 setDimension 百分比语义）
	 */
	private async applySplitSizes(pendingSizes: Array<{ split: WorkspaceSplit; sizes: number[] }>): Promise<void> {
		if (!pendingSizes.length) return;

		for (const { split, sizes } of pendingSizes) {
			if (!split || !split.children) continue;
			const childCount = Math.min(split.children.length, sizes.length);
			for (let i = 0; i < childCount; i++) {
				const child = split.children[i];
				if (!child) continue;

				const childEl = child.containerEl;
				if (childEl) {
					if (typeof split.unsetElSize === 'function') {
						split.unsetElSize(childEl);
					}
					if (typeof childEl.setCssProps === 'function') {
						childEl.setCssProps({ width: '', height: '', flex: '' });
					}
				}

				child.size = sizes[i];
				if (typeof child.setDimension === 'function') {
					child.setDimension(sizes[i]);
				}
			}
		}
	}

	private yieldToMain(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
				window.setTimeout(resolve, 0);
			} else {
				resolve();
			}
		});
	}

	/**
	 * 在主编辑区和分屏骨架就绪后，按代次以至多 2 个并发分批调度辅助视图挂载
	 */
	private scheduleAuxiliaryMounts(pendingMounts: Array<{ leaf: WorkspaceLeaf; viewType: string }>, generation: number): void {
		if (!pendingMounts.length) return;

		const mountAll = async () => {
			const immersive = this.plugin.settings.immersive;
			const BATCH_SIZE = 2;

			const mountLeaf = async ({ leaf, viewType }: { leaf: WorkspaceLeaf; viewType: string }): Promise<void> => {
				if (generation !== this.layoutGeneration || this.isExiting || !this.createdImmersiveLeaves.has(leaf)) {
					return;
				}

				try {
					if (viewType === 'reference-view') {
						const state: Record<string, string> = { mode: 'preview' };
						if (immersive.lastReferenceFilePath) {
							state.file = immersive.lastReferenceFilePath;
						}
						await leaf.setViewState({
							type: 'markdown',
							state
						});
					} else {
						await leaf.setViewState({ type: viewType });
					}
				} catch (mountErr) {
					Logger.error(`[ImmersiveModeManager] 挂载沉浸辅助视图 ${viewType} 失败:`, mountErr);
				} finally {
					if (generation === this.layoutGeneration && !this.isExiting && this.createdImmersiveLeaves.has(leaf)) {
						leaf.containerEl?.classList.remove('is-immersive-slot-pending');
					}
				}
			};

			for (let i = 0; i < pendingMounts.length; i += BATCH_SIZE) {
				// 批次间出让执行栈，确保主编辑器与用户交互获得响应窗口
				await this.yieldToMain();

				if (generation !== this.layoutGeneration || this.isExiting) {
					return;
				}

				const batch = pendingMounts.slice(i, i + BATCH_SIZE);
				await Promise.all(batch.map(item => mountLeaf(item)));

				if (generation !== this.layoutGeneration || this.isExiting) {
					return;
				}
			}
		};

		void mountAll();
	}

	/**
	 * 创建顶部仪表盘
	 */
	private createTopBar(): void {
		if (this.topBarEl) return;

		this.topBarEl = createDiv();
		this.topBarEl.id = 'immersive-top-bar';
		this.topBarEl.className = 'immersive-top-bar';

		const leftDiv = this.topBarEl.createDiv({ cls: 'immersive-top-bar-left' });
		leftDiv.createSpan({ cls: 'novel-title', text: this.immersiveNovelTitle });

		const centerDiv = this.topBarEl.createDiv({ cls: 'immersive-top-bar-center' });

		const rightDiv = this.topBarEl.createDiv({ cls: 'immersive-top-bar-right' });
		const exitBtn = rightDiv.createEl('button', { cls: 'immersive-exit-btn', text: t('immersive.exit-btn') });
		exitBtn.addEventListener('click', () => { void this.exitImmersiveMode(); });

		this.topBarStatsEls = {
			totalTime: centerDiv.createSpan({ cls: 'stat-item' }),
			focusTime: centerDiv.createSpan({ cls: 'stat-item focus' }),
			slackTime: centerDiv.createSpan({ cls: 'stat-item slack' }),
			chapterProgress: centerDiv.createSpan({ cls: 'stat-item' }),
			dailyProgress: centerDiv.createSpan({ cls: 'stat-item' }),
			taskProgress: centerDiv.createSpan({ cls: 'stat-item' }),
			sessionWords: centerDiv.createSpan({ cls: 'stat-item' })
		};

		for (const el of Object.values(this.topBarStatsEls)) {
			el.hide();
		}

		// 在中间数据栏的最右侧嵌入打字机原生 Toggle 开关
		const typewriterWrapper = centerDiv.createDiv({ cls: 'stat-item typewriter-toggle-container' });
		typewriterWrapper.createSpan({ cls: 'typewriter-toggle-label', text: t('setting.immersive-typewriter-title') });

		new ToggleComponent(typewriterWrapper)
			.setValue(this.plugin.settings.immersive.typewriterEnabled)
			.setTooltip(t('immersive.typewriter-toggle-tooltip'))
			.onChange(async (value) => {
				this.plugin.settings.immersive.typewriterEnabled = value;
				await this.plugin.saveSettings();
				if (value) {
					activeDocument.body.classList.add('wn-typewriter-active');
					activeDocument.body.setCssProps({ '--wn-typewriter-opacity': String(this.plugin.settings.immersive.typewriterUnfocusedOpacity ?? 0.4) });
				} else {
					activeDocument.body.classList.remove('wn-typewriter-active');
				}
				this.app.workspace.updateOptions();
			});

		activeDocument.body.appendChild(this.topBarEl);
		void this.renderTopBarContent();

		this.updateInterval = window.setInterval(() => {
			void this.renderTopBarContent();
		}, 1000);
	}

	private removeTopBar(): void {
		if (this.updateInterval) {
			window.clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
		if (this.topBarEl) {
			this.topBarEl.remove();
			this.topBarEl = null;
		}
		this.topBarStatsEls = {};
	}

	private async renderTopBarContent(): Promise<void> {
		if (!this.topBarEl) return;
		try {
			const immersive = this.plugin.settings.immersive;
			const stats = this.plugin.statisticsManager.getCoreStats();
			
			let taskWords = 0;
			let taskGoal = 0;
			if (immersive.immersiveShowTaskProgress) {
				let taskFolder = '';
				const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (view?.file) {
					taskFolder = findBookRoot(this.plugin.app, this.plugin, view.file) || '';
					this.plugin.lastTaskFolder = taskFolder;
				} else if (this.plugin.lastTaskFolder) {
					taskFolder = this.plugin.lastTaskFolder;
				}
				if (taskFolder && this.plugin.taskManager) {
					const taskFile = this.plugin.taskManager.getTaskFile(taskFolder);
					if (taskFile) {
						const taskContent = await this.plugin.app.vault.cachedRead(taskFile);
						const entries = this.plugin.taskManager.parseEntries(taskContent);
						const active = this.plugin.taskManager.getActiveTask(entries);
						if (active) {
							taskWords = this.plugin.taskManager.calcProgress(active, taskFolder);
							taskGoal = active.wordTarget;
						}
					}
				}
			}

			const updateStatEl = (key: string, show: boolean, text: string) => {
				const el = this.topBarStatsEls[key];
				if (!el) return;
				if (show) {
					if ((!el.isShown())) el.show()
					if (el.innerText !== text) el.innerText = text;
				} else {
					if (el.isShown()) el.hide();
				}
			};

			updateStatEl('totalTime', !!immersive.immersiveShowTotalTime, `${t('immersive.total-time')} (${stats.totalTime})`);
			updateStatEl('focusTime', !!immersive.immersiveShowFocusTime, `${t('immersive.focus-time')} (${stats.focusTime})`);
			updateStatEl('slackTime', !!immersive.immersiveShowSlackTime, `${t('immersive.slack-time')} (${stats.slackTime})`);
			updateStatEl('chapterProgress', !!immersive.immersiveShowChapterProgress, `${t('immersive.chapter-progress')} (${stats.todayWords}/${stats.goal})`);
			updateStatEl('dailyProgress', !!immersive.immersiveShowDailyProgress, `${t('immersive.daily-progress')} (${stats.dailyWords}/${stats.dailyGoal})`);
			updateStatEl('taskProgress', !!immersive.immersiveShowTaskProgress, `${t('immersive.task-progress')} (${taskWords}/${taskGoal})`);
			updateStatEl('sessionWords', !!immersive.immersiveShowSessionWords, `${t('immersive.session-words')} (${stats.sessionWords})`);
		} catch (e) {
			Logger.error('[ImmersiveModeManager] renderTopBarContent failed:', e);
		}
	}

	/**
	 * 记录当前参考文档区打开的文件
	 */
	private updateLastReferenceFilePath(): void {
		const immersive = this.plugin.settings.immersive;
		if (typeof this.app.workspace.iterateRootLeaves === 'function') {
			this.app.workspace.iterateRootLeaves(leaf => {
				if (leaf?.containerEl && leaf.containerEl.classList?.contains('immersive-reference-view')) {
					const viewType = typeof leaf.view?.getViewType === 'function' ? leaf.view.getViewType() : '';
					const mdView = viewType === 'markdown' ? leaf.view as MarkdownView : null;
					if (mdView && mdView.file) {
						immersive.lastReferenceFilePath = mdView.file.path;
					}
				}
			});
		}
	}

	/**
	 * 保存当前面板比例
	 */
	private saveCurrentPanelSizes(): void {
		const immersive = this.plugin.settings.immersive;

		const saveSize = (leaf: WorkspaceLeaf | null, direction: 'horizontal' | 'vertical', setter: (size: number) => void, internalSetter: (sizes: number[]) => void, slotCount: number) => {
			if (leaf && leaf.containerEl && leaf.containerEl.offsetParent) {
				const split = this.getParentSplit(leaf, direction);
				if (split && split.direction === direction && split.containerEl && split.children) {
					const totalSize = direction === 'horizontal' ? split.containerEl.offsetHeight : split.containerEl.offsetWidth;
					if (totalSize > 0) {
						const child = split.children.find((c: WorkspaceItem) => c.containerEl && c.containerEl.contains(leaf.containerEl));
						if (child) {
							const size = direction === 'horizontal' ? child.containerEl!.offsetHeight : child.containerEl!.offsetWidth;
							const pct = Math.round((size / totalSize) * 100);
							if (pct > 0 && pct < 100) {
								setter(pct);
							}
						}
					}
				}

				if (slotCount > 1) {
					const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
					const internalSplit = this.getParentSplit(leaf, internalDir);
					if (internalSplit && internalSplit.direction === internalDir && internalSplit.containerEl && internalSplit.children) {
						const totalIntSize = internalDir === 'horizontal' ? internalSplit.containerEl.offsetHeight : internalSplit.containerEl.offsetWidth;
						if (totalIntSize > 0 && internalSplit.children.length === slotCount) {
							const newSizes: number[] = [];
							for (const c of internalSplit.children) {
								const s = internalDir === 'horizontal' ? c.containerEl?.offsetHeight || 0 : c.containerEl?.offsetWidth || 0;
								newSizes.push(Math.round((s / totalIntSize) * 100));
							}
							internalSetter(newSizes);
						}
					}
				}
			}
		};

		this.updateLastReferenceFilePath();

		saveSize(this.activeTopLeaf, 'horizontal', s => immersive.immersiveTopSize = s, s => immersive.immersiveTopInternalSizes = s, (immersive.immersiveTopSlots || []).length);
		saveSize(this.activeBottomLeaf, 'horizontal', s => immersive.immersiveBottomSize = s, s => immersive.immersiveBottomInternalSizes = s, (immersive.immersiveBottomSlots || []).length);
		saveSize(this.activeLeftLeaf, 'vertical', s => immersive.immersiveLeftSize = s, s => immersive.immersiveLeftInternalSizes = s, (immersive.immersiveLeftSlots || []).length);
		saveSize(this.activeRightLeaf, 'vertical', s => immersive.immersiveRightSize = s, s => immersive.immersiveRightInternalSizes = s, (immersive.immersiveRightSlots || []).length);
	}
}
