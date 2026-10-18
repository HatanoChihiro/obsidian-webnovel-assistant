import { vi } from 'vitest';

export class MockElement {
	isFragment = false;
	parentElement: MockElement | null = null;
	children: MockElement[] = [];
	className = '';
	textContent = '';
	value = '';
	type = '';
	selectionStart = 0;
	selectionEnd = 0;
	private classes = new Set<string>();
	private attributes = new Map<string, string>();
	private listeners = new Map<string, Array<(e?: unknown) => void>>();
	focus = vi.fn();
	blur = vi.fn(() => {
		this.dispatchEvent('blur');
		(this as unknown as { onblur?: () => void }).onblur?.();
	});
	select = vi.fn();
	onclick: (() => void) | null = null;
	click() { this.onclick?.(); }
	setSelectionRange = vi.fn((start: number, end: number) => {
		this.selectionStart = start;
		this.selectionEnd = end;
	});

	constructor(cls = '') {
		this.className = cls;
		if (cls) {
			cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
		}
	}

	get isConnected(): boolean {
		if (this.parentElement) return this.parentElement.isConnected;
		return true;
	}

	get firstChild(): MockElement | null {
		return this.children[0] ?? null;
	}

	get classList() {
		return {
			add: (...tokens: string[]) => {
				tokens.forEach(t => this.classes.add(t));
				this.className = Array.from(this.classes).join(' ');
			},
			remove: (...tokens: string[]) => {
				tokens.forEach(t => this.classes.delete(t));
				this.className = Array.from(this.classes).join(' ');
			},
			contains: (token: string) => this.classes.has(token),
			toggle: (token: string, force?: boolean) => {
				const has = force !== undefined ? force : !this.classes.has(token);
				if (has) this.classes.add(token); else this.classes.delete(token);
				this.className = Array.from(this.classes).join(' ');
				return has;
			}
		};
	}

	addClass(...tokens: string[]) { this.classList.add(...tokens); return this; }
	removeClass(...tokens: string[]) { this.classList.remove(...tokens); return this; }
	toggleClass(token: string, force?: boolean) { return this.classList.toggle(token, force); }
	hasClass(token: string) { return this.classes.has(token); }
	setCssProps(props?: Record<string, string>) { return this; }
	hide() { return this; }
	show() { return this; }

	contains(other: MockElement | null): boolean {
		if (!other) return false;
		let curr: MockElement | null = other;
		while (curr) {
			if (curr === this) return true;
			curr = curr.parentElement;
		}
		return false;
	}

	remove() {
		if (this.parentElement) {
			const idx = this.parentElement.children.indexOf(this);
			if (idx !== -1) {
				this.parentElement.children.splice(idx, 1);
			}
			this.parentElement = null;
		}
	}

	replaceWith(newNode: MockElement) {
		if (!this.parentElement) return;
		const parent = this.parentElement;
		const idx = parent.children.indexOf(this);
		if (idx !== -1) {
			if (newNode.parentElement) {
				const oldIdx = newNode.parentElement.children.indexOf(newNode);
				if (oldIdx !== -1) newNode.parentElement.children.splice(oldIdx, 1);
			}
			newNode.parentElement = parent;
			parent.children.splice(idx, 1, newNode);
			this.parentElement = null;
		}
	}

	replaceChild(newChild: MockElement, oldChild: MockElement) {
		const idx = this.children.indexOf(oldChild);
		if (idx !== -1) {
			if (newChild.parentElement) {
				const oldIdx = newChild.parentElement.children.indexOf(newChild);
				if (oldIdx !== -1) newChild.parentElement.children.splice(oldIdx, 1);
			}
			newChild.parentElement = this;
			this.children.splice(idx, 1, newChild);
			oldChild.parentElement = null;
			return oldChild;
		}
		return oldChild;
	}

	empty() {
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children = [];
		this.textContent = '';
	}

	appendChild(child: MockElement) {
		if (child.isFragment) {
			while (child.children.length > 0) {
				const item = child.children.shift()!;
				item.parentElement = this;
				this.children.push(item);
			}
			return child;
		}
		if (child.parentElement) {
			const idx = child.parentElement.children.indexOf(child);
			if (idx !== -1) {
				child.parentElement.children.splice(idx, 1);
			}
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	createDiv(opts?: string | { cls?: string; text?: string }) {
		const cls = typeof opts === 'string' ? opts : opts?.cls || '';
		const child = new MockElement(cls);
		if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	createSpan(opts?: string | { cls?: string; text?: string }) {
		const cls = typeof opts === 'string' ? opts : opts?.cls || '';
		const child = new MockElement(cls);
		if (typeof opts === 'object' && opts?.text) child.textContent = opts.text;
		this.appendChild(child);
		return child;
	}

	createEl(tag: string, opts?: { cls?: string; text?: string; type?: string; value?: string }) {
		const cls = opts?.cls || '';
		const child = new MockElement(cls);
		if (opts?.text) child.textContent = opts.text;
		if (opts?.type) child.type = opts.type;
		if (opts?.value !== undefined) child.value = opts.value;
		this.appendChild(child);
		return child;
	}

	setText(text: string) {
		this.empty();
		this.textContent = text;
		return this;
	}

	setAttr(key: string, val: string) { this.attributes.set(key, val); }
	setAttribute(key: string, val: string) { this.attributes.set(key, val); }
	getAttribute(key: string) { return this.attributes.get(key) ?? null; }

	addEventListener(event: string, fn: (e?: unknown) => void, opts?: boolean | { once?: boolean }) {
		const once = typeof opts === 'object' ? Boolean(opts?.once) : false;
		const handler = once
			? (e?: unknown) => {
					this.removeEventListener(event, handler);
					fn(e);
			  }
			: fn;
		const arr = this.listeners.get(event) ?? [];
		arr.push(handler);
		this.listeners.set(event, arr);
	}

	removeEventListener(event: string, fn: (e?: unknown) => void) {
		const arr = this.listeners.get(event);
		if (arr) {
			const idx = arr.indexOf(fn);
			if (idx !== -1) arr.splice(idx, 1);
		}
	}

	dispatchEvent(event: string, e?: unknown) {
		const arr = this.listeners.get(event) ?? [];
		for (const fn of [...arr]) fn(e);
	}

	querySelector(sel: string): MockElement | null {
		const matchPart = (node: MockElement, s: string): boolean => {
			if (s.startsWith('.')) {
				const rest = s.slice(1);
				if (rest.includes('[')) {
					const [cls, attrRaw] = rest.split('[');
					if (!node.hasClass(cls)) return false;
					const attrMatch = attrRaw.replace(/\]$/, '').match(/^([\w-]+)(?:=(?:"|')?([^"']*)(?:"|')?)?$/);
					if (attrMatch) {
						const [, key, val] = attrMatch;
						return val !== undefined ? node.getAttribute(key) === val : node.getAttribute(key) !== null;
					}
					return true;
				}
				return node.hasClass(rest);
			}
			if (s === 'input' || s.startsWith('input[')) {
				return node.type !== '' || node.className.includes('input');
			}
			if (s === 'textarea') {
				return node.hasClass('wn-corkboard-textarea') || node.hasClass('wn-sticky-note-paragraph-editor');
			}
			if (s.startsWith('[') && s.endsWith(']')) {
				const attrMatch = s.slice(1, -1).match(/^([\w-]+)(?:=(?:"|')?([^"']*)(?:"|')?)?$/);
				if (attrMatch) {
					const [, key, val] = attrMatch;
					return val !== undefined ? node.getAttribute(key) === val : node.getAttribute(key) !== null;
				}
			}
			return false;
		};
		const match = (node: MockElement): boolean => {
			if (sel.includes(',')) {
				return sel.split(',').some(part => matchPart(node, part.trim()));
			}
			return matchPart(node, sel);
		};
		const find = (node: MockElement): MockElement | null => {
			for (const c of node.children) {
				if (match(c)) return c;
				const nested = find(c);
				if (nested) return nested;
			}
			return null;
		};
		return find(this);
	}

	appendText(text: string) {
		this.textContent += text;
		return this;
	}

	querySelectorAll(sel: string): MockElement[] {
		const matchPart = (node: MockElement, s: string): boolean => {
			if (s.startsWith('.')) {
				const rest = s.slice(1);
				if (rest.includes('[')) {
					const [cls, attrRaw] = rest.split('[');
					if (!node.hasClass(cls)) return false;
					const attrMatch = attrRaw.replace(/\]$/, '').match(/^([\w-]+)(?:=(?:"|')?([^"']*)(?:"|')?)?$/);
					if (attrMatch) {
						const [, key, val] = attrMatch;
						return val !== undefined ? node.getAttribute(key) === val : node.getAttribute(key) !== null;
					}
					return true;
				}
				return node.hasClass(rest);
			}
			if (s.startsWith('[') && s.endsWith(']')) {
				const attrMatch = s.slice(1, -1).match(/^([\w-]+)(?:=(?:"|')?([^"']*)(?:"|')?)?$/);
				if (attrMatch) {
					const [, key, val] = attrMatch;
					return val !== undefined ? node.getAttribute(key) === val : node.getAttribute(key) !== null;
				}
			}
			return false;
		};
		const match = (node: MockElement): boolean => {
			if (sel.includes(',')) {
				return sel.split(',').some(part => matchPart(node, part.trim()));
			}
			return matchPart(node, sel);
		};
		const results: MockElement[] = [];
		const search = (node: MockElement) => {
			for (const c of node.children) {
				if (match(c)) results.push(c);
				search(c);
			}
		};
		search(this);
		return results;
	}
}
