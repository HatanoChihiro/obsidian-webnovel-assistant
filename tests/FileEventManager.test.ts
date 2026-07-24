import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileEventManager } from '../src/services/FileEventManager';
import { TFile } from './mocks/obsidian';

describe('FileEventManager', () => {
	let mockPlugin: any;
	let vaultEvents: Record<string, Function>;

	beforeEach(() => {
		vaultEvents = {};

		const mockVault = {
			on: vi.fn((eventName: string, handler: Function) => {
				vaultEvents[eventName] = handler;
				return {};
			}),
			read: vi.fn().mockResolvedValue('测试内容 100 字'),
			cachedRead: vi.fn().mockResolvedValue('测试内容 100 字')
		};

		const mockWorkspace = {
			getActiveFile: vi.fn().mockReturnValue(null),
			trigger: vi.fn()
		};

		mockPlugin = {
			app: {
				vault: mockVault,
				workspace: mockWorkspace
			},
			registerEvent: vi.fn(),
			cacheManager: {
				isEligibleForWordCount: vi.fn().mockReturnValue(true),
				isFileInWorkspace: vi.fn().mockReturnValue(true),
				updateFileCache: vi.fn().mockReturnValue(100),
				getFileCache: vi.fn().mockReturnValue(50),
				invalidateCache: vi.fn(),
				updateCachePath: vi.fn()
			},
			stickyNoteManager: {
				getNotesFilePath: vi.fn().mockReturnValue('notes-data.json'),
				getIsWriting: vi.fn().mockReturnValue(false),
				loadNotes: vi.fn().mockResolvedValue(undefined),
				syncFloatingNotes: vi.fn()
			},
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((key: string, fn: Function) => fn())
			},
			calculateAccurateWords: vi.fn().mockReturnValue(100),
			refreshFolderCounts: vi.fn(),
			updateFileCacheAndRefresh: vi.fn(),
			isLayoutReady: true
		};
	});

	it('should register vault event handlers on setup', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('create', expect.any(Function));
		expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
		expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
		expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('rename', expect.any(Function));
	});

	it('should early-return on modify for non-eligible files', async () => {
		mockPlugin.cacheManager.isEligibleForWordCount.mockReturnValue(false);
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const modifyHandler = vaultEvents['modify'];
		const nonEligibleFile = new TFile('other.txt', 'other.txt');
		(nonEligibleFile as any).extension = 'txt';

		await modifyHandler(nonEligibleFile);
		expect(mockPlugin.app.vault.read).not.toHaveBeenCalled();
	});

	it('should handle file creation and update word count cache', async () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const createHandler = vaultEvents['create'];
		const testFile = new TFile('chapter1.md', 'Novel/chapter1.md');

		await createHandler(testFile);

		expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(testFile);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalled();
		expect(mockPlugin.refreshFolderCounts).toHaveBeenCalled();
	});

	it('should handle file deletion and invalidate cache', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const deleteHandler = vaultEvents['delete'];
		const testFile = new TFile('chapter1.md', 'Novel/chapter1.md');

		deleteHandler(testFile);

		expect(mockPlugin.cacheManager.invalidateCache).toHaveBeenCalledWith('Novel/chapter1.md', mockPlugin.app.vault);
		expect(mockPlugin.app.workspace.trigger).toHaveBeenCalledWith(
			'webnovel:file-word-count-updated',
			testFile,
			-50
		);
	});

	it('should handle file renaming and update cache', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const renameHandler = vaultEvents['rename'];
		const testFile = new TFile('new.md', 'Novel/new.md');

		renameHandler(testFile, 'Novel/old.md');

		expect(mockPlugin.cacheManager.invalidateCache).toHaveBeenCalledWith('Novel/old.md', mockPlugin.app.vault);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalledWith(testFile, 50, mockPlugin.app.vault);
	});
});
