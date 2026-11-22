import type { GraphNode } from '../../services/RelationGraphManager';
import type { GraphData } from '../../services/RelationGraphManager';
import { GraphRenderer, type GraphRenderState, type ThemeColors } from './GraphRenderer';

export interface GraphInteractionCallbacks {
	requestRender: () => void;
	onNodeDoubleClick: (node: GraphNode) => void;
	onBackgroundDoubleClick: () => void;
	onNodeHover: (node: GraphNode | null, e: MouseEvent) => void;
	onNodeDragStart: (node: GraphNode) => void;
	onNodeDrag: (node: GraphNode, x: number, y: number) => void;
	onNodeDragEnd: (node: GraphNode) => void;
}

export interface GraphInteractionOptions {
	zoomSensitivity?: number;
	getColors?: () => ThemeColors | undefined;
}

export class GraphInteractionController {
	private state: GraphRenderState;
	private layout: GraphData | null = null;
	private canvas: HTMLCanvasElement;
	private callbacks: GraphInteractionCallbacks;
	private options?: GraphInteractionOptions;
	private ownerWindow: Window;
	
	private isPanning: boolean = false;
	private panStartX: number = 0;
	private panStartY: number = 0;
	private draggedNode: GraphNode | null = null;
	
	private lastClickTime: number = 0;
	private lastClickedNode: GraphNode | null = null;
	
	// Touch pinch-to-zoom
	private initialPinchDistance: number = 0;
	private initialPinchScale: number = 1;
	private initialPinchCenter: { x: number, y: number } | null = null;

	private boundHandleMouseDown = this.handleMouseDown.bind(this);
	private boundHandleMouseMove = this.handleMouseMove.bind(this);
	private boundHandleMouseLeave = (e: MouseEvent) => this.updateHover(null, e);
	private boundHandleMouseUp = this.handleMouseUp.bind(this);
	private boundHandleWheel = this.handleWheel.bind(this);
	private boundHandleContextMenu = (e: MouseEvent) => e.preventDefault();
	
	private boundHandleTouchStart = this.handleTouchStart.bind(this);
	private boundHandleTouchMove = this.handleTouchMove.bind(this);
	private boundHandleTouchEnd = this.handleTouchEnd.bind(this);

	constructor(
		canvas: HTMLCanvasElement,
		initialState: GraphRenderState,
		callbacks: GraphInteractionCallbacks,
		options?: GraphInteractionOptions
	) {
		this.canvas = canvas;
		this.state = initialState;
		this.callbacks = callbacks;
		this.options = options;
		this.ownerWindow = canvas.ownerDocument.defaultView ?? window;
	}

	public bindEvents() {
		this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
		this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
		this.canvas.addEventListener('mouseleave', this.boundHandleMouseLeave);
		this.ownerWindow.addEventListener('mouseup', this.boundHandleMouseUp);
		this.canvas.addEventListener('wheel', this.boundHandleWheel, { passive: false });
		this.canvas.addEventListener('contextmenu', this.boundHandleContextMenu);
		
		this.canvas.addEventListener('touchstart', this.boundHandleTouchStart, { passive: false });
		this.canvas.addEventListener('touchmove', this.boundHandleTouchMove, { passive: false });
		this.canvas.addEventListener('touchend', this.boundHandleTouchEnd);
		this.canvas.addEventListener('touchcancel', this.boundHandleTouchEnd);
	}

	public unbindEvents() {
		this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
		this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
		this.canvas.removeEventListener('mouseleave', this.boundHandleMouseLeave);
		this.ownerWindow.removeEventListener('mouseup', this.boundHandleMouseUp);
		this.canvas.removeEventListener('wheel', this.boundHandleWheel);
		this.canvas.removeEventListener('contextmenu', this.boundHandleContextMenu);
		
		this.canvas.removeEventListener('touchstart', this.boundHandleTouchStart);
		this.canvas.removeEventListener('touchmove', this.boundHandleTouchMove);
		this.canvas.removeEventListener('touchend', this.boundHandleTouchEnd);
		this.canvas.removeEventListener('touchcancel', this.boundHandleTouchEnd);
	}

	public updateLayout(layout: GraphData) {
		if (this.layout === layout) return;
		this.layout = layout;
		const selectedId = this.state.selectedNode?.id;
		this.state.selectedNode = selectedId === undefined ? null : layout.nodes.find(node => node.id === selectedId) ?? null;
		this.state.hoveredNode = null;
	}

	public getState(): GraphRenderState {
		return this.state;
	}

	public setState(newState: Partial<GraphRenderState>) {
		Object.assign(this.state, newState);
	}

	private screenToGraph(screenX: number, screenY: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		const mouseX = screenX - rect.left;
		const mouseY = screenY - rect.top;
		const width = rect.width;
		const height = rect.height;
		const x = (mouseX - width / 2 - this.state.panX) / this.state.scale + width / 2;
		const y = (mouseY - height / 2 - this.state.panY) / this.state.scale + height / 2;
		return { x, y };
	}

	private findNodeAt(gx: number, gy: number): GraphNode | null {
		if (!this.layout) return null;
		const colors = this.options?.getColors?.();
		const focus = this.state.hoveredNode ?? this.state.selectedNode;
		const font = GraphRenderer.getNodeFont(colors);
		const fontSize = Number.parseFloat(font);
		let labelHit: GraphNode | null = null;
		for (let i = this.layout.nodes.length - 1; i >= 0; i--) {
			const node = this.layout.nodes[i];
			const dx = gx - node.x;
			const dy = gy - node.y;
			const radius = GraphRenderer.getNodeRadius(node, colors, node.id === focus?.id);
			const hitRadius = Math.max(radius, 5 / this.state.scale);
			if (dx * dx + dy * dy <= hitRadius * hitRadius) return node;

			const labelTop = Math.min(radius, GraphRenderer.getNodeRadius(node, colors)) + GraphRenderer.NODE_LABEL_GAP;
			const labelBottom = radius + GraphRenderer.NODE_LABEL_GAP + fontSize;
			if (labelHit || dy < labelTop - 2 || dy > labelBottom + 2 || Math.abs(dx) > fontSize * 6) continue;
			const ctx = this.canvas.getContext('2d');
			if (!ctx) continue;
			ctx.save();
			ctx.font = font;
			const width = ctx.measureText(GraphRenderer.getNodeLabel(node.heading)).width;
			ctx.restore();
			if (Math.abs(dx) <= width / 2 + 2) labelHit = node;
		}
		return labelHit;
	}

	private updateHover(node: GraphNode | null, e: MouseEvent): void {
		this.canvas.setCssStyles({ cursor: node ? 'pointer' : 'default' });
		if (node !== this.state.hoveredNode) {
			this.state.hoveredNode = node;
			this.callbacks.onNodeHover(node, e);
			this.callbacks.requestRender();
		} else if (node) {
			this.callbacks.onNodeHover(node, e);
		}
	}

	private handleMouseDown(e: MouseEvent): void {
		if (e.button === 0) {
			const pos = this.screenToGraph(e.clientX, e.clientY);
			const node = this.findNodeAt(pos.x, pos.y);
			
			const now = Date.now();
			const isDoubleClick = (now - this.lastClickTime < 300) && (this.lastClickedNode === node);
			this.lastClickTime = now;
			this.lastClickedNode = node;

			if (isDoubleClick) {
				if (node) {
					this.state.selectedNode = node;
					this.callbacks.onNodeDoubleClick(node);
				} else {
					this.callbacks.onBackgroundDoubleClick();
				}
				this.lastClickTime = 0;
				this.lastClickedNode = null;
				return;
			}

			if (node) {
				this.draggedNode = node;
				this.state.selectedNode = node;
				this.callbacks.onNodeDragStart(node);
			} else {
				this.isPanning = true;
				this.panStartX = e.clientX - this.state.panX;
				this.panStartY = e.clientY - this.state.panY;
				this.state.selectedNode = null;
			}
			this.callbacks.requestRender();
		} else if (e.button === 1 || e.button === 2) {
			this.isPanning = true;
			this.panStartX = e.clientX - this.state.panX;
			this.panStartY = e.clientY - this.state.panY;
			e.preventDefault();
		}
	}

	private handleMouseMove(e: MouseEvent): void {
		if (this.isPanning) {
			this.state.panX = e.clientX - this.panStartX;
			this.state.panY = e.clientY - this.panStartY;
			this.callbacks.requestRender();
		} else if (this.draggedNode) {
			const pos = this.screenToGraph(e.clientX, e.clientY);
			this.callbacks.onNodeDrag(this.draggedNode, pos.x, pos.y);
		} else {
			const pos = this.screenToGraph(e.clientX, e.clientY);
			this.updateHover(this.findNodeAt(pos.x, pos.y), e);
		}
	}

	private handleMouseUp(_e: MouseEvent): void {
		this.isPanning = false;
		if (this.draggedNode) {
			this.callbacks.onNodeDragEnd(this.draggedNode);
			this.draggedNode = null;
		}
	}

	private handleWheel(e: WheelEvent): void {
		e.preventDefault();
		const minScale = 0.2;
		const maxScale = 5.0;

		const oldScale = this.state.scale;
		let newScale: number;

		if (this.options?.zoomSensitivity !== undefined) {
			const delta = -e.deltaY * this.options.zoomSensitivity;
			newScale = Math.max(minScale, Math.min(maxScale, oldScale + delta * oldScale));
		} else {
			const zoomDelta = e.deltaY > 0 ? -1 : 1;
			const zoomFactor = 1 + zoomDelta * 0.1;
			newScale = Math.max(minScale, Math.min(maxScale, oldScale * zoomFactor));
		}

		const rect = this.canvas.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;
		const width = rect.width;
		const height = rect.height;

		const dx = mouseX - width / 2;
		const dy = mouseY - height / 2;

		this.state.panX = dx - (dx - this.state.panX) * (newScale / oldScale);
		this.state.panY = dy - (dy - this.state.panY) * (newScale / oldScale);
		this.state.scale = newScale;

		this.callbacks.requestRender();
	}

	private handleTouchStart(e: TouchEvent): void {
		if (e.touches.length === 1) {
			const touch = e.touches[0];
			const pos = this.screenToGraph(touch.clientX, touch.clientY);
			const node = this.findNodeAt(pos.x, pos.y);
			
			const now = Date.now();
			const isDoubleClick = (now - this.lastClickTime < 300) && (this.lastClickedNode === node);
			this.lastClickTime = now;
			this.lastClickedNode = node;

			if (isDoubleClick) {
				e.preventDefault();
				if (node) {
					this.state.selectedNode = node;
					this.callbacks.onNodeDoubleClick(node);
				} else {
					this.callbacks.onBackgroundDoubleClick();
				}
				this.lastClickTime = 0;
				this.lastClickedNode = null;
				return;
			}

			if (node) {
				e.preventDefault();
				this.draggedNode = node;
				this.state.selectedNode = node;
				this.callbacks.onNodeDragStart(node);
				this.callbacks.requestRender();
			} else {
				this.isPanning = true;
				this.panStartX = touch.clientX - this.state.panX;
				this.panStartY = touch.clientY - this.state.panY;
				this.state.selectedNode = null;
				this.callbacks.requestRender();
			}
		} else if (e.touches.length === 2) {
			e.preventDefault();
			this.isPanning = false;
			if (this.draggedNode) {
				this.callbacks.onNodeDragEnd(this.draggedNode);
				this.draggedNode = null;
			}
			
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			const dx = t1.clientX - t2.clientX;
			const dy = t1.clientY - t2.clientY;
			this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
			this.initialPinchScale = this.state.scale;
			
			const rect = this.canvas.getBoundingClientRect();
			this.initialPinchCenter = {
				x: (t1.clientX + t2.clientX) / 2 - rect.left,
				y: (t1.clientY + t2.clientY) / 2 - rect.top
			};
		}
	}

	private handleTouchMove(e: TouchEvent): void {
		if (e.touches.length === 1) {
			const touch = e.touches[0];
			if (this.isPanning) {
				e.preventDefault();
				this.state.panX = touch.clientX - this.panStartX;
				this.state.panY = touch.clientY - this.panStartY;
				this.callbacks.requestRender();
			} else if (this.draggedNode) {
				e.preventDefault();
				const pos = this.screenToGraph(touch.clientX, touch.clientY);
				this.callbacks.onNodeDrag(this.draggedNode, pos.x, pos.y);
			}
		} else if (e.touches.length === 2 && this.initialPinchCenter) {
			e.preventDefault();
			const minScale = 0.2;
			const maxScale = 5.0;
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			const dx = t1.clientX - t2.clientX;
			const dy = t1.clientY - t2.clientY;
			const currentDist = Math.sqrt(dx * dx + dy * dy);
			
			const scaleRatio = currentDist / this.initialPinchDistance;
			let newScale = this.initialPinchScale * scaleRatio;
			newScale = Math.max(minScale, Math.min(newScale, maxScale));
			
			const oldScale = this.state.scale;
			this.state.panX = this.initialPinchCenter.x - (this.initialPinchCenter.x - this.state.panX) * (newScale / oldScale);
			this.state.panY = this.initialPinchCenter.y - (this.initialPinchCenter.y - this.state.panY) * (newScale / oldScale);
			this.state.scale = newScale;
			
			this.callbacks.requestRender();
		}
	}

	private handleTouchEnd(e: TouchEvent): void {
		if (e.touches.length === 0) {
			this.isPanning = false;
			if (this.draggedNode) {
				this.callbacks.onNodeDragEnd(this.draggedNode);
				this.draggedNode = null;
			}
			this.initialPinchCenter = null;
		} else if (e.touches.length === 1) {
			this.initialPinchCenter = null;
			const touch = e.touches[0];
			this.isPanning = true;
			this.panStartX = touch.clientX - this.state.panX;
			this.panStartY = touch.clientY - this.state.panY;
		}
	}
}

