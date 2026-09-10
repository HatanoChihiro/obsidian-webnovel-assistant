import { MockElement } from './mocks/MockElement';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineView, type TimelineViewPlugin } from '../src/ui/TimelineView';
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
		setIcon: vi.fn()
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
	let parsedEntries: Array<{ time: string; description: string; chapter: string; type: string }>;

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
			{ time: '第一年', description: '第一年事件', chapter: '', type: '主线' },
			{ time: '第二年', description: '第二年事件', chapter: '', type: '主线' },
			{ time: '第三年', description: '第三年事件', chapter: '', type: '支线' }
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
			}
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
		expect(mockApp.workspace.trigger).toHaveBeenCalledWith('timeline-order-changed', true);

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

		expect(mockPlugin.timelineManager.deleteEntry).toHaveBeenCalledWith(2, '');

		// Click toggle again to switch back to ascending
		const newSortToggle = view.containerEl.querySelector('.wn-timeline-sort-toggle') as HTMLElement | null;
		newSortToggle?.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		expect((view as unknown as { isDescending: boolean }).isDescending).toBe(false);
		expect(mockApp.workspace.trigger).toHaveBeenCalledWith('timeline-order-changed', false);

		// Items in ascending mode must be draggable with drag handle
		const ascItems = view.containerEl.querySelectorAll('.wn-timeline-item');
		expect(ascItems[0].getAttribute('draggable')).toBe('true');
		expect(view.containerEl.querySelector('.wn-timeline-drag-handle')).not.toBeNull();
	});
});
