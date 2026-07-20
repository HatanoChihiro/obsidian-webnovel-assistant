import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdaptiveDebounceManager } from '../src/services/AdaptiveDebounceManager';

describe('AdaptiveDebounceManager', () => {
    let manager: AdaptiveDebounceManager;

    beforeEach(() => {
        vi.useFakeTimers();
        // 使 window.setTimeout/clearTimeout 直接指向被 Vitest 接管的全局 fake timers
        (global as any).window = global;
        manager = new AdaptiveDebounceManager();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('debounceFixed', () => {
        it('should execute the callback after the specified delay', () => {
            const callback = vi.fn();
            manager.debounceFixed('test-key', callback, 300);

            // Should not be called immediately
            expect(callback).not.toHaveBeenCalled();

            // Advance time by 299ms
            vi.advanceTimersByTime(299);
            expect(callback).not.toHaveBeenCalled();

            // Advance time by 1ms (total 300ms)
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should reset the timer if called again before the delay', () => {
            const callback = vi.fn();
            
            manager.debounceFixed('test-key', callback, 300);
            vi.advanceTimersByTime(150);
            
            // Call again before the first timer finishes
            manager.debounceFixed('test-key', callback, 300);
            
            vi.advanceTimersByTime(200);
            // Total time 350ms, but since it was reset at 150ms, it needs 450ms total
            expect(callback).not.toHaveBeenCalled();
            
            vi.advanceTimersByTime(100);
            // Total time 450ms
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('throttle', () => {
        it('should execute immediately on first call', () => {
            const callback = vi.fn();
            manager.throttle('test-key', callback, 500);
            
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should not execute again if called within the interval', () => {
            const callback = vi.fn();
            
            manager.throttle('test-key', callback, 500);
            expect(callback).toHaveBeenCalledTimes(1);
            
            vi.advanceTimersByTime(300);
            manager.throttle('test-key', callback, 500);
            
            // Should still be 1
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should execute again after the interval has passed', () => {
            const callback = vi.fn();
            
            manager.throttle('test-key', callback, 500);
            
            vi.advanceTimersByTime(501);
            manager.throttle('test-key', callback, 500);
            
            expect(callback).toHaveBeenCalledTimes(2);
        });

        it('should clean up old throttle records to prevent memory leak', () => {
            const callback = vi.fn();
            
            // Fill throttleStats with 501 keys
            for (let i = 0; i < 501; i++) {
                manager.throttle(`key-${i}`, callback, 500);
            }
            
            // key-0 was deleted. So if we advance time by 0ms, normally it wouldn't execute (interval 500),
            // but since it's deleted from stats, it will execute again!
            manager.throttle('key-0', callback, 500);
            
            // 501 initial calls + 1 for key-0
            expect(callback).toHaveBeenCalledTimes(502);
        });
    });

    describe('debounce (Adaptive)', () => {
        it('should use MEDIUM delay (300ms) by default or with insufficient data', () => {
            const callback = vi.fn();
            manager.debounce('test-key', callback);
            
            vi.advanceTimersByTime(299);
            expect(callback).not.toHaveBeenCalled();
            
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(1);
            
            const stats = manager.getSpeedStats('test-key');
            expect(stats?.delay).toBe(300);
        });

        it('should use FAST delay (500ms) for fast typing (< 200ms interval)', () => {
            const callback = vi.fn();
            
            // Simulate 3 rapid keystrokes with 100ms interval (average 100ms)
            manager.debounce('fast-key', callback);
            vi.advanceTimersByTime(100);
            manager.debounce('fast-key', callback);
            vi.advanceTimersByTime(100);
            manager.debounce('fast-key', callback);
            
            const stats = manager.getSpeedStats('fast-key');
            // fast delay is 500ms
            expect(stats?.delay).toBe(500);
            
            vi.advanceTimersByTime(499);
            expect(callback).not.toHaveBeenCalled();
            
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should use SLOW delay (150ms) for slow typing (> 500ms interval)', () => {
            const callback = vi.fn();
            
            // Simulate slow keystrokes with 600ms interval
            manager.debounce('slow-key', callback);
            // Must wait for it to fire or we reset it. We wait 600ms, which fires the first one.
            vi.advanceTimersByTime(600);
            
            manager.debounce('slow-key', callback);
            vi.advanceTimersByTime(600);
            
            manager.debounce('slow-key', callback);
            
            const stats = manager.getSpeedStats('slow-key');
            // slow delay is 150ms
            expect(stats?.delay).toBe(150);
            
            vi.advanceTimersByTime(149);
            // It was fired before, so we reset the callback mock or check times
            const callCount = callback.mock.calls.length;
            
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(callCount + 1);
        });

        it('should clean up old speed stats records to prevent memory leak', () => {
            const callback = vi.fn();
            
            // 需要 502 次才能触发清理：第 502 次调用时 size=501 > 500，触发删除前 250 条
            for (let i = 0; i < 502; i++) {
                manager.debounce(`key-${i}`, callback);
            }
            
            // Should not throw, and key-0 stats should be deleted (null)
            const stats = manager.getSpeedStats('key-0');
            expect(stats).toBeNull();
            
            // key-500 should exist
            const stats500 = manager.getSpeedStats('key-500');
            expect(stats500).not.toBeNull();
        });
    });
});
