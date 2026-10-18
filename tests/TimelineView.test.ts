import { MockElement } from './mocks/MockElement';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineView, type TimelineViewPlugin } from '../src/ui/TimelineView';
import type { TimelineEntry } from '../src/services/TimelineManager';
import type { WorkspaceLeaf } from 'obsidian';

// Attach global helpers expected by Obsidian runtime
(globalThis as unknown as { createDiv: (opts?: unknown) => MockElement }).createDiv = function(opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
	if (typeof opts === 'object' && opts !== null && 'text' in opts) {
		el.textContent = (opts as { text: string }).text;
	}
	return el;
};

(globalThis as unknown as { createSpan: (opts?: unknown) => MockElement }).createSpan = function(opts?: unknown) {
	const cls = typeof opts === 'string' ? opts : (opts as { cls?: string })?.cls || '';
	const el = new MockElement(cls);
	if (typeof opts === 'object' && opts !== null && 'text' in opts) {
		el.textContent = (opts as { text: string }).text;
	}
	return el;
};

vi.stubGlobal('window', {
	requestAnimationFrame: (cb: (time: number) => void) => {
		cb(Date.now());
		return 0;
	},
	setTimeout: globalThis.setTimeout,
	clearTimeout: globalThis.clearTimeout
});

vi.stubGlobal('activeDocument', {
	elementFromPoint: vi.fn().mockReturnValue(null)
});

vi.mock('obsidian', () => {
	class MockItemView {
		app: unknown;
		containerEl: MockElement;
		contentEl: MockElement;

		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.containerEl = new MockElement('workspace-leaf-content');
			const headerEl = new MockElement('view-header');
			this.contentEl = new MockElement('view-content');
			this.containerEl.children.push(headerEl, this.contentEl);
			headerEl.parentElement = this.containerEl;
			this.contentEl.parentElement = this.containerEl;
		}

		registerEvent(): void {}
	}

	return {
		ItemView: MockItemView,
		Modal: class {},
		Notice: vi.fn(),
		setIcon: vi.fn(),
		Platform: { isMobile: false },
		Component: class {
			load = vi.fn();
			unload = vi.fn();
			register = vi.fn();
		},
		setTooltip: vi.fn()
	};
});

vi.mock('../src/i18n', () => ({
	t: (key: string) => key
}));

describe('TimelineView', () => {
	let mockApp: {
		workspace: {
			on: ReturnType<typeof vi.fn>;
			trigger: ReturnType<typeof vi.fn>;
		};
		vault: {
			read: ReturnType<typeof vi.fn>;
		};
		metadataCache: {
			getFileCache: ReturnType<typeof vi.fn>;
		};
	};
	let mockPlugin: TimelineViewPlugin;
	let parsedEntries: TimelineEntry[];

	beforeEach(() => {
		vi.clearAllMocks();

		mockApp = {
			workspace: {
				on: vi.fn(),
				trigger: vi.fn()
			},
			vault: {
				read: vi.fn().mockResolvedValue('# 时间线\n')
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null)
			}
		};

		parsedEntries = [
			{ time: '第一年', description: '第一年事件', chapter: '', rawBlock: '', items: [{ description: '第一年事件', chapter: '', type: '主线' }] },
			{ time: '第二年', description: '第二年事件', chapter: '', rawBlock: '', items: [{ description: '第二年事件', chapter: '', type: '主线' }] },
			{ time: '第三年', description: '第三年事件', chapter: '', rawBlock: '', items: [{ description: '第三年事件', chapter: '', type: '支线' }] }
		];

		mockPlugin = {
			app: mockApp as unknown as import('obsidian').App,
			settings: {
				timeline: {
					fileName: '时间线',
					defaultTypes: ['主线', '支线']
				},
				workspaceFolders: [],
				loreFolderName: '设定',
				foreshadowing: { fileName: '伏笔' },
				novelInfo: { fileName: '作品信息' }
			},
			timelineManager: {
				getTimelineFile: vi.fn().mockReturnValue({ path: '时间线.md' }),
				createTimelineFile: vi.fn(),
				parseEntries: vi.fn().mockImplementation(() => parsedEntries),
				appendEntry: vi.fn(),
				updateEntry: vi.fn().mockResolvedValue(''),
				deleteEntry: vi.fn().mockResolvedValue(''),
				moveEntry: vi.fn().mockResolvedValue('')
			},
			getTrackedMarkdownFiles: vi.fn().mockReturnValue([])
		} as unknown as TimelineViewPlugin;
	});

	it('should render header sort toggle button defaulting to ascending', async () => {
		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);

		await view.renderFromContent('# 时间线\n');

		expect((view as unknown as { isDescending: boolean }).isDescending).toBe(false);
		const sortToggle = view.containerEl.querySelector('.wn-timeline-sort-toggle');
		expect(sortToggle).not.toBeNull();
		expect(sortToggle?.getAttribute('role')).toBe('button');
		expect(sortToggle?.getAttribute('aria-label')).toBe('corkboard.sort-ascending');
		expect(sortToggle?.getAttribute('aria-pressed')).toBe('false');
		expect(sortToggle?.hasClass('wn-timeline-toolbar-button')).toBe(true);
		const addButton = view.containerEl.querySelector('.wn-timeline-add-btn');
		expect(addButton?.hasClass('wn-timeline-toolbar-button')).toBe(true);
		expect(addButton?.getAttribute('aria-label')).toBe('modal.new-event');

		// Check entries rendered in ascending order
		const timeEls = view.containerEl.querySelectorAll('.wn-timeline-time');
		expect(timeEls).toHaveLength(3);
		expect(timeEls[0].textContent).toBe('第一年');
		expect(timeEls[1].textContent).toBe('第二年');
		expect(timeEls[2].textContent).toBe('第三年');
	});

	it('should toggle to descending, emit workspace event, and reverse display entries while preserving original index for edit/delete', async () => {
		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);

		await view.renderFromContent('# 时间线\n');

		const sortToggle = view.containerEl.querySelector('.wn-timeline-sort-toggle') as HTMLElement | null;
		expect(sortToggle).not.toBeNull();

		// Click toggle to switch to descending
		sortToggle?.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		expect((view as unknown as { isDescending: boolean }).isDescending).toBe(true);
		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('timeline-order-changed', expect.anything());

		// Rendered in descending order
		const timeEls = view.containerEl.querySelectorAll('.wn-timeline-time');
		expect(timeEls[0].textContent).toBe('第三年');
		expect(timeEls[1].textContent).toBe('第二年');
		expect(timeEls[2].textContent).toBe('第一年');

		// In descending mode, items must have is-descending class and draggable="false", no drag handle
		const items = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(items[0].hasClass('is-descending')).toBe(true);
		expect(items[0].getAttribute('draggable')).toBe('false');
		expect(view.containerEl.querySelector('.wn-timeline-drag-handle')).toBeNull();

		// The first displayed item ("第三年") has original index 2 in parsedEntries
		expect(items[0].getAttribute('data-index')).toBe('2');

		// Test delete on first displayed item ("第三年", original index 2)
		const deleteBtns = view.containerEl.querySelectorAll('.timeline-delete-btn');
		(deleteBtns[0] as HTMLElement | undefined)?.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		expect(mockPlugin.timelineManager.deleteEntry).toHaveBeenCalledWith(2, '', expect.anything());

		// Click toggle again to switch back to ascending
		const newSortToggle = view.containerEl.querySelector('.wn-timeline-sort-toggle') as HTMLElement | null;
		newSortToggle?.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		expect((view as unknown as { isDescending: boolean }).isDescending).toBe(false);
		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('timeline-order-changed', expect.anything());

		// Items in ascending mode must be draggable with drag handle
		const ascItems = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(ascItems[0].getAttribute('draggable')).toBe('true');
		expect(view.containerEl.querySelector('.wn-timeline-drag-handle')).not.toBeNull();
	});

	it('filters by type locally without dispatching workspace events', async () => {
		parsedEntries = [{
			time: '第一天',
			type: '主线',
			description: '甲事件',
			chapter: '',
			rawBlock: '',
			items: [{ description: '甲事件', chapter: '', type: '主线' }]
		}, {
			time: '第二天',
			type: '支线',
			description: '乙事件',
			chapter: '',
			rawBlock: '',
			items: [{ description: '乙事件', chapter: '', type: '支线' }]
		}];

		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		// Click the first specific type filter ("主线" or similar depending on options)
		const filterRow = view.containerEl.querySelector('.wn-timeline-view-filter-row');
		const typeBtns = filterRow?.querySelectorAll('.wn-timeline-filter-btn');
		expect(typeBtns?.length).toBeGreaterThan(1);

		(typeBtns?.[1] as HTMLElement | undefined)?.click(); // the first specific type
		await new Promise(resolve => setTimeout(resolve, 10));

		// Assert that event is not dispatched
		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('timeline-filter-changed', expect.anything());

		// Verify filtering worked (only one entry should remain)
		const timeEls = view.containerEl.querySelectorAll('.wn-timeline-time');
		expect(timeEls).toHaveLength(1);
	});

	it('filters by node-level lore while keeping every sibling sub-event visible', async () => {
		parsedEntries = [{
			time: '第一天',
			description: '甲事件\n乙事件',
			chapter: '',
			rawBlock: '',
			lores: ['甲', '乙'],
			items: [
				{ description: '甲事件', chapter: '', type: '主线' },
				{ description: '乙事件', chapter: '', type: '主线' }
			]
		}];

		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		const loreRow = view.containerEl.querySelector('.wn-timeline-view-lore-filter-row');
		expect(loreRow).not.toBeNull();
		expect(loreRow?.children).toHaveLength(3);

		(loreRow?.children[2] as HTMLElement | undefined)?.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		expect(mockApp.workspace.trigger).not.toHaveBeenCalledWith('timeline-lore-filter-changed', expect.anything());
		const renderedItems = view.containerEl.querySelectorAll('.wn-timeline-list-item');
		expect(renderedItems).toHaveLength(2);
		expect(renderedItems[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('甲事件');
		expect(renderedItems[1].querySelector('.wn-timeline-desc-text')?.textContent).toBe('乙事件');
	});

	it('displays one type per node and filters same-name nodes by type', async () => {
		parsedEntries = [{
			time: '第一天',
			type: '主线',
			description: '主线事件',
			chapter: '',
			rawBlock: '',
			items: [{ description: '主线事件描述', chapter: '' }]
		}, {
			time: '第一天', type: '支线', description: '支线事件', chapter: '', rawBlock: '',
			items: [{ description: '支线事件描述', chapter: '' }]
		}];

		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		// 1. In 'all' view: both items rendered, footer shows both type tags
		const allItems = view.containerEl.querySelectorAll('.wn-timeline-list-item');
		expect(allItems).toHaveLength(2);
		const footerTags = Array.from(view.containerEl.querySelectorAll('.wn-timeline-type-tag'));
		expect(footerTags.map(t => t.textContent)).toEqual(['主线', '支线']);

		// 2. Click '支线' filter button
		const filterRow = view.containerEl.querySelector('.wn-timeline-view-filter-row');
		const typeBtns = Array.from(filterRow?.querySelectorAll('.wn-timeline-filter-btn') || []);
		const subBtn = typeBtns.find(b => b.textContent === '支线');
		expect(subBtn).toBeDefined();
		(subBtn as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));

		// Only '支线' item should be rendered
		const subItems = view.containerEl.querySelectorAll('.wn-timeline-list-item');
		expect(subItems).toHaveLength(1);
		expect(subItems[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('支线事件描述');
	});

	it('renders chapter link intact for comma-bearing chapter without splitting', async () => {
		parsedEntries = [{
			time: '第一天',
			description: '测试事件',
			chapter: '["Chapter 1, Hello"]',
			rawBlock: '',
			items: [{ description: '测试事件', chapter: '["Chapter 1, Hello"]' }]
		}];

		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		const links = view.containerEl.querySelectorAll('.wn-timeline-chapter-link');
		expect(links).toHaveLength(1);
		expect(links[0].textContent).toBe('Chapter 1, Hello');
	});

	it('supports multi-selecting types with OR logic, deselecting, and All clearing only types without affecting lore', async () => {
		parsedEntries = [
			{
				time: '第一天',
				type: '主线',
				description: '主线甲',
				chapter: '',
				rawBlock: '',
				lores: ['角色A'],
				items: [{ description: '主线甲', chapter: '' }]
			},
			{
				time: '第二天',
				type: '支线',
				description: '支线乙',
				chapter: '',
				rawBlock: '',
				lores: ['角色B'],
				items: [{ description: '支线乙', chapter: '' }]
			},
			{
				time: '第三天',
				type: '日常',
				description: '日常丙',
				chapter: '',
				rawBlock: '',
				lores: ['角色A'],
				items: [{ description: '日常丙', chapter: '' }]
			}
		];

		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		const typeRow = view.containerEl.querySelector('.wn-timeline-view-type-filter-row');
		expect(typeRow).not.toBeNull();
		const getFilterButton = (rowSelector: string, label: string): HTMLElement => {
			const row = view.containerEl.querySelector(rowSelector);
			const button = Array.from(row?.querySelectorAll('.wn-timeline-filter-btn') || []).find(b => b.textContent === label);
			expect(button).toBeDefined();
			return button as HTMLElement;
		};
		const getTypeButton = (label: string) => getFilterButton('.wn-timeline-view-type-filter-row', label);

		// 1. Click '主线' -> selects '主线'
		getTypeButton('主线').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		let rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(1);
		expect(rendered[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('主线甲');

		// 2. Click '支线' -> both '主线' and '支线' selected (OR)
		getTypeButton('支线').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(2);
		expect(rendered[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('主线甲');
		expect(rendered[1].querySelector('.wn-timeline-desc-text')?.textContent).toBe('支线乙');
		expect(getTypeButton('主线').getAttribute('aria-pressed')).toBe('true');
		expect(getTypeButton('支线').getAttribute('aria-pressed')).toBe('true');

		// 3. Also select lore '角色A' -> (主线 OR 支线) AND 角色A => only '主线甲'
		getFilterButton('.wn-timeline-view-lore-filter-row', '角色A').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(1);
		expect(rendered[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('主线甲');

		// 4. Click 'common.all-types' -> clears type filter ONLY, lore filter '角色A' remains active
		// Under 'all types' AND '角色A': matches '主线甲' (day 1) and '日常丙' (day 3)
		getTypeButton('common.all-types').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(2);
		expect(rendered[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('主线甲');
		expect(rendered[1].querySelector('.wn-timeline-desc-text')?.textContent).toBe('日常丙');

		// 5. Deselect / toggle '主线' test:
		// First select 主线 and 支线 again
		getTypeButton('主线').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		getTypeButton('支线').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		// Now clear lore to All
		getFilterButton('.wn-timeline-view-lore-filter-row', 'common.all-lore').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		// Now toggle off 主线 -> only 支线 remains
		getTypeButton('主线').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(1);
		expect(rendered[0].querySelector('.wn-timeline-desc-text')?.textContent).toBe('支线乙');

		getTypeButton('支线').click();
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(view.containerEl.querySelectorAll('.wn-timeline-item')).toHaveLength(3);
		expect(getTypeButton('common.all-types').getAttribute('aria-pressed')).toBe('true');
	});

	it('clears type and lore filter selections on folder change', async () => {
		parsedEntries = [
			{ time: '第一天', type: '主线', description: '甲', chapter: '', rawBlock: '', items: [] }
		];
		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		// Set selections
		(view as unknown as { selectedTypes: Set<string>; selectedLores: Set<string> }).selectedTypes = new Set(['主线']);
		(view as unknown as { selectedLores: Set<string> }).selectedLores = new Set(['角色A']);

		// Trigger folder change
		await (view as unknown as { onFolderChange: () => Promise<void> }).onFolderChange();

		expect((view as unknown as { selectedTypes: Set<string> }).selectedTypes.size).toBe(0);
		expect((view as unknown as { selectedLores: Set<string> }).selectedLores.size).toBe(0);
	});

	it('preserves correct source indices for edit and delete on same-name nodes with reversed order and combined filters', async () => {
		parsedEntries = [
			{
				time: '同一个时间',
				type: '主线',
				description: '第一条原始事件',
				chapter: '',
				rawBlock: '',
				lores: ['角色A'],
				items: [{ description: '第一条原始事件', chapter: '' }]
			},
			{
				time: '同一个时间',
				type: '支线',
				description: '第二条原始事件',
				chapter: '',
				rawBlock: '',
				lores: ['角色B'],
				items: [{ description: '第二条原始事件', chapter: '' }]
			},
			{
				time: '同一个时间',
				type: '主线',
				description: '第三条原始事件',
				chapter: '',
				rawBlock: '',
				lores: ['角色A'],
				items: [{ description: '第三条原始事件', chapter: '' }]
			}
		];

		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		// Select both types, then combine with lore A to retain source indices 0 and 2.
		const typeRow = view.containerEl.querySelector('.wn-timeline-view-type-filter-row');
		const mainBtn = Array.from(typeRow?.querySelectorAll('.wn-timeline-filter-btn') || []).find(b => b.textContent === '主线');
		(mainBtn as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));
		const subBtn = Array.from(view.containerEl.querySelector('.wn-timeline-view-type-filter-row')?.querySelectorAll('.wn-timeline-filter-btn') || []).find(b => b.textContent === '支线');
		(subBtn as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));
		const loreBtn = Array.from(view.containerEl.querySelector('.wn-timeline-view-lore-filter-row')?.querySelectorAll('.wn-timeline-filter-btn') || []).find(b => b.textContent === '角色A');
		(loreBtn as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));

		// Switch to descending sort: items order becomes index 2 then index 0
		const sortToggle = view.containerEl.querySelector('.wn-timeline-sort-toggle') as HTMLElement;
		sortToggle.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		const rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(2);
		// First rendered in descending is index 2 ("第三条原始事件")
		expect(rendered[0].getAttribute('data-index')).toBe('2');
		expect(rendered[1].getAttribute('data-index')).toBe('0');

		// Click edit on the second rendered item (which is index 0 in parsedEntries)
		const editBtns = view.containerEl.querySelectorAll('.wn-timeline-action-btn');
		const editButtons = Array.from(editBtns).filter(b => b.textContent === 'common.edit');
		expect(editButtons).toHaveLength(2);
		(editButtons[1] as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));
		expect((view as unknown as { editingIndex: number }).editingIndex).toBe(0);

		// Click delete on the first rendered item (which is index 2 in parsedEntries)
		const deleteBtns = view.containerEl.querySelectorAll('.timeline-delete-btn');
		(deleteBtns[0] as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(mockPlugin.timelineManager.deleteEntry).toHaveBeenCalledWith(2, '', expect.anything());
	});

	it('supports selecting an actual custom type named "all"', async () => {
		parsedEntries = [
			{ time: 'Day 1', type: 'Main', description: 'Main desc', chapter: '', rawBlock: '', items: [] },
			{ time: 'Day 2', type: 'all', description: 'Actual all type desc', chapter: '', rawBlock: '', items: [] }
		];
		const leaf = { app: mockApp } as unknown as WorkspaceLeaf;
		const view = new TimelineView(leaf, mockPlugin);
		await view.renderFromContent('# 时间线\n');

		const typeRow = view.containerEl.querySelector('.wn-timeline-view-type-filter-row');
		const customAllBtn = Array.from(typeRow?.querySelectorAll('.wn-timeline-filter-btn') || []).find(b => b.textContent === 'all');
		expect(customAllBtn).toBeDefined();

		(customAllBtn as HTMLElement).click();
		await new Promise(resolve => setTimeout(resolve, 10));

		const rendered = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(rendered).toHaveLength(1);
		expect(rendered[0].querySelector('.wn-timeline-time')?.textContent).toBe('Day 2');
	});
});
