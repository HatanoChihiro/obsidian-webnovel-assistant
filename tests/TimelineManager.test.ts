import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineManager, TimelineEntry, parseTimelineChapterList, serializeTimelineChapterList, filterTimelineEntries } from '../src/services/TimelineManager';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { ChapterReferenceService } from '../src/services/ChapterReferenceService';
import { ForeshadowingManager } from '../src/services/ForeshadowingManager';
import { ForeshadowingStatus } from '../src/types/foreshadowing';

vi.mock('obsidian', () => ({
    normalizePath: (path: string) => path.replace(/\\/g, '/'),
    TFile: class {
        name: string = '';
        path: string = '';
        basename: string = '';
        extension: string = 'md';
        parent: unknown = null;
    },
    TFolder: class {
        path: string = '';
        isRoot() { return this.path === '' || this.path === '/'; }
    },
    Vault: {
        recurseChildren: () => {}
    },
    Notice: class {
        constructor(_message?: string, _timeout?: number) {}
        setMessage() { return this; }
        hide() {}
    }
}));
import { TFile } from 'obsidian';

describe('TimelineManager', () => {
    let mockApp: any;
    let mockPlugin: any;
    let manager: TimelineManager;

    beforeEach(() => {
        vi.clearAllMocks();

        mockApp = {
            vault: {
                on: vi.fn(),
				offref: vi.fn(),
                getAbstractFileByPath: vi.fn(),
                create: vi.fn(),
                read: vi.fn(),
                cachedRead: vi.fn((file: any) => mockApp.vault.read(file)),
                modify: vi.fn(),
                process: vi.fn()
            },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(),
                getFileCache: vi.fn(),
                fileToLinktext: vi.fn()
            },
            fileManager: {
                renameFile: vi.fn(),
                processFrontMatter: vi.fn()
            }
        };

        mockPlugin = {
            settings: {
                timeline: {
                    fileName: 'Timeline'
                },
                enableStrictChapterMode: false,
                customSortOrder: {}
            },
            getTrackedMarkdownFiles: vi.fn(() => []),
            getVaultMarkdownFiles: vi.fn(() => []),
            isFileInStrictChapterException: vi.fn(() => false),
            isPluginGeneratedFile: vi.fn(() => false),
            cacheManager: { isEligibleForChapterList: vi.fn(() => true) },
            registerEvent: vi.fn(),
            adaptiveDebounceManager: {
                debounceFixed: vi.fn((_key: string, fn: () => void) => { fn(); })
            }
        };

        manager = new TimelineManager(mockApp, mockPlugin, 'Book 1');
    });

    describe('shared timeline reads', () => {
        it('coalesces pending and unchanged reads and isolates parsed objects', async () => {
            const parse = vi.spyOn(manager as unknown as { parseTimelineContent(content: string, folder: string): TimelineEntry[] }, 'parseTimelineContent');
            const file = Object.assign(new TFile(), { path: 'Book 1/Timeline.md', stat: { mtime: 1, size: 20 } });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('## Day\n- Event\n<!-- wn-lore: Alias -->');
            mockPlugin.characterManager = { cacheVersion: 1, getCharacterFile: vi.fn(() => ({ heading: 'Name' })) };
            const results = await Promise.all(Array.from({ length: 4 }, () => manager.loadEntries()));
            const lookups = mockPlugin.characterManager.getCharacterFile.mock.calls.length;
            expect(lookups).toBeGreaterThan(0);
            results[0]![0].items![0].description = 'mutated';
            results[0]![0].lores!.push('mutated');
            const next = await manager.loadEntries();
            expect(next![0].items![0].description).toBe('Event');
            expect(next![0].lores).toEqual(['Name']);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
            expect(parse).toHaveBeenCalledTimes(1);
            expect(mockPlugin.characterManager.getCharacterFile).toHaveBeenCalledTimes(lookups);
        });

        it('does not let a delayed old read replace newer content, and retries failures', async () => {
            const file = Object.assign(new TFile(), { path: 'Book 1/Timeline.md', stat: { mtime: 1, size: 20 } });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            let finish!: (value: string) => void;
            mockApp.vault.read.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
            const old = manager.loadEntries();
            await Promise.resolve();
            file.stat.mtime++;
            mockApp.vault.read.mockResolvedValue('## New\n- Current');
            expect((await manager.loadEntries())![0].time).toBe('New');
            finish('## Old\n- Previous');
            await old;
            expect((await manager.loadEntries())![0].time).toBe('New');
            expect(mockApp.vault.read).toHaveBeenCalledTimes(2);
            file.stat.mtime++;
            mockApp.vault.read.mockRejectedValueOnce(new Error('read failure'));
            await expect(manager.loadEntries()).rejects.toThrow('read failure');
            expect((await manager.loadEntries())![0].time).toBe('New');
        });

        it('refreshes after rename, replacement, unknown versions and internal writes', async () => {
            const file = Object.assign(new TFile(), { path: 'Book 1/Timeline.md', stat: { mtime: 1, size: 20 } });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('## Old\n- Event');
            await manager.loadEntries();
            mockApp.vault.read.mockResolvedValue('## New\n- Event');
            const rename = mockApp.vault.on.mock.calls.find((call: unknown[]) => call[0] === 'rename')[1] as (file: TFile) => void;
            rename(file);
            expect((await manager.loadEntries())![0].time).toBe('New');
            const replacement = Object.assign(new TFile(), { path: file.path, stat: { ...file.stat } });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(replacement);
            mockApp.vault.read.mockResolvedValue('## Replaced\n- Event');
            expect((await manager.loadEntries())![0].time).toBe('Replaced');
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (content: string) => string) => {
                const text = transform('## Replaced\n- Event\n\n---\n\n');
                mockApp.vault.read.mockResolvedValue(text);
                return text;
            });
            await manager.appendEntry({ time: 'Next', type: 'Type', description: 'Additional', chapter: '', rawBlock: '' }, 'Book 1');
            expect((await manager.loadEntries())!.some(entry => entry.time === 'Next')).toBe(true);
            replacement.stat.mtime = 0;
            await manager.loadEntries();
            mockApp.vault.read.mockResolvedValue('## Unknown version\n- Event');
            expect((await manager.loadEntries())![0].time).toBe('Unknown version');
        });

        it('bounds caches and clears them on shutdown without retaining late reads', async () => {
            for (let i = 0; i < 12; i++) {
                const file = Object.assign(new TFile(), { path: `Book ${i}/Timeline.md`, stat: { mtime: 1, size: 20 } });
                mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
                mockApp.vault.read.mockResolvedValue('## Day\n- Event');
                await manager.loadEntries(`Book ${i}`);
            }
            const caches = manager as unknown as { contentReads: Map<TFile, unknown>; parsedEntries: Map<string, unknown> };
            expect(caches.contentReads.size).toBe(8);
            expect(caches.parsedEntries.size).toBe(8);
            let finish!: (value: string) => void;
            mockApp.vault.getAbstractFileByPath.mockReturnValue(Object.assign(new TFile(), { path: 'Pending/Timeline.md' }));
            mockApp.vault.read.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
            const pending = manager.loadEntries('Pending');
            await Promise.resolve();
            await manager.destroy();
            finish('## Late\n- Event');
            await pending;
            expect(caches.contentReads.size).toBe(0);
            expect(caches.parsedEntries.size).toBe(0);
            expect(await manager.loadEntries()).toBeNull();
        });

        it('waits for queued writes during shutdown', async () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(Object.assign(new TFile(), { path: 'Book 1/Timeline.md' }));
            let finish!: () => void;
            mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (content: string) => string) => {
                const result = transform('');
                await new Promise<void>(resolve => { finish = resolve; });
                return result;
            });
            const write = manager.appendEntry({ time: 'Next', description: 'Additional', chapter: '', rawBlock: '' });
            await Promise.resolve();
            let finished = false;
            const shutdown = manager.destroy().then(() => { finished = true; });
            await Promise.resolve();
            expect(finished).toBe(false);
            finish();
            await Promise.all([write, shutdown]);
            expect(finished).toBe(true);
        });

        it('refreshes after metadata, alias version and same-stat modify notifications', async () => {
            const file = Object.assign(new TFile(), { path: 'Book 1/Timeline.md', stat: { mtime: 1, size: 20 } });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('## Day\n- Event\n<!-- wn-lore: Alias -->');
            mockPlugin.characterManager = { cacheVersion: 1, getCharacterFile: vi.fn(() => ({ heading: 'Name' })) };
            expect((await manager.loadEntries())![0].lores).toEqual(['Name']);
            mockPlugin.characterManager.getCharacterFile.mockReturnValue({ heading: 'Renamed' });
            mockPlugin.characterManager.cacheVersion++;
            expect((await manager.loadEntries())![0].lores).toEqual(['Renamed']);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
            file.stat.mtime++;
            mockApp.vault.read.mockResolvedValue('## New day\n- New event');
            expect((await manager.loadEntries())![0].time).toBe('New day');
            mockApp.vault.read.mockResolvedValue('## Latest\n- Latest event');
            // Keep reconciliation deferred; invalidation must precede that delayed work.
            mockPlugin.adaptiveDebounceManager.debounceFixed.mockImplementation(() => {});
            const modify = mockApp.vault.on.mock.calls.find((call: unknown[]) => call[0] === 'modify')[1] as (file: TFile) => void;
            modify(file);
            expect((await manager.loadEntries())![0].time).toBe('Latest');
        });
    });

    describe('Initialization & Paths', () => {
        it('getTimelineFilePath should return correct path', () => {
            expect(manager.getTimelineFilePath()).toBe('Book 1/Timeline.md');
        });

        it('getTimelineFilePath should fallback to root if no bookRoot', () => {
            const rootManager = new TimelineManager(mockApp, mockPlugin, '');
            expect(rootManager.getTimelineFilePath()).toBe('Timeline.md');
        });

        it('should get Timeline File successfully', () => {
            const dummyFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(dummyFile);
            expect(manager.getTimelineFile()).toBe(dummyFile);
        });
    });

    describe('parseEntries', () => {
        it('should correctly parse modern markdown timeline formats', () => {
            const markdown = `
---
## 2023-01-01
**Type**：Battle

- Protagonist arrives at the city [[Chapter 1]]
  He meets the hidden boss.
- Someone is murdered [[Chapter 2]] [[Chapter 3]]
  <!-- origin: some hidden notes -->

---
## 2023-02-01
**Type**：Event

- Festival starts
`;
            const entries = manager.parseEntries(markdown);
            
            expect(entries.length).toBe(2);
            
            expect(entries[0].time).toBe('2023-01-01');
            expect(entries[0].type).toBe('Battle');
            expect(entries[0].items?.length).toBe(2);
            
            expect(entries[0].items?.[0].chapter).toBe('Chapter 1');
            expect(entries[0].items?.[0].description).toBe('Protagonist arrives at the city\nHe meets the hidden boss.');
            
            expect(entries[0].items?.[1].chapter).toBe('Chapter 2, Chapter 3');
            expect(entries[0].items?.[1].description).toBe('Someone is murdered');
            expect(entries[0].items?.[1].origin).toBe('some hidden notes');
            
            expect(entries[1].time).toBe('2023-02-01');
            expect(entries[1].type).toBe('Event');
            expect(entries[1].items?.length).toBe(1);
            expect(entries[1].items?.[0].description).toBe('Festival starts');
        });

        it('should correctly parse old format timeline without bullet points', () => {
            const markdown = `
---
## 2023-01-01

This is an old format description.

It has multiple lines.
`;
            const entries = manager.parseEntries(markdown);
            
            expect(entries.length).toBe(1);
            expect(entries[0].time).toBe('2023-01-01');
            expect(entries[0].items?.[0].description).toBe('This is an old format description.\nIt has multiple lines.');
        });
    });

    describe('CRUD Operations', () => {
        beforeEach(() => {
            const dummyFile = new TFile();
            mockApp.vault.getAbstractFileByPath.mockReturnValue(dummyFile);
            mockApp.vault.read.mockResolvedValue(`
---
## 2023-01-01

- Event A
- Event B
`);
        });

        it('appendEntry should create file if not exists', async () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
            mockApp.vault.create.mockResolvedValue(new TFile());
            
            await manager.appendEntry({ time: '2023-01-02', items: [{ description: 'New Event' }] } as TimelineEntry);
            
            expect(mockApp.vault.create).toHaveBeenCalled();
            expect(mockApp.vault.process).toHaveBeenCalled();
        });

        it('appendEntry should add to existing entries and sort', async () => {
            await manager.appendEntry({ time: '2023-01-02', items: [{ description: 'New Event' }] } as TimelineEntry);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback(`---
## 2023-01-01

- Event A
- Event B
---
`);
            expect(modifiedContent).toContain('2023-01-01');
            expect(modifiedContent).toContain('2023-01-02');
            expect(modifiedContent).toContain('New Event');
        });

        it('updateEntry should update an existing entry correctly', async () => {
            const initialContent = `
---
## 2023-01-01

- Event A
- Event B
`;
            const updatedEntry = { time: '2023-01-01', items: [{ description: 'Updated Event A' }] } as TimelineEntry;
            await manager.updateEntry(0, updatedEntry);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback(initialContent);
            expect(modifiedContent).toContain('Updated Event A');
            expect(modifiedContent).not.toContain('- Event A\n');
        });

        it('deleteEntry should remove the entire entry', async () => {
            const initialContent = `
---
## 2023-01-01

- Event A
- Event B
`;
            await manager.deleteEntry(0);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback(initialContent);
            expect(modifiedContent).not.toContain('2023-01-01');
        });

        it('moveEventItem should move item within the same node', async () => {
            const initialContent = `
---
## 2023-01-01

- Event A
- Event B
`;
            await manager.moveEventItem('2023-01-01', 0, '2023-01-01', 2);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback(initialContent);
            const eventAIndex = modifiedContent.indexOf('Event A');
            const eventBIndex = modifiedContent.indexOf('Event B');
            expect(eventBIndex).toBeLessThan(eventAIndex); // Event B is now before Event A
        });

        it('moveEventItem should move item to a different node', async () => {
            const fileContent = `
---
## 2023-01-02
- Event B

---
## 2023-01-01
- Event A
`;
            mockApp.vault.read.mockResolvedValue(fileContent);
            await manager.moveEventItem('2023-01-01', 0, '2023-01-02', 1);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback(fileContent);
            
            // 2023-01-01 should be gone
            expect(modifiedContent).not.toContain('## 2023-01-01');
            // 2023-01-02 should have both B and A
            expect(modifiedContent).toContain('- Event B\n- Event A');
        });
    });

    describe('Frontmatter Reconciliation & Cross-book Consistency (Regressions)', () => {
        let chapter1: TFile;
        let chapter2: TFile;
        let vol1Chap1: TFile;
        let vol2Chap1: TFile;
        let bookAChap: TFile;
        let bookBChap: TFile;
        let fileCacheMap: Map<string, { frontmatter?: Record<string, unknown> }>;
        let frontMatterData: Map<string, Record<string, unknown>>;

        beforeEach(() => {
            fileCacheMap = new Map();
            frontMatterData = new Map();

            chapter1 = Object.assign(new TFile(), { name: 'Chapter 1.md', path: 'Book 1/Chapter 1.md', basename: 'Chapter 1', extension: 'md' });
            chapter2 = Object.assign(new TFile(), { name: 'Chapter 2.md', path: 'Book 1/Chapter 2.md', basename: 'Chapter 2', extension: 'md' });
            vol1Chap1 = Object.assign(new TFile(), { name: 'Chapter 1.md', path: 'Book 1/Vol 1/Chapter 1.md', basename: 'Chapter 1', extension: 'md' });
            vol2Chap1 = Object.assign(new TFile(), { name: 'Chapter 1.md', path: 'Book 1/Vol 2/Chapter 1.md', basename: 'Chapter 1', extension: 'md' });
            bookAChap = Object.assign(new TFile(), { name: 'Chapter A.md', path: 'Book A/Chapter A.md', basename: 'Chapter A', extension: 'md' });
            bookBChap = Object.assign(new TFile(), { name: 'Chapter B.md', path: 'Book B/Chapter B.md', basename: 'Chapter B', extension: 'md' });

            mockApp.metadataCache.getFirstLinkpathDest = vi.fn((linkpath: string, sourcePath: string) => {
                if (linkpath === 'Chapter 1' && sourcePath.startsWith('Book 1/')) {
                    // Ambiguous if both Vol 1 and Vol 2 exist without single root Chapter 1
                    return null;
                }
                if (linkpath === 'Chapter 2' && sourcePath.startsWith('Book 1/')) return chapter2;
                if (linkpath === 'Vol 1/Chapter 1') return vol1Chap1;
                if (linkpath === 'Vol 2/Chapter 1') return vol2Chap1;
                if (linkpath === 'Chapter A') return bookAChap;
                if (linkpath === 'Chapter B') return bookBChap;
                return null;
            });

            mockApp.metadataCache.fileToLinktext = vi.fn((file: { path: string; basename: string }) => {
                if (file.path === 'Book 1/Vol 1/Chapter 1.md') return 'Vol 1/Chapter 1';
                if (file.path === 'Book 1/Vol 2/Chapter 1.md') return 'Vol 2/Chapter 1';
                return file.basename;
            });

            mockApp.metadataCache.getFileCache = vi.fn((file: { path: string }) => {
                return fileCacheMap.get(file.path) || { frontmatter: frontMatterData.get(file.path) };
            });

            mockApp.fileManager.processFrontMatter = vi.fn(async (file: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
                let fm = frontMatterData.get(file.path);
                if (!fm) {
                    fm = {};
                    frontMatterData.set(file.path, fm);
                }
                fn(fm);
                fileCacheMap.set(file.path, { frontmatter: { ...fm } });
            });

            mockPlugin.getTrackedMarkdownFiles = vi.fn(() => [chapter1, chapter2, vol1Chap1, vol2Chap1, bookAChap, bookBChap]);
            mockPlugin.getVaultMarkdownFiles = vi.fn(() => [chapter1, chapter2, vol1Chap1, vol2Chap1, bookAChap, bookBChap]);
            mockPlugin.isFileInStrictChapterException = vi.fn(() => false);
            mockPlugin.isPluginGeneratedFile = vi.fn(() => false);
            mockPlugin.cacheManager = { isEligibleForChapterList: vi.fn(() => true) };
            mockPlugin.registerEvent = vi.fn();
            mockPlugin.adaptiveDebounceManager = {
                debounceFixed: vi.fn((_key: string, fn: () => void) => { fn(); })
            };
        });

        it('1. appendEntry should reconcile chapter frontmatter', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb('');
            });

            await manager.appendEntry({
                time: '2023-01-01',
                items: [{ description: 'Arrives', chapter: 'Chapter 2' }]
            } as TimelineEntry, 'Book 1');

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(chapter2, expect.any(Function));
            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('2023-01-01');
        });

        it('2. updateEntry should handle node rename and update frontmatter', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Arrival [[Chapter 2]]\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(`## 2023-01-01\n- Arrival [[Chapter 2]]\n---\n`);
            });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: '2023-01-01' });

            await manager.updateEntry(0, {
                time: '2023-01-01 Renamed',
                items: [{ description: 'Arrival', chapter: 'Chapter 2' }]
            } as TimelineEntry, 'Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('2023-01-01 Renamed');
        });

        it('3. updateEntry link remove should remove timeline property', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Arrival [[Chapter 2]]\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(`## 2023-01-01\n- Arrival [[Chapter 2]]\n---\n`);
            });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: '2023-01-01' });

            await manager.updateEntry(0, {
                time: '2023-01-01',
                items: [{ description: 'Arrival without link', chapter: '' }]
            } as TimelineEntry, 'Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBeUndefined();
        });

        it('4. deleteEntry should remove node from chapter frontmatter', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Arrival [[Chapter 2]]\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(`## 2023-01-01\n- Arrival [[Chapter 2]]\n---\n`);
            });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: '2023-01-01' });

            await manager.deleteEntry(0, 'Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBeUndefined();
        });

        it('5. moveEventItem should update frontmatter to target node', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## Node 1\n- Event A [[Chapter 2]]\n---\n## Node 2\n- Event B\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(`## Node 1\n- Event A [[Chapter 2]]\n---\n## Node 2\n- Event B\n---\n`);
            });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: 'Node 1' });

            await manager.moveEventItem('Node 1', 0, 'Node 2', 1, 'Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('Node 2');
        });

        it('6. Direct markdown full reconcile should calibrate chapters', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Vol 1/Chapter 1.md') return vol1Chap1;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            const markdown = `## Day 1\n- Event [[Vol 1/Chapter 1]]\n---\n## Day 2\n- Event [[Chapter 2]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);
            frontMatterData.set('Book 1/Vol 1/Chapter 1.md', { timeline: 'Old Node' });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: null });

            await manager.reconcileFrontmatter('Book 1');

            expect(frontMatterData.get('Book 1/Vol 1/Chapter 1.md')?.timeline).toBe('Day 1');
            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('Day 2');
        });

        it('7. Multiple nodes for same chapter should format as array in frontmatter', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            const markdown = `## Node A\n- Event 1 [[Chapter 2]]\n---\n## Node B\n- Event 2 [[Chapter 2]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);

            await manager.reconcileFrontmatter('Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toEqual(['Node A', 'Node B']);
        });

        it('8. Path and alias links should resolve accurately', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Vol 1/Chapter 1.md') return vol1Chap1;
                if (p === 'Book 1/Vol 2/Chapter 1.md') return vol2Chap1;
                return null;
            });
            const markdown = `## Node 1\n- Event [[Vol 1/Chapter 1|Vol1 Ch1 Alias]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);

            await manager.reconcileFrontmatter('Book 1');

            expect(frontMatterData.get('Book 1/Vol 1/Chapter 1.md')?.timeline).toBe('Node 1');
            expect(frontMatterData.get('Book 1/Vol 2/Chapter 1.md')?.timeline).toBeUndefined();
        });

        it('9. Ambiguous basename in same book should not mistakenly modify multiple files', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                return null;
            });
            // Link destination cannot be resolved by metadataCache and has 2 chapters with basename 'Chapter 1' in Book 1
            mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);
            const markdown = `## Ambiguous Node\n- Event [[Chapter 1]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);

            await manager.reconcileFrontmatter('Book 1');

            // Neither should be modified due to ambiguity
            expect(frontMatterData.get('Book 1/Vol 1/Chapter 1.md')?.timeline).toBeUndefined();
            expect(frontMatterData.get('Book 1/Vol 2/Chapter 1.md')?.timeline).toBeUndefined();
        });

        it('10. Duplicate chapter names across volumes: bare [[Chapter 1]] is not deleted or hijacked when dragging Vol 1/Chapter 1, and path links only modify target', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Vol 1/Chapter 1.md') return vol1Chap1;
                if (p === 'Book 1/Vol 2/Chapter 1.md') return vol2Chap1;
                return null;
            });

            // Timeline markdown has bare [[Chapter 1]] in Node 1, and exact path [[Vol 1/Chapter 1]] in Node 2
            let timelineContent = `## Node 1\n- Event in Node 1 [[Chapter 1]]\n---\n## Node 2\n- Event in Node 2 [[Vol 1/Chapter 1]]\n---\n`;
            mockApp.vault.read.mockImplementation(async () => timelineContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                timelineContent = cb(timelineContent);
                return timelineContent;
            });

            // Drag Vol 1/Chapter 1 to Node 1
            await manager.syncChapterToEventItem(vol1Chap1, [{ time: 'Node 1', itemIndex: 0 }], 'Book 1');

            // 1. In timeline markdown:
            // Bare [[Chapter 1]] was ambiguous so it should NOT have been deleted or hijacked!
            // Node 1 should have both the original bare link and the newly synced Vol 1/Chapter 1 link
            expect(timelineContent).toContain('[[Chapter 1]]');
            expect(timelineContent).toContain('[[Vol 1/Chapter 1]]');
            // Node 2's [[Vol 1/Chapter 1]] was exact so it should have been removed from Node 2
            expect(timelineContent).not.toMatch(/## Node 2[\s\S]*?\[\[Vol 1\/Chapter 1\]\]/);

            // 2. Frontmatter:
            // Vol 1/Chapter 1 is in Node 1
            expect(frontMatterData.get('Book 1/Vol 1/Chapter 1.md')?.timeline).toBe('Node 1');
            // Vol 2/Chapter 1 is undefined (not mistakenly linked or altered)
            expect(frontMatterData.get('Book 1/Vol 2/Chapter 1.md')?.timeline).toBeUndefined();
        });

        it('keeps spaced cross-volume chapter links distinct across repeated drops, moves and unlinking', async () => {
            const timelineFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            const spaced = Object.assign(new TFile(), { name: 'Chapter 1 .md', path: 'Book 1/Vol 1/Chapter 1 .md', basename: 'Chapter 1 ', extension: 'md' });
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([spaced, vol2Chap1]);
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([spaced, vol2Chap1]);
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
                [timelineFile, spaced, vol2Chap1].find(file => file.path === path) ?? null);
            mockApp.metadataCache.fileToLinktext.mockReturnValue('Chapter 1 .md');
            let content = '## Node 1\n- Event [[Vol 2/Chapter 1]]\n---\n## Node 2\n- Event\n---\n';
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, callback: (text: string) => string) => {
                content = callback(content);
                return content;
            });

            const target = [{ entryIndex: 1, itemIndex: 0 }];
            await manager.syncChapterToEventItem(spaced, target, 'Book 1');
            await manager.syncChapterToEventItem(spaced, target, 'Book 1');
            expect(content.match(/\[\[Book 1\/Vol 1\/Chapter 1 \.md\]\]/g)).toHaveLength(1);
            expect(frontMatterData.get(spaced.path)?.timeline).toBe('Node 2');
            expect(frontMatterData.get(vol2Chap1.path)?.timeline).toBe('Node 1');

            await manager.syncChapterToEventItem(spaced, [{ entryIndex: 0, itemIndex: 0 }], 'Book 1');
            const entries = manager.parseEntries(content, 'Book 1');
            expect(entries[0].chapter).toContain('Vol 2/Chapter 1');
            expect(entries[0].chapter).toContain('Book 1/Vol 1/Chapter 1 .md');
            expect(entries[1].chapter).toBe('');
            expect(frontMatterData.get(spaced.path)?.timeline).toBe('Node 1');

            await manager.syncChapterToEventItem(spaced, [], 'Book 1');
            expect(content).not.toContain('Chapter 1 .md');
            expect(content).toContain('[[Vol 2/Chapter 1]]');
            expect(frontMatterData.get(spaced.path)?.timeline).toBeUndefined();
            expect(frontMatterData.get(vol2Chap1.path)?.timeline).toBe('Node 1');
        });

        it('11. syncChapterToEventItem string argument with ambiguous name does not modify associations', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Vol 1/Chapter 1.md') return vol1Chap1;
                if (p === 'Book 1/Vol 2/Chapter 1.md') return vol2Chap1;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([vol1Chap1, vol2Chap1, chapter2]);
            mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

            const initialContent = `## Node 1\n- Event [[Chapter 1]]\n---\n`;
            mockApp.vault.read.mockImplementation(async () => initialContent);
            mockApp.vault.cachedRead.mockImplementation(async () => initialContent);

            // Call syncChapterToEventItem with ambiguous string 'Chapter 1'
            const result = await manager.syncChapterToEventItem('Chapter 1', [{ time: 'Node 2', itemIndex: 0 }], 'Book 1');

            // Should return unchanged content without modifying file or associations
            expect(result).toBe(initialContent);
            expect(frontMatterData.get('Book 1/Vol 1/Chapter 1.md')?.timeline).toBeUndefined();
            expect(frontMatterData.get('Book 1/Vol 2/Chapter 1.md')?.timeline).toBeUndefined();
        });

        it('12. Interleaved asynchronous operations across two books should queue and not cross-contaminate files or frontmatter', async () => {
            const tlA = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book A/Timeline.md', basename: 'Timeline' });
            const tlB = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book B/Timeline.md', basename: 'Timeline' });

            let bookAContent = '';
            let bookBContent = '';

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book A/Timeline.md') return tlA;
                if (p === 'Book B/Timeline.md') return tlB;
                if (p === 'Book A/Chapter A.md') return bookAChap;
                if (p === 'Book B/Chapter B.md') return bookBChap;
                return null;
            });

            mockApp.vault.create.mockImplementation(async (p: string, content: string) => {
                if (p === 'Book A/Timeline.md') {
                    bookAContent = content;
                    return tlA;
                }
                if (p === 'Book B/Timeline.md') {
                    bookBContent = content;
                    return tlB;
                }
                return new TFile();
            });

            mockApp.vault.read.mockImplementation(async (file: TFile) => {
                if (file.path === 'Book A/Timeline.md') return bookAContent;
                if (file.path === 'Book B/Timeline.md') return bookBContent;
                return '';
            });

            mockApp.vault.process.mockImplementation(async (file: TFile, cb: (c: string) => string) => {
                if (file.path === 'Book A/Timeline.md') {
                    bookAContent = cb(bookAContent);
                    return bookAContent;
                }
                if (file.path === 'Book B/Timeline.md') {
                    bookBContent = cb(bookBContent);
                    return bookBContent;
                }
                return '';
            });

            // Set manager.currentFolder to an unrelated value to ensure operations rely solely on explicit folderPath
            manager.currentFolder = 'UnrelatedFolder';

            // Launch interleaved concurrent operations across Book A and Book B
            await Promise.all([
                manager.appendEntry({ time: '2026-01-01', items: [{ description: 'Event A1', chapter: 'Chapter A' }] } as TimelineEntry, 'Book A'),
                manager.appendEntry({ time: '2026-02-01', items: [{ description: 'Event B1', chapter: 'Chapter B' }] } as TimelineEntry, 'Book B'),
                manager.appendEntry({ time: '2026-01-02', items: [{ description: 'Event A2', chapter: 'Chapter A' }] } as TimelineEntry, 'Book A'),
                manager.appendEntry({ time: '2026-02-02', items: [{ description: 'Event B2', chapter: 'Chapter B' }] } as TimelineEntry, 'Book B')
            ]);

            // Verify Book A file contents
            expect(bookAContent).toContain('2026-01-01');
            expect(bookAContent).toContain('2026-01-02');
            expect(bookAContent).toContain('Event A1');
            expect(bookAContent).toContain('Event A2');
            expect(bookAContent).not.toContain('2026-02-01');
            expect(bookAContent).not.toContain('Event B1');

            // Verify Book B file contents
            expect(bookBContent).toContain('2026-02-01');
            expect(bookBContent).toContain('2026-02-02');
            expect(bookBContent).toContain('Event B1');
            expect(bookBContent).toContain('Event B2');
            expect(bookBContent).not.toContain('2026-01-01');
            expect(bookBContent).not.toContain('Event A1');

            // Verify frontmatters are strictly isolated
            expect(frontMatterData.get('Book A/Chapter A.md')?.timeline).toEqual(['2026-01-01', '2026-01-02']);
            expect(frontMatterData.get('Book B/Chapter B.md')?.timeline).toEqual(['2026-02-01', '2026-02-02']);
        });

        it('13. Legacy format compatibility and minimal output format', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            // Chapter 2 has single event -> written as string, not array
            const markdown = `## Single Node\n- Event [[Chapter 2]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: ['Single Node'] }); // old array format

            await manager.reconcileFrontmatter('Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('Single Node');
        });

        it('14. No frontmatter write when already in sync', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            const markdown = `## Node 1\n- Event [[Chapter 2]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: 'Node 1' });
            fileCacheMap.set('Book 1/Chapter 2.md', { frontmatter: { timeline: 'Node 1' } });

            mockApp.fileManager.processFrontMatter.mockClear();

            await manager.reconcileFrontmatter('Book 1');

            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
        });

        it('15. syncChapterToEventItem should update markdown and reconcile frontmatter', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## Node 1\n- Event A [[Chapter 2]]\n---\n## Node 2\n- Event B\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(`## Node 1\n- Event A [[Chapter 2]]\n---\n## Node 2\n- Event B\n---\n`);
            });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: 'Node 1' });

            await manager.syncChapterToEventItem(chapter2, [{ time: 'Node 2', itemIndex: 0 }], 'Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('Node 2');
        });

        it('16. syncChapterToEventItem with empty targets should remove associations', async () => {
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## Node 1\n- Event A [[Chapter 2]]\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(`## Node 1\n- Event A [[Chapter 2]]\n---\n`);
            });
            frontMatterData.set('Book 1/Chapter 2.md', { timeline: 'Node 1' });

            await manager.syncChapterToEventItem(chapter2, [], 'Book 1');

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBeUndefined();
        });

        it('17. vault modify listener should reconcile timeline markdown directly edited by user', async () => {
            let modifyHandler: ((file: TFile) => void) | null = null;
            mockApp.vault.on.mockImplementation((evt: string, handler: (file: TFile) => void) => {
                if (evt === 'modify') modifyHandler = handler;
            });

            // Create fresh manager to trigger registerEvents
            const freshManager = new TimelineManager(mockApp, mockPlugin, 'Book 1');
            expect(modifyHandler).toBeDefined();

            const dummyTlFile = Object.assign(new TFile(), {
                name: 'Timeline.md',
                path: 'Book 1/Timeline.md',
                basename: 'Timeline',
                extension: 'md',
                parent: { isRoot: () => false, path: 'Book 1' }
            });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return chapter2;
                return null;
            });
            mockApp.vault.read.mockResolvedValue(`## Directly Edited Node\n- Event [[Chapter 2]]\n---\n`);

            // Trigger modify handler
            modifyHandler!(dummyTlFile);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(frontMatterData.get('Book 1/Chapter 2.md')?.timeline).toBe('Directly Edited Node');
        });

        it('18. Root directory book should be correctly reconciled', async () => {
            const rootChap = Object.assign(new TFile(), { name: 'Chapter 2.md', path: 'Chapter 2.md', basename: 'Chapter 2', extension: 'md' });
            const rootTl = Object.assign(new TFile(), {
                name: 'Timeline.md',
                path: 'Timeline.md',
                basename: 'Timeline',
                extension: 'md',
                parent: { isRoot: () => true, path: '' }
            });

            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
                if (linkpath === 'Chapter 2') return rootChap;
                return null;
            });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Timeline.md') return rootTl;
                if (p === 'Chapter 2.md') return rootChap;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([rootChap]);
            mockApp.vault.read.mockResolvedValue(`## Root Node\n- Event [[Chapter 2]]\n---\n`);

            await manager.reconcileFrontmatter('');

            expect(frontMatterData.get('Chapter 2.md')?.timeline).toBe('Root Node');
        });

        it('19. Root timeline modify is ignored when workspaces are explicitly configured', async () => {
            let modifyHandler: ((file: TFile) => void) | undefined;
            mockApp.vault.on.mockImplementation((evt: string, handler: (file: TFile) => void) => {
                if (evt === 'modify') modifyHandler = handler;
            });
            mockPlugin.settings.workspaceFolders = ['Book 1'];

            new TimelineManager(mockApp, mockPlugin, '');

            const rootTimeline = Object.assign(new TFile(), {
                name: 'Timeline.md',
                path: 'Timeline.md',
                basename: 'Timeline',
                extension: 'md',
                parent: { isRoot: () => true, path: '' }
            });
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                return path === 'Timeline.md' ? rootTimeline : null;
            });
            mockApp.vault.cachedRead.mockClear();

            modifyHandler?.(rootTimeline);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();
            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
        });

        it('20. reconcileFrontmatter handles wikilinks with volume relative paths and aliases', async () => {
            const vol1Chap1 = Object.assign(new TFile(), { name: 'Chapter 1.md', path: 'Book 1/Vol 1/Chapter 1.md', basename: 'Chapter 1', extension: 'md' });
            const vol2Chap1 = Object.assign(new TFile(), { name: 'Chapter 1.md', path: 'Book 1/Vol 2/Chapter 1.md', basename: 'Chapter 1', extension: 'md' });
            const dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Vol 1/Chapter 1.md' || p === 'Book 1/Vol 1/Chapter 1') return vol1Chap1;
                if (p === 'Book 1/Vol 2/Chapter 1.md' || p === 'Book 1/Vol 2/Chapter 1') return vol2Chap1;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([vol1Chap1, vol2Chap1]);

            const markdown = `## Vol 2 Event\n- Major battle [[Vol 2/Chapter 1|Chapter 1]]\n---\n`;
            mockApp.vault.read.mockResolvedValue(markdown);

            await manager.reconcileFrontmatter('Book 1');

            expect(frontMatterData.get('Book 1/Vol 2/Chapter 1.md')?.timeline).toBe('Vol 2 Event');
            expect(frontMatterData.get('Book 1/Vol 1/Chapter 1.md')?.timeline).toBeUndefined();
        });

        it('21. parseEntries and formatEntry round-trip important marker alongside origin', () => {
            const rawContent = `## 2026-09-14 10:00\n- [[第1章]] 关键转折点 <!-- wn-important --> <!-- origin: 原文片段 -->\n---\n`;
            const entries = manager.parseEntries(rawContent);
            expect(entries).toHaveLength(1);
            expect(entries[0].items).toHaveLength(1);
            const item = entries[0]!.items![0]!;
            expect(item.description).toBe('关键转折点');
            expect(item.chapter).toBe('第1章');
            expect(item.important).toBe(true);
            expect(item.origin).toBe('原文片段');

            const formatted = manager.formatEntry(entries[0]!);
            expect(formatted).toContain('<!-- wn-important -->');
            expect(formatted).toContain('<!-- origin: 原文片段 -->');

            const reparsed = manager.parseEntries(formatted);
            expect(reparsed[0]!.items![0]!.important).toBe(true);
            expect(reparsed[0]!.items![0]!.origin).toBe('原文片段');
            expect(reparsed[0]!.items![0]!.description).toBe('关键转折点');
        });

        it('22. migrates item-level lore comments to one node-level association on round-trip', () => {
            const rawContent = `## 2026-09-15 14:00\n\n- 结识主角 [[第2章]] <!-- wn-important --> <!-- lore: 张三, 李四 --> <!-- origin: 原文引用 -->\n\n---\n\n`;
            const entries = manager.parseEntries(rawContent);
            expect(entries).toHaveLength(1);
            const item = entries[0]!.items![0]!;
            expect(item.description).toBe('结识主角');
            expect(item.chapter).toBe('第2章');
            expect(item.important).toBe(true);
            expect(item.origin).toBe('原文引用');
            expect(entries[0]!.lores).toEqual(['张三', '李四']);

            const formatted = manager.formatEntry(entries[0]!);
            expect(formatted).toContain('<!-- wn-lore: 张三, 李四 -->');
            expect(formatted.match(/<!-- wn-lore:/g)).toHaveLength(1);
            expect(formatted).not.toMatch(/^- .*<!-- wn-lore:/m);
            expect(formatted).toContain('<!-- wn-important -->');
            expect(formatted).toContain('<!-- origin: 原文引用 -->');
            expect(formatted).toContain('[[第2章]]');

            const reparsed = manager.parseEntries(formatted);
            expect(reparsed[0]!.lores).toEqual(['张三', '李四']);
            expect(reparsed[0]!.items![0]!.description).toBe('结识主角');
            expect(reparsed[0]!.items![0]!.chapter).toBe('第2章');
            expect(reparsed[0]!.items![0]!.important).toBe(true);
            expect(reparsed[0]!.items![0]!.origin).toBe('原文引用');

			const separatorEntry = {
				...entries[0]!,
				lores: ['王,小明', '南；北']
			};
			const separatorFormatted = manager.formatEntry(separatorEntry);
			expect(separatorFormatted).toContain('<!-- wn-lore: ["\u738b,\u5c0f\u660e","\u5357\uff1b\u5317"] -->');
			expect(manager.parseEntries(separatorFormatted)[0]!.lores).toEqual(['王,小明', '南；北']);
        });

        it('23. canonicalizes lore aliases and preserves unresolved lore names', () => {
            mockPlugin.characterManager = {
                getCharacterFile: vi.fn((book: string, name: string) => {
                    if (name === '小张' || name === '张三') return { heading: '张三' };
                    return null;
                })
            };

            const rawContent = `## 2026-09-16 10:00\n- 宗门大比 <!-- lore: 小张, 遗失名 -->\n---\n`;
            const entries = manager.parseEntries(rawContent, 'Book 1');
            expect(entries).toHaveLength(1);
            expect(entries[0]!.lores).toEqual(['张三', '遗失名']);
        });

        it('24. appendEntry keeps different lore associations in separate nodes', async () => {
            let fileContent = `## 2026-09-17\n- 第一件事 [[第1章]] <!-- lore: 旧设定 -->\n\n**类型**：主线\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: any, cb: (c: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            const dummyFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(dummyFile);

            const entryToAppend: TimelineEntry = {
                time: '2026-09-17',
                type: '主线',
                description: '第二件事',
                chapter: '第2章',
                rawBlock: '',
                lores: ['林动'],
                items: [{
                    description: '第二件事',
                    chapter: '第2章',
                    important: true,
                    origin: '引文'
                }]
            };

            await manager.appendEntry(entryToAppend, 'Book 1');

            expect(fileContent).toContain('<!-- lore: 旧设定 -->');
            expect(fileContent).toContain('<!-- wn-lore: 林动 -->');
            expect(fileContent.match(/<!-- wn-lore:|<!-- lore:/g)).toHaveLength(2);
            expect(fileContent).toContain('<!-- wn-important -->');
            expect(fileContent).toContain('<!-- origin: 引文 -->');
            expect(fileContent).toContain('[[第2章]]');

            const parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed).toHaveLength(2);
            expect(parsed[0]!.items).toHaveLength(1);
            expect(parsed[0]!.lores).toEqual(['旧设定']);
            expect(parsed[1]!.lores).toEqual(['林动']);
            expect(parsed[1]!.items![0]!.important).toBe(true);
            expect(parsed[1]!.items![0]!.origin).toBe('引文');
        });

        it('merges matching lore sets regardless of order and keeps distinct sets separate on edit', async () => {
            let fileContent = manager.formatEntry({ time: '同一天', type: '主线', lores: ['甲', '乙'], description: '旧事件', chapter: '', rawBlock: '' });
            mockApp.vault.process.mockImplementation(async (_file: any, cb: (c: string) => string) => { fileContent = cb(fileContent); return fileContent; });
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            const file = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);

            await manager.appendEntry({ time: '同一天', type: '主线', lores: ['乙', '甲'], description: '新事件', chapter: '', rawBlock: '' }, 'Book 1');
            expect(manager.parseEntries(fileContent, 'Book 1')).toHaveLength(1);

            await manager.appendEntry({ time: '同一天', type: '主线', lores: ['丙'], description: '第三件事', chapter: '', rawBlock: '' }, 'Book 1');
            expect(manager.parseEntries(fileContent, 'Book 1')).toHaveLength(2);

            const edited = manager.parseEntries(fileContent, 'Book 1')[1]!;
            edited.lores = ['乙', '甲'];
            await manager.updateEntry(1, edited, 'Book 1');
            const result = manager.parseEntries(fileContent, 'Book 1');
            expect(result).toHaveLength(1);
            expect(result[0]!.items).toHaveLength(3);
        });

        it('25. appendEntry keeps same-name nodes of different types separate', async () => {
            let fileContent = `## 2026-09-28\n\n**类型**：主线\n- 主线事件 [[第1章]]\n\n<!-- wn-lore: 设定A -->\n\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: any, cb: (c: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            const dummyFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(dummyFile);

            const incomingEntry: TimelineEntry = {
                time: '2026-09-28',
                type: '支线',
                description: '支线事件',
                chapter: '第2章',
                rawBlock: '',
                lores: ['设定B'],
                items: [{
                    description: '支线事件',
                    chapter: '第2章',
                    important: true,
                    origin: '支线原著'
                }]
            };

            await manager.appendEntry(incomingEntry, 'Book 1');

            // Each type owns its own node and child events.
            const h2Matches = fileContent.match(/## 2026-09-28/g);
            expect(h2Matches).toHaveLength(2);

            // Both types should be persisted legibly above relevant events
            expect(fileContent).toContain('**类型**：主线');
            expect(fileContent).toContain('**类型**：支线');
            expect(fileContent).toContain('<!-- wn-lore: 设定A -->');
            expect(fileContent).toContain('<!-- wn-lore: 设定B -->');
            expect(fileContent).toContain('<!-- wn-important -->');
            expect(fileContent).toContain('<!-- origin: 支线原著 -->');

            const parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed).toHaveLength(2);
            expect(parsed[0].time).toBe('2026-09-28');
            expect(parsed[0].type).toBe('主线');
            expect(parsed[1].type).toBe('支线');
            expect(parsed[0].items).toHaveLength(1);
            expect(parsed[0].items![0].description).toBe('主线事件');
            expect(parsed[0].items![0].chapter).toBe('第1章');
            expect(parsed[1].items![0].description).toBe('支线事件');
            expect(parsed[1].items![0].chapter).toBe('第2章');
            expect(parsed[1].items![0].important).toBe(true);
            expect(parsed[1].items![0].origin).toBe('支线原著');
            expect(parsed[0].lores).toEqual(['设定A']);
            expect(parsed[1].lores).toEqual(['设定B']);
        });

        it('26. parseEntries migrates a legacy bottom type to the node', () => {
            const legacyContent = `## 2026-09-01\n- 旧事件一 [[第1章]]\n- 旧事件二 [[第2章]]\n\n**类型**：主线\n\n<!-- wn-lore: 宗门 -->\n\n---\n`;
            const parsed = manager.parseEntries(legacyContent, 'Book 1');

            expect(parsed).toHaveLength(1);
            expect(parsed[0].type).toBe('主线');
            expect(parsed[0].items).toHaveLength(2);
            expect(parsed[0].items![0].type).toBeUndefined();
            expect(parsed[0].items![1].type).toBeUndefined();
            expect(parsed[0].lores).toEqual(['宗门']);

            const formatted = manager.formatEntry(parsed[0]);
            expect(formatted).toContain('**类型**：主线');
            expect(formatted.indexOf('**类型**：主线')).toBeLessThan(formatted.indexOf('- 旧事件一'));

            const reparsed = manager.parseEntries(formatted, 'Book 1');
            expect(reparsed).toHaveLength(1);
            expect(reparsed[0].type).toBe('主线');
            expect(reparsed[0].items![0].chapter).toBe('第1章');
            expect(reparsed[0].items![1].chapter).toBe('第2章');
        });

        it('27. moveEventItem makes a moved card follow its target node type', async () => {
            const initialContent = `## 节点A\n**类型**：主线\n- 事件A1 [[第1章]]\n- 事件A2 [[第2章]]\n\n---\n\n## 节点B\n**类型**：支线\n- 事件B1 [[第3章]]\n\n---\n`;
            let fileContent = initialContent;
            mockApp.vault.process.mockImplementation(async (_file: any, cb: (c: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockApp.vault.read.mockImplementation(async () => fileContent);
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            const dummyFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(dummyFile);

            await manager.moveEventItem('节点A', 0, '节点B', 1, 'Book 1');

            const parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed).toHaveLength(2);
            const nodeA = parsed.find(e => e.time === '节点A');
            const nodeB = parsed.find(e => e.time === '节点B');
            expect(nodeA?.items).toHaveLength(1);
            expect(nodeA?.items![0].description).toBe('事件A2');
            expect(nodeB?.items).toHaveLength(2);
            expect(nodeB?.type).toBe('支线');
            expect(nodeB?.items![0].description).toBe('事件B1');
            expect(nodeB?.items![1].description).toBe('事件A1');
            expect(nodeB?.items![1].type).toBeUndefined();
        });

        it('locates the second same-name typed node in the source file', () => {
            const content = '## 第一天\n**类型**：主线\n- 甲事件\n\n---\n## 第一天\n**类型**：支线\n- 乙事件\n\n---\n';
            expect(manager.findEntryHeadingOffset(content, 0, 'Book 1')).toBe(0);
            expect(manager.findEntryHeadingOffset(content, 1, 'Book 1')).toBe(content.indexOf('## 第一天', 1));
        });

        it('splits interim mixed-type blocks into typed nodes without losing child events', () => {
            const interim = '## 同名节点\n\n**类型**：主线\n- 主线事件\n\n**类型**：\n- 无类型事件\n\n**类型**：支线\n- 支线事件\n\n---\n';
            const parsed = manager.parseEntries(interim, 'Book 1');
            expect(parsed.map(entry => entry.type)).toEqual(['主线', '', '支线']);
            expect(parsed.map(entry => entry.items?.[0].description)).toEqual(['主线事件', '无类型事件', '支线事件']);
            expect(manager.parseEntries(parsed.map(entry => manager.formatEntry(entry)).join(''), 'Book 1').map(entry => entry.type)).toEqual(['主线', '', '支线']);
        });

        it('keeps an untyped node separate from a same-name typed node', async () => {
            let fileContent = '## 同名节点\n\n**类型**：主线\n- 原事件\n\n---\n';
            mockApp.vault.process.mockImplementation(async (_file: any, cb: (c: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            mockApp.vault.getAbstractFileByPath.mockReturnValue(Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' }));

            await manager.appendEntry({ time: '同名节点', description: '无类型事件', chapter: '', rawBlock: '' }, 'Book 1');

            const parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed).toHaveLength(2);
            expect(parsed.map(entry => entry.type)).toEqual(['主线', '']);
            expect(parsed[0].items?.[0].description).toBe('原事件');
            expect(parsed[1].items?.[0].description).toBe('无类型事件');
        });

        it('targets the correct same-name node when moving an event and dropping a chapter', async () => {
            let fileContent = '## 同名节点\n**类型**：主线\n- 主线事件\n- 待移动事件\n\n---\n## 同名节点\n**类型**：支线\n- 支线事件\n\n---\n';
            const timelineFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            const chapterFile = Object.assign(new TFile(), { name: 'Chapter 2.md', basename: 'Chapter 2', path: 'Book 1/Chapter 2.md', extension: 'md' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === timelineFile.path ? timelineFile : path === chapterFile.path ? chapterFile : null);
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (content: string) => string) => { fileContent = cb(fileContent); });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([chapterFile]);

            await manager.moveEventItem(0, 1, 1, 1, 'Book 1');
            let parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed[0].items?.map(item => item.description)).toEqual(['主线事件']);
            expect(parsed[1].items?.map(item => item.description)).toEqual(['支线事件', '待移动事件']);

            await manager.syncChapterToEventItem(chapterFile, [{ entryIndex: 1, itemIndex: 1 }], 'Book 1');
            parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed[0].items?.[0].chapter).toBe('');
            expect(parsed[1].items?.[1].chapter).toBe('Chapter 2');
        });

        it('merges nodes when editing a type to an existing same-name type', async () => {
            let fileContent = '## 同名节点\n**类型**：主线\n- 主线事件\n\n---\n## 同名节点\n**类型**：支线\n- 支线事件\n\n---\n';
            const timelineFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(timelineFile);
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (content: string) => string) => { fileContent = cb(fileContent); });

            const edited = manager.parseEntries(fileContent, 'Book 1')[1];
            edited.type = '主线';
            await manager.updateEntry(1, edited, 'Book 1');

            const parsed = manager.parseEntries(fileContent, 'Book 1');
            expect(parsed).toHaveLength(1);
            expect(parsed[0].type).toBe('主线');
            expect(parsed[0].items?.map(item => item.description)).toEqual(['主线事件', '支线事件']);
        });
    });

    describe('Comma delimiter regression tests', () => {
        it('preserves literal JSON-like chapter names instead of interpreting them as nested lists', () => {
            const chapters = ['["literal"]', 'Chapter 1, Hello', '第2章，你好'];
            expect(parseTimelineChapterList(serializeTimelineChapterList(chapters))).toEqual(chapters);
        });

        it('preserves exact wikilinks with ASCII and fullwidth commas across parse and format roundtrip', () => {
            const markdown = `## 2023-01-01
**Type**：Battle

- Encounter at gates [[Chapter 1, Hello]] [[第2章，你好]] [[Vol 1, Part 1/Chapter 3, World|Alias, Text]]
  Additional line

---

`;
            const entries = manager.parseEntries(markdown, 'Book 1');
            expect(entries).toHaveLength(1);
            expect(entries[0].items).toHaveLength(1);

            // Format back to markdown
            const formatted = manager.formatEntry(entries[0]);
            expect(formatted).toContain('[[Chapter 1, Hello]]');
            expect(formatted).toContain('[[第2章，你好]]');
            expect(formatted).toContain('[[Vol 1, Part 1/Chapter 3, World|Alias, Text]]');
            expect(formatted).not.toContain('[[Chapter 1]]');
            expect(formatted).not.toContain('[[Hello]]');
            expect(formatted).not.toContain('[[第2章]]');
            expect(formatted).not.toContain('[[你好]]');
        });

        it('buildChapterToNodesMap resolves comma-bearing chapter files and reconciles frontmatter', async () => {
            const chap1 = Object.assign(new TFile(), {
                name: 'Chapter 1, Hello.md',
                basename: 'Chapter 1, Hello',
                path: 'Book 1/Chapter 1, Hello.md',
                extension: 'md'
            });
            const chap2 = Object.assign(new TFile(), {
                name: '第2章，你好.md',
                basename: '第2章，你好',
                path: 'Book 1/第2章，你好.md',
                extension: 'md'
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([chap1, chap2]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([chap1, chap2]);
            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) => {
                if (link === 'Chapter 1, Hello') return chap1;
                if (link === '第2章，你好') return chap2;
                return null;
            });

            const markdown = `## 2023-01-01
**Type**：Battle

- Event A [[Chapter 1, Hello]]
- Event B [[第2章，你好]]

---
`;
            const entries = manager.parseEntries(markdown, 'Book 1');
            const { chapterPathToNodes } = manager.buildChapterToNodesMap(entries, 'Book 1');
            expect(chapterPathToNodes.get(chap1.path)).toEqual(['2023-01-01']);
            expect(chapterPathToNodes.get(chap2.path)).toEqual(['2023-01-01']);
            const frontmatter = new Map<string, Record<string, unknown>>();
            mockApp.fileManager.processFrontMatter.mockImplementation(async (file: TFile, update: (fm: Record<string, unknown>) => void) => {
                const fm: Record<string, unknown> = {};
                update(fm);
                frontmatter.set(file.path, fm);
            });
            await manager.reconcileFrontmatter('Book 1', entries);
            expect(frontmatter.get(chap1.path)?.timeline).toBe('2023-01-01');
            expect(frontmatter.get(chap2.path)?.timeline).toBe('2023-01-01');
        });

        it('syncChapterToEventItem adds and removes comma-bearing chapters without corrupting other refs', async () => {
            let fileContent = `## 2023-01-01
**Type**：Battle

- Event A [[Chapter 1, Hello]] [[Existing Chapter]]

---
`;
            const timelineFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            const targetChap = Object.assign(new TFile(), {
                name: 'Chapter 1, Hello.md',
                basename: 'Chapter 1, Hello',
                path: 'Book 1/Chapter 1, Hello.md',
                extension: 'md'
            });
            const existingChap = Object.assign(new TFile(), {
                name: 'Existing Chapter.md',
                basename: 'Existing Chapter',
                path: 'Book 1/Existing Chapter.md',
                extension: 'md'
            });
            const newChap = Object.assign(new TFile(), {
                name: '第2章，你好.md',
                basename: '第2章，你好',
                path: 'Book 1/第2章，你好.md',
                extension: 'md'
            });

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === timelineFile.path) return timelineFile;
                if (path === targetChap.path) return targetChap;
                if (path === existingChap.path) return existingChap;
                if (path === newChap.path) return newChap;
                return null;
            });
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (content: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([targetChap, existingChap, newChap]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([targetChap, existingChap, newChap]);
            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) => {
                if (link === 'Chapter 1, Hello') return targetChap;
                if (link === 'Existing Chapter') return existingChap;
                if (link === '第2章，你好') return newChap;
                return null;
            });
            const frontmatter = new Map<string, Record<string, unknown>>();
            mockApp.fileManager.processFrontMatter.mockImplementation(async (file: TFile, update: (fm: Record<string, unknown>) => void) => {
                const fm = frontmatter.get(file.path) ?? {};
                update(fm);
                frontmatter.set(file.path, fm);
            });

            // 1. Add newChap (with fullwidth comma) to Event A
            await manager.syncChapterToEventItem(newChap, [{ entryIndex: 0, itemIndex: 0 }], 'Book 1');
            expect(fileContent).toContain('[[Chapter 1, Hello]]');
            expect(fileContent).toContain('[[Existing Chapter]]');
            expect(fileContent).toContain('[[第2章，你好]]');
            expect(frontmatter.get(targetChap.path)?.timeline).toBe('2023-01-01');
            expect(frontmatter.get(newChap.path)?.timeline).toBe('2023-01-01');

            // 2. Remove targetChap from all events
            await manager.syncChapterToEventItem(targetChap, [], 'Book 1');
            expect(fileContent).not.toContain('[[Chapter 1, Hello]]');
            expect(fileContent).toContain('[[Existing Chapter]]');
            expect(fileContent).toContain('[[第2章，你好]]');
            expect(frontmatter.get(targetChap.path)).not.toHaveProperty('timeline');
            expect(frontmatter.get(existingChap.path)?.timeline).toBe('2023-01-01');
            expect(frontmatter.get(newChap.path)?.timeline).toBe('2023-01-01');
        });

        it('buildChapterToNodesMap creates reference index once for many links and preserves comma, alias, and duplicate chapter behavior', () => {
            const vol1Ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/Vol 1/第1章.md', extension: 'md' });
            const vol2Ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/Vol 2/第1章.md', extension: 'md' });
            const commaChap = Object.assign(new TFile(), { name: '第2章，你好.md', basename: '第2章，你好', path: 'Book 1/第2章，你好.md', extension: 'md' });
            const uniqueChap = Object.assign(new TFile(), { name: '第3章.md', basename: '第3章', path: 'Book 1/第3章.md', extension: 'md' });

            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([vol1Ch1, vol2Ch1, commaChap, uniqueChap]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([vol1Ch1, vol2Ch1, commaChap, uniqueChap]);

            const markdown = `## 2023-01-01
- Event 1 [[Vol 1/第1章|第1章]] [[第2章，你好]]
- Event 2 [[Vol 2/第1章]] [[第3章]]
---
## 2023-01-02
- Event 3 [[Vol 1/第1章]] [[第3章|第三章别名]]
- Event 4 [[第2章，你好]]
---
`;
            const entries = manager.parseEntries(markdown, 'Book 1');
            const createIndexSpy = vi.spyOn(ChapterSorter, 'createReferenceIndex');

            const { chapterPathToNodes } = manager.buildChapterToNodesMap(entries, 'Book 1');

            expect(createIndexSpy).toHaveBeenCalledTimes(1);
            expect(chapterPathToNodes.get(vol1Ch1.path)).toEqual(['2023-01-01', '2023-01-02']);
            expect(chapterPathToNodes.get(vol2Ch1.path)).toEqual(['2023-01-01']);
            expect(chapterPathToNodes.get(commaChap.path)).toEqual(['2023-01-01', '2023-01-02']);
            expect(chapterPathToNodes.get(uniqueChap.path)).toEqual(['2023-01-01', '2023-01-02']);

            createIndexSpy.mockRestore();
        });

        it('syncChapterToEventItem creates reference index once per sync operation across many links and preserves comma/alias/duplicate behavior', async () => {
            const vol1Ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/Vol 1/第1章.md', extension: 'md' });
            const vol2Ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/Vol 2/第1章.md', extension: 'md' });
            const commaChap = Object.assign(new TFile(), { name: '第2章，你好.md', basename: '第2章，你好', path: 'Book 1/第2章，你好.md', extension: 'md' });
            const timelineFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });

            let fileContent = `## 2023-01-01
- Event 1 [[Vol 1/第1章|第1章]] [[第2章，你好]]
- Event 2 [[Vol 2/第1章]]
---
`;
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([vol1Ch1, vol2Ch1, commaChap]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([vol1Ch1, vol2Ch1, commaChap]);

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === timelineFile.path) return timelineFile;
                if (path === vol1Ch1.path) return vol1Ch1;
                if (path === vol2Ch1.path) return vol2Ch1;
                if (path === commaChap.path) return commaChap;
                return null;
            });
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (content: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });
            mockApp.fileManager.processFrontMatter.mockImplementation(async () => {});
			mockApp.metadataCache.fileToLinktext.mockReturnValue('Vol 2/第1章');

            // Spy on reconcileFrontmatter to isolate syncChapterToEventItem's own index construction
            const reconcileSpy = vi.spyOn(manager, 'reconcileFrontmatter').mockResolvedValue();
            const createIndexSpy = vi.spyOn(ChapterSorter, 'createReferenceIndex');

            await manager.syncChapterToEventItem('Vol 2/第1章', [{ entryIndex: 0, itemIndex: 0 }], 'Book 1');
            expect(createIndexSpy).toHaveBeenCalledTimes(1);
            expect(fileContent).toContain('Vol 2/第1章');

            createIndexSpy.mockRestore();
            reconcileSpy.mockRestore();
        });

        it('moveEventItem preserves comma-bearing chapters on moving items', async () => {
            let fileContent = `## Node 1
- Event with comma chapter [[Chapter 1, Hello]]

---
## Node 2
- Other event

---
`;
            const timelineFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md' });
            mockApp.vault.getAbstractFileByPath.mockReturnValue(timelineFile);
            mockApp.vault.cachedRead.mockImplementation(async () => fileContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (content: string) => string) => {
                fileContent = cb(fileContent);
                return fileContent;
            });

            await manager.moveEventItem(0, 0, 1, 0, 'Book 1');
            expect(fileContent).toContain('[[Chapter 1, Hello]]');
            expect(fileContent).not.toContain('[[Chapter 1]]');
            expect(fileContent).not.toContain('[[Hello]]');
        });
    });

    describe('filterTimelineEntries', () => {
        const sampleEntries: TimelineEntry[] = [
            {
                time: 'Day 1',
                type: 'Main',
                description: 'Main event',
                chapter: 'Chapter 1',
                rawBlock: '',
                lores: ['LoreA'],
                items: [
                    { description: 'Sibling item 1', chapter: 'Chapter 1' },
                    { description: 'Sibling item 2', chapter: 'Chapter 1' }
                ]
            },
            {
                time: 'Day 2',
                type: 'Sub',
                description: 'Sub event',
                chapter: 'Chapter 2',
                rawBlock: '',
                lores: ['LoreB'],
                items: [{ description: 'Sub event item', chapter: 'Chapter 2' }]
            },
            {
                time: 'Day 3',
                type: 'Side',
                description: 'Side event',
                chapter: 'Chapter 3',
                rawBlock: '',
                lores: ['LoreA', 'LoreC'],
                items: [{ description: 'Side item', chapter: 'Chapter 3' }]
            },
            {
                time: 'Day 4',
                description: 'Untyped legacy event',
                chapter: 'Chapter 4',
                rawBlock: '',
                items: [{ description: 'Untyped item', chapter: 'Chapter 4' }]
            },
            {
                time: 'Day 5',
                type: 'all',
                description: 'Custom type named all',
                chapter: 'Chapter 5',
                rawBlock: '',
                lores: ['LoreB'],
                items: [{ description: 'Custom all item', chapter: 'Chapter 5' }]
            }
        ];

        it('returns all entries including untyped ones when selectedTypes and selectedLores are empty', () => {
            const result = filterTimelineEntries(sampleEntries, [], []);
            expect(result).toHaveLength(5);
            expect(result.map(e => e.time)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5']);
        });

        it('supports Set as input for selectedTypes and selectedLores', () => {
            const result = filterTimelineEntries(sampleEntries, new Set(['Main']), new Set(['LoreA']));
            expect(result).toHaveLength(1);
            expect(result[0].time).toBe('Day 1');
        });

        it('filters by single type and excludes untyped entries', () => {
            const result = filterTimelineEntries(sampleEntries, ['Main']);
            expect(result).toHaveLength(1);
            expect(result[0].time).toBe('Day 1');
        });

        it('filters by multiple types as OR, excluding third type and untyped entries', () => {
            const result = filterTimelineEntries(sampleEntries, ['Main', 'Sub']);
            expect(result).toHaveLength(2);
            expect(result.map(e => e.time)).toEqual(['Day 1', 'Day 2']);
        });

        it('clearing types (empty array) returns to all entries including untyped', () => {
            const filtered = filterTimelineEntries(sampleEntries, ['Main']);
            expect(filtered).toHaveLength(1);
            const cleared = filterTimelineEntries(sampleEntries, []);
            expect(cleared).toHaveLength(5);
        });

        it('filters an actual custom type named "all" specifically without treating it as a sentinel', () => {
            const result = filterTimelineEntries(sampleEntries, ['all']);
            expect(result).toHaveLength(1);
            expect(result[0].time).toBe('Day 5');
            expect(result[0].type).toBe('all');
        });

        it('filters multiple lores as OR', () => {
            const result = filterTimelineEntries(sampleEntries, [], ['LoreB', 'LoreC']);
            expect(result).toHaveLength(3);
            expect(result.map(e => e.time)).toEqual(['Day 2', 'Day 3', 'Day 5']);
        });

        it('combines types (OR) and lores (OR) with AND logic', () => {
            // Types: Main or Side. Lores: LoreC.
            // Day 1: Main, LoreA -> fails lore
            // Day 3: Side, LoreA & LoreC -> matches both
            const result = filterTimelineEntries(sampleEntries, ['Main', 'Side'], ['LoreC']);
            expect(result).toHaveLength(1);
            expect(result[0].time).toBe('Day 3');
        });

        it('preserves all sibling items on matching node (node-level filtering)', () => {
            const result = filterTimelineEntries(sampleEntries, ['Main']);
            expect(result).toHaveLength(1);
            expect(result[0].items).toHaveLength(2);
            expect(result[0].items?.[0].description).toBe('Sibling item 1');
            expect(result[0].items?.[1].description).toBe('Sibling item 2');
        });

        it('does not mutate original entries array or selection inputs', () => {
            const entriesCopy = [...sampleEntries];
            const typesInput = ['Main', 'Sub'];
            const loresInput = ['LoreA'];
            const result = filterTimelineEntries(entriesCopy, typesInput, loresInput);
            expect(result).not.toBe(entriesCopy);
            expect(typesInput).toEqual(['Main', 'Sub']);
            expect(loresInput).toEqual(['LoreA']);
            expect(sampleEntries).toHaveLength(5);
        });
    });

    describe('Atomic transforms, concurrent survival & stale UI index guards', () => {
        let dummyTlFile: TFile;

        beforeEach(() => {
            dummyTlFile = Object.assign(new TFile(), { name: 'Timeline.md', path: 'Book 1/Timeline.md', basename: 'Timeline' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                return null;
            });
        });

        it('updateEntry should preserve concurrent added entries when writing to file', async () => {
            // Initial content before concurrent edit
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Event A\n---\n`);
            // vault.process receives latest file content that includes a concurrently added entry
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                const latestContentWithConcurrent = `## 2023-01-01\n- Event A\n---\n\n## 2023-01-02\n- Concurrent Event B\n---\n`;
                return cb(latestContentWithConcurrent);
            });

            const result = await manager.updateEntry(0, {
                time: '2023-01-01',
                items: [{ description: 'Updated Event A', chapter: '' }]
            } as TimelineEntry, 'Book 1');

            expect(result).toContain('Updated Event A');
            expect(result).toContain('Concurrent Event B');
        });

        it('deleteEntry should preserve concurrent added entries', async () => {
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Event A\n---\n## 2023-01-02\n- Event B\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                const latestContent = `## 2023-01-01\n- Event A\n---\n## 2023-01-02\n- Event B\n---\n\n## 2023-01-03\n- Concurrent Event C\n---\n`;
                return cb(latestContent);
            });

            const result = await manager.deleteEntry(0, 'Book 1');
            expect(result).not.toContain('Event A');
            expect(result).toContain('Event B');
            expect(result).toContain('Concurrent Event C');
        });

        it('updateEntry guards against stale UI index using expectedEntry snapshot', async () => {
            // UI captured index 0 for Event A, but in the actual file a new entry was inserted at index 0
            const expectedSnapshot: TimelineEntry = {
                time: '2023-01-01',
                type: 'Main',
                description: 'Event A',
                chapter: '',
                rawBlock: '',
                items: [{ description: 'Event A', chapter: '' }]
            };
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n**Type**：Main\n- Event A\n---\n`);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                const shiftedContent = `## 2022-12-31\n**Type**：Intro\n- Event Zero\n---\n\n## 2023-01-01\n**Type**：Main\n- Event A\n---\n`;
                return cb(shiftedContent);
            });

            // UI passes stale index 0, but provides expectedEntry snapshot
            const result = await manager.updateEntry(0, {
                time: '2023-01-01',
                type: 'Main',
                items: [{ description: 'Updated Event A', chapter: '' }]
            } as TimelineEntry, 'Book 1', expectedSnapshot);

            expect(result).toContain('Event Zero');
            expect(result).toContain('Updated Event A');
            expect(result).not.toContain('- Event A\n');
        });

        it('updateEntry rejects write and throws when target node is missing/conflicted', async () => {
            const expectedSnapshot: TimelineEntry = {
                time: '2023-01-01',
                type: 'Main',
                description: 'Event A',
                chapter: '',
                rawBlock: '',
                items: [{ description: 'Event A', chapter: '' }]
            };
            const differentContent = `## 2024-01-01\n**Type**：Battle\n- Boss Fight\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(differentContent);
            });

            await expect(manager.updateEntry(0, {
                time: '2023-01-01',
                type: 'Main',
                items: [{ description: 'Conflicted Update', chapter: '' }]
            } as TimelineEntry, 'Book 1', expectedSnapshot)).rejects.toThrow();
        });

        it('rejects update with conflict when time/type match but description or lores changed', async () => {
            const expectedSnapshot: TimelineEntry = {
                time: '2023-01-01',
                type: 'Main',
                description: 'Original Description',
                chapter: '',
                rawBlock: '',
                lores: ['OriginalLore'],
                items: [{ description: 'Original Description', chapter: '' }]
            };
            // Latest file has same time and type, but description and lores changed concurrently
            const modifiedContent = `## 2023-01-01\n**Type**：Main\n- Concurrent Changed Description\n\n<!-- wn-lore: ChangedLore -->\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(modifiedContent);
            });

            await expect(manager.updateEntry(0, {
                time: '2023-01-01',
                type: 'Main',
                description: 'Attempted Update',
                chapter: '',
                rawBlock: '',
                lores: ['OriginalLore'],
                items: [{ description: 'Attempted Update', chapter: '' }]
            } as TimelineEntry, 'Book 1', expectedSnapshot)).rejects.toThrow();
        });

        it('safely rejects ambiguous relocation when duplicate same-name nodes exist in latest file', async () => {
            const expectedSnapshot: TimelineEntry = {
                time: '2023-01-01',
                type: 'Main',
                description: 'Duplicate Event',
                chapter: '',
                rawBlock: '',
                items: [{ description: 'Duplicate Event', chapter: '' }]
            };
            // Latest file has two identical nodes, making relocation from stale/invalid index ambiguous
            const duplicateContent = `## 2023-01-01\n**Type**：Main\n- Duplicate Event\n---\n\n## 2023-01-01\n**Type**：Main\n- Duplicate Event\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(duplicateContent);
            });

            // Index 5 does not match directly, requires relocation which finds 2 candidates -> ambiguous!
            await expect(manager.updateEntry(5, {
                time: '2023-01-01',
                type: 'Main',
                items: [{ description: 'Modified Event', chapter: '' }]
            } as TimelineEntry, 'Book 1', expectedSnapshot)).rejects.toThrow();
        });

        it('emptied latest content does not resurrect cached baseEntries', async () => {
            // Pre-cached entries exist from prior load
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Old Cached Event\n---\n`);
            // But vault.process receives an empty string because user cleared the file
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb('');
            });

            const result = await manager.updateEntry(0, {
                time: '2023-01-01',
                items: [{ description: 'Should Not Resurrect', chapter: '' }]
            } as TimelineEntry, 'Book 1');

            expect(result).toBe('');
            expect(result).not.toContain('Old Cached Event');
        });

        it('moveEventItem does not delete node when source is target and temporarily has zero items', async () => {
            const initialContent = `## 2023-01-01\n- Only Item\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(initialContent);
            });

            const result = await manager.moveEventItem(0, 0, 0, 0, 'Book 1', {
                description: 'Only Item',
                chapter: ''
            });

            expect(result).toContain('## 2023-01-01');
            expect(result).toContain('Only Item');
        });

        it('syncChapterToEventItem validates targets before removing links and preserves links on conflict', async () => {
            const initialContent = `## Node 1\n- Event A [[Chapter 2]]\n---\n## Node 2\n- Event B\n---\n`;
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(initialContent);
            });

            const nonExistentExpected: TimelineEntry = {
                time: 'Ghost Node',
                description: 'Does Not Exist',
                chapter: '',
                rawBlock: ''
            };

            const targetFile = Object.assign(new TFile(), { name: 'Chapter 2.md', path: 'Book 1/Chapter 2.md', basename: 'Chapter 2' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 2.md') return targetFile;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles = vi.fn(() => [targetFile]);
            mockPlugin.getVaultMarkdownFiles = vi.fn(() => [targetFile]);
            mockApp.metadataCache.getFirstLinkpathDest = vi.fn(() => targetFile);

            // Target specifies expectedEntry that cannot be found
            await expect(manager.syncChapterToEventItem(targetFile, [{
                entryIndex: 1,
                expectedEntry: nonExistentExpected
            }], 'Book 1')).rejects.toThrow();
        });

        it('moves items using both original node snapshots after concurrent node insertion', async () => {
            const original = '## Source\n- First\n- Second\n---\n\n## Target\n- Third\n---\n';
            const [source, target] = manager.parseEntries(original, 'Book 1');
            let stored = '## Inserted\n- Concurrent\n---\n\n' + original;
            mockApp.vault.process.mockImplementation(async (_file: TFile, callback: (content: string) => string) => {
                stored = callback(stored);
            });
            await manager.moveEventItem(0, 0, 1, 1, 'Book 1', source.items![0], source, target);
            const result = manager.parseEntries(stored, 'Book 1');
            expect(result.map(entry => entry.time)).toEqual(['Inserted', 'Source', 'Target']);
            expect(result[1].items?.map(item => item.description)).toEqual(['Second']);
            expect(result[2].items?.map(item => item.description)).toEqual(['Third', 'First']);
        });

        it('rejects a changed move destination and preserves file and chapter metadata', async () => {
            const original = '## Source\n- First\n---\n\n## Target\n- Second\n---\n';
            const [source, target] = manager.parseEntries(original, 'Book 1');
            const latest = original.replace('Second', 'Changed elsewhere');
            let stored = latest;
            mockApp.vault.process.mockImplementation(async (_file: TFile, callback: (content: string) => string) => {
                stored = callback(stored);
            });
            await expect(manager.moveEntry(0, 1, 'Book 1', source, target)).rejects.toThrow();
            expect(stored).toBe(latest);
            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
        });

        it('invalid index fails safely without throwing or modifying file', async () => {
            const initialContent = `## 2023-01-01\n- Event A\n---\n`;
            mockApp.vault.read.mockResolvedValue(initialContent);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                return cb(initialContent);
            });

            const result = await manager.updateEntry(-1, { time: 'X', items: [] } as unknown as TimelineEntry, 'Book 1');
            expect(result).toBe(initialContent);

            const delResult = await manager.deleteEntry(999, 'Book 1');
            expect(delResult).toBe(initialContent);
        });

        it('reconciles frontmatter from resulting entries rather than stale snapshot', async () => {
            const chap1 = Object.assign(new TFile(), { name: 'Chapter 1.md', path: 'Book 1/Chapter 1.md', basename: 'Chapter 1' });
            const chap2 = Object.assign(new TFile(), { name: 'Chapter 2.md', path: 'Book 1/Chapter 2.md', basename: 'Chapter 2' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return dummyTlFile;
                if (p === 'Book 1/Chapter 1.md') return chap1;
                if (p === 'Book 1/Chapter 2.md') return chap2;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles = vi.fn(() => [chap1, chap2]);
            mockPlugin.getVaultMarkdownFiles = vi.fn(() => [chap1, chap2]);
            mockApp.metadataCache.getFirstLinkpathDest = vi.fn((link: string) => link === 'Chapter 2' ? chap2 : chap1);
            mockApp.metadataCache.getFileCache = vi.fn(() => null);

            // Stale snapshot had only Chapter 1
            mockApp.vault.read.mockResolvedValue(`## 2023-01-01\n- Event A [[Chapter 1]]\n---\n`);
            // Latest process content had concurrent Chapter 2 link
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                const latestWithChap2 = `## 2023-01-01\n- Event A [[Chapter 1]]\n---\n\n## 2023-01-02\n- Event B [[Chapter 2]]\n---\n`;
                return cb(latestWithChap2);
            });

            const frontmatters = new Map<string, Record<string, unknown>>();
            mockApp.fileManager.processFrontMatter.mockImplementation(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
                const fm = frontmatters.get(file.path) || {};
                fn(fm);
                frontmatters.set(file.path, fm);
            });

            await manager.updateEntry(0, {
                time: '2023-01-01',
                items: [{ description: 'Event A updated', chapter: 'Chapter 1' }]
            } as TimelineEntry, 'Book 1');

            // Chapter 2 must be reconciled from the actual resulting entries
            expect(frontmatters.get('Book 1/Chapter 2.md')?.timeline).toBe('2023-01-02');
        });

        it('updateEntry expected snapshot semantics preserves full deep-cloned entry with items, origin, and lores', async () => {
            let fileContent = '';
            const initialContent = `
---
timeline:
  - '2023-01-01'
---
## 2023-01-01
- [主线] [宗门] 试炼开启 ^quote: 钟声九响
`;
            mockApp.vault.process.mockImplementation(async (file: unknown, cb: (c: string) => string) => {
                fileContent = cb(initialContent);
                return fileContent;
            });

            const parsed = manager.parseEntries(initialContent, 'Book 1');
            expect(parsed).toHaveLength(1);
            const originalSnapshot = parsed[0];

            // Stale index passed (e.g. index 5 instead of 0), but expectedEntry provided
            const updated = {
                ...originalSnapshot,
                items: [{ description: '试炼圆满结束', chapter: '', origin: '各峰长老赞叹', important: true }]
            } as TimelineEntry;

            const res = await manager.updateEntry(5, updated, 'Book 1', originalSnapshot);
            expect(res).toContain('试炼圆满结束');
            expect(res).toContain('各峰长老赞叹');

            // Mismatched expectedEntry snapshot should reject with conflict
            const mismatchedSnapshot = {
                ...originalSnapshot,
                time: '2023-99-99'
            };
            await expect(manager.updateEntry(0, updated, 'Book 1', mismatchedSnapshot)).rejects.toThrow();
        });
    });

    it('rejects a queued modal update if its source file is replaced, even with identical node data', async () => {
        const originalFile = Object.assign(new TFile(), { path: 'Book 1/Timeline.md' });
        const replacementFile = Object.assign(new TFile(), { path: originalFile.path });
        let currentFile = originalFile;
        vi.spyOn(manager, 'getTimelineFile').mockImplementation(() => currentFile);
        const content = manager.formatEntry({ time: 'Day 1', description: 'Original event', chapter: '', rawBlock: '' });
        const entry = manager.parseEntries(content, 'Book 1')[0];
        mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => transform(content));
        const update = manager.updateEntry(0, entry, 'Book 1', entry, { file: originalFile, path: originalFile.path });
        currentFile = replacementFile;
        await expect(update).rejects.toThrow();
        expect(mockApp.vault.process).not.toHaveBeenCalled();
        currentFile = originalFile;
        let wrote = false;
        mockApp.vault.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => {
            currentFile = replacementFile;
            const next = transform(content);
            wrote = true;
            return next;
        });
        await expect(manager.updateEntry(0, entry, 'Book 1', entry, { file: originalFile, path: originalFile.path })).rejects.toThrow();
        expect(wrote).toBe(false);
    });

    describe('getTimelineNodesForChapter', () => {
        it('matches chapters with same name across volumes and ignores ambiguous references', () => {
            const vol1Ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/卷1/第1章.md', extension: 'md' });
            const vol2Ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/卷2/第1章.md', extension: 'md' });
            const ch2 = Object.assign(new TFile(), { name: '第2章.md', basename: '第2章', path: 'Book 1/第2章.md', extension: 'md' });

            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([vol1Ch1, vol2Ch1, ch2]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([vol1Ch1, vol2Ch1, ch2]);

            const entries: TimelineEntry[] = [
                {
                    time: '2023-01-01',
                    type: '主线',
                    description: '卷1专属事件',
                    chapter: '[[卷1/第1章]]',
                    rawBlock: '',
                    items: [{ description: '卷1专属事件', chapter: '[[卷1/第1章]]', origin: '原文卷1', type: '主线' }]
                },
                {
                    time: '2023-01-01',
                    type: '支线',
                    description: '卷2专属事件',
                    chapter: '[[卷2/第1章]]',
                    rawBlock: '',
                    items: [{ description: '卷2专属事件', chapter: '[[卷2/第1章]]', origin: '原文卷2', type: '支线' }]
                },
                {
                    time: '2023-01-02',
                    type: '主线',
                    description: '跨卷歧义引用事件',
                    chapter: '[[第1章]]',
                    rawBlock: '',
                    items: [{ description: '跨卷歧义引用事件', chapter: '[[第1章]]', origin: '歧义原文', type: '主线' }]
                }
            ];

            const nodesVol1 = manager.getTimelineNodesForChapter(vol1Ch1, entries, 'Book 1');
            expect(nodesVol1).toHaveLength(1);
            expect(nodesVol1[0].time).toBe('2023-01-01');
            expect(nodesVol1[0].type).toBe('主线');
            expect(nodesVol1[0].items).toHaveLength(1);
            expect(nodesVol1[0].items[0].description).toBe('卷1专属事件');
            expect(nodesVol1[0].items[0].origin).toBe('原文卷1');

            const nodesVol2 = manager.getTimelineNodesForChapter(vol2Ch1, entries, 'Book 1');
            expect(nodesVol2).toHaveLength(1);
            expect(nodesVol2[0].time).toBe('2023-01-01');
            expect(nodesVol2[0].type).toBe('支线');
            expect(nodesVol2[0].items).toHaveLength(1);
            expect(nodesVol2[0].items[0].description).toBe('卷2专属事件');

            // Ambiguous reference [[第1章]] cannot match either vol1 or vol2 uniquely
            const allVol1Items = nodesVol1.flatMap(n => n.items);
            expect(allVol1Items.some(it => it.description === '跨卷歧义引用事件')).toBe(false);
            const allVol2Items = nodesVol2.flatMap(n => n.items);
            expect(allVol2Items.some(it => it.description === '跨卷歧义引用事件')).toBe(false);
        });

        it('filters multi-event and multi-chapter nodes without leaking aggregate node origin to individual items', () => {
            const ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/第1章.md', extension: 'md' });
            const ch2 = Object.assign(new TFile(), { name: '第2章.md', basename: '第2章', path: 'Book 1/第2章.md', extension: 'md' });
            const ch3 = Object.assign(new TFile(), { name: '第3章.md', basename: '第3章', path: 'Book 1/第3章.md', extension: 'md' });

            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1, ch2, ch3]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1, ch2, ch3]);

            const entries: TimelineEntry[] = [
                {
                    time: '纪元历100年',
                    type: '主线',
                    description: '聚合描述',
                    chapter: '[[第1章]], [[第2章]], [[第3章]]',
                    origin: '节点级聚合原文',
                    rawBlock: '',
                    items: [
                        { description: '第1章事件A', chapter: '[[第1章]]', origin: '章1具体原文' },
                        { description: '第2章独占事件', chapter: '[[第2章]]', origin: '章2具体原文' },
                        { description: '第1章事件B（无原文，多章节JSON语法）', chapter: '["第1章", "第3章"]' }
                    ]
                }
            ];

            const nodes = manager.getTimelineNodesForChapter(ch1, entries, 'Book 1');
            expect(nodes).toHaveLength(1);
            expect(nodes[0].time).toBe('纪元历100年');
            expect(nodes[0].items).toHaveLength(2);

            expect(nodes[0].items[0].description).toBe('第1章事件A');
            expect(nodes[0].items[0].origin).toBe('章1具体原文');

            expect(nodes[0].items[1].description).toBe('第1章事件B（无原文，多章节JSON语法）');
            // Must NOT fall back to aggregate node origin!
            expect(nodes[0].items[1].origin).toBeUndefined();
        });

        it('supports legacy node with no items mapping description/chapter/origin as a single item', () => {
            const ch1 = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/第1章.md', extension: 'md' });
            const ch2 = Object.assign(new TFile(), { name: '第2章.md', basename: '第2章', path: 'Book 1/第2章.md', extension: 'md' });

            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1, ch2]);

            const legacyEntry: TimelineEntry = {
                time: '纪元历200年',
                type: '秘境',
                description: '旧单条目事件描述',
                chapter: '[[第1章]]',
                origin: '旧条目原文标记',
                rawBlock: ''
            };

            const nodesCh1 = manager.getTimelineNodesForChapter(ch1, [legacyEntry], 'Book 1');
            expect(nodesCh1).toHaveLength(1);
            expect(nodesCh1[0].time).toBe('纪元历200年');
            expect(nodesCh1[0].type).toBe('秘境');
            expect(nodesCh1[0].items).toHaveLength(1);
            expect(nodesCh1[0].items[0].description).toBe('旧单条目事件描述');
            expect(nodesCh1[0].items[0].origin).toBe('旧条目原文标记');

            const nodesCh2 = manager.getTimelineNodesForChapter(ch2, [legacyEntry], 'Book 1');
            expect(nodesCh2).toHaveLength(0);
        });

        it('returns empty array when chapter is in another work or entries is empty', () => {
            const extCh = Object.assign(new TFile(), { name: '外书章节.md', basename: '外书章节', path: 'Book 2/外书章节.md', extension: 'md' });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([]);

            expect(manager.getTimelineNodesForChapter(extCh, [], 'Book 1')).toEqual([]);
        });
    });

    describe('ChapterReferenceService integration', () => {
        it.each(['Timeline', 'Foreshadowing'])('settles an empty reference cache when navigating to %s details', async (basename) => {
            const { source, service } = referenceFixture();
            const file = Object.assign(new TFile(), { name: `${basename}.md`, basename, path: `Book 1/${basename}.md`, extension: 'md', parent: source.parent });
            const lookup = mockApp.vault.getAbstractFileByPath.getMockImplementation();
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === file.path ? file : lookup(path));
            mockPlugin.isPluginGeneratedFile.mockImplementation((name: string) => name === basename);
            expect(ChapterSorter.isFunctionalDoc(file, mockPlugin)).toBe(true);
            expect(service.getReferencesSync(file)).toBeNull();
            await expect(service.prefetchReferences(file)).resolves.toEqual([]);
            // Editor refresh must observe a ready empty result, rather than schedule another prefetch forever.
            expect(service.getReferencesSync(file)).toEqual([]);
            await expect(service.prefetchReferences(file)).resolves.toEqual([]);
            expect(service.getReferencesSync(file)).toEqual([]);
            expect(mockApp.vault.read).not.toHaveBeenCalled();
            await service.destroy();
        });

        function referenceFixture() {
            const folder = { path: 'Book 1', isRoot: () => false, parent: null };
            const source = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 1/Timeline.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            const chapter = Object.assign(new TFile(), { name: 'Chapter 1.md', basename: 'Chapter 1', path: 'Book 1/Chapter 1.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === source.path ? source : path === chapter.path ? chapter : null);
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([chapter]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([chapter]);
            mockPlugin.timelineManager = manager;
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: true };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: false };
            const content = manager.formatEntry({ time: 'Day 1', description: 'Event', chapter: 'Chapter 1', origin: 'Alpha beta', rawBlock: '', items: [{ description: 'Event', chapter: 'Chapter 1', origin: 'Alpha beta' }] });
            mockApp.vault.read.mockResolvedValue(content);
            return { source, chapter, content, service: new ChapterReferenceService(mockApp, mockPlugin) };
        }

        it('does not recollect references for a deleted editor file after scoped invalidation', async () => {
            const { chapter, service } = referenceFixture();
            expect(await service.prefetchReferences(chapter)).not.toEqual([]);
            const lookup = mockApp.vault.getAbstractFileByPath.getMockImplementation();
            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => p === chapter.path ? null : lookup(p));
            const deletions = mockApp.vault.on.mock.calls.filter((call: unknown[]) => call[0] === 'delete');
            const onDelete = deletions[deletions.length - 1][1] as (file: TFile) => void;
            onDelete(chapter);
            expect(await service.prefetchReferences(chapter)).toEqual([]);
            await service.destroy();
        });

        it('coalesces pending reads, rejects a disabled result, and waits for outstanding reads on destroy', async () => {
            const { chapter, content, service } = referenceFixture();
            let finish!: (content: string) => void;
            mockApp.vault.read.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
            const first = service.prefetchReferences(chapter);
            const second = service.prefetchReferences(chapter);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
            mockPlugin.settings.timeline.showEditorReferences = false;
            service.notifyRefresh();
            let destroyed = false;
            const shutdown = service.destroy().then(() => { destroyed = true; });
            await Promise.resolve();
            expect(destroyed).toBe(false);
            finish(content);
            expect(await first).toEqual([]);
            expect(await second).toEqual([]);
            await shutdown;
            expect(mockApp.vault.offref).toHaveBeenCalled();
            expect(service.getReferencesSync(chapter)).toEqual([]);
        });

        it('retries read errors and refreshes changed source data even when its mtime is unchanged', async () => {
            const { chapter, source, content, service } = referenceFixture();
            mockApp.vault.read.mockRejectedValueOnce(new Error('Transient read error'));
            await expect(service.prefetchReferences(chapter)).rejects.toThrow('Transient read error');
            expect((await service.prefetchReferences(chapter))[0].quote).toBe('Alpha beta');
            mockApp.vault.read.mockResolvedValue(content.replace('Alpha beta', 'Current quote'));
            const listeners = mockApp.vault.on.mock.calls.filter((call: unknown[]) => call[0] === 'modify');
            const change = listeners[listeners.length - 1][1] as (file: TFile) => void;
            change(source);
            expect(service.getReferencesSync(chapter)).toBeNull();
            expect((await service.prefetchReferences(chapter))[0].quote).toBe('Current quote');
            await service.destroy();
        });

        it('collects only actual planting and recovery quotes associated with this chapter', async () => {
            const { chapter, service } = referenceFixture();
            const fsFile = Object.assign(new TFile(), { name: 'Foreshadowing.md', basename: 'Foreshadowing', path: 'Book 1/Foreshadowing.md', extension: 'md', stat: { mtime: 1, size: 100 } });
            const lookup = mockApp.vault.getAbstractFileByPath.getMockImplementation();
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === fsFile.path ? fsFile : lookup(path));
            mockPlugin.settings.timeline.showEditorReferences = false;
            mockPlugin.settings.foreshadowing.showEditorReferences = true;
            mockPlugin.foreshadowingManager = {
                findForeshadowingFile: () => fsFile,
                parseEntries: () => [{ sourceFile: 'Chapter 1', createdAt: 'Day 1', description: 'Description is not a quote', status: ForeshadowingStatus.PartiallyRecovered, tags: [],
                    contents: [{ source: 'Chapter 1', time: '', text: 'Planted quote' }, { source: 'Other chapter', time: '', text: 'Unrelated quote' }],
                    recoveryLogs: [{ file: 'Chapter 1', time: 'Day 2', stageType: 'stage', quote: 'Recovered quote', note: 'Note is not a quote' }, { file: 'Chapter 1', time: 'Day 3', stageType: 'final' }] }]
            };
            const references = await service.prefetchReferences(chapter);
            expect(references.map(reference => reference.quote)).toEqual(['Planted quote', 'Recovered quote']);
            expect(references[1]).toMatchObject({ type: 'foreshadowing', kind: 'recovery', status: ForeshadowingStatus.PartiallyRecovered });
            await service.destroy();
        });

        it('returns empty when showEditorReferences is false or document is outside recognized book', async () => {
            const tlFile = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 1/Timeline.md', extension: 'md' });
            const bookFolder = { path: 'Book 1', isRoot: () => false, parent: null };
            const chFile = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/第1章.md', extension: 'md', parent: bookFolder });
            const outsideFile = Object.assign(new TFile(), { name: '随笔.md', basename: '随笔', path: 'Notes/随笔.md', extension: 'md', parent: { path: 'Notes', isRoot: () => false, parent: null } });

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return tlFile;
                return null;
            });

            mockPlugin.timelineManager = manager;
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: false };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: false };

            const service = new ChapterReferenceService(mockApp, mockPlugin);

            // Both toggles false: returns [] synchronously with no I/O
            expect(service.getReferencesSync(chFile)).toEqual([]);
            expect(await service.prefetchReferences(chFile)).toEqual([]);

            // Enable timeline references
            mockPlugin.settings.timeline.showEditorReferences = true;

            // Outside document: returns [] and never associates with book
            expect(service.getReferencesSync(outsideFile)).toEqual([]);
            expect(await service.prefetchReferences(outsideFile)).toEqual([]);

            await service.destroy();
        });

        it('associates accurate quotes, caches without re-read, and rejects late reads after destroy', async () => {
            const tlFile = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 1/Timeline.md', extension: 'md', stat: { mtime: 1000, size: 200 } });
            const bookFolder = { path: 'Book 1', isRoot: () => false, parent: null };
            const chFile = Object.assign(new TFile(), { name: '第1章.md', basename: '第1章', path: 'Book 1/第1章.md', extension: 'md', parent: bookFolder, stat: { mtime: 2000, size: 500 } });

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === 'Book 1/Timeline.md') return tlFile;
                if (p === 'Book 1/第1章.md') return chFile;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([chFile]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([chFile]);

            const timelineContent = `## 2026-01-01
- 登基大典 [[第1章]] <!-- origin: 登基当日，九龙齐鸣。 -->
- 密谋无原文 [[第1章]]
`;
            mockApp.vault.read.mockImplementation((file: TFile) => {
                if (file.path === 'Book 1/Timeline.md') return Promise.resolve(timelineContent);
                return Promise.resolve('');
            });

            mockPlugin.timelineManager = manager;
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: true };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: false };

            const service = new ChapterReferenceService(mockApp, mockPlugin);

            // Initially uncached
            expect(service.getReferencesSync(chFile)).toBeNull();

            // Prefetch loads and parses
            const items = await service.prefetchReferences(chFile);
            expect(items).toHaveLength(1);
            expect(items[0].quote).toBe('登基当日，九龙齐鸣。');
            expect(items[0].description).toBe('登基大典');
            // The item without quote is ignored: no description-as-quote leakage
            expect(items.some(i => i.description === '密谋无原文')).toBe(false);

            // Second call: served from in-memory cache, read was called only once
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
            const cachedItems = service.getReferencesSync(chFile);
            expect(cachedItems).toEqual(items);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);

            // Destroy rejects late reads
            await service.destroy();
            expect(service.getReferencesSync(chFile)).toEqual([]);
            expect(await service.prefetchReferences(chFile)).toEqual([]);
        });

        it('ignores unrelated metadata changes and ordinary body modifications while keeping cached chapters ready', async () => {
            const { chapter, service } = referenceFixture();
            const metadataListeners: Array<(file: TFile) => void> = [];
            const vaultListeners = new Map<string, Array<(file: unknown, oldPath?: string) => void>>();
            mockApp.metadataCache.on = vi.fn((event: string, cb: (file: TFile) => void) => {
                if (event === 'changed') metadataListeners.push(cb);
                return { event };
            });
            mockApp.vault.on = vi.fn((event: string, cb: (file: unknown, oldPath?: string) => void) => {
                const list = vaultListeners.get(event) ?? [];
                list.push(cb);
                vaultListeners.set(event, list);
                return { event };
            });

            // Re-instantiate so it registers on our spying metadataCache.on / vault.on
            await service.destroy();
            const scopedService = new ChapterReferenceService(mockApp, mockPlugin);
            const refreshListener = vi.fn();
            scopedService.onRefresh(refreshListener);

            const initial = await scopedService.prefetchReferences(chapter);
            expect(initial).toHaveLength(1);
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);

            const getAllChaptersSpy = vi.spyOn(ChapterSorter, 'getAllChapters');
            getAllChaptersSpy.mockClear();
            mockApp.vault.read.mockClear();

            const outsideFile = Object.assign(new TFile(), {
                name: 'Random.md',
                basename: 'Random',
                path: 'Notes/Random.md',
                extension: 'md',
                parent: { path: 'Notes', isRoot: () => false, parent: null }
            });
            const otherBookChapter = Object.assign(new TFile(), {
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                path: 'Book 2/Chapter 1.md',
                extension: 'md',
                parent: { path: 'Book 2', isRoot: () => false, parent: null }
            });

            for (let i = 0; i < 20; i++) {
                metadataListeners.forEach(cb => cb(i % 2 === 0 ? outsideFile : otherBookChapter));
                expect(scopedService.getReferencesSync(chapter)).toEqual(initial);
            }
            // Ordinary body modify and metadata change on current chapter with unchanged eligibility
            for (const cb of vaultListeners.get('modify') ?? []) cb(chapter);
            for (const cb of metadataListeners) cb(chapter);

            expect(refreshListener).not.toHaveBeenCalled();
            expect(getAllChaptersSpy).not.toHaveBeenCalled();
            expect(mockApp.vault.read).not.toHaveBeenCalled();
            expect(scopedService.getReferencesSync(chapter)).toEqual(initial);

            getAllChaptersSpy.mockRestore();
            await scopedService.destroy();
        });

        it('refreshes current chapter when metadata exclusion changes and isolates book-scoped source/structure events', async () => {
            const folder1 = { path: 'Book 1', isRoot: () => false, parent: null };
            const folder2 = { path: 'Book 2', isRoot: () => false, parent: null };
            const tl1 = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 1/Timeline.md', extension: 'md', parent: folder1, stat: { mtime: 1, size: 100 } });
            const ch1 = Object.assign(new TFile(), { name: 'Chapter 1.md', basename: 'Chapter 1', path: 'Book 1/Chapter 1.md', extension: 'md', parent: folder1, stat: { mtime: 1, size: 100 } });
            const tl2 = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 2/Timeline.md', extension: 'md', parent: folder2, stat: { mtime: 1, size: 100 } });
            const ch2 = Object.assign(new TFile(), { name: 'Chapter 1.md', basename: 'Chapter 1', path: 'Book 2/Chapter 1.md', extension: 'md', parent: folder2, stat: { mtime: 1, size: 100 } });

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === tl1.path) return tl1;
                if (p === ch1.path) return ch1;
                if (p === tl2.path) return tl2;
                if (p === ch2.path) return ch2;
                return null;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.timelineManager = manager;
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: true };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: false };

            const content1 = manager.formatEntry({ time: 'Day 1', description: 'B1', chapter: 'Chapter 1', origin: 'Quote B1', rawBlock: '', items: [{ description: 'B1', chapter: 'Chapter 1', origin: 'Quote B1' }] });
            const content2 = manager.formatEntry({ time: 'Day 1', description: 'B2', chapter: 'Chapter 1', origin: 'Quote B2', rawBlock: '', items: [{ description: 'B2', chapter: 'Chapter 1', origin: 'Quote B2' }] });
            mockApp.vault.read.mockImplementation(async (f: TFile) => (f === tl1 ? content1 : content2));

            const metadataListeners: Array<(file: TFile) => void> = [];
            const vaultListeners = new Map<string, Array<(file: unknown, oldPath?: string) => void>>();
            mockApp.metadataCache.on = vi.fn((event: string, cb: (file: TFile) => void) => {
                if (event === 'changed') metadataListeners.push(cb);
                return { event };
            });
            mockApp.vault.on = vi.fn((event: string, cb: (file: unknown, oldPath?: string) => void) => {
                const list = vaultListeners.get(event) ?? [];
                list.push(cb);
                vaultListeners.set(event, list);
                return { event };
            });

            const service = new ChapterReferenceService(mockApp, mockPlugin);
            const refreshListener = vi.fn();
            service.onRefresh(refreshListener);

            await service.prefetchReferences(ch1);
            await service.prefetchReferences(ch2);
            expect(service.getReferencesSync(ch1)?.[0].quote).toBe('Quote B1');
            expect(service.getReferencesSync(ch2)?.[0].quote).toBe('Quote B2');

            // Modifying Book 1 Timeline only invalidates Book 1, leaving Book 2 cached
            for (const cb of vaultListeners.get('modify') ?? []) cb(tl1);
            expect(refreshListener).toHaveBeenCalledTimes(1);
            expect(service.getReferencesSync(ch1)).toBeNull();
            expect(service.getReferencesSync(ch2)?.[0].quote).toBe('Quote B2');

            await service.prefetchReferences(ch1);

            // Metadata/eligibility exclusion on ch1 refreshes ch1 without invalidating ch2
            mockPlugin.isPluginGeneratedFile.mockImplementation((name: string) => name === ch1.basename);
            for (const cb of metadataListeners) cb(ch1);
            expect(refreshListener).toHaveBeenCalledTimes(2);
            expect(service.getReferencesSync(ch1)).toBeNull();
            expect(service.getReferencesSync(ch2)?.[0].quote).toBe('Quote B2');
            expect(await service.prefetchReferences(ch1)).toEqual([]);

            // Restoring eligibility refreshes ch1
            mockPlugin.isPluginGeneratedFile.mockReturnValue(false);
            for (const cb of metadataListeners) cb(ch1);
            expect(refreshListener).toHaveBeenCalledTimes(3);
            expect(service.getReferencesSync(ch1)).toBeNull();
            expect((await service.prefetchReferences(ch1))[0].quote).toBe('Quote B1');

            // Same-book other-chapter metadata (e.g. alias) change invalidates Book 1 without touching Book 2
            const ch1Other = Object.assign(new TFile(), { name: 'Chapter 2.md', basename: 'Chapter 2', path: 'Book 1/Chapter 2.md', extension: 'md', parent: folder1, stat: { mtime: 1, size: 100 } });
            for (const cb of metadataListeners) cb(ch1Other);
            expect(refreshListener).toHaveBeenCalledTimes(4);
            expect(service.getReferencesSync(ch1)).toBeNull();
            expect(service.getReferencesSync(ch2)?.[0].quote).toBe('Quote B2');

            await service.prefetchReferences(ch1);

            // A cached chapter's alias can also change another cached chapter's link resolution.
            await service.prefetchReferences(ch1Other);
            expect(service.getReferencesSync(ch1Other)).not.toBeNull();
            // Current chapter alias frontmatter change invalidates the book's dependent chapters.
            mockApp.metadataCache.getFileCache.mockImplementation((f: TFile) => (
                f === ch1 ? { frontmatter: { aliases: ['序章别名'] } } : null
            ));
            for (const cb of metadataListeners) cb(ch1);
            expect(refreshListener).toHaveBeenCalledTimes(5);
            expect(service.getReferencesSync(ch1)).toBeNull();
            expect(service.getReferencesSync(ch1Other)).toBeNull();

            await service.destroy();
        });

        it('accounts for pending chapter contexts before first collection finishes', async () => {
            const { source, chapter, content, service } = referenceFixture();
            const vaultListeners = new Map<string, Array<(file: unknown, oldPath?: string) => void>>();
            mockApp.vault.on = vi.fn((event: string, cb: (file: unknown, oldPath?: string) => void) => {
                const list = vaultListeners.get(event) ?? [];
                list.push(cb);
                vaultListeners.set(event, list);
                return { event };
            });

            await service.destroy();
            const scopedService = new ChapterReferenceService(mockApp, mockPlugin);
            const refreshListener = vi.fn();
            scopedService.onRefresh(refreshListener);

            let resolveFirst!: (val: string) => void;
            mockApp.vault.read.mockReturnValueOnce(new Promise<string>(res => { resolveFirst = res; }));

            const pendingPromise = scopedService.prefetchReferences(chapter);

            // Unrelated Book 2 source modify while Book 1 chapter is pending must NOT cancel or notify
            const otherTimeline = Object.assign(new TFile(), {
                name: 'Timeline.md',
                basename: 'Timeline',
                path: 'Book 2/Timeline.md',
                extension: 'md',
                parent: { path: 'Book 2', isRoot: () => false, parent: null }
            });
            for (const cb of vaultListeners.get('modify') ?? []) cb(otherTimeline);
            expect(refreshListener).not.toHaveBeenCalled();

            // Book 1 Timeline modify while Book 1 chapter is pending MUST invalidate pending and notify
            for (const cb of vaultListeners.get('modify') ?? []) cb(source);
            expect(refreshListener).toHaveBeenCalledTimes(1);

            resolveFirst(content);
            expect(await pendingPromise).toEqual([]);
            expect(scopedService.getReferencesSync(chapter)).toBeNull();

            await scopedService.destroy();
        });

        it('persists timeline popover importance with marker-only byte-preserving edits across custom headers, pending blocks, multi-type sections, legacy entries, and synthetic time-pending nodes', async () => {
            const folder = { path: 'Book 1', isRoot: () => false, parent: null };
            const tlFile = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 1/Timeline.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            const ch1 = Object.assign(new TFile(), { name: 'Chapter 1.md', basename: 'Chapter 1', path: 'Book 1/Chapter 1.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            const ch2 = Object.assign(new TFile(), { name: 'Chapter 2.md', basename: 'Chapter 2', path: 'Book 1/Chapter 2.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });

            const initialTimeline = [
                '# Custom Timeline Header',
                '',
                'Unrelated intro note.',
                '',
                '---',
                '',
                '## Day 1',
                '- Other chapter event [[Chapter 2]] <!-- origin: Other quote -->',
                '',
                '---',
                '',
                '## Day 2',
                '',
                '**Author**：KeepAuthor',
                '**类型**：Main',
                '',
                '- Sibling in ch2 [[Chapter 2]] <!-- origin: Sibling quote -->',
                '- First ch1 event [[Chapter 1]] <!-- origin: Quote Alpha -->',
                '- Second ch1 event [[Chapter 1]] <!-- origin: Quote Beta -->',
                '',
                '**类型**：Sub',
                '',
                '- Subtype event [[Chapter 2]] <!-- origin: Sub quote -->',
                '',
                '---',
                '<!-- wn-pending-events:start -->',
                '## 待排事件',
                '- Pending idea [[Chapter 2]] <!-- wn-pending-id: pe_keep_1 -->',
                '<!-- wn-pending-events:end -->',
                '## Day 3',
                'Legacy paragraph event [[Chapter 1]] <!-- origin: Legacy quote -->',
                '**CustomField**：KeepLegacyMeta',
                '**类型**：Side',
                '',
                '---',
                '',
                '## 时间待定 <!-- wn-time-pending -->',
                '- Unanchored event [[Chapter 1]] <!-- origin: Pending time quote -->',
                '',
                '---',
                ''
            ].join('\n');
            let timelineContent = initialTimeline;

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === tlFile.path) return tlFile;
                if (p === ch1.path) return ch1;
                if (p === ch2.path) return ch2;
                return null;
            });
            mockApp.vault.read.mockImplementation(async (f: TFile) => (f === tlFile ? timelineContent : ''));
            mockApp.vault.cachedRead.mockImplementation(async (f: TFile) => (f === tlFile ? timelineContent : ''));
            mockApp.vault.process.mockImplementation(async (f: TFile, cb: (c: string) => string) => {
                if (f === tlFile) {
                    timelineContent = cb(timelineContent);
                    tlFile.stat.mtime += 1;
                    tlFile.stat.size = timelineContent.length;
                }
                return timelineContent;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.timelineManager = manager;
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: true };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: false };

            const service = new ChapterReferenceService(mockApp, mockPlugin);
            const refs = await service.prefetchReferences(ch1);
            expect(refs.map(r => r.quote)).toEqual(['Quote Alpha', 'Quote Beta', 'Legacy quote', 'Pending time quote']);

            // Toggle first matched item (filtered index 0, actual source entry 1 item 1)
            await service.setReferenceImportance(refs[0], true);
            expect(timelineContent).toBe(
                initialTimeline.replace(
                    '- First ch1 event [[Chapter 1]] <!-- origin: Quote Alpha -->',
                    '- First ch1 event [[Chapter 1]] <!-- wn-important --> <!-- origin: Quote Alpha -->'
                )
            );
            expect(service.getReferencesSync(ch1)).toBeNull(); // Scoped invalidation cleared chapter cache
            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();

            // Toggle adjacent item from the same snapshot -> preserves Quote Alpha's mark and every unrelated byte
            await service.setReferenceImportance(refs[1], true);
            expect(timelineContent).toBe(
                initialTimeline
                    .replace(
                        '- First ch1 event [[Chapter 1]] <!-- origin: Quote Alpha -->',
                        '- First ch1 event [[Chapter 1]] <!-- wn-important --> <!-- origin: Quote Alpha -->'
                    )
                    .replace(
                        '- Second ch1 event [[Chapter 1]] <!-- origin: Quote Beta -->',
                        '- Second ch1 event [[Chapter 1]] <!-- wn-important --> <!-- origin: Quote Beta -->'
                    )
            );

            // Repeated toggle on Quote Alpha restores exact original line while keeping Quote Beta marked
            await service.setReferenceImportance(refs[0], false);
            expect(timelineContent).toBe(
                initialTimeline.replace(
                    '- Second ch1 event [[Chapter 1]] <!-- origin: Quote Beta -->',
                    '- Second ch1 event [[Chapter 1]] <!-- wn-important --> <!-- origin: Quote Beta -->'
                )
            );

            // Toggle legacy non-bullet entry located AFTER pending block -> preserves pending block, legacy format and custom metadata
            await service.setReferenceImportance(refs[2], true);
            expect(timelineContent).toContain('Legacy paragraph event [[Chapter 1]] <!-- wn-important --> <!-- origin: Legacy quote -->');
            expect(timelineContent).toContain('**CustomField**：KeepLegacyMeta');
            expect(timelineContent).toContain('<!-- wn-pending-events:start -->');
            expect(timelineContent).toContain('# Custom Timeline Header');
            expect(timelineContent).toContain('**Author**：KeepAuthor');

            // Repeated toggle on time-pending node without explicit wn-node (synthetic nd_auto hash changes after marker edit)
            await service.setReferenceImportance(refs[3], true);
            expect(timelineContent).toContain('- Unanchored event [[Chapter 1]] <!-- wn-important --> <!-- origin: Pending time quote -->');
            await service.setReferenceImportance(refs[3], false);
            expect(timelineContent).toContain('- Unanchored event [[Chapter 1]] <!-- origin: Pending time quote -->');

            // Unmarking remaining items restores exact original file bytes
            await service.setReferenceImportance(refs[1], false);
            await service.setReferenceImportance(refs[2], false);
            expect(timelineContent).toBe(initialTimeline);

            await service.setReferenceImportance(refs[1], true);
            await service.setReferenceImportance(refs[2], true);
            const reloaded = await service.prefetchReferences(ch1);
            expect(reloaded.map(r => r.important)).toEqual([false, true, true, false]);
            await service.destroy();
        });

        it('fails closed on stale moved, deleted, or ambiguous duplicate timeline records without marking another item', async () => {
            const folder = { path: 'Book 1', isRoot: () => false, parent: null };
            const tlFile = Object.assign(new TFile(), { name: 'Timeline.md', basename: 'Timeline', path: 'Book 1/Timeline.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            const ch1 = Object.assign(new TFile(), { name: 'Chapter 1.md', basename: 'Chapter 1', path: 'Book 1/Chapter 1.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });

            let timelineContent = [
                '## Day 1',
                '- Target item [[Chapter 1]] <!-- origin: Quote One -->',
                '- Innocent neighbor [[Chapter 1]] <!-- origin: Quote Two -->',
                '',
                '---',
                ''
            ].join('\n');

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === tlFile.path) return tlFile;
                if (p === ch1.path) return ch1;
                return null;
            });
            mockApp.vault.read.mockImplementation(async (f: TFile) => (f === tlFile ? timelineContent : ''));
            mockApp.vault.cachedRead.mockImplementation(async (f: TFile) => (f === tlFile ? timelineContent : ''));
            mockApp.vault.process.mockImplementation(async (f: TFile, cb: (c: string) => string) => {
                if (f === tlFile) timelineContent = cb(timelineContent);
                return timelineContent;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1]);
            mockPlugin.timelineManager = manager;
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: true };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: false };

            const service = new ChapterReferenceService(mockApp, mockPlugin);
            const [firstRef] = await service.prefetchReferences(ch1);

            // External deletion of Target item shifts Innocent neighbor into item index 0
            timelineContent = [
                '## Day 1',
                '- Innocent neighbor [[Chapter 1]] <!-- origin: Quote Two -->',
                '',
                '---',
                ''
            ].join('\n');
            await expect(service.setReferenceImportance(firstRef, true)).rejects.toThrow();
            expect(manager.parseEntries(timelineContent, 'Book 1')[0].items?.[0].important).toBe(false);

            // Ambiguous duplicate nodes fail closed even when collected from a file that already contained duplicates
            timelineContent = [
                '## Day 1',
                '- Target item [[Chapter 1]] <!-- origin: Quote One -->',
                '- Innocent neighbor [[Chapter 1]] <!-- origin: Quote Two -->',
                '',
                '---',
                '',
                '## Day 1',
                '- Target item [[Chapter 1]] <!-- origin: Quote One -->',
                '- Innocent neighbor [[Chapter 1]] <!-- origin: Quote Two -->',
                '',
                '---',
                ''
            ].join('\n');
            await expect(service.setReferenceImportance(firstRef, true)).rejects.toThrow();
            service.clearCache();
            const duplicateRefs = await service.prefetchReferences(ch1);
            await expect(service.setReferenceImportance(duplicateRefs[0], true)).rejects.toThrow();
            const entriesAfterAmbiguous = manager.parseEntries(timelineContent, 'Book 1');
            expect(entriesAfterAmbiguous[0].items?.[0].important).toBe(false);
            expect(entriesAfterAmbiguous[1].items?.[0].important).toBe(false);

            await service.destroy();
        });

        it('persists foreshadowing popover importance by exact record identity across duplicate descriptions, legacy format, and creation/recovery pairs', async () => {
            const folder = { path: 'Book 1', isRoot: () => false, parent: null };
            const fsFile = Object.assign(new TFile(), { name: 'Foreshadowing.md', basename: 'Foreshadowing', path: 'Book 1/Foreshadowing.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            const ch1 = Object.assign(new TFile(), { name: 'Chapter 1.md', basename: 'Chapter 1', path: 'Book 1/Chapter 1.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });
            const ch2 = Object.assign(new TFile(), { name: 'Chapter 2.md', basename: 'Chapter 2', path: 'Book 1/Chapter 2.md', extension: 'md', parent: folder, stat: { mtime: 1, size: 100 } });

            let fsContent = [
                '## Shared Clue',
                '> [[Chapter 2]] - 2026-01-01 10:00',
                '> First duplicate quote',
                '',
                '**状态**：未回收',
                '',
                '---',
                '',
                '## Shared Clue',
                '> [[Chapter 1]] - 2026-01-02 10:00',
                '> Second duplicate quote',
                '',
                '**状态**：未回收',
                '',
                '---',
                '',
                '## [[Chapter 1]] - 2026-01-03 10:00',
                '> Legacy planted quote',
                '',
                '**说明**：Legacy Clue',
                '**自定义字段**：PreserveMe',
                '**状态**：阶段回收中',
                '',
                '**回收记录**：',
                '- [阶段] [[Chapter 1]] - 2026-01-04 10:00：Stage note',
                '  > Legacy recovered quote',
                '',
                '---',
                ''
            ].join('\n');

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === fsFile.path) return fsFile;
                if (p === ch1.path) return ch1;
                if (p === ch2.path) return ch2;
                return null;
            });
            mockApp.vault.read.mockImplementation(async (f: TFile) => (f === fsFile ? fsContent : ''));
            mockApp.vault.cachedRead.mockImplementation(async (f: TFile) => (f === fsFile ? fsContent : ''));
            mockApp.vault.process.mockImplementation(async (f: TFile, cb: (c: string) => string) => {
                if (f === fsFile) {
                    fsContent = cb(fsContent);
                    fsFile.stat.mtime += 1;
                    fsFile.stat.size = fsContent.length;
                }
                return fsContent;
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1, ch2]);
            mockPlugin.foreshadowingManager = new ForeshadowingManager(mockApp, mockPlugin);
            mockPlugin.settings.timeline = { fileName: 'Timeline', defaultTypes: [], showEditorReferences: false };
            mockPlugin.settings.foreshadowing = { fileName: 'Foreshadowing', defaultTags: [], showEditorReferences: true };

            const service = new ChapterReferenceService(mockApp, mockPlugin);
            const refs = await service.prefetchReferences(ch1);
            expect(refs.map(r => r.quote)).toEqual(['Second duplicate quote', 'Legacy planted quote', 'Legacy recovered quote']);

            // Toggle second duplicate description -> must mark entry 1, NOT entry 0
            await service.setReferenceImportance(refs[0], true);
            let entries = mockPlugin.foreshadowingManager.parseEntries(fsContent);
            expect(entries[0].important).toBe(false);
            expect(entries[1].important).toBe(true);

            // Toggle legacy creation card -> preserves legacy heading and custom metadata, reflects on recovery card after reload
            await service.setReferenceImportance(refs[1], true);
            expect(fsContent).toContain('## [[Chapter 1]] - 2026-01-03 10:00\n<!-- wn-important -->');
            expect(fsContent).toContain('**自定义字段**：PreserveMe');
            service.clearCache();
            const reloaded = await service.prefetchReferences(ch1);
            expect(reloaded[1].important).toBe(true);
            expect(reloaded[2].important).toBe(true);

            // Toggle via recovery card -> unmarks same record and keeps legacy metadata intact
            await service.setReferenceImportance(reloaded[2], false);
            entries = mockPlugin.foreshadowingManager.parseEntries(fsContent);
            expect(entries[2].important).toBe(false);
            expect(fsContent).toContain('## [[Chapter 1]] - 2026-01-03 10:00');
            expect(fsContent).toContain('**自定义字段**：PreserveMe');

            await service.destroy();
        });
    });

    describe('Pending events and time-pending nodes (Regressions)', () => {
        const makeVaultHarness = (initialContent = '') => {
            const tlFile = Object.assign(new TFile(), {
                name: 'Timeline.md',
                basename: 'Timeline',
                path: 'Book 1/Timeline.md',
                extension: 'md',
                stat: { mtime: 1, size: initialContent.length }
            });
            const ch1 = Object.assign(new TFile(), {
                name: 'Chapter 1.md',
                basename: 'Chapter 1',
                path: 'Book 1/Chapter 1.md',
                extension: 'md'
            });
            const fmMap = new Map<string, Record<string, unknown>>();
            let content = initialContent;

            mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
                if (p === tlFile.path) return tlFile;
                if (p === ch1.path) return ch1;
                return null;
            });
            mockApp.vault.create.mockImplementation(async (_p: string, text: string) => {
                content = text;
                return tlFile;
            });
            mockApp.vault.read.mockImplementation(async () => content);
            mockApp.vault.cachedRead.mockImplementation(async () => content);
            mockApp.vault.process.mockImplementation(async (_file: TFile, cb: (c: string) => string) => {
                content = cb(content);
                tlFile.stat.mtime += 1;
                tlFile.stat.size = content.length;
                return content;
            });
            mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) => {
                if (link === 'Chapter 1') return ch1;
                return null;
            });
            mockApp.metadataCache.fileToLinktext.mockImplementation((file: TFile) => file.basename);
            mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => ({
                frontmatter: fmMap.get(file.path)
            }));
            mockApp.fileManager.processFrontMatter.mockImplementation(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
                const fm = fmMap.get(file.path) ?? {};
                fn(fm);
                fmMap.set(file.path, { ...fm });
            });
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([ch1]);
            mockPlugin.getVaultMarkdownFiles.mockReturnValue([ch1]);

            return {
                tlFile,
                ch1,
                fmMap,
                getContent: () => content,
                setContent: (next: string) => { content = next; }
            };
        };

        it('leaves other timeline Markdown byte-for-byte intact when editing the pending list', async () => {
            const initial = '# Plot notes\r\n\r\nCompare the two openings.\r\n\r\n---\n\n## Nightfall\n\n- Hear the signal\n';
            const harness = makeVaultHarness(initial);
            const { event } = await manager.addPendingEvent({ description: 'Investigate the signal' }, 'Book 1');
            expect(harness.getContent().startsWith(initial)).toBe(true);
            await manager.updatePendingEvent(event.id, { description: 'Follow the signal' }, 'Book 1', event);
            const pending = manager.parsePendingEvents(harness.getContent());
            expect(pending[0].description).toBe('Follow the signal');
            expect(harness.getContent().startsWith(initial)).toBe(true);
            await manager.deletePendingEvent(event.id, 'Book 1', pending[0]);
            expect(harness.getContent()).toBe(initial);
        });

        it('keeps empty pending cards distinct and editable across reloads', async () => {
            const harness = makeVaultHarness('## Nightfall\n\n- Existing event\n\n---\n');
            const { event: first } = await manager.addPendingEvent({ description: '' }, 'Book 1');
            const { event: second } = await manager.addPendingEvent({ description: '  ' }, 'Book 1');
            expect(first.id).not.toBe(second.id);
            expect(manager.parsePendingEvents(harness.getContent())).toEqual([second, first]);

            const beforePlacement = harness.getContent();
            await expect(manager.placePendingEventIntoNode(first.id, 0, undefined, 'Book 1', first)).rejects.toThrow();
            await expect(manager.createNodeFromPendingEvent(first.id, { time: 'Morning' }, {}, 'Book 1', first)).rejects.toThrow();
            expect(harness.getContent()).toBe(beforePlacement);

            await manager.updatePendingEvent(first.id, { description: 'Follow the signal' }, 'Book 1', first);
            let [blank, edited] = manager.parsePendingEvents(harness.getContent());
            expect(edited).toMatchObject({ id: first.id, description: 'Follow the signal' });
            await manager.updatePendingEvent(first.id, { description: '' }, 'Book 1', edited);
            await manager.updatePendingEvent(second.id, { important: true }, 'Book 1', blank);
            [blank, edited] = manager.parsePendingEvents(harness.getContent());
            expect(blank.important).toBe(true);
            expect(edited).toEqual(first);
            await manager.updatePendingEvent(second.id, { important: false }, 'Book 1', blank);
            expect(manager.parsePendingEvents(harness.getContent())).toEqual([second, first]);

            await manager.deletePendingEvent(first.id, 'Book 1', first);
            expect(manager.parsePendingEvents(harness.getContent())).toEqual([second]);
        });

        it('keeps a resolved node independent when editing it next to a node of the same time', async () => {
            const harness = makeVaultHarness('## Nightfall\n\n- First event\n\n---\n');
            await manager.appendEntry({
                time: '', timePending: true, description: 'Second event', chapter: '', rawBlock: ''
            }, 'Book 1');
            const pending = manager.parseEntries(harness.getContent())[1];
            await manager.updateEntry(1, { ...pending, time: 'Nightfall', timePending: undefined }, 'Book 1', pending);
            const resolved = manager.parseEntries(harness.getContent())[1];
            expect(resolved.nodeId).toBe(pending.nodeId);
            await manager.updateEntry(1, {
                ...resolved, items: [{ description: 'Second event revised', chapter: '' }]
            }, 'Book 1', resolved);
            expect(manager.parseEntries(harness.getContent()).map(entry => entry.description))
                .toEqual(['First event', 'Second event revised']);
        });

        it('round-trips pending events and multiple distinct time-pending nodes without exposing pending events to parseEntries', async () => {
            const harness = makeVaultHarness('');
            const mgr = manager as unknown as TimelineManager & {
                addPendingEvent: (input: { description: string; chapter?: string; origin?: string; important?: boolean }, folderPath?: string) => Promise<{ content: string; event: { id: string; description: string; chapter: string; origin?: string; important?: boolean } }>;
                loadDocument: (folderPath?: string) => Promise<{ entries: TimelineEntry[]; pendingEvents: Array<{ id: string; description: string; chapter: string; origin?: string; important?: boolean }> } | null>;
            };

            // Add two empty/identical time-pending nodes
            await manager.appendEntry({
                time: '',
                timePending: true,
                type: '主线',
                description: '',
                chapter: '',
                rawBlock: '',
                items: []
            } as TimelineEntry, 'Book 1');
            await manager.appendEntry({
                time: '',
                timePending: true,
                type: '主线',
                description: '',
                chapter: '',
                rawBlock: '',
                items: []
            } as TimelineEntry, 'Book 1');

            // Add two pending events with identical text (newest on top)
            const first = await mgr.addPendingEvent({ description: '重复灵感', chapter: 'Chapter 1', origin: '原句甲', important: true }, 'Book 1');
            const second = await mgr.addPendingEvent({ description: '重复灵感' }, 'Book 1');

            // Regular parseEntries/loadEntries must NOT see pending section
            const formalEntries = await manager.loadEntries('Book 1');
            expect(formalEntries).toHaveLength(2);
            expect((formalEntries![0] as TimelineEntry & { timePending?: boolean; nodeId?: string }).timePending).toBe(true);
            expect((formalEntries![1] as TimelineEntry & { timePending?: boolean; nodeId?: string }).timePending).toBe(true);
            expect(formalEntries![0].time).toBe('');
            expect(formalEntries![1].time).toBe('');
            expect((formalEntries![0] as TimelineEntry & { nodeId?: string }).nodeId).toBeTruthy();
            expect((formalEntries![1] as TimelineEntry & { nodeId?: string }).nodeId).toBeTruthy();
            expect((formalEntries![0] as TimelineEntry & { nodeId?: string }).nodeId).not.toBe((formalEntries![1] as TimelineEntry & { nodeId?: string }).nodeId);

            const doc = await mgr.loadDocument('Book 1');
            expect(doc?.entries).toHaveLength(2);
            expect(doc?.pendingEvents).toHaveLength(2);
            expect(doc?.pendingEvents[0].id).toBe(second.event.id);
            expect(doc?.pendingEvents[1].id).toBe(first.event.id);
            expect(doc?.pendingEvents[1].chapter).toBe('Chapter 1');
            expect(doc?.pendingEvents[1].origin).toBe('原句甲');
            expect(doc?.pendingEvents[1].important).toBe(true);
            expect(harness.getContent()).toContain('<!-- wn-pending-events:start -->');

            // Preserves pending section across normal node rewrite (update/delete/sync)
            await manager.updateEntry(0, {
                ...formalEntries![0],
                items: [{ description: '待定节点新事件', chapter: 'Chapter 1' }]
            }, 'Book 1', formalEntries![0]);
            const afterRewrite = await mgr.loadDocument('Book 1');
            expect(afterRewrite?.pendingEvents).toHaveLength(2);
            expect(afterRewrite?.entries).toHaveLength(2);
            // Must NOT leak fake time into chapter frontmatter while timePending is true
            expect(harness.fmMap.get(harness.ch1.path)?.timeline).toBeUndefined();
        });

        it('keeps same node and position when filling real time on a time-pending node and reconciles frontmatter afterwards', async () => {
            const harness = makeVaultHarness('');
            await manager.appendEntry({ time: '第1天', type: '主线', description: '开端', chapter: '', rawBlock: '', items: [{ description: '开端', chapter: '' }] }, 'Book 1');
            await manager.appendEntry({
                time: '',
                timePending: true,
                type: '主线',
                description: '中段待定',
                chapter: 'Chapter 1',
                rawBlock: '',
                items: [{ description: '中段待定', chapter: 'Chapter 1', origin: '中段原文' }]
            } as TimelineEntry, 'Book 1');
            await manager.appendEntry({ time: '第9天', type: '主线', description: '尾声', chapter: '', rawBlock: '', items: [{ description: '尾声', chapter: '' }] }, 'Book 1');

            const before = (await manager.loadEntries('Book 1'))!;
            expect(before).toHaveLength(3);
            expect(harness.fmMap.get(harness.ch1.path)?.timeline).toBeUndefined();

            // Chapter lookup still finds linked undated node without fake time
            const nodesBefore = manager.getTimelineNodesForChapter(harness.ch1, before, 'Book 1', harness.tlFile);
            expect(nodesBefore).toHaveLength(1);
            expect(nodesBefore[0].time).toBe('');
            expect((nodesBefore[0] as { timePending?: boolean }).timePending).toBe(true);

            // Fill in real time on middle undated node -> stays at index 1 and reconciles frontmatter
            await manager.updateEntry(1, {
                ...before[1],
                time: '第5天',
                timePending: false
            } as TimelineEntry, 'Book 1', before[1]);

            const after = (await manager.loadEntries('Book 1'))!;
            expect(after.map(e => e.time)).toEqual(['第1天', '第5天', '第9天']);
            expect((after[1] as TimelineEntry & { timePending?: boolean }).timePending).toBeFalsy();
            expect(harness.fmMap.get(harness.ch1.path)?.timeline).toBe('第5天');
        });

        it('performs atomic single-process pending <-> node moves, preserves empty structural nodes on return, and keeps pending card on conflict', async () => {
            const harness = makeVaultHarness('');
            const mgr = manager as unknown as TimelineManager & {
                addPendingEvent: (input: { description: string; chapter?: string; origin?: string; important?: boolean }, folderPath?: string) => Promise<{ content: string; event: { id: string; description: string; chapter: string; origin?: string; important?: boolean } }>;
                placePendingEventIntoNode: (pendingId: string, targetEntryIndex: number, targetItemIndex: number | undefined, folderPath?: string, expectedPending?: unknown, expectedTargetEntry?: TimelineEntry) => Promise<string>;
                createNodeFromPendingEvent: (pendingId: string, nodeSpec: { time: string; timePending?: boolean; type?: string; lores?: string[] }, anchor: { afterEntryIndex?: number; expectedAfterEntry?: TimelineEntry; beforeEntryIndex?: number; expectedBeforeEntry?: TimelineEntry; fallbackIndex?: number }, folderPath?: string, expectedPending?: unknown) => Promise<string>;
                moveEventToPending: (sourceEntryIndex: number, sourceItemIndex: number, folderPath?: string, expectedItem?: unknown, expectedSourceEntry?: TimelineEntry) => Promise<string>;
                loadDocument: (folderPath?: string) => Promise<{ entries: TimelineEntry[]; pendingEvents: Array<{ id: string; description: string; chapter: string; origin?: string; important?: boolean }> } | null>;
            };

            await manager.appendEntry({ time: '第1天', type: '主线', description: '甲事件', chapter: '', rawBlock: '', lores: ['人物甲'], items: [{ description: '甲事件', chapter: '' }] }, 'Book 1');
            await manager.appendEntry({ time: '第3天', type: '支线', description: '乙事件', chapter: '', rawBlock: '', items: [{ description: '乙事件', chapter: '' }] }, 'Book 1');
            await manager.appendEntry({ time: '第5天', type: '主线', description: '丙事件', chapter: '', rawBlock: '', items: [{ description: '丙事件', chapter: '' }] }, 'Book 1');

            const added = await mgr.addPendingEvent({ description: '待排冲突测试', chapter: 'Chapter 1', origin: '引用原文', important: true }, 'Book 1');
            const doc1 = (await mgr.loadDocument('Book 1'))!;
            mockApp.vault.process.mockClear();

            // Place between filtered nodes 第1天 (idx 0) and 第5天 (idx 2) -> creates new node after idx 0 (actual idx 1) in a SINGLE vault.process
            await mgr.createNodeFromPendingEvent(
                added.event.id,
                { time: '第2天', type: '主线' },
                { afterEntryIndex: 0, expectedAfterEntry: doc1.entries[0], beforeEntryIndex: 2, expectedBeforeEntry: doc1.entries[2] },
                'Book 1',
                doc1.pendingEvents[0]
            );
            expect(mockApp.vault.process).toHaveBeenCalledTimes(1);
            const doc2 = (await mgr.loadDocument('Book 1'))!;
            expect(doc2.pendingEvents).toHaveLength(0);
            expect(doc2.entries.map(e => e.time)).toEqual(['第1天', '第2天', '第3天', '第5天']);
            expect(doc2.entries[1].items?.[0]).toMatchObject({ description: '待排冲突测试', chapter: 'Chapter 1', origin: '引用原文', important: true });
            expect(harness.fmMap.get(harness.ch1.path)?.timeline).toBe('第2天');

            // Return last event of 第2天 back to pending in a SINGLE vault.process -> keeps 第2天 as empty structural node, clears chapter frontmatter
            mockApp.vault.process.mockClear();
            await mgr.moveEventToPending(1, 0, 'Book 1', doc2.entries[1].items![0], doc2.entries[1]);
            expect(mockApp.vault.process).toHaveBeenCalledTimes(1);
            const doc3 = (await mgr.loadDocument('Book 1'))!;
            expect(doc3.entries.map(e => e.time)).toEqual(['第1天', '第2天', '第3天', '第5天']);
            expect(doc3.entries[1].type).toBe('主线');
            expect(doc3.entries[1].items).toEqual([]);
            expect(doc3.pendingEvents).toHaveLength(1);
            expect(doc3.pendingEvents[0]).toMatchObject({ description: '待排冲突测试', chapter: 'Chapter 1', origin: '引用原文', important: true });
            expect(harness.fmMap.get(harness.ch1.path)?.timeline).toBeUndefined();

            // Conflict failure must NOT lose pending card
            const staleTarget = { ...doc3.entries[0], time: '已过期时间' };
            await expect(
                mgr.placePendingEventIntoNode(doc3.pendingEvents[0].id, 0, 0, 'Book 1', doc3.pendingEvents[0], staleTarget)
            ).rejects.toThrow();
            const docAfterConflict = (await mgr.loadDocument('Book 1'))!;
            expect(docAfterConflict.pendingEvents).toHaveLength(1);
            expect(docAfterConflict.pendingEvents[0].description).toBe('待排冲突测试');

            // Retry into empty node 第2天 succeeds in single vault.process
            mockApp.vault.process.mockClear();
            await mgr.placePendingEventIntoNode(docAfterConflict.pendingEvents[0].id, 1, 0, 'Book 1', docAfterConflict.pendingEvents[0], docAfterConflict.entries[1]);
            expect(mockApp.vault.process).toHaveBeenCalledTimes(1);
            const doc4 = (await mgr.loadDocument('Book 1'))!;
            expect(doc4.pendingEvents).toHaveLength(0);
            expect(doc4.entries[1].items).toHaveLength(1);
            expect(doc4.entries[1].items![0].origin).toBe('引用原文');
            expect(harness.fmMap.get(harness.ch1.path)?.timeline).toBe('第2天');
        });
    });
});
