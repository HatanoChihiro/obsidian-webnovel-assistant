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

		it('应使用 pulseColor 绘制聚焦流光渐变', () => {
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
			const colors = {
				...GraphRenderer.getThemeColors(),
				pulseColor: '#00ff00'
			};

			GraphRenderer.drawFlowPulseStraight(mockCtx, 0, 0, 100, 100, colors, '#ff0000', false, 1, 1, 1000);
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
	});
});
