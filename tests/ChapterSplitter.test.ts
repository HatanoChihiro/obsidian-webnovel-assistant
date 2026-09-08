import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TFile, TFolder, MarkdownView, Setting, type App, type Editor } from 'obsidian';
import { resetNoticeMessages, mockNoticeMessages } from './mocks/obsidian';
import {
	calculateOffset,
	analyzeSplitContent,
	combineTemplateAndSuffix,
	validateChapterBasename,
	splitChapterAtCursor
} from '../src/services/ChapterSplitter';
import { TemplateChoiceModal } from '../src/ui/TemplateChoiceModal';
import { ChapterSplitCollisionModal } from '../src/ui/ChapterSplitCollisionModal';
import type { ChapterTemplateSettings } from '../src/utils/template';

interface MockVault {
	getAbstractFileByPath: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	read: ReturnType<typeof vi.fn>;
}

interface MockWorkspace {
	getLeaf: ReturnType<typeof vi.fn>;
}

interface MockApp {
	vault: MockVault;
	workspace: MockWorkspace;
}

interface MockEditor {
	getValue: ReturnType<typeof vi.fn>;
	setValue: ReturnType<typeof vi.fn>;
	somethingSelected: ReturnType<typeof vi.fn>;
	listSelections: ReturnType<typeof vi.fn>;
	getCursor: ReturnType<typeof vi.fn>;
	lastLine: ReturnType<typeof vi.fn>;
	getLine: ReturnType<typeof vi.fn>;
	replaceRange: ReturnType<typeof vi.fn>;
	focus?: ReturnType<typeof vi.fn>;
	setCursor?: ReturnType<typeof vi.fn>;
}

interface MockTargetEditor {
	focus: ReturnType<typeof vi.fn>;
	setCursor: ReturnType<typeof vi.fn>;
}

interface MockTargetMarkdownView {
	editor: MockTargetEditor;
	file: TFile | null;
}

interface MockLeaf {
	openFile: ReturnType<typeof vi.fn>;
	view: MockTargetMarkdownView;
}

interface MockView {
	file: TFile | null;
	editor: MockEditor;
	leaf: MockLeaf;
	save: ReturnType<typeof vi.fn>;
}

interface TemplateChoiceModalInternal {
	onClose: () => void;
	onChoose: (file: TFile | null) => void;
	close: () => void;
}

const defaultSplitSettings: ChapterTemplateSettings = {
	enableChapterTemplate: false,
	chapterTemplatePaths: [],
	chapterTemplatePath: ''
};

function createMockFile(path: string, extension: string = 'md'): TFile {
	const file = new TFile();
	file.path = path;
	const parts = path.split('/');
	file.name = parts[parts.length - 1];
	file.basename = file.name.replace(/\.[^/.]+$/, '');
	(file as { extension: string }).extension = extension;
	return file;
}

function createMockFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	const parts = path.split('/');
	folder.name = parts[parts.length - 1];
	folder.children = [];
	return folder;
}

describe('ChapterSplitter - Core Logic & Regressions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetNoticeMessages();
	});

	describe('calculateOffset', () => {
		it('should accurately calculate offset in single-line and multi-line strings', () => {
			const text = 'Line 0\nLine 1\nLine 2';
			// Line 0 has 6 chars + 1 newline = 7. Line 1 begins at index 7.
			expect(calculateOffset(text, { line: 0, ch: 0 })).toBe(0);
			expect(calculateOffset(text, { line: 0, ch: 4 })).toBe(4);
			expect(calculateOffset(text, { line: 1, ch: 0 })).toBe(7);
			expect(calculateOffset(text, { line: 1, ch: 4 })).toBe(11);
			expect(calculateOffset(text, { line: 2, ch: 0 })).toBe(14);
			expect(calculateOffset(text, { line: 2, ch: 6 })).toBe(20);
		});

		it('should handle Windows CRLF gracefully without overflowing line bounds', () => {
			const text = 'Line 0\r\nLine 1\r\nLine 2';
			expect(calculateOffset(text, { line: 1, ch: 0 })).toBe(8);
			expect(calculateOffset(text, { line: 1, ch: 4 })).toBe(12);
		});

		it('should clamp out-of-range lines and characters', () => {
			const text = 'Short';
			expect(calculateOffset(text, { line: -1, ch: 0 })).toBe(0);
			expect(calculateOffset(text, { line: 99, ch: 99 })).toBe(5);
			expect(calculateOffset(text, { line: 0, ch: 99 })).toBe(5);
		});
	});

	describe('analyzeSplitContent', () => {
		it('should allow exact mid-paragraph split without trimming or reformatting', () => {
			const text = 'First line\nHello Wonderful World\nThird line';
			const offset = text.indexOf('Wonderful');
			const analysis = analyzeSplitContent(text, offset);

			expect(analysis.canSplit).toBe(true);
			expect(analysis.prefix).toBe(text.slice(0, offset));
			expect(analysis.suffix).toBe(text.slice(offset));
			expect(analysis.prefix + analysis.suffix).toBe(text);
			expect(analysis.prefix).toBe('First line\nHello ');
			expect(analysis.suffix).toBe('Wonderful World\nThird line');
		});

		it('should allow exact newline split preserving exact newline character on proper side', () => {
			const text = 'Paragraph 1\n\nParagraph 2';
			const offset = text.indexOf('\n\n') + 1; // Between the two newlines
			const analysis = analyzeSplitContent(text, offset);

			expect(analysis.canSplit).toBe(true);
			expect(analysis.prefix).toBe('Paragraph 1\n');
			expect(analysis.suffix).toBe('\nParagraph 2');
			expect(analysis.prefix + analysis.suffix).toBe(text);
		});

		it('should retain source frontmatter in source and NOT copy it to new chapter', () => {
			const fm = '---\ntitle: Test Book\nchapter: 1\n---\n';
			const body = 'Chapter one body text\nMore body text';
			const text = fm + body;
			const offset = fm.length + 'Chapter one '.length;
			const analysis = analyzeSplitContent(text, offset);

			expect(analysis.canSplit).toBe(true);
			expect(analysis.prefix).toBe(fm + 'Chapter one ');
			expect(analysis.suffix).toBe('body text\nMore body text');
			expect(analysis.suffix.includes('title: Test Book')).toBe(false);
			expect(analysis.prefix.startsWith(fm)).toBe(true);
		});

		it('should reject cursor inside frontmatter', () => {
			const text = '---\ntitle: Test\n---\nBody text';
			const analysis = analyzeSplitContent(text, 5); // inside frontmatter
			expect(analysis.canSplit).toBe(false);
			expect(analysis.rejectReason).toBe('frontmatter');
		});

		it('should reject malformed initial frontmatter (unclosed ---)', () => {
			const text = '---\ntitle: Test without end\nBody text starts';
			const analysis = analyzeSplitContent(text, 30);
			expect(analysis.canSplit).toBe(false);
			expect(analysis.rejectReason).toBe('malformed-frontmatter');
		});

		it('should reject when body prefix is empty or whitespace-only (e.g. at frontmatter boundary or BOF)', () => {
			const fm = '---\ntitle: Test\n---\n';
			const text = fm + '   \n\nBody text';
			const offset = fm.length + 3; // only whitespace before cursor
			const analysis = analyzeSplitContent(text, offset);
			expect(analysis.canSplit).toBe(false);
			expect(analysis.rejectReason).toBe('empty-body');

			const textNoFm = '   Body text';
			const analysisNoFm = analyzeSplitContent(textNoFm, 2);
			expect(analysisNoFm.canSplit).toBe(false);
			expect(analysisNoFm.rejectReason).toBe('empty-body');
		});

		it('should reject when body suffix is empty or whitespace-only (e.g. at EOF)', () => {
			const text = 'Body text here   \n\n';
			const offset = 'Body text here'.length;
			const analysis = analyzeSplitContent(text, offset);
			expect(analysis.canSplit).toBe(false);
			expect(analysis.rejectReason).toBe('empty-body');
		});
	});

	describe('combineTemplateAndSuffix', () => {
		it('should return exact suffix when no template is configured or template is null/undefined', () => {
			const suffix = 'Line 1\nLine 2';
			const res1 = combineTemplateAndSuffix(null, suffix);
			expect(res1.content).toBe(suffix);
			expect(res1.targetCursorPos).toEqual({ line: 0, ch: 0 });

			const res2 = combineTemplateAndSuffix(undefined, suffix);
			expect(res2.content).toBe(suffix);
			expect(res2.targetCursorPos).toEqual({ line: 0, ch: 0 });

			const res3 = combineTemplateAndSuffix('', suffix);
			expect(res3.content).toBe(suffix);
			expect(res3.targetCursorPos).toEqual({ line: 0, ch: 0 });
		});

		it('should preserve template and body, add blank-line separator if template has no trailing newline', () => {
			const template = '---\ntags: [novel]\n---\n# Chapter Template';
			const suffix = 'Chapter split text starts here.';
			const res = combineTemplateAndSuffix(template, suffix);

			expect(res.content).toBe('---\ntags: [novel]\n---\n# Chapter Template\n\nChapter split text starts here.');
			// Cursor should focus the first moved text (not YAML)
			expect(res.targetCursorPos).toEqual({ line: 5, ch: 0 });
		});

		it('should preserve template with 1 trailing newline and add exactly 1 newline separator', () => {
			const template = '---\ntags: [novel]\n---\n';
			const suffix = 'Moved text';
			const res = combineTemplateAndSuffix(template, suffix);

			expect(res.content).toBe('---\ntags: [novel]\n---\n\nMoved text');
			expect(res.targetCursorPos).toEqual({ line: 4, ch: 0 });
		});

		it('should preserve template with 2 trailing newlines without adding extra newlines', () => {
			const template = '---\ntitle: Foo\n---\n\n';
			const suffix = 'Moved body';
			const res = combineTemplateAndSuffix(template, suffix);

			expect(res.content).toBe('---\ntitle: Foo\n---\n\nMoved body');
			expect(res.targetCursorPos).toEqual({ line: 4, ch: 0 });
		});

		it('should never trim template or suffix when 3+ newlines already exist at join', () => {
			const template = 'Template body\n\n\n';
			const suffix = 'Suffix content';
			const res = combineTemplateAndSuffix(template, suffix);

			expect(res.content).toBe('Template body\n\n\nSuffix content');
			expect(res.targetCursorPos).toEqual({ line: 3, ch: 0 });
		});

		it('should handle Windows CRLF properly and preserve line ending style', () => {
			const template = '---\r\ntags: [novel]\r\n---\r\n';
			const suffix = 'Moved text';
			const res = combineTemplateAndSuffix(template, suffix);

			expect(res.content).toBe('---\r\ntags: [novel]\r\n---\r\n\r\nMoved text');
			expect(res.targetCursorPos).toEqual({ line: 4, ch: 0 });
		});

		it('should skip leading newlines in suffix to focus the first line with actual text', () => {
			const template = '---\ntitle: Test\n---\n';
			const suffix = '\n\nParagraph after split';
			const res = combineTemplateAndSuffix(template, suffix);

			expect(res.content).toBe('---\ntitle: Test\n---\n\n\nParagraph after split');
			expect(res.targetCursorPos).toEqual({ line: 5, ch: 0 });
		});
	});

	describe('validateChapterBasename', () => {
		const mockVault = {
			getAbstractFileByPath: vi.fn()
		};
		const mockApp = { vault: mockVault } as unknown as App;
		const folder = createMockFolder('Novel');

		it('should reject empty or whitespace input', () => {
			expect(validateChapterBasename('', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('   ', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('.md', mockApp, folder).valid).toBe(false);
		});

		it('should reject path traversal and path separators', () => {
			expect(validateChapterBasename('.', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('..', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('sub/chapter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('sub\\chapter', mockApp, folder).valid).toBe(false);
		});

		it('should reject invalid filesystem chars, control chars, and trailing dot', () => {
			expect(validateChapterBasename('chap:ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap*ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap?ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap|ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap<ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap"ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chapter.', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap\x00ter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap\x1fter', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('chap\x7fter', mockApp, folder).valid).toBe(false);
		});

		it('should reject Windows reserved device names with or without extensions', () => {
			expect(validateChapterBasename('CON', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('CON.txt', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('aux', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('nul.md', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('prn', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('COM1', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('COM1.foo', mockApp, folder).valid).toBe(false);
			expect(validateChapterBasename('LPT9', mockApp, folder).valid).toBe(false);
		});

		it('should detect collision when target file or folder already exists', () => {
			mockVault.getAbstractFileByPath.mockReturnValueOnce(createMockFile('Novel/第2章.md'));
			const res = validateChapterBasename('第2章', mockApp, folder);
			expect(res.valid).toBe(false);
			expect(res.errorKey).toBe('modal.split-chapter-already-exists');
		});

		it('should detect collision with TFolder at target path', () => {
			mockVault.getAbstractFileByPath.mockReturnValueOnce(createMockFolder('Novel/第2章.md'));
			const res = validateChapterBasename('第2章.md', mockApp, folder);
			expect(res.valid).toBe(false);
			expect(res.errorKey).toBe('modal.split-chapter-already-exists');
		});

		it('should accept valid clean name and strip .md sensibly', () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			const res1 = validateChapterBasename('第2章', mockApp, folder);
			expect(res1.valid).toBe(true);
			expect(res1.basename).toBe('第2章');

			const res2 = validateChapterBasename('第2.5章 序幕.md', mockApp, folder);
			expect(res2.valid).toBe(true);
			expect(res2.basename).toBe('第2.5章 序幕');
		});
	});

	describe('splitChapterAtCursor - Execution & Content Safety', () => {
		let mockApp: MockApp;
		let mockView: MockView;
		let mockEditor: MockEditor;
		let mockLeaf: MockLeaf;
		let sourceFile: TFile;
		let folder: TFolder;

		beforeEach(() => {
			folder = createMockFolder('Novel');
			sourceFile = createMockFile('Novel/第1章.md');
			sourceFile.parent = folder;
			folder.children = [sourceFile];

			const targetEditor: MockTargetEditor = {
				focus: vi.fn(),
				setCursor: vi.fn()
			};
			const targetMarkdownView = Object.create(MarkdownView.prototype) as MockTargetMarkdownView;
			targetMarkdownView.editor = targetEditor;
			targetMarkdownView.file = null;

			mockLeaf = {
				openFile: vi.fn().mockImplementation(async (file: TFile) => {
					targetMarkdownView.file = file;
				}),
				view: targetMarkdownView
			};

			let editorContent = 'First part of chapter\nSecond part of chapter';
			mockEditor = {
				getValue: vi.fn(() => editorContent),
				setValue: vi.fn((val: string) => { editorContent = val; }),
				somethingSelected: vi.fn(() => false),
				listSelections: vi.fn(() => [{ anchor: { line: 0, ch: 10 }, head: { line: 0, ch: 10 } }]),
				getCursor: vi.fn(() => ({ line: 0, ch: 10 })),
				lastLine: vi.fn(() => 1),
				getLine: vi.fn((l: number) => (l === 0 ? 'First part of chapter' : 'Second part of chapter')),
				replaceRange: vi.fn((replacement: string, from?: { line: number; ch: number }, to?: { line: number; ch: number }) => {
					if (!from) {
						editorContent = replacement;
						return;
					}
					const fromOffset = calculateOffset(editorContent, from);
					const toOffset = to ? calculateOffset(editorContent, to) : fromOffset;
					editorContent = editorContent.slice(0, fromOffset) + replacement + editorContent.slice(toOffset);
				})
			};

			mockView = Object.create(MarkdownView.prototype) as MockView;
			mockView.file = sourceFile;
			mockView.editor = mockEditor;
			mockView.leaf = mockLeaf;
			mockView.save = vi.fn().mockResolvedValue(undefined);

			mockApp = {
				vault: {
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					create: vi.fn().mockImplementation(async (path: string) => {
						const created = createMockFile(path);
						return created;
					}),
					read: vi.fn().mockResolvedValue('')
				},
				workspace: {
					getLeaf: vi.fn().mockReturnValue(mockLeaf)
				}
			};
		});

		it('should reject when there is an active text selection', async () => {
			mockEditor.somethingSelected.mockReturnValue(true);

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			expect(mockNoticeMessages).toContain('请将光标置于拆分位置，不支持选中文本或多光标拆分');
			expect(mockApp.vault.create).not.toHaveBeenCalled();
		});

		it('should reject when there are multiple cursors', async () => {
			mockEditor.listSelections.mockReturnValue([
				{ anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 5 } },
				{ anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 5 } }
			]);

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			expect(mockNoticeMessages).toContain('请将光标置于拆分位置，不支持选中文本或多光标拆分');
			expect(mockApp.vault.create).not.toHaveBeenCalled();
		});

		it('should create new target in same folder before cutting source, and navigate cleanly', async () => {
			const refreshSpy = vi.fn();

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings,
				onRefreshExplorer: refreshSpy
			});

			expect(result).toBe(true);
			// Target file created in same folder 'Novel/第2章.md'
			expect(mockApp.vault.create).toHaveBeenCalledWith(
				'Novel/第2章.md',
				' of chapter\nSecond part of chapter'
			);
			// Source suffix removed
			expect(mockEditor.replaceRange).toHaveBeenCalledWith(
				'',
				{ line: 0, ch: 10 },
				{ line: 1, ch: 'Second part of chapter'.length }
			);
			expect(mockEditor.getValue()).toBe('First part');
			// Source saved twice: once before destructive change, once after cut
			expect(mockView.save).toHaveBeenCalledTimes(2);
			// Target opened in leaf
			expect(mockLeaf.openFile).toHaveBeenCalled();
			expect(mockLeaf.view.editor.focus).toHaveBeenCalled();
			expect(mockLeaf.view.editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
			expect(refreshSpy).toHaveBeenCalledTimes(1);
			expect(mockNoticeMessages).toContain('已拆分章节: 第2章');
		});

		it('should handle root-level files correctly without leading slash', async () => {
			const rootFolder = createMockFolder('/');
			const rootFile = createMockFile('第1章.md');
			rootFile.parent = rootFolder;
			rootFolder.children = [rootFile];
			mockView.file = rootFile;

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(true);
			expect(mockApp.vault.create).toHaveBeenCalledWith(
				'第2章.md',
				' of chapter\nSecond part of chapter'
			);
		});

		it('should follow configured template with frontmatter and body, appending moved suffix after body and focusing moved text', async () => {
			const templateFile = createMockFile('Templates/T1.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Templates/T1.md') return templateFile;
				return null;
			});
			mockApp.vault.read.mockResolvedValue('---\ntags: [novel]\nstatus: draft\n---\n# Chapter Template');

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: {
					enableChapterTemplate: true,
					chapterTemplatePaths: ['Templates/T1.md'],
					chapterTemplatePath: 'Templates/T1.md'
				}
			});

			expect(result).toBe(true);
			// Target file created with template frontmatter + body + blank-line separator + suffix
			expect(mockApp.vault.create).toHaveBeenCalledWith(
				'Novel/第2章.md',
				'---\ntags: [novel]\nstatus: draft\n---\n# Chapter Template\n\n of chapter\nSecond part of chapter'
			);
			// Focus first moved text rather than YAML
			expect(mockLeaf.view.editor.focus).toHaveBeenCalled();
			expect(mockLeaf.view.editor.setCursor).toHaveBeenCalledWith({ line: 6, ch: 0 });
		});

		it('should abort split without modifying source if user cancels multi-template picker', async () => {
			const t1 = createMockFile('Templates/T1.md');
			const t2 = createMockFile('Templates/T2.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Templates/T1.md') return t1;
				if (p === 'Templates/T2.md') return t2;
				return null;
			});

			const openSpy = vi.spyOn(TemplateChoiceModal.prototype, 'open').mockImplementation(function (this: TemplateChoiceModalInternal) {
				this.onClose(); // simulate user cancel/close
			});

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: {
					enableChapterTemplate: true,
					chapterTemplatePaths: ['Templates/T1.md', 'Templates/T2.md'],
					chapterTemplatePath: ''
				}
			});

			expect(result).toBe(false);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			openSpy.mockRestore();
		});

		it('should abort split without modifying source if template read fails', async () => {
			const t1 = createMockFile('Templates/T1.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Templates/T1.md') return t1;
				return null;
			});
			mockApp.vault.read.mockRejectedValue(new Error('Permission denied'));

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: {
					enableChapterTemplate: true,
					chapterTemplatePaths: ['Templates/T1.md'],
					chapterTemplatePath: 'Templates/T1.md'
				}
			});

			expect(result).toBe(false);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('创建新章节失败: Error: Permission denied');
		});

		it('should abort safely without modifying source if editor content was modified while template modal was open', async () => {
			const t1 = createMockFile('Templates/T1.md');
			const t2 = createMockFile('Templates/T2.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Templates/T1.md') return t1;
				if (p === 'Templates/T2.md') return t2;
				return null;
			});

			const openSpy = vi.spyOn(TemplateChoiceModal.prototype, 'open').mockImplementation(function (this: TemplateChoiceModalInternal) {
				// User modified document while dialog was open
				mockEditor.getValue.mockReturnValue('Modified document during selection');
				this.onChoose(t1);
				this.close();
			});

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: {
					enableChapterTemplate: true,
					chapterTemplatePaths: ['Templates/T1.md', 'Templates/T2.md'],
					chapterTemplatePath: ''
				}
			});

			expect(result).toBe(false);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('文档已发生变动或已切换，拆分操作已安全取消');
			openSpy.mockRestore();
		});

		it('should trigger collision callback when target already exists and abort on cancel', async () => {
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Novel/第2章.md') return createMockFile('Novel/第2章.md');
				return null;
			});

			const collisionModalMock = vi.fn().mockResolvedValue(null); // User cancels

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings,
				onRequestName: collisionModalMock
			});

			expect(collisionModalMock).toHaveBeenCalledWith('第2章', folder, 'collision');
			expect(result).toBe(false);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		});

		it('should re-validate custom collision name in service and reject reserved device name', async () => {
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Novel/第2章.md') return createMockFile('Novel/第2章.md');
				return null;
			});

			const collisionModalMock = vi.fn().mockResolvedValue('CON.txt');

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings,
				onRequestName: collisionModalMock
			});

			expect(result).toBe(false);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('文件名称不能为系统保留名称');
		});

		it('should accept valid custom name on collision and create that target', async () => {
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Novel/第2章.md') return createMockFile('Novel/第2章.md');
				return null;
			});

			const collisionModalMock = vi.fn().mockResolvedValue('第1.5章 插曲');

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings,
				onRequestName: collisionModalMock
			});

			expect(result).toBe(true);
			expect(mockApp.vault.create).toHaveBeenCalledWith(
				'Novel/第1.5章 插曲.md',
				' of chapter\nSecond part of chapter'
			);
		});

		it('should request a name when the current filename has no recognizable chapter number', async () => {
			sourceFile.basename = '短篇';
			sourceFile.name = '短篇.md';
			const requestName = vi.fn().mockResolvedValue('短篇（下）');

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings,
				onRequestName: requestName
			});

			expect(result).toBe(true);
			expect(requestName).toHaveBeenCalledWith('', folder, 'unrecognized');
			expect(mockApp.vault.create).toHaveBeenCalledWith(
				'Novel/短篇（下）.md',
				' of chapter\nSecond part of chapter'
			);
			expect(mockNoticeMessages).not.toContain('当前文件名无法识别章节号（仅支持数字或汉字），无法自动创建');
		});

		it('should abort and show specific notice if saving source before split fails', async () => {
			mockView.save.mockRejectedValueOnce(new Error('Disk full'));

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			expect(mockApp.vault.create).not.toHaveBeenCalled();
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('拆分章节前保存当前文档失败，请检查磁盘空间和权限');
		});

		it('should leave source completely untouched if target creation fails', async () => {
			mockApp.vault.create.mockRejectedValue(new Error('Disk write failed'));

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('创建新章节失败: Error: Disk write failed');
		});

		it('should abort and NOT cut live content if source content changed during target creation', async () => {
			mockApp.vault.create.mockImplementation(async () => {
				// User typed in the editor concurrently
				mockEditor.getValue.mockReturnValue('First part of chapter MODIFIED');
				return createMockFile('Novel/第2章.md');
			});

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('已创建新章节，但原文档在创建过程中被修改，未截断原文档以防数据丢失');
		});

		it('should abort and NOT cut live content if active view file switched during target creation', async () => {
			mockApp.vault.create.mockImplementation(async () => {
				// User switched to another file
				mockView.file = createMockFile('Novel/Another.md');
				return createMockFile('Novel/第2章.md');
			});

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			expect(mockEditor.replaceRange).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toContain('已创建新章节，但原文档在创建过程中被修改，未截断原文档以防数据丢失');
		});

		it('should restore removed suffix and await recovery save if source save after cut fails', async () => {
			let saveCount = 0;
			mockView.save.mockImplementation(async () => {
				saveCount++;
				if (saveCount === 2) {
					throw new Error('Save failed after cut');
				}
			});

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(false);
			// Cut was called
			expect(mockEditor.replaceRange).toHaveBeenCalledWith(
				'',
				{ line: 0, ch: 10 },
				{ line: 1, ch: 'Second part of chapter'.length }
			);
			// Suffix restoration was called
			expect(mockEditor.replaceRange).toHaveBeenCalledWith(
				' of chapter\nSecond part of chapter',
				{ line: 0, ch: 10 }
			);
			expect(mockEditor.getValue()).toBe('First part of chapter\nSecond part of chapter');
			// Recovery save was awaited (total 3 save attempts: pre-cut, post-cut, and post-restore)
			expect(mockView.save).toHaveBeenCalledTimes(3);
			expect(mockNoticeMessages).toContain('新章节已创建，但保存原文档变动失败，已尽可能恢复原文档内容');
		});

		it('should report split succeeded but open failed if opening target fails', async () => {
			mockLeaf.openFile.mockRejectedValue(new Error('Open failed'));

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(true);
			expect(mockNoticeMessages).toContain('章节拆分成功，但自动打开新章节失败: 第2章');
		});

		it('should not focus or set cursor if active leaf view file does not match newFile after open (open race)', async () => {
			mockLeaf.openFile.mockImplementation(async () => {
				// Simulate view navigation race where leaf opened a different file
				mockLeaf.view.file = createMockFile('Novel/Different.md');
			});

			const result = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(result).toBe(true);
			expect(mockLeaf.view.editor.focus).not.toHaveBeenCalled();
			expect(mockLeaf.view.editor.setCursor).not.toHaveBeenCalled();
		});

		it('should prevent re-entry / simultaneous split operations on the same file', async () => {
			let resolveFirstCreate: () => void;
			const firstCreatePromise = new Promise<void>(res => { resolveFirstCreate = res; });

			mockApp.vault.create.mockImplementationOnce(async () => {
				await firstCreatePromise;
				return createMockFile('Novel/第2章.md');
			});

			// Start first split (hangs at vault.create)
			const split1 = splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			// Start second split on same file immediately
			const split2 = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});

			expect(split2).toBe(false);
			expect(mockNoticeMessages).toContain('该文档正在拆分章节中，请勿重复操作');

			// Let first split finish
			resolveFirstCreate!();
			const result1 = await split1;
			expect(result1).toBe(true);

			// Reset editor content for third split
			mockEditor.getValue.mockReturnValue('First part of chapter\nSecond part of chapter');
			mockEditor.replaceRange.mockClear();

			// After first split finishes, guard is released and next attempt works
			const split3 = await splitChapterAtCursor({
				app: mockApp as unknown as App,
				view: mockView as unknown as MarkdownView,
				editor: mockEditor as unknown as Editor,
				settings: defaultSplitSettings
			});
			expect(split3).toBe(true);
		});
	});

	describe('ChapterSplitCollisionModal - UI & IME Behavior', () => {
		interface MockInputEl {
			focus: ReturnType<typeof vi.fn>;
			addEventListener: (event: string, handler: (e: { key: string; isComposing?: boolean; preventDefault: () => void }) => void) => void;
			triggerKeydown: (event: { key: string; isComposing?: boolean }) => void;
		}

		interface MockTextComponent {
			inputEl: HTMLInputElement;
			setValue: (val: string) => MockTextComponent;
			setPlaceholder: (p: string) => MockTextComponent;
			onChange: (cb: (val: string) => void) => MockTextComponent;
		}

		interface MockButtonComponent {
			isCta?: boolean;
			setButtonText: (t: string) => MockButtonComponent;
			setCta: () => MockButtonComponent;
			onClick: (cb: () => void) => MockButtonComponent;
		}

		let capturedInputEl: MockInputEl;
		let changeCallback: (val: string) => void;
		let cancelCallback: () => void;

		const originalAddButton = Setting.prototype.addButton;
		const settingProto = Setting.prototype as unknown as {
			addText?: (cb: (text: MockTextComponent) => unknown) => Setting;
			addButton: (cb: (btn: MockButtonComponent) => unknown) => Setting;
		};

		beforeEach(() => {
			const listeners: ((e: { key: string; isComposing?: boolean; preventDefault: () => void }) => void)[] = [];
			capturedInputEl = {
				focus: vi.fn(),
				addEventListener: (_event, handler) => {
					listeners.push(handler);
				},
				triggerKeydown: (e) => {
					const eventObj = {
						key: e.key,
						isComposing: e.isComposing,
						preventDefault: vi.fn()
					};
					listeners.forEach((fn) => fn(eventObj));
				}
			};

			settingProto.addText = function (cb) {
				const textComp: MockTextComponent = {
					inputEl: capturedInputEl as unknown as HTMLInputElement,
					setValue: (_v: string) => { return textComp; },
					setPlaceholder: () => textComp,
					onChange: (cbFn) => { changeCallback = cbFn; return textComp; }
				};
				cb(textComp);
				return this as unknown as Setting;
			};
			settingProto.addButton = function (cb) {
				const btnComp: MockButtonComponent = {
					setButtonText: () => btnComp,
					setCta: () => {
						btnComp.isCta = true;
						return btnComp;
					},
					onClick: (cbFn) => {
						if (!btnComp.isCta) {
							cancelCallback = cbFn;
						}
						return btnComp;
					}
				};
				cb(btnComp);
				return this as unknown as Setting;
			};
		});

		afterEach(() => {
			delete settingProto.addText;
			Setting.prototype.addButton = originalAddButton;
		});

		it('should not submit on Enter keydown when event.isComposing is true (IME active)', async () => {
			const app = { vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) } } as unknown as App;
			const folder = createMockFolder('Novel');

			let resolvedValue: string | null | undefined = undefined;
			ChapterSplitCollisionModal.prompt(app, '第2章', folder, 'collision').then((val) => {
				resolvedValue = val;
			});

			// Trigger Enter while composing
			capturedInputEl.triggerKeydown({ key: 'Enter', isComposing: true });

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(resolvedValue).toBeUndefined(); // Did NOT submit
		});

		it('should reject invalid basename on Enter and not resolve', async () => {
			const app = { vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) } } as unknown as App;
			const folder = createMockFolder('Novel');

			let resolvedValue: string | null | undefined = undefined;
			ChapterSplitCollisionModal.prompt(app, '第2章', folder, 'collision').then((val) => {
				resolvedValue = val;
			});

			// User entered Windows reserved device name
			changeCallback('CON.txt');

			capturedInputEl.triggerKeydown({ key: 'Enter', isComposing: false });

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(resolvedValue).toBeUndefined(); // Validation failed, did not resolve
		});

		it('should submit valid basename on Enter when !event.isComposing', async () => {
			const app = { vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) } } as unknown as App;
			const folder = createMockFolder('Novel');

			let resolvedValue: string | null | undefined = undefined;
			ChapterSplitCollisionModal.prompt(app, '第2章', folder, 'collision').then((val) => {
				resolvedValue = val;
			});

			changeCallback('第2.5章 序幕');

			capturedInputEl.triggerKeydown({ key: 'Enter', isComposing: false });

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(resolvedValue).toBe('第2.5章 序幕');
		});

		it('should resolve null on cancel button click', async () => {
			const app = { vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) } } as unknown as App;
			const folder = createMockFolder('Novel');

			let resolvedValue: string | null | undefined = undefined;
			ChapterSplitCollisionModal.prompt(app, '第2章', folder, 'collision').then((val) => {
				resolvedValue = val;
			});

			cancelCallback();

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(resolvedValue).toBeNull();
		});
	});
});
