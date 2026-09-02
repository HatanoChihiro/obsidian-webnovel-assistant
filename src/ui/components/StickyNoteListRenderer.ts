import { Component, FuzzySuggestModal, MarkdownRenderer, Notice, TFile, setIcon, type App } from 'obsidian';
import type { StickyNoteState, ThemeScheme } from '../../types/settings';
import { t } from '../../i18n';
import { ConfirmCloseModal, SaveStickyNoteModal } from '../StickyNote';
import { isMobile } from '../../utils/platform';
import { Logger } from '../../utils/Logger';
import { injectSoftBreakIndentPlaceholders } from '../../utils/softBreakIndent';
import {
	createStickyNoteParagraphEditor,
	getStickyNoteEditorContent,
	setStickyNoteEditorContent
} from './StickyNoteParagraphEditor';

export { getStickyNoteEditorContent } from './StickyNoteParagraphEditor';

export type StickyNoteListMode = 'immersive' | 'side-panel' | 'workbench';

interface StickyNoteListRendererOptions {
	mode: StickyNoteListMode;
	showToolbar?: boolean;
}

export interface StickyNoteListSettings {
	nextNoteThemeIndex?: number;
	noteThemes?: ThemeScheme[];
	immersive: {
		immersiveNoteFontSize?: number;
	};
	stickyNoteAutoSave?: boolean;
}

export interface StickyNoteListManager {
	getNotes(): StickyNoteState[];
	updateNote(note: StickyNoteState, debounceSave?: boolean): void;
	saveNotes(notes: StickyNoteState[]): Promise<void>;
	removeNoteAndWait(id: string): Promise<void>;
}

export interface StickyNoteListDebounceManager {
	debounceFixed(key: string, fn: () => void, delay: number): void;
}

export interface StickyNoteListRendererPlugin {
	settings: StickyNoteListSettings;
	stickyNoteManager: StickyNoteListManager;
	adaptiveDebounceManager: StickyNoteListDebounceManager;
	getVaultMarkdownFiles(): TFile[];
	saveSettings(): Promise<void>;
}

export function getStickyNoteFileCandidates(
	plugin: Pick<StickyNoteListRendererPlugin, 'getVaultMarkdownFiles'>
): TFile[] {
	return plugin.getVaultMarkdownFiles();
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly plugin: Pick<StickyNoteListRendererPlugin, 'getVaultMarkdownFiles'>,
		private readonly onChoose: (file: TFile) => void
	) {
		super(app);
		this.setPlaceholder(t('immersive.search-file-placeholder'));
	}

	getItems(): TFile[] {
		return getStickyNoteFileCandidates(this.plugin);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}

/**
 * 便签列表的共享渲染器。
 * 沉浸模式、侧面板与工作台共用阅读、编辑、保存和关闭逻辑，移动端侧面板不会显示悬浮便签。
 */
export class StickyNoteListRenderer {
	private readonly mode: StickyNoteListMode;
	private readonly showToolbar: boolean;
	private readonly lastSavedContents = new Map<string, string>();
	private readonly cardComponents = new Map<string, Component>();
	private isSelfEditing = false;
	private isDestroyed = false;
	private resizeObserver: ResizeObserver | null = null;

	constructor(
		private readonly app: App,
		private readonly plugin: StickyNoteListRendererPlugin,
		private readonly container: HTMLElement,
		options: StickyNoteListRendererOptions
	) {
		this.mode = options.mode;
		this.showToolbar = options.showToolbar ?? true;
	}

	render(): void {
		if (this.isDestroyed) return;

		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		for (const comp of this.cardComponents.values()) {
			comp.unload();
		}
		this.cardComponents.clear();

		this.container.empty();
		this.container.addClass('wn-sticky-note-list-container');
		if (this.mode === 'immersive') {
			this.container.addClass('webnovel-immersive-sticky-container');
		} else if (this.mode === 'side-panel') {
			this.container.addClass('wn-sticky-note-list-side-panel');
		} else {
			this.container.addClass('wn-sticky-note-list-workbench');
		}

		if (this.showToolbar) {
			this.createToolbar();
		}
		const dockContainer = this.container.createDiv({
			cls: this.mode === 'immersive'
				? 'immersive-sticky-dock webnovel-immersive-dock'
				: 'wn-sticky-note-list-grid'
		});
		if (this.mode === 'immersive') {
			this.observeImmersiveGrid(dockContainer);
		} else {
			this.observeSidePanelGrid(dockContainer);
		}

		const notes = this.plugin.stickyNoteManager.getNotes();
		if (notes.length === 0) {
			dockContainer.createEl('p', {
				text: t('immersive.no-notes-hint'),
				cls: this.mode === 'immersive' ? 'immersive-empty-text' : 'wn-sticky-note-list-empty'
			});
			return;
		}

		for (const noteData of notes) {
			this.renderNoteCard(dockContainer, noteData);
		}
	}

	destroy(): void {
		this.isDestroyed = true;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		for (const comp of this.cardComponents.values()) {
			comp.unload();
		}
		this.cardComponents.clear();
	}

	private observeImmersiveGrid(dockContainer: HTMLElement): void {
		if (typeof ResizeObserver === 'undefined') return;

		this.resizeObserver = new ResizeObserver(() => this.updateImmersiveGrid(dockContainer));
		this.resizeObserver.observe(dockContainer, { box: 'border-box' });
		this.updateImmersiveGrid(dockContainer);
	}

	private observeSidePanelGrid(dockContainer: HTMLElement): void {
		if (typeof ResizeObserver === 'undefined') return;

		this.resizeObserver = new ResizeObserver(() => this.updateSidePanelGrid(dockContainer));
		this.resizeObserver.observe(dockContainer, { box: 'border-box' });
		this.updateSidePanelGrid(dockContainer);
	}

	private updateSidePanelGrid(dockContainer: HTMLElement): void {
		if (isMobile()) {
			dockContainer.setCssProps({
				'--wn-side-note-grid-columns': '1',
				'--wn-side-note-grid-size': 'auto'
			});
			return;
		}

		const gap = 10;
		const padding = 20;
		const minimumNoteSize = 200;
		const availableWidth = Math.max(1, dockContainer.getBoundingClientRect().width - padding);
		const columnCount = Math.max(1, Math.floor((availableWidth + gap) / (minimumNoteSize + gap)));
		const noteSize = Math.max(
			1,
			Math.floor((availableWidth - (columnCount - 1) * gap) / columnCount)
		);

		dockContainer.setCssProps({
			'--wn-side-note-grid-columns': String(columnCount),
			'--wn-side-note-grid-size': `${noteSize}px`
		});
	}

	private updateImmersiveGrid(dockContainer: HTMLElement): void {
		const isHorizontal = !!dockContainer.closest('.webnovel-immersive-slot-horizontal');
		const gap = 10;
		const padding = 20;
		const minimumNoteSize = 240;
		const maximumNoteSize = 300;
		const containerRect = dockContainer.getBoundingClientRect();
		const availablePrimarySize = Math.max(
			1,
			(isHorizontal ? containerRect.height : containerRect.width) - padding
		);
		const lineCount = Math.max(1, Math.floor((availablePrimarySize + gap) / (minimumNoteSize + gap)));
		const noteSize = Math.max(
			1,
			Math.min(
				maximumNoteSize,
				Math.floor((availablePrimarySize - (lineCount - 1) * gap) / lineCount)
			)
		);

		dockContainer.setCssProps({
			'--wn-immersive-note-grid-lines': String(lineCount),
			'--wn-immersive-note-grid-size': `${noteSize}px`
		});
	}

	syncNotesFromManager(): void {
		if (this.isDestroyed || this.isSelfEditing) return;

		const currentNotes = this.plugin.stickyNoteManager.getNotes();
		const dockContainer = this.container.querySelector('.immersive-sticky-dock, .wn-sticky-note-list-grid');
		if (!dockContainer) {
			this.render();
			return;
		}

		const cards = dockContainer.querySelectorAll<HTMLElement>('.wn-sticky-note-list-card');
		const cardNoteIds = Array.from(cards)
			.map(card => card.dataset.noteId)
			.filter((id): id is string => !!id);
		const currentNoteIds = currentNotes.map(note => note.id);
		const idsMatch = cardNoteIds.length === currentNoteIds.length
			&& cardNoteIds.every((id, index) => id === currentNoteIds[index]);

		if (!idsMatch) {
			const activeEl = this.container.ownerDocument.activeElement;
			if (activeEl?.classList.contains('wn-sticky-note-paragraph-editor') && this.container.contains(activeEl)) {
				this.plugin.adaptiveDebounceManager.debounceFixed(
					`sticky-note-list-sync-${this.mode}`,
					() => this.render(),
					1000
				);
				return;
			}
			this.render();
			return;
		}

		cards.forEach(card => {
			const noteId = card.dataset.noteId;
			if (!noteId) return;
			const note = currentNotes.find(item => item.id === noteId);
			if (!note) return;

			card.setCssStyles({ backgroundColor: note.color || '#FDF3B8' });
			if (note.textColor) card.setCssProps({ color: note.textColor });

			const fontSize = `${this.plugin.settings.immersive?.immersiveNoteFontSize || 14}px`;
			card.setCssProps({ '--wn-sticky-note-font-size': fontSize });

			const titleSpan = card.querySelector('.webnovel-immersive-note-title span');
			const title = note.title || t('immersive.note-default-title');
			if (titleSpan && titleSpan.textContent !== title) titleSpan.textContent = title;

			const isNoteEditing = !!note.isEditing;
			const hasEditorInDOM = card.querySelector('.wn-sticky-note-paragraph-editor') !== null;

			if (isNoteEditing !== hasEditorInDOM) {
				this.renderNoteCard(dockContainer as HTMLElement, note, card);
				return;
			}

			if (isNoteEditing) {
				const editor = card.querySelector<HTMLElement>('.wn-sticky-note-paragraph-editor');
				if (editor) {
					editor.setCssStyles({ fontSize });
					if (this.container.ownerDocument.activeElement !== editor) {
						const displayContent = this.getDisplayContent(note.content || '');
						if (getStickyNoteEditorContent(editor) !== displayContent) {
							setStickyNoteEditorContent(editor, displayContent);
						}
					}
				}
			} else {
				const readingEl = card.querySelector<HTMLElement>('.wn-sticky-note-reading-content');
				if (readingEl) {
					readingEl.setCssStyles({ fontSize });
				}
				const lastSaved = this.lastSavedContents.get(noteId);
				if (lastSaved !== (note.content || '')) {
					this.lastSavedContents.set(noteId, note.content || '');
					this.renderNoteCard(dockContainer as HTMLElement, note, card);
				}
			}
		});
	}

	private createToolbar(): HTMLElement {
		if (this.mode === 'immersive') {
			const hoverTrigger = this.container.createDiv({ cls: 'immersive-sticky-trigger webnovel-immersive-hover-trigger' });
			const toolbar = this.container.createDiv({ cls: 'immersive-sticky-toolbar webnovel-immersive-toolbar' });

			const showToolbar = () => this.container.addClass('is-toolbar-visible');
			const hideToolbar = () => this.container.removeClass('is-toolbar-visible');
			hoverTrigger.addEventListener('mouseenter', showToolbar);
			hoverTrigger.addEventListener('mouseleave', hideToolbar);
			toolbar.addEventListener('mouseenter', showToolbar);
			toolbar.addEventListener('mouseleave', hideToolbar);
			this.addToolbarButtons(toolbar);
			return toolbar;
		}

		const toolbar = this.container.createDiv({ cls: 'wn-sticky-note-list-toolbar' });
		this.addToolbarButtons(toolbar);
		return toolbar;
	}

	private addToolbarButtons(toolbar: HTMLElement): void {
		const newBlankButton = toolbar.createEl('button', {
			cls: 'clickable-icon wn-sticky-note-toolbar-button'
		});
		setIcon(newBlankButton, 'plus');
		newBlankButton.setAttribute('aria-label', t('immersive.new-blank-note'));
		newBlankButton.onclick = () => this.createNewNote();

		const openFileButton = toolbar.createEl('button', {
			cls: 'clickable-icon wn-sticky-note-toolbar-button'
		});
		setIcon(openFileButton, 'folder-open');
		openFileButton.setAttribute('aria-label', t('immersive.open-file-as-note'));
		openFileButton.onclick = () => {
			new FileSuggestModal(this.app, this.plugin, file => {
				void this.app.vault.read(file)
					.then(content => this.createNewNote(file.path, content, file.basename))
					.catch(error => {
						Logger.error('[StickyNoteListRenderer] 读取便签文件失败:', error);
						new Notice(t('modal.save-failed', { error: String(error) }));
					});
			}).open();
		};
	}

	public createNewNote(filePath?: string, content?: string, title?: string): void {
		const themeIndex = this.plugin.settings.nextNoteThemeIndex || 0;
		const themes = this.plugin.settings.noteThemes || [];
		const theme = themes[themeIndex] || { bg: '#FDF3B8', text: '#2C3E50' };
		this.plugin.settings.nextNoteThemeIndex = (themeIndex + 1) % Math.max(1, themes.length);

		const note: StickyNoteState = {
			id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
			filePath,
			content: content || '',
			title: title || t('immersive.new-note-title'),
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: theme.bg,
			textColor: theme.text,
			isEditing: true
		};

		this.plugin.stickyNoteManager.updateNote(note);
		this.lastSavedContents.set(note.id, note.content || '');
		void this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes())
			.then(() => {
				this.render();
				const dock = this.container.querySelector('.immersive-sticky-dock, .wn-sticky-note-list-grid');
				const editor = dock?.querySelector<HTMLElement>(`[data-note-id="${note.id}"] .wn-sticky-note-paragraph-editor`);
				if (editor) {
					window.requestAnimationFrame(() => {
						editor.focus();
					});
				}
			})
			.catch(error => {
				Logger.error('[StickyNoteListRenderer] 保存便签失败:', error);
				new Notice(t('modal.save-failed', { error: String(error) }));
			});
		void this.plugin.saveSettings();
	}

	private renderNoteCard(
		dockContainer: HTMLElement,
		noteData: StickyNoteState,
		existingCard?: HTMLElement
	): HTMLElement {
		if (!this.lastSavedContents.has(noteData.id)) {
			this.lastSavedContents.set(noteData.id, noteData.content || '');
		}

		const existingComponent = this.cardComponents.get(noteData.id);
		if (existingComponent) {
			existingComponent.unload();
			this.cardComponents.delete(noteData.id);
		}

		const noteCard = existingCard ?? dockContainer.createDiv();
		noteCard.empty();

		noteCard.className = 'immersive-sticky-card webnovel-immersive-note-card wn-sticky-note-list-card';
		noteCard.dataset.noteId = noteData.id;
		noteCard.setCssStyles({ backgroundColor: noteData.color || '#FDF3B8' });
		if (noteData.textColor) noteCard.setCssProps({ color: noteData.textColor });

		const fontSize = `${this.plugin.settings.immersive?.immersiveNoteFontSize || 14}px`;
		noteCard.setCssProps({ '--wn-sticky-note-font-size': fontSize });

		const titleEl = noteCard.createDiv({ cls: 'immersive-sticky-title webnovel-immersive-note-title' });
		titleEl.createSpan({ text: noteData.title || t('immersive.note-default-title'), cls: 'webnovel-ellipsis' });

		const actionsEl = titleEl.createDiv({ cls: 'wn-sticky-note-card-actions' });

		const isEditing = !!noteData.isEditing;
		if (noteData.filePath) {
			const syncBtn = actionsEl.createEl('button', {
				cls: 'clickable-icon wn-sticky-note-card-action-btn wn-sticky-note-sync'
			});
			setIcon(syncBtn, 'refresh-cw');
			syncBtn.setAttribute('aria-label', t('common.note-sync-from-doc'));
			syncBtn.onclick = (e: MouseEvent) => {
				e.stopPropagation();
				void this.syncNoteFromFile(noteData.id);
			};
		}

		const toggleBtn = actionsEl.createEl('button', {
			cls: 'clickable-icon wn-sticky-note-card-action-btn wn-sticky-note-edit-toggle'
		});
		const toggleLabel = isEditing ? t('immersive.done-editing-tooltip') : t('immersive.edit-note-tooltip');
		setIcon(toggleBtn, isEditing ? 'eye' : 'pencil');
		toggleBtn.setAttribute('aria-label', toggleLabel);

		const closeBtn = actionsEl.createEl('button', {
			cls: 'clickable-icon wn-sticky-note-card-action-btn webnovel-immersive-note-close'
		});
		setIcon(closeBtn, 'x');
		const closeLabel = t('immersive.close-note-tooltip');
		closeBtn.setAttribute('aria-label', closeLabel);
		closeBtn.onclick = (e: MouseEvent) => {
			e.stopPropagation();
			this.closeNote(noteData);
		};

		if (isEditing) {
			const displayContent = this.getDisplayContent(noteData.content || '');
			const editor = createStickyNoteParagraphEditor(
				noteCard,
				displayContent,
				'webnovel-immersive-note-textarea'
			);
			editor.setCssStyles({ fontSize });

			const stopPropagation = (e: Event) => e.stopPropagation();
			editor.addEventListener('keydown', stopPropagation);
			editor.addEventListener('keyup', stopPropagation);
			editor.addEventListener('keypress', stopPropagation);

			editor.addEventListener('input', () => {
				this.isSelfEditing = true;
				try {
					const currentNote = this.plugin.stickyNoteManager.getNotes().find(note => note.id === noteData.id) || noteData;
					const frontmatter = this.getFrontmatter(currentNote.content || '');
					const updatedNote: StickyNoteState = {
						...currentNote,
						content: frontmatter + getStickyNoteEditorContent(editor)
					};
					this.plugin.stickyNoteManager.updateNote(updatedNote, true);

					if (this.plugin.settings.stickyNoteAutoSave) {
						this.plugin.adaptiveDebounceManager.debounceFixed(`sticky-note-list-save-${updatedNote.id}`, () => {
							void this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
							this.lastSavedContents.set(updatedNote.id, updatedNote.content || '');
							if (updatedNote.filePath) {
								const file = this.app.vault.getAbstractFileByPath(updatedNote.filePath);
								if (file instanceof TFile) void this.app.vault.process(file, () => updatedNote.content || '');
							}
						}, 500);
					}
				} finally {
					queueMicrotask(() => { this.isSelfEditing = false; });
				}
			});

			toggleBtn.onclick = (e: MouseEvent) => {
				e.stopPropagation();
				void this.finishEditingNote(noteData.id, editor);
			};
		} else {
			const contentEl = noteCard.createDiv({
				cls: 'my-sticky-content markdown-rendered wn-sticky-note-reading-content'
			});
			contentEl.tabIndex = -1;
			contentEl.setCssStyles({ fontSize });

			const cardComponent = new Component();
			this.cardComponents.set(noteData.id, cardComponent);
			cardComponent.load();

			const displayContent = this.getDisplayContent(noteData.content || '');
			void MarkdownRenderer.render(
				this.app,
				displayContent,
				contentEl,
				noteData.filePath || '',
				cardComponent
			).then(() => {
				if (!this.isDestroyed && contentEl.isConnected) {
					injectSoftBreakIndentPlaceholders(contentEl, false);
				}
			}).catch(error => {
				Logger.error('[StickyNoteListRenderer] 渲染 Markdown 失败:', error);
			});

			toggleBtn.onclick = (e: MouseEvent) => {
				e.stopPropagation();
				this.startEditingNote(noteData.id);
			};
		}

		return noteCard;
	}

	private async syncNoteFromFile(noteId: string): Promise<void> {
		try {
			const note = this.plugin.stickyNoteManager.getNotes().find(item => item.id === noteId);
			if (!note?.filePath) return;

			const file = this.app.vault.getAbstractFileByPath(note.filePath);
			if (!(file instanceof TFile)) return;

			const content = await this.app.vault.read(file);
			const latestNote = this.plugin.stickyNoteManager.getNotes().find(item => item.id === noteId);
			if (!latestNote || latestNote.filePath !== file.path) return;

			const updatedNote: StickyNoteState = {
				...latestNote,
				content
			};
			this.plugin.stickyNoteManager.updateNote(updatedNote);
			await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
			this.lastSavedContents.set(noteId, content);

			const dock = this.container.querySelector('.immersive-sticky-dock, .wn-sticky-note-list-grid');
			const existingCard = dock?.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
			if (dock && existingCard) {
				this.renderNoteCard(dock as HTMLElement, updatedNote, existingCard);
			} else {
				this.render();
			}

			new Notice(t('modal.note-synced'));
		} catch (error) {
			Logger.error('[StickyNoteListRenderer] 从关联文档同步便签失败:', error);
			new Notice(t('modal.save-failed', { error: String(error) }));
		}
	}

	private startEditingNote(noteId: string): void {
		const currentNote = this.plugin.stickyNoteManager.getNotes().find(n => n.id === noteId);
		if (!currentNote) return;

		const updatedNote: StickyNoteState = {
			...currentNote,
			isEditing: true
		};
		this.plugin.stickyNoteManager.updateNote(updatedNote);

		const dock = this.container.querySelector('.immersive-sticky-dock, .wn-sticky-note-list-grid');
		if (!dock) {
			this.render();
			return;
		}

		const existingCard = dock.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
		if (existingCard) {
			const newCard = this.renderNoteCard(dock as HTMLElement, updatedNote, existingCard);
			const editor = newCard.querySelector<HTMLElement>('.wn-sticky-note-paragraph-editor');
			if (editor) {
				window.requestAnimationFrame(() => {
					editor.focus();
				});
			}
		} else {
			this.render();
		}
	}

	private async finishEditingNote(noteId: string, editor: HTMLElement): Promise<void> {
		try {
			const currentNote = this.plugin.stickyNoteManager.getNotes().find(n => n.id === noteId);
			if (!currentNote) {
				this.render();
				return;
			}

			const frontmatter = this.getFrontmatter(currentNote.content || '');
			const editorContent = getStickyNoteEditorContent(editor);
			const fullContent = frontmatter + editorContent;

			const updatedNote: StickyNoteState = {
				...currentNote,
				content: fullContent,
				isEditing: false
			};
			this.plugin.stickyNoteManager.updateNote(updatedNote);
			await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
			this.lastSavedContents.set(updatedNote.id, fullContent);

			if (updatedNote.filePath) {
				const file = this.app.vault.getAbstractFileByPath(updatedNote.filePath);
				if (file instanceof TFile) {
					await this.app.vault.process(file, () => fullContent);
				}
			}

			const dock = this.container.querySelector('.immersive-sticky-dock, .wn-sticky-note-list-grid');
			if (!dock) {
				this.render();
				return;
			}

			const existingCard = dock.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
			if (existingCard) {
				this.renderNoteCard(dock as HTMLElement, updatedNote, existingCard);
			} else {
				this.render();
			}
		} catch (error) {
			Logger.error('[StickyNoteListRenderer] 完成便签编辑保存失败:', error);
			new Notice(t('modal.save-failed', { error: String(error) }));
		}
	}

	private closeNote(noteData: StickyNoteState): void {
		const latestNote = this.plugin.stickyNoteManager.getNotes().find(note => note.id === noteData.id) || noteData;
		const isEditing = !!latestNote.isEditing;
		const dock = this.container.querySelector('.immersive-sticky-dock, .wn-sticky-note-list-grid');
		const editor = dock?.querySelector<HTMLElement>(`[data-note-id="${latestNote.id}"] .wn-sticky-note-paragraph-editor`);

		let currentContent = latestNote.content || '';
		if (isEditing && editor) {
			const frontmatter = this.getFrontmatter(latestNote.content || '');
			currentContent = frontmatter + getStickyNoteEditorContent(editor);
		}

		const lastSaved = this.lastSavedContents.get(latestNote.id) || '';
		const shouldPrompt = (!latestNote.filePath && currentContent.trim().length > 0)
			|| (!!latestNote.filePath && currentContent !== lastSaved);

		const performRemove = async () => {
			this.cardComponents.get(latestNote.id)?.unload();
			this.cardComponents.delete(latestNote.id);
			await this.plugin.stickyNoteManager.removeNoteAndWait(latestNote.id);
			this.lastSavedContents.delete(latestNote.id);
			this.render();
		};

		if (!shouldPrompt) {
			void performRemove();
			return;
		}

		new ConfirmCloseModal(this.app, async shouldSave => {
			if (!shouldSave) {
				await performRemove();
				return;
			}

			if (latestNote.filePath) {
				const file = this.app.vault.getAbstractFileByPath(latestNote.filePath);
				if (!(file instanceof TFile)) throw new Error(`Linked note file not found: ${latestNote.filePath}`);
				await this.app.vault.process(file, () => currentContent);
				new Notice(t('modal.note-saved'));
				await performRemove();
				return;
			}

			new SaveStickyNoteModal(this.app, async (fileName: string, folderPath: string) => {
				const fullPath = `${folderPath ? `${folderPath}/` : ''}${fileName.endsWith('.md') ? fileName : `${fileName}.md`}`;
				if (this.app.vault.getAbstractFileByPath(fullPath)) {
					new Notice(t('modal.file-already-exists', { path: fullPath }));
					return;
				}
				await this.app.vault.create(fullPath, currentContent);
				new Notice(t('modal.saved-as', { path: fullPath }));
				await performRemove();
			}).open();
		}).open();
	}

	private getFrontmatter(content: string): string {
		const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
		return match?.[0] || '';
	}

	private getDisplayContent(content: string): string {
		const frontmatter = this.getFrontmatter(content);
		return frontmatter ? content.substring(frontmatter.length) : content;
	}
}
