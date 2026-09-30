import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder, type MarkdownView, Notice, normalizePath } from 'obsidian';
import type { WebNovelAssistantPlugin, SeriesLoreRenameResult } from '../types/plugin';
import { getDefaultFileName, getDefaultFileNameCandidates, getLoreLabel } from '../i18n/data-keys';
import { findBookRoot, getCandidateNames, isCandidateSubpath } from '../utils/path';
import { t } from '../i18n';

export interface LoreEntry {
	file: TFile;
	heading: string;
	important?: boolean;
}

export interface LoreCategoryOption {
	id: string;
	displayName: string;
	baseName: string;
	file?: TFile;
	isBorrowed?: boolean;
	sourceBookPath: string;
	sourceBookName: string;
	relPath: string;
}

/**
 * 清理设定标题文本，去除 Obsidian 双向链接、Markdown 格式标记、Hashtag 及多余空格
 */
export function cleanLoreHeading(rawHeading: string): string {
	if (!rawHeading) return '';

	return rawHeading
		.trim()
		.replace(/^#{1,6}\s+/, '')
		.replace(/<!--\s*wn-important\s*-->/g, '')
		.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
		.replace(/(^|\s)#[^\s#]+/g, '')
		.replace(/\*\*|__/g, '')
		.replace(/\*|_/g, '')
		.replace(/`/g, '')
		.trim();
}

/**
 * 设定管理器 (前身为角色管理器)
 * 负责解析和缓存各作品目录下 `loreFolderName` (例如 "设定") 文件夹中的设定文件。
 * 支持单文件模式以及字典大纲模式（按标题切分词条）。
 */
export class CharacterManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;

	// 例如： "小说A" -> "张三" -> { file: TFile, heading: '张三' }
	private characterCache: Map<string, Map<string, LoreEntry>> = new Map();

	private lowercaseKeyMap: Map<string, Map<string, string>> = new Map();

	// 增量贡献索引： "小说A" -> "小说A/设定/角色.md" -> [{ key: '张三', entry }, ...]
	private fileContributions: Map<string, Map<string, Array<{ key: string; entry: LoreEntry }>>> = new Map();

	// 文件路径到所属小说目录的快速反查映射："小说A/设定/角色.md" -> "小说A"
	private fileToBookMap: Map<string, string> = new Map();
	private bookToSeriesMap: Map<string, string> = new Map();
	private fileOrderCache: Map<string, LoreEntry[]> = new Map();
	private unmigratedSeriesLoreCandidates: Set<string> = new Set();
	
	public cacheVersion: number = 0;
	private _initialized: boolean = false;
	private _eventsRegistered: boolean = false;
	private _initPromise: Promise<void> | null = null;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	public ensureInitialized(): Promise<void> {
		if (this._initialized) return Promise.resolve();
		return this.initialize();
	}

	public initialize(): Promise<void> {
		if (this._initialized) return Promise.resolve();
		if (this._initPromise) return this._initPromise;

		if (!this._eventsRegistered) {
			this._eventsRegistered = true;
			// 监听文件变化
			this.plugin.registerEvent(
				this.app.vault.on('create', (file) => this.handleFileChange(file, 'create'))
			);
			this.plugin.registerEvent(
				this.app.vault.on('delete', (file) => this.handleFileChange(file, 'delete'))
			);
			this.plugin.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					this.handleFileChange(file, 'rename', oldPath);
				})
			);
			this.plugin.registerEvent(
				this.app.metadataCache.on('changed', (file) => {
					this.handleFileChange(file, 'modify');
				})
			);
		}

		this._initPromise = (async () => {
			try {
				await this.rebuildCache();
				this._initialized = true;
			} finally {
				this._initPromise = null;
			}
		})();
		return this._initPromise;
	}

	/**
	 * 全量重建设定缓存
	 */
	public async rebuildCache(): Promise<void> {
		this.bookToSeriesMap.clear();

		const knownBooks = new Set<string>();
		if (this.plugin.settings.workspaceFolders) {
			for (const wf of this.plugin.settings.workspaceFolders) {
				const normWf = (!wf || wf === '/') ? '/' : wf.replace(/^\/+|\/+$/g, '');
				if (normWf) knownBooks.add(normWf);
			}
		}
		if (this.plugin.homepageManager) {
			try {
				const folders = this.plugin.homepageManager.getNovelFolders();
				for (const f of folders) {
					const normF = (!f.folderPath || f.folderPath === '/') ? '/' : f.folderPath.replace(/^\/+|\/+$/g, '');
					if (normF) knownBooks.add(normF);
				}
			} catch {
				// ignore
			}
		}

		for (const bp of knownBooks) {
			const series = await this.getNovelSeries(bp);
			this.bookToSeriesMap.set(bp, series);
		}
		const newFileContributions = new Map<string, Map<string, Array<{ key: string; entry: LoreEntry }>>>();
		const newFileToBookMap = new Map<string, string>();
		
		const allMarkdownFiles: TFile[] = (this.plugin.settings.workspaceFolders && this.plugin.settings.workspaceFolders.length > 0)
			? this.plugin.getTrackedMarkdownFiles(true)
			: this.plugin.getVaultMarkdownFiles();

		const files = allMarkdownFiles.filter(file => {
			try {
				const parentPath = file.parent?.path || '';
				const bookPath = this.getBookPathForFile(file);
				if (!bookPath) return false;
				knownBooks.add(bookPath);
				return this.isLorePath(bookPath, parentPath);
			} catch {
				return false;
			}
		});

		for (const bp of knownBooks) {
			if (!this.bookToSeriesMap.has(bp)) {
				const series = await this.getNovelSeries(bp);
				this.bookToSeriesMap.set(bp, series);
			}
		}

		if (this.unmigratedSeriesLoreCandidates.size > 0) {
			const loreCandidates = this.getLoreCandidates();
			for (const unmigrated of [...this.unmigratedSeriesLoreCandidates]) {
				let stillExists = false;
				for (const bookPath of this.bookToSeriesMap.keys()) {
					const norm = (!bookPath || bookPath === '/') ? '' : bookPath.replace(/^\/+|\/+$/g, '');
					for (const loreName of loreCandidates) {
						const oldPath = norm ? `${norm}/${loreName}/${unmigrated}` : `${loreName}/${unmigrated}`;
						const folder = this.app.vault.getAbstractFileByPath(oldPath);
						if (folder instanceof TFolder && folder.children.length > 0) {
							stillExists = true;
							break;
						}
					}
					if (stillExists) break;
				}
				if (!stillExists) {
					this.unmigratedSeriesLoreCandidates.delete(unmigrated);
				}
			}
		}

		const parsedResults = await Promise.all(files.map(async (file) => {
			try {
				const parentPath = file.parent?.path || '';
				const bookPath = this.getBookPathForFile(file);
				if (!bookPath || !this.isLorePath(bookPath, parentPath)) return null;

				const entries = await this.parseLoreFile(file);
				return { file, bookPath, entries };
			} catch (err) {
				console.error(`[CharacterManager] 解析设定文件 ${file.path} 失败:`, err);
				return null;
			}
		}));

		for (const result of parsedResults) {
			if (!result) continue;
			const { file, bookPath, entries } = result;
			if (!newFileContributions.has(bookPath)) {
				newFileContributions.set(bookPath, new Map());
			}
			newFileContributions.get(bookPath)!.set(file.path, entries);
			newFileToBookMap.set(file.path, bookPath);
		}
		
		this.fileContributions = newFileContributions;
		this.fileToBookMap = newFileToBookMap;

		this.recomputeEffectiveCaches(knownBooks);
		this.cacheVersion++;

		this.notifyCacheUpdated();
	}

	/**
	 * 刷新指定作品（或所有已知作品）的系列从属关系缓存
	 * 如果系列从属未发生变化，直接返回 false，避免重读设定文件和无谓触发更新
	 * 如果系列从属发生变化，更新 bookToSeriesMap 并基于现有的 fileContributions 重新计算生效设定缓存，触发一次通知
	 */
	public async refreshSeriesMembership(targetBooks?: string | string[]): Promise<boolean> {
		const booksToCheck = new Set<string>();
		if (targetBooks !== undefined) {
			const list = Array.isArray(targetBooks) ? targetBooks : [targetBooks];
			for (const b of list) {
				const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
				if (norm) {
					booksToCheck.add(norm);
					const prefix = `${norm}/`;
					for (const known of this.bookToSeriesMap.keys()) {
						if (known.startsWith(prefix)) {
							booksToCheck.add(known);
						}
					}
				}
			}
		} else {
			for (const b of this.bookToSeriesMap.keys()) {
				const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
				if (norm) booksToCheck.add(norm);
			}
			if (this.plugin.settings.workspaceFolders) {
				for (const wf of this.plugin.settings.workspaceFolders) {
					const normWf = (!wf || wf === '/') ? '/' : wf.replace(/^\/+|\/+$/g, '');
					if (normWf) booksToCheck.add(normWf);
				}
			}
			if (this.plugin.homepageManager) {
				try {
					const folders = this.plugin.homepageManager.getNovelFolders();
					for (const f of folders) {
						const normF = (!f.folderPath || f.folderPath === '/') ? '/' : f.folderPath.replace(/^\/+|\/+$/g, '');
						if (normF) booksToCheck.add(normF);
					}
				} catch {
					// ignore
				}
			}
		}

		let hasChanged = false;

		for (const book of booksToCheck) {
			const normLookup = book === '/' ? '' : book;
			const oldSeries = this.bookToSeriesMap.get(book) ?? this.bookToSeriesMap.get(normLookup) ?? '';
			const freshSeries = await this.getNovelSeries(book);

			if (freshSeries !== oldSeries) {
				hasChanged = true;
				if (freshSeries) {
					this.bookToSeriesMap.set(book, freshSeries);
					if (normLookup) this.bookToSeriesMap.set(normLookup, freshSeries);
				} else {
					this.bookToSeriesMap.delete(book);
					if (normLookup) this.bookToSeriesMap.delete(normLookup);
				}
			}
		}

		if (hasChanged) {
			this.recomputeEffectiveCaches(booksToCheck);
			this.cacheVersion++;
			this.notifyCacheUpdated();
			return true;
		}

		return false;
	}

	/**
	 * 通知编辑器装饰器及工作台设定缓存已更新
	 */
	private notifyCacheUpdated(): void {
		try {
			this.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				if (view && view.getViewType() === 'markdown') {
					const editor = (view as MarkdownView).editor;
					const editorView = (editor as unknown as { cm?: { dispatch: (tr: object) => void } })?.cm;
					if (editorView) {
						editorView.dispatch({});
					}
				}
			});
		} catch (err) {
			console.error('[CharacterManager] dispatch CM update 失败:', err);
		}

		try {
			this.app.workspace.trigger('webnovel-workbench-lore-updated');
		} catch (err) {
			console.error('[CharacterManager] trigger lore-updated 失败:', err);
		}
	}

	/**
	 * 从指定作品的文件贡献列表重新聚合内存索引
	 */
	private aggregateBookCache(_bookPath?: string): void {
		this.recomputeEffectiveCaches();
	}

	/**
	 * 重新计算所有作品的生效设定缓存（本地优先，同系列借用公共设定，确定性顺序，无缝合并但冲突不静默覆盖）
	 */
	public recomputeEffectiveCaches(knownBooks?: Iterable<string>): void {
		const allBooks = new Set<string>();
		if (knownBooks) {
			for (const b of knownBooks) {
				const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
				if (norm) allBooks.add(norm);
			}
		}
		for (const b of this.fileContributions.keys()) {
			const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
			if (norm) allBooks.add(norm);
		}
		for (const b of this.bookToSeriesMap.keys()) {
			const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
			if (norm) allBooks.add(norm);
		}

		// 构建 系列名称 -> 成员作品列表（确定性排序）
		const seriesMembersMap = new Map<string, string[]>();
		for (const book of allBooks) {
			const normLookup = book === '/' ? '' : book;
			const series = this.bookToSeriesMap.get(book) ?? this.bookToSeriesMap.get(normLookup) ?? '';
			if (series) {
				if (!seriesMembersMap.has(series)) {
					seriesMembersMap.set(series, []);
				}
				const list = seriesMembersMap.get(series)!;
				if (!list.includes(book)) {
					list.push(book);
				}
			}
		}

		// 对同系列所有成员按作品路径进行确定性升序排序
		for (const members of seriesMembersMap.values()) {
			members.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		}

		const newCache = new Map<string, Map<string, LoreEntry>>();
		const newLowerMap = new Map<string, Map<string, string>>();
		const newFileOrderCache = new Map<string, LoreEntry[]>();

		for (const targetBook of allBooks) {
			const effectiveCache = new Map<string, LoreEntry>();
			const effectiveLower = new Map<string, string>();
			const effectiveOrder: LoreEntry[] = [];
			const seenHeadings = new Set<string>();

			// 优先级 1：当前作品自身的全部设定（本地优先，包含私有与本地公共）
			const localFiles = this.fileContributions.get(targetBook) ?? (targetBook === '/' ? this.fileContributions.get('') : undefined);
			if (localFiles) {
				for (const entries of localFiles.values()) {
					for (const { key, entry } of entries) {
						const cleanedKey = cleanLoreHeading(key);
						if (cleanedKey) {
							effectiveCache.set(cleanedKey, entry);
							effectiveLower.set(cleanedKey.toLowerCase(), cleanedKey);
							if (!seenHeadings.has(entry.heading)) {
								seenHeadings.add(entry.heading);
								effectiveOrder.push(entry);
							}
						}
					}
				}
			}

			// 优先级 2：同系列其他成员作品的公共系列设定（确定性顺序，绝不合并冲突，绝不共享私有）
			const normLookup = targetBook === '/' ? '' : targetBook;
			const targetSeries = this.bookToSeriesMap.get(targetBook) ?? this.bookToSeriesMap.get(normLookup) ?? '';
			if (targetSeries) {
				const members = seriesMembersMap.get(targetSeries) || [];
				for (const siblingBook of members) {
					if (siblingBook === targetBook) continue;

					const siblingFiles = this.fileContributions.get(siblingBook) ?? (siblingBook === '/' ? this.fileContributions.get('') : undefined);
					if (!siblingFiles) continue;

					// Sibling files in deterministic order
					const sortedFilePaths = Array.from(siblingFiles.keys()).sort((a, b) =>
						a.localeCompare(b, undefined, { numeric: true })
					);

					for (const filePath of sortedFilePaths) {
						const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
						// 严格校验：只有在 siblingBook 的公共系列设定子文件夹内的文件才会被借用共享！
						if (!this.isSeriesLorePath(siblingBook, parentPath)) {
							continue;
						}

						const entries = siblingFiles.get(filePath) || [];
						for (const { key, entry } of entries) {
							const cleanedKey = cleanLoreHeading(key);
							if (!cleanedKey) continue;

							// 冲突处理：若已有更高优先级的本地条目或更靠前的同系列成员条目，保留现有，绝不静默合并
							if (!effectiveCache.has(cleanedKey)) {
								effectiveCache.set(cleanedKey, entry);
							}
							const lower = cleanedKey.toLowerCase();
							if (!effectiveLower.has(lower)) {
								effectiveLower.set(lower, cleanedKey);
							}
							if (!seenHeadings.has(entry.heading)) {
								seenHeadings.add(entry.heading);
								effectiveOrder.push(entry);
							}
						}
					}
				}
			}

			if (effectiveCache.size > 0) {
				newCache.set(targetBook, effectiveCache);
				newLowerMap.set(targetBook, effectiveLower);
				newFileOrderCache.set(targetBook, effectiveOrder);
			}
		}

		this.characterCache = newCache;
		this.lowercaseKeyMap = newLowerMap;
		this.fileOrderCache = newFileOrderCache;
	}

	/**
	 * 增量更新单个设定文件的缓存条目
	 */
	public async updateFileCache(file: TFile): Promise<boolean> {
		if (file.extension !== 'md') return false;

		const parentPath = file.parent?.path || '';
		const bookPath = this.getBookPathForFile(file);
		const isLore = Boolean(bookPath && this.isLorePath(bookPath, parentPath));

		const oldBookPath = this.fileToBookMap.get(file.path);

		if (!isLore) {
			// 如果该文件原本在设定缓存中，但现在已被移出或不再是有效设定，则移除其旧贡献
			if (oldBookPath) {
				const bookFiles = this.fileContributions.get(oldBookPath);
				if (bookFiles && bookFiles.has(file.path)) {
					bookFiles.delete(file.path);
					if (bookFiles.size === 0) {
						this.fileContributions.delete(oldBookPath);
					}
					this.fileToBookMap.delete(file.path);
					this.aggregateBookCache(oldBookPath);
					this.cacheVersion++;
					this.notifyCacheUpdated();
					return true;
				}
			}
			return false;
		}

		// 是有效设定文件，仅读取和解析该单个文件
		const entries = await this.parseLoreFile(file);

		// 如果之前归属在其他作品下，先从旧作品清理
		if (oldBookPath && oldBookPath !== bookPath) {
			const oldBookFiles = this.fileContributions.get(oldBookPath);
			if (oldBookFiles) {
				oldBookFiles.delete(file.path);
				if (oldBookFiles.size === 0) {
					this.fileContributions.delete(oldBookPath);
				}
				this.aggregateBookCache(oldBookPath);
			}
		}

		const normBook = (!bookPath || bookPath === "/") ? "/" : bookPath.replace(/^\/+|\/+$/g, "");
		if (!this.bookToSeriesMap.has(normBook)) {
			const series = await this.getNovelSeries(normBook);
			this.bookToSeriesMap.set(normBook, series);
		}

		if (!this.fileContributions.has(bookPath!)) {
			this.fileContributions.set(bookPath!, new Map());
		}
		this.fileContributions.get(bookPath!)!.set(file.path, entries);
		this.fileToBookMap.set(file.path, bookPath!);

		this.aggregateBookCache(bookPath!);
		this.cacheVersion++;
		this.notifyCacheUpdated();
		return true;
	}

	/**
	 * 从缓存中移除指定路径设定文件的全部贡献条目
	 */
	public removeFileFromCache(filePath: string): boolean {
		const bookPath = this.fileToBookMap.get(filePath);
		if (!bookPath) {
			// 兜底：如果 fileToBookMap 未命中，遍历所有作品查找
			for (const [bp, bookFiles] of this.fileContributions.entries()) {
				if (bookFiles.has(filePath)) {
					bookFiles.delete(filePath);
					if (bookFiles.size === 0) {
						this.fileContributions.delete(bp);
					}
					this.aggregateBookCache(bp);
					this.cacheVersion++;
					this.notifyCacheUpdated();
					return true;
				}
			}
			return false;
		}

		const bookFiles = this.fileContributions.get(bookPath);
		if (bookFiles && bookFiles.has(filePath)) {
			bookFiles.delete(filePath);
			if (bookFiles.size === 0) {
				this.fileContributions.delete(bookPath);
			}
			this.fileToBookMap.delete(filePath);
			this.aggregateBookCache(bookPath);
			this.cacheVersion++;
			this.notifyCacheUpdated();
			return true;
		}

		return false;
	}

	/**
	 * 处理文件重命名/移动事件
	 */
	public async handleFileRename(file: TAbstractFile, oldPath: string): Promise<boolean> {
		if (file instanceof TFile) {
			let oldRemoved = false;

			// 1. 清理旧路径的贡献
			const oldBookPath = this.fileToBookMap.get(oldPath);
			if (oldBookPath) {
				const oldBookFiles = this.fileContributions.get(oldBookPath);
				if (oldBookFiles && oldBookFiles.has(oldPath)) {
					oldBookFiles.delete(oldPath);
					if (oldBookFiles.size === 0) {
						this.fileContributions.delete(oldBookPath);
					}
					this.fileToBookMap.delete(oldPath);
					this.aggregateBookCache(oldBookPath);
					oldRemoved = true;
				}
			}

			// 2. 如果新路径是有效设定文件，解析并添加新贡献
			let newAdded = false;
			let parseError: Error | null = null;

			if (file.extension === 'md') {
				const parentPath = file.parent?.path || '';
				const newBookPath = this.getBookPathForFile(file);
				if (newBookPath && this.isLorePath(newBookPath, parentPath)) {
					try {
						const entries = await this.parseLoreFile(file);
						if (!this.fileContributions.has(newBookPath)) {
							this.fileContributions.set(newBookPath, new Map());
						}
						this.fileContributions.get(newBookPath)!.set(file.path, entries);
						this.fileToBookMap.set(file.path, newBookPath);
						this.aggregateBookCache(newBookPath);
						newAdded = true;
					} catch (err) {
						parseError = err instanceof Error ? err : new Error(String(err));
					}
				}
			}

			if (oldRemoved || newAdded) {
				this.cacheVersion++;
				this.notifyCacheUpdated();
			}

			if (parseError) {
				throw parseError;
			}

			return oldRemoved || newAdded;
		} else if (file instanceof TFolder) {
			// 文件夹重命名可能影响其内部全部设定文件，安全回退到防抖全量重构
			this.triggerDebouncedRebuild();
			return true;
		}
		return false;
	}

	/**
	 * 处理文件删除事件
	 */
	public handleFileDelete(file: TAbstractFile): boolean {
		if (file instanceof TFile) {
			return this.removeFileFromCache(file.path);
		} else if (file instanceof TFolder) {
			// 文件夹删除可能影响其内部全部设定文件，安全回退到防抖全量重构
			this.triggerDebouncedRebuild();
			return true;
		}
		return false;
	}

	/**
	 * 触发防抖全量重构（用于文件夹重命名/删除等 Obsidian 语义无法精准窄化的场景）
	 */
	public triggerDebouncedRebuild(): void {
		const runRebuild = () => {
			void (async () => {
				try {
					await this.rebuildCache();
					this.app.workspace.updateOptions();
				} catch (e) {
					console.error('[CharacterManager] 文件夹变更重构设定缓存失败:', e);
				}
			})();
		};

		if (this.plugin.adaptiveDebounceManager) {
			this.plugin.adaptiveDebounceManager.debounceFixed('rebuild-character-cache', runRebuild, 500);
		} else {
			runRebuild();
		}
	}

	/**
	 * 检查路径是否在设定文件夹内（支持多语言文件夹名）
	 */
	public getLoreCandidates(): Set<string> {
		return getCandidateNames(this.plugin.settings.loreFolderName, 'loreFolderName');
	}

	/**
	 * 检查路径是否在设定文件夹或其任意嵌套子文件夹内（支持多语言文件夹名）
	 */
	public isLorePath(bookPath: string, parentPath: string): boolean {
		return isCandidateSubpath(bookPath, parentPath, this.getLoreCandidates());
	}

	/**
	 * 获取同系列公共设定子文件夹的所有候选名称集合（包含用户配置名称与多语言默认/历史名称）
	 */
	public getSeriesLoreCandidates(): Set<string> {
		const configured = this.plugin.settings.seriesLoreFolderName?.trim();
		const defaultName = getDefaultFileName("seriesLoreFolderName");
		const defaultCandidates = getDefaultFileNameCandidates("seriesLoreFolderName");

		const candidates = new Set<string>();
		if (configured) {
			candidates.add(configured);
			// 仅当用户配置名称属于默认多语言名称之一时，才回退多语言 legacy 候选；
			// 一旦用户显式修改为自定义名称，不应再意外将无关的旧“系列”子目录永久当做系列设定暴露
			if (defaultCandidates.includes(configured)) {
				for (const cand of defaultCandidates) {
					if (cand) candidates.add(cand);
				}
			}
		} else {
			candidates.add(defaultName);
			for (const cand of defaultCandidates) {
				if (cand) candidates.add(cand);
			}
		}
		for (const cand of this.unmigratedSeriesLoreCandidates) {
			if (cand) candidates.add(cand);
		}

		return candidates;
	}

	/**
	 * 检查路径是否在指定作品的公共系列设定子文件夹（或其任意嵌套子文件夹）内
	 */
	public isSeriesLorePath(bookPath: string, parentPath: string): boolean {
		const normBook = (bookPath === "/" || bookPath === "") ? "" : bookPath.replace(/^\/+|\/+$/g, "");
		const normParent = parentPath.replace(/^\/+|\/+$/g, "");
		const loreCandidates = this.getLoreCandidates();
		const seriesCandidates = this.getSeriesLoreCandidates();

		for (const loreName of loreCandidates) {
			if (!loreName) continue;
			for (const seriesName of seriesCandidates) {
			if (!seriesName) continue;
				const expectedRoot = normBook
					? `${normBook}/${loreName}/${seriesName}`
					: `${loreName}/${seriesName}`;
				if (normParent === expectedRoot || normParent.startsWith(`${expectedRoot}/`)) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * 检查一个文件是否属于公共系列设定文件
	 */
	public isSeriesLoreFile(file: TFile): boolean {
		if (file.extension !== "md") return false;
		const parentPath = file.parent?.path || "";
		const bookPath = this.getBookPathForFile(file);
		if (!bookPath) return false;
		return this.isSeriesLorePath(bookPath, parentPath);
	}

	/**
	 * 查找并返回指定作品路径下的所有公共系列设定子文件夹（按优先级顺序返回）
	 */
	public findSeriesLoreFolders(bookPath: string): TFolder[] {
		const loreCandidates = this.getLoreCandidates();
		const seriesCandidates = this.getSeriesLoreCandidates();
		const norm = (!bookPath || bookPath === "/") ? "" : bookPath.replace(/^\/+|\/+$/g, "");
		const results: TFolder[] = [];
		const seenPaths = new Set<string>();

		for (const loreName of loreCandidates) {
			for (const seriesName of seriesCandidates) {
				const seriesPath = norm ? `${norm}/${loreName}/${seriesName}` : `${loreName}/${seriesName}`;
				const folder = this.app.vault.getAbstractFileByPath(seriesPath);
				if (folder instanceof TFolder && !seenPaths.has(folder.path)) {
					seenPaths.add(folder.path);
					results.push(folder);
				}
			}
		}
		return results;
	}

	/**
	 * 查找并返回指定作品路径下的公共系列设定子文件夹（首选匹配，支持多语言候选文件夹名）
	 */
	public findSeriesLoreFolder(bookPath: string): TFolder | null {
		const folders = this.findSeriesLoreFolders(bookPath);
		return folders.length > 0 ? folders[0] : null;
	}

	/**
	 * 获取指定作品所属的系列名称（若未设置或未收录则返回空字符串）
	 */
	public async getNovelSeries(bookPath: string): Promise<string> {
		const norm = (!bookPath || bookPath === "/") ? "" : bookPath.replace(/^\/+|\/+$/g, "");
		if (this.plugin.homepageManager) {
			try {
				const meta = await this.plugin.homepageManager.getNovelMetadata(norm);
				if (meta?.series && typeof meta.series === "string") {
					return meta.series.trim();
				}
			} catch {
				// ignore
			}
		}
		return "";
	}

	/**
	 * 获取当前作品可供录入设定的所有分类选项列表
	 * 包含当前作品的本地全部设定分类，以及同系列成员作品的公共系列设定分类
	 * 当遇到重名时，为选项添加来源作品身份标注
	 */
	public async getAvailableLoreCategories(bookPath: string): Promise<LoreCategoryOption[]> {
		const options: LoreCategoryOption[] = [];
		const normCurrentBook = (!bookPath || bookPath === "/") ? "" : bookPath.replace(/^\/+|\/+$/g, "");
		const currentBookName = normCurrentBook ? (normCurrentBook.split("/").pop() || normCurrentBook) : "";

		// 1. 本地分类（包括私有与本地公共）
		const localLoreFolder = this.findLoreFolder(bookPath);
		if (localLoreFolder) {
			const collectLocal = (folder: TFolder, prefix: string = "") => {
				const children = [...folder.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
				for (const child of children) {
					if (child instanceof TFile && child.extension === "md") {
						const rel = prefix ? `${prefix}/${child.basename}` : child.basename;
						options.push({
							id: child.path,
							displayName: rel,
							baseName: rel,
							file: child,
							isBorrowed: false,
						sourceBookPath: normCurrentBook || "/",
						sourceBookName: currentBookName,
							relPath: rel
						});
					} else if (child instanceof TFolder) {
						const nextPrefix = prefix ? `${prefix}/${child.name}` : child.name;
						collectLocal(child, nextPrefix);
					}
				}
			};
			collectLocal(localLoreFolder);
		}

		// 2. 同系列成员作品的公共系列分类
		const currentSeries = await this.getNovelSeries(bookPath);
		if (currentSeries) {
			const candidateSiblings = new Set<string>();
			if (this.plugin.homepageManager) {
				try {
					const folders = this.plugin.homepageManager.getNovelFolders();
					for (const f of folders) {
						const normF = (!f.folderPath || f.folderPath === "/") ? "/" : f.folderPath.replace(/^\/+|\/+$/g, "");
						if (normF !== (normCurrentBook || "/")) {
							candidateSiblings.add(normF);
						}
					}
				} catch {
					// ignore
				}
			}
			for (const b of this.bookToSeriesMap.keys()) {
				const normB = (!b || b === "/") ? "/" : b.replace(/^\/+|\/+$/g, "");
				if (normB !== (normCurrentBook || "/")) {
					candidateSiblings.add(normB);
				}
			}

			const verifiedSiblings: string[] = [];
			for (const siblingBook of candidateSiblings) {
				const freshSeries = await this.getNovelSeries(siblingBook);
				if (freshSeries === currentSeries) {
					verifiedSiblings.push(siblingBook);
				}
			}

			const sortedSiblings = verifiedSiblings.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

			for (const siblingBook of sortedSiblings) {
				const siblingSeriesFolders = this.findSeriesLoreFolders(siblingBook);
				if (siblingSeriesFolders.length === 0) continue;

				const normSibling = siblingBook === "/" ? "" : siblingBook.replace(/^\/+|\/+$/g, "");
				const siblingBookName = normSibling ? (normSibling.split("/").pop() || normSibling) : "";
				const siblingLoreFolder = this.findLoreFolder(siblingBook);
				const siblingLorePath = siblingLoreFolder ? siblingLoreFolder.path : "";

				const collectSiblingSeries = (folder: TFolder) => {
					const children = [...folder.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
					for (const child of children) {
						if (child instanceof TFile && child.extension === "md") {
							let rel = "";
							if (siblingLorePath && child.path.startsWith(`${siblingLorePath}/`)) {
								rel = child.path.slice(siblingLorePath.length + 1).replace(/\.md$/i, "");
							} else {
								const primarySeriesName = this.plugin.settings.seriesLoreFolderName || getDefaultFileName("seriesLoreFolderName");
								rel = `${primarySeriesName}/${child.basename}`;
							}

							options.push({
								id: child.path,
								displayName: rel,
								baseName: rel,
								file: child,
								isBorrowed: true,
								sourceBookPath: siblingBook,
								sourceBookName: siblingBookName,
								relPath: rel
							});
						} else if (child instanceof TFolder) {
							collectSiblingSeries(child);
						}
					}
				};
				for (const folder of siblingSeriesFolders) {
					collectSiblingSeries(folder);
				}
			}
		}

		// 3. 处理重名分类的显示标识（source identity / path when duplicate names）
		const relCount = new Map<string, number>();
		for (const opt of options) {
			relCount.set(opt.relPath, (relCount.get(opt.relPath) || 0) + 1);
		}

		for (const opt of options) {
			if ((relCount.get(opt.relPath) || 0) > 1) {
				opt.displayName = `${opt.relPath} (${opt.sourceBookName || opt.sourceBookPath})`;
			} else if (opt.isBorrowed) {
				opt.displayName = `${opt.relPath} (${opt.sourceBookName || opt.sourceBookPath})`;
			}
		}

		return options;
	}

	/**
	 * 在保存新设定前严格校验目标路径的合法性
	 * 确保写入目标必须位于当前作品的设定文件夹内，或者当前作品所属系列的某一公共系列设定文件夹内
	 * 严防跨作品私有设定写入、跨系列写入或目录遍历越界
	 */
	public async validateLoreSaveDestination(
		bookPath: string,
		targetFilePath: string
	): Promise<{ valid: boolean; reason?: string }> {
		if (!targetFilePath || typeof targetFilePath !== "string") {
			return { valid: false, reason: "Target path is empty" };
		}

		const normalized = normalizePath(targetFilePath).replace(/^\/+|\/+$/g, "");
		if (!normalized.endsWith(".md")) {
			return { valid: false, reason: "Target file must be a Markdown file" };
		}

		const parentPath = normalized.substring(0, normalized.lastIndexOf("/"));
		const normCurrentBook = (!bookPath || bookPath === "/") ? "" : bookPath.replace(/^\/+|\/+$/g, "");

		// 1. 若目标属于当前作品，只需位于当前作品的设定文件夹下（包含私有与公共）
		if (this.isLorePath(normCurrentBook || "/", parentPath)) {
			return { valid: true };
		}

		// 2. 若目标不属于当前作品，则当前作品必须属于某一已知系列
		const currentSeries = await this.getNovelSeries(bookPath);
		if (!currentSeries) {
			return { valid: false, reason: "Current book does not belong to any series" };
		}

		// 反查目标文件所属作品
		const targetAbstract = this.app.vault.getAbstractFileByPath(normalized);
		let targetBook: string | null = null;
		if (targetAbstract instanceof TFile) {
			targetBook = this.getBookPathForFile(targetAbstract);
		} else {
			const allKnownBooks = new Set<string>();
			for (const b of this.bookToSeriesMap.keys()) allKnownBooks.add(b);
			for (const b of this.fileContributions.keys()) allKnownBooks.add(b);
			for (const b of allKnownBooks) {
				const nb = b === "/" ? "" : b;
				if (nb && (normalized === nb || normalized.startsWith(`${nb}/`))) {
					if (!targetBook || nb.length > targetBook.length) {
						targetBook = nb;
					}
				}
			}
		}

		if (!targetBook) {
			return { valid: false, reason: "Could not determine novel book for target file" };
		}

		// 目标作品必须属于同一个系列
		const targetSeries = await this.getNovelSeries(targetBook);
		if (!targetSeries || targetSeries !== currentSeries) {
			return { valid: false, reason: "Target novel does not belong to the same series" };
		}

		// 目标文件必须严格位于该同系列作品的公共系列设定文件夹内（绝不允许写入私有设定！）
		if (!this.isSeriesLorePath(targetBook, parentPath)) {
			return { valid: false, reason: "Target file is not in a public series lore folder" };
		}

		return { valid: true };
	}

	public handleFileChange(file: TAbstractFile, eventType: 'create' | 'modify' | 'delete' | 'rename' = 'modify', oldPath?: string): void {
		if (file instanceof TFile) {
			if (eventType === 'delete') {
				this.handleFileDelete(file);
				return;
			}
			if (eventType === 'rename' && oldPath) {
				const runRename = () => {
					void (async () => {
						try {
							await this.handleFileRename(file, oldPath);
						} catch (e) {
							console.error(`[CharacterManager] 重命名处理设定文件 ${file.path} 失败:`, e);
						}
					})();
				};
				if (this.plugin.adaptiveDebounceManager) {
					this.plugin.adaptiveDebounceManager.debounceFixed(`lore-rename-${file.path}`, runRename, 300);
				} else {
					runRename();
				}
				return;
			}

			// create 或 modify
			if (file.extension !== 'md') return;

			const parentPath = file.parent?.path || '';
			const candidates = this.getLoreCandidates();
			let hasCandidate = false;
			for (const candidate of candidates) {
				if (parentPath.includes(candidate)) {
					hasCandidate = true;
					break;
				}
			}
			// 如果路径中既没有 candidate，此前也未曾被收录为设定文件，则直接跳过
			if (!hasCandidate && !this.fileToBookMap.has(file.path)) {
				return;
			}

			const runUpdate = () => {
				void (async () => {
					try {
						await this.updateFileCache(file);
					} catch (e) {
						console.error(`[CharacterManager] 增量更新设定文件 ${file.path} 失败:`, e);
					}
				})();
			};

			if (this.plugin.adaptiveDebounceManager) {
				this.plugin.adaptiveDebounceManager.debounceFixed(`lore-update-${file.path}`, runUpdate, 300);
			} else {
				runUpdate();
			}
		} else if (file instanceof TFolder) {
			// [BUGFIX] 新建文件夹时不要无脑重构缓存并触发全局 updateOptions()
			// 因为 updateOptions() 会强制文件树重新 sort，从而打断用户的重命名操作！
			if (eventType === 'create') return;

			this.triggerDebouncedRebuild();
		}
	}

	private getBookCache(bookPath: string): Map<string, LoreEntry> | undefined {
		const norm = (!bookPath || bookPath === '/') ? '/' : bookPath.replace(/^\/+|\/+$/g, '');
		return norm === '/'
			? this.characterCache.get('/') ?? this.characterCache.get('')
			: this.characterCache.get(norm);
	}

	private getLowerMap(bookPath: string): Map<string, string> | undefined {
		const norm = (!bookPath || bookPath === '/') ? '/' : bookPath.replace(/^\/+|\/+$/g, '');
		return norm === '/'
			? this.lowercaseKeyMap.get('/') ?? this.lowercaseKeyMap.get('')
			: this.lowercaseKeyMap.get(norm);
	}

	public getCharactersForBook(bookPath: string): string[] {
		const bookCache = this.getBookCache(bookPath);
		if (!bookCache) return [];
		// 按照长度降序排序，避免 "张三" 和 "张三丰" 匹配时被 "张三" 抢占
		return Array.from(bookCache.keys()).sort((a, b) => b.length - a.length);
	}

	/**
	 * 获取指定作品（bookPath）下的所有设定条目，保持严格的文件写入顺序（因为 Map 按照插入顺序迭代，而我们在初始化时是按文件自上而下插入的）
	 */
	public getLoreEntriesInFileOrder(bookPath: string): LoreEntry[] {
		const norm = (!bookPath || bookPath === "/") ? "/" : bookPath.replace(/^\/+|\/+$/g, "");
		const cached = this.fileOrderCache.get(norm) ?? (norm === "/" ? this.fileOrderCache.get("") : undefined);
		if (cached) {
			return [...cached];
		}

		const bookCache = this.getBookCache(bookPath);
		if (!bookCache) return [];
		
		const entries: LoreEntry[] = [];
		const seen = new Set<string>();
		
		for (const entry of bookCache.values()) {
			if (!seen.has(entry.heading)) {
				seen.add(entry.heading);
				entries.push(entry);
			}
		}
		
		return entries;
	}

	/**
	 * 获取指定作品下，指定设定名对应的缓存条目
	 */
	public getCharacterFile(bookPath: string, characterName: string): LoreEntry | null {
		const bookCache = this.getBookCache(bookPath);
		if (!bookCache) return null;
		
		const entry = bookCache.get(characterName);
		if (entry) return entry;
		
		// Fallback: 忽略大小写查找 (O(1))
		const lowerMap = this.getLowerMap(bookPath);
		if (lowerMap) {
			const originalKey = lowerMap.get(characterName.toLowerCase());
			if (originalKey) {
				return bookCache.get(originalKey) || null;
			}
		}
		
		return null;
	}

	public async moveLoreItem(fromEntry: LoreEntry, toEntry: LoreEntry, insertAfter: boolean): Promise<boolean> {
		if (fromEntry.file.path !== toEntry.file.path) {
			new Notice(t('character.cross-file-sort-not-supported'));
			return false;
		}

		const file = fromEntry.file;
		const fileCache = this.app.metadataCache.getFileCache(file);
		if (!fileCache || !fileCache.headings) return false;

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');

		// 找到两个 heading 的 startLine 和 endLine
		const getBlock = (headingText: string) => {
			for (let i = 0; i < fileCache.headings!.length; i++) {
				const h = fileCache.headings![i];
				if (h.level === 2 && cleanLoreHeading(h.heading) === cleanLoreHeading(headingText)) {
					const startLine = h.position.start.line;
					
					let nextLevelH = null;
					for (let j = i + 1; j < fileCache.headings!.length; j++) {
						if (fileCache.headings![j].level <= h.level) {
							nextLevelH = fileCache.headings![j];
							break;
						}
					}
					
					const endLine = nextLevelH ? nextLevelH.position.start.line - 1 : lines.length - 1;
					return { startLine, endLine };
				}
			}
			return null;
		};

		const fromBlock = getBlock(fromEntry.heading);
		const toBlock = getBlock(toEntry.heading);

		if (!fromBlock || !toBlock) return false;

		// 提取 fromBlock 的文本
		const fromLines = lines.slice(fromBlock.startLine, fromBlock.endLine + 1);
		
		// 移除 fromBlock
		lines.splice(fromBlock.startLine, fromBlock.endLine - fromBlock.startLine + 1);

		// 因为 lines 变了，我们需要重新计算 toBlock 的位置
		let targetLine = toBlock.startLine;
		if (fromBlock.startLine < toBlock.startLine) {
			targetLine -= (fromBlock.endLine - fromBlock.startLine + 1);
		}

		if (insertAfter) {
			targetLine += (toBlock.endLine - toBlock.startLine + 1);
		}

		// 插入 fromLines
		lines.splice(targetLine, 0, ...fromLines);

		await this.app.vault.modify(file, lines.join('\n'));
		return true;
	}

	public async getLoreContent(entry: LoreEntry): Promise<string> {
		const fileCache = this.app.metadataCache.getFileCache(entry.file);
		const content = await this.app.vault.cachedRead(entry.file);
		const lines = content.split('\n');
		
		if (fileCache && fileCache.headings) {
			for (let i = 0; i < fileCache.headings.length; i++) {
				const h = fileCache.headings[i];
				if (h.level === 2 && cleanLoreHeading(h.heading) === cleanLoreHeading(entry.heading)) {
					const startLine = h.position.start.line;
					let nextLevelH = null;
					for (let j = i + 1; j < fileCache.headings.length; j++) {
						if (fileCache.headings[j].level <= h.level) {
							nextLevelH = fileCache.headings[j];
							break;
						}
					}
					const endLine = nextLevelH ? nextLevelH.position.start.line - 1 : lines.length - 1;

					// Exclude the heading line itself, return the body
					const bodyLines = lines.slice(startLine + 1, endLine + 1);
					return bodyLines.join('\n').replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
				}
			}
		}

		// 单文件词条模式回退（词条名为文件名 basename 且无匹配 H2）
		if (cleanLoreHeading(entry.heading) === cleanLoreHeading(entry.file.basename)) {
			let body = content;
			// 移除 Frontmatter
			if (body.startsWith('---\n') || body.startsWith('---\r\n')) {
				const endMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
				if (endMatch) {
					body = body.slice(endMatch[0].length);
				}
			}
			// 移除顶部的 # 一级标题（如果存在）
			body = body.replace(/^\s*#\s+[^\n]*\r?\n/, '');
			return body.replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
		}

		return '';
	}

	public async updateLoreContent(entry: LoreEntry, newContent: string): Promise<boolean> {
		const file = entry.file;
		const fileCache = this.app.metadataCache.getFileCache(file);

		let updated = false;
		await this.app.vault.process(file, (data) => {
			const lines = data.split('\n');
			if (fileCache && fileCache.headings) {
				for (let i = 0; i < fileCache.headings.length; i++) {
					const h = fileCache.headings[i];
					if (h.level === 2 && cleanLoreHeading(h.heading) === cleanLoreHeading(entry.heading)) {
						const startLine = h.position.start.line;
						let nextLevelH = null;
						for (let j = i + 1; j < fileCache.headings.length; j++) {
							if (fileCache.headings[j].level <= h.level) {
								nextLevelH = fileCache.headings[j];
								break;
							}
						}
						const endLine = nextLevelH ? nextLevelH.position.start.line - 1 : lines.length - 1;

						const oldBody = lines.slice(startLine + 1, endLine + 1).join('\n');
						const isImportant = entry.important ?? /<!--\s*wn-important\s*-->/.test(oldBody);

						const cleanNew = newContent.replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
						const finalChunk = isImportant ? (cleanNew ? `<!-- wn-important -->\n${cleanNew}` : '<!-- wn-important -->') : cleanNew;
						const newLines = finalChunk ? finalChunk.split('\n') : [];
						// Replace the lines after the heading up to endLine
						lines.splice(startLine + 1, endLine - startLine, ...newLines);
						updated = true;
						return lines.join('\n');
					}
				}
			}

			// 单文件词条模式回退
			if (cleanLoreHeading(entry.heading) === cleanLoreHeading(file.basename)) {
				let prefix = '';
				let rest = data;
				// 保留 Frontmatter
				if (rest.startsWith('---\n') || rest.startsWith('---\r\n')) {
					const endMatch = rest.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
					if (endMatch) {
						prefix += endMatch[0];
						rest = rest.slice(endMatch[0].length);
					}
				}
				// 保留顶部的 # 一级标题（如果存在）
				const h1Match = rest.match(/^\s*#\s+[^\n]*\r?\n/);
				if (h1Match) {
					prefix += h1Match[0];
					rest = rest.slice(h1Match[0].length);
				}
				const isImportant = entry.important ?? /<!--\s*wn-important\s*-->/.test(rest);
				const cleanNew = newContent.replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
				const finalContent = isImportant ? (cleanNew ? `<!-- wn-important -->\n${cleanNew}` : '<!-- wn-important -->') : cleanNew;
				updated = true;
				return (prefix ? prefix + (prefix.endsWith('\n') ? '' : '\n') : '') + finalContent + '\n';
			}

			return data;
		});
		return updated;
	}

	/**
	 * 切换设定词条的重要标记状态
	 */
	public async toggleLoreImportance(entry: LoreEntry): Promise<boolean> {
		const file = entry.file;
		const fileCache = this.app.metadataCache.getFileCache(file);
		let nextState = !entry.important;

		await this.app.vault.process(file, (data) => {
			const lines = data.split('\n');
			if (fileCache && fileCache.headings) {
				for (let i = 0; i < fileCache.headings.length; i++) {
					const h = fileCache.headings[i];
					if (h.level === 2 && cleanLoreHeading(h.heading) === cleanLoreHeading(entry.heading)) {
						const startLine = h.position.start.line;
						let nextLevelH = null;
						for (let j = i + 1; j < fileCache.headings.length; j++) {
							if (fileCache.headings[j].level <= h.level) {
								nextLevelH = fileCache.headings[j];
								break;
							}
						}
						const endLine = nextLevelH ? nextLevelH.position.start.line - 1 : lines.length - 1;
						const bodyLines = lines.slice(startLine + 1, endLine + 1);
						const bodyText = bodyLines.join('\n');
						const hasMarker = /<!--\s*wn-important\s*-->/.test(bodyText);
						nextState = !hasMarker;

						const cleanBody = bodyText.replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
						let finalChunk = '';
						if (nextState) {
							finalChunk = cleanBody ? `<!-- wn-important -->\n${cleanBody}` : '<!-- wn-important -->';
						} else {
							finalChunk = cleanBody;
						}
						const newLines = finalChunk ? finalChunk.split('\n') : [];
						lines.splice(startLine + 1, endLine - startLine, ...newLines);
						return lines.join('\n');
					}
				}
			}

			// 单文件词条模式回退
			if (cleanLoreHeading(entry.heading) === cleanLoreHeading(file.basename)) {
				const hasMarker = /<!--\s*wn-important\s*-->/.test(data);
				nextState = !hasMarker;

				let prefix = '';
				let rest = data;
				if (rest.startsWith('---\n') || rest.startsWith('---\r\n')) {
					const endMatch = rest.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
					if (endMatch) {
						prefix += endMatch[0];
						rest = rest.slice(endMatch[0].length);
					}
				}
				const h1Match = rest.match(/^\s*#\s+[^\n]*\r?\n/);
				if (h1Match) {
					prefix += h1Match[0];
					rest = rest.slice(h1Match[0].length);
				}

				const cleanRest = rest.replace(/<!--\s*wn-important\s*-->\r?\n?/g, '').trim();
				let finalContent = '';
				if (nextState) {
					finalContent = cleanRest ? `<!-- wn-important -->\n${cleanRest}` : '<!-- wn-important -->';
				} else {
					finalContent = cleanRest;
				}
				return (prefix ? prefix + (prefix.endsWith('\n') ? '' : '\n') : '') + finalContent + '\n';
			}

			return data;
		});

		entry.important = nextState;
		this.cacheVersion++;
		this.notifyCacheUpdated();
		return nextState;
	}

	/**
	 * 给定一个任意文件（通常是当前正在编辑的文件），返回它所属的作品目录路径
	 * （底层直接调用全局的 findBookRoot 算法支持跨卷）
	 */
	public getBookPathForFile(file: TFile | null): string | null {
		if (!file) return null;
		
		const root = findBookRoot(this.app, this.plugin, file);
		return root === '' ? '/' : root;
	}

	/**
	 * 解析单个设定文件中的标题与别名（支持多词条大纲模式与单文件词条模式）
	 */
	private async parseLoreFile(file: TFile): Promise<Array<{ key: string; entry: LoreEntry }>> {
		const results: Array<{ key: string; entry: LoreEntry }> = [];
		const addEntry = (key: string, entry: LoreEntry) => {
			const cleanedKey = cleanLoreHeading(key);
			if (cleanedKey) {
				results.push({ key: cleanedKey, entry });
			}
		};

		const fileCache = this.app.metadataCache.getFileCache(file);
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');

		let headings: { level: number, heading: string, position: { start: { line: number }, end: { line: number } } }[] = [];
		if (fileCache && fileCache.headings) {
			headings = fileCache.headings;
		} else {
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(/^##\s+(.+)$/);
				if (match) {
					headings.push({
						level: 2,
						heading: match[1],
						position: { start: { line: i }, end: { line: i } }
					});
				}
			}
		}

		const level2Headings = headings.filter(h => h.level === 2);

		if (level2Headings.length > 0) {
			for (let i = 0; i < headings.length; i++) {
				const heading = headings[i];
				if (heading.level !== 2) continue;

				const rawHeading = heading.heading;
				if (!rawHeading) continue;

				const headingText = cleanLoreHeading(rawHeading);
				if (!headingText) continue;

				const startLine = heading.position.end.line + 1;
				const nextHeading = headings[i + 1];
				const endLine = nextHeading ? nextHeading.position.start.line : lines.length;

				const chunk = lines.slice(startLine, endLine).join('\n');
				const important = /<!--\s*wn-important\s*-->/.test(chunk) ? true : undefined;
				const entry: LoreEntry = { file, heading: headingText, important };
				addEntry(headingText, entry);

				const aliasMatch = chunk.match(/(?:\*\*|__)?(?:别名|別名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/);
				if (aliasMatch && aliasMatch[1]) {
					const rawAliases = aliasMatch[1].split(/[,，、/|;；]/);
					for (const a of rawAliases) {
						addEntry(a, entry);
					}
				}
			}
		} else {
			const fileEntryName = cleanLoreHeading(file.basename);
			if (fileEntryName) {
				const important = /<!--\s*wn-important\s*-->/.test(content) ? true : undefined;
				const entry: LoreEntry = { file, heading: fileEntryName, important };
				addEntry(fileEntryName, entry);

				const fm = fileCache?.frontmatter;
				if (fm) {
					const rawAliases = (fm['aliases'] ?? fm['alias'] ?? fm['别名'] ?? fm['別名']) as unknown;
					if (Array.isArray(rawAliases)) {
						for (const a of rawAliases) {
							if (typeof a === 'string' || typeof a === 'number') {
								addEntry(String(a), entry);
							}
						}
					} else if (typeof rawAliases === 'string' && rawAliases.trim()) {
						const splitAliases = rawAliases.split(/[,，、/|;；]/);
						for (const a of splitAliases) {
							addEntry(a, entry);
						}
					}
				}

				const aliasMatches = content.matchAll(/(?:\*\*|__)?(?:别名|別名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/gi);
				for (const match of aliasMatches) {
					if (match[1]) {
						const rawAliases = match[1].split(/[,，、/|;；]/);
						for (const a of rawAliases) {
							addEntry(a, entry);
						}
					}
				}
			}
		}

		return results;
	}

	/**
	 * 检查一个文件是否是设定文件，并加入缓存（支持多词条大纲模式与单文件词条模式）
	 */
	private async addFileToCacheIfValidInto(
		file: TFile, 
		targetCache: Map<string, Map<string, LoreEntry>>,
		targetLowerMap: Map<string, Map<string, string>>
	): Promise<void> {
		const parentPath = file.parent?.path || '';

		// Fast-Path 预判：若 parentPath 中不包含任何设定文件夹名候选词，立刻跳过后续递归路径计算
		const candidates = this.getLoreCandidates();
		let hasCandidate = false;
		for (const candidate of candidates) {
			if (parentPath.includes(candidate)) {
				hasCandidate = true;
				break;
			}
		}
		if (!hasCandidate) return;

		const bookPath = this.getBookPathForFile(file);
		if (!bookPath) return;

		if (this.isLorePath(bookPath, parentPath)) {
			if (!targetCache.has(bookPath)) {
				targetCache.set(bookPath, new Map());
				targetLowerMap.set(bookPath, new Map());
			}
			
			const bookCache = targetCache.get(bookPath)!;
			const lowerMap = targetLowerMap.get(bookPath)!;
			
			const entries = await this.parseLoreFile(file);
			for (const { key, entry } of entries) {
				const cleanedKey = cleanLoreHeading(key);
				if (cleanedKey) {
					bookCache.set(cleanedKey, entry);
					lowerMap.set(cleanedKey.toLowerCase(), cleanedKey);
				}
			}
		}
	}

	/**
	 * 递归获取书籍设定文件夹下的所有 Markdown 设定文件
	 */
	public getLoreFiles(bookPath: string): TFile[] {
		const loreFolder = this.findLoreFolder(bookPath);
		if (!loreFolder) return [];

		const results: TFile[] = [];
		const collect = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					results.push(child);
				} else if (child instanceof TFolder) {
					collect(child);
				}
			}
		};
		collect(loreFolder);
		return results;
	}

	/**
	 * 查找并返回书籍路径下的设定文件夹（支持多语言候选文件夹名）
	 */
	public findLoreFolder(bookPath: string): TFolder | null {
		const candidates = this.getLoreCandidates();
		const norm = (!bookPath || bookPath === '/') ? '' : bookPath.replace(/^\/+|\/+$/g, '');
		for (const loreFolderName of candidates) {
			const lorePath = norm ? `${norm}/${loreFolderName}` : loreFolderName;
			const folder = this.app.vault.getAbstractFileByPath(lorePath);
			if (folder instanceof TFolder) return folder;
		}
		return null;
	}

	/**
	 * 获取指定作品的全部有效设定文件列表（包含本地全部设定文件 + 同系列其他成员借用的公共系列设定文件）
	 */
	public getEffectiveLoreFiles(bookPath: string): TFile[] {
		const results: TFile[] = [];
		const seenPaths = new Set<string>();

		// 1. 本地设定文件（包含私有与本地公共）
		const localFiles = this.getLoreFiles(bookPath);
		for (const file of localFiles) {
			if (!seenPaths.has(file.path)) {
				seenPaths.add(file.path);
				results.push(file);
			}
		}

		// 2. 同系列成员的公共系列设定文件
		const normCurrentBook = (!bookPath || bookPath === '/') ? '/' : bookPath.replace(/^\/+|\/+$/g, '');
		const normLookup = normCurrentBook === '/' ? '' : normCurrentBook;
		const currentSeries = this.bookToSeriesMap.get(normCurrentBook) ?? this.bookToSeriesMap.get(normLookup) ?? '';

		if (currentSeries) {
			const siblings: string[] = [];
			for (const [b, s] of this.bookToSeriesMap.entries()) {
				const nb = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
				if (s === currentSeries && nb !== normCurrentBook) {
					if (!siblings.includes(nb)) {
						siblings.push(nb);
					}
				}
			}
			siblings.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

			for (const siblingBook of siblings) {
				const siblingSeriesFolders = this.findSeriesLoreFolders(siblingBook);
				if (siblingSeriesFolders.length === 0) continue;

				const collectFiles = (folder: TFolder) => {
					const children = [...folder.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
					for (const child of children) {
						if (child instanceof TFile && child.extension === 'md') {
							if (!seenPaths.has(child.path)) {
								seenPaths.add(child.path);
								results.push(child);
							}
						} else if (child instanceof TFolder) {
							collectFiles(child);
						}
					}
				};
				for (const folder of siblingSeriesFolders) {
					collectFiles(folder);
				}
			}
		}

		// 3. 补充缓存中已收录但物理目录扫描遗漏的文件（保证与 fileOrderCache 视图完全一致）
		for (const entry of this.getLoreEntriesInFileOrder(bookPath)) {
			if (entry.file && !seenPaths.has(entry.file.path)) {
				seenPaths.add(entry.file.path);
				results.push(entry.file);
			}
		}

		return results;
	}

	/**
	 * 安全递归合并源文件夹至目标文件夹路径
	 * - 遍历所有子文件与子文件夹
	 * - 遇到目标文件冲突：添加唯一后缀 (1), (2)...，绝不覆盖已有文件
	 * - 遇到同名子文件夹：递归深度合并其子项
	 * - 遇到文件与文件夹同名冲突：添加唯一后缀重命名，保留所有内容
	 * - 仅当源文件夹已被完全清空时才将其安全删除
	 * - 严格防范路径遍历，目标路径必须在合法设定文件夹内
	 *
	 * @param sourceFolder 源文件夹
	 * @param targetFolderPath 目标文件夹路径
	 * @returns 是否完全成功合并
	 */
	private async mergeFolderRecursive(sourceFolder: TFolder, targetFolderPath: string): Promise<boolean> {
		const normTarget = normalizePath(targetFolderPath);
		if (normTarget.split('/').includes('..')) {
			console.error(`[CharacterManager] 合并路径安全校验失败，检测到非法路径: ${normTarget}`);
			return false;
		}

		let targetFolder = this.app.vault.getAbstractFileByPath(normTarget);
		if (!targetFolder) {
			try {
				await this.ensureFolderRecursive(normTarget);
				targetFolder = this.app.vault.getAbstractFileByPath(normTarget);
			} catch (err) {
				console.error(`[CharacterManager] 创建目标文件夹失败: ${normTarget}`, err);
				return false;
			}
		}

		if (!(targetFolder instanceof TFolder)) {
			console.error(`[CharacterManager] 目标路径已存在且非文件夹: ${normTarget}`);
			return false;
		}

		let allSuccess = true;
		const children = [...sourceFolder.children];

		for (const child of children) {
			if (child.name.includes('/') || child.name.includes('\\') || child.name === '..' || child.name === '.') {
				allSuccess = false;
				continue;
			}

			const destPath = normalizePath(`${normTarget}/${child.name}`);
			if (!destPath.startsWith(normTarget + '/')) {
				console.error(`[CharacterManager] 路径遍历风险，跳过: ${destPath}`);
				allSuccess = false;
				continue;
			}

			const existing = this.app.vault.getAbstractFileByPath(destPath);

			if (child instanceof TFile) {
				if (!existing) {
					try {
						await this.app.fileManager.renameFile(child, destPath);
					} catch (err) {
						console.error(`[CharacterManager] 移动文件 ${child.path} 到 ${destPath} 失败:`, err);
						allSuccess = false;
					}
				} else {
					// 目标已存在同名文件或同名文件夹：生成非覆盖唯一文件名
					const ext = child.extension ? `.${child.extension}` : '';
					const base = child.basename || child.name.replace(/\.[^/.]+$/, '');
					let suffix = 1;
					let uniqueDestPath = normalizePath(`${normTarget}/${base} (${suffix})${ext}`);
					while (this.app.vault.getAbstractFileByPath(uniqueDestPath)) {
						suffix++;
						uniqueDestPath = normalizePath(`${normTarget}/${base} (${suffix})${ext}`);
					}
					try {
						await this.app.fileManager.renameFile(child, uniqueDestPath);
					} catch (err) {
						console.error(`[CharacterManager] 移动重名文件 ${child.path} 到 ${uniqueDestPath} 失败:`, err);
						allSuccess = false;
					}
				}
			} else if (child instanceof TFolder) {
				if (!existing) {
					try {
						await this.app.fileManager.renameFile(child, destPath);
					} catch (err) {
						console.error(`[CharacterManager] 移动子文件夹 ${child.path} 到 ${destPath} 失败:`, err);
						allSuccess = false;
					}
				} else if (existing instanceof TFolder) {
					const subSuccess = await this.mergeFolderRecursive(child, destPath);
					if (!subSuccess) {
						allSuccess = false;
					}
					if (child.children.length === 0) {
						try {
							await this.app.fileManager.trashFile(child);
						} catch (err) {
							console.error(`[CharacterManager] 清理已空子文件夹 ${child.path} 失败:`, err);
							allSuccess = false;
						}
					} else {
						allSuccess = false;
					}
				} else {
					// 目标子路径已存在但为文件（文件夹 vs 文件冲突）
					let suffix = 1;
					let uniqueFolderPath = normalizePath(`${normTarget}/${child.name} (${suffix})`);
					while (this.app.vault.getAbstractFileByPath(uniqueFolderPath)) {
						suffix++;
						uniqueFolderPath = normalizePath(`${normTarget}/${child.name} (${suffix})`);
					}
					try {
						await this.app.fileManager.renameFile(child, uniqueFolderPath);
					} catch (err) {
						console.error(`[CharacterManager] 移动冲突子文件夹 ${child.path} 到 ${uniqueFolderPath} 失败:`, err);
						allSuccess = false;
					}
				}
			}
		}

		return allSuccess;
	}

	/**
	 * 在所有已识别的作品中安全重命名公共系列设定子文件夹，防范命名冲突与数据丢失
	 * 如果旧文件夹不存在则不自动创建；如果新文件夹已存在，安全合并其内部文件而不覆盖已有同名文件
	 *
	 * @param oldName 旧子文件夹名
	 * @param newName 新子文件夹名
	 * @returns 重命名结果对象（包含重命名数、失败数、总数）
	 */
	public async renameAllSeriesLoreFolders(oldName: string, newName: string): Promise<SeriesLoreRenameResult> {
		const emptyResult: SeriesLoreRenameResult = { renamed: 0, failed: 0, total: 0 };
		if (!oldName || !newName || oldName === newName) return emptyResult;

		const cleanOld = oldName.trim();
		const cleanNew = newName.trim();
		if (!cleanOld || !cleanNew || cleanOld === cleanNew) return emptyResult;
		if (cleanNew.includes('..') || cleanNew.includes('/') || cleanNew.includes('\\')) {
			console.error(`[CharacterManager] 重命名目标名称非法: ${cleanNew}`);
			return emptyResult;
		}
		if (cleanOld.includes('..') || cleanOld.includes('/') || cleanOld.includes('\\')) {
			console.error(`[CharacterManager] 重命名源名称非法: ${cleanOld}`);
			return emptyResult;
		}

		const defaultCandidates = getDefaultFileNameCandidates('seriesLoreFolderName');
		const oldCandidates = new Set<string>();
		oldCandidates.add(cleanOld);
		if (defaultCandidates.includes(cleanOld)) {
			for (const cand of defaultCandidates) oldCandidates.add(cand);
		}

		// 收集所有已识别的作品路径
		const recognizedBooks = new Set<string>();
		if (this.plugin.homepageManager) {
			try {
				const folders = this.plugin.homepageManager.getNovelFolders();
				for (const f of folders) {
					const norm = (!f.folderPath || f.folderPath === '/') ? '/' : f.folderPath.replace(/^\/+|\/+$/g, '');
					if (norm) recognizedBooks.add(norm);
				}
			} catch {
				// ignore
			}
		}
		if (this.plugin.settings.workspaceFolders && this.plugin.settings.workspaceFolders.length > 0) {
			for (const wf of this.plugin.settings.workspaceFolders) {
				const normWf = wf.replace(/^\/+|\/+$/g, '');
				const folder = this.app.vault.getAbstractFileByPath(normWf);
				if (folder instanceof TFolder) {
					for (const child of folder.children) {
						if (child instanceof TFolder && !child.name.startsWith('.') && !child.name.startsWith('_')) {
							recognizedBooks.add(child.path);
						}
					}
				}
			}
		}
		for (const b of this.bookToSeriesMap.keys()) {
			const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
			if (norm) recognizedBooks.add(norm);
		}
		for (const b of this.fileContributions.keys()) {
			const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
			if (norm) recognizedBooks.add(norm);
		}
		if (recognizedBooks.size === 0) {
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				if (child instanceof TFolder && !child.name.startsWith('.') && !child.name.startsWith('_')) {
					recognizedBooks.add(child.path);
				}
			}
		}

		let totalCount = 0;
		let renamedCount = 0;
		let failedCount = 0;
		const unmigratedFound = new Set<string>();

		for (const bookPath of recognizedBooks) {
			const loreFolder = this.findLoreFolder(bookPath);
			if (!loreFolder || !(loreFolder instanceof TFolder)) {
				// 旧设定文件夹不存在，不创建
				continue;
			}

			// 查找旧的公共系列子文件夹
			let oldFolder: TFolder | null = null;
			for (const cand of oldCandidates) {
				const targetSubPath = normalizePath(`${loreFolder.path}/${cand}`);
				const sub = this.app.vault.getAbstractFileByPath(targetSubPath);
				if (sub instanceof TFolder) {
					oldFolder = sub;
					break;
				}
			}

			if (!oldFolder) continue;
			if (oldFolder.name === cleanNew) continue;

			totalCount++;
			const newFolderPath = normalizePath(`${loreFolder.path}/${cleanNew}`);

			// 路径安全校验：必须在 loreFolder 之下且无 .. 逃逸
			if (!newFolderPath.startsWith(loreFolder.path + '/') || newFolderPath.split('/').includes('..')) {
				console.error(`[CharacterManager] 路径安全校验失败，禁止逃逸作品设定目录: ${newFolderPath}`);
				failedCount++;
				unmigratedFound.add(oldFolder.name);
				continue;
			}

			let workSuccess = false;
			try {
				const existingTarget = this.app.vault.getAbstractFileByPath(newFolderPath);

				if (!existingTarget) {
					// 目标路径不存在，直接安全重命名
					await this.app.fileManager.renameFile(oldFolder, newFolderPath);
					workSuccess = true;
				} else if (existingTarget instanceof TFolder) {
					// 目标文件夹已存在：递归合并旧文件夹内全部内容至目标文件夹
					const mergeSuccess = await this.mergeFolderRecursive(oldFolder, newFolderPath);
					if (oldFolder.children.length === 0) {
						try {
							await this.app.fileManager.trashFile(oldFolder);
						} catch (err) {
							console.error(`[CharacterManager] 删除已空旧文件夹 ${oldFolder.path} 失败:`, err);
						}
						workSuccess = mergeSuccess;
					} else {
						// 尚有子项未能移出，不能删除旧目录，保留可见性
						workSuccess = false;
					}
				} else {
					console.warn(`[CharacterManager] 目标路径 ${newFolderPath} 已存在且非文件夹，跳过以避免数据损坏`);
					workSuccess = false;
				}
			} catch (err) {
				console.error(`[CharacterManager] 重命名公共设定子文件夹 ${oldFolder.path} 失败:`, err);
				workSuccess = false;
			}

			if (workSuccess) {
				renamedCount++;
			} else {
				failedCount++;
				unmigratedFound.add(oldFolder.name);
			}
		}

		if (unmigratedFound.size > 0) {
			for (const name of unmigratedFound) {
				this.unmigratedSeriesLoreCandidates.add(name);
			}
		} else if (failedCount === 0) {
			this.unmigratedSeriesLoreCandidates.delete(cleanOld);
			for (const cand of oldCandidates) {
				this.unmigratedSeriesLoreCandidates.delete(cand);
			}
		}

		return {
			renamed: renamedCount,
			failed: failedCount,
			total: totalCount
		};
	}

	/**
	 * 递归确保文件夹及其各层父文件夹均已创建
	 */
	private async ensureFolderRecursive(folderPath: string): Promise<void> {
		const normalized = folderPath.replace(/^\/+|\/+$/g, '');
		if (!normalized) return;

		const parts = normalized.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				try {
					await this.app.vault.createFolder(current);
				} catch {
					// 文件夹可能已并发创建，忽略
				}
			}
		}
	}

	/**
	 * 创建或向已有的设定分类文件中追加新的设定条目，并构建跨设定关联（支持多层子文件夹路径）
	 */
	public async createLoreEntry(
		bookPath: string,
		loreCategory: string,
		loreName: string,
		loreAliases: string,
		loreType: string,
		loreDescription: string,
		loreRelations: Array<{ label: string; target: string }>,
		targetFilePath?: string
	): Promise<boolean> {
		let filePath: string;
		let targetFile: TFile | null = null;

		if (targetFilePath) {
			const validation = await this.validateLoreSaveDestination(bookPath, targetFilePath);
			if (!validation.valid) {
				new Notice(t('notice.invalid-lore-destination'));
				return false;
			}
			filePath = normalizePath(targetFilePath);
			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			if (abstractFile instanceof TFile) {
				targetFile = abstractFile;
			} else {
				new Notice(t('notice.invalid-lore-destination'));
				return false;
			}
		} else {
			let loreFolder = this.findLoreFolder(bookPath);
			const currentLoreName = this.plugin.settings.loreFolderName || getDefaultFileName('loreFolderName');
			const norm = (!bookPath || bookPath === '/') ? '' : bookPath.replace(/^\/+|\/+$/g, '');
			const expectedLorePath = norm ? `${norm}/${currentLoreName}` : currentLoreName;

			if (!loreFolder) {
				try {
					await this.ensureFolderRecursive(expectedLorePath);
					const abstractFile = this.app.vault.getAbstractFileByPath(expectedLorePath);
					loreFolder = abstractFile instanceof TFolder ? abstractFile : null;
				} catch {
					const abstractFile = this.app.vault.getAbstractFileByPath(expectedLorePath);
					loreFolder = abstractFile instanceof TFolder ? abstractFile : null;
				}
				if (!loreFolder) {
					new Notice(t('modal.lore-cannot-create-folder'));
					return false;
				}
			}

			const loreFolderPath = loreFolder instanceof Object && 'path' in loreFolder ? (loreFolder as { path: string }).path : expectedLorePath;
			const normalizedCategory = loreCategory.replace(/\.md$/i, '').trim();
			filePath = `${loreFolderPath}/${normalizedCategory}.md`;

			const lastSlash = filePath.lastIndexOf('/');
			if (lastSlash !== -1) {
				const parentDirPath = filePath.substring(0, lastSlash);
				await this.ensureFolderRecursive(parentDirPath);
			}

			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			if (abstractFile instanceof TFile) {
				targetFile = abstractFile;
			}
		}

		let contentToAppend = `\n\n## ${loreName.trim()}\n\n`;
		if (loreAliases.trim()) {
			contentToAppend += `**${getLoreLabel('alias')}**：${loreAliases.trim()}\n`;
		}
		if (loreType.trim()) {
			contentToAppend += `**${getLoreLabel('type')}**：${loreType.trim()}\n`;
		}
		if (loreDescription.trim()) {
			contentToAppend += `${loreDescription.trim()}\n`;
		}

		const validRelations = loreRelations.filter(r => r.label.trim() && r.target.trim());
		if (validRelations.length > 0) {
			contentToAppend += `\n### ${getLoreLabel('relation')}\n`;
			for (const rel of validRelations) {
				const targetStrRaw = rel.target.trim();
				const rawTargets = targetStrRaw.split(/[,，、]/).map(t => t.trim()).filter(Boolean);
				const formattedTargets = rawTargets.map(t => {
					if (t.startsWith('[[')) return t;
					const entry = this.getCharacterFile(bookPath, t);
					if (entry) {
						// 检查目标设定是否与当前新建设定处于同一个文件
						const normEntryPath = entry.file.path.replace(/\\/g, '/').replace(/^\/+/, '');
						const normCurrentPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
						const isSameFile = (targetFile && entry.file === targetFile) || normEntryPath === normCurrentPath;

						if (isSameFile) {
							// 同文件词条：直接使用同文档标题跳转 [[#标题]] 或 [[#标题|别名]]，无需冗余的文件名前缀
							return t === entry.heading ? `[[#${entry.heading}]]` : `[[#${entry.heading}|${t}]]`;
						}

						// 跨文件词条：通过 Obsidian metadataCache.fileToLinktext 生成精准路径（支持嵌套文件夹防重名）
						const linkPath = (this.app?.metadataCache?.fileToLinktext
							? this.app.metadataCache.fileToLinktext(entry.file, filePath, true)
							: entry.file.basename) || entry.file.basename;

						// 跨文件单文件词条模式（无 H2 标题的大纲单文档设定）
						if (entry.file.basename === entry.heading) {
							return t === entry.heading ? `[[${linkPath}]]` : `[[${linkPath}|${t}]]`;
						}

						// 跨文件多词条大纲模式：[[文件路径#标题|显示名]]
						return `[[${linkPath}#${entry.heading}|${t}]]`;
					} else {
						return `[[#${t}]]`;
					}
				});
				const targetStr = formattedTargets.join('、');
				contentToAppend += `**${rel.label.trim()}**：${targetStr}\n`;
			}
		}

		if (targetFile) {
			await this.app.vault.append(targetFile, contentToAppend);
		} else {
			await this.app.vault.create(filePath, contentToAppend.trimStart());
		}

		await this.rebuildCache();
		new Notice(t('modal.lore-saved'));
		return true;
	}
}
