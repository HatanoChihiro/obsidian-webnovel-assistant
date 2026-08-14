import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoreSyncService } from '../src/services/LoreSyncService';
import { TFile } from 'obsidian';

describe('LoreSyncService', () => {
    let mockApp: any;
    let mockPlugin: any;
    let mockCharacterManager: any;
    let mockFileManager: any;
    let service: LoreSyncService;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (global as any).window = global;

        mockFileManager = {
            processFrontMatter: vi.fn().mockImplementation(async (_file: any, cb: (fm: Record<string, unknown>) => void) => {
                const fm: Record<string, unknown> = {};
                cb(fm);
            })
        };

        mockCharacterManager = {
            cacheVersion: 1,
            getBookPathForFile: vi.fn().mockReturnValue('Book1'),
            isLorePath: vi.fn().mockReturnValue(false),
            getCharactersForBook: vi.fn().mockReturnValue(['张三', '李四', '三哥']),
            getCharacterFile: vi.fn().mockImplementation((_book: string, name: string) => {
                if (name === '张三' || name === '三哥') {
                    return { heading: '张三', file: { path: 'Book1/Lore/Characters.md' } };
                }
                if (name === '李四') {
                    return { heading: '李四', file: { path: 'Book1/Lore/Characters.md' } };
                }
                return null;
            })
        };

        mockApp = {
            vault: {
                cachedRead: vi.fn().mockResolvedValue('张三走进了房间，看到了李四。张三又喊了一声三哥。'),
                getMarkdownFiles: vi.fn().mockReturnValue([])
            },
            workspace: {
                on: vi.fn()
            },
            fileManager: mockFileManager
        };

        mockPlugin = {
            app: mockApp,
            characterManager: mockCharacterManager,
            settings: {
                workspaceFolders: []
            },
            adaptiveDebounceManager: {
                debounceFixed: vi.fn().mockImplementation((_key: string, fn: () => void) => fn())
            },
            registerEvent: vi.fn(),
            getVaultMarkdownFiles: vi.fn().mockReturnValue([]),
            getTrackedMarkdownFiles: vi.fn().mockReturnValue([]),
            isFileInStrictChapterException: vi.fn().mockReturnValue(false)
        };

        service = new LoreSyncService(mockPlugin);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('syncLoreForFile', () => {
        it('should count character mentions and update frontmatter lore array', async () => {
            const mockFile = new TFile('第1章 启程.md', 'Book1/第1章 启程.md');
            mockApp.vault.cachedRead.mockResolvedValue(`---
lore: ["旧数据×1"]
---
张三走进了房间，看到了李四。张三又喊了一声三哥。`);

            let capturedFm: Record<string, unknown> = {};
            mockFileManager.processFrontMatter.mockImplementation(async (_file: any, cb: (fm: Record<string, unknown>) => void) => {
                capturedFm = { lore: ['旧数据×1'] };
                cb(capturedFm);
            });

            await service.syncLoreForFile(mockFile as any);

            expect(mockFileManager.processFrontMatter).toHaveBeenCalledWith(mockFile, expect.any(Function));
            // 张三 appears 3 times (twice as 张三, once as 三哥), 李四 appears once
            expect(capturedFm.lore).toEqual(['张三×3', '李四×1']);
        });

        it('should strip frontmatter before scanning lore to prevent self-matching', async () => {
            const mockFile = new TFile('第1章 启程.md', 'Book1/第1章 启程.md');
            // Frontmatter contains "张三×10", but body has no lore
            mockApp.vault.cachedRead.mockResolvedValue(`---
lore: ["张三×10"]
---
这里没有任何角色名。`);

            let capturedFm: Record<string, unknown> = { lore: ['张三×10'] };
            mockFileManager.processFrontMatter.mockImplementation(async (_file: any, cb: (fm: Record<string, unknown>) => void) => {
                cb(capturedFm);
            });

            await service.syncLoreForFile(mockFile as any);

            // Lore key should be deleted since there are 0 mentions in body
            expect(capturedFm.lore).toBeUndefined();
        });

        it('should preserve existing lore metadata when the book index has no entries', async () => {
            const mockFile = new TFile('第1章.md', 'Book1/第1章.md');
            mockCharacterManager.getCharactersForBook.mockReturnValue([]);

            await service.syncLoreForFile(mockFile as any);

            expect(mockFileManager.processFrontMatter).not.toHaveBeenCalled();
        });

    });

    describe('getEligibleChapterFiles', () => {
        it('should filter eligible chapter files and exclude lore notes', () => {
            const chapter1 = new TFile('第1章.md', 'Book1/第1章.md');
            const chapter2 = new TFile('第2章.md', 'Book1/第2章.md');
            const loreNote = new TFile('角色志.md', 'Book1/设定/角色志.md');
            const randomDoc = new TFile('笔记.md', 'Book1/笔记.md');

            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([chapter1, chapter2, loreNote, randomDoc]);
            mockCharacterManager.isLorePath.mockImplementation((_book: string, parent: string) => parent.includes('设定'));

            const eligible = service.getEligibleChapterFiles();
            expect(eligible).toContain(chapter1);
            expect(eligible).toContain(chapter2);
            expect(eligible).not.toContain(loreNote);
            expect(eligible).not.toContain(randomDoc);
        });
    });

    describe('bulkRefresh', () => {
        it('should prevent overlapping bulk runs and return the in-flight promise', async () => {
            const file1 = new TFile('第1章.md', 'Book1/第1章.md');
            const file2 = new TFile('第2章.md', 'Book1/第2章.md');
            mockApp.vault.cachedRead.mockResolvedValue('张三 李四');

            const p1 = service.bulkRefresh([file1, file2]);
            const p2 = service.bulkRefresh([file1, file2]);

            // p1 and p2 should be the exact same promise instance
            expect(p1).toBe(p2);

            vi.runAllTimers();
            const [stats1, stats2] = await Promise.all([p1, p2]);
            expect(stats1).toBe(stats2);
            expect(stats1.total).toBe(2);
            expect(stats1.success).toBe(2);

            // Once settled, a subsequent run creates a new promise
            const p3 = service.bulkRefresh([file1]);
            expect(p3).not.toBe(p1);
            vi.runAllTimers();
            const stats3 = await p3;
            expect(stats3.total).toBe(1);
        });

        it('should process files with yielding and isolate per-file failures', async () => {
            const file1 = new TFile('第1章.md', 'Book1/第1章.md');
            const file2 = new TFile('第2章.md', 'Book1/第2章.md');
            const file3 = new TFile('第3章.md', 'Book1/第3章.md');

            mockApp.vault.cachedRead.mockImplementation(async (f: any) => {
                if (f.name === '第2章.md') {
                    throw new Error('Disk read failure on chapter 2');
                }
                return '张三 李四';
            });

            const statsPromise = service.bulkRefresh([file1, file2, file3]);

            // Advance timers if yielding occurs
            vi.runAllTimers();

            const stats = await statsPromise;

            expect(stats.total).toBe(3);
            expect(stats.success).toBe(2);
            expect(stats.failed).toBe(1);
        });

        it('should default to getEligibleChapterFiles when no files are passed', async () => {
            const file1 = new TFile('第1章.md', 'Book1/第1章.md');
            mockPlugin.getTrackedMarkdownFiles.mockReturnValue([file1]);

            const statsPromise = service.bulkRefresh();
            vi.runAllTimers();
            const stats = await statsPromise;

            expect(stats.total).toBe(1);
            expect(stats.success).toBe(1);
            expect(stats.failed).toBe(0);
        });
    });

    describe('initialize event listeners', () => {
        it('should register editor-change and active-leaf-change handlers', () => {
            service.initialize();

            expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(2);
        });
    });
});
