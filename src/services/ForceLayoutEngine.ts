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

/** 力导向物理引擎配置参数 */
export const PHYSICS_CONFIG = {
	/** 连线拉扯固定短距离 */
	LINK_DISTANCE: 80,
	/** 连线拉扯刚度 */
	LINK_STRENGTH: 0.5,
	/** 节点互斥力强度 */
	CHARGE_STRENGTH: -400,
	/** 最大排斥距离 */
	CHARGE_DISTANCE_MAX: 400,
	/** 主角节点向心力强度 */
	PROTAGONIST_GRAVITY: 0.5,
	/** 孤立节点向心力强度 */
	ISOLATED_NODE_GRAVITY: 0.08,
	/** 普通节点微弱向心力强度 */
	OTHER_NODE_GRAVITY: 0.02,
	/** 整体中心引力强度 */
	CENTER_STRENGTH: 0.05,
	/** 碰撞检测半径 */
	COLLIDE_RADIUS: 40,
	/** 碰撞检测受力强度 */
	COLLIDE_STRENGTH: 0.8,
	/** 最小收敛 alpha 步长 */
	ALPHA_MIN: 0.001,
} as const;

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

	constructor(nodes: LayoutNode[], edges: LayoutEdge[], public width: number, public height: number) {
		this.nodes = nodes;
		// 复制 edges 因为 d3 会直接把 string source/target 修改为对象引用
		this.edges = edges.map(e => ({ ...e }));

		// 同步初始状态与主角中心锁定
		this.updateProtagonistPositions();

		const degreeMap = this.calculateDegreeMap(this.edges);

		// 构建 D3 物理引擎
		this.simulation = d3.forceSimulation<LayoutNode>(this.nodes)
			// 弹簧力：连线拉扯（保持极短的距离，使图谱紧凑）
			.force('link', d3.forceLink<LayoutNode, LayoutEdge>(this.edges)
				.id(d => d.id)
				.distance(PHYSICS_CONFIG.LINK_DISTANCE)
				.strength(PHYSICS_CONFIG.LINK_STRENGTH)
			)
			// 万有斥力：节点互相排斥
			.force('charge', d3.forceManyBody()
				.strength(PHYSICS_CONFIG.CHARGE_STRENGTH)
				.distanceMax(PHYSICS_CONFIG.CHARGE_DISTANCE_MAX)
			)
			// 聚拢引力：防止孤立节点散落太远，同时维持主角的中心地位
			.force('gravityX', d3.forceX<LayoutNode>(width / 2).strength((d: LayoutNode) => {
				const isProtagonist = d.isProtagonist || Boolean(d.nodeType && (d.nodeType.includes('主角') || d.nodeType.toLowerCase().includes('protagonist')));
				if (isProtagonist) return PHYSICS_CONFIG.PROTAGONIST_GRAVITY;
				if ((degreeMap.get(d.id) || 0) === 0) return PHYSICS_CONFIG.ISOLATED_NODE_GRAVITY; // 孤立节点施加向心力
				return PHYSICS_CONFIG.OTHER_NODE_GRAVITY; // 其他节点微弱向心力
			}))
			.force('gravityY', d3.forceY<LayoutNode>(height / 2).strength((d: LayoutNode) => {
				const isProtagonist = d.isProtagonist || Boolean(d.nodeType && (d.nodeType.includes('主角') || d.nodeType.toLowerCase().includes('protagonist')));
				if (isProtagonist) return PHYSICS_CONFIG.PROTAGONIST_GRAVITY;
				if ((degreeMap.get(d.id) || 0) === 0) return PHYSICS_CONFIG.ISOLATED_NODE_GRAVITY;
				return PHYSICS_CONFIG.OTHER_NODE_GRAVITY;
			}))
			// 中心引力：防止整体飘走
			.force('center', d3.forceCenter(width / 2, height / 2).strength(PHYSICS_CONFIG.CENTER_STRENGTH))
			// 碰撞检测：保证孤立节点聚拢时也不会重叠
			.force('collide', d3.forceCollide().radius(PHYSICS_CONFIG.COLLIDE_RADIUS).strength(PHYSICS_CONFIG.COLLIDE_STRENGTH))
			// 速度衰减（阻尼）
			.alphaMin(PHYSICS_CONFIG.ALPHA_MIN);

		// 停止 D3 默认自启的内部定时器，由外部 requestAnimationFrame 统一驱动 tick
		this.simulation.stop();
	}

	/**
	 * 保持主角节点锁定在画布中心位置（如用户手动固定 pinned 则尊重固定坐标）
	 */
	private updateProtagonistPositions(): void {
		const protagonists = this.nodes.filter(n =>
			n.isProtagonist || Boolean(n.nodeType && (n.nodeType.includes('主角') || n.nodeType.toLowerCase().includes('protagonist')))
		);

		const nonProtagonists = this.nodes.filter(n => !protagonists.includes(n));

		nonProtagonists.forEach(n => {
			if (n.pinned) {
				n.fx = n.x;
				n.fy = n.y;
			} else {
				n.fx = null;
				n.fy = null;
			}
		});

		if (protagonists.length === 1) {
			const p = protagonists[0];
			if (p.pinned) {
				p.fx = p.x;
				p.fy = p.y;
			} else {
				p.fx = this.width / 2;
				p.fy = this.height / 2;
			}
		} else if (protagonists.length > 1) {
			protagonists.forEach((p, idx) => {
				if (p.pinned) {
					p.fx = p.x;
					p.fy = p.y;
				} else {
					const angle = (idx / protagonists.length) * Math.PI * 2;
					const radius = 50;
					p.fx = this.width / 2 + Math.cos(angle) * radius;
					p.fy = this.height / 2 + Math.sin(angle) * radius;
				}
			});
		}
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

		// 每次 tick 前同步 pinned 状态及主角中心锁定
		this.updateProtagonistPositions();

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
		this.simulation.alpha(1);
	}

	/**
	 * 轻微“加热”系统，赋予低能量
	 * 用于：用户拖拽某节点时引发周围的局部微调
	 */
	public reheat(): void {
		// alpha(0.3) 相当于赋予了 30% 的热量，可以产生跟随位移，又不会导致全屏乱飞
		this.simulation.alpha(0.3);
	}

	/**
	 * 容器改变大小时，调整中心力坐标及主角中心定位
	 */
	public resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
		const centerForce = this.simulation.force('center') as d3.ForceCenter<LayoutNode>;
		if (centerForce) {
			centerForce.x(width / 2).y(height / 2);
		}
		
		this.updateProtagonistPositions();
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

	/**
	 * 销毁物理模拟引擎
	 */
	public destroy(): void {
		this.simulation.stop();
	}
}
