import { editorInfoField, MarkdownRenderChild, type Plugin, type TFile } from 'obsidian';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { buildLoreOutline, relationBodyLines, scanLoreHeadings, type LoreOutlineHeading } from '../services/LoreOutline';
import { getLoreGraphAncestorPaths } from '../services/LoreOutlineGraph';
import { isLoreParentRelation, legacyRelationLine } from '../services/LoreRelations';
import type { GraphData, GraphNode } from '../services/RelationGraphManager';
import { cleanLoreHeading } from '../services/CharacterManager';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { renderLoreAncestorRow } from '../ui/components/LoreAncestorRow';
import { smartLocateAndHighlight } from '../utils/leaf';

export function getLoreAncestorLayoutKey(lines: readonly string[], outline: readonly LoreOutlineHeading[]): string {
	return JSON.stringify(outline.map(section => [
		section.key, section.bodyStart, section.relationBlocks.flatMap(block => {
			if (block.level !== 6) return [];
			return relationBodyLines(lines, block).flatMap(line => {
				const field = legacyRelationLine.exec(line);
				return field && isLoreParentRelation(field[2]) ? [field[3].trim()] : [];
			});
		}),
	]));
}

const replaceAncestorRows = StateEffect.define<DecorationSet>();
const getPathKey = (paths: readonly GraphNode[][], folded: boolean) => JSON.stringify([
	folded, paths.map(path => path.map(node => [node.heading, node.file.path, node.headingLine])),
]);
const ancestorRows = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(rows, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(replaceAncestorRows)) return effect.value;
		}
		if (transaction.startState.field(editorInfoField, false)?.file !== transaction.state.field(editorInfoField, false)?.file) {
			return Decoration.none;
		}
		return rows.map(transaction.changes);
	},
	provide: field => EditorView.decorations.from(field),
});

export function registerLoreAncestorPaths(plugin: WebNovelAssistantPlugin & Pick<Plugin, 'registerEditorExtension' | 'registerMarkdownPostProcessor'>): void {
	const app = plugin.app;
	const manager = plugin.characterManager;
	const refreshers = new Set<() => void>();
	const savedGraphs = new Map<string, Promise<GraphData>>();
	const bookFiles = new Map<string, Map<string, TFile>>();
	const indexes = new WeakMap<GraphData, { byId: Map<string, GraphNode>; byFile: Map<string, Map<number, GraphNode>> }>();
	const isEnabled = () => plugin.settings.loreAutoShowAncestors !== false;
	const isFolded = () => plugin.settings.loreFoldAncestorPath === true;
	const bookFor = (file: TFile) => {
		const book = manager.getBookPathForFile(file) ?? '';
		return manager.isLorePath(book, file.parent?.path ?? '') ? book : undefined;
	};
	const getGraph = async (file: TFile, book: string, source?: string): Promise<GraphData> => {
		let effective = bookFiles.get(book);
		if (!effective) {
			effective = new Map(manager.getEffectiveLoreFiles(book).map(candidate => [candidate.path, candidate]));
			bookFiles.set(book, effective);
		}
		const inBook = effective.has(file.path);
		const key = JSON.stringify([book, inBook ? '' : file.path]);
		if (source !== undefined && (await app.vault.cachedRead(file)).replace(/\r\n/g, '\n') !== source) {
			return plugin.relationGraphManager.buildGraphData(file, {
				files: inBook ? [...effective.values()] : [file, ...effective.values()],
				includeHeadingHierarchy: true, autoLinkMentions: false, editorSource: { file, text: source },
			});
		}
		const existing = savedGraphs.get(key);
		if (existing) return existing;
		const files = inBook ? [...effective.values()] : [file, ...effective.values()];
		const reading = plugin.relationGraphManager.buildGraphData(file, { files, includeHeadingHierarchy: true, autoLinkMentions: false });
		savedGraphs.set(key, reading);
		void reading.catch(() => {
			if (savedGraphs.get(key) === reading) savedGraphs.delete(key);
		});
		return reading;
	};
	const graphIndex = (graph: GraphData) => {
		const previous = indexes.get(graph);
		if (previous) return previous;
		const byId = new Map(graph.nodes.map(node => [node.id, node]));
		const byFile = new Map<string, Map<number, GraphNode>>();
		for (const node of graph.nodes) {
			if (node.headingLine === undefined) continue;
			const byLine = byFile.get(node.file.path) ?? new Map<number, GraphNode>();
			byLine.set(node.headingLine, node);
			byFile.set(node.file.path, byLine);
		}
		const index = { byId, byFile };
		indexes.set(graph, index);
		return index;
	};
	const renderRow = (row: HTMLElement, paths: readonly GraphNode[][], folded: boolean, remeasure?: () => void) => {
		renderLoreAncestorRow(row, paths.map(path => path.map(node => node.heading)), folded, (pathIndex, index) => {
			const node = paths[pathIndex][index];
			if (node.headingLine === undefined) {
				void app.workspace.getLeaf(false).openFile(node.file);
			} else {
				void smartLocateAndHighlight(app, node.file, [], { splitIfNew: false, fallbackLine: node.headingLine });
			}
		}, remeasure);
	};
	class AncestorWidget extends WidgetType {
		private readonly key: string;
		constructor(private readonly paths: GraphNode[][], private readonly folded: boolean) {
			super();
			this.key = getPathKey(paths, folded);
		}
		eq(other: AncestorWidget): boolean {
			return this.key === other.key;
		}
		toDOM(view: EditorView): HTMLElement {
			const row = view.dom.ownerDocument.adoptNode(createDiv());
			renderRow(row, this.paths, this.folded, () => view.requestMeasure());
			return row;
		}
	}

	const editorPaths = ViewPlugin.fromClass(class {
		private readonly win: Window;
		private file?: TFile | null;
		private book?: string;
		private signature = '';
		private timer?: number;
		private revision = 0;
		private refresh = () => { this.setFile(); this.schedule(true); };

		constructor(private readonly view: EditorView) {
			this.win = view.dom.ownerDocument.defaultView ?? window;
			refreshers.add(this.refresh);
			this.refresh();
		}
		private setFile(): void {
			this.file = this.view.state.field(editorInfoField, false)?.file;
			this.book = this.file ? bookFor(this.file) : undefined;
		}
		update(update: ViewUpdate): void {
			const file = update.state.field(editorInfoField, false)?.file;
			if (file !== this.file) this.refresh();
			else if (this.book !== undefined && update.docChanged && isEnabled()) this.schedule(false);
		}
		private schedule(force: boolean): void {
			if (this.timer !== undefined) this.win.clearTimeout(this.timer);
			const revision = ++this.revision;
			this.timer = this.win.setTimeout(() => {
				this.timer = undefined;
				void this.updateRows(revision, force).catch(() => {
					// A lore note may be removed during a refresh.
					if (revision === this.revision) this.signature = '';
				});
			}, force ? 0 : 280);
		}
		private async updateRows(revision: number, force: boolean): Promise<void> {
			if (!this.file || this.book === undefined || !isEnabled()) {
				this.signature = '';
				if (this.view.state.field(ancestorRows).size) this.view.dispatch({ effects: replaceAncestorRows.of(Decoration.none) });
				return;
			}
			const file = this.file;
			const doc = this.view.state.doc;
			const source = doc.toString();
			const lines = source.split('\n');
			const outline = buildLoreOutline(scanLoreHeadings(lines), lines.length);
			const key = getLoreAncestorLayoutKey(lines, outline);
			if (key === this.signature && !force) return;
			const graph = await getGraph(file, this.book, source);
			if (revision !== this.revision || doc !== this.view.state.doc || this.file !== file || !isEnabled()) return;
			const { byId, byFile } = graphIndex(graph);
			const byLine = byFile.get(file.path);
			const marks = outline.flatMap(section => {
				const node = byLine?.get(section.line);
				if (!node?.outlineParents?.length) return [];
				const paths = getLoreGraphAncestorPaths(node, byId);
				if (!paths.length) return [];
				return [Decoration.widget({ widget: new AncestorWidget(paths, isFolded()), block: true, side: 1 }).range(doc.line(section.bodyStart).to)];
			});
			this.signature = key;
			this.view.dispatch({ effects: replaceAncestorRows.of(Decoration.set(marks)) });
		}
		destroy(): void {
			this.revision++;
			if (this.timer !== undefined) this.win.clearTimeout(this.timer);
			refreshers.delete(this.refresh);
		}
	});
	plugin.registerEditorExtension([ancestorRows, editorPaths]);

	plugin.registerMarkdownPostProcessor((element, context) => {
		const file = app.vault.getFileByPath(context.sourcePath);
		if (!file) return;
		const book = bookFor(file);
		const headings = Array.from(element.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5'));
		if (book === undefined || !headings.length || !context.getSectionInfo(element)) return;
		const rows = new Map<HTMLElement, { row: HTMLElement; key: string }>();
		let revision = 0;
		const clear = () => {
			for (const { row } of rows.values()) row.remove();
			rows.clear();
		};
		const refresh = () => {
			const request = ++revision;
			if (!isEnabled()) {
				clear();
				return;
			}
			void getGraph(file, book).then(graph => {
				const section = context.getSectionInfo(element);
				if (request !== revision || !section || !isEnabled()) return;
				const { byId, byFile } = graphIndex(graph);
				const byLine = byFile.get(file.path);
				const candidates: GraphNode[] = [];
				for (let line = section.lineStart; line <= section.lineEnd; line++) {
					const node = byLine?.get(line);
					if (node) candidates.push(node);
				}
				for (const heading of headings) {
					const name = cleanLoreHeading(heading.textContent ?? '');
					const exact = candidates.findIndex(node => node.heading === name);
					const index = exact >= 0 ? exact : headings.length === 1 && candidates.length === 1 ? 0 : -1;
					const node = index >= 0 ? candidates.splice(index, 1)[0] : undefined;
					const paths = node ? getLoreGraphAncestorPaths(node, byId) : [];
					const folded = isFolded();
					const key = getPathKey(paths, folded);
					const old = rows.get(heading);
					if (old?.key === key) continue;
					old?.row.remove();
					rows.delete(heading);
					if (!paths.length) continue;
					const row = heading.ownerDocument.adoptNode(createDiv());
					renderRow(row, paths, folded);
					heading.after(row);
					rows.set(heading, { row, key });
				}
			}).catch(() => { /* This note may no longer be available. */ });
		};
		const child = new MarkdownRenderChild(element);
		child.register(() => { revision++; clear(); refreshers.delete(refresh); });
		context.addChild(child);
		refreshers.add(refresh);
		refresh();
	});
	plugin.registerEvent(app.workspace.on('webnovel-workbench-lore-updated', () => {
		savedGraphs.clear();
		bookFiles.clear();
		for (const refresh of refreshers) refresh();
	}));
	plugin.register(() => {
		savedGraphs.clear();
		bookFiles.clear();
		refreshers.clear();
	});
}
