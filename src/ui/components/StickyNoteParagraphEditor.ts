export type StickyNoteParagraphEditor = HTMLDivElement & { value: string };

interface EditorListeners {
	beforeinput: (event: Event) => void;
	paste: (event: Event) => void;
	input: (event: Event) => void;
	compositionstart: () => void;
	compositionend: () => void;
}

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

function refreshStickyNoteEditorLines(editor: HTMLElement, isComposing = false): void {
	const children = Array.from(editor.children);
	if (children.length === 0) {
		if (!isComposing) {
			setStickyNoteEditorContent(editor, editor.textContent ?? '');
		}
		return;
	}
	for (const child of children) {
		const lineEl = child as HTMLElement;
		lineEl.addClass('wn-sticky-note-editor-line');
		lineEl.toggleClass('is-empty', (lineEl.textContent ?? '').length === 0);
	}
}

function runNativeEditorCommand(
	editor: HTMLElement,
	commandId: 'insertParagraph' | 'insertText',
	value?: string
): boolean {
	editor.setAttr('contenteditable', 'true');
	try {
		// Legacy native editing is required here to preserve undo for paragraph splits and plain-text paste.
		return editor.ownerDocument.execCommand(commandId, false, value);
	} catch {
		// Leave the original event uncanceled so plain-text input still works if unavailable.
		return false;
	} finally {
		editor.setAttr('contenteditable', 'plaintext-only');
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

const editorListeners = new WeakMap<HTMLElement, EditorListeners>();

function removeEditorListeners(editor: HTMLElement): void {
	const existing = editorListeners.get(editor);
	if (!existing) return;
	editor.removeEventListener('beforeinput', existing.beforeinput);
	editor.removeEventListener('paste', existing.paste);
	editor.removeEventListener('input', existing.input);
	editor.removeEventListener('compositionstart', existing.compositionstart);
	editor.removeEventListener('compositionend', existing.compositionend);
	editorListeners.delete(editor);
}

export function teardownStickyNoteParagraphEditor(editor: HTMLElement): void {
	editor.removeClass('wn-sticky-note-paragraph-editor');
	editor.removeAttribute('contenteditable');
	editor.removeAttribute('role');
	editor.removeAttribute('aria-multiline');
	editor.removeAttribute('spellcheck');
	removeEditorListeners(editor);
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
	removeEditorListeners(editor);
	let isComposing = false;
	const listeners: EditorListeners = {
		beforeinput: (event: Event) => {
			const inputEvent = event as InputEvent;
			if (event.defaultPrevented || event.cancelable === false || isComposing || inputEvent.isComposing) {
				return;
			}
			if (inputEvent.inputType !== 'insertLineBreak' && inputEvent.inputType !== 'insertParagraph') {
				return;
			}
			if (runNativeEditorCommand(editor, 'insertParagraph')) event.preventDefault();
		},
		paste: (event: Event) => {
			const pasteEvent = event as ClipboardEvent;
			if (event.defaultPrevented || event.cancelable === false || isComposing) {
				return;
			}
			const clipboardData = pasteEvent.clipboardData;
			if (!clipboardData || typeof clipboardData.getData !== 'function') {
				return;
			}
			const plainText = clipboardData.getData('text/plain');
			if (runNativeEditorCommand(editor, 'insertText', plainText)) event.preventDefault();
		},
		input: (event: Event) => {
			refreshStickyNoteEditorLines(editor, isComposing || Boolean((event as InputEvent | undefined)?.isComposing));
		},
		compositionstart: () => { isComposing = true; },
		compositionend: () => { isComposing = false; }
	};
	editorListeners.set(editor, listeners);
	editor.addEventListener('beforeinput', listeners.beforeinput);
	editor.addEventListener('paste', listeners.paste);
	editor.addEventListener('input', listeners.input);
	editor.addEventListener('compositionstart', listeners.compositionstart);
	editor.addEventListener('compositionend', listeners.compositionend);
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
	return setupStickyNoteParagraphEditor(editor, content);
}
