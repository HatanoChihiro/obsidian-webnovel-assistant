import { MarkdownView, type App, type Scope, type TFile } from 'obsidian';
import { formatRelativeLoreLink } from '../services/LoreRelations';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { LoreRelationTargetPicker } from './LoreRelationEditor';

interface LoreLinkSource {
	file: TFile;
	book: string;
	selected: string;
	insert: (link: string) => void;
}

const loreTextFields = new WeakMap<Element, () => LoreLinkSource>();
const shortcutHandlers = new WeakMap<App, (event: KeyboardEvent) => false | undefined>();

export function readLoreLinkShortcut(event: KeyboardEvent): string | undefined {
	if (event.isComposing || event.getModifierState('AltGraph')) return;
	const modifiers = [
		event.ctrlKey ? 'Ctrl' : '',
		event.altKey ? 'Alt' : '',
		event.shiftKey ? 'Shift' : '',
		event.metaKey ? 'Meta' : '',
	].filter(Boolean);
	const { key } = event;
	if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return [...modifiers, key].join('+');
	if (!modifiers.some(value => value !== 'Shift') || key.length !== 1) return;
	const label = key === ' ' ? 'Space' : key === '+' ? 'Plus' : key.toUpperCase();
	return [...modifiers, label].join('+');
}

export function registerLoreQuickLinkShortcut(plugin: WebNovelAssistantPlugin): void {
	const { app } = plugin;
	const handle = (event: KeyboardEvent) => {
		const key = plugin.settings.loreQuickLinkShortcut;
		if (!key || readLoreLinkShortcut(event) !== key || event.repeat) return;
		if (checkLoreQuickLink(plugin, false)) return false;
	};
	const handler = app.scope.register(null, null, handle);
	shortcutHandlers.set(app, handle);
	plugin.register(() => {
		app.scope.unregister(handler);
		shortcutHandlers.delete(app);
	});
}

export function registerLoreQuickLinkModalScope(app: App, scope: Scope): void {
	scope.register(null, null, event => shortcutHandlers.get(app)?.(event));
}

/** Register the body fields that save to an existing lore note. */
export function registerLoreLinkField(input: HTMLTextAreaElement, file: TFile, book: string): void {
	loreTextFields.set(input, () => {
		const original = input.value;
		const { selectionStart: from, selectionEnd: to } = input;
		return {
			file,
			book,
			selected: original.slice(from, to),
			insert: link => {
				if (!input.isConnected || input.value !== original) return;
				input.setRangeText(link, from, to, 'end');
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.focus();
			},
		};
	});
}

function activeLoreLinkSource(app: App, plugin: WebNovelAssistantPlugin): LoreLinkSource | undefined {
	const focused = activeDocument.activeElement;
	const field = focused && loreTextFields.get(focused);
	if (field) return field();
	if (focused?.closest('input, textarea, .modal-container')) return;

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const file = view?.file;
	if (!view || !file || view.getMode() !== 'source' || view.editor.listSelections().length !== 1) return;
	const book = plugin.characterManager.getBookPathForFile(file);
	if (book === null || !plugin.characterManager.findLoreFolder(book)) return;

	const editor = view.editor;
	const original = editor.getValue();
	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	return {
		file,
		book,
		selected: editor.getRange(from, to),
		insert: link => {
			if (view.file !== file || view.editor !== editor || editor.getValue() !== original) return;
			editor.replaceRange(link, from, to);
			editor.setCursor({ line: from.line, ch: from.ch + link.length });
			editor.focus();
		},
	};
}

export function checkLoreQuickLink(plugin: WebNovelAssistantPlugin, checking: boolean): boolean {
	if (!plugin.settings.enableLoreQuickLink) return false;
	const source = activeLoreLinkSource(plugin.app, plugin);
	if (!source || /[\r\n]/.test(source.selected)) return false;
	if (checking) return true;

	const manager = plugin.characterManager;
	void manager.ensureInitialized().then(() => {
		if (!plugin.settings.enableLoreQuickLink) return;
		const entries = manager.getLoreEntriesInFileOrder(source.book);
		new LoreRelationTargetPicker(plugin.app, entries, entry => {
			if (!plugin.settings.enableLoreQuickLink || plugin.app.vault.getFileByPath(entry.file.path) !== entry.file) return;
			source.insert(formatRelativeLoreLink(entry, source.file.path));
		}).openForQuery(source.selected.trim());
	}).catch(error => console.error('[WNA] Failed to load lore link suggestions:', error));
	return true;
}
