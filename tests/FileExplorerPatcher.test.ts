import { afterEach, describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { FileExplorerPatcher } from '../src/services/FileExplorerPatcher';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile } from './mocks/obsidian';

describe('FileExplorerPatcher', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('should debounce sort order persistence during a batch rename', () => {
		vi.stubGlobal('window', {
			setTimeout: vi.fn(() => 1),
			clearTimeout: vi.fn()
		});

		const vaultEvents: Record<string, (file: TFile, oldPath: string) => void> = {};
		const pendingCallbacks = new Map<string, () => void>();
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const mockApp = {
			vault: {
				on: vi.fn((eventName: string, handler: (file: TFile, oldPath: string) => void) => {
					vaultEvents[eventName] = handler;
					return {};
				})
			},
			workspace: {
				on: vi.fn(() => ({}))
			}
		} as unknown as App;
		const mockPlugin = {
			settings: {
				customSortOrder: {
					'Novel/1.md': 1,
					'Novel/2.md': 2
				}
			},
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((key: string, callback: () => void) => {
					pendingCallbacks.set(key, callback);
				})
			},
			saveSettings
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		(patcher as unknown as { enabled: boolean }).enabled = true;
		(patcher as unknown as { setupFileSystemListeners: () => void }).setupFileSystemListeners();

		const renameHandler = vaultEvents.rename;
		renameHandler(new TFile('3.md', 'Novel/3.md'), 'Novel/1.md');
		renameHandler(new TFile('4.md', 'Novel/4.md'), 'Novel/2.md');

		expect(saveSettings).not.toHaveBeenCalled();
		expect(mockPlugin.adaptiveDebounceManager.debounceFixed).toHaveBeenCalledTimes(2);
		expect(pendingCallbacks.has('file-explorer-sort-order-save')).toBe(true);

		pendingCallbacks.get('file-explorer-sort-order-save')?.();

		expect(saveSettings).toHaveBeenCalledTimes(1);
	});
});
