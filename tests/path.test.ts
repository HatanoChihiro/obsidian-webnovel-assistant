import { describe, it, expect, vi } from 'vitest';
import { findBookRoot, getCurrentBookContext, getCandidateNames, isCandidateSubpath } from '../src/utils/path';
import { TFile, TFolder, App } from 'obsidian';

// Mock getAbstractFileByPath
const createMockApp = (files: Record<string, 'file' | 'folder'>) => {
	return {
		vault: {
			getAbstractFileByPath: (path: string) => {
				const type = files[path];
				if (type === 'file') return Object.assign(Object.create(TFile.prototype), { path, name: path }) as TFile;
				if (type === 'folder') return Object.assign(Object.create(TFolder.prototype), { path, name: path }) as TFolder;
				return null;
			}
		}
	} as unknown as App;
};

const createMockPlugin = (settings: any = {}) => {
	return {
		settings: {
			workspaceFolders: [],
			loreFolderName: '设定',
			timeline: { fileName: '时间线' },
			foreshadowing: { fileName: '伏笔' },
			novelInfo: { fileName: '作品信息' },
			...settings
		}
	} as any;
};

// Custom TFolder with parent references for testing
class MockFolder extends TFolder {
	public parent: TFolder | null = null;
	public path: string;
	constructor(path: string, public name: string) {
		super();
		this.path = path;
	}
	isRoot() { return this.path === '/'; }
}

class MockFile extends TFile {
	public parent: TFolder | null = null;
	public path: string;
	constructor(path: string, public name: string) {
		super();
		this.path = path;
	}
}

describe('path utils - findBookRoot', () => {
	it('当提供 null 时返回空字符串', () => {
		expect(findBookRoot(createMockApp({}), createMockPlugin(), null)).toBe('');
	});

	it('当直接包含地标文件时返回当前目录', () => {
		const app = createMockApp({
			'小说A/设定': 'folder',
		});
		const plugin = createMockPlugin();
		
		const rootFolder = new MockFolder('小说A', '小说A');
		const file = new MockFile('小说A/第一章.md', '第一章.md');
		file.parent = rootFolder;

		expect(findBookRoot(app, plugin, file)).toBe('小说A');
	});

	it('当分卷中没有地标时，向上冒泡查找到存在地标的目录', () => {
		const app = createMockApp({
			'小说A/时间线.md': 'file',
		});
		const plugin = createMockPlugin();
		
		const rootFolder = new MockFolder('小说A', '小说A');
		const volumeFolder = new MockFolder('小说A/卷一', '卷一');
		volumeFolder.parent = rootFolder;
		const file = new MockFile('小说A/卷一/第一章.md', '第一章.md');
		file.parent = volumeFolder;

		expect(findBookRoot(app, plugin, file)).toBe('小说A');
	});

	it('当没有找到任何地标时，返回触发操作时所在的当前目录', () => {
		const app = createMockApp({}); // 没有地标文件
		const plugin = createMockPlugin();
		
		const rootFolder = new MockFolder('未命名小说', '未命名小说');
		const volumeFolder = new MockFolder('未命名小说/某卷', '某卷');
		volumeFolder.parent = rootFolder;
		const file = new MockFile('未命名小说/某卷/第一章.md', '第一章.md');
		file.parent = volumeFolder;

		// 回退逻辑：返回 file.parent 的路径
		expect(findBookRoot(app, plugin, file)).toBe('未命名小说/某卷');
	});

	it('优先匹配工作区设置', () => {
		const app = createMockApp({
			'某工作区/某小说/设定': 'folder', // 虽然更深层有设定，但工作区优先
		});
		const plugin = createMockPlugin({
			workspaceFolders: ['某工作区']
		});
		
		const workspace = new MockFolder('某工作区', '某工作区');
		const novelFolder = new MockFolder('某工作区/某小说', '某小说');
		novelFolder.parent = workspace;
		const file = new MockFile('某工作区/某小说/第一章.md', '第一章.md');
		file.parent = novelFolder;

		// 由于 workspaceFolders 包含 '某工作区'，并且 currentFolder 的 parent 是 '某工作区'
		// 它应该返回 novelFolder 的 path
		expect(findBookRoot(app, plugin, file)).toBe('某工作区/某小说');
	});
});

describe('path utils - getCurrentBookContext', () => {
	it('侧面板聚焦时优先使用最后活跃章节，而不是其他已打开的作品工作台', () => {
		const rootFolder = new MockFolder('作品B', '作品B');
		const activeFile = new MockFile('作品B/第1章.md', '第1章.md');
		activeFile.parent = rootFolder;
		const app = createMockApp({ '作品B/作品信息.md': 'file' });
		Object.assign(app, {
			workspace: {
				getMostRecentLeaf: () => ({ view: { getViewType: () => 'writing-status-view' } }),
				getActiveFile: () => activeFile,
				getLeavesOfType: () => [{
					view: { getViewType: () => 'webnovel-workbench', currentBookPath: '作品A' }
				}]
			}
		});
		const plugin = createMockPlugin();

		expect(getCurrentBookContext(app, plugin)).toBe('作品B');
	});
});

describe('path utils - getCandidateNames', () => {
	it('should include configured name, localized default, and all multilingual candidates', () => {
		const candidates = getCandidateNames('CustomLore', 'loreFolderName');
		expect(candidates.has('CustomLore')).toBe(true);
		expect(candidates.has('设定')).toBe(true);
		expect(candidates.has('Lore')).toBe(true);
	});

	it('should fall back to localized default and all multilingual candidates when configured is undefined or blank', () => {
		const candidates = getCandidateNames(undefined, 'loreFolderName');
		expect(candidates.has('设定')).toBe(true);
		expect(candidates.has('Lore')).toBe(true);

		const blankCandidates = getCandidateNames('   ', 'timelineFileName');
		expect(blankCandidates.has('时间线')).toBe(true);
		expect(blankCandidates.has('Timeline')).toBe(true);
	});
});

describe('path utils - isCandidateSubpath', () => {
	const candidates = new Set(['Lore', '设定']);

	it('should match direct candidate folder and nested subdirectories', () => {
		expect(isCandidateSubpath('Book1', 'Book1/Lore', candidates)).toBe(true);
		expect(isCandidateSubpath('Book1', 'Book1/Lore/Characters', candidates)).toBe(true);
		expect(isCandidateSubpath('Book1', 'Book1/设定/角色/主角', candidates)).toBe(true);
	});

	it('should support root-level books', () => {
		expect(isCandidateSubpath('/', 'Lore/Characters', candidates)).toBe(true);
		expect(isCandidateSubpath('', '设定/角色', candidates)).toBe(true);
		expect(isCandidateSubpath('/', 'Drafts/Characters', candidates)).toBe(false);
	});

	it('should reject non-matching folders and prefix collisions', () => {
		expect(isCandidateSubpath('Book1', 'Book1/Drafts', candidates)).toBe(false);
		expect(isCandidateSubpath('Book1', 'Book1/LoreCollections', candidates)).toBe(false);
		expect(isCandidateSubpath('Book1', 'Book2/Lore', candidates)).toBe(false);
	});
});
