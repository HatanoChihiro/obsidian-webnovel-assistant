import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder, parseYaml } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { findBookRoot, getCandidateNames } from '../utils/path';
import { Logger } from '../utils/Logger';
import {
	WRITING_JOURNEY_SCHEMA_VERSION,
	WRITING_JOURNEY_YAML_KEY,
	parseWritingJourneyLog,
	type WritingJourneyEvent,
	type WritingJourneyLog,
	type WritingJourneyParseResult,
	type WorkCreatedEvent,
	type WorkImportedEvent,
	type ChapterCreatedEvent,
	type ChapterRenamedEvent,
	type ChapterMovedEvent,
	type ChapterDeletedEvent,
	type ChapterStatusChangedEvent,
	type WorkStatusChangedEvent
} from '../types/writingJourney';

export class WritingJourneyService {
	private app: App;
	private plugin: WebNovelAssistantPlugin;

	/** 每个作品的串行写入队列，避免异步写 YAML 产生覆盖竞争 */
	private writeQueues = new Map<string, Promise<void>>();

	/** 已由插件主动记录的事件路径（带 TTL 时间戳），用于避免 Vault 监听器产生重复记录 */
	private handledCreates = new Map<string, number>();
	private handledRenames = new Map<string, number>();
	private handledDeletes = new Map<string, number>();

	/** 启动/重新加载时的既有文件快照，避免 Vault 回放 create 事件时误记为新章节 */
	private baselinePaths = new Set<string>();

	/** 元数据索引就绪状态，未就绪前仅收集/抑制事件，不向作品信息写入记录 */
	private isReady = false;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	public async destroy(): Promise<void> {
		const pending = Array.from(this.writeQueues.values());
		await Promise.allSettled(pending);
		this.writeQueues.clear();
		this.handledCreates.clear();
		this.handledRenames.clear();
		this.handledDeletes.clear();
		this.baselinePaths.clear();
		this.isReady = false;
	}

	/**
	 * 标记元数据索引已就绪，并刷新既有文件快照（幂等操作）
	 */
	public markReady(): void {
		if (this.isReady) return;
		this.isReady = true;
		this.initializeStartupBaseline();
	}

	/**
	 * 检查 Obsidian 元数据缓存当前是否已就绪（用于插件重载等已有缓存场景）。
	 * 仅当当前 Markdown 文件快照非空且每个文件均已拥有非空元数据缓存时返回 true；
	 * 文件列表为空或存在任意未缓存文件时返回 false，等待 public metadataCache 'resolved' 事件。
	 */
	public checkInitialMetadataReadiness(): boolean {
		if (!this.app.metadataCache) return true;
		const files = this.plugin.getVaultMarkdownFiles();
		if (files.length === 0) {
			return false;
		}
		for (const file of files) {
			if (!this.app.metadataCache.getFileCache(file)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * 建立启动/重新加载时的既有文件快照，防止 Vault 回放 create 事件时误记录 chapter.created
	 */
	public initializeStartupBaseline(initialPaths?: Iterable<string>): void {
		this.baselinePaths.clear();
		if (initialPaths) {
			for (const path of initialPaths) {
				if (path) this.baselinePaths.add(path);
			}
			return;
		}

		const files = this.plugin.getVaultMarkdownFiles();
		for (const file of files) {
			if (file?.path) {
				this.baselinePaths.add(file.path);
			}
		}
	}

	public hasBaselinePath(path: string): boolean {
		return this.baselinePaths.has(path);
	}

	public removeBaselineFolder(folderPath: string): void {
		const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
		const toDelete: string[] = [];
		for (const path of this.baselinePaths) {
			if (path.startsWith(prefix)) {
				toDelete.push(path);
			}
		}
		for (const path of toDelete) {
			this.baselinePaths.delete(path);
		}
	}

	public renameBaselineFolder(oldFolderPath: string, newFolderPath: string): void {
		const oldPrefix = oldFolderPath.endsWith('/') ? oldFolderPath : `${oldFolderPath}/`;
		const newPrefix = newFolderPath.endsWith('/') ? newFolderPath : `${newFolderPath}/`;
		const toUpdate: string[] = [];
		for (const path of this.baselinePaths) {
			if (path.startsWith(oldPrefix)) {
				toUpdate.push(path);
			}
		}
		for (const oldPath of toUpdate) {
			this.baselinePaths.delete(oldPath);
			const newPath = newPrefix + oldPath.slice(oldPrefix.length);
			this.baselinePaths.add(newPath);
		}
	}

	private generateEventId(): string {
		if (typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function') {
			return window.crypto.randomUUID();
		}
		return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
	}

	public markHandledCreate(path: string, ttlMs: number = 3000): void {
		this.handledCreates.set(path, Date.now() + ttlMs);
		this.baselinePaths.add(path);
	}

	public consumeHandledCreate(path: string): boolean {
		const exp = this.handledCreates.get(path);
		if (exp !== undefined) {
			this.handledCreates.delete(path);
			if (Date.now() <= exp) return true;
		}
		return false;
	}

	public markHandledRename(oldPath: string, newPath: string, ttlMs: number = 3000): void {
		const key = `${oldPath}->${newPath}`;
		this.handledRenames.set(key, Date.now() + ttlMs);
		this.baselinePaths.delete(oldPath);
		this.baselinePaths.add(newPath);
	}

	public consumeHandledRename(oldPath: string, newPath: string): boolean {
		const key = `${oldPath}->${newPath}`;
		const exp = this.handledRenames.get(key);
		if (exp !== undefined) {
			this.handledRenames.delete(key);
			if (Date.now() <= exp) return true;
		}
		return false;
	}

	public markHandledDelete(path: string, ttlMs: number = 3000): void {
		this.handledDeletes.set(path, Date.now() + ttlMs);
		this.baselinePaths.delete(path);
	}

	public consumeHandledDelete(path: string): boolean {
		const exp = this.handledDeletes.get(path);
		if (exp !== undefined) {
			this.handledDeletes.delete(path);
			if (Date.now() <= exp) return true;
		}
		return false;
	}

	/**
	 * 获取指定作品根目录的作品信息文件
	 */
	public findNovelInfoFile(bookPath: string): TFile | null {
		return this.plugin.homepageManager?.findNovelInfoFile(bookPath) ?? null;
	}

	/**
	 * 读取并解析指定作品的写作历程日志
	 */
	public async getJourneyLog(bookPath: string): Promise<WritingJourneyParseResult> {
		const infoFile = this.findNovelInfoFile(bookPath);
		if (!infoFile) {
			return { status: 'empty', log: null };
		}

		try {
			const content = await this.app.vault.read(infoFile);
			const fmMatch = /^---\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
			if (!fmMatch || !fmMatch[1]) {
				return { status: 'empty', log: null };
			}

			let parsedYaml: unknown;
			try {
				parsedYaml = parseYaml(fmMatch[1]);
			} catch (yamlErr) {
				Logger.warn(`[WritingJourneyService] Failed to parse frontmatter YAML in ${infoFile.path}:`, yamlErr);
				return { status: 'malformed', log: null, error: 'YAML parse failure' };
			}

			if (!parsedYaml || typeof parsedYaml !== 'object' || Array.isArray(parsedYaml)) {
				return { status: 'empty', log: null };
			}

			const record = parsedYaml as Record<string, unknown>;
			const rawJourney = record[WRITING_JOURNEY_YAML_KEY];
			return parseWritingJourneyLog(rawJourney);
		} catch (error) {
			Logger.error(`[WritingJourneyService] Error reading journey log for ${bookPath}:`, error);
			return { status: 'malformed', log: null, error: String(error) };
		}
	}

	/**
	 * 串行追加写入事件（具有严格的单作品串行保证与 awaitable 语义）
	 */
	public async appendEvents(bookPath: string, events: WritingJourneyEvent[]): Promise<void> {
		if (!bookPath || events.length === 0) return;

		const normalizedBookPath = bookPath === '/' ? '/' : bookPath.replace(/^\/+|\/+$/g, '');
		const prev = this.writeQueues.get(normalizedBookPath) ?? Promise.resolve();

		const next = (async () => {
			await prev;
			await this.performAppendEvents(normalizedBookPath, events);
		})();

		const tracked = next.catch((err) => {
			Logger.error(`[WritingJourneyService] Failed to append events to ${normalizedBookPath}:`, err);
		});
		this.writeQueues.set(normalizedBookPath, tracked);
		void tracked.finally(() => {
			if (this.writeQueues.get(normalizedBookPath) === tracked) {
				this.writeQueues.delete(normalizedBookPath);
			}
		});

		return next;
	}

	public async appendEvent(bookPath: string, event: WritingJourneyEvent): Promise<void> {
		return this.appendEvents(bookPath, [event]);
	}

	private async performAppendEvents(bookPath: string, events: WritingJourneyEvent[]): Promise<void> {
		let infoFile = this.findNovelInfoFile(bookPath);
		if (!infoFile && this.plugin.homepageManager) {
			try {
				infoFile = await this.plugin.homepageManager.createNovelInfoFile(bookPath);
			} catch (e) {
				Logger.error(`[WritingJourneyService] Failed to create novel info file for ${bookPath}:`, e);
				throw e;
			}
		}

		if (!infoFile) {
			const errorMsg = `Cannot find or create Novel Info file for ${bookPath}`;
			Logger.warn(`[WritingJourneyService] ${errorMsg}`);
			throw new Error(errorMsg);
		}

		// 检查当前文件中是否已经存在 malformed 的写作历程
		const parseResult = await this.getJourneyLog(bookPath);
		if (parseResult.status === 'malformed') {
			const errorMsg = `Safe failure: Refusing to overwrite malformed journey log in ${infoFile.path}`;
			Logger.error(`[WritingJourneyService] ${errorMsg}`);
			throw new Error(errorMsg);
		}

		const finalEvents = [...events];
		const isFirstTracking = !parseResult.log || parseResult.log.events.length === 0;

		// 惰性启动逻辑：如果该作品历史上未记录过任何历程事件，且首个事件不是 work.created/work.imported，
		// 则补充 tracking.started 标记启用时机，绝不伪造虚假历史
		if (isFirstTracking) {
			const firstEvent = finalEvents[0];
			const firstType = firstEvent?.type;
			if (firstType !== 'work.created' && firstType !== 'work.imported' && firstType !== 'tracking.started') {
				finalEvents.unshift({
					id: this.generateEventId(),
					type: 'tracking.started',
					timestamp: firstEvent?.timestamp ?? new Date().toISOString()
				});
			}
		}

		try {
			await this.app.fileManager.processFrontMatter(infoFile, (fm: Record<string, unknown>) => {
				const currentRaw = fm[WRITING_JOURNEY_YAML_KEY];
				const currentParsed = parseWritingJourneyLog(currentRaw);
				if (currentParsed.status === 'malformed') {
					throw new Error('Refusing to overwrite malformed writing-journey log during processFrontMatter');
				}

				const existingEvents: WritingJourneyEvent[] = currentParsed.log?.events ? [...currentParsed.log.events] : [];
				const updatedLog: WritingJourneyLog = {
					version: WRITING_JOURNEY_SCHEMA_VERSION,
					events: [...existingEvents, ...finalEvents]
				};

				fm[WRITING_JOURNEY_YAML_KEY] = updatedLog;
			});

			this.app.workspace.trigger('webnovel-workbench-journey-updated', bookPath);
		} catch (writeErr) {
			Logger.error(`[WritingJourneyService] Failed to write journey log in ${infoFile.path}:`, writeErr);
			throw writeErr;
		}
	}

	// ── 语义事件记录方法 ──

	public async recordWorkCreated(bookPath: string, workTitle: string): Promise<void> {
		const event: WorkCreatedEvent = {
			id: this.generateEventId(),
			type: 'work.created',
			timestamp: new Date().toISOString(),
			workTitle
		};
		await this.appendEvent(bookPath, event);
	}

	public async recordWorkImported(bookPath: string, workTitle: string, chapterCount?: number): Promise<void> {
		const event: WorkImportedEvent = {
			id: this.generateEventId(),
			type: 'work.imported',
			timestamp: new Date().toISOString(),
			workTitle,
			chapterCount
		};
		await this.appendEvent(bookPath, event);
	}

	public async recordChapterCreated(
		bookPath: string,
		path: string,
		chapterTitle: string,
		source?: ChapterCreatedEvent['source']
	): Promise<void> {
		this.baselinePaths.add(path);
		const event: ChapterCreatedEvent = {
			id: this.generateEventId(),
			type: 'chapter.created',
			timestamp: new Date().toISOString(),
			path,
			chapterTitle,
			source
		};
		await this.appendEvent(bookPath, event);
	}

	public async recordChaptersCreated(
		bookPath: string,
		chapters: ReadonlyArray<{ path: string; chapterTitle: string; source?: ChapterCreatedEvent['source'] }>
	): Promise<void> {
		for (const chapter of chapters) {
			this.baselinePaths.add(chapter.path);
		}
		const events: ChapterCreatedEvent[] = chapters.map(chapter => ({
			id: this.generateEventId(),
			type: 'chapter.created',
			timestamp: new Date().toISOString(),
			...chapter
		}));
		await this.appendEvents(bookPath, events);
	}

	public async recordChapterRenamed(
		bookPath: string,
		oldPath: string,
		newPath: string,
		oldTitle: string,
		newTitle: string
	): Promise<void> {
		this.baselinePaths.delete(oldPath);
		this.baselinePaths.add(newPath);
		const event: ChapterRenamedEvent = {
			id: this.generateEventId(),
			type: 'chapter.renamed',
			timestamp: new Date().toISOString(),
			oldPath,
			newPath,
			oldTitle,
			newTitle
		};
		await this.appendEvent(bookPath, event);
	}

	public async recordChapterMoved(
		bookPath: string,
		oldPath: string,
		newPath: string,
		chapterTitle: string
	): Promise<void> {
		this.baselinePaths.delete(oldPath);
		this.baselinePaths.add(newPath);
		const event: ChapterMovedEvent = {
			id: this.generateEventId(),
			type: 'chapter.moved',
			timestamp: new Date().toISOString(),
			oldPath,
			newPath,
			chapterTitle
		};
		await this.appendEvent(bookPath, event);
	}

	public async recordChapterDeleted(bookPath: string, path: string, chapterTitle: string): Promise<void> {
		this.baselinePaths.delete(path);
		const event: ChapterDeletedEvent = {
			id: this.generateEventId(),
			type: 'chapter.deleted',
			timestamp: new Date().toISOString(),
			path,
			chapterTitle
		};
		await this.appendEvent(bookPath, event);
	}

	public async recordChapterStatusChanged(
		bookPath: string,
		path: string,
		chapterTitle: string,
		fromStatus: string,
		toStatus: string
	): Promise<void> {
		if (fromStatus === toStatus) return; // 相同状态选择作为无操作，不记入历史

		let wordCount: number | undefined;
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && typeof this.plugin.calculateAccurateWords === 'function') {
				const content = await this.app.vault.read(file);
				const count = this.plugin.calculateAccurateWords(content);
				if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
					wordCount = count;
				}
			}
		} catch (snapshotErr) {
			Logger.warn(`[WritingJourneyService] Failed to snapshot chapter word count for ${path}:`, snapshotErr);
		}

		const event: ChapterStatusChangedEvent = {
			id: this.generateEventId(),
			type: 'chapter.status_changed',
			timestamp: new Date().toISOString(),
			path,
			chapterTitle,
			fromStatus,
			toStatus
		};
		if (wordCount !== undefined) {
			event.wordCount = wordCount;
		}
		await this.appendEvent(bookPath, event);
	}

	public async recordWorkStatusChanged(
		bookPath: string,
		fromStatus: string,
		toStatus: string
	): Promise<void> {
		if (fromStatus === toStatus) return; // 相同状态选择作为无操作
		const event: WorkStatusChangedEvent = {
			id: this.generateEventId(),
			type: 'work.status_changed',
			timestamp: new Date().toISOString(),
			fromStatus,
			toStatus
		};
		await this.appendEvent(bookPath, event);
	}

	// ── Vault 文件事件协同与去重判断 ──

	public isExcludedDoc(fileOrPath: string | TFile): boolean {
		const filePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
		const basename = filePath.split('/').pop()?.replace(/\.md$/, '') || '';

		if (this.plugin.isPluginGeneratedFile(basename)) return true;

		const loreCandidates = getCandidateNames(this.plugin.settings.loreFolderName, 'loreFolderName');
		for (const lore of loreCandidates) {
			if (filePath.includes(`/${lore}/`) || filePath.startsWith(`${lore}/`)) return true;
		}

		const timelineCandidates = getCandidateNames(this.plugin.settings.timeline?.fileName, 'timelineFileName');
		if (timelineCandidates.has(basename)) return true;

		const foreshadowingCandidates = getCandidateNames(this.plugin.settings.foreshadowing?.fileName, 'foreshadowingFileName');
		if (foreshadowingCandidates.has(basename)) return true;

		const taskCandidates = getCandidateNames(this.plugin.settings.task?.fileName, 'taskFileName');
		if (taskCandidates.has(basename)) return true;

		const novelInfoCandidates = getCandidateNames(this.plugin.settings.novelInfo?.fileName, 'novelInfoFileName');
		if (novelInfoCandidates.has(basename)) return true;

		const homepagePath = this.plugin.settings.homepagePath || '创作主页.md';
		if (filePath === homepagePath || basename === '创作主页') return true;

		return false;
	}

	/**
	 * 检查指定章节路径在作品的写作历程日志中是否仍处于活跃（既有）状态。
	 * 通过按追加顺序回放已持久化的相关生命周期事件进行判定，防止重复记录。
	 */
	public async isChapterActiveInLog(bookPath: string, path: string): Promise<boolean> {
		const parseResult = await this.getJourneyLog(bookPath);
		if (parseResult.status !== 'valid' || !parseResult.log) {
			return false;
		}

		const activePaths = new Set<string>();
		for (const event of parseResult.log.events) {
			if (event.type === 'chapter.created') {
				activePaths.add(event.path);
			} else if (event.type === 'chapter.deleted') {
				activePaths.delete(event.path);
			} else if (event.type === 'chapter.renamed') {
				activePaths.delete(event.oldPath);
				activePaths.add(event.newPath);
			} else if (event.type === 'chapter.moved') {
				activePaths.delete(event.oldPath);
				activePaths.add(event.newPath);
			}
		}

		return activePaths.has(path);
	}

	public async handleVaultCreate(file: TFile): Promise<void> {
		if (this.consumeHandledCreate(file.path)) {
			this.baselinePaths.add(file.path);
			return;
		}
		if (this.baselinePaths.has(file.path)) return;
		if (file.extension !== 'md') return;
		if (!this.isReady) {
			this.baselinePaths.add(file.path);
			return;
		}
		if (this.isExcludedDoc(file)) {
			this.baselinePaths.add(file.path);
			return;
		}

		const bookRoot = findBookRoot(this.app, this.plugin, file, true);
		if (!bookRoot) {
			this.baselinePaths.add(file.path);
			return;
		}

		if (!this.plugin.cacheManager.isEligibleForChapterList(file)) {
			this.baselinePaths.add(file.path);
			return;
		}

		if (await this.isChapterActiveInLog(bookRoot, file.path)) {
			this.baselinePaths.add(file.path);
			return;
		}

		this.baselinePaths.add(file.path);
		await this.recordChapterCreated(bookRoot, file.path, file.basename, 'vault');
	}

	public async handleVaultRename(abstractFile: TAbstractFile, oldPath: string): Promise<void> {
		if (abstractFile instanceof TFolder) {
			this.renameBaselineFolder(oldPath, abstractFile.path);
			return;
		}
		if (!(abstractFile instanceof TFile) || abstractFile.extension !== 'md') return;
		this.baselinePaths.delete(oldPath);
		this.baselinePaths.add(abstractFile.path);
		if (this.consumeHandledRename(oldPath, abstractFile.path)) return;

		const isOldExcluded = this.isExcludedDoc(oldPath);
		const isNewExcluded = this.isExcludedDoc(abstractFile);
		if (isOldExcluded && isNewExcluded) return;

		const oldBookRoot = this.findBookRootFromPath(oldPath);
		const newBookRoot = findBookRoot(this.app, this.plugin, abstractFile, true);
		const oldBasename = oldPath.split('/').pop()?.replace(/\.md$/, '') || '';

		if (oldBookRoot && newBookRoot && oldBookRoot === newBookRoot) {
			if (!this.plugin.cacheManager.isEligibleForChapterList(abstractFile)) return;
			const oldParent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
			const newParent = abstractFile.path.includes('/') ? abstractFile.path.slice(0, abstractFile.path.lastIndexOf('/')) : '';
			if (oldParent !== newParent && oldBasename === abstractFile.basename) {
				await this.recordChapterMoved(newBookRoot, oldPath, abstractFile.path, abstractFile.basename);
			} else {
				await this.recordChapterRenamed(newBookRoot, oldPath, abstractFile.path, oldBasename, abstractFile.basename);
			}
		} else if (!oldBookRoot && newBookRoot) {
			// 从作品外移入作品内，等同于在作品内新建章节
			if (!this.plugin.cacheManager.isEligibleForChapterList(abstractFile)) return;
			await this.recordChapterCreated(newBookRoot, abstractFile.path, abstractFile.basename, 'vault');
		} else if (oldBookRoot && !newBookRoot) {
			// 移出作品，等同于从作品中删除
			await this.recordChapterDeleted(oldBookRoot, oldPath, oldBasename);
		} else if (oldBookRoot && newBookRoot && oldBookRoot !== newBookRoot) {
			// 跨作品移动：旧作品删除，新作品创建
			await this.recordChapterDeleted(oldBookRoot, oldPath, oldBasename);
			if (this.plugin.cacheManager.isEligibleForChapterList(abstractFile)) {
				await this.recordChapterCreated(newBookRoot, abstractFile.path, abstractFile.basename, 'vault');
			}
		}
	}

	public async handleVaultDelete(abstractFile: TAbstractFile): Promise<void> {
		if (abstractFile instanceof TFolder) {
			this.removeBaselineFolder(abstractFile.path);
			return;
		}
		if (!(abstractFile instanceof TFile) || abstractFile.extension !== 'md') return;
		this.baselinePaths.delete(abstractFile.path);
		if (this.consumeHandledDelete(abstractFile.path)) return;
		if (this.isExcludedDoc(abstractFile)) return;

		const bookRoot = this.findBookRootFromPath(abstractFile.path, abstractFile.parent);
		if (!bookRoot) return;

		await this.recordChapterDeleted(bookRoot, abstractFile.path, abstractFile.basename);
	}

	private findBookRootFromPath(filePath: string, parentFolder?: TFolder | null): string | null {
		if (parentFolder instanceof TFolder) {
			const root = findBookRoot(this.app, this.plugin, parentFolder, true);
			if (root) return root;
		}
		let currentPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
		while (currentPath) {
			const file = this.app.vault.getAbstractFileByPath(currentPath);
			if (file instanceof TFolder) {
				const root = findBookRoot(this.app, this.plugin, file, true);
				if (root) return root;
			}
			const nextSlash = currentPath.lastIndexOf('/');
			currentPath = nextSlash > 0 ? currentPath.substring(0, nextSlash) : '';
		}
		return null;
	}
}
