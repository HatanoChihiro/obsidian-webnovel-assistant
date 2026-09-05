import { ViewPlugin, type ViewUpdate, Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { RangeSetBuilder, Transaction, type Extension } from '@codemirror/state';
import { type App, type EventRef } from 'obsidian';
import type { ImmersiveModeSettings, EditorTypewriterSettings } from '../types/settings';

export interface TypewriterExtensionPlugin {
	app?: App;
	settings: {
		immersive: Pick<ImmersiveModeSettings, 'typewriterEnabled' | 'typewriterCenterOffset' | 'typewriterUnfocusedOpacity'>;
		editorTypewriter?: Pick<EditorTypewriterSettings, 'enabled' | 'centerOffset' | 'unfocusedOpacity'>;
	};
}

const ALLOWED_USER_EVENTS = /^(select|input|delete|undo|redo)(\..+)?$/;
const POINTER_SELECTION = /^(select\.pointer)$/;

function isUserEventAllowed(event: string): boolean {
	return ALLOWED_USER_EVENTS.test(event) && !POINTER_SELECTION.test(event);
}

function hasAllowedUserEvent(update: ViewUpdate): boolean {
	const transactions = update.transactions;
	if (!transactions || transactions.length === 0) {
		const isSelectionChanged = Boolean(
			update.selectionSet && update.startState && !update.startState.selection.eq(update.state.selection)
		);
		return Boolean(update.docChanged || isSelectionChanged);
	}
	let hasUserEvent = false;
	let allUserEventsAllowed = true;
	for (const tr of transactions) {
		const userEvent: unknown = tr.annotation(Transaction.userEvent);
		if (typeof userEvent === 'string') {
			hasUserEvent = true;
			allUserEventsAllowed = allUserEventsAllowed && isUserEventAllowed(userEvent);
		}
	}
	// 与 Typewriter Mode 一致：真实 CodeMirror 事务没有 userEvent 注解时，
	// 视为插件、设置或布局产生的非用户更新，绝不恢复自动跟随。
	return hasUserEvent && allUserEventsAllowed;
}

/**
 * 打字机 CodeMirror 6 扩展（支持沉浸模式与普通编辑模式）
 * 功能：
 * 1. 光标行精准居中滚动（动态算入基于实际视口高度与偏移量的留白与标题高度，保持设定位置可达并稳定视口锚点）
 * 2. 焦点行高亮与非焦点行平滑淡化
 */
export function createTypewriterExtension(plugin: TypewriterExtensionPlugin): Extension {
	class TypewriterPlugin {
		decorations: DecorationSet;
		private isPointerDown = false;
		private isManualScrolling = false;
		private gestureScrolled = false;
		private pendingClickSelection = false;
		private hasInitialCentered = false;
		private rafId: number | null = null;
		private viewportRestoreRafId: number | null = null;
		private frozenScrollTop: number | null = null;
		private pendingPositioningRefresh = false;
		private positioningKey = '';
		private view: EditorView;
		private ownerDocument: Document;
		private ownerWindow: Window;
		private leafChangeEventRef: EventRef | null = null;

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
				view.scrollDOM.addEventListener('focusout', this.onFocusLoss);
				view.scrollDOM.addEventListener('focusin', this.onFocusIn);
			}
			this.ownerWindow.addEventListener('blur', this.onFocusLoss);
			this.ownerDocument.addEventListener('pointerup', this.onPointerUp);
			this.ownerDocument.addEventListener('mouseup', this.onPointerUp);
			this.ownerDocument.addEventListener('touchend', this.onPointerUp);
			this.ownerDocument.addEventListener('pointercancel', this.onPointerUp);
			this.ownerDocument.addEventListener('touchcancel', this.onPointerUp);

			if (plugin.app?.workspace) {
				this.leafChangeEventRef = plugin.app.workspace.on('active-leaf-change', (leaf) => {
					if (!this.isTypewriterActive()) return;
					const leafEl = this.view.dom?.closest?.('.workspace-leaf');
					if (leaf && leafEl && (leaf as unknown as { containerEl?: HTMLElement }).containerEl === leafEl) {
						this.releaseViewportFreeze();
						this.isManualScrolling = false;
						this.syncDomState();
						this.scheduleCenter(this.view);
					}
				});
			}
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

		private syncDomState(): { spacerChanged: boolean; positioningChanged: boolean } {
			if (!this.view.dom) return { spacerChanged: false, positioningChanged: false };
			const config = this.getActiveConfig();
			let spacerChanged = false;
			const centerOffset = Math.max(-30, Math.min(30, config.centerOffset));
			const nextPositioningKey = `${config.isActive}:${centerOffset}`;
			const positioningChanged = this.positioningKey !== '' && this.positioningKey !== nextPositioningKey;
			this.positioningKey = nextPositioningKey;

			const sizer = (this.view.scrollDOM?.querySelector<HTMLElement>('.cm-sizer') ?? this.view.dom?.querySelector<HTMLElement>('.cm-sizer')) ?? null;

			if (config.isActive) {
				if (!this.view.dom.classList.contains('wn-typewriter-active')) {
					this.view.dom.classList.add('wn-typewriter-active');
				}
				const currentOpacity = this.view.dom.style.getPropertyValue('--wn-typewriter-opacity');
				const targetOpacity = String(config.unfocusedOpacity);
				if (currentOpacity !== targetOpacity) {
					this.view.dom.style.setProperty('--wn-typewriter-opacity', targetOpacity);
				}

				const scroller = this.view.scrollDOM;
				const viewportHeight = scroller?.clientHeight ?? 0;
				if (viewportHeight > 0) {
					const targetCenterRatio = 0.5 + (centerOffset / 100);
					const topPadding = Math.round(viewportHeight * targetCenterRatio);
					const bottomPadding = Math.max(0, viewportHeight - topPadding);

					const currentTop = this.view.dom.style.getPropertyValue('--wn-typewriter-padding-top');
					const targetTop = `${topPadding}px`;
					if (currentTop !== targetTop) {
						this.view.dom.style.setProperty('--wn-typewriter-padding-top', targetTop);
						spacerChanged = true;
					}

					const currentBottom = this.view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom');
					const targetBottom = `${bottomPadding}px`;
					if (currentBottom !== targetBottom) {
						this.view.dom.style.setProperty('--wn-typewriter-padding-bottom', targetBottom);
						spacerChanged = true;
					}

					if (sizer) {
						if (sizer.style?.paddingTop !== targetTop) {
							if (typeof sizer.setCssStyles === 'function') {
								sizer.setCssStyles({ paddingTop: targetTop });
							} else if (typeof sizer.style?.setProperty === 'function') {
								sizer.style.setProperty('padding-top', targetTop);
							} else if (sizer.style) {
								Reflect.set(sizer.style, 'paddingTop', targetTop);
							}
							spacerChanged = true;
						}
						if (sizer.style?.paddingBottom !== targetBottom) {
							if (typeof sizer.setCssStyles === 'function') {
								sizer.setCssStyles({ paddingBottom: targetBottom });
							} else if (typeof sizer.style?.setProperty === 'function') {
								sizer.style.setProperty('padding-bottom', targetBottom);
							} else if (sizer.style) {
								Reflect.set(sizer.style, 'paddingBottom', targetBottom);
							}
							spacerChanged = true;
						}
					}
				}
			} else {
				if (this.view.dom.classList.contains('wn-typewriter-active')) {
					this.view.dom.classList.remove('wn-typewriter-active');
				}
				this.view.dom.style.removeProperty('--wn-typewriter-opacity');
				if (this.view.dom.style.getPropertyValue('--wn-typewriter-padding-top')) {
					this.view.dom.style.removeProperty('--wn-typewriter-padding-top');
					spacerChanged = true;
				}
				if (this.view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')) {
					this.view.dom.style.removeProperty('--wn-typewriter-padding-bottom');
					spacerChanged = true;
				}
				if (sizer) {
					if (sizer.style?.paddingTop) {
						if (typeof sizer.setCssStyles === 'function') {
							sizer.setCssStyles({ paddingTop: '' });
						}
						sizer.style.removeProperty('padding-top');
						Reflect.set(sizer.style, 'paddingTop', '');
						spacerChanged = true;
					}
					if (sizer.style?.paddingBottom) {
						if (typeof sizer.setCssStyles === 'function') {
							sizer.setCssStyles({ paddingBottom: '' });
						}
						sizer.style.removeProperty('padding-bottom');
						Reflect.set(sizer.style, 'paddingBottom', '');
						spacerChanged = true;
					}
				}
			}

			return { spacerChanged, positioningChanged };
		}

		private onWheel = (): void => {
			this.releaseViewportFreeze();
			this.isManualScrolling = true;
			this.gestureScrolled = true;
			this.cancelPendingCenter();
		};

		private onTouchStart = (): void => {
			this.releaseViewportFreeze();
			this.isPointerDown = true;
			this.gestureScrolled = false;
			this.pendingClickSelection = false;
			this.cancelPendingCenter();
		};

		private onTouchMove = (): void => {
			this.isManualScrolling = true;
			this.gestureScrolled = true;
			this.cancelPendingCenter();
		};

		private isHeaderOrMetadataElement = (el: Element | null): boolean => {
			if (!el) return false;
			return Boolean(el.closest?.('.inline-title, .metadata-container, .metadata-properties'));
		};

		private isScrollbarTarget(evt?: Event): boolean {
			if (!evt) return false;
			const scroller = this.view.scrollDOM;
			if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return false;
			const mouseEvt = evt as { clientX?: unknown; clientY?: unknown };
			if (typeof mouseEvt.clientX !== 'number' || typeof mouseEvt.clientY !== 'number') return false;
			const rect = scroller.getBoundingClientRect();
			// 确定右侧垂直滚动条的起始横坐标：优先依据真实 clientWidth，无内嵌滚动条时以右侧边缘区域判定
			const scrollbarLeftEdge = typeof scroller.clientWidth === 'number' && scroller.clientWidth > 0 && scroller.clientWidth < rect.width
				? rect.left + scroller.clientWidth - 2
				: rect.right - 16;
			const isRightScrollbar = mouseEvt.clientX >= scrollbarLeftEdge && mouseEvt.clientX <= rect.right + 5;
			const isWithinVertical = mouseEvt.clientY >= rect.top && mouseEvt.clientY <= rect.bottom;
			return isRightScrollbar && isWithinVertical;
		}

		private onPointerDown = (evt?: Event): void => {
			const target = (evt?.target ?? null) as HTMLElement | null;
			if (this.isHeaderOrMetadataElement(target)) {
				this.cancelPendingCenter();
				return;
			}
			// 检查是否点击或拖拽右侧原生滚动条
			if (this.isScrollbarTarget(evt)) {
				this.releaseViewportFreeze();
				this.isPointerDown = true;
				this.isManualScrolling = true;
				this.gestureScrolled = true;
				this.pendingClickSelection = false;
				this.cancelPendingCenter();
				return;
			}

			this.releaseViewportFreeze();
			this.isPointerDown = true;
			this.gestureScrolled = false;
			this.pendingClickSelection = false;
			this.cancelPendingCenter();
		};

		private onScroll = (): void => {
			if (this.frozenScrollTop !== null) {
				this.restoreFrozenViewport();
				return;
			}
			// 只有明确的滚轮 (wheel) 或触控滑动 (touchmove) 才属于用户手势滚动；
			// 指针按下或点击获得焦点时触发的轻微滚动不阻断居中调度
		};

		private onPointerUp = (): void => {
			const wasPointerDown = this.isPointerDown;
			this.isPointerDown = false;

			if (!wasPointerDown) return;

			if (this.gestureScrolled) {
				this.pendingClickSelection = false;
				return;
			}

			const activeEl = this.ownerDocument.activeElement;
			if (this.isHeaderOrMetadataElement(activeEl)) {
				this.pendingClickSelection = false;
				return;
			}

			if (this.view.state.selection.main.empty && this.isTypewriterActive()) {
				this.pendingClickSelection = false;
				this.releaseViewportFreeze();
				this.isManualScrolling = false;
				this.scheduleCenter(this.view);
			}
		};

		private onFocusLoss = (): void => {
			if (!this.isTypewriterActive() || !this.view.scrollDOM) return;
			if (this.frozenScrollTop === null) {
				this.frozenScrollTop = this.view.scrollDOM.scrollTop;
			}
			this.cancelPendingCenter();
			this.scheduleFrozenViewportRestore();
		};

		private onFocusIn = (evt?: FocusEvent): void => {
			if (!this.isTypewriterActive()) return;
			const target = (evt?.target ?? this.ownerDocument.activeElement) as HTMLElement | null;
			if (this.isHeaderOrMetadataElement(target)) {
				this.cancelPendingCenter();
				return;
			}
			this.pendingPositioningRefresh = false;
			this.releaseViewportFreeze();
			this.isManualScrolling = false;
			this.hasInitialCentered = true;
			this.syncDomState();
			this.scheduleCenter(this.view);
		};

		private restoreFrozenViewport(): void {
			if (this.frozenScrollTop === null || !this.view.scrollDOM) return;
			if (Math.abs(this.view.scrollDOM.scrollTop - this.frozenScrollTop) > 0.5) {
				this.view.scrollDOM.scrollTop = this.frozenScrollTop;
			}
		}

		private scheduleFrozenViewportRestore(): void {
			if (this.viewportRestoreRafId !== null) {
				this.ownerWindow.cancelAnimationFrame(this.viewportRestoreRafId);
			}
			this.viewportRestoreRafId = this.ownerWindow.requestAnimationFrame(() => {
				this.viewportRestoreRafId = null;
				this.restoreFrozenViewport();
			});
		}

		private releaseViewportFreeze(): void {
			this.frozenScrollTop = null;
			if (this.viewportRestoreRafId !== null) {
				this.ownerWindow.cancelAnimationFrame(this.viewportRestoreRafId);
				this.viewportRestoreRafId = null;
			}
		}

		private isModalOpen(): boolean {
			return Boolean(
				this.ownerDocument.body?.querySelector?.(
					'.modal-container, .modal.mod-settings, .vertical-tabs-container, .modal-bg'
				)
			);
		}

		private isEditorActiveAndFocused(view: EditorView): boolean {
			// Obsidian 1.13 可在独立窗口中打开设置。必须先检查所属窗口是否获焦
			if (this.ownerDocument.hasFocus?.() === false) {
				return false;
			}
			// 1. 模态弹窗（设置、搜索等）处于打开状态时，禁止任何打字机居中滚动
			if (this.isModalOpen()) {
				return false;
			}
			// 2. 焦点位于文档标题 (.inline-title) 或属性区 (.metadata-container) 时，禁止打字机正文定位
			const activeEl = this.ownerDocument.activeElement;
			if (this.isHeaderOrMetadataElement(activeEl)) {
				return false;
			}
			// 3. 检查编辑器正文是否真正获得焦点 (view.hasFocus 或焦点位于正文容器内)
			const hasDomFocus = Boolean(view.hasFocus || (activeEl && view.dom.contains(activeEl)));
			if (!hasDomFocus) {
				return false;
			}
			// 4. 所属 workspace-leaf 检查：如果属于某个叶子，且该叶子包含当前焦点或为 active
			const leafEl = view.dom?.closest?.('.workspace-leaf');
			if (leafEl) {
				const isModActive = Boolean(leafEl.classList?.contains?.('mod-active'));
				const leafContainsFocus = Boolean(activeEl && typeof leafEl.contains === 'function' && leafEl.contains(activeEl));
				if (!isModActive && !leafContainsFocus) {
					return false;
				}
			}
			return true;
		}

		private cancelPendingCenter(): void {
			if (this.rafId !== null) {
				this.ownerWindow.cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
		}

		private scheduleCenter(view: EditorView): void {
			this.cancelPendingCenter();
			this.rafId = this.ownerWindow.requestAnimationFrame(() => {
				this.rafId = null;
				this.centerCursorLine(view);
			});
		}

		destroy() {
			this.cancelPendingCenter();
			this.releaseViewportFreeze();
			if (this.leafChangeEventRef && plugin.app?.workspace) {
				plugin.app.workspace.offref(this.leafChangeEventRef);
				this.leafChangeEventRef = null;
			}
			// 与稳定的 Typewriter Mode 生命周期保持一致：销毁扩展实例时不重置
			// 布局留白。设置窗口和工作区焦点变化可能触发实例销毁，清除留白
			// 会让仍显示在后台的正文立即上跳。仅在功能明确关闭时由
			// syncDomState() 的 inactive 分支移除类名和内联变量。
			if (this.view.scrollDOM) {
				this.view.scrollDOM.removeEventListener('pointerdown', this.onPointerDown);
				this.view.scrollDOM.removeEventListener('mousedown', this.onPointerDown);
				this.view.scrollDOM.removeEventListener('wheel', this.onWheel);
				this.view.scrollDOM.removeEventListener('touchstart', this.onTouchStart);
				this.view.scrollDOM.removeEventListener('touchmove', this.onTouchMove);
				this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
				this.view.scrollDOM.removeEventListener('focusout', this.onFocusLoss);
				this.view.scrollDOM.removeEventListener('focusin', this.onFocusIn);
			}
			this.ownerWindow.removeEventListener('blur', this.onFocusLoss);
			this.ownerDocument.removeEventListener('pointerup', this.onPointerUp);
			this.ownerDocument.removeEventListener('mouseup', this.onPointerUp);
			this.ownerDocument.removeEventListener('touchend', this.onPointerUp);
			this.ownerDocument.removeEventListener('pointercancel', this.onPointerUp);
			this.ownerDocument.removeEventListener('touchcancel', this.onPointerUp);
		}

		update(update: ViewUpdate) {
			const { spacerChanged, positioningChanged } = this.syncDomState();
			if (positioningChanged) {
				this.pendingPositioningRefresh = true;
				this.releaseViewportFreeze();
			} else {
				this.restoreFrozenViewport();
			}
			this.decorations = this.buildDecorations(update.view);

			// 仅在当前模式下打字机功能开启时生效
			if (!this.isTypewriterActive()) {
				this.hasInitialCentered = false;
				this.pendingPositioningRefresh = false;
				this.cancelPendingCenter();
				this.releaseViewportFreeze();
				return;
			}

			// 如果当前指针/触摸手势仍处于按住状态，发生的选区变动记录为点击选区
			// 必须在 isEditorActiveAndFocused 检查之前执行：从其他面板（如沉浸章节列表、侧栏）点击回编辑区时，
			// 在 pointerdown 事务发生的瞬间，Obsidian 尚未完成将本叶子置为 mod-active 的状态切换。
			if (this.isPointerDown) {
				if (update.selectionSet && update.state.selection.main.empty) {
					this.pendingClickSelection = true;
				} else if (update.selectionSet && !update.state.selection.main.empty) {
					this.pendingClickSelection = false;
				}
				return;
			}

			// 如果编辑器不在活动面板（如切换到侧栏）、失去焦点或有模态弹窗打开，
			// 只取消尚未执行的定位，不在失焦过程中主动写入 scrollTop。
			if (!this.isEditorActiveAndFocused(update.view)) {
				this.cancelPendingCenter();
				return;
			}

			if (this.pendingPositioningRefresh) {
				this.pendingPositioningRefresh = false;
				this.isManualScrolling = false;
				this.hasInitialCentered = true;
				this.scheduleCenter(update.view);
				return;
			}

			// 借鉴 typewriter-mode：检查事务中是否有明确允许的用户交互事件（输入、删除、键盘光标导航）
			const isAllowedUserEvent = hasAllowedUserEvent(update);

			// 用户明确输入或移动光标时，结束手动滚动浏览状态，恢复打字机跟随
			if (isAllowedUserEvent) {
				this.releaseViewportFreeze();
				this.isManualScrolling = false;
			}

			// 如果用户正在手动滚动浏览，跳过自动居中
			if (this.isManualScrolling) {
				return;
			}

			// 如果处于文本选中状态（非单点光标），跳过自动居中以保障选中精准度
			if (!update.state.selection.main.empty) {
				return;
			}

			// 刚进入打字机模式时的初始化定位（仅限活动且获焦的叶子节点）
			if (!this.hasInitialCentered) {
				this.hasInitialCentered = true;
				this.scheduleCenter(update.view);
				return;
			}

			// 仅在明确的用户输入或键盘光标移动操作时，恢复跟随并触发居中滚动
			// 排除失焦、切换面板、打开设置等非用户输入事务
			if (isAllowedUserEvent) {
				this.scheduleCenter(update.view);
				return;
			}

			// 视口几何尺寸或留白变化（如分屏调整）：仅在处于获焦活动叶子中重定位视口锚点
			if (update.geometryChanged || spacerChanged) {
				this.scheduleCenter(update.view);
			}
		}

		private centerCursorLine(view: EditorView) {
			const config = this.getActiveConfig();
			if (!config.isActive) return;
			if (this.frozenScrollTop !== null) return;
			if (!this.isEditorActiveAndFocused(view)) return;
			if (this.isManualScrolling || this.isPointerDown || !view.state.selection.main.empty) return;

			const head = view.state.selection.main.head;
			const scroller = view.scrollDOM;
			if (!scroller || scroller.clientHeight === 0) return;

			this.syncDomState();

			const centerOffset = Math.max(-30, Math.min(30, config.centerOffset));
			const targetCenterPx = Math.round(scroller.clientHeight * (0.5 + (centerOffset / 100)));

			// 派发 CodeMirror 的 scrollIntoView effect，保证视口虚拟行与滚动锚点完全同步
			const effect = EditorView.scrollIntoView(head, {
				y: 'start',
				yMargin: targetCenterPx
			});
			view.dispatch({ effects: effect });
		}

		private buildDecorations(view: EditorView): DecorationSet {
			if (!this.isTypewriterActive() || !view.hasFocus) {
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
