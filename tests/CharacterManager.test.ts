import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterManager, cleanLoreHeading } from '../src/services/CharacterManager';
import { TFile, TFolder } from 'obsidian';

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
        it('should correctly identify lore paths and nested folders', () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            
            // Matches exact setting
            expect(manager.isLorePath('Book1', 'Book1/Lore')).toBe(true);
            expect(manager.isLorePath('Book1', 'Book1/Lore/Characters')).toBe(true);
            expect(manager.isLorePath('Book1', 'Book1/Lore/World/Geography')).toBe(true);
            
            // Does not match wrong folder
            expect(manager.isLorePath('Book1', 'Book1/Drafts')).toBe(false);
            expect(manager.isLorePath('Book1', 'Book1/LoreCollections')).toBe(false);
            
            // Default i18n candidate ('设定' in chinese fallback)
            expect(manager.isLorePath('Book1', 'Book1/设定')).toBe(true);
            expect(manager.isLorePath('Book1', 'Book1/设定/角色')).toBe(true);
            expect(manager.isLorePath('Book1', 'Book1/设定/角色/主角')).toBe(true);
            
            // Root book ('/' or '')
            expect(manager.isLorePath('/', 'Lore/Characters')).toBe(true);
            expect(manager.isLorePath('/', '设定/角色/主角')).toBe(true);
            expect(manager.isLorePath('/', 'Drafts/Characters')).toBe(false);

            // Ignores if it is outside the bookPath entirely
            expect(manager.isLorePath('Book1', 'Book2/Lore')).toBe(false);
            expect(manager.isLorePath('Book1', 'Book2/Lore/Characters')).toBe(false);
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

    describe('Single-file Lore Mode', () => {
        it('should extract filename basename as primary heading and parse frontmatter and body aliases when no H2 exists', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);

            const mockFile = { basename: 'Protagonist', path: 'Book1/Lore/Characters/Protagonist.md', parent: { path: 'Book1/Lore/Characters' } };
            const mockFileCache = {
                headings: [
                    { heading: 'Protagonist Bio', level: 1, position: { end: { line: 4 }, start: { line: 4 } } }
                ],
                frontmatter: {
                    aliases: ['Hero', 'Champion'],
                    type: 'Main'
                }
            };

            mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue(mockFileCache);
            mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`---
aliases: [Hero, Champion]
type: Main
---
# Protagonist Bio
**Alias**: Savior
Main character description...`);

            const targetCache = new Map();
            const targetLowerMap = new Map();

            await manager['addFileToCacheIfValidInto'](mockFile as any, targetCache, targetLowerMap);

            const bookCache = targetCache.get('Book1');
            expect(bookCache).toBeDefined();

            // Basename as primary heading
            expect(bookCache.get('Protagonist')).toBeDefined();
            expect(bookCache.get('Protagonist').heading).toBe('Protagonist');

            // Frontmatter aliases
            expect(bookCache.get('Hero')).toBeDefined();
            expect(bookCache.get('Hero').heading).toBe('Protagonist');
            expect(bookCache.get('Champion')).toBeDefined();
            expect(bookCache.get('Champion').heading).toBe('Protagonist');

            // Body text alias
            expect(bookCache.get('Savior')).toBeDefined();
            expect(bookCache.get('Savior').heading).toBe('Protagonist');
        });

        it('should get and update content properly for single-file lore', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const mockFile = { basename: 'LinLei', path: 'Book1/设定/角色/LinLei.md' };
            const entry = { file: mockFile as any, heading: 'LinLei' };

            mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({ headings: [] });
            mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`---
aliases: [Dragon]
---
# LinLei
LinLei is a dragon warrior.`);

            const content = await manager.getLoreContent(entry);
            expect(content).toBe('LinLei is a dragon warrior.');

            // Update content in single-file mode
            mockApp.vault.process = vi.fn().mockImplementation(async (file, callback) => {
                const original = `---
aliases: [Dragon]
---
# LinLei
LinLei is a dragon warrior.`;
                const result = callback(original);
                expect(result).toContain('aliases: [Dragon]');
                expect(result).toContain('# LinLei');
                expect(result).toContain('Updated warrior story.');
                return result;
            });

            const success = await manager.updateLoreContent(entry, 'Updated warrior story.');
            expect(success).toBe(true);
        });
    });

    describe('Nested Folder Operations', () => {
        it('should create nested parent directories when creating a lore entry in subcategory', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const createdFolders: string[] = [];
            const createdFiles: string[] = [];

            const mockLoreFolder = new TFolder();
            mockLoreFolder.path = 'Book1/Lore';
            mockLoreFolder.name = 'Lore';

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore') return mockLoreFolder;
                return null;
            });

            mockApp.vault.createFolder = vi.fn().mockImplementation(async (p: string) => {
                createdFolders.push(p);
            });

            mockApp.vault.create = vi.fn().mockImplementation(async (p: string, _content: string) => {
                createdFiles.push(p);
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            const result = await manager.createLoreEntry(
                'Book1',
                'Characters/Major/Protagonist',
                'LinLei',
                'Dragon',
                'Hero',
                'A brave hero',
                []
            );

            expect(result).toBe(true);
            expect(createdFolders).toContain('Book1/Lore/Characters');
            expect(createdFolders).toContain('Book1/Lore/Characters/Major');
            expect(createdFiles).toContain('Book1/Lore/Characters/Major/Protagonist.md');
        });

        it('should format same-file and cross-file relation links cleanly in createLoreEntry', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            let createdContent = '';

            const mockLoreFolder = new TFolder();
            mockLoreFolder.path = 'Book1/Lore';
            mockLoreFolder.name = 'Lore';

            const sameFile = { basename: 'Characters', path: 'Book1/Lore/Characters.md' };
            const singleFile = { basename: 'Hero', path: 'Book1/Lore/Characters/Major/Hero.md' };
            const otherMultiFile = { basename: 'SideCharacters', path: 'Book1/Lore/Characters/Minor/SideCharacters.md' };

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore') return mockLoreFolder;
                return null;
            });

            mockApp.metadataCache.fileToLinktext = vi.fn().mockImplementation((file: any) => {
                if (file.path === 'Book1/Lore/Characters/Major/Hero.md') return 'Characters/Major/Hero';
                if (file.path === 'Book1/Lore/Characters/Minor/SideCharacters.md') return 'Characters/Minor/SideCharacters';
                return file.basename;
            });

            mockApp.vault.create = vi.fn().mockImplementation(async (_p: string, content: string) => {
                createdContent = content;
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            // Mock getCharacterFile return values
            manager.getCharacterFile = vi.fn().mockImplementation((_bookPath: string, name: string) => {
                if (name === 'ZhangSan') return { file: sameFile as any, heading: 'ZhangSan' };
                if (name === 'SanGe') return { file: sameFile as any, heading: 'ZhangSan' }; // alias in same file
                if (name === 'Hero') return { file: singleFile as any, heading: 'Hero' }; // single-file lore in nested dir
                if (name === 'DragonLord') return { file: singleFile as any, heading: 'Hero' }; // single-file lore alias
                if (name === 'WangWu') return { file: otherMultiFile as any, heading: 'WangWu' }; // cross-file multi-entry in nested dir
                if (name === 'LaoWang') return { file: otherMultiFile as any, heading: 'WangWu' }; // cross-file multi-entry alias
                return null;
            });

            const result = await manager.createLoreEntry(
                'Book1',
                'Characters',
                'LiSi',
                'Four',
                'Side',
                'Description',
                [
                    { label: '朋友', target: 'ZhangSan' },
                    { label: '义弟', target: 'SanGe' },
                    { label: '偶像', target: 'Hero' },
                    { label: '战神', target: 'DragonLord' },
                    { label: '同门', target: 'WangWu' },
                    { label: '师兄', target: 'LaoWang' },
                    { label: '未名', target: 'UnknownPerson' },
                    { label: '手动', target: '[[CustomLink]]' }
                ]
            );

            expect(result).toBe(true);
            // Same file heading: [[#ZhangSan]] (no file prefix!)
            expect(createdContent).toContain('**朋友**：[[#ZhangSan]]');
            // Same file alias: [[#ZhangSan|SanGe]] (no file prefix!)
            expect(createdContent).toContain('**义弟**：[[#ZhangSan|SanGe]]');
            // Cross-file single file with nested path: [[Characters/Major/Hero]]
            expect(createdContent).toContain('**偶像**：[[Characters/Major/Hero]]');
            // Cross-file single file alias with nested path: [[Characters/Major/Hero|DragonLord]]
            expect(createdContent).toContain('**战神**：[[Characters/Major/Hero|DragonLord]]');
            // Cross-file multi-entry with nested path: [[Characters/Minor/SideCharacters#WangWu|WangWu]]
            expect(createdContent).toContain('**同门**：[[Characters/Minor/SideCharacters#WangWu|WangWu]]');
            // Cross-file multi-entry alias with nested path: [[Characters/Minor/SideCharacters#WangWu|LaoWang]]
            expect(createdContent).toContain('**师兄**：[[Characters/Minor/SideCharacters#WangWu|LaoWang]]');
            // Unknown: [[#UnknownPerson]]
            expect(createdContent).toContain('**未名**：[[#UnknownPerson]]');
            // Explicit link: [[CustomLink]]
            expect(createdContent).toContain('**手动**：[[CustomLink]]');
        });
    });

    describe('Incremental Lore Cache Updates', () => {
        let manager: CharacterManager;
        let file1: any;
        let file2: any;

        beforeEach(async () => {
            manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockImplementation((f: any) => {
                if (!f || !f.path) return null;
                if (f.path.startsWith('Book1/')) return 'Book1';
                return null;
            });
            manager.isLorePath = vi.fn().mockImplementation((bookPath: string, parentPath: string) => {
                return bookPath === 'Book1' && (parentPath === 'Book1/Lore' || parentPath.startsWith('Book1/Lore/'));
            });

            file1 = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/Alice.md',
                basename: 'Alice',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            file2 = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/Bob.md',
                basename: 'Bob',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Alice.md') {
                    return {
                        headings: [{ heading: 'Alice', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                if (f.path === 'Book1/Lore/Bob.md') {
                    return {
                        headings: [{ heading: 'Bob', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                return {};
            });

            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Alice.md') {
                    return Promise.resolve('## Alice\n**Alias**: Ally');
                }
                if (f.path === 'Book1/Lore/Bob.md') {
                    return Promise.resolve('## Bob\n**Alias**: Bobby');
                }
                return Promise.resolve('');
            });

            mockApp.vault.getMarkdownFiles.mockReturnValue([file1, file2]);
            await manager.initialize();
        });

        it('should incrementally update cache on single-file modify with deterministic operation counts', async () => {
            expect(manager.getCharacterFile('Book1', 'Alice')?.heading).toBe('Alice');
            expect(manager.getCharacterFile('Book1', 'Ally')?.heading).toBe('Alice');
            expect(manager.getCharacterFile('Book1', 'Bob')?.heading).toBe('Bob');

            // Reset mock call counts
            mockApp.vault.cachedRead.mockClear();
            mockApp.vault.read.mockClear();
            mockPlugin.getVaultMarkdownFiles.mockClear();
            mockPlugin.getTrackedMarkdownFiles.mockClear();
            mockApp.vault.getMarkdownFiles.mockClear();
            mockApp.workspace.trigger.mockClear();
            const prevVersion = manager.cacheVersion;

            // Modify Alice to add new alias "Superstar" and change heading
            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Alice.md') {
                    return {
                        headings: [{ heading: 'Alice', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                return {};
            });
            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Alice.md') {
                    return Promise.resolve('## Alice\n**Alias**: Ally, Superstar\nUpdated bio...');
                }
                return Promise.resolve('');
            });

            const updated = await manager.updateFileCache(file1);
            expect(updated).toBe(true);

            // Operation count assertions: exactly 1 file read, 0 vault enumerations
            expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
            expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(file1);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(0);
            expect(mockPlugin.getVaultMarkdownFiles).toHaveBeenCalledTimes(0);
            expect(mockPlugin.getTrackedMarkdownFiles).toHaveBeenCalledTimes(0);
            expect(mockApp.vault.getMarkdownFiles).toHaveBeenCalledTimes(0);

            // Verify cache contents
            expect(manager.getCharacterFile('Book1', 'Superstar')?.heading).toBe('Alice');
            expect(manager.getCharacterFile('Book1', 'superstar')?.heading).toBe('Alice'); // Case-insensitive
            expect(manager.getCharacterFile('Book1', 'Ally')?.heading).toBe('Alice');
            expect(manager.getCharacterFile('Book1', 'Bob')?.heading).toBe('Bob'); // Unrelated file untouched

            // Version and notification assertions
            expect(manager.cacheVersion).toBe(prevVersion + 1);
            expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-lore-updated');
        });

        it('should incrementally remove deleted file contributions with zero file reads and zero vault enumerations', () => {
            expect(manager.getCharacterFile('Book1', 'Bob')?.heading).toBe('Bob');

            mockApp.vault.cachedRead.mockClear();
            mockApp.vault.read.mockClear();
            mockPlugin.getVaultMarkdownFiles.mockClear();
            mockPlugin.getTrackedMarkdownFiles.mockClear();
            mockApp.vault.getMarkdownFiles.mockClear();
            mockApp.workspace.trigger.mockClear();
            const prevVersion = manager.cacheVersion;

            const removed = manager.removeFileFromCache(file2.path);
            expect(removed).toBe(true);

            // Deterministic operation-count assertions: 0 reads, 0 vault enumerations
            expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(0);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(0);
            expect(mockPlugin.getVaultMarkdownFiles).toHaveBeenCalledTimes(0);
            expect(mockPlugin.getTrackedMarkdownFiles).toHaveBeenCalledTimes(0);
            expect(mockApp.vault.getMarkdownFiles).toHaveBeenCalledTimes(0);

            // Bob entries removed, Alice entries preserved
            expect(manager.getCharacterFile('Book1', 'Bob')).toBeNull();
            expect(manager.getCharacterFile('Book1', 'Bobby')).toBeNull();
            expect(manager.getCharacterFile('Book1', 'Alice')?.heading).toBe('Alice');
            expect(manager.getCharacterFile('Book1', 'Ally')?.heading).toBe('Alice');

            expect(manager.cacheVersion).toBe(prevVersion + 1);
            expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-lore-updated');
        });

        it('should handle file rename within lore folder by updating path and preserving cache integrity', async () => {
            const renamedFile = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/Hero.md',
                basename: 'Hero',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Hero.md') {
                    return {
                        headings: [{ heading: 'Hero', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                return {};
            });
            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Hero.md') {
                    return Promise.resolve('## Hero\n**Alias**: Champion');
                }
                return Promise.resolve('');
            });

            mockApp.vault.cachedRead.mockClear();
            mockPlugin.getVaultMarkdownFiles.mockClear();
            mockPlugin.getTrackedMarkdownFiles.mockClear();
            const prevVersion = manager.cacheVersion;

            const renamed = await manager.handleFileRename(renamedFile, file1.path);
            expect(renamed).toBe(true);

            expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
            expect(mockPlugin.getVaultMarkdownFiles).toHaveBeenCalledTimes(0);

            // Old Alice entries removed
            expect(manager.getCharacterFile('Book1', 'Alice')).toBeNull();
            expect(manager.getCharacterFile('Book1', 'Ally')).toBeNull();

            // New Hero entries present
            expect(manager.getCharacterFile('Book1', 'Hero')?.heading).toBe('Hero');
            expect(manager.getCharacterFile('Book1', 'Hero')?.file.path).toBe('Book1/Lore/Hero.md');
            expect(manager.getCharacterFile('Book1', 'Champion')?.heading).toBe('Hero');

            expect(manager.cacheVersion).toBe(prevVersion + 1);
        });

        it('should cleanly remove lore entries when a file is moved out of lore folder without leaving stale entries', async () => {
            const movedOutFile = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Drafts/Alice.md',
                basename: 'Alice',
                extension: 'md',
                parent: { path: 'Book1/Drafts' }
            });

            mockApp.vault.cachedRead.mockClear();
            mockPlugin.getVaultMarkdownFiles.mockClear();
            mockPlugin.getTrackedMarkdownFiles.mockClear();
            const prevVersion = manager.cacheVersion;

            const moved = await manager.handleFileRename(movedOutFile, file1.path);
            expect(moved).toBe(true);

            // Zero reads for moved-out file, 0 vault enumerations
            expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(0);
            expect(mockPlugin.getVaultMarkdownFiles).toHaveBeenCalledTimes(0);

            // Alice entries are completely purged
            expect(manager.getCharacterFile('Book1', 'Alice')).toBeNull();
            expect(manager.getCharacterFile('Book1', 'Ally')).toBeNull();
            expect(manager.getCharactersForBook('Book1')).not.toContain('Alice');
            expect(manager.getCharactersForBook('Book1')).not.toContain('Ally');

            // Bob entries remain intact
            expect(manager.getCharacterFile('Book1', 'Bob')?.heading).toBe('Bob');
            expect(manager.cacheVersion).toBe(prevVersion + 1);
        });

        it('should preserve duplicate contributions deterministically across multiple files', async () => {
            const sharedA = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/TeamA.md',
                basename: 'TeamA',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });
            const sharedB = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/TeamB.md',
                basename: 'TeamB',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/TeamA.md') {
                    return {
                        headings: [{ heading: 'LeaderA', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                if (f.path === 'Book1/Lore/TeamB.md') {
                    return {
                        headings: [{ heading: 'LeaderB', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                return {};
            });

            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/TeamA.md') {
                    return Promise.resolve('## LeaderA\n**Alias**: Boss');
                }
                if (f.path === 'Book1/Lore/TeamB.md') {
                    return Promise.resolve('## LeaderB\n**Alias**: Boss');
                }
                return Promise.resolve('');
            });

            await manager.updateFileCache(sharedA);
            await manager.updateFileCache(sharedB);

            // Both contribute alias 'Boss'
            expect(manager.getCharacterFile('Book1', 'Boss')).toBeDefined();

            // Update TeamA to change its alias to 'Chief' (removing 'Boss' from TeamA)
            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/TeamA.md') {
                    return Promise.resolve('## LeaderA\n**Alias**: Chief');
                }
                if (f.path === 'Book1/Lore/TeamB.md') {
                    return Promise.resolve('## LeaderB\n**Alias**: Boss');
                }
                return Promise.resolve('');
            });

            await manager.updateFileCache(sharedA);

            // 'Boss' must STILL be in cache because TeamB still contributes 'Boss'
            expect(manager.getCharacterFile('Book1', 'Boss')?.heading).toBe('LeaderB');
            expect(manager.getCharacterFile('Book1', 'Chief')?.heading).toBe('LeaderA');

            // Remove TeamB: now 'Boss' should be removed, while 'Chief' and 'LeaderA' remain
            manager.removeFileFromCache(sharedB.path);
            expect(manager.getCharacterFile('Book1', 'Boss')).toBeNull();
            expect(manager.getCharacterFile('Book1', 'Chief')?.heading).toBe('LeaderA');
        });

        it('should preserve file order in getLoreEntriesInFileOrder across in-place incremental updates', async () => {
            const orderA = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/01_Alpha.md',
                basename: '01_Alpha',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });
            const orderB = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/02_Beta.md',
                basename: '02_Beta',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });
            const orderC = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/03_Gamma.md',
                basename: '03_Gamma',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/01_Alpha.md') return { headings: [{ heading: 'Alpha', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }] };
                if (f.path === 'Book1/Lore/02_Beta.md') return { headings: [{ heading: 'Beta', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }] };
                if (f.path === 'Book1/Lore/03_Gamma.md') return { headings: [{ heading: 'Gamma', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }] };
                return {};
            });

            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/01_Alpha.md') return Promise.resolve('## Alpha');
                if (f.path === 'Book1/Lore/02_Beta.md') return Promise.resolve('## Beta');
                if (f.path === 'Book1/Lore/03_Gamma.md') return Promise.resolve('## Gamma');
                return Promise.resolve('');
            });

            manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);
            mockApp.vault.getMarkdownFiles.mockReturnValue([orderA, orderB, orderC]);
            await manager.initialize();

            expect(manager.getLoreEntriesInFileOrder('Book1').map(e => e.heading)).toEqual(['Alpha', 'Beta', 'Gamma']);

            // Update Beta in-place
            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/02_Beta.md') return Promise.resolve('## Beta\n**Alias**: B2');
                return Promise.resolve('');
            });

            await manager.updateFileCache(orderB);

            // Insertion order must remain Alpha, Beta, Gamma
            expect(manager.getLoreEntriesInFileOrder('Book1').map(e => e.heading)).toEqual(['Alpha', 'Beta', 'Gamma']);
            expect(manager.getCharacterFile('Book1', 'B2')?.heading).toBe('Beta');
        });

        it('should preserve deterministic original file enumeration order during rebuildCache even when cachedRead resolves out of order', async () => {
            const firstFile = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/01_First.md',
                basename: '01_First',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });
            const secondFile = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/02_Second.md',
                basename: '02_Second',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/01_First.md') return { headings: [{ heading: 'First', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }] };
                if (f.path === 'Book1/Lore/02_Second.md') return { headings: [{ heading: 'Second', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }] };
                return {};
            });

            let resolveFirst: (val: string) => void = () => {};
            const firstPromise = new Promise<string>((resolve) => {
                resolveFirst = resolve;
            });

            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/01_First.md') return firstPromise;
                if (f.path === 'Book1/Lore/02_Second.md') return Promise.resolve('## Second');
                return Promise.resolve('');
            });

            manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            manager.isLorePath = vi.fn().mockReturnValue(true);
            mockApp.vault.getMarkdownFiles.mockReturnValue([firstFile, secondFile]);

            const rebuildPromise = manager.rebuildCache();
            // Let the event loop process secondFile first
            await new Promise(r => setTimeout(r, 10));
            // Now resolve firstFile
            resolveFirst('## First');
            await rebuildPromise;

            // In-order entries must still have 'First' before 'Second'
            const entries = manager.getLoreEntriesInFileOrder('Book1');
            expect(entries.map(e => e.heading)).toEqual(['First', 'Second']);
        });

        it('should keep old contributions removed and notify observers once if parseLoreFile fails during rename', async () => {
            const corruptedFile = Object.assign(Object.create(TFile.prototype), {
                path: 'Book1/Lore/Corrupted.md',
                basename: 'Corrupted',
                extension: 'md',
                parent: { path: 'Book1/Lore' }
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Corrupted.md') {
                    return { headings: [{ heading: 'Corrupted', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }] };
                }
                return {};
            });

            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book1/Lore/Corrupted.md') {
                    return Promise.reject(new Error('Corrupted disk read'));
                }
                return Promise.resolve('');
            });

            mockApp.workspace.trigger.mockClear();
            const prevVersion = manager.cacheVersion;

            await expect(manager.handleFileRename(corruptedFile, file1.path)).rejects.toThrow('Corrupted disk read');

            // Old Alice entries must remain removed
            expect(manager.getCharacterFile('Book1', 'Alice')).toBeNull();
            expect(manager.getCharacterFile('Book1', 'Ally')).toBeNull();
            // Still preserves uncorrupted Bob
            expect(manager.getCharacterFile('Book1', 'Bob')?.heading).toBe('Bob');

            // Observers notified exactly once and version incremented
            expect(manager.cacheVersion).toBe(prevVersion + 1);
            expect(mockApp.workspace.trigger).toHaveBeenCalledTimes(1);
            expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-lore-updated');
        });

        it('should clean up empty per-book contribution maps and caches when last file is removed or moved', () => {
            expect(manager.getCharacterFile('Book1', 'Alice')).toBeDefined();
            expect(manager.getCharacterFile('Book1', 'Bob')).toBeDefined();

            manager.removeFileFromCache(file1.path);
            expect(manager['fileContributions'].has('Book1')).toBe(true);

            manager.removeFileFromCache(file2.path);
            // All files removed for Book1
            expect(manager['fileContributions'].has('Book1')).toBe(false);
            expect(manager['characterCache'].has('Book1')).toBe(false);
            expect(manager['lowercaseKeyMap'].has('Book1')).toBe(false);
            expect(manager.getCharactersForBook('Book1')).toEqual([]);
        });

        it('should notify once total and increment cacheVersion once when renaming across books', async () => {
            const crossBookFile = Object.assign(Object.create(TFile.prototype), {
                path: 'Book2/Lore/AliceMoved.md',
                basename: 'AliceMoved',
                extension: 'md',
                parent: { path: 'Book2/Lore' }
            });

            manager.getBookPathForFile = vi.fn().mockImplementation((f: any) => {
                if (!f || !f.path) return null;
                if (f.path.startsWith('Book1/')) return 'Book1';
                if (f.path.startsWith('Book2/')) return 'Book2';
                return null;
            });
            manager.isLorePath = vi.fn().mockImplementation((bookPath: string, parentPath: string) => {
                if (bookPath === 'Book1') return parentPath === 'Book1/Lore' || parentPath.startsWith('Book1/Lore/');
                if (bookPath === 'Book2') return parentPath === 'Book2/Lore' || parentPath.startsWith('Book2/Lore/');
                return false;
            });

            mockApp.metadataCache.getFileCache = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book2/Lore/AliceMoved.md') {
                    return {
                        headings: [{ heading: 'AliceMoved', level: 2, position: { start: { line: 0 }, end: { line: 0 } } }]
                    };
                }
                return {};
            });
            mockApp.vault.cachedRead = vi.fn().mockImplementation((f: any) => {
                if (f.path === 'Book2/Lore/AliceMoved.md') {
                    return Promise.resolve('## AliceMoved\n**Alias**: Traveler');
                }
                return Promise.resolve('');
            });

            mockApp.workspace.trigger.mockClear();
            const prevVersion = manager.cacheVersion;

            const renamed = await manager.handleFileRename(crossBookFile, file1.path);
            expect(renamed).toBe(true);

            // Removed from Book1, added to Book2
            expect(manager.getCharacterFile('Book1', 'Alice')).toBeNull();
            expect(manager.getCharacterFile('Book2', 'AliceMoved')?.heading).toBe('AliceMoved');
            expect(manager.getCharacterFile('Book2', 'Traveler')?.heading).toBe('AliceMoved');

            // Notified once total, version incremented once
            expect(manager.cacheVersion).toBe(prevVersion + 1);
            expect(mockApp.workspace.trigger).toHaveBeenCalledTimes(1);
            expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-lore-updated');
        });

        it('should ignore folder create events and fall back to debounced rebuild for folder delete/rename', () => {
            const mockFolder = Object.assign(Object.create(TFolder.prototype), {
                path: 'Book1/Lore/SubFolder',
                name: 'SubFolder'
            });

            const rebuildSpy = vi.spyOn(manager, 'rebuildCache').mockResolvedValue(undefined);
            const debounceMock = vi.fn();
            mockPlugin.adaptiveDebounceManager = { debounceFixed: debounceMock };

            // Folder create should do nothing (no rebuild, no debounce)
            manager.handleFileChange(mockFolder, 'create');
            expect(rebuildSpy).not.toHaveBeenCalled();
            expect(debounceMock).not.toHaveBeenCalled();

            // Folder delete should trigger debounced rebuild
            manager.handleFileChange(mockFolder, 'delete');
            expect(debounceMock).toHaveBeenCalledWith('rebuild-character-cache', expect.any(Function), 500);

            // Folder rename should trigger debounced rebuild
            debounceMock.mockClear();
            manager.handleFileChange(mockFolder, 'rename', 'Book1/Lore/OldSubFolder');
            expect(debounceMock).toHaveBeenCalledWith('rebuild-character-cache', expect.any(Function), 500);
        });
    });
});
