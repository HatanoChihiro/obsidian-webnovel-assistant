/**
 * Obsidian API 的最小 Mock
 * 仅提供测试所需的类型桩，避免测试依赖完整的 Obsidian 运行环境
 */

const mockWindow = {
	setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
	clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
};

Object.assign(globalThis, { window: mockWindow });

export class TAbstractFile {
	name: string = '';
	path: string = '';
	vault: any = {};
	parent: TFolder | null = null;

	constructor(name: string = '', path: string = '') {
		this.name = name;
		this.path = path;
	}
}

export class TFile extends TAbstractFile {
	extension: string = 'md';
	basename: string = '';
	stat: any = {};

	constructor(name: string = '', path: string = '') {
		super(name, path);
		this.basename = name ? name.replace(/\.[^/.]+$/, '') : '';
		this.extension = name && name.includes('.') ? name.split('.').pop() || 'md' : 'md';
	}
}

export class TFolder extends TAbstractFile {
	children: (TFile | TFolder)[] = [];

	constructor(name: string = '', path: string = '') {
		super(name, path);
	}

	isRoot(): boolean {
		return this.path === '/' || this.path === '';
	}
}

export class Vault {
	static recurseChildren(folder: TFolder, fn: (file: any) => void): void {
		if (!folder || !folder.children) return;
		for (const child of folder.children) {
			fn(child);
			if (child instanceof TFolder) {
				Vault.recurseChildren(child, fn);
			}
		}
	}
}

export class Platform {
	static isMobile = false;
}

export class Component {}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
	hide(): void {}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

if (typeof Element !== 'undefined') {
	const proto = Element.prototype as any;
	if (!proto.addClass) {
		proto.addClass = function (...classes: string[]) {
			this.classList.add(...classes);
			return this;
		};
	}
	if (!proto.removeClass) {
		proto.removeClass = function (...classes: string[]) {
			this.classList.remove(...classes);
			return this;
		};
	}
	if (!proto.empty) {
		proto.empty = function () {
			this.innerHTML = '';
		};
	}
	if (!proto.createDiv) {
		proto.createDiv = function (o?: any) {
			const div = document.createElement('div');
			if (o?.cls) div.className = o.cls;
			if (o?.text) div.textContent = o.text;
			this.appendChild(div);
			return div;
		};
	}
	if (!proto.createSpan) {
		proto.createSpan = function (o?: any) {
			const span = document.createElement('span');
			if (o?.cls) span.className = o.cls;
			if (o?.text) span.textContent = o.text;
			this.appendChild(span);
			return span;
		};
	}
	if (!proto.createEl) {
		proto.createEl = function (tag: string, o?: any) {
			const el = document.createElement(tag);
			if (o?.cls) el.className = o.cls;
			if (o?.text) el.textContent = o.text;
			if (o?.type) (el as HTMLInputElement).type = o.type;
			this.appendChild(el);
			return el;
		};
	}
}

export class Modal {
	app: any;
	modalEl: any;
	contentEl: any;

	constructor(app: any) {
		this.app = app;
		const createMockEl = () => ({
			empty: () => {},
			addClass: function() { return this; },
			removeClass: function() { return this; },
			setAttribute: () => {},
			style: { setProperty: () => {} },
			setText: () => {},
			createDiv: function(o?: any) { return createMockEl(); },
			createSpan: function(o?: any) { return createMockEl(); },
			createEl: function(tag?: string, o?: any) { return createMockEl(); },
			appendChild: () => {}
		});
		this.modalEl = typeof document !== 'undefined' ? document.createElement('div') : createMockEl();
		this.contentEl = typeof document !== 'undefined' ? document.createElement('div') : createMockEl();
	}
	open() {
		if (typeof (this as any).onOpen === 'function') {
			(this as any).onOpen();
		}
	}
	close() {
		if (typeof (this as any).onClose === 'function') {
			(this as any).onClose();
		}
	}
}

export class Setting {
	constructor(containerEl: any) {}
	setHeading() { return this; }
	setName(name: any) { return this; }
	setDesc(desc: any) { return this; }
	addToggle(cb: any) { return this; }
	addButton(cb: any) { return this; }
	addExtraButton(cb: any) { return this; }
}

export function setIcon(el: any, iconId: string) {}

export class MarkdownView {
	file?: any;
	editor?: any;
	containerEl?: any;
	getMode?(): string {
		return 'source';
	}
}

export class WorkspaceLeaf {
	view?: any;
	parent?: any;
	openFile(file: any, options?: any): Promise<void> {
		return Promise.resolve();
	}
	getViewState(): any {
		return {};
	}
}

export async function requestUrl(_params: unknown): Promise<{
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	text: string;
	json: unknown;
}> {
	return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), text: '', json: {} };
}
