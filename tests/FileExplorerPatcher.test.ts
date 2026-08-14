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

	it('should return false and retry enable when leaves exist but getSortedFolderItems is not available yet', () => {
		const setTimeoutSpy = vi.fn(() => 1);
		vi.stubGlobal('window', {
			setTimeout: setTimeoutSpy,
			clearTimeout: vi.fn()
		});

		const unreadyView = {};
		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [{ view: unreadyView }]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { chapterNamingRules: [] },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		const result = patcher.enable();

		expect(result).toBe(false);
		expect(patcher.isEnabled()).toBe(false);
		expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
	});

	it('should patch newly recreated file explorer views with different prototypes on layout-change', () => {
		vi.stubGlobal('window', {
			cancelAnimationFrame: vi.fn(),
			clearTimeout: vi.fn()
		});
		vi.stubGlobal('activeDocument', {
			activeElement: null,
			body: { classList: { remove: vi.fn() } },
			querySelectorAll: vi.fn(() => [])
		});

		// 模拟两个具有不同原型的文件浏览器视图
		class DummyProto { getSortedFolderItems() { return []; } }
		const proto1 = new DummyProto();
		const proto2 = new DummyProto();

		const originalProto1Method = proto1.getSortedFolderItems;
		const originalProto2Method = proto2.getSortedFolderItems;

		const view1 = Object.create(proto1);
		const view2 = Object.create(proto2);

		let currentLeaves = [{ view: view1 }];
		const workspaceEvents: Record<string, () => void> = {};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => currentLeaves),
				on: vi.fn((eventName: string, handler: () => void) => {
					workspaceEvents[eventName] = handler;
					return {};
				}),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);

		// 初始启用，应该修补 proto1
		patcher.enable();
		expect(proto1.getSortedFolderItems).not.toBe(originalProto1Method);
		expect(proto2.getSortedFolderItems).toBe(originalProto2Method);

		// 模拟文件浏览器重建（具有新的原型）
		currentLeaves = [{ view: view2 }];

		// 触发 layout-change
		expect(workspaceEvents['layout-change']).toBeDefined();
		workspaceEvents['layout-change']();

		// 验证新的原型 proto2 也被成功修补
		expect(proto1.getSortedFolderItems).not.toBe(originalProto1Method);
		expect(proto2.getSortedFolderItems).not.toBe(originalProto2Method);

		// 禁用并显式清理修补时，两个原型都应恢复原方法
		patcher.disable();
		patcher.unpatch();
		expect(proto1.getSortedFolderItems).toBe(originalProto1Method);
		expect(proto2.getSortedFolderItems).toBe(originalProto2Method);
	});
});
