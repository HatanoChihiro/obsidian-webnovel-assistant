import type { MenuItem, TFile, WorkspaceLeaf } from 'obsidian';
import { Menu, Notice } from 'obsidian';
import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ForeshadowingStatus } from '../types/foreshadowing';
import { ForeshadowingRecoveryModal } from './ForeshadowingModal';
import { CreativeView } from './CreativeView';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { getForeshadowingStatusText, getForeshadowingLabel, getDefaultFileName } from '../i18n/data-keys';
import { t } from '../i18n';

export const FORESHADOWING_VIEW_TYPE = 'foreshadowing-view';



/**
 * 伏笔面板视图
 * 在侧边栏显示当前文件夹的伏笔列表，支持按状态筛选和直接回收操作
 */
export class ForeshadowingView extends CreativeView {
	private filterStatus: 'all' | ForeshadowingStatus = 'all';
	private filterTag: string = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf, plugin);
	}

	getViewType() { return FORESHADOWING_VIEW_TYPE; }
	getDisplayText() { return t('view.foreshadowing'); }
	getIcon() { return 'bookmark'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
	}

	protected async onFolderChange() {
		this.filterTag = 'all';
		await super.onFolderChange();
	}

	private getTagFilterOptions(entries: ParsedForeshadowingEntry[]): string[] {
		const fromSettings = this.plugin.settings.foreshadowing?.defaultTags || [];
		const fromEntries = entries.flatMap(e => e.tags);
		return [...new Set([...fromSettings, ...fromEntries])];
	}

	async refresh() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('foreshadowing-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'foreshadowing-view-header' });
		const titleRow = header.createDiv({ cls: 'foreshadowing-view-title-row' });
		titleRow.createSpan({ text: t('view.foreshadowing'), cls: 'foreshadowing-view-title' });

		// 当前文件夹标签
		const folderLabel = header.createDiv({ cls: 'foreshadowing-view-folder' });
		folderLabel.setText(this.currentFolder || t('common.root-directory'));

		// 筛选按钮
		const filterRow = header.createDiv({ cls: 'foreshadowing-view-filter-row' });
		const filters: { label: string; value: 'all' | ForeshadowingStatus }[] = [
			{ label: t('common.all'), value: 'all' },
			{ label: getForeshadowingStatusText('pending'), value: ForeshadowingStatus.Pending },
			{ label: getForeshadowingStatusText('recovered'), value: ForeshadowingStatus.Recovered },
			{ label: getForeshadowingStatusText('deprecated'), value: ForeshadowingStatus.Deprecated },
		];
		filters.forEach(f => {
			const btn = filterRow.createEl('button', { text: f.label, cls: 'foreshadowing-filter-btn' });
			if (this.filterStatus === f.value) btn.addClass('is-active');
			btn.onclick = () => {
				this.filterStatus = f.value;
				void this.refresh();
			};
		});

		// 读取伏笔文件
		const entries = await this.loadEntries();
		if (entries === null) {
			const empty = container.createDiv({ cls: 'foreshadowing-view-empty' });
			empty.createEl('p', { text: t('common.no-files-hint', { type: t('common.default-foreshadowing-filename') }) });
			const fileName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'foreshadowing-view-hint' });
			return;
		}

		// 标签筛选行
		const tagOptions = this.getTagFilterOptions(entries);
		if (tagOptions.length > 0) {
			const tagRow = header.createDiv({ cls: 'foreshadowing-view-filter-row foreshadowing-view-tag-filter-row' });
			const allTagBtn = tagRow.createEl('button', { text: t('common.all-tags'), cls: 'foreshadowing-filter-btn' });
			if (this.filterTag === 'all') allTagBtn.addClass('is-active');
			allTagBtn.onclick = () => { this.filterTag = 'all'; void this.refresh(); };
			tagOptions.forEach(tag => {
				const btn = tagRow.createEl('button', { text: `#${tag}`, cls: 'foreshadowing-filter-btn' });
				if (this.filterTag === tag) btn.addClass('is-active');
				btn.onclick = () => { this.filterTag = tag; void this.refresh(); };
			});
		}

		// 筛选
		let filtered = entries;
		if (this.filterStatus !== 'all') filtered = filtered.filter(e => e.status === this.filterStatus);
		if (this.filterTag !== 'all') filtered = filtered.filter(e => e.tags.includes(this.filterTag));

		if (filtered.length === 0) {
			container.createDiv({ cls: 'foreshadowing-view-empty', text: t('common.no-matching-foreshadowing') });
			return;
		}

		// 按状态分组
		const groups: { status: ForeshadowingStatus; label: string; items: ParsedForeshadowingEntry[] }[] = [
			{ status: ForeshadowingStatus.Pending, label: getForeshadowingStatusText('pending'), items: [] },
			{ status: ForeshadowingStatus.Recovered, label: getForeshadowingStatusText('recovered'), items: [] },
			{ status: ForeshadowingStatus.Deprecated, label: getForeshadowingStatusText('deprecated'), items: [] },
		];
		filtered.forEach(e => {
			const g = groups.find(g => g.status === e.status);
			if (g) g.items.push(e);
		});

		const list = container.createDiv({ cls: 'foreshadowing-view-list' });

		groups.forEach(group => {
			if (group.items.length === 0) return;

			// 分组标题
			const groupHeader = list.createDiv({ cls: 'foreshadowing-group-header' });
			groupHeader.createSpan({ text: `${group.label}`, cls: 'foreshadowing-group-label' });
			groupHeader.createSpan({ text: `${group.items.length}`, cls: 'foreshadowing-group-count' });

			// 条目列表
			group.items.forEach(entry => this.renderEntry(list, entry));
		});
	}

	private renderEntry(container: HTMLElement, entry: ParsedForeshadowingEntry) {
		const card = container.createDiv({ cls: `foreshadowing-entry-card status-${entry.status === ForeshadowingStatus.Pending ? 'pending' : entry.status === ForeshadowingStatus.Recovered ? 'recovered' : 'deprecated'}` });

		// 说明（主标题）
		const descRow = card.createDiv({ cls: 'foreshadowing-entry-desc' });
		descRow.createSpan({ text: entry.description, cls: 'foreshadowing-entry-desc-text' });

		// 引用内容（可能多条）
		const quotesEl = card.createDiv({ cls: 'foreshadowing-entry-quotes' });
		entry.contents.forEach(c => {
			const quoteEl = quotesEl.createDiv({ cls: 'foreshadowing-entry-quote' });
			const target = c.source || entry.sourceFile;
			
			if (c.source || c.time) {
				const metaEl = quoteEl.createDiv({
					text: `${c.source ? `[[${c.source}]]` : ''}${c.time ? ` · ${c.time}` : ''}`,
					cls: 'foreshadowing-entry-quote-meta'
				});
				metaEl.setCssProps({ cursor: 'pointer' });
				metaEl.title = t('common.jump-to-reference');
				metaEl.onclick = async () => {
					const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
					const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
					if (file) {
						await this.openFileWithSmartLocate(file, c.text);
					} else {
						new Notice(t('common.file-not-found', { name: target }));
					}
				};
			}
			
			const textEl = quoteEl.createDiv({ text: c.text, cls: 'foreshadowing-entry-quote-text' });
			textEl.setCssProps({ cursor: 'pointer' });
			textEl.title = t('common.jump-to-original');
			textEl.onclick = async () => {
				const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
				const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
				if (file) {
					await this.openFileWithSmartLocate(file, c.text);
				} else {
					new Notice(t('common.file-not-found', { name: target }));
				}
			};
		});

		// 底部信息行
		const footer = card.createDiv({ cls: 'foreshadowing-entry-footer' });

		// 标签
		if (entry.tags.length > 0) {
			const tagsEl = footer.createDiv({ cls: 'foreshadowing-entry-tags' });
			entry.tags.forEach(tag => {
				tagsEl.createSpan({ text: `#${tag}`, cls: 'foreshadowing-entry-tag' });
			});
		}

		// 操作按钮
		const actions = footer.createDiv({ cls: 'foreshadowing-entry-actions' });

		// 跳转按钮：单条引用直接跳转，多条引用显示选择菜单
		const jumpBtn = actions.createEl('button', { text: t('common.jump'), cls: 'foreshadowing-action-btn' });
		jumpBtn.onclick = async (e) => {
			if (entry.contents.length <= 1) {
				// 单个来源，直接跳转
				const target = entry.contents[0]?.source || entry.sourceFile;
				const text = entry.contents[0]?.text || '';
				const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
				const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
				if (file) {
					await this.openFileWithSmartLocate(file, text);
				} else {
					new Notice(t('common.file-not-found', { name: target }));
				}
			} else {
				// 多个来源，显示下拉菜单
				const menu = new Menu();
				for (const c of entry.contents) {
					const target = c.source || entry.sourceFile;
					// 截断部分文字作为菜单标题
					const shortText = c.text.length > 10 ? c.text.substring(0, 10) + '...' : c.text;
					menu.addItem((item: MenuItem) => {
						item.setTitle(`${target} (${shortText})`).onClick(async () => {
							const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
							const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
							if (file) {
								await this.openFileWithSmartLocate(file, c.text);
							} else {
								new Notice(t('common.file-not-found', { name: target }));
							}
						});
					});
				}
				menu.showAtMouseEvent(e);
			}
		};

		// 回收按钮（仅未回收状态显示）
		if (entry.status === ForeshadowingStatus.Pending) {
			const recoverBtn = actions.createEl('button', { text: t('common.mark-recovered'), cls: 'foreshadowing-action-btn foreshadowing-recover-btn' });
			recoverBtn.onclick = () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				new ForeshadowingRecoveryModal(
					this.app,
					this.plugin,
					entry.contents[0]?.text || '',
					this.currentFolder,
					(recoveryFileNames) => {
						if (!this.plugin.foreshadowingManager) {
							new Notice(t('common.foreshadowing-manager-not-ready'));
							return;
						}
						void (async () => {
							try {
								const success = await this.plugin.foreshadowingManager!.markAsRecovered(
									foreshadowingFile, entry.description, recoveryFileNames
								);
								if (success) {
									const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
									new Notice(t('notice.foreshadowing-recovered', { links: fileList }));
									// 文件修改会自动触发刷新，但在某些平台可能有延迟，添加备用刷新
									window.setTimeout(() => void this.refresh(), 100);
								} else {
									new Notice(t('common.mark-failed-check-file'));
								}
							} catch (err) {
								console.error('[ForeshadowingView] markAsRecovered failed:', err);
							}
						})();
					}
				).open();
			};

			// 废弃按钮（未回收状态显示）
			const deprecateBtn = actions.createEl('button', { text: t('common.deprecate'), cls: 'foreshadowing-action-btn foreshadowing-deprecate-btn' });
			deprecateBtn.onclick = () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				if (!this.plugin.foreshadowingManager) return;
				void (async () => {
					try {
						const success = await this.plugin.foreshadowingManager!.markAsDeprecated(
							foreshadowingFile, entry.description
						);
						if (success) {
							new Notice(t('common.deprecated-marked'));
							// 文件修改会自动触发刷新，但在某些平台可能有延迟，添加备用刷新
							window.setTimeout(() => void this.refresh(), 100);
						} else {
							new Notice(t('common.operation-failed'));
						}
					} catch (err) {
						console.error('[ForeshadowingView] markAsDeprecated failed:', err);
					}
				})();
			};
		}

		// 恢复按钮（已废弃状态显示）
		if (entry.status === ForeshadowingStatus.Deprecated) {
			const restoreBtn = actions.createEl('button', { text: t('common.restore'), cls: 'foreshadowing-action-btn' });
			restoreBtn.onclick = async () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				if (!this.plugin.foreshadowingManager) return;
				const success = await this.plugin.foreshadowingManager.markAsPending(
					foreshadowingFile, entry.description
				);
				if (success) {
					new Notice(t('common.restored-to-pending'));
					// 文件修改会自动触发刷新，但在某些平台可能有延迟，添加备用刷新
					window.setTimeout(() => void this.refresh(), 100);
				} else {
					new Notice(t('common.operation-failed'));
				}
			};
		}

		// 已回收时显示回收章节（支持多章节）
		if (entry.status === ForeshadowingStatus.Recovered) {
			const recoveryEl = card.createDiv({ cls: 'foreshadowing-entry-recovery' });
			recoveryEl.createSpan({ text: getForeshadowingLabel('recoveredAt') + '：', cls: 'foreshadowing-entry-recovery-label' });
			
			// 优先使用新格式（多章节）
			if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
				entry.recoveryFiles.forEach((file, index) => {
					if (index > 0) recoveryEl.createSpan({ text: '、' });
					const recoveryLink = recoveryEl.createEl('a', { text: file, cls: 'foreshadowing-entry-recovery-link' });
					recoveryLink.onclick = async () => {
						const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
						const targetFile = this.app.metadataCache.getFirstLinkpathDest(file, sourcePath);
						if (targetFile) await this.app.workspace.getLeaf(false).openFile(targetFile);
					};
				});
			}
			// 向后兼容：如果只有旧格式（单章节）
			else if (entry.recoveryFile) {
				const recoveryLink = recoveryEl.createEl('a', { text: entry.recoveryFile, cls: 'foreshadowing-entry-recovery-link' });
				recoveryLink.onclick = async () => {
					const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
					const file = this.app.metadataCache.getFirstLinkpathDest(entry.recoveryFile as string, sourcePath);
					if (file) await this.app.workspace.getLeaf(false).openFile(file);
				};
			}
		}
	}

	private getForeshadowingFile(): TFile | null {
		if (!this.plugin.foreshadowingManager) return null;
		return this.plugin.foreshadowingManager.getForeshadowingFileByFolder(this.currentFolder);
	}

	private async loadEntries(): Promise<ParsedForeshadowingEntry[] | null> {
		const file = this.getForeshadowingFile();
		if (!file || !this.plugin.foreshadowingManager) return null;

		const content = await this.app.vault.read(file);
		// 使用 Manager 的统一解析逻辑
		return this.plugin.foreshadowingManager.parseEntries(content);
	}

	/**
	 * 使用智能文本匹配进行精准跳转
	 */
	private async openFileWithSmartLocate(file: TFile, searchText: string) {
		const leaf = this.app.workspace.getLeaf(false);
		
		if (!searchText) {
			await leaf.openFile(file);
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		let targetLine = 0;
		
		const cleanSearch = searchText.trim();
		if (cleanSearch) {
			// 将搜索文本中的所有空白字符转换为匹配任意空白字符的正则，这样忽略了换行符
			const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const searchPattern = escapedSearch.replace(/\s+/g, '\\s+');
			
			let match = content.match(new RegExp(searchPattern));
			if (!match && cleanSearch.length > 20) {
				// 降级匹配
				const shortSearch = cleanSearch.substring(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
				match = content.match(new RegExp(shortSearch));
			}

			if (match && match.index !== undefined) {
				targetLine = content.substring(0, match.index).split('\n').length - 1;
			}
		}

		await leaf.openFile(file, { eState: { line: targetLine } });
	}
}
