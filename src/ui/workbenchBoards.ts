import { t } from '../i18n';
import type { WorkbenchBoardId } from '../types/settings';

export const WORKBENCH_BOARD_IDS: readonly WorkbenchBoardId[] = [
	'default',
	'timeline',
	'lore',
	'foreshadowing',
	'task',
	'journey'
] as const;

export const WORKBENCH_BOARD_LABEL_KEYS: Record<WorkbenchBoardId, string> = {
	default: 'corkboard.sort-default',
	timeline: 'corkboard.sort-timeline',
	lore: 'corkboard.sort-lore',
	foreshadowing: 'corkboard.sort-foreshadowing',
	task: 'view.task',
	journey: 'corkboard.sort-journey'
};

export function getWorkbenchBoardLabel(boardId: WorkbenchBoardId): string {
	return t(WORKBENCH_BOARD_LABEL_KEYS[boardId]);
}
