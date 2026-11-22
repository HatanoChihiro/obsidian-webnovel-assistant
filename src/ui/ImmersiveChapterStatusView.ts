import type { WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import { t } from '../i18n';
import { WritingStatusView, type WritingStatusViewPlugin } from './StatusView';

export class ImmersiveChapterStatusView extends WritingStatusView {
	constructor(leaf: WorkspaceLeaf, plugin: WritingStatusViewPlugin) {
		super(leaf, plugin, 'chapter-only');
	}

	getViewType(): string {
		return VIEW_TYPES.IMMERSIVE_CHAPTER_STATUS;
	}

	getDisplayText(): string {
		return t('view.immersive-chapter-status');
	}

	getIcon(): string {
		return 'file-check';
	}
}
