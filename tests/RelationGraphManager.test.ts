import { describe, it, expect, vi } from 'vitest';
import { RelationGraphManager, type GraphData, type GraphNode } from '../src/services/RelationGraphManager';
import { GraphRenderer, GRAPH_STYLE_DEFAULTS, type GraphRenderState } from '../src/ui/components/GraphRenderer';

// Mock translation function for 'relation-graph.edge-mention'
vi.mock('../src/i18n', () => ({
	t: (key: string) => {
		if (key === 'relation-graph.edge-mention') return '提及';
		return key;
	}
}));

describe('RelationGraphManager', () => {
	// Create a dummy instance. We cast it to 'any' to access private methods.
	const manager = new RelationGraphManager(null as any, null as any) as any;

	describe('parseExplicitRelations', () => {
		it('应正确解析标准格式的显式关系', () => {
			const validNodeIds = new Set(['张三', '李四', '王五']);
			const lines = [
				'### 关系',
				'- **朋友**: 李四',
				'- __敌人__： 王五',
				'- **无视**: 赵六', // 赵六不在 validNodeIds 中，应被忽略
			];

			const edges = manager.parseExplicitRelations('张三', lines, 1, 4, validNodeIds);

			expect(edges.length).toBe(2);

			expect(edges[0]).toEqual({
				source: '张三',
				target: '李四',
				label: '朋友',
				type: 'explicit',
			});

			expect(edges[1]).toEqual({
				source: '张三',
				target: '王五',
				label: '敌人',
				type: 'explicit',
			});
		});

		it('应正确解析精准标题双链格式 [[文件#标题|显示名]] 和 [[#标题]]', () => {
			const validNodeIds = new Set(['张三', '李四', 'John Doe', '林雷', '风清扬']);
			const lines = [
				'### 关系',
				'- **喜欢**: [[角色.md#李四|李四]]',
				'- **助手**: [[Characters#John Doe|JD]]',
				'- **同门**: [[#张三]]',
				'- **宿敌**: [[角色/主角/林雷]]',
				'- **宗师**: [[宗门/华山/剑宗#风清扬|风老前辈]]',
			];

			const edges = manager.parseExplicitRelations('主角', lines, 1, 6, validNodeIds);

			expect(edges.length).toBe(5);
			expect(edges[0]).toEqual({ source: '主角', target: '李四', label: '喜欢', type: 'explicit' });
			expect(edges[1]).toEqual({ source: '主角', target: 'John Doe', label: '助手', type: 'explicit' });
			expect(edges[2]).toEqual({ source: '主角', target: '张三', label: '同门', type: 'explicit' });
			expect(edges[3]).toEqual({ source: '主角', target: '林雷', label: '宿敌', type: 'explicit' });
			expect(edges[4]).toEqual({ source: '主角', target: '风清扬', label: '宗师', type: 'explicit' });
		});

		it('应支持多个目标的分割', () => {
			const validNodeIds = new Set(['主角', '配角A', '配角B', '反派']);
			const lines = [
				'- **队友**: 配角A,配角B、反派',
			];

			const edges = manager.parseExplicitRelations('主角', lines, 0, 1, validNodeIds);

			expect(edges.length).toBe(3);
			expect(edges.map((e: any) => e.target)).toEqual(['配角A', '配角B', '反派']);
			expect(edges.every((e: any) => e.label === '队友')).toBe(true);
		});

		it('应忽略无效的格式或空行', () => {
			const validNodeIds = new Set(['A', 'B']);
			const lines = [
				'',
				'随便写点什么',
				'- 朋友: B', // 没有加粗
				'- **朋友**: ', // 目标为空
			];

			const edges = manager.parseExplicitRelations('A', lines, 0, 4, validNodeIds);
			expect(edges.length).toBe(0);
		});

		it('不应将自己作为目标', () => {
			const validNodeIds = new Set(['A', 'B']);
			const lines = [
				'- **克隆**: A',
			];

			const edges = manager.parseExplicitRelations('A', lines, 0, 1, validNodeIds);
			expect(edges.length).toBe(0);
		});

		it('应支持将别名解析映射至主设定节点 ID', () => {
			const validNodeIds = new Set(['张三', '李四']);
			const nameOrAliasMap = new Map<string, string>([
				['张三', '张三'],
				['三哥', '张三'],
				['李四', '李四'],
				['四弟', '李四'],
			]);
			const lines = [
				'- **同门**: 三哥',
			];

			const edges = manager.parseExplicitRelations('李四', lines, 0, 1, validNodeIds, nameOrAliasMap);
			expect(edges.length).toBe(1);
			expect(edges[0]).toEqual({
				source: '李四',
				target: '张三',
				label: '同门',
				type: 'explicit',
			});
		});
	});

	describe('scanMentions', () => {
		it('应提取正文中的有效角色提及并去重', () => {
			const validNodeIds = new Set(['主角', '配角A', '反派']);
			const lines = [
				'今天主角遇到了配角A。',
				'配角A说：“小心反派！”',
				'他们又看到了配角A。' // 重复提及
			];
			// 假设没有 ### 关系 块，传 null
			const edges = manager.scanMentions('主角', lines, 0, 3, null, validNodeIds);

			expect(edges.length).toBe(2);
			// 期望按顺序提取到 配角A 和 反派
			expect(edges[0].target).toBe('配角A');
			expect(edges[0].label).toBe('提及');
			expect(edges[0].type).toBe('mention');
			expect(edges[1].target).toBe('反派');
		});

		it('应支持提取正文中通过别名提及的角色关联', () => {
			const searchTerms = [
				{ term: '张三丰', targetId: '张三丰' },
				{ term: '三哥', targetId: '张三' },
				{ term: '张三', targetId: '张三' },
			];
			const lines = [
				'李四在山脚遇到了三哥，与三哥相谈甚欢。',
				'后来张三离开了。'
			];

			const edges = manager.scanMentions('李四', lines, 0, 2, null, searchTerms);

			expect(edges.length).toBe(1);
			expect(edges[0]).toEqual({
				source: '李四',
				target: '张三',
				label: '提及',
				type: 'mention',
			});
		});

		it('应跳过在 ### 关系 块中的提及', () => {
			const validNodeIds = new Set(['A', 'B', 'C']);
			const lines = [
				'正文提到了 B',
				'### 关系',
				'- **朋友**: C',
				'正文提到了 B 再次',
			];
			const relationSection = { startLine: 1, endLine: 3 };

			const edges = manager.scanMentions('A', lines, 0, 4, relationSection, validNodeIds);

			// C 只出现在关系块中，不应被计入 mention
			// B 出现在关系块外，应被计入
			expect(edges.length).toBe(1);
			expect(edges[0].target).toBe('B');
		});
	});

	describe('extractNodes', () => {
		it('应能正确解析 ## 标题及其下方声明的别名', () => {
			const file = { path: 'test.md' } as any;
			const fileCache = {
				headings: [
					{ level: 2, heading: '张三', position: { start: { line: 0 }, end: { line: 0 } } },
					{ level: 2, heading: '李四', position: { start: { line: 4 }, end: { line: 4 } } },
				]
			} as any;
			const lines = [
				'## 张三',
				'**类型**：主角',
				'**别名**：三哥、小张',
				'',
				'## 李四',
				'**别名**：四弟',
			];

			const nodes = manager.extractNodes(file, fileCache, lines);
			expect(nodes.length).toBe(2);
			expect(nodes[0].id).toBe('张三');
			expect(nodes[0].isProtagonist).toBe(true);
			expect(nodes[0].aliases).toEqual(['三哥', '小张']);
			expect(nodes[1].id).toBe('李四');
			expect(nodes[1].aliases).toEqual(['四弟']);
		});

		it('应能正确解析单文件词条（无二级标题，以文件名作为节点）', () => {
			const file = { basename: '主角', path: '设定/角色/主角.md' } as any;
			const fileCache = {
				headings: [
					{ level: 1, heading: '主角', position: { start: { line: 0 }, end: { line: 0 } } }
				],
				frontmatter: {
					type: '主角',
					aliases: ['小主', '大侠']
				}
			} as any;
			const lines = [
				'---',
				'type: 主角',
				'aliases: [小主, 大侠]',
				'---',
				'# 主角',
				'**别名**：天选之子',
				'这里是主角的详细背景...'
			];

			const nodes = manager.extractNodes(file, fileCache, lines);
			expect(nodes.length).toBe(1);
			expect(nodes[0].id).toBe('主角');
			expect(nodes[0].isProtagonist).toBe(true);
			expect(nodes[0].aliases).toContain('小主');
			expect(nodes[0].aliases).toContain('大侠');
			expect(nodes[0].aliases).toContain('天选之子');
		});

		it('应能正确解析完全无 Markdown 标题的单文件设定', () => {
			const file = { basename: '女配', path: '设定/角色/女配.md' } as any;
			const fileCache = {
				frontmatter: {
					type: '主要角色'
				}
			} as any;
			const lines = [
				'---',
				'type: 主要角色',
				'---',
				'**别名**：小师妹',
				'女配是主角的师妹。'
			];

			const nodes = manager.extractNodes(file, fileCache, lines);
			expect(nodes.length).toBe(1);
			expect(nodes[0].id).toBe('女配');
			expect(nodes[0].nodeType).toBe('主要角色');
			expect(nodes[0].aliases).toContain('小师妹');
		});
	});

	describe('findRelationSection for single-file lore', () => {
		it('应在单文件模式下正确识别 ## 关系 标题', () => {
			const headings = [
				{ level: 1, heading: '女主角', position: { start: { line: 0 }, end: { line: 0 } } },
				{ level: 2, heading: '关系', position: { start: { line: 5 }, end: { line: 5 } } },
				{ level: 2, heading: '背景', position: { start: { line: 9 }, end: { line: 9 } } }
			] as any;
			const lines = [
				'# 女主角',
				'正文介绍...',
				'',
				'',
				'',
				'## 关系',
				'- **师兄**: 男主角',
				'',
				'',
				'## 背景',
				'背景介绍...'
			];

			const relSection = manager.findRelationSection(headings, -1, 0, lines.length, lines);
			expect(relSection).not.toBeNull();
			expect(relSection?.startLine).toBe(6);
			expect(relSection?.endLine).toBe(9);
		});
	});

	describe('GraphRenderer Style Defaults', () => {
		const createRenderState = (graphData: GraphData): GraphRenderState => ({
			graphData,
			scale: 1,
			panX: 0,
			panY: 0,
			selectedNode: null,
			hoveredNode: null,
			isLocalMode: false,
			localFocusNode: null,
			edgeDrawModeMap: new Map(),
			edgeOffsetMap: new Map(),
			combinedLabelMap: new Map()
		});

		it('应采用适度精致的节点小圆点半径与高亮放大半径', () => {
			expect(GRAPH_STYLE_DEFAULTS.NODE_RADIUS).toBe(3.5);
			expect(GRAPH_STYLE_DEFAULTS.NODE_HIGHLIGHT_RADIUS).toBe(5.5);
			expect(GraphRenderer.NODE_RADIUS).toBe(3.5);
			expect(GraphRenderer.NODE_HIGHLIGHT_RADIUS).toBe(5.5);
		});

		it('应定义完整的样式默认值供 CSS 变量解耦与自定义覆盖', () => {
			expect(GRAPH_STYLE_DEFAULTS.LABEL_FONT_SIZE).toBe(6);
			expect(GRAPH_STYLE_DEFAULTS.NODE_FONT_SIZE).toBe(10);
			expect(GRAPH_STYLE_DEFAULTS.LABEL_PADDING_X).toBe(4);
			expect(GRAPH_STYLE_DEFAULTS.LABEL_PADDING_Y).toBe(3);
			expect(GRAPH_STYLE_DEFAULTS.LABEL_GAP).toBe(4);
			expect(GRAPH_STYLE_DEFAULTS.NODE_SHADOW_BLUR_SELECTED).toBe(15);
			expect(GRAPH_STYLE_DEFAULTS.NODE_SHADOW_BLUR_HOVER).toBe(10);
			expect(GRAPH_STYLE_DEFAULTS.CURVE_OFFSET).toBe(20);
			expect(GRAPH_STYLE_DEFAULTS.LINE_WIDTH).toBe(0.5);
			expect(GRAPH_STYLE_DEFAULTS.PULSE_GLOW_RATIO).toBe(2.2);
			expect(GRAPH_STYLE_DEFAULTS.SOURCE_MARKER).toBe('ring');
			expect(GRAPH_STYLE_DEFAULTS.TARGET_MARKER).toBe('dot');
			expect(GRAPH_STYLE_DEFAULTS.ARROW_LENGTH).toBe(2.6);
			expect(GRAPH_STYLE_DEFAULTS.ARROW_ANGLE_DEG).toBe(26);
		});

		it('应只接受受支持的端点标记并对无效值使用回退', () => {
			expect(GraphRenderer.parseMarkerStyle('ring', 'dot')).toBe('ring');
			expect(GraphRenderer.parseMarkerStyle('dot', 'ring')).toBe('dot');
			expect(GraphRenderer.parseMarkerStyle('arrow', 'ring')).toBe('arrow');
			expect(GraphRenderer.parseMarkerStyle('none', 'dot')).toBe('none');
			expect(GraphRenderer.parseMarkerStyle('triangle', 'ring')).toBe('ring');
			expect(GraphRenderer.parseMarkerStyle('', 'dot')).toBe('dot');
		});

		it('应将 arrow 标记绘制为朝端点外侧的开放箭头', () => {
			const pathPoints: Array<[number, number]> = [];
			const mockCtx = {
				globalAlpha: 1,
				strokeStyle: '' as string | CanvasGradient | CanvasPattern,
				lineWidth: 1,
				save() {},
				restore() {},
				setLineDash() {},
				beginPath() {},
				moveTo(x: number, y: number) { pathPoints.push([x, y]); },
				lineTo(x: number, y: number) { pathPoints.push([x, y]); },
				stroke() {}
			} as unknown as CanvasRenderingContext2D;
			const colors = GraphRenderer.getThemeColors();

			GraphRenderer.drawMarker(mockCtx, 'arrow', 10, 20, 1, 0, '#ffffff', 1, 1, colors, 1);
			expect(pathPoints).toHaveLength(3);
			expect(pathPoints[0][0]).toBeLessThan(10);
			expect(pathPoints[1]).toEqual([10, 20]);
			expect(pathPoints[2][0]).toBeLessThan(10);
		});

		it('应为直线、曲线及双向关系分派正确的端点标记', () => {
			const gradient = { addColorStop: () => {} } as unknown as CanvasGradient;
			const mockCtx = {
				strokeStyle: '' as string | CanvasGradient | CanvasPattern,
				lineWidth: 1,
				save() {},
				restore() {},
				beginPath() {},
				moveTo() {},
				lineTo() {},
				quadraticCurveTo() {},
				stroke() {},
				setLineDash() {},
				createLinearGradient() { return gradient; }
			} as unknown as CanvasRenderingContext2D;
			const source = { x: 0, y: 0 } as GraphNode;
			const target = { x: 100, y: 0 } as GraphNode;
			const colors = {
				...GraphRenderer.getThemeColors(),
				sourceMarker: 'none' as const,
				targetMarker: 'arrow' as const,
				pulseCoreAlpha: 0,
				pulseGlowAlpha: 0
			};
			const markerSpy = vi.spyOn(GraphRenderer, 'drawMarker').mockImplementation(() => {});

			GraphRenderer.drawStraightArrow(mockCtx, source, target, colors);
			expect(markerSpy.mock.calls.map(call => call[1])).toEqual(['none', 'arrow']);
			expect(markerSpy.mock.calls[0][4]).toBeLessThan(0);
			expect(markerSpy.mock.calls[1][4]).toBeGreaterThan(0);

			markerSpy.mockClear();
			GraphRenderer.drawStraightArrow(mockCtx, source, target, colors, true);
			expect(markerSpy.mock.calls.map(call => call[1])).toEqual(['arrow', 'arrow']);

			markerSpy.mockClear();
			GraphRenderer.drawCurvedArrow(mockCtx, source, target, 20, colors);
			expect(markerSpy.mock.calls.map(call => call[1])).toEqual(['none', 'arrow']);
			expect(markerSpy.mock.calls[1][4]).toBeGreaterThan(0);

			markerSpy.mockRestore();
		});

		it('应按 CSS curveOffset 重建同一图数据的多重关系偏移缓存', () => {
			const graphData: GraphData = {
				nodes: [],
				edges: [
					{ source: 'A', target: 'B', label: '朋友', type: 'explicit' },
					{ source: 'B', target: 'A', label: '对手', type: 'explicit' }
				]
			};
			const compactState = createRenderState(graphData);
			GraphRenderer.buildEdgeOffsets(graphData, compactState, 10);
			expect(compactState.edgeOffsetMap.size).toBe(2);
			expect([...compactState.edgeOffsetMap.values()]).toEqual([-10, -10]);

			const wideState = createRenderState(graphData);
			GraphRenderer.buildEdgeOffsets(graphData, wideState, 30);
			expect(wideState.edgeOffsetMap.size).toBe(2);
			expect([...wideState.edgeOffsetMap.values()]).toEqual([-30, -30]);
		});

		it('应使用主角专属覆盖色、聚焦覆盖色与阴影色', () => {
			const node: GraphNode = {
				id: '主角',
				file: null as unknown as GraphNode['file'],
				heading: '主角',
				x: 10,
				y: 10,
				vx: 0,
				vy: 0,
				pinned: false,
				isProtagonist: true,
				nodeType: '主角'
			};
			const graphData: GraphData = { nodes: [node], edges: [] };
			const fills: Array<{ fillStyle: string | CanvasGradient | CanvasPattern; shadowColor: string }> = [];
			const mockCtx = {
				fillStyle: '' as string | CanvasGradient | CanvasPattern,
				shadowColor: '',
				shadowBlur: 0,
				globalAlpha: 1,
				font: '',
				textAlign: 'start' as CanvasTextAlign,
				textBaseline: 'alphabetic' as CanvasTextBaseline,
				save() {},
				restore() {},
				beginPath() {},
				arc() {},
				fill() { fills.push({ fillStyle: this.fillStyle, shadowColor: this.shadowColor }); },
				fillText() {}
			};
			const colors = {
				...GraphRenderer.getThemeColors(),
				protagonistOverlay: 'rgba(1, 2, 3, 0.5)',
				protagonistOverlayHover: 'rgba(4, 5, 6, 0.8)',
				protagonistShadow: 'rgba(7, 8, 9, 0.9)'
			};

			GraphRenderer.drawNodes(mockCtx as unknown as CanvasRenderingContext2D, graphData, colors, [], createRenderState(graphData));
			expect(fills.some(fill => fill.fillStyle === colors.protagonistOverlay)).toBe(true);

			fills.length = 0;
			const focusedState = createRenderState(graphData);
			focusedState.selectedNode = node;
			GraphRenderer.drawNodes(mockCtx as unknown as CanvasRenderingContext2D, graphData, colors, [], focusedState);
			expect(fills.some(fill => fill.fillStyle === colors.protagonistOverlayHover)).toBe(true);
			expect(fills.some(fill => fill.shadowColor === colors.protagonistShadow)).toBe(true);
		});

		it('流光应默认跟随关系线颜色并允许 pulseColor 显式覆盖', () => {
			const colorStops: string[] = [];
			const mockCtx = {
				globalAlpha: 1,
				lineWidth: 1,
				lineCap: 'butt' as CanvasLineCap,
				strokeStyle: '' as string | CanvasGradient | CanvasPattern,
				save() {},
				restore() {},
				beginPath() {},
				moveTo() {},
				lineTo() {},
				stroke() {},
				setLineDash() {},
				createLinearGradient() {
					return { addColorStop: (_offset: number, color: string) => colorStops.push(color) };
				}
			} as unknown as CanvasRenderingContext2D;
			const defaultColors = {
				...GraphRenderer.getThemeColors(),
				pulseColor: ''
			};

			GraphRenderer.drawFlowPulseStraight(mockCtx, 0, 0, 100, 100, defaultColors, '#ff0000', false, 1, 1, 1000);
			expect(colorStops.some(color => color.startsWith('rgba(255, 0, 0,'))).toBe(true);

			colorStops.length = 0;
			const customColors = {
				...GraphRenderer.getThemeColors(),
				pulseColor: '#00ff00'
			};

			GraphRenderer.drawFlowPulseStraight(mockCtx, 0, 0, 100, 100, customColors, '#ff0000', false, 1, 1, 1000);
			expect(colorStops.some(color => color.startsWith('rgba(0, 255, 0,'))).toBe(true);
		});

		it('应支持通过 pulseCoreAlpha / pulseGlowAlpha 设为 0 关闭流光效果', () => {
			const mockCtx = {
				save: () => {},
				restore: () => {},
				beginPath: () => {},
				moveTo: () => {},
				lineTo: () => {},
				stroke: () => {},
				createLinearGradient: () => ({ addColorStop: () => {} }),
				setLineDash: () => {},
			} as unknown as CanvasRenderingContext2D;

			const themeColors = {
				...GraphRenderer.getThemeColors(),
				pulseCoreAlpha: 0,
				pulseGlowAlpha: 0,
			};

			// 不应抛出异常且提前返回
			expect(() => {
				GraphRenderer.drawFlowPulseStraight(mockCtx, 0, 0, 100, 100, themeColors, '#ff0000');
				GraphRenderer.drawFlowPulseCurved(mockCtx, 0, 0, 50, 50, 100, 100, themeColors, '#ff0000');
			}).not.toThrow();
		});

		it('分屏容器尺寸缩窄时应自适应缩小 scale 并保持主角在画布视口中心', () => {
			const protagonist: GraphNode = {
				id: '主角',
				file: null as unknown as GraphNode['file'],
				heading: '主角',
				x: 300,
				y: 400,
				vx: 0,
				vy: 0,
				pinned: false,
				isProtagonist: true,
				nodeType: '主角'
			};
			const otherNodes: GraphNode[] = [
				{ id: '配角A', file: null as unknown as GraphNode['file'], heading: '配角A', x: 100, y: 400, vx: 0, vy: 0, pinned: false },
				{ id: '配角B', file: null as unknown as GraphNode['file'], heading: '配角B', x: 500, y: 400, vx: 0, vy: 0, pinned: false },
				{ id: '配角C', file: null as unknown as GraphNode['file'], heading: '配角C', x: 300, y: 200, vx: 0, vy: 0, pinned: false },
				{ id: '配角D', file: null as unknown as GraphNode['file'], heading: '配角D', x: 300, y: 600, vx: 0, vy: 0, pinned: false },
			];
			const allNodes = [protagonist, ...otherNodes];

			const width = 600;
			const height = 800;
			const padding = 40;
			const viewport = GraphRenderer.calculateProtagonistViewport(width, height, allNodes, { padding });

			// 5 个节点基础倍率为 2.2，但由于容器宽度缩小（半宽 300 - 40 = 260，最大水平距离 200），应自适应降至 260/200 = 1.3
			expect(viewport.scale).toBeCloseTo(1.3, 2);
			expect(viewport.panX).toBe(0);
			expect(viewport.panY).toBe(0);

			// 主角屏幕坐标应精确位于画布中心 (width / 2, height / 2)
			const protagScreenX = width / 2 + viewport.panX + viewport.scale * (protagonist.x - width / 2);
			const protagScreenY = height / 2 + viewport.panY + viewport.scale * (protagonist.y - height / 2);
			expect(protagScreenX).toBeCloseTo(300, 2);
			expect(protagScreenY).toBeCloseTo(400, 2);

			// 所有边缘节点均应落在安全内边距以内
			for (const node of allNodes) {
				const sx = width / 2 + viewport.panX + viewport.scale * (node.x - width / 2);
				const sy = height / 2 + viewport.panY + viewport.scale * (node.y - height / 2);
				expect(sx).toBeGreaterThanOrEqual(padding - 1e-4);
				expect(sx).toBeLessThanOrEqual(width - padding + 1e-4);
				expect(sy).toBeGreaterThanOrEqual(padding - 1e-4);
				expect(sy).toBeLessThanOrEqual(height - padding + 1e-4);
			}
		});

		it('主角处于偏心位置时应计算正确的平移量使主角保持在视口中心', () => {
			const protagonist: GraphNode = {
				id: '主角',
				file: null as unknown as GraphNode['file'],
				heading: '主角',
				x: 150,
				y: 250,
				vx: 0,
				vy: 0,
				pinned: true,
				isProtagonist: true
			};
			const companion: GraphNode = {
				id: '配角',
				file: null as unknown as GraphNode['file'],
				heading: '配角',
				x: 200,
				y: 250,
				vx: 0,
				vy: 0,
				pinned: false
			};
			const nodes = [protagonist, companion];
			const width = 600;
			const height = 400;

			const viewport = GraphRenderer.calculateProtagonistViewport(width, height, nodes);

			// 验证主角变换后的屏幕坐标依然位于画布中心 (300, 200)
			const protagScreenX = width / 2 + viewport.panX + viewport.scale * (protagonist.x - width / 2);
			const protagScreenY = height / 2 + viewport.panY + viewport.scale * (protagonist.y - height / 2);
			expect(protagScreenX).toBeCloseTo(300, 2);
			expect(protagScreenY).toBeCloseTo(200, 2);
		});

		it('无主角节点时应以包围盒几何中心进行视口居中适配', () => {
			const nodes: GraphNode[] = [
				{ id: '设定A', file: null as unknown as GraphNode['file'], heading: '设定A', x: 100, y: 100, vx: 0, vy: 0, pinned: false },
				{ id: '设定B', file: null as unknown as GraphNode['file'], heading: '设定B', x: 500, y: 300, vx: 0, vy: 0, pinned: false },
			];
			const width = 600;
			const height = 400;

			const viewport = GraphRenderer.calculateProtagonistViewport(width, height, nodes);
			// 几何中心为 (300, 200)，与画布中心一致，pan 应为 0
			expect(viewport.panX).toBe(0);
			expect(viewport.panY).toBe(0);
		});

		it('单轴水平或垂直退化排布时应对溢出轴独立约束缩放', () => {
			const padding = 40;
			const width = 600;
			const height = 400;

			// 水平单轴退化布局（Y 轴距离为 0 <= 10，X 轴跨度 200）
			const horizProtagonist: GraphNode = {
				id: '主角',
				file: null as unknown as GraphNode['file'],
				heading: '主角',
				x: 300,
				y: 200,
				vx: 0,
				vy: 0,
				pinned: false,
				isProtagonist: true
			};
			const horizCompanion: GraphNode = {
				id: '配角',
				file: null as unknown as GraphNode['file'],
				heading: '配角',
				x: 500,
				y: 200,
				vx: 0,
				vy: 0,
				pinned: false
			};
			const horizViewport = GraphRenderer.calculateProtagonistViewport(width, height, [horizProtagonist, horizCompanion], { padding });
			// 2 节点基础倍率 2.2，可用半宽 300 - 40 = 260，最大水平距离 200，自适应降为 260 / 200 = 1.3
			expect(horizViewport.scale).toBeCloseTo(1.3, 2);
			const horizCompanionScreenX = width / 2 + horizViewport.panX + horizViewport.scale * (horizCompanion.x - width / 2);
			expect(horizCompanionScreenX).toBeCloseTo(width - padding, 2);

			// 垂直单轴退化布局（X 轴距离为 0 <= 10，Y 轴跨度 200）
			const vertProtagonist: GraphNode = {
				id: '主角',
				file: null as unknown as GraphNode['file'],
				heading: '主角',
				x: 300,
				y: 200,
				vx: 0,
				vy: 0,
				pinned: false,
				isProtagonist: true
			};
			const vertCompanion: GraphNode = {
				id: '配角',
				file: null as unknown as GraphNode['file'],
				heading: '配角',
				x: 300,
				y: 400,
				vx: 0,
				vy: 0,
				pinned: false
			};
			const vertViewport = GraphRenderer.calculateProtagonistViewport(width, height, [vertProtagonist, vertCompanion], { padding });
			// 可用半高 200 - 40 = 160，最大垂直距离 200，自适应降为 160 / 200 = 0.8
			expect(vertViewport.scale).toBeCloseTo(0.8, 2);
			const vertCompanionScreenY = height / 2 + vertViewport.panY + vertViewport.scale * (vertCompanion.y - height / 2);
			expect(vertCompanionScreenY).toBeCloseTo(height - padding, 2);
		});

		it('空节点或非法尺寸时应回退到安全默认视口', () => {
			expect(GraphRenderer.calculateProtagonistViewport(600, 400, [])).toEqual({ scale: 1.0, panX: 0, panY: 0 });
			expect(GraphRenderer.calculateProtagonistViewport(0, 0, [])).toEqual({ scale: 1.0, panX: 0, panY: 0 });
		});
	});
});
