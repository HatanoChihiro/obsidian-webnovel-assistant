/**
 * 平台检测工具函数
 * 提供平台检测和功能分级逻辑
 * 
 * ## 功能分级策略 (需求 8.1, 8.2, 8.4, 8.6)
 * 
 * ### 核心功能 (所有平台)
 * - 精准字数统计
 * - 写作目标追踪
 * - 状态栏显示
 * - 设置页面
 * 
 * ### 扩展功能 (仅桌面端)
 * - 悬浮便签 (需要桌面级 DOM 操作)
 * - OBS 直播叠加层 (需要 Node.js HTTP 服务器)
 * - 实时状态视图 (占用屏幕空间)
 * - Worker 时间追踪 (耗电)
 * - 文件夹字数缓存 (内存占用)
 * - 历史统计图表
 * 
 * ### 使用方式
 * 
 * 在插件加载时:
 * ```typescript
 * async onload() {
 *   // 1. 加载核心功能 (所有平台)
 *   await this.loadSettings();
 *   this.setupStatusBar();
 *   
 *   // 2. 平台检测和功能分级
 *   if (isMobile()) {
 *     // 移动端 Lite 模式: 只注册右键菜单
 *     this.setupMobileMode();
 *     return; // 停止加载桌面功能
 *   }
 *   
 *   // 3. 桌面端完整模式: 加载所有扩展功能
 *   this.setupDesktopMode();
 * }
 * ```
 */

import { Platform } from 'obsidian';

/**
 * 检查是否为桌面端
 * @returns 如果是桌面端返回 true
 * 
 * @example
 * ```typescript
 * if (isDesktop()) {
 *   // 加载桌面端专属功能
 * }
 * ```
 */
export function isDesktop(): boolean {
	return Platform.isDesktop || Platform.isDesktopApp;
}

/**
 * 检查是否为移动端
 * @returns 如果是移动端返回 true
 * 
 * @example
 * ```typescript
 * if (isMobile()) {
 *   // 使用移动端优化的 UI
 * }
 * ```
 */
export function isMobile(): boolean {
	return Platform.isMobile || Platform.isMobileApp;
}

/**
 * 检查是否为平板设备
 * 平板定义：移动设备且屏幕宽度 >= 768px
 * @returns 如果是平板返回 true
 * 
 * @example
 * ```typescript
 * if (isTablet()) {
 *   // 启用平板优化功能
 * }
 * ```
 */
export function isTablet(): boolean {
	return isMobile() && window.innerWidth >= 768;
}

/**
 * 获取平台层级
 * @returns 'desktop' | 'tablet' | 'mobile'
 * 
 * @example
 * ```typescript
 * const tier = getPlatformTier();
 * if (tier === 'tablet') {
 *   // 启用部分高级功能
 * }
 * ```
 */
export function getPlatformTier(): 'desktop' | 'tablet' | 'mobile' {
	if (isDesktop()) return 'desktop';
	if (isTablet()) return 'tablet';
	return 'mobile';
}

/**
 * 检查是否为 iOS 设备
 * @returns 如果是 iOS 返回 true
 */
export function isIOS(): boolean {
	return Platform.isIosApp;
}

/**
 * 检查是否为 Android 设备
 * @returns 如果是 Android 返回 true
 */
export function isAndroid(): boolean {
	return Platform.isAndroidApp;
}

/**
 * 获取平台名称
 * @returns 平台名称字符串
 * 
 * @example
 * ```typescript
 * const platform = getPlatformName(); // 'Desktop', 'iOS', 'Android', 'Mobile'
 * ```
 */
export function getPlatformName(): string {
	if (Platform.isIosApp) return 'iOS';
	if (Platform.isAndroidApp) return 'Android';
	if (Platform.isMobile) return 'Mobile';
	if (Platform.isDesktop) return 'Desktop';
	return 'Unknown';
}

/**
 * 检查是否支持高级功能
 * 高级功能包括: OBS 服务器、悬浮便签、Worker 等
 * 桌面端支持所有高级功能
 * @returns 如果支持高级功能返回 true
 * 
 * @example
 * ```typescript
 * if (supportsAdvancedFeatures()) {
 *   // 启用 OBS 服务器
 *   // 启用悬浮便签
 * }
 * ```
 */
export function supportsAdvancedFeatures(): boolean {
	return isDesktop();
}

/**
 * 检查是否支持面板功能
 * 面板功能包括: 伏笔面板、时间线面板、状态视图面板
 * 桌面端和平板端支持面板功能
 * @returns 如果支持面板功能返回 true
 * 
 * @example
 * ```typescript
 * if (supportsPanelFeatures()) {
 *   // 启用伏笔面板
 *   // 启用时间线面板
 * }
 * ```
 */
export function supportsPanelFeatures(): boolean {
	return isDesktop() || isTablet();
}

/**
 * 检查是否支持 Node.js 模块
 * @returns 如果支持 Node.js 模块返回 true
 * 
 * @example
 * ```typescript
 * if (supportsNodeModules()) {
 *   const fs = window.require('fs');
 * }
 * ```
 */
export function supportsNodeModules(): boolean {
	return isDesktop() && typeof window !== 'undefined' && 'require' in window;
}

/**
 * 获取触摸目标的推荐尺寸
 * 移动端使用更大的触摸目标以提高可用性
 * @returns 推荐的按钮尺寸(像素)
 * 
 * @example
 * ```typescript
 * const buttonSize = getTouchTargetSize(); // 移动端: 44, 桌面端: 32
 * button.style.minWidth = `${buttonSize}px`;
 * ```
 */
export function getTouchTargetSize(): number {
	return isMobile() ? 44 : 32;
}
