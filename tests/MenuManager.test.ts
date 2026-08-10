import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/RelationGraphView', () => ({
	RELATION_GRAPH_VIEW_TYPE: 'webnovel-relation-graph'
}));

import { MenuManager } from '../src/core/MenuManager';
import { t } from '../src/i18n';

interface MenuItemMock {
	setTitle(title: string): this;
	setIcon(icon: string): this;
	setSection(section: string): this;
	onClick(callback: () => void): this;
}

interface MenuMock {
	addItem(callback: (item: MenuItemMock) => void): void;
}

describe('MenuManager sticky note menu labels', () => {
	it('uses the current-file label for the file context menu item', () => {
		const titles: string[] = [];
		const menu: MenuMock = {
			addItem: (callback) => {
				const item: MenuItemMock = {
					setTitle(title) {
						titles.push(title);
						return this;
					},
					setIcon() { return this; },
					setSection() { return this; },
					onClick() { return this; }
				};
				callback(item);
			}
		};
		const plugin = {
			app: {},
			characterManager: {
				getBookPathForFile: () => '',
				isLorePath: () => false
			}
		};
		const manager = new MenuManager(plugin as never);
		const addFileMenuItems = (manager as unknown as {
			addFileMenuItems: (targetMenu: MenuMock, file: unknown) => void;
		}).addFileMenuItems;

		addFileMenuItems.call(manager, menu, { parent: { path: '' } });

		expect(titles).toContain(t('menu.current-file-extract-note'));
		expect(titles).not.toContain(t('menu.extract-sticky-note'));
	});
});
