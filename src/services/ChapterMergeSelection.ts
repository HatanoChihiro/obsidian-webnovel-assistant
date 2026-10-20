import type { ChapterMergeItem } from './ChapterMergeManager';

/**
 * 章节合并弹窗复选管理模型 (ChapterMergeSelection)
 *
 * 负责桌面端与移动端弹窗共用的章节勾选、批量选择、Shift 区间连选及全路径判重逻辑。
 * 纯业务状态模型，不侵入 ServiceRegistry。
 */
export class ChapterMergeSelection {
	private selectedPaths: Set<string> = new Set();
	private anchorPath: string | null = null;

	constructor(items?: ChapterMergeItem[]) {
		if (items) {
			this.initialize(items);
		}
	}

	/**
	 * 初始化或重置选区（默认全部勾选，清空 Shift 锚点）
	 */
	public initialize(items: ChapterMergeItem[]): void {
		this.selectedPaths = new Set(items.map(item => item.file.path));
		this.anchorPath = null;
	}

	/**
	 * 指定文件路径是否已选中
	 */
	public isSelected(path: string): boolean {
		return this.selectedPaths.has(path);
	}

	/**
	 * 获取已选中的章节数量
	 */
	public getSelectedCount(): number {
		return this.selectedPaths.size;
	}

	/**
	 * 重置 Shift 锚点（用于搜索筛选变动或批量操作）
	 */
	public resetAnchor(): void {
		this.anchorPath = null;
	}

	/**
	 * 按原稿/源列表顺序返回已勾选的条目（绝对不按点击顺序排列）
	 */
	public getSelectedItems(items: ChapterMergeItem[]): ChapterMergeItem[] {
		return items.filter(item => this.selectedPaths.has(item.file.path));
	}

	/**
	 * 单项设置选中状态，并记录单次点击锚点
	 */
	private setSingle(path: string, checked: boolean): void {
		if (checked) {
			this.selectedPaths.add(path);
		} else {
			this.selectedPaths.delete(path);
		}
		this.anchorPath = path;
	}

	/**
	 * 处理复选框点击（支持 Shift 区间连选，闭区间，双向，以点击的新状态覆盖区间）
	 * @param path 点击的章节路径
	 * @param isShift 是否按住 Shift 键
	 * @param visibleItems 当前可见列表（桌面端为 filteredItems，移动端为全部 items）
	 * @param targetState 目标勾选状态（若未传则基于当前状态反转）
	 */
	public handleCheckboxClick(
		path: string,
		isShift: boolean,
		visibleItems: ChapterMergeItem[],
		targetState?: boolean
	): boolean {
		const newChecked = targetState !== undefined ? targetState : !this.isSelected(path);

		if (!isShift || !this.anchorPath) {
			this.setSingle(path, newChecked);
			return newChecked;
		}

		const anchorIndex = visibleItems.findIndex(item => item.file.path === this.anchorPath);
		const clickedIndex = visibleItems.findIndex(item => item.file.path === path);

		if (anchorIndex === -1 || clickedIndex === -1) {
			// 锚点不在当前可见列表中，退化为单次点击并更新锚点
			this.setSingle(path, newChecked);
			return newChecked;
		}

		const start = Math.min(anchorIndex, clickedIndex);
		const end = Math.max(anchorIndex, clickedIndex);

		for (let i = start; i <= end; i++) {
			const itemPath = visibleItems[i].file.path;
			if (newChecked) {
				this.selectedPaths.add(itemPath);
			} else {
				this.selectedPaths.delete(itemPath);
			}
		}

		// Shift 连选使用最近一次单独点击的复选框作为锚点，不更新 anchorPath
		return newChecked;
	}

	/**
	 * 批量全选指定集合（仅影响传入集合，重置锚点）
	 */
	public selectAll(items: ChapterMergeItem[]): void {
		for (const item of items) {
			this.selectedPaths.add(item.file.path);
		}
		this.anchorPath = null;
	}

	/**
	 * 批量取消指定集合（仅影响传入集合，重置锚点）
	 */
	public deselectAll(items: ChapterMergeItem[]): void {
		for (const item of items) {
			this.selectedPaths.delete(item.file.path);
		}
		this.anchorPath = null;
	}
}
