/**
 * 榜单追踪功能相关类型定义
 */

/** 限时任务条目状态（内部 key 为英文，显示文本通过 i18n 获取） */
export type TaskStatus = 'active' | 'completed' | 'incomplete' | 'notStarted';

/** 限时任务条目（解析后的结构化数据） */
// 限时任务类型
export interface TaskEntry {
	/** 期数 */
	period: number;
	/** 任务名称 */
	platform: string;
	/** 任务详情 */
	position: string;
	/** 字数要求 */
	wordTarget: number;
	/** 起始时间 (YYYY-MM-DD) */
	startDate: string;
	/** 结束时间 (YYYY-MM-DD) */
	endDate: string;
	/** 起始字数（创建时文件夹中章节文件的总字数快照） */
	startSnapshot: number;
	/** 状态 */
	status: TaskStatus;
	/** 完成字数（结束时记录的实际增量） */
	completedWords?: number;
	/** 原始文本块 */
	rawBlock: string;
}

/** 限时任务功能设置 */
export interface TaskSettings {
	/** 限时任务文件名（不含 .md 后缀，默认：限时任务） */
	fileName: string;
}
