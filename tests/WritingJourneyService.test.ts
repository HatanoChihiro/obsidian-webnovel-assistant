import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	WRITING_JOURNEY_SCHEMA_VERSION,
	WRITING_JOURNEY_YAML_KEY,
	parseWritingJourneyLog,
	type ChapterStatusChangedEvent,
	type WritingJourneyEvent,
	type WritingJourneyLog
} from '../src/types/writingJourney';
import type { App, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { WritingJourneyService } from '../src/services/WritingJourneyService';
import { WritingJourneyBoardRenderer } from '../src/ui/components/WritingJourneyBoardRenderer';
import { MockElement } from './mocks/MockElement';

const { MockTFile, MockTFolder, MockMarkdownView, parseYamlMock } = vi.hoisted(() => {
	class MockAbstractFile {
		vault: unknown = {};
		constructor(public name: string = '', public path: string = '') {}
	}
	class MockFile extends MockAbstractFile {
		extension = 'md';
		basename: string;
		parent: unknown = null;
		constructor(public name: string = '', public path: string = '') {
			super(name, path);
			this.basename = name.replace(/\.md$/, '');
		}
	}
	class MockFolder extends MockAbstractFile {
		children: unknown[] = [];
		constructor(public name: string = '', public path: string = '') {
			super(name, path);
		}
	}
	class MockView {
		file: unknown = null;
		getViewData(): string { return 'editor content'; }
		async save(): Promise<void> {}
	}
	return {
		MockTFile: MockFile,
		MockTFolder: MockFolder,
		MockMarkdownView: MockView,
		parseYamlMock: vi.fn()
	};
});

vi.mock('obsidian', () => ({
	TFile: MockTFile,
	TFolder: MockTFolder,
	TAbstractFile: class {},
	parseYaml: parseYamlMock,
	setIcon: vi.fn(),
	MarkdownView: MockMarkdownView
}));

vi.mock('../src/i18n', () => ({
	t: (key: string, vars?: Record<string, string>) => {
		if (vars?.count) return `${vars.count} events`;
		if (key === 'writing-journey.type-chapter-created') return '创建章节';
		if (key === 'writing-journey.type-chapter-moved') return '移动章节';
		if (key === 'common.word-char') return '字';
		return key;
	}
}));

vi.mock('../src/i18n/data-keys', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/i18n/data-keys')>();
	return {
		...actual,
		getCorkboardStatusText: (s: string) => `Status:${s}`,
		getNovelStatusText: (s: string) => `NovelStatus:${s}`
	};
});

vi.mock('../src/utils/path', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/utils/path')>();
	return {
		...actual,
		findBookRoot: vi.fn((_app: unknown, _plugin: unknown, file: { path: string }) => {
			if (file.path === 'NovelA' || file.path.startsWith('NovelA/')) return 'NovelA';
			if (file.path === 'NovelB' || file.path.startsWith('NovelB/')) return 'NovelB';
			return null;
		})
	};
});

describe('Writing Journey Schema Validation (parseWritingJourneyLog)', () => {
	it('should return empty for null or undefined input', () => {
		expect(parseWritingJourneyLog(undefined)).toEqual({ status: 'empty', log: null });
		expect(parseWritingJourneyLog(null)).toEqual({ status: 'empty', log: null });
	});

	it('should return malformed for non-object inputs', () => {
		expect(parseWritingJourneyLog('not-an-object').status).toBe('malformed');
		expect(parseWritingJourneyLog(123).status).toBe('malformed');
		expect(parseWritingJourneyLog(true).status).toBe('malformed');
		expect(parseWritingJourneyLog(['array']).status).toBe('malformed');
	});

	it('should return malformed for unsupported schema version', () => {
		expect(parseWritingJourneyLog({ version: 3, events: [] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 0, events: [] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: '1', events: [] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ events: [] }).status).toBe('malformed');
	});

	it('should return malformed if events is not an array', () => {
		expect(parseWritingJourneyLog({ version: 1, events: null }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: 'not-array' }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: {} }).status).toBe('malformed');
	});

	it('should return valid for empty events array with version 1', () => {
		const result = parseWritingJourneyLog({ version: 1, events: [] });
		expect(result.status).toBe('valid');
		expect(result.log).toEqual({ version: 1, events: [] });
	});

	it('should return malformed if an event is not an object or lacks id/timestamp/type', () => {
		expect(parseWritingJourneyLog({ version: 1, events: [null] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: ['string'] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: [{ type: 'work.created', timestamp: '2026-01-01T00:00:00Z', workTitle: 'A' }] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: [{ id: '', type: 'work.created', timestamp: '2026-01-01T00:00:00Z', workTitle: 'A' }] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: [{ id: '1', type: 'work.created', timestamp: 'not-a-date', workTitle: 'A' }] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: [{ id: '1', type: 'work.created', timestamp: '2026-01-01T08:00:00+08:00', workTitle: 'A' }] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: [{ id: '1', type: 'work.created', timestamp: '2026-02-30T00:00:00Z', workTitle: 'A' }] }).status).toBe('malformed');
		expect(parseWritingJourneyLog({ version: 1, events: [{ id: '1', type: 'unknown.type', timestamp: '2026-01-01T00:00:00Z' }] }).status).toBe('malformed');
	});

	it('should validate all 9 event types correctly', () => {
		const validLog: WritingJourneyLog = {
			version: 1,
			events: [
				{ id: '1', type: 'work.created', timestamp: '2026-01-01T00:00:00.000Z', workTitle: 'Test Novel' },
				{ id: '2', type: 'work.imported', timestamp: '2026-01-01T00:05:00.000Z', workTitle: 'Test Novel', chapterCount: 10 },
				{ id: '3', type: 'tracking.started', timestamp: '2026-01-01T00:10:00.000Z' },
				{ id: '4', type: 'chapter.created', timestamp: '2026-01-01T00:15:00.000Z', path: 'NovelA/c1.md', chapterTitle: 'c1', source: 'workbench' },
				{ id: '5', type: 'chapter.renamed', timestamp: '2026-01-01T00:20:00.000Z', oldPath: 'NovelA/c1.md', newPath: 'NovelA/ch1.md', oldTitle: 'c1', newTitle: 'ch1' },
				{ id: '6', type: 'chapter.moved', timestamp: '2026-01-01T00:25:00.000Z', oldPath: 'NovelA/ch1.md', newPath: 'NovelA/卷二/ch1.md', chapterTitle: 'ch1' },
				{ id: '7', type: 'chapter.deleted', timestamp: '2026-01-01T00:30:00.000Z', path: 'NovelA/卷二/ch1.md', chapterTitle: 'ch1' },
				{ id: '8', type: 'chapter.status_changed', timestamp: '2026-01-01T00:35:00.000Z', path: 'NovelA/c2.md', chapterTitle: 'c2', fromStatus: 'draft', toStatus: 'completed' },
				{ id: '9', type: 'work.status_changed', timestamp: '2026-01-01T00:40:00.000Z', fromStatus: 'writing', toStatus: 'completed' }
			]
		};

		const result = parseWritingJourneyLog(validLog);
		expect(result.status).toBe('valid');
		expect(result.log?.events.length).toBe(9);
	});

	it('should reject events with missing required discriminated fields', () => {
		// work.created missing workTitle
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'work.created', timestamp: '2026-01-01T00:00:00Z' }]
		}).status).toBe('malformed');

		// chapter.created missing path
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'chapter.created', timestamp: '2026-01-01T00:00:00Z', chapterTitle: 'c1' }]
		}).status).toBe('malformed');

		// chapter.created with invalid source
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'chapter.created', timestamp: '2026-01-01T00:00:00Z', path: 'NovelA/c1.md', chapterTitle: 'c1', source: 'invalid' }]
		}).status).toBe('malformed');

		// chapter.renamed missing newTitle
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'chapter.renamed', timestamp: '2026-01-01T00:00:00Z', oldPath: 'a', newPath: 'b', oldTitle: 'a' }]
		}).status).toBe('malformed');

		// chapter.deleted missing chapterTitle
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'chapter.deleted', timestamp: '2026-01-01T00:00:00Z', path: 'NovelA/c1.md' }]
		}).status).toBe('malformed');

		// chapter.status_changed missing toStatus
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'chapter.status_changed', timestamp: '2026-01-01T00:00:00Z', path: 'NovelA/c1.md', chapterTitle: 'c1', fromStatus: 'draft' }]
		}).status).toBe('malformed');

		// work.status_changed missing fromStatus
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{ id: '1', type: 'work.status_changed', timestamp: '2026-01-01T00:00:00Z', toStatus: 'completed' }]
		}).status).toBe('malformed');
	});

	it('should support optional valid wordCount on chapter.status_changed while remaining backward compatible', () => {
		// Valid with positive wordCount
		const resWithCount = parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed',
				wordCount: 3500
			}]
		});
		expect(resWithCount.status).toBe('valid');
		const eventWithCount = resWithCount.log?.events[0];
		expect(eventWithCount?.type).toBe('chapter.status_changed');
		if (eventWithCount?.type === 'chapter.status_changed') {
			expect(eventWithCount.wordCount).toBe(3500);
		}

		// Valid with zero wordCount
		const resZero = parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed',
				wordCount: 0
			}]
		});
		expect(resZero.status).toBe('valid');
		const eventZero = resZero.log?.events[0];
		expect(eventZero?.type).toBe('chapter.status_changed');
		if (eventZero?.type === 'chapter.status_changed') {
			expect(eventZero.wordCount).toBe(0);
		}

		// Backward compatible: without wordCount field
		const resWithout = parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed'
			}]
		});
		expect(resWithout.status).toBe('valid');
		const eventWithout = resWithout.log?.events[0];
		expect(eventWithout?.type).toBe('chapter.status_changed');
		if (eventWithout?.type === 'chapter.status_changed') {
			expect(eventWithout.wordCount).toBeUndefined();
		}
	});

	it('should reject chapter.status_changed with invalid wordCount', () => {
		// Negative wordCount
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed',
				wordCount: -1
			}]
		}).status).toBe('malformed');

		// NaN wordCount
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed',
				wordCount: NaN
			}]
		}).status).toBe('malformed');

		// Infinity wordCount
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed',
				wordCount: Infinity
			}]
		}).status).toBe('malformed');

		// String wordCount
		expect(parseWritingJourneyLog({
			version: 1,
			events: [{
				id: '1',
				type: 'chapter.status_changed',
				timestamp: '2026-01-01T00:00:00.000Z',
				path: 'NovelA/c1.md',
				chapterTitle: 'c1',
				fromStatus: 'draft',
				toStatus: 'completed',
				wordCount: '3500'
			}]
		}).status).toBe('malformed');
	});
});

describe('WritingJourneyService', () => {
	let mockApp: any;
	let mockPlugin: any;
	let service: WritingJourneyService;
	let infoFile: any;
	let frontmatterState: Record<string, unknown>;

	beforeEach(() => {
		vi.clearAllMocks();
		frontmatterState = {};

		infoFile = {
			name: '作品信息.md',
			path: 'NovelA/作品信息.md',
			basename: '作品信息',
			extension: 'md'
		};

		mockApp = {
			vault: {
				read: vi.fn().mockImplementation(async () => {
					return `---\n${JSON.stringify(frontmatterState)}\n---`;
				}),
				getAbstractFileByPath: vi.fn((p: string) => {
					if (p === 'NovelA/作品信息.md') return infoFile;
					if (p === 'NovelA') {
						const folder = new MockTFolder('NovelA', 'NovelA');
						return folder;
					}
					return null;
				})
			},
			fileManager: {
				processFrontMatter: vi.fn().mockImplementation(async (_file: unknown, fn: (fm: Record<string, unknown>) => void) => {
					fn(frontmatterState);
				})
			},
			workspace: {
				trigger: vi.fn()
			}
		};

		parseYamlMock.mockImplementation((str: string) => {
			try {
				return JSON.parse(str);
			} catch {
				return {};
			}
		});

		mockPlugin = {
			settings: {
				loreFolderName: '设定',
				timeline: { fileName: '时间线' },
				foreshadowing: { fileName: '伏笔' },
				task: { fileName: '任务' },
				novelInfo: { fileName: '作品信息' },
				homepagePath: '创作主页.md'
			},
			homepageManager: {
				findNovelInfoFile: vi.fn((bookPath: string) => {
					if (bookPath === 'NovelA') return infoFile;
					return null;
				}),
				createNovelInfoFile: vi.fn().mockResolvedValue(infoFile)
			},
			cacheManager: {
				isEligibleForChapterList: vi.fn().mockReturnValue(true)
			},
			getVaultMarkdownFiles: vi.fn().mockReturnValue([]),
			isPluginGeneratedFile: vi.fn().mockReturnValue(false)
		};

		service = new WritingJourneyService(mockApp, mockPlugin);
		service.markReady();
	});

	describe('getJourneyLog', () => {
		it('should return empty if novel info file is not found', async () => {
			mockPlugin.homepageManager.findNovelInfoFile.mockReturnValue(null);
			const result = await service.getJourneyLog('NonExistentBook');
			expect(result).toEqual({ status: 'empty', log: null });
		});

		it('should return empty if info file has no frontmatter', async () => {
			mockApp.vault.read.mockResolvedValue('Just markdown content without frontmatter');
			const result = await service.getJourneyLog('NovelA');
			expect(result).toEqual({ status: 'empty', log: null });
		});

		it('should return malformed if parseYaml throws an error', async () => {
			parseYamlMock.mockImplementationOnce(() => {
				throw new Error('YAML parse error');
			});
			const result = await service.getJourneyLog('NovelA');
			expect(result.status).toBe('malformed');
			expect(result.error).toBe('YAML parse failure');
		});

		it('should return empty if parsed YAML contains no writing journey key', async () => {
			frontmatterState = { title: 'Novel A', author: 'Author' };
			const result = await service.getJourneyLog('NovelA');
			expect(result).toEqual({ status: 'empty', log: null });
		});

		it('should return valid log if frontmatter contains valid writing journey', async () => {
			const expectedLog: WritingJourneyLog = {
				version: 1,
				events: [{ id: 'ev-1', type: 'work.created', timestamp: '2026-01-01T00:00:00.000Z', workTitle: 'Novel A' }]
			};
			frontmatterState[WRITING_JOURNEY_YAML_KEY] = expectedLog;

			const result = await service.getJourneyLog('NovelA');
			expect(result.status).toBe('valid');
			expect(result.log).toEqual(expectedLog);
		});
	});

	describe('Lazy start logic on first tracking', () => {
		it('should prepend tracking.started when recording chapter.created on work with no prior journey log', async () => {
			await service.recordChapterCreated('NovelA', 'NovelA/第1章.md', '第1章', 'workbench');

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog).toBeDefined();
			expect(savedLog.version).toBe(1);
			expect(savedLog.events.length).toBe(2);
			expect(savedLog.events[0].type).toBe('tracking.started');
			expect(savedLog.events[1].type).toBe('chapter.created');
			expect(savedLog.events[0].timestamp).toBe(savedLog.events[1].timestamp);
			expect((savedLog.events[1] as any).chapterTitle).toBe('第1章');
			expect(mockApp.workspace.trigger).toHaveBeenCalledWith('webnovel-workbench-journey-updated', 'NovelA');
		});

		it('should NOT prepend tracking.started when recording work.created on fresh novel', async () => {
			await service.recordWorkCreated('NovelA', 'Novel A');

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog.events.length).toBe(1);
			expect(savedLog.events[0].type).toBe('work.created');
			expect((savedLog.events[0] as any).workTitle).toBe('Novel A');
		});

		it('should NOT prepend tracking.started when recording work.imported on fresh novel', async () => {
			await service.recordWorkImported('NovelA', 'Novel A', 25);

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog.events.length).toBe(1);
			expect(savedLog.events[0].type).toBe('work.imported');
			expect((savedLog.events[0] as any).chapterCount).toBe(25);
		});

		it('should NOT prepend tracking.started on subsequent events once tracking has started', async () => {
			await service.recordChapterCreated('NovelA', 'NovelA/第1章.md', '第1章', 'workbench');
			await service.recordChapterCreated('NovelA', 'NovelA/第2章.md', '第2章', 'workbench');

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog.events.length).toBe(3);
			expect(savedLog.events[0].type).toBe('tracking.started');
			expect(savedLog.events[1].type).toBe('chapter.created');
			expect(savedLog.events[2].type).toBe('chapter.created');
		});
	});

	describe('Safe error handling on malformed log', () => {
		it('should reject append and refuse to overwrite if existing log is malformed', async () => {
			frontmatterState[WRITING_JOURNEY_YAML_KEY] = {
				version: 999, // unsupported version
				events: []
			};

			await expect(
				service.recordChapterCreated('NovelA', 'NovelA/第1章.md', '第1章', 'workbench')
			).rejects.toThrow('Refusing to overwrite malformed journey log');

			// Verify processFrontMatter was not executed to modify the log
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});
	});

	describe('Same-status selection no-op', () => {
		it('should not persist or record an event when chapter status is unchanged', async () => {
			expect('recordChapterStatusChanged' in WritingJourneyService.prototype).toBe(false);
			const chapterFile = new MockTFile('第1章.md', 'NovelA/第1章.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'NovelA/作品信息.md') return infoFile;
				if (p === 'NovelA/第1章.md') return chapterFile;
				return null;
			});
			mockApp.workspace.getLeavesOfType = vi.fn(() => []);
			frontmatterState['status'] = 'draft';

			const res = await service.changeChapterStatus({
				file: chapterFile as unknown as TFile,
				toStatus: 'draft',
				bookPath: 'NovelA'
			});

			expect(res.success).toBe(true);
			expect(res.changed).toBe(false);
			expect(frontmatterState[WRITING_JOURNEY_YAML_KEY]).toBeUndefined();
		});

		it('should record an event when chapter status actually changes', async () => {
			const chapterFile = new MockTFile('第1章.md', 'NovelA/第1章.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'NovelA/作品信息.md') return infoFile;
				if (p === 'NovelA/第1章.md') return chapterFile;
				return null;
			});
			mockApp.workspace.getLeavesOfType = vi.fn(() => []);
			frontmatterState['status'] = 'draft';

			const res = await service.changeChapterStatus({
				file: chapterFile as unknown as TFile,
				toStatus: 'completed',
				bookPath: 'NovelA'
			});

			expect(res.success).toBe(true);
			expect(res.changed).toBe(true);
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog.events.some(e => e.type === 'chapter.status_changed')).toBe(true);
		});

		it('should not persist or record an event when work status is unchanged', async () => {
			await service.recordWorkStatusChanged('NovelA', 'writing', 'writing');

			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
			expect(frontmatterState[WRITING_JOURNEY_YAML_KEY]).toBeUndefined();
		});

		it('should record an event when work status actually changes', async () => {
			await service.recordWorkStatusChanged('NovelA', 'writing', 'completed');

			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog.events.some(e => e.type === 'work.status_changed')).toBe(true);
		});
	});

	describe('Chapter status word count snapshot', () => {
		it('should automatically capture word count snapshot from chapter file when status changes', async () => {
			const chapterFile = new MockTFile('第1章.md', 'NovelA/第1章.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'NovelA/作品信息.md') return infoFile;
				if (p === 'NovelA/第1章.md') return chapterFile;
				return null;
			});
			mockApp.workspace.getLeavesOfType = vi.fn(() => []);
			frontmatterState['status'] = 'draft';
			mockApp.vault.read.mockImplementation(async (file: unknown) => {
				if (file === chapterFile) return `---\n${JSON.stringify({ status: 'completed' })}\n---\n# 第1章\n\n正文内容一千字。`;
				return `---\n${JSON.stringify(frontmatterState)}\n---`;
			});
			mockPlugin.calculateAccurateWords = vi.fn().mockReturnValue(2450);

			await service.changeChapterStatus({
				file: chapterFile as unknown as TFile,
				toStatus: 'completed',
				bookPath: 'NovelA'
			});

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			const statusEvent = savedLog.events.find(
				(e): e is ChapterStatusChangedEvent => e.type === 'chapter.status_changed'
			);
			expect(statusEvent).toBeDefined();
			expect(statusEvent?.wordCount).toBe(2450);
		});

		it('should succeed and record status event without wordCount if snapshot read fails', async () => {
			const chapterFile = new MockTFile('第1章.md', 'NovelA/第1章.md');
			mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'NovelA/作品信息.md') return infoFile;
				if (p === 'NovelA/第1章.md') return chapterFile;
				return null;
			});
			mockApp.workspace.getLeavesOfType = vi.fn(() => []);
			frontmatterState['status'] = 'draft';
			mockApp.vault.read.mockImplementation(async (file: unknown) => {
				if (file === chapterFile) throw new Error('File read error during snapshot');
				return `---\n${JSON.stringify(frontmatterState)}\n---`;
			});
			mockPlugin.calculateAccurateWords = vi.fn().mockReturnValue(2450);

			await service.changeChapterStatus({
				file: chapterFile as unknown as TFile,
				toStatus: 'completed',
				bookPath: 'NovelA'
			});

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			const statusEvent = savedLog.events.find(
				(e): e is ChapterStatusChangedEvent => e.type === 'chapter.status_changed'
			);
			expect(statusEvent).toBeDefined();
			expect(statusEvent?.fromStatus).toBe('draft');
			expect(statusEvent?.toStatus).toBe('completed');
			expect(statusEvent?.wordCount).toBeUndefined();
		});
	});

	describe('Serialization and Write Queueing', () => {
		it('should serialize concurrent appends to the same novel preserving all events', async () => {
			// Trigger multiple concurrent append calls without waiting between them
			const p1 = service.recordChapterCreated('NovelA', 'NovelA/第1章.md', '第1章', 'workbench');
			const p2 = service.recordChapterRenamed('NovelA', 'NovelA/第1章.md', 'NovelA/第一章.md', '第1章', '第一章');
			const p3 = service.recordChapterDeleted('NovelA', 'NovelA/第一章.md', '第一章');

			await Promise.all([p1, p2, p3]);

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			// tracking.started + 3 operations = 4 events
			expect(savedLog.events.length).toBe(4);
			expect(savedLog.events[0].type).toBe('tracking.started');
			expect(savedLog.events[1].type).toBe('chapter.created');
			expect(savedLog.events[2].type).toBe('chapter.renamed');
			expect(savedLog.events[3].type).toBe('chapter.deleted');
		});

		it('should await pending write queues on destroy()', async () => {
			const p1 = service.recordChapterCreated('NovelA', 'NovelA/第1章.md', '第1章', 'workbench');
			await service.destroy();
			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog).toBeDefined();
			expect(savedLog.events.length).toBe(2);
		});
	});

	describe('Deduplication and TTL Handlers', () => {
		it('should correctly mark and consume handled create events', () => {
			service.markHandledCreate('NovelA/第1章.md');
			expect(service.consumeHandledCreate('NovelA/第1章.md')).toBe(true);
			// Second consume returns false (already consumed)
			expect(service.consumeHandledCreate('NovelA/第1章.md')).toBe(false);
		});

		it('should return false for expired handled create TTL', () => {
			// Negative TTL means already expired
			service.markHandledCreate('NovelA/第1章.md', -100);
			expect(service.consumeHandledCreate('NovelA/第1章.md')).toBe(false);
		});

		it('should correctly mark and consume handled rename events', () => {
			service.markHandledRename('NovelA/old.md', 'NovelA/new.md');
			expect(service.consumeHandledRename('NovelA/old.md', 'NovelA/new.md')).toBe(true);
			expect(service.consumeHandledRename('NovelA/old.md', 'NovelA/new.md')).toBe(false);
		});

		it('should lazily prune expired TTLs even when only a few keys exist', () => {
			vi.useFakeTimers();
			vi.setSystemTime(1000);
			service.markHandledCreate('NovelA/short.md', 100);
			service.markHandledCreate('NovelA/long.md', 2000);

			vi.setSystemTime(2000);
			service.markHandledCreate('NovelA/trigger.md', 100);

			expect(service.consumeHandledCreate('NovelA/short.md')).toBe(false);
			expect(service.consumeHandledCreate('NovelA/long.md')).toBe(true);
			expect(service.consumeHandledCreate('NovelA/trigger.md')).toBe(true);
			vi.useRealTimers();
		});
	});

	describe('Vault Event Integration', () => {
		it('handleVaultCreate should suppress duplicate if markHandledCreate was armed', async () => {
			const file = new MockTFile('第1章.md', 'NovelA/第1章.md') as any;
			service.markHandledCreate('NovelA/第1章.md');

			await service.handleVaultCreate(file);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('handleVaultCreate should ignore non-markdown files', async () => {
			const file = { path: 'NovelA/cover.png', extension: 'png', basename: 'cover' } as any;
			await service.handleVaultCreate(file);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('handleVaultCreate should ignore excluded docs like lore/timeline/novelInfo', async () => {
			const loreFile = new MockTFile('设定.md', 'NovelA/设定/人物.md') as any;
			await service.handleVaultCreate(loreFile);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();

			const info = new MockTFile('作品信息.md', 'NovelA/作品信息.md') as any;
			await service.handleVaultCreate(info);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('handleVaultCreate should record chapter.created with source vault for new chapter files', async () => {
			const chapterFile = new MockTFile('第1章.md', 'NovelA/第1章.md') as any;
			await service.handleVaultCreate(chapterFile);

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog).toBeDefined();
			const createdEvent = savedLog.events.find(e => e.type === 'chapter.created') as any;
			expect(createdEvent).toBeDefined();
			expect(createdEvent.source).toBe('vault');
			expect(createdEvent.chapterTitle).toBe('第1章');
		});

		it('handleVaultRename should record intra-novel chapter.renamed', async () => {
			const renamedFile = new MockTFile('第1章_新.md', 'NovelA/第1章_新.md') as any;
			await service.handleVaultRename(renamedFile, 'NovelA/第1章_旧.md');

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			const renameEvent = savedLog.events.find(e => e.type === 'chapter.renamed') as any;
			expect(renameEvent).toBeDefined();
			expect(renameEvent.oldTitle).toBe('第1章_旧');
			expect(renameEvent.newTitle).toBe('第1章_新');
		});

		it('handleVaultRename should record chapter.moved when only the parent folder changes', async () => {
			const movedFile = new MockTFile('第1章.md', 'NovelA/第二卷/第1章.md') as any;
			await service.handleVaultRename(movedFile, 'NovelA/第一卷/第1章.md');

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			const moveEvent = savedLog.events.find(e => e.type === 'chapter.moved');
			expect(moveEvent).toMatchObject({
				oldPath: 'NovelA/第一卷/第1章.md',
				newPath: 'NovelA/第二卷/第1章.md',
				chapterTitle: '第1章'
			});
		});

		it('handleVaultDelete should record chapter.deleted', async () => {
			const deletedFile = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			(deletedFile as unknown as { parent: unknown }).parent = new MockTFolder('NovelA', 'NovelA');
			await service.handleVaultDelete(deletedFile);

			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			const deleteEvent = savedLog.events.find(e => e.type === 'chapter.deleted') as unknown as { chapterTitle: string };
			expect(deleteEvent).toBeDefined();
			expect(deleteEvent.chapterTitle).toBe('第1章');
			expect(savedLog.events.filter(e => e.type === 'chapter.deleted')).toHaveLength(1);
		});

		it('handleVaultDelete should ignore Markdown files that are not eligible chapters', async () => {
			mockPlugin.cacheManager.isEligibleForChapterList.mockReturnValue(false);
			const deletedFile = new MockTFile('参考资料.md', 'NovelA/参考资料.md') as unknown as TFile;
			(deletedFile as unknown as { parent: unknown }).parent = new MockTFolder('NovelA', 'NovelA');

			await service.handleVaultDelete(deletedFile);

			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
			expect(frontmatterState[WRITING_JOURNEY_YAML_KEY]).toBeUndefined();
		});

		it('initializeStartupBaseline should populate from plugin.getVaultMarkdownFiles when no paths provided', () => {
			const file1 = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			mockPlugin.getVaultMarkdownFiles.mockReturnValue([file1]);

			service.initializeStartupBaseline();
			expect(service['baselinePaths'].has('NovelA/第1章.md')).toBe(true);
			expect(service['baselinePaths'].has('NovelA/第2章.md')).toBe(false);
		});

		it('handleVaultCreate should suppress chapter.created for files present in startup baseline', async () => {
			const existingFile = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			// Simulate baseline initialization with existing files
			service.initializeStartupBaseline(['NovelA/第1章.md']);

			await service.handleVaultCreate(existingFile);

			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
			expect(frontmatterState[WRITING_JOURNEY_YAML_KEY]).toBeUndefined();
		});

		it('handleVaultCreate should record genuine post-setup create once and suppress subsequent duplicates', async () => {
			service.initializeStartupBaseline(['NovelA/第1章.md']);

			const newFile = new MockTFile('第2章.md', 'NovelA/第2章.md') as unknown as TFile;
			await service.handleVaultCreate(newFile);

			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			expect(savedLog.events.filter(e => e.type === 'chapter.created')).toHaveLength(1);

			// Replay of create event for the newly created file should be suppressed
			mockApp.fileManager.processFrontMatter.mockClear();
			await service.handleVaultCreate(newFile);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('should record chapter.created when a deleted chapter is recreated', async () => {
			service.initializeStartupBaseline(['NovelA/第1章.md']);

			const chapterFile = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			(chapterFile as unknown as { parent: unknown }).parent = new MockTFolder('NovelA', 'NovelA');

			// Delete the chapter
			await service.handleVaultDelete(chapterFile);
			mockApp.fileManager.processFrontMatter.mockClear();

			// Recreate the chapter
			await service.handleVaultCreate(chapterFile);
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
			const savedLog = frontmatterState[WRITING_JOURNEY_YAML_KEY] as WritingJourneyLog;
			const createdEvents = savedLog.events.filter(e => e.type === 'chapter.created');
			expect(createdEvents.length).toBeGreaterThanOrEqual(1);
		});

		it('rename lifecycle should suppress duplicate create for new path and allow future create for old path', async () => {
			service.initializeStartupBaseline(['NovelA/第1章.md']);

			const renamedFile = new MockTFile('第1章_新.md', 'NovelA/第1章_新.md') as unknown as TFile;
			await service.handleVaultRename(renamedFile, 'NovelA/第1章.md');

			// 1. Spurious create for the newly renamed path should be suppressed
			mockApp.fileManager.processFrontMatter.mockClear();
			await service.handleVaultCreate(renamedFile);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();

			// 2. An unrelated future create at the old path must NOT be suppressed
			const recreatedOldFile = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			await service.handleVaultCreate(recreatedOldFile);
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
		});

		it('folder delete/rename lifecycle should correctly update baseline paths', async () => {
			service.initializeStartupBaseline(['NovelA/卷一/第1章.md']);

			// Folder rename: old paths must be updated to new paths
			const oldFolder = new MockTFolder('卷一', 'NovelA/卷一');
			const newFolder = new MockTFolder('卷二', 'NovelA/卷二');
			await service.handleVaultRename(newFolder as unknown as TFile, oldFolder.path);

			// Spurious create on new nested path is suppressed
			const newNestedFile = new MockTFile('第1章.md', 'NovelA/卷二/第1章.md') as unknown as TFile;
			mockApp.fileManager.processFrontMatter.mockClear();
			await service.handleVaultCreate(newNestedFile);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();

			// Creating at old folder path is NOT suppressed
			const oldNestedFile = new MockTFile('第1章.md', 'NovelA/卷一/第1章.md') as unknown as TFile;
			await service.handleVaultCreate(oldNestedFile);
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);

			// Folder delete: nested paths are cleared from baseline
			mockApp.fileManager.processFrontMatter.mockClear();
			await service.handleVaultDelete(newFolder as unknown as TFile);
			await service.handleVaultCreate(newNestedFile);
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
		});
	});

	describe('Startup Metadata Readiness and Persistent Semantic Fallback', () => {
		it('should suppress and collect create events emitted before metadata cache readiness', async () => {
			const unreadyService = new WritingJourneyService(mockApp, mockPlugin);
			const file = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			await unreadyService.handleVaultCreate(file);

			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
			expect(unreadyService['baselinePaths'].has('NovelA/第1章.md')).toBe(true);
		});

		it('should transition to ready and refresh baseline upon markReady()', () => {
			const file = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			mockPlugin.getVaultMarkdownFiles.mockReturnValue([file]);

			const unreadyService = new WritingJourneyService(mockApp, mockPlugin);
			expect(unreadyService['baselinePaths'].has('NovelA/第1章.md')).toBe(false);

			unreadyService.markReady();
			expect(unreadyService['baselinePaths'].has('NovelA/第1章.md')).toBe(true);
		});

		it('markReady should be idempotent and not re-scan after initial readiness', () => {
			const file = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			mockPlugin.getVaultMarkdownFiles.mockReturnValue([file]);

			const unreadyService = new WritingJourneyService(mockApp, mockPlugin);
			unreadyService.markReady();
			expect(unreadyService['baselinePaths'].has('NovelA/第1章.md')).toBe(true);

			mockPlugin.getVaultMarkdownFiles.mockClear();
			unreadyService.markReady();
			expect(mockPlugin.getVaultMarkdownFiles).not.toHaveBeenCalled();
		});

		describe('checkInitialMetadataReadiness', () => {
			it('should return false when markdown file snapshot has zero files', () => {
				mockApp.metadataCache = {
					resolvedLinks: {},
					getFileCache: vi.fn().mockReturnValue(null)
				};
				mockPlugin.getVaultMarkdownFiles.mockReturnValue([]);
				expect(service.checkInitialMetadataReadiness()).toBe(false);
			});

			it('should return false when resolvedLinks is non-empty alone without full cache', () => {
				mockApp.metadataCache = {
					resolvedLinks: { 'NovelA/第1章.md': {} },
					getFileCache: vi.fn().mockReturnValue(null)
				};
				// Zero files
				mockPlugin.getVaultMarkdownFiles.mockReturnValue([]);
				expect(service.checkInitialMetadataReadiness()).toBe(false);

				// Files present but missing cache
				const file1 = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
				mockPlugin.getVaultMarkdownFiles.mockReturnValue([file1]);
				expect(service.checkInitialMetadataReadiness()).toBe(false);
			});

			it('should return false when partial cache is present (one cached, one missing)', () => {
				const file1 = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
				const file2 = new MockTFile('第2章.md', 'NovelA/第2章.md') as unknown as TFile;
				mockPlugin.getVaultMarkdownFiles.mockReturnValue([file1, file2]);

				mockApp.metadataCache = {
					resolvedLinks: { 'NovelA/第1章.md': {} },
					getFileCache: vi.fn((file: TFile) => {
						if (file.path === 'NovelA/第1章.md') return { frontmatter: {} };
						return null;
					})
				};

				expect(service.checkInitialMetadataReadiness()).toBe(false);
			});

			it('should return true when all current markdown files have non-null metadata cache', () => {
				const file1 = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
				const file2 = new MockTFile('第2章.md', 'NovelA/第2章.md') as unknown as TFile;
				mockPlugin.getVaultMarkdownFiles.mockReturnValue([file1, file2]);

				mockApp.metadataCache = {
					resolvedLinks: {},
					getFileCache: vi.fn((_file: TFile) => ({ frontmatter: {} }))
				};

				expect(service.checkInitialMetadataReadiness()).toBe(true);
			});

			it('should fallback to true when metadataCache is absent in isolated test environment', () => {
				delete mockApp.metadataCache;
				expect(service.checkInitialMetadataReadiness()).toBe(true);
			});
		});

		it('should record genuine create after ready once and suppress duplicates', async () => {
			const newFile = new MockTFile('第2章.md', 'NovelA/第2章.md') as unknown as TFile;
			await service.handleVaultCreate(newFile);

			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);

			// Replay of create event for the newly created file should be suppressed
			mockApp.fileManager.processFrontMatter.mockClear();
			await service.handleVaultCreate(newFile);
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('should suppress create for persisted active chapter across fresh service instance with empty baseline', async () => {
			// Simulate existing journey log with active chapter
			frontmatterState[WRITING_JOURNEY_YAML_KEY] = {
				version: 1,
				events: [
					{
						id: 'ev-1',
						type: 'chapter.created',
						timestamp: '2026-01-01T00:00:00.000Z',
						path: 'NovelA/第1章.md',
						chapterTitle: '第1章',
						source: 'vault'
					}
				]
			};

			// Fresh service instance with empty baseline (marked ready)
			const freshService = new WritingJourneyService(mockApp, mockPlugin);
			freshService.markReady();
			expect(freshService['baselinePaths'].has('NovelA/第1章.md')).toBe(false);

			const file = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			await freshService.handleVaultCreate(file);

			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
			expect(freshService['baselinePaths'].has('NovelA/第1章.md')).toBe(true);
		});

		it('should allow recreation if chapter was previously deleted in journey log', async () => {
			frontmatterState[WRITING_JOURNEY_YAML_KEY] = {
				version: 1,
				events: [
					{
						id: 'ev-1',
						type: 'chapter.created',
						timestamp: '2026-01-01T00:00:00.000Z',
						path: 'NovelA/第1章.md',
						chapterTitle: '第1章',
						source: 'vault'
					},
					{
						id: 'ev-2',
						type: 'chapter.deleted',
						timestamp: '2026-01-01T00:10:00.000Z',
						path: 'NovelA/第1章.md',
						chapterTitle: '第1章'
					}
				]
			};

			const freshService = new WritingJourneyService(mockApp, mockPlugin);
			freshService.markReady();

			const file = new MockTFile('第1章.md', 'NovelA/第1章.md') as unknown as TFile;
			await freshService.handleVaultCreate(file);

			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
			expect(freshService['baselinePaths'].has('NovelA/第1章.md')).toBe(true);
		});
	});
});

describe('WritingJourneyBoardRenderer Search Matching', () => {
	const mockEvent: WritingJourneyEvent = {
		id: 'ev-1',
		type: 'chapter.created',
		timestamp: '2026-01-01T00:00:00.000Z',
		path: 'NovelA/第100章 决战.md',
		chapterTitle: '第100章 决战',
		source: 'workbench'
	};

	it('should match full or partial chapter title', () => {
		expect(WritingJourneyBoardRenderer.matchesQuery(mockEvent, '决战')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(mockEvent, '第100章')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(mockEvent, '日常')).toBe(false);
	});

	it('should match with case-insensitivity and NFKC normalization', () => {
		const englishEvent: WritingJourneyEvent = {
			id: 'ev-2',
			type: 'chapter.renamed',
			timestamp: '2026-01-01T00:00:00.000Z',
			oldPath: 'NovelA/Prologue.md',
			newPath: 'NovelA/Chapter 1.md',
			oldTitle: 'Prologue',
			newTitle: 'Chapter 1'
		};

		expect(WritingJourneyBoardRenderer.matchesQuery(englishEvent, 'prologue')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(englishEvent, 'CHAPTER')).toBe(true);
		// Fullwidth letters normalized to halfwidth
		expect(WritingJourneyBoardRenderer.matchesQuery(englishEvent, 'ｃｈａｐｔｅｒ')).toBe(true);
	});

	it('should support multi-token AND matching across type, title, and details', () => {
		const statusEvent: WritingJourneyEvent = {
			id: 'ev-3',
			type: 'chapter.status_changed',
			timestamp: '2026-01-01T00:00:00.000Z',
			path: 'NovelA/第2章.md',
			chapterTitle: '第2章 启程',
			fromStatus: 'draft',
			toStatus: 'completed'
		};

		// Tokens matching title and status text
		expect(WritingJourneyBoardRenderer.matchesQuery(statusEvent, '启程 completed')).toBe(true);
		// One token doesn't match
		expect(WritingJourneyBoardRenderer.matchesQuery(statusEvent, '启程 absent')).toBe(false);
	});

	it('should format chapter status event detail with word count and match in search', () => {
		const statusWithCount: WritingJourneyEvent = {
			id: 'ev-count',
			type: 'chapter.status_changed',
			timestamp: '2026-01-01T00:00:00.000Z',
			path: 'NovelA/第2章.md',
			chapterTitle: '第2章 启程',
			fromStatus: 'draft',
			toStatus: 'completed',
			wordCount: 3500
		};

		const displayInfo = WritingJourneyBoardRenderer.getEventDisplayInfo(statusWithCount);
		expect(displayInfo.detailText).toContain('3,500');
		expect(displayInfo.detailText).toContain('字');
		expect(displayInfo.detailText).toBe('Status:draft → Status:completed (3,500 字)');

		// Search matches formatted word count
		expect(WritingJourneyBoardRenderer.matchesQuery(statusWithCount, '3,500')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(statusWithCount, '启程 3,500')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(statusWithCount, '99999')).toBe(false);

		// Status event without word count keeps original format without parentheses
		const statusWithoutCount: WritingJourneyEvent = {
			id: 'ev-nocount',
			type: 'chapter.status_changed',
			timestamp: '2026-01-01T00:00:00.000Z',
			path: 'NovelA/第2章.md',
			chapterTitle: '第2章 启程',
			fromStatus: 'draft',
			toStatus: 'completed'
		};
		const displayNoCount = WritingJourneyBoardRenderer.getEventDisplayInfo(statusWithoutCount);
		expect(displayNoCount.detailText).toBe('Status:draft → Status:completed');
	});

	it('should match localized move events by change type and chapter title', () => {
		const movedEvent: WritingJourneyEvent = {
			id: 'ev-4',
			type: 'chapter.moved',
			timestamp: '2026-01-01T00:00:00.000Z',
			oldPath: 'NovelA/第一卷/第3章.md',
			newPath: 'NovelA/第二卷/第3章.md',
			chapterTitle: '第3章 转折'
		};

		expect(WritingJourneyBoardRenderer.matchesQuery(movedEvent, '转折')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(movedEvent, '移动章节')).toBe(true);
	});

	it('should return true when query is empty or whitespace', () => {
		expect(WritingJourneyBoardRenderer.matchesQuery(mockEvent, '')).toBe(true);
		expect(WritingJourneyBoardRenderer.matchesQuery(mockEvent, '   ')).toBe(true);
	});

	it('should place tracking.started below its first change even for legacy later timestamps', () => {
		const events: WritingJourneyEvent[] = [
			{
				id: 'tracking',
				type: 'tracking.started',
				timestamp: '2026-09-08T05:43:00.002Z'
			},
			{
				id: 'status',
				type: 'chapter.status_changed',
				timestamp: '2026-09-08T05:43:00.001Z',
				path: 'NovelA/第一章.md',
				chapterTitle: '第一章',
				fromStatus: '待写',
				toStatus: '已完稿'
			},
			{
				id: 'deleted',
				type: 'chapter.deleted',
				timestamp: '2026-09-08T05:44:00.000Z',
				path: 'NovelA/第十一章.md',
				chapterTitle: '第十一章'
			}
		];

		expect(WritingJourneyBoardRenderer.sortEvents(events, true).map(event => event.id)).toEqual([
			'deleted',
			'status',
			'tracking'
		]);
		expect(WritingJourneyBoardRenderer.sortEvents(events).map(event => event.id)).toEqual([
			'deleted',
			'status',
			'tracking'
		]);
	});

	it('should support date and time search matching including tokenized AND behavior', () => {
		const timedEvent: WritingJourneyEvent = {
			id: 'ev-time',
			type: 'chapter.created',
			timestamp: '2026-09-08T05:43:00.000Z',
			path: 'NovelA/第一章.md',
			chapterTitle: '第一章 启程'
		};

		const formatted = WritingJourneyBoardRenderer.formatTimestamp(timedEvent.timestamp);
		const [datePart, timePart] = formatted.split(' ');

		// Full displayed timestamp
		expect(WritingJourneyBoardRenderer.matchesQuery(timedEvent, formatted)).toBe(true);
		// Date token
		expect(WritingJourneyBoardRenderer.matchesQuery(timedEvent, datePart)).toBe(true);
		// Time token
		expect(WritingJourneyBoardRenderer.matchesQuery(timedEvent, timePart)).toBe(true);
		// Tokenized AND query: title + date
		expect(WritingJourneyBoardRenderer.matchesQuery(timedEvent, `启程 ${datePart}`)).toBe(true);
		// Tokenized AND query: type + time
		expect(WritingJourneyBoardRenderer.matchesQuery(timedEvent, `创建章节 ${timePart}`)).toBe(true);
		// Non-matching date
		expect(WritingJourneyBoardRenderer.matchesQuery(timedEvent, '1999-01-01')).toBe(false);
	});

	it('should format timestamps into YYYY-MM-DD HH:mm and produce time search haystack without error', () => {
		const formatted = WritingJourneyBoardRenderer.formatTimestamp('2026-09-08T13:45:00.000Z');
		expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
		const haystack = WritingJourneyBoardRenderer.getTimeSearchHaystack('2026-09-08T13:45:00.000Z');
		expect(haystack).toContain(formatted);
	});

	it('should sort events in oldest-first order with tracking.started before its first change', () => {
		const events: WritingJourneyEvent[] = [
			{
				id: 'tracking',
				type: 'tracking.started',
				timestamp: '2026-09-08T05:43:00.002Z'
			},
			{
				id: 'status',
				type: 'chapter.status_changed',
				timestamp: '2026-09-08T05:43:00.001Z',
				path: 'NovelA/第一章.md',
				chapterTitle: '第一章',
				fromStatus: '待写',
				toStatus: '已完稿'
			},
			{
				id: 'deleted',
				type: 'chapter.deleted',
				timestamp: '2026-09-08T05:44:00.000Z',
				path: 'NovelA/第十一章.md',
				chapterTitle: '第十一章'
			}
		];

		const oldestFirst = WritingJourneyBoardRenderer.sortEvents(events, false);
		expect(oldestFirst.map(e => e.id)).toEqual([
			'tracking',
			'status',
			'deleted'
		]);

		const oldestFirstExplicit = WritingJourneyBoardRenderer.sortEvents(events, false);
		expect(oldestFirstExplicit.map(e => e.id)).toEqual([
			'tracking',
			'status',
			'deleted'
		]);

		// Sorting does not mutate the original array
		expect(events[0].id).toBe('tracking');
		expect(events[1].id).toBe('status');
		expect(events[2].id).toBe('deleted');
	});

	it('should render a flat list without date grouping headers and include full timestamps', async () => {
		const mockService = {
			getJourneyLog: vi.fn().mockResolvedValue({
				status: 'valid',
				log: {
					version: 1,
					events: [
						{
							id: 'ev-1',
							type: 'tracking.started',
							timestamp: '2026-09-08T05:43:00.000Z'
						},
						{
							id: 'ev-2',
							type: 'chapter.created',
							timestamp: '2026-09-08T05:43:00.000Z',
							path: 'NovelA/第一章.md',
							chapterTitle: '第一章'
						}
					]
				}
			})
		};

		const container = new MockElement('workbench-buffer');
		await WritingJourneyBoardRenderer.render({
			app: {
				vault: { getAbstractFileByPath: () => null }
			} as unknown as import('obsidian').App,
			plugin: { writingJourneyService: mockService as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: '',
			isDescending: true
		});

		// Board container created
		expect(container.querySelector('.wn-writing-journey-board')).toBeDefined();
		// Flat list container created
		expect(container.querySelector('.wn-writing-journey-list')).toBeDefined();
		// NO date grouping elements
		expect(container.querySelector('.wn-writing-journey-group')).toBeNull();
		expect(container.querySelector('.wn-writing-journey-date-header')).toBeNull();
		expect(container.querySelector('.wn-writing-journey-date-count')).toBeNull();

		// Rows exist with full timestamp (YYYY-MM-DD HH:mm)
		const timeEls = container.querySelectorAll('.wn-writing-journey-time');
		expect(timeEls.length).toBe(2);
		expect(timeEls[0].textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
		expect(timeEls[1].textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
	});

	it('should hide only trailing-space cleanup renames while keeping real title changes', async () => {
		const events: WritingJourneyEvent[] = [
			{ id: 'created', type: 'chapter.created', timestamp: '2026-09-08T05:43:00.000Z', path: 'NovelA/01 .md', chapterTitle: '01 ', source: 'workbench' },
			{ id: 'cleanup', type: 'chapter.renamed', timestamp: '2026-09-08T05:44:00.000Z', oldPath: 'NovelA/01 .md', newPath: 'NovelA/01.md', oldTitle: '01 ', newTitle: '01' },
			{ id: 'subtitle', type: 'chapter.renamed', timestamp: '2026-09-08T05:45:00.000Z', oldPath: 'NovelA/01.md', newPath: 'NovelA/01 启程.md', oldTitle: '01', newTitle: '01 启程' }
		];
		const container = new MockElement('workbench-buffer');
		const getAbstractFileByPath = vi.fn((path: string) => path === 'NovelA/01 启程.md'
			? new MockTFile('01 启程.md', path)
			: null);
		await WritingJourneyBoardRenderer.render({
			app: { vault: { getAbstractFileByPath } } as unknown as import('obsidian').App,
			plugin: { writingJourneyService: { getJourneyLog: async () => ({ status: 'valid', log: { version: 1, events } }) } as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: ''
		});
		expect(container.querySelectorAll('.wn-writing-journey-item')).toHaveLength(2);
		expect(getAbstractFileByPath).toHaveBeenCalledWith('NovelA/01 启程.md');
		expect(events).toHaveLength(3);
	});

	it('should keep moves and substantive whitespace edits in the journey', async () => {
		const events: WritingJourneyEvent[] = [
			{ id: 'move', type: 'chapter.renamed', timestamp: '2026-09-08T05:43:00.000Z', oldPath: 'NovelA/卷一/01 .md', newPath: 'NovelA/卷二/01.md', oldTitle: '01 ', newTitle: '01' },
			{ id: 'leading', type: 'chapter.renamed', timestamp: '2026-09-08T05:44:00.000Z', oldPath: 'NovelA/ 01.md', newPath: 'NovelA/01.md', oldTitle: ' 01', newTitle: '01' },
			{ id: 'subtitle', type: 'chapter.renamed', timestamp: '2026-09-08T05:45:00.000Z', oldPath: 'NovelA/01 .md', newPath: 'NovelA/01 启程.md', oldTitle: '01 ', newTitle: '01 启程' }
		];
		const container = new MockElement('workbench-buffer');
		await WritingJourneyBoardRenderer.render({
			app: { vault: { getAbstractFileByPath: () => null } } as unknown as import('obsidian').App,
			plugin: { writingJourneyService: { getJourneyLog: async () => ({ status: 'valid', log: { version: 1, events } }) } as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: ''
		});
		expect(container.querySelectorAll('.wn-writing-journey-item')).toHaveLength(3);
	});

	it('should show an empty journey when its only change was trimming a chapter title', async () => {
		const events: WritingJourneyEvent[] = [
			{ id: 'tracking', type: 'tracking.started', timestamp: '2026-09-08T05:43:00.000Z' },
			{ id: 'cleanup', type: 'chapter.renamed', timestamp: '2026-09-08T05:43:00.000Z', oldPath: 'NovelA/01 .md', newPath: 'NovelA/01.md', oldTitle: '01 ', newTitle: '01' }
		];
		const container = new MockElement('workbench-buffer');
		await WritingJourneyBoardRenderer.render({
			app: { vault: { getAbstractFileByPath: () => null } } as unknown as import('obsidian').App,
			plugin: { writingJourneyService: { getJourneyLog: async () => ({ status: 'valid', log: { version: 1, events } }) } as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: ''
		});
		expect(container.querySelectorAll('.wn-writing-journey-item')).toHaveLength(0);
		expect(container.querySelector('.wn-corkboard-empty-msg')).not.toBeNull();
	});

	it('should resolve navigation through chained renames and moves via per-render index', async () => {
		const events: WritingJourneyEvent[] = [
			{ id: 'c1', type: 'chapter.created', timestamp: '2026-09-08T05:00:00.000Z', path: 'NovelA/01.md', chapterTitle: '01' },
			{ id: 'r1', type: 'chapter.renamed', timestamp: '2026-09-08T05:01:00.000Z', oldPath: 'NovelA/01.md', newPath: 'NovelA/01_draft.md', oldTitle: '01', newTitle: '01_draft' },
			{ id: 'm1', type: 'chapter.moved', timestamp: '2026-09-08T05:02:00.000Z', oldPath: 'NovelA/01_draft.md', newPath: 'NovelA/Archive/01_final.md', chapterTitle: '01_draft' }
		];
		const container = new MockElement('workbench-buffer');
		const getAbstractFileByPath = vi.fn((path: string) => path === 'NovelA/Archive/01_final.md'
			? new MockTFile('01_final.md', path)
			: null);

		await WritingJourneyBoardRenderer.render({
			app: { vault: { getAbstractFileByPath } } as unknown as import('obsidian').App,
			plugin: { writingJourneyService: { getJourneyLog: async () => ({ status: 'valid', log: { version: 1, events } }) } as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: ''
		});

		expect(getAbstractFileByPath).toHaveBeenCalledWith('NovelA/Archive/01_final.md');
		const rows = container.querySelectorAll('.wn-writing-journey-item');
		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(row.hasClass('wn-clickable')).toBe(true);
			expect(row.hasClass('is-deleted')).toBe(false);
		}
	});

	it('should correctly handle A->B->A cycles and path reuse in original chronological order', async () => {
		const events: WritingJourneyEvent[] = [
			{ id: 'c1', type: 'chapter.created', timestamp: '2026-09-08T05:00:00.000Z', path: 'NovelA/A.md', chapterTitle: 'A' },
			{ id: 'r1', type: 'chapter.renamed', timestamp: '2026-09-08T05:01:00.000Z', oldPath: 'NovelA/A.md', newPath: 'NovelA/B.md', oldTitle: 'A', newTitle: 'B' },
			{ id: 'r2', type: 'chapter.renamed', timestamp: '2026-09-08T05:02:00.000Z', oldPath: 'NovelA/B.md', newPath: 'NovelA/A.md', oldTitle: 'B', newTitle: 'A' },
			{ id: 'c2', type: 'chapter.created', timestamp: '2026-09-08T05:03:00.000Z', path: 'NovelA/C.md', chapterTitle: 'C' },
			{ id: 'm1', type: 'chapter.moved', timestamp: '2026-09-08T05:04:00.000Z', oldPath: 'NovelA/C.md', newPath: 'NovelA/B.md', chapterTitle: 'C' },
			{ id: 'm2', type: 'chapter.moved', timestamp: '2026-09-08T05:05:00.000Z', oldPath: 'NovelA/B.md', newPath: 'NovelA/D.md', chapterTitle: 'C' }
		];
		const container = new MockElement('workbench-buffer');
		const checkedPaths: string[] = [];
		const getAbstractFileByPath = vi.fn((path: string) => {
			checkedPaths.push(path);
			return new MockTFile(path.split('/').pop()!, path);
		});

		await WritingJourneyBoardRenderer.render({
			app: { vault: { getAbstractFileByPath } } as unknown as import('obsidian').App,
			plugin: { writingJourneyService: { getJourneyLog: async () => ({ status: 'valid', log: { version: 1, events } }) } as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: ''
		});

		expect(checkedPaths).toContain('NovelA/A.md');
		expect(checkedPaths).toContain('NovelA/D.md');
	});

	it('should resolve paths using raw events order even when display order is reversed or filtered', async () => {
		const events: WritingJourneyEvent[] = [
			{ id: 'c1', type: 'chapter.created', timestamp: '2026-09-08T05:00:00.000Z', path: 'NovelA/01.md', chapterTitle: '独家创世篇' },
			{ id: 'r1', type: 'chapter.renamed', timestamp: '2026-09-08T05:05:00.000Z', oldPath: 'NovelA/01.md', newPath: 'NovelA/01_renamed.md', oldTitle: '旧标题', newTitle: '改名篇' }
		];
		const container = new MockElement('workbench-buffer');
		const checkedPaths: string[] = [];
		const getAbstractFileByPath = vi.fn((path: string) => {
			checkedPaths.push(path);
			return new MockTFile('01_renamed.md', path);
		});

		await WritingJourneyBoardRenderer.render({
			app: { vault: { getAbstractFileByPath } } as unknown as import('obsidian').App,
			plugin: { writingJourneyService: { getJourneyLog: async () => ({ status: 'valid', log: { version: 1, events } }) } as unknown as WritingJourneyService },
			container: container as unknown as HTMLElement,
			currentBookPath: 'NovelA',
			query: '独家创世篇'
		});

		const rows = container.querySelectorAll('.wn-writing-journey-item');
		expect(rows).toHaveLength(1);
		expect(checkedPaths).toContain('NovelA/01_renamed.md');
	});
});
describe('WritingJourneyService changeChapterStatus Regressions', () => {
	beforeEach(() => {
		parseYamlMock.mockImplementation((text: string) => ({ status: /status: ([^\n]+)/.exec(text)?.[1] }));
	});
	it('should return changed: false without mutating or recording when fromStatus === toStatus', async () => {
		const mockFile = new MockTFile('Chapter1.md', 'NovelA/Chapter1.md');
		const processFrontMatter = vi.fn(async (_file: unknown, callback: (fm: Record<string, unknown>) => void) => callback({ status: 'draft' }));
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn(() => mockFile),
				read: vi.fn(async () => 'Content')
			},
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				trigger: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: { status: '草稿' }
				}))
			},
			fileManager: { processFrontMatter }
		};

		const service = new WritingJourneyService(mockApp as unknown as App, {} as WebNovelAssistantPlugin);
		const result = await service.changeChapterStatus({
			file: mockFile as unknown as TFile,
			toStatus: 'draft'
		});

		expect(result.success).toBe(true);
		expect(result.changed).toBe(false);
		expect(processFrontMatter).toHaveBeenCalledOnce();
	});

	it('should save open editor buffers and save snapshot ref when status changes', async () => {
		const mockFile = new MockTFile('Chapter1.md', 'NovelA/Chapter1.md');
		const editorSaveMock = vi.fn(async () => {});
		let frontmatterStatus = 'unwritten';
		const processFrontMatter = vi.fn(async (_f: unknown, cb: (fm: Record<string, unknown>) => void) => {
			const fm: Record<string, unknown> = {};
			cb(fm);
			if (typeof fm.status === 'string') frontmatterStatus = fm.status;
		});

		const saveSnapshotMock = vi.fn(async () => ({
			provider: 'file-recovery',
			deviceId: 'dev-1',
			dbName: 'vault-backup',
			key: 99,
			path: 'NovelA/Chapter1.md',
			ts: Date.now(),
			digest: 'a'.repeat(64)
		}));

		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn(() => mockFile),
				read: vi.fn(async () => '---\nstatus: draft\n---\nFrozen chapter content')
			},
			workspace: {
				getLeavesOfType: vi.fn(() => [
					{
						view: Object.assign(new MockMarkdownView(), {
							file: mockFile,
							save: editorSaveMock
						})
					}
				]),
				trigger: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: { status: frontmatterStatus }
				}))
			},
			fileManager: { processFrontMatter }
		};

		const mockPlugin = {
			calculateAccurateWords: vi.fn(() => 3),
			homepageManager: {
				findNovelInfoFile: vi.fn(() => new MockTFile('作品信息.md', 'NovelA/作品信息.md'))
			},
			services: {
				getOptional: vi.fn((key: string) => {
					if (key === 'NativeSnapshotService') return { saveSnapshot: saveSnapshotMock };
					return null;
				})
			}
		};

		const service = new WritingJourneyService(mockApp as unknown as App, mockPlugin as unknown as WebNovelAssistantPlugin);
		vi.spyOn(service, 'getJourneyLog').mockResolvedValue({
			status: 'valid',
			log: { version: 1, events: [] }
		});

		const result = await service.changeChapterStatus({
			file: mockFile as unknown as TFile,
			toStatus: 'draft',
			bookPath: 'NovelA'
		});

		expect(result.success).toBe(true);
		expect(result.changed).toBe(true);
		expect(editorSaveMock).toHaveBeenCalled();
		expect(saveSnapshotMock).toHaveBeenCalledWith('NovelA/Chapter1.md', '---\nstatus: draft\n---\nFrozen chapter content');
		expect(result.snapshotRef?.key).toBe(99);
	});

	it('should NOT roll back status change when native snapshot fails and still record event', async () => {
		const mockFile = new MockTFile('Chapter1.md', 'NovelA/Chapter1.md');
		const processFrontMatter = vi.fn(async (_f: unknown, cb: (fm: Record<string, unknown>) => void) => {
			const fm: Record<string, unknown> = {};
			cb(fm);
		});

		const saveSnapshotMock = vi.fn(async () => {
			throw new Error('Native disk full or disabled');
		});

		const appendEventMock = vi.fn(async (_bookPath: string, _event: ChapterStatusChangedEvent) => {});

		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn(() => mockFile),
				read: vi.fn(async () => 'Some content')
			},
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				trigger: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: { status: 'unwritten' }
				}))
			},
			fileManager: { processFrontMatter }
		};

		const mockPlugin = {
			calculateAccurateWords: vi.fn(() => 2),
			services: {
				getOptional: vi.fn(() => ({ saveSnapshot: saveSnapshotMock }))
			}
		};

		const service = new WritingJourneyService(mockApp as unknown as App, mockPlugin as unknown as WebNovelAssistantPlugin);
		service.appendEvent = appendEventMock;

		const result = await service.changeChapterStatus({
			file: mockFile as unknown as TFile,
			toStatus: 'draft',
			bookPath: 'NovelA'
		});

		expect(result.success).toBe(true);
		expect(result.changed).toBe(true);
		expect(result.snapshotError).toBeDefined();
		expect(appendEventMock).toHaveBeenCalled();
		const recordedEvent = appendEventMock.mock.calls[0][1] as ChapterStatusChangedEvent;
		expect(recordedEvent.snapshotUnavailable).toBe(true);
		expect(recordedEvent.snapshot).toBeUndefined();
	});

	it('should deny new status work after service shutdown', async () => {
		const mockApp = { vault: { getAbstractFileByPath: vi.fn() } };
		const service = new WritingJourneyService(mockApp as unknown as App, {} as WebNovelAssistantPlugin);
		await service.destroy();

		const result = await service.changeChapterStatus({
			file: new MockTFile('C.md', 'C.md') as unknown as TFile,
			toStatus: 'draft'
		});

		expect(result.success).toBe(false);
		expect((result.error as Error).message).toMatch(/shutting down/i);
	});

	it('should no-op without writing or appending event when processFrontMatter callback sees identical status', async () => {
		const mockFile = new MockTFile('NovelA/Chapter1.md', 'NovelA/Chapter1.md');
		const appendEventMock = vi.fn(async () => {});
		let processCalled = false;
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn((p) => p === mockFile.path ? mockFile : null),
				read: vi.fn(async () => 'Some content')
			},
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				trigger: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(() => ({ frontmatter: { status: 'unwritten' } })) // Stale cache says unwritten!
			},
			fileManager: {
				processFrontMatter: vi.fn(async (_f, cb) => {
					processCalled = true;
					const fm = { status: '草稿' }; // Actual disk status is already writing!
					cb(fm);
				})
			}
		};
		const service = new WritingJourneyService(mockApp as unknown as App, {} as WebNovelAssistantPlugin);
		service.appendEvent = appendEventMock;

		const result = await service.changeChapterStatus({
			file: mockFile as unknown as TFile,
			toStatus: 'draft',
			bookPath: 'NovelA'
		});

		expect(result.success).toBe(true);
		expect(result.changed).toBe(false);
		expect(appendEventMock).not.toHaveBeenCalled();
	});

	it('should abort status mutation when editor buffer save fails', async () => {
		const mockFile = new MockTFile('NovelA/Chapter1.md', 'NovelA/Chapter1.md');
		const mockSave = vi.fn(async () => { throw new Error('Editor disk IO error'); });
		const processFrontMatter = vi.fn();
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn(() => mockFile)
			},
			workspace: {
				getLeavesOfType: vi.fn(() => [{
					view: Object.assign(new MockMarkdownView(), {
						file: mockFile,
						save: mockSave
					})
				}]),
				trigger: vi.fn()
			},
			metadataCache: { getFileCache: vi.fn(() => ({ frontmatter: {} })) },
			fileManager: { processFrontMatter }
		};
		const service = new WritingJourneyService(mockApp as unknown as App, {} as WebNovelAssistantPlugin);
		const result = await service.changeChapterStatus({
			file: mockFile as unknown as TFile,
			toStatus: 'draft'
		});

		expect(result.success).toBe(false);
		expect(processFrontMatter).not.toHaveBeenCalled();
		expect((result.error as Error).message).toMatch(/Editor disk IO error/i);
	});
	it('uses disk state when the metadata cache already reports the target state', async () => {
		const file = new MockTFile('Chapter1.md', 'NovelA/Chapter1.md');
		const append = vi.fn(async () => {});
		const app = {
			vault: { getAbstractFileByPath: () => file, read: async () => '---\nstatus: draft\n---\n正文' },
			workspace: { getLeavesOfType: () => [], trigger: vi.fn() },
			metadataCache: { getFileCache: () => ({ frontmatter: { status: 'draft' } }) },
			fileManager: { processFrontMatter: async (_file: unknown, callback: (fm: Record<string, unknown>) => void) => callback({ status: 'unwritten' }) }
		};
		const service = new WritingJourneyService(app as unknown as import('obsidian').App, {} as import('../src/types/plugin').WebNovelAssistantPlugin);
		vi.spyOn(service, 'appendEvent').mockImplementation(append);
		const result = await service.changeChapterStatus({ file: file as unknown as TFile, toStatus: 'draft', bookPath: 'NovelA' });
		expect(result.changed).toBe(true);
		expect(result.fromStatus).toBe('unwritten');
		expect(append).toHaveBeenCalledOnce();
	});

	it('refuses to overwrite divergent buffers in two open editors', async () => {
		const file = new MockTFile('Chapter1.md', 'NovelA/Chapter1.md');
		const save = vi.fn(async () => {});
		const mutate = vi.fn();
		const app = {
			vault: { getAbstractFileByPath: () => file },
			workspace: { getLeavesOfType: () => ['甲', '乙'].map(text => ({ view: Object.assign(new MockMarkdownView(), { file, save, getViewData: () => text }) })) },
			fileManager: { processFrontMatter: mutate }
		};
		const service = new WritingJourneyService(app as unknown as import('obsidian').App, {} as import('../src/types/plugin').WebNovelAssistantPlugin);
		const result = await service.changeChapterStatus({ file: file as unknown as TFile, toStatus: 'draft' });
		expect(result.success).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(mutate).not.toHaveBeenCalled();
	});

	it('verifies content again when Obsidian updates file stats during the first post-status read', async () => {
		const file = Object.assign(new MockTFile('Chapter1.md', 'NovelA/Chapter1.md'), { stat: { mtime: 1, size: 40 } });
		const text = '---\nstatus: draft\n---\n正文';
		const read = vi.fn(async () => { file.stat.mtime = 2; return text; });
		const save = vi.fn(async () => ({ provider: 'file-recovery' as const, deviceId: 'd', dbName: 'b', key: 1, path: file.path, ts: 1000, digest: 'a'.repeat(64) }));
		const app = {
			vault: { getAbstractFileByPath: () => file, read },
			workspace: { getLeavesOfType: () => [], trigger: vi.fn() },
			fileManager: { processFrontMatter: async (_file: unknown, callback: (fm: Record<string, unknown>) => void) => callback({ status: 'unwritten' }) }
		};
		const plugin = { services: { getOptional: () => ({ saveSnapshot: save }) } };
		const service = new WritingJourneyService(app as unknown as import('obsidian').App, plugin as unknown as import('../src/types/plugin').WebNovelAssistantPlugin);
		vi.spyOn(service, 'appendEvent').mockResolvedValue();
		const result = await service.changeChapterStatus({ file: file as unknown as TFile, toStatus: 'draft', bookPath: 'NovelA' });
		expect(result.snapshotRef?.key).toBe(1);
		expect(read).toHaveBeenCalledTimes(2);
	});

});
