import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForeshadowingManager } from '../src/services/ForeshadowingManager';
import { ForeshadowingStatus } from '../src/types/foreshadowing';
import { TFile } from 'obsidian';
import * as pathUtils from '../src/utils/path';

vi.mock('obsidian', () => ({
    normalizePath: (path: string) => path.replace(/\\/g, '/'),
    TFile: class {}
}));

// Mock path utilities
vi.mock('../src/utils/path', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/utils/path')>();
    return {
        ...actual,
        findBookRoot: vi.fn(),
    };
});

(global as any).window = {
    moment: () => ({
        format: () => '2023-01-01 12:00'
    })
};

describe('ForeshadowingManager', () => {
    let mockApp: any;
    let mockPlugin: any;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn(),
                create: vi.fn(),
                process: vi.fn(),
                createFolder: vi.fn()
            },
            fileManager: {
                renameFile: vi.fn()
            }
        };

        mockPlugin = {
            settings: {
                foreshadowing: {
                    fileName: 'Foreshadowing'
                }
            }
        };
    });

    describe('File Paths & Existence', () => {
        it('getForeshadowingFilePath should return correct path based on source file', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            
            const dummyFile = new TFile();
            const path = manager.getForeshadowingFilePath(dummyFile);
            expect(path).toBe('Book 1/Foreshadowing.md');
        });

        it('getForeshadowingFilePath should fallback to root if book root not found', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('');
            
            const dummyFile = new TFile();
            const path = manager.getForeshadowingFilePath(dummyFile);
            expect(path).toBe('Foreshadowing.md');
        });

        it('foreshadowingFileExists should return true if file exists', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === 'Book 1/Foreshadowing.md') return new TFile();
                return null;
            });
            
            const dummyFile = new TFile();
            expect(manager.foreshadowingFileExists(dummyFile)).toBe(true);
        });

        it('foreshadowingFileExists should return false if file does not exist', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
            
            const dummyFile = new TFile();
            expect(manager.foreshadowingFileExists(dummyFile)).toBe(false);
        });
    });

    describe('createForeshadowingFile', () => {
        it('should return existing file if it exists and rename if name differs', async () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            
            const existingFile = Object.assign(new TFile(), { name: '伏笔.md', path: 'Book 1/伏笔.md' });
            manager.findForeshadowingFile = vi.fn().mockReturnValue(existingFile);
            
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === 'Book 1/伏笔.md') return existingFile;
                if (path === 'Book 1/Foreshadowing.md') return Object.assign(new TFile(), { name: 'Foreshadowing.md', path: 'Book 1/Foreshadowing.md' });
                return null;
            });
            
            // Should rename from 伏笔.md to Foreshadowing.md
            const dummyFile = Object.assign(new TFile(), { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md' });
            const file = await manager.createForeshadowingFile(dummyFile);
            
            expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(existingFile, 'Book 1/Foreshadowing.md');
            expect(file).toBeDefined();
        });

        it('should create new file and folder if neither exist', async () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
            mockApp.vault.create.mockResolvedValue(Object.assign(new TFile(), { path: 'Book 1/Foreshadowing.md', name: 'Foreshadowing.md' }));
            
            const dummyFile = Object.assign(new TFile(), { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md' });
            const file = await manager.createForeshadowingFile(dummyFile);
            
            expect(mockApp.vault.createFolder).toHaveBeenCalledWith('Book 1');
            expect(mockApp.vault.create).toHaveBeenCalledWith('Book 1/Foreshadowing.md', '');
            expect(file.path).toBe('Book 1/Foreshadowing.md');
        });
    });

    describe('CRUD Operations', () => {
        it('appendEntry should process the target file', async () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            
            const targetFile = Object.assign(new TFile(), { path: 'Book 1/Foreshadowing.md', name: 'Foreshadowing.md' });
            
            const entry = {
                status: ForeshadowingStatus.Pending,
                description: 'Test entry',
                content: 'Test content',
                sourceFile: 'Chapter 1',
                tags: [],
                createdAt: '2023-01-01 12:00'
            };
            
            await manager.appendEntry(targetFile, entry);
            
            expect(mockApp.vault.process).toHaveBeenCalledWith(targetFile, expect.any(Function));
        });

        it('markAsRecovered should process existing file', async () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            
            const existingFile = Object.assign(new TFile(), { path: 'Book 1/Foreshadowing.md', name: 'Foreshadowing.md' });
            manager.createForeshadowingFile = vi.fn().mockResolvedValue(existingFile);
            (manager as any).findEntryByDescription = vi.fn().mockReturnValue({
                found: true,
                startPos: 0,
                endPos: 10,
                matchedText: 'Test entry context'
            });
            
            const dummyFile = Object.assign(new TFile(), { path: 'Book 1/Chapter 1.md', name: 'Chapter 1.md' });
            await manager.markAsRecovered(existingFile, 'Test entry', ['Chapter 2']);
            
            expect(mockApp.vault.process).toHaveBeenCalledWith(existingFile, expect.any(Function));
        });

        it('markAsDeprecated should process existing file', async () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');
            
            const existingFile = Object.assign(new TFile(), { path: 'Book 1/Foreshadowing.md' });
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === 'Book 1/Foreshadowing.md') return existingFile;
                return null;
            });
            
            await manager.markAsDeprecated(existingFile, 'Test entry');
            
            expect(mockApp.vault.process).toHaveBeenCalledWith(existingFile, expect.any(Function));
        });
    });

    describe('formatEntry', () => {
        it('should format unresolved entries correctly', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            
            const formatted = manager.formatEntry({
                status: ForeshadowingStatus.Pending,
                description: 'Who is the hidden boss?',
                content: 'Some context here',
                sourceFile: 'Chapter 1',
                tags: ['Mystery'],
                createdAt: '2023-01-01 12:00'
            });
            
            expect(formatted).toContain('## Who is the hidden boss?');
            expect(formatted).toContain('> [[Chapter 1]]');
            expect(formatted).toContain('> Some context here');
            expect(formatted).toContain('#Mystery');
        });

        it('should format resolved entries correctly', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            
            const formatted = manager.formatEntry({
                status: ForeshadowingStatus.Recovered,
                description: 'Found the sword',
                content: 'Sword is found',
                sourceFile: 'Chapter 5',
                tags: [],
                createdAt: '2023-01-02 12:00'
            });
            
            expect(formatted).toContain('## Found the sword');
            expect(formatted).toContain('**状态**：已回收');
        });

        it('should format partially recovered entries with stage logs correctly', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            
            const formatted = manager.formatEntry({
                status: ForeshadowingStatus.PartiallyRecovered,
                description: 'Jade pendant secret',
                content: 'Found half jade pendant',
                sourceFile: 'Chapter 1',
                tags: ['Clue'],
                createdAt: '2023-01-01 12:00',
                recoveryLogs: [
                    { stageType: 'stage', file: 'Chapter 15', time: '2023-01-02 14:00', note: 'Appraised at auction' }
                ]
            });
            
            expect(formatted).toContain('## Jade pendant secret');
            expect(formatted).toContain('**状态**：阶段回收中');
            expect(formatted).toContain('- [阶段] [[Chapter 15]] - 2023-01-02 14:00：Appraised at auction');
        });
    });

    describe('findEntryByDescription', () => {
        it('should accurately find an existing entry by description', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            const content = `
## Who is the hidden boss?

> [[Chapter 1]]
> Some context here
            `;

            const match = manager['findEntryByDescription'](content, 'Who is the hidden boss?');
            expect(match.found).toBe(true);
        });

        it('should return found=false if description not found', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            const content = `## Entry one`;
            
            const match = manager['findEntryByDescription'](content, 'Missing entry');
            expect(match.found).toBe(false);
        });
    });

    describe('Staged Recovery Parsing & Management', () => {
        it('parseEntries should correctly parse staged recovery entries', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            const markdown = `
## Secret Map
> [[Chapter 1]] - 2023-01-01 10:00
> Found map fragment

**标签**：#Clue
**状态**：阶段回收中

**回收记录**：
- [阶段] [[Chapter 10]] - 2023-01-02 14:00：Found second piece
- [终结] [[Chapter 20]] - 2023-01-03 16:00：Combined whole map
---
`;
            const entries = manager.parseEntries(markdown);
            expect(entries).toHaveLength(1);
            expect(entries[0].status).toBe(ForeshadowingStatus.PartiallyRecovered);
            expect(entries[0].recoveryLogs).toBeDefined();
            expect(entries[0].recoveryLogs).toHaveLength(2);
            expect(entries[0].recoveryLogs![0]).toEqual({
                stageType: 'stage',
                file: 'Chapter 10',
                time: '2023-01-02 14:00',
                note: 'Found second piece'
            });
            expect(entries[0].recoveryLogs![1]).toEqual({
                stageType: 'final',
                file: 'Chapter 20',
                time: '2023-01-03 16:00',
                note: 'Combined whole map'
            });
        });

        it('addForeshadowing should preserve PartiallyRecovered status and recoveryLogs when merging a new quote', async () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            vi.mocked(pathUtils.findBookRoot).mockReturnValue('Book 1');

            const existingContent = `
## Secret Map
> [[Chapter 1]] - 2023-01-01 10:00
> Found map fragment

**标签**：#Clue
**状态**：阶段回收中

**回收记录**：
- [阶段] [[Chapter 10]] - 2023-01-02 14:00：Found second piece
---
`;

            const targetFile = new TFile();
            mockApp.vault.getAbstractFileByPath.mockReturnValue(targetFile);
            mockApp.vault.process.mockImplementation((file: any, cb: (content: string) => string) => {
                const updated = cb(existingContent);
                expect(updated).toContain('**状态**：阶段回收中');
                expect(updated).toContain('- [阶段] [[Chapter 10]] - 2023-01-02 14:00：Found second piece');
                expect(updated).toContain('> [[Chapter 2]]');
                expect(updated).toContain('> Found third piece');
                return Promise.resolve(updated);
            });

            const sourceFile = new TFile();
            sourceFile.basename = 'Chapter 2';

            const result = await manager.addForeshadowing(sourceFile, 'Found third piece', 'Secret Map', ['Clue']);
            expect(result.merged).toBe(true);
        });
    });
});
