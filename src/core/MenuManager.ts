import { TFile, TFolder, Notice, MarkdownView } from 'obsidian';
import type AccurateChineseCountPlugin from '../../main';
import { GoalModal } from '../ui/GoalModal';
import { ChapterSorter } from '../services/ChapterSorter';
import { TimelineAddFromSelectionModal } from '../ui/TimelineView';
import { TimelineManager } from '../services/TimelineManager';

export class MenuManager {
	private plugin: AccurateChineseCountPlugin;

	constructor(plugin: AccurateChineseCountPlugin) {
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
					item.setTitle('复制本文档').setIcon('copy').onClick(async () => {
						try {
							const rawContent = await this.plugin.app.vault.read(file);
							const title = file.basename;
							const contentWithTitle = `${title}\n\n${rawContent}`;
							await navigator.clipboard.writeText(contentWithTitle);
							new Notice(`[成功] 已复制本文档`);
						} catch (err) {
							console.error('[Plugin] 复制失败:', err);
							new Notice('[错误] 复制失败，请重试');
						}
					});
				});

				// 抽出为便签：仅桌面端
				if (this.plugin.app.isMobile === false) {
					menu.addItem((item) => {
						item.setTitle('抽出为便签').setIcon('popup-open').onClick(() => { 
							this.plugin.createStickyNote({ file: file });
						});
					});
				}
			}

			if (file instanceof TFolder && this.plugin.app.isMobile === false) {
				menu.addItem((item) => {
					item.setTitle('合并章节')
						.setIcon('documents')
						.onClick(() => this.handleMergeChapters(file));
				});
			}
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
									await (leaves[0].view as any).refresh();
								}
							}
						).open();
					});
				});

				if (this.plugin.app.isMobile === false) {
					menu.addItem((item) => {
						item.setTitle('抽出为便签').setIcon('quote').onClick(() => { 
							this.plugin.createStickyNote({ content: editor.getSelection(), title: '选中片段' });
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
					item.setTitle('复制本文档').setIcon('copy').onClick(async () => {
						try {
							const rawContent = await this.plugin.app.vault.read(view.file!);
							const title = view.file!.basename;
							const contentWithTitle = `${title}\n\n${rawContent}`;
							await navigator.clipboard.writeText(contentWithTitle);
							new Notice(`[成功] 已复制本文档`);
						} catch (err) {
							console.error('[Plugin] 复制失败:', err);
							new Notice('[错误] 复制失败，请重试');
						}
					});
				});

				if (this.plugin.app.isMobile === false) {
					menu.addItem((item) => {
						item.setTitle('当前文件抽出为便签').setIcon('popup-open').onClick(() => { 
							this.plugin.createStickyNote({ file: view.file! });
						});
					});
				}
			}
		}));
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

		let exportPath = `${file.parent?.path === '/' ? '' : file.parent?.path + '/'}${file.name}_合并章节.md`;
		let counter = 1;
		while (this.plugin.app.vault.getAbstractFileByPath(exportPath)) {
			exportPath = `${file.parent?.path === '/' ? '' : file.parent?.path + '/'}${file.name}_合并章节(${counter}).md`;
			counter++;
		}

		try {
			const newFile = await this.plugin.app.vault.create(exportPath, mergedContent.trim());
			notice.hide();
			await this.plugin.app.workspace.getLeaf(false).openFile(newFile);
			new Notice(`[成功] 合并成功！\n已合并 ${mdFiles.length} 个章节\n总计 ${totalWords.toLocaleString()} 字`, 8000);
		} catch (error) {
			console.error(error);
			notice.hide();
			new Notice("合并失败，请检查文件权限");
		}
	}
}
