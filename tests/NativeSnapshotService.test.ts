import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App } from 'obsidian';
import { NativeSnapshotService, getChapterSnapshotScopes, buildChapterHistoryIndex } from '../src/services/NativeSnapshotService';

describe('NativeSnapshotService Regressions', () => {
	let mockApp: App;
	let localStorageData: Record<string, string>;
	let mockDbBackups: Map<number, { path: string; ts: number; data: string }>;
	let nextPrimaryKey: number;
	let mockFileRecoveryPlugin: {
		db: {
			name: string;
			add: (storeName: string, val: { path: string; ts: number; data: string }) => Promise<number>;
			get: (storeName: string, key: number) => Promise<{ path: string; ts: number; data: string } | undefined>;
			getAllKeysFromIndex?: (storeName: string, indexName: string, query?: unknown, count?: number) => Promise<unknown[]>;
			getAllFromIndex?: (storeName: string, indexName: string, query?: unknown, count?: number) => Promise<unknown[]>;
			transaction: (storeName: string, mode: string) => unknown;
		};
		tsCache: Record<string, number>;
		forceAdd: (path: string, text: string) => Promise<void>;
	};

	beforeEach(() => {
		localStorageData = {};
		mockDbBackups = new Map();
		nextPrimaryKey = 1;

		mockFileRecoveryPlugin = {
			db: {
				name: 'test-vault-backup',
				add: vi.fn(async (storeName: string, val: { path: string; ts: number; data: string }) => {
					if (storeName !== 'backups') throw new Error(`Unknown store: ${storeName}`);
					const key = nextPrimaryKey++;
					mockDbBackups.set(key, { ...val });
					return key;
				}),
				get: vi.fn(async (storeName: string, key: number) => {
					if (storeName !== 'backups') return undefined;
					const row = mockDbBackups.get(key);
					return row ? { ...row } : undefined;
				}),
				transaction: vi.fn((_storeName: string, _mode: string) => {
					return {
						objectStore: () => ({
							index: () => ({
								openCursor: () => {
									return null;
								}
							})
						})
					};
				})
			},
			tsCache: {},
			async forceAdd(path: string, text: string) {
				const now = Date.now();
				const row = { path, ts: now, data: text };
				await (this as unknown as { db: { add: (s: string, r: unknown) => Promise<number> } }).db.add('backups', row);
				(this as unknown as { tsCache: Record<string, number> }).tsCache[path] = now;
			}
		};

		mockApp = {
			appId: 'test-vault',
			loadLocalStorage: vi.fn((key: string) => localStorageData[key] ?? null),
			saveLocalStorage: vi.fn((key: string, value: string) => {
				localStorageData[key] = value;
			}),
			internalPlugins: {
				getEnabledPluginById: vi.fn((id: string) => {
					if (id === 'file-recovery') return mockFileRecoveryPlugin;
					return null;
				})
			}
		} as unknown as App;
	});

	it('should capture exact primary key and verify snapshot ref under concurrent saves', async () => {
		const service = new NativeSnapshotService(mockApp);
		const content1 = 'Chapter 1 content v1';
		const content2 = 'Chapter 1 content v2';

		const [ref1, ref2] = await Promise.all([
			service.saveSnapshot('Book/Chapter1.md', content1),
			service.saveSnapshot('Book/Chapter1.md', content2)
		]);

		expect(ref1.key).toBeDefined();
		expect(ref2.key).toBeDefined();
		expect(ref1.key).not.toBe(ref2.key);
		expect(ref1.path).toBe('Book/Chapter1.md');
		expect(ref2.path).toBe('Book/Chapter1.md');
		expect(ref1.provider).toBe('file-recovery');
		expect(ref1.dbName).toBe('test-vault-backup');
		expect(ref1.digest).toBeDefined();

		const read1 = await service.readSnapshot(ref1);
		const read2 = await service.readSnapshot(ref2);
		expect(read1).toBe(content1);
		expect(read2).toBe(content2);
	});

	it('should reject snapshot reading when device id does not match', async () => {
		const service = new NativeSnapshotService(mockApp);
		const ref = await service.saveSnapshot('Book/Chapter1.md', 'Some text');

		const foreignRef = { ...ref, deviceId: 'different-device-uuid' };
		await expect(service.readSnapshot(foreignRef)).rejects.toThrow(/foreign device/i);
	});

	it('should reject snapshot reading when dbName does not match', async () => {
		const service = new NativeSnapshotService(mockApp);
		const ref = await service.saveSnapshot('Book/Chapter1.md', 'Some text');

		const foreignDbRef = { ...ref, dbName: 'another-vault-backup' };
		await expect(service.readSnapshot(foreignDbRef)).rejects.toThrow(/foreign store/i);
	});

	it('should detect and reject reused key or path mismatch', async () => {
		const service = new NativeSnapshotService(mockApp);
		const ref = await service.saveSnapshot('Book/Chapter1.md', 'Chapter 1 original');

		// Simulate key reuse for a different file in IndexedDB
		mockDbBackups.set(ref.key, { path: 'Book/Chapter2.md', ts: Date.now(), data: 'Different file' });

		await expect(service.readSnapshot(ref)).rejects.toThrow(/mismatch|reused/i);
	});

	it('should detect and reject content digest mismatch/corruption', async () => {
		const service = new NativeSnapshotService(mockApp);
		const ref = await service.saveSnapshot('Book/Chapter1.md', 'Original clean text');

		// Simulate corrupted data in IndexedDB
		const existing = mockDbBackups.get(ref.key)!;
		mockDbBackups.set(ref.key, { ...existing, data: 'Corrupted text' });

		await expect(service.readSnapshot(ref)).rejects.toThrow(/digest mismatch/i);
	});

	it('rejects a reused primary key with the same content but a different native timestamp', async () => {
		const service = new NativeSnapshotService(mockApp);
		const ref = await service.saveSnapshot('Book/Chapter1.md', 'Same text');
		const original = mockDbBackups.get(ref.key)!;
		mockDbBackups.set(ref.key, { ...original, ts: original.ts + 1000 });
		await expect(service.readSnapshot(ref)).rejects.toThrow(/timestamp|mismatch|reused/i);
	});

	it('should fail safely when file-recovery plugin is disabled or missing', async () => {
		(mockApp as unknown as { internalPlugins: { getEnabledPluginById: () => unknown } }).internalPlugins.getEnabledPluginById = () => null;
		const service = new NativeSnapshotService(mockApp);

		const status = service.checkStatus();
		expect(status.status).toBe('disabled');
		await expect(service.saveSnapshot('Book/Chapter1.md', 'text')).rejects.toThrow(/disabled|unavailable/i);
	});

	it('should list snapshots for path bounded by limit', async () => {
		const service = new NativeSnapshotService(mockApp);
		await service.saveSnapshot('Book/Chapter1.md', 'v1');
		await service.saveSnapshot('Book/Chapter1.md', 'v2');
		await service.saveSnapshot('Book/Chapter2.md', 'other');

		mockFileRecoveryPlugin.db.getAllKeysFromIndex = vi.fn(async () => [2, 1]);
		mockFileRecoveryPlugin.db.getAllFromIndex = vi.fn(async () => [
			{ path: 'Book/Chapter1.md', ts: 200, data: 'v2' },
			{ path: 'Book/Chapter1.md', ts: 100, data: 'v1' }
		]);

		const list = await service.listSnapshotsForPath('Book/Chapter1.md', 10);
		expect(list.length).toBe(2);
		expect(list[0].key).toBe(2);
		expect(list[1].key).toBe(1);
	});

	it('should read snapshot directly by key and verify path', async () => {
		const service = new NativeSnapshotService(mockApp);
		const ref = await service.saveSnapshot('Book/Chapter1.md', 'Chapter 1 text');

		const text = await service.readSnapshotByKey(ref.key, 'Book/Chapter1.md');
		expect(text).toBe('Chapter 1 text');

		await expect(service.readSnapshotByKey(ref.key, 'Book/WrongPath.md')).rejects.toThrow(/mismatch/i);
	});

	it('should report unsupported when loadLocalStorage or saveLocalStorage is unavailable', async () => {
		const appNoStorage = {
			...mockApp,
			loadLocalStorage: undefined,
			saveLocalStorage: undefined
		} as unknown as App;
		const service = new NativeSnapshotService(appNoStorage);
		const status = service.checkStatus();
		expect(status.status).toBe('unsupported');
		await expect(service.saveSnapshot('Book/Chapter1.md', 'text')).rejects.toThrow(/unsupported/i);
	});

	it('should deny new calls and await pending operations when destroyed', async () => {
		const service = new NativeSnapshotService(mockApp);
		await service.destroy();
		await expect(service.saveSnapshot('Book/Chapter1.md', 'text')).rejects.toThrow(/destroyed|shutting down/i);
		await expect(service.listSnapshotsForPath('Book/Chapter1.md')).rejects.toThrow(/destroyed|shutting down/i);
	});
});


describe('chapter snapshot lifetime scopes', () => {
	const time = (day: number) => Date.parse(`2026-10-${day}T12:00:00Z`);
	const events: import('../src/types/writingJourney').WritingJourneyEvent[] = [
		{ id: 'c', type: 'chapter.created', timestamp: new Date(time(20)).toISOString(), path: 'old.md', chapterTitle: 'old' },
		{ id: 's', type: 'chapter.status_changed', timestamp: new Date(time(21)).toISOString(), path: 'old.md', chapterTitle: 'old', fromStatus: 'unwritten', toStatus: 'draft' },
		{ id: 'r', type: 'chapter.renamed', timestamp: new Date(time(22)).toISOString(), oldPath: 'old.md', newPath: 'new.md', oldTitle: 'old', newTitle: 'new' },
		{ id: 'd', type: 'chapter.deleted', timestamp: new Date(time(23)).toISOString(), path: 'new.md', chapterTitle: 'new' },
		{ id: 'n', type: 'chapter.created', timestamp: new Date(time(24)).toISOString(), path: 'new.md', chapterTitle: 'replacement' }
	];
	it('includes both names of the historical chapter, ending at deletion', () => {
		expect(getChapterSnapshotScopes(events, 'old.md', 's')).toEqual([
			{ path: 'old.md', from: time(20), to: time(22) },
			{ path: 'new.md', from: time(22), to: time(23) }
		]);
	});
	it('excludes old lifetimes from a recreated current chapter', () => {
		expect(getChapterSnapshotScopes(events, 'new.md')).toEqual([{ path: 'new.md', from: time(24), to: Infinity }]);
	});
	it('traces the current name backwards before deletion', () => {
		expect(getChapterSnapshotScopes(events.slice(0, 3), 'new.md')).toEqual([
			{ path: 'new.md', from: time(22), to: Infinity },
			{ path: 'old.md', from: time(20), to: time(22) }
		]);
	});
	it('does not guess the lifetime of an unknown event', () => {
		expect(getChapterSnapshotScopes(events, 'old.md', 'missing')).toEqual([]);
	});
	it('keeps delayed status records in their original lifetime without rebinding to a replacement', () => {
		const delayed = [events[0], ...events.slice(2), events[1]];
		const index = buildChapterHistoryIndex(delayed);
		expect(index.get('s')).toEqual({ path: 'new.md', deleted: true });
		expect(index.get('n')).toEqual({ path: 'new.md', deleted: false });
		expect(index.get('s')).not.toBe(index.get('n'));
	});

});
