import { describe, it, expect, beforeEach } from 'vitest';
import { ChapterMergeSelection } from '../src/services/ChapterMergeSelection';
import type { ChapterMergeItem } from '../src/services/ChapterMergeManager';
import { TFile } from 'obsidian';

function createMockItem(path: string, title: string, volumeName: string = ''): ChapterMergeItem {
	return {
		file: Object.assign(new TFile(), { path, basename: title, name: `${title}.md` }),
		volumeName,
		title,
		frontmatter: '',
		originalBody: `body of ${title}`,
		currentBody: `body of ${title}`,
		annotation: '',
		originalAnnotation: '',
		isModified: false
	};
}

describe('ChapterMergeSelection', () => {
	let items: ChapterMergeItem[];
	let selection: ChapterMergeSelection;

	beforeEach(() => {
		items = [
			createMockItem('Novel/Vol1/Ch1.md', '第一章', '第一卷'),
			createMockItem('Novel/Vol1/Ch2.md', '第二章', '第一卷'),
			createMockItem('Novel/Vol1/Ch3.md', '第三章', '第一卷'),
			createMockItem('Novel/Vol2/Ch1.md', '第一章', '第二卷'),
			createMockItem('Novel/Vol2/Ch2.md', '第二章', '第二卷')
		];
		selection = new ChapterMergeSelection(items);
	});

	it('selects all loaded chapters by default upon initialization', () => {
		expect(selection.getSelectedCount()).toBe(5);
		for (const item of items) {
			expect(selection.isSelected(item.file.path)).toBe(true);
		}
	});

	it('distinguishes duplicate basenames across volumes by full file path', () => {
		// Both Vol1/Ch1 and Vol2/Ch1 have title '第一章'
		selection.handleCheckboxClick('Novel/Vol1/Ch1.md', false, items, false);
		expect(selection.isSelected('Novel/Vol1/Ch1.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(true);
		expect(selection.getSelectedCount()).toBe(4);
	});

	it('maintains original source order when returning selected items, never click order', () => {
		selection.deselectAll(items);
		// Click in reverse order: Ch3 then Ch1 then Ch2
		selection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, true);
		selection.handleCheckboxClick('Novel/Vol1/Ch1.md', false, items, true);
		selection.handleCheckboxClick('Novel/Vol1/Ch2.md', false, items, true);

		const selected = selection.getSelectedItems(items);
		expect(selected.map(i => i.file.path)).toEqual([
			'Novel/Vol1/Ch1.md',
			'Novel/Vol1/Ch2.md',
			'Novel/Vol1/Ch3.md'
		]);
	});

	it('supports forward Shift range selection (inclusive) applying clicked checkbox new state', () => {
		selection.deselectAll(items);

		// Click Ch1 (index 0)
		selection.handleCheckboxClick('Novel/Vol1/Ch1.md', false, items, true);

		// Shift-click Ch3 (index 2) with new checked state = true
		selection.handleCheckboxClick('Novel/Vol1/Ch3.md', true, items, true);

		// Ch1, Ch2, Ch3 should all be selected
		expect(selection.isSelected('Novel/Vol1/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol1/Ch2.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol1/Ch3.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol2/Ch2.md')).toBe(false);

		// Successive Shift-click to Ch5 should expand from Ch1 (anchor remains Ch1)
		selection.handleCheckboxClick('Novel/Vol2/Ch2.md', true, items, true);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol2/Ch2.md')).toBe(true);
		expect(selection.getSelectedCount()).toBe(5);
	});

	it('supports reverse Shift range selection (inclusive)', () => {
		selection.deselectAll(items);

		// Individually click Ch3 (index 2)
		selection.handleCheckboxClick('Novel/Vol1/Ch3.md', false, items, true);

		// Reverse Shift-click Ch1 (index 0)
		selection.handleCheckboxClick('Novel/Vol1/Ch1.md', true, items, true);

		expect(selection.isSelected('Novel/Vol1/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol1/Ch2.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol1/Ch3.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(false);
	});

	it('supports Shift range deselect (inclusive)', () => {
		// All are currently selected
		// Individually click Ch2 (index 1) to uncheck
		selection.handleCheckboxClick('Novel/Vol1/Ch2.md', false, items, false);

		// Shift-click Ch4 (index 3: Novel/Vol2/Ch1.md) with false
		selection.handleCheckboxClick('Novel/Vol2/Ch1.md', true, items, false);

		// Ch2, Ch3, Vol2/Ch1 should now be deselected
		expect(selection.isSelected('Novel/Vol1/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol1/Ch2.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol1/Ch3.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol2/Ch2.md')).toBe(true);
	});

	it('falls back to single click when anchor is not currently visible in visibleItems', () => {
		selection.deselectAll(items);

		// Individually click Ch1
		selection.handleCheckboxClick('Novel/Vol1/Ch1.md', false, items, true);

		// Now filter so only Vol2 items are visible (Ch1 is hidden)
		const visible = items.filter(i => i.volumeName === '第二卷');

		// Shift-click Vol2/Ch2
		selection.handleCheckboxClick('Novel/Vol2/Ch2.md', true, visible, true);

		// Because Ch1 is not in visible, it acts as a single click on Vol2/Ch2 and establishes Vol2/Ch2 as new anchor
		expect(selection.isSelected('Novel/Vol2/Ch2.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(false);

		// Next Shift-click on Vol2/Ch1 in visible selects range [Vol2/Ch1..Vol2/Ch2]
		selection.handleCheckboxClick('Novel/Vol2/Ch1.md', true, visible, true);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol2/Ch2.md')).toBe(true);
	});

	it('resets anchor on search filter changes and bulk operations', () => {
		selection.deselectAll(items);

		// Click Ch1
		selection.handleCheckboxClick('Novel/Vol1/Ch1.md', false, items, true);

		// Reset on filter change
		selection.resetAnchor();

		// Next Shift-click on Ch3 must NOT select range [Ch1..Ch3], because anchor was reset
		selection.handleCheckboxClick('Novel/Vol1/Ch3.md', true, items, true);
		expect(selection.isSelected('Novel/Vol1/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol1/Ch2.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol1/Ch3.md')).toBe(true);

		// Reset on bulk operation
		selection.selectAll(items);
		// Click Ch2 with false
		selection.handleCheckboxClick('Novel/Vol1/Ch2.md', false, items, false);
		// Deselect all (bulk operation resets anchor)
		selection.deselectAll(items);

		// Next Shift-click on Ch4 acts as single click
		selection.handleCheckboxClick('Novel/Vol2/Ch1.md', true, items, true);
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(true);
		expect(selection.getSelectedCount()).toBe(1);
	});

	it('applies bulk operations only to current filtered items while preserving hidden choices', () => {
		// All start selected
		// Filter to Vol1 only
		const vol1Items = items.filter(i => i.volumeName === '第一卷');
		// Bulk deselect Vol1
		selection.deselectAll(vol1Items);

		// Vol1 items should be deselected
		expect(selection.isSelected('Novel/Vol1/Ch1.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol1/Ch2.md')).toBe(false);
		expect(selection.isSelected('Novel/Vol1/Ch3.md')).toBe(false);

		// Hidden Vol2 items should SURVIVE and remain selected
		expect(selection.isSelected('Novel/Vol2/Ch1.md')).toBe(true);
		expect(selection.isSelected('Novel/Vol2/Ch2.md')).toBe(true);
		expect(selection.getSelectedCount()).toBe(2);

		// Bulk select Vol1 again
		selection.selectAll(vol1Items);
		expect(selection.getSelectedCount()).toBe(5);
	});
});
