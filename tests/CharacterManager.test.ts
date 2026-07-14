import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterManager } from '../src/services/CharacterManager';

describe('CharacterManager', () => {
    let mockApp: any;
    let mockPlugin: any;

    beforeEach(() => {
        mockApp = {
            vault: {
                getMarkdownFiles: vi.fn().mockReturnValue([]),
                on: vi.fn()
            },
            workspace: {
                iterateAllLeaves: vi.fn(),
                updateOptions: vi.fn()
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
            registerEvent: vi.fn()
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
});
