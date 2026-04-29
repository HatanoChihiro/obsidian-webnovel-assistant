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

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * 切换沉浸模式状态
	 */
	public async toggleImmersiveMode(): Promise<void> {
		if (this.isImmersiveActive) {
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
			
			// 3. 构建排版 (永远基于最新设置动态构建，不再依赖不透明的 layout 镜像)
			await this.buildImmersiveLayout(this.savedActiveFile);


			// 4. 自动化：开启真全屏 (隐藏系统任务栏) + 开启计时
			if (!document.fullscreenElement) {
				document.documentElement.requestFullscreen().catch(err => {
					console.warn('[ImmersiveModeManager] 无法自动进入全屏模式:', err);
					// 备选方案：尝试 Obsidian 内置命令
					(this.app as any).commands.executeCommandById('app:toggle-full-screen');
				});
			}
			this.plugin.startTracking();
			
			this.isImmersiveActive = true;
			new Notice('已进入全屏沉浸模式！任务栏已隐藏，计时已开启。');
		} catch (error) {
			console.error('[ImmersiveModeManager] 进入沉浸模式失败:', error);
			new Notice('[错误] 进入沉浸模式失败！');
			document.body.classList.remove('immersive-mode-active');
			this.removeTopBar();
		}
	}

	/**
	 * 退出沉浸模式并还原环境
	 */
	public async exitImmersiveMode(): Promise<void> {
		if (!this.savedLayout) return;

		try {
			// 1. 在退出前，保存当前的辅助面板比例，以便下次进入时保持比例
			this.saveCurrentPanelSizes();
			await this.plugin.saveSettings();

			// 2. 还原布局
			await (this.app.workspace as any).setLayout(this.savedLayout);
			
			// 3. 自动化：退出真全屏 + 停止计时
			if (document.fullscreenElement) {
				document.exitFullscreen().catch(() => {
					// 备选方案
					(this.app as any).commands.executeCommandById('app:toggle-full-screen');
				});
			}
			this.plugin.stopTracking();

			// 4. 清除样式和注入的 DOM
			document.body.classList.remove('immersive-mode-active');
			this.removeTopBar();
			
			this.isImmersiveActive = false;
			this.savedLayout = null;
			this.savedActiveFile = null;
			new Notice('已退出沉浸模式，恢复日常工作区');
		} catch (error) {
			console.error('[ImmersiveModeManager] 退出沉浸模式失败:', error);
			new Notice('[严重错误] 恢复日常工作区失败！请重启 Obsidian');
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

		// 2. 创建底部/顶部辅助面板区域
		const showBottom = settings.immersiveShowStickyNotes || settings.immersiveShowForeshadowing || settings.immersiveShowTimeline;
		if (showBottom) {
			const isTop = settings.immersivePanelPosition === 'top';
			const bottomSplitLeaf = workspace.createLeafBySplit(mainLeaf, 'horizontal', isTop);

			// 记录比例（从 leaf 向上找到真正的 WorkspaceSplit）
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

			// 捕获辅助面板内部的 vertical split（便签/伏笔/时间线之间的比例）
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

		// 确保主编辑器聚焦
		workspace.setActiveLeaf(mainLeaf, { focus: true });
	}

	/**
	 * 延迟应用面板比例
	 * 策略：将百分比转换为像素后使用 setElSize 应用
	 * - setElSize 接受像素值，是 Obsidian 拖拽 resize handle 时使用的同一方法
	 * - 同时设置 .size 以保持内部状态一致
	 */
	private applyPendingSizes(pendingSizes: Array<{ split: any; sizes: number[] }>): void {
		const apply = () => {
			for (const { split, sizes } of pendingSizes) {
				if (!split || !split.children || !split.containerEl) continue;
				
				// 根据分割方向确定总尺寸
				// horizontal: 水平分割线 → 子元素上下堆叠 → 测量高度
				// vertical: 垂直分割线 → 子元素左右排列 → 测量宽度
				const isHorizontal = split.direction === 'horizontal';
				const totalSize = isHorizontal 
					? split.containerEl.offsetHeight 
					: split.containerEl.offsetWidth;
				
				if (totalSize === 0) return;
				
				const childCount = Math.min(split.children.length, sizes.length);
				for (let i = 0; i < childCount; i++) {
					// 1. 设置内部 size 属性（用于序列化）
					split.children[i].size = sizes[i];
					
					// 2. 将百分比转换为像素，使用 Obsidian 原生 API 设置 DOM
					if (typeof split.setElSize === 'function' && split.children[i].containerEl) {
						const pixelSize = Math.round((sizes[i] / 100) * totalSize);
						split.setElSize(split.children[i].containerEl, pixelSize);
					}
				}
			}
		};

		// 等待 Obsidian 完成初始布局后应用（需要 DOM 尺寸可测量）
		requestAnimationFrame(() => {
			apply();
		});
		// 兜底
		setTimeout(() => {
			apply();
		}, 300);
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
			clearInterval(this.updateInterval);
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

		// 辅助函数：从 leaf 向上找到真正的 WorkspaceSplit
		const getParentSplit = (leaf: any): any => {
			let node = leaf.parent;
			while (node && node.direction === undefined && node.parent) {
				node = node.parent;
			}
			return node;
		};

		// 1. 获取各个面板的 Leaf
		const leftLeaf = workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST)[0];
		const stickyLeaf = workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES)[0];
		const foreLeaf = workspace.getLeavesOfType(VIEW_TYPES.FORESHADOWING)[0];
		const timeLeaf = workspace.getLeavesOfType(VIEW_TYPES.TIMELINE)[0];
		const refLeaf = workspace.getLeavesOfType('markdown').find(l => l.containerEl.classList.contains('immersive-reference-view'));
		const anyBottomLeaf = stickyLeaf || foreLeaf || timeLeaf;

		// 2. 保存主区域的 vertical split 比例（左/中/右）
		if (leftLeaf || refLeaf) {
			const targetLeaf = leftLeaf || refLeaf;
			const split = getParentSplit(targetLeaf);
			if (split && split.direction === 'vertical' && split.containerEl && split.children) {
				const totalWidth = split.containerEl.offsetWidth;
				if (totalWidth > 0) {
					for (let i = 0; i < split.children.length; i++) {
						const child = split.children[i];
						if (!child.containerEl) continue;
						const pct = Math.round((child.containerEl.offsetWidth / totalWidth) * 100);
						// 判断这个 child 包含哪个面板
						if (leftLeaf && child.containerEl.contains(leftLeaf.containerEl)) {
							settings.immersiveLeftSize = pct;
						} else if (refLeaf && child.containerEl.contains(refLeaf.containerEl)) {
							settings.immersiveRightSize = pct;
						}
					}
				}
			}
		}

		// 3. 保存 horizontal split 比例（主编辑区 vs 辅助面板高度）
		if (anyBottomLeaf) {
			// 从辅助面板往上找到 horizontal split
			let node: any = anyBottomLeaf.parent;
			while (node && node.direction !== 'horizontal' && node.parent) {
				node = node.parent;
			}
			if (node && node.direction === 'horizontal' && node.containerEl && node.children) {
				const totalHeight = node.containerEl.offsetHeight;
				if (totalHeight > 0) {
					for (let i = 0; i < node.children.length; i++) {
						const child = node.children[i];
						if (!child.containerEl) continue;
						if (child.containerEl.contains(anyBottomLeaf.containerEl)) {
							settings.immersiveBottomSize = Math.round((child.containerEl.offsetHeight / totalHeight) * 100);
						}
					}
				}
			}
		}

		// 4. 保存底部面板内部比例（便签/伏笔/时间线之间）
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

		console.log('[ImmersiveMode] 保存比例:', {
			left: settings.immersiveLeftSize,
			right: settings.immersiveRightSize,
			bottom: settings.immersiveBottomSize,
			bottomInternal: settings.immersiveBottomInternalSizes,
		});
	}
}
