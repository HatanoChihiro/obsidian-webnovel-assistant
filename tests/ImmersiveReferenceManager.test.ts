import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { ImmersiveReferenceManager, type ImmersiveReferenceManagerPlugin } from '../src/services/ImmersiveReferenceManager';
import { DEFAULT_SETTINGS } from '../src/constants';

vi.mock('obsidian', () => {
	class MockTFolder {
		path: string;
		name: string;
		parent: MockTFolder | null = null;
		constructor(path = '', name = '') {
			this.path = path;
			this.name = name;
		}
		isRoot(): boolean {
			return this.path === '/' || this.path === '';
		}
	}
	class MockTFile {
		path: string;
		name: string;
		extension = 'md';
		parent: MockTFolder | null = null;
		constructor(path = '', name = '') {
			this.path = path;
			this.name = name;
		}
	}
	return {
		TFile: MockTFile,
		TFolder: MockTFolder,
		Notice: vi.fn()
	};
});

describe('ImmersiveReferenceManager - Work-Isolated Memory & Persistence', () => {
	let mockApp: App;
	let mockPlugin: ImmersiveReferenceManagerPlugin;
	let registeredVaultEvents: Record<string, ((...args: unknown[]) => void)[]> = {};
	let offrefSpy: ReturnType<typeof vi.fn>;
	let saveSettingsSpy: ReturnType<typeof vi.fn>;
	let flushSpy: ReturnType<typeof vi.fn>;
	let vaultFiles: Map<string, unknown>;

	const folders = new Map<string, unknown>();

	const getOrCreateFolder = (path: string): TFolder => {
		if (folders.has(path)) return folders.get(path) as TFolder;
		const name = path.split('/').pop() || path;
		const folder = new (TFolder as unknown as new (path: string, name: string) => TFolder)(path, name);
		folders.set(path, folder);
		vaultFiles.set(path, folder);
		const parentPath = path.substring(0, path.lastIndexOf('/'));
		if (parentPath) {
			(folder as unknown as { parent: TFolder }).parent = getOrCreateFolder(parentPath);
		} else {
			(folder as unknown as { parent: TFolder }).parent = new (TFolder as unknown as new (path: string, name: string) => TFolder)('', '');
		}
		return folder;
	};

	const createTestFile = (path: string): TFile => {
		const name = path.split('/').pop() || path;
		const file = new (TFile as unknown as new (path: string, name: string) => TFile)(path, name);
		const parentPath = path.substring(0, path.lastIndexOf('/'));
		if (parentPath) {
			(file as unknown as { parent: TFolder }).parent = getOrCreateFolder(parentPath);
		}
		vaultFiles.set(path, file);
		return file;
	};

	const setupBookLandmark = (bookPath: string) => {
		const lorePath = `${bookPath}/设定`;
		getOrCreateFolder(lorePath);
	};

	beforeEach(() => {
		registeredVaultEvents = {};
		vaultFiles = new Map();
		folders.clear();
		offrefSpy = vi.fn();
		saveSettingsSpy = vi.fn().mockResolvedValue(undefined);
		flushSpy = vi.fn().mockResolvedValue(undefined);

		setupBookLandmark('Novels/BookA');
		setupBookLandmark('Novels/BookB');
		setupBookLandmark('Novels/Book');
		setupBookLandmark('Novels/BookTwo');

		mockApp = {
			vault: {
				on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
					if (!registeredVaultEvents[event]) {
						registeredVaultEvents[event] = [];
					}
					registeredVaultEvents[event].push(handler);
					return { event, handler };
				}),
				offref: offrefSpy,
				getAbstractFileByPath: vi.fn((path: string) => vaultFiles.get(path) ?? null)
			}
		} as unknown as App;

		mockPlugin = {
			settings: {
				...DEFAULT_SETTINGS,
				workspaceFolders: ['Novels/BookA', 'Novels/BookB', 'Novels/BookTwo'],
				immersive: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.immersive))
			},
			saveSettings: saveSettingsSpy,
			settingsManager: {
				flush: flushSpy
			}
		};
	});

	it('A) Context Isolation: preserves reference memory independently across works', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		const chapterA = createTestFile('Novels/BookA/Chapter1.md');
		const chapterB = createTestFile('Novels/BookB/Chapter1.md');
		const refCrossWork = createTestFile('Novels/BookB/LoreReference.md');
		const refWorkB = createTestFile('Novels/BookB/Outline.md');

		// 1. Main editor file in BookA, user sets reference pointing to a file in BookB
		const workA = manager.getWorkPath(chapterA);
		expect(workA).toBe('Novels/BookA');

		await manager.setReferenceFilePath(workA, refCrossWork.path);
		expect(saveSettingsSpy).toHaveBeenCalledTimes(1);
		expect(flushSpy).toHaveBeenCalledTimes(1);

		// Reference is stored for BookA
		expect(manager.getReferenceFilePath(workA)).toBe('Novels/BookB/LoreReference.md');

		// 2. Main editor switches to BookB
		const workB = manager.getWorkPath(chapterB);
		expect(workB).toBe('Novels/BookB');

		// BookB does not have a reference yet -> yields null (isolated!)
		expect(manager.getReferenceFilePath(workB)).toBeNull();

		// User sets reference for BookB
		await manager.setReferenceFilePath(workB, refWorkB.path);
		expect(manager.getReferenceFilePath(workB)).toBe('Novels/BookB/Outline.md');

		// 3. Main editor switches back to BookA -> BookA reference is still intact
		expect(manager.getReferenceFilePath(workA)).toBe('Novels/BookB/LoreReference.md');

		manager.destroy();
	});

	it('B) Migration: seeds confirmed current work only when legacy file is attributable', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		const chapterA = createTestFile('Novels/BookA/Chapter1.md');
		const refA = createTestFile('Novels/BookA/Reference.md');
		mockPlugin.settings.immersive.lastReferenceFilePath = refA.path;
		mockPlugin.settings.immersive.workReferencePaths = {};

		// Migrate for BookA: legacy file is inside BookA -> attributable
		manager.migrateLegacyReference(chapterA);

		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBe('Novels/BookA/Reference.md');
		// Legacy record is preserved, not cleared
		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBe('Novels/BookA/Reference.md');
		// Does NOT copy to BookB
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookB']).toBeUndefined();

		manager.destroy();
	});

	it('B) Migration: does NOT seed when legacy file belongs to another book or unmappable', () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		const chapterA = createTestFile('Novels/BookA/Chapter1.md');
		const refB = createTestFile('Novels/BookB/Reference.md');
		mockPlugin.settings.immersive.lastReferenceFilePath = refB.path;
		mockPlugin.settings.immersive.workReferencePaths = {};

		// Migrate for BookA while legacy file is in BookB
		manager.migrateLegacyReference(chapterA);

		// Should NOT seed BookA with BookB's legacy file
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBeUndefined();
		// Legacy record preserved
		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBe('Novels/BookB/Reference.md');

		manager.destroy();
	});

	it('B) Migration: does NOT overwrite existing work record', () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		const chapterA = createTestFile('Novels/BookA/Chapter1.md');
		createTestFile('Novels/BookA/LegacyRef.md');
		mockPlugin.settings.immersive.lastReferenceFilePath = 'Novels/BookA/LegacyRef.md';
		mockPlugin.settings.immersive.workReferencePaths = {
			'Novels/BookA': 'Novels/BookA/NewerRef.md'
		};

		manager.migrateLegacyReference(chapterA);

		// Retains existing newer mapping
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBe('Novels/BookA/NewerRef.md');

		manager.destroy();
	});

	it('does not migrate a new cross-work reference as legacy data into another work', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);
		const chapterB = createTestFile('Novels/BookB/Chapter1.md');
		const referenceB = createTestFile('Novels/BookB/Reference.md');
		await manager.setReferenceFilePath('Novels/BookA', referenceB.path);
		manager.migrateLegacyReference(chapterB);
		expect(manager.getReferenceFilePath('Novels/BookB')).toBeNull();
		await manager.destroy();
	});

	it('C) Immediate Persistence: awaitable save and flush', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);
		const ref = createTestFile('Novels/BookA/Notes.md');

		await manager.setReferenceFilePath('Novels/BookA', ref.path);

		expect(saveSettingsSpy).toHaveBeenCalledTimes(1);
		expect(flushSpy).toHaveBeenCalledTimes(1);

		// Calling flush explicitly awaits pending save
		await manager.flush();
		expect(flushSpy).toHaveBeenCalledTimes(2);

		manager.destroy();
	});

	it('D) Missing File on Restore: yields empty reference without throwing, invalidates record, preserves others', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		// BookA has a reference file that DOES NOT exist in vault
		// BookB has a reference file that DOES exist
		const refB = createTestFile('Novels/BookB/Active.md');
		mockPlugin.settings.immersive.workReferencePaths = {
			'Novels/BookA': 'Novels/BookA/Deleted.md',
			'Novels/BookB': refB.path
		};

		expect(() => {
			const restoredA = manager.getReferenceFilePath('Novels/BookA');
			expect(restoredA).toBeNull();
		}).not.toThrow();

		// BookA record was invalidated from settings
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBeUndefined();
		// BookB record was preserved
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookB']).toBe('Novels/BookB/Active.md');
		// Persistence was triggered to clean up stale record
		expect(saveSettingsSpy).toHaveBeenCalled();

		manager.destroy();
	});

	it('E) Path-Boundary Rename: updates work folders and reference files with strict boundaries', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		mockPlugin.settings.immersive.workReferencePaths = {
			'Novels/Book': 'Novels/Book/Ref.md',
			'Novels/BookTwo': 'Novels/BookTwo/Ref.md'
		};
		mockPlugin.settings.immersive.lastReferenceFilePath = 'Novels/Book/Ref.md';

		// Trigger vault rename: rename folder 'Novels/Book' to 'Novels/BookRenamed'
		const renamedFolder = { path: 'Novels/BookRenamed', name: 'BookRenamed' };
		await manager.handleRename(renamedFolder as unknown as TFile, 'Novels/Book');

		// 'Novels/Book' updated to 'Novels/BookRenamed'
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookRenamed']).toBe('Novels/BookRenamed/Ref.md');
		// 'Novels/Book' key removed
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/Book']).toBeUndefined();
		// 'Novels/BookTwo' NOT affected due to strict prefix boundary!
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookTwo']).toBe('Novels/BookTwo/Ref.md');
		// lastReferenceFilePath updated
		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBe('Novels/BookRenamed/Ref.md');

		// Trigger vault rename: rename single reference file
		const renamedRef = { path: 'Novels/BookRenamed/RefV2.md', name: 'RefV2.md' };
		await manager.handleRename(renamedRef as unknown as TFile, 'Novels/BookRenamed/Ref.md');

		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookRenamed']).toBe('Novels/BookRenamed/RefV2.md');
		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBe('Novels/BookRenamed/RefV2.md');

		manager.destroy();
	});

	it('F) Path-Boundary Delete: removes records strictly matching target path', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		mockPlugin.settings.immersive.workReferencePaths = {
			'Novels/Book': 'Novels/Book/Ref.md',
			'Novels/BookTwo': 'Novels/BookTwo/Ref.md'
		};
		mockPlugin.settings.immersive.lastReferenceFilePath = 'Novels/Book/Ref.md';

		// Delete 'Novels/Book' folder
		const deletedFolder = { path: 'Novels/Book', name: 'Book' };
		await manager.handleDelete(deletedFolder as unknown as TFile);

		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/Book']).toBeUndefined();
		// 'Novels/BookTwo' preserved!
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookTwo']).toBe('Novels/BookTwo/Ref.md');
		// lastReferenceFilePath deleted
		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBeUndefined();

		manager.destroy();
	});

	it('G) Background Errors: handles save failure gracefully without crashing', async () => {
		saveSettingsSpy.mockRejectedValueOnce(new Error('Disk full'));

		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);
		const ref = createTestFile('Novels/BookA/Notes.md');

		// Should not reject
		await expect(manager.setReferenceFilePath('Novels/BookA', ref.path)).resolves.not.toThrow();

		manager.destroy();
	});

	it('H) Lifecycle & Cleanup: unregisters vault listeners and stops handling events after destroy', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		expect(offrefSpy).not.toHaveBeenCalled();

		manager.destroy();

		expect(offrefSpy).toHaveBeenCalledTimes(2);

		// Event handlers after destroy are no-ops
		mockPlugin.settings.immersive.workReferencePaths = {
			'Novels/BookA': 'Novels/BookA/Ref.md'
		};
		saveSettingsSpy.mockClear();

		await manager.handleRename({ path: 'Novels/BookNew', name: 'BookNew' } as unknown as TFile, 'Novels/BookA');
		expect(saveSettingsSpy).not.toHaveBeenCalled();
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBe('Novels/BookA/Ref.md');
	});

	it('I) Post-Destroy Setter: setReferenceFilePath is a no-op after destroy and never mutates settings or saves', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);
		manager.destroy();

		mockPlugin.settings.immersive.workReferencePaths = {};
		saveSettingsSpy.mockClear();

		await manager.setReferenceFilePath('Novels/BookA', 'Novels/BookA/Ref.md');

		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBeUndefined();
		expect(saveSettingsSpy).not.toHaveBeenCalled();
	});

	it('J) Non-Markdown Restore: getReferenceFilePath ignores non-md files and invalidates stale record', () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		const pngFile = createTestFile('Novels/BookA/Cover.png');
		(pngFile as unknown as { extension: string }).extension = 'png';

		mockPlugin.settings.immersive.workReferencePaths = {
			'Novels/BookA': 'Novels/BookA/Cover.png'
		};

		const restored = manager.getReferenceFilePath('Novels/BookA');
		expect(restored).toBeNull();
		expect(mockPlugin.settings.immersive.workReferencePaths['Novels/BookA']).toBeUndefined();
		expect(saveSettingsSpy).toHaveBeenCalled();

		manager.destroy();
	});

	it('K) Legacy-Only Rename: handleRename updates lastReferenceFilePath even when workReferencePaths is undefined', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		delete mockPlugin.settings.immersive.workReferencePaths;
		mockPlugin.settings.immersive.lastReferenceFilePath = 'Novels/Book/LegacyRef.md';
		saveSettingsSpy.mockClear();

		await manager.handleRename(
			{ path: 'Novels/Book/LegacyNew.md', name: 'LegacyNew.md' } as unknown as TFile,
			'Novels/Book/LegacyRef.md'
		);

		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBe('Novels/Book/LegacyNew.md');
		expect(saveSettingsSpy).toHaveBeenCalled();

		manager.destroy();
	});

	it('L) Legacy-Only Delete: handleDelete removes lastReferenceFilePath even when workReferencePaths is undefined', async () => {
		const manager = new ImmersiveReferenceManager(mockApp, mockPlugin);

		delete mockPlugin.settings.immersive.workReferencePaths;
		mockPlugin.settings.immersive.lastReferenceFilePath = 'Novels/Book/LegacyRef.md';
		saveSettingsSpy.mockClear();

		await manager.handleDelete(
			{ path: 'Novels/Book/LegacyRef.md', name: 'LegacyRef.md' } as unknown as TFile
		);

		expect(mockPlugin.settings.immersive.lastReferenceFilePath).toBeUndefined();
		expect(saveSettingsSpy).toHaveBeenCalled();

		manager.destroy();
	});
});
