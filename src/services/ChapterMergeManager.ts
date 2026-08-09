import { TFile, type App, type TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from './ChapterSorter';
import { t } from '../i18n';

/**
 * 章节预览与合并条目数据结构
 */
export interface ChapterMergeItem {
	/** 章节 Markdown 文件句柄 */
	file: TFile;
	/** 所属卷名称（若无卷层级则为空字符串） */
	volumeName: string;
	/** 章节显示标题 (如 basename) */
	title: string;
	/** 保留的原 Frontmatter YAML 文本（含 --- 包裹） */
	frontmatter: string;
	/** 原始章节正文（已剥离 Frontmatter） */
	originalBody: string;
	/** 当前编辑后的章节正文 */
	currentBody: string;
	/** 本章修稿批注/标注文本 */
	annotation: string;
	/** 原始修稿批注/标注文本 */
	originalAnnotation: string;
	/** 是否已被修改 */
	isModified: boolean;
}

/**
 * 序列化的精准词句级修订数据
 */
export interface SerializedExplicitRevision {
	id: string;
	originalText: string;
	currentText: string;
	noteText: string;
	timestamp: number;
}

/**
 * 草稿缓存数据结构
 */
export interface ChapterMergeDraft {
	/** 对应小说/卷文件夹的路径 */
	folderPath: string;
	/** 保存草稿的时间戳 */
	timestamp: number;
	/** 各章节路径 -> 修改后的正文及批注映射 */
	items: Record<string, { currentBody: string; annotation: string }>;
	/** 各章节路径 -> 精准词句级修订卡片记录 */
	revisions?: Record<string, SerializedExplicitRevision[]>;
}

/**
 * 章节合并与原稿预览服务管理器 (ChapterMergeManager)
 *
 * 【架构设计意图】
 * 负责无缝解析指定小说目录下的所有章节文件，分离 Frontmatter 与正文，
 * 并提供写回原笔记文件、导出一体化合并文档以及内存/LocalStorage 草稿安全暂存恢复能力。
 * 将纯业务数据逻辑与 UI Modal 彻底解耦，遵循 ServiceRegistry 依赖注入机制。
 */
export class ChapterMergeManager {
	private plugin: WebNovelAssistantPlugin;
	private app: App;
	/** 内存中存储的草稿缓存 (folderPath -> Draft) */
	private draftMap: Map<string, ChapterMergeDraft> = new Map();
	/** 专属于当前 Vault 插件配置目录下的持久化草稿文件名 */
	private readonly DRAFT_FILE_NAME = 'merge-drafts.json';

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		void this.loadDraftsFromStorage();
	}

	private getDraftFilePath(): string {
		const dir = this.plugin.manifest.dir || `.obsidian/plugins/${this.plugin.manifest.id}`;
		return `${dir}/${this.DRAFT_FILE_NAME}`;
	}

	/**
	 * 从 Vault Adapter 中载入持久化草稿（支持跨 Obsidian 软件重启无损恢复，100% 符合 Obsidian 审查标准）
	 */
	private async loadDraftsFromStorage(): Promise<void> {
		try {
			const path = this.getDraftFilePath();
			if (!(await this.app.vault.adapter.exists(path))) return;
			const raw = await this.app.vault.adapter.read(path);
			if (!raw) return;
			const data = JSON.parse(raw) as Record<string, ChapterMergeDraft>;
			if (data && typeof data === 'object') {
				this.draftMap.clear();
				for (const [folderPath, draft] of Object.entries(data)) {
					this.draftMap.set(folderPath, draft);
				}
			}
		} catch (err) {
			window.console.error('Failed to load merge drafts from vault adapter:', err);
		}
	}

	/**
	 * 将当前草稿映射表同步持久化写入 Vault Adapter
	 */
	private async saveDraftsToStorage(): Promise<void> {
		try {
			const path = this.getDraftFilePath();
			if (this.draftMap.size === 0) {
				if (await this.app.vault.adapter.exists(path)) {
					await this.app.vault.adapter.remove(path);
				}
				return;
			}
			const obj: Record<string, ChapterMergeDraft> = {};
			for (const [folderPath, draft] of this.draftMap.entries()) {
				obj[folderPath] = draft;
			}
			await this.app.vault.adapter.write(path, JSON.stringify(obj, null, 2));
		} catch (err) {
			window.console.error('Failed to save merge drafts to vault adapter:', err);
		}
	}

	/**
	 * 加载指定文件夹下按章节顺序排列的所有章节合并条目
	 * @param folder 目标小说或卷文件夹
	 */
	public async loadFolderChapters(folder: TFolder): Promise<ChapterMergeItem[]> {
		const mdFiles = ChapterSorter.getAllChapters(this.app, this.plugin, folder.path);
		const items: ChapterMergeItem[] = [];

		for (const mdFile of mdFiles) {
			const inVolume = mdFile.parent && mdFile.parent.path !== folder.path;
			const volumeName = inVolume ? mdFile.parent!.name : '';

			const fullContent = await this.app.vault.cachedRead(mdFile);
			const { frontmatter, body } = this.splitFrontmatter(fullContent);

			items.push({
				file: mdFile,
				volumeName,
				title: mdFile.basename,
				frontmatter,
				originalBody: body,
				currentBody: body,
				annotation: '',
				originalAnnotation: '',
				isModified: false
			});
		}

		return items;
	}

	/**
	 * 将编辑与批注内容安全应用（覆盖）至各 Markdown 原文件
	 * 【安全考量】严格保留文件原有的 Frontmatter 元数据，仅覆盖正文，防止破坏 YAML 结构
	 * @param items 章节条目列表
	 * @returns 成功更新的文件数量
	 */
	public async saveToOriginalFiles(items: ChapterMergeItem[]): Promise<number> {
		let updatedCount = 0;

		for (const item of items) {
			if (!item.isModified) continue;

			let finalContent = item.frontmatter ? `${item.frontmatter}\n` : '';
			finalContent += item.currentBody.trim();

			await this.app.vault.modify(item.file, finalContent);
			
			// 重置状态
			item.originalBody = item.currentBody;
			item.originalAnnotation = item.annotation;
			item.isModified = false;
			updatedCount++;
		}

		return updatedCount;
	}

	/**
	 * 将所有章节导出为单个完整的合并文档（仅导出正文，不包含批注）
	 * @param folder 目标文件夹
	 * @param items 章节条目列表
	 * @param includeTitles 是否合并文档标题（默认 true）
	 */
	public async exportMergedDocument(
		folder: TFolder,
		items: ChapterMergeItem[],
		includeTitles: boolean = true
	): Promise<{ file: TFile; wordCount: number }> {
		let mergedContent = includeTitles ? `# ${folder.name}` : '';
		let currentVolume = '';

		for (const item of items) {
			if (includeTitles) {
				if (item.volumeName && item.volumeName !== currentVolume) {
					currentVolume = item.volumeName;
					mergedContent += mergedContent ? `\n\n## ${currentVolume}` : `## ${currentVolume}`;
				} else if (!item.volumeName && currentVolume !== '') {
					currentVolume = '';
				}

				const chapterHeading = item.volumeName ? '###' : '##';
				mergedContent += mergedContent ? `\n\n${chapterHeading} ${item.title}\n\n` : `${chapterHeading} ${item.title}\n\n`;
			} else {
				if (mergedContent) {
					mergedContent += '\n\n';
				}
			}

			mergedContent += item.currentBody.trim();
		}

		const exportPath = `${folder.path}/${folder.name}_${t('merge.filename-suffix')}.md`;
		const existingFile = this.app.vault.getAbstractFileByPath(exportPath);

		const finalTrimmedContent = mergedContent.trim();
		let mergedFile: TFile;
		if (existingFile && existingFile instanceof TFile) {
			mergedFile = existingFile;
			await this.app.vault.modify(existingFile, finalTrimmedContent);
		} else {
			mergedFile = await this.app.vault.create(exportPath, finalTrimmedContent);
		}

		const wordCount = this.plugin.calculateAccurateWords(finalTrimmedContent);
		return { file: mergedFile, wordCount };
	}

	/**
	 * 暂存未应用的修改草稿（含正文修改与精准词句级修订批注卡片，自动写入 LocalStorage 持久化）
	 */
	public saveDraft(
		folderPath: string,
		items: ChapterMergeItem[],
		revisionsMap?: Map<string, Array<{ id: string; originalText: string; currentText: string; noteText: string; timestamp: number }>>
	): void {
		const modifiedItems: Record<string, { currentBody: string; annotation: string }> = {};
		const serializedRevisions: Record<string, SerializedExplicitRevision[]> = {};
		let hasChanges = false;

		for (const item of items) {
			if (item.isModified) {
				modifiedItems[item.file.path] = {
					currentBody: item.currentBody,
					annotation: item.annotation
				};
				hasChanges = true;
			}
		}

		if (revisionsMap) {
			for (const [filePath, revs] of revisionsMap.entries()) {
				if (revs && revs.length > 0) {
					serializedRevisions[filePath] = revs.map(r => ({
						id: r.id,
						originalText: r.originalText,
						currentText: r.currentText,
						noteText: r.noteText,
						timestamp: r.timestamp
					}));
					hasChanges = true;
				}
			}
		}

		if (!hasChanges) {
			this.clearDraft(folderPath);
			return;
		}

		const draft: ChapterMergeDraft = {
			folderPath,
			timestamp: Date.now(),
			items: modifiedItems,
			revisions: serializedRevisions
		};

		this.draftMap.set(folderPath, draft);
		void this.saveDraftsToStorage();
	}

	/**
	 * 加载未应用的草稿（优先取内存，支持从 Vault Adapter 持久化还原）
	 */
	public async loadDraft(folderPath: string): Promise<ChapterMergeDraft | null> {
		if (this.draftMap.size === 0) {
			await this.loadDraftsFromStorage();
		}
		return this.draftMap.get(folderPath) || null;
	}

	/**
	 * 清除指定文件夹的草稿缓存（同时同步清理 Vault Adapter 存储文件）
	 */
	public clearDraft(folderPath: string): void {
		this.draftMap.delete(folderPath);
		void this.saveDraftsToStorage();
	}

	/**
	 * 辅助工具：剥离 Frontmatter 并返回 YAML 部分与正文部分
	 */
	private splitFrontmatter(content: string): { frontmatter: string; body: string } {
		const match = content.match(/^(---\r?\n[\s\S]*?\r?\n---)(\r?\n[\s\S]*)?$/);
		if (match) {
			return {
				frontmatter: match[1],
				body: (match[2] || '').trim()
			};
		}
		return {
			frontmatter: '',
			body: content.trim()
		};
	}
}
