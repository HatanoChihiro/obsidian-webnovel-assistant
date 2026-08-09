import type { GraphNode, GraphEdge, GraphData } from '../../services/RelationGraphManager';



export interface ThemeColors {
	accent: string;
	textNormal: string;
	textMuted: string;
	textFaint: string;
	bgPrimary: string;
	graphNode: string;
	graphLine: string;
	graphText: string;
	graphNodeFocused: string;
	protagonistOverlay: string;
	protagonistOverlayHover: string;
	protagonistShadow: string;
	mentionLineColor: string;
	mentionTextColor: string;
	mentionBorderColor: string;
	mentionLineDash: number[];
	mentionLabelDash: number[];
	typePalette: string[];
}

export interface EdgeRenderTask {
	edge: GraphEdge;
	src: GraphNode;
	tgt: GraphNode;
	drawMode: string;
	offset: number;
	isHighlighted: boolean;
	isDimmed: boolean;
	isMention: boolean;
	showLabel: boolean;
	labelX: number;
	labelY: number;
	bgWidth: number;
	bgHeight: number;
	priority: number;
	isOverlapped: boolean;
}

export interface GraphRenderState {
	scale: number;
	panX: number;
	panY: number;
	selectedNode: GraphNode | null;
	hoveredNode: GraphNode | null;
	isLocalMode: boolean;
	localFocusNode: GraphNode | null;
	edgeDrawModeMap: Map<GraphEdge, 'hide' | 'bidirectional'>;
	edgeOffsetMap: Map<GraphEdge, number>;
	combinedLabelMap: Map<GraphEdge, string>;
	graphData: GraphData;
	filterMatchNodeIds?: ReadonlySet<string>;
}

export class GraphRenderer {
	static readonly NODE_RADIUS = 5;
	static readonly NODE_HIGHLIGHT_RADIUS = 7;
	static readonly DPR = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

	private static edgeCacheMap = new WeakMap<GraphData, { offsetMap: Map<GraphEdge, number>; drawModeMap: Map<GraphEdge, 'hide' | 'bidirectional'>; labelMap: Map<GraphEdge, string> }>();

	static buildEdgeOffsets(graphData: GraphData, state: GraphRenderState, force: boolean = false): void {
		if (!graphData || !graphData.edges) return;

		// 拓扑结构缓存控制：当 graphData 缓存有效且不要求强制重建时，重用已知计算结果
		if (!force && this.edgeCacheMap.has(graphData)) {
			const cached = this.edgeCacheMap.get(graphData)!;
			state.edgeOffsetMap = cached.offsetMap;
			state.edgeDrawModeMap = cached.drawModeMap;
			state.combinedLabelMap = cached.labelMap;
			return;
		}

		state.edgeOffsetMap.clear();
		state.edgeDrawModeMap.clear();
		state.combinedLabelMap.clear();

		const pairMap = new Map<string, GraphEdge[]>();
		for (const edge of graphData.edges) {
			const id1 = edge.source < edge.target ? edge.source : edge.target;
			const id2 = edge.source < edge.target ? edge.target : edge.source;
			const key = `${id1}_${id2}`;
			if (!pairMap.has(key)) pairMap.set(key, []);
			pairMap.get(key)!.push(edge);
		}

		for (const edges of pairMap.values()) {
			const CURVE_OFFSET = 20;
			const visualLines: GraphEdge[] = [];

			const forwards = edges.filter(e => e.source < e.target);
			const backwards = edges.filter(e => e.source > e.target);

			const forwardLabels = new Map<string, GraphEdge[]>();
			for (const e of forwards) {
				const k = `${e.label}|${e.type}`;
				if (!forwardLabels.has(k)) forwardLabels.set(k, []);
				forwardLabels.get(k)!.push(e);
			}

			const backwardLabels = new Map<string, GraphEdge[]>();
			for (const e of backwards) {
				const k = `${e.label}|${e.type}`;
				if (!backwardLabels.has(k)) backwardLabels.set(k, []);
				backwardLabels.get(k)!.push(e);
			}

			const bidirectionalKeys = new Set<string>();
			for (const k of forwardLabels.keys()) {
				if (backwardLabels.has(k)) {
					bidirectionalKeys.add(k);
				}
			}

			const bidiEdges: GraphEdge[] = [];
			const fwdEdges: GraphEdge[] = [];
			const bwdEdges: GraphEdge[] = [];

			for (const e of forwards) {
				const k = `${e.label}|${e.type}`;
				if (bidirectionalKeys.has(k)) bidiEdges.push(e);
				else fwdEdges.push(e);
			}
			for (const e of backwards) {
				const k = `${e.label}|${e.type}`;
				if (bidirectionalKeys.has(k)) bidiEdges.push(e);
				else bwdEdges.push(e);
			}

			const addVisualLine = (group: GraphEdge[], mode: 'bidirectional' | 'normal') => {
				if (group.length === 0) return;
				
				let primary = group.find(e => e.type !== 'mention');
				if (!primary) primary = group[0];
				
				if (mode === 'bidirectional') {
					state.edgeDrawModeMap.set(primary, 'bidirectional');
				}
				
				const uniqueLabels = Array.from(new Set(group.map(e => e.label))).filter(Boolean);
				if (uniqueLabels.length > 0) {
					state.combinedLabelMap.set(primary, uniqueLabels.join('|'));
				}
				
				for (const e of group) {
					if (e !== primary) state.edgeDrawModeMap.set(e, 'hide');
				}
				
				visualLines.push(primary);
			};

			addVisualLine(bidiEdges, 'bidirectional');
			addVisualLine(fwdEdges, 'normal');
			addVisualLine(bwdEdges, 'normal');

			if (visualLines.length === 1) {
				state.edgeOffsetMap.set(visualLines[0], 0);
			} else {
				const step = CURVE_OFFSET * 2;
				const baseOffset = -((visualLines.length - 1) * step) / 2;
				
				visualLines.forEach((edge, index) => {
					let offset = baseOffset + index * step;
					if (edge.source > edge.target) {
						offset = -offset;
					}
					state.edgeOffsetMap.set(edge, offset);
				});
			}
		}

		this.edgeCacheMap.set(graphData, {
			offsetMap: state.edgeOffsetMap,
			drawModeMap: state.edgeDrawModeMap,
			labelMap: state.combinedLabelMap
		});
	}

	static render(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		layout: GraphData,
		state: GraphRenderState,
		colors: ThemeColors
	): void {
		ctx.clearRect(0, 0, width * GraphRenderer.DPR, height * GraphRenderer.DPR);
		
		ctx.save();
		ctx.scale(GraphRenderer.DPR, GraphRenderer.DPR);
		ctx.translate(width / 2 + state.panX, height / 2 + state.panY);
		ctx.scale(state.scale, state.scale);
		ctx.translate(-width / 2, -height / 2);

		state.graphData = layout;

		const edgeTasks = GraphRenderer.renderEdges(ctx, colors, state);
		GraphRenderer.drawNodes(ctx, layout, colors, edgeTasks, state);

		ctx.restore();
	}

	static truncateNodeName(name: string): string {
		const parts = name.split('/');
		return parts[parts.length - 1] || name;
	}

	static getThemeColors(el: HTMLElement): ThemeColors {
		

		const rootStyle = getComputedStyle(el);
		const colors = {
			accent: rootStyle.getPropertyValue('--interactive-accent').trim() || '#7f6df2',
			textNormal: rootStyle.getPropertyValue('--text-normal').trim() || '#dcddde',
			textMuted: rootStyle.getPropertyValue('--text-muted').trim() || '#999',
			textFaint: rootStyle.getPropertyValue('--text-faint').trim() || '#666',
			bgPrimary: rootStyle.getPropertyValue('--background-primary').trim() || '#1e1e1e',
			// Graph specific variables (fallback to sensible defaults if not defined by theme)
			graphNode: rootStyle.getPropertyValue('--graph-node').trim() || rootStyle.getPropertyValue('--text-muted').trim() || '#999',
			graphLine: rootStyle.getPropertyValue('--graph-line').trim() || rootStyle.getPropertyValue('--background-modifier-border').trim() || '#444',
			graphText: rootStyle.getPropertyValue('--graph-text').trim() || rootStyle.getPropertyValue('--text-normal').trim() || '#dcddde',
			graphNodeFocused: rootStyle.getPropertyValue('--graph-node-focused').trim() || rootStyle.getPropertyValue('--interactive-accent').trim() || '#7f6df2',
			
			// 设定图谱专属
			protagonistOverlay: rootStyle.getPropertyValue('--wna-rg-protagonist-overlay').trim() || 'rgba(224, 108, 117, 0.5)',
			protagonistOverlayHover: rootStyle.getPropertyValue('--wna-rg-protagonist-overlay-hover').trim() || 'rgba(224, 108, 117, 0.8)',
						protagonistShadow: rootStyle.getPropertyValue('--wna-rg-protagonist-shadow').trim() || 'rgba(224, 108, 117, 0.8)',
			mentionLineColor: rootStyle.getPropertyValue('--wna-rg-mention-line-color').trim() || rootStyle.getPropertyValue('--text-faint').trim() || '#666',
			mentionTextColor: rootStyle.getPropertyValue('--wna-rg-mention-text-color').trim() || rootStyle.getPropertyValue('--text-faint').trim() || '#666',
			mentionBorderColor: rootStyle.getPropertyValue('--wna-rg-mention-border-color').trim() || rootStyle.getPropertyValue('--text-faint').trim() || '#666',
			mentionLineDash: (rootStyle.getPropertyValue('--wna-rg-mention-line-dash').trim() || '4, 4').split(',').map(n => parseFloat(n.trim())),
			mentionLabelDash: (rootStyle.getPropertyValue('--wna-rg-mention-label-dash').trim() || '2, 2').split(',').map(n => parseFloat(n.trim())),
			typePalette: [
				rootStyle.getPropertyValue('--color-red').trim() || '#ef4444',
				rootStyle.getPropertyValue('--color-orange').trim() || '#f97316',
				rootStyle.getPropertyValue('--color-yellow').trim() || '#eab308',
				rootStyle.getPropertyValue('--color-green').trim() || '#22c55e',
				rootStyle.getPropertyValue('--color-cyan').trim() || '#06b6d4',
				rootStyle.getPropertyValue('--color-blue').trim() || '#3b82f6',
				rootStyle.getPropertyValue('--color-purple').trim() || '#a855f7',
				rootStyle.getPropertyValue('--color-pink').trim() || '#ec4899',
			],
		};
		return colors;
	}

	static distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
		if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
		let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
		t = Math.max(0, Math.min(1, t));
		return Math.sqrt((px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2);
	}

	static renderEdges(ctx: CanvasRenderingContext2D, colors: ThemeColors, state: GraphRenderState): EdgeRenderTask[] {
		const edgeTasks: EdgeRenderTask[] = [];
		const showLabelsGlobally = state.scale >= 0.7;

		// 找出当前未被淡化的活跃节点
		const activeNodeIds = new Set<string>();
		const centerNode = state.selectedNode || state.hoveredNode;
		if (centerNode) {
			activeNodeIds.add(centerNode.id);
			for (const edge of state.graphData.edges) {
				if (edge.source === centerNode.id) activeNodeIds.add(edge.target);
				if (edge.target === centerNode.id) activeNodeIds.add(edge.source);
			}
		} else {
			for (const node of state.graphData.nodes) {
				activeNodeIds.add(node.id);
			}
		}

		ctx.save();
		ctx.font = '6px sans-serif'; 

		// 第一遍：收集所有边的信息，计算标签的包围盒，并确定优先级
		for (const edge of state.graphData.edges) {
			const src = state.graphData.nodes.find(n => n.id === edge.source);
			const tgt = state.graphData.nodes.find(n => n.id === edge.target);
			if (!src || !tgt) continue;

			const drawMode = state.edgeDrawModeMap.get(edge);
			if (drawMode === 'hide') continue;

			const offset = state.edgeOffsetMap.get(edge) || 0;
			
			let isHighlighted = false;
			let isDimmed = false;
			if (state.selectedNode) {
				isHighlighted = edge.source === state.selectedNode.id || edge.target === state.selectedNode.id;
				isDimmed = !isHighlighted;
			} else if (state.hoveredNode) {
				isHighlighted = edge.source === state.hoveredNode.id || edge.target === state.hoveredNode.id;
				isDimmed = !isHighlighted;
			} else if (state.filterMatchNodeIds) {
				isHighlighted = state.filterMatchNodeIds.has(edge.source) && state.filterMatchNodeIds.has(edge.target);
				isDimmed = !isHighlighted;
			}

			const isMention = edge.type === 'mention';
			const showLabel = showLabelsGlobally || isHighlighted;

			let labelX = 0, labelY = 0, bgWidth = 0, bgHeight = 0;

			if (showLabel && edge.label) {
				const dx = tgt.x - src.x;
				const dy = tgt.y - src.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const unitX = dist > 0 ? dx / dist : 0;
				const unitY = dist > 0 ? dy / dist : 0;
				const normalX = -unitY;
				const normalY = unitX;

				labelX = (src.x + tgt.x) / 2 + normalX * offset * 0.5;
				labelY = (src.y + tgt.y) / 2 + normalY * offset * 0.5;

				// 测量文字宽度
				const paddingX = 4; // 水平内边距
				const paddingY = 3; // 垂直内边距
				const labels = edge.label.split('|');
				const gap = 4;
				let totalWidth = 0;
				for (const l of labels) {
					totalWidth += ctx.measureText(l).width + paddingX * 2;
				}
				bgWidth = totalWidth + gap * (labels.length - 1);
				bgHeight = 6 + paddingY * 2; // 6px 字体高度 + 上下边距paddingY * 2
			}

			// 计算优先级（越大越先占据空间，且画在最上层）
			let priority = 0;
			if (isHighlighted) priority += 1000;
			if (!isMention) priority += 100;
			// 用长度作微调，短边优先显示标签
			const dist = Math.sqrt(Math.pow(tgt.x - src.x, 2) + Math.pow(tgt.y - src.y, 2));
			priority -= dist / 1000; 

			edgeTasks.push({
				edge, src, tgt, drawMode: drawMode || 'default', offset,
				isHighlighted, isDimmed, isMention, showLabel,
				labelX, labelY, bgWidth, bgHeight,
				priority, isOverlapped: false
			});
		}
		ctx.restore();

		// 第二遍：按优先级从高到低进行碰撞检测
		edgeTasks.sort((a, b) => b.priority - a.priority);
		
		const drawnBoxes: {x: number, y: number, w: number, h: number, srcId: string, tgtId: string}[] = [];
		const drawnLines: {x1: number, y1: number, x2: number, y2: number, srcId: string, tgtId: string}[] = [];

		for (const task of edgeTasks) {
			if (!task.showLabel || !task.edge.label) continue;
			
			// 1. 碰撞检测：与其他优先级更高的标签
			const isCollidingWithLabel = drawnBoxes.some(b => {
				// 如果是同一对节点之间的不同标签，允许它们在视觉上稍微靠得近一些甚至轻微重叠
				// 因为它们已经被物理引擎和弧线逻辑分开，如果依然判定重叠而导致一方透明，会损失重要信息
				if ((b.srcId === task.src.id && b.tgtId === task.tgt.id) || 
					(b.srcId === task.tgt.id && b.tgtId === task.src.id)) {
					return false;
				}
				return Math.abs(task.labelX - b.x) < (task.bgWidth + b.w) / 2 + 2 &&
					   Math.abs(task.labelY - b.y) < (task.bgHeight + b.h) / 2 + 2;
			});

			// 2. 碰撞检测：与其他优先级更高的连线（防止低优先级标签盖住高优先级线）
			const isCollidingWithLine = drawnLines.some(line => {
				// 如果是同一对节点之间的连线（双向关系或者多重边），由于会绘制为弧线，
				// 它们的标签偏离了中心直线，但不应被视为压住了对方的“直线路径”，否则会导致双方互相透明
				if ((line.srcId === task.src.id && line.tgtId === task.tgt.id) || 
					(line.srcId === task.tgt.id && line.tgtId === task.src.id)) {
					return false;
				}
				const dist = GraphRenderer.distToSegment(task.labelX, task.labelY, line.x1, line.y1, line.x2, line.y2);
				return dist < 8; // 8 像素以内认为标签压到了线
			});

			// 3. 碰撞检测：与活跃节点（排除起止节点）
			// 明确关系极为重要，不让步于节点；提及关系则主动让步于节点
			const shouldYieldToNode = !task.isHighlighted || task.isMention;
			const isCollidingWithNode = shouldYieldToNode && state.graphData.nodes.some(n => 
				n.id !== task.src.id && n.id !== task.tgt.id && activeNodeIds.has(n.id) && (
					(Math.abs(task.labelX - n.x) < task.bgWidth / 2 + 12 &&
					 Math.abs(task.labelY - n.y) < task.bgHeight / 2 + 12) ||
					(Math.abs(task.labelX - n.x) < task.bgWidth / 2 + 35 &&
					 Math.abs(task.labelY - (n.y + 15)) < task.bgHeight / 2 + 8)
				)
			);

			if (isCollidingWithLabel || isCollidingWithLine || isCollidingWithNode) {
				task.isOverlapped = true;
			} else {
				drawnBoxes.push({ x: task.labelX, y: task.labelY, w: task.bgWidth, h: task.bgHeight, srcId: task.src.id, tgtId: task.tgt.id });
				drawnLines.push({ x1: task.src.x, y1: task.src.y, x2: task.tgt.x, y2: task.tgt.y, srcId: task.src.id, tgtId: task.tgt.id });
			}
		}

		// 第三遍：画线（由于之前从高到低排序，我们要从后往前画，让低优先级的在底层）
		for (let i = edgeTasks.length - 1; i >= 0; i--) {
			const task = edgeTasks[i];
			const { src, tgt, offset, isHighlighted, isDimmed, isMention, isOverlapped } = task;

			let lineWidth = 0.5;
			let alpha = 0.5;

			if (isHighlighted) {
				lineWidth = isMention ? 0.4 : 0.6;
				alpha = isMention ? 0.6 : 0.9;
			} else if (isDimmed) {
				lineWidth = isMention ? 0.15 : 0.2;
				alpha = isMention ? 0.1 : 0.15;
			} else {
				lineWidth = isMention ? 0.25 : 0.35;
				alpha = isMention ? 0.35 : 0.5;
			}

			// 如果该边的标签被遮挡，连同整条线一起适度淡化
			if (isOverlapped) {
				alpha *= 0.35;
			}

			ctx.save();
			
			// 核心优化：挖空标签区域，防止半透明时连线穿过自己的文字
			const displayLabel = state.combinedLabelMap.get(task.edge) || task.edge.label;
			if (task.showLabel && displayLabel) {
				ctx.beginPath();
				// 顺时针绘制无限大外围
				ctx.moveTo(-100000, -100000);
				ctx.lineTo(100000, -100000);
				ctx.lineTo(100000, 100000);
				ctx.lineTo(-100000, 100000);
				ctx.closePath();
				
				const dx = task.tgt.x - task.src.x;
				const dy = task.tgt.y - task.src.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const unitX = dist > 0 ? dx / dist : 0;
				const unitY = dist > 0 ? dy / dist : 0;

				const padding = 0.5;
				const paddingX = 4;
				const paddingY = 3;
				const gap = 4;
				const labels = displayLabel.split('|');
				const widths = labels.map(l => ctx.measureText(l).width + paddingX * 2);
				const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);
				const bgHeight = 6 + paddingY * 2;

				let currentOffset = -totalWidth / 2;

				for (let i = 0; i < labels.length; i++) {
					const w = widths[i];
					const cx = task.labelX + unitX * (currentOffset + w / 2);
					const cy = task.labelY + unitY * (currentOffset + w / 2);
					
					const lx = cx - w / 2 - padding;
					const ly = cy - bgHeight / 2 - padding;
					const lw = w + padding * 2;
					const lh = bgHeight + padding * 2;
					
					// 逆时针绘制内圈孔洞
					ctx.moveTo(lx, ly);
					ctx.lineTo(lx, ly + lh);
					ctx.lineTo(lx + lw, ly + lh);
					ctx.lineTo(lx + lw, ly);
					ctx.closePath();
					
					currentOffset += w + gap;
				}
				
				ctx.clip();
			}

			ctx.globalAlpha = alpha;
			ctx.lineWidth = lineWidth;
			
			if (isHighlighted) {
				ctx.strokeStyle = colors.accent;
			} else {
				ctx.strokeStyle = isMention ? colors.mentionLineColor : colors.graphLine;
			}

			if (isMention) {
				ctx.setLineDash(colors.mentionLineDash);
			}

			const isBidirectional = task.drawMode === 'bidirectional';
			if (offset !== 0) {
				GraphRenderer.drawCurvedArrow(ctx, src, tgt, offset, colors, isBidirectional);
			} else {
				GraphRenderer.drawStraightArrow(ctx, src, tgt, colors, isBidirectional);
			}
			ctx.restore();
		}

		// 第四遍：画标签（同样从低优先级到高优先级画，确保高优先级盖在最上层）
		for (let i = edgeTasks.length - 1; i >= 0; i--) {
			const task = edgeTasks[i];
			const displayLabel = state.combinedLabelMap.get(task.edge) || task.edge.label;
			if (!task.showLabel || !displayLabel) continue;

			const { src, tgt, offset, isHighlighted, isDimmed, isMention, isOverlapped } = task;

			let labelAlpha = 1.0;
			if (isHighlighted) {
				labelAlpha = 1.0;
			} else if (isDimmed) {
				labelAlpha = 0.3;
			} else {
				labelAlpha = 0.65;
			}

			// 如果被重叠，适度淡化，但保持足够的区分度
			if (isOverlapped) {
				labelAlpha *= 0.35; 
			}

			GraphRenderer.drawEdgeLabel(ctx, src, tgt, displayLabel, offset, isMention, colors, labelAlpha, isHighlighted);
		}
		
		return edgeTasks;
	}

	static drawNodes(ctx: CanvasRenderingContext2D, layout: GraphData, colors: ThemeColors, edgeTasks: EdgeRenderTask[], state: GraphRenderState): void {
		// 智能截断节点名称，按视觉宽度（中文字符算2，英文字母算1）
		const truncateNodeName = (name: string): string => {
			let len = 0;
			let result = '';
			for (let i = 0; i < name.length; i++) {
				const char = name[i];
				const code = char.charCodeAt(0);
				len += (code > 255) ? 2 : 1;
				if (len > 10) { // 限制视觉长度大约为 5个汉字 或 10个英文字母
					return result + '…';
				}
				result += char;
			}
			return result;
		};

		for (const node of state.graphData.nodes) {
			const isSelected = state.selectedNode?.id === node.id;
			const isHovered = state.hoveredNode?.id === node.id;
			const isFilterMatch = state.filterMatchNodeIds?.has(node.id) ?? false;
			const radius = isSelected || isHovered ? GraphRenderer.NODE_HIGHLIGHT_RADIUS : GraphRenderer.NODE_RADIUS;

			// 当有选中节点时，非关联节点大幅度淡出，模仿官方高对比度渐隐
			let nodeAlpha = 1.0;
			let isDimmed = false;
			if (state.selectedNode && !isSelected) {
				const neighborTasks = edgeTasks.filter(
					t => (t.src.id === state.selectedNode!.id && t.tgt.id === node.id) ||
						 (t.tgt.id === state.selectedNode!.id && t.src.id === node.id)
				);
				const isNeighbor = neighborTasks.length > 0;
				// 如果该节点的所有关联边都被重叠淡化了，那么该节点也应跟随淡化
				const allEdgesOverlapped = isNeighbor && neighborTasks.every(t => t.isOverlapped);

				nodeAlpha = isNeighbor ? (allEdgesOverlapped ? 0.35 : 1.0) : 0.15;
				isDimmed = !isNeighbor || allEdgesOverlapped;
			} else if (state.hoveredNode && !isHovered) {
				const neighborTasks = edgeTasks.filter(
					t => (t.src.id === state.hoveredNode!.id && t.tgt.id === node.id) ||
						 (t.tgt.id === state.hoveredNode!.id && t.src.id === node.id)
				);
				const isNeighbor = neighborTasks.length > 0;
				const allEdgesOverlapped = isNeighbor && neighborTasks.every(t => t.isOverlapped);

				nodeAlpha = isNeighbor ? (allEdgesOverlapped ? 0.35 : 1.0) : 0.3;
				isDimmed = !isNeighbor || allEdgesOverlapped;
			} else if (state.filterMatchNodeIds && !isFilterMatch) {
				nodeAlpha = 0.15;
				isDimmed = true;
			}

			ctx.save();
			ctx.globalAlpha = nodeAlpha;

			// 绘制节点小圆点
			ctx.beginPath();
			ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
			
			let baseColor = colors.graphNode;
			let overlayColor: string | null = null;

			if (node.nodeType) {
				baseColor = colors.accent; // 主题强调色打底
				overlayColor = GraphRenderer.getNodeTypeColor(node.nodeType, colors); // 原生变量池叠色
			}

			if (isDimmed) {
				baseColor = colors.textMuted;
				overlayColor = null; // 淡化节点时清除类型叠加色，彻底降低视觉权重
			} else if (isFilterMatch) {
				// 搜索命中时：对有类型颜色的节点保留 overlayColor（不清空），
				// 仅对无 nodeType 的普通节点才使用 graphNodeFocused 以强调命中状态。
				// 这样搜索高亮不会覆盖图谱本身渲染的类型颜色。
				if (!node.nodeType) {
					baseColor = colors.graphNodeFocused;
				}
				// overlayColor 已在上方 node.nodeType 分支中设置，此处保留不变
			} else if (!node.nodeType && (isSelected || isHovered)) {
				baseColor = colors.graphNodeFocused;
			}

			// 当有叠加类型颜色时，降低底色透明度以便类型颜色透出：
			// - hover/selected 已有此逻辑；
			// - isFilterMatch 也需要同等处理，避免底色遮挡类型叠加色
			let currentBaseAlpha = nodeAlpha;
			if (overlayColor && !isDimmed && (isSelected || isHovered || isFilterMatch)) {
				currentBaseAlpha = 0.3;
			}

			ctx.globalAlpha = currentBaseAlpha;
			ctx.fillStyle = baseColor;
			
			if (isSelected) {
				ctx.shadowColor = overlayColor || baseColor;
				ctx.shadowBlur = 15;
			} else if (isHovered) {
				ctx.shadowColor = overlayColor || baseColor;
				ctx.shadowBlur = 10;
			} else {
				ctx.shadowBlur = 0;
			}

			ctx.fill();
			
			// 叠加动态类型颜色
			if (overlayColor && !isDimmed) {
				const isProtagonistNode = node.isProtagonist || Boolean(node.nodeType && (node.nodeType.includes('主角') || node.nodeType.toLowerCase().includes('protagonist')));
				const overlayAlphaMultiplier = isProtagonistNode ? 0.85 : ((isSelected || isHovered || isFilterMatch) ? 0.8 : 0.5);
				ctx.globalAlpha = nodeAlpha * overlayAlphaMultiplier; 
				ctx.fillStyle = overlayColor; 
				ctx.shadowBlur = 0;
				ctx.fill();
			}

			// 恢复节点的整体透明度供后续使用
			ctx.globalAlpha = nodeAlpha;
			ctx.shadowBlur = 0; // 重置阴影防止影响其他元素

			// 绘制标签文本
			const textY = node.y + radius + 6; // 稍微靠近节点一点
			ctx.font = '10px sans-serif'; // 再调小一点角色名字号
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';

			// 智能截断名称
			const displayName = truncateNodeName(node.id);

			// 文字实体 (移除边框)
			ctx.fillStyle = isSelected || isHovered ? colors.graphText : (isDimmed ? colors.textFaint : colors.textNormal);
			ctx.fillText(displayName, node.x, textY);

			ctx.restore();
		}
	}

	static drawStraightArrow(ctx: CanvasRenderingContext2D, src: GraphNode, tgt: GraphNode, _colors: ThemeColors, isBidirectional: boolean = false): void {
		const dx = tgt.x - src.x;
		const dy = tgt.y - src.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist === 0) return;

		// 计算箭头终点（留出呼吸感，距离节点边缘再隔开 4 像素）
		const gap = GraphRenderer.NODE_RADIUS + 4;
		const unitX = dx / dist;
		const unitY = dy / dist;
		const arrowTipX = tgt.x - unitX * gap;
		const arrowTipY = tgt.y - unitY * gap;
		const startX = src.x + unitX * gap;
		const startY = src.y + unitY * gap;

		// 缩短连线终点，避免与半透明端点重叠导致颜色加深变黑 (圆点半径 1.0，退回 1.0 像素)
		const lineEndX = arrowTipX - unitX * 1.0;
		const lineEndY = arrowTipY - unitY * 1.0;
		let lineStartX = startX;
		let lineStartY = startY;

		if (isBidirectional) {
			lineStartX += unitX * 1.0;
			lineStartY += unitY * 1.0;
		}

		// 画线
		ctx.beginPath();
		ctx.moveTo(lineStartX, lineStartY);
		ctx.lineTo(lineEndX, lineEndY);
		ctx.stroke();

		// 画圆点（复用原本画箭头的方法名）
		GraphRenderer.drawEdgeEndDot(ctx, arrowTipX, arrowTipY);
		if (isBidirectional) {
			GraphRenderer.drawEdgeEndDot(ctx, startX, startY);
		}
	}

	static drawCurvedArrow(ctx: CanvasRenderingContext2D, src: GraphNode, tgt: GraphNode, offset: number, _colors: ThemeColors, isBidirectional: boolean = false): void {
		const dx = tgt.x - src.x;
		const dy = tgt.y - src.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist === 0) return;

		const unitX = dx / dist;
		const unitY = dy / dist;

		// 法向量（垂直于连线方向，用于弧线偏移）
		const normalX = -unitY;
		const normalY = unitX;

		// 控制点：连线中点 + 法向偏移
		const midX = (src.x + tgt.x) / 2 + normalX * offset;
		const midY = (src.y + tgt.y) / 2 + normalY * offset;

		// 起止点缩进到节点边缘，并留出呼吸感间距
		const gap = GraphRenderer.NODE_RADIUS + 4;
		
		// 根据曲率偏移量，稍微沿法线分开起止点，避免多条不同关系线的端点和箭头完全交叠
		const spread = Math.sign(offset) * Math.min(Math.abs(offset * 0.15), 5);

		const startX = src.x + unitX * gap + normalX * spread;
		const startY = src.y + unitY * gap + normalY * spread;
		const endX = tgt.x - unitX * gap + normalX * spread;
		const endY = tgt.y - unitY * gap + normalY * spread;

		// 计算箭头方向
		const endAngle = Math.atan2(endY - midY, endX - midX);
		const endDirX = Math.cos(endAngle);
		const endDirY = Math.sin(endAngle);
		
		// 曲线终点退回 1.0 像素，避免与半透明圆点叠加变黑
		const curveEndX = endX - endDirX * 1.0;
		const curveEndY = endY - endDirY * 1.0;

		let curveStartX = startX;
		let curveStartY = startY;

		if (isBidirectional) {
			const startAngle = Math.atan2(startY - midY, startX - midX);
			const startDirX = Math.cos(startAngle);
			const startDirY = Math.sin(startAngle);
			curveStartX -= startDirX * 1.0;
			curveStartY -= startDirY * 1.0;
		}

		// 画弧线
		ctx.beginPath();
		ctx.moveTo(curveStartX, curveStartY);
		ctx.quadraticCurveTo(midX, midY, curveEndX, curveEndY);
		ctx.stroke();

		// 画圆点
		GraphRenderer.drawEdgeEndDot(ctx, endX, endY);
		if (isBidirectional) {
			GraphRenderer.drawEdgeEndDot(ctx, startX, startY);
		}
	}

	static drawEdgeEndDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, 1.0, 0, Math.PI * 2);
		ctx.fillStyle = ctx.strokeStyle;
		ctx.fill();
		ctx.restore();
	}

	static drawEdgeLabel(ctx: CanvasRenderingContext2D, src: GraphNode, tgt: GraphNode, label: string, curveOffset: number, isMention: boolean, colors: ThemeColors, labelAlpha: number = 1.0, isHighlighted: boolean = false): void {
		if (!label) return;

		// 计算标签位置：连线中点（弧线时加法向偏移）
		const dx = tgt.x - src.x;
		const dy = tgt.y - src.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		
		const unitX = dist > 0 ? dx / dist : 0;
		const unitY = dist > 0 ? dy / dist : 0;
		const normalX = -unitY;
		const normalY = unitX;

		// 恢复到最优雅的 50% 中心点。去除人工滑动的补丁，依靠物理引擎和弧线偏移自然避让
		const labelX = (src.x + tgt.x) / 2 + normalX * curveOffset * 0.5;
		const labelY = (src.y + tgt.y) / 2 + normalY * curveOffset * 0.5;

		ctx.save();
		ctx.font = '6px sans-serif'; 
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		ctx.globalAlpha = labelAlpha;

		// 测量文字宽度
		const paddingX = 4; // 水平内边距
		const paddingY = 3; // 垂直内边距
		const gap = 4; // 多个标签之间的间距
		const labels = label.split('|');
		const widths = labels.map(l => ctx.measureText(l).width + paddingX * 2);
		const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);
		const bgHeight = 6 + paddingY * 2; // 6px 字体高度 + 上下边距

		let currentOffset = -totalWidth / 2;

		for (let i = 0; i < labels.length; i++) {
			const w = widths[i];
			const cx = labelX + unitX * (currentOffset + w / 2);
			const cy = labelY + unitY * (currentOffset + w / 2);

			// 绘制直角底色背景：使用画布底色（镂盖下方连线）
			ctx.fillStyle = colors.bgPrimary;
			ctx.fillRect(cx - w / 2, cy - bgHeight / 2, w, bgHeight);

			// 绘制极细边框
			ctx.strokeStyle = isHighlighted ? colors.accent : (isMention ? colors.mentionBorderColor : colors.graphLine);
			ctx.lineWidth = 0.5;
			if (isMention) {
				ctx.setLineDash(colors.mentionLabelDash); // 提及类型的标签使用虚线边框
			}
			ctx.strokeRect(cx - w / 2, cy - bgHeight / 2, w, bgHeight);
			if (isMention) {
				ctx.setLineDash([]); // 恢复实线
			}

			// 绘制文字：高亮时使用主要文本色，普通情况使用淡色，提及类型且未高亮时使用更淡的 textFaint
			ctx.fillStyle = isHighlighted ? colors.textNormal : (isMention ? colors.mentionTextColor : colors.textMuted);
			ctx.fillText(labels[i], cx, cy);
			
			currentOffset += w + gap;
		}

		ctx.restore();
	}

	static mixColors(color1: string, color2: string, weight2 = 0.5): string {
		const parseColor = (str: string): [number, number, number] => {
			if (!str) return [127, 109, 242];
			let s = str.trim().toLowerCase();
			if (s.startsWith('var(')) return [127, 109, 242];
			if (s.startsWith('#')) {
				s = s.slice(1);
				if (s.length === 3) s = s.split('').map(c => c + c).join('');
				const num = parseInt(s, 16);
				if (!isNaN(num)) return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
			}
			const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
			if (rgbMatch) return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
			return [127, 109, 242];
		};

		const c1 = parseColor(color1);
		const c2 = parseColor(color2);
		const w2 = Math.max(0, Math.min(1, weight2));
		const w1 = 1 - w2;
		const r = Math.round(c1[0] * w1 + c2[0] * w2);
		const g = Math.round(c1[1] * w1 + c2[1] * w2);
		const b = Math.round(c1[2] * w1 + c2[2] * w2);
		return `rgb(${r}, ${g}, ${b})`;
	}

	static getNodeTypeColor(typeStr: string, colors: ThemeColors): string {
		if (typeStr.includes('主角') || typeStr.toLowerCase().includes('protagonist')) {
			const redColor = colors.typePalette[0] || '#ef4444';
			// 主角类型默认分配红色混色，且红色占比设为 0.8，使其色彩显著且突出
			return GraphRenderer.mixColors(colors.accent, redColor, 0.8);
		}

		let hash = 0;
		for (let i = 0; i < typeStr.length; i++) {
			hash = typeStr.charCodeAt(i) + ((hash << 5) - hash);
		}
		const index = Math.abs(hash) % colors.typePalette.length;
		const rawCategoryColor = colors.typePalette[index];
		// 结合主题强调色与类别彩盘混色，使用户在更改主题强调色时，图谱节点呈现显著且和谐的色彩联动
		return GraphRenderer.mixColors(colors.accent, rawCategoryColor, 0.55);
	}
}
