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
import { createWordCountGutter, type WordCountGutterPlugin } from '../src/editor/WordCountGutter';

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
	it('maps existing marker positions through document changes before the debounced recount', () => {
		const plugin: WordCountGutterPlugin = {
			settings: {
				enableWordCountGutter: true,
				wordCountInterval: 1,
				wordCountMethod: 'standard'
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
