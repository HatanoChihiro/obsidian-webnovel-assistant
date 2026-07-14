import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineManager, TimelineEntry } from '../src/services/TimelineManager';

describe('TimelineManager', () => {
    let mockApp: any;
    let mockPlugin: any;

    beforeEach(() => {
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn(),
                create: vi.fn(),
                read: vi.fn(),
                modify: vi.fn()
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
    });

    describe('parseEntries', () => {
        it('should correctly parse modern markdown timeline formats', () => {
            const manager = new TimelineManager(mockApp, mockPlugin, '');
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
            const manager = new TimelineManager(mockApp, mockPlugin, '');
            const markdown = `
---
## 2023-01-01

This is an old format description.

It has multiple lines.
`;
            const entries = manager.parseEntries(markdown);
            
            expect(entries.length).toBe(1);
            expect(entries[0].time).toBe('2023-01-01');
            // Older format falls back to a single item
            expect(entries[0].items?.[0].description).toBe('This is an old format description.\nIt has multiple lines.');
        });
    });
});
