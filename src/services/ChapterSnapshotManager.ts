import type { App } from 'obsidian';
import { MarkdownView, TFile } from 'obsidian';
import type { NativeSnapshotService } from './NativeSnapshotService';
import type { ChapterSnapshotRef, WritingJourneyEvent } from '../types/writingJourney';
import { ChapterSnapshotPanel } from '../ui/ChapterSnapshotPanel';

export interface OpenSnapshotComparisonOptions {
	file?: TFile | null;
	chapterPath?: string;
	chapterTitle?: string;
	snapshotRef?: ChapterSnapshotRef;
	snapshotKey?: number;
	journeyEvent?: WritingJourneyEvent;
	ownerDocument?: Document;
	sourceEditor?: MarkdownView | null;
	allJourneyEvents?: readonly WritingJourneyEvent[];
}

export class ChapterSnapshotManager {
	private app: App;
	private nativeSnapshotService: NativeSnapshotService;

	/** 每个所属窗口（ownerDocument）唯一持有一个对比浮窗 */
	private panels = new Map<Document, ChapterSnapshotPanel>();
	private isDestroyed = false;

	constructor(app: App, nativeSnapshotService: NativeSnapshotService) {
		this.app = app;
		this.nativeSnapshotService = nativeSnapshotService;
	}

	public destroy(): void {
		this.isDestroyed = true;
		const allPanels = Array.from(this.panels.values());
		this.panels.clear();
		for (const panel of allPanels) {
			panel.destroy();
		}
	}

	public getPanel(doc: Document): ChapterSnapshotPanel | undefined {
		return this.panels.get(doc);
	}

	/**
	 * 智能解析当前命令触发时的章节与编辑器上下文（支持跨面板焦点如从侧边栏或看板触发）
	 */
	public resolveCommandContext(): { file: TFile | null; ownerDocument: Document | null; sourceEditor: MarkdownView | null } {
		// 1. 优先检查当前激活的 Markdown 编辑器
		const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeMarkdown?.file instanceof TFile) {
			const ownerDoc = activeMarkdown.containerEl?.ownerDocument
				|| this.app.workspace.containerEl?.ownerDocument
				|| null;
			return { file: activeMarkdown.file, ownerDocument: ownerDoc, sourceEditor: activeMarkdown };
		}

		// 2. 跨窗格焦点回退：检查最近活动的编辑区 Leaf
		const recentLeaf = this.app.workspace.getMostRecentLeaf?.();
		if (recentLeaf && (recentLeaf.view instanceof MarkdownView || recentLeaf.view?.getViewType() === 'markdown')) {
			const leafView = recentLeaf.view as MarkdownView;
			if (leafView.file instanceof TFile) {
				const ownerDoc = (recentLeaf as { containerEl?: HTMLElement }).containerEl?.ownerDocument
					|| leafView.containerEl?.ownerDocument
					|| this.app.workspace.containerEl?.ownerDocument
					|| null;
				return { file: leafView.file, ownerDocument: ownerDoc, sourceEditor: leafView };
			}
		}

		const defaultDoc = this.app.workspace.containerEl?.ownerDocument
			|| null;

		// 3. 回退到 workspace.getActiveFile
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile && activeFile.extension === 'md') {
			return { file: activeFile, ownerDocument: defaultDoc, sourceEditor: null };
		}

		return { file: null, ownerDocument: defaultDoc, sourceEditor: null };
	}

	/**
	 * 打开或复用当前所属窗口的章节快照对比面板
	 */
	public async openComparison(options: OpenSnapshotComparisonOptions): Promise<void> {
		if (this.isDestroyed) return;
		const defaultDoc = this.app.workspace.containerEl?.ownerDocument ?? null;

		const ownerDoc = options.ownerDocument ?? defaultDoc;
		if (!ownerDoc) {
			throw new Error('Cannot open snapshot comparison without a valid Document');
		}

		let file = options.file ?? null;
		let chapterPath = options.chapterPath ?? file?.path ?? '';
		let chapterTitle = options.chapterTitle ?? file?.basename ?? chapterPath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
		let sourceEditor = options.sourceEditor ?? null;

		if (!chapterPath && file) {
			chapterPath = file.path;
			chapterTitle = file.basename;
		}

		if (!chapterPath && !file) {
			const ctx = this.resolveCommandContext();
			file = ctx.file;
			if (file) {
				chapterPath = file.path;
				chapterTitle = file.basename;
				sourceEditor = ctx.sourceEditor;
			}
		}

		if (!chapterPath) {
			return;
		}

		// 检查该窗口是否已存在浮窗实例
		const existingPanel = this.panels.get(ownerDoc);
		if (existingPanel) {
			// 若存在，重新绑定至新章节与快照版本并激活
			await existingPanel.rebindChapter(
				file,
				chapterPath,
				chapterTitle,
				options.allJourneyEvents,
				options.snapshotRef,
				options.snapshotKey,
				options.journeyEvent,
				sourceEditor
			);
			return;
		}

		const panel = new ChapterSnapshotPanel({
			app: this.app,
			nativeSnapshotService: this.nativeSnapshotService,
			ownerDocument: ownerDoc,
			chapterFile: file,
			chapterPath,
			chapterTitle,
			initialLeftSnapshotKey: options.snapshotKey ?? options.snapshotRef?.key,
			initialSnapshotRef: options.snapshotRef,
			journeyEvent: options.journeyEvent,
			sourceEditor,
			allJourneyEvents: options.allJourneyEvents,
			onClose: () => {
				this.panels.delete(ownerDoc);
			}
		});

		this.panels.set(ownerDoc, panel);
		await panel.readyPromise;
	}
}
