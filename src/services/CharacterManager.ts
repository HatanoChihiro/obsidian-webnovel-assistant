import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder, type MarkdownView, Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { getDefaultFileName, getLoreLabel } from '../i18n/data-keys';
import { findBookRoot, getCandidateNames, isCandidateSubpath } from '../utils/path';
import { t } from '../i18n';

export interface LoreEntry {
	file: TFile;
	heading: string;
}

/**
 * 清理设定标题文本，去除 Obsidian 双向链接、Markdown 格式标记、Hashtag 及多余空格
 */
export function cleanLoreHeading(rawHeading: string): string {
	if (!rawHeading) return '';

	return rawHeading
		.trim()
		.replace(/^#{1,6}\s+/, '')
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
				return this.isLorePath(bookPath, parentPath);
			} catch {
				return false;
			}
		});

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

		const newCache = new Map<string, Map<string, LoreEntry>>();
		const newLowerMap = new Map<string, Map<string, string>>();

		for (const [bookPath, bookFiles] of this.fileContributions.entries()) {
			const bookCache = new Map<string, LoreEntry>();
			const lowerMap = new Map<string, string>();
			for (const entries of bookFiles.values()) {
				for (const { key, entry } of entries) {
					const cleanedKey = cleanLoreHeading(key);
					if (cleanedKey) {
						bookCache.set(cleanedKey, entry);
						lowerMap.set(cleanedKey.toLowerCase(), cleanedKey);
					}
				}
			}
			newCache.set(bookPath, bookCache);
			newLowerMap.set(bookPath, lowerMap);
		}

		this.characterCache = newCache;
		this.lowercaseKeyMap = newLowerMap;
		this.cacheVersion++;

		this.notifyCacheUpdated();
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
	private aggregateBookCache(bookPath: string): void {
		const bookFiles = this.fileContributions.get(bookPath);
		if (!bookFiles || bookFiles.size === 0) {
			this.fileContributions.delete(bookPath);
			this.characterCache.delete(bookPath);
			this.lowercaseKeyMap.delete(bookPath);
			return;
		}

		const bookCache = new Map<string, LoreEntry>();
		const lowerMap = new Map<string, string>();

		for (const entries of bookFiles.values()) {
			for (const { key, entry } of entries) {
				const cleanedKey = cleanLoreHeading(key);
				if (cleanedKey) {
					bookCache.set(cleanedKey, entry);
					lowerMap.set(cleanedKey.toLowerCase(), cleanedKey);
				}
			}
		}

		this.characterCache.set(bookPath, bookCache);
		this.lowercaseKeyMap.set(bookPath, lowerMap);
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
				this.aggregateBookCache(oldBookPath);
			}
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
	private triggerDebouncedRebuild(): void {
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

	public getCharactersForBook(bookPath: string): string[] {
		const bookCache = this.characterCache.get(bookPath);
		if (!bookCache) return [];
		// 按照长度降序排序，避免 "张三" 和 "张三丰" 匹配时被 "张三" 抢占
		return Array.from(bookCache.keys()).sort((a, b) => b.length - a.length);
	}

	/**
	 * 获取指定作品（bookPath）下的所有设定条目，保持严格的文件写入顺序（因为 Map 按照插入顺序迭代，而我们在初始化时是按文件自上而下插入的）
	 */
	public getLoreEntriesInFileOrder(bookPath: string): LoreEntry[] {
		const bookCache = this.characterCache.get(bookPath);
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
		const bookCache = this.characterCache.get(bookPath);
		if (!bookCache) return null;
		
		const entry = bookCache.get(characterName);
		if (entry) return entry;
		
		// Fallback: 忽略大小写查找 (O(1))
		const lowerMap = this.lowercaseKeyMap.get(bookPath);
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
					return bodyLines.join('\n').trim();
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
			return body.trim();
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

						const newLines = newContent.split('\n');
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
				}
				updated = true;
				return (prefix ? prefix + '\n' : '') + newContent.trim() + '\n';
			}

			return data;
		});
		return updated;
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

				addEntry(headingText, { file, heading: headingText });

				const startLine = heading.position.end.line + 1;
				const nextHeading = headings[i + 1];
				const endLine = nextHeading ? nextHeading.position.start.line : lines.length;

				const chunk = lines.slice(startLine, endLine).join('\n');
				const aliasMatch = chunk.match(/(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/);
				if (aliasMatch && aliasMatch[1]) {
					const rawAliases = aliasMatch[1].split(/[,，、/|;；]/);
					for (const a of rawAliases) {
						addEntry(a, { file, heading: headingText });
					}
				}
			}
		} else {
			const fileEntryName = cleanLoreHeading(file.basename);
			if (fileEntryName) {
				addEntry(fileEntryName, { file, heading: fileEntryName });

				const fm = fileCache?.frontmatter;
				if (fm) {
					const rawAliases = (fm['aliases'] ?? fm['alias'] ?? fm['别名']) as unknown;
					if (Array.isArray(rawAliases)) {
						for (const a of rawAliases) {
							if (typeof a === 'string' || typeof a === 'number') {
								addEntry(String(a), { file, heading: fileEntryName });
							}
						}
					} else if (typeof rawAliases === 'string' && rawAliases.trim()) {
						const splitAliases = rawAliases.split(/[,，、/|;；]/);
						for (const a of splitAliases) {
							addEntry(a, { file, heading: fileEntryName });
						}
					}
				}

				const aliasMatches = content.matchAll(/(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/gi);
				for (const match of aliasMatches) {
					if (match[1]) {
						const rawAliases = match[1].split(/[,，、/|;；]/);
						for (const a of rawAliases) {
							addEntry(a, { file, heading: fileEntryName });
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
		for (const loreFolderName of candidates) {
			const lorePath = bookPath === '/' ? loreFolderName : bookPath + '/' + loreFolderName;
			const folder = this.app.vault.getAbstractFileByPath(lorePath);
			if (folder instanceof TFolder) return folder;
		}
		return null;
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
		loreRelations: Array<{ label: string; target: string }>
	): Promise<boolean> {
		let loreFolder = this.findLoreFolder(bookPath);
		const currentLoreName = this.plugin.settings.loreFolderName || getDefaultFileName('loreFolderName');
		const expectedLorePath = bookPath === '/' ? currentLoreName : bookPath + '/' + currentLoreName;

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
		const filePath = `${loreFolderPath}/${normalizedCategory}.md`;

		const lastSlash = filePath.lastIndexOf('/');
		if (lastSlash !== -1) {
			const parentDirPath = filePath.substring(0, lastSlash);
			await this.ensureFolderRecursive(parentDirPath);
		}

		let targetFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(targetFile instanceof TFile)) {
			targetFile = null;
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
