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
