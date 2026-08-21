import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => {
	const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
	return {
		...actual,
		FuzzySuggestModal: class<T> {
			constructor(_app: unknown) {}
			setPlaceholder(_placeholder: string): void {}
			open(): void {}
		}
	};
});

import { TFile } from 'obsidian';
import { getStickyNoteFileCandidates, type StickyNoteListRendererPlugin } from '../src/ui/components/StickyNoteListRenderer';

describe('StickyNoteListRenderer file candidates', () => {
	it('includes non-chapter Markdown files', () => {
		const chapter = new TFile('第一章.md', '作品/第一章.md');
		const novelInfo = new TFile('作品信息.md', '作品/作品信息.md');
		const plugin = {
			getVaultMarkdownFiles: () => [chapter, novelInfo]
		} as Pick<StickyNoteListRendererPlugin, 'getVaultMarkdownFiles'>;

		expect(getStickyNoteFileCandidates(plugin)).toEqual([chapter, novelInfo]);
	});
});
