/**
 * 设置相关类型定义
 * 
 * 本文件包含插件设置、主题配置和便签状态相关的类型定义
 */
import type { ForeshadowingSettings } from './foreshadowing';
import type { TaskSettings } from './task';
import type { NovelInfoSettings } from './homepage';

/** 时间线功能相关设置 */
export interface TimelineSettings {
	/** 时间线文件名（不含 .md 后缀，默认：时间线） */
	fileName: string;
	/** 默认类型标签列表 */
	defaultTypes: string[];
}

/**
 * 每日统计数据
 */
export interface DailyStat {
	/** 专注时长(毫秒) */
	focusMs: number;
	/** 摸鱼时长(毫秒) */
	slackMs: number;
	/** 新增字数 */
	addedWords: number;
	hourlyFocus?: number[];
	hourlySlack?: number[];
}

/**
 * 主题配色方案
 */
export interface ThemeScheme {
	/** 背景色(十六进制) */
	bg: string;
	/** 文字颜色(十六进制) */
	text: string;
}

/**
 * 悬浮便签状态
 */
export interface StickyNoteState {
	/** 便签唯一标识符 */
	id: string;
	/** 关联的文件路径(可选) */
	filePath?: string;
	/** 便签内容(可选) */
	content?: string;
	/** 便签标题(可选) */
	title?: string;
	/** 顶部位置(CSS 值) */
	top: string;
	/** 左侧位置(CSS 值) */
	left: string;
	/** 宽度(CSS 值) */
	width: string;
	/** 高度(CSS 值) */
	height: string;
	/** 背景颜色(十六进制) */
	color: string;
	/** 文字颜色(十六进制,可选) */
	textColor?: string;
	/** 是否处于编辑模式 */
	isEditing: boolean;
	/** 是否已钉住(禁止拖拽和缩放) */
	isPinned?: boolean;
	/** 文字缩放级别 */
	zoomLevel?: number;
}

/** 章节命名规则 */
export interface ChapterNamingRule {
	/** 规则名称 */
	name: string;
	/** 正则表达式模式 */
	pattern: string;
	/** 是否启用 */
	enabled: boolean;
}

/** 沉浸模式设置 */
export interface ImmersiveModeSettings {
	/** 沉浸模式：顶部插槽组件 ID 列表 */
	immersiveTopSlots: string[];
	/** 沉浸模式：底部插槽组件 ID 列表 */
	immersiveBottomSlots: string[];
	/** 沉浸模式：左侧插槽组件 ID 列表 */
	immersiveLeftSlots: string[];
	/** 沉浸模式：右侧插槽组件 ID 列表 */
	immersiveRightSlots: string[];
	
	/** 顶部区域占比 */
	immersiveTopSize: number;
	/** 底部区域占比 */
	immersiveBottomSize: number;
	/** 左侧区域占比 */
	immersiveLeftSize: number;
	/** 右侧区域占比 */
	immersiveRightSize: number;

	/** 内部组件占比 */
	immersiveTopInternalSizes: number[];
	immersiveBottomInternalSizes: number[];
	immersiveLeftInternalSizes: number[];
	immersiveRightInternalSizes: number[];

	/** 数据仪表盘：是否显示总计时间 */
	immersiveShowTotalTime: boolean;
	/** 数据仪表盘：是否显示专注时间 */
	immersiveShowFocusTime: boolean;
	/** 数据仪表盘：是否显示摸鱼时间 */
	immersiveShowSlackTime: boolean;
	/** 数据仪表盘：是否显示章节目标进度 */
	immersiveShowChapterProgress: boolean;
	/** 数据仪表盘：是否显示今日目标进度 */
	immersiveShowDailyProgress: boolean;
	/** 数据仪表盘：是否显示本场净增字数 */
	immersiveShowSessionWords: boolean;
	/** 数据仪表盘：是否显示任务进度 */
	immersiveShowTaskProgress: boolean;

	/** 是否隐藏笔记属性面板 */
	immersiveHideProperties: boolean;

	/** 便签显示尺寸 (px) */
	immersiveNoteSize: number;
	/** 便签字体大小 (px) */
	immersiveNoteFontSize: number;
	/** 布局持久化数据 (null 表示使用默认值) */
	immersiveLayout: Record<string, number> | null;
	/** 记忆参考文档的路径 */
	lastReferenceFilePath?: string;

	/** 是否启用沉浸模式打字机居中与淡化功能 */
	typewriterEnabled: boolean;
	/** 打字机模式中心垂直偏移量 (%) (-30 到 30) */
	typewriterCenterOffset: number;
	/** 打字机模式未聚焦行淡化不透明度 (0.1 到 1.0) */
	typewriterUnfocusedOpacity: number;
}

/** OBS 数据输出设置 */
export interface ObsSettings {
	/** 是否启用 OBS HTTP 服务器叠加层 */
	enableObs: boolean;
	/** OBS HTTP 服务器端口 */
	obsPort: number;
	/** OBS 叠加层主题 */
	obsOverlayTheme: string;
	/** OBS 叠加层不透明度(0.1-1.0) */
	obsOverlayOpacity: number;
	/** OBS 叠加层自定义 CSS */
	obsCustomCss: string;
	/** OBS 叠加层是否显示专注时长 */
	obsShowFocusTime: boolean;
	/** OBS 叠加层是否显示摸鱼时长 */
	obsShowSlackTime: boolean;
	/** OBS 叠加层是否显示总计时长 */
	obsShowTotalTime: boolean;
	/** OBS 叠加层是否显示今日字数 */
	obsShowTodayWords: boolean;
	/** OBS 叠加层是否显示今日目标进度 */
	obsShowDailyGoal: boolean;
	/** OBS 叠加层是否显示本场净增字数 */
	obsShowSessionWords: boolean;
}

/**
 * 插件设置接口
 */
export interface AccurateCountSettings {
	/** 界面语言 */
	language: 'zh-CN' | 'en' | 'auto';
	/** 字数统计方式 */
	wordCountMethod: 'webnovel' | 'standard' | 'obsidian';
	/** 默认目标字数 */
	defaultGoal: number;
	/** 今日目标字数（今日新增总字数目标） */
	dailyGoal: number;
	/** 是否显示目标进度 */
	showGoal: boolean;
	/** 是否在文件浏览器中显示字数统计 */
	showExplorerCounts: boolean;
	/** 是否启用智能章节排序 */
	enableSmartChapterSort: boolean;
	/** 章节命名规则列表（用于自定义排序和合并） */
	chapterNamingRules: ChapterNamingRule[];
	/** 工作区文件夹路径（留空则全局生效） */
	workspaceFolders: string[];
	workspacePaths?: string[];
	/** 是否显示所有悬浮便签 */
	showFloatingNotes: boolean;
	/** 便签不透明度(0.1-1.0) */
	noteOpacity: number;
	/** 便签主题配色列表 */
	noteThemes: ThemeScheme[];
	/** 空闲超时阈值(毫秒) */
	idleTimeoutThreshold: number;
	/** 伏笔标注功能设置 */
	foreshadowing: ForeshadowingSettings;
	/** 时间线功能设置 */
	timeline: TimelineSettings;
	/** 限时任务追踪功能设置 */
	task: TaskSettings;
	/** 护眼模式：是否启用编辑区绿色背景 */
	eyeCareEnabled: boolean;
	/** 护眼模式背景色（十六进制） */
	eyeCareColor: string;
	/** 是否显示移动端浮动字数统计窗口 */
	showMobileFloatingStats: boolean;
	/** 是否在移动端启用专注计时（实验性） */
	enableMobileFocusTimer: boolean;
	/** 移动端浮动窗口状态 (x, y) */
	mobileFloatingStatsState: { x: number; y: number; isDocked?: boolean; dockEdge?: 'left' | 'right' } | null;

	/** 严格章节模式：只在章节文档中计算字数、进度和提醒 */
	enableStrictChapterMode: boolean;
	/** 严格章节模式例外目录：这些目录下的文件不受严格章节模式限制，始终计入字数 */
	strictChapterExceptions: string[];


	/** 便签是否自动保存（全局设置） */
	stickyNoteAutoSave: boolean;
	/** 是否启用字数实时提醒（在左侧行号区显示累计字数） */
	enableWordCountGutter: boolean;
	/** 字数实时提醒的字数间隔 */
	wordCountInterval: number;
	/** 是否启用选区字数统计悬浮窗 */
	enableSelectionWordCount: boolean;

	/** 下一个新建便签的主题索引（用于颜色轮换） */
	nextNoteThemeIndex: number;

	// === 嵌套子设置 ===
	/** 沉浸模式设置 */
	immersive: ImmersiveModeSettings;
	/** OBS 数据输出设置 */
	obs: ObsSettings;
	/** 是否启用创作主页 */
	enableHomepage: boolean;
	/** 是否在启动时自动打开创作主页 */
	openHomepageOnStartup: boolean;
	/** 创作主页文件路径（Vault 相对路径，默认：创作主页.md） */
	homepagePath: string;
	/** 作品信息文件设置 */
	novelInfo: NovelInfoSettings;
	/** 主页欢迎语 */
	homepageWelcome: string;
	/** 热力图自定义开始日期 */
	heatmapStartDate: string;
	/** 热力图自定义结束日期 */
	heatmapEndDate: string;
	/** 创作主页文件在文件树中的置顶位置 */
	homepagePinPosition: 'none' | 'top' | 'bottom';
	/** 非章节文件自定义排序（路径 → 排序位置） */
	customSortOrder: Record<string, number>;
	
	/** 设定文件夹名称（相对作品根目录，用于人物卡悬停） */
	loreFolderName: string;

	/** 设定速查悬浮卡片中子标题是否默认折叠 */
	lorePopoverCollapse: boolean;

	/** 移动端是否启用设定悬浮/点击卡片 */
	enableMobileLorePopover: boolean;

	/** 设定图谱是否自动关联提及的设定 */
	loreGraphAutoLinkMentions: boolean;

	/** 是否启用跨文件图谱关联 */
	loreGraphEnableGlobal: boolean;

	/** 章节一览面板的排序模式 */
	corkboardSortMode?: 'default' | 'timeline' | 'lore' | 'task' | 'sticky' | 'foreshadowing';

	/** 设定看板展示布局 */
	loreBoardLayout?: 'table' | 'cards' | 'graph';

	/** 高级搜索：自动记忆的上一次搜索词 */
	advancedSearchQuery: string;

	/** 是否启用章节模板 */
	enableChapterTemplate: boolean;

	/** 默认章节模板路径（旧版兼容） */
	chapterTemplatePath: string;

	/** 章节模板路径列表 */
	chapterTemplatePaths: string[];

	/** 是否开启调试模式（在控制台输出详细日志） */
	debugMode: boolean;

	/** 沉浸模式布局快照（JSON 字符串），用于异常退出后恢复 */
	_savedImmersiveLayout?: string | null;
}

export type WebNovelAssistantSettings = AccurateCountSettings;
