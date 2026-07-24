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
	hideVolumeHeaders?: boolean;
	maxLoreLines?: number;
}

export class CorkboardGridRenderer {
	static render(options: CorkboardGridOptions): void {
		const { app, plugin, container, files, foreshadowingMap, draggable, currentBookPath, onSaveStateChange, maxLoreLines } = options;
		
		let lastVolume: string | null = null;

		for (const file of files) {
			// 计算该文件所属的分卷（相对于 currentBookPath）
			let currentVolume = '';
			if (currentBookPath && currentBookPath !== '/') {
				if (file.parent && file.parent.path !== currentBookPath) {
					currentVolume = file.parent.path.substring(currentBookPath.length + 1);
				}
			} else {
				if (file.parent && file.parent.path !== '/') {
					currentVolume = file.parent.path;
				}
			}
			
			// 如果分卷发生变化，插入一个分卷标题栏
			if (currentVolume !== lastVolume) {
				lastVolume = currentVolume;
				
				// 不显示根目录的“正文”标题，只有在存在分卷时才显示卷名，同时受 hideVolumeHeaders 控制
				if (currentVolume !== '' && !options.hideVolumeHeaders) {
					const header = container.createDiv('wn-corkboard-volume-header');
					header.setText(currentVolume);
				}
			}

			ChapterCard.render(container, file, app, plugin, foreshadowingMap.get(file.basename) || [], {
				draggable,
				onSaveStateChange,
				currentBookPath,
				maxLoreLines
			});
		}
	}
}

