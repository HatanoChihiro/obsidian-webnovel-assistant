import {
	DEFAULT_MOBILE_CUTOUT_OFFSET,
	DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL,
	MOBILE_IMMERSIVE_AUX_VIEW_TYPES,
	VALIDATION_RULES
} from '../constants';
import type { MobileImmersiveAuxPanelState, MobileImmersiveAuxViewType } from '../types/settings';

export interface MobileAuxViewportRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface MobileAuxPanelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MobileAuxClampOptions {
	isMinimized: boolean;
	minWidth?: number;
	minHeight?: number;
	minimizedHeight?: number;
	margin?: number;
}

export const MOBILE_AUX_PANEL_BOUNDS = {
	MIN_WIDTH: 220,
	MAX_WIDTH: 1200,
	MIN_HEIGHT: 160,
	MAX_HEIGHT: 1200,
	MINIMIZED_HEIGHT: 32,
	MIN_COORD: 0,
	MAX_COORD: 10000,
	VIEWPORT_MARGIN: 8
} as const;

const ALLOWED_AUX_VIEW_SET = new Set<string>(MOBILE_IMMERSIVE_AUX_VIEW_TYPES);

function migrateAuxViewType(raw: unknown): MobileImmersiveAuxViewType {
	if (typeof raw !== 'string') return DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.viewType;
	const trimmed = raw.trim();
	const migrated = trimmed === 'timeline-view'
		? 'wn-timeline-view'
		: trimmed === 'corkboard-view'
			? 'webnovel-corkboard'
			: trimmed;
	if (ALLOWED_AUX_VIEW_SET.has(migrated)) {
		return migrated as MobileImmersiveAuxViewType;
	}
	return DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.viewType;
}

function sanitizeFiniteNumber(
	raw: unknown,
	fallback: number,
	min: number,
	max: number
): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return fallback;
	}
	return Math.round(Math.min(max, Math.max(min, raw)));
}

export function sanitizeMobileCutoutOffset(raw: unknown): number {
	const { min, max } = VALIDATION_RULES.IMMERSIVE_MOBILE_CUTOUT_OFFSET;
	return sanitizeFiniteNumber(raw, DEFAULT_MOBILE_CUTOUT_OFFSET, min, max);
}

/**
 * 校验并净化持久化保存的移动端沉浸模式悬浮辅助面板状态。
 * 拒绝非法组件 ID（如独立章节目录、工作台）及 NaN/Infinity/越界尺寸。
 */
export function sanitizeMobileAuxPanelState(raw: unknown): MobileImmersiveAuxPanelState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { ...DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL };
	}
	const src = raw as Record<string, unknown>;
	return {
		viewType: migrateAuxViewType(src.viewType),
		isOpen: typeof src.isOpen === 'boolean' ? src.isOpen : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.isOpen,
		isMinimized: typeof src.isMinimized === 'boolean' ? src.isMinimized : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.isMinimized,
		isLocked: typeof src.isLocked === 'boolean' ? src.isLocked : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.isLocked,
		isDocked: typeof src.isDocked === 'boolean' ? src.isDocked : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.isDocked,
		x: sanitizeFiniteNumber(
			src.x,
			DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.x,
			MOBILE_AUX_PANEL_BOUNDS.MIN_COORD,
			MOBILE_AUX_PANEL_BOUNDS.MAX_COORD
		),
		y: sanitizeFiniteNumber(
			src.y,
			DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.y,
			MOBILE_AUX_PANEL_BOUNDS.MIN_COORD,
			MOBILE_AUX_PANEL_BOUNDS.MAX_COORD
		),
		width: sanitizeFiniteNumber(
			src.width,
			DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.width,
			MOBILE_AUX_PANEL_BOUNDS.MIN_WIDTH,
			MOBILE_AUX_PANEL_BOUNDS.MAX_WIDTH
		),
		height: sanitizeFiniteNumber(
			src.height,
			DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.height,
			MOBILE_AUX_PANEL_BOUNDS.MIN_HEIGHT,
			MOBILE_AUX_PANEL_BOUNDS.MAX_HEIGHT
		)
	};
}

/**
 * 将首选面板几何尺寸约束到当前可视视口内（用于屏幕旋转、窗口缩放、软键盘弹出）。
 * 纯函数，不修改 preferred 参数，确保软键盘造成的临时压缩不会被持久化为首选尺寸。
 */
export function clampMobileAuxPanelGeometry(
	preferred: MobileAuxPanelRect,
	viewport: MobileAuxViewportRect,
	options: MobileAuxClampOptions
): MobileAuxPanelRect {
	const margin = Math.max(0, options.margin ?? MOBILE_AUX_PANEL_BOUNDS.VIEWPORT_MARGIN);
	const minimizedHeight = options.minimizedHeight ?? MOBILE_AUX_PANEL_BOUNDS.MINIMIZED_HEIGHT;
	const safeViewportWidth = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 360;
	const safeViewportHeight = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 480;
	const safeLeft = Number.isFinite(viewport.left) ? viewport.left : 0;
	const safeTop = Number.isFinite(viewport.top) ? viewport.top : 0;

	const availWidth = Math.max(120, safeViewportWidth - margin * 2);
	const availHeight = Math.max(minimizedHeight, safeViewportHeight - margin * 2);

	const minWidth = Math.min(options.minWidth ?? MOBILE_AUX_PANEL_BOUNDS.MIN_WIDTH, availWidth);
	const minHeight = Math.min(options.minHeight ?? MOBILE_AUX_PANEL_BOUNDS.MIN_HEIGHT, availHeight);

	const prefWidth = Number.isFinite(preferred.width) ? preferred.width : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.width;
	const prefHeight = Number.isFinite(preferred.height) ? preferred.height : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.height;
	const prefX = Number.isFinite(preferred.x) ? preferred.x : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.x;
	const prefY = Number.isFinite(preferred.y) ? preferred.y : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.y;

	const width = options.isMinimized
		? Math.min(availWidth, minimizedHeight)
		: Math.min(availWidth, Math.max(minWidth, prefWidth));
	const height = options.isMinimized
		? Math.min(availHeight, minimizedHeight)
		: Math.min(availHeight, Math.max(minHeight, prefHeight));

	const minX = safeLeft + margin;
	const maxX = Math.max(minX, safeLeft + safeViewportWidth - margin - width);
	const minY = safeTop + margin;
	const maxY = Math.max(minY, safeTop + safeViewportHeight - margin - height);

	const x = Math.min(maxX, Math.max(minX, prefX));
	const y = Math.min(maxY, Math.max(minY, prefY));

	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(width),
		height: Math.round(height)
	};
}

/** 平板右侧贴边几何：撑满可用高度，并为主编辑器保留至少半屏或 280px。 */
export function clampTabletDockedAuxPanelGeometry(
	preferredWidth: number,
	viewport: MobileAuxViewportRect
): MobileAuxPanelRect {
	const viewportWidth = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 360;
	const maxWidth = viewportWidth - Math.min(280, viewportWidth / 2);
	const preferred = Number.isFinite(preferredWidth) ? preferredWidth : DEFAULT_MOBILE_IMMERSIVE_AUX_PANEL.width;
	const width = Math.min(maxWidth, Math.max(MOBILE_AUX_PANEL_BOUNDS.MIN_WIDTH, preferred));
	return {
		x: Math.round(viewport.left + viewportWidth - width),
		y: Math.round(viewport.top),
		width: Math.round(width),
		height: Math.max(0, Math.round(viewport.height))
	};
}
