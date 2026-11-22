import { Modal, Notice, Setting, type App, type Editor, type MarkdownView } from 'obsidian';
import { buildLoreOutline, getLoreFrontmatterEnd, scanLoreHeadings } from '../services/LoreOutline';
import { formatInlineLoreRelation, formatLoreRelationTarget } from '../services/LoreRelations';
import type { LoreEntry } from '../services/CharacterManager';
import { LoreRelationTargetPicker } from './LoreRelationEditor';
import { t } from '../i18n';

export class LoreQuickRelationModal extends Modal {
	static show(app: App, view: MarkdownView, editor: Editor, entries: readonly LoreEntry[]): void {
		const file = view.file;
		if (!file) return;
		const source = editor.getValue();
		const lines = source.split('\n');
		const headings = scanLoreHeadings(lines);
		const outline = buildLoreOutline(headings, lines.length);
		const cursor = editor.getCursor();
		const section = outline.find(heading => heading.relationBlocks.some(block => block.start <= cursor.line && cursor.line < block.end))
			?? outline.find(heading => heading.line <= cursor.line && cursor.line < heading.bodyEnd);
		if ((!section && outline.length) || cursor.line <= getLoreFrontmatterEnd(lines)) {
			new Notice(t('notice.lore-no-source-heading'));
			return;
		}
		const entry = entries.find(item => item.file.path === file.path && item.section?.key === section?.key)
			?? { file, heading: section?.title ?? file.basename, section };
		let insertAt = section?.bodyEnd ?? headings[0]?.position.start.line ?? lines.length;
		const start = section?.bodyStart ?? getLoreFrontmatterEnd(lines) + 1;
		while (insertAt > start && !lines[insertAt - 1].trim()) insertAt--;
		new LoreQuickRelationModal(app, entry, entries, relation => {
			if (view.file !== file || view.editor !== editor || editor.getValue() !== source) {
				new Notice(t('notice.lore-quick-source-changed'));
				return;
			}
			if (insertAt < lines.length) {
				editor.replaceRange(`\n${relation}\n${lines[insertAt].trim() ? '\n' : ''}`, { line: insertAt, ch: 0 });
			} else {
				const lastLine = editor.lastLine();
				editor.replaceRange(`\n\n${relation}\n`, { line: lastLine, ch: editor.getLine(lastLine).length });
			}
			editor.focus();
		}).open();
	}

	private constructor(app: App, private readonly source: LoreEntry, private readonly entries: readonly LoreEntry[],
		private readonly apply: (relation: string) => void) {
		super(app);
		this.modalEl.addClass('wn-plugin-modal', 'wn-quick-lore-relation');
	}

	override onOpen(): void {
		this.setTitle(t('modal.lore-add-relation'));
		let label = '';
		let selected: LoreEntry | undefined;
		const sourcePath = this.source.section?.path.join(' › ') ?? this.source.heading;
		new Setting(this.contentEl).setName(sourcePath);
		const field = new Setting(this.contentEl).setName(t('modal.lore-relation-label-placeholder'));
		const target = new Setting(this.contentEl);
		const format = () => selected && formatInlineLoreRelation(label, formatLoreRelationTarget(selected, this.source.file.path));
		new Setting(this.contentEl).addButton(save => {
			const update = () => { save.setDisabled(!format()); };
			field.addText(text => {
				text.onChange(value => { label = value; update(); });
				text.inputEl.focus();
			});
			target.addButton(button => button.setButtonText(t('modal.lore-search-target')).onClick(() => {
				new LoreRelationTargetPicker(this.app, this.entries, entry => {
					selected = entry;
					button.setButtonText(entry.heading);
					update();
				}, this.source).open();
			}));
			save.setButtonText(t('common.save')).setCta().setDisabled(true).onClick(() => {
				const relation = format();
				if (!relation) return;
				this.close();
				this.apply(relation);
			});
		});
	}

	override onClose(): void { this.contentEl.empty(); }
}
