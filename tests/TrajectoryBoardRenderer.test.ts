import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTrajectoryMode, type TrajectoryModeOptions } from '../src/ui/components/TrajectoryBoardRenderer';
import type { TimelineEntry } from '../src/services/TimelineManager';
import type { App, TFile } from 'obsidian';
import { openFileAndFocus } from '../src/utils/leaf';

const { MockFile } = vi.hoisted(() => {
	class HoistedMockFile {
		extension = 'md';
		basename: string;

		constructor(public name: string, public path: string) {
			this.basename = name.replace(/\.md$/, '');
		}
	}

	return { MockFile: HoistedMockFile };
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
			'trajectory.no-description': 'No description'
		};
		return map[key] || key;
	}),
}));

vi.mock('obsidian', () => ({
	setTooltip: vi.fn((element: { setAttr: (name: string, value: string) => void }, summary: string) => {
		element.setAttr('data-tooltip', summary);
	})
}));

vi.mock('../src/utils/leaf', () => ({
	openFileAndFocus: vi.fn(),
	getLeafForFileNavigation: vi.fn()
}));

vi.mock('../src/ui/components/StickyNoteParagraphEditor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/ui/components/StickyNoteParagraphEditor')>();
	return {
		...actual,
		setupStickyNoteParagraphEditor: vi.fn(),
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

class MockWindow {
	timeouts: Array<() => void> = [];
	setTimeout(callback: () => void): number {
		this.timeouts.push(callback);
		return this.timeouts.length;
	}
	getSelection(): null { return null; }
}

class MockElement {
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
	private readonly mockWindow = new MockWindow();

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

    createEl(tag: string, options?: { cls?: string; text?: string }): MockElement {
        const el = new MockElement(tag);
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
        this.children = [];
        this._textContent = '';
    }

    focus() {}

    blur() {
        this.onblur?.();
    }

    closest(selector: string) {
        return this.className.includes(selector.replace('.', '')) ? this : null;
    }

	get ownerDocument() {
		return {
            defaultView: this.mockWindow,
            createRange: () => ({ selectNodeContents: () => {}, collapse: () => {} })
		};
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
		expect(onUpdateEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: 'Updated content' }));
		expect(onSaveStateChange).toHaveBeenCalledWith(false);
		expect(reloadBoard).toHaveBeenCalled();
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
		expect(onUpdateEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: 'First\nSecond' }));
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
		}));
		copies[3].onclick?.({ stopPropagation: vi.fn() });
		expect(copies[3].hasClass('is-editing')).toBe(false);
		finishSave();
		await vi.waitFor(() => expect(reloadBoard).toHaveBeenCalledOnce());
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
		expect(reloadBoard).toHaveBeenCalledOnce();
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
		}));
	});

	it('type filter keeps only matching event cards and their type lane in a mixed node', () => {
		const entry: TimelineEntry = { time: '同名节点', type: 'Sub', description: '', chapter: '', rawBlock: '', items: [{ description: 'Sub event', chapter: '' }] };
		renderTrajectoryMode({
			app: mockApp,
			container: container as unknown as HTMLElement,
			displayEntries: [entry],
			typeFilter: 'Sub',
			allTypes: ['Main', 'Sub'],
			resolveLinkToFile
		});
		expect(container.querySelectorAll('.wn-trajectory-lane-header.is-type').map(el => el.textContent)).toEqual(['Sub']);
		expect(container.querySelectorAll('.wn-trajectory-event-text').map(el => el.textContent)).toEqual(['Sub event']);
	});

});
