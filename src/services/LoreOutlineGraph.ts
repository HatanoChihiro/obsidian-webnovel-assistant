import type { App, CachedMetadata, TFile } from 'obsidian';
import { buildLoreOutline, findLoreOutlineTarget, readLoreInlineRelation, type LoreOutlineHeading } from './LoreOutline';
import { scanFenceLine, type FenceScanState } from './LoreTemplateService';
import type { GraphData, GraphNode } from './RelationGraphManager';
import { t } from '../i18n';

export interface LoreGraphFile {
	fileCache: CachedMetadata;
	lines: string[];
}

interface OutlineFile extends LoreGraphFile {
	file: TFile;
	outline: LoreOutlineHeading[];
	nodes: Map<number, GraphNode>;
	fileNode?: GraphNode;
}

function addHeading(graph: GraphData, item: OutlineFile, heading: LoreOutlineHeading): GraphNode {
	const previous = item.nodes.get(heading.line);
	const parent = heading.parent?.title ? addHeading(graph, item, heading.parent) : item.fileNode;
	if (previous) {
		// Original term nodes retain their identifiers and add the outline edge only once.
		if (parent && !previous.outlineParent) {
			previous.outlineParent = parent.id;
			graph.edges.push({ source: parent.id, target: previous.id, label: t('relation-graph.edge-hierarchy'), type: 'hierarchy' });
		}
		return previous;
	}
	const node: GraphNode = {
		id: `\0${JSON.stringify([item.file.path, heading.key])}`,
		file: item.file, sourcePath: item.file.path, heading: heading.title, headingLine: heading.line,
		outlineParent: parent?.id, x: 0, y: 0, vx: 0, vy: 0, pinned: false,
	};
	item.nodes.set(heading.line, node);
	graph.nodes.push(node);
	if (parent) graph.edges.push({ source: parent.id, target: node.id, label: t('relation-graph.edge-hierarchy'), type: 'hierarchy' });
	return node;
}

export function addLoreOutlineToGraph(app: App, input: ReadonlyMap<TFile, LoreGraphFile>, graph: GraphData): void {
	const byPath = new Map<string, OutlineFile>();
	for (const [file, data] of input) {
		byPath.set(file.path, {
			...data, file, outline: buildLoreOutline(data.fileCache.headings ?? [], data.lines.length), nodes: new Map(),
		});
	}
	for (const node of graph.nodes) {
		const item = byPath.get(node.file.path);
		if (!item) continue;
		if (node.headingLine === undefined) item.fileNode = node;
		else item.nodes.set(node.headingLine, node);
	}
	const explicit = new Set(graph.edges.filter(edge => edge.type === 'explicit').map(edge => JSON.stringify([edge.source, edge.target, edge.label])));
	for (const item of byPath.values()) {
		const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
		let commented = false;
		let headingIndex = 0;
		const start = (item.fileCache.frontmatterPosition?.end.line ?? -1) + 1;
		for (let line = start; line < item.lines.length; line++) {
			while (item.outline[headingIndex] && item.outline[headingIndex].bodyEnd <= line) headingIndex++;
			const heading = item.outline[headingIndex];
			if (heading?.line === line && item.nodes.has(line)) addHeading(graph, item, heading);
			const content = item.lines[line];
			if (!commented) {
				const state = scanFenceLine(content, fence);
				if (state.inFenceBefore || state.inFenceAfter) continue;
			}
			const startsInComment = commented;
			if ((content.match(/%%/g)?.length ?? 0) % 2) commented = !commented;
			if (startsInComment || commented || !heading || line < heading.bodyStart) continue;
			const relation = readLoreInlineRelation(content);
			if (!relation) continue;
			const [fileName, ...path] = relation.link.split('|')[0].split('#').map(part => part.trim());
			if ((!fileName && !path.length) || path.some(part => !part)) continue;
			const targetFile = fileName ? app.metadataCache.getFirstLinkpathDest(fileName, item.file.path) : item.file;
			const targetItem = targetFile && byPath.get(targetFile.path);
			if (!targetItem) continue;
			const targetHeading = path.length ? findLoreOutlineTarget(targetItem.outline, path) : undefined;
			const target = targetHeading ? addHeading(graph, targetItem, targetHeading) : path.length ? undefined : targetItem.fileNode;
			if (!target) continue;
			const source = addHeading(graph, item, heading);
			const key = JSON.stringify([source.id, target.id, relation.label]);
			if (source === target || explicit.has(key)) continue;
			explicit.add(key);
			graph.edges.push({ source: source.id, target: target.id, label: relation.label, type: 'explicit' });
		}
	}
}
