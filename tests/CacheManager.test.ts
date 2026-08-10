import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheManager } from '../src/services/CacheManager';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile, TFolder } from 'obsidian';

type TestTFileConstructor = new (name: string, path: string) => TFile;
type TestTFolderConstructor = new (name: string, path: string) => TFolder;

const createTestFile = (name: string, path: string): TFile =>
    new (TFile as unknown as TestTFileConstructor)(name, path);

const createTestFolder = (name: string, path: string): TFolder =>
    new (TFolder as unknown as TestTFolderConstructor)(name, path);

describe('CacheManager', () => {
    let mockPlugin: WebNovelAssistantPlugin;
    let manager: CacheManager;
    let mockAdapter: { exists: any, read: any, write: any };
    
    beforeEach(() => {
        vi.useFakeTimers();
        mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
            write: vi.fn()
        };

        mockPlugin = {
            app: {
                vault: {
                    adapter: mockAdapter
                }
            },
            settings: {
                workspaceFolders: ['Book 1'],
                strictChapterExceptions: ['Book 1/Settings'],
                showExplorerCounts: true,
                enableStrictChapterMode: false,
                loreFolderName: 'Lore'
            },
            manifest: {
                dir: 'plugins/test-plugin',
                id: 'test-plugin'
            },
            loadData: vi.fn().mockResolvedValue(null),
            saveData: vi.fn().mockResolvedValue(undefined),
        } as unknown as WebNovelAssistantPlugin;

        manager = new CacheManager(mockPlugin);
    });

    describe('Initialization & Persistence', () => {
        it('loadCache should return false if no cache data exists', async () => {
            mockAdapter.exists.mockResolvedValue(false);
            const result = await manager.loadCache();
            expect(result).toBe(false);
        });

        it('loadCache should load data from valid cache file', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            const validData = {
                version: 2,
                timestamp: Date.now(),
                entries: [['Book 1/Chapter 1.md', { path: 'Book 1/Chapter 1.md', wordCount: 1000, lastModified: 1000, isFolder: false }]]
            };
            mockAdapter.read.mockResolvedValue(JSON.stringify(validData));

            const result = await manager.loadCache();
            expect(result).toBe(true);
            expect(manager.getFileCache('Book 1/Chapter 1.md')).toBe(1000);
        });

        it('loadCache should reject expired cache', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            const expiredData = {
                version: 2,
                timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000), // 8 days ago
                entries: [['file.md', { path: 'file.md', wordCount: 1000, lastModified: 1000, isFolder: false }]]
            };
            mockAdapter.read.mockResolvedValue(JSON.stringify(expiredData));

            const result = await manager.loadCache();
            expect(result).toBe(false);
        });

        it('saveCache should serialize and write to adapter', async () => {
            // Need to mock the queue behavior of SerializedWriter
            // Since it's an async queue, we just await it
            manager.updateFileCache({ path: 'Book 1/Chapter 1.md', stat: { mtime: 1000 } } as TFile, 1500, {} as any);
            
            await manager.saveCache();
            
            expect(mockAdapter.write).toHaveBeenCalled();
            const writtenContent = mockAdapter.write.mock.calls[0][1];
            expect(writtenContent).toContain('Book 1/Chapter 1.md');
            expect(writtenContent).toContain('1500');
        });
    });

    describe('File Path Validation', () => {
        it('isFileInWorkspace should return true for valid workspace files', () => {
            expect(manager.isFileInWorkspace({ path: 'Book 1/Chapter 1.md' } as TFile)).toBe(true);
            expect(manager.isFileInWorkspace({ path: 'Book 1.md' } as TFile)).toBe(true);
        });

        it('isFileInWorkspace should return false for files outside workspace', () => {
            expect(manager.isFileInWorkspace({ path: 'Book 2/Chapter 1.md' } as TFile)).toBe(false);
        });

        it('isFileInStrictChapterException should match exceptions correctly', () => {
            expect(manager.isFileInStrictChapterException({ path: 'Book 1/Settings/Lore.md' } as TFile)).toBe(true);
            expect(manager.isFileInStrictChapterException({ path: 'Book 1/Chapter 1.md' } as TFile)).toBe(false);
        });
    });

    describe('Cache Update Logic', () => {
		it('refreshes entries whose mtime changed and removes stale paths even when counts match', async () => {
			const book = createTestFolder('Book 1', 'Book 1');
			const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
			Object.assign(file, { stat: { mtime: 2000 }, parent: book, basename: 'Chapter 1' });
			manager['cache'].set(file.path, { path: file.path, wordCount: 100, lastModified: 1000, isFolder: false });
			manager['cache'].set('Book 1/Deleted.md', { path: 'Book 1/Deleted.md', wordCount: 50, lastModified: 1000, isFolder: false });
			manager['cache'].set('Book 1', { path: 'Book 1', wordCount: 150, lastModified: 1000, isFolder: true });
			Object.assign(mockPlugin.app.vault, {
				cachedRead: vi.fn().mockResolvedValue('新的正文'),
				getAbstractFileByPath: vi.fn()
			});
			Object.assign(mockPlugin, {
				getTrackedMarkdownFiles: vi.fn().mockReturnValue([file]),
				calculateAccurateWords: vi.fn().mockReturnValue(4),
				register: vi.fn(),
				fileExplorerPatcher: { refreshFolderCounts: vi.fn() }
			});

			await manager.buildFolderCache();

			expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(file);
			expect(manager.getFileCache(file.path)).toBe(4);
			expect(manager.getFileCache('Book 1/Deleted.md')).toBeNull();
			expect(manager.getFolderWordCount('Book 1')).toBe(4);
		});

        it('updateFileCache should increment root and folder counts properly', () => {
            const bookFolder = { path: 'Book 1', parent: null };
            const file = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', stat: { mtime: 1234 }, parent: bookFolder } as any as TFile;
            
            // Seed parent folder entry (normally created by buildInitialCache)
            manager['cache'].set('Book 1', { path: 'Book 1', wordCount: 0, lastModified: 0, isFolder: true });
            
            // First time update: delta = 2000
            manager.updateFileCache(file, 2000, {} as any);
            
            // File entry should be set
            expect(manager.getFileCache('Book 1/Chapter 1.md')).toBe(2000);
            // Parent folder should be incremented by delta
            expect(manager.getFolderWordCount('Book 1')).toBe(2000);
            
            // Second update: delta = 500 (2500 - 2000)
            manager.updateFileCache(file, 2500, {} as any);
            
            expect(manager.getFileCache('Book 1/Chapter 1.md')).toBe(2500);
            expect(manager.getFolderWordCount('Book 1')).toBe(2500);
        });

        it('invalidateCache should decrement word counts accurately', () => {
            const file1 = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', stat: { mtime: 1234 }, parent: { path: 'Book 1' } } as any as TFile;
            const file2 = { path: 'Book 1/Chapter 2.md', name: 'Chapter 2.md', basename: 'Chapter 2', stat: { mtime: 1234 }, parent: { path: 'Book 1' } } as any as TFile;
            vi.spyOn(manager, 'isEligibleForWordCount').mockReturnValue(true);
            
            manager['cache'].set('Book 1', { path: 'Book 1', wordCount: 0, lastModified: 0, isFolder: true });
            
            manager.updateFileCache(file1, 2000, {} as any);
            manager.updateFileCache(file2, 3000, {} as any);
            
            expect(manager.getFolderWordCount('Book 1')).toBe(5000);
            
            manager.invalidateCache('Book 1/Chapter 1.md', {} as any);
            
            // Should be removed from cache
            expect(manager.getFileCache('Book 1/Chapter 1.md')).toBeNull();
            // Folder count should drop by 2000
            expect(manager.getFolderWordCount('Book 1')).toBe(3000);
        });
    });

    describe('Lore Cache', () => {
        it('resetLoreCache should clear internal cache and force rebuild on next call', () => {
            // Initial state: cache is null (lazy initialization)
            expect(manager['_loreCandidatesCache']).toBeNull();
            
            // Trigger rebuild by calling isEligibleForWordCount
            // Use a file guaranteed to be in workspace (path validation is separate from lore check)
            vi.spyOn(manager, 'isFileInWorkspace').mockReturnValue(true);
            vi.spyOn(manager, 'isPluginGeneratedFile').mockReturnValue(false);
            const dummyFile = new (TFile as any)('test.md', 'Book 1/test.md');
            Object.assign(dummyFile, { basename: 'test' });
            manager.isEligibleForWordCount(dummyFile);
            
            // Cache should now be populated with the current loreFolderName ('Lore')
            expect(manager['_loreCandidatesCache']).not.toBeNull();
            expect(manager['_loreCandidatesCache']?.has('Lore')).toBe(true);
            
            // Reset should clear the cache
            manager.resetLoreCache();
            expect(manager['_loreCandidatesCache']).toBeNull();
            
            // Change the lore folder setting, then trigger rebuild
            mockPlugin.settings.loreFolderName = 'SomethingUniqueXYZ';
            manager.isEligibleForWordCount(dummyFile);
            
            // New cache should contain the new setting
            const newCache = manager['_loreCandidatesCache'];
            expect(newCache?.has('SomethingUniqueXYZ')).toBe(true);
        });

        it('resetLoreCache should clear cached workspaceFolders when workspace setting changes', () => {
            expect(manager.isFileInWorkspace({ path: 'Book 1/Chapter 1.md' } as TFile)).toBe(true);
            expect(manager.isFileInWorkspace({ path: 'Book 2/Chapter 1.md' } as TFile)).toBe(false);

            // Change workspace settings without reset
            mockPlugin.settings.workspaceFolders = ['Book 2'];
            expect(manager.isFileInWorkspace({ path: 'Book 2/Chapter 1.md' } as TFile)).toBe(false);

            // After reset, it updates normalized workspace folders
            manager.resetLoreCache();
            expect(manager.isFileInWorkspace({ path: 'Book 2/Chapter 1.md' } as TFile)).toBe(true);
            expect(manager.isFileInWorkspace({ path: 'Book 1/Chapter 1.md' } as TFile)).toBe(false);
        });
    });
});
