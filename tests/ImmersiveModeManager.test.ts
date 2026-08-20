import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImmersiveModeManager } from '../src/ui/ImmersiveModeManager';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';

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
    let mockPlugin: WebNovelAssistantPlugin;
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
        } as unknown as WebNovelAssistantPlugin;

        manager = new ImmersiveModeManager(mockPlugin.app, mockPlugin);
    });

    it('registerImmersiveEventListeners only registers fullscreenchange (no keydown)', () => {
        manager['registerImmersiveEventListeners']();

        // 设计原则：Esc 完全屏蔽，无需 keydown 监听器
        expect(registeredEvents['fullscreenchange']?.length).toBe(1);
        expect(registeredEvents['keydown']?.length ?? 0).toBe(0);
    });

    it('cleanup removes fullscreenchange listener', () => {
        manager['registerImmersiveEventListeners']();
        manager.cleanup();
        expect(registeredEvents['fullscreenchange']?.length || 0).toBe(0);
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
});
