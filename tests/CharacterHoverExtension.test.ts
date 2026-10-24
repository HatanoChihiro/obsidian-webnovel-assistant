import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import type { App, TFile } from 'obsidian';
import { buildCharacterHoverExtension, type CharacterHoverPlugin } from '../src/editor/CharacterHoverExtension';

vi.mock('obsidian', () => ({ MarkdownView: class {}, editorInfoField: Symbol('editorInfo') }));
vi.mock('../src/ui/LoreHoverPopover', () => ({ LoreHoverPopover: class {} }));

describe('character highlight cache', () => {
	it('refreshes same-size names and book context while reusing names during typing', () => {
		let names = ['OldName'];
		const file = { path: 'Book/chapter.md' } as TFile;
		const manager = {
			cacheVersion: 1,
			getBookPathForFile: vi.fn(() => file.path.split('/')[0]),
			getCharactersForBook: vi.fn(() => names)
		};
		const extension = buildCharacterHoverExtension({ workspace: {} } as App,
			{ characterManager: manager } as unknown as CharacterHoverPlugin) as unknown as {
			create(view: EditorView): { decorations: DecorationSet; update(update: ViewUpdate): void };
		};
		const text = 'OldName NewName Other';
		const view = {
			state: { doc: EditorState.create({ doc: text }).doc, field: () => ({ file }) },
			visibleRanges: [{ from: 0, to: text.length }]
		} as unknown as EditorView;
		const instance = extension.create(view);
		const matches = () => {
			const result: string[] = [];
			instance.decorations.between(0, text.length, (_from, _to, decoration) => {
				result.push(decoration.spec.attributes['data-character'] as string);
			});
			return result;
		};
		expect(matches()).toEqual(['OldName']);
		names = ['NewName'];
		manager.cacheVersion++;
		instance.update({ view } as ViewUpdate);
		expect(matches()).toEqual(['NewName']);
		for (let i = 0; i < 60; i++) instance.update({ view, docChanged: true } as ViewUpdate);
		expect(manager.getCharactersForBook).toHaveBeenCalledTimes(2);
		names = ['Other'];
		file.path = 'OtherBook/chapter.md';
		instance.update({ view } as ViewUpdate);
		expect(matches()).toEqual(['Other']);
		names = [];
		manager.cacheVersion++;
		instance.update({ view } as ViewUpdate);
		expect(matches()).toEqual([]);
		instance.update({ view, viewportChanged: true } as ViewUpdate);
		expect(manager.getCharactersForBook).toHaveBeenCalledTimes(4);
	});
});
