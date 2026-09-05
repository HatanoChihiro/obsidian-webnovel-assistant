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
import { GraphInteractionController } from './components/GraphInteractionController';
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

/** 缩放步进系数 */
const ZOOM_FACTOR = 0.001;

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

	// --- 交互控制器与渲染状态 ---
	private controller: GraphInteractionController | null = null;
	private renderState: GraphRenderState = {
		scale: 1.0,
		panX: 0,
		panY: 0,
		selectedNode: null,
		hoveredNode: null,
		isLocalMode: false,
		localFocusNode: null,
		edgeOffsetMap: new Map(),
		edgeDrawModeMap: new Map(),
		combinedLabelMap: new Map(),
		graphData: { nodes: [], edges: [] },
		animTime: 0
	};

	/** 全量图谱数据的备份（进入局部模式时保存） */
	private fullGraphData: GraphData | null = null;

	// --- DOM 元素 ---
	private breadcrumbEl: HTMLElement | null = null;
	private hintEl: HTMLElement | null = null;

	// --- 动画控制 ---
	private animationFrameId: number = 0;
	private currentAnimationToken: number = 0;
	private resizeObserver: ResizeObserver | null = null;
	private isClosed: boolean = false;
	private boundVisibilityChange: (() => void) | null = null;

	private isGraphHidden(): boolean {
		if (this.isClosed || !this.container || !this.container.isConnected) return true;
		const doc = this.container.ownerDocument;
		if (doc && doc.visibilityState === 'hidden') return true;
		const rect = this.container.getBoundingClientRect();
		return rect.width === 0 || rect.height === 0;
	}
	
	private needsRender: boolean = true;
	private requestRender() {
		this.needsRender = true;
		if (!this.animationFrameId && this.engine && !this.isGraphHidden()) {
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
		this.isClosed = false;
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

		// 绑定交互控制器
		this.controller = new GraphInteractionController(
			this.canvas,
			this.renderState,
			{
				requestRender: () => this.requestRender(),
				onNodeDoubleClick: (node) => {
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
				},
				onBackgroundDoubleClick: () => {
					if (this.renderState.isLocalMode) {
						this.exitLocalMode();
					}
				},
				onNodeHover: () => {},
				onNodeDragStart: (node) => {
					if (this.engine) {
						const layoutNode = this.engine.nodes.find(n => n.id === node.id);
						if (layoutNode) layoutNode.pinned = true;
					}
					node.pinned = true;
					this.renderState.selectedNode = node;
				},
				onNodeDrag: (node, x, y) => {
					const layoutNode = this.engine?.nodes.find(n => n.id === node.id);
					if (layoutNode) {
						layoutNode.fx = x;
						layoutNode.fy = y;
						layoutNode.x = x;
						layoutNode.y = y;
						if (this.engine) {
							this.engine.reheat();
						}
					}
					node.x = x;
					node.y = y;
					this.requestRender();
				},
				onNodeDragEnd: () => {
					// 拖拽结束：保留节点的 pinned 状态和 fx/fy，使其永久固定在用户拖拽的位置
				}
			},
			{
				zoomSensitivity: ZOOM_FACTOR
			}
		);
		this.controller.updateLayout(this.graphData);
		this.controller.bindEvents();

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
			this.controller?.updateLayout(this.graphData);
			this.requestRender();
		});
		this.resizeObserver.observe(this.container);

		// 监听容器所属文档的可见性变化（窗口最小化或后台时暂停动画）
		const onVisibilityChange = () => {
			if (this.isGraphHidden()) {
				if (this.animationFrameId) {
					const win = this.container?.ownerDocument?.defaultView ?? window;
					win.cancelAnimationFrame(this.animationFrameId);
					this.animationFrameId = 0;
				}
			} else if (this.engine && !this.animationFrameId) {
				this.requestRender();
			}
		};
		const doc = this.container.ownerDocument;
		this.boundVisibilityChange = onVisibilityChange;
		doc?.addEventListener('visibilitychange', this.boundVisibilityChange);

		// 监听 Obsidian 布局与活动 Leaf 切换，标签页恢复时唤醒
		this.registerEvent(this.app.workspace.on('layout-change', onVisibilityChange));
		this.registerEvent(this.app.workspace.on('active-leaf-change', onVisibilityChange));

		// 每次打开视图时清空颜色缓存，以便响应主题切换
		this.cachedColors = null;

		// 如果有保存的状态，自动加载
		if (this.filePath) {
			await this.loadGraphForFile(this.filePath);
		}
		if (this.isClosed) return;

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
		this.isClosed = true;

		// 停止动画循环
		if (this.animationFrameId) {
			const win = this.container?.ownerDocument?.defaultView ?? window;
			win.cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = 0;
		}

		// 清理文档可见性监听
		if (this.boundVisibilityChange && this.container?.ownerDocument) {
			this.container.ownerDocument.removeEventListener('visibilitychange', this.boundVisibilityChange);
			this.boundVisibilityChange = null;
		}

		// 清理 ResizeObserver
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		// 销毁并清理物理引擎
		if (this.engine) {
			this.engine.destroy();
			this.engine = null;
		}

		// 清理交互控制器
		if (this.controller) {
			this.controller.unbindEvents();
			this.controller = null;
		}

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
		if (this.isClosed || !this.canvas || !this.container) return;

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			this.showEmptyState();
			return;
		}

		this.bookPath = this.plugin.characterManager.getBookPathForFile(file) || '';

		const manager = this.plugin.relationGraphManager;
		const data = await manager.buildGraphData(file);
		if (this.isClosed || !this.canvas || !this.container) return;

		if (data.nodes.length === 0) {
			this.showEmptyState();
			return;
		}

		this.graphData = data;
		this.fullGraphData = null;
		this.renderState.isLocalMode = false;
		this.renderState.selectedNode = null;
		this.renderState.localFocusNode = null;
		this.controller?.updateLayout(this.graphData);

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
		if (this.isClosed || !this.filePath) return;
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) return;

		const manager = this.plugin.relationGraphManager;
		const newData = await manager.buildGraphData(file);
		if (this.isClosed || !this.canvas || !this.container) return;

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
		this.controller?.updateLayout(this.graphData);
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
		if (this.engine) {
			this.engine.destroy();
			this.engine = null;
		}

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
			this.renderState.panX = 0;
			this.renderState.panY = 0;
			this.renderState.scale = 1;
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

		this.renderState.scale = targetScale;

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		this.renderState.panX = (canvasWidth / 2 - centerX) * this.renderState.scale;
		this.renderState.panY = (canvasHeight / 2 - centerY) * this.renderState.scale;
	}

	/**
	 * 启动 requestAnimationFrame 动画循环
	 * @param isFirstLoad 是否为初次加载（进入局部/全量图谱时），是则静默计算完全收敛并居中
	 */
	private startAnimationLoop(isFirstLoad: boolean = false): void {
		const win = this.container?.ownerDocument?.defaultView ?? window;

		// 先取消已有的循环
		if (this.animationFrameId) {
			win.cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = 0;
		}

		if (this.isGraphHidden()) {
			return;
		}

		// 生成唯一 token，保证同一时间只有一个循环执行渲染
		const token = ++this.currentAnimationToken;

		// 初次加载时：恢复 D3 绝美的物理展开动画！不再强行静默计算。
		// 只需要确保初始镜头是对准画布中心的即可。
		if (isFirstLoad) {
			this.renderState.panX = 0;
			this.renderState.panY = 0;
			
			// 根据节点数量智能判断初始缩放倍率，防止小图谱在默认 1.0 缩放时显得极小
			const nodeCount = this.graphData.nodes.length;
			if (nodeCount <= 6) {
				this.renderState.scale = 2.2;
			} else if (nodeCount <= 12) {
				this.renderState.scale = 1.6;
			} else if (nodeCount <= 25) {
				this.renderState.scale = 1.2;
			} else {
				this.renderState.scale = 1.0;
			}
		}

		const loop = () => {
			if (this.currentAnimationToken !== token) return;
			if (this.isGraphHidden() || !this.engine || !this.canvas) {
				this.animationFrameId = 0;
				return;
			}

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
			const hasActiveFocus = Boolean(this.renderState.hoveredNode || this.renderState.selectedNode);
			if (physicsRunning || this.needsRender || hasActiveFocus) {
				this.render();
				this.needsRender = false;
			}

			// 只要物理还在运动，或者存在聚焦高亮（有悬停/选中节点产生流光脉动），就继续下一帧；如果没有运动了，就挂起等待事件唤醒
			if (physicsRunning || hasActiveFocus) {
				this.animationFrameId = win.requestAnimationFrame(loop);
			} else {
				this.animationFrameId = 0;
			}
		};

		this.animationFrameId = win.requestAnimationFrame(loop);
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

		const graphDataForRender: GraphData = (layout as unknown as GraphData) || this.graphData;

		this.renderState.graphData = graphDataForRender;
		this.renderState.animTime = performance.now();

		GraphRenderer.render(ctx, width, height, graphDataForRender, this.renderState, colors);
	}

	private cachedColors: ThemeColors | null = null;
	private cachedThemeMode: boolean | null = null;

	/**
	 * 从 Obsidian 的 CSS 变量中读取主题颜色
	 * 添加缓存避免每帧调用 getComputedStyle 导致严重的性能卡顿，并在明暗模式切换时自动更新
	 */
	private getThemeColors(): ThemeColors {
		const doc = this.containerEl.ownerDocument;
		const isDark = doc?.body ? doc.body.classList.contains('theme-dark') : true;

		if (this.cachedColors && this.cachedThemeMode === isDark) {
			return this.cachedColors;
		}

		this.cachedThemeMode = isDark;
		const targetEl = this.container || this.containerEl || doc?.body || null;
		this.cachedColors = GraphRenderer.getThemeColors(targetEl);
		return this.cachedColors;
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

		this.renderState.isLocalMode = true;
		this.renderState.localFocusNode = focusNode;

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

		this.renderState.selectedNode = focusNode;
		this.controller?.updateLayout(this.graphData);
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

		this.renderState.isLocalMode = false;
		this.renderState.localFocusNode = null;
		this.graphData = this.fullGraphData;
		this.fullGraphData = null;
		this.renderState.selectedNode = null;
		this.controller?.updateLayout(this.graphData);

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

		if (this.renderState.isLocalMode && this.renderState.localFocusNode) {
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
				text: t('relation-graph.breadcrumb-local', { name: this.renderState.localFocusNode.id }),
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
		GraphRenderer.buildEdgeOffsets(this.graphData, this.renderState, colors.curveOffset, force);
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
