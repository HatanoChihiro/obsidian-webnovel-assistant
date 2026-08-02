import { describe, it, expect, beforeEach } from 'vitest';
import { TextSplitter } from '../src/services/TextSplitter';
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
});
