import { describe, it, expect } from 'vitest';
import { findMatchState, buildEphemeralState, getMarkdownBodyRange } from '../src/utils/leaf';
import {
	findNormalizedTextRanges,
	findNearestBlockLine,
	highlightPersistentTarget,
	cancelHighlightTracker,
	highlightReadingViewPhrase
} from '../src/utils/preciseTextHighlight';

describe('getMarkdownBodyRange (YAML Frontmatter Scoping)', () => {
	it('should return zero offsets when there is no YAML frontmatter', () => {
		const content = '# Chapter 1\nSome body text here.';
		expect(getMarkdownBodyRange(content)).toEqual({ startOffset: 0, startLine: 0 });
	});

	it('should return body start offset and line when YAML frontmatter is closed with ---', () => {
		const content = '---\ntitle: Test\nauthor: Writer\n---\nBody text begins here.';
		const range = getMarkdownBodyRange(content);
		expect(range.startLine).toBe(4);
		expect(content.substring(range.startOffset)).toBe('Body text begins here.');
	});

	it('should handle UTF-8 BOM and closing ... delimiter', () => {
		const content = '\uFEFF---\ntitle: Test\n...\nBody text begins here.';
		const range = getMarkdownBodyRange(content);
		expect(range.startLine).toBe(3);
		expect(content.substring(range.startOffset)).toBe('Body text begins here.');
	});

	it('should return zero offsets when frontmatter is not closed', () => {
		const content = '---\ntitle: Test\nauthor: Writer\nNo closing delimiter';
		expect(getMarkdownBodyRange(content)).toEqual({ startOffset: 0, startLine: 0 });
	});
});

describe('findMatchState (Source Match Coordinates & Offsets)', () => {
	it('should calculate global absolute offsets and line/ch range for a single-line match', () => {
		const content = 'Hello world\nThis is a target phrase.\nEnding line.';
		const state = findMatchState(content, ['target phrase']);

		expect(state).not.toBeNull();
		expect(state?.targetLine).toBe(1);
		expect(state?.matchStartGlobal).toBe(22);
		expect(state?.matchEndGlobal).toBe(35);
		expect(state?.matchStartLoc).toEqual({ line: 1, ch: 10 });
		expect(state?.matchEndLoc).toEqual({ line: 1, ch: 23 });
		expect(state?.matchText).toBe('target phrase');
		expect(state?.contextPrefix).toBe('Hello world This is a ');
		expect(state?.contextSuffix).toBe('. Ending line.');
		expect(state?.occurrenceIndex).toBe(0);
	});

	it('should prioritize body matches over YAML frontmatter matches', () => {
		const content = '---\ntitle: 徐太太\nauthor: 徐太太\n---\n这是正文第一行。\n这里出现徐太太在喝茶。';
		const state = findMatchState(content, ['徐太太']);

		expect(state).not.toBeNull();
		// Should match the one in body at line 5, not lines 1 or 2 in frontmatter
		expect(state?.targetLine).toBe(5);
		expect(state?.occurrenceIndex).toBe(0);
		expect(state?.contextPrefix).toBe('这是正文第一行。 这里出现');
	});

	it('should calculate precise ranges for multi-line matches across LF and CRLF', () => {
		const contentLF = 'Para 1\nFirst part\nsecond part\nPara 3';
		const stateLF = findMatchState(contentLF, ['part\nsecond']);

		expect(stateLF).not.toBeNull();
		expect(stateLF?.targetLine).toBe(1);
		expect(stateLF?.matchStartLoc).toEqual({ line: 1, ch: 6 });
		expect(stateLF?.matchEndLoc).toEqual({ line: 2, ch: 6 });
		expect(stateLF?.matchStartGlobal).toBe(13);
		expect(stateLF?.matchEndGlobal).toBe(24);

		const contentCRLF = 'Para 1\r\nFirst part\r\nsecond part\r\nPara 3';
		const stateCRLF = findMatchState(contentCRLF, ['part\r\nsecond']);

		expect(stateCRLF).not.toBeNull();
		expect(stateCRLF?.targetLine).toBe(1);
		expect(stateCRLF?.matchStartLoc).toEqual({ line: 1, ch: 6 });
		expect(stateCRLF?.matchEndLoc).toEqual({ line: 2, ch: 6 });
	});

	it('should prioritize earlier search candidates and fallback when first is missing', () => {
		const content = '# Chapter Title\n\nSome paragraph text discussing lore.';
		const state1 = findMatchState(content, ['# Chapter Title', 'Chapter Title', 'lore']);
		expect(state1?.matchText).toBe('# Chapter Title');
		expect(state1?.targetLine).toBe(0);

		const state2 = findMatchState(content, ['non-existent phrase', 'paragraph text']);
		expect(state2?.matchText).toBe('paragraph text');
		expect(state2?.targetLine).toBe(2);
	});

	it('should perform prefix fallback for long search queries (>20 chars) with slight variations at end', () => {
		const content = 'Line 1\nThis is a very long paragraph that has a slight variation at the end\nLine 3';
		const query = 'This is a very long paragraph that has a completely different ending text';
		const state = findMatchState(content, [query]);

		expect(state).not.toBeNull();
		expect(state?.targetLine).toBe(1);
	});

	it('should disambiguate repeated keywords using preferredOffset', () => {
		const content = 'First instance of keyword here.\nMiddle line with keyword here.\nLast line with keyword here.';
		const firstIdx = content.indexOf('keyword');
		const secondIdx = content.indexOf('keyword', firstIdx + 1);
		const thirdIdx = content.lastIndexOf('keyword');

		expect(firstIdx).toBe(18);
		expect(secondIdx).toBe(49);
		expect(thirdIdx).toBe(78);

		// Without preferredOffset -> picks first match
		const firstMatch = findMatchState(content, ['keyword']);
		expect(firstMatch?.matchStartGlobal).toBe(firstIdx);
		expect(firstMatch?.targetLine).toBe(0);

		// With preferredOffset pointing to second occurrence
		const secondMatch = findMatchState(content, ['keyword'], secondIdx);
		expect(secondMatch?.matchStartGlobal).toBe(secondIdx);
		expect(secondMatch?.targetLine).toBe(1);

		// With preferredOffset pointing to third occurrence
		const thirdMatch = findMatchState(content, ['keyword'], thirdIdx);
		expect(thirdMatch?.matchStartGlobal).toBe(thirdIdx);
		expect(thirdMatch?.targetLine).toBe(2);

		// With slightly shifted preferredOffset (e.g. content modified slightly around second occurrence)
		const shiftedMatch = findMatchState(content, ['keyword'], secondIdx + 3);
		expect(shiftedMatch?.matchStartGlobal).toBe(secondIdx);
		expect(shiftedMatch?.targetLine).toBe(1);
	});

	it('should return null when no candidates match or input is empty', () => {
		const content = 'Simple content';
		expect(findMatchState(content, ['not found'])).toBeNull();
		expect(findMatchState(content, [undefined, '   ', ''])).toBeNull();
	});
});

describe('findNormalizedTextRanges (Whitespace & Multi-Node Text Matching)', () => {
	it('should find exact ranges within a single text segment', () => {
		const texts = ['Hello world!'];
		const ranges = findNormalizedTextRanges(texts, 'world');

		expect(ranges).toEqual([
			{ nodeIndex: 0, startOffset: 6, endOffset: 11 }
		]);
	});

	it('should find exact ranges spanning across multiple text segments', () => {
		const texts = ['Hello ', 'beautiful ', 'world!'];
		const ranges = findNormalizedTextRanges(texts, 'beautiful world');

		expect(ranges).toEqual([
			{ nodeIndex: 1, startOffset: 0, endOffset: 10 },
			{ nodeIndex: 2, startOffset: 0, endOffset: 5 }
		]);
	});

	it('should match across soft-breaks and collapsed whitespace', () => {
		const texts = ['First paragraph line\n', '   second   line with   spaces'];
		const ranges = findNormalizedTextRanges(texts, 'line second line');

		expect(ranges.length).toBe(2);
		expect(ranges[0].nodeIndex).toBe(0);
		expect(ranges[1].nodeIndex).toBe(1);
	});

	it('should match case-insensitively and return empty array if not found', () => {
		const texts = ['Case Sensitive Text'];
		const ranges = findNormalizedTextRanges(texts, 'sensitive');
		expect(ranges).toEqual([
			{ nodeIndex: 0, startOffset: 5, endOffset: 14 }
		]);

		const notFound = findNormalizedTextRanges(texts, 'missing word');
		expect(notFound).toEqual([]);
	});

	it('should accurately pick the right occurrence when preferredCharOffset is provided', () => {
		const texts = ['徐太太在前面。', '徐太太在中间。', '徐太太在后面。'];
		const rangeFirst = findNormalizedTextRanges(texts, '徐太太', 0);
		expect(rangeFirst).toEqual([{ nodeIndex: 0, startOffset: 0, endOffset: 3 }]);

		const rangeSecond = findNormalizedTextRanges(texts, '徐太太', 8);
		expect(rangeSecond).toEqual([{ nodeIndex: 1, startOffset: 0, endOffset: 3 }]);

		const rangeThird = findNormalizedTextRanges(texts, '徐太太', 16);
		expect(rangeThird).toEqual([{ nodeIndex: 2, startOffset: 0, endOffset: 3 }]);
	});

	it('should accurately disambiguate repeated keywords using context and occurrenceIndex', () => {
		const texts = [
			'大太太说道：你好。',
			'徐太太在喝茶。',
			'流苏看着徐太太，低声说话。',
			'门外走进来徐太太，手里拿着包。'
		];

		// Disambiguate with occurrenceIndex
		const match0 = findNormalizedTextRanges(texts, '徐太太', { occurrenceIndex: 0 });
		expect(match0).toEqual([{ nodeIndex: 1, startOffset: 0, endOffset: 3 }]);

		const match1 = findNormalizedTextRanges(texts, '徐太太', { occurrenceIndex: 1 });
		expect(match1).toEqual([{ nodeIndex: 2, startOffset: 4, endOffset: 7 }]);

		const match2 = findNormalizedTextRanges(texts, '徐太太', { occurrenceIndex: 2 });
		expect(match2).toEqual([{ nodeIndex: 3, startOffset: 5, endOffset: 8 }]);

		// Disambiguate with contextPrefix / contextSuffix (even if raw offsets shifted drastically)
		const matchByContext = findNormalizedTextRanges(texts, '徐太太', {
			contextPrefix: '流苏看着',
			contextSuffix: '，低声说话',
			preferredCharOffset: 9999 // Shifted raw offset should NOT mislead context matching
		});
		expect(matchByContext).toEqual([{ nodeIndex: 2, startOffset: 4, endOffset: 7 }]);
	});
});

describe('findNearestBlockLine (Rendered Block Selection for Target Soft Lines)', () => {
	const blockLines = [0, 5, 12, 20];

	it('should pick exact block line when targetLine is a block start', () => {
		expect(findNearestBlockLine(blockLines, 0)).toBe(0);
		expect(findNearestBlockLine(blockLines, 5)).toBe(5);
		expect(findNearestBlockLine(blockLines, 12)).toBe(12);
	});

	it('should pick paragraph start block line when targetLine is a soft line inside the paragraph', () => {
		// Lines 6, 7, 8, 11 are inside paragraph starting at line 5
		expect(findNearestBlockLine(blockLines, 6)).toBe(5);
		expect(findNearestBlockLine(blockLines, 8)).toBe(5);
		expect(findNearestBlockLine(blockLines, 11)).toBe(5);

		// Line 15 is inside paragraph starting at line 12
		expect(findNearestBlockLine(blockLines, 15)).toBe(12);
	});

	it('should return null if targetLine precedes all block lines or line list is empty', () => {
		expect(findNearestBlockLine(blockLines, -1)).toBeNull();
		expect(findNearestBlockLine([], 5)).toBeNull();
	});
});

describe('buildEphemeralState (Exact Match vs Fallback eState Payload)', () => {
	it('should build cursor and match payload without line when matchState is present', () => {
		const content = 'Line 0\nTarget phrase in line 1\nLine 2';
		const matchState = findMatchState(content, ['Target phrase']);

		expect(matchState).not.toBeNull();
		const eState = buildEphemeralState(matchState, undefined, content);

		// Must NOT contain line to prevent Obsidian from forcing full-line highlight
		expect(eState).not.toHaveProperty('line');
		expect(eState).toEqual({
			cursor: {
				from: { line: 1, ch: 0 },
				to: { line: 1, ch: 13 }
			},
			match: {
				content: content,
				matches: [[7, 20]]
			}
		});
	});

	it('should only build a line payload for an explicit fallback, including line zero', () => {
		const eStateFallback = buildEphemeralState(null, 10, 'content');
		expect(eStateFallback).toEqual({ line: 10 });

		const eStateFirstLine = buildEphemeralState(null, 0, 'content');
		expect(eStateFirstLine).toEqual({ line: 0 });

		const eStateDefault = buildEphemeralState(null, undefined, 'content');
		expect(eStateDefault).toBeNull();
	});
});

describe('highlightPersistentTarget & cancelHighlightTracker (Persistent Selection Lifecycle)', () => {
	function createMockElement() {
		const classSet = new Set<string>();
		const el = {
			classList: {
				add: (...cls: string[]) => cls.forEach(c => classSet.add(c)),
				remove: (...cls: string[]) => cls.forEach(c => classSet.delete(c)),
				contains: (c: string) => classSet.has(c)
			},
			scrollIntoView: () => {},
			ownerDocument: {
				defaultView: {
					clearTimeout: () => {},
					setTimeout: () => 1
				} as unknown as Window
			}
		} as unknown as HTMLElement;
		return { el, classSet };
	}

	it('should add is-flashing and remove it when cancelHighlightTracker is invoked', () => {
		const container = {} as Element;
		const { el, classSet } = createMockElement();

		const success = highlightPersistentTarget(container, el);
		expect(success).toBe(true);
		expect(classSet.has('is-flashing')).toBe(true);
		expect(classSet.has('is-active')).toBe(false);

		// Clean up tracker
		cancelHighlightTracker(container);
		expect(classSet.has('is-flashing')).toBe(false);
	});

	it('should clean up previous target when a new persistent target is highlighted', () => {
		const container = {} as Element;
		const { el: el1, classSet: classSet1 } = createMockElement();
		const { el: el2, classSet: classSet2 } = createMockElement();

		highlightPersistentTarget(container, el1);
		expect(classSet1.has('is-flashing')).toBe(true);
		expect(classSet2.has('is-flashing')).toBe(false);

		// Switch selection to target 2
		highlightPersistentTarget(container, el2);
		expect(classSet1.has('is-flashing')).toBe(false);
		expect(classSet2.has('is-flashing')).toBe(true);

		// Clean up
		cancelHighlightTracker(container);
		expect(classSet2.has('is-flashing')).toBe(false);
	});
});

describe('highlightReadingViewPhrase (Direct Target Block & Container Fallback Wrapping)', () => {
	it('should return false when target text is not found anywhere', () => {
		const doc = {
			defaultView: {
				NodeFilter: { SHOW_TEXT: 4 },
				clearTimeout: () => {},
				setTimeout: () => 1
			} as unknown as Window,
			createTreeWalker: () => ({
				nextNode: () => null
			})
		};
		const container = {
			ownerDocument: doc as unknown as Document,
			querySelectorAll: () => [],
			querySelector: () => null
		} as unknown as Element;

		const result = highlightReadingViewPhrase(container, 0, ['target word']);
		expect(result).toBe(false);
	});

	it('should wrap exact block and call scrollIntoView once', () => {
		let scrollCalls = 0;
		const blockClasses = new Set<string>();
		let exactSpan: unknown = null;

		const textNode = {
			nodeType: 3,
			data: 'target word',
			parentNode: null as unknown,
			parentElement: null as unknown,
			splitText: function(offset: number) { return this; },
			length: 11
		};

		const blockEl = {
			nodeType: 1,
			classList: {
				contains: (c: string) => blockClasses.has(c),
				remove: (c: string) => { blockClasses.delete(c); },
				add: (c: string) => { blockClasses.add(c); }
			},
			getAttribute: (attr: string) => (attr === 'data-line' ? '0' : null),
			querySelector: (sel: string) => (
				sel === '.wn-exact-highlight' || sel === '.wn-exact-highlight.is-flashing' ? exactSpan : null
			),
			createSpan: () => {
				exactSpan = {
					classList: { contains: () => true },
					scrollIntoView: () => { scrollCalls++; },
					appendChild: () => {}
				};
				return exactSpan;
			},
			insertBefore: () => {},
			removeChild: () => {}
		};
		textNode.parentNode = blockEl;
		textNode.parentElement = blockEl;

		const doc = {
			defaultView: {
				NodeFilter: { SHOW_TEXT: 4 },
			} as unknown as Window,
			createTreeWalker: () => {
				let yielded = false;
				return {
					nextNode: () => {
						if (!yielded) {
							yielded = true;
							return textNode as unknown as Text;
						}
						return null;
					}
				};
			}
		} as unknown as Document;

		const container = {
			ownerDocument: doc,
			querySelectorAll: (sel: string) => (sel === '[data-line]' ? [blockEl] : []) as unknown as NodeListOf<Element>,
			querySelector: (sel: string) => (sel.includes('.wn-exact-highlight') ? exactSpan : null) as unknown as Element,
		} as unknown as Element;

		const success = highlightReadingViewPhrase(container, 0, ['target word']);

		expect(success).toBe(true);
		expect(scrollCalls).toBe(1);
	});

	it('should fall back to scanning the container if targetBlock does not contain the phrase', () => {
		let scrollCalls = 0;
		let exactSpan: unknown = null;

		const textNodeInContainer = {
			nodeType: 3,
			data: 'fallback phrase found in container',
			parentNode: null as unknown,
			parentElement: null as unknown,
			splitText: function(offset: number) { return this; },
			length: 35
		};

		const emptyBlockEl = {
			nodeType: 1,
			getAttribute: (attr: string) => (attr === 'data-line' ? '5' : null),
			classList: { contains: () => false, add: () => {}, remove: () => {} }
		};

		const containerSpanParent = {
			createSpan: () => {
				exactSpan = {
					classList: { contains: () => true },
					scrollIntoView: () => { scrollCalls++; },
					appendChild: () => {}
				};
				return exactSpan;
			},
			insertBefore: () => {},
			removeChild: () => {}
		};
		textNodeInContainer.parentNode = containerSpanParent;
		textNodeInContainer.parentElement = containerSpanParent as never;

		let treeWalkerTarget: unknown = null;
		const doc = {
			defaultView: {
				NodeFilter: { SHOW_TEXT: 4 },
			} as unknown as Window,
			createTreeWalker: (_root: unknown) => {
				treeWalkerTarget = _root;
				let yielded = false;
				return {
					nextNode: () => {
						// Only yield textNode if root is container, not emptyBlockEl
						if (treeWalkerTarget !== emptyBlockEl && !yielded) {
							yielded = true;
							return textNodeInContainer as unknown as Text;
						}
						return null;
					}
				};
			}
		} as unknown as Document;

		const container = {
			ownerDocument: doc,
			querySelectorAll: (sel: string) => (sel === '[data-line]' ? [emptyBlockEl] : []) as unknown as NodeListOf<Element>,
			querySelector: (sel: string) => (sel.includes('.wn-exact-highlight') ? exactSpan : null) as unknown as Element,
		} as unknown as Element;

		const success = highlightReadingViewPhrase(container, 5, ['fallback phrase']);
		expect(success).toBe(true);
		expect(scrollCalls).toBe(1);
	});
});
