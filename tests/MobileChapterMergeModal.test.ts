import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileChapterMergeModal } from '../src/ui/MobileChapterMergeModal';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile, TFolder } from 'obsidian';

describe('MobileChapterMergeModal', () => {
	let mockPlugin: WebNovelAssistantPlugin;

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
				},
				workspace: {
					getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) })
				}
			},
			manifest: {
				dir: 'plugins/test',
				id: 'test'
			},
			settings: {
				typography: { enabled: true, indent: '2em', lineHeight: '1.8', paraSpacing: '0.5em' }
			},
			typographyManager: {},
			chapterMergeManager: {
				loadFolderChapters: vi.fn().mockResolvedValue([
					{
						file: { path: 'Novel/Ch1.md', basename: 'Ch1' } as TFile,
						volumeName: '第一卷',
						title: '第一章 测试',
						frontmatter: '',
						originalBody: '这是移动端正文内容测试。',
						currentBody: '这是移动端正文内容测试。',
						annotation: '',
						originalAnnotation: '',
						isModified: false
					}
				]),
				exportMergedDocument: vi.fn().mockResolvedValue({
					file: { path: 'Novel/Novel_合并章节.md', basename: 'Novel_合并章节' } as TFile,
					wordCount: 15
				}),
				clearDraft: vi.fn()
			},
			calculateAccurateWords: vi.fn((text: string) => text.replace(/\s+/g, '').length)
		} as unknown as WebNovelAssistantPlugin;
	});

	it('should instantiate MobileChapterMergeModal without throwing', () => {
		const folder = { path: 'Novel', name: 'Novel' } as TFolder;
		const modal = new MobileChapterMergeModal(mockPlugin.app, mockPlugin, folder);
		expect(modal).toBeDefined();
	});

	it('should open modal and call loadFolderChapters', async () => {
		const folder = { path: 'Novel', name: 'Novel' } as TFolder;
		const modal = new MobileChapterMergeModal(mockPlugin.app, mockPlugin, folder);

		await modal.onOpen();

		expect(mockPlugin.chapterMergeManager.loadFolderChapters).toHaveBeenCalledWith(folder);
	});
});
