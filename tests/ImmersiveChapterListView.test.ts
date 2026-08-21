import { beforeEach, describe, expect, it, vi } from 'vitest';
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

	beforeEach(() => {
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
			expect.any(Object),
			'Notes'
		);
	});
});
