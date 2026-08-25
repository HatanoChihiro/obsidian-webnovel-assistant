export type StickyNoteParagraphEditor = HTMLDivElement & { value: string };

export function setStickyNoteEditorContent(editor: HTMLElement, content: string): void {
	editor.empty();
	for (const line of content.split('\n')) {
		const lineEl = editor.createDiv({ cls: 'wn-sticky-note-editor-line' });
		if (line.length > 0) {
			lineEl.appendText(line);
		} else {
			lineEl.addClass('is-empty');
			lineEl.createEl('br');
		}
	}
}

export function getStickyNoteEditorContent(editor: HTMLElement): string {
	const lines = Array.from(editor.children);
	if (lines.length === 0) return editor.textContent ?? '';
	return lines.map(line => line.textContent ?? '').join('\n');
}

function refreshStickyNoteEditorLines(editor: HTMLElement): void {
	const children = Array.from(editor.children);
	if (children.length === 0) {
		setStickyNoteEditorContent(editor, editor.textContent ?? '');
		return;
	}
	for (const child of children) {
		const lineEl = child as HTMLElement;
		lineEl.addClass('wn-sticky-note-editor-line');
		lineEl.toggleClass('is-empty', (lineEl.textContent ?? '').length === 0);
	}
}

export function createStickyNoteParagraphEditor(
	parent: HTMLElement,
	content: string,
	classes: string
): StickyNoteParagraphEditor {
	const editor = parent.createDiv({
		cls: `${classes} wn-sticky-note-paragraph-editor`
	}) as StickyNoteParagraphEditor;
	editor.setAttr('contenteditable', 'plaintext-only');
	editor.setAttr('role', 'textbox');
	editor.setAttr('aria-multiline', 'true');
	editor.setAttr('spellcheck', 'true');
	Object.defineProperty(editor, 'value', {
		configurable: true,
		get: () => getStickyNoteEditorContent(editor),
		set: (value: string) => setStickyNoteEditorContent(editor, value)
	});
	editor.value = content;
	editor.addEventListener('input', () => refreshStickyNoteEditorLines(editor));
	return editor;
}
