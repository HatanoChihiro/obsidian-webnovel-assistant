import { FuzzySuggestModal, Notice, TFile, setIcon, type App } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { StickyNoteState } from '../../types/settings';
import { t } from '../../i18n';
import { ConfirmCloseModal, SaveStickyNoteModal } from '../StickyNote';

export type StickyNoteListMode = 'immersive' | 'side-panel';

interface StickyNoteListRendererOptions {
	mode: StickyNoteListMode;
}

export function getStickyNoteFileCandidates(
	plugin: Pick<WebNovelAssistantPlugin, 'getVaultMarkdownFiles'>
): TFile[] {
	return plugin.getVaultMarkdownFiles();
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly plugin: WebNovelAssistantPlugin,
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
 * 沉浸模式与侧面板共用编辑、保存和关闭逻辑，移动端侧面板不会显示悬浮便签。
 */
export class StickyNoteListRenderer {
	private readonly mode: StickyNoteListMode;
	private readonly lastSavedContents = new Map<string, string>();
	private isSelfEditing = false;
	private isDestroyed = false;
	private resizeObserver: ResizeObserver | null = null;

	constructor(
		private readonly app: App,
		private readonly plugin: WebNovelAssistantPlugin,
		private readonly container: HTMLElement,
		options: StickyNoteListRendererOptions
	) {
		this.mode = options.mode;
	}

	render(): void {
		if (this.isDestroyed) return;

		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.container.empty();
		this.container.addClass('wn-sticky-note-list-container');
		if (this.mode === 'immersive') {
			this.container.addClass('webnovel-immersive-sticky-container');
		} else {
			this.container.addClass('wn-sticky-note-list-side-panel');
		}

		this.createToolbar();
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
			this.renderNote(dockContainer, noteData);
		}
	}

	destroy(): void {
		this.isDestroyed = true;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private observeImmersiveGrid(dockContainer: HTMLElement): void {
		if (typeof ResizeObserver === 'undefined') return;

		this.resizeObserver = new ResizeObserver(() => this.updateImmersiveGrid(dockContainer));
		this.resizeObserver.observe(dockContainer);
		this.updateImmersiveGrid(dockContainer);
	}

	private observeSidePanelGrid(dockContainer: HTMLElement): void {
		if (typeof ResizeObserver === 'undefined') return;

		this.resizeObserver = new ResizeObserver(() => this.updateSidePanelGrid(dockContainer));
		this.resizeObserver.observe(dockContainer);
		this.updateSidePanelGrid(dockContainer);
	}

	private updateSidePanelGrid(dockContainer: HTMLElement): void {
		const gap = 10;
		const padding = 20;
		const minimumNoteSize = 150;
		const availableWidth = Math.max(1, dockContainer.clientWidth - padding);
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
		const availablePrimarySize = Math.max(
			1,
			(isHorizontal ? dockContainer.clientHeight : dockContainer.clientWidth) - padding
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
			const activeEl = activeDocument.activeElement;
			if (activeEl && activeEl.tagName.toLowerCase() === 'textarea' && this.container.contains(activeEl)) {
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

			const titleSpan = card.querySelector('.webnovel-immersive-note-title span');
			const title = note.title || t('immersive.note-default-title');
			if (titleSpan && titleSpan.textContent !== title) titleSpan.textContent = title;

			const textarea = card.querySelector<HTMLTextAreaElement>('textarea');
			if (textarea) {
				textarea.setCssStyles({ fontSize: `${this.plugin.settings.immersive.immersiveNoteFontSize || 14}px` });
			}
			if (textarea && activeDocument.activeElement !== textarea) {
				const displayContent = this.getDisplayContent(note.content || '');
				if (textarea.value !== displayContent) textarea.value = displayContent;
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
		const newBlankButton = toolbar.createEl('button', { cls: 'wn-sticky-note-toolbar-button' });
		setIcon(newBlankButton, 'file-plus');
		newBlankButton.title = t('immersive.new-blank-note');
		newBlankButton.setAttribute('aria-label', t('immersive.new-blank-note'));
		newBlankButton.onclick = () => this.createNewNote();

		const openFileButton = toolbar.createEl('button', { cls: 'wn-sticky-note-toolbar-button' });
		setIcon(openFileButton, 'file-text');
		openFileButton.title = t('immersive.open-file-as-note');
		openFileButton.setAttribute('aria-label', t('immersive.open-file-as-note'));
		openFileButton.onclick = () => {
			new FileSuggestModal(this.app, this.plugin, file => {
				void this.app.vault.read(file)
					.then(content => this.createNewNote(file.path, content, file.basename))
					.catch(error => console.error('[StickyNoteListRenderer] 读取便签文件失败:', error));
			}).open();
		};
	}

	private createNewNote(filePath?: string, content?: string, title?: string): void {
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
			.then(() => this.render())
			.catch(error => console.error('[StickyNoteListRenderer] 保存便签失败:', error));
		void this.plugin.saveSettings();
	}

	private renderNote(dockContainer: HTMLElement, noteData: StickyNoteState): void {
		if (!this.lastSavedContents.has(noteData.id)) {
			this.lastSavedContents.set(noteData.id, noteData.content || '');
		}

		const noteCard = dockContainer.createDiv({ cls: 'immersive-sticky-card webnovel-immersive-note-card wn-sticky-note-list-card' });
		noteCard.dataset.noteId = noteData.id;
		noteCard.setCssStyles({ backgroundColor: noteData.color || '#FDF3B8' });
		if (noteData.textColor) noteCard.setCssProps({ color: noteData.textColor });

		const titleEl = noteCard.createDiv({ cls: 'immersive-sticky-title webnovel-immersive-note-title' });
		const titleSpan = titleEl.createSpan({ text: noteData.title || t('immersive.note-default-title') });
		titleSpan.addClass('webnovel-ellipsis');
		const closeButton = titleEl.createSpan({ cls: 'clickable-icon webnovel-immersive-note-close', text: '×' });
		closeButton.title = t('immersive.close-note-tooltip');
		closeButton.onclick = () => this.closeNote(noteData);

		const textarea = noteCard.createEl('textarea', { cls: 'webnovel-immersive-note-textarea' });
		textarea.value = this.getDisplayContent(noteData.content || '');
		textarea.setCssStyles({ fontSize: `${this.plugin.settings.immersive.immersiveNoteFontSize || 14}px` });
		const frontmatter = this.getFrontmatter(noteData.content || '');
		textarea.addEventListener('input', () => {
			this.isSelfEditing = true;
			try {
				const latestNote = this.plugin.stickyNoteManager.getNotes().find(note => note.id === noteData.id) || noteData;
				latestNote.content = frontmatter + textarea.value;
				this.plugin.stickyNoteManager.updateNote(latestNote, true);

				if (this.plugin.settings.stickyNoteAutoSave) {
					this.plugin.adaptiveDebounceManager.debounceFixed(`sticky-note-list-save-${latestNote.id}`, () => {
						void this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
						this.lastSavedContents.set(latestNote.id, latestNote.content || '');
						if (latestNote.filePath) {
							const file = this.app.vault.getAbstractFileByPath(latestNote.filePath);
							if (file instanceof TFile) void this.app.vault.process(file, () => latestNote.content || '');
						}
					}, 500);
				}
			} finally {
				queueMicrotask(() => { this.isSelfEditing = false; });
			}
		});
	}

	private closeNote(noteData: StickyNoteState): void {
		const latestNote = this.plugin.stickyNoteManager.getNotes().find(note => note.id === noteData.id) || noteData;
		const currentContent = latestNote.content || '';
		const lastSaved = this.lastSavedContents.get(latestNote.id) || '';
		const shouldPrompt = (!latestNote.filePath && currentContent.trim().length > 0)
			|| (!!latestNote.filePath && currentContent !== lastSaved);

		const performRemove = async () => {
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

			new SaveStickyNoteModal(this.app, this.plugin, async (fileName: string, folderPath: string) => {
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
