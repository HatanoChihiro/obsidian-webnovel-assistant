import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_SEARCH_CATALOGUE, searchSettingsCatalogue, isEntryAvailableOnPlatform } from '../src/services/SettingsSearchService';
import zhCN from '../src/i18n/zh-CN.json';
import zhTW from '../src/i18n/zh-TW.json';
import en from '../src/i18n/en.json';
import { SettingsManager } from '../src/core/SettingsManager';
import { DEFAULT_SETTINGS } from '../src/constants';
import { parseDirectorySettingLines, formatDirectorySettingLines } from '../src/utils/settingHelpers';

beforeAll(() => {
	(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
});

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

describe('SettingsManager', () => {
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
		expect(manager.validateSettings(loaded).valid).toBe(true);
		expect(saveData).toHaveBeenCalled();
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
	});

	it('fills and clamps the persisted typography body font size', async () => {
		const missing = cloneDefaults();
		delete (missing.typography as unknown as { enableBodyFontSize?: boolean }).enableBodyFontSize;
		delete (missing.typography as unknown as { bodyFontSize?: number }).bodyFontSize;
		delete (missing.typography as unknown as { applyToCards?: boolean }).applyToCards;
		const missingPlugin = {
			loadData: vi.fn().mockResolvedValue(missing),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const missingManager = new SettingsManager(missingPlugin, cloneDefaults());
		const loadedMissing = await missingManager.loadSettings();
		expect(loadedMissing.typography.enableBodyFontSize).toBe(false);
		expect(loadedMissing.typography.bodyFontSize).toBe(16);
		expect(loadedMissing.typography.applyToCards).toBe(false);

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
			expect(entries.some(entry => entry.category === 'immersive')).toBe(tier === 'desktop');
			expect(entries.some(entry => entry.category === 'obs')).toBe(tier === 'desktop');
			expect(entries.some(entry => entry.titleKey === 'setting.enable-mobile-focus-timer')).toBe(tier !== 'desktop');
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
});
