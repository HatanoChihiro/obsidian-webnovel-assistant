import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockMarkdownRender, MockComponent } = vi.hoisted(() => {
	class HoistedMockComponent {
		load = vi.fn();
		unload = vi.fn();
		register = vi.fn();
		registerEvent = vi.fn();
		addChild = vi.fn();
		removeChild = vi.fn();
	}
	return {
		mockMarkdownRender: vi.fn((_app, markdown, container) => {
			const div = container.createDiv ? container.createDiv({ cls: 'rendered-markdown' }) : new MockElement('rendered-markdown');
			div.textContent = markdown;
			return Promise.resolve();
		}),
		MockComponent: HoistedMockComponent
	};
});

vi.mock('obsidian', async () => {
	const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
	return {
		...actual,
		Component: MockComponent,
		setIcon: vi.fn((el: HTMLElement, icon: string) => {
			el.setAttribute('data-icon', icon);
		}),
		MarkdownRenderer: {
			render: mockMarkdownRender
		},
		FuzzySuggestModal: class<T> {
			constructor(_app: unknown) {}
			setPlaceholder(_placeholder: string): void {}
			open(): void {}
		},
		Notice: vi.fn()
	};
});

class MockElement {
	parentElement: MockElement | null = null;
	children: MockElement[] = [];
	className = '';
	textContent = '';
	type = '';
	tabIndex = 0;
	title = '';
	dataset: Record<string, string> = {};
	onclick: ((e: MouseEvent) => void) | null = null;
	private classes = new Set<string>();
	private attributes = new Map<string, string>();
	private listeners = new Map<string, Array<(e?: unknown) => void>>();
	focus = vi.fn();

	constructor(cls = '') {
		this.className = cls;
		if (cls) {
			cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
		}
	}

	get isConnected(): boolean {
		if (this.parentElement) return this.parentElement.isConnected;
		return true;
	}

	get firstChild(): MockElement | null {
		return this.children[0] ?? null;
	}

	get classList() {
		return {
			add: (...tokens: string[]) => {
				tokens.forEach(t => this.classes.add(t));
				this.className = Array.from(this.classes).join(' ');
			},
			remove: (...tokens: string[]) => {
				tokens.forEach(t => this.classes.delete(t));
				this.className = Array.from(this.classes).join(' ');
			},
			contains: (token: string) => this.classes.has(token),
			toggle: (token: string, force?: boolean) => {
				const has = force !== undefined ? force : !this.classes.has(token);
				if (has) this.classes.add(token); else this.classes.delete(token);
				this.className = Array.from(this.classes).join(' ');
				return has;
			}
		};
	}

	addClass(...tokens: string[]) { this.classList.add(...tokens); return this; }
	removeClass(...tokens: string[]) { this.classList.remove(...tokens); return this; }
	toggleClass(token: string, force?: boolean) { return this.classList.toggle(token, force); }
	hasClass(token: string) { return this.classes.has(token); }

	setCssStyles(_styles: Record<string, string>) {}
	setCssProps(_props: Record<string, string>) {}

	empty() {
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children = [];
		this.textContent = '';
	}

	appendChild(child: MockElement) {
		if (child.parentElement) {
			const idx = child.parentElement.children.indexOf(child);
			if (idx !== -1) {
				child.parentElement.children.splice(idx, 1);
			}
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	replaceChild(newChild: MockElement, oldChild: MockElement) {
		const idx = this.children.indexOf(oldChild);
		if (idx !== -1) {
			oldChild.parentElement = null;
			newChild.parentElement = this;
			this.children[idx] = newChild;
		}
		return oldChild;
	}

	createDiv(opts?: string | { cls?: string; text?: string }) {
		const cls = typeof opts === 'string' ? opts : opts?.cls || '';
		const child = new MockElement(cls);
		if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	createSpan(opts?: string | { cls?: string; text?: string }) {
		const cls = typeof opts === 'string' ? opts : opts?.cls || '';
		const child = new MockElement(cls);
		if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	createEl(tag: string, opts?: { cls?: string; text?: string; type?: string }) {
		const cls = opts?.cls || '';
		const child = new MockElement(cls);
		if (opts?.text) child.textContent = opts.text;
		if (opts?.type) child.type = opts.type;
		this.appendChild(child);
		return child;
	}

	appendText(text: string) {
		this.textContent += text;
	}

	setAttr(key: string, val: string) { this.attributes.set(key, val); }
	setAttribute(key: string, val: string) { this.attributes.set(key, val); }
	getAttribute(key: string) { return this.attributes.get(key) ?? null; }

	addEventListener(event: string, fn: (e?: unknown) => void) {
		const arr = this.listeners.get(event) ?? [];
		arr.push(fn);
		this.listeners.set(event, arr);
	}

	dispatchEvent(event: string, e?: unknown) {
		const arr = this.listeners.get(event) ?? [];
		for (const fn of arr) fn(e);
	}

	contains(node: MockElement | null): boolean {
		if (!node) return false;
		if (node === this) return true;
		for (const child of this.children) {
			if (child.contains(node)) return true;
		}
		return false;
	}

	private matchSingle(node: MockElement, sel: string): boolean {
		const token = sel.trim();
		if (!token) return false;
		if (token.startsWith('.')) {
			const classes = token.slice(1).split('.');
			return classes.every(c => node.hasClass(c));
		}
		if (token.startsWith('[data-note-id="') && token.endsWith('"]')) {
			const id = token.slice(15, -2);
			return node.dataset.noteId === id;
		}
		return false;
	}

	querySelector(sel: string): MockElement | null {
		if (sel.includes(',')) {
			const parts = sel.split(',');
			for (const part of parts) {
				const res = this.querySelector(part.trim());
				if (res) return res;
			}
			return null;
		}
		const tokens = sel.trim().split(/\s+/);
		if (tokens.length > 1) {
			let current: MockElement | null = this.querySelector(tokens[0]);
			for (let i = 1; i < tokens.length; i++) {
				if (!current) return null;
				current = current.querySelector(tokens[i]);
			}
			return current;
		}
		const find = (node: MockElement): MockElement | null => {
			for (const c of node.children) {
				if (this.matchSingle(c, tokens[0])) return c;
				const nested = find(c);
				if (nested) return nested;
			}
			return null;
		};
		return find(this);
	}

	querySelectorAll(sel: string): MockElement[] {
		if (sel.includes(',')) {
			const parts = sel.split(',');
			const results: MockElement[] = [];
			for (const part of parts) {
				results.push(...this.querySelectorAll(part.trim()));
			}
			return results;
		}
		const results: MockElement[] = [];
		const token = sel.trim();
		const find = (node: MockElement) => {
			for (const c of node.children) {
				if (this.matchSingle(c, token)) results.push(c);
				find(c);
			}
		};
		find(this);
		return results;
	}

	get ownerDocument() {
		return {
			activeElement: null as MockElement | null,
			createElement: (_tag: string) => new MockElement()
		};
	}
}

Object.assign(globalThis, {
	activeDocument: {
		activeElement: null,
		createElement: (_tag: string) => new MockElement()
	},
	window: globalThis,
	requestAnimationFrame: (cb: () => void) => {
		cb();
		return 0;
	}
});

const fakeEvent = { stopPropagation: () => {} } as unknown as MouseEvent;

import { Component, TFile, type App } from 'obsidian';
import {
	StickyNoteListRenderer,
	getStickyNoteEditorContent,
	getStickyNoteFileCandidates,
	type StickyNoteListRendererPlugin
} from '../src/ui/components/StickyNoteListRenderer';
import type { StickyNoteState } from '../src/types/settings';

function createMockPlugin(initialNotes: StickyNoteState[] = []): {
	plugin: StickyNoteListRendererPlugin;
	notes: StickyNoteState[];
	vaultFiles: Map<string, string>;
} {
	const notes = [...initialNotes];
	const vaultFiles = new Map<string, string>();

	const plugin: StickyNoteListRendererPlugin = {
		settings: {
			nextNoteThemeIndex: 0,
			noteThemes: [
				{ bg: '#FDF3B8', text: '#2C3E50' },
				{ bg: '#D1E7DD', text: '#0F5132' }
			],
			immersive: {
				immersiveNoteFontSize: 14
			},
			stickyNoteAutoSave: true
		},
		stickyNoteManager: {
			getNotes: vi.fn(() => notes),
			updateNote: vi.fn((note: StickyNoteState) => {
				const idx = notes.findIndex(n => n.id === note.id);
				if (idx !== -1) {
					notes[idx] = { ...note };
				} else {
					notes.push({ ...note });
				}
			}),
			saveNotes: vi.fn(async (newNotes: StickyNoteState[]) => {
				const copy = newNotes.map(n => ({ ...n }));
				notes.length = 0;
				notes.push(...copy);
			}),
			removeNoteAndWait: vi.fn(async (id: string) => {
				const idx = notes.findIndex(n => n.id === id);
				if (idx !== -1) notes.splice(idx, 1);
			})
		},
		adaptiveDebounceManager: {
			debounceFixed: vi.fn((_key, fn) => fn())
		},
		getVaultMarkdownFiles: vi.fn(() => []),
		saveSettings: vi.fn(async () => {})
	};

	return { plugin, notes, vaultFiles };
}

function createMockApp(vaultFiles: Map<string, string>) {
	return {
		vault: {
			getAbstractFileByPath: vi.fn((filePath: string) => {
				if (vaultFiles.has(filePath)) {
					const file = new TFile();
					Object.assign(file, { path: filePath, basename: filePath.replace(/\.md$/, '') });
					return file;
				}
				return null;
			}),
			read: vi.fn(async (file: TFile) => vaultFiles.get(file.path) || ''),
			process: vi.fn(async (file: TFile, fn: (data: string) => string) => {
				const prev = vaultFiles.get(file.path) || '';
				const next = fn(prev);
				vaultFiles.set(file.path, next);
				return next;
			}),
			create: vi.fn(async (filePath: string, data: string) => {
				vaultFiles.set(filePath, data);
				const file = new TFile();
				Object.assign(file, { path: filePath, basename: filePath.replace(/\.md$/, '') });
				return file;
			})
		},
		workspace: {
			getActiveFile: vi.fn(() => null)
		}
	} as unknown as App;
}

function asHTMLElement(element: MockElement): HTMLElement {
	return element as unknown as HTMLElement;
}

describe('StickyNoteListRenderer file candidates', () => {
	it('includes non-chapter Markdown files', () => {
		const chapter = Object.assign(new TFile(), { name: '第一章.md', path: '作品/第一章.md' });
		const novelInfo = Object.assign(new TFile(), { name: '作品信息.md', path: '作品/作品信息.md' });
		const plugin = {
			getVaultMarkdownFiles: () => [chapter, novelInfo]
		} as Pick<StickyNoteListRendererPlugin, 'getVaultMarkdownFiles'>;

		expect(getStickyNoteFileCandidates(plugin)).toEqual([chapter, novelInfo]);
	});
});

describe('StickyNoteListRenderer paragraph editor', () => {
	it('preserves line and blank-paragraph boundaries without storing visual indentation', () => {
		const editor = new MockElement();
		const line1 = new MockElement();
		line1.textContent = '第一段';
		const line2 = new MockElement();
		line2.textContent = '';
		const line3 = new MockElement();
		line3.textContent = '第二段';
		editor.appendChild(line1);
		editor.appendChild(line2);
		editor.appendChild(line3);

		expect(getStickyNoteEditorContent(asHTMLElement(editor))).toBe('第一段\n\n第二段');
	});
});

describe('StickyNoteListRenderer Reading & Editing Interactions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders existing notes as Markdown reading cards by default with stripped frontmatter', async () => {
		const rawContent = '---\ntitle: test\n---\n这是正文内容';
		const note: StickyNoteState = {
			id: 'note-1',
			title: '便签1',
			content: rawContent,
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		const { plugin, vaultFiles } = createMockPlugin([note]);
		const app = createMockApp(vaultFiles);
		const container = new MockElement();

		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'side-panel' });
		renderer.render();

		// Check container
		const card = container.querySelector('[data-note-id="note-1"]') as MockElement;
		expect(card).not.toBeNull();

		// Reading content rendered
		const readingEl = card.querySelector('.wn-sticky-note-reading-content') as MockElement;
		expect(readingEl).not.toBeNull();
		expect(card.querySelector('.wn-sticky-note-paragraph-editor')).toBeNull();

		// MarkdownRenderer called with stripped frontmatter
		expect(mockMarkdownRender).toHaveBeenCalledWith(
			app,
			'这是正文内容',
			readingEl,
			'',
			expect.any(Component)
		);

		// Toggle button shows pencil icon in reading mode
		const toggleBtn = card.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		expect(toggleBtn).not.toBeNull();
		expect(toggleBtn.getAttribute('data-icon')).toBe('pencil');
		expect(toggleBtn.getAttribute('aria-label')).toBe('编辑便签');
	});

	it('switches the clicked card between reading and editing mode and updates StickyNoteState.isEditing', async () => {
		const note1: StickyNoteState = {
			id: 'note-1',
			title: '便签1',
			content: '便签1内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};
		const note2: StickyNoteState = {
			id: 'note-2',
			title: '便签2',
			content: '便签2内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#D1E7DD',
			isEditing: false
		};

		const { plugin, notes, vaultFiles } = createMockPlugin([note1, note2]);
		const app = createMockApp(vaultFiles);
		const container = new MockElement();

		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'side-panel' });
		renderer.render();

		const card1 = container.querySelector('[data-note-id="note-1"]') as MockElement;
		const toggleBtn1 = card1.querySelector('.wn-sticky-note-edit-toggle') as MockElement;

		const card1Comp = renderer['cardComponents'].get('note-1');
		expect(card1Comp).toBeDefined();

		// Click pencil on card 1 to enter edit mode
		toggleBtn1.onclick?.(fakeEvent);

		// Component for card 1 should be unloaded and removed from registry
		expect(card1Comp!.unload).toHaveBeenCalled();
		expect(renderer['cardComponents'].get('note-1')).toBeUndefined();

		// Card 1 is now in edit mode
		const updatedCard1 = container.querySelector('[data-note-id="note-1"]') as MockElement;
		expect(updatedCard1.querySelector('.wn-sticky-note-paragraph-editor')).not.toBeNull();
		expect(updatedCard1.querySelector('.wn-sticky-note-reading-content')).toBeNull();

		const toggleBtnAfter = updatedCard1.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		expect(toggleBtnAfter.getAttribute('data-icon')).toBe('eye');
		expect(toggleBtnAfter.getAttribute('aria-label')).toBe('完成编辑');

		// Card 2 remains untouched in reading mode
		const card2 = container.querySelector('[data-note-id="note-2"]') as MockElement;
		expect(card2.querySelector('.wn-sticky-note-reading-content')).not.toBeNull();
		expect(card2.querySelector('.wn-sticky-note-paragraph-editor')).toBeNull();

		// StickyNoteState.isEditing is updated to true for card 1 and passed to updateNote, unchanged for card 2
		expect(notes.find(n => n.id === 'note-1')?.isEditing).toBe(true);
		expect(notes.find(n => n.id === 'note-2')?.isEditing).toBe(false);
		expect(plugin.stickyNoteManager.updateNote).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'note-1', isEditing: true })
		);
	});

	it('on leaving edit mode, captures content, preserves frontmatter, saves note data, and updates linked TFile', async () => {
		const filePath = '便签/file-note.md';
		const initialRaw = '---\ntags: [idea]\n---\n初始便签内容';
		const note: StickyNoteState = {
			id: 'note-file',
			filePath,
			title: 'file-note',
			content: initialRaw,
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		const { plugin, notes, vaultFiles } = createMockPlugin([note]);
		vaultFiles.set(filePath, initialRaw);

		const app = createMockApp(vaultFiles);
		const container = new MockElement();

		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'workbench' });
		renderer.render();

		// Switch to edit mode
		const card = container.querySelector('[data-note-id="note-file"]') as MockElement;
		const toggleBtn = card.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		toggleBtn.onclick?.(fakeEvent);

		const editCard = container.querySelector('[data-note-id="note-file"]') as MockElement;
		const editor = editCard.querySelector('.wn-sticky-note-paragraph-editor') as MockElement;
		expect(editor).not.toBeNull();

		// User edits content in editor
		(editor as unknown as { value: string }).value = '修改后的便签内容';

		// Click eye button to finish editing
		const doneBtn = editCard.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		doneBtn.onclick?.(fakeEvent);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		// Content updated in manager with frontmatter preserved
		const savedNote = notes.find(n => n.id === 'note-file');
		expect(savedNote?.content).toBe('---\ntags: [idea]\n---\n修改后的便签内容');

		// File in vault also updated
		expect(vaultFiles.get(filePath)).toBe('---\ntags: [idea]\n---\n修改后的便签内容');

		// Card returns to reading mode
		const readingCard = container.querySelector('[data-note-id="note-file"]') as MockElement;
		expect(readingCard.querySelector('.wn-sticky-note-reading-content')).not.toBeNull();
		expect(readingCard.querySelector('.wn-sticky-note-paragraph-editor')).toBeNull();
	});

	it('syncs the latest linked file content into the note and reading card', async () => {
		const filePath = '便签/source.md';
		const note: StickyNoteState = {
			id: 'note-sync',
			filePath,
			title: 'source',
			content: '旧内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		const { plugin, notes, vaultFiles } = createMockPlugin([note]);
		vaultFiles.set(filePath, '源文件最新内容');
		const app = createMockApp(vaultFiles);
		const container = new MockElement();
		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'side-panel' });
		renderer.render();

		const card = container.querySelector('[data-note-id="note-sync"]') as MockElement;
		const syncBtn = card.querySelector('.wn-sticky-note-sync') as MockElement;
		expect(syncBtn).not.toBeNull();
		expect(syncBtn.getAttribute('data-icon')).toBe('refresh-cw');
		expect(syncBtn.getAttribute('aria-label')).toBe('从关联文档同步内容');

		syncBtn.onclick?.(fakeEvent);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(notes[0].content).toBe('源文件最新内容');
		expect(plugin.stickyNoteManager.saveNotes).toHaveBeenCalled();
		expect(mockMarkdownRender).toHaveBeenLastCalledWith(
			app,
			'源文件最新内容',
			expect.any(MockElement),
			filePath,
			expect.any(Component)
		);
	});

	it('newly created blank or file-backed notes start in editing mode and persist isEditing=true', async () => {
		const { plugin, notes, vaultFiles } = createMockPlugin([]);
		const app = createMockApp(vaultFiles);
		const container = new MockElement();

		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'immersive' });
		renderer.render();

		// Create new blank note
		renderer.createNewNote(undefined, '新便签内容', '新便签');

		// Wait for microtask/promise
		await Promise.resolve();
		await Promise.resolve();

		expect(notes).toHaveLength(1);
		const newNote = notes[0];

		// Note card in DOM starts in edit mode
		const card = container.querySelector(`[data-note-id="${newNote.id}"]`) as MockElement;
		expect(card).not.toBeNull();
		expect(card.querySelector('.wn-sticky-note-paragraph-editor')).not.toBeNull();
		expect(card.querySelector('.wn-sticky-note-reading-content')).toBeNull();

		// StickyNoteState.isEditing is true
		expect(newNote.isEditing).toBe(true);
		expect(plugin.stickyNoteManager.updateNote).toHaveBeenCalled();
		expect(plugin.stickyNoteManager.saveNotes).toHaveBeenCalled();
	});

	it('preserves local per-card state during syncNotesFromManager without disrupting focused editor', async () => {
		const note1: StickyNoteState = {
			id: 'note-1',
			title: '便签1',
			content: '便签1内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		const { plugin, notes, vaultFiles } = createMockPlugin([note1]);
		const app = createMockApp(vaultFiles);
		const container = new MockElement();

		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'side-panel' });
		renderer.render();

		// Put note1 in edit mode
		const card1 = container.querySelector('[data-note-id="note-1"]') as MockElement;
		const toggleBtn1 = card1.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		toggleBtn1.onclick?.(fakeEvent);

		const editor = container.querySelector('.wn-sticky-note-paragraph-editor') as MockElement;
		expect(editor).not.toBeNull();

		// Simulate background update to color
		notes[0].color = '#E8F5E9';
		renderer.syncNotesFromManager();

		// Card remains in edit mode
		const cardAfterSync = container.querySelector('[data-note-id="note-1"]') as MockElement;
		expect(cardAfterSync.querySelector('.wn-sticky-note-paragraph-editor')).not.toBeNull();
		expect(cardAfterSync.querySelector('.wn-sticky-note-reading-content')).toBeNull();

		renderer.destroy();
	});

	it('cleans up card components on destroy', () => {
		const note: StickyNoteState = {
			id: 'note-1',
			title: '便签1',
			content: '正文',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		const { plugin, vaultFiles } = createMockPlugin([note]);
		const app = createMockApp(vaultFiles);
		const container = new MockElement();

		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'side-panel' });
		renderer.render();

		expect(renderer['cardComponents'].size).toBe(1);
		const component = renderer['cardComponents'].get('note-1');
		expect(component).toBeDefined();

		renderer.destroy();
		expect(component!.unload).toHaveBeenCalled();
		expect(renderer['cardComponents'].size).toBe(0);
	});

	it('restores editing and reading mode from StickyNoteState.isEditing on initial render and renderer reconstruction', () => {
		const note1: StickyNoteState = {
			id: 'note-1',
			title: '便签1',
			content: '编辑中内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: true
		};
		const note2: StickyNoteState = {
			id: 'note-2',
			title: '便签2',
			content: '阅读中内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#D1E7DD',
			isEditing: false
		};

		const { plugin, vaultFiles } = createMockPlugin([note1, note2]);
		const app = createMockApp(vaultFiles);
		const container1 = new MockElement();

		// Initial renderer (e.g. side-panel)
		const renderer1 = new StickyNoteListRenderer(app, plugin, asHTMLElement(container1), { mode: 'side-panel' });
		renderer1.render();

		const card1 = container1.querySelector('[data-note-id="note-1"]') as MockElement;
		expect(card1.querySelector('.wn-sticky-note-paragraph-editor')).not.toBeNull();
		expect(card1.querySelector('.wn-sticky-note-reading-content')).toBeNull();

		const card2 = container1.querySelector('[data-note-id="note-2"]') as MockElement;
		expect(card2.querySelector('.wn-sticky-note-reading-content')).not.toBeNull();
		expect(card2.querySelector('.wn-sticky-note-paragraph-editor')).toBeNull();

		// Destroy renderer1 and create renderer2 (e.g. entering immersive mode or reconstructing renderer)
		renderer1.destroy();
		const container2 = new MockElement();
		const renderer2 = new StickyNoteListRenderer(app, plugin, asHTMLElement(container2), { mode: 'immersive' });
		renderer2.render();

		const newCard1 = container2.querySelector('[data-note-id="note-1"]') as MockElement;
		expect(newCard1.querySelector('.wn-sticky-note-paragraph-editor')).not.toBeNull();
		expect(newCard1.querySelector('.wn-sticky-note-reading-content')).toBeNull();

		const newCard2 = container2.querySelector('[data-note-id="note-2"]') as MockElement;
		expect(newCard2.querySelector('.wn-sticky-note-reading-content')).not.toBeNull();
		expect(newCard2.querySelector('.wn-sticky-note-paragraph-editor')).toBeNull();

		renderer2.destroy();
	});

	it('synchronizes edit/preview mode across multiple list renderers when manager state changes', async () => {
		const note: StickyNoteState = {
			id: 'note-1',
			title: '便签1',
			content: '共享便签',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		const { plugin, notes, vaultFiles } = createMockPlugin([note]);
		const app = createMockApp(vaultFiles);
		const container1 = new MockElement();
		const container2 = new MockElement();

		const renderer1 = new StickyNoteListRenderer(app, plugin, asHTMLElement(container1), { mode: 'side-panel' });
		const renderer2 = new StickyNoteListRenderer(app, plugin, asHTMLElement(container2), { mode: 'workbench' });
		renderer1.render();
		renderer2.render();

		// Both start in reading mode
		expect(container1.querySelector('[data-note-id="note-1"] .wn-sticky-note-reading-content')).not.toBeNull();
		expect(container2.querySelector('[data-note-id="note-1"] .wn-sticky-note-reading-content')).not.toBeNull();

		// User starts editing in renderer1
		const toggleBtn1 = container1.querySelector('[data-note-id="note-1"] .wn-sticky-note-edit-toggle') as MockElement;
		toggleBtn1.onclick?.(fakeEvent);

		expect(notes[0].isEditing).toBe(true);

		// Renderer2 syncs from manager (simulating webnovel:notes-changed event)
		renderer2.syncNotesFromManager();

		// Renderer2 should now display editor
		expect(container2.querySelector('[data-note-id="note-1"] .wn-sticky-note-paragraph-editor')).not.toBeNull();
		expect(container2.querySelector('[data-note-id="note-1"] .wn-sticky-note-reading-content')).toBeNull();

		// User finishes editing in renderer2
		const editCard2 = container2.querySelector('[data-note-id="note-1"]') as MockElement;
		const editor2 = editCard2.querySelector('.wn-sticky-note-paragraph-editor') as MockElement;
		const toggleBtn2 = editCard2.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		toggleBtn2.onclick?.(fakeEvent);
		await Promise.resolve();
		await Promise.resolve();

		expect(notes[0].isEditing).toBe(false);

		// Renderer1 syncs from manager
		renderer1.syncNotesFromManager();

		// Renderer1 should now be back in reading mode
		expect(container1.querySelector('[data-note-id="note-1"] .wn-sticky-note-reading-content')).not.toBeNull();
		expect(container1.querySelector('[data-note-id="note-1"] .wn-sticky-note-paragraph-editor')).toBeNull();

		renderer1.destroy();
		renderer2.destroy();
	});

	it('does not mutate canonical note object in-place during edit toggling, allowing floating note to observe isEditing change', async () => {
		const sharedNoteState: StickyNoteState = {
			id: 'note-shared',
			title: '共享便签',
			content: '初始内容',
			top: '100px',
			left: '100px',
			width: '300px',
			height: '300px',
			color: '#FDF3B8',
			isEditing: false
		};

		// Simulate sharing the exact object reference between manager and floating note harness
		const managerNotes = [sharedNoteState];
		const floatingNoteState = sharedNoteState; // Shared reference

		let observedIsEditingInFloatingBeforeUpdate = false;
		let floatingSawChange = false;

		const plugin: StickyNoteListRendererPlugin = {
			settings: {
				nextNoteThemeIndex: 0,
				noteThemes: [{ bg: '#FDF3B8', text: '#2C3E50' }],
				immersive: { immersiveNoteFontSize: 14 },
				stickyNoteAutoSave: true
			},
			stickyNoteManager: {
				getNotes: vi.fn(() => managerNotes),
				updateNote: vi.fn((incomingNote: StickyNoteState) => {
					// Verify that before updateNote took effect, the floatingNoteState object was NOT mutated in place
					observedIsEditingInFloatingBeforeUpdate = floatingNoteState.isEditing;
					// Simulate floatingNote.updateFromState(incomingNote)
					const isEditingChanged = floatingNoteState.isEditing !== incomingNote.isEditing;
					if (isEditingChanged) {
						floatingSawChange = true;
					}
					// FloatingStickyNote updates its state in updateFromState
					Object.assign(floatingNoteState, incomingNote);
					// Manager updates its storage
					managerNotes[0] = { ...incomingNote };
				}),
				saveNotes: vi.fn(async () => {}),
				removeNoteAndWait: vi.fn(async () => {})
			},
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((_key, fn) => fn())
			},
			getVaultMarkdownFiles: vi.fn(() => []),
			saveSettings: vi.fn(async () => {})
		};

		const app = createMockApp(new Map());
		const container = new MockElement();
		const renderer = new StickyNoteListRenderer(app, plugin, asHTMLElement(container), { mode: 'workbench' });
		renderer.render();

		// Click to start editing
		const card = container.querySelector('[data-note-id="note-shared"]') as MockElement;
		const toggleBtn = card.querySelector('.wn-sticky-note-edit-toggle') as MockElement;
		toggleBtn.onclick?.(fakeEvent);

		// Verified: floating note was still false when updateNote was called, and observed the change to true!
		expect(observedIsEditingInFloatingBeforeUpdate).toBe(false);
		expect(floatingSawChange).toBe(true);
		expect(managerNotes[0].isEditing).toBe(true);

		// Now finish editing
		const editCard = container.querySelector('[data-note-id="note-shared"]') as MockElement;
		const editor = editCard.querySelector('.wn-sticky-note-paragraph-editor') as MockElement;
		const doneBtn = editCard.querySelector('.wn-sticky-note-edit-toggle') as MockElement;

		floatingSawChange = false;
		doneBtn.onclick?.(fakeEvent);
		await Promise.resolve();
		await Promise.resolve();

		expect(floatingSawChange).toBe(true);
		expect(managerNotes[0].isEditing).toBe(false);

		renderer.destroy();
	});
});
