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

	it('does not let delayed startup loading overwrite a newly saved draft', async () => {
		let resolveRead!: (value: string) => void;
		const delayedRead = new Promise<string>(resolve => { resolveRead = resolve; });
		const write = vi.fn().mockResolvedValue(undefined);
		mockPlugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(true);
		mockPlugin.app.vault.adapter.read = vi.fn().mockReturnValue(delayedRead);
		mockPlugin.app.vault.adapter.write = write;
		manager = new ChapterMergeManager(mockPlugin);
		const item = {
			file: { path: 'Novel/Ch1.md', basename: 'Ch1' } as TFile,
			volumeName: '', title: 'Ch1', frontmatter: '', originalBody: 'old',
			currentBody: 'new', annotation: '', originalAnnotation: '', isModified: true
		};

		manager.saveDraft('Novel', [item]);
		resolveRead(JSON.stringify({ Other: { folderPath: 'Other', timestamp: 1, items: {} } }));
		await manager.flush();

		const persisted = JSON.parse(write.mock.calls.at(-1)?.[1] as string);
		expect(persisted.Novel.items['Novel/Ch1.md'].currentBody).toBe('new');
		expect(persisted.Other).toBeDefined();
	});

	it('orders save then clear operations deterministically', async () => {
		const adapter = mockPlugin.app.vault.adapter;
		adapter.exists = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
		adapter.remove = vi.fn().mockResolvedValue(undefined);
		manager = new ChapterMergeManager(mockPlugin);
		const item = {
			file: { path: 'Novel/Ch1.md', basename: 'Ch1' } as TFile,
			volumeName: '', title: 'Ch1', frontmatter: '', originalBody: 'old',
			currentBody: 'new', annotation: '', originalAnnotation: '', isModified: true
		};

		manager.saveDraft('Novel', [item]);
		manager.clearDraft('Novel');
		await manager.flush();

		expect(await manager.loadDraft('Novel')).toBeNull();
		expect(adapter.write).toHaveBeenCalledTimes(1);
		expect(adapter.remove).toHaveBeenCalledTimes(1);
	});
});
