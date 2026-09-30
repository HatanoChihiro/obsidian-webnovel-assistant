export class TouchDragPolyfill {
	static register(container: HTMLElement): () => void {
		const doc = container.ownerDocument;
		const win = doc.defaultView ?? window;

		let dragSource: HTMLElement | null = null;
		let startX = 0;
		let startY = 0;
		let longPressTimer: number | null = null;
		let currentDropTarget: HTMLElement | null = null;
		let ghostEl: HTMLElement | null = null;
		let ghostOffsetX = 0;
		let ghostOffsetY = 0;
		let lastTouch: Touch | null = null;
		let disposed = false;

		class SimpleDataTransfer {
			private data: Record<string, string> = {};
			public dropEffect = 'move';
			public effectAllowed = 'all';
			public get types() { return Object.keys(this.data); }
			public setData(format: string, data: string) { this.data[format] = data; }
			public getData(format: string) { return this.data[format] || ''; }
			public clearData(format?: string) { if (format) delete this.data[format]; else this.data = {}; }
			public setDragImage() {}
		}

		let dummyDataTransfer: SimpleDataTransfer | null = null;

		const createDragEvent = (type: string, touch: Touch, dataTransfer: unknown) => {
			const MouseEventCtor = win.MouseEvent ?? MouseEvent;
			const event = new MouseEventCtor(type, {
				bubbles: true,
				cancelable: true,
				clientX: touch.clientX,
				clientY: touch.clientY
			}) as MouseEvent & { dataTransfer: unknown };
			event.dataTransfer = dataTransfer;
			return event;
		};

		const abortDrag = (touch: Touch | null = lastTouch) => {
			if (longPressTimer !== null) {
				win.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			if (dragSource) {
				dragSource.setCssStyles({ opacity: '', pointerEvents: '' });
				if (touch && dummyDataTransfer) {
					dragSource.dispatchEvent(createDragEvent('dragend', touch, dummyDataTransfer));
				}
			}
			dragSource = null;
			currentDropTarget = null;
			dummyDataTransfer = null;
			lastTouch = null;
			ghostEl?.remove();
			ghostEl = null;
		};

		const onTouchStart = (event: TouchEvent) => {
			const target = (event.target as HTMLElement).closest<HTMLElement>('[draggable="true"]');
			if (!target || event.touches.length === 0) return;
			event.stopPropagation();
			if (dragSource) return;

			lastTouch = event.touches[0];
			startX = lastTouch.clientX;
			startY = lastTouch.clientY;
			longPressTimer = win.setTimeout(() => {
				longPressTimer = null;
				dragSource = target;
				dragSource.setCssStyles({ opacity: '0.5', pointerEvents: 'none' });
				win.navigator.vibrate?.(40);

				const rect = dragSource.getBoundingClientRect();
				ghostOffsetX = startX - rect.left;
				ghostOffsetY = startY - rect.top;
				ghostEl = dragSource.cloneNode(true) as HTMLElement;
				ghostEl.setCssStyles({
					position: 'fixed',
					left: `${startX - ghostOffsetX}px`,
					top: `${startY - ghostOffsetY}px`,
					width: `${rect.width}px`,
					height: `${rect.height}px`,
					opacity: '0.8',
					pointerEvents: 'none',
					zIndex: '999999'
				});
				doc.body.appendChild(ghostEl);

				dummyDataTransfer = new SimpleDataTransfer();
				if (lastTouch) {
					dragSource.dispatchEvent(createDragEvent('dragstart', lastTouch, dummyDataTransfer));
				}
			}, 220);
		};

		const onTouchMove = (event: TouchEvent) => {
			if (event.touches.length === 0) return;
			lastTouch = event.touches[0];
			if (longPressTimer !== null) {
				const dx = lastTouch.clientX - startX;
				const dy = lastTouch.clientY - startY;
				if (Math.abs(dx) > 18 || Math.abs(dy) > 18) {
					win.clearTimeout(longPressTimer);
					longPressTimer = null;
				}
			}

			if (!dragSource || !dummyDataTransfer) return;
			event.preventDefault();
			event.stopPropagation();
			const touch = lastTouch;

			ghostEl?.setCssStyles({
				left: `${touch.clientX - ghostOffsetX}px`,
				top: `${touch.clientY - ghostOffsetY}px`
			});
			const elemBelow = doc.elementFromPoint(touch.clientX, touch.clientY);
			if (!elemBelow) return;

			const dropTarget = elemBelow as HTMLElement;
			if (currentDropTarget !== dropTarget) {
				if (currentDropTarget) {
					currentDropTarget.dispatchEvent(createDragEvent('dragleave', touch, dummyDataTransfer));
				}
				currentDropTarget = dropTarget;
				currentDropTarget.dispatchEvent(createDragEvent('dragenter', touch, dummyDataTransfer));
			}
			currentDropTarget.dispatchEvent(createDragEvent('dragover', touch, dummyDataTransfer));
		};

		const onTouchEnd = (event: TouchEvent) => {
			if (longPressTimer !== null) {
				win.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			if (!dragSource || !dummyDataTransfer || event.changedTouches.length === 0) return;
			event.stopPropagation();
			const touch = event.changedTouches[0];
			if (currentDropTarget) {
				currentDropTarget.dispatchEvent(createDragEvent('drop', touch, dummyDataTransfer));
			}
			dragSource.dispatchEvent(createDragEvent('dragend', touch, dummyDataTransfer));
			dragSource.setCssStyles({ opacity: '', pointerEvents: '' });
			dragSource = null;
			currentDropTarget = null;
			dummyDataTransfer = null;
			lastTouch = null;
			ghostEl?.remove();
			ghostEl = null;
		};

		const onTouchCancel = (event: TouchEvent) => {
			abortDrag(event.changedTouches[0] ?? null);
		};

		const onContextMenu = (event: MouseEvent) => {
			if (dragSource || longPressTimer !== null) {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		container.addEventListener('touchstart', onTouchStart, { passive: true });
		container.addEventListener('touchmove', onTouchMove, { passive: false });
		container.addEventListener('touchend', onTouchEnd);
		container.addEventListener('touchcancel', onTouchCancel);
		container.addEventListener('contextmenu', onContextMenu);

		return () => {
			if (disposed) return;
			disposed = true;
			container.removeEventListener('touchstart', onTouchStart);
			container.removeEventListener('touchmove', onTouchMove);
			container.removeEventListener('touchend', onTouchEnd);
			container.removeEventListener('touchcancel', onTouchCancel);
			container.removeEventListener('contextmenu', onContextMenu);
			abortDrag();
		};
	}
}
