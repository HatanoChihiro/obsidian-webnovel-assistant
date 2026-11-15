import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterManager, cleanLoreHeading } from '../src/services/CharacterManager';
import { parseLoreTemplate } from '../src/services/LoreTemplateService';
import { TFile, TFolder, parseYaml } from 'obsidian';
import type { App } from 'obsidian';
import { Text } from '@codemirror/state';
import type { Decoration, DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { buildCharacterHoverExtension, type CharacterHoverPlugin } from '../src/editor/CharacterHoverExtension';

describe('Character hover occurrence identity', () => {
    const file = Object.assign(new TFile(), { name: 'Chapter.md', path: 'Book1/Chapter.md' });

    function createHover(text: string) {
        const view = {
            state: { doc: Text.of(text.split('\n')), field: () => ({ file }) },
            visibleRanges: [{ from: 0, to: text.length }]
        } as unknown as EditorView;
        const plugin = {
            characterManager: {
                cacheVersion: 1,
                getBookPathForFile: () => 'Book1',
                getCharactersForBook: () => ['南总']
            }
        } as unknown as CharacterHoverPlugin;
        const extension = buildCharacterHoverExtension({} as App, plugin);
        const instance = (extension as unknown as { create: (view: EditorView) => {
            decorations: DecorationSet;
            update: (update: ViewUpdate) => void;
        } }).create(view);
        return { view, instance };
    }

    function readMatches(decorations: DecorationSet, length: number) {
        const matches: { from: number; to: number; decoration: Decoration }[] = [];
        decorations.between(0, length, (from, to, decoration) => {
            matches.push({ from, to, decoration });
        });
        return matches;
    }

    it('distinguishes repeated names in one dialogue during DOM reuse', () => {
        const text = '“南总是这样的南总是这样的南总”';
        const { instance } = createHover(text);
        const matches = readMatches(instance.decorations, text.length);
        expect(matches).toHaveLength(3);
        expect(matches[0].decoration.eq(matches[1].decoration)).toBe(false);
        expect(matches[1].decoration.eq(matches[2].decoration)).toBe(false);
    });

    it('refreshes occurrence positions after an edit before repeated names', () => {
        const { instance } = createHover('“南总是这样的南总”');
        const text = '前文“南总是这样的南总”';
        const { view } = createHover(text);
        instance.update({ view, docChanged: true, viewportChanged: false } as ViewUpdate);
        const matches = readMatches(instance.decorations, text.length);
        expect(matches).toHaveLength(2);
        for (const { from, to, decoration } of matches) {
            expect(decoration.spec.attributes['data-character-occurrence']).toBe(`${from}:${to}`);
            expect(decoration.spec.attributes['data-character']).toBe('南总');
            expect(decoration.spec.attributes['data-bookpath']).toBe('Book1');
            expect(decoration.spec.attributes['data-sourcepath']).toBe(file.path);
        }
    });
});

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
                process: vi.fn(),
                getAbstractFileByPath: vi.fn()
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

            mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
            await manager.rebuildCache();
            
            const bookCache = manager['characterCache'].get('Book1')!;
            expect(bookCache).toBeDefined();
            
            // Primary Heading
            expect(bookCache.get('John Doe')).toBeDefined();
            expect(bookCache.get('John Doe')?.heading).toBe('John Doe');

            // Aliases
            expect(bookCache.get('JD')).toBeDefined();
            expect(bookCache.get('JD')?.heading).toBe('John Doe');

            expect(bookCache.get('Johnny')).toBeDefined();
            expect(bookCache.get('Johnny')?.heading).toBe('John Doe');
            
            // Lowercase mapping for quick O(1) fallback
            const lowerMap = manager['lowercaseKeyMap'].get('Book1')!;
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

            mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
            await manager.rebuildCache();

            const bookCache = manager['characterCache'].get('Book1')!;
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

            mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
            await manager.rebuildCache();

            const bookCache = manager['characterCache'].get('Book1')!;
            expect(bookCache).toBeDefined();

            // Basename as primary heading
            expect(bookCache.get('Protagonist')).toBeDefined();
            expect(bookCache.get('Protagonist')?.heading).toBe('Protagonist');

            // Frontmatter aliases
            expect(bookCache.get('Hero')).toBeDefined();
            expect(bookCache.get('Hero')?.heading).toBe('Protagonist');
            expect(bookCache.get('Champion')).toBeDefined();
            expect(bookCache.get('Champion')?.heading).toBe('Protagonist');

            // Body text alias
            expect(bookCache.get('Savior')).toBeDefined();
            expect(bookCache.get('Savior')?.heading).toBe('Protagonist');
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

        it('should insert templateContent after description and before relations when creating lore entry', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            let createdContent = '';

            const mockLoreFolder = new TFolder();
            mockLoreFolder.path = 'Book1/Lore';
            mockLoreFolder.name = 'Lore';

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore') return mockLoreFolder;
                return null;
            });

            mockApp.vault.create = vi.fn().mockImplementation(async (_p: string, content: string) => {
                createdContent = content;
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            const customTemplate = '### Background\nBorn in a storm.\n**Weapon**: Thunder Sword';

            const result = await manager.createLoreEntry(
                'Book1',
                'Characters',
                'Thor',
                'God of Thunder',
                'Hero',
                'A mythological hero',
                [{ label: 'Brother', target: 'Loki' }],
                undefined,
                customTemplate
            );

            expect(result).toBe(true);
            expect(createdContent).toContain('## Thor');
            expect(createdContent).toContain('A mythological hero');
            expect(createdContent).toContain('### Background\nBorn in a storm.\n**Weapon**: Thunder Sword');
            expect(createdContent).toContain('### 关系');
            // Template content must appear AFTER description and BEFORE relations
            const descIndex = createdContent.indexOf('A mythological hero');
            const tplIndex = createdContent.indexOf('### Background');
            const relIndex = createdContent.indexOf('### 关系');
            expect(descIndex).toBeLessThan(tplIndex);
            expect(tplIndex).toBeLessThan(relIndex);
        });

        it('should append templateContent to existing file when targetFilePath is specified', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            let appendedContent = '';

            const existingFile = new TFile();
            existingFile.path = 'Book1/Lore/Characters.md';
            existingFile.basename = 'Characters';

            manager.validateLoreSaveDestination = vi.fn().mockResolvedValue({ valid: true });

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore/Characters.md') return existingFile;
                return null;
            });

            mockApp.vault.append = vi.fn().mockImplementation(async (_file: TFile, content: string) => {
                appendedContent = content;
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            const customTemplate = '**Affiliation**: Asgard';

            const result = await manager.createLoreEntry(
                'Book1',
                'Characters',
                'Odin',
                'Allfather',
                'God',
                'Ruler of Asgard',
                [],
                'Book1/Lore/Characters.md',
                customTemplate
            );

            expect(result).toBe(true);
            expect(appendedContent).toContain('## Odin');
            expect(appendedContent).toContain('**Affiliation**: Asgard');
        });

        it('should maintain unchanged output when templateContent is empty or omitted', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            let createdContentWithoutTpl = '';
            let createdContentWithEmptyTpl = '';

            const mockLoreFolder = new TFolder();
            mockLoreFolder.path = 'Book1/Lore';
            mockLoreFolder.name = 'Lore';

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore') return mockLoreFolder;
                return null;
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            mockApp.vault.create = vi.fn().mockImplementation(async (_p: string, content: string) => {
                createdContentWithoutTpl = content;
            });
            await manager.createLoreEntry('Book1', 'Characters', 'HeroA', 'A', 'Warrior', 'Desc', []);

            mockApp.vault.create = vi.fn().mockImplementation(async (_p: string, content: string) => {
                createdContentWithEmptyTpl = content;
            });
            await manager.createLoreEntry('Book1', 'Characters', 'HeroA', 'A', 'Warrior', 'Desc', [], undefined, '   \n  ');

            expect(createdContentWithoutTpl).toBe(createdContentWithEmptyTpl);
        });

        it('should produce exactly one H2 lore title and retain parsable native relations when template is applied', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            let createdContent = '';

            const mockLoreFolder = new TFolder();
            mockLoreFolder.path = 'Book1/Lore';
            mockLoreFolder.name = 'Lore';

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore') return mockLoreFolder;
                return null;
            });

            mockApp.vault.create = vi.fn().mockImplementation(async (_p: string, content: string) => {
                createdContent = content;
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            // Raw template with multiple H1s, H2s, and colon lines
            const rawTemplate = '# Part One\n# Part Two\n## Subsection\n**Rank**: S-Class\n```\n# In Code\n```';
            const parsed = parseLoreTemplate(rawTemplate);
            const templateBody = parsed.render({ 'tpl-field-0': 'SS-Class' });

            const result = await manager.createLoreEntry(
                'Book1',
                'Characters',
                'Master Swordsman',
                'Blade',
                'Warrior',
                'Top tier fighter.',
                [{ label: 'Disciple', target: 'Apprentice' }],
                undefined,
                templateBody
            );

            expect(result).toBe(true);

            // Count occurrences of /^##\s+/m in createdContent: must be exactly 1!
            const h2Matches = createdContent.match(/^##\s+/gm);
            expect(h2Matches).toHaveLength(1);
            expect(createdContent).toContain('## Master Swordsman');

            // Template headings must be H3+
            expect(createdContent).toContain('### Part One');
            expect(createdContent).toContain('### Part Two');
            expect(createdContent).toContain('#### Subsection');

            // Native relations header must be H3
            expect(createdContent).toContain('### 关系');
            expect(createdContent).toContain('**Disciple**：[[#Apprentice]]');
        });

        it('should preserve leading indented code blocks without converting them to H2 lore titles', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            let createdContent = '';

            const mockLoreFolder = new TFolder();
            mockLoreFolder.path = 'Book1/Lore';
            mockLoreFolder.name = 'Lore';

            mockApp.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
                if (p === 'Book1/Lore') return mockLoreFolder;
                return null;
            });

            mockApp.vault.create = vi.fn().mockImplementation(async (_p: string, content: string) => {
                createdContent = content;
            });

            manager.rebuildCache = vi.fn().mockResolvedValue(undefined);

            const indentedTemplate = '    ## Example\n    body code';
            const result = await manager.createLoreEntry(
                'Book1',
                'Characters',
                'Code Master',
                '',
                '',
                '',
                [],
                undefined,
                indentedTemplate
            );

            expect(result).toBe(true);
            expect(createdContent).toContain('## Code Master');
            expect(createdContent).toContain('    ## Example\n    body code');
            // Must have only 1 H2 heading (^##\s+)
            const h2Matches = createdContent.match(/^##\s+/gm);
            expect(h2Matches).toHaveLength(1);
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

    describe('Lore Important Marker Management', () => {
        it('detects H2 important marker, strips it in getLoreContent, and preserves it in updateLoreContent', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const mockFile = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });
            let fileContent = `## Alice\n<!-- wn-important -->\n**Alias**: White Rabbit\nProtagonist with mysterious origin.\n\n## Bob\nNormal citizen.\n`;

            mockApp.metadataCache.getFileCache.mockReturnValue({
                headings: [
                    { heading: 'Alice', level: 2, position: { start: { line: 0 }, end: { line: 0 } } },
                    { heading: 'Bob', level: 2, position: { start: { line: 5 }, end: { line: 5 } } }
                ]
            });
            mockApp.vault.cachedRead.mockImplementation(() => Promise.resolve(fileContent));
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (data: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });

            // 1. parseLoreFile detects important
            const parsed = await manager['parseLoreFile'](mockFile);
            const aliceEntry = parsed.find(e => e.key === 'Alice')?.entry;
            expect(aliceEntry).toBeDefined();
            expect(aliceEntry?.important).toBe(true);

            // 2. getLoreContent strips the marker
            const cleanContent = await manager.getLoreContent(aliceEntry!);
            expect(cleanContent).not.toContain('<!-- wn-important -->');
            expect(cleanContent).toContain('Protagonist with mysterious origin.');

            // 3. updateLoreContent preserves importance even when editor submitted clean text
            await manager.updateLoreContent(aliceEntry!, 'Updated protagonist description.');
            expect(fileContent).toContain('<!-- wn-important -->');
            expect(fileContent).toContain('Updated protagonist description.');

            // 4. toggleLoreImportance removes marker
            const nextState = await manager.toggleLoreImportance(aliceEntry!);
            expect(nextState).toBe(false);
            expect(fileContent).not.toContain('<!-- wn-important -->');
        });

        it('detects single-file important marker, strips it in getLoreContent, and preserves it in updateLoreContent', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const mockFile = Object.assign(new TFile(), { name: 'WorldMap.md', path: 'Book1/Lore/WorldMap.md', basename: 'WorldMap', extension: 'md' });
            let fileContent = `---\naliases: [Continents]\n---\n# WorldMap\n<!-- wn-important -->\nDetailed geography description.\n`;

            mockApp.metadataCache.getFileCache.mockReturnValue({
                frontmatter: { aliases: ['Continents'] },
                headings: [{ heading: 'WorldMap', level: 1, position: { start: { line: 3 }, end: { line: 3 } } }]
            });
            mockApp.vault.cachedRead.mockImplementation(() => Promise.resolve(fileContent));
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (data: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });

            // 1. parseLoreFile detects single-file important
            const parsed = await manager['parseLoreFile'](mockFile);
            const entry = parsed.find(e => e.key === 'WorldMap')?.entry;
            expect(entry).toBeDefined();
            expect(entry?.important).toBe(true);

            // 2. getLoreContent strips marker
            const content = await manager.getLoreContent(entry!);
            expect(content).not.toContain('<!-- wn-important -->');
            expect(content).toContain('Detailed geography description.');

            // 3. updateLoreContent preserves marker
            await manager.updateLoreContent(entry!, 'New world geography details.');
            expect(fileContent).toContain('<!-- wn-important -->');
            expect(fileContent).toContain('New world geography details.');

            // 4. toggleLoreImportance removes marker
            const toggled = await manager.toggleLoreImportance(entry!);
            expect(toggled).toBe(false);
            expect(fileContent).not.toContain('<!-- wn-important -->');
        });
    });

    describe('Batch C: Lore snapshot and full structured quick-edit', () => {
        it('loads single-file aliases from the captured source instead of delayed metadata', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const file = Object.assign(new TFile(), { name: 'Hero.md', path: 'Book1/Lore/Hero.md', basename: 'Hero' });
            mockApp.vault.cachedRead.mockResolvedValue('---\naliases: [LatestAlias]\n---\n# Hero\nBody\n');
            mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: { aliases: ['StaleAlias'] } });
            vi.mocked(parseYaml).mockReturnValueOnce({ aliases: ['LatestAlias'] });
            const snapshot = await manager.getLoreSnapshot({ file, heading: 'Hero' }, 'Book1');
            expect(parseYaml).toHaveBeenCalledWith('aliases: [LatestAlias]');
            expect(snapshot?.aliases).toBe('LatestAlias');
        });
        it('rejects duplicate target headings separated by another entry', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const file = Object.assign(new TFile(), { path: 'Book1/Lore/Characters.md', basename: 'Characters' });
            mockApp.vault.cachedRead.mockResolvedValue('## Hero\nFirst\n## Other\nOther\n## Hero\nSecond\n');
            expect(await manager.getLoreSnapshot({ file, heading: 'Hero' }, 'Book1')).toBeNull();
        });

        it('protects single-file YAML during concurrent edits and safely quotes edited aliases', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Hero.md', path: 'Book1/Lore/Hero.md', basename: 'Hero' });
            let content = '---\naliases: [Old]\nconfig:\n  aliases: [Nested]\n---\n# Hero\nBody\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });
            const entry = { file, heading: 'Hero' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');
            const input = { oldHeading: 'Hero', newHeading: 'Hero', aliases: 'yes, A: B', type: '', body: 'New body', relations: [], contextBookPath: 'Book1', expectedSnapshot: snapshot! };
            content = content.replace('aliases: [Old]', 'aliases: [External]');
            expect(await manager.updateLoreEntry(entry, input)).toBe(false);
            expect(content).toContain('aliases: [External]');
            input.expectedSnapshot = (await manager.getLoreSnapshot(entry, 'Book1'))!;
            expect(await manager.updateLoreEntry(entry, input)).toBe(true);
            expect(content).toContain('aliases: ["yes","A: B"]');
            expect(content).toContain('config:\n  aliases: [Nested]');
        });

        it('removes one target from a multi-target relation without restoring it from the old raw line', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters' });
            let content = '## Hero\nBody\n\n### Relation\n**Friend**: [[#First]], [[#Second]]\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });
            const entry = { file, heading: 'Hero' };
            const snapshot = (await manager.getLoreSnapshot(entry, 'Book1'))!;
            expect(snapshot.relations).toHaveLength(2);
            expect(await manager.updateLoreEntry(entry, { oldHeading: 'Hero', newHeading: 'Hero', aliases: '', type: '', body: snapshot.body, relations: snapshot.relations.slice(1), contextBookPath: 'Book1', expectedSnapshot: snapshot })).toBe(true);
            expect(content).not.toContain('[[#First]]');
            expect(content).toContain('[[#Second]]');
        });

        it('rejects a stale modal snapshot instead of overwriting a concurrent body edit', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });
            let content = '## TargetHero\nOld body\n\n## OtherHero\nOther body\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });
            const entry = { file, heading: 'TargetHero' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');
            content = content.replace('Old body', 'Concurrent body');
            const input = { oldHeading: 'TargetHero', newHeading: 'TargetHero', aliases: '', type: '', body: 'Modal draft', relations: [], contextBookPath: 'Book1', expectedSnapshot: snapshot! };
            await expect(manager.updateLoreEntry(entry, input)).resolves.toBe(false);
            expect(content).toContain('Concurrent body');
            expect(content).not.toContain('Modal draft');
        });

        it('preserves unrecognized prose in the relation section when saving unchanged fields', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });
            let content = '## TargetHero\nHero body\n\n### Relation\nThis explanatory paragraph must survive.\n**Friend**: [[#OtherHero]]\n\n## OtherHero\nOther body\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });
            const entry = { file, heading: 'TargetHero' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');
            const input = { oldHeading: 'TargetHero', newHeading: 'TargetHero', aliases: snapshot!.aliases, type: snapshot!.type, body: snapshot!.body, relations: snapshot!.relations, contextBookPath: 'Book1', expectedSnapshot: snapshot! };
            expect(await manager.updateLoreEntry(entry, input)).toBe(true);
            expect(content).toContain('This explanatory paragraph must survive.');
            expect(content).toContain('## OtherHero\nOther body');
        });

        it('getLoreSnapshot extracts H2 fields, relations, custom sections and ignores fenced code fake lines', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const mockFile = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });

            const rawContent = [
                '## SiblingBefore',
                'Some before text',
                '',
                '## TargetHero',
                '<!-- wn-important -->',
                '**别名**：HeroAlias1, HeroAlias2',
                '**类型**：Protagonist',
                'This is the hero description paragraph.',
                '```markdown',
                '## FakeHeadingInsideCode',
                '**别名**：FakeAlias',
                '```',
                'Second description line.',
                '',
                '### 关系',
                '**Friend**：[[Book1/Lore/Characters#SiblingBefore|SiblingBefore]]',
                '',
                '### CustomSkills',
                '- Skill A',
                '- Skill B',
                '',
                '## SiblingAfter',
                'Some after text'
            ].join('\n');

            mockApp.vault.cachedRead.mockReturnValue(Promise.resolve(rawContent));
            mockApp.vault.read.mockReturnValue(Promise.resolve(rawContent));

            const entry = { file: mockFile, heading: 'TargetHero', important: true };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');

            expect(snapshot).not.toBeNull();
            expect(snapshot?.name).toBe('TargetHero');
            expect(snapshot?.type).toBe('Protagonist');
            expect(snapshot?.aliases).toBe('HeroAlias1, HeroAlias2');
            expect(snapshot?.body).toContain('This is the hero description paragraph.');
            expect(snapshot?.body).toContain('## FakeHeadingInsideCode');
            expect(snapshot?.body).toContain('Second description line.');
            expect(snapshot?.relations).toEqual([{ label: 'Friend', target: 'SiblingBefore' }]);
            expect(snapshot?.retainedTail).toContain('### CustomSkills');
            expect(snapshot?.retainedTail).toContain('- Skill A');
            expect(snapshot?.important).toBe(true);
            expect(snapshot?.isBorrowed).toBe(false);
        });

        it('updateLoreEntry updates H2 entry, preserves custom sections and sibling entries', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            const mockFile = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });

            let fileContent = [
                '## SiblingBefore',
                'Before text',
                '',
                '## TargetHero',
                '**别名**：OldAlias',
                '**类型**：OldType',
                'Old body text',
                '',
                '### 关系',
                '**Friend**：[[SiblingBefore]]',
                '',
                '### CustomSkills',
                '- Skill A',
                '',
                '## SiblingAfter',
                'After text'
            ].join('\n');

            mockApp.vault.read.mockImplementation(() => Promise.resolve(fileContent));
            mockApp.vault.cachedRead.mockImplementation(() => Promise.resolve(fileContent));
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (data: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });

            const entry = { file: mockFile, heading: 'TargetHero' };
            const success = await manager.updateLoreEntry(entry, {
                oldHeading: 'TargetHero',
                newHeading: 'TargetHero',
                aliases: 'NewAlias',
                type: 'MainRole',
                body: 'Updated body text with rich Markdown',
                relations: [{ label: 'Master', target: 'SiblingBefore' }],
                contextBookPath: 'Book1'
            });

            expect(success).toBe(true);
            expect(fileContent).toContain('## SiblingBefore');
            expect(fileContent).toContain('Before text');
            expect(fileContent).toContain('## SiblingAfter');
            expect(fileContent).toContain('After text');
            expect(fileContent).toContain('NewAlias');
            expect(fileContent).toContain('MainRole');
            expect(fileContent).toContain('Updated body text with rich Markdown');
            expect(fileContent).toContain('Master');
            expect(fileContent).toContain('CustomSkills');
            expect(fileContent).toContain('- Skill A');
            expect(fileContent).not.toContain('Old body text');
        });

        it('updateLoreEntry single-file edit and rename renames file, preserves frontmatter and rolls back on failure', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const mockFolder = Object.assign(new TFolder(), { name: 'Lore', path: 'Book1/Lore' });
            const mockFile = Object.assign(new TFile(), {
                name: 'Alice.md',
                path: 'Book1/Lore/Alice.md',
                basename: 'Alice',
                extension: 'md',
                parent: mockFolder
            });

            let fileContent = `---\ntags: [character]\naliases: [Ally]\n---\n# Alice\n**类型**：Hero\nAlice body\n`;
            const initialContent = fileContent;

            mockApp.vault.read.mockImplementation(() => Promise.resolve(fileContent));
            mockApp.vault.cachedRead.mockImplementation(() => Promise.resolve(fileContent));
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (data: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockApp.vault.modify = vi.fn().mockImplementation(async (_file: TFile, data: string) => {
                fileContent = data;
            });
            mockApp.fileManager = {
                renameFile: vi.fn().mockRejectedValue(new Error('Disk write error'))
            };

            const entry = { file: mockFile, heading: 'Alice' };

            // Attempt rename Alice -> AliceRenamed which will fail at renameFile
            await expect(manager.updateLoreEntry(entry, {
                oldHeading: 'Alice',
                newHeading: 'AliceRenamed',
                aliases: 'Ally',
                type: 'Hero',
                body: 'Alice body modified',
                relations: [],
                contextBookPath: 'Book1'
            })).rejects.toThrow('Disk write error');

            // Must have rolled back content to initialContent via safe process
            expect(fileContent).toBe(initialContent);
        });

        it('updateLoreEntry denies editing borrowed lore and prevents name conflicts', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockImplementation((f: TFile | null) => f?.path.startsWith('Book2') ? 'Book2' : 'Book1');
            const mockFile = Object.assign(new TFile(), { name: 'SharedLore.md', path: 'Book2/Lore/SharedLore.md', basename: 'SharedLore', extension: 'md' });
            const entry = { file: mockFile, heading: 'SharedLore' };

            // 1. Borrowed check: contextBookPath Book1 !== Book2 -> borrowed read-only
            const isBorrowed = manager.isBorrowedLoreEntry(entry, 'Book1');
            expect(isBorrowed).toBe(true);

            const borrowedResult = await manager.updateLoreEntry(entry, {
                oldHeading: 'SharedLore',
                newHeading: 'SharedLore',
                aliases: '',
                type: '',
                body: 'New content',
                relations: [],
                contextBookPath: 'Book1'
            });
            expect(borrowedResult).toBe(false);

            // 2. Conflict check: renaming to existing name in same book returns false
            const localFile = Object.assign(new TFile(), { name: 'Alice.md', path: 'Book1/Lore/Alice.md', basename: 'Alice', extension: 'md' });
            const localEntry = { file: localFile, heading: 'Alice' };
            vi.spyOn(manager, 'getCharacterFile').mockImplementation((_book: string, name: string) => {
                if (name === 'ExistingBob') {
                    return { file: Object.assign(new TFile(), { name: 'Bob.md', path: 'Book1/Lore/Bob.md' }), heading: 'ExistingBob' };
                }
                return null;
            });

            const conflictResult = await manager.updateLoreEntry(localEntry, {
                oldHeading: 'Alice',
                newHeading: 'ExistingBob',
                aliases: '',
                type: '',
                body: 'Some body',
                relations: [],
                contextBookPath: 'Book1'
            });
            expect(conflictResult).toBe(false);
        });

        it('permits unrelated sibling edits when target chunk matches expectedSnapshot', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });
            let content = '## SiblingHero\nSibling initial body\n\n## TargetHero\nTarget body\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });
            const entry = { file, heading: 'TargetHero' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');

            // Sibling edited concurrently, TargetHero untouched
            content = content.replace('Sibling initial body', 'Sibling concurrent body');

            const input = { oldHeading: 'TargetHero', newHeading: 'TargetHero', aliases: '', type: '', body: 'Target updated body', relations: [], contextBookPath: 'Book1', expectedSnapshot: snapshot! };
            const success = await manager.updateLoreEntry(entry, input);
            expect(success).toBe(true);
            expect(content).toContain('Sibling concurrent body');
            expect(content).toContain('Target updated body');
        });

        it('detects read->process race where chunk modified before process commit', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });
            let content = '## TargetHero\nTarget initial body\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => {
                // Simulate external modification right as process begins
                content = '## TargetHero\nTarget racing external body\n';
                content = transform(content);
                return content;
            });
            const entry = { file, heading: 'TargetHero' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');

            const input = { oldHeading: 'TargetHero', newHeading: 'TargetHero', aliases: '', type: '', body: 'My modal draft', relations: [], contextBookPath: 'Book1', expectedSnapshot: snapshot! };
            const success = await manager.updateLoreEntry(entry, input);
            expect(success).toBe(false);
            expect(content).toContain('Target racing external body');
            expect(content).not.toContain('My modal draft');
        });

        it('preserves complex fences and unrecognized prose in relation section without treating code as relations', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Characters.md', path: 'Book1/Lore/Characters.md', basename: 'Characters', extension: 'md' });
            const complexChunk = [
                '## Hero',
                'Hero bio',
                '',
                '### Relation',
                'Introductory commentary before relations.',
                '````markdown',
                '```',
                '**FakeRelation**: [[#FakeTarget]]',
                '```',
                '````',
                '**RealFriend**: [[#Buddy]]',
                'Post commentary.'
            ].join('\n');
            let content = complexChunk + '\n';
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });

            const entry = { file, heading: 'Hero' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');
            expect(snapshot?.relations).toEqual([{ label: 'RealFriend', target: 'Buddy' }]);
            expect(snapshot?.relationProse).toContain('Introductory commentary before relations.');
            expect(snapshot?.relationProse).toContain('````markdown');
            expect(snapshot?.relationProse).toContain('Post commentary.');

            const success = await manager.updateLoreEntry(entry, {
                oldHeading: 'Hero',
                newHeading: 'Hero',
                aliases: '',
                type: '',
                body: snapshot!.body,
                relations: snapshot!.relations,
                contextBookPath: 'Book1',
                expectedSnapshot: snapshot!
            });
            expect(success).toBe(true);
            expect(content).toContain('Introductory commentary before relations.');
            expect(content).toContain('````markdown');
            expect(content).toContain('**FakeRelation**: [[#FakeTarget]]');
            expect(content).toContain('Post commentary.');
            expect(content).toContain('**RealFriend**: [[#Buddy]]');
        });

        it('synchronizes single-file frontmatter alias removal while retaining unrelated YAML', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const file = Object.assign(new TFile(), { name: 'Item.md', path: 'Book1/Lore/Item.md', basename: 'Item', extension: 'md' });
            let content = [
                '---',
                'tags: [equipment, rare]',
                'aliases: [Blade, Sword]',
                'status: active',
                '---',
                '# Item',
                'Item description text.'
            ].join('\n') + '\n';

            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => { content = transform(content); return content; });

            const entry = { file, heading: 'Item' };
            const snapshot = await manager.getLoreSnapshot(entry, 'Book1');
            expect(snapshot).not.toBeNull();

            // Save with aliases cleared: ''
            const success = await manager.updateLoreEntry(entry, {
                oldHeading: 'Item',
                newHeading: 'Item',
                aliases: '',
                type: '',
                body: 'Updated item description.',
                relations: [],
                contextBookPath: 'Book1',
                expectedSnapshot: snapshot!
            });

            expect(success).toBe(true);
            expect(content).toContain('tags: [equipment, rare]');
            expect(content).toContain('status: active');
            expect(content).not.toContain('aliases:');
            expect(content).not.toContain('Blade');
            expect(content).toContain('Updated item description.');
        });

        it('safely updates scoped relation links on H2 rename without touching plain links or borrowed files', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const targetFile = Object.assign(new TFile(), { name: 'Chars.md', path: 'Book1/Lore/Chars.md', basename: 'Chars', extension: 'md' });
            const siblingFile = Object.assign(new TFile(), { name: 'Other.md', path: 'Book1/Lore/Other.md', basename: 'Other', extension: 'md' });

            let charsContent = '## OldHero\nHero body\n\n### Relation\n**SelfRef**: [[#OldHero]]\n';
            let otherContent = '## Bob\nBob body\n\n### Relation\n**BestFriend**: [[Chars#OldHero|HeroAlias]]\n**PlainDoc**: [[Chars]]\n';

            const fileMap = new Map<string, string>([
                [targetFile.path, charsContent],
                [siblingFile.path, otherContent]
            ]);

            manager.getLoreFiles = vi.fn().mockReturnValue([targetFile, siblingFile]);
            manager.isBorrowedLoreEntry = vi.fn().mockReturnValue(false);

            mockApp.metadataCache.getFirstLinkpathDest = vi.fn().mockImplementation((linkPath: string, _sourcePath: string) => {
                if (linkPath === 'Chars') return targetFile;
                return null;
            });

            mockApp.vault.process.mockImplementation(async (f: TFile, transform: (d: string) => string) => {
                const prev = fileMap.get(f.path) || '';
                const next = transform(prev);
                fileMap.set(f.path, next);
                return next;
            });

            const updated = await manager['updateScopedLoreRelationLinks']('Book1', targetFile, 'OldHero', 'NewHero');
            expect(updated).toBe(true);

            // Same file anchor [[#OldHero]] -> [[#NewHero]]
            expect(fileMap.get(targetFile.path)).toContain('**SelfRef**: [[#NewHero]]');

            // Cross file anchor [[Chars#OldHero|HeroAlias]] -> [[Chars#NewHero|HeroAlias]]
            expect(fileMap.get(siblingFile.path)).toContain('**BestFriend**: [[Chars#NewHero|HeroAlias]]');

            // Plain file link [[Chars]] is untouched
            expect(fileMap.get(siblingFile.path)).toContain('**PlainDoc**: [[Chars]]');
        });

        it('rollback concurrency preserves concurrent external edits when rename fails', async () => {
            const manager = new CharacterManager(mockApp, mockPlugin);
            manager.getBookPathForFile = vi.fn().mockReturnValue('Book1');
            const mockFolder = Object.assign(new TFolder(), { name: 'Lore', path: 'Book1/Lore' });
            const mockFile = Object.assign(new TFile(), {
                name: 'Item.md',
                path: 'Book1/Lore/Item.md',
                basename: 'Item',
                extension: 'md',
                parent: mockFolder
            });

            let fileContent = '# Item\nInitial body\n';
            mockApp.vault.read.mockImplementation(async () => fileContent);
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);

            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (data: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });

            // Simulate external modification happening right after process write
            mockApp.fileManager = {
                renameFile: vi.fn().mockImplementation(async () => {
                    fileContent = '# ItemRenamed\nExternal concurrent write during rename\n';
                    throw new Error('Disk error');
                })
            };

            const entry = { file: mockFile, heading: 'Item' };
            await expect(manager.updateLoreEntry(entry, {
                oldHeading: 'Item',
                newHeading: 'ItemRenamed',
                aliases: '',
                type: '',
                body: 'Modified body',
                relations: [],
                contextBookPath: 'Book1'
            })).rejects.toThrow('Disk error');

            // Must NOT have clobbered the external concurrent write
            expect(fileContent).toContain('External concurrent write during rename');
        });
    });
});
