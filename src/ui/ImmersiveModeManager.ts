import type { App, EventRef, WorkspaceLeaf, TFile, WorkspaceSplit, WorkspaceItem } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t } from '../i18n';

/**
 * 沉浸模式管理器
 * 负责核心的工作区拆分、界面重构、顶栏注入和无痕还原
 */
export class ImmersiveModeManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;
	private isImmersiveActive: boolean = false;
	private savedLayout: Record<string, unknown> | null = null;
	private savedActiveFile: TFile | null = null;

	private topBarEl: HTMLElement | null = null;
	private updateInterval: number | null = null;
	private immersiveNovelTitle: string = '';

	// 追踪当前沉浸模式中的活跃叶子，用于精确抓取比例
	private activeTopLeaf: WorkspaceLeaf | null = null;
	private activeLeftLeaf: WorkspaceLeaf | null = null;
	private activeRightLeaf: WorkspaceLeaf | null = null;
	private activeBottomLeaf: WorkspaceLeaf | null = null;
	
	private layoutChangeRef: EventRef | null = null;

	// 顶部栏元素缓存
	private topBarStatsEls: Record<string, HTMLElement> = {};

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 从 leaf 向上找到真正的 WorkspaceSplit（跳过 WorkspaceTabs）
	 * @param leaf 赴始叶子
	 * @param direction 可选，限定只返回指定方向的 split
	 */
	private getParentSplit(leaf: WorkspaceLeaf, direction?: 'vertical' | 'horizontal'): WorkspaceSplit | null {
		// Traverse up the parent chain; parent may be WorkspaceTabs or WorkspaceSplit
		let node: WorkspaceSplit | null = (leaf.parent as unknown as WorkspaceSplit) ?? null;
		while (node) {
			if (node.direction !== undefined) {
				if (!direction || node.direction === direction) return node;
			}
			if (!node.parent) break;
			node = (node.parent as unknown as WorkspaceSplit) ?? null;
		}
		return null;
	}

	/**
	 * 切换沉浸模式状态
	 */
	public async toggleImmersiveMode(): Promise<void> {
		if (this.isImmersiveActive || activeDocument.body.classList.contains('immersive-mode-active')) {
			await this.exitImmersiveMode();
		} else {
			await this.enterImmersiveMode();
		}
	}

	/**
	 * 进入沉浸模式
	 */
	private async enterImmersiveMode(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice(t('immersive.please-open-chapter'));
			return;
		}
		this.savedActiveFile = activeView.file;
		this.immersiveNovelTitle = activeView.file.parent?.isRoot() ? activeView.file.basename : (activeView.file.parent?.name || t('common.unnamed-novel'));

		try {
			// 0. 强制同步所有活跃悬浮便签到管理器，确保数据最新
			this.plugin.syncActiveNotesToManager();
			await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());

			// 1. 抓取当前整个工作区的快照
			if (typeof this.app.workspace.getLayout === 'function') {
				this.savedLayout = this.app.workspace.getLayout() as Record<string, unknown>;
			}

			// 2. 注入全局 CSS 类和 Dashboard
			activeDocument.body.classList.add('immersive-mode-active');
			if (this.plugin.settings.immersive.immersiveHideProperties) {
				activeDocument.body.classList.add('immersive-hide-properties');
			}
			this.createTopBar();

			// 3. 构建排版
			await this.buildImmersiveLayout(this.savedActiveFile);

			// 4. 自动化：开启全屏 + 开启计时
			if (!activeDocument.fullscreenElement) {
				activeDocument.documentElement.requestFullscreen().catch(() => {
					this.app.commands.executeCommandById('app:toggle-full-screen');
				});
			}
			this.plugin.startTracking();

			this.isImmersiveActive = true;
			new Notice(t('immersive.enter'));
		} catch (error) {
			console.error('[ImmersiveModeManager] 进入沉浸模式失败:', error);
			new Notice(t('immersive.enter-failed'));
			await this.exitImmersiveMode();
		}
	}

	/**
	 * 退出沉浸模式并还原环境
	 */
	public async exitImmersiveMode(): Promise<void> {
		try {
			// 1. 保存当前的辅助面板比例
			this.saveCurrentPanelSizes();
			await this.plugin.saveSettings();

			// 1.5 记录退出前那一刻主编辑区正在编辑的文件
			const currentMainFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;

			// 2. 还原布局
			if (this.savedLayout && typeof this.app.workspace.setLayout === 'function') {
				await this.app.workspace.setLayout(this.savedLayout);

				if (currentMainFile) {
					window.requestAnimationFrame(() => {
						const leaves = this.app.workspace.getLeavesOfType('markdown');
						const targetLeaf = leaves.find(l => l.active) || leaves[0] || this.app.workspace.getLeaf(false);

						void targetLeaf.setViewState({
							type: 'markdown',
							state: { file: currentMainFile.path },
							active: true
						});
					});
				}
			} else {
				console.warn('[ImmersiveModeManager] 退出时未找到保存的布局，跳过布局还原');
			}

			// 3. 自动化清理：退出全屏 + 停止计时
			if (activeDocument.fullscreenElement) {
				activeDocument.exitFullscreen().catch(() => {
					this.app.commands.executeCommandById('app:toggle-full-screen');
				});
			}

			// 4. 反向同步便签
			await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
			this.plugin.syncFloatingNotes();
			this.plugin.stopTracking();

		} catch (error) {
			console.error('[ImmersiveModeManager] 退出沉浸模式时发生错误:', error);
			new Notice(t('immersive.exit-warning'));
		} finally {
			if (this.layoutChangeRef) {
				this.app.workspace.offref(this.layoutChangeRef);
				this.layoutChangeRef = null;
			}
			activeDocument.body.classList.remove('immersive-mode-active');
			activeDocument.body.classList.remove('immersive-hide-properties');
			this.removeTopBar();

			this.isImmersiveActive = false;
			this.savedLayout = null;
			this.savedActiveFile = null;

			this.app.workspace.requestSaveLayout();

			this.activeTopLeaf = null;
			this.activeLeftLeaf = null;
			this.activeRightLeaf = null;
			this.activeBottomLeaf = null;

			new Notice(t('immersive.exited'));
		}
	}

	/**
	 * 动态构建沉浸模式布局
	 */
	private async buildImmersiveLayout(activeFile: TFile): Promise<void> {
		const { workspace } = this.app;
		const immersive = this.plugin.settings.immersive;

		// 1. 软重置：清理非 Markdown 视图，保留主编辑器
		let mainLeaf: WorkspaceLeaf | null = null;
		const markdownLeaves = workspace.getLeavesOfType("markdown");
		mainLeaf = markdownLeaves.find(l => l.active) || markdownLeaves[0];
		if (!mainLeaf) {
			mainLeaf = workspace.getLeaf(true);
		}

		// 彻底关闭主工作区的所有其他叶子
		workspace.iterateRootLeaves(leaf => {
			if (leaf !== mainLeaf) {
				leaf.detach();
			}
		});

		// 获取当前状态以保留 source (Live Preview) 等设置
		const currentState = mainLeaf.getViewState();
		await mainLeaf.setViewState({
			type: "markdown",
			state: { ...currentState.state, file: activeFile.path, mode: 'source' },
			active: true
		});

		const pendingSizes: Array<{ split: WorkspaceSplit; sizes: number[] }> = [];

		const createSlotLeaves = async (slots: string[], direction: 'vertical' | 'horizontal', before: boolean, size: number, internalSizes: number[]) => {
			if (!slots || slots.length === 0) return null;
			const firstLeaf = workspace.createLeafBySplit(mainLeaf, direction, before);
			
			const parentSplit = this.getParentSplit(mainLeaf);
			if (parentSplit && parentSplit.children) {
				// 获取同级 children 的数量
				const childCount = parentSplit.children.length;
				if (childCount === 2) {
					const size0 = before ? size : 100 - size;
					const size1 = before ? 100 - size : size;
					pendingSizes.push({ split: parentSplit, sizes: [size0, size1] });
				} else if (childCount === 3) {
					// 只有在左右两侧都有时才会出现 childCount 3
					let otherSize = 0;
					if (direction === 'horizontal') {
						otherSize = before ? immersive.immersiveBottomSize : immersive.immersiveTopSize;
					} else {
						otherSize = before ? immersive.immersiveRightSize : immersive.immersiveLeftSize;
					}
					const centerSize = 100 - size - otherSize;
					const sizes = before ? [size, centerSize, otherSize] : [otherSize, centerSize, size];
					pendingSizes.push({ split: parentSplit, sizes });
				}
			}

			let currentLeaf = firstLeaf;
			for (let i = 0; i < slots.length; i++) {
				const viewType = slots[i];
				if (i > 0) {
					// 内部切分使用与外部相反的切割方向
					const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
					currentLeaf = workspace.createLeafBySplit(currentLeaf, internalDir, false);
				}
				if (viewType === 'reference-view') {
					const state: Record<string, string> = { mode: 'preview' };
					if (immersive.lastReferenceFilePath) {
						state.file = immersive.lastReferenceFilePath;
					}
					await currentLeaf.setViewState({ 
						type: 'markdown',
						state
					});
					currentLeaf.containerEl.classList.add('immersive-reference-view');
				} else {
					await currentLeaf.setViewState({ type: viewType });
				}
			}

			if (slots.length > 1) {
				const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
				const internalSplit = this.getParentSplit(currentLeaf, internalDir);
				if (internalSplit && internalSplit.children && internalSplit.children.length === slots.length) {
					let finalInternalSizes = internalSizes;
					if (!finalInternalSizes || finalInternalSizes.length !== slots.length) {
						const avg = 100 / slots.length;
						finalInternalSizes = new Array<number>(slots.length).fill(avg);
					}
					pendingSizes.push({ split: internalSplit, sizes: finalInternalSizes });
				}
			}

			return firstLeaf;
		};

		// 动态构建：空槽不创建，主编辑区自动贴边
		// 我们先切上下，再切左右
		this.activeTopLeaf = await createSlotLeaves(immersive.immersiveTopSlots, 'horizontal', true, immersive.immersiveTopSize, immersive.immersiveTopInternalSizes);
		this.activeBottomLeaf = await createSlotLeaves(immersive.immersiveBottomSlots, 'horizontal', false, immersive.immersiveBottomSize, immersive.immersiveBottomInternalSizes);
		this.activeLeftLeaf = await createSlotLeaves(immersive.immersiveLeftSlots, 'vertical', true, immersive.immersiveLeftSize, immersive.immersiveLeftInternalSizes);
		this.activeRightLeaf = await createSlotLeaves(immersive.immersiveRightSlots, 'vertical', false, immersive.immersiveRightSize, immersive.immersiveRightInternalSizes);

		// 延迟应用所有比例
		this.applyPendingSizes(pendingSizes);

		// 确保主编辑器聚焦
		workspace.setActiveLeaf(mainLeaf, { focus: true });

		window.setTimeout(() => this.app.workspace.updateOptions(), 300);
		
		// 监听布局变化，实时保存比例
		this.layoutChangeRef = this.app.workspace.on('layout-change', () => {
			if (!this.isImmersiveActive) return;
			this.plugin.adaptiveDebounceManager.debounceFixed('immersive-save-sizes', () => {
				if (!this.isImmersiveActive) return;
				this.saveCurrentPanelSizes();
				this.plugin.saveSettings().catch(() => {});
			}, 1000);
		});
	}

	/**
	 * 延迟应用面板比例（递归重试，确保 DOM 渲染完成后生效）
	 */
	private applyPendingSizes(pendingSizes: Array<{ split: WorkspaceSplit; sizes: number[] }>): void {
		const apply = (attempt = 0) => {
			let hasFailure = false;
			for (const { split, sizes } of pendingSizes) {
				if (!split || !split.children || !split.containerEl) continue;

				const isHorizontal = split.direction === 'horizontal';
				const totalSize = isHorizontal
					? split.containerEl.offsetHeight
					: split.containerEl.offsetWidth;

				if (totalSize === 0) {
					hasFailure = true;
					continue;
				}

				const childCount = Math.min(split.children.length, sizes.length);
				for (let i = 0; i < childCount; i++) {
					split.children[i].size = sizes[i];

					if (typeof split.setElSize === 'function' && split.children[i].containerEl) {
						const pixelSize = Math.round((sizes[i] / 100) * totalSize);
						split.setElSize(split.children[i].containerEl!, pixelSize);
					}
				}
			}

			if (hasFailure && attempt < 5 && this.isImmersiveActive) {
				window.setTimeout(() => apply(attempt + 1), 100 * (attempt + 1));
			}
		};

		window.requestAnimationFrame(() => apply(0));
		window.setTimeout(() => apply(0), 300);
	}

	/**
	 * 创建顶部仪表盘
	 */
	private createTopBar(): void {
		if (this.topBarEl) return;

		this.topBarEl = activeDocument.createElement('div');
		this.topBarEl.id = 'immersive-top-bar';
		this.topBarEl.className = 'immersive-top-bar';

		const leftDiv = this.topBarEl.createDiv({ cls: 'immersive-top-bar-left' });
		leftDiv.createSpan({ cls: 'novel-title', text: this.immersiveNovelTitle });

		const centerDiv = this.topBarEl.createDiv({ cls: 'immersive-top-bar-center' });

		const rightDiv = this.topBarEl.createDiv({ cls: 'immersive-top-bar-right' });
		const exitBtn = rightDiv.createEl('button', { cls: 'immersive-exit-btn', text: t('immersive.exit-btn') });
		exitBtn.addEventListener('click', () => { void this.exitImmersiveMode(); });

		this.topBarStatsEls = {
			totalTime: centerDiv.createSpan({ cls: 'stat-item' }),
			focusTime: centerDiv.createSpan({ cls: 'stat-item focus' }),
			slackTime: centerDiv.createSpan({ cls: 'stat-item slack' }),
			chapterProgress: centerDiv.createSpan({ cls: 'stat-item' }),
			dailyProgress: centerDiv.createSpan({ cls: 'stat-item' }),
			rankingProgress: centerDiv.createSpan({ cls: 'stat-item' }),
			sessionWords: centerDiv.createSpan({ cls: 'stat-item' })
		};

		for (const el of Object.values(this.topBarStatsEls)) {
			el.hide();
		}

		activeDocument.body.appendChild(this.topBarEl);
		void this.renderTopBarContent();

		this.updateInterval = this.plugin.registerInterval(window.setInterval(() => {
			void this.renderTopBarContent();
		}, 1000));
	}

	private removeTopBar(): void {
		if (this.updateInterval) {
			window.clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
		if (this.topBarEl) {
			this.topBarEl.remove();
			this.topBarEl = null;
		}
	}

	private async renderTopBarContent(): Promise<void> {
		if (!this.topBarEl) return;
		try {
			const immersive = this.plugin.settings.immersive;
			const stats = await this.plugin.obsHtmlBuilder.getObsStats();

			const updateStatEl = (key: string, show: boolean, text: string) => {
				const el = this.topBarStatsEls[key];
				if (!el) return;
				if (show) {
					if ((!el.isShown())) el.show()
					if (el.innerText !== text) el.innerText = text;
				} else {
					if (el.isShown()) el.hide();
				}
			};

			updateStatEl('totalTime', !!immersive.immersiveShowTotalTime, `${t('immersive.total-time')} (${stats.totalTime})`);
			updateStatEl('focusTime', !!immersive.immersiveShowFocusTime, `${t('immersive.focus-time')} (${stats.focusTime})`);
			updateStatEl('slackTime', !!immersive.immersiveShowSlackTime, `${t('immersive.slack-time')} (${stats.slackTime})`);
			updateStatEl('chapterProgress', !!immersive.immersiveShowChapterProgress, `${t('immersive.chapter-progress')} (${stats.todayWords}/${stats.goal})`);
			updateStatEl('dailyProgress', !!immersive.immersiveShowDailyProgress, `${t('immersive.daily-progress')} (${stats.dailyWords}/${stats.dailyGoal})`);
			updateStatEl('rankingProgress', !!immersive.immersiveShowRankingProgress, `${t('immersive.ranking-progress')} (${stats.rankingWords}/${stats.rankingGoal})`);
			updateStatEl('sessionWords', !!immersive.immersiveShowSessionWords, `${t('immersive.session-words')} (${stats.sessionWords})`);
		} catch (e) {
			console.error('[ImmersiveModeManager] renderTopBarContent failed:', e);
		}
	}

	/**
	 * 保存当前面板比例
	 */
	private saveCurrentPanelSizes(): void {
		const immersive = this.plugin.settings.immersive;

		const saveSize = (leaf: WorkspaceLeaf | null, direction: 'horizontal' | 'vertical', setter: (size: number) => void, internalSetter: (sizes: number[]) => void, slotCount: number) => {
			if (leaf && leaf.containerEl && leaf.containerEl.offsetParent) {
				const split = this.getParentSplit(leaf, direction);
				if (split && split.direction === direction && split.containerEl && split.children) {
					const totalSize = direction === 'horizontal' ? split.containerEl.offsetHeight : split.containerEl.offsetWidth;
					if (totalSize > 0) {
						const child = split.children.find((c: WorkspaceItem) => c.containerEl && c.containerEl.contains(leaf.containerEl));
						if (child) {
							const size = direction === 'horizontal' ? child.containerEl!.offsetHeight : child.containerEl!.offsetWidth;
							const pct = Math.round((size / totalSize) * 100);
							if (pct > 0 && pct < 100) {
								setter(pct);
							}
						}
					}
				}

				if (slotCount > 1) {
					const internalDir = direction === 'vertical' ? 'horizontal' : 'vertical';
					const internalSplit = this.getParentSplit(leaf, internalDir);
					if (internalSplit && internalSplit.direction === internalDir && internalSplit.containerEl && internalSplit.children) {
						const totalIntSize = internalDir === 'horizontal' ? internalSplit.containerEl.offsetHeight : internalSplit.containerEl.offsetWidth;
						if (totalIntSize > 0 && internalSplit.children.length === slotCount) {
							const newSizes: number[] = [];
							for (const c of internalSplit.children) {
								const s = internalDir === 'horizontal' ? c.containerEl?.offsetHeight || 0 : c.containerEl?.offsetWidth || 0;
								newSizes.push(Math.round((s / totalIntSize) * 100));
							}
							internalSetter(newSizes);
						}
					}
				}
			}
		};

		// 记录当前参考文档区打开的文件
		this.app.workspace.iterateRootLeaves(leaf => {
			if (leaf.containerEl && leaf.containerEl.classList.contains('immersive-reference-view')) {
				const mdView = leaf.view.getViewType() === 'markdown' ? leaf.view as MarkdownView : null;
				if (mdView && mdView.file) {
					immersive.lastReferenceFilePath = mdView.file.path;
				}
			}
		});

		saveSize(this.activeTopLeaf, 'horizontal', s => immersive.immersiveTopSize = s, s => immersive.immersiveTopInternalSizes = s, immersive.immersiveTopSlots.length);
		saveSize(this.activeBottomLeaf, 'horizontal', s => immersive.immersiveBottomSize = s, s => immersive.immersiveBottomInternalSizes = s, immersive.immersiveBottomSlots.length);
		saveSize(this.activeLeftLeaf, 'vertical', s => immersive.immersiveLeftSize = s, s => immersive.immersiveLeftInternalSizes = s, immersive.immersiveLeftSlots.length);
		saveSize(this.activeRightLeaf, 'vertical', s => immersive.immersiveRightSize = s, s => immersive.immersiveRightInternalSizes = s, immersive.immersiveRightSlots.length);
	}
}