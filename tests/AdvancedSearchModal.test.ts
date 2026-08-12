import { describe, expect, it, vi } from 'vitest';
import { AdvancedSearchModal } from '../src/ui/AdvancedSearchModal';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile } from 'obsidian';

describe('AdvancedSearchModal source leaf routing', () => {
	it('opens a result in the leaf that launched the search', () => {
		const sourceFile = new TFile('参考.md', 'Novel/参考.md');
		const targetFile = new TFile('章节.md', 'Novel/章节.md');
		const openFile = vi.fn().mockResolvedValue(undefined);
		const sourceLeaf = {
			view: { file: sourceFile, getViewType: () => 'markdown' },
			openFile,
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
		} as unknown as WebNovelAssistantPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin, sourceLeaf as never);

		(modal as unknown as { openSearchResult: (file: TFile, line: number) => void })
			.openSearchResult(targetFile, 7);

		expect(openFile).toHaveBeenCalledWith(targetFile, { eState: { line: 7 } });
		expect(app.workspace.getLeaf).not.toHaveBeenCalled();
	});

	it('falls back to an active Markdown leaf when the source leaf is no longer valid', () => {
		const targetFile = new TFile('章节.md', 'Novel/章节.md');
		const fallbackOpenFile = vi.fn().mockResolvedValue(undefined);
		const fallbackLeaf = {
			view: { file: targetFile },
			openFile: fallbackOpenFile,
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
		} as unknown as WebNovelAssistantPlugin;
		const modal = new AdvancedSearchModal(app as never, plugin, {
			view: { file: null },
			openFile: vi.fn()
		} as never);

		(modal as unknown as { openSearchResult: (file: TFile, line: number) => void })
			.openSearchResult(targetFile, 2);

		expect(fallbackOpenFile).toHaveBeenCalledWith(targetFile, { eState: { line: 2 } });
	});
});
