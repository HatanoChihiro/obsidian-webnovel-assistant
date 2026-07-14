import type { WorkspaceLeaf, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import type { TimelineEntry } from '../services/TimelineManager';
import { TimelineManager } from '../services/TimelineManager';
import { CreativeView } from './CreativeView';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { rafThrottle } from '../utils/dom';
import { t } from '../i18n';
import { getDefaultFileName } from '../i18n/data-keys';
import { ChapterSorter } from '../services/ChapterSorter';
import { TimelineAddModal } from './TimelineAddModal';

export const TIMELINE_VIEW_TYPE = 'wn-timeline-view';



/**
 * 时间线视图
 * 在侧边栏显示当前文件夹的时间线，支持内联编辑和从正文添加
 */
export class TimelineView extends CreativeView {
	private manager!: TimelineManager;
	private editingIndex: number = -1;
	private filterType: string = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf, plugin);
		this.manager = new TimelineManager(this.app, this.plugin);
	}

	getViewType() { return TIMELINE_VIEW_TYPE; }
	getDisplayText() { return t('view.timeline'); }
	getIcon() { return 'calendar-clock'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName');
	}

	protected async onFolderChange() {
		this.manager.currentFolder = this.currentFolder;
		this.editingIndex = -1;
		this.filterType = 'all';
		this.app.workspace.trigger('timeline-filter-changed', 'all');
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

	private getTypeFilterOptions(entries: TimelineEntry[]): string[] {
		const fromSettings = this.plugin.settings.timeline?.defaultTypes || [];
		const fromEntries = entries.map(e => e.type).filter(Boolean);
		return [...new Set([...fromSettings, ...fromEntries])];
	}

	async refresh() {
		const file = this.manager.getTimelineFile();
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

		const addBtn = titleRow.createEl('button', { cls: 'wn-timeline-add-btn', title: t('modal.new-event') });
		addBtn.setText('+');
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
							const newContent = await this.manager.appendEntry(entry);
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
						await this.manager.createTimelineFile();
						await this.refresh();
					} catch (e) { console.error(e); }
				})();
			};
			return;
		}

		const entries = this.manager.parseEntries(content);

		// 类型筛选
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

		// 筛选后渲染
		const filtered = this.filterType === 'all'
			? entries
			: entries.filter(e => e.type === this.filterType);

		if (filtered.length === 0) {
			container.createDiv({ cls: 'wn-timeline-view-empty' }).createEl('p', { text: t('common.no-matching-entries') });
			return;
		}

		const timeline = container.createDiv({ cls: 'wn-timeline-list' });
		filtered.forEach(entry => {
			const originalIndex = entries.indexOf(entry);
			if (this.editingIndex === originalIndex) {
				this.renderEditForm(timeline, entry, originalIndex, entries);
			} else {
				this.renderEntry(timeline, entry, originalIndex, entries);
			}
		});
	}

	private renderEntry(container: HTMLElement, entry: TimelineEntry, index: number, allEntries: TimelineEntry[]) {
		const item = container.createDiv({ cls: 'wn-timeline-item' });
		item.setAttribute('data-index', String(index));
		item.setAttribute('draggable', 'true');

		// 拖拽事件
		const onDrag = rafThrottle((e: DragEvent) => {
			if (!e.clientX && !e.clientY) return; // 拖拽结束瞬间可能为 0
			const pointerX = e.clientX;
			const pointerY = e.clientY;
			const target = activeDocument.elementFromPoint(pointerX, pointerY) as HTMLElement;
			if (!target) return;
			const targetItem = target.closest('.webnov timeline-item') as HTMLElement;

			container.querySelectorAll('.webnov timeline-drag-over-top, .webnov timeline-drag-over-bottom').forEach(el => {
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
			e.dataTransfer?.setData('text/plain', String(index));
			window.setTimeout(() => item.addClass('wn-timeline-dragging'), 0);
		});

		item.addEventListener('drag', onDrag);

		item.addEventListener('dragend', () => {
			onDrag.cancel();
			item.removeClass('wn-timeline-dragging');
			container.querySelectorAll('.webnov timeline-drag-over-top, .webnov timeline-drag-over-bottom').forEach(el => {
				el.removeClass('wn-timeline-drag-over-top');
				el.removeClass('wn-timeline-drag-over-bottom');
			});
		});

		// 仅用于允许放下（防止原生拦截）
		item.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		});

		item.addEventListener('drop', (e) => {
			e.preventDefault();
			const fromIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
			const rect = item.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			// 鼠标在上半部分：插入到目标之前；下半部分：插入到目标之后
			let toIndex = e.clientY < midY ? index : index + 1;
			// 调整：如果从上方拖到下方，toIndex 需要减 1
			if (fromIndex < toIndex) toIndex -= 1;
			item.removeClass('wn-timeline-drag-over-top');
			item.removeClass('wn-timeline-drag-over-bottom');
			if (fromIndex !== -1 && fromIndex !== toIndex) {
				void (async () => {
					try {
						const newContent = await this.manager.moveEntry(fromIndex, toIndex);
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
		if (index < allEntries.length - 1) {
			line.createDiv({ cls: 'wn-timeline-connector' });
		}

		// 内容区
		const content = item.createDiv({ cls: 'wn-timeline-content' });

		// 拖拽手柄
		content.createDiv({ cls: 'wn-timeline-drag-handle', text: '⠿' });

		// 时间点
		content.createDiv({ cls: 'wn-timeline-time', text: entry.time });

		// 列表项（描述 + 章节链接）
		const itemsToRender = entry.items && entry.items.length > 0
			? entry.items
			: [{ description: entry.description, chapter: entry.chapter }];

		for (const it of itemsToRender) {
			if (!it.description && !it.chapter) continue;
			const itemEl = content.createDiv({ cls: 'wn-timeline-list-item' });
			if (it.description) {
				const descEl = itemEl.createDiv({ cls: 'wn-timeline-desc' });
				// 支持多行描述：将换行符转换为 <br> 标签
				const lines = it.description.split('\n');
				lines.forEach((line, index) => {
					descEl.appendText(line);
					if (index < lines.length - 1) {
						descEl.createEl('br');
					}
				});
			}

			// 支持多章节：将逗号分隔的章节显示为多个链接
			if (it.chapter) {
				const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
				const linksContainer = itemEl.createDiv({ cls: 'wn-timeline-chapter-links' });

				chapters.forEach((chapterName, index) => {
					const link = linksContainer.createEl('a', {
						text: chapterName,
						cls: 'wn-timeline-chapter-link'
					});
					link.onclick = () => {
						void (async () => {
							try {
								const sourcePath = this.currentFolder ? this.currentFolder + '/timeline.md' : '';
								const file = this.app.metadataCache.getFirstLinkpathDest(chapterName, sourcePath);
								if (file) {
									// 优先使用 origin 提供精确高亮，否则降级使用 description
									const searchText = it.origin || it.description || '';
									await this.openFileWithSmartLocate(file, searchText);
								}
								else new Notice(t('common.file-not-found', { name: chapterName }));
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
					const newContent = await this.manager.deleteEntry(index);
					await this.renderFromContent(newContent || null);
				} catch (e) { console.error(e); }
			})();
		};
	}

	private renderEditForm(container: HTMLElement, entry: TimelineEntry, index: number, allEntries: TimelineEntry[]) {
		const form = container.createDiv({ cls: 'wn-timeline-edit-form' });

		// 时间点
		form.createEl('label', { text: t('modal.time-point'), cls: 'wn-timeline-form-label' });
		const timeInput = form.createEl('input', { type: 'text', cls: 'wn-timeline-form-input' });
		timeInput.value = entry.time;
		timeInput.placeholder = t('modal.time-point-desc');

		// 事件列表标题
		form.createEl('label', { text: t('modal.event-list'), cls: 'wn-timeline-form-label' });
		form.createDiv({ cls: 'wn-timeline-form-hint', text: t('modal.event-list-hint') })


		// 事件列表容器
		const eventsContainer = form.createDiv();
		eventsContainer.setCssProps({ marginBottom: '12px' });
		const targetFiles = ChapterSorter.getAllChapters(this.app, this.plugin, this.currentFolder);
		const chapterFiles: string[] = targetFiles.map(c => c.basename);

		// 获取已有的事件列表
		const existingItems = entry.items && entry.items.length > 0 ? entry.items : [{ description: entry.description, chapter: entry.chapter }];

		// 创建单个事件编辑块
		const createEventBlock = (item: { description: string; chapter: string } = { description: '', chapter: '' }) => {
			const eventBlock = eventsContainer.createDiv({ cls: 'wn-timeline-event-block' });
			eventBlock.addClass('webnovel-modal-event-block');
			// 事件描述
			eventBlock.createEl('label', { text: t('modal.event-desc-label'), cls: 'wn-timeline-form-label' });
			const descInput = eventBlock.createEl('textarea', { cls: 'wn-timeline-form-textarea' });
			descInput.value = item.description;
			descInput.placeholder = t('modal.event-desc-placeholder');
			descInput.addClass('webnovel-tl-desc-input-edit');
			// 关联章节
			eventBlock.createEl('label', { text: t('modal.related-chapters'), cls: 'wn-timeline-form-label' });
			const chapterListContainer = eventBlock.createDiv();
			chapterListContainer.setCssProps({ marginBottom: '8px' });
			// 解析已有的章节
			const existingChapters = item.chapter ? item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];

			// 创建章节选择行
			const createChapterRow = (initialValue: string = '') => {
				const row = chapterListContainer.createDiv();
				row.addClass('webnovel-tl-chapter-row-sm');
				const select = row.createEl('select', { cls: 'wn-timeline-form-input' });
				select.setCssProps({ flex: '1' });
				select.createEl('option', { value: '', text: t('modal.select-chapter') });
				chapterFiles.forEach(file => {
					const option = select.createEl('option', { value: file, text: file });
					if (file === initialValue) option.selected = true;
				});

				const removeBtn = row.createEl('button', { text: '−' });
				removeBtn.addClass('webnovel-tl-remove-btn-sm');
				removeBtn.onclick = () => {
					row.remove();
					if (chapterListContainer.children.length === 1) createChapterRow();
				};

				return { row, select };
			};

			// 初始化章节行
			if (existingChapters.length > 0) {
				existingChapters.forEach(chapter => createChapterRow(chapter));
			} else {
				createChapterRow();
			}

			// 添加章节按钮
			const addChapterBtn = chapterListContainer.createEl('button', { text: t('modal.add-chapter') });
			addChapterBtn.addClass('webnovel-tl-add-btn-sm');
			addChapterBtn.onclick = () => {
				const { row } = createChapterRow();
				chapterListContainer.insertBefore(row, addChapterBtn);
			};

			// 删除事件按钮
			const deleteEventBtn = eventBlock.createEl('button', { text: t('modal.delete-this-event') });
			deleteEventBtn.addClass('webnovel-tl-delete-event-btn');
			deleteEventBtn.onclick = () => {
				eventBlock.remove();
				// 至少保留一个事件块
				if (eventsContainer.querySelectorAll('.webnovel-modal-event-block').length === 0) {
					createEventBlock();
				}
			};

			return { eventBlock, descInput, chapterListContainer };
		};

		// 初始化：为每个已有事件创建编辑块
		existingItems.forEach(item => createEventBlock(item));

		// 添加事件按钮
		const addEventBtn = eventsContainer.createEl('button', { text: t('modal.add-event') });
		addEventBtn.addClass('webnovel-tl-add-event-btn');
		addEventBtn.onclick = () => {
			const { eventBlock } = createEventBlock();
			eventsContainer.insertBefore(eventBlock, addEventBtn);
		};

		// 类型
		form.createEl('label', { text: t('modal.type-optional'), cls: 'wn-timeline-form-label' });
		const typeSelect = form.createEl('select', { cls: 'wn-timeline-form-input' });

		typeSelect.createEl('option', { value: '', text: t('modal.select-type') });
		// 合并全局默认类型 + 文件已有类型
		const editTypeOptions = this.getTypeFilterOptions(allEntries);
		editTypeOptions.forEach((type: string) => {
			const option = typeSelect.createEl('option', { value: type, text: type });
			if (type === entry.type) option.selected = true;
		});
		typeSelect.createEl('option', { value: '__custom__', text: t('modal.custom-type') });

		const customInput = form.createEl('input', { type: 'text', cls: 'wn-timeline-form-input' });
		customInput.placeholder = t('modal.custom-type-placeholder');
		customInput.addClass('webnovel-tl-custom-hidden');
		if (entry.type && !editTypeOptions.includes(entry.type)) {
			typeSelect.value = '__custom__';
			customInput.value = entry.type;
			customInput.setCssProps({ display: 'block' });
		}

		typeSelect.addEventListener('change', () => {
			if (typeSelect.value === '__custom__') {
				customInput.setCssProps({ display: 'block' });
				customInput.focus();
			} else {
				customInput.setCssProps({ display: 'none' });
			}
		});

		// 按钮
		const btnRow = form.createDiv({ cls: 'wn-timeline-form-btns' });
		const cancelBtn = btnRow.createEl('button', { text: t('common.cancel'), cls: 'wn-timeline-action-btn' });
		cancelBtn.onclick = () => {
			this.editingIndex = -1;
			void this.refresh();
		};
		const saveBtn = btnRow.createEl('button', { text: t('common.save'), cls: 'wn-timeline-action-btn mod-cta' });
		saveBtn.onclick = () => {
			void (async () => {
				try {
					// 收集所有事件
					const items: { description: string; chapter: string }[] = [];
					const eventBlocks = eventsContainer.querySelectorAll('.webnovel-modal-event-block');

					eventBlocks.forEach((block) => {
						const htmlBlock = block as HTMLElement;
						const descInput = htmlBlock.querySelector('textarea') as HTMLTextAreaElement;
						const description = descInput.value.trim();

						// 收集该事件的所有章节
						const chapters: string[] = [];
						const selects = htmlBlock.querySelectorAll('select');
						selects.forEach((select: HTMLSelectElement) => {
							const value = select.value.trim();
							if (value) chapters.push(value);
						});
						const chapter = [...new Set(chapters)].join(', '); // 去重

						// 只添加有描述或有章节的事件
						if (description || chapter) {
							items.push({ description, chapter });
						}
					});

					// 如果没有任何事件，至少保留一个空事件
					if (items.length === 0) {
						items.push({ description: '', chapter: '' });
					}

					// 获取类型值
					let typeValue = typeSelect.value;
					if (typeValue === '__custom__') {
						typeValue = customInput.value.trim();
					}
					const updated: TimelineEntry = {
						time: timeInput.value.trim(),
						description: items.map(it => it.description).filter(Boolean).join('\n'),
						chapter: items.map(it => it.chapter).filter(Boolean).join(', '),
						type: typeValue,
						rawBlock: entry.rawBlock,
						items: items,
					};

					if (!updated.time) {
						new Notice(t('modal.please-fill-time-point'));
						timeInput.focus();
						return;
					}

					const newContent = await this.manager.updateEntry(index, updated);
					this.editingIndex = -1;
					await this.renderFromContent(newContent);
				} catch (e) { console.error(e); }
			})();
		};

		window.setTimeout(() => timeInput.focus(), 50);
	}



	// ─── 文件操作 ───────────────────────────────────────

	async appendEntry(entry: TimelineEntry): Promise<string> {
		this.manager.currentFolder = this.currentFolder;
		return await this.manager.appendEntry(entry);
	}

	/**
	 * 从正文添加到时间线（供 main.ts 调用）
	 * 直接弹出 Modal，不依赖面板状态
	 */
	async addFromSelection(selectedText: string, sourceFile: string, folderPath: string): Promise<void> {
		// 确保时间线文件存在
		const fileName = (this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName')) + '.md';
		const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
		let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
		if (!file) {
			file = await this.app.vault.create(filePath, `# ${this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName')}\n\n`);
			new Notice(t('notice.webnov timeline-file-created', { name: fileName }));
		}

		// 读取已有条目中的类型，传入 Modal 供选择
		const existingContent = await this.app.vault.read(file);
		const existingEntries = this.manager.parseEntries(existingContent);
		const localTypes = [...new Set(existingEntries.map(e => e.type).filter(Boolean))];

		// 弹出输入 Modal
		const modal = new TimelineAddModal(
			this.app,
			this.plugin,
			selectedText.trim(),
			sourceFile,
			folderPath,
			(entry) => {
				void (async () => {
					try {
						const existing = await this.app.vault.read(file);
						const separator = existing.endsWith('\n') ? '' : '\n';
						await this.app.vault.process(file, () => existing + separator + this.manager.formatEntry(entry));
						new Notice(t('notice.webnov timeline-added'));
						// 如果面板已打开，刷新
						const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
						if (leaves.length > 0) {
							void (leaves[0].view as TimelineView).refresh();
						}
					} catch (e) {
						console.error('[TimelineView] 写入新记录失败:', e);
					}
				})();
			},
			true, // 返回完整 TimelineEntry
			localTypes
		);
		modal.open();
	}
}
