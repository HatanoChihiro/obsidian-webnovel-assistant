import type { App, Component } from 'obsidian';
import { setIcon, TFile, Notice, Modal } from 'obsidian';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import type { TimelineManager } from '../../services/TimelineManager';
import { CorkboardGridRenderer } from './CorkboardGridRenderer';
import { TimelineAddModal } from '../TimelineAddModal';
import { t } from '../../i18n';
import { Logger } from '../../utils/Logger';
import { smartLocateAndHighlight } from '../../utils/leaf';
import type { TimelineFormContext, TimelineFormSettings } from './TimelineFormComponent';
import type { ChapterCardPlugin } from './ChapterCard';
import type { AccurateCountSettings } from '../../types/settings';

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

export type TimelineBoardTimelineManager = Pick<
	TimelineManager,
	| 'currentFolder'
	| 'loadEntries'
	| 'getTimelineFile'
	| 'syncChapterToEventItem'
	| 'moveEventItem'
	| 'deleteEntry'
	| 'updateEntry'
	| 'getTimelineFilePath'
	| 'appendEntry'
>;

export type TimelineBoardSettings = TimelineFormSettings &
	Pick<AccurateCountSettings, 'enableMobileLorePopover' | 'lorePopoverCollapse'>;

export interface TimelineBoardPlugin
	extends Omit<TimelineFormContext, 'settings'>,
		Omit<ChapterCardPlugin, 'settings'> {
	settings: TimelineBoardSettings;
	timelineManager: TimelineBoardTimelineManager;
}

export interface TimelineBoardOptions {
	app: App;
	plugin: TimelineBoardPlugin;
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

		const tStart = performance.now();
		const timelineManager = plugin.timelineManager;
		timelineManager.currentFolder = currentBookPath === '/' ? '' : (currentBookPath || '');
		let entries = await timelineManager.loadEntries();
		const tEntries = performance.now();
		Logger.info(`[Perf Phase] Timeline.loadEntries: ${(tEntries - tStart).toFixed(2)}ms`);

		const allEntries = entries ? [...entries] : [];

		if (entries && currentTimelineFilter && currentTimelineFilter !== 'all') {
			entries = entries.filter(e => e.type === currentTimelineFilter);
		}

		const timelineFile = timelineManager.getTimelineFile();

		const linkKeyCache = new Map<string, string>();

		// Helper to extract the basename of a link path or alias (e.g. "Folder/Chap|Alias" -> "Chap")
		const getLinkBasename = (link: string): string => {
			const pathPart = link.split('|')[0].trim();
			const lastSlash = pathPart.lastIndexOf('/');
			return lastSlash !== -1 ? pathPart.substring(lastSlash + 1) : pathPart;
		};

		// Helper to resolve link key (lowercased and trimmed basename of resolved file, or fallback to link basename)
		const resolveLinkKey = (link: string): string => {
			const linkpath = link.split('|')[0].trim();
			if (linkKeyCache.has(linkpath)) return linkKeyCache.get(linkpath)!;

			let resolvedKey = '';
			if (timelineFile) {
				const dest = app.metadataCache.getFirstLinkpathDest(linkpath, timelineFile.path);
				if (dest) {
					resolvedKey = dest.basename.toLowerCase().trim();
				}
			}
			if (!resolvedKey) {
				resolvedKey = getLinkBasename(link).toLowerCase().trim();
			}
			linkKeyCache.set(linkpath, resolvedKey);
			return resolvedKey;
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

		const tLinkResolve = performance.now();
		Logger.info(`[Perf Phase] Timeline.linkResolution: ${(tLinkResolve - tEntries).toFixed(2)}ms`);

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
				const timeSpan = titleDiv.createSpan({ cls: 'wn-timeline-node-time-text', text: entry.time });
				timeSpan.title = t('common.jump-to-entry');
				timeSpan.onclick = async (e) => {
					e.stopPropagation();
					if (!timelineFile) {
						new Notice(t('common.file-not-found', { name: t('common.default-timeline-filename') }));
						return;
					}
					const fileCache = app.metadataCache.getFileCache(timelineFile);
					let fallbackLine: number | undefined;
					if (fileCache?.headings) {
						for (const h of fileCache.headings) {
							if (h.heading.trim() === entry.time.trim()) {
								fallbackLine = h.position.start.line;
								break;
							}
						}
					}
					await smartLocateAndHighlight(
						app,
						timelineFile,
						[`## ${entry.time}`, `# ${entry.time}`, entry.time],
						{ splitIfNew: true, fallbackLine }
					);
				};

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
						descEl.addClass('is-editing');
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
					descEl.addClass('is-editing');
					itemRow.createDiv('wn-timeline-cards-container');

					const textarea = descEl.createEl('textarea', { cls: 'wn-corkboard-textarea' });
					textarea.focus();
					textarea.setCssProps({ height: 'auto' });
					textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
					textarea.oninput = () => {
						textarea.setCssProps({ height: 'auto' });
						textarea.setCssProps({ height: textarea.scrollHeight + 'px' });
					};
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
			const bgSvgLayer = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'svg');
			bgSvgLayer.classList.add('wn-timeline-svg-layer');
			waterfallLayout.appendChild(bgSvgLayer);

			// --- SVG Link Layer (Foreground) ---
			const fgSvgLayer = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'svg');
			fgSvgLayer.classList.add('wn-timeline-svg-layer-fg');
			waterfallLayout.appendChild(fgSvgLayer);

			let lastLinksHash = '';

			const drawLinks = () => {
				// 剪枝 1：若容器尚未插回 Live DOM 或宽度为 0，跳过昂贵的 reflow 计算
				if (!waterfallLayout.isConnected || waterfallLayout.clientWidth === 0) return;

				// ===== Phase 1: 纯读取阶段 =====
				// 在任何 DOM 写入操作之前，批量收集所有布局数据（getBoundingClientRect）。
				// 避免"写→读→写→读"交替模式触发的 forced layout reflow，
				// 将多次昂贵的强制布局计算合并为一次自然的批量读取。

				// 构建 O(1) 的卡片元素索引
				const localCardElMap = new Map<string, HTMLElement>();
				mainCol.querySelectorAll('.wn-corkboard-card').forEach(el => {
					const db = el.getAttribute('data-basename');
					if (db) localCardElMap.set(db.toLowerCase().trim(), el as HTMLElement);
				});

				// 构建 O(1) 的事件行元素索引（key = "time|itemIndex"）
				const rowElMap = new Map<string, HTMLElement>();
				mainCol.querySelectorAll('[data-time][data-item-index]').forEach(el => {
					const time = el.getAttribute('data-time');
					const idx = el.getAttribute('data-item-index');
					if (time !== null && idx !== null) {
						rowElMap.set(`${time}|${idx}`, el as HTMLElement);
					}
				});

				// 一次性读取容器 rect（单次 reflow，所有后续计算基于此快照）
				const layoutRect = waterfallLayout.getBoundingClientRect();

				// 收集所有待绘制连线的数据（纯读，不写 DOM）
				type LinkData = { startX: number; startY: number; endX: number; endY: number; isHovered: boolean; };
				const links: LinkData[] = [];

				for (const [basename, events] of chapterToEventMap.entries()) {
					if (events.length <= 1) continue;

					const cardEl = localCardElMap.get(basename);
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
							const rowKey = `${targetEvt.time}|${targetEvt.itemIndex ?? 0}`;
							const targetRowEl = rowElMap.get(rowKey);
							if (targetRowEl && targetRowEl.matches(':hover')) {
								isHovered = true;
								break;
							}
						}
					}

					for (let i = 1; i < events.length; i++) {
						const targetEvt = events[i];
						const rowKey = `${targetEvt.time}|${targetEvt.itemIndex ?? 0}`;
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

				const bgFrag = createFragment();
				const fgFrag = createFragment();

				for (const { startX, startY, endX, endY, isHovered } of links) {
					const targetFrag = isHovered ? fgFrag : bgFrag;

					const path = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'path');
					path.setAttribute('d', `M ${endX} ${endY} C ${endX + 50} ${endY}, ${startX - 50} ${startY}, ${startX} ${startY}`);
					path.setAttribute('fill', 'none');
					path.setAttribute('class', isHovered ? 'wn-timeline-svg-path is-hovered' : 'wn-timeline-svg-path');

					const arrow = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'polygon');
					arrow.setAttribute('points', '-6,-3 0,0 -6,3');
					arrow.setAttribute('transform', `translate(${startX}, ${startY})`);
					arrow.setAttribute('class', isHovered ? 'wn-timeline-svg-arrow is-hovered' : 'wn-timeline-svg-arrow');

					const dot = activeDocument['createElementNS']('http://www.w3.org/2000/svg', 'circle');
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
			const scheduleDrawLinks = () => {
				if (scheduled) return;
				scheduled = true;
				window.requestAnimationFrame(() => {
					scheduled = false;
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

				// 构建 O(1) 的卡片元素索引，避免 O(N²) 的全量扫描
				const hoverCardElMap = new Map<string, HTMLElement>();
				mainCol.querySelectorAll('.wn-corkboard-card').forEach(el => {
					const db = el.getAttribute('data-basename');
					if (db) hoverCardElMap.set(db.toLowerCase().trim(), el as HTMLElement);
				});

				for (const [basename, events] of chapterToEventMap.entries()) {
					if (events.length <= 1) continue;
					const cardEl = hoverCardElMap.get(basename);

					const targetEls: HTMLElement[] = [];
					if (cardEl) targetEls.push(cardEl);

					for (let i = 1; i < events.length; i++) {
						const targetEvt = events[i];
						const targetRowEl = mainCol.querySelector(`[data-time="${targetEvt.time}"][data-item-index="${targetEvt.itemIndex ?? 0}"]`);
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
		const iconSpan = titleGroup.createSpan({ cls: 'wn-timeline-sidebar-icon' });
		setIcon(iconSpan, 'help-circle');
		titleGroup.createSpan({ text: t('corkboard.unscheduled-chapters') });
		// 始终展示未关联章节的数量（包含 0），提升作者概览与归还槽感知
		titleGroup.createSpan({ text: ` (${unscheduled.length})`, cls: 'wn-timeline-sidebar-count' });

		setupDropzone(sideCol, []); // Drag back to sidebar to remove timeline
		const sideGrid = sideCol.createDiv('wn-corkboard-grid');

		if (unscheduled.length === 0) {
			sideCol.addClass('is-empty');
		}

		CorkboardGridRenderer.render({
			app, plugin, container: sideGrid, files: unscheduled, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange,
			groupVolumeCards: container.ownerDocument.body.classList.contains('is-phone')
		});

		Logger.info(`[Perf] TimelineBoardRenderer.render completed in ${(performance.now() - tStart).toFixed(2)}ms (${entries?.length || 0} entries, ${files.length} total files, ${unscheduled.length} unscheduled)`);
	}
}
