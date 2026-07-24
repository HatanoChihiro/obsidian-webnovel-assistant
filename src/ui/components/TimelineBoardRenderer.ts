import type { App, Component } from 'obsidian';
import { setIcon, TFile, Notice, Modal } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import { TimelineManager } from '../../services/TimelineManager';
import { CorkboardGridRenderer } from './CorkboardGridRenderer';
import { TimelineAddModal } from '../TimelineAddModal';
import { t } from '../../i18n';
import { Logger } from '../../utils/Logger';

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

export interface TimelineBoardOptions {
	app: App;
	plugin: WebNovelAssistantPlugin;
	ownerComponent?: Component;
	container: HTMLElement;
	files: TFile[];
	foreshadowingMap: Map<string, ParsedForeshadowingEntry[]>;
	currentBookPath: string;
	currentTimelineFilter: string;
	onSaveStateChange: (isSaving: boolean) => void;
	reloadBoard: () => void;
	getChapterEvents: (file: TFile, fallbackMap: Map<string, string[]>) => string[];
}

export class TimelineBoardRenderer {
	static async render(options: TimelineBoardOptions): Promise<void> {
		const { app, plugin, container, files, foreshadowingMap, currentBookPath, currentTimelineFilter, onSaveStateChange, reloadBoard, getChapterEvents } = options;

		const timelineManager = new TimelineManager(app, plugin, currentBookPath === '/' ? '' : (currentBookPath || ''));
		let entries = await timelineManager.loadEntries();
		const allEntries = entries ? [...entries] : [];

		if (entries && currentTimelineFilter && currentTimelineFilter !== 'all') {
			entries = entries.filter(e => e.type === currentTimelineFilter);
		}

		// Helper to extract the basename of a link path or alias (e.g. "Folder/Chap|Alias" -> "Chap")
		const getLinkBasename = (link: string): string => {
			const pathPart = link.split('|')[0].trim();
			const lastSlash = pathPart.lastIndexOf('/');
			return lastSlash !== -1 ? pathPart.substring(lastSlash + 1) : pathPart;
		};

		// Helper to resolve link key (lowercased and trimmed basename of resolved file, or fallback to link basename)
		const resolveLinkKey = (link: string): string => {
			const linkpath = link.split('|')[0].trim();
			const timelineFile = timelineManager.getTimelineFile();
			if (timelineFile) {
				const dest = app.metadataCache.getFirstLinkpathDest(linkpath, timelineFile.path);
				if (dest) {
					return dest.basename.toLowerCase().trim();
				}
			}
			return getLinkBasename(link).toLowerCase().trim();
		};

		// Find chapters mapped to each event -> itemIndex. Keys are lowercased and trimmed basenames.
		const chapterToEventMap = new Map<string, { time: string, itemIndex: number }[]>();

		if (entries) {
			for (const entry of entries) {
				if (entry.items && entry.items.length > 0) {
					for (let i = 0; i < entry.items.length; i++) {
						const item = entry.items[i];
						const chaps = item.chapter.split(',').map(c => c.trim()).filter(Boolean);
						for (const c of chaps) {
							const baseKey = resolveLinkKey(c);
							if (!chapterToEventMap.has(baseKey)) {
								chapterToEventMap.set(baseKey, []);
							}
							const list = chapterToEventMap.get(baseKey)!;
							if (!list.find(m => m.time === entry.time && m.itemIndex === i)) {
								list.push({ time: entry.time, itemIndex: i });
							}
						}
					}
				} else if (entry.chapter) {
					const chaps = entry.chapter.split(',').map(c => c.trim()).filter(Boolean);
					for (const c of chaps) {
						const baseKey = resolveLinkKey(c);
						if (!chapterToEventMap.has(baseKey)) {
							chapterToEventMap.set(baseKey, []);
						}
						const list = chapterToEventMap.get(baseKey)!;
						if (!list.find(m => m.time === entry.time && m.itemIndex === 0)) {
							list.push({ time: entry.time, itemIndex: 0 });
						}
					}
				}
			}
		}

		// Waterfall Layout
		const waterfallLayout = container.createDiv('wn-timeline-waterfall-layout');
		const mainCol = waterfallLayout.createDiv('wn-timeline-waterfall-main');
		const sideCol = waterfallLayout.createDiv('wn-timeline-waterfall-sidebar');

		// Handle drag and drop logic
		const handleDrop = async (e: DragEvent, targetEvents: { time: string, itemIndex?: number }[]) => {
			e.preventDefault();
			e.stopPropagation();
			const path = e.dataTransfer?.getData('application/wn-chapter-path') || e.dataTransfer?.getData('text/plain');
			if (!path) return;
			const targetFile = app.vault.getAbstractFileByPath(path);
			if (targetFile instanceof TFile) {
				const fileKey = targetFile.basename.toLowerCase().trim();
				// 1. Update frontmatter
				const eventNames = targetEvents.map(te => te.time);
				onSaveStateChange(true);
				await app.fileManager.processFrontMatter(targetFile, (fm: Record<string, unknown>) => {
					fm['timeline'] = eventNames.length > 0 ? eventNames : null;
				});

				// 2. Call TimelineManager.syncChapterToEventItem
				if (targetEvents.length > 0 || chapterToEventMap.has(fileKey)) {
					await timelineManager.syncChapterToEventItem(targetFile.basename, targetEvents);
				}

				// Delay to allow Obsidian to process frontmatter before reloading
				window.setTimeout(() => {
					onSaveStateChange(false);
					reloadBoard();
				}, 500);
			}
		};

		const setupDropzone = (el: HTMLElement, targetEvents: { time: string, itemIndex?: number }[]) => {
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
					const sourceTime = e.dataTransfer.getData('application/wn-timeline-event-time');
					const sourceIdxStr = e.dataTransfer.getData('application/wn-timeline-event-index');
					if (sourceTime && sourceIdxStr && targetEvents.length > 0) {
						e.preventDefault();
						e.stopPropagation();
						const sourceIdx = parseInt(sourceIdxStr);
						
						let targetIdx = targetEvents[0].itemIndex ?? 0;
						if (targetIdx !== undefined && isInsertAfter) {
							targetIdx += 1;
						}
						
						// If trying to move to its own current position or the exact same spot after removal
						if (sourceTime === targetEvents[0].time && 
						   (sourceIdx === targetIdx || sourceIdx === targetIdx - 1)) {
							return; 
						}

						void (async () => {
							if (onSaveStateChange) onSaveStateChange(true);
							await timelineManager.moveEventItem(sourceTime, sourceIdx, targetEvents[0].time, targetIdx);
							if (onSaveStateChange) onSaveStateChange(false);
							reloadBoard();
						})();
					}
					return;
				}

				void handleDrop(e, targetEvents);
			});
		};

		// Determine where each file goes
		const unscheduled: TFile[] = [];
		const fileGroups = new Map<string, TFile[]>(); // Key is "time|itemIndex" or "GAP|time1|time2"

		for (const file of files) {
			let eventsFromMD = chapterToEventMap.get(file.basename.toLowerCase().trim()) || [];

			if (eventsFromMD.length === 0) {
				const fmEvents = getChapterEvents(file, new Map()); // pass empty map to only get FM
				eventsFromMD = fmEvents.map(time => ({ time, itemIndex: 0 }));
			}

			if (eventsFromMD.length === 0) {
				unscheduled.push(file);
			} else if (eventsFromMD.length === 2) {
				const e1 = eventsFromMD[0];
				const e2 = eventsFromMD[1];
				let isAdjacent = false;
				
				if (e1.time === e2.time) {
					isAdjacent = Math.abs((e1.itemIndex || 0) - (e2.itemIndex || 0)) === 1;
					if (isAdjacent) {
						const minIdx = Math.min(e1.itemIndex || 0, e2.itemIndex || 0);
						const maxIdx = Math.max(e1.itemIndex || 0, e2.itemIndex || 0);
						const key = `GAP|${e1.time}|${minIdx}|${maxIdx}`;
						if (!fileGroups.has(key)) fileGroups.set(key, []);
						fileGroups.get(key)!.push(file);
						continue;
					}
				} else {
					const idx1 = entries?.findIndex(e => e.time === e1.time) ?? -1;
					const idx2 = entries?.findIndex(e => e.time === e2.time) ?? -1;
					if (idx1 !== -1 && idx2 !== -1 && Math.abs(idx1 - idx2) === 1) {
						const firstIdx = Math.min(idx1, idx2);
						const secondIdx = Math.max(idx1, idx2);
						const firstEntry = entries![firstIdx];
						const firstItemCount = firstEntry.items && firstEntry.items.length > 0 ? firstEntry.items.length : 1;
						
						const firstEvt = firstIdx === idx1 ? e1 : e2;
						const secondEvt = firstIdx === idx1 ? e2 : e1;
						
						if ((firstEvt.itemIndex || 0) === firstItemCount - 1 && (secondEvt.itemIndex || 0) === 0) {
							isAdjacent = true;
							const key = `GAP|${firstEntry.time}|${entries![secondIdx].time}`;
							if (!fileGroups.has(key)) fileGroups.set(key, []);
							fileGroups.get(key)!.push(file);
							continue;
						}
					}
				}
				
				// Not adjacent exactly 2 events -> fallback to rendering in first event
				const firstEvent = eventsFromMD[0];
				const key = `${firstEvent.time}|${firstEvent.itemIndex}`;
				if (!fileGroups.has(key)) fileGroups.set(key, []);
				fileGroups.get(key)!.push(file);
			} else {
				// Render in the first event ONLY
				const firstEvent = eventsFromMD[0];
				const key = `${firstEvent.time}|${firstEvent.itemIndex}`;
				if (!fileGroups.has(key)) fileGroups.set(key, []);
				fileGroups.get(key)!.push(file);
			}
		}

		if (entries && entries.length > 0) {
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];

				// 1. The main node container
				const nodeDiv = mainCol.createDiv('wn-timeline-node');
				const titleDiv = nodeDiv.createDiv({ cls: 'wn-timeline-node-title' });
				if (entry.type) {
					titleDiv.createSpan({ text: entry.type, cls: 'wn-timeline-type-badge' });
				}
				titleDiv.createSpan({ text: entry.time });

				// 2. Render each item row (sub-lane)
				const items = entry.items && entry.items.length > 0 ? entry.items : [{ description: entry.description, chapter: entry.chapter }];

				for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
					const itemRow = nodeDiv.createDiv('wn-timeline-item-row');
					itemRow.setAttribute('draggable', 'true');
					itemRow.addEventListener('dragstart', (e) => {
						if (e.dataTransfer) {
							e.dataTransfer.effectAllowed = 'move';
							e.dataTransfer.setData('application/wn-timeline-event-time', entry.time);
							e.dataTransfer.setData('application/wn-timeline-event-index', itemIdx.toString());
							e.dataTransfer.setData('text/plain', `Event: ${entry.time}`);
						}
						window.setTimeout(() => itemRow.addClass('is-dragging'), 0);
					});
					itemRow.addEventListener('dragend', () => {
						itemRow.removeClass('is-dragging');
					});

					// Description box
					let descEl: HTMLElement;
					if (itemIdx === 0 || items[itemIdx].description) {
						descEl = itemRow.createDiv({ text: items[itemIdx].description || t('modal.describe-event-placeholder'), cls: 'wn-timeline-item-desc' });
					} else {
						descEl = itemRow.createDiv({ text: '', cls: 'wn-timeline-item-desc' });
					}

					// Delete button (内嵌在描述框内部，随描述框自适应宽度移动)
					const deleteBtn = descEl.createDiv({ cls: 'wn-timeline-item-delete-btn' });
					setIcon(deleteBtn, 'trash');
					deleteBtn.onclick = (e) => {
						e.stopPropagation();
						new ConfirmDeleteEventModal(app, t('modal.confirm-delete-event'), () => {
							void (async () => {
								if (onSaveStateChange) onSaveStateChange(true);

								// Determine which files to clean frontmatter for
								const eventTimeToRemove = entry.time;
								const filesToClean: TFile[] = [];
								if (items.length <= 1) {
									// Whole entry deleted
									for (const file of files) {
										const evts = chapterToEventMap.get(file.basename.toLowerCase().trim());
										if (evts && evts.some(e => e.time === eventTimeToRemove)) {
											filesToClean.push(file);
										}
									}
								} else {
									// Only itemIdx deleted
									for (const file of files) {
										const evts = chapterToEventMap.get(file.basename.toLowerCase().trim());
										if (evts && evts.some(e => e.time === eventTimeToRemove && e.itemIndex === itemIdx)) {
											filesToClean.push(file);
										}
									}
								}

								// Clean frontmatter
								for (const file of filesToClean) {
									try {
										await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
											if (fm['timeline']) {
												if (Array.isArray(fm['timeline'])) {
													const timelineArr = fm['timeline'] as string[];
													fm['timeline'] = timelineArr.filter(t => t !== eventTimeToRemove);
													if ((fm['timeline'] as string[]).length === 0) fm['timeline'] = null;
												} else if (fm['timeline'] === eventTimeToRemove) {
													fm['timeline'] = null;
												}
											}
										});
									} catch (err) {
										Logger.error(`[TimelineBoard] 清理 ${file.path} 的 frontmatter 失败:`, err);
									}
								}

								const originalIndex = allEntries.indexOf(entry);
								if (items.length <= 1) {
									await timelineManager.deleteEntry(originalIndex);
								} else {
									items.splice(itemIdx, 1);
									entry.items = items;
									await timelineManager.updateEntry(originalIndex, entry);
								}
								if (onSaveStateChange) onSaveStateChange(false);
								window.setTimeout(() => {
									reloadBoard();
								}, 200);
							})();
						}).open();
					};

					// Inline edit logic
					descEl.onclick = (e: MouseEvent) => {
						e.stopPropagation();
						if (descEl.querySelector('textarea')) return;
						const currentDesc = items[itemIdx].description || '';
						descEl.empty();
						const textarea = descEl.createEl('textarea', { cls: 'wn-corkboard-textarea' });
						textarea.value = currentDesc;
						textarea.focus();
						textarea.setSelectionRange(currentDesc.length, currentDesc.length);

						textarea.setCssProps({ height: 'auto' });
						textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
						textarea.oninput = () => {
							textarea.setCssProps({ height: 'auto' });
							textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
						};

						const saveDesc = async () => {
							const newVal = textarea.value.trim();
							if (newVal !== currentDesc) {
								if (onSaveStateChange) onSaveStateChange(true);
								items[itemIdx].description = newVal;
								// Update the entry in manager
								if (!entry.items) {
									entry.description = newVal;
								}
								const originalIndex = allEntries.indexOf(entry);
								await timelineManager.updateEntry(originalIndex, entry);
								if (onSaveStateChange) onSaveStateChange(false);
							}
							reloadBoard();
						};

						textarea.onblur = saveDesc;
					};

					// Cards container
					const cardsContainer = itemRow.createDiv('wn-timeline-cards-container');

					const key = `${entry.time}|${itemIdx}`;
					const filesInItem = fileGroups.get(key) || [];
					CorkboardGridRenderer.render({
						app, plugin, container: cardsContainer, files: filesInItem, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
					});

					// Setup dropzone for this itemRow
					setupDropzone(itemRow, [{ time: entry.time, itemIndex: itemIdx }]);
					itemRow.setAttribute('data-time', entry.time);
					itemRow.setAttribute('data-item-index', String(itemIdx));
					// Render sub-gap (gap between events in the same time node)
					if (itemIdx < items.length - 1) {
						const subGapKey = `GAP|${entry.time}|${itemIdx}|${itemIdx + 1}`;
						const subGapDiv = nodeDiv.createDiv('wn-timeline-gap wn-timeline-sub-gap');
						const subCardsContainer = subGapDiv.createDiv('wn-timeline-cards-container');
						setupDropzone(subGapDiv, [{ time: entry.time, itemIndex: itemIdx }, { time: entry.time, itemIndex: itemIdx + 1 }]);

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
					const descEl = itemRow.createDiv({ text: '', cls: 'wn-timeline-item-desc' });
					itemRow.createDiv('wn-timeline-cards-container');

					const textarea = descEl.createEl('textarea', { cls: 'wn-corkboard-textarea' });
					textarea.focus();
					textarea.onblur = async () => {
						const newVal = textarea.value.trim();
						if (newVal) {
							if (!entry.items) {
								entry.items = [{ description: entry.description || '', chapter: entry.chapter || '' }];
							}
							entry.items.push({ description: newVal, chapter: '' });
							const originalIndex = allEntries.indexOf(entry);
							if (onSaveStateChange) onSaveStateChange(true);
							await timelineManager.updateEntry(originalIndex, entry);
							if (onSaveStateChange) onSaveStateChange(false);
						}
						reloadBoard();
					};
					textarea.onkeydown = (e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							textarea.blur();
						}
					};
				};

				// 3. Render Gap to next event if exists
				if (i < entries.length - 1) {
					const nextEntry = entries[i + 1];
					const gapKey = `GAP|${entry.time}|${nextEntry.time}`;

					const gapDiv = mainCol.createDiv('wn-timeline-gap');
					const cardsContainer = gapDiv.createDiv('wn-timeline-cards-container');
					setupDropzone(gapDiv, [{ time: entry.time, itemIndex: items.length - 1 }, { time: nextEntry.time, itemIndex: 0 }]);

					const filesInGap = fileGroups.get(gapKey) || [];
					CorkboardGridRenderer.render({
						app, plugin, container: cardsContainer, files: filesInGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true, maxLoreLines: 1
					});
				}
			}
		} else {
			mainCol.addClass('is-empty');
			const emptyMsg = mainCol.createDiv('wn-timeline-empty-msg');
			emptyMsg.setCssStyles({
				color: 'var(--text-faint)',
				textAlign: 'center',
				padding: '40px 20px',
				fontStyle: 'italic'
			});
			emptyMsg.setText(t('corkboard.no-timeline'));
		}

		// --- SVG Link Layer (Background) ---
		const bgSvgLayer = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'svg');
		bgSvgLayer.classList.add('wn-timeline-svg-layer');
		waterfallLayout.appendChild(bgSvgLayer);
		bgSvgLayer.setCssStyles({
			position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
			pointerEvents: 'none', zIndex: '0'
		});

		// --- SVG Link Layer (Foreground) ---
		const fgSvgLayer = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'svg');
		fgSvgLayer.classList.add('wn-timeline-svg-layer-fg');
		waterfallLayout.appendChild(fgSvgLayer);
		fgSvgLayer.setCssStyles({
			position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
			pointerEvents: 'none', zIndex: '10'
		});

		const drawLinks = () => {
			bgSvgLayer.empty();
			fgSvgLayer.empty();
			const layoutRect = waterfallLayout.getBoundingClientRect();
			
			for (const [basename, events] of chapterToEventMap.entries()) {
				if (events.length <= 1) continue;
				
				// Find the card element anywhere in the column (basename key is already lowercased and trimmed)
				const cardEl = Array.from(mainCol.querySelectorAll('.wn-corkboard-card')).find(el => {
					const db = el.getAttribute('data-basename');
					return db && db.toLowerCase().trim() === basename;
				}) as HTMLElement;
				if (!cardEl) continue;

				// If it's in a gap, it's bridging exactly 2 adjacent events naturally, no lines needed.
				if (cardEl.closest('.wn-timeline-gap')) continue;

				const cardRect = cardEl.getBoundingClientRect();
				const startX = cardRect.left - layoutRect.left;
				const startY = cardRect.top + cardRect.height / 2 - layoutRect.top;

				// Check hover state
				let isHovered = cardEl.matches(':hover');
				if (!isHovered) {
					for (let i = 1; i < events.length; i++) {
						const targetEvt = events[i];
						const targetRowEl = mainCol.querySelector(`[data-time="${targetEvt.time}"][data-item-index="${targetEvt.itemIndex}"]`);
						if (targetRowEl && targetRowEl.matches(':hover')) {
							isHovered = true;
							break;
						}
					}
				}

				const targetLayer = isHovered ? fgSvgLayer : bgSvgLayer;

				for (let i = 1; i < events.length; i++) {
					const targetEvt = events[i];
					const targetRowEl = mainCol.querySelector(`[data-time="${targetEvt.time}"][data-item-index="${targetEvt.itemIndex}"]`);
					if (!targetRowEl) continue;

					const targetDescEl = targetRowEl.querySelector('.wn-timeline-item-desc');
					if (!targetDescEl) continue;

					const targetRect = targetDescEl.getBoundingClientRect();
					const endX = targetRect.right - layoutRect.left + 5; // A bit right of the description
					const endY = targetRect.top + targetRect.height / 2 - layoutRect.top;

					// Draw bezier curve from endX (event desc) to startX (chapter card)
					const path = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'path');
					path.setAttribute('d', `M ${endX} ${endY} C ${endX + 50} ${endY}, ${startX - 50} ${startY}, ${startX} ${startY}`);
					path.setAttribute('fill', 'none');
					
					path.setAttribute('class', isHovered ? 'wn-timeline-svg-path is-hovered' : 'wn-timeline-svg-path');

					// Add arrowhead at startX (pointing right to chapter card)
					const arrow = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'polygon');
					arrow.setAttribute('points', '-6,-3 0,0 -6,3');
					arrow.setAttribute('transform', `translate(${startX}, ${startY})`);
					arrow.setAttribute('class', isHovered ? 'wn-timeline-svg-arrow is-hovered' : 'wn-timeline-svg-arrow');

					// Add a dot at the event side (endX, endY)
					const dot = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'circle');
					dot.setAttribute('cx', `${endX}`);
					dot.setAttribute('cy', `${endY}`);
					dot.setAttribute('r', '3');
					dot.setAttribute('class', isHovered ? 'wn-timeline-svg-dot is-hovered' : 'wn-timeline-svg-dot');
					
					targetLayer.appendChild(path);
					targetLayer.appendChild(arrow);
					targetLayer.appendChild(dot);
				}
			}
		};

		let scheduled = false;
		const scheduleDrawLinks = () => {
			if (scheduled) return;
			scheduled = true;
			window.requestAnimationFrame(() => {
				scheduled = false;
				drawLinks();
			});
		};

		// 初次挂载后异步计算一次位置
		scheduleDrawLinks();

		// 监听容器滚动与鼠标悬停状态以按需绘制 SVG 连线
		mainCol.addEventListener('scroll', scheduleDrawLinks, { passive: true });
		sideCol.addEventListener('scroll', scheduleDrawLinks, { passive: true });
		mainCol.addEventListener('mouseover', scheduleDrawLinks, { passive: true });
		mainCol.addEventListener('mouseout', scheduleDrawLinks, { passive: true });

		let resizeObserver: ResizeObserver | null = typeof ResizeObserver !== 'undefined'
			? new ResizeObserver(() => scheduleDrawLinks())
			: null;
		if (resizeObserver) {
			resizeObserver.observe(waterfallLayout);
			resizeObserver.observe(mainCol);
		}

		const cleanup = () => {
			mainCol.removeEventListener('scroll', scheduleDrawLinks);
			sideCol.removeEventListener('scroll', scheduleDrawLinks);
			mainCol.removeEventListener('mouseover', scheduleDrawLinks);
			mainCol.removeEventListener('mouseout', scheduleDrawLinks);
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
			window.requestAnimationFrame(() => {
				if (waterfallLayout.parentElement) {
					observer.observe(waterfallLayout.parentElement, { childList: true });
				}
			});
		}

		// Add Timeline Node Button
		const addNodeRow = mainCol.createDiv('wn-timeline-add-node-row');
		const addNodeBtn = addNodeRow.createDiv({ cls: 'wn-timeline-add-node-btn' });
		addNodeBtn.textContent = t('corkboard.new-timeline-node');
		addNodeBtn.onclick = async () => {
			let timelineFile = timelineManager.getTimelineFile();
			if (!timelineFile) {
				// 自动创建时间线.md
				const newFilePath = timelineManager.getTimelineFilePath();
				try {
					timelineFile = await app.vault.create(newFilePath, '');
					const msg = t('notice.timeline-file-created');
					new Notice(msg.replace('{name}', newFilePath));
				} catch (e) {
					console.error('[TimelineBoardRenderer] 创建时间线文件失败:', e);
					new Notice(t('notice.timeline-file-create-failed'));
					return;
				}
			}
			const localTypes = [...new Set((allEntries).map(e => e.type).filter(Boolean))];

			const modal = new TimelineAddModal(
				app,
				plugin,
				'',
				'',
				currentBookPath === '/' ? '' : (currentBookPath || ''),
				(entry) => {
					void (async () => {
						try {
							await timelineManager.appendEntry(entry);
							new Notice(t('notice.timeline-added'));
							reloadBoard();
						} catch (e) {
							console.error('[TimelineBoardRenderer] 写入记录失败:', e);
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

		// Sidebar: Unscheduled (未关联章节侧边栏/底部悬浮抽屉窗)
		const unscheduledHeader = sideCol.createDiv('wn-timeline-sidebar-header');
		const titleGroup = unscheduledHeader.createDiv('wn-timeline-sidebar-title-group');
		setIcon(titleGroup.createSpan(), 'help-circle');
		titleGroup.createSpan({ text: t('corkboard.unscheduled-chapters') });
		// 始终展示未关联章节的数量（包含 0），提升作者概览与归还槽感知
		titleGroup.createSpan({ text: ` (${unscheduled.length})`, cls: 'wn-timeline-sidebar-count' });

		const toggleBtn = unscheduledHeader.createSpan('wn-timeline-sidebar-toggle-icon');
		setIcon(toggleBtn, 'chevron-down');

		// 点击头部支持展开/折叠未关联章节悬浮窗
		unscheduledHeader.onclick = (e) => {
			e.stopPropagation();
			const isCollapsed = sideCol.hasClass('is-collapsed');
			sideCol.toggleClass('is-collapsed', !isCollapsed);
			setIcon(toggleBtn, !isCollapsed ? 'chevron-up' : 'chevron-down');
		};

		setupDropzone(sideCol, []); // Drag back to sidebar to remove timeline
		const sideGrid = sideCol.createDiv('wn-corkboard-grid');

		if (unscheduled.length === 0) {
			sideCol.addClass('is-empty');
		}

		CorkboardGridRenderer.render({
			app, plugin, container: sideGrid, files: unscheduled, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange
		});
	}
}
