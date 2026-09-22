import { describe, it, expect, vi } from 'vitest';
import { MockElement } from './mocks/MockElement';
import { MultiSelectFilterRow } from '../src/ui/components/MultiSelectFilterRow';

describe('MultiSelectFilterRow', () => {
	it('initializes with all button active when selected is empty', () => {
		const container = new MockElement('container');
		const onChange = vi.fn();
		const row = new MultiSelectFilterRow({
			container: container as unknown as HTMLElement,
			options: ['tag1', 'tag2', 'tag3'],
			allLabel: '全部',
			onChange
		});

		const el = row.getElement() as unknown as MockElement;
		const buttons = el.children as unknown as MockElement[];
		expect(buttons).toHaveLength(4); // All + 3 options

		const allBtn = buttons[0];
		expect(allBtn.getAttribute('aria-pressed')).toBe('true');
		expect(allBtn.hasClass('is-active')).toBe(true);

		const opt1 = buttons[1];
		expect(opt1.getAttribute('aria-pressed')).toBe('false');
		expect(opt1.hasClass('is-active')).toBe(false);
	});

	it('initializes with specified options active when selected is provided', () => {
		const container = new MockElement('container');
		const onChange = vi.fn();
		const row = new MultiSelectFilterRow({
			container: container as unknown as HTMLElement,
			options: [
				{ value: 'tag1', label: '#tag1' },
				{ value: 'tag2', label: '#tag2' }
			],
			selected: new Set(['tag1']),
			allLabel: '全部',
			onChange
		});

		const el = row.getElement() as unknown as MockElement;
		const buttons = el.children as unknown as MockElement[];
		const allBtn = buttons[0];
		const opt1 = buttons[1];
		const opt2 = buttons[2];

		expect(allBtn.getAttribute('aria-pressed')).toBe('false');
		expect(allBtn.hasClass('is-active')).toBe(false);
		expect(opt1.getAttribute('aria-pressed')).toBe('true');
		expect(opt1.hasClass('is-active')).toBe(true);
		expect(opt2.getAttribute('aria-pressed')).toBe('false');
	});

	it('toggles option selection on click and emits updated set', () => {
		const container = new MockElement('container');
		const onChange = vi.fn();
		const row = new MultiSelectFilterRow({
			container: container as unknown as HTMLElement,
			options: ['A', 'B'],
			allLabel: 'All',
			onChange
		});

		const el = row.getElement() as unknown as MockElement;
		const buttons = el.children as unknown as MockElement[];
		const allBtn = buttons[0];
		const optA = buttons[1];
		const optB = buttons[2];

		// Click optA: A selected, all inactive
		optA.click();
		expect(onChange).toHaveBeenLastCalledWith(new Set(['A']));
		expect(allBtn.getAttribute('aria-pressed')).toBe('false');
		expect(optA.getAttribute('aria-pressed')).toBe('true');

		// Click optB: A and B selected
		optB.click();
		expect(onChange).toHaveBeenLastCalledWith(new Set(['A', 'B']));
		expect(optB.getAttribute('aria-pressed')).toBe('true');

		// Click optA again: only B selected
		optA.click();
		expect(onChange).toHaveBeenLastCalledWith(new Set(['B']));
		expect(optA.getAttribute('aria-pressed')).toBe('false');

		// Click allBtn: cleared
		allBtn.click();
		expect(onChange).toHaveBeenLastCalledWith(new Set());
		expect(allBtn.getAttribute('aria-pressed')).toBe('true');
		expect(optB.getAttribute('aria-pressed')).toBe('false');
	});
});
