/**
 * 插件接口类型定义
 *
 * 用于解决循环依赖问题，为服务层和 UI 层提供类型安全的插件引用
 * 
 * [重构] 将单一巨型接口拆分为功能子接口，通过交叉类型组合
 * 好处：各子系统只需依赖自己关心的接口子集，降低耦合
 */
import { App, Command, EventRef, PluginManifest, TFile, ViewCreator, WorkspaceLeaf } from 'obsidian';
import { AccurateCountSettings } from './settings';
import { ObsStatsPayload } from './stats';
import type { CacheManager } from '../services/CacheManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import type { RankingManager } from '../services/RankingManager';
import type { TimelineManager } from '../services/TimelineManager';
import type { FileExplorerPatcher } from '../services/FileExplorerPatcher';
import type { SettingsManager } from '../core/SettingsManager';
import type { HistoryDataManager } from '../services/HistoryDataManager';
import type { StickyNoteDataManager } from '../services/StickyNoteDataManager';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { ObsOverlayServer } from '../services/ObsServer';
import type { ObsHtmlBuilder } from '../services/ObsHtmlBuilder';
import type { FloatingStickyNote } from '../ui/StickyNote';
import type { MobileFloatingStats } from '../ui/MobileFloatingStats';
import type { WordCounter } from '../services/WordCounter';
import type { EditorTracker } from '../services/EditorTracker';
import type { StyleManager } from '../services/StyleManager';
import type { WorkerManager } from '../services/WorkerManager';
import type { MarkdownPostProcessor } from '../services/MarkdownPostProcessor';
import type { CommandManager } from '../core/CommandManager';
import type { ViewManager } from '../core/ViewManager';
import type { MenuManager } from '../core/MenuManager';
import type { ImmersiveModeManager } from '../ui/ImmersiveModeManager';
import type { FileEventManager } from '../services/FileEventManager';
import type { HomepageManager } from '../services/HomepageManager';

// ==========================================
// 辅助类型
// ==========================================

/** 创建便签的选项 */
export interface CreateStickyNoteOptions {
	/** 关联的文件（从文件创建便签） */
	file?: TFile;
	/** 便签内容 */
	content?: string;
	/** 便签标题 */
	title?: string;
}

// ==========================================
// 功能子接口
// ==========================================

/** 追踪状态相关的属性和方法 */
export interface TrackingContext {
	isTracking: boolean;
	focusMs: number;
	slackMs: number;
	sessionAddedWords: number;
	lastEditTime: number;
	lastTickTime: number;
	lastFileWords: number;
	lastFilePath: string;
	lastRankingFolder: string;
	startTracking(): void;
	stopTracking(): void;
}

/** 缓存管理相关 */
export interface CacheContext {
	cacheManager: CacheManager;
	buildFolderCache(): Promise<void>;
	updateFileCacheAndRefresh(file: TFile): Promise<void>;
	refreshFolderCounts(): void;
}

/** 视图管理相关 */
export interface ViewContext {
	toggleStatusView(): Promise<void>;
	toggleForeshadowingView(): Promise<void>;
	toggleTimelineView(): Promise<void>;
	toggleRankingView(): Promise<void>;
	toggleFloatingNotesVisibility(): Promise<void>;
	refreshStatusViews(): void;
}

/** 样式管理相关 */
export interface StyleContext {
	applyEyeCare(): void;
	removeEyeCare(): void;
}

/** 便签管理相关 */
export interface StickyNoteContext {
	activeNotes: FloatingStickyNote[];
	stickyNoteManager: StickyNoteDataManager;
	syncFloatingNotes(): void;
	syncActiveNotesToManager(): void;
	createStickyNote(options: CreateStickyNoteOptions): Promise<void>;
}

/** OBS 集成相关 */
export interface ObsContext {
	obsServer: ObsOverlayServer | null;
	obsHtmlBuilder: ObsHtmlBuilder;
	getObsStats(): Promise<ObsStatsPayload>;
	buildObsOverlayHtml(): string;
}

// ==========================================
// 主接口（交叉类型组合）
// ==========================================

/**
 * WebNovel Assistant 插件接口
 *
 * 定义了插件类对外暴露的属性和方法，供服务层和 UI 层使用。
 * 通过交叉类型组合多个功能子接口，保持向后兼容。
 */
export interface WebNovelAssistantPlugin extends
	TrackingContext,
	CacheContext,
	ViewContext,
	StyleContext,
	StickyNoteContext,
	ObsContext {

	// Obsidian 核心
	app: App;
	manifest: PluginManifest;
	// 注意：Obsidian 运行时实际返回 EventRef，但官方 .d.ts 声明为 void
	registerEvent(eventRef: EventRef): void;
	registerView(type: string, viewCreator: ViewCreator): void;
	registerInterval(id: number): number;
	loadData(): Promise<any>;
	addCommand(command: Command): Command;

	// 启动状态
	isLayoutReady: boolean;

	// 设置
	settings: AccurateCountSettings;

	// 服务管理器（构造函数中初始化，始终可用）
	adaptiveDebounceManager: AdaptiveDebounceManager;
	settingsManager: SettingsManager;
	historyManager: HistoryDataManager;
	fileExplorerPatcher: FileExplorerPatcher;
	wordCounter: WordCounter;
	commandManager: CommandManager;
	viewManager: ViewManager;
	menuManager: MenuManager;
	workerManager: WorkerManager;
	markdownPostProcessor: MarkdownPostProcessor;
	immersiveModeManager: ImmersiveModeManager;
	fileEventManager: FileEventManager;

	// 以下属性在 onload 中初始化，可能为 undefined
	foreshadowingManager?: ForeshadowingManager;
	rankingManager?: RankingManager;
	timelineManager?: TimelineManager;
	editorTracker?: EditorTracker;
	styleManager?: StyleManager;
	homepageManager?: HomepageManager;

	// UI 组件
	mobileFloatingStats: MobileFloatingStats | null;
	statusBarItemEl: HTMLElement;

	// 核心方法
	saveSettings(): Promise<void>;
	loadSettings(): Promise<void>;
	calculateAccurateWords(text: string): number;
	isFileInWorkspace(file: TFile): boolean;
	/** 检查文件是否在严格章节模式例外目录内 */
	isFileInStrictChapterException(file: TFile): boolean;
	/** 检查文件是否符合字数统计的条件（工作区 + 排除合并文件 + 严格章节模式） */
	isEligibleForWordCount(file: TFile): boolean;
	updateWordCount(): void;
}