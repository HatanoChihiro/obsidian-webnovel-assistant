import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import { MobileFloatingStats, type MobileFloatingStatsPlugin } from '../src/ui/MobileFloatingStats';
import { MockElement } from './mocks/MockElement';
import { getLocale, setLocale, t } from '../src/i18n';

class FakeWindow extends EventTarget {
	innerWidth = 1000;
	innerHeight = 800;
	private nextRafId = 1;
	public rafCallbacks = new Map<number, FrameRequestCallback>();
	public canceledRafIds: number[] = [];

	requestAnimationFrame = vi.fn((cb: FrameRequestCallback): number => {
		const id = this.nextRafId++;
		this.rafCallbacks.set(id, cb);
		return id;
	});

	cancelAnimationFrame = vi.fn((id: number): void => {
		this.canceledRafIds.push(id);
		this.rafCallbacks.delete(id);
	});

	triggerRaf(id: number, time = 0): void {
		const cb = this.rafCallbacks.get(id);
		if (cb) {
			this.rafCallbacks.delete(id);
			cb(time);
		}
	}
}

class FakeDocument extends EventTarget {
	body: MockElement;
	win: FakeWindow;
	defaultView: FakeWindow;

	constructor(win: FakeWindow) {
		super();
		this.win = win;
		this.defaultView = win;
		this.body = new MockElement('body');
		(this.body as unknown as { ownerDocument: Document }).ownerDocument = this as unknown as Document;

		const originalCreateDiv = this.body.createDiv.bind(this.body);
		this.body.createDiv = (opts?: string | { cls?: string; text?: string }) => {
			const div = originalCreateDiv(opts);
			(div as unknown as { ownerDocument: Document }).ownerDocument = this as unknown as Document;
			(div as unknown as { setCssStyles: (styles: Record<string, string>) => void }).setCssStyles = vi.fn();
			(div as unknown as { offsetWidth: number }).offsetWidth = 150;
			(div as unknown as { offsetHeight: number }).offsetHeight = 40;
			return div;
		};
	}
}

interface PrivateStatsAccess {
	isDragging: boolean;
	containerEl: (MockElement & { setCssStyles: ReturnType<typeof vi.fn> }) | null;
	wordCountEl: MockElement | null;
	progressEl: MockElement | null;
	timerEl: MockElement | null;
	timerBtnEl: MockElement | null;
	timerTextEl: MockElement | null;
	ownerDocument: Document | null;
	ownerWindow: Window | null;
	pendingInitialRaf: { win: Window; id: number } | null;
	currentTimerIcon: 'play' | 'pause' | null;
}

const createPluginFixture = (overrides?: Partial<MobileFloatingStatsPlugin>): MobileFloatingStatsPlugin => ({
	isTracking: false,
	focusMs: 0,
	settings: {
		enableMobileFocusTimer: true,
		mobileFloatingStatsState: { x: 20, y: 100 }
	},
	statisticsManager: {
		getCoreStats: () => ({
			isTracking: false,
			focusTime: '00:00:00',
			slackTime: '00:00:00',
			totalTime: '00:00:00',
			sessionWords: 0,
			todayWords: 1000,
			goal: 2000,
			percent: 50,
			dailyWords: 0,
			rawDailyWords: 0,
			dailyGoal: 1000,
			dailyPercent: 0,
			currentFile: 'chapter',
			currentFolder: 'book'
		})
	},
	startTracking: vi.fn(),
	stopTracking: vi.fn(),
	saveSettings: vi.fn().mockResolvedValue(undefined),
	...overrides
});

const fakeApp = {
	workspace: {
		getActiveViewOfType: vi.fn().mockReturnValue(null)
	}
} as unknown as App;

describe('MobileFloatingStats lifecycle & icon caching', () => {
	let originalActiveDoc: unknown;
	let originalActiveWin: unknown;
	let originalWindow: unknown;
	let originalLocale: ReturnType<typeof getLocale>;

	const setGlobals = (win: FakeWindow, doc: FakeDocument): void => {
		(globalThis as Record<string, unknown>).activeDocument = doc;
		(globalThis as Record<string, unknown>).activeWindow = win;
		globalThis.window = win as unknown as Window & typeof globalThis;
	};

	beforeEach(() => {
		originalActiveDoc = (globalThis as Record<string, unknown>).activeDocument;
		originalActiveWin = (globalThis as Record<string, unknown>).activeWindow;
		originalWindow = globalThis.window;
		originalLocale = getLocale();
	});

	afterEach(async () => {
		(globalThis as Record<string, unknown>).activeDocument = originalActiveDoc;
		(globalThis as Record<string, unknown>).activeWindow = originalActiveWin;
		globalThis.window = originalWindow as Window & typeof globalThis;
		vi.restoreAllMocks();
		await setLocale(originalLocale);
	});

	it('cleans up original owner listeners, RAF, mid-drag state, and all DOM refs when focus switches before unload', () => {
		const win1 = new FakeWindow();
		const doc1 = new FakeDocument(win1);
		const win2 = new FakeWindow();
		const doc2 = new FakeDocument(win2);

		const win1AddListenerSpy = vi.spyOn(win1, 'addEventListener');
		const win1RemoveListenerSpy = vi.spyOn(win1, 'removeEventListener');
		const doc1AddListenerSpy = vi.spyOn(doc1, 'addEventListener');
		const doc1RemoveListenerSpy = vi.spyOn(doc1, 'removeEventListener');

		const win2RemoveListenerSpy = vi.spyOn(win2, 'removeEventListener');
		const doc2RemoveListenerSpy = vi.spyOn(doc2, 'removeEventListener');

		setGlobals(win1, doc1);
		const plugin = createPluginFixture();
		const stats = new MobileFloatingStats(fakeApp, plugin);
		stats.load();

		expect(win1AddListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
		expect(win1.requestAnimationFrame).toHaveBeenCalledTimes(1);

		const internal = stats as unknown as PrivateStatsAccess;
		expect(internal.containerEl).not.toBeNull();
		const container = internal.containerEl!;

		// Start drag to attach listeners to ownerDocument
		container.dispatchEvent('touchstart', {
			touches: [{ clientX: 50, clientY: 100 }],
			preventDefault: vi.fn()
		});
		container.dispatchEvent('mousedown', { clientX: 50, clientY: 100 });
		expect(internal.isDragging).toBe(true);
		expect(doc1AddListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false });
		expect(doc1AddListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
		expect(doc1AddListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

		// Switch active globals to another window / document
		setGlobals(win2, doc2);

		// Unload should clean up the ORIGINAL owner, even mid-drag
		stats.unload();

		expect(win1RemoveListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
		expect(doc1RemoveListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
		expect(doc1RemoveListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
		expect(doc1RemoveListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
		expect(doc1RemoveListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
		expect(win1.cancelAnimationFrame).toHaveBeenCalledTimes(1);

		expect(win2RemoveListenerSpy).not.toHaveBeenCalled();
		expect(doc2RemoveListenerSpy).not.toHaveBeenCalled();

		expect(internal.isDragging).toBe(false);
		expect(internal.containerEl).toBeNull();
		expect(internal.wordCountEl).toBeNull();
		expect(internal.progressEl).toBeNull();
		expect(internal.timerEl).toBeNull();
		expect(internal.timerBtnEl).toBeNull();
		expect(internal.timerTextEl).toBeNull();
		expect(internal.ownerDocument).toBeNull();
		expect(internal.ownerWindow).toBeNull();
		expect(internal.pendingInitialRaf).toBeNull();
		expect(internal.currentTimerIcon).toBeNull();
	});

	it('coalesces drag writes, flushes final bounds before docking, and saves the latest position', () => {
		const win = new FakeWindow();
		const doc = new FakeDocument(win);
		setGlobals(win, doc);
		const plugin = createPluginFixture();
		const stats = new MobileFloatingStats(fakeApp, plugin);
		stats.load();
		win.triggerRaf(1);
		const el = (stats as unknown as PrivateStatsAccess).containerEl!;
		const writes = el.setCssStyles;
		writes.mockClear();
		el.dispatchEvent('mousedown', { clientX: 20, clientY: 100 });
		for (let x = 100; x <= 200; x += 10) {
			doc.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: x, clientY: 200 }));
		}
		expect(writes).not.toHaveBeenCalled();
		win.triggerRaf(2);
		expect(writes).toHaveBeenCalledTimes(1);
		expect(writes).toHaveBeenLastCalledWith({ left: '200px', top: '200px' });
		doc.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 300, clientY: 250 }));
		doc.dispatchEvent(new Event('mouseup'));
		expect(plugin.settings.mobileFloatingStatsState).toMatchObject({ x: 300, y: 250 });
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		const calls = writes.mock.calls.length;
		win.triggerRaf(3);
		expect(writes).toHaveBeenCalledTimes(calls);
		stats.unload();
	});

	it('cancels pending drag frames on touch cancellation and unload', () => {
		const win = new FakeWindow();
		const doc = new FakeDocument(win);
		setGlobals(win, doc);
		const stats = new MobileFloatingStats(fakeApp, createPluginFixture());
		stats.load();
		win.triggerRaf(1);
		const internal = stats as unknown as PrivateStatsAccess;
		const el = internal.containerEl!;
		el.dispatchEvent('touchstart', { touches: [{ clientX: 20, clientY: 100 }], preventDefault: vi.fn() });
		doc.dispatchEvent(Object.assign(new Event('touchmove'), { touches: [{ clientX: 250, clientY: 200 }] }));
		doc.dispatchEvent(new Event('touchcancel'));
		expect(internal.isDragging).toBe(false);
		expect(win.rafCallbacks.size).toBe(0);
		el.dispatchEvent('mousedown', { clientX: 250, clientY: 200 });
		doc.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 300, clientY: 250 }));
		const stale = [...win.rafCallbacks.values()][0];
		el.setCssStyles.mockClear();
		stats.unload();
		expect(win.rafCallbacks.size).toBe(0);
		stale?.(0);
		expect(el.setCssStyles).not.toHaveBeenCalled();
	});

	it('ensures canceled RAF callback from previous window is inert when reloaded in a new owner window', () => {
		const win1 = new FakeWindow();
		const doc1 = new FakeDocument(win1);
		const win2 = new FakeWindow();
		const doc2 = new FakeDocument(win2);

		setGlobals(win1, doc1);
		const plugin = createPluginFixture();
		const stats = new MobileFloatingStats(fakeApp, plugin);

		stats.load();
		const staleRafId = 1;
		const staleCb = win1.rafCallbacks.get(staleRafId);
		expect(staleCb).toBeDefined();

		stats.unload();
		expect(win1.cancelAnimationFrame).toHaveBeenCalledWith(staleRafId);

		// Reload in new window
		setGlobals(win2, doc2);
		stats.load();

		const internal = stats as unknown as PrivateStatsAccess;
		const newRafEntry = internal.pendingInitialRaf;
		const setStyles = internal.containerEl!.setCssStyles as ReturnType<typeof vi.fn>;
		setStyles.mockClear();
		expect(newRafEntry).not.toBeNull();
		expect(newRafEntry?.win).toBe(win2);

		// Trigger stale callback from old window - should be inert
		staleCb!(0);
		expect(internal.pendingInitialRaf).toBe(newRafEntry);
		expect(setStyles).not.toHaveBeenCalled();

		// Trigger current frame on new window - executes and clears pending entry
		win2.triggerRaf(newRafEntry!.id);
		expect(internal.pendingInitialRaf).toBeNull();
		expect(setStyles).toHaveBeenCalledTimes(1);

		// Idempotent load call while loaded does nothing
		const oldContainer = internal.containerEl;
		stats.load();
		expect(internal.containerEl).toBe(oldContainer);
		expect(internal.pendingInitialRaf).toBeNull();
		stats.unload();
	});

	it('avoids redundant setIcon calls while preserving text, settings, locale, and recreated DOM', async () => {
		const win = new FakeWindow();
		const doc = new FakeDocument(win);
		setGlobals(win, doc);

		const setIconSpy = vi.spyOn(obsidian, 'setIcon');
		const plugin = createPluginFixture({
			isTracking: false,
			focusMs: 0,
			settings: {
				enableMobileFocusTimer: true,
				mobileFloatingStatsState: { x: 20, y: 100 }
			}
		});

		const stats = new MobileFloatingStats(fakeApp, plugin);
		stats.load();

		// Initial load creates timerBtnEl and sets 'play' icon once
		expect(setIconSpy).toHaveBeenCalledTimes(1);
		expect(setIconSpy).toHaveBeenLastCalledWith(expect.anything(), 'play');
		setIconSpy.mockClear();

		const internal = stats as unknown as PrivateStatsAccess;
		const initialBtn = internal.timerBtnEl;
		const timerTextEl = internal.timerTextEl;
		expect(timerTextEl?.textContent).toBe('专注计时');

		// 100 updates with unchanged tracking state should NOT call setIcon
		for (let i = 0; i < 100; i++) {
			stats.updateTimerUI();
		}
		expect(setIconSpy).not.toHaveBeenCalled();

		// Transition to tracking: true -> sets 'pause' icon once
		plugin.isTracking = true;
		plugin.focusMs = 3661000; // 01:01:01
		stats.updateTimerUI();

		expect(setIconSpy).toHaveBeenCalledTimes(1);
		expect(setIconSpy).toHaveBeenLastCalledWith(initialBtn, 'pause');
		expect(timerTextEl?.textContent).toBe('01:01:01');
		setIconSpy.mockClear();

		// 50 updates advancing seconds while tracking -> 0 setIcon calls, text updates
		for (let i = 1; i <= 50; i++) {
			plugin.focusMs = (3661 + i) * 1000;
			stats.updateTimerUI();
		}
		expect(setIconSpy).not.toHaveBeenCalled();
		expect(timerTextEl?.textContent).toBe('01:01:51');

		// Toggle timer off and on in settings
		plugin.settings.enableMobileFocusTimer = false;
		stats.updateTimerUI();
		plugin.settings.enableMobileFocusTimer = true;
		stats.updateTimerUI();
		expect(setIconSpy).not.toHaveBeenCalled();

		// Transition to tracking: false -> sets 'play' icon once and resets text
		plugin.isTracking = false;
		plugin.focusMs = 0;
		stats.updateTimerUI();
		expect(setIconSpy).toHaveBeenCalledTimes(1);
		expect(setIconSpy).toHaveBeenLastCalledWith(initialBtn, 'play');
		expect(timerTextEl?.textContent).toBe('专注计时');
		setIconSpy.mockClear();
		await setLocale('en');
		stats.updateTimerUI();
		expect(timerTextEl?.textContent).toBe(t('setting.mobile-focus-timer-start').replace(/^[▶⏸\s]+/, ''));
		expect(timerTextEl?.textContent).not.toBe('专注计时');
		expect(setIconSpy).not.toHaveBeenCalled();

		// Unload and reload: new button is created and reinitializes cache
		stats.unload();
		stats.load();

		const newBtn = internal.timerBtnEl;
		expect(newBtn).not.toBe(initialBtn);
		expect(setIconSpy).toHaveBeenCalledTimes(1);
		expect(setIconSpy).toHaveBeenLastCalledWith(newBtn, 'play');
		setIconSpy.mockClear();

		// 50 updates on recreated button should not call setIcon
		for (let i = 0; i < 50; i++) {
			stats.updateTimerUI();
		}
		expect(setIconSpy).not.toHaveBeenCalled();
		stats.unload();
	});
});
