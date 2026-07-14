import type { GraphNode, GraphEdge } from '../../services/RelationGraphManager';
import type { GraphData } from '../../services/RelationGraphManager';

export interface ThemeColors {
	textNormal: string;
	textMuted: string;
	backgroundPrimary: string;
	backgroundModifierBorder: string;
	interactiveAccent: string;
	interactiveAccentHover: string;
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
}

export class GraphRenderer {
	static readonly NODE_RADIUS = 5;
	static readonly NODE_HIGHLIGHT_RADIUS = 7;
	static readonly DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

	static render(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		layout: GraphData,
		state: GraphRenderState,
		colors: ThemeColors
	): void {
		ctx.clearRect(0, 0, width, height);
		
		ctx.save();
		ctx.translate(state.panX, state.panY);
		ctx.scale(state.scale, state.scale);

		const edgeTasks = this.renderEdges(ctx, layout, state, colors);
		this.drawNodes(ctx, layout, state, colors, edgeTasks);

		ctx.restore();
	}

	static getThemeColors(el: HTMLElement): ThemeColors {
		const compStyles = window.getComputedStyle(el);
		return {
			textNormal: compStyles.getPropertyValue('--text-normal').trim() || '#dcddde',
			textMuted: compStyles.getPropertyValue('--text-muted').trim() || '#999999',
			backgroundPrimary: compStyles.getPropertyValue('--background-primary').trim() || '#202020',
			backgroundModifierBorder: compStyles.getPropertyValue('--background-modifier-border').trim() || '#444444',
			interactiveAccent: compStyles.getPropertyValue('--interactive-accent').trim() || '#7a7af9',
			interactiveAccentHover: compStyles.getPropertyValue('--interactive-accent-hover').trim() || '#8b8bf9'
		};
	}

	private static adjustAlpha(color: string, alpha: number): string {
		let c = color;
		if (c.startsWith('var(')) {
			const div = activeDocument.createElement('div');
			div.style.setProperty('color', c);
			activeDocument.body.appendChild(div);
			c = window.getComputedStyle(div).color;
			activeDocument.body.removeChild(div);
		}
		if (c.startsWith('#')) {
			let hex = c.replace('#', '');
			if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
			const r = parseInt(hex.substring(0, 2), 16);
			const g = parseInt(hex.substring(2, 4), 16);
			const b = parseInt(hex.substring(4, 6), 16);
			return `rgba(${r}, ${g}, ${b}, ${alpha})`;
		}
		if (c.startsWith('rgb')) {
			const rgbValues = c.match(/\d+/g);
			if (rgbValues && rgbValues.length >= 3) {
				return `rgba(${rgbValues[0]}, ${rgbValues[1]}, ${rgbValues[2]}, ${alpha})`;
			}
		}
		return c;
	}

	private static renderEdges(
		ctx: CanvasRenderingContext2D,
		layout: GraphData,
		state: GraphRenderState,
		colors: ThemeColors
	): EdgeRenderTask[] {
		const tasks: EdgeRenderTask[] = [];
		const { selectedNode, hoveredNode, edgeDrawModeMap, edgeOffsetMap, combinedLabelMap } = state;
		
		const isFocusMode = selectedNode !== null || hoveredNode !== null;
		const focusId = hoveredNode?.id || selectedNode?.id;

		for (const edge of layout.edges) {
			const mode = edgeDrawModeMap.get(edge);
			if (mode === 'hide') continue;

			const srcLayout = layout.nodes.find((n) => n.id === edge.source);
			const tgtLayout = layout.nodes.find((n) => n.id === edge.target);
			if (!srcLayout || !tgtLayout) continue;

			const srcNode = srcLayout;
			const tgtNode = tgtLayout;

			const isSrcFocused = srcNode.id === focusId;
			const isTgtFocused = tgtNode.id === focusId;
			const isHighlighted = isSrcFocused || isTgtFocused;
			const isDimmed = isFocusMode && !isHighlighted;
			
			const offset = edgeOffsetMap.get(edge) || 0;
			const isMention = edge.type === 'mention';

			let drawMode = 'straight';
			if (mode === 'bidirectional') {
				drawMode = 'curve';
			}

			let showLabel = false;
			if (isHighlighted && !isMention) showLabel = true;
			if (isFocusMode && isMention && isHighlighted) showLabel = true;

			let priority = 0;
			if (isHighlighted) priority = 2;
			else if (!isDimmed) priority = 1;

			tasks.push({
				edge,
				src: srcNode,
				tgt: tgtNode,
				drawMode,
				offset,
				isHighlighted,
				isDimmed,
				isMention,
				showLabel,
				labelX: 0,
				labelY: 0,
				bgWidth: 0,
				bgHeight: 0,
				priority,
				isOverlapped: false
			});
		}

		tasks.sort((a, b) => a.priority - b.priority);

		for (const task of tasks) {
			const srcLayout = layout.nodes.find(n => n.id === task.src.id);
			const tgtLayout = layout.nodes.find(n => n.id === task.tgt.id);
			if (!srcLayout || !tgtLayout) continue;

			let baseColor = colors.backgroundModifierBorder;
			let strokeWidth = 1 / state.scale;
			if (strokeWidth < 0.5) strokeWidth = 0.5;

			if (task.isMention) {
				baseColor = colors.textMuted;
				ctx.setLineDash([4 / state.scale, 4 / state.scale]);
			} else {
				ctx.setLineDash([]);
			}

			if (task.isHighlighted) {
				baseColor = colors.interactiveAccent;
				strokeWidth = 2 / state.scale;
				if (task.isMention) strokeWidth = 1.5 / state.scale;
			} else if (task.isDimmed) {
				baseColor = this.adjustAlpha(colors.backgroundModifierBorder, 0.3);
				if (task.isMention) {
					baseColor = this.adjustAlpha(colors.textMuted, 0.2);
				}
			}

			ctx.strokeStyle = baseColor;
			ctx.lineWidth = strokeWidth;
			ctx.beginPath();

			if (task.drawMode === 'straight') {
				const { labelX, labelY } = this.drawStraightArrow(ctx, srcLayout, tgtLayout, task.isMention, state.scale);
				task.labelX = labelX;
				task.labelY = labelY;
			} else {
				const { labelX, labelY } = this.drawCurvedArrow(ctx, srcLayout, tgtLayout, task.offset, task.isMention, state.scale);
				task.labelX = labelX;
				task.labelY = labelY;
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}

		const fontSize = Math.max(10 / state.scale, 1);
		ctx.font = `${fontSize}px sans-serif`;

		for (const task of tasks) {
			if (!task.showLabel) continue;
			let label = task.edge.label || '';
			if (edgeDrawModeMap.get(task.edge) === 'bidirectional') {
				const combined = combinedLabelMap.get(task.edge);
				if (combined) label = combined;
			}
			if (!label) continue;

			const metrics = ctx.measureText(label);
			const padding = 2 / state.scale;
			task.bgWidth = metrics.width + padding * 2;
			task.bgHeight = fontSize + padding * 2;
		}

		for (const task of tasks) {
			if (!task.showLabel) continue;
			for (const other of tasks) {
				if (other === task || !other.showLabel) continue;
				if (Math.abs(task.labelX - other.labelX) < (task.bgWidth + other.bgWidth) / 2 &&
					Math.abs(task.labelY - other.labelY) < (task.bgHeight + other.bgHeight) / 2) {
					if (task.priority < other.priority) {
						task.isOverlapped = true;
					} else if (task.priority === other.priority && task.edge.source + task.edge.target < other.edge.source + other.edge.target) {
						task.isOverlapped = true;
					}
				}
			}
		}

		for (const task of tasks) {
			if (task.showLabel && !task.isOverlapped) {
				let label = task.edge.label || '';
				if (edgeDrawModeMap.get(task.edge) === 'bidirectional') {
					label = combinedLabelMap.get(task.edge) || label;
				}
				if (label) {
					this.drawEdgeLabel(ctx, label, task.labelX, task.labelY, task.bgWidth, task.bgHeight, task.isHighlighted, task.isMention, colors, state.scale);
				}
			}
		}

		return tasks;
	}

	private static drawStraightArrow(
		ctx: CanvasRenderingContext2D,
		srcLayout: GraphNode,
		tgtLayout: GraphNode,
		isMention: boolean,
		scale: number
	) {
		const dx = tgtLayout.x - srcLayout.x;
		const dy = tgtLayout.y - srcLayout.y;
		const angle = Math.atan2(dy, dx);
		

		const tgtRadius = this.NODE_RADIUS;
		const endX = tgtLayout.x - Math.cos(angle) * tgtRadius;
		const endY = tgtLayout.y - Math.sin(angle) * tgtRadius;

		ctx.moveTo(srcLayout.x, srcLayout.y);
		ctx.lineTo(endX, endY);

		if (!isMention) {
			const headlen = Math.max(6 / scale, 2);
			ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
			ctx.moveTo(endX, endY);
			ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
		} else {
			this.drawEdgeEndDot(ctx, endX, endY, scale);
		}

		return {
			labelX: srcLayout.x + dx * 0.5,
			labelY: srcLayout.y + dy * 0.5
		};
	}

	private static drawCurvedArrow(
		ctx: CanvasRenderingContext2D,
		srcLayout: GraphNode,
		tgtLayout: GraphNode,
		offset: number,
		isMention: boolean,
		scale: number
	) {
		const dx = tgtLayout.x - srcLayout.x;
		const dy = tgtLayout.y - srcLayout.y;
		const angle = Math.atan2(dy, dx);
		

		const midX = srcLayout.x + dx / 2;
		const midY = srcLayout.y + dy / 2;

		const normX = -Math.sin(angle);
		const normY = Math.cos(angle);

		const cx = midX + normX * offset;
		const cy = midY + normY * offset;

		ctx.moveTo(srcLayout.x, srcLayout.y);
		ctx.quadraticCurveTo(cx, cy, tgtLayout.x, tgtLayout.y);

		let t = 0.5;
		const bezierX = (1 - t) * (1 - t) * srcLayout.x + 2 * (1 - t) * t * cx + t * t * tgtLayout.x;
		const bezierY = (1 - t) * (1 - t) * srcLayout.y + 2 * (1 - t) * t * cy + t * t * tgtLayout.y;

		t = 0.9;
		const arrowX = (1 - t) * (1 - t) * srcLayout.x + 2 * (1 - t) * t * cx + t * t * tgtLayout.x;
		const arrowY = (1 - t) * (1 - t) * srcLayout.y + 2 * (1 - t) * t * cy + t * t * tgtLayout.y;

		const dt = 0.01;
		const nextX = (1 - (t + dt)) * (1 - (t + dt)) * srcLayout.x + 2 * (1 - (t + dt)) * (t + dt) * cx + (t + dt) * (t + dt) * tgtLayout.x;
		const nextY = (1 - (t + dt)) * (1 - (t + dt)) * srcLayout.y + 2 * (1 - (t + dt)) * (t + dt) * cy + (t + dt) * (t + dt) * tgtLayout.y;
		const arrowAngle = Math.atan2(nextY - arrowY, nextX - arrowX);

		if (!isMention) {
			const headlen = Math.max(6 / scale, 2);
			ctx.moveTo(arrowX, arrowY);
			ctx.lineTo(arrowX - headlen * Math.cos(arrowAngle - Math.PI / 6), arrowY - headlen * Math.sin(arrowAngle - Math.PI / 6));
			ctx.moveTo(arrowX, arrowY);
			ctx.lineTo(arrowX - headlen * Math.cos(arrowAngle + Math.PI / 6), arrowY - headlen * Math.sin(arrowAngle + Math.PI / 6));
		} else {
			this.drawEdgeEndDot(ctx, arrowX, arrowY, scale);
		}

		return {
			labelX: bezierX,
			labelY: bezierY
		};
	}

	private static drawEdgeEndDot(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
		const dotRadius = Math.max(2 / scale, 0.5);
		ctx.save();
		ctx.fillStyle = ctx.strokeStyle;
		ctx.beginPath();
		ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	private static drawEdgeLabel(
		ctx: CanvasRenderingContext2D,
		label: string,
		x: number,
		y: number,
		bgWidth: number,
		bgHeight: number,
		isHighlighted: boolean,
		isMention: boolean,
		colors: ThemeColors,
		scale: number
	): void {
		ctx.save();
		ctx.fillStyle = colors.backgroundPrimary;
		ctx.globalAlpha = 0.85;
		ctx.fillRect(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight);

		ctx.globalAlpha = 1.0;
		if (isHighlighted) {
			ctx.fillStyle = isMention ? colors.textMuted : colors.interactiveAccent;
		} else {
			ctx.fillStyle = colors.textMuted;
		}
		
		const fontSize = Math.max(10 / scale, 1);
		ctx.font = `${fontSize}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, x, y);
		ctx.restore();
	}

	private static getNodeTypeColor(typeStr: string, colors: ThemeColors): string {
		const hueMap: Record<string, number> = {
			'主角': 0, '主要角色': 0, '配角': 30, '反派': 300,
			'势力': 210, '组织': 210,
			'地点': 120, '世界观': 120,
			'物品': 45, '道具': 45, '功法': 45,
			'事件': 270
		};

		const typeNames = typeStr.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
		let primaryType = '其他';
		for (const t of typeNames) {
			if (hueMap[t] !== undefined) {
				primaryType = t;
				break;
			}
		}

		const hue = hueMap[primaryType];
		if (hue !== undefined) {
			return `hsl(${hue}, 70%, 50%)`;
		}
		return colors.textMuted;
	}

	private static drawNodes(
		ctx: CanvasRenderingContext2D,
		layout: GraphData,
		state: GraphRenderState,
		colors: ThemeColors,
		edgeTasks: EdgeRenderTask[] = []
	): void {
		const { selectedNode, hoveredNode, isLocalMode, localFocusNode } = state;
		const isFocusMode = selectedNode !== null || hoveredNode !== null;
		const focusId = hoveredNode?.id || selectedNode?.id;

		const highlightSet = new Set<string>();
		if (focusId) {
			highlightSet.add(focusId);
			for (const task of edgeTasks) {
				if (task.isHighlighted) {
					highlightSet.add(task.src.id);
					highlightSet.add(task.tgt.id);
				}
			}
		}

		for (const lNode of layout.nodes) {
			const node = lNode;
			let isHighlighted = false;
			let isDimmed = false;

			if (isFocusMode) {
				if (highlightSet.has(node.id)) isHighlighted = true;
				else isDimmed = true;
			} else if (isLocalMode && localFocusNode) {
				if (node.id === localFocusNode.id) isHighlighted = true;
			}

			let r = this.NODE_RADIUS;
			if (isHighlighted) r = this.NODE_HIGHLIGHT_RADIUS;

			let fill = this.getNodeTypeColor(node.nodeType || '其他', colors);
			let textFill = colors.textNormal;
			
			if (isDimmed) {
				fill = this.adjustAlpha(fill, 0.2);
				textFill = this.adjustAlpha(colors.textMuted, 0.3);
			} else if (isHighlighted && node.id === focusId) {
				textFill = colors.interactiveAccent;
			}

			ctx.beginPath();
			ctx.arc(lNode.x, lNode.y, r, 0, 2 * Math.PI, false);
			ctx.fillStyle = fill;
			ctx.fill();

			if (isHighlighted) {
				ctx.lineWidth = 2 / state.scale;
				ctx.strokeStyle = colors.interactiveAccent;
				ctx.stroke();
			}

			let fontSize = 12 / state.scale;
			if (fontSize < 1) fontSize = 1;
			if (isHighlighted) fontSize = 14 / state.scale;

			ctx.font = `${fontSize}px sans-serif`;
			ctx.fillStyle = textFill;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText(node.id || '', lNode.x, lNode.y + r + (4 / state.scale));
		}
	}
}







