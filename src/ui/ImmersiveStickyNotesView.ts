import { ItemView, WorkspaceLeaf, debounce, FuzzySuggestModal, TFile, App, Notice } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { StickyNoteState } from '../types/settings';
import { SaveStickyNoteModal, ConfirmCloseModal } from './StickyNote';

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	plugin: WebNovelAssistantPlugin;
	onChoose: (file: TFile) => void;

	constructor(app: App, plugin: WebNovelAssistantPlugin, onChoose: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.setPlaceholder('搜索要作为便签打开的文档...');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}

export class ImmersiveStickyNotesView extends ItemView {
	plugin: WebNovelAssistantPlugin;
	private lastSavedContents: Map<string, string> = new Map();

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPES.IMMERSIVE_STICKY_NOTES;
	}

	getDisplayText(): string {
		return '便签列表';
	}
	
	getIcon(): string {
		return 'sticky-note';
	}

	private createNewNote(filePath?: string, content?: string, title?: string) {
		// 获取下一个主题颜色
		const themeIndex = this.plugin.settings.nextNoteThemeIndex || 0;
		const themes = this.plugin.settings.noteThemes || [];
		const theme = themes[themeIndex] || { bg: '#FDF3B8', text: '#2C3E50' };
		
		// 更新下一个主题索引
		this.plugin.settings.nextNoteThemeIndex = (themeIndex + 1) % Math.max(1, themes.length);

		const newNote: StickyNoteState = {
			id: Math.random().toString(36).substr(2, 9),
			filePath: filePath,
			content: content || '',
			title: title || '新建便签',
			top: '100px', // 在沉浸模式下这些值不重要，但需要给个默认值
			left: '100px',
			width: '300px',
			height: '300px',
			color: theme.bg,
			textColor: theme.text,
			isEditing: true // 默认可编辑
		};

		this.plugin.stickyNoteManager.updateNote(newNote);
		
		// 初始化最后保存的内容
		this.lastSavedContents.set(newNote.id, newNote.content || '');

		this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).then(() => {
			this.renderNotes(); // 重新渲染列表
		});
		
		// 保存主题索引更新
		this.plugin.saveSettings();
	}

	async renderNotes() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.style.position = 'relative';
		containerEl.style.display = 'flex';
		containerEl.style.flexDirection = 'column';
		containerEl.style.height = '100%';
		containerEl.style.overflow = 'hidden';
		
		// 悬浮触发区（顶部一条不可见的区域，用来唤出工具栏）
		const hoverTrigger = containerEl.createDiv({ cls: 'immersive-sticky-trigger' });
		hoverTrigger.style.position = 'absolute';
		hoverTrigger.style.top = '0';
		hoverTrigger.style.left = '0';
		hoverTrigger.style.right = '0';
		hoverTrigger.style.height = '15px';
		hoverTrigger.style.zIndex = '9';
		
		// 工具栏
		const toolbar = containerEl.createDiv({ cls: 'immersive-sticky-toolbar' });
		toolbar.style.display = 'flex';
		toolbar.style.gap = '8px';
		toolbar.style.padding = '8px';
		toolbar.style.borderBottom = '1px solid var(--background-modifier-border)';
		toolbar.style.backgroundColor = 'var(--background-secondary)';
		toolbar.style.position = 'absolute';
		toolbar.style.top = '0';
		toolbar.style.left = '0';
		toolbar.style.right = '0';
		toolbar.style.zIndex = '10';
		
		// 自动隐藏逻辑
		toolbar.style.opacity = '0';
		toolbar.style.transition = 'opacity 0.2s';
		toolbar.style.pointerEvents = 'none';
		
		let hideTimeout: number;

		const showToolbar = () => {
			clearTimeout(hideTimeout);
			toolbar.style.opacity = '1';
			toolbar.style.pointerEvents = 'auto';
		};

		const hideToolbar = () => {
			hideTimeout = window.setTimeout(() => {
				toolbar.style.opacity = '0';
				toolbar.style.pointerEvents = 'none';
			}, 200);
		};

		hoverTrigger.addEventListener('mouseenter', showToolbar);
		hoverTrigger.addEventListener('mouseleave', hideToolbar);
		toolbar.addEventListener('mouseenter', showToolbar);
		toolbar.addEventListener('mouseleave', hideToolbar);

		const newBlankBtn = toolbar.createEl('button', { text: '新建空白便签' });
		newBlankBtn.onclick = () => this.createNewNote();

		const openFileBtn = toolbar.createEl('button', { text: '打开文件为便签' });
		openFileBtn.onclick = () => {
			new FileSuggestModal(this.app, this.plugin, async (file) => {
				const content = await this.app.vault.read(file);
				this.createNewNote(file.path, content, file.basename);
			}).open();
		};
		
		const dockContainer = containerEl.createDiv({ cls: 'immersive-sticky-dock' });
		dockContainer.style.flex = '1';
		dockContainer.style.overflowX = 'auto'; // 横向滚动
		dockContainer.style.overflowY = 'hidden';
		dockContainer.style.display = 'flex';
		dockContainer.style.flexDirection = 'row';
		dockContainer.style.flexWrap = 'nowrap'; // 强制不换行
		dockContainer.style.gap = '10px';
		dockContainer.style.padding = '10px';
		// 给顶部留出空间以免被悬浮的工具栏在显示时挡住内容（即使工具栏隐藏）
		dockContainer.style.paddingTop = '10px';
		dockContainer.style.alignItems = 'center'; // 垂直居中显示 300x300 的便签
		
		// 滚轮转换为横向滚动
		dockContainer.addEventListener('wheel', (evt) => {
			if (evt.shiftKey) return; // 按住 shift 原生即支持横向滚动
			
			// 如果在文本框内且可以垂直滚动，则优先原生的垂直滚动
			const target = evt.target as HTMLElement;
			if (target.tagName.toLowerCase() === 'textarea') {
				const ta = target as HTMLTextAreaElement;
				const canScrollUp = ta.scrollTop > 0;
				const canScrollDown = Math.ceil(ta.scrollTop + ta.clientHeight) < ta.scrollHeight;
				
				if ((evt.deltaY < 0 && canScrollUp) || (evt.deltaY > 0 && canScrollDown)) {
					return; // 交给原生处理
				}
			}

			if (evt.deltaY !== 0) {
				evt.preventDefault();
				dockContainer.scrollLeft += evt.deltaY;
			}
		});

		// 渲染便签
		const notes = this.plugin.stickyNoteManager.getNotes();
		
		if (notes.length === 0) {
			dockContainer.createEl('p', { text: '暂无打开的便签。点击上方按钮新建或打开文件。', cls: 'immersive-empty-text' });
			return;
		}

		for (const noteData of notes) {
			// 初始化“最后保存”的内容记录
			if (!this.lastSavedContents.has(noteData.id)) {
				this.lastSavedContents.set(noteData.id, noteData.content || '');
			}

			const noteCard = dockContainer.createDiv({ cls: 'immersive-sticky-card' });
			noteCard.style.backgroundColor = noteData.color || '#FDF3B8';
			const noteSize = (this.plugin.settings.immersiveNoteSize || 280) + 'px';
			noteCard.style.width = noteSize; 
			noteCard.style.height = noteSize;
			noteCard.style.flex = '0 0 auto';
			noteCard.style.display = 'flex';
			noteCard.style.flexDirection = 'column';
			noteCard.style.borderRadius = '8px';
			noteCard.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
			noteCard.style.overflow = 'hidden';
			noteCard.style.boxSizing = 'border-box';

			if (noteData.textColor) {
				noteCard.style.color = noteData.textColor;
			}
			
			// 标题栏与关闭按钮
			const titleEl = noteCard.createDiv({ cls: 'immersive-sticky-title' });
			titleEl.style.display = 'flex';
			titleEl.style.justifyContent = 'space-between';
			titleEl.style.alignItems = 'center';
			titleEl.style.padding = '4px 8px';
			titleEl.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
			titleEl.style.backgroundColor = 'rgba(0,0,0,0.05)';

			const titleSpan = titleEl.createSpan();
			titleSpan.setText(noteData.title || '便签');
			titleSpan.style.fontWeight = 'bold';
			titleSpan.style.fontSize = '0.9em';
			titleSpan.style.whiteSpace = 'nowrap';
			titleSpan.style.overflow = 'hidden';
			titleSpan.style.textOverflow = 'ellipsis';

			const closeBtn = titleEl.createSpan({ cls: 'clickable-icon', text: '×' });
			closeBtn.style.fontSize = '1.2em';
			closeBtn.style.lineHeight = '1';
			closeBtn.style.cursor = 'pointer';
			closeBtn.style.padding = '0 4px';
			
			const performRemove = async () => {
				this.plugin.stickyNoteManager.removeNote(noteData.id);
				this.lastSavedContents.delete(noteData.id);
				await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
				this.renderNotes();
			};

			closeBtn.onclick = async () => {
				// 脏检查逻辑
				const currentContent = noteData.content || '';
				const lastSaved = this.lastSavedContents.get(noteData.id) || '';
				
				if (!this.plugin.settings.stickyNoteAutoSave && currentContent !== lastSaved) {
					// 弹出确认对话框
					const modal = new ConfirmCloseModal(this.app, async (shouldSave: boolean) => {
						if (shouldSave) {
							// 用户选择保存
							if (noteData.filePath) {
								const file = this.app.vault.getAbstractFileByPath(noteData.filePath);
								if (file instanceof TFile) {
									await this.app.vault.modify(file, currentContent);
									new Notice("[成功] 便签已保存");
								}
								await performRemove();
							} else {
								// 新便签，弹出保存对话框
								const saveModal = new SaveStickyNoteModal(this.app, this.plugin, async (fileName: string, folderPath: string) => {
									try {
										const fullPath = (folderPath ? `${folderPath}/` : '') + (fileName.endsWith('.md') ? fileName : `${fileName}.md`);
										if (this.app.vault.getAbstractFileByPath(fullPath)) {
											new Notice(`[错误] 文件已存在: ${fullPath}`);
											return;
										}
										await this.app.vault.create(fullPath, currentContent);
										new Notice(`[成功] 已保存为: ${fullPath}`);
										await performRemove();
									} catch (error) {
										new Notice(`[错误] 保存失败: ${error}`);
									}
								});
								saveModal.open();
							}
						} else {
							// 用户选择不保存
							await performRemove();
						}
					});
					modal.open();
				} else {
					// 不需要提示，直接移除
					await performRemove();
				}
			};

			const textarea = noteCard.createEl('textarea');
			textarea.value = noteData.content || '';
			textarea.style.flex = '1';
			textarea.style.minHeight = '200px'; // 确保文本区有足够空间
			textarea.style.resize = 'none';
			textarea.style.padding = '8px';
			textarea.style.border = 'none';
			textarea.style.background = 'transparent';
			textarea.style.color = 'inherit';
			textarea.style.fontSize = (this.plugin.settings.immersiveNoteFontSize || 14) + 'px';
			textarea.style.lineHeight = '1.5';
			textarea.style.fontFamily = 'inherit';
			textarea.style.outline = 'none';
			textarea.style.width = '100%';
			textarea.style.boxSizing = 'border-box';

			// 移除之前的 autoResize 逻辑，因为现在是固定比例正方形
			textarea.style.overflowY = 'auto'; // 如果内容超过正方形，允许内部滚动
			
			// 绑定输入监听
			textarea.addEventListener('input', () => {
				noteData.content = textarea.value;
				
				// 如果开启了自动保存，则实时同步到管理器和文件
				if (this.plugin.settings.stickyNoteAutoSave) {
					const debounceKey = `immersive-save-note-${noteData.id}`;
					(this.plugin as any).adaptiveDebounceManager.debounceFixed(debounceKey, async () => {
						await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
						this.lastSavedContents.set(noteData.id, textarea.value);
						
						if (noteData.filePath) {
							const file = this.app.vault.getAbstractFileByPath(noteData.filePath);
							if (file instanceof TFile) {
								await this.app.vault.modify(file, textarea.value);
							}
						}
					}, 500);
				}
			});
		}
	}

	async onOpen() {
		this.containerEl.style.display = 'flex';
		this.containerEl.style.flexDirection = 'column';
		await this.renderNotes();
	}

	async onClose() {
		// Cleanup
	}
}
