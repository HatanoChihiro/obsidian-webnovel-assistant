/**
 * 轻量 DOM 桩：为不依赖 jsdom 的测试提供 Element/Document 的最小实现。
 * 仅覆盖悬浮浮层类组件实际使用到的 API（createDiv/createSpan/remove/定位/事件注册）。
 */

export interface MockElementOptions {
	/** 元素是否处于已挂载状态 */
	connected?: boolean;
	/** 归属文档，缺省时由 createMockDocument 注入 */
	ownerDocument?: MockDocument;
}

export interface MockElement extends Record<string, unknown> {
	tagName: string;
	/** 元素节点类型（1 = Element），供 closest/contains 等判定使用 */
	readonly nodeType: number;
	className: string;
	textContent: string;
	title: string;
	hidden: boolean;
	children: MockElement[];
	attributes: Map<string, string>;
	style: Record<string, string> & { setProperty?: (name: string, value: string) => void };
	parentNode: MockElement | null;
	parentElement: MockElement | null;
	isConnected: boolean;
	ownerDocument: MockDocument;
	clientWidth: number;
	clientHeight: number;
	scrollWidth: number;
	scrollHeight: number;
	scrollTop: number;
	createDiv: (opts?: string | { cls?: string; text?: string }) => MockElement;
	createSpan: (opts?: string | { cls?: string; text?: string }) => MockElement;
	createEl: (tag: string, opts?: string | { cls?: string; text?: string }) => MockElement;
	appendChild: (child: MockElement) => MockElement;
	removeChild: (child: MockElement) => MockElement;
	remove: () => void;
	empty: () => void;
	setText: (text: string) => void;
	setAttr: (key: string, value: string) => void;
	setAttribute: (key: string, value: string) => void;
	getAttribute: (key: string) => string | undefined;
	addClass: (cls: string) => void;
	removeClass: (cls: string) => void;
	hasClass: (cls: string) => boolean;
	toggleClass: (cls: string, force?: boolean) => boolean;
	setCssStyles: (styles: Record<string, string>) => void;
	getBoundingClientRect: () => { top: number; left: number; right: number; bottom: number; width: number; height: number };
	querySelector: (selector: string) => MockElement | null;
	querySelectorAll: (selector: string) => MockElement[];
	closest: (selector: string) => MockElement | null;
	contains: (node: unknown) => boolean;
	focus: () => void;
	addEventListener: (type: string, listener: (event: unknown) => void) => void;
	removeEventListener: (type: string, listener: (event: unknown) => void) => void;
	dispatchEvent: (type: string, event?: unknown) => void;
}

export interface MockDocument {
	body: MockElement;
	defaultView: unknown;
	addEventListener: (type: string, listener: unknown, options?: unknown) => void;
	removeEventListener: (type: string, listener: unknown, options?: unknown) => void;
	dispatchEvent: (type: string, event?: unknown) => void;
	createDiv: (opts?: string | { cls?: string; text?: string }) => MockElement;
}

function matches(node: MockElement, selector: string): boolean {
	const trimmed = selector.trim();
	if (trimmed.startsWith('.')) {
		return node.className.split(/\s+/).includes(trimmed.slice(1));
	}
	if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed)) {
		return node.tagName.toLowerCase() === trimmed.toLowerCase();
	}
	return false;
}

function collect(root: MockElement, selector: string, out: MockElement[]): void {
	for (const child of root.children) {
		if (matches(child, selector)) out.push(child);
		collect(child, selector, out);
	}
}

/** 创建独立的 DOM 桩环境；每个测试用例应创建一份，避免状态串扰 */
export function createMockDom(): { document: MockDocument; body: MockElement } {
	const document = {} as MockDocument;

	const createElement = (tag: string, options?: MockElementOptions): MockElement => {
		const listeners = new Map<string, Set<(event: unknown) => void>>();
		const el: MockElement = {
			tagName: tag.toUpperCase(),
			nodeType: 1,
			className: '',
			textContent: '',
			title: '',
			hidden: false,
			children: [],
			attributes: new Map<string, string>(),
			style: {},
			parentNode: null,
			parentElement: null,
			isConnected: options?.connected ?? true,
			ownerDocument: options?.ownerDocument ?? document,
			clientWidth: 200,
			clientHeight: 200,
			scrollWidth: 200,
			scrollHeight: 200,
			scrollTop: 0,
			getBoundingClientRect: () => ({ top: 100, left: 100, right: 300, bottom: 300, width: 200, height: 200 })
		} as unknown as MockElement;

		const append = (child: MockElement): MockElement => {
			child.parentNode = el;
			child.parentElement = el;
			el.children.push(child);
			return child;
		};

		const createChild = (childTag: string, opts?: string | { cls?: string; text?: string }): MockElement => {
			const child = createElement(childTag, { ownerDocument: document });
			if (typeof opts === 'string') child.className = opts;
			else if (opts) {
				if (opts.cls) child.className = opts.cls;
				if (opts.text !== undefined) child.textContent = opts.text;
			}
			return append(child);
		};

		Object.assign(el, {
			createDiv: (opts?: string | { cls?: string; text?: string }) => createChild('div', opts),
			createSpan: (opts?: string | { cls?: string; text?: string }) => createChild('span', opts),
			createEl: (childTag: string, opts?: string | { cls?: string; text?: string }) => createChild(childTag, opts),
			appendChild: append,
			removeChild: (child: MockElement) => {
				const index = el.children.indexOf(child);
				if (index >= 0) el.children.splice(index, 1);
				child.parentNode = null;
				child.parentElement = null;
				return child;
			},
			remove: () => {
				const parent = el.parentNode;
				if (parent) parent.removeChild(el);
				el.isConnected = false;
			},
			empty: () => {
				el.children = [];
			},
			setText: (text: string) => {
				el.textContent = text;
			},
			setAttr: (key: string, value: string) => {
				el.attributes.set(key, value);
			},
			setAttribute: (key: string, value: string) => {
				el.attributes.set(key, value);
			},
			getAttribute: (key: string) => el.attributes.get(key),
			addClass: (cls: string) => {
				if (!el.hasClass(cls)) el.className = `${el.className} ${cls}`.trim();
			},
			removeClass: (cls: string) => {
				el.className = el.className.split(/\s+/).filter(name => name && name !== cls).join(' ');
			},
			hasClass: (cls: string) => el.className.split(/\s+/).includes(cls),
			toggleClass: (cls: string, force?: boolean) => {
				const shouldAdd = force !== undefined ? force : !el.hasClass(cls);
				if (shouldAdd) el.addClass(cls);
				else el.removeClass(cls);
				return shouldAdd;
			},
			setCssStyles: (styles: Record<string, string>) => {
				Object.assign(el.style, styles);
			},
			style: Object.assign(el.style, {
				setProperty: (name: string, value: string) => {
					el.style[name] = value;
				}
			}),
			querySelector: (selector: string) => {
				const results: MockElement[] = [];
				collect(el, selector, results);
				return results[0] ?? null;
			},
			querySelectorAll: (selector: string) => {
				const results: MockElement[] = [];
				collect(el, selector, results);
				return results;
			},
			closest: (selector: string) => {
				let node: MockElement | null = el;
				while (node) {
					if (matches(node, selector)) return node;
					node = node.parentElement;
				}
				return null;
			},
			contains: (node: unknown) => {
				if (node === el) return true;
				return el.children.some(child => child.contains(node));
			},
			focus: () => undefined,
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
				set.add(listener);
				listeners.set(type, set);
			},
			removeEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners.get(type)?.delete(listener);
			},
			dispatchEvent: (type: string, event?: unknown) => {
				for (const listener of Array.from(listeners.get(type) ?? [])) {
					listener(event ?? { type, target: el, stopPropagation: () => undefined, preventDefault: () => undefined });
				}
			}
		});

		return el;
	};

	const body = createElement('body', { ownerDocument: document });
	const documentListeners = new Map<string, Set<unknown>>();

	const defaultView = {
		innerWidth: 1200,
		innerHeight: 800,
		setTimeout: (handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number,
		clearTimeout: (id: unknown) => globalThis.clearTimeout(id as number),
		requestAnimationFrame: (cb: FrameRequestCallback) => {
			return globalThis.setTimeout(() => cb(Date.now()), 16) as unknown as number;
		},
		cancelAnimationFrame: (id: number) => globalThis.clearTimeout(id),
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	};

	Object.assign(document, {
		body,
		defaultView,
		createDiv: (opts?: string | { cls?: string; text?: string }) => body.createDiv(opts),
		addEventListener: (type: string, listener: unknown) => {
			const set = documentListeners.get(type) ?? new Set<unknown>();
			set.add(listener);
			documentListeners.set(type, set);
		},
		removeEventListener: (type: string, listener: unknown) => {
			documentListeners.get(type)?.delete(listener);
		},
		dispatchEvent: (type: string, event?: unknown) => {
			for (const listener of Array.from(documentListeners.get(type) ?? [])) {
				(listener as (evt: unknown) => void)(event ?? {
					type,
					target: body,
					stopPropagation: () => undefined,
					preventDefault: () => undefined
				});
			}
		}
	});

	return { document, body };
}

/** 将 body 中已挂载的节点视为真实连接状态（remove() 会同步更新） */
export function mountBodyChildren(body: MockElement): void {
	for (const child of body.children) child.isConnected = true;
}

/** 冲刷 Promise 微任务队列，便于断言异步渲染后的 DOM 状态 */
export async function flushMicrotasks(times = 4): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}
