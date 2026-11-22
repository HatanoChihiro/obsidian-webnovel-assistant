import { showPluginNotice } from '../services/PluginNoticeService';
import type { App, EventRef, WorkspaceLeaf } from 'obsidian';
import { MarkdownView, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { preserveTypewriterViewport } from '../editor/TypewriterExtension';
import { t } from '../i18n';
import { ChapterDiffEngine } from '../services/ChapterDiffEngine';
import type { CacheManager } from '../services/CacheManager';
import type { ImmersiveManuscriptManager } from '../services/ImmersiveManuscriptManager';
import type { PersistedManuscriptPosition } from '../types/settings';
import { Logger } from '../utils/Logger';

export interface ManuscriptSwitchRequest {
	file: TFile;
	cursorLine?: number;
	cursorCh?: number;
	scrollMode: 'click-anchor' | 'restore-position' | 'chapter-start' | 'keep';
	clickAnchor?: {
		clientY: number;
		cardTopDelta: number;
	};
	restorePosition?: PersistedManuscriptPosition;
}

export interface ImmersiveManuscriptControllerHost {
	app: App;
	manuscriptManager: ImmersiveManuscriptManager;
	cacheManager?: Pick<CacheManager, 'getFileCache'>;
	onProgrammaticOpenStart?: () => void;
	onProgrammaticOpenEnd?: () => void;
	onActiveChapterChanged?: (file: TFile, workChanged: boolean) => void;
	onMainChapterInvalidated?: () => void;
}

interface EditorHostSnapshot {
	leafEl: HTMLElement | null;
	viewContentEl: HTMLElement;
	editorHostEl: HTMLElement;
	originalParent: HTMLElement;
	restoreAnchor: Comment | null;
	nextSibling: ChildNode | null;
}

interface ChapterCardEntry {
	file: TFile;
	cardEl: HTMLElement;
	headerEl: HTMLElement;
	bodyEl: HTMLElement;
	previewEl: HTMLElement | null;
	editorSlotEl: HTMLElement | null;
	lineElements: HTMLElement[];
	rendered: boolean;
	isLoading: boolean;
	previewVersion: number;
	needsReload: boolean;
}

interface ViewportAnchorSnapshot {
	viewportFilePath: string;
	viewportLine?: number;
	viewportLineOffset?: number;
	chapterRelativeScroll: number;
	activeAnchorLine?: number;
}

const MAX_CONCURRENT_PREVIEW_READS = 3;
const MAX_CONTENT_OVERRIDES = 10;
const MAX_OFFSCREEN_RENDERED_PREVIEWS = 12;
const LAZY_OBSERVER_MARGIN = '600px 0px';

export function computeBodyStartLine(yamlHeader: string): number {
	if (!yamlHeader) return 0;
	const parts = yamlHeader.split(/\r\n|\n/);
	return Math.max(0, parts.length - 1);
}

/**
 * 沉浸原稿模式 UI 控制器
 * 负责在主编辑区挂载共享滚动原稿瀑布流、安全迁移与还原原生 MarkdownView DOM、
 * 懒加载相邻章节只读预览、串行合并切换章节以及保持焦点/滚动/IME 状态。
 */
export class ImmersiveManuscriptController {
	private host: ImmersiveManuscriptControllerHost;
	private mainLeaf: WorkspaceLeaf | null = null;
	private snapshot: EditorHostSnapshot | null = null;
	private rootEl: HTMLElement | null = null;
	private scrollerEl: HTMLElement | null = null;
	private flowEl: HTMLElement | null = null;

	private cardsByPath = new Map<string, ChapterCardEntry>();
	private orderedCards: ChapterCardEntry[] = [];
	private cardElsToPath = new WeakMap<Element, string>();
	private activeFilePath: string | null = null;
	private activeWorkPath: string = '';
	private contentOverrides = new Map<string, string>();

	private observer: IntersectionObserver | null = null;
	private visibleCardPaths = new Set<string>();
	private renderedPreviewPaths = new Set<string>();
	private pendingReadQueue: string[] = [];
	private pendingReadSet = new Set<string>();
	private inFlightReads = new Set<Promise<void>>();
	private previewGeneration = 0;
	private isScrollbarDragging = false;

	private sessionGeneration = 0;
	private isDisposed = false;
	private pendingSwitchRequest: ManuscriptSwitchRequest | null = null;
	private switchPumpPromise: Promise<void> | null = null;
	private compositionAbort: (() => void) | null = null;
	private restoreCancelFn: (() => void) | null = null;
	private pendingRestoreToken = 0;
	private pendingRestoreViewportPath: string | null = null;
	private refreshAfterComposeCleanup: (() => void) | null = null;

	private domCleanups: Array<() => void> = [];
	private eventRefs: EventRef[] = [];
	private positionPersistTimer: number | null = null;
	private scrollCaptureRafId: number | null = null;
	private ownerWindowRef: Window | null = null;
	private refreshTimer: number | null = null;
	private nativePaddingTarget: HTMLElement | null = null;
	private restoreNativePadding: (() => void) | null = null;

	constructor(host: ImmersiveManuscriptControllerHost) {
		this.host = host;
	}

	public isMounted(): boolean {
		return Boolean(this.rootEl && this.snapshot && !this.isDisposed);
	}

	public getActiveFilePath(): string | null {
		return this.activeFilePath;
	}

	public getScrollerElement(): HTMLElement | null {
		return this.scrollerEl;
	}

	/**
	 * 挂载共享原稿视图并接管原生 Markdown 编辑器 DOM
	 */
	public mount(
		mainLeaf: WorkspaceLeaf,
		activeFile: TFile,
		restorePosition?: PersistedManuscriptPosition
	): boolean {
		if (this.isDisposed) return false;
		if (!this.host.manuscriptManager.isEligibleManuscriptChapter(activeFile)) {
			return false;
		}

		this.unmountSync();
		this.isDisposed = false;
		this.sessionGeneration++;
		this.mainLeaf = mainLeaf;

		const markdownView = this.getMainMarkdownView();
		const preMountScrollTop = Math.max(0, markdownView?.editor?.getScrollInfo?.()?.top ?? 0);
		const viewContentEl = this.resolveViewContentElement(mainLeaf, markdownView);
		const editorHostEl = this.resolveEditorHostElement(viewContentEl, markdownView);

		if (!viewContentEl || !editorHostEl || editorHostEl === viewContentEl || editorHostEl.contains(viewContentEl)) {
			Logger.warn('[ImmersiveManuscriptController] 无法解析安全的主编辑器宿主容器，取消挂载');
			this.mainLeaf = null;
			return false;
		}

		const originalParent = editorHostEl.parentElement;
		if (!originalParent) {
			this.mainLeaf = null;
			return false;
		}

		const ownerDoc = viewContentEl.ownerDocument;
		this.ownerWindowRef = ownerDoc.defaultView ?? window;
		const hadFocusBeforeMount = this.isEditorFocused(ownerDoc, editorHostEl, markdownView);
		const preMountSelections = markdownView?.editor?.listSelections?.();
		const restoreAnchor = typeof ownerDoc.createComment === 'function'
			? ownerDoc.createComment('wn-manuscript-editor-anchor')
			: null;
		const nextSibling = editorHostEl.nextSibling;
		if (restoreAnchor && typeof originalParent.insertBefore === 'function') {
			originalParent.insertBefore(restoreAnchor, editorHostEl);
		}

		this.snapshot = {
			leafEl: mainLeaf.containerEl ?? null,
			viewContentEl,
			editorHostEl,
			originalParent,
			restoreAnchor,
			nextSibling
		};

		const rootEl = viewContentEl.createDiv({ cls: 'wn-manuscript-root' });
		const scrollerEl = rootEl.createDiv({ cls: 'wn-manuscript-scroller' });
		const flowEl = scrollerEl.createDiv({ cls: 'wn-manuscript-flow' });

		if (editorHostEl.contains(rootEl)) {
			// 安全兜底：绝不将父节点插入其子节点
			rootEl.remove();
			this.restoreDomFromSnapshot();
			return false;
		}

		this.rootEl = rootEl;
		this.scrollerEl = scrollerEl;
		this.flowEl = flowEl;

		mainLeaf.containerEl?.classList?.add('wn-manuscript-leaf');
		viewContentEl.classList?.add('wn-manuscript-view-content');
		editorHostEl.classList?.add('wn-manuscript-hosted-editor');

		this.activeFilePath = activeFile.path;
		this.activeWorkPath = this.host.manuscriptManager.getWorkPath(activeFile);

		this.buildChapterCards(activeFile);
		this.mountEditorIntoCard(activeFile.path);
		this.attachDomAndVaultListeners(scrollerEl, ownerDoc);
		this.setupLazyObserver(scrollerEl, activeFile.path);

		const cm = markdownView?.editor?.cm;
		// Rehosting can blur the native editor and leave its typewriter freeze at the old
		// scroll offset. Bind the shared scroller and its global padding before aligning.
		cm?.dispatch?.({ effects: preserveTypewriterViewport.of(null) });
		if (restorePosition && restorePosition.filePath === activeFile.path) {
			this.applyRestoredPosition(markdownView, restorePosition, hadFocusBeforeMount);
		} else {
			const activeCard = this.cardsByPath.get(activeFile.path);
			if (activeCard) {
				if (preMountScrollTop > 0) {
					const targetTop = Math.max(0, (activeCard.cardEl.offsetTop ?? 0) + preMountScrollTop);
					this.setScrollerScrollTop(targetTop);
				} else {
					// 即使原生编辑器滚动为 0，进入中部章节时也必须滚动到对应章节卡片
					this.scrollActiveCardIntoViewIfNeeded(true);
				}
			}
			if (hadFocusBeforeMount && markdownView) {
				if (preMountSelections?.length) {
					markdownView.editor?.setSelections?.(preMountSelections);
				}
				this.focusEditorSafe(markdownView, true);
			}
		}

		cm?.requestMeasure?.();
		this.captureCurrentPosition(false);

		return true;
	}

	/**
	 * 同步当前活跃章节与目录结构（用于外部切章、文件创建/改名/删除）
	 */
	public async syncWithActiveChapter(
		activeFile: TFile,
		restorePosition?: PersistedManuscriptPosition
	): Promise<void> {
		if (this.isDisposed || !this.mainLeaf) return;
		if (!this.host.manuscriptManager.isEligibleManuscriptChapter(activeFile)) return;

		if (!this.isMounted()) {
			this.mount(this.mainLeaf, activeFile, restorePosition);
			return;
		}

		const nextWork = this.host.manuscriptManager.getWorkPath(activeFile);
		const prevPath = this.activeFilePath;
		const workChanged = nextWork !== this.activeWorkPath;
		const chapterChanged = prevPath !== activeFile.path;

		if (chapterChanged) {
			this.cancelPendingViewportRestore();
		}

		if (workChanged || !this.cardsByPath.has(activeFile.path)) {
			this.rebuildCardsPreservingHost(activeFile);
		} else if (chapterChanged) {
			this.swapActiveCard(prevPath, activeFile.path);
		} else {
			this.mountEditorIntoCard(activeFile.path);
		}

		this.activeFilePath = activeFile.path;
		this.activeWorkPath = nextWork;

		const markdownView = this.getMainMarkdownView();
		if (restorePosition && restorePosition.filePath === activeFile.path) {
			const hadFocus = this.isEditorFocused(
				this.snapshot?.viewContentEl.ownerDocument ?? activeDocument,
				this.snapshot?.editorHostEl ?? null,
				markdownView
			);
			this.applyRestoredPosition(markdownView, restorePosition, hadFocus);
		} else if (chapterChanged) {
			markdownView?.editor?.cm?.dispatch?.({ effects: preserveTypewriterViewport.of(null) });
			this.scrollActiveCardIntoViewIfNeeded(true);
		}
		markdownView?.editor?.cm?.requestMeasure?.();
		this.captureCurrentPosition(false);

		if (workChanged) {
			this.host.onActiveChapterChanged?.(activeFile, true);
		} else {
			this.host.onActiveChapterChanged?.(activeFile, false);
		}
	}

	/**
	 * 请求切换原稿章节（串行合并、保护 IME、保存旧章、保持锚点）
	 */
	public requestChapterSwitch(request: ManuscriptSwitchRequest): Promise<void> {
		if (this.isDisposed) return Promise.resolve();
		this.cancelPendingViewportRestore();
		this.pendingSwitchRequest = request;
		if (!this.switchPumpPromise) {
			this.switchPumpPromise = this.runSwitchPump().finally(() => {
				this.switchPumpPromise = null;
			});
		}
		return this.switchPumpPromise;
	}

	/**
	 * 恢复最后一个有效原稿章节（用于外部误开非章节文档时自动回退）
	 */
	public async restoreLastValidChapter(): Promise<boolean> {
		if (this.isDisposed || !this.mainLeaf) return false;
		const fallback = this.host.manuscriptManager.resolveNonChapterFallback(this.activeWorkPath);
		if (!fallback) return false;

		await this.requestChapterSwitch({
			file: fallback.file,
			scrollMode: fallback.position ? 'restore-position' : 'chapter-start',
			restorePosition: fallback.position
		});
		return true;
	}

	/**
	 * 刷新当前作品的章节列表（保持活动编辑器实例、焦点与视口，IME 组合期自动延后）
	 */
	public refreshChapterList(): void {
		if (this.isDisposed || !this.isMounted()) return;
		const liveView = this.getMainMarkdownView();
		const activeFile = liveView?.file
			?? (this.activeFilePath ? this.host.app.vault.getAbstractFileByPath(this.activeFilePath) : null);

		if (!(activeFile instanceof TFile) || !this.host.manuscriptManager.isEligibleManuscriptChapter(activeFile)) {
			this.host.onMainChapterInvalidated?.();
			return;
		}

		const cm = liveView?.editor?.cm;
		if (cm?.composing) {
			this.deferStructuralRefreshAfterComposition(cm);
			return;
		}

		if (activeFile.path !== this.activeFilePath) {
			void this.syncWithActiveChapter(activeFile).catch((error) => {
				Logger.error('[ImmersiveManuscriptController] 刷新章节列表时同步活跃章节失败:', error);
			});
			return;
		}

		this.activeFilePath = activeFile.path;
		this.activeWorkPath = this.host.manuscriptManager.getWorkPath(activeFile);
		this.rebuildCardsPreservingHost(activeFile);
	}

	/**
	 * 在当前位置捕获有效章节状态与独立视口锚点并更新记忆
	 */
	public captureCurrentPosition(persistImmediately = false): void {
		this.cancelScheduledScrollCapture();
		if (this.isDisposed || !this.isMounted()) return;
		const view = this.getMainMarkdownView();
		const file = view?.file;
		if (!(file instanceof TFile) || !this.host.manuscriptManager.isEligibleManuscriptChapter(file)) {
			return;
		}
		if (file.path !== this.activeFilePath) return;

		const cursor = view?.editor?.getCursor?.() ?? { line: 0, ch: 0 };
		const cursorLine = Math.max(0, Math.floor(cursor.line || 0));
		const cursorCh = Math.max(0, Math.floor(cursor.ch || 0));
		const viewport = this.captureViewportAnchor(view, cursorLine);

		const pos: PersistedManuscriptPosition = {
			filePath: file.path,
			workPath: this.host.manuscriptManager.getWorkPath(file),
			cursorLine,
			cursorCh,
			chapterRelativeScroll: viewport?.chapterRelativeScroll,
			anchorLine: viewport?.activeAnchorLine ?? cursorLine,
			viewportFilePath: viewport?.viewportFilePath,
			viewportLine: viewport?.viewportLine,
			viewportLineOffset: viewport?.viewportLineOffset
		};

		void this.host.manuscriptManager.recordValidPosition(pos, persistImmediately).catch((error) => {
			Logger.error('[ImmersiveManuscriptController] 保存原稿位置失败:', error);
		});
	}

	/**
	 * 使异步操作失效并等待在途保存/打开/预读完成，随后恢复原生 DOM
	 */
	public async teardownAsync(): Promise<void> {
		this.captureCurrentPosition(false);
		this.invalidatePendingOperations();
		const pending: Promise<unknown>[] = [];
		if (this.switchPumpPromise) pending.push(this.switchPumpPromise);
		if (this.inFlightReads.size > 0) pending.push(...this.inFlightReads);
		if (pending.length > 0) {
			await Promise.allSettled(pending);
		}
		this.unmountSync();
		await this.host.manuscriptManager.flush();
	}

	/**
	 * 立即同步恢复原生 DOM 与清理全部监听器/观察器
	 */
	public unmountSync(): void {
		this.invalidatePendingOperations();
		this.clearTimers();
		this.teardownLazyObserver();
		this.detachDomAndVaultListeners();
		this.restoreDomFromSnapshot();
		for (const entry of this.cardsByPath.values()) {
			entry.lineElements = [];
		}
		this.cardsByPath.clear();
		this.orderedCards = [];
		this.visibleCardPaths.clear();
		this.renderedPreviewPaths.clear();
		this.contentOverrides.clear();
		this.activeFilePath = null;
		this.activeWorkPath = '';
		this.mainLeaf = null;
		this.rootEl = null;
		this.scrollerEl = null;
		this.flowEl = null;
	}

	private invalidatePendingOperations(): void {
		this.isDisposed = true;
		this.sessionGeneration++;
		this.previewGeneration++;
		this.pendingSwitchRequest = null;
		this.cancelPendingViewportRestore();
		if (this.refreshAfterComposeCleanup) {
			this.refreshAfterComposeCleanup();
			this.refreshAfterComposeCleanup = null;
		}
		if (this.compositionAbort) {
			this.compositionAbort();
			this.compositionAbort = null;
		}
		this.pendingReadQueue = [];
		this.pendingReadSet.clear();
		this.isScrollbarDragging = false;
	}

	private getMainMarkdownView(): MarkdownView | null {
		if (!this.mainLeaf) return null;
		const view = this.mainLeaf.view;
		if (view instanceof MarkdownView || view?.getViewType?.() === 'markdown') {
			return view as MarkdownView;
		}
		return null;
	}

	private resolveViewContentElement(leaf: WorkspaceLeaf, view: MarkdownView | null): HTMLElement | null {
		if (view && (view as unknown as { contentEl?: HTMLElement }).contentEl) {
			return (view as unknown as { contentEl: HTMLElement }).contentEl;
		}
		const queried = leaf.containerEl?.querySelector<HTMLElement>('.view-content');
		return queried ?? null;
	}

	private resolveEditorHostElement(viewContentEl: HTMLElement | null, view: MarkdownView | null): HTMLElement | null {
		if (!viewContentEl) return null;
		const sourceView = viewContentEl.querySelector<HTMLElement>('.markdown-source-view');
		if (sourceView) return sourceView;
		const cmDom = view?.editor?.cm?.dom ?? null;
		if (cmDom && typeof viewContentEl.contains === 'function' && viewContentEl.contains(cmDom)) {
			return cmDom;
		}
		return cmDom;
	}

	private buildChapterCards(activeFile: TFile): void {
		if (!this.flowEl) return;
		this.previewGeneration++;
		this.visibleCardPaths.clear();
		this.renderedPreviewPaths.clear();
		for (const entry of this.cardsByPath.values()) {
			entry.lineElements = [];
		}
		this.flowEl.empty?.();
		this.cardsByPath.clear();
		this.orderedCards = [];

		const chapters = this.host.manuscriptManager.getBookChaptersForFile(activeFile);
		const list = chapters.some(f => f.path === activeFile.path)
			? chapters
			: [activeFile, ...chapters];

		const workPath = this.host.manuscriptManager.getWorkPath(activeFile);
		let prevVolume = '';

		for (const file of list) {
			const cardEl = this.flowEl.createDiv({ cls: 'wn-manuscript-card' });
			cardEl.dataset.chapterPath = file.path;
			this.cardElsToPath.set(cardEl, file.path);

			const headerEl = cardEl.createDiv({
				cls: 'wn-manuscript-card-header inline-title',
				attr: {
					role: 'button',
					tabindex: '0',
					'aria-label': t('immersive.manuscript-chapter-button-label', { title: file.basename })
				}
			});
			const volumeLabel = this.getRelativeVolumeLabel(file, workPath);
			if (volumeLabel && volumeLabel !== prevVolume) {
				headerEl.createSpan({ cls: 'wn-manuscript-card-volume', text: volumeLabel });
			}
			prevVolume = volumeLabel;
			headerEl.createSpan({ cls: 'wn-manuscript-card-title', text: file.basename });

			const bodyEl = cardEl.createDiv({ cls: 'wn-manuscript-card-body' });

			let previewEl: HTMLElement | null = null;
			let editorSlotEl: HTMLElement | null = null;
			if (file.path === activeFile.path) {
				cardEl.classList?.add('is-active');
				headerEl.setAttribute?.('aria-current', 'true');
				editorSlotEl = bodyEl.createDiv({ cls: 'wn-manuscript-editor-slot' });
			} else {
				previewEl = this.createLazyPreviewShell(bodyEl, file);
			}

			const entry: ChapterCardEntry = {
				file,
				cardEl,
				headerEl,
				bodyEl,
				previewEl,
				editorSlotEl,
				lineElements: [],
				rendered: file.path === activeFile.path,
				isLoading: false,
				previewVersion: 0,
				needsReload: false
			};
			this.cardsByPath.set(file.path, entry);
			this.orderedCards.push(entry);
			this.bindCardInteractions(entry);
		}
	}

	private parkEditorHostOutsideFlow(): void {
		if (!this.snapshot) return;
		const { editorHostEl, viewContentEl } = this.snapshot;
		if (
			editorHostEl !== viewContentEl &&
			!editorHostEl.contains(viewContentEl) &&
			editorHostEl.parentElement !== viewContentEl
		) {
			viewContentEl.appendChild(editorHostEl);
		}
	}

	private rebuildCardsPreservingHost(activeFile: TFile): void {
		if (!this.flowEl || !this.snapshot) return;
		const markdownView = this.getMainMarkdownView();
		const ownerDoc = this.snapshot.viewContentEl.ownerDocument;
		const hadFocus = this.isEditorFocused(ownerDoc, this.snapshot.editorHostEl, markdownView);
		const prevSelections = markdownView?.editor?.listSelections?.();
		const scrollBefore = this.scrollerEl?.scrollTop ?? 0;
		const anchorCard = this.captureViewportAnchor(markdownView, markdownView?.editor?.getCursor?.()?.line ?? 0);

		this.parkEditorHostOutsideFlow();
		this.teardownLazyObserver();
		this.pendingReadQueue = [];
		this.pendingReadSet.clear();
		this.buildChapterCards(activeFile);
		this.mountEditorIntoCard(activeFile.path);
		if (this.scrollerEl) {
			this.setupLazyObserver(this.scrollerEl, activeFile.path);
			const targetCard = anchorCard?.viewportFilePath
				? this.cardsByPath.get(anchorCard.viewportFilePath)
				: this.cardsByPath.get(activeFile.path);
			if (targetCard && anchorCard) {
				this.setScrollerScrollTop(Math.max(0, (targetCard.cardEl.offsetTop ?? 0) + anchorCard.chapterRelativeScroll));
			} else {
				this.setScrollerScrollTop(scrollBefore);
			}
		}
		if (hadFocus && markdownView) {
			if (prevSelections?.length) {
				markdownView.editor?.setSelections?.(prevSelections);
			}
			this.focusEditorSafe(markdownView, true);
		}
		markdownView?.editor?.cm?.requestMeasure?.();
	}

	private getRelativeVolumeLabel(file: TFile, workPath: string): string {
		const parentPath = file.parent?.path ?? '';
		if (!parentPath || parentPath === '/' || parentPath === workPath) return '';
		if (workPath && parentPath.startsWith(workPath + '/')) {
			return parentPath.slice(workPath.length + 1);
		}
		return parentPath;
	}

	private createLazyPreviewShell(bodyEl: HTMLElement, file: TFile): HTMLElement {
		const previewEl = bodyEl.createDiv({ cls: 'wn-manuscript-preview wn-manuscript-lazy-shell' });
		const cachedWords = this.host.cacheManager?.getFileCache?.(file.path) ?? 0;
		const estLines = Math.max(4, Math.min(80, Math.round((cachedWords || 300) / 35)));
		previewEl.style?.setProperty?.('--wn-manuscript-estimated-height', `${estLines * 28}px`);
		return previewEl;
	}

	private mountEditorIntoCard(targetPath: string): void {
		if (!this.snapshot) return;
		const entry = this.cardsByPath.get(targetPath);
		if (!entry) return;

		if (!entry.editorSlotEl) {
			entry.bodyEl.empty?.();
			entry.previewEl = null;
			entry.editorSlotEl = entry.bodyEl.createDiv({ cls: 'wn-manuscript-editor-slot' });
		}
		entry.cardEl.classList?.add('is-active');
		entry.headerEl.setAttribute?.('aria-current', 'true');
		entry.rendered = true;
		entry.lineElements = [];
		this.renderedPreviewPaths.delete(targetPath);

		// Re-resolve current .markdown-source-view in case Obsidian replaced it during openFile
		const currentView = this.getMainMarkdownView();
		const liveHostEl = this.resolveEditorHostElement(this.snapshot.viewContentEl, currentView);
		if (liveHostEl && liveHostEl !== this.snapshot.editorHostEl) {
			this.snapshot.editorHostEl.classList?.remove('wn-manuscript-hosted-editor');
			this.snapshot.editorHostEl = liveHostEl;
			liveHostEl.classList?.add('wn-manuscript-hosted-editor');
		}

		const hostEl = this.snapshot.editorHostEl;
		if (!hostEl.contains(entry.editorSlotEl) && hostEl.parentElement !== entry.editorSlotEl) {
			entry.editorSlotEl.appendChild(hostEl);
		}
		this.bindNativeBottomPadding(currentView?.editor?.cm ?? null);
	}

	private bindNativeBottomPadding(cm: EditorView | null): void {
		const contentEl = cm?.contentDOM ?? null;
		if (contentEl === this.nativePaddingTarget) return;
		this.restoreNativePadding?.();
		if (!contentEl) return;
		this.nativePaddingTarget = contentEl;
		const style = contentEl.style;
		let nativeValue = style.getPropertyValue('padding-bottom');
		let nativePriority = style.getPropertyPriority?.('padding-bottom') ?? '';
		const suppressPadding = () => {
			if (this.nativePaddingTarget !== contentEl || this.isDisposed) return;
			const value = style.getPropertyValue('padding-bottom');
			const priority = style.getPropertyPriority?.('padding-bottom') ?? '';
			if (value === '0px' && priority === '') return;
			nativeValue = value;
			nativePriority = priority;
			// Obsidian also writes this directly on resize, outside CM contentAttributes.
			style.setProperty('padding-bottom', '0px');
			cm?.requestMeasure();
		};
		const Observer = contentEl.ownerDocument.defaultView?.MutationObserver;
		const observer = typeof Observer === 'function' ? new Observer(suppressPadding) : null;
		observer?.observe(contentEl, { attributes: true, attributeFilter: ['style'] });
		this.restoreNativePadding = () => {
			observer?.disconnect();
			if (style.getPropertyValue('padding-bottom') === '0px' && !(style.getPropertyPriority?.('padding-bottom') ?? '')) {
				if (nativeValue) style.setProperty('padding-bottom', nativeValue, nativePriority);
				else style.removeProperty('padding-bottom');
			}
			this.nativePaddingTarget = null;
			this.restoreNativePadding = null;
		};
		suppressPadding();
	}

	private swapActiveCard(prevPath: string | null, nextPath: string): void {
		if (prevPath && prevPath !== nextPath) {
			const prevEntry = this.cardsByPath.get(prevPath);
			if (prevEntry) {
				prevEntry.cardEl.classList?.remove('is-active');
				prevEntry.headerEl.removeAttribute?.('aria-current');
				// Move editorHostEl out before emptying previous card's body
				this.parkEditorHostOutsideFlow();
				prevEntry.editorSlotEl = null;
				prevEntry.bodyEl.empty?.();
				prevEntry.previewEl = this.createLazyPreviewShell(prevEntry.bodyEl, prevEntry.file);
				prevEntry.lineElements = [];
				prevEntry.rendered = false;
				prevEntry.isLoading = false;
				prevEntry.previewVersion++;
				prevEntry.needsReload = false;
				this.renderedPreviewPaths.delete(prevPath);
				this.bindPreviewInteraction(prevEntry);

				const overrideText = this.contentOverrides.get(prevPath);
				if (typeof overrideText === 'string') {
					this.renderPreviewText(prevEntry, overrideText);
				} else {
					this.enqueuePreviewRead(prevPath, true);
				}
			}
		}

		this.mountEditorIntoCard(nextPath);
		this.evictOffscreenPreviewsIfNeeded();
	}

	private bindCardInteractions(entry: ChapterCardEntry): void {
		let headerDownPos: { x: number; y: number } | null = null;
		let lastKeyActivatedAt = 0;

		const activateHeader = () => {
			if (entry.file.path === this.activeFilePath) return;
			void this.requestChapterSwitch({
				file: entry.file,
				scrollMode: 'chapter-start'
			});
		};

		entry.headerEl.addEventListener('pointerdown', (evt: Event) => {
			const pe = evt as PointerEvent;
			headerDownPos = { x: pe.clientX ?? 0, y: pe.clientY ?? 0 };
		});
		entry.headerEl.addEventListener('keydown', (evt: Event) => {
			const ke = evt as KeyboardEvent;
			if (ke.key === 'Enter' || ke.key === ' ') {
				ke.preventDefault();
				lastKeyActivatedAt = Date.now();
				activateHeader();
			}
		});
		entry.headerEl.addEventListener('click', (evt: Event) => {
			evt.preventDefault();
			const me = evt as MouseEvent;
			if (me.detail === 0 && Date.now() - lastKeyActivatedAt < 100) {
				return;
			}
			if (headerDownPos) {
				const dx = Math.abs((me.clientX ?? 0) - headerDownPos.x);
				const dy = Math.abs((me.clientY ?? 0) - headerDownPos.y);
				headerDownPos = null;
				if (dx > 6 || dy > 6) return;
			}
			activateHeader();
		});

		if (entry.previewEl) {
			this.bindPreviewInteraction(entry);
		}
	}

	private bindPreviewInteraction(entry: ChapterCardEntry): void {
		const previewEl = entry.previewEl;
		if (!previewEl) return;

		let downPos: { x: number; y: number } | null = null;
		previewEl.addEventListener('pointerdown', (evt: Event) => {
			const pe = evt as PointerEvent;
			downPos = { x: pe.clientX ?? 0, y: pe.clientY ?? 0 };
		});

		previewEl.addEventListener('click', (evt: Event) => {
			if (this.isDisposed || !this.scrollerEl) return;
			const me = evt as MouseEvent;
			if (downPos) {
				const dx = Math.abs((me.clientX ?? 0) - downPos.x);
				const dy = Math.abs((me.clientY ?? 0) - downPos.y);
				if (dx > 6 || dy > 6) return;
			}

			const win = previewEl.ownerDocument?.defaultView;
			const selectedText = win?.getSelection?.()?.toString();
			if (selectedText && selectedText.length > 0) return;

			const target = (evt.target as HTMLElement | null)?.closest?.('.wn-manuscript-preview-line') as HTMLElement | null;
			const parsedLine = target?.dataset?.line !== undefined ? Number(target.dataset.line) : NaN;
			const fallbackBodyStart = Number(previewEl.dataset?.bodyStartLine ?? '0') || 0;
			const targetLine = Number.isFinite(parsedLine) ? Math.max(0, Math.floor(parsedLine)) : fallbackBodyStart;
			const maxLineLen = target?.dataset?.textLen !== undefined ? Number(target.dataset.textLen) : 0;
			const targetCh = this.estimateCharOffsetFromClick(previewEl.ownerDocument, target, me.clientX ?? 0, me.clientY ?? 0, maxLineLen);

			const scrollerRect = this.scrollerEl.getBoundingClientRect?.();
			const cardRect = entry.cardEl.getBoundingClientRect?.();
			const cardTopDelta = scrollerRect && cardRect ? cardRect.top - scrollerRect.top : 0;

			void this.requestChapterSwitch({
				file: entry.file,
				cursorLine: targetLine,
				cursorCh: targetCh,
				scrollMode: 'click-anchor',
				clickAnchor: {
					clientY: me.clientY ?? 0,
					cardTopDelta
				}
			});
		});
	}

	private estimateCharOffsetFromClick(
		doc: Document,
		lineEl: HTMLElement | null,
		clientX: number,
		clientY: number,
		maxLineLen: number
	): number {
		if (!lineEl || maxLineLen <= 0) return 0;

		try {
			const caretRangeFn = (doc as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
			if (typeof caretRangeFn === 'function') {
				const range = caretRangeFn.call(doc, clientX, clientY);
				if (range && lineEl.contains(range.startContainer)) {
					return Math.max(0, Math.min(maxLineLen, range.startOffset));
				}
			}
		} catch {
			// Fallback below
		}

		const rect = lineEl.getBoundingClientRect?.();
		if (rect && rect.width > 0) {
			const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			return Math.round(ratio * maxLineLen);
		}
		return 0;
	}

	private setupLazyObserver(scrollerEl: HTMLElement, activePath: string): void {
		const win = scrollerEl.ownerDocument?.defaultView ?? window;
		const Observer = win.IntersectionObserver;
		if (typeof Observer !== 'function') {
			const keys = Array.from(this.cardsByPath.keys());
			const activeIdx = keys.indexOf(activePath);
			for (const idx of [activeIdx - 1, activeIdx + 1]) {
				if (idx >= 0 && idx < keys.length) {
					this.visibleCardPaths.add(keys[idx]);
					this.enqueuePreviewRead(keys[idx], false);
				}
			}
			return;
		}

		this.observer = new Observer((entries) => {
			if (this.isDisposed) return;
			for (const ioEntry of entries) {
				const path = this.cardElsToPath.get(ioEntry.target);
				if (!path) continue;
				const cardEntry = this.cardsByPath.get(path);
				if (!cardEntry) continue;

				if (ioEntry.isIntersecting) {
					this.visibleCardPaths.add(path);
					if (cardEntry.rendered) {
						this.renderedPreviewPaths.delete(path);
						this.renderedPreviewPaths.add(path);
					}
					if (path !== this.activeFilePath && !cardEntry.rendered) {
						this.enqueuePreviewRead(path, false);
					}
				} else {
					this.visibleCardPaths.delete(path);
					this.dequeuePreviewRead(path);
					this.evictOffscreenPreviewsIfNeeded();
				}
			}
		}, { root: scrollerEl, rootMargin: LAZY_OBSERVER_MARGIN });

		for (const entry of this.cardsByPath.values()) {
			this.observer.observe(entry.cardEl);
		}
	}

	private teardownLazyObserver(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	private enqueuePreviewRead(path: string, prioritize: boolean, forceReload = false): void {
		const entry = this.cardsByPath.get(path);
		if (!entry || path === this.activeFilePath) return;
		if (entry.isLoading) {
			if (forceReload) {
				entry.needsReload = true;
				entry.previewVersion++;
			}
			return;
		}
		if (entry.rendered && !forceReload) return;

		if (forceReload) {
			entry.needsReload = true;
			entry.previewVersion++;
		}

		const overrideText = forceReload ? undefined : this.contentOverrides.get(path);
		if (typeof overrideText === 'string') {
			this.renderPreviewText(entry, overrideText);
			return;
		}

		if (this.pendingReadSet.has(path)) {
			if (prioritize) {
				this.pendingReadQueue = [path, ...this.pendingReadQueue.filter(p => p !== path)];
			}
			return;
		}

		this.pendingReadSet.add(path);
		if (prioritize) {
			this.pendingReadQueue.unshift(path);
		} else {
			this.pendingReadQueue.push(path);
		}
		this.pumpPreviewReads();
	}

	private dequeuePreviewRead(path: string): void {
		if (!this.pendingReadSet.has(path)) return;
		this.pendingReadSet.delete(path);
		this.pendingReadQueue = this.pendingReadQueue.filter(p => p !== path);
	}

	private pumpPreviewReads(): void {
		if (this.isDisposed) return;
		const generation = this.sessionGeneration;
		const readGen = this.previewGeneration;

		while (this.inFlightReads.size < MAX_CONCURRENT_PREVIEW_READS && this.pendingReadQueue.length > 0) {
			if (this.isDisposed) break;
			const nextPath = this.pendingReadQueue.shift()!;
			this.pendingReadSet.delete(nextPath);
			const entry = this.cardsByPath.get(nextPath);
			if (!entry || entry.isLoading || nextPath === this.activeFilePath) {
				continue;
			}
			if (entry.rendered && !entry.needsReload) {
				continue;
			}

			const capturedVersion = entry.previewVersion;
			const wasForceReload = entry.needsReload;
			entry.needsReload = false;
			entry.isLoading = true;

			let readTask: Promise<void>;
			readTask = this.host.app.vault.cachedRead(entry.file).then((content) => {
				if (this.isDisposed || generation !== this.sessionGeneration || readGen !== this.previewGeneration) return;
				const currentEntry = this.cardsByPath.get(nextPath);
				if (!currentEntry || nextPath === this.activeFilePath) return;
				if (currentEntry.previewVersion !== capturedVersion || currentEntry.needsReload) return;
				if (currentEntry.rendered && !wasForceReload) return;
				if (this.observer && !wasForceReload && !this.visibleCardPaths.has(nextPath)) return;
				const overrideText = wasForceReload ? undefined : this.contentOverrides.get(nextPath);
				const textToRender = typeof overrideText === 'string' ? overrideText : content;
				const heightBefore = currentEntry.cardEl.getBoundingClientRect?.().height ?? 0;
				const scrollTopBefore = this.scrollerEl?.scrollTop ?? 0;
				const scrollerRect = this.scrollerEl?.getBoundingClientRect?.();
				const cardRectBefore = currentEntry.cardEl.getBoundingClientRect?.();
				const wasAboveViewport = Boolean(
					this.scrollerEl &&
					scrollerRect &&
					cardRectBefore &&
					cardRectBefore.bottom <= scrollerRect.top
				);
				currentEntry.isLoading = false;
				this.renderPreviewText(currentEntry, textToRender);
				if (wasAboveViewport && this.scrollerEl && !this.isScrollbarDragging) {
					const heightAfter = currentEntry.cardEl.getBoundingClientRect?.().height ?? 0;
					const delta = heightAfter - heightBefore;
					if (delta !== 0) {
						this.scrollerEl.scrollTop = Math.max(0, scrollTopBefore + delta);
					}
				}
			}).catch((error) => {
				Logger.warn(`[ImmersiveManuscriptController] 读取章节预览失败 (${nextPath}):`, error);
			}).finally(() => {
				this.inFlightReads.delete(readTask);
				if (entry.isLoading) {
					entry.isLoading = false;
				}
				if (!this.isDisposed && generation === this.sessionGeneration && readGen === this.previewGeneration) {
					const currentEntry = this.cardsByPath.get(nextPath);
					if (currentEntry?.needsReload) {
						this.enqueuePreviewRead(nextPath, true, true);
					}
					this.pumpPreviewReads();
				} else if (!this.isDisposed) {
					this.pumpPreviewReads();
				}
			});
			this.inFlightReads.add(readTask);
		}
	}

	private renderPreviewText(entry: ChapterCardEntry, rawText: string): void {
		if (!entry.previewEl) return;
		const previewEl = entry.previewEl;
		previewEl.empty?.();
		previewEl.classList?.remove('wn-manuscript-lazy-shell');
		previewEl.style?.removeProperty?.('--wn-manuscript-estimated-height');
		entry.lineElements = [];

		const { yamlHeader, body } = ChapterDiffEngine.splitFrontmatterAndBody(rawText);
		const bodyStartLine = computeBodyStartLine(yamlHeader);
		if (previewEl.dataset) {
			previewEl.dataset.bodyStartLine = String(bodyStartLine);
		}

		const lines = body.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const lineText = lines[i];
			const clsParts = ['wn-manuscript-preview-line'];
			if (lineText.trim().length === 0) {
				clsParts.push('is-blank');
			} else if (/^#{1,6}\s/.test(lineText)) {
				clsParts.push('is-heading');
			} else if (/^>\s?/.test(lineText)) {
				clsParts.push('is-blockquote');
			}
			const lineEl = previewEl.createDiv({
				cls: clsParts.join(' '),
				text: lineText.length > 0 ? lineText : '\u00A0'
			});
			if (lineEl.dataset) {
				lineEl.dataset.line = String(bodyStartLine + i);
				lineEl.dataset.textLen = String(lineText.length);
			}
			entry.lineElements.push(lineEl);
		}

		entry.rendered = true;
		entry.needsReload = false;
		this.renderedPreviewPaths.delete(entry.file.path);
		this.renderedPreviewPaths.add(entry.file.path);
		if (this.pendingRestoreToken > 0) {
			this.onPreviewMaterializedForRestore?.(entry.file.path);
		}
		this.evictOffscreenPreviewsIfNeeded();
	}

	private hasSelectionInsideCard(entry: ChapterCardEntry): boolean {
		const win = entry.previewEl?.ownerDocument?.defaultView ?? this.ownerWindowRef;
		const sel = win?.getSelection?.();
		if (!sel || sel.isCollapsed || !sel.toString()) return false;
		if (typeof sel.containsNode === 'function') {
			if (entry.previewEl && sel.containsNode(entry.previewEl, true)) return true;
			if (sel.containsNode(entry.cardEl, true)) return true;
			return false;
		}
		if (typeof sel.rangeCount === 'number' && sel.rangeCount > 0 && typeof sel.getRangeAt === 'function') {
			const range = sel.getRangeAt(0);
			if (typeof range?.intersectsNode === 'function') {
				if (entry.previewEl && range.intersectsNode(entry.previewEl)) return true;
				if (range.intersectsNode(entry.cardEl)) return true;
				return false;
			}
		}
		const isInside = (node: Node | null): boolean => {
			if (!node) return false;
			if (typeof entry.cardEl.contains === 'function' && entry.cardEl.contains(node)) {
				return true;
			}
			let cur: Node | null = node;
			while (cur) {
				if (cur === (entry.cardEl as unknown as Node)) return true;
				cur = cur.parentNode;
			}
			return false;
		};
		return isInside(sel.anchorNode) || isInside(sel.focusNode);
	}

	private evictOffscreenPreviewsIfNeeded(): void {
		if (this.isDisposed || this.renderedPreviewPaths.size <= MAX_OFFSCREEN_RENDERED_PREVIEWS) return;
		const reclaimable: ChapterCardEntry[] = [];
		for (const path of Array.from(this.renderedPreviewPaths)) {
			if (path === this.activeFilePath) continue;
			if (this.visibleCardPaths.has(path)) continue;
			if (this.pendingRestoreToken > 0 && this.pendingRestoreViewportPath === path) continue;
			const entry = this.cardsByPath.get(path);
			if (!entry || !entry.rendered || !entry.previewEl) {
				this.renderedPreviewPaths.delete(path);
				continue;
			}
			if (entry.isLoading) continue;
			if (this.hasSelectionInsideCard(entry)) continue;
			reclaimable.push(entry);
		}

		const excess = reclaimable.length - MAX_OFFSCREEN_RENDERED_PREVIEWS;
		if (excess <= 0) return;
		let evicted = 0;
		for (const entry of reclaimable) {
			if (evicted >= excess) break;
			const previewEl = entry.previewEl;
			if (!previewEl) continue;
			const measuredHeight =
				previewEl.getBoundingClientRect?.().height ??
				(previewEl as unknown as { offsetHeight?: number }).offsetHeight ??
				0;
			if (typeof measuredHeight !== 'number' || !Number.isFinite(measuredHeight) || measuredHeight <= 0) {
				// 隐藏或尚未布局完成时无法测得真实高度，延迟回收以避免估算高度破坏滚动几何
				continue;
			}
			previewEl.empty?.();
			previewEl.classList?.add('wn-manuscript-lazy-shell');
			previewEl.style?.setProperty?.('--wn-manuscript-estimated-height', `${measuredHeight}px`);
			entry.lineElements = [];
			entry.rendered = false;
			entry.isLoading = false;
			entry.needsReload = false;
			this.renderedPreviewPaths.delete(entry.file.path);
			evicted++;
		}
	}

	private onPreviewMaterializedForRestore: ((path: string) => void) | null = null;

	private recordContentOverride(filePath: string, content: string): void {
		if (this.contentOverrides.has(filePath)) {
			this.contentOverrides.delete(filePath);
		}
		this.contentOverrides.set(filePath, content);
		while (this.contentOverrides.size > MAX_CONTENT_OVERRIDES) {
			const oldestKey = this.contentOverrides.keys().next().value;
			if (oldestKey === undefined) break;
			this.contentOverrides.delete(oldestKey);
		}
	}

	private async runSwitchPump(): Promise<void> {
		const generation = this.sessionGeneration;
		while (this.pendingSwitchRequest !== null && !this.isDisposed && generation === this.sessionGeneration) {
			const activeView = this.getMainMarkdownView();
			const activeCm = activeView?.editor?.cm;
			if (activeCm?.composing) {
				const composed = await this.waitForCompositionEnd(activeCm, generation);
				if (!composed || this.isDisposed || generation !== this.sessionGeneration) {
					break;
				}
				continue;
			}

			const request = this.pendingSwitchRequest;
			this.pendingSwitchRequest = null;
			if (!request) break;

			if (!this.host.manuscriptManager.isEligibleManuscriptChapter(request.file)) {
				showPluginNotice(t('immersive.manuscript-nonchapter-blocked'));
				continue;
			}

			if (!this.mainLeaf) break;

			const currentView = this.getMainMarkdownView();
			const currentFile = currentView?.file ?? null;
			const isSameFile = currentFile?.path === request.file.path;

			if (isSameFile) {
				this.mountEditorIntoCard(request.file.path);
				this.applySwitchPostNavigation(currentView, request);
				this.captureCurrentPosition(false);
				continue;
			}

			// 切换前保存当前章节（使用公开 MarkdownView.save()，失败则保留当前编辑与数据）
			const outgoingPath = currentFile?.path ?? null;
			if (currentView && typeof (currentView as { save?: () => Promise<void> }).save === 'function') {
				try {
					await (currentView as unknown as { save: () => Promise<void> }).save();
				} catch (saveError) {
					Logger.error('[ImmersiveManuscriptController] 切换章节前保存当前章节失败:', saveError);
					showPluginNotice(t('immersive.manuscript-save-failed'));
					this.pendingSwitchRequest = null;
					return;
				}
			}

			if (this.isDisposed || generation !== this.sessionGeneration) break;

			// 在 save() 完成后再快照旧章节内容，避免异步保存期间编辑或格式化导致预览过期
			const outgoingContent = currentView?.file?.path === outgoingPath ? currentView?.getViewData?.() : undefined;
			if (outgoingPath && typeof outgoingContent === 'string') {
				this.recordContentOverride(outgoingPath, outgoingContent);
			}

			currentView?.editor?.cm?.dispatch?.({ effects: preserveTypewriterViewport.of(null) });

			const scrollerTopBefore = this.scrollerEl?.scrollTop ?? 0;

			this.host.onProgrammaticOpenStart?.();
			try {
				await this.mainLeaf.openFile(request.file, { active: true, state: { mode: 'source' } });
			} catch (openError) {
				Logger.error('[ImmersiveManuscriptController] 打开目标章节失败:', openError);
				showPluginNotice(t('immersive.manuscript-open-failed'));
				continue;
			} finally {
				this.host.onProgrammaticOpenEnd?.();
			}

			if (this.isDisposed || generation !== this.sessionGeneration) break;

			// 如果等待期间又出现了更新的跳转请求，直接合并到最新目标
			if (this.pendingSwitchRequest !== null) {
				continue;
			}

			const nextWork = this.host.manuscriptManager.getWorkPath(request.file);
			const workChanged = nextWork !== this.activeWorkPath;
			if (workChanged || !this.cardsByPath.has(request.file.path)) {
				this.rebuildCardsPreservingHost(request.file);
			} else {
				this.swapActiveCard(this.activeFilePath, request.file.path);
			}

			this.activeFilePath = request.file.path;
			this.activeWorkPath = nextWork;

			const nextView = this.getMainMarkdownView();
			if (this.scrollerEl && request.scrollMode === 'click-anchor') {
				// 恢复在切换瞬间可能被原生 openFile 清零的滚动基准，再精确对齐锚点
				this.scrollerEl.scrollTop = scrollerTopBefore;
			}
			this.applySwitchPostNavigation(nextView, request);
			this.captureCurrentPosition(true);
			this.host.onActiveChapterChanged?.(request.file, workChanged);
		}
	}

	private waitForCompositionEnd(cm: EditorView, generation: number): Promise<boolean> {
		if (!cm.composing) return Promise.resolve(true);
		const contentDom = cm.contentDOM;
		const win = contentDom?.ownerDocument?.defaultView ?? this.ownerWindowRef ?? window;

		return new Promise<boolean>((resolve) => {
			let settled = false;
			let fallbackTimer: number | null = null;
			const finish = (ok: boolean) => {
				if (settled) return;
				settled = true;
				contentDom?.removeEventListener?.('compositionend', onCompositionEnd);
				if (fallbackTimer !== null) win.clearTimeout(fallbackTimer);
				if (this.compositionAbort === abort) {
					this.compositionAbort = null;
				}
				resolve(ok);
			};

			const onCompositionEnd = () => {
				win.setTimeout(() => {
					if (this.isDisposed || generation !== this.sessionGeneration) {
						finish(false);
						return;
					}
					finish(true);
				}, 0);
			};

			const abort = () => finish(false);
			this.compositionAbort = abort;
			contentDom?.addEventListener?.('compositionend', onCompositionEnd);
			// 保护：若宿主异常未触发 compositionend，轮询退避等待组合状态结束
			const poll = () => {
				if (settled) return;
				if (this.isDisposed || generation !== this.sessionGeneration) {
					finish(false);
					return;
				}
				if (!cm.composing) {
					finish(true);
					return;
				}
				fallbackTimer = win.setTimeout(poll, 50);
			};
			fallbackTimer = win.setTimeout(poll, 50);
		});
	}

	private applySwitchPostNavigation(view: MarkdownView | null, request: ManuscriptSwitchRequest): void {
		if (!view) return;
		const editor = view.editor;
		const cm = editor?.cm;
		// openFile may create a new typewriter instance; preserve the click/navigation
		// anchor before setting its cursor or focus, including clicks in preview text.
		cm?.dispatch?.({ effects: preserveTypewriterViewport.of(null) });

		if (request.scrollMode === 'restore-position' && request.restorePosition) {
			this.applyRestoredPosition(view, request.restorePosition, true);
			return;
		}

		if (request.scrollMode === 'click-anchor') {
			const line = Math.max(0, request.cursorLine ?? 0);
			const ch = Math.max(0, request.cursorCh ?? 0);
			this.setEditorCursorSafe(view, line, ch);
			this.focusEditorSafe(view, true);
			cm?.requestMeasure?.();
			if (this.scrollerEl && request.clickAnchor) {
				const scrollerRect = this.scrollerEl.getBoundingClientRect?.();
				const cardEntry = this.cardsByPath.get(request.file.path);
				const headPos = cm?.state?.selection?.main?.head;
				const coords = (headPos !== undefined && cm?.coordsAtPos) ? cm.coordsAtPos(headPos) : null;
				if (coords && (coords.bottom > coords.top || coords.top !== 0 || coords.bottom !== 0)) {
					const lineCenter = (coords.top + coords.bottom) / 2;
					this.scrollerEl.scrollTop = Math.max(0, this.scrollerEl.scrollTop + (lineCenter - request.clickAnchor.clientY));
				} else if (scrollerRect && cardEntry?.cardEl) {
					const newCardTopDelta = cardEntry.cardEl.getBoundingClientRect().top - scrollerRect.top;
					this.scrollerEl.scrollTop = Math.max(0, this.scrollerEl.scrollTop + (newCardTopDelta - request.clickAnchor.cardTopDelta));
				}
				cm?.requestMeasure?.();
			}
			// 用户已完成切章定位，恢复打字机跟随，无需再次点击正文。
			cm?.dispatch?.({ annotations: Transaction.userEvent.of('select') });
			return;
		}

		if (request.scrollMode === 'chapter-start') {
			const raw = view.getViewData?.() ?? '';
			const { yamlHeader } = ChapterDiffEngine.splitFrontmatterAndBody(raw);
			const bodyStartLine = computeBodyStartLine(yamlHeader);
			this.setEditorCursorSafe(view, bodyStartLine, 0);
			this.focusEditorSafe(view, true);
			cm?.dispatch?.({ effects: preserveTypewriterViewport.of(null) });
			this.scrollActiveCardIntoViewIfNeeded(true);
			cm?.requestMeasure?.();
			cm?.dispatch?.({ annotations: Transaction.userEvent.of('select') });
			return;
		}

		cm?.requestMeasure?.();
	}

	private applyRestoredPosition(
		view: MarkdownView | null,
		position: PersistedManuscriptPosition,
		shouldFocus: boolean
	): void {
		if (!view) return;
		this.cancelPendingViewportRestore();
		this.setEditorCursorSafe(view, position.cursorLine, position.cursorCh);

		const targetViewportPath =
			position.viewportFilePath && this.cardsByPath.has(position.viewportFilePath)
				? position.viewportFilePath
				: position.filePath;
		const isIndependentViewport = targetViewportPath !== position.filePath;

		if (shouldFocus) {
			this.focusEditorSafe(view, isIndependentViewport);
		}
		const cm = view.editor?.cm;
		// 在聚焦后再发送 preserveTypewriterViewport，避免打字机把远离光标的阅读视口拉回光标行
		cm?.dispatch?.({ effects: preserveTypewriterViewport.of(null) });

		const targetCard = this.cardsByPath.get(targetViewportPath);
		if (!this.scrollerEl || !targetCard?.cardEl || this.isScrollbarDragging) {
			cm?.requestMeasure?.();
			return;
		}

		const relScroll = position.chapterRelativeScroll ?? 0;
		const initialTop = Math.max(0, (targetCard.cardEl.offsetTop ?? 0) + relScroll);
		this.setScrollerScrollTop(initialTop);

		const token = ++this.pendingRestoreToken;
		this.pendingRestoreViewportPath = targetViewportPath;
		const generation = this.sessionGeneration;

		const cancelRestore = () => {
			if (this.pendingRestoreToken === token) {
				this.pendingRestoreToken = 0;
				this.pendingRestoreViewportPath = null;
			}
			this.onPreviewMaterializedForRestore = null;
			this.restoreCancelFn = null;
			this.scrollerEl?.removeEventListener?.('wheel', cancelRestore);
			this.scrollerEl?.removeEventListener?.('touchmove', cancelRestore);
			this.scrollerEl?.removeEventListener?.('pointerdown', cancelRestore);
			cm?.contentDOM?.removeEventListener?.('keydown', cancelRestore);
		};
		this.restoreCancelFn = cancelRestore;
		this.scrollerEl.addEventListener('wheel', cancelRestore, { passive: true });
		this.scrollerEl.addEventListener('touchmove', cancelRestore, { passive: true });
		this.scrollerEl.addEventListener('pointerdown', cancelRestore, { passive: true });
		cm?.contentDOM?.addEventListener?.('keydown', cancelRestore, { passive: true });

		const alignViewportAnchor = () => {
			if (this.isDisposed || this.sessionGeneration !== generation || this.pendingRestoreToken !== token) return;
			if (isIndependentViewport) {
				this.alignInactiveCardLineAnchor(targetCard, position);
			} else {
				this.alignActiveCardLineAnchor(view, targetCard, position);
			}
			cancelRestore();
		};

		if (isIndependentViewport && !targetCard.rendered) {
			this.onPreviewMaterializedForRestore = (materializedPath: string) => {
				if (materializedPath === targetViewportPath) {
					alignViewportAnchor();
				}
			};
			this.enqueuePreviewRead(targetViewportPath, true);
		} else {
			alignViewportAnchor();
		}

		cm?.requestMeasure?.();
	}

	private alignInactiveCardLineAnchor(card: ChapterCardEntry, position: PersistedManuscriptPosition): void {
		if (!this.scrollerEl) return;
		const lineNum = position.viewportLine;
		const offset = position.viewportLineOffset ?? 0;
		if (lineNum !== undefined && card.previewEl) {
			const lines = card.lineElements.length > 0
				? card.lineElements
				: Array.from(card.previewEl.querySelectorAll<HTMLElement>('.wn-manuscript-preview-line') ?? []);
			const targetLineEl = lines.find(el => Number(el.dataset?.line) === lineNum) ?? null;
			if (targetLineEl) {
				const scrollerRect = this.scrollerEl.getBoundingClientRect?.();
				const firstRect = lines[0]?.getBoundingClientRect?.();
				const lastRect = lines[lines.length - 1]?.getBoundingClientRect?.();
				const hasDistinctRects = Boolean(
					scrollerRect && firstRect && lastRect && lines.length > 1 && lastRect.top > firstRect.top
				);
				if (hasDistinctRects && scrollerRect) {
					const lineRect = targetLineEl.getBoundingClientRect();
					const delta = lineRect.top - scrollerRect.top + offset;
					this.setScrollerScrollTop(Math.max(0, (this.scrollerEl.scrollTop ?? 0) + delta));
					return;
				}
				if ((targetLineEl.offsetTop ?? 0) > 0) {
					const cardTop = card.cardEl.offsetTop ?? 0;
					const previewTop = card.previewEl.offsetTop ?? 0;
					this.setScrollerScrollTop(Math.max(0, cardTop + previewTop + targetLineEl.offsetTop + offset));
					return;
				}
			}
		}
		const fallbackTop = Math.max(0, (card.cardEl.offsetTop ?? 0) + (position.chapterRelativeScroll ?? 0));
		this.setScrollerScrollTop(fallbackTop);
	}

	private alignActiveCardLineAnchor(
		view: MarkdownView,
		card: ChapterCardEntry,
		position: PersistedManuscriptPosition
	): void {
		if (!this.scrollerEl) return;
		const anchorLine = position.viewportLine ?? position.anchorLine;
		const cm = view.editor?.cm;
		const doc = cm?.state?.doc;
		if (
			anchorLine !== undefined &&
			cm &&
			doc &&
			typeof doc.lines === 'number' &&
			doc.lines >= 1 &&
			typeof doc.line === 'function' &&
			typeof cm.coordsAtPos === 'function'
		) {
			const clampedLine = Math.max(0, Math.min(doc.lines - 1, anchorLine));
			const linePos = doc.line(clampedLine + 1).from;
			const coords = cm.coordsAtPos(linePos);
			const scrollerRect = this.scrollerEl.getBoundingClientRect?.();
			if (coords && scrollerRect && scrollerRect.height > 0 && coords.bottom > coords.top) {
				const delta = coords.top - scrollerRect.top + (position.viewportLineOffset ?? 0);
				this.setScrollerScrollTop(Math.max(0, (this.scrollerEl.scrollTop ?? 0) + delta));
				return;
			}
		}
		const fallbackTop = Math.max(0, (card.cardEl.offsetTop ?? 0) + (position.chapterRelativeScroll ?? 0));
		this.setScrollerScrollTop(fallbackTop);
	}

	private cancelPendingViewportRestore(): void {
		if (this.restoreCancelFn) {
			this.restoreCancelFn();
			this.restoreCancelFn = null;
		} else {
			this.pendingRestoreToken = 0;
			this.pendingRestoreViewportPath = null;
			this.onPreviewMaterializedForRestore = null;
		}
	}

	private setScrollerScrollTop(targetTop: number): void {
		if (!this.scrollerEl) return;
		if (typeof this.scrollerEl.scrollTo === 'function') {
			this.scrollerEl.scrollTo({ top: targetTop, behavior: 'auto' });
		} else {
			this.scrollerEl.scrollTop = targetTop;
		}
	}

	private captureViewportAnchor(view: MarkdownView | null, cursorLine: number): ViewportAnchorSnapshot | null {
		if (!this.scrollerEl || this.cardsByPath.size === 0) return null;
		const scrollerTop = this.scrollerEl.scrollTop ?? 0;

		// Cards remain in document order; avoid visiting every preceding chapter on each input/scroll.
		let low = 0;
		let high = this.orderedCards.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if ((this.orderedCards[mid].cardEl.offsetTop ?? 0) <= scrollerTop + 24) low = mid;
			else high = mid - 1;
		}
		const visibleCard = this.orderedCards[low];
		if (!visibleCard) return null;

		const cardRelativeScroll = Math.max(0, scrollerTop - (visibleCard.cardEl.offsetTop ?? 0));
		if (visibleCard.file.path === this.activeFilePath) {
			const cmAnchor = this.findVisibleActiveLineAnchor(view);
			const line = cmAnchor?.line ?? cursorLine;
			return {
				viewportFilePath: visibleCard.file.path,
				viewportLine: line,
				viewportLineOffset: cmAnchor?.offset,
				chapterRelativeScroll: cardRelativeScroll,
				activeAnchorLine: line
			};
		}

		const previewAnchor = this.findVisiblePreviewLineAnchor(visibleCard, cardRelativeScroll);
		const bodyStartFallback = visibleCard.previewEl?.dataset?.bodyStartLine !== undefined
			? Number(visibleCard.previewEl.dataset.bodyStartLine)
			: undefined;
		const resolvedLine = previewAnchor?.line
			?? (Number.isFinite(bodyStartFallback) ? Math.max(0, Math.floor(bodyStartFallback!)) : undefined);
		return {
			viewportFilePath: visibleCard.file.path,
			viewportLine: resolvedLine,
			viewportLineOffset: previewAnchor?.offset,
			chapterRelativeScroll: cardRelativeScroll,
			activeAnchorLine: cursorLine
		};
	}

	private findVisibleActiveLineAnchor(view: MarkdownView | null): { line: number; offset: number } | null {
		const cm = view?.editor?.cm;
		const scrollerRect = this.scrollerEl?.getBoundingClientRect?.();
		const contentRect = cm?.contentDOM?.getBoundingClientRect?.();
		if (
			!cm ||
			!scrollerRect ||
			scrollerRect.height <= 0 ||
			typeof cm.posAtCoords !== 'function' ||
			typeof cm.coordsAtPos !== 'function' ||
			typeof cm.state?.doc?.lineAt !== 'function'
		) {
			return null;
		}
		const probeX = Math.max(scrollerRect.left, contentRect?.left ?? scrollerRect.left) + 4;
		const probeY = scrollerRect.top + 8;
		const pos = cm.posAtCoords({ x: probeX, y: probeY });
		if (pos === null) return null;
		const lineInfo = cm.state.doc.lineAt(pos);
		const coords = cm.coordsAtPos(lineInfo.from);
		const offset = coords ? Math.max(0, Math.round(scrollerRect.top - coords.top)) : 0;
		return {
			line: Math.max(0, lineInfo.number - 1),
			offset
		};
	}

	private findVisiblePreviewLineAnchor(
		entry: ChapterCardEntry,
		cardRelativeScroll: number
	): { line: number; offset: number } | null {
		if (!entry.rendered || !entry.previewEl || !this.scrollerEl) return null;
		const lines = entry.lineElements.length > 0
			? entry.lineElements
			: Array.from(entry.previewEl.querySelectorAll<HTMLElement>('.wn-manuscript-preview-line') ?? []);
		if (!lines.length) return null;
		const scrollerRect = this.scrollerEl.getBoundingClientRect?.();
		const firstRect = lines[0].getBoundingClientRect?.();
		const lastRect = lines[lines.length - 1].getBoundingClientRect?.();
		const hasDistinctRects = Boolean(
			scrollerRect && firstRect && lastRect && lines.length > 1 && lastRect.top > firstRect.top
		);
		if (hasDistinctRects && scrollerRect) {
			let low = 0;
			let high = lines.length - 1;
			while (low < high) {
				const mid = Math.floor((low + high) / 2);
				if (lines[mid].getBoundingClientRect().bottom <= scrollerRect.top + 2) low = mid + 1;
				else high = mid;
			}
			const lineEl = lines[low];
			const rect = lineEl.getBoundingClientRect();
			const parsed = lineEl.dataset?.line !== undefined ? Number(lineEl.dataset.line) : NaN;
			if (rect.bottom > scrollerRect.top + 2 && Number.isFinite(parsed)) {
				return {
					line: Math.max(0, Math.floor(parsed)),
					offset: Math.max(0, Math.round(scrollerRect.top - rect.top))
				};
			}
		}

		let candidate: HTMLElement | null = null;
		const previewOffset = entry.previewEl.offsetTop ?? 0;
		for (const lineEl of lines) {
			const relTop = (lineEl.offsetTop ?? 0) + previewOffset;
			if (relTop > 0 && relTop <= cardRelativeScroll + 16) {
				candidate = lineEl;
			}
		}
		if (candidate && candidate.dataset?.line !== undefined) {
			const parsed = Number(candidate.dataset.line);
			if (Number.isFinite(parsed)) {
				const relTop = (candidate.offsetTop ?? 0) + previewOffset;
				return {
					line: Math.max(0, Math.floor(parsed)),
					offset: Math.max(0, Math.round(cardRelativeScroll - relTop))
				};
			}
		}
		return null;
	}

	private setEditorCursorSafe(view: MarkdownView, line: number, ch: number): void {
		const editor = view.editor;
		if (!editor) return;
		const lineCount = typeof editor.lineCount === 'function' ? editor.lineCount() : undefined;
		const clampedLine = lineCount !== undefined ? Math.max(0, Math.min(lineCount - 1, line)) : Math.max(0, line);
		const lineText = typeof editor.getLine === 'function' ? editor.getLine(clampedLine) : undefined;
		const clampedCh = typeof lineText === 'string' ? Math.max(0, Math.min(lineText.length, ch)) : Math.max(0, ch);
		editor.setCursor?.({ line: clampedLine, ch: clampedCh });
	}

	private isEditorFocused(ownerDoc: Document, editorHostEl: HTMLElement | null, view: MarkdownView | null): boolean {
		const activeEl = ownerDoc.activeElement as Node | null;
		if (activeEl && editorHostEl && typeof editorHostEl.contains === 'function' && editorHostEl.contains(activeEl)) {
			return true;
		}
		if (view?.editor?.cm?.hasFocus) return true;
		const hasFocusFn = (view?.editor as unknown as { hasFocus?: () => boolean } | undefined)?.hasFocus;
		return Boolean(typeof hasFocusFn === 'function' && hasFocusFn.call(view?.editor));
	}

	private focusEditorSafe(view: MarkdownView, preventScroll = false): void {
		const cm = view.editor?.cm;
		const contentDom = cm?.contentDOM;
		if (preventScroll && contentDom && typeof contentDom.focus === 'function') {
			contentDom.focus({ preventScroll: true });
			return;
		}
		if (cm && typeof cm.focus === 'function') {
			cm.focus();
		} else {
			view.editor?.focus?.();
		}
	}

	private scrollActiveCardIntoViewIfNeeded(alignTop: boolean): void {
		if (!this.scrollerEl || !this.activeFilePath) return;
		const entry = this.cardsByPath.get(this.activeFilePath);
		if (!entry) return;
		if (alignTop) {
			const targetTop = Math.max(0, (entry.cardEl.offsetTop ?? 0) - 16);
			this.setScrollerScrollTop(targetTop);
		}
	}

	private isFileInCurrentScope(file: TFile): boolean {
		const fileWork = this.host.manuscriptManager.getWorkPath(file);
		if (this.activeWorkPath) {
			return fileWork === this.activeWorkPath || file.path.startsWith(`${this.activeWorkPath}/`);
		}
		return !file.path.includes('/');
	}

	private isPathPrefixInScope(targetPath: string): boolean {
		if (!targetPath) return false;
		if (this.activeWorkPath) {
			return targetPath === this.activeWorkPath || targetPath.startsWith(`${this.activeWorkPath}/`);
		}
		return !targetPath.includes('/');
	}

	private deferStructuralRefreshAfterComposition(cm: EditorView): void {
		if (this.refreshAfterComposeCleanup) return;
		const contentDom = cm.contentDOM;
		const win = contentDom?.ownerDocument?.defaultView ?? this.ownerWindowRef ?? window;
		const generation = this.sessionGeneration;

		const finish = () => {
			if (!this.refreshAfterComposeCleanup) return;
			const cleanup = this.refreshAfterComposeCleanup;
			this.refreshAfterComposeCleanup = null;
			cleanup();
			if (!this.isDisposed && generation === this.sessionGeneration) {
				this.refreshChapterList();
			}
		};

		const onCompositionEnd = () => {
			win.setTimeout(() => {
				if (cm.composing) return;
				finish();
			}, 0);
		};
		const pollTimer = win.setTimeout(() => {
			if (!cm.composing) {
				finish();
			} else {
				const retry = this.refreshAfterComposeCleanup;
				this.refreshAfterComposeCleanup = null;
				retry?.();
				if (!this.isDisposed && generation === this.sessionGeneration) {
					this.deferStructuralRefreshAfterComposition(cm);
				}
			}
		}, 120);

		contentDom?.addEventListener?.('compositionend', onCompositionEnd);
		this.refreshAfterComposeCleanup = () => {
			contentDom?.removeEventListener?.('compositionend', onCompositionEnd);
			win.clearTimeout(pollTimer);
		};
	}

	private attachDomAndVaultListeners(scrollerEl: HTMLElement, ownerDoc: Document): void {
		const onScroll = () => {
			if (this.isDisposed) return;
			this.scheduleScrollPositionCapture();
			this.scheduleDebouncedPersist();
		};
		const onSelectionOrKey = () => {
			if (this.isDisposed) return;
			this.captureCurrentPosition(false);
		};
		const onScrollbarPointerDown = (evt?: Event) => {
			if (this.isDisposed) return;
			if (this.isScrollbarTarget(scrollerEl, evt)) {
				this.startScrollbarDrag();
			}
		};
		const onDragRelease = () => {
			this.endScrollbarDrag();
		};
		const onPointerMove = (evt?: Event) => {
			if (!this.isScrollbarDragging) return;
			const buttons = (evt as { buttons?: unknown } | undefined)?.buttons;
			if (typeof buttons === 'number' && buttons === 0) {
				this.endScrollbarDrag();
			}
		};
		const win = ownerDoc.defaultView ?? this.ownerWindowRef ?? window;
		let lastViewportHeight = -1;
		const syncViewportHeight = () => {
			if (this.isDisposed || this.scrollerEl !== scrollerEl) return;
			const height = scrollerEl.clientHeight ?? 0;
			if (typeof height === 'number' && Number.isFinite(height) && height > 0 && height !== lastViewportHeight) {
				lastViewportHeight = height;
				scrollerEl.style?.setProperty?.('--wn-manuscript-viewport-height', `${height}px`);
			}
		};
		syncViewportHeight();

		const ResizeObserverCtor = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (typeof ResizeObserverCtor === 'function') {
			const resizeObserver = new ResizeObserverCtor(() => {
				syncViewportHeight();
			});
			resizeObserver.observe(scrollerEl);
			this.domCleanups.push(() => {
				resizeObserver.disconnect();
			});
		}

		scrollerEl.addEventListener('scroll', onScroll, { passive: true });
		scrollerEl.addEventListener('keyup', onSelectionOrKey, { passive: true });
		scrollerEl.addEventListener('pointerup', onSelectionOrKey, { passive: true });
		scrollerEl.addEventListener('pointerdown', onScrollbarPointerDown, { passive: true });
		scrollerEl.addEventListener('mousedown', onScrollbarPointerDown, { passive: true });
		ownerDoc.addEventListener('pointerup', onDragRelease);
		ownerDoc.addEventListener('mouseup', onDragRelease);
		ownerDoc.addEventListener('pointercancel', onDragRelease);
		ownerDoc.addEventListener('touchend', onDragRelease);
		ownerDoc.addEventListener('touchcancel', onDragRelease);
		ownerDoc.addEventListener('pointermove', onPointerMove, { passive: true });
		ownerDoc.addEventListener('mousemove', onPointerMove, { passive: true });
		win.addEventListener('blur', onDragRelease);
		this.domCleanups.push(() => {
			scrollerEl.removeEventListener('scroll', onScroll);
			scrollerEl.removeEventListener('keyup', onSelectionOrKey);
			scrollerEl.removeEventListener('pointerup', onSelectionOrKey);
			scrollerEl.removeEventListener('pointerdown', onScrollbarPointerDown);
			scrollerEl.removeEventListener('mousedown', onScrollbarPointerDown);
			ownerDoc.removeEventListener('pointerup', onDragRelease);
			ownerDoc.removeEventListener('mouseup', onDragRelease);
			ownerDoc.removeEventListener('pointercancel', onDragRelease);
			ownerDoc.removeEventListener('touchend', onDragRelease);
			ownerDoc.removeEventListener('touchcancel', onDragRelease);
			ownerDoc.removeEventListener('pointermove', onPointerMove);
			ownerDoc.removeEventListener('mousemove', onPointerMove);
			win.removeEventListener('blur', onDragRelease);
		});

		const ws = this.host.app.workspace;
		if (ws && typeof ws.on === 'function') {
			this.eventRefs.push(
				ws.on('editor-change', (_editor, info) => {
					if (this.isDisposed) return;
					if (info?.file && info.file.path === this.activeFilePath) {
						this.captureCurrentPosition(false);
						this.scheduleDebouncedPersist();
					}
				})
			);
		}

		const vault = this.host.app.vault;
		if (vault && typeof vault.on === 'function') {
			const scheduleRefresh = () => {
				if (this.isDisposed) return;
				const win = ownerDoc.defaultView ?? this.ownerWindowRef ?? window;
				if (this.refreshTimer !== null) win.clearTimeout(this.refreshTimer);
				this.refreshTimer = win.setTimeout(() => {
					this.refreshTimer = null;
					this.refreshChapterList();
				}, 50);
			};

			const onCreate = (created: unknown) => {
				if (this.isDisposed || !this.isMounted()) return;
				if (
					created instanceof TFile &&
					this.host.manuscriptManager.isEligibleManuscriptChapter(created) &&
					this.isFileInCurrentScope(created)
				) {
					scheduleRefresh();
				}
			};

			const onDelete = (deleted: unknown) => {
				if (this.isDisposed || !this.isMounted() || !(deleted instanceof TFile || (deleted && typeof (deleted as { path?: string }).path === 'string'))) return;
				const deletedPath = (deleted as { path: string }).path;
				this.contentOverrides.delete(deletedPath);
				if (deletedPath === this.activeFilePath) {
					this.host.onMainChapterInvalidated?.();
					return;
				}
				if (this.cardsByPath.has(deletedPath) || this.isPathPrefixInScope(deletedPath)) {
					scheduleRefresh();
				}
			};

			const onRename = (renamed: unknown, oldPath: unknown) => {
				if (this.isDisposed || !this.isMounted() || typeof oldPath !== 'string') return;
				const liveView = this.getMainMarkdownView();
				const isActiveRename = oldPath === this.activeFilePath || (liveView?.file && renamed === liveView.file);
				const renamedFile = renamed instanceof TFile ? renamed : null;

				const prevOverride = this.contentOverrides.get(oldPath);
				if (prevOverride !== undefined) {
					this.contentOverrides.delete(oldPath);
					if (renamedFile) {
						this.recordContentOverride(renamedFile.path, prevOverride);
					}
				}

				if (isActiveRename) {
					const activeFile = liveView?.file ?? renamedFile;
					if (!(activeFile instanceof TFile) || !this.host.manuscriptManager.isEligibleManuscriptChapter(activeFile)) {
						this.host.onMainChapterInvalidated?.();
						return;
					}
					const prevPath = this.activeFilePath;
					this.activeFilePath = activeFile.path;
					const nextWork = this.host.manuscriptManager.getWorkPath(activeFile);
					const workChanged = nextWork !== this.activeWorkPath;
					this.activeWorkPath = nextWork;
					if (prevPath) {
						const existingCard = this.cardsByPath.get(prevPath);
						if (existingCard) {
							this.cardsByPath.delete(prevPath);
							existingCard.file = activeFile;
							existingCard.cardEl.dataset.chapterPath = activeFile.path;
							this.cardElsToPath.set(existingCard.cardEl, activeFile.path);
							this.cardsByPath.set(activeFile.path, existingCard);
							const titleEl = existingCard.headerEl.querySelector?.('.wn-manuscript-card-title');
							if (titleEl) {
								titleEl.textContent = activeFile.basename;
							}
							existingCard.headerEl.setAttribute?.(
								'aria-label',
								t('immersive.manuscript-chapter-button-label', { title: activeFile.basename })
							);
						}
					}
					scheduleRefresh();
					this.captureCurrentPosition(false);
					this.host.onActiveChapterChanged?.(activeFile, workChanged);
					return;
				}

				const oldInScope = this.cardsByPath.has(oldPath) || this.isPathPrefixInScope(oldPath);
				const newInScope = Boolean(
					renamedFile &&
					this.host.manuscriptManager.isEligibleManuscriptChapter(renamedFile) &&
					this.isFileInCurrentScope(renamedFile)
				);
				if (oldInScope || newInScope) {
					scheduleRefresh();
				}
			};

			const onModify = (modified: unknown) => {
				if (this.isDisposed || !this.isMounted()) return;
				if (!(modified instanceof TFile)) return;
				if (modified.path === this.activeFilePath) return;
				this.contentOverrides.delete(modified.path);
				const entry = this.cardsByPath.get(modified.path);
				if (!entry) return;
				if (entry.rendered || entry.isLoading || this.visibleCardPaths.has(modified.path)) {
					this.enqueuePreviewRead(modified.path, true, true);
				}
			};

			this.eventRefs.push(
				vault.on('create', onCreate),
				vault.on('rename', onRename),
				vault.on('delete', onDelete),
				vault.on('modify', onModify)
			);
		}
	}

	private isScrollbarTarget(scrollerEl: HTMLElement, evt?: Event): boolean {
		if (!evt || typeof scrollerEl.getBoundingClientRect !== 'function') return false;
		if (evt.target && evt.target !== scrollerEl) return false;
		const mouseEvt = evt as { clientX?: unknown; clientY?: unknown; button?: unknown };
		if (typeof mouseEvt.button === 'number' && mouseEvt.button !== 0) return false;
		if (typeof mouseEvt.clientX !== 'number' || typeof mouseEvt.clientY !== 'number') return false;
		const rect = scrollerEl.getBoundingClientRect();
		const scrollbarLeftEdge =
			typeof scrollerEl.clientWidth === 'number' && scrollerEl.clientWidth > 0 && scrollerEl.clientWidth < rect.width
				? rect.left + scrollerEl.clientWidth - 2
				: rect.right - 16;
		const isRightScrollbar = mouseEvt.clientX >= scrollbarLeftEdge && mouseEvt.clientX <= rect.right + 5;
		const isWithinVertical = mouseEvt.clientY >= rect.top && mouseEvt.clientY <= rect.bottom;
		return isRightScrollbar && isWithinVertical;
	}

	private startScrollbarDrag(): void {
		this.cancelPendingViewportRestore();
		this.isScrollbarDragging = true;
	}

	private endScrollbarDrag(): void {
		if (!this.isScrollbarDragging) return;
		this.isScrollbarDragging = false;
	}

	private scheduleDebouncedPersist(): void {
		const win = this.ownerWindowRef ?? window;
		if (this.positionPersistTimer !== null) {
			win.clearTimeout(this.positionPersistTimer);
		}
		this.positionPersistTimer = win.setTimeout(() => {
			this.positionPersistTimer = null;
			if (!this.isDisposed) {
				void this.host.manuscriptManager.save().catch((err) => {
					Logger.error('[ImmersiveManuscriptController] 自动保存原稿位置失败:', err);
				});
			}
		}, 400);
	}

	private detachDomAndVaultListeners(): void {
		for (const cleanup of this.domCleanups) {
			cleanup();
		}
		this.domCleanups = [];

		for (const ref of this.eventRefs) {
			this.host.app.workspace?.offref?.(ref);
			this.host.app.vault?.offref?.(ref);
		}
		this.eventRefs = [];
	}

	private scheduleScrollPositionCapture(): void {
		if (this.isDisposed || this.scrollCaptureRafId !== null) return;
		const win = this.ownerWindowRef ?? window;
		if (typeof win.requestAnimationFrame !== 'function') {
			this.captureCurrentPosition(false);
			return;
		}
		this.scrollCaptureRafId = win.requestAnimationFrame(() => {
			this.scrollCaptureRafId = null;
			if (!this.isDisposed && this.isMounted()) {
				this.captureCurrentPosition(false);
			}
		});
	}

	private cancelScheduledScrollCapture(): void {
		if (this.scrollCaptureRafId === null) return;
		const win = this.ownerWindowRef ?? window;
		if (typeof win.cancelAnimationFrame === 'function') {
			win.cancelAnimationFrame(this.scrollCaptureRafId);
		}
		this.scrollCaptureRafId = null;
	}

	private clearTimers(): void {
		this.cancelScheduledScrollCapture();
		const win = this.ownerWindowRef ?? window;
		if (this.positionPersistTimer !== null) {
			win.clearTimeout(this.positionPersistTimer);
			this.positionPersistTimer = null;
		}
		if (this.refreshTimer !== null) {
			win.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	private restoreDomFromSnapshot(): void {
		let outgoingRelScroll: number | null = null;
		if (this.scrollerEl && this.activeFilePath) {
			const activeCard = this.cardsByPath.get(this.activeFilePath);
			if (activeCard) {
				outgoingRelScroll = Math.max(0, (this.scrollerEl.scrollTop ?? 0) - (activeCard.cardEl.offsetTop ?? 0));
			}
		}
		this.restoreNativePadding?.();

		if (this.scrollerEl) {
			this.scrollerEl.classList?.remove('wn-manuscript-typewriter-active');
			this.scrollerEl.style?.removeProperty?.('--wn-manuscript-typewriter-padding-top');
			this.scrollerEl.style?.removeProperty?.('--wn-manuscript-typewriter-padding-bottom');
			this.scrollerEl.style?.removeProperty?.('--wn-manuscript-viewport-height');
		}

		const snap = this.snapshot;
		this.snapshot = null;
		if (!snap) {
			this.rootEl?.remove?.();
			return;
		}

		const { leafEl, viewContentEl, editorHostEl, originalParent, restoreAnchor, nextSibling } = snap;
		const hadFocusBeforeRestore = this.isEditorFocused(viewContentEl.ownerDocument, editorHostEl, this.getMainMarkdownView());
		const canRestoreIntoOriginalParent = Boolean(
			originalParent &&
			editorHostEl !== originalParent &&
			!editorHostEl.contains(originalParent)
		);

		if (canRestoreIntoOriginalParent) {
			if (restoreAnchor && restoreAnchor.parentNode === originalParent) {
				originalParent.insertBefore(editorHostEl, restoreAnchor);
			} else if (nextSibling && nextSibling.parentNode === originalParent) {
				originalParent.insertBefore(editorHostEl, nextSibling);
			} else {
				originalParent.appendChild(editorHostEl);
			}
		}

		if (restoreAnchor?.parentNode) {
			restoreAnchor.parentNode.removeChild(restoreAnchor);
		}

		this.rootEl?.remove?.();

		editorHostEl.classList?.remove('wn-manuscript-hosted-editor');
		viewContentEl.classList?.remove('wn-manuscript-view-content');
		leafEl?.classList?.remove('wn-manuscript-leaf', 'wn-manuscript-redirecting');

		const markdownView = this.getMainMarkdownView();
		const cm = markdownView?.editor?.cm;
		cm?.dom?.classList?.remove('wn-typewriter-manuscript');
		if (outgoingRelScroll !== null && outgoingRelScroll > 0) {
			markdownView?.editor?.scrollTo?.(0, outgoingRelScroll);
		}
		if (hadFocusBeforeRestore && markdownView) {
			this.focusEditorSafe(markdownView, true);
		}
		cm?.requestMeasure?.();
		cm?.dispatch?.({});
	}
}
