/**
 * 统计数据类型定义
 * 
 * 本文件包含 OBS 叠加层统计数据相关的类型定义
 * 
 * 注意：
 * - CacheEntry 已统一定义在 services/CacheManager.ts 中（唯一使用方）
 * - ValidationResult 已统一定义在 utils/validation.ts 中
 */

/**
 * OBS 叠加层统计数据负载
 * 
 * 用于向 OBS 直播叠加层提供实时统计信息
 */
export interface ObsStatsPayload {
	/** 是否正在追踪统计 */
	isTracking: boolean;
	/** 专注时长(格式化字符串 HH:MM:SS) */
	focusTime: string;
	/** 摸鱼时长(格式化字符串 HH:MM:SS) */
	slackTime: string;
	/** 总计时长(格式化字符串 HH:MM:SS) */
	totalTime: string;
	/** 本场净增字数 */
	sessionWords: number;
	/** 今日已写字数（当前章节总字数） */
	todayWords: number;
	/** 章节目标字数 */
	goal: number;
	/** 章节完成百分比(0-100) */
	percent: number;
	/** 今日新增总字数 */
	dailyWords: number;
	/** 今日目标字数 */
	dailyGoal: number;
	/** 今日完成百分比(0-100) */
	dailyPercent: number;
	/** 任务已增字数 */
	rankingWords: number;
	/** 任务目标字数 */
	rankingGoal: number;
	/** 当前文件名 */
	currentFile: string;
	/** 当前所在文件夹名 */
	currentFolder: string;
}
