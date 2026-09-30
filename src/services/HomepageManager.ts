import { Logger } from '../utils/Logger';
import { MarkdownView, type App } from 'obsidian';
import { TFile, normalizePath, TFolder, Vault } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { NovelMetadata, NovelFolderInfo } from '../types/homepage';
import { NOVEL_INFO_LABEL_MAP, NOVEL_STATUS_MAP, getNovelInfoLabel, getNovelStatusText, getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import { t } from '../i18n';

const DEFAULT_NOVEL_META: NovelMetadata = {
	name: '',
	series: '',
	status: 'ongoing',
	synopsis: '',
	protagonist: '',
	wordGoal: 0,
	genre: '',
	startDate: '',
	endDate: '',
};

// Use NOVEL_INFO_LABEL_MAP from data-keys.ts for bidirectional parsing
// (supports both Chinese and English labels in markdown files)

export class HomepageManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;
	private metadataCache = new Map<string, NovelMetadata>();
	private activeRefreshPromise: Promise<void> | null = null;
	private pendingMembershipFolders = new Set<string>();
	private refreshAllMembershipPending = false;
	private pendingCallbacks: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
		if (typeof this.plugin?.registerEvent === 'function' && typeof this.app?.vault?.on === 'function') {
			this.setupVaultEvents();
		}
	}

	public refreshSeriesMembership(folders?: string | string[]): Promise<void> {
		if (!folders) {
			this.refreshAllMembershipPending = true;
		} else {
			const list = Array.isArray(folders) ? folders : [folders];
			for (const f of list) {
				const norm = (!f || f === '/') ? '/' : f.replace(/^\/+|\/+$/g, '');
				this.pendingMembershipFolders.add(norm);
			}
		}

		return new Promise<void>((resolve, reject) => {
			this.pendingCallbacks.push({ resolve, reject });
			this.scheduleMembershipRefresh();
		});
	}

	private scheduleMembershipRefresh(): void {
		if (this.activeRefreshPromise) {
			return;
		}

		this.activeRefreshPromise = (async () => {
			await Promise.resolve();
			while (this.pendingCallbacks.length > 0) {
				const refreshAll = this.refreshAllMembershipPending;
				const targets = refreshAll ? null : Array.from(this.pendingMembershipFolders);
				const callbacks = this.pendingCallbacks;
				this.refreshAllMembershipPending = false;
				this.pendingMembershipFolders.clear();
				this.pendingCallbacks = [];

				try {
					await this.processPendingMembershipRefresh(refreshAll, targets);
					for (const cb of callbacks) {
						cb.resolve();
					}
				} catch (err) {
					for (const cb of callbacks) {
						cb.reject(err);
					}
				}
			}
		})().finally(() => {
			this.activeRefreshPromise = null;
			if (this.pendingCallbacks.length > 0) {
				this.scheduleMembershipRefresh();
			}
		});
	}

	private async processPendingMembershipRefresh(refreshAll: boolean, targets: string[] | null): Promise<void> {
		if (refreshAll) {
			this.invalidateMetadataCache();
		} else if (targets) {
			for (const folder of targets) {
				this.invalidateMetadataCache(folder);
			}
		}

		let changed = false;
		if (this.plugin.characterManager) {
			changed = await this.plugin.characterManager.refreshSeriesMembership(targets ?? undefined);
		}

		if (changed) {
			await this.refreshHomepage();
			await this.refreshHomepageViews();
		}
	}

	private setupVaultEvents(): void {
		this.plugin.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md' && this.isNovelInfoFile(file)) {
				const folderPath = file.parent?.path ?? this.getFolderPathForFile(file.path);
				this.invalidateMetadataCache(folderPath);
				this.refreshSeriesMembership(folderPath).catch((e) => {
					Logger.error('[HomepageManager] 刷新系列从属失败:', e);
				});
			}
		}));

		this.plugin.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md' && this.isNovelInfoFile(file)) {
				const folderPath = file.parent?.path ?? this.getFolderPathForFile(file.path);
				this.invalidateMetadataCache(folderPath);
				this.refreshSeriesMembership(folderPath).catch((e) => {
					Logger.error('[HomepageManager] 刷新系列从属失败:', e);
				});
			}
		}));

		this.plugin.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && (this.isNovelInfoFile(file) || this.isNovelInfoPath(file.path))) {
				const folderPath = file.parent?.path ?? this.getFolderPathForFile(file.path);
				this.invalidateMetadataCache(folderPath);
				this.refreshSeriesMembership(folderPath).catch((e) => {
					Logger.error('[HomepageManager] 刷新系列从属失败:', e);
				});
			} else if (file instanceof TFolder) {
				this.invalidateMetadataCache();
				this.refreshSeriesMembership().catch((e) => {
					Logger.error('[HomepageManager] 刷新系列从属失败:', e);
				});
			}
		}));

		this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile) {
				const wasInfo = this.isNovelInfoPath(oldPath);
				const isInfo = this.isNovelInfoFile(file) || this.isNovelInfoPath(file.path);
				if (wasInfo || isInfo) {
					const oldFolder = this.getFolderPathForFile(oldPath);
					const newFolder = file.parent?.path ?? this.getFolderPathForFile(file.path);
					const folders = oldFolder === newFolder ? [newFolder] : [oldFolder, newFolder];
					for (const folder of folders) {
						this.invalidateMetadataCache(folder);
					}
					this.refreshSeriesMembership(folders).catch((e) => {
						Logger.error('[HomepageManager] 刷新系列从属失败:', e);
					});
				}
			} else if (file instanceof TFolder) {
				this.invalidateMetadataCache();
				this.refreshSeriesMembership().catch((e) => {
					Logger.error('[HomepageManager] 刷新系列从属失败:', e);
				});
			}
		}));
	}

	private isNovelInfoPath(path: string): boolean {
		if (!path.endsWith('.md')) return false;
		const name = path.split('/').pop() || path;
		const basename = name.replace(/\.md$/, '');
		const candidates = getDefaultFileNameCandidates('novelInfoFileName');
		candidates.push(this.getNovelInfoFileName());
		return candidates.includes(basename);
	}

	private getFolderPathForFile(path: string): string {
		const lastSlash = path.lastIndexOf('/');
		return lastSlash !== -1 ? path.substring(0, lastSlash) : '';
	}

	isNovelInfoFile(file: TFile): boolean {
		if (file.extension !== 'md') return false;
		const candidates = getDefaultFileNameCandidates('novelInfoFileName');
		candidates.push(this.getNovelInfoFileName());
		const basename = file.basename || file.name?.replace(/\.md$/, '') || '';
		return candidates.includes(basename);
	}

	invalidateMetadataCache(folderPath?: string): void {
		if (folderPath) {
			const normalized = (!folderPath || folderPath === '/') ? '' : folderPath.replace(/^\/+|\/+$/g, '');
			if (!normalized) {
				this.metadataCache.clear();
				return;
			}
			this.metadataCache.delete(normalized);
			const prefix = `${normalized}/`;
			for (const key of this.metadataCache.keys()) {
				if (key.startsWith(prefix)) {
					this.metadataCache.delete(key);
				}
			}
		} else {
			this.metadataCache.clear();
		}
	}

	getHomepageFilePath(): string {
		let basename = `${t('common.default-homepage-name')}.md`;
		
		// 如果用户自定义了路径或文件名，提取其文件名部分
		if (this.plugin.settings.homepagePath) {
			basename = this.plugin.settings.homepagePath.split('/').pop() || basename;
		}

		// 永远动态放在当前第一个工作区文件夹下，抛弃旧的硬编码目录
		const folders = this.plugin.settings.workspaceFolders;
		if (folders && folders.length > 0) {
			const first = folders[0].replace(/^\/+|\/+$/g, '');
			if (first) return normalizePath(`${first}/${basename}`);
		}
		
		return basename;
	}

	getHomepageFile(): TFile | null {
		const path = this.getHomepageFilePath();
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	getNovelInfoFileName(): string {
		return this.plugin.settings.novelInfo?.fileName || getDefaultFileName('novelInfoFileName');
	}

	async ensureHomepageExists(): Promise<TFile> {
		const existing = this.getHomepageFile();
		if (existing) {
			const newContent = this.generateHomepageContent();
			await this.app.vault.process(existing, (oldContent) => {
				return oldContent !== newContent ? newContent : oldContent;
			});
			return existing;
		}

		try {
			const filePath = this.getHomepageFilePath();
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir) {
				try { await this.app.vault.createFolder(dir); } catch { /* folder already exists */ } 
			}
			const content = this.generateHomepageContent();
			const file = await this.app.vault.create(filePath, content);
			return file;
		} catch (e) {
			const existing = this.getHomepageFile();
			if (existing) {
			const newContent = this.generateHomepageContent();
			await this.app.vault.process(existing, (oldContent) => {
				return oldContent !== newContent ? newContent : oldContent;
			});
			return existing;
		}
			throw e;
		}
	}

	async refreshHomepage(): Promise<void> {
		const file = this.getHomepageFile();
		if (!file) return;
		await this.app.vault.process(file, () => this.generateHomepageContent());
	}

	generateHomepageContent(): string {
		return [
			'---',
			'homepage: true',
			'cssclasses: webnovel-homepage',
			'---',
			'',
			'```webnovel-homepage',
			'```',
			'',
		].join('\n');
	}

	getNovelFolders(): NovelFolderInfo[] {
		const folders: NovelFolderInfo[] = [];
		const seenPaths = new Set<string>();
		const workspaceFolders = this.plugin.settings.workspaceFolders;

		const checkAndAddFolder = (folder: TFolder) => {
			if (folder.isRoot()) return;
			// 排除以 _ 或 . 开头的辅助文件夹
			if (folder.name.startsWith('_') || folder.name.startsWith('.')) return;
			if (seenPaths.has(folder.path)) return;

			// 仅加载包含作品信息文件的目录（支持多语言文件名查找）
			if (this.findNovelInfoFile(folder.path)) {
				seenPaths.add(folder.path);
				folders.push({
					folderPath: folder.path,
					folderName: folder.name,
					metadata: null,
					wordCount: this.plugin.cacheManager?.getFolderWordCount(folder.path) || 0,
				});
			}
		};

		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const folderPath of workspaceFolders) {
				const normalized = folderPath.replace(/^\/+|\/+$/g, '');
				const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
				if (abstractFile instanceof TFolder) {
					checkAndAddFolder(abstractFile);
					Vault.recurseChildren(abstractFile, (child) => {
						if (child instanceof TFolder) {
							checkAndAddFolder(child);
						}
					});
				}
			}
		} else {
			const root = this.app.vault.getRoot();
			Vault.recurseChildren(root, (child) => {
				if (child instanceof TFolder) {
					checkAndAddFolder(child);
				}
			});
		}

		return folders;
	}

	findNovelInfoFile(folderPath: string): TFile | null {
		// 按优先级尝试：当前设置值 → 当前语言默认值 → 其他语言默认值
		const candidates = new Set<string>();
		const primary = this.getNovelInfoFileName();
		candidates.add(primary);
		for (const name of getDefaultFileNameCandidates('novelInfoFileName')) {
			candidates.add(name);
		}
		for (const fileName of candidates) {
			const filePath = folderPath ? normalizePath(`${folderPath}/${fileName}.md`) : `${fileName}.md`;
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	isRecognizedNovelFolder(folder: TFolder | string): boolean {
		const folderObj = typeof folder === 'string'
			? this.app.vault.getAbstractFileByPath(folder.replace(/^\/+|\/+$/g, ''))
			: folder;

		if (!(folderObj instanceof TFolder) || folderObj.isRoot()) {
			return false;
		}

		if (folderObj.name.startsWith('_') || folderObj.name.startsWith('.')) {
			return false;
		}

		const workspaceFolders = this.plugin.settings.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const normalized = folderObj.path.replace(/^\/+|\/+$/g, '');
			const inScope = workspaceFolders.some(ws => {
				const normWs = ws.replace(/^\/+|\/+$/g, '');
				return normWs && (normalized === normWs || normalized.startsWith(normWs + '/'));
			});
			if (!inScope) {
				return false;
			}
		}

		return !!this.findNovelInfoFile(folderObj.path);
	}

	// 解析作品信息.md 的 **label**：value 格式
	getNovelMetadataFromCache(folderPath: string): NovelMetadata | null {
		const infoFile = this.findNovelInfoFile(folderPath);
		if (!infoFile) return null;

		// 使用 Obsidian 的 metadataCache 解析 bold-label 格式不够可靠
		// 这里直接读文件内容解析
		// 但 metadataCache.getFileCache 可以帮我们识别文件存在
		// 实际解析需要异步读取文件内容，所以这里返回 null 让异步方法处理
		// 或者使用缓存的文件内容
		const cache = this.app.metadataCache.getFileCache(infoFile);
		if (!cache) return null;

		// 尝试从 cache.frontmatter 解析（兼容旧格式）
		// 但新格式没有 frontmatter，所以用另一种方式
		return null; // 让异步方法 getNovelMetadata 处理
	}

	async getNovelMetadata(folderPath: string): Promise<NovelMetadata | null> {
		const normalized = folderPath.replace(/^\/+|\/+$/g, '');
		const cached = this.metadataCache.get(normalized);
		if (cached) return cached;

		const infoFile = this.findNovelInfoFile(folderPath);
		if (!infoFile) return null;

		const content = await this.app.vault.cachedRead(infoFile);
		const meta = this.parseNovelInfoContent(content, folderPath);
		this.metadataCache.set(normalized, meta);
		return meta;
	}

	// 解析 **label**：value Markdown 格式
	parseNovelInfoContent(content: string, folderPath?: string): NovelMetadata {
		const meta: NovelMetadata = {
			...DEFAULT_NOVEL_META,
			name: folderPath ? folderPath.split('/').pop() || folderPath : '',
		};

		const lines = content.split(/\r?\n/);
		for (const line of lines) {
			const match = line.match(/\*\*(.+?)\*\*[：:]\s*(.*)/);
			if (!match) continue;
			const label = match[1];
			const value = match[2].trim();
			const key = NOVEL_INFO_LABEL_MAP[label];
			if (!key) continue;

			switch (key) {
				case 'status': {
					const mapped = NOVEL_STATUS_MAP[value];
					meta.status = mapped ? mapped as NovelMetadata['status'] : 'ongoing';
					break;
				}
				case 'wordGoal': meta.wordGoal = parseInt(value) || 0; break;
				case 'series': meta.series = value; break;
				default: (meta as unknown as Record<string, unknown>)[key] = value; break;
			}
		}

		return meta;
	}

	async createNovelInfoFile(folderPath: string, overrides?: Partial<NovelMetadata>): Promise<TFile> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			await this.app.vault.createFolder(folderPath);
		}

		// 检查是否已有作品信息文件（多语言查找）
		const existing = this.findNovelInfoFile(folderPath);
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.getNovelInfoFileName();
			if (existing.name !== expectedName + '.md') {
				const newPath = normalizePath(folderPath + '/' + expectedName + '.md');
				try {
					await this.app.fileManager.renameFile(existing, newPath);
				} catch (e) {
					Logger.warn('[HomepageManager] 重命名作品信息文件失败:', e);
				}
			}
			const found = this.app.vault.getAbstractFileByPath(normalizePath(folderPath + '/' + expectedName + '.md'));
				return found instanceof TFile ? found : existing;
		}

		// 新建时优先使用用户设置，fallback 到当前语言的默认文件名
		const fileName = this.getNovelInfoFileName();
		const filePath = normalizePath(`${folderPath}/${fileName}.md`);

		const today = new Date().toISOString().slice(0, 10);
		const folderName = folderPath.split('/').pop() || folderPath;
		const meta = { ...DEFAULT_NOVEL_META, name: folderName, startDate: today, ...overrides };

		const lines = [
			`**${getNovelInfoLabel('series')}**：${meta.series || ''}`,
			`**${getNovelInfoLabel('status')}**：${getNovelStatusText(meta.status)}`,
			`**${getNovelInfoLabel('synopsis')}**：${meta.synopsis}`,
			`**${getNovelInfoLabel('protagonist')}**：${meta.protagonist}`,
			`**${getNovelInfoLabel('genre')}**：${meta.genre}`,
			`**${getNovelInfoLabel('wordGoal')}**：${meta.wordGoal || ''}`,
			`**${getNovelInfoLabel('startDate')}**：${meta.startDate}`,
			`**${getNovelInfoLabel('endDate')}**：${meta.endDate || ''}`,
			'',
		];
		const file = await this.app.vault.create(filePath, lines.join('\n'));
		this.invalidateMetadataCache(folderPath);
		return file;
	}

	applySeriesToContent(content: string, series: string): string {
		const trimmedSeries = series.trim();
		const newline = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		let seriesLineIndex = -1;
		let seriesIndent = '';
		let seriesLabel = getNovelInfoLabel('series');
		let seriesSep = '：';

		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(\s*)\*\*(.+?)\*\*([：:])\s*(.*)/);
			if (!match) continue;
			const key = NOVEL_INFO_LABEL_MAP[match[2]];
			if (key === 'series') {
				seriesLineIndex = i;
				seriesIndent = match[1];
				seriesLabel = match[2];
				seriesSep = match[3];
				break;
			}
		}

		if (seriesLineIndex !== -1) {
			if (trimmedSeries) {
				lines[seriesLineIndex] = `${seriesIndent}**${seriesLabel}**${seriesSep}${seriesSep === ':' ? ' ' : ''}${trimmedSeries}`;
			} else {
				lines[seriesLineIndex] = `${seriesIndent}**${seriesLabel}**${seriesSep}`;
			}
			return lines.join(newline);
		}

		if (!trimmedSeries) {
			return content;
		}

		let insertIndex = -1;
		let insertIndent = '';
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(\s*)\*\*(.+?)\*\*([：:])/);
			if (match && NOVEL_INFO_LABEL_MAP[match[2]]) {
				insertIndex = i;
				insertIndent = match[1];
				break;
			}
		}

		const newLine = `${insertIndent}**${getNovelInfoLabel('series')}**：${trimmedSeries}`;
		if (insertIndex !== -1) {
			lines.splice(insertIndex, 0, newLine);
		} else {
			lines.unshift(newLine);
		}
		return lines.join(newline);
	}

	async getAllSeries(): Promise<string[]> {
		const folders = this.getNovelFolders();
		const seriesSet = new Set<string>();
		for (const folder of folders) {
			const meta = await this.getNovelMetadata(folder.folderPath);
			const s = meta?.series?.trim();
			if (s) {
				seriesSet.add(s);
			}
		}
		return Array.from(seriesSet).sort();
	}

	async getSeriesNovels(seriesName: string): Promise<NovelFolderInfo[]> {
		const targetSeries = seriesName.trim();
		if (!targetSeries) return [];

		const folders = this.getNovelFolders();
		const result: NovelFolderInfo[] = [];
		for (const folder of folders) {
			const meta = await this.getNovelMetadata(folder.folderPath);
			if (meta?.series?.trim() === targetSeries) {
				result.push({
					...folder,
					metadata: meta
				});
			}
		}
		return result;
	}

	async getNovelSeries(folderPath: string): Promise<string> {
		const meta = await this.getNovelMetadata(folderPath);
		return meta?.series?.trim() || '';
	}

	async getSiblingNovelsInSeries(folderPath: string): Promise<NovelFolderInfo[]> {
		const series = await this.getNovelSeries(folderPath);
		if (!series) return [];
		const normalized = folderPath.replace(/^\/+|\/+$/g, '');
		const allInSeries = await this.getSeriesNovels(series);
		return allInSeries.filter(n => n.folderPath.replace(/^\/+|\/+$/g, '') !== normalized);
	}

	async updateNovelSeries(folderPath: string, seriesName: string): Promise<void> {
		const infoFile = this.findNovelInfoFile(folderPath);
		if (!infoFile) return;

		const trimmed = seriesName.trim();
		await this.app.vault.process(infoFile, (content) => {
			return this.applySeriesToContent(content, trimmed);
		});

		await this.refreshSeriesMembership(folderPath);
	}

	async clearNovelSeries(folderPath: string): Promise<void> {
		await this.updateNovelSeries(folderPath, '');
	}

	async ensureNovelInfoFiles(): Promise<void> {
		const folders = this.plugin.settings.workspaceFolders;

		if (folders && folders.length > 0) {
			for (const folderPath of folders) {
				const normalized = folderPath.replace(/^\/+|\/+$/g, '');
				const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
				if (!(abstractFile instanceof TFolder)) continue;
				for (const child of abstractFile.children) {
					if (!(child instanceof TFolder)) continue;
					if (child.name.startsWith('_') || child.name.startsWith('.')) continue;
					const infoFile = this.findNovelInfoFile(child.path);
					if (!infoFile) {
						await this.createNovelInfoFile(child.path);
					}
				}
			}
		} else {
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				if (!(child instanceof TFolder)) continue;
				if (child.name.startsWith('_') || child.name.startsWith('.')) continue;
				const infoFile = this.findNovelInfoFile(child.path);
				if (!infoFile) {
					await this.createNovelInfoFile(child.path);
				}
			}
		}
	}

	async createNewNovel(novelName: string, overrides?: Partial<NovelMetadata>): Promise<{ folderPath: string; infoFile: TFile }> {
		// 新作品默认建立在第一个 workspaceFolder 下面
		const workspaceFolders = this.plugin.settings.workspaceFolders;
		const parentFolder = workspaceFolders && workspaceFolders.length > 0
			? workspaceFolders[0].replace(/^\/+|\/+$/g, '')
			: '';
		const folderPath = parentFolder ? normalizePath(`${parentFolder}/${novelName}`) : novelName;

		const infoFile = await this.createNovelInfoFile(folderPath, { name: novelName, ...overrides });

		if (this.plugin.writingJourneyService) {
			await this.plugin.writingJourneyService.recordWorkCreated(folderPath, novelName);
		}

		await this.refreshHomepage();

		return { folderPath, infoFile };
	}

		async deleteHomepage(): Promise<void> {
		const file = this.getHomepageFile();
		if (file) {
			await this.app.fileManager.trashFile(file);
		}
	}

	async renameHomepageFile(oldPath: string, newPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(oldPath);
		if (file instanceof TFile) {
			const dir = newPath.substring(0, newPath.lastIndexOf('/'));
			if (dir) {
				try { await this.app.vault.createFolder(dir); } catch { /* folder already exists */ }
			}
			await this.app.fileManager.renameFile(file, newPath);
		} else {
			Logger.warn(`[HomepageManager] 找不到旧主页文件: ${oldPath}，将仅更新设置。`);
		}
	}

	refreshHomepageViews(): Promise<void> {
		const homepagePath = this.getHomepageFilePath();

		return import('../ui/components/HomepageRenderer.js').then(async ({ HomepageRenderer }) => {
			const renderer = new HomepageRenderer(this.app, this.plugin);
			const promises: Promise<void>[] = [];
			this.app.workspace.iterateAllLeaves(leaf => {
				const view = leaf.view;
				if (view && view.getViewType() === 'markdown') {
					const mdView = view as MarkdownView;
					if (mdView?.file?.path === homepagePath && mdView?.previewMode) {
						const rootEl = mdView.containerEl.querySelector<HTMLElement>('.webnovel-homepage-root');
						if (rootEl) {
							promises.push(
								renderer.renderHomepage(rootEl).catch(err => {
									Logger.error('[HomepageManager] renderHomepage failed, fallback to rerender:', err);
									mdView.previewMode.rerender(true);
								})
							);
						} else {
							mdView.previewMode.rerender(true);
						}
					}
				}
			});
			await Promise.all(promises);
		}).catch(err => {
			Logger.error('[HomepageManager] Failed to import HomepageRenderer, fallback to rerender all:', err);
			this.app.workspace.iterateAllLeaves(leaf => {
				const view = leaf.view;
				if (view && view.getViewType() === 'markdown') {
					const mdView = view as MarkdownView;
					if (mdView?.file?.path === homepagePath && mdView?.previewMode) {
						mdView.previewMode.rerender(true);
					}
				}
			});
		});
	}

	private _leafOriginalStates = new WeakMap<object, Record<string, unknown>>();
	private _homepageTimer: number | null = null;

	public handleViewMode(): void {
		if (!this.plugin.settings.enableHomepage) return;
		const homepagePath = this.getHomepageFilePath();
		if (!homepagePath) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const leaf = view.leaf;
		const activeFile = view.file;
		const isOnHomepage = activeFile && activeFile.path === homepagePath;

		if (isOnHomepage) {
			const leafContent = view.containerEl.closest('.workspace-leaf-content') || view.containerEl;
			leafContent.classList.add('is-webnovel-homepage');

			if (!this._leafOriginalStates.has(leaf)) {
				const stateToSave = view.getState();
				if (stateToSave.mode === 'preview') {
					stateToSave.mode = this.app.vault.getConfig('defaultViewMode') || 'source';
					stateToSave.source = false;
				}
				this._leafOriginalStates.set(leaf, stateToSave);
			}
			if (view.getMode() !== 'preview') {
				if (this._homepageTimer) window.clearTimeout(this._homepageTimer);
				this._homepageTimer = window.setTimeout(() => {
					this._homepageTimer = null;
					const latestView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (latestView && latestView.file?.path === homepagePath) {
						const state = latestView.getState();
						state.mode = 'preview';
						void latestView.leaf.setViewState({ type: 'markdown', state, active: true });
					}
				}, 50);
			}
			void this.refreshHomepageViews();
		} else {
			const leafContent = view.containerEl.closest('.workspace-leaf-content') || view.containerEl;
			leafContent.classList.remove('is-webnovel-homepage');

			if (this._leafOriginalStates.has(leaf)) {
				const originalState = this._leafOriginalStates.get(leaf);
				this._leafOriginalStates.delete(leaf);

				if (originalState) {
					const currentState = view.getState();
					if (currentState.mode !== originalState.mode || currentState.source !== originalState.source) {
						if (this._homepageTimer) window.clearTimeout(this._homepageTimer);
						this._homepageTimer = window.setTimeout(() => {
							this._homepageTimer = null;
							const latestView = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (latestView && latestView.leaf === leaf && latestView.file?.path !== homepagePath) {
								const newState = latestView.getState();
								newState.mode = originalState.mode;
								newState.source = originalState.source;
								void latestView.leaf.setViewState({ type: 'markdown', state: newState, active: true });
							}
						}, 50);
					}
				}
			}
		}
	}

	public cleanup(): void {
		if (this._homepageTimer !== null) {
			window.clearTimeout(this._homepageTimer);
			this._homepageTimer = null;
		}
		this._leafOriginalStates = new WeakMap();
	}

	/**
	 * 更新指定章节文件的目标字数 FrontMatter (`word-goal`)
	 */
	async setChapterWordGoal(file: TFile, goal: number): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const fm = frontmatter as Record<string, unknown>;
			if (isNaN(goal) || goal <= 0) {
				delete fm['word-goal'];
			} else {
				fm['word-goal'] = goal;
			}
		});
	}
}
