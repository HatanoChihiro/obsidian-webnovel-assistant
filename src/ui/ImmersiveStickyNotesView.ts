import { ItemView, WorkspaceLeaf, debounce } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';

export class ImmersiveStickyNotesView extends ItemView {
	plugin: WebNovelAssistantPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPES.IMMERSIVE_STICKY_NOTES;
	}

	getDisplayText(): string {
		return '便签列表';
	}
	
	getIcon(): string {
		return 'sticky-note';
	}

	async onOpen() {
		const { containerEl } = this;
		containerEl.empty();
		
		const dockContainer = containerEl.createDiv({ cls: 'immersive-sticky-dock' });
		
		// 渲染便签
		const notes = this.plugin.settings.openNotes || [];
		
		if (notes.length === 0) {
			dockContainer.createEl('p', { text: '暂无打开的便签。可以在退出沉浸模式后新建便签。', cls: 'immersive-empty-text' });
			return;
		}

		for (const noteData of notes) {
			const noteCard = dockContainer.createDiv({ cls: 'immersive-sticky-card' });
			noteCard.style.backgroundColor = noteData.color || '#FDF3B8';
			if (noteData.textColor) {
				noteCard.style.color = noteData.textColor;
			}
			
			const textarea = noteCard.createEl('textarea');
			textarea.value = noteData.content || '';
			if (noteData.textColor) {
				textarea.style.color = noteData.textColor;
			}
			
			// 绑定实时保存，复用现有便签逻辑
			textarea.addEventListener('input', debounce(async () => {
				noteData.content = textarea.value;
				await this.plugin.saveSettings();
			}, 500, true));
		}
	}

	async onClose() {
		// Cleanup
	}
}
