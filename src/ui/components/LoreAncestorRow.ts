import { t } from '../../i18n';
import { LORE_ANCESTOR_PATH_DISPLAY_LIMIT } from '../../services/LoreOutlineGraph';

export function renderLoreAncestorRow(row: HTMLElement, paths: readonly (readonly string[])[], folded: boolean,
	openAncestor?: (path: number, index: number) => void, remeasure?: () => void): void {
	row.addClass('wn-lore-ancestor-row');
	const label = t('lore.ancestor-preview');
	const dot = folded ? row.createEl('button', { cls: 'wn-lore-ancestor-dot', attr: { type: 'button', 'aria-label': label, title: label } }) : undefined;
	const list = row.createDiv('wn-lore-ancestor-list');
	paths.slice(0, LORE_ANCESTOR_PATH_DISPLAY_LIMIT).forEach((names, pathIndex) => {
		const path = list.createDiv('wn-lore-ancestor-text');
		path.title = names.join(' › ');
		if (!openAncestor) {
			path.textContent = path.title;
			return;
		}
		names.forEach((name, index) => {
			if (index) path.appendText(' › ');
			const button = path.createEl('button', { text: name, cls: 'wn-lore-ancestor-link', attr: { type: 'button' } });
			button.addEventListener('click', () => openAncestor(pathIndex, index));
		});
	});
	if (paths.length > LORE_ANCESTOR_PATH_DISPLAY_LIMIT) {
		list.createDiv({ cls: 'wn-lore-ancestor-text', text: t('lore.ancestor-path-overflow') });
	}
	if (dot) {
		dot.setAttribute('aria-expanded', 'false');
		list.hidden = true;
		dot.addEventListener('click', () => {
			list.hidden = !list.hidden;
			dot.setAttribute('aria-expanded', String(!list.hidden));
			remeasure?.();
		});
	}
}
