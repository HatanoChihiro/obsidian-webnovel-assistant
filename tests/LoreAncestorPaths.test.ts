import { describe, expect, it } from 'vitest';
import { buildLoreOutline, scanLoreHeadings } from '../src/services/LoreOutline';
import { getLoreAncestorLayoutKey } from '../src/editor/LoreAncestorPaths';
import { renderLoreAncestorRow } from '../src/ui/components/LoreAncestorRow';
import { MockElement } from './mocks/MockElement';

describe('persistent lore ancestor paths', () => {
	const key = (source: string) => {
		const lines = source.split('\n');
		return getLoreAncestorLayoutKey(lines, buildLoreOutline(scanLoreHeadings(lines), lines.length));
	};

	it('updates when a new heading, changed line position or cross-note parent changes', () => {
		const before = '# 港务志\n## 北港\n正文。\n###### 关系\n**上级词条**：[[浮标台#外港]]';
		expect(key(before.replace('正文。', '正文更新。'))).toBe(key(before));
		expect(key(before.replace('正文。', '正文更新。\n### 码头'))).not.toBe(key(before));
		expect(key(before.replace('## 北港', '\n## 北港'))).not.toBe(key(before));
		expect(key(before.replace('#外港', '#南港'))).not.toBe(key(before));
	});

	it('hides the folded path behind one unlabeled dot and toggles it without replacing the row', () => {
		const row = new MockElement();
		renderLoreAncestorRow(row as unknown as HTMLElement, ['港务志', '北港'], true);
		const dot = row.querySelector('.wn-lore-ancestor-dot')!;
		const path = row.querySelector('.wn-lore-ancestor-text')! as MockElement & { hidden: boolean };
		expect(row.children).toHaveLength(2);
		expect(dot.textContent).toBe('');
		expect(path.textContent).toBe('港务志 › 北港');
		expect(path.hidden).toBe(true);
		dot.dispatchEvent('click');
		expect(path.hidden).toBe(false);
		expect(dot.getAttribute('aria-expanded')).toBe('true');
		dot.dispatchEvent('click');
		expect(path.hidden).toBe(true);
		expect(dot.getAttribute('aria-expanded')).toBe('false');
	});
});
