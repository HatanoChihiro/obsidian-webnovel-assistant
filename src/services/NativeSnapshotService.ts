import type { App } from 'obsidian';
import type { ChapterSnapshotRef, WritingJourneyEvent } from '../types/writingJourney';
import { Logger } from '../utils/Logger';

export type NativeSnapshotRef = ChapterSnapshotRef;

export interface NativeSnapshotMeta {
	key: number;
	path: string;
	ts: number;
	size?: number;
}

export interface ChapterHistoryLocation { path: string; deleted: boolean }

/** Resolve all event identities in one pass; reused by the whole journey board. */
export function buildChapterHistoryIndex(events: readonly WritingJourneyEvent[]): ReadonlyMap<string, ChapterHistoryLocation> {
	const active = new Map<string, ChapterHistoryLocation>();
	const result = new Map<string, ChapterHistoryLocation>();
	const at = (path: string) => {
		let identity = active.get(path);
		if (!identity) {
			identity = { path, deleted: false };
			active.set(path, identity);
		}
		return identity;
	};
	for (const event of [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
		if (event.type === 'chapter.renamed' || event.type === 'chapter.moved') {
			const identity = at(event.oldPath);
			const displaced = active.get(event.newPath);
			if (displaced && displaced !== identity) displaced.deleted = true;
			active.delete(event.oldPath);
			identity.path = event.newPath;
			active.set(event.newPath, identity);
			result.set(event.id, identity);
		} else if (event.type === 'chapter.created') {
			const previous = active.get(event.path);
			if (previous) previous.deleted = true;
			const identity = { path: event.path, deleted: false };
			active.set(event.path, identity);
			result.set(event.id, identity);
		} else if (event.type === 'chapter.deleted') {
			const identity = at(event.path);
			identity.deleted = true;
			active.delete(event.path);
			result.set(event.id, identity);
		} else if (event.type === 'chapter.status_changed') {
			result.set(event.id, at(event.path));
		}
	}
	return result;
}

/** Limit path lookups to this chapter's lifetime, including earlier names. */
export function getChapterSnapshotScopes(events: readonly WritingJourneyEvent[], path: string, eventId?: string): { path: string; from: number; to: number }[] {
	events = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
	const anchor = eventId ? events.findIndex(event => event.id === eventId) : events.length;
	if (anchor < 0) return [];
	const scopes: { path: string; from: number; to: number }[] = [];
	let current = path;
	let end = Infinity;
	for (let i = anchor - 1; i >= 0; i--) {
		const event = events[i];
		const time = Date.parse(event.timestamp);
		if ((event.type === 'chapter.renamed' || event.type === 'chapter.moved') && event.newPath === current) {
			scopes.push({ path: current, from: time, to: end });
			current = event.oldPath;
			end = time;
		} else if ((event.type === 'chapter.created' || event.type === 'chapter.deleted') && event.path === current) {
			scopes.push({ path: current, from: time, to: end });
			current = '';
			break;
		}
	}
	if (current) scopes.push({ path: current, from: 0, to: end });
	if (eventId) {
		// The anchor's path ends at its next rename/deletion/recreation.
		const initial = scopes.find(scope => scope.path === path && scope.to === Infinity);
		if (initial) {
			current = path;
			let scope = initial;
			for (let i = anchor + 1; i < events.length; i++) {
				const event = events[i];
				const time = Date.parse(event.timestamp);
				if ((event.type === 'chapter.renamed' || event.type === 'chapter.moved') && event.oldPath === current) {
					scope.to = time;
					current = event.newPath;
					scope = { path: current, from: time, to: Infinity };
					scopes.push(scope);
				} else if ((event.type === 'chapter.deleted' || event.type === 'chapter.created') && event.path === current) {
					scope.to = time;
					break;
				}
			}
		}
	}
	return scopes;
}

export type NativeSnapshotAvailability =
	| { status: 'available'; dbName: string; deviceId: string }
	| { status: 'disabled' }
	| { status: 'not-ready'; reason?: string }
	| { status: 'unsupported'; reason: string };

const DEVICE_ID_STORAGE_KEY = 'webnovel-assistant:device-id';

/**
 * 计算纯文本的 SHA-256 内容摘要（十六进制），供快照精确校验
 */
export async function computeContentDigest(text: string): Promise<string> {
	const winCrypto = typeof window !== 'undefined' ? window.crypto : undefined;
	const subtle = winCrypto?.subtle ?? (typeof crypto !== 'undefined' ? crypto.subtle : undefined);
	if (subtle && typeof TextEncoder !== 'undefined') {
		const encoder = new TextEncoder();
		const data = encoder.encode(text);
		const hashBuffer = await subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}
	throw new Error('Web Cryptography API (crypto.subtle) is unavailable in current runtime');
}

interface NativeIdbDatabase {
	name?: string;
	add?: (storeName: string, value: unknown, key?: unknown) => Promise<unknown>;
	get?: (storeName: string, key: unknown) => Promise<unknown>;
	getAllFromIndex?: (storeName: string, indexName: string, query?: unknown, count?: number) => Promise<unknown[]>;
	getAllKeysFromIndex?: (storeName: string, indexName: string, query?: unknown, count?: number) => Promise<unknown[]>;
	transaction?: (storeNames: string | string[], mode?: string) => unknown;
}

interface NativeFileRecoveryPlugin {
	db?: NativeIdbDatabase;
	forceAdd?: (path: string, text: string) => Promise<void>;
}

interface NativeCursorRecord {
	primaryKey?: unknown;
	value?: { path?: string; ts?: number; data?: string };
	continue?: () => Promise<NativeCursorRecord | null> | void;
}

type NativeCursorResult =
	| PromiseLike<NativeCursorRecord | null>
	| {
		onsuccess?: (() => void) | null;
		onerror?: (() => void) | null;
		result?: NativeCursorRecord | null;
		error?: unknown;
	};

export class NativeSnapshotService {
	private app: App;
	private deviceIdCache: string | null = null;
	private isDestroyed = false;
	private pendingWrites = new Set<Promise<unknown>>();

	constructor(app: App) {
		this.app = app;
	}

	public async destroy(): Promise<void> {
		this.isDestroyed = true;
		this.deviceIdCache = null;
		if (this.pendingWrites.size > 0) {
			await Promise.allSettled(Array.from(this.pendingWrites));
			this.pendingWrites.clear();
		}
	}

	/**
	 * 获取或初始化当前设备的唯一标识符（存储在 Obsidian 原生 LocalStorage 中，非插件设置）
	 */
	public getOrCreateDeviceId(): string | null {
		if (this.deviceIdCache) {
			return this.deviceIdCache;
		}

		const appAny = this.app as unknown as {
			loadLocalStorage?(key: string): unknown;
			saveLocalStorage?(key: string, value: unknown): void;
		};

		if (typeof appAny.loadLocalStorage !== 'function' || typeof appAny.saveLocalStorage !== 'function') {
			return null;
		}

		let deviceId: string | null = null;
		try {
			const stored = appAny.loadLocalStorage(DEVICE_ID_STORAGE_KEY);
			if (typeof stored === 'string' && stored.trim().length > 0) {
				deviceId = stored.trim();
			}
		} catch {
			return null;
		}

		if (!deviceId) {
			const winCrypto = typeof window !== 'undefined' ? window.crypto : undefined;
			if (typeof winCrypto?.randomUUID === 'function') {
				deviceId = winCrypto.randomUUID();
			} else {
				deviceId = `dev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
			}

			try {
				appAny.saveLocalStorage(DEVICE_ID_STORAGE_KEY, deviceId);
			} catch {
				return null;
			}
		}

		this.deviceIdCache = deviceId;
		return deviceId;
	}

	private getFileRecoveryPlugin(): NativeFileRecoveryPlugin | null {
		const appAny = this.app as unknown as {
			internalPlugins?: {
				getEnabledPluginById?(id: string): NativeFileRecoveryPlugin | null | undefined;
			};
		};

		if (!appAny.internalPlugins || typeof appAny.internalPlugins.getEnabledPluginById !== 'function') {
			return null;
		}

		const plugin = appAny.internalPlugins.getEnabledPluginById('file-recovery');
		if (!plugin || typeof plugin !== 'object') {
			return null;
		}

		return plugin;
	}

	private getNativeDb(): NativeIdbDatabase | null {
		const plugin = this.getFileRecoveryPlugin();
		if (!plugin || !plugin.db || typeof plugin.db !== 'object') {
			return null;
		}
		return plugin.db;
	}

	/**
	 * 检查原生「文件恢复」快照能力状态
	 */
	public checkStatus(): NativeSnapshotAvailability {
		const appAny = this.app as unknown as {
			internalPlugins?: {
				getEnabledPluginById?(id: string): unknown;
			};
		};

		if (!appAny.internalPlugins || typeof appAny.internalPlugins.getEnabledPluginById !== 'function') {
			return { status: 'unsupported', reason: 'Internal plugins API not available' };
		}

		const plugin = this.getFileRecoveryPlugin();
		if (!plugin) {
			return { status: 'disabled' };
		}

		if (!plugin.db || typeof plugin.db.add !== 'function' || typeof plugin.db.get !== 'function') {
			return { status: 'not-ready', reason: 'File recovery database is not initialized' };
		}

		if (typeof plugin.forceAdd !== 'function') {
			return { status: 'unsupported', reason: 'File recovery forceAdd method is not available' };
		}

		const deviceId = this.getOrCreateDeviceId();
		if (!deviceId) {
			return { status: 'unsupported', reason: 'Device local storage is unavailable or failing' };
		}
		const dbName = plugin.db.name || `${(this.app as unknown as { appId?: string }).appId ?? 'vault'}-backup`;

		return { status: 'available', dbName, deviceId };
	}

	/**
	 * 执行单次原生快照保存，并精确捕获其 Primary Key
	 * 使用 PER-CALL Proxy receiver 拦截 db.add 调用，确保多处并发写入时精准对应
	 */
	public async saveSnapshot(path: string, frozenContent: string): Promise<NativeSnapshotRef> {
		if (this.isDestroyed) {
			throw new Error('NativeSnapshotService is destroyed or shutting down');
		}

		const status = this.checkStatus();
		if (status.status !== 'available') {
			throw new Error(`Native file recovery snapshot is unavailable: ${status.status}`);
		}

		const plugin = this.getFileRecoveryPlugin();
		if (!plugin || !plugin.db || typeof plugin.forceAdd !== 'function') {
			throw new Error('Native file recovery plugin is not ready');
		}

		const deviceId = status.deviceId;
		const dbName = status.dbName;
		const realDb = plugin.db;

		const saveOp = (async () => {
			let capturedKey: number | undefined;
			let capturedTs: number | undefined;

			// 构造 PER-CALL Proxy receiver
			const receiver = new Proxy(plugin, {
				get(target, prop, _rcv) {
					if (prop === 'db') {
						return new Proxy(realDb, {
							get(dbTarget, dbProp) {
								const origVal: unknown = Reflect.get(dbTarget, dbProp, dbTarget);
								if (dbProp === 'add' && typeof origVal === 'function') {
									return async function (storeName: string, value: unknown, key?: unknown) {
										const res: unknown = await (origVal as (...args: unknown[]) => Promise<unknown>).apply(dbTarget, [storeName, value, key]);
										if (storeName === 'backups' && typeof res === 'number') {
											if (value && typeof value === 'object') {
												const row = value as Record<string, unknown>;
												if (row.path === path && row.data === frozenContent) {
													if (Number.isSafeInteger(res) && res > 0) {
														capturedKey = res;
													}
													if (typeof row.ts === 'number' && Number.isFinite(row.ts) && row.ts > 0) {
														capturedTs = row.ts;
													}
												}
											}
										}
										return res;
									};
								}
								if (typeof origVal === 'function') {
									return (origVal as (...args: unknown[]) => unknown).bind(dbTarget);
								}
								return origVal;
							}
						});
					}

					const orig: unknown = Reflect.get(target, prop, target);
					if (typeof orig === 'function') {
						return (orig as (...args: unknown[]) => unknown).bind(target);
					}
					return orig;
				},
				set(target, prop, value, _rcv) {
					return Reflect.set(target, prop, value, target);
				}
			});

			// 触发原生 forceAdd
			try {
				if (!plugin.forceAdd || typeof plugin.forceAdd !== 'function') {
					throw new Error('Native file-recovery plugin does not expose forceAdd method');
				}
				await plugin.forceAdd.call(receiver, path, frozenContent);
			} catch (saveErr) {
				Logger.error(`[NativeSnapshotService] forceAdd execution failed for ${path}:`, saveErr);
				throw new Error(`Failed to execute native snapshot save: ${String(saveErr)}`);
			}

			if (capturedKey === undefined || !Number.isSafeInteger(capturedKey) || capturedKey <= 0) {
				throw new Error(`Failed to capture valid native snapshot primary key for ${path}`);
			}
			if (capturedTs === undefined || !Number.isFinite(capturedTs) || capturedTs <= 0) {
				throw new Error(`Failed to capture valid native snapshot timestamp for ${path}`);
			}

			// 立即按捕获的 primary key 读取数据库行并验证路径、正文及摘要
			if (typeof realDb.get !== 'function') {
				throw new Error('Native database get method is unavailable');
			}
			let row: unknown;
			try {
				row = await realDb.get('backups', capturedKey);
			} catch (readErr) {
				throw new Error(`Failed to verify captured snapshot key ${capturedKey}: ${String(readErr)}`);
			}

			if (!row || typeof row !== 'object') {
				throw new Error(`Verification failed: Row not found for captured key ${capturedKey}`);
			}

			const rowRec = row as { path?: string; data?: string; ts?: number };
			if (rowRec.path !== path) {
				throw new Error(`Verification failed: Captured row path mismatch (expected ${path}, got ${String(rowRec.path)})`);
			}
			if (rowRec.data !== frozenContent) {
				throw new Error('Verification failed: Captured row data does not match frozen content');
			}
			if (typeof rowRec.ts !== 'number' || !Number.isFinite(rowRec.ts) || rowRec.ts <= 0 || rowRec.ts !== capturedTs) {
				throw new Error(`Verification failed: Captured row timestamp mismatch or invalid (captured: ${capturedTs}, row: ${String(rowRec.ts)})`);
			}

			const digest = await computeContentDigest(frozenContent);
			if (!/^[0-9a-f]{64}$/i.test(digest)) {
				throw new Error(`Verification failed: Digest schema invalid (${digest})`);
			}

			const ref: NativeSnapshotRef = {
				provider: 'file-recovery',
				deviceId,
				dbName,
				key: capturedKey,
				path,
				ts: capturedTs,
				digest
			};

			return ref;
		})();

		this.pendingWrites.add(saveOp);
		try {
			return await saveOp;
		} finally {
			this.pendingWrites.delete(saveOp);
		}
	}

	/**
	 * 读取指定快照引用对应的完整正文内容，并执行严谨的设备标识、库名、路径、主键及摘要校验
	 */
	public async readSnapshot(ref: NativeSnapshotRef): Promise<string> {
		if (this.isDestroyed) {
			throw new Error('NativeSnapshotService is destroyed or shutting down');
		}

		if (ref.provider !== 'file-recovery') {
			throw new Error(`Unsupported snapshot provider: ${String(ref.provider)}`);
		}
		if (!Number.isSafeInteger(ref.key) || ref.key <= 0) {
			throw new Error(`Invalid snapshot reference key: ${ref.key}`);
		}
		if (typeof ref.ts !== 'number' || !Number.isFinite(ref.ts) || ref.ts <= 0) {
			throw new Error(`Invalid snapshot reference timestamp: ${ref.ts}`);
		}
		if (!/^[0-9a-f]{64}$/i.test(ref.digest)) {
			throw new Error(`Invalid snapshot reference digest format: ${ref.digest}`);
		}

		const currentDeviceId = this.getOrCreateDeviceId();
		if (!currentDeviceId || ref.deviceId !== currentDeviceId) {
			throw new Error(`Foreign device snapshot cannot be read locally (ref: ${ref.deviceId}, current: ${String(currentDeviceId)})`);
		}

		const db = this.getNativeDb();
		if (!db || typeof db.get !== 'function') {
			throw new Error('Native file recovery database is not available');
		}

		const currentDbName = db.name || `${(this.app as unknown as { appId?: string }).appId ?? 'vault'}-backup`;
		if (ref.dbName !== currentDbName) {
			throw new Error(`Foreign store snapshot mismatch (ref db: ${ref.dbName}, current: ${currentDbName})`);
		}

		let row: unknown;
		try {
			row = await db.get('backups', ref.key);
		} catch (err) {
			throw new Error(`Error reading snapshot from database: ${String(err)}`);
		}

		if (!row || typeof row !== 'object') {
			throw new Error(`Snapshot record key ${ref.key} not found (may have expired or been cleared)`);
		}

		const rowRec = row as { path?: string; data?: string; ts?: number };
		if (rowRec.path !== ref.path) {
			throw new Error(`Snapshot primary key reused or path mismatch (expected ${ref.path}, found ${String(rowRec.path)})`);
		}
		if (typeof rowRec.ts !== 'number' || rowRec.ts !== ref.ts) {
			throw new Error(`Snapshot timestamp mismatch or key reused (expected ${ref.ts}, found ${String(rowRec.ts)})`);
		}

		if (typeof rowRec.data !== 'string') {
			throw new Error(`Snapshot data is invalid or missing for key ${ref.key}`);
		}

		const currentDigest = await computeContentDigest(rowRec.data);
		if (this.isDestroyed || this.getNativeDb() !== db) throw new Error('Native snapshot database changed during read');
		if (currentDigest !== ref.digest) {
			throw new Error(`Snapshot content digest mismatch (expected ${ref.digest}, computed ${currentDigest})`);
		}

		return rowRec.data;
	}

	/**
	 * 直接通过主键和预期路径读取快照正文（用于面板下拉框任意历史版本选择）
	 */
	public async readSnapshotByKey(key: number, expectedPath: string, expectedTs?: number): Promise<string> {
		if (this.isDestroyed) {
			throw new Error('NativeSnapshotService is destroyed or shutting down');
		}
		const db = this.getNativeDb();
		if (!db || typeof db.get !== 'function') {
			throw new Error('Native file recovery database is not available');
		}

		let row: unknown;
		try {
			row = await db.get('backups', key);
		} catch (err) {
			throw new Error(`Error reading snapshot key ${key}: ${String(err)}`);
		}

		if (!row || typeof row !== 'object') {
			throw new Error(`Snapshot record key ${key} not found`);
		}

		if (this.isDestroyed || this.getNativeDb() !== db) throw new Error('Native snapshot database changed during read');
		const rowRec = row as { path?: string; data?: string; ts?: number };
		if (expectedTs !== undefined && rowRec.ts !== expectedTs) throw new Error('Snapshot timestamp changed');
		if (rowRec.path !== expectedPath) {
			throw new Error(`Snapshot path mismatch for key ${key} (expected ${expectedPath}, found ${String(rowRec.path)})`);
		}

		if (typeof rowRec.data !== 'string') {
			throw new Error(`Snapshot data is missing for key ${key}`);
		}

		return rowRec.data;
	}

	/**
	 * 按章节路径索引列出该章节在原生数据库中的留存快照元数据（有界列表，默认最新 200 条）
	 */
	public async listSnapshotsForPath(path: string, limit = 200): Promise<NativeSnapshotMeta[]> {
		if (this.isDestroyed) {
			throw new Error('NativeSnapshotService is destroyed or shutting down');
		}
		const db = this.getNativeDb();
		if (!db) {
			return [];
		}

		const metas: NativeSnapshotMeta[] = [];

		try {
			if (typeof db.transaction === 'function') {
				const tx = db.transaction('backups', 'readonly') as {
					objectStore?: (name: string) => unknown;
					index?: (name: string) => unknown;
				} | null;
				const store = tx && typeof tx.objectStore === 'function' ? tx.objectStore('backups') : tx;
				const storeObj = store as { index?: (name: string) => unknown } | null;
				const index = storeObj && typeof storeObj.index === 'function' ? (storeObj.index('path') as {
					openCursor?: (range?: unknown, direction?: IDBCursorDirection) => unknown;
				}) : null;

				if (index) {
					if (typeof index.openCursor === 'function') {
						const keyRange = typeof IDBKeyRange !== 'undefined' && typeof IDBKeyRange.only === 'function'
							? IDBKeyRange.only(path)
							: path;

						const cursorResult = index.openCursor(keyRange, 'prev') as NativeCursorResult | null | undefined;
						if (cursorResult && 'then' in cursorResult && typeof cursorResult.then === 'function') {
							let cursor = await cursorResult;
							while (cursor && metas.length < limit) {
								const val = cursor.value;
								const primaryKey = cursor.primaryKey;
								if (typeof primaryKey === 'number' && val) {
									metas.push({
										key: primaryKey,
										path: val.path ?? path,
										ts: typeof val.ts === 'number' ? val.ts : 0,
										size: typeof val.data === 'string' ? val.data.length : undefined
									});
								}
								cursor = typeof cursor.continue === 'function' ? ((await cursor.continue()) as NativeCursorRecord | null) : null;
							}
							return metas;
						} else if (cursorResult && 'onsuccess' in cursorResult) {
							await new Promise<void>((resolve, reject) => {
								cursorResult.onsuccess = () => {
									const cursor = cursorResult.result;
									if (cursor && metas.length < limit) {
										const val = cursor.value;
										const primaryKey = cursor.primaryKey;
										if (typeof primaryKey === 'number' && val) {
											metas.push({
												key: primaryKey,
												path: val.path ?? path,
												ts: typeof val.ts === 'number' ? val.ts : 0,
												size: typeof val.data === 'string' ? val.data.length : undefined
											});
										}
										if (typeof cursor.continue === 'function') {
											void cursor.continue();
										} else {
											resolve();
										}
									} else {
										resolve();
									}
								};
								cursorResult.onerror = () => reject(cursorResult.error instanceof Error ? cursorResult.error : new Error(String(cursorResult.error)));
							});
							return metas;
						}
					}

					if (typeof db.getAllKeysFromIndex === 'function' && typeof db.getAllFromIndex === 'function') {
						const [keys, rows] = await Promise.all([
							db.getAllKeysFromIndex('backups', 'path', path, limit),
							db.getAllFromIndex('backups', 'path', path, limit)
						]);
						for (let i = 0; i < Math.min(keys.length, rows.length); i++) {
							const k = keys[i] as number;
							const r = rows[i] as { path?: string; ts?: number; data?: string };
							if (typeof k === 'number' && r) {
								metas.push({
									key: k,
									path: r.path ?? path,
									ts: typeof r.ts === 'number' ? r.ts : 0,
									size: typeof r.data === 'string' ? r.data.length : undefined
								});
							}
						}
						metas.sort((a, b) => b.ts - a.ts);
						return metas.slice(0, limit);
					}
				}
			}
		} catch (err) {
			Logger.warn(`[NativeSnapshotService] Failed to list snapshots for ${path}:`, err);
		}

		return metas;
	}
}
