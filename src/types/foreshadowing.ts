/**
 * 伏笔标注相关类型定义
 */

/** 伏笔状态枚举 */
export enum ForeshadowingStatus {
	Pending    = "未回收",
	Recovered  = "已回收",
	Deprecated = "已废弃"
}

/** 单条伏笔数据结构 */
export interface ForeshadowingEntry {
	/** 来源文件名（不含 .md 后缀） */
	sourceFile: string;
	/** 选中的原文内容 */
	content: string;
	/** 用户补充说明 */
	description: string;
	/** 标签数组，如 ["人物", "情节"] */
	tags: string[];
	/** 当前状态 */
	status: ForeshadowingStatus;
	/** 创建时间，格式 YYYY-MM-DD HH:mm */
	createdAt: string;
	/** 回收时间，格式 YYYY-MM-DD HH:mm（仅已回收时有值） */
	recoveredAt?: string;
	/** 回收章节文件名（不含 .md 后缀） */
	recoveryFile?: string;
}

/** 伏笔功能相关设置 */
export interface ForeshadowingSettings {
	/** 伏笔文件名（不含 .md 后缀，默认：伏笔） */
	fileName: string;
	/** 是否在标题中显示时间戳（默认：true） */
	showTimestamp: boolean;
	/** 常用标签列表 */
	defaultTags: string[];
}
