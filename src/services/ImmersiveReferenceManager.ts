import type { App, EventRef, TAbstractFile } from 'obsidian';
import { TFile } from 'obsidian';
import type { Destroyable } from '../core/ServiceRegistry';
import type { AccurateCountSettings } from '../types/settings';
import type { SettingsManager } from '../core/SettingsManager';
import { findBookRoot, type FindBookRootPlugin } from '../utils/path';
import { Logger } from '../utils/Logger';

export type ImmersiveReferenceManagerSettings = Pick<
	AccurateCountSettings,
	'immersive' | 'workspaceFolders' | 'loreFolderName' | 'timeline' | 'foreshadowing' | 'novelInfo'
>;

export interface ImmersiveReferenceManagerPlugin extends FindBookRootPlugin {
	settings: ImmersiveReferenceManagerSettings;
	saveSettings(): Promise<void>;
	settingsManager: Pick<SettingsManager, 'flush'>;
}

function normalizeFolderPath(path: string): string {
	if (!path || path === '/') return '';
	return path.replace(/^\/+|\/+$/g, '');
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

/**
 * 沉浸模式参考文档状态服务
 * 负责各作品独立参考记忆、向后兼容迁移、重命名/删除联动与即时持久化
 */
export class ImmersiveReferenceManager implements Destroyable {
	private app: App;
	private plugin: ImmersiveReferenceManagerPlugin;
	private eventRefs: EventRef[] = [];
	private isDestroyed = false;
	private savePromise: Promise<void> | null = null;

	constructor(app: App, plugin: ImmersiveReferenceManagerPlugin) {
		this.app = app;
		this.plugin = plugin;

		if (app?.vault && typeof app.vault.on === 'function') {
			this.eventRefs.push(
				app.vault.on('rename', (file, oldPath) => {
					void this.handleRename(file, oldPath);
				}),
				app.vault.on('delete', (file) => {
					void this.handleDelete(file);
				})
			);
		}
	}

	/**
	 * 从主编辑器文件解析归属的作品根目录完整路径（全库/非作品返回空字符串）
	 */
	public getWorkPath(file: TFile | null): string {
		if (!file) return '';
		const root = findBookRoot(this.app, this.plugin, file, true);
		return normalizeFolderPath(root);
	}

	/**
	 * 获取指定作品或全局回退的记忆参考文档路径
	 * 若记录的文件在 Vault 中已不存在，安全清空失效记录并保存，不抛出异常并保留其他作品数据
	 */
	public getReferenceFilePath(workPath: string): string | null {
		if (this.isDestroyed) return null;
		const immersive = this.plugin.settings.immersive;
		if (!immersive.workReferencePaths) {
			immersive.workReferencePaths = {};
		}

		const normWork = normalizeFolderPath(workPath);
		if (normWork) {
			const refPath = Object.prototype.hasOwnProperty.call(immersive.workReferencePaths, normWork) ? immersive.workReferencePaths[normWork] : undefined;
			if (typeof refPath !== 'string' || !refPath) return null;

			const file = this.app.vault?.getAbstractFileByPath?.(refPath);
			if (file instanceof TFile && file.extension === 'md') {
				return refPath;
			}

			// 丢失或非 Markdown 文件在恢复时返回空并失效本条记录，保护其他作品不受影响
			delete immersive.workReferencePaths[normWork];
			void this.save();
			return null;
		}

		// 普通非作品文档回退至历史全局记录
		const legacy = immersive.lastReferenceFilePath;
		if (!legacy) return null;
		const file = this.app.vault?.getAbstractFileByPath?.(legacy);
		if (file instanceof TFile && file.extension === 'md') {
			return legacy;
		}
		return null;
	}

	/**
	 * 旧版本设置向后兼容迁移：
	 * 仅在 legacy file 确属当前作品时赋初值；不广播至其他作品，不覆盖既有映射，保留不可归属数据
	 */
	public migrateLegacyReference(mainFile: TFile | null): void {
		if (this.isDestroyed) return;
		const immersive = this.plugin.settings.immersive;
		if (!immersive.workReferencePaths) {
			immersive.workReferencePaths = {};
		}
		const legacyPath = immersive.lastReferenceFilePath;
		if (!legacyPath) return;

		const currentWork = this.getWorkPath(mainFile);
		if (!currentWork) return;

		// 只迁移旧版本尚未建立作品映射的数据，不能将新版本的跨作品参考再次当作旧数据。
		if (Object.keys(immersive.workReferencePaths).length > 0) return;
		const legacyFile = this.app.vault.getAbstractFileByPath(legacyPath);
		if (legacyFile instanceof TFile && legacyFile.extension === 'md' && this.getWorkPath(legacyFile) === currentWork) {
			immersive.workReferencePaths = { [currentWork]: legacyPath };
			void this.save();
		}
	}

	/**
	 * 记录并即时持久化作品与参考文档的关联
	 */
	public async setReferenceFilePath(workPath: string, refPath: string | null): Promise<void> {
		if (this.isDestroyed) return;
		const immersive = this.plugin.settings.immersive;
		if (!immersive.workReferencePaths) {
			immersive.workReferencePaths = {};
		}

		const normWork = normalizeFolderPath(workPath);
		if (normWork) {
			if (Object.prototype.hasOwnProperty.call(immersive.workReferencePaths, normWork) && immersive.workReferencePaths[normWork] === refPath) return;
			if (refPath) {
				immersive.workReferencePaths = { ...immersive.workReferencePaths, [normWork]: refPath };
				immersive.lastReferenceFilePath = refPath;
			} else {
				delete immersive.workReferencePaths[normWork];
			}
		} else {
			if (immersive.lastReferenceFilePath === refPath) return;
			if (refPath) {
				immersive.lastReferenceFilePath = refPath;
			} else {
				delete immersive.lastReferenceFilePath;
			}
		}

		await this.save();
	}

	/**
	 * 联动处理文件或文件夹重命名/移动（严格按路径前缀边界）
	 */
	public async handleRename(abstractFile: TAbstractFile, oldPath: string): Promise<void> {
		if (this.isDestroyed) return;
		const immersive = this.plugin.settings.immersive;

		let hasChanges = false;
		if (immersive.workReferencePaths) {
			const newWorkMap: Record<string, string> = {};

			for (const [workKey, refVal] of Object.entries(immersive.workReferencePaths)) {
				let updatedKey = workKey;
				let updatedVal = refVal;

				if (matchesPathPrefix(workKey, oldPath)) {
					updatedKey = replacePathPrefix(workKey, oldPath, abstractFile.path);
					hasChanges = true;
				}
				if (matchesPathPrefix(refVal, oldPath)) {
					updatedVal = replacePathPrefix(refVal, oldPath, abstractFile.path);
					hasChanges = true;
				}
				newWorkMap[updatedKey] = updatedVal;
			}

			if (hasChanges) {
				immersive.workReferencePaths = newWorkMap;
			}
		}

		if (immersive.lastReferenceFilePath && matchesPathPrefix(immersive.lastReferenceFilePath, oldPath)) {
			immersive.lastReferenceFilePath = replacePathPrefix(immersive.lastReferenceFilePath, oldPath, abstractFile.path);
			hasChanges = true;
		}

		if (hasChanges) {
			await this.save();
		}
	}

	/**
	 * 联动处理文件或文件夹删除
	 */
	public async handleDelete(abstractFile: TAbstractFile): Promise<void> {
		if (this.isDestroyed) return;
		const immersive = this.plugin.settings.immersive;

		let hasChanges = false;
		if (immersive.workReferencePaths) {
			const newWorkMap: Record<string, string> = {};

			for (const [workKey, refVal] of Object.entries(immersive.workReferencePaths)) {
				if (matchesPathPrefix(workKey, abstractFile.path) || matchesPathPrefix(refVal, abstractFile.path)) {
					hasChanges = true;
					continue;
				}
				newWorkMap[workKey] = refVal;
			}

			if (hasChanges) {
				immersive.workReferencePaths = newWorkMap;
			}
		}

		if (immersive.lastReferenceFilePath && matchesPathPrefix(immersive.lastReferenceFilePath, abstractFile.path)) {
			delete immersive.lastReferenceFilePath;
			hasChanges = true;
		}

		if (hasChanges) {
			await this.save();
		}
	}

	public async save(): Promise<void> {
		if (this.isDestroyed) return;
		const executeSave = async () => {
			try {
				await this.plugin.saveSettings();
				await this.plugin.settingsManager.flush();
			} catch (err) {
				Logger.warn('[ImmersiveReferenceManager] 保存参考文档状态失败:', err);
			}
		};
		this.savePromise = executeSave();
		await this.savePromise;
	}

	public async flush(): Promise<void> {
		if (this.savePromise) {
			await this.savePromise;
		}
		await this.plugin.settingsManager.flush();
	}

	public async destroy(): Promise<void> {
		this.isDestroyed = true;
		for (const ref of this.eventRefs) {
			if (this.app?.vault && typeof this.app.vault.offref === 'function') {
				this.app.vault.offref(ref);
			}
		}
		this.eventRefs = [];
		await this.flush();
	}
}
