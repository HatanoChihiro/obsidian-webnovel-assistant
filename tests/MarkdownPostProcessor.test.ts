import { describe, expect, it } from 'vitest';
import { injectSoftBreakIndentPlaceholders } from '../src/utils/softBreakIndent';

interface FakeNode {
	nodeType: number;
	nodeValue: string | null;
	nextSibling: FakeNode | null;
	parentNode: FakeParent | null;
	classList?: { add: (className: string) => void; contains: (className: string) => boolean };
}

interface FakeParent extends FakeNode {
	children: FakeNode[];
	insertBefore: (node: FakeNode, reference: FakeNode | null) => void;
	querySelectorAll: (selector: string) => FakeNode[];
}

function createElement(): FakeParent {
	const classes = new Set<string>();
	const element: FakeParent = {
		nodeType: 1,
		nodeValue: null,
		nextSibling: null,
		parentNode: null,
		children: [],
		classList: {
			add: className => classes.add(className),
			contains: className => classes.has(className)
		},
		insertBefore: (node, reference) => {
			const index = reference ? element.children.indexOf(reference) : element.children.length;
			element.children.splice(index, 0, node);
			node.parentNode = element;
			for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
				element.children[childIndex].nextSibling = element.children[childIndex + 1] ?? null;
			}
		},
		querySelectorAll: selector => selector === 'br' ? element.children.filter(child => child.nodeType === 1 && child.classList?.contains('br')) : []
	};
	return element;
}

function createFixture() {
	const paragraph = createElement();
	const lineBreak = createElement();
	lineBreak.classList?.add('br');
	const text: FakeNode = { nodeType: 3, nodeValue: '\n  第二行', nextSibling: null, parentNode: paragraph };
	paragraph.children = [lineBreak, text];
	lineBreak.parentNode = paragraph;
	lineBreak.nextSibling = text;

	const root = {
		ownerDocument: {
			win: {
				createSpan: ({ cls }: { cls: string }) => {
					const element = createElement();
					element.classList?.add(cls);
					return element;
				}
			}
		},
		querySelectorAll: (selector: string) => selector === 'p' ? [paragraph] : []
	};
	return { root, paragraph, text };
}

describe('injectSoftBreakIndentPlaceholders', () => {
	it('injects only an indent marker for card rendering and remains idempotent', () => {
		const { root, paragraph, text } = createFixture();
		injectSoftBreakIndentPlaceholders(root as unknown as HTMLElement, false);
		injectSoftBreakIndentPlaceholders(root as unknown as HTMLElement, false);

		expect(paragraph.children).toHaveLength(3);
		expect(paragraph.children[1].classList?.contains('wn-soft-break-indent')).toBe(true);
		expect(text.nodeValue).toBe('第二行');
	});

	it('keeps the reading-mode spacer when requested by the normal postprocessor', () => {
		const { root, paragraph } = createFixture();
		injectSoftBreakIndentPlaceholders(root as unknown as HTMLElement);

		expect(paragraph.children).toHaveLength(4);
		expect(paragraph.children[1].classList?.contains('wn-soft-break-spacer')).toBe(true);
		expect(paragraph.children[2].classList?.contains('wn-soft-break-indent')).toBe(true);
	});
});
