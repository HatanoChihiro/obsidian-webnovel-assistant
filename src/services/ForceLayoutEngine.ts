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

		// 构建 D3 物理引擎
		this.simulation = d3.forceSimulation<LayoutNode>(this.nodes)
			// 弹簧力：连线拉扯
			.force('link', d3.forceLink<LayoutNode, LayoutEdge>(this.edges)
				.id(d => d.id)
				.distance(120) // 基础连线长度
				.strength(0.5) // 拉扯刚度
			)
			// 万有斥力：节点互相排斥
			.force('charge', d3.forceManyBody()
				.strength(-400) // 斥力大小
				.distanceMax(600) // 超过此距离不再排斥，优化性能
			)
			// 主角引力：如果是主角，施加向画布中心的引力，使其成为视觉中心
			.force('protagonistX', d3.forceX(width / 2).strength((d: LayoutNode) => d.isProtagonist ? 0.2 : 0))
			.force('protagonistY', d3.forceY(height / 2).strength((d: LayoutNode) => d.isProtagonist ? 0.2 : 0))
			// 中心引力：防止整体飘走（d3.forceCenter 会平移所有节点使质心居中）
			.force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
			// 碰撞检测：防止节点互相重叠
			.force('collide', d3.forceCollide().radius(25).strength(0.8))
			// 速度衰减（阻尼）：控制滑动的手感，0.6 接近原生 Obsidian 图谱的“Q弹”感
			.velocityDecay(0.6)
			.alphaMin(0.001)
			// 关闭自动循环，接管到我们自己的 requestAnimationFrame 中
			.stop();
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
		this.simulation.stop();
	}

	/**
	 * 轻微“加热”系统，赋予低能量
	 * 用于：用户拖拽某节点时引发周围的局部微调
	 */
	public reheat(): void {
		// alpha(0.3) 相当于赋予了 30% 的热量，可以产生跟随位移，又不会导致全屏乱飞
		this.simulation.alpha(0.3).restart();
		this.simulation.stop();
	}

	/**
	 * 容器改变大小时，调整中心力坐标
	 */
	public resize(width: number, height: number): void {
		const centerForce = this.simulation.force('center') as d3.ForceCenter<LayoutNode>;
		if (centerForce) {
			centerForce.x(width / 2).y(height / 2);
		}
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
}
