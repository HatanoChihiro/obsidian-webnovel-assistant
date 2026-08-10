import { describe, expect, it } from 'vitest';
import { TFile, TFolder } from './mocks/obsidian';
import { getLatestChapterFolderPath } from '../src/utils/path';

function createFolder(name: string, path: string, parent: TFolder | null): TFolder {
	return Object.assign(new TFolder(name, path), { parent });
}

function createFile(name: string, path: string, parent: TFolder): TFile {
	return Object.assign(new TFile(name, path), {
		basename: name.replace(/\.md$/i, ''),
		parent
	});
}

describe('getLatestChapterFolderPath', () => {
	it('should use the last volume represented by the sorted chapter list', () => {
		const book = createFolder('作品', '作品', null);
		const firstVolume = createFolder('第一卷', '作品/第一卷', book);
		const latestVolume = createFolder('第二卷', '作品/第二卷', book);

		const files = [
			createFile('第1章.md', '作品/第一卷/第1章.md', firstVolume),
			createFile('第2章.md', '作品/第二卷/第2章.md', latestVolume)
		];

		expect(getLatestChapterFolderPath('作品', files)).toBe('作品/第二卷');
	});

	it('should keep the book root when there is no volume with chapters', () => {
		const book = createFolder('作品', '作品', null);
		const files = [createFile('第1章.md', '作品/第1章.md', book)];

		expect(getLatestChapterFolderPath('作品', files)).toBe('作品');
	});

	it('should ignore nested folders that are not direct volumes', () => {
		const book = createFolder('作品', '作品', null);
		const volume = createFolder('第一卷', '作品/第一卷', book);
		const nestedFolder = createFolder('番外', '作品/第一卷/番外', volume);
		const files = [createFile('第1章.md', '作品/第一卷/番外/第1章.md', nestedFolder)];

		expect(getLatestChapterFolderPath('作品', files)).toBe('作品');
	});
});
