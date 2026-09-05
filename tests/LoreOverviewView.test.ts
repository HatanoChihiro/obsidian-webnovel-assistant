import { MockElement } from './mocks/MockElement';
import { bindFilterInputEvents } from '../src/ui/components/FilterInputBinding';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoreOverviewView, LORE_OVERVIEW_VIEW_TYPE, type LoreOverviewViewPlugin } from '../src/ui/LoreOverviewView';
import { VIEW_TYPES } from '../src/constants';
import { LoreBoardRenderer } from '../src/ui/components/LoreBoardRenderer';

const { getCurrentBookContextMock, findBookRootMock } = vi.hoisted(() => ({
	getCurrentBookContextMock: vi.fn(),
	findBookRootMock: vi.fn()
}));



// Attach global helpers expected by Obsidian runtime
(globalThis as unknown as { createDiv: (opts?: unknown) => MockElement }).createDiv = function(opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
	if (typeof opts === 'object' && opts !== null && 'text' in opts) {
		el.textContent = (opts as { text: string }).text;
	}
	return el;
};

vi.stubGlobal('window', {
	createFragment: () => {
		const frag = new MockElement('');
		frag.isFragment = true;
		return frag;
	},
	requestAnimationFrame: (cb: (time: number) => void) => {
		cb(Date.now());
		return 0;
	},
	setTimeout: globalThis.setTimeout,
	clearTimeout: globalThis.clearTimeout
});

const { mockComponentInstances, MockComponent } = vi.hoisted(() => {
	const instances: HoistedMockComponent[] = [];
	class HoistedMockComponent {
		load = vi.fn();
		unload = vi.fn();
		register = vi.fn();
		registerEvent = vi.fn();
		constructor() {
			instances.push(this);
		}
	}
	return { mockComponentInstances: instances, MockComponent: HoistedMockComponent };
});

vi.mock('obsidian', () => {
	class MockItemView {
		app: unknown;
		containerEl: MockElement;
		contentEl: MockElement;

		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.containerEl = new MockElement('workspace-leaf-content');
			this.contentEl = new MockElement('view-content');
			this.containerEl.children.push(this.contentEl);
			this.contentEl.parentElement = this.containerEl;
		}

		registerEvent(): void {}
	}

	class MockTFile {
		extension = 'md';
		basename: string;
		stat = { mtime: 1 };
		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	return {
		Component: MockComponent,
		ItemView: MockItemView,
		TFile: MockTFile,
		setIcon: vi.fn()
	};
});

vi.mock('../src/utils/path', () => ({
	getCurrentBookContext: getCurrentBookContextMock,
	findBookRoot: findBookRootMock
}));

vi.mock('../src/ui/components/LoreBoardRenderer', () => ({
	LoreBoardRenderer: {
		renderCards: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

describe('LoreOverviewView', () => {
	let plugin: LoreOverviewViewPlugin;
	let mockApp: any;
	let mockLeaf: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockApp = {
			vault: {
				on: vi.fn(),
				cachedRead: vi.fn().mockResolvedValue('## 林默\n调查地下室。\n## 苏晴\n报社记者。')
			},
			metadataCache: {
				on: vi.fn()
			},
			workspace: {
				on: vi.fn(),
				getActiveFile: vi.fn().mockReturnValue(null)
			}
		};

		mockLeaf = {
			app: mockApp
		};

		const loreFile = { name: '人物.md', path: 'NovelA/设定/人物.md', basename: '人物', extension: 'md', stat: { mtime: 1 } };

		plugin = {
			app: mockApp,
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((key: string, fn: () => void) => { fn(); }),
				cancel: vi.fn()
			},
			characterManager: {
				ensureInitialized: vi.fn().mockResolvedValue(undefined),
				getCharactersForBook: vi.fn().mockReturnValue(['林默', '阿默', '苏晴']),
				getCharacterFile: vi.fn((bookPath: string, name: string) => {
					if (name === '林默' || name === '阿默') {
						return { file: loreFile, heading: '林默' };
					}
					if (name === '苏晴') {
						return { file: loreFile, heading: '苏晴' };
					}
					return null;
				}),
				getLoreEntriesInFileOrder: vi.fn().mockReturnValue([
					{ file: loreFile, heading: '林默' },
					{ file: loreFile, heading: '苏晴' }
				])
			},
			homepageManager: {
				getHomepageFilePath: vi.fn().mockReturnValue(null)
			}
		} as unknown as LoreOverviewViewPlugin;
	});

	it('should return correct view type, display text, and icon', () => {
		const view = new LoreOverviewView(mockLeaf, plugin);
		expect(view.getViewType()).toBe(VIEW_TYPES.LORE_OVERVIEW);
		expect(view.getViewType()).toBe(LORE_OVERVIEW_VIEW_TYPE);
		expect(view.getDisplayText()).toBe('view.lore-overview');
		expect(view.getIcon()).toBe('book-marked');
	});

	it('should initialize container on open and call renderCards when characters exist', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);

		await view.onOpen();

		expect(view.contentEl.classList.contains('wn-lore-overview-container')).toBe(true);
		expect(view.contentEl.classList.contains('wn-corkboard-container')).toBe(true);
		expect(plugin.characterManager.ensureInitialized).toHaveBeenCalled();
		expect(plugin.characterManager.getCharactersForBook).toHaveBeenCalledWith('NovelA');
		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledWith(
			expect.anything(),
			mockApp,
			plugin,
			'NovelA',
			['林默', '阿默', '苏晴'],
			undefined,
			expect.any(Function),
			expect.any(MockComponent),
			{ hideTabs: true }
		);
	});

	it('should pass matched canonical headings when filtering by alias or body text', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockClear();

		// Set query and trigger reload
		(view as unknown as { loreFilterQuery: string }).loreFilterQuery = '阿默 地下室';
		await view.reloadBoard();

		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledWith(
			expect.anything(),
			mockApp,
			plugin,
			'NovelA',
			['林默', '阿默', '苏晴'],
			new Set(['林默']),
			expect.any(Function),
			expect.any(MockComponent),
			{ hideTabs: true }
		);
	});

	it('should correctly group aliases by canonical heading in getLoreAliases', () => {
		const view = new LoreOverviewView(mockLeaf, plugin);
		const aliases = (view as unknown as { getLoreAliases: (book: string) => Map<string, string[]> }).getLoreAliases('NovelA');

		expect(aliases.get('林默')).toEqual(['阿默']);
		expect(aliases.has('苏晴')).toBe(false);
	});

	it('should render empty message when no book context or no characters', async () => {
		getCurrentBookContextMock.mockReturnValue(null);
		const view = new LoreOverviewView(mockLeaf, plugin);

		await view.onOpen();

		expect(view.contentEl.querySelector('.wn-corkboard-empty')).not.toBeNull();
		expect(LoreBoardRenderer.renderCards).not.toHaveBeenCalled();
	});

	it('should update book path and reload when setBookPath is called', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockClear();
		await view.setBookPath('NovelB');

		expect(plugin.characterManager.getCharactersForBook).toHaveBeenCalledWith('NovelB');
	});

	it('should protect against stale async renders when newer queries arrive', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockClear();

		let resolveFirstQuery: (value: unknown) => void = () => {};
		const firstQueryPromise = new Promise(resolve => { resolveFirstQuery = resolve; });
		let markFirstQueryStarted: () => void = () => {};
		const firstQueryStarted = new Promise<void>(resolve => { markFirstQueryStarted = resolve; });

		const filterIndex = (view as unknown as { filterIndex: { filterLoreEntries: (...args: unknown[]) => Promise<unknown> } }).filterIndex;
		vi.spyOn(filterIndex, 'filterLoreEntries').mockImplementationOnce(() => {
			markFirstQueryStarted();
			return firstQueryPromise as Promise<Set<string>>;
		});

		const viewHarness = view as unknown as { loreFilterQuery: string; currentRenderId: number };
		viewHarness.loreFilterQuery = 'slow';
		const slowRenderPromise = view.reloadBoard();
		await firstQueryStarted;

		// Immediate second fast query
		viewHarness.loreFilterQuery = '林默';
		viewHarness.currentRenderId++;
		const fastRenderPromise = view.reloadBoard();

		await fastRenderPromise;
		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledTimes(1);

		// Now resolve slow query
		resolveFirstQuery(new Set(['林默']));
		await slowRenderPromise;

		// Should still have been called only once for the fast query
		expect(LoreBoardRenderer.renderCards).toHaveBeenCalledTimes(1);
	});

	it('should cancel lore-overview-refresh debounce callback on close', async () => {
		const cancelSpy = vi.fn();
		const debounceSpy = vi.fn();
		plugin.adaptiveDebounceManager = {
			debounceFixed: debounceSpy,
			cancel: cancelSpy
		};

		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onClose();
		expect(cancelSpy).toHaveBeenCalledWith('lore-overview-refresh');
	});

	it('unloads prior render component on new successful render generation', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);

		mockComponentInstances.length = 0;
		await view.onOpen();

		expect(mockComponentInstances.length).toBe(1);
		const firstComponent = mockComponentInstances[0];
		expect(firstComponent.load).toHaveBeenCalled();
		expect(firstComponent.unload).not.toHaveBeenCalled();

		await view.reloadBoard();

		expect(mockComponentInstances.length).toBe(2);
		const secondComponent = mockComponentInstances[1];
		expect(secondComponent.load).toHaveBeenCalled();
		expect(firstComponent.unload).toHaveBeenCalledTimes(1);
		expect(secondComponent.unload).not.toHaveBeenCalled();
	});

	it('unloads stale render component immediately and keeps displayed generation alive', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		mockComponentInstances.length = 0;

		let finishFirstRender: () => void = () => {};
		let markFirstRenderStarted: () => void = () => {};
		const firstRenderStarted = new Promise<void>(resolve => { markFirstRenderStarted = resolve; });
		const renderGate = new Promise<void>(resolve => { finishFirstRender = resolve; });

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
			markFirstRenderStarted();
			await renderGate;
		});

		const slowRenderPromise = view.reloadBoard();
		await firstRenderStarted;

		const slowComponent = mockComponentInstances[0];
		expect(slowComponent).toBeDefined();

		// Start and finish a fast render that bumps renderId
		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
		await view.reloadBoard();
		const fastComponent = mockComponentInstances[1];
		expect(fastComponent.load).toHaveBeenCalled();
		expect(fastComponent.unload).not.toHaveBeenCalled();

		// Resolve slow render -> should detect stale and unload slowComponent
		finishFirstRender();
		await slowRenderPromise;

		expect(slowComponent.unload).toHaveBeenCalledTimes(1);
		// fastComponent must still be alive as displayed
		expect(fastComponent.unload).not.toHaveBeenCalled();
	});

	it('unloads displayed component and in-flight component on close', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		await view.onOpen();

		const displayedComponent = mockComponentInstances[mockComponentInstances.length - 1];

		let finishInFlight: () => void = () => {};
		let markInFlightStarted: () => void = () => {};
		const inFlightStarted = new Promise<void>(resolve => { markInFlightStarted = resolve; });
		const inFlightGate = new Promise<void>(resolve => { finishInFlight = resolve; });
		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
			markInFlightStarted();
			await inFlightGate;
		});

		const inFlightPromise = view.reloadBoard();
		await inFlightStarted;
		const inFlightComponent = mockComponentInstances[mockComponentInstances.length - 1];

		// Close while render is in flight
		await view.onClose();
		expect(displayedComponent.unload).toHaveBeenCalled();

		finishInFlight();
		await inFlightPromise;

		expect(inFlightComponent.unload).toHaveBeenCalled();
	});

	it('unloads render component on render failure and rethrows', async () => {
		getCurrentBookContextMock.mockReturnValue('NovelA');
		const view = new LoreOverviewView(mockLeaf, plugin);
		mockComponentInstances.length = 0;

		(LoreBoardRenderer.renderCards as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Render error'));

		await expect(view.onOpen()).rejects.toThrow('Render error');

		expect(mockComponentInstances.length).toBe(1);
		const failedComponent = mockComponentInstances[0];
		expect(failedComponent.load).toHaveBeenCalled();
		expect(failedComponent.unload).toHaveBeenCalled();
	});
});


describe('shared filter input events', () => {
    it('preserves IME text until composition ends and supports keyboard clearing', () => {
        const input = new MockElement();
        const wrapper = new MockElement();
        const clear = new MockElement();
        const refresh = vi.fn();
        const compositionStart = vi.fn();
        bindFilterInputEvents({
            input: input as unknown as HTMLInputElement,
            inputWrapper: wrapper as unknown as HTMLElement,
            clearButton: clear as unknown as HTMLElement,
            onCompositionStart: compositionStart,
            onRefresh: refresh
        });
        input.dispatchEvent('compositionstart');
        input.value = '主角';
        input.dispatchEvent('input', { isComposing: true });
        input.dispatchEvent('keydown', { key: 'Escape', preventDefault: vi.fn() });
        expect(compositionStart).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
        expect(input.value).toBe('主角');
        input.dispatchEvent('compositionend');
        expect(refresh).toHaveBeenLastCalledWith(false);
        expect(clear.hasClass('is-visible')).toBe(true);
        clear.dispatchEvent('keydown', { key: 'Enter', preventDefault: vi.fn() });
        expect(input.value).toBe('');
        expect(refresh).toHaveBeenLastCalledWith(true);
        expect(clear.getAttribute('aria-hidden')).toBe('true');
    });
});
