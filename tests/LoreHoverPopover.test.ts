import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildCardDOM = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const openEditModalMock = vi.hoisted(() => vi.fn());

vi.mock('obsidian', () => ({
	Platform: { isMobile: false },
	setIcon: vi.fn(),
	Component: class {
		private loaded = false;

		load(): void {
			this.loaded = true;
		}

		unload(): void {
			if (!this.loaded) return;
			this.loaded = false;
			this.onunload();
		}

		registerDomEvent(): void {}

		onunload(): void {}
	}
}));

vi.mock('../src/utils/platform', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/utils/platform')>();
	return {
		...actual,
		isMobile: () => false,
		getPlatformTier: () => 'desktop'
	};
});

vi.mock('../src/ui/components/LoreCardRenderer', () => ({
	LoreCardRenderer: { buildCardDOM }
}));

vi.mock('../src/ui/LoreEditModal', () => ({
	LoreEditModal: class {
		constructor(...args: unknown[]) {
			openEditModalMock(...args);
		}
		open(): void {}
	}
}));

import { LoreHoverPopover } from '../src/ui/LoreHoverPopover';
import { ChapterReferencePopover } from '../src/ui/ChapterReferencePopover';
import { ForeshadowingStatus } from '../src/types/foreshadowing';
import type { ChapterReferenceItem } from '../src/types/reference';
import type { App, TFile } from 'obsidian';
import { MockElement } from './mocks/MockElement';

interface MockElementState {
	connected: boolean;
	remove: ReturnType<typeof vi.fn>;
}

function createMockElement(ownerDocument: Document): { element: HTMLElement; state: MockElementState } {
	const state: MockElementState = {
		connected: true,
		remove: vi.fn()
	};
	const element = {
		ownerDocument,
		get isConnected() { return state.connected; },
		addClass: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		createDiv: vi.fn(() => createMockElement(ownerDocument).element),
		contains: vi.fn(() => false),
		matches: vi.fn(() => true),
		remove: state.remove,
		getBoundingClientRect: vi.fn(() => ({
			x: 0, y: 0, width: 100, height: 40,
			top: 0, right: 100, bottom: 40, left: 0,
			toJSON: () => ({})
		})),
		setCssStyles: vi.fn()
	} as unknown as HTMLElement;
	return { element, state };
}

describe('LoreHoverPopover lifecycle', () => {
	let mutationCallback: MutationCallback;
	let disconnect: ReturnType<typeof vi.fn<() => void>>;
	let observe: ReturnType<typeof vi.fn<(target: Node, options?: MutationObserverInit) => void>>;
	let addDocumentListener: ReturnType<typeof vi.fn>;
	let removeDocumentListener: ReturnType<typeof vi.fn>;
	let target: HTMLElement;
	let targetState: MockElementState;
	let ownerDocument: Document;

	beforeEach(() => {
		vi.useFakeTimers();
		buildCardDOM.mockClear();
		disconnect = vi.fn();
		observe = vi.fn();
		vi.stubGlobal('MutationObserver', class {
			constructor(callback: MutationCallback) {
				mutationCallback = callback;
			}
			observe(target: Node, options: MutationObserverInit): void { observe(target, options); }
			disconnect(): void { disconnect(); }
		});

		addDocumentListener = vi.fn();
		removeDocumentListener = vi.fn();
		const ownerWindow = Object.assign(new EventTarget(), {
			setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number,
			clearTimeout: (id: number) => globalThis.clearTimeout(id),
			innerWidth: 1200,
			innerHeight: 800
		}) as unknown as Window;
		const body = {
			appendChild: vi.fn()
		} as unknown as HTMLElement;
		ownerDocument = {
			defaultView: ownerWindow,
			body: Object.assign(body, {
				createDiv: vi.fn(() => createMockElement(ownerDocument).element)
			}),
			addEventListener: addDocumentListener,
			removeEventListener: removeDocumentListener
		} as unknown as Document;
		({ element: target, state: targetState } = createMockElement(ownerDocument));
		Object.defineProperty(target, 'parentNode', { value: ownerDocument.body });
	});

	afterEach(() => {
		LoreHoverPopover.closeAll();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('releases the instance, observer and document listeners when its owner window unloads', () => {
		new LoreHoverPopover(target, { file: null } as never, { settings: { enableLorePopover: true } } as never, true);
		vi.runOnlyPendingTimers();
		const openInstances = (LoreHoverPopover as unknown as { openInstances: Set<LoreHoverPopover> }).openInstances;
		expect(openInstances.size).toBe(1);
		ownerDocument.defaultView!.dispatchEvent(new Event('unload'));
		expect(openInstances.size).toBe(0);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(removeDocumentListener).toHaveBeenCalledWith('click', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not attach a deferred document listener after unload', () => {
		const popover = new LoreHoverPopover(target, { file: null } as never, {} as never, true);
		popover.unload();

		vi.runAllTimers();

		expect(addDocumentListener).not.toHaveBeenCalled();
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it('disposes listeners when the target is detached', () => {
		new LoreHoverPopover(target, { file: null } as never, {} as never, true);
		vi.runOnlyPendingTimers();
		expect(addDocumentListener).toHaveBeenCalledWith('click', expect.any(Function));

		targetState.connected = false;
		mutationCallback([{ removedNodes: [target] } as unknown as MutationRecord], {} as MutationObserver);

		expect(removeDocumentListener).toHaveBeenCalledWith('click', expect.any(Function));
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it('delegates card highlight to LoreCardRenderer without adding is-important to popover wrapper', () => {
		const mockEntry = { file: { path: 'Lore/Alice.md' }, heading: 'Alice', important: true };
		new LoreHoverPopover(target, mockEntry as never, {} as never, true);
		vi.runOnlyPendingTimers();

		expect(buildCardDOM).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ important: true }),
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ hideEditButton: true, hideImportanceButton: false })
		);
	});

	it('does not create duplicate hover popovers for the same target element', () => {
		const popover1 = new LoreHoverPopover(target, { file: null } as never, {} as never);
		const popover2 = new LoreHoverPopover(target, { file: null } as never, {} as never);

		// With duplicate prevention, popover2 should not recreate or be a separate active popover
		expect(popover2).toBe(popover1);
		popover1.unload();
	});

	it('safely detects ancestor removal and closes popover and disconnects observer', () => {
		new LoreHoverPopover(target, { file: null } as never, {} as never, true);
		vi.runOnlyPendingTimers();
		expect(observe).toHaveBeenCalledWith(ownerDocument.body, { childList: true });

		// Target becomes disconnected due to ancestor removal
		targetState.connected = false;
		mutationCallback([
			{
				type: 'childList',
				addedNodes: [] as unknown as NodeList,
				removedNodes: [createMockElement(ownerDocument).element as unknown as Node] as unknown as NodeList
			} as MutationRecord
		], {} as MutationObserver);

		expect(removeDocumentListener).toHaveBeenCalledWith('click', expect.any(Function));
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it('does not evaluate target disconnection on unrelated DOM mutations without removals', () => {
		new LoreHoverPopover(target, { file: null } as never, {} as never, true);
		vi.runOnlyPendingTimers();

		// Simulate an unrelated mutation without removals (e.g. typing text)
		targetState.connected = true;
		removeDocumentListener.mockClear();

		mutationCallback([
			{
				type: 'childList',
				addedNodes: [createMockElement(ownerDocument).element as unknown as Node] as unknown as NodeList,
				removedNodes: [] as unknown as NodeList
			} as MutationRecord
		], {} as MutationObserver);

		// Should not close or remove listeners
		expect(removeDocumentListener).not.toHaveBeenCalled();
	});

	it('configures editable card with onEdit when not borrowed, and hides edit button when borrowed', () => {
		const mockEntry = { file: { path: 'Book1/Lore/Alice.md' }, heading: 'Alice' };
		const editablePlugin = {
			characterManager: {
				updateLoreEntry: vi.fn(),
				isBorrowedLoreEntry: vi.fn().mockReturnValue(false)
			}
		};

		new LoreHoverPopover(target, mockEntry as never, editablePlugin as never, true, 'Book1');
		vi.runOnlyPendingTimers();

		expect(buildCardDOM).toHaveBeenCalledWith(
			expect.anything(),
			mockEntry,
			editablePlugin,
			expect.anything(),
			expect.objectContaining({ hideEditButton: false, onEdit: expect.any(Function) })
		);

		buildCardDOM.mockClear();
		const borrowedPlugin = {
			characterManager: {
				updateLoreEntry: vi.fn(),
				isBorrowedLoreEntry: vi.fn().mockReturnValue(true)
			}
		};

		const { element: borrowedTarget } = createMockElement(ownerDocument);
		new LoreHoverPopover(borrowedTarget, mockEntry as never, borrowedPlugin as never, true, 'Book2');
		vi.runOnlyPendingTimers();

		expect(buildCardDOM).toHaveBeenCalledWith(
			expect.anything(),
			mockEntry,
			borrowedPlugin,
			expect.anything(),
			expect.objectContaining({ hideEditButton: true })
		);
	});

	it('invoking onEdit closes hover popover and launches LoreEditModal', () => {
		const mockEntry = { file: { path: 'Book1/Lore/Alice.md' }, heading: 'Alice' };
		const plugin = {
			app: {},
			characterManager: {
				updateLoreEntry: vi.fn(),
				isBorrowedLoreEntry: vi.fn().mockReturnValue(false)
			}
		};

		new LoreHoverPopover(target, mockEntry as never, plugin as never, true, 'Book1');
		vi.runOnlyPendingTimers();

		const calls = buildCardDOM.mock.calls;
		const options = calls[calls.length - 1][4] as { onEdit?: () => void };
		expect(options.onEdit).toBeDefined();

		openEditModalMock.mockClear();
		options.onEdit!();

		expect(openEditModalMock).toHaveBeenCalledWith(
			plugin.app,
			plugin,
			mockEntry,
			'Book1'
		);
	});

	it('LoreHoverPopover.closeAll() dismisses all open instances immediately', () => {
		const mockEntry = { file: null };
		const plugin = { settings: { enableLorePopover: true } };

		new LoreHoverPopover(target, mockEntry as never, plugin as never, true, 'Book1');
		vi.runOnlyPendingTimers();

		expect(addDocumentListener).toHaveBeenCalled();

		LoreHoverPopover.closeAll();
		vi.runOnlyPendingTimers();

		// Popover should be closed and its document listeners removed
		expect(removeDocumentListener).toHaveBeenCalled();
	});

	it('closing lore cards for a reference preview preserves cards in another document', () => {
		const entry = { file: null };
		const plugin = { settings: { enableLorePopover: true } };
		const otherDocument = Object.create(ownerDocument) as Document;
		const { element: otherTarget } = createMockElement(otherDocument);
		const first = new LoreHoverPopover(target, entry as never, plugin as never, true);
		const second = new LoreHoverPopover(otherTarget, entry as never, plugin as never, true);
		const firstHide = vi.spyOn(first as unknown as { hide(): void }, 'hide');
		const secondHide = vi.spyOn(second as unknown as { hide(): void }, 'hide');
		LoreHoverPopover.closeForDocument(ownerDocument);
		expect(firstHide).toHaveBeenCalledOnce();
		expect(secondHide).not.toHaveBeenCalled();
		LoreHoverPopover.closeAll();
	});

	it('does not create popover when enableLorePopover is explicitly false', () => {
		const mockEntry = { file: { path: 'Book1/Lore/Alice.md' }, heading: 'Alice' };
		const plugin = { settings: { enableLorePopover: false } };

		buildCardDOM.mockClear();
		const { element: target1 } = createMockElement(ownerDocument);
		new LoreHoverPopover(target1, mockEntry as never, plugin as never, true, 'Book1');
		vi.runOnlyPendingTimers();

		expect(buildCardDOM).not.toHaveBeenCalled();
	});

	it('cancels delayed show timer and cleans up resources when owner window unloads', () => {
		new LoreHoverPopover(target, { file: null } as never, { settings: { enableLorePopover: true } } as never, false);
		const openInstances = (LoreHoverPopover as unknown as { openInstances: Set<LoreHoverPopover> }).openInstances;
		expect(openInstances.size).toBe(1);
		expect(vi.getTimerCount()).toBe(1);

		ownerDocument.defaultView!.dispatchEvent(new Event('unload'));

		expect(openInstances.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(target.removeEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));
		vi.runAllTimers();
		expect(buildCardDOM).not.toHaveBeenCalled();
	});

	it('disposes an expired hover candidate even if no mouseleave event was delivered', () => {
		new LoreHoverPopover(target, { file: null } as never, { settings: { enableLorePopover: true } } as never, false);
		vi.mocked(target.matches).mockReturnValue(false);
		vi.runAllTimers();
		const openInstances = (LoreHoverPopover as unknown as { openInstances: Set<LoreHoverPopover> }).openInstances;
		expect(openInstances.size).toBe(0);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('prevents late DOM resurrection and preserves component unload ordering when closed during in-flight buildCardDOM', async () => {
		let resolveBuild!: () => void;
		let registeredCleanup!: ReturnType<typeof vi.fn<() => void>>;
		buildCardDOM.mockImplementationOnce((_container, _entry, _plugin, component: { onunload: () => void }) => {
			registeredCleanup = vi.fn<() => void>();
			const originalOnUnload = component.onunload.bind(component);
			component.onunload = () => {
				registeredCleanup();
				originalOnUnload();
			};
			return new Promise<void>(resolve => {
				resolveBuild = resolve;
			});
		});

		const mockEntry = { file: { path: 'Lore/Alice.md' }, heading: 'Alice' };
		new LoreHoverPopover(target, mockEntry as never, { settings: { enableLorePopover: true } } as never, true);
		vi.runOnlyPendingTimers();

		const openInstances = (LoreHoverPopover as unknown as { openInstances: Set<LoreHoverPopover> }).openInstances;
		expect(openInstances.size).toBe(1);

		ownerDocument.defaultView!.dispatchEvent(new Event('unload'));

		expect(openInstances.size).toBe(0);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(removeDocumentListener).toHaveBeenCalledWith('click', expect.any(Function));
		expect(registeredCleanup).not.toHaveBeenCalled();

		resolveBuild();
		await Promise.resolve();
		await Promise.resolve();

		expect(registeredCleanup).toHaveBeenCalledOnce();
		expect(ownerDocument.body.appendChild).not.toHaveBeenCalled();
	});

	it('unloading one window leaves popovers in another window open and unaffected', () => {
		const otherWindow = Object.assign(new EventTarget(), {
			setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number,
			clearTimeout: (id: number) => globalThis.clearTimeout(id),
			innerWidth: 1200,
			innerHeight: 800
		}) as unknown as Window;
		const otherBody = {
			appendChild: vi.fn()
		} as unknown as HTMLElement;
		const otherDocument = {
			defaultView: otherWindow,
			body: Object.assign(otherBody, {
				createDiv: vi.fn(() => createMockElement(otherDocument).element)
			}),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as Document;
		const { element: otherTarget } = createMockElement(otherDocument);

		const entry = { file: null };
		const plugin = { settings: { enableLorePopover: true } };
		const first = new LoreHoverPopover(target, entry as never, plugin as never, true);
		const second = new LoreHoverPopover(otherTarget, entry as never, plugin as never, true);
		vi.runOnlyPendingTimers();

		const openInstances = (LoreHoverPopover as unknown as { openInstances: Set<LoreHoverPopover> }).openInstances;
		expect(openInstances.size).toBe(2);

		ownerDocument.defaultView!.dispatchEvent(new Event('unload'));

		expect(openInstances.has(first)).toBe(false);
		expect(openInstances.has(second)).toBe(true);
		expect(otherDocument.removeEventListener).not.toHaveBeenCalled();
	});

	it('supports virtual anchor hover predicate and onDispose callback for delayed desktop popovers', async () => {
		let virtualHovered = true;
		const onDispose = vi.fn();
		vi.mocked(target.matches).mockReturnValue(false);

		const popover = new (LoreHoverPopover as unknown as new (
			t: HTMLElement,
			e: unknown,
			p: unknown,
			imm: boolean,
			book?: string,
			opts?: { isTargetHovered?: () => boolean; onDispose?: () => void }
		) => LoreHoverPopover & {
			isActive(): boolean;
			isCardVisible(): boolean;
			handleTargetLeave(): void;
			cancelPendingClose(): void;
		})(
			target,
			{ file: { path: 'Lore/Rowan.md' }, heading: 'Rowan' },
			{ settings: { enableLorePopover: true } },
			false,
			undefined,
			{ isTargetHovered: () => virtualHovered, onDispose }
		);

		expect(popover.isActive()).toBe(true);
		expect(popover.isCardVisible()).toBe(false);

		vi.advanceTimersByTime(1000);
		await Promise.resolve();
		await Promise.resolve();

		expect(buildCardDOM).toHaveBeenCalledOnce();
		expect(popover.isCardVisible()).toBe(true);

		// Moving off virtual anchor starts 200ms close grace without resetting on repeated leave calls
		popover.handleTargetLeave();
		vi.advanceTimersByTime(100);
		popover.handleTargetLeave();
		vi.advanceTimersByTime(50);
		expect(popover.isCardVisible()).toBe(true);

		// Re-entering or entering popover cancels pending close
		popover.cancelPendingClose();
		vi.advanceTimersByTime(200);
		expect(popover.isCardVisible()).toBe(true);

		// Leaving and letting grace period expire disposes once
		popover.handleTargetLeave();
		vi.advanceTimersByTime(200);
		expect(popover.isActive()).toBe(false);
		expect(onDispose).toHaveBeenCalledOnce();

		// When virtualHovered is false at 1000ms, pending popover aborts cleanly
		virtualHovered = false;
		const abortedDispose = vi.fn();
		buildCardDOM.mockClear();
		const aborted = new (LoreHoverPopover as unknown as new (
			t: HTMLElement,
			e: unknown,
			p: unknown,
			imm: boolean,
			book?: string,
			opts?: { isTargetHovered?: () => boolean; onDispose?: () => void }
		) => LoreHoverPopover & { isActive(): boolean })(
			target,
			{ file: { path: 'Lore/Rowan.md' }, heading: 'Rowan' },
			{ settings: { enableLorePopover: true } },
			false,
			undefined,
			{ isTargetHovered: () => virtualHovered, onDispose: abortedDispose }
		);
		vi.advanceTimersByTime(1000);
		expect(buildCardDOM).not.toHaveBeenCalled();
		expect(aborted.isActive()).toBe(false);
		expect(abortedDispose).toHaveBeenCalledOnce();
	});

	it('cancels a pending delayed popover immediately on handleTargetLeave before card is visible', () => {
		const onDispose = vi.fn();
		const popover = new (LoreHoverPopover as unknown as new (
			t: HTMLElement,
			e: unknown,
			p: unknown,
			imm: boolean,
			book?: string,
			opts?: { isTargetHovered?: () => boolean; onDispose?: () => void }
		) => LoreHoverPopover & { isActive(): boolean; handleTargetLeave(): void })(
			target,
			{ file: { path: 'Lore/Rowan.md' }, heading: 'Rowan' },
			{ settings: { enableLorePopover: true } },
			false,
			undefined,
			{ isTargetHovered: () => true, onDispose }
		);

		popover.handleTargetLeave();
		expect(popover.isActive()).toBe(false);
		expect(onDispose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('ChapterReferencePopover importance star', () => {
	it('renders individual accessible stars, syncs creation/recovery siblings immediately, preserves button element, and rolls back on failure', async () => {
		const ownerWindow = Object.assign(new EventTarget(), {
			setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number,
			clearTimeout: (id: number) => globalThis.clearTimeout(id),
			innerWidth: 1200,
			innerHeight: 800,
			MutationObserver: class {
				observe(): void {}
				disconnect(): void {}
			}
		}) as unknown as Window;
		const body = new MockElement('body');
		const ownerDocument = {
			defaultView: ownerWindow,
			body
		} as unknown as Document;
		const anchor = new MockElement('wn-reference-match');
		Object.assign(anchor, {
			ownerDocument,
			getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 40, right: 140, width: 100, height: 20 })
		});
		body.appendChild(anchor);
		Object.defineProperty(body, 'getBoundingClientRect', {
			value: () => ({ top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 })
		});
		const origCreateDiv = body.createDiv.bind(body);
		body.createDiv = (opts?: string | { cls?: string; text?: string }) => {
			const div = origCreateDiv(opts);
			Object.assign(div, {
				getBoundingClientRect: () => ({ top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200 })
			});
			return div;
		};

		const fsFile = { path: 'Book/Foreshadowing.md' } as TFile;
		const tlFile = { path: 'Book/Timeline.md' } as TFile;
		const foreshadowingTarget = { sourcePath: fsFile.path, rawBlock: '## Clue alpha' };
		const items: ChapterReferenceItem[] = [
			{
				id: 'foreshadowing:Book/Foreshadowing.md:0:creation:0',
				type: 'foreshadowing',
				kind: 'creation',
				status: ForeshadowingStatus.PartiallyRecovered,
				tags: [],
				quote: 'Shared quote',
				description: 'Clue alpha',
				important: false,
				sourceFile: fsFile,
				foreshadowingTarget
			},
			{
				id: 'foreshadowing:Book/Foreshadowing.md:0:recovery:0',
				type: 'foreshadowing',
				kind: 'recovery',
				status: ForeshadowingStatus.PartiallyRecovered,
				tags: [],
				quote: 'Shared quote',
				description: 'Clue alpha',
				important: false,
				sourceFile: fsFile,
				foreshadowingTarget
			},
			{
				id: 'timeline:Book/Timeline.md:0:0',
				type: 'timeline',
				quote: 'Shared quote',
				description: 'Timeline event',
				important: false,
				sourceFile: tlFile,
				timelineTarget: {
					folderPath: 'Book', sourcePath: tlFile.path, itemIndex: 0,
					expectedEntry: { time: 'Morning', rawBlock: '', chapter: '', description: 'Timeline event' }
				}
			}
		];

		let resolveToggle!: () => void;
		const onToggleImportance = vi.fn(() => new Promise<void>((resolve) => {
			resolveToggle = resolve;
		}));
		const onImportanceWriteStart = vi.fn();
		const onImportanceWriteEnd = vi.fn();

		const popover = new ChapterReferencePopover(
			anchor as unknown as HTMLElement,
			items,
			{} as App,
			true,
			undefined,
			{ onToggleImportance, onImportanceWriteStart, onImportanceWriteEnd }
		);

		const cards = body.querySelectorAll('.wn-reference-popover-item');
		expect(cards).toHaveLength(3);
		const stars = body.querySelectorAll('.wn-card-importance-btn');
		expect(stars).toHaveLength(3);
		for (const star of stars) {
			expect(star.getAttribute('aria-pressed')).toBe('false');
			expect(star.getAttribute('aria-label')).toBeTruthy();
			expect(star.getAttribute('title')).toBeNull();
		}

		// Click creation star -> both creation & recovery cards highlight immediately while timeline card stays untouched
		const clickEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
		const pendingClick = (stars[0].onclick as unknown as (e: unknown) => Promise<void>)(clickEvent);
		expect(cards[0].hasClass('is-important')).toBe(true);
		expect(cards[1].hasClass('is-important')).toBe(true);
		expect(cards[2].hasClass('is-important')).toBe(false);
		expect(stars[0].getAttribute('aria-pressed')).toBe('true');
		expect(stars[1].getAttribute('aria-pressed')).toBe('true');
		expect(onImportanceWriteStart).toHaveBeenCalledTimes(1);
		// Shared cached items are not mutated optimistically by the popover UI
		expect(items[0].important).toBe(false);
		expect(items[1].important).toBe(false);

		// Clicking sibling star while first write is in flight is blocked before optimistic toggle
		await (stars[1].onclick as unknown as (e: unknown) => Promise<void>)(clickEvent);
		expect(onToggleImportance).toHaveBeenCalledTimes(1);
		expect(cards[0].hasClass('is-important')).toBe(true);
		expect(cards[1].hasClass('is-important')).toBe(true);
		expect(stars[0].getAttribute('aria-pressed')).toBe('true');
		expect(stars[1].getAttribute('aria-pressed')).toBe('true');

		resolveToggle();
		await pendingClick;
		expect(onImportanceWriteEnd).toHaveBeenCalledWith(true);
		expect(items[0].important).toBe(false);
		expect(items[1].important).toBe(false);
		expect(body.querySelectorAll('.wn-card-importance-btn')[0]).toBe(stars[0]); // Same DOM node preserves keyboard focus

		// Failed write on sibling rolls back both creation & recovery cards cleanly to local true state
		onToggleImportance.mockRejectedValueOnce(new Error('Write failed'));
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await (stars[1].onclick as unknown as (e: unknown) => Promise<void>)(clickEvent);
		} finally {
			errSpy.mockRestore();
		}
		expect(onToggleImportance).toHaveBeenCalledTimes(2);
		expect(onImportanceWriteEnd).toHaveBeenLastCalledWith(false);
		expect(cards[0].hasClass('is-important')).toBe(true);
		expect(cards[1].hasClass('is-important')).toBe(true);
		expect(stars[0].getAttribute('aria-pressed')).toBe('true');
		expect(stars[1].getAttribute('aria-pressed')).toBe('true');

		popover.hide();
	});
});
