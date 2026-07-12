/**
 * 关系图谱数据管理器 (Relation Graph Manager)
 *
 * 负责从设定文件（lore files）中解析角色词条和角色之间的关系，
 * 构建图谱所需的节点 + 有向边数据模型。
 *
 * 数据来源：
 * 1. 节点 — 设定文件中的 ## 二级标题（与 CharacterManager 一致）
 * 2. 显式关系 — 每个角色下 `### 关系` 三级标题块中的 `**关系类型**：目标角色` 格式
 * 3. 隐式引用 — 角色正文中提到的其他已知角色名（自动生成 "提及" 类型的边）
 *
 * 所有关系均为有向：声明者为 source（箭头起点），被指向者为 target（箭头终点）。
 * 同一对角色可拥有两条方向不同的边（如 A→喜欢→B 和 B→厌恶→A）。
 */

import type { App, CachedMetadata, HeadingCache } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import { findBookRoot } from '../utils/path';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

// ==========================================
// 类型定义
// ==========================================

/** 图谱节点 — 代表一个角色词条 */
export interface GraphNode {
	/** 角色名（唯一标识），取自 ## 标题文本 */
	id: string;
	/** 所属设定文件 */
	file: TFile;
	/** 原始标题文本（清理 Markdown 格式后） */
	heading: string;
	/** Canvas 坐标 x（初始化为 0，由 ForceLayoutEngine 赋值） */
	x: number;
	/** Canvas 坐标 y */
	y: number;
	/** 速度分量 x（力导向算法使用） */
	vx: number;
	/** 速度分量 y */
	vy: number;
	/** 是否被用户拖拽固定 */
	pinned: boolean;
	/** 是否为主角色 (例如 "类型：主角") */
	isProtagonist?: boolean;
	/** 节点角色类型（例如 "主角", "配角", "反派"） */
	nodeType?: string;
}

/**
 * 图谱边 — 代表一条有向关系
 *
 * 关系的方向性由声明者决定：
 * - 若 A 的设定写 `### 关系\n**喜欢**：B`，则 source=A, target=B, label="喜欢"
 * - 若 B 的设定写 `### 关系\n**厌恶**：A`，则 source=B, target=A, label="厌恶"
 * 这两条边方向相反，是两条独立的有向边。
 */
export interface GraphEdge {
	/** 声明关系的角色（箭头起点） */
	source: string;
	/** 被指向的角色（箭头终点） */
	target: string;
	/** 关系描述标签（如 "喜欢"、"师父"、"提及"） */
	label: string;
	/** 关系来源类型：explicit=用户在 ### 关系 中显式声明，mention=正文自动扫描 */
	type: 'explicit' | 'mention';
}

/** 完整的图谱数据 */
export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

// ==========================================
// 常量
// ==========================================

/**
 * 匹配 `### 关系` 标题的候选关键词集合
 * 同时支持中英文，确保国际化兼容
 */
const RELATION_HEADING_KEYWORDS: ReadonlySet<string> = new Set([
	'关系', 'relation', 'relations', 'relationships',
]);

/**
 * 匹配 `**关系类型**：目标角色` 格式的正则
 *
 * 捕获组 1 = 关系标签（如 "喜欢"），捕获组 2 = 目标列表
 * 支持 ** 和 __ 两种加粗语法，支持半角/全角冒号
 */
const RELATION_LINE_REGEX = /(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:：]\s*(.+)/;

/**
 * 目标角色分隔符正则
 * 支持：顿号、半角逗号、全角逗号、竖线、斜杠
 */
const TARGET_SEPARATOR_REGEX = /[、,，|/]/;

// ==========================================
// 管理器实现
// ==========================================

export class RelationGraphManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 解析指定设定文件，构建完整的图谱数据
	 *
	 * @param file 要解析的设定文件（必须位于设定文件夹内）
	 * @returns 包含节点和有向边的图谱数据，若无有效数据则返回空图谱
	 */
	public async buildGraphData(file: TFile): Promise<GraphData> {
		let filesToParse: TFile[] = [file];

		if (this.plugin.settings.loreGraphEnableGlobal) {
			const bookRoot = findBookRoot(this.app, this.plugin, file);
			const loreFolderName = this.plugin.settings.loreFolderName || '设定';
			const lorePath = bookRoot ? (bookRoot === '/' ? loreFolderName : `${bookRoot}/${loreFolderName}`) : '';
			if (lorePath) {
				const loreFolder = this.app.vault.getAbstractFileByPath(lorePath);
				if (loreFolder && loreFolder instanceof TFolder) {
					const getAllMdFiles = (folder: TFolder): TFile[] => {
						let results: TFile[] = [];
						for (const child of folder.children) {
							if (child instanceof TFile && child.extension === 'md') {
								results.push(child);
							} else if (child instanceof TFolder) {
								results = results.concat(getAllMdFiles(child));
							}
						}
						return results;
					};
					const folderFiles = getAllMdFiles(loreFolder);
					if (folderFiles.length > 0) {
						filesToParse = folderFiles;
					}
				}
			}
		}

		const allNodes: GraphNode[] = [];
		const nodeIds = new Set<string>();

		// 第一步：提取所有节点
		for (const f of filesToParse) {
			const fileCache = this.app.metadataCache.getFileCache(f);
			if (!fileCache?.headings) continue;

			const content = await this.app.vault.cachedRead(f);
			const lines = content.split('\n');
			const nodes = this.extractNodes(f, fileCache, lines);
			
			for (const node of nodes) {
				if (!nodeIds.has(node.id)) {
					nodeIds.add(node.id);
					allNodes.push(node);
				}
			}
		}

		if (allNodes.length === 0) {
			return { nodes: [], edges: [] };
		}

		// 第二步：解析关系
		const allEdges: GraphEdge[] = [];
		const directedPairs = new Set<string>();
		const uniqueExplicitEdges = new Set<string>();

		for (const f of filesToParse) {
			const fileCache = this.app.metadataCache.getFileCache(f);
			if (!fileCache?.headings) continue;

			const content = await this.app.vault.cachedRead(f);
			const lines = content.split('\n');

			for (let i = 0; i < fileCache.headings.length; i++) {
				const heading = fileCache.headings[i];
				if (heading.level !== 2) continue;

				const characterName = this.cleanHeadingText(heading.heading);
				if (!characterName || !nodeIds.has(characterName)) continue;

				const sectionStart = heading.position.end.line + 1;
				const sectionEnd = this.findNextHeadingLine(fileCache.headings, i, 2, lines.length);

				const relationSection = this.findRelationSection(fileCache.headings, i, sectionStart, sectionEnd, lines);

				if (relationSection) {
					const explicitEdges = this.parseExplicitRelations(
						characterName, lines, relationSection.startLine, relationSection.endLine, nodeIds
					);
					for (const edge of explicitEdges) {
						const pairKey = `${edge.source}→${edge.target}`;
						const uniqueKey = `${pairKey}|${edge.label}`;
						if (!uniqueExplicitEdges.has(uniqueKey)) {
							uniqueExplicitEdges.add(uniqueKey);
							directedPairs.add(pairKey);
							allEdges.push(edge);
						}
					}
				}

				if (this.plugin.settings.loreGraphAutoLinkMentions) {
					const mentionEdges = this.scanMentions(
						characterName, lines, sectionStart, sectionEnd, relationSection, nodeIds
					);
					for (const edge of mentionEdges) {
						const pairKey = `${edge.source}→${edge.target}`;
						if (!directedPairs.has(pairKey)) {
							directedPairs.add(pairKey);
							allEdges.push(edge);
						}
					}
				}
			}
		}

		return { nodes: allNodes, edges: allEdges };
	}

	/**
	 * 从文件缓存中提取所有 ## 二级标题作为图谱节点
	 *
	 * 仅识别二级标题，与 CharacterManager 的策略一致。
	 * 清理 Markdown 加粗/斜体/代码等格式标记后作为节点 id。
	 */
	private extractNodes(file: TFile, fileCache: CachedMetadata, lines: string[]): GraphNode[] {
		const nodes: GraphNode[] = [];
		const seenIds = new Set<string>();

		if (!fileCache.headings) return nodes;

		for (let i = 0; i < fileCache.headings.length; i++) {
			const heading = fileCache.headings[i];
			if (heading.level !== 2) continue;

			const headingText = this.cleanHeadingText(heading.heading);
			if (!headingText || seenIds.has(headingText)) continue;

			seenIds.add(headingText);

			// 解析“类型”
			let isProtagonist = false;
			let nodeType: string | undefined = undefined;
			const sectionStart = heading.position.end.line + 1;
			const sectionEnd = this.findNextHeadingLine(fileCache.headings, i, 2, lines.length);
			
			for (let lineIdx = sectionStart; lineIdx < sectionEnd; lineIdx++) {
				const chunk = lines[lineIdx];
				// 查找 类型：主角、**类型**：主角 等
				const typeMatch = chunk.match(/(?:\*\*|__)?(?:类型|Type)(?:\*\*|__)?\s*[:：]\s*([^\n]+)/i);
				if (typeMatch) {
					const typeStr = typeMatch[1].trim();
					nodeType = typeStr;
					if (typeStr.includes('主角')) {
						isProtagonist = true;
					}
					break;
				}
			}

			nodes.push({
				id: headingText,
				file,
				heading: headingText,
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				pinned: false,
				isProtagonist,
				nodeType,
			});
		}

		return nodes;
	}

	/**
	 * 在当前 ## 标题的区段内，查找 `### 关系` 三级标题的行范围
	 *
	 * @returns 关系区段的起止行号，若未找到则返回 null
	 */
	private findRelationSection(
		headings: HeadingCache[],
		currentH2Index: number,
		sectionStart: number,
		sectionEnd: number,
		lines: string[]
	): { startLine: number; endLine: number } | null {
		// 在当前 ## 的子标题中查找 ### 关系
		for (let h = currentH2Index + 1; h < headings.length; h++) {
			const sub = headings[h];
			// 遇到下一个 ## 或更高级标题时停止搜索
			if (sub.level <= 2) break;

			// 只关注 ### 三级标题
			if (sub.level !== 3) continue;

			// 检查标题文本是否匹配关系关键词
			const subText = this.cleanHeadingText(sub.heading).toLowerCase();
			if (!RELATION_HEADING_KEYWORDS.has(subText)) continue;

			// 已找到关系标题，确定其内容的行范围
			const relStart = sub.position.end.line + 1;
			if (relStart >= sectionEnd) return null;

			// 关系块结束于：下一个同级或更高级标题、或当前 ## 区段结束
			let relEnd = sectionEnd;
			for (let n = h + 1; n < headings.length; n++) {
				if (headings[n].level <= 3) {
					relEnd = Math.min(headings[n].position.start.line, sectionEnd);
					break;
				}
			}

			return { startLine: relStart, endLine: relEnd };
		}

		// 兜底：如果没有用 ### 标题声明，尝试搜索纯文本行 "关系："
		// 这是为了向后兼容可能的自由格式写法
		for (let lineIdx = sectionStart; lineIdx < sectionEnd; lineIdx++) {
			const trimmed = lines[lineIdx]?.trim() || '';
			if (trimmed.startsWith('### ')) {
				const headingText = trimmed.slice(4).trim().toLowerCase();
				if (RELATION_HEADING_KEYWORDS.has(headingText)) {
					const relStart = lineIdx + 1;
					// 查找块结束
					let relEnd = sectionEnd;
					for (let k = relStart; k < sectionEnd; k++) {
						if (lines[k]?.trim().startsWith('### ') || lines[k]?.trim().startsWith('## ')) {
							relEnd = k;
							break;
						}
					}
					return { startLine: relStart, endLine: relEnd };
				}
			}
		}

		return null;
	}

	/**
	 * 解析 ### 关系 块中的显式关系声明
	 *
	 * 格式：`**关系标签**：目标角色[、目标角色2…]`
	 * 每个目标角色生成一条有向边：当前角色 →关系标签→ 目标角色
	 */
	private parseExplicitRelations(
		sourceName: string,
		lines: string[],
		startLine: number,
		endLine: number,
		validNodeIds: Set<string>
	): GraphEdge[] {
		const edges: GraphEdge[] = [];

		for (let i = startLine; i < endLine; i++) {
			const line = lines[i]?.trim();
			if (!line) continue;

			const match = RELATION_LINE_REGEX.exec(line);
			if (!match?.[1] || !match[2]) continue;

			const relationLabel = match[1].trim();
			const targetList = match[2].trim();

			// 分隔多个目标角色
			const targets = targetList.split(TARGET_SEPARATOR_REGEX);
			for (let rawTarget of targets) {
				rawTarget = rawTarget.trim();
				if (!rawTarget) continue;

				// 提取真正的角色名：支持裸文本或 Obsidian 链接格式如 [[#林芝夏]]、[[文件#林芝夏|别名]]、[[林芝夏]]
				let target = rawTarget;
				const linkMatch = target.match(/\[\[(.*?)\]\]/);
				if (linkMatch) {
					let inner = linkMatch[1];
					if (inner.includes('|')) inner = inner.split('|')[0];
					if (inner.includes('#')) {
						const parts = inner.split('#');
						inner = parts[parts.length - 1]; // 取 # 后面的真实标题
					}
					target = inner.trim();
				}

				// 只添加指向已知角色节点的边
				if (target && validNodeIds.has(target) && target !== sourceName) {
					edges.push({
						source: sourceName,
						target,
						label: relationLabel,
						type: 'explicit',
					});
				}
			}
		}

		return edges;
	}

	/**
	 * 在角色正文区段中扫描其他已知角色名的出现
	 *
	 * 排除 ### 关系 块的行，避免与显式关系重复。
	 * 每个被提及的角色生成一条 type: 'mention' 的有向边。
	 */
	private scanMentions(
		sourceName: string,
		lines: string[],
		sectionStart: number,
		sectionEnd: number,
		relationSection: { startLine: number; endLine: number } | null,
		validNodeIds: Set<string>
	): GraphEdge[] {
		const mentioned = new Set<string>();
		const edges: GraphEdge[] = [];

		for (let i = sectionStart; i < sectionEnd; i++) {
			// 跳过关系声明块，避免将显式声明的目标角色重复计入
			if (relationSection && i >= relationSection.startLine && i < relationSection.endLine) {
				continue;
			}

			const line = lines[i] || '';
			for (const nodeId of validNodeIds) {
				if (nodeId === sourceName) continue;
				if (mentioned.has(nodeId)) continue;

				if (line.includes(nodeId)) {
					mentioned.add(nodeId);
					edges.push({
						source: sourceName,
						target: nodeId,
						label: t('relation-graph.edge-mention'),
						type: 'mention',
					});
				}
			}
		}

		return edges;
	}

	/**
	 * 查找当前标题到下一个同级或更高级标题之间的行号
	 *
	 * @param headings 完整的标题列表
	 * @param currentIndex 当前标题在列表中的索引
	 * @param maxLevel 当前标题的级别（2 表示 ##）
	 * @param totalLines 文件总行数
	 * @returns 区段结束行号（不含，即半开区间的右边界）
	 */
	private findNextHeadingLine(
		headings: HeadingCache[],
		currentIndex: number,
		maxLevel: number,
		totalLines: number
	): number {
		for (let h = currentIndex + 1; h < headings.length; h++) {
			if (headings[h].level <= maxLevel) {
				return headings[h].position.start.line;
			}
		}
		return totalLines;
	}

	/**
	 * 清理 Markdown 标题中的格式标记（加粗、斜体、行内代码）
	 *
	 * 与 CharacterManager.addFileToCacheIfValidInto 中的清理逻辑保持一致
	 */
	private cleanHeadingText(raw: string): string {
		return raw
			.trim()
			.replace(/\*\*|__/g, '')
			.replace(/\*|_/g, '')
			.replace(/`/g, '');
	}
}
