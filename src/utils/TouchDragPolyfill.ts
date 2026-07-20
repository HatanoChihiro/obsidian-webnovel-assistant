export class TouchDragPolyfill {
	static register(container: HTMLElement) {
		let styleSheet = activeDocument.getElementById('wn-touch-polyfill-style');
		if (!styleSheet) {
			styleSheet = activeDocument.createElement('style');
			styleSheet.id = 'wn-touch-polyfill-style';
			styleSheet.textContent = `
				body.is-mobile *[draggable="true"],
				body.is-mobile div[draggable="true"],
				body.is-mobile a[draggable="true"] {
					-webkit-user-select: none;
					user-select: none;
					-webkit-touch-callout: none;
					touch-action: none;
				}
			`;
			activeDocument.head.appendChild(styleSheet);
		}

		let dragSource: HTMLElement | null = null;
		let startX = 0, startY = 0;
		let longPressTimer: number | null = null;
		let currentDropTarget: HTMLElement | null = null;
		let ghostEl: HTMLElement | null = null;
		let ghostOffsetX = 0;
		let ghostOffsetY = 0;
		
		// 简单的 DataTransfer 模拟
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
			const e = new MouseEvent(type, { 
				bubbles: true, 
				cancelable: true,
				clientX: touch.clientX,
				clientY: touch.clientY
			}) as MouseEvent & { dataTransfer: unknown };
			e.dataTransfer = dataTransfer;
			return e;
		};

		const onTouchStart = (e: TouchEvent) => {
			const target = (e.target as HTMLElement).closest('[draggable="true"]') as HTMLElement;
			if (!target) return;
			
			// 阻止事件冒泡，防止 Obsidian 的全局长按监听器在 500ms 时触发并打断我们的触摸流
			e.stopPropagation();

			// 如果已经在拖拽中，忽略
			if (dragSource) return;

			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
			
			longPressTimer = window.setTimeout(() => {
				dragSource = target;
				dragSource.setCssStyles({ opacity: '0.5' });
				if (navigator.vibrate) navigator.vibrate(50);

				const rect = dragSource.getBoundingClientRect();
				ghostOffsetX = startX - rect.left;
				ghostOffsetY = startY - rect.top;
				
				ghostEl = dragSource.cloneNode(true) as HTMLElement;
				ghostEl.setCssStyles({
					position: 'fixed',
					left: (startX - ghostOffsetX) + 'px',
					top: (startY - ghostOffsetY) + 'px',
					width: rect.width + 'px',
					height: rect.height + 'px',
					opacity: '0.8',
					pointerEvents: 'none',
					zIndex: '999999'
				});
				activeDocument.body.appendChild(ghostEl);
				
				dummyDataTransfer = new SimpleDataTransfer();
				const dragStartEvent = createDragEvent('dragstart', e.touches[0], dummyDataTransfer);
				dragSource.dispatchEvent(dragStartEvent);
			}, 300);
		};

		const onTouchMove = (e: TouchEvent) => {
			if (longPressTimer) {
				const dx = e.touches[0].clientX - startX;
				const dy = e.touches[0].clientY - startY;
				if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
					window.clearTimeout(longPressTimer);
					longPressTimer = null;
				}
			}
			
			if (!dragSource || !dummyDataTransfer) return;
			e.preventDefault(); // 阻止滚动
			e.stopPropagation(); // 阻止全局监听器
			
			const touch = e.touches[0];

			if (ghostEl) {
				ghostEl.setCssStyles({
					left: (touch.clientX - ghostOffsetX) + 'px',
					top: (touch.clientY - ghostOffsetY) + 'px'
				});
			}
			
			// 隐藏 dragSource 以便 elementFromPoint 获取下面的元素
			const oldPointerEvents = dragSource.style.pointerEvents;
			dragSource.setCssStyles({ pointerEvents: 'none' });
			const elemBelow = activeDocument.elementFromPoint(touch.clientX, touch.clientY);
			dragSource.setCssStyles({ pointerEvents: oldPointerEvents });
			
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

		const onTouchEnd = (e: TouchEvent) => {
			if (longPressTimer) {
				window.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			
			if (!dragSource || !dummyDataTransfer) return;
			e.stopPropagation(); // 阻止全局监听器

			dragSource.setCssStyles({ opacity: '' });
			
			const touch = e.changedTouches[0];
			
			if (currentDropTarget) {
				const dropEvent = createDragEvent('drop', touch, dummyDataTransfer);
				currentDropTarget.dispatchEvent(dropEvent);
			}
			
			dragSource.dispatchEvent(createDragEvent('dragend', touch, dummyDataTransfer));
			
			dragSource = null;
			currentDropTarget = null;
			dummyDataTransfer = null;
			if (ghostEl) {
				ghostEl.remove();
				ghostEl = null;
			}
		};

		const onTouchCancel = (e: TouchEvent) => {
			if (longPressTimer) window.clearTimeout(longPressTimer);
			if (dragSource && dummyDataTransfer) {
				dragSource.setCssStyles({ opacity: '' });
				dragSource.dispatchEvent(createDragEvent('dragend', e.changedTouches[0], dummyDataTransfer));
			}
			dragSource = null;
			currentDropTarget = null;
			dummyDataTransfer = null;
			if (ghostEl) {
				ghostEl.remove();
				ghostEl = null;
			}
		};

		const onContextMenu = (e: MouseEvent) => {
			if (dragSource || longPressTimer) {
				e.preventDefault();
				e.stopPropagation();
			}
		};

		container.addEventListener('touchstart', onTouchStart, { passive: true });
		container.addEventListener('touchmove', onTouchMove, { passive: false });
		container.addEventListener('touchend', onTouchEnd);
		container.addEventListener('touchcancel', onTouchCancel);
		container.addEventListener('contextmenu', onContextMenu);

		return () => {
			container.removeEventListener('touchstart', onTouchStart);
			container.removeEventListener('touchmove', onTouchMove);
			container.removeEventListener('touchend', onTouchEnd);
			container.removeEventListener('touchcancel', onTouchCancel);
			container.removeEventListener('contextmenu', onContextMenu);
		};
	}
}
