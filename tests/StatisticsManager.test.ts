import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatisticsManager } from '../src/services/StatisticsManager';

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
            })
        };

        mockPlugin = {
            app: {
                workspace: mockWorkspace
            },
            registerEvent: vi.fn(),
            isTracking: false,
            sessionAddedWords: 0,
            isLayoutReady: true,
            historyManager: {
                addWords: vi.fn()
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
            'webnovel:file-word-count-updated',
            expect.any(Function)
        );
        expect(mockPlugin.registerEvent).toHaveBeenCalled();
    });

    it('should update historyManager regardless of tracking state', () => {
        const manager = new StatisticsManager(mockPlugin);
        manager.setup();

        const handler = eventHandlers['webnovel:file-word-count-updated'];
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

        const handler = eventHandlers['webnovel:file-word-count-updated'];
        handler({ path: 'test.md' }, 50);

        expect(mockPlugin.sessionAddedWords).toBe(0);
    });

    it('should increment sessionAddedWords when isTracking is true', () => {
        const manager = new StatisticsManager(mockPlugin);
        mockPlugin.isTracking = true; // 专注开启
        mockPlugin.sessionAddedWords = 100;
        manager.setup();

        const handler = eventHandlers['webnovel:file-word-count-updated'];
        handler({ path: 'test.md' }, 50);

        expect(mockPlugin.sessionAddedWords).toBe(150);
    });
});
