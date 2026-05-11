import { WorkspaceLeaf } from 'obsidian';
import type AccurateChineseCountPlugin from '../../main';
import { VIEW_TYPES } from '../constants';
import { WritingStatusView, STATUS_VIEW_TYPE } from '../ui/StatusView';
import { ForeshadowingView, FORESHADOWING_VIEW_TYPE } from '../ui/ForeshadowingView';
import { TimelineView, TIMELINE_VIEW_TYPE } from '../ui/TimelineView';
import { ImmersiveChapterListView } from '../ui/ImmersiveChapterListView';
import { ImmersiveStickyNotesView } from '../ui/ImmersiveStickyNotesView';

export class ViewManager {
	private plugin: AccurateChineseCountPlugin;

	constructor(plugin: AccurateChineseCountPlugin) {
		this.plugin = plugin;
	}

	registerAllViews() {
		this.plugin.registerView(STATUS_VIEW_TYPE, (leaf) => new WritingStatusView(leaf, this.plugin));
		this.plugin.registerView(FORESHADOWING_VIEW_TYPE, (leaf) => new ForeshadowingView(leaf, this.plugin));
		this.plugin.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this.plugin));
		
		if (this.plugin.app.isMobile === false) { // Desktop
			this.plugin.registerView(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST, (leaf) => new ImmersiveChapterListView(leaf, this.plugin));
			this.plugin.registerView(VIEW_TYPES.IMMERSIVE_STICKY_NOTES, (leaf) => new ImmersiveStickyNotesView(leaf, this.plugin));
		}
	}

	private isToggling = false;

	async toggleView(viewType: string) {
		if (this.isToggling) return;
		this.isToggling = true;
		try {
		const { workspace } = this.plugin.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(viewType);

		if (leaves.length > 0) {
			leaf = leaves[0];
			workspace.detachLeaf(leaf);
		} else {
			if (this.plugin.app.isMobile) {
				const rightLeaf = workspace.getRightLeaf(false);
				if (rightLeaf) {
					leaf = rightLeaf;
					await leaf.setViewState({ type: viewType, active: true });
				}
			} else {
				leaf = workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({ type: viewType, active: true });
				} else {
					// Fallback if getRightLeaf returns null (rare but possible)
					const newLeaf = workspace.getLeaf('tab');
					if (newLeaf) {
						leaf = newLeaf;
						await leaf.setViewState({ type: viewType, active: true });
					}
				}
			}
			
			if (leaf) {
				workspace.revealLeaf(leaf);
				if (this.plugin.app.isMobile) {
					workspace.rightSplit?.expand();
				}
			}
		}
		} finally {
			this.isToggling = false;
		}
	}
}
