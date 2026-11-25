import { showPluginNotice } from './PluginNoticeService';
import type { TFile, Vault } from 'obsidian';
import { ChapterSorter } from './ChapterSorter';
import { getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import { PLATFORM_DELAYS } from '../constants';
import { t } from '../i18n';
import { CACHE_CONFIG } from '../constants';
import { getPluginDir, isMobile } from '../utils/platform';
import { isExcludedFromWordCount } from '../utils/validation';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { JsonSnapshotStore } from '../utils/JsonSnapshotStore';
import { Logger } from '../utils/Logger';

const CACHE_VERSION = 4;

/**
 * 缓存条目接口
 */
export interface CacheEntry {
	path: string;
	wordCount: number;
	lastModified: number;
	isFolder?: boolean; // [优化] 标记是否为文件夹，防止 LRU 清理 [M-P5]
}

/**
 * 持久化缓存数据接口
 */
export interface CacheData {
	version: number;
	timestamp: number;
	entries: Array<[string, CacheEntry]>;
}

/**
 * 缓存管理器
 * 负责管理文件夹字数缓存，实现增量更新和失效策略
 * 支持缓存持久化，提升启动速度
 */
export class CacheManager {
	private cache: Map<string, CacheEntry>;
	private maxCacheSize: number = CACHE_CONFIG.MAX_SIZE;
	private plugin: WebNovelAssistantPlugin; // 插件实例，用于持久化
	private cacheFilePath: string; // 独立缓存文件路径
	private lastCacheTimestamp: number = Date.now(); // 稳定的快照时间戳，仅在修改或加载时更新
	
	// 快照持久化存储：确保数据保存的原子性、突发合并与冗余写入抑制
	private store: JsonSnapshotStore<CacheData>;
	private pendingMobileRefreshTimers = new Set<number>();
	private activeReadTokens = new Map<string, Set<{ stale: boolean }>>();
	private cacheEpoch = 0;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.cache = new Map();
		this.plugin = plugin;
		this.cacheFilePath = `${getPluginDir(plugin)}/cache-data.json`;

		this.plugin.register(() => {
			for (const timer of this.pendingMobileRefreshTimers) {
				window.clearTimeout(timer);
			}
			this.pendingMobileRefreshTimers.clear();
		});
		this.store = new JsonSnapshotStore<CacheData>({
			write: async (content) => {
				const adapter = this.plugin.app.vault.adapter;
				await adapter.write(this.cacheFilePath, content);
			},
			getSnapshot: () => ({
				version: CACHE_VERSION,
				timestamp: this.lastCacheTimestamp,
				entries: Array.from(this.cache.entries())
			}),
			onError: (error) => {
				console.error('[CacheManager] 保存缓存失败:', error);
			}
		});
	}

	/**
	 * 统一标记缓存修改与时间戳更新
	 */
	private markCacheDirty(): void {
		this.lastCacheTimestamp = Date.now();
		this.store.markDirty();
	}

	/**
	 * 从持久化存储加载缓存
	 */
	async loadCache(): Promise<boolean> {
		if (this.plugin.isUnloading) return false;
		const epoch = this.cacheEpoch;

		try {
			let cacheData: CacheData | undefined;
			let shouldPersistMigration = false;
			const adapter = this.plugin.app.vault.adapter;

			// 首选独立缓存文件，缺失时兼容旧版 data.json。
			const exists = await adapter.exists(this.cacheFilePath);
			if (!this.isBuildCurrent(epoch)) return false;
			if (exists) {
				const content = await adapter.read(this.cacheFilePath);
				if (!this.isBuildCurrent(epoch)) return false;
				const parsed = JSON.parse(content) as Record<string, unknown>;
				if (parsed && typeof parsed === 'object' && typeof parsed.version === 'number' && typeof parsed.timestamp === 'number' && Array.isArray(parsed.entries)) {
					cacheData = parsed as unknown as CacheData;
				}
			} else {
				const data = await this.plugin.loadData() as { cacheData?: CacheData } | null;
				if (!this.isBuildCurrent(epoch)) return false;
				cacheData = data?.cacheData;
				shouldPersistMigration = Boolean(cacheData);
			}
			if (!cacheData) return false;

			// 检查版本
			if (cacheData.version !== CACHE_VERSION) {
				console.warn(`[CacheManager] 缓存版本不匹配 (${cacheData.version} != ${CACHE_VERSION})，忽略并重建`);
				return false;
			}

			// 检查缓存是否过期（超过 7 天）
			const age = Date.now() - cacheData.timestamp;
			const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 天
			if (age > maxAge) {
				return false;
			}

			// 加载缓存并标记为未修改干净状态（保持加载时的稳定时间戳）
			this.lastCacheTimestamp = cacheData.timestamp;
			this.cacheEpoch++;
			this.markAllActiveReadsStale();
			this.cache = new Map(cacheData.entries);
			this.store.markClean(cacheData);

			if (shouldPersistMigration) {
				this.markCacheDirty();
				await this.saveCache();
			}
			return true;
		} catch (error) {
			console.error('[CacheManager] 加载缓存失败:', error);
			return false;
		}
	}

	/**
	 * 获取所有缓存条目的迭代器
	 */
	getEntries(): IterableIterator<[string, CacheEntry]> {
		return this.cache.entries();
	}

	/**
	 * 保存缓存到持久化存储（原子操作）
	 */
	async saveCache(): Promise<void> {
		await this.store.save();
	}

	/**
	 * 强制等待所有待处理的保存操作完成
	 */
	async flush(): Promise<void> {
		await this.store.flush();
	}

	/**
	 * 检查是否有未保存的变更
	 */
	isDirty(): boolean {
		return this.store.isDirty();
	}

	private isBuildCurrent(epoch: number): boolean {
		return !this.plugin.isUnloading && this.cacheEpoch === epoch;
	}

	/**
	 * 统一批量读取文件并更新缓存（支持分片让权、时间戳与卸载安全检查）
	 */
	private async processFileReadBatch(
		filesToProcess: readonly TFile[],
		vault: Vault,
		calculateWords: (content: string) => number,
		epoch: number,
		isFileInWorkspace?: (file: TFile) => boolean
	): Promise<number> {
		let failCount = 0;
		const CHUNK_SIZE = 50;

		for (let i = 0; i < filesToProcess.length; i++) {
			if (!this.isBuildCurrent(epoch)) break;
			const file = filesToProcess[i];
			try {
				const snapshot = this.beginFileReadSnapshot(file, vault);
				if (!snapshot) continue;
				try {
					const content = await vault.cachedRead(file);
					if (!this.isBuildCurrent(epoch)) break;
					if (!this.isFileReadSnapshotValid(snapshot, vault, isFileInWorkspace)) {
						continue;
					}
					const count = calculateWords(content);
					this.applyFileCacheUpdate(file, count, vault, true);
				} finally {
					this.endFileReadSnapshot(snapshot);
				}
			} catch (error) {
				console.error(`[CacheManager] 读取文件失败: ${file.path}`, error);
				failCount++;
			}

			if ((i + 1) % CHUNK_SIZE === 0) {
				await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
			}
		}

		return failCount;
	}

	/**
	 * 初始化缓存 - 一次性读取所有文件构建完整缓存
	 * @param vault Obsidian Vault 实例
	 * @param calculateWords 字数计算函数
	 * @param isFileInWorkspace 工作区检查函数（可选）
	 */
	async buildInitialCache(
		vault: Vault,
		calculateWords: (content: string) => number,
		isFileInWorkspace?: (file: TFile) => boolean
	): Promise<void> {
		if (this.plugin.isUnloading) return;
		const epoch = this.cacheEpoch;
		const startTime = Date.now();

		try {
			const files = this.plugin.getTrackedMarkdownFiles(true).filter(file =>
				isFileInWorkspace ? isFileInWorkspace(file) : this.isEligibleForTotalWordCount(file));
			const failCount = await this.processFileReadBatch(files, vault, calculateWords, epoch, isFileInWorkspace);
			if (!this.isBuildCurrent(epoch)) return;

			if (failCount > 0) {
				console.warn(`[CacheManager] 警告: ${failCount} 个文件读取失败，缓存可能不完整`);
			}

			await this.saveCache();
			Logger.info(`[CacheManager] 初始缓存构建完成，用时 ${Date.now() - startTime}ms`);
		} catch (error) {
			console.error('[CacheManager] 缓存构建失败:', error);
			throw error;
		}
	}

	/**
	 * 获取文件夹字数（从缓存）
	 * @param folderPath 文件夹路径
	 * @returns 字数，如果缓存未命中则返回 null
	 */
	getFolderWordCount(folderPath: string): number | null {
		const entry = this.cache.get(folderPath);
		return entry ? entry.wordCount : null;
	}

	private markPathReadsStale(path: string): void {
		const tokens = this.activeReadTokens.get(path);
		if (!tokens) return;
		for (const token of tokens) {
			token.stale = true;
		}
	}

	private markAllActiveReadsStale(): void {
		for (const tokens of this.activeReadTokens.values()) {
			for (const token of tokens) {
				token.stale = true;
			}
		}
	}

	private beginFileReadSnapshot(file: TFile, vault: Vault) {
		const path = file.path;
		if (typeof vault.getAbstractFileByPath === 'function' && vault.getAbstractFileByPath(path) !== file) {
			return null;
		}
		const token = { stale: false };
		let set = this.activeReadTokens.get(path);
		if (!set) {
			set = new Set();
			this.activeReadTokens.set(path, set);
		}
		set.add(token);
		return {
			file,
			path,
			mtime: file.stat?.mtime,
			size: file.stat?.size,
			entry: this.cache.get(path),
			token,
			epoch: this.cacheEpoch,
		};
	}

	private endFileReadSnapshot(snapshot: NonNullable<ReturnType<CacheManager['beginFileReadSnapshot']>>): void {
		const set = this.activeReadTokens.get(snapshot.path);
		if (!set) return;
		set.delete(snapshot.token);
		if (set.size === 0) {
			this.activeReadTokens.delete(snapshot.path);
		}
	}

	private isFileReadSnapshotValid(
		snapshot: NonNullable<ReturnType<CacheManager['beginFileReadSnapshot']>>,
		vault: Vault,
		isFileInWorkspace?: (file: TFile) => boolean
	): boolean {
		const { file, path, mtime, size, entry, token, epoch } = snapshot;
		if (token.stale || this.cacheEpoch !== epoch) return false;
		if (file.path !== path) return false;
		if (file.stat?.mtime !== mtime || file.stat?.size !== size) return false;
		if (typeof vault.getAbstractFileByPath === 'function' && vault.getAbstractFileByPath(path) !== file) return false;
		if (this.cache.get(path) !== entry) return false;
		if (!this.isEligibleForTotalWordCount(file)) return false;
		if (isFileInWorkspace && !isFileInWorkspace(file)) return false;
		return true;
	}

	/**
	 * 更新单个文件的缓存（增量更新）
	 * @param file 文件对象
	 * @param newWordCount 新的字数
	 * @param vault Vault 实例
	 */
	updateFileCache(file: TFile, newWordCount: number, _vault: Vault): number {
		return this.applyFileCacheUpdate(file, newWordCount, _vault, false);
	}

	private applyFileCacheUpdate(
		file: TFile,
		newWordCount: number,
		_vault: Vault,
		allowBackwardsMtime: boolean
	): number {
		if (this.plugin.isUnloading) return 0;
		if (!this.isEligibleForTotalWordCount(file)) {
			if (this.cache.has(file.path)) {
				this.invalidateCache(file.path, _vault);
			}
			return 0;
		}

		const oldEntry = this.cache.get(file.path);
		
		// [BUGFIX] 时间戳校验：防止旧的异步读取结果覆盖新的缓存。
		// 如果现有缓存的时间戳晚于当前文件的修改时间，说明已经有更近的修改（如编辑器实时更新）写入了缓存，应跳过。
		if (!allowBackwardsMtime && oldEntry && oldEntry.lastModified > file.stat.mtime) {
			return 0;
		}

		this.markPathReadsStale(file.path);
		const oldCount = oldEntry ? oldEntry.wordCount : 0;
		const delta = newWordCount - oldCount;

		// 更新文件自身缓存
		this.cache.set(file.path, {
			path: file.path,
			wordCount: newWordCount,
			lastModified: file.stat.mtime,
			isFolder: false
		});

		// 递归更新所有父文件夹
		let parent = file.parent;
		while (parent) {
			const parentEntry = this.cache.get(parent.path);
			if (parentEntry) {
				parentEntry.wordCount += delta;
				parentEntry.lastModified = Date.now();
			} else {
				this.cache.set(parent.path, {
					path: parent.path,
					wordCount: Math.max(0, delta),
					lastModified: Date.now(),
					isFolder: true
				});
			}
			parent = parent.parent;
		}

		this.markCacheDirty();

		if (!oldEntry || oldEntry.wordCount !== newWordCount) {
			this.plugin.app.workspace?.trigger('webnovel:file-word-count-updated', file, newWordCount);
		}

		// 清理缓存大小
		if (this.cache.size > this.maxCacheSize) {
			this.clearOldEntries();
		}

		return delta;
	}

	/**
	 * 使缓存失效
	 * @param path 文件或文件夹路径
	 * @param _vault Vault 实例
	 */
	invalidateCache(path: string, _vault: Vault): void {
		this.markPathReadsStale(path);
		const entry = this.cache.get(path);
		if (!entry) return;

		const wordCount = entry.wordCount;
		this.cache.delete(path);

		// 递归失效所有父文件夹（减去该路径的字数）
		let parentPath = path;
		while (parentPath.includes('/')) {
			parentPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
			if (!parentPath) break;
			const parentEntry = this.cache.get(parentPath);
			if (parentEntry && parentEntry.isFolder) {
				parentEntry.wordCount = Math.max(0, parentEntry.wordCount - wordCount);
				parentEntry.lastModified = Date.now();
			}
		}
		// 处理根目录
		const rootEntry = this.cache.get('/');
		if (rootEntry && rootEntry.isFolder) {
			rootEntry.wordCount = Math.max(0, rootEntry.wordCount - wordCount);
			rootEntry.lastModified = Date.now();
		}

		this.markCacheDirty();
	}

	/**
	 * 清空所有缓存
	 */
	clearCache(): void {
		this.cacheEpoch++;
		this.markAllActiveReadsStale();
		this.cache.clear();
		this.markCacheDirty();
	}

	/**
	 * 获取缓存统计信息
	 */
	getCacheStats(): { size: number; memoryUsage: number } {
		// 估算内存使用（每个条目约 100 字节）
		const memoryUsage = this.cache.size * 100;
		return {
			size: this.cache.size,
			memoryUsage
		};
	}

	/**
	 * 获取文件的缓存字数
	 * @param filePath 文件路径
	 * @returns 缓存的字数，如果不存在则返回 null
	 */
	getFileCache(filePath: string): number | null {
		const entry = this.cache.get(filePath);
		return entry ? entry.wordCount : null;
	}

	/**
	 * 检查指定文件的缓存是否有效且与当前文件修改时间一致
	 */
	isFileCacheCurrent(file: TFile): boolean {
		const entry = this.cache.get(file.path);
		if (!entry || entry.isFolder) return false;
		return typeof file.stat?.mtime === 'number' && entry.lastModified === file.stat.mtime;
	}

	/**
	 * 清理最旧的 20% 条目
	 */
	private clearOldEntries(): void {
		console.warn('[CacheManager] 缓存大小超过限制，正在清理...');
		
		const entries = Array.from(this.cache.entries());
		// [BUGFIX] 文件夹条目不应被清理，否则会导致文件夹统计失效 [M-P5]
		const fileEntries = entries.filter(e => !e[1].isFolder);
		fileEntries.sort((a, b) => a[1].lastModified - b[1].lastModified);
		
		const toDeleteCount = Math.floor(fileEntries.length * 0.2);
		for (let i = 0; i < toDeleteCount; i++) {
			const [path, entry] = fileEntries[i];
			const wordCount = entry.wordCount;
			this.cache.delete(path);
			
			// [BUGFIX] 从所有父文件夹中扣除被淘汰文件的字数，防止重新加入时导致字数膨胀
			let parentPath = path;
			while (parentPath.includes('/')) {
				parentPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
				if (!parentPath) break;
				const parentEntry = this.cache.get(parentPath);
				if (parentEntry && parentEntry.isFolder) {
					parentEntry.wordCount = Math.max(0, parentEntry.wordCount - wordCount);
					parentEntry.lastModified = Date.now();
				}
			}
			// 处理根目录（Obsidian中根目录可能被特殊处理，如果有条目也需扣减）
			const rootEntry = this.cache.get('/');
			if (rootEntry && rootEntry.isFolder) {
				rootEntry.wordCount = Math.max(0, rootEntry.wordCount - wordCount);
			}
		}

		this.markCacheDirty();
	}

	private _loreCandidatesCache: Set<string> | null = null;
	private _dictPathsCache: Set<string> | null = null;
	private _normalizedWorkspaceFolders: string[] | null = null;
	private _normalizedStrictExceptions: string[] | null = null;

	resetLoreCache(): void {
		this._loreCandidatesCache = null;
		this._dictPathsCache = null;
		this._normalizedWorkspaceFolders = null;
		this._normalizedStrictExceptions = null;
	}

	isFileInWorkspace(file: TFile): boolean {
		if (!this.plugin.settings.workspaceFolders || this.plugin.settings.workspaceFolders.length === 0) {
			return true;
		}

		if (!this._normalizedWorkspaceFolders) {
			this._normalizedWorkspaceFolders = this.plugin.settings.workspaceFolders.map(folder => folder.replace(/^\/+|\/+$/g, ""));
		}

		const filePath = file.path;
		return this._normalizedWorkspaceFolders.some(normalizedFolder => {
			if (normalizedFolder === "") return true;
			return filePath === normalizedFolder || filePath === normalizedFolder + ".md" || filePath.startsWith(normalizedFolder + "/");
		});
	}

	isFileInStrictChapterException(file: TFile): boolean {
		if (!this.plugin.settings.strictChapterExceptions || this.plugin.settings.strictChapterExceptions.length === 0) {
			return false;
		}

		if (!this._normalizedStrictExceptions) {
			this._normalizedStrictExceptions = this.plugin.settings.strictChapterExceptions.map(folder => folder.replace(/^\/+|\/+$/g, ""));
		}

		const filePath = file.path;
		return this._normalizedStrictExceptions.some(normalizedFolder => {
			if (normalizedFolder === "") return false;
			return filePath === normalizedFolder + ".md" || filePath.startsWith(normalizedFolder + "/");
		});
	}

	isPluginGeneratedFile(basename: string): boolean {
		const checks = [
			{ setting: this.plugin.settings.novelInfo?.fileName, field: "novelInfoFileName" },
			{ setting: this.plugin.settings.foreshadowing?.fileName, field: "foreshadowingFileName" },
			{ setting: this.plugin.settings.timeline?.fileName, field: "timelineFileName" },
			{ setting: this.plugin.settings.task?.fileName, field: "taskFileName" },
		];
		for (const { setting, field } of checks) {
			if (setting && basename === setting) return true;
			for (const cand of getDefaultFileNameCandidates(field as Parameters<typeof getDefaultFileName>[0])) {
				if (basename === cand) return true;
			}
		}
		return false;
	}

	isEligibleForChapterList(file: TFile): boolean {
		if (!this.isFileInWorkspace(file)) return false;
		if (file.basename.includes("_合并章节")) return false;

		const basename = file.basename;
		if (
			this.isPluginGeneratedFile(basename) ||
			file.path === this.plugin.homepageManager?.getHomepageFilePath()
		) {
			return false;
		}

		if (!this._loreCandidatesCache) {
			this._loreCandidatesCache = new Set<string>();
			this._loreCandidatesCache.add(this.plugin.settings.loreFolderName || getDefaultFileName("loreFolderName"));
			for (const name of getDefaultFileNameCandidates("loreFolderName")) this._loreCandidatesCache.add(name);
		}

		for (const lorePath of this._loreCandidatesCache) {
			if (file.path.includes(`/${lorePath}/`) || file.path.startsWith(`${lorePath}/`)) {
				return false;
			}
		}

		if (
			this.isFileInProofreadingDictionary(file) &&
			!ChapterSorter.isChapterFile(file.name)
		) {
			return false;
		}

		if (this.plugin.settings.enableStrictChapterMode) {
			return ChapterSorter.isChapterFile(file.name) || this.isFileInStrictChapterException(file);
		}

		return true;
	}

	private isFileInProofreadingDictionary(file: TFile): boolean {
		if (!this._dictPathsCache) {
			this._dictPathsCache = new Set<string>(['校对词典', 'Proofreading Dictionaries']);
			const rawDictPath = this.plugin.settings.proofreading?.dictionaryPath?.replace(/^\/+|\/+$/g, '');
			if (rawDictPath) this._dictPathsCache.add(rawDictPath);
		}

		const lastSlash = file.path.lastIndexOf('/');
		if (lastSlash === -1) return false;
		const parentPath = file.path.slice(0, lastSlash);
		const parentSegments = parentPath.split('/');

		for (const dictionaryPath of this._dictPathsCache) {
			if (!dictionaryPath) continue;
			if (dictionaryPath.includes('/')) {
				if (parentPath === dictionaryPath || parentPath.startsWith(`${dictionaryPath}/`)) {
					return true;
				}
			} else if (parentSegments.includes(dictionaryPath)) {
				return true;
			}
		}

		return false;
	}

	isEligibleForWordCount(file: TFile): boolean {
		if (!this.isEligibleForChapterList(file)) return false;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (isExcludedFromWordCount(cache?.frontmatter)) {
			return false;
		}

		return true;
	}

	/**
	 * 主页、写作面板和文件树总字数汇总有效正文文档。
	 * 在严格章节模式下仅汇总章节及例外目录文件；在常规模式下汇总除功能性文件外的所有正文。
	 */
	isEligibleForTotalWordCount(file: TFile): boolean {
		return this.isEligibleForWordCount(file);
	}

	async buildFolderCache(): Promise<void> {
		if (!this.plugin.settings.showExplorerCounts || this.plugin.isUnloading) return;

		try {
			const beforeLoad = this.cacheEpoch;
			const loaded = this.cache.size > 0 || await this.loadCache();
			if (this.plugin.isUnloading || (!loaded && beforeLoad !== this.cacheEpoch)) return;
			const epoch = this.cacheEpoch;
			const vault = this.plugin.app.vault;
			const workspaceFiles = this.plugin.getTrackedMarkdownFiles(true)
				.filter(file => this.isEligibleForTotalWordCount(file));

			let filesToRefresh = workspaceFiles;
			if (loaded) {
				const currentPaths = new Set(workspaceFiles.map(file => file.path));
				for (const [path, entry] of this.cache) {
					if (!entry.isFolder && !currentPaths.has(path)) this.invalidateCache(path, vault);
				}
				filesToRefresh = workspaceFiles.filter(file => !this.isFileCacheCurrent(file));
			}

			const notice = loaded ? undefined : showPluginNotice(t("notice.building-explorer-cache"), 0);
			try {
				await this.processFileReadBatch(filesToRefresh, vault, content => this.plugin.calculateAccurateWords(content), epoch);
			} finally {
				notice?.hide();
			}
			if (!this.isBuildCurrent(epoch)) return;
			if (loaded) this.rebuildFolderEntries();
			await this.saveCache();
			if (!this.isBuildCurrent(epoch)) return;

			if (isMobile()) {
				const timer = window.setTimeout(() => {
					this.pendingMobileRefreshTimers.delete(timer);
					if (this.plugin.isUnloading) return;
					this.plugin.fileExplorerPatcher?.refreshFolderCounts();
					if (this.plugin.settings.enableHomepage) void this.plugin.homepageManager?.refreshHomepageViews();
				}, PLATFORM_DELAYS.MOBILE_CACHE_REFRESH_DELAY);
				this.pendingMobileRefreshTimers.add(timer);
			} else {
				this.plugin.fileExplorerPatcher?.refreshFolderCounts();
				if (this.plugin.settings.enableHomepage) void this.plugin.homepageManager?.refreshHomepageViews();
			}

			showPluginNotice(t("notice.explorer-cache-complete"), 3000);
		} catch (error) {
			if (this.plugin.isUnloading) return;
			console.error("[Plugin] 缓存构建失败:", error);
			this.plugin.settings.showExplorerCounts = false;
			await this.plugin.saveSettings();
			showPluginNotice(
				t("notice.explorer-cache-failed", { error: error instanceof Error ? error.message : String(error) }),
				10000
			);
		}
	}

	private rebuildFolderEntries(): void {
		const fileEntries = Array.from(this.cache.values()).filter(entry => !entry.isFolder);
		for (const [path, entry] of Array.from(this.cache.entries())) {
			if (entry.isFolder) this.cache.delete(path);
		}

		const folderTotals = new Map<string, number>();
		for (const entry of fileEntries) {
			folderTotals.set('/', (folderTotals.get('/') || 0) + entry.wordCount);
			const parts = entry.path.split('/');
			parts.pop();
			for (let i = 1; i <= parts.length; i++) {
				const folderPath = parts.slice(0, i).join('/');
				if (folderPath) {
					folderTotals.set(folderPath, (folderTotals.get(folderPath) || 0) + entry.wordCount);
				}
			}
		}

		const now = Date.now();
		for (const [path, wordCount] of folderTotals) {
			this.cache.set(path, { path, wordCount, lastModified: now, isFolder: true });
		}

		this.markCacheDirty();
	}

}
