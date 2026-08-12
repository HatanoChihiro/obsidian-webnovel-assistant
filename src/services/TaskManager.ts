// 限时任务追踪管理器（内部仍用 Task 命名，待后续重构改为 Task）
import type { App} from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import { t } from '../i18n';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { TaskEntry, TaskStatus, TaskType } from '../types/task';
import { TASK_STATUS_MAP, TASK_LABEL_MAP, TASK_TYPE_MAP, getTaskLabel, getTaskStatusText, getTaskTypeText, getTaskPeriodTitle, getDefaultFileName, getDefaultFileNameCandidates } from '../i18n/data-keys';
import { SerializedWriter } from '../utils/SerializedWriter';

export class TaskManager {
	private writer = new SerializedWriter();

	constructor(
		private app: App,
		private plugin: WebNovelAssistantPlugin,
		public currentFolder: string = ''
	) {}

	getTaskFilePath(folderPath: string = this.currentFolder): string {
		const fileName = (this.plugin.settings.task?.fileName || getDefaultFileName('taskFileName')) + '.md';
		return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
	}

	findTaskFile(folderPath: string = this.currentFolder): TFile | null {
		const candidates = new Set<string>();
		candidates.add(this.plugin.settings.task?.fileName || getDefaultFileName('taskFileName'));
		for (const name of getDefaultFileNameCandidates('taskFileName')) candidates.add(name);
		for (const fileName of candidates) {
			const path = normalizePath(folderPath ? folderPath + "/" + fileName + ".md" : fileName + ".md");
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	getTaskFile(folderPath: string = this.currentFolder): TFile | null {
		return this.findTaskFile(folderPath);
	}

	async createTaskFile(folderPath: string = this.currentFolder): Promise<TFile> {
		// 检查是否已有限时任务文件（多语言查找）
		const existing = this.findTaskFile(folderPath);
		if (existing) {
			// 如果找到的文件名与当前设置不一致，自动重命名
			const expectedName = this.plugin.settings.task?.fileName || getDefaultFileName('taskFileName');
			if (existing.name !== expectedName + '.md') {
				const newPath = normalizePath(folderPath ? folderPath + '/' + expectedName + '.md' : expectedName + '.md');
				try { await this.app.fileManager.renameFile(existing, newPath); } catch (e) { console.warn('[TaskManager] 重命名任务目标文件失败:', e); }
			}
			const foundPath = normalizePath(folderPath ? folderPath + '/' + expectedName + '.md' : expectedName + '.md');
			const found = this.app.vault.getAbstractFileByPath(foundPath);
				return found instanceof TFile ? found : existing;
		}

		const path = this.getTaskFilePath(folderPath);
		return await this.app.vault.create(path, '');
	}

	async loadEntries(folderPath: string = this.currentFolder): Promise<TaskEntry[] | null> {
		const file = this.getTaskFile(folderPath);
		if (!file) return null;
		const content = await this.app.vault.read(file);
		return this.parseEntries(content);
	}

	parseEntries(content: string): TaskEntry[] {
		const entries: TaskEntry[] = [];
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed.startsWith('## ')) continue;

			const firstLine = trimmed.split('\n')[0];
			const periodMatch = firstLine.match(new RegExp(`(?:第(\\d+)期|Period (\\d+)|${t('task.period-prefix')}(\\d+))`));
			if (!periodMatch) continue;
			const period = parseInt(periodMatch[1] || periodMatch[2] || periodMatch[3], 10);

			const meta: Record<string, string> = {};
			const metaRegex = /\*\*(.+?)\*\*[：:]\s*(.+)/g;
			let m;
			while ((m = metaRegex.exec(trimmed)) !== null) {
				const key = TASK_LABEL_MAP[m[1]] || m[1];
				meta[key] = m[2].trim();
			}

			const taskType: TaskType = (TASK_TYPE_MAP[meta['taskType']] as TaskType) || 'wordCount';

			entries.push({
				period,
				platform: meta['platform'] || '',
				position: meta['position'] || '',
				taskType,
				wordTarget: parseInt(meta['wordTarget'] || '0', 10),
				startDate: meta['startDate'] || '',
				endDate: meta['endDate'] || '',
				startSnapshot: parseInt(meta['startSnapshot'] || '0', 10),
				status: (TASK_STATUS_MAP[meta['status']] as TaskStatus) || 'notStarted',
				completedWords: meta['completedWords'] ? parseInt(meta['completedWords'], 10) : undefined,
				rawBlock: trimmed,
			});
		}

		return entries;
	}

	formatEntry(entry: TaskEntry): string {
		const lines: string[] = [];
		lines.push(`## ${getTaskPeriodTitle(entry.period)}`);
		lines.push('');
		lines.push(`**${getTaskLabel('platform')}**：${entry.platform}`);
		lines.push(`**${getTaskLabel('position')}**：${entry.position}`);
		lines.push(`**${getTaskLabel('taskType')}**：${getTaskTypeText(entry.taskType || 'wordCount')}`);
		if (entry.taskType !== 'event') {
			lines.push(`**${getTaskLabel('wordTarget')}**：${entry.wordTarget}`);
		}
		lines.push(`**${getTaskLabel('startDate')}**：${entry.startDate}`);
		lines.push(`**${getTaskLabel('endDate')}**：${entry.endDate}`);
		if (entry.taskType !== 'event') {
			lines.push(`**${getTaskLabel('startSnapshot')}**：${entry.startSnapshot}`);
		}
		if (entry.completedWords !== undefined && entry.taskType !== 'event') {
			lines.push(`**${getTaskLabel('completedWords')}**：${entry.completedWords}`);
		}
		lines.push(`**${getTaskLabel('status')}**：${getTaskStatusText(entry.status)}`);
		lines.push('');
		lines.push('---');
		lines.push('');
		return lines.join('\n');
	}

	async addEntry(entry: TaskEntry, folderPath: string = this.currentFolder): Promise<void> {
		return this.writer.enqueue(async () => {
			let file = this.getTaskFile(folderPath);
			if (!file) file = await this.createTaskFile(folderPath);

			await this.app.vault.process(file, (existing) => {
				const sep = existing.trim() ? '\n' : '';
				return existing.trimEnd() + sep + this.formatEntry(entry);
			});
		});
	}

	async updateEntryStatus(period: number, status: TaskStatus, completedWords?: number, taskType?: TaskType, folderPath: string = this.currentFolder): Promise<void> {
		return this.writer.enqueue(async () => {
			const file = this.getTaskFile(folderPath);
			if (!file) return;
			await this.app.vault.process(file, (content) => {
				const entries = this.parseEntries(content);

				const entry = entries.find(e => e.period === period && (taskType === undefined || (e.taskType || 'wordCount') === taskType) && (e.status === 'active' || e.status === 'notStarted'));
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
	async updateProgress(period: number, completedWords: number, folderPath: string = this.currentFolder): Promise<void> {
		return this.writer.enqueue(async () => {
			const file = this.getTaskFile(folderPath);
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
	getActiveTask(entries: TaskEntry[]): TaskEntry | null {
		return entries.find(e => e.status === 'active') || null;
	}

	/** 获取下一期期数（根据任务类型独立计算递增） */
	getNextPeriod(entries: TaskEntry[], taskType: TaskType = 'wordCount'): number {
		if (!entries || entries.length === 0) return 1;
		const typedEntries = entries.filter(e => (e.taskType || 'wordCount') === taskType);
		if (typedEntries.length === 0) return 1;
		return Math.max(...typedEntries.map(e => e.period)) + 1;
	}

	/** 计算当前增量字数 */
	calcProgress(entry: TaskEntry, folderPath: string = this.currentFolder): number {
		const currentWords = this.getChapterWordCount(folderPath);
		return Math.max(0, currentWords - entry.startSnapshot);
	}

	/** 获取当前文件夹中章节文件的总字数 */
	getChapterWordCount(folderPath: string = this.currentFolder): number {
		const normalizedFolderPath = folderPath === '/' ? '' : folderPath;
		// 文件树的字数统计本身就基于缓存，且会包含所有分卷字数
		const count = this.plugin.cacheManager.getFolderWordCount(normalizedFolderPath);
		return count || 0;
	}
	/** 检查并关闭已过期的进行中任务 */
	async checkAndCloseExpired(folderPath: string = this.currentFolder): Promise<boolean> {
		const entries = await this.loadEntries(folderPath);
		if (!entries) return false;

		const today = window.moment().format('YYYY-MM-DD');
		let changed = false;

		for (const entry of entries) {
			if (entry.status === 'active' && entry.endDate < today) {
				if (entry.taskType === 'event') {
					await this.updateEntryStatus(entry.period, 'incomplete', undefined, entry.taskType, folderPath);
					changed = true;
				} else {
					const progress = this.calcProgress(entry, folderPath);
					// 如果缓存未就绪（progress=0 但 startSnapshot>0），跳过关闭以避免误判
					if (progress === 0 && entry.startSnapshot > 0) continue;
					const status: TaskStatus = progress >= entry.wordTarget ? 'completed' : 'incomplete';
					await this.updateEntryStatus(entry.period, status, progress, entry.taskType, folderPath);
					changed = true;
				}
			}
		}
		return changed;
	}

	/** 检查进行中但尚未到开始时间的任务，标记为进行中 */
	async activatePendingTasks(folderPath: string = this.currentFolder): Promise<boolean> {
		const entries = await this.loadEntries(folderPath);
		if (!entries) return false;

		const today = window.moment().format('YYYY-MM-DD');
		let changed = false;

		for (const entry of entries) {
			if (entry.status === 'notStarted' && entry.startDate <= today) {
				await this.updateEntryStatus(entry.period, 'active', undefined, entry.taskType, folderPath);
				changed = true;
			}
		}
		return changed;
	}
}
