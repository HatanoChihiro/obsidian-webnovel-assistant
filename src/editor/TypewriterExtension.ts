import { ViewPlugin, type ViewUpdate, Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import type { ImmersiveModeSettings, EditorTypewriterSettings } from '../types/settings';

export interface TypewriterExtensionPlugin {
	settings: {
		immersive: Pick<ImmersiveModeSettings, 'typewriterEnabled' | 'typewriterCenterOffset' | 'typewriterUnfocusedOpacity'>;
		editorTypewriter?: Pick<EditorTypewriterSettings, 'enabled' | 'centerOffset' | 'unfocusedOpacity'>;
	};
}

/**
 * 打字机 CodeMirror 6 扩展（支持沉浸模式与普通编辑模式）
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
			this.syncDomState();
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

		private getActiveConfig(): { isActive: boolean; centerOffset: number; unfocusedOpacity: number } {
			const isImmersive = this.ownerDocument.body.classList.contains('immersive-mode-active');
			if (isImmersive) {
				return {
					isActive: Boolean(plugin.settings.immersive?.typewriterEnabled),
					centerOffset: plugin.settings.immersive?.typewriterCenterOffset ?? 0,
					unfocusedOpacity: plugin.settings.immersive?.typewriterUnfocusedOpacity ?? 0.4
				};
			}
			return {
				isActive: Boolean(plugin.settings.editorTypewriter?.enabled),
				centerOffset: plugin.settings.editorTypewriter?.centerOffset ?? 0,
				unfocusedOpacity: plugin.settings.editorTypewriter?.unfocusedOpacity ?? 0.4
			};
		}

		private isTypewriterActive(): boolean {
			return this.getActiveConfig().isActive;
		}

		private syncDomState(): void {
			if (!this.view.dom) return;
			const config = this.getActiveConfig();
			if (config.isActive) {
				if (!this.view.dom.classList.contains('wn-typewriter-active')) {
					this.view.dom.classList.add('wn-typewriter-active');
				}
				const currentOpacity = this.view.dom.style.getPropertyValue('--wn-typewriter-opacity');
				const targetOpacity = String(config.unfocusedOpacity);
				if (currentOpacity !== targetOpacity) {
					this.view.dom.style.setProperty('--wn-typewriter-opacity', targetOpacity);
				}
			} else {
				if (this.view.dom.classList.contains('wn-typewriter-active')) {
					this.view.dom.classList.remove('wn-typewriter-active');
				}
				this.view.dom.style.removeProperty('--wn-typewriter-opacity');
			}
		}

		private onWheel = (): void => {
			this.isManualScrolling = true;
			this.gestureScrolled = true;
			this.cancelPendingCenter();
			this.cancelSmoothScroll(true);
		};

		private onTouchStart = (): void => {
			this.isPointerDown = true;
			this.gestureScrolled = false;
			this.pendingClickSelection = false;
			this.cancelPendingCenter();
			this.cancelSmoothScroll(true);
		};

		private onTouchMove = (): void => {
			this.isManualScrolling = true;
			this.gestureScrolled = true;
			this.cancelPendingCenter();
			this.cancelSmoothScroll(true);
		};

		private onPointerDown = (): void => {
			this.isPointerDown = true;
			this.gestureScrolled = false;
			this.pendingClickSelection = false;
			this.cancelPendingCenter();
			this.cancelSmoothScroll(true);
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

			if (this.pendingClickSelection && this.view.state.selection.main.empty && this.isTypewriterActive()) {
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

		private cancelSmoothScroll(force = false): void {
			if (this.scrollTimer !== null) {
				this.ownerWindow.clearTimeout(this.scrollTimer);
				this.scrollTimer = null;
			}
			if ((force || this.isScrolling) && this.view.scrollDOM) {
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
			if (this.view.dom) {
				this.view.dom.classList.remove('wn-typewriter-active');
				this.view.dom.style.removeProperty('--wn-typewriter-opacity');
			}
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
			this.syncDomState();
			this.decorations = this.buildDecorations(update.view);

			// 仅在当前模式下打字机功能开启时生效
			if (!this.isTypewriterActive()) {
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

			const isSelectionChanged = Boolean(
				update.selectionSet && !update.startState.selection.eq(update.state.selection)
			);

			// 指针未按住时的明确用户编辑或键盘移动光标操作，恢复打字机跟随
			if (update.docChanged || isSelectionChanged) {
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

			// 刚进入打字机模式时的初始化定位，或光标移动/输入文本时触发居中滚动
			if (!this.hasInitialCentered || isSelectionChanged || update.docChanged) {
				this.hasInitialCentered = true;
				this.scheduleCenter(update.view);
			}
		}

		private centerCursorLine(view: EditorView) {
			const config = this.getActiveConfig();
			if (!config.isActive) return;
			if (this.isManualScrolling || this.isPointerDown || !view.state.selection.main.empty) return;
			if (this.isScrolling) return;

			const head = view.state.selection.main.head;
			const scroller = view.scrollDOM;
			if (!scroller || scroller.clientHeight === 0) return;

			const scrollerRect = scroller.getBoundingClientRect();
			const viewportHeight = scroller.clientHeight;
			const centerOffset = config.centerOffset;
			// 0% 即为主编辑区正中心 (50% 视口高度)
			const targetCenterRatio = 0.5 + (centerOffset / 100);
			const targetCenterPx = viewportHeight * targetCenterRatio;

			const coords = view.coordsAtPos ? view.coordsAtPos(head) : null;
			let caretCenterInScroller: number;

			if (coords) {
				// 光标在 .cm-scroller 视口内的相对纵坐标中心
				const caretCenterInViewport = ((coords.top + coords.bottom) / 2) - scrollerRect.top;
				// 转换为 .cm-scroller 整体滚动内容中的绝对纵坐标
				caretCenterInScroller = caretCenterInViewport + scroller.scrollTop;
			} else {
				// 降级路径：当无法获取光标视觉坐标时（如未完成渲染测量），回退至逻辑行块中点
				const contentRect = view.contentDOM.getBoundingClientRect();
				const lineBlock = view.lineBlockAt(head);
				const contentTopInScroller = (contentRect.top - scrollerRect.top) + scroller.scrollTop;
				caretCenterInScroller = contentTopInScroller + lineBlock.top + (lineBlock.height / 2);
			}

			const desiredScrollTop = caretCenterInScroller - targetCenterPx;

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
			if (!this.isTypewriterActive()) {
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
