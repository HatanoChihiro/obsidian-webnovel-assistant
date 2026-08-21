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

import { ItemView, Notice, TFile } from 'obsidian';
declare class ResizeObserver { constructor(callback: (...args: unknown[]) => void); observe(target: Element): void; disconnect(): void; }
import type { WorkspaceLeaf } from 'obsidian';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { CharacterManager } from '../services/CharacterManager';
import type { RelationGraphManager, GraphNode, GraphData, GraphEdge } from '../services/RelationGraphManager';
import { ForceLayoutEngine, type LayoutNode, type LayoutEdge } from '../services/ForceLayoutEngine';
import { GraphRenderer, type GraphRenderState, type ThemeColors } from './components/GraphRenderer';
import { cleanLoreHeading } from '../services/CharacterManager';
import { t } from '../i18n';
import { smartLocateAndHighlight } from '../utils/leaf';


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

export type RelationGraphCharacterManager = Pick<
	CharacterManager,
	'ensureInitialized' | 'getBookPathForFile' | 'getCharacterFile'
>;

export type RelationGraphAdaptiveDebounceManager = Pick<
	AdaptiveDebounceManager,
	'debounceFixed'
>;

export type RelationGraphManagerCapability = Pick<
	RelationGraphManager,
	'buildGraphData'
>;

export interface RelationGraphViewPlugin {
	characterManager: RelationGraphCharacterManager;
	adaptiveDebounceManager: RelationGraphAdaptiveDebounceManager;
	relationGraphManager: RelationGraphManagerCapability;
}

// ==========================================
// 视图实现
// ==========================================

export class RelationGraphView extends ItemView {
	private plugin: RelationGraphViewPlugin;

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
	
	private needsRender: boolean = true;
	private requestRender() {
		this.needsRender = true;
		if (!this.animationFrameId && this.engine) {
			this.startAnimationLoop(false);
		}
	}

	constructor(leaf: WorkspaceLeaf, plugin: RelationGraphViewPlugin) {
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
		this.breadcrumbEl.hidden = true;

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
			this.requestRender();
		});
		this.resizeObserver.observe(this.container);

		// 每次打开视图时清空颜色缓存，以便响应主题切换
		this.cachedColors = null;

		// 如果有保存的状态，自动加载
		if (this.filePath) {
			await this.loadGraphForFile(this.filePath);
		}

		// 监听 CSS 主题切换以刷新主题颜色缓存
		this.registerEvent(this.app.workspace.on('css-change', () => {
			this.cachedColors = null;
			this.cachedThemeMode = null;
			this.buildEdgeOffsets(true);
			this.requestRender();
		}));

		// 监听文档变更实现图谱实时静默刷新
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && this.filePath && this.bookPath === this.plugin.characterManager.getBookPathForFile(file)) {
				this.plugin.adaptiveDebounceManager.debounceFixed('relation-graph-reload', () => {
					void this.softReloadGraph();
					this.requestRender();
				}, 500);
			}
		}));

		// 监听设定缓存刷新事件以实时静默刷新图谱
		this.registerEvent(this.app.workspace.on('webnovel-workbench-lore-updated', () => {
			if (this.filePath) {
				void this.softReloadGraph()
					.then(() => this.requestRender())
					.catch(error => console.error('[RelationGraphView] Failed to refresh lore graph:', error));
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

		const manager = this.plugin.relationGraphManager;
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

		const manager = this.plugin.relationGraphManager;
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
			this.canvas.hidden = true;
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
			isProtagonist: n.isProtagonist,
			nodeType: n.nodeType,
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
			let physicsRunning = false;
			for (let i = 0; i < ticksPerFrame; i++) {
				const running = this.engine.tick();
				if (running) physicsRunning = true;
			}

			// 将引擎计算后的坐标同步回 GraphNode 用于渲染
			this.syncNodePositions();

			// 渲染
			const hasActiveFocus = Boolean(this.hoveredNode || this.selectedNode);
			if (physicsRunning || this.needsRender || hasActiveFocus) {
				this.render();
				this.needsRender = false;
			}

			// 只要物理还在运动，或者存在聚焦高亮（有悬停/选中节点产生流光脉动），就继续下一帧；如果没有运动了，就挂起等待事件唤醒
			if (physicsRunning || hasActiveFocus) {
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

		// 读取 Obsidian 主题颜色（使用缓存）
		const colors = this.getThemeColors();

		const graphDataForRender: GraphData = (layout as unknown as GraphData) || { nodes: this.graphData.nodes, edges: this.graphData.edges };

		const state: GraphRenderState = {
			scale: this.scale,
			panX: this.panX,
			panY: this.panY,
			selectedNode: this.selectedNode,
			hoveredNode: this.hoveredNode,
			isLocalMode: this.isLocalMode,
			localFocusNode: this.localFocusNode,
			edgeDrawModeMap: this.edgeDrawModeMap,
			edgeOffsetMap: this.edgeOffsetMap,
			combinedLabelMap: this.combinedLabelMap,
			graphData: graphDataForRender,
			animTime: performance.now()
		};

		GraphRenderer.render(ctx, width, height, graphDataForRender, state, colors);
	}

	private cachedColors: ThemeColors | null = null;
	private cachedThemeMode: boolean | null = null;

	/**
	 * 从 Obsidian 的 CSS 变量中读取主题颜色
	 * 添加缓存避免每帧调用 getComputedStyle 导致严重的性能卡顿，并在明暗模式切换时自动更新
	 */
	private getThemeColors(): ThemeColors {
		const doc = activeDocument || (typeof document !== 'undefined' ? document : null);
		const isDark = doc?.body ? doc.body.classList.contains('theme-dark') : true;

		if (this.cachedColors && this.cachedThemeMode === isDark) {
			return this.cachedColors;
		}

		this.cachedThemeMode = isDark;
		const targetEl = this.container || this.containerEl || doc?.body || null;
		this.cachedColors = GraphRenderer.getThemeColors(targetEl);
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
						const cache = this.app.metadataCache.getFileCache(entry.file);
						let fallbackLine: number | undefined;
						if (cache?.headings) {
							const headingInfo = cache.headings.find(h => cleanLoreHeading(h.heading) === cleanLoreHeading(entry.heading));
							if (headingInfo) fallbackLine = headingInfo.position.start.line;
						}
						void smartLocateAndHighlight(this.app, entry.file, [`## ${entry.heading}`, `# ${entry.heading}`, entry.heading, node.id], {
							sourceLeaf: this.leaf,
							splitIfNew: true,
							fallbackLine
						});
					} else {
						new Notice(t('relation.character-not-found', { id: node.id }));
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
			this.requestRender();
		}
	}

	/**
	 * 鼠标移动事件
	 */
	private handleMouseMove(e: MouseEvent): void {
		if (this.isPanning) {
			this.panX = e.offsetX - this.panStartX;
			this.panY = e.offsetY - this.panStartY;
			this.requestRender();
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

			this.requestRender();
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
			this.requestRender();
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
		const oldScale = this.scale;
		const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta * this.scale));
		
		if (this.canvas) {
			const rect = this.canvas.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;
			const width = rect.width;
			const height = rect.height;

			const dx = mouseX - width / 2;
			const dy = mouseY - height / 2;

			this.panX = dx - (dx - this.panX) * (newScale / oldScale);
			this.panY = dy - (dy - this.panY) * (newScale / oldScale);
		}

		this.scale = newScale;
		this.requestRender();
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
						const cache = this.app.metadataCache.getFileCache(entry.file);
						let fallbackLine: number | undefined;
						if (cache?.headings) {
							const headingInfo = cache.headings.find(h => cleanLoreHeading(h.heading) === cleanLoreHeading(entry.heading));
							if (headingInfo) fallbackLine = headingInfo.position.start.line;
						}
						void smartLocateAndHighlight(this.app, entry.file, [`## ${entry.heading}`, `# ${entry.heading}`, entry.heading, node.id], {
							sourceLeaf: this.leaf,
							splitIfNew: true,
							fallbackLine
						});
					} else {
						new Notice(t('relation.character-not-found', { id: node.id }));
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
				this.requestRender();
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
				this.requestRender();
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
				this.requestRender();
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
		const hitRadius = Math.max(6, GraphRenderer.NODE_HIGHLIGHT_RADIUS);
		const hitRadiusSq = hitRadius * hitRadius;
		for (let i = this.graphData.nodes.length - 1; i >= 0; i--) {
			const node = this.graphData.nodes[i];
			const dx = gx - node.x;
			const dy = gy - node.y;
			if (dx * dx + dy * dy <= hitRadiusSq) {
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
			this.breadcrumbEl.hidden = false;

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
			this.breadcrumbEl.hidden = true;
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
	private buildEdgeOffsets(force: boolean = false): void {
		if (!this.graphData) return;
		const colors = this.getThemeColors();
		GraphRenderer.buildEdgeOffsets(this.graphData, {
			edgeOffsetMap: this.edgeOffsetMap,
			edgeDrawModeMap: this.edgeDrawModeMap,
			combinedLabelMap: this.combinedLabelMap,
			graphData: this.graphData,
			panX: this.panX,
			panY: this.panY,
			scale: this.scale,
			selectedNode: this.selectedNode,
			hoveredNode: this.hoveredNode,
			isLocalMode: this.isLocalMode,
			localFocusNode: this.localFocusNode
		}, colors.curveOffset, force);
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
