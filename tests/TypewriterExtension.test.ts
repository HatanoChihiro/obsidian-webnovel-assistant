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
	};
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
}

function createMockEnvironment(initialOffset = 0) {
	const rafCallbacks = new Map<number, FrameRequestCallback>();
	let rafCounter = 0;

	const mockWindow: MockWindow = {
		rafCallbacks,
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
			}
		},
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

	const scrollerListeners = new Map<string, Array<(e?: unknown) => void>>();
	const mockScroller: MockScrollerElement = {
		scrollTop: 500,
		clientHeight: 800,
		ownerDocument: mockDocument,
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
				typewriterCenterOffset: initialOffset
			}
		}
	};

	const createMockView = (headPos = 100, isEmptySelection = true): EditorView => {
		return {
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
					}
				}
			},
			lineBlockAt: (pos: number) => {
				const lineNum = Math.floor(pos / 50);
				return {
					top: lineNum * 30,
					height: 30,
					bottom: lineNum * 30 + 30
				};
			},
			visibleRanges: [{ from: 0, to: 200 }]
		} as unknown as EditorView;
	};

	return {
		mockWindow,
		mockDocument,
		mockScroller,
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

		// Even if flush runs, scrollTo was not called because rAF was cancelled
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

	it('cancels in-flight browser smooth-scroll at current position on manual user input', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500);
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Trigger initial smooth centering
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: false } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		// Smooth scroll is started
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
		env.mockScroller.scrollTo.mockClear();

		// Simulate scroll position during animation
		env.mockScroller.scrollTop = 320;

		// User initiates manual scroll input (wheel)
		env.mockScroller.dispatchEvent('wheel');

		// An immediate non-smooth scrollTo at current scrollTop must be executed to halt the animation
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith({
			top: 320,
			behavior: 'auto'
		});

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

		// 2. While finger is held, a selectionSet transaction occurs (e.g. touch hit-test)
		const gestureView = env.createMockView(100, true);
		const touchSelectionUpdate: ViewUpdate = {
			view: gestureView,
			state: gestureView.state,
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
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

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
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

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

		// User clicks or presses arrow keys to move caret
		const movedView = env.createMockView(100);
		const navUpdate: ViewUpdate = {
			view: movedView,
			state: movedView.state,
			docChanged: false,
			selectionSet: true
		} as unknown as ViewUpdate;
		pluginInstance.update(navUpdate);

		env.mockWindow.flushRaf();

		// Should center the new caret position
		expect(env.mockScroller.scrollTo).toHaveBeenCalledTimes(1);
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

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
		const clickedView = env.createMockView(100, true);
		pluginInstance.update({
			view: clickedView,
			state: clickedView.state,
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
		expect(env.mockScroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

		pluginInstance.destroy();
	});

	it('preserves selection dragging protection when mouse is down or selection is non-empty', () => {
		const extension = createTypewriterExtension(env.mockPlugin);
		const view = env.createMockView(500, false); // non-empty selection
		const pluginInstance = (extension as unknown as { create: (v: EditorView) => { update: (u: ViewUpdate) => void; destroy: () => void } }).create(view);

		// Initial update with non-empty selection
		pluginInstance.update({ view, state: view.state, docChanged: false, selectionSet: true } as unknown as ViewUpdate);
		env.mockWindow.flushRaf();

		expect(env.mockScroller.scrollTo).not.toHaveBeenCalled();

		// Mousedown drag state
		env.mockScroller.dispatchEvent('mousedown');
		const emptyView = env.createMockView(200, true);
		pluginInstance.update({ view: emptyView, state: emptyView.state, docChanged: true, selectionSet: true } as unknown as ViewUpdate);
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

		// rAF cancelled on destroy
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
