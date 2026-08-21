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

	it('should return false and retry enable when leaves exist but getSortedFolderItems is not available yet', () => {
		const setTimeoutSpy = vi.fn(() => 1);
		vi.stubGlobal('window', {
			setTimeout: setTimeoutSpy,
			clearTimeout: vi.fn()
		});

		const unreadyView = {};
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

		expect(result).toBe(false);
		expect(patcher.isEnabled()).toBe(false);
		expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
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
});
