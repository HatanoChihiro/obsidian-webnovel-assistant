import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, TFolder } from 'obsidian';
import { TFile } from 'obsidian';
import { mockNoticeMessages, resetNoticeMessages } from './mocks/obsidian';
import { MockElement } from './mocks/MockElement';
import { ChapterMergeModal, type ChapterMergeModalPlugin } from '../src/ui/ChapterMergeModal';
import { MobileChapterMergeModal, type MobileChapterMergeModalPlugin } from '../src/ui/MobileChapterMergeModal';
import type { ChapterMergeItem, ChapterMergeDraft } from '../src/services/ChapterMergeManager';
import type { ChapterMergeSelection } from '../src/services/ChapterMergeSelection';

interface ChapterMergeModalSeam {
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	exportBtn: HTMLButtonElement;
	applyExportBtn: HTMLButtonElement;
	bulkSelectBtn: HTMLButtonElement;
	bulkDeselectBtn: HTMLButtonElement;
	selectionCountEl: HTMLElement;
	tocContainerEl: HTMLElement;
	previewContainerEl: HTMLElement;
	chapterSelection: ChapterMergeSelection;
	items: ChapterMergeItem[];
	filteredItems: ChapterMergeItem[];
	searchQuery: string;
	isSubmitting: boolean;
	handleExportMerged(): Promise<void>;
	handleApplyAndExport(): Promise<void>;
	updateSelectionUI(): void;
	renderPreviewCards(): void;
}

interface MobileChapterMergeModalSeam {
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	exportBtn?: HTMLButtonElement;
	selectionCountEl?: HTMLElement;
	previewContainerEl: HTMLElement;
	chapterSelection: ChapterMergeSelection;
	items: ChapterMergeItem[];
	isSubmitting: boolean;
	handleExportMerged(): Promise<void>;
	updateSelectionUI(): void;
}

interface MockLeaf {
	openFile: ReturnType<typeof vi.fn<(file: unknown) => Promise<void>>>;
}

interface MockVaultAdapter {
	exists: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>;
	read: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>;
	write: ReturnType<typeof vi.fn<(path: string, data: string) => Promise<void>>>;
	remove: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
}

interface MockVault {
	adapter: MockVaultAdapter;
	cachedRead: ReturnType<typeof vi.fn<(file: TFile) => Promise<string>>>;
	create: ReturnType<typeof vi.fn<(path: string, data: string) => Promise<TFile>>>;
	modify: ReturnType<typeof vi.fn<(file: TFile, data: string) => Promise<void>>>;
}

interface MockAppInstance {
	workspace: {
		getLeaf: ReturnType<typeof vi.fn<() => MockLeaf>>;
	};
	vault: MockVault;
}

interface MockPluginInstance extends ChapterMergeModalPlugin, MobileChapterMergeModalPlugin {
	typographyManager: {
		registerPreviewElement: ReturnType<typeof vi.fn>;
		unregisterPreviewElement: ReturnType<typeof vi.fn>;
	};
	chapterMergeManager: {
		loadFolderChapters: ReturnType<typeof vi.fn<(folder: TFolder) => Promise<ChapterMergeItem[]>>>;
		loadDraft: ReturnType<typeof vi.fn<(folderPath: string) => Promise<ChapterMergeDraft | null>>>;
		saveDraft: ReturnType<typeof vi.fn>;
		saveToOriginalFiles: ReturnType<typeof vi.fn<(items: ChapterMergeItem[]) => Promise<number>>>;
		clearDraft: ReturnType<typeof vi.fn<(folderPath: string) => void>>;
		exportMergedDocument: ReturnType<
			typeof vi.fn<(folder: TFolder, items: ChapterMergeItem[], includeTitles?: boolean) => Promise<{ file: TFile; wordCount: number }>>
		>;
	};
	calculateAccurateWords: ReturnType<typeof vi.fn<(text: string) => number>>;
}

interface CheckboxElementMock {
	checked: boolean;
	onclick: ((e: { stopPropagation: () => void; shiftKey: boolean }) => void) | null;
}

interface ClickableElementMock {
	onclick: (() => void) | null;
}

interface InputElementMock {
	value: string;
	oninput: (() => void) | null;
}

function createMockItem(path: string, title: string, volumeName: string = ''): ChapterMergeItem {
	return {
		file: Object.assign(new TFile(), { path, basename: title, name: `${title}.md` }),
		volumeName,
		title,
		frontmatter: '',
		originalBody: `body of ${title}`,
		currentBody: `body of ${title}`,
		annotation: '',
		originalAnnotation: '',
		isModified: false
	};
}

describe('ChapterMergeModal & MobileChapterMergeModal Integration', () => {
	let mockApp: MockAppInstance;
	let mockFolder: TFolder;
	let mockPlugin: MockPluginInstance;
	let items: ChapterMergeItem[];

	beforeEach(() => {
		resetNoticeMessages();
		mockFolder = { name: 'Novel', path: 'Novel' } as TFolder;

		items = [
			createMockItem('Novel/Vol1/Ch1.md', '第一章', '第一卷'),
			createMockItem('Novel/Vol1/Ch2.md', '第二章', '第一卷'),
			createMockItem('Novel/Vol1/Ch3.md', '第三章', '第一卷')
		];

		const mockLeaf: MockLeaf = {
			openFile: vi.fn<(file: unknown) => Promise<void>>().mockResolvedValue(undefined)
		};

		mockApp = {
			workspace: {
				getLeaf: vi.fn(() => mockLeaf)
			},
			vault: {
				adapter: {
					exists: vi.fn<(path: string) => Promise<boolean>>().mockResolvedValue(false),
					read: vi.fn<(path: string) => Promise<string>>(),
					write: vi.fn<(path: string, data: string) => Promise<void>>(),
					remove: vi.fn<(path: string) => Promise<void>>()
				},
				cachedRead: vi.fn<(file: TFile) => Promise<string>>(),
				create: vi.fn<(path: string, data: string) => Promise<TFile>>(),
				modify: vi.fn<(file: TFile, data: string) => Promise<void>>()
			}
		};

		mockPlugin = {
			typographyManager: {
				registerPreviewElement: vi.fn(),
				unregisterPreviewElement: vi.fn()
			},
			chapterMergeManager: {
				loadFolderChapters: vi.fn<(folder: TFolder) => Promise<ChapterMergeItem[]>>().mockResolvedValue(items),
				loadDraft: vi.fn<(folderPath: string) => Promise<ChapterMergeDraft | null>>().mockResolvedValue(null),
				saveDraft: vi.fn(),
				saveToOriginalFiles: vi.fn<(items: ChapterMergeItem[]) => Promise<number>>().mockResolvedValue(1),
				clearDraft: vi.fn<(folderPath: string) => void>(),
				exportMergedDocument: vi.fn<(folder: TFolder, items: ChapterMergeItem[], includeTitles?: boolean) => Promise<{ file: TFile; wordCount: number }>>().mockResolvedValue({
					file: Object.assign(new TFile(), { path: 'Novel/Novel_Merged.md', name: 'Novel_Merged.md' }),
					wordCount: 1500
				})
			},
			calculateAccurateWords: vi.fn<(text: string) => number>((text: string) => text.length)
		};
	});

	describe('Desktop ChapterMergeModal', () => {
		it('initializes all chapters as selected and enables export buttons', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			// Native Modal.open() stores the document selection on this internal field.
			(modal as unknown as { selection: Selection | null }).selection = null;
			await modal.onOpen();

			const seam = modal as unknown as ChapterMergeModalSeam;
			expect(seam.chapterSelection.getSelectedCount()).toBe(3);
			expect(seam.exportBtn.disabled).toBe(false);
			expect(seam.applyExportBtn.disabled).toBe(false);
		});

		it('disables export buttons on zero selection and refuses direct export invocations', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as ChapterMergeModalSeam;
			seam.chapterSelection.deselectAll(items);
			seam.updateSelectionUI();

			expect(seam.exportBtn.disabled).toBe(true);
			expect(seam.applyExportBtn.disabled).toBe(true);

			// Direct call to handleExportMerged should do nothing
			await seam.handleExportMerged();
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toHaveLength(0);

			// Direct call to handleApplyAndExport should do nothing
			await seam.handleApplyAndExport();
			expect(mockPlugin.chapterMergeManager.saveToOriginalFiles).not.toHaveBeenCalled();
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).not.toHaveBeenCalled();
		});

		it('exports only selected subset and reports correct selected count in notice', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as ChapterMergeModalSeam;
			// Deselect Ch3
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, false);
			seam.updateSelectionUI();

			await seam.handleExportMerged();

			expect(mockPlugin.chapterMergeManager.exportMergedDocument).toHaveBeenCalledWith(
				mockFolder,
				[items[0], items[1]],
				true
			);

			// Notice count must reflect selected items (2)
			expect(mockNoticeMessages.some((msg: string) => msg.includes('2'))).toBe(true);
		});

		it('protects unselected modified chapters in drafts during subset export', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			// Mark Ch3 as modified
			items[2].isModified = true;
			items[2].currentBody = 'Ch3 modified content';

			const seam = modal as unknown as ChapterMergeModalSeam;
			// Select only Ch1 and Ch2 (Ch3 unselected)
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, false);
			seam.updateSelectionUI();

			await seam.handleExportMerged();

			// Since Ch3 was unselected and modified, saveDraft must have been called for Ch3
			expect(mockPlugin.chapterMergeManager.saveDraft).toHaveBeenCalledWith(
				mockFolder.path,
				[items[2]],
				expect.any(Map)
			);
			expect(mockPlugin.chapterMergeManager.clearDraft).not.toHaveBeenCalled();
		});

		it('clears draft when all items are exported in handleExportMerged', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as ChapterMergeModalSeam;
			await seam.handleExportMerged();

			expect(mockPlugin.chapterMergeManager.clearDraft).toHaveBeenCalledWith(mockFolder.path);
			expect(mockPlugin.chapterMergeManager.saveDraft).not.toHaveBeenCalled();
		});

		it('handleApplyAndExport applies all modified originals, exports selected subset, and updates both notices with exact counts', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			// 1 modified original
			items[0].isModified = true;
			mockPlugin.chapterMergeManager.saveToOriginalFiles.mockResolvedValueOnce(1);

			const seam = modal as unknown as ChapterMergeModalSeam;
			// Select 2 chapters (Ch1 and Ch2)
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, false);
			seam.updateSelectionUI();

			await seam.handleApplyAndExport();

			// All items passed to saveToOriginalFiles
			expect(mockPlugin.chapterMergeManager.saveToOriginalFiles).toHaveBeenCalledWith(items);
			// Only selected items (2) passed to exportMergedDocument
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).toHaveBeenCalledWith(
				mockFolder,
				[items[0], items[1]],
				true
			);
			expect(mockPlugin.chapterMergeManager.clearDraft).toHaveBeenCalledWith(mockFolder.path);

			// Verify apply notice has actual applied count (1) and merge notice has selected count (2)
			const applyNotice = mockNoticeMessages.find((msg: string) => msg.includes('保存修改至 1 个章节原文') || msg.includes('Applied changes to 1'));
			const mergeNotice = mockNoticeMessages.find((msg: string) => msg.includes('已合并 2 个章节') || msg.includes('Merged 2 chapters'));
			expect(applyNotice).toBeDefined();
			expect(mergeNotice).toBeDefined();
		});

		it('snapshots selection at handler entry so selection changes during awaited export do not corrupt draft protection', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as ChapterMergeModalSeam;

			// Ch3 is modified and unselected at entry
			items[2].isModified = true;
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, false);

			let resolveExport!: (val: { file: TFile; wordCount: number }) => void;
			const pendingExport = new Promise<{ file: TFile; wordCount: number }>((resolve) => {
				resolveExport = resolve;
			});
			mockPlugin.chapterMergeManager.exportMergedDocument.mockReturnValueOnce(pendingExport);

			// Start export
			const exportPromise = seam.handleExportMerged();

			// While export is pending, user changes checkbox selection (e.g. selects Ch3)
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, true);
			seam.updateSelectionUI();
			expect(seam.exportBtn.disabled).toBe(true);
			expect(seam.applyExportBtn.disabled).toBe(true);

			// Duplicate export call while pending must be rejected
			await seam.handleExportMerged();
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).toHaveBeenCalledTimes(1);

			// Now resolve the export
			resolveExport({
				file: Object.assign(new TFile(), { path: 'Novel/Novel_Merged.md', name: 'Novel_Merged.md' }),
				wordCount: 1000
			});
			await exportPromise;

			// Even though Ch3 was checked while export was pending, the entry snapshot knew Ch3 was NOT in the exported subset,
			// so saveDraft must still preserve Ch3's unexported draft!
			expect(mockPlugin.chapterMergeManager.saveDraft).toHaveBeenCalledWith(
				mockFolder.path,
				[items[2]],
				expect.any(Map)
			);
		});

		it('resets isSubmitting and re-enables buttons on failed export so subsequent close still saves drafts', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			items[0].isModified = true;
			mockPlugin.chapterMergeManager.exportMergedDocument.mockRejectedValueOnce(new Error('Disk full'));

			const seam = modal as unknown as ChapterMergeModalSeam;
			await seam.handleExportMerged();

			expect(seam.isSubmitting).toBe(false);
			expect(seam.exportBtn.disabled).toBe(false);
			expect(mockNoticeMessages.length).toBeGreaterThan(0);

			// Now close modal: since isSubmitting was reset to false and items[0].isModified is true, saveDraft must run
			modal.onClose();
			expect(mockPlugin.chapterMergeManager.saveDraft).toHaveBeenCalledWith(
				mockFolder.path,
				items,
				expect.any(Map)
			);
		});

		it('executes real DOM callbacks: checkbox click stops navigation, avoids preview redraw, updates counter/buttons; search filter resets anchor and bulk preserves hidden items', async () => {
			const modal = new ChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			const modalEl = new MockElement('modal-window');
			const contentEl = new MockElement('modal-content');
			modal.modalEl = modalEl as unknown as HTMLElement;
			modal.contentEl = contentEl as unknown as HTMLElement;

			await modal.onOpen();
			const seam = modal as unknown as ChapterMergeModalSeam;

			// 1. DOM Checkbox click
			const firstItem = contentEl.querySelector('.wn-merge-toc-item');
			expect(firstItem).not.toBeNull();
			const checkbox = firstItem?.querySelector('.wn-merge-toc-checkbox') as unknown as CheckboxElementMock;
			expect(checkbox).not.toBeNull();

			const stopPropagation = vi.fn();
			const rowNavSpy = vi.fn();
			(firstItem as unknown as ClickableElementMock).onclick = rowNavSpy;
			const redrawSpy = vi.spyOn(seam, 'renderPreviewCards');

			// User clicks checkbox to uncheck
			checkbox.checked = false;
			checkbox.onclick?.({ stopPropagation, shiftKey: false });

			expect(stopPropagation).toHaveBeenCalled();
			expect(rowNavSpy).not.toHaveBeenCalled(); // Stops navigation
			expect(redrawSpy).not.toHaveBeenCalled(); // Preserves preview DOM / scroll
			expect(seam.chapterSelection.isSelected(items[0].file.path)).toBe(false);
			expect(seam.selectionCountEl.textContent).toContain('2');
			expect(seam.exportBtn.disabled).toBe(false);

			// 2. Search filter and bulk action callbacks
			const searchInput = contentEl.querySelector('.wn-merge-search-input') as unknown as InputElementMock;
			expect(searchInput).not.toBeNull();

			// Filter to Vol1 only (first 3 chapters match "第一") -> matches Ch1
			searchInput.value = '第一章';
			searchInput.oninput?.();

			expect(seam.filteredItems).toHaveLength(1);
			expect(seam.filteredItems[0].file.path).toBe('Novel/Vol1/Ch1.md');

			// Bulk select the filtered item
			const bulkSelectBtn = contentEl.querySelector('.wn-merge-btn-bulk') as unknown as ClickableElementMock;
			expect(bulkSelectBtn).not.toBeNull();
			bulkSelectBtn.onclick?.();

			// Ch1 is now selected again
			expect(seam.chapterSelection.isSelected(items[0].file.path)).toBe(true);

			// Bulk deselect the filtered item
			const bulkDeselectBtn = contentEl.querySelectorAll('.wn-merge-btn-bulk')[1] as unknown as ClickableElementMock;
			bulkDeselectBtn.onclick?.();
			expect(seam.chapterSelection.isSelected(items[0].file.path)).toBe(false);

			// Verify hidden items (Ch2 and Ch3) were NOT affected by bulk deselect on filtered list
			expect(seam.chapterSelection.isSelected(items[1].file.path)).toBe(true);
			expect(seam.chapterSelection.isSelected(items[2].file.path)).toBe(true);

			// Clear search filter
			searchInput.value = '';
			searchInput.oninput?.();
			expect(seam.filteredItems).toHaveLength(3);
			expect(seam.chapterSelection.isSelected(items[0].file.path)).toBe(false);
			expect(seam.chapterSelection.isSelected(items[1].file.path)).toBe(true);
			expect(seam.chapterSelection.isSelected(items[2].file.path)).toBe(true);
		});
	});

	describe('MobileChapterMergeModal', () => {
		it('initializes all chapters as selected and enables export button', async () => {
			const modal = new MobileChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			(modal as unknown as { selection: Selection | null }).selection = null;
			await modal.onOpen();

			const seam = modal as unknown as MobileChapterMergeModalSeam;
			expect(seam.chapterSelection.getSelectedCount()).toBe(3);
			expect(seam.exportBtn?.disabled).toBe(false);
		});

		it('disables export button on zero selection and refuses direct export invocations', async () => {
			const modal = new MobileChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as MobileChapterMergeModalSeam;
			seam.chapterSelection.deselectAll(items);
			seam.updateSelectionUI();

			expect(seam.exportBtn?.disabled).toBe(true);

			await seam.handleExportMerged();
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).not.toHaveBeenCalled();
			expect(mockNoticeMessages).toHaveLength(0);
		});

		it('exports only selected subset and reflects count in notice', async () => {
			const modal = new MobileChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as MobileChapterMergeModalSeam;
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, false);
			seam.updateSelectionUI();

			await seam.handleExportMerged();

			expect(mockPlugin.chapterMergeManager.exportMergedDocument).toHaveBeenCalledWith(
				mockFolder,
				[items[0], items[1]],
				true
			);
			expect(mockNoticeMessages.some((msg: string) => msg.includes('2'))).toBe(true);
		});

		it('does NOT clear desktop drafts on mobile read-only subset export, even if selection changed while export was pending', async () => {
			const modal = new MobileChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as MobileChapterMergeModalSeam;
			// Deselect Ch2
			seam.chapterSelection.handleCheckboxClick('Novel/Vol1/Ch2.md', false, items, false);

			let resolveExport!: (val: { file: TFile; wordCount: number }) => void;
			const pendingExport = new Promise<{ file: TFile; wordCount: number }>((resolve) => {
				resolveExport = resolve;
			});
			mockPlugin.chapterMergeManager.exportMergedDocument.mockReturnValueOnce(pendingExport);

			// Start partial export
			const exportPromise = seam.handleExportMerged();

			// While export is pending, user checks all (or clicks select all)
			seam.chapterSelection.selectAll(items);
			seam.updateSelectionUI();
			expect(seam.exportBtn?.disabled).toBe(true);

			// Duplicate export call while pending must be ignored
			await seam.handleExportMerged();
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).toHaveBeenCalledTimes(1);

			// Resolve export
			resolveExport({
				file: Object.assign(new TFile(), { path: 'Novel/Novel_Merged.md', name: 'Novel_Merged.md' }),
				wordCount: 1000
			});
			await exportPromise;

			// Because export began as subset, clearDraft must NOT have been called
			expect(mockPlugin.chapterMergeManager.clearDraft).not.toHaveBeenCalled();
		});

		it('keeps chapter names and selection when turning off exported titles through the mobile control', async () => {
			const modal = new MobileChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			const modalEl = new MockElement();
			const contentEl = new MockElement();
			modal.modalEl = modalEl as unknown as HTMLElement;
			modal.contentEl = contentEl as unknown as HTMLElement;
			await modal.onOpen();
			const checkbox = contentEl.querySelector('.wn-mobile-merge-checkbox') as unknown as CheckboxElementMock;
			checkbox.checked = false;
			checkbox.onclick?.({ stopPropagation: vi.fn(), shiftKey: false });
			const titleCheckbox = modalEl.querySelector('.wn-merge-checkbox-input') as unknown as {
				checked: boolean;
				onchange: (() => void) | null;
			};
			titleCheckbox.checked = false;
			titleCheckbox.onchange?.();
			expect(contentEl.querySelectorAll('.wn-merge-card-title').map(el => el.textContent)).toEqual(items.map(item => item.title));
			const seam = modal as unknown as MobileChapterMergeModalSeam;
			expect(seam.chapterSelection.getSelectedCount()).toBe(2);
			await seam.handleExportMerged();
			expect(mockPlugin.chapterMergeManager.exportMergedDocument).toHaveBeenCalledWith(mockFolder, items.slice(1), false);
		});

		it('clears draft on mobile full (all-selected) export', async () => {
			const modal = new MobileChapterMergeModal(mockApp as unknown as App, mockPlugin, mockFolder);
			await modal.onOpen();

			const seam = modal as unknown as MobileChapterMergeModalSeam;
			await seam.handleExportMerged();

			expect(mockPlugin.chapterMergeManager.clearDraft).toHaveBeenCalledWith(mockFolder.path);
		});
	});
});
