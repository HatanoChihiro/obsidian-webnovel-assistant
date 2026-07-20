import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineManager, TimelineEntry } from '../src/services/TimelineManager';

vi.mock('obsidian', () => ({
    normalizePath: (path: string) => path.replace(/\\/g, '/'),
    TFile: class {}
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
                getAbstractFileByPath: vi.fn(),
                create: vi.fn(),
                read: vi.fn(),
                modify: vi.fn(),
                process: vi.fn()
            },
            fileManager: {
                renameFile: vi.fn()
            }
        };

        mockPlugin = {
            settings: {
                timeline: {
                    fileName: 'Timeline'
                }
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
});
