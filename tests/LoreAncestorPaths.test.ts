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

	it('hides both paths behind one unlabeled dot and toggles them together', () => {
		const row = new MockElement();
		renderLoreAncestorRow(row as unknown as HTMLElement, [['港务志', '北港'], ['潮历仪器', '回摆潮钟']], true);
		const dot = row.querySelector('.wn-lore-ancestor-dot')!;
		const paths = row.querySelector('.wn-lore-ancestor-list')! as MockElement & { hidden: boolean };
		expect(row.children).toHaveLength(2);
		expect(dot.textContent).toBe('');
		expect(paths.children.map(path => path.textContent)).toEqual(['港务志 › 北港', '潮历仪器 › 回摆潮钟']);
		expect(paths.hidden).toBe(true);
		dot.dispatchEvent('click');
		expect(paths.hidden).toBe(false);
		expect(dot.getAttribute('aria-expanded')).toBe('true');
		dot.dispatchEvent('click');
		expect(paths.hidden).toBe(true);
		expect(dot.getAttribute('aria-expanded')).toBe('false');
	});
});
