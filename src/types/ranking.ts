/**
 * 榜单追踪功能相关类型定义
 */

/** 榜单条目状态 */
export type RankingStatus = '进行中' | '已完成' | '未完成' | '未开始';

/** 榜单条目（解析后的结构化数据） */
export interface RankingEntry {
	/** 期数 */
	period: number;
	/** 签约平台 */
	platform: string;
	/** 榜单位置 */
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
	status: RankingStatus;
	/** 完成字数（结束时记录的实际增量） */
	completedWords?: number;
	/** 原始文本块 */
	rawBlock: string;
}

/** 榜单功能设置 */
export interface RankingSettings {
	/** 榜单记录文件名（不含 .md 后缀，默认：榜单记录） */
	fileName: string;
}
