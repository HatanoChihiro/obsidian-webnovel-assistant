import { MarkdownView, Menu, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { ForeshadowingStatus } from '../types/foreshadowing';
import { ForeshadowingRecoveryModal } from './ForeshadowingModal';
import { CreativeView } from './CreativeView';
import type { WebNovelAssistantPlugin } from '../types/plugin';

export const FORESHADOWING_VIEW_TYPE = 'foreshadowing-view';

interface ParsedEntry {
	sourceFile: string;
	createdAt: string;
	contents: { source: string; time: string; text: string }[]; // 支持多个引用
	description: string;
	tags: string[];
	status: ForeshadowingStatus;
	recoveryFiles?: string[]; // 支持多章节回收
	recoveredAts?: string[];
	recoveryFile?: string; // 向后兼容
	recoveredAt?: string;
}

/**
 * 伏笔面板视图
 * 在侧边栏显示当前文件夹的伏笔列表，支持按状态筛选和直接回收操作
 */
export class ForeshadowingView extends CreativeView {
	private filterStatus: 'all' | ForeshadowingStatus = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf, plugin);
	}

	getViewType() { return FORESHADOWING_VIEW_TYPE; }
	getDisplayText() { return '伏笔'; }
	getIcon() { return 'bookmark'; }

	protected getWatchFileName(): string {
		return this.plugin.settings.foreshadowing?.fileName || '伏笔';
	}

	async refresh() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('foreshadowing-view-container');

		// 标题栏
		const header = container.createDiv({ cls: 'foreshadowing-view-header' });
		const titleRow = header.createDiv({ cls: 'foreshadowing-view-title-row' });
		titleRow.createSpan({ text: '伏笔', cls: 'foreshadowing-view-title' });

		// 当前文件夹标签
		const folderLabel = header.createDiv({ cls: 'foreshadowing-view-folder' });
		folderLabel.setText(this.currentFolder || '根目录');

		// 筛选按钮
		const filterRow = header.createDiv({ cls: 'foreshadowing-view-filter-row' });
		const filters: { label: string; value: 'all' | ForeshadowingStatus }[] = [
			{ label: '全部', value: 'all' },
			{ label: '未回收', value: ForeshadowingStatus.Pending },
			{ label: '已回收', value: ForeshadowingStatus.Recovered },
			{ label: '已废弃', value: ForeshadowingStatus.Deprecated },
		];
		filters.forEach(f => {
			const btn = filterRow.createEl('button', { text: f.label, cls: 'foreshadowing-filter-btn' });
			if (this.filterStatus === f.value) btn.addClass('is-active');
			btn.onclick = () => {
				this.filterStatus = f.value;
				this.refresh();
			};
		});

		// 读取伏笔文件
		const entries = await this.loadEntries();
		if (entries === null) {
			const empty = container.createDiv({ cls: 'foreshadowing-view-empty' });
			empty.createEl('p', { text: '当前文件夹下没有伏笔文件' });
			const fileName = this.plugin.settings.foreshadowing?.fileName || '伏笔';
			empty.createEl('p', { text: `（${fileName}.md）`, cls: 'foreshadowing-view-hint' });
			return;
		}

		// 筛选
		const filtered = this.filterStatus === 'all'
			? entries
			: entries.filter(e => e.status === this.filterStatus);

		if (filtered.length === 0) {
			container.createDiv({ cls: 'foreshadowing-view-empty', text: '没有符合条件的伏笔' });
			return;
		}

		// 按状态分组
		const groups: { status: ForeshadowingStatus; label: string; items: ParsedEntry[] }[] = [
			{ status: ForeshadowingStatus.Pending, label: '未回收', items: [] },
			{ status: ForeshadowingStatus.Recovered, label: '已回收', items: [] },
			{ status: ForeshadowingStatus.Deprecated, label: '已废弃', items: [] },
		];
		filtered.forEach(e => {
			const g = groups.find(g => g.status === e.status);
			if (g) g.items.push(e);
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

		this.injectStyles();
	}

	private renderEntry(container: HTMLElement, entry: ParsedEntry) {
		const card = container.createDiv({ cls: `foreshadowing-entry-card status-${entry.status === ForeshadowingStatus.Pending ? 'pending' : entry.status === ForeshadowingStatus.Recovered ? 'recovered' : 'deprecated'}` });

		// 说明（主标题）
		const descRow = card.createDiv({ cls: 'foreshadowing-entry-desc' });
		descRow.createSpan({ text: entry.description, cls: 'foreshadowing-entry-desc-text' });

		// 引用内容（可能多条）
		const quotesEl = card.createDiv({ cls: 'foreshadowing-entry-quotes' });
		entry.contents.forEach(c => {
			const quoteEl = quotesEl.createDiv({ cls: 'foreshadowing-entry-quote' });
			if (c.source || c.time) {
				quoteEl.createDiv({
					text: `${c.source ? `[[${c.source}]]` : ''}${c.time ? ` · ${c.time}` : ''}`,
					cls: 'foreshadowing-entry-quote-meta'
				});
			}
			quoteEl.createDiv({ text: c.text, cls: 'foreshadowing-entry-quote-text' });
		});

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

		// 跳转按钮：单条引用直接跳转，多条引用显示选择菜单
		const jumpBtn = actions.createEl('button', { text: '跳转', cls: 'foreshadowing-action-btn' });
		jumpBtn.onclick = async (e) => {
			// 收集所有有来源的引用
			const sources = entry.contents
				.filter(c => c.source)
				.map(c => c.source);
			// 加上标题行的来源（如果不重复）
			if (!sources.includes(entry.sourceFile)) sources.unshift(entry.sourceFile);

			if (sources.length <= 1) {
				// 单个来源，直接跳转
				const target = sources[0] || entry.sourceFile;
				const file = this.app.vault.getMarkdownFiles().find(f => f.basename === target);
				if (file) {
					await this.app.workspace.getLeaf(false).openFile(file);
				} else {
					new Notice(`找不到文件：${target}`);
				}
			} else {
				// 多个来源，显示下拉菜单
				const menu = new Menu();
				for (const source of sources) {
					menu.addItem((item: any) => {
						item.setTitle(source).onClick(async () => {
							const file = this.app.vault.getMarkdownFiles().find(f => f.basename === source);
							if (file) {
								await this.app.workspace.getLeaf(false).openFile(file);
							} else {
								new Notice(`找不到文件：${source}`);
							}
						});
					});
				}
				menu.showAtMouseEvent(e);
			}
		};

		// 回收按钮（仅未回收状态显示）
		if (entry.status === ForeshadowingStatus.Pending) {
			const recoverBtn = actions.createEl('button', { text: '标记回收', cls: 'foreshadowing-action-btn foreshadowing-recover-btn' });
			recoverBtn.onclick = () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				new ForeshadowingRecoveryModal(
					this.app,
					entry.contents[0]?.text || '',
					this.currentFolder,
					async (recoveryFileNames) => {
						const success = await this.plugin.foreshadowingManager.markAsRecovered(
							foreshadowingFile, entry.sourceFile, entry.createdAt, recoveryFileNames
						);
						if (success) {
							const fileList = recoveryFileNames.map(f => `[[${f}]]`).join('、');
							new Notice(`[成功] 已标记为回收：${fileList}`);
							// 文件修改会自动触发刷新，但在某些平台可能有延迟，添加备用刷新
							setTimeout(() => this.refresh(), 100);
						} else {
							new Notice('[错误] 标记失败，请检查伏笔文件');
						}
					}
				).open();
			};

			// 废弃按钮（未回收状态显示）
			const deprecateBtn = actions.createEl('button', { text: '废弃', cls: 'foreshadowing-action-btn foreshadowing-deprecate-btn' });
			deprecateBtn.onclick = async () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				const success = await this.plugin.foreshadowingManager.markAsDeprecated(
					foreshadowingFile, entry.sourceFile, entry.createdAt
				);
				if (success) {
					new Notice('已标记为废弃');
					// 文件修改会自动触发刷新，但在某些平台可能有延迟，添加备用刷新
					setTimeout(() => this.refresh(), 100);
				} else {
					new Notice('[错误] 操作失败');
				}
			};
		}

		// 恢复按钮（已废弃状态显示）
		if (entry.status === ForeshadowingStatus.Deprecated) {
			const restoreBtn = actions.createEl('button', { text: '恢复', cls: 'foreshadowing-action-btn' });
			restoreBtn.onclick = async () => {
				const foreshadowingFile = this.getForeshadowingFile();
				if (!foreshadowingFile) return;
				const success = await this.plugin.foreshadowingManager.markAsPending(
					foreshadowingFile, entry.sourceFile, entry.createdAt
				);
				if (success) {
					new Notice('已恢复为未回收');
					// 文件修改会自动触发刷新，但在某些平台可能有延迟，添加备用刷新
					setTimeout(() => this.refresh(), 100);
				} else {
					new Notice('[错误] 操作失败');
				}
			};
		}

		// 已回收时显示回收章节（支持多章节）
		if (entry.status === ForeshadowingStatus.Recovered) {
			const recoveryEl = card.createDiv({ cls: 'foreshadowing-entry-recovery' });
			recoveryEl.createSpan({ text: '回收于：', cls: 'foreshadowing-entry-recovery-label' });
			
			// 优先使用新格式（多章节）
			if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
				entry.recoveryFiles.forEach((file, index) => {
					if (index > 0) recoveryEl.createSpan({ text: '、' });
					const recoveryLink = recoveryEl.createEl('a', { text: file, cls: 'foreshadowing-entry-recovery-link' });
					recoveryLink.onclick = async () => {
						const targetFile = this.app.vault.getMarkdownFiles().find(f => f.basename === file);
						if (targetFile) await this.app.workspace.getLeaf(false).openFile(targetFile);
					};
				});
			}
			// 向后兼容：如果只有旧格式（单章节）
			else if (entry.recoveryFile) {
				const recoveryLink = recoveryEl.createEl('a', { text: entry.recoveryFile, cls: 'foreshadowing-entry-recovery-link' });
				recoveryLink.onclick = async () => {
					const file = this.app.vault.getMarkdownFiles().find(f => f.basename === entry.recoveryFile);
					if (file) await this.app.workspace.getLeaf(false).openFile(file);
				};
			}
		}
	}

	private getForeshadowingFile(): TFile | null {
		return this.plugin.foreshadowingManager.getForeshadowingFileByFolder(this.currentFolder);
	}

	private async loadEntries(): Promise<ParsedEntry[] | null> {
		const file = this.getForeshadowingFile();
		if (!file) return null;

		const content = await this.app.vault.read(file);
		return this.parseEntries(content);
	}

	/**
	 * 解析伏笔文件内容为结构化数据
	 */
	private parseEntries(content: string): ParsedEntry[] {
		const entries: ParsedEntry[] = [];
		// 按 --- 分割条目
		const blocks = content.split(/\n---\n/);

		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed || !trimmed.startsWith('## ')) continue;

			// 解析标题行：## [[来源文件]] - 时间
			const titleMatch = trimmed.match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?/m);
			if (!titleMatch) continue;

			const sourceFile = titleMatch[1];
			const createdAt = titleMatch[2]?.trim() || '';

			// 解析所有引用块（支持多条）
			const contents: { source: string; time: string; text: string }[] = [];
			const lines = trimmed.split('\n');
			let i = 0;

			// 跳过标题行
			while (i < lines.length && lines[i].startsWith('## ')) i++;

			// 收集引用块
			while (i < lines.length) {
				const line = lines[i];
				if (line.startsWith('> ')) {
					// 检查上一行是否是来源标注（> [[文件]] - 时间）
					let source = '';
					let time = '';
					const quoteLines: string[] = [];

					// 第一行可能是来源标注
					const sourceLine = line.replace(/^> /, '');
					const sourceMatch = sourceLine.match(/^\[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (sourceMatch) {
						source = sourceMatch[1];
						time = sourceMatch[2]?.trim() || '';
						i++;
						// 收集后续引用行
						while (i < lines.length && lines[i].startsWith('> ')) {
							quoteLines.push(lines[i].replace(/^> /, ''));
							i++;
						}
					} else {
						// 普通引用行（第一条，来源来自标题行）
						while (i < lines.length && lines[i].startsWith('> ')) {
							quoteLines.push(lines[i].replace(/^> /, ''));
							i++;
						}
					}

					if (quoteLines.length > 0) {
						// 如果没有内联来源标注，用标题行的来源和时间
						contents.push({
							source: source || sourceFile,
							time: time || createdAt,
							text: quoteLines.join('\n')
						});
					}
				} else {
					i++;
				}
			}

			// 如果没有解析到引用，用第一个 > 行
			if (contents.length === 0) {
				const firstQuote = lines.find(l => l.startsWith('> '));
				if (firstQuote) {
					contents.push({ source: sourceFile, time: createdAt, text: firstQuote.replace(/^> /, '') });
				}
			}

			// 解析说明
			const descMatch = trimmed.match(/\*\*说明\*\*：(.+)/);
			const description = descMatch ? descMatch[1].trim() : '';

			// 解析标签
			const tagsMatch = trimmed.match(/\*\*标签\*\*：(.+)/);
			const tags = tagsMatch
				? tagsMatch[1].trim().split(/\s+/).map(t => t.replace(/^#/, ''))
				: [];

			// 解析状态
			const statusMatch = trimmed.match(/\*\*状态\*\*：(.+)/);
			const statusText = statusMatch ? statusMatch[1].trim() : '未回收';
			let status = ForeshadowingStatus.Pending;
			if (statusText === '已回收') status = ForeshadowingStatus.Recovered;
			else if (statusText === '已废弃') status = ForeshadowingStatus.Deprecated;

			// 解析回收信息（支持多章节）
			// 新格式：**回收于**：\n- [[章节1]] - 时间\n- [[章节2]] - 时间
			const recoveryListMatch = trimmed.match(/\*\*回收于\*\*：\n((?:- \[\[.+?\]\].*\n?)+)/);
			let recoveryFiles: string[] | undefined;
			let recoveredAts: string[] | undefined;
			let recoveryFile: string | undefined;
			let recoveredAt: string | undefined;

			if (recoveryListMatch) {
				// 多章节格式
				const listLines = recoveryListMatch[1].trim().split('\n');
				recoveryFiles = [];
				recoveredAts = [];
				listLines.forEach(line => {
					const match = line.match(/^- \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
					if (match) {
						recoveryFiles!.push(match[1]);
						recoveredAts!.push(match[2]?.trim() || '');
					}
				});
			} else {
				// 旧格式（单章节）：**回收于**：[[章节]] - 时间
				const singleRecoveryMatch = trimmed.match(/\*\*回收于\*\*：\[\[(.+?)\]\](?:\s*-\s*(.+))?/);
				if (singleRecoveryMatch) {
					recoveryFile = singleRecoveryMatch[1];
					recoveredAt = singleRecoveryMatch[2]?.trim();
				}
			}

			if (description) {
				entries.push({ sourceFile, createdAt, contents, description, tags, status, recoveryFiles, recoveredAts, recoveryFile, recoveredAt });
			}
		}

		return entries;
	}

	/**
	 * 注入样式（空方法，样式已在 main.ts 中全局注入）
	 */
	private injectStyles() {
		// 样式已在 main.ts 的 injectGlobalStyles() 中全局注入
		// 此方法保留用于向后兼容
	}
}
