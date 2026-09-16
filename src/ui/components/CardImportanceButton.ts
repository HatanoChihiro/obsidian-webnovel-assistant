import { setIcon } from 'obsidian';
import { t } from '../../i18n';

export interface CardImportanceButtonOptions {
	container: HTMLElement;
	isImportant: boolean;
	onToggle: (newImportant: boolean) => Promise<void> | void;
	cardEl?: HTMLElement;
}

export function createCardImportanceButton(options: CardImportanceButtonOptions): HTMLButtonElement {
	const { container, isImportant: initialImportant, onToggle, cardEl } = options;
	let currentImportant = initialImportant;

	const btn = container.createEl('button', {
		cls: `clickable-icon wn-card-importance-btn ${currentImportant ? 'is-important' : ''}`,
		attr: {
			type: 'button',
			'aria-pressed': currentImportant ? 'true' : 'false',
			'aria-label': currentImportant ? t('common.unmark-as-important') : t('common.mark-as-important'),
			draggable: 'false'
		}
	});

	const icon = btn.createSpan({ cls: 'wn-card-importance-icon' });
	icon.setAttribute('aria-hidden', 'true');
	setIcon(icon, 'star');

	const updateUI = (important: boolean) => {
		currentImportant = important;
		if (important) {
			btn.classList.add('is-important');
		} else {
			btn.classList.remove('is-important');
		}
		btn.setAttribute('aria-pressed', important ? 'true' : 'false');
		const label = important ? t('common.unmark-as-important') : t('common.mark-as-important');
		btn.setAttribute('aria-label', label);
		if (cardEl) {
			if (important) {
				cardEl.classList.add('is-important');
				cardEl.classList.add('wn-card-is-important');
			} else {
				cardEl.classList.remove('is-important');
				cardEl.classList.remove('wn-card-is-important');
			}
		}
	};
	updateUI(currentImportant);

	// Prevent dragging or text selection from starting on the star button
	btn.addEventListener('dragstart', (e) => {
		e.stopPropagation();
		e.preventDefault();
	});

	btn.addEventListener('mousedown', (e) => {
		e.stopPropagation();
	});

	let isToggling = false;
	btn.onclick = async (e) => {
		e.stopPropagation();
		e.preventDefault();
		if (isToggling) return;
		isToggling = true;
		const nextState = !currentImportant;
		updateUI(nextState);
		try {
			await onToggle(nextState);
		} catch (err) {
			updateUI(!nextState);
			console.error('[CardImportanceButton] Failed to toggle importance:', err);
		} finally {
			isToggling = false;
		}
	};

	return btn;
}
