import { describe, expect, it, vi } from 'vitest';
import { HistoryDataManager } from '../src/services/HistoryDataManager';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(r => { resolve = r; });
	return { promise, resolve };
}

describe('HistoryDataManager persistence', () => {
	it('clears only daily words while preserving focus timing data', () => {
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: { vault: { adapter: {} } }
		} as never;
		const manager = new HistoryDataManager(plugin);
		manager.updateDailyStat('2026-08-12', {
			addedWords: 1200,
			focusMs: 60000,
			slackMs: 30000,
			hourlyFocus: [60000],
			hourlySlack: [30000]
		});

		manager.setDailyWords('2026-08-12', 0);

		expect(manager.getDailyStat('2026-08-12')).toEqual({
			addedWords: 0,
			focusMs: 60000,
			slackMs: 30000,
			hourlyFocus: [60000],
			hourlySlack: [30000]
		});
	});

	it('supports correcting daily words to a signed integer', () => {
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: { vault: { adapter: {} } }
		} as never;
		const manager = new HistoryDataManager(plugin);

		manager.setDailyWords('2026-08-12', -80);

		expect(manager.getDailyStat('2026-08-12')?.addedWords).toBe(-80);
	});

	it('serializes snapshots without losing updates made during a write', async () => {
		const firstWrite = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (_path: string, content: string) => {
			writes.push(content);
			if (writes.length === 1) await firstWrite.promise;
		});
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: { vault: { adapter: { write } } }
		} as never;
		const manager = new HistoryDataManager(plugin);

		manager.addWords('2026-08-10', 10);
		const oldSave = manager.saveHistory();
		await Promise.resolve();
		manager.addWords('2026-08-10', 5);
		const newSave = manager.saveHistory();

		firstWrite.resolve();
		await Promise.all([oldSave, newSave]);

		expect(write).toHaveBeenCalledTimes(2);
		expect(JSON.parse(writes[0])['2026-08-10'].addedWords).toBe(10);
		expect(JSON.parse(writes[1])['2026-08-10'].addedWords).toBe(15);
		expect(manager.isDirty()).toBe(false);
	});

	it('keeps data dirty after a failed write and allows retry', async () => {
		const write = vi.fn()
			.mockRejectedValueOnce(new Error('disk full'))
			.mockResolvedValueOnce(undefined);
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: { vault: { adapter: { write } } }
		} as never;
		const manager = new HistoryDataManager(plugin);
		manager.addWords('2026-08-10', 20);

		await expect(manager.saveHistory()).rejects.toThrow('disk full');
		expect(manager.isDirty()).toBe(true);
		await manager.flush();

		expect(write).toHaveBeenCalledTimes(2);
		expect(manager.isDirty()).toBe(false);
	});
});
