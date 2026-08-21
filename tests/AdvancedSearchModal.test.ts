import { describe, expect, it, vi } from 'vitest';
import { AdvancedSearchModal, type AdvancedSearchModalPlugin } from '../src/ui/AdvancedSearchModal';
import { TFile } from 'obsidian';
import { smartLocateAndHighlight } from '../src/utils/leaf';

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
});
