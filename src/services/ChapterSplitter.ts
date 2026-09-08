import { MarkdownView, Notice, TFile, type App, type Editor, type TFolder } from 'obsidian';
import { Logger } from '../utils/Logger';
import { t } from '../i18n';
import { ChapterSorter } from './ChapterSorter';
import { resolveChapterTemplateContent, type ChapterTemplateSettings } from '../utils/template';

const activeFiles = new Set<TFile>();

export interface SplitAnalysis {
	canSplit: boolean;
	rejectReason?: 'frontmatter' | 'malformed-frontmatter' | 'empty-body';
	sourceFm: string;
	bodyPrefix: string;
	bodySuffix: string;
	prefix: string;
	suffix: string;
}

export interface FilenameValidation {
	valid: boolean;
	basename?: string;
	errorKey?: string;
}

import { findBookRoot, type CurrentBookContextPlugin } from '../utils/path';

export interface ChapterSplitOptions {
	app: App;
	view: MarkdownView;
	editor: Editor;
	settings: ChapterTemplateSettings;
	onRequestName?: (
		suggestedName: string,
		folder: TFolder | null,
		reason: 'unrecognized' | 'collision'
	) => Promise<string | null>;
	onRefreshExplorer?: () => void;
	writingJourneyService?: {
		markHandledCreate(path: string): void;
		recordChapterCreated(bookPath: string, path: string, title: string, source?: string): Promise<void>;
	};
	plugin?: CurrentBookContextPlugin;
}

/**
 * Calculates character offset for a 0-indexed line/ch cursor position in text.
 */
export function calculateOffset(text: string, pos: { line: number; ch: number }): number {
	const lines = text.split('\n');
	if (pos.line < 0) return 0;
	if (pos.line >= lines.length) return text.length;
	let offset = 0;
	for (let i = 0; i < pos.line; i++) {
		offset += lines[i].length + 1;
	}
	const currentLine = lines[pos.line];
	const maxCh = currentLine.endsWith('\r') ? Math.max(0, currentLine.length - 1) : currentLine.length;
	const effectiveCh = Math.min(Math.max(0, pos.ch), maxCh);
	return Math.min(offset + effectiveCh, text.length);
}

/**
 * Converts character offset to 0-indexed line and ch in text.
 */
export function calculatePosition(text: string, offset: number): { line: number; ch: number } {
	const clamped = Math.max(0, Math.min(offset, text.length));
	const lines = text.slice(0, clamped).split('\n');
	const line = lines.length - 1;
	const lastLine = lines[line];
	const ch = lastLine.endsWith('\r') ? Math.max(0, lastLine.length - 1) : lastLine.length;
	return { line, ch };
}

/**
 * Pure analyzer for frontmatter boundaries and body split viability.
 */
export function analyzeSplitContent(text: string, cursorOffset: number): SplitAnalysis {
	const hasFmStart = /^---(?:\r?\n|$)/.test(text);
	const fmMatch = /^---\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);

	if (hasFmStart && !fmMatch) {
		return {
			canSplit: false,
			rejectReason: 'malformed-frontmatter',
			sourceFm: '',
			bodyPrefix: '',
			bodySuffix: '',
			prefix: '',
			suffix: ''
		};
	}

	let sourceFm = '';
	let fmEnd = 0;
	if (fmMatch) {
		sourceFm = fmMatch[0];
		fmEnd = sourceFm.length;
		if (cursorOffset < fmEnd) {
			return {
				canSplit: false,
				rejectReason: 'frontmatter',
				sourceFm,
				bodyPrefix: '',
				bodySuffix: '',
				prefix: '',
				suffix: ''
			};
		}
	}

	const bodyPrefix = text.slice(fmEnd, cursorOffset);
	const bodySuffix = text.slice(cursorOffset);

	if (bodyPrefix.trim().length === 0 || bodySuffix.trim().length === 0) {
		return {
			canSplit: false,
			rejectReason: 'empty-body',
			sourceFm,
			bodyPrefix,
			bodySuffix,
			prefix: text.slice(0, cursorOffset),
			suffix: text.slice(cursorOffset)
		};
	}

	return {
		canSplit: true,
		sourceFm,
		bodyPrefix,
		bodySuffix,
		prefix: text.slice(0, cursorOffset),
		suffix: text.slice(cursorOffset)
	};
}

export function countTrailingLineEndings(str: string): number {
	let count = 0;
	let i = str.length;
	while (i > 0) {
		if (str[i - 1] === '\n') {
			count++;
			i--;
			if (i > 0 && str[i - 1] === '\r') {
				i--;
			}
		} else {
			break;
		}
	}
	return count;
}

export function countLeadingLineEndings(str: string): number {
	let count = 0;
	let i = 0;
	while (i < str.length) {
		if (str[i] === '\r' && i + 1 < str.length && str[i + 1] === '\n') {
			count++;
			i += 2;
		} else if (str[i] === '\n') {
			count++;
			i++;
		} else {
			break;
		}
	}
	return count;
}

/**
 * Combines template content and split suffix according to project rules:
 * - No template => exact suffix, cursor at start of moved text.
 * - Template => preserves template including properties/body, adds only necessary blank-line separator
 *   (at least two line endings at join; does not trim either original template or suffix),
 *   appends untouched suffix, and positions cursor at the first moved text.
 */
export function combineTemplateAndSuffix(
	template: string | null | undefined,
	suffix: string
): { content: string; targetCursorPos: { line: number; ch: number } } {
	if (!template) {
		let focusOffset = 0;
		while (focusOffset < suffix.length && (suffix[focusOffset] === '\r' || suffix[focusOffset] === '\n')) {
			focusOffset++;
		}
		return {
			content: suffix,
			targetCursorPos: calculatePosition(suffix, focusOffset)
		};
	}

	const trailing = countTrailingLineEndings(template);
	const leading = countLeadingLineEndings(suffix);
	const total = trailing + leading;
	const needed = Math.max(0, 2 - total);

	const isCrlf = template.includes('\r\n') || suffix.includes('\r\n');
	const newline = isCrlf ? '\r\n' : '\n';
	const separator = newline.repeat(needed);

	const content = template + separator + suffix;
	const movedTextStart = template.length + separator.length;
	let focusOffset = movedTextStart;
	while (focusOffset < content.length && (content[focusOffset] === '\r' || content[focusOffset] === '\n')) {
		focusOffset++;
	}

	return {
		content,
		targetCursorPos: calculatePosition(content, focusOffset)
	};
}

function hasInvalidFilenameChars(name: string): boolean {
	for (let i = 0; i < name.length; i++) {
		const code = name.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return /[:*?"<>|]/.test(name);
}

/**
 * Validates user-entered chapter name against traversal, reserved names, invalid chars and collisions.
 */
export function validateChapterBasename(input: string, app: App, folder: TFolder | null): FilenameValidation {
	let cleanName = input.trim();
	if (!cleanName) {
		return { valid: false, errorKey: 'modal.split-chapter-name-empty' };
	}

	if (cleanName.toLowerCase().endsWith('.md')) {
		cleanName = cleanName.slice(0, -3).trim();
	}

	if (!cleanName) {
		return { valid: false, errorKey: 'modal.split-chapter-name-empty' };
	}

	if (cleanName === '.' || cleanName === '..' || cleanName.includes('/') || cleanName.includes('\\')) {
		return { valid: false, errorKey: 'modal.split-chapter-invalid-chars' };
	}

	if (hasInvalidFilenameChars(cleanName) || cleanName.endsWith('.')) {
		return { valid: false, errorKey: 'modal.split-chapter-invalid-chars' };
	}

	if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(cleanName)) {
		return { valid: false, errorKey: 'modal.split-chapter-reserved-name' };
	}

	const targetPath = folder && !folder.isRoot() ? `${folder.path}/${cleanName}.md` : `${cleanName}.md`;
	const existing = app.vault.getAbstractFileByPath(targetPath);
	if (existing !== null) {
		return { valid: false, errorKey: 'modal.split-chapter-already-exists' };
	}

	return { valid: true, basename: cleanName };
}

/**
 * Core business workflow for splitting a chapter at cursor.
 */
export async function splitChapterAtCursor(options: ChapterSplitOptions): Promise<boolean> {
	const { app, view, editor } = options;

	const initialFile = view.file;
	if (!(initialFile instanceof TFile)) {
		return false;
	}
	const initialFilePath = initialFile.path;

	if (activeFiles.has(initialFile)) {
		new Notice(t('notice.split-chapter-in-progress'));
		return false;
	}

	activeFiles.add(initialFile);
	try {
		if (editor.somethingSelected()) {
			new Notice(t('notice.split-chapter-no-selection'));
			return false;
		}
		const selections = editor.listSelections();
		if (selections.length > 1) {
			new Notice(t('notice.split-chapter-no-selection'));
			return false;
		}
		if (selections.length === 1) {
			const sel = selections[0];
			if (sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch) {
				new Notice(t('notice.split-chapter-no-selection'));
				return false;
			}
		}

		const initialContent = editor.getValue();
		const cursor = editor.getCursor();
		const cursorOffset = calculateOffset(initialContent, cursor);

		const analysis = analyzeSplitContent(initialContent, cursorOffset);
		if (!analysis.canSplit) {
			if (analysis.rejectReason === 'frontmatter' || analysis.rejectReason === 'malformed-frontmatter') {
				new Notice(t('notice.split-chapter-invalid-cursor'));
			} else if (analysis.rejectReason === 'empty-body') {
				new Notice(t('notice.split-chapter-empty-body'));
			}
			return false;
		}

		const folder = initialFile.parent;
		const siblingNames = folder
			? folder.children
				.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
				.map((f) => f.basename)
			: [];

		const folderPath = folder && !folder.isRoot() ? folder.path : '';
		const suggestedFileName = ChapterSorter.getNextChapterName(initialFile.basename, siblingNames);
		let targetBaseName = suggestedFileName
			? (suggestedFileName.endsWith('.md') ? suggestedFileName.slice(0, -3) : suggestedFileName)
			: '';

		if (!targetBaseName) {
			if (!options.onRequestName) {
				return false;
			}
			const chosenName = await options.onRequestName('', folder, 'unrecognized');
			if (!chosenName) {
				return false;
			}
			const validation = validateChapterBasename(chosenName, app, folder);
			if (!validation.valid || !validation.basename) {
				new Notice(t(validation.errorKey ?? 'modal.split-chapter-invalid-chars'));
				return false;
			}
			targetBaseName = validation.basename;
		}

		let targetPath = folderPath ? `${folderPath}/${targetBaseName}.md` : `${targetBaseName}.md`;

		const existingAbstract = app.vault.getAbstractFileByPath(targetPath);
		if (existingAbstract !== null) {
			if (!options.onRequestName) {
				new Notice(t('notice.split-chapter-collision', { name: targetBaseName }));
				return false;
			}
			const chosenName = await options.onRequestName(targetBaseName, folder, 'collision');
			if (!chosenName) {
				return false;
			}
			const validation = validateChapterBasename(chosenName, app, folder);
			if (!validation.valid || !validation.basename) {
				new Notice(t(validation.errorKey ?? 'modal.split-chapter-invalid-chars'));
				return false;
			}
			targetBaseName = validation.basename;
			targetPath = folderPath ? `${folderPath}/${targetBaseName}.md` : `${targetBaseName}.md`;
		}

		if (view.file !== initialFile || view.file.path !== initialFilePath || editor.getValue() !== initialContent) {
			new Notice(t('notice.split-chapter-aborted-stale'));
			return false;
		}

		let templateContent = '';
		try {
			const resolved = await resolveChapterTemplateContent(app, options.settings);
			if (resolved === null) {
				return false;
			}
			templateContent = resolved;
		} catch (templateError) {
			Logger.error('[ChapterSplitter] Failed to resolve chapter template:', templateError);
			new Notice(t('notice.split-chapter-create-failed', { error: String(templateError) }));
			return false;
		}

		if (view.file !== initialFile || view.file.path !== initialFilePath || editor.getValue() !== initialContent) {
			new Notice(t('notice.split-chapter-aborted-stale'));
			return false;
		}

		try {
			await view.save();
		} catch (saveError) {
			Logger.error('[ChapterSplitter] Failed to save source before split:', saveError);
			new Notice(t('notice.split-chapter-save-before-split-failed'));
			return false;
		}

		if (view.file !== initialFile || view.file.path !== initialFilePath || editor.getValue() !== initialContent) {
			new Notice(t('notice.split-chapter-aborted-stale'));
			return false;
		}

		if (app.vault.getAbstractFileByPath(targetPath) !== null) {
			new Notice(t('notice.split-chapter-collision', { name: targetBaseName }));
			return false;
		}

		const combined = combineTemplateAndSuffix(templateContent, analysis.suffix);

		let newFile: TFile;
		try {
			options.writingJourneyService?.markHandledCreate(targetPath);
			newFile = await app.vault.create(targetPath, combined.content);
			if (options.writingJourneyService) {
				const bookRoot = options.plugin ? findBookRoot(app, options.plugin, newFile, true) : '';
				if (bookRoot) {
					try {
						await options.writingJourneyService.recordChapterCreated(bookRoot, targetPath, targetBaseName, 'split');
					} catch (journeyErr) {
						Logger.error('[ChapterSplitter] Failed to record journey chapter split:', journeyErr);
					}
				}
			}
		} catch (createError) {
			Logger.error('[ChapterSplitter] Failed to create target chapter file:', createError);
			new Notice(t('notice.split-chapter-create-failed', { error: String(createError) }));
			return false;
		}

		if (view.file !== initialFile || view.file.path !== initialFilePath || editor.getValue() !== initialContent) {
			new Notice(t('notice.split-chapter-target-created-source-changed'));
			return false;
		}

		const lastLine = editor.lastLine();
		const lastLineLength = editor.getLine(lastLine).length;
		editor.replaceRange('', cursor, { line: lastLine, ch: lastLineLength });

		try {
			await view.save();
		} catch (saveAfterCutError) {
			Logger.error('[ChapterSplitter] Failed to save source after cut:', saveAfterCutError);
			if (view.file === initialFile && view.file.path === initialFilePath && editor.getValue() === analysis.prefix) {
				try {
					editor.replaceRange(analysis.suffix, cursor);
					await view.save();
				} catch (restoreError) {
					Logger.error('[ChapterSplitter] Failed to restore suffix in editor:', restoreError);
				}
			}
			new Notice(t('notice.split-chapter-save-source-failed'));
			return false;
		}

		if (view.file !== initialFile || view.file.path !== initialFilePath || editor.getValue() !== analysis.prefix) {
			new Notice(t('notice.split-chapter-success-no-nav'));
			return true;
		}

		try {
			await view.leaf.openFile(newFile);
			if (view.leaf.view instanceof MarkdownView && view.leaf.view.file === newFile && view.leaf.view.editor) {
				const newEditor = view.leaf.view.editor;
				newEditor.focus();
				newEditor.setCursor(combined.targetCursorPos);
			}
		} catch (openError) {
			Logger.error('[ChapterSplitter] Failed to open new chapter leaf:', openError);
			new Notice(t('notice.split-chapter-open-failed', { name: targetBaseName }));
			return true;
		}

		options.onRefreshExplorer?.();
		new Notice(t('notice.split-chapter-success', { name: targetBaseName }));
		return true;
	} finally {
		activeFiles.delete(initialFile);
	}
}
