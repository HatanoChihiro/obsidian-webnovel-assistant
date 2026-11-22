import { Modal, type App } from 'obsidian';
import { t } from '../i18n';
import type { ChapterMergeItem } from '../services/ChapterMergeManager';
import type { ChapterMergeSelection } from '../services/ChapterMergeSelection';

interface MergeChoice {
	path: string;
	label: string;
}

/** Search only the already loaded chapter directory; never enumerate the vault. */
export class ChapterMergeDirectoryModal extends Modal {
	constructor(app: App, private choices: MergeChoice[], private choose: (path: string) => void) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal', 'wn-merge-picker-window');
	}

	onOpen(): void {
		this.setTitle(t('merge.directory'));
		const input = this.contentEl.createEl('input', { type: 'search', cls: 'wn-merge-picker-search' });
		input.placeholder = t('merge.search-placeholder');
		input.setAttribute('aria-label', t('merge.search-placeholder'));
		const status = this.contentEl.createDiv({ cls: 'wn-merge-picker-hint' });
		status.setAttribute('role', 'status');
		const results = this.contentEl.createDiv({ cls: 'wn-merge-picker-results' });
		const render = (): void => {
			const query = input.value.trim().toLocaleLowerCase();
			const matches = this.choices.filter(choice => choice.label.toLocaleLowerCase().includes(query));
			results.empty();
			status.setText(t('merge.search-results', { shown: String(Math.min(40, matches.length)), total: String(matches.length) }));
			for (const choice of matches.slice(0, 40)) {
				const button = results.createEl('button', { text: choice.label, cls: 'wn-merge-picker-result' });
				button.onclick = () => {
					this.close();
					this.choose(choice.path);
				};
			}
		};
		input.oninput = render;
		render();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function mergeChapterChoices(items: ChapterMergeItem[]): MergeChoice[] {
	return items.map((item, index) => ({ path: item.file.path, label: `${index + 1}. ${item.file.path}` }));
}

export class ChapterMergeSelectionModal extends Modal {
	private child: ChapterMergeDirectoryModal | null = null;
	private active = false;

	constructor(
		app: App,
		private items: ChapterMergeItem[],
		private selection: ChapterMergeSelection,
		private changed: () => void
	) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal', 'wn-merge-picker-window');
	}

	onOpen(): void {
		this.active = true;
		this.setTitle(t('merge.range'));
		this.contentEl.createDiv({ text: t('merge.range-hint'), cls: 'wn-merge-picker-hint' });
		const choices = mergeChapterChoices(this.items);
		let start = choices[0];
		let end = choices[choices.length - 1];
		const startLabel = this.contentEl.createEl('label', { text: t('merge.range-start') });
		const startButton = startLabel.createEl('button', { text: start?.label ?? '', cls: 'wn-merge-picker-result' });
		const endLabel = this.contentEl.createEl('label', { text: t('merge.range-end') });
		const endButton = endLabel.createEl('button', { text: end?.label ?? '', cls: 'wn-merge-picker-result' });
		const pick = (isStart: boolean): void => {
			this.child = new ChapterMergeDirectoryModal(this.app, choices, path => {
				if (!this.active) return;
				const chosen = choices.find(choice => choice.path === path);
				if (!chosen) return;
				if (isStart) { start = chosen; startButton.setText(chosen.label); }
				else { end = chosen; endButton.setText(chosen.label); }
			});
			this.child.open();
		};
		startButton.onclick = () => pick(true);
		endButton.onclick = () => pick(false);
		const actions = this.contentEl.createDiv({ cls: 'wn-merge-picker-actions' });
		for (const checked of [true, false]) {
			const button = actions.createEl('button', { text: t(checked ? 'merge.range-select' : 'merge.range-deselect') });
			button.disabled = !start || !end;
			button.onclick = () => {
				if (start && end && this.selection.setRange(start.path, end.path, this.items, checked)) {
					this.changed();
					this.close();
				}
			};
		}
		const volumes = new Map<string, MergeChoice>();
		for (const item of this.items) {
			const parent = item.file.parent;
			if (parent) volumes.set(parent.path, { path: parent.path, label: parent.path });
		}
		for (const checked of [true, false]) {
			const button = actions.createEl('button', { text: t(checked ? 'merge.volume-select' : 'merge.volume-deselect') });
			button.disabled = volumes.size === 0;
			button.onclick = () => {
				this.child = new ChapterMergeDirectoryModal(this.app, [...volumes.values()], path => {
					if (!this.active) return;
					const items = this.items.filter(item => item.file.parent?.path === path);
					if (checked) this.selection.selectAll(items);
					else this.selection.deselectAll(items);
					this.changed();
					this.close();
				});
				this.child.open();
			};
		}
	}

	onClose(): void {
		this.active = false;
		this.child?.close();
		this.child = null;
		this.contentEl.empty();
	}
}
