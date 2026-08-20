import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { VIEW_TYPES } from '../constants';
import { t } from '../i18n';
import { getCurrentBookContext, findBookRoot } from '../utils/path';
import { LoreBoardRenderer } from './components/LoreBoardRenderer';

export const LORE_OVERVIEW_VIEW_TYPE = VIEW_TYPES.LORE_OVERVIEW;

/**
 * 设定一览侧面板视图
 * 将设定看板中的设定卡片原样抽出到侧边栏展示，支持分类 Tab/分组、卡片就地编辑与点击跳转定位
 */
export class LoreOverviewView extends ItemView {
	private plugin: WebNovelAssistantPlugin;
	private currentBookPath: string | null = null;
	private container!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: WebNovelAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;

		// 监听 Vault 重命名与删除
		this.registerEvent(this.app.vault.on('rename', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.plugin.adaptiveDebounceManager.debounceFixed('lore-overview-refresh', () => {
					void this.reloadBoard();
				}, 500);
			}
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.plugin.adaptiveDebounceManager.debounceFixed('lore-overview-refresh', () => {
					void this.reloadBoard();
				}, 500);
			}
		}));

		// 监听设定缓存更新
		this.registerEvent(this.app.workspace.on('webnovel-workbench-lore-updated', () => {
			this.plugin.adaptiveDebounceManager.debounceFixed('lore-overview-refresh', () => {
				void this.reloadBoard();
			}, 300);
		}));

		// 监听活动文件变化，自动关联书籍目录
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (!leaf || leaf.view.getViewType() !== 'markdown') return;
			const file = this.app.workspace.getActiveFile();
			if (!file) return;

			const homepagePath = this.plugin.homepageManager?.getHomepageFilePath();
			if (homepagePath && (file.path === homepagePath || file.name === '创作主页.md')) {
				return;
			}

			const bookRoot = findBookRoot(this.app, this.plugin, file, true);
			if (!bookRoot) return;
			if (bookRoot !== this.currentBookPath) {
				this.currentBookPath = bookRoot;
				void this.reloadBoard();
			}
		}));

		// 监听工作台书籍切换广播
		this.registerEvent(this.app.workspace.on('webnovel-workbench-book-changed', (bookPath: string) => {
			const folderStr = bookPath === '/' ? '/' : bookPath;
			if (folderStr && folderStr !== this.currentBookPath) {
				this.currentBookPath = folderStr;
				void this.reloadBoard();
			}
		}));
	}

	public async setBookPath(path: string): Promise<void> {
		if (this.currentBookPath !== path) {
			this.currentBookPath = path;
			await this.reloadBoard();
		}
	}

	getViewType(): string {
		return LORE_OVERVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('view.lore-overview');
	}

	getIcon(): string {
		return 'book-marked';
	}

	async onOpen() {
		this.container = this.contentEl;
		this.container.empty();
		this.container.addClass('wn-lore-overview-container');
		this.container.addClass('wn-corkboard-container');
		this.currentBookPath = getCurrentBookContext(this.app, this.plugin) || null;
		await this.reloadBoard();
	}

	async onClose() {
		this.contentEl.empty();
	}

	public async reloadBoard(): Promise<void> {
		if (!this.container) return;

		let scrollTop = 0;
		const boardLayout = this.container.querySelector('.wn-lore-board-layout');
		if (boardLayout) {
			scrollTop = (boardLayout as HTMLElement).scrollTop;
		} else {
			scrollTop = this.container.scrollTop;
		}

		this.container.empty();

		if (!this.currentBookPath) {
			const emptyEl = this.container.createDiv('wn-corkboard-empty');
			emptyEl.setText(t('corkboard.no-book-open'));
			return;
		}

		const normalizedBookPath = this.currentBookPath === '' ? '/' : this.currentBookPath;
		await this.plugin.characterManager.ensureInitialized();
		const allCharacters = this.plugin.characterManager.getCharactersForBook(normalizedBookPath) || [];

		if (allCharacters.length === 0) {
			const emptyEl = this.container.createDiv('wn-corkboard-empty');
			emptyEl.setText(t('corkboard.no-lore'));
			return;
		}

		await LoreBoardRenderer.renderCards(
			this.container,
			this.app,
			this.plugin,
			normalizedBookPath,
			allCharacters,
			undefined,
			() => { void this.reloadBoard(); },
			this,
			{ hideTabs: true }
		);

		if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(() => {
				const newBoardLayout = this.container.querySelector('.wn-lore-board-layout');
				if (newBoardLayout && scrollTop > 0) {
					(newBoardLayout as HTMLElement).scrollTop = scrollTop;
				} else if (scrollTop > 0) {
					this.container.scrollTop = scrollTop;
				}
			});
		}
	}
}
