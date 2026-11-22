import type { App, TFile } from 'obsidian';
import { findLoreOutlineTarget, getFileLoreBody, getFileLoreRelationBlocks, relationBodyLines, type HeadingPosition, type LoreOutlineHeading } from './LoreOutline';
import { isLoreParentRelation, legacyRelationLine, splitLoreRelationTargets } from './LoreRelations';
import { isProtagonistType, readLoreMetadata } from './LoreMetadata';
import type { GraphData, GraphEdge, GraphNode } from './RelationGraphManager';
import { t } from '../i18n';

export function getLoreGraphAncestorPaths(node: GraphNode, nodes: ReadonlyMap<string, GraphNode>): GraphNode[][] {
	interface Step { node: GraphNode; next?: Step }
	const paths: GraphNode[][] = [];
	const pending: Step[] = [];
	const addParents = (entry: GraphNode, next?: Step) => {
		const before = pending.length;
		for (const id of [...entry.outlineParents ?? []].reverse()) {
			const parent = nodes.get(id);
			if (parent) pending.push({ node: parent, next });
		}
		return pending.length > before;
	};
	addParents(node);
	while (pending.length) {
		const step = pending.pop()!;
		if (addParents(step.node, step)) continue;
		const path: GraphNode[] = [];
		for (let part: Step | undefined = step; part; part = part.next) path.push(part.node);
		paths.push(path);
	}
	return paths;
}

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
	const parent = heading.parent?.title ? addHeading(graph, item, heading.parent) : heading.level > 1 ? item.fileNode : undefined;
	if (previous) {
		previous.sectionKey = heading.key;
		if (parent && parent !== previous && !previous.outlineParents) {
			previous.outlineParents = [parent.id];
		}
		return previous;
	}
	const node: GraphNode = {
		id: `\0${JSON.stringify([item.file.path, heading.key])}`,
		file: item.file, sourcePath: item.file.path, heading: heading.title, headingLine: heading.line, sectionKey: heading.key,
		outlineParents: parent ? [parent.id] : undefined, x: 0, y: 0, vx: 0, vy: 0, pinned: false,
	};
	item.nodes.set(heading.line, node);
	graph.nodes.push(node);
	return node;
}

function childrenByParent(parents: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
	const children = new Map<string, string[]>();
	for (const [child, entries] of parents) {
		for (const parent of entries) {
			const siblings = children.get(parent) ?? [];
			siblings.push(child);
			children.set(parent, siblings);
		}
	}
	return children;
}

/** Nodes in the same strongly connected component reach one another in both directions. */
function findHierarchyComponents(parents: ReadonlyMap<string, readonly string[]>): Map<string, string> {
	const visited = new Set<string>();
	const finished: string[] = [];
	for (const start of parents.keys()) {
		if (visited.has(start)) continue;
		const stack = [{ id: start, nextParent: 0 }];
		visited.add(start);
		while (stack.length) {
			const frame = stack[stack.length - 1];
			const parent = parents.get(frame.id)?.[frame.nextParent++];
			if (parent === undefined) {
				finished.push(frame.id);
				stack.pop();
			} else if (!visited.has(parent)) {
				visited.add(parent);
				stack.push({ id: parent, nextParent: 0 });
			}
		}
	}
	const children = childrenByParent(parents);
	const components = new Map<string, string>();
	for (const start of finished.reverse()) {
		if (components.has(start)) continue;
		const stack = [start];
		components.set(start, start);
		while (stack.length) {
			for (const child of children.get(stack.pop()!) ?? []) {
				if (components.has(child)) continue;
				components.set(child, start);
				stack.push(child);
			}
		}
	}
	return components;
}

function attachContinuationNotes(graph: GraphData, candidates: ReadonlyMap<string, Set<string>>, nodes: ReadonlyMap<string, GraphNode>): void {
	const components = candidates.size ? findHierarchyComponents(new Map([...nodes.values()].map(node =>
		[node.id, [...node.outlineParents ?? [], ...candidates.get(node.id) ?? []]]))) : undefined;
	for (const node of nodes.values()) {
		const parents = new Set(node.outlineParents);
		for (const parent of candidates.get(node.id) ?? []) {
			if (components?.get(parent) !== components?.get(node.id)) parents.add(parent);
		}
		if (!parents.size) continue;
		node.outlineParents = [...parents];
		for (const parent of parents) {
			graph.edges.push({ source: parent, target: node.id, label: t('relation-graph.edge-hierarchy'), type: 'hierarchy' });
		}
	}
}

function countDescendants(nodes: ReadonlyMap<string, GraphNode>): void {
	const children = childrenByParent(new Map([...nodes.values()].map(node => [node.id, node.outlineParents ?? []])));
	const remaining = new Map([...children].map(([id, entries]) => [id, entries.length]));
	const shared = new Set<string>(); // Branches containing a node with more than one parent.
	const queue = [...nodes.values()].filter(node => !children.has(node.id));
	for (let index = 0; index < queue.length; index++) {
		const node = queue[index];
		const entries = children.get(node.id) ?? [];
		const sharedBranches = entries.filter(child => shared.has(child)).length;
		if (sharedBranches || (node.outlineParents?.length ?? 0) > 1) shared.add(node.id);
		if (sharedBranches > 1) {
			const descendants = new Set<string>();
			const pending = [...entries];
			while (pending.length) {
				const child = pending.pop()!;
				if (descendants.has(child)) continue;
				descendants.add(child);
				pending.push(...children.get(child) ?? []);
			}
			node.descendantCount = descendants.size;
		} else if (entries.length) {
			node.descendantCount = entries.reduce((count, child) => count + (nodes.get(child)?.descendantCount ?? 0) + 1, 0);
		}
		for (const parent of node.outlineParents ?? []) {
			const next = remaining.get(parent)! - 1;
			remaining.set(parent, next);
			if (!next) queue.push(nodes.get(parent)!);
		}
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
	const continuationParents = new Map<string, Set<string>>();
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
		if (!path.length) {
			const root = targetItem.outline.find(section => section.level === 1 && section.title === targetItem.file.basename);
			return targetItem.fileNode?.id ?? (root && targetItem.nodes.get(root.line)?.id);
		}
		const heading = findLoreOutlineTarget(targetItem.outline, path);
		return heading ? targetItem.nodes.get(heading.line)?.id : undefined;
	};
	for (const item of byPath.values()) {
		const resolveRelationLink = (link: string) => {
			const bare = link.split('|')[0].trim();
			return resolveLink(item, link) ?? (/[#/]/.test(bare) ? undefined : resolveName(bare));
		};
		const sources = item.outline.map(section => ({ source: item.nodes.get(section.line)!.id, blocks: section.relationBlocks }));
		if (!sources.length && item.fileNode) {
			sources.push({ source: item.fileNode.id, blocks: getFileLoreRelationBlocks(item.headings, item.lines.length) });
		}
		for (const { source, blocks } of sources) {
			const parentDeclarations = new Set<string>();
			for (const block of blocks) {
				for (const line of relationBodyLines(item.lines, block)) {
					const relation = legacyRelationLine.exec(line);
					if (!relation) continue;
					const label = relation[2].trim();
					if (block.level === 6 && isLoreParentRelation(label)) {
						for (const target of splitLoreRelationTargets(relation[3])) {
							const link = /^\[\[([^\]]+)\]\]$/.exec(target);
							const parent = link && resolveLink(item, link[1]);
							if (parent && nodesById.get(parent)?.file.path !== item.file.path) parentDeclarations.add(parent);
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
			if (parentDeclarations.size) continuationParents.set(source, parentDeclarations);
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
