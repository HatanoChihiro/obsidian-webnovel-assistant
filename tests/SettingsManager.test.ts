import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_SEARCH_CATALOGUE, searchSettingsCatalogue, isEntryAvailableOnPlatform } from '../src/services/SettingsSearchService';
import zhCN from '../src/i18n/zh-CN.json';
import zhTW from '../src/i18n/zh-TW.json';
import en from '../src/i18n/en.json';
import { SettingsManager } from '../src/core/SettingsManager';
import { DEFAULT_SETTINGS } from '../src/constants';
import { parseDirectorySettingLines, formatDirectorySettingLines } from '../src/utils/settingHelpers';
import { sanitizeWorkbenchSearchHistory, rememberWorkbenchSearchHistory } from '../src/services/WorkbenchFilterIndex';
import { isLorePopoverEnabled } from '../src/utils/platform';
import { Notice, Platform } from 'obsidian';
import { mockNoticeMessages, resetNoticeMessages } from './mocks/obsidian';
import { configurePluginNotices, showPluginNotice } from '../src/services/PluginNoticeService';

beforeAll(() => {
	(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
});

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

describe('SettingsManager', () => {
	it.each([undefined, true, false, 'invalid'])('loads and persists the plugin notification preference (%s)', async value => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = { loadData: vi.fn().mockResolvedValue({ showNotices: value }), saveData } as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();
		expect(loaded.showNotices).toBe(value === true);
		loaded.showNotices = !loaded.showNotices;
		await manager.saveSettings();
		await manager.flush();
		expect(saveData).toHaveBeenLastCalledWith(expect.objectContaining({ showNotices: loaded.showNotices }));
		loaded.showNotices = false;
		await manager.saveSettings();
		await manager.flush();
		expect(saveData).toHaveBeenLastCalledWith(expect.objectContaining({ showNotices: false }));
	});

	it('gates only plugin notices, applies changes immediately and releases the host on cleanup', () => {
		expect(showPluginNotice('Disabled by default')).toBeUndefined();
		let enabled = false;
		const release = configurePluginNotices(() => enabled);
		resetNoticeMessages();
		try {
			expect(showPluginNotice('Hidden progress', 0)).toBeUndefined();
			new Notice('Native notice remains visible');
			expect(mockNoticeMessages).toEqual(['Native notice remains visible']);
			enabled = true;
			const progress = showPluginNotice('Visible progress', 0);
			expect(progress).toBeInstanceOf(Notice);
			expect(progress).toMatchObject({ message: 'Visible progress', timeout: 0 });
			progress?.hide();
			enabled = false;
			expect(showPluginNotice('Hidden error')).toBeUndefined();
			enabled = true;
			expect(showPluginNotice('Visible again', 8000)).toMatchObject({ timeout: 8000 });
			release();
			expect(showPluginNotice('Late notice after unload')).toBeUndefined();
			expect(mockNoticeMessages).toEqual(['Native notice remains visible', 'Visible progress', 'Visible again']);
		} finally {
			release();
			resetNoticeMessages();
		}
	});

	it('exposes the notification toggle in general settings search on every platform', () => {
		const entry = SETTINGS_SEARCH_CATALOGUE.find(item => item.titleKey === 'setting.show-notices');
		expect(entry?.category).toBe('general');
		expect(entry?.platform).toBe('all');
	});

	it.each([false, true])('uses one explicit lore switch on every platform while preserving legacy behavior (touch=%s)', touch => {
		const descriptor = Object.getOwnPropertyDescriptor(Platform, 'isMobile')!;
		Object.defineProperty(Platform, 'isMobile', { ...descriptor, value: touch });
		try {
			expect(isLorePopoverEnabled({ enableMobileLorePopover: false })).toBe(!touch);
			expect(isLorePopoverEnabled({ enableMobileLorePopover: true })).toBe(true);
			expect(isLorePopoverEnabled({ enableLorePopover: false, enableMobileLorePopover: true })).toBe(false);
			expect(isLorePopoverEnabled({ enableLorePopover: true, enableMobileLorePopover: false })).toBe(true);
		} finally { Object.defineProperty(Platform, 'isMobile', descriptor); }
	});
	it('writes default values back for invalid nested and top-level settings', async () => {
		const invalid = cloneDefaults();
		invalid.defaultGoal = -1;
		invalid.obs.obsPort = 99999;
		invalid.immersive.pomodoroInterval = 10;
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			loadData: vi.fn().mockResolvedValue(invalid),
			saveData
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());

		const loaded = await manager.loadSettings();

		expect(loaded.defaultGoal).toBe(DEFAULT_SETTINGS.defaultGoal);
		expect(loaded.obs.obsPort).toBe(DEFAULT_SETTINGS.obs.obsPort);
		expect(loaded.immersive.pomodoroInterval).toBe(DEFAULT_SETTINGS.immersive.pomodoroInterval);
		expect(loaded.obs.obsShowSessionSpeed).toBe(false);
		expect(loaded.immersive.immersiveShowSessionSpeed).toBe(false);
		expect(manager.validateSettings(loaded).valid).toBe(true);
		expect(saveData).toHaveBeenCalled();
	});

	it.each([false, true])('retires the mobile focus timer opt-in setting on load and save (legacy=%s)', async enabled => {
		const legacy = { ...cloneDefaults(), enableMobileFocusTimer: enabled };
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = { loadData: vi.fn().mockResolvedValue(legacy), saveData } as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();
		expect(loaded).not.toHaveProperty('enableMobileFocusTimer');
		expect(loaded.idleTimeoutThreshold).toBe(DEFAULT_SETTINGS.idleTimeoutThreshold);
		loaded.defaultGoal = DEFAULT_SETTINGS.defaultGoal + 1;
		await manager.saveSettings();
		await manager.flush();
		expect(saveData).toHaveBeenCalled();
		expect(saveData.mock.calls.at(-1)![0]).not.toHaveProperty('enableMobileFocusTimer');
	});

	it('merges partial updates into current settings without resetting siblings', async () => {
		const settings = cloneDefaults();
		settings.obs.obsPort = 25000;
		settings.obs.obsShowFocusTime = false;
		settings.workspaceFolders = ['Novel'];
		const plugin = {
			settings,
			loadData: vi.fn().mockResolvedValue(settings),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());

		await manager.updateSettings({ obs: { ...settings.obs, obsPort: 26000 } });

		expect((plugin as unknown as { settings: typeof settings }).settings.obs.obsPort).toBe(26000);
		expect((plugin as unknown as { settings: typeof settings }).settings.obs.obsShowFocusTime).toBe(false);
		expect((plugin as unknown as { settings: typeof settings }).settings.workspaceFolders).toEqual(['Novel']);
		expect((plugin as unknown as { settings: typeof settings }).settings.obs.obsShowSessionSpeed).toBe(false);
		expect((plugin as unknown as { settings: typeof settings }).settings.immersive.immersiveShowSessionSpeed).toBe(false);
	});

	it('fills and clamps the persisted typography body font size', async () => {
		const missing = cloneDefaults();
		delete (missing.typography as unknown as { enableBodyFontSize?: boolean }).enableBodyFontSize;
		delete (missing.typography as unknown as { bodyFontSize?: number }).bodyFontSize;
		delete (missing.typography as unknown as { applyToCards?: boolean }).applyToCards;
		delete (missing.typography as unknown as { paragraphSpacingBefore?: string }).paragraphSpacingBefore;
		missing.typography.paragraphSpacing = '0em';
		const missingPlugin = {
			loadData: vi.fn().mockResolvedValue(missing),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const missingManager = new SettingsManager(missingPlugin, cloneDefaults());
		const loadedMissing = await missingManager.loadSettings();
		expect(loadedMissing.typography.enableBodyFontSize).toBe(false);
		expect(loadedMissing.typography.bodyFontSize).toBe(16);
		expect(loadedMissing.typography.applyToCards).toBe(false);
		expect(loadedMissing.typography.paragraphSpacingBefore).toBe('0em');
		expect(loadedMissing.typography.paragraphSpacing).toBe('0em');

		const oversized = cloneDefaults();
		oversized.typography.bodyFontSize = 48;
		const oversizedPlugin = {
			loadData: vi.fn().mockResolvedValue(oversized),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const oversizedManager = new SettingsManager(oversizedPlugin, cloneDefaults());
		const loadedOversized = await oversizedManager.loadSettings();
		expect(loadedOversized.typography.bodyFontSize).toBe(32);
	});

	it('fills default false for missing proofreading and typography enableGlobal settings', async () => {
		const legacy = cloneDefaults();
		delete (legacy.proofreading as unknown as { enableGlobal?: boolean }).enableGlobal;
		delete (legacy.typography as unknown as { enableGlobal?: boolean }).enableGlobal;
		const plugin = {
			loadData: vi.fn().mockResolvedValue(legacy),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();

		expect(loaded.proofreading.enableGlobal).toBe(false);
		expect(loaded.typography.enableGlobal).toBe(false);
	});

	it('defaults legacy settings without a footnote policy to excluding footnotes', async () => {
		const legacy = cloneDefaults();
		delete (legacy as unknown as { includeFootnotes?: boolean }).includeFootnotes;
		const plugin = {
			loadData: vi.fn().mockResolvedValue(legacy),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());

		const loaded = await manager.loadSettings();

		expect(loaded.includeFootnotes).toBe(false);
	});

	it('provides disabled default values for missing editorTypewriter settings on upgrade', async () => {
		const legacy = cloneDefaults();
		delete (legacy as unknown as { editorTypewriter?: unknown }).editorTypewriter;
		const plugin = {
			loadData: vi.fn().mockResolvedValue(legacy),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();

		expect(loaded.editorTypewriter).toEqual({
			enabled: false,
			centerOffset: 0,
			unfocusedOpacity: 0.4
		});
	});

	it('normalizes loreTemplateHistory on settings load and migration, dropping invalid paths, deduplicating, and capping at 10', async () => {
		const legacy = cloneDefaults();
		delete (legacy as unknown as { loreTemplateHistory?: unknown }).loreTemplateHistory;
		const plugin = {
			loadData: vi.fn().mockResolvedValue(legacy),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loadedMissing = await manager.loadSettings();
		expect(loadedMissing.loreTemplateHistory).toEqual([]);

		const invalid = cloneDefaults();
		invalid.loreTemplateHistory = [
			'C:/Abs.md',
			'../Escape.md',
			123,
			'Templates/Hero.md',
			'Templates//Hero.md',
			'Templates/NonMarkdown.txt',
			...Array.from({ length: 15 }, (_, i) => 'Templates/Tpl' + i + '.md'),
		];
		const invalidPlugin = {
			loadData: vi.fn().mockResolvedValue(invalid),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const invalidManager = new SettingsManager(invalidPlugin, cloneDefaults());
		const loadedInvalid = await invalidManager.loadSettings();
		expect(loadedInvalid.loreTemplateHistory.length).toBe(10);
		expect(loadedInvalid.loreTemplateHistory[0]).toBe('Templates/Hero.md');
		expect(loadedInvalid.loreTemplateHistory[1]).toBe('Templates/Tpl0.md');
		expect(loadedInvalid.loreTemplateHistory).not.toContain('C:/Abs.md');
		expect(loadedInvalid.loreTemplateHistory).not.toContain('../Escape.md');
		expect(loadedInvalid.loreTemplateHistory).not.toContain('Templates/NonMarkdown.txt');
	});

	it('keeps canonical history and notes while removing obsolete persistence keys', async () => {
		const persisted = {
			...cloneDefaults(),
			historyData: {
				'2026-08-24': { focusMs: 10, slackMs: 20, addedWords: 30 }
			},
			notesData: [],
			dailyHistory: { stale: true },
			openNotes: [{ stale: true }],
			cacheData: { stale: true }
		};
		const plugin = {
			loadData: vi.fn().mockResolvedValue(persisted),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());

		const loaded = await manager.loadSettings();

		expect(loaded.historyData).toEqual(persisted.historyData);
		expect(loaded.notesData).toEqual([]);
		expect(loaded).not.toHaveProperty('dailyHistory');
		expect(loaded).not.toHaveProperty('openNotes');
		expect(loaded).not.toHaveProperty('cacheData');
	});

	it('serializes each settings snapshot before the queued write begins', async () => {
		let releaseFirst!: () => void;
		const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
		const saved: Array<Record<string, unknown>> = [];
		const settings = cloneDefaults();
		const saveData = vi.fn(async (snapshot: Record<string, unknown>) => {
			saved.push(snapshot);
			if (saved.length === 1) await firstWrite;
		});
		const plugin = {
			settings,
			loadData: vi.fn().mockResolvedValue(settings),
			saveData
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		await manager.loadSettings();

		settings.defaultGoal = 1000;
		const firstSave = manager.saveSettings();
		await new Promise<void>(resolve => queueMicrotask(resolve));
		settings.defaultGoal = 2000;
		const secondSave = manager.saveSettings();
		releaseFirst();
		await Promise.all([firstSave, secondSave]);

		expect(saved).toHaveLength(2);
		expect(saved[0].defaultGoal).toBe(1000);
		expect(saved[1].defaultGoal).toBe(2000);
	});

	it('validates and repairs invalid persisted immersive pomodoro interval settings to default', async () => {
		const outOfRange = cloneDefaults();
		outOfRange.immersive.pomodoroInterval = 240;
		const plugin = {
			loadData: vi.fn().mockResolvedValue(outOfRange),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();
		expect(loaded.immersive.pomodoroInterval).toBe(30);

		await expect(manager.updateSettings({
			immersive: { ...loaded.immersive, pomodoroInterval: 15 }
		})).rejects.toThrow();

		await expect(manager.updateSettings({
			immersive: { ...loaded.immersive, pomodoroInterval: 20 }
		})).resolves.not.toThrow();
	});

	it('preserves undefined enableLorePopover for legacy configurations across unrelated saves', async () => {
		const legacy = cloneDefaults();
		delete (legacy as Record<string, unknown>).enableLorePopover;
		legacy.enableMobileLorePopover = true;

		const state: { savedData: Record<string, unknown> | null } = { savedData: null };
		const plugin = {
			settings: legacy,
			loadData: vi.fn(async () => state.savedData ?? legacy),
			saveData: vi.fn(async (data: unknown) => {
				state.savedData = JSON.parse(JSON.stringify(data));
			})
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();

		expect(loaded.enableLorePopover).toBeUndefined();
		expect(loaded.enableMobileLorePopover).toBe(true);

		// Save unrelated setting
		await manager.updateSettings({ defaultGoal: 5000 });
		expect(state.savedData?.enableLorePopover).toBeUndefined();
		expect(state.savedData?.defaultGoal).toBe(5000);

		// Explicit boolean toggle overrides legacy mode
		await manager.updateSettings({ enableLorePopover: false });
		expect(state.savedData?.enableLorePopover).toBe(false);

		const reloaded = await manager.loadSettings();
		expect(reloaded.enableLorePopover).toBe(false);
	});

	it('defaults timeline and foreshadowing editor references to false and round-trips updates', async () => {
		const legacy = cloneDefaults();
		delete (legacy.timeline as Record<string, unknown>).showEditorReferences;
		delete (legacy.foreshadowing as Record<string, unknown>).showEditorReferences;

		const state: { savedData: Record<string, unknown> | null } = { savedData: null };
		const plugin = {
			settings: legacy,
			loadData: vi.fn(async () => state.savedData ?? legacy),
			saveData: vi.fn(async (data: unknown) => {
				state.savedData = JSON.parse(JSON.stringify(data));
			})
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();

		expect(loaded.timeline.showEditorReferences).toBe(false);
		expect(loaded.foreshadowing.showEditorReferences).toBe(false);

		await manager.updateSettings({
			timeline: { ...loaded.timeline, showEditorReferences: true },
			foreshadowing: { ...loaded.foreshadowing, showEditorReferences: true }
		});

		expect(state.savedData?.timeline).toEqual(expect.objectContaining({ showEditorReferences: true }));
		expect(state.savedData?.foreshadowing).toEqual(expect.objectContaining({ showEditorReferences: true }));
	});

	describe('parseDirectorySettingLines & formatDirectorySettingLines', () => {
		it('parses line-delimited directory strings preserving ASCII and fullwidth commas', () => {
			const input = '  Novels, Drafts/Volume 1  \r\n\n  小说，正文/第一卷  \r\nDrafts/Notes, Ideas\n';
			const parsed = parseDirectorySettingLines(input);

			expect(parsed).toEqual([
				'Novels, Drafts/Volume 1',
				'小说，正文/第一卷',
				'Drafts/Notes, Ideas'
			]);
		});

		it('deduplicates lines while maintaining first-workspace order and skips empty lines', () => {
			const input = '\n  Workspace A  \nWorkspace B\n  Workspace A  \n\nWorkspace C\n';
			const parsed = parseDirectorySettingLines(input);

			expect(parsed).toEqual([
				'Workspace A',
				'Workspace B',
				'Workspace C'
			]);
		});

		it('formats directory arrays into newline-delimited strings and round-trips correctly', () => {
			const folders = [
				'Novels, Drafts',
				'第一卷，起承转合',
				'Folder [Special] - "Quotes"'
			];
			const formatted = formatDirectorySettingLines(folders);
			expect(formatted).toBe('Novels, Drafts\n第一卷，起承转合\nFolder [Special] - "Quotes"');

			const roundTripped = parseDirectorySettingLines(formatted);
			expect(roundTripped).toEqual(folders);
		});

		it('persists and loads comma-bearing workspaceFolders through SettingsManager', async () => {
			const settings = cloneDefaults();
			const commaFolders = ['Novels, Drafts/Book 1', '作品，草稿/卷一'];
			settings.workspaceFolders = commaFolders;
			settings.strictChapterExceptions = ['Exceptions, Review/Draft'];

			let persistedData: unknown = null;
			const plugin = {
				settings,
				loadData: vi.fn(async () => persistedData ?? settings),
				saveData: vi.fn(async (data: unknown) => { persistedData = JSON.parse(JSON.stringify(data)); })
			} as never;

			const manager = new SettingsManager(plugin, cloneDefaults());
			await manager.saveSettings();

			const reloaded = await manager.loadSettings();
			expect(reloaded.workspaceFolders).toEqual(commaFolders);
			expect(reloaded.strictChapterExceptions).toEqual(['Exceptions, Review/Draft']);
		});
	});

	it('supplies default #202B24 for missing eyeCareDarkColor while preserving custom eyeCareColor', async () => {
		const legacy = cloneDefaults();
		delete (legacy as unknown as { eyeCareDarkColor?: string }).eyeCareDarkColor;
		legacy.eyeCareColor = '#E0F2F1';
		const plugin = {
			loadData: vi.fn().mockResolvedValue(legacy),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());
		const loaded = await manager.loadSettings();

		expect(loaded.eyeCareColor).toBe('#E0F2F1');
		expect(loaded.eyeCareDarkColor).toBe('#202B24');
	});

	it('persists and round-trips independent eyeCareColor and eyeCareDarkColor values', async () => {
		const settings = cloneDefaults();
		settings.eyeCareColor = '#FDF6E3';
		settings.eyeCareDarkColor = '#1D2621';

		let persistedData: unknown = null;
		const plugin = {
			settings,
			loadData: vi.fn(async () => persistedData ?? settings),
			saveData: vi.fn(async (data: unknown) => { persistedData = JSON.parse(JSON.stringify(data)); })
		} as never;

		const manager = new SettingsManager(plugin, cloneDefaults());
		await manager.saveSettings();

		const reloaded = await manager.loadSettings();
		expect(reloaded.eyeCareColor).toBe('#FDF6E3');
		expect(reloaded.eyeCareDarkColor).toBe('#1D2621');
	});

	describe('workbenchSearchHistory', () => {
		it('defaults workbenchSearchHistory to an empty array', () => {
			expect((DEFAULT_SETTINGS as unknown as { workbenchSearchHistory: unknown }).workbenchSearchHistory).toEqual([]);
		});

		it('sanitizes and bounds workbenchSearchHistory to 20 unique normalized entries', () => {
			const raw = [
				'  tag1  ',
				'Tag1',
				'tag2',
				'  ',
				null,
				123,
				...Array.from({ length: 25 }, (_, i) => `kw-${i}`)
			];
			const sanitized = sanitizeWorkbenchSearchHistory(raw);
			expect(sanitized[0]).toBe('tag1');
			expect(sanitized[1]).toBe('tag2');
			expect(sanitized).toHaveLength(20);
			expect(sanitized.filter(s => s.toLowerCase() === 'tag1')).toHaveLength(1);
		});

		it('remembers new keyword at the front and dedupes by normalized text without altering display text', () => {
			const history = ['tag1', 'tag2'];
			const next = rememberWorkbenchSearchHistory(history, 'TAG1');
			expect(next).toEqual(['TAG1', 'tag2']);
		});

		it('persists and round-trips workbenchSearchHistory via SettingsManager', async () => {
			const settings = cloneDefaults();
			(settings as unknown as { workbenchSearchHistory: string[] }).workbenchSearchHistory = ['keywordA', 'keywordB'];

			let persistedData: unknown = null;
			const plugin = {
				settings,
				loadData: vi.fn(async () => persistedData ?? settings),
				saveData: vi.fn(async (data: unknown) => { persistedData = JSON.parse(JSON.stringify(data)); })
			} as never;

			const manager = new SettingsManager(plugin, cloneDefaults());
			await manager.saveSettings();

			const reloaded = await manager.loadSettings();
			expect((reloaded as unknown as { workbenchSearchHistory: string[] }).workbenchSearchHistory).toEqual(['keywordA', 'keywordB']);
		});
	});

	describe('immersive manuscript settings compatibility and sanitization', () => {
		it('defaults manuscriptModeEnabled to false for legacy settings and preserves existing values', async () => {
			const legacy = cloneDefaults();
			delete (legacy.immersive as Record<string, unknown>).manuscriptModeEnabled;
			delete (legacy.immersive as Record<string, unknown>).lastManuscriptPosition;
			delete (legacy.immersive as Record<string, unknown>).workManuscriptPositions;

			const plugin = {
				loadData: vi.fn().mockResolvedValue(legacy),
				saveData: vi.fn().mockResolvedValue(undefined)
			} as never;
			const manager = new SettingsManager(plugin, cloneDefaults());
			const loaded = await manager.loadSettings();

			expect(loaded.immersive.manuscriptModeEnabled).toBe(false);
		});

		it('sanitizes invalid persisted manuscript paths and cursor/scroll numbers on load', async () => {
			const dirty = cloneDefaults();
			(dirty.immersive as Record<string, unknown>).manuscriptModeEnabled = true;
			(dirty.immersive as Record<string, unknown>).lastManuscriptPosition = {
				filePath: '../escape/第1章.md',
				workPath: 'Novels/Book',
				cursorLine: -5,
				cursorCh: Number.NaN
			};
			(dirty.immersive as Record<string, unknown>).workManuscriptPositions = {
				'Novels/Book': {
					filePath: 'Novels/Book//第2章.md',
					workPath: 'Novels/Book/',
					cursorLine: 12.9,
					cursorCh: -3,
					chapterRelativeScroll: -20,
					anchorLine: 5.7
				},
				'Novels/Bad': {
					filePath: 'C:/Secret/note.txt',
					workPath: 'Novels/Bad',
					cursorLine: 1,
					cursorCh: 1
				}
			};

			const plugin = {
				loadData: vi.fn().mockResolvedValue(dirty),
				saveData: vi.fn().mockResolvedValue(undefined)
			} as never;
			const manager = new SettingsManager(plugin, cloneDefaults());
			const loaded = await manager.loadSettings();

			expect(loaded.immersive.manuscriptModeEnabled).toBe(true);
			expect(loaded.immersive.lastManuscriptPosition).toBeUndefined();
			expect(loaded.immersive.workManuscriptPositions?.['Novels/Bad']).toBeUndefined();
			expect(loaded.immersive.workManuscriptPositions?.['Novels/Book']).toEqual({
				filePath: 'Novels/Book/第2章.md',
				workPath: 'Novels/Book',
				cursorLine: 12,
				cursorCh: 0,
				anchorLine: 5
			});
		});
	});

	describe('mobile immersive auxiliary panel settings sanitization', () => {
		it('sanitizes malformed mobileAuxPanel settings and rejects chapter-list/workbench without affecting desktop slots', async () => {
			const dirty = cloneDefaults();
			dirty.immersive.immersiveLeftSlots = ['immersive-chapter-list-view'];
			dirty.immersive.immersiveRightSlots = ['reference-view'];
			(dirty.immersive as Record<string, unknown>).mobileAuxPanel = {
				viewType: 'immersive-chapter-list-view',
				isOpen: 'yes',
				isMinimized: 1,
				isLocked: null,
				isDocked: 'yes',
				x: Number.NaN,
				y: -50,
				width: 10,
				height: Number.POSITIVE_INFINITY
			};

			const plugin = {
				loadData: vi.fn().mockResolvedValue(dirty),
				saveData: vi.fn().mockResolvedValue(undefined)
			} as never;
			const manager = new SettingsManager(plugin, cloneDefaults());
			const loaded = await manager.loadSettings();

			expect(loaded.immersive.mobileAuxPanel).toBeDefined();
			expect(loaded.immersive.mobileAuxPanel?.viewType).not.toBe('immersive-chapter-list-view');
			expect(loaded.immersive.mobileAuxPanel?.isOpen).toBe(false);
			expect(loaded.immersive.mobileAuxPanel?.isMinimized).toBe(false);
			expect(loaded.immersive.mobileAuxPanel?.isLocked).toBe(false);
			expect(loaded.immersive.mobileAuxPanel?.isDocked).toBe(false);
			expect(Number.isFinite(loaded.immersive.mobileAuxPanel?.x)).toBe(true);
			expect(loaded.immersive.mobileAuxPanel?.y).toBeGreaterThanOrEqual(0);
			expect(loaded.immersive.mobileAuxPanel?.width).toBeGreaterThanOrEqual(220);
			expect(loaded.immersive.mobileAuxPanel?.height).toBeGreaterThanOrEqual(160);
			// Desktop slots stay untouched
			expect(loaded.immersive.immersiveLeftSlots).toEqual(['immersive-chapter-list-view']);
			expect(loaded.immersive.immersiveRightSlots).toEqual(['reference-view']);
		});

		it('migrates legacy auxiliary view IDs and round-trips valid mobileAuxPanel state', async () => {
			const legacy = cloneDefaults();
			(legacy.immersive as Record<string, unknown>).mobileAuxPanel = {
				viewType: 'timeline-view',
				isOpen: true,
				isMinimized: true,
				isLocked: true,
				isDocked: true,
				x: 42.6,
				y: 88.2,
				width: 340,
				height: 310
			};

			const plugin = {
				loadData: vi.fn().mockResolvedValue(legacy),
				saveData: vi.fn().mockResolvedValue(undefined)
			} as never;
			const manager = new SettingsManager(plugin, cloneDefaults());
			const loaded = await manager.loadSettings();

			expect(loaded.immersive.mobileAuxPanel).toEqual({
				viewType: 'wn-timeline-view',
				isOpen: true,
				isMinimized: true,
				isLocked: true,
				isDocked: true,
				x: 43,
				y: 88,
				width: 340,
				height: 310
			});
		});
	});
});


describe('settings search', () => {
	const translateWith = (dictionary: Record<string, string>) => (key: string) => dictionary[key] ?? key;

	it('covers every fixed setting label and keeps catalogue keys valid in all locales', () => {
		const source = readFileSync('src/ui/SettingsTab.ts', 'utf8').split('export class AccurateCountSettingTab')[1];
		const names = [...source.matchAll(/\.setName\(t\('([^']+)'/g)].map(match => match[1]);
		const titles = new Set(SETTINGS_SEARCH_CATALOGUE.map(entry => entry.titleKey));
		expect(names.filter(key => !titles.has(key))).toEqual([]);
		expect(new Set(SETTINGS_SEARCH_CATALOGUE.map(entry => entry.id)).size).toBe(SETTINGS_SEARCH_CATALOGUE.length);
		for (const dictionary of [zhCN, zhTW, en]) {
			const keys = dictionary as Record<string, string>;
			for (const entry of SETTINGS_SEARCH_CATALOGUE) {
				for (const key of [entry.titleKey, entry.categoryNameKey, ...entry.descKeys, ...(entry.fallbackKeys ?? []), ...(entry.sectionKey ? [entry.sectionKey] : [])]) {
					expect(keys[key], key).toBeTruthy();
				}
			}
		}
	});

	it('keeps platform filters consistent for desktop, phone and tablet', () => {
		for (const tier of ['desktop', 'mobile', 'tablet'] as const) {
			const entries = SETTINGS_SEARCH_CATALOGUE.filter(entry => isEntryAvailableOnPlatform(entry, tier));
			expect(entries.some(entry => entry.category === 'immersive')).toBe(true);
			expect(entries.some(entry => entry.titleKey === 'setting.immersive-layout-builder')).toBe(tier === 'desktop');
			expect(entries.some(entry => entry.titleKey === 'setting.immersive-dashboard-toggles')).toBe(tier === 'desktop');
			expect(entries.some(entry => entry.titleKey === 'setting.immersive-typewriter-enable')).toBe(true);
			expect(entries.some(entry => entry.titleKey === 'setting.immersive-manuscript-mode')).toBe(true);
			expect(entries.some(entry => entry.category === 'obs')).toBe(tier === 'desktop');
			expect(entries.some(entry => entry.titleKey === 'setting.enable-mobile-focus-timer')).toBe(false);
			expect(entries.some(entry => entry.titleKey === 'setting.idle-threshold')).toBe(true);
			for (const entry of entries) {
				for (const key of entry.fallbackKeys ?? []) {
					expect(entries.some(parent => parent.category === entry.category && parent.titleKey === key), entry.id).toBe(true);
				}
			}
		}
	});

	it('ranks an exact setting title first and finds descriptions with all search tokens', () => {
		const translate = translateWith(en);
		const title = en['setting.sticky-note-autosave'];
		const results = searchSettingsCatalogue(title.toUpperCase(), { tier: 'desktop', translate });
		expect(results[0].entry.titleKey).toBe('setting.sticky-note-autosave');
		const tokens = searchSettingsCatalogue('  long   PROGRESS  ', { tier: 'desktop', translate: key =>
			key === 'setting.sticky-note-autosave-desc' ? 'Long writing progress is saved.' : key === 'setting.sticky-note-autosave' ? 'Auto save' : '' });
		expect(tokens.map(result => result.entry.titleKey)).toEqual(['setting.sticky-note-autosave']);
		expect(searchSettingsCatalogue('   ', { tier: 'desktop', translate })).toEqual([]);
		expect(searchSettingsCatalogue('unmatched-absent-setting', { tier: 'desktop', translate })).toEqual([]);
	});

	it('finds disabled child options and their enabling switches in every locale', () => {
		for (const dictionary of [zhCN, zhTW, en]) {
			const results = searchSettingsCatalogue(dictionary['setting.typography-body-font-size'], { tier: 'desktop', translate: translateWith(dictionary) });
			const child = results.find(result => result.entry.titleKey === 'setting.typography-body-font-size');
			expect(child?.entry.fallbackKeys).toEqual(['setting.typography-enable-body-font-size', 'setting.typography-master-toggle']);
		}
	});

	it('keeps identically named settings in their correct device category', () => {
		for (const tier of ['desktop', 'mobile', 'tablet'] as const) {
			const result = searchSettingsCatalogue(zhCN['setting.idle-threshold'], { tier, translate: translateWith(zhCN) })
				.filter(match => match.entry.titleKey === 'setting.idle-threshold');
			expect(result).toHaveLength(1);
			expect(result[0].entry.category).toBe(tier === 'desktop' ? 'obs' : 'general');
		}
	});
	it('includes both light and dark eye-care background color settings in the search catalogue under eyecare-mode', () => {
		const lightEntry = SETTINGS_SEARCH_CATALOGUE.find(entry => entry.titleKey === 'setting.eyecare-bg-color');
		const darkEntry = SETTINGS_SEARCH_CATALOGUE.find(entry => entry.titleKey === 'setting.eyecare-dark-bg-color');

		expect(lightEntry).toBeDefined();
		expect(lightEntry?.category).toBe('typography');
		expect(lightEntry?.sectionKey).toBe('setting.eyecare-mode');

		expect(darkEntry).toBeDefined();
		expect(darkEntry?.category).toBe('typography');
		expect(darkEntry?.sectionKey).toBe('setting.eyecare-mode');

		const translate = translateWith(en);
		const searchResults = searchSettingsCatalogue('Dark Theme', { tier: 'desktop', translate });
		expect(searchResults.some(result => result.entry.titleKey === 'setting.eyecare-dark-bg-color')).toBe(true);
	});

	it('includes all-platform enable-lore-popover and editor reference toggles in search catalogue', () => {
		const loreEntry = SETTINGS_SEARCH_CATALOGUE.find(entry => entry.titleKey === 'setting.enable-lore-popover');
		const tlEntry = SETTINGS_SEARCH_CATALOGUE.find(entry => entry.titleKey === 'setting.timeline-show-editor-references');
		const fsEntry = SETTINGS_SEARCH_CATALOGUE.find(entry => entry.titleKey === 'setting.foreshadowing-show-editor-references');

		expect(loreEntry).toBeDefined();
		expect(loreEntry?.category).toBe('creative');
		expect(loreEntry?.platform).toBe('all');

		expect(tlEntry).toBeDefined();
		expect(tlEntry?.category).toBe('creative');
		expect(tlEntry?.platform).toBe('all');

		expect(fsEntry).toBeDefined();
		expect(fsEntry?.category).toBe('creative');
		expect(fsEntry?.platform).toBe('all');

		// The old visible mobile-only setting should no longer exist in the search catalogue
		const oldMobileEntry = SETTINGS_SEARCH_CATALOGUE.find(entry => entry.titleKey === 'setting.enable-mobile-lore-popover');
		expect(oldMobileEntry).toBeUndefined();
	});

	it('includes immersive manuscript mode toggle in search catalogue under immersive for all platforms', () => {
		const entry = SETTINGS_SEARCH_CATALOGUE.find(item => item.titleKey === 'setting.immersive-manuscript-mode');
		expect(entry).toBeDefined();
		expect(entry?.category).toBe('immersive');
		expect(entry?.platform).toBe('all');
	});

	it('exposes Pomodoro and mobile auxiliary panel settings in mobile/tablet search catalogue', () => {
		for (const key of [
			'setting.immersive-pomodoro-title',
			'setting.immersive-pomodoro-enabled',
			'setting.immersive-pomodoro-interval'
		]) {
			const entry = SETTINGS_SEARCH_CATALOGUE.find(item => item.titleKey === key);
			expect(entry, key).toBeDefined();
			expect(isEntryAvailableOnPlatform(entry!, 'desktop'), `${key} desktop`).toBe(true);
			expect(isEntryAvailableOnPlatform(entry!, 'mobile'), `${key} mobile`).toBe(true);
			expect(isEntryAvailableOnPlatform(entry!, 'tablet'), `${key} tablet`).toBe(true);
		}

		for (const key of [
			'setting.immersive-mobile-aux-title',
			'setting.immersive-mobile-aux-enabled'
		]) {
			const entry = SETTINGS_SEARCH_CATALOGUE.find(item => item.titleKey === key);
			expect(entry, key).toBeDefined();
			expect(entry?.category).toBe('immersive');
			expect(isEntryAvailableOnPlatform(entry!, 'desktop'), `${key} desktop`).toBe(false);
			expect(isEntryAvailableOnPlatform(entry!, 'mobile'), `${key} mobile`).toBe(true);
			expect(isEntryAvailableOnPlatform(entry!, 'tablet'), `${key} tablet`).toBe(true);
		}

		for (const key of ['setting.immersive-mobile-aux-view', 'immersive.mobile-aux-lock']) {
			expect(SETTINGS_SEARCH_CATALOGUE.some(entry => entry.titleKey === key)).toBe(false);
		}

		const mobilePomodoroResults = searchSettingsCatalogue(en['setting.immersive-pomodoro-enabled'], {
			tier: 'mobile',
			translate: translateWith(en)
		});
		expect(mobilePomodoroResults.some(r => r.entry.titleKey === 'setting.immersive-pomodoro-enabled')).toBe(true);
	});
});
