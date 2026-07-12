import type { App } from 'obsidian';
import { Notice, TFolder, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import { t } from '../../i18n';
import { RelationGraphManager } from '../../services/RelationGraphManager';
import type { GraphEdge } from '../../services/RelationGraphManager';

export interface LoreBoardOptions {
	app: App;
	plugin: WebNovelAssistantPlugin;
	container: HTMLElement;
	files: TFile[];
	currentBookPath: string;
}

export class LoreBoardRenderer {
	static async render(options: LoreBoardOptions): Promise<void> {
		const { app, plugin, container, files, currentBookPath } = options;
		const bookPath = currentBookPath === '/' ? '' : currentBookPath;

		// 聚合设定出现的次数和章节
		const loreToChapters = new Map<string, { chapter: TFile, count: number }[]>();
		
		await plugin.characterManager.ensureInitialized();
		const allCharacters = plugin.characterManager.getCharactersForBook(currentBookPath) || [];
		for (const key of allCharacters) {
			const entry = plugin.characterManager.getCharacterFile(currentBookPath, key);
			if (entry && entry.heading) {
				if (!loreToChapters.has(entry.heading)) {
					loreToChapters.set(entry.heading, []);
				}
			}
		}
		
		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			const loreArray = cache?.frontmatter?.lore as unknown;
			if (Array.isArray(loreArray)) {
				for (const item of loreArray) {
					if (typeof item === 'string') {
						// 格式 "名称×次数" 或单纯 "名称"
						const parts = item.split('×');
						const name = parts[0].trim();
						const count = parts.length > 1 ? parseInt(parts[1], 10) : 1;
						
						if (!loreToChapters.has(name)) {
							loreToChapters.set(name, []);
						}
						loreToChapters.get(name)!.push({ chapter: file, count: isNaN(count) ? 1 : count });
					}
				}
			}
		}
		
		if (loreToChapters.size === 0) {
			const emptyMsg = container.createDiv('wn-corkboard-empty-msg');
			emptyMsg.setCssStyles({
				color: 'var(--text-faint)',
				textAlign: 'center',
				padding: '40px 20px',
				fontStyle: 'italic'
			});
			emptyMsg.setText(t('corkboard.no-lore') || '当前还没有设定关联数据，请在正文中提及设定...');
			return;
		}

		// 提取所有显式关系
		let explicitEdges: GraphEdge[] = [];
		try {
			const loreFolderName = plugin.settings.loreFolderName || t('common.default-lore-folder-name');
			const lorePath = bookPath ? `${bookPath}/${loreFolderName}` : loreFolderName;
			const loreFolder = app.vault.getAbstractFileByPath(lorePath);
			if (loreFolder && loreFolder instanceof TFolder) {
				const findFirst = (f: TFolder): TFile | null => {
					for (const child of f.children) {
						if (child instanceof TFile && child.extension === 'md') return child;
						if (child instanceof TFolder) {
							const res = findFirst(child);
							if (res) return res;
						}
					}
					return null;
				}
				const sampleFile = findFirst(loreFolder);
				if (sampleFile) {
					const graphManager = new RelationGraphManager(app, plugin);
					const prevGlobal = plugin.settings.loreGraphEnableGlobal;
					plugin.settings.loreGraphEnableGlobal = true;
					const data = await graphManager.buildGraphData(sampleFile);
					plugin.settings.loreGraphEnableGlobal = prevGlobal;
					
					explicitEdges = data.edges.filter(e => e.type === 'explicit');
				}
			}
		} catch (e) {
			console.error(e);
		}
		
		const sortedLores = Array.from(loreToChapters.entries()).sort((a, b) => {
			const sumA = a[1].reduce((acc, curr) => acc + curr.count, 0);
			const sumB = b[1].reduce((acc, curr) => acc + curr.count, 0);
			return sumB - sumA;
		});
		
		const boardLayout = container.createDiv('wn-lore-board-layout');
		
		for (const [loreName, chapterList] of sortedLores) {
			const groupDiv = boardLayout.createDiv('wn-lore-board-group');
			
			const headerRow = groupDiv.createDiv('wn-lore-board-group-header');
			const totalCount = chapterList.reduce((acc, curr) => acc + curr.count, 0);
			
			const leftContainer = headerRow.createSpan('wn-lore-board-group-left');
			
			const titleSpan = leftContainer.createSpan('wn-lore-board-group-title');
			titleSpan.setText(loreName);
			
			// 点击可跳转到对应设定文件
			titleSpan.onclick = () => {
				if (currentBookPath !== null) {
					const entry = plugin.characterManager.getCharacterFile(currentBookPath, loreName);
					if (entry && entry.file) {
						void app.workspace.getLeaf(false).openFile(entry.file);
					} else {
						new Notice(t('corkboard.lore-not-found') || '找不到对应的设定文件');
					}
				}
			};
			
			const relationsSpan = leftContainer.createSpan('wn-lore-board-group-relations');
			const sourceEdges = explicitEdges.filter(e => e.source === loreName);
			if (sourceEdges.length > 0) {
				const groupedByLabel = new Map<string, string[]>();
				for (const edge of sourceEdges) {
					if (!groupedByLabel.has(edge.label)) groupedByLabel.set(edge.label, []);
					groupedByLabel.get(edge.label)!.push(edge.target);
				}
				for (const [label, targets] of groupedByLabel) {
					const item = relationsSpan.createDiv('wn-lore-board-relation-item');
					item.createSpan({ text: label, cls: 'wn-lore-board-relation-badge' });
					item.createSpan({ text: targets.join('、'), cls: 'wn-lore-board-relation-targets' });
				}
			}
			
			const countSpan = headerRow.createSpan('wn-lore-board-group-count');
			countSpan.setText(t('corkboard.lore-total-count', { count: totalCount.toString() }) || `共出现 ${totalCount} 次`);
			
			const cardsContainer = groupDiv.createDiv('wn-lore-board-cards');
			
			// 排序：按出现次数降序，相同次数按文件排序
			chapterList.sort((a, b) => b.count - a.count);
			
			for (const item of chapterList) {
				const miniCard = cardsContainer.createDiv('wn-lore-board-mini-card');
				miniCard.onclick = () => {
					void app.workspace.getLeaf(false).openFile(item.chapter);
				};
				
				miniCard.createDiv({ text: item.chapter.basename, cls: 'wn-lore-board-mini-card-title' });
				miniCard.createDiv({ text: `×${item.count}`, cls: 'wn-lore-board-mini-card-count' });
			}
		}
	}
}
