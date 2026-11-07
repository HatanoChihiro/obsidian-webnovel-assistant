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
	onEnter?: (draft: string) => void;
	onClear?: () => void;
	hasActiveTags?: () => boolean;
	onEscape?: () => boolean | void;
}

export function bindFilterInputEvents(options: FilterInputBindingOptions): void {
	const { input, inputWrapper, clearButton, onCompositionStart, onRefresh, onEnter, onClear, hasActiveTags, onEscape } = options;

	const updateClearButton = () => {
		const isVisible = input.value.length > 0 || (hasActiveTags?.() ?? false);
		clearButton.toggleClass('is-visible', isVisible);
		clearButton.setAttr('aria-hidden', isVisible ? 'false' : 'true');
	};
	updateClearButton();

	let isComposing = false;
	let lastCompositionEndTime = 0;

	input.addEventListener('compositionstart', () => {
		isComposing = true;
		onCompositionStart();
	});

	input.addEventListener('compositionend', () => {
		isComposing = false;
		lastCompositionEndTime = Date.now();
		updateClearButton();
		onRefresh(false);
	});

	input.addEventListener('input', (event) => {
		updateClearButton();
		const eventIsComposing = 'isComposing' in event && event.isComposing === true;
		if (isComposing || eventIsComposing) return;
		onRefresh(false);
	});

	input.addEventListener('focus', () => {
		inputWrapper.addClass('is-focused');
	});

	input.addEventListener('blur', () => {
		inputWrapper.removeClass('is-focused');
	});

	input.addEventListener('keydown', (event) => {
		const keyCode = 'keyCode' in event ? (event as { keyCode: number }).keyCode : 0;
		if (isComposing || event.isComposing || keyCode === 229) return;

		if (event.key === 'Enter') {
			if (Date.now() - lastCompositionEndTime < 50) return;
			if (onEnter) {
				event.preventDefault();
				onEnter(input.value);
				updateClearButton();
				return;
			}
		}

		if (event.key === 'Escape') {
			if (input.value.length > 0) {
				event.preventDefault();
				input.value = '';
				updateClearButton();
				onRefresh(true);
			} else if (onEscape) {
				const handled = onEscape();
				if (handled) event.preventDefault();
				updateClearButton();
			}
			return;
		}
	});

	clearButton.onclick = () => {
		input.value = '';
		if (onClear) {
			onClear();
		}
		updateClearButton();
		onRefresh(true);
	};

	clearButton.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		clearButton.click();
	});
}
