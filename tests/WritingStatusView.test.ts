import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkspaceLeaf, TFile, TFolder, MarkdownView } from './mocks/obsidian';
import { WritingStatusView, type WritingStatusViewPlugin } from '../src/ui/StatusView';
import type { TaskManager } from '../src/services/TaskManager';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../src/types/foreshadowing';
import moment from 'moment';
import { StatisticsManager } from '../src/services/StatisticsManager';
import type { DailyStat } from '../src/types/settings';

describe('WritingStatusView task lifecycle gating', () => {
	type TaskLifecycleGate = {
		reconcileTaskLifecycleForFolder(taskFolder: string, generation?: number, currentDate?: string): Promise<boolean>;
		updateGeneration: number;
	};
	type ChapterReferenceMatcherHarness = {
		createChapterReferenceMatcher(
			file: import('obsidian').TFile,
			folderPath: string,
			sourcePath: string
		): (target: string | undefined) => boolean;
	};

	let view: WritingStatusView;
	let taskLifecycleGate: TaskLifecycleGate;
	let mockTaskManager: {
		reconcileTasks: ReturnType<typeof vi.fn>;
		getTaskFile: ReturnType<typeof vi.fn>;
		loadEntries: ReturnType<typeof vi.fn>;
		parseEntries: ReturnType<typeof vi.fn>;
		getActiveTask: ReturnType<typeof vi.fn>;
		calcProgress: ReturnType<typeof vi.fn>;
		updateProgress: ReturnType<typeof vi.fn>;
		updateEntryStatus: ReturnType<typeof vi.fn>;
	};
	let mockPlugin: WritingStatusViewPlugin;
	let mockLeaf: WorkspaceLeaf;

	beforeEach(() => {
		ChapterSorter.setCustomRules([]);
		const taskFile = new TFile('限时任务.md', '作品A/限时任务.md');
		mockTaskManager = {
			reconcileTasks: vi.fn().mockResolvedValue(true),
			getTaskFile: vi.fn((_folder: string) => taskFile as unknown as import('obsidian').TFile),
			loadEntries: vi.fn().mockResolvedValue([]),
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
			getVaultMarkdownFiles: vi.fn(() => []),
			getTrackedMarkdownFiles: vi.fn(() => []),
			isFileInStrictChapterException: vi.fn(() => false),
			isPluginGeneratedFile: vi.fn(() => false),
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
				getHistory: vi.fn(() => ({})),
				getWordRevision: vi.fn(() => 0),
				wordRevision: 0
			}
		} as unknown as WritingStatusViewPlugin;

		mockLeaf = new WorkspaceLeaf();
		view = new WritingStatusView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, mockPlugin);
		taskLifecycleGate = view as unknown as TaskLifecycleGate;
	});

	it('isolates path-qualified duplicate chapter references and rejects ambiguous legacy basenames', () => {
		const book = Object.assign(new TFolder(), { name: '作品A', path: '作品A' });
		const volume1 = Object.assign(new TFolder(), { name: '第一卷', path: '作品A/第一卷', parent: book });
		const volume2 = Object.assign(new TFolder(), { name: '第二卷', path: '作品A/第二卷', parent: book });
		const createChapter = (parent: TFolder, basename: string): TFile => Object.assign(new TFile(), {
			name: `${basename}.md`,
			path: `${parent.path}/${basename}.md`,
			basename,
			extension: 'md',
			parent
		});
		const v1c1 = createChapter(volume1, '第一章');
		const v1c2 = createChapter(volume1, '第二章');
		const v2c1 = createChapter(volume2, '第一章');
		volume1.children = [v1c1, v1c2];
		volume2.children = [v2c1];
		book.children = [volume2, volume1];

		(view as unknown as { app: { vault: { getAbstractFileByPath(path: string): TFolder | null } } }).app = {
			vault: { getAbstractFileByPath: (path: string) => path === book.path ? book : null }
		};
		const harness = view as unknown as ChapterReferenceMatcherHarness;
		const matchesV1C1 = harness.createChapterReferenceMatcher(
			v1c1 as unknown as import('obsidian').TFile,
			book.path,
			'作品A/伏笔.md'
		);

		expect(matchesV1C1('第一卷/第一章|第一章')).toBe(true);
		expect(matchesV1C1('第二卷/第一章|第一章')).toBe(false);
		expect(matchesV1C1('第一章')).toBe(false);

		const matchesUniqueV1C2 = harness.createChapterReferenceMatcher(
			v1c2 as unknown as import('obsidian').TFile,
			book.path,
			'作品A/伏笔.md'
		);
		expect(matchesUniqueV1C2('第二章')).toBe(true);
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

describe('WritingStatusView work retention and context isolation', () => {
	let view: WritingStatusView;
	let mockPlugin: WritingStatusViewPlugin;
	let mockLeaf: WorkspaceLeaf;
	let mockTaskManager: {
		reconcileTasks: ReturnType<typeof vi.fn>;
		getTaskFile: ReturnType<typeof vi.fn>;
		loadEntries: ReturnType<typeof vi.fn>;
		parseEntries: ReturnType<typeof vi.fn>;
		getActiveTask: ReturnType<typeof vi.fn>;
		calcProgress: ReturnType<typeof vi.fn>;
		updateProgress: ReturnType<typeof vi.fn>;
		updateEntryStatus: ReturnType<typeof vi.fn>;
	};

	function createTestEl(): HTMLElement {
		const children: HTMLElement[] = [];
		const el = {
			innerText: '',
			textContent: '',
			hidden: false,
			className: '',
			title: '',
			style: { display: '' },
			setText(t: string) { el.innerText = t; el.textContent = t; return el; },
			empty() { el.innerText = ''; el.textContent = ''; children.length = 0; },
			addClass(...cls: string[]) {
				const set = new Set((el.className || '').split(' ').filter(Boolean));
				cls.forEach(c => set.add(c));
				el.className = Array.from(set).join(' ');
				return el;
			},
			removeClass(...cls: string[]) {
				el.className = (el.className || '').split(' ').filter((c: string) => !cls.includes(c)).join(' ');
				return el;
			},
			toggleClass(c: string, force?: boolean) {
				const has = force !== undefined ? force : !(el.className || '').includes(c);
				if (has) el.addClass(c); else el.removeClass(c);
				return has;
			},
			show() { el.hidden = false; el.style.display = ''; },
			hide() { el.hidden = true; el.style.display = 'none'; },
			createDiv: vi.fn((options?: string | { cls?: string; text?: string }) => {
				const child = createTestEl();
				if (typeof options === 'string') child.className = options;
				else if (options) {
					child.className = options.cls ?? '';
					if (options.text !== undefined) child.setText(options.text);
				}
				children.push(child);
				return child;
			}),
			createSpan: vi.fn(() => { const child = createTestEl(); children.push(child); return child; }),
			createEl: vi.fn(() => { const child = createTestEl(); children.push(child); return child; }),
			setCssProps: vi.fn(),
			setAttribute: vi.fn(),
			getAttribute: vi.fn(),
			addEventListener: vi.fn(),
			children
		};
		return el as unknown as HTMLElement;
	}

	function attachMockElements(v: WritingStatusView) {
		v.workNameEl = createTestEl();
		v.workWordCountEl = createTestEl();
		v.workGoalEl = createTestEl();
		v.dailyWordEl = createTestEl();
		v.dailyGoalEl = createTestEl();
		v.dailyPercentEl = createTestEl();
		v.dailyProgressFillEl = createTestEl();
		v.todayWordEl = createTestEl();
		v.goalWordEl = createTestEl();
		v.percentEl = createTestEl();
		v.progressFillEl = createTestEl();
		v.chapterSectionEls = [createTestEl(), createTestEl(), createTestEl()];
		v.chapterStatusCardEl = createTestEl();
		v.chapterTitleEl = createTestEl();
		v.chapterStatusBadgeEl = createTestEl();
		v.chapterBadgesContainer = createTestEl();
		v.chapterSubInfoEl = createTestEl();
		v.taskRowEl = createTestEl();
		v.taskWordEl = createTestEl();
		v.taskSeparatorEl = createTestEl();
		v.taskTargetEl = createTestEl();
		v.taskPercentEl = createTestEl();
		v.taskProgressFillEl = createTestEl();
		v.taskEventCompleteBtn = createTestEl();
		v.taskSectionEls = [createTestEl()];
		v.taskTimeDescEl = createTestEl();
		v.focusTimeEl = createTestEl();
		v.slackTimeEl = createTestEl();
		v.totalTimeEl = createTestEl();
		v.weekWordEl = createTestEl();
		v.monthWordEl = createTestEl();
		v.yearWordEl = createTestEl();
		v.historyTotalWordEl = createTestEl();
		v.miniChartEl = createTestEl();
		v.efficiencySummaryEl = createTestEl();
	}

	beforeEach(() => {
		ChapterSorter.setCustomRules([]);
		interface TestMoment {
			format(fmt?: string): string;
			diff(): number;
			startOf(): TestMoment;
			isSame(): boolean;
			isAfter(): boolean;
			isBefore(): boolean;
			subtract(): TestMoment;
			add(): TestMoment;
			clone(): TestMoment;
		}
		const mockMoment = (): TestMoment => {
			return {
				format: (fmt?: string) => '2026-10-17',
				diff: () => 1,
				startOf: () => mockMoment(),
				isSame: () => false,
				isAfter: () => false,
				isBefore: () => false,
				subtract: () => mockMoment(),
				add: () => mockMoment(),
				clone: () => mockMoment()
			};
		};
		Object.assign(window, { moment: mockMoment });
		mockTaskManager = {
			reconcileTasks: vi.fn().mockResolvedValue(true),
			getTaskFile: vi.fn(),
			loadEntries: vi.fn().mockResolvedValue([]),
			parseEntries: vi.fn().mockReturnValue([]),
			getActiveTask: vi.fn().mockReturnValue(null),
			calcProgress: vi.fn().mockReturnValue(0),
			updateProgress: vi.fn().mockResolvedValue(undefined),
			updateEntryStatus: vi.fn().mockResolvedValue(undefined)
		};

		mockPlugin = {
			taskManager: mockTaskManager as unknown as TaskManager,
			settings: {
				workspaceFolders: ['作品A', '作品B', '作品C'],
				loreFolderName: '设定',
				timeline: { fileName: '时间线' },
				foreshadowing: { fileName: '伏笔' },
				novelInfo: { fileName: '作品信息' }
			},
			isTracking: false,
			focusMs: 0,
			slackMs: 0,
			startTracking: vi.fn(),
			stopTracking: vi.fn(),
			refreshStatusViews: vi.fn(),
			cacheManager: {
				getFolderWordCount: vi.fn((folder: string) => folder === '作品B' ? 50000 : 10000),
				isEligibleForWordCount: vi.fn((file: import('obsidian').TFile) => {
					return file.path.endsWith('第1章.md') || file.path.endsWith('第2章.md');
				})
			},
			characterManager: {
				getBookPathForFile: vi.fn((file: import('obsidian').TFile | null) => {
					if (!file) return null;
					if (file.path.startsWith('作品B/')) return '作品B';
					if (file.path.startsWith('作品A/')) return '作品A';
					if (file.path.startsWith('作品C/')) return '作品C';
					return null;
				}),
				isLorePath: vi.fn(() => false)
			},
			getVaultMarkdownFiles: vi.fn(() => []),
			getTrackedMarkdownFiles: vi.fn(() => []),
			isFileInStrictChapterException: vi.fn(() => false),
			isPluginGeneratedFile: vi.fn(() => false),
			statisticsManager: {
				getCoreStats: vi.fn(() => ({
					dailyWords: 1500,
					dailyGoal: 2000,
					rawDailyWords: 1500,
					dailyPercent: 75,
					todayWords: 2000,
					goal: 2000,
					percent: 100
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
				getHistory: vi.fn(() => ({})),
				getWordRevision: vi.fn(() => 0),
				wordRevision: 0
			},
			homepageManager: {
				findNovelInfoFile: vi.fn(),
				getHomepageFilePath: vi.fn(() => '创作主页.md'),
				getNovelFolders: vi.fn(() => [
					{ folderPath: '作品A', folderName: '作品A' },
					{ folderPath: '作品B', folderName: '作品B' },
					{ folderPath: '作品C', folderName: '作品C' }
				]),
				getNovelMetadata: vi.fn(),
				refreshHomepageViews: vi.fn()
			}
		} as unknown as WritingStatusViewPlugin;

		mockLeaf = new WorkspaceLeaf();
		view = new WritingStatusView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, mockPlugin);
		attachMockElements(view);
	});

	type TestAppEnvironment = {
		app: import('obsidian').App;
		vaultFiles: Map<string, TFile | TFolder>;
		setActiveMarkdown(file: TFile | null): void;
		setActiveWorkbench(bookPath: string): void;
		setActiveSidebar(viewType?: string): void;
		setMostRecentRoot(viewType: string | null, currentBookPath?: string, file?: TFile | null): void;
		closeAllDocuments(): void;
		setDelayedCachedRead(predicate: (file: TFile) => boolean): {
			promise: Promise<string>;
			resolve: (content: string) => void;
		};
	};

	function createTestEnvironment(initialFiles: Array<TFile | TFolder> = []): TestAppEnvironment {
		const vaultFiles = new Map<string, TFile | TFolder>();
		for (const f of initialFiles) {
			vaultFiles.set(f.path, f);
			if (f.parent instanceof TFolder && !f.parent.children.includes(f)) {
				f.parent.children.push(f);
			}
		}

		let activeFile: TFile | null = null;
		let activeItemView: { getViewType(): string; file?: TFile | null; currentBookPath?: string } | null = null;
		let mostRecentRootLeaf: { view: { getViewType(): string; file?: TFile | null; currentBookPath?: string } } | null = null;
		let delayedReadPredicate: ((file: TFile) => boolean) | null = null;
		let delayedReadResolve: ((content: string) => void) | null = null;
		let delayedReadPromise: Promise<string> | null = null;

		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					const f = vaultFiles.get(path);
					if (f) return f;
					if (path.endsWith('/作品信息.md')) {
						const parent = path.slice(0, path.lastIndexOf('/'));
						const parentFile = vaultFiles.get(parent);
						if (!parent.includes('/') && parentFile instanceof TFolder) {
							return Object.assign(new TFile(), { name: '作品信息.md', path });
						}
					}
					return null;
				}),
				read: vi.fn().mockResolvedValue(''),
				cachedRead: vi.fn((file: TFile) => {
					if (delayedReadPredicate && delayedReadPredicate(file) && delayedReadPromise) {
						return delayedReadPromise;
					}
					return Promise.resolve('');
				})
			},
			metadataCache: {
				getFileCache: vi.fn((_file: TFile) => ({
					frontmatter: { status: 'writing' }
				}))
			},
			workspace: {
				requestSaveLayout: Object.assign(vi.fn(), { run: vi.fn().mockResolvedValue(undefined) }),
				getActiveViewOfType: vi.fn((type: unknown) => {
					if (!activeItemView) return null;
					if (type === MarkdownView) {
						return activeItemView.getViewType() === 'markdown' ? activeItemView : null;
					}
					return activeItemView;
				}),
				getActiveFile: vi.fn(() => activeFile),
				getMostRecentLeaf: vi.fn(() => mostRecentRootLeaf),
				getLeavesOfType: vi.fn((type: string) => {
					if (type === 'webnovel-workbench' && mostRecentRootLeaf?.view.getViewType() === 'webnovel-workbench') {
						return [mostRecentRootLeaf];
					}
					return [];
				})
			}
		} as unknown as import('obsidian').App;

		return {
			app,
			vaultFiles,
			setActiveMarkdown(file: TFile | null) {
				activeFile = file;
				activeItemView = file ? { getViewType: () => 'markdown', file } : null;
				if (file) {
					mostRecentRootLeaf = { view: { getViewType: () => 'markdown', file } };
				}
			},
			setActiveWorkbench(bookPath: string) {
				activeFile = null;
				activeItemView = { getViewType: () => 'webnovel-workbench', currentBookPath: bookPath };
				mostRecentRootLeaf = { view: { getViewType: () => 'webnovel-workbench', currentBookPath: bookPath } };
			},
			setActiveSidebar(viewType = 'writing-status-view') {
				activeFile = null;
				activeItemView = { getViewType: () => viewType };
			},
			setMostRecentRoot(viewType: string | null, currentBookPath = '', file: TFile | null = null) {
				if (viewType === null) {
					mostRecentRootLeaf = null;
				} else {
					mostRecentRootLeaf = { view: { getViewType: () => viewType, currentBookPath, file } };
				}
			},
			closeAllDocuments() {
				activeFile = null;
				activeItemView = null;
				mostRecentRootLeaf = null;
			},
			setDelayedCachedRead(predicate: (file: TFile) => boolean) {
				delayedReadPredicate = predicate;
				delayedReadPromise = new Promise<string>((res) => {
					delayedReadResolve = res;
				});
				return {
					promise: delayedReadPromise,
					resolve: (content: string) => {
						if (delayedReadResolve) delayedReadResolve(content);
					}
				};
			}
		};
	}

	it('当关闭全部文档且侧边栏聚焦时，即使后台有最近工作台 A，依然保留作品 B 但隐藏章节卡片与目标', async () => {
		const getTaskFile = vi.fn(() => null);
		mockPlugin.taskManager = { getTaskFile } as unknown as TaskManager;
		const novelFolderA = Object.assign(new TFolder(), { name: '作品A', path: '作品A' });
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});

		const env = createTestEnvironment([novelFolderA, novelFolderB, chapterB1]);
		Object.assign(view, { app: env.app });

		// 1. 激活作品 B Markdown
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 关闭全部文档：侧边栏聚焦，但主工作区存在最近工作台 A
		env.setActiveSidebar('writing-status-view');
		env.setMostRecentRoot('webnovel-workbench', '作品A');
		await view.updateData(true);

		// 核心断言：关闭后依然保留作品 B，没有被后台工作台 A 覆盖；但章节卡片与章节目标必须隐藏
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);
		expect(getTaskFile).toHaveBeenLastCalledWith('作品B');
	});

	it('点击侧边栏保留主区当前章节，打开主页或无关独立笔记时保留作品但隐藏章节卡片与目标', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const homepageFile = Object.assign(new TFile(), {
			name: '创作主页.md',
			basename: '创作主页',
			path: '创作主页.md',
			extension: 'md',
			stat: { mtime: 2000 }
		});
		const nonworkNote = Object.assign(new TFile(), {
			name: 'todo.md',
			basename: 'todo',
			path: 'Notes/todo.md',
			extension: 'md',
			stat: { mtime: 3000 }
		});

		const env = createTestEnvironment([novelFolderB, chapterB1, homepageFile, nonworkNote]);
		Object.assign(view, { app: env.app });

		// 初始选择作品 B
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 1. 焦点移动到侧边栏（主工作区仍显示有效章节，应保持章节可见）
		env.setActiveSidebar('writing-status-view');
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(false);
		expect(view.chapterSectionEls.every((el: HTMLElement) => !el.hidden)).toBe(true);
		expect((view as unknown as { currentChapterFile: TFile | null }).currentChapterFile).toBe(chapterB1);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(chapterB1);

		// 2. 打开主页：保留作品 B 上下文，但隐藏章节卡片与目标
		env.setActiveMarkdown(homepageFile);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect((view as unknown as { currentChapterFile: TFile | null }).currentChapterFile).toBeNull();
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);

		// 3. 打开独立非作品笔记：保留作品 B 上下文，但隐藏章节卡片与目标
		env.setActiveMarkdown(nonworkNote);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect((view as unknown as { currentChapterFile: TFile | null }).currentChapterFile).toBeNull();
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);
	});

	it('在 100ms 防抖窗口内快速激活文档后关闭，能同步捕获选中作品并隐藏章节', async () => {
		vi.useFakeTimers();
		try {
			const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
			const chapterB1 = Object.assign(new TFile(), {
				name: '第1章.md',
				basename: '第1章',
				path: '作品B/第1章.md',
				extension: 'md',
				stat: { mtime: 1000 },
				parent: novelFolderB
			});

			const env = createTestEnvironment([novelFolderB, chapterB1]);
			Object.assign(view, { app: env.app });
			env.setActiveMarkdown(chapterB1);

			// 触发防抖更新 (immediate = false)
			void view.updateData(false);

			// 模拟在 100ms 计时器到达前迅速关闭文档并聚焦侧边栏
			env.closeAllDocuments();
			env.setActiveSidebar('writing-status-view');

			// 前进 100ms 执行防抖回调
			await vi.advanceTimersByTimeAsync(110);

			// 同步捕获应当确保即使关掉了文档，作品 B 依然被捕获并保留，但章节卡片与目标隐藏
			expect(view.workNameEl.innerText).toBe('作品B');
			expect(view.chapterStatusCardEl.hidden).toBe(true);
			expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
			expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);
		} finally {
			vi.useRealTimers();
		}
	});

	it('同一作品下切换到功能笔记、设定笔记或非作品笔记，即使后台有旧章节依然隐藏章节', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const foreshadowingB = Object.assign(new TFile(), {
			name: '伏笔.md',
			basename: '伏笔',
			path: '作品B/伏笔.md',
			extension: 'md',
			stat: { mtime: 1500 },
			parent: novelFolderB
		});
		const loreFolder = Object.assign(new TFolder(), { name: '设定', path: '作品B/设定', parent: novelFolderB });
		const loreFile = Object.assign(new TFile(), {
			name: '角色.md',
			basename: '角色',
			path: '作品B/设定/角色.md',
			extension: 'md',
			stat: { mtime: 1200 },
			parent: loreFolder
		});
		novelFolderB.children = [chapterB1, foreshadowingB, loreFolder];
		loreFolder.children = [loreFile];

		const env = createTestEnvironment([novelFolderB, chapterB1, foreshadowingB, loreFolder, loreFile]);
		Object.assign(view, { app: env.app });

		// 1. 初始打开第1章
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 切换到同作品的伏笔功能文件（即使第1章仍在后台 tab）
		env.setActiveMarkdown(foreshadowingB);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);

		// 3. 切换到同作品的设定笔记
		env.setActiveMarkdown(loreFile);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);
	});

	it('切换到同作品工作台或其它非 Markdown 根视图时隐藏章节卡片与目标', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});

		const env = createTestEnvironment([novelFolderB, chapterB1]);
		Object.assign(view, { app: env.app });

		// 1. 打开第1章
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 切换到同作品的工作台视图
		env.setActiveWorkbench('作品B');
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);

		// 3. 切换到其它非 Markdown 根视图（如 canvas）
		env.setMostRecentRoot('canvas');
		env.setActiveSidebar('canvas');
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);
	});

	it('在作品信息或伏笔异步读取挂起期间离开章节，能同步隐藏章节区域', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const nonworkNote = Object.assign(new TFile(), {
			name: 'todo.md',
			basename: 'todo',
			path: 'Notes/todo.md',
			extension: 'md',
			stat: { mtime: 3000 }
		});
		const infoFileB = Object.assign(new TFile(), {
			name: '作品信息.md',
			basename: '作品信息',
			path: '作品B/作品信息.md',
			extension: 'md',
			stat: { mtime: 1000 }
		});

		mockPlugin.homepageManager = {
			...mockPlugin.homepageManager,
			findNovelInfoFile: vi.fn((folder: string) => folder === '作品B' ? infoFileB : null)
		} as unknown as typeof mockPlugin.homepageManager;

		const env = createTestEnvironment([novelFolderB, chapterB1, nonworkNote, infoFileB]);
		Object.assign(view, { app: env.app });

		// 1. 先激活第1章并正常渲染
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 挂起作品信息文件的异步读取
		const delayed = env.setDelayedCachedRead((file) => file.path === '作品B/作品信息.md');

		// 3. 切换到非作品笔记，触发更新
		env.setActiveMarkdown(nonworkNote);
		const updatePromise = view.updateData(true);

		// 核心断言：在异步读取尚未完成前，captureActiveContext 已同步将章节区域隐藏！
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);

		// 4. 异步读取完成
		delayed.resolve('Word Goal: 50000');
		await updatePromise;

		// 依然保持隐藏，作品总字数与目标正常显示
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(view.workNameEl.innerText).toBe('作品B');
	});

	it.each(['作品B', '作品C'])('切换到 %s 的新章节且作品信息读取挂起时，不残留上一章节区域', async (nextWork) => {
		const bookB = new TFolder('作品B', '作品B');
		const bookC = new TFolder('作品C', '作品C');
		const firstChapter = Object.assign(new TFile('第1章.md', '作品B/第1章.md'), { parent: bookB });
		const nextChapter = Object.assign(new TFile('第2章.md', `${nextWork}/第2章.md`), { parent: nextWork === '作品B' ? bookB : bookC });
		const infoFile = new TFile('作品信息.md', `${nextWork}/作品信息.md`);
		mockPlugin.homepageManager = {
			...mockPlugin.homepageManager,
			findNovelInfoFile: vi.fn(folder => folder === nextWork ? infoFile : null)
		} as typeof mockPlugin.homepageManager;
		const env = createTestEnvironment([bookB, bookC, firstChapter, nextChapter, infoFile]);
		Object.assign(view, { app: env.app });
		env.setActiveMarkdown(firstChapter);
		await view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(false);
		expect(view.chapterSectionEls.every(el => !el.hidden)).toBe(true);

		const delayed = env.setDelayedCachedRead(file => file.path === infoFile.path);
		env.setActiveMarkdown(nextChapter);
		const pending = view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every(el => el.hidden)).toBe(true);
		delayed.resolve('Word Goal: 50000');
		await pending;
		expect(view.workNameEl.innerText).toBe(nextWork);
		expect(view.chapterTitleEl.innerText).toBe('第2章');
		expect(view.chapterStatusCardEl.hidden).toBe(false);
	});

	it('离开章节后再重新进入相同章节，能够正常重新渲染而非被旧缓存阻挡', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const nonworkNote = Object.assign(new TFile(), {
			name: 'todo.md',
			basename: 'todo',
			path: 'Notes/todo.md',
			extension: 'md',
			stat: { mtime: 3000 }
		});

		const env = createTestEnvironment([novelFolderB, chapterB1, nonworkNote]);
		Object.assign(view, { app: env.app });

		// 1. 首次进入第1章
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.chapterTitleEl.innerText).toBe('第1章');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 离开第1章到非作品笔记（章节卡片隐藏，清理陈旧渲染身份）
		env.setActiveMarkdown(nonworkNote);
		await view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(true);

		// 3. 重新切回第1章（具有完全相同的 mtime 与元数据）
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);

		// 核心断言：必须重新正常渲染，章节卡片重新可见且标题正确
		expect(view.chapterStatusCardEl.hidden).toBe(false);
		expect(view.chapterTitleEl.innerText).toBe('第1章');
		expect(view.chapterSectionEls.every((el: HTMLElement) => !el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(chapterB1);
	});

	it('同一作品内离开章节后，挂起的旧章节异步伏笔读取完成时不复活章节卡片与徽章', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const nonworkNote = Object.assign(new TFile(), {
			name: 'todo.md',
			basename: 'todo',
			path: 'Notes/todo.md',
			extension: 'md',
			stat: { mtime: 3000 }
		});
		const foreshadowingB = Object.assign(new TFile(), {
			name: '伏笔.md',
			basename: '伏笔',
			path: '作品B/伏笔.md',
			extension: 'md',
			stat: { mtime: 1500 }
		});

		mockPlugin.foreshadowingManager = {
			findForeshadowingFile: vi.fn((folder: string) => folder === '作品B' ? foreshadowingB : null),
			parseEntries: vi.fn((): ParsedForeshadowingEntry[] => [
				{ description: '伏笔条目1', status: ForeshadowingStatus.Pending, sourceFile: '第1章', contents: [], createdAt: '', tags: [] }
			])
		};

		const env = createTestEnvironment([novelFolderB, chapterB1, nonworkNote, foreshadowingB]);
		Object.assign(view, { app: env.app });

		env.setActiveMarkdown(chapterB1);
		const delayed = env.setDelayedCachedRead((file) => file.path === '作品B/伏笔.md');

		// 1. 启动第1章更新（伏笔读取挂起）
		const p1 = view.updateData(true);

		// 2. 挂起期间用户切换到非作品笔记
		env.setActiveMarkdown(nonworkNote);
		await view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(true);

		// 3. 旧章节的异步伏笔读取完成
		delayed.resolve('伏笔内容');
		await p1;

		// 核心断言：旧异步读取不得复活章节卡片或残留徽章
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
		expect(mockPlugin.statisticsManager.getCoreStats).toHaveBeenLastCalledWith(null);
	});

	it('明确激活作品 C 工作台时切换到作品 C，并隐藏章节卡片与章节目标（无章节历史）', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const novelFolderC = Object.assign(new TFolder(), { name: '作品C', path: '作品C' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});

		const env = createTestEnvironment([novelFolderB, novelFolderC, chapterB1]);
		Object.assign(view, { app: env.app });

		// 1. 初始选择作品 B
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 明确激活作品 C 工作台（关闭当前 markdown，激活工作台 leaf）
		env.setActiveWorkbench('作品C');
		await view.updateData(true);

		// 应该切换到作品 C
		expect(view.workNameEl.innerText).toBe('作品C');
		// 跨作品隔离：作品 C 尚无打开的章节，严禁混入作品 B 的章节卡片和章节目标！
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
	});

	it('切到不同作品再切回无选中章节的工作台时，隐藏章节卡片和目标（不保留跨作品章节历史）', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const novelFolderC = Object.assign(new TFolder(), { name: '作品C', path: '作品C' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const chapterC1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品C/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderC
		});

		const env = createTestEnvironment([novelFolderB, novelFolderC, chapterB1, chapterC1]);
		Object.assign(view, { app: env.app });

		// 1. 在作品 B 打开章节 B1
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 切换到作品 C 打开章节 C1
		env.setActiveMarkdown(chapterC1);
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品C');
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 3. 通过工作台切回作品 B（无任何章节被激活）
		env.setActiveWorkbench('作品B');
		await view.updateData(true);

		// 核心断言：切回作品 B 时由于没有打开章节，严禁依赖跨作品章节记忆恢复 B1，必须隐藏卡片与章节目标！
		expect(view.workNameEl.innerText).toBe('作品B');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
		expect(view.chapterSectionEls.every((el: HTMLElement) => el.hidden)).toBe(true);
	});

	it('保留的章节文件若在 Vault 中已被删除，应清空保留并隐藏章节卡片', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});

		const env = createTestEnvironment([novelFolderB, chapterB1]);
		Object.assign(view, { app: env.app });

		// 1. 初始选择章节 B1
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.chapterStatusCardEl.hidden).toBe(false);

		// 2. 文档关闭，侧边栏获得焦点
		env.setActiveSidebar();

		// 3. 此时 Vault 中该章节文件被外部删除
		env.vaultFiles.delete('作品B/第1章.md');

		await view.updateData(true);
		// 章节已被删除，不应继续显示过期的章节卡片
		expect(view.chapterStatusCardEl.hidden).toBe(true);
	});

	it('两个元数据完全相同的不同章节切换时，正确更新章节标题而非命中缓存早退', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const chapterB2 = Object.assign(new TFile(), {
			name: '第2章.md',
			basename: '第2章',
			path: '作品B/第2章.md',
			extension: 'md',
			stat: { mtime: 1000 }, // 相同 mtime
			parent: novelFolderB
		});

		const env = createTestEnvironment([novelFolderB, chapterB1, chapterB2]);
		Object.assign(view, { app: env.app });

		// 1. 打开第1章
		env.setActiveMarkdown(chapterB1);
		await view.updateData(true);
		expect(view.chapterTitleEl.innerText).toBe('第1章');

		// 2. 打开第2章（具有完全相同的 mtime、status 和 synopsis）
		env.setActiveMarkdown(chapterB2);
		await view.updateData(true);

		// 核心断言：由于文件身份发生变化，必须渲染第2章，不可被旧缓存阻挡
		expect(view.chapterTitleEl.innerText).toBe('第2章');
	});

	it('同一章节异步读取伏笔挂起期间重复触发刷新，不因缓存早退而永久丢失伏笔徽章', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const foreshadowingB = Object.assign(new TFile(), {
			name: '伏笔.md',
			basename: '伏笔',
			path: '作品B/伏笔.md',
			extension: 'md',
			stat: { mtime: 1500 }
		});

		mockPlugin.foreshadowingManager = {
			findForeshadowingFile: vi.fn((folder: string) => folder === '作品B' ? foreshadowingB : null),
			parseEntries: vi.fn((): ParsedForeshadowingEntry[] => [
				{ description: '伏笔条目1', status: ForeshadowingStatus.Pending, sourceFile: '第1章', contents: [], createdAt: '', tags: [] }
			])
		};

		const env = createTestEnvironment([novelFolderB, chapterB1, foreshadowingB]);
		Object.assign(view, { app: env.app });
		env.setActiveMarkdown(chapterB1);

		const delayed = env.setDelayedCachedRead((file) => file.path === '作品B/伏笔.md');

		// 1. 启动第一次更新（伏笔读取挂起）
		const p1 = view.updateData(true);

		// 2. 挂起期间高频按键触发了第二次刷新
		const p2 = view.updateData(true);

		// 3. 此时异步伏笔读取完成
		delayed.resolve('伏笔内容');
		await Promise.all([p1, p2]);

		// 核心断言：不能因为 p1 提前写入缓存导致 p2 早退而丢弃伏笔徽章！
		expect(view.chapterBadgesContainer.children.length).toBeGreaterThan(0);
	});

	it('切换作品时丢弃上一代（旧作品）的异步伏笔与文件读取，防止脏覆盖', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const novelFolderC = Object.assign(new TFolder(), { name: '作品C', path: '作品C' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const foreshadowingB = Object.assign(new TFile(), {
			name: '伏笔.md',
			basename: '伏笔',
			path: '作品B/伏笔.md',
			extension: 'md',
			stat: { mtime: 1500 }
		});

		mockPlugin.foreshadowingManager = {
			findForeshadowingFile: vi.fn((folder: string) => folder === '作品B' ? foreshadowingB : null),
			parseEntries: vi.fn((): ParsedForeshadowingEntry[] => [
				{ description: '旧作品B伏笔', status: ForeshadowingStatus.Pending, sourceFile: '第1章', contents: [], createdAt: '', tags: [] }
			])
		};

		const env = createTestEnvironment([novelFolderB, novelFolderC, chapterB1, foreshadowingB]);
		Object.assign(view, { app: env.app });

		env.setActiveMarkdown(chapterB1);
		const delayed = env.setDelayedCachedRead((file) => file.path === '作品B/伏笔.md');

		// 1. 启动作品 B 的更新（此时伏笔 cachedRead 被 hang 挂起）
		const updatePromise1 = view.updateData(true);

		// 2. 在 update1 异步挂起期间，用户明确切换到作品 C 工作台并触发更新
		env.setActiveWorkbench('作品C');
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品C');

		// 3. 此时旧作品 B 的伏笔读取终于完成
		delayed.resolve('f1');
		await updatePromise1;

		// 应该维持作品 C，且绝不能渲染出旧作品 B 的伏笔内容与章节卡片
		expect(view.workNameEl.innerText).toBe('作品C');
		expect(view.chapterStatusCardEl.hidden).toBe(true);
	});

	it('视图关闭（onClose）应递增 generation 终止正在进行的伏笔异步读取，防止晚期写入', async () => {
		const novelFolderB = Object.assign(new TFolder(), { name: '作品B', path: '作品B' });
		const chapterB1 = Object.assign(new TFile(), {
			name: '第1章.md',
			basename: '第1章',
			path: '作品B/第1章.md',
			extension: 'md',
			stat: { mtime: 1000 },
			parent: novelFolderB
		});
		const foreshadowingB = Object.assign(new TFile(), {
			name: '伏笔.md',
			basename: '伏笔',
			path: '作品B/伏笔.md',
			extension: 'md',
			stat: { mtime: 1500 }
		});

		mockPlugin.foreshadowingManager = {
			findForeshadowingFile: vi.fn((folder: string) => folder === '作品B' ? foreshadowingB : null),
			parseEntries: vi.fn((): ParsedForeshadowingEntry[] => [
				{ description: '伏笔1', status: ForeshadowingStatus.Pending, sourceFile: '第1章', contents: [], createdAt: '', tags: [] }
			])
		};

		const env = createTestEnvironment([novelFolderB, chapterB1, foreshadowingB]);
		Object.assign(view, { app: env.app });
		env.setActiveMarkdown(chapterB1);

		const delayed = env.setDelayedCachedRead((file) => file.path === '作品B/伏笔.md');
		const updatePromise = view.updateData(true);

		// 挂起期间关闭视图
		await view.onClose();

		// 异步读取完成
		delayed.resolve('伏笔内容');
		await updatePromise;

		// 验证：关闭后不得有晚期写入
		expect(view.chapterBadgesContainer.children.length).toBe(0);
	});

	it('新会话且没有任何历史选择时，允许使用兜底默认作品', async () => {
		const novelFolderA = Object.assign(new TFolder(), { name: '作品A', path: '作品A' });

		const env = createTestEnvironment([novelFolderA]);
		Object.assign(view, { app: env.app });

		// 新视图首次更新，无此前选择记忆，允许使用默认首个作品
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品A');
		env.setMostRecentRoot('webnovel-workbench', '作品C');
		await view.updateData(true);
		expect(view.workNameEl.innerText).toBe('作品A');
	});

	it('saves the last closed document work in layout state and restores it before the default work', async () => {
		const bookB = new TFolder('作品B', '作品B');
		const chapterB = Object.assign(new TFile('第1章.md', '作品B/第1章.md'), { parent: bookB });
		const env = createTestEnvironment([new TFolder('作品A', '作品A'), bookB, chapterB]);
		Object.assign(view, { app: env.app });
		env.setActiveMarkdown(chapterB);
		await view.updateData(true);
		expect(env.app.workspace.requestSaveLayout).toHaveBeenCalledTimes(1);
		env.setActiveSidebar();
		await view.updateData(true);
		const serialized = JSON.parse(JSON.stringify(view.getState())) as Record<string, unknown>;
		expect(serialized.currentBookPath).toBe('作品B');
		await view.onClose();
		expect(env.app.workspace.requestSaveLayout.run).toHaveBeenCalledOnce();

		const restored = new WritingStatusView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, mockPlugin);
		Object.assign(restored, { app: env.app });
		attachMockElements(restored);
		// onOpen 可能先绘制默认作品，随后 Obsidian 才恢复布局状态。
		await restored.updateData(true);
		expect(restored.workNameEl.innerText).toBe('作品A');
		env.setMostRecentRoot('webnovel-workbench', '作品A');
		await restored.setState(serialized, { history: false });
		expect(restored.workNameEl.innerText).toBe('作品B');
		expect(restored.chapterStatusCardEl.hidden).toBe(true);
		await restored.updateData(true);
		expect(restored.workNameEl.innerText).toBe('作品B');
	});

	it('accepts restored state before the view DOM is opened', async () => {
		const env = createTestEnvironment([new TFolder('作品B', '作品B')]);
		const restored = new WritingStatusView(mockLeaf as unknown as import('obsidian').WorkspaceLeaf, mockPlugin);
		Object.assign(restored, { app: env.app });
		await restored.setState({ currentBookPath: '作品B' }, { history: false });
		attachMockElements(restored);
		await restored.updateData(true);
		expect(restored.workNameEl.innerText).toBe('作品B');
	});

	it('lets an active document or workbench override restored work and saves only changed selections', async () => {
		const bookB = new TFolder('作品B', '作品B');
		const chapterB = Object.assign(new TFile('第1章.md', '作品B/第1章.md'), { parent: bookB });
		const env = createTestEnvironment([bookB, chapterB, new TFolder('作品C', '作品C')]);
		Object.assign(view, { app: env.app });
		env.setActiveMarkdown(chapterB);
		await view.setState({ currentBookPath: '作品C' }, { history: false });
		expect(view.workNameEl.innerText).toBe('作品B');
		await view.updateData(true);
		expect(env.app.workspace.requestSaveLayout).toHaveBeenCalledTimes(1);
		env.setActiveWorkbench('作品C');
		await view.updateData(true);
		expect(view.getState().currentBookPath).toBe('作品C');
		expect(env.app.workspace.requestSaveLayout).toHaveBeenCalledTimes(2);
		expect(view.chapterStatusCardEl.hidden).toBe(true);
	});

	it.each([undefined, null, {}, { currentBookPath: 42 }, { currentBookPath: '/' }, { currentBookPath: 'Missing' }, { currentBookPath: 'Notes' }, { currentBookPath: 'Notes/todo.md' }])(
		'ignores invalid saved state %j and keeps the initial fallback usable', async state => {
			const env = createTestEnvironment([new TFolder('作品A', '作品A'), new TFolder('Notes', 'Notes'), new TFile('todo.md', 'Notes/todo.md')]);
			Object.assign(view, { app: env.app });
			await view.setState(state, { history: false });
			await view.updateData(true);
			expect(view.workNameEl.innerText).toBe('作品A');
		});

	describe('batch 3b statistics refresh optimizations', () => {
		it('refreshes task and metadata changes in the selected work without polling other works', () => {
			const env = createTestEnvironment([new TFolder('作品A', '作品A')]);
			const vaultHandlers = new Map<string, (file: TFile, oldPath?: string) => void>();
			const metadataHandlers = new Map<string, (file: TFile) => void>();
			Object.assign(env.app.vault, { on: vi.fn((event: string, callback: (file: TFile, oldPath?: string) => void) => {
				vaultHandlers.set(event, callback);
				return {};
			}) });
			Object.assign(env.app.metadataCache, { on: vi.fn((event: string, callback: (file: TFile) => void) => {
				metadataHandlers.set(event, callback);
				return {};
			}) });
			Object.assign(view, { app: env.app, lastActiveFolderPath: '作品A', registerEvent: vi.fn() });
			(view as unknown as { registerDataEvents(): void }).registerDataEvents();
			const refresh = vi.spyOn(view, 'updateData').mockResolvedValue(undefined);
			vaultHandlers.get('modify')!(new TFile('限时任务.md', '作品A/限时任务.md'));
			metadataHandlers.get('changed')!(new TFile('第1章.md', '作品A/第1章.md'));
			expect(refresh).toHaveBeenCalledTimes(2);
			vaultHandlers.get('modify')!(new TFile('限时任务.md', '作品B/限时任务.md'));
			expect(refresh).toHaveBeenCalledTimes(2);
			vaultHandlers.get('rename')!(new TFile('第1章.md', '作品B/第1章.md'), '作品A/第1章.md');
			expect(refresh).toHaveBeenCalledTimes(3);
		});

		it('stable ticks update displayed timers without task IO or history traversal', () => {
			const env = createTestEnvironment([new TFolder('作品A', '作品A')]);
			Object.assign(view, { app: env.app });
			attachMockElements(view);

			mockPlugin.focusMs = 3600000; // 1 hour = 01:00:00
			mockPlugin.slackMs = 120000;  // 2 minutes = 00:02:00

			// Call updateTimer
			view.updateTimer();

			expect(view.focusTimeEl.innerText).toBe('01:00:00');
			expect(view.slackTimeEl.innerText).toBe('00:02:00');
			expect(view.totalTimeEl.innerText).toBe('01:02:00');

			// Must not perform task IO or history traversal
			expect(mockTaskManager.loadEntries).not.toHaveBeenCalled();
			expect(mockTaskManager.getTaskFile).not.toHaveBeenCalled();
			expect(mockPlugin.historyManager.getHistory).not.toHaveBeenCalled();
		});

		it('clock ticks do not increment generations or invalidate in-flight full updates', async () => {
			const env = createTestEnvironment([new TFolder('作品A', '作品A')]);
			Object.assign(view, { app: env.app });
			attachMockElements(view);

			// Start debounced updateData
			void view.updateData(false);
			const currentGeneration = (view as unknown as { updateGeneration: number }).updateGeneration;
			const initialTimer = (view as unknown as { updateDebounceTimer: number | null }).updateDebounceTimer;
			expect(initialTimer).not.toBeNull();

			// Timer tick occurs while updateData is pending
			mockPlugin.focusMs = 60000;
			mockPlugin.slackMs = 0;
			view.updateTimer();

			// Generation must not advance and debounce timer must not be cleared or canceled
			expect((view as unknown as { updateGeneration: number }).updateGeneration).toBe(currentGeneration);
			expect((view as unknown as { updateDebounceTimer: number | null }).updateDebounceTimer).toBe(initialTimer);
			expect(view.focusTimeEl.innerText).toBe('00:01:00');

			// Clean up timer
			await view.onClose();
		});

		it('triggers full refresh when updateTimer detects a midnight date rollover', async () => {
			let currentDate = '2026-10-17';
			Object.assign(window, { moment: (input?: string) => moment(input ?? currentDate) });

			const env = createTestEnvironment([new TFolder('作品A', '作品A')]);
			Object.assign(view, { app: env.app });
			attachMockElements(view);

			// Initial render on 2026-10-17
			await view.updateData(true);
			const initialGen = (view as unknown as { updateGeneration: number }).updateGeneration;

			// Advance date to next day
			currentDate = '2026-10-18';
			const updateDataSpy = vi.spyOn(view, 'updateData').mockResolvedValue(undefined);

			view.updateTimer();
			view.updateTimer();

			expect(updateDataSpy).toHaveBeenCalledWith(false);
			expect(updateDataSpy).toHaveBeenCalledTimes(1);
		});

		it('shows seven calendar days with zero-filled gaps and a matching seven-day summary', () => {
			Object.assign(window, { moment: (input?: string) => moment(input ?? '2026-10-18') });
			const stat = (addedWords: number): DailyStat => ({ addedWords, focusMs: 0, slackMs: 0 });
			const history = Object.freeze({
				'2026-09-15': stat(2900),
				'2026-09-26': stat(28),
				'2026-10-11': stat(10000),
				'2026-10-12': stat(-7),
				'2026-10-16': stat(21),
				'2026-10-19': stat(99999)
			});
			mockPlugin.historyManager.getHistory = vi.fn(() => history);
			mockPlugin.statisticsManager.calcDailyAverage = vi.fn(StatisticsManager.prototype.calcDailyAverage);

			view.renderMiniChart();

			const columns = Array.from(view.miniChartEl.children);
			expect(columns).toHaveLength(7);
			expect(columns.map(col => col.children[1].textContent)).toEqual(['10-12', '10-13', '10-14', '10-15', '10-16', '10-17', '10-18']);
			expect(columns.map(col => col.children[2].textContent)).toEqual(['-7', '0', '0', '0', '21', '0', '0']);
			expect(columns[0].children[0].className).toContain('bar-negative');
			const average = vi.mocked(mockPlugin.statisticsManager.calcDailyAverage);
			const [summaryHistory, start, end] = average.mock.calls[0];
			expect(Object.keys(summaryHistory)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
			expect([start, end]).toEqual(['2026-10-12', '2026-10-18']);
			expect(average.mock.results[0].value).toBe(2);
			expect(mockPlugin.statisticsManager.calcFocusRate).toHaveBeenCalledWith(summaryHistory, start, end);
			expect(mockPlugin.statisticsManager.calcWritingSpeed).toHaveBeenCalledWith(summaryHistory, start, end);
			expect(Object.keys(history)).toHaveLength(6);
		});

		it('renders seven zero columns without adding records when history is empty', () => {
			Object.assign(window, { moment: (input?: string) => moment(input ?? '2026-10-18') });
			const history = Object.freeze({});
			mockPlugin.historyManager.getHistory = vi.fn(() => history);
			view.renderMiniChart();
			const columns = Array.from(view.miniChartEl.children);
			expect(columns).toHaveLength(7);
			expect(columns.map(col => col.children[2].textContent)).toEqual(Array<string>(7).fill('0'));
			expect(history).toEqual({});
		});

		it.each([
			['2026-11-02', ['10-27', '10-28', '10-29', '10-30', '10-31', '11-01', '11-02']],
			['2027-01-03', ['12-28', '12-29', '12-30', '12-31', '01-01', '01-02', '01-03']],
			['2024-03-02', ['02-25', '02-26', '02-27', '02-28', '02-29', '03-01', '03-02']]
		])('keeps calendar ordering across boundaries ending on %s', (today, labels) => {
			Object.assign(window, { moment: (input?: string) => moment(input ?? today) });
			view.renderMiniChart();
			expect(Array.from(view.miniChartEl.children).map(col => col.children[1].textContent)).toEqual(labels);
		});

		it('advances the seven-day window after midnight without a history revision', () => {
			let today = '2026-10-18';
			Object.assign(window, { moment: (input?: string) => moment(input ?? today) });
			view.renderMiniChart();
			const columns = Array.from(view.miniChartEl.children);
			view.renderMiniChart();
			expect(Array.from(view.miniChartEl.children)).toEqual(columns);
			today = '2026-10-19';
			view.renderMiniChart();
			expect(Array.from(view.miniChartEl.children).map(col => col.children[1].textContent)).toEqual(['10-13', '10-14', '10-15', '10-16', '10-17', '10-18', '10-19']);
		});

		it('caches word totals and mini-chart preparation by wordRevision + date, avoiding full scans on focus-only updates', async () => {
			const historyRecords = {
				'2026-10-17': { addedWords: 1500, focusMs: 3600000, slackMs: 600000 }
			};
			let currentRevision = 1;
			mockPlugin.historyManager.getHistory = vi.fn(() => historyRecords as never);
			mockPlugin.historyManager.getWordRevision = vi.fn(() => currentRevision);

			const env = createTestEnvironment([new TFolder('作品A', '作品A')]);
			Object.assign(view, { app: env.app });
			attachMockElements(view);

			// 1. First full update scans history and populates totals
			await view.updateData(true);
			expect(mockPlugin.historyManager.getHistory).toHaveBeenCalled();
			expect(view.historyTotalWordEl.innerText).toBe('1,500');

			const initialGetHistoryCount = vi.mocked(mockPlugin.historyManager.getHistory).mock.calls.length;

			// 2. Focus-only write (revision does NOT change, date does NOT change)
			mockPlugin.focusMs += 1000;
			await view.updateData(true);

			// History must not be traversed again for word totals / mini-chart
			expect(vi.mocked(mockPlugin.historyManager.getHistory).mock.calls.length).toBe(initialGetHistoryCount);

			// 3. Word revision increments (e.g. user typed words or history restored)
			currentRevision = 2;
			historyRecords['2026-10-17'].addedWords = 2000;
			await view.updateData(true);

			expect(vi.mocked(mockPlugin.historyManager.getHistory).mock.calls.length).toBeGreaterThan(initialGetHistoryCount);
			expect(view.historyTotalWordEl.innerText).toBe('2,000');

			// 4. Force refresh explicitly invalidates cache
			const preForceCount = vi.mocked(mockPlugin.historyManager.getHistory).mock.calls.length;
			await view.updateData(true, true);
			expect(vi.mocked(mockPlugin.historyManager.getHistory).mock.calls.length).toBeGreaterThan(preForceCount);
		});
	});
});
