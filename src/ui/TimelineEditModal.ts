import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import { deepCloneEntry, type TimelineEntry } from '../services/TimelineManager';
import { t } from '../i18n';
import { TimelineFormComponent, type TimelineFormContext, type TimelineNodeOption } from './components/TimelineFormComponent';

export interface TimelineEditModalOptions {
	app: App;
	context: TimelineFormContext;
	folderPath: string;
	initialEntry: TimelineEntry;
	typeOptions: string[];
	existingNodes?: Array<string | TimelineNodeOption>;
	onSubmit: (entry: TimelineEntry) => Promise<void> | void;
	title?: string;
}

export class TimelineEditModal extends Modal {
	private isSaving = false;

	constructor(private options: TimelineEditModalOptions) {
		super(options.app);
		this.modalEl.addClass('wn-plugin-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-timeline-edit-modal');
		contentEl.addClass('wn-timeline-add-modal');

		const initialEntry = deepCloneEntry(this.options.initialEntry);
		if (!initialEntry.items || initialEntry.items.length === 0) {
			initialEntry.items = [{
				description: initialEntry.description || '',
				chapter: initialEntry.chapter || '',
				origin: initialEntry.origin || '',
				important: initialEntry.important
			}];
		}

		const component = new TimelineFormComponent({
			container: contentEl,
			app: this.app || this.options.app,
			context: this.options.context,
			folderPath: this.options.folderPath,
			initialEntry,
			typeOptions: this.options.typeOptions,
			existingNodes: this.options.existingNodes,
			submitText: t('common.save'),
			title: this.options.title || t('timeline.edit-node'),
			onCancel: () => {
				if (this.isSaving) return;
				this.close();
			},
			onSubmit: async (entry: TimelineEntry) => {
				if (this.isSaving) return;
				this.isSaving = true;
				try {
					await this.options.onSubmit(entry);
					this.isSaving = false;
					this.close();
				} catch (err) {
					this.isSaving = false;
					throw err;
				}
			}
		});

		component.render();
	}

	close() {
		if (this.isSaving) return;
		super.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
