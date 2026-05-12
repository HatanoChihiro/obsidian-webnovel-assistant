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
	const isPhone = document.body.classList.contains('is-phone');
	const isIpad = Platform.isIpad;
	const isWide = window.innerWidth >= 768;
	return Platform.isMobile && (isIpad || (isWide && !isPhone));
}

export function getPlatformTier(): 'desktop' | 'tablet' | 'mobile' {
	if (isDesktop()) return 'desktop';
	if (isTablet()) return 'tablet';
	return 'mobile';
}