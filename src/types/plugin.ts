/**
 * 插件接口类型定义
 * 
 * 用于解决循环依赖问题，为服务层和 UI 层提供类型安全的插件引用
 */
import { App, EventRef, TFile } from 'obsidian';
import { AccurateCountSettings } from './settings';
import { ObsStatsPayload } from './stats';
import type { CacheManager } from '../services/CacheManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import type { TimelineManager } from '../services/TimelineManager';
import type { FileExplorerPatcher } from '../services/FileExplorerPatcher';
import type { SettingsManager } from '../core/SettingsManager';
import type { HistoryDataManager } from '../services/HistoryDataManager';
import type { StickyNoteDataManager } from '../services/StickyNoteDataManager';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { ObsOverlayServer } from '../services/ObsServer';
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

/**
 * WebNovel Assistant 插件接口
 * 
 * 定义了插件类对外暴露的属性和方法，供服务层和 UI 层使用
 */
export interface WebNovelAssistantPlugin {
	// Obsidian 核心
	app: App;
	registerEvent(eventRef: EventRef): EventRef;

	// 启动状态
	isLayoutReady: boolean;

	// 设置
	settings: AccurateCountSettings;
	
	// 服务管理器
	cacheManager: CacheManager;
	adaptiveDebounceManager: AdaptiveDebounceManager;
	settingsManager: SettingsManager;
	historyManager: HistoryDataManager;
	stickyNoteManager: StickyNoteDataManager;
	fileExplorerPatcher: FileExplorerPatcher;
	wordCounter: WordCounter;
	commandManager: CommandManager;
	viewManager: ViewManager;
	menuManager: MenuManager;
	
	// 以下属性在 onload 中初始化，可能为 undefined
	foreshadowingManager?: ForeshadowingManager;
	editorTracker?: EditorTracker;
	styleManager?: StyleManager;
	workerManager?: WorkerManager;
	markdownPostProcessor?: MarkdownPostProcessor;
	immersiveModeManager?: ImmersiveModeManager;
	fileEventManager?: FileEventManager;
	
	// 追踪状态
	isTracking: boolean;
	focusMs: number;
	slackMs: number;
	sessionAddedWords: number;
	lastEditTime: number;
	lastTickTime: number;
	lastFileWords: number;
	lastFilePath: string;
	
	// Worker 和服务
	obsServer: ObsOverlayServer | null;
	
	// UI 组件
	activeNotes: FloatingStickyNote[];
	mobileFloatingStats: MobileFloatingStats | null;
	statusBarItemEl: HTMLElement;
	
	// 核心方法
	saveSettings(): Promise<void>;
	loadSettings(): Promise<void>;
	calculateAccurateWords(text: string): number;
	isFileInWorkspace(file: TFile): boolean;
	/** 检查文件是否符合字数统计的条件（工作区 + 排除合并文件 + 严格章节模式） */
	isEligibleForWordCount(file: TFile): boolean;
	updateWordCount(): void;
	startTracking(): void;
	stopTracking(): void;
	
	// 视图管理
	toggleStatusView(): Promise<void>;
	toggleForeshadowingView(): Promise<void>;
	toggleTimelineView(): Promise<void>;
	refreshStatusViews(): void;
	
	// 缓存管理
	buildFolderCache(): Promise<void>;
	updateFileCacheAndRefresh(file: TFile): Promise<void>;
	refreshFolderCounts(): void;
	
	// OBS 相关
	getObsStats(): ObsStatsPayload;
	buildObsOverlayHtml(): string;
	exportLegacyOBS(force?: boolean): void;
	
	// 样式管理（静态样式由 styles.css 自动加载）
	applyEyeCare(): void;
	removeEyeCare(): void;
}
