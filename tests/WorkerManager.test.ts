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

    it('should reset state on visibilitychange without calculating background time directly', () => {
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

        // visibilitychange 不再直接增加 slackMs，仅负责重置 lastEditTime 与 UI
        expect(mockPlugin.slackMs).toBe(0);
        expect(mockPlugin.lastEditTime).toBe(0); // 切回后打字状态失效
        expect(mockPlugin.mobileFloatingStats.updateTimerUI).toHaveBeenCalled();
    });

    it('should avoid double-counting background time regardless of visibilitychange and worker tick execution order', () => {
        const manager = new WorkerManager(mockPlugin);
        manager.setup();

        const visibilityListener = registeredListeners['visibilitychange'];
        expect(visibilityListener).toBeDefined();
        // @ts-ignore
        const workerInstance = (global as any).Worker.mock.results[0].value;
        expect(workerInstance.onmessage).toBeDefined();

        // 步骤 1: 初始工作 1000ms 的正常 tick（未在打字，即 lastEditTime 久远，计入 slackMs）
        mockPlugin.lastTickTime = 10000;
        mockPlugin.lastEditTime = -100000;
        vi.spyOn(Date, 'now').mockReturnValue(11000);
        workerInstance.onmessage({ data: 'tick' });
        expect(mockPlugin.slackMs).toBe(1000);

        // 步骤 2: App 切后台 30 秒
        (global as any).activeDocument.visibilityState = 'hidden';
        vi.spyOn(Date, 'now').mockReturnValue(11500);
        visibilityListener({} as Event);

        // 场景 A: 30 秒后唤醒，Worker 消息先到达，visibilitychange 后到达
        const returnTime = 41000; // 后台停留了 30,000ms
        vi.spyOn(Date, 'now').mockReturnValue(returnTime);

        // Worker tick 先触发 (delta = 41000 - 11000 = 30000 > 2000)
        workerInstance.onmessage({ data: 'tick' });
        expect(mockPlugin.slackMs).toBe(31000); // 1000 + 30000

        // visibilitychange 后触发
        (global as any).activeDocument.visibilityState = 'visible';
        visibilityListener({} as Event);
        // 不会重复增加
        expect(mockPlugin.slackMs).toBe(31000);
        expect(mockPlugin.historyManager.addSlackTime).toHaveBeenLastCalledWith('2026-07-23', 30000);
    });
});
