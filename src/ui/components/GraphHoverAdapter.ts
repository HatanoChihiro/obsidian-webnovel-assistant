import { TFile, type App } from 'obsidian';
import { cleanLoreHeading, type CharacterManager, type LoreEntry } from '../../services/CharacterManager';
import type { GraphNode } from '../../services/RelationGraphManager';
import { isLorePopoverEnabled } from '../../utils/platform';
import { LoreHoverPopover, type LoreHoverPopoverPlugin } from '../LoreHoverPopover';
import { GraphRenderer, type GraphRenderState } from './GraphRenderer';

export type GraphHoverCharacterManager = LoreHoverPopoverPlugin['characterManager'] &
	Pick<CharacterManager, 'getCharacterFile'> &
	Partial<Pick<CharacterManager, 'getLoreEntriesInFileOrder'>>;

export interface GraphHoverAdapterOptions {
	app: App;
	canvas: HTMLCanvasElement;
	anchorParent: HTMLElement;
	state: GraphRenderState;
	characterManager: GraphHoverCharacterManager;
	getSettings: () => LoreHoverPopoverPlugin['settings'];
	getBookPath: () => string;
	isHidden?: () => boolean;
}

/**
 * 解析图谱节点对应的真实设定词条。
 * 严格校验文件与标题身份，避免同名词条回退到其他文件。
 */
export function resolveGraphNodeLoreEntry(
	node: GraphNode,
	app: App,
	characterManager: GraphHoverCharacterManager,
	bookPath: string
): LoreEntry | null {
	let targetFile: TFile | null = null;
	if (node.file instanceof TFile) {
		targetFile = node.file;
	} else if (node.sourcePath) {
		const abstractFile = app.vault.getAbstractFileByPath(node.sourcePath);
		if (abstractFile instanceof TFile) {
			targetFile = abstractFile;
		}
	}

	if (!targetFile) {
		return null;
	}

	const rawHeading = node.heading || node.id;
	const normalizedHeading = cleanLoreHeading(rawHeading);
	if (!normalizedHeading) {
		return null;
	}

	const matchesNode = (entry: LoreEntry) => entry.file?.path === targetFile.path
		&& (node.sectionKey ? entry.section?.key === node.sectionKey : cleanLoreHeading(entry.heading) === normalizedHeading);
	const orderedEntries = characterManager.getLoreEntriesInFileOrder?.(bookPath);
	if (orderedEntries) {
		const exact = orderedEntries.find(matchesNode);
		if (exact) {
			return exact;
		}
	}

	const cached = characterManager.getCharacterFile(bookPath, node.id);
	if (cached && matchesNode(cached)) {
		return cached;
	}
	if (node.sectionKey) return null;

	return {
		file: targetFile,
		heading: rawHeading
	};
}

/**
 * 将 Canvas 2D 图谱节点的桌面端悬停交互桥接到现有 LoreHoverPopover。
 * 仅在存在活动/待触发悬停时创建单个虚拟定位锚点，并在取消或销毁时立即清理。
 */
export class GraphHoverAdapter {
	private readonly options: GraphHoverAdapterOptions;
	private activeNode: GraphNode | null = null;
	private activePopover: LoreHoverPopover | null = null;
	private anchorEl: HTMLElement | null = null;
	private disposed = false;

	constructor(options: GraphHoverAdapterOptions) {
		this.options = options;
	}

	public handleNodeHover(node: GraphNode | null, _e?: MouseEvent): void {
		if (this.disposed || this.options.isHidden?.()) {
			this.cancel();
			return;
		}

		if (!node) {
			if (!this.activePopover) {
				this.activeNode = null;
				this.removeAnchor();
				return;
			}
			if (this.activePopover.isCardVisible()) {
				this.activePopover.handleTargetLeave();
			} else {
				this.cancel();
			}
			return;
		}

		if (node === this.activeNode && this.activePopover && this.activePopover.isActive()) {
			if (this.activePopover.isCardVisible()) {
				this.activePopover.cancelPendingClose();
			} else {
				this.updateAnchorPosition(node);
			}
			return;
		}

		this.cancel();

		const settings = this.options.getSettings();
		if (!isLorePopoverEnabled(settings)) {
			return;
		}

		const bookPath = this.options.getBookPath();
		const entry = resolveGraphNodeLoreEntry(node, this.options.app, this.options.characterManager, bookPath);
		if (!entry) {
			return;
		}

		const anchorEl = this.options.anchorParent.createDiv({ cls: 'wn-graph-hover-anchor' });
		this.anchorEl = anchorEl;
		this.updateAnchorPosition(node);
		this.activeNode = node;

		const popoverPlugin: LoreHoverPopoverPlugin = {
			app: this.options.app,
			settings,
			characterManager: this.options.characterManager
		};

		const popover = new LoreHoverPopover(
			anchorEl,
			entry,
			popoverPlugin,
			false,
			bookPath || undefined,
			{
				isTargetHovered: () => {
					if (
						this.disposed ||
						this.options.isHidden?.() ||
						this.activeNode !== node ||
						!isLorePopoverEnabled(this.options.getSettings())
					) {
						return false;
					}
					this.updateAnchorPosition(node);
					return true;
				},
				onDispose: () => {
					if (this.activePopover === popover) {
						this.activePopover = null;
						this.activeNode = null;
						this.removeAnchor();
					}
				}
			}
		);

		if (!popover.isActive()) {
			this.activeNode = null;
			this.removeAnchor();
			return;
		}

		this.activePopover = popover;
	}

	public handleCanvasMouseLeave(e?: MouseEvent): void {
		if (this.disposed) return;

		if (!this.activePopover) {
			this.activeNode = null;
			this.removeAnchor();
			return;
		}

		if (!this.activePopover.isCardVisible()) {
			this.cancel();
			return;
		}

		if (e?.relatedTarget && this.activePopover.containsTarget(e.relatedTarget)) {
			return;
		}

		this.activePopover.handleTargetLeave();
	}

	public cancel(): void {
		const popover = this.activePopover;
		this.activePopover = null;
		this.activeNode = null;
		if (popover) {
			popover.close();
		}
		this.removeAnchor();
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel();
	}

	private removeAnchor(): void {
		if (this.anchorEl) {
			this.anchorEl.remove();
			this.anchorEl = null;
		}
	}

	private updateAnchorPosition(node: GraphNode): void {
		if (!this.anchorEl) return;

		const canvasRect = this.options.canvas.getBoundingClientRect();
		if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

		const parentRect = typeof this.options.anchorParent.getBoundingClientRect === 'function'
			? this.options.anchorParent.getBoundingClientRect()
			: canvasRect;
		const { scale, panX, panY } = this.options.state;
		const localX = (node.x - canvasRect.width / 2) * scale + canvasRect.width / 2 + panX;
		const localY = (node.y - canvasRect.height / 2) * scale + canvasRect.height / 2 + panY;
		const size = Math.min(32, Math.max(12, GraphRenderer.NODE_HIGHLIGHT_RADIUS * 2 * scale));
		const left = (canvasRect.left - parentRect.left) + localX - size / 2;
		const top = (canvasRect.top - parentRect.top) + localY - size / 2;

		this.anchorEl.setCssStyles({
			left: `${left}px`,
			top: `${top}px`,
			width: `${size}px`,
			height: `${size}px`
		});
	}
}
