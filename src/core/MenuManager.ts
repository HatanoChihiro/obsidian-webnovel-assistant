import { TFile, TFolder, Notice } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { GoalModal } from '../ui/GoalModal';
import { copyDocumentContent } from '../utils/ui';
import { isDesktop } from '../utils/platform';
import { ChapterSorter } from '../services/ChapterSorter';
import { TimelineAddModal } from '../ui/TimelineView';
import type { TimelineEntry } from '../services/TimelineManager';
import { TimelineManager } from '../services/TimelineManager';
import { TaskManager } from '../services/TaskManager';
import { TaskAddModal } from '../ui/TaskModal';
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
					item.setTitle(t('menu.set-chapter-goal')).setIcon('target').onClick(() => {
						new GoalModal(this.plugin.app, file).open();
					});
				});

				// 复制本文档：全平台均显示，内容包含「标题 + 空行 + 正文」
				menu.addItem((item) => {
					item.setTitle(t('menu.copy-document')).setIcon("copy").onClick(() => {
						void (async () => {
							try {
								const content = await this.plugin.app.vault.read(file);
								await copyDocumentContent(file.basename, content);
							} catch (e) {
								console.error(e);
							}
						})();
					});
				});

				// 抽出为便签：仅桌面端
				if (isDesktop()) {
					menu.addItem((item) => {
						item.setTitle(t('menu.extract-sticky-note')).setIcon('popup-open').onClick(() => {
							this.plugin.createStickyNote({ file: file }).catch(console.error);
						});
					});
				}
			}

			if (file instanceof TFolder && isDesktop()) {
				menu.addItem((item) => {
					item.setTitle(t('menu.merge-chapters'))
						.setIcon('documents')
						.onClick(() => { this.handleMergeChapters(file).catch(console.error); });
				});
			}

			// 限时任务：文件和文件夹右键菜单
			if (file instanceof TFile || file instanceof TFolder) {
				menu.addItem((item) => {
					item.setTitle(t('menu.start-task-tracking')).setIcon('trophy').onClick(() => {
						this.openTaskModal(file);
					});
				});
			}

			// 新建作品
			menu.addItem((item) => {
				item.setTitle(t('menu.create-novel')).setIcon('book-open').onClick(() => {
					new NewNovelModal(this.plugin.app, this.plugin, (result) => {
						void (async () => {
							try {
								await this.plugin.homepageManager!.createNewNovel(result.name, result.meta);
								new Notice(t('notice.novel-created', { name: result.name }));
							} catch (e) {
								console.error(e);
							}
						})();
					}).open();
				});
			});
		}));

		this.plugin.registerEvent(this.plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (editor.somethingSelected()) {
					menu.addItem((item) => {
						item.setTitle(t('menu.mark-as-foreshadowing')).setIcon('bookmark').onClick(() => {
							this.plugin.app.commands.executeCommandById('web-novel-assistant:mark-as-foreshadowing');
						});
					});

					menu.addItem((item) => {
						item.setTitle(t('menu.add-to-timeline')).setIcon('calendar-clock').onClick(() => { (async () => {
							const selectedText = editor.getSelection();
							if (!selectedText.trim()) {
								new Notice(t('notice.select-text-first'));
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
								localTypes.push(...new Set(tlEntries.map((e: TimelineEntry) => e.type).filter(Boolean)));
							}

							new TimelineAddModal(
								this.plugin.app,
								this.plugin,
								selectedText.trim(),
								chapterName,
								folderPath,
								(result) => {
									new TimelineManager(this.plugin.app, this.plugin, folderPath).appendEntry({
										time: result.time,
										description: result.description,
										chapter: result.chapter,
										type: result.type,
										rawBlock: ''
									}).then(async () => {
									new Notice(t('notice.timeline-added'));

									// 刷新时间线视图
									const leaves = this.plugin.app.workspace.getLeavesOfType('timeline-view');
									if (leaves.length > 0) {
										await new Promise(resolve => window.setTimeout(resolve, 100)); // 给文件写入一点时间
										const refreshPromise = leaves[0].view.refresh?.();
										if (refreshPromise instanceof Promise) {
											await refreshPromise;
										}
									}
								}).catch(console.error);
							},
								false, localTypes).open();
						})().catch(console.error);});
					});

					if (isDesktop()) {
						menu.addItem((item) => {
							item.setTitle(t('menu.extract-sticky-note')).setIcon('quote').onClick(() => {
								this.plugin.createStickyNote({ content: editor.getSelection(), title: t('notice.selected-segment') }).catch(console.error);
							});
						});
					}
				}

				if (view.file) {
					menu.addItem((item) => {
						item.setTitle(t('menu.set-chapter-goal')).setIcon('target').onClick(() => {
							new GoalModal(this.plugin.app, view.file!).open();
						});
					});

					// 复制本文档：全平台均显示，内容包含「标题 + 空行 + 正文」
					menu.addItem((item) => {
						item.setTitle(t('menu.copy-document')).setIcon("copy").onClick(() => { (async () => {
							await copyDocumentContent(view.file!.basename, await this.plugin.app.vault.read(view.file!));
						})().catch(console.error);});
					});

					if (isDesktop()) {
						menu.addItem((item) => {
							item.setTitle(t('menu.current-file-extract-note')).setIcon('popup-open').onClick(() => {
								this.plugin.createStickyNote({ file: view.file! }).catch(console.error);
							});
						});
					}

					// 限时任务追踪
					menu.addItem((item) => {
						item.setTitle(t('menu.start-task-tracking')).setIcon('trophy').onClick(() => {
							this.openTaskModal(view.file!);
						});
					});
				}
			}));
	}

	private openTaskModal(file: TFile | TFolder) {
		const folderPath = file instanceof TFile ? (file.parent?.path || '') : file.path;
		const manager = new TaskManager(this.plugin.app, this.plugin, folderPath);
		const taskFile = manager.getTaskFile();

		if (!taskFile) {
			// 首次新建
			new TaskAddModal(this.plugin.app, this.plugin, manager, 1, '', async (entry) => {
				await manager.addEntry(entry);
				new Notice(t('notice.task-created'));
			}).open();
		} else {
			// 已有任务记录，新增任务
			manager.loadEntries().then(entries => {
				const nextPeriod = manager.getNextPeriod(entries || []);
				const lastPlatform = entries && entries.length > 0
					? entries[entries.length - 1].platform : '';
				new TaskAddModal(this.plugin.app, this.plugin, manager, nextPeriod, lastPlatform, async (entry) => {
					await manager.addEntry(entry);
					new Notice(t('notice.task-added'));
				}).open();
			}).catch(console.error);
		}
	}

	private async handleMergeChapters(file: TFolder) {
		const notice = new Notice(t('notice.merging-folder', { name: file.name }), 0);
		const mdFiles: TFile[] = [];

		const collectFiles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					const strictOk = !this.plugin.settings.enableStrictChapterMode || ChapterSorter.isChapterFile(child.name);
					if (strictOk) {
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
			new Notice(t('notice.no-chapter-files-in-folder', { name: file.name }));
			return;
		}

		const customOrder = this.plugin.settings.customSortOrder || {};
		mdFiles.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, customOrder));

		let mergedContent = `# ${file.name}`;
		let totalWords = 0;

		for (const mdFile of mdFiles) {
			const content = await this.plugin.app.vault.cachedRead(mdFile);
			const stripped = this.stripFrontmatter(mdFile, content);
			mergedContent += `\n\n## ${mdFile.basename}\n\n`;
			mergedContent += stripped;
			totalWords += this.plugin.calculateAccurateWords(stripped);
		}

		const exportPath = `${file.path}/${file.name}_${t('merge.filename-suffix')}.md`;

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
			const overwriteHint = existingFile ? t('notice.merge-overwrite-hint') : '';
			new Notice(t('notice.merge-success', { count: String(mdFiles.length), words: totalWords.toLocaleString(), overwriteHint }), 8000);


		} catch (error) {
			console.error(error);
			notice.hide();
			new Notice(t('notice.merge-failed'));
		}
	}

	/**
	 * 剥离 Markdown 文件的 YAML frontmatter（文档属性）
	 * 使用 Obsidian metadataCache 的 frontmatterPosition 精确定位
	 * 如果 cache 不可用，则用正则兜底
	 */
	private stripFrontmatter(file: TFile, content: string): string {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const pos = cache?.frontmatterPosition;
		if (pos) {
			// frontmatterPosition.end.line 是 frontmatter 结束行（含 --- 行）
			// 从下一行开始截取正文
			const lines = content.split('\n');
			const bodyStart = pos.end.line + 1;
			if (bodyStart < lines.length) {
				return lines.slice(bodyStart).join('\n');
			}
			return '';
		}
		// 兜底：正则匹配 frontmatter
		return content.replace(/^---\n.*?\n---\n?/, '');
	}
}
