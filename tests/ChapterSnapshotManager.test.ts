import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile, MarkdownView } from 'obsidian';
import { ChapterSnapshotPanel } from '../src/ui/ChapterSnapshotPanel';
import { ChapterDiffEngine } from '../src/services/ChapterDiffEngine';
import { MockElement } from './mocks/MockElement';
import { ChapterSnapshotManager } from '../src/services/ChapterSnapshotManager';
import type { NativeSnapshotService } from '../src/services/NativeSnapshotService';
import { WritingJourneyBoardRenderer } from '../src/ui/components/WritingJourneyBoardRenderer';
import type { WritingJourneyEvent } from '../src/types/writingJourney';

if (typeof window === 'undefined') {
	(globalThis as unknown as { window: unknown }).window = globalThis;
}

const { MockTFile, MockMarkdownView } = vi.hoisted(() => {
	class MockFile {
		extension = 'md';
		basename: string;
		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}
	class MockView {
		file: unknown = null;
		containerEl = {
			ownerDocument: {
				defaultView: { innerWidth: 1024, innerHeight: 768 },
				createElement: vi.fn(() => ({
					addClass: vi.fn(),
					setCssProps: vi.fn(),
					createDiv: vi.fn(() => ({
						createSpan: vi.fn(() => ({})),
						createEl: vi.fn(() => ({})),
						empty: vi.fn(),
						appendChild: vi.fn(),
						insertBefore: vi.fn()
					})),
					createEl: vi.fn(() => ({})),
					createSpan: vi.fn(() => ({})),
					appendChild: vi.fn(),
					insertBefore: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					querySelector: vi.fn(() => null),
					querySelectorAll: vi.fn(() => [])
				})),
				body: {
					appendChild: vi.fn()
				},
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			}
		};
		getViewData() { return 'editor content'; }
		editor = { getValue: () => 'editor content' };
	}
	return {
		MockTFile: MockFile,
		MockMarkdownView: MockView
	};
});

vi.mock('obsidian', () => ({
	TFile: MockTFile,
	MarkdownView: MockMarkdownView,
	setIcon: vi.fn()
}));

vi.mock('../src/i18n', () => ({
	t: (k: string) => k
}));

describe('ChapterSnapshotManager Regressions', () => {
	let mockApp: App;
	let mockNativeSnapshotService: NativeSnapshotService;
	let mockDoc: Document;

	beforeEach(() => {
		mockDoc = {
			defaultView: {
				createDiv: vi.fn(() => mockDoc.createElement('div')),
				innerWidth: 1200,
				innerHeight: 800,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				setTimeout: vi.fn(),
				clearTimeout: vi.fn()
			},
			createElement: vi.fn((tag: string) => {
				const el = {
					tagName: tag,
					style: {},
					addClass: vi.fn(),
					removeClass: vi.fn(),
					toggleClass: vi.fn(),
					setText: vi.fn(),
					empty: vi.fn(),
					createDiv: vi.fn(() => el),
					createSpan: vi.fn(() => el),
					createEl: vi.fn(() => el),
					appendChild: vi.fn(),
					insertBefore: vi.fn(),
					removeChild: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					querySelector: vi.fn(() => null),
					querySelectorAll: vi.fn(() => []),
					getClientRects: vi.fn(() => [{ top: 100, height: 20 }]),
					getBoundingClientRect: vi.fn(() => ({ top: 100, left: 100, width: 600, height: 400 }))
				};
				return el;
			}),
			createTextNode: vi.fn((text: string) => ({ textContent: text })),
			body: {
				appendChild: vi.fn(),
				removeChild: vi.fn(),
				createDiv: vi.fn((cls?: string) => {
					const el = mockDoc.createElement('div');
					if (cls) el.addClass(cls);
					mockDoc.body.appendChild(el);
					return el;
				})
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as Document;

		mockApp = {
			workspace: {
				getActiveViewOfType: vi.fn(() => null),
				getMostRecentLeaf: vi.fn(() => null),
				getActiveFile: vi.fn(() => null),
				getLeavesOfType: vi.fn(() => []),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			},
			vault: {
				getAbstractFileByPath: vi.fn(),
				read: vi.fn(async () => 'file content')
			}
		} as unknown as App;

		mockNativeSnapshotService = {
			getOrCreateDeviceId: vi.fn(() => 'd'),
			listSnapshotsForPath: vi.fn(async () => [
				{ key: 1, path: 'Book/Chapter1.md', ts: 1000 }
			]),
			readSnapshotByKey: vi.fn(async () => 'snapshot body'),
			checkStatus: vi.fn(() => ({ status: 'available', dbName: 'b', deviceId: 'd' }))
		} as unknown as NativeSnapshotService;
	});

	it('should resolve command context from active MarkdownView', () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
		const view = new MockMarkdownView();
		view.file = file;

		vi.mocked(mockApp.workspace.getActiveViewOfType).mockReturnValue(view as unknown as MarkdownView);

		const ctx = mgr.resolveCommandContext();
		expect(ctx.file).toBe(file);
	});

	it('should resolve command context from most recent leaf when focused on sidebar', () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file = new MockTFile('Chapter2.md', 'Book/Chapter2.md') as unknown as TFile;
		const view = new MockMarkdownView();
		view.file = file;

		vi.mocked(mockApp.workspace.getActiveViewOfType).mockReturnValue(null);
		vi.mocked(mockApp.workspace.getMostRecentLeaf).mockReturnValue({ view } as unknown as WorkspaceLeaf);

		const ctx = mgr.resolveCommandContext();
		expect(ctx.file).toBe(file);
	});

	it('should open and reuse comparison panel per owner window', async () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file1 = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
		const file2 = new MockTFile('Chapter2.md', 'Book/Chapter2.md') as unknown as TFile;

		await mgr.openComparison({
			file: file1,
			ownerDocument: mockDoc
		});

		expect(mockDoc.body.appendChild).toHaveBeenCalledTimes(1);
		const panel1 = mgr.getPanel(mockDoc);
		expect(panel1).toBeDefined();

		// Opening second time in same window should rebind rather than creating duplicate panel
		await mgr.openComparison({
			file: file2,
			ownerDocument: mockDoc
		});

		expect(mockDoc.body.appendChild).toHaveBeenCalledTimes(1);
		const panel2 = mgr.getPanel(mockDoc);
		expect(panel2).toBe(panel1);

		mgr.destroy();
	});

	it('keeps the panel inside body when the document root is fullscreen', async () => {
		const root = mockDoc.createElement('html');
		Object.assign(mockDoc, { documentElement: root, fullscreenElement: root });
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);

		await mgr.openComparison({ chapterPath: 'Book/Chapter1.md', ownerDocument: mockDoc });

		expect(mockDoc.body.appendChild).toHaveBeenCalledTimes(1);
		expect(root.createDiv).not.toHaveBeenCalled();
		mgr.destroy();
	});

	it('retains the body mount and panel state when entering and leaving root fullscreen', async () => {
		const root = mockDoc.createElement('html');
		Object.assign(mockDoc, { documentElement: root, fullscreenElement: null });
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		await mgr.openComparison({ chapterPath: 'Book/Chapter1.md', ownerDocument: mockDoc });
		const panel = mgr.getPanel(mockDoc)!;
		Object.assign(panel.panelEl, { parentElement: mockDoc.body });
		panel.diffContainerEl.scrollTop = 160;
		const listener = vi.mocked(mockDoc.addEventListener).mock.calls.find(([type]) => type === 'fullscreenchange')?.[1];
		if (typeof listener !== 'function') throw new Error('Missing fullscreen listener');

		Object.assign(mockDoc, { fullscreenElement: root });
		listener.call(mockDoc, new Event('fullscreenchange'));
		Object.assign(mockDoc, { fullscreenElement: null });
		listener.call(mockDoc, new Event('fullscreenchange'));

		expect(root.appendChild).not.toHaveBeenCalled();
		expect(mockDoc.body.appendChild).toHaveBeenCalledTimes(1);
		expect(mgr.getPanel(mockDoc)).toBe(panel);
		expect(panel.diffContainerEl.scrollTop).toBe(160);
		mgr.destroy();
	});

	it('mounts inside a fullscreen subtree and returns to body when it closes', async () => {
		const root = mockDoc.createElement('html');
		const fullscreen = mockDoc.createElement('div');
		Object.assign(mockDoc, { documentElement: root, fullscreenElement: fullscreen });
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		await mgr.openComparison({ chapterPath: 'Book/Chapter1.md', ownerDocument: mockDoc });
		const panel = mgr.getPanel(mockDoc)!;
		Object.assign(panel.panelEl, { parentElement: fullscreen });

		expect(fullscreen.createDiv).toHaveBeenCalledWith('wn-snapshot-panel');
		expect(mockDoc.body.appendChild).not.toHaveBeenCalled();
		const listener = vi.mocked(mockDoc.addEventListener).mock.calls.find(([type]) => type === 'fullscreenchange')?.[1];
		if (typeof listener !== 'function') throw new Error('Missing fullscreen listener');
		Object.assign(mockDoc, { fullscreenElement: null });
		listener.call(mockDoc, new Event('fullscreenchange'));

		expect(mockDoc.body.appendChild).toHaveBeenCalledWith(panel.panelEl);
		mgr.destroy();
	});

	it('should pass snapshotRef through rebind of an existing panel', async () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file1 = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
		await mgr.openComparison({
			file: file1,
			ownerDocument: mockDoc
		});
		const panel = mgr.getPanel(mockDoc)!;
		expect(panel).toBeDefined();

		const snapshotRef = {
			provider: 'file-recovery' as const,
			deviceId: 'test-device',
			dbName: 'test-db',
			key: 42,
			path: 'Book/Chapter1.md',
			ts: 123456789,
			digest: 'a'.repeat(64)
		};

		await mgr.openComparison({
			file: file1,
			snapshotRef,
			ownerDocument: mockDoc
		});

		expect(panel.currentSnapshotRef).toEqual(snapshotRef);
		mgr.destroy();
	});

	it('should show unavailable notice and not fall back to latest or empty when snapshotRef fails readSnapshot', async () => {
		mockNativeSnapshotService.readSnapshot = vi.fn(async () => {
			throw new Error('Foreign device snapshot');
		});

		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;

		const foreignRef = {
			provider: 'file-recovery' as const,
			deviceId: 'other-device',
			dbName: 'other-db',
			key: 999,
			path: 'Book/Chapter1.md',
			ts: 999999,
			digest: 'b'.repeat(64)
		};

		await mgr.openComparison({
			file,
			snapshotRef: foreignRef,
			ownerDocument: mockDoc
		});

		const panel = mgr.getPanel(mockDoc)!;
		expect(panel).toBeDefined();
		expect(panel.diffContainerEl.setText).toHaveBeenCalledWith('snapshot.missing-ref');
		// Must not fall back to latest or readSnapshotByKey
		expect(mockNativeSnapshotService.readSnapshotByKey).not.toHaveBeenCalled();
		mgr.destroy();
	});

	it('should show no snapshot recorded notice when journeyEvent has no snapshot ref', async () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;

		const eventWithoutSnapshot: WritingJourneyEvent = {
			id: 'ev-1',
			type: 'chapter.status_changed',
			timestamp: '2026-03-01T10:00:00Z',
			path: 'Book/Chapter1.md',
			chapterTitle: 'Chapter1',
			fromStatus: 'unwritten',
			toStatus: 'draft',
			snapshotUnavailable: true
		};

		await mgr.openComparison({
			file,
			journeyEvent: eventWithoutSnapshot,
			ownerDocument: mockDoc
		});

		const panel = mgr.getPanel(mockDoc)!;
		expect(panel).toBeDefined();
		expect(panel.diffContainerEl.setText).toHaveBeenCalledWith('snapshot.no-journey-snapshot');
		mgr.destroy();
	});

	it('applies portrait defaults and releases its orientation listener on close', async () => {
		const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
		Object.assign(mockDoc.defaultView!, { matchMedia: () => media });
		Object.assign(mockDoc.body, { hasClass: () => true });
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		await mgr.openComparison({ chapterPath: 'Book/Chapter1.md', ownerDocument: mockDoc });
		const panel = mgr.getPanel(mockDoc)! as unknown as { isPhonePortrait: boolean; showOnlyDifferences: boolean; loadAndRenderDiff(): Promise<void> };
		expect(panel.isPhonePortrait).toBe(true);
		expect(panel.showOnlyDifferences).toBe(true);
		media.matches = false;
		const listener = media.addEventListener.mock.calls[0][1] as () => void;
		listener();
		await panel.loadAndRenderDiff();
		expect(panel.isPhonePortrait).toBe(false);
		expect(panel.showOnlyDifferences).toBe(false);
		mgr.destroy();
		expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
	});

	it('should trace path forward through renames/moves and terminate on deletion', () => {
		const f1 = new MockTFile('Ch1_v2.md', 'NovelA/Ch1_v2.md') as unknown as TFile;
		vi.mocked(mockApp.vault.getAbstractFileByPath).mockImplementation((p: string) => {
			if (p === 'NovelA/Ch1_v2.md') return f1;
			return null;
		});

		const targetEvent: WritingJourneyEvent = {
			id: 'e1',
			type: 'chapter.status_changed',
			timestamp: '2026-01-01T10:00:00Z',
			path: 'NovelA/Ch1.md',
			chapterTitle: 'Ch1',
			fromStatus: 'unwritten',
			toStatus: 'draft'
		};

		const events: WritingJourneyEvent[] = [
			targetEvent,
			{
				id: 'e2',
				type: 'chapter.renamed',
				timestamp: '2026-01-02T10:00:00Z',
				oldPath: 'NovelA/Ch1.md',
				newPath: 'NovelA/Ch1_v2.md',
				oldTitle: 'Ch1',
				newTitle: 'Ch1_v2'
			}
		];

		const res1 = WritingJourneyBoardRenderer.resolveForwardChapterFile(targetEvent, events, mockApp);
		expect(res1.isDeleted).toBe(false);
		expect(res1.resolvedPath).toBe('NovelA/Ch1_v2.md');
		expect(res1.file).toBe(f1);

		// With deletion
		const eventsWithDelete: WritingJourneyEvent[] = [
			...events,
			{
				id: 'e3',
				type: 'chapter.deleted',
				timestamp: '2026-01-03T10:00:00Z',
				path: 'NovelA/Ch1_v2.md',
				chapterTitle: 'Ch1_v2'
			},
			{
				id: 'e4',
				type: 'chapter.created',
				timestamp: '2026-01-04T10:00:00Z',
				path: 'NovelA/Ch1.md',
				chapterTitle: 'Ch1'
			}
		];

		const res2 = WritingJourneyBoardRenderer.resolveForwardChapterFile(targetEvent, eventsWithDelete, mockApp);
		expect(res2.isDeleted).toBe(true);
		expect(res2.file).toBeNull();
	});
	it('verifies an associated ref on either side after swapping', async () => {
		const read = vi.fn(async () => 'exact snapshot');
		mockNativeSnapshotService.readSnapshot = read;
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
		const ref = { provider: 'file-recovery' as const, deviceId: 'd', dbName: 'b', key: 1, path: file.path, ts: 1000, digest: 'a'.repeat(64) };
		await mgr.openComparison({ file, snapshotRef: ref, ownerDocument: mockDoc });
		const panel = mgr.getPanel(mockDoc)!;
		const internal = panel as unknown as { leftMode: string | number; rightMode: string | number; loadAndRenderDiff(): Promise<void> };
		internal.leftMode = 'current';
		internal.rightMode = 1;
		await internal.loadAndRenderDiff();
		expect(read).toHaveBeenCalledTimes(2);
		expect(mockNativeSnapshotService.readSnapshotByKey).not.toHaveBeenCalled();
		expect(panel.currentSnapshotRef).toEqual(ref);
		mgr.destroy();
	});

	it('updates the current draft when it is on the left and preserves empty editor text', async () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
		await mgr.openComparison({ file, ownerDocument: mockDoc });
		const internal = mgr.getPanel(mockDoc)! as unknown as { leftMode: string | number; rightMode: string | number; leftContent: string; scheduleEditorRefresh(text: string): void };
		internal.leftMode = 'current';
		internal.rightMode = 1;
		internal.scheduleEditorRefresh('');
		const timers = vi.mocked(mockDoc.defaultView!.setTimeout).mock.calls;
		const callback = timers[timers.length - 1][0];
		if (typeof callback !== 'function') throw new Error('Expected debounce callback');
		callback();
		await new Promise(resolve => globalThis.setTimeout(resolve, 0));
		expect(internal.leftContent).toBe('');
		mgr.destroy();
	});

	it('does not open another panel after the manager is destroyed', async () => {
		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		mgr.destroy();
		await mgr.openComparison({ chapterPath: 'Book/Chapter1.md', ownerDocument: mockDoc });
		expect(mockDoc.body.appendChild).not.toHaveBeenCalled();
	});

	it('reuses computed diff on presentation toggles without re-reading snapshots, coalesces identical side reads, reuses historical side across live draft refreshes, and preserves pending 500ms refresh', async () => {
		const origSetTimeout = globalThis.setTimeout;
		const scheduledTimers: Array<{ cb: () => void; ms?: number }> = [];
		vi.mocked(mockDoc.defaultView!.setTimeout).mockImplementation(((cb: TimerHandler, ms?: number) => {
			if (typeof cb === 'function') {
				if (!ms || ms === 0) {
					return origSetTimeout(cb, 0);
				}
				scheduledTimers.push({ cb: cb as () => void, ms });
			}
			return scheduledTimers.length as unknown as number;
		}) as typeof window.setTimeout);

		vi.mocked(mockDoc.createElement).mockImplementation((tag: string) => {
			const el: Record<string, unknown> = {
				tagName: tag,
				style: {},
				addClass: vi.fn(),
				removeClass: vi.fn(),
				toggleClass: vi.fn(),
				setAttribute: vi.fn(),
				removeAttribute: vi.fn(),
				setText: vi.fn(),
				empty: vi.fn(),
				createDiv: vi.fn(() => mockDoc.createElement('div')),
				createSpan: vi.fn(() => mockDoc.createElement('span')),
				createEl: vi.fn((childTag: string) => mockDoc.createElement(childTag)),
				appendChild: vi.fn(),
				insertBefore: vi.fn(),
				removeChild: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				querySelector: vi.fn(() => null),
				querySelectorAll: vi.fn(() => []),
				closest: vi.fn(() => null),
				getClientRects: vi.fn(() => [{ top: 100, height: 20 }]),
				getBoundingClientRect: vi.fn(() => ({ top: 100, left: 100, width: 600, height: 400 }))
			};
			return el as unknown as HTMLElement;
		});

		const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
		Object.assign(mockDoc.defaultView!, { matchMedia: () => media });
		Object.assign(mockDoc.body, { hasClass: (cls: string) => cls === 'is-phone' });

		const computeSpy = vi.spyOn(ChapterDiffEngine, 'computeDiff');
		try {
			const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
			const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
			await mgr.openComparison({ file, ownerDocument: mockDoc });
			const panel = mgr.getPanel(mockDoc)! as unknown as {
				onlyDifferencesBtnEl: { onclick: () => void };
				singleViewBtnEl: { onclick: () => void };
				scheduleEditorRefresh(text: string): void;
				leftMode: 'current' | number | null;
				rightMode: 'current' | number;
				loadAndRenderDiff(text?: string): Promise<void>;
				rightContent: string;
			};

			expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(1);
			expect(computeSpy).toHaveBeenCalledTimes(1);

			// Toggle only-differences, single-view, and phone orientation: must NOT re-read snapshot or recompute diff
			panel.onlyDifferencesBtnEl.onclick();
			await new Promise(resolve => origSetTimeout(resolve, 10));
			panel.singleViewBtnEl.onclick();
			await new Promise(resolve => origSetTimeout(resolve, 10));
			media.matches = true;
			const orientListener = media.addEventListener.mock.calls[0][1] as () => void;
			orientListener();
			await new Promise(resolve => origSetTimeout(resolve, 10));

			expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(1);
			expect(computeSpy).toHaveBeenCalledTimes(1);

			// Schedule 500ms live editor refresh, then toggle presentation while debounce is pending
			panel.scheduleEditorRefresh('updated draft v2');
			expect(scheduledTimers).toHaveLength(1);
			panel.onlyDifferencesBtnEl.onclick();
			await new Promise(resolve => origSetTimeout(resolve, 10));

			// Fire the 500ms timer: must NOT have been dropped by presentation toggle, and must reuse historical left side
			scheduledTimers[0].cb();
			await new Promise(resolve => origSetTimeout(resolve, 20));
			expect(panel.rightContent).toBe('updated draft v2');
			expect(computeSpy).toHaveBeenCalledTimes(2);
			expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(1);

			// Selecting same snapshot key on both sides should coalesce into a single read
			panel.leftMode = 1;
			panel.rightMode = 1;
			await panel.loadAndRenderDiff();
			expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(2);

			// Redundant fields removed
			expect('leftSnapshotKey' in ChapterSnapshotPanel.prototype).toBe(false);
			expect('plugin' in (mgr.getPanel(mockDoc) as unknown as Record<string, unknown>)).toBe(false);

			mgr.destroy();
		} finally {
			computeSpy.mockRestore();
		}
	});

	it('does not reuse cached dropdown snapshot text when checkStatus changes dbName or deviceId', async () => {
		const origSetTimeout = globalThis.setTimeout;
		vi.mocked(mockDoc.defaultView!.setTimeout).mockImplementation(((cb: TimerHandler) => {
			if (typeof cb === 'function') return origSetTimeout(cb, 0);
			return 1 as unknown as number;
		}) as typeof window.setTimeout);

		let currentScope = { status: 'available' as const, dbName: 'db-a', deviceId: 'dev-a' };
		let currentSnapshotText = 'snapshot from db-a';
		let currentMetaList = [{ key: 1, path: 'Book/Chapter1.md', ts: 1000 }];

		vi.mocked(mockNativeSnapshotService.checkStatus).mockImplementation(() => currentScope);
		vi.mocked(mockNativeSnapshotService.listSnapshotsForPath).mockImplementation(async () => currentMetaList);
		vi.mocked(mockNativeSnapshotService.readSnapshotByKey).mockImplementation(async () => currentSnapshotText);

		const mgr = new ChapterSnapshotManager(mockApp, mockNativeSnapshotService);
		expect(ChapterSnapshotManager.length).toBe(2);
		const file = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
		await mgr.openComparison({ file, ownerDocument: mockDoc });

		const panel = mgr.getPanel(mockDoc)! as unknown as {
			leftContent: string;
			rightContent: string;
			loadAndRenderDiff(text?: string): Promise<void>;
		};

		expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(1);
		expect(panel.leftContent).toBe('snapshot from db-a');

		// Same scope: live draft refresh reuses cached dropdown snapshot
		await panel.loadAndRenderDiff('draft v2');
		expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(1);
		expect(panel.leftContent).toBe('snapshot from db-a');

		// dbName changes with same numeric key: must NOT reuse cached text from db-a
		currentScope = { status: 'available', dbName: 'db-b', deviceId: 'dev-a' };
		currentSnapshotText = 'snapshot from db-b';
		await panel.loadAndRenderDiff('draft v3');
		expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(2);
		expect(panel.leftContent).toBe('snapshot from db-b');

		// deviceId changes with same numeric key: must NOT reuse cached text from dev-a
		currentScope = { status: 'available', dbName: 'db-b', deviceId: 'dev-b' };
		currentSnapshotText = 'snapshot from dev-b';
		await panel.loadAndRenderDiff('draft v4');
		expect(mockNativeSnapshotService.readSnapshotByKey).toHaveBeenCalledTimes(3);
		expect(panel.leftContent).toBe('snapshot from dev-b');

		// Scope changes to a DB where key 1 does not exist: must reject stale selection and show missing-ref
		currentScope = { status: 'available', dbName: 'db-empty', deviceId: 'dev-b' };
		currentMetaList = [];
		await panel.loadAndRenderDiff('draft v5');
		expect(mgr.getPanel(mockDoc)!.diffContainerEl.setText).toHaveBeenCalledWith('snapshot.missing-ref');

		mgr.destroy();
	});

});


interface NavigationProbe {
	diffContainerEl: HTMLElement;
	navigationTargets: HTMLElement[][];
	previousDiffBtnEl: HTMLButtonElement;
	nextDiffBtnEl: HTMLButtonElement;
	currentChangeIndex: number | null;
	navigationScrollTop: number | null;
	navigateDiff(direction: -1 | 1): void;
	updateNavigationButtons(): void;
	clearNavigation(): void;
}

function navigationProbe(points: number[]): NavigationProbe {
	const panel = Object.create(ChapterSnapshotPanel.prototype) as NavigationProbe;
	const container = {
		scrollTop: 0, scrollHeight: 4000, clientHeight: 400,
		getBoundingClientRect: () => ({ top: 100 }),
		querySelectorAll: () => [...rows, ...anchors].filter(el => el.hasClass('is-current-diff')),
		scrollTo: vi.fn((options: ScrollToOptions) => { container.scrollTop = options.top ?? container.scrollTop; })
	};
	const rows = points.map(() => new MockElement('wn-snapshot-row'));
	const anchors = points.map((point, index) => Object.assign(new MockElement('wn-diff-ins'), {
		tagName: 'INS', textContent: '改字',
		closest: (selector: string) => selector === 'details' ? null : rows[index],
		getClientRects: () => [{ top: 100 + point - container.scrollTop, height: 20 }],
		getBoundingClientRect: () => ({ top: 100, height: 2000 }),
		scrollIntoView: vi.fn()
	}));
	Object.assign(panel, {
		doc: {}, isDestroyed: false,
		diffContainerEl: container,
		navigationTargets: anchors.map(anchor => [anchor]),
		previousDiffBtnEl: { disabled: true }, nextDiffBtnEl: { disabled: true },
		currentChangeIndex: null, navigationScrollTop: null
	});
	return panel;
}

describe('snapshot diff navigation and compact display regressions', () => {
	it('highlights only the current edit and its row, moving the highlight on navigation and clearing it before refresh', () => {
		const panel = navigationProbe([120, 800]);
		const first = panel.navigationTargets[0][0];
		const second = panel.navigationTargets[1][0];
		const firstRow = first.closest('.wn-snapshot-row')!;
		const secondRow = second.closest('.wn-snapshot-row')!;
		panel.navigateDiff(1);
		expect(first.classList.contains('is-current-diff')).toBe(true);
		expect(firstRow.classList.contains('is-current-diff')).toBe(true);
		expect(firstRow.getAttribute('aria-current')).toBe('true');
		panel.navigateDiff(1);
		expect(first.classList.contains('is-current-diff')).toBe(false);
		expect(firstRow.classList.contains('is-current-diff')).toBe(false);
		expect(firstRow.getAttribute('aria-current')).toBeNull();
		expect(second.classList.contains('is-current-diff')).toBe(true);
		expect(secondRow.getAttribute('aria-current')).toBe('true');
		panel.clearNavigation();
		expect(second.classList.contains('is-current-diff')).toBe(false);
		expect(secondRow.classList.contains('is-current-diff')).toBe(false);
		expect(secondRow.getAttribute('aria-current')).toBeNull();
	});

	it('scrolls to the actual edit rather than the containing long paragraph', () => {
		const panel = navigationProbe([1800]);
		panel.navigateDiff(1);
		expect(panel.diffContainerEl.scrollTop).toBe(1788);
	});

	it('disables both directions without differences', () => {
		const panel = navigationProbe([]);
		panel.updateNavigationButtons();
		expect(panel.previousDiffBtnEl.disabled).toBe(true);
		expect(panel.nextDiffBtnEl.disabled).toBe(true);
	});

	it('targets the visible deletion when a replacement has an empty insertion', () => {
		const panel = navigationProbe([1800]);
		const deletion = panel.navigationTargets[0][0];
		Object.assign(deletion, { tagName: 'DEL' });
		panel.navigationTargets[0].unshift(Object.assign(new MockElement(), deletion, {
			tagName: 'INS', textContent: '', getClientRects: () => [{ top: 100 }]
		}) as unknown as HTMLElement);
		panel.navigateDiff(1);
		expect(panel.diffContainerEl.scrollTop).toBe(1788);
	});

	it('visits the first edit, stops at the final edit, and does not wrap', () => {
		const panel = navigationProbe([120, 800]);
		panel.updateNavigationButtons();
		expect(panel.previousDiffBtnEl.disabled).toBe(true);
		expect(panel.nextDiffBtnEl.disabled).toBe(false);
		panel.navigateDiff(1);
		expect(panel.diffContainerEl.scrollTop).toBe(108);
		expect(panel.previousDiffBtnEl.disabled).toBe(true);
		panel.navigateDiff(1);
		expect(panel.diffContainerEl.scrollTop).toBe(788);
		expect(panel.previousDiffBtnEl.disabled).toBe(false);
		expect(panel.nextDiffBtnEl.disabled).toBe(true);
		panel.navigateDiff(1);
		expect(panel.diffContainerEl.scrollTop).toBe(788);
		panel.navigateDiff(-1);
		expect(panel.diffContainerEl.scrollTop).toBe(108);
	});

	it('finds changes on both sides after a manual scroll between edits', () => {
		const panel = navigationProbe([120, 800]);
		panel.diffContainerEl.scrollTop = 400;
		panel.updateNavigationButtons();
		expect(panel.previousDiffBtnEl.disabled).toBe(false);
		expect(panel.nextDiffBtnEl.disabled).toBe(false);
		panel.navigateDiff(-1);
		expect(panel.diffContainerEl.scrollTop).toBe(108);
	});

	it('omits unchanged paragraphs when only differences are requested', () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { renderDiffRow(container: HTMLElement, row: import('../src/services/ChapterDiffEngine').AlignedDiffRow, targets: HTMLElement[][]): void };
		Object.assign(panel, { onlyDifferences: true, isPhonePortrait: false, doc: { createTextNode: (value: string) => Object.assign(new MockElement(), { textContent: value }) } });
		const container = new MockElement();
		panel.renderDiffRow(container as unknown as HTMLElement, { id: 1, type: 'unchanged', leftLines: ['相同段落'], rightLines: ['相同段落'] }, []);
		expect(container.children).toHaveLength(0);
	});

	it.each([
		['同一段正文。\r\n\r\n', '同一段正文。\n'],
		['　　同一段正文。  \n', '同一段正文。\n'],
		['\n\n', '']
	])('omits formatting-only changes from only-differences view: %j', (left, right) => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { renderDiffRow(container: HTMLElement, row: import('../src/services/ChapterDiffEngine').AlignedDiffRow, targets: HTMLElement[][]): void };
		Object.assign(panel, { onlyDifferences: true, isPhonePortrait: false, doc: { createTextNode: (value: string) => Object.assign(new MockElement(), { textContent: value }) } });
		const container = new MockElement();
		const targets: HTMLElement[][] = [];
		panel.renderDiffRow(container as unknown as HTMLElement, { id: 1, type: left.trim() ? 'modified' : 'deleted', leftLines: [left], rightLines: right ? [right] : [] }, targets);
		expect(container.children).toHaveLength(0);
		expect(targets).toHaveLength(0);
	});

	it('keeps paragraph splits visible even when only line breaks changed', () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { renderDiffRow(container: HTMLElement, row: import('../src/services/ChapterDiffEngine').AlignedDiffRow, targets: HTMLElement[][]): void };
		Object.assign(panel, { onlyDifferences: true, isPhonePortrait: false, doc: { createTextNode: (value: string) => Object.assign(new MockElement(), { textContent: value }) } });
		const container = new MockElement();
		panel.renderDiffRow(container as unknown as HTMLElement, { id: 1, type: 'split', leftLines: ['第一句。第二句。'], rightLines: ['第一句。\n', '第二句。'] }, []);
		expect(container.children).toHaveLength(1);
	});

	it('labels formatting-only rows as the same text in the full view without highlighting the whole paragraph', () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { renderDiffRow(container: HTMLElement, row: import('../src/services/ChapterDiffEngine').AlignedDiffRow, targets: HTMLElement[][]): void };
		Object.assign(panel, { onlyDifferences: false, isPhonePortrait: false });
		const container = new MockElement();
		panel.renderDiffRow(container as unknown as HTMLElement, { id: 1, type: 'modified', leftLines: ['正文。\r\n'], rightLines: ['正文。\n'] }, []);
		const cue = container.querySelector('.wn-snapshot-row-cue');
		expect(container.querySelector('.is-format-only')).not.toBeNull();
		expect(cue?.textContent).toBe('snapshot.whitespace-cue');
		expect(cue?.getAttribute('aria-label')).toBe('snapshot.whitespace-description');
		expect(container.querySelector('.wn-diff-del')).toBeNull();
		expect(container.querySelector('.wn-diff-ins')).toBeNull();
	});

	it('shows an explanation with disabled navigation when filtering leaves only formatting changes', async () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as {
			renderDiffDom(generation: number): Promise<void>;
			navigationTargets: HTMLElement[][];
		};
		const container = new MockElement();
		const previous = { disabled: false };
		const next = { disabled: false };
		Object.assign(panel, {
			win: { createDiv: () => new MockElement() },
			doc: { createTextNode: (value: string) => Object.assign(new MockElement(), { textContent: value }) },
			onlyDifferences: true, isPhonePortrait: false, diffGeneration: 1, isDestroyed: false,
			diffContainerEl: container, previousDiffBtnEl: previous, nextDiffBtnEl: next,
			diffResult: { hasDifferences: true, rows: [{ id: 1, type: 'modified', leftLines: ['正文。\r\n\r\n'], rightLines: ['正文。\n'] }] }
		});
		await panel.renderDiffDom(1);
		expect(container.querySelector('.wn-snapshot-empty-msg')).not.toBeNull();
		expect(panel.navigationTargets).toHaveLength(0);
		expect(previous.disabled).toBe(true);
		expect(next.disabled).toBe(true);
	});

	it('renders both removed and inserted Chinese text in one portrait column', () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { renderDiffRow(container: HTMLElement, row: import('../src/services/ChapterDiffEngine').AlignedDiffRow, targets: HTMLElement[][]): void };
		Object.assign(panel, { isPhonePortrait: true, onlyPhoneDifferences: true, doc: { createTextNode: (value: string) => Object.assign(new MockElement(), { textContent: value }) } });
		const container = new MockElement();
		panel.renderDiffRow(container as unknown as HTMLElement, { id: 1, type: 'modified', leftLines: ['他走了'], rightLines: ['他跑了'], charDiff: [{ value: '他' }, { value: '走', removed: true }, { value: '跑', added: true }, { value: '了' }] }, []);
		expect(container.querySelectorAll('.wn-snapshot-side-unified')).toHaveLength(1);
		expect(container.querySelector('.wn-diff-del')?.textContent).toBe('走');
		expect(container.querySelector('.wn-diff-ins')?.textContent).toBe('跑');
		expect(container.querySelector('.wn-snapshot-btn-expand-details')).toBeNull();
	});

	it('renders whole replacements directly without expand/collapse character detail button', () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { renderDiffRow(container: HTMLElement, row: import('../src/services/ChapterDiffEngine').AlignedDiffRow, targets: HTMLElement[][]): void };
		Object.assign(panel, { isPhonePortrait: false, onlyDifferences: false, doc: { createTextNode: (value: string) => Object.assign(new MockElement(), { textContent: value }) } });
		const container = new MockElement();
		panel.renderDiffRow(container as unknown as HTMLElement, { id: 1, type: 'modified', leftLines: ['整段旧内容。'], rightLines: ['整段新内容。'], exceedsLimit: true }, []);
		expect(container.querySelector('.wn-diff-del')?.textContent).toBe('整段旧内容。');
		expect(container.querySelector('.wn-diff-ins')?.textContent).toBe('整段新内容。');
		expect(container.querySelector('.wn-snapshot-btn-expand-details')).toBeNull();
	});
	it('opens collapsed YAML before positioning its changed line', () => {
		const panel = navigationProbe([500]);
		const details = { open: false, querySelector: () => ({ getClientRects: () => [{ top: 120 }] }) };
		Object.assign(panel.navigationTargets[0][0], { closest: (selector: string) => selector === 'details' ? details : null });
		panel.navigateDiff(1);
		expect(details.open).toBe(true);
		expect(panel.diffContainerEl.scrollTop).toBe(488);
	});

	it('keeps only the close action in the panel header', () => {
		const panel = Object.create(ChapterSnapshotPanel.prototype) as { buildHeader(): void };
		const root = new MockElement();
		const destroy = vi.fn();
		Object.assign(panel, { panelEl: root, chapterTitle: '测试章节', destroy });
		panel.buildHeader();
		const actions = root.querySelector('.wn-snapshot-header-actions')!;
		expect(actions.children).toHaveLength(1);
		const close = actions.children[0];
		expect(close.hasClass('wn-snapshot-btn-close')).toBe(true);
		expect(close.getAttribute('aria-label')).toBe('snapshot.action-close');
		(close.onclick as unknown as (event: { stopPropagation(): void }) => void)({ stopPropagation: vi.fn() });
		expect(destroy).toHaveBeenCalledOnce();
	});

	it('coalesces scroll updates per animation frame, reuses cached offsets without repeating Range/container geometry reads, invalidates on resize/YAML toggle, and cleans up RAF/ResizeObserver on destroy', () => {
		const points = Array.from({ length: 100 }, (_, idx) => (idx + 1) * 30);
		const panel = navigationProbe(points) as NavigationProbe & {
			win: Record<string, unknown>;
			boundDiffScroll: () => void;
			invalidateNavigationLayout?: () => void;
			onYamlToggle?: () => void;
			resizeObserver?: { disconnect: () => void } | null;
			destroy(): void;
			panelEl: HTMLElement;
			isDestroyed: boolean;
		};
		let containerRectCalls = 0;
		let targetRectCalls = 0;
		const origContainerRect = panel.diffContainerEl.getBoundingClientRect;
		panel.diffContainerEl.getBoundingClientRect = vi.fn(() => {
			containerRectCalls++;
			return origContainerRect();
		}) as unknown as typeof panel.diffContainerEl.getBoundingClientRect;
		Object.assign(panel.diffContainerEl, { removeEventListener: vi.fn() });

		for (const group of panel.navigationTargets) {
			const anchor = group[0];
			const origRects = anchor.getClientRects.bind(anchor);
			anchor.getClientRects = vi.fn(() => {
				targetRectCalls++;
				return origRects();
			}) as unknown as typeof anchor.getClientRects;
		}

		let rafCallback: FrameRequestCallback | null = null;
		const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
			rafCallback = cb;
			return 77;
		});
		const cancelAnimationFrame = vi.fn(() => {
			rafCallback = null;
		});
		const disconnectObserver = vi.fn();
		Object.assign(panel, {
			win: {
				requestAnimationFrame,
				cancelAnimationFrame,
				clearTimeout: vi.fn(),
				removeEventListener: vi.fn()
			},
			resizeObserver: { disconnect: disconnectObserver },
			app: { workspace: { offref: vi.fn() }, vault: { offref: vi.fn() } },
			doc: { removeEventListener: vi.fn(), body: { hasClass: () => false } },
			panelEl: { parentNode: null },
			onCloseCallback: vi.fn()
		});

		// Initial layout build on first navigation update at mid-scroll
		panel.diffContainerEl.scrollTop = 1500;
		panel.updateNavigationButtons();
		expect(containerRectCalls).toBe(1);
		expect(targetRectCalls).toBe(points.length);

		// Repeated scroll events in same frame coalesce and reuse cached offsets (0 geometry reads!)
		containerRectCalls = 0;
		targetRectCalls = 0;
		panel.diffContainerEl.scrollTop = 1800;
		if (typeof (panel as unknown as { onDiffScroll?: () => void }).onDiffScroll === 'function') {
			(panel as unknown as { onDiffScroll: () => void }).onDiffScroll();
			(panel as unknown as { onDiffScroll: () => void }).onDiffScroll();
		} else {
			panel.updateNavigationButtons();
		}
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
		if (rafCallback) (rafCallback as FrameRequestCallback)(16);
		expect(containerRectCalls).toBe(0);
		expect(targetRectCalls).toBe(0);

		// YAML details toggle invalidates and rebuilds offsets once, and destroy cancels pending RAF + disconnects ResizeObserver
		panel.onYamlToggle?.();
		expect(containerRectCalls).toBe(1);
		expect(targetRectCalls).toBe(points.length);

		if (typeof (panel as unknown as { onDiffScroll?: () => void }).onDiffScroll === 'function') {
			(panel as unknown as { onDiffScroll: () => void }).onDiffScroll();
		}
		panel.destroy();
		expect(cancelAnimationFrame).toHaveBeenCalledWith(77);
		expect(disconnectObserver).toHaveBeenCalledTimes(1);
	});

	it('advances to the next change group after navigateDiff auto-opens folded YAML and its toggle event fires asynchronously', () => {
		const panel = navigationProbe([120, 800]) as NavigationProbe & {
			onYamlToggle(): void;
		};
		const details = { open: false, querySelector: () => ({ getClientRects: () => [{ top: 120 }] }) };
		const firstTarget = panel.navigationTargets[0][0];
		const origClosest = firstTarget.closest.bind(firstTarget);
		Object.assign(firstTarget, {
			closest: (selector: string) => selector === 'details' ? details : origClosest(selector)
		});

		// 1. Navigate to first group inside folded YAML -> auto-opens details and scrolls to 108 (120 - 12)
		panel.navigateDiff(1);
		expect(details.open).toBe(true);
		expect(panel.diffContainerEl.scrollTop).toBe(108);
		expect(panel.navigationTargets[0][0].classList.contains('is-current-diff')).toBe(true);

		// 2. Browser delivers asynchronous <details> toggle event
		panel.onYamlToggle();

		// 3. Next click must advance to group 1 (800 -> scrollTop 788), NOT re-select group 0!
		panel.navigateDiff(1);
		expect(panel.diffContainerEl.scrollTop).toBe(788);
		expect(panel.navigationTargets[0][0].classList.contains('is-current-diff')).toBe(false);
		expect(panel.navigationTargets[1][0].classList.contains('is-current-diff')).toBe(true);
		expect(panel.nextDiffBtnEl.disabled).toBe(true);

		// 4. Manual scroll still derives from viewport and does not wrap at boundaries
		panel.diffContainerEl.scrollTop = 400;
		panel.navigateDiff(-1);
		expect(panel.diffContainerEl.scrollTop).toBe(108);
		expect(panel.previousDiffBtnEl.disabled).toBe(true);
		panel.navigateDiff(-1);
		expect(panel.diffContainerEl.scrollTop).toBe(108);
	});

	it('observes only owner-window ResizeObserver including current rendered content root (unobserving old root on swap) and invalidates cached offsets on css-change and font loadingdone', async () => {
		const observed: Element[] = [];
		const unobserved: Element[] = [];
		let resizeCallback: (() => void) | null = null;
		const disconnectSpy = vi.fn();
		class OwnerResizeObserver {
			constructor(cb: () => void) {
				resizeCallback = cb;
			}
			observe(el: Element) {
				observed.push(el);
			}
			unobserve(el: Element) {
				unobserved.push(el);
			}
			disconnect() {
				disconnectSpy();
			}
		}

		const globalResizeSpy = vi.fn();
		const origGlobalRO = (window as Window & { ResizeObserver?: unknown }).ResizeObserver;
		(window as Window & { ResizeObserver?: unknown }).ResizeObserver = globalResizeSpy;

		const workspaceHandlers = new Map<string, () => void>();
		const cssChangeRef = { id: 'css-ref' };
		const offrefSpy = vi.fn();
		const fontsAddSpy = vi.fn();
		const fontsRemoveSpy = vi.fn();

		const origSetTimeout = globalThis.setTimeout;
		const createMockEl = (tag = 'div'): HTMLElement => {
			const children: HTMLElement[] = [];
			const el: Record<string, unknown> = {
				tagName: tag.toUpperCase(),
				children,
				style: {},
				addClass: vi.fn(),
				removeClass: vi.fn(),
				toggleClass: vi.fn(),
				setCssProps: vi.fn(),
				setAttribute: vi.fn(),
				removeAttribute: vi.fn(),
				setText: vi.fn(),
				empty: vi.fn(() => {
					children.length = 0;
				}),
				createDiv: vi.fn(() => {
					const child = createMockEl('div');
					children.push(child);
					return child;
				}),
				createSpan: vi.fn(() => {
					const child = createMockEl('span');
					children.push(child);
					return child;
				}),
				createEl: vi.fn((childTag: string) => {
					const child = createMockEl(childTag);
					children.push(child);
					return child;
				}),
				appendChild: vi.fn((child: HTMLElement) => {
					children.push(child);
					return child;
				}),
				insertBefore: vi.fn(),
				removeChild: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				querySelector: vi.fn(() => null),
				querySelectorAll: vi.fn(() => []),
				closest: vi.fn(() => null),
				getClientRects: vi.fn(() => [{ top: 100, height: 20 }]),
				getBoundingClientRect: vi.fn(() => ({ top: 100, left: 100, width: 600, height: 400 }))
			};
			return el as unknown as HTMLElement;
		};

		const ownerWin: Record<string, unknown> = {
			createDiv: vi.fn(() => createMockEl('div')),
			innerWidth: 1200,
			innerHeight: 800,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			setTimeout: vi.fn(((cb: TimerHandler) => {
				if (typeof cb === 'function') return origSetTimeout(cb, 0);
				return 1;
			}) as typeof window.setTimeout),
			clearTimeout: vi.fn(),
			requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
				cb(16);
				return 1;
			}),
			cancelAnimationFrame: vi.fn()
		};
		const ownerDoc = {
			defaultView: ownerWin,
			createElement: vi.fn(() => createMockEl()),
			createTextNode: vi.fn((text: string) => Object.assign(new MockElement(), { textContent: text })),
			fonts: {
				addEventListener: fontsAddSpy,
				removeEventListener: fontsRemoveSpy
			},
			body: Object.assign(createMockEl(), {
				hasClass: () => false
			}),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as Document;

		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				on: vi.fn((name: string, cb: () => void) => {
					workspaceHandlers.set(name, cb);
					return name === 'css-change' ? cssChangeRef : {};
				}),
				offref: offrefSpy
			},
			vault: {
				on: vi.fn(() => ({})),
				offref: vi.fn(),
				read: vi.fn(async () => '新正文内容')
			}
		} as unknown as App;

		const nativeSvc = {
			getOrCreateDeviceId: vi.fn(() => 'd'),
			listSnapshotsForPath: vi.fn(async () => [{ key: 1, path: 'Book/Chapter1.md', ts: 1000 }]),
			readSnapshotByKey: vi.fn(async () => '旧正文内容'),
			checkStatus: vi.fn(() => ({ status: 'available' as const, dbName: 'b', deviceId: 'd' }))
		} as unknown as NativeSnapshotService;

		try {
			// 1. Without owner-window ResizeObserver, must NOT fall back to global window.ResizeObserver
			const noRoPanel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile: new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await noRoPanel.readyPromise;
			expect(globalResizeSpy).not.toHaveBeenCalled();
			noRoPanel.destroy();
			fontsAddSpy.mockClear();
			offrefSpy.mockClear();

			// 2. With owner-window ResizeObserver, observes panelEl, diffContainerEl, and rendered content root
			ownerWin.ResizeObserver = OwnerResizeObserver;
			const panel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile: new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await panel.readyPromise;

			const internal = panel as unknown as {
				changeOffsets: number[] | null;
				ensureChangeOffsets(): number[];
				renderPresentation(): Promise<void>;
				onYamlToggle(): void;
			};
			expect(observed).toContain(panel.panelEl);
			expect(observed).toContain(panel.diffContainerEl);
			const firstContentRoot = (panel.diffContainerEl as unknown as MockElement).children[0] as unknown as Element;
			expect(firstContentRoot).toBeDefined();
			expect(observed).toContain(firstContentRoot);

			// Re-render presentation swaps content root: unobserves old root and observes new root
			await internal.renderPresentation();
			const secondContentRoot = (panel.diffContainerEl as unknown as MockElement).children[0] as unknown as Element;
			expect(secondContentRoot).not.toBe(firstContentRoot);
			expect(unobserved).toContain(firstContentRoot);
			expect(observed).toContain(secondContentRoot);

			// ResizeObserver invalidates cached offsets
			internal.ensureChangeOffsets();
			expect(internal.changeOffsets).not.toBeNull();
			ownerWin.requestAnimationFrame = vi.fn(() => 2);
			resizeCallback!();
			expect(internal.changeOffsets).toBeNull();

			// workspace css-change invalidates cached offsets
			internal.ensureChangeOffsets();
			expect(internal.changeOffsets).not.toBeNull();
			const cssChangeHandler = workspaceHandlers.get('css-change');
			expect(cssChangeHandler).toBeTypeOf('function');
			cssChangeHandler!();
			expect(internal.changeOffsets).toBeNull();

			// ownerDocument.fonts loadingdone invalidates cached offsets
			internal.ensureChangeOffsets();
			expect(internal.changeOffsets).not.toBeNull();
			const fontDoneCall = fontsAddSpy.mock.calls.find(([event]) => event === 'loadingdone');
			expect(fontDoneCall).toBeDefined();
			const fontDoneHandler = fontDoneCall![1] as () => void;
			fontDoneHandler();
			expect(internal.changeOffsets).toBeNull();

			// YAML toggle invalidates cached offsets
			internal.ensureChangeOffsets();
			expect(internal.changeOffsets).not.toBeNull();
			vi.spyOn(panel as unknown as { updateNavigationButtons(): void }, 'updateNavigationButtons').mockImplementationOnce(() => {});
			internal.onYamlToggle();
			expect(internal.changeOffsets).toBeNull();

			// Destroy cleans up ResizeObserver, css-change EventRef, and fonts loadingdone listener
			panel.destroy();
			expect(unobserved).toContain(secondContentRoot);
			expect(disconnectSpy).toHaveBeenCalledTimes(1);
			expect(offrefSpy).toHaveBeenCalledWith(cssChangeRef);
			expect(fontsRemoveSpy).toHaveBeenCalledWith('loadingdone', fontDoneHandler);
		} finally {
			(window as Window & { ResizeObserver?: unknown }).ResizeObserver = origGlobalRO;
		}
	});

});
