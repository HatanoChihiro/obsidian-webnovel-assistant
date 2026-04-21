import { ItemView, MarkdownView, Menu, Modal, Notice, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { TimelineManager, TimelineEntry } from '../services/TimelineManager';
import { CreativeView } from './CreativeView';

type AccurateChineseCountPlugin = any;

export const TIMELINE_VIEW_TYPE = 'timeline-view';

/**
 * 添加到时间线的输入对话框（供 main.ts 直接使用）
 */
/**
 * 统一的时间线条目添加对话框
 * 支持两种模式：
 * 1. 从选中文本添加（TimelineAddFromSelectionModal 的替代）
 * 2. 从时间线视图添加（TimelineAddModal 的替代）
 */
export class TimelineAddModal extends Modal {
	private description: string;
	private sourceFile: string;
	private folderPath: string;
	private onSubmit: (entry: any) => void;
	private returnFullEntry: boolean; // true 时返回完整 TimelineEntry，false 时返回简化对象
	private plugin: AccurateChineseCountPlugin;

	constructor(
		app: any,
		plugin: AccurateChineseCountPlugin,
		description: string,
		sourceFile: string,
		folderPath: string,
		onSubmit: (entry: any) => void,
		returnFullEntry: boolean = true
	) {
		super(app);
		this.plugin = plugin;
		this.description = description;
		this.sourceFile = sourceFile;
		this.folderPath = folderPath;
		this.onSubmit = onSubmit;
		this.returnFullEntry = returnFullEntry;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '添加到时间线' });

		const inputStyle = 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;';

		new Setting(contentEl).setName('时间点').setDesc('例如：永历三年春 / 2024-03-15');
		const timeInput = contentEl.createEl('input', { type: 'text' });
		timeInput.placeholder = '时间点（必填）';
		timeInput.style.cssText = inputStyle;

		new Setting(contentEl).setName('事件描述');
		const descInput = contentEl.createEl('textarea');
		descInput.value = this.description;
		descInput.style.cssText = inputStyle + 'height:80px;resize:vertical;font-family:var(--font-text);';

		new Setting(contentEl)
			.setName('关联章节（可选）')
			.setDesc('点击 + 号添加更多章节');
		
		// 章节列表容器
		const chapterListContainer = contentEl.createDiv();
		chapterListContainer.style.cssText = 'margin-bottom:12px;';
		
		// 获取当前文件夹下的所有 md 文件
		const getChapterFiles = (): string[] => {
			const folder = this.folderPath ? this.app.vault.getAbstractFileByPath(this.folderPath) : null;
			if (folder && 'children' in folder) {
				return (folder as any).children
					.filter((c: any) => c.extension === 'md')
					.map((c: any) => c.basename)
					.sort();
			}
			return [];
		};
		
		const chapterFiles = getChapterFiles();
		const selectedChapters: string[] = this.sourceFile ? [this.sourceFile] : [];
		
		// 创建章节选择行
		const createChapterRow = (initialValue: string = '') => {
			const row = chapterListContainer.createDiv();
			row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
			
			const select = row.createEl('select');
			select.style.cssText = 'flex:1;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';
			
			// 添加空选项
			select.createEl('option', { value: '', text: '-- 选择章节 --' });
			
			// 添加所有章节选项
			chapterFiles.forEach(file => {
				const option = select.createEl('option', { value: file, text: file });
				if (file === initialValue) option.selected = true;
			});
			
			// 删除按钮
			const removeBtn = row.createEl('button', { text: '−', cls: 'timeline-chapter-remove-btn' });
			removeBtn.style.cssText = 'width:32px;height:32px;padding:0;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;font-size:20px;line-height:1;';
			removeBtn.title = '删除此章节';
			removeBtn.onclick = () => {
				row.remove();
				// 如果没有章节行了，至少保留一个空行
				if (chapterListContainer.children.length === 1) { // 只剩添加按钮
					createChapterRow();
				}
			};
			
			return { row, select };
		};
		
		// 初始化：如果有 sourceFile，添加一行；否则添加空行
		if (this.sourceFile) {
			createChapterRow(this.sourceFile);
		} else {
			createChapterRow();
		}
		
		// 添加按钮
		const addBtn = chapterListContainer.createEl('button', { text: '+ 添加章节', cls: 'timeline-chapter-add-btn' });
		addBtn.style.cssText = 'width:100%;padding:6px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:4px;';
		addBtn.onclick = () => {
			// 在添加按钮之前插入新行
			const { row } = createChapterRow();
			chapterListContainer.insertBefore(row, addBtn);
		};

		new Setting(contentEl).setName('类型（可选）');
		const typeSelect = contentEl.createEl('select');
		typeSelect.style.cssText = inputStyle;
		
		// 添加空选项
		const emptyOption = typeSelect.createEl('option', { value: '', text: '-- 选择类型 --' });
		
		// 从设置中获取默认类型列表
		const defaultTypes = this.plugin.settings.timeline?.defaultTypes || ['主线', '支线', '伏笔', '世界观', '人物'];
		defaultTypes.forEach((type: string) => {
			typeSelect.createEl('option', { value: type, text: type });
		});
		
		// 添加"自定义"选项
		const customOption = typeSelect.createEl('option', { value: '__custom__', text: '-- 自定义 --' });
		
		// 自定义输入框（初始隐藏）
		const customInput = contentEl.createEl('input', { type: 'text' });
		customInput.placeholder = '输入自定义类型';
		customInput.style.cssText = inputStyle + 'display:none;margin-top:4px;';
		
		// 切换显示自定义输入框
		typeSelect.addEventListener('change', () => {
			if (typeSelect.value === '__custom__') {
				customInput.style.display = 'block';
				customInput.focus();
			} else {
				customInput.style.display = 'none';
			}
		});

		const btnContainer = contentEl.createDiv();
		btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:16px;';
		btnContainer.createEl('button', { text: '取消' }).onclick = () => this.close();
		const saveBtn = btnContainer.createEl('button', { text: '添加', cls: 'mod-cta' });
		saveBtn.onclick = async () => {
			const time = timeInput.value.trim();
			if (!time) { new Notice('请填写时间点'); timeInput.focus(); return; }
			
			// 收集所有选中的章节
			const chapters: string[] = [];
			const selects = chapterListContainer.querySelectorAll('select');
			selects.forEach((select: HTMLSelectElement) => {
				const value = select.value.trim();
				if (value) chapters.push(value);
			});
			const uniqueChapters = [...new Set(chapters)]; // 去重
			
			// 获取类型值：如果选择了自定义，使用自定义输入框的值
			let typeValue = typeSelect.value;
			if (typeValue === '__custom__') {
				typeValue = customInput.value.trim();
				// 如果是自定义类型且不为空，添加到设置中
				if (typeValue && !this.plugin.settings.timeline.defaultTypes.includes(typeValue)) {
					this.plugin.settings.timeline.defaultTypes.push(typeValue);
					await this.plugin.saveSettings();
				}
			}
			
			const entry = {
				time,
				description: descInput.value.trim(),
				chapter: uniqueChapters.join(', '), // 用逗号+空格连接
				type: typeValue,
			};
			// 如果需要返回完整 TimelineEntry，添加 rawBlock 字段
			if (this.returnFullEntry) {
				(entry as any).rawBlock = '';
			}
			this.onSubmit(entry);
			this.close();
		};
		setTimeout(() => timeInput.focus(), 50);
	}

	onClose() { this.contentEl.empty(); }
}

/**
 * @deprecated 使用 TimelineAddModal 替代，传入 returnFullEntry=false
 */
export class TimelineAddFromSelectionModal extends TimelineAddModal {
	constructor(
		app: any,
		plugin: AccurateChineseCountPlugin,
		timelineFileName: string,
		description: string,
		sourceFile: string,
		folderPath: string,
		onSubmit: (entry: { time: string; description: string; chapter: string; type: string }) => void
	) {
		super(app, plugin, description, sourceFile, folderPath, onSubmit, false);
	}
}

/**
 * 时间线视图
 * 在侧边栏显示当前文件夹的时间线，支持内联编辑和从正文添加
 */
export class TimelineView extends CreativeView {
	private manager!: TimelineManager;
	private editingIndex: number = -1;

	constructor(leaf: WorkspaceLeaf, plugin: AccurateChineseCountPlugin) {
		super(leaf, plugin);
		this.manager = new TimelineManager(this.app, this.plugin);
	}

	getViewType() { return TIMELINE_VIEW_TYPE; }
	getDisplayText() { return '时间线'; }
	getIcon() { return 'calendar-clock'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.timeline?.fileName || '时间线';
	}

	protected async onFolderChange() {
		this.manager.currentFolder = this.currentFolder;
		this.editingIndex = -1;
		await this.refresh();
	}

	async refresh() {
		const file = this.manager.getTimelineFile();
		const content = file ? await this.app.vault.read(file) : null;
		await this.renderFromContent(content);
	}

	async renderFromContent(content: string | null) {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('timeline-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'timeline-view-header' });
		const titleRow = header.createDiv({ cls: 'timeline-view-title-row' });
		titleRow.createSpan({ text: '时间线', cls: 'timeline-view-title' });

		const addBtn = titleRow.createEl('button', { cls: 'timeline-add-btn', title: '新增事件' });
		addBtn.innerHTML = '+';
		addBtn.onclick = () => this.showAddForm(container);

		header.createDiv({ cls: 'timeline-view-folder', text: this.currentFolder || '根目录' });

		// 用传入的 content，或者文件不存在时显示空状态
		if (content === null) {
			const empty = container.createDiv({ cls: 'timeline-view-empty' });
			const fileName = this.plugin.settings.timeline?.fileName || '时间线';
			empty.createEl('p', { text: '当前文件夹下没有时间线文件' });
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'timeline-view-hint' });
			const createBtn = empty.createEl('button', { text: '创建时间线文件', cls: 'mod-cta timeline-create-btn' });
			createBtn.onclick = async () => {
				await this.manager.createTimelineFile();
				await this.refresh();
			};
			return;
		}

		const entries = this.manager.parseEntries(content);

		if (entries.length === 0) {
			container.createDiv({ cls: 'timeline-view-empty' }).createEl('p', { text: '时间线为空，点击 + 添加第一个事件' });
			return;
		}

		const timeline = container.createDiv({ cls: 'timeline-list' });
		entries.forEach((entry, index) => {
			if (this.editingIndex === index) {
				this.renderEditForm(timeline, entry, index, entries);
			} else {
				this.renderEntry(timeline, entry, index, entries);
			}
		});
	}

	private renderEntry(container: HTMLElement, entry: TimelineEntry, index: number, allEntries: TimelineEntry[]) {
		const item = container.createDiv({ cls: 'timeline-item' });
		item.setAttribute('data-index', String(index));
		item.setAttribute('draggable', 'true');

		// 拖拽事件
		item.addEventListener('dragstart', (e) => {
			e.dataTransfer?.setData('text/plain', String(index));
			setTimeout(() => item.addClass('timeline-dragging'), 0);
		});
		item.addEventListener('dragend', () => {
			item.removeClass('timeline-dragging');
			container.querySelectorAll('.timeline-drag-over-top, .timeline-drag-over-bottom').forEach(el => {
				el.removeClass('timeline-drag-over-top');
				el.removeClass('timeline-drag-over-bottom');
			});
		});
		item.addEventListener('dragover', (e) => {
			e.preventDefault();
			container.querySelectorAll('.timeline-drag-over-top, .timeline-drag-over-bottom').forEach(el => {
				el.removeClass('timeline-drag-over-top');
				el.removeClass('timeline-drag-over-bottom');
			});
			const rect = item.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			if (e.clientY < midY) {
				item.addClass('timeline-drag-over-top');
			} else {
				item.addClass('timeline-drag-over-bottom');
			}
		});
		item.addEventListener('dragleave', (e) => {
			// 只在真正离开条目时清除
			if (!item.contains(e.relatedTarget as Node)) {
				item.removeClass('timeline-drag-over-top');
				item.removeClass('timeline-drag-over-bottom');
			}
		});
		item.addEventListener('drop', async (e) => {
			e.preventDefault();
			const fromIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
			const rect = item.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			// 鼠标在上半部分：插入到目标之前；下半部分：插入到目标之后
			let toIndex = e.clientY < midY ? index : index + 1;
			// 调整：如果从上方拖到下方，toIndex 需要减 1
			if (fromIndex < toIndex) toIndex -= 1;
			item.removeClass('timeline-drag-over-top');
			item.removeClass('timeline-drag-over-bottom');
			if (fromIndex !== -1 && fromIndex !== toIndex) {
				const newContent = await this.manager.moveEntry(fromIndex, toIndex);
				await this.renderFromContent(newContent || null);
			}
		});

		// 时间轴线
		const line = item.createDiv({ cls: 'timeline-line' });
		line.createDiv({ cls: 'timeline-dot' });
		if (index < allEntries.length - 1) {
			line.createDiv({ cls: 'timeline-connector' });
		}

		// 内容区
		const content = item.createDiv({ cls: 'timeline-content' });

		// 拖拽手柄
		content.createDiv({ cls: 'timeline-drag-handle', text: '⠿' });

		// 时间点
		content.createDiv({ cls: 'timeline-time', text: entry.time });

		// 列表项（描述 + 章节链接）
		const itemsToRender = entry.items && entry.items.length > 0
			? entry.items
			: [{ description: entry.description, chapter: entry.chapter }];

		for (const it of itemsToRender) {
			if (!it.description && !it.chapter) continue;
			const itemEl = content.createDiv({ cls: 'timeline-list-item' });
			if (it.description) {
				itemEl.createDiv({ text: it.description, cls: 'timeline-desc' });
			}
			
			// 支持多章节：将逗号分隔的章节显示为多个链接
			if (it.chapter) {
				const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
				const linksContainer = itemEl.createDiv({ cls: 'timeline-chapter-links' });
				
				chapters.forEach((chapterName, index) => {
					const link = linksContainer.createEl('a', { 
						text: chapterName, 
						cls: 'timeline-chapter-link' 
					});
					link.onclick = async () => {
						const file = this.app.vault.getMarkdownFiles().find(f => f.basename === chapterName);
						if (file) await this.app.workspace.getLeaf(false).openFile(file);
						else new Notice(`找不到文件：${chapterName}`);
					};
					
					// 在链接之间添加分隔符
					if (index < chapters.length - 1) {
						linksContainer.createSpan({ text: ', ', cls: 'timeline-chapter-separator' });
					}
				});
			}
		}

		// 底部信息行（类型标签）
		const footer = content.createDiv({ cls: 'timeline-footer' });
		if (entry.type) {
			footer.createSpan({ text: entry.type, cls: 'timeline-type-tag' });
		}

		// 操作按钮（悬停显示）
		const actions = content.createDiv({ cls: 'timeline-actions' });

		const editBtn = actions.createEl('button', { text: '编辑', cls: 'timeline-action-btn' });
		editBtn.onclick = () => {
			this.editingIndex = index;
			this.refresh();
		};

		const deleteBtn = actions.createEl('button', { text: '删除', cls: 'timeline-action-btn timeline-delete-btn' });
		deleteBtn.onclick = async () => {
			const newContent = await this.manager.deleteEntry(index);
			await this.renderFromContent(newContent || null);
		};
	}

	private renderEditForm(container: HTMLElement, entry: TimelineEntry, index: number, allEntries: TimelineEntry[]) {
		const form = container.createDiv({ cls: 'timeline-edit-form' });

		// 时间点
		form.createEl('label', { text: '时间点', cls: 'timeline-form-label' });
		const timeInput = form.createEl('input', { type: 'text', cls: 'timeline-form-input' });
		timeInput.value = entry.time;
		timeInput.placeholder = '例如：永历三年春 / 2024-03-15';

		// 事件列表标题
		form.createEl('label', { text: '事件列表', cls: 'timeline-form-label' });
		form.createDiv({ cls: 'timeline-form-hint', text: '每个事件可以有自己的描述和关联章节' })
			.style.cssText = 'font-size:0.85em;color:var(--text-muted);margin-bottom:8px;';
		
		// 事件列表容器
		const eventsContainer = form.createDiv();
		eventsContainer.style.cssText = 'margin-bottom:12px;';
		
		// 获取当前文件夹下的所有 md 文件
		const folder = this.app.vault.getAbstractFileByPath(this.currentFolder);
		const chapterFiles: string[] = [];
		if (folder && 'children' in folder) {
			(folder as any).children
				.filter((c: any) => c.extension === 'md')
				.forEach((c: any) => {
					chapterFiles.push(c.basename);
				});
			chapterFiles.sort();
		}
		
		// 获取已有的事件列表
		const existingItems = entry.items && entry.items.length > 0 ? entry.items : [{ description: entry.description, chapter: entry.chapter }];
		
		// 创建单个事件编辑块
		const createEventBlock = (item: { description: string; chapter: string } = { description: '', chapter: '' }) => {
			const eventBlock = eventsContainer.createDiv({ cls: 'timeline-event-block' });
			eventBlock.style.cssText = 'border:1px solid var(--background-modifier-border);border-radius:6px;padding:12px;margin-bottom:12px;background:var(--background-secondary);';
			
			// 事件描述
			eventBlock.createEl('label', { text: '事件描述', cls: 'timeline-form-label' });
			const descInput = eventBlock.createEl('textarea', { cls: 'timeline-form-textarea' });
			descInput.value = item.description;
			descInput.placeholder = '描述这个事件...';
			descInput.style.cssText = 'margin-bottom:8px;height:60px;';
			
			// 关联章节
			eventBlock.createEl('label', { text: '关联章节', cls: 'timeline-form-label' });
			const chapterListContainer = eventBlock.createDiv();
			chapterListContainer.style.cssText = 'margin-bottom:8px;';
			
			// 解析已有的章节
			const existingChapters = item.chapter ? item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];
			
			// 创建章节选择行
			const createChapterRow = (initialValue: string = '') => {
				const row = chapterListContainer.createDiv();
				row.style.cssText = 'display:flex;gap:8px;margin-bottom:4px;align-items:center;';
				
				const select = row.createEl('select', { cls: 'timeline-form-input' });
				select.style.cssText = 'flex:1;';
				
				select.createEl('option', { value: '', text: '-- 选择章节 --' });
				chapterFiles.forEach(file => {
					const option = select.createEl('option', { value: file, text: file });
					if (file === initialValue) option.selected = true;
				});
				
				const removeBtn = row.createEl('button', { text: '−' });
				removeBtn.style.cssText = 'width:28px;height:28px;padding:0;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;font-size:16px;';
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
			const addChapterBtn = chapterListContainer.createEl('button', { text: '+ 添加章节' });
			addChapterBtn.style.cssText = 'width:100%;padding:4px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;font-size:12px;margin-top:4px;';
			addChapterBtn.onclick = () => {
				const { row } = createChapterRow();
				chapterListContainer.insertBefore(row, addChapterBtn);
			};
			
			// 删除事件按钮
			const deleteEventBtn = eventBlock.createEl('button', { text: '删除此事件' });
			deleteEventBtn.style.cssText = 'width:100%;padding:6px;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:8px;';
			deleteEventBtn.onclick = () => {
				eventBlock.remove();
				// 至少保留一个事件块
				if (eventsContainer.querySelectorAll('.timeline-event-block').length === 0) {
					createEventBlock();
				}
			};
			
			return { eventBlock, descInput, chapterListContainer };
		};
		
		// 初始化：为每个已有事件创建编辑块
		existingItems.forEach(item => createEventBlock(item));
		
		// 添加事件按钮
		const addEventBtn = eventsContainer.createEl('button', { text: '+ 添加事件' });
		addEventBtn.style.cssText = 'width:100%;padding:8px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:8px;';
		addEventBtn.onclick = () => {
			const { eventBlock } = createEventBlock();
			eventsContainer.insertBefore(eventBlock, addEventBtn);
		};

		// 类型
		form.createEl('label', { text: '类型（可选）', cls: 'timeline-form-label' });
		const typeSelect = form.createEl('select', { cls: 'timeline-form-input' });
		
		typeSelect.createEl('option', { value: '', text: '-- 选择类型 --' });
		const defaultTypes = this.plugin.settings.timeline?.defaultTypes || ['主线', '支线', '伏笔', '世界观', '人物'];
		defaultTypes.forEach((type: string) => {
			const option = typeSelect.createEl('option', { value: type, text: type });
			if (type === entry.type) option.selected = true;
		});
		typeSelect.createEl('option', { value: '__custom__', text: '-- 自定义 --' });
		
		const customInput = form.createEl('input', { type: 'text', cls: 'timeline-form-input' });
		customInput.placeholder = '输入自定义类型';
		customInput.style.cssText = 'margin-top:4px;display:none;';
		
		if (entry.type && !defaultTypes.includes(entry.type)) {
			typeSelect.value = '__custom__';
			customInput.value = entry.type;
			customInput.style.display = 'block';
		}
		
		typeSelect.addEventListener('change', () => {
			if (typeSelect.value === '__custom__') {
				customInput.style.display = 'block';
				customInput.focus();
			} else {
				customInput.style.display = 'none';
			}
		});

		// 按钮
		const btnRow = form.createDiv({ cls: 'timeline-form-btns' });
		const cancelBtn = btnRow.createEl('button', { text: '取消', cls: 'timeline-action-btn' });
		cancelBtn.onclick = () => {
			this.editingIndex = -1;
			this.refresh();
		};
		const saveBtn = btnRow.createEl('button', { text: '保存', cls: 'timeline-action-btn mod-cta' });
		saveBtn.onclick = async () => {
			// 收集所有事件
			const items: { description: string; chapter: string }[] = [];
			const eventBlocks = eventsContainer.querySelectorAll('.timeline-event-block');
			
			eventBlocks.forEach((block: HTMLElement) => {
				const descInput = block.querySelector('textarea') as HTMLTextAreaElement;
				const description = descInput.value.trim();
				
				// 收集该事件的所有章节
				const chapters: string[] = [];
				const selects = block.querySelectorAll('select');
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
				if (typeValue && !this.plugin.settings.timeline.defaultTypes.includes(typeValue)) {
					this.plugin.settings.timeline.defaultTypes.push(typeValue);
					await this.plugin.saveSettings();
				}
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
				new Notice('请填写时间点');
				timeInput.focus();
				return;
			}
			
			const newContent = await this.manager.updateEntry(index, updated);
			this.editingIndex = -1;
			await this.renderFromContent(newContent);
		};

		setTimeout(() => timeInput.focus(), 50);
	}

	private showAddForm(container: HTMLElement) {
		// 如果已有添加表单，不重复创建
		if (container.querySelector('.timeline-add-form')) return;

		const form = container.createDiv({ cls: 'timeline-edit-form timeline-add-form' });

		form.createEl('div', { text: '新增事件', cls: 'timeline-form-title' });

		form.createEl('label', { text: '时间点', cls: 'timeline-form-label' });
		const timeInput = form.createEl('input', { type: 'text', cls: 'timeline-form-input' });
		timeInput.placeholder = '例如：永历三年春 / 2024-03-15';

		form.createEl('label', { text: '事件描述', cls: 'timeline-form-label' });
		const descInput = form.createEl('textarea', { cls: 'timeline-form-textarea' });
		descInput.placeholder = '描述这个时间点发生的事件...';

		form.createEl('label', { text: '关联章节（可选）', cls: 'timeline-form-label' });
		const chapterInputDesc = form.createDiv({ cls: 'timeline-form-hint' });
		chapterInputDesc.setText('点击 + 号添加更多章节');
		chapterInputDesc.style.cssText = 'font-size:0.85em;color:var(--text-muted);margin-bottom:4px;';
		
		// 章节列表容器
		const chapterListContainer = form.createDiv();
		chapterListContainer.style.cssText = 'margin-bottom:12px;';
		
		// 获取当前文件夹下的所有 md 文件
		const folder = this.app.vault.getAbstractFileByPath(this.currentFolder);
		const chapterFiles: string[] = [];
		if (folder && 'children' in folder) {
			(folder as any).children
				.filter((c: any) => c.extension === 'md')
				.forEach((c: any) => {
					chapterFiles.push(c.basename);
				});
			chapterFiles.sort();
		}
		
		// 创建章节选择行
		const createChapterRow = (initialValue: string = '') => {
			const row = chapterListContainer.createDiv();
			row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
			
			const select = row.createEl('select', { cls: 'timeline-form-input' });
			select.style.cssText = 'flex:1;';
			
			// 添加空选项
			select.createEl('option', { value: '', text: '-- 选择章节 --' });
			
			// 添加所有章节选项
			chapterFiles.forEach(file => {
				const option = select.createEl('option', { value: file, text: file });
				if (file === initialValue) option.selected = true;
			});
			
			// 删除按钮
			const removeBtn = row.createEl('button', { text: '−', cls: 'timeline-chapter-remove-btn' });
			removeBtn.style.cssText = 'width:32px;height:32px;padding:0;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;font-size:20px;line-height:1;';
			removeBtn.title = '删除此章节';
			removeBtn.onclick = () => {
				row.remove();
				// 如果没有章节行了，至少保留一个空行
				if (chapterListContainer.children.length === 1) { // 只剩添加按钮
					createChapterRow();
				}
			};
			
			return { row, select };
		};
		
		// 初始化：添加一个空行
		createChapterRow();
		
		// 添加按钮
		const addBtn = chapterListContainer.createEl('button', { text: '+ 添加章节', cls: 'timeline-chapter-add-btn' });
		addBtn.style.cssText = 'width:100%;padding:6px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:4px;';
		addBtn.onclick = () => {
			// 在添加按钮之前插入新行
			const { row } = createChapterRow();
			chapterListContainer.insertBefore(row, addBtn);
		};

		form.createEl('label', { text: '类型（可选）', cls: 'timeline-form-label' });
		const typeSelect = form.createEl('select', { cls: 'timeline-form-input' });
		
		// 添加空选项
		typeSelect.createEl('option', { value: '', text: '-- 选择类型 --' });
		
		// 从设置中获取默认类型列表
		const defaultTypes = this.plugin.settings.timeline?.defaultTypes || ['主线', '支线', '伏笔', '世界观', '人物'];
		defaultTypes.forEach((type: string) => {
			typeSelect.createEl('option', { value: type, text: type });
		});
		
		// 添加"自定义"选项
		typeSelect.createEl('option', { value: '__custom__', text: '-- 自定义 --' });
		
		// 自定义输入框（初始隐藏）
		const customInput = form.createEl('input', { type: 'text', cls: 'timeline-form-input' });
		customInput.placeholder = '输入自定义类型';
		customInput.style.cssText = 'margin-top:4px;display:none;';
		
		// 切换显示自定义输入框
		typeSelect.addEventListener('change', () => {
			if (typeSelect.value === '__custom__') {
				customInput.style.display = 'block';
				customInput.focus();
			} else {
				customInput.style.display = 'none';
			}
		});

		const btnRow = form.createDiv({ cls: 'timeline-form-btns' });
		const cancelBtn = btnRow.createEl('button', { text: '取消', cls: 'timeline-action-btn' });
		cancelBtn.onclick = () => form.remove();

		const saveBtn = btnRow.createEl('button', { text: '添加', cls: 'timeline-action-btn mod-cta' });
		saveBtn.onclick = async () => {
			const time = timeInput.value.trim();
			if (!time) {
				new Notice('请填写时间点');
				timeInput.focus();
				return;
			}
			
			// 收集所有选中的章节
			const chapters: string[] = [];
			const selects = chapterListContainer.querySelectorAll('select');
			selects.forEach((select: HTMLSelectElement) => {
				const value = select.value.trim();
				if (value) chapters.push(value);
			});
			const uniqueChapters = [...new Set(chapters)]; // 去重
			
			// 获取类型值：如果选择了自定义，使用自定义输入框的值
			let typeValue = typeSelect.value;
			if (typeValue === '__custom__') {
				typeValue = customInput.value.trim();
				// 如果是自定义类型且不为空，添加到设置中
				if (typeValue && !this.plugin.settings.timeline.defaultTypes.includes(typeValue)) {
					this.plugin.settings.timeline.defaultTypes.push(typeValue);
					await this.plugin.saveSettings();
				}
			}
			
			const entry: TimelineEntry = {
				time,
				description: descInput.value.trim(),
				chapter: uniqueChapters.join(', '),
				type: typeValue,
				rawBlock: '',
			};
			const newContent = await this.manager.appendEntry(entry);
			form.remove();
			this.renderFromContent(newContent);
		};

		setTimeout(() => timeInput.focus(), 50);
	}

	// ─── 文件操作 ───────────────────────────────────────

	private getTimelineFilePath(): string {
		const fileName = (this.plugin.settings.timeline?.fileName || '时间线') + '.md';
		return this.currentFolder ? `${this.currentFolder}/${fileName}` : fileName;
	}

	private getTimelineFile(): TFile | null {
		const path = this.getTimelineFilePath();
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	private async createTimelineFile(): Promise<TFile> {
		const path = this.getTimelineFilePath();
		return await this.app.vault.create(path, '');
	}

	private async loadEntries(): Promise<TimelineEntry[] | null> {
		const file = this.getTimelineFile();
		if (!file) return null;
		const content = await this.app.vault.read(file);
		return this.parseEntries(content);
	}

	private parseEntries(content: string): TimelineEntry[] {
		const entries: TimelineEntry[] = [];

		// 和伏笔系统一样，按 \n---\n 分割
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed.startsWith('## ')) continue;

			const lines = trimmed.split('\n');
			const time = lines[0].replace(/^## /, '').trim();

			// 描述：H2 之后、第一个 ** 字段之前的非空行
			const descLines: string[] = [];
			let i = 1;
			while (i < lines.length && !lines[i].startsWith('**')) {
				if (lines[i].trim()) descLines.push(lines[i].trim());
				i++;
			}
			const description = descLines.join('\n');

			// 解析列表项（新格式：- 描述 [[章节]]）
			const items: { description: string; chapter: string }[] = [];
			const typeMatch = trimmed.match(/\*\*类型\*\*：(.+)/);

			for (const line of lines.slice(1)) {
				if (line.startsWith('- ')) {
					const itemText = line.slice(2);
					const chapterMatch = itemText.match(/\[\[(.+?)\]\]/);
					const chapter = chapterMatch ? chapterMatch[1] : '';
					const desc = itemText.replace(/\[\[.+?\]\]/g, '').trim();
					items.push({ description: desc, chapter });
				}
			}

			// 兼容旧格式（无列表项时用 description）
			const finalItems = items.length > 0 ? items : [{ description, chapter: '' }];

			entries.push({
				time,
				description: finalItems.map(i => i.description).filter(Boolean).join('\n'),
				chapter: finalItems.map(i => i.chapter).filter(Boolean).join(', '),
				type: typeMatch ? typeMatch[1].trim() : '',
				rawBlock: trimmed,
				items: finalItems,
			});
		}

		return entries;
	}

	private formatEntry(entry: TimelineEntry): string {
		const lines: string[] = [];
		lines.push(`## ${entry.time}`);
		lines.push('');

		// 如果有 items 列表，用列表格式输出所有项
		const items = (entry as any).items as { description: string; chapter: string }[] | undefined;
		if (items && items.length > 0) {
			for (const it of items) {
				const parts: string[] = [];
				if (it.description) parts.push(it.description);
				if (it.chapter) parts.push(`[[${it.chapter}]]`);
				if (parts.length > 0) lines.push(`- ${parts.join(' ')}`);
			}
		} else {
			// 单条格式
			const itemParts: string[] = [];
			if (entry.description) itemParts.push(entry.description);
			if (entry.chapter) itemParts.push(`[[${entry.chapter}]]`);
			if (itemParts.length > 0) lines.push(`- ${itemParts.join(' ')}`);
		}

		if (entry.type) {
			lines.push('');
			lines.push(`**类型**：${entry.type}`);
		}
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('');
		return lines.join('\n');
	}

	async appendEntry(entry: TimelineEntry): Promise<string> {
		this.manager.currentFolder = this.currentFolder;
		return await this.manager.appendEntry(entry);
	}

	private async updateEntry(index: number, updated: TimelineEntry): Promise<void> {
		const file = this.getTimelineFile();
		if (!file) return;
		const entries = await this.loadEntries();
		if (!entries) return;
		entries[index] = updated;
		const newContent = await this.writeAllEntries(file, entries);
		this.editingIndex = -1;
		this.renderFromContent(newContent);
	}

	private async deleteEntry(index: number): Promise<boolean> {
		const file = this.getTimelineFile();
		if (!file) return false;
		const entries = await this.loadEntries();
		if (!entries) return false;
		entries.splice(index, 1);
		const newContent = await this.writeAllEntries(file, entries);
		this.renderFromContent(newContent);
		return true;
	}

	private async moveEntry(fromIndex: number, toIndex: number): Promise<void> {
		const file = this.getTimelineFile();
		if (!file) return;
		const entries = await this.loadEntries();
		if (!entries) return;
		const [moved] = entries.splice(fromIndex, 1);
		entries.splice(toIndex, 0, moved);
		const newContent = await this.writeAllEntries(file, entries);
		this.renderFromContent(newContent);
	}

	private async writeAllEntries(file: TFile, entries: TimelineEntry[]): Promise<string> {
		let content = '';
		for (const entry of entries) {
			content += this.formatEntry(entry);
		}
		await this.app.vault.modify(file, content);
		return content;
	}

	/**
	 * 从正文添加到时间线（供 main.ts 调用）
	 * 直接弹出 Modal，不依赖面板状态
	 */
	async addFromSelection(selectedText: string, sourceFile: string, folderPath: string): Promise<void> {
		// 确保时间线文件存在
		const fileName = (this.plugin.settings.timeline?.fileName || '时间线') + '.md';
		const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
		let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
		if (!file) {
			file = await this.app.vault.create(filePath, `# ${this.plugin.settings.timeline?.fileName || '时间线'}\n\n`);
			new Notice(`已创建时间线文件：${fileName}`);
		}

		// 弹出输入 Modal
		const modal = new TimelineAddModal(
			this.app,
			this.plugin,
			selectedText.trim(),
			sourceFile,
			folderPath,
			async (entry) => {
				const existing = await this.app.vault.read(file!);
				const separator = existing.endsWith('\n') ? '' : '\n';
				await this.app.vault.modify(file!, existing + separator + this.formatEntry(entry));
				new Notice('✅ 已添加到时间线');
				// 如果面板已打开，刷新
				const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
				if (leaves.length > 0) {
					(leaves[0].view as TimelineView).refresh();
				}
			},
			true // 返回完整 TimelineEntry
		);
		modal.open();
	}
}
