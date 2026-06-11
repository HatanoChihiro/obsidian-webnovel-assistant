/**
 * 数据层 key 映射
 * 用于 Markdown 文件解析/生成时的标签切换
 * 写入时使用当前语言的 key，读取时同时识别中文和英文 key（向后兼容）
 */

import type { Locale } from './index';
import { getLocale } from './index';

// ==========================================
// 伏笔文件字段标签
// ==========================================
const FORESHADOWING_LABELS = {
	'zh-CN': {
		description: '说明',
		tags: '标签',
		status: '状态',
		recoveredAt: '回收于',
	},
	'en': {
		description: 'Description',
		tags: 'Tags',
		status: 'Status',
		recoveredAt: 'Recovered at',
	},
} as const;

// ==========================================
// 伏笔状态值
// ==========================================
const FORESHADOWING_STATUS = {
	'zh-CN': {
		pending: '未回收',
		recovered: '已回收',
		deprecated: '已废弃',
	},
	'en': {
		pending: 'Pending',
		recovered: 'Recovered',
		deprecated: 'Deprecated',
	},
} as const;

/** 伏笔状态双向解析映射（中文值 → 内部 key，英文值 → 内部 key） */
export const FORESHADOWING_STATUS_MAP: Record<string, string> = {
	// 英文 key（新版）
	'pending': 'pending',
	'recovered': 'recovered',
	'deprecated': 'deprecated',
	// 英文本地化值（首字母大写）
	'Pending': 'pending',
	'Recovered': 'recovered',
	'Deprecated': 'deprecated',
	// 中文值（旧版兼容）
	'未回收': 'pending',
	'已回收': 'recovered',
	'已废弃': 'deprecated',
};

/** 伏笔字段标签双向解析映射 */
export const FORESHADOWING_LABEL_MAP: Record<string, string> = {
	// 英文 key（新版）
	'Description': 'description',
	'Tags': 'tags',
	'Status': 'status',
	'Recovered at': 'recoveredAt',
	// 中文 key（旧版兼容）
	'说明': 'description',
	'标签': 'tags',
	'状态': 'status',
	'回收于': 'recoveredAt',
};

// ==========================================
// 时间线文件字段标签
// ==========================================
const TIMELINE_LABELS = {
	'zh-CN': {
		type: '类型',
	},
	'en': {
		type: 'Type',
	},
} as const;

// ==========================================
// 限时任务文件字段标签
// ==========================================
// 限时任务（内部仍用 ranking 命名，待后续重构改为 task）
const RANKING_LABELS = {
	'zh-CN': {
		platform: '名称',
		position: '详情',
		wordTarget: '字数要求',
		startDate: '起始时间',
		endDate: '结束时间',
		startSnapshot: '起始字数',
		completedWords: '完成字数',
		status: '状态',
		periodPrefix: '第',
		periodSuffix: '期',
	},
	'en': {
		platform: 'Name',
		position: 'Details',
		wordTarget: 'Word Target',
		startDate: 'Start Date',
		endDate: 'End Date',
		startSnapshot: 'Start Words',
		completedWords: 'Completed Words',
		status: 'Status',
		periodPrefix: 'Period ',
		periodSuffix: '',
	},
} as const;

// ==========================================
// 限时任务状态值
// ==========================================
// 限时任务状态
const RANKING_STATUS = {
	'zh-CN': {
		active: '进行中',
		completed: '已完成',
		incomplete: '未完成',
		notStarted: '未开始',
	},
	'en': {
		active: 'Active',
		completed: 'Completed',
		incomplete: 'Incomplete',
		notStarted: 'Not Started',
	},
} as const;

/** 限时任务状态双向解析映射 */
export const RANKING_STATUS_MAP: Record<string, string> = {
	'active': 'active',
	'completed': 'completed',
	'incomplete': 'incomplete',
	'notStarted': 'notStarted',
		'Active': 'active',
		'Completed': 'completed',
		'Incomplete': 'incomplete',
		'Not Started': 'notStarted',
	'进行中': 'active',
	'已完成': 'completed',
	'未完成': 'incomplete',
	'未开始': 'notStarted',
};

// ==========================================
// 限时任务字段标签双向解析映射
// ==========================================
export const RANKING_LABEL_MAP: Record<string, string> = {
	// 英文 key（新版）
	'Name': 'platform',
		'Platform': 'platform',
	'Details': 'position',
		'Position': 'position',
	'Word Target': 'wordTarget',
	'Start Date': 'startDate',
	'End Date': 'endDate',
	'Start Words': 'startSnapshot',
	'Completed Words': 'completedWords',
	'Status': 'status',
	// 中文 key（旧版兼容）
	'名称': 'platform',
		'平台': 'platform',
	'详情': 'position',
		'位置': 'position',
	'字数要求': 'wordTarget',
	'起始时间': 'startDate',
	'结束时间': 'endDate',
	'起始字数': 'startSnapshot',
	'完成字数': 'completedWords',
	'状态': 'status',
};

// ==========================================
// 作品信息字段标签
// ==========================================
const NOVEL_INFO_LABELS = {
	'zh-CN': {
		status: '状态',
		synopsis: '简介',
		protagonist: '主角',
		genre: '类型',
		wordGoal: '目标字数',
		startDate: '开始日期',
		endDate: '完结日期',
	},
	'en': {
		status: 'Status',
		synopsis: 'Synopsis',
		protagonist: 'Protagonist',
		genre: 'Genre',
		wordGoal: 'Word Goal',
		startDate: 'Start Date',
		endDate: 'End Date',
	},
} as const;

/** 作品信息字段标签双向解析映射 */
export const NOVEL_INFO_LABEL_MAP: Record<string, string> = {
	'Status': 'status',
	'Synopsis': 'synopsis',
	'Protagonist': 'protagonist',
	'Genre': 'genre',
	'Word Goal': 'wordGoal',
	'Start Date': 'startDate',
	'End Date': 'endDate',
	'状态': 'status',
	'简介': 'synopsis',
	'主角': 'protagonist',
	'类型': 'genre',
	'目标字数': 'wordGoal',
	'开始日期': 'startDate',
	'完结日期': 'endDate',
};

// ==========================================
// 作品状态值
// ==========================================
const NOVEL_STATUS = {
	'zh-CN': {
		ongoing: '连载中',
		stockpiling: '存稿中',
		paused: '已暂停',
		completed: '已完结',
	},
	'en': {
		ongoing: 'Ongoing',
		stockpiling: 'Stockpiling',
		paused: 'Paused',
		completed: 'Completed',
	},
} as const;

/** 作品状态双向解析映射 */
export const NOVEL_STATUS_MAP: Record<string, string> = {
	'ongoing': 'ongoing',
	'stockpiling': 'stockpiling',
	'paused': 'paused',
	'completed': 'completed',
		'Ongoing': 'ongoing',
		'Stockpiling': 'stockpiling',
		'Paused': 'paused',
		'Completed': 'completed',
	'连载中': 'ongoing',
	'存稿中': 'stockpiling',
	'已暂停': 'paused',
	'已完结': 'completed',
};

// ==========================================
// 章节卡片状态值 (CorkboardView)
// ==========================================
const CORKBOARD_STATUS = {
	'zh-CN': {
		unwritten: '待写',
		outline: '大纲',
		draft: '草稿',
		revising: '修稿中',
		final: '已完稿',
	},
	'en': {
		unwritten: 'Unwritten',
		outline: 'Outline',
		draft: 'Draft',
		revising: 'Revising',
		final: 'Final',
	},
} as const;

/** 章节卡片状态双向解析映射 */
export const CORKBOARD_STATUS_MAP: Record<string, string> = {
	'unwritten': 'unwritten',
	'outline': 'outline',
	'draft': 'draft',
	'revising': 'revising',
	'final': 'final',
		'Unwritten': 'unwritten',
		'Outline': 'outline',
		'Draft': 'draft',
		'Revising': 'revising',
		'Final': 'final',
	'待写': 'unwritten',
	'大纲': 'outline',
	'草稿': 'draft',
	'修稿中': 'revising',
	'已完稿': 'final',
};

// ==========================================
// 辅助函数：获取当前语言的标签
// ==========================================


// ==========================================
// 设定文档字段标签
// ==========================================
const LORE_LABELS = {
	'zh-CN': {
		alias: '别名',
	},
	'en': {
		alias: 'Alias',
	},
} as const;

/** 设定文档字段标签双向解析映射 */
export const LORE_LABEL_MAP: Record<string, string> = {
	// 英文
	'Alias': 'alias',
	// 中文
	'别名': 'alias',
};

/** 获取设定文档的字段标签 */
export function getLoreLabel(field: keyof typeof LORE_LABELS['zh-CN']): string {
	return LORE_LABELS[getLocale()][field];
}
/** 获取伏笔文件的字段标签 */
export function getForeshadowingLabel(field: keyof typeof FORESHADOWING_LABELS['zh-CN']): string {
	return FORESHADOWING_LABELS[getLocale()][field];
}

/** 获取伏笔状态显示文本 */
export function getForeshadowingStatusText(statusKey: string): string {
	return FORESHADOWING_STATUS[getLocale()][statusKey as keyof typeof FORESHADOWING_STATUS['zh-CN']] ?? statusKey;
}

/** 获取时间线文件的字段标签 */
export function getTimelineLabel(field: keyof typeof TIMELINE_LABELS['zh-CN']): string {
	return TIMELINE_LABELS[getLocale()][field];
}

/** 获取限时任务文件的字段标签 */
export function getRankingLabel(field: keyof typeof RANKING_LABELS['zh-CN']): string {
	return RANKING_LABELS[getLocale()][field];
}

/** 获取任务期数标题 */
export function getRankingPeriodTitle(period: number): string {
	const labels = RANKING_LABELS[getLocale()];
	return `${labels.periodPrefix}${period}${labels.periodSuffix}`;
}

/** 获取限时任务状态显示文本 */
export function getRankingStatusText(statusKey: string): string {
	return RANKING_STATUS[getLocale()][statusKey as keyof typeof RANKING_STATUS['zh-CN']] ?? statusKey;
}

/** 获取作品信息字段标签 */
export function getNovelInfoLabel(field: keyof typeof NOVEL_INFO_LABELS['zh-CN']): string {
	return NOVEL_INFO_LABELS[getLocale()][field];
}

/** 获取作品状态显示文本 */
export function getNovelStatusText(statusKey: string): string {
	return NOVEL_STATUS[getLocale()][statusKey as keyof typeof NOVEL_STATUS['zh-CN']] ?? statusKey;
}

/** 获取章节卡片状态显示文本 */
export function getCorkboardStatusText(statusKey: string): string {
	return CORKBOARD_STATUS[getLocale()][statusKey as keyof typeof CORKBOARD_STATUS['zh-CN']] ?? statusKey;
}

/** 获取所有章节卡片状态的 key 列表 */
export function getCorkboardStatusKeys(): string[] {
	return Object.keys(CORKBOARD_STATUS['zh-CN']);
}

// ==========================================
// 默认文件名/标签/类型的语言映射
// ==========================================
const DEFAULT_NAMES = {
	'zh-CN': {
		foreshadowingFileName: '伏笔',
		timelineFileName: '时间线',
		rankingFileName: '限时任务',
		novelInfoFileName: '作品信息',
		loreFolderName: '设定',
		homepageWelcome: '欢迎回到创作中心',
	},
	'en': {
		foreshadowingFileName: 'Foreshadowing',
		timelineFileName: 'Timeline',
		rankingFileName: 'Time-limited Task',
		novelInfoFileName: 'Novel Info',
		loreFolderName: 'Lore',
		homepageWelcome: 'Welcome back to your creative space',
	},
} as const;

const DEFAULT_TAGS = {
	'zh-CN': ['人物', '情节', '世界观', '道具', '线索'],
	'en': ['Character', 'Plot', 'Worldbuilding', 'Artifact', 'Clue'],
} as const;

const DEFAULT_TYPES = {
	'zh-CN': ['主线', '支线', '回忆', '伏笔线', '暗线'],
	'en': ['Main', 'Subplot', 'Flashback', 'Foreshadowing', 'Hidden'],
} as const;

/** 获取当前语言的默认文件名 */
export function getDefaultFileName(field: keyof typeof DEFAULT_NAMES['zh-CN']): string {
	return DEFAULT_NAMES[getLocale()][field];
}

/** 获取所有语言的默认文件名候选列表（用于文件查找的 fallback） */
export function getDefaultFileNameCandidates(field: keyof typeof DEFAULT_NAMES['zh-CN']): string[] {
		const candidates = Object.values(DEFAULT_NAMES).map(names => names[field]);
		// 旧版本遗留的文件名，用于向后兼容查找
		const legacyNames: Record<string, string[]> = {
			rankingFileName: ['榜单记录', 'Ranking'],
			foreshadowingFileName: ['伏笔'],
			timelineFileName: ['时间线'],
			novelInfoFileName: ['作品信息'],
			loreFolderName: ['设定'],
			homepageFileName: ['创作主页'],
		};
		if (legacyNames[field]) {
			for (const name of legacyNames[field]) {
				if (!candidates.includes(name)) candidates.push(name);
			}
		}
		return candidates;
	}

/** 获取当前语言的默认标签列表 */
export function getDefaultTags(): string[] {
	return DEFAULT_TAGS[getLocale()].slice();
}

/** 获取当前语言的默认类型列表 */
export function getDefaultTypes(): string[] {
	return DEFAULT_TYPES[getLocale()].slice();
}

/**
 * 根据当前语言覆盖默认设置中的中文值
 * 仅在首次安装（无旧数据）时使用
 */
export function getLocalizedDefaults(locale?: Locale): {
	foreshadowingFileName: string;
	timelineFileName: string;
	rankingFileName: string;
	novelInfoFileName: string;
	loreFolderName: string;
	homepageWelcome: string;
	defaultTags: string[];
	defaultTypes: string[];
} {
	const effectiveLocale = locale || getLocale();
	return {
		foreshadowingFileName: DEFAULT_NAMES[effectiveLocale].foreshadowingFileName,
		timelineFileName: DEFAULT_NAMES[effectiveLocale].timelineFileName,
		rankingFileName: DEFAULT_NAMES[effectiveLocale].rankingFileName,
		novelInfoFileName: DEFAULT_NAMES[effectiveLocale].novelInfoFileName,
		loreFolderName: DEFAULT_NAMES[effectiveLocale].loreFolderName,
		homepageWelcome: DEFAULT_NAMES[effectiveLocale].homepageWelcome,
		defaultTags: DEFAULT_TAGS[effectiveLocale].slice(),
		defaultTypes: DEFAULT_TYPES[effectiveLocale].slice(),
	};
}
