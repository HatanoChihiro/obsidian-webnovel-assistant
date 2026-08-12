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
		const missingPlugin = {
			loadData: vi.fn().mockResolvedValue(missing),
			saveData: vi.fn().mockResolvedValue(undefined)
		} as never;
		const missingManager = new SettingsManager(missingPlugin, cloneDefaults());
		const loadedMissing = await missingManager.loadSettings();
		expect(loadedMissing.typography.enableBodyFontSize).toBe(false);
		expect(loadedMissing.typography.bodyFontSize).toBe(16);

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
});
