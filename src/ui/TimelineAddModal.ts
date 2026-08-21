import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import type { TimelineEntry } from '../services/TimelineManager';
import { t } from '../i18n';
import { TimelineFormComponent, type TimelineFormContext } from './components/TimelineFormComponent';

/**
 * 统一的时间线条目添加对话框
 * 支持两种模式：
 * 1. 从选中文本添加（TimelineAddFromSelectionModal 的替代）
 * 2. 从时间线视图添加（TimelineAddModal 的替代）
 */
export class TimelineAddModal extends Modal {
	private description: string;
	private sourceFile: string;
	private folderPath: string;
	private onSubmit: (entry: TimelineEntry) => void;
	private returnFullEntry: boolean; // true 时返回完整 TimelineEntry，false 时返回简化对象
	private context: TimelineFormContext;
	private typeOptions: string[];
	private origin?: string;

	constructor(
		app: App,
		context: TimelineFormContext,
		description: string,
		sourceFile: string,
		folderPath: string,
		onSubmit: (entry: TimelineEntry) => void,
		returnFullEntry: boolean = true,
		typeOptions: string[] = [],
		origin?: string,
		title?: string
	) {
		super(app);
		this.context = context;
		this.description = description;
		this.sourceFile = sourceFile;
		this.folderPath = folderPath;
		this.onSubmit = onSubmit;
		this.returnFullEntry = returnFullEntry;
		this.typeOptions = typeOptions;
		this.origin = origin;
		this.title = title || t('modal.add-to-timeline');
	}

	private title: string;

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wn-timeline-add-modal');
		
		const component = new TimelineFormComponent({
			container: contentEl,
			app: this.app,
			context: this.context,
			folderPath: this.folderPath,
			initialEntry: {
				description: this.description,
				chapter: this.sourceFile,
				origin: this.origin
			},
			typeOptions: this.typeOptions,
			onCancel: () => this.close(),
			onSubmit: (entry: TimelineEntry) => {
				this.onSubmit(entry);
				this.close();
			},
			title: this.title
		});
		
		component.render();
	}

	onClose() { this.contentEl.empty(); }
}
