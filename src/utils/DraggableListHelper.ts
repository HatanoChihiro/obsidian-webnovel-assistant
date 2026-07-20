export interface DraggableListOptions {
    container: HTMLElement;
    itemSelector: string;
    dragDataMimeType: string;
    getDragData: (el: HTMLElement) => string;
    onDrop: (fromData: string, toData: string, insertAfter: boolean) => void;
    canDrag?: () => boolean;
}

export class DraggableListHelper {
    static init(options: DraggableListOptions) {
        const { container, itemSelector, dragDataMimeType, getDragData, onDrop } = options;

		const onDragEnter = (e: DragEvent) => {
			if (options.canDrag && !options.canDrag()) return;
			if (!e.dataTransfer?.types.includes(dragDataMimeType)) return;
			e.preventDefault();
			const target = (e.target as HTMLElement).closest(itemSelector);
			if (!target) return;
		};

		const onDragOver = (e: DragEvent) => {
			if (options.canDrag && !options.canDrag()) return;
			if (!e.dataTransfer?.types.includes(dragDataMimeType)) return;
			e.preventDefault();
			const targetItem = (e.target as HTMLElement).closest(itemSelector) as HTMLElement;
			
			container.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
				if (el !== targetItem) {
					el.removeClass('drag-over-left');
					el.removeClass('drag-over-right');
				}
			});

			if (!targetItem) return;

			const rect = targetItem.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			if (e.clientX < midX) {
				targetItem.removeClass('drag-over-right');
				targetItem.addClass('drag-over-left');
			} else {
				targetItem.removeClass('drag-over-left');
				targetItem.addClass('drag-over-right');
			}
		};

		const onDragLeave = (_e: DragEvent) => {};

		const onDropEvent = (e: DragEvent) => {
			if (options.canDrag && !options.canDrag()) return;
			if (!e.dataTransfer?.types.includes(dragDataMimeType)) return;
			e.preventDefault();
			const targetItem = (e.target as HTMLElement).closest(itemSelector) as HTMLElement;
			
			container.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
				el.removeClass('drag-over-left');
				el.removeClass('drag-over-right');
			});

			if (!targetItem) return;

			const fromData = e.dataTransfer?.getData(dragDataMimeType);
			if (!fromData) return;

			const toData = getDragData(targetItem);
			if (!toData || fromData === toData) return;

			const rect = targetItem.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			const insertAfter = e.clientX >= midX;

			onDrop(fromData, toData, insertAfter);
		};

		container.addEventListener('dragenter', onDragEnter);
		container.addEventListener('dragover', onDragOver);
		container.addEventListener('dragleave', onDragLeave);
		container.addEventListener('drop', onDropEvent);

		return () => {
			container.removeEventListener('dragenter', onDragEnter);
			container.removeEventListener('dragover', onDragOver);
			container.removeEventListener('dragleave', onDragLeave);
			container.removeEventListener('drop', onDropEvent);
		};
	}
}
