import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTypewriterExtension, type TypewriterExtensionPlugin } from '../src/editor/TypewriterExtension';
import type { EditorView, ViewUpdate } from '@codemirror/view';

interface MockScrollerElement {
	scrollTop: number;
	clientHeight: number;
	ownerDocument: MockDocument;
	scrollTo: ReturnType<typeof vi.fn>;
	getBoundingClientRect: () => { top: number; bottom: number; left: number; right: number; width: number; height: number };
	addEventListener: (event: string, handler: (e?: unknown) => void, options?: unknown) => void;
	removeEventListener: (event: string, handler: (e?: unknown) => void) => void;
	dispatchEvent: (event: string, payload?: unknown) => void;
	listeners: Map<string, Array<(e?: unknown) => void>>;
}

interface MockDocument {
	body: {
		classList: {
			contains: ReturnType<typeof vi.fn>;
			add: (cls: string) => void;
			remove: (cls: string) => void;
		};
		querySelector?: ReturnType<typeof vi.fn>;
	};
	hasFocus: ReturnType<typeof vi.fn>;
	defaultView: MockWindow;
	addEventListener: (event: string, handler: (e?: unknown) => void) => void;
	removeEventListener: (event: string, handler: (e?: unknown) => void) => void;
	dispatchEvent: (event: string, payload?: unknown) => void;
	listeners: Map<string, Array<(e?: unknown) => void>>;
}

interface MockWindow {
	requestAnimationFrame: (cb: FrameRequestCallback) => number;
	cancelAnimationFrame: (id: number) => void;
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
	rafCallbacks: Map<number, FrameRequestCallback>;
	rafCounter: number;
	flushRaf: () => void;
	addEventListener: (event: string, handler: (e?: unknown) => void) => void;
	removeEventListener: (event: string, handler: (e?: unknown) => void) => void;
	dispatchEvent: (event: string, payload?: unknown) => void;
	listeners: Map<string, Array<(e?: unknown) => void>>;
}

function createMockEnvironment(initialOffset = 0) {
	const rafCallbacks = new Map<number, FrameRequestCallback>();
	const windowListeners = new Map<string, Array<(e?: unknown) => void>>();
	let rafCounter = 0;

	const mockWindow: MockWindow = {
		rafCallbacks,
		listeners: windowListeners,
		rafCounter,
		requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
			const id = ++rafCounter;
			rafCallbacks.set(id, cb);
			return id;
		}),
		cancelAnimationFrame: vi.fn((id: number) => {
			rafCallbacks.delete(id);
		}),
		setTimeout: vi.fn((cb: () => void, ms?: number) => globalThis.setTimeout(cb, ms)) as unknown as typeof setTimeout,
		clearTimeout: vi.fn((id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id)) as unknown as typeof clearTimeout,
		flushRaf: () => {
			const current = Array.from(rafCallbacks.entries());
			rafCallbacks.clear();
			for (const [, cb] of current) {
				cb(0);
			}
		},
		addEventListener: vi.fn((event: string, handler: (e?: unknown) => void) => {
			const list = windowListeners.get(event) ?? [];
			list.push(handler);
			windowListeners.set(event, list);
		}),
		removeEventListener: vi.fn((event: string, handler: (e?: unknown) => void) => {
			const list = windowListeners.get(event) ?? [];
			const idx = list.indexOf(handler);
			if (idx !== -1) list.splice(idx, 1);
		}),
		dispatchEvent: (event: string, payload?: unknown) => {
			const list = windowListeners.get(event) ?? [];
			for (const handler of list) handler(payload);
		}
	};

	const docListeners = new Map<string, Array<(e?: unknown) => void>>();
	const bodyClasses = new Set<string>(['immersive-mode-active']);

	const mockDocument: MockDocument = {
		body: {
			classList: {
				contains: vi.fn((cls: string) => bodyClasses.has(cls)),
				add: (cls: string) => bodyClasses.add(cls),
				remove: (cls: string) => bodyClasses.delete(cls)
			},
			querySelector: vi.fn((_sel: string) => null)
		},
		hasFocus: vi.fn(() => true),
		defaultView: mockWindow,
		listeners: docListeners,
		addEventListener: vi.fn((event: string, handler: (e?: unknown) => void) => {
			const list = docListeners.get(event) ?? [];
			list.push(handler);
			docListeners.set(event, list);
		}),
		removeEventListener: vi.fn((event: string, handler: (e?: unknown) => void) => {
			const list = docListeners.get(event) ?? [];
			const idx = list.indexOf(handler);
			if (idx !== -1) list.splice(idx, 1);
		}),
		dispatchEvent: (event: string, payload?: unknown) => {
			const list = docListeners.get(event) ?? [];
			for (const handler of list) handler(payload);
		}
	};

	const mockSizer = {
		style: {
			paddingTop: '',
			paddingBottom: '',
			removeProperty: vi.fn((prop: string) => {
				if (prop === 'padding-top') mockSizer.style.paddingTop = '';
				if (prop === 'padding-bottom') mockSizer.style.paddingBottom = '';
			})
		}
	};

	const scrollerListeners = new Map<string, Array<(e?: unknown) => void>>();
	const mockScroller: MockScrollerElement & { querySelector: (sel: string) => unknown } = {
		scrollTop: 500,
		clientHeight: 800,
		ownerDocument: mockDocument,
		querySelector: vi.fn((sel: string) => sel.includes('cm-sizer') ? mockSizer : null),
		scrollTo: vi.fn(({ top }: { top: number; behavior?: string }) => {
			mockScroller.scrollTop = top;
		}),
		getBoundingClientRect: () => ({ top: 0, bottom: 800, left: 0, right: 600, width: 600, height: 800 }),
		listeners: scrollerListeners,
		addEventListener: vi.fn((event: string, handler: (e?: unknown) => void) => {
			const list = scrollerListeners.get(event) ?? [];
			list.push(handler);
			scrollerListeners.set(event, list);
		}),
		removeEventListener: vi.fn((event: string, handler: (e?: unknown) => void) => {
			const list = scrollerListeners.get(event) ?? [];
			const idx = list.indexOf(handler);
			if (idx !== -1) list.splice(idx, 1);
		}),
		dispatchEvent: (event: string, payload?: unknown) => {
			const list = scrollerListeners.get(event) ?? [];
			for (const handler of list) handler(payload);
		}
	};

	const mockContentDOM = {
		getBoundingClientRect: () => ({ top: 100, bottom: 2000, left: 0, right: 600, width: 600, height: 1900 })
	};

	const mockPlugin: TypewriterExtensionPlugin = {
		settings: {
			immersive: {
				typewriterEnabled: true,
				typewriterCenterOffset: initialOffset,
				typewriterUnfocusedOpacity: 0.4
			},
			editorTypewriter: {
				enabled: false,
				centerOffset: 0,
				unfocusedOpacity: 0.4
			}
		}
	};

	const createMockView = (
		headPos = 100,
		isEmptySelection = true,
		coordsAtPosFn?: ((pos: number) => { top: number; bottom: number; left: number; right: number } | null) | null,
		lineBlockAtFn?: ((pos: number) => { top: number; height: number; bottom: number }) | null,
		hasFocus = true
	): EditorView => {
		const domClassList = new Set<string>();
		const domStyles = new Map<string, string>();
		const mockDom = {
			classList: {
				add: vi.fn((cls: string) => domClassList.add(cls)),
				remove: vi.fn((cls: string) => domClassList.delete(cls)),
				contains: vi.fn((cls: string) => domClassList.has(cls))
			},
			style: {
				setProperty: vi.fn((prop: string, val: string) => domStyles.set(prop, val)),
				removeProperty: vi.fn((prop: string) => domStyles.delete(prop)),
				getPropertyValue: vi.fn((prop: string) => domStyles.get(prop) ?? '')
			}
		};
		const coordsAtPos = coordsAtPosFn !== undefined ? (coordsAtPosFn ?? undefined) : undefined;
		const lineBlockAt = lineBlockAtFn ?? ((pos: number) => {
			const lineNum = Math.floor(pos / 50);
			return {
				top: lineNum * 30,
				height: 30,
				bottom: lineNum * 30 + 30
			};
		});
		const dispatch = vi.fn((spec: { effects?: { value?: { yMargin?: number; range?: { from?: number } } } }) => {
			const target = spec.effects?.value;
			if (typeof target?.yMargin !== 'number') return;
			const pos = target.range?.from ?? headPos;
			const coords = coordsAtPos?.(pos) ?? null;
			let caretCenterInScroller: number;
			if (coords && (coords.bottom > coords.top || coords.top > 0)) {
				caretCenterInScroller = ((coords.top + coords.bottom) / 2) + mockScroller.scrollTop;
			} else {
				const contentRect = mockContentDOM.getBoundingClientRect();
				if (contentRect.width === 0 && contentRect.height === 0) return;
				const lineBlock = lineBlockAt(pos);
				if (lineBlock.height <= 0) return;
				caretCenterInScroller = contentRect.top + mockScroller.scrollTop + lineBlock.top + (lineBlock.height / 2);
			}
			mockScroller.scrollTo({
				top: Math.max(0, caretCenterInScroller - target.yMargin),
				behavior: 'auto'
			});
		});

		return {
			hasFocus,
			dispatch,
			dom: mockDom as unknown as HTMLElement,
			scrollDOM: mockScroller as unknown as HTMLElement,
			contentDOM: mockContentDOM as unknown as HTMLElement,
			state: {
				doc: {
					lineAt: (pos: number) => ({
						from: Math.floor(pos / 50) * 50,
						to: Math.floor(pos / 50) * 50 + 49,
						number: Math.floor(pos / 50) + 1
					})
				},
				selection: {
					main: {
						head: headPos,
						empty: isEmptySelection
					},
					eq: (other: { main?: { head?: number; empty?: boolean } } | undefined | null) =>
						other?.main?.head === headPos && other?.main?.empty === isEmptySelection
				}
			},
			lineBlockAt,
			coordsAtPos,
			visibleRanges: [{ from: 0, to: 200 }]
		} as unknown as EditorView;
	};

	return {
		mockWindow,
		mockDocument,
		mockScroller,
		mockSizer,
		mockContentDOM,
		mockPlugin,
		createMockView
	};
}

describe('TypewriterExtension - Manual Scroll & Race Condition Prevention', () => {
	let env: ReturnType<typeof createMockEnvironment>;

	beforeEach(() => {
		vi.useFakeTimers();
		env = createMockEnvironment();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('cancels pending requestAnimationFrame when user initiates wheel/touch scroll', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500); // caret at bottom line
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center request queued
		const initialUpdate: ViewUpdate = {
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false
		} as unknown as ViewUpdate;
		pluginInstance.update(initialUpdate);

		expect(env.mockWindow.requestAnimationFrame).toHaveBeenCalled();
		expect(env.mockWindow.rafCallbacks.size).toBe(1);

		// User explicitly wheels up to review previous text before rAF executes
		env.mockScroller.dispatchEvent('wheel');

		// Pending rAF must be cancelled immediately
		expect(env.mockWindow.cancelAnimationFrame).toHaveBeenCalled();
		expect(env.mockWindow.rafCallbacks.size).toBe(0);

		// The focus change itself must not issue a corrective scroll.
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// Even if flush runs, scrollTo is not called because rAF was cancelled.
		env.mockWindow.flushRaf();
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('cancels pending requestAnimationFrame when user touches / pointer-scrolls', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		const editUpdate: ViewUpdate = {
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false
		} as unknown as ViewUpdate;
		pluginInstance.update(editUpdate);

		expect(env.mockWindow.rafCallbacks.size).toBe(1);

		// User starts touchmove scroll
		env.mockScroller.dispatchEvent('touchmove');

		expect(env.mockWindow.cancelAnimationFrame).toHaveBeenCalled();
		expect(env.mockWindow.rafCallbacks.size).toBe(0);

		pluginInstance.destroy();
	});

	it('uses immediate positioning so manual input never has an in-flight browser animation to cancel', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial centering completes in one operation.
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
		env.mockScroller.scrollTo.mockClear();

		// A later wheel gesture owns the viewport and causes no plugin scroll.
		env.mockScroller.scrollTop = 320;
		env.mockScroller.dispatchEvent('wheel');
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('suppresses centering during touch/drag gestures even if selectionSet fires while held, and preserves manual review through release', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial centering
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// 1. User touches screen to scroll
		env.mockScroller.dispatchEvent('touchstart');
		env.mockScroller.dispatchEvent('touchmove');
		env.mockScroller.scrollTo.mockClear();

		// 2. While finger is held, a selectionSet transaction occurs (e.g. touch hit-test)
		const gestureView = env.createMockView(100, true);
		const touchSelectionUpdate: ViewUpdate = {
			view: gestureView,
			state: gestureView.state,
			startState: view.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate;
		pluginInstance.update(touchSelectionUpdate);

		// Centering must not be queued while held
		expect(env.mockWindow.rafCallbacks.size).toBe(0);

		// 3. User releases finger (touchend / pointerup)
		env.mockDocument.dispatchEvent('touchend');
		env.mockDocument.dispatchEvent('pointerup');
		env.mockWindow.flushRaf();

		// Centering must remain suppressed on release
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// 4. Next deliberate post-release keyboard caret move resumes centering
		const navView = env.createMockView(120, true);
		pluginInstance.update({
			view: navView,
			state: navView.state,
			startState: gestureView.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('suppresses auto-centering while user is manually reviewing earlier text without new edits', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial centering
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User manually scrolls up
		env.mockScroller.dispatchEvent('wheel');
		env.mockScroller.scrollTo.mockClear();

		// CodeMirror fires a ViewUpdate due to scrolling/geometry without doc or selection change
		const scrollUpdate: ViewUpdate = {
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false
		} as unknown as ViewUpdate;
		pluginInstance.update(scrollUpdate);

		env.mockWindow.flushRaf();

		// Centering must NOT trigger and pull user back to bottom
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('does not resume centering on same-selection selectionSet after wheel, but resumes on genuine selection change', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial centering
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User manually scrolls with wheel
		env.mockScroller.dispatchEvent('wheel');
		env.mockScroller.scrollTo.mockClear();

		// 1. Transaction fires with selectionSet: true, but selection has NOT changed (same head = 500)
		const sameStateView = env.createMockView(500);
		const noChangeUpdate: ViewUpdate = {
			view: sameStateView,
			state: sameStateView.state,
			startState: view.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate;
		pluginInstance.update(noChangeUpdate);

		env.mockWindow.flushRaf();

		// Centering must remain suppressed for identical selection
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// 2. Genuine selection change occurs (caret moves from 500 to 100)
		const movedView = env.createMockView(100);
		const genuineChangeUpdate: ViewUpdate = {
			view: movedView,
			state: movedView.state,
			startState: sameStateView.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate;
		pluginInstance.update(genuineChangeUpdate);

		env.mockWindow.flushRaf();

		// Centering must resume for genuine selection change
		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('resumes typewriter centering on deliberate doc change (typing/newline)', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User scrolls up manually
		env.mockScroller.dispatchEvent('wheel');
		env.mockScroller.scrollTo.mockClear();

		// Next deliberate typing action
		const nextView = env.createMockView(550);
		const typingUpdate: ViewUpdate = {
			view: nextView,
			state: nextView.state,
			docChanged: true,
			selectionSet: false
		} as unknown as ViewUpdate;
		pluginInstance.update(typingUpdate);

		env.mockWindow.flushRaf();

		// Should resume centering for the new edit
		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('resumes typewriter centering on deliberate caret navigation', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User scrolls up manually
		env.mockScroller.dispatchEvent('wheel');
		env.mockScroller.scrollTo.mockClear();

		// User clicks or presses arrow keys to move caret
		const movedView = env.createMockView(100);
		const navUpdate: ViewUpdate = {
			view: movedView,
			state: movedView.state,
			startState: view.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate;
		pluginInstance.update(navUpdate);

		env.mockWindow.flushRaf();

		// Should center the new caret position
		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('centers caret position upon mouseup after single-caret click navigation', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User clicks at line 100 (pos 100)
		env.mockScroller.dispatchEvent('mousedown');
		env.mockScroller.scrollTo.mockClear();

		const clickedView = env.createMockView(100, true);
		pluginInstance.update({
			view: clickedView,
			state: clickedView.state,
			startState: view.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate);

		// While mouse is down, centering is not executed
		env.mockWindow.flushRaf();
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// Mouse released
		env.mockDocument.dispatchEvent('mouseup');
		env.mockWindow.flushRaf();

		// Should center the clicked position
		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('preserves selection dragging protection when mouse is down or selection is non-empty', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, false); // non-empty selection
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial update with non-empty selection
		pluginInstance.update({ view, state: view.state, startState: view.state, docChanged: false, selectionSet: true } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// Mousedown drag state
		env.mockScroller.dispatchEvent('mousedown');
		env.mockScroller.scrollTo.mockClear();

		const emptyView = env.createMockView(200, true);
		pluginInstance.update({ view: emptyView, state: emptyView.state, startState: view.state, docChanged: true, selectionSet: true } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('disables centering when immersive mode is inactive or typewriter is disabled', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Turn off immersive mode
		env.mockDocument.body.classList.remove('immersive-mode-active');

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// Turn on immersive mode but disable typewriter setting
		env.mockDocument.body.classList.add('immersive-mode-active');
		env.mockPlugin.settings.immersive.typewriterEnabled = false;

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('properly cleans up event listeners and animation frames on destroy', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Queue an update
		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		expect(env.mockWindow.rafCallbacks.size).toBe(1);

		pluginInstance.destroy();

		// Pending centering is cancelled without scheduling layout cleanup.
		expect(env.mockWindow.cancelAnimationFrame).toHaveBeenCalled();
		expect(env.mockWindow.rafCallbacks.size).toBe(0);

		// Listeners removed
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('touchend', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('touchcancel', expect.any(Function));
	});
});
describe('TypewriterExtension - Visual Line Centering & Wrapped Paragraphs', () => {
	let env: ReturnType<typeof createMockEnvironment>;

	beforeEach(() => {
		vi.useFakeTimers();
		env = createMockEnvironment();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('centers the caret visual row via coordsAtPos for a tall wrapped logical paragraph instead of logical block midpoint', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		// Simulate a tall wrapped paragraph: line block height is 600px, top is 100px
		// Logical block midpoint would be 100 + 300 = 400 in contentDOM, so in scroller (top=100) it would be 500px -> desiredScrollTop = 100px
		const customLineBlock = () => ({
			top: 100,
			height: 600,
			bottom: 700
		});
		// Caret is at head 500 (near the end of paragraph), visual screen coords: top 680, bottom 700 (center 690)
		// Scroller rect top is 0, clientHeight is 800, scrollTop starts at 0 -> targetCenterPx = 400
		// Caret visual center in scroller: (690 - 0) + 0 = 690 -> desiredScrollTop = 690 - 400 = 290px
		env.mockScroller.scrollTop = 0;
		const customCoords = () => ({
			top: 680,
			bottom: 700,
			left: 20,
			right: 25
		});

		const view = env.createMockView(500, true, customCoords, customLineBlock);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		// Should scroll to visual row center (290), NOT logical block midpoint (100)
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 290,
			behavior: 'auto'
		});
		const dispatched = (view.dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
			effects?: { value?: { y?: string; yMargin?: number } };
		};
		expect(dispatched.effects?.value).toMatchObject({ y: 'start', yMargin: 400 });
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ top: 100 }));

		pluginInstance.destroy();
	});

	it('falls back to lineBlockAt coordinate calculation when coordsAtPos returns null', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 0;

		const customLineBlock = () => ({
			top: 600,
			height: 60,
			bottom: 660
		});
		// coordsAtPos returns null (e.g. unmeasured/offscreen)
		const customCoords = () => null;

		const view = env.createMockView(500, true, customCoords, customLineBlock);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// contentTopInScroller = (100 - 0) + 0 = 100
		// lineCenterInScroller = 100 + 600 + 30 = 730
		// targetCenterPx = 400
		// desiredScrollTop = 730 - 400 = 330
		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 330,
			behavior: 'auto'
		});

		pluginInstance.destroy();
	});

	it('respects typewriterCenterOffset when centering using coordsAtPos', () => {
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -10; // 40% target = 320px
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 0;

		const customCoords = () => ({
			top: 680,
			bottom: 700,
			left: 20,
			right: 25
		});

		const view = env.createMockView(500, true, customCoords);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Caret visual center: 690
		// targetCenterPx = 800 * (0.5 - 0.1) = 320
		// desiredScrollTop = 690 - 320 = 370
		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 370,
			behavior: 'auto'
		});

		pluginInstance.destroy();
	});
});

describe('TypewriterExtension - Ordinary Editor Mode & Mode Isolation', () => {
	let env: ReturnType<typeof createMockEnvironment>;

	beforeEach(() => {
		vi.useFakeTimers();
		env = createMockEnvironment();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('activates typewriter centering, DOM classes, and CSS variables in ordinary mode when enabled', () => {
		env.mockDocument.body.classList.remove('immersive-mode-active');
		env.mockPlugin.settings.editorTypewriter = {
			enabled: true,
			centerOffset: 0,
			unfocusedOpacity: 0.5
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void; decorations: unknown } }).create(view);

		expect(view.dom.classList.add).toHaveBeenCalledWith('wn-typewriter-active');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-opacity', '0.5');

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('remains completely inactive in ordinary mode when disabled (default for existing and upgraded users)', () => {
		env.mockDocument.body.classList.remove('immersive-mode-active');
		env.mockPlugin.settings.editorTypewriter = {
			enabled: false,
			centerOffset: 0,
			unfocusedOpacity: 0.4
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(false);

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('strictly isolates modes: ordinary mode does not leak into immersive mode when immersive typewriter is disabled', () => {
		// Document body has immersive-mode-active
		env.mockDocument.body.classList.add('immersive-mode-active');
		// Immersive typewriter is disabled
		env.mockPlugin.settings.immersive.typewriterEnabled = false;
		// Ordinary typewriter is enabled
		env.mockPlugin.settings.editorTypewriter = {
			enabled: true,
			centerOffset: 10,
			unfocusedOpacity: 0.8
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		// Ordinary typewriter must NOT center or activate inside immersive mode
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(false);

		pluginInstance.destroy();
	});

	it('strictly isolates modes: uses immersive settings when in immersive mode even if ordinary mode is disabled', () => {
		env.mockDocument.body.classList.add('immersive-mode-active');
		env.mockPlugin.settings.immersive.typewriterEnabled = true;
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -10;
		env.mockPlugin.settings.immersive.typewriterUnfocusedOpacity = 0.25;
		env.mockPlugin.settings.editorTypewriter = {
			enabled: false,
			centerOffset: 25,
			unfocusedOpacity: 0.9
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-opacity', '0.25');
		// Initial scrollTop = 500, lineCenter = 915, offset -10% => targetCenterPx = 320 => desiredScrollTop 595
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({
			top: 595,
			behavior: 'auto'
		}));

		pluginInstance.destroy();
	});

	it('allows ordinary mode to resume with ordinary settings after exiting immersive mode', () => {
		// Step 1: In immersive mode with immersive typewriter disabled, ordinary enabled
		env.mockDocument.body.classList.add('immersive-mode-active');
		env.mockPlugin.settings.immersive.typewriterEnabled = false;
		env.mockPlugin.settings.editorTypewriter = {
			enabled: true,
			centerOffset: 10,
			unfocusedOpacity: 0.6
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// Step 2: Exit immersive mode
		env.mockDocument.body.classList.remove('immersive-mode-active');

		// Step 3: Editor updates after exit
		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		// Ordinary mode resumes
		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-opacity', '0.6');
		// Initial scrollTop = 500, lineCenter = 915, offset +10% => targetCenterPx = 480 => desiredScrollTop 435
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({
			top: 435,
			behavior: 'auto'
		}));

		pluginInstance.destroy();
	});

	it('preserves layout classes and styles when an enabled ordinary-mode instance is destroyed', () => {
		env.mockDocument.body.classList.remove('immersive-mode-active');
		env.mockPlugin.settings.editorTypewriter = {
			enabled: true,
			centerOffset: 0,
			unfocusedOpacity: 0.4
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);

		pluginInstance.destroy();

		expect(view.dom.classList.remove).not.toHaveBeenCalledWith('wn-typewriter-active');
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-opacity');
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-padding-top');
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-padding-bottom');
		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
	});

	it('handles missing or undefined editorTypewriter settings without throwing', () => {
		env.mockDocument.body.classList.remove('immersive-mode-active');
		delete env.mockPlugin.settings.editorTypewriter;

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		expect(() => {
			pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
			env.mockWindow.flushRaf();
		}).not.toThrow();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(false);

		pluginInstance.destroy();
	});
});

describe('TypewriterExtension - Dynamic Viewport Spacers & Geometry Stability', () => {
	let env: ReturnType<typeof createMockEnvironment>;

	beforeEach(() => {
		vi.useFakeTimers();
		env = createMockEnvironment();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('calculates dynamic top/bottom spacer values from actual 800px scroller height for positive and negative offsets', () => {
		expect(env.mockScroller.clientHeight).toBe(800);

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Neutral offset (0%): 50% / 50% => 400px / 400px
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '400px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');

		// Positive offset (+20%): target ratio 0.70 => 800 * 0.7 = 560px top, 240px bottom
		env.mockPlugin.settings.immersive.typewriterCenterOffset = 20;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '560px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '240px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('560px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('240px');

		// Positive offset maximum (+30%): target ratio 0.80 => 800 * 0.8 = 640px top, 160px bottom
		env.mockPlugin.settings.immersive.typewriterCenterOffset = 30;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '640px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '160px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('640px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('160px');

		// Negative offset (-20%): target ratio 0.30 => 800 * 0.3 = 240px top, 560px bottom
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -20;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '240px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '560px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('240px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('560px');

		// Negative offset maximum (-30%): target ratio 0.20 => 800 * 0.2 = 160px top, 640px bottom
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -30;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '160px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '640px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('160px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('640px');

		// Clamps out-of-range positive offset (> 30%) to 30%
		env.mockPlugin.settings.immersive.typewriterCenterOffset = 50;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('640px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('160px');

		// Clamps out-of-range negative offset (< -30%) to -30%
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -50;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('160px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('640px');

		pluginInstance.destroy();
	});

	it('cleans up spacer CSS variables and state when typewriter becomes inactive', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-opacity')).toBe('0.4');

		// Disable typewriter setting
		env.mockPlugin.settings.immersive.typewriterEnabled = false;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(false);
		expect(view.dom.style.removeProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top');
		expect(view.dom.style.removeProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom');
		expect(view.dom.style.removeProperty).toHaveBeenCalledWith('--wn-typewriter-opacity');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-opacity')).toBe('');

		pluginInstance.destroy();
	});

	it('preserves spacer CSS variables but removes DOM listeners when an enabled instance is destroyed', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');

		pluginInstance.destroy();

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-padding-top');
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-padding-bottom');
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-opacity');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-opacity')).toBe('0.4');

		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function));
		expect(env.mockScroller.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
		expect(env.mockDocument.removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
		expect(env.mockWindow.removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
	});

	it('recenters visual anchor and updates spacers when geometryChanged occurs without doc or selection edits', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// Simulate pane resize / split: clientHeight shrinks from 800 to 600
		env.mockScroller.clientHeight = 600;

		// CodeMirror dispatches update with geometryChanged: true, but NO doc or selection changes
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		// Spacer variables are updated to reflect the new 600px viewport (50% = 300px)
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '300px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '300px');

		// Flush rAF to execute recentering
		env.mockWindow.flushRaf();

		// Visual anchor is preserved by recentering to the new geometry
		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('preserves manual scroll ownership during geometry changes without pulling user back to caret', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User manually scrolls via wheel
		env.mockScroller.dispatchEvent('wheel');
		env.mockScroller.scrollTo.mockClear();

		// Geometry change occurs while user is reviewing earlier content
		env.mockScroller.clientHeight = 700;
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		env.mockWindow.flushRaf();

		// Must NOT auto-center or pull user back
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('does not recenter on geometryChanged when non-empty text selection guard is active', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		// User selects a range of text (non-empty selection)
		const selectionView = env.createMockView(500, false);
		env.mockScroller.clientHeight = 700;

		pluginInstance.update({
			view: selectionView,
			state: selectionView.state,
			startState: view.state,
			docChanged: false,
			selectionSet: true,
			geometryChanged: true
		} as unknown as ViewUpdate);

		env.mockWindow.flushRaf();

		// Selection guard blocks recentering
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('realigns the target immediately when geometry changes', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Start immediate centering
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
		env.mockScroller.scrollTo.mockClear();

		// The viewport geometry changes (e.g. entering immersive mode / opening panel)
		env.mockScroller.clientHeight = 1000;
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		// Flush rAF to process recenter in new viewport
		env.mockWindow.flushRaf();

		// The new geometry recenter executes immediately without stale animation state
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('allows positive offset (+30%) to center caret at document start without top constraint clamping', () => {
		env.mockPlugin.settings.immersive.typewriterCenterOffset = 30; // 80% target = 640px
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 0;

		// First line at document start: visual screen coords top 640, bottom 660 (midpoint 650)
		const customCoords = () => ({
			top: 640,
			bottom: 660,
			left: 20,
			right: 25
		});

		const view = env.createMockView(0, true, customCoords);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Top padding is 640px, caretCenterInScroller = 650, targetCenterPx = 640 => desiredScrollTop = 10px >= 0
		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 10,
			behavior: 'auto'
		});

		pluginInstance.destroy();
	});

	it('allows negative offset (-30%) to center caret at document end without bottom constraint clamping', () => {
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -30; // 20% target = 160px
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 0;

		// Last line at document end: visual screen coords top 1980, bottom 2000 (midpoint 1990)
		const customCoords = () => ({
			top: 1980,
			bottom: 2000,
			left: 20,
			right: 25
		});

		const view = env.createMockView(500, true, customCoords);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Top padding is 160px, caretCenterInScroller = 1990, targetCenterPx = 160 => desiredScrollTop = 1830px
		pluginInstance.update({ view, state: view.state, docChanged: true, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 1830,
			behavior: 'auto'
		});

		pluginInstance.destroy();
	});
});

describe('TypewriterExtension - Focus Loss & Offscreen Coordinate Guards', () => {
	let env: ReturnType<typeof createMockEnvironment>;

	beforeEach(() => {
		vi.useFakeTimers();
		env = createMockEnvironment();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does NOT trigger auto-center when editor is unfocused (e.g. settings opened or panel clicked)', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		const view = env.createMockView(100, true, undefined, undefined, false); // hasFocus = false
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Trigger geometryChanged or docChanged while unfocused
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		// Flush rAF
		env.mockWindow.flushRaf();

		// Should NOT have called scrollTo at all, keeping editor at scrollTop = 500
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(env.mockScroller.scrollTop).toBe(500);

		pluginInstance.destroy();
	});

	it('aborts centerCursorLine if editor loses focus before rAF executes', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		const view = env.createMockView(100, true, undefined, undefined, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Trigger docChanged while focused
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false
		} as unknown as ViewUpdate);

		// Focus lost right before rAF fires (e.g. user pressed Ctrl+, or clicked modal)
		(view as { hasFocus: boolean }).hasFocus = false;
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('does not center when the editor window loses OS focus even if CodeMirror still reports focus', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false,
			transactions: [{ annotation: () => 'input.type' }]
		} as unknown as ViewUpdate);

		env.mockDocument.hasFocus.mockReturnValue(false);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('does not center for a CodeMirror transaction without a userEvent annotation', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		vi.advanceTimersByTime(150);
		env.mockScroller.scrollTo.mockClear();

		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false,
			transactions: [{ annotation: () => undefined }]
		} as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('ignores bogus zero coords ({ top: 0, bottom: 0 }) and falls back to lineBlockAt', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		// coordsAtPos returns bogus all-zero rect
		const bogusCoords = () => ({
			top: 0,
			bottom: 0,
			left: 0,
			right: 0
		});

		// lineBlockAt returns valid logical line block for line at headPos 100
		const lineBlockAt = () => ({
			top: 600,
			height: 30,
			bottom: 630
		});

		const view = env.createMockView(100, true, bogusCoords, lineBlockAt, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false
		} as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		// Should NOT scroll to 0 (which would center title).
		// Instead, should use lineBlock:
		// contentRect.top = 100, scrollerRect.top = 0, scrollTop = 500 -> contentTopInScroller = 600
		// caretCenterInScroller = 600 + 600 + 15 = 1215
		// targetCenterPx = 400
		// desiredScrollTop = 1215 - 400 = 815
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 815,
			behavior: 'auto'
		});

		pluginInstance.destroy();
	});

	it('safely skips scrolling if contentDOM has zero width/height in fallback path', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		// Mock contentDOM with 0 width and height (unrendered / hidden)
		env.mockContentDOM.getBoundingClientRect = () => ({
			top: 0,
			bottom: 0,
			left: 0,
			right: 0,
			width: 0,
			height: 0
		});

		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false
		} as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		// Should safely return without scrolling
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('blocks a queued auto-center when the editor loses focus without issuing a blur scroll', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Trigger doc change to queue centering
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false
		} as unknown as ViewUpdate);

		// Editor loses focus before the queued frame executes.
		(view as { hasFocus: boolean }).hasFocus = false;

		// Flush rAF; the focus gate rejects the queued center without another scroll.
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(env.mockScroller.scrollTop).toBe(500);

		pluginInstance.destroy();
	});

	it('blocks auto-centering and freezes spacers when a modal is open in the document (e.g. settings modal)', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		// Mock open modal in DOM
		env.mockDocument.body.querySelector = vi.fn((selector: string) => {
			if (selector.includes('.modal-container')) {
				return {} as unknown as Element;
			}
			return null;
		});

		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Trigger update with geometry change while modal is open
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: true,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		env.mockWindow.flushRaf();

		// Should NOT auto-center or scroll editor behind the modal
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(env.mockScroller.scrollTop).toBe(500);

		pluginInstance.destroy();
	});

	it('keeps spacer layout synchronized while unfocused without auto-centering', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.clientHeight = 800;

		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initialize spacers (padding-top: 400px)
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '400px');
		(view.dom.style.setProperty as ReturnType<typeof vi.fn>).mockClear();

		// Editor loses focus
		(view as { hasFocus: boolean }).hasFocus = false;
		// clientHeight changes (e.g. sidebar panel clicked or opened)
		env.mockScroller.clientHeight = 600;

		pluginInstance.update({
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		// Layout remains fully initialized even while focus belongs to another panel.
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-top', '300px');
		expect(view.dom.style.setProperty).toHaveBeenCalledWith('--wn-typewriter-padding-bottom', '300px');
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('applies a changed center offset as soon as the editor regains focus', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		(view.dispatch as ReturnType<typeof vi.fn>).mockClear();

		env.mockScroller.dispatchEvent('focusout');
		(view as { hasFocus: boolean }).hasFocus = false;
		env.mockPlugin.settings.immersive.typewriterCenterOffset = 20;
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(view.dispatch).not.toHaveBeenCalled();
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('560px');

		(view as { hasFocus: boolean }).hasFocus = true;
		env.mockScroller.dispatchEvent('focusin');
		env.mockWindow.flushRaf();

		expect(view.dispatch).toHaveBeenCalledTimes(1);
		expect(view.dispatch).toHaveBeenCalledWith({
			effects: expect.objectContaining({
				value: expect.objectContaining({ yMargin: 560 })
			})
		});

		pluginInstance.destroy();
	});

	it('applies the configured offset on the first focus after an unfocused immersive layout rebuild', () => {
		env.mockPlugin.settings.immersive.typewriterCenterOffset = -20;
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, true, null, null, false);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { destroy: () => void } }).create(view);

		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('240px');
		expect(view.dispatch).not.toHaveBeenCalled();

		(view as { hasFocus: boolean }).hasFocus = true;
		env.mockScroller.dispatchEvent('focusin');
		env.mockWindow.flushRaf();

		expect(view.dispatch).toHaveBeenCalledTimes(1);
		expect(view.dispatch).toHaveBeenCalledWith({
			effects: expect.objectContaining({
				value: expect.objectContaining({ yMargin: 240 })
			})
		});

		pluginInstance.destroy();
	});

	it('blocks auto-centering when editor workspace-leaf is not mod-active (e.g. sidebar panel clicked)', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		const view = env.createMockView(100, true, null, null, true);
		// Simulate editor DOM having a workspace-leaf parent that does NOT have .mod-active
		(view.dom as { closest: (sel: string) => unknown }).closest = vi.fn((selector: string) => {
			if (selector === '.workspace-leaf') {
				return {
					classList: {
						contains: (cls: string) => cls === 'mod-active' ? false : true
					}
				};
			}
			return null;
		});

		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Trigger update with geometry change while leaf is not active
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: false,
			selectionSet: false,
			geometryChanged: true
		} as unknown as ViewUpdate);

		env.mockWindow.flushRaf();

		// Should NOT auto-center or scroll editor in inactive leaf
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(env.mockScroller.scrollTop).toBe(500);

		pluginInstance.destroy();
	});

	it('blocks auto-centering when transaction userEvent is pointer selection (select.pointer)', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;

		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		env.mockScroller.scrollTo.mockClear();

		// Mouse selection drag (userEvent === 'select.pointer')
		pluginInstance.update({
			view,
			state: view.state,
			docChanged: false,
			selectionSet: true,
			transactions: [
				{
					annotation: () => 'select.pointer'
				}
			]
		} as unknown as ViewUpdate);

		env.mockWindow.flushRaf();

		// Should NOT auto-center on pointer selection
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		pluginInstance.destroy();
	});

	it('preserves existing spacers when the extension is rebuilt while a settings modal owns focus', () => {
		env.mockDocument.body.classList.remove('immersive-mode-active');
		env.mockPlugin.settings.editorTypewriter = {
			enabled: true,
			centerOffset: 0,
			unfocusedOpacity: 0.4
		};

		const extension = createTypewriterExtension(env.mockPlugin);
		env.mockScroller.scrollTop = 500;
		const view = env.createMockView(500, true, null, null, true);
		const create = (extension as unknown as { create: (v: EditorView) => { destroy: () => void } }).create;
		const firstInstance = create(view);

		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');

		// Opening settings moves focus away; if Obsidian replaces the extension instance,
		// the same editor DOM must retain its existing layout state.
		env.mockDocument.body.querySelector = vi.fn((selector: string) =>
			selector.includes('.modal-container') ? ({} as Element) : null
		);
		(view.dom.style.setProperty as ReturnType<typeof vi.fn>).mockClear();
		(view.dom.style.removeProperty as ReturnType<typeof vi.fn>).mockClear();
		env.mockScroller.scrollTo.mockClear();

		firstInstance.destroy();
		const replacementInstance = create(view);
		env.mockWindow.flushRaf();

		// The replacement neither removes nor reapplies layout-affecting padding,
		// so the background editor keeps its exact visual anchor.
		expect(view.dom.style.removeProperty).not.toHaveBeenCalledWith('--wn-typewriter-padding-top');
		expect(view.dom.style.setProperty).not.toHaveBeenCalledWith('--wn-typewriter-padding-top', expect.any(String));
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');
		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(env.mockScroller.scrollTop).toBe(500);

		replacementInstance.destroy();
		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
	});

	it('initializes layout on a fresh editor DOM while settings owns focus without scrolling it', () => {
		env.mockDocument.body.classList.remove('immersive-mode-active');
		env.mockPlugin.settings.editorTypewriter = {
			enabled: true,
			centerOffset: 0,
			unfocusedOpacity: 0.4
		};
		env.mockDocument.hasFocus.mockReturnValue(false);
		env.mockScroller.scrollTop = 500;

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, true, null, null, false);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { destroy: () => void } }).create(view);

		expect(view.dom.classList.contains('wn-typewriter-active')).toBe(true);
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-top')).toBe('400px');
		expect(view.dom.style.getPropertyValue('--wn-typewriter-padding-bottom')).toBe('400px');
		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();
		expect(env.mockScroller.scrollTop).toBe(500);

		pluginInstance.destroy();
	});

	it('restores the exact pre-focusout scrollTop when CodeMirror remeasurement moves the viewport', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { destroy: () => void } }).create(view);

		env.mockScroller.scrollTop = 500;
		env.mockScroller.dispatchEvent('focusout');

		// Simulate a delayed CodeMirror/browser anchor adjustment after focus leaves.
		env.mockScroller.scrollTop = 320;
		env.mockScroller.dispatchEvent('scroll');

		expect(env.mockScroller.scrollTop).toBe(500);

		pluginInstance.destroy();
	});

	it('restores the exact pre-blur scrollTop on the next frame and releases it on editor interaction', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { destroy: () => void } }).create(view);

		env.mockScroller.scrollTop = 500;
		env.mockWindow.dispatchEvent('blur');
		env.mockScroller.scrollTop = 680;
		env.mockWindow.flushRaf();
		expect(env.mockScroller.scrollTop).toBe(500);

		// Clicking back into the editor deliberately hands viewport ownership to the user.
		env.mockScroller.dispatchEvent('pointerdown');
		env.mockScroller.scrollTop = 620;
		env.mockScroller.dispatchEvent('scroll');
		expect(env.mockScroller.scrollTop).toBe(620);

		pluginInstance.destroy();
	});

	it('does not produce line dimming decorations when editor loses focus', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const focusedView = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; decorations: { size: number }; destroy: () => void } }).create(focusedView);

		expect(pluginInstance.decorations.size).toBeGreaterThan(0);

		const unfocusedView = env.createMockView(100, true, null, null, false);
		pluginInstance.update({
			view: unfocusedView,
			state: unfocusedView.state,
			docChanged: false,
			selectionSet: false
		} as unknown as ViewUpdate);

		expect(pluginInstance.decorations.size).toBe(0);

		pluginInstance.destroy();
	});

	it('schedules centering and releases freeze immediately upon refocus (focusin) without typing', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(100, true, null, null, true);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Consume initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		env.mockScroller.scrollTo.mockClear();

		// Lose focus
		env.mockScroller.scrollTop = 500;
		env.mockScroller.dispatchEvent('focusout');

		// Refocus without typing
		env.mockScroller.dispatchEvent('focusin');
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('captures click selection and centers on pointerup even when leaf activation was in flight during pointerdown', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(100, true, null, null, true);
		const leafClasses = new Set<string>();
		const mockLeafEl = {
			classList: {
				contains: vi.fn((cls: string) => leafClasses.has(cls)),
				add: (cls: string) => leafClasses.add(cls)
			}
		};
		(view.dom as unknown as { closest: (sel: string) => unknown }).closest = vi.fn((sel: string) =>
			sel === '.workspace-leaf' ? mockLeafEl : null
		);

		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center
		leafClasses.add('mod-active');
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		env.mockScroller.scrollTo.mockClear();

		// User switched to another panel (leaf loses mod-active)
		leafClasses.delete('mod-active');
		env.mockScroller.dispatchEvent('focusout');

		// User clicks back: pointerdown occurs before Obsidian adds mod-active
		env.mockScroller.dispatchEvent('pointerdown');
		const clickUpdateView = env.createMockView(150, true, null, null, true);
		(clickUpdateView.dom as unknown as { closest: (sel: string) => unknown }).closest = vi.fn((sel: string) =>
			sel === '.workspace-leaf' ? mockLeafEl : null
		);

		pluginInstance.update({
			view: clickUpdateView,
			state: clickUpdateView.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate);

		// Obsidian marks leaf mod-active before pointerup completes
		leafClasses.add('mod-active');
		env.mockDocument.dispatchEvent('pointerup');
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
	});

	it('schedules centering when active-leaf-change fires for this editor leaf', () => {
		const workspaceListeners = new Map<string, Array<(leaf: unknown) => void>>();
		const mockApp = {
			workspace: {
				on: vi.fn((event: string, handler: (leaf: unknown) => void) => {
					const list = workspaceListeners.get(event) ?? [];
					list.push(handler);
					workspaceListeners.set(event, list);
					return { event, handler };
				}),
				offref: vi.fn((ref: { event: string; handler: (leaf: unknown) => void }) => {
					const list = workspaceListeners.get(ref.event) ?? [];
					const idx = list.indexOf(ref.handler);
					if (idx !== -1) list.splice(idx, 1);
				}),
				getActiveViewOfType: vi.fn(() => ({}))
			}
		};
		env.mockPlugin.app = mockApp as unknown as typeof env.mockPlugin.app;

		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(100, true, null, null, true);
		const mockLeafContainer = {
			classList: {
				contains: vi.fn((cls: string) => cls === 'mod-active')
			}
		};
		(view.dom as unknown as { closest: (sel: string) => unknown }).closest = vi.fn((sel: string) =>
			sel === '.workspace-leaf' ? mockLeafContainer : null
		);

		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial center
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();
		env.mockScroller.scrollTo.mockClear();

		// Trigger active-leaf-change for this leaf
		const handlers = workspaceListeners.get('active-leaf-change') ?? [];
		for (const handler of handlers) {
			handler({ containerEl: mockLeafContainer });
		}
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

		pluginInstance.destroy();
		expect(mockApp.workspace.offref).toHaveBeenCalled();
	});

	describe('TypewriterExtension - Opening Lines & Sizer Padding Resilience', () => {
		it('applies direct inline paddingTop and paddingBottom to .cm-sizer and cleans them up on disable', () => {
			const extension = createTypewriterExtension(env.mockPlugin);
			const view = env.createMockView(0);
			const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

			// Neutral offset (0%): 50% / 50% => 400px / 400px
			expect(env.mockSizer.style.paddingTop).toBe('400px');
			expect(env.mockSizer.style.paddingBottom).toBe('400px');

			// Positive offset (+20%): 560px top, 240px bottom
			env.mockPlugin.settings.immersive.typewriterCenterOffset = 20;
			pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
			expect(env.mockSizer.style.paddingTop).toBe('560px');
			expect(env.mockSizer.style.paddingBottom).toBe('240px');

			// Negative offset (-20%): 240px top, 560px bottom
			env.mockPlugin.settings.immersive.typewriterCenterOffset = -20;
			pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
			expect(env.mockSizer.style.paddingTop).toBe('240px');
			expect(env.mockSizer.style.paddingBottom).toBe('560px');

			// Disabling typewriter cleans up inline styles on sizer
			env.mockPlugin.settings.immersive.typewriterEnabled = false;
			pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
			expect(env.mockSizer.style.paddingTop).toBe('');
			expect(env.mockSizer.style.paddingBottom).toBe('');

			pluginInstance.destroy();
		});

		it('accurately targets center offset across opening lines (line 1, line 2, line 3) without constraint failure', () => {
			// Offset 0%: target 400px
			env.mockPlugin.settings.immersive.typewriterCenterOffset = 0;
			const extension = createTypewriterExtension(env.mockPlugin);

			// Line 1: pos 0
			const viewLine1 = env.createMockView(0, true);
			const instance1 = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(viewLine1);
			instance1.update({
				view: viewLine1,
				state: viewLine1.state,
				docChanged: true,
				selectionSet: false,
				transactions: [{ annotation: () => 'input.type' }]
			} as unknown as ViewUpdate);
			env.mockWindow.flushRaf();

			const dispatchMock1 = viewLine1.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock1).toHaveBeenCalled();
			const call1 = dispatchMock1.mock.calls[0]?.[0] as { effects?: { value?: { y?: string; yMargin?: number } } };
			expect(call1.effects?.value).toMatchObject({ y: 'start', yMargin: 400 });
			instance1.destroy();

			// Line 2: pos 50 (second line) with positive offset (+20% => target 560px)
			env.mockPlugin.settings.immersive.typewriterCenterOffset = 20;
			const viewLine2 = env.createMockView(50, true);
			const instance2 = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(viewLine2);
			instance2.update({
				view: viewLine2,
				state: viewLine2.state,
				docChanged: true,
				selectionSet: false,
				transactions: [{ annotation: () => 'input.type' }]
			} as unknown as ViewUpdate);
			env.mockWindow.flushRaf();

			const dispatchMock2 = viewLine2.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock2).toHaveBeenCalled();
			const call2 = dispatchMock2.mock.calls[0]?.[0] as { effects?: { value?: { y?: string; yMargin?: number } } };
			expect(call2.effects?.value).toMatchObject({ y: 'start', yMargin: 560 });
			instance2.destroy();

			// Line 3: pos 100 (third line) with negative offset (-20% => target 240px)
			env.mockPlugin.settings.immersive.typewriterCenterOffset = -20;
			const viewLine3 = env.createMockView(100, true);
			const instance3 = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(viewLine3);
			instance3.update({
				view: viewLine3,
				state: viewLine3.state,
				docChanged: true,
				selectionSet: false,
				transactions: [{ annotation: () => 'input.type' }]
			} as unknown as ViewUpdate);
			env.mockWindow.flushRaf();

			const dispatchMock3 = viewLine3.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock3).toHaveBeenCalled();
			const call3 = dispatchMock3.mock.calls[0]?.[0] as { effects?: { value?: { y?: string; yMargin?: number } } };
			expect(call3.effects?.value).toMatchObject({ y: 'start', yMargin: 240 });
			instance3.destroy();
		});

		it('re-centers when clicking the same opening line position on pointerup without selection change', () => {
			const extension = createTypewriterExtension(env.mockPlugin);
			const view = env.createMockView(0); // caret already at line 1 (pos 0)
			const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

			// Initial center
			pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
			env.mockWindow.flushRaf();
			(view.dispatch as unknown as ReturnType<typeof vi.fn>).mockClear();

			// User clicks on the same opening line: pointerdown -> pointerup (no selectionSet change since head is already 0)
			env.mockScroller.dispatchEvent('pointerdown');
			env.mockDocument.dispatchEvent('pointerup');
			env.mockWindow.flushRaf();

			const dispatchMock = view.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock).toHaveBeenCalled();
			const call = dispatchMock.mock.calls[0]?.[0] as { effects?: { value?: { y?: string; yMargin?: number } } };
			expect(call.effects?.value).toMatchObject({ y: 'start', yMargin: 400 });

			pluginInstance.destroy();
		});

		it('synchronizes DOM state and sizer padding on focusin before centering', () => {
			const extension = createTypewriterExtension(env.mockPlugin);
			const view = env.createMockView(0, true, null, null, true);
			const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

			// Simulate viewport resize / offset change while unfocused
			env.mockPlugin.settings.immersive.typewriterCenterOffset = 15;
			env.mockScroller.dispatchEvent('focusin');

			// Sizer padding should be immediately refreshed (0.5 + 0.15 = 0.65 => 800 * 0.65 = 520px)
			expect(env.mockSizer.style.paddingTop).toBe('520px');
			expect(env.mockSizer.style.paddingBottom).toBe('280px');

			env.mockWindow.flushRaf();
			const dispatchMock = view.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock).toHaveBeenCalled();
			const call = dispatchMock.mock.calls[0]?.[0] as { effects?: { value?: { y?: string; yMargin?: number } } };
			expect(call.effects?.value).toMatchObject({ y: 'start', yMargin: 520 });

			pluginInstance.destroy();
		});

		it('does not center or jump back to body text when clicking or focusing inline-title or metadata', () => {
			const extension = createTypewriterExtension(env.mockPlugin);
			const view = env.createMockView(500, true); // Caret is at line 10 (pos 500)
			const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

			// Initial center for body text
			pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
			env.mockWindow.flushRaf();
			(view.dispatch as unknown as ReturnType<typeof vi.fn>).mockClear();

			// User clicks on document inline-title
			const mockTitleEl = {
				closest: vi.fn((sel: string) => sel.includes('.inline-title') ? mockTitleEl : null)
			};
			env.mockScroller.dispatchEvent('pointerdown', { target: mockTitleEl });

			// activeElement moves to inline-title
			(env.mockDocument as unknown as { activeElement?: unknown }).activeElement = mockTitleEl;
			env.mockScroller.dispatchEvent('focusin', { target: mockTitleEl });
			env.mockDocument.dispatchEvent('pointerup');
			env.mockWindow.flushRaf();

			// Should NOT dispatch centering back to body text pos 500
			const dispatchMock = view.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock).not.toHaveBeenCalled();

			pluginInstance.destroy();
		});

		it('does not center or jump back to body text when clicking or dragging the right scrollbar', () => {
			const extension = createTypewriterExtension(env.mockPlugin);
			const view = env.createMockView(500, true); // Caret is at line 10 (pos 500)
			const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

			// Initial center
			pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
			env.mockWindow.flushRaf();
			(view.dispatch as unknown as ReturnType<typeof vi.fn>).mockClear();

			// User clicks on the right vertical scrollbar (clientX: 595, clientY: 400 within 600 width container)
			env.mockScroller.dispatchEvent('pointerdown', { clientX: 595, clientY: 400 });

			// User drags the scrollbar and triggers scroll event
			env.mockScroller.scrollTop = 1200;
			env.mockScroller.dispatchEvent('scroll');

			// User releases mouse after scrolling
			env.mockDocument.dispatchEvent('pointerup');
			env.mockWindow.flushRaf();

			// Should NOT jump back to pos 500
			const dispatchMock = view.dispatch as unknown as ReturnType<typeof vi.fn>;
			expect(dispatchMock).not.toHaveBeenCalled();

			pluginInstance.destroy();
		});
	});
});
