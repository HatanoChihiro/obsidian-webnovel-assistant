import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatisticsManager } from '../src/services/StatisticsManager';
import { TFile } from './mocks/obsidian';

describe('StatisticsManager', () => {
    let mockPlugin: any;
    let eventHandlers: Record<string, Function>;

    beforeEach(() => {
        eventHandlers = {};

        // 模拟 Obsidian 的 window.moment
        (global as any).window = {
            moment: () => ({
                format: () => '2026-06-21'
            })
        };

        // 模拟 Obsidian 的 Workspace EventBus
        const mockWorkspace = {
            on: vi.fn((eventName: string, handler: Function) => {
                eventHandlers[eventName] = handler;
                return {}; // return a fake EventRef
            }),
            getActiveViewOfType: vi.fn().mockReturnValue(null)
        };

        mockPlugin = {
            app: {
                workspace: mockWorkspace,
                vault: {
                    getAbstractFileByPath: vi.fn()
                },
                metadataCache: {
                    getFileCache: vi.fn().mockReturnValue(null)
                }
            },
            registerEvent: vi.fn(),
            isTracking: false,
            sessionAddedWords: 0,
            lastFilePath: '',
            lastFileWords: 0,
            settings: {
                defaultGoal: 3000,
                dailyGoal: 500
            },
            cacheManager: {
                isEligibleForWordCount: vi.fn().mockReturnValue(true),
                getFileCache: vi.fn().mockReturnValue(null)
            },
            isLayoutReady: true,
            historyManager: {
                addWords: vi.fn(),
                getDailyStat: vi.fn().mockReturnValue(null)
            },
            adaptiveDebounceManager: {
                debounceFixed: vi.fn((key: string, fn: Function) => fn()) // 立刻执行以方便测试
            },
            saveSettings: vi.fn().mockResolvedValue(undefined)
        };
    });

    it('should correctly bind events on setup', () => {
        const manager = new StatisticsManager(mockPlugin);
        manager.setup();

        expect(mockPlugin.app.workspace.on).toHaveBeenCalledWith(
            'webnovel:editor-word-count-updated',
            expect.any(Function)
        );
        expect(mockPlugin.registerEvent).toHaveBeenCalled();
    });

    it('should update historyManager regardless of tracking state', () => {
        const manager = new StatisticsManager(mockPlugin);
        manager.setup();

        const handler = eventHandlers['webnovel:editor-word-count-updated'];
        expect(handler).toBeDefined();

        // 触发 100 个字的净增
        handler({ path: 'test.md' }, 100);

        // 预期调用 historyManager
        expect(mockPlugin.historyManager.addWords).toHaveBeenCalledWith(expect.any(String), 100);
        // debounce 保存应该被调用
        expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it('should NOT increment sessionAddedWords when isTracking is false', () => {
        const manager = new StatisticsManager(mockPlugin);
        mockPlugin.isTracking = false; // 专注未开启
        mockPlugin.sessionAddedWords = 0;
        manager.setup();

        const handler = eventHandlers['webnovel:editor-word-count-updated'];
        handler({ path: 'test.md' }, 50);

        expect(mockPlugin.sessionAddedWords).toBe(0);
    });

    it('should increment sessionAddedWords when isTracking is true', () => {
        const manager = new StatisticsManager(mockPlugin);
        mockPlugin.isTracking = true; // 专注开启
        mockPlugin.sessionAddedWords = 100;
        manager.setup();

        const handler = eventHandlers['webnovel:editor-word-count-updated'];
        handler({ path: 'test.md' }, 50);

        expect(mockPlugin.sessionAddedWords).toBe(150);
    });

    it('should keep the last chapter goal while a side panel is active', () => {
        const file = new TFile('第1章.md', 'Novel/第1章.md');
        file.basename = '第1章';
        mockPlugin.lastFilePath = file.path;
        mockPlugin.lastFileWords = 42;
        mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
        mockPlugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { 'word-goal': 120 } });
        mockPlugin.cacheManager.getFileCache.mockReturnValue(42);

        const manager = new StatisticsManager(mockPlugin);
        const stats = manager.getCoreStats();

        expect(stats.currentFile).toBe('第1章');
        expect(stats.todayWords).toBe(42);
        expect(stats.goal).toBe(120);
    });
});
