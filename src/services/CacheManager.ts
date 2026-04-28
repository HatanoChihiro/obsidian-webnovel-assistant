import { TFile, TFolder, Vault } from 'obsidian';
import { CACHE_CONFIG } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 缓存条目接口
 */
export interface CacheEntry {
	path: string;
	wordCount: number;
	lastModified: number;
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
	
	// 写入队列：确保数据保存的原子性
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(plugin: WebNovelAssistantPlugin) {
		this.cache = new Map();
		this.plugin = plugin;
		this.cacheFilePath = `${plugin.manifest.dir}/cache-data.json`;
	}

	/**
	 * 从持久化存储加载缓存
	 */
	async loadCache(): Promise<boolean> {
		if (!this.plugin) return false;

		try {
			let cacheData: CacheData | undefined;
			const adapter = this.plugin.app.vault.adapter;

			// 首选：从独立缓存文件加载
			if (await adapter.exists(this.cacheFilePath)) {
				const content = await adapter.read(this.cacheFilePath);
				cacheData = JSON.parse(content);
				console.log('[CacheManager] 已从独立文件读取缓存数据');
			} else {
				// 兼容：从 data.json 读取旧版缓存进行迁移
				const data = await this.plugin.loadData();
				if (data && data.cacheData) {
					cacheData = data.cacheData as CacheData;
					console.log('[CacheManager] 检测到旧版本位于 data.json 的缓存数据，将通过首次保存迁移到独立文件');
					
					// 触发持久化至新独立文件。原 data.json 中的数据会在下次保存设置时由于没有保留逻辑而被自发剥离清理掉
					this.saveCache().catch(e => console.warn('缓存初始迁移保存失败:', e));
				}
			}

			if (!cacheData) {
				console.log('[CacheManager] 没有找到持久化缓存');
				return false;
			}
			
			// 检查版本
			if (cacheData.version !== 1) {
				console.warn('[CacheManager] 缓存版本不匹配，忽略');
				return false;
			}

			// 检查缓存是否过期（超过 7 天）
			const age = Date.now() - cacheData.timestamp;
			const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 天
			if (age > maxAge) {
				console.log('[CacheManager] 缓存已过期，将重新构建');
				return false;
			}

			// 加载缓存
			this.cache = new Map(cacheData.entries);
			console.log(`[CacheManager] 已加载 ${this.cache.size} 个缓存条目（${Math.round(age / 1000 / 60)} 分钟前）`);
			return true;
		} catch (error) {
			console.error('[CacheManager] 加载缓存失败:', error);
			return false;
		}
	}

	/**
	 * 保存缓存到持久化存储（原子操作）
	 */
	async saveCache(): Promise<void> {
		if (!this.plugin) return;

		// 将保存操作加入队列，确保串行执行
		this.saveQueue = this.saveQueue.then(async () => {
			try {
				const cacheData: CacheData = {
					version: 1,
					timestamp: Date.now(),
					entries: Array.from(this.cache.entries())
				};

				// 直接序列化并写入到独立的 cache-data.json 文件
				const adapter = this.plugin.app.vault.adapter;
				const content = JSON.stringify(cacheData, null, 2);
				await adapter.write(this.cacheFilePath, content);
				
				console.log(`[CacheManager] 已保存 ${this.cache.size} 个缓存条目到独立文件`);
			} catch (error) {
				console.error('[CacheManager] 保存缓存失败:', error);
			}
		});

		// 等待当前保存操作完成
		return this.saveQueue;
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
		console.log('[CacheManager] 开始构建初始缓存...');
		const startTime = Date.now();

		try {
			const allFiles = vault.getMarkdownFiles();
			// 如果提供了工作区检查函数，只处理工作区内的文件
			const filesToProcess = isFileInWorkspace 
				? allFiles.filter(f => isFileInWorkspace(f))
				: allFiles;
			
			const fileCounts = new Map<string, number>();
			
			let successCount = 0;
			let failCount = 0;

			// 批量读取所有文件并计算字数
			for (const file of filesToProcess) {
				try {
					const content = await vault.cachedRead(file);
					const count = calculateWords(content);
					fileCounts.set(file.path, count);

					// 记录单文件缓存
					this.cache.set(file.path, {
						path: file.path,
						wordCount: count,
						lastModified: file.stat.mtime
					});
					
					successCount++;
				} catch (error) {
					console.error(`[CacheManager] 读取文件失败: ${file.path}`, error);
					failCount++;
					// 继续处理其他文件，不中断整个缓存构建
				}
			}

			// 构建文件夹聚合缓存
			for (const [filePath, count] of fileCounts.entries()) {
				const file = vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					let parent = file.parent;
					while (parent) {
						const existing = this.cache.get(parent.path);
						if (existing) {
							existing.wordCount += count;
						} else {
							this.cache.set(parent.path, {
								path: parent.path,
								wordCount: count,
								lastModified: Date.now()
							});
						}
						parent = parent.parent;
					}
				}
			}

			const elapsed = Date.now() - startTime;
			console.log(
				`[CacheManager] 缓存构建完成: ${successCount} 个文件成功, ` +
				`${failCount} 个文件失败, ` +
				`${this.cache.size} 个缓存条目, 耗时 ${elapsed}ms`
			);
			
			if (failCount > 0) {
				console.warn(`[CacheManager] 警告: ${failCount} 个文件读取失败，缓存可能不完整`);
			}

			// 保存缓存到持久化存储
			await this.saveCache();
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
	getFolderCount(folderPath: string): number | null {
		const entry = this.cache.get(folderPath);
		return entry ? entry.wordCount : null;
	}

	/**
	 * 更新单个文件的缓存（增量更新）
	 * @param file 文件对象
	 * @param newWordCount 新的字数
	 * @param vault Vault 实例
	 */
	updateFileCache(file: TFile, newWordCount: number, vault: Vault): void {
		const oldEntry = this.cache.get(file.path);
		const oldCount = oldEntry ? oldEntry.wordCount : 0;
		const delta = newWordCount - oldCount;

		// 更新文件自身缓存
		this.cache.set(file.path, {
			path: file.path,
			wordCount: newWordCount,
			lastModified: file.stat.mtime
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
					lastModified: Date.now()
				});
			}
			parent = parent.parent;
		}

		// 检查缓存大小
		if (this.cache.size > this.maxCacheSize) {
			this.clearOldEntries();
		}

		console.log(`[CacheManager] 已更新文件缓存: ${file.path} (${oldCount} → ${newWordCount}, Δ${delta})`);
	}

	/**
	 * 使缓存失效
	 * @param path 文件或文件夹路径
	 * @param vault Vault 实例
	 */
	invalidateCache(path: string, vault: Vault): void {
		const entry = this.cache.get(path);
		if (!entry) return;

		const wordCount = entry.wordCount;
		this.cache.delete(path);

		// 递归失效所有父文件夹（减去该路径的字数）
		const abstractFile = vault.getAbstractFileByPath(path);
		if (abstractFile) {
			let parent = abstractFile.parent;
			while (parent) {
				const parentEntry = this.cache.get(parent.path);
				if (parentEntry) {
					parentEntry.wordCount = Math.max(0, parentEntry.wordCount - wordCount);
					parentEntry.lastModified = Date.now();
				}
				parent = parent.parent;
			}
		}
	}

	/**
	 * 清空所有缓存
	 */
	clearCache(): void {
		this.cache.clear();
		console.log('[CacheManager] 缓存已清空');
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
	 * 清理最旧的 20% 条目
	 */
	private clearOldEntries(): void {
		console.warn('[CacheManager] 缓存大小超过限制，正在清理...');
		
		const entries = Array.from(this.cache.entries());
		entries.sort((a, b) => a[1].lastModified - b[1].lastModified);

		const toDelete = Math.floor(entries.length * 0.2);
		for (let i = 0; i < toDelete; i++) {
			this.cache.delete(entries[i][0]);
		}

		console.log(`[CacheManager] 已清理 ${toDelete} 个旧缓存条目`);
	}
}
