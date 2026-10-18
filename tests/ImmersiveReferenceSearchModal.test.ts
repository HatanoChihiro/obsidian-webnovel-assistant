import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, Notice, type App } from 'obsidian';
import { ImmersiveReferenceSearchModal, type ImmersiveReferenceSearchPlugin } from '../src/ui/ImmersiveReferenceSearchModal';

vi.mock('obsidian', () => {
	class MockFuzzySuggestModal {
		app: unknown;
		placeholder = '';
		constructor(app: unknown) {
			this.app = app;
		}
		setPlaceholder(text: string) {
			this.placeholder = text;
		}
	}
	class MockTFile {
		path: string;
		name: string;
		extension = 'md';
		constructor(path = '', name = '', extension = 'md') {
			this.path = path;
			this.name = name;
			this.extension = extension;
		}
	}
	return {
		FuzzySuggestModal: MockFuzzySuggestModal,
		TFile: MockTFile,
		Notice: vi.fn()
	};
});

describe('ImmersiveReferenceSearchModal - Desktop Reference Search', () => {
	let mockApp: App;
	let mockPlugin: ImmersiveReferenceSearchPlugin;
	let vaultFiles: Map<string, unknown>;

	const createTestFile = (path: string, extension = 'md'): TFile => {
		const name = path.split('/').pop() || path;
		const file = new (TFile as unknown as new (path: string, name: string, ext: string) => TFile)(path, name, extension);
		vaultFiles.set(path, file);
		return file;
	};

	beforeEach(() => {
		vaultFiles = new Map();
		vi.clearAllMocks();

		mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => vaultFiles.get(path) ?? null)
			}
		} as unknown as App;
	});

	it('queries getVaultMarkdownFiles once on construction and returns full paths', () => {
		const file1 = createTestFile('Novels/BookA/Chapter1.md');
		const file2 = createTestFile('Notes/CharacterOutline.md');
		const getFilesSpy = vi.fn().mockReturnValue([file1, file2]);
		mockPlugin = { getVaultMarkdownFiles: getFilesSpy };

		const modal = new ImmersiveReferenceSearchModal(
			mockApp,
			mockPlugin,
			vi.fn(),
			vi.fn()
		);

		expect(getFilesSpy).toHaveBeenCalledTimes(1);

		// getItems returns cached files without querying vault again
		const items = modal.getItems();
		expect(items).toEqual([file1, file2]);
		expect(getFilesSpy).toHaveBeenCalledTimes(1);

		// getItemText returns full path
		expect(modal.getItemText(file1)).toBe('Novels/BookA/Chapter1.md');
		expect(modal.getItemText(file2)).toBe('Notes/CharacterOutline.md');
	});

	it('validates file existence on choose and passes valid TFile to onChoose', () => {
		const file = createTestFile('Novels/BookA/Valid.md');
		mockPlugin = { getVaultMarkdownFiles: vi.fn().mockReturnValue([file]) };
		const onChoose = vi.fn();
		const onCancel = vi.fn();

		const modal = new ImmersiveReferenceSearchModal(
			mockApp,
			mockPlugin,
			onChoose,
			onCancel
		);

		modal.onChooseItem(file);

		expect(onChoose).toHaveBeenCalledWith(file);
		expect(Notice).not.toHaveBeenCalled();

		// Closing modal after choose does not fire onCancel
		modal.onClose();
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('handles deleted or non-markdown file selections via Notice and does not choose', async () => {
		const deletedFile = createTestFile('Novels/BookA/Deleted.md');
		// Remove from vault mock to simulate deleted file
		vaultFiles.delete(deletedFile.path);

		const nonMdFile = createTestFile('Images/Cover.png', 'png');

		mockPlugin = { getVaultMarkdownFiles: vi.fn().mockReturnValue([deletedFile, nonMdFile]) };
		const onChoose = vi.fn();
		const onCancel = vi.fn();

		const modal = new ImmersiveReferenceSearchModal(
			mockApp,
			mockPlugin,
			onChoose,
			onCancel
		);

		// Select deleted file
		modal.onChooseItem(deletedFile);
		expect(Notice).toHaveBeenCalledTimes(1);
		expect(onChoose).not.toHaveBeenCalled();

		// Modal closes after invalid selection -> must trigger onCancel to restore focus
		modal.onClose();
		await Promise.resolve();
		expect(onCancel).toHaveBeenCalledTimes(1);

		// Select non-markdown file
		modal.onChooseItem(nonMdFile);
		expect(Notice).toHaveBeenCalledTimes(2);
		expect(onChoose).not.toHaveBeenCalled();
	});

	it('does not treat closing before the native choose callback as cancellation', async () => {
		const file = createTestFile('Notes/Reference.md');
		const onCancel = vi.fn();
		const onChoose = vi.fn();
		const modal = new ImmersiveReferenceSearchModal(mockApp, { getVaultMarkdownFiles: () => [file] }, onChoose, onCancel);
		modal.onClose();
		modal.onChooseItem(file);
		await Promise.resolve();
		expect(onCancel).not.toHaveBeenCalled();
		expect(onChoose).toHaveBeenCalledWith(file);
	});

	it('triggers onCancel when modal is closed without choosing an item', async () => {
		const file = createTestFile('Novels/BookA/Doc.md');
		mockPlugin = { getVaultMarkdownFiles: vi.fn().mockReturnValue([file]) };
		const onChoose = vi.fn();
		const onCancel = vi.fn();

		const modal = new ImmersiveReferenceSearchModal(
			mockApp,
			mockPlugin,
			onChoose,
			onCancel
		);

		modal.onClose();
		await Promise.resolve();
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onChoose).not.toHaveBeenCalled();
	});
});
