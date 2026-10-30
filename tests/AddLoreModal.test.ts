import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import type { App, TextComponent, TextAreaComponent, DropdownComponent, ButtonComponent } from 'obsidian';
import { MockElement } from './mocks/MockElement';
import type { AddLorePlugin } from '../src/ui/AddLoreModal';
import type { ParsedTemplate, TemplateField } from '../src/services/LoreTemplateService';

vi.mock('../src/ui/FileSuggestModal', () => ({
	FileSuggestModal: class FileSuggestModal {
		open = vi.fn();
	},
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	class MockSetting extends actual.Setting {
		override settingEl: HTMLElement;
		override nameEl: HTMLElement;
		override descEl: HTMLElement;
		private container?: MockElement;

		constructor(containerEl?: HTMLElement) {
			super(containerEl ?? (new MockElement() as unknown as HTMLElement));
			const sEl = new MockElement('setting-item');
			const nEl = new MockElement('setting-item-name');
			const dEl = new MockElement('setting-item-description');
			sEl.appendChild(nEl);
			sEl.appendChild(dEl);
			this.settingEl = sEl as unknown as HTMLElement;
			this.nameEl = nEl as unknown as HTMLElement;
			this.descEl = dEl as unknown as HTMLElement;
			if (containerEl && typeof (containerEl as unknown as MockElement).appendChild === 'function') {
				this.container = containerEl as unknown as MockElement;
				this.container.appendChild(sEl);
			}
		}

		override setHeading(): this {
			return this;
		}

		override setName(name: string): this {
			this.nameEl.textContent = name;
			(this.settingEl as unknown as MockElement).textContent += ` ${name}`;
			if (this.container) {
				this.container.textContent += ` ${name}`;
			}
			return this;
		}

		override setDesc(desc: string | DocumentFragment): this {
			this.descEl.textContent = typeof desc === 'string' ? desc : '';
			(this.settingEl as unknown as MockElement).textContent += ` ${this.descEl.textContent}`;
			if (this.container) {
				this.container.textContent += ` ${this.descEl.textContent}`;
			}
			return this;
		}

		override addText(cb: (component: TextComponent) => unknown): this {
			const textObj = {
				setValue: (_v: string) => textObj,
				setPlaceholder: (_p: string) => textObj,
				onChange: (_fn: (v: string) => unknown) => textObj,
				inputEl: { show: () => {}, hide: () => {}, focus: () => {} },
			} as unknown as TextComponent;
			cb(textObj);
			return this;
		}

		override addTextArea(cb: (component: TextAreaComponent) => unknown): this {
			const taObj = {
				setValue: (_v: string) => taObj,
				onChange: (_fn: (v: string) => unknown) => taObj,
				inputEl: { rows: 1 },
			} as unknown as TextAreaComponent;
			cb(taObj);
			return this;
		}

		override addDropdown(cb: (component: DropdownComponent) => unknown): this {
			const ddObj = {
				addOption: (_k: string, _v: string) => ddObj,
				setValue: (_v: string) => ddObj,
				onChange: (_fn: (v: string) => unknown) => ddObj,
			} as unknown as DropdownComponent;
			cb(ddObj);
			return this;
		}

		override addButton(cb: (component: ButtonComponent) => unknown): this {
			const btnObj = {
				setButtonText: (t: string) => {
					(this.settingEl as unknown as MockElement).textContent += ` [${t}]`;
					if (this.container) {
						this.container.textContent += ` [${t}]`;
					}
					return btnObj;
				},
				setDisabled: () => btnObj,
				setCta: () => btnObj,
				onClick: (_fn: () => unknown) => btnObj,
				buttonEl: { show: () => {}, hide: () => {} },
			} as unknown as ButtonComponent;
			cb(btnObj);
			return this;
		}
	}

	return {
		...actual,
		Setting: MockSetting,
	};
});

import { AddLoreModal } from '../src/ui/AddLoreModal';

interface MockVault {
	cachedRead: ReturnType<typeof vi.fn>;
	getAbstractFileByPath: ReturnType<typeof vi.fn>;
}

interface MockApp {
	vault: MockVault;
}

interface MockCharacterManager {
	findLoreFolder: ReturnType<typeof vi.fn>;
	getLoreEntriesInFileOrder: ReturnType<typeof vi.fn>;
	createLoreEntry: ReturnType<typeof vi.fn>;
	getAvailableLoreCategories: ReturnType<typeof vi.fn>;
}

interface MockPlugin {
	characterManager: MockCharacterManager;
	settings: {
		loreTemplateHistory: string[];
	};
	saveSettings: ReturnType<typeof vi.fn>;
}

interface AddLoreModalTestBridge {
	selectedTemplateFile: TFile | null;
	parsedTemplate: ParsedTemplate | null;
	isReadingTemplate: boolean;
	isUpdatingHistory: boolean;
	isModalClosed: boolean;
	templateDraftCache: Map<string, { content: string; values: Record<string, string> }>;
	onSelectTemplate: (file: TFile) => Promise<void>;
	onRemoveHistoryEntry: (path: string) => Promise<void>;
	clearTemplate: () => void;
	templateHistoryContainerEl: HTMLElement | null;
	renderTemplateHistory: () => void;
	historyButtons: Array<{ button: ButtonComponent; action: 'use' | 'remove'; isAvailable?: boolean }>;
	updateHistoryButtonsState: () => void;
}

function asBridge(modal: AddLoreModal): AddLoreModalTestBridge {
	return modal as unknown as AddLoreModalTestBridge;
}

describe('AddLoreModal Async Guards and Draft Cache', () => {
	let mockApp: MockApp;
	let mockPlugin: MockPlugin;

	beforeEach(() => {
		mockApp = {
			vault: {
				cachedRead: vi.fn(),
				getAbstractFileByPath: vi.fn(),
			},
		};
		mockPlugin = {
			characterManager: {
				findLoreFolder: vi.fn().mockReturnValue(null),
				getLoreEntriesInFileOrder: vi.fn().mockReturnValue([]),
				createLoreEntry: vi.fn().mockResolvedValue(true),
				getAvailableLoreCategories: vi.fn().mockResolvedValue([]),
			},
			settings: {
				loreTemplateHistory: [],
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
	});

	function createModal(): AddLoreModal {
		const modal = new AddLoreModal(
			mockApp as unknown as App,
			mockPlugin as unknown as AddLorePlugin,
			'Hero',
			'Book1'
		);
		(modal as unknown as { contentEl: MockElement }).contentEl = new MockElement('modal-content');
		return modal;
	}

	it('should ignore stale out-of-order reads when user selects multiple templates in succession', async () => {
		const modal = createModal();
		const bridge = asBridge(modal);

		const file1 = Object.assign(new TFile(), { path: 'Templates/SlowTemplate.md', basename: 'SlowTemplate' });
		const file2 = Object.assign(new TFile(), { path: 'Templates/FastTemplate.md', basename: 'FastTemplate' });

		let resolveFile1: (val: string) => void = () => {};
		const promise1 = new Promise<string>(res => { resolveFile1 = res; });
		const promise2 = Promise.resolve('**Realm**: Divine');

		mockApp.vault.cachedRead.mockImplementation((file: TFile) => {
			if (file.path === file1.path) return promise1;
			if (file.path === file2.path) return promise2;
			return Promise.resolve('');
		});

		// Trigger read 1 (slow)
		const select1 = bridge.onSelectTemplate(file1);
		// Trigger read 2 (fast)
		const select2 = bridge.onSelectTemplate(file2);

		await select2;
		expect(bridge.selectedTemplateFile?.path).toBe(file2.path);

		// Now slow read resolves late
		resolveFile1('**Realm**: Mortal');
		await select1;

		// Must still be file2, file1 must NOT overwrite
		expect(bridge.selectedTemplateFile?.path).toBe(file2.path);
		expect(bridge.parsedTemplate?.fields[0].label).toBe('Realm');
		expect(bridge.parsedTemplate?.fields[0].defaultValue).toBe('Divine');
	});

	it('should prevent pending template reads from applying after clearTemplate', async () => {
		const modal = createModal();
		const bridge = asBridge(modal);
		const file1 = Object.assign(new TFile(), { path: 'Templates/Pending.md', basename: 'Pending' });

		let resolveFile1: (val: string) => void = () => {};
		const promise1 = new Promise<string>(res => { resolveFile1 = res; });
		mockApp.vault.cachedRead.mockReturnValue(promise1);

		const selectPromise = bridge.onSelectTemplate(file1);
		expect(bridge.isReadingTemplate).toBe(true);

		// User clears template while read is still pending
		bridge.clearTemplate();
		expect(bridge.isReadingTemplate).toBe(false);
		expect(bridge.selectedTemplateFile).toBeNull();

		// Pending read completes
		resolveFile1('**Title**: Warlord');
		await selectPromise;

		// Must remain cleared
		expect(bridge.selectedTemplateFile).toBeNull();
		expect(bridge.parsedTemplate).toBeNull();
	});

	it('should abort pending read and not touch UI if modal is closed', async () => {
		const modal = createModal();
		const bridge = asBridge(modal);
		const file1 = Object.assign(new TFile(), { path: 'Templates/Pending.md', basename: 'Pending' });

		let resolveFile1: (val: string) => void = () => {};
		const promise1 = new Promise<string>(res => { resolveFile1 = res; });
		mockApp.vault.cachedRead.mockReturnValue(promise1);

		const selectPromise = bridge.onSelectTemplate(file1);

		// Modal closes
		modal.onClose();
		expect(bridge.isModalClosed).toBe(true);

		// Read resolves after close
		resolveFile1('**Title**: Warlord');
		await selectPromise;

		expect(bridge.selectedTemplateFile).toBeNull();
		expect(bridge.isReadingTemplate).toBe(false);
	});

	it('should retain prior valid template and draft if a subsequent template read fails', async () => {
		const modal = createModal();
		const bridge = asBridge(modal);
		const file1 = Object.assign(new TFile(), { path: 'Templates/Valid.md', basename: 'Valid' });
		const file2 = Object.assign(new TFile(), { path: 'Templates/Broken.md', basename: 'Broken' });

		mockApp.vault.cachedRead.mockImplementation((file: TFile) => {
			if (file.path === file1.path) return Promise.resolve('**Element**: Fire');
			if (file.path === file2.path) return Promise.reject(new Error('Disk read error'));
			return Promise.resolve('');
		});

		await bridge.onSelectTemplate(file1);
		expect(bridge.selectedTemplateFile?.path).toBe(file1.path);

		// Now selecting broken file fails
		await bridge.onSelectTemplate(file2);

		// Prior valid template and state are preserved
		expect(bridge.selectedTemplateFile?.path).toBe(file1.path);
		expect(bridge.parsedTemplate?.fields[0].label).toBe('Element');
	});

	it('should reuse edits if template source is unchanged, but reset defaults if template source changed', async () => {
		const modal = createModal();
		const bridge = asBridge(modal);
		const file1 = Object.assign(new TFile(), { path: 'Templates/Profile.md', basename: 'Profile' });

		// First load of version 1
		mockApp.vault.cachedRead.mockResolvedValue('**Power**: 100');
		await bridge.onSelectTemplate(file1);

		// User edits field
		const fieldId = bridge.parsedTemplate?.fields[0].id;
		expect(fieldId).toBeDefined();
		if (!fieldId) return;

		const cached = bridge.templateDraftCache.get(file1.path);
		expect(cached).toBeDefined();
		if (!cached) return;
		cached.values[fieldId] = '999';

		// Select another template, then re-select file1 with same content
		const otherFile = Object.assign(new TFile(), { path: 'Templates/Other.md', basename: 'Other' });
		mockApp.vault.cachedRead.mockResolvedValue('**Other**: X');
		await bridge.onSelectTemplate(otherFile);

		mockApp.vault.cachedRead.mockResolvedValue('**Power**: 100');
		await bridge.onSelectTemplate(file1);

		// User's edited draft '999' is preserved!
		const currentDraft1 = bridge.templateDraftCache.get(file1.path);
		expect(currentDraft1?.values[fieldId]).toBe('999');

		// Now template file source changes on disk
		mockApp.vault.cachedRead.mockResolvedValue('**Power**: 200\n**Speed**: 50');
		await bridge.onSelectTemplate(file1);

		// Source changed -> fresh defaults are loaded, stale draft is replaced!
		const currentDraft2 = bridge.templateDraftCache.get(file1.path);
		const newPowerField = bridge.parsedTemplate?.fields.find((f: TemplateField) => f.label === 'Power');
		expect(newPowerField).toBeDefined();
		if (!newPowerField) return;
		expect(currentDraft2?.values[newPowerField.id]).toBe('200');
	});

	describe('Persistent lore template history in AddLoreModal', () => {
		it('should remember chosen template in plugin history and persist upon successful read', async () => {
			const modal1 = createModal();
			const bridge1 = asBridge(modal1);
			const file1 = Object.assign(new TFile(), { path: 'Templates/Warrior.md', basename: 'Warrior' });
			mockApp.vault.cachedRead.mockResolvedValue('**Role**: Fighter');

			await bridge1.onSelectTemplate(file1);

			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/Warrior.md']);
			expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);

			// Reopen second modal using same shared plugin settings
			const modal2 = createModal();
			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/Warrior.md']);
			await modal2.onOpen();
			const bridge2 = asBridge(modal2);
			expect(bridge2.templateHistoryContainerEl).not.toBeNull();
			expect(bridge2.templateHistoryContainerEl?.textContent).toContain('Warrior.md');
		});

		it('should move an existing entry to the front (MRU) without duplicates on quick-use', async () => {
			mockPlugin.settings.loreTemplateHistory = ['Templates/B.md', 'Templates/A.md'];
			const modal = createModal();
			const bridge = asBridge(modal);
			const fileA = Object.assign(new TFile(), { path: 'Templates/A.md', basename: 'A' });
			mockApp.vault.cachedRead.mockResolvedValue('**Stat**: High');

			await bridge.onSelectTemplate(fileA);

			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/A.md', 'Templates/B.md']);
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
		});

		it('should allow removing a history record leaving current selection, draft, and files intact', async () => {
			mockPlugin.settings.loreTemplateHistory = ['Templates/A.md'];
			const modal = createModal();
			const bridge = asBridge(modal);
			const fileA = Object.assign(new TFile(), { path: 'Templates/A.md', basename: 'A' });
			mockApp.vault.cachedRead.mockResolvedValue('**Stat**: High');

			await bridge.onSelectTemplate(fileA);
			expect(bridge.selectedTemplateFile?.path).toBe('Templates/A.md');

			// User removes the record from history
			await bridge.onRemoveHistoryEntry('Templates/A.md');

			// Record removed and persisted
			expect(mockPlugin.settings.loreTemplateHistory).toEqual([]);
			expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2);

			// Active selection and draft remain completely intact
			expect(bridge.selectedTemplateFile?.path).toBe('Templates/A.md');
			expect(bridge.parsedTemplate?.fields[0].label).toBe('Stat');
			expect(bridge.templateDraftCache.has('Templates/A.md')).toBe(true);
		});

		it('should resolve paths via getAbstractFileByPath only and mark missing files unavailable', async () => {
			mockPlugin.settings.loreTemplateHistory = ['Templates/Deleted.md'];
			mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'Templates/Deleted.md') return null;
				return null;
			});

			const modal = createModal();
			await modal.onOpen();
			const bridge = asBridge(modal);

			expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('Templates/Deleted.md');
			// No cachedRead or other vault enumeration should have happened for missing file
			expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();

			const historyEl = bridge.templateHistoryContainerEl;
			expect(historyEl).not.toBeNull();
			const unavailableLabel = historyEl?.querySelector('.is-unavailable') ?? historyEl?.querySelector('.setting-item-description');
			expect(unavailableLabel?.textContent).toContain('Deleted.md');
			const useButton = bridge.historyButtons.find(item => item.action === 'use')!;
			const removeButton = bridge.historyButtons.find(item => item.action === 'remove')!;
			const useDisabled = vi.spyOn(useButton.button, 'setDisabled');
			const removeDisabled = vi.spyOn(removeButton.button, 'setDisabled');
			bridge.updateHistoryButtonsState();
			expect(useDisabled).toHaveBeenCalledWith(true);
			expect(removeDisabled).toHaveBeenCalledWith(false);
		});

		it('ignores a stale remove action after the modal has closed', async () => {
			mockPlugin.settings.loreTemplateHistory = ['Templates/Existing.md'];
			const modal = createModal();
			modal.onClose();
			await asBridge(modal).onRemoveHistoryEntry('Templates/Existing.md');
			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/Existing.md']);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it('should not add to history on failed or stale reads', async () => {
			mockPlugin.settings.loreTemplateHistory = ['Templates/Existing.md'];
			const modal = createModal();
			const bridge = asBridge(modal);

			const brokenFile = Object.assign(new TFile(), { path: 'Templates/Broken.md', basename: 'Broken' });
			mockApp.vault.cachedRead.mockRejectedValue(new Error('Disk read failure'));

			await bridge.onSelectTemplate(brokenFile);

			// History unchanged, saveSettings not called
			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/Existing.md']);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it('should handle settings persistence failure, restore previous history if matching exact ref, and keep loaded template usable', async () => {
			mockPlugin.settings.loreTemplateHistory = ['Templates/Old.md'];
			mockPlugin.saveSettings.mockRejectedValueOnce(new Error('Disk write error'));

			const modal = createModal();
			const bridge = asBridge(modal);
			const file = Object.assign(new TFile(), { path: 'Templates/New.md', basename: 'New' });
			mockApp.vault.cachedRead.mockResolvedValue('**Role**: Mage');

			await bridge.onSelectTemplate(file);

			// Template read succeeded and is committed/usable
			expect(bridge.selectedTemplateFile?.path).toBe('Templates/New.md');
			expect(bridge.parsedTemplate?.fields[0].label).toBe('Role');

			// History was rolled back to previous history because reference matched
			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/Old.md']);
		});

		it('should not overwrite concurrent history changes on save failure if reference was changed', async () => {
			const initialHistory = ['Templates/Initial.md'];
			mockPlugin.settings.loreTemplateHistory = initialHistory;

			const concurrentHistory = ['Templates/Concurrent.md'];
			mockPlugin.saveSettings.mockImplementation(async () => {
				// Simulate another action concurrently updating the array reference before rejection
				mockPlugin.settings.loreTemplateHistory = concurrentHistory;
				throw new Error('Save failed');
			});

			const modal = createModal();
			const bridge = asBridge(modal);
			const file = Object.assign(new TFile(), { path: 'Templates/New.md', basename: 'New' });
			mockApp.vault.cachedRead.mockResolvedValue('**Role**: Rogue');

			await bridge.onSelectTemplate(file);

			// Concurrent history reference was NOT overwritten with initialHistory
			expect(mockPlugin.settings.loreTemplateHistory).toBe(concurrentHistory);
		});

		it('should finish persistence safely if modal closes while persistence is in flight', async () => {
			mockPlugin.settings.loreTemplateHistory = [];
			let resolveSave: () => void = () => {};
			mockPlugin.saveSettings.mockReturnValue(new Promise<void>(res => { resolveSave = res; }));

			const modal = createModal();
			const bridge = asBridge(modal);
			const file = Object.assign(new TFile(), { path: 'Templates/A.md', basename: 'A' });
			mockApp.vault.cachedRead.mockResolvedValue('**X**: 1');

			const selectPromise = bridge.onSelectTemplate(file);
			// Wait for read to commit and enter history save
			await new Promise(r => setTimeout(r, 10));

			// Close modal while save is in flight
			modal.onClose();
			expect(bridge.isModalClosed).toBe(true);

			// Persistence resolves
			resolveSave();
			await selectPromise;

			expect(mockPlugin.settings.loreTemplateHistory).toEqual(['Templates/A.md']);
		});
	});
});
