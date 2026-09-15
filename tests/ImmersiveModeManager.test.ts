import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { App, TFile, WorkspaceLeaf, WorkspaceSplit, MarkdownView } from 'obsidian';
import { ImmersiveModeManager, type ImmersiveModeManagerPlugin } from '../src/ui/ImmersiveModeManager';
import { ImmersivePomodoroModal } from '../src/ui/ImmersivePomodoroModal';

vi.mock('obsidian', () => {
	type MockElement = {
		empty: ReturnType<typeof vi.fn>;
		addClass: ReturnType<typeof vi.fn>;
		removeClass: ReturnType<typeof vi.fn>;
		createDiv: ReturnType<typeof vi.fn>;
		createSpan: ReturnType<typeof vi.fn>;
		createEl: ReturnType<typeof vi.fn>;
		appendChild: ReturnType<typeof vi.fn>;
		textContent?: string;
	};
	type MockButton = {
		setButtonText: ReturnType<typeof vi.fn>;
		setCta: ReturnType<typeof vi.fn>;
		onClick: ReturnType<typeof vi.fn>;
		_onClick?: () => void;
	};
	const createMockElement = (): MockElement => {
		const el: MockElement = {
			empty: vi.fn(),
			addClass: vi.fn().mockReturnThis(),
			removeClass: vi.fn().mockReturnThis(),
			createDiv: vi.fn(() => createMockElement()),
			createSpan: vi.fn((opts?: { cls?: string; text?: string }) => {
				const span = createMockElement();
				if (opts?.text !== undefined) span.textContent = opts.text;
				return span;
			}),
			createEl: vi.fn(() => createMockElement()),
			appendChild: vi.fn(),
			textContent: ''
		};
		return el;
	};
    class MockModal {
		app: unknown;
		contentEl: MockElement;
		modalEl: MockElement;
		constructor(app: unknown) {
            this.app = app;
            this.contentEl = createMockElement();
            this.modalEl = createMockElement();
        }
        open() {
			(this as unknown as { onOpen?: () => void }).onOpen?.();
        }
        close() {
			(this as unknown as { onClose?: () => void }).onClose?.();
        }
    }

    class MockSetting {
		controlEl: MockElement;
		constructor(public containerEl: unknown) {
			this.controlEl = createMockElement();
		}
        setName() { return this; }
        setDesc() { return this; }
        setHeading() { return this; }
		addButton(cb: (button: MockButton) => unknown) {
			const btn: MockButton = {
                setButtonText: vi.fn().mockReturnThis(),
                setCta: vi.fn().mockReturnThis(),
                onClick: vi.fn((fn: () => void) => {
					btn._onClick = fn;
                    return btn;
                })
			};
			cb(btn);
			return this;
		}
	}

	return {
		Notice: vi.fn(),
		MarkdownView: class {},
		TFile: class {},
        TFolder: class {},
        Modal: MockModal,
        Setting: MockSetting,
        ToggleComponent: class {
            setValue() { return this; }
            setTooltip() { return this; }
            onChange() { return this; }
        }
    };
});

describe('ImmersiveModeManager - Fullscreen & Esc Block', () => {
    let mockPlugin: ImmersiveModeManagerPlugin;
    let manager: ImmersiveModeManager;
    let registeredEvents: Record<string, Function[]> = {};
    let mockActiveDocument: any;

    beforeEach(() => {
        registeredEvents = {};
		type MockDomElement = {
			className: string;
			style: Record<string, unknown>;
			classList: {
				add: ReturnType<typeof vi.fn>;
				remove: ReturnType<typeof vi.fn>;
				contains: ReturnType<typeof vi.fn>;
			};
			setCssProps: ReturnType<typeof vi.fn>;
			show: ReturnType<typeof vi.fn>;
			hide: ReturnType<typeof vi.fn>;
			isShown: ReturnType<typeof vi.fn>;
			empty: ReturnType<typeof vi.fn>;
			remove: ReturnType<typeof vi.fn>;
			addEventListener: ReturnType<typeof vi.fn>;
			removeEventListener: ReturnType<typeof vi.fn>;
			appendChild: ReturnType<typeof vi.fn>;
			createDiv: ReturnType<typeof vi.fn>;
			createSpan: ReturnType<typeof vi.fn>;
			createEl: ReturnType<typeof vi.fn>;
			innerText: string;
			readonly textAssignCount: number;
		};
		const createMockDOMElement = (cls = ''): MockDomElement => {
            let isVisible = true;
            let text = '';
            let textAssignCount = 0;
			const element = {
                className: cls,
                style: {},
                classList: {
                    add: vi.fn(),
                    remove: vi.fn(),
                    contains: vi.fn().mockReturnValue(false)
                },
                setCssProps: vi.fn(),
                show: vi.fn(() => { isVisible = true; }),
                hide: vi.fn(() => { isVisible = false; }),
                isShown: vi.fn(() => isVisible),
                empty: vi.fn(),
                remove: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                appendChild: vi.fn(),
				createDiv: vi.fn((opts?: { cls?: string }) => createMockDOMElement(opts?.cls || '')),
				createSpan: vi.fn((opts?: { cls?: string }) => createMockDOMElement(opts?.cls || '')),
				createEl: vi.fn((_tag: string, opts?: { cls?: string }) => createMockDOMElement(opts?.cls || ''))
			} as unknown as MockDomElement;
            Object.defineProperty(element, 'innerText', {
                get: () => text,
                set: (val: string) => {
                    text = val;
                    textAssignCount++;
                }
            });
            Object.defineProperty(element, 'textAssignCount', {
                get: () => textAssignCount
            });
            return element;
        };

		const domGlobals = globalThis as unknown as {
			createDiv: (opts?: { cls?: string }) => MockDomElement;
			createSpan: (opts?: { cls?: string }) => MockDomElement;
		};
		domGlobals.createDiv = (opts) => createMockDOMElement(opts?.cls || '');
		domGlobals.createSpan = (opts) => createMockDOMElement(opts?.cls || '');

        mockActiveDocument = {
            body: createMockDOMElement('body'),
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
                    trigger: vi.fn(),
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
                    getAbstractFileByPath: vi.fn().mockReturnValue(null),
                    cachedRead: vi.fn().mockResolvedValue('')
                },
                commands: { executeCommandById: vi.fn() }
            },
            adaptiveDebounceManager: {
                debounceFixed: vi.fn()
            },
            statisticsManager: {
                getCoreStats: vi.fn().mockReturnValue({
                    totalTime: '01:00:00',
                    focusTime: '00:50:00',
                    slackTime: '00:10:00',
                    todayWords: 100,
                    goal: 3000,
                    dailyWords: 500,
                    dailyGoal: 5000,
                    sessionWords: 50
                })
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
                    typewriterEnabled: false,
                    immersiveShowCurrentTime: false,
                    pomodoroEnabled: false,
                    pomodoroInterval: 30
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

    it('notifies the chapter list after the restored reference view finishes mounting', async () => {
        const referenceLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        const chapterListLeaf = {
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: { classList: { add: vi.fn(), remove: vi.fn() } }
        } as unknown as WorkspaceLeaf;
        manager['createdImmersiveLeaves'].add(referenceLeaf);
        manager['createdImmersiveLeaves'].add(chapterListLeaf);
        mockPlugin.settings.immersive.lastReferenceFilePath = 'Book/Reference.md';

        const gen = 1;
        manager['layoutGeneration'] = gen;
        manager['scheduleAuxiliaryMounts']([
            { leaf: referenceLeaf, viewType: 'reference-view' },
            { leaf: chapterListLeaf, viewType: 'immersive-chapter-list-view' }
        ], gen);

        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));

        expect(referenceLeaf.setViewState).toHaveBeenCalledWith({
            type: 'markdown',
            state: { mode: 'preview', file: 'Book/Reference.md' }
        });
        expect(mockPlugin.app.workspace.trigger).toHaveBeenCalledWith('webnovel:immersive-reference-ready');
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

    describe('Pomodoro Reminder & Current Time Dashboard', () => {
        const createMockMainLeaf = (editorFocus = vi.fn()) => ({
            view: {
                editor: { focus: editorFocus, cm: { dispatch: vi.fn() } }
            },
            containerEl: {
                classList: {
                    add: vi.fn(),
                    remove: vi.fn(),
                    contains: vi.fn((cls: string) => cls === 'immersive-main-editor')
                },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            },
            setViewState: vi.fn().mockResolvedValue(undefined),
            getViewState: vi.fn().mockReturnValue({ type: 'markdown', state: { file: 'Book/Chapter1.md', mode: 'source' } })
        });

        it('starts first round automatically when Pomodoro is enabled upon entering immersive mode', async () => {
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            mockPlugin.settings.immersive.pomodoroInterval = 45;

            const baseTime = 1_700_000_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(baseTime);

            const mockFile = { path: 'Book/Chapter1.md', basename: 'Chapter1', parent: { isRoot: () => true } } as unknown as TFile;
            (mockPlugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue({
                file: mockFile,
                editor: { cm: { dispatch: vi.fn() } }
            });

            await manager['enterImmersiveMode']();

            expect(manager['isImmersiveActive']).toBe(true);
            expect(manager['pomodoroDeadline']).toBe(baseTime + 45 * 60 * 1000);
            expect(manager['isPomodoroDismissed']).toBe(false);

            manager.cleanup();
        });

        it('shows reminder modal only once when deadline expires and does not duplicate', () => {
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            mockPlugin.settings.immersive.pomodoroInterval = 30;
            manager['isImmersiveActive'] = true;

            const baseTime = 1_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(baseTime);
            manager['startPomodoroRound']();

            const deadline = baseTime + 30 * 60 * 1000;
            expect(manager['pomodoroDeadline']).toBe(deadline);

            // Advance to deadline
            vi.spyOn(Date, 'now').mockReturnValue(deadline);
            manager['checkPomodoroReminder']();

            const activeModal = manager['activePomodoroModal'];
            expect(activeModal).not.toBeNull();
            expect(manager['pomodoroDeadline']).toBeNull();

            // Advance further and check again on subsequent ticks: must not duplicate
            vi.spyOn(Date, 'now').mockReturnValue(deadline + 5000);
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).toBe(activeModal);

            manager.cleanup();
        });

        it('suppresses further reminders for the current session when user dismisses or closes implicitly', () => {
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            manager['isImmersiveActive'] = true;

            const mockEditorFocus = vi.fn();
            const mockMainLeaf = createMockMainLeaf(mockEditorFocus);
            (mockPlugin.app.workspace.getLeavesOfType as ReturnType<typeof vi.fn>).mockReturnValue([mockMainLeaf]);
            manager['activeMainLeaf'] = mockMainLeaf as unknown as WorkspaceLeaf;

            const baseTime = 1_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(baseTime);
            manager['startPomodoroRound']();

            // Trigger reminder
            vi.spyOn(Date, 'now').mockReturnValue(baseTime + 30 * 60 * 1000);
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).not.toBeNull();

            // User closes modal via any mechanism other than "开启下一轮" (defaults to dismiss and restores focus)
            manager['activePomodoroModal']!.close();

            expect(manager['activePomodoroModal']).toBeNull();
            expect(manager['isPomodoroDismissed']).toBe(true);
            expect(manager['pomodoroDeadline']).toBeNull();
            expect(mockEditorFocus).toHaveBeenCalled();

            // Advance time: no more reminders should trigger during this session
            vi.spyOn(Date, 'now').mockReturnValue(baseTime + 120 * 60 * 1000);
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).toBeNull();

            manager.cleanup();
        });

        it('starts next round using click time and can remind once again', () => {
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            mockPlugin.settings.immersive.pomodoroInterval = 30;
            manager['isImmersiveActive'] = true;

            const baseTime = 1_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(baseTime);
            manager['startPomodoroRound']();

            // Round 1 expiry at t = 1,000,000 + 1,800,000 = 2,800,000
            const expiryTime = baseTime + 30 * 60 * 1000;
            vi.spyOn(Date, 'now').mockReturnValue(expiryTime);
            manager['checkPomodoroReminder']();
            const modal = manager['activePomodoroModal']!;
            expect(modal).not.toBeNull();

            // User pauses/rests until clickTime = 3,500,000 before clicking "开启下一轮"
            const clickTime = 3_500_000;
            vi.spyOn(Date, 'now').mockReturnValue(clickTime);
			(modal as unknown as { actionTaken: 'next' | 'dismiss' | null }).actionTaken = 'next';
            modal.close();

            expect(manager['activePomodoroModal']).toBeNull();
            expect(manager['isPomodoroDismissed']).toBe(false);
            // Next deadline must be based on clickTime, not the previous expiry time
            const expectedNextDeadline = clickTime + 30 * 60 * 1000;
            expect(manager['pomodoroDeadline']).toBe(expectedNextDeadline);

            // Before next deadline: no reminder
            vi.spyOn(Date, 'now').mockReturnValue(expectedNextDeadline - 1000);
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).toBeNull();

            // At next deadline: reminds once
            vi.spyOn(Date, 'now').mockReturnValue(expectedNextDeadline);
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).not.toBeNull();

            manager.cleanup();
        });

        it('handles time jumps correctly when execution is suspended or sleep occurs', () => {
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            mockPlugin.settings.immersive.pomodoroInterval = 30;
            manager['isImmersiveActive'] = true;

            const startTime = 10_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(startTime);
            manager['startPomodoroRound']();

            // Sleep/suspend for 3 hours, jump forward
            const wakeTime = startTime + 3 * 3600 * 1000;
            vi.spyOn(Date, 'now').mockReturnValue(wakeTime);

            // On wake resume, checkPomodoroReminder fires once
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).not.toBeNull();
            expect(manager['pomodoroDeadline']).toBeNull();

            // Subsequent ticks after resume do not fire again
            vi.spyOn(Date, 'now').mockReturnValue(wakeTime + 1000);
            manager['checkPomodoroReminder']();
            expect(manager['pomodoroDeadline']).toBeNull();

            manager.cleanup();
        });

        it('silent cleanup cancels runtime state, closes open modal without starting another round or restoring focus', async () => {
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            manager['isImmersiveActive'] = true;

            const mockEditorFocus = vi.fn();
            const mockMainLeaf = createMockMainLeaf(mockEditorFocus);
            (mockPlugin.app.workspace.getLeavesOfType as ReturnType<typeof vi.fn>).mockReturnValue([mockMainLeaf]);
            manager['activeMainLeaf'] = mockMainLeaf as unknown as WorkspaceLeaf;

            manager['startPomodoroRound']();
            vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000);
            manager['checkPomodoroReminder']();

            const openModal = manager['activePomodoroModal'];
            expect(openModal).not.toBeNull();
            const modalCloseSpy = vi.spyOn(openModal!, 'close');

            // Silent cleanup: closes modal without triggering user dismiss choice and without restoring editor focus
            manager.cleanup();

            expect(modalCloseSpy).toHaveBeenCalled();
            expect(mockEditorFocus).not.toHaveBeenCalled();
            expect(manager['activePomodoroModal']).toBeNull();
            expect(manager['pomodoroDeadline']).toBeNull();
            expect(manager['isPomodoroDismissed']).toBe(false);
            expect(manager['isImmersiveActive']).toBe(false);

            // Re-entering immersive mode starts a fresh first round
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            mockPlugin.settings.immersive.pomodoroInterval = 30;
            const freshStartTime = 20_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(freshStartTime);

            const mockFile = { path: 'Book/Chapter1.md', basename: 'Chapter1', parent: { isRoot: () => true } } as unknown as TFile;
            (mockPlugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue({
                file: mockFile,
                editor: { cm: { dispatch: vi.fn() } }
            });

            await manager['enterImmersiveMode']();
            expect(manager['pomodoroDeadline']).toBe(freshStartTime + 30 * 60 * 1000);
            expect(manager['isPomodoroDismissed']).toBe(false);

            manager.cleanup();
        });

        it('executes pomodoro expiry check on top-bar tick even if task reading fails', async () => {
            manager['createTopBar']();
            mockPlugin.settings.immersive.pomodoroEnabled = true;
            mockPlugin.settings.immersive.immersiveShowTaskProgress = true;
            manager['isImmersiveActive'] = true;
            mockPlugin.lastTaskFolder = 'Book';
			(mockPlugin as unknown as { taskManager: ImmersiveModeManagerPlugin['taskManager'] }).taskManager = {
                getTaskFile: vi.fn().mockReturnValue({ path: 'tasks.json' }),
                parseEntries: vi.fn(),
                getActiveTask: vi.fn(),
                calcProgress: vi.fn()
            };
			(mockPlugin.app.vault as unknown as { cachedRead: ReturnType<typeof vi.fn> }).cachedRead = vi.fn().mockRejectedValue(new Error('task read failed'));

            const baseTime = 1_000_000;
            vi.spyOn(Date, 'now').mockReturnValue(baseTime);
            manager['startPomodoroRound']();

            // Advance to expiry
            vi.spyOn(Date, 'now').mockReturnValue(baseTime + 30 * 60 * 1000);
            await manager['renderTopBarContent']();

            expect(manager['activePomodoroModal']).not.toBeNull();
            manager.cleanup();
        });

        it('renders current-time item only when enabled and only updates DOM text when changed', async () => {
            manager['createTopBar']();
			const currentTimeEl = manager['topBarStatsEls'].currentTime as HTMLElement & { textAssignCount: number };
            expect(currentTimeEl).toBeDefined();

            // Default: disabled -> hidden
            mockPlugin.settings.immersive.immersiveShowCurrentTime = false;
            await manager['renderTopBarContent']();
            expect(currentTimeEl.isShown()).toBe(false);

            // Enable current time
            mockPlugin.settings.immersive.immersiveShowCurrentTime = true;
			vi.spyOn(manager as unknown as { formatCurrentTime: (date?: Date) => string }, 'formatCurrentTime').mockReturnValue('14:30:15');

            await manager['renderTopBarContent']();
            expect(currentTimeEl.isShown()).toBe(true);
			expect(currentTimeEl.innerText).toBe('14:30:15');
            expect(currentTimeEl.textAssignCount).toBe(1);

			// Subsequent call in the same second with same text: DOM text must NOT be reassigned
            await manager['renderTopBarContent']();
            expect(currentTimeEl.textAssignCount).toBe(1);

			// Next second: DOM text updates
			vi.spyOn(manager as unknown as { formatCurrentTime: (date?: Date) => string }, 'formatCurrentTime').mockReturnValue('14:30:16');
            await manager['renderTopBarContent']();
			expect(currentTimeEl.innerText).toBe('14:30:16');
            expect(currentTimeEl.textAssignCount).toBe(2);

            manager.cleanup();
        });
    });

    describe('ImmersivePomodoroModal - Elapsed Rest Timer', () => {
		let mockApp: App;

        beforeEach(() => {
            vi.useFakeTimers();
			const timerWindow = window as unknown as {
				setInterval: (handler: () => void, timeout?: number) => ReturnType<typeof globalThis.setInterval>;
				clearInterval: (id: ReturnType<typeof globalThis.setInterval>) => void;
			};
			timerWindow.setInterval = (fn, ms) => globalThis.setInterval(fn, ms);
			timerWindow.clearInterval = (id) => globalThis.clearInterval(id);
			mockApp = {
                workspace: {
                    getLeavesOfType: vi.fn().mockReturnValue([])
                }
			} as unknown as App;
			vi.spyOn(window, 'clearInterval');
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('initializes with 00:00:00 when reminder modal opens and starts interval timer', () => {
            const baseTime = 1_000_000;
            vi.setSystemTime(baseTime);

            const modal = new ImmersivePomodoroModal(mockApp, {
                onNextRound: vi.fn(),
                onDismiss: vi.fn()
            });

            modal.open();

			const timerEl = modal['timerEl'];
            expect(timerEl).not.toBeNull();
            expect(timerEl?.textContent).toBe('00:00:00');

            modal.close();
        });

        it('renders absolute time jumps correctly without accumulated drift', () => {
            const baseTime = 1_000_000;
            vi.setSystemTime(baseTime);

            const modal = new ImmersivePomodoroModal(mockApp, {
                onNextRound: vi.fn(),
                onDismiss: vi.fn()
            });

            modal.open();
			const timerEl = modal['timerEl']!;
            expect(timerEl.textContent).toBe('00:00:00');

            // Simulate jump forward by 65 seconds (sleep / time jump)
            vi.setSystemTime(baseTime + 65_000);
            vi.advanceTimersByTime(1000);
            // 65s + 1s tick = 66s = 00:01:06
            expect(timerEl.textContent).toBe('00:01:06');

            // Simulate jump forward by another 3600 seconds (1 hour)
            vi.setSystemTime(baseTime + 65_000 + 3600_000);
            vi.advanceTimersByTime(1000);
            // 3665s + 1s tick = 3666s = 01:01:06
            expect(timerEl.textContent).toBe('01:01:06');

            modal.close();
        });

        it('clears and stops timer on ordinary close paths without firing callbacks after close', () => {
            const baseTime = 1_000_000;
            vi.setSystemTime(baseTime);

            const onNextRound = vi.fn();
            const onDismiss = vi.fn();
            const onClose = vi.fn();

            const modal = new ImmersivePomodoroModal(mockApp, {
                onNextRound,
                onDismiss,
                onClose
            });

            modal.open();
			const timerEl = modal['timerEl']!;
            expect(timerEl.textContent).toBe('00:00:00');

            // User closes modal (defaults to dismiss)
            modal.close();

			expect(window.clearInterval).toHaveBeenCalled();
            expect(onDismiss).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);

            // Timer should no longer tick or update DOM
            vi.setSystemTime(baseTime + 10_000);
            vi.advanceTimersByTime(5000);
			expect(modal['timerEl']).toBeNull();
            expect(onDismiss).toHaveBeenCalledTimes(1);
        });

        it('clears and stops timer on silent close and dispose without triggering user callbacks', () => {
            const baseTime = 1_000_000;
            vi.setSystemTime(baseTime);

            const onNextRound = vi.fn();
            const onDismiss = vi.fn();
            const onClose = vi.fn();

            const modal = new ImmersivePomodoroModal(mockApp, {
                onNextRound,
                onDismiss,
                onClose
            });

            modal.open();
			expect(modal['timerEl']?.textContent).toBe('00:00:00');

            // Silent dispose/close
            modal.dispose();

			expect(window.clearInterval).toHaveBeenCalled();
            expect(onDismiss).not.toHaveBeenCalled();
            expect(onNextRound).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();

            // Subsequent time advances do not cause updates or callbacks
            vi.setSystemTime(baseTime + 100_000);
            vi.advanceTimersByTime(5000);
            expect(onDismiss).not.toHaveBeenCalled();
            expect(onNextRound).not.toHaveBeenCalled();
        });

        it('uses modal owner document/window when available', () => {
            const baseTime = 1_000_000;
            vi.setSystemTime(baseTime);

            const customWin = {
                setInterval: vi.fn((fn: () => void) => window.setInterval(fn, 1000)),
                clearInterval: vi.fn((id: number) => window.clearInterval(id))
            };

            const modal = new ImmersivePomodoroModal(mockApp, {
                onNextRound: vi.fn(),
                onDismiss: vi.fn()
            });

            (modal.contentEl as unknown as { ownerDocument: { defaultView: typeof customWin } }).ownerDocument = {
                defaultView: customWin
            };

            modal.open();
            expect(customWin.setInterval).toHaveBeenCalled();

            modal.close();
            expect(customWin.clearInterval).toHaveBeenCalled();
        });
    });
});
