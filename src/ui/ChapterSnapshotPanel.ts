import type { App, EventRef } from 'obsidian';
import { MarkdownView, setIcon, TFile } from 'obsidian';
import type { NativeSnapshotService, NativeSnapshotMeta } from '../services/NativeSnapshotService';
import { getChapterSnapshotScopes } from '../services/NativeSnapshotService';
import type { ChapterSnapshotRef, WritingJourneyEvent } from '../types/writingJourney';
import { ChapterDiffEngine, isFormattingOnlyRow, type ChapterDiffResult, type AlignedDiffRow } from '../services/ChapterDiffEngine';
import { getCorkboardStatusText } from '../i18n/data-keys';
import { t } from '../i18n';
import { Logger } from '../utils/Logger';

export interface ChapterSnapshotPanelOptions {
	app: App;
	nativeSnapshotService: NativeSnapshotService;
	ownerDocument: Document;
	chapterFile: TFile | null;
	chapterPath: string;
	chapterTitle: string;
	initialLeftSnapshotKey?: number;
	initialSnapshotRef?: ChapterSnapshotRef;
	initialRightMode?: 'current' | number;
	journeyEvent?: WritingJourneyEvent;
	sourceEditor?: MarkdownView | null;
	allJourneyEvents?: readonly WritingJourneyEvent[];
	onClose: () => void;
}

interface CachedSnapshotEntry {
	key: number;
	text: string;
	deviceId: string;
	dbName: string;
	path: string;
	ts: number;
}

export class ChapterSnapshotPanel {
	private app: App;
	private nativeSnapshotService: NativeSnapshotService;
	private doc: Document;
	private win: Window;
	private onCloseCallback: () => void;

	private chapterFile: TFile | null;
	private chapterPath: string;
	private chapterTitle: string;
	private allJourneyEvents: readonly WritingJourneyEvent[];
	private sourceEditor: MarkdownView | null = null;
	private journeyEventId?: string;

	public currentSnapshotRef: ChapterSnapshotRef | null = null;
	private snapshotUnavailableNotice: string | null = null;

	public panelEl: HTMLElement;
	private bodyEl: HTMLElement;
	public diffContainerEl: HTMLElement;
	public readyPromise: Promise<void>;
	private leftSelectEl: HTMLSelectElement | null = null;
	private rightSelectEl: HTMLSelectElement | null = null;
	private singleViewBtnEl: HTMLButtonElement | null = null;
	private onlyDifferencesBtnEl: HTMLButtonElement | null = null;
	private previousDiffBtnEl: HTMLButtonElement | null = null;
	private nextDiffBtnEl: HTMLButtonElement | null = null;
	private onlyDifferences = false;
	private onlyPhoneDifferences = true;
	private isPhonePortrait = false;
	private orientationQuery: MediaQueryList | null = null;
	private navigationTargets: HTMLElement[][] = [];
	private changeOffsets: number[] | null = null;
	private scrollRafId: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private observedContentRoot: HTMLElement | null = null;
	private currentChangeIndex: number | null = null;
	private navigationScrollTop: number | null = null;
	private boundDiffScroll = () => this.onDiffScroll();
	private boundYamlToggle = () => this.onYamlToggle();
	private boundOrientationChange = () => this.updatePresentationMode();
	private boundLayoutInvalidate = () => {
		if (this.isDestroyed) return;
		this.invalidateNavigationLayout();
		this.scheduleNavigationUpdate();
	};

	private isSingleView = false;
	private isComposing = false;
	private hasPendingDiffAfterComposition = false;
	private isDestroyed = false;

	private leftMode: 'current' | number | null = null;
	private rightMode: 'current' | number = 'current';

	private leftContent = '';
	private rightContent = '';
	private cachedLeftSnapshot: CachedSnapshotEntry | null = null;
	private cachedRightSnapshot: CachedSnapshotEntry | null = null;
	private diffResult: ChapterDiffResult | null = null;
	private diffGeneration = 0;
	private renderGeneration = 0;
	private listGeneration = 0;

	private snapshotsMetaList: NativeSnapshotMeta[] = [];
	private snapshotsListScope: { deviceId: string; dbName: string } | null = null;
	private editorDebounceTimer: number | null = null;
	private editorChangeRef: EventRef | null = null;
	private cssChangeRef: EventRef | null = null;
	private vaultModifyRef: EventRef | null = null;
	private vaultRenameRef: EventRef | null = null;
	private vaultDeleteRef: EventRef | null = null;

	// Dragging state
	private isDragging = false;
	private dragPointerId: number | null = null;
	private dragStartX = 0;
	private dragStartY = 0;
	private panelStartX = 0;
	private panelStartY = 0;

	// Bound DOM handlers for cleanup
	private boundPointerMove: (e: PointerEvent) => void;
	private boundPointerUp: (e: PointerEvent) => void;
	private boundCompStart: (e: CompositionEvent) => void;
	private boundCompEnd: (e: CompositionEvent) => void;
	private boundWindowUnload: () => void;
	private boundFullscreenChange: () => void;
	private boundResize: () => void;

	constructor(options: ChapterSnapshotPanelOptions) {
		this.app = options.app;
		this.nativeSnapshotService = options.nativeSnapshotService;
		this.doc = options.ownerDocument;
		if (!this.doc.defaultView) throw new Error('Snapshot panel requires an attached window');
		this.win = this.doc.defaultView;
		this.chapterFile = options.chapterFile;
		this.chapterPath = options.chapterPath;
		this.chapterTitle = options.chapterTitle;
		this.allJourneyEvents = options.allJourneyEvents ?? [];
		this.sourceEditor = options.sourceEditor ?? null;
		this.journeyEventId = options.journeyEvent?.id;
		this.onCloseCallback = options.onClose;

		if (options.journeyEvent) {
			if (options.journeyEvent.type === 'chapter.status_changed') {
				if (options.journeyEvent.snapshot) {
					this.currentSnapshotRef = options.journeyEvent.snapshot;
					this.leftMode = options.journeyEvent.snapshot.key;
				} else {
					this.currentSnapshotRef = null;
					this.leftMode = null;
					this.snapshotUnavailableNotice = t('snapshot.no-journey-snapshot');
				}
			}
		} else if (options.initialSnapshotRef) {
			this.currentSnapshotRef = options.initialSnapshotRef;
			this.leftMode = options.initialSnapshotRef.key;
		} else if (options.initialLeftSnapshotKey !== undefined) {
			this.leftMode = options.initialLeftSnapshotKey;
		}

		if (options.initialRightMode !== undefined) {
			this.rightMode = options.initialRightMode;
		} else {
			this.rightMode = this.chapterFile ? 'current' : (typeof this.leftMode === 'number' ? this.leftMode : 'current');
		}

		this.boundPointerMove = this.onPointerMove.bind(this);
		this.boundPointerUp = this.onPointerUp.bind(this);
		this.boundCompStart = (e: CompositionEvent) => {
			const target = e.target as Node | null;
			if (this.hasCurrentSide() && this.isEventInBoundEditor(target)) {
				this.isComposing = true;
				this.cancelRefresh();
				this.hasPendingDiffAfterComposition = true;
			}
		};
		this.boundCompEnd = (e: CompositionEvent) => {
			const target = e.target as Node | null;
			if (this.isEventInBoundEditor(target)) {
				this.isComposing = false;
				if (this.hasPendingDiffAfterComposition) {
					this.hasPendingDiffAfterComposition = false;
					this.triggerEditorRefresh();
				}
			}
		};
		this.boundWindowUnload = () => {
			this.destroy();
		};
		this.boundResize = () => {
			this.clampPosition();
			this.invalidateNavigationLayout();
			this.updatePresentationMode();
			this.updateNavigationButtons();
		};
		this.boundFullscreenChange = () => {
			const newParent = this.getMountParent();
			if (this.panelEl && this.panelEl.parentElement !== newParent) {
				newParent.appendChild(this.panelEl);
			}
		};

		const mountParent = this.getMountParent();
		this.panelEl = mountParent.createDiv('wn-snapshot-panel');
		this.panelEl?.setAttribute?.('role', 'region');
		this.panelEl?.setAttribute?.('aria-labelledby', 'wn-snapshot-panel-title');

		this.setupWindowEvents();
		this.buildHeader();

		this.bodyEl = this.panelEl.createDiv('wn-snapshot-body');
		this.buildBanner();
		this.buildToolbar();
		this.diffContainerEl = this.bodyEl.createDiv('wn-snapshot-diff-content');

		this.orientationQuery = this.win.matchMedia?.('(orientation: portrait)') ?? null;
		this.orientationQuery?.addEventListener('change', this.boundOrientationChange);
		this.diffContainerEl.addEventListener('scroll', this.boundDiffScroll, { passive: true });
		const ResizeObserverCtor = (this.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (typeof ResizeObserverCtor === 'function') {
			this.resizeObserver = new ResizeObserverCtor(this.boundLayoutInvalidate);
			this.resizeObserver.observe(this.panelEl);
			this.resizeObserver.observe(this.diffContainerEl);
		}
		this.updatePresentationMode();
		this.readyPromise = this.initializeData();
	}

	private getMountParent(): HTMLElement {
		const fullscreen = this.doc.fullscreenElement;
		// 根元素全屏已包含 body；留在 body 内才能继承 Obsidian 主题和原生控件样式。
		return (fullscreen && fullscreen !== this.doc.documentElement ? fullscreen : this.doc.body) as HTMLElement;
	}

	private isEventInBoundEditor(target: Node | null): boolean {
		if (!target) return false;
		if (this.sourceEditor?.file === this.chapterFile && this.sourceEditor?.containerEl?.contains(target)) return true;
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			if (leaf.view instanceof MarkdownView && leaf.view.file === this.chapterFile) {
				if (leaf.containerEl?.contains(target)) return true;
			}
		}
		return false;
	}

	private setupWindowEvents(): void {
		this.doc.addEventListener('compositionstart', this.boundCompStart);
		this.doc.addEventListener('compositionend', this.boundCompEnd);
		this.win.addEventListener('unload', this.boundWindowUnload);
		this.win.addEventListener('resize', this.boundResize);
		this.doc.addEventListener('fullscreenchange', this.boundFullscreenChange);
		this.cssChangeRef = this.app.workspace.on?.('css-change', this.boundLayoutInvalidate) ?? null;
		this.doc.fonts?.addEventListener?.('loadingdone', this.boundLayoutInvalidate);

		// 监听 editor-change 事件（500ms 停顿刷新，不抢焦点）
		this.editorChangeRef = this.app.workspace.on('editor-change', (editor, info) => {
			if (this.isDestroyed || !this.hasCurrentSide() || !this.chapterFile || info?.file !== this.chapterFile) return;
			if (this.sourceEditor && editor !== this.sourceEditor.editor) return;
			if (!this.sourceEditor && info instanceof MarkdownView && info.containerEl.ownerDocument !== this.doc) return;

			if (this.isComposing) {
				this.hasPendingDiffAfterComposition = true;
				return;
			}

			this.scheduleEditorRefresh(editor.getValue());
		});

		// 监听 vault 事件
		this.vaultModifyRef = this.app.vault.on?.('modify', (file) => {
			if (this.isDestroyed) return;
			if (file === this.chapterFile && this.resolveCurrentEditorText() === null && (this.leftMode === 'current' || this.rightMode === 'current')) {
				void this.loadAndRenderDiff();
			}
		});

		this.vaultRenameRef = this.app.vault.on?.('rename', (file) => {
			if (this.isDestroyed) return;
			if (file === this.chapterFile && file instanceof TFile) {
				this.chapterTitle = file.basename;
				const chapterSpan = this.panelEl.querySelector('.wn-snapshot-chapter-name');
				if (chapterSpan) {
					chapterSpan.setText(`(${this.chapterTitle})`);
				}
			}
		});

		this.vaultDeleteRef = this.app.vault.on?.('delete', (file) => {
			if (this.isDestroyed) return;
			if (file === this.chapterFile) {
				this.chapterFile = null;
				this.sourceEditor = null;
				if (this.leftMode === 'current' && typeof this.rightMode === 'number') this.leftMode = this.rightMode;
				if (this.rightMode === 'current' && typeof this.leftMode === 'number') this.rightMode = this.leftMode;
				this.cachedLeftSnapshot = null;
				this.cachedRightSnapshot = null;
				this.diffResult = null;
				this.renderGeneration = (this.renderGeneration ?? 0) + 1;
				this.populateDropdowns();
				void this.loadAndRenderDiff();
			}
		});
	}

	private hasCurrentSide(): boolean {
		return this.leftMode === 'current' || this.rightMode === 'current';
	}

	private cancelRefresh(): void {
		this.diffGeneration++;
		if (this.editorDebounceTimer !== null) this.win.clearTimeout(this.editorDebounceTimer);
		this.editorDebounceTimer = null;
	}

	private scheduleEditorRefresh(text: string): void {
		if (this.editorDebounceTimer !== null) {
			this.win.clearTimeout(this.editorDebounceTimer);
			this.editorDebounceTimer = null;
		}

		const targetGen = ++this.diffGeneration;
		this.editorDebounceTimer = this.win.setTimeout(() => {
			this.editorDebounceTimer = null;
			if (this.isDestroyed || this.isComposing || !this.hasCurrentSide() || targetGen !== this.diffGeneration) {
				return;
			}
			void this.loadAndRenderDiff(text);
		}, 500);
	}

	private triggerEditorRefresh(): void {
		if (!this.hasCurrentSide()) return;
		const editorText = this.resolveCurrentEditorText();
		if (editorText !== null) {
			this.scheduleEditorRefresh(editorText);
		} else void this.loadAndRenderDiff();
	}

	private resolveCurrentEditorText(): string | null {
		if (!this.chapterFile) return null;
		if (this.sourceEditor && this.sourceEditor.file === this.chapterFile) {
			return this.sourceEditor.editor?.getValue() ?? this.sourceEditor.getViewData() ?? '';
		}

		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			if (leaf.view instanceof MarkdownView && leaf.view.file === this.chapterFile) {
				if (leaf.containerEl?.ownerDocument === this.doc) {
					return leaf.view.editor?.getValue() ?? leaf.view.getViewData() ?? '';
				}
			}
		}

		return null;
	}

	private buildHeader(): void {
		const headerEl = this.panelEl.createDiv('wn-snapshot-header');

		const titleGroup = headerEl.createDiv('wn-snapshot-title-group');
		const iconSpan = titleGroup.createSpan('wn-snapshot-header-icon');
		setIcon(iconSpan, 'history');
		const titleSpan = titleGroup.createSpan('wn-snapshot-header-title');
		titleSpan.id = 'wn-snapshot-panel-title';
		titleSpan.setText(t('snapshot.title'));

		const chapterSpan = titleGroup.createSpan('wn-snapshot-chapter-name');
		chapterSpan.setText(`(${this.chapterTitle})`);

		const actionsGroup = headerEl.createDiv('wn-snapshot-header-actions');

		// 关闭按钮
		const closeBtn = actionsGroup.createEl('button', {
			cls: 'wn-snapshot-btn-close',
			text: t('snapshot.action-close')
		});
		closeBtn?.setAttribute?.('aria-label', t('snapshot.action-close'));
		closeBtn.onclick = (e) => {
			e.stopPropagation();
			this.destroy();
		};

		// 拖拽逻辑
		headerEl.addEventListener('pointerdown', (e: PointerEvent) => {
			if ((e.target as HTMLElement).closest?.('button') || e.button !== 0) {
				return;
			}
			this.startDragging(e);
		});
	}

	private buildBanner(): void {
		const banner = this.bodyEl.createDiv('wn-snapshot-banner');
		const bannerIcon = banner.createSpan('wn-snapshot-banner-icon');
		setIcon(bannerIcon, 'info');
		const bannerText = banner.createSpan('wn-snapshot-banner-text');
		bannerText.setText(t('snapshot.banner-local-retention'));
	}

	private buildToolbar(): void {
		const toolbar = this.bodyEl.createDiv('wn-snapshot-toolbar');

		// 左侧下拉框（基准快照）
		const leftGroup = toolbar.createDiv('wn-snapshot-select-group wn-snapshot-select-left');
		const leftLabel = leftGroup.createEl('label');
		leftLabel.setText(t('snapshot.label-left'));
		leftLabel?.setAttribute?.('for', 'wn-snapshot-select-left');
		this.leftSelectEl = leftGroup.createEl('select', { cls: 'dropdown' });
		this.leftSelectEl.id = 'wn-snapshot-select-left';
		this.leftSelectEl?.setAttribute?.('aria-label', t('snapshot.label-left'));
		this.leftSelectEl.onchange = () => {
			if (this.editorDebounceTimer !== null) {
				this.win.clearTimeout(this.editorDebounceTimer);
				this.editorDebounceTimer = null;
			}
			const rawVal = this.leftSelectEl?.value ?? '';
			if (rawVal === 'current') {
				this.leftMode = 'current';
			} else {
				const val = parseInt(rawVal, 10);
				this.leftMode = isNaN(val) ? null : val;
			}
			this.cachedLeftSnapshot = null;
			this.diffResult = null;
			this.renderGeneration = (this.renderGeneration ?? 0) + 1;
			this.snapshotUnavailableNotice = null;
			void this.loadAndRenderDiff();
		};

		// 交换两侧按钮（文字标签）
		const swapBtn = toolbar.createEl('button', {
			cls: 'wn-snapshot-btn-swap',
			text: t('snapshot.swap-sides')
		});
		swapBtn?.setAttribute?.('aria-label', t('snapshot.swap-sides'));
		swapBtn.onclick = () => {
			this.swapSides();
		};

		// 右侧下拉框（对比版本：当前稿或历史快照）
		const rightGroup = toolbar.createDiv('wn-snapshot-select-group wn-snapshot-select-right');
		const rightLabel = rightGroup.createEl('label');
		rightLabel.setText(t('snapshot.label-right'));
		rightLabel?.setAttribute?.('for', 'wn-snapshot-select-right');
		this.rightSelectEl = rightGroup.createEl('select', { cls: 'dropdown' });
		this.rightSelectEl.id = 'wn-snapshot-select-right';
		this.rightSelectEl?.setAttribute?.('aria-label', t('snapshot.label-right'));
		this.rightSelectEl.onchange = () => {
			if (this.editorDebounceTimer !== null) {
				this.win.clearTimeout(this.editorDebounceTimer);
				this.editorDebounceTimer = null;
			}
			const rawVal = this.rightSelectEl?.value ?? '';
			if (rawVal === 'current') {
				this.rightMode = 'current';
			} else {
				const numVal = parseInt(rawVal, 10);
				this.rightMode = isNaN(numVal) ? 'current' : numVal;
			}
			this.cachedRightSnapshot = null;
			this.diffResult = null;
			this.renderGeneration = (this.renderGeneration ?? 0) + 1;
			this.snapshotUnavailableNotice = null;
			void this.loadAndRenderDiff();
		};

		// 工具区右侧操作集合
		const actionsGroup = toolbar.createDiv('wn-snapshot-toolbar-actions');

		// 单侧查看切换
		this.singleViewBtnEl = actionsGroup.createEl('button', {
			cls: 'wn-snapshot-btn-single',
			text: t('snapshot.toggle-single')
		});
		this.singleViewBtnEl?.setAttribute?.('aria-pressed', 'false');
		this.singleViewBtnEl.onclick = () => {
			this.isSingleView = !this.isSingleView;
			if (this.isSingleView) this.onlyDifferences = false;
			this.updatePresentationControls();
			if (this.diffResult) void this.renderPresentation();
		};
		this.onlyDifferencesBtnEl = actionsGroup.createEl('button', {
			cls: 'wn-snapshot-btn-only-differences', text: t('snapshot.only-differences')
		});
		this.onlyDifferencesBtnEl.onclick = () => {
			if (this.isPhonePortrait) this.onlyPhoneDifferences = !this.onlyPhoneDifferences;
			else {
				this.onlyDifferences = !this.onlyDifferences;
				if (this.onlyDifferences) this.isSingleView = false;
			}
			this.updatePresentationControls();
			if (this.diffResult) void this.renderPresentation();
		};

		// 上一处 / 下一处差异
		const prevBtn = actionsGroup.createEl('button', {
			cls: 'wn-snapshot-btn-prev',
			text: t('snapshot.prev-diff')
		});
		prevBtn?.setAttribute?.('aria-label', t('snapshot.prev-diff'));
		this.previousDiffBtnEl = prevBtn;
		prevBtn.disabled = true;
		prevBtn.onclick = () => this.navigateDiff(-1);

		const nextBtn = actionsGroup.createEl('button', {
			cls: 'wn-snapshot-btn-next',
			text: t('snapshot.next-diff')
		});
		nextBtn?.setAttribute?.('aria-label', t('snapshot.next-diff'));
		this.nextDiffBtnEl = nextBtn;
		nextBtn.disabled = true;
		nextBtn.onclick = () => this.navigateDiff(1);
	}

	private swapSides(): void {
		if (this.editorDebounceTimer !== null) {
			this.win.clearTimeout(this.editorDebounceTimer);
			this.editorDebounceTimer = null;
		}
		this.diffGeneration++;
		this.renderGeneration = (this.renderGeneration ?? 0) + 1;
		this.diffResult = null;

		const oldLeft = this.leftMode;
		const oldRight = this.rightMode;

		this.leftMode = oldRight === 'current' ? 'current' : oldRight;
		this.rightMode = oldLeft ?? 'current';

		const prevLeftCache = this.cachedLeftSnapshot;
		this.cachedLeftSnapshot = this.cachedRightSnapshot;
		this.cachedRightSnapshot = prevLeftCache;

		this.snapshotUnavailableNotice = null;

		this.updateSelectDropdownValues();
		void this.loadAndRenderDiff();
	}

	private get showOnlyDifferences(): boolean {
		return this.isPhonePortrait ? this.onlyPhoneDifferences : this.onlyDifferences;
	}

	private updatePresentationMode(): void {
		if (this.isDestroyed) return;
		const next = this.doc.body.hasClass?.('is-phone') === true
			&& (this.orientationQuery?.matches ?? this.win.innerHeight >= this.win.innerWidth);
		const changed = next !== this.isPhonePortrait;
		this.isPhonePortrait = next;
		this.updatePresentationControls();
		if (changed && this.diffResult) void this.renderPresentation();
	}

	private async renderPresentation(): Promise<void> {
		if (this.isDestroyed || !this.diffResult) return;
		this.clearNavigation();
		await this.renderDiffDom(this.diffGeneration, this.diffResult);
	}

	private updatePresentationControls(): void {
		const single = this.isSingleView && !this.isPhonePortrait;
		this.panelEl.toggleClass('is-single-view', single);
		this.panelEl.toggleClass('is-unified-view', this.isPhonePortrait);
		this.singleViewBtnEl?.toggleClass('is-active', single);
		this.singleViewBtnEl?.setAttribute?.('aria-pressed', String(single));
		this.onlyDifferencesBtnEl?.toggleClass('is-active', this.showOnlyDifferences);
		this.onlyDifferencesBtnEl?.setAttribute?.('aria-pressed', String(this.showOnlyDifferences));
	}

	private cancelScrollRaf(): void {
		if (this.scrollRafId !== null && this.scrollRafId !== undefined) {
			if (typeof this.win?.cancelAnimationFrame === 'function') {
				this.win.cancelAnimationFrame(this.scrollRafId);
			} else {
				this.win?.clearTimeout?.(this.scrollRafId);
			}
			this.scrollRafId = null;
		}
	}

	private updateObservedContentRoot(nextRoot: HTMLElement | null): void {
		if (this.observedContentRoot === nextRoot) return;
		if (this.observedContentRoot) {
			this.resizeObserver?.unobserve?.(this.observedContentRoot);
		}
		this.observedContentRoot = nextRoot;
		if (nextRoot) {
			this.resizeObserver?.observe?.(nextRoot);
		}
	}

	private invalidateNavigationLayout(): void {
		this.changeOffsets = null;
	}

	private onDiffScroll(): void {
		if (this.isDestroyed) return;
		this.scheduleNavigationUpdate();
	}

	private onYamlToggle(): void {
		if (this.isDestroyed) return;
		this.invalidateNavigationLayout();
		this.updateNavigationButtons();
	}

	private scheduleNavigationUpdate(): void {
		if (this.scrollRafId !== null && this.scrollRafId !== undefined) return;
		if (typeof this.win?.requestAnimationFrame === 'function') {
			this.scrollRafId = this.win.requestAnimationFrame(() => {
				this.scrollRafId = null;
				if (this.isDestroyed) return;
				this.updateNavigationButtons();
			});
		} else {
			this.scrollRafId = this.win.setTimeout(() => {
				this.scrollRafId = null;
				if (this.isDestroyed) return;
				this.updateNavigationButtons();
			}, 16);
		}
	}

	private clearDiffHighlight(): void {
		this.diffContainerEl.querySelectorAll<HTMLElement>('.is-current-diff').forEach(el => {
			el.removeClass('is-current-diff');
			el.removeAttribute('aria-current');
		});
	}

	private clearNavigation(): void {
		this.cancelScrollRaf();
		this.clearDiffHighlight();
		this.navigationTargets = [];
		this.changeOffsets = null;
		this.currentChangeIndex = null;
		this.navigationScrollTop = null;
		this.updateNavigationButtons();
	}

	private measureTargetOffset(index: number, containerTop: number, scrollTop: number, expand = false): number {
		const group = this.navigationTargets[index];
		let anchor = group.find(el => el.tagName === 'INS' && /\S/u.test(el.textContent ?? ''))
			?? group.find(el => /\S/u.test(el.textContent ?? '')) ?? group[0];
		const details = anchor.closest?.('details');
		if (details && !details.open) {
			if (expand) {
				details.open = true;
				this.changeOffsets = null;
			} else {
				anchor = details.querySelector('summary') ?? anchor;
			}
		}
		let rect: DOMRect | undefined;
		const text = anchor.firstChild;
		if (text?.nodeType === 3 && /\S/u.test(text.textContent ?? '')) {
			const value = text.textContent ?? '';
			const offset = value.search(/\S/u);
			const range = this.doc.createRange();
			range.setStart(text, offset);
			range.setEnd(text, offset + ((value.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1));
			rect = range.getClientRects()[0];
		}
		rect ??= anchor.getClientRects()[0] ?? anchor.getBoundingClientRect();
		return rect.top - containerTop + scrollTop;
	}

	private ensureChangeOffsets(): number[] {
		if (this.changeOffsets && this.changeOffsets.length === this.navigationTargets.length) {
			return this.changeOffsets;
		}
		const containerTop = this.diffContainerEl.getBoundingClientRect().top;
		const scrollTop = this.diffContainerEl.scrollTop;
		const offsets = new Array<number>(this.navigationTargets.length);
		for (let i = 0; i < this.navigationTargets.length; i++) {
			offsets[i] = this.measureTargetOffset(i, containerTop, scrollTop, false);
		}
		this.changeOffsets = offsets;
		return offsets;
	}

	/** First changed character, not the center of a potentially very tall paragraph. */
	private getChangeOffset(index: number, expand = false): number {
		if (!expand) {
			return this.ensureChangeOffsets()[index];
		}
		const group = this.navigationTargets[index];
		const anchor = group.find(el => el.tagName === 'INS' && /\S/u.test(el.textContent ?? ''))
			?? group.find(el => /\S/u.test(el.textContent ?? '')) ?? group[0];
		const details = anchor.closest?.('details');
		if (details && !details.open) {
			return this.measureTargetOffset(
				index,
				this.diffContainerEl.getBoundingClientRect().top,
				this.diffContainerEl.scrollTop,
				true
			);
		}
		return this.ensureChangeOffsets()[index];
	}

	private findNavigationIndex(direction: -1 | 1): number {
		if (this.navigationTargets.length === 0) return -1;
		if (this.currentChangeIndex !== null && this.navigationScrollTop !== null
			&& Math.abs(this.diffContainerEl.scrollTop - this.navigationScrollTop) < 2) {
			const next = this.currentChangeIndex + direction;
			return next >= 0 && next < this.navigationTargets.length ? next : -1;
		}
		if (direction === 1 && this.diffContainerEl.scrollTop <= 0) return 0;
		const offset = this.diffContainerEl.scrollTop + 12;
		const offsets = this.ensureChangeOffsets();
		if (direction === 1) return offsets.findIndex(targetOffset => targetOffset >= offset - 1);
		for (let index = offsets.length - 1; index >= 0; index--) {
			if (offsets[index] < offset - 1) return index;
		}
		return -1;
	}

	private updateNavigationButtons(): void {
		if (this.previousDiffBtnEl) this.previousDiffBtnEl.disabled = this.findNavigationIndex(-1) < 0;
		if (this.nextDiffBtnEl) this.nextDiffBtnEl.disabled = this.findNavigationIndex(1) < 0;
	}

	private navigateDiff(direction: -1 | 1): void {
		const index = this.findNavigationIndex(direction);
		if (index < 0) return;
		const offset = this.getChangeOffset(index, true) - 12;
		const max = Math.max(0, this.diffContainerEl.scrollHeight - this.diffContainerEl.clientHeight);
		const top = Math.max(0, Math.min(offset, max));
		this.currentChangeIndex = index;
		this.navigationScrollTop = top;
		this.clearDiffHighlight();
		for (const anchor of this.navigationTargets[index]) {
			anchor.addClass('is-current-diff');
			const row = anchor.closest<HTMLElement>('.wn-snapshot-row, .wn-snapshot-yaml-line');
			row?.addClass('is-current-diff');
			row?.setAttribute('aria-current', 'true');
		}
		this.diffContainerEl.scrollTo({ top, behavior: 'instant' });
		this.updateNavigationButtons();
	}

	private formatSnapshotLabel(meta: NativeSnapshotMeta): string {
		const d = new Date(meta.ts);
		const pad = (n: number) => String(n).padStart(2, '0');
		const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

		let statusLabel = '';
		for (const ev of this.allJourneyEvents) {
			if (ev.type === 'chapter.status_changed' && ev.snapshot) {
				if (ev.snapshot.key === meta.key && ev.snapshot.ts === meta.ts && ev.snapshot.path === meta.path && ev.snapshot.deviceId === this.nativeSnapshotService.getOrCreateDeviceId()) {
					const localizedStatus = getCorkboardStatusText(ev.toStatus);
					statusLabel = ` [${t('snapshot.status-label-prefix')}: ${localizedStatus}]`;
					break;
				}
			}
		}

		const charsUnit = t('snapshot.chars');
		const sizeStr = meta.size !== undefined ? ` (${meta.size.toLocaleString()} ${charsUnit})` : '';
		return `${timeStr}${statusLabel}${sizeStr}`;
	}

	private async fetchSnapshotsMetaList(status: { deviceId: string; dbName: string }): Promise<NativeSnapshotMeta[]> {
		const scopes = getChapterSnapshotScopes(this.allJourneyEvents, this.chapterPath, this.journeyEventId);
		const lists = await Promise.all(scopes.map(async scope => {
			const list = await this.nativeSnapshotService.listSnapshotsForPath(scope.path);
			return list.filter(meta => meta.ts >= scope.from && meta.ts <= scope.to);
		}));
		const metas = new Map(lists.flat().map(meta => [meta.key, meta]));
		const ref = this.currentSnapshotRef;
		if (ref && ref.deviceId === status.deviceId && ref.dbName === status.dbName) {
			metas.set(ref.key, { key: ref.key, path: ref.path, ts: ref.ts });
		}
		return [...metas.values()].sort((a, b) => b.ts - a.ts);
	}

	private async initializeData(): Promise<void> {
		this.clearNavigation();
		this.cachedLeftSnapshot = null;
		this.cachedRightSnapshot = null;
		this.snapshotsListScope = null;
		this.diffResult = null;
		this.renderGeneration = (this.renderGeneration ?? 0) + 1;
		const curListGen = ++this.listGeneration;
		try {
			const status = this.nativeSnapshotService.checkStatus();
			if (status.status !== 'available') {
				if (!this.isDestroyed && curListGen === this.listGeneration) {
					this.updateObservedContentRoot(null);
					this.diffContainerEl.setText(status.status === 'disabled' ? t('snapshot.recovery-disabled') : status.status === 'not-ready' ? t('snapshot.recovery-not-ready') : t('snapshot.recovery-unsupported'));
				}
				return;
			}
			const nextMetaList = await this.fetchSnapshotsMetaList(status);
			if (curListGen !== this.listGeneration || this.isDestroyed) return;
			const postStatus = this.nativeSnapshotService.checkStatus();
			if (postStatus.status !== 'available' || postStatus.deviceId !== status.deviceId || postStatus.dbName !== status.dbName) {
				this.snapshotsMetaList = [];
				this.snapshotsListScope = null;
				this.updateObservedContentRoot(null);
				this.diffContainerEl.setText(t('snapshot.missing-ref'));
				return;
			}
			this.snapshotsMetaList = nextMetaList;
			this.snapshotsListScope = { deviceId: postStatus.deviceId, dbName: postStatus.dbName };
		} catch (err) {
			if (curListGen !== this.listGeneration || this.isDestroyed) return;
			Logger.error('[ChapterSnapshotPanel] Failed to list snapshots:', err);
			this.snapshotsMetaList = [];
			this.snapshotsListScope = null;
			this.updateObservedContentRoot(null);
			this.diffContainerEl.setText(t('snapshot.missing-ref'));
			return;
		}
		if (this.leftMode === null && !this.snapshotUnavailableNotice && this.snapshotsMetaList.length > 0) {
			this.leftMode = this.snapshotsMetaList[0].key;
		}
		this.populateDropdowns();
		await this.loadAndRenderDiff();
	}

	private populateDropdowns(): void {
		if (!this.leftSelectEl || !this.rightSelectEl) return;

		this.leftSelectEl.empty();
		this.rightSelectEl.empty();

		const leftCurrentOpt = this.leftSelectEl.createEl('option', {
			value: 'current',
			text: this.chapterFile ? t('snapshot.current-draft') : t('snapshot.current-draft-disabled')
		});
		if (!this.chapterFile) {
			leftCurrentOpt.disabled = true;
		}

		if (this.snapshotsMetaList.length === 0) {
			const opt = this.leftSelectEl.createEl('option', { text: t('snapshot.no-snapshots') });
			opt.disabled = true;
		} else {
			for (const meta of this.snapshotsMetaList) {
				this.leftSelectEl.createEl('option', {
					value: String(meta.key),
					text: this.formatSnapshotLabel(meta)
				});
			}
		}

		const rightCurrentOpt = this.rightSelectEl.createEl('option', {
			value: 'current',
			text: this.chapterFile ? t('snapshot.current-draft') : t('snapshot.current-draft-disabled')
		});
		if (!this.chapterFile) {
			rightCurrentOpt.disabled = true;
		}

		for (const meta of this.snapshotsMetaList) {
			this.rightSelectEl.createEl('option', {
				value: String(meta.key),
				text: this.formatSnapshotLabel(meta)
			});
		}

		this.updateSelectDropdownValues();
	}

	private updateSelectDropdownValues(): void {
		if (this.leftSelectEl) {
			this.leftSelectEl.value = this.leftMode === null ? '' : String(this.leftMode);
		}
		if (this.rightSelectEl) {
			this.rightSelectEl.value = String(this.rightMode);
		}
	}

	public async rebindChapter(
		file: TFile | null,
		chapterPath: string,
		chapterTitle: string,
		events?: readonly WritingJourneyEvent[],
		snapshotRef?: ChapterSnapshotRef,
		snapshotKey?: number,
		journeyEvent?: WritingJourneyEvent,
		sourceEditor?: MarkdownView | null
	): Promise<void> {
		if (this.isDestroyed) return;

		if (this.editorDebounceTimer !== null) {
			this.win.clearTimeout(this.editorDebounceTimer);
			this.editorDebounceTimer = null;
		}

		this.diffGeneration++;
		this.renderGeneration = (this.renderGeneration ?? 0) + 1;
		this.chapterFile = file;
		this.chapterPath = chapterPath;
		this.chapterTitle = chapterTitle;
		if (events) this.allJourneyEvents = events;
		this.sourceEditor = sourceEditor ?? null;
		this.journeyEventId = journeyEvent?.id;
		this.isComposing = false;
		this.hasPendingDiffAfterComposition = false;
		this.leftContent = '';
		this.rightContent = '';
		this.cachedLeftSnapshot = null;
		this.cachedRightSnapshot = null;
		this.diffResult = null;

		const chapterSpan = this.panelEl.querySelector('.wn-snapshot-chapter-name');
		if (chapterSpan) {
			chapterSpan.setText(`(${this.chapterTitle})`);
		}

		this.currentSnapshotRef = snapshotRef ?? null;
		this.snapshotUnavailableNotice = null;

		if (journeyEvent) {
			if (journeyEvent.type === 'chapter.status_changed') {
				if (journeyEvent.snapshot) {
					this.currentSnapshotRef = journeyEvent.snapshot;
					this.leftMode = journeyEvent.snapshot.key;
				} else {
					this.currentSnapshotRef = null;
					this.leftMode = null;
					this.snapshotUnavailableNotice = t('snapshot.no-journey-snapshot');
				}
			}
		} else if (snapshotRef) {
			this.currentSnapshotRef = snapshotRef;
			this.leftMode = snapshotRef.key;
		} else if (snapshotKey !== undefined) {
			this.currentSnapshotRef = null;
			this.leftMode = snapshotKey;
		} else {
			this.currentSnapshotRef = null;
			this.leftMode = null;
		}

		this.rightMode = file ? 'current' : (typeof this.leftMode === 'number' ? this.leftMode : 'current');

		await this.initializeData();
	}

	private async loadAndRenderDiff(currentTextOverride?: string): Promise<void> {
		this.cancelRefresh();
		const currentGen = this.diffGeneration;
		this.clearNavigation();
		if (this.isDestroyed) return;
		if (this.isComposing) return;
		if (this.snapshotUnavailableNotice || this.leftMode === null) {
			this.diffResult = null;
			this.renderGeneration = (this.renderGeneration ?? 0) + 1;
			this.updateObservedContentRoot(null);
			this.diffContainerEl.setText(this.snapshotUnavailableNotice ?? t('snapshot.no-snapshots'));
			return;
		}
		const file = this.chapterFile;
		const currentText = currentTextOverride ?? this.resolveCurrentEditorText();
		const ref = this.currentSnapshotRef;
		if (typeof this.leftMode === 'number' || typeof this.rightMode === 'number') {
			const initialStatus = this.nativeSnapshotService.checkStatus();
			if (initialStatus.status !== 'available') {
				this.cachedLeftSnapshot = null;
				this.cachedRightSnapshot = null;
				this.snapshotsListScope = null;
			} else if (
				this.snapshotsListScope &&
				(this.snapshotsListScope.deviceId !== initialStatus.deviceId ||
					this.snapshotsListScope.dbName !== initialStatus.dbName)
			) {
				this.cachedLeftSnapshot = null;
				this.cachedRightSnapshot = null;
				try {
					const refreshedList = await this.fetchSnapshotsMetaList(initialStatus);
					if (currentGen !== this.diffGeneration || this.isDestroyed) return;
					const postStatus = this.nativeSnapshotService.checkStatus();
					if (
						postStatus.status !== 'available' ||
						postStatus.deviceId !== initialStatus.deviceId ||
						postStatus.dbName !== initialStatus.dbName
					) {
						throw new Error('Native snapshot scope changed while refreshing version list');
					}
					this.snapshotsMetaList = refreshedList;
					this.snapshotsListScope = { deviceId: postStatus.deviceId, dbName: postStatus.dbName };
					this.populateDropdowns();
				} catch (err) {
					if (currentGen !== this.diffGeneration || this.isDestroyed) return;
					this.snapshotsMetaList = [];
					this.snapshotsListScope = null;
					this.diffResult = null;
					this.renderGeneration = (this.renderGeneration ?? 0) + 1;
					this.updateObservedContentRoot(null);
					Logger.warn('[ChapterSnapshotPanel] Failed to refresh snapshot scope:', err);
					this.diffContainerEl.setText(t('snapshot.missing-ref'));
					return;
				}
			}
		}
		const canReuseCachedSnapshot = (cached: CachedSnapshotEntry | null, key: number): cached is CachedSnapshotEntry => {
			if (!cached || cached.key !== key) return false;
			const status = this.nativeSnapshotService.checkStatus();
			if (status.status !== 'available') return false;
			if (cached.deviceId !== status.deviceId || cached.dbName !== status.dbName) return false;
			if (ref?.key === key) {
				return (
					ref.deviceId === status.deviceId &&
					ref.dbName === status.dbName &&
					cached.path === ref.path &&
					cached.ts === ref.ts
				);
			}
			if (
				this.snapshotsListScope &&
				(this.snapshotsListScope.deviceId !== status.deviceId ||
					this.snapshotsListScope.dbName !== status.dbName)
			) {
				return false;
			}
			const meta = (this.snapshotsMetaList ?? []).find(item => item.key === key);
			return Boolean(meta && cached.path === meta.path && cached.ts === meta.ts);
		};
		const inFlightReads = new Map<'current' | number, Promise<{ text: string; cacheEntry?: CachedSnapshotEntry }>>();
		const readUncached = (mode: 'current' | number): Promise<{ text: string; cacheEntry?: CachedSnapshotEntry }> => {
			const existing = inFlightReads.get(mode);
			if (existing) return existing;
			const promise = (async () => {
				if (mode === 'current') {
					if (!file) throw new Error('Current chapter was deleted');
					if (currentText !== null) return { text: currentText };
					return { text: await this.app.vault.read(file) };
				}
				const statusBefore = this.nativeSnapshotService.checkStatus();
				if (statusBefore.status !== 'available') {
					throw new Error(`Native snapshot service is unavailable: ${statusBefore.status}`);
				}
				if (ref?.key === mode) {
					const text = await this.nativeSnapshotService.readSnapshot(ref);
					const statusAfter = this.nativeSnapshotService.checkStatus();
					if (
						statusAfter.status !== 'available' ||
						statusAfter.deviceId !== statusBefore.deviceId ||
						statusAfter.dbName !== statusBefore.dbName ||
						ref.deviceId !== statusAfter.deviceId ||
						ref.dbName !== statusAfter.dbName
					) {
						throw new Error('Snapshot scope changed during read');
					}
					return {
						text,
						cacheEntry: {
							key: mode,
							text,
							deviceId: statusAfter.deviceId,
							dbName: statusAfter.dbName,
							path: ref.path,
							ts: ref.ts
						}
					};
				}
				const meta = this.snapshotsMetaList.find(item => item.key === mode);
				if (!meta) throw new Error('Snapshot is not in the chapter version list');
				const text = await this.nativeSnapshotService.readSnapshotByKey(mode, meta.path, meta.ts);
				const statusAfter = this.nativeSnapshotService.checkStatus();
				if (
					statusAfter.status !== 'available' ||
					statusAfter.deviceId !== statusBefore.deviceId ||
					statusAfter.dbName !== statusBefore.dbName
				) {
					throw new Error('Snapshot scope changed during read');
				}
				return {
					text,
					cacheEntry: {
						key: mode,
						text,
						deviceId: statusAfter.deviceId,
						dbName: statusAfter.dbName,
						path: meta.path,
						ts: meta.ts
					}
				};
			})();
			inFlightReads.set(mode, promise);
			return promise;
		};
		const readSide = async (mode: 'current' | number, side: 'left' | 'right'): Promise<string> => {
			if (typeof mode === 'number') {
				const cached = side === 'left' ? this.cachedLeftSnapshot : this.cachedRightSnapshot;
				if (canReuseCachedSnapshot(cached, mode)) {
					return cached.text;
				}
				const { text, cacheEntry } = await readUncached(mode);
				if (currentGen === this.diffGeneration && !this.isDestroyed && cacheEntry) {
					if (side === 'left' && this.leftMode === mode) {
						this.cachedLeftSnapshot = cacheEntry;
					} else if (side === 'right' && this.rightMode === mode) {
						this.cachedRightSnapshot = cacheEntry;
					}
				}
				return text;
			}
			if (side === 'left') this.cachedLeftSnapshot = null;
			else this.cachedRightSnapshot = null;
			const { text } = await readUncached('current');
			return text;
		};
		try {
			const [left, right] = await Promise.all([
				readSide(this.leftMode, 'left'),
				readSide(this.rightMode, 'right')
			]);
			if (currentGen !== this.diffGeneration || this.isDestroyed) return;
			this.leftContent = left;
			this.rightContent = right;
			await this.recomputeDiff();
		} catch (err) {
			if (currentGen !== this.diffGeneration || this.isDestroyed) return;
			this.cachedLeftSnapshot = null;
			this.cachedRightSnapshot = null;
			this.diffResult = null;
			this.renderGeneration = (this.renderGeneration ?? 0) + 1;
			this.updateObservedContentRoot(null);
			Logger.warn('[ChapterSnapshotPanel] Failed to read selected versions:', err);
			this.diffContainerEl.setText(t('snapshot.missing-ref'));
		}
	}

	private async recomputeDiff(): Promise<void> {
		this.clearNavigation();
		const currentGen = ++this.diffGeneration;
		const isCancelled = () => currentGen !== this.diffGeneration || this.isDestroyed || this.isComposing;
		try {
			const result = await ChapterDiffEngine.computeDiff(this.leftContent, this.rightContent, {
				isCancelled
			});
			if (isCancelled()) return;
			this.diffResult = result;
			await this.renderDiffDom(currentGen, result);
		} catch (err) {
			if (isCancelled()) return;
			this.diffResult = null;
			this.renderGeneration = (this.renderGeneration ?? 0) + 1;
			this.updateObservedContentRoot(null);
			Logger.error('[ChapterSnapshotPanel] Failed to compute differences:', err);
			this.diffContainerEl.setText(t('snapshot.compare-failed'));
		}
	}

	private async renderDiffDom(generation: number, result = this.diffResult): Promise<void> {
		const renderGen = (this.renderGeneration = (this.renderGeneration ?? 0) + 1);
		const prevScrollTop = this.diffContainerEl.scrollTop ?? 0;
		const prevScrollLeft = this.diffContainerEl.scrollLeft ?? 0;

		const targets: HTMLElement[][] = [];
		const content = (this.win as Window & { createDiv: typeof createDiv }).createDiv();
		const yamlOpen = this.diffContainerEl.querySelector<HTMLDetailsElement>('details')?.open ?? false;

		if (!result) {
			return;
		}

		const isPhonePortrait = Boolean(this.isPhonePortrait);
		const showOnlyDifferences = Boolean(this.showOnlyDifferences);
		const isSingleView = Boolean(this.isSingleView);
		const presentation = { isPhonePortrait, showOnlyDifferences, isSingleView };

		const onlyFormattingChanges = showOnlyDifferences
			&& !result.yamlDiff?.hasDifferences
			&& !result.rows.some(row => row.type !== 'unchanged' && !isFormattingOnlyRow(row));
		if (!result.hasDifferences || onlyFormattingChanges) {
			const emptyMsg = content.createDiv('wn-snapshot-empty-msg');
			const icon = emptyMsg.createSpan('wn-snapshot-empty-icon');
			setIcon(icon, 'check-circle');
			emptyMsg.createSpan({ text: t(result.hasDifferences ? 'snapshot.no-text-diff' : 'snapshot.no-diff') });
		}

		// YAML 属性差异（独立折叠展示）
		if (result.yamlDiff && result.yamlDiff.hasDifferences) {
			const yamlDetails = content.createEl('details', { cls: 'wn-snapshot-yaml-details' });
			yamlDetails.open = yamlOpen;
			const summary = yamlDetails.createEl('summary', { cls: 'wn-snapshot-yaml-summary' });
			const yamlIcon = summary.createSpan('wn-snapshot-yaml-icon');
			setIcon(yamlIcon, 'code');
			summary.createSpan({ text: t('snapshot.yaml-attributes') });

			yamlDetails.addEventListener('toggle', this.boundYamlToggle ?? (() => this.onYamlToggle()));
			let yamlGroup: HTMLElement[] | null = null;
			const yamlBody = yamlDetails.createDiv('wn-snapshot-yaml-body');
			for (const change of result.yamlDiff.changes) {
				if (!change.added && !change.removed) {
					yamlGroup = null;
					if (showOnlyDifferences) continue;
				}
				const lineEl = yamlBody.createDiv('wn-snapshot-yaml-line');
				if (change.added) {
					lineEl.addClass('is-added');
					lineEl.createSpan({ cls: 'wn-snapshot-yaml-cue', text: '+' });
				} else if (change.removed) {
					lineEl.addClass('is-deleted');
					lineEl.createSpan({ cls: 'wn-snapshot-yaml-cue', text: '-' });
				} else {
					lineEl.addClass('is-unchanged');
					lineEl.createSpan({ cls: 'wn-snapshot-yaml-cue', text: ' ' });
				}
				lineEl.createSpan({ cls: 'wn-snapshot-yaml-text', text: change.value });
				if (change.added || change.removed) {
					if (!yamlGroup) { yamlGroup = []; targets.push(yamlGroup); }
					yamlGroup.push(lineEl);
				}
			}
		}

		// 正文行结构化渲染
		const rowsContainer = content.createDiv('wn-snapshot-rows-container');

		for (let index = 0; index < result.rows.length; index++) {
			if (index > 0 && index % 40 === 0) {
				await new Promise<void>(resolve => this.win.setTimeout(resolve, 0));
				if (generation !== this.diffGeneration || renderGen !== this.renderGeneration || this.isDestroyed) return;
			}
			this.renderDiffRow(rowsContainer, result.rows[index], targets, presentation);
		}
		if (generation !== this.diffGeneration || renderGen !== this.renderGeneration || this.isDestroyed) return;
		this.cancelScrollRaf();
		this.diffContainerEl.empty();
		this.diffContainerEl.appendChild(content);
		this.updateObservedContentRoot(content);
		this.diffContainerEl.scrollTop = prevScrollTop;
		this.diffContainerEl.scrollLeft = prevScrollLeft;
		this.navigationTargets = targets;
		this.invalidateNavigationLayout();
		this.updateNavigationButtons();
	}

	private renderDiffRow(
		container: HTMLElement,
		row: AlignedDiffRow,
		targets: HTMLElement[][] = [],
		presentation?: { isPhonePortrait: boolean; showOnlyDifferences: boolean; isSingleView: boolean }
	): void {
		const isPhonePortrait = presentation ? presentation.isPhonePortrait : Boolean(this.isPhonePortrait);
		const showOnlyDifferences = presentation ? presentation.showOnlyDifferences : Boolean(this.showOnlyDifferences);
		const isSingleView = presentation ? presentation.isSingleView : Boolean(this.isSingleView);
		const formattingOnly = isFormattingOnlyRow(row);
		if (showOnlyDifferences && (row.type === 'unchanged' || formattingOnly)) return;
		const single = isSingleView && !isPhonePortrait;
		if (single && row.leftLines.length === 0) return;
		const rowEl = container.createDiv(`wn-snapshot-row is-${row.type}`);
		const cueEl = rowEl.createSpan('wn-snapshot-row-cue');
		if (row.type === 'split') cueEl.setText(t('snapshot.split-cue'));
		else if (row.type === 'merge') cueEl.setText(t('snapshot.merge-cue'));
		else if (row.type === 'added') cueEl.setText('+');
		else if (row.type === 'deleted') cueEl.setText('-');
		else if (row.type === 'modified') cueEl.setText('~');
		const leftSide = rowEl.createDiv(isPhonePortrait ? 'wn-snapshot-side wn-snapshot-side-unified' : 'wn-snapshot-side wn-snapshot-side-left');
		const rightSide = isPhonePortrait ? leftSide : rowEl.createDiv('wn-snapshot-side wn-snapshot-side-right');
		if (single) {
			leftSide.setText(row.leftLines.join(''));
			return;
		}
		if (row.type === 'unchanged') {
			leftSide.appendChild(this.doc.createTextNode(row.leftLines.join('')));
			if (rightSide !== leftSide) rightSide.appendChild(this.doc.createTextNode(row.rightLines.join('')));
			return;
		}
		if (formattingOnly) {
			rowEl.addClass('is-format-only');
			cueEl.setText(t('snapshot.whitespace-cue'));
			cueEl.setAttribute('aria-label', t('snapshot.whitespace-description'));
			const leftLines = isPhonePortrait && row.rightLines.length > 0 ? row.rightLines : row.leftLines;
			leftSide.setText(leftLines.join(''));
			if (rightSide !== leftSide) rightSide.setText(row.rightLines.join(''));
			targets.push([cueEl]);
			return;
		}
		const register = (group: HTMLElement[]) => {
			if (group.some(el => /\S/u.test(el.textContent ?? ''))) targets.push(group);
		};
		if (row.type === 'deleted' || row.type === 'added') {
			const added = row.type === 'added';
			const el = (added ? rightSide : leftSide).createEl(added ? 'ins' : 'del', { cls: added ? 'wn-diff-ins' : 'wn-diff-del' });
			el.setText((added ? row.rightLines : row.leftLines).join(''));
			targets.push([el]);
			return;
		}
		const changes = row.charDiff;
		if (!changes) {
			rowEl.addClass('is-whole-rewrite');
			const del = leftSide.createEl('del', { cls: 'wn-diff-del', text: row.leftLines.join('') });
			const ins = rightSide.createEl('ins', { cls: 'wn-diff-ins', text: row.rightLines.join('') });
			targets.push([ins, del]);
		} else {
			const onlyWhitespace = changes.filter(change => change.added || change.removed).every(change => !/\S/u.test(change.value));
			let group: HTMLElement[] = [];
			for (const chunk of changes) {
				if (chunk.added || chunk.removed) {
					const el = (chunk.added ? rightSide : leftSide).createEl(chunk.added ? 'ins' : 'del', { cls: chunk.added ? 'wn-diff-ins' : 'wn-diff-del', text: chunk.value });
					group.push(el);
				} else {
					if (!onlyWhitespace) register(group);
					group = [];
					leftSide.appendChild(this.doc.createTextNode(chunk.value));
					if (rightSide !== leftSide) rightSide.appendChild(this.doc.createTextNode(chunk.value));
				}
			}
			if (onlyWhitespace) {
				targets.push([cueEl]);
			} else register(group);
		}
		if (row.exceedsLimit) rowEl.createSpan({ cls: 'wn-snapshot-limit-notice', text: t('snapshot.character-diff-limit') });
	}

	// ── 拖拽定位逻辑 ──

	private startDragging(e: PointerEvent): void {
		if (this.doc.body.hasClass('is-phone') || this.isDragging) return;
		this.isDragging = true;
		this.dragPointerId = e.pointerId;
		(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
		this.dragStartX = e.clientX;
		this.dragStartY = e.clientY;

		const rect = this.panelEl.getBoundingClientRect();
		this.panelStartX = rect.left;
		this.panelStartY = rect.top;

		this.doc.addEventListener('pointermove', this.boundPointerMove);
		this.doc.addEventListener('pointerup', this.boundPointerUp);
		this.doc.addEventListener('pointercancel', this.boundPointerUp);
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.isDragging || e.pointerId !== this.dragPointerId) return;
		const deltaX = e.clientX - this.dragStartX;
		const deltaY = e.clientY - this.dragStartY;

		let nextX = this.panelStartX + deltaX;
		let nextY = this.panelStartY + deltaY;

		const maxW = Math.max(0, (this.win.innerWidth || 1000) - this.panelEl.getBoundingClientRect().width - 10);
		const maxH = Math.max(0, (this.win.innerHeight || 800) - 60);

		nextX = Math.max(10, Math.min(nextX, maxW));
		nextY = Math.max(10, Math.min(nextY, maxH));

		this.panelEl.setCssProps({
			left: `${nextX}px`,
			top: `${nextY}px`,
			transform: 'none',
			right: 'auto',
			bottom: 'auto'
		});
	}

	private clampPosition(): void {
		if (this.isDestroyed || this.doc.body.hasClass('is-phone')) return;
		const rect = this.panelEl.getBoundingClientRect();
		this.panelEl.setCssProps({
			left: `${Math.max(10, Math.min(rect.left, this.win.innerWidth - rect.width - 10))}px`,
			top: `${Math.max(10, Math.min(rect.top, this.win.innerHeight - Math.min(rect.height, 60) - 10))}px`,
			transform: 'none',
			right: 'auto', bottom: 'auto'
		});
	}

	private onPointerUp(e?: PointerEvent): void {
		if (e && e.pointerId !== this.dragPointerId) return;
		this.isDragging = false;
		this.dragPointerId = null;
		this.doc.removeEventListener('pointermove', this.boundPointerMove);
		this.doc.removeEventListener('pointerup', this.boundPointerUp);
		this.doc.removeEventListener('pointercancel', this.boundPointerUp);
	}

	public destroy(): void {
		if (this.isDestroyed) return;
		this.isDestroyed = true;
		this.renderGeneration = (this.renderGeneration ?? 0) + 1;

		if (this.editorDebounceTimer !== null && this.editorDebounceTimer !== undefined) {
			this.win.clearTimeout(this.editorDebounceTimer);
			this.editorDebounceTimer = null;
		}
		this.cancelScrollRaf();
		this.updateObservedContentRoot(null);
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		if (this.editorChangeRef) {
			this.app.workspace.offref(this.editorChangeRef);
			this.editorChangeRef = null;
		}
		if (this.cssChangeRef) {
			this.app.workspace.offref(this.cssChangeRef);
			this.cssChangeRef = null;
		}
		this.doc.fonts?.removeEventListener?.('loadingdone', this.boundLayoutInvalidate);

		if (this.vaultModifyRef) {
			this.app.vault.offref?.(this.vaultModifyRef);
			this.vaultModifyRef = null;
		}
		if (this.vaultRenameRef) {
			this.app.vault.offref?.(this.vaultRenameRef);
			this.vaultRenameRef = null;
		}
		if (this.vaultDeleteRef) {
			this.app.vault.offref?.(this.vaultDeleteRef);
			this.vaultDeleteRef = null;
		}

		this.doc.removeEventListener('compositionstart', this.boundCompStart);
		this.doc.removeEventListener('compositionend', this.boundCompEnd);
		this.win.removeEventListener('unload', this.boundWindowUnload);
		this.win.removeEventListener('resize', this.boundResize);
		this.orientationQuery?.removeEventListener('change', this.boundOrientationChange);
		this.orientationQuery = null;
		this.diffContainerEl.removeEventListener('scroll', this.boundDiffScroll);
		this.clearNavigation();
		this.doc.removeEventListener('fullscreenchange', this.boundFullscreenChange);

		this.onPointerUp();

		// 清理内存明文缓存，避免长期持有
		this.leftContent = '';
		this.rightContent = '';
		this.cachedLeftSnapshot = null;
		this.cachedRightSnapshot = null;
		this.diffResult = null;
		this.snapshotsMetaList = [];
		this.snapshotsListScope = null;

		if (this.panelEl.parentNode) {
			this.panelEl.parentNode.removeChild(this.panelEl);
		}

		this.onCloseCallback();
	}
}
