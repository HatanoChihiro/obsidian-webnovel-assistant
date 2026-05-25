import { TFile, TFolder, Notice, MarkdownView } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { GoalModal } from '../ui/GoalModal';
import { copyDocumentContent } from '../utils/ui';
import { isDesktop } from '../utils/platform';
import { ChapterSorter } from '../services/ChapterSorter';
import { TimelineAddFromSelectionModal } from '../ui/TimelineView';
import { TimelineManager } from '../services/TimelineManager';
import { RankingManager } from '../services/RankingManager';
import { RankingAddModal } from '../ui/RankingModal';
import { NewNovelModal } from '../ui/NewNovelModal';

export class MenuManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	registerAllMenus() {
		this.plugin.registerEvent(this.plugin.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') {
				menu.addItem((item) => {
					item.setTitle('设定本章目标字数').setIcon('target').onClick(() => {
						new GoalModal(this.plugin.app, file).open();
					});
				});

				// 复制本文档：全平台均显示，内容包含「标题 + 空行 + 正文」
				menu.addItem((item) => {
					item.setTitle("复制本文档").setIcon("copy").onClick(async () => {
						copyDocumentContent(file.basename, await this.plugin.app.vault.read(file));
					});
				});

				// 抽出为便签：仅桌面端
				if (isDesktop()) {
					menu.addItem((item) => {
						item.setTitle('抽出为便签').setIcon('popup-open').onClick(() => {
							this.plugin.createStickyNote({ file: file }).catch(console.error);
						});
					});
				}
			}

			if (file instanceof TFolder && isDesktop()) {
				menu.addItem((item) => {
					item.setTitle('合并章节')
						.setIcon('documents')
						.onClick(() => this.handleMergeChapters(file));
				});
			}

			// 榜单追踪：文件和文件夹右键菜单
			if (file instanceof TFile || file instanceof TFolder) {
				menu.addItem((item) => {
					item.setTitle('开启榜单追踪').setIcon('trophy').onClick(() => {
						this.openRankingModal(file);
					});
				});
			}

			// 新建作品
			menu.addItem((item) => {
				item.setTitle('新建作品').setIcon('book-open').onClick(() => {
					new NewNovelModal(this.plugin.app, this.plugin, async (result) => {
						await this.plugin.homepageManager!.createNewNovel(result.name, result.meta);
						new Notice('[成功] 已创建作品: ' + result.name);
					}).open();
				});
			});
		}));

		this.plugin.registerEvent(this.plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (editor.somethingSelected()) {
					menu.addItem((item) => {
						item.setTitle('标注为伏笔').setIcon('bookmark').onClick(() => {
							this.plugin.app.commands.executeCommandById('web-novel-assistant:mark-as-foreshadowing');
						});
					});

					menu.addItem((item) => {
						item.setTitle('添加到时间线').setIcon('calendar-clock').onClick(async () => {
							const selectedText = editor.getSelection();
							if (!selectedText.trim()) {
								new Notice('请先选中文字');
								return;
							}

							const chapterName = view.file?.basename || '';
							const folderPath = view.file?.parent?.path || '';

							// 读取已有条目中的类型，传入 Modal 供选择
							const tlManager = new TimelineManager(this.plugin.app, this.plugin, folderPath);
							const tlFile = tlManager.getTimelineFile();
							const localTypes: string[] = [];
							if (tlFile) {
								const tlContent = await this.plugin.app.vault.read(tlFile);
								const tlEntries = tlManager.parseEntries(tlContent);
								localTypes.push(...new Set(tlEntries.map((e: any) => e.type).filter(Boolean)));
							}

							new TimelineAddFromSelectionModal(
								this.plugin.app,
								this.plugin,
								this.plugin.settings.timeline?.fileName || '时间线',
								selectedText.trim(),
								chapterName,
								folderPath,
								async (result) => {
									await new TimelineManager(this.plugin.app, this.plugin, folderPath).appendEntry({
										time: result.time,
										description: result.description,
										chapter: result.chapter,
										type: result.type,
										rawBlock: ''
									});
									new Notice('[成功] 已添加到时间线');

									// 刷新时间线视图
									const leaves = this.plugin.app.workspace.getLeavesOfType('timeline-view');
									if (leaves.length > 0) {
										await new Promise(resolve => setTimeout(resolve, 100)); // 给文件写入一点时间
										await leaves[0].view.refresh?.();
									}
								},
								localTypes
							).open();
						});
					});

					if (isDesktop()) {
						menu.addItem((item) => {
							item.setTitle('抽出为便签').setIcon('quote').onClick(() => {
								this.plugin.createStickyNote({ content: editor.getSelection(), title: '选中片段' }).catch(console.error);
							});
						});
					}
				}

				if (view.file) {
					menu.addItem((item) => {
						item.setTitle('设定本章目标字数').setIcon('target').onClick(() => {
							new GoalModal(this.plugin.app, view.file!).open();
						});
					});

					// 复制本文档：全平台均显示，内容包含「标题 + 空行 + 正文」
					menu.addItem((item) => {
						item.setTitle("复制本文档").setIcon("copy").onClick(async () => {
							copyDocumentContent(view.file!.basename, await this.plugin.app.vault.read(view.file!));
						});
					});

					if (isDesktop()) {
						menu.addItem((item) => {
							item.setTitle('当前文件抽出为便签').setIcon('popup-open').onClick(() => {
								this.plugin.createStickyNote({ file: view.file! }).catch(console.error);
							});
						});
					}

					// 榜单追踪
					menu.addItem((item) => {
						item.setTitle('开启榜单追踪').setIcon('trophy').onClick(() => {
							this.openRankingModal(view.file!);
						});
					});
				}
			}));
	}

	private openRankingModal(file: TFile | TFolder) {
		const folderPath = file instanceof TFile ? (file.parent?.path || '') : file.path;
		const manager = new RankingManager(this.plugin.app, this.plugin, folderPath);
		const rankingFile = manager.getRankingFile();

		if (!rankingFile) {
			// 首次新建
			new RankingAddModal(this.plugin.app, this.plugin, manager, 1, '', async (entry) => {
				await manager.addEntry(entry);
				new Notice('[成功] 已创建榜单追踪');
			}).open();
		} else {
			// 已有榜单记录，新增榜单
			manager.loadEntries().then(entries => {
				const nextPeriod = manager.getNextPeriod(entries || []);
				const lastPlatform = entries && entries.length > 0
					? entries[entries.length - 1].platform : '';
				new RankingAddModal(this.plugin.app, this.plugin, manager, nextPeriod, lastPlatform, async (entry) => {
					await manager.addEntry(entry);
					new Notice('[成功] 已新增榜单');
				}).open();
			});
		}
	}

	private async handleMergeChapters(file: TFolder) {
		const notice = new Notice(`正在扫描并合并${file.name}...`, 0);
		const mdFiles: TFile[] = [];

		const collectFiles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					if (ChapterSorter.isChapterFile(child.name)) {
						mdFiles.push(child);
					}
				} else if (child instanceof TFolder) {
					collectFiles(child);
				}
			}
		};
		collectFiles(file);

		if (mdFiles.length === 0) {
			notice.hide();
			new Notice(`文件夹${file.name}中没有找到章节文件`);
			return;
		}

		mdFiles.sort((a, b) => ChapterSorter.compareFiles(a, b));

		let mergedContent = `# 合并章节：${file.name}\n\n`;
		let totalWords = 0;

		for (const mdFile of mdFiles) {
			const content = await this.plugin.app.vault.cachedRead(mdFile);
			mergedContent += `\n\n## ${mdFile.basename}\n\n`;
			mergedContent += content;
			totalWords += this.plugin.calculateAccurateWords(content);
		}

		const exportPath = `${file.path}/${file.name}_合并章节.md`;

		const existingFile = this.plugin.app.vault.getAbstractFileByPath(exportPath) as TFile | null;

		try {
			let mergedFile: TFile;
			if (existingFile) {
				mergedFile = existingFile;
				await this.plugin.app.vault.modify(existingFile, mergedContent.trim());
			} else {
				mergedFile = await this.plugin.app.vault.create(exportPath, mergedContent.trim());
			}
			notice.hide();
			await this.plugin.app.workspace.getLeaf(false).openFile(mergedFile);
			const overwriteHint = existingFile ? '\n合并章节文件已存在，自动覆盖' : '';
			new Notice(`[成功] 合并成功！
	已合并 ${mdFiles.length} 个章节
	总计 ${totalWords.toLocaleString()} 字${overwriteHint}`, 8000);
		} catch (error) {
			console.error(error);
			notice.hide();
			new Notice('合并失败，请检查文件权限');
		}
	}
}