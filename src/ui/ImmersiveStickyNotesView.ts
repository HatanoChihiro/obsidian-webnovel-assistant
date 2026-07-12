import type { WorkspaceLeaf, App} from 'obsidian';
import { ItemView, FuzzySuggestModal, TFile, Notice } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { StickyNoteState } from '../types/settings';
import { SaveStickyNoteModal, ConfirmCloseModal } from './StickyNote';
import { t } from '../i18n';

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	plugin: WebNovelAssistantPlugin;
	onChoose: (file: TFile) => void;

	constructor(app: App, plugin: WebNovelAssistantPlugin, onChoose: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.setPlaceholder(t('immersive.search-file-placeholder'));
	}

	getItems(): TFile[] {
		return this.plugin.getTrackedMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
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
		return t('view.immersive-sticky-notes');
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
			title: title || t('immersive.new-note-title'),
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

		void this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).then(() => {
			this.renderNotes(); // 重新渲染列表
		}).catch(err => console.error('[ImmersiveStickyNotesView] saveNotes failed:', err));
		
		// 保存主题索引更新
		void this.plugin.saveSettings();
	}

	renderNotes() {
		// 清空容器
		const containerEl = this.containerEl;
		containerEl.empty();
		
		this.isVertical = false;

		containerEl.addClass('webnovel-immersive-sticky-container');if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}
		
		// 悬浮触发区（顶部一条不可见的区域，用来唤出工具栏）
		const hoverTrigger = containerEl.createDiv({ cls: 'immersive-sticky-trigger' });
		hoverTrigger.addClass('webnovel-immersive-hover-trigger');
		
		const toolbar = containerEl.createDiv({ cls: 'immersive-sticky-toolbar' });
		toolbar.addClass('webnovel-immersive-toolbar');
		toolbar.setCssProps({ opacity: '0' });
		toolbar.setCssStyles({ pointerEvents: 'none', transition: 'opacity 0.2s ease' });
		
		let hideTimeout: number;

		const showToolbar = () => {
			window.clearTimeout(hideTimeout);
			toolbar.setCssProps({ opacity: '1' });
			toolbar.setCssStyles({ pointerEvents: 'auto' });
		};

		const hideToolbar = () => {
			hideTimeout = window.setTimeout(() => {
				toolbar.setCssProps({ opacity: '0' });
				toolbar.setCssStyles({ pointerEvents: 'none' });
			}, 200);
		};

		hoverTrigger.addEventListener('mouseenter', showToolbar);
		hoverTrigger.addEventListener('mouseleave', hideToolbar);
		toolbar.addEventListener('mouseenter', showToolbar);
		toolbar.addEventListener('mouseleave', hideToolbar);

		const newBlankBtn = toolbar.createEl('button', { text: t('immersive.new-blank-note') });
		newBlankBtn.onclick = () => this.createNewNote();

		const openFileBtn = toolbar.createEl('button', { text: t('immersive.open-file-as-note') });
		openFileBtn.onclick = () => {
			new FileSuggestModal(this.app, this.plugin, (file) => {
				void this.app.vault.read(file).then(content => {
					this.createNewNote(file.path, content, file.basename);
				});
			}).open();
		};
		
		const dockContainer = containerEl.createDiv({ cls: 'immersive-sticky-dock' });
		dockContainer.addClass('webnovel-immersive-dock'); // 强制不换行
		// gap, padding, alignItems handled by webnovel-immersive-dock CSS
		
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
			dockContainer.createEl('p', { text: t('immersive.no-notes-hint'), cls: 'immersive-empty-text' });
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
			/* width/height set below */ 
			noteCard.setCssProps({ width: noteSize }); noteCard.setCssProps({ height: noteSize });
			noteCard.addClass('webnovel-immersive-note-card');if (noteData.textColor) {
				noteCard.setCssProps({ color: noteData.textColor });
			}
			
			// 标题栏与关闭按钮
			const titleEl = noteCard.createDiv({ cls: 'immersive-sticky-title' });
			titleEl.addClass('webnovel-immersive-note-title');const titleSpan = titleEl.createSpan();
			titleSpan.setText(noteData.title || t('immersive.note-default-title'));
			
			
			titleSpan.addClass('webnovel-ellipsis');const closeBtn = titleEl.createSpan({ cls: 'clickable-icon', text: '×' });
			closeBtn.addClass('webnovel-immersive-note-close');closeBtn.title = t('immersive.close-note-tooltip');
			
			const performRemove = async () => {
				this.plugin.stickyNoteManager.removeNote(noteData.id);
				this.lastSavedContents.delete(noteData.id);
				void this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
				void this.renderNotes();
			};

			closeBtn.onclick = () => {
				// 脏检查逻辑
				const currentContent = noteData.content || '';
				const lastSaved = this.lastSavedContents.get(noteData.id) || '';
				
				if (!this.plugin.settings.stickyNoteAutoSave && currentContent !== lastSaved) {
					// 弹出确认对话框
					const modal = new ConfirmCloseModal(this.app, (shouldSave: boolean) => {
						if (shouldSave) {
							// 用户选择保存
							if (noteData.filePath) {
								const file = this.app.vault.getAbstractFileByPath(noteData.filePath);
								if (file instanceof TFile) {
									void this.app.vault.process(file, () => currentContent);
									new Notice(t('modal.note-saved'));
								}
								void performRemove();
							} else {
								// 新便签，弹出保存对话框
								const saveModal = new SaveStickyNoteModal(this.app, this.plugin, (fileName: string, folderPath: string) => {
									try {
										const fullPath = (folderPath ? `${folderPath}/` : '') + (fileName.endsWith('.md') ? fileName : `${fileName}.md`);
										if (this.app.vault.getAbstractFileByPath(fullPath)) {
											new Notice(t('modal.file-already-exists', { path: fullPath }));
											return;
										}
										void this.app.vault.create(fullPath, currentContent);
										new Notice(t('modal.saved-as', { path: fullPath }));
										void performRemove();
									} catch (error) {
										new Notice(t('modal.save-failed', { error: String(error) }));
									}
								});
								saveModal.open();
							}
						} else {
							// 用户选择不保存
							void performRemove();
						}
					});
					modal.open();
				} else {
					// 不需要提示，直接移除
					void performRemove();
				}
			};

			const textarea = noteCard.createEl('textarea');
			
			// 剥离 frontmatter 用于显示，但在保存时保留
			let displayContent = noteData.content || '';
			let frontmatter = '';
			const fmMatch = displayContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
			if (fmMatch) {
				frontmatter = fmMatch[0];
				displayContent = displayContent.substring(frontmatter.length);
			}
			
			textarea.value = displayContent;
			textarea.addClass('webnovel-immersive-note-textarea'); // 确保文本区有足够空间
			// resize, padding, border, background, color handled by webnovel-immersive-note-textarea CSS
			textarea.setCssStyles({ fontSize: (this.plugin.settings.immersive.immersiveNoteFontSize || 14) + 'px' });
			/* lineHeight, fontFamily, outline, width, boxSizing handled by webnovel-immersive-note-textarea CSS */ // 如果内容超过正方形，允许内部滚动
			
			// 绑定输入监听
			textarea.addEventListener('input', () => {
				noteData.content = frontmatter + textarea.value;
				
				// 如果开启了自动保存，则实时同步到管理器和文件
				if (this.plugin.settings.stickyNoteAutoSave) {
					const debounceKey = `immersive-save-note-${noteData.id}`;
					this.plugin.adaptiveDebounceManager.debounceFixed(debounceKey, () => {
						void this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
						this.lastSavedContents.set(noteData.id, noteData.content || '');
						
						if (noteData.filePath) {
							const file = this.app.vault.getAbstractFileByPath(noteData.filePath);
							if (file instanceof TFile) {
								void this.app.vault.process(file, () => noteData.content || '');
							}
						}
					}, 500);
				}
			});
		}
	}

	async onOpen() {
		this.containerEl.addClass('webnovel-immersive-sticky-container');this.renderNotes();
	}

	async onClose() {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}
}
