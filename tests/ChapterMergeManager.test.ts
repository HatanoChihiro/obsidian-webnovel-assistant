import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChapterMergeManager, ChapterMergeItem } from '../src/services/ChapterMergeManager';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile, TFolder } from 'obsidian';

describe('ChapterMergeManager', () => {
	let mockPlugin: WebNovelAssistantPlugin;
	let manager: ChapterMergeManager;

	beforeEach(() => {
		mockPlugin = {
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
						read: vi.fn(),
						write: vi.fn(),
						remove: vi.fn()
					},
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					create: vi.fn().mockImplementation((path, content) => Promise.resolve({ path, name: path.split('/').pop() || '' } as TFile)),
					modify: vi.fn().mockResolvedValue(undefined)
				}
			},
			manifest: {
				dir: 'plugins/test',
				id: 'test'
			},
			calculateAccurateWords: vi.fn((text: string) => text.replace(/\s+/g, '').length)
		} as unknown as WebNovelAssistantPlugin;

		manager = new ChapterMergeManager(mockPlugin);
	});

	it('exportMergedDocument should return file and accurate merged word count', async () => {
		const folder = { path: 'Novel', name: 'Novel' } as TFolder;
		const items: ChapterMergeItem[] = [
			{
				file: { path: 'Novel/Ch1.md', basename: 'Ch1' } as TFile,
				volumeName: '',
				title: '第一章 各种故事',
				frontmatter: '',
				originalBody: '这是第一章的正文内容。',
				currentBody: '这是第一章的正文内容。',
				annotation: '',
				originalAnnotation: '',
				isModified: false
			},
			{
				file: { path: 'Novel/Ch2.md', basename: 'Ch2' } as TFile,
				volumeName: '',
				title: '第二章 各种情节',
				frontmatter: '',
				originalBody: '这是第二章的精彩故事续写。',
				currentBody: '这是第二章的精彩故事续写。',
				annotation: '',
				originalAnnotation: '',
				isModified: false
			}
		];

		const result = await manager.exportMergedDocument(folder, items);
		expect(result).toHaveProperty('file');
		expect(result).toHaveProperty('wordCount');
		// merged content will contain headers + bodies, wordCount should be > 20, definitely not 11 (filename length)
		expect(result.wordCount).toBeGreaterThan(20);
	});

	it('exportMergedDocument when includeTitles is false should exclude titles from merged content', async () => {
		const folder = { path: 'Novel', name: 'Novel' } as TFolder;
		const items: ChapterMergeItem[] = [
			{
				file: { path: 'Novel/Ch1.md', basename: 'Ch1' } as TFile,
				volumeName: '第一卷',
				title: '第一章 各种故事',
				frontmatter: '',
				originalBody: '这是第一章的正文内容。',
				currentBody: '这是第一章的正文内容。',
				annotation: '',
				originalAnnotation: '',
				isModified: false
			}
		];

		await manager.exportMergedDocument(folder, items, false);
		const createMock = mockPlugin.app.vault.create as any;
		expect(createMock).toHaveBeenCalled();
		const createdContent = createMock.mock.calls[0][1];
		expect(createdContent).not.toContain('# Novel');
		expect(createdContent).not.toContain('## 第一卷');
		expect(createdContent).not.toContain('### 第一章');
		expect(createdContent).toBe('这是第一章的正文内容。');
	});
});
