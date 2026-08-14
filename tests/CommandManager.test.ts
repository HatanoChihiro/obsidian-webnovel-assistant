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

import { CommandManager } from '../src/core/CommandManager';

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
