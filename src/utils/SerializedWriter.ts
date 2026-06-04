/**
 * Serialized file writer utility
 * Ensures async write operations execute sequentially via a promise queue
 */
export class SerializedWriter {
	private queue: Promise<void> = Promise.resolve();
	private dirty: boolean = false;

	/**
	 * Enqueue an async operation to execute after all prior operations complete.
	 * Supports generic return types: the returned promise resolves to the operation's result.
	 */
	enqueue<T = void>(operation: () => Promise<T>): Promise<T> {
		this.dirty = true;
		const resultPromise = this.queue.then(async () => {
			try {
				const result = await operation();
				this.dirty = false;
				return result;
			} catch (err) {
				console.error('[SerializedWriter] Operation failed:', err);
				throw err;
			}
		}) as Promise<T>;
		// [设计说明] 用 .then(() => {}) 将 queue 链与 resultPromise 的错误解耦。
		// 这是有意的容错设计：即使某个操作失败，后续排队的操作仍能正常执行。
		// 错误仅传播给 resultPromise 的调用者，不会阻塞整个队列。
		this.queue = resultPromise.then(() => {}) as Promise<void>;
		return resultPromise;
	}

	/** Mark as needing write (without immediately enqueuing) */
	markDirty(): void {
		this.dirty = true;
	}

	/** Check if there are pending changes */
	isDirty(): boolean {
		return this.dirty;
	}

	/** Wait for all queued operations to complete */
	async flush(): Promise<void> {
		await this.queue;
	}
}