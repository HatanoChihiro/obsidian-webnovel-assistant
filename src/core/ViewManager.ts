import type { WorkspaceLeaf } from 'obsidian';
import { isDesktop, isMobile } from '../utils/platform';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { VIEW_TYPES } from '../constants';
import { WritingStatusView, STATUS_VIEW_TYPE } from '../ui/StatusView';
import { ForeshadowingView, FORESHADOWING_VIEW_TYPE } from '../ui/ForeshadowingView';
import { TimelineView, TIMELINE_VIEW_TYPE } from '../ui/TimelineView';
import { TaskView, TASK_VIEW_TYPE } from '../ui/TaskView';
import { ImmersiveChapterListView } from '../ui/ImmersiveChapterListView';
import { ImmersiveStickyNotesView } from '../ui/ImmersiveStickyNotesView';
import { ChapterOverviewView, CORKBOARD_VIEW_TYPE } from '../ui/ChapterOverviewView';
import { WorkbenchView, WORKBENCH_VIEW_TYPE } from '../ui/WorkbenchView';
import { RelationGraphView, RELATION_GRAPH_VIEW_TYPE } from '../ui/RelationGraphView';

export class ViewManager {
	private plugin: WebNovelAssistantPlugin;

	constructor(plugin: WebNovelAssistantPlugin) {
		this.plugin = plugin;
	}

	registerAllViews() {
		this.plugin.registerView(STATUS_VIEW_TYPE, (leaf) => new WritingStatusView(leaf, this.plugin));
		this.plugin.registerView(FORESHADOWING_VIEW_TYPE, (leaf) => new ForeshadowingView(leaf, this.plugin));
		this.plugin.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this.plugin));
		this.plugin.registerView(TASK_VIEW_TYPE, (leaf) => new TaskView(leaf, this.plugin));
		this.plugin.registerView(WORKBENCH_VIEW_TYPE, (leaf) => new WorkbenchView(leaf, this.plugin));
		this.plugin.registerView(CORKBOARD_VIEW_TYPE, (leaf) => new ChapterOverviewView(leaf, this.plugin));
		this.plugin.registerView(RELATION_GRAPH_VIEW_TYPE, (leaf) => new RelationGraphView(leaf, this.plugin));
		
		if (isDesktop()) { // Desktop
			this.plugin.registerView(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST, (leaf) => new ImmersiveChapterListView(leaf, this.plugin));
			this.plugin.registerView(VIEW_TYPES.IMMERSIVE_STICKY_NOTES, (leaf) => new ImmersiveStickyNotesView(leaf, this.plugin));
		}
	}

	detachAllViews() {
		const viewTypes = [
			STATUS_VIEW_TYPE,
			FORESHADOWING_VIEW_TYPE,
			TIMELINE_VIEW_TYPE,
			TASK_VIEW_TYPE,
			WORKBENCH_VIEW_TYPE,
			CORKBOARD_VIEW_TYPE,
			RELATION_GRAPH_VIEW_TYPE,
			VIEW_TYPES.IMMERSIVE_CHAPTER_LIST,
			VIEW_TYPES.IMMERSIVE_STICKY_NOTES
		];
		
		for (const type of viewTypes) {
			try {
				if (type) {
					this.plugin.app.workspace.detachLeavesOfType(type);
				}
			} catch (e) {
				console.error(`[WebNovel Assistant] Error detaching leaf ${type}:`, e);
			}
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
			leaf.detach();
		} else {
			if (viewType === 'webnovel-workbench') {
				leaf = workspace.getLeaf('tab');
				if (leaf) {
					await leaf.setViewState({ type: viewType, active: true });
					void workspace.revealLeaf(leaf);
					void workspace.setActiveLeaf(leaf, { focus: true });
				}
			} else if (isMobile()) {
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
				void workspace.revealLeaf(leaf);
				if (isMobile()) {
					workspace.rightSplit?.expand();
				}
			}
		}
		} finally {
			this.isToggling = false;
		}
	}
}
