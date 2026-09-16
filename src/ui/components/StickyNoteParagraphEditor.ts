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

export function setCaretPosition(editor: HTMLElement, charIndex: number): void {
	const doc = editor.ownerDocument;
	const win = doc?.defaultView;
	const sel = win?.getSelection?.();
	if (!doc || !win || !sel) return;

	const clampedIndex = Math.max(0, charIndex);
	const lines = Array.from(editor.children) as HTMLElement[];
	if (lines.length === 0) {
		const range = doc.createRange();
		range.selectNodeContents(editor);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
		return;
	}

	let remaining = clampedIndex;
	let targetLine = lines[lines.length - 1];
	let offsetInLine = (targetLine.textContent ?? '').length;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineLen = (line.textContent ?? '').length;
		if (remaining <= lineLen) {
			targetLine = line;
			offsetInLine = remaining;
			break;
		}
		if (remaining === lineLen + 1 && i < lines.length - 1) {
			targetLine = lines[i + 1];
			offsetInLine = 0;
			break;
		}
		remaining -= (lineLen + 1);
	}

	const range = doc.createRange();
	let targetNode: Node = targetLine;
	let nodeOffset = 0;

	let currentOffset = 0;
	for (let i = 0; i < targetLine.childNodes.length; i++) {
		const node = targetLine.childNodes[i];
		if (node.nodeType === 3) {
			const len = node.nodeValue?.length ?? 0;
			if (currentOffset + len >= offsetInLine) {
				targetNode = node;
				nodeOffset = offsetInLine - currentOffset;
				break;
			}
			currentOffset += len;
		}
	}

	try {
		range.setStart(targetNode, nodeOffset);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
	} catch {
		range.selectNodeContents(targetLine);
		range.collapse(false);
		sel.removeAllRanges();
		sel.addRange(range);
	}
}

export function setupStickyNoteParagraphEditor<T extends HTMLElement>(
	editor: T,
	content?: string
): T & { value: string } {
	editor.addClass('wn-sticky-note-paragraph-editor');
	editor.setAttr('contenteditable', 'plaintext-only');
	editor.setAttr('role', 'textbox');
	editor.setAttr('aria-multiline', 'true');
	editor.setAttr('spellcheck', 'true');
	Object.defineProperty(editor, 'value', {
		configurable: true,
		get: () => getStickyNoteEditorContent(editor),
		set: (value: string) => setStickyNoteEditorContent(editor, value)
	});
	if (content !== undefined) {
		(editor as T & { value: string }).value = content;
	}
	editor.addEventListener('input', () => refreshStickyNoteEditorLines(editor));
	return editor as T & { value: string };
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
