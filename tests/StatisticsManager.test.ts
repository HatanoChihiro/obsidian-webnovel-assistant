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
            focusMs: 0,
            slackMs: 0,
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

    it('uses the retained chapter even when the last tracked document belongs to another context', () => {
        const retained = new TFile('第1章.md', 'Novel/第1章.md');
        mockPlugin.lastFilePath = 'Notes/todo.md';
        mockPlugin.lastFileWords = 0;
        mockPlugin.cacheManager.getFileCache.mockReturnValue(42);
        mockPlugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { 'word-goal': 120 } });

        const stats = new StatisticsManager(mockPlugin).getCoreStats(retained);

        expect(stats.currentFile).toBe('第1章');
        expect(stats.todayWords).toBe(42);
        expect(stats.goal).toBe(120);
        expect(stats.dailyGoal).toBe(500);
    });

    describe('session writing speed calculation', () => {
        it('calculates positive speed including slack duration in total elapsed time', () => {
            const manager = new StatisticsManager(mockPlugin);
            mockPlugin.isTracking = true;
            mockPlugin.sessionAddedWords = 1500;
            mockPlugin.focusMs = 1800000; // 30 min focus
            mockPlugin.slackMs = 1800000; // 30 min slack (total 1 hour)

            expect(manager.getSessionSpeed()).toBe(1500);
            expect(manager.getCoreStats().sessionSpeed).toBe(1500);
        });

        it('returns zero when total duration is zero', () => {
            const manager = new StatisticsManager(mockPlugin);
            mockPlugin.isTracking = true;
            mockPlugin.sessionAddedWords = 500;
            mockPlugin.focusMs = 0;
            mockPlugin.slackMs = 0;

            expect(manager.getSessionSpeed()).toBe(0);
            expect(manager.getCoreStats().sessionSpeed).toBe(0);
        });

        it('returns zero when net session added words is negative', () => {
            const manager = new StatisticsManager(mockPlugin);
            mockPlugin.isTracking = true;
            mockPlugin.sessionAddedWords = -200;
            mockPlugin.focusMs = 3600000; // 1 hour
            mockPlugin.slackMs = 0;

            expect(manager.getSessionSpeed()).toBe(0);
            expect(manager.getCoreStats().sessionSpeed).toBe(0);
        });

        it('rounds speed to the nearest integer chars/hour', () => {
            const manager = new StatisticsManager(mockPlugin);
            mockPlugin.isTracking = true;
            mockPlugin.sessionAddedWords = 100;
            mockPlugin.focusMs = 2100000; // 35 min
            mockPlugin.slackMs = 2100000; // 35 min -> total 70 min = 7/6 hours -> 100 / (7/6) = 85.714... -> 86

            expect(manager.getSessionSpeed()).toBe(86);
            expect(manager.getCoreStats().sessionSpeed).toBe(86);
        });

        it('retains speed calculation during pause state', () => {
            const manager = new StatisticsManager(mockPlugin);
            mockPlugin.isTracking = false; // paused
            mockPlugin.sessionAddedWords = 1200;
            mockPlugin.focusMs = 1800000;
            mockPlugin.slackMs = 1800000;

            expect(manager.getSessionSpeed()).toBe(1200);
            expect(manager.getCoreStats().sessionSpeed).toBe(1200);
        });

        it('resets speed to zero when tracking values are reset', () => {
            const manager = new StatisticsManager(mockPlugin);
            // Simulate prior session
            mockPlugin.sessionAddedWords = 1200;
            mockPlugin.focusMs = 1800000;
            mockPlugin.slackMs = 1800000;
            expect(manager.getSessionSpeed()).toBe(1200);

            // Reset following existing lifecycle values
            mockPlugin.sessionAddedWords = 0;
            mockPlugin.focusMs = 0;
            mockPlugin.slackMs = 0;
            mockPlugin.isTracking = false;

            expect(manager.getSessionSpeed()).toBe(0);
            expect(manager.getCoreStats().sessionSpeed).toBe(0);
        });
    });

    it('explicitly clears chapter stats without falling back to the previous work', () => {
        const previous = new TFile('第1章.md', 'Novel/第1章.md');
        mockPlugin.lastFilePath = previous.path;
        mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(previous);

        const stats = new StatisticsManager(mockPlugin).getCoreStats(null);

        expect(stats.currentFile).toBe('');
        expect(stats.todayWords).toBe(0);
        expect(stats.goal).toBe(0);
        expect(stats.dailyGoal).toBe(500);
    });

    describe('getDailyStats', () => {
        it('computes all six metrics for a day with hourlyFocus and isolates adjacent days', () => {
            const manager = new StatisticsManager(mockPlugin);
            const hourlyFocusTarget = new Array<number>(24).fill(0);
            hourlyFocusTarget[9] = 1800000;
            hourlyFocusTarget[10] = 1800000;

            const hourlyFocusAdjacent = new Array<number>(24).fill(0);
            hourlyFocusAdjacent[22] = 7200000;

            const history = {
                '2026-06-20': {
                    focusMs: 7200000,
                    slackMs: 1800000,
                    addedWords: 9999,
                    hourlyFocus: hourlyFocusAdjacent
                },
                '2026-06-21': {
                    focusMs: 3600000,
                    slackMs: 1800000,
                    addedWords: 1500,
                    hourlyFocus: hourlyFocusTarget
                },
                '2026-06-22': {
                    focusMs: 5400000,
                    slackMs: 0,
                    addedWords: 3000,
                    hourlyFocus: hourlyFocusAdjacent
                }
            };

            const summary = manager.getDailyStats(history, '2026-06-21');

            expect(summary.activeHours).toBe(manager.calcActiveHours({ '2026-06-21': history['2026-06-21'] }, '2026-06-21', '2026-06-21'));
            expect(summary.activeHours).not.toBe('');
            expect(summary.focusMs).toBe(3600000);
            expect(summary.slackMs).toBe(1800000);
            expect(summary.totalMs).toBe(5400000);
            expect(summary.addedWords).toBe(1500);
            expect(summary.writingSpeed).toBe(1000);
        });

        it('keeps negative addedWords and negative speed without clamping', () => {
            const manager = new StatisticsManager(mockPlugin);
            const history = {
                '2026-06-21': {
                    focusMs: 1800000,
                    slackMs: 1800000,
                    addedWords: -450
                }
            };

            const summary = manager.getDailyStats(history, '2026-06-21');

            expect(summary.addedWords).toBe(-450);
            expect(summary.totalMs).toBe(3600000);
            expect(summary.writingSpeed).toBe(-450);
        });

        it('supports legacy stats without hourlyFocus arrays', () => {
            const manager = new StatisticsManager(mockPlugin);
            const history = {
                '2026-06-21': {
                    focusMs: 1800000,
                    slackMs: 0,
                    addedWords: 600
                }
            };

            const summary = manager.getDailyStats(history, '2026-06-21');

            expect(summary.activeHours).toBe('');
            expect(summary.totalMs).toBe(1800000);
            expect(summary.focusMs).toBe(1800000);
            expect(summary.slackMs).toBe(0);
            expect(summary.addedWords).toBe(600);
            expect(summary.writingSpeed).toBe(1200);
        });

        it('returns zero durations/words and unavailable activeHours/speed when date has no data', () => {
            const manager = new StatisticsManager(mockPlugin);
            const summary = manager.getDailyStats({}, '2026-06-21');

            expect(summary).toEqual({
                activeHours: '',
                totalMs: 0,
                focusMs: 0,
                slackMs: 0,
                addedWords: 0,
                writingSpeed: null
            });
        });

        it('returns zero speed when total duration is zero, and 0 speed when duration is nonzero with 0 words', () => {
            const manager = new StatisticsManager(mockPlugin);
            const zeroDuration = manager.getDailyStats({
                '2026-06-20': { focusMs: 0, slackMs: 0, addedWords: 200 }
            }, '2026-06-20');
            expect(zeroDuration.writingSpeed).toBe(0);

            const zeroWords = manager.getDailyStats({
                '2026-06-21': { focusMs: 1800000, slackMs: 0, addedWords: 0 }
            }, '2026-06-21');
            expect(zeroWords.writingSpeed).toBe(0);
        });

        it.each([
            [15000, 0, 0],
            [29999, 30000, 0],
            [30000, 30000, 15000],
            [0, 60000, 15000]
        ])('uses the displayed minute boundary for %i focus ms and %i slack ms', (focusMs, slackMs, speed) => {
            const manager = new StatisticsManager(mockPlugin);
            const summary = manager.getDailyStats({
                '2026-06-21': { focusMs, slackMs, addedWords: 250 }
            }, '2026-06-21');

            expect(summary.writingSpeed).toBe(speed);
            expect(summary.totalMs).toBe(focusMs + slackMs);
            expect(summary.addedWords).toBe(250);
        });
    });

    describe('mobile immersive main-editor binding', () => {
        it('reads stats from activeMainLeaf even when a reference view (including same file path) is active', () => {
            const mainFile = new TFile('Chapter1.md', 'Novel/Chapter1.md');
            mainFile.basename = 'Chapter1';
            const mainView = {
                file: mainFile,
                getViewData: vi.fn().mockReturnValue('12345')
            };
            const refViewSamePath = {
                file: mainFile,
                getViewData: vi.fn().mockReturnValue('12345678901234567890')
            };

            mockPlugin.app.workspace.getActiveViewOfType.mockReturnValue(refViewSamePath);
            mockPlugin.calculateAccurateWords = vi.fn((text: string) => text.length);
            mockPlugin.immersiveModeManager = {
                isMobileDataIsolationActive: () => true,
                getDataScopedMainView: () => mainView,
                getDataScopedMainFile: () => mainFile
            };

            const manager = new StatisticsManager(mockPlugin);
            const stats = manager.getCoreStats();

            expect(stats.currentFile).toBe('Chapter1');
            expect(stats.todayWords).toBe(5);
            expect(mainView.getViewData).toHaveBeenCalled();
            expect(refViewSamePath.getViewData).not.toHaveBeenCalled();
        });
    });
});
