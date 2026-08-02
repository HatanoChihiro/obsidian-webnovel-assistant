import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { getValidTemplateFiles, resolveChapterTemplate } from '../src/utils/template';
import { TemplateChoiceModal } from '../src/ui/TemplateChoiceModal';
import type { WebNovelAssistantSettings } from '../src/types/settings';
import { DEFAULT_SETTINGS } from '../src/constants';

// Mock TFile
function createMockFile(path: string, extension: string = 'md'): TFile {
	const file = new TFile();
	file.path = path;
	const parts = path.split('/');
	file.name = parts[parts.length - 1];
	file.basename = file.name.replace(/\.[^/.]+$/, '');
	(file as { extension: string }).extension = extension;
	return file;
}

describe('getValidTemplateFiles', () => {
	it('当 enableChapterTemplate 为 false 时返回空数组', () => {
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: false,
			chapterTemplatePaths: ['Templates/T1.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: () => createMockFile('Templates/T1.md')
			}
		};
		expect(getValidTemplateFiles(mockApp as never, settings)).toEqual([]);
	});

	it('当 enableChapterTemplate 为 true 且存在多个有效模板时正确返回文件列表', () => {
		const f1 = createMockFile('Templates/T1.md');
		const f2 = createMockFile('Templates/T2.md');

		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md', 'Templates/T2.md', 'Templates/Invalid.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (path: string) => {
					if (path === 'Templates/T1.md') return f1;
					if (path === 'Templates/T2.md') return f2;
					return null;
				}
			}
		};

		const result = getValidTemplateFiles(mockApp as never, settings);
		expect(result).toEqual([f1, f2]);
	});

	it('支持向前兼容单一 chapterTemplatePath', () => {
		const f1 = createMockFile('Templates/Single.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePath: 'Templates/Single.md',
			chapterTemplatePaths: []
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (path: string) => (path === 'Templates/Single.md' ? f1 : null)
			}
		};

		const result = getValidTemplateFiles(mockApp as never, settings);
		expect(result).toEqual([f1]);
	});

	it('自动去重相同路径', () => {
		const f1 = createMockFile('Templates/T1.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md', 'Templates/T1.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (path: string) => (path === 'Templates/T1.md' ? f1 : null)
			}
		};

		const result = getValidTemplateFiles(mockApp as never, settings);
		expect(result).toEqual([f1]);
	});
});

describe('resolveChapterTemplate', () => {
	it('0 个有效模板时立即回调空字符串', () => {
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: false
		};
		const mockApp = { vault: { getAbstractFileByPath: () => null } };
		const callback = vi.fn();

		resolveChapterTemplate(mockApp as never, settings, callback);
		expect(callback).toHaveBeenCalledWith('');
	});

	it('1 个有效模板时直接读取内容回调', async () => {
		const f1 = createMockFile('Templates/T1.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (path: string) => (path === 'Templates/T1.md' ? f1 : null),
				read: vi.fn(async () => '# 章节模板一\n正文...')
			}
		};
		const callback = vi.fn();

		resolveChapterTemplate(mockApp as never, settings, callback);
		// 等待 promise 微任务
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(mockApp.vault.read).toHaveBeenCalledWith(f1);
		expect(callback).toHaveBeenCalledWith('# 章节模板一\n正文...');
	});

	it('多模板弹窗取消或不选择模板时回调空字符串（创建空白文档）', () => {
		const f1 = createMockFile('Templates/T1.md');
		const f2 = createMockFile('Templates/T2.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md', 'Templates/T2.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (path: string) => {
					if (path === 'Templates/T1.md') return f1;
					if (path === 'Templates/T2.md') return f2;
					return null;
				}
			}
		};
		const callback = vi.fn();

		const openSpy = vi.spyOn(TemplateChoiceModal.prototype, 'open').mockImplementation(function (this: TemplateChoiceModal) {
			this.onClose();
		});

		resolveChapterTemplate(mockApp as never, settings, callback);
		expect(callback).toHaveBeenCalledWith('');
		openSpy.mockRestore();
	});
});
