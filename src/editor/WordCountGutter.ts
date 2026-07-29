import type { Extension, RangeSet, EditorState } from '@codemirror/state';
import { StateField, RangeSetBuilder, StateEffect } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { GutterMarker, gutter, ViewPlugin } from '@codemirror/view';
import type { TFile} from 'obsidian';
import { editorInfoField } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

class WordCountMarker extends GutterMarker {
	count: number;

	constructor(count: number) {
		super();
		this.count = count;
	}

	toDOM() {
		const wrapper = createDiv();
		wrapper.className = 'webnovel-word-count-marker-wrapper';
		wrapper.appendChild(activeDocument.createTextNode('​'));

		const span = createSpan();
		span.className = 'webnovel-word-count-marker';
		span.textContent = this.count + t('gutter.word-count');

		wrapper.appendChild(span);
		return wrapper;
	}

	eq(other: WordCountMarker) {
		return this.count === other.count;
	}
}

function getFileFromState(state: EditorState): TFile | null {
	try {
		return state.field(editorInfoField).file || null;
	} catch {
		return null;
	}
}

export const forceWordCountGutterUpdate = StateEffect.define<null>();

function computeMarkers(state: EditorState, plugin: WebNovelAssistantPlugin): RangeSet<WordCountMarker> {
	const builder = new RangeSetBuilder<WordCountMarker>();

	if (!plugin.settings.enableWordCountGutter) return builder.finish();

	const file = getFileFromState(state);
	if (!file || !plugin.cacheManager.isEligibleForWordCount(file)) return builder.finish();

	const interval = plugin.settings.wordCountInterval || 2000;
	const doc = state.doc;
	const docText = doc.toString();

	// 使用全局精确逐行拆解算法（自动切除 Frontmatter 与代码块，消除跨行统计偏差）
	const wordsPerLine = plugin.wordCounter.calculateWordsPerLine(docText, plugin.settings.wordCountMethod);

	let currentTotal = 0;
	let nextTarget = interval;

	for (let i = 1; i <= doc.lines; i++) {
		const lineWords = wordsPerLine[i - 1] || 0;
		currentTotal += lineWords;

		if (currentTotal >= nextTarget && lineWords > 0) {
			const reachedTarget = Math.floor(currentTotal / interval) * interval;
			const line = doc.line(i);
			builder.add(line.from, line.from, new WordCountMarker(reachedTarget));
			nextTarget = reachedTarget + interval;
		}
	}

	return builder.finish();
}

export function createWordCountGutter(plugin: WebNovelAssistantPlugin): Extension {
	const wordCountStateField = StateField.define<RangeSet<WordCountMarker>>({
		create(state) {
			return computeMarkers(state, plugin);
		},
		update(value, tr) {
			let forceUpdate = false;
			for (const e of tr.effects) {
				if (e.is(forceWordCountGutterUpdate)) {
					forceUpdate = true;
				}
			}
			if (!forceUpdate) return value;
			return computeMarkers(tr.state, plugin);
		}
	});

	const wordCountGutter = gutter({
		class: 'webnovel-word-count-gutter',
		markers: (view) => {
			return view.state.field(wordCountStateField);
		}
	});

	const wordCountWorkspacePlugin = ViewPlugin.fromClass(class {
		private debounceTimer: number | null = null;

		constructor(view: EditorView) {
			this.updateClass(view);
		}

		update(update: ViewUpdate) {
			this.updateClass(update.view);

			if (update.docChanged) {
				if (this.debounceTimer !== null) {
					window.clearTimeout(this.debounceTimer);
				}
				this.debounceTimer = window.setTimeout(() => {
					this.debounceTimer = null;
					update.view.dispatch({
						effects: forceWordCountGutterUpdate.of(null)
					});
				}, 150);
			}
		}

		destroy() {
			if (this.debounceTimer !== null) {
				window.clearTimeout(this.debounceTimer);
				this.debounceTimer = null;
			}
		}

		updateClass(view: EditorView) {
			const gutters = view.dom.querySelector('.cm-gutters');
			const isHidden = !plugin.settings.enableWordCountGutter;
			
			if (isHidden) {
				view.dom.classList.remove('webnovel-show-gutter');
			} else {
				const file = getFileFromView(view);

				if (file && plugin.cacheManager.isEligibleForWordCount(file)) {
					view.dom.classList.add('webnovel-show-gutter');
				} else {
					view.dom.classList.remove('webnovel-show-gutter');
				}
			}

			// 手动管理 cm-gutters 的类名以替换 :has()
			if (gutters) {
				const onlyChild = gutters.children.length === 1 && gutters.children[0].classList.contains('webnovel-word-count-gutter');
				if (onlyChild) {
					gutters.classList.add('is-only-word-count-gutter');
					if (!view.dom.classList.contains('webnovel-show-gutter')) {
						gutters.classList.add('is-word-count-gutter-hidden');
					} else {
						gutters.classList.remove('is-word-count-gutter-hidden');
					}
				} else {
					gutters.classList.remove('is-only-word-count-gutter');
					gutters.classList.remove('is-word-count-gutter-hidden');
				}
			}
		}
	});

	return [
		wordCountStateField,
		wordCountGutter,
		wordCountWorkspacePlugin
	];
}

function getFileFromView(view: EditorView): TFile | null {
	try {
		return view.state.field(editorInfoField).file || null;
	} catch {
		const v = view as unknown as { file?: TFile };
		if (v.file) return v.file;
		return null;
	}
}
