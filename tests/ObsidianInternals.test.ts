import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getElectronWindow } from '../src/services/ObsidianInternals';

describe('ObsidianInternals - getElectronWindow', () => {
    const originalWindow = global.window;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        global.window = originalWindow;
    });

    it('returns null on mobile environments where window.require is undefined', () => {
        (global as any).window = {};
        expect(getElectronWindow()).toBeNull();
    });

    it('returns electron window via electron.remote.getCurrentWindow if available', () => {
        const mockWin = { setAlwaysOnTop: vi.fn() };
        (global as any).window = {
            require: vi.fn().mockReturnValue({
                remote: {
                    getCurrentWindow: vi.fn().mockReturnValue(mockWin)
                }
            })
        };
        const result = getElectronWindow();
        expect(result).toBe(mockWin);
    });

    it('returns electron window via electron.BrowserWindow.getFocusedWindow if remote unavailable', () => {
        const mockWin = { setAlwaysOnTop: vi.fn() };
        (global as any).window = {
            require: vi.fn().mockReturnValue({
                BrowserWindow: {
                    getFocusedWindow: vi.fn().mockReturnValue(mockWin)
                }
            })
        };
        const result = getElectronWindow();
        expect(result).toBe(mockWin);
    });

    it('returns null gracefully if require throwing or electron module is invalid', () => {
        (global as any).window = {
            require: vi.fn().mockImplementation(() => {
                throw new Error('Module not found');
            })
        };
        expect(getElectronWindow()).toBeNull();
    });
});
