/**
 * Badge 渲染工具函数
 *
 * 将章节卡片和章节列表中重复出现的伏笔 badge + 设定 badge 渲染逻辑统一封装，
 * 避免在 WorkbenchView / ChapterOverviewView 之间重复维护相同代码。
 */

import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../types/foreshadowing';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { isMobile } from './platform';
import { LoreHoverPopover } from '../ui/LoreHoverPopover';
import { ForeshadowingHoverPopover } from '../ui/ForeshadowingHoverPopover';
import { t } from '../i18n';
import type { TooltipOptions } from 'obsidian';
import { setTooltip } from 'obsidian';


/**
 * 渲染伏笔相关 Badge（待回收 / 本章回收）
 *
 * @param container          要挂载 Badge 的父容器
 * @param cardForeshadowings 与该卡片关联的伏笔条目列表
 * @param currentBasename    当前章节文件名
 * @param plugin             插件实例，用于提供 Popup 操作
 */
export function renderForeshadowingBadges(
	container: HTMLElement,
	cardForeshadowings: ParsedForeshadowingEntry[],
	currentBasename?: string,
	plugin?: WebNovelAssistantPlugin
): void {
	const tooltipOptions: TooltipOptions = { classes: ['wn-tooltip-left'] };

	const bindForeshadowingHover = (badgeEl: HTMLElement, title: string, entries: ParsedForeshadowingEntry[]) => {
		badgeEl.addClass('wn-hoverable');
		if (plugin) {
			let hoverTimeout: number | null = null;
			badgeEl.addEventListener('mouseenter', () => {
				hoverTimeout = window.setTimeout(() => {
					new ForeshadowingHoverPopover(badgeEl, title, entries, plugin, true);
				}, 400);
			});
			badgeEl.addEventListener('mouseleave', () => {
				if (hoverTimeout) window.clearTimeout(hoverTimeout);
			});
			badgeEl.addEventListener('click', (e) => {
				e.stopPropagation();
				new ForeshadowingHoverPopover(badgeEl, title, entries, plugin, true);
			});
		}
	};

	// 待回收
	const pendingForeshadowings = cardForeshadowings.filter(
		f => f.status === ForeshadowingStatus.Pending
	);
	if (pendingForeshadowings.length > 0) {
		const labelText = `${t('corkboard.foreshadowing-unresolved')}×${pendingForeshadowings.length}`;
		const badge = container.createSpan({
			cls: 'wn-badge wn-badge-foreshadowing',
			text: labelText
		});
		setTooltip(badge, pendingForeshadowings.map(f => f.description).join('\n'), tooltipOptions);
		bindForeshadowingHover(badge, labelText, pendingForeshadowings);
	}

	// 已回收 (在其他章节回收的，本章只是提出或提及)
	if (currentBasename) {
		const resolvedOriginForeshadowings = cardForeshadowings.filter(
			f => f.status === ForeshadowingStatus.Recovered && !isRecoveredIn(f, currentBasename)
		);
		if (resolvedOriginForeshadowings.length > 0) {
			const labelText = `${t('corkboard.foreshadowing-recovered-origin')}×${resolvedOriginForeshadowings.length}`;
			const badge = container.createSpan({
				cls: 'wn-badge wn-badge-recovered',
				text: labelText
			});
			setTooltip(badge, resolvedOriginForeshadowings.map(f => f.description).join('\n'), tooltipOptions);
			bindForeshadowingHover(badge, labelText, resolvedOriginForeshadowings);
		}
	}

	// 本章回收 (在本章实际发生回收的)
	const recoveredForeshadowings = currentBasename
		? cardForeshadowings.filter(f => f.status === ForeshadowingStatus.Recovered && isRecoveredIn(f, currentBasename))
		: cardForeshadowings.filter(f => f.status === ForeshadowingStatus.Recovered);

	if (recoveredForeshadowings.length > 0) {
		const labelText = `${t('corkboard.foreshadowing-recovered')}×${recoveredForeshadowings.length}`;
		const badge = container.createSpan({
			cls: 'wn-badge wn-badge-recovered-here',
			text: labelText
		});
		setTooltip(badge, recoveredForeshadowings.map(f => f.description).join('\n'), tooltipOptions);
		bindForeshadowingHover(badge, labelText, recoveredForeshadowings);
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
 * @param enableHover          是否启用 Hover 预览
 * @param maxLinesOrDisplay    最大显示行数 (如 1 表示单行，2 表示双行) 或 最大显示个数
 */
export function renderLoreBadges(
	container: HTMLElement,
	loreArray: unknown,
	bookPath: string,
	plugin: WebNovelAssistantPlugin,
	enableHover: boolean,
	maxLinesOrDisplay?: number
): void {
	if (!Array.isArray(loreArray) || loreArray.length === 0) return;

	const validLores = (loreArray as unknown[]).filter(
		(l: unknown): l is string => typeof l === 'string'
	);
	if (validLores.length === 0) return;

	const bindHover = (badgeEl: HTMLElement, realLoreName: string) => {
		if (!enableHover) return;
		if (isMobile() && !plugin.settings.enableMobileLorePopover) return;
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
		badgeEl.addEventListener('click', (e) => {
			e.stopPropagation();
			const entry = plugin.characterManager.getCharacterFile(bookPath, realLoreName);
			if (entry) new LoreHoverPopover(badgeEl, entry, plugin, true);
		});
	};

	// 默认模式：未指定限制，直接全部渲染
	if (!maxLinesOrDisplay || maxLinesOrDisplay <= 0) {
		for (const loreName of validLores) {
			const realLoreName = loreName.split('×')[0];
			const cls = enableHover ? 'wn-badge wn-badge-lore wn-hoverable' : 'wn-badge wn-badge-lore';
			const badgeEl = container.createSpan({ cls, text: loreName });
			bindHover(badgeEl, realLoreName);
		}
		return;
	}

	// 显式指定个数限制模式（如 > 2 的数字，如 ImmersiveChapterListView 传入 3）
	if (maxLinesOrDisplay > 2) {
		const limit = Math.min(validLores.length, maxLinesOrDisplay);
		for (let i = 0; i < limit; i++) {
			const loreName = validLores[i];
			const realLoreName = loreName.split('×')[0];
			const cls = enableHover ? 'wn-badge wn-badge-lore wn-hoverable' : 'wn-badge wn-badge-lore';
			const badgeEl = container.createSpan({ cls, text: loreName });
			bindHover(badgeEl, realLoreName);
		}
		if (validLores.length > limit) {
			container.createSpan({
				cls: 'wn-badge wn-badge-lore wn-badge-more',
				text: `+${validLores.length - limit}`
			});
		}
		return;
	}

	// 按行受控模式：maxLines = 1 (时间轴看板) 或 maxLines = 2 (全章节模式)
	const maxLines = maxLinesOrDisplay;
	const renderedLoreEls: HTMLElement[] = [];

	// 先尝试全量渲染设定 Badge
	for (let i = 0; i < validLores.length; i++) {
		const loreName = validLores[i];
		const realLoreName = loreName.split('×')[0];
		const cls = enableHover ? 'wn-badge wn-badge-lore wn-hoverable' : 'wn-badge wn-badge-lore';
		const badgeEl = container.createSpan({ cls, text: loreName });
		bindHover(badgeEl, realLoreName);
		renderedLoreEls.push(badgeEl);
	}

	// 如果条目数量不超过最大行数，绝对不会引发换行溢出，无需调度 RAF 触发 DOM 布局重测
	if (validLores.length <= maxLines) return;

	scheduleBadgeBatchCheck({
		container,
		maxLines,
		renderedLoreEls
	});
}

interface BadgeBatchTask {
	container: HTMLElement;
	maxLines: number;
	renderedLoreEls: HTMLElement[];
}

let badgeBatchQueue: BadgeBatchTask[] = [];
let badgeBatchScheduled = false;

function scheduleBadgeBatchCheck(task: BadgeBatchTask): void {
	badgeBatchQueue.push(task);
	if (badgeBatchScheduled) return;
	badgeBatchScheduled = true;

	window.requestAnimationFrame(() => {
		const tasks = badgeBatchQueue;
		badgeBatchQueue = [];
		badgeBatchScheduled = false;

		// --- 1. 批量读取阶段 (Batch Read: 集中一次性获取所有 offsetTop，避免读写交替引发 30+ 次强制重排) ---
		const measurements: Array<{
			task: BadgeBatchTask;
			baseTop: number;
			keepCount: number;
			hiddenCount: number;
		}> = [];

		for (const t of tasks) {
			if (!t.container.isConnected) continue;
			const children = Array.from(t.container.children) as HTMLElement[];
			if (children.length === 0) continue;

			const firstTop = children[0].offsetTop;
			const maxAllowedDiff = t.maxLines === 1 ? 10 : 30;

			let isOverflow = false;
			for (const child of children) {
				if (child.offsetTop - firstTop > maxAllowedDiff) {
					isOverflow = true;
					break;
				}
			}

			if (!isOverflow) continue;

			let keepCount = t.renderedLoreEls.length;
			for (let i = t.renderedLoreEls.length - 1; i >= 0; i--) {
				const diff = t.renderedLoreEls[i].offsetTop - firstTop;
				if (diff <= maxAllowedDiff) {
					keepCount = i + 1;
					break;
				}
				if (i === 0) keepCount = 0;
			}

			// 如果产生溢出，为 +X 徽章留出同行空间（保留 keepCount - 1 个条目）
			if (keepCount < t.renderedLoreEls.length && keepCount > 1) {
				keepCount = Math.max(1, keepCount - 1);
			}

			const hiddenCount = t.renderedLoreEls.length - keepCount;
			if (hiddenCount > 0) {
				measurements.push({
					task: t,
					baseTop: firstTop,
					keepCount,
					hiddenCount
				});
			}
		}

		// --- 2. 批量写入阶段 (Batch Write: 集中剪裁 DOM 节点与插入 +X 徽章，绝对无 DOM 读取操作) ---
		for (const m of measurements) {
			const { task, keepCount, hiddenCount } = m;
			for (let i = task.renderedLoreEls.length - 1; i >= keepCount; i--) {
				task.renderedLoreEls[i].remove();
			}
			task.renderedLoreEls.splice(keepCount);
			task.container.createSpan({
				cls: 'wn-badge wn-badge-lore wn-badge-more',
				text: `+${hiddenCount}`
			});
		}
	});
}
