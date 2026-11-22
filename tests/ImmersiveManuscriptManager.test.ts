import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import {
	ImmersiveManuscriptManager,
	sanitizeManuscriptPosition,
	sanitizeWorkManuscriptPositions,
	type ImmersiveManuscriptManagerPlugin
} from '../src/services/ImmersiveManuscriptManager';
import { DEFAULT_SETTINGS } from '../src/constants';
import { ChapterSorter } from '../src/services/ChapterSorter';

vi.mock('obsidian', () => {
	class MockTFolder {
		path: string;
		name: string;
		children: Array<MockTFile | MockTFolder> = [];
		parent: MockTFolder | null = null;
		constructor(path = '', name = '') {
			this.path = path;
			this.name = name;
		}
		isRoot(): boolean {
			return this.path === '/' || this.path === '';
		}
	}
	class MockTFile {
		path: string;
		name: string;
		basename: string;
		extension = 'md';
		parent: MockTFolder | null = null;
		constructor(path = '', name = '') {
			this.path = path;
			this.name = name;
			this.basename = name.replace(/\.md$/i, '');
		}
	}
	return {
		TFile: MockTFile,
		TFolder: MockTFolder,
		MarkdownView: class {},
		ItemView: class {},
		Notice: vi.fn(),
		normalizePath: (value: string) => value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
	};
});

describe('ImmersiveManuscriptManager', () => {
	it('preserves valid path whitespace and literal object-property folder names', () => {
		const position = { filePath: ' Fictional Book/第1章.md', workPath: ' Fictional Book', cursorLine: 0, cursorCh: 0 };
		expect(sanitizeManuscriptPosition(position)).toEqual(position);
		const positions = sanitizeWorkManuscriptPositions(JSON.parse(JSON.stringify({
			['__proto__']: { ...position, filePath: '__proto__/第1章.md', workPath: '__proto__' }
		})));
		expect(Object.prototype.hasOwnProperty.call(positions, '__proto__')).toBe(true);
	});

	let mockApp: App;
	let mockPlugin: ImmersiveManuscriptManagerPlugin;
	let vaultFiles: Map<string, TFile | TFolder>;
	let folders: Map<string, TFolder>;
	let saveSettingsSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;
	let flushSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;

	const getOrCreateFolder = (path: string): TFolder => {
		const norm = path.replace(/^\/+|\/+$/g, '');
		if (folders.has(norm)) return folders.get(norm)!;
		const name = norm ? (norm.split('/').pop() || norm) : '';
		const folder = new (TFolder as unknown as new (path: string, name: string) => TFolder)(norm || '/', name);
		folders.set(norm, folder);
		vaultFiles.set(norm || '/', folder);
		if (norm) {
			const parentPath = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
			const parent = getOrCreateFolder(parentPath);
			(folder as unknown as { parent: TFolder }).parent = parent;
			(parent as unknown as { children: Array<TFile | TFolder> }).children.push(folder);
		}
		return folder;
	};

	const createFile = (path: string): TFile => {
		const norm = path.replace(/^\/+|\/+$/g, '');
		const name = norm.split('/').pop() || norm;
		const file = new (TFile as unknown as new (path: string, name: string) => TFile)(norm, name);
		const parentPath = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
		const parent = getOrCreateFolder(parentPath);
		(file as unknown as { parent: TFolder }).parent = parent;
		(parent as unknown as { children: Array<TFile | TFolder> }).children.push(file);
		vaultFiles.set(norm, file);
		return file;
	};

	beforeEach(() => {
		vaultFiles = new Map();
		folders = new Map();
		saveSettingsSpy = vi.fn().mockResolvedValue(undefined);
		flushSpy = vi.fn().mockResolvedValue(undefined);
		ChapterSorter.setCustomRules(DEFAULT_SETTINGS.chapterNamingRules);

		getOrCreateFolder('');
		getOrCreateFolder('Novels/BookAlpha/设定');
		getOrCreateFolder('Novels/BookBeta/设定');
		getOrCreateFolder('Novels/Book/设定');
		getOrCreateFolder('Novels/BookTwo/设定');

		mockApp = {
			vault: {
				getRoot: () => getOrCreateFolder(''),
				getAbstractFileByPath: vi.fn((path: string) => vaultFiles.get(path.replace(/^\/+|\/+$/g, '') || '/') ?? null),
				on: vi.fn(() => ({ id: 'ref' })),
				offref: vi.fn()
			},
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getMostRecentLeaf: vi.fn().mockReturnValue(null)
			}
		} as unknown as App;

		mockPlugin = {
			settings: {
				...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
				enableStrictChapterMode: false,
				enableSmartChapterSort: true,
				workspaceFolders: ['Novels/BookAlpha', 'Novels/BookBeta', 'Novels/Book', 'Novels/BookTwo'],
				strictChapterExceptions: ['Novels/BookAlpha/番外'],
				immersive: {
					...JSON.parse(JSON.stringify(DEFAULT_SETTINGS.immersive)),
					manuscriptModeEnabled: true
				}
			},
			saveSettings: saveSettingsSpy,
			settingsManager: { flush: flushSpy },
			isFileInWorkspace: (file: TFile) => {
				const ws = mockPlugin.settings.workspaceFolders || [];
				if (ws.length === 0) return true;
				return ws.some(folder => file.path.startsWith(folder + '/'));
			},
			isFileInStrictChapterException: (file: TFile) => {
				const ex = mockPlugin.settings.strictChapterExceptions || [];
				return ex.some(folder => file.path === folder + '.md' || file.path.startsWith(folder + '/'));
			},
			isPluginGeneratedFile: (basename: string) => ['作品信息', '伏笔', '时间线', '限时任务'].includes(basename),
			homepageManager: {
				getNovelFolders: vi.fn().mockReturnValue([]),
				getHomepageFilePath: () => '创作主页.md'
			}
		};
	});

	it('rejects ordinary non-chapter docs even when global enableStrictChapterMode is false, while accepting named chapters and strict exceptions', () => {
		const manager = new ImmersiveManuscriptManager(mockApp, mockPlugin);

		const chapter1 = createFile('Novels/BookAlpha/第1章 启程.md');
		const chapterEn = createFile('Novels/BookAlpha/02 Second Step.md');
		const exceptionExtra = createFile('Novels/BookAlpha/番外/序幕.md');
		const ordinaryOutline = createFile('Novels/BookAlpha/大纲.md');
		const ordinaryNotes = createFile('Novels/BookAlpha/灵感笔记.md');
		const outsideWs = createFile('Other/第1章 外部.md');

		// Functional docs must NEVER pass even if named like a chapter or inside exception dir
		const loreDoc = createFile('Novels/BookAlpha/设定/第1章 设定.md');
		const timelineDoc = createFile('Novels/BookAlpha/时间线.md');
		const foreshadowDoc = createFile('Novels/BookAlpha/伏笔.md');
		const novelInfoDoc = createFile('Novels/BookAlpha/作品信息.md');
		const taskDoc = createFile('Novels/BookAlpha/限时任务.md');
		const mergedDoc = createFile('Novels/BookAlpha/BookAlpha_合并章节.md');
		const homepageDoc = createFile('创作主页.md');
		const functionalInException = createFile('Novels/BookAlpha/番外/时间线.md');

		expect(manager.isEligibleManuscriptChapter(chapter1)).toBe(true);
		expect(manager.isEligibleManuscriptChapter(chapterEn)).toBe(true);
		expect(manager.isEligibleManuscriptChapter(exceptionExtra)).toBe(true);

		expect(manager.isEligibleManuscriptChapter(ordinaryOutline)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(ordinaryNotes)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(outsideWs)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(loreDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(timelineDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(foreshadowDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(novelInfoDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(taskDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(mergedDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(homepageDoc)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(functionalInException)).toBe(false);
		expect(manager.isEligibleManuscriptChapter(null)).toBe(false);

		manager.destroy();
	});

	it('orders multi-volume chapters deterministically and preserves duplicate basenames across volumes', () => {
		const manager = new ImmersiveManuscriptManager(mockApp, mockPlugin);

		const v2c10 = createFile('Novels/BookAlpha/第二卷/第10章 终局.md');
		const v1c1 = createFile('Novels/BookAlpha/第一卷/第1章.md');
		const v2c1 = createFile('Novels/BookAlpha/第二卷/第1章.md');
		const v1c2 = createFile('Novels/BookAlpha/第一卷/第2章.md');
		const rootPrologue = createFile('Novels/BookAlpha/番外/序幕.md');
		createFile('Novels/BookAlpha/大纲.md');
		createFile('Novels/BookAlpha/设定/主角.md');
		createFile('Novels/BookBeta/第一卷/第1章.md');

		const ordered = manager.getBookChaptersForFile(v1c1);
		// Root-level/unrecognized exception folder vs smart volumes follow deterministic display order;
		// crucially both 第一卷/第1章.md and 第二卷/第1章.md are preserved and ordered by volume then number.
		expect(ordered).toContain(v1c1);
		expect(ordered).toContain(v2c1);
		expect(ordered).toContain(rootPrologue);
		expect(ordered.map(f => f.path)).not.toContain('Novels/BookAlpha/大纲.md');
		expect(ordered.map(f => f.path)).not.toContain('Novels/BookAlpha/设定/主角.md');
		expect(ordered.map(f => f.path)).not.toContain('Novels/BookBeta/第一卷/第1章.md');

		const v1c1Idx = ordered.indexOf(v1c1);
		const v1c2Idx = ordered.indexOf(v1c2);
		const v2c1Idx = ordered.indexOf(v2c1);
		const v2c10Idx = ordered.indexOf(v2c10);
		expect(v1c1Idx).toBeLessThan(v1c2Idx);
		expect(v1c2Idx).toBeLessThan(v2c1Idx);
		expect(v2c1Idx).toBeLessThan(v2c10Idx);

		manager.destroy();
	});

	it('restores last valid manuscript position automatically when entering from a non-chapter, without scanning the vault', async () => {
		const manager = new ImmersiveManuscriptManager(mockApp, mockPlugin);

		const ch1 = createFile('Novels/BookAlpha/第1章.md');
		const ch2 = createFile('Novels/BookAlpha/第2章.md');
		const outline = createFile('Novels/BookAlpha/大纲.md');
		const outsideNote = createFile('Notes/scratch.md');

		await manager.recordValidPosition({
			filePath: ch2.path,
			workPath: 'Novels/BookAlpha',
			cursorLine: 14,
			cursorCh: 6,
			chapterRelativeScroll: 180,
			anchorLine: 10
		}, true);

		// Entering from non-chapter inside BookAlpha restores ch2 + caret + scroll
		const fromBookNonChapter = manager.resolveEntryTarget(outline);
		expect(fromBookNonChapter?.file.path).toBe(ch2.path);
		expect(fromBookNonChapter?.position?.cursorLine).toBe(14);
		expect(fromBookNonChapter?.position?.cursorCh).toBe(6);
		expect(fromBookNonChapter?.position?.chapterRelativeScroll).toBe(180);

		// Entering from unrelated non-chapter outside any book restores global lastManuscriptPosition
		const fromOutsideNonChapter = manager.resolveEntryTarget(outsideNote);
		expect(fromOutsideNonChapter?.file.path).toBe(ch2.path);

		// If persisted file was deleted, falls back to first eligible chapter in known work (BookAlpha)
		vaultFiles.delete(ch2.path);
		const alphaFolder = vaultFiles.get('Novels/BookAlpha') as unknown as { children: Array<TFile | TFolder> };
		alphaFolder.children = alphaFolder.children.filter(c => c !== ch2);

		const fallbackInKnownWork = manager.resolveEntryTarget(outline);
		expect(fallbackInKnownWork?.file.path).toBe(ch1.path);

		// When truly no context or chapters exist, returns null safely without scanning root vault
		vaultFiles.delete(ch1.path);
		alphaFolder.children = alphaFolder.children.filter(c => c !== ch1);
		mockPlugin.settings.immersive.lastManuscriptPosition = undefined;
		mockPlugin.settings.immersive.workManuscriptPositions = {};
		const rootSpy = vi.spyOn(mockApp.vault, 'getRoot');
		const noTarget = manager.resolveEntryTarget(outsideNote);
		expect(noTarget).toBeNull();
		expect(rootSpy).not.toHaveBeenCalled();

		manager.destroy();
	});

	it('flushes the latest position even when it has not reached the debounce timer', async () => {
		const manager = new ImmersiveManuscriptManager(mockApp, mockPlugin);
		const chapter = createFile('Novels/BookAlpha/第1章.md');
		await manager.recordValidPosition({ filePath: chapter.path, workPath: 'Novels/BookAlpha', cursorLine: 8, cursorCh: 2 }, false);
		expect(saveSettingsSpy).not.toHaveBeenCalled();
		await manager.flush();
		expect(saveSettingsSpy).toHaveBeenCalled();
		expect(mockPlugin.settings.immersive.lastManuscriptPosition?.cursorLine).toBe(8);
		manager.destroy();
	});

	it('updates persisted manuscript positions with strict path-prefix boundaries on rename and delete', async () => {
		const manager = new ImmersiveManuscriptManager(mockApp, mockPlugin);
		const bookCh = createFile('Novels/Book/第1章.md');
		const bookTwoCh = createFile('Novels/BookTwo/第1章.md');

		await manager.recordValidPosition({
			filePath: bookTwoCh.path,
			workPath: 'Novels/BookTwo',
			cursorLine: 3,
			cursorCh: 2
		}, false);
		await manager.recordValidPosition({
			filePath: bookCh.path,
			workPath: 'Novels/Book',
			cursorLine: 8,
			cursorCh: 4
		}, false);

		await manager.handleRename({ path: 'Novels/BookRenamed', name: 'BookRenamed' } as unknown as TFolder, 'Novels/Book');

		expect(mockPlugin.settings.immersive.lastManuscriptPosition?.filePath).toBe('Novels/BookRenamed/第1章.md');
		expect(mockPlugin.settings.immersive.lastManuscriptPosition?.workPath).toBe('Novels/BookRenamed');
		expect(mockPlugin.settings.immersive.workManuscriptPositions?.['Novels/BookRenamed']?.filePath).toBe('Novels/BookRenamed/第1章.md');
		expect(mockPlugin.settings.immersive.workManuscriptPositions?.['Novels/Book']).toBeUndefined();
		expect(mockPlugin.settings.immersive.workManuscriptPositions?.['Novels/BookTwo']?.filePath).toBe('Novels/BookTwo/第1章.md');

		await manager.handleDelete({ path: 'Novels/BookRenamed', name: 'BookRenamed' } as unknown as TFolder);
		expect(mockPlugin.settings.immersive.lastManuscriptPosition).toBeUndefined();
		expect(mockPlugin.settings.immersive.workManuscriptPositions?.['Novels/BookRenamed']).toBeUndefined();
		expect(mockPlugin.settings.immersive.workManuscriptPositions?.['Novels/BookTwo']?.filePath).toBe('Novels/BookTwo/第1章.md');

		await manager.destroy();
	});

	it('prefers remembered global position over another book first-chapter fallback and avoids root recursion', async () => {
		const manager = new ImmersiveManuscriptManager(mockApp, mockPlugin);

		const alphaC1 = createFile('Novels/BookAlpha/第1章.md');
		const alphaC3 = createFile('Novels/BookAlpha/第3章.md');
		const betaC1 = createFile('Novels/BookBeta/第1章.md');
		const betaOutline = createFile('Novels/BookBeta/大纲.md');
		createFile('Novels/BookBeta/作品信息.md');

		await manager.recordValidPosition({
			filePath: alphaC3.path,
			workPath: 'Novels/BookAlpha',
			cursorLine: 5,
			cursorCh: 1,
			viewportFilePath: alphaC1.path,
			viewportLine: 2,
			viewportLineOffset: 4
		}, true);

		// Current non-chapter in BookBeta has no Beta saved position -> must restore remembered BookAlpha c3, NOT BookBeta c1
		const target = manager.resolveEntryTarget(betaOutline);
		expect(target?.file.path).toBe(alphaC3.path);
		expect(target?.position?.viewportFilePath).toBe(alphaC1.path);

		// Root chapter scope uses only direct root siblings, never recursively enumerating subfolders
		mockPlugin.settings.workspaceFolders = [];
		const rootCh1 = createFile('第1章.md');
		const rootCh2 = createFile('第2章.md');
		const rootScope = manager.getBookChaptersForFile(rootCh1);
		expect(rootScope.map(f => f.path)).toEqual([rootCh1.path, rootCh2.path]);
		expect(rootScope.map(f => f.path)).not.toContain(betaC1.path);

		// Destroy awaits required flush of unpersisted dirty positions before marking destroyed
		await manager.recordValidPosition({
			filePath: betaC1.path,
			workPath: 'Novels/BookBeta',
			cursorLine: 11,
			cursorCh: 3
		}, false);
		saveSettingsSpy.mockClear();
		await manager.destroy();
		expect(saveSettingsSpy).toHaveBeenCalled();
		expect(mockPlugin.settings.immersive.lastManuscriptPosition?.filePath).toBe(betaC1.path);
	});
});
