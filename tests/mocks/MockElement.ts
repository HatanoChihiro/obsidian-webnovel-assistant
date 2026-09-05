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

	createEl(tag: string, opts?: { cls?: string; text?: string; type?: string }) {
		const cls = opts?.cls || '';
		const child = new MockElement(cls);
		if (opts?.text) child.textContent = opts.text;
		if (opts?.type) child.type = opts.type;
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

	addEventListener(event: string, fn: (e?: unknown) => void) {
		const arr = this.listeners.get(event) ?? [];
		arr.push(fn);
		this.listeners.set(event, arr);
	}

	dispatchEvent(event: string, e?: unknown) {
		const arr = this.listeners.get(event) ?? [];
		for (const fn of arr) fn(e);
	}

	querySelector(sel: string): MockElement | null {
		const match = (node: MockElement): boolean => {
			if (sel.startsWith('.')) {
				return node.hasClass(sel.slice(1));
			}
			if (sel === 'input' || sel.startsWith('input[')) {
				return node.type !== '';
			}
			return false;
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
		const match = (node: MockElement): boolean => {
			if (sel.startsWith('.')) return node.hasClass(sel.slice(1));
			return false;
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
