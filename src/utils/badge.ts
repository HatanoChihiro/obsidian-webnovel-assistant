/**
 * Badge 渲染工具函数
 *
 * 将章节卡片和章节列表中重复出现的伏笔 badge + 设定 badge 渲染逻辑统一封装，
 * 避免在 WorkbenchView / ChapterOverviewView 之间重复维护相同代码。
 */

import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { LoreHoverPopover } from '../ui/LoreHoverPopover';
import { t } from '../i18n';


/**
 * 渲染伏笔相关 Badge（待回收 / 本章回收）
 *
 * @param container          要挂载 Badge 的父容器
 * @param cardForeshadowings 与该卡片关联的伏笔条目列表
 */
export function renderForeshadowingBadges(
	container: HTMLElement,
	cardForeshadowings: ParsedForeshadowingEntry[]
): void {
	// 待回收
	const pendingForeshadowings = cardForeshadowings.filter(
		f => f.status === 'pending' || f.status === 'unresolved'
	);
	if (pendingForeshadowings.length > 0) {
		const badge = container.createEl('span', {
			cls: 'wn-badge wn-badge-foreshadowing',
			text: `${t('corkboard.foreshadowing-unresolved') || '待回收'}×${pendingForeshadowings.length}`
		});
		badge.title = pendingForeshadowings.map(f => f.description).join('\n');
	}

	// 本章回收
	const recoveredForeshadowings = cardForeshadowings.filter(f => f.status === 'recovered');
	if (recoveredForeshadowings.length > 0) {
		const badge = container.createEl('span', {
			cls: 'wn-badge wn-badge-recovered',
			text: `${t('corkboard.foreshadowing-recovered') || '本章回收'}×${recoveredForeshadowings.length}`
		});
		badge.title = recoveredForeshadowings.map(f => f.description).join('\n');
	}
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
	enableHoverAndClick: boolean
): void {
	if (!Array.isArray(loreArray) || loreArray.length === 0) return;

	const validLores = (loreArray as unknown[]).filter(
		(l: unknown): l is string => typeof l === 'string'
	);
	if (validLores.length === 0) return;

	for (let i = 0; i < validLores.length; i++) {
		const loreName = validLores[i];
		const realLoreName = loreName.split('×')[0];
		const cls = enableHoverAndClick
			? 'wn-badge wn-badge-lore wn-clickable'
			: 'wn-badge wn-badge-lore';

		const badgeEl = container.createEl('span', { cls, text: loreName });

		if (!enableHoverAndClick) continue;

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

		// 点击跳转
		badgeEl.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			const entry = plugin.characterManager.getCharacterFile(bookPath, realLoreName);
			if (entry?.file) {
				void plugin.app.workspace.getLeaf('tab').openFile(entry.file);
			}
		});
	}

}
