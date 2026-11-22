import type { App, CachedMetadata, HeadingCache, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { RelationGraphManager } from '../src/services/RelationGraphManager';
import { buildLoreOutline, getLoreSectionText, scanLoreHeadings } from '../src/services/LoreOutline';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';

function fixture(path: string, text: string) {
	const file = { path, basename: path.split('/').at(-1)!.replace(/\.md$/, '') } as TFile;
	const headings: HeadingCache[] = [];
	let offset = 0;
	for (const [index, line] of text.split('\n').entries()) {
		const heading = /^(#{1,6}) (.+)$/.exec(line);
		if (heading) headings.push({
			heading: heading[2], level: heading[1].length,
			position: { start: { line: index, col: 0, offset }, end: { line: index, col: line.length, offset: offset + line.length } },
		});
		offset += line.length + 1;
	}
	const cache: CachedMetadata = { headings };
	return { file, text, cache };
}

function graphFor(documents: ReturnType<typeof fixture>[], includeHeadingHierarchy = true) {
	const app = {
		vault: { cachedRead: (file: TFile) => Promise.resolve(documents.find(item => item.file === file)!.text) },
		metadataCache: {
			getFileCache: (file: TFile) => documents.find(item => item.file === file)!.cache,
			getFirstLinkpathDest: (link: string) => documents.find(item => item.file.basename === link)?.file ?? null,
		},
	} as unknown as App;
	const plugin = { settings: {} } as WebNovelAssistantPlugin;
	return new RelationGraphManager(app, plugin).buildGraphData(null, {
		files: documents.map(item => item.file), includeHeadingHierarchy, autoLinkMentions: true,
	});
}

describe('标题层级与设定关系', () => {
	it('reads type and aliases from each heading only, ignoring examples and metadata mentions', async () => {
		const note = fixture('设定/潮镜城.md', [
			'# 潮镜城', '类型：地区', '## 水网', 'Type: 水系', '### 北环', '類型：渠段',
			'#### 闸站', '型別：站点', '##### 检修层', '**类型**：设施', '###### 值班人',
			'%%', '类型：隐藏类型', '%%', '<!--', '类型：注释类型', '-->',
			'```md', '类型：示例类型', '```', '**类型**：主角', '别名：守门人',
			'## 空目录', '### 潮钟', '类型：仪器', '## 另一区', '这里提到守门人。',
		].join('\n'));
		const graph = await graphFor([note, fixture('设定/类型同名.md', '## 仪器\n## 主角')]);
		const names = new Map(graph.nodes.map(node => [node.heading, node]));
		expect(['潮镜城', '水网', '北环', '闸站', '检修层', '值班人', '空目录', '潮钟']
			.map(name => names.get(name)?.nodeType)).toEqual(['地区', '水系', '渠段', '站点', '设施', '主角', undefined, '仪器']);
		expect(graph.nodes.filter(node => node.isProtagonist).map(node => node.heading)).toEqual(['值班人']);
		expect(names.get('值班人')?.aliases).toContain('守门人');
		expect(names.get('水网')?.aliases).not.toContain('守门人');
		expect(graph.edges.filter(edge => edge.type === 'mention')).toEqual([
			{ source: names.get('另一区')?.id, target: names.get('值班人')?.id, type: 'mention', label: expect.any(String) },
		]);
		const legacy = await graphFor([note], false);
		expect(legacy.nodes.find(node => node.heading === '空目录')?.nodeType).toBeUndefined();
		expect(legacy.nodes.some(node => node.isProtagonist)).toBe(false);
	});

	it('沿 H1–H6 连接直属父节点，并在 H6 上同时保留旧词条的独立关系', async () => {
		const map = fixture('设定/地理志.md', [
			'# 地理志', '## 白岬王国', '### 北境领', '#### 雾港城', '##### 旧港区', '###### 东码头',
			'###### 关系', '**补给**：[[势力志#海鸥商会|海鸥]]', '', '### 关系', '- **通商**：海鸥商会',
		].join('\n'));
		const faction = fixture('设定/势力志.md', '# 势力志\n## 海鸥商会');
		const graph = await graphFor([map, faction]);
		const titles = new Map(graph.nodes.map(node => [node.id, node.heading]));
		const edges = graph.edges.map(edge => [titles.get(edge.source), titles.get(edge.target), edge.type, edge.label]);
		for (const [parent, child] of [['地理志', '白岬王国'], ['白岬王国', '北境领'], ['北境领', '雾港城'], ['雾港城', '旧港区'], ['旧港区', '东码头']]) {
			expect(edges).toContainEqual([parent, child, 'hierarchy', expect.any(String)]);
		}
		expect(edges).toContainEqual(['东码头', '海鸥商会', 'explicit', '补给']);
		expect(edges).toContainEqual(['白岬王国', '海鸥商会', 'explicit', '通商']);
		expect(graph.nodes.find(node => node.heading === '东码头')?.headingLine).toBe(5);
		expect([...titles.values()]).not.toContain('关系');
		expect(['地理志', '白岬王国', '北境领', '雾港城', '旧港区', '东码头', '海鸥商会']
			.map(title => graph.nodes.find(node => node.heading === title)?.descendantCount ?? 0))
			.toEqual([5, 4, 3, 2, 1, 0, 0]);

		const legacy = await graphFor([map, faction], false);
		expect(legacy.nodes.map(node => node.id)).toEqual(['白岬王国', '海鸥商会']);
		expect(legacy.edges).toEqual([{ source: '白岬王国', target: '海鸥商会', type: 'explicit', label: '通商' }]);
	});

	it('按完整路径区分同名标题，并略过有歧义的链接和预览示例', async () => {
		const map = fixture('设定/地理志.md', [
			'# 地理志', '## 白岬王国', '### 北境领', '##### 码头', '### 南部领', '##### 码头',
			'###### 关系', '- **同行**：[[#白岬王国#北境领#码头]]',
			'- **歧义**：[[#码头]]',
			'```md', '- **代码**：[[#白岬王国]]', '```',
			'%%', '- **注释**：[[#白岬王国]]', '%%',
			'<!--', '###### 隐藏', '- **隐藏**：[[#白岬王国]]', '-->',
		].join('\n'));
		const graph = await graphFor([map]);
		const south = graph.nodes.find(node => node.headingLine === 5)!;
		const north = graph.nodes.find(node => node.headingLine === 3)!;
		expect(south.id).not.toBe(north.id);
		expect(graph.nodes.map(node => node.heading)).not.toContain('隐藏');
		expect(graph.edges.filter(edge => edge.type === 'explicit')).toEqual([
			{ source: south.id, target: north.id, type: 'explicit', label: '同行' },
		]);
	});

	it('六级关系块分别归属于 H1–H6 的词条，并与直属正文和下个同级词条隔离', async () => {
		const names = ['地图', '王国', '北领', '港城', '旧港', '东码头'];
		const lines = names.flatMap((name, index) => [
			`${'#'.repeat(index + 1)} ${name}`, `${name}正文`,
			'###### 关系', `- **${name}补给**：[[势力志#商会]]`, '',
		]);
		lines.push('###### 西码头', '西码头正文', '关系:: 已退出 → [[势力志#商会]]');
		const outline = buildLoreOutline(scanLoreHeadings(lines), lines.length);
		expect(outline.map(section => section.title)).toEqual([...names, '西码头']);
		expect(outline.slice(0, -1).map(section => getLoreSectionText(lines, section))).toEqual(names.map(name => `${name}正文`));
		expect(outline.at(-2)?.subtreeEnd).toBe(outline.at(-1)?.line);
		const graph = await graphFor([fixture('设定/地图.md', lines.join('\n')), fixture('设定/势力志.md', '## 商会')]);
		const titles = new Map(graph.nodes.map(node => [node.id, node.heading]));
		expect(graph.edges.filter(edge => edge.type === 'explicit').map(edge => [
			titles.get(edge.source), titles.get(edge.target), edge.label,
		])).toEqual(names.map(name => [name, '商会', `${name}补给`]));
	});

	it('无词条标题的单文件设定可同时读取六级关系块和旧关系列表', async () => {
		const note = fixture('设定/档案.md', '独立设定。\n###### 关系\n- **补给**：[[地图#地区#王国#东码头|东码头]]\n### 关系\n- **合作**：王国');
		const map = fixture('设定/地图.md', '# 地区\n## 王国\n###### 东码头');
		const graph = await graphFor([note, map]);
		const titles = new Map(graph.nodes.map(node => [node.id, node.heading]));
		expect(graph.edges.filter(edge => edge.type === 'explicit').map(edge => [
			titles.get(edge.source), titles.get(edge.target), edge.label,
		])).toEqual([['档案', '东码头', '补给'], ['档案', '王国', '合作']]);
	});

	it('旧式正名关系优先保留同名的原二级词条', async () => {
		const note = fixture('设定/地图.md', '## 码头\n原词条。\n## 城区\n###### 码头\n子词条。\n### 关系\n- **通商**：码头');
		const graph = await graphFor([note]);
		expect(graph.nodes.filter(node => node.heading === '码头')).toHaveLength(2);
		expect(graph.edges.filter(edge => edge.label === '通商')).toEqual([{ source: '城区', target: '码头', label: '通商', type: 'explicit' }]);
	});
});
