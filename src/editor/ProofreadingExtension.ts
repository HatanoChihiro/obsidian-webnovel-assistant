import { MarkdownView, editorInfoField, type App, type WorkspaceLeaf, type TFile } from 'obsidian';
import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, Decoration, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ProofreadingDiagnostic } from '../types/proofreading';
import { ProofreadingPopover } from '../ui/ProofreadingPopover';
import { expandAndMergeRanges } from '../utils/proofreadingHelpers';

export const forceProofreadingUpdate = StateEffect.define<null>();

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

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);

			if (plugin.proofreadingManager) {
				this.unsubscribeRefresh = plugin.proofreadingManager.onRefresh(() => {
					// 仅通过 CodeMirror StateEffect 事务通知视图安全更新，禁止外部直接重赋 decorations
					view.dispatch({ effects: forceProofreadingUpdate.of(null) });
				});
			}
		}

		update(update: ViewUpdate) {
			const hasForceEffect = update.transactions.some(tr =>
				tr.effects.some(e => e.is(forceProofreadingUpdate))
			);

			if (update.docChanged || update.viewportChanged || hasForceEffect) {
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
