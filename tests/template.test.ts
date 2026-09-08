import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { getValidTemplateFiles, resolveChapterTemplate, resolveChapterTemplateContent } from '../src/utils/template';
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
	it('0 个有效模板时立即回调空字符串', async () => {
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: false
		};
		const mockApp = { vault: { getAbstractFileByPath: () => null } };
		const callback = vi.fn();

		resolveChapterTemplate(mockApp as never, settings, callback);
		await new Promise(resolve => setTimeout(resolve, 0));
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

	it('多模板弹窗取消时回调 null（中止创建）', async () => {
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
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(callback).toHaveBeenCalledWith(null);
		openSpy.mockRestore();
	});

	it('多模板弹窗明确选择不使用模板时回调空字符串（创建空白文档）', async () => {
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

		interface TemplateChoiceModalInternal {
			onChoose: (file: TFile | null) => void;
			isResolved: boolean;
			close: () => void;
		}

		const openSpy = vi.spyOn(TemplateChoiceModal.prototype, 'open').mockImplementation(function (this: TemplateChoiceModal) {
			const internal = this as unknown as TemplateChoiceModalInternal;
			internal.onChoose(null);
			internal.isResolved = true;
			this.close();
		});

		resolveChapterTemplate(mockApp as never, settings, callback);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(callback).toHaveBeenCalledWith('');
		openSpy.mockRestore();
	});
});

describe('resolveChapterTemplateContent', () => {
	it('当未配置模板时返回空字符串', async () => {
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: false
		};
		const mockApp = { vault: { getAbstractFileByPath: () => null } };

		const res = await resolveChapterTemplateContent(mockApp as never, settings);
		expect(res).toBe('');
	});

	it('当 1 个有效模板且读取成功时返回模板内容', async () => {
		const f1 = createMockFile('Templates/T1.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: () => f1,
				read: vi.fn(async () => '---\nstatus: draft\n---\n\n# Body')
			}
		};

		const res = await resolveChapterTemplateContent(mockApp as never, settings);
		expect(res).toBe('---\nstatus: draft\n---\n\n# Body');
	});

	it('当 1 个有效模板但读取失败时抛出异常以便中止拆分', async () => {
		const f1 = createMockFile('Templates/T1.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: () => f1,
				read: vi.fn().mockRejectedValue(new Error('Template unreadable'))
			}
		};

		await expect(resolveChapterTemplateContent(mockApp as never, settings))
			.rejects.toThrow('Template unreadable');
	});

	it('多模板时用户取消返回 null', async () => {
		const f1 = createMockFile('Templates/T1.md');
		const f2 = createMockFile('Templates/T2.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md', 'Templates/T2.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === 'Templates/T1.md' ? f1 : f2)
			}
		};

		const openSpy = vi.spyOn(TemplateChoiceModal.prototype, 'open').mockImplementation(function (this: TemplateChoiceModal) {
			this.onClose();
		});

		const res = await resolveChapterTemplateContent(mockApp as never, settings);
		expect(res).toBeNull();
		openSpy.mockRestore();
	});

	it('多模板时用户选择“不使用模板”返回空字符串', async () => {
		const f1 = createMockFile('Templates/T1.md');
		const f2 = createMockFile('Templates/T2.md');
		const settings: WebNovelAssistantSettings = {
			...DEFAULT_SETTINGS,
			enableChapterTemplate: true,
			chapterTemplatePaths: ['Templates/T1.md', 'Templates/T2.md']
		};
		const mockApp = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === 'Templates/T1.md' ? f1 : f2)
			}
		};

		interface TemplateChoiceModalInternal {
			onChoose: (file: TFile | null) => void;
			isResolved: boolean;
			close: () => void;
		}

		const openSpy = vi.spyOn(TemplateChoiceModal.prototype, 'open').mockImplementation(function (this: TemplateChoiceModal) {
			const internal = this as unknown as TemplateChoiceModalInternal;
			internal.onChoose(null);
			internal.isResolved = true;
			this.close();
		});

		const res = await resolveChapterTemplateContent(mockApp as never, settings);
		expect(res).toBe('');
		openSpy.mockRestore();
	});
});
