import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileEventManager } from '../src/services/FileEventManager';
import { TFile, TFolder } from './mocks/obsidian';

describe('FileEventManager', () => {
	let mockPlugin: any;
	let vaultEvents: Record<string, Function>;

	beforeEach(() => {
		vi.useFakeTimers();
		vaultEvents = {};
		const metadataCacheEvents: Record<string, Function> = {};
		const vaultFiles: Record<string, TFile> = {};
		const layoutReadyCallbacks: Array<() => void> = [];

		const mockVault = {
			on: vi.fn((eventName: string, handler: Function) => {
				vaultEvents[eventName] = handler;
				return {};
			}),
			read: vi.fn().mockResolvedValue('测试内容 100 字'),
			cachedRead: vi.fn().mockResolvedValue('测试内容 100 字'),
			getAbstractFileByPath: vi.fn((path: string) => vaultFiles[path] ?? null)
		};

		const mockWorkspace = {
			getActiveFile: vi.fn().mockReturnValue(null),
			trigger: vi.fn(),
			layoutReady: true,
			onLayoutReady: vi.fn((cb: () => void) => {
				layoutReadyCallbacks.push(cb);
			})
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
				isFileCacheCurrent: vi.fn().mockReturnValue(false),
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
			settings: { showExplorerCounts: true },
			_layoutReadyCallbacks: layoutReadyCallbacks,
			_vaultFiles: vaultFiles,
			_metadataCacheEvents: metadataCacheEvents
		};
	});

	afterEach(() => vi.useRealTimers());

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

	it('produces zero immediate reads for pre-layout eligible creates', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const createHandler = vaultEvents['create'];
		const testFile = new TFile('chapter1.md', 'Novel/chapter1.md');
		mockPlugin._vaultFiles[testFile.path] = testFile;

		await createHandler(testFile);

		expect(mockPlugin.app.vault.read).not.toHaveBeenCalled();
	});

	it('does not read files after readiness when 100 replayed files already match current cache', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		mockPlugin.cacheManager.isFileCacheCurrent.mockReturnValue(true);
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const createHandler = vaultEvents['create'];
		for (let i = 0; i < 100; i++) {
			const file = new TFile(`ch${i}.md`, `Novel/ch${i}.md`);
			mockPlugin._vaultFiles[file.path] = file;
			await createHandler(file);
		}

		expect(mockPlugin.app.vault.read).not.toHaveBeenCalled();

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();

		expect(mockPlugin.app.vault.read).not.toHaveBeenCalled();
	});

	it('reads only stale or missing files during drain after layout readiness', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const fileFresh = new TFile('fresh.md', 'Novel/fresh.md');
		const fileStale = new TFile('stale.md', 'Novel/stale.md');
		mockPlugin._vaultFiles[fileFresh.path] = fileFresh;
		mockPlugin._vaultFiles[fileStale.path] = fileStale;

		mockPlugin.cacheManager.isFileCacheCurrent.mockImplementation((f: TFile) => f.path === fileFresh.path);

		const createHandler = vaultEvents['create'];
		await createHandler(fileFresh);
		await createHandler(fileStale);

		expect(mockPlugin.app.vault.read).not.toHaveBeenCalled();

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();

		expect(mockPlugin.app.vault.read).toHaveBeenCalledTimes(1);
		expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(fileStale);
	});

	it('coalesces repeated pre-layout creates for the same file path', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const testFile = new TFile('chapter1.md', 'Novel/chapter1.md');
		mockPlugin._vaultFiles[testFile.path] = testFile;

		const createHandler = vaultEvents['create'];
		for (let i = 0; i < 5; i++) {
			await createHandler(testFile);
		}

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();

		expect(mockPlugin.app.vault.read).toHaveBeenCalledTimes(1);
	});

	it('counts pre-layout files even if showExplorerCounts is false', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		mockPlugin.settings.showExplorerCounts = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const testFile = new TFile('chapter1.md', 'Novel/chapter1.md');
		mockPlugin._vaultFiles[testFile.path] = testFile;

		const createHandler = vaultEvents['create'];
		await createHandler(testFile);

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();

		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalled();
	});

	it('preserves normal post-ready create behavior with immediate read', async () => {
		mockPlugin.app.workspace.layoutReady = true;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const testFile = new TFile('post.md', 'Novel/post.md');
		mockPlugin._vaultFiles[testFile.path] = testFile;

		const createHandler = vaultEvents['create'];
		await createHandler(testFile);

		expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(testFile);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalled();
	});

	it('drains properly without losing files when layout becomes ready during writingJourney await', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		mockPlugin.writingJourneyService.handleVaultCreate.mockImplementation(async () => {
			mockPlugin.app.workspace.layoutReady = true;
			for (const cb of mockPlugin._layoutReadyCallbacks) {
				cb();
			}
		});

		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const testFile = new TFile('transition.md', 'Novel/transition.md');
		mockPlugin._vaultFiles[testFile.path] = testFile;

		const createHandler = vaultEvents['create'];
		await createHandler(testFile);

		await vi.runAllTimersAsync();

		expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(testFile);
		expect(mockPlugin.cacheManager.updateFileCache).toHaveBeenCalled();
	});

	it('guards against deleted, replaced, or renamed files and respects unload before or during drain', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const createHandler = vaultEvents['create'];
		const deleteHandler = vaultEvents['delete'];
		const renameHandler = vaultEvents['rename'];

		const deletedFile = new TFile('del.md', 'Novel/del.md');
		const replacedFile = new TFile('rep.md', 'Novel/rep.md');
		const renamedFile = new TFile('old.md', 'Novel/old.md');
		const newRenamedFile = new TFile('new.md', 'Novel/new.md');

		mockPlugin._vaultFiles[deletedFile.path] = deletedFile;
		mockPlugin._vaultFiles[replacedFile.path] = replacedFile;
		mockPlugin._vaultFiles[renamedFile.path] = renamedFile;

		await createHandler(deletedFile);
		await createHandler(replacedFile);
		await createHandler(renamedFile);

		// 1. Delete deletedFile
		delete mockPlugin._vaultFiles[deletedFile.path];
		deleteHandler(deletedFile);

		// 2. Replace replacedFile with different TFile instance
		mockPlugin._vaultFiles[replacedFile.path] = new TFile('rep.md', 'Novel/rep.md');

		// 3. Rename renamedFile
		delete mockPlugin._vaultFiles[renamedFile.path];
		mockPlugin._vaultFiles[newRenamedFile.path] = newRenamedFile;
		renameHandler(newRenamedFile, renamedFile.path);

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();

		expect(mockPlugin.app.vault.read).not.toHaveBeenCalledWith(deletedFile);
		expect(mockPlugin.app.vault.read).not.toHaveBeenCalledWith(replacedFile);
		expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(newRenamedFile);

		// 4. Test unload before drain
		mockPlugin.app.vault.read.mockClear();
		mockPlugin.app.workspace.layoutReady = false;
		const fileUnload = new TFile('unload.md', 'Novel/unload.md');
		mockPlugin._vaultFiles[fileUnload.path] = fileUnload;
		await createHandler(fileUnload);

		await manager.destroy();

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();
		expect(mockPlugin.app.vault.read).not.toHaveBeenCalled();
	});

	it('rejects stale startup read result when superseded by newer editing/cache changes', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();

		const testFile = new TFile('stale_read.md', 'Novel/stale_read.md');
		testFile.stat = { mtime: 1000 };
		mockPlugin._vaultFiles[testFile.path] = testFile;

		// Slow read simulation
		mockPlugin.app.vault.read.mockImplementation(async () => {
			testFile.stat = { mtime: 2000 };
			return 'old slow content';
		});

		const createHandler = vaultEvents['create'];
		await createHandler(testFile);

		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) {
			cb();
		}
		await vi.runAllTimersAsync();

		expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
	});

	it('preserves an editor cache update made during a slow startup read before the file is saved', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();
		const file = new TFile('draft.md', 'Novel/draft.md');
		file.stat = { mtime: 1000 };
		mockPlugin._vaultFiles[file.path] = file;
		mockPlugin.app.vault.read.mockImplementation(async () => {
			// EditorTracker updates the cache before autosave changes mtime.
			mockPlugin.cacheManager.isFileCacheCurrent.mockReturnValue(true);
			return 'old disk content';
		});
		await vaultEvents['create'](file);
		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) cb();
		await vi.runAllTimersAsync();
		expect(mockPlugin.app.vault.read).toHaveBeenCalledTimes(1);
		expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
		await manager.destroy();
	});

	it('waits for an in-flight startup read on destroy and discards its result', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();
		const file = new TFile('pending.md', 'Novel/pending.md');
		mockPlugin._vaultFiles[file.path] = file;
		let resolveRead!: (content: string) => void;
		mockPlugin.app.vault.read.mockReturnValue(new Promise<string>(resolve => { resolveRead = resolve; }));
		await vaultEvents['create'](file);
		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) cb();
		await vi.advanceTimersToNextTimerAsync();
		expect(mockPlugin.app.vault.read).toHaveBeenCalledTimes(1);
		let finished = false;
		const cleanup = manager.destroy().then(() => { finished = true; });
		await Promise.resolve();
		expect(finished).toBe(false);
		resolveRead('old content');
		await cleanup;
		expect(mockPlugin.cacheManager.updateFileCache).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cancels a batch yield during destroy without leaving a timer or hanging cleanup', async () => {
		mockPlugin.app.workspace.layoutReady = false;
		const manager = new FileEventManager(mockPlugin);
		manager.setup();
		for (let i = 0; i < 26; i++) {
			const file = new TFile(`ch${i}.md`, `Novel/ch${i}.md`);
			mockPlugin._vaultFiles[file.path] = file;
			await vaultEvents['create'](file);
		}
		mockPlugin.app.workspace.layoutReady = true;
		for (const cb of mockPlugin._layoutReadyCallbacks) cb();
		let completeBatch!: () => void;
		const batchComplete = new Promise<void>(resolve => { completeBatch = resolve; });
		let counted = 0;
		mockPlugin.calculateAccurateWords.mockImplementation(() => {
			if (++counted === 25) completeBatch();
			return 100;
		});
		vi.advanceTimersToNextTimer();
		await batchComplete;
		expect(mockPlugin.app.vault.read).toHaveBeenCalledTimes(25);
		const cleanup = manager.destroy();
		expect(vi.getTimerCount()).toBe(0);
		await cleanup;
		expect(mockPlugin.app.vault.read).toHaveBeenCalledTimes(25);
	});
});
