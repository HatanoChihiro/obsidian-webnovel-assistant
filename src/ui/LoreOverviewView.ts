import { ItemView, TFile, type WorkspaceLeaf, setIcon } from 'obsidian';
import type { AdaptiveDebounceManager } from '../services/AdaptiveDebounceManager';
import type { CharacterManager } from '../services/CharacterManager';
import type { HomepageManager } from '../services/HomepageManager';
import type { AccurateCountSettings } from '../types/settings';
import { VIEW_TYPES } from '../constants';
import { t } from '../i18n';
import type { CurrentBookContextPlugin } from '../utils/path';
import { getCurrentBookContext, findBookRoot } from '../utils/path';
import { LoreBoardRenderer, type LoreBoardCardsPlugin } from './components/LoreBoardRenderer';
import { WorkbenchFilterIndex } from '../services/WorkbenchFilterIndex';

export const LORE_OVERVIEW_VIEW_TYPE = VIEW_TYPES.LORE_OVERVIEW;

export type LoreOverviewCharacterManager = Pick<
	CharacterManager,
	| 'ensureInitialized'
	| 'getCharactersForBook'
	| 'getLoreEntriesInFileOrder'
	| 'findLoreFolder'
	| 'getCharacterFile'
	| 'moveLoreItem'
	| 'rebuildCache'
	| 'getLoreContent'
	| 'updateLoreContent'
>;

export type LoreOverviewAdaptiveDebounceManager = Pick<AdaptiveDebounceManager, 'debounceFixed' | 'cancel'>;

export type LoreOverviewSettings = Pick<
	AccurateCountSettings,
	| 'workspaceFolders'
	| 'loreFolderName'
	| 'timeline'
	| 'foreshadowing'
	| 'novelInfo'
	| 'loreBoardActiveFile'
	| 'lorePopoverCollapse'
>;

export type LoreOverviewHomepageManager = Pick<HomepageManager, 'getNovelFolders' | 'getHomepageFilePath'>;

export interface LoreOverviewViewPlugin
	extends Omit<CurrentBookContextPlugin, 'settings' | 'homepageManager'>,
		LoreBoardCardsPlugin {
	characterManager: LoreOverviewCharacterManager;
	adaptiveDebounceManager: LoreOverviewAdaptiveDebounceManager;
	settings: LoreOverviewSettings;
	homepageManager?: LoreOverviewHomepageManager;
	saveSettings?: () => Promise<void>;
}

/**
 * 设定一览侧面板视图
 * 将设定看板中的设定卡片原样抽出到侧边栏展示，支持分类 Tab/分组、卡片就地编辑与点击跳转定位
 */
export class LoreOverviewView extends ItemView {
	private plugin: LoreOverviewViewPlugin;
	private currentBookPath: string | null = null;
	private container!: HTMLElement;
	private readonly filterIndex: WorkbenchFilterIndex;
	private loreFilterQuery: string = '';
	private filterDebounceTimer: number | null = null;
	private pendingFilterFocus: { start: number; end: number } | null = null;
	private currentRenderId: number = 0;

	constructor(leaf: WorkspaceLeaf, plugin: LoreOverviewViewPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.filterIndex = new WorkbenchFilterIndex(this.app);

		// 监听 Vault 重命名与删除及元数据修改，失效缓存并刷新
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.filterIndex.invalidate(oldPath);
			this.filterIndex.invalidate(file.path);
			if (file instanceof TFile && file.extension === 'md') {
				this.plugin.adaptiveDebounceManager.debounceFixed('lore-overview-refresh', () => {
					void this.reloadBoard();
				}, 500);
			}
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.filterIndex.invalidate(file.path);
			if (file instanceof TFile && file.extension === 'md') {
				this.plugin.adaptiveDebounceManager.debounceFixed('lore-overview-refresh', () => {
					void this.reloadBoard();
				}, 500);
			}
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.filterIndex.invalidate(file.path);
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
				this.currentRenderId++;
				void this.reloadBoard();
			}
		}));

		// 监听工作台书籍切换广播
		this.registerEvent(this.app.workspace.on('webnovel-workbench-book-changed', (bookPath: string) => {
			const folderStr = bookPath === '/' ? '/' : bookPath;
			if (folderStr && folderStr !== this.currentBookPath) {
				this.currentBookPath = folderStr;
				this.currentRenderId++;
				void this.reloadBoard();
			}
		}));
	}

	public async setBookPath(path: string): Promise<void> {
		if (this.currentBookPath !== path) {
			this.currentBookPath = path;
			this.currentRenderId++;
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
		this.currentRenderId++;
		this.plugin.adaptiveDebounceManager.cancel('lore-overview-refresh');
		if (this.filterDebounceTimer !== null) {
			window.clearTimeout(this.filterDebounceTimer);
			this.filterDebounceTimer = null;
		}
		this.pendingFilterFocus = null;
		this.filterIndex.clear();
		this.contentEl.empty();
	}

	public async reloadBoard(): Promise<void> {
		if (!this.container) return;

		const renderId = ++this.currentRenderId;
		const buffer = createDiv();

		let scrollTop = 0;
		const boardLayout = this.container.querySelector('.wn-lore-board-layout');
		if (boardLayout) {
			scrollTop = (boardLayout as HTMLElement).scrollTop;
		} else {
			scrollTop = this.container.scrollTop;
		}

		if (!this.currentBookPath) {
			const emptyEl = buffer.createDiv('wn-corkboard-empty');
			emptyEl.setText(t('corkboard.no-book-open'));
			if (this.currentRenderId !== renderId) return;
			this.swapBuffer(buffer);
			return;
		}

		const normalizedBookPath = this.currentBookPath === '' ? '/' : this.currentBookPath;
		await this.plugin.characterManager.ensureInitialized();
		if (this.currentRenderId !== renderId) return;
		const allCharacters = this.plugin.characterManager.getCharactersForBook(normalizedBookPath) || [];

		if (allCharacters.length === 0) {
			const emptyEl = buffer.createDiv('wn-corkboard-empty');
			emptyEl.setText(t('corkboard.no-lore'));
			if (this.currentRenderId !== renderId) return;
			this.swapBuffer(buffer);
			return;
		}

		let matchedLoreHeadings: ReadonlySet<string> | undefined;
		const hasQuery = this.loreFilterQuery.trim().length > 0;
		const loreEntries = this.plugin.characterManager.getLoreEntriesInFileOrder(normalizedBookPath);
		if (hasQuery) {
			matchedLoreHeadings = await this.filterIndex.filterLoreEntries(
				loreEntries,
				this.getLoreAliases(normalizedBookPath),
				this.loreFilterQuery
			);
			if (this.currentRenderId !== renderId) return;
		}

		this.renderFilterBar(
			buffer,
			matchedLoreHeadings?.size ?? loreEntries.length,
			loreEntries.length
		);

		await LoreBoardRenderer.renderCards(
			buffer,
			this.app,
			this.plugin,
			normalizedBookPath,
			allCharacters,
			matchedLoreHeadings,
			() => { void this.reloadBoard(); },
			this,
			{ hideTabs: true }
		);

		if (this.currentRenderId !== renderId) return;
		this.swapBuffer(buffer);
		this.restorePendingFilterFocus();

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

	private swapBuffer(buffer: HTMLElement): void {
		const fragment = (window as unknown as { createFragment: () => DocumentFragment }).createFragment();
		while (buffer.firstChild) {
			fragment.appendChild(buffer.firstChild);
		}
		this.container.empty();
		this.container.appendChild(fragment);
	}

	private restorePendingFilterFocus(): void {
		const pending = this.pendingFilterFocus;
		if (!pending) return;

		const input = this.container.querySelector<HTMLInputElement>('.wn-workbench-filter-input');
		if (!input) return;

		this.pendingFilterFocus = null;
		window.requestAnimationFrame(() => {
			if (!input.isConnected) return;
			input.focus({ preventScroll: true });
			const max = input.value.length;
			input.setSelectionRange(Math.min(pending.start, max), Math.min(pending.end, max));
		});
	}

	public clearSearchInput(): void {
		const input = this.container?.querySelector<HTMLInputElement>('.wn-workbench-filter-input');
		if (input) {
			input.value = '';
			const clearButton = input.parentElement?.querySelector<HTMLElement>('.wn-workbench-filter-clear');
			if (clearButton) {
				clearButton.classList.remove('is-visible');
				clearButton.setAttribute('aria-hidden', 'true');
			}
			this.scheduleFilterRefresh(input, true);
		} else {
			this.loreFilterQuery = '';
			this.currentRenderId++;
			void this.reloadBoard();
		}
	}

	private getLoreAliases(bookPath: string): Map<string, string[]> {
		const aliasesByHeading = new Map<string, string[]>();
		for (const name of this.plugin.characterManager.getCharactersForBook(bookPath)) {
			const entry = this.plugin.characterManager.getCharacterFile(bookPath, name);
			if (!entry || name === entry.heading) continue;

			const aliases = aliasesByHeading.get(entry.heading) ?? [];
			if (!aliases.includes(name)) aliases.push(name);
			aliasesByHeading.set(entry.heading, aliases);
		}
		return aliasesByHeading;
	}

	private renderFilterBar(
		container: HTMLElement,
		matchedCount: number,
		totalCount: number
	): void {
		const bar = container.createDiv('wn-workbench-filter-bar');
		bar.createSpan({
			cls: 'wn-workbench-filter-count',
			text: t('corkboard.filter-result-count', {
				matched: matchedCount.toString(),
				total: totalCount.toString()
			})
		});

		const inputWrapper = bar.createDiv('wn-workbench-filter-input-wrapper');
		const searchIcon = inputWrapper.createSpan('wn-workbench-filter-icon');
		setIcon(searchIcon, 'search');

		const input = inputWrapper.createEl('input', {
			type: 'search',
			cls: 'wn-workbench-filter-input'
		});
		input.value = this.loreFilterQuery;
		input.placeholder = t('corkboard.filter-lore-placeholder');
		input.setAttr('aria-label', input.placeholder);
		input.setAttr('autocomplete', 'off');
		input.spellcheck = false;

		const clearButton = inputWrapper.createDiv('clickable-icon wn-workbench-filter-clear');
		clearButton.setAttr('role', 'button');
		clearButton.setAttr('tabindex', '0');
		clearButton.setAttr('aria-label', t('corkboard.filter-clear'));
		setIcon(clearButton, 'x');

		const updateClearButton = () => {
			const isVisible = input.value.length > 0;
			clearButton.toggleClass('is-visible', isVisible);
			clearButton.setAttr('aria-hidden', isVisible ? 'false' : 'true');
		};
		updateClearButton();

		let isComposing = false;
		input.addEventListener('compositionstart', () => {
			isComposing = true;
			this.currentRenderId++;
			if (this.filterDebounceTimer !== null) {
				window.clearTimeout(this.filterDebounceTimer);
				this.filterDebounceTimer = null;
			}
		});
		input.addEventListener('compositionend', () => {
			isComposing = false;
			updateClearButton();
			this.scheduleFilterRefresh(input);
		});
		input.addEventListener('input', (event) => {
			updateClearButton();
			if (isComposing || (event as unknown as { isComposing?: boolean }).isComposing) return;
			this.scheduleFilterRefresh(input);
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
			this.scheduleFilterRefresh(input, true);
		});
		clearButton.onclick = () => {
			input.value = '';
			updateClearButton();
			this.scheduleFilterRefresh(input, true);
		};
		clearButton.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			clearButton.click();
		});
	}

	private scheduleFilterRefresh(input: HTMLInputElement, immediate: boolean = false): void {
		this.loreFilterQuery = input.value;
		this.pendingFilterFocus = {
			start: input.selectionStart ?? input.value.length,
			end: input.selectionEnd ?? input.value.length
		};

		this.currentRenderId++;
		if (this.filterDebounceTimer !== null) window.clearTimeout(this.filterDebounceTimer);
		this.filterDebounceTimer = window.setTimeout(() => {
			this.filterDebounceTimer = null;
			void this.reloadBoard();
		}, immediate ? 0 : 200);
	}
}
