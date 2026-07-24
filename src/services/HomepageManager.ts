import { Logger } from '../utils/Logger';
import { MarkdownView, type App } from 'obsidian';
import { TFile, normalizePath, TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { NovelMetadata, NovelFolderInfo } from '../types/homepage';
import { NOVEL_INFO_LABEL_MAP, NOVEL_STATUS_MAP, getNovelInfoLabel, getNovelStatusText, getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import { t } from '../i18n';

const DEFAULT_NOVEL_META: NovelMetadata = {
	name: '',
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

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
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
		const workspaceFolders = this.plugin.settings.workspaceFolders;

		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const folderPath of workspaceFolders) {
				const normalized = folderPath.replace(/^\/+|\/+$/g, '');
				const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
				if (abstractFile instanceof TFolder) {
					for (const child of abstractFile.children) {
						if (!(child instanceof TFolder)) continue;
						// 排除以 _ 或 . 开头的辅助文件夹
						if (child.name.startsWith('_') || child.name.startsWith('.')) continue;

						// 仅加载包含作品信息文件的目录（支持多语言文件名查找）
						if (!this.findNovelInfoFile(child.path)) continue;

						folders.push({
							folderPath: child.path,
							folderName: child.name,
							metadata: null,
							wordCount: this.plugin.cacheManager.getFolderWordCount(child.path) || 0,
						});
					}
				}
			}
		} else {
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				if (!(child instanceof TFolder)) continue;
				if (child.name.startsWith('_') || child.name.startsWith('.')) continue;

				// 仅加载包含作品信息文件的目录（支持多语言文件名查找）
				if (!this.findNovelInfoFile(child.path)) continue;

				folders.push({
					folderPath: child.path,
					folderName: child.name,
					metadata: null,
					wordCount: this.plugin.cacheManager.getFolderWordCount(child.path) || 0,
				});
			}
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
		const infoFile = this.findNovelInfoFile(folderPath);
		if (!infoFile) return null;

		const content = await this.app.vault.cachedRead(infoFile);
		return this.parseNovelInfoContent(content, folderPath);
	}

	// 解析 **label**：value Markdown 格式
	parseNovelInfoContent(content: string, folderPath?: string): NovelMetadata {
		const meta: NovelMetadata = {
			...DEFAULT_NOVEL_META,
			name: folderPath ? folderPath.split('/').pop() || folderPath : '',
		};

		const lines = content.split(/\r?\n/);
		for (const line of lines) {
			const match = line.match(/\*\*(.+?)\*\*[：:]\s*(.+)/);
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
		return file;
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

	refreshHomepageViews(): void {
		const homepagePath = this.getHomepageFilePath();

		// 1. 直接定位到主页的渲染根节点，进行局部重绘，避免整个视图闪烁
		const containerEls = activeDocument.querySelectorAll('.webnovel-homepage-root');
		if (containerEls.length > 0) {
			// 动态引入 HomepageRenderer 避免循环依赖
import('../ui/components/HomepageRenderer.js').then(async ({ HomepageRenderer }) => {
					const renderer = new HomepageRenderer(this.app, this.plugin);
					for (const el of Array.from(containerEls)) {
						await renderer.renderHomepage(el as HTMLElement);
					}
}).catch(err => Logger.error('[HomepageManager] refreshHomepageViews failed:', err));
		}

		// 2. 作为后备方案，仍然触发 previewMode 的 rerender
		this.app.workspace.iterateAllLeaves(leaf => {
			const view = leaf.view;
			if (view && view.getViewType() === 'markdown') {
				const mdView = view as MarkdownView;
				if (mdView?.file?.path === homepagePath && mdView?.previewMode) {
					// 传递 true 强制重新渲染代码块（如果 API 支持）
					mdView.previewMode.rerender(true);
				}
			}
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
			this.refreshHomepageViews();
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
}
