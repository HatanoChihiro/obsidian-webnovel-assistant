const MODAL_SELECTOR = '.modal-container, .modal.mod-settings, .vertical-tabs-container, .modal-bg';

/** Ignore ordinary editor mutations and coalesce modal changes into one layout update. */
export function observeModalState(doc: Document): () => void {
	const win = doc.defaultView;
	let frame: number | null = null;
	let disposed = false;
	let popout = doc.body.classList.contains('is-popout-modal');
	const update = () => {
		frame = null;
		if (disposed) return;
		const hasModal = !!doc.body.querySelector(MODAL_SELECTOR) || popout;
		doc.body.classList.toggle('webnovel-modal-active', hasModal);
	};
	const schedule = () => {
		if (disposed || frame !== null) return;
		if (win) frame = win.requestAnimationFrame(update);
		else update();
	};
	const containsModal = (node: Node): boolean => {
		if (node.nodeType !== 1) return false;
		const element = node as Element;
		return element.matches(MODAL_SELECTOR)
			|| (element.childElementCount > 0 && !!element.querySelector(MODAL_SELECTOR));
	};
	const observer = new MutationObserver(records => {
		if (records.some(record => Array.from(record.addedNodes).some(containsModal)
			|| Array.from(record.removedNodes).some(containsModal))) schedule();
	});
	// Nested settings dialogs may be mounted beneath an existing workspace container.
	observer.observe(doc.body, { childList: true, subtree: true });
	const bodyObserver = new MutationObserver(() => {
		const nextPopout = doc.body.classList.contains('is-popout-modal');
		if (nextPopout === popout) return;
		popout = nextPopout;
		schedule();
	});
	bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
	update();
	return () => {
		disposed = true;
		observer.disconnect();
		bodyObserver.disconnect();
		if (frame !== null && win) win.cancelAnimationFrame(frame);
		frame = null;
		doc.body.classList.remove('webnovel-modal-active');
	};
}
