import type { App} from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { RankingEntry, RankingStatus } from '../types/ranking';
import { ChapterSorter } from './ChapterSorter';
import { SerializedWriter } from '../utils/SerializedWriter';

export class RankingManager {
	private writer = new SerializedWriter();

	constructor(
		private app: App,
		private plugin: WebNovelAssistantPlugin,
		public currentFolder: string = ''
	) {}

	getRankingFilePath(): string {
		const fileName = (this.plugin.settings.ranking?.fileName || '榜单记录') + '.md';
		return this.currentFolder ? `${this.currentFolder}/${fileName}` : fileName;
	}

	getRankingFile(): TFile | null {
		const path = this.getRankingFilePath();
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	async createRankingFile(): Promise<TFile> {
		const path = this.getRankingFilePath();
		return await this.app.vault.create(path, '');
	}

	async loadEntries(): Promise<RankingEntry[] | null> {
		const file = this.getRankingFile();
		if (!file) return null;
		const content = await this.app.vault.read(file);
		return this.parseEntries(content);
	}

	parseEntries(content: string): RankingEntry[] {
		const entries: RankingEntry[] = [];
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed.startsWith('## ')) continue;

			const firstLine = trimmed.split('\n')[0];
			const periodMatch = firstLine.match(/^## 第(\d+)期/);
			if (!periodMatch) continue;
			const period = parseInt(periodMatch[1], 10);

			const meta: Record<string, string> = {};
			const metaRegex = /\*\*(.+?)\*\*[：:]\s*(.+)/g;
			let m;
			while ((m = metaRegex.exec(trimmed)) !== null) {
				meta[m[1]] = m[2].trim();
			}

			entries.push({
				period,
				platform: meta['平台'] || '',
				position: meta['位置'] || '',
				wordTarget: parseInt(meta['字数要求'] || '0', 10),
				startDate: meta['起始时间'] || '',
				endDate: meta['结束时间'] || '',
				startSnapshot: parseInt(meta['起始字数'] || '0', 10),
				status: (meta['状态'] as RankingStatus) || '未开始',
				completedWords: meta['完成字数'] ? parseInt(meta['完成字数'], 10) : undefined,
				rawBlock: trimmed,
			});
		}

		return entries;
	}

	formatEntry(entry: RankingEntry): string {
		const lines: string[] = [];
		lines.push(`## 第${entry.period}期`);
		lines.push('');
		lines.push(`**平台**：${entry.platform}`);
		lines.push(`**位置**：${entry.position}`);
		lines.push(`**字数要求**：${entry.wordTarget}`);
		lines.push(`**起始时间**：${entry.startDate}`);
		lines.push(`**结束时间**：${entry.endDate}`);
		lines.push(`**起始字数**：${entry.startSnapshot}`);
		if (entry.completedWords !== undefined) {
			lines.push(`**完成字数**：${entry.completedWords}`);
		}
		lines.push(`**状态**：${entry.status}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		return lines.join('\n');
	}

	async addEntry(entry: RankingEntry): Promise<void> {
		return this.writer.enqueue(async () => {
			let file = this.getRankingFile();
			if (!file) file = await this.createRankingFile();

			const existing = await this.app.vault.read(file);
			const sep = existing.trim() ? '\n' : '';
			const newContent = existing.trimEnd() + sep + this.formatEntry(entry);
			await this.app.vault.modify(file, newContent);
		});
	}

	async updateEntryStatus(period: number, status: RankingStatus, completedWords?: number): Promise<void> {
		return this.writer.enqueue(async () => {
			const file = this.getRankingFile();
			if (!file) return;
			const content = await this.app.vault.read(file);
			const entries = this.parseEntries(content);

			const entry = entries.find(e => e.period === period && (e.status === '进行中' || e.status === '未开始'));
			if (!entry) return;
			
			if (entry.status === status && (completedWords === undefined || entry.completedWords === completedWords)) return;

			entry.status = status;
			if (completedWords !== undefined) entry.completedWords = completedWords;

			// 全量重写
			let newContent = '';
			for (const e of entries) {
				newContent += this.formatEntry(e);
			}
			await this.app.vault.modify(file, newContent);
		});
	}

	/** 更新进行中榜单的完成字数（实时持久化） */
	async updateProgress(period: number, completedWords: number): Promise<void> {
		return this.writer.enqueue(async () => {
			const file = this.getRankingFile();
			if (!file) return;
			const content = await this.app.vault.read(file);
			const entries = this.parseEntries(content);
			const entry = entries.find(e => e.period === period && e.status === '进行中');
			if (!entry || entry.completedWords === completedWords) return;
			entry.completedWords = completedWords;
			let newContent = '';
			for (const e of entries) {
				newContent += this.formatEntry(e);
			}
			await this.app.vault.modify(file, newContent);
		});
	}

	/** 获取当前进行中的榜单 */
	getActiveRanking(entries: RankingEntry[]): RankingEntry | null {
		return entries.find(e => e.status === '进行中') || null;
	}

	/** 获取下一期期数 */
	getNextPeriod(entries: RankingEntry[]): number {
		if (entries.length === 0) return 1;
		return Math.max(...entries.map(e => e.period)) + 1;
	}

	/** 计算当前增量字数 */
	calcProgress(entry: RankingEntry): number {
		const currentWords = this.getChapterWordCount();
		return Math.max(0, currentWords - entry.startSnapshot);
	}

	/** 获取当前文件夹中章节文件的总字数 */
	getChapterWordCount(): number {
		const folder = this.app.vault.getAbstractFileByPath(this.currentFolder);
		if (!(folder instanceof TFolder)) return 0;

		let total = 0;
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md' && ChapterSorter.isChapterFile(child.name)) {
				const count = this.plugin.cacheManager.getFolderCount(child.path);
				if (count !== null) total += count;
			}
		}
		return total;
	}

	/** 检查并关闭已过期的进行中榜单 */
	async checkAndCloseExpired(): Promise<boolean> {
		const entries = await this.loadEntries();
		if (!entries) return false;

		const today = activeWindow.moment().format('YYYY-MM-DD');
		let changed = false;

		for (const entry of entries) {
			if (entry.status === '进行中' && entry.endDate < today) {
				const progress = this.calcProgress(entry);
				// 如果缓存未就绪（progress=0 但 startSnapshot>0），跳过关闭以避免误判
				if (progress === 0 && entry.startSnapshot > 0) continue;
				const status: RankingStatus = progress >= entry.wordTarget ? '已完成' : '未完成';
				await this.updateEntryStatus(entry.period, status, progress);
				changed = true;
			}
		}
		return changed;
	}

	/** 检查进行中但尚未到开始时间的榜单，标记为进行中 */
	async activatePendingRankings(): Promise<boolean> {
		const entries = await this.loadEntries();
		if (!entries) return false;

		const today = activeWindow.moment().format('YYYY-MM-DD');
		let changed = false;

		for (const entry of entries) {
			if (entry.status === '未开始' && entry.startDate <= today) {
				await this.updateEntryStatus(entry.period, '进行中');
				changed = true;
			}
		}
		return changed;
	}
}