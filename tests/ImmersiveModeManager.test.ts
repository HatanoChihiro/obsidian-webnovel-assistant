import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, type App, type WorkspaceLeaf, type WorkspaceSplit, type WorkspaceItem, type MarkdownView } from 'obsidian';
import { ImmersiveModeManager, type ImmersiveModeManagerPlugin } from '../src/ui/ImmersiveModeManager';
import { AccurateCountSettingTab } from '../src/ui/SettingsTab';
import { MOBILE_IMMERSIVE_AUX_VIEW_TYPES } from '../src/constants';
import { t } from '../src/i18n';
import { ImmersiveReferenceManager } from '../src/services/ImmersiveReferenceManager';
import { ImmersivePomodoroModal } from '../src/ui/ImmersivePomodoroModal';
import { preserveTypewriterViewport } from '../src/editor/TypewriterExtension';
import { getCurrentBookContext } from '../src/utils/path';
import type { StateEffect } from '@codemirror/state';

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
        setPlaceholder(_placeholder: string) {}
        setInstructions(_instructions: unknown[]) {}
    }

    class MockSetting {
		controlEl: MockElement;
		_name = '';
		_desc = '';
		_isHeading = false;
		_toggle?: { value: boolean; onChange?: (v: boolean) => Promise<void> | void };
		_dropdown?: { options: Array<{ value: string; label: string }>; value: string; onChange?: (v: string) => Promise<void> | void };
		_slider?: { min: number; max: number; step: number; value: number; onChange?: (v: number) => Promise<void> | void };
		static instances: MockSetting[] = [];
		constructor(public containerEl: unknown) {
			this.controlEl = createMockElement();
			MockSetting.instances.push(this);
		}
        setName(name: string) { this._name = name; return this; }
        setDesc(desc: string) { this._desc = desc; return this; }
        setHeading() { this._isHeading = true; return this; }
		addToggle(cb: (toggle: Record<'setValue' | 'onChange', ReturnType<typeof vi.fn>>) => unknown) {
			const state: { value: boolean; onChange?: (v: boolean) => Promise<void> | void } = { value: false };
			const toggle = {
				setValue: vi.fn((v: boolean) => { state.value = v; return toggle; }),
				onChange: vi.fn((fn: (v: boolean) => Promise<void> | void) => { state.onChange = fn; return toggle; })
			};
			cb(toggle);
			this._toggle = state;
			return this;
		}
		addDropdown(cb: (dropdown: Record<'addOption' | 'setValue' | 'onChange', ReturnType<typeof vi.fn>>) => unknown) {
			const state: { options: Array<{ value: string; label: string }>; value: string; onChange?: (v: string) => Promise<void> | void } = { options: [], value: '' };
			const dropdown = {
				addOption: vi.fn((value: string, label: string) => { state.options.push({ value, label }); return dropdown; }),
				setValue: vi.fn((v: string) => { state.value = v; return dropdown; }),
				onChange: vi.fn((fn: (v: string) => Promise<void> | void) => { state.onChange = fn; return dropdown; })
			};
			cb(dropdown);
			this._dropdown = state;
			return this;
		}
		addSlider(cb: (slider: Record<'setLimits' | 'setValue' | 'setDynamicTooltip' | 'then' | 'onChange', ReturnType<typeof vi.fn>>) => unknown) {
			const state: { min: number; max: number; step: number; value: number; onChange?: (v: number) => Promise<void> | void } = { min: 0, max: 0, step: 0, value: 0 };
			const slider = {
				setLimits: vi.fn((min: number, max: number, step: number) => { state.min = min; state.max = max; state.step = step; return slider; }),
				setValue: vi.fn((v: number) => { state.value = v; return slider; }),
				setDynamicTooltip: vi.fn().mockReturnThis(),
				then: vi.fn((fn: (s: unknown) => void) => { fn(slider); return slider; }),
				onChange: vi.fn((fn: (v: number) => Promise<void> | void) => { state.onChange = fn; return slider; })
			};
			cb(slider);
			this._slider = state;
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
		requireApiVersion: vi.fn().mockReturnValue(true),
		Platform: { isMobile: false },
		MarkdownView: class {},
        View: class {},
		TFile: class {},
        TFolder: class {},
        Modal: MockModal,
        FuzzySuggestModal: MockModal,
		PluginSettingTab: class { app: unknown; plugin: unknown; containerEl: unknown; constructor(app: unknown, plugin: unknown) { this.app = app; this.plugin = plugin; this.containerEl = createMockElement(); } },
		SearchComponent: class {},
		Component: class {},
		ItemView: class {},
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

    const createWorkspaceElement = (initialStyle: Record<string, string> = {}) => {
        const classes = new Set<string>();
        const style: Record<string, string> = {
            width: '', height: '', flex: '', flexGrow: '', flexBasis: '', ...initialStyle
        };
        const setCssProps = vi.fn((properties: Record<string, string>) => Object.assign(style, properties));
        const element = {
            style, setCssProps,
            classList: {
                add: vi.fn((...names: string[]) => names.forEach(name => classes.add(name))),
                remove: vi.fn((...names: string[]) => names.forEach(name => classes.delete(name))),
                contains: vi.fn((name: string) => classes.has(name))
            },
            addEventListener: vi.fn(), removeEventListener: vi.fn()
        } as unknown as HTMLElement;
        return { element, classes, style, setCssProps };
    };

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
                    sessionWords: 50,
                    sessionSpeed: 1200
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
        expect(manager['isImmersiveLayout']({ type: 'immersive-chapter-status-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'immersive-sticky-notes' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'immersive-sticky-notes-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ cls: 'immersive-reference-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ cls: 'immersive-main-editor' })).toBe(true);
        expect(manager['isImmersiveLayout']({ cls: 'wn-immersive-reference-view' })).toBe(true);
        expect(manager['isImmersiveLayout']({ cls: 'wn-immersive-main-editor' })).toBe(true);
        expect(manager['isImmersiveLayout']({ type: 'markdown' })).toBe(false);
    });

    it('buildImmersiveLayout isolates normal branches without closing their leaves', async () => {
        const targetFile = { path: 'Book/Chapter1.md' } as TFile;
        const mainElement = createWorkspaceElement();
        const otherElement = createWorkspaceElement();
        const mainLeaf = {
            view: { file: targetFile },
            getViewState: vi.fn().mockReturnValue({ state: { file: targetFile.path } }),
            setViewState: vi.fn().mockResolvedValue(undefined),
            containerEl: mainElement.element
        } as unknown as WorkspaceLeaf;

        const otherLeaf = {
            detach: vi.fn(),
            view: { file: { path: 'Book/Lore.md' } },
            containerEl: otherElement.element
        } as unknown as WorkspaceLeaf;
        const split = { children: [mainLeaf, otherLeaf] } as unknown as WorkspaceSplit;
        Object.assign(mainLeaf, { parent: split });
        Object.assign(otherLeaf, { parent: split });
        Object.assign(mockPlugin.app.workspace, { rootSplit: split });

        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockReturnValue([mainLeaf]);
        vi.mocked(mockPlugin.app.workspace.iterateRootLeaves).mockImplementation((cb: (leaf: WorkspaceLeaf) => void) => {
            cb(mainLeaf);
            cb(otherLeaf);
        });

        await manager['buildImmersiveLayout'](targetFile);

        expect(otherLeaf.detach).not.toHaveBeenCalled();
        expect(otherElement.classes.has('wn-immersive-preserved-branch')).toBe(true);
        expect(mainElement.classes.has('wn-immersive-preserved-branch')).toBe(false);
        expect(mainLeaf.setViewState).toHaveBeenCalled();
        expect(mainLeaf.containerEl.classList.add).toHaveBeenCalledWith('wn-immersive-main-editor');
    });

    it('restores editor focus and viewport without rebuilding or replacing its selection', async () => {
        const file = { path: 'Book/Banner.md' } as TFile;
        const container = createWorkspaceElement().element;
        const scrollSnapshot = { marker: 'viewport-anchor' };
        const cm = { focus: vi.fn(), dispatch: vi.fn(), scrollSnapshot: vi.fn(() => scrollSnapshot) };
        const editor = {
            cm, focus: vi.fn(), setSelections: vi.fn(), scrollTo: vi.fn(),
            listSelections: vi.fn(() => [{ anchor: { line: 42, ch: 3 }, head: { line: 40, ch: 1 } }]),
            getScrollInfo: vi.fn(() => ({ left: 0, top: 1800 }))
        };
        const view = {
            file, editor, getViewType: () => 'markdown', getEphemeralState: () => ({ scroll: 31.25 }),
            getState: () => ({ file: file.path, mode: 'source' })
        };
        const mainLeaf = {
            id: 'preserved-main', active: true, view, containerEl: container,
            getViewState: vi.fn(() => ({ type: 'markdown', state: { file: file.path, mode: 'source' } })),
            setViewState: vi.fn().mockResolvedValue(undefined), detach: vi.fn()
        } as unknown as WorkspaceLeaf;
        const root = { children: [mainLeaf] } as unknown as WorkspaceSplit;
        Object.assign(mainLeaf, { parent: root });
        const changeLayout = vi.fn().mockResolvedValue(undefined);
        Object.assign(mockPlugin.app.workspace, { rootSplit: root, changeLayout });
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [mainLeaf] : []);
        await manager['buildImmersiveLayout'](file);
        manager['isImmersiveActive'] = true;
        manager['savedLayout'] = { main: { type: 'split', children: [] } };
        await manager.exitImmersiveMode();

        expect(mainLeaf.setViewState).not.toHaveBeenCalled();
        expect(mainLeaf.detach).not.toHaveBeenCalled();
        expect(changeLayout).not.toHaveBeenCalled();
        expect(editor.setSelections).not.toHaveBeenCalled();
        expect(editor.scrollTo).not.toHaveBeenCalled();
        expect(cm.focus).toHaveBeenCalledOnce();
        expect(cm.dispatch).toHaveBeenCalledWith({ effects: scrollSnapshot });
        expect(mockPlugin.app.workspace.setActiveLeaf).toHaveBeenLastCalledWith(mainLeaf, { focus: false });
    });

    it.each(['unchanged', 'scrolled', 'edited'] as const)('restores the original wrapped-text anchor only while the viewport is %s', (change) => {
        let wide = false;
        let offset = 0;
        const cm = {
            state: { doc: {} },
            scrollDOM: { clientHeight: 800, scrollTop: 1200, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
            contentDOM: { getBoundingClientRect: () => ({ left: 0 }) },
            posAtCoords: () => wide ? 50 : 61,
            coordsAtPos: () => ({ top: 24 + offset })
        };
        const view = { editor: { cm } } as unknown as MarkdownView;
        const entry = manager['captureEditorScrollEffect'](view);
        wide = true;
        manager['isImmersiveActive'] = true;
        if (change === 'scrolled') offset = 80;
        if (change === 'edited') cm.state.doc = {};
        const restored = manager['captureEditorScrollEffect'](view);
        const target = restored?.value as { range: { head: number } };
        expect(target.range.head).toBe(change === 'unchanged' ? 61 : 50);
        if (change === 'unchanged') expect(restored).toBe(entry);
        manager.cleanup();
    });

    it('keeps the visible text fixed over five typewriter round-trips', async () => {
        let header = 0;
        let scroll = 1000;
        const classes = new Set<string>();
        mockActiveDocument.body.classList.contains = vi.fn((name: string) => classes.has(name));
        mockActiveDocument.body.classList.add = vi.fn((name: string) => {
            classes.add(name);
            if (name === 'wn-immersive-mode-active') header = 300;
        });
        mockActiveDocument.body.classList.remove = vi.fn((name: string) => {
            classes.delete(name);
            if (name === 'wn-immersive-mode-active') header = 0;
        });
        const cm = {
            scrollDOM: { clientHeight: 800, get scrollTop() { return scroll; }, getBoundingClientRect: () => ({ top: 0, left: 0 }) },
            contentDOM: { getBoundingClientRect: () => ({ left: 0 }) },
            defaultLineHeight: 20,
            posAtCoords: ({ y }: { y: number }) => Math.floor((scroll - header + y) / 20),
            coordsAtPos: (pos: number) => ({ top: header + pos * 20 - scroll }),
            focus: vi.fn(),
            scrollSnapshot: vi.fn(() => ({ value: { isSnapshot: true, top: scroll } })),
            dispatch: vi.fn((spec: { effects?: unknown }) => {
                const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
                for (const effect of effects) {
                    const value = (effect as { value?: { isSnapshot?: boolean; top?: number; range?: { head: number }; yMargin?: number } })?.value;
                    if (value?.isSnapshot) scroll = value.top ?? scroll;
                    else if (value?.range) scroll = header + value.range.head * 20 - (value.yMargin ?? 0);
                }
            })
        };
        const file = { path: 'Book/Chapter.md', basename: 'Chapter', parent: { isRoot: () => true } } as unknown as TFile;
        const view = {
            file, getViewType: () => 'markdown', getMode: () => 'source',
            getState: () => ({ file: file.path, mode: 'source' }),
            // A cached progress value must not override the currently visible line.
            getEphemeralState: () => ({ scroll: 42 }),
            setEphemeralState: vi.fn((state: { scroll: number }) => { scroll = header + state.scroll * 20; }),
            editor: { cm, getScrollInfo: () => ({ top: scroll, left: 0 }), listSelections: () => [], focus: vi.fn() }
        };
        const leaf = {
            view, containerEl: createDiv(),
            getViewState: () => ({ type: 'markdown', state: { file: file.path, mode: 'source' } }),
            setViewState: vi.fn()
        } as unknown as WorkspaceLeaf;
        const root = { children: [leaf] } as unknown as WorkspaceSplit;
        Object.assign(leaf, { parent: root });
        Object.assign(mockPlugin.app.workspace, { rootSplit: root });
        vi.mocked(mockPlugin.app.workspace.getActiveViewOfType).mockReturnValue(leaf.view);
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [leaf] : []);
        mockPlugin.settings.immersive.typewriterEnabled = true;
        try {
            for (let cycle = 0; cycle < 5; cycle++) {
                await manager.toggleImmersiveMode();
                expect(scroll - header).toBe(1000);
                await manager.exitImmersiveMode();
                expect(scroll - header).toBe(1000);
            }
            expect(view.setEphemeralState).not.toHaveBeenCalled();
        } finally {
            manager.cleanup();
        }
    });

    it('uses the active editor instance when the same file is open in multiple tabs', async () => {
        const file = { path: 'Book/Chapter.md' } as TFile;
        const makeLeaf = () => ({
            view: { file }, containerEl: createWorkspaceElement().element,
            getViewState: () => ({ type: 'markdown', state: { file: file.path, mode: 'source' } }),
            setViewState: vi.fn()
        } as unknown as WorkspaceLeaf);
        const first = makeLeaf();
        const active = makeLeaf();
        const root = { children: [first, active] } as unknown as WorkspaceSplit;
        Object.assign(first, { parent: root });
        Object.assign(active, { parent: root });
        Object.assign(mockPlugin.app.workspace, { rootSplit: root });
        vi.mocked(mockPlugin.app.workspace.getActiveViewOfType).mockReturnValue(active.view);
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [first, active] : []);
        await manager['buildImmersiveLayout'](file);
        expect(manager['activeMainLeaf']).toBe(active);
        expect(mockPlugin.app.workspace.setActiveLeaf).toHaveBeenCalledWith(active, { focus: true });
        manager.cleanup();
    });

    it.each(['markdown', 'canvas'])('returns to the immersive editor when native navigation activates a hidden %s tab', type => {
        const mainElement = createWorkspaceElement();
        const hiddenElement = createWorkspaceElement();
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const hidden = {
            containerEl: hiddenElement.element,
            view: { file: { path: 'Fictional/Second.md' }, getEphemeralState: () => ({ scroll: 40 }), setEphemeralState: vi.fn() }
        } as unknown as WorkspaceLeaf;
        const tabs = { children: [main, hidden] } as unknown as WorkspaceSplit;
        Object.assign(main, { parent: tabs });
        Object.assign(hidden, { parent: tabs });
        const handlers = new Map<string, (leaf: WorkspaceLeaf | null) => void>();
        const workspace = mockPlugin.app.workspace;
        Object.assign(workspace, {
            rootSplit: tabs,
            on: vi.fn((event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
                handlers.set(event, handler);
                return { event };
            })
        });
        vi.mocked(workspace.getLeavesOfType).mockImplementation(viewType => viewType === 'markdown'
            ? (type === 'markdown' ? [main, hidden] : [main]) : []);
        vi.mocked(workspace.setActiveLeaf).mockImplementation(leaf => {
            mainElement.style.display = leaf === main ? '' : 'none';
            handlers.get('active-leaf-change')?.(leaf);
        });
        manager['activeMainLeaf'] = main;
        manager['preserveNormalWorkspace'](main);
        manager['isImmersiveActive'] = true;
        manager['registerImmersiveEventListeners']();
        try {
            // Native next-tab selects siblings without filtering plugin CSS classes.
            mainElement.style.display = 'none';
            handlers.get('active-leaf-change')?.(hidden);
            expect(workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(main, { focus: true });
            expect(mainElement.style.display).toBe('');
            expect(hiddenElement.classes.has('wn-immersive-preserved-branch')).toBe(true);
        } finally {
            manager.cleanup();
        }
    });

    it('leaves another window scroll unchanged when exiting the immersive session', () => {
        let scroll = 40;
        const mainElement = createWorkspaceElement();
        const popoutElement = createWorkspaceElement();
        Object.assign(mainElement.element, { ownerDocument: mockActiveDocument });
        Object.assign(popoutElement.element, { ownerDocument: { body: {} } });
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const popoutView = {
            file: { path: 'Fictional/Reference.md' },
            getEphemeralState: () => ({ scroll }),
            setEphemeralState: vi.fn((state: { scroll: number }) => { scroll = state.scroll; })
        };
        const popout = { containerEl: popoutElement.element, view: popoutView } as unknown as WorkspaceLeaf;
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockReturnValue([main, popout]);
        manager['preserveNormalWorkspace'](main);
        manager['isImmersiveActive'] = true;
        try {
            scroll = 90;
            const wheelHandler = vi.mocked(popoutElement.element.addEventListener).mock.calls.find(([event]) => event === 'wheel')?.[1];
            if (typeof wheelHandler === 'function') wheelHandler.call(popoutElement.element, new Event('wheel'));
            manager.cleanup();
            expect(scroll).toBe(90);
            expect(popoutView.setEphemeralState).not.toHaveBeenCalled();
            expect(manager['backgroundScrollPositions'].has(popout)).toBe(false);
        } finally {
            manager.destroy();
        }
    });

    it('discards a saved viewport when its leaf moves to another window', () => {
        let scroll = 40;
        const mainElement = createWorkspaceElement();
        const backgroundElement = createWorkspaceElement();
        Object.assign(mainElement.element, { ownerDocument: mockActiveDocument });
        Object.assign(backgroundElement.element, { ownerDocument: mockActiveDocument });
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const backgroundView = {
            file: { path: 'Fictional/Reference.md' },
            getEphemeralState: () => ({ scroll }),
            setEphemeralState: vi.fn((state: { scroll: number }) => { scroll = state.scroll; })
        };
        const background = { containerEl: backgroundElement.element, view: backgroundView } as unknown as WorkspaceLeaf;
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockReturnValue([main, background]);
        manager['preserveNormalWorkspace'](main);
        manager['isImmersiveActive'] = true;
        try {
            expect(manager['backgroundScrollPositions'].has(background)).toBe(true);
            Object.assign(backgroundElement.element, { ownerDocument: { body: {} } });
            scroll = 90;
            manager.cleanup();
            expect(scroll).toBe(90);
            expect(backgroundView.setEphemeralState).not.toHaveBeenCalled();
            expect(manager['backgroundScrollPositions'].has(background)).toBe(false);
            expect(backgroundElement.element.removeEventListener).toHaveBeenCalledTimes(4);
        } finally {
            manager.destroy();
        }
    });

    it('does not redirect active-leaf-change for visible auxiliary leaves or external windows', () => {
        const mainElement = createWorkspaceElement();
        Object.assign(mainElement.element, { ownerDocument: mockActiveDocument });
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const auxElement = createWorkspaceElement();
        Object.assign(auxElement.element, { ownerDocument: mockActiveDocument });
        const aux = { containerEl: auxElement.element, view: {} } as unknown as WorkspaceLeaf;
        const popoutElement = createWorkspaceElement();
        Object.assign(popoutElement.element, { ownerDocument: { body: {} } });
        const popout = { containerEl: popoutElement.element, view: {} } as unknown as WorkspaceLeaf;

        const handlers = new Map<string, (leaf: WorkspaceLeaf | null) => void>();
        const workspace = mockPlugin.app.workspace;
        Object.assign(workspace, {
            on: vi.fn((event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
                handlers.set(event, handler);
                return { event };
            })
        });
        vi.mocked(workspace.getLeavesOfType).mockReturnValue([main, aux, popout]);
        vi.mocked(workspace.setActiveLeaf).mockClear();

        manager['activeMainLeaf'] = main;
        manager['isImmersiveActive'] = true;
        manager['createdImmersiveLeaves'].add(aux);
        // A retained leaf moved to a different document is visible there.
        manager['preservedBranches'].add(popoutElement.element);
        manager['registerImmersiveEventListeners']();

        try {
            handlers.get('active-leaf-change')?.(aux);
            expect(workspace.setActiveLeaf).not.toHaveBeenCalled();

            handlers.get('active-leaf-change')?.(popout);
            expect(workspace.setActiveLeaf).not.toHaveBeenCalled();
        } finally {
            manager.cleanup();
        }
    });

    it.each(['cleanup', 'destroy'] as const)('unregisters active-leaf-change listener on re-registration and %s', operation => {
        const mainElement = createWorkspaceElement();
        const hiddenElement = createWorkspaceElement();
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const hidden = { containerEl: hiddenElement.element, view: {} } as unknown as WorkspaceLeaf;
        const tabs = { children: [main, hidden] } as unknown as WorkspaceSplit;
        Object.assign(main, { parent: tabs });
        Object.assign(hidden, { parent: tabs });

        const offrefSpy = vi.fn();
        let registration = 0;
        const handlers = new Map<string, (leaf: WorkspaceLeaf | null) => void>();
        const workspace = mockPlugin.app.workspace;
        Object.assign(workspace, {
            rootSplit: tabs,
            offref: offrefSpy,
            on: vi.fn((event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
                handlers.set(event, handler);
                return { event, registration: ++registration };
            })
        });

        manager['activeMainLeaf'] = main;
        manager['preserveNormalWorkspace'](main);
        manager['isImmersiveActive'] = true;
        manager['registerImmersiveEventListeners']();

        const previousRef = manager['immersiveActiveLeafRef'];
        expect(previousRef).not.toBeNull();
        manager['registerImmersiveEventListeners']();
        expect(offrefSpy).toHaveBeenCalledWith(previousRef);
        const currentRef = manager['immersiveActiveLeafRef'];
        expect(currentRef).not.toBe(previousRef);
        manager[operation]();

        expect(manager['immersiveActiveLeafRef']).toBeNull();
        expect(offrefSpy).toHaveBeenCalledWith(currentRef);
        vi.mocked(workspace.setActiveLeaf).mockClear();
        handlers.get('active-leaf-change')?.(hidden);
        expect(workspace.setActiveLeaf).not.toHaveBeenCalled();
    });

    it.each(['frame', 'timer'])('aborts delayed background scroll restore when leaf moves before the %s callback', async phase => {
        vi.useFakeTimers();
        Object.assign(window, { setTimeout, clearTimeout, cancelAnimationFrame: clearTimeout });
        let scroll = 40;
        const mainElement = createWorkspaceElement();
        const backgroundElement = createWorkspaceElement();
        Object.assign(mainElement.element, { ownerDocument: mockActiveDocument });
        Object.assign(backgroundElement.element, { ownerDocument: mockActiveDocument });
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const backgroundView = {
            file: { path: 'Fictional/Reference.md' },
            getEphemeralState: () => ({ scroll }),
            setEphemeralState: vi.fn((state: { scroll: number }) => { scroll = state.scroll; })
        };
        const background = { containerEl: backgroundElement.element, view: backgroundView } as unknown as WorkspaceLeaf;
        const handlers = new Map<string, (leaf: WorkspaceLeaf | null) => void>();
        const workspace = mockPlugin.app.workspace;
        Object.assign(workspace, {
            on: vi.fn((event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
                handlers.set(event, handler);
                return { event };
            })
        });
        vi.mocked(workspace.getLeavesOfType).mockReturnValue([main, background]);

        try {
            manager['preserveNormalWorkspace'](main);
            manager.cleanup();
            backgroundView.setEphemeralState.mockClear();

            vi.mocked(workspace.getActiveViewOfType).mockReturnValue(backgroundView as unknown as MarkdownView);
            handlers.get('active-leaf-change')?.(background);
            expect(manager['backgroundScrollFrame']).not.toBeNull();
            if (phase === 'timer') {
                await vi.advanceTimersByTimeAsync(0);
                expect(backgroundView.setEphemeralState).toHaveBeenCalledOnce();
                backgroundView.setEphemeralState.mockClear();
            }

            Object.assign(backgroundElement.element, { ownerDocument: { body: {} } });
            scroll = 90;

            await vi.runAllTimersAsync();

            expect(scroll).toBe(90);
            expect(backgroundView.setEphemeralState).not.toHaveBeenCalled();
            expect(manager['backgroundScrollPositions'].has(background)).toBe(false);
        } finally {
            manager.destroy();
            vi.useRealTimers();
        }
    });

    it('returns to the immersive editor when native navigation activates a descendant of a hidden branch', () => {
        const mainElement = createWorkspaceElement();
        const hiddenBranchElement = createWorkspaceElement();
        const childLeafElement = createWorkspaceElement();
        const main = { containerEl: mainElement.element, view: {} } as unknown as WorkspaceLeaf;
        const childLeaf = { containerEl: childLeafElement.element, view: {} } as unknown as WorkspaceLeaf;
        const hiddenBranch = { containerEl: hiddenBranchElement.element, children: [childLeaf] } as unknown as WorkspaceSplit;
        Object.assign(childLeaf, { parent: hiddenBranch });
        Object.assign(childLeafElement.element, { parentElement: hiddenBranchElement.element });
        const rootSplit = { children: [main, hiddenBranch] } as unknown as WorkspaceSplit;
        Object.assign(main, { parent: rootSplit });
        Object.assign(hiddenBranch, { parent: rootSplit });

        const handlers = new Map<string, (leaf: WorkspaceLeaf | null) => void>();
        const workspace = mockPlugin.app.workspace;
        Object.assign(workspace, {
            rootSplit,
            on: vi.fn((event: string, handler: (leaf: WorkspaceLeaf | null) => void) => {
                handlers.set(event, handler);
                return { event };
            })
        });
        vi.mocked(workspace.getLeavesOfType).mockReturnValue([main, childLeaf]);
        vi.mocked(workspace.setActiveLeaf).mockImplementation(leaf => {
            mainElement.style.display = leaf === main ? '' : 'none';
            handlers.get('active-leaf-change')?.(leaf);
        });

        manager['activeMainLeaf'] = main;
        manager['preserveNormalWorkspace'](main);
        manager['isImmersiveActive'] = true;
        manager['registerImmersiveEventListeners']();

        try {
            expect(hiddenBranchElement.classes.has('wn-immersive-preserved-branch')).toBe(true);
            handlers.get('active-leaf-change')?.(childLeaf);
            expect(workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(main, { focus: true });
            vi.mocked(workspace.setActiveLeaf).mockClear();
            manager['isTransitioning'] = true;
            handlers.get('active-leaf-change')?.(childLeaf);
            manager['isTransitioning'] = false;
            manager['isExiting'] = true;
            handlers.get('active-leaf-change')?.(childLeaf);
            manager['isExiting'] = false;
            vi.mocked(workspace.getLeavesOfType).mockReturnValue([childLeaf]);
            handlers.get('active-leaf-change')?.(childLeaf);
            expect(workspace.setActiveLeaf).not.toHaveBeenCalled();
        } finally {
            manager.cleanup();
        }
    });

    it('cleanup reveals nested normal branches and restores every original dimension', () => {
        const mainElement = createWorkspaceElement({ width: '640px', flex: '1 0 60%' });
        const tabElement = createWorkspaceElement();
        const tabsElement = createWorkspaceElement({ height: '500px' });
        const lowerElement = createWorkspaceElement({ height: '200px' });
        const columnElement = createWorkspaceElement({ width: '900px', flexBasis: '75%' });
        const sideElement = createWorkspaceElement({ width: '300px' });
        const mainLeaf = { containerEl: mainElement.element, size: 100, setDimension: vi.fn() } as unknown as WorkspaceLeaf;
        const tabLeaf = { containerEl: tabElement.element, size: undefined, detach: vi.fn() } as unknown as WorkspaceLeaf;
        const tabs = { containerEl: tabsElement.element, size: 60, children: [mainLeaf, tabLeaf], setDimension: vi.fn() } as unknown as WorkspaceSplit;
        const lower = { containerEl: lowerElement.element, size: 40, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const column = { containerEl: columnElement.element, size: 75, children: [tabs, lower], setDimension: vi.fn() } as unknown as WorkspaceSplit;
        const side = { containerEl: sideElement.element, size: 25, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const root = { children: [column, side] } as unknown as WorkspaceSplit;
        Object.assign(mainLeaf, { parent: tabs });
        Object.assign(tabs, { parent: column });
        Object.assign(column, { parent: root });
        Object.assign(mockPlugin.app.workspace, { rootSplit: root });

        manager['preserveNormalWorkspace'](mainLeaf);
        for (const element of [tabElement, lowerElement, sideElement]) {
            expect(element.classes.has('wn-immersive-preserved-branch')).toBe(true);
        }
        for (const element of [mainElement, tabsElement, columnElement]) {
            expect(element.classes.has('wn-immersive-preserved-branch')).toBe(false);
        }
        mainLeaf.size = 80;
        tabs.size = 100;
        column.size = 100;
        mainElement.style.width = '';
        mainElement.style.flex = '0 0 auto';
        tabsElement.style.height = '';
        columnElement.style.flexBasis = '100%';

        manager.cleanup();

        expect(mainLeaf.size).toBe(100);
        expect(tabs.size).toBe(60);
        expect(lower.size).toBe(40);
        expect(column.size).toBe(75);
        expect(side.size).toBe(25);
        expect(tabLeaf.size).toBeUndefined();
        expect(tabLeaf.detach).not.toHaveBeenCalled();
        expect(tabs.setDimension).toHaveBeenCalledWith(60);
        expect(column.setDimension).toHaveBeenCalledWith(75);
        expect(mainElement.style.width).toBe('640px');
        expect(mainElement.style.flex).toBe('1 0 60%');
        expect(tabsElement.style.height).toBe('500px');
        expect(columnElement.setCssProps).toHaveBeenCalledWith(expect.objectContaining({ 'flex-basis': '75%' }));
        for (const element of [tabElement, lowerElement, sideElement]) {
            expect(element.classes.has('wn-immersive-preserved-branch')).toBe(false);
        }
        expect(manager['preservedBranches'].size).toBe(0);
        expect(manager['preservedDimensions'].size).toBe(0);
    });

    it('preserves a background viewport across repeated transitions and late hidden-view scroll resets', async () => {
        vi.useFakeTimers();
        Object.assign(window, { setTimeout, clearTimeout, cancelAnimationFrame: clearTimeout });
        let logicalScroll = 75.5;
        const handlers = new Map<string, (leaf?: WorkspaceLeaf) => void>();
        const backgroundView = {
            file: { path: 'Book/Original.md' },
            getEphemeralState: () => ({ scroll: logicalScroll }),
            setEphemeralState: vi.fn((state: { scroll: number }) => { logicalScroll = state.scroll; }),
            editor: { focus: vi.fn(), setSelections: vi.fn() }
        };
        const background = { view: backgroundView, containerEl: createDiv() } as unknown as WorkspaceLeaf;
        const main = { view: {}, containerEl: createDiv() } as unknown as WorkspaceLeaf;
        const workspace = mockPlugin.app.workspace;
        vi.mocked(workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [main, background] : []);
        Object.assign(workspace, { on: vi.fn((event: string, handler: (leaf?: WorkspaceLeaf) => void) => {
            handlers.set(event, handler);
            return { event };
        }) });
        try {
            manager['preserveNormalWorkspace'](main);
            logicalScroll = 0; // Hidden editor measurements can overwrite Obsidian's native scroll record.
            manager.cleanup();
            expect(logicalScroll).toBe(75.5);

            logicalScroll = 0; // A later measurement happens after cleanup, while the tab is still hidden.
            manager['preserveNormalWorkspace'](main);
            manager.cleanup();
            expect(logicalScroll).toBe(75.5);

            logicalScroll = 0;
            vi.mocked(workspace.getActiveViewOfType).mockReturnValue(backgroundView as unknown as MarkdownView);
            handlers.get('active-leaf-change')?.(background);
            setTimeout(() => { logicalScroll = 0; }, 30); // A reading-progress plugin restores its stale record after activation.
            await vi.runAllTimersAsync();
            expect(logicalScroll).toBe(75.5);
            expect(backgroundView.setEphemeralState).toHaveBeenLastCalledWith({ scroll: 75.5 });
            expect(backgroundView.editor.focus).not.toHaveBeenCalled();
            expect(backgroundView.editor.setSelections).not.toHaveBeenCalled();
            expect(workspace.setActiveLeaf).not.toHaveBeenCalled();
            expect(manager['backgroundScrollPositions'].size).toBe(0);
            expect(manager['backgroundScrollLeafRef']).toBeNull();

            manager['preserveNormalWorkspace'](main);
            logicalScroll = 0;
            manager.cleanup();
            handlers.get('active-leaf-change')?.(background);
            await vi.advanceTimersByTimeAsync(0);
            logicalScroll = 120; // A new user scroll supersedes the saved viewport.
            const wheelHandler = vi.mocked(background.containerEl.addEventListener).mock.calls
                .filter(([event]) => event === 'wheel').slice(-1)[0]?.[1];
            expect(typeof wheelHandler).toBe('function');
            if (typeof wheelHandler === 'function') wheelHandler.call(background.containerEl, new Event('wheel'));
            await vi.runAllTimersAsync();
            expect(logicalScroll).toBe(120);
            expect(manager['backgroundScrollPositions'].size).toBe(0);
        } finally {
            manager.destroy();
            vi.useRealTimers();
        }
    });

    it('discards saved background scroll when a tab changes files and releases tracking on destroy', () => {
        const main = { view: {}, containerEl: createDiv() } as unknown as WorkspaceLeaf;
        const backgroundView = {
            file: { path: 'Book/Original.md' }, getEphemeralState: () => ({ scroll: 50 }),
            setEphemeralState: vi.fn()
        };
        const background = { view: backgroundView } as unknown as WorkspaceLeaf;
        const workspace = mockPlugin.app.workspace;
        vi.mocked(workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [main, background] : []);
        manager['preserveNormalWorkspace'](main);
        backgroundView.file = { path: 'Book/Other.md' };
        manager.cleanup();
        expect(backgroundView.setEphemeralState).not.toHaveBeenCalled();
        expect(manager['backgroundScrollPositions'].size).toBe(0);

        manager['preserveNormalWorkspace'](main);
        manager.destroy();
        expect(manager['backgroundScrollPositions'].size).toBe(0);
        expect(manager['backgroundScrollLeafRef']).toBeNull();
        expect(manager['backgroundScrollLayoutRef']).toBeNull();
        expect(manager['backgroundScrollFrame']).toBeNull();
    });

    it('discards visible inactive split snapshot on wheel without affecting hidden tab or reverting on roundtrip', async () => {
        vi.useFakeTimers();
        const main = { view: { file: { path: 'Book/Chapter1.md' } }, containerEl: createDiv() } as unknown as WorkspaceLeaf;
        let inactiveScroll = 12.36;
        const inactiveContainer = createDiv();
        const inactiveView = {
            file: { path: 'Book/Chapter2.md' },
            getEphemeralState: () => ({ scroll: inactiveScroll }),
            setEphemeralState: vi.fn((state: { scroll?: number }) => {
                if (typeof state.scroll === 'number') inactiveScroll = state.scroll;
            }),
            editor: { focus: vi.fn(), setSelections: vi.fn() }
        };
        const inactiveSplit = { view: inactiveView, containerEl: inactiveContainer } as unknown as WorkspaceLeaf;

        let hiddenScroll = 45.0;
        const hiddenContainer = createDiv();
        const hiddenView = {
            file: { path: 'Book/Chapter3.md' },
            getEphemeralState: () => ({ scroll: hiddenScroll }),
            setEphemeralState: vi.fn((state: { scroll?: number }) => {
                if (typeof state.scroll === 'number') hiddenScroll = state.scroll;
            }),
            editor: { focus: vi.fn(), setSelections: vi.fn() }
        };
        const hiddenTab = { view: hiddenView, containerEl: hiddenContainer } as unknown as WorkspaceLeaf;

        const workspace = mockPlugin.app.workspace;
        vi.mocked(workspace.getLeavesOfType).mockImplementation(type =>
            type === 'markdown' ? [main, inactiveSplit, hiddenTab] : []
        );

        try {
            // Session 1: capture background leaves
            manager['preserveNormalWorkspace'](main);
            expect(manager['backgroundScrollPositions'].size).toBe(2);

            // Exit to normal mode
            manager.cleanup();
            // Both survive cleanup into normal mode
            expect(manager['backgroundScrollPositions'].size).toBe(2);

            // User wheels on inactive split in normal mode (inactive split never became active leaf)
            inactiveScroll = 22.38;
            const wheelHandler = vi.mocked(inactiveContainer.addEventListener).mock.calls
                .find(([event]) => event === 'wheel')?.[1];
            expect(typeof wheelHandler).toBe('function');
            if (typeof wheelHandler === 'function') {
                wheelHandler.call(inactiveContainer, new Event('wheel'));
            }

            // Inactive split snapshot discarded, but hidden tab snapshot retained!
            expect(manager['backgroundScrollPositions'].has(inactiveSplit)).toBe(false);
            expect(manager['backgroundScrollPositions'].has(hiddenTab)).toBe(true);

            // Session 2: enter immersive again
            manager['preserveNormalWorkspace'](main);
            // Inactive split newly captured at 22.38; hidden tab kept original 45.0
            const inactiveEntry = manager['backgroundScrollPositions'].get(inactiveSplit);
            const hiddenEntry = manager['backgroundScrollPositions'].get(hiddenTab);
            expect(inactiveEntry?.scroll).toBe(22.38);
            expect(hiddenEntry?.scroll).toBe(45.0);

            // Destroy cleans up listeners on both
            manager.destroy();
            expect(manager['backgroundScrollPositions'].size).toBe(0);
            expect(inactiveContainer.removeEventListener).toHaveBeenCalled();
            expect(hiddenContainer.removeEventListener).toHaveBeenCalled();
        } finally {
            manager.destroy();
            vi.useRealTimers();
        }
    });

    it('keeps another leaf restoration pending when an inactive split discards its snapshot', async () => {
        vi.useFakeTimers();
        Object.assign(window, { setTimeout, clearTimeout, cancelAnimationFrame: clearTimeout });
        const handlers = new Map<string, (leaf?: WorkspaceLeaf) => void>();
        const main = { view: {}, containerEl: createDiv() } as unknown as WorkspaceLeaf;
        const makeBackground = (path: string) => ({
            view: {
                file: { path }, getEphemeralState: () => ({ scroll: 40 }),
                setEphemeralState: vi.fn()
            },
            containerEl: createDiv()
        } as unknown as WorkspaceLeaf);
        const active = makeBackground('Book/Active.md');
        const inactive = makeBackground('Book/Inactive.md');
        const workspace = mockPlugin.app.workspace;
        vi.mocked(workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [main, active, inactive] : []);
        Object.assign(workspace, { on: vi.fn((event: string, handler: (leaf?: WorkspaceLeaf) => void) => {
            handlers.set(event, handler);
            return { event };
        }) });
        try {
            manager['preserveNormalWorkspace'](main);
            manager.cleanup();
            vi.mocked(workspace.getActiveViewOfType).mockReturnValue(active.view as MarkdownView);
            handlers.get('active-leaf-change')?.(active);
            await vi.advanceTimersByTimeAsync(0);
            const pending = manager['backgroundScrollFrame'];
            expect(pending?.leaf).toBe(active);
            const wheelHandler = vi.mocked(inactive.containerEl.addEventListener).mock.calls
                .find(([event]) => event === 'wheel')?.[1];
            if (typeof wheelHandler === 'function') wheelHandler.call(inactive.containerEl, new Event('wheel'));
            expect(manager['backgroundScrollFrame']).toBe(pending);
            expect(manager['backgroundScrollPositions'].has(inactive)).toBe(false);
            expect(inactive.containerEl.removeEventListener).toHaveBeenCalledTimes(4);
            await vi.runAllTimersAsync();
            expect(active.view.setEphemeralState).toHaveBeenCalledTimes(3);
            expect(active.containerEl.removeEventListener).toHaveBeenCalledTimes(4);
            expect(manager['backgroundScrollPositions'].size).toBe(0);
            expect(manager['backgroundScrollLeafRef']).toBeNull();
            expect(manager['backgroundScrollFrame']).toBeNull();
        } finally {
            manager.destroy();
            vi.useRealTimers();
        }
    });

    it('applies preserveTypewriterViewport on exit when ordinary editorTypewriter is enabled and immersive typewriter is disabled', async () => {
        mockPlugin.settings.editorTypewriter = { enabled: true, centerOffset: 0, unfocusedOpacity: 0.4 };
        mockPlugin.settings.immersive.typewriterEnabled = false;

        const file = { path: 'Book/Chapter1.md' } as TFile;
        const cm = { dispatch: vi.fn(), focus: vi.fn() };
        const view = { file, editor: { cm }, getState: () => ({}) };
        const leaf = {
            id: 'main-editor',
            view,
            containerEl: createDiv()
        } as unknown as WorkspaceLeaf;

        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [leaf] : []);
        vi.mocked(mockPlugin.app.workspace.getActiveViewOfType).mockReturnValue(view as unknown as MarkdownView);

        manager['preservedMainLeaf'] = leaf;
        manager['isImmersiveActive'] = true;

        await manager.exitImmersiveMode();

        const dispatchCalls = vi.mocked(cm.dispatch).mock.calls;
        const hasPreservedEffect = dispatchCalls.some(([arg]) => {
            const tr = arg as { effects?: StateEffect<null> } | undefined;
            return Boolean(tr?.effects && typeof tr.effects === 'object' && tr.effects.is(preserveTypewriterViewport));
        });
        expect(hasPreservedEffect).toBe(true);
    });

    it('applySplitSizes excludes preserved normal branches from dimension assignment', async () => {
        const hiddenElement = createWorkspaceElement({ width: '300px' });
        const auxiliary = { containerEl: createWorkspaceElement().element, size: 0, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const main = { containerEl: createWorkspaceElement().element, size: 0, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const hidden = { containerEl: hiddenElement.element, size: 35, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const split = { children: [hidden, auxiliary, main], unsetElSize: vi.fn() } as unknown as WorkspaceSplit;
        manager['preservedBranches'].add(hiddenElement.element);

        await manager['applySplitSizes']([{ split, sizes: [20, 80] }]);

        expect(hidden.size).toBe(35);
        expect(hidden.setDimension).not.toHaveBeenCalled();
        expect(hiddenElement.style.width).toBe('300px');
        expect(split.unsetElSize).not.toHaveBeenCalledWith(hiddenElement.element);
        expect(auxiliary.size).toBe(20);
        expect(main.size).toBe(80);
        expect(auxiliary.setDimension).toHaveBeenCalledWith(20);
        expect(main.setDimension).toHaveBeenCalledWith(80);
    });

    it('normalizes the visible region without changing a preserved sibling', () => {
        const region = 'left';
        const hiddenElement = createWorkspaceElement();
        const hidden = { containerEl: hiddenElement.element, size: 35, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const main = { containerEl: createWorkspaceElement().element, size: 65, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const auxiliary = { containerEl: createWorkspaceElement().element, size: 0, setDimension: vi.fn() } as unknown as WorkspaceItem;
        const split = { children: [hidden, auxiliary, main] } as unknown as WorkspaceSplit;
        manager['preservedBranches'].add(hiddenElement.element);
        mockPlugin.settings.immersive.immersiveLeftSlots = ['chapter-list'];
        mockPlugin.settings.immersive.immersiveLeftSize = 25;
        manager['regionBranches'].set(region, { region, branchItem: auxiliary, parentSplit: split, firstLeaf: auxiliary as WorkspaceLeaf });

        manager['normalizeVisibleSplitProportions']();

        expect(hidden.setDimension).not.toHaveBeenCalled();
        expect(auxiliary.setDimension).toHaveBeenCalledWith(25);
        expect(main.setDimension).toHaveBeenCalledWith(75);
    });

    it('restores the visible viewport before a pending native fullscreen transition can paint', async () => {
        const file = { path: 'Book/Chapter1.md', basename: 'Chapter1', parent: { isRoot: () => true } } as unknown as TFile;
        const snapshot = { marker: 'visible-viewport' };
        let scroll = 1400;
        let finishFullscreen = () => {};
        const fullscreen = new Promise<void>(resolve => { finishFullscreen = resolve; });
        mockActiveDocument.documentElement.requestFullscreen = vi.fn(() => fullscreen);
        const cm = {
            scrollSnapshot: vi.fn(() => snapshot),
            dispatch: vi.fn((transaction: { effects?: unknown }) => {
                if (transaction.effects === snapshot) scroll = 1400;
            })
        };
        const leaf = {
            view: { file, editor: { cm } },
            containerEl: createDiv(),
            getViewState: () => ({ type: 'markdown', state: { file: file.path, mode: 'source' } }),
            setViewState: vi.fn()
        } as unknown as WorkspaceLeaf;
        vi.mocked(mockPlugin.app.workspace.getActiveViewOfType).mockReturnValue(leaf.view);
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [leaf] : []);
        // Reparenting/focusing the editor during split creation can reset native scrollTop.
        vi.mocked(mockPlugin.app.workspace.setActiveLeaf).mockImplementation(() => { scroll = 0; });

        const entering = manager['enterImmersiveMode']();
        try {
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(manager['isTransitioning']).toBe(true);
            expect(mockActiveDocument.documentElement.requestFullscreen).toHaveBeenCalled();
            expect(scroll).toBe(1400);
            expect(cm.dispatch).toHaveBeenCalledWith({ effects: snapshot });
        } finally {
            finishFullscreen();
            await entering;
            manager.cleanup();
        }
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

    it('restores the main chapter, selection, scroll and focus when the workspace must be rebuilt', async () => {
        const file = { path: 'Book/Chapter-2.md' };
        const selections = [{ anchor: { line: 80, ch: 3 }, head: { line: 78, ch: 1 } }];
        const mainLeaf = {
            id: 'main-editor',
            view: {
                file,
                getViewType: () => 'markdown',
                getState: vi.fn(() => ({ file: file.path, mode: 'source', source: true })),
                editor: {
                    listSelections: vi.fn(() => selections),
                    getScrollInfo: vi.fn(() => ({ top: 1800, left: 12 }))
                }
            }
        } as unknown as WorkspaceLeaf;
        let scroll = 0;
        let focused = false;
        let restoredSelections: unknown;
        const restoredEditor = {
            cm: { dispatch: vi.fn() },
            setSelections: vi.fn((value: unknown) => { restoredSelections = value; scroll = 0; }),
            focus: vi.fn(() => { focused = true; scroll = 0; }),
            scrollTo: vi.fn((left: number, top: number) => { expect(left).toBe(12); scroll = top; })
        };
        const restoredLeaf = {
            id: 'main-editor',
            active: false,
            view: { file, editor: restoredEditor },
            setViewState: vi.fn(async () => {
                await Promise.resolve();
                scroll = 0;
                focused = false;
                restoredSelections = undefined;
            })
        } as unknown as WorkspaceLeaf;
        const otherLeaf = {
            id: 'other-editor', active: true,
            view: { file: { path: 'Book/Reference.md' } },
            setViewState: vi.fn()
        } as unknown as WorkspaceLeaf;
        manager['isImmersiveActive'] = true;
        manager['activeMainLeaf'] = mainLeaf;
        const workspace = mockPlugin.app.workspace;
        vi.mocked(workspace.getActiveViewOfType).mockReturnValue(otherLeaf.view);
        vi.mocked(workspace.getLeavesOfType).mockImplementation(type => type === 'markdown' ? [otherLeaf, restoredLeaf] : []);
        vi.mocked(workspace.updateOptions).mockImplementation(() => { scroll = 0; });
        manager['savedLayout'] = { main: { type: 'split', children: [] } };
        Object.assign(workspace, { changeLayout: vi.fn().mockResolvedValue(undefined) });

        await manager.exitImmersiveMode();
        // Also catch restoration scheduled after the method resolves.
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(workspace.setActiveLeaf).toHaveBeenCalledWith(restoredLeaf, { focus: true });
        expect(focused).toBe(true);
        expect(restoredSelections).toEqual(selections);
        expect(scroll).toBe(1800);
        expect(otherLeaf.setViewState).not.toHaveBeenCalled();
        expect(restoredLeaf.setViewState).toHaveBeenCalledWith({
            type: 'markdown', state: { file: file.path, mode: 'source', source: true }, active: true
        });
    });

    it('cancels pending layout scroll restoration when the user scrolls', async () => {
        vi.useFakeTimers();
        const handlers = new Map<string, () => void>();
        const dom = {
            addEventListener: vi.fn((type: string, handler: () => void) => handlers.set(type, handler)),
            removeEventListener: vi.fn()
        };
        const view = {
            file: { path: 'Book/Banner.md' },
            editor: {
                cm: { dom, scrollDOM: { scrollHeight: 4000 }, state: { doc: {} } },
                scrollTo: vi.fn()
            },
            setEphemeralState: vi.fn()
        };
        try {
            const restoration = manager['restoreLogicalScroll'](view as unknown as MarkdownView, 31.25, 0);
            handlers.get('wheel')?.();
            await vi.runAllTimersAsync();
            await restoration;
            expect(view.setEphemeralState).not.toHaveBeenCalled();
            expect(view.editor.scrollTo).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
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
        expect(mainLeaf.containerEl.classList.add).toHaveBeenCalledWith('wn-immersive-main-editor');
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
        expect(auxLeaf.containerEl.classList.add).toHaveBeenCalledWith('wn-immersive-reference-view');
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
        mockActiveDocument.body.classList.contains = vi.fn((cls: string) => cls === 'wn-immersive-mode-active');

        const mockDispatch = vi.fn();
        const mockActiveView = {
            editor: {
                cm: { dispatch: mockDispatch }
            }
        };
        (mockPlugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(mockActiveView as unknown as MarkdownView);

        await manager.exitImmersiveMode();

        // 1. cleanup 移除沉浸模式与打字机类名、重置 CSS 变量
        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('wn-immersive-mode-active');
        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('wn-immersive-hide-properties');
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

        expect(mockActiveDocument.body.classList.remove).toHaveBeenCalledWith('wn-immersive-mode-active');
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
        (mockActiveDocument.body.classList.contains as unknown as ReturnType<typeof vi.fn>).mockImplementation((cls: string) => cls === 'wn-immersive-mode-active');

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
        (mockActiveDocument.body.classList.contains as unknown as ReturnType<typeof vi.fn>).mockImplementation((cls: string) => cls === 'wn-immersive-mode-active');
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
        (mockActiveDocument.body.classList.contains as unknown as ReturnType<typeof vi.fn>).mockImplementation((cls: string) => cls === 'wn-immersive-mode-active');
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
                    contains: vi.fn((cls: string) => cls === 'wn-immersive-main-editor')
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
            expect(mockPlugin.stopTracking).toHaveBeenCalledTimes(1);
            expect(mockPlugin.startTracking).not.toHaveBeenCalled();

            // Advance further and check again on subsequent ticks: must not duplicate
            vi.spyOn(Date, 'now').mockReturnValue(deadline + 5000);
            manager['checkPomodoroReminder']();
            expect(manager['activePomodoroModal']).toBe(activeModal);
            expect(mockPlugin.stopTracking).toHaveBeenCalledTimes(1);

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
            expect(mockPlugin.stopTracking).toHaveBeenCalledTimes(1);
            expect(mockPlugin.startTracking).not.toHaveBeenCalled();

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
            expect(mockPlugin.stopTracking).toHaveBeenCalledTimes(1);
            expect(mockPlugin.startTracking).not.toHaveBeenCalled();

            // User pauses/rests until clickTime = 3,500,000 before clicking "开启下一轮"
            const clickTime = 3_500_000;
            vi.spyOn(Date, 'now').mockReturnValue(clickTime);
			(modal as unknown as { actionTaken: 'next' | 'dismiss' | null }).actionTaken = 'next';
            modal.close();

            expect(manager['activePomodoroModal']).toBeNull();
            expect(manager['isPomodoroDismissed']).toBe(false);
            expect(mockPlugin.startTracking).toHaveBeenCalledTimes(1);
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
            expect(mockPlugin.stopTracking).toHaveBeenCalledTimes(2);

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
            expect(manager['topBarEl']?.className).toBe('wn-immersive-top-bar');
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

        it('shows session speed only when enabled', async () => {
            manager['createTopBar']();
            const sessionSpeedEl = manager['topBarStatsEls'].sessionSpeed as HTMLElement;
            expect(sessionSpeedEl).toBeDefined();

            // Default: disabled -> hidden
            expect(sessionSpeedEl.isShown()).toBe(false);

            // Enable session speed
            mockPlugin.settings.immersive.immersiveShowSessionSpeed = true;
            await manager['renderTopBarContent']();
            expect(sessionSpeedEl.isShown()).toBe(true);
            expect(sessionSpeedEl.innerText).toContain('1200');

            mockPlugin.settings.immersive.immersiveShowSessionSpeed = false;
            await manager['renderTopBarContent']();
            expect(sessionSpeedEl.isShown()).toBe(false);

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
        let setReferenceFilePathSpy: ReturnType<typeof vi.fn<(workPath: string, refPath: string | null) => Promise<void>>>;
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
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'wn-immersive-reference-view' },
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
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'wn-immersive-reference-view' },
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
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'wn-immersive-reference-view' },
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
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'wn-immersive-reference-view' },
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
                containerEl: { classList: { contains: (c: string) => c === 'wn-immersive-main-editor' } }
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
                    classList: { add: vi.fn(), remove: vi.fn(), contains: (cls: string) => cls === 'wn-immersive-reference-view' },
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
                        contains: (cls: string) => cls === 'wn-immersive-reference-view',
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
                    classList: { contains: (cls: string) => cls === 'wn-immersive-reference-view' },
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
            setAttribute: ReturnType<typeof vi.fn<(k: string, v: string) => void>>;
            getAttribute: ReturnType<typeof vi.fn<(k: string) => string | undefined>>;
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
                        sessionWords: 0,
                        sessionSpeed: 0
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

        it('hides both typewriter controls without disabling scrolling and restores them when shown', async () => {
            const immersive = mockPlugin.settings.immersive;
            immersive.typewriterEnabled = true;
            immersive.immersiveShowTypewriterControls = false;
            manager['createTopBar']();

            const controls = manager['typewriterControlsEl'];
            expect(controls?.isShown()).toBe(false);

            immersive.immersiveShowTypewriterControls = true;
            await manager['renderTopBarContent']();
            expect(controls?.isShown()).toBe(true);
            expect(manager['typewriterToggle']?.getValue()).toBe(true);

            const gearBtn = manager['typewriterGearBtn'] as unknown as GearElement;
            gearBtn.trigger('click');
            expect(manager['activeTypewriterQuickModal']).not.toBeNull();

            immersive.immersiveShowTypewriterControls = false;
            await manager['renderTopBarContent']();
            expect(controls?.isShown()).toBe(false);
            expect(manager['activeTypewriterQuickModal']).toBeNull();
            expect(immersive.typewriterEnabled).toBe(true);
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
                    sessionWords: 50,
                    sessionSpeed: 1200
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

        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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
        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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
        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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
        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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

        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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
        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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

        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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

        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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

        const mainLeafEl = createAuxElement('wn-immersive-main-editor');
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

    it('sanitizeNormalWorkspace detaches leftover immersive-chapter-status-view leaves', () => {
        const leftoverLeaf = { detach: vi.fn() } as unknown as WorkspaceLeaf;
        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation((type: string) =>
            type === 'immersive-chapter-status-view' ? [leftoverLeaf] : []
        );

        manager['isImmersiveActive'] = false;
        manager.sanitizeNormalWorkspace();

        expect(leftoverLeaf.detach).toHaveBeenCalledTimes(1);
    });

    it('refreshImmersiveChapterStatusViews updates immersive-chapter-status-view without touching ordinary status view', () => {
        const chapterStatusUpdate = vi.fn();
        const ordinaryStatusUpdate = vi.fn();
        const chapterStatusLeaf = { view: { updateData: chapterStatusUpdate } } as unknown as WorkspaceLeaf;
        const ordinaryStatusLeaf = { view: { updateData: ordinaryStatusUpdate } } as unknown as WorkspaceLeaf;

        vi.mocked(mockPlugin.app.workspace.getLeavesOfType).mockImplementation((type: string) => {
            if (type === 'immersive-chapter-status-view') return [chapterStatusLeaf];
            if (type === 'writing-status-view') return [ordinaryStatusLeaf];
            return [];
        });

        manager['refreshImmersiveChapterStatusViews']();

        expect(chapterStatusUpdate).toHaveBeenCalledWith(true);
        expect(ordinaryStatusUpdate).not.toHaveBeenCalled();
    });
});

describe('ImmersiveModeManager - Mobile immersive lifecycle, lock/geometry and isolation', () => {
    it('enters and exits mobile immersive without desktop fullscreen/splits and follows desktop focus tracking', async () => {
        const { Platform, MarkdownView: MockMarkdownView } = await import('obsidian');
        const originalIsMobile = Platform.isMobile;
        Platform.isMobile = true;

        try {
            const bodyClasses = new Set<string>(['is-phone']);
            const cssProps: Record<string, string> = {};
            const appendedChildren: unknown[] = [];
            const makeEl = (tag = 'div', cls = ''): Record<string, unknown> => {
                const classes = new Set<string>(cls ? cls.split(/\s+/).filter(Boolean) : []);
                const listeners = new Map<string, Array<(e: unknown) => void>>();
                const attrs = new Map<string, string>();
                const children: Array<Record<string, unknown>> = [];
                const el: Record<string, unknown> = {
                    tagName: tag.toUpperCase(),
                    className: cls,
                    style: {},
                    hidden: false,
                    textContent: '',
                    innerText: '',
                    value: '',
                    offsetWidth: 320,
                    offsetHeight: 44,
                    children,
                    parentElement: null as Record<string, unknown> | null,
                    ownerDocument: null as unknown,
                    classList: {
                        add: (...names: string[]) => names.forEach(n => classes.add(n)),
                        remove: (...names: string[]) => names.forEach(n => classes.delete(n)),
                        contains: (name: string) => classes.has(name),
                        toggle: (name: string, force?: boolean) => {
                            const next = force ?? !classes.has(name);
                            if (next) classes.add(name);
                            else classes.delete(name);
                            return next;
                        }
                    },
                    addClass: (...names: string[]) => names.forEach(n => classes.add(n)),
                    removeClass: (...names: string[]) => names.forEach(n => classes.delete(n)),
                    hasClass: (name: string) => classes.has(name),
                    setCssProps: (props: Record<string, string>) => Object.assign(cssProps, props),
                    setCssStyles: (styles: Record<string, string>) => Object.assign(el.style as Record<string, string>, styles),
                    setAttribute: (k: string, v: string) => attrs.set(k, v),
                    getAttribute: (k: string) => attrs.get(k) ?? null,
                    removeAttribute: (k: string) => attrs.delete(k),
                    show: () => { el.hidden = false; classes.delete('is-hidden'); },
                    hide: () => { el.hidden = true; },
                    isShown: () => !el.hidden,
                    empty: () => { children.length = 0; },
                    remove: () => {
                        const parent = el.parentElement as { children?: unknown[] } | null;
                        if (parent?.children) {
                            const idx = parent.children.indexOf(el);
                            if (idx >= 0) parent.children.splice(idx, 1);
                        }
                        el.parentElement = null;
                    },
                    appendChild: (child: Record<string, unknown>) => {
                        child.parentElement = el;
                        children.push(child);
                        return child;
                    },
                    insertBefore: (child: Record<string, unknown>) => {
                        child.parentElement = el;
                        children.push(child);
                        return child;
                    },
                    contains: (node: unknown) => node === el || children.includes(node as Record<string, unknown>),
                    addEventListener: (evt: string, fn: (e: unknown) => void) => {
                        const arr = listeners.get(evt) ?? [];
                        arr.push(fn);
                        listeners.set(evt, arr);
                    },
                    removeEventListener: (evt: string, fn: (e: unknown) => void) => {
                        const arr = listeners.get(evt) ?? [];
                        listeners.set(evt, arr.filter(h => h !== fn));
                    },
                    dispatchEvent: (evt: string, payload?: unknown) => {
                        for (const fn of listeners.get(evt) ?? []) fn(payload);
                    },
                    querySelector: () => null,
                    querySelectorAll: () => [],
                    getElementsByClassName: () => [],
                    createDiv: (opts?: string | { cls?: string; text?: string }) => {
                        const c = typeof opts === 'string' ? opts : (opts?.cls || '');
                        const child = makeEl('div', c);
                        if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
                        child.ownerDocument = el.ownerDocument;
                        (el.appendChild as (n: Record<string, unknown>) => unknown)(child);
                        return child;
                    },
                    createSpan: (opts?: string | { cls?: string; text?: string }) => {
                        const c = typeof opts === 'string' ? opts : (opts?.cls || '');
                        const child = makeEl('span', c);
                        if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
                        child.ownerDocument = el.ownerDocument;
                        (el.appendChild as (n: Record<string, unknown>) => unknown)(child);
                        return child;
                    },
                    createEl: (t: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => {
                        const child = makeEl(t, opts?.cls || '');
                        if (opts?.text) child.textContent = opts.text;
                        if (opts?.attr) {
                            for (const [k, v] of Object.entries(opts.attr)) {
                                (child.setAttribute as (a: string, b: string) => void)(k, v);
                            }
                        }
                        child.ownerDocument = el.ownerDocument;
                        (el.appendChild as (n: Record<string, unknown>) => unknown)(child);
                        return child;
                    }
                };
                return el;
            };

            const mockWin = {
                innerWidth: 390,
                innerHeight: 844,
                visualViewport: {
                    width: 390,
                    height: 844,
                    offsetTop: 0,
                    offsetLeft: 0,
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn()
                },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                requestAnimationFrame: vi.fn((fn: () => void) => { fn(); return 1; }),
                cancelAnimationFrame: vi.fn(),
                setTimeout,
                clearTimeout,
                setInterval,
                clearInterval
            };

            const bodyEl = makeEl('body', 'is-phone');
            (bodyEl.classList as { add: (...n: string[]) => void; remove: (...n: string[]) => void; contains: (n: string) => boolean }).add = (...n) => n.forEach(x => bodyClasses.add(x));
            (bodyEl.classList as { add: (...n: string[]) => void; remove: (...n: string[]) => void; contains: (n: string) => boolean }).remove = (...n) => n.forEach(x => bodyClasses.delete(x));
            (bodyEl.classList as { add: (...n: string[]) => void; remove: (...n: string[]) => void; contains: (n: string) => boolean }).contains = (n) => bodyClasses.has(n);
            const origAppend = bodyEl.appendChild as (child: Record<string, unknown>) => Record<string, unknown>;
            bodyEl.appendChild = (child: Record<string, unknown>) => {
                appendedChildren.push(child);
                return origAppend(child);
            };

            const mockDoc = {
                body: bodyEl,
                defaultView: mockWin,
                documentElement: {
                    requestFullscreen: vi.fn().mockResolvedValue(undefined)
                },
                fullscreenElement: null,
                exitFullscreen: vi.fn().mockResolvedValue(undefined),
                activeElement: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            };
            bodyEl.ownerDocument = mockDoc;

            (globalThis as Record<string, unknown>).activeDocument = mockDoc;
            (globalThis as Record<string, unknown>).window = mockWin;
            (globalThis as Record<string, unknown>).createDiv = (opts?: string | { cls?: string }) => {
                const el = makeEl('div', typeof opts === 'string' ? opts : (opts?.cls || ''));
                el.ownerDocument = mockDoc;
                return el;
            };

            const chapterFile = Object.assign(new TFile(), { path: 'Novels/BookA/Chapter1.md', basename: 'Chapter1', extension: 'md' });
            const mainContainer = makeEl('div', 'workspace-leaf');
            mainContainer.ownerDocument = mockDoc;
            const mainView = Object.assign(Object.create(MockMarkdownView.prototype), {
                file: chapterFile,
                getViewType: () => 'markdown',
                editor: {
                    cm: { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() },
                    focus: vi.fn(),
                    getScrollInfo: () => ({ top: 0, left: 0 }),
                    listSelections: () => []
                },
                containerEl: mainContainer
            });
            const mainLeaf = {
                id: 'main-1',
                active: true,
                view: mainView,
                containerEl: mainContainer,
                getViewState: () => ({ type: 'markdown', state: { file: chapterFile.path, mode: 'source' } }),
                setViewState: vi.fn().mockResolvedValue(undefined)
            } as unknown as WorkspaceLeaf;

            const createdRightLeaves: Array<{ detach: ReturnType<typeof vi.fn> }> = [];
            const mockMobileFloatingStats = { update: vi.fn() };
            const desktopLeftSlots = ['immersive-chapter-list-view'];
            const desktopRightSlots = ['reference-view'];

            const mockPlugin = {
                app: {
                    workspace: {
                        getActiveViewOfType: vi.fn().mockReturnValue(mainView),
                        getLeavesOfType: vi.fn((type: string) => type === 'markdown' ? [mainLeaf] : []),
                        iterateAllLeaves: vi.fn((cb: (l: WorkspaceLeaf) => void) => cb(mainLeaf)),
                        getRightLeaf: vi.fn(() => {
                            const c = makeEl('div', 'workspace-leaf');
                            c.ownerDocument = mockDoc;
                            const leaf = {
                                containerEl: c,
                                view: { getViewType: () => 'empty' },
                                setViewState: vi.fn().mockResolvedValue(undefined),
                                openFile: vi.fn().mockResolvedValue(undefined),
                                detach: vi.fn()
                            };
                            createdRightLeaves.push(leaf);
                            return leaf;
                        }),
                        createLeafBySplit: vi.fn(),
                        getLayout: vi.fn().mockReturnValue({ main: true }),
                        changeLayout: vi.fn().mockResolvedValue(undefined),
                        setActiveLeaf: vi.fn(),
                        updateOptions: vi.fn(),
                        on: vi.fn().mockReturnValue({ id: 'ev' }),
                        offref: vi.fn(),
                        trigger: vi.fn()
                    },
                    vault: {
                        getName: () => 'TestVault',
                        getAbstractFileByPath: vi.fn((p: string) => p === chapterFile.path ? chapterFile : null),
                        on: vi.fn().mockReturnValue({ id: 'vev' }),
                        offref: vi.fn()
                    },
                    metadataCache: {
                        getFileCache: vi.fn().mockReturnValue({ headings: [{ heading: 'Section One', level: 2, position: { start: { line: 3, col: 0, offset: 10 }, end: { line: 3, col: 14, offset: 24 } } }] }),
                        on: vi.fn().mockReturnValue({ id: 'mev' }),
                        offref: vi.fn()
                    },
                    commands: { executeCommandById: vi.fn() }
                },
                isTracking: false,
                focusMs: 0,
                mobileFloatingStats: mockMobileFloatingStats,
                settings: {
                    _savedImmersiveLayout: null,
                    workspaceFolders: [],
                    immersive: {
                        immersiveTopSlots: [],
                        immersiveBottomSlots: [],
                        immersiveLeftSlots: [...desktopLeftSlots],
                        immersiveRightSlots: [...desktopRightSlots],
                        immersiveTopSize: 20,
                        immersiveBottomSize: 20,
                        immersiveLeftSize: 20,
                        immersiveRightSize: 20,
                        immersiveTopInternalSizes: [],
                        immersiveBottomInternalSizes: [],
                        immersiveLeftInternalSizes: [],
                        immersiveRightInternalSizes: [],
                        collapsedRegions: { top: false, bottom: false, left: false, right: false },
                        allRegionsHidden: false,
                        immersiveHideProperties: true,
                        typewriterEnabled: true,
                        typewriterCenterOffset: 0,
                        typewriterUnfocusedOpacity: 0.4,
                        pomodoroEnabled: false,
                        pomodoroInterval: 30,
                        manuscriptModeEnabled: false,
                        mobileAuxPanel: {
                            viewType: 'outline',
                            isOpen: false,
                            isMinimized: false,
                            isLocked: false,
                            x: 16,
                            y: 64,
                            width: 300,
                            height: 280
                        }
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
                        totalTime: '00:00:00',
                        focusTime: '00:00:00',
                        slackTime: '00:00:00',
                        todayWords: 500,
                        goal: 2000,
                        percent: 25,
                        dailyWords: 500,
                        dailyGoal: 5000,
                        sessionWords: 0,
                        sessionSpeed: 0
                    }),
                    getSessionSpeed: vi.fn().mockReturnValue(0)
                },
                adaptiveDebounceManager: { debounceFixed: vi.fn() },
                startTracking: vi.fn(),
                stopTracking: vi.fn(),
                saveSettings: vi.fn().mockResolvedValue(undefined),
                settingsManager: { flush: vi.fn().mockResolvedValue(undefined) }
            } as unknown as ImmersiveModeManagerPlugin;

            mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
            const mgr = new ImmersiveModeManager(mockPlugin.app, mockPlugin);

            await mgr.toggleImmersiveMode();

            expect(mgr.isMobileImmersiveSessionActive()).toBe(true);
            expect(mgr.getActiveSessionMainLeaf()).toBe(mainLeaf);
            expect(mgr.canToggleAuxiliaryRegions()).toBe(false);
            expect(bodyClasses.has('wn-immersive-mode-active')).toBe(true);
            expect(bodyClasses.has('wn-immersive-mobile-active')).toBe(true);
            // Must NOT invoke desktop fullscreen, splits or overwrite the layout snapshot
            expect(mockDoc.documentElement.requestFullscreen).not.toHaveBeenCalled();
            expect((mockPlugin.app as unknown as { commands: { executeCommandById: ReturnType<typeof vi.fn> } }).commands.executeCommandById).not.toHaveBeenCalled();
            expect(mockPlugin.app.workspace.createLeafBySplit).not.toHaveBeenCalled();
            expect(mockPlugin.settings._savedImmersiveLayout).toBeNull();
            expect(mockPlugin.startTracking).toHaveBeenCalledTimes(1);
            expect(mockPlugin.settings.immersive.immersiveLeftSlots).toEqual(desktopLeftSlots);
            expect(mockPlugin.settings.immersive.immersiveRightSlots).toEqual(desktopRightSlots);

            await mgr.exitImmersiveMode();

            expect(mgr.isMobileImmersiveSessionActive()).toBe(false);
            expect(mgr.getActiveSessionMainLeaf()).toBeNull();
            expect(bodyClasses.has('wn-immersive-mode-active')).toBe(false);
            expect(bodyClasses.has('wn-immersive-mobile-active')).toBe(false);
            // Must stop tracking like desktop and restore MobileFloatingStats
            expect(mockPlugin.stopTracking).toHaveBeenCalledTimes(1);
            expect(mockMobileFloatingStats.update).toHaveBeenCalled();
            for (const l of createdRightLeaves) {
                expect(l.detach).toHaveBeenCalled();
            }
        } finally {
            Platform.isMobile = originalIsMobile;
        }
    });

    it('enforces aux panel lock (cancels active gesture), keyboard clamp without overwriting preferred size, stale mount cleanup, reference link guard, main outline, and book context isolation', async () => {
        const { Platform, MarkdownView: MockMarkdownView, TFolder } = await import('obsidian');
        const originalIsMobile = Platform.isMobile;
        Platform.isMobile = true;

        try {
            type RichEl = Record<string, unknown> & {
                children: RichEl[];
                className: string;
                classList: {
                    add: (...names: string[]) => void;
                    remove: (...names: string[]) => void;
                    toggle: (name: string, force?: boolean) => void;
                    contains: (name: string) => boolean;
                };
                listeners: Map<string, Array<{ fn: (e: unknown) => void; capture: boolean }>>;
                dispatch: (evt: string, payload?: unknown) => void;
                findByClass: (cls: string) => RichEl | null;
                findAllByClass: (cls: string) => RichEl[];
                createDiv: (opts?: string | { cls?: string; text?: string }) => RichEl;
                createEl: (t: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => RichEl;
            };

            const docListeners = new Map<string, Array<(e: unknown) => void>>();
            const makeRichEl = (tag = 'div', cls = ''): RichEl => {
                const classes = new Set<string>(cls.split(/\s+/).filter(Boolean));
                const attrs = new Map<string, string>();
                const listeners = new Map<string, Array<{ fn: (e: unknown) => void; capture: boolean }>>();
                const children: RichEl[] = [];
                const el: RichEl = {
                    tagName: tag.toUpperCase(),
                    className: cls,
                    textContent: '',
                    value: '',
                    style: {},
                    hidden: false,
                    offsetHeight: 44,
                    offsetWidth: 300,
                    parentElement: null,
                    nextSibling: null,
                    ownerDocument: null,
                    children,
                    listeners,
                    classList: {
                        add: (...names: string[]) => {
                            names.forEach(n => classes.add(n));
                            el.className = Array.from(classes).join(' ');
                        },
                        remove: (...names: string[]) => {
                            names.forEach(n => classes.delete(n));
                            el.className = Array.from(classes).join(' ');
                        },
                        toggle: (name: string, force?: boolean) => {
                            if (force === undefined) {
                                if (classes.has(name)) classes.delete(name); else classes.add(name);
                            } else if (force) classes.add(name); else classes.delete(name);
                            el.className = Array.from(classes).join(' ');
                        },
                        contains: (name: string) => classes.has(name)
                    },
                    addClass: (...names: string[]) => el.classList.add(...names),
                    removeClass: (...names: string[]) => el.classList.remove(...names),
                    hasClass: (name: string) => classes.has(name),
                    setCssProps: (props: Record<string, string>) => Object.assign(el.style as Record<string, string>, props),
                    setCssStyles: (styles: Record<string, string>) => Object.assign(el.style as Record<string, string>, styles),
                    setAttribute: (k: string, v: string) => attrs.set(k, v),
                    getAttribute: (k: string) => attrs.get(k) ?? null,
                    removeAttribute: (k: string) => attrs.delete(k),
                    show: () => { el.hidden = false; el.classList.remove('is-hidden'); },
                    hide: () => { el.hidden = true; },
                    isShown: () => !el.hidden,
                    empty: () => { children.length = 0; },
                    remove: () => {
                        const parent = el.parentElement as RichEl | null;
                        if (parent?.children) {
                            const idx = parent.children.indexOf(el);
                            if (idx >= 0) parent.children.splice(idx, 1);
                        }
                        el.parentElement = null;
                    },
                    appendChild: (child: RichEl) => {
                        child.parentElement = el;
                        children.push(child);
                        return child;
                    },
                    insertBefore: (child: RichEl) => {
                        child.parentElement = el;
                        children.push(child);
                        return child;
                    },
                    contains: (node: unknown): boolean => node === el || children.some(c => (c.contains as (n: unknown) => boolean)(node)),
                    closest: (selector: string): RichEl | null => {
                        const tokens = selector.split(',').map(s => s.trim());
                        let cur: RichEl | null = el;
                        while (cur) {
                            for (const tok of tokens) {
                                if (tok.startsWith('.') && cur.classList.contains(tok.slice(1))) return cur;
                                if (tok === 'a.internal-link' && cur.tagName === 'A' && cur.classList.contains('internal-link')) return cur;
                            }
                            cur = cur.parentElement as RichEl | null;
                        }
                        return null;
                    },
                    addEventListener: (evt: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) => {
                        const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
                        const arr = listeners.get(evt) ?? [];
                        arr.push({ fn, capture });
                        listeners.set(evt, arr);
                    },
                    removeEventListener: (evt: string, fn: (e: unknown) => void) => {
                        const arr = listeners.get(evt) ?? [];
                        listeners.set(evt, arr.filter(h => h.fn !== fn));
                    },
                    dispatch: (evt: string, payload?: unknown) => {
                        for (const entry of [...(listeners.get(evt) ?? [])]) entry.fn(payload);
                    },
                    findByClass: (targetCls: string): RichEl | null => {
                        if (el.classList.contains(targetCls)) return el;
                        for (const c of children) {
                            const hit = c.findByClass(targetCls);
                            if (hit) return hit;
                        }
                        return null;
                    },
                    findAllByClass: (targetCls: string): RichEl[] => {
                        const res: RichEl[] = [];
                        if (el.classList.contains(targetCls)) res.push(el);
                        for (const c of children) res.push(...c.findAllByClass(targetCls));
                        return res;
                    },
                    querySelector: (sel: string) => sel.startsWith('.') ? el.findByClass(sel.slice(1)) : null,
                    querySelectorAll: (sel: string) => sel.startsWith('.') ? el.findAllByClass(sel.slice(1)) : [],
                    getElementsByClassName: (clsName: string) => el.findAllByClass(clsName),
                    createDiv: (opts?: string | { cls?: string; text?: string }) => {
                        const c = typeof opts === 'string' ? opts : (opts?.cls || '');
                        const child = makeRichEl('div', c);
                        if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
                        child.ownerDocument = el.ownerDocument;
                        (el.appendChild as (n: RichEl) => RichEl)(child);
                        return child;
                    },
                    createSpan: (opts?: string | { cls?: string; text?: string }) => {
                        const c = typeof opts === 'string' ? opts : (opts?.cls || '');
                        const child = makeRichEl('span', c);
                        if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
                        child.ownerDocument = el.ownerDocument;
                        (el.appendChild as (n: RichEl) => RichEl)(child);
                        return child;
                    },
                    createEl: (t: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => {
                        const child = makeRichEl(t, opts?.cls || '');
                        if (opts?.text) child.textContent = opts.text;
                        if (opts?.attr) {
                            for (const [k, v] of Object.entries(opts.attr)) {
                                (child.setAttribute as (a: string, b: string) => void)(k, v);
                            }
                        }
                        child.ownerDocument = el.ownerDocument;
                        (el.appendChild as (n: RichEl) => RichEl)(child);
                        return child;
                    }
                };
                return el;
            };

            const vvListeners = new Map<string, Array<() => void>>();
            const visualViewport = {
                width: 390,
                height: 844,
                offsetTop: 0,
                offsetLeft: 0,
                addEventListener: vi.fn((evt: string, fn: () => void) => {
                    const arr = vvListeners.get(evt) ?? [];
                    arr.push(fn);
                    vvListeners.set(evt, arr);
                }),
                removeEventListener: vi.fn((evt: string, fn: () => void) => {
                    vvListeners.set(evt, (vvListeners.get(evt) ?? []).filter(f => f !== fn));
                })
            };
            const mockWin = {
                innerWidth: 390,
                innerHeight: 844,
                visualViewport,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                requestAnimationFrame: vi.fn((fn: () => void) => { fn(); return 1; }),
                cancelAnimationFrame: vi.fn(),
                setTimeout,
                clearTimeout,
                setInterval,
                clearInterval
            };
            const bodyEl = makeRichEl('body', 'is-phone');
            const mockDoc = {
                body: bodyEl,
                defaultView: mockWin,
                documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
                fullscreenElement: null,
                exitFullscreen: vi.fn().mockResolvedValue(undefined),
                activeElement: null,
                addEventListener: vi.fn((evt: string, fn: (e: unknown) => void) => {
                    const arr = docListeners.get(evt) ?? [];
                    arr.push(fn);
                    docListeners.set(evt, arr);
                }),
                removeEventListener: vi.fn((evt: string, fn: (e: unknown) => void) => {
                    docListeners.set(evt, (docListeners.get(evt) ?? []).filter(f => f !== fn));
                })
            };
            bodyEl.ownerDocument = mockDoc;
            (globalThis as Record<string, unknown>).activeDocument = mockDoc;
            (globalThis as Record<string, unknown>).window = mockWin;

            const rootFolder = { path: '', name: '', parent: null, isRoot: () => true };
            const novelsFolder = { path: 'Novels', name: 'Novels', parent: rootFolder, isRoot: () => false };
            const bookMainFolder = { path: 'Novels/BookMain', name: 'BookMain', parent: novelsFolder, isRoot: () => false };
            const bookOtherFolder = { path: 'Novels/BookOther', name: 'BookOther', parent: novelsFolder, isRoot: () => false };
            const mainFile = Object.assign(new TFile(), { path: 'Novels/BookMain/Ch1.md', basename: 'Ch1', extension: 'md', parent: bookMainFolder });
            const refFile = Object.assign(new TFile(), { path: 'Novels/BookOther/NoteRef.md', basename: 'NoteRef', extension: 'md', parent: bookOtherFolder });
            const setCursor = vi.fn();
            const scrollIntoView = vi.fn();
            const mainContainer = makeRichEl('div', 'workspace-leaf');
            mainContainer.ownerDocument = mockDoc;
            const mainView = Object.assign(Object.create(MockMarkdownView.prototype), {
                file: mainFile,
                getViewType: () => 'markdown',
                editor: {
                    cm: { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() },
                    focus: vi.fn(),
                    setCursor,
                    scrollIntoView,
                    getScrollInfo: () => ({ top: 0, left: 0 }),
                    listSelections: () => []
                },
                containerEl: mainContainer
            });
            const mainLeaf = {
                id: 'main-leaf',
                active: true,
                view: mainView,
                containerEl: mainContainer,
                getViewState: () => ({ type: 'markdown', state: { file: mainFile.path, mode: 'source' } }),
                setViewState: vi.fn().mockResolvedValue(undefined)
            } as unknown as WorkspaceLeaf;

            let nextSlowResolve: (() => void) | null = null;
            let slowNextLeaf = false;
            const createdLeaves: Array<{ leaf: WorkspaceLeaf; container: RichEl; detach: ReturnType<typeof vi.fn> }> = [];
            let activeFileOverride: TFile = mainFile;

            const mockPlugin = {
                app: {
                    workspace: {
                        getActiveViewOfType: vi.fn(() => mainView),
                        getActiveFile: vi.fn(() => activeFileOverride),
                        getLeavesOfType: vi.fn((type: string) => type === 'markdown' ? [mainLeaf] : []),
                        iterateAllLeaves: vi.fn((cb: (l: WorkspaceLeaf) => void) => cb(mainLeaf)),
                        getRightLeaf: vi.fn(() => {
                            const container = makeRichEl('div', 'workspace-leaf');
                            container.ownerDocument = mockDoc;
                            container.createDiv({ cls: 'workspace-leaf-content' });
                            const detach = vi.fn();
                            const leaf = {
                                containerEl: container,
                                view: { getViewType: () => 'empty', file: null },
                                setViewState: vi.fn(async (vs: { type: string; state?: { file?: string } }) => {
                                    if (slowNextLeaf) {
                                        slowNextLeaf = false;
                                        await new Promise<void>(resolve => { nextSlowResolve = resolve; });
                                    }
                                    (leaf as unknown as { view: unknown }).view = {
                                        getViewType: () => vs.type,
                                        file: vs.state?.file === refFile.path ? refFile : null
                                    };
                                }),
                                openFile: vi.fn().mockResolvedValue(undefined),
                                detach
                            } as unknown as WorkspaceLeaf;
                            createdLeaves.push({ leaf, container, detach });
                            return leaf;
                        }),
                        createLeafBySplit: vi.fn(),
                        setActiveLeaf: vi.fn(),
                        updateOptions: vi.fn(),
                        on: vi.fn().mockReturnValue({ id: 'ev' }),
                        offref: vi.fn(),
                        trigger: vi.fn()
                    },
                    vault: {
                        getName: () => 'TestVault',
                        getAbstractFileByPath: vi.fn((p: string) => {
                            if (p === mainFile.path) return mainFile;
                            if (p === refFile.path) return refFile;
                            if (p === 'Novels/BookMain/lore') return Object.assign(new TFolder(), { path: p, name: 'lore', children: [] });
                            if (p === 'Novels/BookOther/lore') return Object.assign(new TFolder(), { path: p, name: 'lore', children: [] });
                            if (p === 'Novels/BookMain') return bookMainFolder;
                            if (p === 'Novels/BookOther') return bookOtherFolder;
                            return null;
                        }),
                        on: vi.fn().mockReturnValue({ id: 'vev' }),
                        offref: vi.fn()
                    },
                    metadataCache: {
                        getFileCache: vi.fn((f: TFile) => {
                            if (f.path === mainFile.path) {
                                return { headings: [{ heading: 'Main Heading', level: 2, position: { start: { line: 7, col: 0, offset: 40 }, end: { line: 7, col: 12, offset: 52 } } }] };
                            }
                            return { headings: [{ heading: 'Ref Heading', level: 1, position: { start: { line: 1, col: 0, offset: 0 }, end: { line: 1, col: 11, offset: 11 } } }] };
                        }),
                        on: vi.fn().mockReturnValue({ id: 'mev' }),
                        offref: vi.fn()
                    },
                    commands: { executeCommandById: vi.fn() }
                },
                isTracking: false,
                focusMs: 0,
                settings: {
                    _savedImmersiveLayout: null,
                    workspaceFolders: ['Novels'],
                    loreFolderName: 'lore',
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
                        collapsedRegions: { top: false, bottom: false, left: false, right: false },
                        allRegionsHidden: false,
                        immersiveHideProperties: true,
                        typewriterEnabled: true,
                        typewriterCenterOffset: 0,
                        typewriterUnfocusedOpacity: 0.4,
                        pomodoroEnabled: false,
                        pomodoroInterval: 30,
                        manuscriptModeEnabled: false,
                        mobileAuxPanel: {
                            viewType: 'outline',
                            isOpen: true,
                            isMinimized: false,
                            isLocked: false,
                            x: 16,
                            y: 64,
                            width: 300,
                            height: 360
                        }
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
                        totalTime: '00:00:00', focusTime: '00:00:00', slackTime: '00:00:00',
                        todayWords: 120, goal: 1000, percent: 12, dailyWords: 120, dailyGoal: 2000,
                        sessionWords: 0, sessionSpeed: 0
                    }),
                    getSessionSpeed: vi.fn().mockReturnValue(0)
                },
                adaptiveDebounceManager: { debounceFixed: vi.fn() },
                startTracking: vi.fn(),
                stopTracking: vi.fn(),
                saveSettings: vi.fn().mockResolvedValue(undefined),
                settingsManager: { flush: vi.fn().mockResolvedValue(undefined) }
            } as unknown as ImmersiveModeManagerPlugin;

            mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
            const mgr = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
            (mockPlugin as unknown as { immersiveModeManager?: ImmersiveModeManager }).immersiveModeManager = mgr;

            await mgr.toggleImmersiveMode();
            const ctrl = mgr.getMobileController()!;
            expect(ctrl).not.toBeNull();

            // 1. Main-bound Outline renders headings from MAIN file (even if activeFileOverride points to refFile)
            activeFileOverride = refFile;
            const outlineItems = bodyEl.findAllByClass('wn-immersive-mobile-outline-item');
            expect(outlineItems).toHaveLength(1);
            expect(outlineItems[0].textContent).toBe('Main Heading');
            outlineItems[0].dispatch('click', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
            expect(setCursor).toHaveBeenCalledWith({ line: 7, ch: 0 });
            expect(scrollIntoView).toHaveBeenCalled();

            // 2. Work context isolation: getCurrentBookContext stays bound to main book
            const bookCtx = getCurrentBookContext(mockPlugin.app, mockPlugin as unknown as Parameters<typeof getCurrentBookContext>[1]);
            expect(bookCtx).toBe('Novels/BookMain');

            // 3. Panel lock immediately cancels in-progress drag and blocks further drag/resize while minimize remains available
            const auxHeader = bodyEl.findByClass('wn-immersive-mobile-aux-header')!;
            const auxResize = bodyEl.findByClass('wn-immersive-mobile-aux-resize-handle')!;
            auxHeader.dispatch('pointerdown', { button: 0, clientX: 50, clientY: 80, pointerId: 1, target: auxHeader, preventDefault: vi.fn() });
            expect(ctrl.hasActiveGesture()).toBe(true);

            await ctrl.setAuxLocked(true);
            expect(ctrl.hasActiveGesture()).toBe(false);

            // Subsequent drag and resize attempts must be blocked while locked
            auxHeader.dispatch('pointerdown', { button: 0, clientX: 50, clientY: 80, pointerId: 2, target: auxHeader, preventDefault: vi.fn() });
            expect(ctrl.hasActiveGesture()).toBe(false);
            auxResize.dispatch('pointerdown', { button: 0, clientX: 300, clientY: 400, pointerId: 3, target: auxResize, stopPropagation: vi.fn(), preventDefault: vi.fn() });
            expect(ctrl.hasActiveGesture()).toBe(false);

            // Minimize/restore remain available while locked
            await ctrl.setAuxMinimized(true);
            expect(ctrl.getAuxState().isMinimized).toBe(true);
            await ctrl.setAuxMinimized(false);
            expect(ctrl.getAuxState().isMinimized).toBe(false);

            // 4. Virtual keyboard shrink clamps rendered panel even when locked, WITHOUT overwriting preferred height in settings
            visualViewport.height = 360;
            for (const fn of vvListeners.get('resize') ?? []) fn();
            const clampedRect = ctrl.getRenderedAuxRect()!;
            expect(clampedRect.y + clampedRect.height).toBeLessThanOrEqual(360);
            expect(mockPlugin.settings.immersive.mobileAuxPanel?.height).toBe(360); // preferred size preserved!

            // Restoring viewport restores preferred height
            visualViewport.height = 844;
            for (const fn of vvListeners.get('resize') ?? []) fn();
            expect(ctrl.getRenderedAuxRect()!.height).toBe(360);

            // 5. Reference link navigation interception blocks internal-link clicks in capture phase while allowing toolbar button
            await ctrl.setAuxViewType('reference-view');
            const refRecord = createdLeaves[createdLeaves.length - 1];
            const linkEl = refRecord.container.createEl('a', { cls: 'internal-link' });
            const linkEvt = { target: linkEl, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };
            refRecord.container.dispatch('click', linkEvt);
            expect(linkEvt.preventDefault).toHaveBeenCalled();
            expect(linkEvt.stopPropagation).toHaveBeenCalled();

            const toolbarEl = refRecord.container.findByClass('wn-immersive-ref-toolbar')!;
            const toolbarEvt = { target: toolbarEl, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };
            refRecord.container.dispatch('click', toolbarEvt);
            expect(toolbarEvt.preventDefault).not.toHaveBeenCalled();

            // 6. Stale async aux switch after close detaches late-resolving leaf (no orphan leaves)
            slowNextLeaf = true;
            const slowSwitch = ctrl.setAuxViewType('foreshadowing-view');
            await Promise.resolve();
            await Promise.resolve();
            const staleRecord = createdLeaves[createdLeaves.length - 1];
            const closeTask = ctrl.setAuxOpen(false);
            const resolver = nextSlowResolve as (() => void) | null;
            resolver?.();
            await Promise.all([slowSwitch, closeTask]);
            expect(staleRecord.detach).toHaveBeenCalled();

            await mgr.exitImmersiveMode();
            for (const rec of createdLeaves) {
                expect(rec.detach).toHaveBeenCalled();
            }
        } finally {
            Platform.isMobile = originalIsMobile;
        }
    });

    it('CSS cascade: mobile workspace height/margin-top beats desktop 40px rule and all mobile floating layers stay below native modal/popover layers', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const postcss = (await import('postcss')).default;
        const selectorParser = (await import('postcss-selector-parser')).default;

        const stylesRoot = path.resolve(process.cwd(), 'src', 'styles');
        const readBundledCss = (entryPath: string): string => {
            const raw = fs.readFileSync(entryPath, 'utf8');
            return raw.replace(/@import\s+["']([^"']+)["'];/g, (_, rel: string) => {
                const target = path.resolve(path.dirname(entryPath), rel);
                return readBundledCss(target);
            });
        };

        const fullCss = readBundledCss(path.join(stylesRoot, 'index.css'));
        const root = postcss.parse(fullCss);

        type Specificity = [number, number, number];
        const compareSpec = (a: Specificity, b: Specificity): number => {
            if (a[0] !== b[0]) return a[0] - b[0];
            if (a[1] !== b[1]) return a[1] - b[1];
            return a[2] - b[2];
        };

        // Evaluate specificity and matching against a simplified 3-element chain:
        // body(bodyClasses) > .app-container > .workspace
        const matchWorkspaceSelector = (
            selectorNode: ReturnType<ReturnType<typeof selectorParser>['astSync']>['nodes'][number],
            bodyClasses: Set<string>
        ): Specificity | null => {
            // Split selector by combinators into compound groups
            const compounds: Array<Array<{ type: string; value: string }>> = [[]];
            let hasUnsupportedCombinator = false;
            for (const node of selectorNode.nodes) {
                if (node.type === 'combinator') {
                    const v = node.value.trim();
                    if (v === '' || v === '>') {
                        compounds.push([]);
                    } else {
                        hasUnsupportedCombinator = true;
                        break;
                    }
                } else if (node.type === 'tag' || node.type === 'class' || node.type === 'id') {
                    compounds[compounds.length - 1].push({ type: node.type, value: node.value });
                } else {
                    hasUnsupportedCombinator = true;
                    break;
                }
            }
            if (hasUnsupportedCombinator || compounds.length !== 3) return null;

            const matchesCompound = (
                parts: Array<{ type: string; value: string }>,
                tag: string,
                classes: Set<string>
            ): boolean => {
                if (parts.length === 0) return false;
                return parts.every(p => {
                    if (p.type === 'tag') return p.value === tag;
                    if (p.type === 'class') return classes.has(p.value);
                    return false;
                });
            };

            const appClasses = new Set(['app-container']);
            const wsClasses = new Set(['workspace']);
            if (
                !matchesCompound(compounds[0], 'body', bodyClasses) ||
                !matchesCompound(compounds[1], 'div', appClasses) ||
                !matchesCompound(compounds[2], 'div', wsClasses)
            ) {
                return null;
            }

            let ids = 0;
            let classes = 0;
            let tags = 0;
            for (const compound of compounds) {
                for (const p of compound) {
                    if (p.type === 'id') ids++;
                    else if (p.type === 'class') classes++;
                    else if (p.type === 'tag') tags++;
                }
            }
            return [ids, classes, tags];
        };

        const resolveWinningDecl = (bodyClasses: Set<string>, prop: string): string | null => {
            let bestSpec: Specificity | null = null;
            let bestOrder = -1;
            let bestValue: string | null = null;
            let order = 0;

            root.walkRules((rule) => {
                let declValue: string | null = null;
                rule.walkDecls(prop, (d) => { declValue = d.value; });
                if (declValue === null) return;
                const ast = selectorParser().astSync(rule.selector);
                for (const sel of ast.nodes) {
                    const spec = matchWorkspaceSelector(sel, bodyClasses);
                    order++;
                    if (!spec) continue;
                    if (!bestSpec || compareSpec(spec, bestSpec) > 0 || (compareSpec(spec, bestSpec) === 0 && order > bestOrder)) {
                        bestSpec = spec;
                        bestOrder = order;
                        bestValue = declValue;
                    }
                }
            });
            return bestValue;
        };

        const desktopBody = new Set(['wn-immersive-mode-active']);
        const mobileBody = new Set(['wn-immersive-mode-active', 'wn-immersive-mobile-active']);

        // Desktop workspace must retain 40px topbar geometry
        expect(resolveWinningDecl(desktopBody, 'margin-top')).toBe('40px');
        expect(resolveWinningDecl(desktopBody, 'height')).toBe('calc(100% - 40px)');

        // Mobile workspace must beat desktop 40px rule and use visualViewport CSS vars
        const mobileMarginTop = resolveWinningDecl(mobileBody, 'margin-top');
        const mobileHeight = resolveWinningDecl(mobileBody, 'height');
        expect(mobileMarginTop).toContain('--wn-immersive-mobile-topbar-height');
        expect(mobileHeight).toContain('--wn-immersive-mobile-viewport-height');

        // Keep all numeric values on one row; actual width fitting adjusts the font size.
        const mobileDataStyles: Record<string, string> = {};
        const mobileValueStyles: Record<string, string> = {};
        root.walkRules(rule => {
            if (rule.selector === '.wn-immersive-mobile-topbar-stats') {
                rule.walkDecls(decl => { mobileDataStyles[decl.prop] = decl.value; });
            }
            if (rule.selector === '.wn-immersive-mobile-stat') {
                rule.walkDecls(decl => { mobileValueStyles[decl.prop] = decl.value; });
            }
        });
        expect(mobileDataStyles['flex-wrap']).toBe('nowrap');
        expect(mobileDataStyles['font-size']).toContain('--wn-immersive-mobile-stats-font-size');
        expect(mobileDataStyles['overflow-x']).toBeUndefined();
        expect(mobileDataStyles['overflow-y']).toBeUndefined();
        expect(mobileValueStyles['white-space']).toBe('nowrap');
        expect(mobileValueStyles['overflow-wrap']).toBeUndefined();
        expect(mobileValueStyles['text-overflow']).toBeUndefined();
        let editorGutter = '';
        let gutterSelector = '';
        root.walkRules(rule => {
            if (rule.selector.includes('wn-immersive-main-editor:not(.wn-manuscript-leaf)') &&
                rule.selector.includes('.wn-manuscript-flow')) {
                gutterSelector = rule.selector;
                rule.walkDecls('padding-inline', decl => { editorGutter = decl.value; });
            }
        });
        expect(editorGutter).toContain('--file-margins-x');
        expect(editorGutter).toContain('max(12px');
        expect(gutterSelector).toContain('wn-immersive-mobile-active');


        // Modal layering: evaluate z-index of every mobile floating layer with Obsidian defaults (--layer-popover: 30, --layer-modal: 50)
        const evalZIndex = (raw: string): number => {
            const substituted = raw
                .replace(/var\(--layer-popover,\s*(\d+)\)/g, '30')
                .replace(/var\(--layer-modal,\s*(\d+)\)/g, '50');
            const calcMatch = substituted.match(/^calc\(\s*(\d+)\s*-\s*(\d+)\s*\)$/);
            if (calcMatch) return Number(calcMatch[1]) - Number(calcMatch[2]);
            const num = Number(substituted.trim());
            expect(Number.isFinite(num)).toBe(true);
            return num;
        };

        const layerSelectors = [
            '.wn-immersive-mobile-topbar',
            '.wn-immersive-mobile-dir-restore-btn',
            '.wn-immersive-mobile-dir-backdrop',
            '.wn-immersive-mobile-dir-overlay',
            '.wn-immersive-mobile-aux-panel'
        ];
        const zValues: Record<string, number> = {};
        root.walkRules((rule) => {
            if (!layerSelectors.includes(rule.selector.trim())) return;
            rule.walkDecls('z-index', (d) => {
                zValues[rule.selector.trim()] = evalZIndex(d.value);
            });
        });

        for (const sel of layerSelectors) {
            expect(zValues[sel]).toBeDefined();
            expect(zValues[sel]).toBeGreaterThan(0);
            expect(zValues[sel]).toBeLessThan(30); // strictly below Obsidian native popover (30) and modal (50)
        }
        expect(zValues['.wn-immersive-mobile-topbar']).toBeLessThan(zValues['.wn-immersive-mobile-dir-restore-btn']);
        expect(zValues['.wn-immersive-mobile-dir-restore-btn']).toBeLessThan(zValues['.wn-immersive-mobile-dir-backdrop']);
        expect(zValues['.wn-immersive-mobile-dir-backdrop']).toBeLessThan(zValues['.wn-immersive-mobile-dir-overlay']);
        expect(zValues['.wn-immersive-mobile-aux-panel']).toBeLessThan(zValues['.wn-immersive-mobile-dir-backdrop']);
        expect(zValues['.wn-immersive-mobile-aux-panel']).toBeLessThan(zValues['.wn-immersive-mobile-dir-overlay']);
    });

    it('invalidates in-flight reference open on aux switch/close, prevents dead refToolbarCleanups or stale modal writes, and handles rapid work switches A->B(empty)->C safely', async () => {
        const { Platform, MarkdownView: MockMarkdownView, TFolder } = await import('obsidian');
        const originalIsMobile = Platform.isMobile;
        Platform.isMobile = true;

        try {
            type RichEl = Record<string, unknown> & {
                children: RichEl[];
                className: string;
                classList: {
                    add: (...names: string[]) => void;
                    remove: (...names: string[]) => void;
                    toggle: (name: string, force?: boolean) => void;
                    contains: (name: string) => boolean;
                };
                listeners: Map<string, Array<{ fn: (e: unknown) => void }>>;
                dispatch: (evt: string, payload?: unknown) => void;
                findByClass: (cls: string) => RichEl | null;
                findAllByClass: (cls: string) => RichEl[];
                appendChild: (child: RichEl) => RichEl;
                createDiv: (opts?: string | { cls?: string; text?: string }) => RichEl;
                createEl: (t: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => RichEl;
            };

            const makeRichEl = (tag = 'div', cls = ''): RichEl => {
                const classes = new Set<string>(cls.split(/\s+/).filter(Boolean));
                const attrs = new Map<string, string>();
                const listeners = new Map<string, Array<{ fn: (e: unknown) => void }>>();
                const children: RichEl[] = [];
                const el: RichEl = {
                    tagName: tag.toUpperCase(),
                    className: cls,
                    textContent: '',
                    value: '',
                    style: {},
                    hidden: false,
                    offsetHeight: 44,
                    offsetWidth: 300,
                    parentElement: null,
                    nextSibling: null,
                    ownerDocument: null,
                    children,
                    listeners,
                    classList: {
                        add: (...names: string[]) => { names.forEach(n => classes.add(n)); el.className = Array.from(classes).join(' '); },
                        remove: (...names: string[]) => { names.forEach(n => classes.delete(n)); el.className = Array.from(classes).join(' '); },
                        toggle: (name: string, force?: boolean) => {
                            if (force === undefined) { if (classes.has(name)) classes.delete(name); else classes.add(name); }
                            else if (force) classes.add(name); else classes.delete(name);
                            el.className = Array.from(classes).join(' ');
                        },
                        contains: (name: string) => classes.has(name)
                    },
                    addClass: (...names: string[]) => el.classList.add(...names),
                    removeClass: (...names: string[]) => el.classList.remove(...names),
                    hasClass: (name: string) => classes.has(name),
                    setCssProps: (props: Record<string, string>) => Object.assign(el.style as Record<string, string>, props),
                    setCssStyles: (styles: Record<string, string>) => Object.assign(el.style as Record<string, string>, styles),
                    setAttribute: (k: string, v: string) => attrs.set(k, v),
                    getAttribute: (k: string) => attrs.get(k) ?? null,
                    removeAttribute: (k: string) => attrs.delete(k),
                    show: () => { el.hidden = false; el.classList.remove('is-hidden'); },
                    hide: () => { el.hidden = true; },
                    isShown: () => !el.hidden,
                    empty: () => { children.length = 0; },
                    remove: () => {
                        const parent = el.parentElement as RichEl | null;
                        if (parent?.children) {
                            const idx = parent.children.indexOf(el);
                            if (idx >= 0) parent.children.splice(idx, 1);
                        }
                        el.parentElement = null;
                    },
                    appendChild: (child: RichEl) => { child.parentElement = el; children.push(child); return child; },
                    insertBefore: (child: RichEl) => { child.parentElement = el; children.push(child); return child; },
                    contains: (node: unknown): boolean => node === el || children.some(c => (c.contains as (n: unknown) => boolean)(node)),
                    closest: () => null,
                    addEventListener: (evt: string, fn: (e: unknown) => void) => {
                        const arr = listeners.get(evt) ?? [];
                        arr.push({ fn });
                        listeners.set(evt, arr);
                    },
                    removeEventListener: (evt: string, fn: (e: unknown) => void) => {
                        listeners.set(evt, (listeners.get(evt) ?? []).filter(h => h.fn !== fn));
                    },
                    dispatch: (evt: string, payload?: unknown) => {
                        for (const entry of [...(listeners.get(evt) ?? [])]) entry.fn(payload);
                    },
                    findByClass: (targetCls: string): RichEl | null => {
                        if (el.classList.contains(targetCls)) return el;
                        for (const c of children) { const hit = c.findByClass(targetCls); if (hit) return hit; }
                        return null;
                    },
                    findAllByClass: (targetCls: string): RichEl[] => {
                        const res: RichEl[] = [];
                        if (el.classList.contains(targetCls)) res.push(el);
                        for (const c of children) res.push(...c.findAllByClass(targetCls));
                        return res;
                    },
                    querySelector: (sel: string) => sel.startsWith('.') ? el.findByClass(sel.slice(1)) : null,
                    querySelectorAll: (sel: string) => sel.startsWith('.') ? el.findAllByClass(sel.slice(1)) : [],
                    getElementsByClassName: (clsName: string) => el.findAllByClass(clsName),
                    createDiv: (opts?: string | { cls?: string; text?: string }) => {
                        const child = makeRichEl('div', typeof opts === 'string' ? opts : (opts?.cls || ''));
                        if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
                        child.ownerDocument = el.ownerDocument;
                        el.appendChild(child);
                        return child;
                    },
                    createSpan: (opts?: string | { cls?: string; text?: string }) => {
                        const child = makeRichEl('span', typeof opts === 'string' ? opts : (opts?.cls || ''));
                        if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
                        child.ownerDocument = el.ownerDocument;
                        el.appendChild(child);
                        return child;
                    },
                    createEl: (t: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => {
                        const child = makeRichEl(t, opts?.cls || '');
                        if (opts?.text) child.textContent = opts.text;
                        if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) (child.setAttribute as (a: string, b: string) => void)(k, v);
                        child.ownerDocument = el.ownerDocument;
                        el.appendChild(child);
                        return child;
                    }
                };
                return el;
            };

            const mockWin = {
                innerWidth: 390,
                innerHeight: 844,
                visualViewport: { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                requestAnimationFrame: vi.fn((fn: () => void) => { fn(); return 1; }),
                cancelAnimationFrame: vi.fn(),
                setTimeout, clearTimeout, setInterval, clearInterval
            };
            const bodyEl = makeRichEl('body', 'is-phone');
            const mockDoc = {
                body: bodyEl,
                defaultView: mockWin,
                documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
                fullscreenElement: null,
                exitFullscreen: vi.fn().mockResolvedValue(undefined),
                activeElement: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            };
            bodyEl.ownerDocument = mockDoc;
            (globalThis as Record<string, unknown>).activeDocument = mockDoc;
            (globalThis as Record<string, unknown>).window = mockWin;

            const rootFolder = { path: '', name: '', parent: null, isRoot: () => true };
            const novelsFolder = { path: 'Novels', name: 'Novels', parent: rootFolder, isRoot: () => false };
            const folderA = { path: 'Novels/WorkA', name: 'WorkA', parent: novelsFolder, isRoot: () => false };
            const folderB = { path: 'Novels/WorkB', name: 'WorkB', parent: novelsFolder, isRoot: () => false };
            const folderC = { path: 'Novels/WorkC', name: 'WorkC', parent: novelsFolder, isRoot: () => false };
            const chA = Object.assign(new TFile(), { path: 'Novels/WorkA/Ch1.md', basename: 'Ch1', extension: 'md', parent: folderA });
            const chB = Object.assign(new TFile(), { path: 'Novels/WorkB/Ch1.md', basename: 'Ch1', extension: 'md', parent: folderB });
            const chC = Object.assign(new TFile(), { path: 'Novels/WorkC/Ch1.md', basename: 'Ch1', extension: 'md', parent: folderC });
            const refA = Object.assign(new TFile(), { path: 'Novels/WorkA/RefA.md', basename: 'RefA', extension: 'md', parent: folderA });
            const refC = Object.assign(new TFile(), { path: 'Novels/WorkC/RefC.md', basename: 'RefC', extension: 'md', parent: folderC });
            const refFresh = Object.assign(new TFile(), { path: 'Novels/WorkA/RefFresh.md', basename: 'RefFresh', extension: 'md', parent: folderA });

            const filesByPath = new Map<string, TFile>([
                [chA.path, chA], [chB.path, chB], [chC.path, chC],
                [refA.path, refA], [refC.path, refC], [refFresh.path, refFresh]
            ]);

            const mainContainer = makeRichEl('div', 'workspace-leaf');
            mainContainer.ownerDocument = mockDoc;
            const mainView = Object.assign(Object.create(MockMarkdownView.prototype), {
                file: chA,
                getViewType: () => 'markdown',
                editor: { cm: { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() }, focus: vi.fn(), getCursor: () => ({ line: 0, ch: 0 }), getScrollInfo: () => ({ top: 0, left: 0 }), listSelections: () => [] },
                containerEl: mainContainer
            });
            const mainLeaf = {
                id: 'main-leaf',
                active: true,
                view: mainView,
                containerEl: mainContainer,
                getViewState: () => ({ type: 'markdown', state: { file: (mainView.file as TFile).path, mode: 'source' } }),
                setViewState: vi.fn().mockResolvedValue(undefined)
            } as unknown as WorkspaceLeaf;

            const wsListeners = new Map<string, Array<(...args: unknown[]) => void>>();
            const vaultListeners = new Map<string, Array<(...args: unknown[]) => void>>();
            const pendingOpenResolvers: Array<{ leaf: WorkspaceLeaf; file: TFile; resolve: () => void }> = [];
            const pendingEmptyResolvers: Array<{ leaf: WorkspaceLeaf; resolve: () => void }> = [];
            let deferOpenFile = false;
            let deferEmptySetViewState = false;
            const createdLeaves: Array<{ leaf: WorkspaceLeaf; container: RichEl; detach: ReturnType<typeof vi.fn> }> = [];
            const workspaceTrigger = vi.fn();

            const mockPlugin = {
                app: {
                    workspace: {
                        getActiveViewOfType: vi.fn(() => mainView),
                        getActiveFile: vi.fn(() => mainView.file),
                        getLeavesOfType: vi.fn((type: string) => type === 'markdown' ? [mainLeaf] : []),
                        iterateAllLeaves: vi.fn((cb: (l: WorkspaceLeaf) => void) => { cb(mainLeaf); createdLeaves.forEach(c => cb(c.leaf)); }),
                        getRightLeaf: vi.fn(() => {
                            const container = makeRichEl('div', 'workspace-leaf');
                            container.ownerDocument = mockDoc;
                            container.createDiv({ cls: 'workspace-leaf-content' });
                            const detach = vi.fn();
                            const leaf = {
                                containerEl: container,
                                view: { getViewType: () => 'empty', file: null as TFile | null },
                                setViewState: vi.fn(async (vs: { type: string; state?: { file?: string } }) => {
                                    if (vs.type === 'empty' && deferEmptySetViewState) {
                                        await new Promise<void>(resolve => { pendingEmptyResolvers.push({ leaf, resolve }); });
                                    }
                                    (leaf as unknown as { view: unknown }).view = {
                                        getViewType: () => vs.type,
                                        file: vs.state?.file ? (filesByPath.get(vs.state.file) ?? null) : null
                                    };
                                }),
                                openFile: vi.fn(async (f: TFile) => {
                                    if (deferOpenFile) {
                                        await new Promise<void>(resolve => { pendingOpenResolvers.push({ leaf, file: f, resolve }); });
                                    }
                                    (leaf as unknown as { view: unknown }).view = { getViewType: () => 'markdown', file: f };
                                }),
                                detach
                            } as unknown as WorkspaceLeaf;
                            createdLeaves.push({ leaf, container, detach });
                            return leaf;
                        }),
                        createLeafBySplit: vi.fn(),
                        setActiveLeaf: vi.fn(),
                        updateOptions: vi.fn(),
                        on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => {
                            const arr = wsListeners.get(evt) ?? [];
                            arr.push(fn);
                            wsListeners.set(evt, arr);
                            return { evt, fn };
                        }),
                        offref: vi.fn(),
                        trigger: workspaceTrigger
                    },
                    vault: {
                        getName: () => 'TestVault',
                        getAbstractFileByPath: vi.fn((p: string) => {
                            if (filesByPath.has(p)) return filesByPath.get(p)!;
                            if (p === 'Novels/WorkA/lore' || p === 'Novels/WorkB/lore' || p === 'Novels/WorkC/lore') {
                                return Object.assign(new TFolder(), { path: p, name: 'lore', children: [] });
                            }
                            return null;
                        }),
                        on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => {
                            const arr = vaultListeners.get(evt) ?? [];
                            arr.push(fn);
                            vaultListeners.set(evt, arr);
                            return { evt, fn };
                        }),
                        offref: vi.fn()
                    },
                    metadataCache: { getFileCache: vi.fn().mockReturnValue({ headings: [] }), on: vi.fn().mockReturnValue({ id: 'mev' }), offref: vi.fn() },
                    commands: { executeCommandById: vi.fn() }
                },
                isTracking: false,
                focusMs: 0,
                settings: {
                    _savedImmersiveLayout: null,
                    workspaceFolders: ['Novels'],
                    loreFolderName: 'lore',
                    immersive: {
                        immersiveTopSlots: [], immersiveBottomSlots: [], immersiveLeftSlots: [], immersiveRightSlots: [],
                        immersiveTopSize: 20, immersiveBottomSize: 20, immersiveLeftSize: 20, immersiveRightSize: 20,
                        immersiveTopInternalSizes: [], immersiveBottomInternalSizes: [], immersiveLeftInternalSizes: [], immersiveRightInternalSizes: [],
                        collapsedRegions: { top: false, bottom: false, left: false, right: false },
                        allRegionsHidden: false, immersiveHideProperties: true,
                        typewriterEnabled: false, typewriterCenterOffset: 0, typewriterUnfocusedOpacity: 0.4,
                        pomodoroEnabled: false, pomodoroInterval: 30, manuscriptModeEnabled: false,
                        workReferencePaths: {},
                        mobileAuxPanel: { viewType: 'reference-view', isOpen: true, isMinimized: false, isLocked: false, x: 16, y: 64, width: 300, height: 320 }
                    }
                },
                stickyNoteManager: { syncActiveNotesToManager: vi.fn(), getNotes: vi.fn().mockReturnValue([]), saveNotes: vi.fn().mockResolvedValue(undefined), syncFloatingNotes: vi.fn() },
                statisticsManager: {
                    getCoreStats: vi.fn().mockReturnValue({ totalTime: '00:00:00', focusTime: '00:00:00', slackTime: '00:00:00', todayWords: 100, goal: 1000, percent: 10, dailyWords: 100, dailyGoal: 2000, sessionWords: 0, sessionSpeed: 0 }),
                    getSessionSpeed: vi.fn().mockReturnValue(0)
                },
                adaptiveDebounceManager: { debounceFixed: vi.fn() },
                startTracking: vi.fn(),
                stopTracking: vi.fn(),
                saveSettings: vi.fn().mockResolvedValue(undefined),
                settingsManager: { flush: vi.fn().mockResolvedValue(undefined) },
                getVaultMarkdownFiles: () => Array.from(filesByPath.values())
            } as unknown as ImmersiveModeManagerPlugin;

            mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
            const mgr = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
            const flushMicrotasks = async (ticks = 10) => {
                for (let i = 0; i < ticks; i++) await Promise.resolve();
            };
            await mgr.toggleImmersiveMode();
            const ctrl = mgr.getMobileController()!;
            // Wait for initial reference-view mount and serialized queue settlement
            await flushMicrotasks();

            const firstRefLeaf = ctrl.getReferenceLeaf()!;
            expect(firstRefLeaf).toBeTruthy();
            expect(mgr['refToolbarCleanups'].has(firstRefLeaf)).toBe(true);

            // 1. Start deferred reference open, then switch aux to outline before openFile resolves
            deferOpenFile = true;
            workspaceTrigger.mockClear();
            const pendingOpen = mgr.openReferenceFile(refA, firstRefLeaf);
            await flushMicrotasks(4);
            expect(pendingOpenResolvers.length).toBe(1);

            const switchToOutline = ctrl.setAuxViewType('outline');
            // Toolbar cleanup for retired leaf must be removed immediately and not leaked
            expect(mgr['refToolbarCleanups'].has(firstRefLeaf)).toBe(false);
            // Old leaf must NOT be detached before its pending native openFile settles
            const firstRecord = createdLeaves.find(c => c.leaf === firstRefLeaf)!;
            expect(firstRecord.detach).not.toHaveBeenCalled();

            // Resolve stale openFile now
            pendingOpenResolvers.shift()!.resolve();
            await Promise.all([pendingOpen, switchToOutline]);

            expect(firstRecord.detach).toHaveBeenCalled();
            expect(mgr['refToolbarCleanups'].has(firstRefLeaf)).toBe(false);
            expect(mockPlugin.settings.immersive.workReferencePaths?.['Novels/WorkA']).toBeUndefined();
            expect(workspaceTrigger).not.toHaveBeenCalledWith('webnovel:immersive-reference-ready');

            // 2. Re-open reference-view (fresh leaf) -> must succeed cleanly without interference from dead leaf
            deferOpenFile = false;
            await ctrl.setAuxViewType('reference-view');
            const freshRefLeaf = ctrl.getReferenceLeaf()!;
            expect(freshRefLeaf).toBeTruthy();
            expect(freshRefLeaf).not.toBe(firstRefLeaf);
            await mgr.openReferenceFile(refFresh, freshRefLeaf);
            expect(ctrl.getExpectedReferencePath()).toBe(refFresh.path);
            expect(mockPlugin.settings.immersive.workReferencePaths?.['Novels/WorkA']).toBe(refFresh.path);

            // 3. Stale search modal: open search modal on freshRefLeaf, close aux -> modal closes and stale selection cannot touch retired leaf
            const searchBtn = createdLeaves.find(c => c.leaf === freshRefLeaf)!.container.findByClass('clickable-icon')!;
            searchBtn.dispatch('click', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
            const openedModal = mgr['activeSearchModal'] as unknown as { onChooseItem?: (f: TFile) => void; close: ReturnType<typeof vi.fn> };
            expect(openedModal).toBeTruthy();
            const modalCloseSpy = vi.spyOn(openedModal, 'close');

            await ctrl.setAuxOpen(false);
            expect(modalCloseSpy).toHaveBeenCalled();
            expect(mgr['activeSearchModal']).toBeNull();
            expect(mgr['refToolbarCleanups'].size).toBe(0);

            // Even if stale onChooseItem were invoked, retired leaf must not be touched or persisted
            const openSpyBefore = (freshRefLeaf.openFile as ReturnType<typeof vi.fn>).mock.calls.length;
            openedModal.onChooseItem?.(refA);
            await Promise.resolve();
            expect((freshRefLeaf.openFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(openSpyBefore);
            expect(mockPlugin.settings.immersive.workReferencePaths?.['Novels/WorkA']).toBe(refFresh.path);

            // 4. Rapid work switch A -> B (empty) -> C (refC) through serialized manager queue + close during empty work switch
            mockPlugin.settings.immersive.workReferencePaths = {
                'Novels/WorkA': refA.path,
                'Novels/WorkC': refC.path
            };
            await ctrl.setAuxOpen(true);
            const workRefLeaf = ctrl.getReferenceLeaf()!;
            expect(workRefLeaf).toBeTruthy();

            deferOpenFile = true;
            deferEmptySetViewState = true;
            // Switch WorkA -> WorkB (no ref -> empty) -> WorkC (refC) rapidly
            mainView.file = chB;
            for (const fn of wsListeners.get('file-open') ?? []) fn(chB);
            await flushMicrotasks(4);
            expect(pendingEmptyResolvers.length).toBe(1);

            mainView.file = chC;
            for (const fn of wsListeners.get('file-open') ?? []) fn(chC);
            await flushMicrotasks(4);

            // Drain deferred WorkB empty -> WorkC open in sequence
            while (pendingEmptyResolvers.length > 0 || pendingOpenResolvers.length > 0) {
                while (pendingEmptyResolvers.length > 0) pendingEmptyResolvers.shift()!.resolve();
                while (pendingOpenResolvers.length > 0) pendingOpenResolvers.shift()!.resolve();
                await flushMicrotasks(6);
            }

            expect(ctrl.getExpectedReferencePath()).toBe(refC.path);
            expect((workRefLeaf.view as unknown as { file: TFile | null }).file?.path).toBe(refC.path);

            // Closing aux while WorkB empty reset is in progress must not throw or leave dangling toolbar/leaf
            mainView.file = chB;
            for (const fn of wsListeners.get('file-open') ?? []) fn(chB);
            await flushMicrotasks(4);
            expect(pendingEmptyResolvers.length).toBe(1);
            const closeDuringReset = ctrl.setAuxOpen(false);
            while (pendingEmptyResolvers.length > 0) {
                pendingEmptyResolvers.shift()!.resolve();
                await flushMicrotasks(4);
            }
            await closeDuringReset;
            expect(ctrl.getReferenceLeaf()).toBeNull();
            expect(mgr['refToolbarCleanups'].size).toBe(0);

            await mgr.exitImmersiveMode();
        } finally {
            Platform.isMobile = originalIsMobile;
        }
    });

    it('preserves mobile reference identity on genuine vault file/folder rename while still blocking unauthorized drift', async () => {
        const { Platform, MarkdownView: MockMarkdownView, TFolder } = await import('obsidian');
        const originalIsMobile = Platform.isMobile;
        Platform.isMobile = true;

        try {
            const makeEl = (tag = 'div', cls = ''): Record<string, unknown> => {
                const classes = new Set<string>(cls.split(/\s+/).filter(Boolean));
                const attrs = new Map<string, string>();
                const children: Array<Record<string, unknown>> = [];
                const el: Record<string, unknown> = {
                    tagName: tag.toUpperCase(),
                    className: cls, textContent: '', value: '', style: {}, hidden: false,
                    offsetHeight: 44, offsetWidth: 300, parentElement: null, nextSibling: null, ownerDocument: null, children,
                    classList: {
                        add: (...n: string[]) => n.forEach(x => classes.add(x)),
                        remove: (...n: string[]) => n.forEach(x => classes.delete(x)),
                        toggle: (n: string, f?: boolean) => { if (f === undefined ? !classes.has(n) : f) classes.add(n); else classes.delete(n); },
                        contains: (n: string) => classes.has(n)
                    },
                    addClass: (...n: string[]) => n.forEach(x => classes.add(x)),
                    removeClass: (...n: string[]) => n.forEach(x => classes.delete(x)),
                    hasClass: (n: string) => classes.has(n),
                    setCssProps: vi.fn(), setCssStyles: vi.fn(),
                    setAttribute: (k: string, v: string) => attrs.set(k, v),
                    getAttribute: (k: string) => attrs.get(k) ?? null,
                    removeAttribute: (k: string) => attrs.delete(k),
                    show: () => { el.hidden = false; }, hide: () => { el.hidden = true; }, isShown: () => !el.hidden,
                    empty: () => { children.length = 0; }, remove: vi.fn(),
                    appendChild: (c: Record<string, unknown>) => { c.parentElement = el; children.push(c); return c; },
                    insertBefore: (c: Record<string, unknown>) => { c.parentElement = el; children.push(c); return c; },
                    contains: () => false, closest: () => null,
                    addEventListener: vi.fn(), removeEventListener: vi.fn(),
                    querySelector: () => null, querySelectorAll: () => [], getElementsByClassName: () => [],
                    createDiv: (o?: string | { cls?: string }) => { const c = makeEl('div', typeof o === 'string' ? o : (o?.cls || '')); c.ownerDocument = el.ownerDocument; children.push(c); c.parentElement = el; return c; },
                    createSpan: (o?: string | { cls?: string }) => { const c = makeEl('span', typeof o === 'string' ? o : (o?.cls || '')); c.ownerDocument = el.ownerDocument; children.push(c); c.parentElement = el; return c; },
                    createEl: (t: string, o?: { cls?: string }) => { const c = makeEl(t, o?.cls || ''); c.ownerDocument = el.ownerDocument; children.push(c); c.parentElement = el; return c; }
                };
                return el;
            };

            const mockWin = {
                innerWidth: 390, innerHeight: 844,
                visualViewport: { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
                addEventListener: vi.fn(), removeEventListener: vi.fn(),
                requestAnimationFrame: vi.fn((fn: () => void) => { fn(); return 1; }), cancelAnimationFrame: vi.fn(),
                setTimeout, clearTimeout, setInterval, clearInterval
            };
            const bodyEl = makeEl('body', 'is-phone');
            const mockDoc = {
                body: bodyEl, defaultView: mockWin,
                documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
                fullscreenElement: null, exitFullscreen: vi.fn().mockResolvedValue(undefined),
                activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn()
            };
            bodyEl.ownerDocument = mockDoc;
            (globalThis as Record<string, unknown>).activeDocument = mockDoc;
            (globalThis as Record<string, unknown>).window = mockWin;

            const rootFolder = { path: '', name: '', parent: null, isRoot: () => true };
            const novelsFolder = { path: 'Novels', name: 'Novels', parent: rootFolder, isRoot: () => false };
            const bookFolder = { path: 'Novels/BookA', name: 'BookA', parent: novelsFolder, isRoot: () => false };
            const ch1 = Object.assign(new TFile(), { path: 'Novels/BookA/Ch1.md', basename: 'Ch1', extension: 'md', parent: bookFolder });
            const refFile = Object.assign(new TFile(), { path: 'Novels/BookA/RefDir/OldRef.md', basename: 'OldRef', extension: 'md', parent: bookFolder });
            const unauthorizedFile = Object.assign(new TFile(), { path: 'Novels/BookA/Unauthorized.md', basename: 'Unauthorized', extension: 'md', parent: bookFolder });

            const filesByPath = new Map<string, TFile>([
                [ch1.path, ch1], [refFile.path, refFile], [unauthorizedFile.path, unauthorizedFile]
            ]);

            const mainContainer = makeEl('div', 'workspace-leaf');
            mainContainer.ownerDocument = mockDoc;
            const mainView = Object.assign(Object.create(MockMarkdownView.prototype), {
                file: ch1, getViewType: () => 'markdown',
                editor: { cm: { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() }, focus: vi.fn(), getScrollInfo: () => ({ top: 0, left: 0 }), listSelections: () => [] },
                containerEl: mainContainer
            });
            const mainLeaf = {
                id: 'main-1', active: true, view: mainView, containerEl: mainContainer,
                getViewState: () => ({ type: 'markdown', state: { file: ch1.path, mode: 'source' } }),
                setViewState: vi.fn().mockResolvedValue(undefined)
            } as unknown as WorkspaceLeaf;

            const wsListeners = new Map<string, Array<(...args: unknown[]) => void>>();
            const vaultListeners = new Map<string, Array<(...args: unknown[]) => void>>();
            let refLeafRef: WorkspaceLeaf | null = null;

            const mockPlugin = {
                app: {
                    workspace: {
                        getActiveViewOfType: vi.fn(() => mainView),
                        getActiveFile: vi.fn(() => ch1),
                        getLeavesOfType: vi.fn((t: string) => t === 'markdown' ? [mainLeaf] : []),
                        iterateAllLeaves: vi.fn((cb: (l: WorkspaceLeaf) => void) => { cb(mainLeaf); if (refLeafRef) cb(refLeafRef); }),
                        getRightLeaf: vi.fn(() => {
                            const container = makeEl('div', 'workspace-leaf');
                            container.ownerDocument = mockDoc;
                            const leaf = {
                                containerEl: container,
                                view: { getViewType: () => 'empty', file: null as TFile | null },
                                setViewState: vi.fn(async (vs: { type: string; state?: { file?: string } }) => {
                                    (leaf as unknown as { view: unknown }).view = {
                                        getViewType: () => vs.type,
                                        file: vs.state?.file ? (filesByPath.get(vs.state.file) ?? null) : null
                                    };
                                }),
                                openFile: vi.fn(async (f: TFile) => {
                                    (leaf as unknown as { view: unknown }).view = { getViewType: () => 'markdown', file: f };
                                }),
                                detach: vi.fn()
                            } as unknown as WorkspaceLeaf;
                            refLeafRef = leaf;
                            return leaf;
                        }),
                        createLeafBySplit: vi.fn(), setActiveLeaf: vi.fn(), updateOptions: vi.fn(),
                        on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => {
                            const arr = wsListeners.get(evt) ?? []; arr.push(fn); wsListeners.set(evt, arr);
                            return { evt, fn };
                        }),
                        offref: vi.fn(), trigger: vi.fn()
                    },
                    vault: {
                        getName: () => 'TestVault',
                        getAbstractFileByPath: vi.fn((p: string) => {
                            if (filesByPath.has(p)) return filesByPath.get(p)!;
                            if (p === 'Novels/BookA/lore') return Object.assign(new TFolder(), { path: p, name: 'lore', children: [] });
                            return null;
                        }),
                        on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => {
                            const arr = vaultListeners.get(evt) ?? []; arr.push(fn); vaultListeners.set(evt, arr);
                            return { evt, fn };
                        }),
                        offref: vi.fn()
                    },
                    metadataCache: { getFileCache: vi.fn().mockReturnValue({ headings: [] }), on: vi.fn().mockReturnValue({ id: 'mev' }), offref: vi.fn() },
                    commands: { executeCommandById: vi.fn() }
                },
                isTracking: false, focusMs: 0,
                settings: {
                    _savedImmersiveLayout: null, workspaceFolders: ['Novels'], loreFolderName: 'lore',
                    immersive: {
                        immersiveTopSlots: [], immersiveBottomSlots: [], immersiveLeftSlots: [], immersiveRightSlots: [],
                        immersiveTopSize: 20, immersiveBottomSize: 20, immersiveLeftSize: 20, immersiveRightSize: 20,
                        immersiveTopInternalSizes: [], immersiveBottomInternalSizes: [], immersiveLeftInternalSizes: [], immersiveRightInternalSizes: [],
                        collapsedRegions: { top: false, bottom: false, left: false, right: false },
                        allRegionsHidden: false, immersiveHideProperties: true,
                        typewriterEnabled: false, typewriterCenterOffset: 0, typewriterUnfocusedOpacity: 0.4,
                        pomodoroEnabled: false, pomodoroInterval: 30, manuscriptModeEnabled: false,
                        workReferencePaths: { 'Novels/BookA': refFile.path },
                        mobileAuxPanel: { viewType: 'reference-view', isOpen: true, isMinimized: false, isLocked: false, x: 16, y: 64, width: 300, height: 320 }
                    }
                },
                stickyNoteManager: { syncActiveNotesToManager: vi.fn(), getNotes: vi.fn().mockReturnValue([]), saveNotes: vi.fn().mockResolvedValue(undefined), syncFloatingNotes: vi.fn() },
                statisticsManager: { getCoreStats: vi.fn().mockReturnValue({ totalTime: '00:00:00', focusTime: '00:00:00', slackTime: '00:00:00', todayWords: 100, goal: 1000, percent: 10, dailyWords: 100, dailyGoal: 2000, sessionWords: 0, sessionSpeed: 0 }), getSessionSpeed: vi.fn().mockReturnValue(0) },
                adaptiveDebounceManager: { debounceFixed: vi.fn() },
                startTracking: vi.fn(), stopTracking: vi.fn(), saveSettings: vi.fn().mockResolvedValue(undefined),
                settingsManager: { flush: vi.fn().mockResolvedValue(undefined) }
            } as unknown as ImmersiveModeManagerPlugin;

            mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
            const mgr = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
            await mgr.toggleImmersiveMode();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            const ctrl = mgr.getMobileController()!;
            const refLeaf = ctrl.getReferenceLeaf()!;
            expect(ctrl.getExpectedReferencePath()).toBe('Novels/BookA/RefDir/OldRef.md');

            // 1. Genuine file rename: OldRef.md -> RenamedRef.md
            const oldFilePath = refFile.path;
            filesByPath.delete(oldFilePath);
            refFile.path = 'Novels/BookA/RefDir/RenamedRef.md';
            refFile.basename = 'RenamedRef';
            filesByPath.set(refFile.path, refFile);
            for (const fn of vaultListeners.get('rename') ?? []) fn(refFile, oldFilePath);
            await Promise.resolve();
            await Promise.resolve();

            expect(ctrl.getExpectedReferencePath()).toBe('Novels/BookA/RefDir/RenamedRef.md');
            expect(mockPlugin.settings.immersive.workReferencePaths?.['Novels/BookA']).toBe('Novels/BookA/RefDir/RenamedRef.md');
            expect((refLeaf.view as unknown as { file: TFile | null }).file?.path).toBe('Novels/BookA/RefDir/RenamedRef.md');

            // 2. Genuine ancestor folder rename: RefDir -> RefDir2
            filesByPath.delete(refFile.path);
            refFile.path = 'Novels/BookA/RefDir2/RenamedRef.md';
            filesByPath.set(refFile.path, refFile);
            const renamedFolder = Object.assign(new TFolder(), { path: 'Novels/BookA/RefDir2', name: 'RefDir2', children: [refFile] });
            for (const fn of vaultListeners.get('rename') ?? []) fn(renamedFolder, 'Novels/BookA/RefDir');
            await Promise.resolve();
            await Promise.resolve();

            expect(ctrl.getExpectedReferencePath()).toBe('Novels/BookA/RefDir2/RenamedRef.md');
            expect(mockPlugin.settings.immersive.workReferencePaths?.['Novels/BookA']).toBe('Novels/BookA/RefDir2/RenamedRef.md');
            expect((refLeaf.view as unknown as { file: TFile | null }).file?.path).toBe('Novels/BookA/RefDir2/RenamedRef.md');

            // 3. Unauthorized drift to another file must still be blocked and restored back to RenamedRef.md
            (refLeaf as unknown as { view: unknown }).view = { getViewType: () => 'markdown', file: unauthorizedFile };
            for (const fn of wsListeners.get('file-open') ?? []) fn(unauthorizedFile);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            expect((refLeaf.view as unknown as { file: TFile | null }).file?.path).toBe('Novels/BookA/RefDir2/RenamedRef.md');

            await mgr.exitImmersiveMode();
        } finally {
            Platform.isMobile = originalIsMobile;
        }
    });

    it('keeps main-editor data isolation active during awaited mobile exit teardown when reference leaf is still active', async () => {
        const { Platform, MarkdownView: MockMarkdownView, TFolder } = await import('obsidian');
        const originalIsMobile = Platform.isMobile;
        Platform.isMobile = true;

        try {
            const makeEl = (tag = 'div', cls = ''): Record<string, unknown> => {
                const classes = new Set<string>(cls.split(/\s+/).filter(Boolean));
                const attrs = new Map<string, string>();
                const children: Array<Record<string, unknown>> = [];
                const el: Record<string, unknown> = {
                    tagName: tag.toUpperCase(),
                    className: cls, textContent: '', value: '', style: {}, hidden: false,
                    offsetHeight: 44, offsetWidth: 300, parentElement: null, nextSibling: null, ownerDocument: null, children,
                    classList: {
                        add: (...n: string[]) => n.forEach(x => classes.add(x)),
                        remove: (...n: string[]) => n.forEach(x => classes.delete(x)),
                        toggle: (n: string, f?: boolean) => { if (f === undefined ? !classes.has(n) : f) classes.add(n); else classes.delete(n); },
                        contains: (n: string) => classes.has(n)
                    },
                    addClass: (...n: string[]) => n.forEach(x => classes.add(x)),
                    removeClass: (...n: string[]) => n.forEach(x => classes.delete(x)),
                    hasClass: (n: string) => classes.has(n),
                    setCssProps: vi.fn(), setCssStyles: vi.fn(),
                    setAttribute: (k: string, v: string) => attrs.set(k, v),
                    getAttribute: (k: string) => attrs.get(k) ?? null,
                    removeAttribute: (k: string) => attrs.delete(k),
                    show: () => { el.hidden = false; }, hide: () => { el.hidden = true; }, isShown: () => !el.hidden,
                    empty: () => { children.length = 0; }, remove: vi.fn(),
                    appendChild: (c: Record<string, unknown>) => { c.parentElement = el; children.push(c); return c; },
                    insertBefore: (c: Record<string, unknown>) => { c.parentElement = el; children.push(c); return c; },
                    contains: () => false, closest: () => null,
                    addEventListener: vi.fn(), removeEventListener: vi.fn(),
                    querySelector: () => null, querySelectorAll: () => [], getElementsByClassName: () => [],
                    createDiv: (o?: string | { cls?: string }) => { const c = makeEl('div', typeof o === 'string' ? o : (o?.cls || '')); c.ownerDocument = el.ownerDocument; children.push(c); c.parentElement = el; return c; },
                    createSpan: (o?: string | { cls?: string }) => { const c = makeEl('span', typeof o === 'string' ? o : (o?.cls || '')); c.ownerDocument = el.ownerDocument; children.push(c); c.parentElement = el; return c; },
                    createEl: (t: string, o?: { cls?: string }) => { const c = makeEl(t, o?.cls || ''); c.ownerDocument = el.ownerDocument; children.push(c); c.parentElement = el; return c; }
                };
                return el;
            };

            const mockWin = {
                innerWidth: 390, innerHeight: 844,
                visualViewport: { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
                addEventListener: vi.fn(), removeEventListener: vi.fn(),
                requestAnimationFrame: vi.fn((fn: () => void) => { fn(); return 1; }), cancelAnimationFrame: vi.fn(),
                setTimeout, clearTimeout, setInterval, clearInterval
            };
            const bodyEl = makeEl('body', 'is-phone');
            const mockDoc = {
                body: bodyEl, defaultView: mockWin,
                documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
                fullscreenElement: null, exitFullscreen: vi.fn().mockResolvedValue(undefined),
                activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn()
            };
            bodyEl.ownerDocument = mockDoc;
            (globalThis as Record<string, unknown>).activeDocument = mockDoc;
            (globalThis as Record<string, unknown>).window = mockWin;

            const rootFolder = { path: '', name: '', parent: null, isRoot: () => true };
            const novelsFolder = { path: 'Novels', name: 'Novels', parent: rootFolder, isRoot: () => false };
            const bookMain = { path: 'Novels/BookMain', name: 'BookMain', parent: novelsFolder, isRoot: () => false };
            const bookRef = { path: 'Novels/BookRef', name: 'BookRef', parent: novelsFolder, isRoot: () => false };
            const mainFile = Object.assign(new TFile(), { path: 'Novels/BookMain/Ch1.md', basename: 'Ch1', extension: 'md', parent: bookMain });
            const refFile = Object.assign(new TFile(), { path: 'Novels/BookRef/Ref1.md', basename: 'Ref1', extension: 'md', parent: bookRef });

            const mainEditor = { getValue: () => 'main words', cm: { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() }, focus: vi.fn(), getScrollInfo: () => ({ top: 0, left: 0 }), listSelections: () => [] };
            const refEditor = { getValue: () => 'reference words that must never leak', cm: { dispatch: vi.fn() } };
            const mainContainer = makeEl('div', 'workspace-leaf');
            mainContainer.ownerDocument = mockDoc;
            const mainView = Object.assign(Object.create(MockMarkdownView.prototype), {
                file: mainFile, getViewType: () => 'markdown', editor: mainEditor, containerEl: mainContainer
            });
            const mainLeaf = {
                id: 'main-exit-leaf', active: true, view: mainView, containerEl: mainContainer,
                getViewState: () => ({ type: 'markdown', state: { file: mainFile.path, mode: 'source' } }),
                setViewState: vi.fn().mockResolvedValue(undefined)
            } as unknown as WorkspaceLeaf;

            let activeViewOverride: unknown = mainView;
            let activeFileOverride: TFile = mainFile;
            let resolveSaveNotes: (() => void) | null = null;
            let markSaveNotesEntered: (() => void) | null = null;
            const saveNotesEntered = new Promise<void>(resolve => { markSaveNotesEntered = resolve; });
            let deferSaveNotes = false;
            let activeLeafBeforeCleanup: WorkspaceLeaf | null = null;

            const mockPlugin = {
                app: {
                    workspace: {
                        getActiveViewOfType: vi.fn(() => activeViewOverride),
                        getActiveFile: vi.fn(() => activeFileOverride),
                        getLeavesOfType: vi.fn((t: string) => t === 'markdown' ? [mainLeaf] : []),
                        iterateAllLeaves: vi.fn((cb: (l: WorkspaceLeaf) => void) => cb(mainLeaf)),
                        getRightLeaf: vi.fn(() => {
                            const container = makeEl('div', 'workspace-leaf');
                            container.ownerDocument = mockDoc;
                            const refView = Object.assign(Object.create(MockMarkdownView.prototype), {
                                file: refFile, getViewType: () => 'markdown', editor: refEditor, containerEl: container
                            });
                            return {
                                containerEl: container,
                                view: refView,
                                setViewState: vi.fn().mockResolvedValue(undefined),
                                openFile: vi.fn().mockResolvedValue(undefined),
                                detach: vi.fn()
                            } as unknown as WorkspaceLeaf;
                        }),
                        createLeafBySplit: vi.fn(),
                        setActiveLeaf: vi.fn((leaf: WorkspaceLeaf) => {
                            activeLeafBeforeCleanup = leaf;
                            if (leaf === mainLeaf) {
                                activeViewOverride = mainView;
                                activeFileOverride = mainFile;
                            }
                        }),
                        updateOptions: vi.fn(),
                        on: vi.fn().mockReturnValue({ id: 'ev' }),
                        offref: vi.fn(),
                        trigger: vi.fn()
                    },
                    vault: {
                        getName: () => 'TestVault',
                        getAbstractFileByPath: vi.fn((p: string) => {
                            if (p === mainFile.path) return mainFile;
                            if (p === refFile.path) return refFile;
                            if (p === 'Novels/BookMain/lore' || p === 'Novels/BookRef/lore') {
                                return Object.assign(new TFolder(), { path: p, name: 'lore', children: [] });
                            }
                            return null;
                        }),
                        on: vi.fn().mockReturnValue({ id: 'vev' }),
                        offref: vi.fn()
                    },
                    metadataCache: { getFileCache: vi.fn().mockReturnValue({ headings: [] }), on: vi.fn().mockReturnValue({ id: 'mev' }), offref: vi.fn() },
                    commands: { executeCommandById: vi.fn() }
                },
                isTracking: false, focusMs: 0,
                settings: {
                    _savedImmersiveLayout: null, workspaceFolders: ['Novels'], loreFolderName: 'lore',
                    immersive: {
                        immersiveTopSlots: [], immersiveBottomSlots: [], immersiveLeftSlots: [], immersiveRightSlots: [],
                        immersiveTopSize: 20, immersiveBottomSize: 20, immersiveLeftSize: 20, immersiveRightSize: 20,
                        immersiveTopInternalSizes: [], immersiveBottomInternalSizes: [], immersiveLeftInternalSizes: [], immersiveRightInternalSizes: [],
                        collapsedRegions: { top: false, bottom: false, left: false, right: false },
                        allRegionsHidden: false, immersiveHideProperties: true,
                        typewriterEnabled: false, typewriterCenterOffset: 0, typewriterUnfocusedOpacity: 0.4,
                        pomodoroEnabled: false, pomodoroInterval: 30, manuscriptModeEnabled: false,
                        workReferencePaths: { 'Novels/BookMain': refFile.path },
                        mobileAuxPanel: { viewType: 'reference-view', isOpen: true, isMinimized: false, isLocked: false, x: 16, y: 64, width: 300, height: 320 }
                    }
                },
                stickyNoteManager: {
                    syncActiveNotesToManager: vi.fn(),
                    getNotes: vi.fn().mockReturnValue([]),
                    saveNotes: vi.fn(async () => {
                        if (deferSaveNotes) {
                            markSaveNotesEntered?.();
                            await new Promise<void>(resolve => { resolveSaveNotes = resolve; });
                        }
                    }),
                    syncFloatingNotes: vi.fn()
                },
                statisticsManager: {
                    getCoreStats: vi.fn().mockReturnValue({ totalTime: '00:00:00', focusTime: '00:00:00', slackTime: '00:00:00', todayWords: 100, goal: 1000, percent: 10, dailyWords: 100, dailyGoal: 2000, sessionWords: 0, sessionSpeed: 0 }),
                    getSessionSpeed: vi.fn().mockReturnValue(0)
                },
                adaptiveDebounceManager: { debounceFixed: vi.fn() },
                startTracking: vi.fn(), stopTracking: vi.fn(), saveSettings: vi.fn().mockResolvedValue(undefined),
                settingsManager: { flush: vi.fn().mockResolvedValue(undefined) }
            } as unknown as ImmersiveModeManagerPlugin;

            mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
            const mgr = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
            (mockPlugin as unknown as { immersiveModeManager?: ImmersiveModeManager }).immersiveModeManager = mgr;

            await mgr.toggleImmersiveMode();
            for (let i = 0; i < 10; i++) await Promise.resolve();

            const refLeaf = mgr.getMobileController()!.getReferenceLeaf()!;
            // Simulate user focusing reference leaf right before tapping Exit
            activeViewOverride = refLeaf.view;
            activeFileOverride = refFile;

            deferSaveNotes = true;
            const exitPromise = mgr.exitImmersiveMode();
            await saveNotesEntered;

            // Mid-exit: UI/interactions must be disabled, while data isolation remains bound to MAIN
            expect(mgr.isMobileImmersiveSessionActive()).toBe(false);
            expect((mgr as unknown as { isMobileDataIsolationActive?: () => boolean }).isMobileDataIsolationActive?.()).toBe(true);
            expect((mgr as unknown as { getDataScopedMainLeaf?: () => WorkspaceLeaf | null }).getDataScopedMainLeaf?.()).toBe(mainLeaf);
            expect(mgr.isMainEditorOrigin(refLeaf.view, refEditor)).toBe(false);
            expect(mgr.isMainEditorOrigin(mainView, mainEditor)).toBe(true);
            expect(getCurrentBookContext(mockPlugin.app, mockPlugin as unknown as Parameters<typeof getCurrentBookContext>[1])).toBe('Novels/BookMain');

            // Complete exit
            (resolveSaveNotes as (() => void) | null)?.();
            await exitPromise;

            expect(activeLeafBeforeCleanup).toBe(mainLeaf);
            expect((mgr as unknown as { isMobileDataIsolationActive?: () => boolean }).isMobileDataIsolationActive?.()).toBe(false);
            expect((mgr as unknown as { getDataScopedMainLeaf?: () => WorkspaceLeaf | null }).getDataScopedMainLeaf?.()).toBeNull();
        } finally {
            Platform.isMobile = originalIsMobile;
        }
    });
});

describe('ImmersiveModeManager - Mobile immersive follow-up regressions', () => {
    type DomEl = Record<string, unknown> & {
        children: DomEl[];
        style: Record<string, string>;
        classList: {
            add: (...n: string[]) => void;
            remove: (...n: string[]) => void;
            toggle: (n: string, f?: boolean) => boolean;
            contains: (n: string) => boolean;
        };
        dispatch: (evt: string, payload?: unknown) => void;
        findByClass: (cls: string) => DomEl | null;
        appendChild: (c: DomEl) => DomEl;
        setAttribute: (k: string, v: string) => void;
        getAttribute: (k: string) => string | null;
        createDiv: (o?: string | { cls?: string; text?: string }) => DomEl;
        createSpan: (o?: string | { cls?: string; text?: string }) => DomEl;
        createEl: (t: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }) => DomEl;
    };

    const makeEl = (tag = 'div', cls = ''): DomEl => {
        const classes = new Set<string>(cls.split(/\s+/).filter(Boolean));
        const attrs = new Map<string, string>();
        const listeners = new Map<string, Array<(e: unknown) => void>>();
        const children: DomEl[] = [];
        const el: DomEl = {
            tagName: tag.toUpperCase(),
            className: cls,
            textContent: '',
            value: '',
            style: {},
            hidden: false,
            offsetWidth: 320,
            offsetHeight: 44,
            parentElement: null,
            nextSibling: null,
            ownerDocument: null,
            children,
            classList: {
                add: (...n: string[]) => { n.forEach(x => classes.add(x)); el.className = Array.from(classes).join(' '); },
                remove: (...n: string[]) => { n.forEach(x => classes.delete(x)); el.className = Array.from(classes).join(' '); },
                toggle: (n: string, f?: boolean) => { const next = f ?? !classes.has(n); if (next) classes.add(n); else classes.delete(n); el.className = Array.from(classes).join(' '); return next; },
                contains: (n: string) => classes.has(n)
            },
            addClass: (...n: string[]) => el.classList.add(...n),
            removeClass: (...n: string[]) => el.classList.remove(...n),
            hasClass: (n: string) => classes.has(n),
            setCssProps: (props: Record<string, string>) => Object.assign(el.style, props),
            setCssStyles: (styles: Record<string, string>) => Object.assign(el.style, styles),
            setAttribute: (k: string, v: string) => attrs.set(k, v),
            getAttribute: (k: string) => attrs.get(k) ?? null,
            removeAttribute: (k: string) => attrs.delete(k),
            show: () => { el.hidden = false; el.classList.remove('is-hidden'); },
            hide: () => { el.hidden = true; },
            isShown: () => !el.hidden,
            empty: () => { children.length = 0; },
            remove: () => {
                const p = el.parentElement as DomEl | null;
                if (p?.children) { const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); }
                el.parentElement = null;
            },
            appendChild: (c: DomEl) => { c.parentElement = el; children.push(c); return c; },
            insertBefore: (c: DomEl) => { c.parentElement = el; children.push(c); return c; },
            contains: (n: unknown): boolean => n === el || children.some(c => (c.contains as (x: unknown) => boolean)(n)),
            closest: () => null,
            addEventListener: (evt: string, fn: (e: unknown) => void) => { const arr = listeners.get(evt) ?? []; arr.push(fn); listeners.set(evt, arr); },
            removeEventListener: (evt: string, fn: (e: unknown) => void) => { listeners.set(evt, (listeners.get(evt) ?? []).filter(h => h !== fn)); },
            dispatch: (evt: string, payload?: unknown) => { for (const fn of [...(listeners.get(evt) ?? [])]) fn(payload); },
            findByClass: (targetCls: string): DomEl | null => {
                if (el.classList.contains(targetCls)) return el;
                for (const c of children) { const hit = c.findByClass(targetCls); if (hit) return hit; }
                return null;
            },
            querySelector: (sel: string) => sel.startsWith('.') ? el.findByClass(sel.slice(1)) : null,
            querySelectorAll: () => [],
            getElementsByClassName: () => [],
            createDiv: (o?: string | { cls?: string; text?: string }) => {
                const c = makeEl('div', typeof o === 'string' ? o : (o?.cls || ''));
                if (typeof o === 'object' && o?.text) c.textContent = o.text;
                c.ownerDocument = el.ownerDocument;
                el.appendChild(c);
                return c;
            },
            createSpan: (o?: string | { cls?: string; text?: string }) => {
                const c = makeEl('span', typeof o === 'string' ? o : (o?.cls || ''));
                if (typeof o === 'object' && o?.text) c.textContent = o.text;
                c.ownerDocument = el.ownerDocument;
                el.appendChild(c);
                return c;
            },
            createEl: (tagName: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }) => {
                const c = makeEl(tagName, o?.cls || '');
                if (o?.text) c.textContent = o.text;
                if (o?.attr) for (const [k, v] of Object.entries(o.attr)) c.setAttribute(k, v);
                c.ownerDocument = el.ownerDocument;
                el.appendChild(c);
                return c;
            }
        };
        return el;
    };

    const setupMobileHarness = async (options?: {
        safeAreaVars?: Record<string, string>;
        pomodoroEnabled?: boolean;
        pomodoroInterval?: number;
        mobileAuxPanel?: Record<string, unknown>;
        useFakeIntervals?: boolean;
    }) => {
        const { Platform, MarkdownView: MockMarkdownView } = await import('obsidian');
        const originalIsMobile = Platform.isMobile;
        Platform.isMobile = true;

        const safeAreaVars: Record<string, string> = { ...(options?.safeAreaVars ?? {}) };
        const vvListeners = new Map<string, Array<() => void>>();
        const visualViewport = {
            width: 390, height: 844, offsetTop: 0, offsetLeft: 0,
            addEventListener: vi.fn((evt: string, fn: () => void) => { const arr = vvListeners.get(evt) ?? []; arr.push(fn); vvListeners.set(evt, arr); }),
            removeEventListener: vi.fn((evt: string, fn: () => void) => { vvListeners.set(evt, (vvListeners.get(evt) ?? []).filter(f => f !== fn)); })
        };

        let nextIntervalId = 100;
        const intervals = new Map<number, () => void>();
        const clearIntervalSpy = vi.fn((id: number) => { intervals.delete(id); });
        const setIntervalSpy = vi.fn((fn: () => void) => { const id = ++nextIntervalId; intervals.set(id, fn); return id; });

        const mockWin = {
            innerWidth: 390,
            innerHeight: 844,
            visualViewport,
            getComputedStyle: vi.fn((node: DomEl) => ({
                paddingTop: '0px',
                paddingRight: '0px',
                paddingBottom: '0px',
                paddingLeft: '0px',
                getPropertyValue: (prop: string) => safeAreaVars[prop] ?? node?.style?.[prop] ?? ''
            })),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            requestAnimationFrame: vi.fn((fn: () => void) => { fn(); return 1; }),
            cancelAnimationFrame: vi.fn(),
            setTimeout,
            clearTimeout,
            setInterval: options?.useFakeIntervals ? setIntervalSpy : setInterval,
            clearInterval: options?.useFakeIntervals ? clearIntervalSpy : clearInterval
        };

        const bodyEl = makeEl('body', 'is-phone');
        const docEl = makeEl('html', '');
        const mockDoc = {
            body: bodyEl,
            documentElement: Object.assign(docEl, { requestFullscreen: vi.fn().mockResolvedValue(undefined) }),
            defaultView: mockWin,
            fullscreenElement: null,
            exitFullscreen: vi.fn().mockResolvedValue(undefined),
            activeElement: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        };
        bodyEl.ownerDocument = mockDoc;
        docEl.ownerDocument = mockDoc;
        (globalThis as Record<string, unknown>).activeDocument = mockDoc;
        (globalThis as Record<string, unknown>).activeWindow = mockWin;
        (globalThis as Record<string, unknown>).window = mockWin;

        const chapterFile = Object.assign(new TFile(), { path: 'Novels/BookA/Chapter1.md', basename: 'Chapter1', extension: 'md' });
        const mainContainer = makeEl('div', 'workspace-leaf');
        mainContainer.ownerDocument = mockDoc;
        const mainView = Object.assign(Object.create(MockMarkdownView.prototype), {
            file: chapterFile,
            getViewType: () => 'markdown',
            editor: { cm: { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() }, focus: vi.fn(), getScrollInfo: () => ({ top: 0, left: 0 }), listSelections: () => [] },
            containerEl: mainContainer
        });
        const mainLeaf = {
            id: 'main-leaf', active: true, view: mainView, containerEl: mainContainer,
            getViewState: () => ({ type: 'markdown', state: { file: chapterFile.path, mode: 'source' } }),
            setViewState: vi.fn().mockResolvedValue(undefined)
        } as unknown as WorkspaceLeaf;

        const createdLeaves: Array<{
            leaf: WorkspaceLeaf;
            container: DomEl;
            detach: ReturnType<typeof vi.fn>;
            onResize: ReturnType<typeof vi.fn>;
            loadIfDeferred: ReturnType<typeof vi.fn>;
        }> = [];
        let leafFactoryOverride: ((rec: {
            container: DomEl; detach: ReturnType<typeof vi.fn>; onResize: ReturnType<typeof vi.fn>; loadIfDeferred: ReturnType<typeof vi.fn>;
        }) => Record<string, unknown>) | null = null;

        const mockPlugin = {
            app: {
                workspace: {
                    getActiveViewOfType: vi.fn().mockReturnValue(mainView),
                    getLeavesOfType: vi.fn((t: string) => t === 'markdown' ? [mainLeaf] : []),
                    iterateAllLeaves: vi.fn((cb: (l: WorkspaceLeaf) => void) => cb(mainLeaf)),
                    getRightLeaf: vi.fn(() => {
                        const container = makeEl('div', 'workspace-leaf');
                        container.ownerDocument = mockDoc;
                        container.createDiv({ cls: 'workspace-leaf-content' });
                        const detach = vi.fn();
                        const onResize = vi.fn();
                        const loadIfDeferred = vi.fn().mockResolvedValue(undefined);
                        const leafObj: Record<string, unknown> = {
                            containerEl: container,
                            isDeferred: false,
                            loadIfDeferred,
                            view: { getViewType: () => 'empty', onResize },
                            setViewState: vi.fn(async (vs: { type: string }) => {
                                leafObj.view = { getViewType: () => vs.type, onResize };
                            }),
                            openFile: vi.fn().mockResolvedValue(undefined),
                            detach
                        };
                        if (leafFactoryOverride) {
                            Object.assign(leafObj, leafFactoryOverride({ container, detach, onResize, loadIfDeferred }));
                        }
                        const leaf = leafObj as unknown as WorkspaceLeaf;
                        createdLeaves.push({
                            leaf,
                            container,
                            detach,
                            onResize,
                            loadIfDeferred: leafObj.loadIfDeferred as ReturnType<typeof vi.fn>
                        });
                        return leaf;
                    }),
                    createLeafBySplit: vi.fn(),
                    setActiveLeaf: vi.fn(),
                    updateOptions: vi.fn(),
                    on: vi.fn().mockReturnValue({ id: 'ev' }),
                    offref: vi.fn(),
                    trigger: vi.fn()
                },
                vault: {
                    getName: () => 'TestVault',
                    getAbstractFileByPath: vi.fn((p: string) => p === chapterFile.path ? chapterFile : null),
                    on: vi.fn().mockReturnValue({ id: 'vev' }),
                    offref: vi.fn()
                },
                metadataCache: { getFileCache: vi.fn().mockReturnValue({ headings: [] }), on: vi.fn().mockReturnValue({ id: 'mev' }), offref: vi.fn() },
                commands: { executeCommandById: vi.fn() }
            },
            isTracking: false,
            focusMs: 0,
            settings: {
                _savedImmersiveLayout: null,
                workspaceFolders: [],
                immersive: {
                    immersiveTopSlots: [], immersiveBottomSlots: [],
                    immersiveLeftSlots: ['immersive-chapter-list-view'], immersiveRightSlots: ['reference-view'],
                    immersiveTopSize: 20, immersiveBottomSize: 20, immersiveLeftSize: 20, immersiveRightSize: 20,
                    immersiveTopInternalSizes: [], immersiveBottomInternalSizes: [], immersiveLeftInternalSizes: [], immersiveRightInternalSizes: [],
                    collapsedRegions: { top: false, bottom: false, left: false, right: false },
                    allRegionsHidden: false,
                    immersiveHideProperties: true,
                    typewriterEnabled: false, typewriterCenterOffset: 0, typewriterUnfocusedOpacity: 0.4,
                    pomodoroEnabled: options?.pomodoroEnabled ?? false,
                    pomodoroInterval: options?.pomodoroInterval ?? 30,
                    manuscriptModeEnabled: false,
                    mobileAuxPanel: {
                        viewType: 'outline',
                        isOpen: false,
                        isMinimized: false,
                        isLocked: false,
                        x: 16, y: 64, width: 300, height: 280,
                        ...(options?.mobileAuxPanel ?? {})
                    }
                }
            },
            stickyNoteManager: { syncActiveNotesToManager: vi.fn(), getNotes: vi.fn().mockReturnValue([]), saveNotes: vi.fn().mockResolvedValue(undefined), syncFloatingNotes: vi.fn() },
            statisticsManager: {
                getCoreStats: vi.fn().mockReturnValue({ totalTime: '00:00:00', focusTime: '00:00:00', slackTime: '00:00:00', todayWords: 100, goal: 1000, percent: 10, dailyWords: 100, dailyGoal: 2000, sessionWords: 0, sessionSpeed: 0 }),
                getSessionSpeed: vi.fn().mockReturnValue(0)
            },
            adaptiveDebounceManager: { debounceFixed: vi.fn() },
            startTracking: vi.fn(),
            stopTracking: vi.fn(),
            saveSettings: vi.fn().mockResolvedValue(undefined),
            settingsManager: { flush: vi.fn().mockResolvedValue(undefined) }
        } as unknown as ImmersiveModeManagerPlugin;

        mockPlugin.immersiveReferenceManager = new ImmersiveReferenceManager(mockPlugin.app, mockPlugin);
        const mgr = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
        (mockPlugin as unknown as { immersiveModeManager?: ImmersiveModeManager }).immersiveModeManager = mgr;

        return {
            mgr, mockPlugin, mockDoc, mockWin, bodyEl, visualViewport, vvListeners, safeAreaVars,
            createdLeaves, intervals, setIntervalSpy, clearIntervalSpy,
            setLeafFactoryOverride: (fn: typeof leafFactoryOverride) => { leafFactoryOverride = fn; },
            restorePlatform: () => { Platform.isMobile = originalIsMobile; }
        };
    };

    it('keeps read-only data, quick settings and exit in the mobile topbar and starts/stops focus with the session', async () => {
        const h = await setupMobileHarness();
        const workPath = vi.spyOn(h.mockPlugin.immersiveReferenceManager, 'getWorkPath').mockReturnValue('Novels/Example Work');
        try {
            await h.mgr.toggleImmersiveMode();
            const title = h.bodyEl.findByClass('wn-immersive-mobile-work-title');
            expect(title).not.toBeNull();
            expect(title!.textContent).toBe('Example Work');
            expect(h.bodyEl.findByClass('wn-immersive-mobile-topbar')!.children[0] === title).toBe(true);
            expect(h.bodyEl.findByClass('wn-immersive-mobile-topbar-stats')!.children.includes(title!)).toBe(false);
            workPath.mockReturnValue('Novels/Another Work');
            h.mgr.refreshMobileTopBar();
            expect(title!.textContent).toBe('Another Work');
            workPath.mockReturnValue('');
            h.mgr.refreshMobileTopBar();
            expect(title!.hidden).toBe(true);
            expect(title!.textContent).toBe('');
            const bar = h.bodyEl.findByClass('wn-immersive-mobile-topbar')!;
            const descendants = (node: DomEl): DomEl[] => [node, ...node.children.flatMap(descendants)];
            const buttons = descendants(bar).filter(node => node.tagName === 'BUTTON');
            expect(buttons).toHaveLength(2);
            expect(buttons[0].classList.contains('wn-immersive-mobile-settings-btn')).toBe(true);
            expect(buttons[1].classList.contains('wn-immersive-mobile-exit-btn')).toBe(true);
            expect(descendants(bar).some(node => node.tagName === 'SELECT')).toBe(false);
            const stats = h.mockPlugin.statisticsManager.getCoreStats();
            vi.mocked(h.mockPlugin.statisticsManager.getCoreStats).mockReturnValue({
                ...stats, todayWords: 123456789, percent: 100, sessionSpeed: 987654
            });
            const speedSource = h.mockPlugin.statisticsManager as typeof h.mockPlugin.statisticsManager & {
                getSessionSpeed(): number;
            };
            vi.spyOn(speedSource, 'getSessionSpeed').mockReturnValue(987654);
            h.mgr.refreshMobileTopBar();
            expect(h.bodyEl.findByClass('wn-immersive-mobile-word-count')!.textContent)
                .toContain((123456789).toLocaleString());
            expect(h.bodyEl.findByClass('wn-immersive-mobile-progress')!.textContent).toBe('100%');
            expect(h.bodyEl.findByClass('wn-immersive-mobile-speed')!.textContent).toContain('987654');
            expect(h.bodyEl.findByClass('wn-immersive-mobile-timer')!.hidden).toBe(false);
            expect(h.bodyEl.findByClass('wn-immersive-mobile-timer-text')!.textContent).toMatch(/^\d+:\d{2}:\d{2}$/);
            expect(h.mockPlugin.startTracking).toHaveBeenCalledTimes(1);
            expect(h.bodyEl.findByClass('wn-immersive-mobile-dir-restore-btn')).not.toBeNull();
            await h.mgr.exitImmersiveMode();
            expect(h.mockPlugin.stopTracking).toHaveBeenCalledTimes(1);
        } finally {
            h.restorePlatform();
        }
    });

    it('shrinks single-row topbar text for available width and restores the normal font after widening', async () => {
        const h = await setupMobileHarness();
        try {
            await h.mgr.toggleImmersiveMode();
            const stats = h.bodyEl.findByClass('wn-immersive-mobile-topbar-stats')!;
            stats.clientWidth = 160;
            let naturalWidth = 420;
            const fontSize = () => Number.parseFloat(stats.style['--wn-immersive-mobile-stats-font-size'] || '14');
            Object.defineProperty(stats, 'scrollWidth', { get: () => Math.ceil(naturalWidth * fontSize() / 14) });
            h.mgr.refreshMobileTopBar();
            expect(fontSize()).toBeLessThan(14);
            expect(stats.scrollWidth).toBeLessThanOrEqual(160);
            const firstSize = fontSize();
            naturalWidth = 700;
            h.mgr.refreshMobileTopBarTimer();
            expect(fontSize()).toBeLessThan(firstSize);
            expect(stats.scrollWidth).toBeLessThanOrEqual(160);
            stats.clientWidth = 800;
            h.mgr.getMobileController()!.syncViewportMetrics();
            expect(fontSize()).toBe(14);
            await h.mgr.exitImmersiveMode();
        } finally { h.restorePlatform(); }
    });

    it('minimizes the auxiliary panel to one restore icon while preserving expanded size and lock state', async () => {
        const h = await setupMobileHarness({
            mobileAuxPanel: { isOpen: true, isLocked: true, width: 310, height: 290 }
        });
        try {
            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;
            await ctrl.setAuxMinimized(true);
            expect(ctrl.getRenderedAuxRect()).toMatchObject({ width: 32, height: 32 });
            const header = h.bodyEl.findByClass('wn-immersive-mobile-aux-header')!;
            const body = h.bodyEl.findByClass('wn-immersive-mobile-aux-body')!;
            const restore = h.bodyEl.findByClass('wn-immersive-mobile-aux-restore-btn')!;
            expect(header.hidden).toBe(true);
            expect(body.hidden).toBe(true);
            expect(restore.hidden).toBe(false);
            restore.dispatch('click', { stopPropagation: vi.fn() });
            await Promise.resolve();
            expect(ctrl.getAuxState()).toMatchObject({
                isMinimized: false, isLocked: true, width: 310, height: 290
            });
            expect(header.hidden).toBe(false);
            expect(restore.hidden).toBe(true);
            await h.mgr.exitImmersiveMode();
        } finally {
            h.restorePlatform();
        }
    });

    it('drags the minimized restore icon without expanding, preserves dimensions and blocks locked dragging', async () => {
        const h = await setupMobileHarness({ mobileAuxPanel: { isOpen: true, x: 24, y: 90, width: 300, height: 290 } });
        try {
            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;
            await ctrl.setAuxMinimized(true);
            const restore = h.bodyEl.findByClass('wn-immersive-mobile-aux-restore-btn')!;
            restore.dispatch('pointerdown', { pointerId: 7, button: 0, clientX: 30, clientY: 100, preventDefault: vi.fn() });
            const move = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointermove')?.[1] as ((e: unknown) => void) | undefined;
            const end = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointerup')?.[1] as ((e: unknown) => void) | undefined;
            expect(move).toBeDefined();
            move!({ pointerId: 7, clientX: 110, clientY: 180, preventDefault: vi.fn() });
            end!({ pointerId: 7 });
            restore.dispatch('click', { detail: 1, stopPropagation: vi.fn(), preventDefault: vi.fn() });
            expect(ctrl.getAuxState()).toMatchObject({ isMinimized: true, x: 104, y: 170, width: 300, height: 290 });
            expect(h.mockPlugin.settings.immersive.mobileAuxPanel).toMatchObject({ x: 104, y: 170 });
            expect(h.mockDoc.removeEventListener).toHaveBeenCalledWith('pointermove', move);
            // A fresh tap restores; locking continues to forbid minimized dragging.
            restore.dispatch('pointerdown', { pointerId: 8, button: 0, clientX: 110, clientY: 180, preventDefault: vi.fn() });
            const tapEnd = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointerup')?.[1] as (e: unknown) => void;
            const jitter = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointermove')?.[1] as (e: unknown) => void;
            jitter({ pointerId: 8, clientX: 112, clientY: 181, preventDefault: vi.fn() });
            expect(ctrl.getAuxState()).toMatchObject({ x: 104, y: 170 });
            tapEnd({ pointerId: 8 });
            restore.dispatch('click', { detail: 1, stopPropagation: vi.fn(), preventDefault: vi.fn() });
            expect(ctrl.getAuxState().isMinimized).toBe(false);
            await ctrl.setAuxMinimized(true);
            restore.dispatch('pointerdown', { pointerId: 10, button: 0, clientX: 110, clientY: 180, preventDefault: vi.fn() });
            const cancel = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointercancel')?.[1] as (e: unknown) => void;
            cancel({ pointerId: 10 });
            expect(h.mockDoc.removeEventListener).toHaveBeenCalledWith('pointercancel', cancel);
            await ctrl.setAuxLocked(true);
            const calls = h.mockDoc.addEventListener.mock.calls.length;
            restore.dispatch('pointerdown', { pointerId: 9, button: 0, clientX: 110, clientY: 180, preventDefault: vi.fn() });
            expect(h.mockDoc.addEventListener.mock.calls).toHaveLength(calls);
            restore.dispatch('click', { detail: 0, stopPropagation: vi.fn(), preventDefault: vi.fn() });
            expect(ctrl.getAuxState().isMinimized).toBe(false);
            await h.mgr.exitImmersiveMode();
        } finally { h.restorePlatform(); }
    });

    it('docks the tablet auxiliary panel on the right, reserves editor width and resizes from its left boundary', async () => {
        const h = await setupMobileHarness({ mobileAuxPanel: { isOpen: true, x: 24, y: 90, width: 300, height: 290 } });
        h.bodyEl.classList.remove('is-phone');
        h.bodyEl.classList.add('is-tablet');
        h.mockWin.innerWidth = 1024;
        h.visualViewport.width = 1024;
        try {
            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;
            const dock = h.bodyEl.findByClass('wn-immersive-mobile-aux-dock-btn');
            expect(dock).not.toBeNull();
            dock!.dispatch('click', { stopPropagation: vi.fn() });
            await Promise.resolve();
            expect(ctrl.getAuxState()).toMatchObject({ isDocked: true, x: 24, y: 90, width: 300, height: 290 });
            expect(ctrl.getRenderedAuxRect()).toMatchObject({ x: 724, y: 44, width: 300, height: 800 });
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('300px');
            expect(h.mockPlugin.settings.immersive.mobileAuxPanel).toMatchObject({ isDocked: true });
            const header = h.bodyEl.findByClass('wn-immersive-mobile-aux-header')!;
            const beforeDrag = h.mockDoc.addEventListener.mock.calls.length;
            header.dispatch('pointerdown', { pointerId: 13, button: 0, clientX: 800, clientY: 60, target: header, preventDefault: vi.fn() });
            expect(h.mockDoc.addEventListener.mock.calls).toHaveLength(beforeDrag);
            const resize = h.bodyEl.findByClass('wn-immersive-mobile-aux-resize-handle')!;
            resize.dispatch('pointerdown', { pointerId: 11, button: 0, clientX: 724, clientY: 200, preventDefault: vi.fn(), stopPropagation: vi.fn() });
            const move = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointermove')?.[1] as (e: unknown) => void;
            const end = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointerup')?.[1] as (e: unknown) => void;
            move({ pointerId: 11, clientX: 684, clientY: 250, preventDefault: vi.fn() });
            end({ pointerId: 11 });
            expect(ctrl.getAuxState()).toMatchObject({ width: 340, height: 290 });
            expect(ctrl.getRenderedAuxRect()).toMatchObject({ x: 684, width: 340, height: 800 });
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('340px');
            h.visualViewport.height = 300;
            h.visualViewport.width = 500;
            h.mockWin.innerWidth = 500;
            ctrl.syncViewportMetrics();
            expect(ctrl.getRenderedAuxRect()).toMatchObject({ x: 250, width: 250, height: 256 });
            expect(ctrl.getAuxState()).toMatchObject({ width: 340, height: 290 });
            h.visualViewport.height = 844;
            h.visualViewport.width = 1024;
            h.mockWin.innerWidth = 1024;
            ctrl.syncViewportMetrics();
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('340px');
            await ctrl.setAuxLocked(true);
            const count = h.mockDoc.addEventListener.mock.calls.length;
            resize.dispatch('pointerdown', { pointerId: 12, button: 0, clientX: 684, clientY: 200, preventDefault: vi.fn(), stopPropagation: vi.fn() });
            expect(h.mockDoc.addEventListener.mock.calls).toHaveLength(count);
            await ctrl.setAuxMinimized(true);
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('0px');
            await ctrl.setAuxMinimized(false);
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('340px');
            await ctrl.setAuxOpen(false);
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('0px');
            await ctrl.setAuxOpen(true);
            dock!.dispatch('click', { stopPropagation: vi.fn() });
            expect(ctrl.getRenderedAuxRect()).toMatchObject({ x: 24, y: 90, width: 340, height: 290 });
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('0px');
            await h.mgr.exitImmersiveMode();
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('');
        } finally { h.restorePlatform(); }
    });

    it('coalesces tablet dock resize events and dispatches one editor update when the gesture ends', async () => {
        const h = await setupMobileHarness({ mobileAuxPanel: { isOpen: true, isDocked: true, width: 300, height: 290 } });
        h.bodyEl.classList.remove('is-phone');
        h.bodyEl.classList.add('is-tablet');
        h.mockWin.innerWidth = 1024;
        h.visualViewport.width = 1024;
        try {
            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;
            const resize = h.bodyEl.findByClass('wn-immersive-mobile-aux-resize-handle')!;
            const cm = h.mgr.getActiveSessionMainView()!.editor.cm!;
            const dispatch = vi.mocked(cm.dispatch);
            const measure = vi.mocked(cm.requestMeasure);
            dispatch.mockClear(); measure.mockClear();
            const frames: Array<() => void> = [];
            h.mockWin.requestAnimationFrame.mockClear();
            h.mockWin.requestAnimationFrame.mockImplementation(fn => { frames.push(fn); return frames.length; });
            resize.dispatch('pointerdown', { pointerId: 21, button: 0, clientX: 724, clientY: 200, preventDefault: vi.fn(), stopPropagation: vi.fn() });
            const move = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointermove')?.[1] as (e: unknown) => void;
            const end = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointerup')?.[1] as (e: unknown) => void;
            h.mockWin.getComputedStyle.mockClear();
            for (let i = 1; i <= 20; i++) move({ pointerId: 21, clientX: 724 - i * 2, clientY: 200, preventDefault: vi.fn() });
            const touch = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'touchmove')?.[1] as (e: unknown) => void;
            touch({ touches: [{ clientX: 684, clientY: 200 }], preventDefault: vi.fn() });
            expect(dispatch).not.toHaveBeenCalled();
            expect(h.mockWin.requestAnimationFrame).toHaveBeenCalledOnce();
            expect(ctrl.getRenderedAuxRect()!.width).toBe(300);
            frames[0]();
            expect(ctrl.getRenderedAuxRect()!.width).toBe(340);
            expect(measure).toHaveBeenCalledOnce();
            expect(dispatch).not.toHaveBeenCalled();
            expect(h.mockWin.getComputedStyle).not.toHaveBeenCalled();
            move({ pointerId: 21, clientX: 664, clientY: 200, preventDefault: vi.fn() });
            end({ pointerId: 21 });
            expect(ctrl.getAuxState().width).toBe(360);
            expect(h.mockPlugin.settings.immersive.mobileAuxPanel?.width).toBe(360);
            expect(dispatch).toHaveBeenCalledOnce();
            frames[1](); // A canceled frame cannot apply the last sample twice.
            expect(dispatch).toHaveBeenCalledOnce();
            resize.dispatch('pointerdown', { pointerId: 22, button: 0, clientX: 664, clientY: 200, preventDefault: vi.fn(), stopPropagation: vi.fn() });
            const pendingMove = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointermove')?.[1] as (e: unknown) => void;
            pendingMove({ pointerId: 22, clientX: 644, clientY: 200, preventDefault: vi.fn() });
            await ctrl.setAuxLocked(true);
            frames[2]();
            expect(ctrl.getAuxState().width).toBe(360);
            await ctrl.setAuxLocked(false);
            resize.dispatch('pointerdown', { pointerId: 23, button: 0, clientX: 664, clientY: 200, preventDefault: vi.fn(), stopPropagation: vi.fn() });
            const finalMove = h.mockDoc.addEventListener.mock.calls.slice().reverse().find(c => c[0] === 'pointermove')?.[1] as (e: unknown) => void;
            finalMove({ pointerId: 23, clientX: 634, clientY: 200, preventDefault: vi.fn() });
            await h.mgr.exitImmersiveMode();
            frames[3]();
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('');
            expect(h.mockWin.cancelAnimationFrame).toHaveBeenCalledWith(4);
        } finally { h.restorePlatform(); }
    });

    it('keeps phone auxiliary panels floating even when settings contain a tablet docking preference', async () => {
        const h = await setupMobileHarness({ mobileAuxPanel: { isOpen: true, isDocked: true, x: 24, y: 90, width: 300, height: 290 } });
        try {
            await h.mgr.toggleImmersiveMode();
            expect(h.bodyEl.findByClass('wn-immersive-mobile-aux-dock-btn')).toBeNull();
            expect(h.mgr.getMobileController()!.getRenderedAuxRect()).toMatchObject({ x: 24, y: 90, width: 300, height: 290 });
            expect(h.bodyEl.style['--wn-immersive-mobile-dock-width']).toBe('0px');
            expect(h.mgr.getMobileController()!.getAuxState().isDocked).toBe(true);
            await h.mgr.exitImmersiveMode();
        } finally { h.restorePlatform(); }
    });

    it('opens writing quick settings beside exit in the topbar and applies typewriter/manuscript changes, then closes on exit', async () => {
        const { Setting } = await import('obsidian');
        const settings = Setting as unknown as { instances: Array<{
            _name: string;
            _toggle?: { onChange?: (value: boolean) => Promise<void> | void };
            _slider?: { onChange?: (value: number) => Promise<void> | void };
        }> };
        const h = await setupMobileHarness();
        try {
            await h.mgr.toggleImmersiveMode();
            expect(h.bodyEl.findByClass('wn-immersive-mobile-dir-settings-btn')).toBeNull();
            const gear = h.bodyEl.findByClass('wn-immersive-mobile-settings-btn');
            const right = h.bodyEl.findByClass('wn-immersive-mobile-topbar-right')!;
            expect(right.children[0]).toBe(gear);
            expect(right.children[1].classList.contains('wn-immersive-mobile-exit-btn')).toBe(true);
            expect(gear).not.toBeNull();
            settings.instances = [];
            gear!.dispatch('click', { stopPropagation: vi.fn() });
            const ctrl = h.mgr.getMobileController()!;
            const state = ctrl as unknown as { activeSettingsModal: { close(): void } | null };
            expect(state.activeSettingsModal).not.toBeNull();
            const find = (key: string) => settings.instances.find(s => s._name === t(key))!;
            await find('setting.immersive-typewriter-enable')._toggle!.onChange!(true);
            expect(h.mockPlugin.settings.immersive.typewriterEnabled).toBe(true);
            expect(h.bodyEl.classList.contains('wn-typewriter-active')).toBe(true);
            await find('setting.immersive-typewriter-offset')._slider!.onChange!(12);
            await find('setting.immersive-typewriter-opacity')._slider!.onChange!(0.6);
            expect(h.mockPlugin.settings.immersive.typewriterCenterOffset).toBe(12);
            expect(h.bodyEl.style['--wn-typewriter-opacity']).toBe('0.6');
            const handle = vi.spyOn(h.mgr, 'handleManuscriptModeSettingChanged').mockResolvedValue(true);
            const manuscript = find('setting.immersive-manuscript-mode')._toggle!.onChange!;
            await manuscript(true);
            expect(handle).toHaveBeenCalledWith(true);
            expect(h.mockPlugin.settings.immersive.manuscriptModeEnabled).toBe(true);
            const close = vi.spyOn(state.activeSettingsModal!, 'close');
            await h.mgr.exitImmersiveMode();
            expect(close).toHaveBeenCalledTimes(1);
            expect(state.activeSettingsModal).toBeNull();
            await manuscript(false);
            expect(h.mockPlugin.settings.immersive.manuscriptModeEnabled).toBe(true);
        } finally { h.restorePlatform(); }
    });

    it('avoids Android host --safe-area-inset-* when env() is 0, enforces >=44px operable topbar content, excludes side/bottom insets from aux bounds without double-counting', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const postcss = (await import('postcss')).default;

        const stylesRoot = path.resolve(process.cwd(), 'src', 'styles');
        const readBundledCss = (entryPath: string): string => fs.readFileSync(entryPath, 'utf8')
            .replace(/@import\s+["']([^"']+)["'];/g, (_, rel: string) => readBundledCss(path.resolve(path.dirname(entryPath), rel)));
        const root = postcss.parse(readBundledCss(path.join(stylesRoot, 'index.css')));

        const declsFor = (sel: string): Record<string, string> => {
            const out: Record<string, string> = {};
            root.walkRules(r => {
                if (r.selector.trim() === sel) {
                    r.walkDecls(d => { out[d.prop] = d.value; });
                }
            });
            return out;
        };

        const topbarCss = declsFor('.wn-immersive-mobile-topbar');
        expect(topbarCss['padding-top']).toContain('--safe-area-inset-top');
        expect(topbarCss['padding-top']).toContain('env(safe-area-inset-top');
        expect(topbarCss['padding-left']).toContain('--safe-area-inset-left');
        expect(topbarCss['padding-right']).toContain('--safe-area-inset-right');
        expect(topbarCss['min-height']).toContain('44px');
        expect(topbarCss['min-height']).toContain('--safe-area-inset-top');

        const dirOverlayCss = declsFor('.wn-immersive-mobile-dir-overlay');
        expect(dirOverlayCss['padding-left']).toContain('--safe-area-inset-left');
        expect(dirOverlayCss['padding-bottom']).toContain('--safe-area-inset-bottom');

        const dirRestoreCss = declsFor('.wn-immersive-mobile-dir-restore-btn');
        expect(dirRestoreCss['left']).toContain('--safe-area-inset-left');

        const mobileWsCss = declsFor('body.wn-immersive-mode-active.wn-immersive-mobile-active .app-container.app-container .workspace.workspace');
        expect(mobileWsCss['padding-bottom']).toContain('--safe-area-inset-bottom');
        expect(mobileWsCss['padding-bottom']).toContain('env(safe-area-inset-bottom');

        const h = await setupMobileHarness({
            safeAreaVars: {
                '--safe-area-inset-top': '32px',
                '--safe-area-inset-bottom': '24px',
                '--safe-area-inset-left': '16px',
                '--safe-area-inset-right': '12px'
            },
            mobileAuxPanel: { isOpen: true, x: 0, y: 0, width: 390, height: 844 }
        });

        try {
            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;
            // Stub offsetHeight is 44, host safe top is 32 -> measured height must cover 44 + 32 = 76
            expect(h.bodyEl.style['--wn-immersive-mobile-topbar-height']).toBe('76px');
            let rect = ctrl.getRenderedAuxRect()!;
            expect(rect.y).toBeGreaterThanOrEqual(76 + 8);
            expect(rect.x).toBeGreaterThanOrEqual(16 + 8);
            expect(rect.x + rect.width).toBeLessThanOrEqual(390 - 12 - 8);
            expect(rect.y + rect.height).toBeLessThanOrEqual(844 - 24 - 8);

            // Real browser where offsetHeight ALREADY includes padding-top (76px): must NOT double-count 76 + 32
            const topBarEl = h.bodyEl.findByClass('wn-immersive-mobile-topbar')!;
            topBarEl.offsetHeight = 76;
            ctrl.syncViewportMetrics(true);
            expect(h.bodyEl.style['--wn-immersive-mobile-topbar-height']).toBe('76px');

            // Orientation / safe-area change to landscape: must not cumulatively shift
            h.safeAreaVars['--safe-area-inset-top'] = '0px';
            h.safeAreaVars['--safe-area-inset-left'] = '48px';
            h.safeAreaVars['--safe-area-inset-right'] = '48px';
            h.safeAreaVars['--safe-area-inset-bottom'] = '20px';
            topBarEl.offsetHeight = 44;
            h.mockWin.innerWidth = 844;
            h.mockWin.innerHeight = 390;
            h.visualViewport.width = 844;
            h.visualViewport.height = 390;
            for (const fn of h.vvListeners.get('resize') ?? []) fn();
            expect(h.bodyEl.style['--wn-immersive-mobile-topbar-height']).toBe('44px');
            rect = ctrl.getRenderedAuxRect()!;
            expect(rect.x).toBeGreaterThanOrEqual(48 + 8);
            expect(rect.x + rect.width).toBeLessThanOrEqual(844 - 48 - 8);
            expect(rect.y + rect.height).toBeLessThanOrEqual(390 - 20 - 8);

            // Keyboard open (vv.height = 240 < 390 - 20) must NOT double-subtract bottom safe area;
            // vv.offsetLeft = 20 with safeLeft = 48 must NOT double-count 20 + 48.
            h.visualViewport.height = 240;
            h.visualViewport.offsetLeft = 20;
            for (const fn of h.vvListeners.get('resize') ?? []) fn();
            rect = ctrl.getRenderedAuxRect()!;
            expect(rect.y + rect.height).toBeLessThanOrEqual(240 - 8);
            expect(rect.x).toBe(48 + 8);

            await h.mgr.exitImmersiveMode();
        } finally {
            h.restorePlatform();
        }
    });

    it('keeps auxiliary enablement in settings and component selection and locking in the floating panel', async () => {
        const { Setting } = await import('obsidian');
        const MockSetting = Setting as unknown as {
            instances: Array<{
                _name: string;
                _toggle?: { value: boolean; onChange?: (v: boolean) => Promise<void> | void };
                _dropdown?: { options: Array<{ value: string; label: string }>; value: string; onChange?: (v: string) => Promise<void> | void };
                _slider?: { min: number; max: number; step: number; value: number; onChange?: (v: number) => Promise<void> | void };
            }>;
        };

        const h = await setupMobileHarness({
            mobileAuxPanel: {
                viewType: 'outline',
                isOpen: false,
                isMinimized: true,
                isLocked: true,
                x: 24, y: 90, width: 310, height: 290
            }
        });

        try {
            const tab = new AccurateCountSettingTab(h.mockPlugin.app as never, h.mockPlugin as never);
            const settingsContainer = makeEl('div', 'settings');
            MockSetting.instances = [];
            (tab as unknown as { displayImmersiveModeSettings: (c: unknown) => void }).displayImmersiveModeSettings(settingsContainer);

            // Desktop-only sections must not render on mobile
            expect(MockSetting.instances.some(s => s._name === t('setting.immersive-layout-builder'))).toBe(false);
            expect(MockSetting.instances.some(s => s._name === t('setting.immersive-dashboard-toggles'))).toBe(false);

            // Only enablement remains in settings; component selection and locking live in the panel.
            const auxToggleSetting = MockSetting.instances.find(s => s._name === t('setting.immersive-mobile-aux-enabled'));
            expect(auxToggleSetting?._toggle).toBeDefined();
            expect(MockSetting.instances.some(s => s._name === t('setting.immersive-mobile-aux-view'))).toBe(false);
            expect(MockSetting.instances.some(s => s._name === t('immersive.mobile-aux-lock'))).toBe(false);

            // Pomodoro controls in mobile settings
            const pomoToggleSetting = MockSetting.instances.find(s => s._name === t('setting.immersive-pomodoro-enabled'));
            const pomoSliderSetting = MockSetting.instances.find(s => s._name === t('setting.immersive-pomodoro-interval'));
            expect(pomoToggleSetting?._toggle).toBeDefined();
            expect(pomoSliderSetting?._slider).toMatchObject({ min: 20, max: 180, step: 5 });

            // Enable outside immersive mode, restoring from minimized while preserving component/lock/size/desktop slots.
            await auxToggleSetting!._toggle!.onChange?.(true);
            expect(h.mockPlugin.settings.immersive.mobileAuxPanel).toMatchObject({
                viewType: 'outline',
                isOpen: true,
                isMinimized: false,
                isLocked: true,
                width: 310,
                height: 290
            });
            expect(h.mockPlugin.settings.immersive.immersiveLeftSlots).toEqual(['immersive-chapter-list-view']);
            expect(h.mockPlugin.settings.immersive.immersiveRightSlots).toEqual(['reference-view']);

            // Enter mobile immersive mode with the remembered component visible and unminimized.
            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;
            expect(ctrl.getAuxState().isOpen).toBe(true);
            expect(ctrl.getAuxState().isMinimized).toBe(false);
            expect(ctrl.getAuxState().viewType).toBe('outline');

            // Live change from SettingsTab while active: close & minimize in controller, then re-open via SettingsTab
            await ctrl.setAuxMinimized(true);
            await auxToggleSetting!._toggle!.onChange?.(false);
            expect(ctrl.getAuxState().isOpen).toBe(false);
            await auxToggleSetting!._toggle!.onChange?.(true);
            expect(ctrl.getAuxState().isOpen).toBe(true);
            expect(ctrl.getAuxState().isMinimized).toBe(false);
            expect(ctrl.getAuxState().isLocked).toBe(true);

            const select = h.bodyEl.findByClass('wn-immersive-mobile-aux-select')!;
            expect(select).not.toBeNull();
            expect(select.children.map(o => o.value)).toEqual([...MOBILE_IMMERSIVE_AUX_VIEW_TYPES]);
            select.value = 'foreshadowing-view';
            select.dispatch('change', {});
            await Promise.resolve();
            expect(ctrl.getAuxState().viewType).toBe('foreshadowing-view');
            const lock = h.bodyEl.findByClass('wn-immersive-mobile-aux-lock-btn')!;
            expect(lock).not.toBeNull();
            expect(lock.getAttribute('aria-pressed')).toBe('true');
            lock.dispatch('click', { stopPropagation: vi.fn() });
            expect(ctrl.getAuxState().isLocked).toBe(false);
            expect(lock.getAttribute('aria-label')).toBe(t('immersive.mobile-aux-lock'));
            lock.dispatch('click', { stopPropagation: vi.fn() });
            expect(ctrl.getAuxState().isLocked).toBe(true);
            expect(lock.getAttribute('aria-label')).toBe(t('immersive.mobile-aux-unlock'));
            expect(lock.getAttribute('title')).toBeNull();
            expect(h.mockPlugin.settings.immersive.mobileAuxPanel).toMatchObject({
                viewType: 'foreshadowing-view', isLocked: true
            });

            await h.mgr.exitImmersiveMode();
        } finally {
            h.restorePlatform();
        }
    });

    it('awaits loadIfDeferred() and triggers onResize() for hosted directory/aux leaves, and detaches if closed before load settles', async () => {
        const h = await setupMobileHarness({
            mobileAuxPanel: { viewType: 'foreshadowing-view', isOpen: false }
        });

        try {
            let deferredResolve: (() => void) | null = null;
            let deferNextLoad = false;
            h.setLeafFactoryOverride(({ onResize }) => {
                const loadIfDeferred = vi.fn(async () => {
                    if (deferNextLoad) {
                        deferNextLoad = false;
                        await new Promise<void>(resolve => { deferredResolve = resolve; });
                    }
                });
                return {
                    isDeferred: true,
                    loadIfDeferred,
                    view: { getViewType: () => 'foreshadowing-view', onResize }
                };
            });

            await h.mgr.toggleImmersiveMode();
            const ctrl = h.mgr.getMobileController()!;

            // 1. Opening directory awaits loadIfDeferred and invokes view.onResize
            await ctrl.setDirectoryOpen(true);
            const dirLeafRec = h.createdLeaves[0];
            expect(dirLeafRec.loadIfDeferred).toHaveBeenCalledTimes(1);
            expect(dirLeafRec.onResize).toHaveBeenCalled();

            // 2. Opening aux view awaits loadIfDeferred and invokes view.onResize
            await ctrl.setAuxOpen(true);
            const auxLeafRec = h.createdLeaves[1];
            expect(auxLeafRec.loadIfDeferred).toHaveBeenCalledTimes(1);
            expect(auxLeafRec.onResize).toHaveBeenCalled();

            // 3. Closing aux while loadIfDeferred is still pending must detach upon completion and never mount
            await ctrl.setAuxOpen(false);
            deferNextLoad = true;
            const openTask = ctrl.setAuxOpen(true);
            for (let i = 0; i < 10 && !deferredResolve; i++) {
                await Promise.resolve();
            }
            expect(deferredResolve).not.toBeNull();
            const lateLeafRec = h.createdLeaves[h.createdLeaves.length - 1];
            const closeTask = ctrl.setAuxOpen(false);
            (deferredResolve as (() => void) | null)?.();
            await Promise.all([openTask, closeTask]);
            expect(lateLeafRec.detach).toHaveBeenCalled();
            expect(h.bodyEl.findByClass('wn-immersive-mobile-aux-body')!.children).toHaveLength(0);

            await h.mgr.exitImmersiveMode();
        } finally {
            h.restorePlatform();
        }
    });

    it('runs mobile Pomodoro on entry independently of focus tracking, supports live enable/interval/disable without unrelated resets, and cleans up timer + modal', async () => {
        const h = await setupMobileHarness({
            pomodoroEnabled: true,
            pomodoroInterval: 25,
            useFakeIntervals: true
        });
        let now = 1_700_000_000_000;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

        try {
            await h.mgr.toggleImmersiveMode();
            expect(h.mockPlugin.isTracking).toBe(false);
            expect(h.mockPlugin.startTracking).toHaveBeenCalledTimes(1);
            expect(h.mgr['pomodoroDeadline']).toBe(now + 25 * 60 * 1000);
            expect(h.setIntervalSpy).toHaveBeenCalledTimes(1);

            const tickIntervals = () => {
                for (const fn of h.intervals.values()) fn();
            };

            // Unrelated setting change (hideProperties / aux panel) must NOT reset active deadline
            const deadlineBeforeUnrelated = h.mgr['pomodoroDeadline'];
            await h.mgr.updateMobileAuxPanelSettings({ isOpen: true });
            await h.mgr.updatePomodoroSettings({});
            expect(h.mgr['pomodoroDeadline']).toBe(deadlineBeforeUnrelated);

            // Interval reconfiguration starts fresh deadline from current time
            now += 5 * 60 * 1000;
            await h.mgr.updatePomodoroSettings({ pomodoroInterval: 40 });
            expect(h.mgr['pomodoroDeadline']).toBe(now + 40 * 60 * 1000);

            // Advance to new deadline while isTracking=false -> modal opens once
            now += 40 * 60 * 1000;
            tickIntervals();
            expect(h.mgr['activePomodoroModal']).not.toBeNull();
            expect(h.mockPlugin.startTracking).toHaveBeenCalledTimes(1);
            expect(h.mockPlugin.stopTracking).toHaveBeenCalledTimes(1);

            // Rest does not restart focus tracking; explicitly starting the next round does.
            now += 5 * 60 * 1000;
            tickIntervals();
            expect(h.mockPlugin.startTracking).toHaveBeenCalledTimes(1);
            const restModal = h.mgr['activePomodoroModal']!;
            (restModal as unknown as { actionTaken: 'next' | 'dismiss' | null }).actionTaken = 'next';
            restModal.close();
            expect(h.mockPlugin.startTracking).toHaveBeenCalledTimes(2);
            expect(h.mgr['pomodoroDeadline']).toBe(now + 40 * 60 * 1000);

            now += 40 * 60 * 1000;
            tickIntervals();
            expect(h.mockPlugin.stopTracking).toHaveBeenCalledTimes(2);

            // Disabling Pomodoro cancels deadline, stops timer, and silently disposes active reminder
            const activeModal = h.mgr['activePomodoroModal']!;
            const closeSpy = vi.spyOn(activeModal, 'close');
            await h.mgr.updatePomodoroSettings({ pomodoroEnabled: false });
            expect(closeSpy).toHaveBeenCalled();
            expect(h.mgr['activePomodoroModal']).toBeNull();
            expect(h.mgr['pomodoroDeadline']).toBeNull();
            expect(h.intervals.size).toBe(0);

            // Re-enabling mid-session starts fresh round & timer
            now += 60 * 1000;
            await h.mgr.updatePomodoroSettings({ pomodoroEnabled: true, pomodoroInterval: 20 });
            expect(h.mgr['pomodoroDeadline']).toBe(now + 20 * 60 * 1000);
            expect(h.intervals.size).toBe(1);

            // Trigger reminder again, then verify shutdown/exit cleans up timer + modal
            now += 20 * 60 * 1000;
            tickIntervals();
            expect(h.mgr['activePomodoroModal']).not.toBeNull();

            await h.mgr.exitImmersiveMode();
            expect(h.intervals.size).toBe(0);
            expect(h.clearIntervalSpy).toHaveBeenCalled();
            expect(h.mgr['activePomodoroModal']).toBeNull();
            expect(h.mgr['pomodoroDeadline']).toBeNull();
            expect(h.mockPlugin.stopTracking).toHaveBeenCalledTimes(4);
        } finally {
            nowSpy.mockRestore();
            h.restorePlatform();
        }
    });
});
