/** Keeps chapter shells navigable while materializing prose only near the viewport. */
export class ChapterMergePreview {
	private observer: IntersectionObserver | null = null;
	private entries = new Map<string, { card: HTMLElement; body: HTMLElement; render: () => void }>();
	private keys = new Map<Element, string>();
	private pending = new Set<string>();
	private timer: number | null = null;
	private disposed = false;
	private readonly owner: Window & typeof globalThis;
	private readonly columns: number;

	constructor(root: HTMLElement) {
		this.owner = root.ownerDocument?.defaultView ?? window;
		this.columns = Math.max(16, Math.floor((root.clientWidth || 360) / 16));
		const Observer = this.owner.IntersectionObserver;
		if (Observer) {
			this.observer = new Observer(entries => {
				if (this.disposed) return;
				for (const entry of entries) {
					const key = this.keys.get(entry.target);
					if (!key) continue;
					if (entry.isIntersecting) this.pending.add(key);
					else this.pending.delete(key);
				}
				this.schedule();
			}, { root, rootMargin: '800px 0px' });
		}
	}

	add(key: string, card: HTMLElement, body: HTMLElement, text: string, render: () => void): void {
		this.entries.set(key, { card, body, render });
		this.keys.set(card, key);
		if (!this.observer || this.entries.size === 1) {
			this.ensure(key);
			return;
		}
		// Data-dependent estimate, replaced by natural height once prose is mounted.
		const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / this.columns)), 0);
		body.addClass('wn-merge-lazy-body');
		body.style.setProperty('--wn-merge-estimated-height', `${Math.max(80, lines * 30)}px`);
		this.observer.observe(card);
	}

	ensure(key: string): HTMLElement | undefined {
		if (this.disposed) return;
		const entry = this.entries.get(key);
		if (!entry) return;
		this.pending.delete(key);
		if (this.keys.has(entry.card)) {
			this.observer?.unobserve(entry.card);
			this.keys.delete(entry.card);
			entry.body.removeClass('wn-merge-lazy-body');
			entry.body.style?.removeProperty?.('--wn-merge-estimated-height');
			entry.render();
		}
		return entry.card;
	}

	private schedule(): void {
		if (this.disposed || this.timer !== null || this.pending.size === 0) return;
		this.timer = this.owner.setTimeout(() => {
			this.timer = null;
			const key = this.pending.values().next().value;
			if (key) this.ensure(key);
			this.schedule();
		}, 0);
	}

	dispose(): void {
		this.disposed = true;
		this.observer?.disconnect();
		if (this.timer !== null) this.owner.clearTimeout(this.timer);
		this.timer = null;
		this.pending.clear();
		this.keys.clear();
		this.entries.clear();
	}
}
