import { ViewPlugin, type ViewUpdate, type EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { TypographySettings } from '../types/settings';

export interface TypographyImeIndentFixPluginHost {
	settings: { typography?: Pick<TypographySettings, 'enabled' | 'enableIndent'> };
}

const EXCLUDED_LINE_CLASSES = [
	'HyperMD-header', 'HyperMD-quote', 'HyperMD-listblock', 'HyperMD-list-line',
	'HyperMD-table', 'HyperMD-table-row', 'HyperMD-codeblock',
	'HyperMD-frontmatter', 'cm-embed-block',
];
const BLOCK_PREFIX = /^(?:#{1,6}(?:\s|$)|>|(?:[-*+]|\d+[.)])(?:\s|$)|\||`{3,}|~{3,}|---|!\[\[)/;
const ZERO_INDENT = /^(?:0(?:\.0+)?(?:px|em|rem|%)?)?$/;

/**
 * A paragraph-start IME placeholder can be mistaken for real leading whitespace by
 * Obsidian's hanging-indent measurement, which also counts our ::before spacer.
 * Correct only the resulting inline pixel pair during that composition. CSS cannot
 * override the host's inline styles normally; never rewrite composition text/DOM.
 */
export class TypographyImeIndentFixPlugin {
	private linePos: number | null = null;
	private observer: MutationObserver | null = null;
	private baselineTextIndent = '';
	private baselinePadding = '';

	constructor(readonly view: EditorView, readonly host: TypographyImeIndentFixPluginHost) {
		view.contentDOM.addEventListener('compositionstart', this.start);
		view.contentDOM.addEventListener('compositionend', this.stop);
		view.contentDOM.addEventListener('focusout', this.onFocusOut);
	}

	update(update: ViewUpdate): void {
		if (this.linePos === null) return;
		if (!this.view.hasFocus || !this.isTypographyActive()) {
			this.stop();
			return;
		}
		if (update.docChanged) {
			// Keep the original paragraph start before the inserted IME placeholder.
			const pos = update.changes.mapPos(this.linePos, -1);
			const line = update.state.doc.lineAt(pos);
			if (line.from !== pos || update.state.doc.lineAt(update.state.selection.main.head).from !== pos) {
				this.stop();
				return;
			}
			this.linePos = pos;
		}
		// DOM synchronization happens after ViewPlugin.update; the observer reads it then.
	}

	destroy(): void {
		this.stop();
		this.view.contentDOM.removeEventListener('compositionstart', this.start);
		this.view.contentDOM.removeEventListener('compositionend', this.stop);
		this.view.contentDOM.removeEventListener('focusout', this.onFocusOut);
	}

	private isTypographyActive(): boolean {
		const typography = this.host.settings.typography;
		return Boolean(typography?.enabled && typography.enableIndent
			&& this.view.dom.closest('.workspace-leaf')?.classList.contains('wn-typography-active'));
	}

	private getLineElement(pos: number): HTMLElement | null {
		try {
			const { node, offset } = this.view.domAtPos(pos);
			const target = node === this.view.contentDOM ? node.childNodes[offset] : node;
			if (!target) return null;
			const element = target.nodeType === 1 ? target as HTMLElement : target.parentElement;
			const line = element?.classList.contains('cm-line') ? element : element?.closest<HTMLElement>('.cm-line');
			// Do not infer document lines from visible DOM indices: CM virtualizes lines.
			return line?.parentElement === this.view.contentDOM && this.view.posAtDOM(line) === pos ? line : null;
		} catch {
			return null; // The paragraph may have left the rendered viewport.
		}
	}

	private isExcluded(line: HTMLElement): boolean {
		return EXCLUDED_LINE_CLASSES.some(cls => line.classList.contains(cls));
	}

	private start = (): void => {
		this.stop();
		if (!this.isTypographyActive() || this.view.state.selection.ranges.length !== 1) return;
		const selection = this.view.state.selection.main;
		const line = this.view.state.doc.lineAt(selection.head);
		if (!selection.empty || selection.head !== line.from || !line.length
			|| /^\s/.test(line.text) || BLOCK_PREFIX.test(line.text)) return;

		const element = this.getLineElement(line.from);
		if (!element || this.isExcluded(element)) return;
		const { textIndent, paddingInlineStart } = element.style;
		// Even a matching pair is not ours if it existed before composition started.
		if (!ZERO_INDENT.test(textIndent) || !ZERO_INDENT.test(paddingInlineStart)
			|| element.style.getPropertyPriority('text-indent')
			|| element.style.getPropertyPriority('padding-inline-start')) return;

		const ownerWindow = this.view.dom.ownerDocument.defaultView;
		if (!ownerWindow) return;
		this.linePos = line.from;
		this.baselineTextIndent = textIndent;
		this.baselinePadding = paddingInlineStart;
		this.observer = new ownerWindow.MutationObserver(this.clean);
		this.observer.observe(this.view.contentDOM, {
			subtree: true, childList: true, attributes: true, attributeFilter: ['style'],
		});
	};

	private clean = (): void => {
		if (this.linePos === null) return;
		if (!this.isTypographyActive() || !this.view.hasFocus) {
			this.stop();
			return;
		}
		const line = this.getLineElement(this.linePos);
		if (!line || this.isExcluded(line)) {
			this.stop();
			return;
		}
		const style = line.style;
		const indent = /^-(\d+(?:\.\d+)?)px$/.exec(style.textIndent);
		const padding = /^(\d+(?:\.\d+)?)px$/.exec(style.paddingInlineStart);
		if (!indent || !padding || Number(indent[1]) <= 0
			|| Number(indent[1]) !== Number(padding[1])
			|| style.getPropertyPriority('text-indent')
			|| style.getPropertyPriority('padding-inline-start')) return;

		if (this.baselineTextIndent) style.setProperty('text-indent', this.baselineTextIndent);
		else style.removeProperty('text-indent');
		if (this.baselinePadding) style.setProperty('padding-inline-start', this.baselinePadding);
		else style.removeProperty('padding-inline-start');
		// The observer sees these removals once; the empty/zero pair needs no more writes.
	};

	private onFocusOut = (event: FocusEvent): void => {
		const target = event.relatedTarget;
		if (!target || !this.view.contentDOM.contains(target as Node)) this.stop();
	};

	private stop = (): void => {
		this.observer?.disconnect();
		this.observer = null;
		this.linePos = null;
	};
}

export function createTypographyImeIndentFixExtension(host: TypographyImeIndentFixPluginHost): Extension {
	return ViewPlugin.define(view => new TypographyImeIndentFixPlugin(view, host));
}
