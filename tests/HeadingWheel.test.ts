import { describe, it, expect } from 'vitest';
import { findHeadingTarget } from '../src/ui/HeadingWheelModal';

describe('heading wheel editor targets', () => {
	it('captures only the heading prefix on the active line', () => {
		expect(findHeadingTarget('# 上级\n  ###\t旧港 ###\n正文', 1)).toEqual({
			line: 1, endLine: 1, prefixLength: 6, text: '  ###\t旧港 ###', level: 3,
		});
		expect(findHeadingTarget('# 上级\n甲号码头', 1)).toMatchObject({ line: 1, prefixLength: 0, text: '甲号码头' });
	});

	it('covers a Setext heading and its underline in a single edit', () => {
		const text = '上级\n=====\n\n旧港\n---\n正文';
		for (const line of [3, 4]) {
			expect(findHeadingTarget(text, line)).toMatchObject({ line: 3, endLine: 4, text: '旧港', level: 2 });
		}
	});

	it('keeps YAML and fenced or indented code out of the heading command', () => {
		const text = '---\naliases: [旧港]\n---\n~~~md\n### 示例\n~~~\n      代码\n东港';
		for (const line of [0, 1, 2, 3, 4, 5, 6]) expect(findHeadingTarget(text, line)).toBeUndefined();
		expect(findHeadingTarget(text, 7)).toMatchObject({ line: 7, text: '东港' });
	});
});
