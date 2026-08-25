import type { TFile } from 'obsidian';
import { ChapterSorter } from '../services/ChapterSorter';

export interface ChapterDisplayOrderOptions {
	currentBookPath?: string;
	isDescending?: boolean;
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
 * - Volume folders are compared segment-by-segment respecting customSortOrder and ChapterSorter rules.
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

		if (customOrder) {
			const relA = segsA.slice(0, i + 1).join('/');
			const relB = segsB.slice(0, i + 1).join('/');
			const fullA = normalizedBookPath ? `${normalizedBookPath}/${relA}` : relA;
			const fullB = normalizedBookPath ? `${normalizedBookPath}/${relB}` : relB;

			const orderA = customOrder[fullA];
			const orderB = customOrder[fullB];

			if (orderA !== undefined && orderB !== undefined) {
				if (orderA !== orderB) return orderA - orderB;
			} else if (orderA !== undefined) {
				return -1;
			} else if (orderB !== undefined) {
				return 1;
			}
		}

		if (enableSmartSort) {
			const numA = ChapterSorter.extractChapterNumber(segA);
			const numB = ChapterSorter.extractChapterNumber(segB);

			if (numA !== null && numB !== null) {
				if (numA.ruleIndex !== numB.ruleIndex) {
					return numA.ruleIndex - numB.ruleIndex;
				}
				if (numA.number !== numB.number) {
					return numA.number - numB.number;
				}
				return segA.localeCompare(segB, 'zh-CN', { numeric: true });
			}

			if (numA !== null) return -1;
			if (numB !== null) return 1;

			return segA.localeCompare(segB, 'zh-CN', { numeric: true });
		} else {
			return segA.localeCompare(segB, undefined, { numeric: true });
		}
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
