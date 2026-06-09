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

export function getPluginDir(plugin: { manifest: { dir?: string; id?: string } }): string {
	return plugin.manifest.dir || `.obsidian/plugins/${plugin.manifest.id || 'web-novel-assistant'}`;
}