import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineBoardRenderer, type TimelineBoardOptions, type TimelineBoardPlugin } from '../src/ui/components/TimelineBoardRenderer';
import { CorkboardGridRenderer } from '../src/ui/components/CorkboardGridRenderer';
import type { App, TFile } from 'obsidian';

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

let animationFrameCallbacks: FrameRequestCallback[] = [];

const mockOwnerWindow = {
	requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
		animationFrameCallbacks.push(cb);
		return animationFrameCallbacks.length;
	}),
	cancelAnimationFrame: vi.fn(),
	getComputedStyle: () => ({ boxSizing: 'content-box' })
};

class MockElement {
	parentElement: MockElement | null = null;
	children: MockElement[] = [];
	className = '';
	textContent = '';
	classes = new Set<string>();
	attributes = new Map<string, string>();
	listeners = new Map<string, Array<(e?: unknown) => void>>();
	onclick?: (e?: unknown) => void;
	style: Record<string, string> = {};
	scrollTop = 0;
	isConnected = true;
	private _scrollHeight = 0;
	get scrollHeight(): number {
		const textarea = this.querySelector('.wn-corkboard-textarea');
		if (textarea && textarea.style?.height) {
			const h = parseFloat(textarea.style.height);
			if (!isNaN(h) && h > 0) return h + 20;
		}
		if (this.className.includes('wn-corkboard-textarea') && this._scrollHeight === 0 && this.value) {
			return 220;
		}
		return this._scrollHeight;
	}
	set scrollHeight(val: number) {
		this._scrollHeight = val;
	}
	clientHeight = 0;
	value = '';
	oninput?: () => void;
	onblur?: () => void;
	onkeydown?: (e?: unknown) => void;
	focus = vi.fn();
	setSelectionRange = vi.fn();
	hide = vi.fn();

	setCssStyles(styles: Record<string, string>) {
		if (styles) Object.assign(this.style, styles);
		return this;
	}

	setCssProps(props: Record<string, string>) {
		return this.setCssStyles(props);
	}

	insertBefore(child: MockElement, referenceChild: MockElement) {
		const index = this.children.indexOf(referenceChild);
		if (index >= 0) {
			child.parentElement = this;
			this.children.splice(index, 0, child);
		} else {
			this.appendChild(child);
		}
		return child;
	}

	constructor(cls = '') {
		this.className = cls;
		if (cls) {
			cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
		}
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
			contains: (token: string) => this.classes.has(token)
		};
	}

	addClass(cls: string) {
		this.classList.add(cls);
		return this;
	}

	removeClass(cls: string) {
		this.classList.remove(cls);
		return this;
	}

	hasClass(token: string) { return this.classes.has(token); }

	empty() {
		this.children = [];
		this.textContent = '';
	}

	setText(text: string) {
		this.empty();
		this.textContent = text;
		return this;
	}

	appendText(text: string) {
		this.textContent += text;
		return this;
	}

	appendChild(child: MockElement) {
		child.parentElement = this;
		this.children.push(child);
		return child;
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

	createEl(tag: string, opts?: { cls?: string; text?: string }) {
		const cls = opts?.cls || '';
		const child = new MockElement(cls);
		if (opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	setAttr(key: string, val: string) { this.attributes.set(key, val); }
	setAttribute(key: string, val: string) { this.attributes.set(key, val); }
	getAttr(key: string) { return this.attributes.get(key) ?? null; }
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

	querySelector(sel: string): MockElement | null {
		const match = (node: MockElement): boolean => {
			if (sel.startsWith('.')) {
				const classes = sel.slice(1).split('.');
				return classes.every(c => node.hasClass(c));
			}
			return false;
		};
		const find = (node: MockElement): MockElement | null => {
			for (const c of node.children) {
				if (match(c)) return c;
				const nested = find(c);
				if (nested) return nested;
			}
			return null;
		};
		return find(this);
	}

	get ownerDocument() {
		return {
			defaultView: mockOwnerWindow,
			body: {
				classList: {
					contains: () => false
				}
			}
		};
	}
}

vi.mock('obsidian', () => ({
	setIcon: vi.fn(),
	Notice: vi.fn(),
	Modal: class {
		constructor(_app: unknown) {}
		open() {}
		close() {}
	},
	TFile: MockFile,
	TFolder: class {}
}));

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

vi.mock('../src/ui/components/CorkboardGridRenderer', () => ({
	CorkboardGridRenderer: {
		render: vi.fn()
	}
}));

describe('TimelineBoardRenderer', () => {
	let mockApp: App;
	let mockPlugin: TimelineBoardPlugin;
	let container: MockElement;

	beforeEach(() => {
		vi.clearAllMocks();
		animationFrameCallbacks = [];

		mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(),
				getFirstLinkpathDest: vi.fn()
			}
		} as unknown as App;

		mockPlugin = {
			settings: {
				enableSmartChapterSort: true,
				customSortOrder: {},
				enableMobileLorePopover: false,
				lorePopoverCollapse: false
			},
			timelineManager: {
				loadEntries: vi.fn().mockResolvedValue([]),
				getTimelineFile: vi.fn().mockReturnValue(null),
				createTimelineFile: vi.fn(),
				syncChapterToEventItem: vi.fn(),
				moveEventItem: vi.fn(),
				deleteEntry: vi.fn(),
				updateEntry: vi.fn(),
				getTimelineFilePath: vi.fn(),
				appendEntry: vi.fn()
			}
		} as unknown as TimelineBoardPlugin;

		container = new MockElement('wn-timeline-board');
		(globalThis as unknown as { createDiv: (opts?: string | { cls?: string; text?: string }) => MockElement }).createDiv = (opts?: string | { cls?: string; text?: string }) => {
			const cls = typeof opts === 'string' ? opts : opts?.cls || '';
			const el = new MockElement(cls);
			if (typeof opts === 'object' && opts?.text) {
				el.textContent = opts.text;
			}
			return el;
		};
	});

	it('should render unscheduled sort toggle button with correct attributes and sort chapters deterministically in ascending mode', async () => {
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md');

		const toggleSpy = vi.fn();

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v2c1, v1c2, v1c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isUnscheduledDescending: false,
			onToggleUnscheduledSort: toggleSpy
		};

		await TimelineBoardRenderer.render(options);

		// Find the sort toggle in the unscheduled header
		const sortToggle = container.querySelector('.wn-workbench-sort-toggle');
		expect(sortToggle).not.toBeNull();
		expect(sortToggle?.getAttribute('role')).toBe('button');
		expect(sortToggle?.getAttribute('tabindex')).toBe('0');
		expect(sortToggle?.getAttribute('aria-label')).toBe('corkboard.sort-ascending');
		expect(sortToggle?.getAttribute('aria-pressed')).toBe('false');

		// Check CorkboardGridRenderer received files sorted deterministically (Vol 1 -> Vol 2)
		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v1c1, v1c2, v2c1],
				currentBookPath: 'NovelA',
				draggable: true
			})
		);

		// Test click event triggers onToggleUnscheduledSort with stopPropagation
		const stopPropagationSpy = vi.fn();
		sortToggle?.onclick?.({ stopPropagation: stopPropagationSpy });
		expect(toggleSpy).toHaveBeenCalledTimes(1);
		expect(stopPropagationSpy).toHaveBeenCalledTimes(1);

		// Test keydown Enter triggers onToggleUnscheduledSort
		const preventDefaultSpy = vi.fn();
		const stopPropagationKeySpy = vi.fn();
		sortToggle?.dispatchEvent('keydown', {
			key: 'Enter',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleSpy).toHaveBeenCalledTimes(2);
		expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
		expect(stopPropagationKeySpy).toHaveBeenCalled();

		// Test keydown Space triggers onToggleUnscheduledSort
		sortToggle?.dispatchEvent('keydown', {
			key: ' ',
			preventDefault: preventDefaultSpy,
			stopPropagation: stopPropagationKeySpy
		});
		expect(toggleSpy).toHaveBeenCalledTimes(3);
	});

	it('should render descending sort toggle and reverse unscheduled chapters when isUnscheduledDescending is true', async () => {
		const v1c1 = createMockFile('第1章.md', 'NovelA/第一卷/第1章.md');
		const v1c2 = createMockFile('第2章.md', 'NovelA/第一卷/第2章.md');
		const v2c1 = createMockFile('第1章.md', 'NovelA/第二卷/第1章.md');

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: mockPlugin,
			container: container as unknown as HTMLElement,
			files: [v1c1, v1c2, v2c1],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([]),
			isUnscheduledDescending: true,
			onToggleUnscheduledSort: vi.fn()
		};

		await TimelineBoardRenderer.render(options);

		const sortToggle = container.querySelector('.wn-workbench-sort-toggle');
		expect(sortToggle).not.toBeNull();
		expect(sortToggle?.getAttribute('aria-label')).toBe('corkboard.sort-descending');
		expect(sortToggle?.getAttribute('aria-pressed')).toBe('true');

		// Descending order: Vol 2 -> Vol 1
		expect(CorkboardGridRenderer.render).toHaveBeenCalledWith(
			expect.objectContaining({
				files: [v2c1, v1c2, v1c1],
				currentBookPath: 'NovelA',
				draggable: true
			})
		);
	});

	it('should follow bottom when growing at bottom and preserve scroll position when editing in middle during event inline edit', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '初始事件描述', items: [{ description: '初始事件描述', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 200;
		descEl.scrollTop = 100; // at bottom (200 - 100 = 100)

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		const textarea = descEl.querySelector('.wn-corkboard-textarea') as unknown as MockElement;
		expect(textarea).not.toBeNull();

		// Simulate typing and growing at bottom
		textarea.scrollHeight = 250;
		textarea.oninput?.();

		// Should follow to new bottom (270 - 100 = 170)
		expect(descEl.scrollTop).toBe(170);

		// Simulate user scrolling up to middle
		descEl.scrollTop = 40; // 40 < 270 - 100 - 8
		textarea.scrollHeight = 300;
		textarea.oninput?.();

		// Should preserve middle position at 40
		expect(descEl.scrollTop).toBe(40);
	});

	it('should follow bottom when adding multiple lines in new sub-event editing', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '初始事件描述', items: [{ description: '初始事件描述', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const addSubEventBtn = container.querySelector('.wn-timeline-add-sub-event-btn') as unknown as MockElement;
		expect(addSubEventBtn).not.toBeNull();

		// Click add sub-event
		addSubEventBtn.onclick?.();

		const editingDesc = container.querySelector('.wn-timeline-item-desc.is-editing') as unknown as MockElement;
		expect(editingDesc).not.toBeNull();
		const textarea = editingDesc.querySelector('.wn-corkboard-textarea') as unknown as MockElement;
		expect(textarea).not.toBeNull();

		editingDesc.clientHeight = 100;
		editingDesc.scrollHeight = 100;
		editingDesc.scrollTop = 0;

		// As content grows beyond viewport height
		textarea.scrollHeight = 180;
		textarea.oninput?.();

		// Should follow new bottom (200 - 100 = 100)
		expect(editingDesc.scrollTop).toBe(100);
	});

	it('should synchronously release temporary minHeight during resize and leave no persistent minHeight style', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '初始事件描述', items: [{ description: '初始事件描述', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 200;

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		const textarea = descEl.querySelector('.wn-corkboard-textarea') as unknown as MockElement;
		expect(textarea).not.toBeNull();

		textarea.scrollHeight = 250;
		textarea.oninput?.();

		// minHeight must not persist on descEl after synchronous execution of autoResizeNestedTextarea
		expect(descEl.style.minHeight).toBe('');
	});

	it('should render multi-line event item in display mode with intact text and trigger reload upon blur save', async () => {
		const reloadBoardSpy = vi.fn();
		const updateEntrySpy = vi.fn().mockResolvedValue(undefined);
		const onSaveStateChangeSpy = vi.fn();
		const multiLineDesc = '第一行事件记录\n第二行事件细节\n第三行关键转折点';

		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: multiLineDesc, items: [{ description: multiLineDesc, chapter: '' }] }
					]),
					updateEntry: updateEntrySpy
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: onSaveStateChangeSpy,
			reloadBoard: reloadBoardSpy,
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		// In display mode, text content contains the full multi-line description
		expect(descEl.textContent).toContain('第一行事件记录');
		expect(descEl.textContent).toContain('第三行关键转折点');

		// Click into edit mode
		descEl.onclick?.({ stopPropagation: vi.fn() });
		const textarea = descEl.querySelector('.wn-corkboard-textarea') as unknown as MockElement;
		expect(textarea).not.toBeNull();
		expect(textarea.value).toBe(multiLineDesc);

		// Modify content and blur
		textarea.value = multiLineDesc + '\n第四行新发展';
		await textarea.onblur?.();

		expect(updateEntrySpy).toHaveBeenCalledWith(
			0,
			expect.objectContaining({
				items: [{ description: multiLineDesc + '\n第四行新发展', chapter: '' }]
			}),
			'NovelA'
		);
		expect(reloadBoardSpy).toHaveBeenCalled();
	});

	it('should map scroll to new maximum bottom when entering inline edit mode from display bottom', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '较长事件描述内容\n第二行内容\n第三行内容', items: [{ description: '较长事件描述内容\n第二行内容\n第三行内容', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 200;
		descEl.scrollTop = 100; // at display bottom (200 - 100 = 100)

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		// In edit mode, scrollHeight is 240 (textarea 220 + padding 20), clientHeight is 100 -> new max is 140
		expect(descEl.scrollTop).toBe(140);
		expect(mockOwnerWindow.requestAnimationFrame).toHaveBeenCalled();

		// Execute next animation frame callback and verify bottom position remains at 140
		const callbacks = [...animationFrameCallbacks];
		animationFrameCallbacks = [];
		for (const cb of callbacks) cb(0);
		expect(descEl.scrollTop).toBe(140);
	});

	it('should preserve and clamp previous scrollTop when entering inline edit mode from middle scroll position', async () => {
		const options: TimelineBoardOptions = {
			app: mockApp,
			plugin: {
				...mockPlugin,
				timelineManager: {
					...mockPlugin.timelineManager,
					loadEntries: vi.fn().mockResolvedValue([
						{ time: '第一年', description: '较长事件描述内容\n第二行内容\n第三行内容', items: [{ description: '较长事件描述内容\n第二行内容\n第三行内容', chapter: '' }] }
					])
				}
			},
			container: container as unknown as HTMLElement,
			files: [],
			foreshadowingMap: new Map(),
			currentBookPath: 'NovelA',
			currentTimelineFilter: 'all',
			onSaveStateChange: vi.fn(),
			reloadBoard: vi.fn(),
			getChapterEvents: vi.fn().mockReturnValue([])
		};

		await TimelineBoardRenderer.render(options);

		const descEl = container.querySelector('.wn-timeline-item-desc') as unknown as MockElement;
		expect(descEl).not.toBeNull();
		descEl.clientHeight = 100;
		descEl.scrollHeight = 300;
		descEl.scrollTop = 50; // middle position (50 < 300 - 100 - 8 = 192)

		// Trigger inline edit
		descEl.onclick?.({ stopPropagation: vi.fn() });

		// Should preserve middle scrollTop of 50
		expect(descEl.scrollTop).toBe(50);
		expect(mockOwnerWindow.requestAnimationFrame).toHaveBeenCalled();

		// Execute next animation frame callback and verify middle position remains preserved
		const callbacks = [...animationFrameCallbacks];
		animationFrameCallbacks = [];
		for (const cb of callbacks) cb(0);
		expect(descEl.scrollTop).toBe(50);
	});
});
