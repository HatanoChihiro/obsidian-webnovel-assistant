import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingStickyNote } from '../src/ui/StickyNote';
import type { App } from 'obsidian';
import type { StickyNoteState } from '../src/types/settings';

interface ComponentSpy {
	load: ReturnType<typeof vi.fn>;
	unload: ReturnType<typeof vi.fn>;
}

const { componentInstances, markdownRender, MockComponent, mockSetIcon } = vi.hoisted(() => {
	const instances: ComponentSpy[] = [];
	class TestComponent {
		load = vi.fn();
		unload = vi.fn();
		constructor() {
			instances.push(this);
		}
	}
	return {
		componentInstances: instances,
		markdownRender: vi.fn(),
		MockComponent: TestComponent,
		mockSetIcon: vi.fn((el: HTMLElement, icon: string) => {
			(el as unknown as TestElement).setAttribute('data-icon', icon);
		})
	};
});

class TestElement {
	children: TestElement[] = [];
	parentElement: TestElement | null = null;
	value = '';
	private readonly classes = new Set<string>();
	private readonly attributes = new Map<string, string>();

	get classList() {
		return {
			add: (...tokens: string[]) => { tokens.forEach(t => this.classes.add(t)); },
			remove: (...tokens: string[]) => { tokens.forEach(t => this.classes.delete(t)); },
			contains: (token: string) => this.classes.has(token),
			toggle: (token: string, force?: boolean) => {
				const has = force !== undefined ? force : !this.classes.has(token);
				if (has) this.classes.add(token); else this.classes.delete(token);
				return has;
			}
		};
	}

	addClass(...classes: string[]): void {
		classes.forEach(cls => this.classes.add(cls));
	}

	removeClass(...classes: string[]): void {
		classes.forEach(cls => this.classes.delete(cls));
	}

	hasClass(cls: string): boolean {
		return this.classes.has(cls);
	}

	setAttribute(k: string, v: string): void {
		this.attributes.set(k, v);
	}

	getAttribute(k: string): string | null {
		return this.attributes.get(k) ?? null;
	}

	setCssStyles(_styles: Record<string, string>): void {}
	setCssProps(_props: Record<string, string>): void {}
	querySelector(_sel: string): TestElement | null { return null; }

	empty(): void {
		this.children.forEach(child => { child.parentElement = null; });
		this.children = [];
	}

	get firstChild(): TestElement | null {
		return this.children[0] ?? null;
	}

	appendChild(child: TestElement): TestElement {
		if (child.parentElement) {
			child.parentElement.children = child.parentElement.children.filter(item => item !== child);
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	createDiv(): TestElement {
		return this.appendChild(new TestElement());
	}

	remove(): void {
		if (this.parentElement) {
			this.parentElement.children = this.parentElement.children.filter(item => item !== this);
		}
	}
}

vi.mock('obsidian', async () => {
	const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
	return {
		...actual,
		Component: MockComponent,
		MarkdownRenderer: { render: markdownRender },
		setIcon: mockSetIcon
	};
});

vi.mock('../src/utils/softBreakIndent', () => ({
	injectSoftBreakIndentPlaceholders: vi.fn()
}));

interface FloatingNoteHarness {
	app: App;
	plugin: {
		activeNotes: FloatingStickyNote[];
		settings: {
			noteOpacity: number;
			immersive: {
				immersiveNoteFontSize: number;
			};
		};
	};
	state: StickyNoteState;
	contentContainer: HTMLElement;
	textareaEl: HTMLElement & { value: string };
	containerEl: HTMLElement;
	toggleEditBtn: HTMLElement | null;
	readingComponent: ComponentSpy | null;
	contentRenderId: number;
	_isUnloaded: boolean;
	resizeObserver: null;
	resizeTimer: null;
	currentMouseMove: null;
	currentMouseUp: null;
	dragDocument: null;
}

function createHarness(): FloatingStickyNote {
	const toggleEditBtn = new TestElement() as unknown as HTMLElement;
	const harness: FloatingNoteHarness = {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn(),
				read: vi.fn()
			}
		} as unknown as App,
		plugin: {
			activeNotes: [],
			settings: {
				noteOpacity: 0.9,
				immersive: {
					immersiveNoteFontSize: 14
				}
			}
		},
		state: {
			id: 'note-1',
			title: 'Test',
			content: 'first',
			top: '0px',
			left: '0px',
			width: '100px',
			height: '100px',
			color: '#fff',
			isEditing: false
		},
		contentContainer: new TestElement() as unknown as HTMLElement,
		textareaEl: new TestElement() as unknown as HTMLElement & { value: string },
		containerEl: new TestElement() as unknown as HTMLElement,
		toggleEditBtn,
		readingComponent: null,
		contentRenderId: 0,
		_isUnloaded: false,
		resizeObserver: null,
		resizeTimer: null,
		currentMouseMove: null,
		currentMouseUp: null,
		dragDocument: null
	};
	harness.plugin.activeNotes.push(harness as unknown as FloatingStickyNote);
	return Object.assign(Object.create(FloatingStickyNote.prototype), harness) as FloatingStickyNote;
}

describe('FloatingStickyNote render lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		componentInstances.length = 0;
		vi.stubGlobal('activeDocument', { activeElement: null });
		vi.stubGlobal('createDiv', () => new TestElement());
		markdownRender.mockImplementation((_app, text: string, buffer: TestElement) => {
			buffer.createDiv().value = text;
			return Promise.resolve();
		});
	});

	it('unloads the previous reading generation after a replacement succeeds', async () => {
		const note = createHarness();
		await note.renderContent();
		const first = componentInstances[0];

		note.state.content = 'second';
		await note.renderContent();

		expect(first.unload).toHaveBeenCalledTimes(1);
		expect(componentInstances[1].unload).not.toHaveBeenCalled();
	});

	it('unloads the reading generation when switching to editing', async () => {
		const note = createHarness();
		await note.renderContent();
		const reading = componentInstances[0];

		note.state.isEditing = true;
		await note.renderContent();

		expect(reading.unload).toHaveBeenCalledTimes(1);
	});

	it('unloads a stale generation that finishes after a newer render starts', async () => {
		const note = createHarness();
		let finishRender: (() => void) | undefined;
		markdownRender.mockImplementationOnce(() => new Promise<void>(resolve => { finishRender = resolve; }));

		const staleRender = note.renderContent();
		await vi.waitFor(() => expect(componentInstances).toHaveLength(1));
		const staleComponent = componentInstances[0];

		note.state.isEditing = true;
		await note.renderContent();
		finishRender?.();
		await staleRender;

		expect(staleComponent.unload).toHaveBeenCalledTimes(1);
	});

	it('unloads the active reading generation when the note unloads', async () => {
		const note = createHarness();
		await note.renderContent();
		const reading = componentInstances[0];

		note.onunload();

		expect(reading.unload).toHaveBeenCalledTimes(1);
	});

	it('updateFromState switches from reading to editing mode and updates toggle button icon', async () => {
		const note = createHarness();
		await note.renderContent();

		note.updateFromState({ ...note.state, isEditing: true });
		await vi.waitFor(() => expect((note.contentContainer as unknown as TestElement).hasClass('wn-hidden')).toBe(true));

		expect((note.textareaEl as unknown as TestElement).hasClass('wn-show-block')).toBe(true);
		expect((note['toggleEditBtn'] as unknown as TestElement).getAttribute('data-icon')).toBe('eye');
	});

	it('updateFromState switches from editing to reading mode and updates toggle button icon', async () => {
		const note = createHarness();
		note.state.isEditing = true;
		await note.renderContent();

		note.updateFromState({ ...note.state, isEditing: false, content: 'updated markdown' });
		await vi.waitFor(() => expect((note.contentContainer as unknown as TestElement).hasClass('wn-show-block')).toBe(true));

		expect((note.textareaEl as unknown as TestElement).hasClass('wn-hidden')).toBe(true);
		expect((note['toggleEditBtn'] as unknown as TestElement).getAttribute('data-icon')).toBe('pencil');
		expect(markdownRender).toHaveBeenCalledWith(note.app, 'updated markdown', expect.anything(), '', expect.anything());
	});

	it('updateFromState does not overwrite textarea value when focused', () => {
		const note = createHarness();
		note.state.isEditing = true;
		note.textareaEl.value = 'user typing in progress';
		vi.stubGlobal('activeDocument', { activeElement: note.textareaEl });

		note.updateFromState({ ...note.state, isEditing: true, content: 'stale background content' });

		expect(note.textareaEl.value).toBe('user typing in progress');
	});

	it('updateFromState updates textarea value when not focused and mode is unchanged', () => {
		const note = createHarness();
		note.state.isEditing = true;
		note.textareaEl.value = 'old content';
		vi.stubGlobal('activeDocument', { activeElement: null });

		note.updateFromState({ ...note.state, isEditing: true, content: 'new content' });

		expect(note.textareaEl.value).toBe('new content');
	});
});
