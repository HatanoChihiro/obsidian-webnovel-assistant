import { ViewPlugin, type ViewUpdate, Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 沉浸模式打字机 CodeMirror 6 扩展
 * 功能：
 * 1. 光标行精准居中滚动（算入 .cm-sizer 的 50vh 上留白与标题高度，保持 0% 偏移处于主编辑区正中心）
 * 2. 焦点行高亮与非焦点行平滑淡化
 */
export function createTypewriterExtension(plugin: WebNovelAssistantPlugin): Extension {
	class TypewriterPlugin {
		decorations: DecorationSet;
		private isScrolling = false;
		private isMouseDown = false;
		private hasInitialCentered = false;
		private scrollTimer: number | null = null;
		private view: EditorView;

		constructor(view: EditorView) {
			this.view = view;
			this.decorations = this.buildDecorations(view);

			if (view.scrollDOM) {
				view.scrollDOM.addEventListener('mousedown', this.onMouseDown);
			}
			activeDocument.addEventListener('mouseup', this.onMouseUp);
		}

		private onMouseDown = (): void => {
			this.isMouseDown = true;
		};

		private onMouseUp = (): void => {
			this.isMouseDown = false;
		};

		destroy() {
			if (this.scrollTimer !== null) {
				window.clearTimeout(this.scrollTimer);
				this.scrollTimer = null;
			}
			if (this.view.scrollDOM) {
				this.view.scrollDOM.removeEventListener('mousedown', this.onMouseDown);
			}
			activeDocument.removeEventListener('mouseup', this.onMouseUp);
		}

		update(update: ViewUpdate) {
			this.decorations = this.buildDecorations(update.view);

			// 仅在沉浸模式且打字机功能开启时生效
			if (!activeDocument.body.classList.contains('immersive-mode-active') || !plugin.settings.immersive.typewriterEnabled) {
				this.hasInitialCentered = false;
				return;
			}

			// 如果鼠标正按下拖拽，或处于文本选中状态（非单点光标），跳过自动居中以保障选中精准度
			if (this.isMouseDown || !update.state.selection.main.empty) {
				return;
			}

			// 刚进入沉浸模式时的初始化定位，或光标移动/输入文本时触发居中滚动
			if (!this.hasInitialCentered || update.selectionSet || update.docChanged) {
				this.hasInitialCentered = true;
				window.requestAnimationFrame(() => {
					this.centerCursorLine(update.view);
				});
			}
		}

		private centerCursorLine(view: EditorView) {
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
				if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer);
				this.scrollTimer = window.setTimeout(() => {
					this.isScrolling = false;
					this.scrollTimer = null;
				}, 120);
			}
		}

		private buildDecorations(view: EditorView): DecorationSet {
			if (!activeDocument.body.classList.contains('immersive-mode-active') || !plugin.settings.immersive.typewriterEnabled) {
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
