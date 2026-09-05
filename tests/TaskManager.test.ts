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
});
