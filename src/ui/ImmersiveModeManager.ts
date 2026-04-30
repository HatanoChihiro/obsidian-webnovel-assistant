import { App, MarkdownView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { VIEW_TYPES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 沉浸模式管理器
 * 负责核心的工作区拆分、界面重构、顶栏注入和无痕还原
 */
export class ImmersiveModeManager {
	private app: App;
	private plugin: WebNovelAssistantPlugin;
	private isImmersiveActive: boolean = false;
	private savedLayout: any = null;
	private savedActiveFile: TFile | null = null;
	
	private topBarEl: HTMLElement | null = null;
	private updateInterval: number | null = null;
	private immersiveNovelTitle: string = '';

	// 追踪当前沉浸模式中的活跃叶子，用于精确抓取比例
	private activeLeftLeaf: WorkspaceLeaf | null = null;
	private activeRightLeaf: WorkspaceLeaf | null = null;
	private activeBottomLeaf: WorkspaceLeaf | null = null;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 切换沉浸模式状态
	 */
	public async toggleImmersiveMode(): Promise<void> {
		// 增强状态检测：即使 isImmersiveActive 为 false，如果 DOM 中仍有标记，也应执行退出逻辑进行清理
		if (this.isImmersiveActive || document.body.classList.contains('immersive-mode-active')) {
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
			new Notice('[错误] 请先打开一个小说章节，再进入沉浸模式！');
			return;
		}
		this.savedActiveFile = activeView.file;
		this.immersiveNovelTitle = activeView.file.parent?.isRoot() ? activeView.file.basename : (activeView.file.parent?.name || '未命名小说');

		try {
			// 1. 抓取当前整个工作区的快照
			this.savedLayout = (this.app.workspace as any).getLayout();
			
			// 2. 注入全局 CSS 类和顶部 Dashboard
			document.body.classList.add('immersive-mode-active');
			this.createTopBar();
			
			// 3. 构建排版
			await this.buildImmersiveLayout(this.savedActiveFile);

			// 4. 自动化：开启全屏 + 开启计时
			if (!document.fullscreenElement) {
				document.documentElement.requestFullscreen().catch(() => {
					(this.app as any).commands.executeCommandById('app:toggle-full-screen');
				});
			}
			this.plugin.startTracking();
			
			this.isImmersiveActive = true;
			new Notice('已进入全屏沉浸模式');
		} catch (error) {
			console.error('[ImmersiveModeManager] 进入沉浸模式失败:', error);
			new Notice('[错误] 进入沉浸模式失败！');
			await this.exitImmersiveMode(); // 失败时强制执行退出逻辑清理现场
		}
	}

	/**
	 * 退出沉浸模式并还原环境
	 */
	public async exitImmersiveMode(): Promise<void> {
		try {
			// 1. 保存当前的辅助面板比例 (核心功能)
			this.saveCurrentPanelSizes();
			await this.plugin.saveSettings();

			// 1.5 记录退出前那一刻主编辑区正在编辑的文件，以便在还原布局后重新定位
			const currentMainFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;

			// 2. 还原布局 (如果可能)
			if (this.savedLayout) {
				await (this.app.workspace as any).setLayout(this.savedLayout);
				
				// 还原布局后，如果文件发生了变化（例如在沉浸模式中切换了章节），则重新打开该文件
				if (currentMainFile) {
					// 延迟一帧确保布局还原完成
					requestAnimationFrame(async () => {
						const leaves = this.app.workspace.getLeavesOfType('markdown');
						const targetLeaf = leaves.find(l => (l as any).active) || leaves[0] || this.app.workspace.getLeaf(false);
						
						await targetLeaf.setViewState({
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
			if (document.fullscreenElement) {
				document.exitFullscreen().catch(() => {
					(this.app as any).commands.executeCommandById('app:toggle-full-screen');
				});
			}

			// 4. 反向同步便签
			this.plugin.app.workspace.trigger('webnovel:notes-changed');
			this.plugin.syncFloatingNotes();
			this.plugin.stopTracking();

		} catch (error) {
			console.error('[ImmersiveModeManager] 退出沉浸模式时发生错误:', error);
			new Notice('[警告] 退出沉浸模式出现异常，已强制清理界面');
		} finally {
			// 5. 终极清理：移除样式、顶栏，清空内存引用
			document.body.classList.remove('immersive-mode-active');
			this.removeTopBar();
			
			this.isImmersiveActive = false;
			this.savedLayout = null;
			this.savedActiveFile = null;
			
			// 确保工作区能够响应
			this.app.workspace.requestSaveLayout();
			
			// 清理引用
			this.activeLeftLeaf = null;
			this.activeRightLeaf = null;
			this.activeBottomLeaf = null;

			new Notice('已退出沉浸模式');
		}
	}

	/**
	 * 动态构建沉浸模式布局 (仅在第一次或没有保存过布局时调用)
	 */
	private async buildImmersiveLayout(activeFile: TFile): Promise<void> {
		const { workspace } = this.app;
		const { settings } = this.plugin;



		// 辅助函数：从 leaf 向上找到真正的 WorkspaceSplit（跳过 WorkspaceTabs）
		const getParentSplit = (leaf: any): any => {
			let node = leaf.parent; // 第一层通常是 WorkspaceTabs
			// 向上遍历，直到找到有 direction 属性的 WorkspaceSplit
			while (node && node.direction === undefined && node.parent) {
				node = node.parent;
			}
			return node;
		};

		// 1. 软重置：清理非 Markdown 视图，保留主编辑器
		let mainLeaf: WorkspaceLeaf | null = null;
		const markdownLeaves = workspace.getLeavesOfType('markdown');
		mainLeaf = markdownLeaves.find(l => (l as any).active) || markdownLeaves[0];
		if (!mainLeaf) {
			mainLeaf = workspace.getLeaf(true);
		}

		// 彻底关闭主工作区的所有其他叶子
		workspace.iterateRootLeaves(leaf => {
			if (leaf !== mainLeaf) {
				leaf.detach();
			}
		});

		// 确保文件已加载
		await mainLeaf.setViewState({
			type: 'markdown',
			state: { file: activeFile.path },
			active: true
		});

		// 收集需要延迟应用比例的 split 信息
		const pendingSizes: Array<{ split: any; sizes: number[] }> = [];

		// 收集叶子引用，用于退出时精确抓取比例
		let finalLeftLeaf: WorkspaceLeaf | null = null;
		let finalRightLeaf: WorkspaceLeaf | null = null;
		let finalBottomLeaf: WorkspaceLeaf | null = null;

		// 2. 创建底部/顶部辅助面板区域
		const showBottom = settings.immersiveShowStickyNotes || settings.immersiveShowForeshadowing || settings.immersiveShowTimeline;
		if (showBottom) {
			const isTop = settings.immersivePanelPosition === 'top';
			const bottomSplitLeaf = workspace.createLeafBySplit(mainLeaf, 'horizontal', isTop);
			finalBottomLeaf = bottomSplitLeaf;

			// 记录比例
			const bottomSize = settings.immersiveBottomSize || 25;
			const parentSplit = getParentSplit(mainLeaf);
			if (parentSplit && parentSplit.children) {
				const size0 = isTop ? bottomSize : 100 - bottomSize;
				const size1 = isTop ? 100 - bottomSize : bottomSize;
				pendingSizes.push({ split: parentSplit, sizes: [size0, size1] });
			}

			// 填充辅助子面板
			let currentBottomLeaf = bottomSplitLeaf;
			let isFirst = true;
			let bottomPanelCount = 0;

			if (settings.immersiveShowStickyNotes) {
				await currentBottomLeaf.setViewState({ type: VIEW_TYPES.IMMERSIVE_STICKY_NOTES });
				isFirst = false;
				bottomPanelCount++;
			}
			if (settings.immersiveShowForeshadowing) {
				if (!isFirst) currentBottomLeaf = workspace.createLeafBySplit(currentBottomLeaf, 'vertical', false);
				await currentBottomLeaf.setViewState({ type: VIEW_TYPES.FORESHADOWING });
				isFirst = false;
				bottomPanelCount++;
			}
			if (settings.immersiveShowTimeline) {
				if (!isFirst) currentBottomLeaf = workspace.createLeafBySplit(currentBottomLeaf, 'vertical', false);
				await currentBottomLeaf.setViewState({ type: VIEW_TYPES.TIMELINE });
				bottomPanelCount++;
			}

			// 捕获辅助面板内部的 vertical split
			if (bottomPanelCount > 1) {
				const bottomInternalSplit = getParentSplit(bottomSplitLeaf);
				if (bottomInternalSplit && bottomInternalSplit.direction === 'vertical' && bottomInternalSplit.children) {
					const savedSizes = settings.immersiveBottomInternalSizes;
					if (savedSizes && savedSizes.length === bottomInternalSplit.children.length) {
						pendingSizes.push({ split: bottomInternalSplit, sizes: savedSizes });
					}
				}
			}
		}

		// 3. 创建左侧章节列表
		if (settings.immersiveShowChapterList) {
			const leftLeaf = workspace.createLeafBySplit(mainLeaf, 'vertical', true);
			finalLeftLeaf = leftLeaf;
			const leftSize = settings.immersiveLeftSize || 15;
			const parentSplit = getParentSplit(mainLeaf);
			if (parentSplit && parentSplit.children) {
				pendingSizes.push({ split: parentSplit, sizes: [leftSize, 100 - leftSize] });

			}
			await leftLeaf.setViewState({ type: VIEW_TYPES.IMMERSIVE_CHAPTER_LIST });
		}

		// 4. 创建右侧参考区
		if (settings.immersiveShowReference) {
			const rightLeaf = workspace.createLeafBySplit(mainLeaf, 'vertical', false);
			finalRightLeaf = rightLeaf;
			const rightSize = settings.immersiveRightSize || 15;
			const parentSplit = getParentSplit(mainLeaf);
			if (parentSplit && parentSplit.children) {
				const childCount = parentSplit.children.length;
				if (childCount === 3) {
					const leftSize = settings.immersiveLeftSize || 15;
					const centerSize = 100 - leftSize - rightSize;
					pendingSizes.push({ split: parentSplit, sizes: [leftSize, centerSize, rightSize] });
				} else {
					pendingSizes.push({ split: parentSplit, sizes: [100 - rightSize, rightSize] });
				}

			}
			await rightLeaf.setViewState({ type: 'markdown' });
			rightLeaf.containerEl.classList.add('immersive-reference-view');
		}

		// 5. 延迟应用所有比例
		this.applyPendingSizes(pendingSizes);

		// 6. 记录叶子引用（用于退出时精确计算比例）
		this.activeLeftLeaf = finalLeftLeaf;
		this.activeRightLeaf = finalRightLeaf;
		this.activeBottomLeaf = finalBottomLeaf;

		// 确保主编辑器聚焦
		workspace.setActiveLeaf(mainLeaf, { focus: true });
	}

	/**
	 * 延迟应用面板比例
	 * 策略：将百分比转换为像素后使用 setElSize 应用
	 * - setElSize 接受像素值，是 Obsidian 拖拽 resize handle 时使用的同一方法
	 * - 同时设置 .size 以保持内部状态一致
	 */
	/**
	 * 延迟应用面板比例
	 * 策略：使用递归重试机制，确保在 DOM 渲染完成（offsetWidth > 0）后再应用比例
	 */
	private applyPendingSizes(pendingSizes: Array<{ split: any; sizes: number[] }>): void {
		const apply = (attempt = 0) => {
			let hasFailure = false;
			for (const { split, sizes } of pendingSizes) {
				if (!split || !split.children || !split.containerEl) continue;
				
				const isHorizontal = split.direction === 'horizontal';
				const totalSize = isHorizontal 
					? split.containerEl.offsetHeight 
					: split.containerEl.offsetWidth;
				
				// 如果父容器尺寸还未准备好，标记失败并等待重试
				if (totalSize === 0) {
					hasFailure = true;
					continue;
				}
				
				const childCount = Math.min(split.children.length, sizes.length);
				for (let i = 0; i < childCount; i++) {
					// 1. 设置内部记录
					split.children[i].size = sizes[i];
					
					// 2. 应用物理尺寸
					if (typeof split.setElSize === 'function' && split.children[i].containerEl) {
						const pixelSize = Math.round((sizes[i] / 100) * totalSize);
						split.setElSize(split.children[i].containerEl, pixelSize);
					}
				}
			}

			// 如果有失败项，在下一帧或延时后重试，最多重试 5 次
			// 增加 isImmersiveActive 检查，防止退出后仍在后台尝试调整比例
			if (hasFailure && attempt < 5 && this.isImmersiveActive) {
				setTimeout(() => apply(attempt + 1), 100 * (attempt + 1));
			}
		};

		// 初始调用
		requestAnimationFrame(() => apply(0));
		// 备用调用，防止某些极端情况下 requestAnimationFrame 不触发
		setTimeout(() => apply(0), 300);
	}




	/**
	 * 创建顶部仪表盘
	 */
	private createTopBar(): void {
		if (this.topBarEl) return;
		
		this.topBarEl = document.createElement('div');
		this.topBarEl.id = 'immersive-top-bar';
		this.topBarEl.className = 'immersive-top-bar';
		
		// 插入到 body
		document.body.appendChild(this.topBarEl);
		
		this.renderTopBarContent();
		
		// 每秒刷新一次数据
		this.updateInterval = window.setInterval(() => {
			this.renderTopBarContent();
		}, 1000);
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

	private renderTopBarContent(): void {
		if (!this.topBarEl) return;
		const { settings } = this.plugin;
		const stats = this.plugin.obsHtmlBuilder.getObsStats();
		
		// 构建 HTML
		let html = `<div class="immersive-top-bar-left">
			<span class="novel-title">${this.immersiveNovelTitle}</span>
		</div>
		<div class="immersive-top-bar-center">`;
		
		if (settings.immersiveShowTotalTime) {
			html += `<span class="stat-item">总计 (${stats.totalTime})</span>`;
		}
		if (settings.immersiveShowFocusTime) {
			html += `<span class="stat-item focus">专注 (${stats.focusTime})</span>`;
		}
		if (settings.immersiveShowSlackTime) {
			html += `<span class="stat-item slack">摸鱼 (${stats.slackTime})</span>`;
		}
		if (settings.immersiveShowChapterProgress) {
			html += `<span class="stat-item">章节进度 (${stats.todayWords}/${stats.goal})</span>`;
		}
		if (settings.immersiveShowDailyProgress) {
			html += `<span class="stat-item">今日进度 (${stats.dailyWords}/${stats.dailyGoal})</span>`;
		}
		if (settings.immersiveShowSessionWords) {
			html += `<span class="stat-item">本场净增 (${stats.sessionWords})</span>`;
		}
		
		html += `</div>
		<div class="immersive-top-bar-right">
			<button class="immersive-exit-btn">退出沉浸模式</button>
		</div>`;
		
		this.topBarEl.innerHTML = html;
		
		// 绑定退出事件
		const exitBtn = this.topBarEl.querySelector('.immersive-exit-btn');
		if (exitBtn) {
			exitBtn.addEventListener('click', () => this.exitImmersiveMode());
		}
	}

	/**
	 * 保存当前面板比例
	 * 从 WorkspaceSplit 子节点的 containerEl 测量（与 setElSize 同级），避免累积误差
	 */
	private saveCurrentPanelSizes(): void {
		const { workspace } = this.app;
		const { settings } = this.plugin;

		/**
		 * 辅助函数：从 leaf 向上找到指定的 WorkspaceSplit
		 */
		const getParentSplit = (leaf: any, direction?: 'vertical' | 'horizontal'): any => {
			let node = leaf.parent;
			while (node && node.parent) {
				if (node.direction !== undefined) {
					if (!direction || node.direction === direction) return node;
				}
				node = node.parent;
			}
			return node;
		};

		// 1. 使用保存的引用或尝试查找 Leaf
		const leftLeaf = this.activeLeftLeaf || workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST)[0];
		const refLeaf = this.activeRightLeaf || workspace.getLeavesOfType('markdown').find(l => l.containerEl.classList.contains('immersive-reference-view'));
		const anyBottomLeaf = this.activeBottomLeaf || [
			workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES)[0],
			workspace.getLeavesOfType(VIEW_TYPES.FORESHADOWING)[0],
			workspace.getLeavesOfType(VIEW_TYPES.TIMELINE)[0]
		].find(l => l);

		// 2. 保存左侧面板比例
		if (leftLeaf && leftLeaf.containerEl && leftLeaf.containerEl.offsetParent) {
			const split = getParentSplit(leftLeaf);
			if (split && split.direction === 'vertical' && split.containerEl && split.children) {
				const totalWidth = split.containerEl.offsetWidth;
				if (totalWidth > 0) {
					// 寻找包含左侧面板的子容器
					const child = split.children.find(c => c.containerEl && c.containerEl.contains(leftLeaf.containerEl));
					if (child) {
						settings.immersiveLeftSize = Math.round((child.containerEl.offsetWidth / totalWidth) * 100);
					}
				}
			}
		}

		// 3. 保存右侧面板比例
		if (refLeaf && refLeaf.containerEl && refLeaf.containerEl.offsetParent) {
			const split = getParentSplit(refLeaf, 'vertical');
			if (split && split.direction === 'vertical' && split.containerEl && split.children) {
				const totalWidth = split.containerEl.offsetWidth;
				if (totalWidth > 0) {
					// 寻找包含右侧参考面板的子容器
					const child = split.children.find(c => c.containerEl && c.containerEl.contains(refLeaf.containerEl));
					if (child) {
						const pct = Math.round((child.containerEl.offsetWidth / totalWidth) * 100);
						if (pct > 0 && pct < 100) {
							settings.immersiveRightSize = pct;
						}
					}
				}
			}
		}

		// 4. 保存水平分割比例（主编辑区 vs 底部辅助面板高度）
		if (anyBottomLeaf) {
			const split = getParentSplit(anyBottomLeaf, 'horizontal');
			if (split && split.direction === 'horizontal' && split.containerEl && split.children) {
				const totalHeight = split.containerEl.offsetHeight;
				if (totalHeight > 0) {
					// 寻找包含辅助面板的子容器
					const child = split.children.find(c => c.containerEl && c.containerEl.contains(anyBottomLeaf.containerEl));
					if (child) {
						settings.immersiveBottomSize = Math.round((child.containerEl.offsetHeight / totalHeight) * 100);
					}
				}
			}
		}

		// 5. 保存底部面板内部比例（便签/伏笔/时间线之间）
		const stickyLeaf = workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES)[0];
		const foreLeaf = workspace.getLeavesOfType(VIEW_TYPES.FORESHADOWING)[0];
		const timeLeaf = workspace.getLeavesOfType(VIEW_TYPES.TIMELINE)[0];
		const bottomLeaves = [stickyLeaf, foreLeaf, timeLeaf].filter(l => l);
		if (bottomLeaves.length > 1) {
			const split = getParentSplit(bottomLeaves[0]);
			if (split && split.direction === 'vertical' && split.containerEl && split.children) {
				const totalWidth = split.containerEl.offsetWidth;
				if (totalWidth > 0) {
					const internalSizes: number[] = [];
					for (const child of split.children) {
						if (child.containerEl) {
							internalSizes.push(Math.round((child.containerEl.offsetWidth / totalWidth) * 100));
						}
					}
					if (internalSizes.length === split.children.length) {
						settings.immersiveBottomInternalSizes = internalSizes;
					}
				}
			}
		}

		console.log('[WebNovel Assistant] 沉浸模式比例已保存:', {
			left: settings.immersiveLeftSize,
			right: settings.immersiveRightSize,
			bottom: settings.immersiveBottomSize,
			bottomInternal: settings.immersiveBottomInternalSizes,
		});
	}
}
