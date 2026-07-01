import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
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
export function findBookRoot(app: App, plugin: WebNovelAssistantPlugin, file: TFile | TFolder | null): string {
	if (!file) return '';

	const folder = file instanceof TFolder ? file : file.parent;
	if (!folder || folder.isRoot()) return '';

	const workspaceFolders = plugin.settings.workspaceFolders || [];

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

	while (currentFolder) {
		// 1. 如果匹配了工作区，直接作为根目录
		if (workspaceFolders.length > 0) {
			const parent = currentFolder.parent;
			if (parent && workspaceFolders.includes(parent.path)) return currentFolder.path;
			if (workspaceFolders.includes(currentFolder.path)) return currentFolder.path;
		}

		// 2. 检查当前级目录下是否存在地标文件（设定文件夹、时间线、伏笔）
		const folderPath = currentFolder.path;
		let foundMarker = false;

		// 检查 lore
		for (const loreName of loreCandidates) {
			const path = folderPath === '/' ? loreName : folderPath + '/' + loreName;
			const absFile = app.vault.getAbstractFileByPath(path);
			if (absFile instanceof TFolder) { foundMarker = true; break; }
		}

		// 检查 timeline
		if (!foundMarker) {
			for (const tlName of timelineCandidates) {
				const path = folderPath === '/' ? tlName + '.md' : folderPath + '/' + tlName + '.md';
				const absFile = app.vault.getAbstractFileByPath(path);
				if (absFile instanceof TFile) { foundMarker = true; break; }
			}
		}

		// 检查 foreshadowing
		if (!foundMarker) {
			for (const fsName of foreshadowingCandidates) {
				const path = folderPath === '/' ? fsName + '.md' : folderPath + '/' + fsName + '.md';
				const absFile = app.vault.getAbstractFileByPath(path);
				if (absFile instanceof TFile) { foundMarker = true; break; }
			}
		}

		// 检查 novelInfo
		if (!foundMarker) {
			for (const infoName of novelInfoCandidates) {
				const path = folderPath === '/' ? infoName + '.md' : folderPath + '/' + infoName + '.md';
				const absFile = app.vault.getAbstractFileByPath(path);
				if (absFile instanceof TFile) { foundMarker = true; break; }
			}
		}

		// 如果找到了地标，这就是小说的根目录
		if (foundMarker) {
			return folderPath;
		}

		// 继续往上冒泡
		currentFolder = currentFolder.parent;
	}

	// 3. 如果没有任何地标，不再强制冒泡到顶级目录，而是直接返回触发操作时所在的目录
	// 这允许用户在任意位置新建地标文件（如时间线），且之后可以自由移动而不影响逻辑
	return folder.path === '/' ? '' : folder.path;
}
