import type { NativeSnapshotMeta, NativeSnapshotService } from './NativeSnapshotService';
import type { ChapterSnapshotRef } from '../types/writingJourney';
import { ChapterDiffEngine, isFormattingOnlyRow, type ChapterDiffResult, type DiffChange } from './ChapterDiffEngine';
import { t } from '../i18n';
import { Logger } from '../utils/Logger';

export type ReplaySpeed = 1 | 3 | 5;

export interface ReplayCancellationToken {
	readonly isCancelled: boolean;
}

export interface ReplayFrameData {
	index: number;
	total: number;
	meta: NativeSnapshotMeta;
	mode: 'first' | 'transition' | 'settled';
	text: string;
	diffResult?: ChapterDiffResult;
	previousMeta?: NativeSnapshotMeta;
	cancellationToken: ReplayCancellationToken;
}

export interface ReplayState {
	isPlaying: boolean;
	currentIndex: number;
	total: number;
	currentMeta: NativeSnapshotMeta | null;
	speed: ReplaySpeed;
	error: string | null;
}

export interface TimerWindow {
	setTimeout: (fn: () => Promise<void> | void, ms: number) => number;
	clearTimeout: (id: number) => void;
}

export interface ChapterSnapshotReplayControllerOptions {
	nativeSnapshotService: NativeSnapshotService;
	snapshots: readonly NativeSnapshotMeta[];
	currentSnapshotRef?: ChapterSnapshotRef | null;
	getScopeList: () => { deviceId: string; dbName: string } | null;
	onStateChange?: (state: ReplayState) => void;
	onFrame?: (frame: ReplayFrameData) => Promise<void> | void;
	onError?: (errorMessage: string) => void;
	timerWindow?: TimerWindow;
}

interface CachedSnapshotEntry {
	key: number;
	text: string;
	deviceId: string;
	dbName: string;
	path: string;
	ts: number;
}

const BASE_INTERVAL_MS = 2500;

/** Preserve source separators in one inline flow, without comparison-row layout. */
export function getReplayTextChanges(result: ChapterDiffResult): DiffChange[] {
	return result.rows.flatMap(row => {
		if (row.type === 'unchanged' || isFormattingOnlyRow(row)) {
			return [{ value: row.rightLines.join('') }];
		}
		if (row.charDiff) return row.charDiff;
		const changes: DiffChange[] = [];
		const left = row.leftLines.join('');
		const right = row.rightLines.join('');
		if (left) changes.push({ value: left, removed: true });
		if (right) changes.push({ value: right, added: true });
		return changes;
	});
}

export class ChapterSnapshotReplayController {
	private nativeSnapshotService: NativeSnapshotService;
	public snapshots: NativeSnapshotMeta[] = [];
	private currentSnapshotRef: ChapterSnapshotRef | null = null;
	private getScopeList: () => { deviceId: string; dbName: string } | null;
	private onStateChange?: (state: ReplayState) => void;
	private onFrame?: (frame: ReplayFrameData) => Promise<void> | void;
	private onError?: (errorMessage: string) => void;
	private timerWin: TimerWindow;

	public currentIndex = -1;
	public isPlaying = false;
	public speed: ReplaySpeed = 1;
	public isDestroyed = false;
	public error: string | null = null;

	private generation = 0;
	private playIntentId = 0;
	private playTimerId: number | null = null;
	private settleTimerId: number | null = null;

	/** Bounded memory: at most two adjacent snapshot text entries */
	private cache = new Map<number, CachedSnapshotEntry>();

	/** In-flight pump: ensures at most one concurrent load/render operation */
	private isPumpBusy = false;
	private pendingSeek: {
		targetIndex: number;
		mode?: 'first' | 'transition' | 'settled';
		resolvers: Array<() => void>;
	} | null = null;

	private currentActiveToken: { isCancelled: boolean } | null = null;

	constructor(options: ChapterSnapshotReplayControllerOptions) {
		this.nativeSnapshotService = options.nativeSnapshotService;
		this.currentSnapshotRef = options.currentSnapshotRef ?? null;
		this.getScopeList = options.getScopeList;
		this.onStateChange = options.onStateChange;
		this.onFrame = options.onFrame;
		this.onError = options.onError;

		this.timerWin = options.timerWindow ?? {
			setTimeout: (fn, ms) => window.setTimeout(() => { void fn(); }, ms),
			clearTimeout: (id) => window.clearTimeout(id)
		};

		// Deterministic sort: chronologically oldest first, tie-break by key ascending
		this.snapshots = options.snapshots.slice().sort((a, b) => {
			if (a.ts !== b.ts) return a.ts - b.ts;
			return a.key - b.key;
		});
	}

	public getCacheSize(): number {
		return this.cache.size;
	}

	public async startReplay(): Promise<void> {
		if (this.isDestroyed) return;
		this.clearPlayTimer();
		if (this.settleTimerId !== null) {
			this.timerWin.clearTimeout(this.settleTimerId);
			this.settleTimerId = null;
		}
		this.isPlaying = false;
		this.error = null;
		this.generation++;

		if (this.snapshots.length === 0) {
			this.currentIndex = -1;
			this.notifyState();
			return;
		}

		this.currentIndex = 0;
		this.notifyState();
		await this.enqueueSeek(0, 'first');
	}

	public async play(): Promise<boolean> {
		if (this.isDestroyed || this.snapshots.length <= 1) {
			return false;
		}

		const intent = ++this.playIntentId;
		const hadPriorError = this.error !== null;
		this.error = null;

		// If at the last frame, restart from the first
		if (this.currentIndex >= this.snapshots.length - 1) {
			const ok = await this.enqueueSeek(0, 'first');
			if (!ok || this.isDestroyed || intent !== this.playIntentId) {
				return false;
			}
		} else if (hadPriorError || this.isPumpBusy) {
			// Prior error: retry current target first without playing on
			const ok = await this.enqueueSeek(this.currentIndex, 'settled');
			if (!ok || this.isDestroyed || intent !== this.playIntentId) {
				return false;
			}
		}

		if (this.isDestroyed || intent !== this.playIntentId || this.error !== null) {
			return false;
		}

		this.isPlaying = true;
		this.notifyState();
		this.scheduleTransition(this.getTickInterval());
		return true;
	}

	public pause(): void {
		this.playIntentId++;
		this.clearTimers();
		if (this.isPlaying) {
			this.isPlaying = false;
			this.notifyState();
		}
	}

	public async step(direction: 1 | -1): Promise<void> {
		this.pause();
		if (this.snapshots.length === 0) return;

		const target = this.currentIndex + direction;
		if (target < 0 || target >= this.snapshots.length) return;

		await this.enqueueSeek(target, 'transition');
	}

	public async seek(targetIndex: number): Promise<void> {
		this.pause();
		if (this.snapshots.length === 0 || !Number.isFinite(targetIndex)) return;

		const clamped = Math.max(0, Math.min(Math.round(targetIndex), this.snapshots.length - 1));
		await this.enqueueSeek(clamped, 'transition');
	}

	public setSpeed(speed: ReplaySpeed): void {
		this.speed = speed;
		this.notifyState();
		if (this.isPlaying && !this.isPumpBusy) {
			if (this.playTimerId !== null) {
				this.clearPlayTimer();
				this.scheduleTransition(this.getTickInterval());
			}
			if (this.settleTimerId !== null) {
				this.timerWin.clearTimeout(this.settleTimerId);
				this.settleTimerId = null;
				this.scheduleSettle(this.getSettleDelay(), this.currentIndex, this.generation);
			}
		}
	}

	private getTickInterval(): number {
		return Math.round(BASE_INTERVAL_MS / this.speed);
	}

	private getSettleDelay(): number {
		return Math.round(this.getTickInterval() * 0.8);
	}

	private scheduleTransition(delayMs: number): void {
		this.clearPlayTimer();
		if (!this.isPlaying || this.isDestroyed) return;

		this.playTimerId = this.timerWin.setTimeout(async () => {
			this.playTimerId = null;
			await this.onTransition();
		}, delayMs);
	}

	private async onTransition(): Promise<void> {
		if (!this.isPlaying || this.isDestroyed || this.isPumpBusy) return;

		if (this.currentIndex >= this.snapshots.length - 1) {
			this.pause();
			return;
		}

		this.isPumpBusy = true;
		const nextIndex = this.currentIndex + 1;
		const prevIndex = this.currentIndex;
		this.currentIndex = nextIndex;
		const curGen = ++this.generation;
		this.notifyState();

		try {
			await this.loadAndRenderFrame(nextIndex, 'transition', prevIndex, curGen);
			if (!this.isPlaying || this.isDestroyed || curGen !== this.generation) return;

			// Advance to settle only after transition frame render completed
			this.scheduleSettle(this.getSettleDelay(), nextIndex, curGen);
		} catch {
			// Error handled inside loadAndRenderFrame
		} finally {
			this.isPumpBusy = false;
			this.drainPendingSeek();
		}
	}

	private scheduleSettle(delayMs: number, index: number, gen: number): void {
		if (this.settleTimerId !== null) {
			this.timerWin.clearTimeout(this.settleTimerId);
			this.settleTimerId = null;
		}
		if (this.isDestroyed || gen !== this.generation) return;

		this.settleTimerId = this.timerWin.setTimeout(async () => {
			this.settleTimerId = null;
			await this.onSettle(index, gen);
		}, delayMs);
	}

	private async onSettle(index: number, gen: number): Promise<void> {
		if (this.isDestroyed || gen !== this.generation) return;
		if (this.isPumpBusy) {
			// Defer settle if pump is currently occupied by a seek
			this.scheduleSettle(50, index, gen);
			return;
		}

		this.isPumpBusy = true;
		try {
			await this.loadAndRenderFrame(index, 'settled', undefined, gen);
		} catch {
			// Error handled inside loadAndRenderFrame
		} finally {
			this.isPumpBusy = false;
			this.drainPendingSeek();
		}

		if (this.isDestroyed || gen !== this.generation) return;

		if (this.currentIndex >= this.snapshots.length - 1) {
			this.pause();
			return;
		}

		if (!this.isPlaying) return;

		// Advance timer only after settle render completed; do not overlap ticks
		const remaining = Math.max(100, this.getTickInterval() - this.getSettleDelay());
		this.scheduleTransition(remaining);
	}

	private enqueueSeek(
		targetIndex: number,
		mode?: 'first' | 'transition' | 'settled'
	): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			if (this.isDestroyed) {
				resolve(false);
				return;
			}
			this.clearTimers();
			this.invalidateActiveToken();
			this.error = null;
			const clamped = Math.max(0, Math.min(targetIndex, this.snapshots.length - 1));
			const wrapper = () => {
				resolve(!this.error && !this.isDestroyed);
			};

			if (this.isPumpBusy) {
				this.invalidateActiveToken();
				if (this.pendingSeek) {
					this.pendingSeek.targetIndex = clamped;
					this.pendingSeek.mode = mode;
					this.pendingSeek.resolvers.push(wrapper);
				} else {
					this.pendingSeek = {
						targetIndex: clamped,
						mode,
						resolvers: [wrapper]
					};
				}
			} else {
				void this.runPump(clamped, mode ?? 'transition', [wrapper]);
			}
		});
	}

	private async runPump(
		targetIndex: number,
		mode: 'first' | 'transition' | 'settled' | undefined,
		initialResolvers: Array<() => void> = []
	): Promise<void> {
		this.isPumpBusy = true;
		let nextTarget: number | null = targetIndex;
		let nextMode: 'first' | 'transition' | 'settled' | undefined = mode;
		let activeResolvers: Array<() => void> = [...initialResolvers];

		while (nextTarget !== null && !this.isDestroyed) {
			const target = nextTarget;
			const targetMode = nextMode;
			const resolversToComplete = activeResolvers;
			activeResolvers = [];
			nextTarget = null;
			nextMode = undefined;

			this.currentIndex = target;
			const curGen = ++this.generation;
			this.notifyState();

			let calculatedMode: 'first' | 'transition' | 'settled';
			if (target === 0 || targetMode === 'first') {
				calculatedMode = 'first';
			} else if (targetMode === 'settled') {
				calculatedMode = 'settled';
			} else {
				calculatedMode = 'transition';
			}
			const pIdx = calculatedMode === 'transition' ? target - 1 : undefined;

			try {
				await this.loadAndRenderFrame(target, calculatedMode, pIdx, curGen);
			} catch {
				// Handled inside loadAndRenderFrame
			}

			resolversToComplete.forEach((r) => r());

			if (this.pendingSeek) {
				nextTarget = this.pendingSeek.targetIndex;
				nextMode = this.pendingSeek.mode;
				activeResolvers = this.pendingSeek.resolvers;
				this.pendingSeek = null;
			}
		}

		this.isPumpBusy = false;
		activeResolvers.forEach((r) => r());
	}

	private drainPendingSeek(): void {
		if (this.pendingSeek && !this.isPumpBusy && !this.isDestroyed) {
			const next = this.pendingSeek;
			this.pendingSeek = null;
			void this.runPump(next.targetIndex, next.mode, next.resolvers);
		}
	}

	private invalidateActiveToken(): void {
		if (this.currentActiveToken) {
			this.currentActiveToken.isCancelled = true;
			this.currentActiveToken = null;
		}
	}

	private canReuseCached(
		cached: CachedSnapshotEntry | undefined,
		meta: NativeSnapshotMeta
	): cached is CachedSnapshotEntry {
		if (!cached || cached.key !== meta.key) return false;
		const status = this.nativeSnapshotService.checkStatus();
		if (status.status !== 'available') return false;
		if (cached.deviceId !== status.deviceId || cached.dbName !== status.dbName) return false;
		const scope = this.getScopeList();
		if (!scope || scope.deviceId !== status.deviceId || scope.dbName !== status.dbName) return false;
		return cached.path === meta.path && cached.ts === meta.ts;
	}

	private validateScope(): { deviceId: string; dbName: string } {
		const status = this.nativeSnapshotService.checkStatus();
		if (status.status !== 'available') {
			throw new Error(
				status.status === 'disabled'
					? t('snapshot.recovery-disabled')
					: status.status === 'not-ready'
						? t('snapshot.recovery-not-ready')
						: t('snapshot.recovery-unsupported')
			);
		}
		const scope = this.getScopeList();
		if (!scope || scope.deviceId !== status.deviceId || scope.dbName !== status.dbName) {
			this.cache.clear();
			this.pause();
			throw new Error(t('snapshot.missing-ref'));
		}
		return status;
	}

	private async readSnapshotText(
		meta: NativeSnapshotMeta,
		currentGen: number,
		token: ReplayCancellationToken
	): Promise<string> {
		this.validateScope();
		if (this.isDestroyed || token.isCancelled || currentGen !== this.generation) throw new Error('Cancelled');
		const cached = this.cache.get(meta.key);
		if (this.canReuseCached(cached, meta)) {
			return cached.text;
		}

		// Pre-validation BEFORE any read
		const statusBefore = this.validateScope();

		if (this.isDestroyed || token.isCancelled || currentGen !== this.generation) {
			throw new Error('Cancelled');
		}

		const ref = this.currentSnapshotRef;
		let text: string;

		if (ref && ref.key === meta.key) {
			text = await this.nativeSnapshotService.readSnapshot(ref);
		} else {
			text = await this.nativeSnapshotService.readSnapshotByKey(meta.key, meta.path, meta.ts);
		}

		if (this.isDestroyed || token.isCancelled || currentGen !== this.generation) {
			throw new Error('Cancelled');
		}

		// Post-validation AFTER read
		const statusAfter = this.validateScope();
		if (
			statusAfter.deviceId !== statusBefore.deviceId ||
			statusAfter.dbName !== statusBefore.dbName ||
			(ref?.key === meta.key && (ref.deviceId !== statusAfter.deviceId || ref.dbName !== statusAfter.dbName))
		) {
			this.cache.clear();
			this.pause();
			throw new Error(t('snapshot.missing-ref'));
		}

		// Cache entry
		this.cache.set(meta.key, {
			key: meta.key,
			text,
			deviceId: statusAfter.deviceId,
			dbName: statusAfter.dbName,
			path: meta.path,
			ts: meta.ts
		});

		return text;
	}

	private pruneCache(keepKeys: number[]): void {
		const keepSet = new Set(keepKeys);
		for (const key of this.cache.keys()) {
			if (!keepSet.has(key)) {
				this.cache.delete(key);
			}
		}
	}

	private async emitFrame(frame: ReplayFrameData): Promise<void> {
		if (this.onFrame) {
			await this.onFrame(frame);
		}
	}

	private async loadAndRenderFrame(
		index: number,
		mode: 'first' | 'transition' | 'settled',
		prevIndex?: number,
		expectedGen = this.generation
	): Promise<void> {
		if (this.isDestroyed || expectedGen !== this.generation) return;
		const meta = this.snapshots[index];
		if (!meta) return;

		const token = { isCancelled: false };
		this.currentActiveToken = token;
		const settlingPlayback = mode === 'settled' && this.isPlaying;
		const isCancelled = () => this.isDestroyed || token.isCancelled || expectedGen !== this.generation
			|| (settlingPlayback && !this.isPlaying);
		const cancellationToken: ReplayCancellationToken = { get isCancelled() { return isCancelled(); } };

		try {
			// Bounded cache maintenance: keep at most adjacent two keys
			const requiredKeys =
				prevIndex !== undefined && prevIndex >= 0 && prevIndex < this.snapshots.length
					? [this.snapshots[prevIndex].key, meta.key]
					: [meta.key];
			this.pruneCache(requiredKeys);

			const currentText = await this.readSnapshotText(meta, expectedGen, cancellationToken);
			if (isCancelled()) return;

			if (mode === 'first' || mode === 'settled' || prevIndex === undefined) {
				await this.emitFrame({
					index,
					total: this.snapshots.length,
					meta,
					mode,
					text: currentText,
					cancellationToken
				});
				return;
			}

			// Transition mode: read previous snapshot and compute diff
			const prevMeta = this.snapshots[prevIndex];
			const prevText = await this.readSnapshotText(prevMeta, expectedGen, cancellationToken);
			if (isCancelled()) return;

			let diffResult: ChapterDiffResult;
			try {
				diffResult = await ChapterDiffEngine.computeDiff(prevText, currentText, {
					isCancelled
				});
			} catch (diffErr) {
				if (isCancelled()) return;
				Logger.error('[ChapterSnapshotReplayController] Diff failed:', diffErr);
				throw new Error(t('snapshot.compare-failed'));
			}

			if (isCancelled()) return;

			// Fire transition frame
			await this.emitFrame({
				index,
				total: this.snapshots.length,
				meta,
				mode: 'transition',
				text: currentText,
				diffResult,
				previousMeta: prevMeta,
				cancellationToken
			});
		} catch (err) {
			if (!isCancelled()) this.handleError(err, expectedGen);
			throw err;
		}
	}

	private normalizeErrorMessage(rawMsg: string): string {
		const knownErrors = [
			t('snapshot.missing-ref'),
			t('snapshot.compare-failed'),
			t('snapshot.recovery-disabled'),
			t('snapshot.recovery-not-ready'),
			t('snapshot.recovery-unsupported'),
			t('snapshot.no-snapshots')
		];
		if (knownErrors.includes(rawMsg)) {
			return rawMsg;
		}
		return t('snapshot.compare-failed');
	}

	private handleError(err: unknown, gen: number): void {
		if (this.isDestroyed || gen !== this.generation) return;
		const rawMsg = err instanceof Error ? err.message : String(err);
		if (rawMsg === 'Cancelled') return;

		this.pause();
		this.clearTimers();
		this.invalidateActiveToken();
		this.cache.clear();
		const msg = this.normalizeErrorMessage(rawMsg);
		this.error = msg;
		this.notifyState();
		if (this.onError) {
			this.onError(msg);
		}
	}

	private clearPlayTimer(): void {
		if (this.playTimerId !== null) {
			this.timerWin.clearTimeout(this.playTimerId);
			this.playTimerId = null;
		}
	}

	private clearTimers(): void {
		this.clearPlayTimer();
		if (this.settleTimerId !== null) {
			this.timerWin.clearTimeout(this.settleTimerId);
			this.settleTimerId = null;
		}
	}

	private notifyState(): void {
		if (this.onStateChange && !this.isDestroyed) {
			this.onStateChange({
				isPlaying: this.isPlaying,
				currentIndex: this.currentIndex,
				total: this.snapshots.length,
				currentMeta: this.snapshots[this.currentIndex] ?? null,
				speed: this.speed,
				error: this.error
			});
		}
	}

	public destroy(): void {
		if (this.isDestroyed) return;
		this.isDestroyed = true;
		this.generation++;
		this.playIntentId++;
		this.invalidateActiveToken();
		this.clearTimers();
		this.isPlaying = false;
		this.cache.clear();
		this.snapshots = [];
		if (this.pendingSeek) {
			const resolvers = this.pendingSeek.resolvers;
			this.pendingSeek = null;
			resolvers.forEach((r) => r());
		}
	}
}
