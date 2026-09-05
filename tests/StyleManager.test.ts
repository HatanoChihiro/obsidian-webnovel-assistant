import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StyleManager } from '../src/services/StyleManager';
import type { App, EventRef, WorkspaceWindow } from 'obsidian';
import type { AccurateCountSettings } from '../src/types/settings';

function createMockDoc() {
	return {
		body: {
			classList: {
				add: vi.fn(),
				remove: vi.fn()
			},
			style: {
				setProperty: vi.fn(),
				removeProperty: vi.fn()
			}
		}
	} as unknown as Document;
}

describe('StyleManager', () => {
	let settings: AccurateCountSettings;
	let mainDoc: Document;
	let leafDoc: Document;
	let settingsDoc: Document;
	let eventHandlers: Record<string, (win: WorkspaceWindow, window: Window) => void>;
	let app: App;
	let styleManager: StyleManager;

	beforeEach(() => {
		settings = {
			eyeCareEnabled: true,
			eyeCareColor: '#E8F5E9'
		} as AccurateCountSettings;

		mainDoc = createMockDoc();
		leafDoc = createMockDoc();
		settingsDoc = createMockDoc();
		eventHandlers = {};

		app = {
			workspace: {
				containerEl: { ownerDocument: mainDoc },
				iterateAllLeaves: (callback: (leaf: { containerEl: { ownerDocument: Document } }) => void) => {
					callback({ containerEl: { ownerDocument: leafDoc } });
				},
				on: vi.fn((name: string, handler: (win: WorkspaceWindow, window: Window) => void) => {
					eventHandlers[name] = handler;
					return { name } as unknown as EventRef;
				}),
				offref: vi.fn((ref: EventRef) => {
					const name = (ref as unknown as { name: string }).name;
					delete eventHandlers[name];
				})
			}
		} as unknown as App;

		// Simulate Settings opened in a separate window
		(globalThis as unknown as { activeDocument: Document }).activeDocument = settingsDoc;

		styleManager = new StyleManager(app, settings);
	});

	it('styles main and leaf docs when toggled from detached settings', () => {
		styleManager.applyEyeCare();

		expect(mainDoc.body.classList.add).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(mainDoc.body.style.setProperty).toHaveBeenCalledWith('--webnovel-eye-care-color', '#E8F5E9');

		expect(leafDoc.body.classList.add).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(leafDoc.body.style.setProperty).toHaveBeenCalledWith('--webnovel-eye-care-color', '#E8F5E9');

		expect(settingsDoc.body.classList.add).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(settingsDoc.body.style.setProperty).toHaveBeenCalledWith('--webnovel-eye-care-color', '#E8F5E9');
	});

	it('updates eye-care color across all accessible documents', () => {
		styleManager.applyEyeCare();

		settings.eyeCareColor = '#FAF7EE';
		styleManager.updateSettings(settings);
		styleManager.applyEyeCare();

		expect(mainDoc.body.style.setProperty).toHaveBeenLastCalledWith('--webnovel-eye-care-color', '#FAF7EE');
		expect(leafDoc.body.style.setProperty).toHaveBeenLastCalledWith('--webnovel-eye-care-color', '#FAF7EE');
		expect(settingsDoc.body.style.setProperty).toHaveBeenLastCalledWith('--webnovel-eye-care-color', '#FAF7EE');
	});

	it('styles a new document on window-open', () => {
		styleManager.applyEyeCare();
		expect(eventHandlers['window-open']).toBeDefined();

		const newDoc = createMockDoc();
		eventHandlers['window-open']({ doc: newDoc } as unknown as WorkspaceWindow, {} as Window);

		expect(newDoc.body.classList.add).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(newDoc.body.style.setProperty).toHaveBeenCalledWith('--webnovel-eye-care-color', '#E8F5E9');
	});

	it('cleans document on window-close and prevents later duplicate cleanup or retained tracking', () => {
		styleManager.applyEyeCare();
		expect(eventHandlers['window-close']).toBeDefined();

		const popoutDoc = createMockDoc();
		eventHandlers['window-open']({ doc: popoutDoc } as unknown as WorkspaceWindow, {} as Window);

		// Trigger window-close
		eventHandlers['window-close']({ doc: popoutDoc } as unknown as WorkspaceWindow, {} as Window);

		expect(popoutDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(popoutDoc.body.style.removeProperty).toHaveBeenCalledWith('--webnovel-eye-care-color');

		// Reset mock counters to verify popoutDoc is no longer tracked
		vi.clearAllMocks();

		// Calling removeEyeCare should NOT clean popoutDoc again because it was untracked on window-close
		styleManager.removeEyeCare();
		expect(popoutDoc.body.classList.remove).not.toHaveBeenCalled();
		expect(popoutDoc.body.style.removeProperty).not.toHaveBeenCalled();

		// But main and leaf docs that are still open are cleaned
		expect(mainDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(leafDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
	});

	it('unregisters both event refs and cleans remaining documents on disable', () => {
		styleManager.applyEyeCare();
		expect(eventHandlers['window-open']).toBeDefined();
		expect(eventHandlers['window-close']).toBeDefined();

		styleManager.removeEyeCare();

		expect(app.workspace.offref).toHaveBeenCalledTimes(2);
		expect(eventHandlers['window-open']).toBeUndefined();
		expect(eventHandlers['window-close']).toBeUndefined();

		expect(mainDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(mainDoc.body.style.removeProperty).toHaveBeenCalledWith('--webnovel-eye-care-color');
		expect(leafDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(leafDoc.body.style.removeProperty).toHaveBeenCalledWith('--webnovel-eye-care-color');
	});

	it('unregisters both event refs and cleans remaining documents on destroy', () => {
		styleManager.applyEyeCare();

		styleManager.destroy();

		expect(app.workspace.offref).toHaveBeenCalledTimes(2);
		expect(eventHandlers['window-open']).toBeUndefined();
		expect(eventHandlers['window-close']).toBeUndefined();

		expect(mainDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(mainDoc.body.style.removeProperty).toHaveBeenCalledWith('--webnovel-eye-care-color');
		expect(leafDoc.body.classList.remove).toHaveBeenCalledWith('webnovel-eye-care-enabled');
		expect(leafDoc.body.style.removeProperty).toHaveBeenCalledWith('--webnovel-eye-care-color');
	});
});
