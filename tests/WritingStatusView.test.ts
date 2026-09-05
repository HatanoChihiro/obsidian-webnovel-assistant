import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkspaceLeaf, TFile } from './mocks/obsidian';
import { WritingStatusView, type WritingStatusViewPlugin } from '../src/ui/StatusView';
import type { TaskManager } from '../src/services/TaskManager';

describe('WritingStatusView task lifecycle gating', () => {
	type TaskLifecycleGate = {
		reconcileTaskLifecycleForFolder(taskFolder: string, generation?: number, currentDate?: string): Promise<boolean>;
		updateGeneration: number;
	};

	let view: WritingStatusView;
	let taskLifecycleGate: TaskLifecycleGate;
	let mockTaskManager: {
		reconcileTasks: ReturnType<typeof vi.fn>;
		getTaskFile: ReturnType<typeof vi.fn>;
		parseEntries: ReturnType<typeof vi.fn>;
		getActiveTask: ReturnType<typeof vi.fn>;
		calcProgress: ReturnType<typeof vi.fn>;
		updateProgress: ReturnType<typeof vi.fn>;
		updateEntryStatus: ReturnType<typeof vi.fn>;
	};
	let mockPlugin: WritingStatusViewPlugin;
	let mockLeaf: WorkspaceLeaf;

	beforeEach(() => {
		const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
		mockTaskManager = {
			reconcileTasks: vi.fn().mockResolvedValue(true),
			getTaskFile: vi.fn((_folder: string) => taskFile as unknown as import('obsidian').TFile),
			parseEntries: vi.fn().mockReturnValue([]),
			getActiveTask: vi.fn().mockReturnValue(null),
			calcProgress: vi.fn().mockReturnValue(0),
			updateProgress: vi.fn().mockResolvedValue(undefined),
			updateEntryStatus: vi.fn().mockResolvedValue(undefined)
		};

		mockPlugin = {
			taskManager: mockTaskManager as unknown as TaskManager,
			settings: {},
			isTracking: false,
			focusMs: 0,
			slackMs: 0,
			startTracking: vi.fn(),
			stopTracking: vi.fn(),
			refreshStatusViews: vi.fn(),
			cacheManager: {
				getFolderWordCount: vi.fn(() => 0),
				isEligibleForWordCount: vi.fn(() => true)
			},
			characterManager: {
				getBookPathForFile: vi.fn(() => '作品A'),
				isLorePath: vi.fn(() => false)
			},
			statisticsManager: {
				getCoreStats: vi.fn(() => ({
					dailyWords: 0,
					dailyGoal: 0,
					rawDailyWords: 0,
					dailyPercent: 0,
					todayWords: 0,
					goal: 0,
					percent: 0
				})),
				calcStreak: vi.fn(() => 0),
				calcFocusRate: vi.fn(() => 0),
				calcActiveHours: vi.fn(() => 0),
				calcDailyAverage: vi.fn(() => 0),
				calcWritingSpeed: vi.fn(() => 0),
				calcTaskCompletion: vi.fn(() => 0),
				calcNovelCompletionRate: vi.fn(() => 0),
				aggregateHistoryData: vi.fn(() => ({}))
			},
			historyManager: {
				getHistory: vi.fn(() => ({}))
			}
		} as unknown as WritingStatusViewPlugin;

		mockLeaf = new WorkspaceLeaf();
		view = new WritingStatusView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, mockPlugin);
		taskLifecycleGate = view as unknown as TaskLifecycleGate;
	});

	it('reconciles on the first call for a folder and gates subsequent calls on the same date', async () => {
		// 第一次调用（同日）：应触发 reconcileTasks
		const result1 = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(result1).toBe(true);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledWith('作品A', true);

		// 第二次调用（模拟连续打字/刷新）：同文件夹同日，不再调用底层写入/调和
		const result2 = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(result2).toBe(false);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);

		// 第三次调用（模拟更多按键）：依然被门禁拦截
		const result3 = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(result3).toBe(false);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);
	});

	it('reconciles on the first refresh after calendar day changes', async () => {
		// Day 1
		await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);

		// 跨日后第一次刷新 (Day 2)：应再次触发调和
		const resultDay2 = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-04');
		expect(resultDay2).toBe(true);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(2);

		// Day 2 后续打字刷新：被门禁拦截
		const resultDay2Second = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-04');
		expect(resultDay2Second).toBe(false);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(2);
	});

	it('maintains independent gating per folder context and normalizes root folder', async () => {
		// Folder A
		await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);

		// Folder B
		await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品B', 0, '2026-09-03');
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(2);
		expect(mockTaskManager.reconcileTasks).toHaveBeenLastCalledWith('作品B', true);

		// Root folder with '/'
		await taskLifecycleGate.reconcileTaskLifecycleForFolder('/', 0, '2026-09-03');
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(3);

		// Root folder with '' on same day should be recognized as same root folder and gated
		await taskLifecycleGate.reconcileTaskLifecycleForFolder('', 0, '2026-09-03');
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(3);
	});

	it('deduplicates concurrent in-flight reconciliation calls', async () => {
		let resolveReconcile!: (val: boolean) => void;
		const delayedPromise = new Promise<boolean>((resolve) => {
			resolveReconcile = resolve;
		});
		mockTaskManager.reconcileTasks.mockReturnValue(delayedPromise);

		// 同时触发两次调和
		const call1 = taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		const call2 = taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');

		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);

		resolveReconcile(true);
		const [res1, res2] = await Promise.all([call1, call2]);

		expect(res1).toBe(true);
		expect(res2).toBe(false);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);
	});

	it('handles generation mismatch safely when update generation changes during in-flight reconciliation', async () => {
		let resolveReconcile!: (val: boolean) => void;
		const delayedPromise = new Promise<boolean>((resolve) => {
			resolveReconcile = resolve;
		});
		mockTaskManager.reconcileTasks.mockReturnValue(delayedPromise);

		// generation 1 开始
		const call = taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 1, '2026-09-03');

		// 模拟外部触发了新的更新，generation 变更为 2
		taskLifecycleGate.updateGeneration = 2;

		resolveReconcile(true);
		const result = await call;

		// 旧 generation 检测到世代不一致，安全返回 false
		expect(result).toBe(false);
	});

	it('recovers safely if reconciliation throws an error, allowing subsequent retry', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockTaskManager.reconcileTasks.mockRejectedValueOnce(new Error('Disk read error'));

		const failResult = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(failResult).toBe(false);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(1);

		// 失败后不应永久锁死门禁，重试应再次尝试
		mockTaskManager.reconcileTasks.mockResolvedValueOnce(true);
		const retryResult = await taskLifecycleGate.reconcileTaskLifecycleForFolder('作品A', 0, '2026-09-03');
		expect(retryResult).toBe(true);
		expect(mockTaskManager.reconcileTasks).toHaveBeenCalledTimes(2);

		consoleSpy.mockRestore();
	});
});
