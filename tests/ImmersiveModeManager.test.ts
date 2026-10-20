import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, type App, type WorkspaceLeaf, type WorkspaceSplit, type WorkspaceItem, type MarkdownView } from 'obsidian';
import { ImmersiveModeManager, type ImmersiveModeManagerPlugin } from '../src/ui/ImmersiveModeManager';
import { ImmersiveReferenceManager } from '../src/services/ImmersiveReferenceManager';
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
		containerEl: MockElement;
		contentEl: MockElement;
		modalEl: MockElement;
		constructor(app: unknown) {
            this.app = app;
            this.containerEl = createMockElement();
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
		addSlider(cb: (slider: Record<'setLimits' | 'setValue' | 'setDynamicTooltip' | 'onChange', ReturnType<typeof vi.fn>>) => unknown) {
			const slider = {
				setLimits: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				setDynamicTooltip: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis()
			};
			cb(slider);
			return this;
		}
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
		setIcon: vi.fn(),
		MarkdownView: class {},
        View: class {},
		TFile: class {},
        TFolder: class {},
        Modal: MockModal,
        FuzzySuggestModal: MockModal,
        Setting: MockSetting,
        ToggleComponent: class {
            _value = false;
            _onChange?: (v: boolean) => Promise<void> | void;
            setValue(v: boolean) { this._value = v; return this; }
            getValue() { return this._value; }
            setTooltip() { return this; }
            onChange(cb: (v: boolean) => Promise<void> | void) { this._onChange = cb; return this; }
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
                setAttribute: vi.fn(),
                removeAttribute: vi.fn(),
                getAttribute: vi.fn(),
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
            createElement: vi.fn((tag: string) => createMockDOMElement(tag)),
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

        mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
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
        (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
            if (path === 'Book/Reference.md') {
                return Object.assign(new TFile(), { path: 'Book/Reference.md', extension: 'md' });
            }
            return null;
        });

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
                loadEntries: vi.fn().mockRejectedValue(new Error('task read failed')),
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

    describe('Reference Pane Lifecycle, Search & Sequence Guards', () => {
        let setReferenceFilePathSpy: ReturnType<typeof vi.fn>;
        type MockRefService = Pick<
            ImmersiveReferenceManager,
            'getWorkPath' | 'getReferenceFilePath' | 'migrateLegacyReference' | 'setReferenceFilePath' | 'handleRename' | 'handleDelete' | 'save' | 'flush' | 'destroy'
        >;

        beforeEach(() => {
            setReferenceFilePathSpy = vi.fn().mockResolvedValue(undefined);
            const mockRefService: MockRefService = {
                getWorkPath: vi.fn((file: TFile | null) => {
                    if (!file) return '';
                    if (file.path.startsWith('Novels/BookB')) return 'Novels/BookB';
                    if (file.path.startsWith('Novels/BookC')) return 'Novels/BookC';
                    return 'Novels/BookA';
                }),
                getReferenceFilePath: vi.fn((work: string) => {
                    if (work === 'Novels/BookB') return 'Novels/BookB/RefB.md';
                    if (work === 'Novels/BookC') return 'Novels/BookC/RefC.md';
                    return 'Novels/BookA/RefA.md';
                }),
                migrateLegacyReference: vi.fn(),
                setReferenceFilePath: setReferenceFilePathSpy,
                handleRename: vi.fn(),
                handleDelete: vi.fn(),
                save: vi.fn(),
                flush: vi.fn().mockResolvedValue(undefined),
                destroy: vi.fn()
            };
            manager['referenceManager'] = mockRefService;
            manager['savedActiveFile'] = Object.assign(new TFile(), { path: 'Novels/BookA/Chapter1.md', extension: 'md' });
            manager['isImmersiveActive'] = true;
            manager['isExiting'] = false;
        });

        it('rapid A/B switches: serializes native leaf operations and ensures latest file B is displayed in leaf.view.file even when A resolves late', async () => {
            let resolveA!: () => void;
            const pA = new Promise<void>(resolve => { resolveA = resolve; });

            const mockFileA = Object.assign(new TFile(), { path: 'Novels/BookA/RefA.md', extension: 'md' });
            const mockFileB = Object.assign(new TFile(), { path: 'Novels/BookA/RefB.md', extension: 'md' });

            (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
                if (path === mockFileA.path) return mockFileA;
                if (path === mockFileB.path) return mockFileB;
                return null;
            });

            const refLeafView = { file: null as TFile | null, getViewType: () => 'markdown' };
            const refLeaf = {
                view: refLeafView,
                openFile: vi.fn().mockImplementation(async (file: TFile) => {
                    if (file.path === mockFileA.path) {
                        await pA;
                    }
                    refLeafView.file = file;
                }),
                containerEl: {
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'immersive-reference-view' },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn().mockReturnValue(null),
                    createDiv: vi.fn(() => ({
                        createEl: vi.fn(() => ({
                            addEventListener: vi.fn(),
                            removeEventListener: vi.fn(),
                            setAttribute: vi.fn()
                        })),
                        remove: vi.fn()
                    }))
                }
            } as unknown as WorkspaceLeaf;

            manager['createdImmersiveLeaves'].add(refLeaf);

            // 1. Trigger switch to File A (pending)
            const openPromiseA = manager.openReferenceFile(mockFileA, refLeaf);
            await vi.waitFor(() => expect(refLeaf.openFile).toHaveBeenCalledWith(mockFileA, expect.anything()));

            // 2. Rapidly trigger switch to File B before File A finishes
            const openPromiseB = manager.openReferenceFile(mockFileB, refLeaf);
            resolveA();
            await Promise.all([openPromiseA, openPromiseB]);

            // B finishes, displays B and persists B
            expect(refLeafView.file).toBe(mockFileB);
            expect(setReferenceFilePathSpy).toHaveBeenCalledWith('Novels/BookA', 'Novels/BookA/RefB.md');
            setReferenceFilePathSpy.mockClear();

            // 3. Stale File A finally resolves
            resolveA();
            await openPromiseA;

            // Stale File A must NOT overwrite File B in view.file or settings
            expect(refLeafView.file).toBe(mockFileB);
            expect(setReferenceFilePathSpy).not.toHaveBeenCalled();
        });

        it('queues manual reference switching behind an unfinished initial restoration', async () => {
            let finishRestore!: () => void;
            const restoring = new Promise<void>(resolve => { finishRestore = resolve; });
            const oldFile = Object.assign(new TFile(), { path: 'Novels/BookA/RefA.md', extension: 'md' });
            const newFile = Object.assign(new TFile(), { path: 'Novels/BookA/RefB.md', extension: 'md' });
            const view = { file: null as TFile | null, getViewType: () => 'markdown' };
            const leaf = {
                view,
                containerEl: { classList: { contains: () => true, add: vi.fn(), remove: vi.fn() } },
                setViewState: vi.fn(async () => { await restoring; view.file = oldFile; }),
                openFile: vi.fn(async (file: TFile) => { view.file = file; })
            } as unknown as WorkspaceLeaf;
            vi.mocked(mockPlugin.app.vault.getAbstractFileByPath).mockImplementation(path => path === newFile.path ? newFile : oldFile);
            vi.spyOn(manager, 'attachReferenceToolbar').mockImplementation(() => {});
            vi.spyOn(manager as unknown as { yieldToMain: () => Promise<void> }, 'yieldToMain').mockResolvedValue();
            manager['createdImmersiveLeaves'].add(leaf);
            manager['layoutGeneration'] = 1;
            manager['scheduleAuxiliaryMounts']([{ leaf, viewType: 'reference-view' }], 1);
            await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalled());
            const opening = manager.openReferenceFile(newFile, leaf);
            await Promise.resolve();
            expect(leaf.openFile).not.toHaveBeenCalled();
            finishRestore();
            await opening;
            expect(view.file).toBe(newFile);
        });

        it('captures main work at request time so main file transitions during openFile do not map reference to wrong work', async () => {
            let resolveA!: () => void;
            const pA = new Promise<void>(resolve => { resolveA = resolve; });

            const mockRefA = Object.assign(new TFile(), { path: 'Novels/BookA/RefA.md', extension: 'md' });
            (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(mockRefA);

            const mainFileA = Object.assign(new TFile(), { path: 'Novels/BookA/Chapter1.md' });
            const mainFileB = Object.assign(new TFile(), { path: 'Novels/BookB/Chapter1.md' });

            let currentMainFile = mainFileA;
            manager['getMainEditorFile'] = vi.fn(() => currentMainFile);

            const refLeafView = { file: null as TFile | null, getViewType: () => 'markdown' };
            const refLeaf = {
                view: refLeafView,
                openFile: vi.fn().mockImplementation(async (file: TFile) => {
                    await pA;
                    refLeafView.file = file;
                }),
                containerEl: {
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'immersive-reference-view' },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn().mockReturnValue(null),
                    createDiv: vi.fn(() => ({
                        createEl: vi.fn(() => ({
                            addEventListener: vi.fn(),
                            removeEventListener: vi.fn(),
                            setAttribute: vi.fn()
                        })),
                        remove: vi.fn()
                    }))
                }
            } as unknown as WorkspaceLeaf;

            manager['createdImmersiveLeaves'].add(refLeaf);

            // Request open while main editor is on BookA
            const openPromise = manager.openReferenceFile(mockRefA, refLeaf);

            // Main editor switches to BookB while RefA is opening
            currentMainFile = mainFileB;

            resolveA();
            await openPromise;

            // Must be saved under BookA (request time work), NOT BookB
            expect(setReferenceFilePathSpy).toHaveBeenCalledWith('Novels/BookA', 'Novels/BookA/RefA.md');
        });

        it('openReferenceFile handles native openFile rejection gracefully with Notice and preserves focus', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'Novels/BookA/Corrupt.md', extension: 'md' });
            (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(mockFile);

            const refLeaf = {
                openFile: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
                containerEl: {
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'immersive-reference-view' },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn().mockReturnValue(null)
                }
            } as unknown as WorkspaceLeaf;

            manager['createdImmersiveLeaves'].add(refLeaf);
            const restoreFocusSpy = vi.spyOn(manager as unknown as { restoreMainEditorFocus: () => void }, 'restoreMainEditorFocus');

            // Should NOT throw an unhandled rejection
            await expect(manager.openReferenceFile(mockFile, refLeaf)).resolves.not.toThrow();

            expect(setReferenceFilePathSpy).not.toHaveBeenCalled();
            expect(restoreFocusSpy).toHaveBeenCalled();
        });

        it('reconciles main work transitions when multiple file-open events occur during active transition (A -> B -> C)', async () => {
            let resolveB!: () => void;
            const pB = new Promise<void>(resolve => { resolveB = resolve; });

            const mockRefB = Object.assign(new TFile(), { path: 'Novels/BookB/RefB.md', extension: 'md' });
            const mockRefC = Object.assign(new TFile(), { path: 'Novels/BookC/RefC.md', extension: 'md' });
            (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
                if (path === mockRefB.path) return mockRefB;
                if (path === mockRefC.path) return mockRefC;
                return null;
            });

            const refLeafView = { file: null as TFile | null, getViewType: () => 'markdown' };
            const refLeaf = {
                view: refLeafView,
                openFile: vi.fn().mockImplementation(async (file: TFile) => {
                    if (file.path === mockRefB.path) {
                        await pB;
                    }
                    refLeafView.file = file;
                }),
                setViewState: vi.fn().mockResolvedValue(undefined),
                containerEl: {
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'immersive-reference-view' },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn().mockReturnValue(null),
                    createDiv: vi.fn(() => ({
                        createEl: vi.fn(() => ({
                            addEventListener: vi.fn(),
                            removeEventListener: vi.fn(),
                            setAttribute: vi.fn()
                        })),
                        remove: vi.fn()
                    }))
                }
            } as unknown as WorkspaceLeaf;

            manager['createdImmersiveLeaves'].add(refLeaf);
            manager['currentMainWorkPath'] = 'Novels/BookA';

            let currentFile = Object.assign(new TFile(), { path: 'Novels/BookA/Chapter1.md' });
            const mainLeaf = {
                view: {
                    file: currentFile,
                    getViewType: () => 'markdown'
                },
                containerEl: { classList: { contains: (c: string) => c === 'immersive-main-editor' } }
            } as unknown as WorkspaceLeaf;
            manager['getMainEditorLeaf'] = vi.fn().mockReturnValue(mainLeaf);

            let onFileOpen: (file: TFile) => void = () => { throw new Error('File listener was not registered'); };
            Object.assign(mockPlugin.app.workspace, { on: vi.fn((event: string, handler: (file: TFile) => void) => {
                if (event === 'file-open') onFileOpen = handler;
                return {};
            }) });
            manager['registerImmersiveEventListeners']();

            // Trigger file-open for BookB (starts transition)
            currentFile = Object.assign(new TFile(), { path: 'Novels/BookB/Chapter1.md' });
            (mainLeaf.view as unknown as { file: TFile }).file = currentFile;
            onFileOpen(currentFile);

            // Trigger file-open for BookC while BookB transition is in-flight
            currentFile = Object.assign(new TFile(), { path: 'Novels/BookC/Chapter1.md' });
            (mainLeaf.view as unknown as { file: TFile }).file = currentFile;
            onFileOpen(currentFile);

            // Now resolve BookB transition
            resolveB();
            await new Promise(r => setTimeout(r, 20));

            // Final displayed reference must be BookC's reference!
            expect(refLeafView.file).toBe(mockRefC);
            expect(manager['currentMainWorkPath']).toBe('Novels/BookC');
        });

        it('exit generation guard: late in-flight openFile completion after exit is discarded', async () => {
            let resolvePending!: () => void;
            const pendingPromise = new Promise<void>(resolve => { resolvePending = resolve; });

            const mockFile = Object.assign(new TFile(), { path: 'Novels/BookA/Ref.md', extension: 'md' });
            (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(mockFile);

            const refLeaf = {
                openFile: vi.fn().mockReturnValue(pendingPromise),
                containerEl: {
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'immersive-reference-view' },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn().mockReturnValue(null)
                }
            } as unknown as WorkspaceLeaf;

            manager['createdImmersiveLeaves'].add(refLeaf);

            const openPromise = manager.openReferenceFile(mockFile, refLeaf);

            // User exits immersive mode while open is in-flight
            manager.cleanup();
            expect(manager['isImmersiveActive']).toBe(false);

            // Now openFile finishes
            resolvePending();
            await openPromise;

            // Should NOT persist or re-attach
            expect(setReferenceFilePathSpy).not.toHaveBeenCalled();
        });

        it('openReferenceFile rejects invalid or non-markdown files with Notice', async () => {
            const nonMdFile = Object.assign(new TFile(), { path: 'Images/Cover.png', extension: 'png' });
            (mockPlugin.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(nonMdFile);

            const refLeaf = {
                openFile: vi.fn()
            } as unknown as WorkspaceLeaf;

            await manager.openReferenceFile(nonMdFile, refLeaf);

            expect(refLeaf.openFile).not.toHaveBeenCalled();
            expect(setReferenceFilePathSpy).not.toHaveBeenCalled();
        });

        it('immediately remembers native reference navigation under the main work', async () => {
            const reference = Object.assign(new TFile(), { path: 'Novels/BookB/Lore.md', extension: 'md' });
            const leaf = {
                view: { file: reference, getViewType: () => 'markdown' },
                containerEl: { classList: { contains: () => true } }
            } as unknown as WorkspaceLeaf;
            manager['createdImmersiveLeaves'].add(leaf);
            manager['currentMainWorkPath'] = 'Novels/BookA';
            let onFileOpen: (file: TFile) => void = () => { throw new Error('File listener was not registered'); };
            Object.assign(mockPlugin.app.workspace, { on: vi.fn((event: string, handler: (file: TFile) => void) => {
                if (event === 'file-open') onFileOpen = handler;
                return {};
            }) });
            manager['registerImmersiveEventListeners']();
            onFileOpen(reference);
            await vi.waitFor(() => expect(setReferenceFilePathSpy).toHaveBeenCalledWith('Novels/BookA', reference.path));
        });

        it('restores focus without applying a stale search selection to a different main document', () => {
            const editor = { focus: vi.fn(), setSelections: vi.fn(), setCursor: vi.fn() };
            manager['activeMainLeaf'] = {
                view: { file: { path: 'Novels/BookB/Chapter.md' }, editor },
            } as unknown as WorkspaceLeaf;
            manager['restoreMainEditorFocus']({
                targetFilePath: 'Novels/BookA/Chapter.md',
                selections: [{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 4 } }]
            });
            expect(editor.focus).toHaveBeenCalled();
            expect(editor.setSelections).not.toHaveBeenCalled();
        });

        it('attachReferenceToolbar attaches toolbar with search button and cleans up cleanly', () => {
            const leafContentEl = {
                createDiv: vi.fn((_opts?: { cls?: string }) => ({
                    createEl: vi.fn((_tag: string, _opts?: { cls?: string }) => ({
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn(),
                        setAttribute: vi.fn()
                    })),
                    remove: vi.fn()
                }))
            };
            const refLeaf = {
                containerEl: {
                    classList: {
                        contains: (cls: string) => cls === 'immersive-reference-view',
                        add: vi.fn(),
                        remove: vi.fn()
                    },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn().mockReturnValue(leafContentEl)
                }
            } as unknown as WorkspaceLeaf;

            manager.attachReferenceToolbar(refLeaf);
            expect(leafContentEl.createDiv).toHaveBeenCalledWith({ cls: 'wn-immersive-ref-toolbar' });

            // Removing toolbars cleans up
            manager.removeReferenceToolbars();
            expect(manager['refToolbarCleanups'].size).toBe(0);
        });

        it('keeps the search button attached when focusing a reference fires file-open, but replaces a changed host', async () => {
            const searchButton = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
            const toolbar = {
                parentElement: null as unknown,
                createEl: vi.fn(() => searchButton),
                remove: vi.fn(() => { toolbar.parentElement = null; })
            };
            const content = { createDiv: vi.fn(() => {
                toolbar.parentElement = content;
                return toolbar;
            }) };
            let host: unknown = content;
            const reference = Object.assign(new TFile(), { path: 'Novels/BookA/RefA.md', extension: 'md' });
            const leaf = {
                view: { file: reference, getViewType: () => 'markdown' },
                containerEl: {
                    classList: { contains: (cls: string) => cls === 'immersive-reference-view' },
                    ownerDocument: mockActiveDocument,
                    querySelector: vi.fn(() => host)
                }
            } as unknown as WorkspaceLeaf;
            manager['createdImmersiveLeaves'].add(leaf);
            manager['currentMainWorkPath'] = 'Novels/BookA';
            let onFileOpen: (file: TFile) => void = () => { throw new Error('Missing file-open listener'); };
            Object.assign(mockPlugin.app.workspace, { on: vi.fn((event: string, handler: (file: TFile) => void) => {
                if (event === 'file-open') onFileOpen = handler;
                return {};
            }) });
            manager['registerImmersiveEventListeners']();
            manager.attachReferenceToolbar(leaf);

            // Focus can announce the reference file between mouse-down and click.
            onFileOpen(reference);
            await vi.waitFor(() => expect(setReferenceFilePathSpy).toHaveBeenCalled());
            expect(content.createDiv).toHaveBeenCalledTimes(1);
            expect(toolbar.remove).not.toHaveBeenCalled();
            expect(searchButton.removeEventListener).not.toHaveBeenCalled();

            const replacementContent = { createDiv: vi.fn(() => {
                toolbar.parentElement = replacementContent;
                return toolbar;
            }) };
            host = replacementContent;
            manager.attachReferenceToolbar(leaf);
            expect(toolbar.remove).toHaveBeenCalledTimes(1);
            expect(replacementContent.createDiv).toHaveBeenCalledTimes(1);

            manager.removeReferenceToolbars();
            expect(toolbar.remove).toHaveBeenCalledTimes(2);
            expect(searchButton.removeEventListener).toHaveBeenCalledTimes(2);
            expect(manager['refToolbarCleanups'].size).toBe(0);
        });
    });

    describe('ImmersiveModeManager - Typewriter Settings Gear & Quick Modal', () => {
        type GearEvent = { stopPropagation: () => void };
        type GearElement = {
            className: string;
            type?: string;
            innerText: string;
            ownerDocument: Document;
            style: Record<string, unknown>;
            classList: {
                add: (name: string) => void;
                remove: (name: string) => void;
                contains: (name: string) => boolean;
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
            setAttribute: ReturnType<typeof vi.fn>;
            getAttribute: ReturnType<typeof vi.fn>;
            trigger: (event: string, value?: GearEvent) => void;
            createDiv: ReturnType<typeof vi.fn>;
            createSpan: ReturnType<typeof vi.fn>;
            createEl: ReturnType<typeof vi.fn>;
        };
        type GearToggle = { _onChange?: (value: boolean) => Promise<void> | void };
        let mockPlugin: ImmersiveModeManagerPlugin;
        let manager: ImmersiveModeManager;
        let mockActiveDocument: {
            body: GearElement;
            documentElement: { requestFullscreen: ReturnType<typeof vi.fn> };
        };

        beforeEach(() => {
            const createMockDOMElement = (cls = ''): GearElement => {
                let isVisible = true;
                let text = '';
                const attrs: Record<string, string> = {};
                const listeners: Record<string, Array<(event: GearEvent) => void>> = {};
                const element: GearElement = {
                    className: cls,
                    innerText: '',
                    ownerDocument: mockActiveDocument as unknown as Document,
                    style: {},
                    classList: {
                        add: vi.fn((c: string) => { if (!element.className.includes(c)) element.className += ' ' + c; }),
                        remove: vi.fn((c: string) => { element.className = element.className.replace(c, '').trim(); }),
                        contains: vi.fn((c: string) => element.className.includes(c))
                    },
                    setCssProps: vi.fn(),
                    show: vi.fn(() => { isVisible = true; }),
                    hide: vi.fn(() => { isVisible = false; }),
                    isShown: vi.fn(() => isVisible),
                    empty: vi.fn(),
                    remove: vi.fn(),
                    addEventListener: vi.fn((evt: string, fn: (event: GearEvent) => void) => {
                        listeners[evt] = listeners[evt] || [];
                        listeners[evt].push(fn);
                    }),
                    removeEventListener: vi.fn(),
                    appendChild: vi.fn(),
                    setAttribute: vi.fn((k: string, v: string) => { attrs[k] = v; }),
                    getAttribute: vi.fn((k: string) => attrs[k]),
                    trigger: (evt: string, e?: GearEvent) => {
                        (listeners[evt] || []).forEach(fn => fn(e || { stopPropagation: vi.fn() }));
                    },
                    createDiv: vi.fn((opts?: { cls?: string }) => createMockDOMElement(opts?.cls || '')),
                    createSpan: vi.fn((opts?: { cls?: string; text?: string }) => {
                        const span = createMockDOMElement(opts?.cls || '');
                        if (opts?.text) span.innerText = opts.text;
                        return span;
                    }),
                    createEl: vi.fn((_tag: string, opts?: { cls?: string; type?: string; attr?: Record<string, string> }) => {
                        const el = createMockDOMElement(opts?.cls || '');
                        if (opts?.type) el.type = opts.type;
                        if (opts?.attr) {
                            for (const [name, value] of Object.entries(opts.attr)) el.setAttribute(name, value);
                        }
                        return el;
                    })
                };
                Object.defineProperty(element, 'innerText', {
                    get: () => text,
                    set: (val: string) => { text = val; }
                });
                return element;
            };

            const domGlobals = globalThis as unknown as {
                createDiv: (opts?: { cls?: string }) => GearElement;
                createSpan: (opts?: { cls?: string }) => GearElement;
            };
            domGlobals.createDiv = (opts) => createMockDOMElement(opts?.cls || '');
            domGlobals.createSpan = (opts) => createMockDOMElement(opts?.cls || '');

            mockActiveDocument = {
                body: createMockDOMElement('body'),
                documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) }
            };
            Object.assign(globalThis, { activeDocument: mockActiveDocument });

            mockPlugin = {
                app: {
                    workspace: {
                        getActiveViewOfType: vi.fn(),
                        getLeavesOfType: vi.fn().mockReturnValue([]),
                        updateOptions: vi.fn(),
                        on: vi.fn().mockReturnValue({}),
                        off: vi.fn()
                    },
                    vault: {
                        getMarkdownFiles: vi.fn().mockReturnValue([])
                    }
                },
                settings: {
                    immersive: {
                        typewriterEnabled: false,
                        typewriterCenterOffset: 0,
                        typewriterUnfocusedOpacity: 0.4
                    }
                },
                statisticsManager: {
                    getCoreStats: vi.fn().mockReturnValue({
                        totalTime: '00:00',
                        focusTime: '00:00',
                        slackTime: '00:00',
                        todayWords: 0,
                        goal: 1000,
                        dailyWords: 0,
                        dailyGoal: 2000,
                        sessionWords: 0
                    })
                },
                saveSettings: vi.fn().mockResolvedValue(undefined)
            } as unknown as ImmersiveModeManagerPlugin;

            manager = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
        });

        afterEach(() => {
            manager.cleanup();
            vi.clearAllMocks();
        });

        it('creates typewriter toggle and settings gear button with is-hidden when initially disabled', () => {
            mockPlugin.settings.immersive.typewriterEnabled = false;
            manager['createTopBar']();

            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            expect(gearBtn).toBeDefined();
            expect(gearBtn.type).toBe('button');
            expect(gearBtn.classList.contains('is-hidden')).toBe(true);
            expect(gearBtn.getAttribute('aria-label')).toBeDefined();
            expect(gearBtn.getAttribute('title')).toBeUndefined();
        });

        it('shows settings gear button without is-hidden when initially enabled', () => {
            mockPlugin.settings.immersive.typewriterEnabled = true;
            manager['createTopBar']();

            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            expect(gearBtn).toBeDefined();
            expect(gearBtn.classList.contains('is-hidden')).toBe(false);
        });

        it('immediately updates gear visibility and closes quick modal when typewriter is toggled', async () => {
            mockPlugin.settings.immersive.typewriterEnabled = false;
            manager['createTopBar']();

            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            const toggle = manager['typewriterToggle'] as unknown as GearToggle;
            expect(toggle).toBeDefined();
            expect(gearBtn.classList.contains('is-hidden')).toBe(true);

            // Toggle ON
            let finishSave!: () => void;
            (mockPlugin.saveSettings as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise<void>(resolve => { finishSave = resolve; }));
            const enabling = toggle._onChange?.(true);
            expect(gearBtn.classList.contains('is-hidden')).toBe(false);
            finishSave();
            await enabling;
            expect(mockPlugin.settings.immersive.typewriterEnabled).toBe(true);
            expect(gearBtn.classList.contains('is-hidden')).toBe(false);
            expect(mockPlugin.app.workspace.updateOptions).toHaveBeenCalled();

            // Open modal
            gearBtn.trigger('click');
            expect(manager['activeTypewriterQuickModal']).toBeDefined();

            // Toggle OFF -> immediately hides gear and closes active modal
            await toggle._onChange?.(false);
            expect(mockPlugin.settings.immersive.typewriterEnabled).toBe(false);
            expect(gearBtn.classList.contains('is-hidden')).toBe(true);
            expect(manager['activeTypewriterQuickModal']).toBeNull();
        });

        it('caches single modal reference and prevents duplicate panels', () => {
            mockPlugin.settings.immersive.typewriterEnabled = true;
            manager['createTopBar']();

            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            gearBtn.trigger('click');
            const firstModal = manager['activeTypewriterQuickModal'];
            expect(firstModal).toBeDefined();

            // Clicking again while open should NOT create new modal
            gearBtn.trigger('click');
            expect(manager['activeTypewriterQuickModal']).toBe(firstModal);

            // Closing modal releases reference
            firstModal?.close();
            expect(manager['activeTypewriterQuickModal']).toBeNull();
        });

        it('syncs toggle and gear visibility from external settings in renderTopBarContent', async () => {
            mockPlugin.settings.immersive.typewriterEnabled = false;
            manager['createTopBar']();
            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            expect(gearBtn.classList.contains('is-hidden')).toBe(true);

            // External change: user enabled typewriter in SettingsTab
            mockPlugin.settings.immersive.typewriterEnabled = true;
            await manager['renderTopBarContent']();

            expect(gearBtn.classList.contains('is-hidden')).toBe(false);
            expect(manager['typewriterToggle']?.getValue?.()).toBe(true);

            // Open modal
            gearBtn.trigger('click');
            expect(manager['activeTypewriterQuickModal']).toBeDefined();

            // External change: user disabled typewriter in SettingsTab
            mockPlugin.settings.immersive.typewriterEnabled = false;
            await manager['renderTopBarContent']();

            expect(gearBtn.classList.contains('is-hidden')).toBe(true);
            expect(manager['activeTypewriterQuickModal']).toBeNull();
        });

        it('closes quick modal and clears references on removeTopBar and cleanup', () => {
            mockPlugin.settings.immersive.typewriterEnabled = true;
            manager['createTopBar']();

            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            gearBtn.trigger('click');
            const modal = manager['activeTypewriterQuickModal'];
            expect(modal).toBeDefined();

            const closeSpy = vi.spyOn(modal!, 'close');
            manager.cleanup();

            expect(closeSpy).toHaveBeenCalled();
            expect(manager['activeTypewriterQuickModal']).toBeNull();
            expect(manager['typewriterGearBtn']).toBeNull();
            expect(manager['typewriterToggle']).toBeNull();
        });
    });
});

describe('ImmersiveModeManager - Auxiliary Regions Collapse and Global Toggle', () => {
    type MockAuxElement = {
        className: string;
        innerText: string;
        type?: string;
        style: Record<string, string>;
        ownerDocument: Document;
        parentElement: MockAuxElement | null;
        children: MockAuxElement[];
        nextElementSibling: MockAuxElement | null;
        previousElementSibling: MockAuxElement | null;
        offsetParent: MockAuxElement | null;
        offsetWidth: number;
        offsetHeight: number;
        classList: {
            add: (c: string) => void;
            remove: (c: string) => void;
            contains: (c: string) => boolean;
        };
        setAttribute: (k: string, v: string) => void;
        getAttribute: (k: string) => string | undefined;
        addEventListener: (evt: string, fn: (e: { stopPropagation: () => void }) => void) => void;
        removeEventListener: (evt: string, fn: (e: { stopPropagation: () => void }) => void) => void;
        trigger: (evt: string) => void;
        createDiv: (opts?: { cls?: string }) => MockAuxElement;
        createSpan: (opts?: { cls?: string }) => MockAuxElement;
        createEl: (tag: string, opts?: { cls?: string; type?: string; attr?: Record<string, string> }) => MockAuxElement;
        appendChild: (child: MockAuxElement) => MockAuxElement;
        remove: () => void;
        contains: (other: unknown) => boolean;
        setCssProps: (props: Record<string, string>) => void;
    };

    const createAuxElement = (cls = ''): MockAuxElement => {
        const attrs: Record<string, string> = {};
        const listeners: Record<string, Array<(e: { stopPropagation: () => void }) => void>> = {};
        const classes = new Set(cls.split(/\s+/).filter(Boolean));

        const element: MockAuxElement = {
            className: cls,
            innerText: '',
            style: {},
            ownerDocument: null as unknown as Document,
            parentElement: null,
            children: [],
            nextElementSibling: null,
            previousElementSibling: null,
            offsetParent: null,
            offsetWidth: 100,
            offsetHeight: 100,
            classList: {
                add: vi.fn((c: string) => {
                    classes.add(c);
                    element.className = Array.from(classes).join(' ');
                }),
                remove: vi.fn((c: string) => {
                    classes.delete(c);
                    element.className = Array.from(classes).join(' ');
                }),
                contains: vi.fn((c: string) => classes.has(c))
            },
            setAttribute: vi.fn((k: string, v: string) => { attrs[k] = v; }),
            getAttribute: vi.fn((k: string) => attrs[k]),
            addEventListener: vi.fn((evt: string, fn: (e: { stopPropagation: () => void }) => void) => {
                listeners[evt] = listeners[evt] || [];
                listeners[evt].push(fn);
            }),
            removeEventListener: vi.fn((evt: string, fn: (e: { stopPropagation: () => void }) => void) => {
                if (listeners[evt]) {
                    listeners[evt] = listeners[evt].filter(f => f !== fn);
                }
            }),
            trigger: (evt: string) => {
                (listeners[evt] || []).forEach(fn => fn({ stopPropagation: vi.fn() }));
            },
            createDiv: vi.fn((opts?: { cls?: string }) => {
                const child = createAuxElement(opts?.cls || '');
                element.appendChild(child);
                return child;
            }),
            createSpan: vi.fn((opts?: { cls?: string }) => {
                const child = createAuxElement(opts?.cls || '');
                element.appendChild(child);
                return child;
            }),
            createEl: vi.fn((tag: string, opts?: { cls?: string; type?: string; attr?: Record<string, string> }) => {
                const child = createAuxElement(opts?.cls || '');
                if (opts?.type) child.type = opts.type;
                if (opts?.attr) {
                    for (const [k, v] of Object.entries(opts.attr)) child.setAttribute(k, v);
                }
                element.appendChild(child);
                return child;
            }),
            appendChild: vi.fn((child: MockAuxElement) => {
                if (element.children.length > 0) {
                    const last = element.children[element.children.length - 1];
                    last.nextElementSibling = child;
                    child.previousElementSibling = last;
                }
                child.parentElement = element;
                child.ownerDocument = element.ownerDocument;
                element.children.push(child);
                return child;
            }),
            remove: vi.fn(() => {
                if (element.parentElement) {
                    const siblings = element.parentElement.children;
                    const idx = siblings.indexOf(element);
                    if (idx !== -1) siblings.splice(idx, 1);
                    if (element.previousElementSibling) element.previousElementSibling.nextElementSibling = element.nextElementSibling;
                    if (element.nextElementSibling) element.nextElementSibling.previousElementSibling = element.previousElementSibling;
                    element.parentElement = null;
                }
            }),
            contains: vi.fn((other: unknown): boolean => {
                if (other === element) return true;
                return element.children.some(c => c.contains(other));
            }),
            setCssProps: vi.fn()
        };
        element.offsetParent = element;
        return element;
    };

    let mockPlugin: ImmersiveModeManagerPlugin;
    let manager: ImmersiveModeManager;
    let mockDoc: {
        body: MockAuxElement;
        documentElement: { requestFullscreen: ReturnType<typeof vi.fn> };
        activeElement: MockAuxElement | null;
        fullscreenElement: null;
        addEventListener: ReturnType<typeof vi.fn>;
        removeEventListener: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockDoc = {
            body: createAuxElement('body'),
            documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
            activeElement: null,
            fullscreenElement: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        };
        mockDoc.body.ownerDocument = mockDoc as unknown as Document;
        (globalThis as unknown as { activeDocument: unknown }).activeDocument = mockDoc;
        (globalThis as unknown as { activeWindow: unknown }).activeWindow = { innerWidth: 1200 };

        mockPlugin = {
            app: {
                workspace: {
                    getActiveViewOfType: vi.fn(),
                    getLeavesOfType: vi.fn().mockReturnValue([]),
                    iterateRootLeaves: vi.fn(),
                    createLeafBySplit: vi.fn(),
                    getLeaf: vi.fn(),
                    setActiveLeaf: vi.fn(),
                    updateOptions: vi.fn(),
                    onResize: vi.fn(),
                    on: vi.fn().mockReturnValue({ id: 'ref' }),
                    offref: vi.fn(),
                    trigger: vi.fn()
                },
                vault: {
                    getName: vi.fn().mockReturnValue('Vault'),
                    getAbstractFileByPath: vi.fn().mockReturnValue(null),
                    cachedRead: vi.fn().mockResolvedValue('')
                },
                commands: { executeCommandById: vi.fn() }
            },
            settings: {
                immersive: {
                    immersiveTopSlots: ['sticky-note', 'foreshadowing', 'timeline'],
                    immersiveBottomSlots: [],
                    immersiveLeftSlots: ['chapter-list'],
                    immersiveRightSlots: ['reference-view'],
                    immersiveTopSize: 20,
                    immersiveBottomSize: 20,
                    immersiveLeftSize: 25,
                    immersiveRightSize: 25,
                    immersiveTopInternalSizes: [],
                    immersiveBottomInternalSizes: [],
                    immersiveLeftInternalSizes: [],
                    immersiveRightInternalSizes: [],
                    collapsedRegions: { top: false, bottom: false, left: false, right: false },
                    allRegionsHidden: false,
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
            statisticsManager: {
                getCoreStats: vi.fn().mockReturnValue({
                    totalTime: '01:00',
                    focusTime: '00:50',
                    slackTime: '00:10',
                    todayWords: 100,
                    goal: 1000,
                    dailyWords: 500,
                    dailyGoal: 2000,
                    sessionWords: 50
                })
            },
            adaptiveDebounceManager: { debounceFixed: vi.fn() },
            settingsManager: { flush: vi.fn().mockResolvedValue(undefined) },
            startTracking: vi.fn(),
            stopTracking: vi.fn(),
            saveSettings: vi.fn().mockResolvedValue(undefined)
        } as unknown as ImmersiveModeManagerPlugin;

        mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
        manager = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
    });

    afterEach(() => {
        manager.cleanup();
    });

    it('canToggleAuxiliaryRegions requires active immersive session with configured slots and no transition', () => {
        // Not active yet
        expect(manager.canToggleAuxiliaryRegions()).toBe(false);

        manager['isImmersiveActive'] = true;
        expect(manager.canToggleAuxiliaryRegions()).toBe(true);

        manager['isTransitioning'] = true;
        expect(manager.canToggleAuxiliaryRegions()).toBe(false);
        manager['isTransitioning'] = false;

        manager['isExiting'] = true;
        expect(manager.canToggleAuxiliaryRegions()).toBe(false);
        manager['isExiting'] = false;

        // No configured regions
        mockPlugin.settings.immersive.immersiveTopSlots = [];
        mockPlugin.settings.immersive.immersiveBottomSlots = [];
        mockPlugin.settings.immersive.immersiveLeftSlots = [];
        mockPlugin.settings.immersive.immersiveRightSlots = [];
        expect(manager.canToggleAuxiliaryRegions()).toBe(false);
    });

    it('collapses multi-slot top region branch as a unit and toggles handle and restore button', async () => {
        manager['isImmersiveActive'] = true;

        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = {
            containerEl: mainLeafEl,
            view: { file: new TFile(), getViewType: () => 'markdown' },
            setDimension: vi.fn()
        } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        // Multi-slot top region branch (internal vertical split)
        const topSplitEl = createAuxElement('workspace-split mod-vertical');
        const topLeaf1 = { containerEl: createAuxElement('workspace-leaf') } as unknown as WorkspaceLeaf;
        const topLeaf2 = { containerEl: createAuxElement('workspace-leaf') } as unknown as WorkspaceLeaf;
        const topLeaf3 = { containerEl: createAuxElement('workspace-leaf') } as unknown as WorkspaceLeaf;
        topSplitEl.appendChild(topLeaf1.containerEl as unknown as MockAuxElement);
        topSplitEl.appendChild(topLeaf2.containerEl as unknown as MockAuxElement);
        topSplitEl.appendChild(topLeaf3.containerEl as unknown as MockAuxElement);

        const topBranchItem = {
            containerEl: topSplitEl,
            size: 20,
            setDimension: vi.fn()
        } as unknown as WorkspaceSplit;

        const topResizeHandle = createAuxElement('workspace-leaf-resize-handle');

        // Outer horizontal split
        const hSplitEl = createAuxElement('workspace-split mod-horizontal');
        hSplitEl.appendChild(topSplitEl);
        hSplitEl.appendChild(topResizeHandle);
        hSplitEl.appendChild(mainLeafEl);

        const hSplit = {
            direction: 'horizontal',
            containerEl: hSplitEl,
            children: [topBranchItem, mainLeaf]
        } as unknown as WorkspaceSplit;

        manager['regionBranches'].set('top', {
            region: 'top',
            branchItem: topBranchItem as unknown as WorkspaceItem,
            parentSplit: hSplit,
            firstLeaf: topLeaf1
        });

        manager['applyAuxiliaryRegionsVisibility']();
        const collapseBtn = manager['regionCollapseBtns'].get('top');
        expect(collapseBtn?.parentElement).toBe(mainLeafEl);
        mockDoc.activeElement = collapseBtn as unknown as MockAuxElement;
        const focusSpy = vi.spyOn(manager as unknown as { restoreMainEditorFocus: () => void }, 'restoreMainEditorFocus').mockImplementation(() => {});

        // 1. Collapse top region
        await manager['collapseRegion']('top');

        expect(mockPlugin.settings.immersive.collapsedRegions.top).toBe(true);
        expect(mockPlugin.saveSettings).toHaveBeenCalled();
        expect(topSplitEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);
        expect(topResizeHandle.classList.contains('wn-immersive-handle-hidden')).toBe(true);

        // Main leaf has restore button for top
        const restoreBtn = mainLeafEl.children.find(c => c.className.includes('wn-immersive-restore-btn-top'));
        expect(restoreBtn).toBeDefined();
        expect(restoreBtn?.parentElement).toBe(mainLeafEl);
        expect(focusSpy).toHaveBeenCalledOnce();

        // 2. Restore top region
        await manager['restoreRegion']('top');

        expect(mockPlugin.settings.immersive.collapsedRegions.top).toBe(false);
        expect(topSplitEl.classList.contains('wn-immersive-region-collapsed')).toBe(false);
        expect(topResizeHandle.classList.contains('wn-immersive-handle-hidden')).toBe(false);
        const restoreBtnAfter = mainLeafEl.children.find(c => c.className.includes('wn-immersive-restore-btn-top'));
        expect(restoreBtnAfter).toBeUndefined();
        expect(manager['regionCollapseBtns'].get('top')?.parentElement).toBe(mainLeafEl);
        focusSpy.mockRestore();
    });

    it('safely handles empty region with zero slots without creating handles or crashing', async () => {
        manager['isImmersiveActive'] = true;
        const mainLeafEl = createAuxElement('immersive-main-editor');
        manager['activeMainLeaf'] = { containerEl: mainLeafEl } as unknown as WorkspaceLeaf;

        // Bottom has 0 slots
        mockPlugin.settings.immersive.immersiveBottomSlots = [];
        await manager['collapseRegion']('bottom');
        expect(mockPlugin.settings.immersive.collapsedRegions.bottom).toBe(true);
        expect(mainLeafEl.children.find(c => c.className.includes('wn-immersive-restore-btn-bottom'))).toBeUndefined();

        await manager['restoreRegion']('bottom');
        expect(mockPlugin.settings.immersive.collapsedRegions.bottom).toBe(false);
    });

    it('global toggle hides all regions and removes individual restore buttons; second toggle restores visible regions', async () => {
        manager['isImmersiveActive'] = true;
        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = { containerEl: mainLeafEl, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        const leftEl = createAuxElement('workspace-leaf');
        const leftLeaf = { containerEl: leftEl, size: 25, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        const vSplit = {
            direction: 'vertical',
            containerEl: createAuxElement(),
            children: [leftLeaf, mainLeaf]
        } as unknown as WorkspaceSplit;

        manager['regionBranches'].set('left', {
            region: 'left',
            branchItem: leftLeaf as unknown as WorkspaceItem,
            parentSplit: vSplit,
            firstLeaf: leftLeaf
        });

        const topEl = createAuxElement('workspace-leaf');
        const topLeaf = { containerEl: topEl, size: 20, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        const hSplit = {
            direction: 'horizontal',
            containerEl: createAuxElement(),
            children: [topLeaf, mainLeaf]
        } as unknown as WorkspaceSplit;

        manager['regionBranches'].set('top', {
            region: 'top',
            branchItem: topLeaf as unknown as WorkspaceItem,
            parentSplit: hSplit,
            firstLeaf: topLeaf
        });

        // Set left initially individually collapsed, top visible
        mockPlugin.settings.immersive.collapsedRegions.left = true;
        mockPlugin.settings.immersive.collapsedRegions.top = false;
        manager['applyAuxiliaryRegionsVisibility']();

        expect(leftEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);
        expect(topEl.classList.contains('wn-immersive-region-collapsed')).toBe(false);
        expect(mainLeafEl.children.some(c => c.className.includes('wn-immersive-restore-btn-left'))).toBe(true);

        // 1. Global toggle: hide all
        await manager.toggleAllAuxiliaryRegions();

        expect(mockPlugin.settings.immersive.allRegionsHidden).toBe(true);
        // Individual mask is preserved, not overwritten!
        expect(mockPlugin.settings.immersive.collapsedRegions.left).toBe(true);
        expect(mockPlugin.settings.immersive.collapsedRegions.top).toBe(false);

        // All auxiliary regions hidden
        expect(leftEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);
        expect(topEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);
        // Individual restore buttons on main leaf removed in all-hidden state
        expect(mainLeafEl.children.some(c => c.className.includes('wn-immersive-restore-btn'))).toBe(false);

        // 2. Global toggle second time: restore visible regions
        await manager.toggleAllAuxiliaryRegions();

        expect(mockPlugin.settings.immersive.allRegionsHidden).toBe(false);
        // Top restored to visible
        expect(topEl.classList.contains('wn-immersive-region-collapsed')).toBe(false);
        // Left remains collapsed!
        expect(leftEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);
        // Left restore button reappears on mainLeaf
        expect(mainLeafEl.children.some(c => c.className.includes('wn-immersive-restore-btn-left'))).toBe(true);
    });

    it('repeated collapse and restore toggles cause no geometry loss or dimension contamination', async () => {
        manager['isImmersiveActive'] = true;
        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = { containerEl: mainLeafEl, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        const leftEl = createAuxElement('workspace-leaf');
        const leftLeaf = { containerEl: leftEl, size: 25, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        const vSplit = {
            direction: 'vertical',
            containerEl: createAuxElement(),
            children: [leftLeaf, mainLeaf]
        } as unknown as WorkspaceSplit;

        manager['regionBranches'].set('left', {
            region: 'left',
            branchItem: leftLeaf as unknown as WorkspaceItem,
            parentSplit: vSplit,
            firstLeaf: leftLeaf
        });

        expect(mockPlugin.settings.immersive.immersiveLeftSize).toBe(25);

        for (let i = 0; i < 5; i++) {
            await manager['collapseRegion']('left');
            expect(leftLeaf.size).toBe(25); // Never set to 0
            expect(mockPlugin.settings.immersive.immersiveLeftSize).toBe(25);

            await manager['restoreRegion']('left');
            expect(leftLeaf.size).toBe(25);
            expect(mockPlugin.settings.immersive.immersiveLeftSize).toBe(25);
        }
    });

    it('un-normalizes user resize of visible panel when sibling is collapsed', () => {
        manager['isImmersiveActive'] = true;
        mockPlugin.settings.immersive.immersiveLeftSize = 20;
        mockPlugin.settings.immersive.immersiveRightSize = 20;
        mockPlugin.settings.immersive.collapsedRegions.left = true;
        mockPlugin.settings.immersive.collapsedRegions.right = false;

        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = { containerEl: mainLeafEl } as unknown as WorkspaceLeaf;

        const rightEl = createAuxElement('workspace-leaf');
        const rightLeaf = { containerEl: rightEl } as unknown as WorkspaceLeaf;
        manager['activeRightLeaf'] = rightLeaf;

        const vSplitEl = createAuxElement('workspace-split mod-vertical');
        vSplitEl.offsetWidth = 1000;
        rightEl.offsetWidth = 250; // In visible screen (80% total), 250/1000 = 25%

        const vSplit = {
            direction: 'vertical',
            containerEl: vSplitEl,
            children: [{ containerEl: mainLeafEl }, { containerEl: rightEl }]
        } as unknown as WorkspaceSplit;

        vi.spyOn(manager as unknown as { getParentSplit: () => WorkspaceSplit | null }, 'getParentSplit').mockReturnValue(vSplit);

        // Calling saveCurrentPanelSizes: right measured at 25%, scaled by (100 - 20)/100 = 80% -> saves 20%
        manager['saveCurrentPanelSizes']();
        expect(mockPlugin.settings.immersive.immersiveRightSize).toBe(20);

        // User resized right to 50% of visible container: 50 * 80 / 100 = 40%
        rightEl.offsetWidth = 500;
        manager['saveCurrentPanelSizes']();
        expect(mockPlugin.settings.immersive.immersiveRightSize).toBe(40);
    });

    it('restores focus to main editor when search source leaf inside collapsed region is hidden', async () => {
        manager['isImmersiveActive'] = true;
        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = {
            containerEl: mainLeafEl,
            view: {
                getViewType: () => 'markdown',
                editor: { focus: vi.fn(), getCursor: vi.fn(), listSelections: vi.fn() }
            }
        } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        const rightEl = createAuxElement('workspace-leaf');
        const rightLeaf = { containerEl: rightEl, size: 25, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        const vSplit = {
            direction: 'vertical',
            containerEl: createAuxElement(),
            children: [mainLeaf, rightLeaf]
        } as unknown as WorkspaceSplit;

        manager['regionBranches'].set('right', {
            region: 'right',
            branchItem: rightLeaf as unknown as WorkspaceItem,
            parentSplit: vSplit,
            firstLeaf: rightLeaf
        });

        // Set searchSourceLeaf to rightLeaf
        manager['searchSourceLeaf'] = rightLeaf;
        mockDoc.activeElement = rightEl;

        await manager['collapseRegion']('right');

        expect(manager.getSearchSourceLeaf()).toBe(mainLeaf);
        expect(mockPlugin.app.workspace.setActiveLeaf).toHaveBeenCalledWith(mainLeaf, { focus: true });

        // Restoring removes the focused edge button; typing should return to the main editor.
        mockDoc.activeElement = manager['regionRestoreBtns'].get('right') as unknown as MockAuxElement;
        await manager['restoreRegion']('right');
        expect((mainLeaf.view as MarkdownView).editor.focus).toHaveBeenCalledTimes(2);
    });

    it('preserves collapsed state after async mount finishes and cleans up controls without losing settings', async () => {
        manager['isImmersiveActive'] = true;
        mockPlugin.settings.immersive.collapsedRegions.top = true;

        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = { containerEl: mainLeafEl, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        const topEl = createAuxElement('workspace-leaf');
        const topLeaf = {
            containerEl: topEl,
            size: 20,
            setDimension: vi.fn(),
            setViewState: vi.fn().mockResolvedValue(undefined)
        } as unknown as WorkspaceLeaf;
        manager['createdImmersiveLeaves'].add(topLeaf);

        const hSplit = {
            direction: 'horizontal',
            containerEl: createAuxElement(),
            children: [topLeaf, mainLeaf]
        } as unknown as WorkspaceSplit;

        manager['regionBranches'].set('top', {
            region: 'top',
            branchItem: topLeaf as unknown as WorkspaceItem,
            parentSplit: hSplit,
            firstLeaf: topLeaf
        });

        manager['applyAuxiliaryRegionsVisibility']();
        expect(topEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);

        // Schedule auxiliary mount and await it
        manager['scheduleAuxiliaryMounts']([{ leaf: topLeaf, viewType: 'test-view' }], 0);
        await new Promise(resolve => setTimeout(resolve, 0));

        // Mount completed: region remains collapsed!
        expect(topEl.classList.contains('wn-immersive-region-collapsed')).toBe(true);

        // Cleanup
        manager.cleanup();

        // Control buttons and layout classes cleaned from DOM
        expect(mainLeafEl.children.length).toBe(0);
        // Settings preserved
        expect(mockPlugin.settings.immersive.collapsedRegions.top).toBe(true);
    });

    it('resolves region branches and normalizes proportions using parent hierarchy even with detached/not-yet-nested DOM', () => {
        manager['isImmersiveActive'] = true;
        mockPlugin.settings.immersive.immersiveTopSlots = ['immersive-chapter-list'];
        mockPlugin.settings.immersive.immersiveTopSize = 25;

        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = { containerEl: mainLeafEl, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        // In native Obsidian right after split creation:
        // topLeaf.containerEl is NOT yet appended to topBranchItem.containerEl (DOM containment returns false)
        const topLeafEl = createAuxElement('workspace-leaf');
        const topBranchEl = createAuxElement('workspace-split mod-vertical');
        // Explicitly verify DOM containment is false
        expect(topBranchEl.contains(topLeafEl)).toBe(false);

        const hSplitEl = createAuxElement('workspace-split mod-horizontal');
        const hSplit = {
            direction: 'horizontal',
            containerEl: hSplitEl,
            children: [] as unknown[]
        } as unknown as WorkspaceSplit;

        const topBranchItem = {
            parent: hSplit,
            containerEl: topBranchEl,
            setDimension: vi.fn()
        };
        const topLeaf = {
            parent: topBranchItem,
            containerEl: topLeafEl
        } as unknown as WorkspaceLeaf;
        manager['activeTopLeaf'] = topLeaf;

        (hSplit as { children: unknown[] }).children = [topBranchItem, mainLeaf];
        (mainLeaf as unknown as { parent: unknown }).parent = hSplit;

        // Resolve region branches using parent hierarchy
        manager['resolveRegionBranches']();

        const topInfo = manager['regionBranches'].get('top');
        expect(topInfo).toBeDefined();
        expect(topInfo?.branchItem).toBe(topBranchItem);
        expect(topInfo?.parentSplit).toBe(hSplit);

        // Normalize split proportions without DOM containment
        manager['normalizeVisibleSplitProportions']();
        expect(topBranchItem.setDimension).toHaveBeenCalledWith(25);
        expect(mainLeaf.setDimension).toHaveBeenCalledWith(75);
    });

    it('restores focus to main editor when the active view leaf is inside hidden branch while DOM activeElement is outside (e.g. command palette)', async () => {
        manager['isImmersiveActive'] = true;
        mockPlugin.settings.immersive.collapsedRegions.right = false;

        const mainLeafEl = createAuxElement('immersive-main-editor');
        const mainLeaf = {
            containerEl: mainLeafEl,
            view: {
                getViewType: () => 'markdown',
                editor: { focus: vi.fn(), getCursor: vi.fn(), listSelections: vi.fn() }
            }
        } as unknown as WorkspaceLeaf;
        manager['activeMainLeaf'] = mainLeaf;

        const rightEl = createAuxElement('workspace-leaf');
        const rightLeaf = { containerEl: rightEl, size: 25, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        const vSplit = {
            direction: 'vertical',
            containerEl: createAuxElement(),
            children: [mainLeaf, rightLeaf]
        } as unknown as WorkspaceSplit;

        (rightLeaf as unknown as { parent: unknown }).parent = vSplit;

        manager['regionBranches'].set('right', {
            region: 'right',
            branchItem: rightLeaf as unknown as WorkspaceItem,
            parentSplit: vSplit,
            firstLeaf: rightLeaf
        });

        // Simulate: user had rightLeaf active, then opened Command Palette via keyboard (Ctrl+P)
        // DOM activeElement is in the palette modal input (completely outside rightLeaf branch)
        const paletteInputEl = createAuxElement('prompt-input');
        mockDoc.activeElement = paletteInputEl;
        expect(rightEl.contains(paletteInputEl)).toBe(false);

        // Native activeLeaf is still rightLeaf
        vi.mocked(mockPlugin.app.workspace.getActiveViewOfType).mockReturnValue({ leaf: rightLeaf } as unknown as MarkdownView);
        manager['searchSourceLeaf'] = null;

        await manager['collapseRegion']('right');

        expect(mockPlugin.app.workspace.setActiveLeaf).toHaveBeenCalledWith(mainLeaf, { focus: true });
        expect((mainLeaf.view as unknown as { editor: { focus: ReturnType<typeof vi.fn> } }).editor.focus).toHaveBeenCalled();
        expect(manager.getSearchSourceLeaf()).toBe(mainLeaf);
    });


});
