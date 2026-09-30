import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeModalState } from '../src/utils/modalObserver';

function setup() {
	const callbacks: MutationCallback[] = [];
	const disconnects: ReturnType<typeof vi.fn>[] = [];
	vi.stubGlobal('MutationObserver', class {
		disconnect = vi.fn();
		observe = vi.fn();
		constructor(cb: MutationCallback) {
			callbacks.push(cb);
			disconnects.push(this.disconnect);
		}
	});
	let frame: FrameRequestCallback | null = null;
	const query = vi.fn().mockReturnValue(null);
	const contains = vi.fn().mockReturnValue(false);
	const toggle = vi.fn();
	const cancel = vi.fn();
	const body = { querySelector: query, classList: { contains, toggle, remove: vi.fn() } };
	const doc = { body, defaultView: {
		requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => { frame = cb; return 1; }),
		cancelAnimationFrame: cancel
	} } as unknown as Document;
	const cleanup = observeModalState(doc);
	const element = (modal: boolean, nested = false) => ({
		nodeType: 1, childElementCount: nested ? 1 : 0,
		matches: () => modal, querySelector: () => nested ? {} : null
	}) as unknown as Node;
	const mutate = (added: Node[] = [], removed: Node[] = []) => callbacks[0]([
		{ addedNodes: added, removedNodes: removed } as unknown as MutationRecord
	], {} as MutationObserver);
	return { query, contains, toggle, cleanup, disconnects, cancel, element, mutate,
		flush: () => { const cb = frame; frame = null; cb?.(0); },
		bodyChanged: () => callbacks[1]([], {} as MutationObserver) };
}

afterEach(() => vi.unstubAllGlobals());

describe('modal observer', () => {
	it('skips ordinary editor mutations and batches nested modal additions and removal', () => {
		const state = setup();
		expect(state.query).toHaveBeenCalledTimes(1);
		state.query.mockClear();
		state.mutate([state.element(false)]);
		state.flush();
		expect(state.query).not.toHaveBeenCalled();
		state.query.mockReturnValue({});
		state.mutate([state.element(false, true)]);
		state.mutate([state.element(true)]);
		state.flush();
		expect(state.query).toHaveBeenCalledTimes(1);
		expect(state.toggle).toHaveBeenLastCalledWith('webnovel-modal-active', true);
		state.query.mockReturnValue(null);
		state.mutate([], [state.element(false, true)]);
		state.flush();
		expect(state.toggle).toHaveBeenLastCalledWith('webnovel-modal-active', false);
		state.cleanup();
	});

	it('tracks popout body state and cancels scheduled work on cleanup', () => {
		const state = setup();
		state.query.mockClear();
		state.bodyChanged();
		state.flush();
		expect(state.query).not.toHaveBeenCalled();
		state.contains.mockReturnValue(true);
		state.bodyChanged();
		state.flush();
		expect(state.toggle).toHaveBeenLastCalledWith('webnovel-modal-active', true);
		state.mutate([state.element(true)]);
		state.cleanup();
		expect(state.cancel).toHaveBeenCalledWith(1);
		for (const disconnect of state.disconnects) expect(disconnect).toHaveBeenCalledOnce();
		state.query.mockClear();
		state.flush();
		expect(state.query).not.toHaveBeenCalled();
	});
});