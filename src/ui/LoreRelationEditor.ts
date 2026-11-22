import { FuzzySuggestModal, Notice, setTooltip, type App, type FuzzyMatch, type Setting } from 'obsidian';
import { getLoreEntryIdentity, type LoreEntry, type LoreRelationItem } from '../services/CharacterManager';
import { formatLoreRelationTarget, loreRelationLinkName } from '../services/LoreRelations';
import { t } from '../i18n';

export class LoreRelationTargetPicker extends FuzzySuggestModal<LoreEntry> {
	private readonly entries: LoreEntry[];
	private readonly names = new Map<string, number>();
	private readonly destinations = new Map<string, number>();

	constructor(app: App, entries: readonly LoreEntry[], private readonly choose: (entry: LoreEntry) => void, source?: LoreEntry) {
		super(app);
		const sourceId = source && getLoreEntryIdentity(source);
		this.entries = entries.filter(entry => getLoreEntryIdentity(entry) !== sourceId);
		for (const entry of entries) {
			this.names.set(entry.heading, (this.names.get(entry.heading) ?? 0) + 1);
			const destination = formatLoreRelationTarget(entry, undefined, '');
			this.destinations.set(destination, (this.destinations.get(destination) ?? 0) + 1);
		}
		this.setPlaceholder(t('modal.lore-search-target'));
	}

	getItems(): LoreEntry[] { return this.entries; }

	getItemText(entry: LoreEntry): string {
		return [entry.heading, ...entry.section?.parent?.path ?? [], entry.file.path].join(' ');
	}

	override renderSuggestion(match: FuzzyMatch<LoreEntry>, el: HTMLElement): void {
		const entry = match.item;
		el.createDiv({ text: entry.heading });
		if ((this.names.get(entry.heading) ?? 0) > 1) {
			el.createDiv({ cls: 'suggestion-note', text: [entry.file.path, entry.section?.parent?.path.join(' › ')].filter(Boolean).join(' · ') });
		}
	}

	onChooseItem(entry: LoreEntry): void {
		if ((this.destinations.get(formatLoreRelationTarget(entry, undefined, '')) ?? 0) > 1) {
			new Notice(t('notice.lore-relation-ambiguous'));
			return;
		}
		this.choose(entry);
	}
}

export function renderLoreRelationEditor(app: App, add: Setting, container: HTMLElement, entries: readonly LoreEntry[],
	relations: LoreRelationItem[], source?: LoreEntry): void {
	const render = () => {
		container.empty();
		for (const relation of relations) {
			const row = container.createDiv('wn-lore-relation-row');
			const label = row.createEl('input', { type: 'text', cls: 'wn-lore-relation-label-input', value: relation.label,
				placeholder: t('modal.lore-relation-label-placeholder'), attr: { 'aria-label': t('modal.lore-relation-label-placeholder') } });
			label.addEventListener('input', () => { relation.label = label.value; });
			row.createSpan({ cls: 'wn-lore-relation-colon', text: '→', attr: { 'aria-hidden': 'true' } });
			const target = row.createEl('button', { cls: 'wn-lore-relation-picker-btn', attr: { type: 'button' } });
			const updateTarget = () => {
				const display = loreRelationLinkName(relation.rawTarget ?? relation.target);
				target.setText(display || t('modal.lore-search-target'));
				target.setAttribute('aria-label', `${t('modal.lore-search-target')}${display ? ` · ${display}` : ''}`);
			};
			updateTarget();
			target.addEventListener('click', () => {
				new LoreRelationTargetPicker(app, entries, entry => {
					relation.target = entry.heading;
					relation.rawTarget = formatLoreRelationTarget(entry, source?.file.path);
					updateTarget();
				}, source).open();
			});
			const remove = row.createEl('button', { cls: 'wn-lore-relation-remove-btn', text: '✕',
				attr: { type: 'button', 'aria-label': t('modal.lore-remove-relation') } });
			setTooltip(remove, t('modal.lore-remove-relation'));
			remove.addEventListener('click', () => {
				relations.splice(relations.indexOf(relation), 1);
				render();
			});
		}
	};
	add.addButton(button => button.setButtonText(t('modal.lore-add-relation')).onClick(() => {
		relations.push({ label: '', target: '' });
		render();
		container.querySelector<HTMLInputElement>('.wn-lore-relation-row:last-child input')?.focus();
	}));
	render();
}
