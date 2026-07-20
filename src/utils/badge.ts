/**
 * Badge 渲染工具函数
 *
 * 将章节卡片和章节列表中重复出现的伏笔 badge + 设定 badge 渲染逻辑统一封装，
 * 避免在 WorkbenchView / ChapterOverviewView 之间重复维护相同代码。
 */

import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { LoreHoverPopover } from '../ui/LoreHoverPopover';
import { t } from '../i18n';
import type { TooltipOptions } from 'obsidian';
import { setTooltip } from 'obsidian';


/**
 * 渲染伏笔相关 Badge（待回收 / 本章回收）
 *
 * @param container          要挂载 Badge 的父容器
 * @param cardForeshadowings 与该卡片关联的伏笔条目列表
 */
export function renderForeshadowingBadges(
	container: HTMLElement,
	cardForeshadowings: ParsedForeshadowingEntry[],
	currentBasename?: string
): void {
	const tooltipOptions: TooltipOptions = { classes: ['wn-tooltip-left'] };

	// 待回收
	const pendingForeshadowings = cardForeshadowings.filter(
		f => f.status === ForeshadowingStatus.Pending
	);
	if (pendingForeshadowings.length > 0) {
		const badge = container.createEl('span', {
			cls: 'wn-badge wn-badge-foreshadowing',
			text: `${t('corkboard.foreshadowing-unresolved')}×${pendingForeshadowings.length}`
		});
		setTooltip(badge, pendingForeshadowings.map(f => f.description).join('\n'), tooltipOptions);
	}

	// 已回收 (在其他章节回收的，本章只是提出或提及)
	if (currentBasename) {
		const resolvedOriginForeshadowings = cardForeshadowings.filter(
			f => f.status === ForeshadowingStatus.Recovered && !isRecoveredIn(f, currentBasename)
		);
		if (resolvedOriginForeshadowings.length > 0) {
			const badge = container.createEl('span', {
				cls: 'wn-badge wn-badge-recovered',
				text: `${t('corkboard.foreshadowing-recovered-origin')}×${resolvedOriginForeshadowings.length}`
			});
			setTooltip(badge, resolvedOriginForeshadowings.map(f => f.description).join('\n'), tooltipOptions);
		}
	}

	// 本章回收 (在本章实际发生回收的)
	const recoveredForeshadowings = currentBasename
		? cardForeshadowings.filter(f => f.status === ForeshadowingStatus.Recovered && isRecoveredIn(f, currentBasename))
		: cardForeshadowings.filter(f => f.status === ForeshadowingStatus.Recovered);

	if (recoveredForeshadowings.length > 0) {
		const badge = container.createEl('span', {
			cls: 'wn-badge wn-badge-recovered',
			text: `${t('corkboard.foreshadowing-recovered')}×${recoveredForeshadowings.length}`
		});
		setTooltip(badge, recoveredForeshadowings.map(f => f.description).join('\n'), tooltipOptions);
	}
}

function isMatch(target: string | undefined, basename: string): boolean {
    if (!target) return false;
    const targetBase = target.split('|')[0].trim();
    const lastSlash = targetBase.lastIndexOf('/');
    const cleanTarget = lastSlash !== -1 ? targetBase.substring(lastSlash + 1) : targetBase;
    return cleanTarget.toLowerCase() === basename.toLowerCase();
}

function isRecoveredIn(f: ParsedForeshadowingEntry, basename: string): boolean {
    if (!basename) return false;
    if (f.recoveryFiles && f.recoveryFiles.some(r => isMatch(r, basename))) return true;
    if (f.recoveryFile && isMatch(f.recoveryFile, basename)) return true;
    return false;
}

/**
 * 渲染设定关联 Badge
 *
 * @param container            要挂载 Badge 的父容器
 * @param loreArray            章节 frontmatter 中的 lore 字段（原始 unknown 类型）
 * @param bookPath             书籍根目录路径，用于查询设定文件
 * @param plugin               插件实例，用于访问 characterManager 和 workspace
 * @param enableHoverAndClick  是否启用 Hover 预览和点击跳转（侧边栏列表模式下为 false）
 */
export function renderLoreBadges(
	container: HTMLElement,
	loreArray: unknown,
	bookPath: string,
	plugin: WebNovelAssistantPlugin,
	enableHover: boolean,
	maxDisplay?: number
): void {
	if (!Array.isArray(loreArray) || loreArray.length === 0) return;

	const validLores = (loreArray as unknown[]).filter(
		(l: unknown): l is string => typeof l === 'string'
	);
	if (validLores.length === 0) return;

	const limit = maxDisplay ? Math.min(validLores.length, maxDisplay) : validLores.length;

	for (let i = 0; i < limit; i++) {
		const loreName = validLores[i];
		const realLoreName = loreName.split('×')[0];
		const cls = enableHover
			? 'wn-badge wn-badge-lore wn-hoverable'
			: 'wn-badge wn-badge-lore';

		const badgeEl = container.createEl('span', { cls, text: loreName });

		if (!enableHover) continue;

		// Hover 预览
		let hoverTimeout: number | null = null;
		badgeEl.addEventListener('mouseenter', () => {
			hoverTimeout = window.setTimeout(() => {
				const entry = plugin.characterManager.getCharacterFile(bookPath, realLoreName);
				if (entry) new LoreHoverPopover(badgeEl, entry, plugin, true);
			}, 500);
		});
		badgeEl.addEventListener('mouseleave', () => {
			if (hoverTimeout) window.clearTimeout(hoverTimeout);
		});
	}

	if (maxDisplay && validLores.length > maxDisplay) {
		container.createEl('span', {
			cls: 'wn-badge wn-badge-lore wn-badge-more',
			text: `+${validLores.length - maxDisplay}`
		});
	}
}
