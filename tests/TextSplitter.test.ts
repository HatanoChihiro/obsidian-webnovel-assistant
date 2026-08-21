import { describe, it, expect, beforeEach } from 'vitest';
import { TextSplitter, type TextSplitterPlugin } from '../src/services/TextSplitter';
import { ChapterSorter } from '../src/services/ChapterSorter';

describe('TextSplitter Engine', () => {
	beforeEach(() => {
		// 恢复默认的 3 条激活规则（与 constants.ts 完全一致）
		ChapterSorter.setCustomRules([
			{ name: '阿拉伯数字（第1章、第01章）', pattern: '^(?:第(\\d+)[章节回卷部册篇]?|第?(\\d+)[章节回卷部册篇])', enabled: true },
			{ name: '中文数字（第一章、第二章）', pattern: '^(?:第([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]?|第?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇])', enabled: true },
			{ name: '纯数字及标题（1、01、001 标题）', pattern: '^(\\d+)(?:[ \\-].*)?$', enabled: true }
		]);
	});

	it('正确识别包含书名/前言与中文章节的作品文件', () => {
		const text = `倾城之恋
第一章
上海为了“节省天光”，将所有的时钟都拨快了一个小时。
第二章
香港的陷落成全了她。`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.length).toBe(3);
		expect(chapters[0].title).toBe('非章节内容');
		expect(chapters[0].content).toEqual(['倾城之恋']);

		expect(chapters[1].title).toBe('第一章');
		expect(chapters[1].content).toEqual(['上海为了“节省天光”，将所有的时钟都拨快了一个小时。']);

		expect(chapters[2].title).toBe('第二章');
		expect(chapters[2].content).toEqual(['香港的陷落成全了她。']);
	});

	it('支持直接从第一章开始（忽略空前言）', () => {
		const text = `第一章 开端
这是第一章的正文内容。
第二章 发展
这是第二章的正文内容。`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.length).toBe(2);
		expect(chapters[0].title).toBe('第一章 开端');
		expect(chapters[1].title).toBe('第二章 发展');
	});

	it('支持匹配 Markdown 标题格式 (# 第一章)', () => {
		const text = `# 第一章 序幕
序幕内容
## 第二章 冲突
冲突内容`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.length).toBe(2);
		expect(chapters[0].title).toBe('第一章 序幕');
		expect(chapters[1].title).toBe('第二章 冲突');
	});

	it('默认章节规则可通过 Markdown 标题层级识别卷', () => {
		const text = `## 第一卷 初入

### 第一章 开始
故事开始
### 第二章 发展
故事发展
## 第二卷 终局

### 第三章 决战
故事决战`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.map(chapter => chapter.title)).toEqual([
			'第一章 开始',
			'第二章 发展',
			'第三章 决战'
		]);
		expect(chapters.map(chapter => chapter.volume)).toEqual([
			'第一卷 初入',
			'第一卷 初入',
			'第二卷 终局'
		]);
	});

	it('无 Markdown 标题时默认章节规则可通过相邻卷章标记识别卷', () => {
		const text = `第一卷 初入
第一章 开始
故事开始
第二章 发展
故事发展
第二卷 终局
第三章 决战
故事决战`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.map(chapter => chapter.title)).toEqual([
			'第一章 开始',
			'第二章 发展',
			'第三章 决战'
		]);
		expect(chapters.map(chapter => chapter.volume)).toEqual([
			'第一卷 初入',
			'第一卷 初入',
			'第二卷 终局'
		]);
	});

	it('支持识别超过20字符的 Markdown 卷章标题', () => {
		ChapterSorter.setCustomRules([
			{ name: 'Volume', pattern: '^Volume\\s+(\\d+)', enabled: true },
			{ name: 'Chapter', pattern: '^Chapter\\s+(\\d+)', enabled: true }
		]);
		const text = `# Chronicles of the Void
## Volume 1 - The Awakening

### Chapter 01 - The Starlight Anomaly
第一章内容
### Chapter 02 - The Shattered Realm
第二章内容
## Volume 2 - The Final Horizon

### Chapter 03 - The Last Stand
第三章内容`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.map(chapter => chapter.title)).toEqual([
			'非章节内容',
			'Chapter 01 - The Starlight Anomaly',
			'Chapter 02 - The Shattered Realm',
			'Chapter 03 - The Last Stand'
		]);
		expect(chapters.slice(1).map(chapter => chapter.volume)).toEqual([
			'Volume 1 - The Awakening',
			'Volume 1 - The Awakening',
			'Volume 2 - The Final Horizon'
		]);
	});

	it('支持自定义规则匹配非标准单位（如【第一集】）', () => {
		// 用户自定义正则规则
		ChapterSorter.setCustomRules([
			{ name: '集规则', pattern: '^(?:第([零一二三四五六七八九十]+)集|【?([零一二三四五六七八九十]+)集】?)', enabled: true }
		]);

		const text = `【第一集】 风起云涌
集内容
第二集 降临
集内容`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.length).toBe(2);
		expect(chapters[0].title).toBe('【第一集】 风起云涌');
		expect(chapters[1].title).toBe('第二集 降临');
	});

	it('支持纯数字编号模式 (001 标题)', () => {
		const text = `001 初入江湖
故事开始
002 名动天下
故事延续`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.length).toBe(2);
		expect(chapters[0].title).toBe('001 初入江湖');
		expect(chapters[1].title).toBe('002 名动天下');
	});

	it('段落开头为"第一次XXXX"且字数超过20字符时，不会误识别为章节标题', () => {
		const text = `第一章 序幕
这是第一章的内容。
第一次来到这个陌生而又美丽的城市，看到了高耸入云的漫天大楼，心里产生了万分感慨。
第二章 冲突
这是第二章的内容。`;

		const chapters = TextSplitter.splitIntoChapters(text, 20);

		expect(chapters.length).toBe(2);
		expect(chapters[0].title).toBe('第一章 序幕');
		expect(chapters[0].content).toContain('第一次来到这个陌生而又美丽的城市，看到了高耸入云的漫天大楼，心里产生了万分感慨。');
		expect(chapters[1].title).toBe('第二章 冲突');
	});

	it('识别卷标题并将章节关联到对应卷', () => {
		ChapterSorter.setCustomRules([
			{ name: '卷规则', pattern: '^第(\\d+)卷', enabled: true },
			{ name: '章规则', pattern: '^第(\\d+)章', enabled: true }
		]);
		const text = `作品名
第1卷 初入
第1章 开始
卷中的内容
第2卷 终局
第2章 决战
决战内容`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.map(chapter => chapter.title)).toEqual(['非章节内容', '第1章 开始', '第2章 决战']);
		expect(chapters[0].volume).toBeUndefined();
		expect(chapters[1].volume).toBe('第1卷 初入');
		expect(chapters[2].volume).toBe('第2卷 终局');
	});

	it('导入时按卷创建子目录并写入章节', async () => {
		ChapterSorter.setCustomRules([
			{ name: '卷规则', pattern: '^第(\\d+)卷', enabled: true },
			{ name: '章规则', pattern: '^第(\\d+)章', enabled: true }
		]);
		const createdFolders: string[] = [];
		const createdFiles: string[] = [];
		const existingPaths = new Set<string>();
		const vault = {
			getAbstractFileByPath: (path: string) => existingPaths.has(path) ? { path } : null,
			createFolder: async (path: string) => {
				createdFolders.push(path);
				existingPaths.add(path);
				return { path };
			},
			create: async (path: string, _content: string) => {
				createdFiles.push(path);
				existingPaths.add(path);
				return { path };
			}
		};
		const app = { vault } as unknown;
		const plugin: TextSplitterPlugin = {
			settings: { workspaceFolders: ['作品'], novelInfo: { fileName: '作品信息' } },
			homepageManager: { createNovelInfoFile: async () => undefined }
		};
		const chapters = TextSplitter.splitIntoChapters(`第1卷 初入
第1章 开始
正文
第2卷 终局
第2章 决战
正文`);

		await TextSplitter.executeImport(app as never, plugin, '测试作品', chapters, () => undefined);

		expect(createdFolders).toEqual([
			'作品/测试作品',
			'作品/测试作品/第1卷 初入',
			'作品/测试作品/第2卷 终局'
		]);
		expect(createdFiles).toContain('作品/测试作品/第1卷 初入/第1章 开始.md');
		expect(createdFiles).toContain('作品/测试作品/第2卷 终局/第2章 决战.md');
	});

	it('仅在连续规则对出现时将前一个规则识别为卷', () => {
		ChapterSorter.setCustomRules([
			{ name: 'Part', pattern: '^Part\\s+(\\d+)', enabled: true },
			{ name: 'Section', pattern: '^Section\\s+(\\d+)', enabled: true }
		]);
		const text = `Part 1 Prelude
Section 1 Opening
First section content
Section 2 Conflict
Second section content
Part 2 Finale
Section 1 Resolution
Final section content`;

		const chapters = TextSplitter.splitIntoChapters(text);

		expect(chapters.map(chapter => chapter.title)).toEqual(['Section 1 Opening', 'Section 2 Conflict', 'Section 1 Resolution']);
		expect(chapters.map(chapter => chapter.volume)).toEqual(['Part 1 Prelude', 'Part 1 Prelude', 'Part 2 Finale']);
	});
});
