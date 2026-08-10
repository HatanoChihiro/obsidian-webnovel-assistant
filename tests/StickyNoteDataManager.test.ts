import { describe, expect, it, vi } from 'vitest';
import { StickyNoteDataManager } from '../src/services/StickyNoteDataManager';

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
});
