import { MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import { isDesktop, isMobile } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { copyDocumentContent } from '../utils/ui';
import { ChapterSorter } from '../services/ChapterSorter';
import { ForeshadowingInputModal, ConfirmCreateForeshadowingFileModal, ForeshadowingRecoveryModal } from '../ui/ForeshadowingModal';
import { TimelineAddFromSelectionModal } from '../ui/TimelineView';
import { TimelineManager } from '../services/TimelineManager';

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
		this.registerMobileCommands();
		this.registerHomepageCommands();
	}

	private registerViewCommands() {
		this.plugin.addCommand({
			id: 'toggle-writing-status-view',
			name: '打开/关闭写作实时状态面板',
			callback: () => this.plugin.toggleStatusView()
		});

		this.plugin.addCommand({
			id: 'toggle-foreshadowing-view',
			name: '打开/关闭伏笔面板',
			callback: () => this.plugin.toggleForeshadowingView()
		});

		this.plugin.addCommand({
			id: 'toggle-timeline-view',
			name: '打开/关闭时间线面板',
			callback: () => this.plugin.toggleTimelineView()
		});

		this.plugin.addCommand({
			id: 'toggle-ranking-view',
			name: '打开/关闭榜单追踪面板',
			callback: () => this.plugin.toggleRankingView()
		});

		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'toggle-immersive-mode',
				name: '进入/退出全屏沉浸写作模式',
				callback: () => this.plugin.immersiveModeManager.toggleImmersiveMode()
			});

			this.plugin.addCommand({
				id: 'reset-immersive-layout',
				name: '重置沉浸模式布局 (回到默认比例和位置)',
				callback: async () => {
					this.plugin.settings.immersive.immersiveLayout = null;
					await this.plugin.saveSettings();
					new Notice('沉浸模式布局已重置，下次进入生效');
				}
			});
		}
	}

	private registerTrackingCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'toggle-tracking',
				name: '开始/暂停 专注时间统计',
				callback: () => {
					if (this.plugin.isTracking) this.plugin.stopTracking();
					else this.plugin.startTracking();
				}
			});

			this.plugin.addCommand({
				id: 'reset-stream-session',
				name: '重置直播统计数据 (清空时长和净增字数)',
				callback: () => {
					this.plugin.focusMs = 0;
					this.plugin.slackMs = 0;
					this.plugin.sessionAddedWords = 0;
					this.plugin.isTracking = false;
					this.plugin.workerManager?.postMessage('stop');
					this.plugin.editorTracker?.handleFileChange();
					this.plugin.exportLegacyOBS(true);
					this.plugin.refreshStatusViews();
					new Notice('直播数据已重置！统计已暂停，请手动开始新的场次。');
				}
			});
		}
	}

	private registerStickyNoteCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'create-blank-sticky-note',
				name: '新建空白悬浮便签',
				callback: () => {
					this.plugin.createStickyNote({ content: '', title: '新便签' });
				}
			});

			this.plugin.addCommand({
				id: 'toggle-floating-notes',
				name: '显示/隐藏所有悬浮便签',
				callback: () => {
					this.plugin.toggleFloatingNotesVisibility();
				}
			});
		}
	}

	private registerChapterCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'create-next-chapter',
				name: '自动创建下一章 (智能递增)',
				editorCallback: async (editor, view) => {
					const currentFile = view.file;
					if (!currentFile) return;

					const folderPath = currentFile.parent;
					const siblingNames = folderPath
						? folderPath.children
							.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
							.map(f => f.basename)
						: [];

					const newFileName = ChapterSorter.getNextChapterName(currentFile.basename, siblingNames);
					if (!newFileName) {
						new Notice('当前文件名无法识别章节号（仅支持数字或汉字），无法自动创建');
						return;
					}

					const newFilePath = folderPath && folderPath.path !== '/' ? `${folderPath.path}/${newFileName}` : newFileName;
					const existingFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
					if (existingFile) {
						await this.plugin.app.workspace.getLeaf(false).openFile(existingFile as TFile);
						return;
					}
					try {
						const newFile = await this.plugin.app.vault.create(newFilePath, '');
						await this.plugin.app.workspace.getLeaf(false).openFile(newFile);
						new Notice(`[成功] 已创建: ${newFileName}`);
					} catch (error) {
						console.error(error);
						new Notice(`[错误] 创建失败: ${error}`);
					}
				}
			});
			
			this.plugin.addCommand({
				id: 'rebuild-folder-cache',
				name: '重建文件夹字数缓存',
				callback: async () => {
					if (!this.plugin.settings.showExplorerCounts) {
						new Notice('请先在设置中启用"文件浏览器字数统计"功能');
						return;
					}
					
					this.plugin.cacheManager.clearCache();
					const notice = new Notice('正在重建文件浏览器缓存...', 0);
					try {
						await this.plugin.cacheManager.buildInitialCache(
							this.plugin.app.vault,
							this.plugin.calculateAccurateWords.bind(this.plugin),
							this.plugin.isEligibleForWordCount.bind(this.plugin)
						);
						notice.hide();
						this.plugin.refreshFolderCounts();
						new Notice('[成功] 缓存重建完成！');
					} catch (error) {
						notice.hide();
						new Notice(`[错误] 缓存重建失败: ${error}`);
						console.error('[Plugin] 缓存重建失败:', error);
					}
				}
			});

			this.plugin.addCommand({
				id: 'refresh-chapter-sort',
				name: '手动刷新章节排序（通常不需要）',
				callback: () => {
					if (!this.plugin.settings.enableSmartChapterSort) {
						new Notice('请先在设置中启用"智能章节排序"功能');
						return;
					}
					this.plugin.fileExplorerPatcher.refreshManually();
					new Notice('[成功] 章节排序已刷新\\n\\n[提示] 排序会自动适应，通常不需要手动刷新');
				}
			});
		}
	}

	private registerObsCommands() {
		if (isDesktop()) { // Desktop
			this.plugin.addCommand({
				id: 'copy-obs-overlay-url',
				name: '复制 OBS 叠加层 URL 到剪贴板',
				callback: () => {
					const url = `http://127.0.0.1:${this.plugin.settings.obs.obsPort}/`;
					navigator.clipboard.writeText(url);
					new Notice(`已复制: ${url}`);
				}
			});
		}
	}

	private registerForeshadowingCommands() {
		this.plugin.addCommand({
			id: 'mark-as-foreshadowing',
			name: '标注为伏笔',
			editorCheckCallback: (checking, editor, view) => {
				const selectedText = editor.getSelection();
				if (!selectedText || !selectedText.trim()) return false;
				if (checking) return true;
				
				const file = view.file;
				if (!file) return false;
				
					if (!this.plugin.foreshadowingManager) return false;
					const fm = this.plugin.foreshadowingManager;
				const submitCallback = (description: string, tags: string[]) => {
					fm.addForeshadowing(file, selectedText, description, tags)
						.then(({ file: foreshadowFile, merged }) => {
							if (merged) {
								new Notice(`[成功] 已合并到同名伏笔条目「${foreshadowFile.name}」`, 5000);
							} else {
								new Notice(`[成功] 已标注为伏笔，保存至「${foreshadowFile.name}」`, 5000);
							}
							if (isDesktop()) {
								const notice = new Notice('[提示] 点击此处打开伏笔文件', 8000);
								notice.noticeEl.style.cursor = 'pointer';
								notice.noticeEl.onclick = () => {
									fm.openForeshadowingFile(foreshadowFile);
									notice.hide();
								};
							}
						})
						.catch(err => {
							console.error('[ForeshadowingManager] addForeshadowing failed:', err);
							new Notice(`[错误] 标注失败：${err}`);
						});
				};

				if (fm.foreshadowingFileExists(file)) {
					fm.getExistingTags(file).then(extraTags => {
						new ForeshadowingInputModal(this.plugin.app, this.plugin, file.basename, selectedText, submitCallback, extraTags).open();
					});
				} else {
					const fileName = this.plugin.settings.foreshadowing?.fileName || '伏笔';
					const folderPath = file.parent?.path || '';
					new ConfirmCreateForeshadowingFileModal(this.plugin.app, fileName, folderPath, async () => {
						const extraTags = await fm.getExistingTags(file);
					new ForeshadowingInputModal(this.plugin.app, this.plugin, file.basename, selectedText, submitCallback, extraTags).open();
					}).open();
				}
				return true;
			}
		});

		this.plugin.addCommand({
			id: 'mark-foreshadowing-recovered',
			name: '标记伏笔已回收',
			editorCheckCallback: (checking, editor, view) => {
				const file = view.file;
				if (!file) return false;
				
				const foreshadowingFileName = (this.plugin.settings.foreshadowing?.fileName || '伏笔') + '.md';
				if (file.name !== foreshadowingFileName) return false;
				if (checking) return true;
					if (!this.plugin.foreshadowingManager) return false;
					const fm = this.plugin.foreshadowingManager;

				const cursorLine = editor.getCursor().line;
				const entry = fm.getEntryAtCursor(editor, cursorLine);

				if (entry) {
					new ForeshadowingRecoveryModal(
						this.plugin.app,
						entry.contentPreview,
						file.parent?.path || '',
						async (selectedChapters) => {
							const success = await fm.markAsRecovered(
								file, entry.sourceFile, entry.createdAt, selectedChapters
							);
							if (success) {
								const links = selectedChapters.map(c => `[[${c}]]`).join('、');
								new Notice(`[成功] 已标记为已回收：${links}`);
							} else {
								new Notice('[错误] 未找到对应的伏笔条目，请确认光标位置');
							}
						}
					).open();
					return true;
				} else {
					new Notice('[错误] 请将光标放在伏笔条目上');
					return true;
				}
			}
		});
	}
	
	private registerMobileCommands() {
		// 复制本文档：桌面端和移动端均生效（移动端无右键菜单，该命令尤为实用）
		this.plugin.addCommand({
			id: 'copy-full-content-mobile',
			name: '复制本文档',
			editorCallback: (editor, view) => {
				copyDocumentContent(view.file?.basename ?? '', editor.getValue());
			}
		});
	}

	private registerHomepageCommands() {
		this.plugin.addCommand({
			id: 'open-creative-homepage',
			name: '打开创作主页',
			callback: () => {
				const file = this.plugin.homepageManager?.getHomepageFile();
				if (file) {
					this.plugin.app.workspace.getLeaf(false).openFile(file);
				} else {
					new Notice('创作主页文件不存在，请重启插件');
				}
			}
		});

		this.plugin.addCommand({
			id: 'refresh-creative-homepage',
			name: '刷新创作主页',
			callback: async () => {
				await this.plugin.homepageManager?.refreshHomepage();
				this.plugin.homepageManager?.refreshHomepageViews();
				new Notice('[成功] 创作主页已刷新');
			}
		});
	}
}
