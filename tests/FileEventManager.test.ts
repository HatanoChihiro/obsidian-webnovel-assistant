import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileEventManager } from '../src/services/FileEventManager';
import { TFile, TFolder } from './mocks/obsidian';

describe('FileEventManager', () => {
	let mockPlugin: any;
	let vaultEvents: Record<string, Function>;

	beforeEach(() => {
		vaultEvents = {};
		const metadataCacheEvents: Record<string, Function> = {};

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

		const mockMetadataCache = {
			on: vi.fn((eventName: string, handler: Function) => {
				metadataCacheEvents[eventName] = handler;
				return {};
			}),
			resolvedLinks: {},
			getFileCache: vi.fn().mockReturnValue(null)
		};

		mockPlugin = {
			app: {
				vault: mockVault,
				workspace: mockWorkspace,
				metadataCache: mockMetadataCache
			},
			registerEvent: vi.fn(),
			cacheManager: {
				isEligibleForWordCount: vi.fn().mockReturnValue(true),
				isEligibleForTotalWordCount: vi.fn().mockReturnValue(true),
				isFileInWorkspace: vi.fn().mockReturnValue(true),
				updateFileCache: vi.fn().mockReturnValue(100),
				getFileCache: vi.fn().mockReturnValue(50),
				invalidateCache: vi.fn(),
				updateCachePath: vi.fn(),
				getEntries: vi.fn().mockReturnValue([])
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
			writingJourneyService: {
				handleVaultCreate: vi.fn().mockResolvedValue(undefined),
				handleVaultDelete: vi.fn().mockResolvedValue(undefined),
				handleVaultRename: vi.fn().mockResolvedValue(undefined),
				initializeStartupBaseline: vi.fn(),
				checkInitialMetadataReadiness: vi.fn().mockReturnValue(false),
				markReady: vi.fn()
			},
			calculateAccurateWords: vi.fn().mockReturnValue(100),
			refreshFolderCounts: vi.fn(),
			updateFileCacheAndRefresh: vi.fn(),
			isLayoutReady: true,
			_metadataCacheEvents: metadataCacheEvents
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
		mockPlugin.cacheManager.isEligibleForTotalWordCount.mockReturnValue(false);
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
		expect(mockPlugin.app.workspace.trigger).not.toHaveBeenCalled();
	});

	it('should update cache without recording writing data for an external file modification', async () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const modifyHandler = vaultEvents['modify'];
		const testFile = new TFile('第1章.md', 'Novel/第1章.md');

		await modifyHandler(testFile);

		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalledWith(testFile, 100, mockPlugin.app.vault);
		expect(mockPlugin.refreshFolderCounts).toHaveBeenCalled();
		expect(mockPlugin.app.workspace.trigger).not.toHaveBeenCalled();
	});

	it('should invalidate cache without recording negative writing data for file deletion', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const deleteHandler = vaultEvents['delete'];
		const testFile = new TFile('chapter1.md', 'Novel/chapter1.md');

		deleteHandler(testFile);

		expect(mockPlugin.cacheManager.invalidateCache).toHaveBeenCalledWith('Novel/chapter1.md', mockPlugin.app.vault);
		expect(mockPlugin.refreshFolderCounts).toHaveBeenCalled();
		expect(mockPlugin.app.workspace.trigger).not.toHaveBeenCalled();
	});

	it('should handle file renaming and update cache', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const renameHandler = vaultEvents['rename'];
		const testFile = new TFile('new.md', 'Novel/new.md');

		renameHandler(testFile, 'Novel/old.md');

		expect(mockPlugin.cacheManager.invalidateCache).toHaveBeenCalledWith('Novel/old.md', mockPlugin.app.vault);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalledWith(testFile, 50, mockPlugin.app.vault);
		expect(mockPlugin.updateFileCacheAndRefresh).not.toHaveBeenCalled();
	});

	it('should refresh a renamed markdown file when no previous cache exists', () => {
		mockPlugin.cacheManager.getFileCache.mockReturnValue(null);
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const renameHandler = vaultEvents['rename'];
		const testFile = new TFile('new.md', 'Novel/new.md');

		renameHandler(testFile, 'Novel/old.md');

		expect(mockPlugin.updateFileCacheAndRefresh).toHaveBeenCalledWith(testFile);
	});

	it('should initialize writing journey startup baseline on setup', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		expect(mockPlugin.writingJourneyService.initializeStartupBaseline).toHaveBeenCalledTimes(1);
	});

	it('should mark writing journey ready immediately if initial metadata is already ready', () => {
		mockPlugin.writingJourneyService.checkInitialMetadataReadiness.mockReturnValue(true);
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		expect(mockPlugin.writingJourneyService.checkInitialMetadataReadiness).toHaveBeenCalledTimes(1);
		expect(mockPlugin.writingJourneyService.markReady).toHaveBeenCalledTimes(1);
	});

	it('should register metadataCache resolved listener and trigger markReady on resolved event', () => {
		mockPlugin.writingJourneyService.checkInitialMetadataReadiness.mockReturnValue(false);
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		expect(mockPlugin.app.metadataCache.on).toHaveBeenCalledWith('resolved', expect.any(Function));
		expect(mockPlugin.registerEvent).toHaveBeenCalled();

		// Trigger 'resolved' callback
		const resolvedHandler = mockPlugin._metadataCacheEvents['resolved'];
		expect(resolvedHandler).toBeDefined();
		resolvedHandler();

		expect(mockPlugin.writingJourneyService.markReady).toHaveBeenCalledTimes(1);
	});

	it('should forward folder delete to writingJourneyService', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const deleteHandler = vaultEvents['delete'];
		const folder = new TFolder('Vol1', 'Novel/Vol1');

		deleteHandler(folder);

		expect(mockPlugin.writingJourneyService.handleVaultDelete).toHaveBeenCalledWith(folder);
	});

	it('should forward folder rename to writingJourneyService', () => {
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const renameHandler = vaultEvents['rename'];
		const folder = new TFolder('Vol2', 'Novel/Vol2');

		renameHandler(folder, 'Novel/Vol1');

		expect(mockPlugin.writingJourneyService.handleVaultRename).toHaveBeenCalledWith(folder, 'Novel/Vol1');
	});
});
