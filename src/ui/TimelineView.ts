import type { App, WorkspaceLeaf, TFile } from 'obsidian';
import { Notice, setIcon } from 'obsidian';
import type { TimelineEntry, TimelineManager } from '../services/TimelineManager';
import { CreativeView } from './CreativeView';
import { rafThrottle } from '../utils/dom';
import { t } from '../i18n';
import { getDefaultFileName } from '../i18n/data-keys';
import { ChapterSorter } from '../services/ChapterSorter';
import { TimelineAddModal } from './TimelineAddModal';
import { smartLocateAndHighlight } from '../utils/leaf';
import type { CurrentBookContextPlugin } from '../utils/path';
import { TimelineFormComponent, type TimelineFormContext, type TimelineFormSettings } from './components/TimelineFormComponent';
import { MultiSelectFilterRow } from './components/MultiSelectFilterRow';
import { renderLoreBadges, type LoreBadgePlugin } from '../utils/badge';

import type { AccurateCountSettings } from '../types/settings';
import type { HomepageManager } from '../services/HomepageManager';
import type { CharacterManager } from '../services/CharacterManager';

export const TIMELINE_VIEW_TYPE = 'wn-timeline-view';

export type TimelineViewManager = Pick<
	TimelineManager,
	| 'getTimelineFile'
	| 'createTimelineFile'
	| 'parseEntries'
	| 'appendEntry'
	| 'updateEntry'
	| 'deleteEntry'
	| 'moveEntry'
>;

export type TimelineViewSettings = TimelineFormSettings &
	Pick<AccurateCountSettings, 'workspaceFolders' | 'loreFolderName' | 'foreshadowing' | 'novelInfo' | 'enableMobileLorePopover' | 'lorePopoverCollapse'>;

export type TimelineViewHomepageManager = Pick<HomepageManager, 'getNovelFolders'> & {
	getHomepageFilePath(): string;
};

export type TimelineViewCharacterManager = Pick<
	CharacterManager,
	| 'getCharactersForBook'
	| 'getCharacterFile'
	| 'getLoreEntriesInFileOrder'
	| 'findLoreFolder'
	| 'createLoreEntry'
	| 'getLoreContent'
	| 'updateLoreContent'
>;

export interface TimelineViewPlugin
	extends Omit<CurrentBookContextPlugin, 'settings' | 'homepageManager'>,
		Omit<TimelineFormContext, 'settings' | 'homepageManager' | 'characterManager'>,
		Omit<LoreBadgePlugin, 'app' | 'settings' | 'characterManager'> {
	app: App;
	settings: TimelineViewSettings;
	homepageManager?: TimelineViewHomepageManager;
	timelineManager: TimelineViewManager;
	characterManager: TimelineViewCharacterManager;
}

/**
 * 时间线视图
 * 在侧边栏显示当前文件夹的时间线，支持内联编辑和从正文添加
 */
export class TimelineView extends CreativeView<TimelineViewPlugin> {
	private manager!: TimelineViewManager;
	private editingIndex: number = -1;
	private filterType: string = 'all';
	private selectedLores: Set<string> = new Set();
	private isDescending: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: TimelineViewPlugin) {
		super(leaf, plugin);
		this.manager = this.plugin.timelineManager;
	}

	getViewType() { return TIMELINE_VIEW_TYPE; }
	getDisplayText() { return t('view.timeline'); }
	getIcon() { return 'calendar-clock'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName');
	}

	async onOpen() {
		await super.onOpen();
		this.registerEvent(
			this.app.workspace.on('timeline-filter-changed', (type: string) => {
				if (this.filterType !== type) {
					this.filterType = type;
					void this.refresh();
				}
			})
		);
		this.registerEvent(
			this.app.workspace.on('timeline-lore-filter-changed', (selectedLores: string[]) => {
				const newSet = new Set(selectedLores);
				let same = this.selectedLores.size === newSet.size;
				if (same) {
					for (const s of this.selectedLores) {
						if (!newSet.has(s)) { same = false; break; }
					}
				}
				if (!same) {
					this.selectedLores = newSet;
					void this.refresh();
				}
			})
		);
		this.registerEvent(
			this.app.workspace.on('timeline-order-changed', (isDescending: boolean) => {
				if (this.isDescending !== isDescending) {
					this.isDescending = isDescending;
					void this.refresh();
				}
			})
		);
	}

	protected async onFolderChange() {
		this.editingIndex = -1;
		this.filterType = 'all';
		this.selectedLores.clear();
		this.app.workspace.trigger('timeline-filter-changed', 'all');
		this.app.workspace.trigger('timeline-lore-filter-changed', []);
		await this.refresh();
	}

	private getEventColor(type: string): string {
		const types = this.plugin.settings.timeline?.defaultTypes || [];
		const index = types.indexOf(type);
		if (index === -1) return 'var(--text-accent)';

		const colors = [
			'var(--color-red)',
			'var(--color-blue)',
			'var(--color-green)',
			'var(--color-orange)',
			'var(--color-purple)',
			'var(--color-cyan)',
			'var(--color-pink)'
		];
		return colors[index % colors.length];
	}

	/**
	 * 使用智能文本匹配进行精准跳转
	 */
	private async openFileWithSmartLocate(file: TFile, searchText: string) {
		await smartLocateAndHighlight(this.app, file, [searchText], { sourceLeaf: this.leaf });
	}

	private getTypeFilterOptions(entries: TimelineEntry[]): string[] {
		const fromSettings = this.plugin.settings.timeline?.defaultTypes || [];
		const fromEntries = entries.map(e => e.type).filter(Boolean);
		return [...new Set([...fromSettings, ...fromEntries])];
	}

	private getLoreFilterOptions(entries: TimelineEntry[]): string[] {
		const lores: string[] = [];
		for (const entry of entries) {
			for (const lore of entry.lores || []) {
				if (!lores.includes(lore)) {
					lores.push(lore);
				}
			}
		}
		return lores;
	}

	async refresh() {
		const file = this.manager.getTimelineFile(this.currentFolder);
		const content = file ? await this.app.vault.read(file) : null;
		await this.renderFromContent(content);
	}

	async renderFromContent(content: string | null) {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('wn-timeline-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'wn-timeline-view-header' });
		const titleRow = header.createDiv({ cls: 'wn-timeline-view-title-row' });
		titleRow.createSpan({ text: t('view.timeline'), cls: 'wn-timeline-view-title' });

		const actionRow = titleRow.createDiv({ cls: 'wn-timeline-view-actions' });

		const sortToggle = actionRow.createEl('button', { cls: 'clickable-icon wn-timeline-toolbar-button wn-timeline-sort-toggle' });
		sortToggle.setAttr('role', 'button');
		sortToggle.setAttr('tabindex', '0');
		const sortLabel = this.isDescending ? t('corkboard.sort-descending') : t('corkboard.sort-ascending');
		sortToggle.setAttr('aria-label', sortLabel);
		sortToggle.setAttr('aria-pressed', this.isDescending ? 'true' : 'false');
		setIcon(sortToggle, this.isDescending ? 'arrow-down-narrow-wide' : 'arrow-up-wide-narrow');

		const toggleSort = () => {
			this.isDescending = !this.isDescending;
			this.app.workspace.trigger('timeline-order-changed', this.isDescending);
			void this.refresh();
		};
		sortToggle.onclick = toggleSort;
		sortToggle.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				toggleSort();
			}
		});

		const addBtn = actionRow.createEl('button', { cls: 'clickable-icon wn-timeline-toolbar-button wn-timeline-add-btn' });
		addBtn.setAttr('aria-label', t('modal.new-event'));
		setIcon(addBtn, 'plus');
		addBtn.onclick = () => {
			const modal = new TimelineAddModal(
				this.app,
				this.plugin,
				'',
				'',
				this.currentFolder,
				(entry) => {
					void (async () => {
						try {
							const newContent = await this.manager.appendEntry(entry, this.currentFolder);
							await this.renderFromContent(newContent);
						} catch (e) { console.error(e); }
					})();
				},
				true,
				typeOptions,
				undefined,
				t('modal.new-event')
			);
			modal.open();
		};

		header.createDiv({ cls: 'wn-timeline-view-folder', text: this.currentFolder || t('common.root-directory') });

		// 用传入的 content，或者文件不存在时显示空状态
		if (content === null) {
			const empty = container.createDiv({ cls: 'wn-timeline-view-empty' });
			const fileName = this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName');
			empty.createEl('p', { text: t('common.no-files-hint', { type: t('common.default-timeline-filename') }) });
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'wn-timeline-view-hint' });
			const createBtn = empty.createEl('button', { text: t('common.create-timeline-file'), cls: 'mod-cta timeline-create-btn' });
			createBtn.onclick = () => {
				void (async () => {
					try {
						await this.manager.createTimelineFile(this.currentFolder);
						await this.refresh();
					} catch (e) { console.error(e); }
				})();
			};
			return;
		}

		const entries = this.manager.parseEntries(content, this.currentFolder);

		// 类型筛选
		const typeOptions = this.getTypeFilterOptions(entries);
		if (typeOptions.length > 0) {
			const typeRow = header.createDiv({ cls: 'wn-timeline-view-filter-row' });
			const allBtn = typeRow.createEl('button', { text: t('common.all-types'), cls: 'wn-timeline-filter-btn' });
			if (this.filterType === 'all') allBtn.addClass('is-active');
			allBtn.onclick = () => {
				this.filterType = 'all';
				this.app.workspace.trigger('timeline-filter-changed', 'all');
				void this.refresh();
			};

			typeOptions.forEach(type => {
				const btn = typeRow.createEl('button', { text: type, cls: 'wn-timeline-filter-btn' });
				if (this.filterType === type) btn.addClass('is-active');
				btn.onclick = () => {
					this.filterType = type;
					this.app.workspace.trigger('timeline-filter-changed', type);
					void this.refresh();
				};
			});
		}

		// 设定多选筛选
		const loreOptions = this.getLoreFilterOptions(entries);
		if (loreOptions.length > 0) {
			new MultiSelectFilterRow({
				container: header,
				cls: 'wn-timeline-view-filter-row wn-timeline-view-lore-filter-row',
				buttonCls: 'wn-timeline-filter-btn',
				allLabel: t('common.all-lore'),
				options: loreOptions.map(lore => ({ value: lore, label: lore })),
				selected: this.selectedLores,
				onChange: (selected) => {
					this.selectedLores = selected;
					this.app.workspace.trigger('timeline-lore-filter-changed', Array.from(selected));
					void this.refresh();
				}
			});
		}

		// 筛选后渲染
		let filtered = entries;
		if (this.filterType !== 'all') {
			filtered = filtered.filter(e => e.type === this.filterType);
		}
		if (this.selectedLores.size > 0) {
			filtered = filtered.filter(e => (e.lores || []).some(lore => this.selectedLores.has(lore)));
		}

		if (filtered.length === 0) {
			container.createDiv({ cls: 'wn-timeline-view-empty' }).createEl('p', { text: t('common.no-matching-entries') });
			return;
		}

		const displayEntries = this.isDescending ? [...filtered].reverse() : filtered;

		const timeline = container.createDiv({ cls: 'wn-timeline-list' });
		if (this.isDescending) {
			timeline.addClass('is-descending');
		}
		displayEntries.forEach((entry, displayIndex) => {
			const originalIndex = entries.indexOf(entry);
			const isLast = displayIndex === displayEntries.length - 1;
			if (this.editingIndex === originalIndex) {
				this.renderEditForm(timeline, entry, originalIndex, entries);
			} else {
				this.renderEntry(timeline, entry, originalIndex, entries, isLast);
			}
		});
	}

	private renderEntry(container: HTMLElement, entry: TimelineEntry, index: number, allEntries: TimelineEntry[], isLast?: boolean) {
		const item = container.createDiv({ cls: 'wn-timeline-item' });
		if (this.isDescending) {
			item.addClass('is-descending');
		}
		item.setAttribute('data-index', String(index));
		item.setAttribute('draggable', this.isDescending ? 'false' : 'true');

		// 拖拽事件
		const onDrag = rafThrottle((e: DragEvent) => {
			if (!e.clientX && !e.clientY) return; // 拖拽结束瞬间可能为 0
			const pointerX = e.clientX;
			const pointerY = e.clientY;
			const target = activeDocument.elementFromPoint(pointerX, pointerY) as HTMLElement;
			if (!target) return;
			const targetItem = target.closest('.wn-timeline-item') as HTMLElement;

			container.querySelectorAll('.wn-timeline-drag-over-top, .wn-timeline-drag-over-bottom').forEach(el => {
				if (el !== targetItem) {
					el.removeClass('wn-timeline-drag-over-top');
					el.removeClass('wn-timeline-drag-over-bottom');
				}
			});

			if (!targetItem) return;

			const rect = targetItem.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			if (pointerY < midY) {
				targetItem.removeClass('wn-timeline-drag-over-bottom');
				targetItem.addClass('wn-timeline-drag-over-top');
			} else {
				targetItem.removeClass('wn-timeline-drag-over-top');
				targetItem.addClass('wn-timeline-drag-over-bottom');
			}
		});

		item.addEventListener('dragstart', (e) => {
			if (this.isDescending) {
				e.preventDefault();
				return;
			}
			e.dataTransfer?.setData('text/plain', String(index));
			window.setTimeout(() => item.addClass('wn-timeline-dragging'), 0);
		});

		item.addEventListener('drag', onDrag);

		item.addEventListener('dragend', () => {
			onDrag.cancel();
			item.removeClass('wn-timeline-dragging');
			container.querySelectorAll('.wn-timeline-drag-over-top, .wn-timeline-drag-over-bottom').forEach(el => {
				el.removeClass('wn-timeline-drag-over-top');
				el.removeClass('wn-timeline-drag-over-bottom');
			});
		});

		// 仅用于允许放下（防止原生拦截）
		item.addEventListener('dragover', (e) => {
			if (this.isDescending) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		});

		item.addEventListener('drop', (e) => {
			if (this.isDescending) return;
			e.preventDefault();
			const data = e.dataTransfer?.getData('text/plain');
			container.querySelectorAll('.wn-timeline-drag-over-top, .wn-timeline-drag-over-bottom').forEach(el => {
				el.removeClass('wn-timeline-drag-over-top');
				el.removeClass('wn-timeline-drag-over-bottom');
			});
			if (!data) return;
			const fromIndex = parseInt(data, 10);
			if (isNaN(fromIndex)) return;
			const rect = item.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			let toIndex = e.clientY < midY ? index : index + 1;
			if (fromIndex < toIndex) toIndex -= 1;
			if (fromIndex !== -1 && fromIndex !== toIndex) {
				void (async () => {
					try {
						const newContent = await this.manager.moveEntry(fromIndex, toIndex, this.currentFolder);
						await this.renderFromContent(newContent || null);
					} catch (e) {
						console.error('[TimelineView] 移动记录失败:', e);
					}
				})();
			}
		});

		// 时间轴线
		const line = item.createDiv({ cls: 'wn-timeline-line' });
		line.createDiv({ cls: 'wn-timeline-dot' });
		const shouldRenderConnector = isLast !== undefined ? !isLast : (index < allEntries.length - 1);
		if (shouldRenderConnector) {
			line.createDiv({ cls: 'wn-timeline-connector' });
		}

		// 内容区
		const content = item.createDiv({ cls: 'wn-timeline-content' });

		// 拖拽手柄
		if (!this.isDescending) {
			content.createDiv({ cls: 'wn-timeline-drag-handle', text: '⠿' });
		}

		// 时间点（标题 - 点击直接跳转到时间线文件对应条目）
		const timeEl = content.createDiv({ cls: 'wn-timeline-time', text: entry.time });
		timeEl.title = t('common.jump-to-entry');
		timeEl.onclick = async (e) => {
			e.stopPropagation();
			const timelineFile = this.manager.getTimelineFile(this.currentFolder);
			if (!timelineFile) {
				new Notice(t('common.file-not-found', { name: this.getWatchFileName() }));
				return;
			}
			const fileCache = this.app.metadataCache.getFileCache(timelineFile);
			let fallbackLine: number | undefined;
			if (fileCache?.headings) {
				for (const h of fileCache.headings) {
					if (h.heading.trim() === entry.time.trim()) {
						fallbackLine = h.position.start.line;
						break;
					}
				}
			}
			await smartLocateAndHighlight(
				this.app,
				timelineFile,
				[`## ${entry.time}`, `# ${entry.time}`, entry.time],
				{ sourceLeaf: this.leaf, splitIfNew: true, fallbackLine }
			);
		};

		// 列表项（描述 + 章节链接）
		const itemsToRender = entry.items && entry.items.length > 0
			? entry.items
			: [{ description: entry.description, chapter: entry.chapter }];

		for (const it of itemsToRender) {
			if (!it.description && !it.chapter) continue;
			const itemEl = content.createDiv({ cls: 'wn-timeline-list-item' });
			if (it.description) {
				const descEl = itemEl.createDiv({ cls: 'wn-timeline-desc' });
				const descTextEl = descEl.createSpan({ cls: 'wn-timeline-desc-text' });
				// 支持多行描述：将换行符转换为 <br> 标签
				const lines = it.description.split('\n');
				lines.forEach((line, index) => {
					descTextEl.appendText(line);
					if (index < lines.length - 1) {
						descTextEl.createEl('br');
					}
				});
			}

			// 支持多章节：将逗号分隔的章节显示为多个链接
			if (it.chapter) {
				const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
				const linksContainer = itemEl.createDiv({ cls: 'wn-timeline-chapter-links' });

				chapters.forEach((chapterName, index) => {
					const link = linksContainer.createEl('a', {
						text: ChapterSorter.extractWikilinkDisplay(chapterName),
						cls: 'wn-timeline-chapter-link'
					});
					link.onclick = () => {
						void (async () => {
							try {
								const timelineFile = this.manager.getTimelineFile(this.currentFolder);
								const sourcePath = timelineFile?.path || '';
								const file = ChapterSorter.resolveChapterFile(
									this.app,
									this.plugin,
									this.currentFolder,
									chapterName,
									{ sourcePath }
								);
								if (file) {
									// 优先使用 origin 提供精确高亮，否则降级使用 description
									const searchText = it.origin || it.description || '';
									await this.openFileWithSmartLocate(file, searchText);
								}
								else new Notice(t('common.file-not-found', { name: ChapterSorter.extractWikilinkDisplay(chapterName) }));
							} catch (e) { console.error(e); }
						})();
					};

					// 在链接之间添加分隔符
					if (index < chapters.length - 1) {
						linksContainer.createSpan({ text: ', ', cls: 'wn-timeline-chapter-separator' });
					}
				});
			}
		}

		// 底部信息行（类型标签）
		const footer = content.createDiv({ cls: 'wn-timeline-footer' });
		if (entry.type) {
			footer.createSpan({ text: entry.type, cls: 'wn-timeline-type-tag' });
		}
		if (entry.lores && entry.lores.length > 0) {
			const loreContainer = footer.createSpan({ cls: 'wn-timeline-view-lore-badges' });
			renderLoreBadges(loreContainer, entry.lores, this.currentFolder, this.plugin, true, 0);
		}

		// 操作按钮（悬停显示）
		const actions = content.createDiv({ cls: 'wn-timeline-actions' });

		const editBtn = actions.createEl('button', { text: t('common.edit'), cls: 'wn-timeline-action-btn' });
		editBtn.onclick = () => {
			this.editingIndex = index;
			void this.refresh();
		};

		const deleteBtn = actions.createEl('button', { text: t('common.delete'), cls: 'wn-timeline-action-btn timeline-delete-btn' });
		deleteBtn.onclick = () => {
			void (async () => {
				try {
					const newContent = await this.manager.deleteEntry(index, this.currentFolder);
					await this.renderFromContent(newContent || null);
				} catch (e) { console.error(e); }
			})();
		};
	}

	private renderEditForm(container: HTMLElement, entry: TimelineEntry, index: number, allEntries: TimelineEntry[]) {
		const component = new TimelineFormComponent({
			container,
			app: this.app,
			context: this.plugin,
			folderPath: this.currentFolder,
			initialEntry: entry,
			typeOptions: this.getTypeFilterOptions(allEntries),
			submitText: t('common.save'),
			onCancel: () => {
				this.editingIndex = -1;
				void this.refresh();
			},
			onSubmit: (updated: TimelineEntry) => {
				void (async () => {
					try {
						const newContent = await this.manager.updateEntry(index, updated, this.currentFolder);
						this.editingIndex = -1;
						await this.renderFromContent(newContent);
					} catch (e) { console.error(e); }
				})();
			}
		});
		component.render();
	}

	// ─── 文件操作 ───────────────────────────────────────

	async appendEntry(entry: TimelineEntry): Promise<string> {
		return await this.manager.appendEntry(entry, this.currentFolder);
	}
}
