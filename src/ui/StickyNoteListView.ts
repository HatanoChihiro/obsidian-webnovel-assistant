import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';
import { StickyNoteListRenderer } from './components/StickyNoteListRenderer';

/** 可在桌面端和移动端侧面板打开的便签列表视图。 */
export class StickyNoteListView extends ItemView {
	private readonly plugin: WebNovelAssistantPlugin;
	private listRenderer: StickyNoteListRenderer | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPES.STICKY_NOTE_LIST;
	}

	getDisplayText(): string {
		return t('view.sticky-note-list');
	}

	getIcon(): string {
		return 'sticky-note';
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass('wn-sticky-note-list-view');
		this.listRenderer = new StickyNoteListRenderer(this.app, this.plugin, this.containerEl, { mode: 'side-panel' });
		this.listRenderer.render();
		this.registerEvent(this.app.workspace.on('webnovel:notes-changed', () => this.listRenderer?.syncNotesFromManager()));
	}

	async onClose(): Promise<void> {
		this.listRenderer?.destroy();
		this.listRenderer = null;
	}
}
