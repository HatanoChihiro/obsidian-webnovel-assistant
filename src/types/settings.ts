/**
 * 设置相关类型定义
 * 
 * 本文件包含插件设置、主题配置和便签状态相关的类型定义
 */
import { ForeshadowingSettings } from './foreshadowing';

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

/**
 * 插件设置接口
 */
export interface AccurateCountSettings {
	/** 默认目标字数 */
	defaultGoal: number;
	/** 当日目标字数（今日新增总字数目标） */
	dailyGoal: number;
	/** 是否显示目标进度 */
	showGoal: boolean;
	/** 是否在文件浏览器中显示字数统计 */
	showExplorerCounts: boolean;
	/** 是否启用智能章节排序 */
	enableSmartChapterSort: boolean;
	/** 是否启用 OBS 直播叠加层 */
	enableObs: boolean;
	/** 是否启用旧版 OBS 文件导出模式 */
	enableLegacyObsExport: boolean;
	/** 每日历史统计数据(键为日期 YYYY-MM-DD) */
	dailyHistory: Record<string, DailyStat>;
	/** OBS 文件导出路径 */
	obsPath: string;
	/** 打开的便签列表 */
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
	/** OBS 叠加层是否显示当日目标进度 */
	obsShowDailyGoal: boolean;
	/** OBS 叠加层是否显示本场净增字数 */
	obsShowSessionWords: boolean;
	/** 伏笔标注功能设置 */
	foreshadowing: ForeshadowingSettings;
	/** 护眼模式：是否启用编辑区绿色背景 */
	eyeCareEnabled: boolean;
	/** 护眼模式背景色（十六进制） */
	eyeCareColor: string;
}
