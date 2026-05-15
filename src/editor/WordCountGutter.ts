import { Extension, StateField, RangeSet, RangeSetBuilder, EditorState } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { App, MarkdownView, TFile, editorInfoField } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { ChapterSorter } from '../services/ChapterSorter';

class WordCountMarker extends GutterMarker {
	count: number;

	constructor(count: number) {
		super();
		this.count = count;
	}

	toDOM() {
		const wrapper = document.createElement('div');
		wrapper.className = 'webnovel-word-count-marker-wrapper';
		wrapper.appendChild(document.createTextNode('​'));

		const span = document.createElement('span');
		span.className = 'webnovel-word-count-marker';
		span.textContent = this.count + '字';

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
	} catch (e) {
		return null;
	}
}

function computeMarkers(state: EditorState, plugin: WebNovelAssistantPlugin): RangeSet<WordCountMarker> {
	const builder = new RangeSetBuilder<WordCountMarker>();

	if (!plugin.settings.enableWordCountGutter) return builder.finish();

	const file = getFileFromState(state);
	if (!file || !plugin.isFileInWorkspace(file)) return builder.finish();
	if (plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) return builder.finish();

	const interval = plugin.settings.wordCountInterval || 2000;
	const doc = state.doc;

	let currentTotal = 0;
	let nextTarget = interval;

	for (let i = 1; i <= doc.lines; i++) {
		const lineText = doc.line(i).text;
		const lineCount = plugin.calculateAccurateWords(lineText);
		currentTotal += lineCount;

		if (currentTotal >= nextTarget && lineCount > 0) {
			const reachedTarget = Math.floor(currentTotal / interval) * interval;
			builder.add(doc.line(i).from, doc.line(i).from, new WordCountMarker(reachedTarget));
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
			if (!tr.docChanged) return value;
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
		constructor(view: EditorView) {
			this.updateClass(view);
		}
		update(update: ViewUpdate) {
			this.updateClass(update.view);
		}
		updateClass(view: EditorView) {
			if (!plugin.settings.enableWordCountGutter) {
				view.dom.classList.remove('webnovel-show-gutter');
				return;
			}

			const file = getFileFromView(view);
			const inWorkspace = file && plugin.isFileInWorkspace(file);

			const strictOk = !plugin.settings.enableStrictChapterMode ||
				(file && ChapterSorter.isChapterFile(file.name));

			if (inWorkspace && strictOk) {
				view.dom.classList.add('webnovel-show-gutter');
			} else {
				view.dom.classList.remove('webnovel-show-gutter');
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
	} catch (e) {
		if ((view as any).file) return (view as any).file;
		return null;
	}
}
