/**
 * 平台检测工具函数
 */

import { Platform } from 'obsidian';

export function isDesktop(): boolean {
	return !Platform.isMobile;
}

export function isMobile(): boolean {
	return Platform.isMobile;
}

function isTablet(): boolean {
	const isPhone = activeDocument.body.classList.contains('is-phone');
	const isWide = activeWindow.innerWidth >= 768;
	// 兼容旧版 Obsidian：isTablet/isIpad 可能不存在
	const extendedPlatform = Platform as unknown as { isTablet?: boolean; isIpad?: boolean };
	const platformTablet = extendedPlatform.isTablet || extendedPlatform.isIpad || false;
	return Platform.isMobile && (platformTablet || (isWide && !isPhone));
}

export function getPlatformTier(): 'desktop' | 'tablet' | 'mobile' {
	if (isDesktop()) return 'desktop';
	if (isTablet()) return 'tablet';
	return 'mobile';
}

export function getPluginDir(plugin: { manifest: { dir?: string; id?: string }; app: { vault: { configDir: string } } }): string {
	return plugin.manifest.dir || `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id || 'web-novel-assistant'}`;
}

/**
 * 校验设定悬浮卡片是否启用
 * 全平台总开关：未显式配置 enableLorePopover 时，保留桌面端开启与移动端旧配置（enableMobileLorePopover）；
 * 一旦用户显式设置了 enableLorePopover（true 或 false），全平台统一按该值生效。
 */
export function isLorePopoverEnabled(settings?: { enableLorePopover?: boolean; enableMobileLorePopover?: boolean }): boolean {
	if (!settings) return !isMobile();
	if (typeof settings.enableLorePopover === 'boolean') {
		return settings.enableLorePopover;
	}
	return !isMobile() || Boolean(settings.enableMobileLorePopover);
}
