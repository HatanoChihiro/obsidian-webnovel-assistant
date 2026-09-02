import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/ui/WorkbenchView', () => ({ WorkbenchView: class WorkbenchView {} }));
vi.mock('../src/ui/ForeshadowingModal', () => ({
    ForeshadowingInputModal: class ForeshadowingInputModal {},
    ConfirmCreateForeshadowingFileModal: class ConfirmCreateForeshadowingFileModal {},
    ForeshadowingRecoveryModal: class ForeshadowingRecoveryModal {}
}));
vi.mock('../src/ui/TimelineAddModal', () => ({ TimelineAddModal: class TimelineAddModal {} }));
vi.mock('../src/ui/AdvancedSearchModal', () => ({ AdvancedSearchModal: class AdvancedSearchModal {} }));
vi.mock('../src/ui/AddLoreModal', () => ({ AddLoreModal: class AddLoreModal {} }));
vi.mock('../src/ui/GoalModal', () => ({ GoalModal: class GoalModal {} }));
vi.mock('../src/ui/TypographyQuickModal', () => ({ TypographyQuickModal: class TypographyQuickModal {} }));
vi.mock('../src/ui/DailyStatsActionModal', () => ({ DailyStatsActionModal: class DailyStatsActionModal {} }));
export const mockAnnotateModalOpen = vi.fn();
vi.mock('../src/ui/AnnotateDictModal', () => ({
    AnnotateDictModal: class AnnotateDictModal {
        public app: unknown;
        public plugin: unknown;
        public text: string;
        constructor(app: unknown, plugin: unknown, text: string) {
            this.app = app;
            this.plugin = plugin;
            this.text = text;
        }
        open = mockAnnotateModalOpen;
    }
}));

import { TFile } from 'obsidian';
import { CommandManager } from '../src/core/CommandManager';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';

describe('CommandManager - refresh-lore-cache', () => {
    let mockApp: any;
    let mockPlugin: any;
    let registeredCommands: Map<string, any>;

    beforeEach(() => {
        vi.clearAllMocks();
        registeredCommands = new Map();

        mockApp = {
            workspace: {
                trigger: vi.fn(),
                getLeavesOfType: vi.fn().mockReturnValue([])
            },
            vault: {
                getAbstractFileByPath: vi.fn()
            }
        };

        mockPlugin = {
            app: mockApp,
            settings: {
                typography: {
                    enableBodyFontSize: false,
                    bodyFontSize: 16
                }
            },
            characterManager: {
                rebuildCache: vi.fn().mockResolvedValue(undefined)
            },
            loreSyncService: {
                bulkRefresh: vi.fn().mockResolvedValue({ total: 10, success: 9, failed: 1 })
            },
            addCommand: vi.fn().mockImplementation((cmd: any) => {
                registeredCommands.set(cmd.id, cmd);
            })
        };
    });

    it('should register refresh-lore-cache command and invoke BOTH rebuildCache and bulkRefresh', async () => {
        const commandManager = new CommandManager(mockPlugin);
        commandManager.registerAllCommands();

        const refreshCommand = registeredCommands.get('refresh-lore-cache');
        expect(refreshCommand).toBeDefined();

        await refreshCommand.callback();

        // 1. Invoked both rebuildCache and bulkRefresh in sequence
        expect(mockPlugin.characterManager.rebuildCache).toHaveBeenCalledTimes(1);
        expect(mockPlugin.loreSyncService.bulkRefresh).toHaveBeenCalledTimes(1);

        // 2. Triggered workspace signal to refresh workbench and relation graph views
        expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-lore-updated');
    });

    it('should handle failure during rebuildCache or bulkRefresh gracefully', async () => {
        mockPlugin.characterManager.rebuildCache.mockRejectedValue(new Error('Rebuild failed'));

        const commandManager = new CommandManager(mockPlugin);
        commandManager.registerAllCommands();

        const refreshCommand = registeredCommands.get('refresh-lore-cache');
        expect(refreshCommand).toBeDefined();

        // Should not throw unhandled rejection
        await expect(refreshCommand.callback()).resolves.toBeUndefined();
        expect(mockPlugin.loreSyncService.bulkRefresh).not.toHaveBeenCalled();
    });

    it('should handle failure during bulkRefresh gracefully', async () => {
        mockPlugin.loreSyncService.bulkRefresh.mockRejectedValue(new Error('Bulk sync failed'));

        const commandManager = new CommandManager(mockPlugin);
        commandManager.registerAllCommands();

        const refreshCommand = registeredCommands.get('refresh-lore-cache');
        expect(refreshCommand).toBeDefined();

        // Should not throw unhandled rejection
        await expect(refreshCommand.callback()).resolves.toBeUndefined();
        expect(mockPlugin.characterManager.rebuildCache).toHaveBeenCalledTimes(1);
    });
});

interface MockEditor {
    getSelection: () => string;
}

interface MockView {
    file: TFile | null;
}

interface MockCommand {
    id: string;
    icon?: string;
    editorCheckCallback?: (checking: boolean, editor: MockEditor, view: MockView) => boolean | void;
}

describe('CommandManager - annotate-to-dictionary', () => {
    let mockApp: {
        workspace: {
            trigger: ReturnType<typeof vi.fn>;
            getLeavesOfType: ReturnType<typeof vi.fn>;
        };
        vault: {
            getAbstractFileByPath: ReturnType<typeof vi.fn>;
        };
    };
    let mockPlugin: {
        app: unknown;
        settings: Record<string, unknown>;
        proofreadingManager: {
            isFileInsideDictionary: ReturnType<typeof vi.fn>;
            prepareDictionaryForEditing: ReturnType<typeof vi.fn>;
        };
        addCommand: ReturnType<typeof vi.fn>;
    };
    let registeredCommands: Map<string, MockCommand>;
    const chapterFile = { name: 'Chapter1.md', path: 'NovelBook/Chapter1.md', basename: 'Chapter1', extension: 'md' } as unknown as TFile;
    const nonChapterFile = { name: 'Note.md', path: 'Other/Note.md', basename: 'Note', extension: 'md' } as unknown as TFile;
    const dictFile = { name: '错词.md', path: 'NovelBook/校对词典/错词.md', basename: '错词', extension: 'md' } as unknown as TFile;

    beforeEach(() => {
        vi.clearAllMocks();
        registeredCommands = new Map();

        mockApp = {
            workspace: {
                trigger: vi.fn(),
                getLeavesOfType: vi.fn().mockReturnValue([])
            },
            vault: {
                getAbstractFileByPath: vi.fn()
            }
        };

        mockPlugin = {
            app: mockApp,
            settings: {},
            proofreadingManager: {
                isFileInsideDictionary: vi.fn().mockImplementation((p: TFile | string) => {
                    const path = typeof p === 'string' ? p : p?.path;
                    return path?.startsWith('NovelBook/校对词典') ?? false;
                }),
                prepareDictionaryForEditing: vi.fn().mockResolvedValue('NovelBook/校对词典')
            },
            addCommand: vi.fn().mockImplementation((cmd: MockCommand) => {
                registeredCommands.set(cmd.id, cmd);
            })
        };
    });

    it('should register annotate-to-dictionary editor command with stable id and spell-check icon', () => {
        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        expect(cmd).toBeDefined();
        expect(cmd?.id).toBe('annotate-to-dictionary');
        expect(cmd?.icon).toBe('spell-check');
        expect(cmd?.editorCheckCallback).toBeDefined();
        expect(registeredCommands.has('refresh-creative-homepage')).toBe(false);
        expect(registeredCommands.has('reset-stream-session')).toBe(false);
        expect(registeredCommands.has('reset-immersive-layout')).toBe(false);
    });

    it('should return true on checking when selection is valid single-line text in a Markdown file', () => {
        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        const mockEditor: MockEditor = { getSelection: () => '迫不急待' };
        const mockView: MockView = { file: chapterFile };

        const available = cmd?.editorCheckCallback?.(true, mockEditor, mockView);
        expect(available).toBe(true);
    });

    it('should return false on checking when selection is empty (no fallback to cursor word)', () => {
        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        const mockEditor: MockEditor = { getSelection: () => '' };
        const mockView: MockView = { file: chapterFile };

        const available = cmd?.editorCheckCallback?.(true, mockEditor, mockView);
        expect(available).toBe(false);
    });

    it('should return false on checking when selection is multiline or >= 50 characters', () => {
        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        const multilineEditor: MockEditor = { getSelection: () => '第一行\n第二行' };
        const longEditor: MockEditor = { getSelection: () => '字'.repeat(50) };
        const mockView: MockView = { file: chapterFile };

        expect(cmd?.editorCheckCallback?.(true, multilineEditor, mockView)).toBe(false);
        expect(cmd?.editorCheckCallback?.(true, longEditor, mockView)).toBe(false);
    });

    it('should allow a non-chapter file but reject dictionary files and a missing file', () => {
        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        const mockEditor: MockEditor = { getSelection: () => '迫不急待' };

        expect(cmd?.editorCheckCallback?.(true, mockEditor, { file: nonChapterFile })).toBe(true);
        expect(cmd?.editorCheckCallback?.(true, mockEditor, { file: dictFile })).toBe(false);
        expect(cmd?.editorCheckCallback?.(true, mockEditor, { file: null })).toBe(false);
    });

    it('should call prepareDictionaryForEditing and open AnnotateDictModal on execution', async () => {
        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        const mockEditor: MockEditor = { getSelection: () => '  迫不急待  ' };
        const mockView: MockView = { file: chapterFile };

        const result = cmd?.editorCheckCallback?.(false, mockEditor, mockView);
        expect(result).toBe(true);

        // Allow async promise microtask to complete
        await Promise.resolve();

        expect(mockPlugin.proofreadingManager.prepareDictionaryForEditing).toHaveBeenCalledTimes(1);
        expect(mockAnnotateModalOpen).toHaveBeenCalledTimes(1);
    });

    it('should catch prepareDictionaryForEditing failure gracefully without throwing', async () => {
        mockPlugin.proofreadingManager.prepareDictionaryForEditing.mockRejectedValue(new Error('Permission denied'));

        const commandManager = new CommandManager(mockPlugin as unknown as WebNovelAssistantPlugin);
        commandManager.registerAllCommands();

        const cmd = registeredCommands.get('annotate-to-dictionary');
        const mockEditor: MockEditor = { getSelection: () => '迫不急待' };
        const mockView: MockView = { file: chapterFile };

        const result = cmd?.editorCheckCallback?.(false, mockEditor, mockView);
        expect(result).toBe(true);

        // Allow async promise microtask to complete
        await Promise.resolve();

        expect(mockPlugin.proofreadingManager.prepareDictionaryForEditing).toHaveBeenCalledTimes(1);
        expect(mockAnnotateModalOpen).not.toHaveBeenCalled();
    });
});
