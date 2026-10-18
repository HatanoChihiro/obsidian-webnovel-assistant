import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from './mocks/obsidian';
import { TaskManager } from '../src/services/TaskManager';
import type { TaskEntry } from '../src/types/task';

describe('TaskManager work scoping', () => {
	beforeEach(() => {
		(global as unknown as { window: { moment: () => { format: () => string } } }).window = {
			moment: () => ({
				format: () => '2026-08-15'
			})
		};
	});
	it('reads and calculates task progress from the explicitly requested work', async () => {
		const workAFile = new TFile('限时任务.md', '作品A/限时任务.md');
		const workBFile = new TFile('限时任务.md', '作品B/限时任务.md');
		const files = new Map([
			[workAFile.path, workAFile],
			[workBFile.path, workBFile]
		]);
		const read = vi.fn().mockResolvedValue('');
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
				read
			}
		};
		const plugin = {
			settings: { task: { fileName: '限时任务' } },
			cacheManager: {
				getFolderWordCount: vi.fn((folderPath: string) => folderPath === '作品B' ? 900 : 500)
			}
		};
		const manager = new TaskManager(app as never, plugin as never, '作品A');
		const entry: TaskEntry = {
			period: 1,
			platform: '平台',
			position: '任务',
			taskType: 'wordCount',
			wordTarget: 1000,
			startDate: '2026-08-12',
			endDate: '2026-08-18',
			startSnapshot: 200,
			status: 'active',
			rawBlock: ''
		};

		await manager.loadEntries('作品B');

		expect(read).toHaveBeenCalledWith(workBFile);
		expect(manager.calcProgress(entry, '作品B')).toBe(700);
		expect(manager.currentFolder).toBe('作品A');
	});

	it('persists progress to the task file belonging to the requested work', async () => {
		const workAFile = new TFile('限时任务.md', '作品A/限时任务.md');
		const workBFile = new TFile('限时任务.md', '作品B/限时任务.md');
		const files = new Map([
			[workAFile.path, workAFile],
			[workBFile.path, workBFile]
		]);
		const contents = new Map<string, string>();
		const process = vi.fn(async (file: TFile, update: (content: string) => string) => {
			contents.set(file.path, update(contents.get(file.path) || ''));
		});
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
				process
			}
		};
		const plugin = {
			settings: { task: { fileName: '限时任务' } },
			cacheManager: { getFolderWordCount: vi.fn() }
		};
		const manager = new TaskManager(app as never, plugin as never, '作品A');
		const entry: TaskEntry = {
			period: 1,
			platform: '平台',
			position: '任务',
			taskType: 'wordCount',
			wordTarget: 1000,
			startDate: '2026-08-12',
			endDate: '2026-08-18',
			startSnapshot: 200,
			status: 'active',
			rawBlock: ''
		};
		contents.set(workAFile.path, manager.formatEntry(entry));
		contents.set(workBFile.path, manager.formatEntry(entry));

		await manager.updateProgress(entry.period, 321, '作品B');

		expect(process).toHaveBeenCalledWith(workBFile, expect.any(Function));
		expect(manager.parseEntries(contents.get(workBFile.path) || '')[0]?.completedWords).toBe(321);
		expect(manager.parseEntries(contents.get(workAFile.path) || '')[0]?.completedWords).toBeUndefined();
	});

	it('correctly closes expired tasks as incomplete even when progress is 0', async () => {
		const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
		const files = new Map([[taskFile.path, taskFile]]);
		const contents = new Map<string, string>();
		const process = vi.fn(async (file: TFile, update: (content: string) => string) => {
			contents.set(file.path, update(contents.get(file.path) || ''));
		});
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
				read: vi.fn(async (file: TFile) => contents.get(file.path) || ''),
				process
			}
		};
		const plugin = {
			settings: { task: { fileName: '限时任务' } },
			cacheManager: {
				// 当前总字数与起始字数相同，progress = 28058 - 28058 = 0
				getFolderWordCount: vi.fn(() => 28058)
			}
		};
		const manager = new TaskManager(app as never, plugin as never, '作品A');
		const entry: TaskEntry = {
			period: 1,
			platform: '自我督促',
			position: '日更3000字',
			taskType: 'wordCount',
			wordTarget: 3000,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
			startSnapshot: 28058,
			status: 'active',
			rawBlock: ''
		};
		contents.set(taskFile.path, manager.formatEntry(entry));

		const changed = await manager.checkAndCloseExpired('作品A');

		expect(changed).toBe(true);
		const updatedEntries = manager.parseEntries(contents.get(taskFile.path) || '');
		expect(updatedEntries[0]?.status).toBe('incomplete');
		expect(updatedEntries[0]?.completedWords).toBe(0);
	});

	it('correctly closes expired tasks as completed when progress meets target', async () => {
		const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
		const files = new Map([[taskFile.path, taskFile]]);
		const contents = new Map<string, string>();
		const process = vi.fn(async (file: TFile, update: (content: string) => string) => {
			contents.set(file.path, update(contents.get(file.path) || ''));
		});
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
				read: vi.fn(async (file: TFile) => contents.get(file.path) || ''),
				process
			}
		};
		const plugin = {
			settings: { task: { fileName: '限时任务' } },
			cacheManager: {
				// 当前总字数 32000，progress = 32000 - 28000 = 4000 >= 3000
				getFolderWordCount: vi.fn(() => 32000)
			}
		};
		const manager = new TaskManager(app as never, plugin as never, '作品A');
		const entry: TaskEntry = {
			period: 2,
			platform: '自我督促',
			position: '日更3000字',
			taskType: 'wordCount',
			wordTarget: 3000,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
			startSnapshot: 28000,
			status: 'active',
			rawBlock: ''
		};
		contents.set(taskFile.path, manager.formatEntry(entry));

		const changed = await manager.checkAndCloseExpired('作品A');

		expect(changed).toBe(true);
		const updatedEntries = manager.parseEntries(contents.get(taskFile.path) || '');
		expect(updatedEntries[0]?.status).toBe('completed');
		expect(updatedEntries[0]?.completedWords).toBe(4000);
	});

	describe('TaskManager lifecycle and reconciliation', () => {
		function setupLifecycleTest(initialEntries: TaskEntry[] = [], folderWordCount = 0) {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			const files = new Map([[taskFile.path, taskFile]]);
			const contents = new Map<string, string>();
			const process = vi.fn(async (file: TFile, update: (content: string) => string) => {
				contents.set(file.path, update(contents.get(file.path) || ''));
			});
			const trigger = vi.fn();
			const app = {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					read: vi.fn(async (file: TFile) => contents.get(file.path) || ''),
					process
				},
				workspace: {
					trigger
				}
			};
			const plugin = {
				settings: { task: { fileName: '限时任务' } },
				cacheManager: {
					getFolderWordCount: vi.fn(() => folderWordCount)
				}
			};
			const manager = new TaskManager(app as never, plugin as never, '作品A');
			if (initialEntries.length > 0) {
				let formatted = '';
				for (const entry of initialEntries) {
					formatted += manager.formatEntry(entry);
				}
				contents.set(taskFile.path, formatted);
			}
			return { manager, app, plugin, contents, taskFile, trigger };
		}

		it('settles reached expired task as completed and makes newly added task active', async () => {
			const oldTask: TaskEntry = {
				period: 1,
				platform: '自我督促',
				position: '日更3000字',
				taskType: 'wordCount',
				wordTarget: 3000,
				startDate: '2026-08-10',
				endDate: '2026-08-14',
				startSnapshot: 10000,
				status: 'active',
				rawBlock: ''
			};
			// progress = 14000 - 10000 = 4000 >= 3000 (reached)
			const { manager, trigger, contents, taskFile } = setupLifecycleTest([oldTask], 14000);

			const newTask: TaskEntry = {
				period: 2,
				platform: '自我督促',
				position: '日更3000字',
				taskType: 'wordCount',
				wordTarget: 3000,
				startDate: '2026-08-15',
				endDate: '2026-08-15',
				startSnapshot: 14000,
				status: 'active',
				rawBlock: ''
			};

			await manager.addEntry(newTask, '作品A');

			const updatedEntries = manager.parseEntries(contents.get(taskFile.path) || '');
			expect(updatedEntries).toHaveLength(2);
			expect(updatedEntries[0]?.status).toBe('completed');
			expect(updatedEntries[0]?.completedWords).toBe(4000);
			expect(updatedEntries[1]?.status).toBe('active');

			const activeTask = manager.getActiveTask(updatedEntries);
			expect(activeTask).not.toBeNull();
			expect(activeTask?.period).toBe(2);

			expect(trigger).toHaveBeenCalledWith('webnovel:tasks-changed', '作品A');
		});

		it('settles unreached expired task as incomplete and makes newly added task active', async () => {
			const oldTask: TaskEntry = {
				period: 1,
				platform: '自我督促',
				position: '日更3000字',
				taskType: 'wordCount',
				wordTarget: 3000,
				startDate: '2026-08-10',
				endDate: '2026-08-14',
				startSnapshot: 10000,
				status: 'active',
				rawBlock: ''
			};
			// progress = 11000 - 10000 = 1000 < 3000 (unreached)
			const { manager, contents, taskFile } = setupLifecycleTest([oldTask], 11000);

			const newTask: TaskEntry = {
				period: 2,
				platform: '自我督促',
				position: '日更3000字',
				taskType: 'wordCount',
				wordTarget: 3000,
				startDate: '2026-08-15',
				endDate: '2026-08-15',
				startSnapshot: 11000,
				status: 'active',
				rawBlock: ''
			};

			await manager.addEntry(newTask, '作品A');

			const updatedEntries = manager.parseEntries(contents.get(taskFile.path) || '');
			expect(updatedEntries).toHaveLength(2);
			expect(updatedEntries[0]?.status).toBe('incomplete');
			expect(updatedEntries[0]?.completedWords).toBe(1000);
			expect(updatedEntries[1]?.status).toBe('active');

			const activeTask = manager.getActiveTask(updatedEntries);
			expect(activeTask).not.toBeNull();
			expect(activeTask?.period).toBe(2);
		});

		it('keeps future-dated task as notStarted when startDate is after today', async () => {
			const futureTask: TaskEntry = {
				period: 1,
				platform: '自我督促',
				position: '新书连载',
				taskType: 'wordCount',
				wordTarget: 5000,
				startDate: '2026-08-16',
				endDate: '2026-08-20',
				startSnapshot: 10000,
				status: 'notStarted',
				rawBlock: ''
			};
			const { manager, contents, taskFile } = setupLifecycleTest([futureTask], 10000);

			const changed = await manager.reconcileTasks('作品A');

			expect(changed).toBe(false);
			const updatedEntries = manager.parseEntries(contents.get(taskFile.path) || '');
			expect(updatedEntries[0]?.status).toBe('notStarted');
		});

		it('settles expired event task to incomplete', async () => {
			const expiredEventTask: TaskEntry = {
				period: 1,
				platform: '征文活动',
				position: '短篇小说奖',
				taskType: 'event',
				wordTarget: 0,
				startDate: '2026-08-10',
				endDate: '2026-08-14',
				startSnapshot: 0,
				status: 'active',
				rawBlock: ''
			};
			const { manager, contents, taskFile } = setupLifecycleTest([expiredEventTask], 0);

			const changed = await manager.reconcileTasks('作品A');

			expect(changed).toBe(true);
			const updatedEntries = manager.parseEntries(contents.get(taskFile.path) || '');
			expect(updatedEntries[0]?.status).toBe('incomplete');
			expect(updatedEntries[0]?.completedWords).toBeUndefined();
		});
	});

	describe('Important Marker Management', () => {
		it('round-trips important marker in parseEntries and formatEntry', () => {
			const manager = new TaskManager({ vault: {} } as never, { settings: {} } as never);
			const entry: TaskEntry = {
				period: 1,
				platform: '起点中文网',
				position: '每日更新',
				taskType: 'wordCount',
				wordTarget: 4000,
				startDate: '2026-09-01',
				endDate: '2026-09-30',
				startSnapshot: 0,
				status: 'active',
				important: true,
				rawBlock: ''
			};
			const formatted = manager.formatEntry(entry);
			expect(formatted).toContain('<!-- wn-important -->');

			const parsed = manager.parseEntries(formatted);
			expect(parsed).toHaveLength(1);
			expect(parsed[0].important).toBe(true);

			entry.important = false;
			const formattedUnmarked = manager.formatEntry(entry);
			expect(formattedUnmarked).not.toContain('<!-- wn-important -->');
			expect(manager.parseEntries(formattedUnmarked)[0].important).toBeUndefined();
		});

		it('toggles task importance status atomically with toggleImportance', async () => {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			const files = new Map([[taskFile.path, taskFile]]);
			const contents = new Map<string, string>();
			const process = vi.fn(async (file: TFile, update: (content: string) => string) => {
				contents.set(file.path, update(contents.get(file.path) || ''));
			});
			const app = {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					process
				},
				workspace: { trigger: vi.fn() }
			};
			const plugin = {
				settings: { task: { fileName: '限时任务' } }
			};
			const manager = new TaskManager(app as never, plugin as never, '作品A');
			const initialTask: TaskEntry = {
				period: 1,
				platform: '平台',
				position: '任务',
				taskType: 'wordCount',
				wordTarget: 1000,
				startDate: '2026-09-01',
				endDate: '2026-09-30',
				startSnapshot: 0,
				status: 'active',
				rawBlock: ''
			};
			contents.set(taskFile.path, manager.formatEntry(initialTask));

			const state1 = await manager.toggleImportance(1, 'wordCount', '作品A');
			expect(state1).toBe(true);
			expect(contents.get(taskFile.path)).toContain('<!-- wn-important -->');

			const state2 = await manager.toggleImportance(1, 'wordCount', '作品A');
			expect(state2).toBe(false);
			expect(contents.get(taskFile.path)).not.toContain('<!-- wn-important -->');
		});
	});

	describe('loadEntries cache, coalescing, and invalidation', () => {
		it('does not stamp an old in-flight read with a newer modification time', async () => {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			taskFile.stat = { mtime: 1000, size: 50 };
			let finish!: (value: string) => void;
			const read = vi.fn()
				.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }))
				.mockResolvedValue('');
			const manager = new TaskManager({ vault: {
				getAbstractFileByPath: () => taskFile,
				read
			} } as never, { settings: { task: { fileName: '限时任务' } } } as never, '作品A');
			const pending = manager.loadEntries();
			taskFile.stat.mtime = 2000;
			finish('');
			await pending;
			await manager.loadEntries();
			expect(read).toHaveBeenCalledTimes(2);
		});

		it('coalesces overlapping reads and returns cloned records to isolate mutations', async () => {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			taskFile.stat = { mtime: 1000, size: 50 };
			const files = new Map([[taskFile.path, taskFile]]);

			let resolveRead!: (content: string) => void;
			const deferredRead = new Promise<string>((resolve) => {
				resolveRead = resolve;
			});

			const readFn = vi.fn().mockImplementation(() => deferredRead);
			const app = {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					read: readFn
				}
			};
			const plugin = {
				settings: { task: { fileName: '限时任务' } }
			};
			const manager = new TaskManager(app as never, plugin as never, '作品A');

			const taskEntry: TaskEntry = {
				period: 1,
				platform: '起点',
				position: '日更',
				taskType: 'wordCount',
				wordTarget: 4000,
				startDate: '2026-08-01',
				endDate: '2026-08-31',
				startSnapshot: 0,
				status: 'active',
				rawBlock: ''
			};
			const taskContent = manager.formatEntry(taskEntry);

			// Launch two overlapping reads
			const readPromise1 = manager.loadEntries('作品A');
			const readPromise2 = manager.loadEntries('作品A');

			expect(readFn).toHaveBeenCalledTimes(1);

			resolveRead(taskContent);
			const [entries1, entries2] = await Promise.all([readPromise1, readPromise2]);

			expect(entries1).toBeDefined();
			expect(entries2).toBeDefined();
			expect(entries1).not.toBe(entries2);
			expect(entries1![0]).toEqual(entries2![0]);
			expect(entries1![0]).not.toBe(entries2![0]);

			// Mutating entries1 must not affect entries2 or cached subsequent reads
			entries1![0].platform = '已修改平台';
			expect(entries2![0].platform).toBe('起点');

			const entries3 = await manager.loadEntries('作品A');
			expect(readFn).toHaveBeenCalledTimes(1); // Cached hit
			expect(entries3![0].platform).toBe('起点');
		});

		it('invalidates on all own writes including updateProgress and notify=false operations', async () => {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			taskFile.stat = { mtime: 1000, size: 50 };
			const files = new Map([[taskFile.path, taskFile]]);
			const contents = new Map<string, string>();

			const manager = new TaskManager({
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					read: vi.fn(async (file: TFile) => contents.get(file.path) || ''),
					process: vi.fn(async (file: TFile, update: (c: string) => string) => {
						contents.set(file.path, update(contents.get(file.path) || ''));
						// Simulate mtime advance on write
						file.stat.mtime += 100;
					})
				},
				workspace: { trigger: vi.fn() }
			} as never, {
				settings: { task: { fileName: '限时任务' } }
			} as never, '作品A');

			const entry: TaskEntry = {
				period: 1,
				platform: '起点',
				position: '日更',
				taskType: 'wordCount',
				wordTarget: 4000,
				startDate: '2026-08-01',
				endDate: '2026-08-31',
				startSnapshot: 0,
				status: 'active',
				rawBlock: ''
			};
			contents.set(taskFile.path, manager.formatEntry(entry));

			// 1. Initial read caches data
			const initial = await manager.loadEntries('作品A');
			expect(initial![0].completedWords).toBeUndefined();

			// 2. updateProgress invalidates cache
			await manager.updateProgress(1, 500, '作品A');
			const afterProgress = await manager.loadEntries('作品A');
			expect(afterProgress![0].completedWords).toBe(500);

			// 3. updateEntryStatus with notify=false still invalidates cache
			await manager.updateEntryStatus(1, 'completed', 4000, 'wordCount', '作品A', false);
			const afterStatus = await manager.loadEntries('作品A');
			expect(afterStatus![0].status).toBe('completed');
			expect(afterStatus![0].completedWords).toBe(4000);
		});

		it('ensures a slow stale read does not poison the cache after invalidation or write', async () => {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			taskFile.stat = { mtime: 1000, size: 50 };
			const files = new Map([[taskFile.path, taskFile]]);

			let resolveStaleRead!: (content: string) => void;
			const staleReadPromise = new Promise<string>((resolve) => {
				resolveStaleRead = resolve;
			});

			let isFirstRead = true;
			const freshContent = new TaskManager({} as never, { settings: {} } as never).formatEntry({
				period: 1,
				platform: '最新平台',
				position: '最新任务',
				taskType: 'wordCount',
				wordTarget: 5000,
				startDate: '2026-08-01',
				endDate: '2026-08-31',
				startSnapshot: 0,
				status: 'active',
				rawBlock: ''
			});

			const readFn = vi.fn().mockImplementation(() => {
				if (isFirstRead) {
					isFirstRead = false;
					return staleReadPromise;
				}
				return Promise.resolve(freshContent);
			});

			const app = {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					read: readFn,
					process: vi.fn(async () => {})
				}
			};
			const plugin = { settings: { task: { fileName: '限时任务' } } };
			const manager = new TaskManager(app as never, plugin as never, '作品A');

			// 1. Slow read starts
			const slowRead = manager.loadEntries('作品A');

			// 2. An explicit invalidation occurs while slow read is in flight
			manager.invalidateFile(taskFile);

			// 3. Slow read resolves with OLD data
			const oldContent = manager.formatEntry({
				period: 1,
				platform: '旧平台',
				position: '旧任务',
				taskType: 'wordCount',
				wordTarget: 1000,
				startDate: '2026-08-01',
				endDate: '2026-08-31',
				startSnapshot: 0,
				status: 'active',
				rawBlock: ''
			});
			resolveStaleRead(oldContent);
			await slowRead;

			// 4. Subsequent read must NOT be poisoned by the stale read
			const currentEntries = await manager.loadEntries('作品A');
			expect(currentEntries![0].platform).toBe('最新平台');
		});

		it('allows retry after read failure and does not leave inFlightReads permanently rejected', async () => {
			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			taskFile.stat = { mtime: 1000, size: 50 };
			const files = new Map([[taskFile.path, taskFile]]);

			const readFn = vi.fn()
				.mockRejectedValueOnce(new Error('IO error'))
				.mockResolvedValueOnce('');

			const app = {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					read: readFn
				}
			};
			const plugin = { settings: { task: { fileName: '限时任务' } } };
			const manager = new TaskManager(app as never, plugin as never, '作品A');

			await expect(manager.loadEntries('作品A')).rejects.toThrow('IO error');

			// Retry must call read again rather than returning the previous rejected promise
			const retryResult = await manager.loadEntries('作品A');
			expect(retryResult).toEqual([]);
			expect(readFn).toHaveBeenCalledTimes(2);
		});

		it('cleans up registered vault listeners and invalidates only files already cached or loading', async () => {
			const listeners: Record<string, (file: unknown) => void> = {};
			const offref = vi.fn();
			const on = vi.fn((event: string, fn: (file: unknown) => void) => {
				listeners[event] = fn;
				return { event };
			});

			const app = {
				vault: {
					getAbstractFileByPath: vi.fn(),
					read: vi.fn().mockResolvedValue(''),
					on,
					offref
				}
			};
			const plugin = { settings: { task: { fileName: '限时任务' } } };
			const manager = new TaskManager(app as never, plugin as never, '作品A');

			expect(on).toHaveBeenCalledWith('modify', expect.any(Function));
			expect(on).toHaveBeenCalledWith('delete', expect.any(Function));
			expect(on).toHaveBeenCalledWith('rename', expect.any(Function));

			const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
			app.vault.getAbstractFileByPath.mockReturnValue(taskFile);
			const invalidateSpy = vi.spyOn(manager, 'invalidateFile');
			listeners['modify'](new TFile('正文.md', '作品A/正文.md'));
			expect(invalidateSpy).not.toHaveBeenCalled();

			// External modify triggers invalidation
			await manager.loadEntries();
			listeners['modify'](taskFile);
			expect(invalidateSpy).toHaveBeenCalledWith(taskFile);

			// External delete triggers invalidation
			await manager.loadEntries();
			listeners['delete'](taskFile);
			expect(invalidateSpy).toHaveBeenCalledWith(taskFile);

			// External rename triggers invalidation
			await manager.loadEntries();
			listeners['rename'](taskFile);
			expect(invalidateSpy).toHaveBeenCalledWith(taskFile);

			await manager.destroy();
			expect(offref).toHaveBeenCalledTimes(3);
		});

		it('waits for queued task persistence during destruction and stops new reads', async () => {
			const file = new TFile('限时任务.md', '作品A/限时任务.md');
			let finishWrite!: () => void;
			const manager = new TaskManager({ vault: {
				getAbstractFileByPath: () => file,
				process: () => new Promise<void>(resolve => { finishWrite = resolve; })
			} } as never, { settings: { task: { fileName: '限时任务' } } } as never, '作品A');
			const saving = manager.updateProgress(1, 100, '作品A');
			await Promise.resolve();
			let destroyed = false;
			const closing = manager.destroy().then(() => { destroyed = true; });
			await Promise.resolve();
			expect(destroyed).toBe(false);
			finishWrite();
			await Promise.all([saving, closing]);
			expect(destroyed).toBe(true);
			expect(await manager.loadEntries()).toBeNull();
		});
	});
});
