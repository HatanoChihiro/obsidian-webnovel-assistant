import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import { t } from '../i18n';
import type { StickyNoteListRendererPlugin } from './components/StickyNoteListRenderer';
import { StickyNoteListRenderer } from './components/StickyNoteListRenderer';

export type ImmersiveStickyNotesViewPlugin = StickyNoteListRendererPlugin;

export class ImmersiveStickyNotesView extends ItemView {
	private readonly plugin: ImmersiveStickyNotesViewPlugin;
	private listRenderer: StickyNoteListRenderer | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ImmersiveStickyNotesViewPlugin) {
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

	async onOpen(): Promise<void> {
		this.listRenderer = new StickyNoteListRenderer(this.app, this.plugin, this.contentEl, { mode: 'immersive' });
		this.listRenderer.render();
		this.registerEvent(this.app.workspace.on('webnovel:notes-changed', () => this.listRenderer?.syncNotesFromManager()));
	}

	async onClose(): Promise<void> {
		this.listRenderer?.destroy();
		this.listRenderer = null;
	}
}
