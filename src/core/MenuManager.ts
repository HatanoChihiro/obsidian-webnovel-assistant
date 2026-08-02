import { TFile, TFolder, Notice, type Menu } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { GoalModal } from '../ui/GoalModal';
import { copyDocumentContent } from '../utils/ui';
import { isDesktop } from '../utils/platform';
import { VIEW_TYPES } from '../constants';
import { ChapterSorter } from '../services/ChapterSorter';
import { TimelineAddModal } from '../ui/TimelineAddModal';
import type { TimelineEntry } from '../services/TimelineManager';
import { TaskAddModal } from '../ui/TaskModal';
import { findBookRoot } from '../utils/path';
import { NewNovelModal } from '../ui/NewNovelModal';
import { ImportNovelModal } from '../ui/ImportNovelModal';
import type { WorkbenchView } from '../ui/WorkbenchView';
import { RELATION_GRAPH_VIEW_TYPE } from '../ui/RelationGraphView';

export class MenuManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	registerAllMenus() {
		this.plugin.registerEvent(this.plugin.app.workspace.on('file-menu', (menu, file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.addFileMenuItems(menu, file);
			} else if (file instanceof TFolder) {
				const customMenu = menu as unknown as { __webnovelAssistantAdded?: boolean };
				if (customMenu.__webnovelAssistantAdded) return;
				customMenu.__webnovelAssistantAdded = true;

				if (isDesktop()) {
					menu.addItem((item) => {
						item.setTitle(t('menu.merge-chapters'))
							.setIcon('documents')
							.setSection('webnovel-assistant')
							.onClick(() => { this.handleMergeChapters(file).catch(console.error); });
					});
				}

				menu.addItem((item) => {
					item.setTitle(t('menu.start-task-tracking')).setIcon('trophy').setSection('webnovel-assistant').onClick(() => {
						this.openTaskModal(file);
					});
				});

				menu.addItem((item) => {
					item.setTitle(t('menu.create-novel')).setIcon('book-open').setSection('webnovel-assistant').onClick(() => {
						new NewNovelModal(this.plugin.app, this.plugin, (result) => {
							void (async () => {
								try {
									const { folderPath } = await this.plugin.homepageManager!.createNewNovel(result.name, result.meta);
									new Notice(t('notice.novel-created', { name: result.name }));
									if (this.plugin.homepageManager) {
										const viewType = 'webnovel-workbench';
										const { workspace } = this.plugin.app;
										const leaves = workspace.getLeavesOfType(viewType);
										let leaf = leaves.length > 0 ? leaves[0] : null;
										if (!leaf) {
											leaf = workspace.getLeaf(false);
											await leaf.setViewState({ type: viewType, active: true });
										}
										if (leaf && leaf.view && leaf.view.getViewType() === viewType) {
											(leaf.view as WorkbenchView).setBookPath(folderPath);
										}
										if (leaf) {
											void workspace.revealLeaf(leaf);
											void workspace.setActiveLeaf(leaf, { focus: true });
										}
									}
								} catch (e) {
									console.error(e);
								}
							})();
						}).open();
					});
				});

				menu.addItem((item) => {
					item.setTitle(t('import-novel.title')).setIcon('upload').setSection('webnovel-assistant').onClick(() => {
						new ImportNovelModal(this.plugin.app, this.plugin).open();
					});
				});
			}
		}));

		this.plugin.registerEvent(this.plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
			if (editor.somethingSelected()) {
				menu.addItem((item) => {
					item.setTitle(t('menu.mark-as-foreshadowing')).setIcon('bookmark').setSection('webnovel-assistant').onClick(() => {
						this.plugin.app.commands.executeCommandById('web-novel-assistant:mark-as-foreshadowing');
					});
				});

				menu.addItem((item) => {
					item.setTitle(t('menu.add-to-timeline')).setIcon('calendar-clock').setSection('webnovel-assistant').onClick(() => {
						(async () => {
							const selectedText = editor.getSelection();
							if (!selectedText.trim()) {
								new Notice(t('notice.select-text-first'));
								return;
							}

							const chapterName = view.file?.basename || '';
							const folderPath = findBookRoot(this.plugin.app, this.plugin, view.file) || '';

							// 读取已有条目中的类型，传入 Modal 供选择
							const tlManager = this.plugin.timelineManager;
							tlManager.currentFolder = folderPath;
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
									tlManager.appendEntry({
										time: result.time,
										description: result.description,
										chapter: result.chapter,
										type: result.type,
										rawBlock: '',
										origin: result.origin
									}).then(async () => {
										new Notice(t('notice.timeline-added'));

										// 刷新已打开的时间线视图
										const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPES.TIMELINE);
										if (leaves.length > 0) {
											await new Promise(resolve => window.setTimeout(resolve, 100)); // 给文件写入一点时间
											const refreshPromise = leaves[0].view.refresh?.();
											if (refreshPromise instanceof Promise) {
												await refreshPromise;
											}
										}
									}).catch(console.error);
								},
								false, localTypes, selectedText.trim()).open();
						})().catch(console.error);
					});
				});

				if (isDesktop()) {
					menu.addItem((item) => {
						item.setTitle(t('menu.extract-sticky-note')).setIcon('quote').setSection('webnovel-assistant').onClick(() => {
							this.plugin.stickyNoteManager.createStickyNote({ content: editor.getSelection(), title: t('notice.selected-segment') }).catch(console.error);
						});
					});
				}
			}

			if (view.file) {
				this.addFileMenuItems(menu, view.file);
			}
		}));
	}

	/**
	 * 为文档菜单添加文件级菜单项（桌面端平铺，移动端/平板端使用 Obsidian 原生 setSubmenu 折叠二级菜单）
	 */
	private addFileMenuItems(menu: Menu, file: TFile): void {
		const customMenu = menu as unknown as { __webnovelAssistantAdded?: boolean };
		if (customMenu.__webnovelAssistantAdded) return;
		customMenu.__webnovelAssistantAdded = true;

		if (isDesktop()) {
			// 桌面端：平铺直达
			menu.addItem((item) => {
				item.setTitle(t('menu.set-chapter-goal')).setIcon('target').setSection('webnovel-assistant').onClick(() => {
					new GoalModal(this.plugin.app, file).open();
				});
			});

			menu.addItem((item) => {
				item.setTitle(t('menu.copy-document')).setIcon('copy').setSection('webnovel-assistant').onClick(() => {
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

			menu.addItem((item) => {
				item.setTitle(t('menu.extract-sticky-note')).setIcon('popup-open').setSection('webnovel-assistant').onClick(() => {
					this.plugin.stickyNoteManager.createStickyNote({ file: file }).catch(console.error);
				});
			});

			const bookPath = this.plugin.characterManager.getBookPathForFile(file) || '';
			const parentPath = file.parent?.path || '';
			if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) {
				menu.addItem((item) => {
					item.setTitle(t('menu.open-relation-graph')).setIcon('git-fork').setSection('webnovel-assistant').onClick(() => {
						void (async () => {
							const leaf = this.plugin.app.workspace.getLeaf('split', 'vertical');
							await leaf.setViewState({
								type: RELATION_GRAPH_VIEW_TYPE,
								state: { filePath: file.path }
							});
						})();
					});
				});
			}

			menu.addItem((item) => {
				item.setTitle(t('menu.start-task-tracking')).setIcon('trophy').setSection('webnovel-assistant').onClick(() => {
					this.openTaskModal(file);
				});
			});
		} else {
			// 移动端/平板端：使用 Obsidian 原生 setSubmenu 折叠二级菜单
			menu.addItem((item) => {
				item.setTitle(t('menu.submenu-title')).setIcon('book-open').setSection('webnovel-assistant');
				const subMenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
				const targetMenu = subMenu || menu;

				targetMenu.addItem((subItem) => {
					subItem.setTitle(t('menu.set-chapter-goal')).setIcon('target').onClick(() => {
						new GoalModal(this.plugin.app, file).open();
					});
				});

				targetMenu.addItem((subItem) => {
					subItem.setTitle(t('menu.copy-document')).setIcon('copy').onClick(() => {
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

				const bookPath = this.plugin.characterManager.getBookPathForFile(file) || '';
				const parentPath = file.parent?.path || '';
				if (this.plugin.characterManager.isLorePath(bookPath, parentPath)) {
					targetMenu.addItem((subItem) => {
						subItem.setTitle(t('menu.open-relation-graph')).setIcon('git-fork').onClick(() => {
							void (async () => {
								const leaf = this.plugin.app.workspace.getLeaf('split', 'vertical');
								await leaf.setViewState({
									type: RELATION_GRAPH_VIEW_TYPE,
									state: { filePath: file.path }
								});
							})();
						});
					});
				}

				targetMenu.addItem((subItem) => {
					subItem.setTitle(t('menu.start-task-tracking')).setIcon('trophy').onClick(() => {
						this.openTaskModal(file);
					});
				});
			});
		}
	}

	private openTaskModal(file: TFile | TFolder) {
		const folderPath = findBookRoot(this.plugin.app, this.plugin, file) || (file instanceof TFolder ? file.path : '');

		const manager = this.plugin.taskManager;
		manager.currentFolder = folderPath;
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
		const mdFiles = ChapterSorter.getAllChapters(this.plugin.app, this.plugin, file.path);
		if (mdFiles.length === 0) {
			notice.hide();
			new Notice(t('notice.no-chapter-files-in-folder', { name: file.name }));
			return;
		}

		let mergedContent = `# ${file.name}`;
		let totalWords = 0;
		let currentVolume = '';

		for (const mdFile of mdFiles) {
			const inVolume = mdFile.parent && mdFile.parent.path !== file.path;
			const volumeName = inVolume ? mdFile.parent!.name : '';

			if (inVolume && volumeName !== currentVolume) {
				currentVolume = volumeName;
				mergedContent += `\n\n## ${currentVolume}`;
			} else if (!inVolume && currentVolume !== '') {
				currentVolume = '';
			}

			const content = await this.plugin.app.vault.cachedRead(mdFile);
			const stripped = this.stripFrontmatter(mdFile, content);

			const chapterHeading = inVolume ? '###' : '##';
			mergedContent += `\n\n${chapterHeading} ${mdFile.basename}\n\n`;
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
		return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
	}
}
