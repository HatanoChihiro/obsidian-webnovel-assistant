import type { TFile, WorkspaceLeaf } from 'obsidian';
import { Notice, setIcon } from 'obsidian';
import type { ParsedForeshadowingEntry } from '../types/foreshadowing';
import { ForeshadowingStatus } from '../types/foreshadowing';
import { ForeshadowingRecoveryModal } from './ForeshadowingModal';
import { CreativeView } from './CreativeView';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { getForeshadowingStatusText, getDefaultFileName } from '../i18n/data-keys';
import { t } from '../i18n';
import { openFileAndFocus, smartLocateAndHighlight } from '../utils/leaf';
import { ChapterSorter } from '../services/ChapterSorter';


export const FORESHADOWING_VIEW_TYPE = 'foreshadowing-view';



/**
 * 伏笔面板视图
 * 在侧边栏显示当前文件夹的伏笔列表，支持按状态筛选和直接回收操作
 */
export class ForeshadowingView extends CreativeView {
	private filterStatus: 'all' | ForeshadowingStatus = 'all';
	private filterTag: string = 'all';
	private pendingRefreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf, plugin);
	}

	getViewType() { return FORESHADOWING_VIEW_TYPE; }
	getDisplayText() { return t('view.foreshadowing'); }
	getIcon() { return 'bookmark'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
	}

	protected async onFolderChange() {
		this.filterTag = 'all';
		this.app.workspace.trigger('foreshadowing-filter-changed', 'all');
		await super.onFolderChange();
	}

	async onClose() {
		if (this.pendingRefreshTimer !== null) {
			window.clearTimeout(this.pendingRefreshTimer);
			this.pendingRefreshTimer = null;
		}
	}

	private getTagFilterOptions(entries: ParsedForeshadowingEntry[]): string[] {
		const fromSettings = this.plugin.settings.foreshadowing?.defaultTags || [];
		const fromEntries = entries.flatMap(e => e.tags);
		return [...new Set([...fromSettings, ...fromEntries])];
	}

	async refresh() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('foreshadowing-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'foreshadowing-view-header' });
		const titleRow = header.createDiv({ cls: 'foreshadowing-view-title-row' });
		titleRow.createSpan({ text: t('view.foreshadowing'), cls: 'foreshadowing-view-title' });

		// 当前文件夹标签
		const folderLabel = header.createDiv({ cls: 'foreshadowing-view-folder' });
		folderLabel.setText(this.currentFolder || t('common.root-directory'));

		// 筛选按钮
		const filterRow = header.createDiv({ cls: 'foreshadowing-view-filter-row' });
		const filters: { label: string; value: 'all' | ForeshadowingStatus }[] = [
			{ label: t('common.all'), value: 'all' },
			{ label: getForeshadowingStatusText('pending'), value: ForeshadowingStatus.Pending },
			{ label: getForeshadowingStatusText('partially_recovered'), value: ForeshadowingStatus.PartiallyRecovered },
			{ label: getForeshadowingStatusText('recovered'), value: ForeshadowingStatus.Recovered },
			{ label: getForeshadowingStatusText('deprecated'), value: ForeshadowingStatus.Deprecated },
		];
		filters.forEach(f => {
			const btn = filterRow.createEl('button', { text: f.label, cls: 'foreshadowing-filter-btn' });
			if (this.filterStatus === f.value) btn.addClass('is-active');
			btn.onclick = () => {
				this.filterStatus = f.value;
				void this.refresh();
			};
		});

		// 读取伏笔文件
		const entries = await this.loadEntries();
		if (entries === null) {
			const empty = container.createDiv({ cls: 'foreshadowing-view-empty' });
			empty.createEl('p', { text: t('common.no-files-hint', { type: t('common.default-foreshadowing-filename') }) });
			const fileName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'foreshadowing-view-hint' });
			return;
		}

		// 标签筛选行
		const tagOptions = this.getTagFilterOptions(entries);
		if (tagOptions.length > 0) {
			const tagRow = header.createDiv({ cls: 'foreshadowing-view-filter-row foreshadowing-view-tag-filter-row' });
			const allTagBtn = tagRow.createEl('button', { text: t('common.all-tags'), cls: 'foreshadowing-filter-btn' });
			if (this.filterTag === 'all') allTagBtn.addClass('is-active');
			allTagBtn.onclick = () => {
				this.filterTag = 'all';
				this.app.workspace.trigger('foreshadowing-filter-changed', 'all');
				void this.refresh();
			};
			tagOptions.forEach(tag => {
				const btn = tagRow.createEl('button', { text: `#${tag}`, cls: 'foreshadowing-filter-btn' });
				if (this.filterTag === tag) btn.addClass('is-active');
				btn.onclick = () => {
					this.filterTag = tag;
					this.app.workspace.trigger('foreshadowing-filter-changed', tag);
					void this.refresh();
				};
			});
		}

		// 筛选
		let filtered = entries;
		if (this.filterStatus !== 'all') filtered = filtered.filter(e => e.status === this.filterStatus);
		if (this.filterTag !== 'all') filtered = filtered.filter(e => e.tags.includes(this.filterTag));

		if (filtered.length === 0) {
			container.createDiv({ cls: 'foreshadowing-view-empty', text: t('common.no-matching-foreshadowing') });
			return;
		}

		// 按状态分组
		const groups: { status: ForeshadowingStatus; label: string; items: ParsedForeshadowingEntry[] }[] = [
			{ status: ForeshadowingStatus.Pending, label: getForeshadowingStatusText('pending'), items: [] },
			{ status: ForeshadowingStatus.PartiallyRecovered, label: getForeshadowingStatusText('partially_recovered'), items: [] },
			{ status: ForeshadowingStatus.Recovered, label: getForeshadowingStatusText('recovered'), items: [] },
			{ status: ForeshadowingStatus.Deprecated, label: getForeshadowingStatusText('deprecated'), items: [] },
		];
		filtered.forEach(e => {
			const g = groups.find(g => g.status === e.status);
			if (g) g.items.push(e);
		});

		// 已回收与阶段回收列表中，按最新回收时间戳倒序排列（最新回收在最上方）
		const getLatestRecoveryTime = (entry: ParsedForeshadowingEntry): string => {
			if (entry.recoveryLogs && entry.recoveryLogs.length > 0) {
				for (let i = entry.recoveryLogs.length - 1; i >= 0; i--) {
					const t = entry.recoveryLogs[i].time;
					if (t) return t;
				}
			}
			if (entry.recoveredAts && entry.recoveredAts.length > 0) {
				for (let i = entry.recoveredAts.length - 1; i >= 0; i--) {
					if (entry.recoveredAts[i]) return entry.recoveredAts[i];
				}
			}
			return entry.recoveredAt || entry.createdAt || '';
		};

		groups.forEach(g => {
			g.items.sort((a, b) => getLatestRecoveryTime(b).localeCompare(getLatestRecoveryTime(a)));
		});

		const list = container.createDiv({ cls: 'foreshadowing-view-list' });

		groups.forEach(group => {
			if (group.items.length === 0) return;

			// 分组标题
			const groupHeader = list.createDiv({ cls: 'foreshadowing-group-header' });
			groupHeader.createSpan({ text: `${group.label}`, cls: 'foreshadowing-group-label' });
			groupHeader.createSpan({ text: `${group.items.length}`, cls: 'foreshadowing-group-count' });

			// 条目列表
			group.items.forEach(entry => this.renderEntry(list, entry));
		});
	}

	private renderEntry(container: HTMLElement, entry: ParsedForeshadowingEntry) {
		const statusCls = entry.status === ForeshadowingStatus.Pending
			? 'pending'
			: entry.status === ForeshadowingStatus.PartiallyRecovered
			? 'partially-recovered'
			: entry.status === ForeshadowingStatus.Recovered
			? 'recovered'
			: 'deprecated';
		const card = container.createDiv({ cls: `foreshadowing-entry-card status-${statusCls}` });

		// 说明（主标题）
		const descRow = card.createDiv({ cls: 'foreshadowing-entry-desc' });
		descRow.createSpan({ text: entry.description, cls: 'foreshadowing-entry-desc-text' });

		// 动态多节点步进器组件（置于标题与标注内容之间）
		this.renderStageStepper(card, entry);

		// 引用内容（可能多条）
		const quotesEl = card.createDiv({ cls: 'foreshadowing-entry-quotes' });
		entry.contents.forEach(c => {
			const quoteEl = quotesEl.createDiv({ cls: 'foreshadowing-entry-quote' });
			const target = c.source || entry.sourceFile;
			
			if (c.source || c.time) {
				const metaEl = quoteEl.createDiv({
					text: `${c.source ? `[[${c.source.split('/').pop() || c.source}]]` : ''}${c.time ? ` · ${c.time}` : ''}`,
					cls: 'foreshadowing-entry-quote-meta'
				});
				metaEl.setCssProps({ cursor: 'pointer' });
				metaEl.title = t('common.jump-to-reference');
				metaEl.onclick = async () => {
					const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
					const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
					if (file) {
						await this.openFileWithSmartLocate(file, c.text);
					} else {
						new Notice(t('common.file-not-found', { name: target }));
					}
				};
			}
			
			const textEl = quoteEl.createDiv({ text: c.text, cls: 'foreshadowing-entry-quote-text' });
			textEl.setCssProps({ cursor: 'pointer' });
			textEl.title = t('common.jump-to-original');
			textEl.onclick = async () => {
				const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
				const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
				if (file) {
					await this.openFileWithSmartLocate(file, c.text);
				} else {
					new Notice(t('common.file-not-found', { name: target }));
				}
			};
		});

		// 回收轨迹与关联原文引用（样式与排版层级与上方“标注引用部分”保持完全一致）
		if (entry.recoveryLogs && entry.recoveryLogs.length > 0) {
			const recoveryLogsEl = card.createDiv({ cls: 'foreshadowing-entry-quotes mod-recovery-logs' });
			entry.recoveryLogs.forEach(log => {
				const logItemEl = recoveryLogsEl.createDiv({ cls: `foreshadowing-entry-quote mod-recovery mod-${log.stageType}` });

				// 元数据行 (样式与 foreshadowing-entry-quote-meta 一致)
				const metaEl = logItemEl.createDiv({ cls: 'foreshadowing-entry-quote-meta' });

				const tag = log.stageType === 'stage' ? t('common.tag-stage-log') : t('common.tag-final-log');
				metaEl.createSpan({ cls: `wn-log-tag-label mod-${log.stageType}`, text: tag });

				const linkSpan = metaEl.createSpan({
					cls: 'wn-card-chapter-link clickable-link',
					text: ` [[${log.file.split('/').pop() || log.file}]]`
				});

				if (log.time) metaEl.createSpan({ cls: 'wn-log-time', text: ` · ${log.time}` });
				if (log.note) metaEl.createSpan({ cls: 'wn-log-note', text: `：${log.note}` });

				linkSpan.onclick = async () => {
					await this.openRecoveryLocation(log.file, [log.quote, log.note, entry.description]);
				};

				// 正文引用行 (样式与 foreshadowing-entry-quote-text 一致)
				if (log.quote) {
					const textEl = logItemEl.createDiv({
						cls: `foreshadowing-entry-quote-text mod-recovery-quote mod-${log.stageType}`,
						text: log.quote
					});
					textEl.title = t('common.jump-to-original');
					textEl.onclick = async () => {
						await this.openRecoveryLocation(log.file, [log.quote, log.note, entry.description]);
					};
				}
			});
		}

		// 底部信息行
		const footer = card.createDiv({ cls: 'foreshadowing-entry-footer' });

		// 标签
		if (entry.tags.length > 0) {
			const tagsEl = footer.createDiv({ cls: 'foreshadowing-entry-tags' });
			entry.tags.forEach(tag => {
				tagsEl.createSpan({ text: `#${tag}`, cls: 'foreshadowing-entry-tag' });
			});
		}

		// 操作按钮
		const actions = footer.createDiv({ cls: 'foreshadowing-entry-actions' });

		// 回收按钮 (未回收 或 阶段回收中)
		if (entry.status === ForeshadowingStatus.Pending || entry.status === ForeshadowingStatus.PartiallyRecovered) {
			const recoverBtn = actions.createEl('button', { text: t('foreshadowing.action-recovery'), cls: 'foreshadowing-action-btn foreshadowing-recover-btn' });
			recoverBtn.onclick = () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				new ForeshadowingRecoveryModal(
					this.app,
					this.plugin,
					entry.description,
					this.currentFolder,
					(recoveryFileNames, isStage, note, quote) => {
						if (!this.plugin.foreshadowingManager) return;
						void (async () => {
							try {
								let success = false;
								if (isStage) {
									success = await this.plugin.foreshadowingManager.markAsPartiallyRecovered(
										foreshadowingFile, entry.description, recoveryFileNames[0] || '', note, quote
									);
								} else {
									success = await this.plugin.foreshadowingManager.markAsRecovered(
										foreshadowingFile, entry.description, recoveryFileNames, note, quote
									);
								}
								if (success) {
									new Notice(t('notice.foreshadowing-recovered', { links: recoveryFileNames.map(f => `[[${f}]]`).join('、') }));
									if (this.pendingRefreshTimer) window.clearTimeout(this.pendingRefreshTimer);
									this.pendingRefreshTimer = window.setTimeout(() => {
										this.pendingRefreshTimer = null;
										void this.refresh();
									}, 100);
								}
							} catch (err) {
								console.error('[ForeshadowingView] recovery failed:', err);
							}
						})();
					},
					false // 默认彻底回收
				).open();
			};

			const deprecateBtn = actions.createEl('button', { text: t('common.deprecate'), cls: 'foreshadowing-action-btn foreshadowing-deprecate-btn' });
			deprecateBtn.onclick = () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				if (!this.plugin.foreshadowingManager) return;
				void (async () => {
					try {
						const success = await this.plugin.foreshadowingManager.markAsDeprecated(
							foreshadowingFile, entry.description
						);
						if (success) {
							new Notice(t('common.deprecated-marked'));
							if (this.pendingRefreshTimer) window.clearTimeout(this.pendingRefreshTimer);
							this.pendingRefreshTimer = window.setTimeout(() => {
								this.pendingRefreshTimer = null;
								void this.refresh();
							}, 100);
						}
					} catch (err) {
						console.error('[ForeshadowingView] markAsDeprecated failed:', err);
					}
				})();
			};
		}

		// 恢复按钮（已废弃状态显示）
		if (entry.status === ForeshadowingStatus.Deprecated) {
			const restoreBtn = actions.createEl('button', { text: t('common.restore'), cls: 'foreshadowing-action-btn' });
			restoreBtn.onclick = async () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				if (!this.plugin.foreshadowingManager) return;
				const success = await this.plugin.foreshadowingManager.markAsPending(
					foreshadowingFile, entry.description
				);
				if (success) {
					new Notice(t('common.restored-to-pending'));
					if (this.pendingRefreshTimer) window.clearTimeout(this.pendingRefreshTimer);
					this.pendingRefreshTimer = window.setTimeout(() => {
						this.pendingRefreshTimer = null;
						void this.refresh();
					}, 100);
				}
			};
		}
	}

	/**
	 * 渲染精简多节点推进器 (仅图标，悬浮 Tooltip 呈现完整详情)
	 */
	private renderStageStepper(container: HTMLElement, entry: ParsedForeshadowingEntry) {
		const stepperEl = container.createDiv({ cls: 'foreshadowing-stepper' });
		
		// 节点 1: 埋下伏笔 (源章节)
		const logs = entry.recoveryLogs || [];
		const hasLogs = logs.length > 0;
		const hasLegacyRecovered = entry.recoveryFiles && entry.recoveryFiles.length > 0;
		const isRecovered = entry.status === ForeshadowingStatus.Recovered;

		// 节点 1: 伏笔初始埋下节点 (首次标注)
		const sourceNode = stepperEl.createDiv({
			cls: `foreshadowing-step-item is-source${!isRecovered && !hasLogs && !hasLegacyRecovered ? ' is-current' : ''}`
		});
		const sourceDot = sourceNode.createDiv({ cls: 'foreshadowing-step-dot' });
		setIcon(sourceDot, 'bookmark');

		const firstContent = entry.contents[0];
		const firstSource = firstContent?.source || entry.sourceFile;
		const firstSourceName = firstSource.split('/').pop() || firstSource;
		const firstTime = firstContent?.time || entry.createdAt || '';

		sourceNode.title = `${t('modal.first-marked-at', { name: firstSourceName })}${firstTime ? ' · ' + firstTime : ''}`;
		
		sourceNode.onclick = async () => {
			const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
			const file = this.app.metadataCache.getFirstLinkpathDest(firstSource, sourcePath);
			if (file) await openFileAndFocus(this.app, this.app.workspace.getLeaf(false), file);
		};

		// 阶段/终结节点
		if (hasLogs) {
			logs.forEach((log, index) => {
				stepperEl.createDiv({ cls: `foreshadowing-step-line ${log.stageType === 'final' ? 'is-final' : 'is-stage'}` });

				const isCurrent = !isRecovered && index === logs.length - 1 && log.stageType !== 'final';
				const node = stepperEl.createDiv({ cls: `foreshadowing-step-item ${log.stageType === 'final' ? 'is-final' : 'is-stage'}${isCurrent ? ' is-current' : ''}` });
				const dot = node.createDiv({ cls: 'foreshadowing-step-dot' });
				setIcon(dot, 'circle');

				const fileName = log.file.split('/').pop() || log.file;
				const tooltip = `${fileName}${log.time ? ' · ' + log.time : ''}${log.note ? '\n' + log.note : ''}`;
				node.title = tooltip;
				node.onclick = async () => {
					const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
					const file = this.app.metadataCache.getFirstLinkpathDest(log.file, sourcePath);
					if (file) await openFileAndFocus(this.app, this.app.workspace.getLeaf(false), file);
				};
			});
		} else if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
			entry.recoveryFiles.forEach((file, index) => {
				stepperEl.createDiv({ cls: 'foreshadowing-step-line is-final' });
				const node = stepperEl.createDiv({ cls: 'foreshadowing-step-item is-final' });
				const dot = node.createDiv({ cls: 'foreshadowing-step-dot' });
				setIcon(dot, 'circle');
				const fileName = file.split('/').pop() || file;
				const time = entry.recoveredAts && entry.recoveredAts[index] ? entry.recoveredAts[index] : '';
				node.title = `${fileName}${time ? ' · ' + time : ''}`;
				node.onclick = async () => {
					const sourcePath = this.currentFolder ? this.currentFolder + '/foreshadowing.md' : '';
					const targetFile = this.app.metadataCache.getFirstLinkpathDest(file, sourcePath);
					if (targetFile) await openFileAndFocus(this.app, this.app.workspace.getLeaf(false), targetFile);
				};
			});
		}

		// 末尾待完成节点（若未彻底回收）
		if (entry.status !== ForeshadowingStatus.Recovered) {
			stepperEl.createDiv({ cls: 'foreshadowing-step-line is-pending-tail' });
			const tailNode = stepperEl.createDiv({ cls: 'foreshadowing-step-item is-pending-tail' });
			const tailDot = tailNode.createDiv({ cls: 'foreshadowing-step-dot' });
			setIcon(tailDot, 'circle');
			tailNode.title = t('common.mark-final-recovered');
		}
	}

	private getForeshadowingFile(): TFile | null {
		if (!this.plugin.foreshadowingManager) return null;
		return this.plugin.foreshadowingManager.getForeshadowingFileByFolder(this.currentFolder);
	}

	private async loadEntries(): Promise<ParsedForeshadowingEntry[] | null> {
		const file = this.getForeshadowingFile();
		if (!file || !this.plugin.foreshadowingManager) return null;

		const content = await this.app.vault.read(file);
		// 使用 Manager 的统一解析逻辑
		return this.plugin.foreshadowingManager.parseEntries(content);
	}

	/**
	 * 使用智能文本匹配进行精准跳转
	 */
	private async openFileWithSmartLocate(file: TFile, searchText: string) {
		await smartLocateAndHighlight(this.app, file, [searchText]);
	}

	private async openRecoveryLocation(chapterName: string, searchTexts: (string | undefined)[]) {
		const file = ChapterSorter.findChapterByName(this.app, this.plugin, this.currentFolder, chapterName);
		if (!file) {
			new Notice(t('common.file-not-found', { name: chapterName }));
			return;
		}

		await smartLocateAndHighlight(this.app, file, searchTexts);
	}
}
