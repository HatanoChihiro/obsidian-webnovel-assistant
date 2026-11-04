import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createTypographyImeIndentFixExtension,
	TypographyImeIndentFixPlugin,
	type TypographyImeIndentFixPluginHost,
} from '../src/editor/TypographyImeIndentFixExtension';
import type { EditorView, ViewUpdate } from '@codemirror/view';

interface MockElementStyle {
	textIndent: string;
	paddingInlineStart: string;
	getPropertyValue: (prop: string) => string;
	getPropertyPriority: (prop: string) => string;
	setProperty: (prop: string, val: string) => void;
	removeProperty: (prop: string) => void;
	[key: string]: unknown;
}

interface MockElement {
	nodeType: number;
	tagName: string;
	isConnected: boolean;
	classList: {
		contains: (cls: string) => boolean;
		add: (cls: string) => void;
		remove: (cls: string) => void;
	};
	style: MockElementStyle;
	addEventListener: (event: string, handler: (e?: unknown) => void) => void;
	removeEventListener: (event: string, handler: (e?: unknown) => void) => void;
	dispatchEvent: (event: string, payload?: unknown) => void;
	closest: (sel: string) => MockElement | null;
	childNodes: MockElement[];
	ownerDocument: MockDocument | null;
	parentElement?: MockElement | null;
}

interface MockDocument {
	defaultView: MockWindow;
}

interface MockWindow {
	MutationObserver: typeof MockMutationObserver;
}

class MockMutationObserver {
	callback: (mutations: Array<{ type: string; attributeName?: string; target: unknown }>) => void;
	observedTarget: unknown = null;
	observedOptions: unknown = null;
	disconnected = false;
	static activeInstances: MockMutationObserver[] = [];

	constructor(callback: (mutations: Array<{ type: string; attributeName?: string; target: unknown }>) => void) {
		this.callback = callback;
		MockMutationObserver.activeInstances.push(this);
	}

	observe(target: unknown, options: unknown) {
		this.observedTarget = target;
		this.observedOptions = options;
		this.disconnected = false;
	}

	disconnect() {
		this.observedTarget = null;
		this.observedOptions = null;
		this.disconnected = true;
		const idx = MockMutationObserver.activeInstances.indexOf(this);
		if (idx !== -1) {
			MockMutationObserver.activeInstances.splice(idx, 1);
		}
	}

	trigger(mutations: Array<{ type: string; attributeName?: string; target: unknown }>) {
		if (!this.disconnected) {
			this.callback(mutations);
		}
	}
}

function createMockElement(tag = 'div', initialClasses: string[] = []): MockElement {
	const classSet = new Set<string>(initialClasses);
	const styles = new Map<string, string>();
	const listeners = new Map<string, Array<(e?: unknown) => void>>();

	const el: MockElement = {
		nodeType: 1,
		tagName: tag.toUpperCase(),
		isConnected: true,
		classList: {
			contains: (cls: string) => classSet.has(cls),
			add: (cls: string) => { classSet.add(cls); },
			remove: (cls: string) => { classSet.delete(cls); },
		},
		style: {
			get textIndent() { return styles.get('text-indent') ?? ''; },
			set textIndent(val: string) {
				if (val) styles.set('text-indent', val);
				else styles.delete('text-indent');
			},
			get paddingInlineStart() { return styles.get('padding-inline-start') ?? ''; },
			set paddingInlineStart(val: string) {
				if (val) styles.set('padding-inline-start', val);
				else styles.delete('padding-inline-start');
			},
			getPropertyValue: (prop: string) => styles.get(prop) ?? '',
			getPropertyPriority: () => '',
			setProperty: (prop: string, val: string) => {
				if (val) styles.set(prop, val);
				else styles.delete(prop);
			},
			removeProperty: (prop: string) => {
				styles.delete(prop);
			},
		},
		addEventListener: (event: string, handler: (e?: unknown) => void) => {
			const list = listeners.get(event) ?? [];
			list.push(handler);
			listeners.set(event, list);
		},
		removeEventListener: (event: string, handler: (e?: unknown) => void) => {
			const list = listeners.get(event) ?? [];
			const idx = list.indexOf(handler);
			if (idx !== -1) list.splice(idx, 1);
		},
		dispatchEvent: (event: string, payload?: unknown) => {
			const list = listeners.get(event) ?? [];
			for (const handler of list) handler(payload);
		},
		closest: () => null,
		childNodes: [],
		ownerDocument: null,
	};
	return el;
}

interface TestSetupOptions {
	docText?: string;
	selectionHead?: number;
	selectionAnchor?: number;
	typographyEnabled?: boolean;
	enableIndent?: boolean;
	hasLeafClass?: boolean;
	lineClasses?: string[];
	initialTextIndent?: string;
	initialPaddingInlineStart?: string;
	hasFocus?: boolean;
}

function setupTestEnvironment(options: TestSetupOptions = {}) {
	const {
		docText = '第一章 故事的开端就在这里发生。',
		selectionHead = 0,
		selectionAnchor = 0,
		typographyEnabled = true,
		enableIndent = true,
		hasLeafClass = true,
		lineClasses = [],
		initialTextIndent = '',
		initialPaddingInlineStart = '',
		hasFocus = true,
	} = options;

	const mockWindow: MockWindow = {
		MutationObserver: MockMutationObserver,
	};

	const mockDoc: MockDocument = {
		defaultView: mockWindow,
	};

	const leafEl = createMockElement('div', hasLeafClass ? ['workspace-leaf', 'wn-typography-active'] : ['workspace-leaf']);
	const editorDom = createMockElement('div', ['cm-editor']);
	const contentDOM = createMockElement('div', ['cm-content']);
	editorDom.ownerDocument = mockDoc;
	contentDOM.ownerDocument = mockDoc;

	editorDom.closest = (sel: string) => {
		if (sel === '.workspace-leaf') return leafEl;
		return null;
	};

	const lineEl = createMockElement('div', ['cm-line', ...lineClasses]);
	lineEl.ownerDocument = mockDoc;
	if (initialTextIndent) {
		lineEl.style.setProperty('text-indent', initialTextIndent);
	}
	if (initialPaddingInlineStart) {
		lineEl.style.setProperty('padding-inline-start', initialPaddingInlineStart);
	}

	contentDOM.childNodes.push(lineEl);
	lineEl.parentElement = contentDOM;

	const host: TypographyImeIndentFixPluginHost = {
		settings: {
			typography: {
				enabled: typographyEnabled,
				enableIndent,
			},
		},
	};

	const lines = docText.split('\n');
	const lineStarts: number[] = [];
	let currentOffset = 0;
	for (const l of lines) {
		lineStarts.push(currentOffset);
		currentOffset += l.length + 1; // +1 for newline
	}

	const doc = {
		length: docText.length,
		sliceString: (from: number, to: number) => docText.slice(from, to),
		lineAt: (pos: number) => {
			let lineIndex = 0;
			for (let i = 0; i < lineStarts.length; i++) {
				const start = lineStarts[i];
				const end = start + lines[i].length;
				if (pos >= start && (pos <= end || i === lineStarts.length - 1)) {
					lineIndex = i;
					break;
				}
			}
			return {
				from: lineStarts[lineIndex],
				to: lineStarts[lineIndex] + lines[lineIndex].length,
				number: lineIndex + 1,
				text: lines[lineIndex],
				length: lines[lineIndex].length,
			};
		},
	};

	const state = {
		doc,
		selection: {
			ranges: [{}],
			main: {
				head: selectionHead,
				anchor: selectionAnchor,
				empty: selectionHead === selectionAnchor,
				from: Math.min(selectionHead, selectionAnchor),
				to: Math.max(selectionHead, selectionAnchor),
			},
		},
	};

	const mockView = {
		hasFocus,
		state,
		dom: editorDom as unknown as HTMLElement,
		contentDOM: contentDOM as unknown as HTMLElement,
		posAtDOM: () => state.doc.lineAt(selectionHead).from,
		domAtPos: (_pos: number) => {
			return { node: contentDOM.childNodes[0] as unknown as Node, offset: 0 };
		},
	} as unknown as EditorView;

	return {
		mockView,
		editorDom,
		contentDOM,
		lineEl,
		leafEl,
		host,
		mockWindow,
	};
}

describe('TypographyImeIndentFixExtension regressions', () => {
	beforeEach(() => {
		MockMutationObserver.activeInstances = [];
	});

	it('fails closed when the rendered line cannot be resolved', () => {
		const env = setupTestEnvironment();
		env.mockView.domAtPos = () => { throw new Error('Outside viewport'); };
		const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
		env.contentDOM.dispatchEvent('compositionstart');
		expect(MockMutationObserver.activeInstances).toHaveLength(0);
		plugin.destroy();
	});

	it('does not treat a visible DOM index as a document position', () => {
		const env = setupTestEnvironment();
		env.mockView.posAtDOM = () => 100;
		const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
		env.contentDOM.dispatchEvent('compositionstart');
		expect(MockMutationObserver.activeInstances).toHaveLength(0);
		plugin.destroy();
	});

	it('preserves nonnumeric preexisting inline indentation', () => {
		const env = setupTestEnvironment({ initialPaddingInlineStart: 'var(--custom-indent)' });
		const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
		env.contentDOM.dispatchEvent('compositionstart');
		expect(MockMutationObserver.activeInstances).toHaveLength(0);
		plugin.destroy();
	});

	it('stops before cleaning if typography is disabled during composition', () => {
		const env = setupTestEnvironment();
		const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
		env.contentDOM.dispatchEvent('compositionstart');
		const observer = MockMutationObserver.activeInstances[0];
		env.host.settings.typography!.enabled = false;
		env.lineEl.style.textIndent = '-56px';
		env.lineEl.style.paddingInlineStart = '56px';
		observer.trigger([{ type: 'attributes', attributeName: 'style', target: env.lineEl }]);
		expect(observer.disconnected).toBe(true);
		expect(env.lineEl.style.textIndent).toBe('-56px');
		plugin.destroy();
	});

	it('should create an extension via createTypographyImeIndentFixExtension', () => {
		const env = setupTestEnvironment();
		const extension = createTypographyImeIndentFixExtension(env.host);
		expect(extension).toBeDefined();
	});

	describe('Eligible IME composition pair removal and baseline restoration', () => {
		it('cleans matching negative text-indent and positive padding-inline-start pair during eligible composition', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			// Start IME composition at start of ordinary paragraph
			env.contentDOM.dispatchEvent('compositionstart');

			expect(MockMutationObserver.activeInstances.length).toBe(1);
			const observer = MockMutationObserver.activeInstances[0];

			// Host native hanging indent injects inline styles on the line
			env.lineEl.style.setProperty('text-indent', '-56px');
			env.lineEl.style.setProperty('padding-inline-start', '56px');

			// Trigger mutation record
			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: env.lineEl },
			]);

			// Host inline styles must be cleaned
			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('');
			expect(env.lineEl.style.getPropertyValue('padding-inline-start')).toBe('');

			plugin.destroy();
		});

		it('preserves matching indentation that existed before compositionstart', () => {
			const env = setupTestEnvironment();
			// A preexisting pair can belong to another extension; it is not ours to remove.
			env.lineEl.style.setProperty('text-indent', '-44px');
			env.lineEl.style.setProperty('padding-inline-start', '44px');

			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');

			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('-44px');
			expect(env.lineEl.style.getPropertyValue('padding-inline-start')).toBe('44px');

			plugin.destroy();
		});

		it('restores baseline zero indentation if baseline had 0px', () => {
			const env = setupTestEnvironment({
				initialTextIndent: '0px',
				initialPaddingInlineStart: '0px',
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			const observer = MockMutationObserver.activeInstances[0];

			env.lineEl.style.setProperty('text-indent', '-56px');
			env.lineEl.style.setProperty('padding-inline-start', '56px');

			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: env.lineEl },
			]);

			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('0px');
			expect(env.lineEl.style.getPropertyValue('padding-inline-start')).toBe('0px');

			plugin.destroy();
		});

		it('preserves unrelated styles on the guarded line', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.lineEl.style.setProperty('color', 'red');
			env.lineEl.style.setProperty('line-height', '1.8');
			env.lineEl.style.setProperty('margin-top', '8px');

			env.contentDOM.dispatchEvent('compositionstart');
			const observer = MockMutationObserver.activeInstances[0];

			env.lineEl.style.setProperty('text-indent', '-56px');
			env.lineEl.style.setProperty('padding-inline-start', '56px');

			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: env.lineEl },
			]);

			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('');
			expect(env.lineEl.style.getPropertyValue('padding-inline-start')).toBe('');
			expect(env.lineEl.style.getPropertyValue('color')).toBe('red');
			expect(env.lineEl.style.getPropertyValue('line-height')).toBe('1.8');
			expect(env.lineEl.style.getPropertyValue('margin-top')).toBe('8px');

			plugin.destroy();
		});
	});

	describe('Conservative exclusions & narrow scope', () => {
		it('does not guard if paragraph has real leading whitespace (ASCII space)', () => {
			const env = setupTestEnvironment({
				docText: '   有缩进的段落',
				selectionHead: 0,
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');

			expect(MockMutationObserver.activeInstances.length).toBe(0);

			env.lineEl.style.setProperty('text-indent', '-30px');
			env.lineEl.style.setProperty('padding-inline-start', '30px');
			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('-30px');

			plugin.destroy();
		});

		it('does not guard if paragraph has fullwidth ideographic whitespace (U+3000)', () => {
			const env = setupTestEnvironment({
				docText: '\u3000\u3000全角空格段落',
				selectionHead: 0,
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);

			plugin.destroy();
		});

		it('does not guard if cursor is in middle of paragraph', () => {
			const env = setupTestEnvironment({
				docText: '第一章 故事的开端就在这里发生。',
				selectionHead: 5,
				selectionAnchor: 5,
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);

			plugin.destroy();
		});

		it('does not guard if selection is non-empty', () => {
			const env = setupTestEnvironment({
				docText: '第一章 故事的开端就在这里发生。',
				selectionHead: 3,
				selectionAnchor: 0,
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);

			plugin.destroy();
		});

		it('does not guard empty line', () => {
			const env = setupTestEnvironment({
				docText: '',
				selectionHead: 0,
				selectionAnchor: 0,
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);

			plugin.destroy();
		});

		it('excludes headings (# Heading and .HyperMD-header)', () => {
			const envText = setupTestEnvironment({
				docText: '# 一级标题',
				selectionHead: 0,
			});
			const plugin1 = new TypographyImeIndentFixPlugin(envText.mockView, envText.host);
			envText.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin1.destroy();

			const envClass = setupTestEnvironment({
				docText: '标题文本',
				lineClasses: ['HyperMD-header'],
			});
			const plugin2 = new TypographyImeIndentFixPlugin(envClass.mockView, envClass.host);
			envClass.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin2.destroy();
		});

		it('excludes blockquotes (> quote and .HyperMD-quote)', () => {
			const env = setupTestEnvironment({
				docText: '> 引用内容',
				lineClasses: ['HyperMD-quote'],
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('excludes lists (- list and .HyperMD-listblock)', () => {
			const env = setupTestEnvironment({
				docText: '- 列表项目',
				lineClasses: ['HyperMD-listblock'],
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('excludes tables (| col | and .HyperMD-table)', () => {
			const env = setupTestEnvironment({
				docText: '| 单元格 |',
				lineClasses: ['HyperMD-table'],
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('excludes code fences (``` and .HyperMD-codeblock)', () => {
			const env = setupTestEnvironment({
				docText: '```typescript',
				lineClasses: ['HyperMD-codeblock'],
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('excludes frontmatter (--- and .HyperMD-frontmatter)', () => {
			const env = setupTestEnvironment({
				docText: '---',
				lineClasses: ['HyperMD-frontmatter'],
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('excludes embeds (![[ and .cm-embed-block)', () => {
			const env = setupTestEnvironment({
				docText: '![[嵌入图片.png]]',
				lineClasses: ['cm-embed-block'],
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('excludes when typography is disabled or enableIndent is false', () => {
			const envDisabled = setupTestEnvironment({
				typographyEnabled: false,
			});
			const plugin1 = new TypographyImeIndentFixPlugin(envDisabled.mockView, envDisabled.host);
			envDisabled.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin1.destroy();

			const envIndentOff = setupTestEnvironment({
				enableIndent: false,
			});
			const plugin2 = new TypographyImeIndentFixPlugin(envIndentOff.mockView, envIndentOff.host);
			envIndentOff.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin2.destroy();
		});

		it('excludes when workspace-leaf lacks wn-typography-active', () => {
			const env = setupTestEnvironment({
				hasLeafClass: false,
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			plugin.destroy();
		});

		it('skips lines with preexisting meaningful inline indentation', () => {
			const env = setupTestEnvironment({
				initialTextIndent: '2em',
				initialPaddingInlineStart: '10px',
			});
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);
			env.contentDOM.dispatchEvent('compositionstart');

			// Preexisting meaningful indentation should cause plugin to skip guarding
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('2em');

			plugin.destroy();
		});

		it('ignores non-matching style pairs and non-target lines', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			const observer = MockMutationObserver.activeInstances[0];

			// Mismatched magnitude: -20px vs 50px
			env.lineEl.style.setProperty('text-indent', '-20px');
			env.lineEl.style.setProperty('padding-inline-start', '50px');
			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: env.lineEl },
			]);
			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('-20px');
			expect(env.lineEl.style.getPropertyValue('padding-inline-start')).toBe('50px');

			// Positive text indent: 20px vs 20px
			env.lineEl.style.setProperty('text-indent', '20px');
			env.lineEl.style.setProperty('padding-inline-start', '20px');
			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: env.lineEl },
			]);
			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('20px');

			// Mutation on non-target element
			const anotherLine = createMockElement('div', ['cm-line']);
			anotherLine.style.setProperty('text-indent', '-56px');
			anotherLine.style.setProperty('padding-inline-start', '56px');
			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: anotherLine },
			]);
			expect(anotherLine.style.getPropertyValue('text-indent')).toBe('-56px');

			plugin.destroy();
		});
	});

	describe('Lifecycle, termination & node replacement', () => {
		it('disconnects observer and stops guarding on compositionend', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(1);
			const observer = MockMutationObserver.activeInstances[0];

			// End composition
			env.contentDOM.dispatchEvent('compositionend');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
			expect(observer.disconnected).toBe(true);

			// Subsequent mutation must not be cleaned
			env.lineEl.style.setProperty('text-indent', '-56px');
			env.lineEl.style.setProperty('padding-inline-start', '56px');
			observer.trigger([
				{ type: 'attributes', attributeName: 'style', target: env.lineEl },
			]);
			expect(env.lineEl.style.getPropertyValue('text-indent')).toBe('-56px');

			plugin.destroy();
		});

		it('disconnects observer on focusout when focus leaves the editor', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(1);

			// Focus lost
			(env.mockView as { hasFocus: boolean }).hasFocus = false;
			env.contentDOM.dispatchEvent('focusout', { relatedTarget: null });

			expect(MockMutationObserver.activeInstances.length).toBe(0);

			plugin.destroy();
		});

		it('disconnects observer and event listeners on destroy()', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(1);

			plugin.destroy();
			expect(MockMutationObserver.activeInstances.length).toBe(0);

			// Re-dispatching compositionstart does nothing after destroy
			env.contentDOM.dispatchEvent('compositionstart');
			expect(MockMutationObserver.activeInstances.length).toBe(0);
		});

		it('handles node replacement during composition update and cleans new element', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');
			const observer = MockMutationObserver.activeInstances[0];

			// Disconnect original line element
			env.lineEl.isConnected = false;

			// CM creates a replacement line element
			const newLineEl = createMockElement('div', ['cm-line']);
			newLineEl.ownerDocument = env.lineEl.ownerDocument;
			newLineEl.parentElement = env.contentDOM;
			env.contentDOM.childNodes = [newLineEl];
			newLineEl.style.setProperty('text-indent', '-56px');
			newLineEl.style.setProperty('padding-inline-start', '56px');

			// Trigger childList mutation
			observer.trigger([
				{ type: 'childList', target: env.contentDOM },
			]);

			expect(newLineEl.style.getPropertyValue('text-indent')).toBe('');
			expect(newLineEl.style.getPropertyValue('padding-inline-start')).toBe('');

			plugin.destroy();
		});

		it('handles doc changes and mapped position safely during view update', () => {
			const env = setupTestEnvironment();
			const plugin = new TypographyImeIndentFixPlugin(env.mockView, env.host);

			env.contentDOM.dispatchEvent('compositionstart');

			const mockUpdate: ViewUpdate = {
				view: env.mockView,
				docChanged: true,
				changes: {
					mapPos: vi.fn((pos: number) => pos),
				},
				state: env.mockView.state,
			} as unknown as ViewUpdate;

			plugin.update(mockUpdate);

			expect(mockUpdate.changes.mapPos).toHaveBeenCalled();

			plugin.destroy();
		});
	});
});
