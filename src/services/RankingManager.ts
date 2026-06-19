// 限时任务追踪管理器（内部仍用 Ranking 命名，待后续重构改为 Task）
import type { App} from 'obsidian';
import { TFile, TFolder, normalizePath } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { RankingEntry, RankingStatus } from '../types/ranking';
import { RANKING_STATUS_MAP, RANKING_LABEL_MAP, getRankingLabel, getRankingStatusText, getRankingPeriodTitle, getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
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
		const fileName = (this.plugin.settings.ranking?.fileName || getDefaultFileName('rankingFileName')) + '.md';
		return normalizePath(this.currentFolder ? `${this.currentFolder}/${fileName}` : fileName);
	}

findRankingFile(): TFile | null {
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.ranking?.fileName || getDefaultFileName('rankingFileName'));
		for (const name of getDefaultFileNameCandidates('rankingFileName')) candidates.add(name);
		for (const fileName of candidates) {
			const path = normalizePath(this.currentFolder ? this.currentFolder + "/" + fileName + ".md" : fileName + ".md");
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	getRankingFile(): TFile | null {
		return this.findRankingFile();
	}

async createRankingFile(): Promise<TFile> {
		// 检查是否已有限时任务文件（多语言查找）
		const existing = this.findRankingFile();
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.plugin.settings.ranking?.fileName || getDefaultFileName('rankingFileName');
			if (existing.name !== expectedName + '.md') {
				const newPath = normalizePath(this.currentFolder ? this.currentFolder + '/' + expectedName + '.md' : expectedName + '.md');
				try { await this.app.fileManager.renameFile(existing, newPath); } catch (e) { console.warn('[RankingManager] 重命名任务目标文件失败:', e); }
			}
			const foundPath = normalizePath(this.currentFolder ? this.currentFolder + '/' + expectedName + '.md' : expectedName + '.md');
			const found = this.app.vault.getAbstractFileByPath(foundPath);
				return found instanceof TFile ? found : existing;
		}

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
			const periodMatch = firstLine.match(new RegExp(`(?:第(\\d+)期|Period (\\d+)|${t('ranking.period-prefix')}(\\d+))`));
			if (!periodMatch) continue;
			const period = parseInt(periodMatch[1] || periodMatch[2] || periodMatch[3], 10);

			const meta: Record<string, string> = {};
			const metaRegex = /\*\*(.+?)\*\*[：:]\s*(.+)/g;
			let m;
			while ((m = metaRegex.exec(trimmed)) !== null) {
				const key = RANKING_LABEL_MAP[m[1]] || m[1];
				meta[key] = m[2].trim();
			}

			entries.push({
				period,
				platform: meta['platform'] || '',
				position: meta['position'] || '',
				wordTarget: parseInt(meta['wordTarget'] || '0', 10),
				startDate: meta['startDate'] || '',
				endDate: meta['endDate'] || '',
				startSnapshot: parseInt(meta['startSnapshot'] || '0', 10),
				status: (RANKING_STATUS_MAP[meta['status']] as RankingStatus) || 'notStarted',
				completedWords: meta['completedWords'] ? parseInt(meta['completedWords'], 10) : undefined,
				rawBlock: trimmed,
			});
		}

		return entries;
	}

	formatEntry(entry: RankingEntry): string {
		const lines: string[] = [];
		lines.push(`## ${getRankingPeriodTitle(entry.period)}`);
		lines.push('');
		lines.push(`**${getRankingLabel('platform')}**：${entry.platform}`);
		lines.push(`**${getRankingLabel('position')}**：${entry.position}`);
		lines.push(`**${getRankingLabel('wordTarget')}**：${entry.wordTarget}`);
		lines.push(`**${getRankingLabel('startDate')}**：${entry.startDate}`);
		lines.push(`**${getRankingLabel('endDate')}**：${entry.endDate}`);
		lines.push(`**${getRankingLabel('startSnapshot')}**：${entry.startSnapshot}`);
		if (entry.completedWords !== undefined) {
			lines.push(`**${getRankingLabel('completedWords')}**：${entry.completedWords}`);
		}
		lines.push(`**${getRankingLabel('status')}**：${getRankingStatusText(entry.status)}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		return lines.join('\n');
	}

	async addEntry(entry: RankingEntry): Promise<void> {
		return this.writer.enqueue(async () => {
			let file = this.getRankingFile();
			if (!file) file = await this.createRankingFile();

			await this.app.vault.process(file, (existing) => {
				const sep = existing.trim() ? '\n' : '';
				return existing.trimEnd() + sep + this.formatEntry(entry);
			});
		});
	}

	async updateEntryStatus(period: number, status: RankingStatus, completedWords?: number): Promise<void> {
		return this.writer.enqueue(async () => {
			const file = this.getRankingFile();
			if (!file) return;
			await this.app.vault.process(file, (content) => {
				const entries = this.parseEntries(content);

				const entry = entries.find(e => e.period === period && (e.status === 'active' || e.status === 'notStarted'));
				if (!entry) return content;
				
				if (entry.status === status && (completedWords === undefined || entry.completedWords === completedWords)) return content;

				entry.status = status;
				if (completedWords !== undefined) entry.completedWords = completedWords;

				// 全量重写
				let newContent = '';
				for (const e of entries) {
					newContent += this.formatEntry(e);
				}
				return newContent;
			});
		});
	}

	/** 更新进行中任务的完成字数（实时持久化） */
	async updateProgress(period: number, completedWords: number): Promise<void> {
		return this.writer.enqueue(async () => {
			const file = this.getRankingFile();
			if (!file) return;
			await this.app.vault.process(file, (content) => {
				const entries = this.parseEntries(content);
				const entry = entries.find(e => e.period === period && e.status === 'active');
				if (!entry || entry.completedWords === completedWords) return content;
				
				entry.completedWords = completedWords;
				let newContent = '';
				for (const e of entries) {
					newContent += this.formatEntry(e);
				}
				return newContent;
			});
		});
	}

	/** 获取当前进行中的任务 */
	getActiveRanking(entries: RankingEntry[]): RankingEntry | null {
		return entries.find(e => e.status === 'active') || null;
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

	/** 检查并关闭已过期的进行中任务 */
	async checkAndCloseExpired(): Promise<boolean> {
		const entries = await this.loadEntries();
		if (!entries) return false;

		const today = window.moment().format('YYYY-MM-DD');
		let changed = false;

		for (const entry of entries) {
			if (entry.status === 'active' && entry.endDate < today) {
				const progress = this.calcProgress(entry);
				// 如果缓存未就绪（progress=0 但 startSnapshot>0），跳过关闭以避免误判
				if (progress === 0 && entry.startSnapshot > 0) continue;
				const status: RankingStatus = progress >= entry.wordTarget ? 'completed' : 'incomplete';
				await this.updateEntryStatus(entry.period, status, progress);
				changed = true;
			}
		}
		return changed;
	}

	/** 检查进行中但尚未到开始时间的任务，标记为进行中 */
	async activatePendingRankings(): Promise<boolean> {
		const entries = await this.loadEntries();
		if (!entries) return false;

		const today = window.moment().format('YYYY-MM-DD');
		let changed = false;

		for (const entry of entries) {
			if (entry.status === 'notStarted' && entry.startDate <= today) {
				await this.updateEntryStatus(entry.period, 'active');
				changed = true;
			}
		}
		return changed;
	}
}