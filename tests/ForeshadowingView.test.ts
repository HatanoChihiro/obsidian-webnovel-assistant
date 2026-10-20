import type { WorkspaceLeaf } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ForeshadowingView, type ForeshadowingViewPlugin } from '../src/ui/ForeshadowingView';
import { TouchDragPolyfill } from '../src/utils/TouchDragPolyfill';
import { MockElement } from './mocks/MockElement';

vi.mock('../src/utils/TouchDragPolyfill', () => ({
	TouchDragPolyfill: { register: vi.fn() }
}));

function setupMockContainer(view: ForeshadowingView, ownerWin?: unknown) {
	const container = new MockElement('workspace-leaf-content');
	const headerEl = new MockElement('view-header');
	const contentEl = new MockElement('view-content');
	container.children.push(headerEl, contentEl);
	headerEl.parentElement = container;
	contentEl.parentElement = container;
	if (ownerWin) {
		Object.assign(container, { ownerDocument: { defaultView: ownerWin } });
	}
	Object.assign(view, { containerEl: container });
	return { container, contentEl };
}

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

	it('discards delayed entries when switching folder', async () => {
		let resolveA!: (content: string) => void;
		const readPromiseA = new Promise<string>((resolve) => { resolveA = resolve; });

		const app = {
			workspace: {
				on: vi.fn(),
				trigger: vi.fn(),
				getActiveFile: vi.fn().mockReturnValue(null),
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getMostRecentLeaf: vi.fn().mockReturnValue(null)
			},
			vault: {
				on: vi.fn(),
				read: vi.fn().mockImplementation((file: { path: string }) => {
					if (file.path.includes('BookA')) return readPromiseA;
					return Promise.resolve('## 伏笔B\n');
				})
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) }
		};

		const plugin = {
			settings: { foreshadowing: { fileName: '伏笔' }, workspaceFolders: [] },
			foreshadowingManager: {
				getForeshadowingFileByFolder: vi.fn().mockImplementation((f: string) => ({ path: `${f}/伏笔.md` })),
				parseEntries: vi.fn().mockImplementation((content: string) => {
					return [{
						description: content.trim(),
						status: 'pending',
						sourceFile: 'Chapter1',
						tags: [],
						contents: []
					}];
				})
			}
		} as unknown as ForeshadowingViewPlugin;

		const view = new ForeshadowingView({ app } as unknown as WorkspaceLeaf, plugin);
		setupMockContainer(view);
		view.registerEvent = vi.fn();
		view.currentFolder = 'BookA';

		const refreshA = view.refresh();

		// Switch to BookB and refresh completes
		view.currentFolder = 'BookB';
		await view.refresh();

		const contentEl = view.containerEl.children[1] as HTMLElement;
		expect(contentEl.querySelector('.foreshadowing-view-folder')?.textContent).toBe('BookB');

		// Resolve delayed read for A
		resolveA('## 伏笔A\n');
		await refreshA;

		// Should not be overwritten with BookA
		expect(contentEl.querySelector('.foreshadowing-view-folder')?.textContent).toBe('BookB');
	});

	it('discards pending read and does not render when closed', async () => {
		let resolveRead!: (content: string) => void;
		const app = {
			workspace: { on: vi.fn(), trigger: vi.fn() },
			vault: {
				on: vi.fn(),
				read: vi.fn().mockImplementation(() => new Promise<string>((res) => { resolveRead = res; }))
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) }
		};
		const plugin = {
			settings: { foreshadowing: {}, workspaceFolders: [] },
			foreshadowingManager: {
				getForeshadowingFileByFolder: vi.fn().mockReturnValue({ path: '伏笔.md' }),
				parseEntries: vi.fn().mockReturnValue([{ description: 'F1', status: 'pending', sourceFile: 'Ch1', tags: [], contents: [] }])
			}
		} as unknown as ForeshadowingViewPlugin;

		const view = new ForeshadowingView({ app } as unknown as WorkspaceLeaf, plugin);
		setupMockContainer(view);
		view.registerEvent = vi.fn();
		view.currentFolder = 'BookA';

		const refreshPromise = view.refresh();
		await view.onClose();

		resolveRead('## 伏笔\n');
		await refreshPromise;

		const contentEl = view.containerEl.children[1] as HTMLElement;
		expect(contentEl.querySelectorAll('.foreshadowing-entry-card')).toHaveLength(0);
	});

	it('cancels pending refresh timer on owner window when closed', async () => {
		const mockClearTimeout = vi.fn();
		const mockOwnerWin = {
			setTimeout: vi.fn().mockReturnValue(123),
			clearTimeout: mockClearTimeout
		};
		const app = {
			workspace: { on: vi.fn(), trigger: vi.fn() },
			vault: { on: vi.fn() },
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) }
		};
		const plugin = {
			settings: { foreshadowing: {}, workspaceFolders: [] },
			foreshadowingManager: {
				getForeshadowingFileByFolder: vi.fn().mockReturnValue(null),
				parseEntries: vi.fn().mockReturnValue([])
			}
		} as unknown as ForeshadowingViewPlugin;

		const view = new ForeshadowingView({ app } as unknown as WorkspaceLeaf, plugin);
		setupMockContainer(view, mockOwnerWin);
		(view as unknown as { schedulePendingRefresh: () => void }).schedulePendingRefresh();

		expect(mockOwnerWin.setTimeout).toHaveBeenCalled();
		await view.onClose();
		expect(mockClearTimeout).toHaveBeenCalledWith(123);
	});

	it('discards older read when switching A -> B -> A before older read completes', async () => {
		let resolveFirstA!: (content: string) => void;
		const firstReadPromise = new Promise<string>((resolve) => { resolveFirstA = resolve; });

		const app = {
			workspace: { on: vi.fn(), trigger: vi.fn() },
			vault: {
				on: vi.fn(),
				read: vi.fn().mockImplementation((file: { path: string }) => {
					if (file.path.includes('BookA_1')) return firstReadPromise;
					if (file.path.includes('BookB')) return Promise.resolve('## 伏笔B\n');
					return Promise.resolve('## 伏笔A_New\n');
				})
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) }
		};

		let callCount = 0;
		const plugin = {
			settings: { foreshadowing: { fileName: '伏笔' }, workspaceFolders: [] },
			foreshadowingManager: {
				getForeshadowingFileByFolder: vi.fn().mockImplementation((f: string) => {
					if (f === 'BookA') {
						callCount++;
						return { path: callCount === 1 ? 'BookA_1/伏笔.md' : 'BookA_2/伏笔.md' };
					}
					return { path: `${f}/伏笔.md` };
				}),
				parseEntries: vi.fn().mockImplementation((content: string) => {
					return [{
						description: content.trim(),
						status: 'pending',
						sourceFile: 'Chapter1',
						tags: [],
						contents: []
					}];
				})
			}
		} as unknown as ForeshadowingViewPlugin;

		const view = new ForeshadowingView({ app } as unknown as WorkspaceLeaf, plugin);
		setupMockContainer(view);
		view.registerEvent = vi.fn();
		view.currentFolder = 'BookA';

		const firstRefresh = view.refresh();

		// Switch to B, then back to A
		view.currentFolder = 'BookB';
		await view.refresh();

		view.currentFolder = 'BookA';
		await view.refresh();

		const contentEl = view.containerEl.children[1] as HTMLElement;
		const descBefore = contentEl.querySelector('.foreshadowing-entry-desc-text')?.textContent;
		expect(descBefore).toBe('## 伏笔A_New');

		// Resolve first read
		resolveFirstA('## 伏笔A_Old\n');
		await firstRefresh;

		// Stale read must NOT append or replace A_Old
		const allDescs = contentEl.querySelectorAll('.foreshadowing-entry-desc-text');
		expect(allDescs).toHaveLength(1);
		expect(allDescs[0]?.textContent).toBe('## 伏笔A_New');
	});
	it('keeps action writes in their original work and ignores completion after A -> B -> A', async () => {
		let finishWrite!: (success: boolean) => void;
		const write = new Promise<boolean>(resolve => { finishWrite = resolve; });
		const owner = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
		const app = { workspace: { trigger: vi.fn() }, vault: { read: vi.fn().mockResolvedValue('entry') } };
		const plugin = {
			settings: { foreshadowing: {}, workspaceFolders: [] },
			foreshadowingManager: {
				getForeshadowingFileByFolder: vi.fn((folder: string) => ({ path: folder + '/伏笔.md' })),
				parseEntries: vi.fn().mockReturnValue([{ description: 'entry', status: 'pending', sourceFile: '', tags: [], contents: [] }]),
				markAsDeprecated: vi.fn(() => write)
			}
		} as unknown as ForeshadowingViewPlugin;
		const view = new ForeshadowingView({ app } as unknown as WorkspaceLeaf, plugin);
		const { contentEl } = setupMockContainer(view, owner);
		view.currentFolder = 'A';
		await view.refresh();
		(contentEl.querySelector('.foreshadowing-deprecate-btn') as unknown as MockElement).click();
		view.currentFolder = 'B';
		await view.refresh();
		view.currentFolder = 'A';
		await view.refresh();
		finishWrite(true);
		await write;
		await Promise.resolve();
		expect(plugin.foreshadowingManager.markAsDeprecated).toHaveBeenCalledWith({ path: 'A/伏笔.md' }, 'entry');
		expect(owner.setTimeout).not.toHaveBeenCalled();
	});

	it('ignores an old timer callback without losing the current owner-window timer', async () => {
		const callbacks: Array<() => void> = [];
		const owner = {
			setTimeout: vi.fn((callback: () => void) => { callbacks.push(callback); return callbacks.length; }),
			clearTimeout: vi.fn()
		};
		const view = new ForeshadowingView({ app: {} } as unknown as WorkspaceLeaf, {} as ForeshadowingViewPlugin);
		setupMockContainer(view, owner);
		const schedule = () => (view as unknown as { schedulePendingRefresh(): void }).schedulePendingRefresh();
		schedule();
		schedule();
		const refresh = vi.spyOn(view, 'refresh').mockResolvedValue(undefined);
		callbacks[0]();
		await view.onClose();
		expect(refresh).not.toHaveBeenCalled();
		expect(owner.clearTimeout.mock.calls.map(([id]) => id)).toEqual([1, 2]);
	});

});
