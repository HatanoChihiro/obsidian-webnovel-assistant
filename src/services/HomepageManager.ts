import { App, TFile, TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { NovelMetadata, NovelFolderInfo } from '../types/homepage';

const DEFAULT_NOVEL_META: NovelMetadata = {
	name: '',
	status: '连载中',
	synopsis: '',
	protagonist: '',
	wordGoal: 0,
	genre: '',
	startDate: '',
	endDate: '',
};

const META_LABELS: Record<string, string> = {
	'状态': 'status',
	'简介': 'synopsis',
	'主角': 'protagonist',
	'类型': 'genre',
	'目标字数': 'wordGoal',
	'开始日期': 'startDate',
	'完结日期': 'endDate',
};

export class HomepageManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	getHomepageFilePath(): string {
		// 用户自定义路径时直接使用
		if (this.plugin.settings.homepagePath) {
			return this.plugin.settings.homepagePath;
		}
		// 默认放在第一个工作区文件夹下
		const folders = this.plugin.settings.workspaceFolders;
		if (folders && folders.length > 0) {
			const first = folders[0].replace(/^\/+|\/+$/g, '');
			if (first) return `${first}/创作主页.md`;
		}
		return '创作主页.md';
	}

	getHomepageFile(): TFile | null {
		const path = this.getHomepageFilePath();
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	getNovelInfoFileName(): string {
		return this.plugin.settings.novelInfo?.fileName || '作品信息';
	}

	async ensureHomepageExists(): Promise<TFile> {
		const existing = this.getHomepageFile();
		if (existing) {
			const newContent = this.generateHomepageContent();
			const oldContent = await this.app.vault.cachedRead(existing);
			if (oldContent !== newContent) {
				await this.app.vault.modify(existing, newContent);
			}
			return existing;
		}

		try {
			const filePath = this.getHomepageFilePath();
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir) {
				try { await this.app.vault.createFolder(dir); } catch {} 
			}
			const content = this.generateHomepageContent();
			const file = await this.app.vault.create(filePath, content);
			console.debug('[HomepageManager] 创作主页文件已创建');
			return file;
		} catch (e) {
			const existing = this.getHomepageFile();
			if (existing) {
			const newContent = this.generateHomepageContent();
			const oldContent = await this.app.vault.cachedRead(existing);
			if (oldContent !== newContent) {
				await this.app.vault.modify(existing, newContent);
			}
			return existing;
		}
			throw e;
		}
	}

	async refreshHomepage(): Promise<void> {
		const file = this.getHomepageFile();
		if (!file) return;
		await this.app.vault.modify(file, this.generateHomepageContent());
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

						// 仅加载包含作品信息文件的目录
						const infoFilePath = `${child.path}/${this.getNovelInfoFileName()}.md`;
						if (!(this.app.vault.getAbstractFileByPath(infoFilePath) instanceof TFile)) continue;

						folders.push({
							folderPath: child.path,
							folderName: child.name,
							metadata: null,
							wordCount: this.plugin.cacheManager.getFolderWordCount(child.path),
						});
					}
				}
			}
		} else {
			const root = this.app.vault.getRoot();
			for (const child of root.children) {
				if (!(child instanceof TFolder)) continue;
				if (child.name.startsWith('_') || child.name.startsWith('.')) continue;

				// 仅加载包含作品信息文件的目录
				const infoFilePath = `${child.path}/${this.getNovelInfoFileName()}.md`;
				if (!(this.app.vault.getAbstractFileByPath(infoFilePath) instanceof TFile)) continue;

				folders.push({
					folderPath: child.path,
					folderName: child.name,
					metadata: null,
					wordCount: this.plugin.cacheManager.getFolderWordCount(child.path),
				});
			}
		}

		return folders;
	}

	findNovelInfoFile(folderPath: string): TFile | null {
		const fileName = this.getNovelInfoFileName();
		const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		return file instanceof TFile ? file : null;
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
			const key = META_LABELS[label];
			if (!key) continue;

			switch (key) {
				case 'status': meta.status = ['已完结', '已暂停', '存稿中'].includes(value) ? value as NovelMetadata['status'] : '连载中'; break;
				case 'wordGoal': meta.wordGoal = parseInt(value) || 0; break;
				default: (meta as any)[key] = value; break;
			}
		}

		return meta;
	}

	async createNovelInfoFile(folderPath: string, overrides?: Partial<NovelMetadata>): Promise<TFile> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			await this.app.vault.createFolder(folderPath);
		}

		const fileName = this.getNovelInfoFileName();
		const filePath = `${folderPath}/${fileName}.md`;

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) return existing;

		const today = new Date().toISOString().slice(0, 10);
		const folderName = folderPath.split('/').pop() || folderPath;
		const meta = { ...DEFAULT_NOVEL_META, name: folderName, startDate: today, ...overrides };

		const lines = [
			`**状态**：${meta.status}`,
			`**简介**：${meta.synopsis}`,
			`**主角**：${meta.protagonist}`,
			`**类型**：${meta.genre}`,
			`**目标字数**：${meta.wordGoal || ''}`,
			`**开始日期**：${meta.startDate}`,
			`**完结日期**：${meta.endDate || ''}`,
			'',
		];
		const file = await this.app.vault.create(filePath, lines.join('\n'));
		console.debug(`[HomepageManager] 已创建作品信息文件: ${filePath}`);
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
		const folderPath = parentFolder ? `${parentFolder}/${novelName}` : novelName;

		const infoFile = await this.createNovelInfoFile(folderPath, { name: novelName, ...overrides });

		await this.refreshHomepage();

		return { folderPath, infoFile };
	}

		async deleteHomepage(): Promise<void> {
		const file = this.getHomepageFile();
		if (file) {
			await this.app.vault.delete(file);
			console.debug('[HomepageManager] 创作主页文件已删除');
		}
	}

	async renameHomepageFile(oldPath: string, newPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(oldPath);
		if (file instanceof TFile) {
			await this.app.fileManager.renameFile(file, newPath);
			console.debug(`[HomepageManager] 创作主页已从 ${oldPath} 重命名为 ${newPath}`);
		} else {
			console.warn(`[HomepageManager] 找不到旧主页文件: ${oldPath}，将仅更新设置。`);
		}
	}

	refreshHomepageViews(): void {
		const homepagePath = this.getHomepageFilePath();

		// 1. 直接定位到主页的渲染根节点，进行局部重绘，避免整个视图闪烁
		const containerEls = document.querySelectorAll('.webnovel-homepage-root');
		if (containerEls.length > 0) {
			// 动态引入 HomepageRenderer 避免循环依赖
			import('./HomepageRenderer.js').then(({ HomepageRenderer }) => {
				const renderer = new HomepageRenderer(this.app, this.plugin);
				containerEls.forEach(el => {
					renderer.renderHomepage(el as HTMLElement);
				});
			});
		}

		// 2. 作为后备方案，仍然触发 previewMode 的 rerender
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			const view = leaf.view as any;
			if (view?.file?.path === homepagePath && view?.previewMode) {
				// 传递 true 强制重新渲染代码块（如果 API 支持）
				view.previewMode.rerender(true);
			}
		});
	}
}