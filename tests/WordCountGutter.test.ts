import { EditorState, StateField, type Extension, type RangeSet } from '@codemirror/state';
import type { GutterMarker } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => {
	const { StateField: MockStateField } = await import('@codemirror/state');
	return {
		editorInfoField: MockStateField.define({
			create: () => ({ file: { path: 'Book/第1章.md' } }),
			update: (value) => value
		})
	};
});

import { editorInfoField } from 'obsidian';
import { createWordCountGutter, forceWordCountGutterUpdate, type WordCountGutterPlugin } from '../src/editor/WordCountGutter';
import { WordCounter } from '../src/services/WordCounter';

function getMarkerPositions(markers: RangeSet<GutterMarker>): number[] {
	const positions: number[] = [];
	const cursor = markers.iter();
	while (cursor.value) {
		positions.push(cursor.from);
		cursor.next();
	}
	return positions;
}

describe('WordCountGutter', () => {
	it('keeps milestone positions and totals equal to a fresh count after incremental and Markdown edits', () => {
		const plugin: WordCountGutterPlugin = {
			settings: { enableWordCountGutter: true, wordCountInterval: 5, wordCountMethod: 'webnovel', includeFootnotes: false },
			cacheManager: { isEligibleForWordCount: () => true },
			wordCounter: new WordCounter()
		};
		const extensions = createWordCountGutter(plugin) as readonly Extension[];
		const markerField = extensions[0] as StateField<RangeSet<GutterMarker>>;
		let state = EditorState.create({ doc: '---\ntitle: 标题\n---\n正文内容\n后续内容\n结束', extensions: [editorInfoField, extensions] });
		for (const insertion of ['追加正文', '更多内容', '\n新增一行', '**强调**', '\n```\n忽略内容\n```']) {
			state = state.update({ changes: { from: state.doc.length, insert: insertion }, effects: forceWordCountGutterUpdate.of(null) }).state;
			const freshExtensions = createWordCountGutter({ ...plugin, wordCounter: new WordCounter() }) as readonly Extension[];
			const freshField = freshExtensions[0] as StateField<RangeSet<GutterMarker>>;
			const fresh = EditorState.create({ doc: state.doc, extensions: [editorInfoField, freshExtensions] });
			expect(getMarkerPositions(state.field(markerField))).toEqual(getMarkerPositions(fresh.field(freshField)));
			const totals = (markers: RangeSet<GutterMarker>) => {
				const counts: number[] = [];
				for (const cursor = markers.iter(); cursor.value; cursor.next()) counts.push((cursor.value as GutterMarker & { count: number }).count);
				return counts;
			};
			expect(totals(state.field(markerField))).toEqual(totals(fresh.field(freshField)));
		}
	});

	it('maps existing marker positions through document changes before the debounced recount', () => {
		const plugin: WordCountGutterPlugin = {
			settings: {
				enableWordCountGutter: true,
				wordCountInterval: 1,
				wordCountMethod: 'standard',
				includeFootnotes: false
			},
			cacheManager: {
				isEligibleForWordCount: vi.fn(() => true)
			},
			wordCounter: {
				calculateWordsPerLine: vi.fn(() => [1, 1])
			}
		};
		const gutterExtensions = createWordCountGutter(plugin) as readonly Extension[];
		const markerField = gutterExtensions[0] as StateField<RangeSet<GutterMarker>>;
		const state = EditorState.create({
			doc: '前文\n里程碑所在行',
			extensions: [editorInfoField, gutterExtensions]
		});

		const transaction = state.update({ changes: { from: 0, insert: '修改' } });

		expect(getMarkerPositions(state.field(markerField))).toEqual([0, 3]);
		expect(getMarkerPositions(transaction.state.field(markerField))).toEqual([0, 5]);
	});
});
