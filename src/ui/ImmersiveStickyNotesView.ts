import type { WorkspaceLeaf, App} from 'obsidian';
import { ItemView, FuzzySuggestModal, TFile, Notice } from 'obsidian';
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
	private resizeObserver: ResizeObserver | null = null;
	private isVertical: boolean = false;

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
			id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
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
		// 清空容器
		const containerEl = this.containerEl;
		containerEl.empty();
		
		this.isVertical = false;

		containerEl.setCssStyles({ position: 'relative' });
		containerEl.setCssStyles({ display: 'flex' });
		containerEl.setCssStyles({ flexDirection: 'column' });
		containerEl.setCssStyles({ height: '100%' });
		containerEl.setCssStyles({ overflow: 'hidden' });

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}
		
		// 悬浮触发区（顶部一条不可见的区域，用来唤出工具栏）
		const hoverTrigger = containerEl.createDiv({ cls: 'immersive-sticky-trigger' });
		hoverTrigger.setCssStyles({ position: 'absolute' });
		hoverTrigger.setCssStyles({ top: '0' });
		hoverTrigger.setCssStyles({ left: '0' });
		hoverTrigger.setCssStyles({ right: '0' });
		hoverTrigger.setCssStyles({ height: '15px' });
		hoverTrigger.setCssStyles({ zIndex: '9' });
		
		// 工具栏
		const toolbar = containerEl.createDiv({ cls: 'immersive-sticky-toolbar' });
		toolbar.setCssStyles({ display: 'flex' });
		toolbar.setCssStyles({ gap: '8px' });
		toolbar.setCssStyles({ padding: '8px' });
		toolbar.setCssStyles({ borderBottom: '1px solid var(--background-modifier-border)' });
		toolbar.setCssStyles({ backgroundColor: 'var(--background-secondary)' });
		toolbar.setCssStyles({ position: 'absolute' });
		toolbar.setCssStyles({ top: '0' });
		toolbar.setCssStyles({ left: '0' });
		toolbar.setCssStyles({ right: '0' });
		toolbar.setCssStyles({ zIndex: '10' });
		
		// 自动隐藏逻辑
		toolbar.setCssStyles({ opacity: '0' });
		toolbar.setCssStyles({ transition: 'opacity 0.2s' });
		toolbar.setCssStyles({ pointerEvents: 'none' });
		
		let hideTimeout: number;

		const showToolbar = () => {
			window.clearTimeout(hideTimeout);
			toolbar.setCssStyles({ opacity: '1' });
			toolbar.setCssStyles({ pointerEvents: 'auto' });
		};

		const hideToolbar = () => {
			hideTimeout = window.setTimeout(() => {
				toolbar.setCssStyles({ opacity: '0' });
				toolbar.setCssStyles({ pointerEvents: 'none' });
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
		dockContainer.setCssStyles({ flex: '1' });
		dockContainer.setCssStyles({ display: 'flex' });
		dockContainer.setCssStyles({ flexWrap: 'nowrap' }); // 强制不换行
		dockContainer.setCssStyles({ gap: '10px' });
		dockContainer.setCssStyles({ padding: '10px' });
		// 给顶部留出空间以免被悬浮的工具栏在显示时挡住内容（即使工具栏隐藏）
		dockContainer.setCssStyles({ paddingTop: '10px' });
		dockContainer.setCssStyles({ alignItems: 'center' }); // 居中显示
		
		this.resizeObserver = new ResizeObserver(entries => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				// 如果高度明显大于宽度，且宽度不足以并排两个便签，则切换为垂直布局
				const shouldBeVertical = height > width * 1.2 || width < 450;
				if (this.isVertical !== shouldBeVertical) {
					this.isVertical = shouldBeVertical;
					dockContainer.toggleClass('immersive-vertical-layout', this.isVertical);
				}
			}
		});
		this.resizeObserver.observe(containerEl);
		
		// 初始默认设为横向（会被 observer 立即覆盖）
		dockContainer.toggleClass('immersive-vertical-layout', false);

		// 滚轮转换为横向滚动
		dockContainer.addEventListener('wheel', (evt) => {
			if (evt.shiftKey || this.isVertical) return; // 按住 shift，或者已经是垂直布局，原生即支持垂直/横向滚动
			
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
			noteCard.setCssStyles({ backgroundColor: noteData.color || '#FDF3B8' });
			const noteSize = (this.plugin.settings.immersive.immersiveNoteSize || 280) + 'px';
			noteCard.setCssStyles({ width: noteSize }); 
			noteCard.setCssStyles({ height: noteSize });
			noteCard.setCssStyles({ flex: '0 0 auto' });
			noteCard.setCssStyles({ display: 'flex' });
			noteCard.setCssStyles({ flexDirection: 'column' });
			noteCard.setCssStyles({ borderRadius: '8px' });
			noteCard.setCssStyles({ boxShadow: '0 4px 10px rgba(0,0,0,0.15)' });
			noteCard.setCssStyles({ overflow: 'hidden' });
			noteCard.setCssStyles({ boxSizing: 'border-box' });

			if (noteData.textColor) {
				noteCard.setCssStyles({ color: noteData.textColor });
			}
			
			// 标题栏与关闭按钮
			const titleEl = noteCard.createDiv({ cls: 'immersive-sticky-title' });
			titleEl.setCssStyles({ display: 'flex' });
			titleEl.setCssStyles({ justifyContent: 'space-between' });
			titleEl.setCssStyles({ alignItems: 'center' });
			titleEl.setCssStyles({ padding: '4px 8px' });
			titleEl.setCssStyles({ borderBottom: '1px solid rgba(0,0,0,0.1)' });
			titleEl.setCssStyles({ backgroundColor: 'rgba(0,0,0,0.05)' });

			const titleSpan = titleEl.createSpan();
			titleSpan.setText(noteData.title || '便签');
			
			
			titleSpan.setCssStyles({ whiteSpace: 'nowrap' });
			titleSpan.setCssStyles({ overflow: 'hidden' });
			titleSpan.setCssStyles({ textOverflow: 'ellipsis' });

			const closeBtn = titleEl.createSpan({ cls: 'clickable-icon', text: '×' });
			closeBtn.setCssStyles({ fontSize: '1.2em' });
			closeBtn.setCssStyles({ lineHeight: '1' });
			closeBtn.setCssStyles({ cursor: 'pointer' });
			closeBtn.setCssStyles({ padding: '0 4px' });
			closeBtn.title = '关闭便签';
			
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
			textarea.setCssStyles({ flex: '1' });
			textarea.setCssStyles({ minHeight: '200px' }); // 确保文本区有足够空间
			textarea.setCssStyles({ resize: 'none' });
			textarea.setCssStyles({ padding: '8px' });
			textarea.setCssStyles({ border: 'none' });
			textarea.setCssStyles({ background: 'transparent' });
			textarea.setCssStyles({ color: 'inherit' });
			textarea.setCssStyles({ fontSize: (this.plugin.settings.immersive.immersiveNoteFontSize || 14) + 'px' });
			textarea.setCssStyles({ lineHeight: '1.5' });
			textarea.setCssStyles({ fontFamily: 'inherit' });
			textarea.setCssStyles({ outline: 'none' });
			textarea.setCssStyles({ width: '100%' });
			textarea.setCssStyles({ boxSizing: 'border-box' });

			// 移除之前的 autoResize 逻辑，因为现在是固定比例正方形
			textarea.setCssStyles({ overflowY: 'auto' }); // 如果内容超过正方形，允许内部滚动
			
			// 绑定输入监听
			textarea.addEventListener('input', () => {
				noteData.content = textarea.value;
				
				// 如果开启了自动保存，则实时同步到管理器和文件
				if (this.plugin.settings.stickyNoteAutoSave) {
					const debounceKey = `immersive-save-note-${noteData.id}`;
					this.plugin.adaptiveDebounceManager.debounceFixed(debounceKey, async () => {
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
		this.containerEl.setCssStyles({ display: 'flex' });
		this.containerEl.setCssStyles({ flexDirection: 'column' });
		await this.renderNotes();
	}

	async onClose() {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}
}
