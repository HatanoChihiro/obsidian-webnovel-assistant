import type { App, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import { ChapterCard } from './ChapterCard';

export interface CorkboardGridOptions {
	app: App;
	plugin: WebNovelAssistantPlugin;
	container: HTMLElement;
	files: TFile[];
	foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>;
	draggable: boolean;
	currentBookPath: string;
	onSaveStateChange: (isSaving: boolean) => void;
}

export class CorkboardGridRenderer {
	static render(options: CorkboardGridOptions): void {
		const { app, plugin, container, files, foreshadowingMap, draggable, currentBookPath, onSaveStateChange } = options;
		
		for (const file of files) {
			ChapterCard.render(container, file, app, plugin, foreshadowingMap.get(file.basename) || [], {
				draggable,
				onSaveStateChange,
				currentBookPath
			});
		}
	}
}

