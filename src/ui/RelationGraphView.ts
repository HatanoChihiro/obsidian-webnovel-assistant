/**
 * 关系图谱视图 (Relation Graph View)
 *
 * 基于 Obsidian ItemView 的 Canvas 2D 力导向关系图谱视图。
 * 在编辑区以新 tab 页签打开，提供与 Obsidian 官方 Graph View 类似的交互体验。
 *
 * 核心特性：
 * - 纯 Canvas 2D 手写渲染，零外部依赖
 * - 力导向布局自动收敛
 * - 有向边渲染（箭头 + 弧线双向边偏移）
 * - 拖拽节点、滚轮缩放、平移画布
 * - 双击节点进入局部模式（1 跳邻居）
 * - 双击空白返回全量模式
 *
 * 设计约束（Obsidian 审核合规）：
 * - 不使用 innerHTML，全部通过 createEl/createDiv 构建 DOM
 * - 样式操作使用 setCssStyles 或 CSS class，不直接赋值 el.style
 * - 定时器使用 window.requestAnimationFrame 并在 onClose 中清理
 */

import { ItemView, Notice, TFile, MarkdownView } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { RelationGraphManager } from '../services/RelationGraphManager';
import { ForceLayoutEngine } from '../services/ForceLayoutEngine';
import type { GraphNode, GraphData, GraphEdge } from '../services/RelationGraphManager';
import type { LayoutNode, LayoutEdge } from '../services/ForceLayoutEngine';
import { t } from '../i18n';

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

// ==========================================
// 常量
// ==========================================

export const RELATION_GRAPH_VIEW_TYPE = 'webnovel-relation-graph';

/** 节点渲染半径（像素） */
const NODE_RADIUS = 5;

/** 节点选中/高亮时的放大半径 */
const NODE_HIGHLIGHT_RADIUS = 7;

/** 缩放限制 */
const MIN_SCALE = 0.2;
const MAX_SCALE = 5.0;

/** 缩放步进系数 */
const ZOOM_FACTOR = 0.001;

/** 双击间隔阈值（毫秒） */
const DOUBLE_CLICK_THRESHOLD = 300;

/** Canvas 设备像素比（用于高分辨率屏幕清晰渲染） */
const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

// ==========================================
// ViewState 接口
// ==========================================

/** 视图状态：用于 Obsidian 的 getState/setState 持久化 */
interface RelationGraphViewState extends Record<string, unknown> {
	filePath: string;
	bookPath: string;
}

export interface LayoutData {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
}

// ==========================================
// 视图实现
// ==========================================

export class RelationGraphView extends ItemView {
	private plugin: WebNovelAssistantPlugin;

	// --- Canvas 相关 ---
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private container: HTMLElement | null = null;

	// --- 图谱数据 ---
	private graphData: GraphData = { nodes: [], edges: [] };
	private engine: ForceLayoutEngine | null = null;

	// --- 视图状态 ---
	private filePath: string = '';
	private bookPath: string = '';

	// --- 视图变换（缩放 + 平移） ---
	private scale: number = 1.0;
	private panX: number = 0;
	private panY: number = 0;

	// --- 交互状态 ---
	/** 当前正在拖拽的节点（null 表示没有拖拽节点） */
	private draggedNode: GraphNode | null = null;
	/** 当前是否在拖拽画布（右键/中键拖拽） */
	private isPanning: boolean = false;
	/** 平移操作的起始鼠标位置 */
	private panStartX: number = 0;
	private panStartY: number = 0;
	/** 当前选中（高亮）的节点 */
	private selectedNode: GraphNode | null = null;
	/** 当前鼠标悬停的节点（用于 tooltip） */
	private hoveredNode: GraphNode | null = null;
	/** 上次点击的时间戳（用于双击检测） */
	private lastClickTime: number = 0;
	/** 上次点击的节点（用于双击检测） */
	private lastClickedNode: GraphNode | null = null;

	// --- 局部模式 ---
	/** 是否处于局部模式 */
	private isLocalMode: boolean = false;
	/** 局部模式的焦点节点 */
	private localFocusNode: GraphNode | null = null;
	/** 全量图谱数据的备份（进入局部模式时保存） */
	private fullGraphData: GraphData | null = null;

	// --- DOM 元素 ---
	private breadcrumbEl: HTMLElement | null = null;
	private hintEl: HTMLElement | null = null;

	// --- 动画控制 ---
	private animationFrameId: number = 0;
	private currentAnimationToken: number = 0;

	// --- 边偏移量集合（用于处理两节点间存在多条边的情况） ---
	private edgeOffsetMap: Map<GraphEdge, number> = new Map();
	private edgeDrawModeMap: Map<GraphEdge, 'hide' | 'bidirectional'> = new Map();
	private combinedLabelMap: Map<GraphEdge, string> = new Map();

	// --- 事件绑定引用（用于 onClose 清理） ---
	private boundHandleMouseDown: ((e: MouseEvent) => void) | null = null;
	private boundHandleMouseMove: ((e: MouseEvent) => void) | null = null;
	private boundHandleMouseUp: ((e: MouseEvent) => void) | null = null;
	private boundHandleWheel: ((e: WheelEvent) => void) | null = null;
	private boundHandleContextMenu: ((e: MouseEvent) => void) | null = null;

	// Touch events for pinch-to-zoom
	private boundHandleTouchStart: ((e: TouchEvent) => void) | null = null;
	private boundHandleTouchMove: ((e: TouchEvent) => void) | null = null;
	private boundHandleTouchEnd: ((e: TouchEvent) => void) | null = null;
	private initialPinchDistance: number = 0;
	private initialPinchScale: number = 1;
	private initialPinchCenter: { x: number, y: number } | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return RELATION_GRAPH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('view.relation-graph');
	}

	getIcon(): string {
		return 'git-fork';
	}

	// ==========================================
	// 生命周期
	// ==========================================

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		// 创建容器
		this.container = contentEl.createDiv({ cls: 'wna-relation-graph-container' });

		// 创建 Canvas
		this.canvas = this.container.createEl('canvas');
		this.ctx = this.canvas.getContext('2d');

		// 创建面包屑（初始隐藏）
		this.breadcrumbEl = this.container.createDiv({ cls: 'wna-relation-graph-breadcrumb' });
		this.breadcrumbEl.setCssStyles({ display: 'none' });

		// 创建操作提示
		this.hintEl = this.container.createDiv({ cls: 'wna-relation-graph-hint' });
		this.hintEl.textContent = t('relation-graph.hint-double-click-node');

		// 绑定事件
		this.bindEvents();

		// 初始化画布尺寸
		this.updateCanvasSize();

		// 设置 ResizeObserver 监听容器变化
		this.resizeObserver = new ResizeObserver(() => {
			this.updateCanvasSize();
			if (this.engine) {
				this.engine.resize(this.canvas!.width / DPR, this.canvas!.height / DPR);
				if (this.engine.isConverged) {
					this.engine.reset();
					this.startAnimationLoop();
				}
			}
			this.render();
		});
		this.resizeObserver.observe(this.container);

		// 每次打开视图时清空颜色缓存，以便响应主题切换
		this.cachedColors = null;

		// 如果有保存的状态，自动加载
		if (this.filePath) {
			await this.loadGraphForFile(this.filePath);
		}

		// 监听文档变更实现图谱实时静默刷新
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && this.filePath && this.bookPath === this.plugin.characterManager.getBookPathForFile(file)) {
				// 避免高频刷新，使用一个简易节流/防抖或者直接调用（metadataCache 自身有约 2s 的防抖延迟）
				void this.softReloadGraph();
			}
		}));
	}

	async onClose(): Promise<void> {
		// 停止动画循环
		if (this.animationFrameId) {
			window.cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = 0;
		}

		// 清理 ResizeObserver
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		// 清理事件绑定
		this.unbindEvents();

		this.canvas = null;
		this.ctx = null;
		this.container = null;
	}

	// ==========================================
	// 状态持久化
	// ==========================================

	getState(): RelationGraphViewState {
		return {
			filePath: this.filePath,
			bookPath: this.bookPath,
		};
	}

	async setState(state: Record<string, unknown>): Promise<void> {
		if (typeof state.filePath === 'string') {
			this.filePath = state.filePath;
		}
		if (typeof state.bookPath === 'string') {
			this.bookPath = state.bookPath;
		}

		if (this.filePath && this.canvas) {
			await this.loadGraphForFile(this.filePath);
		}
	}

	// ==========================================
	// 数据加载
	// ==========================================

	/**
	 * 加载指定文件的关系图谱数据并启动布局
	 */
	public async loadGraphForFile(filePath: string): Promise<void> {
		this.filePath = filePath;

		// 确保在手机/平板端，打开图谱时能惰性加载角色管理器缓存，避免双击跳转失效
		await this.plugin.characterManager.ensureInitialized();

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			this.showEmptyState();
			return;
		}

		this.bookPath = this.plugin.characterManager.getBookPathForFile(file) || '';

		const manager = new RelationGraphManager(this.app, this.plugin);
		const data = await manager.buildGraphData(file);

		if (data.nodes.length === 0) {
			this.showEmptyState();
			return;
		}

		this.graphData = data;
		this.fullGraphData = null;
		this.isLocalMode = false;
		this.selectedNode = null;
		this.localFocusNode = null;

		// 在初始化物理引擎前，将所有节点在一个大圆上均匀排布
		// 这种初始状态能给 D3 最大的拓扑解开空间，极大减少全量图谱的最终连线交叉
		const cx = this.canvas ? this.canvas.width / DPR / 2 : 150;
		const cy = this.canvas ? this.canvas.height / DPR / 2 : 150;
		const radius = Math.min(cx, cy) * 0.8;

		this.graphData.nodes.forEach((node, i) => {
			const angle = (i / this.graphData.nodes.length) * Math.PI * 2;
			node.x = cx + radius * Math.cos(angle);
			node.y = cy + radius * Math.sin(angle);
			node.vx = 0;
			node.vy = 0;
			node.pinned = false;
		});

		// 构建双向边查找集合
		this.buildEdgeOffsets();

		// 初始化力导向引擎
		this.initEngine();

		// 更新 UI
		this.updateBreadcrumb();
		this.updateHint();

		// 启动动画循环（强制静默收敛并居中）
		this.startAnimationLoop(true);
	}

	/**
	 * 静默刷新图谱数据（保留现有节点的物理状态），用于文档编辑时的实时反馈
	 */
	private async softReloadGraph(): Promise<void> {
		if (!this.filePath) return;
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) return;

		const manager = new RelationGraphManager(this.app, this.plugin);
		const newData = await manager.buildGraphData(file);

		if (newData.nodes.length === 0) {
			this.showEmptyState();
			return;
		}

		// 保留现有节点的物理坐标，避免刷新时图谱“爆炸”
		const oldNodesMap = new Map(this.graphData.nodes.map(n => [n.id, n]));
		
		const cx = this.canvas ? this.canvas.width / DPR / 2 : 150;
		const cy = this.canvas ? this.canvas.height / DPR / 2 : 150;
		const radius = Math.min(cx, cy) * 0.8;

		newData.nodes.forEach((newNode, i) => {
			const oldNode = oldNodesMap.get(newNode.id);
			if (oldNode) {
				newNode.x = oldNode.x;
				newNode.y = oldNode.y;
				newNode.vx = oldNode.vx;
				newNode.vy = oldNode.vy;
				newNode.pinned = oldNode.pinned;
			} else {
				// 新加入的节点放在外围圆环上，方便引擎自然拉入
				const angle = (i / newData.nodes.length) * Math.PI * 2;
				newNode.x = cx + radius * Math.cos(angle);
				newNode.y = cy + radius * Math.sin(angle);
				newNode.vx = 0;
				newNode.vy = 0;
				newNode.pinned = false;
			}
		});

		this.graphData = newData;
		this.buildEdgeOffsets();

		if (this.engine) {
			this.engine.updateData(this.graphData.nodes, this.graphData.edges);
			this.engine.reheat();
			this.startAnimationLoop();
		} else {
			this.initEngine();
			this.startAnimationLoop(true);
		}
	}

	/**
	 * 显示空状态提示（无数据时）
	 */
	private showEmptyState(): void {
		if (!this.container) return;
		if (this.canvas) {
			this.canvas.setCssStyles({ display: 'none' });
		}
		// 检查是否已有空状态 div，避免重复创建
		const existing = this.container.querySelector('.wna-relation-graph-empty');
		if (!existing) {
			this.container.createDiv({
				cls: 'wna-relation-graph-empty',
				text: t('relation-graph.no-data'),
			});
		}
	}

	// ==========================================
	// 力导向引擎
	// ==========================================

	/**
	 * 初始化力导向引擎
	 */
	private initEngine(): void {
		if (!this.canvas) return;

		const width = this.canvas.width / DPR;
		const height = this.canvas.height / DPR;

		// 将 GraphNode 转换为 LayoutNode（接口兼容）
		const layoutNodes: LayoutNode[] = this.graphData.nodes.map(n => ({
			id: n.id,
			x: n.x,
			y: n.y,
			vx: n.vx,
			vy: n.vy,
			pinned: n.pinned,
		}));

		this.engine = new ForceLayoutEngine(layoutNodes, this.graphData.edges, width, height);
	}

	/**
	 * 自动计算图谱的边界，并调整缩放和平移以适应屏幕
	 */
	private fitToScreen(): void {
		if (!this.canvas || this.graphData.nodes.length === 0) return;

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const node of this.graphData.nodes) {
			if (node.x < minX) minX = node.x;
			if (node.y < minY) minY = node.y;
			if (node.x > maxX) maxX = node.x;
			if (node.y > maxY) maxY = node.y;
		}

		if (minX === Infinity || maxX - minX < 10) {
			this.panX = 0;
			this.panY = 0;
			this.scale = 1;
			return;
		}

		const padding = 60;
		const graphWidth = maxX - minX;
		const graphHeight = maxY - minY;
		
		const canvasWidth = this.canvas.width / DPR;
		const canvasHeight = this.canvas.height / DPR;

		const scaleX = (canvasWidth - padding * 2) / Math.max(graphWidth, 1);
		const scaleY = (canvasHeight - padding * 2) / Math.max(graphHeight, 1);
		
		// 大幅提高小图谱的默认放大倍率（上限从 1.8 提高到 2.8，基础放大 1.6 倍）
		let targetScale = Math.min(scaleX, scaleY) * 1.6;
		targetScale = Math.max(0.6, Math.min(targetScale, 2.8));

		this.scale = targetScale;

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		this.panX = (canvasWidth / 2 - centerX) * this.scale;
		this.panY = (canvasHeight / 2 - centerY) * this.scale;
	}

	/**
	 * 启动 requestAnimationFrame 动画循环
	 * @param isFirstLoad 是否为初次加载（进入局部/全量图谱时），是则静默计算完全收敛并居中
	 */
	private startAnimationLoop(isFirstLoad: boolean = false): void {
		// 先取消已有的循环
		if (this.animationFrameId) {
			window.cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = 0;
		}

		// 生成唯一 token，保证同一时间只有一个循环执行渲染
		const token = ++this.currentAnimationToken;

		// 初次加载时：恢复 D3 绝美的物理展开动画！不再强行静默计算。
		// 只需要确保初始镜头是对准画布中心的即可。
		if (isFirstLoad) {
			this.panX = 0;
			this.panY = 0;
			
			// 根据节点数量智能判断初始缩放倍率，防止小图谱在默认 1.0 缩放时显得极小
			const nodeCount = this.graphData.nodes.length;
			if (nodeCount <= 6) {
				this.scale = 2.2;
			} else if (nodeCount <= 12) {
				this.scale = 1.6;
			} else if (nodeCount <= 25) {
				this.scale = 1.2;
			} else {
				this.scale = 1.0;
			}
		}

		const loop = () => {
			if (this.currentAnimationToken !== token) return;
			if (!this.engine || !this.canvas) return;

			// 在计算前同步一次，确保用户拖拽的最新位置立即传递给引擎
			this.syncNodePositions();

			// 每渲染一帧，推进多次物理计算
			const ticksPerFrame = 3;
			let running = true;
			for (let i = 0; i < ticksPerFrame; i++) {
				running = this.engine.tick();
				if (!running) break;
			}

			// 将引擎计算后的坐标同步回 GraphNode 用于渲染
			this.syncNodePositions();

			// 渲染
			this.render();

			// 如果仍在运动中，继续下一帧
			if (running) {
				this.animationFrameId = window.requestAnimationFrame(loop);
			} else {
				this.animationFrameId = 0;
			}
		};

		this.animationFrameId = window.requestAnimationFrame(loop);
	}

	/**
	 * 将引擎中的坐标同步回 GraphNode 数组
	 */
	private syncNodePositions(): void {
		if (!this.engine) return;
		for (let i = 0; i < this.engine.nodes.length && i < this.graphData.nodes.length; i++) {
			this.graphData.nodes[i].x = this.engine.nodes[i].x;
			this.graphData.nodes[i].y = this.engine.nodes[i].y;
		}
	}

	// ==========================================
	// Canvas 渲染
	// ==========================================

	/**
	 * 执行一帧完整的 Canvas 渲染
	 */
	private render(layout?: LayoutData): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) return;

		const width = canvas.width / DPR;
		const height = canvas.height / DPR;

		// 强制重置变换矩阵，确保 clearRect 能清理整个物理画布，消除可能的残影
		ctx.resetTransform();
		// 清空画布 (放大清理区域以防边缘残留)
		ctx.clearRect(-1000, -1000, canvas.width + 2000, canvas.height + 2000);
		ctx.save();

		// 应用设备像素比缩放（高分屏清晰渲染）
		ctx.scale(DPR, DPR);

		// 应用视图变换（平移 + 缩放）
		ctx.translate(width / 2 + this.panX, height / 2 + this.panY);
		ctx.scale(this.scale, this.scale);
		ctx.translate(-width / 2, -height / 2);

		// 读取 Obsidian 主题颜色
		const colors = this.getThemeColors();

		// 先绘制边（在节点下方）
		const edgeTasks = this.renderEdges(ctx, colors);

		// 再绘制节点（在边上方）
		this.drawNodes(ctx, layout || {nodes: this.graphData.nodes, edges: this.graphData.edges}, colors, edgeTasks);

		ctx.restore();
	}

	private cachedColors: ThemeColors | null = null;

	/**
	 * 从 Obsidian 的 CSS 变量中读取主题颜色
	 * 添加缓存避免每帧调用 getComputedStyle 导致严重的性能卡顿
	 */
	private getThemeColors(): ThemeColors {
		if (this.cachedColors) return this.cachedColors;

		const rootStyle = getComputedStyle(activeDocument.body);
		this.cachedColors = {
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
		return this.cachedColors;
	}

	/**
	 * 计算点到线段的距离（用于线与标签的碰撞检测）
	 */
	private distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
		if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
		let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
		t = Math.max(0, Math.min(1, t));
		return Math.sqrt((px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2);
	}

	// ==========================================

	/**
	 * 渲染所有边（有向箭头 + 关系标签）
	 */
	private renderEdges(ctx: CanvasRenderingContext2D, colors: ThemeColors): EdgeRenderTask[] {
		const edgeTasks: EdgeRenderTask[] = [];
		const showLabelsGlobally = this.scale >= 0.7;

		// 找出当前未被淡化的活跃节点
		const activeNodeIds = new Set<string>();
		const centerNode = this.selectedNode || this.hoveredNode;
		if (centerNode) {
			activeNodeIds.add(centerNode.id);
			for (const edge of this.graphData.edges) {
				if (edge.source === centerNode.id) activeNodeIds.add(edge.target);
				if (edge.target === centerNode.id) activeNodeIds.add(edge.source);
			}
		} else {
			for (const node of this.graphData.nodes) {
				activeNodeIds.add(node.id);
			}
		}

		ctx.save();
		ctx.font = '6px sans-serif'; 

		// 第一遍：收集所有边的信息，计算标签的包围盒，并确定优先级
		for (const edge of this.graphData.edges) {
			const src = this.graphData.nodes.find(n => n.id === edge.source);
			const tgt = this.graphData.nodes.find(n => n.id === edge.target);
			if (!src || !tgt) continue;

			const drawMode = this.edgeDrawModeMap.get(edge);
			if (drawMode === 'hide') continue;

			const offset = this.edgeOffsetMap.get(edge) || 0;
			
			let isHighlighted = false;
			let isDimmed = false;
			if (this.selectedNode) {
				isHighlighted = edge.source === this.selectedNode.id || edge.target === this.selectedNode.id;
				isDimmed = !isHighlighted;
			} else if (this.hoveredNode) {
				isHighlighted = edge.source === this.hoveredNode.id || edge.target === this.hoveredNode.id;
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
				const dist = this.distToSegment(task.labelX, task.labelY, line.x1, line.y1, line.x2, line.y2);
				return dist < 8; // 8 像素以内认为标签压到了线
			});

			// 3. 碰撞检测：与活跃节点（排除起止节点）
			// 明确关系极为重要，不让步于节点；提及关系则主动让步于节点
			const shouldYieldToNode = !task.isHighlighted || task.isMention;
			const isCollidingWithNode = shouldYieldToNode && this.graphData.nodes.some(n => 
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
			const displayLabel = this.combinedLabelMap.get(task.edge) || task.edge.label;
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
				this.drawCurvedArrow(ctx, src, tgt, offset, colors, isBidirectional);
			} else {
				this.drawStraightArrow(ctx, src, tgt, colors, isBidirectional);
			}
			ctx.restore();
		}

		// 第四遍：画标签（同样从低优先级到高优先级画，确保高优先级盖在最上层）
		for (let i = edgeTasks.length - 1; i >= 0; i--) {
			const task = edgeTasks[i];
			const displayLabel = this.combinedLabelMap.get(task.edge) || task.edge.label;
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

			this.drawEdgeLabel(ctx, src, tgt, displayLabel, offset, isMention, colors, labelAlpha, isHighlighted);
		}
		
		return edgeTasks;
	}

	/**
	 * 绘制直线箭头边
	 */
	private drawStraightArrow(
		ctx: CanvasRenderingContext2D,
		src: GraphNode,
		tgt: GraphNode,
		_colors: ThemeColors,
		isBidirectional: boolean = false
	): void {
		const dx = tgt.x - src.x;
		const dy = tgt.y - src.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist === 0) return;

		// 计算箭头终点（留出呼吸感，距离节点边缘再隔开 4 像素）
		const gap = NODE_RADIUS + 4;
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
		this.drawEdgeEndDot(ctx, arrowTipX, arrowTipY);
		if (isBidirectional) {
			this.drawEdgeEndDot(ctx, startX, startY);
		}
	}

	/**
	 * 绘制弧线箭头边（双向边时使用）
	 *
	 * 通过二次贝塞尔曲线向一侧偏移，使两条反向边不重叠
	 */
	private drawCurvedArrow(
		ctx: CanvasRenderingContext2D,
		src: GraphNode,
		tgt: GraphNode,
		offset: number,
		_colors: ThemeColors,
		isBidirectional: boolean = false
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
		const gap = NODE_RADIUS + 4;
		
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
		this.drawEdgeEndDot(ctx, endX, endY);
		if (isBidirectional) {
			this.drawEdgeEndDot(ctx, startX, startY);
		}
	}

	/**
	 * 绘制线条端点（小圆点）
	 */
	private drawEdgeEndDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, 1.0, 0, Math.PI * 2);
		ctx.fillStyle = ctx.strokeStyle;
		ctx.fill();
		ctx.restore();
	}

	/**
	 * 绘制边上的关系标签
	 */
	private drawEdgeLabel(
		ctx: CanvasRenderingContext2D,
		src: GraphNode,
		tgt: GraphNode,
		label: string,
		curveOffset: number,
		isMention: boolean,
		colors: ThemeColors,
		labelAlpha: number = 1.0,
		isHighlighted: boolean = false
	): void {
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

	/** 自动分配类型颜色 */
	private getNodeTypeColor(typeStr: string, colors: ThemeColors): string {
		let hash = 0;
		for (let i = 0; i < typeStr.length; i++) {
			hash = typeStr.charCodeAt(i) + ((hash << 5) - hash);
		}
		const index = Math.abs(hash) % colors.typePalette.length;
		return colors.typePalette[index];
	}

	/** 绘制所有节点（带有优化） */
	private drawNodes(ctx: CanvasRenderingContext2D, layout: LayoutData, colors: ThemeColors, edgeTasks: EdgeRenderTask[] = []): void {
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

		for (const node of this.graphData.nodes) {
			const isSelected = this.selectedNode?.id === node.id;
			const isHovered = this.hoveredNode?.id === node.id;
			const radius = isSelected || isHovered ? NODE_HIGHLIGHT_RADIUS : NODE_RADIUS;

			// 当有选中节点时，非关联节点大幅度淡出，模仿官方高对比度渐隐
			let nodeAlpha = 1.0;
			let isDimmed = false;
			if (this.selectedNode && !isSelected) {
				const neighborTasks = edgeTasks.filter(
					t => (t.src.id === this.selectedNode!.id && t.tgt.id === node.id) ||
						 (t.tgt.id === this.selectedNode!.id && t.src.id === node.id)
				);
				const isNeighbor = neighborTasks.length > 0;
				// 如果该节点的所有关联边都被重叠淡化了，那么该节点也应跟随淡化
				const allEdgesOverlapped = isNeighbor && neighborTasks.every(t => t.isOverlapped);

				nodeAlpha = isNeighbor ? (allEdgesOverlapped ? 0.35 : 1.0) : 0.15;
				isDimmed = !isNeighbor || allEdgesOverlapped;
			} else if (this.hoveredNode && !isHovered) {
				const neighborTasks = edgeTasks.filter(
					t => (t.src.id === this.hoveredNode!.id && t.tgt.id === node.id) ||
						 (t.tgt.id === this.hoveredNode!.id && t.src.id === node.id)
				);
				const isNeighbor = neighborTasks.length > 0;
				const allEdgesOverlapped = isNeighbor && neighborTasks.every(t => t.isOverlapped);

				nodeAlpha = isNeighbor ? (allEdgesOverlapped ? 0.35 : 1.0) : 0.3;
				isDimmed = !isNeighbor || allEdgesOverlapped;
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
				overlayColor = this.getNodeTypeColor(node.nodeType, colors); // 原生变量池叠色
			}

			if (isDimmed) {
				baseColor = colors.textMuted;
				overlayColor = null;
			} else if (!node.nodeType && (isSelected || isHovered)) {
				baseColor = colors.graphNodeFocused;
			}

			// 悬停高亮时：降低主题底色的透明度，以便让叠加层透出来（提升类型颜色）
			let currentBaseAlpha = nodeAlpha;
			if (overlayColor && !isDimmed && (isSelected || isHovered)) {
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
				// 叠加层透明度：选中/悬停时为 0.8，否则为 0.5
				ctx.globalAlpha = nodeAlpha * ((isSelected || isHovered) ? 0.8 : 0.5); 
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

	// ==========================================
	// 事件处理
	// ==========================================

	/**
	 * 绑定 Canvas 事件
	 */
	private bindEvents(): void {
		if (!this.canvas) return;

		this.boundHandleMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
		this.boundHandleMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
		this.boundHandleMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
		this.boundHandleWheel = (e: WheelEvent) => this.handleWheel(e);
		this.boundHandleContextMenu = (e: MouseEvent) => e.preventDefault();
		
		this.boundHandleTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
		this.boundHandleTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
		this.boundHandleTouchEnd = (e: TouchEvent) => this.handleTouchEnd(e);

		this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
		this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
		this.canvas.addEventListener('mouseup', this.boundHandleMouseUp);
		this.canvas.addEventListener('wheel', this.boundHandleWheel, { passive: false });
		this.canvas.addEventListener('contextmenu', this.boundHandleContextMenu);
		
		this.canvas.addEventListener('touchstart', this.boundHandleTouchStart, { passive: false });
		this.canvas.addEventListener('touchmove', this.boundHandleTouchMove, { passive: false });
		this.canvas.addEventListener('touchend', this.boundHandleTouchEnd);
		this.canvas.addEventListener('touchcancel', this.boundHandleTouchEnd);
	}

	/**
	 * 解绑 Canvas 事件（onClose 中调用）
	 */
	private unbindEvents(): void {
		if (!this.canvas) return;
		if (this.boundHandleMouseDown) this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
		if (this.boundHandleMouseMove) this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
		if (this.boundHandleMouseUp) this.canvas.removeEventListener('mouseup', this.boundHandleMouseUp);
		if (this.boundHandleWheel) this.canvas.removeEventListener('wheel', this.boundHandleWheel);
		if (this.boundHandleContextMenu) this.canvas.removeEventListener('contextmenu', this.boundHandleContextMenu);
		
		if (this.boundHandleTouchStart) this.canvas.removeEventListener('touchstart', this.boundHandleTouchStart);
		if (this.boundHandleTouchMove) this.canvas.removeEventListener('touchmove', this.boundHandleTouchMove);
		if (this.boundHandleTouchEnd) {
			this.canvas.removeEventListener('touchend', this.boundHandleTouchEnd);
			this.canvas.removeEventListener('touchcancel', this.boundHandleTouchEnd);
		}
	}

	/**
	 * 鼠标按下事件
	 */
	private handleMouseDown(e: MouseEvent): void {
		const pos = this.screenToGraph(e.offsetX, e.offsetY);
		const node = this.findNodeAt(pos.x, pos.y);

		if (e.button === 2 || e.button === 1) {
			// 右键或中键：开始平移画布
			this.isPanning = true;
			this.panStartX = e.offsetX - this.panX;
			this.panStartY = e.offsetY - this.panY;
			return;
		}

		if (e.button === 0) {
			// 左键
			const now = Date.now();
			const isDoubleClick = (now - this.lastClickTime) < DOUBLE_CLICK_THRESHOLD;

			if (node) {
				if (isDoubleClick && this.lastClickedNode?.id === node.id) {
					// 双击节点：打开角色设定文档
					const entry = this.plugin.characterManager.getCharacterFile(this.bookPath, node.id);
					if (entry) {
						// 寻找一个不是当前图谱视图的 markdown 窗口，优先找已经打开该文件的，其次找任意一个，都没有则分屏
						let targetLeaf = this.app.workspace.getLeavesOfType('markdown').find(l => 
							l !== this.leaf && (l.view instanceof MarkdownView) && l.view.file?.path === entry.file.path
						);
						if (!targetLeaf) targetLeaf = this.app.workspace.getLeavesOfType('markdown').find(l => l !== this.leaf);
						if (!targetLeaf) targetLeaf = this.app.workspace.getLeaf('split', 'vertical');

						void (async () => {
							const cache = this.app.metadataCache.getFileCache(entry.file);
							let targetLine = 0;
							if (cache?.headings) {
								const headingInfo = cache.headings.find(h => h.heading === entry.heading);
								if (headingInfo) targetLine = headingInfo.position.start.line;
							}
							await targetLeaf.openFile(entry.file, { eState: { line: targetLine } });
						})();
					} else {
						new Notice(`未找到角色 ${node.id} 的设定文件`);
					}
					this.lastClickTime = 0;
					return;
				}

				// 单击节点：开始拖拽
				this.draggedNode = node;
				
				// 同步更新力导向引擎中的 pinned 状态
				if (this.engine) {
					const layoutNode = this.engine.nodes.find(n => n.id === node.id);
					if (layoutNode) layoutNode.pinned = true;
				}
				node.pinned = true;
				this.selectedNode = node;
				// 注意：这里不再调用 reset()，防止整个图谱炸开
			} else {
				// 单击空白区域：取消选中
				this.selectedNode = null;
				// 同时也开始平移
				this.isPanning = true;
				this.panStartX = e.offsetX - this.panX;
				this.panStartY = e.offsetY - this.panY;
			}

			this.lastClickTime = now;
			this.lastClickedNode = node;
			this.render();
		}
	}

	/**
	 * 鼠标移动事件
	 */
	private handleMouseMove(e: MouseEvent): void {
		if (this.isPanning) {
			this.panX = e.offsetX - this.panStartX;
			this.panY = e.offsetY - this.panStartY;
			this.render();
			return;
		}

		if (this.draggedNode) {
			// 查找该节点在引擎中的对应实例，直接更新其绝对坐标
			const layoutNode = this.engine?.nodes.find(n => n.id === this.draggedNode!.id);
			const pos = this.screenToGraph(e.offsetX, e.offsetY);
			
			if (layoutNode) {
				layoutNode.fx = pos.x;
				layoutNode.fy = pos.y;
				layoutNode.x = pos.x;
				layoutNode.y = pos.y;
				
				// 轻微加热系统，使得被拖拽节点的邻居能够柔和地跟进
				if (this.engine) {
					if (this.engine.isConverged) {
						this.engine.reheat();
						this.startAnimationLoop();
					} else {
						this.engine.reheat(); // 保持一定的温度让系统有足够的力响应拖拽
					}
				}
			}
			
			// 立即同步回视图数据
			this.draggedNode.x = pos.x;
			this.draggedNode.y = pos.y;

			this.render();
			return;
		}

		// 悬停检测
		const pos = this.screenToGraph(e.offsetX, e.offsetY);
		const node = this.findNodeAt(pos.x, pos.y);
		const prevHovered = this.hoveredNode;
		this.hoveredNode = node;

		// 更新鼠标样式
		if (this.canvas) {
			this.canvas.setCssStyles({ cursor: node ? 'pointer' : 'default' });
		}

		if (prevHovered !== this.hoveredNode) {
			this.render();
		}
	}

	/**
	 * 鼠标抬起事件
	 */
	private handleMouseUp(_e: MouseEvent): void {
		this.isPanning = false;

		if (this.draggedNode) {
			// 拖拽结束：保留节点的 pinned 状态和 fx/fy，使其永久固定在用户拖拽的位置
			// 这样下次 tick 依然会维持 fx 和 fy
			this.draggedNode = null;
		}
	}

	/**
	 * 滚轮事件：缩放画布
	 */
	private handleWheel(e: WheelEvent): void {
		e.preventDefault();
		const delta = -e.deltaY * ZOOM_FACTOR;
		const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta * this.scale));
		this.scale = newScale;
		this.render();
	}

	private handleTouchStart(e: TouchEvent): void {
		if (e.touches.length === 2) {
			e.preventDefault();
			this.isPanning = false;
			this.draggedNode = null;
			const touch1 = e.touches[0];
			const touch2 = e.touches[1];
			this.initialPinchDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
			this.initialPinchScale = this.scale;
			
			const rect = this.canvas!.getBoundingClientRect();
			this.initialPinchCenter = {
				x: ((touch1.clientX + touch2.clientX) / 2) - rect.left,
				y: ((touch1.clientY + touch2.clientY) / 2) - rect.top
			};
		} else if (e.touches.length === 1) {
			e.preventDefault();
			const touch = e.touches[0];
			const rect = this.canvas!.getBoundingClientRect();
			const offsetX = touch.clientX - rect.left;
			const offsetY = touch.clientY - rect.top;

			const pos = this.screenToGraph(offsetX, offsetY);
			const node = this.findNodeAt(pos.x, pos.y);

			const now = Date.now();
			const isDoubleClick = (now - this.lastClickTime) < DOUBLE_CLICK_THRESHOLD;

			if (node) {
				if (isDoubleClick && this.lastClickedNode?.id === node.id) {
					// Double tap: Open character file
					const entry = this.plugin.characterManager.getCharacterFile(this.bookPath, node.id);
					if (entry) {
						let targetLeaf = this.app.workspace.getLeavesOfType('markdown').find(l => 
							l !== this.leaf && (l.view instanceof MarkdownView) && l.view.file?.path === entry.file.path
						);
						if (!targetLeaf) targetLeaf = this.app.workspace.getLeavesOfType('markdown').find(l => l !== this.leaf);
						if (!targetLeaf) targetLeaf = this.app.workspace.getLeaf('split', 'vertical');

						void (async () => {
							const cache = this.app.metadataCache.getFileCache(entry.file);
							let targetLine = 0;
							if (cache?.headings) {
								const headingInfo = cache.headings.find(h => h.heading === entry.heading);
								if (headingInfo) targetLine = headingInfo.position.start.line;
							}
							await targetLeaf.openFile(entry.file, { eState: { line: targetLine } });
						})();
					} else {
						new Notice(`未找到角色 ${node.id} 的设定文件`);
					}
					this.lastClickTime = 0;
					return;
				}

				// Single tap: start drag
				this.draggedNode = node;
				if (this.engine) {
					const layoutNode = this.engine.nodes.find(n => n.id === node.id);
					if (layoutNode) layoutNode.pinned = true;
				}
				node.pinned = true;
				this.selectedNode = node;
				
				this.lastClickTime = now;
				this.lastClickedNode = node;
			} else {
				// Single tap on empty space: start pan
				this.selectedNode = null;
				this.isPanning = true;
				this.panStartX = offsetX - this.panX;
				this.panStartY = offsetY - this.panY;
				
				this.lastClickTime = 0;
			}
		}
	}

	private handleTouchMove(e: TouchEvent): void {
		if (e.touches.length === 2) {
			e.preventDefault();
			const touch1 = e.touches[0];
			const touch2 = e.touches[1];
			const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
			
			if (this.initialPinchDistance > 0 && this.initialPinchCenter) {
				const zoomFactor = currentDistance / this.initialPinchDistance;
				const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.initialPinchScale * zoomFactor));
				
				const center = this.initialPinchCenter;
				const graphX = (center.x - this.panX) / this.scale;
				const graphY = (center.y - this.panY) / this.scale;

				this.scale = newScale;
				this.panX = center.x - graphX * this.scale;
				this.panY = center.y - graphY * this.scale;
				this.render();
			}
		} else if (e.touches.length === 1) {
			e.preventDefault();
			const touch = e.touches[0];
			const rect = this.canvas!.getBoundingClientRect();
			const offsetX = touch.clientX - rect.left;
			const offsetY = touch.clientY - rect.top;

			if (this.isPanning) {
				this.panX = offsetX - this.panStartX;
				this.panY = offsetY - this.panStartY;
				this.render();
				return;
			}

			if (this.draggedNode) {
				const pos = this.screenToGraph(offsetX, offsetY);
				this.draggedNode.x = pos.x;
				this.draggedNode.y = pos.y;
				if (this.engine) {
					const layoutNode = this.engine.nodes.find(n => n.id === this.draggedNode!.id);
					if (layoutNode) {
						layoutNode.x = pos.x;
						layoutNode.y = pos.y;
					}
					this.engine.reheat(); // Reheat engine
				}
				this.render();
				return;
			}
		}
	}

	private handleTouchEnd(e: TouchEvent): void {
		if (e.touches.length < 2) {
			this.initialPinchDistance = 0;
			this.initialPinchCenter = null;
		}
		if (e.touches.length === 0) {
			this.isPanning = false;
			if (this.draggedNode) {
				if (this.engine) {
					const layoutNode = this.engine.nodes.find(n => n.id === this.draggedNode!.id);
					if (layoutNode) layoutNode.pinned = false;
				}
				this.draggedNode.pinned = false;
				this.draggedNode = null;
			}
		}
	}

	// ==========================================
	// 坐标变换
	// ==========================================

	/**
	 * 将屏幕坐标（鼠标位置）转换为图谱坐标
	 */
	private screenToGraph(screenX: number, screenY: number): { x: number; y: number } {
		if (!this.canvas) return { x: 0, y: 0 };
		const width = this.canvas.width / DPR;
		const height = this.canvas.height / DPR;
		const x = (screenX - width / 2 - this.panX) / this.scale + width / 2;
		const y = (screenY - height / 2 - this.panY) / this.scale + height / 2;
		return { x, y };
	}

	/**
	 * 在指定图谱坐标处查找节点
	 */
	private findNodeAt(gx: number, gy: number): GraphNode | null {
		// 倒序遍历，优先匹配上层（后绘制的）节点
		for (let i = this.graphData.nodes.length - 1; i >= 0; i--) {
			const node = this.graphData.nodes[i];
			const dx = gx - node.x;
			const dy = gy - node.y;
			if (dx * dx + dy * dy <= NODE_HIGHLIGHT_RADIUS * NODE_HIGHLIGHT_RADIUS) {
				return node;
			}
		}
		return null;
	}

	// ==========================================
	// 局部模式
	// ==========================================

	/**
	 * 进入局部模式：仅显示目标节点及其 1 跳邻居
	 */
	private enterLocalMode(focusNode: GraphNode): void {
		if (!this.fullGraphData) {
			// 首次进入：备份全量数据
			this.fullGraphData = {
				nodes: [...this.graphData.nodes],
				edges: [...this.graphData.edges],
			};
		}

		this.isLocalMode = true;
		this.localFocusNode = focusNode;

		// 筛选 1 跳邻居
		const neighborIds = new Set<string>();
		neighborIds.add(focusNode.id);

		for (const edge of this.fullGraphData.edges) {
			if (edge.source === focusNode.id) neighborIds.add(edge.target);
			if (edge.target === focusNode.id) neighborIds.add(edge.source);
		}

		// 筛选节点和边
		this.graphData = {
			nodes: this.fullGraphData.nodes.filter(n => neighborIds.has(n.id)),
			edges: this.fullGraphData.edges.filter(
				e => neighborIds.has(e.source) && neighborIds.has(e.target)
			),
		};

		const cx = this.canvas ? this.canvas.width / DPR / 2 : 150;
		const cy = this.canvas ? this.canvas.height / DPR / 2 : 150;

		// 将焦点节点固定在中心，周围节点随机分布，由 D3 自然散开成圆形
		for (const node of this.graphData.nodes) {
			if (node.id === focusNode.id) {
				node.x = cx;
				node.y = cy;
				node.pinned = true;
			} else {
				node.x = cx + (Math.random() - 0.5) * 20;
				node.y = cy + (Math.random() - 0.5) * 20;
				node.pinned = false;
			}
			node.vx = 0;
			node.vy = 0;
		}

		this.selectedNode = focusNode;
		this.buildEdgeOffsets();
		this.initEngine();
		this.updateBreadcrumb();
		this.updateHint();
		this.startAnimationLoop(true);
	}

	/**
	 * 退出局部模式：恢复全量图谱
	 */
	private exitLocalMode(): void {
		if (!this.fullGraphData) return;

		this.isLocalMode = false;
		this.localFocusNode = null;
		this.graphData = this.fullGraphData;
		this.fullGraphData = null;
		this.selectedNode = null;

		const cx = this.canvas ? this.canvas.width / DPR / 2 : 150;
		const cy = this.canvas ? this.canvas.height / DPR / 2 : 150;
		const radius = Math.min(cx, cy) * 0.8;

		// 退回全量图谱时，也按照大圆环排布，帮助物理引擎理顺交叉
		this.graphData.nodes.forEach((node, i) => {
			const angle = (i / this.graphData.nodes.length) * Math.PI * 2;
			node.x = cx + radius * Math.cos(angle);
			node.y = cy + radius * Math.sin(angle);
			node.vx = 0;
			node.vy = 0;
			node.pinned = false;
		});

		this.buildEdgeOffsets();
		this.initEngine();
		this.updateBreadcrumb();
		this.updateHint();
		this.startAnimationLoop(true);
	}

	// ==========================================
	// UI 辅助
	// ==========================================

	/**
	 * 更新面包屑导航
	 */
	private updateBreadcrumb(): void {
		if (!this.breadcrumbEl) return;

		// 清空内容
		while (this.breadcrumbEl.firstChild) {
			this.breadcrumbEl.removeChild(this.breadcrumbEl.firstChild);
		}

		if (this.isLocalMode && this.localFocusNode) {
			this.breadcrumbEl.setCssStyles({ display: 'flex' });

			// "全量图谱" 链接
			const allLink = this.breadcrumbEl.createSpan({
				cls: 'wna-relation-graph-breadcrumb-link',
				text: t('relation-graph.breadcrumb-all'),
			});
			allLink.addEventListener('click', () => this.exitLocalMode());

			// 分隔符
			this.breadcrumbEl.createSpan({ text: ' > ' });

			// 当前焦点
			this.breadcrumbEl.createSpan({
				text: t('relation-graph.breadcrumb-local', { name: this.localFocusNode.id }),
			});
		} else {
			this.breadcrumbEl.setCssStyles({ display: 'none' });
		}
	}

	/**
	 * 更新操作提示文字
	 */
	private updateHint(): void {
		if (!this.hintEl) return;
		this.hintEl.textContent = t('relation-graph.hint-double-click-node');
	}

	/**
	 * 更新 Canvas 尺寸（跟随容器大小）
	 */
	private updateCanvasSize(): void {
		if (!this.canvas || !this.container) return;

		const rect = this.container.getBoundingClientRect();
		const width = Math.max(rect.width, 100);
		const height = Math.max(rect.height, 100);

		this.canvas.width = width * DPR;
		this.canvas.height = height * DPR;
	}

	/**
	 * 计算所有边的绘制偏移量
	 * 
	 * 当两个节点之间存在多条边时（不论方向），将其展开绘制为多条弧线，避免重叠。
	 */
	private buildEdgeOffsets(): void {
		this.edgeOffsetMap.clear();
		this.edgeDrawModeMap.clear();
		this.combinedLabelMap.clear();

		const pairMap = new Map<string, GraphEdge[]>();
		for (const edge of this.graphData.edges) {
			const id1 = edge.source < edge.target ? edge.source : edge.target;
			const id2 = edge.source < edge.target ? edge.target : edge.source;
			const key = `${id1}↔${id2}`;
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
					this.edgeDrawModeMap.set(primary, 'bidirectional');
				}
				
				const uniqueLabels = Array.from(new Set(group.map(e => e.label))).filter(Boolean);
				if (uniqueLabels.length > 0) {
					this.combinedLabelMap.set(primary, uniqueLabels.join('|'));
				}
				
				for (const e of group) {
					if (e !== primary) this.edgeDrawModeMap.set(e, 'hide');
				}
				
				visualLines.push(primary);
			};

			addVisualLine(bidiEdges, 'bidirectional');
			addVisualLine(fwdEdges, 'normal');
			addVisualLine(bwdEdges, 'normal');

			if (visualLines.length === 1) {
				this.edgeOffsetMap.set(visualLines[0], 0);
			} else {
				const step = CURVE_OFFSET * 2;
				const baseOffset = -((visualLines.length - 1) * step) / 2;
				
				visualLines.forEach((edge, index) => {
					let offset = baseOffset + index * step;
					if (edge.source > edge.target) {
						offset = -offset;
					}
					this.edgeOffsetMap.set(edge, offset);
				});
			}
		}
	}

	/**
	 * 将颜色字符串调整透明度
	 * 简单实现：如果是 hex 格式，转为 rgba
	 */
	private adjustAlpha(color: string, alpha: number): string {
		// 尝试匹配 hex 颜色
		const hexMatch = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
		if (hexMatch) {
			const r = parseInt(hexMatch[1], 16);
			const g = parseInt(hexMatch[2], 16);
			const b = parseInt(hexMatch[3], 16);
			return `rgba(${r}, ${g}, ${b}, ${alpha})`;
		}
		// 如果不是 hex，原样返回
		return color;
	}
}

// ==========================================
// 辅助类型
// ==========================================

/** Obsidian 主题颜色集合 */
interface ThemeColors {
	/** 强调色（节点填充） */
	accent: string;
	textNormal: string;
	textMuted: string;
	textFaint: string;
	bgPrimary: string;
	/** 官方图谱节点色 */
	graphNode: string;
	/** 官方图谱连线色 */
	graphLine: string;
	/** 官方图谱文字色 */
	graphText: string;
	/** 官方图谱焦点节点色 */
	graphNodeFocused: string;

	// --- 设定图谱专属 CSS 变量 ---
	/** 主角叠加颜色 (默认) */
	protagonistOverlay: string;
	/** 主角叠加颜色 (悬浮/高亮) */
	protagonistOverlayHover: string;
	/** 主角高亮阴影色 */
	protagonistShadow: string;
	mentionLineDash: number[];
	mentionLabelDash: number[];
	mentionLineColor: string;
	mentionTextColor: string;
	mentionBorderColor: string;
	/** 节点类型动态配色池 */
	typePalette: string[];
}
