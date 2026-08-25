import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StickyNoteDataManager } from '../src/services/StickyNoteDataManager';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(r => { resolve = r; });
	return { promise, resolve };
}

const note = {
	id: 'note-1', title: 'Note', content: 'content', top: '0', left: '0',
	width: '100px', height: '100px', color: '#fff', textColor: '#000',
	isEditing: false, isPinned: false, zoomLevel: 1
};

describe('StickyNoteDataManager persistence', () => {
	let plugin: {
		settings: { notesData?: typeof note[] };
		settingsManager: { saveSettings: ReturnType<typeof vi.fn> };
		app: {
			workspace: { trigger: ReturnType<typeof vi.fn> };
			vault: { adapter: {
				exists: ReturnType<typeof vi.fn>;
				read: ReturnType<typeof vi.fn>;
				write: ReturnType<typeof vi.fn>;
				remove: ReturnType<typeof vi.fn>;
			} };
		};
		manifest: { dir: string; id: string };
		adaptiveDebounceManager: { debounceFixed: ReturnType<typeof vi.fn> };
	};

	beforeEach(() => {
		plugin = {
			settings: {},
			settingsManager: { saveSettings: vi.fn().mockResolvedValue(undefined) },
			app: {
				workspace: { trigger: vi.fn() },
				vault: { adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue('[]'),
					write: vi.fn(),
					remove: vi.fn()
				} }
			},
			manifest: { dir: 'plugins/test', id: 'test' },
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		};
	});

	it('loads canonical notes, including an empty array, without reading the sidecar', async () => {
		plugin.settings.notesData = [];
		plugin.app.vault.adapter.exists.mockResolvedValue(true);
		const manager = new StickyNoteDataManager(plugin as never);
		expect(await manager.loadNotes()).toEqual([]);
		expect(plugin.app.vault.adapter.exists).not.toHaveBeenCalled();
		expect(plugin.settingsManager.saveSettings).not.toHaveBeenCalled();
		expect(manager.isDirty()).toBe(false);
	});

	it('refreshes open floating notes and notifies every note-list view', () => {
		const updateVisuals = vi.fn();
		Object.assign(plugin, { activeNotes: [{ updateVisuals }] });
		const manager = new StickyNoteDataManager(plugin as never);

		manager.refreshImmersiveNotes();

		expect(updateVisuals).toHaveBeenCalledOnce();
		expect(plugin.app.workspace.trigger).toHaveBeenCalledWith('webnovel:notes-changed');
	});

	it('migrates a non-empty sidecar once and retains the source file as a backup', async () => {
		plugin.app.vault.adapter.exists.mockResolvedValue(true);
		plugin.app.vault.adapter.read.mockResolvedValue(JSON.stringify([note]));
		const manager = new StickyNoteDataManager(plugin as never);
		expect(await manager.loadNotes()).toEqual([note]);
		expect(plugin.settings.notesData).toEqual([note]);
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();
		expect(plugin.app.vault.adapter.remove).not.toHaveBeenCalled();
		expect(manager.isDirty()).toBe(false);
	});

	it('does not persist an empty sidecar as canonical data', async () => {
		plugin.app.vault.adapter.exists.mockResolvedValue(true);
		const manager = new StickyNoteDataManager(plugin as never);
		expect(await manager.loadNotes()).toEqual([]);
		expect(plugin.settings.notesData).toBeUndefined();
		expect(plugin.settingsManager.saveSettings).not.toHaveBeenCalled();
	});

	it('propagates write failures and supports an explicit retry', async () => {
		plugin.settingsManager.saveSettings
			.mockRejectedValueOnce(new Error('write failed'))
			.mockResolvedValueOnce(undefined);
		const manager = new StickyNoteDataManager(plugin as never);
		await expect(manager.saveNotes([note])).rejects.toThrow('write failed');
		expect(manager.isDirty()).toBe(true);
		await manager.flush();
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(2);
		expect(manager.isDirty()).toBe(false);
	});

	it('waits for persistence when removing a note transactionally', async () => {
		const manager = new StickyNoteDataManager(plugin as never);
		await manager.saveNotes([note]);
		await manager.removeNoteAndWait(note.id);
		expect(manager.getNotes()).toEqual([]);
		expect(plugin.settings.notesData).toEqual([]);
	});

	it('triggers notes-changed once per distinct successful persist', async () => {
		const manager = new StickyNoteDataManager(plugin as never);
		await manager.saveNotes([note]);
		await manager.saveNotes([note]);
		await manager.saveNotes([{ ...note, content: 'updated' }]);
		expect(plugin.settingsManager.saveSettings).toHaveBeenCalledTimes(2);
		expect(plugin.app.workspace.trigger).toHaveBeenCalledTimes(2);
		expect(plugin.app.workspace.trigger).toHaveBeenCalledWith('webnovel:notes-changed');
	});

	it('preserves immutable snapshots when caller data changes during a write', async () => {
		const firstWrite = deferred();
		const snapshots: string[] = [];
		plugin.settingsManager.saveSettings.mockImplementation(async () => {
			snapshots.push(JSON.stringify(plugin.settings.notesData));
			if (snapshots.length === 1) await firstWrite.promise;
		});
		const manager = new StickyNoteDataManager(plugin as never);
		const mutableNote = { ...note, title: 'Original' };
		const firstSave = manager.saveNotes([mutableNote]);
		await new Promise<void>(resolve => queueMicrotask(resolve));
		expect(manager.getIsWriting()).toBe(true);
		mutableNote.title = 'Caller mutation';
		const secondSave = manager.saveNotes([{ ...mutableNote, title: 'Second' }]);
		firstWrite.resolve();
		await Promise.all([firstSave, secondSave]);
		expect(JSON.parse(snapshots[0])[0].title).toBe('Original');
		expect(JSON.parse(snapshots[1])[0].title).toBe('Second');
		expect(manager.getIsWriting()).toBe(false);
	});
});
