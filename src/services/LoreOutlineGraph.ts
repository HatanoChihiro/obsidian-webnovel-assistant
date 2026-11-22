import type { App, TFile } from 'obsidian';
import { findLoreOutlineTarget, getFileLoreBody, getFileLoreRelationBlocks, relationBodyLines, type HeadingPosition, type LoreOutlineHeading } from './LoreOutline';
import { isLoreParentRelation, legacyRelationLine, splitLoreRelationTargets } from './LoreRelations';
import { isProtagonistType, readLoreMetadata } from './LoreMetadata';
import type { GraphData, GraphEdge, GraphNode } from './RelationGraphManager';
import { t } from '../i18n';

export interface LoreGraphFile {
	frontmatter?: Record<string, unknown>;
	lines: string[];
	headings: HeadingPosition[];
	outline?: LoreOutlineHeading[];
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

function attachContinuationNotes(graph: GraphData, candidates: ReadonlyMap<string, string>, nodes: ReadonlyMap<string, GraphNode>): void {
	const checked = new Set<string>();
	const cyclic = new Set<string>();
	for (const start of candidates.keys()) {
		const path = new Set<string>();
		let id: string | undefined = start;
		while (id && !checked.has(id) && !path.has(id)) {
			path.add(id);
			id = candidates.get(id) ?? nodes.get(id)?.outlineParent;
		}
		if (id && path.has(id)) {
			let mark = false;
			for (const step of path) {
				if (step === id) mark = true;
				if (mark) cyclic.add(step);
			}
		}
		for (const step of path) checked.add(step);
	}
	for (const [child, parent] of candidates) {
		if (cyclic.has(child)) continue;
		nodes.get(child)!.outlineParent = parent;
		graph.edges.push({ source: parent, target: child, label: t('relation-graph.edge-hierarchy'), type: 'hierarchy' });
	}
}

function countDescendants(nodes: ReadonlyMap<string, GraphNode>): void {
	const remainingChildren = new Map<string, number>();
	for (const node of nodes.values()) {
		if (node.outlineParent) remainingChildren.set(node.outlineParent, (remainingChildren.get(node.outlineParent) ?? 0) + 1);
	}
	const queue = [...nodes.values()].filter(node => !remainingChildren.has(node.id));
	for (let index = 0; index < queue.length; index++) {
		const node = queue[index];
		if (!node.outlineParent) continue;
		const parent = nodes.get(node.outlineParent);
		if (!parent) continue;
		parent.descendantCount = (parent.descendantCount ?? 0) + (node.descendantCount ?? 0) + 1;
		const remaining = remainingChildren.get(parent.id)! - 1;
		remainingChildren.set(parent.id, remaining);
		if (!remaining) queue.push(parent);
	}
}

export function addLoreOutlineToGraph(app: App, input: ReadonlyMap<TFile, LoreGraphFile>, graph: GraphData,
	findMentions?: (source: string, lines: string[], terms: { term: string; targetId: string }[]) => GraphEdge[]): void {
	const originalIds = new Set(graph.nodes.map(node => node.id));
	const byPath = new Map<string, OutlineFile>();
	for (const [file, data] of input) {
		byPath.set(file.path, {
			...data, file, outline: data.outline ?? [], nodes: new Map(),
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
		if (!item.outline.length && item.fileNode) ownedText.set(item.fileNode.id, getFileLoreBody(item.lines, item.headings));
		for (const section of item.outline) {
			const node = addHeading(graph, item, section);
			const body = item.lines.slice(section.bodyStart, section.bodyEnd);
			const { type, aliases } = readLoreMetadata(body, node === item.fileNode ? item.frontmatter : undefined);
			node.nodeType = type || undefined;
			node.isProtagonist = isProtagonistType(type);
			node.aliases = aliases.filter(alias => alias !== node.heading);
			ownedText.set(node.id, body);
		}
	}
	const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
	const continuationParents = new Map<string, string>();
	for (const node of graph.nodes) {
		for (const term of [node.heading, ...(node.aliases ?? [])]) {
			const ids = names.get(term) ?? new Set<string>();
			ids.add(node.id);
			names.set(term, ids);
		}
	}
	const explicit = new Set(graph.edges.filter(edge => edge.type === 'explicit').map(edge => JSON.stringify([edge.source, edge.target, edge.label])));
	const resolveName = (name: string): string | undefined => {
		const ids = names.get(name);
		if (!ids) return undefined;
		if (ids.size === 1 || ids.has(name)) return ids.has(name) ? name : ids.values().next().value;
		return [...ids].find(id => originalIds.has(id));
	};
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
		const resolveRelationLink = (link: string) => {
			const bare = link.split('|')[0].trim();
			return resolveLink(item, link) ?? (/[#/]/.test(bare) ? undefined : resolveName(bare));
		};
		const sources = item.outline.map(section => ({ source: item.nodes.get(section.line)!.id, blocks: section.relationBlocks }));
		const root = item.outline[0]?.level === 1 ? item.nodes.get(item.outline[0].line) : undefined;
		if (!sources.length && item.fileNode) {
			sources.push({ source: item.fileNode.id, blocks: getFileLoreRelationBlocks(item.headings, item.lines.length) });
		}
		for (const { source, blocks } of sources) {
			const parentDeclarations = new Set<string | undefined>();
			for (const block of blocks) {
				for (const line of relationBodyLines(item.lines, block)) {
					const relation = legacyRelationLine.exec(line);
					if (!relation) continue;
					const label = relation[2].trim();
					if (block.level === 6 && isLoreParentRelation(label)) {
						if (root?.id === source && !root.outlineParent) {
							const link = /^\[\[([^\]]+)\]\]$/.exec(relation[3].trim());
							const target = link && resolveLink(item, link[1]);
							const parent = target ? nodesById.get(target) : undefined;
							parentDeclarations.add(parent && parent.file.path !== item.file.path ? parent.id : undefined);
						}
						continue;
					}
					for (const target of splitLoreRelationTargets(relation[3])) {
						const link = /^\[\[([^\]]+)\]\]$/.exec(target);
						if (link) addEdge(source, resolveRelationLink(link[1]), label);
						else for (const name of target.split(/[|/]/)) addEdge(source, resolveName(name.trim()), label);
					}
				}
			}
			const parent = parentDeclarations.values().next().value;
			if (parentDeclarations.size === 1 && parent) continuationParents.set(source, parent);
		}
	}
	attachContinuationNotes(graph, continuationParents, nodesById);
	countDescendants(nodesById);
	if (findMentions) {
		const terms = [...names.keys()].flatMap(term => {
			const targetId = resolveName(term);
			return targetId ? [{ term, targetId }] : [];
		})
			.sort((left, right) => right.term.length - left.term.length);
		const explicitPairs = new Set(graph.edges.map(edge => JSON.stringify([edge.source, edge.target])));
		for (const edge of graph.edges) {
			if (edge.type === 'hierarchy') explicitPairs.add(JSON.stringify([edge.target, edge.source]));
		}
		for (const [source, lines] of ownedText) {
			for (const edge of findMentions(source, lines, terms)) {
				if (!explicitPairs.has(JSON.stringify([edge.source, edge.target]))) graph.edges.push(edge);
			}
		}
	}
}
