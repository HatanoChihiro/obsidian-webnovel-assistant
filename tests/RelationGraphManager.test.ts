import { describe, it, expect, vi } from 'vitest';
import { RelationGraphManager } from '../src/services/RelationGraphManager';

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
			const validNodeIds = new Set(['张三', '李四', 'John Doe']);
			const lines = [
				'### 关系',
				'- **喜欢**: [[角色.md#李四|李四]]',
				'- **助手**: [[Characters#John Doe|JD]]',
				'- **同门**: [[#张三]]',
			];

			const edges = manager.parseExplicitRelations('主角', lines, 1, 4, validNodeIds);

			expect(edges.length).toBe(3);
			expect(edges[0]).toEqual({ source: '主角', target: '李四', label: '喜欢', type: 'explicit' });
			expect(edges[1]).toEqual({ source: '主角', target: 'John Doe', label: '助手', type: 'explicit' });
			expect(edges[2]).toEqual({ source: '主角', target: '张三', label: '同门', type: 'explicit' });
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
	});
});
