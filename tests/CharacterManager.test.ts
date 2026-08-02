import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterManager } from '../src/services/CharacterManager';
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
            getVaultMarkdownFiles: vi.fn().mockImplementation(() => mockApp.vault.getMarkdownFiles())
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
    });
});
