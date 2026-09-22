import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { MockElement } from './mocks/MockElement';
import { TimelineFormComponent, type TimelineFormContext } from '../src/ui/components/TimelineFormComponent';
import { TimelineAddModal } from '../src/ui/TimelineAddModal';
import { ForeshadowingInputModal, type ForeshadowingInputModalPlugin } from '../src/ui/ForeshadowingModal';

describe('QuickMergeSelectors', () => {
	describe('TimelineFormComponent existing node selector', () => {
		it('should render deduplicated existing nodes in selector with blank default', () => {
			const container = new MockElement('container');
			const onSubmit = vi.fn();
			const onCancel = vi.fn();

			const component = new TimelineFormComponent({
				container: container as unknown as HTMLElement,
				app: { vault: { getAbstractFileByPath: () => null } } as unknown as App,
				context: {
					settings: {
						timeline: { defaultTypes: ['主线', '支线'] }
					},
					getVaultMarkdownFiles: () => []
				} as unknown as TimelineFormContext,
				folderPath: 'Book 1',
				initialEntry: {
					description: 'Selected manuscript quote',
					chapter: 'Chapter 1',
					origin: 'Selected manuscript quote'
				},
				typeOptions: ['主线'],
				existingNodes: [' Day 1 ', 'Day 2', 'Day 1', '   ', 'Day 3'],
				onCancel,
				onSubmit
			});

			component.render();

			const nodeSelect = container.querySelector('.wn-timeline-node-select');
			expect(nodeSelect).not.toBeNull();

			// Options: blank default + Day 1 + Day 2 + Day 3
			const options = nodeSelect!.children;
			expect(options.length).toBe(4);
			expect(options[0].value).toBe('');
			expect(options[1].value).toBe('Day 1');
			expect(options[2].value).toBe('Day 2');
			expect(options[3].value).toBe('Day 3');

			// Find time input
			const inputs = container.querySelectorAll('.wn-timeline-form-input');
			const timeInput = inputs.find(el => el.type === 'text');
			expect(timeInput).toBeDefined();

			// Selecting Day 2 should fill timeInput
			nodeSelect!.value = 'Day 2';
			nodeSelect!.dispatchEvent('change');
			expect(timeInput!.value).toBe('Day 2');

			// Selecting blank should clear timeInput
			nodeSelect!.value = '';
			nodeSelect!.dispatchEvent('change');
			expect(timeInput!.value).toBe('');

			// Typing into timeInput syncs selector if exact match
			timeInput!.value = 'Day 3';
			timeInput!.dispatchEvent('input');
			expect(nodeSelect!.value).toBe('Day 3');

			// Typing something else resets selector to blank
			timeInput!.value = 'New Custom Node';
			timeInput!.dispatchEvent('input');
			expect(nodeSelect!.value).toBe('');
		});

		it('should not render selector when existingNodes is empty or omitted', () => {
			const container = new MockElement('container');
			const component = new TimelineFormComponent({
				container: container as unknown as HTMLElement,
				app: { vault: { getAbstractFileByPath: () => null } } as unknown as App,
				context: { settings: {}, getVaultMarkdownFiles: () => [] } as unknown as TimelineFormContext,
				folderPath: 'Book 1',
				typeOptions: [],
				onCancel: vi.fn(),
				onSubmit: vi.fn()
			});

			component.render();
			expect(container.querySelector('.wn-timeline-node-select')).toBeNull();
		});
	});

	describe('TimelineAddModal passing existingNodes', () => {
		it('should pass existingNodes through to TimelineFormComponent', () => {
			const app = {} as unknown as App;
			const context = { settings: {} } as unknown as TimelineFormContext;
			const modal = new TimelineAddModal(
				app,
				context,
				'Initial Text',
				'Chapter 1',
				'Book 1',
				vi.fn(),
				false,
				['主线'],
				'Initial Text',
				'Title',
				['Day 1', 'Day 2']
			);

			expect((modal as unknown as { existingNodes: string[] }).existingNodes).toEqual(['Day 1', 'Day 2']);
		});
	});

	describe('ForeshadowingInputModal existing descriptions selector', () => {
		it('should deduplicate existing descriptions, populate dropdown, fill description on selection, and sync typing', () => {
			const app = {} as unknown as App;
			const plugin: ForeshadowingInputModalPlugin = {
				settings: {
					foreshadowing: { defaultTags: ['人物', '线索'] }
				}
			};
			const onSubmit = vi.fn();
			const modal = new ForeshadowingInputModal(
				app,
				plugin,
				'Chapter 1',
				'Selected content text',
				onSubmit,
				['ExtraTag'],
				[' 宝库钥匙下落 ', '神秘老人身份', '宝库钥匙下落', '  ']
			);
			const contentEl = new MockElement('modal-content');
			(modal as unknown as { contentEl: MockElement }).contentEl = contentEl;

			modal.open();

			const descSelect = contentEl.querySelector('.wn-foreshadowing-desc-select');
			expect(descSelect).not.toBeNull();

			// Options: blank default + 宝库钥匙下落 + 神秘老人身份
			expect(descSelect!.children.length).toBe(3);
			expect(descSelect!.children[0].value).toBe('');
			expect(descSelect!.children[1].value).toBe('宝库钥匙下落');
			expect(descSelect!.children[2].value).toBe('神秘老人身份');

			const descriptionEl = (modal as unknown as { descriptionEl: MockElement }).descriptionEl;
			expect(descriptionEl).toBeDefined();
			expect(descriptionEl.value).toBe('');

			// Selecting '宝库钥匙下落' fills descriptionEl
			descSelect!.value = '宝库钥匙下落';
			descSelect!.dispatchEvent('change');
			expect(descriptionEl.value).toBe('宝库钥匙下落');

			// Selecting blank clears descriptionEl
			descSelect!.value = '';
			descSelect!.dispatchEvent('change');
			expect(descriptionEl.value).toBe('');

			// Typing existing description in textarea syncs descSelect
			descriptionEl.value = '神秘老人身份';
			descriptionEl.dispatchEvent('input');
			expect(descSelect!.value).toBe('神秘老人身份');

			// Typing non-matching description in textarea resets descSelect to blank
			descriptionEl.value = '全新自定义伏笔说明';
			descriptionEl.dispatchEvent('input');
			expect(descSelect!.value).toBe('');

			// Select again and submit
			descSelect!.value = '宝库钥匙下落';
			descSelect!.dispatchEvent('change');
			(modal as unknown as { submit: () => void }).submit();
			expect(onSubmit).toHaveBeenCalledWith('宝库钥匙下落', []);
		});

		it('should not throw and render normally when existingDescriptions is empty', () => {
			const app = {} as unknown as App;
			const plugin: ForeshadowingInputModalPlugin = {
				settings: {
					foreshadowing: { defaultTags: [] }
				}
			};
			const onSubmit = vi.fn();
			const modal = new ForeshadowingInputModal(
				app,
				plugin,
				'Chapter 1',
				'Selected content text',
				onSubmit,
				[]
			);
			const contentEl = new MockElement('modal-content');
			(modal as unknown as { contentEl: MockElement }).contentEl = contentEl;

			modal.open();
			expect(contentEl.querySelector('.wn-foreshadowing-desc-select')).toBeNull();
			const descriptionEl = (modal as unknown as { descriptionEl: MockElement }).descriptionEl;
			expect(descriptionEl).toBeDefined();
		});
	});
});
