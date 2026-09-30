import { setTooltip, type App, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { TimelineEntry, TimelineItem } from '../../services/TimelineManager';
import { t } from '../../i18n';
import { setupStickyNoteParagraphEditor, getStickyNoteEditorContent, setStickyNoteEditorContent } from './StickyNoteParagraphEditor';
import { openFileAndFocus, getLeafForFileNavigation } from '../../utils/leaf';
import { Logger } from '../../utils/Logger';

export interface TrajectoryModeOptions {
	app: App;
	container: HTMLElement;
	displayEntries: TimelineEntry[];
	allTypes?: string[];
	typeFilter?: string;
	resolveLinkToFile: (link: string) => TFile | null;
	allEntries?: TimelineEntry[];
	onOpenEntry?: (entry: TimelineEntry, originalIndex: number) => Promise<void>;
	onUpdateEntry?: (originalIndex: number, entry: TimelineEntry) => Promise<void>;
	onSaveStateChange?: (saving: boolean) => void;
	reloadBoard?: () => void;
	sourceLeaf?: WorkspaceLeaf;
}

export function renderTrajectoryMode(options: TrajectoryModeOptions): void {
	const {
		app,
		container,
		displayEntries,
		allTypes,
		typeFilter,
		resolveLinkToFile,
		allEntries,
		onOpenEntry,
		onUpdateEntry,
		onSaveStateChange,
		reloadBoard,
		sourceLeaf
	} = options;

	const layout = container.createDiv('wn-timeline-trajectory-layout');

	if (displayEntries.length === 0) {
		layout.createDiv({ cls: 'wn-trajectory-empty', text: t('trajectory.no-records') });
		return;
	}

	const MIN_SCALE = 0.5;
	const MAX_SCALE = 2.0;

	let currentPanX = 0;
	let currentPanY = 0;
	let currentScale = 1;

	let dragPointerId: number | null = null;
	let startPointerX = 0;
	let startPointerY = 0;
	let startPanX = 0;
	let startPanY = 0;
	let suppressClick = false;

	let grid: HTMLElement;
	const updateTransform = () => {
		grid.setCssStyles({ transform: `translate3d(${currentPanX}px, ${currentPanY}px, 0) scale(${currentScale})` });
	};

	layout.addEventListener('pointerdown', (e) => {
		if (dragPointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
		if ((e.target as HTMLElement).closest('input, textarea, button, .wn-trajectory-node, .wn-trajectory-event-text, .wn-trajectory-chapter-marker, [contenteditable]')) {
			return;
		}
		dragPointerId = e.pointerId;
		startPointerX = e.clientX;
		startPointerY = e.clientY;
		startPanX = currentPanX;
		startPanY = currentPanY;
		suppressClick = false;
		if (layout.setPointerCapture) {
			try {
				layout.setPointerCapture(e.pointerId);
			} catch {
				// Pointer capture can fail if pointer is no longer active
			}
		}
	});

	layout.addEventListener('pointermove', (e) => {
		if (e.pointerId !== dragPointerId) return;
		const distanceX = e.clientX - startPointerX;
		const distanceY = e.clientY - startPointerY;
		if (Math.abs(distanceX) <= 3 && Math.abs(distanceY) <= 3 && !layout.hasClass('is-panning')) return;
		e.preventDefault();
		layout.addClass('is-panning');
		currentPanX = Math.round((startPanX + distanceX) * 100) / 100;
		currentPanY = Math.round((startPanY + distanceY) * 100) / 100;
		updateTransform();
		suppressClick = true;
	});

	const stopDrag = (e: PointerEvent) => {
		if (e.pointerId !== dragPointerId) return;
		dragPointerId = null;
		layout.removeClass('is-panning');
		if (layout.hasPointerCapture && layout.hasPointerCapture(e.pointerId)) {
			try {
				layout.releasePointerCapture(e.pointerId);
			} catch {
				// Pointer capture can fail if already released
			}
		}
		if (e.type === 'pointercancel') suppressClick = false;
		else layout.ownerDocument.defaultView?.setTimeout(() => { suppressClick = false; }, 0);
	};
	layout.addEventListener('pointerup', stopDrag);
	layout.addEventListener('pointercancel', stopDrag);
	layout.addEventListener('lostpointercapture', () => {
		dragPointerId = null;
		layout.removeClass('is-panning');
	});

	layout.addEventListener('click', (e) => {
		if (suppressClick) {
			suppressClick = false;
			e.stopPropagation();
			e.stopImmediatePropagation();
			e.preventDefault();
		}
	}, true);

	interface TrajectoryItemRef {
		entry: TimelineEntry;
		item: TimelineItem;
		itemIndex: number;
		originalIndex: number;
	}

	interface TrajectoryColumn {
		time: string;
		types: Set<string>;
		nodes: Map<string, TimelineEntry>;
		items: TrajectoryItemRef[];
	}

	const columnMap = new Map<string, TrajectoryColumn>();
	const columns: TrajectoryColumn[] = [];

	for (const entry of displayEntries) {
		const nodeType = entry.type || t('trajectory.main-type');
		if (typeFilter && typeFilter !== 'all' && nodeType !== typeFilter) continue;
		let col = columnMap.get(entry.time);
		if (!col) {
			col = {
				time: entry.time,
				types: new Set<string>(),
				nodes: new Map<string, TimelineEntry>(),
				items: []
			};
			columnMap.set(entry.time, col);
			columns.push(col);
		}

		const originalIndex = allEntries ? allEntries.indexOf(entry) : -1;
		const items = entry.items?.length
			? entry.items
			: [{
				description: entry.description,
				chapter: entry.chapter,
				important: entry.important
			}];

		col.types.add(nodeType);
		const firstNode = col.nodes.get(nodeType);
		if (!firstNode || (allEntries && originalIndex >= 0 && allEntries.indexOf(firstNode) > originalIndex)) {
			col.nodes.set(nodeType, entry);
		}
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			col.items.push({
				entry,
				item,
				itemIndex: i,
				originalIndex
			});
		}

		if (col.types.size === 0) {
			col.types.add(t('trajectory.main-type'));
		}
	}

	const lores = [...new Set(displayEntries.flatMap(entry => entry.lores || []))];
	grid = layout.createDiv('wn-trajectory-grid');
	updateTransform();
	grid.setCssStyles({ gridTemplateColumns: `max-content repeat(${columns.length}, 14rem)` });

	layout.addEventListener('dblclick', (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (e.button !== 0 || (target !== layout && target !== grid
			&& !target.hasClass('wn-trajectory-cell') && !target.hasClass('wn-trajectory-divider'))) return;
		if (currentScale === 1) return;
		currentScale = 1;
		updateTransform();
	});

	layout.addEventListener('wheel', (e: WheelEvent) => {
		if (e.deltaY === 0) return;
		if ((e.target as HTMLElement)?.closest?.('.wn-trajectory-event-text.is-editing, [contenteditable]')) {
			return;
		}
		e.preventDefault();

		const factor = Math.pow(0.999, e.deltaY);
		let targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale * factor));
		targetScale = Math.round(targetScale * 1000) / 1000;
		if (targetScale === currentScale) return;

		const rect = layout.getBoundingClientRect();
		const px = e.clientX - rect.left;
		const py = e.clientY - rect.top;

		const newPanX = px - (px - currentPanX) * (targetScale / currentScale);
		const newPanY = py - (py - currentPanY) * (targetScale / currentScale);

		currentScale = targetScale;
		currentPanX = Math.round(newPanX * 100) / 100;
		currentPanY = Math.round(newPanY * 100) / 100;

		updateTransform();
	}, { passive: false });

	const place = (element: HTMLElement, row: number, column: number, span = 1): void => {
		element.setCssProps({ '--traj-row': String(row), '--traj-col': span === 1 ? String(column) : `${column} / span ${span}` });
	};

	const renderChapters = (parent: HTMLElement, chapterText: string): void => {
		const references = chapterText.split(/[,，]/).map(value => value.trim()).filter(Boolean);
		if (references.length === 0) return;
		const list = parent.createDiv('wn-trajectory-chapters');
		for (const reference of references) {
			const file = resolveLinkToFile(reference);
			const name = file?.basename ?? reference;
			const marker = list.createSpan({ cls: 'wn-trajectory-chapter-marker', text: name });
			const frontmatter = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
			const summary: unknown = frontmatter?.synopsis ?? frontmatter?.Synopsis ?? frontmatter?.['摘要'];

			if (file) {
				marker.addClass('is-resolved');
				marker.setAttribute('role', 'button');
				marker.tabIndex = 0;
				marker.onclick = (e) => {
					e.stopPropagation();
					void (async () => {
						try {
							const targetLeaf = getLeafForFileNavigation(app, file, { sourceLeaf });
							await openFileAndFocus(app, targetLeaf, file);
						} catch (err) {
							Logger.error('[TrajectoryBoard] Failed to open chapter:', err);
						}
					})();
				};
				marker.onkeydown = (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						void (async () => {
							try {
								const targetLeaf = getLeafForFileNavigation(app, file, { sourceLeaf });
								await openFileAndFocus(app, targetLeaf, file);
							} catch (err) {
								Logger.error('[TrajectoryBoard] Failed to open chapter:', err);
							}
						})();
					}
				};
			}

			if (typeof summary === 'string' && summary.trim()) {
				marker.tabIndex = 0;
				setTooltip(marker, summary, { classes: ['wn-tooltip-left'] });
			}
		}
	};

	const configuredTypes = allTypes || [];
	const allPresentTypes: string[] = [];
	for (const col of columns) {
		for (const type of col.types) {
			if (!allPresentTypes.includes(type)) {
				allPresentTypes.push(type);
			}
		}
	}
	const typesToRender = allPresentTypes.length > 0 ? allPresentTypes : [t('trajectory.main-type')];
	const THEME_COLORS = [
		'var(--color-blue)',
		'var(--color-green)',
		'var(--color-orange)',
		'var(--color-purple)',
		'var(--color-red)',
		'var(--color-cyan)',
		'var(--color-pink)',
		'var(--color-yellow)'
	];

	const getTypeColor = (type: string) => {
		const idx = configuredTypes.indexOf(type);
		const finalIdx = idx !== -1 ? idx : (configuredTypes.length + [...typesToRender].sort().indexOf(type));
		return THEME_COLORS[finalIdx % THEME_COLORS.length];
	};

	let row = 1;
	for (const type of typesToRender) {
		const themeColor = getTypeColor(type);
		const labelCell = grid.createDiv({ cls: 'wn-trajectory-lane-header is-type', text: type });
		labelCell.setCssProps({ '--wn-trajectory-type-color': themeColor });
		place(labelCell, row, 1);
		columns.forEach((col, index) => {
			const isNode = col.types.has(type);
			const cell = grid.createDiv(isNode ? 'wn-trajectory-cell is-type is-node' : 'wn-trajectory-cell is-type');
			cell.setCssProps({ '--wn-trajectory-type-color': themeColor });
			place(cell, row, index + 2);
			if (isNode) {
				const node = cell.createDiv({ cls: 'wn-trajectory-node', text: col.time });
				const entry = col.nodes.get(type);
				const originalIndex = entry && allEntries ? allEntries.indexOf(entry) : -1;
				if (entry && originalIndex >= 0 && onOpenEntry) {
					node.title = t('common.jump-to-entry');
					node.setAttribute('role', 'button');
					node.tabIndex = 0;
					const openEntry = () => {
						void onOpenEntry(entry, originalIndex).catch(err => {
							Logger.error('[TrajectoryBoard] Failed to open timeline entry:', err);
						});
					};
					node.onclick = (e) => { e.stopPropagation(); openEntry(); };
					node.onkeydown = (e) => {
						if (e.key !== 'Enter' && e.key !== ' ') return;
						e.preventDefault();
						e.stopPropagation();
						openEntry();
					};
				}
			}
		});
		row++;
	}

	place(grid.createDiv('wn-trajectory-divider'), row, 1, columns.length + 1);
	row++;

	const activeEdits = new Set<string>();

	const renderLoreLane = (label: string, matches: (entry: TimelineEntry) => boolean, isUnassociated = false): void => {
		place(grid.createDiv({ cls: `wn-trajectory-lane-header is-lore${isUnassociated ? ' is-unassociated' : ''}`, text: label }), row, 1);
		columns.forEach((col, index) => {
			const cell = grid.createDiv('wn-trajectory-cell is-lore');
			place(cell, row, index + 2);

			const matchingItems = col.items.filter(itemRef => matches(itemRef.entry));
			if (matchingItems.length === 0) return;

			for (const itemRef of matchingItems) {
				const { entry, item, itemIndex, originalIndex } = itemRef;
				const event = cell.createDiv(item.important ? 'wn-trajectory-event is-important' : 'wn-trajectory-event');
				const itemType = entry.type || t('trajectory.main-type');
				const itemThemeColor = getTypeColor(itemType);
				event.setCssProps({ '--wn-trajectory-type-color': itemThemeColor });

				const rawDesc = item.description || '';
				const hasDesc = Boolean(rawDesc.trim().length > 0);
				const textDiv = event.createDiv({
					cls: hasDesc ? 'wn-trajectory-event-text' : 'wn-trajectory-event-text is-empty'
				});
				if (hasDesc) {
					setStickyNoteEditorContent(textDiv, rawDesc);
				} else {
					textDiv.setText(t('trajectory.no-description'));
				}
				if (allEntries && onUpdateEntry && originalIndex !== -1) {
					textDiv.setAttribute('role', 'button');
					textDiv.tabIndex = 0;
					textDiv.onkeydown = (e) => {
						if (e.key !== 'Enter' && e.key !== ' ') return;
						e.preventDefault();
						textDiv.click();
					};
				}
				renderChapters(event, item.chapter || '');

				textDiv.onclick = (e) => {
					e.stopPropagation();
					if (textDiv.hasClass('is-editing') || !allEntries || !onUpdateEntry || originalIndex === -1) return;

					const editKey = `${originalIndex}-${itemIndex}`;
					if (activeEdits.has(editKey)) return;
					activeEdits.add(editKey);

					const currentDesc = item.description || '';
					textDiv.empty();
					textDiv.removeClass('is-empty');
					textDiv.addClass('is-editing');
					textDiv.onkeydown = null;
					setupStickyNoteParagraphEditor(textDiv, currentDesc);

					textDiv.focus({ preventScroll: true });
					const ownerDocument = textDiv.ownerDocument;
					const selection = ownerDocument.defaultView?.getSelection();
					if (selection) {
						const range = ownerDocument.createRange();
						range.selectNodeContents(textDiv);
						range.collapse(false);
						selection.removeAllRanges();
						selection.addRange(range);
					}

					const saveDesc = async () => {
						if (!textDiv.hasClass('is-editing')) return;
						textDiv.removeClass('is-editing');

						const newVal = getStickyNoteEditorContent(textDiv).trim();

						if (newVal === currentDesc) {
							activeEdits.delete(editKey);
							reloadBoard?.();
							return;
						}

						if (onSaveStateChange) onSaveStateChange(true);

						const targetEntry = allEntries[originalIndex] ?? entry;
						const originalItemDesc = targetEntry.items && targetEntry.items.length > 0
							? targetEntry.items[itemIndex]?.description ?? targetEntry.description
							: targetEntry.description;

						if (targetEntry.items && targetEntry.items.length > 0 && targetEntry.items[itemIndex]) {
							targetEntry.items[itemIndex].description = newVal;
						} else {
							targetEntry.description = newVal;
						}
						item.description = newVal;

						try {
							await onUpdateEntry(originalIndex, targetEntry);
						} catch (err) {
							Logger.error('[TrajectoryBoard] Failed to update description:', err);
							if (targetEntry.items && targetEntry.items.length > 0 && targetEntry.items[itemIndex]) {
								targetEntry.items[itemIndex].description = originalItemDesc;
							} else {
								targetEntry.description = originalItemDesc;
							}
							item.description = originalItemDesc;
						} finally {
							onSaveStateChange?.(false);
							activeEdits.delete(editKey);
						}
						reloadBoard?.();
					};

					textDiv.onblur = () => { void saveDesc(); };
				};
			}
		});
		row++;
	};

	if (columns.some(col => col.items.some(itemRef => !itemRef.entry.lores?.length))) {
		renderLoreLane(t('trajectory.unassociated'), entry => !entry.lores?.length, true);
	}
	for (const lore of lores) renderLoreLane(lore, entry => !!entry.lores?.includes(lore));
}
