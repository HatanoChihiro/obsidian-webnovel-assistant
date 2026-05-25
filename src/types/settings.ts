/**
 * 设置相关类型定义
 * 
 * 本文件包含插件设置、主题配置和便签状态相关的类型定义
 */
import { ForeshadowingSettings } from './foreshadowing';
import { RankingSettings } from './ranking';
import { NovelInfoSettings } from './homepage';

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
	/** 是否显示左侧章节列表 */
	immersiveShowChapterList: boolean;
	/** 是否显示右侧参考文档区 */
	immersiveShowReference: boolean;
	/** 是否显示下方悬浮便签陈列区 */
	immersiveShowStickyNotes: boolean;
	/** 是否显示下方伏笔面板 */
	immersiveShowForeshadowing: boolean;
	/** 是否显示下方时间线面板 */
	immersiveShowTimeline: boolean;
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
	/** 左侧面板宽度百分比 */
	/** 数据仪表盘：是否显示榜单进度 */
	immersiveShowRankingProgress: boolean;
	immersiveLeftSize: number;
	/** 右侧面板宽度百分比 */
	immersiveRightSize: number;
	/** 底部面板高度百分比 */
	immersiveBottomSize: number;
	/** 辅助面板内部各子面板的比例数组 */
	immersiveBottomInternalSizes: number[];
	/** 辅助面板位置 ('top' | 'bottom') */
	immersivePanelPosition: 'top' | 'bottom';
	/** 便签显示尺寸 (px) */
	immersiveNoteSize: number;
	/** 便签字体大小 (px) */
	immersiveNoteFontSize: number;
	/** 布局持久化数据 (null 表示使用默认值) */
	immersiveLayout: Record<string, number> | null;
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
	/** 榜单追踪功能设置 */
	ranking: RankingSettings;
	/** 护眼模式：是否启用编辑区绿色背景 */
	eyeCareEnabled: boolean;
	/** 护眼模式背景色（十六进制） */
	eyeCareColor: string;
	/** 是否显示移动端浮动字数统计窗口 */
	showMobileFloatingStats: boolean;
	/** 移动端浮动窗口状态 (x, y) */
	mobileFloatingStatsState: { x: number, y: number } | null;

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

}
