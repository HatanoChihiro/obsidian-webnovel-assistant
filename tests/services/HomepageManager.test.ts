import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { HomepageManager } from '../../src/services/HomepageManager';
import type { WebNovelAssistantPlugin } from '../../src/types/plugin';

const { mockRenderHomepage } = vi.hoisted(() => ({
	mockRenderHomepage: vi.fn()
}));

vi.mock('../../src/ui/components/HomepageRenderer.js', () => {
	return {
		HomepageRenderer: class {
			renderHomepage = mockRenderHomepage;
		}
	};
});

describe('HomepageManager', () => {
	it('should route refresh paths correctly per leaf without redundancy', async () => {
		const mockRerender1 = vi.fn();
		const mockRerender2 = vi.fn();
		const mockRootEl1 = {}; // has root
		const mockRootEl2 = null; // missing root

		const mockLeaf1 = {
			view: {
				getViewType: () => 'markdown',
				file: { path: 'NovelA/创作主页.md' },
				previewMode: { rerender: mockRerender1 },
				containerEl: { querySelector: vi.fn().mockReturnValue(mockRootEl1) }
			}
		};
		const mockLeaf2 = {
			view: {
				getViewType: () => 'markdown',
				file: { path: 'NovelA/创作主页.md' },
				previewMode: { rerender: mockRerender2 },
				containerEl: { querySelector: vi.fn().mockReturnValue(mockRootEl2) }
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

		// Case 1: direct renderHomepage succeeds
		mockRenderHomepage.mockResolvedValue(true);
		await manager.refreshHomepageViews();
		expect(mockRenderHomepage).toHaveBeenCalledWith(mockRootEl1);
		expect(mockRerender1).not.toHaveBeenCalled(); // Successful render, no fallback
		expect(mockRerender2).toHaveBeenCalledTimes(1); // Missing root, fallback once

		// Case 2: Error thrown during renderHomepage -> fallback
		mockRenderHomepage.mockReset();
		mockRerender1.mockReset();
		mockRerender2.mockReset();
		mockRenderHomepage.mockRejectedValue(new Error('test error'));
		await manager.refreshHomepageViews();
		expect(mockRenderHomepage).toHaveBeenCalledWith(mockRootEl1);
		expect(mockRerender1).toHaveBeenCalledTimes(1); // Render failed, fallback once
		expect(mockRerender2).toHaveBeenCalledTimes(1); // Missing root, fallback once
	});
});
