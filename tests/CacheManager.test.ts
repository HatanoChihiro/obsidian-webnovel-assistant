import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheManager } from '../src/services/CacheManager';
import { ChapterSorter } from '../src/services/ChapterSorter';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { Platform, TFile, TFolder, Vault, type TAbstractFile } from 'obsidian';

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
    let mockWorkspace: {
        trigger: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
    };
    
    beforeEach(() => {
        vi.useFakeTimers();
        ChapterSorter.setCustomRules([]);
        mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
            write: vi.fn()
        };

        mockWorkspace = {
            trigger: vi.fn(),
            on: vi.fn()
        };

        mockPlugin = {
            app: {
                vault: {
                    adapter: mockAdapter
                },
                metadataCache: {
                    getFileCache: vi.fn().mockReturnValue(null)
                },
                workspace: mockWorkspace
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
            register: vi.fn(),
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
				version: 4,
                timestamp: Date.now(),
                entries: [['Book 1/Chapter 1.md', { path: 'Book 1/Chapter 1.md', wordCount: 1000, lastModified: 1000, isFolder: false }]]
            };
            mockAdapter.read.mockResolvedValue(JSON.stringify(validData));

            const result = await manager.loadCache();
            expect(result).toBe(true);
            expect(manager.getFileCache('Book 1/Chapter 1.md')).toBe(1000);
        });

		it('rejects cached totals from before the comment inclusion policy so unchanged chapters are recounted', async () => {
			mockAdapter.exists.mockResolvedValue(true);
			mockAdapter.read.mockResolvedValue(JSON.stringify({
				version: 3,
				timestamp: Date.now(),
				entries: [['Book 1/Chapter 1.md', { path: 'Book 1/Chapter 1.md', wordCount: 12, lastModified: 1000, isFolder: false }]]
			}));

			expect(await manager.loadCache()).toBe(false);
			expect(manager.getFileCache('Book 1/Chapter 1.md')).toBeNull();
		});

		it('loadCache should reject the old cache scope so totals are rebuilt from chapters only', async () => {
			mockAdapter.exists.mockResolvedValue(true);
			mockAdapter.read.mockResolvedValue(JSON.stringify({
				version: 2,
				timestamp: Date.now(),
				entries: [['Book 1/Notes.md', { path: 'Book 1/Notes.md', wordCount: 500, lastModified: 1000, isFolder: false }]]
			}));

			expect(await manager.loadCache()).toBe(false);
			expect(manager.getFileCache('Book 1/Notes.md')).toBeNull();
		});

        it('loadCache should reject expired cache', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            const expiredData = {
				version: 4,
                timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000), // 8 days ago
                entries: [['file.md', { path: 'file.md', wordCount: 1000, lastModified: 1000, isFolder: false }]]
            };
            mockAdapter.read.mockResolvedValue(JSON.stringify(expiredData));

            const result = await manager.loadCache();
            expect(result).toBe(false);
        });

        it('saveCache should serialize and write to adapter', async () => {
			manager.updateFileCache({ path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', stat: { mtime: 1000 } } as TFile, 1500, {} as any);
            
            await manager.saveCache();
            
            expect(mockAdapter.write).toHaveBeenCalled();
            const writtenContent = mockAdapter.write.mock.calls[0][1];
			expect(JSON.parse(writtenContent).version).toBe(4);
            expect(writtenContent).toContain('Book 1/Chapter 1.md');
            expect(writtenContent).toContain('1500');
        });

		it('suppresses redundant writes when cache has not changed', async () => {
			mockAdapter.exists.mockResolvedValue(true);
			const validData = {
				version: 4,
				timestamp: Date.now(),
				entries: [['Book 1/Chapter 1.md', { path: 'Book 1/Chapter 1.md', wordCount: 1000, lastModified: 1000, isFolder: false }]]
			};
			mockAdapter.read.mockResolvedValue(JSON.stringify(validData));

			await manager.loadCache();

			// Periodic save without mutation -> 0 writes
			await manager.saveCache();
			expect(mockAdapter.write).not.toHaveBeenCalled();

			// Mutate -> 1 write
			manager.updateFileCache({ path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', stat: { mtime: 2000 } } as TFile, 1200, {} as any);
			await manager.saveCache();
			expect(mockAdapter.write).toHaveBeenCalledTimes(1);

			// Periodic save again -> no additional write
			await manager.saveCache();
			expect(mockAdapter.write).toHaveBeenCalledTimes(1);
		});

		it('suppresses periodic saveCache writes when advancing mocked time without cache mutation', async () => {
			mockAdapter.exists.mockResolvedValue(true);
			const validData = {
				version: 4,
				timestamp: Date.now(),
				entries: [['Book 1/Chapter 1.md', { path: 'Book 1/Chapter 1.md', wordCount: 1000, lastModified: 1000, isFolder: false }]]
			};
			mockAdapter.read.mockResolvedValue(JSON.stringify(validData));

			await manager.loadCache();

			// Advance mocked timer by 5 minutes (simulating periodic background save ticks)
			vi.advanceTimersByTime(5 * 60 * 1000);

			// Periodic save must still perform zero writes
			await manager.saveCache();
			expect(mockAdapter.write).not.toHaveBeenCalled();
			expect(manager.isDirty()).toBe(false);
		});

		it('coalesces burst saveCache requests into a single write', async () => {
			manager.updateFileCache({ path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', stat: { mtime: 1000 } } as TFile, 500, {} as any);

			const p1 = manager.saveCache();
			const p2 = manager.saveCache();
			const p3 = manager.saveCache();

			await Promise.all([p1, p2, p3]);

			expect(mockAdapter.write).toHaveBeenCalledTimes(1);
			expect(manager.isDirty()).toBe(false);
		});

		it('keeps cache dirty on write failure and allows retry', async () => {
			mockAdapter.write
				.mockRejectedValueOnce(new Error('Write failed'))
				.mockResolvedValueOnce(undefined);

			manager.updateFileCache({ path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', stat: { mtime: 1000 } } as TFile, 500, {} as any);

			await expect(manager.saveCache()).rejects.toThrow('Write failed');
			expect(manager.isDirty()).toBe(true);

			await manager.flush();

			expect(mockAdapter.write).toHaveBeenCalledTimes(2);
			expect(manager.isDirty()).toBe(false);
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

		it('isFileCacheCurrent should verify whether entry exists, is not folder, and lastModified matches file mtime', () => {
			const file = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', extension: 'md', stat: { mtime: 5000 } } as unknown as TFile;
			expect(manager.isFileCacheCurrent(file)).toBe(false);

			manager.updateFileCache(file, 200, mockPlugin.app.vault);
			expect(manager.isFileCacheCurrent(file)).toBe(true);

			const modifiedFile = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1', extension: 'md', stat: { mtime: 6000 } } as unknown as TFile;
			expect(manager.isFileCacheCurrent(modifiedFile)).toBe(false);
		});

        it('isFileInStrictChapterException should match exceptions correctly', () => {
            expect(manager.isFileInStrictChapterException({ path: 'Book 1/Settings/Lore.md' } as TFile)).toBe(true);
            expect(manager.isFileInStrictChapterException({ path: 'Book 1/Chapter 1.md' } as TFile)).toBe(false);
        });

		it('isEligibleForWordCount and isEligibleForTotalWordCount in non-strict mode should include all valid markdown files except functional files', () => {
			mockPlugin.settings.enableStrictChapterMode = false;
			const chapter = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1' } as TFile;
			const regularDoc = { path: 'Book 1/Notes.md', name: 'Notes.md', basename: 'Notes' } as TFile;
			const exceptionDoc = { path: 'Book 1/Settings/Appendix.md', name: 'Appendix.md', basename: 'Appendix' } as TFile;
			const loreDoc = { path: 'Book 1/Lore/Character.md', name: 'Character.md', basename: 'Character' } as TFile;
			const mergeDoc = { path: 'Book 1/_合并章节.md', name: '_合并章节.md', basename: '_合并章节' } as TFile;
			const outsideDoc = { path: 'Book 2/Notes.md', name: 'Notes.md', basename: 'Notes' } as TFile;

			expect(manager.isEligibleForWordCount(chapter)).toBe(true);
			expect(manager.isEligibleForTotalWordCount(chapter)).toBe(true);
			expect(manager.isEligibleForWordCount(regularDoc)).toBe(true);
			expect(manager.isEligibleForTotalWordCount(regularDoc)).toBe(true);
			expect(manager.isEligibleForWordCount(exceptionDoc)).toBe(true);
			expect(manager.isEligibleForTotalWordCount(exceptionDoc)).toBe(true);
			expect(manager.isEligibleForWordCount(loreDoc)).toBe(false);
			expect(manager.isEligibleForTotalWordCount(loreDoc)).toBe(false);
			expect(manager.isEligibleForWordCount(mergeDoc)).toBe(false);
			expect(manager.isEligibleForTotalWordCount(mergeDoc)).toBe(false);
			expect(manager.isEligibleForWordCount(outsideDoc)).toBe(false);
			expect(manager.isEligibleForTotalWordCount(outsideDoc)).toBe(false);
		});

		it('isEligibleForWordCount and isEligibleForTotalWordCount in strict chapter mode should only include chapters and exception files', () => {
			mockPlugin.settings.enableStrictChapterMode = true;
			const chapter = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1' } as TFile;
			const regularDoc = { path: 'Book 1/Notes.md', name: 'Notes.md', basename: 'Notes' } as TFile;
			const exceptionDoc = { path: 'Book 1/Settings/Appendix.md', name: 'Appendix.md', basename: 'Appendix' } as TFile;

			expect(manager.isEligibleForWordCount(chapter)).toBe(true);
			expect(manager.isEligibleForTotalWordCount(chapter)).toBe(true);
			expect(manager.isEligibleForWordCount(regularDoc)).toBe(false);
			expect(manager.isEligibleForTotalWordCount(regularDoc)).toBe(false);
			expect(manager.isEligibleForWordCount(exceptionDoc)).toBe(true);
			expect(manager.isEligibleForTotalWordCount(exceptionDoc)).toBe(true);
		});

		it('isEligibleForChapterList should include chapters even when exclude-word-count is true, while isEligibleForWordCount excludes them', () => {
			const excludedChapter = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1' } as TFile;
			(mockPlugin.app.metadataCache.getFileCache as any).mockReturnValue({
				frontmatter: { 'exclude-word-count': true }
			});

			expect(manager.isEligibleForChapterList(excludedChapter)).toBe(true);
			expect(manager.isEligibleForWordCount(excludedChapter)).toBe(false);
			expect(manager.isEligibleForTotalWordCount(excludedChapter)).toBe(false);

			// When exclude-word-count is false or not set
			(mockPlugin.app.metadataCache.getFileCache as any).mockReturnValue({
				frontmatter: { 'exclude-word-count': false }
			});
			expect(manager.isEligibleForChapterList(excludedChapter)).toBe(true);
			expect(manager.isEligibleForWordCount(excludedChapter)).toBe(true);
		});

		it('updateFileCache should accept regular files in non-strict mode and reject in strict mode', () => {
			mockPlugin.settings.enableStrictChapterMode = false;
			const regularDoc = {
				path: 'Book 1/Notes.md',
				name: 'Notes.md',
				basename: 'Notes',
				stat: { mtime: 1000 }
			} as TFile;

			expect(manager.updateFileCache(regularDoc, 500, {} as never)).toBe(500);
			expect(manager.getFileCache(regularDoc.path)).toBe(500);

			mockPlugin.settings.enableStrictChapterMode = true;
			const strictRegularDoc = {
				path: 'Book 1/Unrelated.md',
				name: 'Unrelated.md',
				basename: 'Unrelated',
				stat: { mtime: 1000 }
			} as TFile;
			expect(manager.updateFileCache(strictRegularDoc, 300, {} as never)).toBe(0);
			expect(manager.getFileCache(strictRegularDoc.path)).toBeNull();
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
				getAbstractFileByPath: vi.fn((p: string) => (p === file.path ? file : null))
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

        it('should lazily initialize and reuse _dictPathsCache, and rebuild after resetLoreCache', () => {
            expect(manager['_dictPathsCache']).toBeNull();

            const chapterFile = { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md', basename: 'Chapter 1' } as TFile;
            const defaultZhDictFile = { path: 'Book 1/校对词典/错词.md', name: '错词.md', basename: '错词' } as TFile;
            const defaultEnDictFile = { path: 'Book 1/Proofreading Dictionaries/Typos.md', name: 'Typos.md', basename: 'Typos' } as TFile;

            vi.spyOn(manager, 'isFileInWorkspace').mockReturnValue(true);
            vi.spyOn(manager, 'isPluginGeneratedFile').mockReturnValue(false);

            // First call initializes cache
            expect(manager.isEligibleForChapterList(chapterFile)).toBe(true);
            expect(manager['_dictPathsCache']).not.toBeNull();
            expect(manager['_dictPathsCache']?.has('校对词典')).toBe(true);
            expect(manager['_dictPathsCache']?.has('Proofreading Dictionaries')).toBe(true);

            // Verify default dictionary paths are excluded
            expect(manager.isEligibleForChapterList(defaultZhDictFile)).toBe(false);
            expect(manager.isEligibleForChapterList(defaultEnDictFile)).toBe(false);

            // A user rule can explicitly opt a dictionary document into chapter handling.
            ChapterSorter.setCustomRules([{ name: 'Dictionary override', pattern: '^(错词)$', enabled: true }]);
            expect(manager.isEligibleForChapterList(defaultZhDictFile)).toBe(true);
            ChapterSorter.setCustomRules([]);

            // Second call reuses the same Set reference
            const initialSet = manager['_dictPathsCache'];
            manager.isEligibleForChapterList(chapterFile);
            expect(manager['_dictPathsCache']).toBe(initialSet);

            // Reset clears _dictPathsCache
            manager.resetLoreCache();
            expect(manager['_dictPathsCache']).toBeNull();

            // Set custom dictionary path
            mockPlugin.settings.proofreading = {
                enabled: true,
                dictionaryPath: 'CustomDictFolder',
                enableBuiltin: true,
                enableUserDict: true,
                enableSensitive: true,
                enableSynonyms: true,
                enableDeDiDe: false
            };

            const customDictFile = { path: 'CustomDictFolder/错词.md', name: '错词.md', basename: '错词' } as TFile;
            expect(manager.isEligibleForChapterList(customDictFile)).toBe(false);
            expect(manager['_dictPathsCache']?.has('CustomDictFolder')).toBe(true);
            expect(manager['_dictPathsCache']?.has('校对词典')).toBe(true);
            expect(manager['_dictPathsCache']?.has('Proofreading Dictionaries')).toBe(true);

            // Change custom dictionary path, reset, and check again
            mockPlugin.settings.proofreading.dictionaryPath = 'NewDictFolder';
            manager.resetLoreCache();
            expect(manager['_dictPathsCache']).toBeNull();

            const newDictFile = { path: 'NewDictFolder/错词.md', name: '错词.md', basename: '错词' } as TFile;
            expect(manager.isEligibleForChapterList(newDictFile)).toBe(false);
            expect(manager.isEligibleForChapterList(customDictFile)).toBe(true);
            expect(manager['_dictPathsCache']?.has('NewDictFolder')).toBe(true);
            expect(manager['_dictPathsCache']?.has('CustomDictFolder')).toBe(false);
        });
    });

    describe('Mobile refresh cleanup registration', () => {
        afterEach(() => {
            Platform.isMobile = false;
        });

        it.each([1, 3])('bounds cleanup registration and clears pending mobile timers across %i schedule(s)', async (count) => {
            Platform.isMobile = true;
            expect(mockPlugin.register).toHaveBeenCalledTimes(1);
            const [unloadCleanup] = (mockPlugin.register as ReturnType<typeof vi.fn>).mock.calls[0] as [() => void];

            const refreshFolderCounts = vi.fn();
            const refreshHomepageViews = vi.fn().mockResolvedValue(undefined);
            const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            mockPlugin.settings.enableHomepage = true;
            Object.assign(mockPlugin, {
                fileExplorerPatcher: { refreshFolderCounts },
                homepageManager: {
                    refreshHomepageViews,
                    getHomepageFilePath: vi.fn().mockReturnValue(null)
                },
                getTrackedMarkdownFiles: vi.fn().mockReturnValue([file]),
                calculateAccurateWords: vi.fn().mockReturnValue(100),
                saveSettings: vi.fn().mockResolvedValue(undefined)
            });
            manager['cache'].set(file.path, { path: file.path, wordCount: 100, lastModified: file.stat.mtime, isFolder: false });

            for (let i = 0; i < count; i++) {
                await manager.buildFolderCache();
            }

            // Repeated schedules do not grow registered cleanup count
            expect(mockPlugin.register).toHaveBeenCalledTimes(1);
            const pendingSet = manager['pendingMobileRefreshTimers'];
            expect(pendingSet.size).toBe(count);
            expect(refreshFolderCounts).not.toHaveBeenCalled();

            // Exact one callback per schedule
            vi.advanceTimersByTime(500);
            expect(refreshFolderCounts).toHaveBeenCalledTimes(count);
            expect(refreshHomepageViews).toHaveBeenCalledTimes(count);

            // Completed timers leave no pending references
            expect(pendingSet.size).toBe(0);

            // Unload cancels outstanding callbacks
            await manager.buildFolderCache();
            expect(pendingSet.size).toBe(1);
            unloadCleanup();
            expect(pendingSet.size).toBe(0);
            vi.advanceTimersByTime(500);
            expect(refreshFolderCounts).toHaveBeenCalledTimes(count);
            expect(refreshHomepageViews).toHaveBeenCalledTimes(count);
        });
    });

    describe('webnovel:file-word-count-updated event emission', () => {
        it('emits webnovel:file-word-count-updated when a new file entry is cached', () => {
            const file = {
                path: 'Book 1/Chapter 1.md',
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                stat: { mtime: 1000 },
                parent: { path: 'Book 1', parent: null }
            } as unknown as TFile;

            manager.updateFileCache(file, 1500, {} as unknown as Vault);

            expect(mockWorkspace.trigger).toHaveBeenCalledWith(
                'webnovel:file-word-count-updated',
                file,
                1500
            );
        });

        it('emits webnovel:file-word-count-updated when existing word count changes', () => {
            const file = {
                path: 'Book 1/Chapter 1.md',
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                stat: { mtime: 1000 },
                parent: { path: 'Book 1', parent: null }
            } as unknown as TFile;

            manager.updateFileCache(file, 1500, {} as unknown as Vault);
            mockWorkspace.trigger.mockClear();

            file.stat.mtime = 2000;
            manager.updateFileCache(file, 1800, {} as unknown as Vault);

            expect(mockWorkspace.trigger).toHaveBeenCalledTimes(1);
            expect(mockWorkspace.trigger).toHaveBeenCalledWith(
                'webnovel:file-word-count-updated',
                file,
                1800
            );
        });

        it('emits webnovel:file-word-count-updated when count drops to zero', () => {
            const file = {
                path: 'Book 1/Chapter 1.md',
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                stat: { mtime: 1000 },
                parent: { path: 'Book 1', parent: null }
            } as unknown as TFile;

            manager.updateFileCache(file, 1500, {} as unknown as Vault);
            mockWorkspace.trigger.mockClear();

            file.stat.mtime = 2000;
            manager.updateFileCache(file, 0, {} as unknown as Vault);

            expect(mockWorkspace.trigger).toHaveBeenCalledTimes(1);
            expect(mockWorkspace.trigger).toHaveBeenCalledWith(
                'webnovel:file-word-count-updated',
                file,
                0
            );
        });

        it('does NOT emit when count is unchanged', () => {
            const file = {
                path: 'Book 1/Chapter 1.md',
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                stat: { mtime: 1000 },
                parent: { path: 'Book 1', parent: null }
            } as unknown as TFile;

            manager.updateFileCache(file, 1500, {} as unknown as Vault);
            mockWorkspace.trigger.mockClear();

            file.stat.mtime = 2000;
            manager.updateFileCache(file, 1500, {} as unknown as Vault);

            expect(mockWorkspace.trigger).not.toHaveBeenCalled();
        });

        it('does NOT emit when update is rejected due to stale timestamp', () => {
            const file = {
                path: 'Book 1/Chapter 1.md',
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                stat: { mtime: 2000 },
                parent: { path: 'Book 1', parent: null }
            } as unknown as TFile;

            manager.updateFileCache(file, 1500, {} as unknown as Vault);
            mockWorkspace.trigger.mockClear();

            file.stat.mtime = 1000;
            manager.updateFileCache(file, 1600, {} as unknown as Vault);

            expect(mockWorkspace.trigger).not.toHaveBeenCalled();
        });

        it('does NOT emit when file is ineligible for total word count', () => {
            vi.spyOn(manager, 'isEligibleForTotalWordCount').mockReturnValue(false);
            const file = {
                path: 'Book 1/Excluded.md',
                name: 'Excluded.md',
                basename: 'Excluded',
                stat: { mtime: 1000 },
                parent: { path: 'Book 1', parent: null }
            } as unknown as TFile;

            manager.updateFileCache(file, 500, {} as unknown as Vault);

            expect(mockWorkspace.trigger).not.toHaveBeenCalled();
        });

        it('emits AFTER cache and parent folder counts have already been updated', () => {
            const bookFolder = { path: 'Book 1', parent: null };
            const file = {
                path: 'Book 1/Chapter 1.md',
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                stat: { mtime: 1000 },
                parent: bookFolder
            } as unknown as TFile;

            let fileCacheAtTrigger: number | null = null;
            let folderCacheAtTrigger: number | null = null;

            mockWorkspace.trigger.mockImplementation((event: string) => {
                if (event === 'webnovel:file-word-count-updated') {
                    fileCacheAtTrigger = manager.getFileCache(file.path);
                    folderCacheAtTrigger = manager.getFolderWordCount('Book 1');
                }
            });

            manager.updateFileCache(file, 2000, {} as unknown as Vault);

            expect(fileCacheAtTrigger).toBe(2000);
            expect(folderCacheAtTrigger).toBe(2000);
        });
    });

    describe('Async rebuild race protection (buildInitialCache & buildFolderCache)', () => {
        function createDeferred<T>() {
            let resolve!: (value: T) => void;
            let reject!: (reason?: unknown) => void;
            const promise = new Promise<T>((res, rej) => {
                resolve = res;
                reject = rej;
            });
            return { promise, resolve, reject };
        }

        function setupVaultForRebuild(files: TFile[], cachedReadImpl: (file: TFile) => Promise<string>) {
            const bookFolder = createTestFolder('Book 1', 'Book 1');
            const rootFolder = createTestFolder('', '/');
            (bookFolder as unknown as { children: TAbstractFile[] }).children = files;
            (rootFolder as unknown as { children: TAbstractFile[] }).children = [bookFolder];
            for (const f of files) {
                (f as unknown as { parent: TFolder }).parent = bookFolder;
            }
            (bookFolder as unknown as { parent: TFolder }).parent = rootFolder;

            const pathMap = new Map<string, TAbstractFile>();
            for (const f of files) {
                pathMap.set(f.path, f);
            }

            const vault = {
                adapter: mockAdapter,
                getRoot: vi.fn().mockReturnValue(rootFolder),
                cachedRead: vi.fn(cachedReadImpl),
                getAbstractFileByPath: vi.fn((p: string) => pathMap.get(p) ?? null),
            } as unknown as Vault;

            mockPlugin.app.vault = vault;
            Object.assign(mockPlugin, {
                getTrackedMarkdownFiles: vi.fn().mockReturnValue(files),
                calculateAccurateWords: vi.fn((content: string) => content.trim() ? content.trim().split(/\s+/).length : 0),
                saveSettings: vi.fn().mockResolvedValue(undefined),
                fileExplorerPatcher: { refreshFolderCounts: vi.fn() },
                homepageManager: {
                    refreshHomepageViews: vi.fn().mockResolvedValue(undefined),
                    getHomepageFilePath: vi.fn().mockReturnValue(null)
                }
            });

            return { vault, pathMap, bookFolder };
        }

        it('buildInitialCache: does not overwrite newer mtime editor cache with delayed stale read', async () => {
            const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            file.stat = { mtime: 10, ctime: 10, size: 50 };
            const deferred = createDeferred<string>();
            const { vault } = setupVaultForRebuild([file], () => deferred.promise);

            const rebuildPromise = manager.buildInitialCache(
                vault,
                (c) => (c.trim() ? c.trim().split(/\s+/).length : 0),
                (f) => manager.isEligibleForTotalWordCount(f)
            );

            // Simulate newer editor update while cachedRead is pending
            file.stat = { mtime: 20, ctime: 10, size: 500 };
            manager.updateFileCache(file, 100, vault);

            // Delayed stale read (10 words) resolves
            deferred.resolve('one two three four five six seven eight nine ten');
            await rebuildPromise;

            expect(manager.getFileCache(file.path)).toBe(100);
            expect(manager.getFolderWordCount('Book 1')).toBe(100);
        });

        it('buildInitialCache: does not overwrite same-mtime newer editor cache with delayed stale read', async () => {
            const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            file.stat = { mtime: 10, ctime: 10, size: 50 };
            const deferred = createDeferred<string>();
            const { vault } = setupVaultForRebuild([file], () => deferred.promise);

            const rebuildPromise = manager.buildInitialCache(
                vault,
                (c) => (c.trim() ? c.trim().split(/\s+/).length : 0),
                (f) => manager.isEligibleForTotalWordCount(f)
            );

            // Same-mtime editor update during pending read
            manager.updateFileCache(file, 100, vault);

            deferred.resolve('one two three four five six seven eight nine ten');
            await rebuildPromise;

            expect(manager.getFileCache(file.path)).toBe(100);
            expect(manager.getFolderWordCount('Book 1')).toBe(100);
        });

        it('buildInitialCache: skips write if file is deleted, replaced, renamed, or becomes ineligible during read', async () => {
            const fDeleted = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            const fReplaced = createTestFile('Chapter 2.md', 'Book 1/Chapter 2.md');
            const fRenamed = createTestFile('Chapter 3.md', 'Book 1/Chapter 3.md');
            const fIneligible = createTestFile('Chapter 4.md', 'Book 1/Chapter 4.md');
            for (const f of [fDeleted, fReplaced, fRenamed, fIneligible]) {
                f.stat = { mtime: 10, ctime: 10, size: 50 };
            }

            const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();
            const { vault, pathMap } = setupVaultForRebuild(
                [fDeleted, fReplaced, fRenamed, fIneligible],
                (f) => {
                    const d = createDeferred<string>();
                    deferreds.set(f.path, d);
                    return d.promise;
                }
            );

            let ineligibleFlag = false;
            const origEligible = manager.isEligibleForTotalWordCount.bind(manager);
            vi.spyOn(manager, 'isEligibleForTotalWordCount').mockImplementation((f) => {
                if (f === fIneligible && ineligibleFlag) return false;
                return origEligible(f);
            });

            const rebuildPromise = manager.buildInitialCache(
                vault,
                (c) => (c.trim() ? c.trim().split(/\s+/).length : 0),
                (f) => manager.isEligibleForTotalWordCount(f)
            );

            // Mutate vault state while reads are pending sequentially
            await vi.waitFor(() => expect(deferreds.has('Book 1/Chapter 1.md')).toBe(true));
            pathMap.delete(fDeleted.path);
            deferreds.get('Book 1/Chapter 1.md')!.resolve('one two');

            await vi.waitFor(() => expect(deferreds.has('Book 1/Chapter 2.md')).toBe(true));
            const replacement = createTestFile('Chapter 2.md', 'Book 1/Chapter 2.md');
            replacement.stat = { mtime: 10, ctime: 10, size: 50 };
            pathMap.set('Book 1/Chapter 2.md', replacement);
            deferreds.get('Book 1/Chapter 2.md')!.resolve('one two');

            await vi.waitFor(() => expect(deferreds.has('Book 1/Chapter 3.md')).toBe(true));
            fRenamed.path = 'Book 1/Chapter 3-new.md';
            deferreds.get('Book 1/Chapter 3.md')!.resolve('one two');

            await vi.waitFor(() => expect(deferreds.has('Book 1/Chapter 4.md')).toBe(true));
            ineligibleFlag = true;
            deferreds.get('Book 1/Chapter 4.md')!.resolve('one two');

            await rebuildPromise;

            expect(manager.getFileCache('Book 1/Chapter 1.md')).toBeNull();
            expect(manager.getFileCache('Book 1/Chapter 2.md')).toBeNull();
            expect(manager.getFileCache('Book 1/Chapter 3.md')).toBeNull();
            expect(manager.getFileCache('Book 1/Chapter 3-new.md')).toBeNull();
            expect(manager.getFileCache('Book 1/Chapter 4.md')).toBeNull();
        });

        it('buildInitialCache: accepts legitimate backwards-mtime rebuild when read is uncontested', async () => {
            const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            file.stat = { mtime: 2000, ctime: 1000, size: 100 };
            const { vault } = setupVaultForRebuild([file], async () => 'one two three');
            manager.updateFileCache(file, 50, vault);

            // File restored to earlier mtime before rebuild
            file.stat = { mtime: 1000, ctime: 1000, size: 20 };
            await manager.buildInitialCache(
                vault,
                (c) => (c.trim() ? c.trim().split(/\s+/).length : 0),
                (f) => manager.isEligibleForTotalWordCount(f)
            );

            expect(manager.getFileCache(file.path)).toBe(3);
            expect(manager.getFolderWordCount('Book 1')).toBe(3);
        });

        it('buildFolderCache: does not overwrite newer mtime or same-mtime editor cache and preserves racing writes on backwards-mtime', async () => {
            const fMtimeRace = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            fMtimeRace.stat = { mtime: 10, ctime: 10, size: 50 };
            const fSameMtimeRace = createTestFile('Chapter 2.md', 'Book 1/Chapter 2.md');
            fSameMtimeRace.stat = { mtime: 10, ctime: 10, size: 50 };
            const fBackwardsRace = createTestFile('Chapter 3.md', 'Book 1/Chapter 3.md');
            fBackwardsRace.stat = { mtime: 2000, ctime: 10, size: 50 };

            const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();
            const { vault } = setupVaultForRebuild(
                [fMtimeRace, fSameMtimeRace, fBackwardsRace],
                (f) => {
                    const d = createDeferred<string>();
                    deferreds.set(f.path, d);
                    return d.promise;
                }
            );

            // Seed cache with older mtime for f1 & f2, newer mtime for f3
            manager['cache'].set(fMtimeRace.path, { path: fMtimeRace.path, wordCount: 5, lastModified: 5, isFolder: false });
            manager['cache'].set(fSameMtimeRace.path, { path: fSameMtimeRace.path, wordCount: 5, lastModified: 5, isFolder: false });
            manager['cache'].set(fBackwardsRace.path, { path: fBackwardsRace.path, wordCount: 50, lastModified: 2000, isFolder: false });
            // Restore fBackwardsRace to earlier mtime 1000 so buildFolderCache picks it up
            fBackwardsRace.stat = { mtime: 1000, ctime: 10, size: 20 };

            const buildPromise = manager.buildFolderCache();

            // Wait until first read is pending, then simulate racing editor updates
            await vi.waitFor(() => expect(deferreds.has(fMtimeRace.path)).toBe(true));
            fMtimeRace.stat = { mtime: 20, ctime: 10, size: 500 };
            manager.updateFileCache(fMtimeRace, 100, vault);
            deferreds.get(fMtimeRace.path)!.resolve('one two');

            await vi.waitFor(() => expect(deferreds.has(fSameMtimeRace.path)).toBe(true));
            manager.updateFileCache(fSameMtimeRace, 200, vault);
            deferreds.get(fSameMtimeRace.path)!.resolve('one two');

            await vi.waitFor(() => expect(deferreds.has(fBackwardsRace.path)).toBe(true));
            fBackwardsRace.stat = { mtime: 3000, ctime: 10, size: 300 };
            manager.updateFileCache(fBackwardsRace, 300, vault);
            deferreds.get(fBackwardsRace.path)!.resolve('one two');

            await buildPromise;

            expect(manager.getFileCache(fMtimeRace.path)).toBe(100);
            expect(manager.getFileCache(fSameMtimeRace.path)).toBe(200);
            expect(manager.getFileCache(fBackwardsRace.path)).toBe(300);
            expect(manager.getFolderWordCount('Book 1')).toBe(600);
        });

        it('buildFolderCache: accepts legitimate backwards-mtime rebuild and updates parent totals coherently', async () => {
            const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            file.stat = { mtime: 2000, ctime: 1000, size: 100 };
            const { vault } = setupVaultForRebuild([file], async () => 'one two three four');

            manager.updateFileCache(file, 500, vault);
            file.stat = { mtime: 1000, ctime: 1000, size: 25 };

            await manager.buildFolderCache();

            expect(manager.getFileCache(file.path)).toBe(4);
            expect(manager.getFolderWordCount('Book 1')).toBe(4);
        });

        it('rejects already-deleted or already-replaced queued TFile before read starts and leaves no unbounded revision tombstones', async () => {
            const fAlreadyDeleted = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            fAlreadyDeleted.stat = { mtime: 10, ctime: 10, size: 50 };
            const fAlreadyReplaced = createTestFile('Chapter 2.md', 'Book 1/Chapter 2.md');
            fAlreadyReplaced.stat = { mtime: 10, ctime: 10, size: 50 };
            const replacement = createTestFile('Chapter 2.md', 'Book 1/Chapter 2.md');
            replacement.stat = { mtime: 20, ctime: 10, size: 80 };

            const { vault, pathMap } = setupVaultForRebuild([fAlreadyDeleted, fAlreadyReplaced], async () => 'stale old words');
            // Mutate vault authority BEFORE rebuild even starts reading
            pathMap.delete(fAlreadyDeleted.path);
            pathMap.set(fAlreadyReplaced.path, replacement);

            await manager.buildInitialCache(
                vault,
                (c) => (c.trim() ? c.trim().split(/\s+/).length : 0),
                (f) => manager.isEligibleForTotalWordCount(f)
            );
            expect(manager.getFileCache(fAlreadyDeleted.path)).toBeNull();
            expect(manager.getFileCache(fAlreadyReplaced.path)).toBeNull();

            // Also test buildFolderCache when queued file is already replaced before read
            manager['cache'].set(fAlreadyReplaced.path, { path: fAlreadyReplaced.path, wordCount: 99, lastModified: 5, isFolder: false });
            await manager.buildFolderCache();
            expect(manager.getFileCache(fAlreadyReplaced.path)).toBe(99);

            // Absent-path invalidations & updates must not leave unbounded revision map entries
            for (let i = 0; i < 50; i++) {
                manager.invalidateCache(`Book 1/Ghost-${i}.md`, vault);
            }
            expect((manager as unknown as { pathRevisions?: Map<string, number> }).pathRevisions).toBeUndefined();
            expect((manager as unknown as { activeReadTokens?: Map<string, unknown> }).activeReadTokens?.size ?? 0).toBe(0);
        });

        it('buildFolderCache: scoped cold enumeration uses tracked Markdown list instead of enumerating vault root', async () => {
            const scopedFile = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            scopedFile.stat = { mtime: 10, ctime: 10, size: 50 };
            const rootFile = createTestFile('Ignored.md', 'Ignored.md');
            rootFile.stat = { mtime: 10, ctime: 10, size: 50 };

            const { vault } = setupVaultForRebuild([scopedFile], async () => 'scoped content');
            (vault.getRoot() as TFolder).children.push(rootFile);
            const recurseSpy = vi.spyOn(Vault, 'recurseChildren');
            recurseSpy.mockClear();

            mockAdapter.exists.mockResolvedValue(false); // cold cache
            await manager.buildFolderCache();

            expect(manager.getFileCache(scopedFile.path)).toBe(2);
            expect(manager.getFileCache(rootFile.path)).toBeNull();
            // Should not recurse vault root during cold build
            expect(recurseSpy).not.toHaveBeenCalled();
            expect(vault.cachedRead).toHaveBeenCalledExactlyOnceWith(scopedFile);
            recurseSpy.mockRestore();
        });

        it.each(['cold', 'warm', 'manual'] as const)('stops a %s rebuild awaiting a read when the plugin unloads', async mode => {
            const file = createTestFile('Chapter 1.md', 'Book 1/Chapter 1.md');
            file.stat = { mtime: 10, ctime: 10, size: 50 };
            const deferred = createDeferred<string>();
            const { vault } = setupVaultForRebuild([file], () => deferred.promise);
            if (mode === "warm") {
                manager['cache'].set(file.path, { path: file.path, wordCount: 5, lastModified: 1 });
            }
            const originalMobile = Platform.isMobile;
            Platform.isMobile = true;
            try {
                mockAdapter.exists.mockResolvedValue(false);
                const build = mode === "manual"
                    ? manager.buildInitialCache(vault, () => 2)
                    : manager.buildFolderCache();
                await vi.waitFor(() => expect(vault.cachedRead).toHaveBeenCalledExactlyOnceWith(file));

                mockPlugin.isUnloading = true;
                await manager.saveCache();
                mockAdapter.write.mockClear();
                const timersAtUnload = vi.getTimerCount();
                deferred.resolve('late words after shutdown');
                await build;

                expect(manager.getFileCache(file.path)).toBe(mode === "warm" ? 5 : null);
                expect(mockAdapter.write).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(timersAtUnload);
                expect(mockWorkspace.trigger).not.toHaveBeenCalledWith('webnovel:file-word-count-updated', expect.anything(), expect.anything());
            } finally {
                Platform.isMobile = originalMobile;
            }
        });
    });
});
