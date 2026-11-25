import { showPluginNotice } from '../../services/PluginNoticeService';
import type { App, Component, WorkspaceLeaf } from 'obsidian';
import { setIcon, setTooltip, TFile, Modal } from 'obsidian';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import {
	deepCloneEntry,
	deepClonePendingEvent,
	filterTimelineEntries,
	getTimelineEntryLocateCandidates,
	getTimelineNodeDisplayTime,
	parseTimelineChapterList,
	type PendingTimelineEvent,
	type TimelineEntry,
	type TimelineInsertAnchor,
	type TimelineItem,
	type TimelineManager
} from '../../services/TimelineManager';
import { CorkboardGridRenderer } from './CorkboardGridRenderer';
import { TimelineAddModal } from '../TimelineAddModal';
import { TimelineEditModal } from '../TimelineEditModal';
import { t } from '../../i18n';
import { Logger } from '../../utils/Logger';
import { smartLocateAndHighlight } from '../../utils/leaf';
import { ChapterSorter } from '../../services/ChapterSorter';
import { getDeterministicChapterDisplayOrder } from '../../utils/chapterDisplayOrder';
import type { TimelineFormContext, TimelineFormSettings } from './TimelineFormComponent';
import type { ChapterCardPlugin } from './ChapterCard';
import type { AccurateCountSettings } from '../../types/settings';
import { createCardImportanceButton } from './CardImportanceButton';
import { setupStickyNoteParagraphEditor, teardownStickyNoteParagraphEditor, getStickyNoteEditorContent, setStickyNoteEditorContent } from './StickyNoteParagraphEditor';
import { renderLoreBadges } from '../../utils/badge';
import { renderTrajectoryMode } from './TrajectoryBoardRenderer';

const DRAG_MIME_CHAPTER = 'application/wn-chapter-path';
const DRAG_MIME_EVENT_TIME = 'application/wn-timeline-event-time';
const DRAG_MIME_ENTRY_INDEX = 'application/wn-timeline-entry-index';
const DRAG_MIME_EVENT_INDEX = 'application/wn-timeline-event-index';
const DRAG_MIME_PENDING_ID = 'application/wn-timeline-pending-id';
const DRAG_MIME_NODE_INDEX = 'application/wn-timeline-node-index';

type TimelineDragKind = 'node' | 'pending' | 'event' | 'chapter' | null;

function getTimelineDragKind(dataTransfer: DataTransfer | null): TimelineDragKind {
	if (!dataTransfer?.types) return null;
	if (dataTransfer.types.includes(DRAG_MIME_NODE_INDEX)) return 'node';
	if (dataTransfer.types.includes(DRAG_MIME_PENDING_ID)) return 'pending';
	if (dataTransfer.types.includes(DRAG_MIME_ENTRY_INDEX) || dataTransfer.types.includes(DRAG_MIME_EVENT_TIME)) return 'event';
	if (dataTransfer.types.includes(DRAG_MIME_CHAPTER)) return 'chapter';
	return null;
}

class ConfirmDeleteEventModal extends Modal {
	constructor(app: App, private title: string, private onConfirm: () => void) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ text: this.title, cls: 'modal-title' });

		const btnContainer = contentEl.createDiv({ cls: 'wn-base-button-container' });
		
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('common.confirm'), cls: 'mod-warning' });
		confirmBtn.onclick = () => {
			this.onConfirm();
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}

function getPlaintextContent(el: HTMLElement): string {
	if (el.querySelector('.wn-sticky-note-editor-line')) {
		return getStickyNoteEditorContent(el);
	}
	const raw = (el.innerText !== undefined && el.innerText !== null) ? el.innerText : (el.textContent ?? '');
	return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function focusTimelineDescriptionEnd(editor: HTMLElement): void {
	editor.focus({ preventScroll: true });
	const doc = editor.ownerDocument;
	const selection = doc.defaultView?.getSelection();
	if (!selection) return;

	const range = doc.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

export type TimelineBoardTimelineManager = Pick<
	TimelineManager,
	| 'loadEntries'
	| 'getTimelineFile'
	| 'createTimelineFile'
	| 'syncChapterToEventItem'
	| 'moveEventItem'
	| 'deleteEntry'
	| 'updateEntry'
	| 'getTimelineFilePath'
	| 'findEntryHeadingOffset'
	| 'appendEntry'
> & Partial<Pick<
	TimelineManager,
	| 'loadDocument'
	| 'addPendingEvent'
	| 'updatePendingEvent'
	| 'deletePendingEvent'
	| 'placePendingEventIntoNode'
	| 'createNodeFromPendingEvent'
	| 'moveEventToPending'
	| 'moveEntry'
>>;

import type { CharacterManager } from '../../services/CharacterManager';

export type TimelineBoardCharacterManager = Pick<
	CharacterManager,
	| 'getCharacterFile'
	| 'findLoreFolder'
	| 'createLoreEntry'
	| 'getLoreContent'
	| 'updateLoreContent'
	| 'getCharactersForBook'
	| 'getLoreEntriesInFileOrder'
>;

export type TimelineBoardSettings = TimelineFormSettings &
	Pick<AccurateCountSettings, 'enableLorePopover' | 'enableMobileLorePopover' | 'lorePopoverCollapse' | 'enableSmartChapterSort' | 'customSortOrder'>;

export interface TimelineBoardPlugin
	extends Omit<TimelineFormContext, 'settings' | 'characterManager'>,
		Omit<ChapterCardPlugin, 'settings' | 'characterManager'> {
	settings: TimelineBoardSettings;
	timelineManager: TimelineBoardTimelineManager;
	characterManager: TimelineBoardCharacterManager;
}

export interface TimelineBoardOptions {
	app: App;
	plugin: TimelineBoardPlugin;
	ownerComponent?: Component;
	sourceLeaf?: WorkspaceLeaf;
	container: HTMLElement;
	files: TFile[];
	foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>;
	currentBookPath: string;
	loadedEntries?: TimelineEntry[] | null;
	loadedPendingEvents?: PendingTimelineEvent[];
	currentTimelineFilter?: readonly string[];
	currentTimelineLoreFilter?: readonly string[] | Set<string>;
	onSaveStateChange: (isSaving: boolean) => void;
	reloadBoard: () => void;
	getChapterEvents: (file: TFile, fallbackMap: Map<string, string[]>) => string[];
	isDescending?: boolean;
	isUnscheduledDescending?: boolean;
	onToggleUnscheduledSort?: () => void;
	isSidebarCollapsed?: boolean;
	onToggleSidebarCollapse?: () => void;
	pendingInputDraft?: string;
	onPendingInputDraftChange?: (draft: string) => void;
	onRequestPendingInputFocus?: () => void;
	isTrajectoryMode?: boolean;
}

export class TimelineBoardRenderer {
	static async render(options: TimelineBoardOptions): Promise<void> {
		const {
			app,
			plugin,
			container,
			files,
			foreshadowingMap,
			currentBookPath,
			currentTimelineFilter = [],
			currentTimelineLoreFilter,
			onSaveStateChange,
			reloadBoard,
			getChapterEvents,
			isDescending = false,
			isUnscheduledDescending,
			onToggleUnscheduledSort,
			isSidebarCollapsed,
			onToggleSidebarCollapse,
			pendingInputDraft = '',
			onPendingInputDraftChange,
			onRequestPendingInputFocus,
			isTrajectoryMode
		} = options;

		const tStart = performance.now();
		const timelineManager = plugin.timelineManager;
		const bookFolder = currentBookPath === '/' ? '' : (currentBookPath || '');
		let entries: TimelineEntry[] | null;
		let pendingEvents: PendingTimelineEvent[] = options.loadedPendingEvents ? options.loadedPendingEvents.map(deepClonePendingEvent) : [];
		if (options.loadedEntries !== undefined) {
			entries = options.loadedEntries;
		} else if (typeof timelineManager.loadDocument === 'function') {
			const loadedDoc = await timelineManager.loadDocument(bookFolder);
			entries = loadedDoc ? loadedDoc.entries : null;
			if (options.loadedPendingEvents === undefined) {
				pendingEvents = loadedDoc ? loadedDoc.pendingEvents : [];
			}
		} else {
			entries = await timelineManager.loadEntries(bookFolder);
		}
		const tEntries = performance.now();
		Logger.info(`[Perf Phase] Timeline.loadEntries: ${(tEntries - tStart).toFixed(2)}ms`);

		const allEntries = entries ? [...entries] : [];

		if (entries) {
			entries = filterTimelineEntries(entries, currentTimelineFilter, currentTimelineLoreFilter);
		}

		const displayEntries = (entries && isDescending) ? [...entries].reverse() : (entries ? [...entries] : []);
		const entryIndexByEntry = new Map<TimelineEntry, number>(
			allEntries.map((entry, index) => [entry, index])
		);

		const timelineFile = timelineManager.getTimelineFile(bookFolder);
		const timelineSource = timelineFile ? { file: timelineFile, path: timelineFile.path } : undefined;
		const chapterIndex = ChapterSorter.createReferenceIndex(
			app,
			plugin,
			bookFolder,
			{ eligibleChapters: files, sourcePath: timelineFile?.path }
		);

		const resolveLinkToFile = (link: string): TFile | null => {
			return chapterIndex.resolve(link);
		};

		const openTimelineEntry = async (entry: TimelineEntry, entryIndex: number): Promise<void> => {
			if (!timelineFile) {
				showPluginNotice(t('common.file-not-found', { name: t('common.default-timeline-filename') }));
				return;
			}
			const content = await app.vault.cachedRead(timelineFile);
			const matchStartGlobal = timelineManager.findEntryHeadingOffset(content, entryIndex, bookFolder);
			const fallbackLine = matchStartGlobal === undefined ? undefined : content.slice(0, matchStartGlobal).split('\n').length - 1;
			await smartLocateAndHighlight(
				app,
				timelineFile,
				getTimelineEntryLocateCandidates(entry),
				{ splitIfNew: true, fallbackLine, matchStartGlobal }
			);
		};

		if (isTrajectoryMode) {
			renderTrajectoryMode({
				ownerComponent: options.ownerComponent,
				sourceLeaf: options.sourceLeaf,
				currentBookPath: options.currentBookPath,
				app,
				container,
				displayEntries,
				allTypes: [...new Set([
					...(plugin.settings.timeline?.defaultTypes || []),
					...allEntries.map(entry => entry.type || t('trajectory.main-type'))
				])],
				resolveLinkToFile,
				allEntries,
				onUpdateEntry: async (index: number, entry: TimelineEntry, expectedEntry?: TimelineEntry) => {
					await timelineManager.updateEntry(index, entry, bookFolder, expectedEntry);
				},
				onOpenEntry: openTimelineEntry,
				onSaveStateChange,
				reloadBoard,
				typeFilter: currentTimelineFilter
			});
			const tTraj = performance.now();
			Logger.info(`[Perf Phase] Timeline.trajectoryMode: ${(tTraj - tEntries).toFixed(2)}ms`);
			return;
		}

		const displayPositionByEntryIndex = new Map<number, number>();
		displayEntries.forEach((entry, position) => {
			const entryIndex = entryIndexByEntry.get(entry);
			if (entryIndex !== undefined) displayPositionByEntryIndex.set(entryIndex, position);
		});
		type TimelineEventRef = { time: string; itemIndex: number; entryIndex: number };
		const eventKey = (event: TimelineEventRef) => `${event.entryIndex}|${event.itemIndex}`;

		// Find chapters mapped to each event -> itemIndex. Keys are file.path.
		const chapterToEventMap = new Map<string, TimelineEventRef[]>();

		for (const entry of displayEntries) {
			const entryIndex = entryIndexByEntry.get(entry);
			if (entryIndex === undefined) continue;
			if (entry.items && entry.items.length > 0) {
					for (let i = 0; i < entry.items.length; i++) {
						const item = entry.items[i];
						const chaps = parseTimelineChapterList(item.chapter);
						for (const c of chaps) {
							const matchedFile = resolveLinkToFile(c);
							const mapKey = matchedFile ? matchedFile.path : c;
							if (!chapterToEventMap.has(mapKey)) {
								chapterToEventMap.set(mapKey, []);
							}
							const list = chapterToEventMap.get(mapKey)!;
							if (!list.find(m => m.entryIndex === entryIndex && m.itemIndex === i)) {
								list.push({ time: entry.time, itemIndex: i, entryIndex });
							}
						}
					}
				} else if (entry.chapter) {
					const chaps = parseTimelineChapterList(entry.chapter);
					for (const c of chaps) {
						const matchedFile = resolveLinkToFile(c);
						const mapKey = matchedFile ? matchedFile.path : c;
						if (!chapterToEventMap.has(mapKey)) {
							chapterToEventMap.set(mapKey, []);
						}
						const list = chapterToEventMap.get(mapKey)!;
						if (!list.find(m => m.entryIndex === entryIndex && m.itemIndex === 0)) {
							list.push({ time: entry.time, itemIndex: 0, entryIndex });
						}
					}
				}
		}

		const tLinkResolve = performance.now();
		Logger.info(`[Perf Phase] Timeline.linkResolution: ${(tLinkResolve - tEntries).toFixed(2)}ms`);

		// Waterfall Layout
		const waterfallLayout = container.createDiv('wn-timeline-waterfall-layout');
		const mainCol = waterfallLayout.createDiv('wn-timeline-waterfall-main');
		const sideCol = waterfallLayout.createDiv('wn-timeline-waterfall-sidebar');

		const boardDoc = waterfallLayout.ownerDocument;
		const boardWin = boardDoc.defaultView || window;
		const canSortNodes = typeof timelineManager.moveEntry === 'function' && displayEntries.length > 0;
		let activeDraggingNodeEl: HTMLElement | null = null;
		let activeNodeDragIndex: number | null = null;
		let nodeSortScrollTop: number | null = null;
		let activeNodeDropTarget: HTMLElement | null = null;
		let activeNodeDropClass: string | null = null;
		let nodeHoldTimer: number | null = null;
		let nodeHoldCleanup: (() => void) | null = null;
		let nodeDragKeyCleanup: (() => void) | null = null;

		const clearNodeDropIndicator = (): void => {
			if (activeNodeDropTarget && activeNodeDropClass) {
				activeNodeDropTarget.removeClass(activeNodeDropClass);
			}
			activeNodeDropTarget = null;
			activeNodeDropClass = null;
		};

		const setNodeDropIndicator = (targetEl: HTMLElement, cls: string): void => {
			if (activeNodeDropTarget === targetEl && activeNodeDropClass === cls) return;
			clearNodeDropIndicator();
			activeNodeDropTarget = targetEl;
			activeNodeDropClass = cls;
			targetEl.addClass(cls);
		};

		const clearNodeHoldState = (): void => {
			if (nodeHoldTimer !== null) {
				boardWin.clearTimeout(nodeHoldTimer);
				nodeHoldTimer = null;
			}
			if (nodeHoldCleanup) {
				nodeHoldCleanup();
				nodeHoldCleanup = null;
			}
		};

		const exitNodeSortMode = (): void => {
			clearNodeHoldState();
			activeNodeDragIndex = null;
			if (nodeDragKeyCleanup) {
				nodeDragKeyCleanup();
				nodeDragKeyCleanup = null;
			}
			clearNodeDropIndicator();
			waterfallLayout.removeClass('is-node-sorting');
			if (nodeSortScrollTop !== null) {
				mainCol.setCssProps({ '--wn-timeline-node-sort-buffer': '' });
				mainCol.scrollTop = nodeSortScrollTop;
				nodeSortScrollTop = null;
			}
			if (activeDraggingNodeEl) {
				activeDraggingNodeEl.removeClass('is-node-dragging');
				activeDraggingNodeEl = null;
			}
		};

		const observeNodeSortCancellation = (): void => {
			if (nodeDragKeyCleanup) return;

			const onEscape = (event: KeyboardEvent) => {
				if (event.key === 'Escape') exitNodeSortMode();
			};
			boardDoc.addEventListener('keydown', onEscape);
			boardWin.addEventListener?.('blur', exitNodeSortMode);
			nodeDragKeyCleanup = () => {
				boardDoc.removeEventListener('keydown', onEscape);
				boardWin.removeEventListener?.('blur', exitNodeSortMode);
			};
		};

		const enterNodeSortMode = (nodeEl: HTMLElement, handleEl: HTMLElement): void => {
			if (nodeSortScrollTop === null) {
				const handleTop = handleEl.getBoundingClientRect().top;
				nodeSortScrollTop = mainCol.scrollTop;
				// Reserve space on both ends so the collapsed list can scroll to the pressed dot.
				mainCol.setCssProps({ '--wn-timeline-node-sort-buffer': mainCol.clientHeight + 'px' });
				waterfallLayout.addClass('is-node-sorting');
				mainCol.scrollTop += handleEl.getBoundingClientRect().top - handleTop;
			}
			if (activeDraggingNodeEl && activeDraggingNodeEl !== nodeEl) {
				activeDraggingNodeEl.removeClass('is-node-dragging');
			}
			activeDraggingNodeEl = nodeEl;
			nodeEl.addClass('is-node-dragging');
			observeNodeSortCancellation();
		};

		if (options.ownerComponent) {
			options.ownerComponent.register(exitNodeSortMode);
		}

		const handleMoveNodeDrop = async (
			sourceEntryIndex: number,
			targetEntryIndex: number,
			position: 'before' | 'after'
		): Promise<void> => {
			if (typeof timelineManager.moveEntry !== 'function') return;
			if (!Number.isInteger(sourceEntryIndex) || sourceEntryIndex < 0 || sourceEntryIndex >= allEntries.length) return;
			if (!Number.isInteger(targetEntryIndex) || targetEntryIndex < 0 || targetEntryIndex >= allEntries.length) return;

			const sourcePosition = displayPositionByEntryIndex.get(sourceEntryIndex);
			const targetPosition = displayPositionByEntryIndex.get(targetEntryIndex);
			if (sourcePosition === undefined || targetPosition === undefined) return;
			const visibleInsertAt = targetPosition + (position === 'after' ? 1 : 0);
			if (visibleInsertAt === sourcePosition || visibleInsertAt === sourcePosition + 1) return;

			const insertAt = !isDescending
				? (position === 'before' ? targetEntryIndex : targetEntryIndex + 1)
				: (position === 'before' ? targetEntryIndex + 1 : targetEntryIndex);
			if (insertAt === sourceEntryIndex || insertAt === sourceEntryIndex + 1) {
				return;
			}

			const finalIndex = insertAt > sourceEntryIndex ? insertAt - 1 : insertAt;
			if (finalIndex < 0 || finalIndex >= allEntries.length || finalIndex === sourceEntryIndex) {
				return;
			}

			if (pendingInlineSaves.size > 0) {
				const inlineSaveOk = await awaitPendingInlineSaves();
				if (!inlineSaveOk) {
					return;
				}
			}

			const sourceEntry = allEntries[sourceEntryIndex];
			const targetEntry = allEntries[finalIndex];
			if (!sourceEntry || !targetEntry) return;

			const expectedFromEntry = deepCloneEntry(sourceEntry);
			const expectedTargetEntry = deepCloneEntry(targetEntry);
			onSaveStateChange(true);
			let succeeded = false;
			try {
				const content = await timelineManager.moveEntry(
					sourceEntryIndex,
					finalIndex,
					bookFolder,
					expectedFromEntry,
					expectedTargetEntry
				);
				succeeded = Boolean(content);
			} catch (err) {
				Logger.error('[TimelineBoard] moveEntry 失败:', err);
			} finally {
				onSaveStateChange(false);
				if (succeeded) {
					reloadBoard();
				}
			}
		};

		const setupNodeDropzone = (el: HTMLElement, targetEntryIndex: number, atGap?: 'before' | 'after'): void => {
			let dragCounter = 0;
			const isLocalNodeDrag = (event: DragEvent) =>
				activeNodeDragIndex !== null && getTimelineDragKind(event.dataTransfer) === 'node';
			const getPosition = (event: DragEvent): 'before' | 'after' => {
				if (atGap) return atGap;
				const rect = el.getBoundingClientRect();
				return event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
			};

			el.addEventListener('dragenter', (event) => {
				if (!isLocalNodeDrag(event)) return;
				event.preventDefault();
				dragCounter++;
			});
			el.addEventListener('dragover', (event) => {
				if (!isLocalNodeDrag(event)) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
				const isAfter = getPosition(event) === 'after';
				setNodeDropIndicator(el, atGap ? 'drag-over-node' : (isAfter ? 'drag-over-node-bottom' : 'drag-over-node-top'));
			});
			el.addEventListener('dragleave', (event) => {
				if (getTimelineDragKind(event.dataTransfer) !== 'node') return;
				dragCounter = Math.max(0, dragCounter - 1);
				if (dragCounter === 0 && activeNodeDropTarget === el) clearNodeDropIndicator();
			});
			el.addEventListener('drop', (event) => {
				const sourceIndex = activeNodeDragIndex;
				if (sourceIndex === null || !isLocalNodeDrag(event)) return;
				dragCounter = 0;
				event.preventDefault();
				event.stopPropagation();
				const position = getPosition(event);
				const rawSource = event.dataTransfer?.getData(DRAG_MIME_NODE_INDEX);
				exitNodeSortMode();
				if (rawSource !== String(sourceIndex)) return;
				void handleMoveNodeDrop(sourceIndex, targetEntryIndex, position);
			});
		};

		const setupNodeHandle = (handleEl: HTMLElement, nodeEl: HTMLElement, entryIndex: number): void => {
			handleEl.setAttribute('draggable', 'true');
			handleEl.setAttribute('aria-label', t('timeline.drag-to-reorder-node'));
			handleEl.addEventListener('click', (e) => e.stopPropagation());
			handleEl.addEventListener('mousedown', (e: MouseEvent) => {
				if (e.button !== 0) return;
				e.stopPropagation();
				exitNodeSortMode();
				observeNodeSortCancellation();
				const startX = e.clientX;
				const startY = e.clientY;
				nodeHoldTimer = boardWin.setTimeout(() => {
					nodeHoldTimer = null;
					if (!waterfallLayout.isConnected) {
						exitNodeSortMode();
						return;
					}
					enterNodeSortMode(nodeEl, handleEl);
				}, 220);

				if (typeof boardDoc.addEventListener === 'function') {
					const onMouseMove = (ev: MouseEvent) => {
						if (nodeHoldTimer !== null) {
							if (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6) {
								exitNodeSortMode();
							}
						}
					};
					const onMouseUp = () => {
						exitNodeSortMode();
					};
					boardDoc.addEventListener('mousemove', onMouseMove);
					boardDoc.addEventListener('mouseup', onMouseUp);
					nodeHoldCleanup = () => {
						boardDoc.removeEventListener?.('mousemove', onMouseMove);
						boardDoc.removeEventListener?.('mouseup', onMouseUp);
					};
				}
			});
			handleEl.addEventListener('dragstart', (e: DragEvent) => {
				e.stopPropagation();
				clearNodeHoldState();
				if (!waterfallLayout.isConnected) {
					exitNodeSortMode();
					return;
				}
				if (!e.dataTransfer) return;
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData(DRAG_MIME_NODE_INDEX, String(entryIndex));
				activeNodeDragIndex = entryIndex;
				enterNodeSortMode(nodeEl, handleEl);
			});
			handleEl.addEventListener('dragend', () => {
				exitNodeSortMode();
			});
		};

		// Track in-flight inline editor saves for this rendered board to preserve interaction ordering
		const pendingInlineSaves = new Set<Promise<boolean>>();
		let isEditModalLaunching = false;
		let activeInlineNodeForm: HTMLElement | null = null;
		const typeOptions = [...new Set([
			...(plugin.settings.timeline?.defaultTypes || []),
			...allEntries.map(e => e.type).filter((type): type is string => Boolean(type))
		])];

		const registerPendingInlineSave = (promise: Promise<boolean>): void => {
			pendingInlineSaves.add(promise);
			void promise.finally(() => {
				pendingInlineSaves.delete(promise);
			});
		};

		const awaitPendingInlineSaves = async (): Promise<boolean> => {
			let allOk = true;
			while (pendingInlineSaves.size > 0) {
				const batch = Array.from(pendingInlineSaves);
				const results = await Promise.all(batch);
				if (results.some(res => !res)) {
					allOk = false;
				}
			}
			return allOk;
		};

		const findPendingById = (pendingId: string): PendingTimelineEvent | undefined => {
			return pendingEvents.find(ev => ev.id === pendingId);
		};

		const handlePlacePendingIntoNode = async (
			pendingId: string,
			targetEntryIndex: number,
			targetItemIndex?: number
		): Promise<void> => {
			if (typeof timelineManager.placePendingEventIntoNode !== 'function') return;
			const pendingEvent = findPendingById(pendingId);
			const targetEntry = allEntries[targetEntryIndex];
			if (!pendingEvent || !targetEntry) return;
			if (pendingInlineSaves.size > 0) {
				const inlineSaveOk = await awaitPendingInlineSaves();
				if (!inlineSaveOk) return;
			}
			onSaveStateChange(true);
			let succeeded = false;
			try {
				await timelineManager.placePendingEventIntoNode(
					pendingId,
					targetEntryIndex,
					targetItemIndex,
					bookFolder,
					deepClonePendingEvent(pendingEvent),
					deepCloneEntry(targetEntry)
				);
				succeeded = true;
			} catch (err) {
				if (err instanceof Error && err.message === t('timeline.pending-empty-error')) showPluginNotice(err.message);
				Logger.error('[TimelineBoard] placePendingEventIntoNode 失败:', err);
			} finally {
				onSaveStateChange(false);
				if (succeeded) {
					reloadBoard();
				}
			}
		};

		const handleReturnEventToPending = async (
			sourceEntryIndex: number,
			sourceItemIndex: number
		): Promise<void> => {
			if (typeof timelineManager.moveEventToPending !== 'function') return;
			const sourceEntry = allEntries[sourceEntryIndex];
			const sourceItems = sourceEntry?.items?.length
				? sourceEntry.items
				: (sourceEntry && (sourceEntry.description || sourceEntry.chapter || sourceEntry.origin || sourceEntry.important)
					? [{ description: sourceEntry.description, chapter: sourceEntry.chapter, origin: sourceEntry.origin, important: sourceEntry.important }]
					: []);
			if (!sourceEntry || !sourceItems[sourceItemIndex]) return;

			if (pendingInlineSaves.size > 0) {
				const inlineSaveOk = await awaitPendingInlineSaves();
				if (!inlineSaveOk) return;
			}
			const expectedItem = sourceEntry.items?.[sourceItemIndex] ?? sourceItems[sourceItemIndex];
			if (!expectedItem) return;
			onSaveStateChange(true);
			let succeeded = false;
			try {
				await timelineManager.moveEventToPending(
					sourceEntryIndex,
					sourceItemIndex,
					bookFolder,
					{ ...expectedItem },
					deepCloneEntry(sourceEntry)
				);
				succeeded = true;
			} catch (err) {
				Logger.error('[TimelineBoard] moveEventToPending 失败:', err);
			} finally {
				onSaveStateChange(false);
				if (succeeded) {
					reloadBoard();
				}
			}
		};

		const openInlineNewNodeForm = (
			slotEl: HTMLElement,
			pendingEvent: PendingTimelineEvent,
			anchor: TimelineInsertAnchor
		): void => {
			if (activeInlineNodeForm) {
				activeInlineNodeForm.remove();
				activeInlineNodeForm = null;
			}

			const form = slotEl.createDiv({ cls: 'wn-timeline-inline-node-form' });
			activeInlineNodeForm = form;

			const previewRow = form.createDiv({ cls: 'wn-timeline-inline-node-preview' });
			previewRow.createSpan({ cls: 'wn-timeline-inline-node-preview-label', text: t('timeline.inline-create-node-title') });
			const previewText = pendingEvent.description.trim() || pendingEvent.chapter || t('trajectory.no-description');
			previewRow.createSpan({ cls: 'wn-timeline-inline-node-preview-text', text: previewText });

			const fieldsRow = form.createDiv({ cls: 'wn-timeline-inline-node-fields' });
			const timeInput = fieldsRow.createEl('input', {
				type: 'text',
				cls: 'wn-timeline-form-input wn-timeline-inline-time-input'
			});
			timeInput.placeholder = t('modal.time-point-desc');
			timeInput.setAttr('aria-label', t('modal.time-point'));

			const pendingLabel = fieldsRow.createEl('label', { cls: 'wn-timeline-time-pending-label' });
			const pendingCheckbox = pendingLabel.createEl('input', {
				type: 'checkbox',
				cls: 'wn-timeline-time-pending-checkbox'
			});
			pendingCheckbox.checked = false;
			pendingLabel.createSpan({ text: t('timeline.time-pending') });

			const typeSelect = fieldsRow.createEl('select', {
				cls: 'wn-timeline-form-input wn-timeline-inline-type-select'
			});
			typeSelect.setAttr('aria-label', t('modal.type-optional'));
			typeSelect.createEl('option', { value: '', text: t('modal.no-type') });
			for (const typeOption of typeOptions) {
				typeSelect.createEl('option', { value: typeOption, text: typeOption });
			}

			const actionsRow = form.createDiv({ cls: 'wn-timeline-inline-node-actions' });
			const cancelBtn = actionsRow.createEl('button', {
				type: 'button',
				cls: 'wn-timeline-action-btn wn-timeline-inline-cancel-btn',
				text: t('common.cancel')
			});
			const confirmBtn = actionsRow.createEl('button', {
				type: 'button',
				cls: 'wn-timeline-action-btn mod-cta wn-timeline-inline-confirm-btn',
				text: t('common.confirm')
			});

			let isSaving = false;
			let isComposing = false;

			const closeForm = () => {
				if (isSaving) return;
				form.remove();
				if (activeInlineNodeForm === form) {
					activeInlineNodeForm = null;
				}
			};

			const syncCheckbox = () => {
				const isPending = Boolean(pendingCheckbox.checked);
				timeInput.disabled = isPending;
				if (isPending) {
					timeInput.addClass('is-disabled');
				} else {
					timeInput.removeClass('is-disabled');
				}
				if (!isPending) {
					timeInput.focus();
				}
			};
			pendingCheckbox.addEventListener('change', syncCheckbox);

			const submitForm = () => {
				if (isSaving) return;
				if (typeof timelineManager.createNodeFromPendingEvent !== 'function') return;
				const isTimePending = Boolean(pendingCheckbox.checked);
				const time = isTimePending ? '' : timeInput.value.trim();
				if (!isTimePending && !time) {
					showPluginNotice(t('modal.please-fill-time-point'));
					timeInput.focus();
					return;
				}

				void (async () => {
					if (pendingInlineSaves.size > 0) {
						const inlineSaveOk = await awaitPendingInlineSaves();
						if (!inlineSaveOk) return;
					}
					isSaving = true;
					confirmBtn.disabled = true;
					cancelBtn.disabled = true;
					onSaveStateChange(true);
					let succeeded = false;
					try {
						await timelineManager.createNodeFromPendingEvent!(
							pendingEvent.id,
							{ time, timePending: isTimePending, type: typeSelect.value || undefined },
							anchor,
							bookFolder,
							deepClonePendingEvent(pendingEvent)
						);
						succeeded = true;
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						if (!msg.includes(t('timeline.conflict-notice')) && !msg.includes(t('modal.please-fill-time-point'))) {
							showPluginNotice(t('modal.save-failed', { error: msg }));
						}
						Logger.error('[TimelineBoard] createNodeFromPendingEvent 失败:', err);
					} finally {
						isSaving = false;
						confirmBtn.disabled = false;
						cancelBtn.disabled = false;
						onSaveStateChange(false);
						if (succeeded) {
							closeForm();
							reloadBoard();
						}
					}
				})();
			};

			cancelBtn.onclick = (e: MouseEvent) => {
				e.stopPropagation();
				closeForm();
			};
			confirmBtn.onclick = (e: MouseEvent) => {
				e.stopPropagation();
				submitForm();
			};

			timeInput.addEventListener('compositionstart', () => { isComposing = true; });
			timeInput.addEventListener('compositionend', () => { isComposing = false; });
			timeInput.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					if (isComposing || e.isComposing || (e as { keyCode?: number }).keyCode === 229) return;
					e.preventDefault();
					e.stopPropagation();
					submitForm();
				}
			});

			form.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					closeForm();
				}
			});

			form.addEventListener('click', (e: MouseEvent) => e.stopPropagation());
			timeInput.focus();
		};

		// Handle drag and drop logic
		const handleDrop = async (e: DragEvent, targetEvents: { time: string, entryIndex: number, itemIndex?: number }[]) => {
			e.preventDefault();
			e.stopPropagation();
			const path = e.dataTransfer?.getData(DRAG_MIME_CHAPTER) || e.dataTransfer?.getData('text/plain');
			if (!path) return;
			const targetFile = app.vault.getAbstractFileByPath(path);
			if (targetFile instanceof TFile) {
				if (pendingInlineSaves.size > 0) {
					const inlineSaveOk = await awaitPendingInlineSaves();
					if (!inlineSaveOk) {
						return;
					}
				}
				onSaveStateChange(true);
				try {
					const enrichedTargetEvents = targetEvents.map(target => {
						const ent = allEntries[target.entryIndex];
						const expectedEntry: TimelineEntry | undefined = ent ? deepCloneEntry(ent) : undefined;
						return {
							...target,
							expectedEntry
						};
					});
					await timelineManager.syncChapterToEventItem(targetFile, enrichedTargetEvents, bookFolder);
				} catch (err) {
					Logger.error('[TimelineBoard] syncChapterToEventItem 失败:', err);
				} finally {
					onSaveStateChange(false);
					reloadBoard();
				}
			}
		};

		const setupPendingSlotDropzone = (el: HTMLElement, anchor: TimelineInsertAnchor) => {
			let dragCounter = 0;
			el.addEventListener('dragenter', (e) => {
				if (getTimelineDragKind(e.dataTransfer) !== 'pending') return;
				e.preventDefault();
				dragCounter++;
			});
			el.addEventListener('dragover', (e) => {
				if (getTimelineDragKind(e.dataTransfer) !== 'pending') return;
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				el.addClass('drag-over-event');
			});
			el.addEventListener('dragleave', (e) => {
				if (getTimelineDragKind(e.dataTransfer) !== 'pending') return;
				dragCounter--;
				if (dragCounter <= 0) {
					dragCounter = 0;
					el.removeClass('drag-over-event');
				}
			});
			el.addEventListener('drop', (e) => {
				if (getTimelineDragKind(e.dataTransfer) !== 'pending') return;
				dragCounter = 0;
				el.removeClass('drag-over-event');
				e.preventDefault();
				e.stopPropagation();
				const pendingId = e.dataTransfer?.getData(DRAG_MIME_PENDING_ID);
				if (!pendingId) return;
				const pendingEvent = findPendingById(pendingId);
				if (!pendingEvent) return;
				openInlineNewNodeForm(el, pendingEvent, anchor);
			});
		};

		interface DropzoneConfig {
			pendingInsertAnchor?: TimelineInsertAnchor;
			pendingInsertTarget?: { entryIndex: number; itemIndex?: number };
			acceptScheduledEventToPending?: boolean;
			allowChapterDrop?: boolean;
		}

		const setupDropzone = (
			el: HTMLElement,
			targetEvents: { time: string, entryIndex: number, itemIndex?: number }[],
			config: DropzoneConfig = {}
		) => {
			let dragCounter = 0;
			let isInsertAfter = false;
			const isBetweenNodeGap = el.hasClass('wn-timeline-gap') && !el.hasClass('wn-timeline-sub-gap');
			const allowChapterDrop = config.allowChapterDrop !== false;

			const canAcceptDragKind = (kind: TimelineDragKind): boolean => {
				if (kind === 'node') {
					return false;
				}
				if (kind === 'pending') {
					return Boolean(config.pendingInsertAnchor || config.pendingInsertTarget || el.hasClass('wn-timeline-item-row'));
				}
				if (kind === 'event') {
					if (config.acceptScheduledEventToPending) return true;
					if (isBetweenNodeGap) return false;
					return targetEvents.length > 0 || Boolean(config.pendingInsertTarget);
				}
				if (kind === 'chapter') {
					return allowChapterDrop;
				}
				return allowChapterDrop;
			};

			const clearDragClasses = () => {
				el.removeClass('drag-over-event');
				el.removeClass('drag-over-event-top');
				el.removeClass('drag-over-event-bottom');
				el.removeClass('drag-over-chapter');
				el.removeClass('drag-over');
			};

			el.addEventListener('dragenter', (e) => {
				const kind = getTimelineDragKind(e.dataTransfer);
				if (!canAcceptDragKind(kind)) return;
				e.preventDefault();
				dragCounter++;
			});
			el.addEventListener('dragover', (e) => {
				const kind = getTimelineDragKind(e.dataTransfer);
				if (!canAcceptDragKind(kind)) return;
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

				if (kind === 'event' || kind === 'pending') {
					if (el.hasClass('wn-timeline-item-row')) {
						const rect = el.getBoundingClientRect();
						const midY = rect.top + rect.height / 2;
						isInsertAfter = e.clientY >= midY;
						if (isInsertAfter) {
							el.removeClass('drag-over-event-top');
							el.addClass('drag-over-event-bottom');
						} else {
							el.removeClass('drag-over-event-bottom');
							el.addClass('drag-over-event-top');
						}
					} else {
						el.addClass('drag-over-event');
					}
				} else if (kind === 'chapter') {
					el.addClass('drag-over-chapter');
				} else {
					el.addClass('drag-over');
				}
			});
			el.addEventListener('dragleave', (e) => {
				const kind = getTimelineDragKind(e.dataTransfer);
				if (!canAcceptDragKind(kind)) return;
				dragCounter--;
				if (dragCounter <= 0) {
					dragCounter = 0;
					clearDragClasses();
				}
			});

			el.addEventListener('drop', (e) => {
				const kind = getTimelineDragKind(e.dataTransfer);
				if (!canAcceptDragKind(kind)) return;
				dragCounter = 0;
				clearDragClasses();

				if (kind === 'pending') {
					e.preventDefault();
					e.stopPropagation();
					const pendingId = e.dataTransfer?.getData(DRAG_MIME_PENDING_ID);
					if (!pendingId) return;
					if (config.pendingInsertAnchor) {
						const pendingEvent = findPendingById(pendingId);
						if (!pendingEvent) return;
						openInlineNewNodeForm(el, pendingEvent, config.pendingInsertAnchor);
						return;
					}
					if (config.pendingInsertTarget) {
						void handlePlacePendingIntoNode(
							pendingId,
							config.pendingInsertTarget.entryIndex,
							config.pendingInsertTarget.itemIndex
						);
						return;
					}
					if (el.hasClass('wn-timeline-item-row') && targetEvents.length > 0) {
						let targetIdx = targetEvents[0].itemIndex ?? 0;
						if (isInsertAfter) targetIdx += 1;
						void handlePlacePendingIntoNode(pendingId, targetEvents[0].entryIndex, targetIdx);
					}
					return;
				}

				if (kind === 'event') {
					const sourceEntryIndex = Number(e.dataTransfer?.getData(DRAG_MIME_ENTRY_INDEX));
					const sourceIdxStr = e.dataTransfer?.getData(DRAG_MIME_EVENT_INDEX);
					if (Number.isInteger(sourceEntryIndex) && sourceEntryIndex >= 0 && sourceIdxStr) {
						e.preventDefault();
						e.stopPropagation();
						const sourceIdx = parseInt(sourceIdxStr, 10);

						if (config.acceptScheduledEventToPending) {
							void handleReturnEventToPending(sourceEntryIndex, sourceIdx);
							return;
						}

						const targetEntryIdx = config.pendingInsertTarget?.entryIndex ?? targetEvents[0]?.entryIndex;
						if (targetEntryIdx === undefined) return;
						let targetIdx = config.pendingInsertTarget?.itemIndex ?? (targetEvents[0]?.itemIndex ?? 0);
						if (el.hasClass('wn-timeline-item-row') && isInsertAfter) {
							targetIdx += 1;
						}

						if (sourceEntryIndex === targetEntryIdx &&
							(sourceIdx === targetIdx || sourceIdx === targetIdx - 1)) {
							return;
						}

						void (async () => {
							if (pendingInlineSaves.size > 0) {
								const inlineSaveOk = await awaitPendingInlineSaves();
								if (!inlineSaveOk) {
									return;
								}
							}
							onSaveStateChange(true);
							try {
								const sourceEntry = allEntries[sourceEntryIndex];
								const targetEntry = allEntries[targetEntryIdx];
								const expectedItem = sourceEntry?.items?.[sourceIdx] ? { ...sourceEntry.items[sourceIdx] } : undefined;
								const expectedSourceEntry: TimelineEntry | undefined = sourceEntry ? deepCloneEntry(sourceEntry) : undefined;
								const expectedTargetEntry: TimelineEntry | undefined = targetEntry ? deepCloneEntry(targetEntry) : undefined;

								await timelineManager.moveEventItem(
									sourceEntryIndex,
									sourceIdx,
									targetEntryIdx,
									targetIdx,
									bookFolder,
									expectedItem,
									expectedSourceEntry,
									expectedTargetEntry
								);
							} catch (err) {
								Logger.error('[TimelineBoard] moveEventItem 失败:', err);
							} finally {
								onSaveStateChange(false);
								reloadBoard();
							}
						})();
					}
					return;
				}

				if (allowChapterDrop) {
					void handleDrop(e, targetEvents);
				}
			});
		};

		// Determine where each file goes
		const unscheduled: TFile[] = [];
		const fileGroups = new Map<string, TFile[]>(); // Key is "entryIndex|itemIndex" or a GAP key.

		for (const file of files) {
			let eventsFromMD: TimelineEventRef[] = chapterToEventMap.get(file.path) || [];

			if (!timelineFile && eventsFromMD.length === 0) {
				const fmEvents = getChapterEvents(file, new Map()); // pass empty map to only get FM
				eventsFromMD = fmEvents.flatMap(time => {
					const entry = displayEntries.find(candidate => candidate.time === time);
					const entryIndex = entry ? entryIndexByEntry.get(entry) : undefined;
					return entryIndex === undefined ? [] : [{ time, itemIndex: 0, entryIndex }];
				});
			}

			if (eventsFromMD.length > 1 && displayEntries.length > 0) {
				eventsFromMD.sort((a, b) => {
					const idxA = displayPositionByEntryIndex.get(a.entryIndex) ?? -1;
					const idxB = displayPositionByEntryIndex.get(b.entryIndex) ?? -1;
					if (idxA !== -1 && idxB !== -1) {
						if (idxA !== idxB) return idxA - idxB;
						return (a.itemIndex || 0) - (b.itemIndex || 0);
					}
					return 0;
				});
			}

			if (eventsFromMD.length === 0) {
				unscheduled.push(file);
			} else if (eventsFromMD.length === 2) {
				const e1 = eventsFromMD[0];
				const e2 = eventsFromMD[1];
				let isAdjacent = false;
				
				if (e1.entryIndex === e2.entryIndex) {
					isAdjacent = Math.abs((e1.itemIndex || 0) - (e2.itemIndex || 0)) === 1;
					if (isAdjacent) {
						const minIdx = Math.min(e1.itemIndex || 0, e2.itemIndex || 0);
						const maxIdx = Math.max(e1.itemIndex || 0, e2.itemIndex || 0);
						const key = `GAP|${e1.entryIndex}|${minIdx}|${maxIdx}`;
						if (!fileGroups.has(key)) fileGroups.set(key, []);
						fileGroups.get(key)!.push(file);
						continue;
					}
				} else {
					const idx1 = displayPositionByEntryIndex.get(e1.entryIndex) ?? -1;
					const idx2 = displayPositionByEntryIndex.get(e2.entryIndex) ?? -1;
					if (idx1 !== -1 && idx2 !== -1 && Math.abs(idx1 - idx2) === 1) {
						const firstIdx = Math.min(idx1, idx2);
						const secondIdx = Math.max(idx1, idx2);
						const firstEntry = displayEntries[firstIdx];
						const secondEntry = displayEntries[secondIdx];
						const firstItemCount = firstEntry.items && firstEntry.items.length > 0 ? firstEntry.items.length : 1;
						const secondItemCount = secondEntry.items && secondEntry.items.length > 0 ? secondEntry.items.length : 1;
						
						const firstEvt = firstIdx === idx1 ? e1 : e2;
						const secondEvt = firstIdx === idx1 ? e2 : e1;
						
						if (
							((firstEvt.itemIndex || 0) === firstItemCount - 1 && (secondEvt.itemIndex || 0) === 0) ||
							((secondEvt.itemIndex || 0) === secondItemCount - 1 && (firstEvt.itemIndex || 0) === 0)
						) {
							isAdjacent = true;
							const key = `GAP|${firstEvt.entryIndex}|${secondEvt.entryIndex}`;
							if (!fileGroups.has(key)) fileGroups.set(key, []);
							fileGroups.get(key)!.push(file);
							continue;
						}
					}
				}
				
				// Not adjacent exactly 2 events -> fallback to rendering in first event
				const firstEvent = eventsFromMD[0];
				const key = eventKey(firstEvent);
				if (!fileGroups.has(key)) fileGroups.set(key, []);
				fileGroups.get(key)!.push(file);
			} else {
				// Render in the first event ONLY
				const firstEvent = eventsFromMD[0];
				const key = eventKey(firstEvent);
				if (!fileGroups.has(key)) fileGroups.set(key, []);
				fileGroups.get(key)!.push(file);
			}
		}

		if (displayEntries.length > 0) {
			const firstDisplayEntry = displayEntries[0];
			const firstEntryIndex = entryIndexByEntry.get(firstDisplayEntry);
			if (firstEntryIndex !== undefined) {
				const startSlot = mainCol.createDiv('wn-timeline-node-slot is-start');
				setupPendingSlotDropzone(
					startSlot,
					!isDescending
						? { beforeEntryIndex: firstEntryIndex, expectedBeforeEntry: deepCloneEntry(firstDisplayEntry) }
						: { afterEntryIndex: firstEntryIndex, expectedAfterEntry: deepCloneEntry(firstDisplayEntry) }
				);
				if (canSortNodes) {
					setupNodeDropzone(startSlot, firstEntryIndex, 'before');
				}
			}

			for (let i = 0; i < displayEntries.length; i++) {
				const entry = displayEntries[i];
				const entryIndex = entryIndexByEntry.get(entry);
				if (entryIndex === undefined) continue;

				// 1. The main node container
				const nodeDiv = mainCol.createDiv('wn-timeline-node');
				if (canSortNodes) {
					setupNodeDropzone(nodeDiv, entryIndex);
				}
				const titleDiv = nodeDiv.createDiv({ cls: 'wn-timeline-node-title' });
				const nodeHandle = titleDiv.createSpan({
					cls: canSortNodes ? 'wn-timeline-node-handle is-sortable' : 'wn-timeline-node-handle'
				});
				if (canSortNodes) {
					setupNodeHandle(nodeHandle, nodeDiv, entryIndex);
				}
				if (entry.type) titleDiv.createSpan({ text: entry.type, cls: 'wn-timeline-type-badge' });
				if (entry.lores && entry.lores.length > 0) {
					const loreContainer = titleDiv.createSpan({ cls: 'wn-timeline-node-lore-badges' });
					renderLoreBadges(loreContainer, entry.lores, bookFolder, plugin, true, 0);
				}
				const displayTime = getTimelineNodeDisplayTime(entry);
				const timeSpan = titleDiv.createSpan({
					cls: entry.timePending ? 'wn-timeline-node-time-text is-time-pending' : 'wn-timeline-node-time-text',
					text: displayTime
				});
				timeSpan.title = t('common.jump-to-entry');
				timeSpan.onclick = async (e) => {
					e.stopPropagation();
					await openTimelineEntry(entry, entryIndex);
				};
				setupDropzone(titleDiv, [], {
					pendingInsertTarget: { entryIndex, itemIndex: 0 },
					allowChapterDrop: false
				});

				const editBtn = titleDiv.createEl('button', {
					cls: 'clickable-icon wn-timeline-node-edit-btn'
				});
				editBtn.setAttr('type', 'button');
				editBtn.setAttr('aria-label', t('common.edit'));
				setTooltip(editBtn, t('common.edit'));
				setIcon(editBtn, 'pencil');
				editBtn.addEventListener('dragstart', (e) => e.stopPropagation());
				editBtn.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.stopPropagation();
					}
				});
				editBtn.onclick = (e: MouseEvent) => {
					e.stopPropagation();
					if (isEditModalLaunching) {
						return;
					}
					isEditModalLaunching = true;
					const targetBookFolder = bookFolder;
					void (async () => {
						try {
							if (pendingInlineSaves.size > 0) {
								const inlineSaveOk = await awaitPendingInlineSaves();
								if (!inlineSaveOk) {
									return;
								}
							}

							const currentOriginalIndex = allEntries.indexOf(entry);
							const targetIndex = currentOriginalIndex >= 0 ? currentOriginalIndex : entryIndex;
							const originalEntrySnapshot = deepCloneEntry(entry);

							const fromSettings = plugin.settings.timeline?.defaultTypes || [];
							const fromEntries = allEntries.map(e => e.type).filter((type): type is string => Boolean(type));
							const typeOptions = [...new Set([...fromSettings, ...fromEntries])];

							new TimelineEditModal({
								app,
								context: plugin,
								folderPath: targetBookFolder,
								initialEntry: originalEntrySnapshot,
								typeOptions,
								onSubmit: async (updated: TimelineEntry) => {
									onSaveStateChange(true);
									try {
										if (!timelineSource) {
											const message = t('common.no-files-hint', { type: t('setting.timeline') });
											showPluginNotice(message);
											throw new Error(message);
										}
										const result = await timelineManager.updateEntry(targetIndex, updated, targetBookFolder, originalEntrySnapshot, timelineSource);
										if (!result) {
											const hasFile = typeof timelineManager.getTimelineFile === 'function'
												? Boolean(timelineManager.getTimelineFile(targetBookFolder))
												: true;
											const msg = !hasFile
												? t('common.no-files-hint', { type: t('setting.timeline') })
												: t('timeline.conflict-notice');
											showPluginNotice(msg);
											throw new Error(msg);
										}
										reloadBoard();
									} finally {
										onSaveStateChange(false);
									}
								}
							}).open();
						} catch (err) {
							Logger.error('[TimelineBoard] 打开节点编辑对话框失败:', err);
						} finally {
							isEditModalLaunching = false;
						}
					})();
				};

				// 2. Render each item row (sub-lane) or empty structural node dropzone
				const items: TimelineItem[] = entry.items !== undefined
					? entry.items
					: (entry.description || entry.chapter || entry.origin || entry.important
						? [{ description: entry.description, chapter: entry.chapter, origin: entry.origin, important: entry.important }]
						: []);
				const visibleItemIndices = items.map((_item, index) => index);

				if (visibleItemIndices.length === 0) {
					const emptyNodeZone = nodeDiv.createDiv({
						cls: 'wn-timeline-empty-node-dropzone',
						text: t('timeline.empty-node-hint')
					});
					setupDropzone(
						emptyNodeZone,
						[{ time: entry.time, entryIndex, itemIndex: 0 }],
						{ pendingInsertTarget: { entryIndex, itemIndex: 0 } }
					);
				}

				for (let visibleIndex = 0; visibleIndex < visibleItemIndices.length; visibleIndex++) {
					const itemIdx = visibleItemIndices[visibleIndex];
					const itemRow = nodeDiv.createDiv('wn-timeline-item-row');
					itemRow.setAttribute('draggable', 'true');
					itemRow.addEventListener('dragstart', (e) => {
						if (e.dataTransfer) {
							e.dataTransfer.effectAllowed = 'move';
							e.dataTransfer.setData(DRAG_MIME_EVENT_TIME, entry.time);
							e.dataTransfer.setData(DRAG_MIME_ENTRY_INDEX, String(entryIndex));
							e.dataTransfer.setData(DRAG_MIME_EVENT_INDEX, itemIdx.toString());
							e.dataTransfer.setData('text/plain', `Event: ${displayTime}`);
						}
						window.setTimeout(() => itemRow.addClass('is-dragging'), 0);
					});
					itemRow.addEventListener('dragend', () => {
						itemRow.removeClass('is-dragging');
					});

					// Description box
					const descShell = itemRow.createDiv('wn-timeline-item-desc-shell');
					let descEl: HTMLElement;
					const rawDesc = items[itemIdx].description || '';
					const hasDesc = Boolean(rawDesc.trim().length > 0);
					const isImportant = Boolean(items[itemIdx].important);
					const descCls = `${hasDesc ? 'wn-timeline-item-desc' : 'wn-timeline-item-desc is-empty'}${isImportant ? ' is-important' : ''}`;
					if (hasDesc) {
						descEl = descShell.createDiv({ cls: descCls });
						setStickyNoteEditorContent(descEl, rawDesc);
					} else if (itemIdx === 0) {
						descEl = descShell.createDiv({
							text: t('modal.describe-event-placeholder'),
							cls: descCls
						});
					} else {
						descEl = descShell.createDiv({ text: '', cls: descCls });
					}

					// Action rail is outside the scrolling description so it remains fixed.
					const actionRail = descShell.createDiv({ cls: 'wn-timeline-item-actions' });
					createCardImportanceButton({
						container: actionRail,
						isImportant,
						cardEl: descEl,
						onToggle: async (newImportant) => {
							if (pendingInlineSaves.size > 0) {
								const inlineSaveOk = await awaitPendingInlineSaves();
								if (!inlineSaveOk) {
									throw new Error('Timeline inline save failed');
								}
							}
							const originalIndex = allEntries.indexOf(entry);
							const currentItems = entry.items?.length ? entry.items : items;
							const previousImportant = currentItems[itemIdx].important;
							const originalEntry = {
								...entry,
								lores: entry.lores ? [...entry.lores] : undefined,
								items: entry.items ? entry.items.map(it => ({ ...it })) : undefined
							};
							currentItems[itemIdx].important = newImportant;
							onSaveStateChange(true);
							try {
								await timelineManager.updateEntry(originalIndex, entry, bookFolder, originalEntry);
							} catch (err) {
								currentItems[itemIdx].important = previousImportant;
								Logger.error('[TimelineBoard] 更新事件重要状态失败:', err);
								throw err;
							} finally {
								onSaveStateChange(false);
							}
						}
					});

					// Delete button (在竖向单列中位于星标下方)
					const deleteBtn = actionRail.createDiv({ cls: 'wn-timeline-item-delete-btn' });
					setIcon(deleteBtn, 'trash');
					deleteBtn.onclick = (e) => {
						e.stopPropagation();
						new ConfirmDeleteEventModal(app, t('modal.confirm-delete-event'), () => {
							void (async () => {
								if (pendingInlineSaves.size > 0) {
									const inlineSaveOk = await awaitPendingInlineSaves();
									if (!inlineSaveOk) {
										return;
									}
								}
								onSaveStateChange(true);
								try {
									const originalIndex = allEntries.indexOf(entry);
									const originalEntry = {
										...entry,
										lores: entry.lores ? [...entry.lores] : undefined,
										items: entry.items ? entry.items.map(it => ({ ...it })) : undefined
									};
									const currentItems = entry.items?.length ? entry.items : items;
									if (currentItems.length <= 1) {
										await timelineManager.deleteEntry(originalIndex, bookFolder, originalEntry);
									} else {
										const updatedItems = currentItems.filter((_, idx) => idx !== itemIdx);
										const updatedEntry: TimelineEntry = {
											...entry,
											items: updatedItems
										};
										await timelineManager.updateEntry(originalIndex, updatedEntry, bookFolder, originalEntry);
									}
								} catch (err) {
									Logger.error('[TimelineBoard] 删除事件失败:', err);
								} finally {
									onSaveStateChange(false);
									reloadBoard();
								}
							})();
						}).open();
					};

					// Inline edit logic
					descEl.onclick = (e: MouseEvent) => {
						e.stopPropagation();
						if (descEl.hasClass('is-editing') || descEl.getAttribute('contenteditable') === 'plaintext-only') return;
						const currentDesc = items[itemIdx].description || '';
						const prevScrollTop = descEl.scrollTop ?? 0;
						const prevScrollHeight = descEl.scrollHeight ?? 0;
						const clientHeight = descEl.clientHeight ?? 0;
						const maxScrollBefore = Math.max(0, prevScrollHeight - clientHeight);
						const wasNearBottom = maxScrollBefore <= 0 || prevScrollTop >= maxScrollBefore - 8;

						descEl.empty();
						descEl.removeClass('is-empty');
						descEl.addClass('is-editing');
						setupStickyNoteParagraphEditor(descEl, currentDesc);

						focusTimelineDescriptionEnd(descEl);

						const applyScroll = () => {
							const newMaxScroll = Math.max(0, (descEl.scrollHeight ?? 0) - (descEl.clientHeight ?? 0));
							if (wasNearBottom) {
								descEl.scrollTop = newMaxScroll;
							} else {
								descEl.scrollTop = Math.min(prevScrollTop, newMaxScroll);
							}
						};

						applyScroll();

						const ownerWindow = descEl.ownerDocument?.defaultView;
						if (ownerWindow?.requestAnimationFrame) {
							ownerWindow.requestAnimationFrame(() => {
								if (descEl.isConnected === false) return;
								applyScroll();
							});
						}


						let currentSavePromise: Promise<boolean> | null = null;
						const saveDesc = (): Promise<boolean> => {
							if (currentSavePromise) return currentSavePromise;

							const savePromise = (async (): Promise<boolean> => {
								const newVal = getPlaintextContent(descEl).trim();
								if (newVal === currentDesc) {
									teardownStickyNoteParagraphEditor(descEl);
									descEl.removeClass('is-editing');
									if (!currentDesc) {
										descEl.addClass('is-empty');
									}
									return true;
								}

								onSaveStateChange(true);
								try {
									const originalIndex = allEntries.indexOf(entry);
									const originalEntry = {
										...entry,
										lores: entry.lores ? [...entry.lores] : undefined,
										items: entry.items ? entry.items.map(it => ({ ...it })) : undefined
									};
									const updatedItems = items.map((it, idx) =>
										idx === itemIdx ? { ...it, description: newVal } : { ...it }
									);
									const updatedEntry: TimelineEntry = {
										...entry,
										items: updatedItems,
										description: updatedItems.length > 0 ? entry.description : newVal
									};
									await timelineManager.updateEntry(originalIndex, updatedEntry, bookFolder, originalEntry);
									items[itemIdx].description = newVal;
									if (!entry.items) {
										entry.description = newVal;
									}
									teardownStickyNoteParagraphEditor(descEl);
									descEl.removeClass('is-editing');
									if (!newVal) {
										descEl.addClass('is-empty');
									}
									return true;
								} catch (err) {
									currentSavePromise = null;
									Logger.error('[TimelineBoard] 更新描述失败:', err);
									return false;
								} finally {
									onSaveStateChange(false);
								}
							})();

							const trackedPromise: Promise<boolean> = savePromise.finally(() => {
								if (currentSavePromise === trackedPromise) {
									currentSavePromise = null;
								}
							});

							currentSavePromise = trackedPromise;
							registerPendingInlineSave(currentSavePromise);

							void currentSavePromise.then((success) => {
								if (success) {
									reloadBoard();
								}
							});

							return currentSavePromise;
						};

						descEl.onblur = () => saveDesc();

					};

					// Cards container
					const cardsContainer = itemRow.createDiv('wn-timeline-cards-container');

					const key = `${entryIndex}|${itemIdx}`;
					const filesInItem = fileGroups.get(key) || [];
					CorkboardGridRenderer.render({
						app, plugin, container: cardsContainer, files: filesInItem, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
					});

					// Setup dropzone for this itemRow
					setupDropzone(itemRow, [{ time: entry.time, entryIndex, itemIndex: itemIdx }]);
					itemRow.setAttribute('data-entry-index', String(entryIndex));
					itemRow.setAttribute('data-item-index', String(itemIdx));
					// Render sub-gap (gap between events in the same time node)
					if (visibleIndex < visibleItemIndices.length - 1) {
						const nextItemIdx = visibleItemIndices[visibleIndex + 1];
						const subGapKey = `GAP|${entryIndex}|${itemIdx}|${nextItemIdx}`;
						const subGapDiv = nodeDiv.createDiv('wn-timeline-gap wn-timeline-sub-gap');
						const subCardsContainer = subGapDiv.createDiv('wn-timeline-cards-container');
						setupDropzone(
							subGapDiv,
							[{ time: entry.time, entryIndex, itemIndex: itemIdx }, { time: entry.time, entryIndex, itemIndex: nextItemIdx }],
							{ pendingInsertTarget: { entryIndex, itemIndex: nextItemIdx } }
						);

						const filesInSubGap = fileGroups.get(subGapKey) || [];
						CorkboardGridRenderer.render({
							app, plugin, container: subCardsContainer, files: filesInSubGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
						});
					}
				}

				// 3. Render Gap to next event if exists
				if (i < displayEntries.length - 1) {
					const nextEntry = displayEntries[i + 1];
					const nextEntryIndex = entryIndexByEntry.get(nextEntry);
					const gapKey = `GAP|${entryIndex}|${nextEntryIndex ?? -1}`;

					const gapDiv = mainCol.createDiv('wn-timeline-gap');
					const cardsContainer = gapDiv.createDiv('wn-timeline-cards-container');
					const betweenAnchor: TimelineInsertAnchor | undefined = nextEntryIndex !== undefined
						? (!isDescending
							? {
								afterEntryIndex: entryIndex,
								expectedAfterEntry: deepCloneEntry(entry),
								beforeEntryIndex: nextEntryIndex,
								expectedBeforeEntry: deepCloneEntry(nextEntry)
							}
							: {
								afterEntryIndex: nextEntryIndex,
								expectedAfterEntry: deepCloneEntry(nextEntry),
								beforeEntryIndex: entryIndex,
								expectedBeforeEntry: deepCloneEntry(entry)
							})
						: undefined;
					const lastItemIdx = Math.max(0, items.length - 1);
					setupDropzone(
						gapDiv,
						[{ time: entry.time, entryIndex, itemIndex: lastItemIdx }, { time: nextEntry.time, entryIndex: nextEntryIndex ?? -1, itemIndex: 0 }],
						{ pendingInsertAnchor: betweenAnchor }
					);
					if (canSortNodes) {
						setupNodeDropzone(gapDiv, entryIndex, 'after');
					}

					const filesInGap = fileGroups.get(gapKey) || [];
					CorkboardGridRenderer.render({
						app, plugin, container: cardsContainer, files: filesInGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
					});
				}
			}

			const lastDisplayEntry = displayEntries[displayEntries.length - 1];
			const lastEntryIndex = entryIndexByEntry.get(lastDisplayEntry);
			if (lastEntryIndex !== undefined) {
				const endSlot = mainCol.createDiv('wn-timeline-node-slot is-end');
				setupPendingSlotDropzone(
					endSlot,
					!isDescending
						? { afterEntryIndex: lastEntryIndex, expectedAfterEntry: deepCloneEntry(lastDisplayEntry) }
						: { beforeEntryIndex: lastEntryIndex, expectedBeforeEntry: deepCloneEntry(lastDisplayEntry) }
				);
				if (canSortNodes) {
					setupNodeDropzone(endSlot, lastEntryIndex, 'after');
				}
			}
		} else {
			mainCol.addClass('is-empty');
			const emptyMsg = mainCol.createDiv('wn-timeline-empty-msg');
			emptyMsg.setText(t('corkboard.no-timeline'));
			setupPendingSlotDropzone(emptyMsg, { fallbackIndex: allEntries.length });
		}

		// Check if any multi-event links exist (chapter mapped to 2+ events)
		let hasMultiEventLinks = false;
		for (const events of chapterToEventMap.values()) {
			if (events.length > 1) {
				hasMultiEventLinks = true;
				break;
			}
		}

		if (hasMultiEventLinks) {
			// --- SVG Link Layer (Background) ---
			const doc = waterfallLayout.ownerDocument;
			const win = doc.defaultView || window;
			const bgSvgLayer = win.createSvg('svg');
			bgSvgLayer.classList.add('wn-timeline-svg-layer');
			waterfallLayout.appendChild(bgSvgLayer);

			// --- SVG Link Layer (Foreground) ---
			const fgSvgLayer = win.createSvg('svg');
			fgSvgLayer.classList.add('wn-timeline-svg-layer-fg');
			waterfallLayout.appendChild(fgSvgLayer);

			let lastLinksHash = '';
			const buildRowElementMap = () => {
				const rowElMap = new Map<string, HTMLElement>();
				mainCol.querySelectorAll('[data-entry-index][data-item-index]').forEach(el => {
					const entryIndex = el.getAttribute('data-entry-index');
					const itemIndex = el.getAttribute('data-item-index');
					if (entryIndex !== null && itemIndex !== null) {
						rowElMap.set(`${entryIndex}|${itemIndex}`, el as HTMLElement);
					}
				});
				return rowElMap;
			};

			const drawLinks = () => {
				// 剪枝 1：若容器尚未插回 Live DOM 或宽度为 0，跳过昂贵的 reflow 计算
				if (!waterfallLayout.isConnected || waterfallLayout.clientWidth === 0) return;

				// ===== Phase 1: 纯读取阶段 =====
				// 在任何 DOM 写入操作之前，批量收集所有布局数据（getBoundingClientRect）。
				// 避免"写→读→写→读"交替模式触发的 forced layout reflow，
				// 将多次昂贵的强制布局计算合并为一次自然的批量读取。

				// 构建 O(1) 的卡片元素索引（key = file.path）
				const localCardElMap = new Map<string, HTMLElement>();
				mainCol.querySelectorAll('.wn-corkboard-card').forEach(el => {
					const dp = el.getAttribute('data-path');
					if (dp) localCardElMap.set(dp, el as HTMLElement);
				});

				// 构建 O(1) 的事件行元素索引（key = "entryIndex|itemIndex"）
				const rowElMap = buildRowElementMap();

				// 一次性读取容器 rect（单次 reflow，所有后续计算基于此快照）
				const layoutRect = waterfallLayout.getBoundingClientRect();

				// 收集所有待绘制连线的数据（纯读，不写 DOM）
				type LinkData = { startX: number; startY: number; endX: number; endY: number; isHovered: boolean; };
				const links: LinkData[] = [];

				for (const [key, events] of chapterToEventMap.entries()) {
					if (events.length <= 1) continue;

					const cardEl = localCardElMap.get(key);
					if (!cardEl) continue;
					// 处于间隔区的卡片自然桥接相邻事件，无需连线
					if (cardEl.closest('.wn-timeline-gap')) continue;

					const cardRect = cardEl.getBoundingClientRect();
					const startX = cardRect.left - layoutRect.left;
					const startY = cardRect.top + cardRect.height / 2 - layoutRect.top;

					// 检查 hover 状态（仅读取 DOM 状态，不写入）
					let isHovered = cardEl.matches(':hover');
					if (!isHovered) {
						for (let i = 1; i < events.length; i++) {
							const targetEvt = events[i];
							const rowKey = eventKey(targetEvt);
							const targetRowEl = rowElMap.get(rowKey);
							if (targetRowEl && targetRowEl.matches(':hover')) {
								isHovered = true;
								break;
							}
						}
					}

					for (let i = 1; i < events.length; i++) {
						const targetEvt = events[i];
						const rowKey = eventKey(targetEvt);
						const targetRowEl = rowElMap.get(rowKey);
						if (!targetRowEl) continue;

						const targetDescEl = targetRowEl.querySelector('.wn-timeline-item-desc');
						if (!targetDescEl) continue;

						const targetRect = targetDescEl.getBoundingClientRect();
						links.push({
							startX: Math.round(startX),
							startY: Math.round(startY),
							endX: Math.round(targetRect.right - layoutRect.left + 5),
							endY: Math.round(targetRect.top + targetRect.height / 2 - layoutRect.top),
							isHovered
						});
					}
				}

				// 剪枝 2：若连线数据及坐标与上一帧完全相同，直接 return，避免无意义的 SVG DOM 清空与重建
				const currentHash = JSON.stringify(links);
				if (currentHash === lastLinksHash) return;
				lastLinksHash = currentHash;

				// ===== Phase 2: 纯写入阶段 =====
				// 所有 rect 数据已收集完毕，现在统一清空旧 SVG 并批量写入新元素。
				// 使用 DocumentFragment 将多次 appendChild 合并为单次 DOM 插入，
				// 消除每次 appendChild 触发的中间 reflow。
				bgSvgLayer.empty();
				fgSvgLayer.empty();

				const bgFrag = win.createFragment();
				const fgFrag = win.createFragment();

				for (const { startX, startY, endX, endY, isHovered } of links) {
					const targetFrag = isHovered ? fgFrag : bgFrag;

					const path = win.createSvg('path');
					path.setAttribute('d', `M ${endX} ${endY} C ${endX + 50} ${endY}, ${startX - 50} ${startY}, ${startX} ${startY}`);
					path.setAttribute('fill', 'none');
					path.setAttribute('class', isHovered ? 'wn-timeline-svg-path is-hovered' : 'wn-timeline-svg-path');

					const arrow = win.createSvg('polygon');
					arrow.setAttribute('points', '-6,-3 0,0 -6,3');
					arrow.setAttribute('transform', `translate(${startX}, ${startY})`);
					arrow.setAttribute('class', isHovered ? 'wn-timeline-svg-arrow is-hovered' : 'wn-timeline-svg-arrow');

					const dot = win.createSvg('circle');
					dot.setAttribute('cx', `${endX}`);
					dot.setAttribute('cy', `${endY}`);
					dot.setAttribute('r', '3');
					dot.setAttribute('class', isHovered ? 'wn-timeline-svg-dot is-hovered' : 'wn-timeline-svg-dot');

					targetFrag.appendChild(path);
					targetFrag.appendChild(arrow);
					targetFrag.appendChild(dot);
				}

				bgSvgLayer.appendChild(bgFrag);
				fgSvgLayer.appendChild(fgFrag);
			};

			let scheduled = false;
			let rafId: number | null = null;
			const scheduleDrawLinks = () => {
				if (scheduled) return;
				scheduled = true;
				rafId = win.requestAnimationFrame(() => {
					scheduled = false;
					rafId = null;
					const tDrawStart = performance.now();
					drawLinks();
					Logger.info(`[Perf Phase] Timeline.RAF.drawLinks: ${(performance.now() - tDrawStart).toFixed(2)}ms`);
				});
			};

			// 初次挂载后异步计算一次位置
			scheduleDrawLinks();

			// 为存在跨事件关联的卡片和事件节点绑定精准的 mouseenter / mouseleave 监听 (恢复 hover 高亮与置顶，无全局 mouseover 性能开销)
			const hoverCleanups: Array<() => void> = [];
			const bindHoverListeners = () => {
				// 清理上一次绑定的 hover 监听器
				while (hoverCleanups.length > 0) {
					const fn = hoverCleanups.pop();
					if (fn) fn();
				}

				// 构建 O(1) 的卡片元素索引（key = file.path），避免 O(N²) 的全量扫描
				const hoverCardElMap = new Map<string, HTMLElement>();
				mainCol.querySelectorAll('.wn-corkboard-card').forEach(el => {
					const dp = el.getAttribute('data-path');
					if (dp) hoverCardElMap.set(dp, el as HTMLElement);
				});
				const rowElMap = buildRowElementMap();

				for (const [key, events] of chapterToEventMap.entries()) {
					if (events.length <= 1) continue;
					const cardEl = hoverCardElMap.get(key);

					const targetEls: HTMLElement[] = [];
					if (cardEl) targetEls.push(cardEl);

					for (let i = 1; i < events.length; i++) {
						const targetEvt = events[i];
						const targetRowEl = rowElMap.get(eventKey(targetEvt));
						if (!targetRowEl) continue;
						const targetDescEl = targetRowEl.querySelector('.wn-timeline-item-desc') as HTMLElement;
						if (targetDescEl) targetEls.push(targetDescEl);
					}

					for (const el of targetEls) {
						const onEnter = () => scheduleDrawLinks();
						const onLeave = () => scheduleDrawLinks();
						el.addEventListener('mouseenter', onEnter);
						el.addEventListener('mouseleave', onLeave);
						hoverCleanups.push(() => {
							el.removeEventListener('mouseenter', onEnter);
							el.removeEventListener('mouseleave', onLeave);
						});
					}
				}
			};

			bindHoverListeners();

			// 监听容器滚动以按需绘制 SVG 连线
			mainCol.addEventListener('scroll', scheduleDrawLinks, { passive: true });
			sideCol.addEventListener('scroll', scheduleDrawLinks, { passive: true });

			let lastObservedWidth = 0;
			let lastObservedHeight = 0;
			let resizeObserver: ResizeObserver | null = typeof ResizeObserver !== 'undefined'
				? new ResizeObserver((entries) => {
					for (const entry of entries) {
						const { width, height } = entry.contentRect;
						if (Math.abs(width - lastObservedWidth) > 1 || Math.abs(height - lastObservedHeight) > 1) {
							lastObservedWidth = width;
							lastObservedHeight = height;
							scheduleDrawLinks();
						}
					}
				})
				: null;
			if (resizeObserver) {
				resizeObserver.observe(waterfallLayout);
			}

			const cleanup = () => {
				if (rafId !== null) {
					win.cancelAnimationFrame(rafId);
					rafId = null;
				}
				mainCol.removeEventListener('scroll', scheduleDrawLinks);
				sideCol.removeEventListener('scroll', scheduleDrawLinks);
				while (hoverCleanups.length > 0) {
					const fn = hoverCleanups.pop();
					if (fn) fn();
				}
				if (resizeObserver) {
					resizeObserver.disconnect();
					resizeObserver = null;
				}
			};

			if (options.ownerComponent) {
				options.ownerComponent.register(cleanup);
			} else {
				const observer = new MutationObserver(() => {
					if (!waterfallLayout.isConnected) {
						cleanup();
						observer.disconnect();
					}
				});
				observer.observe(waterfallLayout.ownerDocument.body, { childList: true, subtree: true });
			}
		}

		// Add Timeline Node Button
		const addNodeRow = mainCol.createDiv('wn-timeline-add-node-row');
		const addNodeBtn = addNodeRow.createDiv({ cls: 'wn-timeline-add-node-btn' });
		addNodeBtn.textContent = t('corkboard.new-timeline-node');
		addNodeBtn.onclick = async () => {
			let tlFile = timelineManager.getTimelineFile(bookFolder);
			if (!tlFile) {
				// 自动创建时间线.md
				try {
					tlFile = await timelineManager.createTimelineFile(bookFolder);
					if (tlFile) {
						const msg = t('notice.timeline-file-created');
						showPluginNotice(msg.replace('{name}', tlFile.path));
					}
				} catch (e) {
					console.error('[TimelineBoardRenderer] 创建时间线文件失败:', e);
					showPluginNotice(t('notice.timeline-file-create-failed'));
					return;
				}
			}
			const localTypes = [...new Set(allEntries.map(e => e.type).filter((type): type is string => Boolean(type)))];

			const modal = new TimelineAddModal(
				app,
				plugin,
				'',
				'',
				bookFolder,
				(entry) => {
					void (async () => {
						if (pendingInlineSaves.size > 0) {
							const inlineSaveOk = await awaitPendingInlineSaves();
							if (!inlineSaveOk) {
								return;
							}
						}
						onSaveStateChange(true);
						try {
							await timelineManager.appendEntry(entry, bookFolder);
							showPluginNotice(t('notice.timeline-added'));
						} catch (e) {
							console.error('[TimelineBoardRenderer] 写入记录失败:', e);
						} finally {
							onSaveStateChange(false);
							reloadBoard();
						}
					})();
				},
				true,
				localTypes,
				undefined,
				t('modal.new-event')
			);
			modal.open();
		};

		const isPhoneSidebar = container.ownerDocument.body.classList.contains('is-phone');
		if (isSidebarCollapsed) {
			sideCol.addClass('is-collapsed');
			waterfallLayout.addClass('is-sidebar-collapsed');
		}
		if (unscheduled.length === 0) {
			sideCol.addClass('is-unscheduled-empty');
		}
		const hasPendingEvents = pendingEvents.length > 0;
		if (!hasPendingEvents) sideCol.addClass('is-pending-empty');

		const addSidebarToggle = (parent: HTMLElement, expanding: boolean) => {
			const cls = expanding ? 'wn-timeline-sidebar-expand-handle' : 'wn-timeline-sidebar-collapse-btn';
			const control = parent.createDiv('clickable-icon ' + cls);
			control.setAttr('role', 'button');
			control.setAttr('tabindex', '0');
			control.setAttr('aria-expanded', expanding ? 'false' : 'true');
			control.setAttr('aria-label', t(expanding ? 'corkboard.expand-sidebar' : 'corkboard.collapse-sidebar'));
			const icon = isPhoneSidebar
				? (expanding ? 'chevron-up' : 'chevron-down')
				: (expanding ? 'chevron-left' : 'chevron-right');
			setIcon(control, icon);

			const toggleCollapse = (event: Event) => {
				event.stopPropagation();
				onToggleSidebarCollapse?.();
			};
			control.onclick = toggleCollapse;
			control.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				toggleCollapse(event);
			});
		};

		addSidebarToggle(sideCol, true);

		// Sidebar Dropzone: chapters return to unscheduled, scheduled events return to pending
		setupDropzone(sideCol, [], { acceptScheduledEventToPending: true });

		const panesContainer = sideCol.createDiv('wn-timeline-sidebar-panes');

		// Pane 1: Pending Events (Desktop Top / Mobile Left)
		const pendingPane = panesContainer.createDiv('wn-timeline-sidebar-pane wn-timeline-pending-pane');
		const pendingHeader = pendingPane.createDiv('wn-timeline-sidebar-header wn-timeline-pending-header');
		const pendingTitleGroup = pendingHeader.createDiv('wn-timeline-sidebar-title-group');
		if (!isPhoneSidebar) {
			addSidebarToggle(pendingTitleGroup, false);
		} else if (unscheduled.length === 0) {
			addSidebarToggle(pendingHeader, false);
		}
		pendingTitleGroup.createSpan({ text: t('timeline.pending-events') });
		pendingTitleGroup.createSpan({ text: ` (${pendingEvents.length})`, cls: 'wn-timeline-sidebar-count' });

		const quickAddRow = pendingPane.createDiv('wn-timeline-pending-quick-add');
		const quickInput = quickAddRow.createEl('input', {
			type: 'text',
			cls: 'wn-timeline-pending-quick-input'
		});
		quickInput.placeholder = t('timeline.pending-quick-add-placeholder');
		quickInput.setAttr('aria-label', t('timeline.pending-quick-add-placeholder'));
		const quickAddButton = quickAddRow.createEl('button', {
			type: 'button',
			cls: 'wn-timeline-pending-quick-button',
			text: t('common.add')
		});
		if (pendingInputDraft) {
			quickInput.value = pendingInputDraft;
		}
		let isQuickComposing = false;
		let isQuickSubmitting = false;
		quickInput.addEventListener('input', () => {
			onPendingInputDraftChange?.(quickInput.value);
		});
		quickInput.addEventListener('compositionstart', () => {
			isQuickComposing = true;
		});
		quickInput.addEventListener('compositionend', () => {
			isQuickComposing = false;
		});
		const submitPendingEvent = (allowEmpty: boolean) => {
			if (isQuickComposing || isQuickSubmitting) return;
			const rawValue = quickInput.value;
			const trimmed = rawValue.trim();
			if (!trimmed && !allowEmpty) return;
			if (typeof timelineManager.addPendingEvent !== 'function') return;

			isQuickSubmitting = true;
			quickAddButton.disabled = true;
			void (async () => {
				if (pendingInlineSaves.size > 0) {
					const inlineSaveOk = await awaitPendingInlineSaves();
					if (!inlineSaveOk) {
						isQuickSubmitting = false;
						quickAddButton.disabled = false;
						return;
					}
				}
				onSaveStateChange(true);
				let succeeded = false;
				try {
					await timelineManager.addPendingEvent!({ description: trimmed }, bookFolder);
					succeeded = true;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					showPluginNotice(t('modal.save-failed', { error: msg }));
					Logger.error('[TimelineBoard] addPendingEvent 失败:', err);
				} finally {
					isQuickSubmitting = false;
					quickAddButton.disabled = false;
					onSaveStateChange(false);
					if (succeeded) {
						if (quickInput.value === rawValue) {
							quickInput.value = '';
							onPendingInputDraftChange?.('');
						}
						onRequestPendingInputFocus?.();
						reloadBoard();
					}
				}
			})();
		};
		quickAddButton.onclick = () => submitPendingEvent(true);
		quickInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key !== 'Enter' || isQuickComposing || e.isComposing || (e as { keyCode?: number }).keyCode === 229) return;
			e.preventDefault();
			submitPendingEvent(false);
		});

		if (hasPendingEvents) {
			const pendingList = pendingPane.createDiv('wn-timeline-pending-list');
			for (const pendingEvent of pendingEvents) {
				const card = pendingList.createDiv('wn-timeline-pending-card');
				card.setAttribute('draggable', 'true');
				card.setAttribute('data-pending-id', pendingEvent.id);
				card.addEventListener('dragstart', (e) => {
					if (e.dataTransfer) {
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData(DRAG_MIME_PENDING_ID, pendingEvent.id);
						e.dataTransfer.setData('text/plain', `PendingEvent: ${pendingEvent.description}`);
					}
					card.addClass('is-dragging');
				});
				card.addEventListener('dragend', () => {
					card.removeClass('is-dragging');
				});

				const pendingDescEl = card.createDiv({
					cls: pendingEvent.description.trim() ? 'wn-timeline-item-desc' : 'wn-timeline-item-desc is-empty'
				});
				if (pendingEvent.description.trim()) {
					setStickyNoteEditorContent(pendingDescEl, pendingEvent.description);
				} else {
					pendingDescEl.setText(t('modal.describe-event-placeholder'));
				}

				pendingDescEl.onclick = (e: MouseEvent) => {
					e.stopPropagation();
					if (pendingDescEl.hasClass('is-editing') || pendingDescEl.getAttribute('contenteditable') === 'plaintext-only') return;
					const currentDesc = pendingEvent.description || '';
					pendingDescEl.empty();
					pendingDescEl.removeClass('is-empty');
					pendingDescEl.addClass('is-editing');
					setupStickyNoteParagraphEditor(pendingDescEl, currentDesc);
					focusTimelineDescriptionEnd(pendingDescEl);

					let currentSavePromise: Promise<boolean> | null = null;
					const savePendingDesc = (): Promise<boolean> => {
						if (currentSavePromise) return currentSavePromise;
						const savePromise = (async (): Promise<boolean> => {
							const newVal = getPlaintextContent(pendingDescEl).trim();
							if (newVal === currentDesc) {
								teardownStickyNoteParagraphEditor(pendingDescEl);
								pendingDescEl.removeClass('is-editing');
								if (!currentDesc) pendingDescEl.addClass('is-empty');
								return true;
							}
							if (typeof timelineManager.updatePendingEvent !== 'function') return false;
							onSaveStateChange(true);
							try {
								await timelineManager.updatePendingEvent(
									pendingEvent.id,
									{ description: newVal },
									bookFolder,
									deepClonePendingEvent(pendingEvent)
								);
								pendingEvent.description = newVal;
								teardownStickyNoteParagraphEditor(pendingDescEl);
								pendingDescEl.removeClass('is-editing');
								if (!newVal) pendingDescEl.addClass('is-empty');
								return true;
							} catch (err) {
								currentSavePromise = null;
								Logger.error('[TimelineBoard] updatePendingEvent 失败:', err);
								return false;
							} finally {
								onSaveStateChange(false);
							}
						})();

						const tracked: Promise<boolean> = savePromise.finally(() => {
							if (currentSavePromise === tracked) currentSavePromise = null;
						});
						currentSavePromise = tracked;
						registerPendingInlineSave(tracked);
						void tracked.then((ok) => {
							if (ok) reloadBoard();
						});
						return tracked;
					};

					pendingDescEl.onblur = () => savePendingDesc();
				};

				if (pendingEvent.chapter) {
					const chapters = parseTimelineChapterList(pendingEvent.chapter);
					if (chapters.length > 0) {
						const chapterBadges = card.createDiv('wn-timeline-pending-card-chapters');
						for (const ch of chapters) {
							chapterBadges.createSpan({
								cls: 'wn-timeline-pending-chapter-pill',
								text: ChapterSorter.extractWikilinkDisplay(ch)
							});
						}
					}
				}

				const actions = card.createDiv('wn-timeline-item-actions');
				createCardImportanceButton({
					container: actions,
					isImportant: Boolean(pendingEvent.important),
					cardEl: pendingDescEl,
					onToggle: async (important) => {
						if (pendingInlineSaves.size > 0 && !await awaitPendingInlineSaves()) {
							throw new Error('Timeline inline save failed');
						}
						if (typeof timelineManager.updatePendingEvent !== 'function') return;
						onSaveStateChange(true);
						try {
							const save = timelineManager.updatePendingEvent(
								pendingEvent.id, { important }, bookFolder, deepClonePendingEvent(pendingEvent)
							).then(() => { pendingEvent.important = important; });
							registerPendingInlineSave(save.then(() => true, () => false));
							await save;
						} finally {
							onSaveStateChange(false);
						}
					}
				});

				const deletePendingBtn = actions.createEl('button', {
					cls: 'clickable-icon wn-timeline-item-delete-btn',
					attr: { type: 'button', 'aria-label': t('common.delete'), draggable: 'false' }
				});
				setIcon(deletePendingBtn, 'trash');
				deletePendingBtn.addEventListener('dragstart', (e) => {
					e.preventDefault();
					e.stopPropagation();
				});
				deletePendingBtn.onclick = (e: MouseEvent) => {
					e.stopPropagation();
					new ConfirmDeleteEventModal(app, t('modal.confirm-delete-event'), () => {
						void (async () => {
							if (typeof timelineManager.deletePendingEvent !== 'function') return;
							if (pendingInlineSaves.size > 0) {
								const inlineSaveOk = await awaitPendingInlineSaves();
								if (!inlineSaveOk) return;
							}
							onSaveStateChange(true);
							try {
								await timelineManager.deletePendingEvent(
									pendingEvent.id,
									bookFolder,
									deepClonePendingEvent(pendingEvent)
								);
							} catch (err) {
								Logger.error('[TimelineBoard] deletePendingEvent 失败:', err);
							} finally {
								onSaveStateChange(false);
								reloadBoard();
							}
						})();
					}).open();
				};
			}
		}

		// Pane 2: Unscheduled Chapters (Desktop Bottom / Mobile Right)
		const unscheduledPane = panesContainer.createDiv({
			cls: unscheduled.length === 0
				? 'wn-timeline-sidebar-pane wn-timeline-unscheduled-pane is-empty'
				: 'wn-timeline-sidebar-pane wn-timeline-unscheduled-pane'
		});
		const unscheduledHeader = unscheduledPane.createDiv('wn-timeline-sidebar-header wn-timeline-unscheduled-header');
		const titleGroup = unscheduledHeader.createDiv('wn-timeline-sidebar-title-group');
		titleGroup.createSpan({ text: t('corkboard.unscheduled-chapters') });
		// 始终展示未关联章节的数量（包含 0），提升作者概览与归还槽感知
		titleGroup.createSpan({ text: ` (${unscheduled.length})`, cls: 'wn-timeline-sidebar-count' });

		const headerActions = isPhoneSidebar && unscheduled.length > 0
			? unscheduledHeader.createDiv('wn-timeline-sidebar-header-actions')
			: unscheduledHeader;
		const sortToggle = headerActions.createDiv('clickable-icon wn-workbench-sort-toggle');
		sortToggle.setAttr('role', 'button');
		sortToggle.setAttr('tabindex', '0');
		const label = isUnscheduledDescending ? t('corkboard.sort-descending') : t('corkboard.sort-ascending');
		sortToggle.setAttr('aria-label', label);
		sortToggle.setAttr('aria-pressed', isUnscheduledDescending ? 'true' : 'false');
		setIcon(sortToggle, isUnscheduledDescending ? 'arrow-down-narrow-wide' : 'arrow-up-wide-narrow');

		const toggleSort = (event?: Event) => {
			if (event) {
				event.stopPropagation();
			}
			if (onToggleUnscheduledSort) {
				onToggleUnscheduledSort();
			}
		};
		sortToggle.onclick = (e) => toggleSort(e);
		sortToggle.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				event.stopPropagation();
				toggleSort(event);
			}
		});

		if (headerActions !== unscheduledHeader) {
			addSidebarToggle(headerActions, false);
		}

		const unscheduledList = unscheduledPane.createDiv('wn-timeline-unscheduled-list');
		const sideGrid = unscheduledList.createDiv('wn-corkboard-grid');

		const displayUnscheduled = getDeterministicChapterDisplayOrder(unscheduled, {
			currentBookPath,
			isDescending: !!isUnscheduledDescending,
			enableSmartChapterSort: plugin.settings.enableSmartChapterSort,
			customSortOrder: plugin.settings.customSortOrder
		});

		CorkboardGridRenderer.render({
			app, plugin, container: sideGrid, files: displayUnscheduled, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange,
			groupVolumeCards: false
		});
		if (sideGrid.children[0]?.classList.contains('wn-corkboard-volume-header')) {
			unscheduledList.addClass('is-volume-first');
		}

		Logger.info(`[Perf] TimelineBoardRenderer.render completed in ${(performance.now() - tStart).toFixed(2)}ms (${displayEntries.length} entries, ${pendingEvents.length} pending, ${files.length} total files, ${unscheduled.length} unscheduled)`);
	}
}
