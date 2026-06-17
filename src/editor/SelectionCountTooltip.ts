import { StateField, Extension, EditorState } from '@codemirror/state';
import { showTooltip, Tooltip } from '@codemirror/view';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

export const selectionCountTooltipExtension = (plugin: WebNovelAssistantPlugin): Extension => {
	const cursorTooltipField = StateField.define<readonly Tooltip[]>({
		create: getTooltip,

		update(tooltips, tr) {
			if (!tr.docChanged && !tr.selection) return tooltips;
			return getTooltip(tr.state);
		},

		provide: f => showTooltip.computeN([f], state => state.field(f))
	});

	function getTooltip(state: EditorState): readonly Tooltip[] {
		if (!plugin.settings.enableSelectionWordCount) {
			return [];
		}

		const selection = state.selection.main;
		if (selection.empty) {
			return [];
		}
		
		const selectedText = state.sliceDoc(selection.from, selection.to);
		// 超过 1 个字符才显示
		if (!selectedText || selectedText.length <= 1) {
			return [];
		}
		
		// 获取精准字数
		const wordCount = plugin.calculateAccurateWords(selectedText);

		return [{
			pos: selection.to, // 悬浮在选区末尾
			above: true,       // 尝试显示在上方
			strictSide: true,
			create: () => {
				const dom = activeDocument.createElement('div');
				dom.className = 'cm-tooltip-selection-count';
				dom.textContent = t('common.selection-count', { count: String(wordCount) });
				return { dom };
			}
		}];
	}

	return [cursorTooltipField];
};
