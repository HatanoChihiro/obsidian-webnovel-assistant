import type { App } from 'obsidian';
import { Notice, Setting } from 'obsidian';
import type { TimelineEntry } from '../../services/TimelineManager';
import type { AccurateCountSettings } from '../../types/settings';
import type { ChapterSorterContext, ChapterSorterSettings } from '../../services/ChapterSorter';
import { ChapterSorter } from '../../services/ChapterSorter';
import { getFileVolumePath } from '../../utils/chapterDisplayOrder';
import { t } from '../../i18n';

export type TimelineFormSettings = ChapterSorterSettings & Pick<AccurateCountSettings, 'timeline'>;

export interface TimelineFormContext extends ChapterSorterContext {
	settings: TimelineFormSettings;
}

export interface TimelineFormOptions {
	container: HTMLElement;
	app: App;
	context: TimelineFormContext;
	folderPath: string;
	initialEntry?: Partial<TimelineEntry>;
	typeOptions: string[];
	onCancel: () => void;
	onSubmit: (entry: TimelineEntry) => void;
	submitText?: string;
	title?: string;
}

export class TimelineFormComponent {
	constructor(private options: TimelineFormOptions) {}

	render(): HTMLElement {
		const { container, app, context, folderPath, initialEntry, typeOptions, onCancel, onSubmit, submitText, title } = this.options;
		const form = container.createDiv({ cls: 'wn-timeline-edit-form timeline-add-form' });

		if (title) {
			new Setting(form).setName(title).setHeading();
		}

		// 时间点
		form.createEl('label', { text: t('modal.time-point'), cls: 'wn-timeline-form-label' });
		const timeInput = form.createEl('input', { type: 'text', cls: 'wn-timeline-form-input' });
		timeInput.placeholder = t('modal.time-point-desc');
		if (initialEntry?.time) timeInput.value = initialEntry.time;

		// 事件列表标题
		form.createEl('label', { text: t('modal.event-list') || t('modal.event-description'), cls: 'wn-timeline-form-label' });
		form.createDiv({ cls: 'wn-timeline-form-hint', text: t('modal.event-list-hint') || '' });

		// 事件列表容器
		const eventsContainer = form.createDiv();
		eventsContainer.setCssProps({ marginBottom: '12px' });
		const targetFiles = ChapterSorter.getAllChapters(app, context, folderPath);
		const chapterOptions = targetFiles.map(file => {
			const value = ChapterSorter.generateChapterLinktext(app, context, file, folderPath, { eligibleChapters: targetFiles, useAlias: false });
			const volume = getFileVolumePath(file, folderPath);
			const label = volume ? `${file.basename} (${volume})` : file.basename;
			return { file, value, label };
		});

		const existingItems: { description: string; chapter: string; origin?: string }[] = initialEntry?.items && initialEntry.items.length > 0 
			? initialEntry.items 
			: [{ description: initialEntry?.description || '', chapter: initialEntry?.chapter || '', origin: initialEntry?.origin || '' }];

		const createEventBlock = (item: { description: string; chapter: string; origin?: string } = { description: '', chapter: '', origin: '' }) => {
			const eventBlock = eventsContainer.createDiv({ cls: 'wn-timeline-event-block' });
			eventBlock.addClass('webnovel-modal-event-block');
			
			// 事件描述
			eventBlock.createEl('label', { text: t('modal.event-desc-label') || t('modal.event-description'), cls: 'wn-timeline-form-label' });
			const descInput = eventBlock.createEl('textarea', { cls: 'wn-timeline-form-textarea' });
			descInput.value = item.description;
			descInput.placeholder = t('modal.event-desc-placeholder') || t('modal.describe-event-placeholder');
			descInput.addClass('webnovel-tl-desc-input-edit');
			
			// 关联章节
			eventBlock.createEl('label', { text: t('modal.related-chapters-optional') || t('modal.related-chapters'), cls: 'wn-timeline-form-label' });
			const chapterListContainer = eventBlock.createDiv();
			chapterListContainer.setCssProps({ marginBottom: '8px' });
			
			const existingChapters = item.chapter ? item.chapter.split(/[,，]/).map(c => c.trim()).filter(Boolean) : [];
			
			const createChapterRow = (initialValue: string = '') => {
				const row = chapterListContainer.createDiv();
				row.addClass('webnovel-tl-chapter-row-sm');
				const select = row.createEl('select', { cls: 'wn-timeline-form-input' });
				select.setCssProps({ flex: '1' });
				select.createEl('option', { value: '', text: t('modal.select-chapter') });
				const initialFile = initialValue
					? ChapterSorter.resolveChapterFile(app, context, folderPath, initialValue, { eligibleChapters: targetFiles })
					: null;
				chapterOptions.forEach(opt => {
					const option = select.createEl('option', { value: opt.value, text: opt.label });
					if (opt.value === initialValue || initialFile?.path === opt.file.path) option.selected = true;
				});
				
				const removeBtn = row.createEl('button', { text: '−' });
				removeBtn.addClass('webnovel-tl-remove-btn-sm');
				removeBtn.onclick = () => {
					row.remove();
					if (chapterListContainer.children.length === 1) createChapterRow();
				};
				return { row, select };
			};
			
			if (existingChapters.length > 0) {
				existingChapters.forEach(chapter => createChapterRow(chapter));
			} else {
				createChapterRow();
			}
			
			const addChapterBtn = chapterListContainer.createEl('button', { text: t('modal.add-chapter') });
			addChapterBtn.addClass('webnovel-tl-add-btn-sm');
			addChapterBtn.onclick = () => {
				const { row } = createChapterRow();
				chapterListContainer.insertBefore(row, addChapterBtn);
			};

			// 关联原文（可选）
			eventBlock.createEl('label', { text: t('modal.associated-quote'), cls: 'wn-timeline-form-label' });
			const quoteInput = eventBlock.createEl('textarea', { cls: 'wn-timeline-form-textarea wn-associated-quote-input' });
			quoteInput.value = item.origin || '';
			quoteInput.placeholder = t('modal.associated-quote-placeholder');
			quoteInput.addClass('webnovel-tl-desc-input-edit');
			
			const deleteEventBtn = eventBlock.createEl('button', { text: t('modal.delete-this-event') });
			deleteEventBtn.addClass('webnovel-tl-delete-event-btn');
			deleteEventBtn.onclick = () => {
				eventBlock.remove();
				if (eventsContainer.querySelectorAll('.webnovel-modal-event-block').length === 0) {
					createEventBlock();
				}
			};
			
			return { eventBlock, descInput, chapterListContainer, quoteInput };
		};

		existingItems.forEach(item => createEventBlock(item));

		const addEventBtn = eventsContainer.createEl('button', { text: t('modal.add-event') });
		addEventBtn.addClass('webnovel-tl-add-event-btn');
		addEventBtn.onclick = () => {
			const { eventBlock } = createEventBlock();
			eventsContainer.insertBefore(eventBlock, addEventBtn);
		};

		// 类型
		form.createEl('label', { text: t('modal.type-optional'), cls: 'wn-timeline-form-label' });
		const typeSelect = form.createEl('select', { cls: 'wn-timeline-form-input' });
		typeSelect.createEl('option', { value: '', text: t('modal.select-type') });
		
		const globalTypes = context.settings.timeline?.defaultTypes || ['主线', '支线', '伏笔', '世界观', '人物'];
		const allTypes = [...new Set([...globalTypes, ...typeOptions])];
		allTypes.forEach((type: string) => {
			const option = typeSelect.createEl('option', { value: type, text: type });
			if (initialEntry?.type === type) option.selected = true;
		});
		
		typeSelect.createEl('option', { value: '__custom__', text: t('modal.custom-type') });
		
		const customInput = form.createEl('input', { type: 'text', cls: 'wn-timeline-form-input' });
		customInput.placeholder = t('modal.custom-type-placeholder');
		customInput.addClass('wn-timeline-custom-type-input');
		
		if (initialEntry?.type && !allTypes.includes(initialEntry.type)) {
			typeSelect.value = '__custom__';
			customInput.value = initialEntry.type;
			customInput.hidden = false;
		} else {
			customInput.hidden = true;
		}

		typeSelect.addEventListener('change', () => {
			if (typeSelect.value === '__custom__') {
				customInput.hidden = false;
				customInput.focus();
			} else {
				customInput.hidden = true;
			}
		});

		// 按钮
		const btnRow = form.createDiv({ cls: 'wn-timeline-form-btns' });
		const cancelBtn = btnRow.createEl('button', { text: t('common.cancel'), cls: 'wn-timeline-action-btn' });
		cancelBtn.onclick = () => {
			form.remove();
			onCancel();
		};

		const saveBtn = btnRow.createEl('button', { text: submitText || t('common.add'), cls: 'wn-timeline-action-btn mod-cta' });
		saveBtn.onclick = () => {
			const time = timeInput.value.trim();
			if (!time) {
				new Notice(t('modal.please-fill-time-point'));
				timeInput.focus();
				return;
			}
			
			const items: { description: string; chapter: string; origin?: string }[] = [];
			const eventBlocks = eventsContainer.querySelectorAll('.webnovel-modal-event-block');
			
			eventBlocks.forEach((block) => {
				const htmlBlock = block as HTMLElement;
				const textareas = htmlBlock.querySelectorAll('textarea');
				const descInput = textareas[0] as HTMLTextAreaElement | undefined;
				const quoteInput = textareas[1] as HTMLTextAreaElement | undefined;
				const description = descInput ? descInput.value.trim() : '';
				const origin = quoteInput ? quoteInput.value.trim() : '';
				
				const chapters: string[] = [];
				const selects = htmlBlock.querySelectorAll('select');
				selects.forEach((select: HTMLSelectElement) => {
					const value = select.value.trim();
					if (value) chapters.push(value);
				});
				const chapter = [...new Set(chapters)].join(', ');
				
				if (description || chapter || origin) {
					items.push({ description, chapter, origin: origin || undefined });
				}
			});
			
			if (items.length === 0) {
				items.push({ description: '', chapter: '' });
			}
			
			let typeValue = typeSelect.value;
			if (typeValue === '__custom__') {
				typeValue = customInput.value.trim();
			}
			
			const entry: TimelineEntry = {
				time,
				description: items.map(it => it.description).filter(Boolean).join('\n'),
				chapter: items.map(it => it.chapter).filter(Boolean).join(', '),
				type: typeValue,
				rawBlock: initialEntry?.rawBlock || '',
				origin: initialEntry?.origin,
				items: items
			};
			
			onSubmit(entry);
		};

		window.setTimeout(() => timeInput.focus(), 50);
		return form;
	}
}
