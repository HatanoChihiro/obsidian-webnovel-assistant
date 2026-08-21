import { describe, expect, it, vi } from 'vitest';
import { HomepageRenderer } from '../src/ui/components/HomepageRenderer';
import type { NovelFolderInfo } from '../src/types/homepage';

describe('HomepageRenderer render-cycle data loading', () => {
	it('loads novel folders once for all homepage sections', async () => {
		const renderer = new HomepageRenderer({} as never, {} as never);
		const novelsPromise = Promise.resolve<NovelFolderInfo[]>([]);
		const getAllNovels = vi.spyOn(
			renderer as unknown as { getAllNovelsWithMetadata(): Promise<NovelFolderInfo[]> },
			'getAllNovelsWithMetadata'
		).mockReturnValue(novelsPromise);

		vi.spyOn(renderer, 'renderWelcome').mockResolvedValue(undefined);
		const renderOngoing = vi.spyOn(renderer, 'renderOngoing').mockResolvedValue(undefined);
		const renderDrafting = vi.spyOn(renderer, 'renderDrafting').mockResolvedValue(undefined);
		const renderPaused = vi.spyOn(renderer, 'renderPaused').mockResolvedValue(undefined);
		const renderCompleted = vi.spyOn(renderer, 'renderCompleted').mockResolvedValue(undefined);
		const renderStatsSummary = vi.spyOn(renderer, 'renderStatsSummary').mockResolvedValue(undefined);
		vi.spyOn(renderer, 'renderHeatmap').mockReturnValue(undefined);
		vi.spyOn(renderer, 'renderBarChart').mockReturnValue(undefined);

		const container = {
			clientWidth: 1200,
			empty: vi.fn(),
			createDiv: vi.fn(function (this: HTMLElement) { return this; }),
			addClass: vi.fn(),
			removeClass: vi.fn(),
			closest: vi.fn(() => null)
		} as unknown as HTMLElement;

		await renderer.renderHomepage(container);

		expect(getAllNovels).toHaveBeenCalledOnce();
		for (const section of [renderOngoing, renderDrafting, renderPaused, renderCompleted, renderStatsSummary]) {
			expect(section).toHaveBeenCalledWith(container, novelsPromise);
		}
	});
});
