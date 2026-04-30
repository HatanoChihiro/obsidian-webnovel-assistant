/**
 * 设置相关类型定义
 * 
 * 本文件包含插件设置、主题配置和便签状态相关的类型定义
 */
import { ForeshadowingSettings } from './foreshadowing';

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
	/** 是否启用 OBS 直播叠加层 */
	enableObs: boolean;
	/** 是否启用旧版 OBS 文件导出模式 */
	enableLegacyObsExport: boolean;
	/** 
	 * 每日历史统计数据(键为日期 YYYY-MM-DD)
	 * @deprecated 已迁移到 HistoryDataManager，保留此字段仅为降级兼容
	 */
	dailyHistory: Record<string, DailyStat>;
	/** OBS 文件导出路径 */
	obsPath: string;
	/** 
	 * 打开的便签列表 
	 * @deprecated 已迁移到 StickyNoteDataManager，保留此字段仅为降级兼容
	 */
	openNotes: StickyNoteState[];
	/** 便签不透明度(0.1-1.0) */
	noteOpacity: number;
	/** 便签主题配色列表 */
	noteThemes: ThemeScheme[];
	/** 空闲超时阈值(毫秒) */
	idleTimeoutThreshold: number;
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
	/** 伏笔标注功能设置 */
	foreshadowing: ForeshadowingSettings;
	/** 时间线功能设置 */
	timeline: TimelineSettings;
	/** 护眼模式：是否启用编辑区绿色背景 */
	eyeCareEnabled: boolean;
	/** 护眼模式背景色（十六进制） */
	eyeCareColor: string;
	/** 是否显示移动端浮动字数统计窗口 */
	showMobileFloatingStats: boolean;
	/** 便签是否自动保存（全局设置） */
	stickyNoteAutoSave: boolean;

	// === 沉浸模式 (Immersive Mode) 设置 ===
	/** 沉浸模式：是否显示左侧章节列表 */
	immersiveShowChapterList: boolean;
	/** 沉浸模式：是否显示右侧参考文档区 */
	immersiveShowReference: boolean;
	/** 沉浸模式：是否显示下方悬浮便签陈列区 */
	immersiveShowStickyNotes: boolean;
	/** 沉浸模式：是否显示下方伏笔面板 */
	immersiveShowForeshadowing: boolean;
	/** 沉浸模式：是否显示下方时间线面板 */
	immersiveShowTimeline: boolean;
	/** 沉浸模式数据仪表盘：是否显示总计时间 */
	immersiveShowTotalTime: boolean;
	/** 沉浸模式数据仪表盘：是否显示专注时间 */
	immersiveShowFocusTime: boolean;
	/** 沉浸模式数据仪表盘：是否显示摸鱼时间 */
	immersiveShowSlackTime: boolean;
	/** 沉浸模式数据仪表盘：是否显示章节目标进度 */
	immersiveShowChapterProgress: boolean;
	/** 沉浸模式数据仪表盘：是否显示今日目标进度 */
	immersiveShowDailyProgress: boolean;
	/** 沉浸模式数据仪表盘：是否显示本场净增字数 */
	immersiveShowSessionWords: boolean;
	/** 沉浸模式：左侧面板宽度百分比 */
	immersiveLeftSize: number;
	/** 沉浸模式：右侧面板宽度百分比 */
	immersiveRightSize: number;
	/** 沉浸模式：底部面板高度百分比 */
	immersiveBottomSize: number;
	/** 沉浸模式：辅助面板内部各子面板的比例数组 */
	immersiveBottomInternalSizes: number[];
	/** 下一个新建便签的主题索引（用于颜色轮换） */
	nextNoteThemeIndex: number;
	/** 沉浸模式：辅助面板位置 ('top' | 'bottom') */
	immersivePanelPosition: 'top' | 'bottom';
	/** 沉浸模式：便签显示尺寸 (px) */
	immersiveNoteSize: number;
	/** 沉浸模式：便签字体大小 (px) */
	immersiveNoteFontSize: number;
	/** 沉浸模式：是否开启打字机模式适配 (优化滚动跳转) */
	immersiveTypewriterMode: boolean;
}
