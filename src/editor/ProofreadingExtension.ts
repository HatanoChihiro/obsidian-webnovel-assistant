import { MarkdownView, editorInfoField, type App, type WorkspaceLeaf, type TFile } from 'obsidian';
import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, Decoration, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ProofreadingDiagnostic } from '../types/proofreading';
import { ProofreadingPopover } from '../ui/ProofreadingPopover';
import { expandAndMergeRanges, computeDiagnosticContextFingerprint } from '../utils/proofreadingHelpers';

export interface DismissProofreadingInstancePayload {
	from: number;
	to: number;
	ruleId: string;
	original: string;
}

export const forceProofreadingUpdate = StateEffect.define<null>();
export const dismissProofreadingInstance = StateEffect.define<DismissProofreadingInstancePayload>();

const touchStateMap = new WeakMap<EditorView, { startX: number; startY: number }>();

/**
 * 构造正文实时校对高亮与交互的 CodeMirror 6 扩展
 */
export function buildProofreadingExtension(app: App, plugin: WebNovelAssistantPlugin): Extension {
	const proofreadingViewPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		private activeDiagnostics = new Map<string, ProofreadingDiagnostic>();
		private activePopover: ProofreadingPopover | null = null;
		private unsubscribeRefresh: (() => void) | null = null;
		private dismissedRanges: Array<{
			from: number;
			to: number;
			ruleId: string;
			original: string;
		}> = [];

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);

			if (plugin.proofreadingManager) {
				this.unsubscribeRefresh = plugin.proofreadingManager.onRefresh(() => {
					// 仅通过 CodeMirror StateEffect 事务通知视图安全更新，禁止外部直接重赋 decorations
					view.dispatch({ effects: forceProofreadingUpdate.of(null) });
				});
			}
		}

		public dismissRange(from: number, to: number, ruleId: string, original: string): void {
			if (!this.dismissedRanges.some(r => r.from === from && r.to === to && r.ruleId === ruleId)) {
				this.dismissedRanges.push({ from, to, ruleId, original });
			}
		}

		update(update: ViewUpdate) {
			let hasDismissEffect = false;
			for (const tr of update.transactions) {
				for (const effect of tr.effects) {
					if (effect.is(dismissProofreadingInstance)) {
						this.dismissRange(effect.value.from, effect.value.to, effect.value.ruleId, effect.value.original);
						hasDismissEffect = true;
					}
				}
			}

			if (update.docChanged) {
				for (let i = this.dismissedRanges.length - 1; i >= 0; i--) {
					const r = this.dismissedRanges[i];
					const newFrom = update.changes.mapPos(r.from, 1);
					const newTo = update.changes.mapPos(r.to, -1);
					if (newFrom >= newTo || newTo > update.view.state.doc.length) {
						this.dismissedRanges.splice(i, 1);
						continue;
					}
					const currentText = update.view.state.doc.sliceString(newFrom, newTo);
					if (currentText !== r.original) {
						this.dismissedRanges.splice(i, 1);
						continue;
					}
					r.from = newFrom;
					r.to = newTo;
				}
			}

			const hasForceEffect = update.transactions.some(tr =>
				tr.effects.some(e => e.is(forceProofreadingUpdate))
			);

			if (update.docChanged || update.viewportChanged || hasForceEffect || hasDismissEffect) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		destroy() {
			if (this.activePopover) {
				this.activePopover.hide();
				this.activePopover = null;
			}
			if (this.unsubscribeRefresh) {
				this.unsubscribeRefresh();
				this.unsubscribeRefresh = null;
			}
			this.activeDiagnostics.clear();
			this.dismissedRanges = [];
		}

		private getFile(view: EditorView): TFile | null {
			try {
				const file = view.state.field(editorInfoField, false)?.file;
				if (file) return file;
			} catch {
				// Fallback
			}

			let foundFile: TFile | null = null;
			app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
				const v = leaf.view;
				if (v instanceof MarkdownView && v.editor) {
					const cmEditor = v.editor as unknown as { cm: EditorView };
					if (cmEditor.cm === view) {
						foundFile = v.file;
					}
				}
			});
			return foundFile;
		}

		buildDecorations(view: EditorView): DecorationSet {
			this.activeDiagnostics.clear();

			if (!plugin.settings.proofreading?.enabled || !plugin.proofreadingManager) {
				return Decoration.none;
			}

			const activeFile = this.getFile(view);
			if (!activeFile) {
				return Decoration.none;
			}

			// 默认覆盖整个工作区；开启全局后覆盖整个笔记库。词典目录始终排除。
			if (!plugin.settings.proofreading?.enableGlobal) {
				if (typeof plugin.isFileInWorkspace === 'function' && !plugin.isFileInWorkspace(activeFile)) {
					return Decoration.none;
				}
			}
			if (plugin.proofreadingManager.isFileInsideDictionary(activeFile)) {
				return Decoration.none;
			}

			const docLen = view.state.doc.length;
			if (docLen === 0) {
				return Decoration.none;
			}

			const maxLen = plugin.proofreadingManager.getMaxPatternLength();
			const mergedRanges = expandAndMergeRanges(view.visibleRanges, maxLen, docLen);

			const builder = [];
			const seenKeys = new Set<string>();

			for (const range of mergedRanges) {
				const text = view.state.doc.sliceString(range.from, range.to);
				if (!text) continue;

				// 仅扫描扩展后的视口片段
				const diagnostics = plugin.proofreadingManager.scan(text, activeFile);

				for (const diag of diagnostics) {
					const docFrom = range.from + diag.from;
					const docTo = range.from + diag.to;

					// 确保落在实际视口范围内
					const isInVisible = view.visibleRanges.some(vr => docFrom < vr.to && docTo > vr.from);
					if (!isInVisible) continue;

					// 1. 优先检查当前会话中的局部映射忽略区间（实时打字/移动抗漂移）
					const isLocallyDismissed = this.dismissedRanges.some(
						r => r.from === docFrom && r.to === docTo && r.ruleId === diag.ruleId && r.original === diag.original
					);
					if (isLocallyDismissed) {
						continue;
					}

					// 2. 检查全局忽略词汇与上下文指纹
					const safeFrom = Math.max(0, Math.min(docFrom, docLen));
					const safeTo = Math.max(safeFrom, Math.min(docTo, docLen));
					const prefix = view.state.doc.sliceString(Math.max(0, safeFrom - 12), safeFrom);
					const suffix = view.state.doc.sliceString(safeTo, Math.min(docLen, safeTo + 12));
					const fingerprint = computeDiagnosticContextFingerprint(view.state.doc, docFrom, docTo, diag.ruleId, diag.original);

					if (plugin.proofreadingManager.isIgnored(diag, fingerprint, {
						ruleId: diag.ruleId,
						prefix,
						suffix
					})) {
						this.dismissRange(docFrom, docTo, diag.ruleId, diag.original);
						continue;
					}

					const diagId = `${docFrom}:${docTo}:${diag.ruleId}`;
					if (seenKeys.has(diagId)) continue;
					seenKeys.add(diagId);

					// 在内存映射中保存真实的诊断对象完整数据，避免 DOM 属性序列化丢失或损坏
					this.activeDiagnostics.set(diagId, {
						...diag,
						from: docFrom,
						to: docTo
					});

					let cls = 'wn-proofreading-wrong';
					if (diag.type === 'sensitive') cls = 'wn-proofreading-sensitive';
					else if (diag.type === 'synonym') cls = 'wn-proofreading-synonym';
					else if (diag.type === 'grammar') cls = 'wn-proofreading-grammar';
					else if (diag.type === 'punctuation') cls = 'wn-proofreading-punctuation';

					builder.push(Decoration.mark({
						class: `wn-proofreading-match ${cls}`,
						attributes: {
							'data-proofread-id': diagId
						}
					}).range(docFrom, docTo));
				}
			}

			return Decoration.set(builder.sort((a, b) => a.from - b.from));
		}

		public triggerPopover(target: HTMLElement, view: EditorView, immediate: boolean): void {
			const diagId = target.getAttribute('data-proofread-id');
			if (!diagId) return;

			const diag = this.activeDiagnostics.get(diagId);
			if (!diag) return;

			if (this.activePopover) {
				this.activePopover.hide();
				this.activePopover = null;
			}

			this.activePopover = new ProofreadingPopover(
				target,
				diag,
				view,
				plugin,
				immediate,
				() => {
					this.activePopover = null;
				}
			);
		}
	}, {
		decorations: v => v.decorations,
		eventHandlers: {
			mouseover(e: MouseEvent, view: EditorView) {
				const target = (e.target as HTMLElement)?.closest('.wn-proofreading-match') as HTMLElement;
				if (target) {
					const pluginInstance = view.plugin(proofreadingViewPlugin);
					pluginInstance?.triggerPopover(target, view, false);
				}
			},
			click(e: MouseEvent, view: EditorView) {
				const target = (e.target as HTMLElement)?.closest('.wn-proofreading-match') as HTMLElement;
				if (target) {
					const pluginInstance = view.plugin(proofreadingViewPlugin);
					pluginInstance?.triggerPopover(target, view, true);
				}
			},
			touchstart(e: TouchEvent, view: EditorView) {
				if (e.touches.length > 0) {
					touchStateMap.set(view, {
						startX: e.touches[0].clientX,
						startY: e.touches[0].clientY
					});
				}
			},
			touchend(e: TouchEvent, view: EditorView) {
				const state = touchStateMap.get(view);
				if (!state) return;

				const { startX, startY } = state;
				touchStateMap.delete(view);

				if (e.changedTouches.length > 0) {
					const dx = e.changedTouches[0].clientX - startX;
					const dy = e.changedTouches[0].clientY - startY;
					if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
						const target = (e.target as HTMLElement)?.closest('.wn-proofreading-match') as HTMLElement;
						if (target) {
							const pluginInstance = view.plugin(proofreadingViewPlugin);
							pluginInstance?.triggerPopover(target, view, true);
						}
					}
				}
			}
		}
	});

	return proofreadingViewPlugin;
}
