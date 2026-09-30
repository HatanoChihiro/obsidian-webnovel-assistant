import type { WorkspaceLeaf } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ForeshadowingView, type ForeshadowingViewPlugin } from '../src/ui/ForeshadowingView';
import { TouchDragPolyfill } from '../src/utils/TouchDragPolyfill';

vi.mock('../src/utils/TouchDragPolyfill', () => ({
	TouchDragPolyfill: { register: vi.fn() }
}));

describe('ForeshadowingView', () => {
	it('runs the CreativeView touch cleanup when closed', async () => {
		const app = {
			workspace: {
				on: vi.fn(),
				getActiveFile: vi.fn().mockReturnValue(null),
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getMostRecentLeaf: vi.fn().mockReturnValue(null)
			},
			vault: { on: vi.fn() }
		};
		const plugin = {
			settings: { foreshadowing: {}, workspaceFolders: [] },
			foreshadowingManager: {
				findForeshadowingFile: vi.fn(),
				parseEntries: vi.fn().mockReturnValue([])
			}
		} as unknown as ForeshadowingViewPlugin;
		const cleanup = vi.fn();
		vi.mocked(TouchDragPolyfill.register).mockReturnValue(cleanup);

		const view = new ForeshadowingView({ app } as unknown as WorkspaceLeaf, plugin);
		view.registerEvent = vi.fn();
		await view.onOpen();
		expect(TouchDragPolyfill.register).toHaveBeenCalledWith(view.containerEl);

		await view.onClose();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});
