import { Notice, TFile, type App, Modal } from 'obsidian';
import { isDesktop } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { copyDocumentContent } from '../utils/ui';
import { ChapterSorter } from '../services/ChapterSorter';
import { ForeshadowingInputModal, ConfirmCreateForeshadowingFileModal, ForeshadowingRecoveryModal } from '../ui/ForeshadowingModal';
import { findBookRoot } from '../utils/path';
import { TimelineAddModal } from '../ui/TimelineView';
import type { TimelineEntry } from '../services/TimelineManager';
import { TimelineManager } from '../services/TimelineManager';
import { AdvancedSearchModal } from '../ui/AdvancedSearchModal';
import { t } from '../i18n';
import { getDefaultFileName } from '../i18n/data-keys';

class ConfirmResetDailyStatsModal extends Modal {
	constructor(app: App, private onConfirm: () => void) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ text: t('command.reset-daily-stats-title'), cls: 'modal-title' });
		const p = contentEl.createEl('p', { text: t('command.reset-daily-stats-warning') });
		p.setCssStyles({ color: 'var(--text-error)' });

		const btnContainer = contentEl.createDiv({ cls: 'wn-base-button-container' });
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('common.confirm'), cls: 'mod-warning' });
		confirmBtn.onclick = () => {
			this.onConfirm();
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class CommandManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	registerAllCommands() {
		this.registerViewCommands();
		this.registerTrackingCommands();
		this.registerStickyNoteCommands();
		this.registerChapterCommands();
		this.registerObsCommands();
		this.registerForeshadowingCommands();
		this.registerTimelineCommands();
		this.registerMobileCommands();
		this.registerHomepageCommands();
		this.registerSearchCommands();
	}

	private registerViewCommands() {
		this.plugin.addCommand({
			id: 'toggle-writing-status-view',
			name: t('command.toggle-status-view'),
			callback: () => { void this.plugin.toggleStatusView(); }
		});

		this.plugin.addCommand({
			id: 'toggle-foreshadowing-view',
			name: t('command.toggle-foreshadowing-view'),
			callback: () => { void this.plugin.toggleForeshadowingView(); }
		});

		this.plugin.addCommand({
			id: 'toggle-timeline-view',
			name: t('command.toggle-timeline-view'),
			callback: () => { void this.plugin.toggleTimelineView(); }
		});

		this.plugin.addCommand({
			id: 'toggle-task-view',
			name: t('command.toggle-task-view'),
			callback: () => { void this.plugin.toggleTaskView(); }
		});

		this.plugin.addCommand({
			id: 'open-corkboard-view',
			name: t('command.toggle-corkboard-view'),
			callback: () => { void this.plugin.viewManager.toggleView('webnovel-corkboard'); }
		});

		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'toggle-immersive-mode',
				name: t('command.toggle-immersive-mode'),
				callback: () => { void this.plugin.immersiveModeManager.toggleImmersiveMode(); }
			});

			this.plugin.addCommand({
				id: 'reset-immersive-layout',
				name: t('command.reset-immersive-layout'),
				callback: async () => {
					this.plugin.settings.immersive.immersiveLayout = null;
					await this.plugin.saveSettings();
					new Notice(t('notice.immersive-layout-reset'));
				}
			});
		}
	}

	private registerTrackingCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'toggle-tracking',
				name: t('command.toggle-tracking'),
				callback: () => {
					if (this.plugin.isTracking) this.plugin.stopTracking();
					else this.plugin.startTracking();
				}
			});

			this.plugin.addCommand({
				id: 'reset-stream-session',
				name: t('command.reset-stream-session'),
				callback: () => {
					this.plugin.focusMs = 0;
					this.plugin.slackMs = 0;
					this.plugin.sessionAddedWords = 0;
					this.plugin.isTracking = false;
					this.plugin.workerManager?.postMessage('stop');
					void this.plugin.editorTracker?.handleFileChange();
					this.plugin.refreshStatusViews();
					new Notice(t('notice.stream-data-reset'));
				}
			});
		}

		this.plugin.addCommand({
			id: 'reset-daily-stats',
			name: t('command.reset-daily-stats'),
			callback: () => {
				new ConfirmResetDailyStatsModal(this.plugin.app, () => {
					const today = window.moment().format('YYYY-MM-DD');
					this.plugin.historyManager.resetDailyStat(today);
					void this.plugin.historyManager.saveHistory(true);
					this.plugin.refreshStatusViews();
					
					// 如果开启了直播状态视图（悬浮窗），也要重置内存变量
					this.plugin.focusMs = 0;
					this.plugin.slackMs = 0;
					this.plugin.sessionAddedWords = 0;
					if (this.plugin.isTracking) {
						this.plugin.stopTracking();
					}
					void this.plugin.editorTracker?.handleFileChange();

					new Notice(t('notice.daily-stats-reset'));
				}).open();
			}
		});
	}

	private registerStickyNoteCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'create-blank-sticky-note',
				name: t('command.create-blank-sticky-note'),
				callback: () => {
					this.plugin.createStickyNote({ content: '', title: t('notice.new-note-title') }).catch(console.error);
				}
			});

			this.plugin.addCommand({
				id: 'toggle-floating-notes',
				name: t('command.toggle-floating-notes'),
				callback: () => {
					void this.plugin.toggleFloatingNotesVisibility();
				}
			});
		}
	}

	private registerChapterCommands() {
		this.plugin.addCommand({
				id: 'create-next-chapter',
				name: t('command.create-next-chapter'),
				editorCallback: async (editor, view) => {
					const currentFile = view.file;
					if (!currentFile) return;

					const folder = currentFile.parent;
					const siblingNames = folder
						? folder.children
							.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
							.map(f => f.basename)
						: [];

					const newFileName = ChapterSorter.getNextChapterName(currentFile.basename, siblingNames);
					if (!newFileName) {
						new Notice(t('notice.chapter-number-unrecognized'));
						return;
					}

					const newFilePath = folder && folder.path !== '/' ? `${folder.path}/${newFileName}` : newFileName;
					const existingFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
					if (existingFile instanceof TFile) {

						await this.plugin.app.workspace.getLeaf(false).openFile(existingFile);

						return;

					}
					try {
						const newFile = await this.plugin.app.vault.create(newFilePath, '');
						await this.plugin.app.workspace.getLeaf(false).openFile(newFile);
						new Notice(t('notice.chapter-created', { name: newFileName }));
					} catch (error) {
						console.error(error);
						new Notice(t('notice.chapter-create-failed', { error: String(error) }));
					}
				}
			});
			
			this.plugin.addCommand({
				id: 'rebuild-folder-cache',
				name: t('command.rebuild-folder-cache'),
				callback: async () => {
					if (!this.plugin.settings.showExplorerCounts) {
						new Notice(t('notice.enable-explorer-counts-first'));
						return;
					}
					
					this.plugin.cacheManager.clearCache();
					const notice = new Notice(t('notice.rebuilding-explorer-cache'), 0);
					try {
						await this.plugin.cacheManager.buildInitialCache(
							this.plugin.app.vault,
							this.plugin.calculateAccurateWords.bind(this.plugin),
							this.plugin.isEligibleForWordCount.bind(this.plugin)
						);
						notice.hide();
						this.plugin.refreshFolderCounts();
						new Notice(t('notice.cache-rebuild-complete'));
					} catch (error) {
						notice.hide();
						new Notice(t('notice.cache-rebuild-failed', { error: String(error) }));
						console.error('[Plugin] 缓存重建失败:', error);
					}
				}
			});

			this.plugin.addCommand({
				id: 'refresh-chapter-sort',
				name: t('command.refresh-chapter-sort'),
				callback: () => {
					if (!this.plugin.settings.enableSmartChapterSort) {
						new Notice(t('notice.enable-smart-sort-first'));
						return;
					}
					this.plugin.fileExplorerPatcher.refreshManually();
					new Notice(t('notice.chapter-sort-refreshed'));
				}
			});
	}

	private registerObsCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'copy-obs-overlay-url',
				name: t('command.copy-obs-overlay-url'),
				callback: () => {
					const url = `http://127.0.0.1:${this.plugin.settings.obs.obsPort}/`;
					void navigator.clipboard.writeText(url);
					new Notice(t('notice.obs-url-copied', { url }));
				}
			});
		}
	}

	private registerForeshadowingCommands() {
		this.plugin.addCommand({
			id: 'mark-as-foreshadowing',
			name: t('command.mark-as-foreshadowing'),
			editorCheckCallback: (checking, editor, view) => {
				const selectedText = editor.getSelection();
				if (!selectedText || !selectedText.trim()) return false;
				if (checking) return true;
				
				const file = view.file;
				if (!file) return false;
				
					if (!this.plugin.foreshadowingManager) return false;
					const fm = this.plugin.foreshadowingManager;
				const submitCallback = (description: string, tags: string[]) => {
					void (async () => {
						try {
							const { file: foreshadowFile, merged } = await fm.addForeshadowing(file, selectedText, description, tags);
							if (merged) {
								new Notice(t('notice.foreshadowing-merged', { name: foreshadowFile.name }), 5000);
							} else {
								new Notice(t('notice.foreshadowing-marked', { name: foreshadowFile.name }), 5000);
							}
							if (isDesktop()) {
								const notice = new Notice(t('notice.foreshadowing-click-to-open'), 8000);
								notice.messageEl.addClass('wn-clickable');
								notice.messageEl.onclick = () => {
									void fm.openForeshadowingFile(foreshadowFile);
									notice.hide();
								};
							}
						} catch (err) {
							console.error('[ForeshadowingManager] addForeshadowing failed:', err);
							new Notice(t('notice.foreshadowing-mark-failed', { error: String(err) }));
						}
					})();
				};

				if (fm.foreshadowingFileExists(file)) {
					void (async () => {
						try {
							const extraTags = await fm.getExistingTags(file);
							new ForeshadowingInputModal(this.plugin.app, this.plugin, file.basename, selectedText, submitCallback, extraTags).open();
						} catch (err) {
							console.error('[CommandManager] getExistingTags failed:', err);
						}
					})();
				} else {
					const fileName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
					const folderPath = findBookRoot(this.plugin.app, this.plugin, file) || '';
					new ConfirmCreateForeshadowingFileModal(this.plugin.app, fileName, folderPath, () => {
						void (async () => {
							try {
								const extraTags = await fm.getExistingTags(file);
								new ForeshadowingInputModal(this.plugin.app, this.plugin, file.basename, selectedText, submitCallback, extraTags).open();
							} catch (err) {
								console.error('[CommandManager] getExistingTags failed:', err);
							}
						})();
					}).open();
				}
				return true;
			}
		});

		this.plugin.addCommand({
			id: 'mark-foreshadowing-recovered',
			name: t('command.mark-foreshadowing-recovered'),
			editorCheckCallback: (checking, editor, view) => {
				const file = view.file;
				if (!file) return false;
				
				const foreshadowingFileName = (this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName')) + '.md';
				if (file.name !== foreshadowingFileName) return false;
				if (checking) return true;
					if (!this.plugin.foreshadowingManager) return false;
					const fm = this.plugin.foreshadowingManager;

				const cursorLine = editor.getCursor().line;
				const entry = fm.getEntryAtCursor(editor, cursorLine);

				if (entry) {
					new ForeshadowingRecoveryModal(
						this.plugin.app,
						this.plugin,
						entry.contentPreview,
						findBookRoot(this.plugin.app, this.plugin, file) || '',
						(selectedChapters) => {
							void (async () => {
								try {
									const success = await fm.markAsRecovered(
										file, entry.description, selectedChapters
									);
									if (success) {
										const links = selectedChapters.map(c => `[[${c}]]`).join('、');
										new Notice(t('notice.foreshadowing-recovered', { links }));
									} else {
										new Notice(t('notice.foreshadowing-entry-not-found'));
									}
								} catch (err) {
									console.error('[CommandManager] markAsRecovered failed:', err);
									new Notice(t('notice.foreshadowing-recovery-failed', { error: String(err) }));
								}
							})();
						}
					).open();
					return true;
				} else {
					new Notice(t('notice.foreshadowing-cursor-hint'));
					return true;
				}
			}
		});
	}

	/**
	 * 注册“添加到时间线”命令面板命令
	 * 解决移动端无右键菜单导致无法选中文本添加时间线的问题
	 * 逻辑与 MenuManager.editor-menu 中的时间线菜单项一致
	 */
	private registerTimelineCommands() {
		this.plugin.addCommand({
			id: 'add-to-timeline',
			name: t('command.add-to-timeline'),
			editorCheckCallback: (checking, editor, view) => {
				// 必须有选中文本才启用该命令
				const selectedText = editor.getSelection();
				if (!selectedText || !selectedText.trim()) return false;
				if (checking) return true;

				const file = view.file;
				if (!file) return false;

				const chapterName = file.basename;
				const folderPath = findBookRoot(this.plugin.app, this.plugin, file) || '';

				// 读取已有条目中的类型，传入 Modal 供下拉选择
				void (async () => {
					try {
						const tlManager = new TimelineManager(this.plugin.app, this.plugin, folderPath);
						const tlFile = tlManager.getTimelineFile();
						const localTypes: string[] = [];
						if (tlFile) {
							const tlContent = await this.plugin.app.vault.read(tlFile);
							const tlEntries = tlManager.parseEntries(tlContent);
							localTypes.push(
								...new Set(tlEntries.map((e: TimelineEntry) => e.type).filter(Boolean))
							);
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
									rawBlock: '',
									origin: result.origin
								}).then(async () => {
									new Notice(t('notice.timeline-added'));

									// 刷新已打开的时间线视图
									const leaves = this.plugin.app.workspace.getLeavesOfType('timeline-view');
									if (leaves.length > 0) {
										// 给文件写入一点时间后再刷新视图
										await new Promise(resolve => window.setTimeout(resolve, 100));
										const refreshPromise = leaves[0].view.refresh?.();
										if (refreshPromise instanceof Promise) {
											await refreshPromise;
										}
									}
								}).catch(console.error);
							},
							false, localTypes, selectedText.trim()
						).open();
					} catch (err) {
						console.error('[CommandManager] add-to-timeline failed:', err);
					}
				})();
				return true;
			}
		});
	}

	private registerMobileCommands() {
		// 复制本文档：桌面端和移动端均生效（移动端无右键菜单，该命令尤为实用）
		this.plugin.addCommand({
			id: 'copy-full-content-mobile',
			name: t('command.copy-document'),
			editorCallback: (editor, view) => {
				void copyDocumentContent(view.file?.basename ?? '', editor.getValue());
			}
		});
	}

	private registerHomepageCommands() {
		this.plugin.addCommand({
			id: 'open-creative-homepage',
			name: t('command.open-creative-homepage'),
			callback: () => {
				const file = this.plugin.homepageManager?.getHomepageFile();
				if (file) {
					void this.plugin.app.workspace.getLeaf(false).openFile(file);
				} else {
					new Notice(t('notice.homepage-file-not-exist'));
				}
			}
		});

		this.plugin.addCommand({
			id: 'refresh-creative-homepage',
			name: t('command.refresh-creative-homepage'),
			callback: async () => {
				await this.plugin.homepageManager?.refreshHomepage();
				this.plugin.homepageManager?.refreshHomepageViews();
				new Notice(t('notice.homepage-refreshed'));
			}
		});
	}

	private registerSearchCommands() {
		this.plugin.addCommand({
			id: 'advanced-webnovel-search',
			name: t('command.advanced-search'),
			callback: () => {
				new AdvancedSearchModal(this.plugin.app, this.plugin).open();
			}
		});
	}
}
