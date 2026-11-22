import type { ParsedForeshadowingEntry } from '../src/types/foreshadowing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { ImmersiveChapterListView, type ImmersiveChapterListViewPlugin } from '../src/ui/ImmersiveChapterListView';
import { MockElement } from './mocks/MockElement';

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
		Vault: MockVault,
		Platform: { isMobile: false }
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
		on: (name: string, callback: (...args: unknown[]) => void) => { name: string };
		trigger: (name: string, ...args: unknown[]) => void;
	};
	vault: {
		getAbstractFileByPath: (path: string) => TFolder | null;
		getRoot: () => TFolder;
		on: (name: string, callback: (...args: unknown[]) => void) => { name: string };
	};
	metadataCache: {
		getFileCache: (file: TFile) => unknown;
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

		const workspaceHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
		const vaultHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

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
				getActiveFile: () => currentFile,
				on: (name: string, callback: (...args: unknown[]) => void) => {
					const list = workspaceHandlers.get(name) || [];
					list.push(callback);
					workspaceHandlers.set(name, list);
					return { name };
				},
				trigger: (name: string, ...args: unknown[]) => {
					const list = workspaceHandlers.get(name) || [];
					for (const cb of list) cb(...args);
				}
			},
			vault: {
				getAbstractFileByPath: path => path === novelFolder.path ? novelFolder : null,
				getRoot: () => rootFolder,
				on: (name: string, callback: (...args: unknown[]) => void) => {
					const list = vaultHandlers.get(name) || [];
					list.push(callback);
					vaultHandlers.set(name, list);
					return { name };
				}
			},
			metadataCache: {
				getFileCache: () => null
			}
		};

		mainLeaf = {
			app,
			containerEl: { classList: { contains: className => className === 'wn-immersive-main-editor' } },
			view: { getViewType: () => 'markdown', file: currentFile }
		};

		const viewLeaf = {
			app,
			containerEl: { classList: { contains: () => false } },
			view: { getViewType: () => 'empty', file: null }
		};
		plugin = {
			app,
			settings: {
				enableSmartChapterSort: false,
				showExplorerCounts: true,
				customSortOrder: {}
			},
			cacheManager: {
				getFileCache: vi.fn().mockReturnValue(1000),
				isEligibleForWordCount: vi.fn().mockReturnValue(true)
			},
			saveSettings: vi.fn().mockResolvedValue(undefined)
		} as unknown as ImmersiveChapterListViewPlugin;
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
			containerEl: { classList: { contains: className => className === 'wn-immersive-reference-view' } },
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
		it('positions the initial chapter immediately and preserves it across an immediate refresh', async () => {
			findBookRootMock.mockReturnValue('Novels/Alpha');
			const frames: Array<() => void> = [];
			const ownerWindow = {
				requestAnimationFrame: vi.fn((callback: () => void) => { frames.push(callback); return frames.length; }),
				cancelAnimationFrame: vi.fn()
			};
			let list = { scrollTop: 0, clientHeight: 400, addEventListener: vi.fn() };
			const activeItem = {
				scrollIntoView: vi.fn((options: ScrollIntoViewOptions) => {
					if (options.behavior === 'instant') list.scrollTop = 1800;
				})
			};
			Object.assign(view, { containerEl: {
				empty: vi.fn(),
				createDiv: () => (list = { scrollTop: 0, clientHeight: 400, addEventListener: vi.fn() }),
				querySelector: (selector: string) => selector === '.wn-immersive-chapter-list' ? list : activeItem,
				ownerDocument: { defaultView: ownerWindow }
			} });
			vi.spyOn(view as unknown as {
				renderFolderRecursively: (...args: unknown[]) => void;
			}, 'renderFolderRecursively').mockImplementation((...args) => {
				Object.assign(args[5] as object, { activeItemEl: activeItem });
			});

			await view.refresh();
			frames.shift()?.();
			expect(list.scrollTop).toBe(1800);
			expect(activeItem.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });

			// No scroll event has fired before the next render replaces the list.
			const oldList = list;
			const oldScrollHandler = oldList.addEventListener.mock.calls.find(([name]) => name === 'scroll')?.[1];
			await view.refresh();
			// The detached list may deliver its queued scroll event after its scrollTop resets.
			oldList.scrollTop = 0;
			(oldScrollHandler as (() => void) | undefined)?.();
			frames.shift()?.();
			expect(list.scrollTop).toBe(1800);
			expect(activeItem.scrollIntoView).toHaveBeenCalledTimes(1);

			list.scrollTop = 900;
			const scrollHandler = list.addEventListener.mock.calls.find(([name]) => name === 'scroll')?.[1];
			(scrollHandler as (() => void) | undefined)?.();
			await view.refresh();
			frames.shift()?.();
			expect(list.scrollTop).toBe(900);
		});

		it('defers initial positioning until the list has a visible viewport and does not reposition on later resizes', async () => {
			findBookRootMock.mockReturnValue('Novels/Alpha');
			const frames: Array<() => void> = [];
			const list = { scrollTop: 0, clientHeight: 0, addEventListener: vi.fn() };
			const activeItem = { scrollIntoView: vi.fn(() => { list.scrollTop = 1800; }) };
			Object.assign(view, { containerEl: {
				empty: vi.fn(), createDiv: () => list,
				querySelector: (selector: string) => selector === '.wn-immersive-chapter-list' ? list
					: selector === '.wn-immersive-chapter-item.is-active' ? activeItem : null,
				ownerDocument: { defaultView: {
					requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
					cancelAnimationFrame: vi.fn()
				} }
			} });
			vi.spyOn(view as unknown as {
				renderFolderRecursively: (...args: unknown[]) => void;
			}, 'renderFolderRecursively').mockImplementation((...args) => {
				Object.assign(args[5] as object, { activeItemEl: activeItem });
			});

			await view.refresh();
			frames.shift()?.();
			expect(activeItem.scrollIntoView).not.toHaveBeenCalled();
			expect(view['isInitialLoad']).toBe(true);

			list.clientHeight = 400;
			view.onResize();
			expect(list.scrollTop).toBe(1800);
			expect(view['isInitialLoad']).toBe(false);
			list.scrollTop = 900;
			view.onResize();
			expect(list.scrollTop).toBe(900);
			expect(activeItem.scrollIntoView).toHaveBeenCalledTimes(1);
		});

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

	describe('incremental word count update via webnovel:file-word-count-updated', () => {
		interface MockCountEl {
			textContent: string;
			setText: ReturnType<typeof vi.fn>;
			addClass: ReturnType<typeof vi.fn>;
			removeClass: ReturnType<typeof vi.fn>;
		}

		const createMockCountEl = (initialText = ''): MockCountEl => {
			const el: MockCountEl = {
				textContent: initialText,
				setText: vi.fn((text: string) => {
					el.textContent = text;
					return el;
				}),
				addClass: vi.fn(),
				removeClass: vi.fn()
			};
			return el;
		};

		it('registers webnovel:file-word-count-updated on open and updates matching rendered item word count', async () => {
			const originalCreateDiv = MockElement.prototype.createDiv;
			const createDivSpy = vi.spyOn(MockElement.prototype, 'createDiv').mockImplementation(function (this: MockElement, opts) {
				return Object.assign(originalCreateDiv.call(this, opts), { dataset: {} });
			});
			try {
				findBookRootMock.mockReturnValue('Novels/Alpha');
				const file1 = createTestFile('same.md', 'Novels/Alpha/a[1]/same.md');
				const file2 = createTestFile('same.md', 'Novels/Alpha/b/same.md');
				Object.assign(novelFolder, { children: [file1, file2] });
				const container = new MockElement();
				Object.assign(view, { containerEl: container });
				await view.onOpen();
				const [countEl1, countEl2] = container.querySelectorAll('.wn-immersive-chapter-count');
				expect(countEl1.textContent).toBe('1000common.word-char');
				expect(countEl2.textContent).toBe('1000common.word-char');
				const refreshSpy = vi.spyOn(view, 'refresh');
				app.workspace.trigger('webnovel:file-word-count-updated', file1, 1500);
				expect(countEl1.textContent).toBe('1500common.word-char');
				expect(countEl2.textContent).toBe('1000common.word-char');
				expect(container.querySelectorAll('.wn-immersive-chapter-count')[0]).toBe(countEl1);
				expect(refreshSpy).not.toHaveBeenCalled();
				await view.refresh();
				app.workspace.trigger('webnovel:file-word-count-updated', file1, 1200);
				expect(countEl1.textContent).toBe('1500common.word-char');
				expect(container.querySelectorAll('.wn-immersive-chapter-count')[0].textContent).toBe('1200common.word-char');
			} finally {
				createDivSpy.mockRestore();
			}
		});

		it('updates count to zero immediately when count becomes 0', async () => {
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

			await view.onOpen();

			const file1 = createTestFile('chapter1.md', 'Novels/Alpha/chapter1.md');
			const countEl1 = createMockCountEl('1000common.word-char');

			const internalView = view as unknown as { renderedCountEls: Map<string, MockCountEl> };
			internalView.renderedCountEls.set(file1.path, countEl1);

			app.workspace.trigger('webnovel:file-word-count-updated', file1, 0);

			expect(countEl1.setText).toHaveBeenCalledWith('0common.word-char');
			expect(countEl1.removeClass).toHaveBeenCalledWith('is-excluded');
		});

		it('applies is-excluded when file is not eligible for word count', async () => {
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

			await view.onOpen();

			const file1 = createTestFile('chapter1.md', 'Novels/Alpha/chapter1.md');
			const countEl1 = createMockCountEl('1000common.word-char');

			plugin.cacheManager.isEligibleForWordCount = vi.fn().mockReturnValue(false);

			const internalView = view as unknown as { renderedCountEls: Map<string, MockCountEl> };
			internalView.renderedCountEls.set(file1.path, countEl1);

			app.workspace.trigger('webnovel:file-word-count-updated', file1, 500);

			expect(countEl1.setText).toHaveBeenCalledWith('corkboard.wordcount-excluded');
			expect(countEl1.addClass).toHaveBeenCalledWith('is-excluded');
		});

		it('does not trigger full refresh or mutate unrelated files', async () => {
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

			await view.onOpen();

			const file1 = createTestFile('chapter1.md', 'Novels/Alpha/chapter1.md');
			const countEl1 = createMockCountEl('1000common.word-char');

			const internalView = view as unknown as { renderedCountEls: Map<string, MockCountEl> };
			internalView.renderedCountEls.set(file1.path, countEl1);

			const refreshSpy = vi.spyOn(view, 'refresh');
			const unrelatedFile = createTestFile('other.md', 'Novels/Other/other.md');

			app.workspace.trigger('webnovel:file-word-count-updated', unrelatedFile, 800);

			expect(refreshSpy).not.toHaveBeenCalled();
			expect(countEl1.setText).not.toHaveBeenCalled();
		});

		it('ignores count events after view is closed and clears rendered element references', async () => {
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

			await view.onOpen();

			const file1 = createTestFile('chapter1.md', 'Novels/Alpha/chapter1.md');
			const countEl1 = createMockCountEl('1000common.word-char');

			const internalView = view as unknown as { renderedCountEls: Map<string, MockCountEl> };
			internalView.renderedCountEls.set(file1.path, countEl1);

			await view.onClose();

			expect(internalView.renderedCountEls.size).toBe(0);

			app.workspace.trigger('webnovel:file-word-count-updated', file1, 2000);

			expect(countEl1.setText).not.toHaveBeenCalled();
		});
	});

	describe('Manuscript mode filtering and navigation', () => {
		it('filters out non-chapter docs/empty folders and navigates via immersiveModeManager when manuscriptModeEnabled is true, while keeping right-click reference behavior', async () => {
			const originalCreateDiv = MockElement.prototype.createDiv;
			const createDivSpy = vi.spyOn(MockElement.prototype, 'createDiv').mockImplementation(function (this: MockElement, opts) {
				return Object.assign(originalCreateDiv.call(this, opts), { dataset: {} });
			});
			try {
				findBookRootMock.mockReturnValue('Novels/Alpha');
				const ch1 = createTestFile('第1章 启程.md', 'Novels/Alpha/第1章 启程.md');
				const outline = createTestFile('大纲.md', 'Novels/Alpha/大纲.md');
				const loreFolder = createTestFolder('设定', 'Novels/Alpha/设定');
				const loreDoc = createTestFile('主角.md', 'Novels/Alpha/设定/主角.md');
				Object.assign(loreDoc, { parent: loreFolder });
				Object.assign(loreFolder, { parent: novelFolder, children: [loreDoc] });
				Object.assign(ch1, { parent: novelFolder });
				Object.assign(outline, { parent: novelFolder });
				Object.assign(novelFolder, { children: [ch1, outline, loreFolder] });
				mainLeaf.view.file = ch1;

				const navigateManuscriptChapter = vi.fn().mockResolvedValue(undefined);
				const openReferenceFile = vi.fn().mockResolvedValue(undefined);
				Object.assign(plugin.settings, {
					immersive: { manuscriptModeEnabled: true }
				});
				Object.assign(plugin, {
					immersiveManuscriptManager: {
						isEligibleManuscriptChapter: (f: TFile) => f === ch1
					},
					immersiveModeManager: {
						isManuscriptModeActive: () => true,
						navigateManuscriptChapter,
						openReferenceFile,
						registerImmersiveLeaf: vi.fn()
					}
				});

				const container = new MockElement();
				Object.assign(view, { containerEl: container });
				await view.refresh();

				const items = container.querySelectorAll('.wn-immersive-chapter-item') as Array<MockElement & { dataset?: Record<string, string> }>;
				expect(items).toHaveLength(1);
				expect(items[0].dataset?.path).toBe(ch1.path);
				// Empty non-chapter folder (设定) should not be rendered
				expect(container.querySelectorAll('.wn-immersive-folder-details')).toHaveLength(0);

				items[0].dispatchEvent('click', { preventDefault: vi.fn() });
				expect(navigateManuscriptChapter).toHaveBeenCalledWith(ch1);

				const refLeaf = {
					app,
					containerEl: { classList: { contains: (c: string) => c === 'wn-immersive-reference-view', add: vi.fn() } },
					view: { getViewType: () => 'markdown', file: null }
				};
				app.workspace.iterateAllLeaves = cb => {
					cb(mainLeaf);
					cb(refLeaf);
				};
				items[0].dispatchEvent('contextmenu', { preventDefault: vi.fn() });
				expect(openReferenceFile).toHaveBeenCalledWith(ch1, refLeaf);
			} finally {
				createDivSpy.mockRestore();
			}
		});
	});

	describe('Mobile immersive chapter directory restrictions', () => {
		it('disables reference selection on contextmenu on mobile without mutating desktop slots or splitting leaves', async () => {
			const { Platform } = await import('obsidian');
			const originalCreateDiv = MockElement.prototype.createDiv;
			const createDivSpy = vi.spyOn(MockElement.prototype, 'createDiv').mockImplementation(function (this: MockElement, opts) {
				return Object.assign(originalCreateDiv.call(this, opts), { dataset: {} });
			});
			const originalIsMobile = Platform.isMobile;
			Platform.isMobile = true;
			try {
				findBookRootMock.mockReturnValue('Novels/Alpha');
				const ch1 = createTestFile('Chapter1.md', 'Novels/Alpha/Chapter1.md');
				const ch2 = createTestFile('Chapter2.md', 'Novels/Alpha/Chapter2.md');
				Object.assign(ch1, { parent: novelFolder });
				Object.assign(ch2, { parent: novelFolder });
				Object.assign(novelFolder, { children: [ch1, ch2] });
				mainLeaf.view.file = ch1;

				const openFile = vi.fn().mockResolvedValue(undefined);
				Object.assign(mainLeaf, { openFile });

				const createLeafBySplit = vi.fn();
				Object.assign(app.workspace, { createLeafBySplit });

				const openReferenceFile = vi.fn().mockResolvedValue(undefined);
				const onMobileDirectoryChapterSelected = vi.fn();
				const desktopRightSlots: string[] = [];
				Object.assign(plugin.settings, {
					immersive: { immersiveRightSlots: desktopRightSlots }
				});
				Object.assign(plugin, {
					immersiveModeManager: {
						isMobileImmersiveSessionActive: () => true,
						getActiveSessionMainLeaf: () => mainLeaf,
						openReferenceFile,
						registerImmersiveLeaf: vi.fn(),
						onMobileDirectoryChapterSelected
					}
				});

				const container = new MockElement();
				Object.assign(view, { containerEl: container });
				await view.refresh();

				const items = container.querySelectorAll('.wn-immersive-chapter-item') as Array<MockElement & { dataset?: Record<string, string> }>;
				expect(items).toHaveLength(2);

				// Long press / contextmenu on mobile must NOT open reference, split leaf, or mutate desktop slots
				const preventDefault = vi.fn();
				items[1].dispatchEvent('contextmenu', { preventDefault });
				expect(preventDefault).toHaveBeenCalled();
				expect(openReferenceFile).not.toHaveBeenCalled();
				expect(createLeafBySplit).not.toHaveBeenCalled();
				expect(desktopRightSlots).toEqual([]);

				// Click selects main chapter and notifies mobile directory hook
				items[1].dispatchEvent('click', { preventDefault: vi.fn() });
				expect(openFile).toHaveBeenCalledWith(ch2, { active: true });
				expect(onMobileDirectoryChapterSelected).toHaveBeenCalledTimes(1);
			} finally {
				Platform.isMobile = originalIsMobile;
				createDivSpy.mockRestore();
			}
		});
	});
});
