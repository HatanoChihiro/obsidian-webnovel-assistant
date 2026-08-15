import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorTracker } from '../src/services/EditorTracker';
import { TFile } from './mocks/obsidian';

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

		expect(mockPlugin.lastEditTime).toBeGreaterThan(0);
		expect(mockPlugin.calculateAccurateWords).toHaveBeenCalledWith('这是测试网络小说第1章内容。');
		expect(mockApp.workspace.trigger).toHaveBeenCalledWith(
			'webnovel:editor-word-count-updated',
			testFile,
			5 // 15 - 10
		);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalledWith(testFile, 15, mockApp.vault);
		expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
	});

	it('should handle file change and sync words from cache', async () => {
		const tracker = new EditorTracker(mockApp, mockPlugin);
		await tracker.handleFileChange();

		expect(mockPlugin.lastFileWords).toBe(15);
		expect(mockPlugin.lastFilePath).toBe('Novel/第1章.md');
		expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
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
});
