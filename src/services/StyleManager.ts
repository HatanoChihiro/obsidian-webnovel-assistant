import type { App, EventRef, WorkspaceWindow } from 'obsidian';
import type { AccurateCountSettings } from '../types/settings';

/**
 * 样式管理服务
 * 负责动态样式注入（护眼模式等），静态样式已移至 styles.css 由 Obsidian 自动加载
 */
export class StyleManager {
	private isEyeCareActive = false;
	private windowOpenRef: EventRef | null = null;
	private windowCloseRef: EventRef | null = null;
	private trackedDocs = new Set<Document>();

	constructor(
		private app: App,
		private settings: AccurateCountSettings
	) { }

	/**
	 * 应用护眼模式
	 * 为 Markdown 编辑器添加护眼背景色，并同步到所有工作区窗口及后续打开的窗口
	 */
	applyEyeCare(): void {
		this.isEyeCareActive = true;
		const color = this.settings.eyeCareColor || '#E8F5E9';
		this.registerWindowListeners();

		for (const doc of this.collectDocuments()) {
			this.applyToDocument(doc, color);
		}
	}

	/**
	 * 移除护眼模式
	 * 从所有当前和此前记录的可用窗口文档中移除样式类与自定义变量
	 */
	removeEyeCare(): void {
		this.isEyeCareActive = false;
		this.unregisterWindowListeners();

		for (const doc of this.collectDocuments()) {
			this.removeFromDocument(doc);
		}
		this.trackedDocs.clear();
	}

	/**
	 * 更新设置引用
	 * 当设置更新时调用，确保 StyleManager 使用最新的设置
	 */
	updateSettings(settings: AccurateCountSettings): void {
		this.settings = settings;
	}

	/**
	 * 实现 Destroyable 接口，清理动态样式与监听器
	 */
	destroy(): void {
		this.removeEyeCare();
	}

	private registerWindowListeners(): void {
		if (this.windowOpenRef || !this.app.workspace?.on) {
			return;
		}
		this.windowOpenRef = this.app.workspace.on('window-open', (win: WorkspaceWindow, window: Window) => {
			if (!this.isEyeCareActive) return;
			const doc = win?.doc || window?.document;
			if (doc) {
				this.applyToDocument(doc, this.settings.eyeCareColor || '#E8F5E9');
			}
		});
		this.windowCloseRef = this.app.workspace.on('window-close', (win: WorkspaceWindow, window: Window) => {
			const doc = win?.doc || window?.document;
			if (doc) {
				this.removeFromDocument(doc);
				this.trackedDocs.delete(doc);
			}
		});
	}

	private unregisterWindowListeners(): void {
		if (this.windowOpenRef) {
			this.app.workspace.offref(this.windowOpenRef);
			this.windowOpenRef = null;
		}
		if (this.windowCloseRef) {
			this.app.workspace.offref(this.windowCloseRef);
			this.windowCloseRef = null;
		}
	}

	private collectDocuments(): Set<Document> {
		const docs = new Set<Document>(this.trackedDocs);
		const mainDoc = this.app.workspace?.containerEl?.ownerDocument || (typeof activeDocument !== 'undefined' ? activeDocument : null);
		if (mainDoc) {
			docs.add(mainDoc);
		}
		if (this.app.workspace?.iterateAllLeaves) {
			this.app.workspace.iterateAllLeaves((leaf) => {
				const doc = leaf.containerEl?.ownerDocument;
				if (doc) docs.add(doc);
			});
		}
		if (typeof activeDocument !== 'undefined' && activeDocument) {
			docs.add(activeDocument);
		}
		return docs;
	}

	private applyToDocument(doc: Document, color: string): void {
		if (!doc.body) return;
		doc.body.classList.add('webnovel-eye-care-enabled');
		doc.body.style?.setProperty('--webnovel-eye-care-color', color);
		this.trackedDocs.add(doc);
	}

	private removeFromDocument(doc: Document): void {
		if (!doc.body) return;
		doc.body.classList.remove('webnovel-eye-care-enabled');
		doc.body.style?.removeProperty('--webnovel-eye-care-color');
	}
}
