import { setIcon, type App, type TFile } from 'obsidian';
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
		
		// 按分卷分组
		const volumeGroups: Array<{ volume: string; files: TFile[] }> = [];

		for (const file of files) {
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

			let group = volumeGroups.find(g => g.volume === currentVolume);
			if (!group) {
				group = { volume: currentVolume, files: [] };
				volumeGroups.push(group);
			}
			group.files.push(file);
		}

		for (const group of volumeGroups) {
			const cardContainers: HTMLElement[] = [];

			if (group.volume !== '' && !options.hideVolumeHeaders) {
				const header = container.createDiv('wn-corkboard-volume-header wn-clickable');
				const iconSpan = header.createSpan({ cls: 'wn-volume-header-icon' });
				setIcon(iconSpan, 'chevron-down');
				header.createSpan({ text: `${group.volume} (${group.files.length})`, cls: 'wn-volume-header-title' });

				for (const file of group.files) {
					// 创建承载单个卡片的容器，便于整卷批量隐藏/恢复
					const cardWrapper = container.createDiv('wn-corkboard-card-wrapper');
					cardWrapper.setCssProps({ display: 'contents' });
					ChapterCard.render(cardWrapper, file, app, plugin, foreshadowingMap.get(file.basename) || [], {
						draggable,
						onSaveStateChange,
						currentBookPath,
						maxLoreLines
					});
					cardContainers.push(cardWrapper);
				}

				header.onclick = () => {
					const isCollapsed = header.hasClass('is-collapsed');
					if (isCollapsed) {
						header.removeClass('is-collapsed');
						setIcon(iconSpan, 'chevron-down');
						cardContainers.forEach(wrapper => wrapper.setCssProps({ display: 'contents' }));
					} else {
						header.addClass('is-collapsed');
						setIcon(iconSpan, 'chevron-right');
						cardContainers.forEach(wrapper => wrapper.setCssProps({ display: 'none' }));
					}
				};
			} else {
				for (const file of group.files) {
					ChapterCard.render(container, file, app, plugin, foreshadowingMap.get(file.basename) || [], {
						draggable,
						onSaveStateChange,
						currentBookPath,
						maxLoreLines
					});
				}
			}
		}
	}
}

