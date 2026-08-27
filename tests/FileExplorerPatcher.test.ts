import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { FileExplorerPatcher } from '../src/services/FileExplorerPatcher';
import type { WebNovelAssistantPlugin } from '../src/types/plugin';
import { TFile, TFolder } from './mocks/obsidian';

interface MockEl {
	parentElement: MockEl | null;
	textContent: string;
	classList: { add: (...cls: string[]) => void; remove: (...cls: string[]) => void; contains: (cls: string) => boolean };
	remove: () => void;
	querySelector: (selector: string) => MockEl | null;
	querySelectorAll: (selector: string) => MockEl[];
	getElementsByClassName: (selector: string) => MockEl[];
	createSpan: (options?: { cls?: string; text?: string }) => MockEl;
	appendChild: (child: MockEl) => MockEl;
	addClass: (cls: string) => MockEl;
	addEventListener: (event: string, handler: unknown, capture?: boolean) => void;
	removeEventListener: (event: string, handler: unknown, capture?: boolean) => void;
}

function createMockEl(cls = ''): MockEl {
	const classSet = new Set(cls ? cls.split(' ').filter(Boolean) : []);
	const children: MockEl[] = [];
	const el: MockEl = {
		parentElement: null,
		textContent: '',
		classList: {
			add: (...c) => c.forEach(x => classSet.add(x)),
			remove: (...c) => c.forEach(x => classSet.delete(x)),
			contains: (c) => classSet.has(c)
		},
		remove: () => {
			if (el.parentElement) {
				const siblings = (el.parentElement as unknown as { _children: MockEl[] })._children;
				const idx = siblings.indexOf(el);
				if (idx !== -1) siblings.splice(idx, 1);
				el.parentElement = null;
			}
		},
		querySelector: (sel: string): MockEl | null => {
			for (const child of children) {
				if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) return child;
				const found = child.querySelector(sel);
				if (found) return found;
			}
			return null;
		},
		querySelectorAll: (sel: string): MockEl[] => {
			const results: MockEl[] = [];
			for (const child of children) {
				if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) results.push(child);
				results.push(...child.querySelectorAll(sel));
			}
			return results;
		},
		getElementsByClassName: (selector: string): MockEl[] => {
			return el.querySelectorAll(selector.startsWith('.') ? selector : `.${selector}`);
		},
		createSpan: (options?: { cls?: string; text?: string }) => {
			const span = createMockEl(options?.cls || '');
			if (options?.text) span.textContent = options.text;
			el.appendChild(span);
			return span;
		},
		appendChild: (child: MockEl) => {
			child.parentElement = el;
			children.push(child);
			return child;
		},
		addClass: (c: string) => {
			classSet.add(c);
			return el;
		},
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		_children: children
	} as MockEl & { _children: MockEl[] };
	return el;
}

describe('FileExplorerPatcher', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {
			setTimeout: (fn: (...args: unknown[]) => void, ms?: number) => setTimeout(fn, ms),
			clearTimeout: (id: NodeJS.Timeout | number) => clearTimeout(id),
			setInterval: (fn: (...args: unknown[]) => void, ms?: number) => setInterval(fn, ms),
			clearInterval: (id: NodeJS.Timeout | number) => clearInterval(id),
			requestAnimationFrame: (cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0),
			cancelAnimationFrame: (id: NodeJS.Timeout | number) => clearTimeout(id)
		});
		vi.stubGlobal('activeDocument', {
			body: {
				classList: {
					remove: vi.fn()
				}
			},
			getElementsByClassName: vi.fn(() => [])
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('should debounce sort order persistence during a batch rename', () => {
		vi.stubGlobal('window', {
			setTimeout: vi.fn(() => 1),
			clearTimeout: vi.fn()
		});

		const vaultEvents: Record<string, (file: TFile, oldPath: string) => void> = {};
		const pendingCallbacks = new Map<string, () => void>();
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const mockApp = {
			vault: {
				on: vi.fn((eventName: string, handler: (file: TFile, oldPath: string) => void) => {
					vaultEvents[eventName] = handler;
					return {};
				})
			},
			workspace: {
				on: vi.fn(() => ({}))
			}
		} as unknown as App;
		const mockPlugin = {
			settings: {
				customSortOrder: {
					'Novel/1.md': 1,
					'Novel/2.md': 2
				}
			},
			adaptiveDebounceManager: {
				debounceFixed: vi.fn((key: string, callback: () => void) => {
					pendingCallbacks.set(key, callback);
				})
			},
			saveSettings
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		(patcher as unknown as { enabled: boolean }).enabled = true;
		(patcher as unknown as { setupFileSystemListeners: () => void }).setupFileSystemListeners();

		const renameHandler = vaultEvents.rename;
		renameHandler(new TFile('3.md', 'Novel/3.md'), 'Novel/1.md');
		renameHandler(new TFile('4.md', 'Novel/4.md'), 'Novel/2.md');

		expect(saveSettings).not.toHaveBeenCalled();
		expect(mockPlugin.adaptiveDebounceManager.debounceFixed).toHaveBeenCalledTimes(2);
		expect(pendingCallbacks.has('file-explorer-sort-order-save')).toBe(true);

		pendingCallbacks.get('file-explorer-sort-order-save')?.();

		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

function mockWindowTimers(scheduledTimeouts: { fn: () => void; ms?: number; id: number }[]) {
	let timerIdCounter = 1;
	vi.stubGlobal('window', {
		setTimeout: vi.fn((fn: () => void, ms?: number) => {
			const id = timerIdCounter++;
			scheduledTimeouts.push({ fn, ms, id });
			return id;
		}),
		clearTimeout: vi.fn((id: number) => {
			const idx = scheduledTimeouts.findIndex(t => t.id === id);
			if (idx !== -1) scheduledTimeouts.splice(idx, 1);
		}),
		setInterval: vi.fn(),
		clearInterval: vi.fn(),
		requestAnimationFrame: vi.fn((cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0)),
		cancelAnimationFrame: vi.fn()
	});
}

	it('should remain active and schedule bounded retries when leaves are unready, then self-heal', () => {
		const scheduledTimeouts: { fn: () => void; ms?: number; id: number }[] = [];
		mockWindowTimers(scheduledTimeouts);

		class UnreadyProto {
			getSortedFolderItems?: () => unknown[];
		}
		const proto = new UnreadyProto();
		const unreadyView = Object.create(proto);

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [{ view: unreadyView }]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { chapterNamingRules: [] },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		const result = patcher.enable();

		expect(result).toBe(true);
		expect(patcher.isEnabled()).toBe(true);
		expect(scheduledTimeouts.map(t => t.ms)).toEqual([100, 300]);

		// Now simulate the view method becoming ready before the first timer executes
		const originalMethod = () => [];
		proto.getSortedFolderItems = originalMethod;

		// Execute 100ms timer
		const t100 = scheduledTimeouts.find(t => t.ms === 100);
		expect(t100).toBeDefined();
		t100?.fn();

		// Prototype is now patched and the 300ms timer was cleared
		expect(proto.getSortedFolderItems).not.toBe(originalMethod);
		expect(scheduledTimeouts.find(t => t.ms === 300)).toBeUndefined();
	});

	it('should self-heal from lifecycle event even after startup with no explorer leaves and expired timers', () => {
		const scheduledTimeouts: { fn: () => void; ms?: number; id: number }[] = [];
		mockWindowTimers(scheduledTimeouts);

		class DummyProto { getSortedFolderItems() { return []; } }
		const proto = new DummyProto();
		const originalMethod = proto.getSortedFolderItems;
		const sortSpy = vi.fn();
		const view = Object.create(proto);
		view.sort = sortSpy;

		let currentLeaves: { view: unknown }[] = [];
		const workspaceEvents: Record<string, () => void> = {};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => currentLeaves),
				on: vi.fn((eventName: string, handler: () => void) => {
					workspaceEvents[eventName] = handler;
					return {};
				}),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true, chapterNamingRules: [] },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		patcher.enable();
		expect(patcher.isEnabled()).toBe(true);

		// Timers fire when no leaves exist, all startup recovery timers expire
		while (scheduledTimeouts.length > 0) {
			const next = scheduledTimeouts.shift();
			next?.fn();
		}
		expect(scheduledTimeouts.length).toBe(0);
		expect(proto.getSortedFolderItems).toBe(originalMethod);

		// Much later (e.g. user opens sidebar), file explorer leaf appears
		currentLeaves = [{ view }];
		expect(workspaceEvents['layout-change']).toBeDefined();
		workspaceEvents['layout-change']();

		// Self-healing succeeded: prototype patched and sort triggered!
		expect(proto.getSortedFolderItems).not.toBe(originalMethod);
		expect(sortSpy).toHaveBeenCalled();
	});

	it('should recover via bounded delayed retry when layout-change occurs before view is ready', () => {
		const scheduledTimeouts: { fn: () => void; ms?: number; id: number }[] = [];
		mockWindowTimers(scheduledTimeouts);

		class NewProto {
			getSortedFolderItems?: () => unknown[];
		}
		const newProto = new NewProto();
		const sortSpy = vi.fn();
		const newView = Object.create(newProto);
		newView.sort = sortSpy;

		let currentLeaves: { view: unknown }[] = [];
		const workspaceEvents: Record<string, () => void> = {};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => currentLeaves),
				on: vi.fn((eventName: string, handler: () => void) => {
					workspaceEvents[eventName] = handler;
					return {};
				}),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		patcher.enable();
		scheduledTimeouts.length = 0;

		// Recreated view appears on layout-change but without getSortedFolderItems attached yet
		currentLeaves = [{ view: newView }];
		workspaceEvents['layout-change']();

		// At t=0, not yet patched, but bounded retries scheduled
		expect(newProto.getSortedFolderItems).toBeUndefined();
		expect(scheduledTimeouts.map(t => t.ms)).toEqual([100, 300]);

		// At t=50ms, Obsidian attaches getSortedFolderItems
		const originalMethod = () => [];
		newProto.getSortedFolderItems = originalMethod;

		// Execute the 100ms retry timer
		const t100 = scheduledTimeouts.find(t => t.ms === 100);
		expect(t100).toBeDefined();
		t100?.fn();

		expect(newProto.getSortedFolderItems).not.toBe(originalMethod);
		expect(sortSpy).toHaveBeenCalled();
		// 300ms timer cleared
		expect(scheduledTimeouts.find(t => t.ms === 300)).toBeUndefined();
	});

	it('should force refresh when a new prototype is patched even if first container element is reused', () => {
		const sharedContainer = createMockEl('nav-files-container');

		class ProtoA { getSortedFolderItems() { return []; } }
		class ProtoB { getSortedFolderItems() { return []; } }

		const protoA = new ProtoA();
		const protoB = new ProtoB();

		const viewA = Object.create(protoA);
		viewA.containerEl = sharedContainer as unknown as HTMLElement;
		const sortSpyA = vi.fn();
		viewA.sort = sortSpyA;

		const viewB = Object.create(protoB);
		viewB.containerEl = sharedContainer as unknown as HTMLElement;
		const sortSpyB = vi.fn();
		viewB.sort = sortSpyB;

		let currentLeaves = [{ view: viewA }];
		const workspaceEvents: Record<string, () => void> = {};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => currentLeaves),
				on: vi.fn((eventName: string, handler: () => void) => {
					workspaceEvents[eventName] = handler;
					return {};
				}),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		patcher.enable();
		expect(sortSpyA).toHaveBeenCalledTimes(1);

		// Switch leaf view to viewB (which uses ProtoB) while keeping the exact same containerEl instance
		currentLeaves = [{ view: viewB }];
		workspaceEvents['layout-change']();

		// Even though containerEl did not change, newly patched ProtoB must trigger sort refresh on viewB
		expect(sortSpyB).toHaveBeenCalledTimes(1);
	});

	it('should not double-wrap prototypes or duplicate listeners on repeated enable and lifecycle events', () => {
		class TestProto { getSortedFolderItems() { return ['item']; } }
		const proto = new TestProto();
		const originalMethod = proto.getSortedFolderItems;
		const view = Object.create(proto);

		const vaultOnSpy = vi.fn(() => ({}));
		const workspaceOnSpy = vi.fn(() => ({}));

		const mockApp = {
			vault: { on: vaultOnSpy, offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [{ view }]),
				on: workspaceOnSpy,
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);

		// First enable
		patcher.enable();
		const firstPatchedMethod = proto.getSortedFolderItems;
		expect(firstPatchedMethod).not.toBe(originalMethod);

		// Repeated enable calls
		patcher.enable();
		patcher.enable();

		// Verify vault/workspace listeners were registered only once
		expect(vaultOnSpy).toHaveBeenCalledTimes(2); // 'delete', 'rename'
		expect(workspaceOnSpy).toHaveBeenCalledTimes(2); // 'layout-change', 'active-leaf-change'

		// Prototype wrapper should not be double wrapped
		expect(proto.getSortedFolderItems).toBe(firstPatchedMethod);

		// Triggering unpatch should restore the exact original function
		patcher.unpatch();
		expect(proto.getSortedFolderItems).toBe(originalMethod);
	});

	it('should cancel pending recovery timers on disable/destroy and prevent late reactivation', () => {
		const scheduledTimeouts: { fn: () => void; ms?: number; id: number }[] = [];
		mockWindowTimers(scheduledTimeouts);

		class UnreadyProto {
			getSortedFolderItems?: () => unknown[];
		}
		const proto = new UnreadyProto();
		const sortSpy = vi.fn();
		const view = Object.create(proto);
		view.sort = sortSpy;

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [{ view }]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		patcher.enable();

		// Two recovery timers scheduled; capture their callbacks before disable
		expect(scheduledTimeouts.length).toBe(2);
		const staleCallbacks = scheduledTimeouts.map(t => t.fn);

		// Disable patcher
		patcher.disable();
		expect(patcher.isEnabled()).toBe(false);
		expect(scheduledTimeouts.length).toBe(0); // Timers cleared via clearTimeout
		sortSpy.mockClear();

		// View becomes ready late
		const originalMethod = () => [];
		proto.getSortedFolderItems = originalMethod;

		// Even if an orphaned callback executes after disable, it must not patch, refresh, or reactivate
		staleCallbacks.forEach(cb => cb());
		expect(proto.getSortedFolderItems).toBe(originalMethod);
		expect(sortSpy).not.toHaveBeenCalled();
		expect(patcher.isEnabled()).toBe(false);
		expect(scheduledTimeouts.length).toBe(0);

		// Destroy patcher
		patcher.destroy();
		expect(patcher.enable()).toBe(false);

		// Executing stale callbacks after destroy also has no effect
		staleCallbacks.forEach(cb => cb());
		expect(proto.getSortedFolderItems).toBe(originalMethod);
		expect(sortSpy).not.toHaveBeenCalled();
		expect(patcher.isEnabled()).toBe(false);
	});

	it('should handle errors during enable cleanly without leaving enabled=true or dangling listeners/timers', () => {
		const scheduledTimeouts: { fn: () => void; ms?: number; id: number }[] = [];
		mockWindowTimers(scheduledTimeouts);

		const vaultOffSpy = vi.fn();
		const workspaceOffSpy = vi.fn();
		const vaultOnSpy = vi.fn(() => ({}));
		// Simulate workspace listener setup failure during enable
		const workspaceOnSpy = vi.fn(() => {
			throw new Error('Simulated workspace listener error');
		});

		const mockApp = {
			vault: { on: vaultOnSpy, offref: vaultOffSpy },
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				on: workspaceOnSpy,
				offref: workspaceOffSpy
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { chapterNamingRules: [] },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		const result = patcher.enable();

		expect(result).toBe(false);
		expect(patcher.isEnabled()).toBe(false);
		// Vault listeners registered before workspace failure must be cleaned up via offref
		expect(vaultOnSpy).toHaveBeenCalled();
		expect(vaultOffSpy).toHaveBeenCalled();
		// No timers left pending
		expect(scheduledTimeouts.length).toBe(0);
	});

	it('should patch newly recreated file explorer views with different prototypes on layout-change', () => {
		vi.stubGlobal('window', {
			cancelAnimationFrame: vi.fn(),
			clearTimeout: vi.fn()
		});
		vi.stubGlobal('activeDocument', {
			activeElement: null,
			body: { classList: { remove: vi.fn() } },
			querySelectorAll: vi.fn(() => [])
		});

		// 模拟两个具有不同原型的文件浏览器视图
		class DummyProto { getSortedFolderItems() { return []; } }
		const proto1 = new DummyProto();
		const proto2 = new DummyProto();

		const originalProto1Method = proto1.getSortedFolderItems;
		const originalProto2Method = proto2.getSortedFolderItems;

		const view1 = Object.create(proto1);
		const view2 = Object.create(proto2);

		let currentLeaves = [{ view: view1 }];
		const workspaceEvents: Record<string, () => void> = {};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => currentLeaves),
				on: vi.fn((eventName: string, handler: () => void) => {
					workspaceEvents[eventName] = handler;
					return {};
				}),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { enableSmartChapterSort: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);

		// 初始启用，应该修补 proto1
		patcher.enable();
		expect(proto1.getSortedFolderItems).not.toBe(originalProto1Method);
		expect(proto2.getSortedFolderItems).toBe(originalProto2Method);

		// 模拟文件浏览器重建（具有新的原型）
		currentLeaves = [{ view: view2 }];

		// 触发 layout-change
		expect(workspaceEvents['layout-change']).toBeDefined();
		workspaceEvents['layout-change']();

		// 验证新的原型 proto2 也被成功修补
		expect(proto1.getSortedFolderItems).not.toBe(originalProto1Method);
		expect(proto2.getSortedFolderItems).not.toBe(originalProto2Method);

		// 禁用并显式清理修补时，两个原型都应恢复原方法
		patcher.disable();
		patcher.unpatch();
		expect(proto1.getSortedFolderItems).toBe(originalProto1Method);
		expect(proto2.getSortedFolderItems).toBe(originalProto2Method);
	});

	it('should allow refreshFolderCounts to render badges after ordinary disable when showExplorerCounts is enabled', () => {
		const titleParent = createMockEl();
		const titleContent = createMockEl('nav-folder-title-content');
		titleParent.appendChild(titleContent);

		const folderItemEl = createMockEl('nav-folder');
		folderItemEl.appendChild(titleParent);

		const containerEl = createMockEl('nav-files-container');
		containerEl.appendChild(folderItemEl);

		const mockView = {
			containerEl: containerEl as unknown as HTMLElement,
			fileItems: {
				'Novel': {
					el: folderItemEl as unknown as HTMLElement,
					file: new TFolder('Novel', 'Novel')
				}
			}
		};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [{ view: mockView }]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { showExplorerCounts: true, chapterNamingRules: [] },
			cacheManager: {
				getFolderWordCount: vi.fn().mockReturnValue(5000)
			},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);

		// Ordinary disable (e.g. smart sort disabled in settings)
		patcher.disable();
		expect(patcher.isEnabled()).toBe(false);

		// refreshFolderCounts should still operate and create count badges
		patcher.refreshFolderCounts();
		const badge = titleParent.querySelector('.wn-folder-word-count');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toBe(' (5,000)');
	});

	it('should block refreshFolderCounts after terminal destroy and remove existing badges', () => {
		const titleParent = createMockEl();
		const titleContent = createMockEl('nav-folder-title-content');
		titleParent.appendChild(titleContent);

		const folderItemEl = createMockEl('nav-folder');
		folderItemEl.appendChild(titleParent);

		const containerEl = createMockEl('nav-files-container');
		containerEl.appendChild(folderItemEl);

		const mockView = {
			containerEl: containerEl as unknown as HTMLElement,
			fileItems: {
				'Novel': {
					el: folderItemEl as unknown as HTMLElement,
					file: new TFolder('Novel', 'Novel')
				}
			}
		};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [{ view: mockView }]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { showExplorerCounts: true, chapterNamingRules: [] },
			cacheManager: {
				getFolderWordCount: vi.fn().mockReturnValue(8888)
			},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);

		// Render badges initially
		patcher.refreshFolderCounts();
		expect(titleParent.querySelector('.wn-folder-word-count')?.textContent).toBe(' (8,888)');

		// Terminal destroy
		patcher.destroy();
		expect(titleParent.querySelector('.wn-folder-word-count')).toBeNull();

		// Repeated calls to destroy should be idempotent
		patcher.destroy();

		// Subsequent refreshFolderCounts must not recreate badges
		patcher.refreshFolderCounts();
		expect(titleParent.querySelector('.wn-folder-word-count')).toBeNull();
	});

	it('should remove word count badges across multi-window leaf containers and owner documents', () => {
		const container1 = createMockEl('nav-files-container');
		const container2 = createMockEl('nav-files-container');

		const badge1 = createMockEl('wn-folder-word-count');
		container1.appendChild(badge1);

		const badge2 = createMockEl('wn-folder-word-count');
		container2.appendChild(badge2);

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [
					{ view: { containerEl: container1 as unknown as HTMLElement } },
					{ view: { containerEl: container2 as unknown as HTMLElement } }
				]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { showExplorerCounts: true },
			cacheManager: {},
			adaptiveDebounceManager: { debounceFixed: vi.fn() }
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);
		patcher.destroy();

		expect(container1.querySelectorAll('.wn-folder-word-count').length).toBe(0);
		expect(container2.querySelectorAll('.wn-folder-word-count').length).toBe(0);
	});

	it('should remove word count badges from detached cached fileItems across all explorer views upon destroy and prevent reappearance on refresh', () => {
		// Mounted parent folder element
		const parentTitleParent = createMockEl();
		const parentTitleContent = createMockEl('nav-folder-title-content');
		parentTitleParent.appendChild(parentTitleContent);
		const parentFolderEl = createMockEl('nav-folder');
		parentFolderEl.appendChild(parentTitleParent);

		const container1 = createMockEl('nav-files-container');
		container1.appendChild(parentFolderEl);

		// Detached collapsed child item (cached in fileItems but not attached to container1 or document)
		const childTitleParent = createMockEl();
		const childTitleContent = createMockEl('nav-folder-title-content');
		childTitleParent.appendChild(childTitleContent);
		const childBadge = createMockEl('wn-folder-word-count');
		childBadge.textContent = ' (3,000)';
		childTitleParent.appendChild(childBadge);
		const childFolderEl = createMockEl('nav-folder');
		childFolderEl.appendChild(childTitleParent);

		// Second leaf with its own detached file item
		const container2 = createMockEl('nav-files-container');
		const leaf2ChildTitleParent = createMockEl();
		const leaf2ChildBadge = createMockEl('wn-folder-word-count');
		leaf2ChildBadge.textContent = ' (4,000)';
		leaf2ChildTitleParent.appendChild(leaf2ChildBadge);
		const leaf2ChildFolderEl = createMockEl('nav-folder');
		leaf2ChildFolderEl.appendChild(leaf2ChildTitleParent);

		const mockView1 = {
			containerEl: container1 as unknown as HTMLElement,
			fileItems: {
				'Novel': {
					el: parentFolderEl as unknown as HTMLElement,
					file: new TFolder('Novel', 'Novel')
				},
				'Novel/Volume 1': {
					el: childFolderEl as unknown as HTMLElement,
					file: new TFolder('Volume 1', 'Novel/Volume 1')
				}
			}
		};

		const mockView2 = {
			containerEl: container2 as unknown as HTMLElement,
			fileItems: {
				'Novel/Volume 2': {
					el: leaf2ChildFolderEl as unknown as HTMLElement,
					file: new TFolder('Volume 2', 'Novel/Volume 2')
				}
			}
		};

		const mockApp = {
			vault: { on: vi.fn(), offref: vi.fn() },
			workspace: {
				getLeavesOfType: vi.fn(() => [
					{ view: mockView1 },
					{ view: mockView2 }
				]),
				on: vi.fn(() => ({})),
				offref: vi.fn()
			}
		} as unknown as App;

		const mockPlugin = {
			settings: { showExplorerCounts: true, chapterNamingRules: [] },
			cacheManager: {
				getFolderWordCount: vi.fn().mockReturnValue(3000)
			},
			adaptiveDebounceManager: { debounceFixed: vi.fn() },
			isUnloading: false
		} as unknown as WebNovelAssistantPlugin;

		const patcher = new FileExplorerPatcher(mockApp, mockPlugin);

		// Ensure detached elements currently retain badges before unload
		expect(childFolderEl.querySelector('.wn-folder-word-count')).not.toBeNull();
		expect(leaf2ChildFolderEl.querySelector('.wn-folder-word-count')).not.toBeNull();

		// Destroy / unload
		patcher.destroy();

		// Badges must be removed from detached cached fileItems across all leaves
		expect(childFolderEl.querySelector('.wn-folder-word-count')).toBeNull();
		expect(leaf2ChildFolderEl.querySelector('.wn-folder-word-count')).toBeNull();

		// Simulating subsequent refresh (e.g. delayed timer or folder expansion event after unload)
		patcher.refreshFolderCounts();

		// Badges must not reappear
		expect(childFolderEl.querySelector('.wn-folder-word-count')).toBeNull();
		expect(leaf2ChildFolderEl.querySelector('.wn-folder-word-count')).toBeNull();
	});
});
