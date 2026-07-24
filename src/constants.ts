/**
 * 全局常量定义
 * 集中管理所有魔法值，便于维护和调整
 */

// ==========================================
// 防抖延迟配置（毫秒）
// ==========================================
export const DEBOUNCE_DELAYS = {
	/** 编辑器更新防抖延迟 */
	EDITOR_UPDATE: 300,
	/** 文件夹刷新防抖延迟 */
	FOLDER_REFRESH: 500,
	/** 字数统计更新防抖延迟 */
	WORD_COUNT_UPDATE: 100,
	/** Worker 心跳间隔 */
	WORKER_TICK: 1000,
} as const;

// ==========================================
// 缓存配置
// ==========================================
export const CACHE_CONFIG = {
	/** 最大缓存条目数 */
	MAX_SIZE: 10000,
	/** 缓存失效超时时间（毫秒） */
	INVALIDATION_TIMEOUT: 5000,
	/** 字数计算缓存最大条目数 */
	WORD_COUNT_CACHE_MAX: 100,
} as const;

// ==========================================
// OBS 服务器配置
// ==========================================
export const OBS_CONFIG = {
	/** 默认监听端口 */
	DEFAULT_PORT: 24816,
	/** 叠加层默认不透明度 */
	OVERLAY_OPACITY: 0.9,
	/** 服务器启动超时时间（毫秒） */
	STARTUP_TIMEOUT: 5000,
} as const;

// ==========================================
// 便签配置
// ==========================================
export const STICKY_NOTE_CONFIG = {
	/** 默认宽度（像素） */
	DEFAULT_WIDTH: 300,
	/** 默认高度（像素） */
	DEFAULT_HEIGHT: 200,
	/** 最小宽度（像素） */
	MIN_WIDTH: 150,
	/** 最小高度（像素） */
	MIN_HEIGHT: 100,
	/** 默认不透明度 */
	DEFAULT_OPACITY: 0.95,
	/** 最小不透明度 */
	MIN_OPACITY: 0.1,
	/** 最大不透明度 */
	MAX_OPACITY: 1.0,
} as const;

// ==========================================
// 时间追踪配置
// ==========================================
export const TRACKING_CONFIG = {
	/** 默认空闲超时阈值（毫秒） */
	DEFAULT_IDLE_TIMEOUT: 30000,
	/** 最小空闲超时阈值（毫秒） */
	MIN_IDLE_TIMEOUT: 10000,
	/** 最大空闲超时阈值（毫秒） */
	MAX_IDLE_TIMEOUT: 3600000,
	/** Worker 自动重启延迟（毫秒） */
	WORKER_RESTART_DELAY: 5000,
} as const;

// ==========================================
// 中文数字映射表
// ==========================================
export const CHINESE_NUMBERS = {
	'零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
	'〇': 0, '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5, '陆': 6, '柒': 7, '捌': 8, '玖': 9, '拾': 10,
	'百': 100, '佰': 100, '千': 1000, '仟': 1000, '万': 10000, '萬': 10000
} as const;

// ==========================================
// 视图类型常量
// ==========================================
export const VIEW_TYPES = {
	STATUS: 'status-view',
	FORESHADOWING: 'foreshadowing-view',
	TIMELINE: 'wn-timeline-view',
	TASK: 'task-view',
	CREATIVE: 'creative-view',
	CORKBOARD: 'webnovel-corkboard',
	IMMERSIVE_CHAPTER_LIST: 'immersive-chapter-list-view',
	IMMERSIVE_STICKY_NOTES: 'immersive-sticky-notes-view',
	RELATION_GRAPH: 'webnovel-relation-graph',
} as const;

// ==========================================
// 平台延迟配置（毫秒）
// ==========================================
export const PLATFORM_DELAYS = {
	/** 桌面端文件浏览器初始化延迟 */
	DESKTOP_EXPLORER_DELAY: 500,
	/** 平板端文件浏览器初始化延迟 */
	TABLET_EXPLORER_DELAY: 1000,
	/** 移动端文件浏览器初始化延迟 */
	MOBILE_EXPLORER_DELAY: 1500,
	/** 移动端/平板端缓存刷新延迟 */
	MOBILE_CACHE_REFRESH_DELAY: 500,
} as const;

// ==========================================
// 正则表达式常量
// ==========================================
export const REGEX_PATTERNS = {
	/** 中文字符（工厂函数，避免 g 标志状态残留） */
	CHINESE: () => /[\u4E00-\u9FFF]/g,
	/** 英文单词（工厂函数，避免 g 标志状态残留） */
	ENGLISH_WORD: () => /[a-zA-Z]+/g,
	/** 数字（工厂函数，避免 g 标志状态残留） */
	NUMBER: () => /\d+/g,
	/** 标点符号（工厂函数，避免 g 标志状态残留） */
	PUNCTUATION: () => /[，。！？；：""''（）【】《》、·…—～]/g,

	// Markdown 清理正则（用于字数统计）
	/** Frontmatter（不带 g 标志，只匹配开头） */
	FRONTMATTER: /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/,
	/** 代码块（工厂函数，避免 g 标志状态残留） */
	CODE_BLOCK: () => /```[\s\S]*?```/g,
	/** 行内代码（工厂函数，避免 g 标志状态残留） */
	INLINE_CODE: () => /`[^`]*`/g,
	/** 标题符号（工厂函数，避免 gm 标志状态残留） */
	HEADING: () => /^#{1,6}\s/gm,
	/** 加粗（工厂函数，避免 g 标志状态残留） */
	BOLD: () => /(\*\*|__)(.*?)\1/g,
	/** 斜体（工厂函数，避免 g 标志状态残留） */
	ITALIC: () => /(\*|_)(.*?)\1/g,
	/** Obsidian 内部链接（工厂函数，避免 g 标志状态残留） */
	INTERNAL_LINK: () => /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
	/** 普通链接（工厂函数，避免 g 标志状态残留） */
	LINK: () => /\[([^\]]*)\]\([^)]*\)/g,
	/** 图片（工厂函数，避免 g 标志状态残留） */
	IMAGE: () => /!\[[^\]]*\]\([^)]*\)/g,
	/** HTML 标签（工厂函数，避免 g 标志状态残留） */
	HTML_TAG: () => /<[^>]+>/g,
	/** 引用符号（gm 标志，保持不变） */
	QUOTE: /^>\s?/gm,
	/** 分隔线（gm 标志，保持不变） */
	SEPARATOR: /^[-*_]{3,}\s*$/gm,
	/** 无序列表符号（gm 标志，保持不变） */
	UNORDERED_LIST: /^[\s]*[-*+]\s/gm,
	/** 有序列表符号（gm 标志，保持不变） */
	ORDERED_LIST: /^[\s]*\d+\.\s/gm,
	/** 删除线（工厂函数，避免 g 标志状态残留） */
	STRIKETHROUGH: () => /~~(.*?)~~/g,
	/** 脚注引用标记（工厂函数，避免 g 标志状态残留） */
	FOOTNOTE_REF: () => /\[\^[^\]]+\]/g,
	/** 任务列表标记（gm 标志，保持不变） */
	TASK_LIST: /^[\s]*[-*+]\s\[[ xX]\]\s/gm,
	/** 表格分隔行（gm 标志，保持不变） */
	TABLE_SEPARATOR: /^\|?[\s:]*-{3,}[\s:]*(?:\|[\s:]*-{3,}[\s:]*)*\|?\s*$/gm,
	/** 空白字符（工厂函数，避免 g 标志状态残留） */
	WHITESPACE: () => /\s+/g,
	/** 中日韩字符（工厂函数，避免 g 标志状态残留） */
	CJK_CHAR: () => /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g,
	/** 英文单词及数字组合（工厂函数，避免 g 标志状态残留） */
	WORD_TOKEN: () => /[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]+/g,
	/** 全角标点（工厂函数，避免 g 标志状态残留） */
	FULLWIDTH_PUNCT: () => /[，。！？、；：“”‘’（）《》【】……——]/g,
} as const;

// ==========================================
// 时间格式常量
// ==========================================
export const TIME_FORMATS = {
	/** 日期格式 */
	DATE: 'YYYY-MM-DD',
	/** 时间格式 */
	TIME: 'HH:mm:ss',
	/** 日期时间格式 */
	DATETIME: 'YYYY-MM-DD HH:mm:ss',
	/** 文件名格式 */
	FILENAME: 'YYYYMMDD_HHmmss',
} as const;

// ==========================================
// 通知消息常量

// ==========================================
// 验证规则常量
// ==========================================
export const VALIDATION_RULES = {
	/** 端口号范围 */
	PORT_RANGE: { min: 1024, max: 65535 },
	/** 空闲超时范围（秒） */
	IDLE_TIMEOUT_RANGE: { min: 10, max: 3600 },
	/** 不透明度范围 */
	OPACITY_RANGE: { min: 0.1, max: 1.0 },
	/** 目标字数最小值 */
	MIN_GOAL: 0,
} as const;

import type { AccurateCountSettings } from './types/settings';
// 已迁移到嵌套结构的扁平化字段名（用于设置迁移和清理）
export const FLAT_OBS_KEYS = [
	'enableObs', 'obsPort',
	'obsOverlayTheme', 'obsOverlayOpacity', 'obsCustomCss',
	'obsShowFocusTime', 'obsShowSlackTime', 'obsShowTotalTime',
	'obsShowTodayWords', 'obsShowDailyGoal', 'obsShowSessionWords'
];

export const FLAT_IMMERSIVE_KEYS = [
	'immersiveTopSlots', 'immersiveBottomSlots', 'immersiveLeftSlots', 'immersiveRightSlots',
	'immersiveTopSize', 'immersiveBottomSize', 'immersiveLeftSize', 'immersiveRightSize',
	'immersiveShowTotalTime',
	'immersiveShowFocusTime', 'immersiveShowSlackTime', 'immersiveShowChapterProgress',
	'immersiveShowDailyProgress', 'immersiveShowSessionWords', 'immersiveShowTaskProgress',
	'immersiveHideProperties',
	'immersiveTopInternalSizes', 'immersiveBottomInternalSizes', 'immersiveLeftInternalSizes', 'immersiveRightInternalSizes',
	'immersiveNoteSize', 'immersiveNoteFontSize', 'immersiveLayout'
];



export const DEFAULT_SETTINGS: AccurateCountSettings = {
	language: 'auto',
	wordCountMethod: 'standard',
	defaultGoal: 3000,
	dailyGoal: 5000,
	showGoal: false,
	showExplorerCounts: false, // 默认关闭，避免性能问题
	enableChapterTemplate: false,
	enableSmartChapterSort: false, // 默认关闭，避免与用户习惯冲突
	chapterTemplatePath: '',
	chapterNamingRules: [
		{ name: '阿拉伯数字（第1章、第01章）', pattern: '^(?:第(\\d+)[章节回卷部册篇]?|第?(\\d+)[章节回卷部册篇])', enabled: true },
		{ name: '中文数字（第一章、第二章）', pattern: '^(?:第([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]?|第?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇])', enabled: true },
		{ name: '纯数字及标题（1、01、001 标题）', pattern: '^(\\d+)(?:[ \\-].*)?$', enabled: true },
		{ name: '英文章节 (Chapter 1, Ch.1)', pattern: '^[Cc]h(?:apter)?\\.?\\s*(\\d+)', enabled: false },
		{ name: '全能括号 ( (1)、【30】 )', pattern: '^[（\\(【「{]([0-9零一二三四五六七八九十百千万]+)[）\\)】」}]', enabled: false },
	],
	workspaceFolders: [],
	showFloatingNotes: true,
	noteOpacity: 0.9,
	idleTimeoutThreshold: 60 * 1000,
	noteThemes: [
		{ bg: '#FDF3B8', text: '#2C3E50' }, // 鹅黄色
		{ bg: '#FCDDEC', text: '#5D2E46' }, // 樱花粉
		{ bg: '#CCE8CF', text: '#2A4A30' }, // 豆沙绿
		{ bg: '#2C3E50', text: '#F8F9FA' }, // 暗夜蓝
		{ bg: '#E8DFF5', text: '#4A3B69' }, // 薰衣草
		{ bg: '#FDE0C1', text: '#593D2B' }  // 杏仁黄
	],
	foreshadowing: {
		fileName: '伏笔',
		showTimestamp: true,
		defaultTags: ['人物', '情节', '世界观', '道具', '线索'],
	},
	timeline: {
		fileName: '时间线',
		defaultTypes: ['主线', '支线', '回忆', '伏笔线', '暗线'],
	},
	task: {
		fileName: '限时任务',
	},
	eyeCareEnabled: false,
	eyeCareColor: '#E8F5E9',
	showMobileFloatingStats: false, // 默认不显示移动端浮窗
	enableMobileFocusTimer: false, // 默认不启用移动端计时器
	mobileFloatingStatsState: null, // 默认无保存状态
	enableStrictChapterMode: false, // 严格章节模式，默认关闭
	strictChapterExceptions: [],
	enableWordCountGutter: false,
	wordCountInterval: 2000,
	enableSelectionWordCount: false,
	nextNoteThemeIndex: 0,
	stickyNoteAutoSave: true,

	// 沉浸模式默认设置
	immersive: {
		immersiveTopSlots: ['immersive-sticky-notes-view', 'foreshadowing-view', 'wn-timeline-view'],
		immersiveBottomSlots: [],
		immersiveLeftSlots: ['immersive-chapter-list-view'],
		immersiveRightSlots: ['reference-view'],
		immersiveTopSize: 20,
		immersiveBottomSize: 20,
		immersiveLeftSize: 20,
		immersiveRightSize: 20,

		immersiveTopInternalSizes: [],
		immersiveBottomInternalSizes: [],
		immersiveLeftInternalSizes: [],
		immersiveRightInternalSizes: [],

		immersiveShowTotalTime: true,
		immersiveShowFocusTime: true,
		immersiveShowSlackTime: true,
		immersiveShowChapterProgress: true,
		immersiveShowDailyProgress: true,
		immersiveShowSessionWords: true,
		immersiveShowTaskProgress: true,

		immersiveHideProperties: true,

		immersiveNoteSize: 280,
		immersiveNoteFontSize: 14,
		immersiveLayout: null,

		typewriterEnabled: false,
		typewriterCenterOffset: 0,
		typewriterUnfocusedOpacity: 0.4,
	},

	// OBS 数据输出默认设置
	obs: {
		enableObs: false,
		obsPort: 24816,
		obsOverlayTheme: 'dark',
		obsOverlayOpacity: 0.85,
		obsCustomCss: '',
		obsShowFocusTime: true,
		obsShowSlackTime: true,
		obsShowTotalTime: true,
		obsShowTodayWords: true,
		obsShowDailyGoal: true,
		obsShowSessionWords: true,
	},

	// 创作主页默认设置
	enableHomepage: false,
	openHomepageOnStartup: false,
	homepagePath: '',
	homepageWelcome: '',
	heatmapStartDate: '',
	heatmapEndDate: '',
	novelInfo: { fileName: '作品信息' },
	homepagePinPosition: 'top',
	customSortOrder: {},
	loreFolderName: '设定',
	lorePopoverCollapse: false,
	enableMobileLorePopover: false,
	loreGraphAutoLinkMentions: false,
	loreGraphEnableGlobal: false,
	advancedSearchQuery: '',
	debugMode: false,
};

