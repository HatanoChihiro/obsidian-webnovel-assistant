import type { TFile } from 'obsidian';
import { ChapterSorter } from '../services/ChapterSorter';
import type { NovelFolderInfo } from '../types/homepage';

export interface ChapterDisplayOrderOptions {
	currentBookPath?: string;
	isDescending?: boolean;
	enableSmartChapterSort?: boolean;
	customSortOrder?: Record<string, number>;
}

export interface NovelFolderOrderOptions {
	enableSmartChapterSort?: boolean;
	customSortOrder?: Record<string, number>;
}

/**
 * Extracts the relative volume folder path for a file with respect to currentBookPath.
 * Returns '' for root-level / ungrouped chapters.
 */
export function getFileVolumePath(file: TFile, bookPath?: string): string {
	const normalizedBookPath = (!bookPath || bookPath === '/') ? '' : bookPath.replace(/\/+$/, '');

	if (file.parent) {
		const parentPath = (file.parent.path === '/' || !file.parent.path) ? '' : file.parent.path.replace(/\/+$/, '');
		if (!normalizedBookPath) {
			return parentPath;
		}
		if (parentPath === normalizedBookPath) {
			return '';
		}
		if (parentPath.startsWith(normalizedBookPath + '/')) {
			return parentPath.slice(normalizedBookPath.length + 1);
		}
		return parentPath;
	}

	// Fallback based on file.path if file.parent is not available
	const lastSlash = file.path.lastIndexOf('/');
	if (lastSlash === -1) return '';
	const parentPath = file.path.substring(0, lastSlash);
	if (!normalizedBookPath) {
		return parentPath === '/' ? '' : parentPath;
	}
	if (parentPath === normalizedBookPath) {
		return '';
	}
	if (parentPath.startsWith(normalizedBookPath + '/')) {
		return parentPath.slice(normalizedBookPath.length + 1);
	}
	return parentPath;
}

/**
 * Compares two volume relative paths in canonical ascending order.
 * - Ungrouped / top-level block ('') comes first before any volume folders.
 * - Volume folders are compared segment-by-segment following the patched File Explorer model:
 *   - Volume folders recognized by ChapterSorter form the smart chapter block.
 *   - Inside the smart block, smart rule/number order wins and individual manual customSortOrder entries do not override the order.
 *   - Unrecognized volume folders remain ordinary sibling entities and respect customSortOrder.
 *   - The relative placement of ordinary volume folders versus the smart block respects customSortOrder (__CHAPTER_BLOCK__) or defaults.
 */
export function compareVolumePaths(
	volA: string,
	volB: string,
	bookPath: string = '',
	enableSmartSort: boolean = true,
	customOrder?: Record<string, number>
): number {
	if (volA === volB) return 0;
	if (volA === '') return -1;
	if (volB === '') return 1;

	const normalizedBookPath = (!bookPath || bookPath === '/') ? '' : bookPath.replace(/\/+$/, '');
	const segsA = volA.split('/');
	const segsB = volB.split('/');
	const minLen = Math.min(segsA.length, segsB.length);

	for (let i = 0; i < minLen; i++) {
		const segA = segsA[i];
		const segB = segsB[i];

		if (segA === segB) continue;

		const parentRel = segsA.slice(0, i).join('/');
		const parentFullPath = normalizedBookPath
			? (parentRel ? `${normalizedBookPath}/${parentRel}` : normalizedBookPath)
			: parentRel;

		const numA = enableSmartSort ? ChapterSorter.extractChapterNumber(segA) : null;
		const numB = enableSmartSort ? ChapterSorter.extractChapterNumber(segB) : null;

		// 1. If both are recognized by smart rules, they belong to the smart chapter block:
		// Smart rule/number order wins, ignoring individual customSortOrder entries.
		if (numA !== null && numB !== null) {
			if (numA.ruleIndex !== numB.ruleIndex) {
				return numA.ruleIndex - numB.ruleIndex;
			}
			if (numA.number !== numB.number) {
				return numA.number - numB.number;
			}
			return segA.localeCompare(segB, 'zh-CN', { numeric: true });
		}

		// 2. If at least one is unrecognized (or smart sort is disabled):
		// Use customSortOrder if present, aligning recognized folders with the __CHAPTER_BLOCK__ key.
		if (customOrder) {
			const blockKey = parentFullPath ? `${parentFullPath}/__CHAPTER_BLOCK__` : '/__CHAPTER_BLOCK__';
			const keyA = numA !== null ? blockKey : (parentFullPath ? `${parentFullPath}/${segA}` : segA);
			const keyB = numB !== null ? blockKey : (parentFullPath ? `${parentFullPath}/${segB}` : segB);

			const orderA = customOrder[keyA];
			const orderB = customOrder[keyB];

			if (orderA !== undefined && orderB !== undefined) {
				if (orderA !== orderB) return orderA - orderB;
			} else if (orderA !== undefined) {
				return -1;
			} else if (orderB !== undefined) {
				return 1;
			}
		}

		// 3. Fallback when neither has custom sort order:
		// File Explorer semantics: ordinary folders (-1) vs smart chapter block (0).
		const defaultA = numA !== null ? 0 : -1;
		const defaultB = numB !== null ? 0 : -1;
		if (defaultA !== defaultB) {
			return defaultA - defaultB;
		}

		return segA.localeCompare(segB, enableSmartSort ? 'zh-CN' : undefined, { numeric: true });
	}

	return segsA.length - segsB.length;
}

/**
 * Produces a deterministic chapter display order for Workbench All Chapters and Chapter Overview.
 *
 * Ordering policy:
 * 1. Chapters are grouped by volume folder path.
 * 2. Chapters inside each volume are sorted in canonical ascending order.
 * 3. Volume groups are sorted in canonical ascending order (ungrouped top-level chapters '' first).
 * 4. In Ascending mode: Volume groups are ordered canonically, with chapters ascending within.
 * 5. In Descending mode: Volume groups are in reverse canonical order, with chapters descending within.
 * 6. The original files array is never mutated.
 */
export function getDeterministicChapterDisplayOrder(
	files: readonly TFile[],
	options: ChapterDisplayOrderOptions = {}
): TFile[] {
	if (!files || files.length === 0) return [];

	const {
		currentBookPath = '',
		isDescending = false,
		enableSmartChapterSort = true,
		customSortOrder = {}
	} = options;

	// 1. Group files by volume
	const volumeMap = new Map<string, TFile[]>();
	for (const file of files) {
		const volume = getFileVolumePath(file, currentBookPath);
		let list = volumeMap.get(volume);
		if (!list) {
			list = [];
			volumeMap.set(volume, list);
		}
		list.push(file);
	}

	// 2. Sort chapters inside each volume (canonical ascending)
	for (const [, chapterList] of volumeMap) {
		if (enableSmartChapterSort) {
			chapterList.sort((a, b) => ChapterSorter.compareFilesWithCustomOrder(a, b, customSortOrder));
		} else {
			chapterList.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
		}
	}

	// 3. Sort volume groups (canonical ascending)
	const volumeKeys = Array.from(volumeMap.keys()).sort((a, b) =>
		compareVolumePaths(a, b, currentBookPath, enableSmartChapterSort, customSortOrder)
	);

	// 4. Assemble final display list
	const orderedVolumeKeys = isDescending ? [...volumeKeys].reverse() : volumeKeys;
	const result: TFile[] = [];

	for (const volume of orderedVolumeKeys) {
		const chapters = volumeMap.get(volume) || [];
		if (isDescending) {
			for (let i = chapters.length - 1; i >= 0; i--) {
				result.push(chapters[i]);
			}
		} else {
			for (let i = 0; i < chapters.length; i++) {
				result.push(chapters[i]);
			}
		}
	}

	return result;
}

/**
 * Sorts novel/work folders in the exact hierarchical top-to-bottom order of the patched Obsidian File Explorer.
 *
 * Sibling order matches FileExplorerPatcher:
 * - When enableSmartChapterSort is enabled:
 *   - Folders recognized by ChapterSorter form the smart chapter block and sort internally by smart rules/numbers.
 *   - Stale individual customSortOrder on recognized folders is ignored.
 *   - Unrecognized folders remain ordinary entities and respect customSortOrder.
 *   - Relative placement between ordinary folders and the smart block uses the parent `__CHAPTER_BLOCK__` key (or defaults: ordinary -1 vs smart 0).
 * - When enableSmartChapterSort is disabled:
 *   - Custom drag sorting is disabled in File Explorer, so customSortOrder is ignored and sibling folders follow native natural numeric name sorting.
 * - Hierarchy / nesting:
 *   - Paths are compared segment-by-segment from vault root.
 *   - When one path is an ancestor of another, the ancestor appears first, immediately followed by its subtree.
 *
 * Does not mutate the input array.
 */
export function sortNovelFoldersForSwitchMenu(
	novels: readonly NovelFolderInfo[],
	options: NovelFolderOrderOptions = {}
): NovelFolderInfo[] {
	if (!novels || novels.length === 0) return [];
	const { enableSmartChapterSort = true, customSortOrder } = options;
	const activeCustomOrder = enableSmartChapterSort ? customSortOrder : undefined;

	return [...novels].sort((a, b) => {
		const pathA = (a.folderPath || '').replace(/^\/+|\/+$/g, '');
		const pathB = (b.folderPath || '').replace(/^\/+|\/+$/g, '');
		return compareVolumePaths(pathA, pathB, '', enableSmartChapterSort, activeCustomOrder);
	});
}
