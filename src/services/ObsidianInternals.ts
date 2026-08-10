import { Logger } from '../utils/Logger';

/**
 * 文件浏览器内部 API Item 节点结构
 */
export interface FileExplorerItemInternal {
	el?: HTMLElement;
	selfEl?: HTMLElement;
	titleEl?: HTMLElement;
	titleInnerEl?: HTMLElement;
	file?: { path: string; name: string };
}

/**
 * 文件浏览器视图内部结构
 */
export interface FileExplorerInternals {
	tree?: { headerEl?: HTMLElement };
	fileItems?: Record<string, FileExplorerItemInternal>;
	containerEl?: HTMLElement;
}

/**
 * 安全获取文件浏览器内部 API 引用
 * 提供运行时存在性判断，若 API 发生变化或不存在则优雅降级为 null
 *
 * @param view 目标 FileExplorer 视图对象
 * @returns 类型安全的 FileExplorerInternals，或者 null
 */
export function getFileExplorerInternals(view: unknown): FileExplorerInternals | null {
	if (!view || typeof view !== 'object') return null;
	const v = view as Record<string, unknown>;

	// 检查最关键的 fileItems 属性是否存在且为 Object
	if (!('fileItems' in v) || typeof v.fileItems !== 'object') {
		Logger.warn('[ObsidianInternals] FileExplorer fileItems API 不可用，降级跳过');
		return null;
	}

	return v;
}

/**
 * Electron BrowserWindow 接口剪裁定义（仅声明用到的方法）
 */
export interface ElectronBrowserWindowInternal {
	setAlwaysOnTop?: (flag: boolean, level?: string) => void;
	isAlwaysOnTop?: () => boolean;
	setKiosk?: (flag: boolean) => void;
}

/**
 * 安全获取当前窗口的 Electron BrowserWindow 引用
 * 兼容 Desktop (Electron) 与 Mobile (iOS/Android 降级返回 null)
 */
export function getElectronWindow(): ElectronBrowserWindowInternal | null {
	try {
		if (typeof window === 'undefined') return null;
		const win = window as unknown as { require?: (mod: string) => unknown };
		if (typeof win.require !== 'function') return null;

		const electron = win.require('electron') as {
			remote?: { getCurrentWindow?: () => ElectronBrowserWindowInternal };
			BrowserWindow?: { getFocusedWindow?: () => ElectronBrowserWindowInternal };
		};

		if (!electron) return null;
		if (electron.remote && typeof electron.remote.getCurrentWindow === 'function') {
			return electron.remote.getCurrentWindow();
		}
		if (electron.BrowserWindow && typeof electron.BrowserWindow.getFocusedWindow === 'function') {
			return electron.BrowserWindow.getFocusedWindow();
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * 锁定键盘 Escape 键，防止 HTML5 全屏被 Esc 键退出
 */
export async function lockKeyboardEscape(): Promise<void> {
	try {
		const nav = navigator as unknown as { keyboard?: { lock?: (keys?: string[]) => Promise<void> } };
		if (nav?.keyboard && typeof nav.keyboard.lock === 'function') {
			await nav.keyboard.lock(['Escape']);
		}
	} catch {
		/* ignored */
	}
}

/**
 * 解锁键盘 Escape 键
 */
export function unlockKeyboardEscape(): void {
	try {
		const nav = navigator as unknown as { keyboard?: { unlock?: () => void } };
		if (nav?.keyboard && typeof nav.keyboard.unlock === 'function') {
			nav.keyboard.unlock();
		}
	} catch {
		/* ignored */
	}
}
