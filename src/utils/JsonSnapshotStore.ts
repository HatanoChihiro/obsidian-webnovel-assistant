import { Logger } from './Logger';

/**
 * Configuration options for JsonSnapshotStore.
 */
export interface JsonSnapshotStoreOptions<T> {
	/**
	 * Function to perform physical disk write using immutable serialized content.
	 */
	write: (serializedContent: string) => Promise<void>;

	/**
	 * Optional custom serializer. Defaults to JSON.stringify.
	 */
	serialize?: (data: T) => string;

	/**
	 * Optional function to retrieve the latest in-memory state snapshot
	 * when save() or flush() is invoked without explicit data.
	 */
	getSnapshot?: () => T;

	/**
	 * Optional hook invoked after a physical write successfully completes.
	 */
	onSuccess?: (serializedContent: string) => void;

	/**
	 * Optional hook invoked when a physical write fails.
	 */
	onError?: (error: unknown, serializedContent: string) => void;
}

interface SnapshotWaiter {
	targetVersion: number;
	resolve: () => void;
	reject: (err: unknown) => void;
}

/**
 * JsonSnapshotStore: A compositional, typed persistence primitive for JSON snapshots.
 *
 * Key guarantees:
 * 1. Synchronous Immutable Snapshots: serializes immediately upon save() call.
 * 2. Microtask-Deferred Drain: same-turn saves coalesce into a single physical write.
 * 3. Strict Versioning: newer distinct snapshots receive strictly increasing target versions.
 * 4. In-Flight Isolation: newer callers during an active write remain pending until their own snapshot persists.
 * 5. Flush Deduplication: flush during an in-flight write with no intervening mutation awaits the in-flight write without duplicate I/O.
 * 6. Failure Safety & Liveness: failed writes stop the drain loop without busy-retrying, rejecting all callers to avoid hanging promises while preserving the newest snapshot for explicit retry.
 * 7. Redundant Write Suppression: unchanged clean state results in 0 physical disk writes.
 */
export class JsonSnapshotStore<T> {
	private options: JsonSnapshotStoreOptions<T>;
	private serializeFn: (data: T) => string;

	private persistedVersion = 0;
	private inFlightVersion = 0;
	private inFlightContent: string | null = null;
	private latestRequestedVersion = 0;

	private pendingContent: string | null = null;
	private pendingVersion = 0;

	private _isWriting = false;
	private drainScheduled = false;
	private lastPersistedContent: string | null = null;

	private waiters: SnapshotWaiter[] = [];

	constructor(options: JsonSnapshotStoreOptions<T>) {
		this.options = options;
		this.serializeFn = options.serialize ?? ((data: T) => JSON.stringify(data));
	}

	/**
	 * Mark the store as having unpersisted mutations.
	 * Coalesces multiple markDirty calls into the next logical target version.
	 */
	markDirty(): void {
		this.latestRequestedVersion = Math.max(
			this.persistedVersion,
			this.inFlightVersion,
			this.pendingVersion
		) + 1;
	}

	/**
	 * Mark the store as clean (e.g. after loading initial clean state from disk).
	 */
	markClean(data?: T): void {
		if (data !== undefined) {
			this.lastPersistedContent = this.serializeFn(data);
		} else if (this.options.getSnapshot) {
			this.lastPersistedContent = this.serializeFn(this.options.getSnapshot());
		}
		this.persistedVersion = 0;
		this.inFlightVersion = 0;
		this.inFlightContent = null;
		this.latestRequestedVersion = 0;
		this.pendingContent = null;
		this.pendingVersion = 0;
		this._isWriting = false;
		this.drainScheduled = false;
	}

	/**
	 * Check whether there are unpersisted mutations, a queued pending snapshot, or a write in-flight.
	 */
	isDirty(): boolean {
		return (
			this.pendingContent !== null ||
			this._isWriting ||
			this.latestRequestedVersion > this.persistedVersion
		);
	}

	/**
	 * Returns true if a physical write operation is actively executing.
	 */
	get isWriting(): boolean {
		return this._isWriting;
	}

	/**
	 * Method alias for get isWriting.
	 */
	getIsWriting(): boolean {
		return this._isWriting;
	}

	/**
	 * Requests saving data to disk.
	 * If `data` is omitted, uses `options.getSnapshot()`.
	 */
	async save(data?: T): Promise<void> {
		let snapshotData: T;
		if (data !== undefined) {
			snapshotData = data;
		} else if (this.options.getSnapshot) {
			snapshotData = this.options.getSnapshot();
		} else {
			throw new Error('[JsonSnapshotStore] No data provided and no getSnapshot function configured');
		}

		// Immutable serialization synchronously
		const content = this.serializeFn(snapshotData);

		// 1. Redundant write check when completely idle and clean
		if (
			!this._isWriting &&
			this.pendingContent === null &&
			content === this.lastPersistedContent &&
			this.latestRequestedVersion <= this.persistedVersion
		) {
			return;
		}

		// 2. If an in-flight write has identical content and nothing newer is pending
		if (
			this._isWriting &&
			this.pendingContent === null &&
			content === this.inFlightContent
		) {
			const targetVersion = this.inFlightVersion;
			return new Promise<void>((resolve, reject) => {
				this.waiters.push({ targetVersion, resolve, reject });
			});
		}

		// 3. If pending snapshot already has identical content (coalesce to existing targetVersion)
		if (this.pendingContent === content && this.pendingVersion > 0) {
			const targetVersion = this.pendingVersion;
			const promise = new Promise<void>((resolve, reject) => {
				this.waiters.push({ targetVersion, resolve, reject });
			});
			this.scheduleDrain();
			return promise;
		}

		// 4. Determine target version without version gaps
		const unallocated = this.latestRequestedVersion <= Math.max(
			this.persistedVersion,
			this.inFlightVersion,
			this.pendingVersion
		);
		const targetVersion = unallocated
			? Math.max(this.persistedVersion, this.inFlightVersion, this.pendingVersion) + 1
			: this.latestRequestedVersion;

		this.latestRequestedVersion = targetVersion;
		this.pendingVersion = targetVersion;
		this.pendingContent = content;

		const promise = new Promise<void>((resolve, reject) => {
			this.waiters.push({ targetVersion, resolve, reject });
		});

		this.scheduleDrain();
		return promise;
	}

	/**
	 * Captures a new pending snapshot from getSnapshot only if there are unqueued dirty mutations
	 * beyond the currently in-flight or persisted state.
	 */
	private captureDirtySnapshot(): void {
		if (this.pendingContent === null && this.options.getSnapshot) {
			const unqueuedVersion = Math.max(this.persistedVersion, this.inFlightVersion);
			if (this.latestRequestedVersion > unqueuedVersion) {
				const snapshotData = this.options.getSnapshot();
				const content = this.serializeFn(snapshotData);
				// Use the already allocated latestRequestedVersion rather than bumping again
				this.pendingVersion = this.latestRequestedVersion;
				this.pendingContent = content;
			}
		}
	}

	/**
	 * Flushes all pending changes to disk and waits for persistence to complete.
	 */
	async flush(): Promise<void> {
		this.captureDirtySnapshot();

		while (this.isDirty()) {
			const targetVersion = this.pendingVersion > 0
				? this.pendingVersion
				: (this.inFlightVersion > 0 ? this.inFlightVersion : this.latestRequestedVersion);

			if (targetVersion <= this.persistedVersion && !this._isWriting && this.pendingContent === null) {
				break;
			}

			const promise = new Promise<void>((resolve, reject) => {
				this.waiters.push({ targetVersion, resolve, reject });
			});

			if (!this._isWriting) {
				void this.drain();
			}

			await promise;

			// If new mutations occurred while awaiting, capture fresh snapshot if possible
			this.captureDirtySnapshot();
		}
	}

	private scheduleDrain(): void {
		if (this.drainScheduled || this._isWriting) {
			return;
		}

		this.drainScheduled = true;
		queueMicrotask(() => {
			this.drainScheduled = false;
			void this.drain();
		});
	}

	private async drain(): Promise<void> {
		if (this._isWriting || this.pendingContent === null) {
			return;
		}

		const versionToWrite = this.pendingVersion;
		const contentToWrite = this.pendingContent;

		// Clear pending state before physical write begins
		this.pendingContent = null;
		this.pendingVersion = 0;

		// Redundant write suppression
		if (contentToWrite === this.lastPersistedContent && versionToWrite <= this.persistedVersion) {
			this.resolveWaiters(versionToWrite);
			return;
		}

		this._isWriting = true;
		this.inFlightVersion = versionToWrite;
		this.inFlightContent = contentToWrite;

		try {
			await this.options.write(contentToWrite);
			this.lastPersistedContent = contentToWrite;
			this.persistedVersion = versionToWrite;

			try {
				this.options.onSuccess?.(contentToWrite);
			} catch (e) {
				Logger.error('[JsonSnapshotStore] onSuccess callback error:', e);
			}

			this.resolveWaiters(versionToWrite);
		} catch (error) {
			try {
				this.options.onError?.(error, contentToWrite);
			} catch {
				// Suppress error hook exception
			}

			// Restore pending state for explicit retry if nothing newer arrived
			if (this.pendingContent === null) {
				this.pendingContent = contentToWrite;
				this.pendingVersion = versionToWrite;
			}

			// Reject all callers waiting on this drain attempt to avoid permanently hanging promises
			this.rejectAllWaiters(error);

			// Stop draining on failure. Do NOT auto-reschedule.
			return;
		} finally {
			this._isWriting = false;
			this.inFlightVersion = 0;
			this.inFlightContent = null;
		}

		// On successful write, if newer pending work arrived during the write, schedule next drain
		if (this.pendingContent !== null) {
			this.scheduleDrain();
		}
	}

	private resolveWaiters(persistedVersion: number): void {
		const remaining: SnapshotWaiter[] = [];
		for (const waiter of this.waiters) {
			if (waiter.targetVersion <= persistedVersion) {
				waiter.resolve();
			} else {
				remaining.push(waiter);
			}
		}
		this.waiters = remaining;
	}

	private rejectAllWaiters(error: unknown): void {
		const waitersToReject = this.waiters;
		this.waiters = [];
		for (const waiter of waitersToReject) {
			waiter.reject(error);
		}
	}
}
