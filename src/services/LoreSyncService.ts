import type { TFile, MarkdownView } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';

export class LoreSyncService {
	private plugin: WebNovelAssistantPlugin;
	private isSyncing = false;
	private regexCache = new Map<string, { version: number, regex: RegExp }>();

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	public initialize(): void {
		// 监听编辑器内容变化
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('editor-change', (editor, info) => {
				if (this.isSyncing) return;
				const file = info.file;
				if (!file || file.extension !== 'md') return;
				
				// 仅在当前作品下处理
				const bookPath = this.plugin.characterManager.getBookPathForFile(file);
				if (!bookPath) return;
				
				// 排除设定文件本身，避免无限循环
				const parentPath = file.parent?.path || '';
				if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) return;

				this.plugin.adaptiveDebounceManager.debounceFixed(`lore-sync-${file.path}`, () => {
					void this.syncLoreForFile(file);
				}, 2000);
			})
		);

		// 监听文件打开，补全可能遗漏的同步
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
				if (this.isSyncing || !leaf) return;
				const view = leaf.view as MarkdownView;
				if (view.getViewType() !== 'markdown' || !view.file) return;
				
				const file = view.file;
				if (file.extension !== 'md') return;
				
				const bookPath = this.plugin.characterManager.getBookPathForFile(file);
				if (!bookPath) return;
				
				const parentPath = file.parent?.path || '';
				if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) return;

				this.plugin.adaptiveDebounceManager.debounceFixed(`lore-sync-${file.path}`, () => {
					void this.syncLoreForFile(file);
				}, 1000);
			})
		);
	}

	private async syncLoreForFile(file: TFile): Promise<void> {
		const bookPath = this.plugin.characterManager.getBookPathForFile(file);
		if (!bookPath) return;

		const loreNames = this.plugin.characterManager.getCharactersForBook(bookPath);
		if (!loreNames || loreNames.length === 0) return;

		const content = await this.plugin.app.vault.cachedRead(file);
		
		// 剥离 frontmatter
		let textToScan = content;
		const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
		if (match) {
			textToScan = content.substring(match[0].length);
		}

		const currentVersion = this.plugin.characterManager.cacheVersion;
		let cached = this.regexCache.get(bookPath);
		
		if (!cached || cached.version !== currentVersion) {
			const validNames = loreNames.filter(name => name.length >= 1);
			if (validNames.length > 0) {
				const escapedNames = validNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
				const megaRegex = new RegExp(`(${escapedNames.join('|')})`, 'g');
				cached = { version: currentVersion, regex: megaRegex };
				this.regexCache.set(bookPath, cached);
			} else {
				// Shouldn't happen, but just in case
				await this.updateFrontmatterLore(file, []);
				return;
			}
		}

		const megaRegex = cached.regex;
		megaRegex.lastIndex = 0;

		const matchCounts = new Map<string, number>();
		let regexMatch;
		while ((regexMatch = megaRegex.exec(textToScan)) !== null) {
			const foundName = regexMatch[1];
			matchCounts.set(foundName, (matchCounts.get(foundName) || 0) + 1);
		}

		const loreCounts = new Map<string, number>();
		for (const [name, count] of matchCounts.entries()) {
			const entry = this.plugin.characterManager.getCharacterFile(bookPath, name);
			if (entry) {
				const canonicalName = entry.heading;
				loreCounts.set(canonicalName, (loreCounts.get(canonicalName) || 0) + count);
			}
		}

		if (loreCounts.size === 0) {
			await this.updateFrontmatterLore(file, []);
			return;
		}

		// 组装 lore 数组： "名称×次数"
		const newLoreList = Array.from(loreCounts.entries())
			.sort((a, b) => b[1] - a[1]) // 按出现次数降序排列
			.map(([name, count]) => `${name}×${count}`);
			
		await this.updateFrontmatterLore(file, newLoreList);
	}

	private async updateFrontmatterLore(file: TFile, newLore: string[]): Promise<void> {
		this.isSyncing = true;
		try {
			await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				const existingLore = fm['lore'];
				
				// 对比是否一致
				let isSame = false;
				if (Array.isArray(existingLore) && existingLore.length === newLore.length) {
					const existingSet = new Set(existingLore);
					isSame = newLore.every(item => existingSet.has(item));
				} else if (!existingLore && newLore.length === 0) {
					isSame = true;
				}

				if (isSame) return; // 无变化，不触发写入

				if (newLore.length === 0) {
					delete fm['lore'];
				} else {
					fm['lore'] = newLore;
				}
			});
		} catch (err) {
			console.error(`[LoreSyncService] Failed to update lore for ${file.path}`, err);
		} finally {
			// 稍微延迟解除，防止连续触发
			window.setTimeout(() => {
				this.isSyncing = false;
			}, 500);
		}
	}
}
