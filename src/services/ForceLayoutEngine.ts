import * as d3 from 'd3-force';

/** 力导向布局中的节点坐标与速度状态 */
export interface LayoutNode extends d3.SimulationNodeDatum {
	/** 节点唯一标识 */
	id: string;
	/** Canvas 坐标 x */
	x: number;
	/** Canvas 坐标 y */
	y: number;
	/** 速度分量 x */
	vx: number;
	/** 速度分量 y */
	vy: number;
	/** 强制固定 X */
	fx?: number | null;
	/** 强制固定 Y */
	fy?: number | null;
	/** 是否被用户拖拽固定（固定后不参与力计算） */
	pinned: boolean;
	/** 是否为主角 */
	isProtagonist?: boolean;
	/** 节点角色类型 */
	nodeType?: string;
}

/** 力导向布局中的边 */
export interface LayoutEdge extends d3.SimulationLinkDatum<LayoutNode> {
	source: LayoutNode | string;
	target: LayoutNode | string;
}

/**
 * 力导向布局引擎 (包装 d3-force)
 * 
 * 放弃了手写的简易力导向算法，全面拥抱业界标准的 d3-force。
 * 提供更平滑、更有机的节点收敛手感（支持 ManyBody, Link, Center, Collide 多重受力）。
 */
export class ForceLayoutEngine {
	public readonly nodes: LayoutNode[];
	public readonly edges: LayoutEdge[];
	private simulation: d3.Simulation<LayoutNode, LayoutEdge>;

	private static readonly ISOLATED_NODE_GRAVITY = 0.08;

	constructor(nodes: LayoutNode[], edges: LayoutEdge[], width: number, height: number) {
		this.nodes = nodes;
		// 复制 edges 因为 d3 会直接把 string source/target 修改为对象引用
		this.edges = edges.map(e => ({ ...e }));

		// 同步初始状态
		this.nodes.forEach(n => {
			if (n.pinned) {
				n.fx = n.x;
				n.fy = n.y;
			} else {
				n.fx = null;
				n.fy = null;
			}
		});

		const degreeMap = this.calculateDegreeMap(this.edges);

		// 构建 D3 物理引擎
		this.simulation = d3.forceSimulation<LayoutNode>(this.nodes)
			// 弹簧力：连线拉扯（保持极短的距离，使图谱紧凑）
			.force('link', d3.forceLink<LayoutNode, LayoutEdge>(this.edges)
				.id(d => d.id)
				.distance(80) // 固定短距离，防止线条过长
				.strength(0.5) // 拉扯刚度
			)
			// 万有斥力：节点互相排斥
			.force('charge', d3.forceManyBody()
				.strength(-400) // 适中的斥力
				.distanceMax(400) // 最大排斥距离
			)
			// 聚拢引力：防止孤立节点散落太远，同时维持主角的中心地位
			.force('gravityX', d3.forceX<LayoutNode>(width / 2).strength((d: LayoutNode) => {
				if (d.isProtagonist) return 0.2;
				if ((degreeMap.get(d.id) || 0) === 0) return ForceLayoutEngine.ISOLATED_NODE_GRAVITY; // 孤立节点施加向心力
				return 0.02; // 其他节点微弱向心力
			}))
			.force('gravityY', d3.forceY<LayoutNode>(height / 2).strength((d: LayoutNode) => {
				if (d.isProtagonist) return 0.2;
				if ((degreeMap.get(d.id) || 0) === 0) return ForceLayoutEngine.ISOLATED_NODE_GRAVITY;
				return 0.02;
			}))
			// 中心引力：防止整体飘走
			.force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
			// 碰撞检测：增加到 40，保证孤立节点聚拢时也不会重叠
			.force('collide', d3.forceCollide().radius(40).strength(0.8))
			// 速度衰减（阻尼）：0.6 接近原生 Obsidian 图谱的“Q弹”感
			.alphaMin(0.001);
	}

	/**
	 * 计算每条边带来的节点度数
	 */
	private calculateDegreeMap(edges: LayoutEdge[]): Map<string, number> {
		const degreeMap = new Map<string, number>();
		edges.forEach(e => {
			const sourceId = typeof e.source === 'string' ? e.source : e.source.id;
			const targetId = typeof e.target === 'string' ? e.target : e.target.id;
			degreeMap.set(sourceId, (degreeMap.get(sourceId) || 0) + 1);
			degreeMap.set(targetId, (degreeMap.get(targetId) || 0) + 1);
		});
		return degreeMap;
	}

	/**
	 * 在动画循环中推进一帧物理计算
	 * @returns 返回 true 表示仍在运动，false 表示已收敛
	 */
	public tick(): boolean {
		if (this.isConverged) return false;

		// 每次 tick 前同步 pinned 状态
		this.nodes.forEach(n => {
			if (n.pinned) {
				n.fx = n.x;
				n.fy = n.y;
			} else {
				n.fx = null;
				n.fy = null;
			}
		});

		this.simulation.tick();
		return true;
	}

	/**
	 * 当前是否已完全收敛
	 */
	public get isConverged(): boolean {
		return this.simulation.alpha() <= this.simulation.alphaMin();
	}

	/**
	 * 重置模拟状态，赋予高能量（全局爆炸效果）
	 */
	public reset(): void {
		this.simulation.alpha(1).restart();
	}

	/**
	 * 轻微“加热”系统，赋予低能量
	 * 用于：用户拖拽某节点时引发周围的局部微调
	 */
	public reheat(): void {
		// alpha(0.3) 相当于赋予了 30% 的热量，可以产生跟随位移，又不会导致全屏乱飞
		this.simulation.alpha(0.3).restart();
	}

	/**
	 * 容器改变大小时，调整中心力坐标
	 */
	public resize(width: number, height: number): void {
		const centerForce = this.simulation.force('center') as d3.ForceCenter<LayoutNode>;
		if (centerForce) {
			centerForce.x(width / 2).y(height / 2);
		}
		
		const progX = this.simulation.force('protagonistX') as d3.ForceX<LayoutNode>;
		if (progX) progX.x(width / 2);
		
		const progY = this.simulation.force('protagonistY') as d3.ForceY<LayoutNode>;
		if (progY) progY.y(height / 2);
	}

	/**
	 * 热更新数据，用于静默刷新（保持原有节点物理坐标）
	 */
	public updateData(nodes: LayoutNode[], edges: LayoutEdge[]): void {
		// 清空并重新推入数据以保持对内部数组的引用
		this.nodes.length = 0;
		this.nodes.push(...nodes);
		this.edges.length = 0;
		this.edges.push(...edges.map(e => ({ ...e })));

		// 通知 D3 引擎数据已变化
		this.simulation.nodes(this.nodes);
		const linkForce = this.simulation.force<d3.ForceLink<LayoutNode, LayoutEdge>>('link');
		if (linkForce) {
			linkForce.links(this.edges);
		}
	}

	/** 获取当前系统的能量（alpha） */
	public get alpha(): number {
		return this.simulation.alpha();
	}
}
