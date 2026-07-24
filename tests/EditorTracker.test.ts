import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorTracker } from '../src/services/EditorTracker';
import { TFile } from './mocks/obsidian';

describe('EditorTracker', () => {
	let mockApp: any;
	let mockPlugin: any;
	let mockView: any;
	let testFile: any;

	beforeEach(() => {
		testFile = new TFile('chapter1.md', 'Novel/chapter1.md');

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
			lastFilePath: 'Novel/chapter1.md',
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
			'webnovel:file-word-count-updated',
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
		expect(mockPlugin.lastFilePath).toBe('Novel/chapter1.md');
		expect(mockPlugin.refreshStatusViews).toHaveBeenCalled();
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
});
