/**
 * 统计数据类型定义
 * 
 * 本文件包含 OBS 叠加层统计数据、缓存条目和验证结果相关的类型定义
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
	/** 当日目标字数 */
	dailyGoal: number;
	/** 当日完成百分比(0-100) */
	dailyPercent: number;
	/** 当前文件名 */
	currentFile: string;
}

/**
 * 缓存条目
 * 
 * 用于文件夹字数缓存系统
 */
export interface CacheEntry {
	/** 文件或文件夹路径 */
	path: string;
	/** 字数统计 */
	wordCount: number;
	/** 最后修改时间戳(毫秒) */
	lastModified: number;
}

/**
 * 验证结果
 * 
 * 用于配置验证系统
 */
export interface ValidationResult {
	/** 验证是否通过 */
	valid: boolean;
	/** 错误消息列表 */
	errors: string[];
}
