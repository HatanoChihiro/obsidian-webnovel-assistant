import { showPluginNotice } from './PluginNoticeService';
import type { App } from 'obsidian';
import { MarkdownView, TFile, TFolder } from 'obsidian';
import type { NativeSnapshotService } from './NativeSnapshotService';
import type { ChapterSnapshotRef, WritingJourneyEvent } from '../types/writingJourney';
import { ChapterSnapshotPanel, type ChapterSnapshotReplayActionRequest } from '../ui/ChapterSnapshotPanel';
import { RestoreSnapshotConfirmModal } from '../ui/ChapterSnapshotRestoreModal';
import { t } from '../i18n';
import { Logger } from '../utils/Logger';

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

class ReplayActionCancelledError extends Error {
	constructor() {
		super('Replay action cancelled');
	}
}

class ReplayActionError extends Error {
	constructor(message: string) {
		super(message);
	}
}

function formatLocalTimestamp(ts: number, timeSeparator: ':' | '-'): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${timeSeparator}${pad(d.getMinutes())}${timeSeparator}${pad(d.getSeconds())}`;
}

function getChapterBasename(chapterPath: string): string {
	const fileName = chapterPath.split('/').pop() ?? '';
	return fileName.replace(/\.md$/i, '');
}

function getParentDir(filePath: string): string {
	const idx = filePath.lastIndexOf('/');
	return idx > 0 ? filePath.slice(0, idx) : '';
}

export class ChapterSnapshotManager {
	private app: App;
	private nativeSnapshotService: NativeSnapshotService;

	/** 每个所属窗口（ownerDocument）唯一持有一个对比浮窗 */
	private panels = new Map<Document, ChapterSnapshotPanel>();
	private pendingMutations = new Set<Promise<void>>();
	private isDestroyed = false;

	constructor(app: App, nativeSnapshotService: NativeSnapshotService) {
		this.app = app;
		this.nativeSnapshotService = nativeSnapshotService;
	}

	public async destroy(): Promise<void> {
		this.isDestroyed = true;
		const allPanels = Array.from(this.panels.values());
		this.panels.clear();
		for (const panel of allPanels) {
			panel.destroy();
		}
		if (this.pendingMutations.size > 0) {
			await Promise.allSettled(Array.from(this.pendingMutations));
			this.pendingMutations.clear();
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
			},
			onExportReplaySnapshot: (request) => this.exportReplaySnapshot(request),
			onRestoreReplaySnapshot: (request) => this.restoreReplaySnapshot(request)
		});

		this.panels.set(ownerDoc, panel);
		await panel.readyPromise;
	}

	private trackMutation(task: () => Promise<void>): Promise<void> {
		const op = (async () => {
			try {
				await task();
			} catch (err) {
				if (err instanceof ReplayActionCancelledError) {
					return;
				}
				if (err instanceof ReplayActionError) {
					showPluginNotice(err.message);
					return;
				}
				Logger.error('[ChapterSnapshotManager] Replay snapshot action failed:', err);
				throw err;
			}
		})();
		const tracked = op.catch(() => undefined);
		this.pendingMutations.add(tracked);
		return op.finally(() => {
			this.pendingMutations.delete(tracked);
		});
	}

	private assertScopeValid(scope: { readonly deviceId: string; readonly dbName: string }): void {
		const status = this.nativeSnapshotService.checkStatus();
		if (
			status.status !== 'available' ||
			status.deviceId !== scope.deviceId ||
			status.dbName !== scope.dbName
		) {
			throw new ReplayActionError(t('snapshot.replay-action-scope-changed'));
		}
	}

	private assertRequestActive(request: ChapterSnapshotReplayActionRequest): void {
		if (this.isDestroyed || !request.isValid()) {
			throw new ReplayActionCancelledError();
		}
	}

	private async readValidatedReplaySnapshot(request: ChapterSnapshotReplayActionRequest): Promise<string> {
		this.assertRequestActive(request);
		this.assertScopeValid(request.scope);

		let content: string;
		if (request.snapshotRef && (
			request.snapshotRef.key !== request.meta.key ||
			request.snapshotRef.path !== request.meta.path ||
			request.snapshotRef.ts !== request.meta.ts ||
			request.snapshotRef.deviceId !== request.scope.deviceId ||
			request.snapshotRef.dbName !== request.scope.dbName
		)) {
			throw new ReplayActionError(t('snapshot.missing-ref'));
		}
		if (
			request.snapshotRef &&
			request.snapshotRef.key === request.meta.key &&
			request.snapshotRef.deviceId === request.scope.deviceId &&
			request.snapshotRef.dbName === request.scope.dbName
		) {
			content = await this.nativeSnapshotService.readSnapshot(request.snapshotRef);
		} else {
			content = await this.nativeSnapshotService.readSnapshotByKey(
				request.meta.key,
				request.meta.path,
				request.meta.ts
			);
		}

		this.assertRequestActive(request);
		this.assertScopeValid(request.scope);
		return content;
	}

	private getOpenMarkdownViewsForFile(file: TFile): MarkdownView[] {
		return this.app.workspace.getLeavesOfType('markdown')
			.map(leaf => leaf.view)
			.filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file);
	}

	private getViewText(view: MarkdownView): string {
		return view.editor?.getValue() ?? view.getViewData();
	}

	private assertFolderExists(dirPath: string, errorKey: string): void {
		if (!dirPath) return;
		const folder = this.app.vault.getAbstractFileByPath(dirPath);
		if (!(folder instanceof TFolder)) {
			throw new ReplayActionError(t(errorKey, { folder: dirPath }));
		}
	}

	private resolveCollisionFreeExportPath(exportDir: string, baseName: string): string {
		const prefix = exportDir ? `${exportDir}/` : '';
		const firstCandidate = `${prefix}${baseName}.md`;
		if (this.app.vault.getAbstractFileByPath(firstCandidate) === null) {
			return firstCandidate;
		}
		let index = 1;
		while (true) {
			const candidate = `${prefix}${baseName} (${index}).md`;
			if (this.app.vault.getAbstractFileByPath(candidate) === null) {
				return candidate;
			}
			index++;
		}
	}

	public async exportReplaySnapshot(request: ChapterSnapshotReplayActionRequest): Promise<void> {
		await this.trackMutation(async () => {
			try {
				this.assertRequestActive(request);
				this.assertFolderExists(request.exportDir, 'snapshot.replay-export-folder-missing');

				const snapshotText = await this.readValidatedReplaySnapshot(request);
				this.assertFolderExists(request.exportDir, 'snapshot.replay-export-folder-missing');

				const tsPart = formatLocalTimestamp(request.meta.ts, '-');
				const basename = getChapterBasename(request.targetPath || request.meta.path);
				const baseName = basename ? `${tsPart} ${basename}` : tsPart;
				const exportPath = this.resolveCollisionFreeExportPath(request.exportDir, baseName);

				await this.app.vault.create(exportPath, snapshotText);
				showPluginNotice(t('snapshot.replay-export-success', { path: exportPath }));
			} catch (err) {
				if (err instanceof ReplayActionCancelledError || err instanceof ReplayActionError) {
					throw err;
				}
				Logger.error('[ChapterSnapshotManager] Failed to export replay snapshot:', err);
				throw new ReplayActionError(t('snapshot.replay-export-failed'));
			}
		});
	}

	private validateRestorePreconditions(request: ChapterSnapshotReplayActionRequest): void {
		this.assertRequestActive(request);
		this.assertScopeValid(request.scope);

		if (request.targetFile) {
			const current = this.app.vault.getAbstractFileByPath(request.targetPath);
			if (current !== request.targetFile || request.targetFile.path !== request.targetPath) {
				throw new ReplayActionError(t('snapshot.replay-restore-target-changed'));
			}
			const views = this.getOpenMarkdownViewsForFile(request.targetFile);
			const buffers = views.map(v => this.getViewText(v));
			if (buffers.some(val => val !== buffers[0])) {
				throw new ReplayActionError(t('snapshot.replay-restore-conflicting-editors'));
			}
			return;
		}

		if (request.isLostIdentityAmbiguous || !request.targetPath) {
			throw new ReplayActionError(t('snapshot.replay-restore-ambiguous'));
		}
		if (this.app.vault.getAbstractFileByPath(request.targetPath) !== null) {
			throw new ReplayActionError(t('snapshot.replay-restore-occupied', { path: request.targetPath }));
		}
		this.assertFolderExists(getParentDir(request.targetPath), 'snapshot.replay-restore-folder-missing');
	}

	private promptRestoreConfirmation(request: ChapterSnapshotReplayActionRequest): Promise<boolean> {
		const timeLabel = formatLocalTimestamp(request.meta.ts, ':');
		const isRecreate = request.targetFile === null;
		return new Promise<boolean>((resolve) => {
			const modal = new RestoreSnapshotConfirmModal(
				this.app,
				request.ownerDocument,
				timeLabel,
				request.targetPath,
				isRecreate,
				(confirmed) => {
					request.onConfirmationClose?.();
					resolve(confirmed);
				}
			);
			request.onConfirmationOpen?.(() => modal.cancel());
			if (this.isDestroyed || !request.isValid()) {
				modal.cancel();
				return;
			}
			modal.open();
		});
	}

	public async restoreReplaySnapshot(request: ChapterSnapshotReplayActionRequest): Promise<void> {
		await this.trackMutation(async () => {
			try {
				this.validateRestorePreconditions(request);

				const confirmed = await this.promptRestoreConfirmation(request);
				if (!confirmed) {
					return;
				}

				this.validateRestorePreconditions(request);
				const snapshotText = await this.readValidatedReplaySnapshot(request);
				this.validateRestorePreconditions(request);

				if (request.targetFile) {
					const file = request.targetFile;
					const views = this.getOpenMarkdownViewsForFile(file);
					const buffers = views.map(v => this.getViewText(v));
					if (buffers.some(val => val !== buffers[0])) {
						throw new ReplayActionError(t('snapshot.replay-restore-conflicting-editors'));
					}
					if (views[0]) {
						await views[0].save();
						this.assertRequestActive(request);
						this.assertScopeValid(request.scope);
						if (this.app.vault.getAbstractFileByPath(request.targetPath) !== file || file.path !== request.targetPath) {
							throw new ReplayActionError(t('snapshot.replay-restore-target-changed'));
						}
						const postSaveViews = this.getOpenMarkdownViewsForFile(file);
						if (
							postSaveViews.length !== views.length ||
							postSaveViews.some((v, idx) => v !== views[idx] || this.getViewText(v) !== buffers[0])
						) {
							throw new ReplayActionError(t('snapshot.replay-restore-content-changed'));
						}
					}

					const currentText = await this.app.vault.read(file);
					this.assertRequestActive(request);
					this.assertScopeValid(request.scope);
					if (this.app.vault.getAbstractFileByPath(request.targetPath) !== file || file.path !== request.targetPath) {
						throw new ReplayActionError(t('snapshot.replay-restore-target-changed'));
					}
					if (views.length > 0 && currentText !== buffers[0]) {
						throw new ReplayActionError(t('snapshot.replay-restore-content-changed'));
					}
					const preBackupViews = this.getOpenMarkdownViewsForFile(file);
					if (preBackupViews.some(v => this.getViewText(v) !== currentText)) {
						throw new ReplayActionError(t('snapshot.replay-restore-content-changed'));
					}

					try {
						await this.nativeSnapshotService.saveSnapshot(file.path, currentText);
					} catch (backupErr) {
						Logger.error('[ChapterSnapshotManager] Failed to backup current content before restore:', backupErr);
						throw new ReplayActionError(t('snapshot.replay-restore-backup-failed'));
					}

					this.assertRequestActive(request);
					this.assertScopeValid(request.scope);
					if (this.app.vault.getAbstractFileByPath(request.targetPath) !== file || file.path !== request.targetPath) {
						throw new ReplayActionError(t('snapshot.replay-restore-target-changed'));
					}
					const postBackupViews = this.getOpenMarkdownViewsForFile(file);
					if (postBackupViews.some(v => this.getViewText(v) !== currentText)) {
						throw new ReplayActionError(t('snapshot.replay-restore-content-changed'));
					}

					await this.app.vault.process(file, (diskData) => {
						this.assertRequestActive(request);
						this.assertScopeValid(request.scope);
						if (this.app.vault.getAbstractFileByPath(request.targetPath) !== file || file.path !== request.targetPath) {
							throw new ReplayActionError(t('snapshot.replay-restore-target-changed'));
						}
						if (diskData !== currentText) {
							throw new ReplayActionError(t('snapshot.replay-restore-content-changed'));
						}
						const inProcessViews = this.getOpenMarkdownViewsForFile(file);
						if (inProcessViews.some(v => this.getViewText(v) !== currentText)) {
							throw new ReplayActionError(t('snapshot.replay-restore-content-changed'));
						}
						return snapshotText;
					});

					request.onRestored?.(file);
					showPluginNotice(t('snapshot.replay-restore-success', { path: file.path }));
					return;
				}

				// Recreate deleted original at its tracked last original path
				const restoredFile = await this.app.vault.create(request.targetPath, snapshotText);
				request.onRestored?.(restoredFile);
				showPluginNotice(t('snapshot.replay-restore-success', { path: request.targetPath }));
			} catch (err) {
				if (err instanceof ReplayActionCancelledError || err instanceof ReplayActionError) {
					throw err;
				}
				Logger.error('[ChapterSnapshotManager] Failed to restore replay snapshot:', err);
				throw new ReplayActionError(t('snapshot.replay-restore-failed'));
			}
		});
	}
}
