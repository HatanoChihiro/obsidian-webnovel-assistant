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
	groupVolumeCards?: boolean;
	maxLoreLines?: number;
}

export class CorkboardGridRenderer {
	static render(options: CorkboardGridOptions): void {
		const { app, plugin, container, files, foreshadowingMap, draggable, currentBookPath, onSaveStateChange, maxLoreLines } = options;
		const volumeCollapsedCardClass = 'is-volume-collapsed';
		
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
			const hasVolumeHeader = group.volume !== '' && !options.hideVolumeHeaders;
			const volumeGroup = options.groupVolumeCards
				? container.createDiv('wn-corkboard-volume-group')
				: container;
			let header: HTMLElement | null = null;
			let iconSpan: HTMLElement | null = null;

			if (hasVolumeHeader) {
				header = volumeGroup.createDiv('wn-corkboard-volume-header wn-clickable');
				iconSpan = header.createSpan({ cls: 'wn-volume-header-icon' });
				setIcon(iconSpan, 'chevron-down');
				header.createSpan({ text: `${group.volume} (${group.files.length})`, cls: 'wn-volume-header-title' });
			}

			const cardsContainer = options.groupVolumeCards
				? volumeGroup.createDiv('wn-corkboard-volume-cards')
				: container;
			const cards: HTMLElement[] = [];

			for (const file of group.files) {
				const card = ChapterCard.render(cardsContainer, file, app, plugin, foreshadowingMap.get(file.basename) || [], {
					draggable,
					onSaveStateChange,
					currentBookPath,
					maxLoreLines
				});
				cards.push(card);
			}

			if (header && iconSpan) {
				header.onclick = () => {
					const isCollapsed = header.hasClass('is-collapsed');
					if (isCollapsed) {
						header.removeClass('is-collapsed');
						setIcon(iconSpan, 'chevron-down');
						if (options.groupVolumeCards) {
							cardsContainer.removeClass('is-collapsed');
						} else {
							cards.forEach(card => card.removeClass(volumeCollapsedCardClass));
						}
					} else {
						header.addClass('is-collapsed');
						setIcon(iconSpan, 'chevron-right');
						if (options.groupVolumeCards) {
							cardsContainer.addClass('is-collapsed');
						} else {
							cards.forEach(card => card.addClass(volumeCollapsedCardClass));
						}
					}
				};
			}
		}
	}
}

