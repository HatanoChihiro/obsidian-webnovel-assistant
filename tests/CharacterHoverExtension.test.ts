import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import type { App, TFile } from 'obsidian';
import { buildCharacterHoverExtension, type CharacterHoverPlugin } from '../src/editor/CharacterHoverExtension';
import { compileReferencePlan, matchChapterReferences } from '../src/services/ChapterReferenceService';
import { buildChapterReferenceExtension } from '../src/editor/ChapterReferenceExtension';
import type { ChapterReferenceItem } from '../src/types/reference';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { ForeshadowingStatus } from '../src/types/foreshadowing';

vi.mock('obsidian', () => ({ Component: class {}, TFile: class {}, MarkdownView: class {}, editorInfoField: Symbol('editorInfo'), Platform: { isMobile: false } }));
const loreHoverMock = vi.fn();
const closeLoreMock = vi.fn();
const referencePopoverMock = vi.hoisted(() => ({ open: vi.fn(), hide: vi.fn() }));
vi.mock('../src/ui/LoreHoverPopover', () => ({
	LoreHoverPopover: class {
		static closeAll(): void {}
		static closeForDocument(document: Document): void { closeLoreMock(document); }
		constructor(...args: unknown[]) {
			loreHoverMock(...args);
		}
	}
}));
vi.mock('../src/ui/ChapterReferencePopover', () => ({ ChapterReferencePopover: class {
	constructor(...args: unknown[]) { referencePopoverMock.open(...args); }
	hide(): void { referencePopoverMock.hide(); }
} }));

describe('character highlight cache', () => {
	it('does not repeatedly compare long quote suffixes when compiling the match plan', () => {
		const quote = 'a'.repeat(2000) + 'b';
		let comparedCharacters = 0;
		const original = String.prototype.startsWith;
		const startsWith = vi.spyOn(String.prototype, 'startsWith').mockImplementation(function (this: string, value: string, position?: number) {
			if (String(this) === quote && (comparedCharacters += value.length) > quote.length * 4) {
				throw new Error('Quote plan compilation exceeded a linear prefix comparison budget');
			}
			return original.call(this, value, position);
		});
		try {
			expect(compileReferencePlan([{ id: 'record', type: 'timeline', quote, description: '', sourceFile: { path: 'Book/Timeline.md' } as TFile }]).entries).toHaveLength(1);
		} finally {
			startsWith.mockRestore();
		}
	});

	it.each([0, 150000, 299000])('bounds quote search to the visible neighborhood at offset %i', from => {
		const text = 'fictional-text '.repeat(22000);
		const references: ChapterReferenceItem[] = Array.from({ length: 100 }, (_, index) => ({
			id: String(index), type: 'timeline', quote: 'missingQuote' + index,
			description: '', sourceFile: { path: 'Book/Timeline.md' } as TFile,
		}));
		const originalExec = RegExp.prototype.exec;
		const originalIndexOf = String.prototype.indexOf;
		const exec = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, value: string) {
			if (this.source.includes('missingQuote') && value.length > 5000) throw new Error('Quote regex searched beyond the visible neighborhood');
			return originalExec.call(this, value);
		});
		const indexOf = vi.spyOn(String.prototype, 'indexOf').mockImplementation(function (this: string, value: string, position?: number) {
			if (value.includes('missingQuote') && String(this).length > 5000) throw new Error('Quote search searched beyond the visible neighborhood');
			return originalIndexOf.call(this, value, position);
		});
		try {
			expect(matchChapterReferences(text, references, [{ from, to: from + 800 }])).toEqual([]);
		} finally {
			exec.mockRestore();
			indexOf.mockRestore();
		}
	});

	it('matches complete multiline and repeated quotes, merges overlaps and ignores edited originals', () => {
		const file = { path: 'Book/Timeline.md' } as TFile;
		const references: ChapterReferenceItem[] = [
			{ id: 'a', type: 'timeline', quote: 'alpha beta', description: 'First event', sourceFile: file },
			{ id: 'b', type: 'timeline', quote: 'beta gamma', description: 'Second event', sourceFile: file },
			{ id: 'c', type: 'foreshadowing', kind: 'creation', status: ForeshadowingStatus.Pending, tags: [], quote: 'alpha beta', description: 'A clue', sourceFile: file },
			{ id: 'empty', type: 'timeline', quote: ' ', description: '', sourceFile: file }
		];
		const text = 'alpha\n  beta gamma\nalpha beta';
		const clusters = matchChapterReferences(text, references);
		expect(clusters).toHaveLength(2);
		expect(clusters[0]).toMatchObject({ from: 0, to: 18 });
		expect(clusters[0].items.map(item => item.id)).toEqual(['a', 'c', 'b']);
		expect(clusters[1].items.map(item => item.id)).toEqual(['a', 'c']);
		expect(matchChapterReferences('alpha changed beta', references)).toEqual([]);
		expect(matchChapterReferences('a.b[x]', [{ ...references[0], quote: 'a.b[x]' }])).toHaveLength(1);
	});

	it('preserves crossing matches through long whitespace and repeated quote alignment', () => {
		const sourceFile = { path: 'Book/Timeline.md' } as TFile;
		const quote: ChapterReferenceItem = { id: 'spaced', type: 'timeline', quote: 'start end', description: '', sourceFile };
		const spaced = 'prefix start' + '\n '.repeat(6000) + 'end suffix';
		expect(matchChapterReferences(spaced, [quote], [{ from: 6000, to: 6010 }])).toMatchObject([{ from: 7, to: 12015 }]);
		const repeated = { ...quote, quote: 'aaa' };
		expect(matchChapterReferences('a'.repeat(100000), [repeated], [{ from: 99997, to: 99998 }]))
			.toMatchObject([{ from: 99996, to: 99999 }]);
	});

	it('does not repeatedly flatten an unchanged document while scrolling', () => {
		const file = { path: 'Book/chapter.md' } as TFile;
		const references: ChapterReferenceItem[] = [{ id: 'record', type: 'timeline', quote: 'quote', description: '', sourceFile: file }];
		const service = { onRefresh: () => vi.fn(), isAnyReferenceEnabled: () => true, getReferencesSync: () => references };
		const extension = buildChapterReferenceExtension({ workspace: {} } as App, { chapterReferenceService: service } as unknown as WebNovelAssistantPlugin) as unknown as {
			create(view: EditorView): { update(update: ViewUpdate): void; destroy(): void };
		};
		const doc = EditorState.create({ doc: 'fictional quote '.repeat(2000) }).doc;
		const flatten = vi.spyOn(doc, 'toString');
		const viewData = { state: { doc, field: () => ({ file }) }, visibleRanges: [{ from: 0, to: 500 }], dispatch: vi.fn() };
		const view = viewData as unknown as EditorView;
		const instance = extension.create(view);
		try {
			for (let index = 1; index <= 20; index++) {
				viewData.visibleRanges = [{ from: index * 100, to: index * 100 + 500 }];
				instance.update({ view, transactions: [], viewportChanged: true } as unknown as ViewUpdate);
			}
			expect(flatten.mock.calls.length).toBeLessThanOrEqual(1);
		} finally {
			instance.destroy();
			flatten.mockRestore();
		}
	});

	it('renders long cross-viewport references without refetching during typing, and clears on disable', () => {
		const file = { path: 'Book/chapter.md' } as TFile;
		const quote = 'Q'.repeat(2500);
		const text = 'prefix ' + quote + ' suffix';
		let enabled = true;
		let refresh: (() => void) | undefined;
		const unsubscribe = vi.fn();
		const service = {
			onRefresh: vi.fn((callback: () => void) => { refresh = callback; return unsubscribe; }),
			isAnyReferenceEnabled: () => enabled,
			getReferencesSync: vi.fn(() => [{ id: 'long', type: 'timeline', quote, description: 'Long quote', sourceFile: file }]),
			prefetchReferences: vi.fn()
		};
		const plugin = { chapterReferenceService: service } as unknown as WebNovelAssistantPlugin;
		const extension = buildChapterReferenceExtension({ workspace: {} } as App, plugin) as unknown as {
			create(view: EditorView): { decorations: DecorationSet; normalizedDoc: unknown; quotePlan: unknown; update(update: ViewUpdate): void; destroy(): void };
		};
		let instance: ReturnType<typeof extension.create>;
		const view = {
			state: { doc: EditorState.create({ doc: text }).doc, field: () => ({ file }) },
			visibleRanges: [{ from: 1000, to: 1100 }],
			dispatch: vi.fn((spec: { effects: import('@codemirror/state').StateEffect<null> }) => {
				instance.update({ view, transactions: [{ effects: [spec.effects] }] } as unknown as ViewUpdate);
			})
		} as unknown as EditorView;
		instance = extension.create(view);
		expect(instance.normalizedDoc).not.toBeNull();
		expect(instance.quotePlan).not.toBeNull();
		let count = 0;
		instance.decorations.between(1000, 1100, (from, to) => { count++; expect(from).toBe(7); expect(to).toBe(2507); });
		expect(count).toBe(1);
		for (let i = 0; i < 20; i++) instance.update({ view, transactions: [], docChanged: true } as unknown as ViewUpdate);
		expect(service.prefetchReferences).not.toHaveBeenCalled();
		enabled = false;
		refresh!();
		expect(instance.decorations.size).toBe(0);
		expect(instance.normalizedDoc).toBeNull();
		expect(instance.quotePlan).toBeNull();
		enabled = true;
		refresh!();
		expect(instance.normalizedDoc).not.toBeNull();
		instance.destroy();
		expect(instance.normalizedDoc).toBeNull();
		expect(instance.quotePlan).toBeNull();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('ignores a late prefetch after the editor is destroyed', async () => {
		const file = { path: 'Book/chapter.md' } as TFile;
		let resolve!: () => void;
		const service = { onRefresh: () => vi.fn(), isAnyReferenceEnabled: () => true, getReferencesSync: () => null,
			prefetchReferences: vi.fn(() => new Promise<void>(done => { resolve = done; })) };
		const extension = buildChapterReferenceExtension({ workspace: {} } as App, { chapterReferenceService: service } as unknown as WebNovelAssistantPlugin) as unknown as {
			create(view: EditorView): { destroy(): void };
		};
		const view = { state: { doc: EditorState.create({ doc: 'quote' }).doc, field: () => ({ file }) }, visibleRanges: [{ from: 0, to: 5 }], dispatch: vi.fn() } as unknown as EditorView;
		const instance = extension.create(view);
		instance.destroy();
		resolve();
		await Promise.resolve();
		expect(view.dispatch).not.toHaveBeenCalled();
	});
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

	it('prioritizes lore hover and click on a lore name inside a reference match', () => {
		loreHoverMock.mockClear();
		const file = { path: 'Book/chapter.md' } as TFile;
		const manager = {
			cacheVersion: 1,
			getBookPathForFile: vi.fn(() => 'Book'),
			getCharactersForBook: vi.fn(() => ['Hero']),
			getCharacterFile: vi.fn(() => ({ name: 'Hero' }))
		};
		const plugin = {
			characterManager: manager,
			settings: { enableLorePopover: true, lorePopoverCollapse: false }
		} as unknown as CharacterHoverPlugin;

		const extension = buildCharacterHoverExtension({ workspace: {} } as App, plugin) as unknown as {
			domEventHandlers: {
				mouseover(e: unknown, view: unknown): void;
				click(e: unknown, view: unknown): void;
				touchstart(e: unknown, view: unknown): void;
				touchend(e: unknown, view: unknown): void;
			};
		};

		// 1. Target inside .wn-reference-match
		const refElement = {
			closest: vi.fn((sel: string) => sel === '.wn-character-match' ? refElement : sel === '.wn-reference-match' ? {} : null),
			getAttribute: vi.fn((attr: string) => attr === 'data-character' ? 'Hero' : 'Book')
		};
		extension.domEventHandlers.mouseover({ target: refElement } as never, {} as never);
		extension.domEventHandlers.click({ target: refElement } as never, {} as never);
		expect(loreHoverMock).toHaveBeenCalledTimes(2);
		const view = {};
		extension.domEventHandlers.touchstart({ target: refElement, touches: [{ clientX: 10, clientY: 10 }] }, view);
		extension.domEventHandlers.touchend({ target: refElement, changedTouches: [{ clientX: 10, clientY: 10 }] }, view);
		expect(loreHoverMock).toHaveBeenCalledTimes(3);

		// 2. Target outside .wn-reference-match
		const normalElement = {
			closest: vi.fn((sel: string) => sel === '.wn-character-match' ? normalElement : null),
			getAttribute: vi.fn((attr: string) => attr === 'data-character' ? 'Hero' : 'Book')
		};
		extension.domEventHandlers.mouseover({ target: normalElement } as never, {} as never);
		expect(loreHoverMock).toHaveBeenCalledTimes(4);
	});

	it.each(['timeline', 'foreshadowing'] as const)('gives lore names priority over %s, while preserving reference access elsewhere and with lore disabled', type => {
		referencePopoverMock.open.mockClear();
		referencePopoverMock.hide.mockClear();
		closeLoreMock.mockClear();
		const file = { path: 'Book/chapter.md' } as TFile;
		const text = 'Hero found a clue';
		const item: ChapterReferenceItem = type === 'timeline'
			? { id: 'event', type, quote: text, description: 'An event', sourceFile: file }
			: { id: 'clue', type, quote: text, description: 'A clue', sourceFile: file, kind: 'creation', status: ForeshadowingStatus.Pending, tags: [] };
		const settings = { enableLorePopover: true };
		const service = { onRefresh: () => vi.fn(), isAnyReferenceEnabled: () => true, getReferencesSync: () => [item] };
		const extension = buildChapterReferenceExtension({ workspace: {} } as App, { settings, chapterReferenceService: service } as unknown as WebNovelAssistantPlugin) as unknown as {
			create(view: EditorView): { destroy(): void };
			domEventHandlers: {
				mouseover(event: unknown, view: EditorView): void;
				click(event: unknown, view: EditorView): void;
				touchstart(event: unknown, view: EditorView): void;
				touchmove(event: unknown, view: EditorView): void;
				touchend(event: unknown, view: EditorView): void;
			};
		};
		let instance: ReturnType<typeof extension.create>;
		const view = { state: { doc: EditorState.create({ doc: text }).doc, field: () => ({ file }) },
			visibleRanges: [{ from: 0, to: text.length }], plugin: () => instance } as unknown as EditorView;
		instance = extension.create(view);
		const ownerDocument = { getSelection: () => ({ isCollapsed: true }) };
		const referenceTarget = { ownerDocument, getAttribute: () => `0:${text.length}`,
			closest: (selector: string): unknown => selector === '.wn-reference-match' ? referenceTarget : null };
		const loreTarget = { ownerDocument,
			closest: (selector: string): unknown => selector === '.wn-character-match' ? loreTarget : selector === '.wn-reference-match' ? referenceTarget : null };
		extension.domEventHandlers.mouseover({ target: referenceTarget }, view);
		expect(referencePopoverMock.open).toHaveBeenCalledTimes(1);
		extension.domEventHandlers.mouseover({ target: loreTarget }, view);
		expect(referencePopoverMock.hide).toHaveBeenCalledTimes(1);
		extension.domEventHandlers.click({ target: loreTarget, detail: 1 }, view);
		expect(referencePopoverMock.open).toHaveBeenCalledTimes(1);
		expect(closeLoreMock).toHaveBeenCalledTimes(1);
		settings.enableLorePopover = false;
		extension.domEventHandlers.click({ target: loreTarget, detail: 1 }, view);
		expect(referencePopoverMock.open).toHaveBeenCalledTimes(2);
		const touch = { clientX: 10, clientY: 10 };
		settings.enableLorePopover = true;
		extension.domEventHandlers.touchstart({ target: loreTarget, touches: [touch] }, view);
		extension.domEventHandlers.touchend({ target: loreTarget, changedTouches: [touch] }, view);
		expect(referencePopoverMock.open).toHaveBeenCalledTimes(2);
		expect(referencePopoverMock.hide).toHaveBeenCalledTimes(2);
		settings.enableLorePopover = false;
		extension.domEventHandlers.touchstart({ target: loreTarget, touches: [touch] }, view);
		extension.domEventHandlers.touchend({ target: loreTarget, changedTouches: [touch] }, view);
		expect(referencePopoverMock.open).toHaveBeenCalledTimes(3);
		extension.domEventHandlers.touchstart({ target: referenceTarget, touches: [touch] }, view);
		extension.domEventHandlers.touchmove({ touches: [{ clientX: 50, clientY: 10 }] }, view);
		extension.domEventHandlers.touchend({ target: referenceTarget, changedTouches: [touch] }, view);
		expect(referencePopoverMock.open).toHaveBeenCalledTimes(3);
		instance.destroy();
	});

	it('does not trigger lore popover on click or hover when enableLorePopover is false', () => {
		loreHoverMock.mockClear();
		const manager = {
			cacheVersion: 1,
			getBookPathForFile: vi.fn(() => 'Book'),
			getCharactersForBook: vi.fn(() => ['Hero']),
			getCharacterFile: vi.fn(() => ({ name: 'Hero' }))
		};
		const plugin = {
			characterManager: manager,
			settings: { enableLorePopover: false, lorePopoverCollapse: false }
		} as unknown as CharacterHoverPlugin;

		const extension = buildCharacterHoverExtension({ workspace: {} } as App, plugin) as unknown as {
			domEventHandlers: {
				mouseover(e: unknown, view: unknown): void;
				click(e: unknown, view: unknown): void;
			};
		};

		const normalElement = {
			closest: vi.fn((sel: string) => sel === '.wn-character-match' ? normalElement : null),
			getAttribute: vi.fn((attr: string) => attr === 'data-character' ? 'Hero' : 'Book')
		};
		extension.domEventHandlers.mouseover({ target: normalElement } as never, {} as never);
		extension.domEventHandlers.click({ target: normalElement } as never, {} as never);
		expect(loreHoverMock).not.toHaveBeenCalled();
	});
});
