import { Modal, Notice, type App, type Editor, type EditorPosition, type MarkdownView } from 'obsidian';
import { t } from '../i18n';
import { getLoreFrontmatterEnd, scanLoreHeadings } from '../services/LoreOutline';
import { scanFenceLine, type FenceScanState } from '../services/LoreTemplateService';

const headingLevels = [1, 2, 3, 4, 5, 6] as const;
type HeadingLevel = typeof headingLevels[number];

interface HeadingTarget {
	line: number;
	endLine: number;
	prefixLength: number;
	text: string;
	level?: number;
}

const headingPrefix = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;

export function findHeadingTarget(source: string, cursorLine: number): HeadingTarget | undefined {
	const lines = source.split(/\r?\n/);
	const frontmatterEnd = getLoreFrontmatterEnd(lines);
	if (cursorLine <= frontmatterEnd || cursorLine >= lines.length) return undefined;

	const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
	for (let line = frontmatterEnd + 1; line <= cursorLine; line++) {
		const { inFenceBefore, inFenceAfter } = scanFenceLine(lines[line], fence);
		if (line === cursorLine && (inFenceBefore || inFenceAfter)) return undefined;
	}
	if (/^(?: {4,}|\t)\s*\S|^ {0,3}<!--/.test(lines[cursorLine])) return undefined;

	const hasUnderline = (line: number) => /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[line] ?? '');
	const setext = (hasUnderline(cursorLine) || hasUnderline(cursorLine + 1))
		? scanLoreHeadings(lines).find(heading => heading.position.end.line > heading.position.start.line
			&& cursorLine >= heading.position.start.line && cursorLine <= heading.position.end.line) : undefined;
	if (setext) {
		const line = setext.position.start.line;
		return { line, endLine: setext.position.end.line, prefixLength: 0, text: lines[line], level: setext.level };
	}
	const text = lines[cursorLine];
	const prefix = headingPrefix.exec(text);
	return { line: cursorLine, endLine: cursorLine, text, prefixLength: prefix?.[0].length ?? 0, level: prefix?.[1].length };
}

export class HeadingWheelModal extends Modal {
	static show(app: App, editor: Editor, view: MarkdownView): void {
		const source = editor.getValue();
		const selections = editor.listSelections();
		const [selection] = selections;
		const target = selections.length === 1 && selection.anchor.line === selection.head.line
			? findHeadingTarget(source, selection.head.line) : undefined;
		if (!target) {
			new Notice(t('heading-wheel.unavailable'));
			return;
		}
		const file = view.file;
		new HeadingWheelModal(app, target.level, level => {
			if (!file || view.file !== file || view.editor !== editor || editor.getValue() !== source) {
				new Notice(t('heading-wheel.editor-changed'));
				return;
			}
			const content = target.text.slice(target.prefixLength);
			const leftTrim = content.length - content.trimStart().length;
			const prefix = `${'#'.repeat(level)} `;
			const replacement = prefix + content.trimStart();
			const remap = (position: EditorPosition): EditorPosition => ({
				line: target.line,
				ch: position.line !== target.line ? replacement.length
					: Math.min(replacement.length, prefix.length + Math.max(0, position.ch - target.prefixLength - leftTrim)),
			});
			if (target.line !== target.endLine || replacement !== target.text) {
				editor.transaction({
					changes: [{ from: { line: target.line, ch: 0 }, to: { line: target.endLine, ch: editor.getLine(target.endLine).length }, text: replacement }],
					selection: { from: remap(selection.anchor), to: remap(selection.head) },
				});
			}
			editor.focus();
		}).open();
	}

	private constructor(app: App, private readonly currentLevel: number | undefined, private readonly apply: (level: HeadingLevel) => void) {
		super(app);
		this.modalEl.addClass('wn-heading-wheel-modal');
		for (const level of headingLevels) {
			this.scope.register([], String(level), event => {
				if (event.isComposing) return;
				if (!event.repeat) this.choose(level);
				return false;
			});
		}
	}

	override onOpen(): void {
		this.setTitle(t('heading-wheel.title'));
		const wheel = this.contentEl.createDiv('wn-heading-wheel');
		wheel.createDiv({ cls: 'wn-heading-wheel-hint', text: t('heading-wheel.hint') });
		let initialButton: HTMLButtonElement | undefined;
		for (const level of headingLevels) {
			const label = t('heading-wheel.level', { level: String(level) });
			const button = wheel.createEl('button', {
				cls: 'wn-heading-wheel-level', attr: { type: 'button', 'aria-label': label, 'data-level': String(level) },
			});
			button.createSpan({ text: String(level), cls: 'wn-heading-wheel-digit', attr: { 'aria-hidden': 'true' } });
			button.createSpan({ text: '#'.repeat(level), cls: 'wn-heading-wheel-markdown', attr: { 'aria-hidden': 'true' } });
			if (level === this.currentLevel) button.setAttribute('aria-current', 'true');
			if (!initialButton || level === this.currentLevel) initialButton = button;
			button.addEventListener('click', () => this.choose(level));
		}
		initialButton?.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private choose(level: HeadingLevel): void {
		this.shouldRestoreSelection = false;
		this.close();
		this.apply(level);
	}
}
