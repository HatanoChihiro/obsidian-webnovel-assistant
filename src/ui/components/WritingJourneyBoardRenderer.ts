import type { App } from 'obsidian';
import { TFile, setIcon } from 'obsidian';
import type { WritingJourneyEvent } from '../../types/writingJourney';
import type { WritingJourneyService } from '../../services/WritingJourneyService';
import { getCorkboardStatusText, getNovelStatusText } from '../../i18n/data-keys';
import { t } from '../../i18n';
import { openFileAndFocus, getLeafForFileNavigation } from '../../utils/leaf';
import {
	normalizeWorkbenchSearchText,
	tokenizeWorkbenchFilter,
	matchesWorkbenchFilter
} from '../../services/WorkbenchFilterIndex';

export interface WritingJourneyBoardPlugin {
	writingJourneyService: WritingJourneyService;
}

export interface WritingJourneyBoardOptions {
	app: App;
	plugin: WritingJourneyBoardPlugin;
	container: HTMLElement;
	currentBookPath: string;
	query: string;
	isDescending?: boolean;
}

interface EventDisplayInfo {
	typeText: string;
	typeClass: string;
	icon: string;
	titleText: string;
	detailText: string;
	chapterPath: string | null;
	isExplicitlyDeleted: boolean;
}

export class WritingJourneyBoardRenderer {
	public static async render(options: WritingJourneyBoardOptions): Promise<void> {
		const { app, plugin, container, currentBookPath, query, isDescending = true } = options;

		const boardContainer = container.createDiv('wn-writing-journey-board');

		if (!currentBookPath) {
			boardContainer.createDiv({
				cls: 'wn-corkboard-empty-msg',
				text: t('corkboard.please-open-file')
			});
			return;
		}

		const result = await plugin.writingJourneyService.getJourneyLog(currentBookPath);

		if (result.status === 'malformed') {
			const errorBox = boardContainer.createDiv('wn-writing-journey-malformed-box');
			const iconSpan = errorBox.createSpan('wn-writing-journey-malformed-icon');
			setIcon(iconSpan, 'alert-triangle');
			errorBox.createSpan({
				cls: 'wn-writing-journey-malformed-text',
				text: t('writing-journey.malformed-log')
			});
			return;
		}

		const rawEvents = result.log?.events || [];
		if (rawEvents.length === 0) {
			boardContainer.createDiv({
				cls: 'wn-corkboard-empty-msg',
				text: t('writing-journey.empty')
			});
			return;
		}

		// 排序：默认时间倒序（最新事件在最上方），可切换为时间正序（最早事件在最上方）
		const sortedEvents = this.sortEvents(rawEvents, isDescending);

		// 关键词与时间过滤
		const tokens = tokenizeWorkbenchFilter(query);
		const filteredEvents = tokens.length > 0
			? sortedEvents.filter((ev) => this.matchesTokens(ev, tokens))
			: sortedEvents;

		if (filteredEvents.length === 0) {
			boardContainer.createDiv({
				cls: 'wn-corkboard-empty-msg',
				text: t('corkboard.filter-no-results')
			});
			return;
		}

		// 直接渲染通栏事件列表（移除日期分组与分组标题）
		const listEl = boardContainer.createDiv('wn-writing-journey-list');

		for (const event of filteredEvents) {
			this.renderEventRow(listEl, event, app, currentBookPath, rawEvents);
		}
	}

	public static getEventDisplayInfo(event: WritingJourneyEvent): EventDisplayInfo {
		switch (event.type) {
			case 'work.created':
				return {
					typeText: t('writing-journey.type-work-created'),
					typeClass: 'mod-work-created',
					icon: 'book-plus',
					titleText: event.workTitle,
					detailText: '',
					chapterPath: null,
					isExplicitlyDeleted: false
				};
			case 'work.imported':
				return {
					typeText: t('writing-journey.type-work-imported'),
					typeClass: 'mod-work-imported',
					icon: 'upload',
					titleText: event.workTitle,
					detailText: event.chapterCount ? `(${event.chapterCount} ${t('common.chapters')})` : '',
					chapterPath: null,
					isExplicitlyDeleted: false
				};
			case 'tracking.started':
				return {
					typeText: t('writing-journey.type-tracking-started'),
					typeClass: 'mod-tracking-started',
					icon: 'play',
					titleText: t('writing-journey.desc-tracking-started'),
					detailText: '',
					chapterPath: null,
					isExplicitlyDeleted: false
				};
			case 'chapter.created':
				return {
					typeText: t('writing-journey.type-chapter-created'),
					typeClass: 'mod-chapter-created',
					icon: 'file-plus',
					titleText: event.chapterTitle,
					detailText: '',
					chapterPath: event.path,
					isExplicitlyDeleted: false
				};
			case 'chapter.renamed':
				return {
					typeText: t('writing-journey.type-chapter-renamed'),
					typeClass: 'mod-chapter-renamed',
					icon: 'file-edit',
					titleText: `${event.oldTitle} → ${event.newTitle}`,
					detailText: '',
					chapterPath: event.newPath,
					isExplicitlyDeleted: false
				};
			case 'chapter.moved':
				return {
					typeText: t('writing-journey.type-chapter-moved'),
					typeClass: 'mod-chapter-moved',
					icon: 'move',
					titleText: event.chapterTitle,
					detailText: `${event.oldPath} → ${event.newPath}`,
					chapterPath: event.newPath,
					isExplicitlyDeleted: false
				};
			case 'chapter.deleted':
				return {
					typeText: t('writing-journey.type-chapter-deleted'),
					typeClass: 'mod-chapter-deleted',
					icon: 'file-x',
					titleText: event.chapterTitle,
					detailText: '',
					chapterPath: event.path,
					isExplicitlyDeleted: true
				};
			case 'chapter.status_changed': {
				const statusText = `${getCorkboardStatusText(event.fromStatus)} → ${getCorkboardStatusText(event.toStatus)}`;
				const countText = typeof event.wordCount === 'number' && Number.isFinite(event.wordCount) && event.wordCount >= 0
					? ` (${event.wordCount.toLocaleString()} ${t('common.word-char')})`
					: '';
				return {
					typeText: t('writing-journey.type-chapter-status'),
					typeClass: 'mod-chapter-status',
					icon: 'tag',
					titleText: event.chapterTitle,
					detailText: `${statusText}${countText}`,
					chapterPath: event.path,
					isExplicitlyDeleted: false
				};
			}
			case 'work.status_changed':
				return {
					typeText: t('writing-journey.type-work-status'),
					typeClass: 'mod-work-status',
					icon: 'bookmark',
					titleText: `${getNovelStatusText(event.fromStatus)} → ${getNovelStatusText(event.toStatus)}`,
					detailText: '',
					chapterPath: null,
					isExplicitlyDeleted: false
				};
		}
	}

	public static formatTimestamp(timestamp: string): string {
		if (typeof window !== 'undefined' && window.moment) {
			const m = window.moment(timestamp);
			if (m.isValid()) {
				return m.format('YYYY-MM-DD HH:mm');
			}
		}
		const d = new Date(timestamp);
		if (isNaN(d.getTime())) {
			return timestamp;
		}
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		const hours = String(d.getHours()).padStart(2, '0');
		const minutes = String(d.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}`;
	}

	public static getTimeSearchHaystack(timestamp: string): string {
		const parts: string[] = [];
		const formatted = this.formatTimestamp(timestamp);
		parts.push(formatted);
		parts.push(timestamp);

		if (typeof window !== 'undefined' && window.moment) {
			const m = window.moment(timestamp);
			if (m.isValid()) {
				parts.push(
					m.format('YYYY-MM-DD'),
					m.format('HH:mm'),
					m.format('YYYY/MM/DD'),
					m.format('YYYY.MM.DD'),
					m.format('L'),
					m.format('LL'),
					m.format('LLL'),
					m.format('LT')
				);
			}
		} else {
			const d = new Date(timestamp);
			if (!isNaN(d.getTime())) {
				const year = d.getFullYear();
				const month = String(d.getMonth() + 1).padStart(2, '0');
				const day = String(d.getDate()).padStart(2, '0');
				const hours = String(d.getHours()).padStart(2, '0');
				const minutes = String(d.getMinutes()).padStart(2, '0');
				parts.push(
					`${year}-${month}-${day}`,
					`${hours}:${minutes}`,
					`${year}/${month}/${day}`,
					`${year}.${month}.${day}`,
					d.toLocaleDateString(),
					d.toLocaleTimeString(),
					d.toLocaleString()
				);
			}
		}

		return parts.join(' ');
	}

	public static matchesTokens(event: WritingJourneyEvent, tokens: readonly string[]): boolean {
		if (tokens.length === 0) return true;
		const info = this.getEventDisplayInfo(event);
		const timeHaystack = this.getTimeSearchHaystack(event.timestamp);
		const haystack = normalizeWorkbenchSearchText(
			`${info.typeText} ${info.titleText} ${info.detailText} ${info.chapterPath || ''} ${timeHaystack}`
		);
		return matchesWorkbenchFilter(haystack, tokens);
	}

	public static matchesQuery(event: WritingJourneyEvent, query: string): boolean {
		const tokens = tokenizeWorkbenchFilter(query);
		return this.matchesTokens(event, tokens);
	}

	public static sortEvents(events: WritingJourneyEvent[], isDescending: boolean = true): WritingJourneyEvent[] {
		const effectiveTimes = events.map((event, index) => {
			const pairedEvent = event.type === 'tracking.started' ? events[index + 1] : undefined;
			return new Date(pairedEvent?.timestamp ?? event.timestamp).getTime();
		});

		return events
			.map((event, index) => ({ event, index }))
			.sort((a, b) => {
				const timeDiff = isDescending
					? effectiveTimes[b.index] - effectiveTimes[a.index]
					: effectiveTimes[a.index] - effectiveTimes[b.index];
				if (timeDiff !== 0) return timeDiff;
				if (a.event.type === 'tracking.started' && a.index + 1 === b.index) {
					return isDescending ? 1 : -1;
				}
				if (b.event.type === 'tracking.started' && b.index + 1 === a.index) {
					return isDescending ? -1 : 1;
				}
				return a.index - b.index;
			})
			.map(({ event }) => event);
	}

	public static sortEventsNewestFirst(events: WritingJourneyEvent[]): WritingJourneyEvent[] {
		return this.sortEvents(events, true);
	}

	public static sortEventsOldestFirst(events: WritingJourneyEvent[]): WritingJourneyEvent[] {
		return this.sortEvents(events, false);
	}

	private static resolveLatestPath(initialPath: string, allEvents: WritingJourneyEvent[]): string {
		let currentPath = initialPath;
		// 顺着事件链查找后续的重命名记录
		for (const ev of allEvents) {
			if ((ev.type === 'chapter.renamed' || ev.type === 'chapter.moved') && ev.oldPath === currentPath) {
				currentPath = ev.newPath;
			}
		}
		return currentPath;
	}

	private static renderEventRow(
		container: HTMLElement,
		event: WritingJourneyEvent,
		app: App,
		currentBookPath: string,
		allEvents: WritingJourneyEvent[]
	): void {
		const info = this.getEventDisplayInfo(event);
		const row = container.createDiv('wn-writing-journey-item');

		// 1. 本地完整时间显示 (YYYY-MM-DD HH:mm)
		const timeEl = row.createDiv('wn-writing-journey-time');
		timeEl.setText(this.formatTimestamp(event.timestamp));

		// 2. 类型徽标 (含图标与本地化文本)
		const typeEl = row.createDiv(`wn-writing-journey-type ${info.typeClass}`);
		const typeIcon = typeEl.createSpan('wn-writing-journey-type-icon');
		setIcon(typeIcon, info.icon);
		typeEl.createSpan({ text: info.typeText });

		// 3. 内容详情
		const contentEl = row.createDiv('wn-writing-journey-content');
		const titleSpan = contentEl.createSpan('wn-writing-journey-title');
		titleSpan.setText(info.titleText);

		if (info.detailText) {
			const detailSpan = contentEl.createSpan('wn-writing-journey-detail');
			detailSpan.setText(info.detailText);
		}

		// 4. 章节存在性与打开交互
		if (info.chapterPath) {
			if (info.isExplicitlyDeleted) {
				row.addClass('is-deleted');
				contentEl.createSpan({
					cls: 'wn-writing-journey-deleted-tag',
					text: t('writing-journey.deleted')
				});
			} else {
				const latestPath = this.resolveLatestPath(info.chapterPath, allEvents);
				const file = app.vault.getAbstractFileByPath(latestPath);
				const isExtant = file instanceof TFile;

				if (isExtant) {
					row.addClass('wn-clickable');
					row.title = t('writing-journey.click-to-open');
					row.onclick = () => {
						const targetLeaf = getLeafForFileNavigation(app, file);
						void openFileAndFocus(app, targetLeaf, file);
					};
				} else {
					row.addClass('is-deleted');
					contentEl.createSpan({
						cls: 'wn-writing-journey-deleted-tag',
						text: t('writing-journey.deleted')
					});
				}
			}
		}
	}
}
