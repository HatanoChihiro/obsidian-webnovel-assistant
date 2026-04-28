/**
 * 插件接口类型定义
 * 
 * 用于解决循环依赖问题，为服务层和 UI 层提供类型安全的插件引用
 */
import { App, TFile } from 'obsidian';
import { AccurateCountSettings } from './settings';
import { ObsStatsPayload } from './stats';
import type { CacheManager } from '../services/CacheManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import type { TimelineManager } from '../services/TimelineManager';
import type { FileExplorerPatcher } from '../services/FileExplorerPatcher';
import type { SettingsManager } from '../core/SettingsManager';
import type { HistoryDataManager } from '../services/HistoryDataManager';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { ObsOverlayServer } from '../services/ObsServer';
import type { FloatingStickyNote } from '../ui/StickyNote';
import type { MobileFloatingStats } from '../ui/MobileFloatingStats';
import type { WordCounter } from '../services/WordCounter';

/**
 * WebNovel Assistant 插件接口
 * 
 * 定义了插件类对外暴露的属性和方法，供服务层和 UI 层使用
 */
export interface WebNovelAssistantPlugin {
	// Obsidian 核心
	app: App;

	// 设置
	settings: AccurateCountSettings;
	
	// 服务管理器
	cacheManager: CacheManager;
	adaptiveDebounceManager: AdaptiveDebounceManager;
	settingsManager: SettingsManager;
	historyManager: HistoryDataManager;
	fileExplorerPatcher: FileExplorerPatcher;
	foreshadowingManager: ForeshadowingManager;
	wordCounter: WordCounter;
	
	// 追踪状态
	isTracking: boolean;
	focusMs: number;
	slackMs: number;
	sessionAddedWords: number;
	lastEditTime: number;
	lastTickTime: number;
	lastFileWords: number;
	
	// Worker 和服务
	worker: Worker | null;
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
	updateWordCount(): void;
	
	// 视图管理
	toggleStatusView(): Promise<void>;
	toggleForeshadowingView(): Promise<void>;
	toggleTimelineView(): Promise<void>;
	refreshStatusViews(): void;
	
	// 缓存管理
	buildFolderCache(): Promise<void>;
	updateFileCacheAndRefresh(file: TFile): Promise<void>;
	refreshFolderCounts(): Promise<void>;
	
	// OBS 相关
	getObsStats(): ObsStatsPayload;
	buildObsOverlayHtml(): string;
	exportLegacyOBS(force?: boolean): void;
	
	// 样式管理
	injectGlobalStyles(): void;
	removeGlobalStyles(): void;
	applyEyeCare(): void;
	removeEyeCare(): void;
}
