import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoreOverviewView, LORE_OVERVIEW_VIEW_TYPE } from '../src/ui/LoreOverviewView';
import { VIEW_TYPES } from '../src/constants';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { LoreBoardRenderer } from '../src/ui/components/LoreBoardRenderer';

const { getCurrentBookContextMock, findBookRootMock } = vi.hoisted(() => ({
	getCurrentBookContextMock: vi.fn(),
	findBookRootMock: vi.fn()
}));

function createMockEl(cls = ''): any {
	const classes = new Set<string>(cls ? cls.split(/\s+/).filter(Boolean) : []);
	const el: any = {
		className: cls,
		children: [] as any[],
		textContent: '',
		classList: {
			add: (c: string) => { classes.add(c); el.className = Array.from(classes).join(' '); },
			remove: (c: string) => { classes.delete(c); el.className = Array.from(classes).join(' '); },
			contains: (c: string) => classes.has(c)
		},
		addClass: (c: string) => { classes.add(c); el.className = Array.from(classes).join(' '); },
		removeClass: (c: string) => { classes.delete(c); el.className = Array.from(classes).join(' '); },
		hasClass: (c: string) => classes.has(c),
		empty: () => { el.children = []; },
		createDiv: (opts?: any) => {
			const childCls = typeof opts === 'string' ? opts : opts?.cls || '';
			const child = createMockEl(childCls);
			if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
			el.children.push(child);
			return child;
		},
		setText: (text: string) => { el.textContent = text; },
		querySelector: (sel: string) => {
			const match = (node: any): boolean => {
				if (sel.startsWith('.')) {
					const target = sel.slice(1);
					return node.classList.contains(target);
				}
				return false;
			};
			const find = (node: any): any => {
				for (const c of node.children) {
					if (match(c)) return c;
					const nested = find(c);
					if (nested) return nested;
				}
				return null;
			};
			return find(el);
		}
	};
	return el;
}

vi.mock('obsidian', () => {
	class MockItemView {
		app: unknown;
		containerEl: any;
		contentEl: any;

		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.containerEl = createMockEl('workspace-leaf-content');
			this.contentEl = createMockEl('view-content');
			this.containerEl.children.push(this.contentEl);
		}

		registerEvent(): void {}
	}

	class MockTFile {
		extension = 'md';
		basename: string;
		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	return {
		ItemView: MockItemView,
		TFile: MockTFile
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
	let plugin: WebNovelAssistantPlugin;
	let mockApp: any;
	let mockLeaf: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockApp = {
			vault: {
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

		plugin = {
			app: mockApp,
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((key: string, fn: () => void) => { fn(); })
			},
			characterManager: {
				ensureInitialized: vi.fn().mockResolvedValue(undefined),
				getCharactersForBook: vi.fn().mockReturnValue(['Protagonist', 'Antagonist'])
			},
			homepageManager: {
				getHomepageFilePath: vi.fn().mockReturnValue(null)
			}
		} as unknown as WebNovelAssistantPlugin;
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
			['Protagonist', 'Antagonist'],
			undefined,
			expect.any(Function),
			view,
			{ hideTabs: true }
		);
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

		(LoreBoardRenderer.renderCards as any).mockClear();
		await view.setBookPath('NovelB');

		expect(plugin.characterManager.getCharactersForBook).toHaveBeenCalledWith('NovelB');
	});
});
