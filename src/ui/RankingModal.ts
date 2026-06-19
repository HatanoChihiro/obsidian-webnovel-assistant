// 限时任务新增对话框（内部仍用 Ranking 命名，待后续重构改为 Task）
import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { RankingEntry } from '../types/ranking';
import type { RankingManager } from '../services/RankingManager';
import { t } from '../i18n';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class RankingAddModal extends Modal {
	private plugin: WebNovelAssistantPlugin;
	private manager: RankingManager;
	private defaultPeriod: number;
	private defaultPlatform: string;
	private onSubmit: (entry: RankingEntry) => Promise<void>;

	constructor(
		app: App,
		plugin: WebNovelAssistantPlugin,
		manager: RankingManager,
		defaultPeriod: number,
		defaultPlatform: string,
		onSubmit: (entry: RankingEntry) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.manager = manager;
		this.defaultPeriod = defaultPeriod;
		this.defaultPlatform = defaultPlatform;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ranking-add-modal');
		new Setting(contentEl).setName(t('modal.new-ranking')).setHeading();

		// 任务名称
		const platformContainer = contentEl.createDiv();
		platformContainer.createEl('label', { text: t('modal.platform'), cls: 'wn-ranking-label' });
		const platformInput = platformContainer.createEl('input', {
			attr: { placeholder: t('modal.platform-placeholder') },
			cls: 'wn-ranking-input',
			value: this.defaultPlatform,
		});

		// 任务期数
		const periodContainer = contentEl.createDiv();
		periodContainer.createEl('label', { text: t('modal.ranking-period'), cls: 'wn-ranking-label' });
		const periodInput = periodContainer.createEl('input', {
			type: 'number',
			attr: { min: '1' },
			cls: 'wn-ranking-input',
			value: String(this.defaultPeriod),
		});

		// 起始时间
		const today = window.moment().format('YYYY-MM-DD');
		const nextWeek = window.moment().add(6, 'days').format('YYYY-MM-DD');

		const startContainer = contentEl.createDiv();
		startContainer.createEl('label', { text: t('modal.start-date'), cls: 'wn-ranking-label' });
		const startInput = startContainer.createEl('input', {
			type: 'text',
			attr: { placeholder: 'YYYY-MM-DD' },
			cls: 'wn-ranking-input',
			value: today,
		});

		// 结束时间
		const endContainer = contentEl.createDiv();
		endContainer.createEl('label', { text: t('modal.end-date'), cls: 'wn-ranking-label' });
		const endInput = endContainer.createEl('input', {
			type: 'text',
			attr: { placeholder: 'YYYY-MM-DD' },
			cls: 'wn-ranking-input',
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
		positionContainer.createEl('label', { text: t('modal.ranking-position'), cls: 'wn-ranking-label' });
		const positionInput = positionContainer.createEl('input', {
			attr: { placeholder: t('modal.ranking-position-placeholder') },
			cls: 'wn-ranking-input',
		});

		// 字数要求
		const targetContainer = contentEl.createDiv();
		targetContainer.createEl('label', { text: t('modal.word-target'), cls: 'wn-ranking-label' });
		const targetInput = targetContainer.createEl('input', {
			type: 'number',
			attr: { min: '1', placeholder: t('modal.word-target-placeholder') },
			cls: 'wn-ranking-input',
		});

		// 起始字数（显示当前值，允许修改）
		const snapshotContainer = contentEl.createDiv();
		snapshotContainer.createEl('label', { text: t('modal.starting-word-count'), cls: 'wn-ranking-label' });
		const currentWords = this.manager.getChapterWordCount();
		const snapshotInput = snapshotContainer.createEl('input', {
			type: 'number',
			attr: { min: '0' },
			cls: 'wn-ranking-input',
			value: String(currentWords),
		});
		snapshotContainer.createDiv({ text: t('modal.starting-word-count-hint'), cls: 'wn-ranking-hint' });

		// 按钮
		const btnContainer = contentEl.createDiv({ cls: 'wn-ranking-btn-container' });
		const cancelBtn = btnContainer.createEl('button', { text: t('common.cancel') });
		cancelBtn.onclick = () => this.close();

		const submitBtn = btnContainer.createEl('button', { text: t('common.determine'), cls: 'mod-cta' });
		submitBtn.onclick = async () => {
			const platform = platformInput.value.trim();
			const period = parseInt(periodInput.value, 10);
			const startDate = startInput.value.trim();
			const endDate = endInput.value.trim();
			const position = positionInput.value.trim();
			const wordTarget = parseInt(targetInput.value, 10);
			const startSnapshot = parseInt(snapshotInput.value, 10) || 0;

			if (!platform || period < 1 || !DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate) || endDate < startDate || !position || wordTarget < 1) {
				return;
			}

			const entry: RankingEntry = {
				period,
				platform,
				position,
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