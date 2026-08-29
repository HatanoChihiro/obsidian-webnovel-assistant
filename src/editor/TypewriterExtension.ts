import { ViewPlugin, type ViewUpdate, Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import type { ImmersiveModeSettings } from '../types/settings';

export interface TypewriterExtensionPlugin {
	settings: {
		immersive: Pick<ImmersiveModeSettings, 'typewriterEnabled' | 'typewriterCenterOffset'>;
	};
}

/**
 * 沉浸模式打字机 CodeMirror 6 扩展
 * 功能：
 * 1. 光标行精准居中滚动（算入 .cm-sizer 的 50vh 上留白与标题高度，保持 0% 偏移处于主编辑区正中心）
 * 2. 焦点行高亮与非焦点行平滑淡化
 */
export function createTypewriterExtension(plugin: TypewriterExtensionPlugin): Extension {
	class TypewriterPlugin {
		decorations: DecorationSet;
		private isScrolling = false;
		private isPointerDown = false;
		private isManualScrolling = false;
		private gestureScrolled = false;
		private pendingClickSelection = false;
		private hasInitialCentered = false;
		private scrollTimer: number | null = null;
		private rafId: number | null = null;
		private view: EditorView;
		private ownerDocument: Document;
		private ownerWindow: Window;

		constructor(view: EditorView) {
			this.view = view;
			this.ownerDocument = view.scrollDOM.ownerDocument;
			this.ownerWindow = this.ownerDocument.defaultView ?? window;
			this.decorations = this.buildDecorations(view);

			if (view.scrollDOM) {
				view.scrollDOM.addEventListener('pointerdown', this.onPointerDown);
				view.scrollDOM.addEventListener('mousedown', this.onPointerDown);
				view.scrollDOM.addEventListener('wheel', this.onWheel, { passive: true });
				view.scrollDOM.addEventListener('touchstart', this.onTouchStart, { passive: true });
				view.scrollDOM.addEventListener('touchmove', this.onTouchMove, { passive: true });
				view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
			}
			this.ownerDocument.addEventListener('pointerup', this.onPointerUp);
			this.ownerDocument.addEventListener('mouseup', this.onPointerUp);
			this.ownerDocument.addEventListener('touchend', this.onPointerUp);
			this.ownerDocument.addEventListener('pointercancel', this.onPointerUp);
			this.ownerDocument.addEventListener('touchcancel', this.onPointerUp);
		}

		private isImmersiveTypewriterActive(): boolean {
			return this.ownerDocument.body.classList.contains('immersive-mode-active') && !!plugin.settings.immersive.typewriterEnabled;
		}

		private onWheel = (): void => {
			this.isManualScrolling = true;
			this.gestureScrolled = true;
			this.cancelPendingCenter();
			this.cancelSmoothScroll();
		};

		private onTouchStart = (): void => {
			this.isPointerDown = true;
			this.gestureScrolled = false;
			this.pendingClickSelection = false;
			this.cancelPendingCenter();
			this.cancelSmoothScroll();
		};

		private onTouchMove = (): void => {
			this.isManualScrolling = true;
			this.gestureScrolled = true;
			this.cancelPendingCenter();
			this.cancelSmoothScroll();
		};

		private onPointerDown = (): void => {
			this.isPointerDown = true;
			this.gestureScrolled = false;
			this.pendingClickSelection = false;
			this.cancelPendingCenter();
			this.cancelSmoothScroll();
		};

		private onScroll = (): void => {
			if (this.isPointerDown && !this.isScrolling) {
				this.isManualScrolling = true;
				this.gestureScrolled = true;
				this.cancelPendingCenter();
			}
		};

		private onPointerUp = (): void => {
			const wasPointerDown = this.isPointerDown;
			this.isPointerDown = false;

			if (!wasPointerDown) return;

			if (this.gestureScrolled) {
				this.pendingClickSelection = false;
				return;
			}

			if (this.pendingClickSelection && this.view.state.selection.main.empty && this.isImmersiveTypewriterActive()) {
				this.pendingClickSelection = false;
				this.isManualScrolling = false;
				this.cancelSmoothScroll();
				this.scheduleCenter(this.view);
			}
		};

		private cancelPendingCenter(): void {
			if (this.rafId !== null) {
				this.ownerWindow.cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
		}

		private cancelSmoothScroll(): void {
			if (this.scrollTimer !== null) {
				this.ownerWindow.clearTimeout(this.scrollTimer);
				this.scrollTimer = null;
			}
			if (this.isScrolling && this.view.scrollDOM) {
				const currentTop = this.view.scrollDOM.scrollTop;
				this.view.scrollDOM.scrollTo({
					top: currentTop,
					behavior: 'auto'
				});
			}
			this.isScrolling = false;
		}

		private scheduleCenter(view: EditorView): void {
			this.cancelPendingCenter();
			this.rafId = this.ownerWindow.requestAnimationFrame(() => {
				this.rafId = null;
				this.centerCursorLine(view);
			});
		}

		destroy() {
			this.cancelSmoothScroll();
			this.cancelPendingCenter();
			if (this.view.scrollDOM) {
				this.view.scrollDOM.removeEventListener('pointerdown', this.onPointerDown);
				this.view.scrollDOM.removeEventListener('mousedown', this.onPointerDown);
				this.view.scrollDOM.removeEventListener('wheel', this.onWheel);
				this.view.scrollDOM.removeEventListener('touchstart', this.onTouchStart);
				this.view.scrollDOM.removeEventListener('touchmove', this.onTouchMove);
				this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
			}
			this.ownerDocument.removeEventListener('pointerup', this.onPointerUp);
			this.ownerDocument.removeEventListener('mouseup', this.onPointerUp);
			this.ownerDocument.removeEventListener('touchend', this.onPointerUp);
			this.ownerDocument.removeEventListener('pointercancel', this.onPointerUp);
			this.ownerDocument.removeEventListener('touchcancel', this.onPointerUp);
		}

		update(update: ViewUpdate) {
			this.decorations = this.buildDecorations(update.view);

			// 仅在沉浸模式且打字机功能开启时生效
			if (!this.isImmersiveTypewriterActive()) {
				this.hasInitialCentered = false;
				this.cancelPendingCenter();
				return;
			}

			// 如果当前指针/触摸手势仍处于按住状态，发生的选区变动不能视为结束手动浏览的有意移动
			if (this.isPointerDown) {
				if (update.selectionSet && update.state.selection.main.empty) {
					this.pendingClickSelection = true;
				} else if (update.selectionSet && !update.state.selection.main.empty) {
					this.pendingClickSelection = false;
				}
				return;
			}

			// 指针未按住时的明确用户编辑或键盘移动光标操作，恢复打字机跟随
			if (update.docChanged || update.selectionSet) {
				this.isManualScrolling = false;
				this.cancelSmoothScroll();
			}

			// 如果用户正在手动滚动浏览，跳过自动居中
			if (this.isManualScrolling) {
				return;
			}

			// 如果处于文本选中状态（非单点光标），跳过自动居中以保障选中精准度
			if (!update.state.selection.main.empty) {
				return;
			}

			// 刚进入沉浸模式时的初始化定位，或光标移动/输入文本时触发居中滚动
			if (!this.hasInitialCentered || update.selectionSet || update.docChanged) {
				this.hasInitialCentered = true;
				this.scheduleCenter(update.view);
			}
		}

		private centerCursorLine(view: EditorView) {
			if (!this.isImmersiveTypewriterActive()) return;
			if (this.isManualScrolling || this.isPointerDown || !view.state.selection.main.empty) return;
			if (this.isScrolling) return;

			const head = view.state.selection.main.head;
			const scroller = view.scrollDOM;
			if (!scroller || scroller.clientHeight === 0) return;

			const lineBlock = view.lineBlockAt(head);
			const scrollerRect = scroller.getBoundingClientRect();
			const contentRect = view.contentDOM.getBoundingClientRect();

			// 偏移量：.cm-content 相对 .cm-scroller 的真实 DOM 上边距（包含 .cm-sizer 的 50vh 上留白与标题高度）
			const contentTopInScroller = (contentRect.top - scrollerRect.top) + scroller.scrollTop;

			// 光标在 .cm-scroller 整体文档中的真实物理纵坐标中心
			const lineCenterInScroller = contentTopInScroller + lineBlock.top + (lineBlock.height / 2);

			const viewportHeight = scroller.clientHeight;
			const centerOffset = plugin.settings.immersive.typewriterCenterOffset || 0;
			// 0% 即为主编辑区正中心 (50% 视口高度)
			const targetCenterRatio = 0.5 + (centerOffset / 100);
			const targetCenterPx = viewportHeight * targetCenterRatio;

			const desiredScrollTop = lineCenterInScroller - targetCenterPx;

			// 如果偏差超过 2 像素，平滑滚动至目标位置
			if (Math.abs(scroller.scrollTop - desiredScrollTop) > 2) {
				this.isScrolling = true;
				scroller.scrollTo({
					top: Math.max(0, desiredScrollTop),
					behavior: 'smooth'
				});
				if (this.scrollTimer !== null) this.ownerWindow.clearTimeout(this.scrollTimer);
				this.scrollTimer = this.ownerWindow.setTimeout(() => {
					this.isScrolling = false;
					this.scrollTimer = null;
				}, 120);
			}
		}

		private buildDecorations(view: EditorView): DecorationSet {
			if (!this.isImmersiveTypewriterActive()) {
				return Decoration.none;
			}

			const builder = new RangeSetBuilder<Decoration>();
			const head = view.state.selection.main.head;
			const activeLinePos = view.state.doc.lineAt(head).from;

			for (const { from, to } of view.visibleRanges) {
				for (let pos = from; pos <= to; ) {
					const line = view.state.doc.lineAt(pos);
					if (line.from === activeLinePos) {
						builder.add(line.from, line.from, Decoration.line({ attributes: { class: 'wn-typewriter-current-line' } }));
					} else {
						builder.add(line.from, line.from, Decoration.line({ attributes: { class: 'wn-typewriter-dimmed-line' } }));
					}
					pos = line.to + 1;
				}
			}
			return builder.finish();
		}
	}

	return ViewPlugin.fromClass(TypewriterPlugin, {
		decorations: (v: TypewriterPlugin) => v.decorations
	});
}
