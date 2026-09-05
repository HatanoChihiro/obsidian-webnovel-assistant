/**
 * 过滤器输入框事件绑定辅助函数
 * 统一处理 WorkbenchView, ChapterOverviewView, LoreOverviewView 中的
 * IME 合成、输入过滤、Escape 清除、清除按钮及焦点状态绑定。
 */

export interface FilterInputBindingOptions {
	input: HTMLInputElement;
	inputWrapper: HTMLElement;
	clearButton: HTMLElement;
	onCompositionStart: () => void;
	onRefresh: (immediate: boolean) => void;
}

export function bindFilterInputEvents(options: FilterInputBindingOptions): void {
	const { input, inputWrapper, clearButton, onCompositionStart, onRefresh } = options;

	const updateClearButton = () => {
		const isVisible = input.value.length > 0;
		clearButton.toggleClass('is-visible', isVisible);
		clearButton.setAttr('aria-hidden', isVisible ? 'false' : 'true');
	};
	updateClearButton();

	let isComposing = false;

	input.addEventListener('compositionstart', () => {
		isComposing = true;
		onCompositionStart();
	});

	input.addEventListener('compositionend', () => {
		isComposing = false;
		updateClearButton();
		onRefresh(false);
	});

	input.addEventListener('input', (event) => {
		updateClearButton();
		if (isComposing || (event as InputEvent).isComposing) return;
		onRefresh(false);
	});

	input.addEventListener('focus', () => {
		inputWrapper.addClass('is-focused');
	});

	input.addEventListener('blur', () => {
		inputWrapper.removeClass('is-focused');
	});

	input.addEventListener('keydown', (event) => {
		if (isComposing || event.isComposing) return;
		if (event.key !== 'Escape' || input.value.length === 0) return;
		event.preventDefault();
		input.value = '';
		updateClearButton();
		onRefresh(true);
	});

	clearButton.onclick = () => {
		input.value = '';
		updateClearButton();
		onRefresh(true);
	};

	clearButton.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		clearButton.click();
	});
}
