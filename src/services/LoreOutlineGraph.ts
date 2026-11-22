import type { App, CachedMetadata, TFile } from 'obsidian';
import { buildLoreOutline, findLoreOutlineTarget, getLoreInlineRelations, getLoreSectionProse, scanLoreHeadings, type LoreOutlineHeading } from './LoreOutline';
import type { GraphData, GraphEdge, GraphNode } from './RelationGraphManager';
import { scanFenceLine, type FenceScanState } from './LoreTemplateService';
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
		previous.sectionKey = heading.key;
		// Original term nodes retain their identifiers and add the outline edge only once.
		if (parent && parent !== previous && !previous.outlineParent) {
			previous.outlineParent = parent.id;
			graph.edges.push({ source: parent.id, target: previous.id, label: t('relation-graph.edge-hierarchy'), type: 'hierarchy' });
		}
		return previous;
	}
	const node: GraphNode = {
		id: `\0${JSON.stringify([item.file.path, heading.key])}`,
		file: item.file, sourcePath: item.file.path, heading: heading.title, headingLine: heading.line, sectionKey: heading.key,
		outlineParent: parent?.id, x: 0, y: 0, vx: 0, vy: 0, pinned: false,
	};
	item.nodes.set(heading.line, node);
	graph.nodes.push(node);
	if (parent) graph.edges.push({ source: parent.id, target: node.id, label: t('relation-graph.edge-hierarchy'), type: 'hierarchy' });
	return node;
}

export function addLoreOutlineToGraph(app: App, input: ReadonlyMap<TFile, LoreGraphFile>, graph: GraphData,
	findMentions?: (source: string, lines: string[], terms: { term: string; targetId: string }[]) => GraphEdge[]): void {
	const byPath = new Map<string, OutlineFile>();
	for (const [file, data] of input) {
		byPath.set(file.path, {
			...data, file, outline: buildLoreOutline(scanLoreHeadings(data.lines), data.lines.length), nodes: new Map(),
		});
	}
	for (const node of graph.nodes) {
		const item = byPath.get(node.file.path);
		if (!item) continue;
		if (node.headingLine === undefined) {
			item.fileNode = node;
			const first = item.outline[0];
			if (first) {
				node.headingLine = first.line;
				item.nodes.set(first.line, node);
			}
		}
		else item.nodes.set(node.headingLine, node);
	}
	const names = new Map<string, Set<string>>();
	const ownedText = new Map<string, string[]>();
	for (const item of byPath.values()) {
		if (!item.outline.length && item.fileNode) ownedText.set(item.fileNode.id, item.lines);
		for (const section of item.outline) {
			const node = addHeading(graph, item, section);
			const text = getLoreSectionProse(item.lines, section);
			const aliasText = text.match(/^(?:\*\*|__)?(?:别名|別名|Alias)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/im)?.[1];
			if (node !== item.fileNode) node.aliases = aliasText?.split(/[,，、/|;；]/).map(alias => alias.trim()).filter(Boolean);
			ownedText.set(node.id, text.split('\n'));
		}
	}
	for (const node of graph.nodes) {
		for (const term of [node.heading, ...(node.aliases ?? [])]) {
			const ids = names.get(term) ?? new Set<string>();
			ids.add(node.id);
			names.set(term, ids);
		}
	}
	const explicit = new Set(graph.edges.filter(edge => edge.type === 'explicit').map(edge => JSON.stringify([edge.source, edge.target, edge.label])));
	const addEdge = (source: string, target: string | undefined, label: string) => {
		if (!target || !label || source === target) return;
		const key = JSON.stringify([source, target, label]);
		if (explicit.has(key)) return;
		explicit.add(key);
		graph.edges.push({ source, target, label, type: 'explicit' });
	};
	const resolveLink = (item: OutlineFile, link: string): string | undefined => {
		const [fileName, ...path] = link.split('|')[0].split('#').map(part => part.trim());
		if ((!fileName && !path.length) || path.some(part => !part)) return undefined;
		const targetFile = fileName ? app.metadataCache.getFirstLinkpathDest(fileName, item.file.path) : item.file;
		const targetItem = targetFile && byPath.get(targetFile.path);
		if (!targetItem) return undefined;
		if (!path.length) return targetItem.fileNode?.id;
		const heading = findLoreOutlineTarget(targetItem.outline, path);
		return heading ? targetItem.nodes.get(heading.line)?.id : undefined;
	};
	for (const item of byPath.values()) {
		for (const section of item.outline) {
			const source = item.nodes.get(section.line)!.id;
			for (const relation of getLoreInlineRelations(item.lines, section.bodyStart, section.bodyEnd)) {
				addEdge(source, resolveLink(item, relation.link), relation.label);
			}
			for (const block of section.relationBlocks) {
				const fence: FenceScanState = { inFence: false, fenceChar: '', fenceLength: 0 };
				for (const line of item.lines.slice(block.start + 1, block.end)) {
					const { inFenceBefore, inFenceAfter } = scanFenceLine(line, fence);
					if (inFenceBefore || inFenceAfter) continue;
					const relation = /^(?:[-*]\s+)?(\*\*|__)(.+?)\1\s*[:：]\s*(.+)$/.exec(line.trim());
					if (!relation) continue;
					const label = relation[2].trim();
					const links = [...relation[3].matchAll(/\[\[([^\]]+)\]\]/g)];
					for (const link of links) {
						const bare = link[1].split('|')[0].trim();
						const fallback = /[#/]/.test(bare) ? undefined : names.get(bare);
						addEdge(source, resolveLink(item, link[1]) ?? (fallback?.size === 1 ? fallback.values().next().value : undefined), label);
					}
					if (links.length) continue;
					for (const name of relation[3].split(/[、,，|/]/)) {
						const ids = names.get(name.trim());
						if (ids?.size === 1) addEdge(source, ids.values().next().value, label);
					}
				}
			}
		}
	}
	if (findMentions) {
		const terms = [...names].flatMap(([term, ids]) => ids.size === 1 ? Array.from(ids, targetId => ({ term, targetId })) : [])
			.sort((left, right) => right.term.length - left.term.length);
		const explicitPairs = new Set(graph.edges.filter(edge => edge.type === 'explicit').map(edge => JSON.stringify([edge.source, edge.target])));
		for (const [source, lines] of ownedText) {
			for (const edge of findMentions(source, lines, terms)) {
				if (!explicitPairs.has(JSON.stringify([edge.source, edge.target]))) graph.edges.push(edge);
			}
		}
	}
}
