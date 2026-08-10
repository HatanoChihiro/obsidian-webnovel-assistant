import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { WorkbenchView } from '../ui/WorkbenchView';
import { getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';

/**
 * 智能解析当前文件所在的“小说根目录”（支持跨卷递归冒泡查找）
 * 查找优先级：
 * 1. 向上查找到指定的工作区文件夹（workspaceFolders）
 * 2. 向上查找到包含 lore 设定文件夹、timeline.md 或 伏笔.md 的那一级目录
 * 3. 都没有找到，回退到顶级目录（根目录下的第一级文件夹），保持向后兼容
 *
 * @param app Obsidian App 实例
 * @param plugin 插件实例（用于读取设置）
 * @param file 触发查找的源文件，如果是 null 则返回空
 */
export function findBookRoot(app: App, plugin: WebNovelAssistantPlugin, file: TFile | TFolder | null, strict: boolean = false): string {
	if (!file) return '';

	const folder = file instanceof TFolder ? file : file.parent;
	if (!folder || folder.isRoot()) return '';

	const workspaceFolders = plugin.settings.workspaceFolders || [];

	// 如果设置了工作区文件夹，则首先校验文件是否位于任一工作区文件夹内部
	if (workspaceFolders.length > 0) {
		const isFileInWorkspace = workspaceFolders.some(ws => {
			const normWs = ws.replace(/^\/+|\/+$/g, '');
			return folder.path === normWs || folder.path.startsWith(normWs + '/');
		});
		// 工作区之外的文件一律不当作作品处理！
		if (!isFileInWorkspace) {
			return '';
		}
	}

	// 缓存一下候选文件名，减少循环内重新计算
	const loreCandidates = new Set<string>();
	loreCandidates.add(plugin.settings.loreFolderName || getDefaultFileName('loreFolderName'));
	for (const name of getDefaultFileNameCandidates('loreFolderName')) loreCandidates.add(name);

	const timelineCandidates = new Set<string>();
	timelineCandidates.add(plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName'));
	for (const name of getDefaultFileNameCandidates('timelineFileName')) timelineCandidates.add(name);

	const foreshadowingCandidates = new Set<string>();
	foreshadowingCandidates.add(plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName'));
	for (const name of getDefaultFileNameCandidates('foreshadowingFileName')) foreshadowingCandidates.add(name);

	const novelInfoCandidates = new Set<string>();
	novelInfoCandidates.add(plugin.settings.novelInfo?.fileName || getDefaultFileName('novelInfoFileName'));
	for (const name of getDefaultFileNameCandidates('novelInfoFileName')) novelInfoCandidates.add(name);

	let currentFolder: TFolder | null = folder;

	while (currentFolder && !currentFolder.isRoot()) {
		const folderPath = currentFolder.path;
		let foundMarker = false;

		// 检查 lore
		for (const loreName of loreCandidates) {
			const path = folderPath + '/' + loreName;
			const absFile = app.vault.getAbstractFileByPath(path);
			if (absFile instanceof TFolder) { foundMarker = true; break; }
		}

		// 检查 timeline
		if (!foundMarker) {
			for (const tlName of timelineCandidates) {
				const path = folderPath + '/' + tlName + '.md';
				const absFile = app.vault.getAbstractFileByPath(path);
				if (absFile instanceof TFile) { foundMarker = true; break; }
			}
		}

		// 检查 foreshadowing
		if (!foundMarker) {
			for (const fsName of foreshadowingCandidates) {
				const path = folderPath + '/' + fsName + '.md';
				const absFile = app.vault.getAbstractFileByPath(path);
				if (absFile instanceof TFile) { foundMarker = true; break; }
			}
		}

		// 检查 novelInfo
		if (!foundMarker) {
			for (const infoName of novelInfoCandidates) {
				const path = folderPath + '/' + infoName + '.md';
				const absFile = app.vault.getAbstractFileByPath(path);
				if (absFile instanceof TFile) { foundMarker = true; break; }
			}
		}

		// 如果找到了地标，这就是小说的根目录
		if (foundMarker) {
			return folderPath;
		}

		// 如果匹配了工作区目录，非严格模式下直接返回，严格模式下继续向上或要求地标
		if (workspaceFolders.length > 0) {
			const parent = currentFolder.parent;
			if (parent && workspaceFolders.includes(parent.path)) {
				if (!strict) return currentFolder.path;
			}
			if (workspaceFolders.includes(currentFolder.path)) {
				if (!strict) return currentFolder.path;
			}
		}

		// 继续往上冒泡
		currentFolder = currentFolder.parent;
	}

	// 3. 如果没有任何地标，根据严格模式决定是否回退
	if (strict) return '';
	
	// 允许用户在任意位置新建地标文件（如时间线），且之后可以自由移动而不影响逻辑
	return folder.path === '/' ? '' : folder.path;
}

/**
 * 从已按工作台顺序排列的章节列表中获取最后一个直系卷目录。
 * 没有卷层级时返回作品根目录。
 */
export function getLatestChapterFolderPath(bookPath: string, files: TFile[]): string {
	const normalizedBookPath = bookPath === '/' ? '/' : bookPath.replace(/\/+$/, '');
	let latestFolderPath = normalizedBookPath;

	for (const file of files) {
		const parent = file.parent;
		if (!parent || parent.path === normalizedBookPath || parent.path === '/') continue;
		if (parent.parent?.path !== normalizedBookPath) continue;
		latestFolderPath = parent.path;
	}

	return latestFolderPath;
}


/**
 * 智能获取当前全局作品上下文
 * 避免因点击侧边栏（activeLeaf 改变）或非作品文件导致作品上下文被覆盖
 */
export function getCurrentBookContext(app: App, plugin: WebNovelAssistantPlugin): string | null {
	const activeLeaf = app.workspace.getMostRecentLeaf();
	
	// 1. 优先检查当前活动 Leaf（如果是工作台，以工作台自身的 currentBookPath 为准）
	if (activeLeaf) {
		if (activeLeaf.view.getViewType() === 'webnovel-workbench') {
			const bookPath = (activeLeaf.view as WorkbenchView).currentBookPath;
			if (bookPath && bookPath !== '/' && bookPath !== '') return bookPath;
		}
		if (activeLeaf.view.getViewType() === 'markdown') {
			const file = app.workspace.getActiveFile();
			if (file) {
				const bookPath = findBookRoot(app, plugin, file, true);
				if (bookPath) return bookPath;
			}
		}
	}

	// 2. 如果当前焦点不是作品 Markdown，寻找工作区是否有任何打开的有效作品工作台
	const workbenches = app.workspace.getLeavesOfType('webnovel-workbench');
	for (const leaf of workbenches) {
		const bookPath = (leaf.view as WorkbenchView).currentBookPath;
		if (bookPath && bookPath !== '/' && bookPath !== '') return bookPath;
	}

	// 3. 检查系统最后活跃的 markdown 文件是否在作品目录中
	const file = app.workspace.getActiveFile();
	if (file) {
		const bookPath = findBookRoot(app, plugin, file, true);
		if (bookPath) return bookPath;
	}

	// 4. 兜底：取全库注册的第一个作品目录
	const novels = plugin.homepageManager?.getNovelFolders() || [];
	if (novels.length > 0) {
		return novels[0].folderPath;
	}

	return null;
}
