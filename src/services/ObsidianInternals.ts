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

interface CapacitorStatusBarInternal {
	hide?: () => Promise<void> | void;
	show?: (options?: { animation?: string }) => Promise<void> | void;
}

interface CapacitorRuntimeInternal {
	isNativePlatform?: () => boolean;
	getPlatform?: () => string;
	Plugins?: {
		StatusBar?: CapacitorStatusBarInternal;
	};
}

interface MobileNavbarInternal {
	onScroll?: (...args: unknown[]) => unknown;
	hideNavigation?: (...args: unknown[]) => unknown;
	restoreNavigation?: (...args: unknown[]) => unknown;
}

export interface MobileFullscreenHandle {
	readonly isNativeFullscreen: boolean;
	release: () => void;
}

/**
 * 复用 Obsidian 移动端阅读全屏的 Capacitor StatusBar 桥接能力：
 * - 在沉浸会话期间隐藏系统顶部状态栏，并添加 `wn-immersive-mobile-fullscreen`
 * - 暂时抑制 `app.mobileNavbar` 的滚动/点击自动恢复，防止点击屏幕或切章时将系统状态栏弹回
 * - 切回前台或收起软键盘后重新确认隐藏，退出沉浸时恢复方法与状态栏
 */
export function enterMobileNativeFullscreen(app: unknown, ownerDocument: Document): MobileFullscreenHandle {
	const ownerWindow = ownerDocument.defaultView;
	const cap = (ownerWindow as unknown as { Capacitor?: CapacitorRuntimeInternal } | null)?.Capacitor;
	const isNativePlatform = cap
		? (typeof cap.getPlatform === 'function'
			? cap.getPlatform() !== 'web'
			: (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : Boolean(cap.Plugins?.StatusBar)))
		: false;
	const statusBar = isNativePlatform ? cap?.Plugins?.StatusBar : undefined;
	if (typeof statusBar?.hide !== 'function' || typeof statusBar.show !== 'function') {
		return { isNativeFullscreen: false, release: () => {} };
	}

	const mobileNavbar = (app && typeof app === 'object')
		? (app as { mobileNavbar?: MobileNavbarInternal | null }).mobileNavbar ?? null
		: null;

	const savedNavbarProps: Array<{
		key: keyof MobileNavbarInternal;
		hadOwn: boolean;
		value: MobileNavbarInternal[keyof MobileNavbarInternal];
		noop: (...args: unknown[]) => void;
	}> = [];

	if (mobileNavbar && typeof mobileNavbar === 'object') {
		for (const key of ['onScroll', 'hideNavigation', 'restoreNavigation'] as const) {
			const hadOwn = Object.prototype.hasOwnProperty.call(mobileNavbar, key);
			const value = mobileNavbar[key];
			const noop = () => { /* suppressed while mobile immersive session is active */ };
			try {
				mobileNavbar[key] = noop;
				savedNavbarProps.push({ key, hadOwn, value, noop });
			} catch {
				/* ignored if non-writable */
			}
		}
	}

	// 移除原生滚动隐藏标记，避免全局 mousedown / active-leaf-change 触发 StatusBar.show()
	ownerDocument.body?.classList?.remove('is-hidden-nav');

	const hideStatusBarSafely = () => {
		if (!statusBar.hide) return;
		try {
			void Promise.resolve(statusBar.hide()).catch(() => {});
		} catch {
			/* ignored */
		}
	};

	ownerDocument.body?.classList?.add('wn-immersive-mobile-fullscreen');
	hideStatusBarSafely();

	let released = false;
	const onVisibilityChange = () => {
		if (released) return;
		if (ownerDocument.visibilityState === 'visible') {
			ownerDocument.body?.classList?.remove('is-hidden-nav');
			hideStatusBarSafely();
		}
	};
	const onKeyboardHide = () => {
		if (released) return;
		ownerDocument.body?.classList?.remove('is-hidden-nav');
		hideStatusBarSafely();
	};

	ownerDocument.addEventListener?.('visibilitychange', onVisibilityChange);
	ownerWindow?.addEventListener?.('keyboardWillHide', onKeyboardHide);

	return {
		isNativeFullscreen: true,
		release: () => {
			if (released) return;
			released = true;
			ownerDocument.removeEventListener?.('visibilitychange', onVisibilityChange);
			ownerWindow?.removeEventListener?.('keyboardWillHide', onKeyboardHide);
			ownerDocument.body?.classList?.remove('wn-immersive-mobile-fullscreen');
			ownerDocument.body?.classList?.remove('is-hidden-nav');
			if (mobileNavbar && typeof mobileNavbar === 'object') {
				for (const item of savedNavbarProps) {
					try {
						if (mobileNavbar[item.key] === item.noop) {
							if (item.hadOwn) {
								mobileNavbar[item.key] = item.value;
							} else {
								delete mobileNavbar[item.key];
							}
						}
					} catch {
						/* ignored */
					}
				}
			}
			if (typeof statusBar.show === 'function') {
				try {
					void Promise.resolve(statusBar.show({ animation: 'FADE' })).catch(() => {});
				} catch {
					/* ignored */
				}
			}
		}
	};
}
