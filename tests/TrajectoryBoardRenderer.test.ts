import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTrajectoryMode, clearTrajectoryViewport, type TrajectoryModeOptions } from '../src/ui/components/TrajectoryBoardRenderer';
import { getStickyNoteEditorContent } from '../src/ui/components/StickyNoteParagraphEditor';
import type { TimelineEntry } from '../src/services/TimelineManager';
import type { App, TFile } from 'obsidian';
import { openFileAndFocus } from '../src/utils/leaf';

const { MockFile, modalMockOptions } = vi.hoisted(() => {
	class HoistedMockFile {
		extension = 'md';
		basename: string;

		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	return { MockFile: HoistedMockFile, modalMockOptions: { closeButtonClass: 'modal-close-button' } };
});

function createMockFile(name: string, path: string): TFile {
	return new MockFile(name, path) as unknown as TFile;
}

vi.mock('../src/i18n', () => ({
	t: vi.fn((key: string) => {
		const map: Record<string, string> = {
			'trajectory.no-records': 'No records',
			'trajectory.main-type': 'Main',
			'trajectory.unassociated': 'Unassociated lore',
			'trajectory.no-description': 'No description',
			'trajectory.enter-fullscreen': 'Enter fullscreen',
			'trajectory.exit-fullscreen': 'Exit fullscreen',
			'trajectory.save-failed': 'Failed to save trajectory event description.'
		};
		return map[key] || key;
	}),
}));

vi.mock('obsidian', () => {
	class MockModal {
		app: unknown;
		containerEl: MockElement;
		modalEl: MockElement;
		contentEl: MockElement;
		isOpen = false;
		constructor(app: unknown) {
			this.app = app;
			this.containerEl = new MockElement('div');
			this.containerEl.className = 'modal-container';
			this.modalEl = this.containerEl.createDiv('modal');
			this.modalEl.createDiv(`${modalMockOptions.closeButtonClass} mod-raised clickable-icon`);
			this.modalEl.createDiv('modal-header');
			this.contentEl = this.modalEl.createDiv('modal-content');
		}
		open() {
			this.isOpen = true;
			this.onOpen?.();
		}
		close() {
			if (!this.isOpen) return;
			this.isOpen = false;
			this.onClose?.();
		}
		onOpen() {}
		onClose() {}
	}

	return {
		setTooltip: vi.fn((element: { setAttr: (name: string, value: string) => void }, summary: string) => {
			element.setAttr('data-tooltip', summary);
		}),
		setIcon: vi.fn((element: { setAttr?: (name: string, value: string) => void }, icon: string) => {
			element.setAttr?.('data-icon', icon);
		}),
		Notice: vi.fn(),
		Modal: MockModal,
		Platform: {
			isMobile: false
		}
	};
});

vi.mock('../src/utils/leaf', () => ({
	openFileAndFocus: vi.fn(),
	getLeafForFileNavigation: vi.fn()
}));

vi.mock('../src/ui/components/StickyNoteParagraphEditor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/ui/components/StickyNoteParagraphEditor')>();
	return {
		...actual,
		setupStickyNoteParagraphEditor: vi.fn(actual.setupStickyNoteParagraphEditor),
		teardownStickyNoteParagraphEditor: vi.fn(actual.teardownStickyNoteParagraphEditor),
		getStickyNoteEditorContent: vi.fn().mockReturnValue('Updated content')
	};
});

interface MockEvent {
	type: string;
	pointerId?: number;
	pointerType?: string;
	button?: number;
	clientX?: number;
	clientY?: number;
	deltaY?: number;
	target?: { closest: (selector: string) => unknown };
	preventDefault?: () => void;
	stopPropagation?: () => void;
	stopImmediatePropagation?: () => void;
}

class MockVisualViewport {
	private _width?: number;
	private _height?: number;
	offsetLeft = 0;
	offsetTop = 0;
	listeners: Record<string, Array<() => void>> = {};

	constructor(private win: MockWindow) {}

	get width(): number { return this._width ?? this.win.innerWidth; }
	set width(v: number) { this._width = v; }
	get height(): number { return this._height ?? this.win.innerHeight; }
	set height(v: number) { this._height = v; }

	addEventListener(type: string, listener: () => void) {
		if (!this.listeners[type]) this.listeners[type] = [];
		this.listeners[type].push(listener);
	}
	removeEventListener(type: string, listener: () => void) {
		if (this.listeners[type]) {
			this.listeners[type] = this.listeners[type].filter(l => l !== listener);
		}
	}
	dispatchEvent(event: { type: string }) {
		if (this.listeners[event.type]) {
			for (const l of this.listeners[event.type]) l();
		}
	}
}

class MockWindow {
	timeouts: Array<() => void> = [];
	rafCallbacks: Array<() => void> = [];
	innerWidth = 1024;
	innerHeight = 768;
	visualViewport = new MockVisualViewport(this);
	screen: { width: number; height: number; orientation?: { type?: string; angle?: number } } = { width: 1024, height: 768 };
	listeners: Record<string, Array<() => void>> = {};
	requestAnimationFrame(cb: () => void): number {
		this.rafCallbacks.push(cb);
		return this.rafCallbacks.length;
	}
	cancelAnimationFrame(id: number): void {
		if (this.rafCallbacks[id - 1]) {
			this.rafCallbacks[id - 1] = () => {};
		}
	}
	flushRaf(): void {
		const cbs = [...this.rafCallbacks];
		this.rafCallbacks = [];
		for (const cb of cbs) cb();
	}
	setTimeout(callback: () => void): number {
		this.timeouts.push(callback);
		return this.timeouts.length;
	}
	getSelection(): null { return null; }
	addEventListener(type: string, listener: () => void) {
		if (!this.listeners[type]) this.listeners[type] = [];
		this.listeners[type].push(listener);
	}
	removeEventListener(type: string, listener: () => void) {
		if (this.listeners[type]) {
			this.listeners[type] = this.listeners[type].filter(l => l !== listener);
		}
	}
}

class MockDocument {
	readonly defaultView = new MockWindow();
	private _body: MockElement | null = null;
	get body(): MockElement {
		if (!this._body) this._body = new MockElement('body');
		return this._body;
	}
	createRange() {
		return { selectNodeContents: () => {}, collapse: () => {} };
	}
	createElement(tag: string) {
		return new MockElement(tag);
	}
}

class MockElement {
	static sharedDocument = new MockDocument();
    tagName: string;
    className: string = '';
    private _textContent: string = '';
    children: MockElement[] = [];
    style: Record<string, string> = {};
    attributes: Record<string, string> = {};
    tabIndex: number = -1;

    scrollLeft: number = 0;
    scrollTop: number = 0;
    onclick?: (e: { stopPropagation: () => void }) => void;
    onkeydown?: (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void;
    onblur?: () => void;
	private capturedPointerId: number | null = null;
    listeners: Record<string, Array<(event: MockEvent) => void>> = {};

    constructor(tagName: string = 'div') {
        this.tagName = tagName;
    }

    get textContent(): string {
        if (this._textContent !== undefined && this._textContent !== '') return this._textContent;
        if (this.children.length > 0) {
            return this.children.map(c => c.textContent).join('\n');
        }
        return this._textContent || '';
    }

    set textContent(text: string) {
        this._textContent = text;
    }

    appendText(text: string) {
        this._textContent = (this._textContent || '') + text;
    }

    setText(text: string) {
        this.empty();
        this._textContent = text;
    }

    parentElement: MockElement | null = null;
    get parentNode(): MockElement | null { return this.parentElement; }
    get isConnected(): boolean { return true; }

    appendChild(child: MockElement): MockElement {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    insertBefore(newChild: MockElement, refChild: MockElement | null): MockElement {
        newChild.remove();
        newChild.parentElement = this;
        if (!refChild) {
            this.children.push(newChild);
            return newChild;
        }
        const idx = this.children.indexOf(refChild);
        if (idx >= 0) {
            this.children.splice(idx, 0, newChild);
        } else {
            this.children.push(newChild);
        }
        return newChild;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) this.parentElement.children.splice(idx, 1);
            this.parentElement = null;
        }
    }

    removeAttribute(name: string): void {
        delete this.attributes[name];
    }

    createEl(tag: string, options?: { cls?: string; text?: string }): MockElement {
        const el = new MockElement(tag);
        el.parentElement = this;
        if (options?.cls) el.className = options.cls;
        if (options?.text) el.textContent = options.text;
        this.children.push(el);
        return el;
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
    }

    createDiv(options: string | { cls?: string, text?: string }): MockElement {
        const el = new MockElement('div');
        el.parentElement = this;
        if (typeof options === 'string') {
            el.className = options;
        } else {
            if (options.cls) el.className = options.cls;
            if (options.text) el.textContent = options.text;
        }
        this.children.push(el);
        return el;
    }

    createSpan(options: { cls: string, text: string }): MockElement {
        const el = new MockElement('span');
        el.parentElement = this;
        el.className = options.cls;
        el.textContent = options.text;
        this.children.push(el);
        return el;
    }

    setCssProps(props: Record<string, string>) {
        Object.assign(this.style, props);
    }

    setCssStyles(props: Record<string, string>) {
        Object.assign(this.style, props);
    }

    setAttribute(name: string, value: string) {
        this.attributes[name] = value;
    }

    setAttr(name: string, value: string) {
        this.setAttribute(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes[name] || null;
    }

    get classList() {
        return {
            add: (cls: string) => this.addClass(cls),
            remove: (cls: string) => this.removeClass(cls),
            contains: (cls: string) => this.hasClass(cls)
        };
    }

    hasClass(cls: string): boolean {
        return this.className.split(' ').includes(cls);
    }

    removeClass(cls: string) {
        this.className = this.className.split(' ').filter(c => c !== cls).join(' ');
    }

    addClass(cls: string) {
        if (!this.hasClass(cls)) this.className = (this.className + ' ' + cls).trim();
    }

    empty() {
        for (const child of this.children) {
            child.parentElement = null;
        }
        this.children = [];
        this._textContent = '';
    }

    focus() {}

    blur() {
        this.onblur?.();
    }

    closest(selector: string): MockElement | null {
        const selectors = selector.split(',').map(s => s.trim());
        let curr: MockElement | null = this;
        while (curr) {
            for (const s of selectors) {
                if (s.startsWith('.')) {
                    const cls = s.substring(1);
                    if (curr.hasClass(cls)) return curr;
                } else if (s === '[contenteditable]') {
                    if (curr.getAttribute('contenteditable') === 'true' || curr.attributes['contenteditable'] !== undefined) return curr;
                } else if (curr.tagName.toLowerCase() === s.toLowerCase()) {
                    return curr;
                }
            }
            curr = curr.parentElement;
        }
        return null;
    }

	get ownerDocument() {
		return MockElement.sharedDocument;
	}

    setPointerCapture(pointerId: number) { this.capturedPointerId = pointerId; }
    hasPointerCapture(pointerId: number) { return this.capturedPointerId === pointerId; }
    releasePointerCapture(pointerId: number) {
        if (this.capturedPointerId === pointerId) this.capturedPointerId = null;
    }

    addEventListener(type: string, listener: (event: MockEvent) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
    }

    removeEventListener(type: string, listener: (event: MockEvent) => void) {
        if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(l => l !== listener);
        }
    }

    dispatchEvent(event: MockEvent) {
        if (this.listeners[event.type]) {
            for (const l of this.listeners[event.type]) l(event);
        }
    }

    querySelector(selector: string): MockElement | null {
        if (selector.startsWith('.')) {
            const cls = selector.substring(1);
            if (this.className && this.className.includes(cls)) return this;
            for (const child of this.children) {
                const found = child.querySelector(selector);
                if (found) return found;
            }
        }
        return null;
    }

    querySelectorAll(selector: string): MockElement[] {
        const results: MockElement[] = [];
        if (selector.startsWith('.')) {
            const parts = selector.split('.');
            const classes = parts.filter(Boolean);
            let match = true;
            for (const cls of classes) {
                if (!this.className || !this.className.includes(cls)) {
                    match = false;
                    break;
                }
            }
            if (match && classes.length > 0) results.push(this);

            for (const child of this.children) {
                results.push(...child.querySelectorAll(selector));
            }
        }
        return results;
    }
}

describe('TrajectoryBoardRenderer', () => {
    let mockApp: App;
    let container: MockElement;
    let resolveLinkToFile: (link: string) => TFile | null;

    beforeEach(() => {
        modalMockOptions.closeButtonClass = 'modal-close-button';
        MockElement.sharedDocument = new MockDocument();
        container = new MockElement();
        mockApp = {
            metadataCache: {
                getFileCache: vi.fn().mockReturnValue({ frontmatter: { synopsis: 'Test Synopsis' } })
            }
        } as unknown as App;
        resolveLinkToFile = (link: string) => {
            if (link === 'Chapter 1') return createMockFile('Chapter 1.md', 'path/to/Chapter 1.md');
            return null;
        };
        vi.mocked(getStickyNoteEditorContent).mockReturnValue('Updated content');
    });

    it('should render empty state when no entries', async () => {
        await renderTrajectoryMode({
            app: mockApp,
            container: container as unknown as HTMLElement,
            displayEntries: [],
            resolveLinkToFile
        });

        const emptyState = container.querySelector('.wn-trajectory-empty');
        expect(emptyState).toBeTruthy();
        expect(emptyState?.textContent).toBe('No records');
    });

    it('should render correct grid structure and dynamic columns', async () => {
        const entries: TimelineEntry[] = [
            { time: 'Day 1', type: 'Main', description: 'Event A', chapter: 'Chapter 1', items: [{ description: 'Event A', chapter: 'Chapter 1' }], rawBlock: '' },
            { time: 'Day 2', type: 'Sub', description: 'Event B', chapter: 'Chapter 2', lores: ['Lore 1'], items: [{ description: 'Event B', chapter: 'Chapter 2' }], rawBlock: '' }
        ];

        await renderTrajectoryMode({
            app: mockApp,
            container: container as unknown as HTMLElement,
            displayEntries: entries,
            resolveLinkToFile
        });

        const grid = container.querySelector('.wn-trajectory-grid');
        expect(grid).toBeTruthy();

        // Dynamic columns check
        expect(grid?.style.gridTemplateColumns).toBe('max-content repeat(2, 14rem)');

        // Type lanes
        const typeHeaders = grid?.querySelectorAll('.wn-trajectory-lane-header.is-type');
        expect(typeHeaders?.length).toBe(2);
        expect(typeHeaders?.[0].textContent).toBe('Main');
        expect(typeHeaders?.[1].textContent).toBe('Sub');

        // Lore lanes
        const loreHeaders = grid?.querySelectorAll('.wn-trajectory-lane-header.is-lore');
        expect(loreHeaders?.length).toBe(2);
        expect(loreHeaders?.[0].textContent).toBe('Unassociated lore');
        expect(loreHeaders?.[0].className).toContain('is-unassociated');
        expect(loreHeaders?.[1].textContent).toBe('Lore 1');
    });

	it('keeps the whole type lane on the same stable theme tint after filtering', () => {
		const render = (type: string) => {
			const target = new MockElement();
			renderTrajectoryMode({
				app: mockApp,
				container: target as unknown as HTMLElement,
				displayEntries: [{ time: 'Day 1', type, description: '', chapter: '', rawBlock: '', items: [{ description: '', chapter: '' }] }],
				allTypes: ['Main', 'Sub', 'Other'],
				resolveLinkToFile
			});
			const header = target.querySelectorAll('.wn-trajectory-lane-header.is-type')[0];
			const cell = target.querySelectorAll('.wn-trajectory-cell.is-type')[0];
			const node = target.querySelector('.wn-trajectory-node');
			return {
				header: header?.style['--wn-trajectory-type-color'],
				cell: cell?.style['--wn-trajectory-type-color'],
				node: node?.style['--wn-trajectory-type-color']
			};
		};

		expect(render('Sub')).toEqual({ header: 'var(--color-green)', cell: 'var(--color-green)', node: undefined });
		expect(render('Main')).toEqual({ header: 'var(--color-blue)', cell: 'var(--color-blue)', node: undefined });
		expect(render('Sub')).toEqual({ header: 'var(--color-green)', cell: 'var(--color-green)', node: undefined });
	});

    it('should render chapter tooltip correctly', async () => {
        const entries: TimelineEntry[] = [
            { time: 'Day 1', description: 'Event A', chapter: 'Chapter 1', items: [{ description: 'Event A', chapter: 'Chapter 1', type: 'Main' }], rawBlock: '' }
        ];

        await renderTrajectoryMode({
            app: mockApp,
            container: container as unknown as HTMLElement,
            displayEntries: entries,
            resolveLinkToFile
        });

        const chapterMarker = container.querySelector('.wn-trajectory-chapter-marker');
        expect(chapterMarker).toBeTruthy();
        expect(chapterMarker?.textContent).toBe('Chapter 1');
        expect(chapterMarker?.getAttribute('data-tooltip')).toBe('Test Synopsis');
        expect(chapterMarker?.getAttribute('title')).toBeNull();
    });

    it('should place description in lore lanes appropriately', async () => {
        const entries: TimelineEntry[] = [
            { time: 'Day 1', description: 'Event A', chapter: 'Chapter 1', lores: ['Lore 1'], items: [{ description: 'Event A', chapter: 'Chapter 1', type: 'Main' }], rawBlock: '' },
            { time: 'Day 2', description: '', chapter: 'Chapter 1', items: [{ description: '', chapter: 'Chapter 1', type: 'Main' }], rawBlock: '' }
        ];

        await renderTrajectoryMode({
            app: mockApp,
            container: container as unknown as HTMLElement,
            displayEntries: entries,
            resolveLinkToFile
        });

        const loreEvents = container.querySelectorAll('.wn-trajectory-event-text');
        // Unassociated lane has 1 event (Day 2)
        // Lore 1 lane has 1 event (Day 1)
        expect(loreEvents.length).toBe(2);

        const descriptions = Array.from(loreEvents).map(el => el.textContent);
        expect(descriptions).toContain('Event A');
        expect(descriptions).toContain('No description');
    });

	it('omits the unassociated lane when every node has lore and keeps sub-events in their associated lanes', async () => {
		const entry: TimelineEntry = {
			time: 'Later', description: 'First', chapter: 'Chapter 1',
			lores: ['Lore 1', 'Lore 2'], rawBlock: '',
			items: [
				{ description: 'First', chapter: 'Chapter 1', important: true, type: 'Main' },
				{ description: 'Second', chapter: '', type: 'Main' }
			]
		};
		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});
		const cells = container.querySelectorAll('.wn-trajectory-cell.is-lore');
		expect(container.querySelectorAll('.wn-trajectory-lane-header.is-unassociated')).toHaveLength(0);
		expect(cells).toHaveLength(2);
		expect(cells[0].querySelectorAll('.wn-trajectory-event-text').map(el => el.textContent)).toEqual(['First', 'Second']);
		expect(cells[1].querySelectorAll('.wn-trajectory-event-text').map(el => el.textContent)).toEqual(['First', 'Second']);
		expect(cells[0].querySelectorAll('.wn-trajectory-event.is-important')).toHaveLength(1);
		expect(cells[1].querySelectorAll('.wn-trajectory-event.is-important')).toHaveLength(1);
		expect(cells.map(cell => cell.style['--traj-col'])).toEqual(['2', '2']);
		expect(container.querySelectorAll('button')).toHaveLength(0);
	});

	it('preserves the importance of a legacy single-event node', async () => {
		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [{ time: 'Day 1', description: 'Important', chapter: '', important: true, rawBlock: '' }],
			resolveLinkToFile
		});
		expect(container.querySelectorAll('.wn-trajectory-event.is-important')).toHaveLength(1);
	});

	it('handles inline edit on event text and prevents multiple concurrent edits of same node', async () => {
		const entry: TimelineEntry = {
			time: 'Day 1', description: 'Original', chapter: '', lores: ['Lore 1'], rawBlock: ''
		};
		const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
		const reloadBoard = vi.fn();
		const onSaveStateChange = vi.fn();

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			reloadBoard,
			onSaveStateChange
		});

		const textDivs = container.querySelectorAll('.wn-trajectory-event-text');
		expect(textDivs.length).toBe(1);
		const textDiv = textDivs[0];

		textDiv.onclick!({ stopPropagation: vi.fn() });
		expect(textDiv.hasClass('is-editing')).toBe(true);

		textDiv.blur();
		await Promise.resolve();

		expect(onSaveStateChange).toHaveBeenCalledWith(true);
		expect(onUpdateEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: 'Updated content' }), expect.anything());
		expect(onSaveStateChange).toHaveBeenCalledWith(false);
		expect(reloadBoard).not.toHaveBeenCalled();
		expect(textDiv.textContent).toBe('Updated content');
	});

	it('keeps Enter available for multiline editing and saves on blur', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'First', chapter: '', lores: [], rawBlock: '' };
		const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry
		});

		const textDiv = container.querySelector('.wn-trajectory-event-text')!;
		expect(textDiv.onkeydown).toBeTypeOf('function');
		textDiv.onclick!({ stopPropagation: vi.fn() });
		expect(textDiv.hasClass('is-editing')).toBe(true);
		expect(textDiv.onkeydown).toBeNull();
		expect(onUpdateEntry).not.toHaveBeenCalled();

		const { getStickyNoteEditorContent } = await import('../src/ui/components/StickyNoteParagraphEditor.js');
		vi.mocked(getStickyNoteEditorContent).mockReturnValueOnce('First\nSecond');
		textDiv.blur();
		await vi.waitFor(() => expect(onUpdateEntry).toHaveBeenCalledOnce());
		expect(onUpdateEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: 'First\nSecond' }), expect.anything());
	});

	it('uses the original index after filtering and locks duplicate lore cards while saving', async () => {
		const hidden: TimelineEntry = { time: 'Earlier', description: '', chapter: '', rawBlock: '' };
		const shown: TimelineEntry = {
			time: 'Later', description: '', chapter: '', lores: ['Lore 1', 'Lore 2'], rawBlock: '',
			items: [{ description: 'First', chapter: '' }, { description: 'Second', chapter: '' }]
		};
		let finishSave: () => void = () => undefined;
		const saveGate = new Promise<void>(resolve => { finishSave = resolve; });
		const onUpdateEntry = vi.fn().mockReturnValue(saveGate);
		const reloadBoard = vi.fn();
		renderTrajectoryMode({ app: mockApp, container: container as unknown as HTMLElement,
			displayEntries: [shown], allEntries: [hidden, shown], resolveLinkToFile,
			onUpdateEntry, reloadBoard });
		const copies = container.querySelectorAll('.wn-trajectory-event-text');
		expect(copies).toHaveLength(4);
		copies[1].onclick?.({ stopPropagation: vi.fn() });
		copies[3].onclick?.({ stopPropagation: vi.fn() });
		expect(copies[1].hasClass('is-editing')).toBe(true);
		expect(copies[3].hasClass('is-editing')).toBe(false);
		copies[1].blur();
		expect(onUpdateEntry).toHaveBeenCalledWith(1, expect.objectContaining({
			items: [expect.objectContaining({ description: 'First' }), expect.objectContaining({ description: 'Updated content' })]
		}), expect.anything());
		copies[3].onclick?.({ stopPropagation: vi.fn() });
		expect(copies[3].hasClass('is-editing')).toBe(false);
		finishSave();
		await vi.waitFor(() => expect(reloadBoard).not.toHaveBeenCalled());
		expect(copies[1].textContent).toBe('Updated content');
		expect(copies[3].textContent).toBe('Updated content');
		// Now that save finished, copy 3 can be edited
		copies[3].onclick?.({ stopPropagation: vi.fn() });
		expect(copies[3].hasClass('is-editing')).toBe(true);
	});

	it('handles chapter click to open the chapter', async () => {
		vi.mocked(openFileAndFocus).mockClear();

		const entry: TimelineEntry = {
			time: 'Day 1', description: 'Event', chapter: 'Chapter 1', lores: [], rawBlock: ''
		};

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const marker = container.querySelector('.wn-trajectory-chapter-marker');
		expect(marker).toBeTruthy();

		marker?.onclick!({ stopPropagation: vi.fn() });
		await Promise.resolve();

		expect(openFileAndFocus).toHaveBeenCalled();
	});

	it('does not trigger edit or chapter navigation if dragged', async () => {
		vi.mocked(openFileAndFocus).mockClear();

		const entry: TimelineEntry = {
			time: 'Day 1', description: 'Event', chapter: 'Chapter 1', lores: [], rawBlock: ''
		};

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry: vi.fn()
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout');

		layout?.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0,
			pointerId: 1, clientX: 0, target: { closest: () => null } });
		layout?.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 10, preventDefault: vi.fn() });
		layout?.dispatchEvent({ type: 'pointerup', pointerId: 1 });
		const blockedClick = vi.fn();
		layout?.dispatchEvent({ type: 'click', preventDefault: vi.fn(),
			stopPropagation: vi.fn(), stopImmediatePropagation: blockedClick });
		expect(blockedClick).toHaveBeenCalledOnce();

		const textDiv = container.querySelector('.wn-trajectory-event-text');
		const marker = container.querySelector('.wn-trajectory-chapter-marker');

		expect(textDiv?.hasClass('is-editing')).toBe(false);
		await Promise.resolve();
		expect(openFileAndFocus).not.toHaveBeenCalled();
	});

	it('allows ordinary click AFTER a drag is completed', async () => {
		vi.mocked(openFileAndFocus).mockClear();
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: 'Chapter 1', lores: [], rawBlock: '' };

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry: vi.fn()
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0,
			pointerId: 1, clientX: 0, target: { closest: () => null } });
		layout.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 10, preventDefault: vi.fn() });
		layout.dispatchEvent({ type: 'pointerup', pointerId: 1 });
		layout.dispatchEvent({ type: 'click', preventDefault: vi.fn(),
			stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() });
		const ordinaryClickBlocked = vi.fn();
		layout.dispatchEvent({ type: 'click', preventDefault: vi.fn(),
			stopPropagation: vi.fn(), stopImmediatePropagation: ordinaryClickBlocked });
		expect(ordinaryClickBlocked).not.toHaveBeenCalled();

		const marker = container.querySelector('.wn-trajectory-chapter-marker')!;
		marker.onclick!({ stopPropagation: vi.fn() });
		await Promise.resolve();

		expect(openFileAndFocus).toHaveBeenCalled();
	});

	it('avoids writing unchanged event text', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'No change', chapter: '', lores: [], rawBlock: '' };
		const reloadBoard = vi.fn();
		const onUpdateEntry = vi.fn();

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			reloadBoard
		});

		const textDiv = container.querySelector('.wn-trajectory-event-text')!;
		textDiv.onclick!({ stopPropagation: vi.fn() });

		const { getStickyNoteEditorContent } = await import('../src/ui/components/StickyNoteParagraphEditor.js');
		vi.mocked(getStickyNoteEditorContent).mockReturnValue('No change');

		textDiv.blur();
		await Promise.resolve();

		expect(onUpdateEntry).not.toHaveBeenCalled();
		expect(reloadBoard).not.toHaveBeenCalled();
		expect(textDiv.hasClass('is-editing')).toBe(false);
		expect(textDiv.textContent).toBe('No change');
	});

	it('renders multi-paragraph event descriptions into separate sticky note lines and handles empty placeholders', async () => {
		const entries: TimelineEntry[] = [
			{ time: 'Day 1', description: 'Para 1\n\nPara 2', chapter: '', lores: ['Lore 1'], rawBlock: '' },
			{ time: 'Day 2', description: '   ', chapter: '', lores: [], rawBlock: '' }
		];

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: entries,
			resolveLinkToFile
		});

		const textDivs = container.querySelectorAll('.wn-trajectory-event-text');
		expect(textDivs).toHaveLength(2);

		// Unassociated lane is rendered first: contains Day 2 (empty placeholder)
		const emptyDiv = textDivs[0];
		expect(emptyDiv.hasClass('is-empty')).toBe(true);
		expect(emptyDiv.textContent).toBe('No description');
		expect(emptyDiv.querySelectorAll('.wn-sticky-note-editor-line')).toHaveLength(0);

		// Lore 1 lane contains Day 1 (paragraphs rendered as .wn-sticky-note-editor-line)
		const paraDiv = textDivs[1];
		expect(paraDiv.hasClass('is-empty')).toBe(false);
		const lines = paraDiv.querySelectorAll('.wn-sticky-note-editor-line');
		expect(lines).toHaveLength(3);
		expect(lines[0].textContent).toBe('Para 1');
		expect(lines[0].hasClass('is-empty')).toBe(false);
		expect(lines[1].hasClass('is-empty')).toBe(true);
		expect(lines[2].textContent).toBe('Para 2');
		expect(lines[2].hasClass('is-empty')).toBe(false);
	});

	it('supports free 2D canvas mouse drag-to-pan even without overflow, respecting threshold and target protections', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: 'Chapter 1', lores: [], rawBlock: '' };

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;

		expect(grid.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');

		// 1. Below threshold (within 3px on both axes) should not start drag
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'mouse',
			button: 0,
			pointerId: 10,
			clientX: 100,
			clientY: 100,
			target: { closest: () => null }
		});
		layout.dispatchEvent({
			type: 'pointermove',
			pointerId: 10,
			clientX: 102,
			clientY: 102,
			preventDefault: vi.fn()
		});
		expect(layout.hasClass('is-panning')).toBe(false);
		expect(grid.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');

		// 2. Beyond threshold triggers free 2D canvas pan (even with small graph / no scroll overflow)
		// Pointer moves from (100, 100) to (120, 60): distanceX = +20, distanceY = -40
		layout.dispatchEvent({
			type: 'pointermove',
			pointerId: 10,
			clientX: 120,
			clientY: 60,
			preventDefault: vi.fn()
		});
		expect(layout.hasClass('is-panning')).toBe(true);
		expect(layout.hasClass('is-dragging')).toBe(false);
		expect(grid.style.transform).toBe('translate3d(20px, -40px, 0) scale(1)');

		layout.dispatchEvent({ type: 'pointerup', pointerId: 10 });
		expect(layout.hasClass('is-panning')).toBe(false);

		// 3. Interactive target protection: pointerdown on interactive element should not start drag
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'mouse',
			button: 0,
			pointerId: 11,
			clientX: 100,
			clientY: 100,
			target: { closest: (selector: string) => selector.includes('wn-trajectory-event-text') ? {} : null }
		});
		layout.dispatchEvent({
			type: 'pointermove',
			pointerId: 11,
			clientX: 50,
			clientY: 50,
			preventDefault: vi.fn()
		});
		expect(layout.hasClass('is-panning')).toBe(false);
		expect(grid.style.transform).toBe('translate3d(20px, -40px, 0) scale(1)');

		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', button: 0,
			pointerId: 12, clientX: 100, clientY: 100, target: { closest: () => null } });
		layout.dispatchEvent({ type: 'pointermove', pointerId: 12, clientX: 100, clientY: 140,
			preventDefault: vi.fn() });
		expect(grid.style.transform).toBe('translate3d(20px, 0px, 0) scale(1)');
		layout.dispatchEvent({ type: 'pointerup', pointerId: 12 });
	});

	it('adjusts scale bounded within [0.5, 2.0] and anchors transform around pointer on wheel', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;

		expect(grid.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');

		// 1. Wheel zoom in (deltaY < 0) at pointer (150, 100)
		layout.dispatchEvent({
			type: 'wheel',
			deltaY: -100,
			clientX: 150,
			clientY: 100,
			preventDefault: vi.fn()
		});

		const getScale = () => Number(grid.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
		const zoomedInScale = getScale();
		expect(zoomedInScale).toBeGreaterThan(1.0);
		expect(zoomedInScale).toBeLessThanOrEqual(2.0);

		// Anchor math: px = 150, py = 100, startPanX = 0, startPanY = 0
		const expectedPanX = Math.round((150 - 150 * (zoomedInScale / 1.0)) * 100) / 100;
		const expectedPanY = Math.round((100 - 100 * (zoomedInScale / 1.0)) * 100) / 100;
		expect(grid.style.transform).toBe(`translate3d(${expectedPanX}px, ${expectedPanY}px, 0) scale(${zoomedInScale})`);

		// 2. Large wheel zooming in cannot exceed MAX_SCALE 2.0
		for (let i = 0; i < 20; i++) {
			layout.dispatchEvent({
				type: 'wheel',
				deltaY: -500,
				clientX: 150,
				clientY: 100,
				preventDefault: vi.fn()
			});
		}
		expect(getScale()).toBe(2.0);

		// 3. Large wheel zooming out cannot go below MIN_SCALE 0.5
		for (let i = 0; i < 40; i++) {
			layout.dispatchEvent({
				type: 'wheel',
				deltaY: 500,
				clientX: 150,
				clientY: 100,
				preventDefault: vi.fn()
			});
		}
		expect(getScale()).toBe(0.5);

		// 4. Horizontal-only wheel (deltaY === 0) does not zoom
		const scaleBefore = getScale();
		layout.dispatchEvent({
			type: 'wheel',
			deltaY: 0,
			clientX: 150,
			clientY: 100,
			preventDefault: vi.fn()
		});
		expect(getScale()).toBe(scaleBefore);

		// 5. Wheel event from an active contenteditable editor is ignored
		const transformBefore = grid.style.transform;
		layout.dispatchEvent({
			type: 'wheel',
			deltaY: -100,
			clientX: 150,
			clientY: 100,
			target: { closest: (selector: string) => selector.includes('is-editing') ? {} : null },
			preventDefault: vi.fn()
		});
		expect(getScale()).toBe(0.5);
		expect(grid.style.transform).toBe(transformBefore);
	});

	it('restores 100% scale on blank-space double-click without moving the canvas or affecting cards', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;
		const blankCell = container.querySelector('.wn-trajectory-cell')!;
		const eventText = container.querySelector('.wn-trajectory-event-text')!;

		// Zoom via wheel first within render
		layout.dispatchEvent({
			type: 'wheel',
			deltaY: -200,
			clientX: 100,
			clientY: 100,
			preventDefault: vi.fn()
		});
		expect(grid.style.transform).not.toContain('scale(1)');

		const transformedBefore = grid.style.transform;
		layout.dispatchEvent({ type: 'dblclick', button: 0, target: eventText });
		expect(grid.style.transform).toBe(transformedBefore);

		layout.dispatchEvent({ type: 'dblclick', button: 0, target: blankCell });
		expect(grid.style.transform).toBe(transformedBefore.replace(/scale\([^)]+\)$/, 'scale(1)'));
	});

	it('aligns same-name nodes across type lanes in one column with distinct event colors', async () => {
		const mainEntry: TimelineEntry = {
			time: '第 10 天',
			type: 'Main',
			description: 'Main event',
			chapter: '',
			lores: ['Lore 1'],
			rawBlock: '',
			items: [{ description: 'Main event', chapter: '' }]
		};
		const subEntry: TimelineEntry = { time: '第 10 天', type: 'Sub', description: 'Sub event', chapter: '', lores: ['Lore 1'], rawBlock: '', items: [{ description: 'Sub event', chapter: '' }] };

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [mainEntry, subEntry],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile
		});

		const grid = container.querySelector('.wn-trajectory-grid');
		expect(grid).toBeTruthy();

		expect(grid?.style.gridTemplateColumns).toBe('max-content repeat(1, 14rem)');

		// Both Main and Sub lanes are rendered
		const typeHeaders = grid?.querySelectorAll('.wn-trajectory-lane-header.is-type');
		expect(typeHeaders?.length).toBe(2);
		expect(typeHeaders?.[0].textContent).toBe('Main');
		expect(typeHeaders?.[1].textContent).toBe('Sub');

		// Both type rows place their node in the shared column.
		const typeCells = grid?.querySelectorAll('.wn-trajectory-cell.is-type');
		expect(typeCells?.length).toBe(2);
		expect(typeCells?.[0].hasClass('is-node')).toBe(true);
		expect(typeCells?.[1].hasClass('is-node')).toBe(true);
		expect(typeCells?.[0].querySelector('.wn-trajectory-node')?.textContent).toBe('第 10 天');
		expect(typeCells?.[1].querySelector('.wn-trajectory-node')?.textContent).toBe('第 10 天');

		// Event cards in Lore 1 lane have subtle type colors matching their respective types
		const eventCards = container
			.querySelectorAll('.wn-trajectory-event')
			.filter(el => el.className.split(' ').includes('wn-trajectory-event'));
		expect(eventCards.length).toBe(2);
		expect(eventCards[0].style['--wn-trajectory-type-color']).toBe('var(--color-blue)'); // Main
		expect(eventCards[1].style['--wn-trajectory-type-color']).toBe('var(--color-green)'); // Sub
	});

	it('shows one same-name same-type node and jumps to its first timeline occurrence', () => {
		const first: TimelineEntry = { time: '第 10 天', type: 'Main', lores: ['甲'], description: '甲事件', chapter: '', rawBlock: '' };
		const second: TimelineEntry = { time: '第 10 天', type: 'Main', lores: ['乙'], description: '乙事件', chapter: '', rawBlock: '' };
		const onOpenEntry = vi.fn().mockResolvedValue(undefined);
		renderTrajectoryMode({ app: mockApp, container: container as unknown as HTMLElement, displayEntries: [second, first], allEntries: [first, second], resolveLinkToFile, onOpenEntry });
		const grid = container.querySelector('.wn-trajectory-grid');
		expect(grid?.style.gridTemplateColumns).toBe('max-content repeat(1, 14rem)');
		const nodes = grid?.querySelectorAll('.wn-trajectory-node') || [];
		expect(nodes).toHaveLength(1);
		expect(nodes[0].textContent).toBe('第 10 天');
		const loreCells = grid?.querySelectorAll('.wn-trajectory-cell.is-lore') || [];
		expect(loreCells[0].style['--traj-col']).toBe('2');
		expect(loreCells[1].style['--traj-col']).toBe('2');
		expect(loreCells[0].querySelector('.wn-trajectory-event-text')?.textContent).toBe('乙事件');
		expect(loreCells[1].querySelector('.wn-trajectory-event-text')?.textContent).toBe('甲事件');
		nodes[0].onclick?.({ stopPropagation: vi.fn() });
		expect(onOpenEntry).toHaveBeenCalledExactlyOnceWith(first, 0);
	});

	it('opens the correct same-name node from its type row by mouse or keyboard', async () => {
		const mainEntry: TimelineEntry = { time: '第 10 天', type: 'Main', description: 'Main event', chapter: '', rawBlock: '' };
		const subEntry: TimelineEntry = { time: '第 10 天', type: 'Sub', description: 'Sub event', chapter: '', rawBlock: '' };
		const onOpenEntry = vi.fn().mockResolvedValue(undefined);
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [subEntry, mainEntry],
			allEntries: [mainEntry, subEntry],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile,
			onOpenEntry
		});

		const nodes = container.querySelectorAll('.wn-trajectory-node');
		expect(nodes).toHaveLength(2);
		expect(nodes[0].getAttribute('role')).toBe('button');
		expect(nodes[0].tabIndex).toBe(0);
		nodes[0].onclick?.({ stopPropagation: vi.fn() });
		expect(onOpenEntry).toHaveBeenCalledWith(subEntry, 1);
		nodes[1].onkeydown?.({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(onOpenEntry).toHaveBeenCalledWith(mainEntry, 0);
	});

	it('preserves event-level types and original index when updating description of mixed-type node', async () => {
		const { getStickyNoteEditorContent } = await import('../src/ui/components/StickyNoteParagraphEditor.js');
		vi.mocked(getStickyNoteEditorContent).mockReturnValue('Updated content');

		const mixedEntry: TimelineEntry = {
			time: '第 10 天',
			description: 'Main event',
			chapter: '',
			lores: ['Lore 1'],
			rawBlock: '',
			items: [
				{ description: 'Main event', chapter: '', type: 'Main' },
				{ description: 'Sub event', chapter: '', type: 'Sub' }
			]
		};
		const onUpdateEntry = vi.fn().mockResolvedValue(undefined);

		await renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [mixedEntry],
			allEntries: [mixedEntry],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile,
			onUpdateEntry
		});

		const textDivs = container.querySelectorAll('.wn-trajectory-event-text');
		expect(textDivs.length).toBe(2);

		// Click on second event (Sub event)
		textDivs[1].onclick!({ stopPropagation: vi.fn() });
		expect(textDivs[1].hasClass('is-editing')).toBe(true);

		textDivs[1].blur();
		await Promise.resolve();

		expect(onUpdateEntry).toHaveBeenCalledWith(0, expect.objectContaining({
			items: [
				{ description: 'Main event', chapter: '', type: 'Main' },
				{ description: 'Updated content', chapter: '', type: 'Sub' }
			]
		}), expect.anything());
	});

	it('type filter keeps only matching event cards and their type lane in a mixed node', () => {
		const entry: TimelineEntry = { time: '同名节点', type: 'Sub', description: '', chapter: '', rawBlock: '', items: [{ description: 'Sub event', chapter: '' }] };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			typeFilter: ['Sub'],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile
		});
		expect(container.querySelectorAll('.wn-trajectory-lane-header.is-type').map(el => el.textContent)).toEqual(['Sub']);
		expect(container.querySelectorAll('.wn-trajectory-event-text').map(el => el.textContent)).toEqual(['Sub event']);
	});

	it('type filter supports multi-selection, filters lore rows consistently, and untyped entries appear under all', () => {
		const mainEntry: TimelineEntry = {
			time: 'Day 1',
			type: 'Main',
			description: 'Main event',
			chapter: '',
			rawBlock: '',
			lores: ['MainLore'],
			items: [{ description: 'Main event', chapter: '' }]
		};
		const subEntry: TimelineEntry = {
			time: 'Day 2',
			type: 'Sub',
			description: 'Sub event',
			chapter: '',
			rawBlock: '',
			lores: ['SubLore'],
			items: [{ description: 'Sub event', chapter: '' }]
		};
		const untypedEntry: TimelineEntry = {
			time: 'Day 3',
			description: 'Legacy event',
			chapter: '',
			rawBlock: '',
			lores: ['LegacyLore'],
			items: [{ description: 'Legacy event', chapter: '' }]
		};

		// 1. Filter with ['Sub']: only subEntry matching. MainLore and LegacyLore should NOT appear.
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [mainEntry, subEntry, untypedEntry],
			typeFilter: ['Sub'],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile
		});
		expect(container.querySelectorAll('.wn-trajectory-lane-header.is-type').map(el => el.textContent)).toEqual(['Sub']);
		const loreHeaders = container.querySelectorAll('.wn-trajectory-lane-header.is-lore').map(el => el.textContent);
		expect(loreHeaders).toContain('SubLore');
		expect(loreHeaders).not.toContain('MainLore');
		expect(loreHeaders).not.toContain('LegacyLore');

		// 2. Filter with ['Main', 'Sub']: both Main and Sub retained, untyped excluded
		container = new MockElement('root');
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [mainEntry, subEntry, untypedEntry],
			typeFilter: ['Main', 'Sub'],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile
		});
		const typeHeaders = container.querySelectorAll('.wn-trajectory-lane-header.is-type').map(el => el.textContent);
		expect(typeHeaders).toContain('Main');
		expect(typeHeaders).toContain('Sub');
		const loreHeaders2 = container.querySelectorAll('.wn-trajectory-lane-header.is-lore').map(el => el.textContent);
		expect(loreHeaders2).toContain('MainLore');
		expect(loreHeaders2).toContain('SubLore');
		expect(loreHeaders2).not.toContain('LegacyLore');

		// 3. Filter with []: all entries retained, untyped entry gets fallback 'Main' lane
		container = new MockElement('root');
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [mainEntry, subEntry, untypedEntry],
			typeFilter: [],
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile
		});
		const allLoreHeaders = container.querySelectorAll('.wn-trajectory-lane-header.is-lore').map(el => el.textContent);
		expect(allLoreHeaders).toContain('MainLore');
		expect(allLoreHeaders).toContain('SubLore');
		expect(allLoreHeaders).toContain('LegacyLore');
	});

	it('renders a single intact chapter marker for chapter containing comma', () => {
		const entry: TimelineEntry = {
			time: 'Day 1',
			description: 'Event A',
			chapter: '["Chapter 1, Hello"]',
			items: [{ description: 'Event A', chapter: '["Chapter 1, Hello"]', type: 'Main' }],
			rawBlock: ''
		};
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allTypes: ['Main'],
			resolveLinkToFile
		});
		const markers = container.querySelectorAll('.wn-trajectory-chapter-marker');
		expect(markers).toHaveLength(1);
		expect(markers[0].textContent).toBe('Chapter 1, Hello');
	});

	it('preserves pan and zoom after editing, blurs without calling reloadBoard, and updates duplicate lore cards in-place', async () => {
		const entry: TimelineEntry = {
			time: 'Day 1',
			description: '',
			chapter: '',
			lores: ['Lore 1', 'Lore 2'],
			rawBlock: '',
			items: [{ description: 'Original Text', chapter: '' }]
		};
		const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
		const reloadBoard = vi.fn();

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			reloadBoard
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;

		// Pan canvas
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'mouse',
			button: 0,
			pointerId: 1,
			clientX: 100,
			clientY: 100,
			target: { closest: () => null }
		});
		layout.dispatchEvent({
			type: 'pointermove',
			pointerId: 1,
			clientX: 200,
			clientY: 150,
			preventDefault: vi.fn()
		});
		layout.dispatchEvent({
			type: 'pointerup',
			pointerId: 1
		});

		expect(grid.style.transform).toBe('translate3d(100px, 50px, 0) scale(1)');

		// Find duplicate cards across Lore 1 and Lore 2 lanes
		const textDivs = container.querySelectorAll('.wn-trajectory-event-text');
		expect(textDivs).toHaveLength(2);

		// Edit first card
		textDivs[0].onclick!({ stopPropagation: vi.fn() });
		expect(textDivs[0].hasClass('is-editing')).toBe(true);

		const { getStickyNoteEditorContent } = await import('../src/ui/components/StickyNoteParagraphEditor.js');
		vi.mocked(getStickyNoteEditorContent).mockReturnValue('New Description');

		textDivs[0].blur();
		await vi.waitFor(() => expect(onUpdateEntry).toHaveBeenCalledOnce());

		// Critical: reloadBoard must NOT be called on blur save!
		expect(reloadBoard).not.toHaveBeenCalled();

		// Transform pan and zoom must be preserved
		expect(grid.style.transform).toBe('translate3d(100px, 50px, 0) scale(1)');

		// Both first card and duplicate card must be updated in-place
		expect(textDivs[0].hasClass('is-editing')).toBe(false);
		expect(textDivs[0].textContent).toBe('New Description');
		expect(textDivs[1].textContent).toBe('New Description');
	});

	it('handles two-finger pinch zoom centered at midpoint, clamping to [0.5, 2]', () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;

		// Finger 1 down at (100, 100)
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'touch',
			pointerId: 10,
			clientX: 100,
			clientY: 100,
			target: { closest: () => null }
		});
		// Finger 2 down at (200, 100) - distance = 100, midpoint = (150, 100)
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'touch',
			pointerId: 20,
			clientX: 200,
			clientY: 100,
			target: { closest: () => null }
		});

		// Fingers spread: finger 1 moves to (50, 100), finger 2 moves to (250, 100) - distance = 200, 2x scale
		layout.dispatchEvent({
			type: 'pointermove',
			pointerType: 'touch',
			pointerId: 10,
			clientX: 50,
			clientY: 100,
			preventDefault: vi.fn()
		});
		layout.dispatchEvent({
			type: 'pointermove',
			pointerType: 'touch',
			pointerId: 20,
			clientX: 250,
			clientY: 100,
			preventDefault: vi.fn()
		});

		// Scale should now be 2
		expect(grid.style.transform).toContain('scale(2)');
	});

	it('stops propagation of touchstart, touchmove, touchend, and touchcancel on trajectory', () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		for (const evtName of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
			const stopProp = vi.fn();
			layout.dispatchEvent({
				type: evtName,
				stopPropagation: stopProp
			});
			expect(stopProp).toHaveBeenCalledOnce();
		}
	});

	it('allows touch drag starting on non-editing event card to pan without activating edit', () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry: vi.fn()
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;
		const textDiv = container.querySelector('.wn-trajectory-event-text')!;

		// Touch down on card
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'touch',
			pointerId: 5,
			clientX: 100,
			clientY: 100,
			target: textDiv
		});

		// Drag beyond 3px threshold
		layout.dispatchEvent({
			type: 'pointermove',
			pointerType: 'touch',
			pointerId: 5,
			clientX: 150,
			clientY: 120,
			preventDefault: vi.fn()
		});

		expect(grid.style.transform).toBe('translate3d(50px, 20px, 0) scale(1)');
		expect(layout.hasClass('is-panning')).toBe(true);

		// Touch up
		layout.dispatchEvent({
			type: 'pointerup',
			pointerType: 'touch',
			pointerId: 5
		});

		// Trailing click should be suppressed
		const stopImmediate = vi.fn();
		layout.dispatchEvent({
			type: 'click',
			stopPropagation: vi.fn(),
			stopImmediatePropagation: stopImmediate,
			preventDefault: vi.fn()
		});

		expect(stopImmediate).toHaveBeenCalledOnce();
		expect(textDiv.hasClass('is-editing')).toBe(false);
	});

	it.each([
		['is-tablet', 'modal-close-button', 'click'],
		['is-tablet', 'modal-header-button', 'click'],
		['is-phone', 'modal-close-button', 'Enter'],
		['is-phone', 'modal-header-button', ' ']
	])('opens %s fullscreen with only minimize when native control is %s and restores layout via %s', (deviceClass, closeButtonClass, exitAction) => {
		container.ownerDocument.body.addClass(deviceClass);
		modalMockOptions.closeButtonClass = closeButtonClass;
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const expandBtn = layout.querySelector('.wn-trajectory-expand-btn');
		expect(expandBtn).toBeTruthy();

		// Click expand button to open fullscreen
		expandBtn?.onclick?.({ stopPropagation: vi.fn() });

		// Layout should now be inside the fullscreen shell
		const shell = layout.parentElement;
		expect(shell?.hasClass('wn-trajectory-fullscreen-shell')).toBe(true);

		// Exit button exists
		const exitBtn = shell?.querySelector('.wn-trajectory-exit-btn');
		expect(exitBtn).toBeTruthy();
		expect(exitBtn?.getAttribute('data-icon')).toBe('minimize');
		expect(shell?.parentElement?.parentElement?.querySelector('.modal-close-button')).toBeNull();
		expect(shell?.parentElement?.parentElement?.querySelector('.modal-header-button')).toBeNull();

		// Close through the remaining minimize control by mouse or keyboard
		if (exitAction === 'click') {
			exitBtn?.onclick?.({ stopPropagation: vi.fn() });
		} else {
			exitBtn?.onkeydown?.({ key: exitAction, preventDefault: vi.fn(), stopPropagation: vi.fn() });
		}

		// Layout should now be restored back to container!
		expect(layout.parentElement).toBe(container);
	});

	it('rotates 90 degrees on mobile portrait, maps rotated coords, and prevents rotation flip on keyboard resize', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		const doc = container.ownerDocument;
		const win = doc.defaultView as unknown as { innerWidth: number; innerHeight: number; listeners: Record<string, Array<() => void>> };
		doc.body.addClass('is-phone');

		// Set portrait dimensions: width 400 < height 800
		win.innerWidth = 400;
		win.innerHeight = 800;

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;
		const expandBtn = layout.querySelector('.wn-trajectory-expand-btn');

		expandBtn?.onclick?.({ stopPropagation: vi.fn() });

		const shell = layout.parentElement!;
		expect(shell.hasClass('wn-trajectory-fullscreen-shell')).toBe(true);

		// Shell should be rotated 90 degrees with swapped dimensions
		expect(shell.style.transform).toBe('translate(400px, 0px) rotate(90deg)');
		expect(shell.style.width).toBe('800px');
		expect(shell.style.height).toBe('400px');

		// Simulate touch drag in rotated space:
		// In rotated coords: localX = screenY, localY = W - screenX (W = 400)
		// Pointer down at screen (200, 100) -> local (100, 200)
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'touch',
			pointerId: 10,
			clientX: 200,
			clientY: 100,
			target: { closest: () => null }
		});

		// Pointer move to screen (200, 160) -> local (160, 200) -> distanceX = +60, distanceY = 0
		layout.dispatchEvent({
			type: 'pointermove',
			pointerType: 'touch',
			pointerId: 10,
			clientX: 200,
			clientY: 160,
			preventDefault: vi.fn()
		});

		expect(grid.style.transform).toBe('translate3d(60px, 0px, 0) scale(1)');

		layout.dispatchEvent({
			type: 'pointerup',
			pointerType: 'touch',
			pointerId: 10
		});

		// Simulate virtual keyboard appearance: height shrinks to 450, but width remains 400!
		win.innerHeight = 450;
		for (const l of win.listeners['resize'] || []) l();

		// Should NOT flip orientation back to normal! Shell should still be rotated!
		expect(shell.style.transform).toBe('translate(400px, 0px) rotate(90deg)');
		expect(shell.style.height).toBe('400px');
		expect(shell.style.width).toBe('450px');

		// Close modal
		const exitBtn = shell.querySelector('.wn-trajectory-exit-btn');
		exitBtn?.onclick?.({ stopPropagation: vi.fn() });
		expect(layout.parentElement).toBe(container);
	});

	it('unloading ownerComponent cleans up fullscreen modal without restoring into detached host', () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		const unregisterFns: Array<() => void> = [];
		const mockOwnerComponent = {
			register: vi.fn((fn: () => void) => unregisterFns.push(fn))
		};

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile,
			ownerComponent: mockOwnerComponent as unknown as import('obsidian').Component
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const expandBtn = layout.querySelector('.wn-trajectory-expand-btn');
		expandBtn?.onclick?.({ stopPropagation: vi.fn() });

		const shell = layout.parentElement!;
		expect(shell.hasClass('wn-trajectory-fullscreen-shell')).toBe(true);

		// Simulate component unload
		for (const fn of unregisterFns) fn();

		// Layout should NOT be re-inserted into container, and modal is cleaned up
		expect(container.querySelector('.wn-trajectory-fullscreen-placeholder')).toBeNull();
	});

	it('reverts DOM and displays localized Notice when save fails', async () => {
		const { Notice } = await import('obsidian');
		vi.mocked(Notice).mockClear();

		const entry: TimelineEntry = { time: 'Day 1', description: 'Initial', chapter: '', lores: ['Lore 1'], rawBlock: '' };
		const onUpdateEntry = vi.fn().mockRejectedValue(new Error('Disk write failed'));
		const reloadBoard = vi.fn();
		const onSaveStateChange = vi.fn();

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			reloadBoard,
			onSaveStateChange
		});

		const textDiv = container.querySelector('.wn-trajectory-event-text')!;
		textDiv.onclick!({ stopPropagation: vi.fn() });

		const { getStickyNoteEditorContent } = await import('../src/ui/components/StickyNoteParagraphEditor.js');
		vi.mocked(getStickyNoteEditorContent).mockReturnValue('Failed Text');

		textDiv.blur();
		await vi.waitFor(() => expect(onUpdateEntry).toHaveBeenCalledOnce());

		expect(onSaveStateChange).toHaveBeenCalledWith(true);
		expect(onSaveStateChange).toHaveBeenCalledWith(false);
		expect(Notice).toHaveBeenCalledWith('Failed to save trajectory event description.');
		expect(reloadBoard).not.toHaveBeenCalled();

		// DOM should be rolled back to initial description
		expect(textDiv.textContent).toBe('Initial');
		expect(textDiv.hasClass('is-editing')).toBe(false);

		// Can re-edit after failure
		textDiv.onclick!({ stopPropagation: vi.fn() });
		expect(textDiv.hasClass('is-editing')).toBe(true);
	});

	it('preserves ephemeral viewport across late metadata refresh and resets on book change', () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };

		// 1. Initial render with BookA
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookA'
		});

		const layout1 = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid1 = container.querySelector('.wn-trajectory-grid')!;

		// Pan and zoom
		layout1.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'mouse',
			button: 0,
			pointerId: 1,
			clientX: 100,
			clientY: 100,
			target: { closest: () => null }
		});
		layout1.dispatchEvent({
			type: 'pointermove',
			pointerId: 1,
			clientX: 250,
			clientY: 200,
			preventDefault: vi.fn()
		});
		layout1.dispatchEvent({
			type: 'pointerup',
			pointerId: 1
		});

		expect(grid1.style.transform).toBe('translate3d(150px, 100px, 0) scale(1)');

		// 2. Late metadata refresh arrives for BookA (re-rendering into container)
		container.empty();
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookA'
		});

		const grid2 = container.querySelector('.wn-trajectory-grid')!;
		// Ephemeral viewport should be restored!
		expect(grid2.style.transform).toBe('translate3d(150px, 100px, 0) scale(1)');

		// 3. User switches work to BookB -> clearTrajectoryViewport
		clearTrajectoryViewport(container as unknown as object);
		container.empty();
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookB'
		});

		const grid3 = container.querySelector('.wn-trajectory-grid')!;
		// Should reset to initial (0, 0, 1)
		expect(grid3.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
	});

	it('removes contenteditable, aria-multiline, spellcheck on blur and allows dragging across previously edited card without accumulating input listeners', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Original note', chapter: '', lores: [], rawBlock: '' };
		const onUpdateEntry = vi.fn().mockResolvedValue(undefined);

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;
		const textDiv = container.querySelector('.wn-trajectory-event-text')!;

		// Click to edit
		textDiv.onclick!({ stopPropagation: vi.fn() });
		expect(textDiv.hasClass('is-editing')).toBe(true);
		expect(textDiv.getAttribute('contenteditable')).toBe('plaintext-only');
		expect(textDiv.getAttribute('role')).toBe('textbox');
		expect(textDiv.getAttribute('aria-multiline')).toBe('true');
		expect(textDiv.getAttribute('spellcheck')).toBe('true');

		// Blur to finish edit
		textDiv.blur();
		await Promise.resolve();

		// Real read mode restored: all editing attributes removed!
		expect(textDiv.hasClass('is-editing')).toBe(false);
		expect(textDiv.getAttribute('contenteditable')).toBeNull();
		expect(textDiv.getAttribute('role')).toBe('button');
		expect(textDiv.getAttribute('aria-multiline')).toBeNull();
		expect(textDiv.getAttribute('spellcheck')).toBeNull();

		// Dragging across this card must NOT be blocked by [contenteditable]!
		layout.dispatchEvent({
			type: 'pointerdown',
			pointerType: 'touch',
			pointerId: 1,
			clientX: 50,
			clientY: 50,
			target: textDiv
		});
		layout.dispatchEvent({
			type: 'pointermove',
			pointerId: 1,
			clientX: 120,
			clientY: 80,
			preventDefault: vi.fn()
		});
		layout.dispatchEvent({
			type: 'pointerup',
			pointerId: 1
		});

		// Panning succeeded!
		expect(grid.style.transform).toBe('translate3d(70px, 30px, 0) scale(1)');

		// Re-editing works smoothly
		textDiv.onclick!({ stopPropagation: vi.fn() });
		expect(textDiv.hasClass('is-editing')).toBe(true);
		expect(textDiv.getAttribute('contenteditable')).toBe('plaintext-only');
	});

	it('isolates viewports between different leaves viewing the same book and does not restore old viewport on leaf clear or A->B->A switch', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		const leaf1 = { id: 'leaf-1' };
		const leaf2 = { id: 'leaf-2' };

		const container1 = new MockElement();
		const container2 = new MockElement();

		// 1. Render leaf1 with BookA and pan
		renderTrajectoryMode({
			app: mockApp,
			container: container1 as unknown as HTMLElement,
			sourceLeaf: leaf1 as unknown as import('obsidian').WorkspaceLeaf,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookA'
		});
		const layout1 = container1.querySelector('.wn-timeline-trajectory-layout')!;
		const grid1 = container1.querySelector('.wn-trajectory-grid')!;
		layout1.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0, pointerId: 1, clientX: 0, clientY: 0, target: { closest: () => null } });
		layout1.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 100, clientY: 50, preventDefault: vi.fn() });
		layout1.dispatchEvent({ type: 'pointerup', pointerId: 1 });
		expect(grid1.style.transform).toBe('translate3d(100px, 50px, 0) scale(1)');

		// 2. Render leaf2 with SAME BookA -> MUST be isolated, starts at (0,0,1)
		renderTrajectoryMode({
			app: mockApp,
			container: container2 as unknown as HTMLElement,
			sourceLeaf: leaf2 as unknown as import('obsidian').WorkspaceLeaf,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookA'
		});
		const grid2 = container2.querySelector('.wn-trajectory-grid')!;
		expect(grid2.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');

		// 3. Clear leaf1 -> resets leaf1 viewport
		clearTrajectoryViewport(leaf1 as unknown as import('obsidian').WorkspaceLeaf);
		container1.empty();
		renderTrajectoryMode({
			app: mockApp,
			container: container1 as unknown as HTMLElement,
			sourceLeaf: leaf1 as unknown as import('obsidian').WorkspaceLeaf,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookA'
		});
		const grid1Reset = container1.querySelector('.wn-trajectory-grid')!;
		expect(grid1Reset.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');

		// 4. Switch A -> B -> A on leaf1
		const layout1Reset = container1.querySelector('.wn-timeline-trajectory-layout')!;
		layout1Reset.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0, pointerId: 1, clientX: 0, clientY: 0, target: { closest: () => null } });
		layout1Reset.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 200, clientY: 100, preventDefault: vi.fn() });
		layout1Reset.dispatchEvent({ type: 'pointerup', pointerId: 1 });

		clearTrajectoryViewport(leaf1 as unknown as import('obsidian').WorkspaceLeaf);
		container1.empty();
		renderTrajectoryMode({
			app: mockApp,
			container: container1 as unknown as HTMLElement,
			sourceLeaf: leaf1 as unknown as import('obsidian').WorkspaceLeaf,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookB'
		});

		clearTrajectoryViewport(leaf1 as unknown as import('obsidian').WorkspaceLeaf);
		container1.empty();
		renderTrajectoryMode({
			app: mockApp,
			container: container1 as unknown as HTMLElement,
			sourceLeaf: leaf1 as unknown as import('obsidian').WorkspaceLeaf,
			displayEntries: [entry],
			resolveLinkToFile,
			currentBookPath: 'BookA'
		});
		const grid1AfterReturn = container1.querySelector('.wn-trajectory-grid')!;
		expect(grid1AfterReturn.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
	});

	it('keeps fullscreen open across same-session late metadata refresh and commits pending editor text on component unload', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Initial', chapter: '', lores: [], rawBlock: '' };
		const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
		const leaf = { id: 'leaf-fs' };
		const unregisterFns1: Array<() => void> = [];
		const mockOwnerComponent1 = {
			register: vi.fn((fn: () => void) => unregisterFns1.push(fn))
		};

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			sourceLeaf: leaf as unknown as import('obsidian').WorkspaceLeaf,
			ownerComponent: mockOwnerComponent1 as unknown as import('obsidian').Component,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			currentBookPath: 'BookFS'
		});

		const layout1 = container.querySelector('.wn-timeline-trajectory-layout')!;
		const expandBtn = layout1.querySelector('.wn-trajectory-expand-btn')!;
		expandBtn.onclick!({ stopPropagation: vi.fn() });

		const shell1 = layout1.parentElement!;
		expect(shell1.hasClass('wn-trajectory-fullscreen-shell')).toBe(true);

		// Now simulate late metadata refresh: buffer render with mockOwnerComponent2
		const unregisterFns2: Array<() => void> = [];
		const mockOwnerComponent2 = {
			register: vi.fn((fn: () => void) => unregisterFns2.push(fn))
		};
		const buffer = new MockElement();
		renderTrajectoryMode({
			app: mockApp,
			container: buffer as unknown as HTMLElement,
			sourceLeaf: leaf as unknown as import('obsidian').WorkspaceLeaf,
			ownerComponent: mockOwnerComponent2 as unknown as import('obsidian').Component,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			currentBookPath: 'BookFS'
		});

		const layout2 = buffer.querySelector('.wn-timeline-trajectory-layout')!;
		expect(layout2).not.toBeNull();

		// Swap DOM: buffer to container, unload previous component
		container.empty();
		while (buffer.children.length > 0) {
			container.appendChild(buffer.children[0]);
		}
		for (const fn of unregisterFns1) fn();

		// Flush RAF to reopen fullscreen
		MockElement.sharedDocument.defaultView.flushRaf();

		const shell2 = layout2.parentElement!;
		// Fullscreen was re-opened for the refreshed layout!
		expect(shell2.hasClass('wn-trajectory-fullscreen-shell')).toBe(true);

		// Exit fullscreen manually
		const exitBtn = shell2.querySelector('.wn-trajectory-exit-btn')!;
		exitBtn.onclick!({ stopPropagation: vi.fn() });
		expect(layout2.parentElement).toBe(container);

		// Subsequent render does NOT open fullscreen
		container.empty();
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			sourceLeaf: leaf as unknown as import('obsidian').WorkspaceLeaf,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			currentBookPath: 'BookFS'
		});
		const layout3 = container.querySelector('.wn-timeline-trajectory-layout')!;
		expect(layout3.parentElement).toBe(container);
	});

	it('serializes concurrent saves on the same entry, isolates cloned snapshots, and handles failure rollback without corrupting subsequent saves', async () => {
		const entry: TimelineEntry = {
			time: 'Day 1',
			description: 'Entry desc',
			chapter: '',
			lores: ['Lore 1'],
			rawBlock: '',
			items: [
				{ description: 'Item 0 original', chapter: '', important: false },
				{ description: 'Item 1 original', chapter: '', important: false }
			]
		};

		let resolveItem0: () => void = () => {};
		let rejectItem0: (err: Error) => void = () => {};
		const item0SaveGate = new Promise<void>((res, rej) => { resolveItem0 = res; rejectItem0 = rej; });

		const saveCalls: Array<{ index: number; entry: TimelineEntry }> = [];
		const onUpdateEntry = vi.fn().mockImplementation((idx: number, ent: TimelineEntry) => {
			saveCalls.push({ index: idx, entry: JSON.parse(JSON.stringify(ent)) as TimelineEntry });
			if (saveCalls.length === 1) {
				return item0SaveGate;
			}
			return Promise.resolve();
		});

		const onSaveStateChange = vi.fn();

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry,
			onSaveStateChange
		});

		const cards = container.querySelectorAll('.wn-trajectory-event-text');
		expect(cards).toHaveLength(2);

		// 1. Edit Item 0
		cards[0].onclick!({ stopPropagation: vi.fn() });
		// 2. Blur Item 0 -> triggers save 0 (which waits on item0SaveGate)
		cards[0].blur();
		expect(onSaveStateChange).toHaveBeenCalledWith(true);
		expect(saveCalls).toHaveLength(1);
		expect(saveCalls[0].entry.items![0].description).toBe('Updated content');

		// 3. Immediately edit Item 1 while save 0 is still in flight
		cards[1].onclick!({ stopPropagation: vi.fn() });
		cards[1].blur();

		// Save 1 is queued behind save 0
		expect(saveCalls).toHaveLength(1);

		// 4. Save 0 fails!
		rejectItem0(new Error('Item 0 network timeout'));
		await vi.waitFor(() => expect(saveCalls).toHaveLength(2));
		expect(saveCalls[1].entry.items![1].description).toBe('Updated content');

		await Promise.resolve();
		await Promise.resolve();

		// Item 0 was rolled back to original!
		expect(cards[0].textContent).toBe('Item 0 original');
		// Item 1 was NOT corrupted by Item 0's rollback and successfully saved!
		expect(cards[1].textContent).toBe('Updated content');
		expect(onSaveStateChange).toHaveBeenLastCalledWith(false);
	});

	it('does not include queued edits in an earlier save snapshot when the queued save fails', async () => {
		const entry: TimelineEntry = {
			time: 'Day 1', description: '', chapter: '', rawBlock: '',
			items: [{ description: 'First', chapter: '' }, { description: 'Second', chapter: '' }]
		};
		let finishFirst!: () => void;
		let failSecond!: (error: Error) => void;
		const firstSave = new Promise<void>(resolve => { finishFirst = resolve; });
		const secondSave = new Promise<void>((_, reject) => { failSecond = reject; });
		const snapshots: TimelineEntry[] = [];
		const onUpdateEntry = vi.fn((_index: number, snapshot: TimelineEntry) => {
			snapshots.push(snapshot);
			return snapshots.length === 1 ? firstSave : secondSave;
		});
		renderTrajectoryMode({ app: mockApp, container: container as unknown as HTMLElement,
			displayEntries: [entry], allEntries: [entry], resolveLinkToFile, onUpdateEntry });
		const cards = container.querySelectorAll('.wn-trajectory-event-text');
		cards[0].onclick!({ stopPropagation: vi.fn() });
		cards[0].blur();
		cards[1].onclick!({ stopPropagation: vi.fn() });
		cards[1].blur();
		// Queued text is visible, but must not mutate the committed entry yet.
		expect(cards[1].textContent).toBe('Updated content');
		expect(entry.items![1].description).toBe('Second');
		finishFirst();
		await vi.waitFor(() => expect(snapshots).toHaveLength(2));
		expect(snapshots[0].items![1].description).toBe('Second');
		failSecond(new Error('Second save failed'));
		await vi.waitFor(() => expect(cards[1].textContent).toBe('Second'));
		expect(entry.items!.map(item => item.description)).toEqual(['Updated content', 'Second']);
	});

	it('queued trajectory edits of different items in same node succeed sequentially without false conflict when manager strictly checks snapshot', async () => {
		const entry: TimelineEntry = {
			time: 'Day 1', description: '', chapter: '', rawBlock: '',
			items: [{ description: 'First', chapter: '' }, { description: 'Second', chapter: '' }]
		};
		let currentEntry: TimelineEntry = {
			...entry,
			items: entry.items ? entry.items.map(it => ({ ...it })) : []
		};
		const onUpdateEntry = vi.fn(async (_index: number, payload: TimelineEntry, expectedEntry?: TimelineEntry) => {
			if (expectedEntry) {
				const currentStr = JSON.stringify(currentEntry.items);
				const expectedStr = JSON.stringify(expectedEntry.items);
				if (currentStr !== expectedStr) {
					throw new Error('Conflict: expected snapshot does not match latest entry');
				}
			}
			currentEntry = {
				...payload,
				items: payload.items ? payload.items.map(it => ({ ...it })) : []
			};
		});

		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			allEntries: [entry],
			resolveLinkToFile,
			onUpdateEntry
		});

		const cards = container.querySelectorAll('.wn-trajectory-event-text');
		(getStickyNoteEditorContent as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue('First edited');
		cards[0].onclick!({ stopPropagation: vi.fn() });
		cards[0].blur();

		(getStickyNoteEditorContent as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue('Second edited');
		cards[1].onclick!({ stopPropagation: vi.fn() });
		cards[1].blur();

		await vi.waitFor(() => expect(onUpdateEntry).toHaveBeenCalledTimes(2));
		expect(currentEntry.items?.map(it => it.description)).toEqual(['First edited', 'Second edited']);
	});

	it('rebases pinch baseline on 3->2 pointer transition without jumping, handles lostpointercapture, and ignores extra mouse pointerdowns', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Test', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;

		// Start 2-finger pinch
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100, target: { closest: () => null } });
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 2, clientX: 200, clientY: 100, target: { closest: () => null } });
		// Move to double distance (100 -> 200) -> scale 2
		layout.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 50, clientY: 100, preventDefault: vi.fn() });
		layout.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: 250, clientY: 100, preventDefault: vi.fn() });
		expect(grid.style.transform).toContain('scale(2)');

		// Add 3rd finger
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 3, clientX: 150, clientY: 200, target: { closest: () => null } });

		// Lift finger 1 -> 3->2 transition rebases pinch without scale jumping
		layout.dispatchEvent({ type: 'pointerup', pointerId: 1 });
		// Move finger 2 slightly
		layout.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: 251, clientY: 100, preventDefault: vi.fn() });
		expect(grid.style.transform).toContain('scale(2)');

		// Trigger lostpointercapture -> no crash
		layout.dispatchEvent({ type: 'lostpointercapture', pointerId: 2 });

		// Mouse drag: extra mouse pointerdown while dragging is ignored
		layout.dispatchEvent({ type: 'pointerup', pointerId: 3 });
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0, pointerId: 10, clientX: 0, clientY: 0, target: { closest: () => null } });
		// Second mouse pointerdown should be ignored
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0, pointerId: 11, clientX: 50, clientY: 50, target: { closest: () => null } });
		layout.dispatchEvent({ type: 'pointermove', pointerId: 10, clientX: 50, clientY: 0, preventDefault: vi.fn() });
		layout.dispatchEvent({ type: 'pointerup', pointerId: 10 });
	});

	it('ignores child lostpointercapture when touch capture moves to the canvas, and permits the next control tap', () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', rawBlock: '' };
		renderTrajectoryMode({ app: mockApp, container: container as unknown as HTMLElement,
			displayEntries: [entry], resolveLinkToFile });
		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const grid = container.querySelector('.wn-trajectory-grid')!;
		const card = container.querySelector('.wn-trajectory-event-text')!;
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0, target: card });
		layout.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 20, clientY: 0, preventDefault: vi.fn() });
		layout.dispatchEvent({ type: 'lostpointercapture', pointerId: 1, target: card });
		layout.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 40, clientY: 0, preventDefault: vi.fn() });
		expect(grid.style.transform).toBe('translate3d(40px, 0px, 0) scale(1)');
		layout.dispatchEvent({ type: 'pointerup', pointerId: 1 });
		// A drag need not emit a click. The next deliberate control tap must still work.
		const expand = layout.querySelector('.wn-trajectory-expand-btn')!;
		layout.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', pointerId: 2, clientX: 0, clientY: 0, target: expand });
		const preventDefault = vi.fn();
		layout.dispatchEvent({ type: 'click', preventDefault, stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() });
		expect(preventDefault).not.toHaveBeenCalled();
	});

	it('handles virtual keyboard appearance during mobile portrait fullscreen by shrinking shell height to visualViewport visible area without flipping rotation', async () => {
		const doc = MockElement.sharedDocument;
		const win = doc.defaultView;
		doc.body.addClass('is-phone');

		win.innerWidth = 400;
		win.innerHeight = 800;
		win.visualViewport.width = 400;
		win.visualViewport.height = 800;

		const entry: TimelineEntry = { time: 'Day 1', description: 'Event', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const expandBtn = layout.querySelector('.wn-trajectory-expand-btn')!;
		expandBtn.onclick!({ stopPropagation: vi.fn() });

		const shell = layout.parentElement!;
		expect(shell.hasClass('is-rotated-90')).toBe(true);
		expect(shell.style.width).toBe('800px');
		expect(shell.style.height).toBe('400px');

		// Virtual keyboard pops up: height drops to 300px (< width 400px)
		win.visualViewport.height = 300;
		win.visualViewport.dispatchEvent({ type: 'resize' });

		// Rotation is PRESERVED, and shell width is resized to 300px visible height
		expect(shell.hasClass('is-rotated-90')).toBe(true);
		expect(shell.style.width).toBe('300px');
		expect(shell.style.height).toBe('400px');

		doc.body.removeClass('is-phone');
	});

	it('TrajectoryFullscreenModal restores layout to container synchronously on close() before super.close()', async () => {
		const entry: TimelineEntry = { time: 'Day 1', description: 'Test', chapter: '', lores: [], rawBlock: '' };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			resolveLinkToFile
		});

		const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
		const expandBtn = layout.querySelector('.wn-trajectory-expand-btn')!;
		expandBtn.onclick!({ stopPropagation: vi.fn() });

		const shell = layout.parentElement!;
		expect(shell.hasClass('wn-trajectory-fullscreen-shell')).toBe(true);
		// In container, layout has been moved out to modal shell
		expect(container.querySelector('.wn-timeline-trajectory-layout')).toBeNull();

		// Exit fullscreen
		const exitBtn = shell.querySelector('.wn-trajectory-exit-btn')!;
		exitBtn.onclick!({ stopPropagation: vi.fn() });

		// Layout is immediately restored to container
		expect(container.querySelector('.wn-timeline-trajectory-layout')).toBe(layout);
		expect(layout.parentElement).toBe(container);
	});

	describe('sparse trajectory rendering regression', () => {
		it('renders synthetic 500 time columns x 100 lores with cell count proportional to occupancy and correct row structure', async () => {
			const entries: TimelineEntry[] = [];
			for (let i = 0; i < 500; i++) {
				entries.push({
					time: `Day ${i + 1}`,
					description: `Event desc ${i + 1}`,
					chapter: `Chapter ${i + 1}`,
					lores: [`Lore ${i % 100}`],
					rawBlock: ''
				});
			}

			const onOpenEntry = vi.fn().mockResolvedValue(undefined);
			const onUpdateEntry = vi.fn();

			renderTrajectoryMode({
				app: mockApp,
				container: container as unknown as HTMLElement,
				displayEntries: entries,
				allEntries: entries,
				resolveLinkToFile,
				onOpenEntry,
				onUpdateEntry
			});

			const grid = container.querySelector('.wn-trajectory-grid')!;
			expect(grid).toBeTruthy();
			expect(grid.style.gridTemplateColumns).toBe('max-content repeat(500, 14rem)');

			// Headers: 1 type header ('Main') + 100 lore headers = 101 lane headers
			const headers = container.querySelectorAll('.wn-trajectory-lane-header');
			expect(headers.length).toBe(101);

			// Divider: 1
			const dividers = container.querySelectorAll('.wn-trajectory-divider');
			expect(dividers.length).toBe(1);

			// Lightweight lane backgrounds: 1 type lane bg + 100 lore lane bgs = 101
			const laneBgs = container.querySelectorAll('.wn-trajectory-lane-bg');
			expect(laneBgs.length).toBe(101);

			// Sparse cells: only occupied cells are rendered!
			// 500 occupied type node cells + 500 occupied lore cells = 1000 cells.
			// Old dense code created 50,500 cells (101 lanes * 500 columns).
			const cells = container.querySelectorAll('.wn-trajectory-cell');
			expect(cells.length).toBe(1000);

			// Check first and last entry node interaction
			const nodes = container.querySelectorAll('.wn-trajectory-node');
			expect(nodes.length).toBe(500);
			nodes[0].onclick!({ stopPropagation: vi.fn() });
			expect(onOpenEntry).toHaveBeenCalledWith(entries[0], 0);

			nodes[499].onclick!({ stopPropagation: vi.fn() });
			expect(onOpenEntry).toHaveBeenCalledWith(entries[499], 499);

			// Check event editing interaction
			const eventTexts = container.querySelectorAll('.wn-trajectory-event-text');
			expect(eventTexts.length).toBe(500);
			(getStickyNoteEditorContent as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue('Edited 500');
			eventTexts[499].onclick!({ stopPropagation: vi.fn() });
			eventTexts[499].blur();
			await vi.waitFor(() => expect(onUpdateEntry).toHaveBeenCalledWith(499, expect.objectContaining({ description: 'Edited 500' }), expect.anything()));
		});

		it('handles multi-lore event duplication, type same-time grouping, unassociated lane, and blank-area gestures', async () => {
			const entryMulti: TimelineEntry = {
				time: 'Day 1',
				description: 'Shared event',
				chapter: '',
				lores: ['LoreA', 'LoreB'],
				type: 'Plot',
				rawBlock: ''
			};
			const entrySameTime: TimelineEntry = {
				time: 'Day 1',
				description: 'Subplot event',
				chapter: '',
				lores: ['LoreA'],
				type: 'Character',
				rawBlock: ''
			};
			const entryUnassociated: TimelineEntry = {
				time: 'Day 2',
				description: 'Orphan event',
				chapter: '',
				lores: [],
				type: 'Plot',
				rawBlock: ''
			};
			const all = [entryMulti, entrySameTime, entryUnassociated];

			const onUpdateEntry = vi.fn();
			renderTrajectoryMode({
				app: mockApp,
				container: container as unknown as HTMLElement,
				displayEntries: all,
				allEntries: all,
				resolveLinkToFile,
				onUpdateEntry
			});

			// Columns: 'Day 1', 'Day 2' -> 2 columns
			const grid = container.querySelector('.wn-trajectory-grid')!;
			expect(grid.style.gridTemplateColumns).toBe('max-content repeat(2, 14rem)');

			// Types present: 'Plot', 'Character' -> 2 type rows
			// Lore lanes: Unassociated (first, because Day 2 has empty lores), LoreA, LoreB -> 3 lore lanes
			// Total lane headers: 2 + 3 = 5
			const headers = container.querySelectorAll('.wn-trajectory-lane-header');
			expect(headers.map(h => h.textContent)).toEqual(['Plot', 'Character', 'Unassociated lore', 'LoreA', 'LoreB']);

			// Lane bgs: 5
			const laneBgs = container.querySelectorAll('.wn-trajectory-lane-bg');
			expect(laneBgs.length).toBe(5);

			// Check span and styling on lane-bg
			// Grid columns: column 1 is header, data columns are 2 and 3 (span 2)
			expect(laneBgs[0].style['--traj-col']).toBe('2 / span 2');
			expect(laneBgs[0].hasClass('is-type')).toBe(true);
			expect(laneBgs[2].hasClass('is-lore')).toBe(true);

			// Occupied cells:
			// Type rows:
			// - Plot: Day 1 (col 2), Day 2 (col 3) -> 2 cells
			// - Character: Day 1 (col 2) -> 1 cell
			// Lore rows:
			// - Unassociated: Day 2 (col 3) -> 1 cell
			// - LoreA: Day 1 (col 2, containing both entryMulti and entrySameTime) -> 1 cell
			// - LoreB: Day 1 (col 2, containing entryMulti) -> 1 cell
			// Total cells: 2 + 1 + 1 + 1 + 1 = 6 cells!
			// In dense rendering, 5 lanes * 2 columns = 10 cells.
			const cells = container.querySelectorAll('.wn-trajectory-cell');
			expect(cells.length).toBe(6);

			// In LoreA lane (col 2), there are 2 events ('Shared event' and 'Subplot event')
			// In LoreB lane (col 2), there is 1 event ('Shared event')
			const eventTexts = container.querySelectorAll('.wn-trajectory-event-text');
			// Total event cards rendered: 1 (unassociated) + 2 (LoreA) + 1 (LoreB) = 4
			expect(eventTexts.length).toBe(4);

			// Event duplication across lores: editing 'Shared event' in LoreA also syncs LoreB DOM
			const loreAShared = eventTexts[1]; // LoreA first event
			const loreBShared = eventTexts[3]; // LoreB first event
			expect(loreAShared.textContent).toBe('Shared event');
			expect(loreBShared.textContent).toBe('Shared event');

			(getStickyNoteEditorContent as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue('Shared updated');
			loreAShared.onclick!({ stopPropagation: vi.fn() });
			loreAShared.blur();
			await vi.waitFor(() => expect(onUpdateEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: 'Shared updated' }), expect.anything()));
			expect(loreBShared.textContent).toBe('Shared updated');

			// Blank-area gesture behavior on lane background:
			// 1. Double click on lane bg resets zoom
			const layout = container.querySelector('.wn-timeline-trajectory-layout')!;
			// First zoom in via wheel
			layout.dispatchEvent({ type: 'wheel', deltaY: -100, clientX: 100, clientY: 100, preventDefault: vi.fn() });
			expect(grid.style.transform).not.toContain('scale(1)');

			// Double click on empty lane background resets scale to 1
			const bgTarget = laneBgs[0];
			layout.dispatchEvent({ type: 'dblclick', button: 0, target: bgTarget });
			expect(grid.style.transform).toContain('scale(1)');

			// 2. Pan starting on lane background
			layout.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 100, target: bgTarget });
			layout.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 150, clientY: 120, preventDefault: vi.fn() });
			expect(grid.style.transform).toBe('translate3d(39.5px, 9.5px, 0) scale(1)');
			layout.dispatchEvent({ type: 'pointerup', pointerId: 1 });
		});
	});

});
