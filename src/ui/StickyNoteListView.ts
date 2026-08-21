import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import { t } from '../i18n';
import type { StickyNoteListRendererPlugin } from './components/StickyNoteListRenderer';
import { StickyNoteListRenderer } from './components/StickyNoteListRenderer';

export type StickyNoteListViewPlugin = StickyNoteListRendererPlugin;

/** 可在桌面端和移动端侧面板打开的便签列表视图。 */
export class StickyNoteListView extends ItemView {
	private readonly plugin: StickyNoteListViewPlugin;
	private listRenderer: StickyNoteListRenderer | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StickyNoteListViewPlugin) {
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
		this.contentEl.addClass('wn-sticky-note-list-view');
		this.listRenderer = new StickyNoteListRenderer(this.app, this.plugin, this.contentEl, { mode: 'side-panel' });
		this.listRenderer.render();
		this.registerEvent(this.app.workspace.on('webnovel:notes-changed', () => this.listRenderer?.syncNotesFromManager()));
	}

	async onClose(): Promise<void> {
		this.listRenderer?.destroy();
		this.listRenderer = null;
	}
}
