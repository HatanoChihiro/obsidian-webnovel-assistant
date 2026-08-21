import type { GraphNode, GraphEdge, GraphData } from '../../services/RelationGraphManager';

export type GraphMarkerStyle = 'ring' | 'dot' | 'arrow' | 'none';


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

	// 连线与端点样式配置（可由 CSS 变量覆盖）
	lineGradientStartAlpha: number;
	lineGradientEndAlpha: number;
	lineBidiMidAlpha: number;
	nodeGap: number;
	sourceMarker: GraphMarkerStyle;
	targetMarker: GraphMarkerStyle;
	sourceMarkerRadius: number;
	targetMarkerRadius: number;
	arrowLength: number;
	arrowAngleDeg: number;
	curveOffset: number;
	lineWidth: number;

	// 节点几何尺寸配置（可由 CSS 变量覆盖）
	nodeRadius: number;
	nodeHighlightRadius: number;
	nodeShadowBlurSelected: number;
	nodeShadowBlurHover: number;
	nodeFontSize: number;

	// 标签排版样式配置（可由 CSS 变量覆盖）
	labelFontSize: number;
	labelPaddingX: number;
	labelPaddingY: number;
	labelGap: number;
	fontFamily: string;

	// 聚焦流光光束样式配置（可由 CSS 变量覆盖）
	pulseColor: string;
	pulsePeriodMs: number;
	pulseTrailRatio: number;
	pulseGlowAlpha: number;
	pulseCoreAlpha: number;
	pulseGlowRatio: number;
}

export const GRAPH_STYLE_DEFAULTS = {
	NODE_RADIUS: 3.5,
	NODE_HIGHLIGHT_RADIUS: 5.5,
	NODE_GAP: 3.5,
	START_DOT_RADIUS: 1.0,
	END_RING_RADIUS: 1.0,
	SOURCE_MARKER: 'ring' as GraphMarkerStyle,
	TARGET_MARKER: 'dot' as GraphMarkerStyle,
	ARROW_LENGTH: 2.6,
	ARROW_ANGLE_DEG: 26,
	LINE_GRADIENT_START_ALPHA: 0.25,
	LINE_GRADIENT_END_ALPHA: 0.95,
	LINE_BIDI_MID_ALPHA: 0.45,
	PULSE_PERIOD_MS: 2200,
	PULSE_TRAIL_RATIO: 0.35,
	PULSE_GLOW_ALPHA: 0.35,
	PULSE_CORE_ALPHA: 0.95,
	PULSE_GLOW_RATIO: 2.2,
	LABEL_FONT_SIZE: 6,
	NODE_FONT_SIZE: 10,
	LABEL_PADDING_X: 4,
	LABEL_PADDING_Y: 3,
	LABEL_GAP: 4,
	NODE_SHADOW_BLUR_SELECTED: 15,
	NODE_SHADOW_BLUR_HOVER: 10,
	CURVE_OFFSET: 20,
	LINE_WIDTH: 0.5,
} as const;

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
	animTime?: number;
}

export class GraphRenderer {
	static readonly NODE_RADIUS = 3.5;
	static readonly NODE_HIGHLIGHT_RADIUS = 5.5;
	static readonly DPR = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

	private static edgeCacheMap = new WeakMap<GraphData, { offsetMap: Map<GraphEdge, number>; drawModeMap: Map<GraphEdge, 'hide' | 'bidirectional'>; labelMap: Map<GraphEdge, string>; curveOffsetStep: number }>();

	static buildEdgeOffsets(graphData: GraphData, state: GraphRenderState, curveOffsetStep: number = GRAPH_STYLE_DEFAULTS.CURVE_OFFSET, force: boolean = false): void {
		if (!graphData || !graphData.edges) return;

		// 拓扑结构缓存控制：当 graphData 缓存有效且不要求强制重建时，重用已知计算结果
		const cached = this.edgeCacheMap.get(graphData);
		if (!force && cached && cached.curveOffsetStep === curveOffsetStep) {
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
				const step = curveOffsetStep * 2;
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
			labelMap: state.combinedLabelMap,
			curveOffsetStep
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

	private static probeEl: HTMLElement | null = null;

	/**
	 * 将任意 CSS 颜色表达式（包括 var(--xxx)、color-mix(...)、HEX、RGB、HSL）通过 DOM 引擎安全解析为具体的 rgb/rgba 字符串
	 */
	static resolveCssColor(cssValue: string, el: HTMLElement | null, fallback: string): string {
		if (!cssValue || typeof cssValue !== 'string') return fallback;
		const trimmed = cssValue.trim();
		if (!trimmed) return fallback;

		if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
			return trimmed;
		}
		if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+\s*)?\)$/.test(trimmed)) {
			return trimmed;
		}

		if (typeof document === 'undefined' && typeof activeDocument === 'undefined') {
			return fallback;
		}

		try {
			const doc = el?.ownerDocument || (typeof activeDocument !== 'undefined' ? activeDocument : document);
			const parent = (el && el.isConnected) ? el : (doc.body || doc.documentElement);

			if (!GraphRenderer.probeEl || GraphRenderer.probeEl.ownerDocument !== doc || !GraphRenderer.probeEl.isConnected) {
				if (GraphRenderer.probeEl && GraphRenderer.probeEl.parentElement) {
					GraphRenderer.probeEl.parentElement.removeChild(GraphRenderer.probeEl);
				}
				GraphRenderer.probeEl = parent.createDiv({ cls: 'wn-graph-color-probe' });
			} else if (GraphRenderer.probeEl.parentElement !== parent && parent) {
				parent.appendChild(GraphRenderer.probeEl);
			}

			GraphRenderer.probeEl.setCssStyles({ color: trimmed });
			const computed = getComputedStyle(GraphRenderer.probeEl).color;
			GraphRenderer.probeEl.setCssStyles({ color: '' });

			if (computed && computed !== 'transparent' && computed !== 'inherit' && computed !== 'initial') {
				return computed;
			}
		} catch {
			// fallback
		}

		return fallback;
	}

	static getThemeColors(el?: HTMLElement | null): ThemeColors {
		const doc = el?.ownerDocument || (typeof activeDocument !== 'undefined' ? activeDocument : (typeof document !== 'undefined' ? document : null));
		const isDark = doc?.body ? doc.body.classList.contains('theme-dark') : true;

		const targetEl = (el && el.isConnected) ? el : (doc?.body || doc?.documentElement || null);
		const rootStyle = targetEl ? getComputedStyle(targetEl) : null;

		const parseNumber = (prop: string, fallback: number): number => {
			if (!rootStyle) return fallback;
			const raw = rootStyle.getPropertyValue(prop).trim();
			if (!raw) return fallback;
			const val = parseFloat(raw);
			return isNaN(val) ? fallback : val;
		};
		const parseMarker = (prop: string, fallback: GraphMarkerStyle): GraphMarkerStyle => {
			const raw = rootStyle?.getPropertyValue(prop).trim() || '';
			return GraphRenderer.parseMarkerStyle(raw, fallback);
		};

		const fontFamily = rootStyle?.getPropertyValue('--wna-rg-font-family').trim() || 'sans-serif';

		const getColor = (prop: string, fallback: string): string => {
			const raw = rootStyle ? rootStyle.getPropertyValue(prop).trim() : '';
			return GraphRenderer.resolveCssColor(raw || fallback, targetEl, fallback);
		};

		// 区分明暗主题的基准回退色
		const fallbackBgPrimary = isDark ? '#1e1e1e' : '#ffffff';
		const fallbackTextNormal = isDark ? '#dcddde' : '#2e3338';
		const fallbackTextMuted = isDark ? '#999999' : '#6c757d';
		const fallbackTextFaint = isDark ? '#666666' : '#9ca3af';
		const fallbackGraphNode = isDark ? '#999999' : '#6c757d';
		const fallbackGraphLine = isDark ? '#444444' : '#d0d7de';
		const fallbackGraphText = isDark ? '#dcddde' : '#2e3338';
		const fallbackAccent = '#7f6df2';

		const rawPulseColor = rootStyle?.getPropertyValue('--wna-rg-pulse-color').trim();

		const colors: ThemeColors = {
			accent: getColor('--interactive-accent', fallbackAccent),
			textNormal: getColor('--text-normal', fallbackTextNormal),
			textMuted: getColor('--text-muted', fallbackTextMuted),
			textFaint: getColor('--text-faint', fallbackTextFaint),
			bgPrimary: getColor('--background-primary', fallbackBgPrimary),
			graphNode: getColor('--graph-node', getColor('--text-muted', fallbackGraphNode)),
			graphLine: getColor('--wna-rg-line-color', getColor('--graph-line', getColor('--background-modifier-border', fallbackGraphLine))),
			graphText: getColor('--graph-text', getColor('--text-normal', fallbackGraphText)),
			graphNodeFocused: getColor('--graph-node-focused', getColor('--interactive-accent', fallbackAccent)),

			// 设定图谱专属
			protagonistOverlay: getColor('--wna-rg-protagonist-overlay', 'rgba(224, 108, 117, 0.5)'),
			protagonistOverlayHover: getColor('--wna-rg-protagonist-overlay-hover', 'rgba(224, 108, 117, 0.8)'),
			protagonistShadow: getColor('--wna-rg-protagonist-shadow', 'rgba(224, 108, 117, 0.8)'),
			mentionLineColor: getColor('--wna-rg-mention-line-color', getColor('--text-faint', fallbackTextFaint)),
			mentionTextColor: getColor('--wna-rg-mention-text-color', getColor('--text-faint', fallbackTextMuted)),
			mentionBorderColor: getColor('--wna-rg-mention-border-color', getColor('--text-faint', fallbackGraphLine)),
			mentionLineDash: (rootStyle?.getPropertyValue('--wna-rg-mention-line-dash').trim() || '4, 4').split(',').map(n => parseFloat(n.trim())),
			mentionLabelDash: (rootStyle?.getPropertyValue('--wna-rg-mention-label-dash').trim() || '2, 2').split(',').map(n => parseFloat(n.trim())),
			typePalette: [
				getColor('--color-red', '#ef4444'),
				getColor('--color-orange', '#f97316'),
				getColor('--color-yellow', '#eab308'),
				getColor('--color-green', '#22c55e'),
				getColor('--color-cyan', '#06b6d4'),
				getColor('--color-blue', '#3b82f6'),
				getColor('--color-purple', '#a855f7'),
				getColor('--color-pink', '#ec4899'),
			],

			// 连线与端点样式
			lineGradientStartAlpha: parseNumber('--wna-rg-line-gradient-start-alpha', GRAPH_STYLE_DEFAULTS.LINE_GRADIENT_START_ALPHA),
			lineGradientEndAlpha: parseNumber('--wna-rg-line-gradient-end-alpha', GRAPH_STYLE_DEFAULTS.LINE_GRADIENT_END_ALPHA),
			lineBidiMidAlpha: parseNumber('--wna-rg-line-bidi-mid-alpha', GRAPH_STYLE_DEFAULTS.LINE_BIDI_MID_ALPHA),
			nodeGap: parseNumber('--wna-rg-node-gap', GRAPH_STYLE_DEFAULTS.NODE_GAP),
			sourceMarker: parseMarker('--wna-rg-source-marker', GRAPH_STYLE_DEFAULTS.SOURCE_MARKER),
			targetMarker: parseMarker('--wna-rg-target-marker', GRAPH_STYLE_DEFAULTS.TARGET_MARKER),
			sourceMarkerRadius: parseNumber('--wna-rg-source-marker-radius', parseNumber('--wna-rg-end-ring-radius', GRAPH_STYLE_DEFAULTS.END_RING_RADIUS)),
			targetMarkerRadius: parseNumber('--wna-rg-target-marker-radius', parseNumber('--wna-rg-start-dot-radius', GRAPH_STYLE_DEFAULTS.START_DOT_RADIUS)),
			arrowLength: parseNumber('--wna-rg-arrow-length', GRAPH_STYLE_DEFAULTS.ARROW_LENGTH),
			arrowAngleDeg: parseNumber('--wna-rg-arrow-angle-deg', GRAPH_STYLE_DEFAULTS.ARROW_ANGLE_DEG),
			curveOffset: parseNumber('--wna-rg-curve-offset', GRAPH_STYLE_DEFAULTS.CURVE_OFFSET),
			lineWidth: parseNumber('--wna-rg-line-width', GRAPH_STYLE_DEFAULTS.LINE_WIDTH),

			// 节点几何尺寸与排版
			nodeRadius: parseNumber('--wna-rg-node-radius', GRAPH_STYLE_DEFAULTS.NODE_RADIUS),
			nodeHighlightRadius: parseNumber('--wna-rg-node-highlight-radius', GRAPH_STYLE_DEFAULTS.NODE_HIGHLIGHT_RADIUS),
			nodeShadowBlurSelected: parseNumber('--wna-rg-node-shadow-blur-selected', GRAPH_STYLE_DEFAULTS.NODE_SHADOW_BLUR_SELECTED),
			nodeShadowBlurHover: parseNumber('--wna-rg-node-shadow-blur-hover', GRAPH_STYLE_DEFAULTS.NODE_SHADOW_BLUR_HOVER),
			nodeFontSize: parseNumber('--wna-rg-node-font-size', GRAPH_STYLE_DEFAULTS.NODE_FONT_SIZE),

			// 标签排版样式
			labelFontSize: parseNumber('--wna-rg-label-font-size', GRAPH_STYLE_DEFAULTS.LABEL_FONT_SIZE),
			labelPaddingX: parseNumber('--wna-rg-label-padding-x', GRAPH_STYLE_DEFAULTS.LABEL_PADDING_X),
			labelPaddingY: parseNumber('--wna-rg-label-padding-y', GRAPH_STYLE_DEFAULTS.LABEL_PADDING_Y),
			labelGap: parseNumber('--wna-rg-label-gap', GRAPH_STYLE_DEFAULTS.LABEL_GAP),
			fontFamily,

			// 聚焦流光光束样式
			pulseColor: rawPulseColor ? GraphRenderer.resolveCssColor(rawPulseColor, targetEl, '') : '',
			pulsePeriodMs: parseNumber('--wna-rg-pulse-period-ms', GRAPH_STYLE_DEFAULTS.PULSE_PERIOD_MS),
			pulseTrailRatio: parseNumber('--wna-rg-pulse-trail-ratio', GRAPH_STYLE_DEFAULTS.PULSE_TRAIL_RATIO),
			pulseGlowAlpha: parseNumber('--wna-rg-pulse-glow-alpha', GRAPH_STYLE_DEFAULTS.PULSE_GLOW_ALPHA),
			pulseCoreAlpha: parseNumber('--wna-rg-pulse-core-alpha', GRAPH_STYLE_DEFAULTS.PULSE_CORE_ALPHA),
			pulseGlowRatio: parseNumber('--wna-rg-pulse-glow-ratio', GRAPH_STYLE_DEFAULTS.PULSE_GLOW_RATIO),
		};
		return colors;
	}

	static parseMarkerStyle(raw: string, fallback: GraphMarkerStyle): GraphMarkerStyle {
		return raw === 'ring' || raw === 'dot' || raw === 'arrow' || raw === 'none' ? raw : fallback;
	}

	static truncateNodeName(name: string): string {
		const parts = name.split('/');
		return parts[parts.length - 1] || name;
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
		const labelFontSize = colors?.labelFontSize ?? GRAPH_STYLE_DEFAULTS.LABEL_FONT_SIZE;
		const fontFamily = colors?.fontFamily || 'sans-serif';
		ctx.font = `${labelFontSize}px ${fontFamily}`;

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
				const paddingX = colors?.labelPaddingX ?? GRAPH_STYLE_DEFAULTS.LABEL_PADDING_X;
				const paddingY = colors?.labelPaddingY ?? GRAPH_STYLE_DEFAULTS.LABEL_PADDING_Y;
				const gap = colors?.labelGap ?? GRAPH_STYLE_DEFAULTS.LABEL_GAP;
				const labels = edge.label.split('|');
				let totalWidth = 0;
				for (const l of labels) {
					totalWidth += ctx.measureText(l).width + paddingX * 2;
				}
				bgWidth = totalWidth + gap * (labels.length - 1);
				bgHeight = labelFontSize + paddingY * 2;
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

			const baseLineWidth = colors?.lineWidth ?? GRAPH_STYLE_DEFAULTS.LINE_WIDTH;
			let lineWidth = baseLineWidth;
			let alpha = 0.5;

			if (isHighlighted) {
				lineWidth = isMention ? baseLineWidth * 0.8 : baseLineWidth * 1.2;
				alpha = isMention ? 0.6 : 0.9;
			} else if (isDimmed) {
				lineWidth = isMention ? baseLineWidth * 0.3 : baseLineWidth * 0.4;
				alpha = isMention ? 0.1 : 0.15;
			} else {
				lineWidth = isMention ? baseLineWidth * 0.5 : baseLineWidth * 0.7;
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
				const paddingX = colors?.labelPaddingX ?? GRAPH_STYLE_DEFAULTS.LABEL_PADDING_X;
				const paddingY = colors?.labelPaddingY ?? GRAPH_STYLE_DEFAULTS.LABEL_PADDING_Y;
				const gap = colors?.labelGap ?? GRAPH_STYLE_DEFAULTS.LABEL_GAP;
				const labels = displayLabel.split('|');
				const widths = labels.map(l => ctx.measureText(l).width + paddingX * 2);
				const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);
				const bgHeight = labelFontSize + paddingY * 2;

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

			const isBidirectional = task.drawMode === 'bidirectional';
			const animTime = state.animTime ?? performance.now();

			if (offset !== 0) {
				GraphRenderer.drawCurvedArrow(ctx, src, tgt, offset, colors, isBidirectional, isHighlighted, isMention, alpha, lineWidth, animTime);
			} else {
				GraphRenderer.drawStraightArrow(ctx, src, tgt, colors, isBidirectional, isHighlighted, isMention, alpha, lineWidth, animTime);
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
			const isProtagonistNode = node.isProtagonist || Boolean(node.nodeType && (node.nodeType.includes('主角') || node.nodeType.toLowerCase().includes('protagonist')));
			const isEmphasized = isSelected || isHovered || isFilterMatch;
			const defaultRadius = colors?.nodeRadius ?? GraphRenderer.NODE_RADIUS;
			const highlightRadius = colors?.nodeHighlightRadius ?? GraphRenderer.NODE_HIGHLIGHT_RADIUS;
			const radius = isSelected || isHovered ? highlightRadius : defaultRadius;

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

			if (node.nodeType || isProtagonistNode) {
				baseColor = colors.accent; // 主题强调色打底
				overlayColor = isProtagonistNode
					? (isEmphasized ? colors.protagonistOverlayHover : colors.protagonistOverlay)
					: GraphRenderer.getNodeTypeColor(node.nodeType!, colors); // 原生变量池叠色
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
			const shadowColor = isProtagonistNode ? colors.protagonistShadow : (overlayColor || baseColor);

			if (isSelected) {
				ctx.shadowColor = shadowColor;
				ctx.shadowBlur = colors?.nodeShadowBlurSelected ?? GRAPH_STYLE_DEFAULTS.NODE_SHADOW_BLUR_SELECTED;
			} else if (isHovered) {
				ctx.shadowColor = shadowColor;
				ctx.shadowBlur = colors?.nodeShadowBlurHover ?? GRAPH_STYLE_DEFAULTS.NODE_SHADOW_BLUR_HOVER;
			} else {
				ctx.shadowBlur = 0;
			}

			ctx.fill();

			// 叠加动态类型颜色
			if (overlayColor && !isDimmed) {
				const overlayAlphaMultiplier = isProtagonistNode ? 1 : (isEmphasized ? 0.8 : 0.5);
				ctx.globalAlpha = nodeAlpha * overlayAlphaMultiplier;
				ctx.fillStyle = overlayColor;
				ctx.shadowBlur = 0;
				ctx.fill();
			}

			// 恢复节点的整体透明度供后续使用
			ctx.globalAlpha = nodeAlpha;
			ctx.shadowBlur = 0; // 重置阴影防止影响其他元素

			// 绘制标签文本
			const textY = node.y + radius + 5; // 稍微靠近节点一点
			const nodeFontSize = colors?.nodeFontSize ?? GRAPH_STYLE_DEFAULTS.NODE_FONT_SIZE;
			const nodeFontFamily = colors?.fontFamily || 'sans-serif';
			ctx.font = `${nodeFontSize}px ${nodeFontFamily}`;
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

	static parseRgb(str: string, defaultRgb: [number, number, number] = [127, 109, 242]): [number, number, number] {
		if (!str) return defaultRgb;
		let s = str.trim().toLowerCase();
		if (s.startsWith('var(')) return defaultRgb;
		if (s.startsWith('#')) {
			s = s.slice(1);
			if (s.length === 3) s = s.split('').map(c => c + c).join('');
			const num = parseInt(s, 16);
			if (!isNaN(num)) return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
		}
		const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
		if (rgbMatch) return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
		return defaultRgb;
	}

	static toRgba(colorStr: string, alpha: number): string {
		const [r, g, b] = GraphRenderer.parseRgb(colorStr);
		const safeAlpha = Math.max(0, Math.min(1, alpha));
		return `rgba(${r}, ${g}, ${b}, ${safeAlpha.toFixed(3)})`;
	}

	static drawStartDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, alpha: number = 1.0, radius?: number): void {
		ctx.save();
		ctx.setLineDash([]);
		ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		ctx.beginPath();
		ctx.arc(x, y, radius ?? GRAPH_STYLE_DEFAULTS.START_DOT_RADIUS, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.restore();
	}

	static drawHollowRing(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		color: string,
		alpha: number = 1.0,
		radius?: number,
		lineWidth: number = 0.5
	): void {
		if (alpha <= 0.01) return;
		ctx.save();
		ctx.setLineDash([]);
		ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(0.35, lineWidth * 0.75);
		ctx.beginPath();
		ctx.arc(x, y, radius ?? GRAPH_STYLE_DEFAULTS.END_RING_RADIUS, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	static drawChevron(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		directionX: number,
		directionY: number,
		color: string,
		alpha: number = 1.0,
		length: number = GRAPH_STYLE_DEFAULTS.ARROW_LENGTH,
		angleDeg: number = GRAPH_STYLE_DEFAULTS.ARROW_ANGLE_DEG,
		lineWidth: number = GRAPH_STYLE_DEFAULTS.LINE_WIDTH
	): void {
		if (alpha <= 0.01 || length <= 0) return;
		if (Math.hypot(directionX, directionY) === 0) return;

		const directionAngle = Math.atan2(directionY, directionX);
		const wingAngle = Math.max(0, Math.min(89, angleDeg)) * Math.PI / 180;
		const backAngle = directionAngle + Math.PI;
		const firstWingX = x + Math.cos(backAngle - wingAngle) * length;
		const firstWingY = y + Math.sin(backAngle - wingAngle) * length;
		const secondWingX = x + Math.cos(backAngle + wingAngle) * length;
		const secondWingY = y + Math.sin(backAngle + wingAngle) * length;

		ctx.save();
		ctx.setLineDash([]);
		ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(0.35, lineWidth);
		ctx.beginPath();
		ctx.moveTo(firstWingX, firstWingY);
		ctx.lineTo(x, y);
		ctx.lineTo(secondWingX, secondWingY);
		ctx.stroke();
		ctx.restore();
	}

	static drawMarker(
		ctx: CanvasRenderingContext2D,
		style: GraphMarkerStyle,
		x: number,
		y: number,
		directionX: number,
		directionY: number,
		color: string,
		alpha: number,
		radius: number,
		colors: ThemeColors,
		lineWidth: number
	): void {
		switch (style) {
			case 'ring':
				GraphRenderer.drawHollowRing(ctx, x, y, color, alpha, radius, lineWidth);
				break;
			case 'dot':
				GraphRenderer.drawStartDot(ctx, x, y, color, alpha, radius);
				break;
			case 'arrow':
				GraphRenderer.drawChevron(ctx, x, y, directionX, directionY, color, alpha, colors.arrowLength, colors.arrowAngleDeg, lineWidth);
				break;
			case 'none':
				break;
		}
	}

	static getMarkerLineInset(style: GraphMarkerStyle, radius: number): number {
		return style === 'ring' ? Math.max(0, radius) : 0;
	}


	static drawFlowPulseStraight(
		ctx: CanvasRenderingContext2D,
		startX: number,
		startY: number,
		endX: number,
		endY: number,
		colors: ThemeColors,
		baseColor: string,
		isBidirectional: boolean = false,
		alpha: number = 1.0,
		lineWidth: number = 0.5,
		animTime: number = performance.now()
	): void {
		if (alpha <= 0.01) return;
		if ((colors.pulseCoreAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_CORE_ALPHA) <= 0.001 && (colors.pulseGlowAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_GLOW_ALPHA) <= 0.001) return;

		const period = colors.pulsePeriodMs || GRAPH_STYLE_DEFAULTS.PULSE_PERIOD_MS;
		if (period <= 0) return;
		const trailRatio = colors.pulseTrailRatio ?? GRAPH_STYLE_DEFAULTS.PULSE_TRAIL_RATIO;
		const t = (animTime % period) / period;

		const doc = (typeof activeDocument !== 'undefined' ? activeDocument : (typeof document !== 'undefined' ? document : null));
		const isDark = doc?.body ? doc.body.classList.contains('theme-dark') : true;

		// 深色模式下混合白色产生柔和发光，浅色模式下保持饱和鲜明色与高透明度以确保白底清晰可见，且严格联动外部 alpha 与自定义变量
		const pulseBaseColor = colors.pulseColor || baseColor;
		const headColor = isDark ? GraphRenderer.mixColors(pulseBaseColor, '#ffffff', 0.45) : pulseBaseColor;
		const coreAlpha = colors.pulseCoreAlpha * (isDark ? 0.75 : 1.0) * alpha;
		const glowAlpha = colors.pulseGlowAlpha * (isDark ? 0.55 : 0.60) * alpha;
		const midAlpha = colors.pulseGlowAlpha * (isDark ? 0.45 : 0.60) * alpha;
		const coreLineWidth = isDark ? Math.max(0.6, lineWidth * 1.05) : Math.max(0.75, lineWidth * 1.25);

		if (coreAlpha <= 0.01 && glowAlpha <= 0.01) return;

		const drawBeam = (progress: number, reverse: boolean) => {
			const head = progress * (1 + trailRatio);
			const tail = head - trailRatio;

			const uStart = Math.max(0, tail);
			const uEnd = Math.min(1, head);

			if (uEnd <= uStart + 0.005) return;

			// reverse 模式下起点与终点对调
			const p0x = reverse ? endX : startX;
			const p0y = reverse ? endY : startY;
			const p1x = reverse ? startX : endX;
			const p1y = reverse ? startY : endY;

			const tailX = p0x + (p1x - p0x) * uStart;
			const tailY = p0y + (p1y - p0y) * uStart;
			const headX = p0x + (p1x - p0x) * uEnd;
			const headY = p0y + (p1y - p0y) * uEnd;

			const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
			grad.addColorStop(0, GraphRenderer.toRgba(pulseBaseColor, 0));
			grad.addColorStop(0.5, GraphRenderer.toRgba(pulseBaseColor, midAlpha));
			grad.addColorStop(1, GraphRenderer.toRgba(headColor, coreAlpha));

			ctx.save();
			ctx.setLineDash([]);
			ctx.lineCap = 'round';

			// 外层柔光晕光束
			ctx.beginPath();
			ctx.moveTo(tailX, tailY);
			ctx.lineTo(headX, headY);
			ctx.strokeStyle = grad;
			ctx.lineWidth = lineWidth * (colors?.pulseGlowRatio ?? GRAPH_STYLE_DEFAULTS.PULSE_GLOW_RATIO);
			ctx.globalAlpha = glowAlpha;
			ctx.stroke();

			// 核心清晰光束
			ctx.beginPath();
			ctx.moveTo(tailX, tailY);
			ctx.lineTo(headX, headY);
			ctx.strokeStyle = grad;
			ctx.lineWidth = coreLineWidth;
			ctx.globalAlpha = coreAlpha;
			ctx.stroke();

			ctx.restore();
		};

		drawBeam(t, false);
		if (isBidirectional) {
			drawBeam(t, true);
		}
	}

	static drawFlowPulseCurved(
		ctx: CanvasRenderingContext2D,
		startX: number,
		startY: number,
		midX: number,
		midY: number,
		endX: number,
		endY: number,
		colors: ThemeColors,
		baseColor: string,
		isBidirectional: boolean = false,
		alpha: number = 1.0,
		lineWidth: number = 0.5,
		animTime: number = performance.now()
	): void {
		if (alpha <= 0.01) return;
		if ((colors.pulseCoreAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_CORE_ALPHA) <= 0.001 && (colors.pulseGlowAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_GLOW_ALPHA) <= 0.001) return;

		const period = colors.pulsePeriodMs || GRAPH_STYLE_DEFAULTS.PULSE_PERIOD_MS;
		if (period <= 0) return;
		const trailRatio = colors.pulseTrailRatio ?? GRAPH_STYLE_DEFAULTS.PULSE_TRAIL_RATIO;
		const t = (animTime % period) / period;

		const doc = (typeof activeDocument !== 'undefined' ? activeDocument : (typeof document !== 'undefined' ? document : null));
		const isDark = doc?.body ? doc.body.classList.contains('theme-dark') : true;

		// 深色模式下混合白色产生柔和发光，浅色模式下保持饱和鲜明色与高透明度以确保白底清晰可见，且严格联动外部 alpha 与自定义变量
		const pulseBaseColor = colors.pulseColor || baseColor;
		const headColor = isDark ? GraphRenderer.mixColors(pulseBaseColor, '#ffffff', 0.45) : pulseBaseColor;
		const coreAlpha = colors.pulseCoreAlpha * (isDark ? 0.75 : 1.0) * alpha;
		const glowAlpha = colors.pulseGlowAlpha * (isDark ? 0.55 : 0.60) * alpha;
		const midAlpha = colors.pulseGlowAlpha * (isDark ? 0.45 : 0.60) * alpha;
		const coreLineWidth = isDark ? Math.max(0.6, lineWidth * 1.05) : Math.max(0.75, lineWidth * 1.25);

		if (coreAlpha <= 0.01 && glowAlpha <= 0.01) return;

		const drawBeam = (progress: number, reverse: boolean) => {
			const head = progress * (1 + trailRatio);
			const tail = head - trailRatio;

			const uStart = Math.max(0, tail);
			const uEnd = Math.min(1, head);

			if (uEnd <= uStart + 0.005) return;

			// reverse 模式下起点与终点对调
			const p0x = reverse ? endX : startX;
			const p0y = reverse ? endY : startY;
			const p1x = midX;
			const p1y = midY;
			const p2x = reverse ? startX : endX;
			const p2y = reverse ? startY : endY;

			// 精确贝塞尔曲线局部切割 (De Casteljau)
			const inv0 = 1 - uStart;
			const inv1 = 1 - uEnd;

			const tailX = inv0 * inv0 * p0x + 2 * inv0 * uStart * p1x + uStart * uStart * p2x;
			const tailY = inv0 * inv0 * p0y + 2 * inv0 * uStart * p1y + uStart * uStart * p2y;

			const headX = inv1 * inv1 * p0x + 2 * inv1 * uEnd * p1x + uEnd * uEnd * p2x;
			const headY = inv1 * inv1 * p0y + 2 * inv1 * uEnd * p1y + uEnd * uEnd * p2y;

			const subMidX = inv0 * inv1 * p0x + (uStart + uEnd - 2 * uStart * uEnd) * p1x + uStart * uEnd * p2x;
			const subMidY = inv0 * inv1 * p0y + (uStart + uEnd - 2 * uStart * uEnd) * p1y + uStart * uEnd * p2y;

			const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
			grad.addColorStop(0, GraphRenderer.toRgba(pulseBaseColor, 0));
			grad.addColorStop(0.5, GraphRenderer.toRgba(pulseBaseColor, midAlpha));
			grad.addColorStop(1, GraphRenderer.toRgba(headColor, coreAlpha));

			ctx.save();
			ctx.setLineDash([]);
			ctx.lineCap = 'round';

			// 外层柔光晕
			ctx.beginPath();
			ctx.moveTo(tailX, tailY);
			ctx.quadraticCurveTo(subMidX, subMidY, headX, headY);
			ctx.strokeStyle = grad;
			ctx.lineWidth = lineWidth * (colors?.pulseGlowRatio ?? GRAPH_STYLE_DEFAULTS.PULSE_GLOW_RATIO);
			ctx.globalAlpha = glowAlpha;
			ctx.stroke();

			// 核心清晰光束
			ctx.beginPath();
			ctx.moveTo(tailX, tailY);
			ctx.quadraticCurveTo(subMidX, subMidY, headX, headY);
			ctx.strokeStyle = grad;
			ctx.lineWidth = coreLineWidth;
			ctx.globalAlpha = coreAlpha;
			ctx.stroke();

			ctx.restore();
		};

		drawBeam(t, false);
		if (isBidirectional) {
			drawBeam(t, true);
		}
	}

	static drawStraightArrow(
		ctx: CanvasRenderingContext2D,
		src: GraphNode,
		tgt: GraphNode,
		colors: ThemeColors,
		isBidirectional: boolean = false,
		isHighlighted: boolean = false,
		isMention: boolean = false,
		alpha: number = 1.0,
		lineWidth: number = 0.5,
		animTime: number = performance.now()
	): void {
		const dx = tgt.x - src.x;
		const dy = tgt.y - src.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist === 0) return;

		// 呼吸感间距：从主题变量读取
		const nodeRadius = colors?.nodeRadius ?? GraphRenderer.NODE_RADIUS;
		const gap = nodeRadius + colors.nodeGap;
		if (dist < gap * 2 + 2) {
			ctx.beginPath();
			ctx.moveTo(src.x, src.y);
			ctx.lineTo(tgt.x, tgt.y);
			ctx.stroke();
			return;
		}

		const unitX = dx / dist;
		const unitY = dy / dist;
		const startX = src.x + unitX * gap;
		const startY = src.y + unitY * gap;
		const arrowTipX = tgt.x - unitX * gap;
		const arrowTipY = tgt.y - unitY * gap;

		const baseColor = isHighlighted ? colors.accent : (isMention ? colors.mentionLineColor : colors.graphLine);
		const startAlpha = isBidirectional ? alpha * colors.lineGradientEndAlpha : alpha * colors.lineGradientStartAlpha;
		const endAlpha = alpha * colors.lineGradientEndAlpha;
		const midAlpha = alpha * colors.lineBidiMidAlpha;

		const sourceMarkerRadius = Math.max(0, colors.sourceMarkerRadius * 0.8, lineWidth * (colors.sourceMarkerRadius / 0.8));
		const targetMarkerRadius = Math.max(0, colors.targetMarkerRadius * 0.8, lineWidth * (colors.targetMarkerRadius / 0.8));

		// 空心环从圆周连接，其他标记允许连线延伸到端点，由标记自身覆盖。
		const sourceStyle = isBidirectional ? colors.targetMarker : colors.sourceMarker;
		const sourceRadius = isBidirectional ? targetMarkerRadius : sourceMarkerRadius;
		const sourceInset = GraphRenderer.getMarkerLineInset(sourceStyle, sourceRadius);
		const targetInset = GraphRenderer.getMarkerLineInset(colors.targetMarker, targetMarkerRadius);
		const lineStartX = startX + unitX * sourceInset;
		const lineStartY = startY + unitY * sourceInset;
		const lineEndX = arrowTipX - unitX * targetInset;
		const lineEndY = arrowTipY - unitY * targetInset;

		// 创建流向色彩渐变
		const grad = ctx.createLinearGradient(lineStartX, lineStartY, lineEndX, lineEndY);
		if (isBidirectional) {
			grad.addColorStop(0, GraphRenderer.toRgba(baseColor, startAlpha));
			grad.addColorStop(0.5, GraphRenderer.toRgba(baseColor, midAlpha));
			grad.addColorStop(1, GraphRenderer.toRgba(baseColor, endAlpha));
		} else {
			grad.addColorStop(0, GraphRenderer.toRgba(baseColor, startAlpha));
			grad.addColorStop(1, GraphRenderer.toRgba(baseColor, endAlpha));
		}

		ctx.save();
		ctx.strokeStyle = grad;
		ctx.lineWidth = lineWidth;
		if (isMention) {
			ctx.setLineDash(colors.mentionLineDash);
		}

		ctx.beginPath();
		ctx.moveTo(lineStartX, lineStartY);
		ctx.lineTo(lineEndX, lineEndY);
		ctx.stroke();
		ctx.restore();

		GraphRenderer.drawMarker(ctx, sourceStyle, startX, startY, -unitX, -unitY, baseColor, startAlpha, sourceRadius, colors, lineWidth);
		GraphRenderer.drawMarker(ctx, colors.targetMarker, arrowTipX, arrowTipY, unitX, unitY, baseColor, endAlpha, targetMarkerRadius, colors, lineWidth);

		// 聚焦高亮时的流光脉冲（严格联动线段实际透明度 alpha）
		if (isHighlighted && ((colors.pulseCoreAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_CORE_ALPHA) > 0.001 || (colors.pulseGlowAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_GLOW_ALPHA) > 0.001) && (colors.pulsePeriodMs || GRAPH_STYLE_DEFAULTS.PULSE_PERIOD_MS) > 0) {
			GraphRenderer.drawFlowPulseStraight(ctx, lineStartX, lineStartY, lineEndX, lineEndY, colors, baseColor, isBidirectional, alpha, lineWidth, animTime);
		}
	}

	static drawCurvedArrow(
		ctx: CanvasRenderingContext2D,
		src: GraphNode,
		tgt: GraphNode,
		offset: number,
		colors: ThemeColors,
		isBidirectional: boolean = false,
		isHighlighted: boolean = false,
		isMention: boolean = false,
		alpha: number = 1.0,
		lineWidth: number = 0.5,
		animTime: number = performance.now()
	): void {
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
		const nodeRadius = colors?.nodeRadius ?? GraphRenderer.NODE_RADIUS;
		const gap = nodeRadius + colors.nodeGap;

		// 根据曲率偏移量，稍微沿法线分开起止点，避免多条不同关系线的端点和箭头完全交叠
		const spread = Math.sign(offset) * Math.min(Math.abs(offset * 0.15), 5);

		const startX = src.x + unitX * gap + normalX * spread;
		const startY = src.y + unitY * gap + normalY * spread;
		const endX = tgt.x - unitX * gap + normalX * spread;
		const endY = tgt.y - unitY * gap + normalY * spread;

		// 计算起点切线方向 (从 start指向 mid)
		const startAngle = Math.atan2(midY - startY, midX - startX);
		const startDirX = Math.cos(startAngle);
		const startDirY = Math.sin(startAngle);
		const endAngle = Math.atan2(endY - midY, endX - midX);
		const endDirX = Math.cos(endAngle);
		const endDirY = Math.sin(endAngle);

		const baseColor = isHighlighted ? colors.accent : (isMention ? colors.mentionLineColor : colors.graphLine);
		const startAlpha = isBidirectional ? alpha * colors.lineGradientEndAlpha : alpha * colors.lineGradientStartAlpha;
		const endAlpha = alpha * colors.lineGradientEndAlpha;
		const midAlpha = alpha * colors.lineBidiMidAlpha;

		const sourceMarkerRadius = Math.max(0, colors.sourceMarkerRadius * 0.8, lineWidth * (colors.sourceMarkerRadius / 0.8));
		const targetMarkerRadius = Math.max(0, colors.targetMarkerRadius * 0.8, lineWidth * (colors.targetMarkerRadius / 0.8));

		// 空心环从圆周连接，其他标记允许连线延伸到端点，由标记自身覆盖。
		const sourceStyle = isBidirectional ? colors.targetMarker : colors.sourceMarker;
		const sourceRadius = isBidirectional ? targetMarkerRadius : sourceMarkerRadius;
		const sourceInset = GraphRenderer.getMarkerLineInset(sourceStyle, sourceRadius);
		const targetInset = GraphRenderer.getMarkerLineInset(colors.targetMarker, targetMarkerRadius);
		const lineStartX = startX + startDirX * sourceInset;
		const lineStartY = startY + startDirY * sourceInset;
		const lineEndX = endX - endDirX * targetInset;
		const lineEndY = endY - endDirY * targetInset;

		// 创建弧线流向色彩渐变
		const grad = ctx.createLinearGradient(lineStartX, lineStartY, lineEndX, lineEndY);
		if (isBidirectional) {
			grad.addColorStop(0, GraphRenderer.toRgba(baseColor, startAlpha));
			grad.addColorStop(0.5, GraphRenderer.toRgba(baseColor, midAlpha));
			grad.addColorStop(1, GraphRenderer.toRgba(baseColor, endAlpha));
		} else {
			grad.addColorStop(0, GraphRenderer.toRgba(baseColor, startAlpha));
			grad.addColorStop(1, GraphRenderer.toRgba(baseColor, endAlpha));
		}

		ctx.save();
		ctx.strokeStyle = grad;
		ctx.lineWidth = lineWidth;
		if (isMention) {
			ctx.setLineDash(colors.mentionLineDash);
		}

		ctx.beginPath();
		ctx.moveTo(lineStartX, lineStartY);
		ctx.quadraticCurveTo(midX, midY, lineEndX, lineEndY);
		ctx.stroke();
		ctx.restore();

		GraphRenderer.drawMarker(ctx, sourceStyle, startX, startY, -startDirX, -startDirY, baseColor, startAlpha, sourceRadius, colors, lineWidth);
		GraphRenderer.drawMarker(ctx, colors.targetMarker, endX, endY, endDirX, endDirY, baseColor, endAlpha, targetMarkerRadius, colors, lineWidth);

		// 聚焦高亮时的流光脉冲（严格联动线段实际透明度 alpha）
		if (isHighlighted && ((colors.pulseCoreAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_CORE_ALPHA) > 0.001 || (colors.pulseGlowAlpha ?? GRAPH_STYLE_DEFAULTS.PULSE_GLOW_ALPHA) > 0.001) && (colors.pulsePeriodMs || GRAPH_STYLE_DEFAULTS.PULSE_PERIOD_MS) > 0) {
			GraphRenderer.drawFlowPulseCurved(ctx, lineStartX, lineStartY, midX, midY, lineEndX, lineEndY, colors, baseColor, isBidirectional, alpha, lineWidth, animTime);
		}
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
		const labelFontSize = colors?.labelFontSize ?? GRAPH_STYLE_DEFAULTS.LABEL_FONT_SIZE;
		const fontFamily = colors?.fontFamily || 'sans-serif';
		ctx.font = `${labelFontSize}px ${fontFamily}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		ctx.globalAlpha = labelAlpha;

		// 测量文字宽度
		const paddingX = colors?.labelPaddingX ?? GRAPH_STYLE_DEFAULTS.LABEL_PADDING_X;
		const paddingY = colors?.labelPaddingY ?? GRAPH_STYLE_DEFAULTS.LABEL_PADDING_Y;
		const gap = colors?.labelGap ?? GRAPH_STYLE_DEFAULTS.LABEL_GAP;
		const labels = label.split('|');
		const widths = labels.map(l => ctx.measureText(l).width + paddingX * 2);
		const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);
		const bgHeight = labelFontSize + paddingY * 2;

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
		const c1 = GraphRenderer.parseRgb(color1);
		const c2 = GraphRenderer.parseRgb(color2);
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
