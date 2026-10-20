import { describe, expect, it, vi } from 'vitest';
import { AdvancedSearchModal, type AdvancedSearchModalPlugin } from '../src/ui/AdvancedSearchModal';
import { TFile } from 'obsidian';
import { smartLocateAndHighlight } from '../src/utils/leaf';
import { MockElement } from './mocks/MockElement';
import { t } from '../src/i18n';

vi.mock('../src/utils/leaf', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/utils/leaf')>();
	return {
		...actual,
		smartLocateAndHighlight: vi.fn().mockResolvedValue(true)
	};
});

describe('AdvancedSearchModal source leaf routing', () => {
	it('delegates search result jumps to smartLocateAndHighlight with the launching leaf', () => {
		const sourceFile = Object.assign(new TFile(), { basename: '参考', name: '参考.md', path: 'Novel/参考.md' });
		const targetFile = Object.assign(new TFile(), { basename: '章节', name: '章节.md', path: 'Novel/章节.md' });
		const sourceLeaf = {
			view: { file: sourceFile, getViewType: () => 'markdown' },
			active: false
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getLeaf: vi.fn()
			}
		};
		const plugin = {
			settings: { advancedSearchQuery: '', customSortOrder: {} }
		} as unknown as AdvancedSearchModalPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin, sourceLeaf as never);

		(modal as unknown as { openSearchResult: (file: TFile, snippet: unknown) => void })
			.openSearchResult(targetFile, {
				linesBefore: 7,
				highlight: '目标关键词',
				matchStart: 108,
				matchEnd: 113,
				startLoc: { line: 7, ch: 4 },
				endLoc: { line: 7, ch: 9 }
			});

		expect(smartLocateAndHighlight).toHaveBeenCalledWith(
			app,
			targetFile,
			['目标关键词'],
			{
				preferredLeaf: sourceLeaf,
				fallbackLine: 7,
				matchStartGlobal: 108,
				focusEditor: false,
				exactMatchState: {
					targetLine: 7,
					matchStartGlobal: 108,
					matchEndGlobal: 113,
					matchStartLoc: { line: 7, ch: 4 },
					matchEndLoc: { line: 7, ch: 9 },
					matchText: '目标关键词',
					contextPrefix: undefined,
					contextSuffix: undefined,
					occurrenceIndex: undefined
				}
			}
		);
	});

	it('falls back to an active Markdown leaf when the source leaf is no longer valid', () => {
		const targetFile = Object.assign(new TFile(), { basename: '章节', name: '章节.md', path: 'Novel/章节.md' });
		const fallbackLeaf = {
			view: { file: targetFile },
			active: true
		};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([fallbackLeaf]),
				getLeaf: vi.fn()
			}
		};
		const plugin = {
			settings: { advancedSearchQuery: '', customSortOrder: {} }
		} as unknown as AdvancedSearchModalPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin, {
			view: { file: null },
			openFile: vi.fn()
		} as never);

		(modal as unknown as { openSearchResult: (file: TFile, snippet: unknown) => void })
			.openSearchResult(targetFile, {
				linesBefore: 2,
				highlight: '降级关键词',
				matchStart: 25,
				matchEnd: 30,
				startLoc: { line: 2, ch: 0 },
				endLoc: { line: 2, ch: 5 },
				contextPrefix: '前文',
				contextSuffix: '后文',
				occurrenceIndex: 1
			});

		expect(smartLocateAndHighlight).toHaveBeenCalledWith(
			app,
			targetFile,
			['降级关键词'],
			{
				preferredLeaf: fallbackLeaf,
				fallbackLine: 2,
				matchStartGlobal: 25,
				focusEditor: false,
				exactMatchState: {
					targetLine: 2,
					matchStartGlobal: 25,
					matchEndGlobal: 30,
					matchStartLoc: { line: 2, ch: 0 },
					matchEndLoc: { line: 2, ch: 5 },
					matchText: '降级关键词',
					contextPrefix: '前文',
					contextSuffix: '后文',
					occurrenceIndex: 1
				}
			}
		);
	});

	it('excludes YAML frontmatter from search matches and accurately scopes to body', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		const fileContent = [
			'---',
			'title: 第一章',
			'author: 徐太太',
			'synopsis: 这是关于徐太太的简介',
			'---',
			'第一章正文。',
			'这里是徐太太在客厅说话。'
		].join('\n');

		const app = {
			vault: {
				cachedRead: vi.fn().mockResolvedValue(fileContent),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		let renderedResults: Array<{ file: TFile; snippets: Array<{ highlight: string; matchStart: number; linesBefore: number; occurrenceIndex: number }>; totalMatches: number }> = [];

		const plugin = {
			settings: { advancedSearchQuery: '徐太太', customSortOrder: {} },
			saveSettings: vi.fn(),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { query: string }).query = '徐太太';
		(modal as unknown as { resultsContainer: { empty: () => void; createDiv: () => void } }).resultsContainer = {
			empty: vi.fn(),
			createDiv: vi.fn()
		};
		(modal as unknown as { renderSearchResults: (results: typeof renderedResults) => void }).renderSearchResults = (results) => {
			renderedResults = results;
		};

		await (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		// Should only find the 1 match in the body, completely ignoring the 2 matches in YAML frontmatter
		expect(renderedResults.length).toBe(1);
		expect(renderedResults[0].totalMatches).toBe(1);
		expect(renderedResults[0].snippets.length).toBe(1);
		expect(renderedResults[0].snippets[0].highlight).toBe('徐太太');
		expect(renderedResults[0].snippets[0].linesBefore).toBe(6);
		expect(renderedResults[0].snippets[0].occurrenceIndex).toBe(0);
	});

	it('returns all snippets without 10-match truncation limit for a single file', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第二章', name: '第二章.md', path: 'Novel/第二章.md' });
		// 15 repeated lines
		const lines = Array.from({ length: 15 }, (_, i) => `这是第${i + 1}行包含关键词。`);
		const fileContent = lines.join('\n');

		const app = {
			vault: {
				cachedRead: vi.fn().mockResolvedValue(fileContent),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		let renderedResults: Array<{ file: TFile; snippets: Array<{ highlight: string; occurrenceIndex: number }>; totalMatches: number }> = [];

		const plugin = {
			settings: { advancedSearchQuery: '关键词', customSortOrder: {} },
			saveSettings: vi.fn(),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { query: string }).query = '关键词';
		(modal as unknown as { resultsContainer: { empty: () => void; createDiv: () => void } }).resultsContainer = {
			empty: vi.fn(),
			createDiv: vi.fn()
		};
		(modal as unknown as { renderSearchResults: (results: typeof renderedResults) => void }).renderSearchResults = (results) => {
			renderedResults = results;
		};

		await (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		expect(renderedResults.length).toBe(1);
		expect(renderedResults[0].totalMatches).toBe(15);
		expect(renderedResults[0].snippets.length).toBe(15);
		expect(renderedResults[0].snippets[14].occurrenceIndex).toBe(14);
	});

	it('discards delayed old search result when newer search finishes first', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		let resolveFirstRead!: (val: string) => void;
		const firstReadPromise = new Promise<string>(resolve => {
			resolveFirstRead = resolve;
		});

		let readCallCount = 0;
		const app = {
			vault: {
				cachedRead: vi.fn((_file: TFile) => {
					readCallCount++;
					if (readCallCount === 1) {
						return firstReadPromise;
					}
					return Promise.resolve('第二章内容包含 新关键词。');
				}),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		const renderedHistory: string[] = [];

		const plugin = {
			settings: { advancedSearchQuery: '', customSortOrder: {} },
			saveSettings: vi.fn(),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { resultsContainer: { empty: () => void; createDiv: () => void } }).resultsContainer = {
			empty: vi.fn(),
			createDiv: vi.fn()
		};
		(modal as unknown as { renderSearchResults: (results: Array<{ snippets: Array<{ highlight: string }> }>) => void }).renderSearchResults = (results) => {
			const highlights = results.flatMap(r => r.snippets.map(s => s.highlight));
			renderedHistory.push(highlights.join(','));
		};

		// 1. Start slow search for "旧关键词"
		(modal as unknown as { query: string }).query = '旧关键词';
		const search1Promise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		// 2. Start faster search for "新关键词"
		(modal as unknown as { query: string }).query = '新关键词';
		const search2Promise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		// Wait for search 2 to finish
		await search2Promise;
		expect(renderedHistory).toEqual(['新关键词']);

		// 3. Now resolve slow search 1
		resolveFirstRead('第一章内容包含 旧关键词。');
		await search1Promise;

		// Stale search 1 should NOT overwrite search 2's rendered results
		expect(renderedHistory).toEqual(['新关键词']);
	});

	it('aborts search and suppresses rendering when modal is closed during cachedRead', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		let resolveRead!: (val: string) => void;
		const readPromise = new Promise<string>(resolve => {
			resolveRead = resolve;
		});

		const app = {
			vault: {
				cachedRead: vi.fn().mockReturnValue(readPromise),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		let renderCalled = false;
		const plugin = {
			settings: { advancedSearchQuery: '', customSortOrder: {} },
			saveSettings: vi.fn(),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { query: string }).query = '测试';
		(modal as unknown as { resultsContainer: { empty: () => void; createDiv: () => void } }).resultsContainer = {
			empty: vi.fn(),
			createDiv: vi.fn()
		};
		(modal as unknown as { renderSearchResults: () => void }).renderSearchResults = () => {
			renderCalled = true;
		};

		const searchPromise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		// Close modal while cachedRead is pending
		modal.onClose();

		// Now cachedRead completes
		resolveRead('正文内容包含 测试 关键词');
		await searchPromise;

		expect(renderCalled).toBe(false);
	});

	it('requires contentEl ownerDocument defaultView for getOwnerWindow without global window fallback', () => {
		const app = { workspace: { getLeavesOfType: vi.fn() } };
		const plugin = { settings: { advancedSearchQuery: '' } } as unknown as AdvancedSearchModalPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin);

		// With no ownerDocument on contentEl, should return null even if globalThis.window exists
		const originalWindow = (globalThis as unknown as { window?: unknown }).window;
		try {
			(globalThis as unknown as { window?: unknown }).window = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
			(modal as unknown as { contentEl: HTMLElement }).contentEl = {} as HTMLElement;
			expect((modal as unknown as { getOwnerWindow: () => Window | null }).getOwnerWindow()).toBeNull();
		} finally {
			(globalThis as unknown as { window?: unknown }).window = originalWindow;
		}
	});

	it('handles saveSettings rejection explicitly without failing the search', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		const app = {
			vault: {
				cachedRead: vi.fn().mockResolvedValue('正文内容关键词'),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};
		const plugin = {
			settings: { advancedSearchQuery: '旧词', customSortOrder: {} },
			saveSettings: vi.fn().mockRejectedValue(new Error('disk write error')),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { query: string }).query = '关键词';
		(modal as unknown as { resultsContainer: { empty: () => void; createDiv: () => void } }).resultsContainer = {
			empty: vi.fn(),
			createDiv: vi.fn()
		};
		const renderSpy = vi.fn();
		(modal as unknown as { renderSearchResults: (results: unknown) => void }).renderSearchResults = renderSpy;

		await (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();
		expect(renderSpy).toHaveBeenCalled();
	});

	function attachRealisticWindow(modal: AdvancedSearchModal) {
		const timers = new Map<number, NodeJS.Timeout>();
		let nextId = 1;
		const win = {
			setTimeout: vi.fn((fn: () => void, ms = 0) => {
				const id = nextId++;
				const t = setTimeout(fn, ms);
				timers.set(id, t);
				return id;
			}),
			clearTimeout: vi.fn((id: number) => {
				const t = timers.get(id);
				if (t) {
					clearTimeout(t);
					timers.delete(id);
				}
			})
		};
		const contentEl = new MockElement('modal-content');
		(contentEl as unknown as { ownerDocument: { defaultView: typeof win } }).ownerDocument = {
			defaultView: win
		};
		modal.contentEl = contentEl as unknown as HTMLElement;
		return win;
	}

	it('yields during matching on a single high-match file and settles waits on cancel', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '大文件', name: '大文件.md', path: 'Novel/大文件.md' });
		const lines = Array.from({ length: 120 }, (_, i) => `这是第${i}行包含高频词`);
		const fileContent = lines.join('\n');

		const app = {
			vault: {
				cachedRead: vi.fn().mockResolvedValue(fileContent),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		const plugin = {
			settings: { advancedSearchQuery: '高频词', customSortOrder: {} },
			saveSettings: vi.fn().mockResolvedValue(undefined),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		const win = attachRealisticWindow(modal);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { query: string }).query = '高频词';
		(modal as unknown as { resultsContainer: MockElement }).resultsContainer = new MockElement('results-container');
		const renderSpy = vi.fn();
		(modal as unknown as { renderSearchResults: (results: unknown) => void }).renderSearchResults = renderSpy;

		let timeoutCallback: (() => void) | null = null;
		win.setTimeout.mockImplementationOnce((fn: () => void) => {
			timeoutCallback = fn;
			const id = 999;
			return id;
		});

		const pendingSearch = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();
		await Promise.resolve();
		expect(win.setTimeout).toHaveBeenCalledTimes(1);
		modal.onClose();
		await pendingSearch;

		expect(win.clearTimeout).toHaveBeenCalledWith(999);
		expect(renderSpy).not.toHaveBeenCalled();

		if (timeoutCallback) {
			(timeoutCallback as () => void)();
		}
		expect(renderSpy).not.toHaveBeenCalled();
	});

	it('ensures new search remains correct despite old pending callback from previous search', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '大文件', name: '大文件.md', path: 'Novel/大文件.md' });
		const lines = Array.from({ length: 60 }, (_, i) => `这是第${i}行包含搜索词一`);
		lines.push('第61行包含搜索词二');
		const fileContent = lines.join('\n');

		const app = {
			vault: {
				cachedRead: vi.fn().mockResolvedValue(fileContent),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		const plugin = {
			settings: { advancedSearchQuery: '', customSortOrder: {} },
			saveSettings: vi.fn().mockResolvedValue(undefined),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		let delayedOldCallback: (() => void) | null = null;
		const win = {
			setTimeout: vi.fn((fn: () => void) => {
				delayedOldCallback = fn;
				return 101;
			}),
			clearTimeout: vi.fn()
		};
		const contentEl = new MockElement('modal-content');
		(contentEl as unknown as { ownerDocument: { defaultView: typeof win } }).ownerDocument = { defaultView: win };
		modal.contentEl = contentEl as unknown as HTMLElement;
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { resultsContainer: MockElement }).resultsContainer = new MockElement('results-container');

		const renderedKeywords: string[] = [];
		(modal as unknown as { renderSearchResults: (results: Array<{ snippets: Array<{ highlight: string }> }>) => Promise<void> }).renderSearchResults = async (results) => {
			renderedKeywords.push(...results.flatMap(r => r.snippets.map(s => s.highlight)));
		};

		// 1. Search 1 yields at match 50
		(modal as unknown as { query: string }).query = '搜索词一';
		const search1Promise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		// 2. Start Search 2 before Search 1 resumes
		(modal as unknown as { query: string }).query = '搜索词二';
		const search2Promise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();
		await search2Promise;

		expect(renderedKeywords).toEqual(['搜索词二']);

		// 3. Old callback from Search 1 fires late
		if (delayedOldCallback) {
			(delayedOldCallback as () => void)();
		}
		await search1Promise;

		expect(renderedKeywords).toEqual(['搜索词二']);
	});

	it('supersedes pending file read when an empty query is submitted', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		let resolveDelayedRead!: (content: string) => void;
		const delayedRead = new Promise<string>(resolve => {
			resolveDelayedRead = resolve;
		});

		const app = {
			vault: {
				cachedRead: vi.fn().mockReturnValue(delayedRead),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		const plugin = {
			settings: { advancedSearchQuery: '旧词', customSortOrder: {} },
			saveSettings: vi.fn().mockResolvedValue(undefined),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		const container = new MockElement('results-container');
		(modal as unknown as { resultsContainer: MockElement }).resultsContainer = container;

		// 1. Start search with query '旧词'
		(modal as unknown as { query: string }).query = '旧词';
		const search1Promise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();
		expect(container.querySelector('.advanced-search-loading')).not.toBeNull();

		// 2. Clear query and execute empty search
		(modal as unknown as { query: string }).query = '   ';
		const emptySearchPromise = (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();
		await emptySearchPromise;

		expect(container.querySelector('.advanced-search-empty')).not.toBeNull();
		expect(container.querySelector('.advanced-search-empty')?.textContent).toBe(t('modal.please-enter-keyword'));

		// 3. Now delayed read completes
		resolveDelayedRead('正文包含 旧词');
		await search1Promise;

		expect(container.querySelector('.advanced-search-empty')?.textContent).toBe(t('modal.please-enter-keyword'));
		expect(container.querySelectorAll('.advanced-search-match-item')).toHaveLength(0);
	});

	it('yields during actual DOM render and stops appending after cancellation', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		const results = [{
			file: targetFile,
			snippets: Array.from({ length: 60 }, (_, i) => ({
				linesBefore: i,
				prefix: '前缀',
				highlight: `匹配${i}`,
				suffix: '后缀',
				matchStart: i * 10,
				matchEnd: i * 10 + 5,
				startLoc: { line: i, ch: 0 },
				endLoc: { line: i, ch: 5 }
			})),
			totalMatches: 60
		}];

		const app = { workspace: { getLeavesOfType: vi.fn() } };
		const plugin = { settings: { advancedSearchQuery: '' } } as unknown as AdvancedSearchModalPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin);
		const win = attachRealisticWindow(modal);
		const container = new MockElement('results-container');
		(modal as unknown as { resultsContainer: MockElement }).resultsContainer = container;

		// Cancel modal when yieldToEventLoop is called at DOM item 50
		win.setTimeout.mockImplementationOnce((fn: () => void) => {
			(modal as unknown as { cancelActiveSearch: () => void }).cancelActiveSearch();
			return 201;
		});

		const searchId = (modal as unknown as { activeSearchId: number }).activeSearchId;
		await (modal as unknown as {
			renderSearchResults: (res: typeof results, id?: number) => Promise<void>;
		}).renderSearchResults(results, searchId);

		const items = container.querySelectorAll('.advanced-search-match-item');
		expect(items).toHaveLength(50);
	});

	it('renders untruncated high-match results across chunking cycles without limit', async () => {
		const targetFile = Object.assign(new TFile(), { basename: '第一章', name: '第一章.md', path: 'Novel/第一章.md' });
		const results = [{
			file: targetFile,
			snippets: Array.from({ length: 60 }, (_, i) => ({
				linesBefore: i,
				prefix: '前缀',
				highlight: `匹配${i}`,
				suffix: '后缀',
				matchStart: i * 10,
				matchEnd: i * 10 + 5,
				startLoc: { line: i, ch: 0 },
				endLoc: { line: i, ch: 5 }
			})),
			totalMatches: 60
		}];

		const app = { workspace: { getLeavesOfType: vi.fn() } };
		const plugin = { settings: { advancedSearchQuery: '' } } as unknown as AdvancedSearchModalPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin);
		attachRealisticWindow(modal);
		const container = new MockElement('results-container');
		(modal as unknown as { resultsContainer: MockElement }).resultsContainer = container;

		const searchId = (modal as unknown as { activeSearchId: number }).activeSearchId;
		await (modal as unknown as {
			renderSearchResults: (res: typeof results, id?: number) => Promise<void>;
		}).renderSearchResults(results, searchId);

		const items = container.querySelectorAll('.advanced-search-match-item');
		expect(items).toHaveLength(60);
	});

	it('correctly handles CRLF normalization, frontmatter exclusion, and multiline coordinates', async () => {
		const targetFile = Object.assign(new TFile(), { basename: 'CRLF章节', name: 'CRLF章节.md', path: 'Novel/CRLF章节.md' });
		const fileContent = [
			'---',
			'title: YAML标题',
			'desc: 忽略 frontmatter 跨行 目标',
			'---',
			'第一行正文。',
			'第二行包含 跨行',
			'目标 词。'
		].join('\r\n');

		const app = {
			vault: {
				cachedRead: vi.fn().mockResolvedValue(fileContent),
				getRoot: vi.fn().mockReturnValue({ children: [] })
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([])
			}
		};

		let renderedResults: Array<{
			file: TFile;
			snippets: Array<{
				linesBefore: number;
				highlight: string;
				prefix: string;
				suffix: string;
				contextPrefix: string;
				contextSuffix: string;
				startLoc: { line: number; ch: number };
				endLoc: { line: number; ch: number };
				matchStart: number;
				matchEnd: number;
				occurrenceIndex: number;
			}>;
			totalMatches: number;
		}> = [];

		const plugin = {
			settings: { advancedSearchQuery: '跨行 目标', customSortOrder: {} },
			saveSettings: vi.fn(),
			getVaultMarkdownFiles: vi.fn().mockReturnValue([targetFile]),
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([targetFile])
		} as unknown as AdvancedSearchModalPlugin;

		const modal = new AdvancedSearchModal(app as never, plugin);
		(modal as unknown as { searchScope: string }).searchScope = 'global';
		(modal as unknown as { query: string }).query = '跨行 目标';
		(modal as unknown as { resultsContainer: { empty: () => void; createDiv: () => void } }).resultsContainer = {
			empty: vi.fn(),
			createDiv: vi.fn()
		};
		(modal as unknown as { renderSearchResults: (results: typeof renderedResults) => void }).renderSearchResults = (results) => {
			renderedResults = results;
		};

		await (modal as unknown as { executeSearch: () => Promise<void> }).executeSearch();

		// Should ignore frontmatter match and find the 1 cross-line match in the body
		expect(renderedResults.length).toBe(1);
		expect(renderedResults[0].totalMatches).toBe(1);
		const s1 = renderedResults[0].snippets[0];
		expect(s1.linesBefore).toBe(5);
		expect(s1.startLoc).toEqual({ line: 5, ch: 6 });
		expect(s1.endLoc).toEqual({ line: 6, ch: 2 });
		expect(s1.occurrenceIndex).toBe(0);
		expect(s1.highlight).toBe('跨行 目标');
	});
});
