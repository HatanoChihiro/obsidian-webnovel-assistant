import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorTracker } from '../src/services/EditorTracker';
import { TFile } from './mocks/obsidian';
import { t } from '../src/i18n';

describe('EditorTracker', () => {
	let mockApp: any;
	let mockPlugin: any;
	let mockView: any;
	let testFile: any;

	beforeEach(() => {
		testFile = new TFile('第1章.md', 'Novel/第1章.md');

		mockView = {
			file: testFile,
			getViewData: vi.fn().mockReturnValue('这是测试网络小说第1章内容。'),
		};

		mockApp = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(mockView),
				trigger: vi.fn()
			},
			vault: {
				cachedRead: vi.fn().mockResolvedValue('这是测试网络小说第1章内容。')
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null)
			}
		};

		const mockStatusBarEl = {
			setText: vi.fn()
		};

		mockPlugin = {
			app: mockApp,
			lastEditTime: 0,
			lastFilePath: 'Novel/第1章.md',
			lastFileWords: 10,
			sessionAddedWords: 5,
			isTracking: true,
			statusBarItemEl: mockStatusBarEl,
			settings: {
				showGoal: false,
				defaultGoal: 3000,
				showMobileFloatingStats: false,
				wordCountMethod: 'accurate'
			},
			cacheManager: {
				isEligibleForWordCount: vi.fn().mockReturnValue(true),
				isEligibleForTotalWordCount: vi.fn().mockReturnValue(true),
				isFileInStrictChapterException: vi.fn().mockReturnValue(false),
				getFileCache: vi.fn().mockReturnValue(15),
				updateFileCache: vi.fn()
			},
			calculateAccurateWords: vi.fn().mockReturnValue(15),
			refreshStatusViews: vi.fn(),
			mobileFloatingStats: {
				update: vi.fn()
			}
		};
	});

	it('should update word count and trigger workspace event on editor change', () => {
		const tracker = new EditorTracker(mockApp, mockPlugin);
		tracker.handleEditorChange();

		expect(mockPlugin.calculateAccurateWords).toHaveBeenCalledWith('这是测试网络小说第1章内容。');
		expect(mockPlugin.calculateAccurateWords).toHaveBeenCalledTimes(1);
		expect(mockApp.workspace.trigger).toHaveBeenCalledWith(
			'webnovel:editor-word-count-updated',
			testFile,
			5 // 15 - 10
		);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalledWith(testFile, 15, mockApp.vault);
		expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
		expect(mockPlugin.statusBarItemEl.setText).toHaveBeenCalledWith(
			t('common.status-bar-format', {
				state: t('status.tracking-active'),
				status: `${t('common.word-count-status', { count: '15', cnCount: '12' })} | ${t('common.net-increase', { count: '5' })}`
			})
		);
	});

	it('should handle file change and sync words from cache', async () => {
		const tracker = new EditorTracker(mockApp, mockPlugin);
		await tracker.handleFileChange();

		expect(mockPlugin.lastFileWords).toBe(15);
		expect(mockPlugin.lastFilePath).toBe('Novel/第1章.md');
		expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
	});

	it('captures the selected work before an uncached document finishes reading', async () => {
		let finishRead!: (content: string) => void;
		mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
		mockApp.vault.cachedRead.mockReturnValue(new Promise<string>(resolve => { finishRead = resolve; }));
		const pending = new EditorTracker(mockApp, mockPlugin).handleFileChange();
		const refreshedBeforeRead = mockPlugin.refreshStatusViews.mock.calls.length;
		mockApp.workspace.getActiveViewOfType.mockReturnValue(null);
		finishRead('章节内容');
		await pending;
		expect(refreshedBeforeRead).toBeGreaterThan(0);
	});

	it('should exclude an ineligible document from both total words and writing data', () => {
		testFile = new TFile('随笔.md', 'Novel/随笔.md');
		mockView.file = testFile;
		mockPlugin.lastFilePath = testFile.path;
		mockPlugin.cacheManager.isEligibleForWordCount.mockReturnValue(false);
		mockPlugin.cacheManager.isEligibleForTotalWordCount.mockReturnValue(false);
		const tracker = new EditorTracker(mockApp, mockPlugin);

		tracker.handleEditorChange();

		expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
		expect(mockApp.workspace.trigger).not.toHaveBeenCalled();
		expect(mockPlugin.lastFileWords).toBe(10);
		expect(mockPlugin.refreshStatusViews).not.toHaveBeenCalled();
		expect(mockPlugin.statusBarItemEl.setText).toHaveBeenCalled();
	});

	it('should record editor changes for any eligible file', () => {
		testFile = new TFile('序章.md', 'Novel/序章.md');
		mockView.file = testFile;
		mockPlugin.lastFilePath = testFile.path;
		mockPlugin.cacheManager.isEligibleForWordCount.mockReturnValue(true);
		mockPlugin.cacheManager.isEligibleForTotalWordCount.mockReturnValue(true);
		const tracker = new EditorTracker(mockApp, mockPlugin);

		tracker.handleEditorChange();

		expect(mockApp.workspace.trigger).toHaveBeenCalledWith(
			'webnovel:editor-word-count-updated',
			testFile,
			5
		);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalledWith(testFile, 15, mockApp.vault);
	});

	it('should reset lastFileWords to 0 when file is not eligible for word count', async () => {
		mockPlugin.cacheManager.isEligibleForWordCount.mockReturnValue(false);
		const tracker = new EditorTracker(mockApp, mockPlugin);
		await tracker.handleFileChange();

		expect(mockPlugin.lastFileWords).toBe(0);
	});

	it('should update status bar text accurately', () => {
		const tracker = new EditorTracker(mockApp, mockPlugin);
		tracker.updateWordCount();

		expect(mockPlugin.statusBarItemEl.setText).toHaveBeenCalled();
	});

	it('should clear status bar when active view is null', () => {
		mockApp.workspace.getActiveViewOfType.mockReturnValue(null);
		const tracker = new EditorTracker(mockApp, mockPlugin);
		tracker.updateWordCount();

		expect(mockPlugin.statusBarItemEl.setText).toHaveBeenCalledWith('');
	});

	it('should preserve the tracked chapter when a side panel has focus', async () => {
		mockApp.workspace.getActiveViewOfType.mockReturnValue(null);
		const tracker = new EditorTracker(mockApp, mockPlugin);

		await tracker.handleFileChange();

		expect(mockPlugin.lastFilePath).toBe('Novel/第1章.md');
		expect(mockPlugin.lastFileWords).toBe(10);
		expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
	});

	describe('In-flight cachedRead race conditions & stale baseline invalidation', () => {
		it('A=100 uncached, open B=1000 cached in same view, resolve A: B stays 1000 and next +1 records +1 (not +901)', async () => {
			const fileA = new TFile('A.md', 'Novel/A.md');
			const fileB = new TFile('B.md', 'Novel/B.md');

			let finishReadA!: (content: string) => void;
			mockApp.vault.cachedRead.mockImplementation((file: unknown) => {
				if ((file as TFile).path === 'Novel/A.md') {
					return new Promise<string>(resolve => { finishReadA = resolve; });
				}
				return Promise.resolve('');
			});

			mockPlugin.cacheManager.getFileCache.mockImplementation((path: string) => {
				if (path === 'Novel/A.md') return null; // A uncached
				if (path === 'Novel/B.md') return 1000; // B cached
				return null;
			});
			mockPlugin.calculateAccurateWords.mockImplementation((text: string) => text.length);

			const tracker = new EditorTracker(mockApp, mockPlugin);

			// 1. Open A in mockView
			mockView.file = fileA;
			mockView.getViewData.mockReturnValue('a'.repeat(100));
			const pendingA = tracker.handleFileChange();

			// 2. Open B in SAME view while A is in flight
			mockView.file = fileB;
			mockView.getViewData.mockReturnValue('b'.repeat(1000));
			await tracker.handleFileChange();

			expect(mockPlugin.lastFileWords).toBe(1000);
			expect(mockPlugin.lastFilePath).toBe('Novel/B.md');

			// 3. A's read finally resolves
			finishReadA('a'.repeat(100));
			await pendingA;

			// 4. B must still be 1000 and B's cache must NOT have been overwritten with 100
			expect(mockPlugin.lastFileWords).toBe(1000);
			expect(mockPlugin.lastFilePath).toBe('Novel/B.md');
			expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalledWith(fileB, 100, expect.anything());

			// 5. Next +1 character in B must record delta = +1, not +901
			mockView.getViewData.mockReturnValue('b'.repeat(1001));
			mockApp.workspace.trigger.mockClear();

			tracker.handleEditorChange();

			expect(mockApp.workspace.trigger).toHaveBeenCalledWith(
				'webnovel:editor-word-count-updated',
				fileB,
				1
			);
			expect(mockPlugin.lastFileWords).toBe(1001);
		});

		it('out-of-order different views: late read from prior view does not overwrite active view', async () => {
			const fileA = new TFile('A.md', 'Novel/A.md');
			const fileB = new TFile('B.md', 'Novel/B.md');

			let finishReadA!: (content: string) => void;
			mockApp.vault.cachedRead.mockImplementation((file: TFile) => {
				if (file.path === 'Novel/A.md') {
					return new Promise<string>(resolve => { finishReadA = resolve; });
				}
				if (file.path === 'Novel/B.md') {
					return Promise.resolve('b'.repeat(500));
				}
				return Promise.resolve('');
			});

			mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
			mockPlugin.calculateAccurateWords.mockImplementation((text: string) => text.length);

			const viewA = { file: fileA, getViewData: () => 'a'.repeat(200) };
			const viewB = { file: fileB, getViewData: () => 'b'.repeat(500) };

			const tracker = new EditorTracker(mockApp, mockPlugin);

			// Activate viewA
			mockApp.workspace.getActiveViewOfType.mockReturnValue(viewA);
			const pendingA = tracker.handleFileChange();

			// Switch to viewB
			mockApp.workspace.getActiveViewOfType.mockReturnValue(viewB);
			await tracker.handleFileChange();

			expect(mockPlugin.lastFileWords).toBe(500);
			expect(mockPlugin.lastFilePath).toBe('Novel/B.md');

			// Late read for A resolves
			finishReadA('a'.repeat(200));
			await pendingA;

			// In-flight A must NOT overwrite active B
			expect(mockPlugin.lastFileWords).toBe(500);
			expect(mockPlugin.lastFilePath).toBe('Novel/B.md');
		});

		it('same-file edits: typing in editor invalidates in-flight baseline read', async () => {
			const fileA = new TFile('A.md', 'Novel/A.md');
			let finishReadA!: (content: string) => void;
			mockApp.vault.cachedRead.mockImplementation(() => new Promise<string>(r => { finishReadA = r; }));
			mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
			mockPlugin.calculateAccurateWords.mockImplementation((text: string) => text.length);

			mockView.file = fileA;
			mockView.getViewData.mockReturnValue('initial');
			const tracker = new EditorTracker(mockApp, mockPlugin);

			const pendingA = tracker.handleFileChange();

			// User immediately types in editor while file read is still pending
			mockPlugin.lastFilePath = fileA.path;
			mockPlugin.lastFileWords = 7;
			mockView.getViewData.mockReturnValue('initial + edited');
			tracker.handleEditorChange();

			expect(mockPlugin.lastFileWords).toBe(16);

			// File read finishes later with older content
			finishReadA('initial');
			await pendingA;

			// Must not reset lastFileWords back to 7
			expect(mockPlugin.lastFileWords).toBe(16);
		});

		it('active view change during cachedRead prevents writing cache for previous file', async () => {
			const fileA = new TFile('A.md', 'Novel/A.md');
			const fileB = new TFile('B.md', 'Novel/B.md');

			let finishReadA!: (content: string) => void;
			mockApp.vault.cachedRead.mockImplementation((file: unknown) => {
				if ((file as TFile).path === 'Novel/A.md') {
					return new Promise<string>(resolve => { finishReadA = resolve; });
				}
				return Promise.resolve('');
			});

			mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
			mockPlugin.calculateAccurateWords.mockImplementation((text: string) => text.length);

			const viewA = { file: fileA, getViewData: () => 'a'.repeat(200) };
			const viewB = { file: fileB, getViewData: () => 'b'.repeat(500) };

			const tracker = new EditorTracker(mockApp, mockPlugin);

			mockApp.workspace.getActiveViewOfType.mockReturnValue(viewA);
			const pendingA = tracker.handleFileChange();

			// User switches to viewB
			mockApp.workspace.getActiveViewOfType.mockReturnValue(viewB);

			mockPlugin.cacheManager.updateFileCache.mockClear();
			finishReadA('a'.repeat(200));
			await pendingA;

			// Cache must NOT have been updated for fileA because view switched away before cache write!
			expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
		});

		it('mtime change during cachedRead invalidates cache write and baseline update', async () => {
			const fileA = new TFile('A.md', 'Novel/A.md');
			(fileA as unknown as { stat: { mtime: number } }).stat = { mtime: 1000 };

			let finishReadA!: (content: string) => void;
			mockApp.vault.cachedRead.mockImplementation(() => new Promise<string>(r => { finishReadA = r; }));
			mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
			mockPlugin.calculateAccurateWords.mockImplementation((text: string) => text.length);

			mockView.file = fileA;
			mockView.getViewData.mockReturnValue('initial');
			const tracker = new EditorTracker(mockApp, mockPlugin);

			const pendingA = tracker.handleFileChange();

			// File stat mtime changes while read is in flight
			(fileA as unknown as { stat: { mtime: number } }).stat = { mtime: 2000 };

			mockPlugin.cacheManager.updateFileCache.mockClear();
			finishReadA('initial');
			await pendingA;

			expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
		});

		it('renamed file during cachedRead aborts cache update for old path', async () => {
			const fileA = new TFile('A.md', 'Novel/A.md');

			let finishReadA!: (content: string) => void;
			mockApp.vault.cachedRead.mockImplementation(() => new Promise<string>(r => { finishReadA = r; }));
			mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
			mockPlugin.calculateAccurateWords.mockImplementation((text: string) => text.length);

			mockView.file = fileA;
			mockView.getViewData.mockReturnValue('initial');
			const tracker = new EditorTracker(mockApp, mockPlugin);

			const pendingA = tracker.handleFileChange();

			// File renamed while read is in flight
			fileA.path = 'Novel/A_renamed.md';

			mockPlugin.cacheManager.updateFileCache.mockClear();
			finishReadA('initial');
			await pendingA;

			expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
		});
	});
});
