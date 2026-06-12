import type { App} from 'obsidian';
import { TFile } from 'obsidian';

import type { WebNovelAssistantPlugin } from '../types/plugin';

import { escapeRegex } from '../utils/validation';
import { t } from '../i18n';
import { getDefaultFileName, getDefaultFileNameCandidates, getTimelineLabel } from '../i18n/data-keys';

import { SerializedWriter } from '../utils/SerializedWriter';



export interface TimelineEntry {

	time: string;

	description: string;

	chapter: string;

	type: string;

	rawBlock: string;

	items?: { description: string; chapter: string }[];

}



/**

 * 时间线管理服务

 * 负责时间线文件的读写、格式化、条目管理

 */

export class TimelineManager {

	private writer = new SerializedWriter();



	constructor(

		private app: App,

		private plugin: WebNovelAssistantPlugin,

		public currentFolder: string = ''

	) {}



	getTimelineFilePath(): string {

		const fileName = (this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName')) + '.md';

		return this.currentFolder ? `${this.currentFolder}/${fileName}` : fileName;

	}




	findTimelineFile(): TFile | null {
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.timeline?.fileName || t('common.default-timeline-filename'));
		for (const name of getDefaultFileNameCandidates('timelineFileName')) candidates.add(name);
		for (const fileName of candidates) {
			const path = this.currentFolder ? this.currentFolder + "/" + fileName + ".md" : fileName + ".md";
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	getTimelineFile(): TFile | null {
		return this.findTimelineFile();
	}


	async createTimelineFile(): Promise<TFile> {
		// 检查是否已有时间线文件（多语言查找）
		const existing = this.findTimelineFile();
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName');
			if (existing.name !== expectedName + '.md') {
				const newPath = this.currentFolder ? this.currentFolder + '/' + expectedName + '.md' : expectedName + '.md';
				try { await this.app.fileManager.renameFile(existing, newPath); } catch (e) { console.warn('[TimelineManager] 重命名时间线文件失败:', e); }
			}
			const foundPath = this.currentFolder ? this.currentFolder + '/' + expectedName + '.md' : expectedName + '.md';
			const found = this.app.vault.getAbstractFileByPath(foundPath);
				return found instanceof TFile ? found : existing;
		}

		const path = this.getTimelineFilePath();
		return await this.app.vault.create(path, '');
	}



	async loadEntries(): Promise<TimelineEntry[] | null> {

		const file = this.getTimelineFile();

		if (!file) return null;

		const content = await this.app.vault.read(file);

		return this.parseEntries(content);

	}



	parseEntries(content: string): TimelineEntry[] {

		const entries: TimelineEntry[] = [];

		const blocks = content.split(/\n---\n/);



		for (const block of blocks) {

			const trimmed = block.trim();

			if (!trimmed.startsWith('## ')) continue;



			const lines = trimmed.split('\n');

			const time = lines[0].replace(/^## /, '').trim();



			const items: { description: string; chapter: string }[] = [];

			// 匹配类型行：优先当前语言，兼容中文旧格式
				const typeMatch = trimmed.match(/\*\*(?:Type|类型)\*\*：(.+)/);



			let i = 1;

			while (i < lines.length) {

				const line = lines[i];

				

				// 跳过空行和类型行

				if (!line.trim() || line.startsWith('**')) {

					i++;

					continue;

				}

				

				// 处理列表项

				if (line.startsWith('- ')) {

					const itemText = line.slice(2);

					

					// 提取所有 [[章节]] 链接

					const chapterMatches = itemText.matchAll(/\[\[(.+?)\]\]/g);

					const chapters: string[] = [];

					for (const match of chapterMatches) {

						chapters.push(match[1]);

					}

					

					// 移除所有链接后的文本作为描述的第一行

					let desc = itemText.replace(/\[\[.+?\]\]/g, '').trim();

					

					// 收集后续的缩进行（多行描述）

					i++;

					while (i < lines.length && lines[i].startsWith('  ') && !lines[i].startsWith('- ')) {

						const continuationLine = lines[i].slice(2); // 移除缩进

						if (continuationLine.trim()) {

							desc += '\n' + continuationLine;

						}

						i++;

					}

					

					// 将多个章节用逗号连接

					const chapter = chapters.join(', ');

					items.push({ description: desc, chapter });

					continue;

				}

				

				i++;

			}



			// 如果没有找到列表项，尝试从旧格式解析（H2 后的描述行）

			if (items.length === 0) {

				const descLines: string[] = [];

				let j = 1;

				while (j < lines.length && !lines[j].startsWith('**') && !lines[j].startsWith('- ')) {

					if (lines[j].trim()) descLines.push(lines[j].trim());

					j++;

				}

				const description = descLines.join('\n');

				if (description) {

					items.push({ description, chapter: '' });

				}

			}



			const finalItems = items.length > 0 ? items : [{ description: '', chapter: '' }];



			entries.push({

				time,

				description: finalItems.map(it => it.description).filter(Boolean).join('\n'),

				chapter: finalItems.map(it => it.chapter).filter(Boolean).join(', '),

				type: typeMatch ? typeMatch[1].trim() : '',

				rawBlock: trimmed,

				items: finalItems,

			});

		}



		return entries;

	}



	formatEntry(entry: TimelineEntry): string {

		const lines: string[] = [];

		lines.push(`## ${entry.time}`);

		lines.push('');



		const items = entry.items;

		if (items && items.length > 0) {

			for (const it of items) {

				// 处理多行描述：将每一行作为单独的列表项

				const descriptions = it.description ? it.description.split('\n').filter(line => line.trim()) : [];

				

				if (descriptions.length > 0) {

					// 第一行包含章节链接

					const firstLineParts: string[] = [descriptions[0]];

					

					// 支持多章节：将逗号分隔的章节转换为多个 [[链接]]

					if (it.chapter) {

						const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

						const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

						if (chapterLinks) firstLineParts.push(chapterLinks);

					}

					

					lines.push(`- ${firstLineParts.join(' ')}`);

					

					// 后续行作为缩进的列表项（Markdown 多行列表项格式）

					for (let i = 1; i < descriptions.length; i++) {

						lines.push(`  ${descriptions[i]}`);

					}

				} else if (it.chapter) {

					// 只有章节链接，没有描述

					const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

					if (chapterLinks) lines.push(`- ${chapterLinks}`);

				}

			}

		} else {

			// 处理多行描述

			const descriptions = entry.description ? entry.description.split('\n').filter(line => line.trim()) : [];

			

			if (descriptions.length > 0) {

				const firstLineParts: string[] = [descriptions[0]];

				

				// 支持多章节

				if (entry.chapter) {

					const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

					if (chapterLinks) firstLineParts.push(chapterLinks);

				}

				

				lines.push(`- ${firstLineParts.join(' ')}`);

				

				// 后续行作为缩进的列表项

				for (let i = 1; i < descriptions.length; i++) {

					lines.push(`  ${descriptions[i]}`);

				}

			} else if (entry.chapter) {

				// 只有章节链接

				const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

				const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

				if (chapterLinks) lines.push(`- ${chapterLinks}`);

			}

		}



		if (entry.type) {

			lines.push('');

			lines.push(`**${getTimelineLabel('type')}**：${entry.type}`);

		}

		lines.push('');

		lines.push('---');

		lines.push('');

		lines.push('');

		return lines.join('\n');

	}



	async appendEntry(entry: TimelineEntry): Promise<string> {
			return this.writer.enqueue(async () => {
			let file = this.getTimelineFile();

			if (!file) file = await this.createTimelineFile();

			const existing = await this.app.vault.read(file);



			const headerPattern = new RegExp(

				`(## ${escapeRegex(entry.time)}\\n)([\\s\\S]*?)(\\n---\\n)`,

				'm'

			);

			const match = headerPattern.exec(existing);



			let newContent: string;

			if (match) {

				// 合并到已存在的时间点

				const fullMatch = match[0];

				const header = match[1];

				const body = match[2];

				const separator = match[3];



				// 处理多行描述

				const descriptions = entry.description ? entry.description.split('\n').filter(line => line.trim()) : [];

				const newItemLines: string[] = [];

			

				if (descriptions.length > 0) {

					const firstLineParts: string[] = [descriptions[0]];

				

					// 支持多章节

					if (entry.chapter) {

						const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

						const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

						if (chapterLinks) firstLineParts.push(chapterLinks);

					}

				

					newItemLines.push(`- ${firstLineParts.join(' ')}`);

				

					// 后续行作为缩进的列表项

					for (let i = 1; i < descriptions.length; i++) {

						newItemLines.push(`  ${descriptions[i]}`);

					}

				} else if (entry.chapter) {

					// 只有章节链接，没有描述

					const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);

					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');

					if (chapterLinks) newItemLines.push(`- ${chapterLinks}`);

				}



				// 兼容两种语言的类型标签
					let boldIndex = body.indexOf(`\n**${getTimelineLabel('type')}**`);
					if (boldIndex === -1) boldIndex = body.indexOf('\n**类型**');
					if (boldIndex === -1) boldIndex = body.indexOf('\n**Type**');

				let newBody: string;

				if (newItemLines.length > 0) {

					const newItemText = newItemLines.join('\n');

					if (boldIndex !== -1) {

						newBody = body.slice(0, boldIndex) + '\n' + newItemText + body.slice(boldIndex);

					} else {

						newBody = body.trimEnd() + '\n' + newItemText + '\n';

					}

				} else {

					newBody = body;

				}



				newContent = existing.replace(fullMatch, header + newBody + separator);

			} else {

				// 创建新的时间点

				const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';

				newContent = existing + sep + this.formatEntry(entry);

			}



			await this.app.vault.modify(file, newContent);

			return newContent;

			});
		}


	async updateEntry(index: number, updated: TimelineEntry): Promise<string> {
			return this.writer.enqueue(async () => {
			const file = this.getTimelineFile();

			if (!file) return '';

			const entries = await this.loadEntries();

			if (!entries) return '';

			entries[index] = updated;

			return await this.writeAllEntries(file, entries);

			});
		}


	async deleteEntry(index: number): Promise<string> {
			return this.writer.enqueue(async () => {
			const file = this.getTimelineFile();

			if (!file) return '';

			const entries = await this.loadEntries();

			if (!entries) return '';

			entries.splice(index, 1);

			return await this.writeAllEntries(file, entries);

			});
		}


	async moveEntry(fromIndex: number, toIndex: number): Promise<string> {
			return this.writer.enqueue(async () => {
			const file = this.getTimelineFile();

			if (!file) return '';

			const entries = await this.loadEntries();

			if (!entries) return '';

			const [moved] = entries.splice(fromIndex, 1);

			entries.splice(toIndex, 0, moved);

			return await this.writeAllEntries(file, entries);

			});
		}


	async writeAllEntries(file: TFile, entries: TimelineEntry[]): Promise<string> {
		let content = '';

		for (const entry of entries) {

			content += this.formatEntry(entry);

		}

		await this.app.vault.modify(file, content);

		return content;

	}
}

