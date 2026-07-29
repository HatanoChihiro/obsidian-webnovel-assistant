import type { App, TAbstractFile} from 'obsidian';
import { TFile, TFolder, type MarkdownView, Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import { findBookRoot } from '../utils/path';
import { t } from '../i18n';

export interface LoreEntry {
	file: TFile;
	heading: string;
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
	
	public cacheVersion: number = 0;
	private _initialized: boolean = false;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	public async ensureInitialized(): Promise<void> {
		if (this._initialized) return;
		this._initialized = true;
		await this.initialize();
	}

	public async initialize(): Promise<void> {
		this._initialized = true;
		await this.rebuildCache();

		// 监听文件变化
		this.plugin.registerEvent(
			this.app.vault.on('create', (file) => this.handleFileChange(file, 'create'))
		);
		this.plugin.registerEvent(
			this.app.vault.on('delete', (file) => this.handleFileChange(file, 'delete'))
		);
		this.plugin.registerEvent(
			this.app.vault.on('rename', (file, _oldPath) => {
				this.handleFileChange(file, 'rename');
			})
		);
		this.plugin.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				this.handleFileChange(file, 'modify');
			})
		);
	}

	/**
	 * 全量重建设定缓存
	 */
	public async rebuildCache(): Promise<void> {
		const newCache = new Map<string, Map<string, LoreEntry>>();
		const newLowerMap = new Map<string, Map<string, string>>();
		
		const candidates = this.getLoreCandidates();
		const allMarkdownFiles = (this.plugin.settings.workspaceFolders && this.plugin.settings.workspaceFolders.length > 0)
			? this.plugin.getTrackedMarkdownFiles(true)
			: this.app.vault.getMarkdownFiles();
		const files = allMarkdownFiles.filter(file => {
			const parentPath = file.parent?.path || '';
			for (const candidate of candidates) {
				if (parentPath.includes(candidate)) return true;
			}
			return false;
		});
		await Promise.all(files.map(file => this.addFileToCacheIfValidInto(file, newCache, newLowerMap)));
		
		this.characterCache = newCache;
		this.lowercaseKeyMap = newLowerMap;
		
		this.cacheVersion++;
		
		// 注意：这里的 dispatch 配合 CharacterHoverExtension 中的 cacheVersion 检测，
		// 共同实现了“文件保存后，哪怕没有打字或滚动也能立即刷新高亮”的效果。
		// 没有 dispatch，CM 的 update 事件就不会触发；没有 cacheVersion 比较，
		// 即使触发了 update，由于 docChanged 为 false 也不会重建装饰器。
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view.getViewType() === 'markdown') {
				const editor = (view as MarkdownView).editor;
				const editorView = (editor as unknown as { cm?: { dispatch: (tr: object) => void } })?.cm;
				if (editorView) {
					editorView.dispatch({});
				}
			}
		});

		this.app.workspace.trigger('webnovel-workbench-lore-updated');
	}

	/**
	 * 检查路径是否在设定文件夹内（支持多语言文件夹名）
	 */
	public getLoreCandidates(): Set<string> {
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.loreFolderName || getDefaultFileName('loreFolderName'));
		for (const name of getDefaultFileNameCandidates('loreFolderName')) candidates.add(name);
		return candidates;
	}

	/**
	 * 检查路径是否在设定文件夹内（支持多语言文件夹名）
	 */
	public isLorePath(bookPath: string, parentPath: string): boolean {
		const candidates = this.getLoreCandidates();
		
		const pathSegments = parentPath.split('/');
		for (const loreFolderName of candidates) {
			if (bookPath !== "/" && bookPath !== "" && parentPath !== bookPath && !parentPath.startsWith(bookPath + "/")) {
				continue;
			}
			if (pathSegments.includes(loreFolderName)) {
				return true;
			}
		}
		return false;
	}
	private handleFileChange(file: TAbstractFile, eventType: 'create' | 'modify' | 'delete' | 'rename' = 'modify'): void {
		if (file instanceof TFile && file.extension === 'md') {
			const bookPath = this.getBookPathForFile(file);
			if (bookPath) {
				const parentPath = file.parent?.path || '';
				if (this.isLorePath(bookPath, parentPath)) {
					this.plugin.adaptiveDebounceManager.debounceFixed('rebuild-character-cache', () => { void (async () => {
						try {
							await this.rebuildCache();
							this.app.workspace.updateOptions();
						} catch (e) {
							console.error(e);
						}
					})(); }, 500);
				}
			}
		} else if (file instanceof TFolder) {
			// [BUGFIX] 新建文件夹时不要无脑重构缓存并触发全局 updateOptions()
			// 因为 updateOptions() 会强制文件树重新 sort，从而打断用户的重命名操作！
			if (eventType === 'create') return;

			this.plugin.adaptiveDebounceManager.debounceFixed('rebuild-character-cache', () => { void (async () => {
				try {
					await this.rebuildCache();
					this.app.workspace.updateOptions();
				} catch (e) {
					console.error(e);
				}
			})(); }, 500);
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
				if (h.level === 2 && h.heading.trim().replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '') === headingText) {
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
		if (!fileCache || !fileCache.headings) return '';
		
		const content = await this.app.vault.cachedRead(entry.file);
		const lines = content.split('\n');
		
		for (let i = 0; i < fileCache.headings.length; i++) {
			const h = fileCache.headings[i];
			if (h.level === 2 && h.heading.trim().replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '') === entry.heading) {
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
		return '';
	}

	public async updateLoreContent(entry: LoreEntry, newContent: string): Promise<boolean> {
		const file = entry.file;
		const fileCache = this.app.metadataCache.getFileCache(file);
		if (!fileCache || !fileCache.headings) return false;

		await this.app.vault.process(file, (data) => {
			const lines = data.split('\n');
			for (let i = 0; i < fileCache.headings!.length; i++) {
				const h = fileCache.headings![i];
				if (h.level === 2 && h.heading.trim().replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '') === entry.heading) {
					const startLine = h.position.start.line;
					let nextLevelH = null;
					for (let j = i + 1; j < fileCache.headings!.length; j++) {
						if (fileCache.headings![j].level <= h.level) {
							nextLevelH = fileCache.headings![j];
							break;
						}
					}
					const endLine = nextLevelH ? nextLevelH.position.start.line - 1 : lines.length - 1;

					const newLines = newContent.split('\n');
					// Replace the lines after the heading up to endLine
					// Ensure there is at least one blank line before next section if needed, though split/join handles it.
					lines.splice(startLine + 1, endLine - startLine, ...newLines);
					return lines.join('\n');
				}
			}
			return data;
		});
		return true;
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
	 * 检查一个文件是否是设定文件，并加入缓存
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
			
			const addEntry = (key: string, entry: LoreEntry) => {
				bookCache.set(key, entry);
				lowerMap.set(key.toLowerCase(), key);
			};
			const fileCache = this.app.metadataCache.getFileCache(file);

			// 统一获取文本（如果有缓存用缓存文本，否则原始读取）
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split('\n');

			// 如果 metadataCache 没准备好（如重启时），我们手动解析二级标题
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

			// 字典模式：解析各级标题作为正名，并在下方的正文里提取别名
			if (headings.length > 0) {
				for (let i = 0; i < headings.length; i++) {
					const heading = headings[i];
					if (heading.level !== 2) continue; // 强制仅识别二级标题作为词条正名

					const rawHeading = heading.heading.trim();
					if (!rawHeading) continue;
					
					// 清理 Markdown 格式标记
					const headingText = rawHeading.replace(/\*\*|__/g, '').replace(/\*|_/g, '').replace(/`/g, '');
					if (!headingText) continue;

					// 提取标题正名
					addEntry(headingText, { file, heading: headingText });

					// 截取当前标题到下一个标题之间的内容，防止别名串写
					const startLine = heading.position.end.line + 1;
					const nextHeading = headings[i + 1];
					const endLine = nextHeading ? nextHeading.position.start.line : lines.length;

					const chunk = lines.slice(startLine, endLine).join('\n');
					
					// 查找 `别名：`、`**别名**：` 等格式
					const aliasMatch = chunk.match(/(?:\*\*|__)?(?:别名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/);
					if (aliasMatch && aliasMatch[1]) {
						// 支持用逗号、顿号分隔多个别名
						const rawAliases = aliasMatch[1].split(/[,，、/|]/);
						for (let a of rawAliases) {
							a = a.trim();
							if (a) {
								addEntry(a, { file, heading: headingText });
							}
						}
					}
				}
			}
		}
	}
}
