import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { CharacterManager } from '../../src/services/CharacterManager';
import { RelationGraphManager } from '../../src/services/RelationGraphManager';
import type { WebNovelAssistantPlugin } from '../../src/types/plugin';
import type { AccurateCountSettings } from '../../src/types/settings';

function createMockAppAndVault(initialFiles: Record<string, string> = {}) {
	const fileMap = new Map<string, string>();
	const folderCache = new Map<string, TFolder>();

	function getOrCreateFolder(folderPath: string): TFolder {
		const norm = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		if (folderCache.has(norm)) return folderCache.get(norm)!;

		const name = norm ? (norm.split('/').pop() || norm) : '';
		const folder = Object.assign(new TFolder(), { name, path: norm });
		folderCache.set(norm, folder);

		if (norm !== '') {
			const lastSlash = norm.lastIndexOf('/');
			const parentPath = lastSlash !== -1 ? norm.substring(0, lastSlash) : '';
			const parentFolder = getOrCreateFolder(parentPath);
			folder.parent = parentFolder;
			if (!parentFolder.children.includes(folder)) {
				parentFolder.children.push(folder);
			}
		}
		return folder;
	}

	function getOrCreateFile(filePath: string): TFile {
		const norm = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
		const name = norm.split('/').pop() || norm;
		const file = Object.assign(new TFile(), { name, path: norm, basename: (name.split('/').pop() || name).replace(/\.md$/, ''), extension: 'md' });
		const lastSlash = norm.lastIndexOf('/');
		const parentPath = lastSlash !== -1 ? norm.substring(0, lastSlash) : '';
		const parentFolder = getOrCreateFolder(parentPath);
		file.parent = parentFolder;
		if (!parentFolder.children.includes(file)) {
			parentFolder.children.push(file);
		}
		return file;
	}

	// Initialize root
	getOrCreateFolder('');

	for (const [path, content] of Object.entries(initialFiles)) {
		const norm = path.replace(/\\/g, '/').replace(/^\/+/, '');
		fileMap.set(norm, content);
		getOrCreateFile(norm);
	}

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => {
				const norm = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
				if (fileMap.has(norm)) {
					return getOrCreateFile(norm);
				}
				if (folderCache.has(norm)) {
					return folderCache.get(norm)!;
				}
				const isFolder = Array.from(fileMap.keys()).some(k => k.startsWith(norm + '/'));
				if (isFolder || norm === '') {
					return getOrCreateFolder(norm);
				}
				return null;
			},
			cachedRead: async (file: TFile) => {
				return fileMap.get(file.path) ?? '';
			},
			read: async (file: TFile) => {
				return fileMap.get(file.path) ?? '';
			},
			append: async (file: TFile, toAppend: string) => {
				const current = fileMap.get(file.path) ?? '';
				fileMap.set(file.path, current + toAppend);
			},
			create: async (path: string, content: string) => {
				const norm = path.replace(/\\/g, '/').replace(/^\/+/, '');
				fileMap.set(norm, content);
				return getOrCreateFile(norm);
			},
			createFolder: async (path: string) => {
				const norm = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
				return getOrCreateFolder(norm);
			},
			delete: async (fileOrFolder: TFile | TFolder) => {
				const norm = fileOrFolder.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
				if (fileOrFolder instanceof TFile) {
					fileMap.delete(norm);
					if (fileOrFolder.parent) {
						const idx = fileOrFolder.parent.children.indexOf(fileOrFolder);
						if (idx !== -1) fileOrFolder.parent.children.splice(idx, 1);
					}
				} else if (fileOrFolder instanceof TFolder) {
					folderCache.delete(norm);
					for (const k of Array.from(fileMap.keys())) {
						if (k === norm || k.startsWith(norm + '/')) {
							fileMap.delete(k);
						}
					}
					if (fileOrFolder.parent) {
						const idx = fileOrFolder.parent.children.indexOf(fileOrFolder);
						if (idx !== -1) fileOrFolder.parent.children.splice(idx, 1);
					}
				}
			},
			getRoot: () => {
				return getOrCreateFolder('');
			}
		},
		fileManager: {
			renameFile: async (fileOrFolder: TFile | TFolder, newPath: string) => {
				const oldNorm = fileOrFolder.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
				const newNorm = newPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
				const newName = newNorm.split('/').pop() || newNorm;

				if (fileOrFolder instanceof TFile) {
					const content = fileMap.get(oldNorm) ?? '';
					fileMap.delete(oldNorm);
					fileMap.set(newNorm, content);
					fileOrFolder.path = newNorm;
					fileOrFolder.name = newName;
					fileOrFolder.basename = newName.replace(/\.md$/, '');
					const lastSlash = newNorm.lastIndexOf('/');
					const parentPath = lastSlash !== -1 ? newNorm.substring(0, lastSlash) : '';
					const newParent = getOrCreateFolder(parentPath);
					if (fileOrFolder.parent && fileOrFolder.parent !== newParent) {
						const idx = fileOrFolder.parent.children.indexOf(fileOrFolder);
						if (idx !== -1) fileOrFolder.parent.children.splice(idx, 1);
					}
					fileOrFolder.parent = newParent;
					if (!newParent.children.includes(fileOrFolder)) {
						newParent.children.push(fileOrFolder);
					}
				} else if (fileOrFolder instanceof TFolder) {
					folderCache.delete(oldNorm);
					fileOrFolder.path = newNorm;
					fileOrFolder.name = newName;
					folderCache.set(newNorm, fileOrFolder);

					for (const [k, v] of Array.from(fileMap.entries())) {
						if (k.startsWith(oldNorm + '/')) {
							const suffix = k.slice(oldNorm.length);
							fileMap.delete(k);
							fileMap.set(newNorm + suffix, v);
						}
					}
					const updateChildPaths = (f: TFolder) => {
						for (const child of f.children) {
							const cName = child.name;
							const cNewPath = f.path ? `${f.path}/${cName}` : cName;
							child.path = cNewPath;
							if (child instanceof TFolder) {
								updateChildPaths(child);
							}
						}
					};
					updateChildPaths(fileOrFolder);

					const lastSlash = newNorm.lastIndexOf('/');
					const parentPath = lastSlash !== -1 ? newNorm.substring(0, lastSlash) : '';
					const newParent = getOrCreateFolder(parentPath);
					if (fileOrFolder.parent && fileOrFolder.parent !== newParent) {
						const idx = fileOrFolder.parent.children.indexOf(fileOrFolder);
						if (idx !== -1) fileOrFolder.parent.children.splice(idx, 1);
					}
					fileOrFolder.parent = newParent;
					if (!newParent.children.includes(fileOrFolder)) {
						newParent.children.push(fileOrFolder);
					}
				}
			},
			trashFile: async (fileOrFolder: TFile | TFolder) => {
				const norm = fileOrFolder.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
				if (fileOrFolder instanceof TFile) {
					fileMap.delete(norm);
					if (fileOrFolder.parent) {
						const idx = fileOrFolder.parent.children.indexOf(fileOrFolder);
						if (idx !== -1) fileOrFolder.parent.children.splice(idx, 1);
					}
				} else if (fileOrFolder instanceof TFolder) {
					folderCache.delete(norm);
					for (const k of Array.from(fileMap.keys())) {
						if (k === norm || k.startsWith(norm + '/')) {
							fileMap.delete(k);
						}
					}
					if (fileOrFolder.parent) {
						const idx = fileOrFolder.parent.children.indexOf(fileOrFolder);
						if (idx !== -1) fileOrFolder.parent.children.splice(idx, 1);
					}
				}
			}
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const content = fileMap.get(file.path) || '';
				const lines = content.split('\n');
				const headings: Array<{ heading: string; level: number; position: { start: { line: number }; end: { line: number } } }> = [];
				for (let i = 0; i < lines.length; i++) {
					const match = lines[i].match(/^##\s+(.+)$/);
					if (match) {
						headings.push({
							heading: match[1].trim(),
							level: 2,
							position: { start: { line: i }, end: { line: i } }
						});
					}
				}
				return { headings };
			},
			fileToLinktext: (targetFile: TFile, _sourcePath: string) => {
				return targetFile.basename;
			}
		},
		workspace: {
			iterateAllLeaves: vi.fn(),
			trigger: vi.fn(),
			updateOptions: vi.fn()
		}
	} as unknown as App;

	return { app, fileMap, getOrCreateFile, getOrCreateFolder };
}

describe('SeriesLoreSharing - Same-Series Public Lore Subfolders', () => {
	let app: App;
	let fileMap: Map<string, string>;
	let getOrCreateFile: (p: string) => TFile;
	let getOrCreateFolder: (p: string) => TFolder;
	let plugin: WebNovelAssistantPlugin;
	let manager: CharacterManager;
	let seriesMetaMap: Record<string, string>;

	beforeEach(() => {
		seriesMetaMap = {
			NovelA: '三体宇宙',
			NovelB: '三体宇宙',
			NovelC: '三体宇宙',
			SoloNovel: ''
		};

		const files: Record<string, string> = {
			'NovelA/作品信息.md': '**系列**：三体宇宙\n',
			'NovelB/作品信息.md': '**系列**：三体宇宙\n',
			'NovelC/作品信息.md': '**系列**：三体宇宙\n',
			'SoloNovel/作品信息.md': '**系列**：\n',

			// NovelA lore: local private + local public series
			'NovelA/设定/私有设定.md': '## 汪淼\n**别名**：汪院士\n物理学家纳米材料\n',
			'NovelA/设定/系列/公共人物.md': '## 丁仪\n**别名**：六分仪\n理论物理学家\n## 冲突人物\n**别名**：NovelA版\n来自NovelA的设定\n',

			// NovelB lore: local private + local public series
			'NovelB/设定/私有秘籍.md': '## 罗辑\n**别名**：面壁者\n社会学教授\n',
			'NovelB/设定/系列/舰队.md': '## 自然选择号\n**别名**：战舰\n恒星级战舰\n',
			'NovelB/设定/系列/公共人物.md': '## 冲突人物\n**别名**：NovelB版\n来自NovelB的设定\n',

			// SoloNovel lore
			'SoloNovel/设定/独占.md': '## 独占角色\n独立小说独有\n'
		};

		const setup = createMockAppAndVault(files);
		app = setup.app;
		fileMap = setup.fileMap;
		getOrCreateFile = setup.getOrCreateFile;
		getOrCreateFolder = setup.getOrCreateFolder;

		const mockSettings = {
			loreFolderName: '设定',
			seriesLoreFolderName: '系列',
			workspaceFolders: []
		} as unknown as AccurateCountSettings;

		plugin = {
			settings: mockSettings,
			homepageManager: {
				getNovelFolders: () => [
					{ folderPath: 'NovelA', title: 'NovelA' },
					{ folderPath: 'NovelB', title: 'NovelB' },
					{ folderPath: 'NovelC', title: 'NovelC' },
					{ folderPath: 'SoloNovel', title: 'SoloNovel' }
				],
				getNovelMetadata: async (folderPath: string) => {
					const series = seriesMetaMap[folderPath] ?? '';
					return { series };
				}
			},
			registerEvent: vi.fn(),
			getTrackedMarkdownFiles: () => {
				const mdFiles: TFile[] = [];
				for (const path of fileMap.keys()) {
					if (path.endsWith('.md')) {
						const f = app.vault.getAbstractFileByPath(path);
						if (f instanceof TFile) mdFiles.push(f);
					}
				}
				return mdFiles;
			},
			getVaultMarkdownFiles: () => {
				const mdFiles: TFile[] = [];
				for (const path of fileMap.keys()) {
					if (path.endsWith('.md')) {
						const f = app.vault.getAbstractFileByPath(path);
						if (f instanceof TFile) mdFiles.push(f);
					}
				}
				return mdFiles;
			}
		} as unknown as WebNovelAssistantPlugin;

		manager = new CharacterManager(app, plugin);
		plugin.characterManager = manager;
		plugin.relationGraphManager = new RelationGraphManager(app, plugin);
	});

	it('should strictly isolate public series lore and private lore across same-series members', async () => {
		await manager.rebuildCache();

		// NovelA should see:
		// 1. Its own private lore: 汪淼
		// 2. Its own series lore: 丁仪
		// 3. NovelB's public series lore: 自然选择号
		// NovelA should NEVER see NovelB's private lore: 罗辑
		expect(manager.getCharacterFile('NovelA', '汪淼')).not.toBeNull();
		expect(manager.getCharacterFile('NovelA', '丁仪')).not.toBeNull();
		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();
		expect(manager.getCharacterFile('NovelA', '罗辑')).toBeNull();

		// NovelB should see:
		// 1. Its own private lore: 罗辑
		// 2. Its own series lore: 自然选择号
		// 3. NovelA's public series lore: 丁仪
		// NovelB should NEVER see NovelA's private lore: 汪淼
		expect(manager.getCharacterFile('NovelB', '罗辑')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '自然选择号')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '丁仪')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '汪淼')).toBeNull();

		// SoloNovel (not in series) should NOT see any shared lore from NovelA or NovelB
		expect(manager.getCharacterFile('SoloNovel', '独占角色')).not.toBeNull();
		expect(manager.getCharacterFile('SoloNovel', '丁仪')).toBeNull();
		expect(manager.getCharacterFile('SoloNovel', '自然选择号')).toBeNull();
	});

	it('should preserve local lore priority and deterministic sibling ordering without silent merging on collisions', async () => {
		await manager.rebuildCache();

		// NovelA has '冲突人物' locally in NovelA/设定/系列/公共人物.md (NovelA版)
		// NovelB has '冲突人物' in NovelB/设定/系列/公共人物.md (NovelB版)
		const entryA = manager.getCharacterFile('NovelA', '冲突人物');
		expect(entryA).not.toBeNull();
		expect(entryA?.file.path).toBe('NovelA/设定/系列/公共人物.md');

		// NovelB should resolve its own local version first!
		const entryB = manager.getCharacterFile('NovelB', '冲突人物');
		expect(entryB).not.toBeNull();
		expect(entryB?.file.path).toBe('NovelB/设定/系列/公共人物.md');
	});

	it('should allow a member novel with NO local lore folder to access shared series lore', async () => {
		// NovelC has no '设定' folder at all
		await manager.rebuildCache();

		expect(manager.findLoreFolder('NovelC')).toBeNull();

		// But NovelC is in '三体宇宙' series, so it should access public series entries from NovelA and NovelB
		const ding = manager.getCharacterFile('NovelC', '丁仪');
		const ship = manager.getCharacterFile('NovelC', '自然选择号');
		expect(ding).not.toBeNull();
		expect(ding?.file.path).toBe('NovelA/设定/系列/公共人物.md');
		expect(ship).not.toBeNull();
		expect(ship?.file.path).toBe('NovelB/设定/系列/舰队.md');

		// In file order, NovelC gets all shared series lore
		const entriesC = manager.getLoreEntriesInFileOrder('NovelC');
		const headingsC = entriesC.map(e => e.heading);
		expect(headingsC).toContain('丁仪');
		expect(headingsC).toContain('自然选择号');
		expect(headingsC).not.toContain('汪淼'); // private to NovelA
		expect(headingsC).not.toContain('罗辑'); // private to NovelB
	});

	it('should return available categories annotated with source book name for duplicates in getAvailableLoreCategories', async () => {
		await manager.rebuildCache();

		const categoriesForA = await manager.getAvailableLoreCategories('NovelA');

		// NovelA has local '私有设定.md' (relPath: '私有设定')
		// NovelA has local '系列/公共人物.md' (relPath: '系列/公共人物')
		// NovelB has borrowed '系列/舰队.md' (relPath: '系列/舰队')
		// NovelB has borrowed '系列/公共人物.md' (relPath: '系列/公共人物') -> duplicate relPath!
		const duplicateA = categoriesForA.find(c => c.id === 'NovelA/设定/系列/公共人物.md');
		const duplicateB = categoriesForA.find(c => c.id === 'NovelB/设定/系列/公共人物.md');
		const borrowedFleet = categoriesForA.find(c => c.id === 'NovelB/设定/系列/舰队.md');

		expect(duplicateA).toBeDefined();
		expect(duplicateB).toBeDefined();
		expect(borrowedFleet).toBeDefined();

		// Because '系列/公共人物' is duplicated, both should have source book annotation
		expect(duplicateA?.displayName).toBe('系列/公共人物 (NovelA)');
		expect(duplicateB?.displayName).toBe('系列/公共人物 (NovelB)');
		expect(duplicateA?.isBorrowed).toBe(false);
		expect(duplicateB?.isBorrowed).toBe(true);

		// Borrowed non-duplicate category also indicates source
		expect(borrowedFleet?.displayName).toBe('系列/舰队 (NovelB)');
		expect(borrowedFleet?.isBorrowed).toBe(true);
	});

	it('should validate save destinations strictly in validateLoreSaveDestination', async () => {
		await manager.rebuildCache();

		// 1. Current work private lore: VALID
		const res1 = await manager.validateLoreSaveDestination('NovelA', 'NovelA/设定/私有设定.md');
		expect(res1.valid).toBe(true);

		// 2. Sibling work public series lore: VALID
		const res2 = await manager.validateLoreSaveDestination('NovelA', 'NovelB/设定/系列/公共人物.md');
		expect(res2.valid).toBe(true);

		// 3. Sibling work private lore: INVALID (Strict security boundary)
		const res3 = await manager.validateLoreSaveDestination('NovelA', 'NovelB/设定/私有秘籍.md');
		expect(res3.valid).toBe(false);

		// 4. Cross-series or outside series: INVALID
		const res4 = await manager.validateLoreSaveDestination('NovelA', 'SoloNovel/设定/独占.md');
		expect(res4.valid).toBe(false);

		// 5. Work not in series trying to write to another work: INVALID
		const res5 = await manager.validateLoreSaveDestination('SoloNovel', 'NovelA/设定/系列/公共人物.md');
		expect(res5.valid).toBe(false);
	});

	it('should append directly to the actual shared category file when targetFilePath is provided without creating a duplicate local file', async () => {
		await manager.rebuildCache();

		const sharedFilePath = 'NovelB/设定/系列/公共人物.md';

		const success = await manager.createLoreEntry(
			'NovelA',
			'系列/公共人物',
			'杨冬',
			'冬冬',
			'物理学家',
			'理论物理学家杨冬',
			[
				{ label: '师从', target: '丁仪' },
				{ label: '关联', target: '冲突人物' }
			],
			sharedFilePath
		);

		expect(success).toBe(true);

		// Target file in NovelB must contain the appended entry
		const updatedContent = fileMap.get(sharedFilePath) || '';
		expect(updatedContent).toContain('## 杨冬');
		expect(updatedContent).toContain('**别名**：冬冬');
		// Cross-file relation to NovelA's 丁仪
		expect(updatedContent).toContain('**师从**：[[公共人物#丁仪|丁仪]]');
		// Cross-file relation to NovelA's local 冲突人物
		expect(updatedContent).toContain('**关联**：[[公共人物#冲突人物|冲突人物]]');

		// Crucial verification: NovelA should NOT have created a duplicate local file!
		expect(fileMap.has('NovelA/设定/系列/公共人物.md.md')).toBe(false);
		expect(fileMap.get('NovelA/设定/系列/公共人物.md')).not.toContain('## 杨冬');
	});

	it('should create local lore folder and file under current work when creating new category without targetFilePath', async () => {
		await manager.rebuildCache();

		// NovelC lacks a lore folder initially
		expect(manager.findLoreFolder('NovelC')).toBeNull();

		// Create a new private category in NovelC
		const success = await manager.createLoreEntry(
			'NovelC',
			'智子工程',
			'智子',
			'Sophon',
			'微观粒子',
			'三体人制造的微观计算机',
			[]
		);

		expect(success).toBe(true);

		// It should be created under NovelC/设定/智子工程.md
		const newFilePath = 'NovelC/设定/智子工程.md';
		expect(fileMap.has(newFilePath)).toBe(true);
		expect(fileMap.get(newFilePath)).toContain('## 智子');

		// And NovelA (same series) should NOT see it because it's private lore!
		await manager.rebuildCache();
		expect(manager.getCharacterFile('NovelA', '智子')).toBeNull();
	});

	it('should react immediately without restart when series membership changes', async () => {
		await manager.rebuildCache();

		// Initially NovelA sees NovelB's public series lore
		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();

		// Now NovelB is removed from the series
		seriesMetaMap['NovelB'] = '';
		await manager.rebuildCache();

		// NovelA should immediately no longer see NovelB's lore
		expect(manager.getCharacterFile('NovelA', '自然选择号')).toBeNull();

		// Put NovelB back into series
		seriesMetaMap['NovelB'] = '三体宇宙';
		await manager.rebuildCache();
		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();
	});

	it('should react immediately when seriesLoreFolderName setting is changed', async () => {
		await manager.rebuildCache();
		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();

		// Change series lore folder name to 'SharedUniverse'
		plugin.settings.seriesLoreFolderName = 'SharedUniverse';

		// Rename NovelB's folder on disk to match new setting
		const oldContent = fileMap.get('NovelB/设定/系列/舰队.md')!;
		fileMap.delete('NovelB/设定/系列/舰队.md');
		fileMap.set('NovelB/设定/SharedUniverse/舰队.md', oldContent);
		getOrCreateFile('NovelB/设定/SharedUniverse/舰队.md');

		await manager.rebuildCache();

		// NovelA should still successfully resolve from the new folder name!
		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();
	});

	it('should immediately exclude former series member in getAvailableLoreCategories and save validation without waiting for cache rebuild', async () => {
		await manager.rebuildCache();

		// Initially NovelB is in the series, NovelA sees NovelB's categories
		const categoriesBefore = await manager.getAvailableLoreCategories('NovelA');
		expect(categoriesBefore.some(c => c.sourceBookPath === 'NovelB')).toBe(true);

		// Now NovelB leaves the series (metadata changes in HomepageManager)
		seriesMetaMap['NovelB'] = '';

		// WITHOUT calling rebuildCache(), getAvailableLoreCategories must immediately exclude NovelB!
		const categoriesAfter = await manager.getAvailableLoreCategories('NovelA');
		expect(categoriesAfter.some(c => c.sourceBookPath === 'NovelB')).toBe(false);

		// validateLoreSaveDestination must also reject saving to NovelB's lore
		const saveValidation = await manager.validateLoreSaveDestination('NovelA', 'NovelB/设定/系列/公共人物.md');
		expect(saveValidation.valid).toBe(false);
	});

	it('should build graph data for a member with no local lore using effective lore files with correct sourcePath', async () => {
		await manager.rebuildCache();

		// NovelC has NO local lore folder
		expect(manager.findLoreFolder('NovelC')).toBeNull();

		// But NovelC's effective lore files include NovelA's and NovelB's public series files
		const effectiveFiles = manager.getEffectiveLoreFiles('NovelC');
		expect(effectiveFiles.length).toBeGreaterThan(0);
		const effectivePaths = effectiveFiles.map(f => f.path);
		expect(effectivePaths).toContain('NovelA/设定/系列/公共人物.md');
		expect(effectivePaths).toContain('NovelB/设定/系列/舰队.md');

		// Build graph data using RelationGraphManager
		const graphData = await plugin.relationGraphManager.buildGraphData(effectiveFiles[0], {
			files: effectiveFiles,
			enableGlobal: false,
			autoLinkMentions: true
		});

		expect(graphData.nodes.length).toBeGreaterThan(0);
		const nodeIds = graphData.nodes.map(n => n.id);
		expect(nodeIds).toContain('丁仪');
		expect(nodeIds).toContain('自然选择号');

		// Each node MUST have sourcePath populated pointing to the correct file
		const dingNode = graphData.nodes.find(n => n.id === '丁仪');
		expect(dingNode).toBeDefined();
		expect(dingNode?.sourcePath).toBe('NovelA/设定/系列/公共人物.md');
		expect(dingNode?.file.path).toBe('NovelA/设定/系列/公共人物.md');

		const shipNode = graphData.nodes.find(n => n.id === '自然选择号');
		expect(shipNode).toBeDefined();
		expect(shipNode?.sourcePath).toBe('NovelB/设定/系列/舰队.md');
		expect(shipNode?.file.path).toBe('NovelB/设定/系列/舰队.md');
	});

	it('should safely rename public series lore subfolders and handle existing folder collisions without data loss', async () => {
		await manager.rebuildCache();

		// Create a pre-existing target folder with existing file in NovelA to test collision
		fileMap.set('NovelA/设定/SharedUniverse/既有设定.md', '## 既有角色\n内容\n');
		getOrCreateFile('NovelA/设定/SharedUniverse/既有设定.md');

		// Also put a colliding file name inside SharedUniverse
		fileMap.set('NovelA/设定/SharedUniverse/公共人物.md', '## 碰撞角色\n旧版本\n');
		getOrCreateFile('NovelA/设定/SharedUniverse/公共人物.md');

		// Execute rename: from '系列' to 'SharedUniverse'
		const result = await manager.renameAllSeriesLoreFolders('系列', 'SharedUniverse');
		expect(result.renamed).toBeGreaterThan(0);
		expect(result.failed).toBe(0);

		// 1. In NovelA (where collision happened):
		// - Pre-existing file is intact
		expect(fileMap.has('NovelA/设定/SharedUniverse/既有设定.md')).toBe(true);
		// - Colliding file is disambiguated and preserved without overwrite/data loss!
		expect(fileMap.has('NovelA/设定/SharedUniverse/公共人物.md')).toBe(true);
		expect(fileMap.has('NovelA/设定/SharedUniverse/公共人物 (1).md')).toBe(true);

		// 2. In NovelB (no collision):
		// - Folders successfully renamed to SharedUniverse
		expect(fileMap.has('NovelB/设定/SharedUniverse/舰队.md')).toBe(true);
		expect(fileMap.has('NovelB/设定/系列/舰队.md')).toBe(false);

		// 3. In NovelC (no lore folder):
		// - Did NOT create unnecessary folders
		expect(manager.findLoreFolder('NovelC')).toBeNull();

		// 4. Update setting and rebuild cache
		plugin.settings.seriesLoreFolderName = 'SharedUniverse';
		await manager.rebuildCache();

		// All series members should still see their data after rename
		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '丁仪')).not.toBeNull();

		// 5. Candidate fallback verification:
		// Now that seriesLoreFolderName is custom ('SharedUniverse'),
		// unrelated old '系列' folder must NOT be exposed as public series lore
		const customCandidates = Array.from(manager.getSeriesLoreCandidates());
		expect(customCandidates).toContain('SharedUniverse');
		expect(customCandidates).not.toContain('系列');
	});

	it('should safely merge nested subfolders when child directories collide, preserving all deep entries and effective view for siblings', async () => {
		await manager.rebuildCache();

		// 1. 在 NovelA/设定/系列 中设置多层嵌套子文件夹与设定文件
		fileMap.set('NovelA/设定/系列/势力/宗门.md', '## 青云门\n**别名**：青云宗\n修仙正派\n');
		getOrCreateFile('NovelA/设定/系列/势力/宗门.md');

		fileMap.set('NovelA/设定/系列/势力/深层/长老.md', '## 道玄真人\n掌门\n');
		getOrCreateFile('NovelA/设定/系列/势力/深层/长老.md');

		// 2. 在目标 SharedUniverse/势力 中预先创建既有文件夹与同名冲突文件
		fileMap.set('NovelA/设定/SharedUniverse/势力/既有势力.md', '## 焚香谷\n修仙正派\n');
		getOrCreateFile('NovelA/设定/SharedUniverse/势力/既有势力.md');

		fileMap.set('NovelA/设定/SharedUniverse/势力/宗门.md', '## 宗门旧版\n旧内容\n');
		getOrCreateFile('NovelA/设定/SharedUniverse/势力/宗门.md');

		// 重建缓存确保初始状态下同系列作品 NovelB 可通过旧路径查看
		await manager.rebuildCache();
		expect(manager.getCharacterFile('NovelB', '青云门')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '道玄真人')).not.toBeNull();

		// 3. 执行重命名迁移：'系列' -> 'SharedUniverse'（发生嵌套子目录与重名文件深度冲突）
		const result = await manager.renameAllSeriesLoreFolders('系列', 'SharedUniverse');
		expect(result.renamed).toBeGreaterThan(0);
		expect(result.failed).toBe(0);

		// 4. 校验物理文件系统状态：
		// - 目标已有文件完好保留
		expect(fileMap.has('NovelA/设定/SharedUniverse/势力/既有势力.md')).toBe(true);
		// - 冲突文件被安全重命名防冲突，两者兼存不丢失
		expect(fileMap.has('NovelA/设定/SharedUniverse/势力/宗门.md')).toBe(true);
		expect(fileMap.has('NovelA/设定/SharedUniverse/势力/宗门 (1).md')).toBe(true);
		// - 深层嵌套子文件夹及内部文件完整迁移至新位置
		expect(fileMap.has('NovelA/设定/SharedUniverse/势力/深层/长老.md')).toBe(true);

		// - 旧的空文件夹已被安全清理
		expect(fileMap.has('NovelA/设定/系列/势力/宗门.md')).toBe(false);
		expect(fileMap.has('NovelA/设定/系列/势力/深层/长老.md')).toBe(false);
		expect(app.vault.getAbstractFileByPath('NovelA/设定/系列/势力/深层')).toBeNull();
		expect(app.vault.getAbstractFileByPath('NovelA/设定/系列/势力')).toBeNull();
		expect(app.vault.getAbstractFileByPath('NovelA/设定/系列')).toBeNull();

		// 5. 更新配置为自定义公共系列名称并重建缓存
		plugin.settings.seriesLoreFolderName = 'SharedUniverse';
		await manager.rebuildCache();

		// 6. 核心回归验证：同系列作品 NovelB 的有效视图中，嵌套设定的公共条目绝不丢失/消失！
		expect(manager.getCharacterFile('NovelB', '青云门')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '道玄真人')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '焚香谷')).not.toBeNull();

		// 分类列表中必须能正常解析并呈现该嵌套分类
		const categoriesB = await manager.getAvailableLoreCategories('NovelB');
		expect(categoriesB.some(c => c.displayName.includes('宗门'))).toBe(true);
	});

	it('should handle file-vs-folder collision safely and retain all entries', async () => {
		await manager.rebuildCache();

		// 目标路径中存在名为 "公会" 的文件
		fileMap.set('NovelA/设定/SharedUniverse/公会', '文件占位内容');
		getOrCreateFile('NovelA/设定/SharedUniverse/公会');

		// 旧系列文件夹中存在名为 "公会" 的子文件夹
		fileMap.set('NovelA/设定/系列/公会/会长.md', '## 会长大人\n行会会长\n');
		getOrCreateFile('NovelA/设定/系列/公会/会长.md');

		await manager.rebuildCache();

		// 执行重命名
		const result = await manager.renameAllSeriesLoreFolders('系列', 'SharedUniverse');
		expect(result.renamed).toBeGreaterThan(0);

		// 文件夹被安全重命名为唯一文件夹名，内部文件完好保留
		expect(fileMap.has('NovelA/设定/SharedUniverse/公会 (1)/会长.md')).toBe(true);
		// 既有文件未被覆盖替换
		expect(fileMap.has('NovelA/设定/SharedUniverse/公会')).toBe(true);

		plugin.settings.seriesLoreFolderName = 'SharedUniverse';
		await manager.rebuildCache();
		// 同系列 NovelB 可正常访问该角色
		expect(manager.getCharacterFile('NovelB', '会长大人')).not.toBeNull();
	});

	it('should retain visibility of unmigrated entries if migration fails and not claim all renamed', async () => {
		await manager.rebuildCache();

		fileMap.set('NovelA/设定/系列/遗留.md', '## 遗留角色\n未迁移内容\n');
		getOrCreateFile('NovelA/设定/系列/遗留.md');

		// 模拟重命名底层异常
		const originalRename = app.fileManager.renameFile;
		app.fileManager.renameFile = vi.fn().mockRejectedValue(new Error('Simulated IO error'));

		try {
			const result = await manager.renameAllSeriesLoreFolders('系列', 'SharedUniverse');
			expect(result.failed).toBeGreaterThan(0);

			// 旧文件夹因未清空绝不被错误清理
			expect(fileMap.has('NovelA/设定/系列/遗留.md')).toBe(true);

			// 更新配置后重建缓存
			plugin.settings.seriesLoreFolderName = 'SharedUniverse';
			await manager.rebuildCache();

			// 未迁移候选保留在候选集合中，因此同系列小说 NovelB 依然能查找到遗留设定
			expect(manager.getCharacterFile('NovelB', '遗留角色')).not.toBeNull();
		} finally {
			app.fileManager.renameFile = originalRename;
		}
	});

	it('should ensure getAvailableLoreCategories does not mutate bookToSeriesMap', async () => {
		await manager.rebuildCache();

		const mapBefore = new Map((manager as unknown as { bookToSeriesMap: Map<string, string> }).bookToSeriesMap);
		await manager.getAvailableLoreCategories('NovelA');
		const mapAfter = new Map((manager as unknown as { bookToSeriesMap: Map<string, string> }).bookToSeriesMap);

		expect(mapAfter).toEqual(mapBefore);
	});

	it('should refresh membership on unchanged series without rereading lore files or triggering notifications', async () => {
		await manager.rebuildCache();

		const parseSpy = vi.spyOn(manager as unknown as { parseLoreFile: () => Promise<unknown> }, 'parseLoreFile');
		const triggerSpy = vi.spyOn(app.workspace, 'trigger');

		// Series for NovelA is unchanged ('三体宇宙')
		const changed = await manager.refreshSeriesMembership('NovelA');

		expect(changed).toBe(false);
		expect(parseSpy).not.toHaveBeenCalled();
		expect(triggerSpy).not.toHaveBeenCalled();
	});

	it('should update bookToSeriesMap and recompute effective caches from fileContributions on membership change', async () => {
		await manager.rebuildCache();

		expect(manager.getCharacterFile('NovelA', '自然选择号')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '丁仪')).not.toBeNull();

		const parseSpy = vi.spyOn(manager as unknown as { parseLoreFile: () => Promise<unknown> }, 'parseLoreFile');
		const triggerSpy = vi.spyOn(app.workspace, 'trigger');

		// NovelB leaves series
		seriesMetaMap['NovelB'] = '';

		const changed = await manager.refreshSeriesMembership('NovelB');

		expect(changed).toBe(true);
		expect(parseSpy).not.toHaveBeenCalled();
		expect(triggerSpy).toHaveBeenCalledOnce();

		// Effective caches recomputed: NovelA no longer sees NovelB lore, NovelB no longer sees NovelA lore
		expect(manager.getCharacterFile('NovelA', '自然选择号')).toBeNull();
		expect(manager.getCharacterFile('NovelB', '丁仪')).toBeNull();

		// Local private lore remains isolated and intact
		expect(manager.getCharacterFile('NovelA', '汪淼')).not.toBeNull();
		expect(manager.getCharacterFile('NovelB', '罗辑')).not.toBeNull();
	});

	it('should refresh both old and new folders when membership moves and notify observers once', async () => {
		await manager.rebuildCache();

		seriesMetaMap['NovelA'] = '';
		seriesMetaMap['NovelNew'] = '三体宇宙';

		const triggerSpy = vi.spyOn(app.workspace, 'trigger');

		const changed = await manager.refreshSeriesMembership(['NovelA', 'NovelNew']);

		expect(changed).toBe(true);
		expect(triggerSpy).toHaveBeenCalledOnce();

		const currentA = (manager as unknown as { bookToSeriesMap: Map<string, string> }).bookToSeriesMap.get('NovelA') ?? '';
		const currentNew = (manager as unknown as { bookToSeriesMap: Map<string, string> }).bookToSeriesMap.get('NovelNew') ?? '';
		expect(currentA).toBe('');
		expect(currentNew).toBe('三体宇宙');
	});
});
