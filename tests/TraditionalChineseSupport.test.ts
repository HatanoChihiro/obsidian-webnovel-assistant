import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App, type CachedMetadata } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/constants';
import { SettingsManager } from '../src/core/SettingsManager';
import { CharacterManager, type LoreEntry } from '../src/services/CharacterManager';
import { ForeshadowingManager } from '../src/services/ForeshadowingManager';
import { ProofreadingManager } from '../src/services/ProofreadingManager';
import { RelationGraphManager } from '../src/services/RelationGraphManager';
import { TimelineManager, type TimelineEntry } from '../src/services/TimelineManager';
import { ChapterSorter } from '../src/services/ChapterSorter';
import { detectLocale, getSupportedLocales, setLocale } from '../src/i18n';
import { ForeshadowingStatus, type ForeshadowingEntry } from '../src/types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { ForeshadowingParser } from '../src/utils/ForeshadowingParser';

interface CharacterManagerTestBridge {
	parseLoreFile(file: TFile): Promise<Array<{ key: string; entry: LoreEntry }>>;
}

const originalMoment = window.moment;

function installMomentLocale(locale: string): void {
	const momentMock = Object.assign(
		() => ({ format: () => '2026-09-11 12:00' }),
		{ locale: () => locale }
	);
	window.moment = momentMock as unknown as typeof window.moment;
}

function createFile(path: string): TFile {
	const name = path.split('/').pop() || '';
	return Object.assign(new TFile(), {
		name,
		path,
		basename: name.replace(/\.md$/i, ''),
		extension: 'md'
	});
}

describe('Traditional Chinese locale support', () => {
	let app: App;
	let plugin: WebNovelAssistantPlugin;

	beforeEach(() => {
		installMomentLocale('en');
		app = {
			vault: {
				cachedRead: vi.fn(),
				getAbstractFileByPath: vi.fn(),
				on: vi.fn(),
				process: vi.fn()
			},
			metadataCache: {
				getFileCache: vi.fn(),
				on: vi.fn()
			},
			workspace: {
				iterateAllLeaves: vi.fn(),
				trigger: vi.fn()
			}
		} as unknown as App;
		plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			registerEvent: vi.fn()
		} as unknown as WebNovelAssistantPlugin;
	});

	afterEach(async () => {
		window.moment = originalMoment;
		ChapterSorter.setCustomRules(DEFAULT_SETTINGS.chapterNamingRules);
		await setLocale('zh-CN');
		vi.restoreAllMocks();
	});

	it('detects zh-TW and zh-Hant and exposes zh-TW as a selectable locale', async () => {
		installMomentLocale('zh-tw');
		expect(detectLocale()).toBe('zh-TW');
		installMomentLocale('zh-Hant');
		expect(detectLocale()).toBe('zh-TW');
		expect(getSupportedLocales()).toContain('zh-TW');

		await setLocale('zh-TW');
	});

	it('keeps Chinese chapter rules and Traditional defaults on first install', () => {
		installMomentLocale('zh-tw');
		const manager = new SettingsManager(plugin, structuredClone(DEFAULT_SETTINGS));
		const settings = manager.getSettings();

		expect(settings.loreFolderName).toBe('設定');
		expect(settings.timeline.fileName).toBe('時間線');
		expect(settings.chapterNamingRules[0].name).toBe('阿拉伯數字（第1章、第01章）');
		expect(settings.chapterNamingRules[1].name).toBe('中文數字（第一章、第二章）');
		ChapterSorter.setCustomRules(settings.chapterNamingRules);
		expect(ChapterSorter.isChapterFile('第1章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第一章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第一節')).toBe(true);
		expect(ChapterSorter.isChapterFile('第一冊')).toBe(true);
		expect(ChapterSorter.isChapterFile('第貳章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第參章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第陸章')).toBe(true);
		expect(ChapterSorter.extractChapterNumber('第貳章')?.number).toBe(2);
		expect(ChapterSorter.extractChapterNumber('第參章')?.number).toBe(3);
		expect(ChapterSorter.extractChapterNumber('第陸章')?.number).toBe(6);
		expect(ChapterSorter.isChapterFile('Chapter 1')).toBe(false);
	});

	it('supports Traditional chapter units and financial numerals in fallback sorting', () => {
		ChapterSorter.setCustomRules([]);
		expect(ChapterSorter.isChapterFile('第1章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第一章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第一節')).toBe(true);
		expect(ChapterSorter.isChapterFile('第一冊')).toBe(true);
		expect(ChapterSorter.isChapterFile('第貳章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第參章')).toBe(true);
		expect(ChapterSorter.isChapterFile('第陸章')).toBe(true);
		expect(ChapterSorter.extractChapterNumber('第貳章')?.number).toBe(2);
		expect(ChapterSorter.extractChapterNumber('第參章')?.number).toBe(3);
		expect(ChapterSorter.extractChapterNumber('第陸章')?.number).toBe(6);
	});

	it('round-trips Traditional foreshadowing fields, statuses, and recovery logs', async () => {
		await setLocale('zh-TW');
		const entry: ForeshadowingEntry = {
			sourceFile: '第一章',
			createdAt: '2026-09-11 12:00',
			description: '寶庫鑰匙下落',
			content: '原文段落',
			tags: ['道具', '線索'],
			status: ForeshadowingStatus.PartiallyRecovered,
			recoveryLogs: [{
				stageType: 'stage',
				file: '第二章',
				time: '2026-09-11 13:00',
				note: '找到盒子'
			}]
		};

		const formatted = ForeshadowingParser.formatEntry(entry);
		const parsed = ForeshadowingParser.parseEntries(formatted);

		expect(formatted).toContain('**標籤**：#道具, #線索');
		expect(formatted).toContain('**狀態**：階段回收中');
		expect(formatted).toContain('**回收於**：');
		expect(parsed).toHaveLength(1);
		expect(parsed[0].tags).toEqual(['道具', '線索']);
		expect(parsed[0].status).toBe(ForeshadowingStatus.PartiallyRecovered);
		expect(parsed[0].recoveryLogs?.[0]).toMatchObject({
			stageType: 'stage',
			file: '第二章',
			note: '找到盒子'
		});
	});

	it('mutates Traditional foreshadowing statuses and recovery lists', async () => {
		await setLocale('zh-TW');
		const manager = new ForeshadowingManager(app, plugin);
		const targetFile = createFile('伏筆.md');
		let content = '## 寶庫鑰匙下落\n\n> [[第一章]] - 2026-09-11 12:00\n> 原文段落\n\n**標籤**：#線索\n\n**狀態**：未回收\n\n---\n';
		vi.mocked(app.vault.process).mockImplementation(async (_file, transform) => {
			content = transform(content);
			return content;
		});

		expect(await manager.markAsDeprecated(targetFile, '寶庫鑰匙下落')).toBe(true);
		expect(content).toContain('**狀態**：已廢棄');
		expect(await manager.markAsPending(targetFile, '寶庫鑰匙下落')).toBe(true);
		expect(content).toContain('**狀態**：未回收');

		content = '## [[第一章]] - 2026-09-11 12:00\n> 原文段落\n\n**說明**：寶庫鑰匙下落\n**狀態**：階段回收中\n**回收於**：\n- [階段] [[第二章]] - 2026-09-11 13:00\n\n---\n';
		expect(await manager.addRecoveryChapter(targetFile, '第一章', '2026-09-11 12:00', '第三章')).toBe(true);
		expect(content).toContain('- [[第三章]]');
	});

	it('reads Traditional aliases into the lore cache', async () => {
		await setLocale('zh-TW');
		const manager = new CharacterManager(app, plugin);
		const file = createFile('設定/人物.md');
		const content = '## 張三\n\n**類型**：主角\n**別名**：三哥、小三\n';
		const cache = {
			headings: [{
				level: 2,
				heading: '張三',
				position: { start: { line: 0 }, end: { line: 0 } }
			}]
		} as unknown as CachedMetadata;
		vi.mocked(app.metadataCache.getFileCache).mockReturnValue(cache);
		vi.mocked(app.vault.cachedRead).mockResolvedValue(content);

		const entries = await (manager as unknown as CharacterManagerTestBridge).parseLoreFile(file);
		expect(entries.map(item => item.key)).toEqual(['張三', '三哥', '小三']);
	});

	it('builds Traditional lore node metadata and explicit relationships', async () => {
		await setLocale('zh-TW');
		const manager = new RelationGraphManager(app, plugin);
		const file = createFile('設定/人物.md');
		const lines = [
			'## 張三',
			'**類型**：主角',
			'**別名**：三哥',
			'### 關係',
			'**師父**：李四',
			'## 李四'
		];
		const cache = {
			headings: [
				{ level: 2, heading: '張三', position: { start: { line: 0 }, end: { line: 0 } } },
				{ level: 3, heading: '關係', position: { start: { line: 3 }, end: { line: 3 } } },
				{ level: 2, heading: '李四', position: { start: { line: 5 }, end: { line: 5 } } }
			]
		} as unknown as CachedMetadata;
		vi.mocked(app.metadataCache.getFileCache).mockReturnValue(cache);
		vi.mocked(app.vault.cachedRead).mockResolvedValue(lines.join('\n'));

		const graph = await manager.buildGraphData(file, { enableGlobal: false, autoLinkMentions: false });
		expect(graph.nodes.map(node => ({ id: node.id, type: node.nodeType, aliases: node.aliases }))).toEqual([
			{ id: '張三', type: '主角', aliases: ['三哥'] },
			{ id: '李四', type: undefined, aliases: undefined }
		]);
		expect(graph.edges).toEqual([{ source: '張三', target: '李四', label: '師父', type: 'explicit' }]);
	});

	it('round-trips the Traditional timeline type label', async () => {
		await setLocale('zh-TW');
		const manager = new TimelineManager(app, plugin);
		const entry: TimelineEntry = {
			time: '第一天',
			description: '找到線索',
			chapter: '第一章',
			type: '主線',
			rawBlock: ''
		};
		const formatted = manager.formatEntry(entry);

		expect(formatted).toContain('**類型**：主線');
		expect(manager.parseEntries(formatted)[0].type).toBe('主線');
	});

	it('uses Chinese dictionary paths and templates in Traditional Chinese', async () => {
		await setLocale('zh-TW');
		const manager = new ProofreadingManager(app, plugin);

		expect(manager.resolveDictionaryPath()).toBe('校对词典');
		expect(manager.getResolvedDictFilePaths('自訂詞典')).toMatchObject({
			wrongFileName: '错词.md',
			synonymFileName: '近义词.md',
			sensitiveFileName: '敏感词.md'
		});
	});
});
