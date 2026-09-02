import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TFile, WorkspaceLeaf, WorkspaceSplit, MarkdownView } from 'obsidian';
import { ImmersiveModeManager, type ImmersiveModeManagerPlugin } from '../src/ui/ImmersiveModeManager';

vi.mock('obsidian', () => ({
    Notice: vi.fn(),
    MarkdownView: class {},
    TFile: class {},
    TFolder: class {},
    ToggleComponent: class {
        setValue() { return this; }
        setTooltip() { return this; }
        onChange() { return this; }
    }
}));

describe('ImmersiveModeManager - Fullscreen & Esc Block', () => {
    let mockPlugin: ImmersiveModeManagerPlugin;
    let manager: ImmersiveModeManager;
    let registeredEvents: Record<string, Function[]> = {};
    let mockActiveDocument: any;

    beforeEach(() => {
        registeredEvents = {};
        mockActiveDocument = {
            body: {
                classList: {
                    add: vi.fn(),
                    remove: vi.fn(),
                    contains: vi.fn().mockReturnValue(false)
                },
                setCssProps: vi.fn(),
                appendChild: vi.fn()
            },
            documentElement: {
                // 默认 requestFullscreen 成功
                requestFullscreen: vi.fn().mockResolvedValue(undefined)
            },
            fullscreenElement: null,
            activeElement: null,
            querySelector: vi.fn().mockReturnValue(null),
            querySelectorAll: vi.fn().mockReturnValue([]),
            addEventListener: vi.fn((event: string, handler: Function) => {
                if (!registeredEvents[event]) registeredEvents[event] = [];
                registeredEvents[event].push(handler);
            }),
            removeEventListener: vi.fn((event: string, handler: Function) => {
                if (registeredEvents[event]) {
                    registeredEvents[event] = registeredEvents[event].filter(h => h !== handler);
                }
            })
        };

        (global as any).activeDocument = mockActiveDocument;
        (global as any).window = {
            requestAnimationFrame: vi.fn((fn: Function) => setTimeout(fn, 0)),
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval
        };

        mockPlugin = {
            app: {
                workspace: {
                    getActiveViewOfType: vi.fn().mockReturnValue(null),
                    getLeavesOfType: vi.fn().mockReturnValue([]),
                    iterateRootLeaves: vi.fn(),
                    on: vi.fn().mockReturnValue({ id: 'ref' }),
                    offref: vi.fn(),
                    getLeaf: vi.fn().mockReturnValue({
                        setViewState: vi.fn().mockResolvedValue(undefined),
                        containerEl: { classList: { add: vi.fn() } }
                    }),
                    createLeafBySplit: vi.fn().mockReturnValue({
                        setViewState: vi.fn().mockResolvedValue(undefined),
                        containerEl: { classList: { add: vi.fn() } }
                    }),
                    setActiveLeaf: vi.fn(),
                    updateOptions: vi.fn()
                },
                vault: {
                    getName: vi.fn().mockReturnValue('Vault'),
                    getAbstractFileByPath: vi.fn().mockReturnValue(null)
                },
                commands: { executeCommandById: vi.fn() }
            },
            adaptiveDebounceManager: {
                debounceFixed: vi.fn()
            },
            settings: {
                immersive: {
                    immersiveTopSlots: [],
                    immersiveBottomSlots: [],
                    immersiveLeftSlots: [],
                    immersiveRightSlots: [],
                    immersiveTopSize: 20,
                    immersiveBottomSize: 20,
                    immersiveLeftSize: 20,
                    immersiveRightSize: 20,
                    immersiveTopInternalSizes: [],
                    immersiveBottomInternalSizes: [],
                    immersiveLeftInternalSizes: [],
                    immersiveRightInternalSizes: [],
                    immersiveHideProperties: false,
                    typewriterEnabled: false
                }
            },
            stickyNoteManager: {
                syncActiveNotesToManager: vi.fn(),
                getNotes: vi.fn().mockReturnValue([]),
                saveNotes: vi.fn().mockResolvedValue(undefined),
                syncFloatingNotes: vi.fn()
            },
            startTracking: vi.fn(),
            stopTracking: vi.fn(),
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settingsManager: { flush: vi.fn().mockResolvedValue(undefined) }
        } as unknown as ImmersiveModeManagerPlugin;

        manager = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
    });

    it('registerImmersiveEventListeners registers fullscreenchange and pointer listeners (no keydown)', () => {
        manager['registerImmersiveEventListeners']();

        // 设计原则：Esc 完全屏蔽，无需 keydown 监听器；注册 pointerdown/pointerup/pointercancel 捕获分屏拖拽
        expect(registeredEvents['fullscreenchange']?.length).toBe(1);
        expect(registeredEvents['pointerdown']?.length).toBe(1);
        expect(registeredEvents['pointerup']?.length).toBe(1);
        expect(registeredEvents['pointercancel']?.length).toBe(1);
        expect(registeredEvents['keydown']?.length ?? 0).toBe(0);
    });

    it('cleanup removes fullscreenchange and resize pointer listeners', () => {
        manager['registerImmersiveEventListeners']();
        expect(registeredEvents['fullscreenchange']?.length).toBe(1);
        expect(registeredEvents['pointerdown']?.length).toBe(1);
        expect(registeredEvents['pointerup']?.length).toBe(1);
        expect(registeredEvents['pointercancel']?.length).toBe(1);

        manager.cleanup();
        expect(registeredEvents['fullscreenchange']?.length || 0).toBe(0);
        expect(registeredEvents['pointerdown']?.length || 0).toBe(0);
        expect(registeredEvents['pointerup']?.length || 0).toBe(0);
        expect(registeredEvents['pointercancel']?.length || 0).toBe(0);
    });

    it('fullscreenchange re-enters HTML5 fullscreen when immersive is active', () => {
        manager['isImmersiveActive'] = true;
        manager['registerImmersiveEventListeners']();

        mockActiveDocument.fullscreenElement = null;
        registeredEvents['fullscreenchange'][0]({} as Event);

        expect(mockActiveDocument.documentElement.requestFullscreen).toHaveBeenCalled();
    });

    it('fullscreenchange fallback to toggle-full-screen if requestFullscreen rejects', async () => {
        manager['isImmersiveActive'] = true;
        manager['registerImmersiveEventListeners']();

        mockActiveDocument.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new Error('fullscreen denied'));
        mockActiveDocument.fullscreenElement = null;
        registeredEvents['fullscreenchange'][0]({} as Event);

        await new Promise(r => setTimeout(r, 0));
        expect((mockPlugin.app as any).commands.executeCommandById).toHaveBeenCalledWith('app:toggle-full-screen');
    });

    it('fullscreenchange does NOT re-enter fullscreen when isExiting is true', () => {
        manager['isImmersiveActive'] = true;
        manager['isExiting'] = true;
        manager['registerImmersiveEventListeners']();

        mockActiveDocument.fullscreenElement = null;
        registeredEvents['fullscreenchange'][0]({} as Event);

        expect(mockActiveDocument.documentElement.requestFullscreen).not.toHaveBeenCalled();
    });

    it('toggleImmersiveMode ignores concurrent triggers when isTransitioning is true', async () => {
        manager['isTransitioning'] = true;
        const enterSpy = vi.spyOn(manager as any, 'enterImmersiveMode');
        const exitSpy = vi.spyOn(manager as any, 'exitImmersiveMode');

        await manager.toggleImmersiveMode();

        expect(enterSpy).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('isImmersiveLayout detects immersive specific view types and markers', () => {
        expect(manager['isImmersiveLayout']({ type: 'immersive-chapter-list' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'immersive-chapter-list-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'immersive-sticky-notes' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'immersive-sticky-notes-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ cls: 'immersive-reference-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ cls: 'immersive-main-editor' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'markdown' })).toBe(false);
    });

    it('buildImmersiveLayout isolates root leaves by detaching non-main root leaves', async () => {
        const targetFile = { path: 'Book/Chapter1.md' } as any;
        const mainLeaf = {
            view: { file: targetFile },
            getViewState: vi.fn().mockReturnValue({ state: { file: targetFile.path } }),
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: {
                classList: { add: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
        } as any;

        const otherLeaf = {
            detach: vi.fn(),
            view: { file: { path: 'Book/Lore.md' } },
            containerEl: { classList: { add: vi.fn() } }
        } as any;

        (mockPlugin.app.workspace.getLeavesOfType as any).mockReturnValue([mainLeaf]);
        (mockPlugin.app.workspace.iterateRootLeaves as any).mockImplementation((cb: (leaf: any) => void) => {
            cb(mainLeaf);
            cb(otherLeaf);
        });

        await manager['buildImmersiveLayout'](targetFile);

        expect(otherLeaf.detach).toHaveBeenCalled();
        expect(mainLeaf.setViewState).toHaveBeenCalled();
        expect(mainLeaf.containerEl.classList.add).toHaveBeenCalledWith('immersive-main-editor');
    });

    it('exitImmersiveMode detaches created leaves and restores savedLayout via changeLayout', async () => {
        const mockCreatedLeaf = { detach: vi.fn() } as any;
        manager['createdImmersiveLeaves'].add(mockCreatedLeaf);
        manager['isImmersiveActive'] = true;
        const normalLayout = { main: { type: 'split', children: [] } };
        manager['savedLayout'] = normalLayout;

        const changeLayoutSpy = vi.fn().mockResolvedValue(undefined);
        (mockPlugin.app.workspace as any).changeLayout = changeLayoutSpy;

        await manager.exitImmersiveMode();

        expect(mockCreatedLeaf.detach).toHaveBeenCalled();
        expect(manager['createdImmersiveLeaves'].size).toBe(0);
        expect(changeLayoutSpy).toHaveBeenCalledWith(normalLayout);
        expect(manager['isImmersiveActive']).toBe(false);
        expect(manager['savedLayout']).toBeNull();
    });

    it('tracks the most recently focused immersive Markdown leaf for advanced search', () => {
        manager['isImmersiveActive'] = true;
        const handlers: Record<string, Function> = {};
        const leaf = {
            view: { file: { path: 'Novel/参考.md' } },
            containerEl: {
                addEventListener: vi.fn((event: string, handler: Function) => {
                    handlers[event] = handler;
                }),
                removeEventListener: vi.fn()
            }
        } as any;

        manager['trackSearchSourceLeaf'](leaf);
        handlers.pointerdown();

        expect(manager.getSearchSourceLeaf()).toBe(leaf);
    });

    it('buildImmersiveLayout avoids mainLeaf.setViewState when already matching source Markdown', async () => {
        const targetFile = { path: 'Book/Chapter1.md' } as unknown as TFile;
        const mainLeaf = {
            view: { file: targetFile },
            getViewState: vi.fn().mockReturnValue({
                type: 'markdown',
                state: { file: targetFile.path, mode: 'source' }
            }),
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: {
                classList: { add: vi.fn(), remove: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
        } as unknown as WorkspaceLeaf;

        (mockPlugin.app.workspace.getLeavesOfType as unknown as ReturnType<typeof vi.fn>).mockReturnValue([mainLeaf]);
        (mockPlugin.app.workspace.iterateRootLeaves as unknown as ReturnType<typeof vi.fn>).mockImplementation((cb: (leaf: WorkspaceLeaf) => void) => {
            cb(mainLeaf);
        });

        await manager['buildImmersiveLayout'](targetFile);

        expect(mainLeaf.setViewState).not.toHaveBeenCalled();
        expect(mainLeaf.containerEl.classList.add).toHaveBeenCalledWith('immersive-main-editor');
    });

    it('buildImmersiveLayout builds skeleton first and schedules auxiliary mounts asynchronously', async () => {
        const targetFile = { path: 'Book/Chapter1.md' } as unknown as TFile;
        const mainLeaf = {
            view: { file: targetFile },
            getViewState: vi.fn().mockReturnValue({ type: 'markdown', state: { file: targetFile.path, mode: 'source' } }),
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: {
                classList: { add: vi.fn(), remove: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
        } as unknown as WorkspaceLeaf;

        const auxLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: {
                classList: { add: vi.fn(), remove: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
        } as unknown as WorkspaceLeaf;

        (mockPlugin.app.workspace.getLeavesOfType as unknown as ReturnType<typeof vi.fn>).mockReturnValue([mainLeaf]);
        (mockPlugin.app.workspace.iterateRootLeaves as unknown as ReturnType<typeof vi.fn>).mockImplementation((cb: (leaf: WorkspaceLeaf) => void) => {
            cb(mainLeaf);
        });
        (mockPlugin.app.workspace.createLeafBySplit as unknown as ReturnType<typeof vi.fn>).mockReturnValue(auxLeaf);

        mockPlugin.settings.immersive.immersiveLeftSlots = ['immersive-chapter-list-view'];
        mockPlugin.settings.immersive.immersiveRightSlots = ['reference-view'];

        await manager['buildImmersiveLayout'](targetFile);

        // 验证：workspace.on 未针对 layout-change 注册沉浸比例持久化监听
        const onWorkspaceEventSpy = mockPlugin.app.workspace.on as unknown as ReturnType<typeof vi.fn>;
        const layoutChangeCalls = onWorkspaceEventSpy.mock.calls.filter(args => args[0] === 'layout-change');
        expect(layoutChangeCalls.length).toBe(0);

        // 主编辑器已立即激活并聚焦
        expect((mockPlugin.app.workspace.setActiveLeaf as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(mainLeaf, { focus: true });
        // 辅助叶子骨架已打上对应类名与 pending 状态类
        expect(auxLeaf.containerEl.classList.add).toHaveBeenCalledWith('webnovel-immersive-slot-vertical');
        expect(auxLeaf.containerEl.classList.add).toHaveBeenCalledWith('immersive-reference-view');
        expect(auxLeaf.containerEl.classList.add).toHaveBeenCalledWith('is-immersive-slot-pending');

        // 此时 buildImmersiveLayout 刚返回，辅助视图尚未在同步调用栈中被阻塞挂载
        expect(auxLeaf.setViewState).not.toHaveBeenCalled();
        expect(auxLeaf.containerEl.classList.remove).not.toHaveBeenCalledWith('is-immersive-slot-pending');

        // 在 yield 调度后，辅助视图完成挂载并移除 pending 状态类
        await new Promise(r => setTimeout(r, 0));
        expect(auxLeaf.setViewState).toHaveBeenCalled();
        expect(auxLeaf.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');
    });

    it('scheduleAuxiliaryMounts mounts views in bounded batches of at most two concurrent mounts', async () => {
        let resolve1!: () => void;
        const p1 = new Promise<void>(resolve => { resolve1 = resolve; });
        let resolve2!: () => void;
        const p2 = new Promise<void>(resolve => { resolve2 = resolve; });
        let resolve3!: () => void;
        const p3 = new Promise<void>(resolve => { resolve3 = resolve; });

        const leaf1 = {
            setViewState: vi.fn().mockImplementation(() => p1),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        const leaf2 = {
            setViewState: vi.fn().mockImplementation(() => p2),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        const leaf3 = {
            setViewState: vi.fn().mockImplementation(() => p3),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;

        manager['createdImmersiveLeaves'].add(leaf1);
        manager['createdImmersiveLeaves'].add(leaf2);
        manager['createdImmersiveLeaves'].add(leaf3);

        const gen = 1;
        manager['layoutGeneration'] = gen;

        manager['scheduleAuxiliaryMounts']([
            { leaf: leaf1, viewType: 'view-1' },
            { leaf: leaf2, viewType: 'view-2' },
            { leaf: leaf3, viewType: 'view-3' }
        ], gen);

        // 第一次 yield 触发第一批挂载 (至多 2 个)
        await new Promise(r => setTimeout(r, 0));

        expect(leaf1.setViewState).toHaveBeenCalled();
        expect(leaf2.setViewState).toHaveBeenCalled();
        expect(leaf3.setViewState).not.toHaveBeenCalled();

        // 仅结算 leaf1
        resolve1();
        await new Promise(r => setTimeout(r, 0));
        expect(leaf1.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');
        expect(leaf2.containerEl.classList.remove).not.toHaveBeenCalledWith('is-immersive-slot-pending');
        expect(leaf3.setViewState).not.toHaveBeenCalled();

        // 结算 leaf2，完成第一批
        resolve2();
        await new Promise(r => setTimeout(r, 0));
        expect(leaf2.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');

        // 等待第二批前的 yield 完成，第二批的 leaf3 开始挂载
        await new Promise(r => setTimeout(r, 0));
        expect(leaf3.setViewState).toHaveBeenCalled();

        // 结算 leaf3
        resolve3();
        await new Promise(r => setTimeout(r, 0));
        expect(leaf3.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');
    });

    it('scheduleAuxiliaryMounts isolates failure in one view without blocking partner or following batch', async () => {
        let reject1!: (err: Error) => void;
        const p1 = new Promise<void>((_, reject) => { reject1 = reject; });
        let resolve2!: () => void;
        const p2 = new Promise<void>(resolve => { resolve2 = resolve; });
        let resolve3!: () => void;
        const p3 = new Promise<void>(resolve => { resolve3 = resolve; });

        const leaf1 = {
            setViewState: vi.fn().mockImplementation(() => p1),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        const leaf2 = {
            setViewState: vi.fn().mockImplementation(() => p2),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        const leaf3 = {
            setViewState: vi.fn().mockImplementation(() => p3),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;

        manager['createdImmersiveLeaves'].add(leaf1);
        manager['createdImmersiveLeaves'].add(leaf2);
        manager['createdImmersiveLeaves'].add(leaf3);

        const gen = 1;
        manager['layoutGeneration'] = gen;

        manager['scheduleAuxiliaryMounts']([
            { leaf: leaf1, viewType: 'view-1' },
            { leaf: leaf2, viewType: 'view-2' },
            { leaf: leaf3, viewType: 'view-3' }
        ], gen);

        await new Promise(r => setTimeout(r, 0));
        expect(leaf1.setViewState).toHaveBeenCalled();
        expect(leaf2.setViewState).toHaveBeenCalled();

        // 第一批中的 leaf1 挂载失败
        reject1(new Error('Leaf1 mount failed'));
        await new Promise(r => setTimeout(r, 0));
        expect(leaf1.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');

        // 同批次伙伴 leaf2 正常成功
        resolve2();
        await new Promise(r => setTimeout(r, 0));
        expect(leaf2.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');

        // 等待第二批前的 yield 完成，后续批次 leaf3 仍正常启动并成功
        await new Promise(r => setTimeout(r, 0));
        expect(leaf3.setViewState).toHaveBeenCalled();
        resolve3();
        await new Promise(r => setTimeout(r, 0));
        expect(leaf3.containerEl.classList.remove).toHaveBeenCalledWith('is-immersive-slot-pending');
    });

    it('scheduleAuxiliaryMounts aborts if exited or generation invalidated during yield', async () => {
        const auxLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        manager['createdImmersiveLeaves'].add(auxLeaf);

        const gen = 1;
        manager['layoutGeneration'] = gen;

        // 启动挂载任务
        manager['scheduleAuxiliaryMounts']([{ leaf: auxLeaf, viewType: 'immersive-chapter-list-view' }], gen);

        // 模拟在 yield 期间退出沉浸模式（代次变更与 isExiting）
        manager['layoutGeneration'] = 2;
        manager['isExiting'] = true;

        await new Promise(r => setTimeout(r, 0));
        expect(auxLeaf.setViewState).not.toHaveBeenCalled();
        expect(auxLeaf.containerEl.classList.remove).not.toHaveBeenCalledWith('is-immersive-slot-pending');
    });

    it('applySplitSizes clears fixed width/height/flex and applies percentage dimensions via unsetElSize and setDimension', async () => {
        const mockChild0 = {
            containerEl: {
                style: { width: '300px', height: '300px', flex: '0 0 auto' },
                setCssProps: vi.fn((props: Record<string, string>) => {
                    Object.assign(mockChild0.containerEl.style, props);
                })
            },
            size: 50,
            setDimension: vi.fn()
        };
        const mockChild1 = {
            containerEl: {
                style: { width: '700px', height: '700px', flex: '0 0 auto' },
                setCssProps: vi.fn((props: Record<string, string>) => {
                    Object.assign(mockChild1.containerEl.style, props);
                })
            },
            size: 50,
            setDimension: vi.fn()
        };
        const mockSplit = {
            direction: 'horizontal',
            containerEl: { offsetHeight: 1000, offsetWidth: 1000 },
            children: [mockChild0, mockChild1],
            unsetElSize: vi.fn((el: { style?: Record<string, string> }) => {
                if (el.style) {
                    el.style.width = '';
                    el.style.height = '';
                    el.style.flex = '';
                }
            }),
            setElSize: vi.fn()
        } as unknown as WorkspaceSplit;

        await manager['applySplitSizes']([{ split: mockSplit, sizes: [30, 70] }]);

        // 1. 验证调用 Obsidian 的 unsetElSize 与 setCssProps 清理临时尺寸
        expect(mockSplit.unsetElSize).toHaveBeenCalledWith(mockChild0.containerEl);
        expect(mockSplit.unsetElSize).toHaveBeenCalledWith(mockChild1.containerEl);
        expect(mockChild0.containerEl.setCssProps).toHaveBeenCalledWith({ width: '', height: '', flex: '' });
        expect(mockChild1.containerEl.setCssProps).toHaveBeenCalledWith({ width: '', height: '', flex: '' });

        // 2. 验证清除元素上的固定像素与 flex
        expect(mockChild0.containerEl.style.width).toBe('');
        expect(mockChild0.containerEl.style.height).toBe('');
        expect(mockChild0.containerEl.style.flex).toBe('');
        expect(mockChild1.containerEl.style.width).toBe('');
        expect(mockChild1.containerEl.style.height).toBe('');
        expect(mockChild1.containerEl.style.flex).toBe('');

        // 3. 验证采用 setDimension 原生百分比语义，不调用 setElSize 固定像素
        expect(mockChild0.setDimension).toHaveBeenCalledWith(30);
        expect(mockChild1.setDimension).toHaveBeenCalledWith(70);
        expect(mockChild0.size).toBe(30);
        expect(mockChild1.size).toBe(70);
        expect(mockSplit.setElSize).not.toHaveBeenCalled();
    });

    it('repeated applySplitSizes does not accumulate pixel sizes or leave fixed styles across runs', async () => {
        const mockChild0 = {
            containerEl: {
                style: { width: '', height: '', flex: '' },
                setCssProps: vi.fn((props: Record<string, string>) => {
                    Object.assign(mockChild0.containerEl.style, props);
                })
            },
            size: 50,
            setDimension: vi.fn()
        };
        const mockChild1 = {
            containerEl: {
                style: { width: '', height: '', flex: '' },
                setCssProps: vi.fn((props: Record<string, string>) => {
                    Object.assign(mockChild1.containerEl.style, props);
                })
            },
            size: 50,
            setDimension: vi.fn()
        };
        const mockSplit = {
            direction: 'horizontal',
            containerEl: { offsetHeight: 1000, offsetWidth: 1000 },
            children: [mockChild0, mockChild1],
            unsetElSize: vi.fn((el: { style?: Record<string, string> }) => {
                if (el.style) {
                    el.style.width = '';
                    el.style.height = '';
                    el.style.flex = '';
                }
            }),
            setElSize: vi.fn()
        } as unknown as WorkspaceSplit;

        // 模拟第 1 次进入沉浸模式应用 25%/75% 比例
        await manager['applySplitSizes']([{ split: mockSplit, sizes: [25, 75] }]);
        expect(mockChild0.setDimension).toHaveBeenLastCalledWith(25);
        expect(mockChild1.setDimension).toHaveBeenLastCalledWith(75);
        expect(mockChild0.containerEl.style.height).toBe('');

        // 模拟外部或拖拽在 DOM 上留下了临时固定像素
        mockChild0.containerEl.style.height = '250px';
        mockChild0.containerEl.style.flex = '0 0 auto';

        // 模拟第 2 次进入沉浸模式应用 20%/80% 比例
        await manager['applySplitSizes']([{ split: mockSplit, sizes: [20, 80] }]);
        expect(mockChild0.setDimension).toHaveBeenLastCalledWith(20);
        expect(mockChild1.setDimension).toHaveBeenLastCalledWith(80);
        expect(mockChild0.containerEl.style.height).toBe('');
        expect(mockChild0.containerEl.style.flex).toBe('');
        expect(mockSplit.setElSize).not.toHaveBeenCalled();
    });

    it('exitImmersiveMode cleans up body classes and triggers workspace.updateOptions and active cm dispatch', async () => {
        manager['isImmersiveActive'] = true;
        mockActiveDocument.body.classList.contains = vi.fn((cls: string) => cls === 'immersive-mode-active');

        const mockDispatch = vi.fn();
        const mockActiveView = {
            editor: {
                cm: { dispatch: mockDispatch }
            }
        };
        (mockPlugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(mockActiveView as unknown as MarkdownView);

        await manager.exitImmersiveMode();

        // 1. cleanup 移除沉浸模式与打字机类名、重置 CSS 变量
        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('immersive-mode-active');
        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('immersive-hide-properties');
        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('wn-typewriter-active');
        expect(mockActiveDocument.body.setCssProps).toHaveBeenCalledWith({ '--wn-typewriter-opacity': 'unset' });

        // 2. 等待 requestAnimationFrame 执行
        await new Promise(r => setTimeout(r, 0));

        // 3. 触发编辑器扩展刷新以重算普通模式打字机等设置
        expect(mockPlugin.app.workspace.updateOptions).toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalled();
        expect(manager['isImmersiveActive']).toBe(false);
    });

    it('cleanup standalone (destroy) does not trigger workspace.updateOptions', () => {
        manager.cleanup();

        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('immersive-mode-active');
        expect(mockPlugin.app.workspace.updateOptions).not.toHaveBeenCalled();
    });

    const createMockSplitLeaf = (
        direction: 'horizontal' | 'vertical',
        outerHeight: number,
        childHeight: number,
        internalChildren?: Array<{ offsetHeight: number; offsetWidth: number }>
    ): WorkspaceLeaf => {
        const leafContainerEl = { offsetParent: {}, classList: { add: vi.fn(), remove: vi.fn() } };
        const childContainerEl = {
            offsetHeight: childHeight,
            offsetWidth: 1000,
            contains: (el: unknown) => el === leafContainerEl
        };
        const outerSplit = {
            direction,
            containerEl: { offsetHeight: outerHeight, offsetWidth: 1000 },
            children: [{ containerEl: childContainerEl }]
        };

        if (internalChildren && internalChildren.length > 0) {
            const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
            const internalSplit = {
                direction: internalDir,
                parent: outerSplit,
                containerEl: { offsetHeight: childHeight, offsetWidth: 1000 },
                children: internalChildren.map(c => ({ containerEl: c }))
            };
            return { parent: internalSplit, containerEl: leafContainerEl } as unknown as WorkspaceLeaf;
        }

        return { parent: outerSplit, containerEl: leafContainerEl } as unknown as WorkspaceLeaf;
    };

    it('ordinary exit does not mutate configured top size with transient DOM measurements', async () => {
        mockPlugin.settings.immersive.immersiveTopSize = 25;
        manager['isImmersiveActive'] = true;
        (mockActiveDocument.body.classList.contains as unknown as ReturnType<typeof vi.fn>).mockImplementation((cls: string) => cls === 'immersive-mode-active');

        // 直接挂载具有 35% 瞬态 DOM 高度的 activeTopLeaf，验证退出不执行 saveCurrentPanelSizes
        manager['activeTopLeaf'] = createMockSplitLeaf('horizontal', 1000, 350);

        await manager.exitImmersiveMode();

        expect(mockPlugin.settings.immersive.immersiveTopSize).toBe(25);
    });

    it('actual resize-handle gesture saves final outer and internal proportions', () => {
        mockPlugin.settings.immersive.immersiveTopSize = 20;
        mockPlugin.settings.immersive.immersiveTopSlots = ['slot1', 'slot2'];
        mockPlugin.settings.immersive.immersiveTopInternalSizes = [50, 50];

        manager['activeTopLeaf'] = createMockSplitLeaf('horizontal', 1000, 350, [
            { offsetHeight: 350, offsetWidth: 400 },
            { offsetHeight: 350, offsetWidth: 600 }
        ]);
        manager['isImmersiveActive'] = true;
        (mockActiveDocument.body.classList.contains as unknown as ReturnType<typeof vi.fn>).mockImplementation((cls: string) => cls === 'immersive-mode-active');
        manager['registerImmersiveEventListeners']();

        const saveSettingsSpy = mockPlugin.saveSettings as unknown as ReturnType<typeof vi.fn>;
        saveSettingsSpy.mockClear();

        // 1. 用户按住分屏调节手柄
        const mockHandleEl = {
            classList: { contains: (cls: string) => cls === 'workspace-leaf-resize-handle' },
            closest: (sel: string) => sel === '.workspace-leaf-resize-handle' ? (mockHandleEl as unknown as Element) : null
        } as unknown as Element;
        registeredEvents['pointerdown'][0]({ target: mockHandleEl } as unknown as PointerEvent);

        // 2. 用户释放拖拽
        registeredEvents['pointerup'][0]({} as unknown as PointerEvent);

        // 验证：外层与内部比例均被正确测量并保存
        expect(mockPlugin.settings.immersive.immersiveTopSize).toBe(35);
        expect(mockPlugin.settings.immersive.immersiveTopInternalSizes).toEqual([40, 60]);
        expect(saveSettingsSpy).toHaveBeenCalled();
    });

    it('non-handle gestures do not mutate configured sizes or persist settings', () => {
        mockPlugin.settings.immersive.immersiveTopSize = 35;
        const saveSettingsSpy = mockPlugin.saveSettings as unknown as ReturnType<typeof vi.fn>;
        saveSettingsSpy.mockClear();

        manager['isImmersiveActive'] = true;
        (mockActiveDocument.body.classList.contains as unknown as ReturnType<typeof vi.fn>).mockImplementation((cls: string) => cls === 'immersive-mode-active');
        manager['registerImmersiveEventListeners']();

        // 模拟点击编辑器普通元素（非调节手柄）
        const mockEditorEl = {
            classList: { contains: () => false },
            closest: () => null
        } as unknown as Element;
        registeredEvents['pointerdown'][0]({ target: mockEditorEl } as unknown as PointerEvent);
        registeredEvents['pointerup'][0]({} as unknown as PointerEvent);

        expect(mockPlugin.settings.immersive.immersiveTopSize).toBe(35);
        expect(saveSettingsSpy).not.toHaveBeenCalled();
    });
});
