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
});
