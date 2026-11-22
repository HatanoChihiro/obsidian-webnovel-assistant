import type { App, CachedMetadata, HeadingCache, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { RelationGraphManager } from '../src/services/RelationGraphManager';
import { parseLoreBodyForEditing } from '../src/services/LoreTemplateService';
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
	it('沿 H1–H6 连接直属父节点，并在 H6 上同时保留旧词条的独立关系', async () => {
		const map = fixture('设定/地理志.md', [
			'# 地理志', '## 白岬王国', '### 北境领', '#### 雾港城', '##### 旧港区', '###### 东码头',
			'关系:: 补给 → [[势力志#海鸥商会|海鸥]]', '', '### 关系', '- **通商**：海鸥商会',
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

		const legacy = await graphFor([map, faction], false);
		expect(legacy.nodes.map(node => node.id)).toEqual(['白岬王国', '海鸥商会']);
		expect(legacy.edges).toEqual([{ source: '白岬王国', target: '海鸥商会', type: 'explicit', label: '通商' }]);
	});

	it('按完整路径区分同名标题，并略过有歧义的链接和预览示例', async () => {
		const map = fixture('设定/地理志.md', [
			'# 地理志', '## 白岬王国', '### 北境领', '##### 码头', '### 南部领', '##### 码头',
			'关系:: 同行 → [[#白岬王国#北境领#码头]]',
			'关系:: 歧义 → [[#码头]]',
			'```md', '关系:: 代码 → [[#白岬王国]]', '```',
			'%%', '关系:: 注释 → [[#白岬王国]]', '%%',
		].join('\n'));
		const graph = await graphFor([map]);
		const south = graph.nodes.find(node => node.headingLine === 5)!;
		const north = graph.nodes.find(node => node.headingLine === 3)!;
		expect(south.id).not.toBe(north.id);
		expect(graph.edges.filter(edge => edge.type === 'explicit')).toEqual([
			{ source: south.id, target: north.id, type: 'explicit', label: '同行' },
		]);
	});

	it('卡片字段编辑保留 H6 的行内关系格式', () => {
		const before = '### 北境领\n###### 东码头\n地点：旧港区\n关系:: 补给 → [[势力志#海鸥商会]]';
		const body = parseLoreBodyForEditing(before);
		const editableRelation = body.fields.find(field => field.label === '关系')!;
		const editableLocation = body.fields.find(field => field.label === '地点')!;
		expect(editableRelation.defaultValue).toBe('补给 → [[势力志#海鸥商会]]');
		expect(body.render({ [editableLocation.id]: '外港' })).toBe(before.replace('地点：旧港区', '地点：外港'));
		expect(body.render({ [editableRelation.id]: '同盟 → [[势力志#海鸥商会]]' })).toBe(before.replace('补给', '同盟'));
	});
});
