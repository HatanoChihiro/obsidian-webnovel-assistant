import { describe, expect, it, vi } from 'vitest';
import { JsonSnapshotStore } from '../src/utils/JsonSnapshotStore';

function deferred() {
	let resolve!: () => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('JsonSnapshotStore', () => {
	it('suppresses redundant writes when clean', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const store = new JsonSnapshotStore<{ count: number }>({
			write,
			getSnapshot: () => ({ count: 1 })
		});

		store.markClean({ count: 1 });
		await store.save({ count: 1 });

		expect(write).not.toHaveBeenCalled();
		expect(store.isDirty()).toBe(false);
	});

	it('creates immutable snapshot synchronously upon save', async () => {
		const writeGate = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (content: string) => {
			writes.push(content);
			await writeGate.promise;
		});

		const store = new JsonSnapshotStore<{ title: string; tags: string[] }>({
			write
		});

		const mutableObj = { title: 'Chapter 1', tags: ['draft'] };
		const savePromise = store.save(mutableObj);

		// Mutate original object immediately after save call in same turn
		mutableObj.title = 'Mutated Title';
		mutableObj.tags.push('published');

		writeGate.resolve();
		await savePromise;

		expect(write).toHaveBeenCalledTimes(1);
		const writtenData = JSON.parse(writes[0]);
		expect(writtenData.title).toBe('Chapter 1');
		expect(writtenData.tags).toEqual(['draft']);
	});

	it('coalesces multiple same-turn burst save requests into a single physical write', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const store = new JsonSnapshotStore<{ val: number }>({
			write
		});

		const p1 = store.save({ val: 1 });
		const p2 = store.save({ val: 2 });
		const p3 = store.save({ val: 3 });

		await Promise.all([p1, p2, p3]);

		expect(write).toHaveBeenCalledTimes(1);
		expect(JSON.parse(write.mock.calls[0][0])).toEqual({ val: 3 });
		expect(store.isDirty()).toBe(false);
	});

	it('ensures newer in-flight caller stays pending until second physical write succeeds', async () => {
		const firstWriteGate = deferred();
		const secondWriteGate = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (content: string) => {
			writes.push(content);
			if (writes.length === 1) {
				await firstWriteGate.promise;
			} else if (writes.length === 2) {
				await secondWriteGate.promise;
			}
		});

		const store = new JsonSnapshotStore<{ val: number }>({
			write
		});

		const p1 = store.save({ val: 10 });
		// Wait for microtask drain to start write 1
		await new Promise<void>(r => queueMicrotask(() => r()));

		expect(store.isWriting).toBe(true);
		expect(writes.length).toBe(1);

		let p2Resolved = false;
		const p2 = store.save({ val: 20 }).then(() => {
			p2Resolved = true;
		});

		// Release first write and await p1
		firstWriteGate.resolve();
		await p1;

		// Write 2 should have started, but p2 must not be resolved yet until write 2 completes
		expect(writes.length).toBe(2);
		expect(p2Resolved).toBe(false);

		// Release second write and await p2
		secondWriteGate.resolve();
		await p2;

		expect(p2Resolved).toBe(true);
		expect(writes.length).toBe(2);
		expect(JSON.parse(writes[0])).toEqual({ val: 10 });
		expect(JSON.parse(writes[1])).toEqual({ val: 20 });
		expect(store.isDirty()).toBe(false);
		expect(store.isWriting).toBe(false);
	});

	it('settles both in-flight save and flush with exactly one physical write when no intervening mutation occurs', async () => {
		const writeGate = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (content: string) => {
			writes.push(content);
			await writeGate.promise;
		});

		let state = { count: 10 };
		const store = new JsonSnapshotStore<{ count: number }>({
			write,
			getSnapshot: () => state
		});

		const savePromise = store.save(state);
		// Wait for microtask drain to start write 1
		await new Promise<void>(r => queueMicrotask(() => r()));

		expect(store.isWriting).toBe(true);
		expect(writes.length).toBe(1);

		// Call flush with no intervening mutation
		const flushPromise = store.flush();

		// Release the write gate
		writeGate.resolve();

		await Promise.all([savePromise, flushPromise]);

		// Exactly one physical write occurred
		expect(writes.length).toBe(1);
		expect(JSON.parse(writes[0])).toEqual({ count: 10 });
		expect(store.isDirty()).toBe(false);
		expect(store.isWriting).toBe(false);
	});

	it('captures getSnapshot in flush when marked dirty during in-flight write and produces second write', async () => {
		const firstWriteGate = deferred();
		const secondWriteGate = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (content: string) => {
			writes.push(content);
			if (writes.length === 1) {
				await firstWriteGate.promise;
			} else if (writes.length === 2) {
				await secondWriteGate.promise;
			}
		});

		let state = { count: 10 };
		const store = new JsonSnapshotStore<{ count: number }>({
			write,
			getSnapshot: () => state
		});

		const savePromise = store.save(state);
		await new Promise<void>(r => queueMicrotask(() => r()));

		expect(store.isWriting).toBe(true);
		expect(writes.length).toBe(1);

		// Mutate state and mark dirty while write 1 is in flight
		state = { count: 20 };
		store.markDirty();

		const flushPromise = store.flush();

		firstWriteGate.resolve();
		await savePromise;

		// Write 2 should start for the dirty snapshot captured in flush
		expect(writes.length).toBe(2);

		secondWriteGate.resolve();
		await flushPromise;

		expect(writes.length).toBe(2);
		expect(JSON.parse(writes[0])).toEqual({ count: 10 });
		expect(JSON.parse(writes[1])).toEqual({ count: 20 });
		expect(store.isDirty()).toBe(false);
		expect(store.isWriting).toBe(false);
	});

	it('stops drain on physical write failure without auto-rescheduling, leaves store dirty, and allows bounded retry via flush', async () => {
		const write = vi.fn()
			.mockRejectedValueOnce(new Error('Disk write error'))
			.mockResolvedValueOnce(undefined);

		const store = new JsonSnapshotStore<{ count: number }>({
			write
		});

		await expect(store.save({ count: 42 })).rejects.toThrow('Disk write error');
		expect(store.isDirty()).toBe(true);
		expect(store.isWriting).toBe(false);

		// Verify no auto-retry loop: write was attempted exactly once
		expect(write).toHaveBeenCalledTimes(1);

		// Allow any pending microtasks to run and verify write count remains 1
		await new Promise(r => setTimeout(r, 50));
		expect(write).toHaveBeenCalledTimes(1);

		// Explicit retry via flush
		await store.flush();

		// Total attempts: exactly 2 (1 failure + 1 explicit retry)
		expect(write).toHaveBeenCalledTimes(2);
		expect(JSON.parse(write.mock.calls[1][0])).toEqual({ count: 42 });
		expect(store.isDirty()).toBe(false);
	});

	it('rejects all callers when in-flight write fails while newer snapshot is pending, and explicit flush retries with latest pending snapshot', async () => {
		const firstWriteGate = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (content: string) => {
			writes.push(content);
			if (writes.length === 1) {
				await firstWriteGate.promise;
				throw new Error('Write 1 failed');
			}
		});

		const store = new JsonSnapshotStore<{ val: number }>({
			write
		});

		const p1 = store.save({ val: 10 });
		await new Promise<void>(r => queueMicrotask(() => r()));

		expect(store.isWriting).toBe(true);
		expect(writes.length).toBe(1);

		// Queue V2 while V1 is in flight
		const p2 = store.save({ val: 20 });

		// Fail write 1
		firstWriteGate.resolve();

		// Both p1 and p2 must reject with the error to prevent hanging promises
		await expect(p1).rejects.toThrow('Write 1 failed');
		await expect(p2).rejects.toThrow('Write 1 failed');

		// Verify no automatic retry occurs
		expect(store.isWriting).toBe(false);
		expect(writes.length).toBe(1);
		await new Promise(r => setTimeout(r, 50));
		expect(writes.length).toBe(1);
		expect(store.isDirty()).toBe(true);

		// Explicit flush retries and writes the latest V2 snapshot (not stale V1)
		await store.flush();

		expect(writes.length).toBe(2);
		expect(JSON.parse(writes[0])).toEqual({ val: 10 });
		expect(JSON.parse(writes[1])).toEqual({ val: 20 });
		expect(store.isDirty()).toBe(false);
		expect(store.isWriting).toBe(false);
	});

	it('captures getSnapshot in flush when marked dirty in idle state', async () => {
		let state = { count: 0 };
		const write = vi.fn().mockResolvedValue(undefined);
		const store = new JsonSnapshotStore<{ count: number }>({
			write,
			getSnapshot: () => state
		});

		store.markClean(state);
		expect(store.isDirty()).toBe(false);

		state = { count: 99 };
		store.markDirty();
		expect(store.isDirty()).toBe(true);

		await store.flush();

		expect(write).toHaveBeenCalledTimes(1);
		expect(JSON.parse(write.mock.calls[0][0])).toEqual({ count: 99 });
		expect(store.isDirty()).toBe(false);
	});

	it('invokes onSuccess hook only upon actual physical write', async () => {
		const onSuccess = vi.fn();
		const write = vi.fn().mockResolvedValue(undefined);
		const store = new JsonSnapshotStore<{ key: string }>({
			write,
			onSuccess
		});

		await store.save({ key: 'a' });
		expect(onSuccess).toHaveBeenCalledTimes(1);

		// Duplicate save -> clean suppression -> 0 writes, 0 onSuccess calls
		await store.save({ key: 'a' });
		expect(onSuccess).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
	});
});
