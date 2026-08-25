import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsManager } from '../src/core/SettingsManager';
import { DEFAULT_SETTINGS } from '../src/constants';

beforeAll(() => {
	(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
});

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

describe('SettingsManager', () => {
	it('writes default values back for invalid nested and top-level settings', async () => {
		const invalid = cloneDefaults();
		invalid.defaultGoal = -1;
		invalid.obs.obsPort = 99999;
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			loadData: vi.fn().mockResolvedValue(invalid),
			saveData
		} as never;
		const manager = new SettingsManager(plugin, cloneDefaults());

		const loaded = await manager.loadSettings();

		expect(loaded.defaultGoal).toBe(DEFAULT_SETTINGS.defaultGoal);
		expect(loaded.obs.obsPort).toBe(DEFAULT_SETTINGS.obs.obsPort);
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
});
