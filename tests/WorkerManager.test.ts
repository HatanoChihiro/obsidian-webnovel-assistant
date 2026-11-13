import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from '../src/services/WorkerManager';
import { Platform, TFile, TFolder } from 'obsidian';

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
        (global as any).Worker = vi.fn().mockImplementation(function () {
            return {
                postMessage: vi.fn(),
                terminate: vi.fn(),
                onerror: null,
                onmessage: null
            };
        });
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
                idleTimeoutThreshold: 60000,
                workspaceFolders: ['workspace']
            },
            cacheManager: {
                isFileInWorkspace: vi.fn((file: TFile) => {
                    const folders = mockPlugin.settings.workspaceFolders;
                    if (!folders || folders.length === 0) {
                        return true;
                    }
                    return folders.some((folder: string) => file.path.startsWith(folder.endsWith('/') ? folder : folder + '/'));
                })
            },
            app: {
                workspace: {
                    getActiveFile: vi.fn((): TFile | null => null)
                }
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
            refreshStatusTimers: vi.fn(),
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

    it('uses timer-only refresh for stable ticks and triggers full refresh exactly once at midnight', () => {
        let currentDate = '2026-07-23';
        (global as unknown as { window: { moment: () => { format: () => string } } }).window.moment = () => ({
            format: () => currentDate
        });

        const manager = new WorkerManager(mockPlugin);
        manager.setup();
        manager.postMessage('start');

        const workerInstance = vi.mocked(Worker).mock.results[0].value as {
            onmessage(event: { data: string }): void;
        };

        // 1. First tick on same date
        mockPlugin.lastTickTime = 10000;
        vi.spyOn(Date, 'now').mockReturnValue(11000);
        workerInstance.onmessage({ data: 'tick' });

        expect(mockPlugin.refreshStatusTimers).toHaveBeenCalledTimes(1);
        expect(mockPlugin.refreshStatusViews).not.toHaveBeenCalled();

        // 2. Second tick on same date
        vi.spyOn(Date, 'now').mockReturnValue(12000);
        workerInstance.onmessage({ data: 'tick' });

        expect(mockPlugin.refreshStatusTimers).toHaveBeenCalledTimes(2);
        expect(mockPlugin.refreshStatusViews).not.toHaveBeenCalled();

        // 3. Midnight strikes: date changes to 2026-07-24
        currentDate = '2026-07-24';
        vi.spyOn(Date, 'now').mockReturnValue(13000);
        workerInstance.onmessage({ data: 'tick' });

        // Midnight must trigger one full refresh (includeChart=true)
        expect(mockPlugin.refreshStatusViews).toHaveBeenCalledTimes(1);
        expect(mockPlugin.refreshStatusViews).toHaveBeenCalledWith(true);
        expect(mockPlugin.refreshStatusTimers).toHaveBeenCalledTimes(2); // unchanged

        // 4. Next tick after midnight continues on new day: timer-only again
        vi.spyOn(Date, 'now').mockReturnValue(14000);
        workerInstance.onmessage({ data: 'tick' });

        expect(mockPlugin.refreshStatusViews).toHaveBeenCalledTimes(1); // not called again
        expect(mockPlugin.refreshStatusTimers).toHaveBeenCalledTimes(3);
    });

    describe('workspace-scoped focus timer optimization', () => {
        const createMockFile = (path: string): TFile => {
            const file = Object.create(TFile.prototype) as TFile;
            file.path = path;
            return file;
        };

        it('ignores late input events from an inactive workspace document', () => {
            const outsideFile = createMockFile('outside/Notes.md');
            const backgroundFile = createMockFile('workspace/Reference.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(outsideFile);
            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(80000);

            manager.handleEditorChange(backgroundFile);

            expect(mockPlugin.lastEditTime).toBe(10000);
        });

        it('retains the last document scope when restarting a worker with a fileless panel active', () => {
            const chapterFile = createMockFile('workspace/Chapter.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);
            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.terminate();
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);
            manager.setup();
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            const worker = vi.mocked(Worker).mock.results[1].value as {
                onmessage(event: { data: string }): void;
            };

            worker.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(0);
        });

        it('uses the actual active file when input arrives before the file-change callback', () => {
            const outsideFile = createMockFile('outside/Notes.md');
            const chapterFile = createMockFile('workspace/Chapter.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(outsideFile);
            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(80000);
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            manager.handleEditorChange(chapterFile);

            expect(mockPlugin.lastEditTime).toBe(80000);
        });

        it('reevaluates the current file when its containing folder moves outside the workspace', () => {
            const chapterFile = createMockFile('workspace/Volume/Chapter.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);
            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(10000);
            chapterFile.path = 'outside/Volume/Chapter.md';
            const movedFolder = new TFolder();
            movedFolder.name = 'Volume';
            movedFolder.path = 'outside/Volume';
            manager.handleFileRename(movedFolder, 'workspace/Volume');
            const worker = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };
            vi.spyOn(Date, 'now').mockReturnValue(11000);

            worker.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(0);
            expect(mockPlugin.slackMs).toBe(1000);
        });

        it('within configured workspaceFolders, switching between chapters, lore and non-counted docs preserves activity without resetting focus', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const loreFile = createMockFile('workspace/Lore.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            // Active typing in chapter at t=10000
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(0);

            // Switch to lore file within workspaceFolders at t=11500 (without typing)
            vi.spyOn(Date, 'now').mockReturnValue(11500);
            manager.handleActiveFileChange(loreFile);

            // lastEditTime must NOT be reset or refreshed
            expect(mockPlugin.lastEditTime).toBe(10000);

            // Next tick at t=12000 (still within idle threshold of 60s from t=10000)
            vi.spyOn(Date, 'now').mockReturnValue(12000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(2000);
            expect(mockPlugin.slackMs).toBe(0);
        });

        it('active document outside all configured workspace folders immediately makes ongoing time slack even while typing', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            // Active typing in chapter at t=10000
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1000);

            // Switch to outside document at t=11000
            manager.handleActiveFileChange(outsideFile);

            // Even while typing in outside document at t=11500:
            vi.spyOn(Date, 'now').mockReturnValue(11500);
            manager.handleEditorChange(outsideFile);

            // Tick at t=12000: ongoing time outside immediately counts as slack
            vi.spyOn(Date, 'now').mockReturnValue(12000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(1000);
            expect(mockPlugin.isTracking).toBe(true);
        });

        it('outside typing must never refresh activity timestamp, and return inside restores normal check without artificial activation', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            // User was active inside at t=10000
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1000);

            // Switch to outside document at t=11000
            manager.handleActiveFileChange(outsideFile);

            // User types in outside document at t=20000
            vi.spyOn(Date, 'now').mockReturnValue(20000);
            manager.handleEditorChange(outsideFile);

            // Outside input must NEVER refresh lastEditTime used for inside focus
            expect(mockPlugin.lastEditTime).toBe(10000);

            // Advance past idle threshold (60s) to t=75000: user returns inside
            vi.spyOn(Date, 'now').mockReturnValue(75000);
            manager.handleActiveFileChange(chapterFile);

            // Return inside does not artificially activate focus
            expect(mockPlugin.lastEditTime).toBe(10000);

            // Tick at t=76000: normal check applies; elapsed time outside + idle inside is slack
            mockPlugin.lastTickTime = 75000;
            vi.spyOn(Date, 'now').mockReturnValue(76000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(65000);

            // User now actually types inside chapter at t=76500
            vi.spyOn(Date, 'now').mockReturnValue(76500);
            manager.handleEditorChange(chapterFile);
            expect(mockPlugin.lastEditTime).toBe(76500);

            // Next tick at t=77000: focus resumes!
            vi.spyOn(Date, 'now').mockReturnValue(77000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(2000);
        });

        it('null-file panels (sidebars, workbench, modals) preserve the most recent document scope while idle expiry still applies', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            // 1. Inside scope: switch to null-file panel (e.g. sidebar or workbench)
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            manager.handleActiveFileChange(null);

            // Still within idle threshold -> preserves inside scope -> focus
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(0);

            // Advance past idle threshold while still on null-file panel
            mockPlugin.lastTickTime = 71000;
            vi.spyOn(Date, 'now').mockReturnValue(72000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(1000); // Idle expiry applied!

            // 2. Outside scope: switch to outside doc, then to null-file panel
            vi.spyOn(Date, 'now').mockReturnValue(73000);
            manager.handleActiveFileChange(outsideFile);
            mockPlugin.lastTickTime = 73000;

            vi.spyOn(Date, 'now').mockReturnValue(74000);
            manager.handleActiveFileChange(null);

            // Active typing outside should not help; scope preserved as outside -> slack
            mockPlugin.lastEditTime = 74000;
            vi.spyOn(Date, 'now').mockReturnValue(75000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.slackMs).toBe(4000);
        });

        it('quick switch outside before first tick classifies time as slack', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            mockPlugin.lastTickTime = 0;
            mockPlugin.lastEditTime = 100;

            // Quick switch to outside at t=200 before first tick
            vi.spyOn(Date, 'now').mockReturnValue(200);
            manager.handleActiveFileChange(outsideFile);

            // First tick arrives at t=1000
            vi.spyOn(Date, 'now').mockReturnValue(1000);
            workerInstance.onmessage({ data: 'tick' });

            // Next tick at t=2000 should be slack
            vi.spyOn(Date, 'now').mockReturnValue(2000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(0);
            expect(mockPlugin.slackMs).toBe(1800);
        });

        it('quick inside/outside switches between worker ticks accurately split focus and slack time', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            // Tick 1 at t=1000 (inside workspace, active)
            mockPlugin.lastTickTime = 1000;
            mockPlugin.lastEditTime = 1000;

            // Switch to outside at t=1400 (400ms after tick 1)
            vi.spyOn(Date, 'now').mockReturnValue(1400);
            manager.handleActiveFileChange(outsideFile);

            // 400ms inside should be credited to focus immediately upon switch
            expect(mockPlugin.focusMs).toBe(400);
            expect(mockPlugin.slackMs).toBe(0);
            expect(mockPlugin.lastTickTime).toBe(1400);

            // Tick 2 arrives at t=2000 (600ms spent outside)
            vi.spyOn(Date, 'now').mockReturnValue(2000);
            workerInstance.onmessage({ data: 'tick' });

            // Remaining 600ms outside is credited to slack
            expect(mockPlugin.focusMs).toBe(400);
            expect(mockPlugin.slackMs).toBe(600);
        });

        it('idle inside workspace document counts as slack time', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 1000; // 9000ms old, threshold = 5000ms
            mockPlugin.settings.idleTimeoutThreshold = 5000;

            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(0);
            expect(mockPlugin.slackMs).toBe(1000);
        });

        it('empty workspace configuration treats whole vault as in workspace', () => {
            mockPlugin.settings.workspaceFolders = [];
            const anyFile = createMockFile('some/random/notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(anyFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;

            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(0);
        });

        it('stopped tracking does not accumulate focus or slack time upon file switch or tick', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);
            mockPlugin.isTracking = false;

            const manager = new WorkerManager(mockPlugin);
            manager.setup();

            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;

            // Switch while stopped
            vi.spyOn(Date, 'now').mockReturnValue(10500);
            manager.handleActiveFileChange(outsideFile);
            expect(mockPlugin.focusMs).toBe(0);
            expect(mockPlugin.slackMs).toBe(0);

            // Tick while stopped
            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(0);
            expect(mockPlugin.slackMs).toBe(0);
        });

        it('mobile parity: uses visible state instead of hasFocus for focus classification and ignores outside input', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            const outsideFile = createMockFile('outside/Notes.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            // Mock Platform.isMobile
            Platform.isMobile = true;
            const doc = activeDocument as Document;
            const focusSpy = vi.spyOn(doc, 'hasFocus').mockReturnValue(false);

            try {
                const manager = new WorkerManager(mockPlugin);
                manager.setup();
                manager.postMessage('start');

                const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                    onmessage(event: { data: string }): void;
                };

                mockPlugin.lastTickTime = 10000;
                mockPlugin.lastEditTime = 10000;
                vi.spyOn(Date, 'now').mockReturnValue(11000);
                workerInstance.onmessage({ data: 'tick' });

                expect(mockPlugin.focusMs).toBe(1000);
                expect(mockPlugin.slackMs).toBe(0);

                // Switch to outside file on mobile
                mockPlugin.app.workspace.getActiveFile.mockReturnValue(outsideFile);
                manager.handleActiveFileChange(outsideFile);

                // Typing outside on mobile must never refresh lastEditTime
                vi.spyOn(Date, 'now').mockReturnValue(11500);
                manager.handleEditorChange(outsideFile);
                expect(mockPlugin.lastEditTime).toBe(10000);

                // Subsequent tick on mobile outside accrues slack
                vi.spyOn(Date, 'now').mockReturnValue(12000);
                workerInstance.onmessage({ data: 'tick' });

                expect(mockPlugin.focusMs).toBe(1000);
                expect(mockPlugin.slackMs).toBe(1000);
            } finally {
                Platform.isMobile = false;
                focusSpy.mockRestore();
            }
        });

        it('settings reevaluation transitions scope from inside to outside and back without input', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            // Active inside workspace at t=10000
            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(0);

            // Change workspace settings so configured folders no longer match
            mockPlugin.settings.workspaceFolders = ['other-folder'];
            vi.spyOn(Date, 'now').mockReturnValue(11500);
            manager.reevaluateScope();

            // Transition from inside to outside at t=11500 accrues 500ms focus
            expect(mockPlugin.focusMs).toBe(1500);
            expect(mockPlugin.lastTickTime).toBe(11500);

            // Next tick at t=12000 without typing: now outside, accrues slack
            vi.spyOn(Date, 'now').mockReturnValue(12000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1500);
            expect(mockPlugin.slackMs).toBe(500);

            // Revert workspace settings back to include chapterFile
            mockPlugin.settings.workspaceFolders = ['workspace'];
            vi.spyOn(Date, 'now').mockReturnValue(12400);
            manager.reevaluateScope();

            // Transition from outside to inside at t=12400 accrues 400ms slack
            expect(mockPlugin.slackMs).toBe(900);
            expect(mockPlugin.lastTickTime).toBe(12400);

            // Back inside within idle threshold (threshold 60s from t=10000): next tick resumes focus without input
            vi.spyOn(Date, 'now').mockReturnValue(13000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(2100);
            expect(mockPlugin.slackMs).toBe(900);
        });

        it('no known document at startup does not invent an inside document', () => {
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(null);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });

            // Without an active document at startup, focus is not granted
            expect(mockPlugin.focusMs).toBe(0);
            expect(mockPlugin.slackMs).toBe(1000);
        });

        it('file rename re-evaluates workspace membership without whole-vault scan', () => {
            const chapterFile = createMockFile('workspace/Chapter 1.md');
            mockPlugin.app.workspace.getActiveFile.mockReturnValue(chapterFile);

            const manager = new WorkerManager(mockPlugin);
            manager.setup();
            manager.postMessage('start');

            const workerInstance = vi.mocked(Worker).mock.results[0].value as {
                onmessage(event: { data: string }): void;
            };

            mockPlugin.lastTickTime = 10000;
            mockPlugin.lastEditTime = 10000;
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            workerInstance.onmessage({ data: 'tick' });
            expect(mockPlugin.focusMs).toBe(1000);

            // Rename file to outside folder
            const renamedFile = createMockFile('outside/Chapter 1.md');
            vi.spyOn(Date, 'now').mockReturnValue(11000);
            manager.handleFileRename(renamedFile, 'workspace/Chapter 1.md');

            // Subsequent tick should be slack
            vi.spyOn(Date, 'now').mockReturnValue(12000);
            workerInstance.onmessage({ data: 'tick' });

            expect(mockPlugin.focusMs).toBe(1000);
            expect(mockPlugin.slackMs).toBe(1000);
        });
    });
});
