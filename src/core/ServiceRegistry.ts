import type { CacheManager } from '../services/CacheManager';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { SettingsManager } from './SettingsManager';
import type { CharacterManager } from '../services/CharacterManager';
import type { LoreSyncService } from '../services/LoreSyncService';
import type { HistoryDataManager } from '../services/HistoryDataManager';
import type { StickyNoteDataManager } from '../services/StickyNoteDataManager';
import type { FileExplorerPatcher } from '../services/FileExplorerPatcher';
import type { WordCounter } from '../services/WordCounter';
import type { ImmersiveModeManager } from '../ui/ImmersiveModeManager';
import type { CommandManager } from './CommandManager';
import type { ViewManager } from './ViewManager';
import type { MenuManager } from './MenuManager';
import type { StatisticsManager } from '../services/StatisticsManager';
import type { WorkerManager } from '../services/WorkerManager';
import type { MarkdownPostProcessor } from '../services/MarkdownPostProcessor';
import type { HomepageManager } from '../services/HomepageManager';
import type { EditorTracker } from '../services/EditorTracker';
import type { StyleManager } from '../services/StyleManager';
import type { FileEventManager } from '../services/FileEventManager';
import type { ForeshadowingManager } from '../services/ForeshadowingManager';
import type { TaskManager } from '../services/TaskManager';
import type { TimelineManager } from '../services/TimelineManager';
import type { RelationGraphManager } from '../services/RelationGraphManager';
import type { TypographyManager } from '../services/TypographyManager';
import type { ChapterMergeManager } from '../services/ChapterMergeManager';

import { Logger } from '../utils/Logger';

/**
 * 可销毁服务标准接口
 */
export interface Destroyable {
	destroy(): void | Promise<void>;
}

/**
 * 核心服务注册映射表
 * 声明所有可被 ServiceRegistry 注册与调用的服务类型
 */
export interface ServiceMap {
	CacheManager: CacheManager;
	AdaptiveDebounceManager: AdaptiveDebounceManager;
	SettingsManager: SettingsManager;
	CharacterManager: CharacterManager;
	LoreSyncService: LoreSyncService;
	HistoryDataManager: HistoryDataManager;
	StickyNoteDataManager: StickyNoteDataManager;
	FileExplorerPatcher: FileExplorerPatcher;
	WordCounter: WordCounter;
	ImmersiveModeManager: ImmersiveModeManager;
	CommandManager: CommandManager;
	ViewManager: ViewManager;
	MenuManager: MenuManager;
	StatisticsManager: StatisticsManager;
	WorkerManager: WorkerManager;
	MarkdownPostProcessor: MarkdownPostProcessor;
	HomepageManager: HomepageManager;
	EditorTracker: EditorTracker;
	StyleManager: StyleManager;
	FileEventManager: FileEventManager;
	ForeshadowingManager: ForeshadowingManager;
	TaskManager: TaskManager;
	TimelineManager: TimelineManager;
	RelationGraphManager: RelationGraphManager;
	TypographyManager: TypographyManager;
	ChapterMergeManager: ChapterMergeManager;
}

/**
 * 核心服务注册中心 (Service Registry)
 * 用于解耦 `main.ts` 中的各类管理器依赖
 */
export class ServiceRegistry {
	private services = new Map<string, unknown>();

	/**
	 * 注册一个服务实例
	 * @param key 服务的唯一标识符
	 * @param service 服务实例
	 */
	register<K extends keyof ServiceMap>(key: K, service: ServiceMap[K]): void;
	register<T>(key: string, service: T): void;
	register(key: string, service: unknown): void {
		this.services.set(key, service);
	}

	/**
	 * 获取一个服务实例
	 * @param key 服务的唯一标识符
	 * @returns 服务实例
	 * @throws 如果服务未找到，抛出异常
	 */
	get<K extends keyof ServiceMap>(key: K): ServiceMap[K];
	get<T>(key: string): T;
	get(key: string): unknown {
		const service = this.services.get(key);
		if (!service) {
			throw new Error(`Service '${key}' not found in registry`);
		}
		return service;
	}

	/**
	 * 获取一个可选的服务实例
	 * @param key 服务的唯一标识符
	 * @returns 服务实例，如果未找到则返回 undefined
	 */
	getOptional<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined;
	getOptional<T>(key: string): T | undefined;
	getOptional(key: string): unknown {
		return this.services.get(key);
	}

	/**
	 * 检查是否已注册指定服务
	 * @param key 服务的唯一标识符
	 */
	has(key: string): boolean {
		return this.services.has(key);
	}

	/**
	 * 清空所有注册的服务
	 */
	clear(): void {
		this.services.clear();
	}

	/**
	 * 统一异步逆序销毁所有支持 cleanup/destroy 的服务
	 */
	async destroyAll(): Promise<void> {
		const entries = Array.from(this.services.entries()).reverse();
		for (const [name, service] of entries) {
			if (service && typeof service === 'object') {
				const obj = service as Record<string, unknown>;
				if (typeof obj.destroy === 'function') {
					try {
						await (obj as { destroy: () => void | Promise<void> }).destroy();
					} catch (e) {
						Logger.error(`[ServiceRegistry] Error destroying service '${name}':`, e);
					}
				} else if (typeof obj.cleanup === 'function') {
					try {
						await (obj as { cleanup: () => void | Promise<void> }).cleanup();
					} catch (e) {
						Logger.error(`[ServiceRegistry] Error cleaning up service '${name}':`, e);
					}
				}
			}
		}
		this.clear();
	}
}
