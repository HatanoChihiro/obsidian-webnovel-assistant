// 限时任务新增对话框（内部仍用 Task 命名，待后续重构改为 Task）
import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { TaskEntry, TaskType } from '../types/task';
import type { TaskManager } from '../services/TaskManager';
import { t } from '../i18n';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class TaskAddModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private manager: TaskManager;
	private defaultPeriod: number;
	private defaultPlatform: string;
	private onSubmit: (entry: TaskEntry) => Promise<void>;

	constructor(
		app: App,
		plugin: WebNovelAssistantPlugin,
		manager: TaskManager,
		defaultPeriod: number,
		defaultPlatform: string,
		onSubmit: (entry: TaskEntry) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.manager = manager;
		this.defaultPeriod = defaultPeriod;
		this.defaultPlatform = defaultPlatform;
		this.onSubmit = onSubmit;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('task-add-modal');
		new Setting(contentEl).setName(t('modal.new-task')).setHeading();

		const existingEntries = (await this.manager.loadEntries()) || [];

		// 任务名称
		const platformContainer = contentEl.createDiv();
		platformContainer.createEl('label', { text: t('modal.platform'), cls: 'wn-task-label' });
		const platformInput = platformContainer.createEl('input', {
			attr: { placeholder: t('modal.platform-placeholder') },
			cls: 'wn-task-input',
			value: this.defaultPlatform,
		});

		// 任务期数
		const periodContainer = contentEl.createDiv();
		periodContainer.createEl('label', { text: t('modal.task-period'), cls: 'wn-task-label' });
		const initialPeriod = this.manager.getNextPeriod(existingEntries, 'wordCount');
		const periodInput = periodContainer.createEl('input', {
			type: 'number',
			attr: { min: '1' },
			cls: 'wn-task-input',
			value: String(initialPeriod),
		});

		const updatePeriodForType = (type: TaskType) => {
			const nextP = this.manager.getNextPeriod(existingEntries, type);
			periodInput.value = String(nextP);
		};

		// 起始时间
		const today = window.moment().format('YYYY-MM-DD');
		const nextWeek = window.moment().add(6, 'days').format('YYYY-MM-DD');

		const startContainer = contentEl.createDiv();
		startContainer.createEl('label', { text: t('modal.start-date'), cls: 'wn-task-label' });
		const startInput = startContainer.createEl('input', {
			type: 'text',
			attr: { placeholder: 'YYYY-MM-DD' },
			cls: 'wn-task-input',
			value: today,
		});

		// 结束时间
		const endContainer = contentEl.createDiv();
		endContainer.createEl('label', { text: t('modal.end-date'), cls: 'wn-task-label' });
		const endInput = endContainer.createEl('input', {
			type: 'text',
			attr: { placeholder: 'YYYY-MM-DD' },
			cls: 'wn-task-input',
			value: nextWeek,
		});

		// 起始时间变化时自动调整结束时间
		startInput.addEventListener('change', () => {
			const startVal = startInput.value;
			if (DATE_REGEX.test(startVal)) {
				endInput.value = window.moment(startVal).add(6, 'days').format('YYYY-MM-DD');
			}
		});

		// 任务详情
		const positionContainer = contentEl.createDiv();
		positionContainer.createEl('label', { text: t('modal.task-position'), cls: 'wn-task-label' });
		const positionInput = positionContainer.createEl('input', {
			attr: { placeholder: t('modal.task-position-placeholder') },
			cls: 'wn-task-input',
		});

		// 任务类型（双徽章样式选择按钮）
		let selectedType: TaskType = 'wordCount';
		const typeContainer = contentEl.createDiv();
		typeContainer.createEl('label', { text: t('modal.task-type'), cls: 'wn-task-label' });
		const typeGroup = typeContainer.createDiv({ cls: 'wn-task-type-group' });

		const wordCountBadge = typeGroup.createEl('button', {
			text: t('modal.task-type-word-count'),
			cls: 'wn-task-type-badge is-active',
		});
		const eventBadge = typeGroup.createEl('button', {
			text: t('modal.task-type-event'),
			cls: 'wn-task-type-badge',
		});

		// 字数要求
		const targetContainer = contentEl.createDiv();
		targetContainer.createEl('label', { text: t('modal.word-target'), cls: 'wn-task-label' });
		const targetInput = targetContainer.createEl('input', {
			type: 'number',
			attr: { min: '1', placeholder: t('modal.word-target-placeholder') },
			cls: 'wn-task-input',
		});

		// 起始字数（显示当前值，允许修改）
		const snapshotContainer = contentEl.createDiv();
		snapshotContainer.createEl('label', { text: t('modal.starting-word-count'), cls: 'wn-task-label' });
		const currentWords = this.manager.getChapterWordCount();
		const snapshotInput = snapshotContainer.createEl('input', {
			type: 'number',
			attr: { min: '0' },
			cls: 'wn-task-input',
			value: String(currentWords),
		});
		snapshotContainer.createDiv({ text: t('modal.starting-word-count-hint'), cls: 'wn-task-hint' });

		// 切换徽章事件
		wordCountBadge.onclick = (e) => {
			e.preventDefault();
			selectedType = 'wordCount';
			wordCountBadge.addClass('is-active');
			eventBadge.removeClass('is-active');
			targetContainer.setCssProps({ display: 'block' });
			snapshotContainer.setCssProps({ display: 'block' });
			updatePeriodForType('wordCount');
		};

		eventBadge.onclick = (e) => {
			e.preventDefault();
			selectedType = 'event';
			eventBadge.addClass('is-active');
			wordCountBadge.removeClass('is-active');
			targetContainer.setCssProps({ display: 'none' });
			snapshotContainer.setCssProps({ display: 'none' });
			updatePeriodForType('event');
		};

		// 按钮
		const btnContainer = contentEl.createDiv({ cls: 'wn-task-btn-container' });
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const submitBtn = btnContainer.createEl('button', { text: t('common.determine'), cls: 'mod-cta' });
		submitBtn.onclick = async () => {
			const platform = platformInput.value.trim();
			const period = parseInt(periodInput.value, 10);
			const startDate = startInput.value.trim();
			const endDate = endInput.value.trim();
			const position = positionInput.value.trim();
			
			if (!platform || period < 1 || !DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate) || endDate < startDate || !position) {
				return;
			}

			let wordTarget = 0;
			let startSnapshot = 0;

			if (selectedType === 'wordCount') {
				wordTarget = parseInt(targetInput.value, 10);
				startSnapshot = parseInt(snapshotInput.value, 10) || 0;
				if (isNaN(wordTarget) || wordTarget < 1) {
					return;
				}
			}

			const entry: TaskEntry = {
				period,
				platform,
				position,
				taskType: selectedType,
				wordTarget,
				startDate,
				endDate,
				startSnapshot,
				status: startDate <= today ? 'active' : 'notStarted',
				rawBlock: '',
			};

			await this.onSubmit(entry);
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}