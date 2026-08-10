import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';
import { StickyNoteListRenderer } from './components/StickyNoteListRenderer';

export class ImmersiveStickyNotesView extends ItemView {
	private readonly plugin: WebNovelAssistantPlugin;
	private listRenderer: StickyNoteListRenderer | null = null;

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

	async onOpen(): Promise<void> {
		this.listRenderer = new StickyNoteListRenderer(this.app, this.plugin, this.containerEl, { mode: 'immersive' });
		this.listRenderer.render();
		this.registerEvent(this.app.workspace.on('webnovel:notes-changed', () => this.listRenderer?.syncNotesFromManager()));
	}

	async onClose(): Promise<void> {
		this.listRenderer?.destroy();
		this.listRenderer = null;
	}
}
