interface ObsidianElementFactoryWindow extends Window {
	createSpan(options: { cls: string }): HTMLSpanElement;
}

export function injectSoftBreakIndentPlaceholders(el: HTMLElement, includeSpacer = true): void {
	const ownerWindow = el.ownerDocument.win as ObsidianElementFactoryWindow;
	const paragraphs = el.querySelectorAll('p');
	paragraphs.forEach((paragraph) => {
		const breaks = paragraph.querySelectorAll('br');
		breaks.forEach((lineBreak) => {
			const next = lineBreak.nextSibling;
			const nextElement = next?.nodeType === 1 ? next as Element : null;
			if (nextElement?.classList.contains('wn-soft-break-spacer') || nextElement?.classList.contains('wn-soft-break-indent')) {
				return;
			}

			const indent = ownerWindow.createSpan({ cls: 'wn-soft-break-indent' });
			if (lineBreak.parentNode) {
				lineBreak.parentNode.insertBefore(indent, lineBreak.nextSibling);
				if (includeSpacer) {
					const spacer = ownerWindow.createSpan({ cls: 'wn-soft-break-spacer' });
					lineBreak.parentNode.insertBefore(spacer, indent);
				}
			}

			const nextNode = indent.nextSibling;
			if (nextNode?.nodeType === 3 && nextNode.nodeValue) {
				nextNode.nodeValue = nextNode.nodeValue.replace(/^[\r\n\s]+/, '');
			}
		});
	});
}
