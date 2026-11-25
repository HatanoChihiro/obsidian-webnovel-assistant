import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { HomepageManager } from '../../src/services/HomepageManager';
import type { WebNovelAssistantPlugin } from '../../src/types/plugin';

describe('HomepageManager', () => {
	it('should route refresh paths correctly per leaf without redundancy', async () => {
		const mockRerender1 = vi.fn();
		const mockRerender2 = vi.fn();
		const mockRootEl1 = {}; // has root

		const mockLeaf1 = {
			view: {
				getViewType: () => 'markdown',
				file: { path: 'NovelA/创作主页.md' },
				previewMode: { rerender: mockRerender1 },
				containerEl: { querySelectorAll: vi.fn().mockReturnValue([mockRootEl1]) }
			}
		};
		const mockLeaf2 = {
			view: {
				getViewType: () => 'markdown',
				file: { path: 'NovelA/创作主页.md' },
				previewMode: { rerender: mockRerender2 },
				containerEl: { querySelectorAll: vi.fn().mockReturnValue([]) }
			}
		};

		const mockApp = {
			workspace: {
				iterateAllLeaves: vi.fn((cb: (leaf: typeof mockLeaf1) => void) => {
					cb(mockLeaf1);
					cb(mockLeaf2);
				})
			}
		};

		const mockPlugin = {
			app: mockApp,
			settings: { homepagePath: '创作主页.md', workspaceFolders: ['NovelA'] }
		};

		const manager = new HomepageManager(
			mockApp as unknown as App,
			mockPlugin as unknown as WebNovelAssistantPlugin
		);

		const mockRenderHomepage = vi.fn().mockResolvedValue(undefined);
		manager.registerRenderChild({ containerEl: mockRootEl1, render: mockRenderHomepage, dispose: vi.fn() } as never);
		await manager.refreshHomepageViews();
		expect(mockRenderHomepage).toHaveBeenCalledOnce();
		expect(mockRerender1).not.toHaveBeenCalled(); // Successful render, no fallback
		expect(mockRerender2).toHaveBeenCalledTimes(1); // Missing root, fallback once

		// Case 2: Error thrown during renderHomepage -> fallback
		mockRenderHomepage.mockReset();
		mockRerender1.mockReset();
		mockRerender2.mockReset();
		mockRenderHomepage.mockRejectedValue(new Error('test error'));
		await manager.refreshHomepageViews();
		expect(mockRenderHomepage).toHaveBeenCalledOnce();
		expect(mockRerender1).toHaveBeenCalledTimes(1); // Render failed, fallback once
		expect(mockRerender2).toHaveBeenCalledTimes(1); // Missing root, fallback once
	});
});
