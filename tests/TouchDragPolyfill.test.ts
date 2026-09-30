import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TouchDragPolyfill } from '../src/utils/TouchDragPolyfill';

class FakeMouseEvent {
	public dataTransfer: unknown;
	public readonly clientX: number;
	public readonly clientY: number;

	constructor(public readonly type: string, init: MouseEventInit) {
		this.clientX = init.clientX ?? 0;
		this.clientY = init.clientY ?? 0;
	}
}

function createContainerFixture() {
	const bodyAppend = vi.fn();
	const mockWindow = {
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
		MouseEvent: FakeMouseEvent,
		navigator: { vibrate: vi.fn() }
	};
	const mockDocument = {
		body: { appendChild: bodyAppend },
		defaultView: mockWindow,
		elementFromPoint: vi.fn().mockReturnValue(null)
	};
	const listeners = new Map<string, EventListener>();
	const createContainer = () => ({
		ownerDocument: mockDocument,
		addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
		removeEventListener: vi.fn((type: string) => listeners.delete(type))
	}) as unknown as HTMLElement;

	return { bodyAppend, createContainer, listeners };
}

describe('TouchDragPolyfill', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('cleans up each registration independently and idempotently', () => {
		const fixture = createContainerFixture();
		const firstContainer = fixture.createContainer();
		const secondContainer = fixture.createContainer();
		const cleanupFirst = TouchDragPolyfill.register(firstContainer);
		const cleanupSecond = TouchDragPolyfill.register(secondContainer);

		cleanupFirst();
		expect(firstContainer.removeEventListener).toHaveBeenCalledTimes(5);
		expect(secondContainer.removeEventListener).not.toHaveBeenCalled();
		cleanupSecond();
		expect(secondContainer.removeEventListener).toHaveBeenCalledTimes(5);
		cleanupSecond();
		expect(secondContainer.removeEventListener).toHaveBeenCalledTimes(5);
	});

	it('cancels pending work and aborts an active drag during cleanup', () => {
		const fixture = createContainerFixture();
		const sourceStyles = vi.fn();
		const sourceDispatch = vi.fn();
		const ghostRemove = vi.fn();
		const ghost = { setCssStyles: vi.fn(), remove: ghostRemove };
		const source = {
			closest: vi.fn().mockReturnThis(),
			getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 100, height: 50 }),
			cloneNode: vi.fn().mockReturnValue(ghost),
			dispatchEvent: sourceDispatch,
			setCssStyles: sourceStyles
		};
		const cleanup = TouchDragPolyfill.register(fixture.createContainer());
		const touch = { clientX: 10, clientY: 10 } as Touch;
		const touchStart = {
			target: source,
			touches: [touch],
			stopPropagation: vi.fn()
		} as unknown as TouchEvent;

		fixture.listeners.get('touchstart')?.(touchStart);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(220);
		expect(fixture.bodyAppend).toHaveBeenCalledWith(ghost);

		cleanup();
		expect(vi.getTimerCount()).toBe(0);
		expect(sourceStyles).toHaveBeenLastCalledWith({ opacity: '', pointerEvents: '' });
		expect(ghostRemove).toHaveBeenCalled();
		expect(sourceDispatch.mock.calls.some(([event]) => event.type === 'dragend')).toBe(true);
	});
});
