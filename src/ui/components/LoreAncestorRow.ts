import { t } from '../../i18n';

export function renderLoreAncestorRow(row: HTMLElement, names: readonly string[], folded: boolean,
	openAncestor?: (index: number) => void): void {
	row.addClass('wn-lore-ancestor-row');
	const label = t('lore.ancestor-preview');
	const dot = folded ? row.createEl('button', { cls: 'wn-lore-ancestor-dot', attr: { type: 'button', 'aria-label': label, title: label } }) : undefined;
	const path = row.createSpan({ cls: 'wn-lore-ancestor-text' });
	path.title = names.join(' › ');
	if (openAncestor) {
		names.forEach((name, index) => {
			if (index) path.appendText(' › ');
			const button = path.createEl('button', { text: name, cls: 'wn-lore-ancestor-link', attr: { type: 'button' } });
			button.addEventListener('click', () => openAncestor(index));
		});
	} else {
		path.textContent = path.title;
	}
	if (dot) {
		dot.setAttribute('aria-expanded', 'false');
		path.hidden = true;
		dot.addEventListener('click', () => {
			path.hidden = !path.hidden;
			dot.setAttribute('aria-expanded', String(!path.hidden));
		});
	}
}
