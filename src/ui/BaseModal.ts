import { Modal, Setting } from 'obsidian';
import { STYLES } from '../constants';

/**
 * 基础表单 Modal 类
 * 提供通用的表单输入、验证、按钮处理功能
 * 减少 Modal 类之间的代码重复
 */
export abstract class BaseFormModal extends Modal {
	protected contentEl: HTMLElement;

	/**
	 * 创建输入字段（文本或文本域）
	 */
	protected createInputField(
		name: string,
		desc: string,
		placeholder: string,
		type: 'text' | 'textarea' = 'text',
		defaultValue: string = ''
	): HTMLInputElement | HTMLTextAreaElement {
		new Setting(this.contentEl).setName(name).setDesc(desc);
		
		const el = this.contentEl.createEl(
			type === 'textarea' ? 'textarea' : 'input',
			{
				type: type === 'text' ? 'text' : undefined,
				placeholder
			}
		) as HTMLInputElement | HTMLTextAreaElement;
		
		el.value = defaultValue;
		el.style.cssText = STYLES.INPUT_STYLE;
		
		if (type === 'textarea') {
			(el as HTMLTextAreaElement).style.cssText += 'height:80px;resize:vertical;font-family:var(--font-text);';
		}
		
		return el;
	}

	/**
	 * 创建按钮容器
	 */
	protected createButtonContainer(): HTMLElement {
		const container = this.contentEl.createDiv();
		container.style.cssText = STYLES.BUTTON_CONTAINER_STYLE;
		return container;
	}

	/**
	 * 在按钮容器中添加取消按钮
	 */
	protected addCancelButton(container: HTMLElement): HTMLButtonElement {
		const btn = container.createEl('button', { text: '取消' });
		btn.onclick = () => this.close();
		return btn;
	}

	/**
	 * 在按钮容器中添加提交按钮
	 */
	protected addSubmitButton(
		container: HTMLElement,
		text: string = '提交',
		onSubmit: () => void = () => this.onSubmit()
	): HTMLButtonElement {
		const btn = container.createEl('button', { text, cls: 'mod-cta' });
		btn.onclick = onSubmit;
		return btn;
	}

	/**
	 * 创建标签快捷按钮组
	 */
	protected createTagButtons(
		container: HTMLElement,
		tags: string[],
		onTagClick: (tag: string) => void
	): void {
		if (tags.length === 0) return;

		const tagBtnContainer = container.createDiv({ cls: 'tag-buttons' });
		tagBtnContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;';

		for (const tag of tags) {
			const btn = tagBtnContainer.createEl('button', { text: `#${tag}` });
			btn.style.cssText = STYLES.TAG_BUTTON_STYLE;
			btn.onclick = () => onTagClick(tag);
		}
	}

	/**
	 * 验证输入字段不为空
	 */
	protected validateNotEmpty(value: string, fieldName: string): boolean {
		if (!value.trim()) {
			const { Notice } = require('obsidian');
			new Notice(`❌ 请填写${fieldName}`);
			return false;
		}
		return true;
	}

	/**
	 * 验证输入字段长度
	 */
	protected validateLength(
		value: string,
		fieldName: string,
		minLength: number = 0,
		maxLength: number = Infinity
	): boolean {
		const len = value.trim().length;
		if (len < minLength || len > maxLength) {
			const { Notice } = require('obsidian');
			new Notice(`❌ ${fieldName}长度必须在 ${minLength}-${maxLength} 之间`);
			return false;
		}
		return true;
	}

	/**
	 * 自动聚焦到指定元素
	 */
	protected autoFocus(element: HTMLInputElement | HTMLTextAreaElement, delay: number = 50): void {
		setTimeout(() => {
			element.focus();
			if (element instanceof HTMLInputElement) {
				element.select();
			}
		}, delay);
	}

	/**
	 * 抽象方法：子类必须实现提交逻辑
	 */
	abstract onSubmit(): void;

	/**
	 * 关闭时清空内容
	 */
	onClose(): void {
		this.contentEl.empty();
	}
}
