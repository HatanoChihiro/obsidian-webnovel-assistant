import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterManager, cleanLoreHeading } from '../src/services/CharacterManager';
import { TFile } from 'obsidian';

describe('CharacterManager', () => {
    let mockApp: any;
    let mockPlugin: any;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockApp = {
            vault: {
                getMarkdownFiles: vi.fn().mockReturnValue([]),
                on: vi.fn(),
                cachedRead: vi.fn(),
                read: vi.fn(),
                modify: vi.fn(),
                process: vi.fn()
            },
            workspace: {
                iterateAllLeaves: vi.fn(),
                updateOptions: vi.fn(),
                trigger: vi.fn()
            },
            metadataCache: {
                on: vi.fn(),
                getFileCache: vi.fn().mockReturnValue({})
            }
		};
        mockPlugin = {
            settings: {
                loreFolderName: 'Lore'
            },
            registerEvent: vi.fn(),
            getVaultMarkdownFiles: vi.fn().mockImplementation(() => mockApp.vault.getMarkdownFiles()),
            getTrackedMarkdownFiles: vi.fn().mockImplementation(() => mockApp.vault.getMarkdownFiles())
        };
    });

    describe('isLorePath', () => {
        it('should correctly identify lore paths', () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            
            // Matches exact setting
            expect(manager.isLorePath('Book1', 'Book1/Lore')).toBe(true);
            
            // Does not match wrong folder
            expect(manager.isLorePath('Book1', 'Book1/Drafts')).toBe(false);
            
            // Default i18n candidate ('设定' in chinese fallback)
            expect(manager.isLorePath('Book1', 'Book1/设定')).toBe(true);
            
            // Ignores if it is outside the bookPath entirely
            expect(manager.isLorePath('Book1', 'Book2/Lore')).toBe(false);
        });
    });

    describe('Initialization & Caching', () => {
        it('should extract aliases and headings from a lore file', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);
            
            const mockFile = { path: 'Book1/Lore/Characters.md', parent: { path: 'Book1/Lore' } };
            const mockFileCache = {
                headings: [
                    { heading: 'John Doe', level: 2, position: { end: { line: 1 }, start: { line: 1 } } }
                ]
            };
            
            mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue(mockFileCache);
            mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
## John Doe
**Alias**: JD, Johnny
Some lore content...
            `);

            const targetCache = new Map();
            const targetLowerMap = new Map();

            await manager['addFileToCacheIfValidInto'](mockFile as any, targetCache, targetLowerMap);
            
            const bookCache = targetCache.get('Book1');
            expect(bookCache).toBeDefined();
            
            // Primary Heading
            expect(bookCache.get('John Doe')).toBeDefined();
            expect(bookCache.get('John Doe').heading).toBe('John Doe');

            // Aliases
            expect(bookCache.get('JD')).toBeDefined();
            expect(bookCache.get('JD').heading).toBe('John Doe');

            expect(bookCache.get('Johnny')).toBeDefined();
            expect(bookCache.get('Johnny').heading).toBe('John Doe');
            
            // Lowercase mapping for quick O(1) fallback
            const lowerMap = targetLowerMap.get('Book1');
            expect(lowerMap.get('john doe')).toBe('John Doe');
            expect(lowerMap.get('jd')).toBe('JD');
        });
    });

    describe('Cache Access Methods', () => {
        beforeEach(async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);
            
            const mockFile = { path: 'Book1/Lore/Characters.md', parent: { path: 'Book1/Lore' } };
            const mockFileCache = {
                headings: [
                    { heading: 'John Doe', level: 2, position: { end: { line: 1 }, start: { line: 1 } } },
                    { heading: 'Jane Doe', level: 2, position: { end: { line: 3 }, start: { line: 3 } } }
                ]
            };
            
            mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue(mockFileCache);
            mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
## John Doe
**Alias**: JD
## Jane Doe
            `);
            mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
            
            await manager.rebuildCache();
            // Store the manager on mockApp for other tests to access
            mockApp.manager = manager;
        });

        it('getCharactersForBook should return sorted character keys', () => {
            const manager = mockApp.manager;
            const keys = manager.getCharactersForBook('Book1');
            // Sorted by length descending: 'Jane Doe' (8), 'John Doe' (8), 'JD' (2)
            expect(keys).toContain('John Doe');
            expect(keys).toContain('Jane Doe');
            expect(keys).toContain('JD');
        });

        it('getLoreEntriesInFileOrder should return unique entries', () => {
            const manager = mockApp.manager;
            const entries = manager.getLoreEntriesInFileOrder('Book1');
            
            expect(entries.length).toBe(2);
            expect(entries[0].heading).toBe('John Doe');
            expect(entries[1].heading).toBe('Jane Doe');
        });

        it('getCharacterFile should find entry by exact match or alias', () => {
            const manager = mockApp.manager;
            
            const exact = manager.getCharacterFile('Book1', 'John Doe');
            expect(exact).toBeDefined();
            expect(exact?.heading).toBe('John Doe');
            
            const alias = manager.getCharacterFile('Book1', 'JD');
            expect(alias).toBeDefined();
            expect(alias?.heading).toBe('John Doe');
            
            const lowercase = manager.getCharacterFile('Book1', 'jd');
            expect(lowercase).toBeDefined();
            expect(lowercase?.heading).toBe('John Doe');
            
            const notFound = manager.getCharacterFile('Book1', 'Missing');
            expect(notFound).toBeNull();
        });

        it('should properly rebuild cache when workspaceFolders is configured', async () => {
            mockPlugin.settings.workspaceFolders = ['Book1'];
            const mockFile = { path: 'Book1/Lore/Characters.md', parent: { path: 'Book1/Lore' } };
            mockPlugin.getTrackedMarkdownFiles = vi.fn().mockImplementation((includeLore: boolean) => {
                return includeLore ? [mockFile] : [];
            });
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);

            await manager.rebuildCache();

            expect(mockPlugin.getTrackedMarkdownFiles).toHaveBeenCalledWith(true);
            const keys = manager.getCharactersForBook('Book1');
            expect(keys).toContain('John Doe');
        });

        it('should clean wikilinks, hashtags, and formatting in cleanLoreHeading', () => {
            expect(cleanLoreHeading('## [[张三]]')).toBe('张三');
            expect(cleanLoreHeading('[[设定/角色#张三|小张]]')).toBe('小张');
            expect(cleanLoreHeading('**张三** #主角')).toBe('张三');
            expect(cleanLoreHeading('  张三  ')).toBe('张三');
        });

        it('should parse wikilink headings and semicolon separated aliases', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);

            const mockFile = { path: 'Book1/Lore/Characters.md', parent: { path: 'Book1/Lore' } };
            const mockFileCache = {
                headings: [
                    { heading: '[[张三]]', level: 2, position: { end: { line: 1 }, start: { line: 1 } } }
                ]
            };

            mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue(mockFileCache);
            mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
## [[张三]]
**别名**：三哥；老张
            `);

            const targetCache = new Map();
            const targetLowerMap = new Map();

            await manager['addFileToCacheIfValidInto'](mockFile as any, targetCache, targetLowerMap);
            const bookCache = targetCache.get('Book1');
            expect(bookCache).toBeDefined();
            expect(bookCache.get('张三')).toBeDefined();
            expect(bookCache.get('三哥')).toBeDefined();
            expect(bookCache.get('老张')).toBeDefined();
        });

        it('should handle concurrent calls to ensureInitialized and initialize sharing one rebuild and registering events once', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);
            const rebuildSpy = vi.spyOn(manager, 'rebuildCache').mockResolvedValue();

            const p1 = manager.ensureInitialized();
            const p2 = manager.ensureInitialized();
            const p3 = manager.initialize();

            await Promise.all([p1, p2, p3]);

            // Register events should be called 4 times total (for create, delete, rename, modify)
            expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(4);
            expect(rebuildSpy).toHaveBeenCalledTimes(1);
        });

        it('should allow retrying initialize after a rebuild failure without swallowing errors', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);

            // First attempt fails
            mockPlugin.getVaultMarkdownFiles = vi.fn().mockImplementationOnce(() => {
                throw new Error('Initial disk error');
            });

            await expect(manager.initialize()).rejects.toThrow('Initial disk error');
            expect(manager['_initialized']).toBe(false);
            expect(manager['_initPromise']).toBeNull();

            // Second attempt succeeds
            mockPlugin.getVaultMarkdownFiles = vi.fn().mockReturnValue([]);
            await expect(manager.initialize()).resolves.toBeUndefined();
            expect(manager['_initialized']).toBe(true);
            expect(manager['_initPromise']).toBeNull();

            // Event listeners should still only have been registered once (4 times total)
            expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(4);
        });

        it('rebuildCache should reject when top-level enumeration fails without falling back to getMarkdownFiles', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            mockPlugin.getVaultMarkdownFiles = vi.fn().mockImplementation(() => {
                throw new Error('Top-level enumeration failed');
            });
			mockApp.vault.getMarkdownFiles.mockClear();

            await expect(manager.rebuildCache()).rejects.toThrow('Top-level enumeration failed');
            expect(mockApp.vault.getMarkdownFiles).not.toHaveBeenCalled();
        });

        it('should isolate per-file failure during rebuildCache so valid files are cached', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);

            const corruptedFile = { path: 'Book1/Lore/Corrupted.md', parent: { path: 'Book1/Lore' } };
            const validFile = { path: 'Book1/Lore/Valid.md', parent: { path: 'Book1/Lore' } };

            mockApp.vault.getMarkdownFiles.mockReturnValue([corruptedFile, validFile]);

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((file: any) => {
                if (file.path.includes('Valid')) {
                    return {
                        headings: [
                            { heading: 'Hero', level: 2, position: { end: { line: 1 }, start: { line: 1 } } }
                        ]
                    };
                }
                return {};
            });

            mockApp.vault.cachedRead = vi.fn().mockImplementation((file: any) => {
                if (file.path.includes('Corrupted')) {
                    return Promise.reject(new Error('Disk read error'));
                }
                return Promise.resolve(`
## Hero
**Alias**: Champion
                `);
            });

            await manager.rebuildCache();

            // Cache for Book1 should contain Hero and Champion, despite Corrupted.md throwing
            const chars = manager.getCharactersForBook('Book1');
            expect(chars).toContain('Hero');
            expect(chars).toContain('Champion');
            expect(manager.cacheVersion).toBeGreaterThan(0);
        });

        it('should handle workspace dispatch and trigger errors gracefully during rebuildCache', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);
            mockApp.vault.getMarkdownFiles.mockReturnValue([]);

            mockApp.workspace.iterateAllLeaves = vi.fn().mockImplementation(() => {
                throw new Error('Workspace leaf iteration error');
            });
            mockApp.workspace.trigger = vi.fn().mockImplementation(() => {
                throw new Error('Workspace trigger error');
            });

            // Rebuild should not reject even if workspace calls throw
            await expect(manager.rebuildCache()).resolves.toBeUndefined();
            expect(manager.cacheVersion).toBeGreaterThan(0);
        });
    });
});
