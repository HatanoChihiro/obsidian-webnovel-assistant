import type { App } from 'obsidian';
import { setIcon, TFile, Notice, Modal } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import type { ParsedForeshadowingEntry } from '../../types/foreshadowing';
import { TimelineManager } from '../../services/TimelineManager';
import { CorkboardGridRenderer } from './CorkboardGridRenderer';
import { TimelineAddModal } from '../TimelineAddModal';
import { t } from '../../i18n';

class ConfirmDeleteEventModal extends Modal {
	constructor(app: App, private title: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ text: this.title, cls: 'modal-title' });

		const btnContainer = contentEl.createDiv({ cls: 'wn-base-button-container' });
		
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') || '取消' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = btnContainer.createEl('button', { text: t('common.confirm') || '确定', cls: 'mod-warning' });
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

		// Find chapters mapped to each event -> itemIndex
		const chapterToEventMap = new Map<string, { time: string, itemIndex: number }[]>();

		if (entries) {
			for (const entry of entries) {
				if (entry.items && entry.items.length > 0) {
					for (let i = 0; i < entry.items.length; i++) {
						const item = entry.items[i];
						const chaps = item.chapter.split(',').map(c => c.trim()).filter(Boolean);
						for (const c of chaps) {
							if (!chapterToEventMap.has(c)) {
								chapterToEventMap.set(c, []);
							}
							const list = chapterToEventMap.get(c)!;
							if (!list.find(m => m.time === entry.time && m.itemIndex === i)) {
								list.push({ time: entry.time, itemIndex: i });
							}
						}
					}
				} else if (entry.chapter) {
					const chaps = entry.chapter.split(',').map(c => c.trim()).filter(Boolean);
					for (const c of chaps) {
						if (!chapterToEventMap.has(c)) {
							chapterToEventMap.set(c, []);
						}
						const list = chapterToEventMap.get(c)!;
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
			const path = e.dataTransfer?.getData('application/wn-chapter-path') || e.dataTransfer?.getData('text/plain');
			if (!path) return;
			const targetFile = app.vault.getAbstractFileByPath(path);
			if (targetFile instanceof TFile) {
				// 1. Update frontmatter
				const eventNames = targetEvents.map(te => te.time);
				onSaveStateChange(true);
				await app.fileManager.processFrontMatter(targetFile, (fm: Record<string, unknown>) => {
					fm['timeline'] = eventNames.length > 0 ? eventNames : null;
				});

				// 2. Call TimelineManager.syncChapterToEventItem
				if (targetEvents.length > 0 || chapterToEventMap.has(targetFile.basename)) {
					await timelineManager.syncChapterToEventItem(targetFile.basename, targetEvents);
				}

				// Small delay to allow Obsidian to process frontmatter before reloading
				window.setTimeout(() => {
					onSaveStateChange(false);
					reloadBoard();
				}, 200);
			}
		};

		const setupDropzone = (el: HTMLElement, targetEvents: { time: string, itemIndex?: number }[]) => {
			let dragCounter = 0;
			el.addEventListener('dragenter', (e) => {
				e.preventDefault();
				dragCounter++;
				el.addClass('drag-over');
			});
			el.addEventListener('dragover', (e) => {
				e.preventDefault();
			});
			el.addEventListener('dragleave', () => {
				dragCounter--;
				if (dragCounter <= 0) {
					dragCounter = 0;
					el.removeClass('drag-over');
				}
			});
			el.addEventListener('drop', (e) => {
				dragCounter = 0;
				el.removeClass('drag-over');
				void handleDrop(e, targetEvents);
			});
		};

		// Determine where each file goes
		const unscheduled: TFile[] = [];
		const fileGroups = new Map<string, TFile[]>(); // Key is "time|itemIndex" or "GAP|time1|time2"

		for (const file of files) {
			const eventsFromMD = chapterToEventMap.get(file.basename) || [];

			if (eventsFromMD.length === 1) {
				const key = `${eventsFromMD[0].time}|${eventsFromMD[0].itemIndex}`;
				if (!fileGroups.has(key)) fileGroups.set(key, []);
				fileGroups.get(key)!.push(file);
			} else if (eventsFromMD.length > 1) {
				const times = [...new Set(eventsFromMD.map(e => e.time))]; // unique times
				if (times.length > 1) {
					const key = `GAP|${times[0]}|${times[1]}`;
					if (!fileGroups.has(key)) fileGroups.set(key, []);
					fileGroups.get(key)!.push(file);
				} else {
					const indices = [...new Set(eventsFromMD.map(e => e.itemIndex))].sort((a, b) => a - b);
					if (indices.length > 1) {
						const key = `GAP|${times[0]}|${indices[0]}|${indices[1]}`;
						if (!fileGroups.has(key)) fileGroups.set(key, []);
						fileGroups.get(key)!.push(file);
					} else {
						const key = `${eventsFromMD[0].time}|${eventsFromMD[0].itemIndex}`;
						if (!fileGroups.has(key)) fileGroups.set(key, []);
						fileGroups.get(key)!.push(file);
					}
				}
			} else {
				const fmEvents = getChapterEvents(file, new Map()); // pass empty map to only get FM
				if (fmEvents.length === 1) {
					const key = `${fmEvents[0]}|0`;
					if (!fileGroups.has(key)) fileGroups.set(key, []);
					fileGroups.get(key)!.push(file);
				} else if (fmEvents.length > 1) {
					const key = `GAP|${fmEvents[0]}|${fmEvents[1]}`;
					if (!fileGroups.has(key)) fileGroups.set(key, []);
					fileGroups.get(key)!.push(file);
				} else {
					unscheduled.push(file);
				}
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

					// Description box
					let descEl: HTMLElement;
					if (itemIdx === 0 || items[itemIdx].description) {
						descEl = itemRow.createDiv({ text: items[itemIdx].description || t('modal.describe-event-placeholder'), cls: 'wn-timeline-item-desc' });
					} else {
						descEl = itemRow.createDiv({ text: '', cls: 'wn-timeline-item-desc' });
					}

					// Delete button
					const deleteBtn = itemRow.createDiv({ cls: 'wn-timeline-item-delete-btn' });
					setIcon(deleteBtn, 'trash');
					deleteBtn.onclick = (e) => {
						e.stopPropagation();
						new ConfirmDeleteEventModal(app, t('modal.confirm-delete-event') || '确认删除该事件吗？', () => {
							void (async () => {
								if (onSaveStateChange) onSaveStateChange(true);

								// Determine which files to clean frontmatter for
								const eventTimeToRemove = entry.time;
								const filesToClean: TFile[] = [];
								if (items.length <= 1) {
									// Whole entry deleted
									for (const file of files) {
										const evts = chapterToEventMap.get(file.basename);
										if (evts && evts.some(e => e.time === eventTimeToRemove)) {
											filesToClean.push(file);
										}
									}
								} else {
									// Only itemIdx deleted
									for (const file of files) {
										const evts = chapterToEventMap.get(file.basename);
										if (evts && evts.some(e => e.time === eventTimeToRemove && e.itemIndex === itemIdx)) {
											filesToClean.push(file);
										}
									}
								}

								// Clean frontmatter
								for (const file of filesToClean) {
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
					setupDropzone(itemRow, [{ time: entry.time, itemIndex: itemIdx }]);

					const key = `${entry.time}|${itemIdx}`;
					const filesInItem = fileGroups.get(key) || [];
					CorkboardGridRenderer.render({
						app, plugin, container: cardsContainer, files: filesInItem, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true
					});

					// Render sub-gap (gap between events in the same time node)
					if (itemIdx < items.length - 1) {
						const subGapKey = `GAP|${entry.time}|${itemIdx}|${itemIdx + 1}`;
						const subGapDiv = nodeDiv.createDiv('wn-timeline-gap wn-timeline-sub-gap');
						const subCardsContainer = subGapDiv.createDiv('wn-timeline-cards-container');
						setupDropzone(subGapDiv, [{ time: entry.time, itemIndex: itemIdx }, { time: entry.time, itemIndex: itemIdx + 1 }]);

						const filesInSubGap = fileGroups.get(subGapKey) || [];
						CorkboardGridRenderer.render({
							app, plugin, container: subCardsContainer, files: filesInSubGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true
						});
					}
				}

				// ⊕ Add sub-event button
				const addSubEventRow = nodeDiv.createDiv('wn-timeline-add-sub-event-row');
				const addSubEventBtn = addSubEventRow.createEl('button', { text: t('corkboard.new-timeline-event') || '+ 添加事件', cls: 'wn-timeline-add-sub-event-btn' });
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
						app, plugin, container: cardsContainer, files: filesInGap, foreshadowingMap, draggable: true, currentBookPath, onSaveStateChange, hideVolumeHeaders: true
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
			emptyMsg.setText(t('corkboard.no-timeline') || '当前还没有时间线事件...');
		}

		// Add Timeline Node Button
		const addNodeRow = mainCol.createDiv('wn-timeline-add-node-row');
		const addNodeBtn = addNodeRow.createDiv({ cls: 'wn-timeline-add-node-btn' });
		addNodeBtn.textContent = t('corkboard.new-timeline-node') || '新增时间节点';
		addNodeBtn.onclick = async () => {
			let timelineFile = timelineManager.getTimelineFile();
			if (!timelineFile) {
				// 自动创建时间线.md
				const newFilePath = timelineManager.getTimelineFilePath();
				try {
					timelineFile = await app.vault.create(newFilePath, '');
					const msg = t('notice.timeline-file-created') || '已自动创建时间线文件：{name}';
					new Notice(msg.replace('{name}', newFilePath));
				} catch (e) {
					console.error('[TimelineBoardRenderer] 创建时间线文件失败:', e);
					new Notice(t('notice.timeline-file-create-failed') || '无法创建时间线文件');
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
							const existing = await app.vault.read(timelineFile);
							const separator = existing.endsWith('\n') ? '' : '\n';
							await app.vault.process(timelineFile, () => existing + separator + timelineManager.formatEntry(entry));
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

		// Sidebar: Unscheduled
		const unscheduledHeader = sideCol.createDiv('wn-timeline-sidebar-header');
		setIcon(unscheduledHeader.createSpan(), 'help-circle');
		unscheduledHeader.createSpan({ text: t('corkboard.unscheduled-chapters') });
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
