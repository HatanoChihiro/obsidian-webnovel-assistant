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
	TIMELINE: 'timeline-view',
	CREATIVE: 'creative-view',
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
	FRONTMATTER: /^---[\s\S]*?---\n?/,
	/** 代码块（工厂函数，避免 g 标志状态残留） */
	CODE_BLOCK: () => /```[\s\S]*?```/g,
	/** 行内代码（工厂函数，避免 g 标志状态残留） */
	INLINE_CODE: () => /`[^`]*`/g,
	/** 标题符号（gm 标志，保持不变） */
	HEADING: /^#{1,6}\s/gm,
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
	/** 空白字符（工厂函数，避免 g 标志状态残留） */
	WHITESPACE: () => /\s+/g,
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
export const MESSAGES = {
	// 成功消息
	SUCCESS_SAVE: '[成功] 已保存',
	SUCCESS_ADD: '[成功] 已添加',
	SUCCESS_DELETE: '[成功] 已删除',
	SUCCESS_UPDATE: '[成功] 已更新',
	
	// 错误消息
	ERROR_SAVE: '[错误] 保存失败',
	ERROR_ADD: '[错误] 添加失败',
	ERROR_DELETE: '[错误] 删除失败',
	ERROR_INVALID_INPUT: '[错误] 输入无效',
	ERROR_FILE_NOT_FOUND: '[错误] 文件不存在',
	
	// 警告消息
	WARNING_WORKER_RESTART: '[警告] 时间追踪 Worker 已自动重启',
	WARNING_CACHE_FULL: '[警告] 缓存已满，清理旧数据',
	
	// 提示消息
	INFO_LOADING: '[处理中] 加载中...',
	INFO_PROCESSING: '[处理中] 处理中...',
} as const;

// ==========================================
// 样式常量
// ==========================================
export const STYLES = {
	/** 输入框样式 */
	INPUT_STYLE: 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;',
	
	/** 按钮容器样式 */
	BUTTON_CONTAINER_STYLE: 'display:flex;justify-content:flex-end;gap:10px;margin-top:16px;',
	
	/** 标签按钮样式 */
	TAG_BUTTON_STYLE: 'padding:2px 10px;border-radius:12px;border:1px solid var(--interactive-accent);color:var(--interactive-accent);background:transparent;cursor:pointer;font-size:0.85em;',
} as const;

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
