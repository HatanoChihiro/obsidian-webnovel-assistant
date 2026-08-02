/**
 * Obsidian API 的最小 Mock
 * 仅提供测试所需的类型桩，避免测试依赖完整的 Obsidian 运行环境
 */

export class TFile {
	name: string;
	path: string;
	extension: string = 'md';
	
	constructor(name: string, path: string) {
		this.name = name;
		this.path = path;
	}
}

export class TFolder {
	name: string;
	path: string;
	children: (TFile | TFolder)[] = [];
	
	constructor(name: string, path: string) {
		this.name = name;
		this.path = path;
	}
}

export class TAbstractFile {
	name: string;
	path: string;
	
	constructor(name: string, path: string) {
		this.name = name;
		this.path = path;
	}
}

export class Platform {
	static isMobile = false;
}

export class Component {}

export class Modal {
	app: any;
	contentEl: any = {
		empty: () => {},
		addClass: () => {},
		createDiv: () => ({
			createDiv: () => ({
				createDiv: () => {}
			})
		})
	};
	constructor(app: any) {
		this.app = app;
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