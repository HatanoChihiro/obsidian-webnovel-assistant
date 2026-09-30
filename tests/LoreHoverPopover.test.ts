import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildCardDOM = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('obsidian', () => ({
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

		onunload(): void {}
	}
}));

vi.mock('../src/utils/platform', () => ({
	isMobile: () => false,
	getPlatformTier: () => 'desktop'
}));

vi.mock('../src/ui/components/LoreCardRenderer', () => ({
	LoreCardRenderer: { buildCardDOM }
}));

import { LoreHoverPopover } from '../src/ui/LoreHoverPopover';

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
	let disconnect: ReturnType<typeof vi.fn>;
	let observe: ReturnType<typeof vi.fn>;
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
		const ownerWindow = {
			setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number,
			clearTimeout: (id: number) => globalThis.clearTimeout(id),
			innerWidth: 1200,
			innerHeight: 800
		} as unknown as Window;
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
		vi.useRealTimers();
		vi.unstubAllGlobals();
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
});
