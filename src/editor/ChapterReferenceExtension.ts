import { editorInfoField, type App, type TFile } from 'obsidian';
import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, Decoration, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { ChapterReferenceItem, ReferenceCluster } from '../types/reference';
import {
	compileReferencePlan,
	matchCompiledChapterReferences,
	normalizeReferenceDocument,
	type CompiledReferencePlan,
	type NormalizedReferenceDocument
} from '../services/ChapterReferenceService';
import { ChapterReferencePopover } from '../ui/ChapterReferencePopover';
import { LoreHoverPopover } from '../ui/LoreHoverPopover';
import { isMobile, isLorePopoverEnabled } from '../utils/platform';

export const forceReferenceUpdate = StateEffect.define<null>();

export function buildChapterReferenceExtension(app: App, plugin: WebNovelAssistantPlugin): Extension {
	const referencePlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet = Decoration.none;
		private clusters: ReferenceCluster[] = [];
		private items: ChapterReferenceItem[] | null = null;
		private quotePlan: CompiledReferencePlan | null = null;
		private lastDoc: EditorView['state']['doc'] | null = null;
		private normalizedDoc: NormalizedReferenceDocument | null = null;
		private visibleKey = '';
		private file: TFile | null = null;
		private path = '';
		private request = 0;
		private pending = false;
		private destroyed = false;
		private unsubscribe: (() => void) | null = null;
		private popover: ChapterReferencePopover | null = null;
		private target: HTMLElement | null = null;
		private touch: { x: number; y: number; time: number } | null = null;
		private suppressClickUntil = 0;

		constructor(view: EditorView) {
			this.unsubscribe = plugin.chapterReferenceService.onRefresh(() => {
				if (!this.destroyed) view.dispatch({ effects: forceReferenceUpdate.of(null) });
			});
			this.render(view, true);
		}
		private getFile(view: EditorView): TFile | null {
			return view.state.field(editorInfoField, false)?.file ?? null;
		}
		update(update: ViewUpdate): void {
			const force = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(forceReferenceUpdate)));
			if (force || update.docChanged) this.closePopover();
			if (force || update.docChanged || update.viewportChanged || this.getFile(update.view)?.path !== this.path) this.render(update.view, force);
		}
		private render(view: EditorView, force = false): void {
			const file = this.getFile(view);
			if (force || file !== this.file || file?.path !== this.path) {
				this.closePopover();
				this.request++;
				this.pending = false;
				this.file = file;
				this.path = file?.path ?? '';
				this.clearMatchCaches();
			}
			if (!file || !plugin.chapterReferenceService.isAnyReferenceEnabled()) {
				this.request++;
				this.pending = false;
				this.clearMatchCaches();
				this.decorations = Decoration.none;
				this.closePopover();
				return;
			}
			const items = plugin.chapterReferenceService.getReferencesSync(file);
			if (items === null) {
				this.decorations = Decoration.none;
				this.clusters = [];
				if (!this.pending) {
					this.pending = true;
					const request = this.request;
					const path = this.path;
					void plugin.chapterReferenceService.prefetchReferences(file).then(() => {
						if (this.destroyed || request !== this.request || this.getFile(view) !== file || file.path !== path) return;
						this.pending = false;
						view.dispatch({ effects: forceReferenceUpdate.of(null) });
					}).catch(error => {
						if (!this.destroyed && request === this.request) this.pending = false;
						console.error('[ChapterReferenceExtension] Could not read references:', error);
					});
				}
				return;
			}
			const visibleKey = view.visibleRanges.map(range => range.from + ':' + range.to).join(',');
			if (items !== this.items || this.lastDoc !== view.state.doc || visibleKey !== this.visibleKey) {
				if (items !== this.items) {
					this.items = items;
					this.quotePlan = compileReferencePlan(items);
				}
				if (this.lastDoc !== view.state.doc) {
					this.lastDoc = view.state.doc;
					this.normalizedDoc = null;
				}
				this.visibleKey = visibleKey;
				if (!this.quotePlan || this.quotePlan.entries.length === 0) {
					this.clusters = [];
				} else {
					if (!this.normalizedDoc) {
						this.normalizedDoc = normalizeReferenceDocument(view.state.doc.toString());
					}
					this.clusters = matchCompiledChapterReferences(this.normalizedDoc, this.quotePlan, view.visibleRanges);
				}
			}
			const ranges = this.clusters.filter(cluster => view.visibleRanges.some(range => cluster.from < range.to && cluster.to > range.from));
			this.decorations = Decoration.set(ranges.map(cluster => {
				const kinds = new Set(cluster.items.map(item => item.type));
				const kind = kinds.size > 1 ? 'merged' : cluster.items[0].type;
				return Decoration.mark({ class: 'wn-reference-match wn-reference-' + kind,
					attributes: { 'data-reference-id': cluster.from + ':' + cluster.to } }).range(cluster.from, cluster.to);
			}));
		}
		private clearMatchCaches(): void {
			this.clusters = [];
			this.items = null;
			this.quotePlan = null;
			this.lastDoc = null;
			this.normalizedDoc = null;
			this.visibleKey = '';
		}
		private closePopover(): void { this.popover?.hide(); this.popover = null; this.target = null; }
		private resolveTarget(event: Event): HTMLElement | null {
			const target = event.target as Element | null;
			const element = typeof target?.closest === 'function' ? target : target?.parentElement;
			if (element?.closest('.wn-character-match') && isLorePopoverEnabled(plugin.settings)) {
				this.closePopover();
				return null;
			}
			return element?.closest<HTMLElement>('.wn-reference-match') ?? null;
		}
		public handleMouseOver(event: MouseEvent): void {
			const target = this.resolveTarget(event);
			if (target && !event.buttons && target.ownerDocument.getSelection()?.isCollapsed !== false) this.open(target, false);
		}
		open(target: HTMLElement, immediate: boolean): void {
			if (target === this.target && this.popover && !immediate) return;
			const id = target.getAttribute('data-reference-id');
			const cluster = this.clusters.find(item => item.from + ':' + item.to === id);
			if (!cluster || !plugin.chapterReferenceService.isAnyReferenceEnabled()) return;
			this.closePopover();
			LoreHoverPopover.closeForDocument(target.ownerDocument);
			this.popover = new ChapterReferencePopover(target, cluster.items, app, immediate, () => { this.popover = null; this.target = null; });
			this.target = target;
		}
		handleTouchStart(event: TouchEvent): void {
			const touch = event.touches[0];
			this.touch = touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
		}
		handleTouchMove(event: TouchEvent): void {
			const touch = event.touches[0];
			if (!touch || !this.touch || Math.abs(touch.clientX - this.touch.x) > 10 || Math.abs(touch.clientY - this.touch.y) > 10) this.touch = null;
		}
		public handleTouchEnd(event: TouchEvent): void {
			const state = this.touch;
			this.touch = null;
			this.suppressClickUntil = Date.now() + 500;
			const touch = event.changedTouches[0];
			const target = this.resolveTarget(event);
			if (state && touch && target && Date.now() - state.time < 450 && Math.abs(touch.clientX - state.x) < 10 && Math.abs(touch.clientY - state.y) < 10
				&& target.ownerDocument.getSelection()?.isCollapsed !== false) this.open(target, true);
		}
		cancelTouch(): void { this.touch = null; }
		public handleClick(event: MouseEvent): void {
			const target = this.resolveTarget(event);
			if (target && Date.now() >= this.suppressClickUntil && event.detail < 2 && target.ownerDocument.getSelection()?.isCollapsed !== false) this.open(target, true);
		}
		destroy(): void { this.destroyed = true; this.request++; this.touch = null; this.unsubscribe?.(); this.closePopover(); this.clearMatchCaches(); }
	}, {
		decorations: value => value.decorations,
		eventHandlers: {
			mouseover(event, view) {
				if (isMobile()) return;
				view.plugin(referencePlugin)?.handleMouseOver(event);
			},
			click(event, view) { view.plugin(referencePlugin)?.handleClick(event); },
			touchstart(event, view) { view.plugin(referencePlugin)?.handleTouchStart(event); },
			touchmove(event, view) { view.plugin(referencePlugin)?.handleTouchMove(event); },
			touchend(event, view) { view.plugin(referencePlugin)?.handleTouchEnd(event); },
			touchcancel(_event, view) { view.plugin(referencePlugin)?.cancelTouch(); }
		}
	});
	return referencePlugin;
}
