import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile, MarkdownView } from 'obsidian';
import { ChapterSnapshotPanel } from '../src/ui/ChapterSnapshotPanel';
import { ChapterDiffEngine } from '../src/services/ChapterDiffEngine';
import { MockElement } from './mocks/MockElement';
import { ChapterSnapshotManager } from '../src/services/ChapterSnapshotManager';
import { ChapterSnapshotReplayController, getReplayTextChanges } from '../src/services/ChapterSnapshotReplayController';
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
					setAttribute: vi.fn(),
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

	describe('ChapterSnapshotReplayController & Panel Replay Mode', () => {
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

		let fakeTimers: {
			setTimeout: (fn: () => Promise<void> | void, ms: number) => number;
			clearTimeout: (id: number) => void;
			advanceBy: (ms: number) => Promise<void>;
			activeCount: () => number;
		};

		beforeEach(() => {
			let timerId = 0;
			const tasks = new Map<number, { fn: () => Promise<void> | void; triggerAt: number }>();
			let currentTime = 0;

			fakeTimers = {
				setTimeout: (fn: () => Promise<void> | void, ms: number) => {
					const id = ++timerId;
					tasks.set(id, { fn, triggerAt: currentTime + ms });
					return id;
				},
				clearTimeout: (id: number) => {
					tasks.delete(id);
				},
				advanceBy: async (ms: number) => {
					const targetTime = currentTime + ms;
					while (true) {
						const due = Array.from(tasks.entries())
							.filter(([, t]) => t.triggerAt <= targetTime)
							.sort((a, b) => a[1].triggerAt - b[1].triggerAt);
						if (due.length === 0) break;
						const [id, t] = due[0];
						tasks.delete(id);
						currentTime = t.triggerAt;
						await t.fn();
					}
					currentTime = targetTime;
				},
				activeCount: () => tasks.size
			};
		});

		it('orders loaded snapshots oldest first with deterministic key tie-break and starts at nonzero first body', async () => {
			const snapshots = [
				{ key: 10, path: 'Fictional/Chapter.md', ts: 2000 },
				{ key: 3, path: 'Fictional/Chapter.md', ts: 1000 },
				{ key: 7, path: 'Fictional/Chapter.md', ts: 2000 }
			];
			const textMap: Record<number, string> = {
				3: '第一版正文内容',
				7: '第二版正文修改',
				10: '第三版正文终稿'
			};
			const readCalls: number[] = [];
			const nativeSvc = {
				checkStatus: vi.fn(() => ({ status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' })),
				readSnapshotByKey: vi.fn(async (key: number) => {
					readCalls.push(key);
					return textMap[key] ?? '';
				})
			} as unknown as NativeSnapshotService;

			const frames: Array<{ index: number; mode: string; text: string; metaKey: number }> = [];
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots,
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: (frame) => {
					frames.push({ index: frame.index, mode: frame.mode, text: frame.text, metaKey: frame.meta.key });
				},
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});

			await controller.startReplay();

			// Sorted oldest first: key 3 (1000), key 7 (2000), key 10 (2000, key 7 < 10)
			expect(controller.snapshots.map(s => s.key)).toEqual([3, 7, 10]);
			expect(controller.currentIndex).toBe(0);
			expect(controller.isPlaying).toBe(false);
			expect(frames.length).toBe(1);
			expect(frames[0]).toEqual({
				index: 0,
				mode: 'first',
				text: '第一版正文内容',
				metaKey: 3
			});
			expect(readCalls).toEqual([3]);

			controller.destroy();
		});

		it('advances playback frame-by-frame, auto-stops at last frame, and restarts from first when played at end', async () => {
			const snapshots = [
				{ key: 1, path: 'Fictional/Chapter.md', ts: 1000 },
				{ key: 2, path: 'Fictional/Chapter.md', ts: 2000 },
				{ key: 3, path: 'Fictional/Chapter.md', ts: 3000 }
			];
			const textMap: Record<number, string> = {
				1: '初始文本内容',
				2: '初始文本修改后内容',
				3: '初始文本修改后内容已完成'
			};
			const nativeSvc = {
				checkStatus: vi.fn(() => ({ status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' })),
				readSnapshotByKey: vi.fn(async (key: number) => textMap[key] ?? '')
			} as unknown as NativeSnapshotService;

			const frameModes: string[] = [];
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots,
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: (frame) => {
					frameModes.push(`${frame.index}:${frame.mode}`);
				},
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});

			await controller.startReplay();
			expect(controller.currentIndex).toBe(0);

			await controller.play();
			expect(controller.isPlaying).toBe(true);

			// Tick 1 (2500ms interval): reaches frame 1 transition
			await fakeTimers.advanceBy(2500);
			expect(controller.currentIndex).toBe(1);

			// Next tick (2000ms highlight + 500ms remaining): reaches frame 2 transition
			await fakeTimers.advanceBy(2500);
			expect(controller.currentIndex).toBe(2);

			// Settle of last frame completes, auto-stops
			await fakeTimers.advanceBy(2000);
			expect(controller.isPlaying).toBe(false);

			// Verify all frames actually transitioned AND settled
			expect(frameModes).toEqual([
				'0:first',
				'1:transition',
				'1:settled',
				'2:transition',
				'2:settled'
			]);

			// Playing from last frame restarts from frame 0
			await controller.play();
			expect(controller.isPlaying).toBe(true);
			expect(controller.currentIndex).toBe(0);

			// Pausing preserves highlights for inspection without advancing or settling.
			await fakeTimers.advanceBy(2500); // reaches frame 1 transition
			expect(controller.currentIndex).toBe(1);
			controller.pause();
			expect(controller.isPlaying).toBe(false);
			await fakeTimers.advanceBy(5000);
			expect(controller.isPlaying).toBe(false);
			expect(frameModes.at(-1)).toBe('1:transition');

			// Speed change adjusts interval and timer scheduling
			controller.setSpeed(3);
			expect(controller.speed).toBe(3);
			await controller.play();
			expect(controller.isPlaying).toBe(true);
			// At speed 3, interval is 833ms: reaches frame 2 transition
			await fakeTimers.advanceBy(832);
			expect(controller.currentIndex).toBe(1);
			await fakeTimers.advanceBy(1);
			expect(controller.currentIndex).toBe(2);

			controller.destroy();
		});

		it('pauses playback on stepping or scrubber seeking, and updates speed', async () => {
			const snapshots = [
				{ key: 1, path: 'Fictional/Chapter.md', ts: 1000 },
				{ key: 2, path: 'Fictional/Chapter.md', ts: 2000 },
				{ key: 3, path: 'Fictional/Chapter.md', ts: 3000 }
			];
			const nativeSvc = {
				checkStatus: vi.fn(() => ({ status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' })),
				readSnapshotByKey: vi.fn(async (key: number) => `段落内容 ${key}`)
			} as unknown as NativeSnapshotService;

			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots,
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: vi.fn(),
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});

			await controller.startReplay();
			await controller.play();
			expect(controller.isPlaying).toBe(true);

			// Stepping pauses
			await controller.step(1);
			expect(controller.isPlaying).toBe(false);
			expect(controller.currentIndex).toBe(1);

			// Resume play, then seek pauses
			await controller.play();
			expect(controller.isPlaying).toBe(true);
			await controller.seek(0);
			expect(controller.isPlaying).toBe(false);
			expect(controller.currentIndex).toBe(0);

			// Speed change
			controller.setSpeed(5);
			expect(controller.speed).toBe(5);
			await controller.play();
			await fakeTimers.advanceBy(499);
			expect(controller.currentIndex).toBe(0);
			await fakeTimers.advanceBy(1);
			expect(controller.currentIndex).toBe(1);
			controller.pause();
			controller.setSpeed(1);
			expect(controller.speed).toBe(1);

			controller.destroy();
		});

		it('disallows playback on single snapshot and handles empty snapshot list gracefully', async () => {
			const nativeSvc = {
				checkStatus: vi.fn(() => ({ status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' })),
				readSnapshotByKey: vi.fn(async () => '独一版本内容')
			} as unknown as NativeSnapshotService;

			// Single snapshot
			const singleController = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots: [{ key: 1, path: 'Fictional/Chapter.md', ts: 1000 }],
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: vi.fn(),
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});
			await singleController.startReplay();
			expect(singleController.currentIndex).toBe(0);
			const canPlay = await singleController.play();
			expect(canPlay).toBe(false);
			expect(singleController.isPlaying).toBe(false);
			singleController.destroy();

			// Empty list
			const emptyController = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots: [],
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: vi.fn(),
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});
			await emptyController.startReplay();
			expect(emptyController.currentIndex).toBe(-1);
			expect(await emptyController.play()).toBe(false);
			emptyController.destroy();
		});

		it('bounds plaintext cache to at most two adjacent snapshots in memory', async () => {
			const snapshots = [
				{ key: 1, path: 'Fictional/Chapter.md', ts: 1000 },
				{ key: 2, path: 'Fictional/Chapter.md', ts: 2000 },
				{ key: 3, path: 'Fictional/Chapter.md', ts: 3000 },
				{ key: 4, path: 'Fictional/Chapter.md', ts: 4000 }
			];
			const nativeSvc = {
				checkStatus: vi.fn(() => ({ status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' })),
				readSnapshotByKey: vi.fn(async (key: number) => `正文段落版本 ${key}`)
			} as unknown as NativeSnapshotService;

			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots,
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: vi.fn(),
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});

			await controller.startReplay();
			expect(controller.getCacheSize()).toBeLessThanOrEqual(2);

			await controller.step(1);
			expect(controller.getCacheSize()).toBeLessThanOrEqual(2);

			await controller.step(1);
			expect(controller.getCacheSize()).toBeLessThanOrEqual(2);

			await controller.seek(0);
			expect(controller.getCacheSize()).toBeLessThanOrEqual(2);

			controller.destroy();
			expect(controller.getCacheSize()).toBe(0);
		});

		it('cancels stale reads on rapid scrubber seeking and only displays latest generation', async () => {
			const snapshots = [
				{ key: 1, path: 'Fictional/Chapter.md', ts: 1000 },
				{ key: 2, path: 'Fictional/Chapter.md', ts: 2000 },
				{ key: 3, path: 'Fictional/Chapter.md', ts: 3000 }
			];
			const delays: Record<number, number> = { 1: 50, 2: 10, 3: 5 };
			const nativeSvc = {
				checkStatus: vi.fn(() => ({ status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' })),
				readSnapshotByKey: vi.fn(async (key: number) => {
					await new Promise(r => setTimeout(r, delays[key] ?? 5));
					return `延迟正文 ${key}`;
				})
			} as unknown as NativeSnapshotService;

			const renderedKeys: number[] = [];
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots,
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: (frame) => {
					renderedKeys.push(frame.meta.key);
				},
				onStateChange: vi.fn(),
				onError: vi.fn(),
				timerWindow: fakeTimers
			});

			await controller.startReplay();
			renderedKeys.length = 0;

			// Rapid seeks
			const p1 = controller.seek(1);
			const p2 = controller.seek(2);
			const p0 = controller.seek(0);
			await Promise.all([p1, p2, p0]);

			// Only the final seek (index 0, key 1) should be rendered last
			expect(renderedKeys[renderedKeys.length - 1]).toBe(1);
			expect(controller.currentIndex).toBe(0);

			controller.destroy();
		});

		it('stops playback and fires localized error on device/db scope mismatch or read error', async () => {
			const snapshots = [
				{ key: 1, path: 'Fictional/Chapter.md', ts: 1000 },
				{ key: 2, path: 'Fictional/Chapter.md', ts: 2000 }
			];
			let callCount = 0;
			const nativeSvc = {
				checkStatus: vi.fn(() => {
					callCount++;
					if (callCount > 2) {
						return { status: 'available' as const, deviceId: 'foreign-dev', dbName: 'db-1' };
					}
					return { status: 'available' as const, deviceId: 'dev-1', dbName: 'db-1' };
				}),
				readSnapshotByKey: vi.fn(async (key: number) => `正文内容 ${key}`)
			} as unknown as NativeSnapshotService;

			const errors: string[] = [];
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: nativeSvc,
				snapshots,
				getScopeList: () => ({ deviceId: 'dev-1', dbName: 'db-1' }),
				onFrame: vi.fn(),
				onStateChange: vi.fn(),
				onError: (err) => errors.push(err),
				timerWindow: fakeTimers
			});

			await controller.startReplay();
			expect(controller.currentIndex).toBe(0);

			await controller.step(1);
			expect(errors.length).toBeGreaterThan(0);
			expect(controller.isPlaying).toBe(false);

			controller.destroy();
		});

		it('coalesces rapid seeks without concurrent snapshot reads', async () => {
			let active = 0;
			let peak = 0;
			let releaseRead: (() => void) | undefined;
			const blocked = new Promise<void>(resolve => { releaseRead = resolve; });
			const svc = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => {
					active++;
					peak = Math.max(peak, active);
					if (key === 3) await blocked;
					active--;
					return `Fictional paragraph ${key}`;
				}
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: svc,
				snapshots: [1, 2, 3, 4].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers
			});
			await controller.startReplay();
			const first = controller.seek(2);
			const second = controller.seek(3);
			const last = controller.seek(1);
			releaseRead?.();
			await Promise.all([first, second, last]);
			controller.destroy();
			expect(peak).toBe(1);
		});

		it('does not resume after pause during an asynchronous restart from the end', async () => {
			let blockRestart = false;
			let releaseRead: (() => void) | undefined;
			const blocked = new Promise<void>(resolve => { releaseRead = resolve; });
			const svc = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => {
					if (blockRestart && key === 1) await blocked;
					return `Fictional paragraph ${key}`;
				}
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: svc,
				snapshots: [1, 2, 3].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers
			});
			await controller.startReplay();
			await controller.seek(2);
			blockRestart = true;
			const restarting = controller.play();
			controller.pause();
			releaseRead?.();
			await restarting;
			const playing = controller.isPlaying;
			const timers = fakeTimers.activeCount();
			controller.destroy();
			expect(playing).toBe(false);
			expect(timers).toBe(0);
		});

		it('keeps playback stopped when restarting from the end fails', async () => {
			let fail = false;
			const svc = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => {
					if (fail && key === 1) throw new Error('snapshot.missing-ref');
					return `Fictional paragraph ${key}`;
				}
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: svc,
				snapshots: [1, 2, 3].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers
			});
			await controller.startReplay();
			await controller.seek(2);
			fail = true;
			const started = await controller.play();
			const playing = controller.isPlaying;
			const timers = fakeTimers.activeCount();
			controller.destroy();
			expect(started).toBe(false);
			expect(playing).toBe(false);
			expect(timers).toBe(0);
		});

		it('rejects a changed database scope before reading snapshot data', async () => {
			const read = vi.fn(async () => 'Fictional paragraph');
			const svc = {
				checkStatus: () => ({ status: 'available', deviceId: 'foreign', dbName: 'b' }),
				readSnapshotByKey: read
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: svc,
				snapshots: [{ key: 1, ts: 1000, path: 'Sample/Part.md' }],
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers
			});
			await controller.startReplay();
			const error = controller.error;
			controller.destroy();
			expect(error).toBeTruthy();
			expect(read).not.toHaveBeenCalled();
		});

		it('keeps transition highlights when paused during its asynchronous read', async () => {
			let releaseRead: (() => void) | undefined;
			const blocked = new Promise<void>(resolve => { releaseRead = resolve; });
			const modes: string[] = [];
			const svc = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => {
					if (key === 2) await blocked;
					return `Fictional paragraph ${key}`;
				}
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: svc,
				snapshots: [1, 2, 3].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers,
				onFrame: frame => { modes.push(frame.mode); }
			});
			await controller.startReplay();
			await controller.play();
			const tick = fakeTimers.advanceBy(2500);
			controller.pause();
			releaseRead?.();
			await tick;
			await fakeTimers.advanceBy(5000);
			expect(modes.at(-1)).toBe('transition');
			expect(controller.isPlaying).toBe(false);
			expect(controller.currentIndex).toBe(1);
			expect(fakeTimers.activeCount()).toBe(0);
			controller.destroy();
		});

		it('clears a prior error after successfully seeking to a readable version', async () => {
			const svc = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => {
					if (key === 2) throw new Error('expired');
					return `Fictional paragraph ${key}`;
				}
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: svc,
				snapshots: [1, 2, 3, 4].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers
			});
			await controller.startReplay();
			await controller.seek(1);
			expect(controller.error).toBeTruthy();
			await controller.seek(3);
			expect(controller.error).toBeNull();
			controller.destroy();
		});

		it('integrates with ChapterSnapshotPanel: enters replay, suppresses editor refreshes, and restores comparison on exit', async () => {
			const ownerDoc = {
				defaultView: {
					createDiv: vi.fn(() => createMockEl('div')),
					innerWidth: 1200,
					innerHeight: 800,
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					setTimeout: vi.fn((cb: () => void) => { cb(); return 1; }),
					clearTimeout: vi.fn()
				},
				createElement: vi.fn(() => createMockEl()),
				createTextNode: vi.fn((text: string) => Object.assign(new MockElement(), { textContent: text })),
				body: Object.assign(createMockEl(), { hasClass: () => false }),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			} as unknown as Document;

			const nativeSvc = {
				getOrCreateDeviceId: vi.fn(() => 'd'),
				listSnapshotsForPath: vi.fn(async () => [
					{ key: 1, path: 'Book/Chapter1.md', ts: 1000 },
					{ key: 2, path: 'Book/Chapter1.md', ts: 2000 }
				]),
				readSnapshotByKey: vi.fn(async (key: number) => `历史内容 ${key}`),
				checkStatus: vi.fn(() => ({ status: 'available' as const, dbName: 'b', deviceId: 'd' }))
			} as unknown as NativeSnapshotService;

			let editorChangeHandler: ((e: unknown, info: unknown) => void) | null = null;
			const app = {
				workspace: {
					getLeavesOfType: vi.fn(() => []),
					on: vi.fn((name: string, cb: (...args: unknown[]) => void) => {
						if (name === 'editor-change') editorChangeHandler = cb;
						return {};
					}),
					offref: vi.fn()
				},
				vault: {
					on: vi.fn(() => ({})),
					offref: vi.fn(),
					read: vi.fn(async () => '当前草稿内容')
				}
			} as unknown as App;

			const chapterFile = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
			const panel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await panel.readyPromise;

			const panelInternal = panel as unknown as {
				isReplayActive: boolean;
				enterReplayMode(): Promise<void>;
				exitReplayMode(): Promise<void>;
				replayController: ChapterSnapshotReplayController | null;
				loadAndRenderDiff: () => Promise<void>;
				editorDebounceTimer: number | null;
			};

			const diffSpy = vi.spyOn(panelInternal, 'loadAndRenderDiff');

			// Enter replay mode
			await panelInternal.enterReplayMode();
			expect(panelInternal.isReplayActive).toBe(true);
			expect(panelInternal.replayController).not.toBeNull();

			// Editor change while in replay mode should NOT schedule refresh
			diffSpy.mockClear();
			(editorChangeHandler as ((e: unknown, info: unknown) => void) | null)?.({}, { file: chapterFile });
			expect(panelInternal.editorDebounceTimer).toBeNull();
			expect(diffSpy).not.toHaveBeenCalled();

			// Exit replay mode restores comparison
			await panelInternal.exitReplayMode();
			expect(panelInternal.isReplayActive).toBe(false);
			expect(panelInternal.replayController).toBeNull();
			expect(diffSpy).toHaveBeenCalled();

			panel.destroy();
		});

		it('preserves replay scroll position when transition highlights settle', async () => {
			const container = Object.assign(createMockEl(), { scrollTop: 120 });
			container.empty = () => { container.scrollTop = 0; };
			const panel = Object.create(ChapterSnapshotPanel.prototype) as {
				onReplayFrame(frame: import('../src/services/ChapterSnapshotReplayController').ReplayFrameData): Promise<void>;
			};
			Object.assign(panel, {
				isReplayActive: true, isDestroyed: false, renderGeneration: 0,
				diffContainerEl: container, clearNavigation: vi.fn(), updateObservedContentRoot: vi.fn(),
				doc: { createElement: () => createMockEl(), createTextNode: (text: string) => ({ textContent: text }) }
			});
			await panel.onReplayFrame({
				index: 1, total: 2, meta: { key: 2, ts: 2000, path: 'Sample/Part.md' },
				mode: 'settled', text: 'Fictional paragraph', cancellationToken: { isCancelled: false }
			});
			expect(container.scrollTop).toBe(120);
		});

		it('compares a scrubbed version against its chronological predecessor and keeps paused highlights visible', async () => {
			const frames: import('../src/services/ChapterSnapshotReplayController').ReplayFrameData[] = [];
			const service = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => `Sample paragraph ${key}`
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: service,
				snapshots: [1, 2, 3, 4].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers,
				onFrame: frame => { frames.push(frame); }
			});
			await controller.startReplay();
			await controller.seek(3);
			const selected = frames.at(-1);
			await fakeTimers.advanceBy(10000);
			const held = frames.at(-1);
			await controller.step(-1);
			const backward = frames.at(-1);
			controller.destroy();
			expect(selected?.mode).toBe('transition');
			expect(selected?.previousMeta?.key).toBe(3);
			expect(held).toBe(selected);
			expect(backward?.meta.key).toBe(3);
			expect(backward?.previousMeta?.key).toBe(2);
		});

		it('keeps automatic transition changes visible long enough to inspect them', async () => {
			const modes: string[] = [];
			const service = {
				checkStatus: () => ({ status: 'available', deviceId: 'd', dbName: 'b' }),
				readSnapshotByKey: async (key: number) => `Sample paragraph ${key}`
			} as unknown as NativeSnapshotService;
			const controller = new ChapterSnapshotReplayController({
				nativeSnapshotService: service,
				snapshots: [1, 2, 3].map(key => ({ key, ts: key * 1000, path: 'Sample/Part.md' })),
				getScopeList: () => ({ deviceId: 'd', dbName: 'b' }), timerWindow: fakeTimers,
				onFrame: frame => { modes.push(frame.mode); }
			});
			await controller.startReplay();
			await controller.play();
			await fakeTimers.advanceBy(2500);
			const selectedIndex = controller.currentIndex;
			const firstTransition = modes.at(-1);
			await fakeTimers.advanceBy(600);
			const mode = modes.at(-1);
			controller.destroy();
			expect(selectedIndex).toBe(1);
			expect(firstTransition).toBe('transition');
			expect(mode).toBe('transition');
		});

		it('preserves the literal body line breaks without extra spacing in replay presentation', async () => {
			const container = Object.assign(new MockElement(), { scrollTop: 0 });
			const panel = Object.create(ChapterSnapshotPanel.prototype) as {
				onReplayFrame(frame: import('../src/services/ChapterSnapshotReplayController').ReplayFrameData): Promise<void>;
			};
			Object.assign(panel, {
				isReplayActive: true, isDestroyed: false, renderGeneration: 0,
				diffContainerEl: container, clearNavigation: vi.fn(), updateObservedContentRoot: vi.fn(),
				doc: { createElement: () => new MockElement(), createTextNode: (text: string) => Object.assign(new MockElement(), { textContent: text }) }
			});
			const body = 'First sample paragraph.\n\nSecond sample paragraph.\n';
			await panel.onReplayFrame({
				index: 0, total: 1, meta: { key: 1, ts: 1000, path: 'Sample/Part.md' },
				mode: 'first', text: '---\nstatus: draft\n---\n' + body, cancellationToken: { isCancelled: false }
			});
			const text = (node: MockElement): string => node.textContent + node.children.map(text).join('');
			expect(text(container)).toBe(body);
		});

		it('reconstructs the selected body exactly from replay chunks after paragraph and whitespace changes', async () => {
			const pairs = [
				['Opening.\n\n', 'Opening.\n\nNew paragraph.\n'],
				['Opening.\n\nDiscarded paragraph.\n\nEnd.', 'Opening.\n\nEnd.'],
				['Line one.\r\n\r\nLine two.', 'Line one.\r\nLine two.'],
				['示例甲😀\n\n示例乙。', '示例甲😀\n\n示例丙。']
			];
			for (const [left, right] of pairs) {
				const result = await ChapterDiffEngine.computeDiff(left, right);
				const chunks = getReplayTextChanges(result);
				expect(chunks.filter(chunk => !chunk.removed).map(chunk => chunk.value).join('')).toBe(right);
			}
		});

		it.each(['deletion', 'replacement'] as const)('keeps the surviving reading anchor stable after a large %s, including manual scrolling', async kind => {
			const prefix = 'Opening.\n\n';
			const removed = 'Discarded sample paragraph. '.repeat(100) + '\n\n';
			const inserted = kind === 'replacement' ? 'Revised sample paragraph.\n\n' : '';
			const ending = 'Surviving ending.';
			const body = prefix + inserted + ending;
			const container = Object.assign(new MockElement(), { scrollTop: 0, getBoundingClientRect: () => ({ top: 100 }) });
			const rangeStarts: Array<{ value: string; offset: number }> = [];
			const panel = Object.create(ChapterSnapshotPanel.prototype) as {
				onReplayFrame(frame: import('../src/services/ChapterSnapshotReplayController').ReplayFrameData): Promise<void>;
			};
			Object.assign(panel, {
				isReplayActive: true, isDestroyed: false, renderGeneration: 0,
				diffContainerEl: container, clearNavigation: vi.fn(), updateObservedContentRoot: vi.fn(),
				doc: {
					createElement: () => new MockElement(),
					createTextNode: (text: string) => Object.assign(new MockElement(), { textContent: text }),
					createRange: () => {
						let measuredText = '';
						return {
							setStart: (node: Text, offset: number) => { measuredText = node.textContent ?? ''; rangeStarts.push({ value: measuredText, offset }); },
							setEnd: vi.fn(),
							getClientRects: () => [{ top: 100 + (measuredText === body ? 2200 : 3800) - container.scrollTop, height: 20 }]
						};
					}
				}
			});
			const frame: import('../src/services/ChapterSnapshotReplayController').ReplayFrameData = {
				index: 1, total: 2, meta: { key: 2, ts: 2000, path: 'Sample/Part.md' },
				mode: 'transition', text: body, cancellationToken: { isCancelled: false },
				diffResult: { hasDifferences: true, rows: [
					{ id: 1, type: 'unchanged', leftLines: [prefix], rightLines: [prefix] },
					{ id: 2, type: kind === 'replacement' ? 'modified' : 'deleted', leftLines: [removed], rightLines: inserted ? [inserted] : [] },
					{ id: 3, type: 'unchanged', leftLines: [ending], rightLines: [ending] }
				] }
			};
			await panel.onReplayFrame(frame);
			expect(container.scrollTop).toBe(3760);
			expect(rangeStarts[0].value).toBe(inserted || removed);
			container.scrollTop -= 80;
			const beforeOffset = 100 + 3800 - container.scrollTop;
			await panel.onReplayFrame({ ...frame, mode: 'settled', diffResult: undefined });
			expect(100 + 2200 - container.scrollTop).toBe(beforeOffset);
			expect(container.scrollTop).toBe(2080);
			expect(rangeStarts.at(-1)).toEqual({ value: body, offset: prefix.length });
		});

		it('strips YAML, preserves blank lines, and renders empty placeholder when body is empty in whole body replay', async () => {
			const textNodes: string[] = [];
			const ownerDoc = {
				defaultView: {
					createDiv: vi.fn(() => createMockEl('div')),
					innerWidth: 1200,
					innerHeight: 800,
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					setTimeout: vi.fn((cb: () => void) => { cb(); return 1; }),
					clearTimeout: vi.fn()
				},
				createElement: vi.fn(() => createMockEl()),
				createTextNode: vi.fn((text: string) => {
					textNodes.push(text);
					return Object.assign(new MockElement(), { textContent: text });
				}),
				body: Object.assign(createMockEl(), { hasClass: () => false }),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			} as unknown as Document;

			const nativeSvc = {
				getOrCreateDeviceId: vi.fn(() => 'd'),
				listSnapshotsForPath: vi.fn(async () => [
					{ key: 1, path: 'Book/Chapter1.md', ts: 1000 }
				]),
				readSnapshotByKey: vi.fn(async () => '---\ntitle: Sample\n---\n第一行正文\n\n第三行正文'),
				checkStatus: vi.fn(() => ({ status: 'available' as const, dbName: 'b', deviceId: 'd' }))
			} as unknown as NativeSnapshotService;

			const app = {
				workspace: { getLeavesOfType: vi.fn(() => []), on: vi.fn(() => ({})), offref: vi.fn() },
				vault: { on: vi.fn(() => ({})), offref: vi.fn(), read: vi.fn(async () => '') }
			} as unknown as App;

			const chapterFile = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
			const panel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await panel.readyPromise;

			const panelInternal = panel as unknown as {
				enterReplayMode(): Promise<void>;
				onReplayFrame(frame: unknown): Promise<void>;
				diffContainerEl: { empty: () => void; appendChild: (c: unknown) => void };
			};

			await panelInternal.enterReplayMode();

			// Preserve the source newline sequence, without per-line placeholders.
			expect(textNodes.join('')).toBe('第一行正文\n\n第三行正文');
			expect(textNodes.some(t => t.includes('title: Sample'))).toBe(false);

			// Test empty body placeholder
			textNodes.length = 0;
			await panelInternal.onReplayFrame({
				index: 0,
				total: 1,
				meta: { key: 1, path: 'Book/Chapter1.md', ts: 1000 },
				mode: 'settled',
				text: '---\ntitle: Only Header\n---\n   \n',
				cancellationToken: { isCancelled: false }
			});
			expect(textNodes.length).toBe(0);

			panel.destroy();
		});

		it('clears comparison plaintext on replay entry and avoids comparison refresh on orientation change, delete, and rebind', async () => {
			let vaultDeleteHandler: ((file: unknown) => void) | undefined;
			let compStartHandler: ((e: unknown) => void) | undefined;
			let compEndHandler: ((e: unknown) => void) | undefined;

			const ownerDoc = {
				defaultView: {
					createDiv: vi.fn(() => createMockEl('div')),
					innerWidth: 1200,
					innerHeight: 800,
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					setTimeout: vi.fn((cb: () => void) => { cb(); return 1; }),
					clearTimeout: vi.fn()
				},
				createElement: vi.fn(() => createMockEl()),
				createTextNode: vi.fn((text: string) => Object.assign(new MockElement(), { textContent: text })),
				body: Object.assign(createMockEl(), { hasClass: () => false }),
				addEventListener: vi.fn((event: string, cb: (e: unknown) => void) => {
					if (event === 'compositionstart') compStartHandler = cb;
					if (event === 'compositionend') compEndHandler = cb;
				}),
				removeEventListener: vi.fn()
			} as unknown as Document;

			const nativeSvc = {
				getOrCreateDeviceId: vi.fn(() => 'd'),
				listSnapshotsForPath: vi.fn(async () => [
					{ key: 1, path: 'Book/Chapter1.md', ts: 1000 },
					{ key: 2, path: 'Book/Chapter1.md', ts: 2000 }
				]),
				readSnapshotByKey: vi.fn(async (key: number) => `历史内容 ${key}`),
				checkStatus: vi.fn(() => ({ status: 'available' as const, dbName: 'b', deviceId: 'd' }))
			} as unknown as NativeSnapshotService;

			const app = {
				workspace: { getLeavesOfType: vi.fn(() => []), on: vi.fn(() => ({})), offref: vi.fn() },
				vault: {
					on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
						if (event === 'delete') vaultDeleteHandler = cb;
						return {};
					}),
					offref: vi.fn(),
					read: vi.fn(async () => '当前正文')
				}
			} as unknown as App;

			const chapterFile = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
			const panel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await panel.readyPromise;

			const panelInternal = panel as unknown as {
				leftContent: string;
				rightContent: string;
				diffResult: unknown;
				isReplayActive: boolean;
				enterReplayMode(): Promise<void>;
				exitReplayMode(options?: { restoreComparison?: boolean }): Promise<void>;
				updatePresentationMode(): void;
				loadAndRenderDiff(): Promise<void>;
				rebindChapter(file: TFile | null, path: string, title: string): Promise<void>;
			};

			panelInternal.leftContent = '基准文本';
			panelInternal.rightContent = '对比文本';
			panelInternal.diffResult = { rows: [] };

			const diffSpy = vi.spyOn(panelInternal, 'loadAndRenderDiff');

			// Entering replay clears plaintext memory
			await panelInternal.enterReplayMode();
			expect(panelInternal.leftContent).toBe('');
			expect(panelInternal.rightContent).toBe('');
			expect(panelInternal.diffResult).toBeNull();
			diffSpy.mockClear();

			// Orientation change / presentation update in replay does not render comparison
			panelInternal.updatePresentationMode();
			expect(diffSpy).not.toHaveBeenCalled();

			// Composition events in replay do not schedule editor refresh
			(compStartHandler as ((e: unknown) => void) | undefined)?.({ target: null });
			(compEndHandler as ((e: unknown) => void) | undefined)?.({ target: null });
			expect(diffSpy).not.toHaveBeenCalled();

			// Vault delete during replay preserves replay without loading deleted comparison
			(vaultDeleteHandler as ((file: unknown) => void) | undefined)?.(chapterFile);
			expect(panelInternal.isReplayActive).toBe(true);
			expect(diffSpy).not.toHaveBeenCalled();

			// Rebind stops replay without refreshing old chapter comparison
			const newFile = new MockTFile('Chapter2.md', 'Book/Chapter2.md') as unknown as TFile;
			await panelInternal.rebindChapter(newFile, 'Book/Chapter2.md', 'Chapter2');
			expect(panelInternal.isReplayActive).toBe(false);

			panel.destroy();
		});

		it('does not append a replay frame whose token is already cancelled', async () => {
			const ownerDoc = {
				defaultView: {
					createDiv: vi.fn(() => createMockEl('div')),
					innerWidth: 1200,
					innerHeight: 800,
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					setTimeout: vi.fn((cb: () => void) => { cb(); return 1; }),
					clearTimeout: vi.fn()
				},
				createElement: vi.fn(() => createMockEl()),
				createTextNode: vi.fn((text: string) => Object.assign(new MockElement(), { textContent: text })),
				body: Object.assign(createMockEl(), { hasClass: () => false }),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			} as unknown as Document;

			const nativeSvc = {
				getOrCreateDeviceId: vi.fn(() => 'd'),
				listSnapshotsForPath: vi.fn(async () => [{ key: 1, path: 'Book/Chapter1.md', ts: 1000 }]),
				readSnapshotByKey: vi.fn(async () => '历史正文'),
				checkStatus: vi.fn(() => ({ status: 'available' as const, dbName: 'b', deviceId: 'd' }))
			} as unknown as NativeSnapshotService;

			const app = {
				workspace: { getLeavesOfType: vi.fn(() => []), on: vi.fn(() => ({})), offref: vi.fn() },
				vault: { on: vi.fn(() => ({})), offref: vi.fn(), read: vi.fn(async () => '') }
			} as unknown as App;

			const chapterFile = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
			const panel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await panel.readyPromise;

			const panelInternal = panel as unknown as {
				enterReplayMode(): Promise<void>;
				onReplayFrame(frame: unknown): Promise<void>;
				diffContainerEl: { empty: () => void; appendChild: (c: unknown) => void };
			};

			await panelInternal.enterReplayMode();

			const appendSpy = vi.spyOn(panelInternal.diffContainerEl, 'appendChild');
			appendSpy.mockClear();

			// Cancelled token before commit prevents appendChild
			await panelInternal.onReplayFrame({
				index: 0,
				total: 1,
				meta: { key: 1, path: 'Book/Chapter1.md', ts: 1000 },
				mode: 'settled',
				text: 'Stale chunk content',
				cancellationToken: { isCancelled: true }
			});
			expect(appendSpy).not.toHaveBeenCalled();

			panel.destroy();
		});

		it('configures accessible attributes on range, speed buttons, and initial button state', async () => {
			const ownerDoc = {
				defaultView: {
					createDiv: vi.fn(() => createMockEl('div')),
					innerWidth: 1200,
					innerHeight: 800,
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					setTimeout: vi.fn((cb: () => void) => { cb(); return 1; }),
					clearTimeout: vi.fn()
				},
				createElement: vi.fn(() => createMockEl()),
				createTextNode: vi.fn((text: string) => Object.assign(new MockElement(), { textContent: text })),
				body: Object.assign(createMockEl(), { hasClass: () => false }),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			} as unknown as Document;

			const nativeSvc = {
				getOrCreateDeviceId: vi.fn(() => 'd'),
				listSnapshotsForPath: vi.fn(async () => []),
				checkStatus: vi.fn(() => ({ status: 'available' as const, dbName: 'b', deviceId: 'd' }))
			} as unknown as NativeSnapshotService;

			const app = {
				workspace: { getLeavesOfType: vi.fn(() => []), on: vi.fn(() => ({})), offref: vi.fn() },
				vault: { on: vi.fn(() => ({})), offref: vi.fn(), read: vi.fn(async () => '') }
			} as unknown as App;

			const chapterFile = new MockTFile('Chapter1.md', 'Book/Chapter1.md') as unknown as TFile;
			const panel = new ChapterSnapshotPanel({
				app,
				nativeSnapshotService: nativeSvc,
				ownerDocument: ownerDoc,
				chapterFile,
				chapterPath: 'Book/Chapter1.md',
				chapterTitle: 'Chapter1',
				onClose: vi.fn()
			});
			await panel.readyPromise;

			const panelInternal = panel as unknown as {
				replayScrubberEl: { setAttribute: (k: string, v: string) => void };
				replaySpeedBtns: Array<{ setAttribute: (k: string, v: string) => void }>;
				replayEntryBtnEl: { disabled: boolean };
			};

			// Replay entry is disabled when list is empty
			expect(panelInternal.replayEntryBtnEl.disabled).toBe(true);
			expect(panelInternal.replayScrubberEl.setAttribute).toHaveBeenCalledWith('aria-label', 'snapshot.replay-position');
			panelInternal.replaySpeedBtns.forEach((button, index) => {
				expect(button.setAttribute).toHaveBeenCalledWith('aria-pressed', String(index === 0));
				expect(button.setAttribute).toHaveBeenCalledWith('aria-label', `${[1, 3, 5][index]}x snapshot.replay-speed`);
			});

			panel.destroy();
		});
	});
});
