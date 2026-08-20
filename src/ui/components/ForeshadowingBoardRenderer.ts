import { Notice, setIcon } from 'obsidian';
import type { App, Component, TFile } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import { ForeshadowingStatus, type ParsedForeshadowingEntry } from '../../types/foreshadowing';
import { ForeshadowingRecoveryModal } from '../ForeshadowingModal';
import { t } from '../../i18n';
import { getForeshadowingStatusText } from '../../i18n/data-keys';
import { ChapterSorter } from '../../services/ChapterSorter';
import { smartLocateAndHighlight } from '../../utils/leaf';

export interface ForeshadowingBoardOptions {
	app: App;
	plugin: WebNovelAssistantPlugin;
	ownerComponent: Component;
	container: HTMLElement;
	entries: ParsedForeshadowingEntry[];
	foreshadowingFile: TFile | null;
	query: string;
	currentForeshadowingTagFilter?: string;
	currentBookPath: string;
	reloadBoard: () => void;
}

export class ForeshadowingBoardRenderer {
	static async render(options: ForeshadowingBoardOptions): Promise<void> {
		const { app, plugin, container, entries, foreshadowingFile, query, currentForeshadowingTagFilter, currentBookPath, reloadBoard } = options;

		const boardContainer = container.createDiv('wn-foreshadowing-board-container');

		const tagFilter = currentForeshadowingTagFilter;
		if (!foreshadowingFile || entries.length === 0) {
			boardContainer.createDiv({
				cls: 'wn-corkboard-empty-msg',
				text: (query || (tagFilter && tagFilter !== 'all')) ? t('corkboard.filter-no-results') : t('corkboard.no-foreshadowing')
			});
			return;
		}

		// 按搜索关键词和侧面板选中的标签过滤
		const filterQuery = query.trim().toLowerCase();
		const filteredEntries = entries.filter((entry) => {
			if (tagFilter && tagFilter !== 'all' && !entry.tags.includes(tagFilter)) {
				return false;
			}
			if (!filterQuery) return true;

			// 匹配标题/说明
			if (entry.description.toLowerCase().includes(filterQuery)) return true;

			// 匹配标签
			if (entry.tags.some(t => t.toLowerCase().includes(filterQuery))) return true;

			// 匹配引用原文
			if (entry.contents.some(c => c.text.toLowerCase().includes(filterQuery) || (c.source && c.source.toLowerCase().includes(filterQuery)))) return true;

			// 匹配回收记录说明及章节
			if (entry.recoveryLogs && entry.recoveryLogs.some(l => (l.note && l.note.toLowerCase().includes(filterQuery)) || (l.quote && l.quote.toLowerCase().includes(filterQuery)) || l.file.toLowerCase().includes(filterQuery))) return true;

			return false;
		});

		if (filteredEntries.length === 0) {
			boardContainer.createDiv({
				cls: 'wn-corkboard-empty-msg',
				text: t('corkboard.filter-no-results')
			});
			return;
		}

		// 3 大分类归组
		const pendingEntries = filteredEntries.filter(
			e => e.status === ForeshadowingStatus.Pending || e.status === ForeshadowingStatus.PartiallyRecovered
		);
		const recoveredEntries = filteredEntries.filter(
			e => e.status === ForeshadowingStatus.Recovered
		);
		const deprecatedEntries = filteredEntries.filter(
			e => e.status === ForeshadowingStatus.Deprecated
		);

		// 按最新时间戳倒序排列（最新在最上方，与侧边栏规则保持一致）
		const getEntrySortTime = (entry: ParsedForeshadowingEntry): string => {
			if (entry.recoveryLogs && entry.recoveryLogs.length > 0) {
				for (let i = entry.recoveryLogs.length - 1; i >= 0; i--) {
					if (entry.recoveryLogs[i].time) return entry.recoveryLogs[i].time;
				}
			}
			if (entry.recoveredAts && entry.recoveredAts.length > 0) {
				for (let i = entry.recoveredAts.length - 1; i >= 0; i--) {
					if (entry.recoveredAts[i]) return entry.recoveredAts[i];
				}
			}
			if (entry.recoveredAt) return entry.recoveredAt;

			if (entry.contents && entry.contents.length > 0) {
				for (let i = entry.contents.length - 1; i >= 0; i--) {
					if (entry.contents[i].time) return entry.contents[i].time;
				}
			}

			return entry.createdAt || '';
		};

		pendingEntries.sort((a, b) => getEntrySortTime(b).localeCompare(getEntrySortTime(a)));
		recoveredEntries.sort((a, b) => getEntrySortTime(b).localeCompare(getEntrySortTime(a)));
		deprecatedEntries.sort((a, b) => getEntrySortTime(b).localeCompare(getEntrySortTime(a)));

		// 折叠状态记忆
		const collapsedGroups = new Set<string>();

		// 渲染 3 个分组
		ForeshadowingBoardRenderer.renderGroupSection({
			app,
			plugin,
			container: boardContainer,
			groupId: 'pending',
			title: t('foreshadowing.group-pending') || '待回收',
			entries: pendingEntries,
			statusType: 'pending',
			foreshadowingFile,
			currentBookPath,
			collapsedGroups,
			reloadBoard
		});

		ForeshadowingBoardRenderer.renderGroupSection({
			app,
			plugin,
			container: boardContainer,
			groupId: 'recovered',
			title: t('foreshadowing.group-recovered') || '已回收',
			entries: recoveredEntries,
			statusType: 'recovered',
			foreshadowingFile,
			currentBookPath,
			collapsedGroups,
			reloadBoard
		});

		ForeshadowingBoardRenderer.renderGroupSection({
			app,
			plugin,
			container: boardContainer,
			groupId: 'deprecated',
			title: t('foreshadowing.group-deprecated') || '已废弃',
			entries: deprecatedEntries,
			statusType: 'deprecated',
			foreshadowingFile,
			currentBookPath,
			collapsedGroups,
			reloadBoard
		});
	}

	private static renderGroupSection(opts: {
		app: App;
		plugin: WebNovelAssistantPlugin;
		container: HTMLElement;
		groupId: string;
		title: string;
		entries: ParsedForeshadowingEntry[];
		statusType: 'pending' | 'recovered' | 'deprecated';
		foreshadowingFile: TFile;
		currentBookPath: string;
		collapsedGroups: Set<string>;
		reloadBoard: () => void;
	}): void {
		const { app, plugin, container, groupId, title, entries, statusType, foreshadowingFile, currentBookPath, collapsedGroups, reloadBoard } = opts;

		if (entries.length === 0) return;

		const section = container.createDiv(`wn-foreshadowing-group-section wn-group-${statusType}`);
		
		// 分组标题栏 (完全复用全章节/分卷 and 设定卡片标准的 wn-corkboard-volume-header 结构)
		const header = section.createDiv('wn-corkboard-volume-header wn-clickable');
		const iconSpan = header.createSpan({ cls: 'wn-volume-header-icon' });
		setIcon(iconSpan, 'chevron-down');

		header.createSpan({
			cls: 'wn-volume-header-title',
			text: `${title} (${entries.length})`
		});

		const listContainer = section.createDiv('wn-foreshadowing-card-list');

		let isCollapsed = collapsedGroups.has(groupId);
		if (isCollapsed) {
			section.addClass('is-collapsed');
			setIcon(iconSpan, 'chevron-right');
		}

		header.onclick = () => {
			isCollapsed = !isCollapsed;
			if (isCollapsed) {
				collapsedGroups.add(groupId);
				section.addClass('is-collapsed');
				setIcon(iconSpan, 'chevron-right');
			} else {
				collapsedGroups.delete(groupId);
				section.removeClass('is-collapsed');
				setIcon(iconSpan, 'chevron-down');
			}
		};

		// 渲染卡片列表
		for (const entry of entries) {
			ForeshadowingBoardRenderer.renderCardItem({
				app,
				plugin,
				container: listContainer,
				entry,
				foreshadowingFile,
				currentBookPath,
				reloadBoard
			});
		}
	}

	private static renderCardItem(opts: {
		app: App;
		plugin: WebNovelAssistantPlugin;
		container: HTMLElement;
		entry: ParsedForeshadowingEntry;
		foreshadowingFile: TFile;
		currentBookPath: string;
		reloadBoard: () => void;
	}): void {
		const { app, plugin, container, entry, foreshadowingFile, currentBookPath, reloadBoard } = opts;
		const fm = plugin.foreshadowingManager;

		const card = container.createDiv(`wn-foreshadowing-board-card wn-card-status-${entry.status}`);

		// ─────────────────────────────────────────────
		// 第 1 行：伏笔标题 + 状态徽章 + 标签
		// ─────────────────────────────────────────────
		const line1 = card.createDiv('wn-foreshadowing-card-line1');
		
		const titleWrapper = line1.createDiv('wn-card-title-wrapper');
		titleWrapper.createSpan({
			cls: `wn-badge wn-foreshadowing-status-badge status-${entry.status}`,
			text: getForeshadowingStatusText(entry.status)
		});
		
		const titleSpan = titleWrapper.createSpan({
			cls: 'wn-card-description-title',
			text: entry.description
		});
		titleSpan.title = t('common.jump-to-entry');
		titleSpan.onclick = async (e) => {
			e.stopPropagation();
			if (!foreshadowingFile) {
				new Notice(t('common.file-not-found', { name: t('common.default-foreshadowing-filename') }));
				return;
			}
			const fileCache = app.metadataCache.getFileCache(foreshadowingFile);
			let fallbackLine: number | undefined;
			if (fileCache?.headings) {
				for (const h of fileCache.headings) {
					if (h.heading.trim() === entry.description.trim()) {
						fallbackLine = h.position.start.line;
						break;
					}
				}
			}
			await smartLocateAndHighlight(
				app,
				foreshadowingFile,
				[`## ${entry.description}`, `# ${entry.description}`, entry.description, `**说明**：${entry.description}`],
				{ splitIfNew: true, fallbackLine }
			);
		};

		if (entry.tags && entry.tags.length > 0) {
			const tagsWrapper = line1.createDiv('wn-card-tags-wrapper');
			for (const tag of entry.tags) {
				tagsWrapper.createSpan({ cls: 'wn-card-tag-badge', text: `#${tag}` });
			}
		}

		// ─────────────────────────────────────────────
		// 第 2 行：微型连线步进器 (左) + 快捷操作按钮 (右)
		// ─────────────────────────────────────────────
		const line2 = card.createDiv('wn-foreshadowing-card-line2');

		// 左侧：步进器
		const stepperEl = line2.createDiv('foreshadowing-stepper');
		ForeshadowingBoardRenderer.renderStepperNodes(stepperEl, entry);

		// 右侧：操作按钮组
		const actionsEl = line2.createDiv('wn-card-actions-wrapper');

		if (entry.status === ForeshadowingStatus.Pending || entry.status === ForeshadowingStatus.PartiallyRecovered) {
			// 回收按钮
			const recoverBtn = actionsEl.createEl('button', {
				cls: 'wn-card-action-btn mod-stage',
				text: t('foreshadowing.action-recovery') || '回收'
			});
			recoverBtn.onclick = (e) => {
				e.stopPropagation();
				new ForeshadowingRecoveryModal(
					app,
					plugin,
					entry.description,
					currentBookPath,
					(recoveryFileNames, isStage, note, quote) => {
						void (async () => {
							if (!fm) return;
							if (isStage) {
								await fm.markAsPartiallyRecovered(foreshadowingFile, entry.description, recoveryFileNames[0], note, quote);
							} else {
								await fm.markAsRecovered(foreshadowingFile, entry.description, recoveryFileNames, note, quote);
							}
							new Notice(t('notice.foreshadowing-recovered', { links: recoveryFileNames.join('、') }) || '回收变更已更新');
							reloadBoard();
						})();
					},
					false // 默认彻底回收
				).open();
			};

			// 废弃按钮
			const abandonBtn = actionsEl.createEl('button', {
				cls: 'wn-card-action-btn mod-abandon',
				text: t('foreshadowing.action-deprecate') || '废弃'
			});
			abandonBtn.onclick = (e) => {
				e.stopPropagation();
				void (async () => {
					if (!fm) return;
					const success = await fm.markAsDeprecated(foreshadowingFile, entry.description);
					if (success) {
						new Notice(t('status.deprecated') || '已标记废弃');
						reloadBoard();
					}
				})();
			};
		} else if (entry.status === ForeshadowingStatus.Deprecated) {
			// 恢复按钮
			const restoreBtn = actionsEl.createEl('button', {
				cls: 'wn-card-action-btn mod-restore',
				text: t('foreshadowing.action-restore') || '恢复'
			});
			restoreBtn.onclick = (e) => {
				e.stopPropagation();
				void (async () => {
					if (!fm) return;
					const success = await fm.markAsPending(foreshadowingFile, entry.description);
					if (success) {
						new Notice(t('notice.status-updated', { status: getForeshadowingStatusText(ForeshadowingStatus.Pending) }) || '已恢复待回收');
						reloadBoard();
					}
				})();
			};
		}

		// ─────────────────────────────────────────────
		// 第 3 行：关联出处章节与原文引用片段（完整渲染多条标注引用）
		// ─────────────────────────────────────────────
		const line3 = card.createDiv('wn-foreshadowing-card-line3');
		const contentsList = (entry.contents && entry.contents.length > 0)
			? entry.contents
			: [{ source: entry.sourceFile || '', time: entry.createdAt || '', text: '' }];

		for (const contentItem of contentsList) {
			const sourceChapterName = contentItem.source || entry.sourceFile || '';
			const sourceTime = contentItem.time || entry.createdAt || '';
			const quoteText = contentItem.text || '';

			if (!sourceChapterName && !quoteText) continue;

			const quoteItemBox = line3.createDiv('wn-card-source-quote-item');

			const sourceHeader = quoteItemBox.createDiv('wn-card-source-header');
			sourceHeader.createSpan({ cls: 'wn-card-source-tag', text: t('common.tag-source') });
			
			if (sourceChapterName) {
				const chapterLink = sourceHeader.createSpan({
					cls: 'wn-card-chapter-link clickable-link',
					text: `[[${sourceChapterName.split('/').pop() || sourceChapterName}]]`
				});

				chapterLink.onclick = (e) => {
					e.stopPropagation();
					void ForeshadowingBoardRenderer.jumpToChapterLocation(
						app,
						plugin,
						currentBookPath,
						sourceChapterName,
						quoteText,
						entry.description
					);
				};
			}

			if (sourceTime) {
				sourceHeader.createSpan({ cls: 'wn-card-source-time', text: ` - ${sourceTime}` });
			}

			if (quoteText) {
				const quoteBox = quoteItemBox.createDiv('wn-card-quote-box');
				quoteBox.createDiv({ cls: 'wn-card-quote-text', text: quoteText });
			}
		}

		// ─────────────────────────────────────────────
		// 第 4 行：回收阶段轨迹及关联回收原文
		// ─────────────────────────────────────────────
		if (entry.recoveryLogs && entry.recoveryLogs.length > 0) {
			const line4 = card.createDiv('wn-foreshadowing-card-line4');
			const headerEl = line4.createDiv({ cls: 'wn-card-recovery-logs-header' });
			headerEl.createSpan({ text: t('foreshadowing.recovery-trail') });
			headerEl.createDiv({ cls: 'wn-card-recovery-logs-divider' });

			const logsList = line4.createDiv('wn-card-recovery-logs-list');
			for (const log of entry.recoveryLogs) {
				const logRow = logsList.createDiv('wn-card-recovery-log-row');
				
				const tagLabel = log.stageType === 'stage' ? t('common.tag-stage-log') : t('common.tag-final-log');
				logRow.createSpan({ cls: `wn-log-tag-label mod-${log.stageType}`, text: tagLabel });

				const logChapterLink = logRow.createSpan({
					cls: 'wn-card-chapter-link clickable-link',
					text: `[[${log.file}]]`
				});

				if (log.time) {
					logRow.createSpan({ cls: 'wn-log-time', text: ` - ${log.time}` });
				}

				if (log.note) {
					logRow.createSpan({ cls: 'wn-log-note', text: `：${log.note}` });
				}

				logChapterLink.onclick = (e) => {
					e.stopPropagation();
					void ForeshadowingBoardRenderer.jumpToChapterLocation(
						app,
						plugin,
						currentBookPath,
						log.file,
						log.quote,
						log.note,
						entry.description
					);
				};

				if (log.quote) {
					const logQuoteBox = logRow.createDiv('wn-card-quote-box mod-recovery-quote');
					logQuoteBox.createDiv({ cls: 'wn-card-quote-text', text: log.quote });
				}
			}
		}
	}

	private static renderStepperNodes(container: HTMLElement, entry: ParsedForeshadowingEntry): void {
		container.empty();

		const logs = entry.recoveryLogs || [];
		const hasLogs = logs.length > 0;
		const hasLegacyRecovered = entry.recoveryFiles && entry.recoveryFiles.length > 0;
		const isRecovered = entry.status === ForeshadowingStatus.Recovered;

		// 节点 1: 伏笔初始埋下节点 (首次标注)
		const sourceNode = container.createDiv({
			cls: `foreshadowing-step-item is-source${!isRecovered && !hasLogs && !hasLegacyRecovered ? ' is-current' : ''}`
		});
		const sourceDot = sourceNode.createDiv({ cls: 'foreshadowing-step-dot' });
		setIcon(sourceDot, 'bookmark');

		const firstContent = entry.contents && entry.contents.length > 0 ? entry.contents[0] : null;
		const firstSource = firstContent?.source || entry.sourceFile || '';
		const firstSourceName = firstSource.split('/').pop() || firstSource;
		const firstTime = firstContent?.time || entry.createdAt || '';

		sourceNode.title = `${t('modal.first-marked-at', { name: firstSourceName }) || `首次标注于 ${firstSourceName}`}${firstTime ? ' · ' + firstTime : ''}`;

		// 阶段/终结节点
		if (hasLogs) {
			logs.forEach((log, index) => {
				container.createDiv({ cls: `foreshadowing-step-line ${log.stageType === 'final' ? 'is-final' : 'is-stage'}` });

				const isCurrent = !isRecovered && index === logs.length - 1 && log.stageType !== 'final';
				const node = container.createDiv({ cls: `foreshadowing-step-item ${log.stageType === 'final' ? 'is-final' : 'is-stage'}${isCurrent ? ' is-current' : ''}` });
				const dot = node.createDiv({ cls: 'foreshadowing-step-dot' });
				setIcon(dot, 'circle');

				const fileName = log.file.split('/').pop() || log.file;
				const tooltip = `${fileName}${log.time ? ' · ' + log.time : ''}${log.note ? '\n' + log.note : ''}`;
				node.title = tooltip;
			});
		} else if (hasLegacyRecovered) {
			entry.recoveryFiles!.forEach((file, index) => {
				container.createDiv({ cls: 'foreshadowing-step-line is-final' });
				const node = container.createDiv({ cls: 'foreshadowing-step-item is-final' });
				const dot = node.createDiv({ cls: 'foreshadowing-step-dot' });
				setIcon(dot, 'circle');
				const fileName = file.split('/').pop() || file;
				const time = entry.recoveredAts && entry.recoveredAts[index] ? entry.recoveredAts[index] : '';
				node.title = `${fileName}${time ? ' · ' + time : ''}`;
			});
		}

		// 末尾待完成节点（若未彻底回收）
		if (entry.status !== ForeshadowingStatus.Recovered) {
			container.createDiv({ cls: 'foreshadowing-step-line is-pending-tail' });
			const tailNode = container.createDiv({ cls: 'foreshadowing-step-item is-pending-tail' });
			const tailDot = tailNode.createDiv({ cls: 'foreshadowing-step-dot' });
			setIcon(tailDot, 'circle');
			tailNode.title = t('common.mark-final-recovered') || '待彻底回收';
		}
	}

	/**
	 * 点击章节链接分屏打开文件并高亮跳转目标行
	 */
	public static async jumpToChapterLocation(
		app: App,
		plugin: WebNovelAssistantPlugin,
		currentBookPath: string,
		chapterName: string,
		quoteText?: string,
		noteText?: string,
		titleText?: string
	): Promise<void> {
		if (!chapterName) return;

		const file = ChapterSorter.findChapterByName(app, plugin, currentBookPath, chapterName);

		if (!file) {
			new Notice(t('corkboard.lore-not-found') || `未找到章节「${chapterName}」`);
			return;
		}

		await smartLocateAndHighlight(app, file, [quoteText, noteText, titleText], { splitIfNew: true });
	}
}
