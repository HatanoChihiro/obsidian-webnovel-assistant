import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryDataManager } from '../src/services/HistoryDataManager';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(r => { resolve = r; });
	return { promise, resolve };
}

const stat = (addedWords: number) => ({
	focusMs: 60000,
	slackMs: 30000,
	addedWords,
	hourlyFocus: [60000],
	hourlySlack: [30000]
});

describe('HistoryDataManager persistence', () => {
	let plugin: {
		loadData: ReturnType<typeof vi.fn>;
		settings: { historyData?: Record<string, ReturnType<typeof stat>> };
		settingsManager: { saveSettings: ReturnType<typeof vi.fn> };
		app: { vault: { adapter: {
			exists: ReturnType<typeof vi.fn>;
			read: ReturnType<typeof vi.fn>;
			write: ReturnType<typeof vi.fn>;
			remove: ReturnType<typeof vi.fn>;
		} } };
		manifest: { dir: string; id: string };
	};

	beforeEach(() => {
		plugin = {
			loadData: vi.fn().mockResolvedValue({}),
			settings: {},
			settingsManager: { saveSettings: vi.fn().mockResolvedValue(undefined) },
			app: { vault: { adapter: {
				exists: vi.fn().mockResolvedValue(false),
				read: vi.fn().mockResolvedValue('{}'),
				write: vi.fn(),
				remove: vi.fn()
			} } },
			manifest: { dir: 'plugins/test', id: 'test' }
		};
	});

	it('clears only daily words while preserving focus timing data', () => {
		const manager = new HistoryDataManager(plugin as never);
		manager.updateDailyStat('2026-08-12', stat(1200));
		manager.setDailyWords('2026-08-12', 0);
		expect(manager.getDailyStat('2026-08-12')).toEqual(stat(0));
	});

	it('supports correcting daily words to a signed integer', () => {
		const manager = new HistoryDataManager(plugin as never);
		manager.setDailyWords('2026-08-12', -80);
		expect(manager.getDailyStat('2026-08-12')?.addedWords).toBe(-80);
	});

	it('exports and restores a portable history-only backup', async () => {
		const manager = new HistoryDataManager(plugin as never);
		manager.updateDailyStat('2026-08-12', stat(1200));
		const backup = manager.createHistoryBackup();
		manager.updateDailyStat('2026-08-13', stat(300));

		const count = await manager.restoreHistoryBackup(backup);

		expect(count).toBe(1);
		expect(manager.getHistory()).toEqual({ '2026-08-12': stat(1200) });
		expect(plugin.settings.historyData).toEqual({ '2026-08-12': stat(1200) });
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(1);
	});

	it('accepts an empty history backup and replaces current history', async () => {
		const manager = new HistoryDataManager(plugin as never);
		manager.updateDailyStat('2026-08-12', stat(1200));

		expect(await manager.restoreHistoryBackup('{}')).toBe(0);
		expect(manager.getHistory()).toEqual({});
		expect(plugin.settings.historyData).toEqual({});
	});

	it('rejects malformed backups without changing current history', async () => {
		const manager = new HistoryDataManager(plugin as never);
		manager.updateDailyStat('2026-08-12', stat(1200));

		await expect(manager.restoreHistoryBackup('{"bad":true}')).rejects.toThrow('Invalid history backup entry');

		expect(manager.getHistory()).toEqual({ '2026-08-12': stat(1200) });
		expect(plugin.settingsManager.saveSettings).not.toHaveBeenCalled();
	});

	it('loads canonical history, including an empty object, without reading the sidecar', async () => {
		plugin.settings.historyData = {};
		plugin.app.vault.adapter.exists.mockResolvedValue(true);
		const manager = new HistoryDataManager(plugin as never);
		expect(await manager.loadHistory()).toEqual({});
		expect(plugin.app.vault.adapter.exists).not.toHaveBeenCalled();
		expect(plugin.settingsManager.saveSettings).not.toHaveBeenCalled();
		expect(manager.isDirty()).toBe(false);
	});

	it('migrates a non-empty sidecar once and retains the source file as a backup', async () => {
		plugin.app.vault.adapter.exists.mockResolvedValue(true);
		plugin.app.vault.adapter.read.mockResolvedValue(JSON.stringify({ '2026-08-11': stat(200) }));
		const manager = new HistoryDataManager(plugin as never);
		const data = await manager.loadHistory();
		expect(data['2026-08-11']).toEqual(stat(200));
		expect(plugin.settings.historyData).toEqual(data);
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();
		expect(plugin.app.vault.adapter.remove).not.toHaveBeenCalled();
		expect(manager.isDirty()).toBe(false);
	});

	it('does not persist an empty sidecar as canonical data', async () => {
		plugin.app.vault.adapter.exists.mockResolvedValue(true);
		const manager = new HistoryDataManager(plugin as never);
		expect(await manager.loadHistory()).toEqual({});
		expect(plugin.settings.historyData).toBeUndefined();
		expect(plugin.settingsManager.saveSettings).not.toHaveBeenCalled();
		expect(manager.isDirty()).toBe(false);
	});

	it('migrates legacy dailyHistory only when canonical data and sidecar are absent', async () => {
		plugin.loadData.mockResolvedValue({ dailyHistory: { '2026-08-10': stat(10) } });
		const manager = new HistoryDataManager(plugin as never);
		expect(await manager.loadHistory()).toEqual({ '2026-08-10': stat(10) });
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(1);
	});

	it('serializes immutable snapshots without losing updates made during a write', async () => {
		const firstWrite = deferred();
		const snapshots: string[] = [];
		plugin.settingsManager.saveSettings.mockImplementation(async () => {
			snapshots.push(JSON.stringify(plugin.settings.historyData));
			if (snapshots.length === 1) await firstWrite.promise;
		});
		const manager = new HistoryDataManager(plugin as never);
		manager.addWords('2026-08-10', 10);
		const oldSave = manager.saveHistory();
		await new Promise<void>(resolve => queueMicrotask(resolve));
		expect(manager.getIsWriting()).toBe(true);
		manager.addWords('2026-08-10', 5);
		const newSave = manager.saveHistory();
		firstWrite.resolve();
		await Promise.all([oldSave, newSave]);
		expect(snapshots).toHaveLength(2);
		expect(JSON.parse(snapshots[0])['2026-08-10'].addedWords).toBe(10);
		expect(JSON.parse(snapshots[1])['2026-08-10'].addedWords).toBe(15);
		expect(manager.isDirty()).toBe(false);
	});

	it('keeps data dirty after a failed write and allows an explicit retry', async () => {
		plugin.settingsManager.saveSettings
			.mockRejectedValueOnce(new Error('disk full'))
			.mockResolvedValueOnce(undefined);
		const manager = new HistoryDataManager(plugin as never);
		manager.addWords('2026-08-10', 20);
		await expect(manager.saveHistory()).rejects.toThrow('disk full');
		expect(manager.isDirty()).toBe(true);
		await manager.flush();
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(2);
		expect(manager.isDirty()).toBe(false);
	});

	it('suppresses redundant saves when history has not changed', async () => {
		const manager = new HistoryDataManager(plugin as never);
		manager.addWords('2026-08-10', 5);
		await manager.saveHistory();
		await manager.saveHistory();
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(1);
	});
});
