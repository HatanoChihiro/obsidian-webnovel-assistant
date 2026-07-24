import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from '../src/services/WorkerManager';

describe('WorkerManager', () => {
    let mockPlugin: any;
    let registeredListeners: Record<string, EventListener> = {};

    beforeEach(() => {
        registeredListeners = {};

        (global as any).window = {
            moment: () => ({
                format: () => '2026-07-23'
            }),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn()
        };

        (global as any).activeDocument = {
            visibilityState: 'visible',
            hasFocus: () => true,
            addEventListener: vi.fn((event: string, fn: EventListener) => {
                registeredListeners[event] = fn;
            }),
            removeEventListener: vi.fn((event: string) => {
                delete registeredListeners[event];
            })
        };

        // Mock Worker
        (global as any).Worker = vi.fn().mockImplementation(() => ({
            postMessage: vi.fn(),
            terminate: vi.fn(),
            onerror: null,
            onmessage: null
        }));
        (global as any).URL = {
            createObjectURL: vi.fn().mockReturnValue('blob:test'),
            revokeObjectURL: vi.fn()
        };

        mockPlugin = {
            isTracking: true,
            focusMs: 0,
            slackMs: 0,
            lastTickTime: 0,
            lastEditTime: Date.now(),
            settings: {
                idleTimeoutThreshold: 60000
            },
            historyManager: {
                addFocusTime: vi.fn(),
                addSlackTime: vi.fn(),
                addHourlyFocusTime: vi.fn(),
                addHourlySlackTime: vi.fn(),
                saveHistory: vi.fn().mockResolvedValue(undefined)
            },
            adaptiveDebounceManager: {
                debounceFixed: vi.fn((key: string, fn: Function) => fn())
            },
            refreshStatusViews: vi.fn(),
            mobileFloatingStats: {
                updateTimerUI: vi.fn()
            }
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should register and unregister visibilitychange event listener', () => {
        const manager = new WorkerManager(mockPlugin);
        manager.setup();

        expect((global as any).activeDocument.addEventListener).toHaveBeenCalledWith(
            'visibilitychange',
            expect.any(Function)
        );

        manager.terminate();
        expect((global as any).activeDocument.removeEventListener).toHaveBeenCalledWith(
            'visibilitychange',
            expect.any(Function)
        );
    });

    it('should count background elapsed time towards slackMs when app returns from hidden to visible', () => {
        const manager = new WorkerManager(mockPlugin);
        manager.setup();

        const visibilityListener = registeredListeners['visibilitychange'];
        expect(visibilityListener).toBeDefined();

        // 模拟 App 切换到后台
        (global as any).activeDocument.visibilityState = 'hidden';
        const hideTime = 10000;
        vi.spyOn(Date, 'now').mockReturnValue(hideTime);
        visibilityListener({} as Event);

        // 模拟 30 秒后 App 恢复前台
        const returnTime = 40000; // 30,000ms 以后
        vi.spyOn(Date, 'now').mockReturnValue(returnTime);
        (global as any).activeDocument.visibilityState = 'visible';
        visibilityListener({} as Event);

        // 检查 slackMs 增加 30,000ms
        expect(mockPlugin.slackMs).toBe(30000);
        expect(mockPlugin.historyManager.addSlackTime).toHaveBeenCalledWith('2026-07-23', 30000);
        expect(mockPlugin.lastEditTime).toBe(0); // 切回后打字状态失效
        expect(mockPlugin.mobileFloatingStats.updateTimerUI).toHaveBeenCalled();
    });
});
