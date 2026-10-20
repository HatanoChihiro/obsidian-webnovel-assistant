import type { ParsedForeshadowingEntry } from '../src/types/foreshadowing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { ImmersiveChapterListView, type ImmersiveChapterListViewPlugin } from '../src/ui/ImmersiveChapterListView';

const { findBookRootMock } = vi.hoisted(() => ({
	findBookRootMock: vi.fn()
}));

vi.mock('obsidian', () => {
	class MockTFolder {
		children: Array<MockTFile | MockTFolder> = [];
		parent: MockTFolder | null = null;

		constructor(public name: string, public path: string) {}

		isRoot(): boolean {
			return this.path === '/';
		}
	}

	class MockTFile {
		extension = 'md';
		parent: MockTFolder | null = null;
		basename: string;

		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	class MockItemView {
		app: unknown;
		containerEl: unknown;

		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.containerEl = {};
		}

		registerEvent(): void {}
	}

	class MockVault {
		static recurseChildren(folder: MockTFolder, callback: (file: MockTFile | MockTFolder) => void): void {
			for (const child of folder.children) {
				callback(child);
				if (child instanceof MockTFolder) {
					MockVault.recurseChildren(child, callback);
				}
			}
		}
	}

	return {
		ItemView: MockItemView,
		TFile: MockTFile,
		TFolder: MockTFolder,
		Vault: MockVault
	};
});

vi.mock('../src/utils/path', () => ({
	findBookRoot: findBookRootMock
}));

vi.mock('../src/utils/badge', () => ({
	renderForeshadowingBadges: vi.fn(),
	renderLoreBadges: vi.fn()
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

interface MockLeaf {
	app: MockApp;
	containerEl: { classList: { contains: (className: string) => boolean } };
	view: { getViewType: () => string; file: TFile | null };
}

interface MockApp {
	workspace: {
		iterateAllLeaves: (callback: (leaf: MockLeaf) => void) => void;
		getLeavesOfType: (type: string) => MockLeaf[];
		getActiveFile: () => TFile | null;
	};
	vault: {
		getAbstractFileByPath: (path: string) => TFolder | null;
		getRoot: () => TFolder;
	};
}

type TestTFileConstructor = new (name: string, path: string) => TFile;
type TestTFolderConstructor = new (name: string, path: string) => TFolder;

const createTestFile = (name: string, path: string): TFile =>
	new (TFile as unknown as TestTFileConstructor)(name, path);

const createTestFolder = (name: string, path: string): TFolder =>
	new (TFolder as unknown as TestTFolderConstructor)(name, path);

describe('ImmersiveChapterListView context', () => {
	let rootFolder: TFolder;
	let novelFolder: TFolder;
	let notesFolder: TFolder;
	let currentFile: TFile;
	let mainLeaf: MockLeaf;
	let app: MockApp;
	let plugin: ImmersiveChapterListViewPlugin;
	let view: ImmersiveChapterListView;

	afterEach(() => vi.unstubAllGlobals());

	beforeEach(() => {
		vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
		findBookRootMock.mockReset();
		rootFolder = createTestFolder('', '/');
		novelFolder = createTestFolder('Alpha', 'Novels/Alpha');
		notesFolder = createTestFolder('Notes', 'Notes');
		currentFile = createTestFile('scratch.md', 'Notes/scratch.md');
		Object.assign(currentFile, { parent: notesFolder });

		app = {
			workspace: {
				iterateAllLeaves: callback => callback(mainLeaf),
				getLeavesOfType: type => type === 'webnovel-workbench'
					? [{
						app,
						containerEl: { classList: { contains: () => false } },
						view: { getViewType: () => 'webnovel-workbench', file: null, currentBookPath: 'Novels/Alpha' }
					} as MockLeaf]
					: [],
				getActiveFile: () => currentFile
			},
			vault: {
				getAbstractFileByPath: path => path === novelFolder.path ? novelFolder : null,
				getRoot: () => rootFolder
			}
		};

		mainLeaf = {
			app,
			containerEl: { classList: { contains: className => className === 'immersive-main-editor' } },
			view: { getViewType: () => 'markdown', file: currentFile }
		};

		const viewLeaf = {
			app,
			containerEl: { classList: { contains: () => false } },
			view: { getViewType: () => 'empty', file: null }
		};
		plugin = { app } as unknown as ImmersiveChapterListViewPlugin;
		view = new ImmersiveChapterListView(
			viewLeaf as unknown as ConstructorParameters<typeof ImmersiveChapterListView>[0],
			plugin
		);
	});

	it('uses the strict novel root for a novel file', () => {
		findBookRootMock.mockReturnValue('Novels/Alpha');

		expect(view['resolveListContext']()).toEqual({
			folder: novelFolder,
			folderPath: 'Novels/Alpha'
		});
		expect(findBookRootMock).toHaveBeenCalledWith(app, expect.anything(), currentFile, true);
	});

	it('uses the current file folder instead of a stale workbench novel', () => {
		findBookRootMock.mockReturnValue('');

		expect(view['resolveListContext']()).toEqual({
			folder: notesFolder,
			folderPath: 'Notes'
		});
	});

	it('does not fall back to another novel while the main editor file is unavailable', () => {
		mainLeaf.view.file = null;

		expect(view['resolveListContext']()).toBeNull();
		expect(findBookRootMock).not.toHaveBeenCalled();
	});

	it('highlights the main editor file and reference file independently', () => {
		const referenceFile = createTestFile('reference.md', 'Notes/reference.md');
		const referenceLeaf: MockLeaf = {
			app,
			containerEl: { classList: { contains: className => className === 'immersive-reference-view' } },
			view: { getViewType: () => 'markdown', file: referenceFile }
		};
		app.workspace.iterateAllLeaves = callback => {
			callback(mainLeaf);
			callback(referenceLeaf);
		};

		const createItem = (path: string) => ({
			dataset: { path },
			addClass: vi.fn(),
			removeClass: vi.fn()
		});
		const mainItem = createItem(currentFile.path);
		const referenceItem = createItem(referenceFile.path);
		const unrelatedItem = createItem('Notes/other.md');
		Object.assign(view, {
			containerEl: {
				querySelectorAll: vi.fn().mockReturnValue([mainItem, referenceItem, unrelatedItem])
			}
		});

		view['updateActiveHighlight']();

		expect(mainItem.addClass).toHaveBeenCalledWith('is-active');
		expect(mainItem.removeClass).toHaveBeenCalledWith('is-reference-open');
		expect(referenceItem.addClass).toHaveBeenCalledWith('is-reference-open');
		expect(referenceItem.removeClass).toHaveBeenCalledWith('is-active');
		expect(unrelatedItem.removeClass).toHaveBeenCalledWith('is-active');
		expect(unrelatedItem.removeClass).toHaveBeenCalledWith('is-reference-open');
	});

	it('collects markdown files recursively from the current non-novel folder', async () => {
		findBookRootMock.mockReturnValue('');
		const directFile = createTestFile('direct.md', 'Notes/direct.md');
		const subFolder = createTestFolder('Sub', 'Notes/Sub');
		const nestedFile = createTestFile('nested.md', 'Notes/Sub/nested.md');
		Object.assign(directFile, { parent: notesFolder });
		Object.assign(subFolder, { parent: notesFolder, children: [nestedFile] });
		Object.assign(nestedFile, { parent: subFolder });
		Object.assign(notesFolder, { children: [directFile, subFolder] });

		const buildChapterForeshadowingMap = vi.fn().mockResolvedValue(new Map());
		Object.assign(plugin, {
			foreshadowingManager: { buildChapterForeshadowingMap }
		});

		const listContainer = {
			scrollTop: 0,
			addEventListener: vi.fn(),
			createEl: vi.fn()
		};
		Object.assign(view, {
			containerEl: {
				empty: vi.fn(),
				createDiv: vi.fn().mockReturnValue(listContainer)
			}
		});
		vi.stubGlobal('window', {
			setTimeout: vi.fn(),
			requestAnimationFrame: (callback: () => void) => callback()
		});

		const renderFolderRecursively = vi.spyOn(
			view as unknown as {
				renderFolderRecursively: (...args: unknown[]) => void;
			},
			'renderFolderRecursively'
		).mockImplementation(() => {});

		await view.refresh();

		expect(buildChapterForeshadowingMap).toHaveBeenCalledWith(
			'Notes',
			[directFile, nestedFile],
			app.vault
		);
		expect(renderFolderRecursively).toHaveBeenCalledWith(
			notesFolder,
			listContainer,
			expect.any(Map),
			currentFile,
			null,
			expect.any(Object),
			'Notes'
		);
	});

	describe('lifecycle, retry timer & scroll RAF tracking', () => {
		it('cancels pending retry timer on owner window when closed', async () => {
			mainLeaf.view.file = null; // context will be null

			const mockOwnerWin = {
				setTimeout: vi.fn().mockReturnValue(999),
				clearTimeout: vi.fn(),
				requestAnimationFrame: vi.fn(),
				cancelAnimationFrame: vi.fn()
			};
			const listContainer = {
				scrollTop: 0,
				addEventListener: vi.fn(),
				createEl: vi.fn()
			};
			Object.assign(view, {
				containerEl: {
					empty: vi.fn(),
					createDiv: vi.fn().mockReturnValue(listContainer),
					ownerDocument: { defaultView: mockOwnerWin }
				}
			});

			await view.refresh();

			expect(mockOwnerWin.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

			await view.onClose();

			expect(mockOwnerWin.clearTimeout).toHaveBeenCalledWith(999);
		});

		it('cancels pending scroll RAF on owner window when closed', async () => {
			findBookRootMock.mockReturnValue('Novels/Alpha');
			plugin.settings = { enableSmartChapterSort: false } as ImmersiveChapterListViewPlugin['settings'];
			const mockOwnerWin = {
				setTimeout: vi.fn(),
				clearTimeout: vi.fn(),
				requestAnimationFrame: vi.fn().mockReturnValue(888),
				cancelAnimationFrame: vi.fn()
			};
			const listContainer = {
				scrollTop: 0,
				addEventListener: vi.fn(),
				createEl: vi.fn()
			};
			Object.assign(view, {
				containerEl: {
					empty: vi.fn(),
					createDiv: vi.fn().mockReturnValue(listContainer),
					ownerDocument: { defaultView: mockOwnerWin }
				}
			});

			await view.refresh();

			expect(mockOwnerWin.requestAnimationFrame).toHaveBeenCalled();

			await view.onClose();

			expect(mockOwnerWin.cancelAnimationFrame).toHaveBeenCalledWith(888);
		});

		it('discards delayed foreshadowing map result if closed before completion', async () => {
			findBookRootMock.mockReturnValue('Novels/Alpha');
			let resolveMap!: (map: Map<string, ParsedForeshadowingEntry[]>) => void;
			const mapPromise = new Promise<Map<string, ParsedForeshadowingEntry[]>>(res => { resolveMap = res; });

			const buildChapterForeshadowingMap = vi.fn().mockReturnValue(mapPromise);
			Object.assign(plugin, {
				foreshadowingManager: { buildChapterForeshadowingMap }
			});

			const mockOwnerWin = {
				setTimeout: vi.fn(),
				clearTimeout: vi.fn(),
				requestAnimationFrame: vi.fn(),
				cancelAnimationFrame: vi.fn()
			};
			const listContainer = {
				scrollTop: 0,
				addEventListener: vi.fn(),
				createEl: vi.fn()
			};
			Object.assign(view, {
				containerEl: {
					empty: vi.fn(),
					createDiv: vi.fn().mockReturnValue(listContainer),
					ownerDocument: { defaultView: mockOwnerWin }
				}
			});

			const renderSpy = vi.spyOn(view as unknown as { renderFolderRecursively: (...args: unknown[]) => void }, 'renderFolderRecursively').mockImplementation(() => {});

			const refreshPromise = view.refresh();

			// Close view while map is in flight
			await view.onClose();

			// Now resolve map
			resolveMap(new Map());
			await refreshPromise;

			// Must not render or schedule frame
			expect(renderSpy).not.toHaveBeenCalled();
			expect(mockOwnerWin.requestAnimationFrame).not.toHaveBeenCalled();
		});

		it('discards delayed older refresh when a newer refresh completes first', async () => {
			findBookRootMock.mockReturnValue('Novels/Alpha');
			let resolveFirstMap!: (map: Map<string, ParsedForeshadowingEntry[]>) => void;
			const firstMapPromise = new Promise<Map<string, ParsedForeshadowingEntry[]>>(res => { resolveFirstMap = res; });

			const buildChapterForeshadowingMap = vi.fn()
				.mockReturnValueOnce(firstMapPromise)
				.mockResolvedValueOnce(new Map());

			Object.assign(plugin, {
				foreshadowingManager: { buildChapterForeshadowingMap }
			});

			const mockOwnerWin = {
				setTimeout: vi.fn(),
				clearTimeout: vi.fn(),
				requestAnimationFrame: vi.fn(),
				cancelAnimationFrame: vi.fn()
			};
			const listContainer = {
				scrollTop: 0,
				addEventListener: vi.fn(),
				createEl: vi.fn()
			};
			Object.assign(view, {
				containerEl: {
					empty: vi.fn(),
					createDiv: vi.fn().mockReturnValue(listContainer),
					ownerDocument: { defaultView: mockOwnerWin }
				}
			});

			const renderSpy = vi.spyOn(view as unknown as { renderFolderRecursively: (...args: unknown[]) => void }, 'renderFolderRecursively').mockImplementation(() => {});

			const firstRefresh = view.refresh();

			// Second refresh starts and finishes
			await view.refresh();
			expect(renderSpy).toHaveBeenCalledTimes(1);

			// First refresh resolves later
			resolveFirstMap(new Map());
			await firstRefresh;

			// renderFolderRecursively must NOT have been called a second time by the older refresh
			expect(renderSpy).toHaveBeenCalledTimes(1);
		});
	});
	it('ignores a cancelled retry callback without losing the newer retry handle', async () => {
		mainLeaf.view.file = null;
		const callbacks: Array<() => void> = [];
		const ownerWindow = {
			setTimeout: vi.fn((callback: () => void) => { callbacks.push(callback); return callbacks.length; }),
			clearTimeout: vi.fn(),
			requestAnimationFrame: vi.fn(),
			cancelAnimationFrame: vi.fn()
		};
		Object.assign(view, { containerEl: {
			empty: vi.fn(), createDiv: () => ({ addEventListener: vi.fn(), createEl: vi.fn() }),
			ownerDocument: { defaultView: ownerWindow }
		} });
		await view.refresh();
		await view.refresh();
		expect(callbacks).toHaveLength(2);
		callbacks[0]();
		await view.onClose();
		expect(ownerWindow.clearTimeout.mock.calls.map(([id]) => id)).toEqual([1, 2]);
	});

});
