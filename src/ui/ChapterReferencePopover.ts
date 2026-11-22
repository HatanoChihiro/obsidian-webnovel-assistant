import { Component, type App } from 'obsidian';
import type { ChapterReferenceItem } from '../types/reference';
import { t } from '../i18n';
import { getForeshadowingStatusText } from '../i18n/data-keys';
import { isMobile } from '../utils/platform';
import { smartLocateAndHighlight } from '../utils/leaf';

export class ChapterReferencePopover extends Component {
	private static instances = new WeakMap<Document, ChapterReferencePopover>();
	private static nextId = 0;
	private ownerDocument: Document;
	private ownerWindow: Window;
	private element: HTMLElement | null = null;
	private showTimer: number | null = null;
	private closeTimer: number | null = null;
	private observer: MutationObserver | null = null;
	private disposed = false;

	constructor(private target: HTMLElement, private items: ChapterReferenceItem[], private app: App,
		immediate = false, private onHide?: () => void) {
		super();
		this.ownerDocument = target.ownerDocument;
		this.ownerWindow = this.ownerDocument.defaultView!;
		ChapterReferencePopover.instances.get(this.ownerDocument)?.hide();
		ChapterReferencePopover.instances.set(this.ownerDocument, this);
		this.load();
		this.registerDomEvent(target, 'mouseleave', () => this.scheduleClose());
		this.registerDomEvent(target, 'mouseenter', () => this.cancelClose());
		this.registerDomEvent(this.ownerDocument, 'click', event => {
			if (!this.element?.contains(event.target as Node) && !this.target.contains(event.target as Node)) this.hide();
		});
		this.registerDomEvent(this.ownerDocument, 'keydown', event => { if (event.key === 'Escape') this.hide(); });
		this.registerDomEvent(this.ownerWindow, 'resize', () => this.position());
		this.registerDomEvent(this.ownerWindow, 'scroll', () => this.position(), true);
		const Observer = this.ownerDocument.defaultView!.MutationObserver;
		this.observer = new Observer(() => { if (!target.isConnected) this.hide(); });
		for (let parent = target.parentNode; parent; parent = parent.parentNode) this.observer.observe(parent, { childList: true });
		if (immediate || isMobile()) this.show();
		else this.showTimer = this.ownerWindow.setTimeout(() => {
			this.showTimer = null;
			if (target.matches(':hover')) this.show(); else this.hide();
		}, 1000); // 与设定悬浮卡片保持相同的等待时间，避免快速划过时误触
	}
	private cancelClose(): void {
		if (this.closeTimer !== null) this.ownerWindow.clearTimeout(this.closeTimer);
		this.closeTimer = null;
	}
	private scheduleClose(): void {
		if (this.showTimer !== null) { this.hide(); return; }
		this.cancelClose();
		this.closeTimer = this.ownerWindow.setTimeout(() => this.hide(), 200);
	}
	private show(): void {
		if (this.disposed || !this.target.isConnected || this.element) return;
		const element = this.ownerDocument.body.createDiv({ cls: 'wn-reference-popover' });
		element.remove();
		element.setAttribute('role', 'dialog');
		const title = element.createDiv({ cls: 'wn-reference-popover-title', text: t('reference.popover-aria-label') });
		title.id = 'wn-reference-title-' + ChapterReferencePopover.nextId++;
		element.setAttribute('aria-labelledby', title.id);
		this.element = element;
		this.registerDomEvent(element, 'mouseenter', () => this.cancelClose());
		this.registerDomEvent(element, 'mouseleave', () => this.scheduleClose());
		const list = element.createDiv({ cls: 'wn-reference-popover-list' });
		for (const item of this.items) {
			const card = list.createDiv({ cls: 'wn-reference-popover-item is-' + item.type });
			const header = card.createDiv({ cls: 'wn-reference-item-header' });
			header.createSpan({ cls: 'wn-reference-tag', text: t(item.type === 'timeline' ? 'reference.timeline-category' : 'reference.foreshadowing-category') });
			if (item.time) header.createSpan({ cls: 'wn-reference-time', text: item.time });
			if (item.type === 'timeline' && item.eventType) header.createSpan({ cls: 'wn-reference-type', text: item.eventType });
			if (item.type === 'foreshadowing') {
				header.createSpan({ cls: 'wn-reference-kind', text: t(item.kind === 'creation' ? 'reference.planted-quote' : 'reference.recovered-quote') });
				header.createSpan({ cls: 'wn-reference-status', text: getForeshadowingStatusText(item.status) });
			}
			if (item.description) card.createDiv({ cls: 'wn-reference-desc', text: item.description });
			if (item.type === 'foreshadowing' && item.note) card.createDiv({ cls: 'wn-reference-note', text: item.note });
			const button = card.createDiv({ cls: 'wn-reference-item-actions' }).createEl('button', {
				cls: 'wn-reference-action-link mod-cta', type: 'button',
				text: t(item.type === 'timeline' ? 'reference.view-timeline-record' : 'reference.view-foreshadowing-record')
			});
			this.registerDomEvent(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				void smartLocateAndHighlight(this.app, item.sourceFile,
					[item.recordText, item.description || item.quote, item.time], { splitIfNew: true })
					.catch(error => console.error('[ChapterReferencePopover] Could not locate reference:', error));
				this.hide();
			});
		}
		this.ownerDocument.body.appendChild(element);
		this.position();
	}
	private position(): void {
		if (!this.target.isConnected) { this.hide(); return; }
		if (!this.element) return;
		const target = this.target.getBoundingClientRect();
		const rect = this.element.getBoundingClientRect();
		const width = this.ownerWindow.innerWidth;
		const height = this.ownerWindow.innerHeight;
		const below = height - target.bottom - 16;
		const above = target.top - 16;
		const placeAbove = below < Math.min(rect.height, 360) && above > below;
		const maxHeight = Math.max(40, Math.min(360, placeAbove ? above : below));
		const top = placeAbove ? Math.max(8, target.top - Math.min(rect.height, maxHeight) - 8) : Math.max(8, target.bottom + 8);
		this.element.setCssStyles({
			top: top + 'px', left: Math.max(8, Math.min(target.left, width - rect.width - 8)) + 'px', maxHeight: maxHeight + 'px'
		});
	}
	public hide(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (ChapterReferencePopover.instances.get(this.ownerDocument) === this) ChapterReferencePopover.instances.delete(this.ownerDocument);
		if (this.showTimer !== null) this.ownerWindow.clearTimeout(this.showTimer);
		this.cancelClose();
		this.observer?.disconnect();
		this.element?.remove();
		this.element = null;
		this.unload();
		this.onHide?.();
		this.onHide = undefined;
	}
	onunload(): void { this.hide(); }
}
