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

    describe('debounce (Adaptive)', () => {
        it('should use MEDIUM delay (300ms) by default or with insufficient data', () => {
            const callback = vi.fn();
            manager.debounce('test-key', callback);
            
            vi.advanceTimersByTime(299);
            expect(callback).not.toHaveBeenCalled();
            
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should use FAST delay (500ms) for fast typing (< 200ms interval)', () => {
            const callback = vi.fn();
            
            // Simulate 3 rapid keystrokes with 100ms interval (average 100ms)
            manager.debounce('fast-key', callback);
            vi.advanceTimersByTime(100);
            manager.debounce('fast-key', callback);
            vi.advanceTimersByTime(100);
            manager.debounce('fast-key', callback);
            
            // Fast delay is 500ms
            vi.advanceTimersByTime(499);
            expect(callback).not.toHaveBeenCalled();
            
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should use SLOW delay (150ms) for slow typing (> 500ms interval)', () => {
            const callback = vi.fn();
            
            // Simulate slow keystrokes with 600ms interval
            manager.debounce('slow-key', callback);
            // First keystroke completes in medium delay (300ms)
            vi.advanceTimersByTime(600);
            expect(callback).toHaveBeenCalledTimes(1);
            
            manager.debounce('slow-key', callback);
            vi.advanceTimersByTime(600);
            expect(callback).toHaveBeenCalledTimes(2);
            
            // Third keystroke should use slow delay (150ms)
            manager.debounce('slow-key', callback);
            vi.advanceTimersByTime(149);
            expect(callback).toHaveBeenCalledTimes(2);
            
            vi.advanceTimersByTime(1);
            expect(callback).toHaveBeenCalledTimes(3);
        });
    });
});
