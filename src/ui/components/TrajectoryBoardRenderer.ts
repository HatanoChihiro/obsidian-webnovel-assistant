import { Modal, Notice, Platform, setIcon, setTooltip, type App, type Component, type TFile, type WorkspaceLeaf } from 'obsidian';
import { filterTimelineEntries, parseTimelineChapterList, type TimelineEntry, type TimelineItem } from '../../services/TimelineManager';
import { t } from '../../i18n';
import { setupStickyNoteParagraphEditor, teardownStickyNoteParagraphEditor, getStickyNoteEditorContent, setStickyNoteEditorContent } from './StickyNoteParagraphEditor';
import { openFileAndFocus, getLeafForFileNavigation } from '../../utils/leaf';
import { Logger } from '../../utils/Logger';

interface TrajectorySession {
	bookPath: string;
	panX: number;
	panY: number;
	scale: number;
	isFullscreen?: boolean;
}

const ephemeralViewportCache = new WeakMap<object, TrajectorySession>();

export function clearTrajectoryViewport(key?: object): void {
	if (key) {
		ephemeralViewportCache.delete(key);
	}
}

export interface TrajectoryModeOptions {
	app: App;
	container: HTMLElement;
	displayEntries: TimelineEntry[];
	allTypes?: string[];
	typeFilter?: readonly string[];
	resolveLinkToFile: (link: string) => TFile | null;
	allEntries?: TimelineEntry[];
	onOpenEntry?: (entry: TimelineEntry, originalIndex: number) => Promise<void>;
	onUpdateEntry?: (originalIndex: number, entry: TimelineEntry, expectedEntry?: TimelineEntry) => Promise<void>;
	onSaveStateChange?: (saving: boolean) => void;
	reloadBoard?: () => void;
	sourceLeaf?: WorkspaceLeaf;
	ownerComponent?: Component;
	currentBookPath?: string;
}

class TrajectoryFullscreenModal extends Modal {
	private placeholder: HTMLElement | null = null;
	private shell: HTMLElement | null = null;
	private isClosed = false;
	private isRestored = false;
	private resizeListener: (() => void) | null = null;

	constructor(
		app: App,
		private readonly layoutEl: HTMLElement,
		private readonly onRotationChange: (rotated: boolean) => void,
		private readonly closeActiveEditors: () => Promise<void>,
		private readonly onModalClosed?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const doc = this.layoutEl.ownerDocument;
		const win = doc.defaultView ?? window;

		this.containerEl.addClass('wn-trajectory-modal-container');
		this.modalEl.addClass('wn-trajectory-fullscreen-modal');
		// Obsidian uses different native close-control classes across versions.
		for (const selector of ['.modal-close-button', '.modal-header-button']) {
			this.containerEl.querySelectorAll(selector).forEach(button => button.remove());
		}

		const parent = this.layoutEl.parentElement;
		if (parent) {
			this.placeholder = parent.createDiv('wn-trajectory-fullscreen-placeholder');
			parent.insertBefore(this.placeholder, this.layoutEl);
		}

		this.shell = this.contentEl.createDiv('wn-trajectory-fullscreen-shell');
		this.shell.appendChild(this.layoutEl);

		const exitBtn = this.shell.createDiv('wn-trajectory-exit-btn');
		exitBtn.setAttribute('role', 'button');
		exitBtn.setAttribute('tabindex', '0');
		exitBtn.setAttribute('aria-label', t('trajectory.exit-fullscreen'));
		setIcon(exitBtn, 'minimize');
		setTooltip(exitBtn, t('trajectory.exit-fullscreen'));

		exitBtn.onclick = (e) => {
			e.stopPropagation();
			this.close();
		};
		exitBtn.onkeydown = (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		};

		const isMobileDevice = Platform.isMobile
			|| doc.body.classList.contains('is-mobile')
			|| doc.body.classList.contains('is-phone')
			|| doc.body.classList.contains('is-tablet');

		let lastWinWidth = win.innerWidth;
		let isPortrait = false;

		const checkPortrait = (): boolean => {
			if (!isMobileDevice) return false;
			const screenOri = win.screen?.orientation;
			if (screenOri?.type) {
				return screenOri.type.startsWith('portrait');
			}
			if (typeof screenOri?.angle === 'number') {
				return screenOri.angle === 0 || screenOri.angle === 180;
			}
			return win.innerWidth < win.innerHeight;
		};

		isPortrait = checkPortrait();

		const applyOrientation = () => {
			if (!this.shell) return;
			const vv = win.visualViewport;
			const visibleW = vv?.width ?? win.innerWidth;
			const visibleH = vv?.height ?? win.innerHeight;
			const offsetLeft = vv?.offsetLeft ?? 0;
			const offsetTop = vv?.offsetTop ?? 0;

			if (isPortrait) {
				this.onRotationChange(true);
				this.shell.addClass('is-rotated-90');
				this.shell.setCssStyles({
					width: `${visibleH}px`,
					height: `${visibleW}px`,
					transform: `translate(${visibleW + offsetLeft}px, ${offsetTop}px) rotate(90deg)`,
					transformOrigin: '0 0'
				});
			} else {
				this.onRotationChange(false);
				this.shell.removeClass('is-rotated-90');
				this.shell.setCssStyles({
					width: `${visibleW}px`,
					height: `${visibleH}px`,
					transform: `translate(${offsetLeft}px, ${offsetTop}px)`,
					transformOrigin: ''
				});
			}
		};

		applyOrientation();

		this.resizeListener = () => {
			if (this.isClosed || !this.shell) return;
			const currW = win.innerWidth;
			if (currW !== lastWinWidth) {
				lastWinWidth = currW;
				isPortrait = checkPortrait();
			}
			applyOrientation();
		};

		win.addEventListener('resize', this.resizeListener);
		win.visualViewport?.addEventListener('resize', this.resizeListener);
		win.visualViewport?.addEventListener('scroll', this.resizeListener);
	}

	override close(): void {
		this.restoreLayout();
		super.close();
	}

	override onClose(): void {
		this.restoreLayout();
	}

	private restoreLayout(): void {
		if (this.isRestored) return;
		this.isRestored = true;
		this.isClosed = true;

		void this.closeActiveEditors();

		const win = this.layoutEl.ownerDocument.defaultView ?? window;
		if (this.resizeListener) {
			win.removeEventListener('resize', this.resizeListener);
			win.visualViewport?.removeEventListener('resize', this.resizeListener);
			win.visualViewport?.removeEventListener('scroll', this.resizeListener);
			this.resizeListener = null;
		}

		this.onRotationChange(false);

		if (this.placeholder?.parentElement && this.placeholder.parentElement.isConnected) {
			this.placeholder.parentElement.insertBefore(this.layoutEl, this.placeholder);
		}
		this.placeholder?.remove();
		this.placeholder = null;
		this.shell = null;
		this.onModalClosed?.();
	}

	forceCloseWithoutRestore(): void {
		if (this.isRestored) return;
		this.isRestored = true;
		this.isClosed = true;

		const win = this.layoutEl.ownerDocument.defaultView ?? window;
		if (this.resizeListener) {
			win.removeEventListener('resize', this.resizeListener);
			win.visualViewport?.removeEventListener('resize', this.resizeListener);
			win.visualViewport?.removeEventListener('scroll', this.resizeListener);
			this.resizeListener = null;
		}

		this.onRotationChange(false);
		this.placeholder?.remove();
		this.placeholder = null;
		this.shell = null;
		super.close();
	}
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
		sourceLeaf,
		ownerComponent,
		currentBookPath
	} = options;

	const layout = container.createDiv('wn-timeline-trajectory-layout');

	if (displayEntries.length === 0) {
		layout.createDiv({ cls: 'wn-trajectory-empty', text: t('trajectory.no-records') });
		return;
	}

	const MIN_SCALE = 0.5;
	const MAX_SCALE = 2.0;

	const cacheKey = (sourceLeaf ?? container) as object;
	const bookKey = currentBookPath || '';
	const cached = cacheKey ? ephemeralViewportCache.get(cacheKey) : undefined;

	let currentPanX = 0;
	let currentPanY = 0;
	let currentScale = 1;

	if (cached && cached.bookPath === bookKey) {
		currentPanX = cached.panX;
		currentPanY = cached.panY;
		currentScale = cached.scale;
	}

	const updateEphemeralCache = () => {
		if (cacheKey) {
			const existing = ephemeralViewportCache.get(cacheKey);
			ephemeralViewportCache.set(cacheKey, {
				bookPath: bookKey,
				panX: currentPanX,
				panY: currentPanY,
				scale: currentScale,
				isFullscreen: activeModal !== null || Boolean(existing?.isFullscreen)
			});
		}
	};

	let isRotated = false;
	let activeModal: TrajectoryFullscreenModal | null = null;

	const getCoords = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
		const rect = layout.getBoundingClientRect();
		if (isRotated) {
			return {
				x: e.clientY - rect.top,
				y: rect.right - e.clientX
			};
		}
		return {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top
		};
	};

	let grid: HTMLElement;
	const updateTransform = () => {
		grid.setCssStyles({ transform: `translate3d(${currentPanX}px, ${currentPanY}px, 0) scale(${currentScale})` });
	};

	const activePointers = new Map<number, { x: number; y: number }>();
	let suppressClicksCount = 0;
	let isPanning = false;

	let dragPointerId: number | null = null;
	let startPointerX = 0;
	let startPointerY = 0;
	let startPanX = 0;
	let startPanY = 0;

	let pinchBaseDist = 0;
	let pinchBaseScale = 1;
	let pinchBasePanX = 0;
	let pinchBasePanY = 0;
	let pinchBaseMidX = 0;
	let pinchBaseMidY = 0;

	const rebasePinch = () => {
		if (activePointers.size >= 2) {
			const [p1, p2] = Array.from(activePointers.values());
			pinchBaseDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
			pinchBaseMidX = (p1.x + p2.x) / 2;
			pinchBaseMidY = (p1.y + p2.y) / 2;
			pinchBaseScale = currentScale;
			pinchBasePanX = currentPanX;
			pinchBasePanY = currentPanY;
			isPanning = true;
			layout.addClass('is-panning');
			suppressClicksCount = Math.max(suppressClicksCount, activePointers.size);
		}
	};

	layout.addEventListener('touchstart', (e: TouchEvent) => {
		e.stopPropagation();
	}, { passive: true });

	layout.addEventListener('touchmove', (e: TouchEvent) => {
		e.stopPropagation();
		if (layout.hasClass('is-panning') || activePointers.size >= 2) {
			const target = e.target as HTMLElement | null;
			if (!target?.closest?.('.wn-trajectory-event-text.is-editing, [contenteditable], input, textarea')) {
				e.preventDefault();
			}
		}
	}, { passive: false });

	layout.addEventListener('touchend', (e: TouchEvent) => {
		e.stopPropagation();
	}, { passive: true });

	layout.addEventListener('touchcancel', (e: TouchEvent) => {
		e.stopPropagation();
	}, { passive: true });

	layout.addEventListener('pointerdown', (e: PointerEvent) => {
		if (activePointers.size === 0) suppressClicksCount = 0;
		if (e.pointerType === 'mouse') {
			if (e.button !== 0) return;
			if (dragPointerId !== null) return;
		}

		const target = e.target as HTMLElement | null;
		if (target?.closest?.('.wn-trajectory-event-text.is-editing, [contenteditable], input, textarea')) {
			return;
		}

		if (e.pointerType === 'mouse') {
			if (target?.closest?.('button, .wn-trajectory-node, .wn-trajectory-event-text, .wn-trajectory-chapter-marker, .wn-trajectory-expand-btn, .wn-trajectory-exit-btn')) {
				return;
			}
		}

		if (target?.closest?.('button, .wn-trajectory-expand-btn, .wn-trajectory-exit-btn')) {
			return;
		}

		const coords = getCoords(e);
		activePointers.set(e.pointerId, {
			x: coords.x,
			y: coords.y
		});

		if (activePointers.size === 1) {
			dragPointerId = e.pointerId;
			startPointerX = coords.x;
			startPointerY = coords.y;
			startPanX = currentPanX;
			startPanY = currentPanY;
			isPanning = false;

			if (e.pointerType === 'mouse') {
				try {
					layout.setPointerCapture(e.pointerId);
				} catch {
					// ignore
				}
			}
		} else if (activePointers.size >= 2) {
			rebasePinch();
			for (const pid of activePointers.keys()) {
				try {
					if (!layout.hasPointerCapture(pid)) {
						layout.setPointerCapture(pid);
					}
				} catch {
					// ignore
				}
			}
		}
	});

	layout.addEventListener('pointermove', (e: PointerEvent) => {
		const pointer = activePointers.get(e.pointerId);
		if (!pointer) return;

		const coords = getCoords(e);
		pointer.x = coords.x;
		pointer.y = coords.y;

		if (activePointers.size === 1 && e.pointerId === dragPointerId) {
			const distanceX = coords.x - startPointerX;
			const distanceY = coords.y - startPointerY;

			if (!isPanning) {
				if (Math.abs(distanceX) <= 3 && Math.abs(distanceY) <= 3) return;
				isPanning = true;
				layout.addClass('is-panning');
				suppressClicksCount = Math.max(suppressClicksCount, 1);
				try {
					layout.setPointerCapture(e.pointerId);
				} catch {
					// ignore
				}
			}

			e.preventDefault();
			currentPanX = Math.round((startPanX + distanceX) * 100) / 100;
			currentPanY = Math.round((startPanY + distanceY) * 100) / 100;
			updateTransform();
			updateEphemeralCache();
			suppressClicksCount = Math.max(suppressClicksCount, 1);
		} else if (activePointers.size >= 2) {
			const [p1, p2] = Array.from(activePointers.values());
			const currDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
			const currMidX = (p1.x + p2.x) / 2;
			const currMidY = (p1.y + p2.y) / 2;

			if (pinchBaseDist > 0) {
				e.preventDefault();
				const factor = currDist / pinchBaseDist;
				let targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchBaseScale * factor));
				targetScale = Math.round(targetScale * 1000) / 1000;

				const scaleRatio = targetScale / pinchBaseScale;
				const newPanX = currMidX - (pinchBaseMidX - pinchBasePanX) * scaleRatio;
				const newPanY = currMidY - (pinchBaseMidY - pinchBasePanY) * scaleRatio;

				currentScale = targetScale;
				currentPanX = Math.round(newPanX * 100) / 100;
				currentPanY = Math.round(newPanY * 100) / 100;

				updateTransform();
				updateEphemeralCache();
				suppressClicksCount = Math.max(suppressClicksCount, activePointers.size);
			}
		}
	});

	const stopDrag = (e: PointerEvent) => {
		if (!activePointers.has(e.pointerId)) return;

		activePointers.delete(e.pointerId);

		if (activePointers.size >= 2) {
			rebasePinch();
		} else if (activePointers.size === 1) {
			const [remainingId] = Array.from(activePointers.keys());
			const remaining = activePointers.get(remainingId)!;
			dragPointerId = remainingId;
			startPointerX = remaining.x;
			startPointerY = remaining.y;
			startPanX = currentPanX;
			startPanY = currentPanY;
			isPanning = true;
		} else if (activePointers.size === 0) {
			dragPointerId = null;
			isPanning = false;
			layout.removeClass('is-panning');
		}

		if (layout.hasPointerCapture && layout.hasPointerCapture(e.pointerId)) {
			try {
				layout.releasePointerCapture(e.pointerId);
			} catch {
				// ignore
			}
		}
	};

	layout.addEventListener('pointerup', stopDrag);
	layout.addEventListener('pointercancel', stopDrag);
	layout.addEventListener('lostpointercapture', (e) => {
		// Moving implicit touch capture from a card to the canvas emits a
		// bubbling loss event on the card; the canvas still owns the gesture.
		if (e.target && e.target !== layout) return;
		stopDrag(e);
	});

	layout.addEventListener('click', (e) => {
		if (suppressClicksCount > 0) {
			suppressClicksCount--;
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

	const entryIndexMap = new Map<TimelineEntry, number>();
	if (allEntries) {
		for (let i = 0; i < allEntries.length; i++) {
			const entry = allEntries[i];
			if (!entryIndexMap.has(entry)) {
				entryIndexMap.set(entry, i);
			}
		}
	}
	const getOriginalIndex = (entry: TimelineEntry): number => {
		if (!allEntries) return -1;
		return entryIndexMap.get(entry) ?? -1;
	};

	const columnMap = new Map<string, TrajectoryColumn>();
	const columns: TrajectoryColumn[] = [];

	const effectiveEntries = (typeFilter && typeFilter.length > 0)
		? filterTimelineEntries(displayEntries, typeFilter)
		: displayEntries;

	for (const entry of effectiveEntries) {
		const nodeType = entry.type || t('trajectory.main-type');
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

		const originalIndex = getOriginalIndex(entry);
		const items = entry.items?.length
			? entry.items
			: [{
				description: entry.description,
				chapter: entry.chapter,
				important: entry.important
			}];

		col.types.add(nodeType);
		const firstNode = col.nodes.get(nodeType);
		const firstNodeOriginalIndex = firstNode ? getOriginalIndex(firstNode) : -1;
		if (!firstNode || (allEntries && originalIndex >= 0 && firstNodeOriginalIndex > originalIndex)) {
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

	const lores = [...new Set(effectiveEntries.flatMap(entry => entry.lores || []))];
	grid = layout.createDiv('wn-trajectory-grid');
	updateTransform();
	grid.setCssStyles({ gridTemplateColumns: `max-content repeat(${columns.length}, 14rem)` });

	const expandBtn = layout.createDiv('wn-trajectory-expand-btn');
	expandBtn.setAttribute('role', 'button');
	expandBtn.setAttribute('tabindex', '0');
	expandBtn.setAttribute('aria-label', t('trajectory.enter-fullscreen'));
	setIcon(expandBtn, 'maximize');
	setTooltip(expandBtn, t('trajectory.enter-fullscreen'));

	let activeSavesCount = 0;
	const activeEdits = new Set<string>();
	const activeEditorBlurMap = new Map<string, () => Promise<void>>();
	const pendingSavePromises = new Set<Promise<void>>();
	let activeSaveChain: Promise<void> | null = null;

	const closeAllActiveEditors = async () => {
		const blurs = Array.from(activeEditorBlurMap.values());
		for (const blur of blurs) {
			await blur();
		}
		while (pendingSavePromises.size > 0) {
			await Promise.all(Array.from(pendingSavePromises));
		}
	};

	const openFullscreen = () => {
		if (activeModal) return;
		void closeAllActiveEditors();
		if (cacheKey) {
			const s = ephemeralViewportCache.get(cacheKey) || { bookPath: bookKey, panX: currentPanX, panY: currentPanY, scale: currentScale };
			s.isFullscreen = true;
			ephemeralViewportCache.set(cacheKey, s);
		}
		activeModal = new TrajectoryFullscreenModal(
			app,
			layout,
			(rotated) => {
				isRotated = rotated;
			},
			closeAllActiveEditors,
			() => {
				activeModal = null;
				if (cacheKey) {
					const s = ephemeralViewportCache.get(cacheKey);
					if (s) s.isFullscreen = false;
				}
			}
		);
		activeModal.open();
	};

	expandBtn.onclick = (e) => {
		e.stopPropagation();
		openFullscreen();
	};
	expandBtn.onkeydown = (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			openFullscreen();
		}
	};

	if (cached?.isFullscreen && cached.bookPath === bookKey) {
		const doc = container.ownerDocument;
		const win = doc.defaultView ?? window;
		const rafId = win.requestAnimationFrame(() => {
			if (!layout.isConnected) return;
			const currSession = cacheKey ? ephemeralViewportCache.get(cacheKey) : undefined;
			if (!currSession?.isFullscreen) return;
			openFullscreen();
		});
		if (ownerComponent) {
			ownerComponent.register(() => {
				win.cancelAnimationFrame(rafId);
			});
		}
	}

	if (ownerComponent) {
		ownerComponent.register(() => {
			void closeAllActiveEditors();
			if (activeModal) {
				activeModal.forceCloseWithoutRestore();
				activeModal = null;
			}
		});
	}

	layout.addEventListener('dblclick', (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (e.button !== 0 || (target !== layout && target !== grid
			&& !target.hasClass('wn-trajectory-cell')
			&& !target.hasClass('wn-trajectory-divider')
			&& !target.hasClass('wn-trajectory-lane-bg')
			&& !target.closest?.('.wn-trajectory-lane-bg'))) return;
		if (currentScale === 1) return;
		currentScale = 1;
		updateTransform();
		updateEphemeralCache();
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

		const coords = getCoords(e);
		const px = coords.x;
		const py = coords.y;

		const newPanX = px - (px - currentPanX) * (targetScale / currentScale);
		const newPanY = py - (py - currentPanY) * (targetScale / currentScale);

		currentScale = targetScale;
		currentPanX = Math.round(newPanX * 100) / 100;
		currentPanY = Math.round(newPanY * 100) / 100;

		updateTransform();
		updateEphemeralCache();
	}, { passive: false });

	const place = (element: HTMLElement, row: number, column: number, span = 1): void => {
		element.setCssProps({ '--traj-row': String(row), '--traj-col': span === 1 ? String(column) : `${column} / span ${span}` });
	};

	const renderChapters = (parent: HTMLElement, chapterText: string): void => {
		const references = parseTimelineChapterList(chapterText);
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
	const typeColIndicesMap = new Map<string, number[]>();
	columns.forEach((col, colIndex) => {
		for (const type of col.types) {
			if (!allPresentTypes.includes(type)) {
				allPresentTypes.push(type);
			}
			let indices = typeColIndicesMap.get(type);
			if (!indices) {
				indices = [];
				typeColIndicesMap.set(type, indices);
			}
			indices.push(colIndex);
		}
	});
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

		if (columns.length > 0) {
			const laneBg = grid.createDiv('wn-trajectory-lane-bg is-type');
			laneBg.setCssProps({ '--wn-trajectory-type-color': themeColor });
			place(laneBg, row, 2, columns.length);
		}

		const occupiedCols = typeColIndicesMap.get(type) ?? [];
		for (const colIndex of occupiedCols) {
			const col = columns[colIndex];
			const cell = grid.createDiv('wn-trajectory-cell is-type is-node');
			cell.setCssProps({ '--wn-trajectory-type-color': themeColor });
			place(cell, row, colIndex + 2);

			const node = cell.createDiv({ cls: 'wn-trajectory-node', text: col.time });
			const entry = col.nodes.get(type);
			const originalIndex = entry ? getOriginalIndex(entry) : -1;
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
		row++;
	}

	place(grid.createDiv('wn-trajectory-divider'), row, 1, columns.length + 1);
	row++;

	const itemTextElements = new Map<string, Set<HTMLElement>>();

	const registerItemTextEl = (editKey: string, el: HTMLElement) => {
		let set = itemTextElements.get(editKey);
		if (!set) {
			set = new Set<HTMLElement>();
			itemTextElements.set(editKey, set);
		}
		set.add(el);
	};

	const updateItemTextDom = (editKey: string, desc: string, targetOriginalIndex: number) => {
		const set = itemTextElements.get(editKey);
		if (!set) return;
		const trimmed = desc.trim();
		const hasDesc = trimmed.length > 0;

		for (const el of set) {
			teardownStickyNoteParagraphEditor(el);
			el.empty();
			el.removeClass('is-editing');
			if (hasDesc) {
				el.removeClass('is-empty');
				setStickyNoteEditorContent(el, desc);
			} else {
				el.addClass('is-empty');
				el.setText(t('trajectory.no-description'));
			}
			if (allEntries && onUpdateEntry && targetOriginalIndex !== -1) {
				el.setAttribute('role', 'button');
				el.tabIndex = 0;
				el.onkeydown = (e) => {
					if (e.key !== 'Enter' && e.key !== ' ') return;
					e.preventDefault();
					el.click();
				};
			}
		}
	};

	const unassociatedColsMap = new Map<number, TrajectoryItemRef[]>();
	const loreColsMap = new Map<string, Map<number, TrajectoryItemRef[]>>();
	for (const lore of lores) {
		loreColsMap.set(lore, new Map<number, TrajectoryItemRef[]>());
	}

	let hasUnassociated = false;
	columns.forEach((col, colIndex) => {
		for (const itemRef of col.items) {
			const entryLores = itemRef.entry.lores;
			if (!entryLores || entryLores.length === 0) {
				hasUnassociated = true;
				let list = unassociatedColsMap.get(colIndex);
				if (!list) {
					list = [];
					unassociatedColsMap.set(colIndex, list);
				}
				list.push(itemRef);
			} else {
				for (const lore of new Set(entryLores)) {
					const colMap = loreColsMap.get(lore);
					if (colMap) {
						let list = colMap.get(colIndex);
						if (!list) {
							list = [];
							colMap.set(colIndex, list);
						}
						list.push(itemRef);
					}
				}
			}
		}
	});

	const renderLoreLane = (
		label: string,
		occupiedColsMap: Map<number, TrajectoryItemRef[]>,
		isUnassociated = false
	): void => {
		place(grid.createDiv({ cls: `wn-trajectory-lane-header is-lore${isUnassociated ? ' is-unassociated' : ''}`, text: label }), row, 1);

		if (columns.length > 0) {
			const laneBg = grid.createDiv('wn-trajectory-lane-bg is-lore');
			place(laneBg, row, 2, columns.length);
		}

		occupiedColsMap.forEach((matchingItems, colIndex) => {
			if (matchingItems.length === 0) return;
			const cell = grid.createDiv('wn-trajectory-cell is-lore');
			place(cell, row, colIndex + 2);

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

				const editKey = `${originalIndex}-${itemIndex}`;
				registerItemTextEl(editKey, textDiv);

				textDiv.onclick = (e) => {
					e.stopPropagation();
					if (textDiv.hasClass('is-editing') || !allEntries || !onUpdateEntry || originalIndex === -1) return;

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

					let saveDone = false;
					const saveDesc = async () => {
						if (saveDone || !textDiv.hasClass('is-editing')) return;
						saveDone = true;
						activeEditorBlurMap.delete(editKey);

						const newVal = getStickyNoteEditorContent(textDiv).trim();

						if (newVal === currentDesc) {
							updateItemTextDom(editKey, currentDesc, originalIndex);
							activeEdits.delete(editKey);
							return;
						}

						updateItemTextDom(editKey, newVal, originalIndex);

						activeSavesCount++;
						if (activeSavesCount === 1) {
							onSaveStateChange?.(true);
						}

						const targetOriginalIndex = originalIndex;

						const executeTask = async () => {
							const targetEntry = allEntries[targetOriginalIndex] ?? entry;
							const originalItemDesc = currentDesc;

							const expectedEntrySnapshot: TimelineEntry = {
								...targetEntry,
								lores: targetEntry.lores ? [...targetEntry.lores] : undefined,
								items: targetEntry.items ? targetEntry.items.map(it => ({ ...it })) : undefined
							};

							const clonedItems = targetEntry.items && targetEntry.items.length > 0
								? targetEntry.items.map((it, idx) => ({
									...it,
									description: idx === itemIndex ? newVal : it.description
								}))
								: undefined;

							const entrySnapshot: TimelineEntry = {
								...targetEntry,
								lores: targetEntry.lores ? [...targetEntry.lores] : undefined,
								items: clonedItems,
								description: clonedItems ? targetEntry.description : newVal
							};

							try {
								await onUpdateEntry(targetOriginalIndex, entrySnapshot, expectedEntrySnapshot);
								if (targetEntry.items && targetEntry.items[itemIndex]) {
									targetEntry.items[itemIndex].description = newVal;
								} else {
									targetEntry.description = newVal;
								}
								item.description = newVal;
							} catch (err) {
								Logger.error('[TrajectoryBoard] Failed to update description:', err);
								new Notice(t('trajectory.save-failed'));
								if (targetEntry.items && targetEntry.items[itemIndex]) {
									targetEntry.items[itemIndex].description = originalItemDesc;
								} else {
									targetEntry.description = originalItemDesc;
								}
								item.description = originalItemDesc;
								updateItemTextDom(editKey, originalItemDesc, originalIndex);
							} finally {
								activeSavesCount--;
								if (activeSavesCount === 0) {
									onSaveStateChange?.(false);
								}
								activeEdits.delete(editKey);
							}
						};

						let queuedPromise: Promise<void>;
						if (!activeSaveChain) {
							queuedPromise = executeTask();
						} else {
							const prev = activeSaveChain;
							queuedPromise = prev.then(executeTask, executeTask);
						}
						activeSaveChain = queuedPromise;
						pendingSavePromises.add(queuedPromise);
						void queuedPromise.finally(() => {
							pendingSavePromises.delete(queuedPromise);
							if (activeSaveChain === queuedPromise) {
								activeSaveChain = null;
							}
						}).catch(err => Logger.error('[TrajectoryBoard] Save cleanup failed:', err));
						await queuedPromise;
					};

					activeEditorBlurMap.set(editKey, saveDesc);
					textDiv.onblur = () => { void saveDesc(); };
				};
			}
		});
		row++;
	};

	if (hasUnassociated) {
		renderLoreLane(t('trajectory.unassociated'), unassociatedColsMap, true);
	}
	for (const lore of lores) {
		const colMap = loreColsMap.get(lore) ?? new Map<number, TrajectoryItemRef[]>();
		renderLoreLane(lore, colMap);
	}
}
