import type { App} from 'obsidian';
import { Modal } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import type { RankingEntry } from '../types/ranking';
import type { RankingManager } from '../services/RankingManager';

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
		contentEl.createEl('h2', { text: '新增榜单' });

		const inputStyle = 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;';

		// 签约平台
		const platformContainer = contentEl.createDiv();
		platformContainer.createEl('label', { text: '签约平台', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const platformReadOnly = this.defaultPlatform !== '';
		const platformInput = platformContainer.createEl('input', {
			attr: { style: inputStyle + (platformReadOnly ? 'opacity:0.6;' : ''), placeholder: platformReadOnly ? '' : '如：起点中文网', ...(platformReadOnly ? { readonly: 'true' } : {}) },
			value: this.defaultPlatform,
		});

		// 榜单期数
		const periodContainer = contentEl.createDiv();
		periodContainer.createEl('label', { text: '榜单期数', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const periodInput = periodContainer.createEl('input', {
			type: 'number',
			attr: { style: inputStyle, min: '1' },
			value: String(this.defaultPeriod),
		});

		// 起始时间
		const today = activeWindow.moment().format('YYYY-MM-DD');
		const nextWeek = activeWindow.moment().add(6, 'days').format('YYYY-MM-DD');

		const startContainer = contentEl.createDiv();
		startContainer.createEl('label', { text: '起始时间', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const startInput = startContainer.createEl('input', {
			type: 'text',
			attr: { style: inputStyle, placeholder: 'YYYY-MM-DD' },
			value: today,
		});

		// 结束时间
		const endContainer = contentEl.createDiv();
		endContainer.createEl('label', { text: '结束时间', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const endInput = endContainer.createEl('input', {
			type: 'text',
			attr: { style: inputStyle, placeholder: 'YYYY-MM-DD' },
			value: nextWeek,
		});

		// 起始时间变化时自动调整结束时间
		startInput.addEventListener('change', () => {
			const startVal = startInput.value;
			if (DATE_REGEX.test(startVal)) {
				endInput.value = activeWindow.moment(startVal).add(6, 'days').format('YYYY-MM-DD');
			}
		});

		// 榜单位置
		const positionContainer = contentEl.createDiv();
		positionContainer.createEl('label', { text: '榜单位置', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const positionInput = positionContainer.createEl('input', {
			attr: { style: inputStyle, placeholder: '如：新书榜第3名' },
		});

		// 字数要求
		const targetContainer = contentEl.createDiv();
		targetContainer.createEl('label', { text: '字数要求', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const targetInput = targetContainer.createEl('input', {
			type: 'number',
			attr: { style: inputStyle, min: '1', placeholder: '如：30000' },
		});

		// 起始字数（显示当前值，允许修改）
		const snapshotContainer = contentEl.createDiv();
		snapshotContainer.createEl('label', { text: '起始字数', attr: { style: 'display:block;margin-bottom:4px;font-weight:bold;' } });
		const currentWords = this.manager.getChapterWordCount();
		const snapshotInput = snapshotContainer.createEl('input', {
			type: 'number',
			attr: { style: inputStyle, min: '0' },
			value: String(currentWords),
		});
		snapshotContainer.createDiv({ text: '当前文件夹章节总字数，可手动调整', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px;' } });

		// 按钮
		const btnContainer = contentEl.createDiv({
			attr: { style: 'display:flex;justify-content:flex-end;gap:10px;margin-top:16px;' },
		});
		const cancelBtn = btnContainer.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();

		const submitBtn = btnContainer.createEl('button', { text: '确定', cls: 'mod-cta' });
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
				status: startDate <= today ? '进行中' : '未开始',
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