import { MarkdownView, setIcon, type Editor, type MarkdownFileInfo, type TFile, type WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n';
import { buildLoreOutline, scanLoreHeadings } from '../services/LoreOutline';
import { getLoreGraphAncestors } from '../services/LoreOutlineGraph';
import { isLoreParentRelation, legacyRelationLine } from '../services/LoreRelations';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { smartLocateAndHighlight } from '../utils/leaf';

export function findNewLoreHeading(before: string, after: string, cursorLine: number): number | undefined {
	if (before === after) return undefined;
	const previous = before.split(/\r?\n/);
	const current = after.split(/\r?\n/);
	let start = 0;
	while (start < previous.length && previous[start] === current[start]) start++;
	let oldEnd = previous.length;
	let newEnd = current.length;
	while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === current[newEnd - 1]) {
		oldEnd--;
		newEnd--;
	}
	if (!current.slice(start, newEnd).some(line => /^ {0,3}(?:#{1,5}[ \t]+\S|(?:=+|-+)[ \t]*$)/.test(line))
		&& !/^ {0,3}(?:=+|-+)[ \t]*$/.test(current[newEnd] ?? '')) return undefined;
	const previousOutline = buildLoreOutline(scanLoreHeadings(previous), previous.length);
	const updatedOutline = buildLoreOutline(scanLoreHeadings(current), current.length);
	const heading = updatedOutline.filter(section => section.bodyStart > start && section.line < newEnd && section.line <= cursorLine).at(-1);
	if (!heading || (cursorLine >= heading.bodyEnd && !heading.relationBlocks.some(block => cursorLine < block.end && cursorLine >= block.start))) return undefined;
	const preceding = previousOutline.find(section => section.line === heading.line);
	if (preceding && heading.line < oldEnd && newEnd - start === oldEnd - start) return undefined;
	const previousCount = previousOutline.filter(section => section.title === heading.title && section.level === heading.level).length;
	const currentCount = updatedOutline.filter(section => section.title === heading.title && section.level === heading.level).length;
	return currentCount > previousCount ? heading.line : undefined;
}

export function registerLoreHierarchyPreview(plugin: WebNovelAssistantPlugin) {
	const app = plugin.app;
	const workspace = app.workspace;
	const drafts = new WeakMap<Editor, { file: TFile; source: Promise<string> }>();
	let panel: HTMLElement | undefined;
	let currentPreview: { view: MarkdownView; file: TFile; line: number } | undefined;
	let timer: { win: Window; id: number } | undefined;
	let generation = 0;
	const close = () => {
		panel?.remove();
		panel = undefined;
		currentPreview = undefined;
	};
	const cancelTimer = () => {
		if (timer) timer.win.clearTimeout(timer.id);
		timer = undefined;
	};

	const show = async (file: TFile, book: string, line: number, editorSource?: string, view?: MarkdownView) => {
		const request = ++generation;
		const files = [...new Set([file, ...plugin.characterManager.getEffectiveLoreFiles(book)])];
		const ownerDocument = view?.containerEl.ownerDocument ?? activeDocument;
		const graph = await plugin.relationGraphManager.buildGraphData(file, {
			files, includeHeadingHierarchy: true, autoLinkMentions: false,
			editorSource: editorSource !== undefined ? { file, text: editorSource } : undefined,
		});
		if (generation !== request || !plugin.settings.loreAutoShowAncestors) return;
		if (view && (view.file !== file || workspace.getActiveViewOfType(MarkdownView) !== view
			|| view.editor.getLine(line) !== editorSource?.split(/\r?\n/)[line])) return;
		const entry = graph.nodes.find(node => node.file === file && node.headingLine === line);
		if (!entry) return;
		const byId = new Map(graph.nodes.map(node => [node.id, node]));
		const ancestors = getLoreGraphAncestors(entry, byId);
		close();
		const preview = ownerDocument.body.createDiv({ cls: 'wn-lore-hierarchy-preview', attr: { role: 'region', 'aria-label': t('lore.ancestor-preview') } });
		panel = preview;
		currentPreview = view ? { view, file, line } : undefined;
		const header = preview.createDiv('wn-lore-hierarchy-preview-header');
		header.createEl('strong', { text: t('lore.ancestor-preview') });
		const dismiss = header.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': t('common.close') } });
		setIcon(dismiss, 'x');
		dismiss.addEventListener('click', close);
		const list = preview.createEl('ol', { cls: 'wn-lore-hierarchy-preview-path' });
		for (const node of [...ancestors, entry]) {
			const item = list.createEl('li');
			const button = item.createEl('button', { text: node.heading, attr: { type: 'button', title: node.file.path } });
			if (node === entry) button.setAttribute('aria-current', 'true');
			button.addEventListener('click', () => {
				close();
				if (node.headingLine !== undefined) {
					void smartLocateAndHighlight(app, node.file, [], { splitIfNew: false, fallbackLine: node.headingLine });
				} else {
					void workspace.getLeaf(false).openFile(node.file);
				}
			});
		}
		list.scrollTop = list.scrollHeight;
	};
	const report = (error: unknown) => console.error('Failed to preview the lore hierarchy', error);

	plugin.registerEvent(workspace.on('webnovel:lore-created', (file, book, line) => {
		if (plugin.settings.loreAutoShowAncestors) void show(file, book, line).catch(report);
	}));
	function onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		generation++;
		close();
		const view = leaf?.view;
		if (view instanceof MarkdownView && view.file && view.editor) {
			drafts.set(view.editor, { file: view.file, source: Promise.resolve(view.editor.getValue()) });
		}
	}
	function onEditorChange(editor: Editor, view: MarkdownView | MarkdownFileInfo): void {
		if (!plugin.settings.loreAutoShowAncestors || !(view instanceof MarkdownView) || !view.file) return;
		const file = view.file;
		const manager = plugin.characterManager;
		const book = manager.getBookPathForFile(file) ?? '';
		if (!manager.isLorePath(book, file.parent?.path ?? '')) return;
		let draft = drafts.get(editor);
		if (draft?.file !== file) {
			draft = { file, source: app.vault.cachedRead(file).catch(() => editor.getValue()) };
			drafts.set(editor, draft);
		}
		const before = draft.source;
		cancelTimer();
		const win = view.containerEl.ownerDocument.defaultView ?? window;
		const id = win.setTimeout(() => {
			timer = undefined;
			if (view.file !== file) return;
			const source = editor.getValue();
			drafts.set(editor, { file, source: Promise.resolve(source) });
			if (!editor.hasFocus() || workspace.getActiveViewOfType(MarkdownView) !== view) return;
			void before.then(previous => {
				if (editor.getValue() !== source || view.file !== file || !plugin.settings.loreAutoShowAncestors) return;
				const cursorLine = editor.getCursor().line;
				let line = findNewLoreHeading(previous, source, cursorLine);
				if (line === undefined && currentPreview?.view === view && currentPreview.file === file && previous !== source) {
					const declarations = [cursorLine, cursorLine - 1].filter(index =>
						index >= 0 && isLoreParentRelation(legacyRelationLine.exec(editor.getLine(index))?.[2] ?? ''));
					if (declarations.length) {
						const lines = source.split(/\r?\n/);
						const owner = buildLoreOutline(scanLoreHeadings(lines), lines.length).find(section => section.line === currentPreview?.line);
						if (owner?.relationBlocks.some(block => declarations.some(index => index >= block.bodyStart && index < block.end))) line = owner.line;
					}
				}
				if (line !== undefined) return show(file, book, line, source, view);
			}).catch(report);
		}, 600);
		timer = { win, id };
	}
	plugin.register(() => {
		generation++;
		cancelTimer();
		close();
	});
	return { onActiveLeafChange, onEditorChange };
}
