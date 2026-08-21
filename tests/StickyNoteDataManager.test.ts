import { describe, expect, it, vi } from 'vitest';
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
	it('loads persisted notes for the side-panel list after startup', async () => {
		const read = vi.fn().mockResolvedValue(JSON.stringify([note]));
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: {
				vault: { adapter: {
					exists: vi.fn().mockResolvedValue(true),
					read
				} },
				workspace: { trigger: vi.fn() }
			}
		} as never;
		const manager = new StickyNoteDataManager(plugin);

		await manager.loadNotes();

		expect(read).toHaveBeenCalledWith('plugins/test/notes-data.json');
		expect(manager.getNotes()).toEqual([note]);
	});

	it('propagates write failures to callers', async () => {
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: {
				vault: { adapter: { write: vi.fn().mockRejectedValue(new Error('write failed')) } },
				workspace: { trigger: vi.fn() }
			}
		} as never;
		const manager = new StickyNoteDataManager(plugin);

		await expect(manager.saveNotes([note])).rejects.toThrow('write failed');
	});

	it('waits for notes-data persistence when removing a note transactionally', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: {
				vault: { adapter: { write } },
				workspace: { trigger: vi.fn() }
			}
		} as never;
		const manager = new StickyNoteDataManager(plugin);
		await manager.saveNotes([note]);

		await manager.removeNoteAndWait(note.id);

		expect(manager.getNotes()).toEqual([]);
		expect(JSON.parse(write.mock.calls.at(-1)?.[1] as string)).toEqual([]);
	});

	it('triggers notes-changed once per successful persist and skips notification for duplicates', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const trigger = vi.fn();
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: {
				vault: { adapter: { write } },
				workspace: { trigger }
			}
		} as never;

		const manager = new StickyNoteDataManager(plugin);

		// First save
		await manager.saveNotes([note]);
		expect(write).toHaveBeenCalledTimes(1);
		expect(trigger).toHaveBeenCalledWith('webnovel:notes-changed');
		expect(trigger).toHaveBeenCalledTimes(1);

		// Duplicate save with identical data -> skipped, no event, 0 extra writes
		await manager.saveNotes([note]);
		expect(write).toHaveBeenCalledTimes(1);
		expect(trigger).toHaveBeenCalledTimes(1);

		// Mutated save -> persisted, event triggered
		const updatedNote = { ...note, content: 'updated content' };
		await manager.saveNotes([updatedNote]);
		expect(write).toHaveBeenCalledTimes(2);
		expect(trigger).toHaveBeenCalledTimes(2);
	});

	it('preserves immutable snapshots when caller mutates note objects after save request', async () => {
		const writeGate = deferred();
		const writes: string[] = [];
		const write = vi.fn(async (_path: string, content: string) => {
			writes.push(content);
			await writeGate.promise;
		});
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: {
				vault: { adapter: { write } },
				workspace: { trigger: vi.fn() }
			}
		} as never;

		const manager = new StickyNoteDataManager(plugin);
		const mutableNote = { ...note, title: 'Original Title' };

		const savePromise = manager.saveNotes([mutableNote]);

		// Mutate caller object immediately
		mutableNote.title = 'Mutated Title';

		writeGate.resolve();
		await savePromise;

		expect(JSON.parse(writes[0])[0].title).toBe('Original Title');
	});

	it('tracks getIsWriting accurately during in-flight write', async () => {
		const writeGate = deferred();
		const write = vi.fn(async () => {
			await writeGate.promise;
		});
		const plugin = {
			manifest: { dir: 'plugins/test', id: 'test' },
			app: {
				vault: { adapter: { write } },
				workspace: { trigger: vi.fn() }
			}
		} as never;

		const manager = new StickyNoteDataManager(plugin);
		expect(manager.getIsWriting()).toBe(false);

		const savePromise = manager.saveNotes([note]);
		await new Promise(r => queueMicrotask(r));

		expect(manager.getIsWriting()).toBe(true);

		writeGate.resolve();
		await savePromise;

		expect(manager.getIsWriting()).toBe(false);
	});
});
