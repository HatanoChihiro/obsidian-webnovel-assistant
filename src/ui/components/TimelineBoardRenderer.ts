import type { App, Component, WorkspaceLeaf } from 'obsidian';
import { setIcon, TFile, Notice, Modal } from 'obsidian';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import type { TimelineEntry, TimelineItem, TimelineManager } from '../../services/TimelineManager';
import { CorkboardGridRenderer } from './CorkboardGridRenderer';
import { TimelineAddModal } from '../TimelineAddModal';
import { t } from '../../i18n';
import { Logger } from '../../utils/Logger';
import { smartLocateAndHighlight } from '../../utils/leaf';
import { ChapterSorter } from '../../services/ChapterSorter';
import { getDeterministicChapterDisplayOrder } from '../../utils/chapterDisplayOrder';
import type { TimelineFormContext, TimelineFormSettings } from './TimelineFormComponent';
import type { ChapterCardPlugin } from './ChapterCard';
import type { AccurateCountSettings } from '../../types/settings';
import { createCardImportanceButton } from './CardImportanceButton';
import { setupStickyNoteParagraphEditor, getStickyNoteEditorContent, setStickyNoteEditorContent } from './StickyNoteParagraphEditor';
import { renderLoreBadges } from '../../utils/badge';
import { renderTrajectoryMode } from './TrajectoryBoardRenderer';

class ConfirmDeleteEventModal extends Modal {
	constructor(app: App, private title: string, private onConfirm: () => void) {
		super(app);
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
>;

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
	Pick<AccurateCountSettings, 'enableMobileLorePopover' | 'lorePopoverCollapse' | 'enableSmartChapterSort' | 'customSortOrder'>;

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
	currentTimelineFilter: string;
	currentTimelineLoreFilter?: string[] | Set<string>;
	onSaveStateChange: (isSaving: boolean) => void;
	reloadBoard: () => void;
	getChapterEvents: (file: TFile, fallbackMap: Map<string, string[]>) => string[];
	isDescending?: boolean;
	isUnscheduledDescending?: boolean;
	onToggleUnscheduledSort?: () => void;
	isSidebarCollapsed?: boolean;
	onToggleSidebarCollapse?: () => void;
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
			currentTimelineFilter,
			currentTimelineLoreFilter,
			onSaveStateChange,
			reloadBoard,
			getChapterEvents,
			isDescending = false,
			isUnscheduledDescending,
			onToggleUnscheduledSort,
			isSidebarCollapsed,
			onToggleSidebarCollapse,
			isTrajectoryMode
		} = options;

		const tStart = performance.now();
		const timelineManager = plugin.timelineManager;
		const bookFolder = currentBookPath === '/' ? '' : (currentBookPath || '');
		let entries = options.loadedEntries !== undefined ? options.loadedEntries : await timelineManager.loadEntries(bookFolder);
		const tEntries = performance.now();
		Logger.info(`[Perf Phase] Timeline.loadEntries: ${(tEntries - tStart).toFixed(2)}ms`);

		const allEntries = entries ? [...entries] : [];

		if (entries && currentTimelineFilter && currentTimelineFilter !== 'all') {
			entries = entries.filter(e => e.type === currentTimelineFilter);
		}

		const loreSet = currentTimelineLoreFilter instanceof Set
			? currentTimelineLoreFilter
			: (currentTimelineLoreFilter && (Array.isArray(currentTimelineLoreFilter) ? currentTimelineLoreFilter.length > 0 : true)
				? new Set(currentTimelineLoreFilter)
				: null);

		if (entries && loreSet && loreSet.size > 0) {
			entries = entries.filter(e => (e.lores || []).some(lore => loreSet.has(lore)));
		}

		const displayEntries = (entries && isDescending) ? [...entries].reverse() : (entries ? [...entries] : []);
		const entryIndexByEntry = new Map<TimelineEntry, number>(
			allEntries.map((entry, index) => [entry, index])
		);

		const timelineFile = timelineManager.getTimelineFile(bookFolder);
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
				new Notice(t('common.file-not-found', { name: t('common.default-timeline-filename') }));
				return;
			}
			const content = await app.vault.cachedRead(timelineFile);
			const matchStartGlobal = timelineManager.findEntryHeadingOffset(content, entryIndex, bookFolder);
			const fallbackLine = matchStartGlobal === undefined ? undefined : content.slice(0, matchStartGlobal).split('\n').length - 1;
			await smartLocateAndHighlight(
				app,
				timelineFile,
				[`## ${entry.time}`, `# ${entry.time}`, entry.time],
				{ splitIfNew: true, fallbackLine, matchStartGlobal }
			);
		};

		if (isTrajectoryMode) {
			renderTrajectoryMode({
				sourceLeaf: options.sourceLeaf,
				app,
				container,
				displayEntries,
				allTypes: [...new Set([
					...(plugin.settings.timeline?.defaultTypes || []),
					...allEntries.map(entry => entry.type || t('trajectory.main-type'))
				])],
				resolveLinkToFile,
				allEntries,
				onUpdateEntry: async (index: number, entry: TimelineEntry) => {
					await timelineManager.updateEntry(index, entry, bookFolder);
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
						const chaps = item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
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
					const chaps = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
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

		// Handle drag and drop logic
		const handleDrop = async (e: DragEvent, targetEvents: { time: string, entryIndex: number, itemIndex?: number }[]) => {
			e.preventDefault();
			e.stopPropagation();
			const path = e.dataTransfer?.getData('application/wn-chapter-path') || e.dataTransfer?.getData('text/plain');
			if (!path) return;
			const targetFile = app.vault.getAbstractFileByPath(path);
			if (targetFile instanceof TFile) {
				onSaveStateChange(true);
				try {
					await timelineManager.syncChapterToEventItem(targetFile, targetEvents, bookFolder);
				} catch (err) {
					Logger.error('[TimelineBoard] syncChapterToEventItem 失败:', err);
				} finally {
					onSaveStateChange(false);
					reloadBoard();
				}
			}
		};

		const setupDropzone = (el: HTMLElement, targetEvents: { time: string, entryIndex: number, itemIndex?: number }[]) => {
			let dragCounter = 0;
			let isInsertAfter = false; // Track whether to insert after (bottom half)

			el.addEventListener('dragenter', (e) => {
				if (el.hasClass('wn-timeline-gap') && e.dataTransfer?.types.includes('application/wn-timeline-event-time')) {
					return; // Gaps do not accept event cards
				}
				e.preventDefault();
				dragCounter++;
			});
			el.addEventListener('dragover', (e) => {
				if (el.hasClass('wn-timeline-gap') && e.dataTransfer?.types.includes('application/wn-timeline-event-time')) {
					return; // Gaps do not accept event cards
				}
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

				if (e.dataTransfer?.types.includes('application/wn-timeline-event-time')) {
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
						el.addClass('drag-over-event'); // fallback for gaps
					}
				} else if (e.dataTransfer?.types.includes('application/wn-chapter-path')) {
					el.addClass('drag-over-chapter');
				} else {
					el.addClass('drag-over');
				}
			});
			el.addEventListener('dragleave', (e) => {
				if (el.hasClass('wn-timeline-gap') && e.dataTransfer?.types.includes('application/wn-timeline-event-time')) {
					return;
				}
				dragCounter--;
				if (dragCounter <= 0) {
					dragCounter = 0;
					el.removeClass('drag-over-event');
					el.removeClass('drag-over-event-top');
					el.removeClass('drag-over-event-bottom');
					el.removeClass('drag-over-chapter');
					el.removeClass('drag-over');
				}
			});

			el.addEventListener('drop', (e) => {
				if (el.hasClass('wn-timeline-gap') && e.dataTransfer?.types.includes('application/wn-timeline-event-time')) {
					return;
				}
				dragCounter = 0;
				el.removeClass('drag-over-event');
				el.removeClass('drag-over-event-top');
				el.removeClass('drag-over-event-bottom');
				el.removeClass('drag-over-chapter');
				el.removeClass('drag-over');
				
				if (e.dataTransfer?.types.includes('application/wn-timeline-event-time')) {
					const sourceEntryIndex = Number(e.dataTransfer.getData('application/wn-timeline-entry-index'));
					const sourceIdxStr = e.dataTransfer.getData('application/wn-timeline-event-index');
					if (Number.isInteger(sourceEntryIndex) && sourceEntryIndex >= 0 && sourceIdxStr && targetEvents.length > 0) {
						e.preventDefault();
						e.stopPropagation();
						const sourceIdx = parseInt(sourceIdxStr);
						
						let targetIdx = targetEvents[0].itemIndex ?? 0;
						if (targetIdx !== undefined && isInsertAfter) {
							targetIdx += 1;
						}
						
						// If trying to move to its own current position or the exact same spot after removal
						if (sourceEntryIndex === targetEvents[0].entryIndex &&
						   (sourceIdx === targetIdx || sourceIdx === targetIdx - 1)) {
							return; 
						}

						void (async () => {
							onSaveStateChange(true);
							try {
								await timelineManager.moveEventItem(sourceEntryIndex, sourceIdx, targetEvents[0].entryIndex, targetIdx, bookFolder);
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

				void handleDrop(e, targetEvents);
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
			for (let i = 0; i < displayEntries.length; i++) {
				const entry = displayEntries[i];
				const entryIndex = entryIndexByEntry.get(entry);
				if (entryIndex === undefined) continue;

				// 1. The main node container
				const nodeDiv = mainCol.createDiv('wn-timeline-node');
				const titleDiv = nodeDiv.createDiv({ cls: 'wn-timeline-node-title' });
				if (entry.type) titleDiv.createSpan({ text: entry.type, cls: 'wn-timeline-type-badge' });
				if (entry.lores && entry.lores.length > 0) {
					const loreContainer = titleDiv.createSpan({ cls: 'wn-timeline-node-lore-badges' });
					renderLoreBadges(loreContainer, entry.lores, bookFolder, plugin, true, 0);
				}
				const timeSpan = titleDiv.createSpan({ cls: 'wn-timeline-node-time-text', text: entry.time });
				timeSpan.title = t('common.jump-to-entry');
				timeSpan.onclick = async (e) => {
					e.stopPropagation();
					await openTimelineEntry(entry, entryIndex);
				};

				// 2. Render each item row (sub-lane)
				const items: TimelineItem[] = entry.items && entry.items.length > 0
					? entry.items
					: [{ description: entry.description, chapter: entry.chapter, important: entry.important }];
				const visibleItemIndices = items.map((_item, index) => index);

				for (let visibleIndex = 0; visibleIndex < visibleItemIndices.length; visibleIndex++) {
					const itemIdx = visibleItemIndices[visibleIndex];
					const itemRow = nodeDiv.createDiv('wn-timeline-item-row');
					itemRow.setAttribute('draggable', 'true');
					itemRow.addEventListener('dragstart', (e) => {
						if (e.dataTransfer) {
							e.dataTransfer.effectAllowed = 'move';
							e.dataTransfer.setData('application/wn-timeline-event-time', entry.time);
							e.dataTransfer.setData('application/wn-timeline-entry-index', String(entryIndex));
							e.dataTransfer.setData('application/wn-timeline-event-index', itemIdx.toString());
							e.dataTransfer.setData('text/plain', `Event: ${entry.time}`);
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
							items[itemIdx].important = newImportant;
							const originalIndex = allEntries.indexOf(entry);
							onSaveStateChange(true);
							try {
								await timelineManager.updateEntry(originalIndex, entry, bookFolder);
							} catch (err) {
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
								onSaveStateChange(true);
								try {
									const originalIndex = allEntries.indexOf(entry);
									if (items.length <= 1) {
										await timelineManager.deleteEntry(originalIndex, bookFolder);
									} else {
										items.splice(itemIdx, 1);
										entry.items = items;
										await timelineManager.updateEntry(originalIndex, entry, bookFolder);
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

						descEl.focus({ preventScroll: true });
						const ownerDocument = descEl.ownerDocument;
						const selection = ownerDocument.defaultView?.getSelection();
						if (selection) {
							const range = ownerDocument.createRange();
							range.selectNodeContents(descEl);
							range.collapse(false);
							selection.removeAllRanges();
							selection.addRange(range);
						}

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

						let isSaving = false;
						const saveDesc = async () => {
							if (isSaving) return;
							isSaving = true;
							const newVal = getPlaintextContent(descEl).trim();
							if (newVal !== currentDesc) {
								onSaveStateChange(true);
								try {
									items[itemIdx].description = newVal;
									// Update the entry in manager
									if (!entry.items) {
										entry.description = newVal;
									}
									const originalIndex = allEntries.indexOf(entry);
									await timelineManager.updateEntry(originalIndex, entry, bookFolder);
								} catch (err) {
									Logger.error('[TimelineBoard] 更新描述失败:', err);
								} finally {
									onSaveStateChange(false);
								}
							}
							reloadBoard();
						};

						descEl.onblur = saveDesc;
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
						setupDropzone(subGapDiv, [{ time: entry.time, entryIndex, itemIndex: itemIdx }, { time: entry.time, entryIndex, itemIndex: nextItemIdx }]);

						const filesInSubGap = fileGroups.get(subGapKey) || [];
						CorkboardGridRenderer.render({
							app, plugin, container: subCardsContainer, files: filesInSubGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
						});
					}
				}

				// ⊕ Add sub-event button
				const addSubEventRow = nodeDiv.createDiv('wn-timeline-add-sub-event-row');
				const addSubEventBtn = addSubEventRow.createEl('button', { text: t('corkboard.new-timeline-event'), cls: 'wn-timeline-add-sub-event-btn' });
				addSubEventBtn.onclick = () => {
					addSubEventRow.hide();
					const itemRow = nodeDiv.insertBefore(createDiv('wn-timeline-item-row'), addSubEventRow);
					const descShell = itemRow.createDiv('wn-timeline-item-desc-shell');
					const descEl = descShell.createDiv({ cls: 'wn-timeline-item-desc is-editing' });
					setupStickyNoteParagraphEditor(descEl, '');
					itemRow.createDiv('wn-timeline-cards-container');

					descEl.focus({ preventScroll: true });

					let isComposing = false;
					descEl.addEventListener('compositionstart', () => {
						isComposing = true;
					});
					descEl.addEventListener('compositionend', () => {
						isComposing = false;
					});

					let isSaving = false;
					const saveSubEvent = async () => {
						if (isSaving) return;
						isSaving = true;
						const newVal = getPlaintextContent(descEl).trim();
						if (newVal) {
							if (!entry.items) {
								entry.items = [{
									description: entry.description || '',
									chapter: entry.chapter || '',
									important: entry.important
								}];
							}
							entry.items.push({
								description: newVal,
								chapter: ''
							});
							const originalIndex = allEntries.indexOf(entry);
							onSaveStateChange(true);
							try {
								await timelineManager.updateEntry(originalIndex, entry, bookFolder);
							} catch (err) {
								Logger.error('[TimelineBoard] 添加子事件失败:', err);
							} finally {
								onSaveStateChange(false);
							}
						}
						reloadBoard();
					};

					descEl.onblur = saveSubEvent;
					descEl.onkeydown = (e: KeyboardEvent) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							if (isComposing || e.isComposing || (e as { keyCode?: number }).keyCode === 229) {
								return;
							}
							e.preventDefault();
							descEl.blur();
						}
					};
				};

				// 3. Render Gap to next event if exists
				if (i < displayEntries.length - 1) {
					const nextEntry = displayEntries[i + 1];
					const nextEntryIndex = entryIndexByEntry.get(nextEntry);
					const gapKey = `GAP|${entryIndex}|${nextEntryIndex ?? -1}`;

					const gapDiv = mainCol.createDiv('wn-timeline-gap');
					const cardsContainer = gapDiv.createDiv('wn-timeline-cards-container');
					setupDropzone(gapDiv, [{ time: entry.time, entryIndex, itemIndex: items.length - 1 }, { time: nextEntry.time, entryIndex: nextEntryIndex ?? -1, itemIndex: 0 }]);

					const filesInGap = fileGroups.get(gapKey) || [];
					CorkboardGridRenderer.render({
						app, plugin, container: cardsContainer, files: filesInGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
					});
				}
			}
		} else {
			mainCol.addClass('is-empty');
			const emptyMsg = mainCol.createDiv('wn-timeline-empty-msg');
			emptyMsg.setText(t('corkboard.no-timeline'));
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
						new Notice(msg.replace('{name}', tlFile.path));
					}
				} catch (e) {
					console.error('[TimelineBoardRenderer] 创建时间线文件失败:', e);
					new Notice(t('notice.timeline-file-create-failed'));
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
						onSaveStateChange(true);
						try {
							await timelineManager.appendEntry(entry, bookFolder);
							new Notice(t('notice.timeline-added'));
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

		const isPhone = container.ownerDocument.body.classList.contains('is-phone');

		if (isSidebarCollapsed && !isPhone) {
			sideCol.addClass('is-collapsed');
		}

		const toggleCollapse = (event?: Event) => {
			if (event) {
				event.stopPropagation();
			}
			if (onToggleSidebarCollapse) {
				onToggleSidebarCollapse();
			}
		};

		if (!isPhone) {
			const expandHandle = sideCol.createDiv('clickable-icon wn-timeline-sidebar-expand-handle');
			expandHandle.setAttr('role', 'button');
			expandHandle.setAttr('tabindex', '0');
			expandHandle.setAttr('aria-label', t('corkboard.expand-sidebar'));
			setIcon(expandHandle, 'chevron-left');
			expandHandle.onclick = (e) => toggleCollapse(e);
			expandHandle.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					event.stopPropagation();
					toggleCollapse(event);
				}
			});
		}

		// Sidebar: Unscheduled (未关联章节侧边栏/底部悬浮抽屉窗)
		const unscheduledHeader = sideCol.createDiv('wn-timeline-sidebar-header');
		const titleGroup = unscheduledHeader.createDiv('wn-timeline-sidebar-title-group');
		if (!isPhone) {
			const collapseBtn = titleGroup.createDiv('clickable-icon wn-timeline-sidebar-collapse-btn');
			collapseBtn.setAttr('role', 'button');
			collapseBtn.setAttr('tabindex', '0');
			collapseBtn.setAttr('aria-label', t('corkboard.collapse-sidebar'));
			setIcon(collapseBtn, 'chevron-right');
			collapseBtn.onclick = (e) => toggleCollapse(e);
			collapseBtn.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					event.stopPropagation();
					toggleCollapse(event);
				}
			});
		} else {
			const iconSpan = titleGroup.createSpan({ cls: 'wn-timeline-sidebar-icon' });
			setIcon(iconSpan, 'help-circle');
		}
		titleGroup.createSpan({ text: t('corkboard.unscheduled-chapters') });
		// 始终展示未关联章节的数量（包含 0），提升作者概览与归还槽感知
		titleGroup.createSpan({ text: ` (${unscheduled.length})`, cls: 'wn-timeline-sidebar-count' });

		const sortToggle = unscheduledHeader.createDiv('clickable-icon wn-workbench-sort-toggle');
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

		setupDropzone(sideCol, []); // Drag back to sidebar to remove timeline
		const sideGrid = sideCol.createDiv('wn-corkboard-grid');

		if (unscheduled.length === 0) {
			sideCol.addClass('is-empty');
		}

		const displayUnscheduled = getDeterministicChapterDisplayOrder(unscheduled, {
			currentBookPath,
			isDescending: !!isUnscheduledDescending,
			enableSmartChapterSort: plugin.settings.enableSmartChapterSort,
			customSortOrder: plugin.settings.customSortOrder
		});

		CorkboardGridRenderer.render({
			app, plugin, container: sideGrid, files: displayUnscheduled, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange,
			groupVolumeCards: isPhone
		});

		Logger.info(`[Perf] TimelineBoardRenderer.render completed in ${(performance.now() - tStart).toFixed(2)}ms (${displayEntries.length} entries, ${files.length} total files, ${unscheduled.length} unscheduled)`);
	}
}
