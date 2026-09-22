export interface MultiSelectOption {
	value: string;
	label?: string;
}

export interface MultiSelectFilterRowOptions {
	container: HTMLElement;
	options: Array<string | MultiSelectOption>;
	selected?: Set<string> | string[];
	allLabel: string;
	cls?: string;
	buttonCls?: string;
	onChange: (selected: Set<string>) => void;
}

/**
 * 通用多选筛选行组件
 * 管理“全部”清除按钮、各选项按钮的多选状态交互渲染（Set<string>、aria-pressed、is-active），
 * 不负责具体的领域过滤逻辑。
 */
export class MultiSelectFilterRow {
	private selected: Set<string>;
	private container: HTMLElement;
	private rowEl: HTMLElement;
	private allBtn: HTMLButtonElement;
	private optionBtns: Map<string, HTMLButtonElement> = new Map();
	private options: MultiSelectOption[];
	private onChange: (selected: Set<string>) => void;

	constructor(opts: MultiSelectFilterRowOptions) {
		this.container = opts.container;
		this.onChange = opts.onChange;
		this.selected = new Set(opts.selected ? (Array.isArray(opts.selected) ? opts.selected : Array.from(opts.selected)) : []);
		this.options = opts.options.map(opt => typeof opt === 'string' ? { value: opt, label: opt } : { value: opt.value, label: opt.label || opt.value });

		const rowCls = ['wn-multi-select-filter-row', opts.cls].filter(Boolean).join(' ');
		this.rowEl = this.container.createDiv({ cls: rowCls });

		const btnBaseCls = opts.buttonCls || 'wn-filter-btn';

		// 全部 / 清空按钮
		this.allBtn = this.rowEl.createEl('button', {
			text: opts.allLabel,
			cls: `${btnBaseCls} wn-multi-select-all-btn`
		});
		this.allBtn.setAttr('type', 'button');
		this.allBtn.onclick = () => {
			this.clear();
		};

		// 选项按钮
		for (const opt of this.options) {
			const btn = this.rowEl.createEl('button', {
				text: opt.label,
				cls: `${btnBaseCls} wn-multi-select-opt-btn`
			});
			btn.setAttr('type', 'button');
			btn.onclick = () => {
				this.toggle(opt.value);
			};
			this.optionBtns.set(opt.value, btn);
		}

		this.updateUI();
	}

	public getSelected(): Set<string> {
		return new Set(this.selected);
	}

	public setSelected(selected: Set<string> | string[]): void {
		this.selected = new Set(selected ? (Array.isArray(selected) ? selected : Array.from(selected)) : []);
		this.updateUI();
	}

	public toggle(value: string): void {
		if (this.selected.has(value)) {
			this.selected.delete(value);
		} else {
			this.selected.add(value);
		}
		this.updateUI();
		this.onChange(new Set(this.selected));
	}

	public clear(): void {
		this.selected.clear();
		this.updateUI();
		this.onChange(new Set(this.selected));
	}

	private updateUI(): void {
		const isAll = this.selected.size === 0;
		this.allBtn.setAttr('aria-pressed', isAll ? 'true' : 'false');
		if (isAll) {
			this.allBtn.addClass('is-active');
		} else {
			this.allBtn.removeClass('is-active');
		}

		for (const [val, btn] of this.optionBtns.entries()) {
			const active = this.selected.has(val);
			btn.setAttr('aria-pressed', active ? 'true' : 'false');
			if (active) {
				btn.addClass('is-active');
			} else {
				btn.removeClass('is-active');
			}
		}
	}

	public getElement(): HTMLElement {
		return this.rowEl;
	}
}
