import type { App, TFile } from 'obsidian';
import {
	DEFAULT_MOBILE_DASHBOARD_ITEMS,
	MOBILE_DASHBOARD_STAT_KEYS
} from '../constants';
import { t } from '../i18n';
import type { MobileDashboardStatKey } from '../types/settings';
import type { CoreStatsPayload } from '../types/stats';
import type { TaskEntry } from '../types/task';
import { formatTime } from '../utils/format';
import { findBookRoot, type FindBookRootPlugin } from '../utils/path';

const VALID_MOBILE_DASHBOARD_KEYS = new Set<string>(MOBILE_DASHBOARD_STAT_KEYS);

export type MobileDashboardTone = 'default' | 'focus' | 'slack';

export interface MobileDashboardTaskManagerLike {
	loadEntries(folderPath: string): Promise<TaskEntry[] | null>;
	getActiveTask(entries: TaskEntry[]): TaskEntry | null;
	calcProgress(entry: TaskEntry, folderPath: string): number;
}

export interface MobileDashboardTaskHost {
	settings?: Partial<FindBookRootPlugin['settings']>;
	taskManager?: MobileDashboardTaskManagerLike;
	lastTaskFolder?: string;
}

/**
 * 净化并约束移动端数据栏显示项：
 * - 未定义或非数组时回退默认 4 项
 * - 过滤非法值、去重并按固定顺序排列（允许用户全部关闭为空数组）
 */
export function sanitizeMobileDashboardItems(raw: unknown): MobileDashboardStatKey[] {
	if (!Array.isArray(raw)) {
		return [...DEFAULT_MOBILE_DASHBOARD_ITEMS];
	}
	const chosen = new Set<MobileDashboardStatKey>();
	for (const item of raw) {
		if (typeof item === 'string' && VALID_MOBILE_DASHBOARD_KEYS.has(item)) {
			chosen.add(item as MobileDashboardStatKey);
		}
	}
	return MOBILE_DASHBOARD_STAT_KEYS.filter(key => chosen.has(key));
}

export function toggleMobileDashboardItem(
	current: unknown,
	key: MobileDashboardStatKey,
	enabled: boolean
): MobileDashboardStatKey[] {
	const items = sanitizeMobileDashboardItems(current);
	return enabled ? sanitizeMobileDashboardItems([...items, key]) : items.filter(item => item !== key);
}

export function getMobileDashboardItemTone(key: MobileDashboardStatKey): MobileDashboardTone {
	if (key === 'focusTime') return 'focus';
	if (key === 'slackTime') return 'slack';
	return 'default';
}

export function formatMobileSessionWords(words: number): string {
	const safeWords = Math.max(0, Math.round(words || 0));
	const unit = t('common.word-char');
	const sep = /^[a-z]/i.test(unit) ? ' ' : '';
	return `+${safeWords}${sep}${unit}`;
}

export function formatMobileCurrentTime(date: Date = new Date()): string {
	return date.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

export type MobileCoreStatsSlice = Pick<
	CoreStatsPayload,
	| 'totalTime'
	| 'focusTime'
	| 'slackTime'
	| 'todayWords'
	| 'goal'
	| 'dailyWords'
	| 'dailyGoal'
	| 'sessionWords'
	| 'sessionSpeed'
>;

export function formatMobileDashboardValues(
	stats: MobileCoreStatsSlice,
	taskProgress?: { words: number; goal: number },
	now: Date = new Date()
): Record<MobileDashboardStatKey, string> {
	return {
		totalTime: stats.totalTime || '00:00:00',
		focusTime: stats.focusTime || '00:00:00',
		slackTime: stats.slackTime || '00:00:00',
		chapterProgress: `${stats.todayWords ?? 0}/${stats.goal ?? 0}`,
		dailyProgress: `${stats.dailyWords ?? 0}/${stats.dailyGoal ?? 0}`,
		taskProgress: `${taskProgress?.words ?? 0}/${taskProgress?.goal ?? 0}`,
		sessionWords: formatMobileSessionWords(stats.sessionWords ?? 0),
		sessionSpeed: `${stats.sessionSpeed ?? 0} ${t('common.words-per-hour-unit')}`,
		currentTime: formatMobileCurrentTime(now)
	};
}

export function formatMobileTimerValues(params: {
	focusMs?: number;
	slackMs?: number;
	sessionSpeed: number;
	now?: Date;
}): Pick<Record<MobileDashboardStatKey, string>, 'totalTime' | 'focusTime' | 'slackTime' | 'sessionSpeed' | 'currentTime'> {
	const focusSec = Math.max(0, Math.round((params.focusMs || 0) / 1000));
	const slackSec = Math.max(0, Math.round((params.slackMs || 0) / 1000));
	const totalSec = focusSec + slackSec;
	return {
		totalTime: formatTime(totalSec),
		focusTime: formatTime(focusSec),
		slackTime: formatTime(slackSec),
		sessionSpeed: `${params.sessionSpeed} ${t('common.words-per-hour-unit')}`,
		currentTime: formatMobileCurrentTime(params.now)
	};
}

export async function resolveMobileTaskProgress(params: {
	app: App;
	plugin: MobileDashboardTaskHost;
	file: TFile | null;
}): Promise<{ words: number; goal: number }> {
	const { app, plugin, file } = params;
	if (!plugin.taskManager) {
		return { words: 0, goal: 0 };
	}
	let taskFolder = '';
	const s = plugin.settings;
	if (file && s && Array.isArray(s.workspaceFolders)) {
		try {
			const bookRootPlugin: FindBookRootPlugin = {
				settings: {
					workspaceFolders: s.workspaceFolders,
					loreFolderName: s.loreFolderName ?? '',
					timeline: s.timeline ?? { fileName: '', defaultTypes: [] },
					foreshadowing: s.foreshadowing ?? { fileName: '', defaultTags: [] },
					novelInfo: s.novelInfo ?? { fileName: '' }
				}
			};
			taskFolder = findBookRoot(app, bookRootPlugin, file) || '';
			plugin.lastTaskFolder = taskFolder;
		} catch {
			taskFolder = plugin.lastTaskFolder || '';
		}
	} else if (plugin.lastTaskFolder) {
		taskFolder = plugin.lastTaskFolder;
	}
	if (!taskFolder) {
		return { words: 0, goal: 0 };
	}
	try {
		const entries = await plugin.taskManager.loadEntries(taskFolder);
		if (entries) {
			const active = plugin.taskManager.getActiveTask(entries);
			if (active) {
				return {
					words: plugin.taskManager.calcProgress(active, taskFolder),
					goal: active.wordTarget
				};
			}
		}
	} catch {
		// Ignore task read failures so topbar/floating stats continue rendering
	}
	return { words: 0, goal: 0 };
}
