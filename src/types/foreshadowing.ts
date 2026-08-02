/**
 * 伏笔标注相关类型定义
 */

/** 伏笔状态枚举（内部 key 为英文，显示文本通过 i18n 获取） */
export enum ForeshadowingStatus {
	Pending            = "pending",
	PartiallyRecovered = "partially_recovered",
	Recovered          = "recovered",
	Deprecated         = "deprecated"
}

/** 伏笔回收/推进单条日志 */
export interface ForeshadowingRecoveryLog {
	/** 类型：stage (阶段回收) 或 final (彻底回收) */
	stageType: 'stage' | 'final';
	/** 回收/推进发生的章节文件名 */
	file: string;
	/** 发生时间，格式 YYYY-MM-DD HH:mm */
	time: string;
	/** 阶段推进或终结说明（可选） */
	note?: string;
	/** 关联回收原文摘录（可选） */
	quote?: string;
}

/** 伏笔数据解析结构（供视图展示） */
export interface ParsedForeshadowingEntry {
	/** 来源文件名 */
	sourceFile: string;
	/** 创建时间 */
	createdAt: string;
	/** 引用内容列表（支持多个引用合并到一个说明下） */
	contents: { 
		/** 引用来源文件（可选，用于合并条目） */
		source: string; 
		/** 引用时间（可选） */
		time: string; 
		/** 引用正文 */
		text: string 
	}[];
	/** 伏笔说明 */
	description: string;
	/** 标签 */
	tags: string[];
	/** 状态 */
	status: ForeshadowingStatus;
	/** 新版多阶段回收日志列表 */
	recoveryLogs?: ForeshadowingRecoveryLog[];
	/** 回收章节文件名列表（向后兼容） */
	recoveryFiles?: string[];
	/** 回收时间列表（向后兼容） */
	recoveredAts?: string[];
	/** 旧版单个回收章节（向后兼容） */
	recoveryFile?: string;
	/** 旧版单个回收时间（向后兼容） */
	recoveredAt?: string;
	/** 解析时的原始 Markdown 块（视图内部使用） */
	rawBlock?: string;
}

/** 单条伏笔数据结构（用于保存新条目） */
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
	/** 新版多阶段回收日志列表 */
	recoveryLogs?: ForeshadowingRecoveryLog[];
	/** 回收章节文件名列表（多章节回收，向后兼容） */
	recoveryFiles?: string[];
	/** 回收时间列表（与 recoveryFiles 对应，向后兼容） */
	recoveredAts?: string[];
	/** 旧版单个回收章节（向后兼容） */
	recoveryFile?: string;
	/** 旧版单个回收时间（向后兼容） */
	recoveredAt?: string;
}

/** 伏笔功能相关设置 */
export interface ForeshadowingSettings {
	/** 伏笔文件名（不含 .md 后缀，默认：伏笔） */
	fileName: string;
	/**
	 * 是否在标题中显示时间戳
	 * @deprecated 格式已升级，时间戳始终显示在引用来源行中，此配置不再生效
	 */
	showTimestamp: boolean;
	/** 常用标签列表 */
	defaultTags: string[];
}
