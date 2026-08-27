import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineManager, TimelineEntry } from '../src/services/TimelineManager';

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
            const updatedEntry = { time: '2023-01-01', items: [{ description: 'Updated Event A' }] } as TimelineEntry;
            await manager.updateEntry(0, updatedEntry);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback('');
            expect(modifiedContent).toContain('Updated Event A');
            expect(modifiedContent).not.toContain('- Event A\n');
        });

        it('deleteEntry should remove the entire entry', async () => {
            await manager.deleteEntry(0);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback('');
            expect(modifiedContent).not.toContain('2023-01-01');
        });

        it('moveEventItem should move item within the same node', async () => {
            await manager.moveEventItem('2023-01-01', 0, '2023-01-01', 2);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback('');
            const eventAIndex = modifiedContent.indexOf('Event A');
            const eventBIndex = modifiedContent.indexOf('Event B');
            expect(eventBIndex).toBeLessThan(eventAIndex); // Event B is now before Event A
        });

        it('moveEventItem should move item to a different node', async () => {
            mockApp.vault.read.mockResolvedValue(`
---
## 2023-01-01
- Event A

---
## 2023-01-02
- Event B
`);
            await manager.moveEventItem('2023-01-01', 0, '2023-01-02', 1);
            
            expect(mockApp.vault.process).toHaveBeenCalled();
            const callback = mockApp.vault.process.mock.calls[0][1];
            const modifiedContent = callback('');
            
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
            let modifyHandler: ((file: TFile) => void) | null = null;
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
    });
});
