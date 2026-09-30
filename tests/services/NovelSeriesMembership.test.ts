import { describe, it, expect, vi } from 'vitest';
import { TFile, TFolder, type App, type EventRef } from 'obsidian';
import { HomepageManager } from '../../src/services/HomepageManager';
import type { WebNovelAssistantPlugin } from '../../src/types/plugin';

function createMockApp(initialFiles: Record<string, string> = {}) {
	const files = new Map<string, string>();
	for (const [path, content] of Object.entries(initialFiles)) {
		files.set(path, content);
	}

	function getMockFolder(dirPath: string): TFolder {
		const normalized = dirPath.replace(/^\/+|\/+$/g, '');
		const prefix = normalized ? `${normalized}/` : '';
		const seen = new Set<string>();
		const children: (TFile | TFolder)[] = [];

		for (const filePath of files.keys()) {
			if (prefix && !filePath.startsWith(prefix)) continue;
			const rest = prefix ? filePath.substring(prefix.length) : filePath;
			const segments = rest.split('/');
			const childName = segments[0];
			if (!seen.has(childName)) {
				seen.add(childName);
				const childPath = prefix ? `${prefix}${childName}` : childName;
				if (segments.length > 1) {
					children.push(getMockFolder(childPath));
				} else {
					const file = Object.create(TFile.prototype) as TFile;
					Object.assign(file, {
						path: childPath,
						name: childName,
						basename: childName.replace(/\.md$/, ''),
						extension: 'md',
						parent: { path: normalized }
					});
					children.push(file);
				}
			}
		}

		const folder = Object.create(TFolder.prototype) as TFolder;
		return Object.assign(folder, {
			path: normalized,
			name: normalized ? (normalized.split('/').pop() || normalized) : '/',
			isRoot: () => normalized === '',
			children
		});
	}

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => {
				const normalized = path.replace(/^\/+|\/+$/g, '');
				if (files.has(normalized)) {
					const file = Object.create(TFile.prototype) as TFile;
					const lastSlash = normalized.lastIndexOf('/');
					const parentPath = lastSlash !== -1 ? normalized.substring(0, lastSlash) : '';
					return Object.assign(file, {
						path: normalized,
						name: normalized.split('/').pop() || normalized,
						basename: (normalized.split('/').pop() || normalized).replace(/\.md$/, ''),
						extension: 'md',
						parent: { path: parentPath }
					});
				}
				const isFolder = normalized === '' || Array.from(files.keys()).some(p => p.startsWith(normalized + '/'));
				if (isFolder || normalized === 'NovelA' || normalized === 'NovelB' || normalized === 'NovelC') {
					return getMockFolder(normalized);
				}
				return null;
			},
			cachedRead: async (file: TFile) => {
				return files.get(file.path) ?? '';
			},
			read: async (file: TFile) => {
				return files.get(file.path) ?? '';
			},
			process: async (file: TFile, fn: (content: string) => string) => {
				const current = files.get(file.path) ?? '';
				const updated = fn(current);
				files.set(file.path, updated);
				return updated;
			},
			create: async (path: string, content: string) => {
				const normalized = path.replace(/^\/+|\/+$/g, '');
				files.set(normalized, content);
				const file = Object.create(TFile.prototype) as TFile;
				const lastSlash = normalized.lastIndexOf('/');
				const parentPath = lastSlash !== -1 ? normalized.substring(0, lastSlash) : '';
				return Object.assign(file, {
					path: normalized,
					name: normalized.split('/').pop() || normalized,
					basename: (normalized.split('/').pop() || normalized).replace(/\.md$/, ''),
					extension: 'md',
					parent: { path: parentPath }
				});
			},
			createFolder: async () => {},
			getRoot: () => getMockFolder('')
		},
		fileManager: {
			renameFile: async () => {}
		},
		workspace: {
			iterateAllLeaves: () => {}
		}
	} as unknown as App;

	return { app, files };
}

describe('NovelSeriesMembership - Core Metadata & Membership Behavior', () => {
	it('should parse series from simplified Chinese, traditional Chinese, and English labels with whitespace trimming', () => {
		const { app } = createMockApp();
		const plugin = {
			app,
			settings: { workspaceFolders: [] }
		} as unknown as WebNovelAssistantPlugin;
		const manager = new HomepageManager(app, plugin);

		// Simplified Chinese
		const contentZhCN = [
			'**系列**：  三体宇宙  ',
			'**状态**：连载中',
			'**简介**：硬科幻经典'
		].join('\n');
		const metaZhCN = manager.parseNovelInfoContent(contentZhCN, 'NovelA');
		expect(metaZhCN.series).toBe('三体宇宙');

		// Traditional Chinese
		const contentZhTW = [
			'**系列**：三體宇宙',
			'**狀態**：連載中'
		].join('\n');
		const metaZhTW = manager.parseNovelInfoContent(contentZhTW, 'NovelA');
		expect(metaZhTW.series).toBe('三體宇宙');

		// English
		const contentEn = [
			'**Series**: Three-Body Universe',
			'**Status**: Ongoing'
		].join('\n');
		const metaEn = manager.parseNovelInfoContent(contentEn, 'NovelA');
		expect(metaEn.series).toBe('Three-Body Universe');

		// Empty series field means standalone
		const contentEmpty = [
			'**系列**：   ',
			'**状态**：连载中'
		].join('\n');
		const metaEmpty = manager.parseNovelInfoContent(contentEmpty, 'NovelA');
		expect(metaEmpty.series).toBe('');

		// Omitted series field means standalone
		const contentLegacy = [
			'**状态**：连载中',
			'**简介**：无系列老作品'
		].join('\n');
		const metaLegacy = manager.parseNovelInfoContent(contentLegacy, 'NovelA');
		expect(metaLegacy.series).toBe('');
	});

	it('should apply series updates while strictly preserving other metadata and custom markdown content', () => {
		const { app } = createMockApp();
		const plugin = {
			app,
			settings: { workspaceFolders: [] }
		} as unknown as WebNovelAssistantPlugin;
		const manager = new HomepageManager(app, plugin);

		const originalContent = [
			'**系列**：旧系列名称',
			'**状态**：连载中',
			'**简介**：保持不变的内容',
			'**主角**：罗辑',
			'',
			'## 自定义作者笔记',
			'这是非常重要的作者笔记，绝对不能被破坏或丢失！'
		].join('\n');

		// 1. Update series name
		const updated = manager.applySeriesToContent(originalContent, '新系列名称');
		expect(updated).toContain('**系列**：新系列名称');
		expect(updated).toContain('**状态**：连载中');
		expect(updated).toContain('**简介**：保持不变的内容');
		expect(updated).toContain('## 自定义作者笔记');
		expect(updated).toContain('这是非常重要的作者笔记，绝对不能被破坏或丢失！');

		// 2. Clear series name (removes membership, preserves field empty & custom content)
		const cleared = manager.applySeriesToContent(updated, '');
		const parsedCleared = manager.parseNovelInfoContent(cleared, 'NovelA');
		expect(parsedCleared.series).toBe('');
		expect(cleared).toContain('**状态**：连载中');
		expect(cleared).toContain('## 自定义作者笔记');

		// 3. Insert series into legacy content lacking series field
		const legacyContent = [
			'**状态**：连载中',
			'**简介**：老作品简介',
			'',
			'## 杂谈'
		].join('\n');
		const inserted = manager.applySeriesToContent(legacyContent, '新增系列');
		expect(inserted).toContain('**系列**：新增系列');
		expect(inserted).toContain('**状态**：连载中');
		expect(inserted).toContain('## 杂谈');

		// 4. Respect English label when updating
		const enContent = [
			'**Series**: Old Series',
			'**Status**: Ongoing'
		].join('\n');
		const enUpdated = manager.applySeriesToContent(enContent, 'New Series');
		expect(enUpdated).toContain('**Series**: New Series');
		expect(enUpdated).toContain('**Status**: Ongoing');
	});

	it('should provide service-layer membership lookup across recognized novel folders only', async () => {
		const initialFiles: Record<string, string> = {
			'NovelA/作品信息.md': ['**系列**：星际编年史', '**状态**：连载中'].join('\n'),
			'NovelB/作品信息.md': ['**系列**：星际编年史', '**状态**：连载中'].join('\n'),
			'NovelC/作品信息.md': ['**系列**：  ', '**状态**：连载中'].join('\n')
		};
		const { app, files } = createMockApp(initialFiles);

		const plugin = {
			app,
			settings: {
				workspaceFolders: ['NovelA', 'NovelB', 'NovelC']
			},
			cacheManager: {
				getFolderWordCount: () => 1000
			}
		} as unknown as WebNovelAssistantPlugin;

		const manager = new HomepageManager(app, plugin);

		// getAllSeries
		const allSeries = await manager.getAllSeries();
		expect(allSeries).toEqual(['星际编年史']);

		// getSeriesNovels
		const members = await manager.getSeriesNovels('星际编年史');
		expect(members.map(m => m.folderPath)).toEqual(['NovelA', 'NovelB']);

		// getNovelSeries
		expect(await manager.getNovelSeries('NovelA')).toBe('星际编年史');
		expect(await manager.getNovelSeries('NovelC')).toBe('');

		// getSiblingNovelsInSeries
		const siblingsA = await manager.getSiblingNovelsInSeries('NovelA');
		expect(siblingsA.map(s => s.folderPath)).toEqual(['NovelB']);

		const siblingsC = await manager.getSiblingNovelsInSeries('NovelC');
		expect(siblingsC).toEqual([]);

		// Update series on NovelA to clear membership
		await manager.updateNovelSeries('NovelA', '');
		const membersAfterClear = await manager.getSeriesNovels('星际编年史');
		expect(membersAfterClear.map(m => m.folderPath)).toEqual(['NovelB']);

		// Clearing membership must not delete files
		expect(files.has('NovelA/作品信息.md')).toBe(true);
	});

	it('should preserve CRLF line endings, untouched content, and leading indentation', () => {
		const { app } = createMockApp();
		const plugin = {
			app,
			settings: { workspaceFolders: [] }
		} as unknown as WebNovelAssistantPlugin;
		const manager = new HomepageManager(app, plugin);

		const crlfOriginal = [
			'  **系列**：旧系列名称',
			'**状态**：连载中',
			'**简介**：保持不变的内容',
			'',
			'## 大纲设定',
			'- 章节一：起飞',
			'- 章节二：降落',
			''
		].join('\r\n');

		// 1. Update series preserving CRLF and indentation
		const updated = manager.applySeriesToContent(crlfOriginal, '新系列名称');
		expect(updated).not.toContain('\r\r');
		expect(updated.includes('\r\n')).toBe(true);
		expect(updated.replace(/\r\n/g, '')).not.toContain('\n'); // Ensure no naked LFs
		expect(updated.startsWith('  **系列**：新系列名称\r\n')).toBe(true);
		expect(updated).toContain('\r\n## 大纲设定\r\n- 章节一：起飞\r\n- 章节二：降落\r\n');

		// 2. Clear series on CRLF content preserving CRLF and indentation
		const cleared = manager.applySeriesToContent(updated, '');
		expect(cleared.startsWith('  **系列**：\r\n')).toBe(true);
		expect(cleared.replace(/\r\n/g, '')).not.toContain('\n');
		expect(cleared).toContain('\r\n## 大纲设定\r\n');

		// 3. Insert series into CRLF content lacking series line
		const crlfLegacy = [
			'  **状态**：连载中',
			'  **简介**：老作品内容',
			'',
			'正文大纲'
		].join('\r\n');
		const inserted = manager.applySeriesToContent(crlfLegacy, '新插入系列');
		expect(inserted.startsWith('  **系列**：新插入系列\r\n')).toBe(true);
		expect(inserted.replace(/\r\n/g, '')).not.toContain('\n');
		expect(inserted).toContain('\r\n  **状态**：连载中\r\n');
	});

	it('should perform a strict no-op when clearing a legacy file with no series line', () => {
		const { app } = createMockApp();
		const plugin = {
			app,
			settings: { workspaceFolders: [] }
		} as unknown as WebNovelAssistantPlugin;
		const manager = new HomepageManager(app, plugin);

		// LF legacy content without series line
		const legacyLf = [
			'**状态**：连载中',
			'**简介**：无系列老作品',
			'',
			'## 独立内容',
			'完全不应该被修改'
		].join('\n');
		const resultLf = manager.applySeriesToContent(legacyLf, '');
		expect(resultLf).toBe(legacyLf);

		// CRLF legacy content without series line
		const legacyCrlf = [
			'**状态**：连载中',
			'**简介**：无系列老作品',
			'',
			'## 独立内容',
			'完全不应该被修改'
		].join('\r\n');
		const resultCrlf = manager.applySeriesToContent(legacyCrlf, '');
		expect(resultCrlf).toBe(legacyCrlf);
	});

	it('should accurately recognize novel folders within workspace scope only', () => {
		const initialFiles: Record<string, string> = {
			'WorkspaceA/Novel1/作品信息.md': '**状态**：连载中',
			'WorkspaceA/Novel1/第1章.md': '第一章正文',
			'WorkspaceA/NotANovel/第1章.md': '无作品信息文件',
			'OutsideWorkspace/Novel2/作品信息.md': '**状态**：连载中',
			'WorkspaceA/_template/作品信息.md': '**状态**：连载中',
			'WorkspaceA/.hidden/作品信息.md': '**状态**：连载中',
		};
		const { app } = createMockApp(initialFiles);

		const plugin = {
			app,
			settings: {
				workspaceFolders: ['WorkspaceA']
			}
		} as unknown as WebNovelAssistantPlugin;
		const manager = new HomepageManager(app, plugin);

		// Recognized novel folder inside workspace
		expect(manager.isRecognizedNovelFolder('WorkspaceA/Novel1')).toBe(true);

		// Folder without novel info file
		expect(manager.isRecognizedNovelFolder('WorkspaceA/NotANovel')).toBe(false);

		// Folder with novel info file but OUTSIDE workspace scope
		expect(manager.isRecognizedNovelFolder('OutsideWorkspace/Novel2')).toBe(false);

		// Hidden / helper folders starting with _ or .
		expect(manager.isRecognizedNovelFolder('WorkspaceA/_template')).toBe(false);
		expect(manager.isRecognizedNovelFolder('WorkspaceA/.hidden')).toBe(false);

		// Root folder
		expect(manager.isRecognizedNovelFolder('')).toBe(false);
	});

	function createRealisticCharacterManager(manager: HomepageManager) {
		const bookToSeriesMap = new Map<string, string>();
		let notificationCount = 0;

		return {
			bookToSeriesMap,
			get notificationCount() {
				return notificationCount;
			},
			refreshSeriesMembership: vi.fn().mockImplementation(async (targets?: string | string[]) => {
				const booksToCheck = new Set<string>();
				if (targets !== undefined) {
					const list = Array.isArray(targets) ? targets : [targets];
					for (const b of list) {
						const norm = (!b || b === '/') ? '/' : b.replace(/^\/+|\/+$/g, '');
						if (norm) {
							booksToCheck.add(norm);
							const prefix = `${norm}/`;
							for (const known of bookToSeriesMap.keys()) {
								if (known.startsWith(prefix)) {
									booksToCheck.add(known);
								}
							}
						}
					}
				} else {
					for (const b of bookToSeriesMap.keys()) {
						booksToCheck.add(b);
					}
					for (const folder of manager.getNovelFolders()) {
						booksToCheck.add(folder.folderPath.replace(/^\/+|\/+$/g, ''));
					}
				}

				let hasChanged = false;
				for (const book of booksToCheck) {
					const oldSeries = bookToSeriesMap.get(book) ?? '';
					const freshSeries = await manager.getNovelSeries(book);
					if (freshSeries !== oldSeries) {
						hasChanged = true;
						if (freshSeries) {
							bookToSeriesMap.set(book, freshSeries);
						} else {
							bookToSeriesMap.delete(book);
						}
					}
				}

				if (hasChanged) {
					notificationCount++;
					return true;
				}
				return false;
			})
		};
	}

	it('should serialize and coalesce membership refreshes with consistent final state and no duplicate notifications', async () => {
		const initialFiles: Record<string, string> = {
			'NovelA/作品信息.md': '**系列**：系列一\n**状态**：连载中',
			'NovelB/作品信息.md': '**系列**：系列一\n**状态**：连载中'
		};
		const { app } = createMockApp(initialFiles);

		let characterManagerStub: ReturnType<typeof createRealisticCharacterManager>;
		const plugin = {
			app,
			settings: {
				workspaceFolders: ['NovelA', 'NovelB']
			},
			get characterManager() {
				return characterManagerStub;
			}
		} as unknown as WebNovelAssistantPlugin;

		const manager = new HomepageManager(app, plugin);
		characterManagerStub = createRealisticCharacterManager(manager);

		// Initialize stub with current disk state
		await manager.refreshSeriesMembership();
		expect(characterManagerStub.bookToSeriesMap.get('NovelA')).toBe('系列一');
		expect(characterManagerStub.bookToSeriesMap.get('NovelB')).toBe('系列一');
		expect(characterManagerStub.notificationCount).toBe(1);

		// Rapid sequenced calls: two identical refreshes and one series update
		const p1 = manager.refreshSeriesMembership('NovelA');
		const p2 = manager.refreshSeriesMembership('NovelA');
		const p3 = manager.updateNovelSeries('NovelA', '系列二');

		await Promise.all([p1, p2, p3]);

		// Final series on disk and cache is 系列二
		expect(await manager.getNovelSeries('NovelA')).toBe('系列二');
		expect(characterManagerStub.bookToSeriesMap.get('NovelA')).toBe('系列二');
		// NovelB was untouched and remains 系列一
		expect(characterManagerStub.bookToSeriesMap.get('NovelB')).toBe('系列一');
		// p1 & p2 saw no change from 系列一; only p3 caused an effective series change
		expect(characterManagerStub.notificationCount).toBe(2);
	});

	it('should invalidate metadata cache and update series membership on novel info create, modify, rename, and delete', async () => {
		const initialFiles: Record<string, string> = {
			'NovelA/作品信息.md': '**系列**：旧系列\n**状态**：连载中'
		};
		const { app, files } = createMockApp(initialFiles);

		const events: Record<string, (arg1: unknown, arg2?: unknown) => void> = {};
		(app.vault as unknown as { on: (evt: string, cb: (arg1: unknown, arg2?: unknown) => void) => EventRef }).on = (
			evt: string,
			cb: (arg1: unknown, arg2?: unknown) => void
		): EventRef => {
			events[evt] = cb;
			return {} as unknown as EventRef;
		};

		let characterManagerStub: ReturnType<typeof createRealisticCharacterManager>;
		const plugin = {
			app,
			settings: { workspaceFolders: ['NovelA', 'NovelB', 'NovelNew', 'NovelRenamed'] },
			registerEvent: vi.fn(),
			get characterManager() {
				return characterManagerStub;
			}
		} as unknown as WebNovelAssistantPlugin;

		const manager = new HomepageManager(app, plugin);
		characterManagerStub = createRealisticCharacterManager(manager);

		// Baseline
		await manager.refreshSeriesMembership('NovelA');
		expect(characterManagerStub.bookToSeriesMap.get('NovelA')).toBe('旧系列');
		expect(characterManagerStub.notificationCount).toBe(1);

		// 1. Create: add new novel file to disk map and trigger create event
		files.set('NovelNew/作品信息.md', '**系列**：新系列\n**状态**：连载中');
		const fileNew = Object.assign(Object.create(TFile.prototype), {
			path: 'NovelNew/作品信息.md',
			name: '作品信息.md',
			basename: '作品信息',
			extension: 'md',
			parent: { path: 'NovelNew' }
		}) as TFile;
		events['create']?.(fileNew);
		await manager.refreshSeriesMembership('NovelNew');

		expect(await manager.getNovelSeries('NovelNew')).toBe('新系列');
		expect(characterManagerStub.bookToSeriesMap.get('NovelNew')).toBe('新系列');
		expect(characterManagerStub.notificationCount).toBe(2);

		// No duplicate notification if modify event fires without actual series change
		events['modify']?.(fileNew);
		await manager.refreshSeriesMembership('NovelNew');
		expect(characterManagerStub.notificationCount).toBe(2);

		// 2. Modify: change series on disk and trigger modify event
		files.set('NovelA/作品信息.md', '**系列**：修改后系列\n**状态**：连载中');
		const fileA = app.vault.getAbstractFileByPath('NovelA/作品信息.md') as TFile;
		events['modify']?.(fileA);
		const metadataCache = (manager as unknown as { metadataCache: Map<string, unknown> }).metadataCache;
		expect(metadataCache.has('NovelA')).toBe(false);
		await manager.refreshSeriesMembership('NovelA');

		expect(await manager.getNovelSeries('NovelA')).toBe('修改后系列');
		expect(characterManagerStub.bookToSeriesMap.get('NovelA')).toBe('修改后系列');
		expect(characterManagerStub.notificationCount).toBe(3);

		// 3. Rename: move file in disk map from NovelA to NovelRenamed
		files.delete('NovelA/作品信息.md');
		files.set('NovelRenamed/作品信息.md', '**系列**：修改后系列\n**状态**：连载中');
		const fileRenamed = Object.assign(Object.create(TFile.prototype), {
			path: 'NovelRenamed/作品信息.md',
			name: '作品信息.md',
			basename: '作品信息',
			extension: 'md',
			parent: { path: 'NovelRenamed' }
		}) as TFile;
		events['rename']?.(fileRenamed, 'NovelA/作品信息.md');
		await manager.refreshSeriesMembership(['NovelA', 'NovelRenamed']);

		expect(await manager.getNovelSeries('NovelA')).toBe('');
		expect(await manager.getNovelSeries('NovelRenamed')).toBe('修改后系列');
		expect(characterManagerStub.bookToSeriesMap.has('NovelA')).toBe(false);
		expect(characterManagerStub.bookToSeriesMap.get('NovelRenamed')).toBe('修改后系列');
		expect(characterManagerStub.notificationCount).toBe(4);

		// 4. Delete: remove file from disk map and trigger delete event
		files.delete('NovelRenamed/作品信息.md');
		events['delete']?.(fileRenamed);
		await manager.refreshSeriesMembership('NovelRenamed');

		expect(await manager.getNovelSeries('NovelRenamed')).toBe('');
		expect(characterManagerStub.bookToSeriesMap.has('NovelRenamed')).toBe(false);
		expect(characterManagerStub.notificationCount).toBe(5);
	});

	it('should invalidate nested metadataCache keys and refresh descendant works on folder rename and delete', async () => {
		const initialFiles: Record<string, string> = {
			'Novels/Book1/作品信息.md': '**系列**：系列一\n**状态**：连载中',
			'Novels/Book2/作品信息.md': '**系列**：系列一\n**状态**：连载中'
		};
		const { app, files } = createMockApp(initialFiles);

		const events: Record<string, (arg1: unknown, arg2?: unknown) => void> = {};
		(app.vault as unknown as { on: (evt: string, cb: (arg1: unknown, arg2?: unknown) => void) => EventRef }).on = (
			evt: string,
			cb: (arg1: unknown, arg2?: unknown) => void
		): EventRef => {
			events[evt] = cb;
			return {} as unknown as EventRef;
		};

		let characterManagerStub: ReturnType<typeof createRealisticCharacterManager>;
		const plugin = {
			app,
			settings: { workspaceFolders: ['Novels', 'NewNovels'] },
			registerEvent: vi.fn(),
			get characterManager() {
				return characterManagerStub;
			}
		} as unknown as WebNovelAssistantPlugin;

		const manager = new HomepageManager(app, plugin);
		characterManagerStub = createRealisticCharacterManager(manager);

		// Warm up metadata cache with nested keys
		const meta1 = await manager.getNovelMetadata('Novels/Book1');
		expect(meta1?.series).toBe('系列一');
		const internalCache = (manager as unknown as { metadataCache: Map<string, unknown> }).metadataCache;
		expect(internalCache.has('Novels/Book1')).toBe(true);

		// 1. Folder rename from Novels to NewNovels
		files.delete('Novels/Book1/作品信息.md');
		files.delete('Novels/Book2/作品信息.md');
		files.set('NewNovels/Book1/作品信息.md', '**系列**：系列一\n**状态**：连载中');
		files.set('NewNovels/Book2/作品信息.md', '**系列**：系列一\n**状态**：连载中');

		const folderNew = Object.assign(Object.create(TFolder.prototype), {
			path: 'NewNovels',
			name: 'NewNovels',
			isRoot: () => false,
			children: []
		}) as TFolder;

		// Trigger folder rename event
		events['rename']?.(folderNew, 'Novels');
		// The event promptly invalidates all metadata cache including nested keys
		expect(internalCache.has('Novels/Book1')).toBe(false);

		await manager.refreshSeriesMembership();
		expect(await manager.getNovelSeries('Novels/Book1')).toBe('');
		expect(await manager.getNovelSeries('NewNovels/Book1')).toBe('系列一');
		expect(characterManagerStub.bookToSeriesMap.has('Novels/Book1')).toBe(false);
		expect(characterManagerStub.bookToSeriesMap.get('NewNovels/Book1')).toBe('系列一');

		// 2. Folder delete: warm up cache for NewNovels/Book1 first
		await manager.getNovelMetadata('NewNovels/Book1');
		expect(internalCache.has('NewNovels/Book1')).toBe(true);

		files.delete('NewNovels/Book1/作品信息.md');
		files.delete('NewNovels/Book2/作品信息.md');
		events['delete']?.(folderNew);
		expect(internalCache.has('NewNovels/Book1')).toBe(false);

		await manager.refreshSeriesMembership();
		expect(await manager.getNovelSeries('NewNovels/Book1')).toBe('');
		expect(characterManagerStub.bookToSeriesMap.has('NewNovels/Book1')).toBe(false);
	});

	it('should reject awaited direct calls on refresh failure while keeping subsequent refreshes usable and handling vault events', async () => {
		const initialFiles: Record<string, string> = {
			'NovelA/作品信息.md': '**系列**：旧系列\n**状态**：连载中'
		};
		const { app, files } = createMockApp(initialFiles);

		const events: Record<string, (arg1: unknown, arg2?: unknown) => void> = {};
		(app.vault as unknown as { on: (evt: string, cb: (arg1: unknown, arg2?: unknown) => void) => EventRef }).on = (
			evt: string,
			cb: (arg1: unknown, arg2?: unknown) => void
		): EventRef => {
			events[evt] = cb;
			return {} as unknown as EventRef;
		};

		const mockRefresh = vi.fn();
		const plugin = {
			app,
			settings: { workspaceFolders: ['NovelA'] },
			registerEvent: vi.fn(),
			characterManager: {
				refreshSeriesMembership: mockRefresh
			}
		} as unknown as WebNovelAssistantPlugin;

		const manager = new HomepageManager(app, plugin);

		// 1. Awaited direct call rejects when CharacterManager fails
		mockRefresh.mockRejectedValueOnce(new Error('CharacterManager sync failed'));
		await expect(manager.updateNovelSeries('NovelA', '失败系列')).rejects.toThrow('CharacterManager sync failed');

		// 2. Future refreshes remain usable after failure
		mockRefresh.mockResolvedValueOnce(true);
		await expect(manager.updateNovelSeries('NovelA', '成功系列')).resolves.toBeUndefined();
		expect(await manager.getNovelSeries('NovelA')).toBe('成功系列');

		// 3. Vault event catches background error without unhandled rejection
		mockRefresh.mockRejectedValueOnce(new Error('Background vault sync failed'));
		files.set('NovelA/作品信息.md', '**系列**：事件系列\n**状态**：连载中');
		const fileA = app.vault.getAbstractFileByPath('NovelA/作品信息.md') as TFile;
		expect(() => events['modify']?.(fileA)).not.toThrow();

		// Wait for the background vault event promise to settle and catch
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Subsequent direct refresh succeeds
		mockRefresh.mockResolvedValueOnce(true);
		await expect(manager.refreshSeriesMembership('NovelA')).resolves.toBeUndefined();
		expect(await manager.getNovelSeries('NovelA')).toBe('事件系列');
	});
});
