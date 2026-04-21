import { App, TFile } from 'obsidian';

type AccurateChineseCountPlugin = any;

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
	constructor(
		private app: App,
		private plugin: AccurateChineseCountPlugin,
		public currentFolder: string = ''
	) {}

	getTimelineFilePath(): string {
		const fileName = (this.plugin.settings.timeline?.fileName || '时间线') + '.md';
		return this.currentFolder ? `${this.currentFolder}/${fileName}` : fileName;
	}

	getTimelineFile(): TFile | null {
		const path = this.getTimelineFilePath();
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	async createTimelineFile(): Promise<TFile> {
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

			const descLines: string[] = [];
			let i = 1;
			while (i < lines.length && !lines[i].startsWith('**')) {
				if (lines[i].trim()) descLines.push(lines[i].trim());
				i++;
			}
			const description = descLines.join('\n');

			const items: { description: string; chapter: string }[] = [];
			const typeMatch = trimmed.match(/\*\*类型\*\*：(.+)/);

			for (const line of lines.slice(1)) {
				if (line.startsWith('- ')) {
					const itemText = line.slice(2);
					
					// 提取所有 [[章节]] 链接
					const chapterMatches = itemText.matchAll(/\[\[(.+?)\]\]/g);
					const chapters: string[] = [];
					for (const match of chapterMatches) {
						chapters.push(match[1]);
					}
					
					// 移除所有链接后的文本作为描述
					const desc = itemText.replace(/\[\[.+?\]\]/g, '').trim();
					
					// 将多个章节用逗号连接
					const chapter = chapters.join(', ');
					items.push({ description: desc, chapter });
				}
			}

			const finalItems = items.length > 0 ? items : [{ description, chapter: '' }];

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
				const parts: string[] = [];
				if (it.description) parts.push(it.description);
				
				// 支持多章节：将逗号分隔的章节转换为多个 [[链接]]
				if (it.chapter) {
					const chapters = it.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
					const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
					if (chapterLinks) parts.push(chapterLinks);
				}
				
				if (parts.length > 0) lines.push(`- ${parts.join(' ')}`);
			}
		} else {
			const itemParts: string[] = [];
			if (entry.description) itemParts.push(entry.description);
			
			// 支持多章节
			if (entry.chapter) {
				const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
				const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
				if (chapterLinks) itemParts.push(chapterLinks);
			}
			
			if (itemParts.length > 0) lines.push(`- ${itemParts.join(' ')}`);
		}

		if (entry.type) {
			lines.push('');
			lines.push(`**类型**：${entry.type}`);
		}
		lines.push('');
		lines.push('---');
		lines.push('');
		lines.push('');
		return lines.join('\n');
	}

	async appendEntry(entry: TimelineEntry): Promise<string> {
		let file = this.getTimelineFile();
		if (!file) file = await this.createTimelineFile();
		const existing = await this.app.vault.read(file);

		const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const headerPattern = new RegExp(
			`(## ${escapeRegex(entry.time)}\\n)([\\s\\S]*?)(\\n---\\n)`,
			'm'
		);
		const match = headerPattern.exec(existing);

		let newContent: string;
		if (match) {
			const fullMatch = match[0];
			const header = match[1];
			const body = match[2];
			const separator = match[3];

			const itemParts: string[] = [];
			if (entry.description) itemParts.push(entry.description);
			
			// 支持多章节
			if (entry.chapter) {
				const chapters = entry.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean);
				const chapterLinks = chapters.map(c => `[[${c}]]`).join(' ');
				if (chapterLinks) itemParts.push(chapterLinks);
			}
			
			const newItem = itemParts.length > 0 ? `- ${itemParts.join(' ')}` : '';

			const boldIndex = body.indexOf('\n**类型**');
			let newBody: string;
			if (newItem) {
				if (boldIndex !== -1) {
					newBody = body.slice(0, boldIndex) + '\n' + newItem + body.slice(boldIndex);
				} else {
					newBody = body.trimEnd() + '\n' + newItem + '\n';
				}
			} else {
				newBody = body;
			}

			newContent = existing.replace(fullMatch, header + newBody + separator);
		} else {
			const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';
			newContent = existing + sep + this.formatEntry(entry);
		}

		await this.app.vault.modify(file, newContent);
		return newContent;
	}

	async updateEntry(index: number, updated: TimelineEntry): Promise<string> {
		const file = this.getTimelineFile();
		if (!file) return '';
		const entries = await this.loadEntries();
		if (!entries) return '';
		entries[index] = updated;
		return await this.writeAllEntries(file, entries);
	}

	async deleteEntry(index: number): Promise<string> {
		const file = this.getTimelineFile();
		if (!file) return '';
		const entries = await this.loadEntries();
		if (!entries) return '';
		entries.splice(index, 1);
		return await this.writeAllEntries(file, entries);
	}

	async moveEntry(fromIndex: number, toIndex: number): Promise<string> {
		const file = this.getTimelineFile();
		if (!file) return '';
		const entries = await this.loadEntries();
		if (!entries) return '';
		const [moved] = entries.splice(fromIndex, 1);
		entries.splice(toIndex, 0, moved);
		return await this.writeAllEntries(file, entries);
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
