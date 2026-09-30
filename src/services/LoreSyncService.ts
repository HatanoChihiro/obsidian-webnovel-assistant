import type { TFile, MarkdownView } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

export interface LoreSyncStats {
	total: number;
	success: number;
	failed: number;
}

export class LoreSyncService {
	private plugin: WebNovelAssistantPlugin;
	private regexCache = new Map<string, { version: number, regex: RegExp }>();
	private _bulkPromise: Promise<LoreSyncStats> | null = null;

	private syncQueue = new Map<string, Promise<void>>();
	private dirtyFlags = new Set<string>();
	private _destroyed = false;

	public async destroy(): Promise<void> {
		this._destroyed = true;
		const activeSyncs = Array.from(this.syncQueue.values());
		if (activeSyncs.length > 0) {
			await Promise.allSettled(activeSyncs);
		}
		if (this._bulkPromise) {
			await this._bulkPromise.catch(() => {});
		}
		this.syncQueue.clear();
		this.dirtyFlags.clear();
		this.regexCache.clear();
	}

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	public initialize(): void {
		// 监听编辑器内容变化
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('editor-change', (_editor, info) => {
				const file = info.file;
				if (!file || file.extension !== 'md') return;
				
				// 仅在当前作品下处理
				const bookPath = this.plugin.characterManager.getBookPathForFile(file);
				if (!bookPath) return;
				
				// 排除设定文件本身，避免无限循环
				const parentPath = file.parent?.path || '';
				if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) return;
				
				if (!this.plugin.cacheManager.isEligibleForWordCount(file)) return;
				this.plugin.adaptiveDebounceManager.debounceFixed(`lore-sync-${file.path}`, () => {
					void this.syncLoreForFile(file).catch(err => {
						console.error(`[LoreSyncService] 自动同步设定失败: ${file.path}`, err);
					});
				}, 2000);
			})
		);

		// 监听文件打开，补全可能遗漏的同步
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf) return;
				const view = leaf.view as MarkdownView;
				if (view.getViewType() !== 'markdown' || !view.file) return;
				
				const file = view.file;
				if (file.extension !== 'md') return;
				
				const bookPath = this.plugin.characterManager.getBookPathForFile(file);
				if (!bookPath) return;
				
				const parentPath = file.parent?.path || '';
				if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) return;

				if (!this.plugin.cacheManager.isEligibleForWordCount(file)) return;
				this.plugin.adaptiveDebounceManager.debounceFixed(`lore-sync-${file.path}`, () => {
					void this.syncLoreForFile(file).catch(err => {
						console.error(`[LoreSyncService] 自动同步设定失败: ${file.path}`, err);
					});
				}, 1000);
			})
		);
	}

	/**
	 * 获取所有符合设定同步条件的章节文件
	 */
	public getEligibleChapterFiles(): TFile[] {
		const allMarkdownFiles = this.plugin.getTrackedMarkdownFiles();

		return allMarkdownFiles.filter(file => {
			if (!file || file.extension !== 'md') return false;
			const bookPath = this.plugin.characterManager.getBookPathForFile(file);
			if (!bookPath) return false;
			const parentPath = file.parent?.path || '';
			if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) return false;
			return this.plugin.cacheManager.isEligibleForWordCount(file);
		});
	}

	/**
	 * 批量刷新章节文件的设定引用（分片让权，隔离单文件失败）
	 */
	public bulkRefresh(files?: TFile[]): Promise<LoreSyncStats> {
		if (this._bulkPromise) {
			return this._bulkPromise;
		}

		this._bulkPromise = (async () => {
			try {
				const targetFiles = files ?? this.getEligibleChapterFiles();
				let success = 0;
				let failed = 0;
				const CHUNK_SIZE = 25;

				for (let i = 0; i < targetFiles.length; i++) {
					const file = targetFiles[i];
					try {
						await this.syncLoreForFile(file);
						success++;
					} catch (err) {
						console.error(`[LoreSyncService] 批量同步设定失败: ${file.path}`, err);
						failed++;
					}

					// 每处理 CHUNK_SIZE 个文件主动出让事件循环，保持界面响应
					if ((i + 1) % CHUNK_SIZE === 0) {
						await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
					}
				}

				return { total: targetFiles.length, success, failed };
			} finally {
				this._bulkPromise = null;
			}
		})();

		return this._bulkPromise;
	}

	public syncLoreForFile(file: TFile): Promise<void> {
		if (this._destroyed) return Promise.resolve();
		const filePath = file.path;
		if (this.syncQueue.has(filePath)) {
			this.dirtyFlags.add(filePath);
			return this.syncQueue.get(filePath) as Promise<void>;
		}

		const syncTask = (async () => {
			let lastError: unknown = null;
			do {
				this.dirtyFlags.delete(filePath);
				lastError = null;
				try {
					await this._performSync(file);
				} catch (err) {
					lastError = err;
				}
		} while (this.dirtyFlags.has(filePath));

			if (lastError) {
				throw lastError instanceof Error ? lastError : new Error('Lore sync failed with a non-Error value');
			}
		})();

		this.syncQueue.set(filePath, syncTask);
		syncTask.catch(() => {}).finally(() => this.syncQueue.delete(filePath));
		return syncTask;
	}

	private async _performSync(file: TFile): Promise<void> {
		if (this._destroyed) return;
		const bookPath = this.plugin.characterManager.getBookPathForFile(file);
		if (!bookPath) return;

		const loreNames = this.plugin.characterManager.getCharactersForBook(bookPath);
		if (!loreNames || loreNames.length === 0) return;

		const content = await this.plugin.app.vault.cachedRead(file);
		
		// 剥离 frontmatter
		let textToScan = content;
		const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
		if (match) {
			textToScan = content.substring(match[0].length);
		}

		const currentVersion = this.plugin.characterManager.cacheVersion;
		let cached = this.regexCache.get(bookPath);
		
		if (!cached || cached.version !== currentVersion) {
			const validNames = loreNames.filter(name => name.length >= 1);
			if (validNames.length > 0) {
				const escapedNames = validNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
				const megaRegex = new RegExp(`(${escapedNames.join('|')})`, 'g');
				cached = { version: currentVersion, regex: megaRegex };
				this.regexCache.set(bookPath, cached);
			} else {
				await this.updateFrontmatterLore(file, []);
				return;
			}
		}

		const megaRegex = cached.regex;
		megaRegex.lastIndex = 0;

		const matchCounts = new Map<string, number>();
		let regexMatch;
		while ((regexMatch = megaRegex.exec(textToScan)) !== null) {
			const foundName = regexMatch[1];
			matchCounts.set(foundName, (matchCounts.get(foundName) || 0) + 1);
		}

		const loreCounts = new Map<string, number>();
		for (const [name, count] of matchCounts.entries()) {
			const entry = this.plugin.characterManager.getCharacterFile(bookPath, name);
			if (entry) {
				const canonicalName = entry.heading;
				loreCounts.set(canonicalName, (loreCounts.get(canonicalName) || 0) + count);
			}
		}

		if (loreCounts.size === 0) {
			await this.updateFrontmatterLore(file, []);
			return;
		}

		// 组装 lore 数组： "名称×次数"
		const newLoreList = Array.from(loreCounts.entries())
			.sort((a, b) => b[1] - a[1]) // 按出现次数降序排列
			.map(([name, count]) => `${name}×${count}`);
			
		await this.updateFrontmatterLore(file, newLoreList);
	}

	private async updateFrontmatterLore(file: TFile, newLore: string[]): Promise<void> {
		if (this._destroyed) return;
		try {
			let isSame = false;
			await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				const existingLore = fm['lore'];
				
				if (Array.isArray(existingLore) && existingLore.length === newLore.length) {
					const existingSet = new Set(existingLore);
					isSame = newLore.every(item => existingSet.has(item));
				} else if (!existingLore && newLore.length === 0) {
					isSame = true;
				}

				if (isSame) return;
				if (newLore.length === 0) {
					delete fm['lore'];
				} else {
					fm['lore'] = newLore;
				}
			});
		} catch (err) {
			console.error(`[LoreSyncService] Failed to update lore for ${file.path}`, err);
			throw err;
		}
	}
}
