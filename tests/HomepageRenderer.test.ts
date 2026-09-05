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

	it('navigates to novel by reusing existing leaf and awaiting delayed reveal before focusing', async () => {
		let resolveReveal: () => void = () => {};
		const delayedRevealPromise = new Promise<void>((resolve) => {
			resolveReveal = resolve;
		});

		const setBookPathMock = vi.fn();
		const existingLeaf = {
			view: {
				getViewType: () => 'webnovel-workbench',
				setBookPath: setBookPathMock,
				containerEl: {
					ownerDocument: {
						defaultView: {
							setTimeout: (cb: () => void) => { cb(); return 0; }
						}
					}
				}
			}
		};

		const revealLeafMock = vi.fn().mockImplementation(() => delayedRevealPromise);
		const setActiveLeafMock = vi.fn();

		const mockApp = {
			workspace: {
				getLeavesOfType: vi.fn((type: string) => {
					if (type === 'webnovel-workbench') return [existingLeaf];
					return [];
				}),
				revealLeaf: revealLeafMock,
				setActiveLeaf: setActiveLeafMock
			}
		};

		const renderer = new HomepageRenderer(mockApp as never, {} as never);
		const navPromise = renderer.navigateToNovel('Novels/MyNovel');

		expect(setBookPathMock).toHaveBeenCalledWith('Novels/MyNovel');

		// Let microtask past win.setTimeout advance to revealLeaf
		await Promise.resolve();

		expect(revealLeafMock).toHaveBeenCalledWith(existingLeaf);
		// While revealLeaf is still pending, setActiveLeaf must not have been called
		expect(setActiveLeafMock).not.toHaveBeenCalled();

		resolveReveal();
		await navPromise;

		expect(setActiveLeafMock).toHaveBeenCalledWith(existingLeaf, { focus: true });
	});

	it('navigates to novel by creating a new leaf when none exists and reveals then focuses', async () => {
		const setBookPathMock = vi.fn();
		const setViewStateMock = vi.fn().mockResolvedValue(undefined);
		const newLeaf = {
			setViewState: setViewStateMock,
			view: {
				getViewType: () => 'webnovel-workbench',
				setBookPath: setBookPathMock,
				containerEl: {
					ownerDocument: {
						defaultView: {
							setTimeout: (cb: () => void) => { cb(); return 0; }
						}
					}
				}
			}
		};

		const getLeafMock = vi.fn().mockReturnValue(newLeaf);
		const revealLeafMock = vi.fn().mockResolvedValue(undefined);
		const setActiveLeafMock = vi.fn();

		const mockApp = {
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				getLeaf: getLeafMock,
				revealLeaf: revealLeafMock,
				setActiveLeaf: setActiveLeafMock
			}
		};

		const renderer = new HomepageRenderer(mockApp as never, {} as never);
		await renderer.navigateToNovel('Novels/NewNovel');

		expect(getLeafMock).toHaveBeenCalledWith('tab');
		expect(setViewStateMock).toHaveBeenCalledWith({ type: 'webnovel-workbench', active: true });
		expect(setBookPathMock).toHaveBeenCalledWith('Novels/NewNovel');
		expect(revealLeafMock).toHaveBeenCalledWith(newLeaf);
		expect(setActiveLeafMock).toHaveBeenCalledWith(newLeaf, { focus: true });
	});
});
