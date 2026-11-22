import type { App, EventRef, TAbstractFile, TFolder } from 'obsidian';
import { TFile, TFolder as TFolderClass } from 'obsidian';
import type { Destroyable } from '../core/ServiceRegistry';
import type { SettingsManager } from '../core/SettingsManager';
import { getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import type { AccurateCountSettings, PersistedManuscriptPosition } from '../types/settings';
import { getDeterministicChapterDisplayOrder } from '../utils/chapterDisplayOrder';
import { Logger } from '../utils/Logger';
import { findBookRoot, getCurrentBookContext, type CurrentBookContextPlugin } from '../utils/path';
import { ChapterSorter } from './ChapterSorter';

export type ImmersiveManuscriptManagerSettings = Pick<
	AccurateCountSettings,
	| 'immersive'
	| 'workspaceFolders'
	| 'strictChapterExceptions'
	| 'loreFolderName'
	| 'timeline'
	| 'foreshadowing'
	| 'novelInfo'
	| 'homepagePath'
	| 'enableSmartChapterSort'
	| 'customSortOrder'
	| 'proofreading'
>;

export interface ImmersiveManuscriptManagerPlugin extends Omit<CurrentBookContextPlugin, 'settings'> {
	settings: ImmersiveManuscriptManagerSettings;
	saveSettings(): Promise<void>;
	settingsManager: Pick<SettingsManager, 'flush'>;
	isFileInWorkspace?: (file: TFile) => boolean;
	isFileInStrictChapterException?: (file: TFile) => boolean;
	isPluginGeneratedFile?: (basename: string) => boolean;
}

export interface ResolvedManuscriptTarget {
	file: TFile;
	position?: PersistedManuscriptPosition;
}

function normalizeFolderPath(path: string): string {
	if (!path || path === '/') return '';
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function isSafeRelativeVaultPath(rawPath: string): boolean {
	if (!rawPath || rawPath.includes('\0')) return false;
	const slashNormalized = rawPath.replace(/\\/g, '/');
	if (!slashNormalized) return false;
	if (/^[a-zA-Z]:/.test(slashNormalized)) return false;
	if (slashNormalized.startsWith('/')) return false;
	const segments = slashNormalized.split('/');
	return !segments.some(seg => seg === '..' || seg === '.');
}

function normalizeSafeFilePath(rawPath: unknown): string | null {
	if (typeof rawPath !== 'string') return null;
	if (!isSafeRelativeVaultPath(rawPath)) return null;
	const cleaned = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
	if (!cleaned || !/\.md$/i.test(cleaned)) return null;
	return cleaned;
}

function normalizeSafeWorkPath(rawPath: unknown): string {
	if (typeof rawPath !== 'string') return '';
	if (!rawPath || rawPath === '/') return '';
	if (!isSafeRelativeVaultPath(rawPath)) return '';
	return normalizeFolderPath(rawPath);
}

function sanitizeNonNegativeInt(value: unknown, fallback = 0): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

function sanitizeNonNegativeFloat(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
	return Math.round(value * 100) / 100;
}

function sanitizeFiniteFloat(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return Math.round(value * 100) / 100;
}

export function sanitizeManuscriptPosition(raw: unknown): PersistedManuscriptPosition | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const candidate = raw as Record<string, unknown>;
	const filePath = normalizeSafeFilePath(candidate.filePath);
	if (!filePath) return undefined;

	const workPath = normalizeSafeWorkPath(candidate.workPath);
	const cursorLine = sanitizeNonNegativeInt(candidate.cursorLine, 0);
	const cursorCh = sanitizeNonNegativeInt(candidate.cursorCh, 0);
	const chapterRelativeScroll = sanitizeNonNegativeFloat(candidate.chapterRelativeScroll);
	const anchorLine = typeof candidate.anchorLine === 'number' && Number.isFinite(candidate.anchorLine) && candidate.anchorLine >= 0
		? Math.floor(candidate.anchorLine)
		: undefined;
	const viewportFilePath = normalizeSafeFilePath(candidate.viewportFilePath) ?? undefined;
	const viewportLine = typeof candidate.viewportLine === 'number' && Number.isFinite(candidate.viewportLine) && candidate.viewportLine >= 0
		? Math.floor(candidate.viewportLine)
		: undefined;
	const viewportLineOffset = sanitizeFiniteFloat(candidate.viewportLineOffset);

	const sanitized: PersistedManuscriptPosition = {
		filePath,
		workPath,
		cursorLine,
		cursorCh
	};
	if (chapterRelativeScroll !== undefined) {
		sanitized.chapterRelativeScroll = chapterRelativeScroll;
	}
	if (anchorLine !== undefined) {
		sanitized.anchorLine = anchorLine;
	}
	if (viewportFilePath) {
		sanitized.viewportFilePath = viewportFilePath;
		if (viewportLine !== undefined) {
			sanitized.viewportLine = viewportLine;
		}
		if (viewportLineOffset !== undefined) {
			sanitized.viewportLineOffset = viewportLineOffset;
		}
	}
	return sanitized;
}

export function sanitizeWorkManuscriptPositions(raw: unknown): Record<string, PersistedManuscriptPosition> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const result = Object.create(null) as Record<string, PersistedManuscriptPosition>;
	for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
		const normKey = normalizeSafeWorkPath(rawKey);
		if (!normKey) continue;
		const sanitized = sanitizeManuscriptPosition(rawVal);
		if (!sanitized) continue;
		result[normKey] = {
			...sanitized,
			workPath: normKey
		};
	}
	return result;
}

function matchesPathPrefix(fullPath: string, targetPath: string): boolean {
	const normFull = normalizeFolderPath(fullPath);
	const normTarget = normalizeFolderPath(targetPath);
	if (!normTarget) return false;
	return normFull === normTarget || normFull.startsWith(normTarget + '/');
}

function replacePathPrefix(fullPath: string, oldPath: string, newPath: string): string {
	const normFull = normalizeFolderPath(fullPath);
	const normOld = normalizeFolderPath(oldPath);
	const normNew = normalizeFolderPath(newPath);
	if (normFull === normOld) {
		return normNew;
	}
	if (normFull.startsWith(normOld + '/')) {
		const suffix = normFull.substring(normOld.length + 1);
		return normNew ? `${normNew}/${suffix}` : suffix;
	}
	return fullPath;
}

function collectDirectMarkdownFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	const children = (folder as unknown as { children?: TAbstractFile[] }).children;
	if (!Array.isArray(children)) return files;
	for (const child of children) {
		if (child instanceof TFile && child.extension === 'md') {
			files.push(child);
		}
	}
	return files;
}

function collectMarkdownFilesInFolder(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	const visited = new Set<TFolder>();
	const stack: TFolder[] = [folder];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (visited.has(current)) continue;
		visited.add(current);
		const children = (current as unknown as { children?: TAbstractFile[] }).children;
		if (!Array.isArray(children)) continue;
		for (const child of children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			} else if (child instanceof TFolderClass) {
				stack.push(child);
			}
		}
	}
	return files;
}

/**
 * 沉浸原稿模式业务服务
 * 负责章节白名单校验、作品范围与确定性排序、位置记忆校验/持久化及文件改名删除联动
 */
export class ImmersiveManuscriptManager implements Destroyable {
	private app: App;
	private plugin: ImmersiveManuscriptManagerPlugin;
	private eventRefs: EventRef[] = [];
	private isShuttingDown = false;
	private isDestroyed = false;
	private dirtyPositionSave = false;
	private savePending = false;
	private savePromise: Promise<void> | null = null;
	private destroyPromise: Promise<void> | null = null;

	constructor(app: App, plugin: ImmersiveManuscriptManagerPlugin) {
		this.app = app;
		this.plugin = plugin;

		if (app?.vault && typeof app.vault.on === 'function') {
			this.eventRefs.push(
				app.vault.on('rename', (file, oldPath) => {
					void this.handleRename(file, oldPath).catch((err) => {
						Logger.error('[ImmersiveManuscriptManager] 重命名同步原稿位置失败:', err);
					});
				}),
				app.vault.on('delete', (file) => {
					void this.handleDelete(file).catch((err) => {
						Logger.error('[ImmersiveManuscriptManager] 删除同步原稿位置失败:', err);
					});
				})
			);
		}
	}

	/**
	 * 校验文件是否允许作为沉浸原稿模式主编辑区章节：
	 * 仅接受符合章节命名规则或位于显式严格例外目录的章节文档，并无条件排除功能文档与设定/词典。
	 */
	public isEligibleManuscriptChapter(file: TFile | null): boolean {
		if (!(file instanceof TFile) || file.extension !== 'md') return false;

		if (!this.isInsideWorkspace(file)) return false;

		if (this.isFunctionalOrExcludedFile(file)) return false;

		return ChapterSorter.isChapterFile(file.name) || this.isInsideStrictException(file);
	}

	private isInsideWorkspace(file: TFile): boolean {
		if (typeof this.plugin.isFileInWorkspace === 'function') {
			return this.plugin.isFileInWorkspace(file);
		}
		const folders = this.plugin.settings.workspaceFolders || [];
		if (folders.length === 0) return true;
		return folders.some(folder => {
			const norm = normalizeFolderPath(folder);
			if (!norm) return true;
			return file.path === `${norm}.md` || file.path.startsWith(`${norm}/`);
		});
	}

	private isInsideStrictException(file: TFile): boolean {
		if (typeof this.plugin.isFileInStrictChapterException === 'function') {
			return this.plugin.isFileInStrictChapterException(file);
		}
		const exceptions = this.plugin.settings.strictChapterExceptions || [];
		if (exceptions.length === 0) return false;
		return exceptions.some(folder => {
			const norm = normalizeFolderPath(folder);
			if (!norm) return false;
			return file.path === `${norm}.md` || file.path.startsWith(`${norm}/`);
		});
	}

	private isFunctionalOrExcludedFile(file: TFile): boolean {
		if (file.basename.includes('_合并章节')) return true;
		if (typeof this.plugin.isPluginGeneratedFile === 'function' && this.plugin.isPluginGeneratedFile(file.basename)) {
			return true;
		}
		if (ChapterSorter.isFunctionalDoc(file, {
			settings: {
				homepagePath: this.plugin.settings.homepagePath || '创作主页.md',
				loreFolderName: this.plugin.settings.loreFolderName,
				enableStrictChapterMode: true,
				customSortOrder: this.plugin.settings.customSortOrder || {}
			},
			getVaultMarkdownFiles: () => [],
			getTrackedMarkdownFiles: () => [],
			isFileInStrictChapterException: (target) => this.isInsideStrictException(target),
			isPluginGeneratedFile: (basename) => Boolean(this.plugin.isPluginGeneratedFile?.(basename)),
			homepageManager: this.plugin.homepageManager?.getHomepageFilePath
				? { getHomepageFilePath: () => this.plugin.homepageManager!.getHomepageFilePath!() }
				: null
		})) {
			return true;
		}

		// 检查校对词典目录
		const dictPaths = new Set<string>(['校对词典', 'Proofreading Dictionaries']);
		const rawDictPath = this.plugin.settings.proofreading?.dictionaryPath
			? normalizeFolderPath(this.plugin.settings.proofreading.dictionaryPath)
			: '';
		if (rawDictPath) dictPaths.add(rawDictPath);

		const lastSlash = file.path.lastIndexOf('/');
		if (lastSlash !== -1) {
			const parentPath = file.path.slice(0, lastSlash);
			const segments = parentPath.split('/');
			for (const dictPath of dictPaths) {
				if (!dictPath) continue;
				if (dictPath.includes('/')) {
					if (parentPath === dictPath || parentPath.startsWith(`${dictPath}/`)) return true;
				} else if (segments.includes(dictPath)) {
					return true;
				}
			}
		}

		// 检查多语言设定目录兜底
		const loreCandidates = new Set<string>();
		if (this.plugin.settings.loreFolderName) loreCandidates.add(this.plugin.settings.loreFolderName);
		loreCandidates.add(getDefaultFileName('loreFolderName'));
		for (const name of getDefaultFileNameCandidates('loreFolderName')) loreCandidates.add(name);
		for (const lore of loreCandidates) {
			if (file.path.includes(`/${lore}/`) || file.path.startsWith(`${lore}/`)) return true;
		}

		return false;
	}

	/**
	 * 获取文件所属作品范围（优先严格作品根目录，无地标时回退直接父目录）
	 */
	public getWorkPath(file: TFile | null): string {
		if (!file) return '';
		const strictRoot = normalizeFolderPath(findBookRoot(this.app, this.plugin, file, true));
		if (strictRoot) return strictRoot;
		if (file.parent && !file.parent.isRoot()) {
			return normalizeFolderPath(file.parent.path);
		}
		return '';
	}

	/**
	 * 解析文件所属的目录范围（优先严格作品根，无地标时回退所在文件夹）
	 */
	public resolveScopeFolder(file: TFile): { folder: TFolder; folderPath: string; workPath: string } | null {
		const strictRoot = normalizeFolderPath(findBookRoot(this.app, this.plugin, file, true));
		if (strictRoot) {
			const rootFolder = this.app.vault.getAbstractFileByPath(strictRoot);
			if (rootFolder instanceof TFolderClass) {
				return { folder: rootFolder, folderPath: strictRoot, workPath: strictRoot };
			}
		}

		const fallbackFolder = file.parent ?? this.app.vault.getRoot?.();
		if (!(fallbackFolder instanceof TFolderClass)) return null;
		const folderPath = fallbackFolder.isRoot() ? '/' : fallbackFolder.path;
		const workPath = fallbackFolder.isRoot() ? '' : normalizeFolderPath(fallbackFolder.path);
		return { folder: fallbackFolder, folderPath, workPath };
	}

	/**
	 * 按作品范围与既有确定性顺序获取全部有效原稿章节（不进行全库扫描）
	 */
	public getBookChaptersForFile(file: TFile): TFile[] {
		const scope = this.resolveScopeFolder(file);
		if (!scope) return [];
		return this.getBookChaptersInFolder(scope.folder, scope.folderPath);
	}

	public getBookChaptersForWorkPath(workPath: string): TFile[] {
		const normWork = normalizeFolderPath(workPath);
		if (!normWork) return [];
		const folder = this.app.vault.getAbstractFileByPath(normWork);
		if (!(folder instanceof TFolderClass)) return [];
		return this.getBookChaptersInFolder(folder, normWork);
	}

	private getBookChaptersInFolder(folder: TFolder, folderPath: string): TFile[] {
		const isRootScope = folder.isRoot() || folderPath === '/' || folderPath === '';
		const rawFiles = isRootScope
			? collectDirectMarkdownFiles(folder)
			: collectMarkdownFilesInFolder(folder);
		const eligible = rawFiles.filter(f => this.isEligibleManuscriptChapter(f));
		const currentBookPath = folderPath === '/' ? '' : folderPath;

		return getDeterministicChapterDisplayOrder(eligible, {
			currentBookPath,
			isDescending: false,
			enableSmartChapterSort: Boolean(this.plugin.settings.enableSmartChapterSort),
			customSortOrder: this.plugin.settings.customSortOrder || {}
		});
	}

	private sanitizeViewportFields(position: PersistedManuscriptPosition): { position: PersistedManuscriptPosition; mutated: boolean } {
		if (!position.viewportFilePath) return { position, mutated: false };
		const absViewport = this.app.vault?.getAbstractFileByPath?.(position.viewportFilePath);
		if (absViewport instanceof TFile && this.isEligibleManuscriptChapter(absViewport)) {
			return { position, mutated: false };
		}
		const cleaned: PersistedManuscriptPosition = { ...position };
		delete cleaned.viewportFilePath;
		delete cleaned.viewportLine;
		delete cleaned.viewportLineOffset;
		return { position: cleaned, mutated: true };
	}

	private persistCleanupInBackground(): void {
		this.dirtyPositionSave = true;
		void this.save().catch((err) => {
			Logger.warn('[ImmersiveManuscriptManager] 清理失效原稿位置失败:', err);
		});
	}

	/**
	 * 验证并读取指定作品记住的最后原稿位置
	 */
	public getValidatedPositionForWork(workPath: string): ResolvedManuscriptTarget | null {
		if (this.isDestroyed) return null;
		const normWork = normalizeSafeWorkPath(workPath);
		if (!normWork) return null;
		const immersive = this.plugin.settings.immersive;
		const map = immersive.workManuscriptPositions;
		if (!map || !Object.prototype.hasOwnProperty.call(map, normWork)) return null;

		const sanitized = sanitizeManuscriptPosition(map[normWork]);
		if (!sanitized) {
			delete map[normWork];
			this.persistCleanupInBackground();
			return null;
		}

		const abs = this.app.vault?.getAbstractFileByPath?.(sanitized.filePath);
		if (abs instanceof TFile && this.isEligibleManuscriptChapter(abs)) {
			const actualWork = this.getWorkPath(abs);
			if (!actualWork || actualWork === normWork || matchesPathPrefix(abs.path, normWork)) {
				const { position: cleaned, mutated } = this.sanitizeViewportFields(sanitized);
				if (mutated) {
					map[normWork] = cleaned;
					this.persistCleanupInBackground();
				}
				return { file: abs, position: cleaned };
			}
		}

		delete map[normWork];
		this.persistCleanupInBackground();
		return null;
	}

	/**
	 * 验证并读取全局最后有效原稿位置
	 */
	public getValidatedLastPosition(): ResolvedManuscriptTarget | null {
		if (this.isDestroyed) return null;
		const immersive = this.plugin.settings.immersive;
		const sanitized = sanitizeManuscriptPosition(immersive.lastManuscriptPosition);
		if (!sanitized) {
			if (immersive.lastManuscriptPosition !== undefined) {
				delete immersive.lastManuscriptPosition;
				this.persistCleanupInBackground();
			}
			return null;
		}

		const abs = this.app.vault?.getAbstractFileByPath?.(sanitized.filePath);
		if (abs instanceof TFile && this.isEligibleManuscriptChapter(abs)) {
			const { position: cleaned, mutated } = this.sanitizeViewportFields(sanitized);
			if (mutated) {
				immersive.lastManuscriptPosition = cleaned;
				this.persistCleanupInBackground();
			}
			return { file: abs, position: cleaned };
		}

		delete immersive.lastManuscriptPosition;
		this.persistCleanupInBackground();
		return null;
	}

	/**
	 * 进入原稿模式时解析目标章节与位置（优先恢复已记忆位置，仅在无有效记忆时冷回退到首章，不扫描全库、不弹选章器）
	 */
	public resolveEntryTarget(currentFile: TFile | null): ResolvedManuscriptTarget | null {
		if (this.isDestroyed) return null;

		if (currentFile && this.isEligibleManuscriptChapter(currentFile)) {
			return { file: currentFile };
		}

		const strictWork = currentFile
			? normalizeFolderPath(findBookRoot(this.app, this.plugin, currentFile, true))
			: '';

		// 1. 当前非章节所属已知作品的记忆位置（仅已记忆位置，尚不回退到首章）
		if (strictWork) {
			const workTarget = this.getValidatedPositionForWork(strictWork);
			if (workTarget) return workTarget;
		}

		// 2. 全局记忆的最后有效原稿位置（优先于其他作品的首章回退）
		const lastTarget = this.getValidatedLastPosition();
		if (lastTarget) return lastTarget;

		// 3. 已知活动作品上下文的记忆位置
		const activeContext = getCurrentBookContext(this.app, this.plugin, {
			fallback: false,
			preferStatusViewContext: true
		});
		if (activeContext) {
			const contextTarget = this.getValidatedPositionForWork(activeContext);
			if (contextTarget) return contextTarget;
		}

		// 4. 其他持久化作品映射中的记忆位置
		const workMap = this.plugin.settings.immersive.workManuscriptPositions || {};
		for (const workKey of Object.keys(workMap)) {
			const resolved = this.getValidatedPositionForWork(workKey);
			if (resolved) return resolved;
		}

		// 5. 无任何有效记忆状态时，按已知范围冷回退到首篇有效章节（不扫描全库）
		if (strictWork) {
			const firstInWork = this.resolveFirstChapterInWork(strictWork);
			if (firstInWork) return firstInWork;
		}
		if (activeContext) {
			const firstInContext = this.resolveFirstChapterInWork(activeContext);
			if (firstInContext) return firstInContext;
		}
		for (const workKey of Object.keys(workMap)) {
			const firstInMapWork = this.resolveFirstChapterInWork(workKey);
			if (firstInMapWork) return firstInMapWork;
		}

		return null;
	}

	/**
	 * 主编辑器在原稿模式下被外部打开非章节时的自动恢复目标
	 */
	public resolveNonChapterFallback(preferredWorkPath?: string): ResolvedManuscriptTarget | null {
		if (this.isDestroyed) return null;

		const lastTarget = this.getValidatedLastPosition();
		if (lastTarget) return lastTarget;

		if (preferredWorkPath) {
			const workTarget = this.getValidatedPositionForWork(preferredWorkPath)
				?? this.resolveFirstChapterInWork(preferredWorkPath);
			if (workTarget) return workTarget;
		}

		const workMap = this.plugin.settings.immersive.workManuscriptPositions || {};
		for (const workKey of Object.keys(workMap)) {
			const resolved = this.getValidatedPositionForWork(workKey)
				?? this.resolveFirstChapterInWork(workKey);
			if (resolved) return resolved;
		}

		return null;
	}

	private resolveFirstChapterInWork(workPath: string): ResolvedManuscriptTarget | null {
		const chapters = this.getBookChaptersForWorkPath(workPath);
		if (chapters.length === 0) return null;
		return { file: chapters[0] };
	}

	/**
	 * 记录并持久化有效的原稿位置（仅接受已验证的真实章节）
	 */
	public async recordValidPosition(position: PersistedManuscriptPosition, persistImmediately = false): Promise<void> {
		if (this.isDestroyed || this.isShuttingDown) return;
		const sanitized = sanitizeManuscriptPosition(position);
		if (!sanitized) return;

		const abs = this.app.vault?.getAbstractFileByPath?.(sanitized.filePath);
		if (!(abs instanceof TFile) || !this.isEligibleManuscriptChapter(abs)) {
			return;
		}

		const derivedWork = this.getWorkPath(abs);
		const finalPosition: PersistedManuscriptPosition = {
			...sanitized,
			workPath: sanitized.workPath || derivedWork
		};
		const { position: verifiedPosition } = this.sanitizeViewportFields(finalPosition);

		const immersive = this.plugin.settings.immersive;
		immersive.lastManuscriptPosition = verifiedPosition;
		if (!immersive.workManuscriptPositions) {
			immersive.workManuscriptPositions = {};
		}
		if (verifiedPosition.workPath) {
			Object.defineProperty(immersive.workManuscriptPositions, verifiedPosition.workPath, {
				value: verifiedPosition, enumerable: true, configurable: true, writable: true
			});
		}
		this.dirtyPositionSave = true;

		if (persistImmediately) {
			await this.save();
		}
	}

	private remapPositionOnRename(
		pos: PersistedManuscriptPosition,
		oldPath: string,
		newPath: string,
		forcedWorkKey?: string
	): { updated: PersistedManuscriptPosition | undefined; changed: boolean } {
		let updatedFile = pos.filePath;
		let updatedWork = pos.workPath;
		let updatedViewport = pos.viewportFilePath;
		let changed = false;

		if (matchesPathPrefix(pos.filePath, oldPath)) {
			updatedFile = replacePathPrefix(pos.filePath, oldPath, newPath);
			changed = true;
		}
		if (pos.workPath && matchesPathPrefix(pos.workPath, oldPath)) {
			updatedWork = normalizeFolderPath(replacePathPrefix(pos.workPath, oldPath, newPath));
			changed = true;
		}
		if (pos.viewportFilePath && matchesPathPrefix(pos.viewportFilePath, oldPath)) {
			updatedViewport = replacePathPrefix(pos.viewportFilePath, oldPath, newPath);
			changed = true;
		}

		const sanitized = sanitizeManuscriptPosition({
			...pos,
			filePath: updatedFile,
			workPath: forcedWorkKey ?? updatedWork,
			viewportFilePath: updatedViewport
		});
		return { updated: sanitized, changed };
	}

	public async handleRename(abstractFile: TAbstractFile, oldPath: string): Promise<void> {
		if (this.isDestroyed || this.isShuttingDown) return;
		const immersive = this.plugin.settings.immersive;
		let hasChanges = false;

		if (immersive.workManuscriptPositions) {
			const nextMap = Object.create(null) as Record<string, PersistedManuscriptPosition>;
			for (const [workKey, pos] of Object.entries(immersive.workManuscriptPositions)) {
				let updatedKey = workKey;
				if (matchesPathPrefix(workKey, oldPath)) {
					updatedKey = normalizeFolderPath(replacePathPrefix(workKey, oldPath, abstractFile.path));
					hasChanges = true;
				}
				const remapped = this.remapPositionOnRename(
					pos,
					oldPath,
					abstractFile.path,
					updatedKey || pos.workPath
				);
				if (remapped.changed) {
					hasChanges = true;
				}
				if (remapped.updated && updatedKey) {
					nextMap[updatedKey] = { ...remapped.updated, workPath: updatedKey };
				}
			}
			if (hasChanges) {
				immersive.workManuscriptPositions = nextMap;
			}
		}

		if (immersive.lastManuscriptPosition) {
			const remapped = this.remapPositionOnRename(
				immersive.lastManuscriptPosition,
				oldPath,
				abstractFile.path
			);
			if (remapped.changed) {
				if (remapped.updated) {
					immersive.lastManuscriptPosition = remapped.updated;
				} else {
					delete immersive.lastManuscriptPosition;
				}
				hasChanges = true;
			}
		}

		if (hasChanges) {
			await this.save();
		}
	}

	public async handleDelete(abstractFile: TAbstractFile): Promise<void> {
		if (this.isDestroyed || this.isShuttingDown) return;
		const immersive = this.plugin.settings.immersive;
		let hasChanges = false;

		if (immersive.workManuscriptPositions) {
			const nextMap = Object.create(null) as Record<string, PersistedManuscriptPosition>;
			for (const [workKey, pos] of Object.entries(immersive.workManuscriptPositions)) {
				if (matchesPathPrefix(workKey, abstractFile.path) || matchesPathPrefix(pos.filePath, abstractFile.path)) {
					hasChanges = true;
					continue;
				}
				if (pos.viewportFilePath && matchesPathPrefix(pos.viewportFilePath, abstractFile.path)) {
					const cleaned: PersistedManuscriptPosition = { ...pos };
					delete cleaned.viewportFilePath;
					delete cleaned.viewportLine;
					delete cleaned.viewportLineOffset;
					nextMap[workKey] = cleaned;
					hasChanges = true;
					continue;
				}
				nextMap[workKey] = pos;
			}
			if (hasChanges) {
				immersive.workManuscriptPositions = nextMap;
			}
		}

		if (immersive.lastManuscriptPosition) {
			const pos = immersive.lastManuscriptPosition;
			if (
				matchesPathPrefix(pos.filePath, abstractFile.path) ||
				(pos.workPath && matchesPathPrefix(pos.workPath, abstractFile.path))
			) {
				delete immersive.lastManuscriptPosition;
				hasChanges = true;
			} else if (pos.viewportFilePath && matchesPathPrefix(pos.viewportFilePath, abstractFile.path)) {
				const cleaned: PersistedManuscriptPosition = { ...pos };
				delete cleaned.viewportFilePath;
				delete cleaned.viewportLine;
				delete cleaned.viewportLineOffset;
				immersive.lastManuscriptPosition = cleaned;
				hasChanges = true;
			}
		}

		if (hasChanges) {
			await this.save();
		}
	}

	public async save(): Promise<void> {
		if (this.isDestroyed) return;
		this.savePending = true;
		if (!this.savePromise) {
			this.savePromise = (async () => {
				while (this.savePending && !this.isDestroyed) {
					this.savePending = false;
					this.dirtyPositionSave = false;
					await this.plugin.saveSettings();
					await this.plugin.settingsManager.flush();
				}
			})().finally(() => {
				this.savePromise = null;
			});
		}
		await this.savePromise;
	}

	public async flush(): Promise<void> {
		if (this.isDestroyed) return;
		if (this.dirtyPositionSave || this.savePending || this.savePromise) {
			await this.save();
			return;
		}
		await this.plugin.settingsManager.flush();
	}

	public destroy(): Promise<void> {
		if (this.destroyPromise) {
			return this.destroyPromise;
		}
		this.isShuttingDown = true;
		if (this.app?.vault && typeof this.app.vault.offref === 'function') {
			for (const ref of this.eventRefs) {
				this.app.vault.offref(ref);
			}
		}
		this.eventRefs = [];

		this.destroyPromise = (async () => {
			try {
				await this.flush();
			} finally {
				this.isDestroyed = true;
			}
		})();
		return this.destroyPromise;
	}
}
